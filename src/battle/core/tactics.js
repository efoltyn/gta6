/* ============================================================
   battle/core/tactics.js — CBZ.battleTactics: THE SQUAD BRAIN.
   Page-independent (no DOM, no THREE, no battle.html globals): it reads unit
   objects (pos, team, tgt, supp, hp, mag ...) and asks the world only through
   an adapter the host hands it (A, below). NPC War's adapter is in
   src/battle/ai/squad.js; Gang City's war will hand it the city's.

   WHAT A SQUAD IS. Ten men (the page's `squads[team][sq]`) with a LEADER
   (the senior man standing; when he falls the squad is shaken and the next
   man takes over after a beat) and two FIRE TEAMS (alpha rides with the
   leader, bravo is the other half). The squad decides as one, on its own
   slow tick; each man still picks his own trigger moments, his own cover
   cycle and his own reflexes (src/battle/ai/think.js / squad.js).

   THE TASKS (S.task), and what each man is told (m.task + m.post):
     march     no contact: a formation behind the leader, who navigates.
               COLUMN far from the enemy, WEDGE once he is within reach,
               spacing 5-7 m (a grenade's radius, not a parade's 1.25 m).
     bound     contact, advancing: ONE TEAM MOVES, THE OTHER WATCHES. The
               overwatch team fights from cover where it is; the moving team
               rushes 10-28 m to the next cover (a box, a dune's reverse
               slope, else open ground they go flat on), then they swap.
               The bound shortens as the fire on the squad grows.
     fight     in range: a base of fire from posts (cover first) around an
               anchor that only moves when the squad decides it should.
     flank     the enemy is fixed: alpha keeps him down, bravo swings 60-80
               degrees round on the side with more cover and comes in on it.
     assault   close and winning (or the enemy is breaking): everyone goes in,
               shooting, by short rushes.
     pinned    the fire on the squad is too much: everybody down, return what
               fire they can, nobody moves until it slackens (men pinned stay
               pinned for at least PIN_MIN_T).
     fallback  losing: back to defensible ground behind (cover, a crest),
               one team covering the other, then HOLD there.
     hold      a line that is held (the page's ORDER, or after a fallback):
               posts leashed to the anchor.
     drill     the enemy is an ANIMAL: a firing line across its approach, the
               front kneels, reloads staggered so the line never goes silent,
               men keep their distance and step out of a charge's path.
     screen    a friendly armoured vehicle is near: the squad rides its rear
               quarters, uses its hull as cover, and the vehicle does not run
               away from its infantry (paceVehicle).
   Per man, set every squad tick: m.sqd, m.task, m.ft (0 alpha / 1 bravo),
   m.post {x, z, kind: "cover"|"fold"|"hull"|"open"|"form", low, px, pz}
   (px/pz = the peek spot for a tall wall), m.leader (bool), m.focus (the
   squad's chosen target, a recommendation), m.wantNade, m.dragTgt.

   THREAT AND FOCUS. Every known enemy is scored (what he is: a tank, a
   machine gun, a rocket, a sniper, a rifle, a charging animal; how close;
   whether he is shooting at THIS squad). The best one a member can see is
   the squad's FOCUS: up to ~60% of the guns switch to it, the rest keep
   their own marks (no overkill, no unwatched flank).

   MORALE (per squad, on top of the army's): casualties, the leader lost,
   the fire on it, how long it has been pinned, and the local odds. It
   drives fallback; the man's own break is still systems/brain.js's
   (src/battle/ai/morale.js), shaken further by S.shock.

   TIERS (ARCHITECTURE.md §9). tierOf() reads the host's LOD (m.tier when
   the scale scheduler sets it, else the camera distance through
   CBZ.battleLod): FULL men think every BUDGET.think.full and run every
   reflex; MID men think on the mid tick and skip the per-man searches (the
   squad's posts carry them); FAR men do not think individually at all: the
   squad tick hands them their post and their mark. COST holds the measured
   milliseconds per tier (A.clock() supplies a clock; none = not measured).

   THE ADAPTER (A) the host supplies:
     now()  rand()  clock()?          sim seconds, the seeded stream, a ms clock
     host                            the battle host (core/host.js): groundAt,
                                     segmentBlocked, queryColliders, terrainLos
     sees(a, b)                      a line of sight between two bodies
     fold(x, z, tx, tz)              a reverse-slope spot near (x, z) hidden
                                     from (tx, tz), or null (budgeted)
     near(x, z, r, out)              bodies near a point
     enemyCOM(team) / homeDir(team)  the enemy's centre; a unit vector rearward
     order(team) / hunting(team) / enemyBroken(team)
     odds(team)                      own fighting power / the enemy's
     camera()                        {x, z} of the lens (for tiers)
     vehicles(team)                  that side's live ground vehicles
     navStep(m, out)                 the flow field's next step for m
   PUBLIC
     CBZ.battleTactics = { K, FORMS, formSlot, threat, make, tick, tierOf,
       reloadOK, postFor, COST, stats(), reset() }
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W.CBZ || (W.CBZ = {});

  const K = {
    SQUAD_TICK: [0.5, 0.9, 1.6],         // s between squad decisions: full / mid / far
    SPACING: { column: 4.5, wedge: 6.0, line: 5.5, file: 4.0, drill: 3.6 },
    DEPLOY_R: 230,                       // enemy centre nearer than this: wedge, not column
    CONTACT_HOLD: 6,                     // s a squad stays deployed after the last contact
    BOUND_MIN: 9, BOUND_MAX: 26, BOUND_T: 7.5,
    ENGAGE_PAD: 14,                      // past the guns' preferred band by this: keep bounding
    PIN_SUPP: 0.58, PIN_OUT: 0.3, PIN_MIN_T: 2.5, PIN_LONG: 14,
    FALLBACK_MORALE: 0.36, FALLBACK_DIST: 32,
    FLANK_ODDS: 1.15, FLANK_MAX_T: 30, FLANK_ANG: 1.2,
    ASSAULT_D: 30, ASSAULT_ODDS: 1.7,
    FOCUS_SHARE: 0.6,
    NADE_MIN: 8, NADE_MAX: 30, NADE_SAFE: 9, NADE_GAP: 6,
    DRAG_R: 38, DRAG_SUPP: 0.6,
    RELOAD_SHARE: 0.34,                  // at most a third of a line reloads at once
    COVER_R: 9,                          // how far a man leaves his line-slot for a box
    BEAST_KEEP: 22,                      // m: the range a firing line holds off an animal
    SHOCK_LEADER: 0.28, SHOCK_DECAY: 0.04,
  };
  const COST = { full: { n: 0, ms: 0 }, mid: { n: 0, ms: 0 }, far: { n: 0, ms: 0 }, squad: { n: 0, ms: 0 },
    // the squad ticks again, by the squad's own tier
    sqFull: { n: 0, ms: 0 }, sqMid: { n: 0, ms: 0 }, sqFar: { n: 0, ms: 0 } };
  const SQ_COST = ["sqFull", "sqMid", "sqFar"];
  const STATS = { bounds: 0, flanks: 0, assaults: 0, pins: 0, fallbacks: 0, drills: 0, screens: 0,
    focusSwitch: 0, nades: 0, drags: 0, leadersLost: 0, surrendered: { red: 0, blue: 0 }, coverPosts: 0, foldPosts: 0, openPosts: 0 };

  /* ---------------------------------------------------------- formations
     formSlot(form, idx, sp) -> { r, b }: metres to the leader's RIGHT and
     BEHIND him for the man in slot idx (the leader is idx 0). */
  const FORMS = ["column", "wedge", "line", "file", "drill"];
  const _fs = { r: 0, b: 0 };
  function formSlot(form, idx, sp) {
    if (idx <= 0) { _fs.r = 0; _fs.b = 0; return _fs; }
    const k = Math.ceil(idx / 2), side = (idx & 1) ? 1 : -1;
    if (form === "column") { _fs.r = side * sp * 0.4; _fs.b = idx * sp * 0.75; }
    else if (form === "wedge") { _fs.r = side * k * sp * 0.75; _fs.b = k * sp * 0.6; }
    else if (form === "line" || form === "drill") { _fs.r = side * k * sp; _fs.b = 0; }
    else { _fs.r = 0; _fs.b = idx * sp; }                 // file
    return _fs;
  }

  /* ---------------------------------------------------------- helpers */
  function out(o) { return !o || o.dead || o.fled || o.surrendered || o.downed; }
  function soldier(m) { return m && !m.beast && !m.vehicle && !m.inVeh; }
  function armoured(o) {
    if (!o || !o.vehicle || !o.def || !o.def.stats) return false;
    const a = o.def.stats.armour || {};
    return (a.side || 0) > 30;
  }
  // armour that can still kill you: a hull whose gun is knocked out is a hulk to walk past
  function armedArmour(o) { return armoured(o) && !(o.vs && o.vs.firepower) && !o.dead && !o.routed; }
  function wclass(m) {
    if (m.launcher) return "at";
    const w = m.wid || "";
    if (w === "lmg" || w === "minigun") return "mg";
    if (w === "sniper") return "marksman";
    if (w === "glauncher") return "gren";
    if (w === "smg" || w === "shotgun" || w === "uzi" || w === "pistol" || w === "revolver" || w === "deagle") return "cqb";
    return "rifle";
  }
  // a stable per-man number in [0,1): jitter that does not touch the seeded stream
  function hash01(m, salt) {
    let h = ((m.i | 0) * 2654435761 + (salt | 0) * 40503 + (m.team === "red" ? 7 : 13)) >>> 0;
    h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
  }

  /* ---------------------------------------------------------- threat
     How much this enemy matters to THIS squad right now. */
  function threat(S, o, A) {
    if (out(o) || o.routed) return 0.05;
    const dx = o.pos.x - S.cx, dz = o.pos.z - S.cz, d = Math.hypot(dx, dz);
    let base = 1.5;
    if (o.vehicle) base = armoured(o) ? (S.hasAT ? 7 : 4) : 3.2;
    else if (o.beast) {
      const sp = o.species || {}, tn = o.tn || {};
      base = 1.2 + (sp.danger || 0.4) * 4;
      if (o.state === "charge" && o.tgt && o.tgt.sqd === S) base *= 1.7;
      if (tn.prey) base = 0.3;
    } else {
      const c = wclass(o);
      base = c === "at" ? (S.hasArmour ? 5.5 : 3) : c === "mg" ? 3.2 : c === "marksman" ? 2.6 : c === "gren" ? 2.4 :
        c === "cqb" ? (d < 30 ? 2.6 : 0.9) : o.fists ? (d < 12 ? 1.4 : 0.3) : 1.6;
    }
    let s = base * (1 + 70 / (d + 25));
    // he is shooting at us
    if (o.tgt && o.tgt.sqd === S && A.now() - (o.lastShotT || -99) < 3) s *= 1.6;
    if ((o.supp || 0) > 0.7) s *= 0.8;            // already kept down
    if (o.hp != null && o.maxHp) s *= 0.75 + 0.25 * Math.max(0, Math.min(1, o.hp / o.maxHp));
    return s;
  }

  /* ---------------------------------------------------------- squads */
  const SQ = new Map();       // key -> S
  function make(team, idx, list) {
    const key = team + ":" + idx;
    let S = SQ.get(key);
    if (S && S.list === list) return S;
    S = {
      key, team, idx, list, men: [], ft: [[], []], leader: null, n0: 0, lost: 0,
      task: "march", taskT: 0, prevTask: "march", mover: 1, moverT: 0,
      anchor: null, teamAnchor: [null, null], face: { x: 1, z: 0 }, form: "column",
      focus: null, threatTop: null, beastShare: 0, cx: 0, cz: 0, supp: 0, morale: 1, shock: 0,
      lastContact: -99, pinnedT: 0, pinOutT: 0, flankSide: 1, nadeT: 0, tickAt: 0, tier: 0,
      hasAT: false, hasArmour: false, escort: null, downed: [], reloading: 0, alive: 0,
    };
    SQ.set(key, S);
    return S;
  }
  function reset() {
    SQ.clear();
    for (const k in COST) { COST[k].n = 0; COST[k].ms = 0; }
    for (const t in PLT) { PLT[t].keys = null; PLT[t].at = -9; }
  }

  function setTask(S, t, A) {
    if (S.task === t) return;
    S.prevTask = S.task; S.task = t; S.taskT = A.now(); S.postsDirty = true;
    if (t === "bound") STATS.bounds++;
    else if (t === "flank") STATS.flanks++;
    else if (t === "assault") STATS.assaults++;
    else if (t === "pinned") STATS.pins++;
    else if (t === "fallback") STATS.fallbacks++;
    else if (t === "drill") STATS.drills++;
    else if (t === "screen") STATS.screens++;
  }

  /* ---------------------------------------------------------- tiers */
  // m.lod (0 FULL / 1 MID / 2 FAR) when the scale scheduler has set one;
  // else the lens distance through CBZ.battleLod's one table
  function tierOf(m, A) {
    if (m.lod === 0 || m.lod === 1 || m.lod === 2) return m.lod;
    if (m.you || m.leader && m.sqd && m.sqd.subject) return 0;
    const L = CBZ.battleLod, c = A.camera ? A.camera() : null;
    if (!L || !c) return 0;
    const dx = m.pos.x - c.x, dz = m.pos.z - c.z;
    return L.tierOf(dx * dx + dz * dz, null);
  }

  /* ---------------------------------------------------------- reload
     A line never goes silent: a man may START a reload only while fewer
     than a third of his squad's guns are already reloading — unless he is
     dry, in which case he has no choice. reloadOK(m) answers for a TACTICAL
     reload (mag below half), which is how the line stays topped up. */
  function reloadOK(m) {
    const S = m.sqd;
    if (!S) return true;
    const cap = Math.max(1, Math.floor(S.alive * K.RELOAD_SHARE));
    return S.reloading < cap;
  }

  /* ---------------------------------------------------------- posts
     A post is where one man fights from. Cover first (a collider between him
     and the threat, the hide point just past it; a tall wall also gets a
     peek point at its edge), then the terrain's own fold, then open ground
     (where he will be kneeling or flat). One collider query per assignment,
     each box taken by one man. */
  const _cols = [];
  const _taken = [];
  let _foldBudget = 0;
  const FOLDS = [2, 1, 0];          // fold searches per post assignment, by the squad's tier
  function coverCands(A, x, z, r) {
    const h = A.host;
    if (!h || !h.queryColliders) return [];
    const cols = h.queryColliders(x, z, r, _cols) || [];
    return cols;
  }
  function hidePoint(c, tx, tz, A) {
    if (c.minX == null) return null;
    const w = c.maxX - c.minX, d = c.maxZ - c.minZ;
    if (w < 0.7 && d < 0.7) return null;                        // a post is not cover
    if (w > 60 || d > 60) return null;                          // a whole block: not a man's wall
    const cx = (c.minX + c.maxX) * 0.5, cz = (c.minZ + c.maxZ) * 0.5;
    // colliders carry WORLD heights (microboot): measured from the ground under it
    // (cached on the record: walls do not move, and dune ground is not cheap)
    let gy = c._tacGy;
    if (gy == null) gy = c._tacGy = A.host && A.host.groundAt ? A.host.groundAt(cx, cz) : 0;
    const hgt = c.y1 == null ? 9 : c.y1 - gy, bot = c.y0 == null ? 0 : c.y0 - gy;
    if (hgt < 0.85 || bot > 1.2) return null;                  // a kerb, or a balcony, is not cover
    let ax = cx - tx, az = cz - tz;
    const al = Math.hypot(ax, az);
    if (al < 0.001) return null;
    ax /= al; az /= al;
    const ex = Math.abs(ax) > 1e-4 ? (w * 0.5) / Math.abs(ax) : 1e9;
    const ez = Math.abs(az) > 1e-4 ? (d * 0.5) / Math.abs(az) : 1e9;
    const reach = Math.min(ex, ez) + 0.75;
    const hx = cx + ax * reach, hz = cz + az * reach;
    const low = hgt < 1.45;
    let px = hx, pz = hz;
    if (!low) {
      // a tall wall: the peek spot is round its edge, perpendicular to the threat axis
      const half = Math.abs(az) * w * 0.5 + Math.abs(ax) * d * 0.5;   // half-extent across the axis
      const side = ((Math.floor(cx * 7 + cz * 3) & 1) ? 1 : -1);
      const off = half + 0.55;
      px = hx + (-az) * side * off; pz = hz + ax * side * off;
    }
    return { x: hx, z: hz, px, pz, low, ref: c, kind: "cover", side: low ? 0 : 1 };
  }
  function postAt(A, S, m, dx, dz, tx, tz, cols, wantCover) {
    // dx,dz: where the man should be (line slot); tx,tz: the threat
    let best = null, bs = 1e9;
    if (wantCover && cols) {
      for (let i = 0; i < cols.length; i++) {
        const c = cols[i];
        if (_taken.indexOf(c) >= 0 && (c.maxX - c.minX) + (c.maxZ - c.minZ) < 7) continue;   // one man to a crate; a long wall takes two
        const hp = hidePoint(c, tx, tz, A);
        if (!hp) continue;
        const dd = Math.hypot(hp.x - dx, hp.z - dz);
        if (dd > K.COVER_R) continue;
        // never a post nearer the threat than the slot by much (no running INTO the gun for a crate)
        const closing = Math.max(0, Math.hypot(dx - tx, dz - tz) - Math.hypot(hp.x - tx, hp.z - tz));
        let sc = dd + closing * 1.2;
        // keep men apart: a post near another's costs
        for (let j = 0; j < _taken.length; j++) {
          const o = _taken[j];
          if (o && o.px != null) { const e = Math.hypot(o.px - hp.x, o.pz - hp.z); if (e < 3.5) sc += (3.5 - e) * 3; }
        }
        if (sc < bs) { bs = sc; best = hp; }
      }
    }
    if (best) {
      _taken.push(best.ref, { px: best.x, pz: best.z });
      STATS.coverPosts++;
      return best;
    }
    // the ground itself: a reverse slope near the slot (a few searches per
    // assignment: each is ~60 terrain rays — the rest kneel or go flat)
    if (wantCover && A.fold && A.host && A.host.terrainLos && _foldBudget > 0) {
      _foldBudget--;
      const f = A.fold(dx, dz, tx, tz);
      if (f && Math.hypot(f.x - dx, f.z - dz) < K.COVER_R * 1.6) {
        _taken.push(null, { px: f.x, pz: f.z });
        STATS.foldPosts++;
        return { x: f.x, z: f.z, px: f.x, pz: f.z, low: true, kind: "fold" };
      }
    }
    _taken.push(null, { px: dx, pz: dz });
    STATS.openPosts++;
    return { x: dx, z: dz, px: dx, pz: dz, low: true, kind: "open" };
  }
  /* THE LINE GOES WHERE THE COVER IS. Before a line is laid, its centre is
     pulled toward the best cover within reach of it (boxes that would hide a
     man from the threat, not nearer the threat than the centre by much):
     a squad does not form up in the open twenty metres from a wall. */
  const _pull = { x: 0, z: 0 };
  function coverPull(A, ax, az, tx, tz, r) {
    _pull.x = ax; _pull.z = az;
    const cols = coverCands(A, ax, az, r);
    if (!cols.length) return _pull;
    const dT = Math.hypot(ax - tx, az - tz);
    let sx = 0, sz = 0, sw = 0;
    for (let i = 0; i < cols.length && i < 40; i++) {
      const hp = hidePoint(cols[i], tx, tz, A);
      if (!hp) continue;
      const d = Math.hypot(hp.x - ax, hp.z - az);
      if (d > r) continue;
      const closing = dT - Math.hypot(hp.x - tx, hp.z - tz);
      if (closing > 12) continue;                       // not a dash INTO the gun for a crate
      const w = 1 / (4 + d + Math.max(0, closing) * 1.5);
      sx += hp.x * w; sz += hp.z * w; sw += w;
    }
    if (sw > 0) { _pull.x = ax + (sx / sw - ax) * 0.7; _pull.z = az + (sz / sw - az) * 0.7; }
    return _pull;
  }
  // posts for a group of men in a line across the threat axis, centred on (ax, az)
  function linePosts(A, S, group, ax, az, tx, tz, sp, wantCover) {
    if (!group.length) return;
    let fx = tx - ax, fz = tz - az;
    const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
    const rx = fz, rz = -fx;          // right of the facing
    const cols = wantCover ? coverCands(A, ax, az, sp * group.length * 0.5 + K.COVER_R) : null;
    // order the men by where they already stand across the axis, so nobody crosses the line
    const ord = group.slice().sort(function (a, b) {
      return ((a.pos.x - ax) * rx + (a.pos.z - az) * rz) - ((b.pos.x - ax) * rx + (b.pos.z - az) * rz);
    });
    const n = ord.length;
    for (let i = 0; i < n; i++) {
      const m = ord[i];
      const off = (i - (n - 1) / 2) * sp;
      // a slight stagger so the line is not a ruler
      const back = ((i & 1) ? 1.2 : -0.6);
      const dx = ax + rx * off - fx * back, dz = az + rz * off - fz * back;
      m.post = postAt(A, S, m, dx, dz, tx, tz, cols, wantCover);
    }
  }

  /* ---------------------------------------------------------- the tick */
  const _near = [];
  function tick(S, A) {
    const t0 = A.clock ? A.clock() : 0;
    const now = A.now();
    // ---- who is standing
    const list = S.list;
    S.men.length = 0; S.downed.length = 0;
    let n0 = 0, dead = 0, ammoLow = 0;
    S.hasAT = false;
    let reloading = 0;
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (!soldier(m)) continue;
      n0++;
      if (m.dead || m.fled || m.surrendered) { dead++; continue; }
      if (m.downed) { if (!m.cared) S.downed.push(m); continue; }
      if (m.routed || m.you || m.fists) continue;
      m.sqd = S;
      S.men.push(m);
      if (m.launcher) S.hasAT = true;
      if (m.reloadT > 0) reloading++;
      if (m.magSize && m.mag < m.magSize * 0.3) ammoLow++;
    }
    S.reloading = reloading;
    if (n0 > S.n0) S.n0 = n0;
    S.alive = S.men.length;
    if (!S.alive) { S.task = "gone"; S.leader = null; return; }
    // ---- the leader
    const L0 = S.leader;
    if (!L0 || L0.dead || L0.routed || L0.downed || L0.fled || L0.surrendered || S.men.indexOf(L0) < 0) {
      if (L0 && (L0.dead || L0.downed)) {
        S.shock = Math.min(0.6, S.shock + K.SHOCK_LEADER);
        STATS.leadersLost++;
        for (let i = 0; i < S.men.length; i++) S.men[i].supp = Math.min(1.2, (S.men[i].supp || 0) + 0.25);
        S.leaderlessT = now + 2.5;
      }
      S.leader = S.men[0];
    }
    const L = S.leader;
    for (let i = 0; i < S.men.length; i++) S.men[i].leader = S.men[i] === L;
    // ---- fire teams: alpha with the leader, bravo the rest, stable by slot
    S.ft[0].length = 0; S.ft[1].length = 0;
    const two = S.alive >= 4;
    let k = 0;
    for (let i = 0; i < S.men.length; i++) {
      const m = S.men[i];
      if (m === L) { m.ft = 0; S.ft[0].push(m); continue; }
      m.ft = two ? (k++ & 1) : 0;
      S.ft[m.ft].push(m);
    }
    // ---- where it is, how hard it is being hit
    let cx = 0, cz = 0, sp = 0;
    let pinnedN = 0;
    for (let i = 0; i < S.men.length; i++) {
      const m = S.men[i]; cx += m.pos.x; cz += m.pos.z; sp += Math.min(1.2, m.supp || 0);
      if ((m.supp || 0) > 0.6) pinnedN++;
    }
    S.cx = cx / S.alive; S.cz = cz / S.alive; S.supp = sp / S.alive;
    // suppression is all-or-nothing per man: count the men it has put down
    S.pinFrac = pinnedN / S.alive;
    platoonSlot(S, A, now);
    S.shock = Math.max(0, S.shock - K.SHOCK_DECAY * (now - (S.lastTick || now)));
    S.lastTick = now;
    // ---- what it knows: every member's mark, and what is shooting at it
    let best = null, bs = 0, bestVis = null, bvs = 0, beastS = 0, allS = 0, seen = false;
    S.hasArmour = false;
    const enemyArmour = [];
    for (let i = 0; i < S.men.length; i++) {
      const m = S.men[i], o = m.tgt;
      if (!o || out(o)) continue;
      if (m.sees) seen = true;
      const sc = threat(S, o, A);
      allS += sc; if (o.beast) beastS += sc;
      if (armedArmour(o)) enemyArmour.push(o);
      if (sc > bs) { bs = sc; best = o; }
      if (m.sees && sc > bvs) { bvs = sc; bestVis = o; }
    }
    // armour nobody is targeting is still a threat the squad knows about
    if (A.vehicles) {
      const ev = A.vehicles(A.enemyTeam(S.team));
      for (let i = 0; i < ev.length; i++) {
        const v = ev[i];
        if (v.dead || v.air) continue;
        const d = Math.hypot(v.pos.x - S.cx, v.pos.z - S.cz);
        if (d < 260 && armedArmour(v)) { S.hasArmour = true; if (enemyArmour.indexOf(v) < 0) enemyArmour.push(v); }
        if (d < 200) { const sc = threat(S, v, A); if (sc > bs) { bs = sc; best = v; } }
      }
    }
    S.enemyArmour = enemyArmour;
    S.threatTop = best;
    if (bestVis !== S.focus) { if (bestVis) STATS.focusSwitch++; S.focus = bestVis; }
    S.beastShare = allS > 0 ? beastS / allS : 0;
    // contact: somebody sees somebody, or the squad is taking fire
    let armourNear = false;
    for (let i = 0; i < enemyArmour.length; i++) {
      const v = enemyArmour[i];
      if (Math.hypot(v.pos.x - S.cx, v.pos.z - S.cz) < 150) { armourNear = true; break; }
    }
    if (seen || S.supp > 0.25 || armourNear) S.lastContact = now;
    if (seen) S.lastSeen = now;
    const blind = now - (S.lastSeen == null ? -99 : S.lastSeen);
    const contact = now - S.lastContact < K.CONTACT_HOLD;
    // ---- morale of the squad
    const lostF = S.n0 ? (S.n0 - S.alive - S.downed.length * 0.5) / S.n0 : 0;
    const odds = A.odds ? A.odds(S.team) : 1;
    S.morale = Math.max(0, Math.min(1, 1 - lostF * 1.1 - S.shock - S.supp * 0.32 - Math.min(0.3, S.pinnedT * 0.012) + (odds - 1) * 0.12));

    // ---- the decision
    const enemy = A.enemyCOM(S.team);
    const tgtRef = S.focus || best;
    const tx = tgtRef ? tgtRef.pos.x : enemy.x, tz = tgtRef ? tgtRef.pos.z : enemy.z;
    const dEnemy = Math.hypot(tx - S.cx, tz - S.cz);
    const holding = A.order(S.team) === "hold" && !A.enemyBroken(S.team);
    const hunting = A.hunting(S.team);
    const band = bandOf(S);
    // escort: a friendly armoured vehicle near, and nobody else riding it
    S.escort = null;
    if (A.vehicles && !holding) {
      const fv = A.vehicles(S.team);
      let bd = 70;
      for (let i = 0; i < fv.length; i++) {
        const v = fv[i];
        if (v.dead || v.air || !armoured(v)) continue;
        const d = Math.hypot(v.pos.x - S.cx, v.pos.z - S.cz);
        if (d < bd && (!v._escortBy || v._escortBy === S || v._escortBy.task === "gone" || now - (v._escortT || 0) > 3)) { bd = d; S.escort = v; }
      }
      if (S.escort) { S.escort._escortBy = S; S.escort._escortT = now; }
    }

    let task = S.task;
    if (S.beastShare > 0.5 && contact) task = "drill";
    else if (!contact) task = S.fellBack && S.morale < 0.62 ? "hold" : S.escort ? "screen" : holding ? "hold" : "march";
    else {
      // contact
      const fbHold = task === "hold" && S.fellBack;
      if (fbHold && S.morale > 0.62 && now - S.taskT > 15) { S.fellBack = false; S.holdAnchor = null; task = "fight"; }
      else if (!fbHold && (task === "march" || task === "screen" || task === "hold" || task === "drill" || task === "gone")) {
        task = holding ? "hold" : S.escort ? "screen" : dEnemy > band + K.ENGAGE_PAD ? "bound" : "fight";
      }
      if (holding && task !== "pinned" && task !== "fallback" && task !== "hold" && task !== "drill") task = "hold";
      // pinned: the fire on it is heavy, or half its men are flat under it
      const pinned = (S.supp > K.PIN_SUPP || (S.pinFrac >= 0.4 && S.alive >= 2)) && !hunting;
      if (task !== "pinned" && pinned && task !== "fallback") task = "pinned";
      if (task === "pinned") {
        if (S.supp < K.PIN_OUT && S.pinFrac < 0.25) { S.pinOutT += now - (S.prevTick || now); if (S.pinOutT > 1.6) { task = holding ? "hold" : dEnemy > band + K.ENGAGE_PAD ? "bound" : "fight"; S.pinOutT = 0; } }
        else S.pinOutT = 0;
      }
      if (S.morale < K.FALLBACK_MORALE && !hunting && task !== "fallback" && (task !== "hold" || S.morale < K.FALLBACK_MORALE * 0.6)) {
        task = "fallback";
        S.fallbackTo = null;
      }
      if (task === "fallback" && S.fallbackTo && Math.hypot(S.cx - S.fallbackTo.x, S.cz - S.fallbackTo.z) < 6) {
        task = "hold"; S.anchor = { x: S.fallbackTo.x, z: S.fallbackTo.z }; S.holdAnchor = S.anchor; S.fellBack = true;
        S.shock = Math.max(0, S.shock - 0.15);           // the squad steadies on good ground
      }
      if (task === "fallback" && S.morale > K.FALLBACK_MORALE + 0.25) task = "fight";
      // armour and no rockets: get out of its way rather than trade rifle ball with plate
      if (enemyArmour.length && !S.hasAT && !S.escort && task !== "fallback" && task !== "pinned") {
        const v = enemyArmour[0];
        const dv = Math.hypot(v.pos.x - S.cx, v.pos.z - S.cz);
        if (dv < 120 && !(S.focus && !armoured(S.focus) && Math.hypot(S.focus.pos.x - S.cx, S.focus.pos.z - S.cz) < 60)) task = "fallback";
      }
      // a bound ends in a fight only where the squad can SEE the enemy — and
      // a squad that is SEEN and shot at inside its guns' reach does not keep
      // running across the open to a better range: it goes down and fights
      if (task === "bound" && blind < 3 && (dEnemy <= band + K.ENGAGE_PAD * 0.4 || (S.supp > 0.12 && dEnemy <= band * 2.1))) task = "fight";
      if (task === "bound" && dEnemy < 18 && blind > 3) task = "assault";      // blind and on top of them: go in
      if (task === "fight" && !holding) {
        if (hunting || A.enemyBroken(S.team)) task = "assault";
        // a base of fire that cannot see anything is not one: move to find the shot
        else if (blind > 5 && now - S.taskT > 4) task = "bound";
        else if (dEnemy < K.ASSAULT_D && odds > K.ASSAULT_ODDS && S.supp < 0.4) task = "assault";
        // a flank goes round an enemy that is FIXED (kept down by our fire),
        // never round one that is free to turn and shoot the men in the open
        else if (two && now - S.taskT > 6 && odds > K.FLANK_ODDS && S.supp < 0.45 && S.morale > 0.55 && dEnemy < band * 2.2 &&
          S.focus && ((S.focus.supp || 0) > 0.35 || S.focus.stance === "prone" || S.focus.routed)) {
          task = "flank"; S.flankSide = pickFlankSide(S, A, tx, tz); S.flankFrom = { x: tx, z: tz };
        }
        else if (dEnemy > band + K.ENGAGE_PAD * 1.6 && S.supp < 0.35) task = "bound";
      }
      if (task === "flank" && (now - S.taskT > K.FLANK_MAX_T || !two || S.supp > 0.6)) task = "fight";
      if (task === "assault" && !hunting && odds < 1.1 && S.supp > 0.5) task = "fight";
      if (task === "screen" && (!S.escort || S.escort.dead)) task = "bound";
    }
    if (task !== S.task) setTask(S, task, A);
    S.prevTick = now;
    if (S.task === "pinned") S.pinnedT += K.SQUAD_TICK[0]; else S.pinnedT = Math.max(0, S.pinnedT - 1);

    // ---- facing and formation
    let fx = tx - S.cx, fz = tz - S.cz;
    const fl = Math.hypot(fx, fz) || 1;
    S.face.x = fx / fl; S.face.z = fz / fl;
    S.form = S.task === "march" ? (Math.hypot(enemy.x - S.cx, enemy.z - S.cz) > K.DEPLOY_R ? "column" : "wedge") :
      S.task === "drill" ? "drill" : "line";

    // ---- posts
    assignPosts(S, A, tx, tz, dEnemy, band, now);
    // ---- focus fire: the best visible threat, to ~60% of the guns
    if (S.focus && S.task !== "march") {
      let onF = 0;
      for (let i = 0; i < S.men.length; i++) if (S.men[i].tgt === S.focus) onF++;
      const cap = Math.ceil(S.alive * K.FOCUS_SHARE);
      for (let i = 0; i < S.men.length && onF < cap; i++) {
        const m = S.men[i];
        if (m.tgt === S.focus || m.launcher) continue;
        // rifle ball does not go through plate: the focus has to be something he can hurt
        if (armoured(S.focus)) continue;
        // a man already duelling something close keeps it, and a man with a
        // mark he can see switches only for something that matters more (each
        // switch costs him his reaction and his settle: combat_iq's aimTick)
        if (m.tgt && !out(m.tgt) && Math.hypot(m.tgt.pos.x - m.pos.x, m.tgt.pos.z - m.pos.z) < 20) continue;
        if (m.tgt && !out(m.tgt) && m.sees && threat(S, m.tgt, A) * 1.6 > bvs) continue;
        m.focus = S.focus; onF++;
      }
    }
    // the rockets go to the armour
    if (S.hasAT && enemyArmour.length) {
      for (let i = 0; i < S.men.length; i++) {
        const m = S.men[i];
        if (!m.launcher) continue;
        let bv = null, bd = 1e9;
        for (let j = 0; j < enemyArmour.length; j++) {
          const v = enemyArmour[j]; if (v.dead) continue;
          const d = Math.hypot(v.pos.x - m.pos.x, v.pos.z - m.pos.z);
          if (d < bd) { bd = d; bv = v; }
        }
        if (bv && bd < 220) m.focus = bv;
      }
    }
    // ---- a grenade into cover
    if (S.task !== "march" && S.task !== "screen" && now > S.nadeT) pickNade(S, A, now);
    // ---- the wounded: the nearest healthy man goes for him
    if (S.downed.length && S.supp < K.DRAG_SUPP && S.task !== "assault" && S.task !== "march") pickDrag(S, A);
    // ---- per-man task
    for (let i = 0; i < S.men.length; i++) {
      const m = S.men[i];
      if (m.dragTgt && (m.dragTgt.dead || !m.dragTgt.downed || m.dragTgt.cared)) m.dragTgt = null;
      m.task = manTask(S, m, now);
    }
    if (A.clock) {
      const ms = A.clock() - t0, C = COST[SQ_COST[S.tier | 0] || "sqFull"];
      COST.squad.n++; COST.squad.ms += ms; C.n++; C.ms += ms;
    }
  }

  /* THE PLATOON: a side's squads fight SIDE BY SIDE, not one behind another
     (the spawn grid stands them in file, and a squad whose line is behind a
     mate's has nothing to shoot but the backs of its own). Each live squad
     gets a sector of the side's front, ordered by its index: S.latErr is how
     far it is from its sector across the axis of the attack, S.depErr how
     far ahead of / behind its line (a front wider than MAX_FRONT puts the
     rest in a second line, a reserve 40 m back). Re-solved twice a second. */
  const PLT = { red: { at: -9, keys: null }, blue: { at: -9, keys: null } };
  const MAX_FRONT = 320, ROW_DEPTH = 40;
  function platoonSlot(S, A, now) {
    const hd = A.homeDir(S.team);
    const fx = -hd.x, fz = -hd.z, rx = fz, rz = -fx;
    S.rx = rx; S.rz = rz; S.fwdx = fx; S.fwdz = fz;
    const P = PLT[S.team] || (PLT[S.team] = { at: -9, keys: null });
    if (now - P.at > 0.5 || !P.keys) {
      P.at = now;
      const L = [];
      SQ.forEach(function (o) { if (o.team === S.team && o.alive > 0 && o.task !== "gone") L.push(o); });
      L.sort(function (a, b) { return a.idx - b.idx; });
      let lat = 0, dep = 0, front = 0;
      const w = L.map(function (o) { return Math.max(16, o.alive * 4.2); });
      for (let i = 0; i < L.length; i++) { lat += L[i].cx * rx + L[i].cz * rz; dep += L[i].cx * fx + L[i].cz * fz; }
      lat /= Math.max(1, L.length); dep /= Math.max(1, L.length);
      P.keys = new Map();
      // rows of at most MAX_FRONT
      let i = 0, row = 0;
      while (i < L.length) {
        let j = i, wsum = 0;
        while (j < L.length && (wsum + w[j] <= MAX_FRONT || j === i)) { wsum += w[j]; j++; }
        let x = -wsum / 2;
        for (let k = i; k < j; k++) { P.keys.set(L[k].key, { lat: lat + x + w[k] / 2, row }); x += w[k]; }
        i = j; row++;
      }
      P.dep = dep;
    }
    const me = P.keys.get(S.key);
    if (!me) { S.latErr = 0; S.depErr = 0; S.row = 0; return; }
    S.row = me.row;
    S.latErr = Math.max(-30, Math.min(30, me.lat - (S.cx * rx + S.cz * rz)));
    S.depErr = me.row ? Math.max(-30, Math.min(0, (P.dep - me.row * ROW_DEPTH) - (S.cx * fx + S.cz * fz))) : 0;
  }

  /* the squad's fighting distance: past the top of its guns' band by a third
     (combat_iq's band is the distance a man's hit chance is still worth the
     round; a squad deploys a little outside it and closes by bounds) */
  function bandOf(S) {
    let n = 0, s = 0;
    const IQ = CBZ.combatIQ;
    for (let i = 0; i < S.men.length; i++) {
      const m = S.men[i];
      const b = IQ && IQ.band ? IQ.band(m) : null;
      if (b && b.hi > 0) { s += b.hi * 1.3; n++; continue; }
      const c = wclass(m);
      s += c === "marksman" ? 60 : c === "mg" ? 31 : c === "at" ? 60 : c === "cqb" ? 20 : 34; n++;
    }
    return n ? s / n : 34;
  }
  function pickFlankSide(S, A, tx, tz) {
    // the side with more boxes, else the side away from the nearest friendly squad's line
    const rx = S.face.z, rz = -S.face.x;
    let l = 0, r = 0;
    const midx = (S.cx + tx) * 0.5, midz = (S.cz + tz) * 0.5;
    const cl = coverCands(A, midx - rx * 30, midz - rz * 30, 22);
    l = cl.length;
    const cr = coverCands(A, midx + rx * 30, midz + rz * 30, 22);
    r = cr.length;
    if (l !== r) return r > l ? 1 : -1;
    return (S.idx & 1) ? 1 : -1;
  }

  function assignPosts(S, A, tx, tz, dEnemy, band, now) {
    const t = S.task;
    _taken.length = 0;
    _foldBudget = FOLDS[S.tier | 0] || 0;
    const sp = K.SPACING[S.form] || 5;
    if (t === "march" || t === "gone") {
      for (let i = 0; i < S.men.length; i++) S.men[i].post = null;   // formation, computed live
      S.anchor = null;
      return;
    }
    const fx = S.face.x, fz = S.face.z;
    if (t === "screen" && S.escort) {
      // the rear quarters of the hull, and in contact the lee of it
      const v = S.escort, h = v.h || 0;
      const vx = Math.sin(h), vz = Math.cos(h);
      const back = (v.vlen || 4) + 5;
      for (let i = 0; i < S.men.length; i++) {
        const m = S.men[i];
        const side = (i & 1) ? 1 : -1, row = (i >> 1);
        const off = side * ((v.vwid || 1.8) + 2.5 + (row % 3) * 3.2);
        const bk = back + (row / 3 | 0) * 4 + row * 1.2;
        const px = v.pos.x - vx * bk + vz * off, pz = v.pos.z - vz * bk - vx * off;
        m.post = { x: px, z: pz, px, pz, low: true, kind: "hull" };
      }
      return;
    }
    if (t === "drill") {
      // a firing line across the animals' approach, held where it stands
      if (!S.anchor || S.postsDirty || Math.hypot(S.anchor.x - S.cx, S.anchor.z - S.cz) > 18) S.anchor = { x: S.cx, z: S.cz };
      linePosts(A, S, S.men, S.anchor.x, S.anchor.z, tx, tz, K.SPACING.drill, false);
      S.postsDirty = false;
      return;
    }
    if (t === "pinned") {
      // where he lies, unless a box is a few metres off
      const cols = coverCands(A, S.cx, S.cz, 12);
      for (let i = 0; i < S.men.length; i++) {
        const m = S.men[i];
        const p = postAt(A, S, m, m.pos.x, m.pos.z, tx, tz, cols, true);
        if (Math.hypot(p.x - m.pos.x, p.z - m.pos.z) > 7) m.post = { x: m.pos.x, z: m.pos.z, px: m.pos.x, pz: m.pos.z, low: true, kind: "open" };
        else m.post = p;
      }
      return;
    }
    if (t === "fallback") {
      if (!S.fallbackTo) {
        const hd = A.homeDir(S.team);
        // straight back, a little off the threat axis toward home
        let bx = S.cx - fx * K.FALLBACK_DIST * 0.6 + hd.x * K.FALLBACK_DIST * 0.6;
        let bz = S.cz - fz * K.FALLBACK_DIST * 0.6 + hd.z * K.FALLBACK_DIST * 0.6;
        // the best ground near there: the most boxes, or a crest
        const cols = coverCands(A, bx, bz, 16);
        if (cols.length) {
          let gx = 0, gz = 0, n = 0;
          for (let i = 0; i < cols.length && n < 6; i++) { const c = cols[i]; if (c.minX == null) continue; gx += (c.minX + c.maxX) / 2; gz += (c.minZ + c.maxZ) / 2; n++; }
          if (n) { bx = gx / n - fx * 1.5; bz = gz / n - fz * 1.5; }
        } else if (A.fold && A.host && A.host.terrainLos) {
          const f = A.fold(bx, bz, tx, tz);
          if (f) { bx = f.x; bz = f.z; }
        }
        S.fallbackTo = { x: bx, z: bz };
        S.postsDirty = true;
      }
      if (S.postsDirty) {
        // one team goes first, the other covers from where it is
        linePosts(A, S, S.men, S.fallbackTo.x, S.fallbackTo.z, tx, tz, sp, true);
        S.postsDirty = false;
        S.mover = 0; S.moverT = now;
      }
      boundClock(S, now, true);
      return;
    }
    if (t === "hold") {
      const home = S.holdAnchor || holdAnchorOf(S);
      S.anchor = home;
      if (S.postsDirty || !S.postedAt || now - S.postedAt > 12) {
        if (S.fellBack) linePosts(A, S, S.men, home.x, home.z, tx, tz, sp, true);
        else {
          // a held line is held where each man formed: his own spot, or the
          // nearest box / fold to it
          const cols = coverCands(A, home.x, home.z, 34);
          for (let i = 0; i < S.men.length; i++) {
            const m = S.men[i], h = m.home || m.pos;
            m.post = postAt(A, S, m, h.x, h.z, tx, tz, cols, true);
          }
        }
        S.postedAt = now; S.postsDirty = false;
      }
      return;
    }
    if (t === "fight") {
      // where it stands, slid toward its own sector of the side's front
      if (!S.anchor || S.postsDirty) {
        const sl = (S.latErr || 0) * 0.8, sd = S.depErr || 0;
        const p = coverPull(A, S.cx + (S.rx || 0) * sl + (S.fwdx || 0) * sd, S.cz + (S.rz || 0) * sl + (S.fwdz || 0) * sd, tx, tz, 22);
        S.anchor = { x: p.x, z: p.z };
      }
      if (S.postsDirty || !S.postedAt || now - S.postedAt > 10) {
        linePosts(A, S, S.men, S.anchor.x, S.anchor.z, tx, tz, sp, true);
        S.postedAt = now; S.postsDirty = false;
      }
      return;
    }
    if (t === "assault") {
      // short rushes at the enemy, each man toward his own bearing
      for (let i = 0; i < S.men.length; i++) {
        const m = S.men[i];
        const o = (m.tgt && !out(m.tgt)) ? m.tgt : (S.focus || null);
        const ox = o ? o.pos.x : tx, oz = o ? o.pos.z : tz;
        const dx = ox - m.pos.x, dz = oz - m.pos.z, d = Math.hypot(dx, dz) || 1;
        const step = Math.min(d - 3, 14);
        const lat = ((i % 5) - 2) * 2.2;
        const px = m.pos.x + dx / d * step + (dz / d) * lat, pz = m.pos.z + dz / d * step - (dx / d) * lat;
        m.post = { x: px, z: pz, px, pz, low: true, kind: "open" };
      }
      return;
    }
    if (t === "bound" || t === "flank") {
      boundClock(S, now, false);
      if (S.postsDirty) {
        const mv = S.mover, ow = 1 - mv;
        const movers = t === "flank" ? S.ft[1] : S.ft[mv];
        const watch = t === "flank" ? S.ft[0] : S.ft[ow];
        // overwatch: cover where it stands
        if (watch.length) {
          let wx = 0, wz = 0;
          for (let i = 0; i < watch.length; i++) { wx += watch[i].pos.x; wz += watch[i].pos.z; }
          wx /= watch.length; wz /= watch.length;
          linePosts(A, S, watch, wx, wz, tx, tz, sp, true);
        }
        // movers: the next bound, shorter under fire
        if (movers.length) {
          let mx = 0, mz = 0;
          for (let i = 0; i < movers.length; i++) { mx += movers[i].pos.x; mz += movers[i].pos.z; }
          mx /= movers.length; mz /= movers.length;
          let gx, gz;
          if (t === "flank") {
            // swing round the enemy on the chosen side, at the band's edge
            const ang = Math.atan2(S.cx - tx, S.cz - tz) + S.flankSide * K.FLANK_ANG;
            const r = Math.max(band * 0.8, 30);
            const fxp = tx + Math.sin(ang) * r, fzp = tz + Math.cos(ang) * r;
            const dd = Math.hypot(fxp - mx, fzp - mz) || 1;
            const step = Math.min(dd, K.BOUND_MAX);
            gx = mx + (fxp - mx) / dd * step; gz = mz + (fzp - mz) / dd * step;
          } else {
            const len = Math.max(K.BOUND_MIN, Math.min(K.BOUND_MAX, K.BOUND_MAX - S.supp * 22, dEnemy - band));
            // move up level with or a little past the overwatch, toward the enemy
            gx = mx + fx * len; gz = mz + fz * len;
            // ...and across toward its sector of the front, back to its row
            const sl = (S.latErr || 0) * 0.8, sd = S.depErr || 0;
            gx += (S.rx || 0) * sl + (S.fwdx || 0) * sd; gz += (S.rz || 0) * sl + (S.fwdz || 0) * sd;
          }
          const p = coverPull(A, gx, gz, tx, tz, 16);
          linePosts(A, S, movers, p.x, p.z, tx, tz, sp, true);
        }
        S.postsDirty = false;
      }
    }
  }
  function holdAnchorOf(S) {
    // where the line formed: the mean of the men's homes
    let x = 0, z = 0, n = 0;
    for (let i = 0; i < S.men.length; i++) { const h = S.men[i].home; if (h) { x += h.x; z += h.z; n++; } }
    S.holdAnchor = n ? { x: x / n, z: z / n } : { x: S.cx, z: S.cz };
    return S.holdAnchor;
  }
  // the bound swaps when the movers are down at their posts, or after BOUND_T
  function boundClock(S, now, back) {
    const movers = S.task === "flank" ? S.ft[1] : S.ft[S.mover];
    let there = 0;
    for (let i = 0; i < movers.length; i++) {
      const m = movers[i], p = m.post;
      if (!p || Math.hypot(p.x - m.pos.x, p.z - m.pos.z) < 2.2) there++;
    }
    const done = movers.length === 0 || there >= Math.ceil(movers.length * 0.75);
    if ((done && now - S.moverT > 1.5) || now - S.moverT > K.BOUND_T) {
      if (S.task === "flank") {
        if (done) { S.postsDirty = true; S.moverT = now; }
        return;
      }
      if (back) {
        // fallback: once both teams have gone, it is a hold
        S.mover = 1 - S.mover; S.moverT = now;
        return;
      }
      S.mover = S.ft[1].length ? 1 - S.mover : 0;
      S.moverT = now; S.postsDirty = true;
    }
  }

  function manTask(S, m, now) {
    const t = S.task;
    if (m.dragTgt) return "drag";
    if (t === "bound") return m.ft === S.mover && S.ft[1].length ? "rush" : "overwatch";
    if (t === "flank") return m.ft === 1 ? "rush" : "overwatch";
    if (t === "fallback") return (m.ft === S.mover || !S.ft[1].length) ? "withdraw" : "overwatch";
    return t;          // march, screen, fight, hold, assault, pinned, drill
  }

  function pickNade(S, A, now) {
    // somebody in the squad with a grenade, an enemy in cover inside a throw
    for (let i = 0; i < S.men.length; i++) {
      const m = S.men[i];
      if (!(m.nades > 0) || m.reloadT > 0 || m.wantNade || m.dragTgt) continue;
      const o = m.tgt && !out(m.tgt) ? m.tgt : S.focus;
      if (!o || o.vehicle || o.beast || out(o)) continue;
      const d = Math.hypot(o.pos.x - m.pos.x, o.pos.z - m.pos.z);
      if (d < K.NADE_MIN || d > K.NADE_MAX) continue;
      // only into cover: a man you can shoot gets shot
      const inCover = o.inCover || o.stance === "prone" || o.slot === "hull" || o.slot === "cover" || !m.sees;
      if (!inCover) continue;
      // and never onto one of ours
      const a = A.near(o.pos.x, o.pos.z, K.NADE_SAFE, _near);
      let mate = false, foes = 0;
      for (let j = 0; j < a.length; j++) {
        const b = a[j];
        if (b.dead) continue;
        if (b.team === m.team) { mate = true; break; }
        if (!out(b)) foes++;
      }
      if (mate) continue;
      m.wantNade = o;
      S.nadeT = now + K.NADE_GAP + hash01(m, 0x9ADE) * 3;
      STATS.nades++;
      return;
    }
  }
  function pickDrag(S, A) {
    for (let d = 0; d < S.downed.length; d++) {
      const w = S.downed[d];
      if (w._dragBy && !w._dragBy.dead && w._dragBy.dragTgt === w) continue;
      let best = null, bd = K.DRAG_R;
      for (let i = 0; i < S.men.length; i++) {
        const m = S.men[i];
        if (m.dragTgt || (m === S.leader && S.alive > 3) || m.reloadT > 0 || (m.supp || 0) > 0.55) continue;
        const dd = Math.hypot(w.pos.x - m.pos.x, w.pos.z - m.pos.z);
        if (dd < bd) { bd = dd; best = m; }
      }
      if (best) { best.dragTgt = w; w._dragBy = best; STATS.drags++; }
    }
  }

  /* somewhere to drag a wounded man: the nearest cover behind (x, z) from the
     threat at (tx, tz), else the terrain's fold, else ten metres rearward. */
  function safeSpot(A, x, z, tx, tz, hd) {
    _taken.length = 0;
    _foldBudget = 1;
    const dx = x + hd.x * 10, dz = z + hd.z * 10;
    const cols = coverCands(A, dx, dz, K.COVER_R + 4);
    return postAt(A, null, null, dx, dz, tx, tz, cols, true);
  }

  // the post a man is heading for, or his formation slot on the march (live)
  const _pf = { x: 0, z: 0 };
  function postFor(m) {
    const S = m.sqd;
    if (m.post) { _pf.x = m.post.x; _pf.z = m.post.z; return _pf; }
    if (!S || !S.leader || S.leader === m) return null;
    // formation slot behind the leader, in the leader's travel frame
    const L = S.leader;
    let hx = L.target.x - L.pos.x, hz = L.target.z - L.pos.z;
    let hl = Math.hypot(hx, hz);
    if (hl < 0.5) { hx = S.face.x; hz = S.face.z; hl = 1; }
    hx /= hl; hz /= hl;
    const idx = S.men.indexOf(m);
    const f = formSlot(S.form, idx < 0 ? 1 : idx, K.SPACING[S.form] || 5);
    _pf.x = L.pos.x + hz * f.r - hx * f.b;
    _pf.z = L.pos.z - hx * f.r - hz * f.b;
    return _pf;
  }

  function stats() {
    const sq = { march: 0, bound: 0, fight: 0, flank: 0, assault: 0, pinned: 0, fallback: 0, hold: 0, drill: 0, screen: 0, gone: 0 };
    SQ.forEach(function (S) { sq[S.task] = (sq[S.task] || 0) + 1; });
    const c = {};
    for (const k in COST) c[k] = { n: COST[k].n, ms: Math.round(COST[k].ms * 100) / 100, per: COST[k].n ? Math.round(COST[k].ms / COST[k].n * 1000) / 1000 : 0 };
    return Object.assign({}, STATS, { surrendered: Object.assign({}, STATS.surrendered), squads: sq, cost: c });
  }
  function resetStats() {
    for (const k in STATS) if (typeof STATS[k] === "number") STATS[k] = 0;
    STATS.surrendered = { red: 0, blue: 0 };
  }

  CBZ.battleTactics = { K, FORMS, formSlot, threat, make, tick, tierOf, reloadOK, postFor, safeSpot, armoured, wclass, out,
    COST, STATS, stats, reset: function () { reset(); resetStats(); }, squads: SQ, hash01 };
  if (typeof module !== "undefined" && module.exports) module.exports = CBZ.battleTactics;
})();
