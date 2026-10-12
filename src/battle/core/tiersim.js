/* ============================================================
   battle/core/tiersim.js — THE MID AND FAR SIMS. Every unit that is not a
   full rig near the lens is a row in the unit store (core/store.js), and
   this file is its brain, its legs and its trigger. Page-independent: no
   DOM, no THREE, no page globals. It runs in the page (in-process), in node
   (tools/npcwar-fidelity.mjs, tools/npcwar-scale-bench.mjs) and in a Web
   Worker (core/simworker.js) on the same code.

   THE CONTRACT (docs/npcwar/ARCHITECTURE.md §9): a battle fought by these
   tiers must come out the way the page's own full brain fights it: the same
   winner, the same casualties, the same time to decision, the same breaks.
   tools/npcwar-fidelity.mjs holds it, against the page's sim, in node.

   WHAT IS THE SAME (not modelled: the same rules, read from the same tables)
     the trigger   combat_iq's fire gate: reaction beat, aim settle, burst
                   rhythm, the derived damage, the hit chance with its
                   falloff, the running-target and suppression penalties;
                   the tables (ROLE, WEAP, TIER_DPS, DPS_CAP) and every
                   profile come from CBZ.combatIQ.profile() in the host,
                   never typed here
     the token     at most 2 guns on one mark (3 for elite / swat) hold the
                   fire token, 1450 ms a hold, point blank overrides it; the
                   rest tuck ("cover") or work an angle ("flank") and hold
                   their fire past 12 m, exactly stepMan's slot gate
     the lane      a man does not fire through his own man inside 12 m
                   (fire.js mateInLane): he steps off the line instead
     the page      the 1.45 hit multiplier, the 12% head (x2.2), the 2.2 m
                   near miss that rattles, CROUCH_HIT, stepMan's speeds per
                   slot, the hunt (3:1) and the hold (10 m leash)
     morale        systems/brain.js's morale constants (K) and per-man
                   formula; the host steps the ARMY (one army morale for
                   every tier) and hands it in; break, run, cornered last
                   stand, rally and flight are per man here
   WHAT IS CHEAPER
     MID  the individual brain on the page's own think cadence; target pick
          on a hashed grid (nearest four asked for a line, FOV 200 deg,
          touch 10 m), band goal on a held bearing, the squad's shared
          contact, separation on a fine grid, movement and fire every 0.1 s
          with exact accumulated time
     FAR  the squad decides: which enemy squad, where to stand, when to
          march; each man still holds his own mark (dealt round the target
          squad), his own token, his own line of sight (staggered), his own
          rhythm, magazine, reload, nerve and wounds. Updated every 0.25 s.
     both: shots are resolved in a BATCH at the end of the step, so the
          order the rows are walked in never decides who dies first.

   TIME SLICING. Rows are walked by a cursor in slices so every row is
   visited once per tier tick; a slice that runs past its budget (BUDGET
   frameMs, core/lod.js) stops and the next visit carries the exact elapsed
   time (fire cooldowns and movement integrate it), so a slow machine runs
   the same battle at a coarser step, never a different one.

   HOOKS (the AI agent's seam): T.brain.mid / T.brain.far may be replaced by
   functions (T, row, now, dt) -> void that set the goal/slot/target columns;
   T.tick(tier, budgetMs) runs one tier's slice on its own. Default brains
   are the ones in this file.

   PUBLIC  CBZ.battleTierSim.create(S, cfg) -> T
     T.profile(spec) -> profile index       (spec from CBZ.combatIQ.profile)
     T.addUnit(row, prof, spawnI, nerve, weight, homeX, homeZ)
     cfg.groundAt(x, z)                      optional, in-page: the ground when
                                            there is no sampled cfg.ground grid
     T.squads()                             rebuild squad lists from S.squad
     T.step(dt, ctx)                        ctx: { morale:[a,b], hunt:[a,b],
                                            hold:[a,b], broken:[a,b], com:[ax,az,bx,bz],
                                            cam:[x,z], visR, crowd }
     T.hurt(row, dmg, byRow, head)          a FULL unit's round landed on a row
     T.events (Float32Array), T.nEv         [type, a, b, v] x nEv, see EV
     T.ms {hash, mid, far, hits}, T.stats
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : globalThis);
  const CBZ = W.CBZ || (W.CBZ = {});
  const now = (typeof performance !== "undefined" && performance.now) ? function () { return performance.now(); } : function () { return Date.now(); };
  const TIER = { full: 0, mid: 1, far: 2 };
  const LIFE = { free: 0, alive: 1, routed: 2, fled: 3, dead: 4 };
  const EV = { kill: 1, hitFull: 2, shot: 3, fled: 4, rout: 5, rally: 6 };
  // slots (stepMan's names): which ones may fire past 12 m
  const SL = { march: 0, fire: 1, cover: 2, flank: 3, push: 4, rout: 5, fallback: 6, side: 7, hull: 8 };
  const FIRES = [0, 1, 0, 0, 1, 0, 0, 1, 1];
  const SIGHT = 175, FOV_COS = Math.cos(1.75), TOUCH = 10;
  const PAGE_DMG = 1.45, HEAD_P = 0.12, HEAD_K = 2.2, CROUCH_HIT = 0.5;
  const TAU = Math.PI * 2;

  function create(S, cfg) {
    cfg = cfg || {};
    const MK = cfg.morale || { SUPP_CAP: 1.2, SUPP_HIT: 0.4, SUPP_SNAP: 0.26, SUPP_MATE: 0.22, SUPP_DECAY: 0.28,
      SUPP_K: 0.16, WOUND_K: 0.28, RALLY_BAND: 0.16, FLEE_GAPS: 2.2 };
    const SPREAD = cfg.spread || { _def: 0.055 };
    const TICK = Object.assign({ mid: 0.1, far: 0.25, squad: 1.0, los: 1.0, hash: 0.1, march: 1.0 }, cfg.tick || {});
    const BUD = Object.assign({ mid: 2.5, far: 1.5 }, cfg.budgetMs || {});
    const CAL = Object.assign({ far: 1, mid: 1 }, cfg.cal || {});
    const gap = cfg.gap || 150;
    const ground = cfg.ground || null;          // { x0, z0, cell, w, h, hgt }
    const terrainLos = !!cfg.terrainLos && !!ground;
    const nav = cfg.nav || null;                 // { x0, z0, cell, w, h, block }
    let seed = (cfg.seed | 0) || 0x2545F491;
    function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
    // combat_iq's per-person trait: CBZ.hash01 when the world has one, else the
    // 0.5 combat_iq itself falls back to (the shipped game has none, so 0.5 IS
    // the page's number). Read here so the same answer is given.
    const hash01 = CBZ.hash01 || null;
    function trait(r, salt) { return hash01 ? hash01(C.hx[r], C.hz[r], salt) : 0.5; }

    // ---------------------------------------------------------------- columns
    const C = S.cols;
    function cols() {
      S.col("prof", Uint8Array); S.col("spawnI", Int32Array); S.col("nerve", Float32Array); S.col("mw", Float32Array);
      S.col("tgt", Int32Array, -1); S.col("cool", Float32Array); S.col("mag", Float32Array); S.col("reloadT", Float32Array);
      S.col("react", Float32Array); S.col("aimT", Float32Array); S.col("burst", Int16Array); S.col("aimOn", Int32Array, -1);
      S.col("supp", Float32Array); S.col("iqs", Float32Array); S.col("slot", Uint8Array); S.col("thinkAt", Float32Array);
      S.col("lastT", Float32Array); S.col("gx", Float32Array); S.col("gz", Float32Array);
      S.col("routT", Float32Array); S.col("routBest", Float32Array); S.col("routStall", Float32Array); S.col("rallyT", Float32Array);
      S.col("hx", Float32Array); S.col("hz", Float32Array); S.col("spd", Float32Array); S.col("crouch", Uint8Array);
      S.col("losBad", Float32Array); S.col("sees", Uint8Array); S.col("losAt", Float32Array); S.col("losT", Float32Array); S.col("thinkLast", Float32Array);
      S.col("tok0", Int32Array, -1); S.col("tok1", Int32Array, -1); S.col("tok2", Int32Array, -1);
      S.col("tu0", Float32Array); S.col("tu1", Float32Array); S.col("tu2", Float32Array);
      S.col("iqTgt", Int32Array, -1); S.col("sideT", Float32Array); S.col("bear", Float32Array);
      S.col("sq", Int32Array, -1); S.col("sqSlot", Uint8Array);
      S.col("bslot", Int16Array); S.col("bslotT", Int32Array, -1); S.col("pkN", Int16Array);
      S.col("hullX", Float32Array, NaN); S.col("hullZ", Float32Array); S.col("hullT", Float32Array);
      S.col("popT", Float32Array); S.col("up", Uint8Array, 1);
      // a force's order (a host that fields forces: Gang City). oK 0 = the side's
      // order; 1 hold / 2 move / 4 withdraw = his home (hx, hz) is where he
      // goes and stays; 3 attack = march on (oX, oZ) instead of the enemy's centre
      S.col("oK", Uint8Array); S.col("oX", Float32Array); S.col("oZ", Float32Array);
    }
    cols();
    const T = { S: S, profs: [], nEv: 0, events: new Float32Array(4096 * 4), ms: { hash: 0, mid: 0, far: 0, hits: 0, squads: 0 },
      stats: { shots: [0, 0], hits: [0, 0], kills: [0, 0], fled: [0, 0], thinks: 0, los: 0 }, simT: 0,
      brain: { mid: null, far: null }, cal: CAL, gate: { nosee: 0, far: 0, slot: 0, down: 0, ready: 0, lane: 0, react: 0, fire: 0 } };
    // a slow tick: every sim second counts what each tier spent
    let G;   // re-read after a grow
    function bind() { G = S.cols; }
    bind();
    S.onGrow(bind);

    // ---------------------------------------------------------------- profiles
    // spec: the CBZ.combatIQ.profile() row for this unit's training x gun, plus
    // the page's numbers that are not in it (base damage, magazine, reload,
    // weapon slot for the near-miss spread, melee for bare hands / beasts)
    T.profile = function (spec) {
      const key = JSON.stringify(spec);
      for (let i = 0; i < T.profs.length; i++) if (T.profs[i].key === key) return i;
      const p = Object.assign({ key: key }, spec);
      p.spec = spec;
      p.melee = !!spec.melee;
      if (!p.melee) {
        p.eBurst = Math.max(1, Math.round(p.burst * (0.65 + p.disc * 0.35)));
        p.inCd = p.rate * (1.15 - p.disc * 0.25);
        p.reCd = p.recycle * (1.25 - p.disc * 0.45);
        const base = p.dmg != null ? p.dmg : 14;
        const rawDps = (p.hit10 * base) / (p.secPerRound || 1);
        let mul = rawDps > 0 ? p.dps / rawDps : 1;
        if (mul < 0.35) mul = 0.35; else if (mul > 1.6) mul = 1.6;
        let out = base * mul;
        const ceil = ((spec.dpsCap || 26) * p.secPerRound) / (p.hit10 || 1);
        if (out > ceil) out = ceil;
        p.shotDmg = out * PAGE_DMG;
        p.fireMax = Math.min(125, p.hi * 2.6 + 8);
        p.tokCap = (p.tier === "swat" || p.tier === "elite") ? 3 : 2;
        p.coverMinded = 0.5 < p.cover;          // trait 0.5 < cover (see trait())
        p.spread = (SPREAD[p.wslot] || SPREAD._def || 0.055);
        p.tol = Math.max(2.5, (p.hi - p.lo) * 0.18);
      }
      T.profs.push(p);
      return T.profs.length - 1;
    };
    T.addUnit = function (r, prof, spawnI, nerve, weight, homeX, homeZ) {
      const p = T.profs[prof];
      G.prof[r] = prof; G.spawnI[r] = spawnI; G.nerve[r] = nerve; G.mw[r] = weight;
      G.hx[r] = homeX; G.hz[r] = homeZ; G.gx[r] = G.x[r]; G.gz[r] = G.z[r];
      G.tgt[r] = -1; G.cool[r] = 0.4 + rnd() * 1.2; G.mag[r] = p.mag || 0; G.reloadT[r] = 0;
      G.react[r] = 0; G.aimT[r] = 0; G.burst[r] = 0; G.aimOn[r] = -1; G.supp[r] = 0; G.iqs[r] = 0;
      G.slot[r] = SL.march; G.thinkAt[r] = T.simT + rnd() * 0.3; G.lastT[r] = T.simT; G.thinkLast[r] = T.simT;
      G.routT[r] = 0; G.routBest[r] = 0; G.routStall[r] = 0; G.rallyT[r] = 0; G.spd[r] = 0; G.crouch[r] = 0;
      G.losBad[r] = 0; G.sees[r] = 0; G.losAt[r] = 0; G.tok0[r] = G.tok1[r] = G.tok2[r] = -1;
      G.iqTgt[r] = -1; G.sideT[r] = 0; G.bear[r] = NaN; G.sqSlot[r] = spawnI % 10;
      G.bslot[r] = 0; G.bslotT[r] = -1; G.pkN[r] = 0; G.hullX[r] = NaN; G.hullT[r] = 0; G.popT[r] = 0; G.up[r] = 1; G.losT[r] = 0;
    };

    // ---------------------------------------------------------------- the ground
    // a host with no sampled grid (Gang City: the field is wherever its forces
    // are) hands its ground function instead (in-page only, never to a worker)
    const groundFn = typeof cfg.groundAt === "function" ? cfg.groundAt : null;
    function hAt(x, z) {
      if (!ground) return groundFn ? groundFn(x, z) : 0;
      const fx = (x - ground.x0) / ground.cell, fz = (z - ground.z0) / ground.cell;
      let ix = Math.floor(fx), iz = Math.floor(fz);
      const w = ground.w, h = ground.h;
      if (ix < 0) ix = 0; else if (ix > w - 2) ix = w - 2;
      if (iz < 0) iz = 0; else if (iz > h - 2) iz = h - 2;
      const tx = Math.min(1, Math.max(0, fx - ix)), tz = Math.min(1, Math.max(0, fz - iz));
      const H = ground.hgt, k = iz * w + ix;
      const a = H[k] + (H[k + 1] - H[k]) * tx, b = H[k + w] + (H[k + w + 1] - H[k + w]) * tx;
      return a + (b - a) * tz;
    }
    T.groundAt = hAt;
    // fire.js terrainBlocked: 3 m steps, the two ends' footing never counts
    function terrainBlocked(ax, ay, az, bx, by, bz) {
      const dx = bx - ax, dz = bz - az, d = Math.hypot(dx, dz);
      if (d < 8) return false;
      const dy = by - ay, n = Math.ceil(d / 3);
      for (let i = 1; i < n; i++) {
        const t = i / n, at = t * d;
        if (at < 2 || d - at < 2) continue;
        if (hAt(ax + dx * t, az + dz * t) > ay + dy * t + 0.35) return true;
      }
      return false;
    }
    function navBlocked(ax, az, bx, bz) {
      if (!nav) return false;
      const dx = bx - ax, dz = bz - az, d = Math.hypot(dx, dz), n = Math.ceil(d / (nav.cell * 0.5));
      for (let i = 1; i < n; i++) {
        const t = i / n;
        const ix = ((ax + dx * t - nav.x0) / nav.cell) | 0, iz = ((az + dz * t - nav.z0) / nav.cell) | 0;
        if (ix >= 0 && iz >= 0 && ix < nav.w && iz < nav.h && nav.block[iz * nav.w + ix]) return true;
      }
      return false;
    }
    function eyeH(r) { return G.crouch[r] ? 0.98 : 1.52; }
    function losH(r) { return G.crouch[r] ? 0.87 : 1.35; }
    function los(a, b) {
      T.stats.los++;
      if (navBlocked(G.x[a], G.z[a], G.x[b], G.z[b])) return false;
      if (!terrainLos) return true;
      return !terrainBlocked(G.x[a], G.y[a] + eyeH(a), G.z[a], G.x[b], G.y[b] + losH(b), G.z[b]);
    }
    // seesStanding: a crouched man asks as if he stood
    function losStanding(a, b) {
      if (!G.crouch[a]) return los(a, b);
      G.crouch[a] = 0; const s = los(a, b); G.crouch[a] = 1; return s;
    }

    // ---------------------------------------------------------------- the grids
    /* TWO KINDS OF GRID, rebuilt by counting sort:
       THE TARGET GRIDS, one PER SIDE, 16 m cells: a search only ever walks
         the enemy's rows (a man deep in his own army's block used to walk
         thousands of his own mates to learn there was nobody to shoot).
         Dense when the field's extent is known (the ground the host sampled:
         a ring walk is index arithmetic; rows off the field clamp into its
         edge cells and are still found), hashed otherwise.
       THE BODY GRID, 2.4 m, hashed: separation, the lane, the goal
         anti-clump, the cornered check. Only rows that are DOING something
         are in it (a mark, a fight slot, a rout) plus every FULL row: a
         column on the march keeps its own spacing and asks nobody.
       Collisions merge hashed cells; every caller re-tests distance. */
    function mkGrid(cell) { return { cell: cell, mask: 0, start: null, list: new Int32Array(0), n: 0, w: 0, h: 0, x0: 0, z0: 0 }; }
    const GT = [mkGrid(16), mkGrid(16)], GF = mkGrid(2.4);
    let hashAt = -1;
    // integer hash (Math.imul: a float product past 2^31 takes V8's slow ToInt32)
    function key(cx, cz, mask) { return (Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663)) & mask; }
    let _keys = new Int32Array(0);
    if (ground) for (let s2 = 0; s2 < 2; s2++) {
      const g = GT[s2];
      g.w = Math.max(1, Math.ceil(ground.w * ground.cell / g.cell) + 1);
      g.h = Math.max(1, Math.ceil(ground.h * ground.cell / g.cell) + 1);
      g.x0 = ground.x0; g.z0 = ground.z0;
    }
    function build(Gr, rows, nr) {
      const dense = Gr.w > 0;
      let sz;
      if (dense) sz = Gr.w * Gr.h;
      else { sz = 1024; while (sz < nr * 2) sz <<= 1; Gr.mask = sz - 1; }
      if (!Gr.start || Gr.start.length !== sz + 1) Gr.start = new Int32Array(sz + 1);
      if (Gr.list.length < nr) Gr.list = new Int32Array(Math.max(nr, Gr.list.length * 2));
      if (_keys.length < nr) _keys = new Int32Array(Math.max(nr, _keys.length * 2));
      const st = Gr.start; st.fill(0);
      const ic = 1 / Gr.cell, X = G.x, Z = G.z, K = _keys, mask = Gr.mask;
      if (dense) {
        const x0 = Gr.x0, z0 = Gr.z0, w = Gr.w, h = Gr.h;
        for (let i = 0; i < nr; i++) {
          const r = rows[i];
          let cx = Math.floor((X[r] - x0) * ic), cz = Math.floor((Z[r] - z0) * ic);
          if (cx < 0) cx = 0; else if (cx >= w) cx = w - 1;
          if (cz < 0) cz = 0; else if (cz >= h) cz = h - 1;
          const k = cz * w + cx; K[i] = k; st[k + 1]++;
        }
      } else {
        for (let i = 0; i < nr; i++) { const r = rows[i]; const k = key(Math.floor(X[r] * ic), Math.floor(Z[r] * ic), mask); K[i] = k; st[k + 1]++; }
      }
      for (let k = 0; k < sz; k++) st[k + 1] += st[k];
      const fill = _fill.length >= sz ? _fill : (_fill = new Int32Array(sz * 2));
      fill.set(st.subarray(0, sz));
      const L = Gr.list;
      for (let i = 0; i < nr; i++) L[fill[K[i]]++] = rows[i];
      Gr.n = nr;
    }
    let _fill = new Int32Array(0), _side = [new Int32Array(0), new Int32Array(0)], _act = new Int32Array(0);
    // the body grid every TICK.hash (0.1 s); the target grids at 2.5x that
    // (marks are kept until they fall, so a search is rare and 16 m forgives)
    let coarseAt = -1;
    function rehash() {
      const n = S.rows;
      if (_act.length < n) { _act = new Int32Array(Math.max(n, 1024)); _side[0] = new Int32Array(_act.length); _side[1] = new Int32Array(_act.length); }
      const LF = G.life, SD = G.side, TG = G.tgt, SLT = G.slot, TR = G.tier;
      const doT = T.simT - coarseAt >= TICK.hash * 2.5 || coarseAt < 0;
      let na = 0, n0 = 0, n1 = 0;
      for (let r = 0; r < n; r++) {
        const l = LF[r];
        if (l !== LIFE.alive && l !== LIFE.routed) continue;
        if (doT) { if (SD[r] === 0) _side[0][n0++] = r; else _side[1][n1++] = r; }
        if (TR[r] === TIER.full || l === LIFE.routed || TG[r] >= 0 || SLT[r] !== SL.march) _act[na++] = r;
      }
      build(GF, _act, na);
      if (doT) { build(GT[0], _side[0], n0); build(GT[1], _side[1], n1); coarseAt = T.simT; }
      hashAt = T.simT;
    }
    // visit every row in the body-grid cells touching a disc
    function forDisc(Gr, x, z, rad, fn) {
      const ic = 1 / Gr.cell, x0 = Math.floor((x - rad) * ic), x1 = Math.floor((x + rad) * ic);
      const z0 = Math.floor((z - rad) * ic), z1 = Math.floor((z + rad) * ic);
      const st = Gr.start, L = Gr.list, mask = Gr.mask;
      if (!st) return;
      for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
        const k = key(cx, cz, mask);
        for (let i = st[k], e = st[k + 1]; i < e; i++) if (fn(L[i]) === true) return;
      }
    }
    // the cells of one Chebyshev ring round (cx, cz) of a target grid (the page's own ring walk)
    function forRing(Gr, cx, cz, ring, fn) {
      const st = Gr.start, L = Gr.list, mask = Gr.mask, dense = Gr.w > 0, w = Gr.w, h = Gr.h;
      if (!st) return;
      for (let dz = -ring; dz <= ring; dz++) {
        const edge = dz === -ring || dz === ring;
        const zz = cz + dz;
        if (dense && (zz < 0 || zz >= h)) continue;
        const step = edge ? 1 : (2 * ring || 1);
        for (let dx = -ring; dx <= ring; dx += step) {
          const xx = cx + dx;
          if (dense && (xx < 0 || xx >= w)) { if (!ring) break; continue; }
          const k = dense ? zz * w + xx : key(xx, zz, mask);
          for (let i = st[k], e = st[k + 1]; i < e; i++) fn(L[i]);
          if (!ring) break;
        }
      }
    }

    // ---------------------------------------------------------------- the target search
    // physics.js pickTarget: candidates the brain could have noticed (range,
    // a 200 degree field off his facing, a 10 m touch), nearest four asked
    // for a line, else the nearest anyway
    const _cand = new Int32Array(48), _cd = new Float32Array(48);
    let _px = 0, _pz = 0, _pfx = 0, _pfz = 0, _pr2 = 0, _nc = 0;
    function visitCand(o) {
      const l = G.life[o];
      if (l !== LIFE.alive && l !== LIFE.routed) return;
      const dx = G.x[o] - _px, dz = G.z[o] - _pz, d2 = dx * dx + dz * dz;
      if (d2 > _pr2) return;
      if (d2 > TOUCH * TOUCH) { const d = Math.sqrt(d2); if ((_pfx * dx + _pfz * dz) / d < FOV_COS) return; }
      if (_nc < 48) { _cand[_nc] = o; _cd[_nc] = d2; _nc++; return; }
      // full: the farthest kept gives way to a nearer one
      let wi = 0, worst = _cd[0];
      for (let i = 1; i < 48; i++) if (_cd[i] > worst) { worst = _cd[i]; wi = i; }
      if (d2 < worst) { _cand[wi] = o; _cd[wi] = d2; }
    }
    function pickTarget(r, range) {
      const x = G.x[r], z = G.z[r], hd = G.heading[r];
      _px = x; _pz = z; _pfx = Math.sin(hd); _pfz = Math.cos(hd); _pr2 = range * range; _nc = 0;
      // ring by ring outward through the ENEMY's grid: a full ring past the
      // twelfth candidate is enough; the nearest 48 are kept
      const Gr = GT[G.side[r] ? 0 : 1];
      const ic = 1 / Gr.cell, maxR = Math.ceil(range * ic);
      const cx = Gr.w ? Math.floor((x - Gr.x0) * ic) : Math.floor(x * ic), cz = Gr.w ? Math.floor((z - Gr.z0) * ic) : Math.floor(z * ic);
      for (let ring = 0; ring <= maxR; ring++) {
        forRing(Gr, cx, cz, ring, visitCand);
        if (_nc >= 12 && ring > 1) break;
      }
      const nc = _nc;
      if (!nc) return -1;
      let best = -1, bd = 1e18;
      for (let i = 0; i < nc; i++) if (_cd[i] < bd) { bd = _cd[i]; best = _cand[i]; }
      for (let t = 0; t < 4; t++) {
        let o = -1, od = 1e18, oi = -1;
        for (let i = 0; i < nc; i++) if (_cand[i] >= 0 && _cd[i] < od) { od = _cd[i]; o = _cand[i]; oi = i; }
        if (o < 0) break;
        _cand[oi] = -1;
        if (los(r, o)) return o;
      }
      return best;
    }
    // fire.js mateInLane: a mate inside 12 m within 0.62 m of the line -> his side
    function mateInLane(r, t) {
      const x = G.x[r], z = G.z[r], dx = G.x[t] - x, dz = G.z[t] - z, d = Math.hypot(dx, dz);
      if (d < 0.5) return 0;
      const nx = dx / d, nz = dz / d, reach = Math.min(d - 0.6, 12);
      if (reach <= 1) return 0;
      let worst = 0, worstOff = 9;
      const sd = G.side[r];
      forDisc(GF, x + nx * reach * 0.5, z + nz * reach * 0.5, reach * 0.5 + 1.2, function (o) {
        if (o === r || G.side[o] !== sd || G.life[o] !== LIFE.alive && G.life[o] !== LIFE.routed) return;
        const ox = G.x[o] - x, oz = G.z[o] - z, along = ox * nx + oz * nz;
        if (along < 0.8 || along > reach) return;
        const off = ox * nz - oz * nx, a = Math.abs(off);
        if (a < 0.62 && a < worstOff) { worstOff = a; worst = off >= 0 ? 1 : -1; }
      });
      return worst;
    }

    // ---------------------------------------------------------------- the token (IQ.slot)
    function tokSlot(t, k) { return k === 0 ? G.tok0 : k === 1 ? G.tok1 : G.tok2; }
    function tokU(k) { return k === 0 ? G.tu0 : k === 1 ? G.tu1 : G.tu2; }
    function slotFor(r, t, p) {
      const tnow = T.simT;
      // expire dead / stale holders
      let held = false, n = 0;
      for (let k = 0; k < 3; k++) {
        const A = tokSlot(t, k), h = A[t];
        if (h < 0) continue;
        if ((G.life[h] !== LIFE.alive && G.life[h] !== LIFE.routed) || tokU(k)[t] < tnow || G.iqTgt[h] !== t) { A[t] = -1; continue; }
        if (h === r) held = true;
        n++;
      }
      G.iqTgt[r] = t;
      const dx = G.x[r] - G.x[t], dz = G.z[r] - G.z[t];
      if (dx * dx + dz * dz < 36) return SL.fire;
      if (held) return SL.fire;
      if (trait(r, 0x70CE) > 0.62 + p.disc * 0.36) return SL.fire;
      if (n < p.tokCap) {
        for (let k = 0; k < 3; k++) {
          const A = tokSlot(t, k);
          if (A[t] < 0) { A[t] = r; tokU(k)[t] = tnow + (0.9 + trait(r, 0x7071) * 1.1); break; }
        }
        return SL.fire;
      }
      const hurt = G.hp[r] < G.maxHp[r] * p.nerve;
      if (hurt || trait(r, 0x0CFF) < p.cover) return SL.cover;
      return SL.flank;
    }

    // ---------------------------------------------------------------- morale (morale.js routCheck)
    let CTX = null;
    function manMorale(r) {
      const hf = Math.max(0, Math.min(1, G.hp[r] / (G.maxHp[r] || 1)));
      return CTX.morale[G.side[r]] - G.supp[r] * MK.SUPP_K - (1 - hf) * MK.WOUND_K;
    }
    function foeX(r) { return CTX.com[G.side[r] ? 0 : 2]; }
    function foeZ(r) { return CTX.com[G.side[r] ? 1 : 3]; }
    // true while he runs; sets his goal
    function routCheck(r, dt) {
      if (G.kind[r] !== 0 || CTX.over) return false;
      if (G.rallyT[r] > 0) G.rallyT[r] -= dt;
      const eff = manMorale(r);
      const fxp = foeX(r), fzp = foeZ(r);
      const fd = Math.hypot(G.x[r] - fxp, G.z[r] - fzp);
      if (G.life[r] !== LIFE.routed) {
        if (G.rallyT[r] > 0 || !(eff < G.nerve[r])) return false;
        G.life[r] = LIFE.routed; G.routT[r] = 0; G.routBest[r] = fd; G.routStall[r] = 0;
        G.tgt[r] = -1; G.sees[r] = 0; G.sideT[r] = 0; G.crouch[r] = 0;
        ev(EV.rout, r, 0, 0);
      } else {
        G.routT[r] += dt;
        if (fd > G.routBest[r] + 0.6) { G.routBest[r] = fd; G.routStall[r] = 0; } else G.routStall[r] += dt;
        let cornered = G.routStall[r] > 4.5;
        if (!cornered && G.routT[r] > 1.5) {
          const sd = G.side[r], x = G.x[r], z = G.z[r];
          forDisc(GF, x, z, 4.5, function (o) {
            if (G.side[o] === sd || G.life[o] !== LIFE.alive) return;
            const dx = G.x[o] - x, dz = G.z[o] - z;
            if (dx * dx + dz * dz < 4.5 * 4.5) { cornered = true; G.tgt[r] = o; return true; }
          });
        }
        if (cornered) { G.life[r] = LIFE.alive; G.rallyT[r] = 12; G.routStall[r] = 0; ev(EV.rally, r, 0, 0); return false; }
        if (G.routT[r] > 4 && eff > G.nerve[r] + MK.RALLY_BAND && G.supp[r] < 0.3) {
          G.life[r] = LIFE.alive; G.rallyT[r] = 6; ev(EV.rally, r, 0, 0); return false;
        }
        if (fd > MK.FLEE_GAPS * gap || G.routT[r] > 45) {
          G.life[r] = LIFE.fled; T.stats.fled[G.side[r]]++; ev(EV.fled, r, 0, 0);
          return true;
        }
      }
      let ax = G.x[r] - fxp, az = G.z[r] - fzp;
      const al = Math.hypot(ax, az) || 1; ax /= al; az /= al;
      ax += (G.side[r] === 0 ? -1 : 1) * 0.55;
      const bl = Math.hypot(ax, az) || 1; ax /= bl; az /= bl;
      const lat = (((G.spawnI[r] * 13) % 9) - 4) * 0.09;
      G.gx[r] = G.x[r] + (ax - az * lat) * 30; G.gz[r] = G.z[r] + (az + ax * lat) * 30;
      G.slot[r] = SL.rout; G.tgt[r] = -1; G.sees[r] = 0;
      return true;
    }

    // ---------------------------------------------------------------- squads
    let SQ = { n: 0, mem: new Int32Array(0), cnt: new Uint8Array(0), tgt: new Int32Array(0), thinkAt: new Float32Array(0),
      cx: new Float32Array(0), cz: new Float32Array(0), side: new Uint8Array(0) };
    T.squads = function () {
      let n = 0;
      for (let r = 0; r < S.rows; r++) if (G.life[r] !== LIFE.free && G.squad[r] >= n) n = G.squad[r] + 1;
      SQ = { n: n, mem: new Int32Array(n * 10).fill(-1), cnt: new Uint8Array(n), tgt: new Int32Array(n).fill(-1),
        thinkAt: new Float32Array(n), cx: new Float32Array(n), cz: new Float32Array(n), side: new Uint8Array(n),
        lead: new Int32Array(n).fill(-1) };
      for (let r = 0; r < S.rows; r++) {
        if (G.life[r] === LIFE.free) continue;
        const q = G.squad[r]; if (q < 0) continue;
        G.sq[r] = q; SQ.side[q] = G.side[r];
        const k = G.sqSlot[r] % 10;
        if (SQ.mem[q * 10 + k] < 0) SQ.mem[q * 10 + k] = r;
        else for (let j = 0; j < 10; j++) if (SQ.mem[q * 10 + j] < 0) { SQ.mem[q * 10 + j] = r; break; }
        SQ.cnt[q]++;
      }
      for (let q = 0; q < n; q++) SQ.thinkAt[q] = T.simT + (q % 16) * (TICK.squad / 16);
      T.nSquads = n;
    };
    function lead(q) {
      for (let j = 0; j < 10; j++) { const r = SQ.mem[q * 10 + j]; if (r >= 0 && G.life[r] === LIFE.alive) return r; }
      return -1;
    }

    // ---------------------------------------------------------------- goals
    // orders.js holding(): a force's order first (oK), else the side's
    function holding(r) {
      const k = G.oK[r];
      if (k) return k !== 3 && !CTX.hunt[G.side[r]] && (k !== 1 || !CTX.broken[G.side[r] ? 0 : 1]);
      return CTX.hold[G.side[r]] && !CTX.hunt[G.side[r]] && !CTX.broken[G.side[r] ? 0 : 1];
    }
    // think.js marchGoal: the senior man navigates, the column trails him
    function marchGoal(r) {
      if (holding(r)) { G.gx[r] = G.hx[r]; G.gz[r] = G.hz[r]; G.slot[r] = SL.march; return; }
      // an attack order marches on its objective until it is close (then the
      // flow field finds the enemy that is actually there)
      if (G.oK[r] === 3 && Math.hypot(G.oX[r] - G.x[r], G.oZ[r] - G.z[r]) > 120) {
        const q0 = G.sq[r], ld0 = q0 >= 0 ? lead(q0) : -1;
        if (ld0 < 0 || ld0 === r) {
          G.gx[r] = G.oX[r] + (rnd() - 0.5) * 14; G.gz[r] = G.oZ[r] + (rnd() - 0.5) * 14; G.slot[r] = SL.march;
          return;
        }
      }
      const q = G.sq[r], ld = q >= 0 ? lead(q) : -1;
      if (ld >= 0 && ld !== r) {
        const my = Math.atan2(G.gx[ld] - G.x[ld], G.gz[ld] - G.z[ld]);
        const s = G.sqSlot[r], row = ((s / 2) | 0) + 1, col = (s & 1) ? 1.25 : -1.25;
        G.gx[r] = G.x[ld] - Math.sin(my) * row * 2.0 + Math.cos(my) * col;
        G.gz[r] = G.z[ld] - Math.cos(my) * row * 2.0 - Math.sin(my) * col;
      } else if (!flowGoal(r)) {
        const j = CTX.hunt[G.side[r]] ? 0 : 14;
        G.gx[r] = foeX(r) + (rnd() - 0.5) * j; G.gz[r] = foeZ(r) + (rnd() - 0.5) * j;
      }
      G.slot[r] = SL.march;
    }
    // the band (combat_iq posture): hold `pref` off the mark on a latched bearing
    /* combat_iq bearingSlot: every man who engages a mark takes the next slot
       round it (0, +1, -1, +2, -2 ... x 0.62 rad), so a crew SURROUNDS its
       mark instead of queueing on one line; the slot is his for that mark. */
    function bearOff(r, t) {
      if (G.bslotT[r] !== t) { G.bslotT[r] = t; G.bslot[r] = G.pkN[t]++; }
      const s2 = G.bslot[r];
      const k = Math.ceil(s2 / 2) * (s2 % 2 === 1 ? 1 : -1);
      return k * 0.62 + (trait(r, 0x8EA2) - 0.5) * 0.25;
    }
    // combat_iq posture's BAND + BEARING: hold `pref` off the mark on a
    // latched bearing plus his slot's offset; a flanker works it wider
    function bandGoal(r, t, p, dist, slot) {
      let want = dist;
      if (Math.abs(dist - p.pref) > p.tol) want = p.pref;
      if (dist < 4.5) want = dist;
      const bear = bearOff(r, t);
      const cur = Math.atan2(G.x[r] - G.x[t], G.z[r] - G.z[t]);
      if (G.bear[r] !== G.bear[r]) G.bear[r] = cur - bear;          // NaN: latch now
      let dA = cur - (G.bear[r] + bear);
      while (dA > Math.PI) dA -= TAU; while (dA < -Math.PI) dA += TAU;
      if (Math.abs(dA) > 1.9) G.bear[r] = cur - bear;
      let a = G.bear[r] + bear;
      if (slot === SL.flank) a += 0.35 * (bear >= 0 ? 1 : -1);
      G.gx[r] = G.x[t] + Math.sin(a) * want; G.gz[r] = G.z[t] + Math.cos(a) * want;
    }
    /* morale.js HULL DOWN, on the same sand: a rattled man (or one holding,
       or already in a fold) looks for a reverse slope where a crouched man is
       hidden from the threat and a standing one still has the shot. Same
       bearings, same marching probes, same bisection, same score; the same
       per-man clock (2.5-4 s) under a field-wide budget that scales with the
       field (60 searches a second per 200 men, the page's rate). */
    const HB_ = [0, 0.6, -0.6, 1.25, -1.25, 1.9, -1.9];
    let hullTok = 20, hullTokT = 0;
    const _hull = { x: 0, z: 0, d: 0 };
    function hullDown(x, z, tx, tz) {
      const ty = hAt(tx, tz) + 1.55, away = Math.atan2(x - tx, z - tz), dT = Math.hypot(x - tx, z - tz);
      let bs = 1e9, found = false;
      for (let ai = 0; ai < 7; ai++) {
        const ang = away + HB_[ai], sa = Math.sin(ang), ca = Math.cos(ang);
        let lo = -1, hi = -1;
        for (let rad = 2.5; rad <= 20; rad += 2.2) {
          const px = x + sa * rad, pz = z + ca * rad;
          if (terrainBlocked(tx, ty, tz, px, hAt(px, pz) + 1.0, pz)) { hi = rad; break; }
          lo = rad;
        }
        if (hi < 0) continue;
        if (lo < 0) lo = Math.max(0.5, hi - 2.2);
        for (let kk = 0; kk < 4; kk++) {
          const mid = (lo + hi) * 0.5, px = x + sa * mid, pz = z + ca * mid;
          if (terrainBlocked(tx, ty, tz, px, hAt(px, pz) + 1.0, pz)) hi = mid; else lo = mid;
        }
        for (let back = 0; back < 3; back++) {
          const rad = hi + 0.7 * (back ? back * 0.5 : 1), px = x + sa * rad, pz = z + ca * rad;
          if (cellBlocked(px, pz)) continue;
          const gy = hAt(px, pz);
          if (!terrainBlocked(tx, ty, tz, px, gy + 1.0, pz)) continue;
          if (terrainBlocked(tx, ty, tz, px, gy + 1.55, pz)) continue;
          const walk = Math.hypot(px - x, pz - z), closing = Math.max(0, dT - Math.hypot(px - tx, pz - tz));
          const score = walk + closing * 1.4 + Math.abs(HB_[ai]) * 1.1;
          if (score < bs) { bs = score; _hull.x = px; _hull.z = pz; _hull.d = walk; found = true; }
          break;
        }
      }
      return found;
    }
    function cellBlocked(x, z) {
      if (!nav) return false;
      const ix = ((x - nav.x0) / nav.cell) | 0, iz = ((z - nav.z0) / nav.cell) | 0;
      return ix >= 0 && iz >= 0 && ix < nav.w && iz < nav.h && !!nav.block[iz * nav.w + ix];
    }
    function hullFor(r, t) {
      const tn = T.simT, has = G.hullX[r] === G.hullX[r];
      if (G.hullT[r] > tn) return has;
      const rate = 60 * Math.max(1, (CTX.crowd || 200) / 200);
      if (tn > hullTokT) { hullTok = Math.min(rate * 0.5, hullTok + (tn - hullTokT) * rate); hullTokT = tn; }
      if (hullTok < 1) { G.hullT[r] = tn + 0.4 + (G.spawnI[r] % 7) * 0.05; return has; }
      hullTok--;
      G.hullT[r] = tn + (has ? 3.4 : 2.5) + (G.spawnI[r] % 9) * 0.07;
      if (!hullDown(G.x[r], G.z[r], G.x[t], G.z[t])) { G.hullX[r] = NaN; return false; }
      if (has && Math.hypot(G.hullX[r] - G.x[r], G.hullZ[r] - G.z[r]) < _hull.d + 3) return true;
      G.hullX[r] = _hull.x; G.hullZ[r] = _hull.z;
      return true;
    }
    // think.js: no two men are sent to the same metre (the goal anti-clump)
    function unclump(r, R, cap) {
      const gx = G.gx[r], gz = G.gz[r];
      let ox = 0, oz = 0, n = 0;
      forDisc(GF, gx, gz, R, function (o) {
        if (o === r || (G.life[o] !== LIFE.alive && G.life[o] !== LIFE.routed)) return;
        const dx = gx - G.x[o], dz = gz - G.z[o], d = Math.hypot(dx, dz);
        if (d > R || d < 0.001) return;
        ox += dx / d * (R - d); oz += dz / d * (R - d);
        if (++n >= cap) return true;
      });
      G.gx[r] += ox; G.gz[r] += oz;
    }
    // ---- the flow field (core/flow.js), solved here for whichever side asks
    const FL = { dist: [null, null], at: [-9, -9], seeds: new Int32Array(1024) };
    function flowSolve(sd) {
      if (!nav || !CBZ.battleFlow) return;
      const w = nav.w, h = nav.h;
      if (!FL.dist[sd]) FL.dist[sd] = new Uint16Array(w * h);
      let n = 0;
      for (let r = 0; r < S.rows; r++) {
        if (G.side[r] === sd || G.life[r] !== LIFE.alive) continue;
        const ix = ((G.x[r] - nav.x0) / nav.cell) | 0, iz = ((G.z[r] - nav.z0) / nav.cell) | 0;
        if (ix < 0 || iz < 0 || ix >= w || iz >= h) continue;
        if (n >= FL.seeds.length) { const g = new Int32Array(FL.seeds.length * 2); g.set(FL.seeds); FL.seeds = g; }
        FL.seeds[n++] = iz * w + ix;
      }
      CBZ.battleFlow.solve(nav.block, w, h, FL.seeds, n, FL.dist[sd]);
      FL.at[sd] = T.simT;
    }
    function flowGoal(r) {
      if (!nav || !nav.on || !FL.dist[G.side[r]]) return false;
      const ix = ((G.x[r] - nav.x0) / nav.cell) | 0, iz = ((G.z[r] - nav.z0) / nav.cell) | 0;
      const k = CBZ.battleFlow.step(FL.dist[G.side[r]], nav.w, nav.h, ix, iz, 3);
      if (k < 0) return false;
      G.gx[r] = nav.x0 + ((k % nav.w) + 0.5) * nav.cell; G.gz[r] = nav.z0 + (((k / nav.w) | 0) + 0.5) * nav.cell;
      return true;
    }

    // ---------------------------------------------------------------- the aim (IQ.aimTick)
    function aimTick(r, t, dt, p) {
      if (G.aimOn[r] !== t) {
        G.aimOn[r] = t; G.aimT[r] = 0;
        G.react[r] = p.react * (0.8 + trait(r, 0x2EAC) * 0.4);
        G.burst[r] = 0; G.bear[r] = NaN;
      }
      G.aimT[r] += dt;
      if (G.react[r] > 0) G.react[r] -= dt;
      if (G.iqs[r] > 0) G.iqs[r] -= dt;
    }

    // ---------------------------------------------------------------- THE MID BRAIN (think.js thinkMan)
    function thinkMid(r) {
      T.stats.thinks++;
      const p = T.profs[G.prof[r]];
      // thinkDt: the time since HIS last think (think.js), not since the last visit
      const dt = Math.min(1.2, T.simT - G.thinkLast[r]); G.thinkLast[r] = T.simT;
      G.thinkAt[r] = T.simT + 0.14 + Math.min(0.42, CTX.crowd / 2600) + rnd() * 0.06;
      if (routCheck(r, dt)) return;
      if (G.life[r] !== LIFE.alive) return;
      if (G.sideT[r] > 0 && G.tgt[r] >= 0 && alive(G.tgt[r])) { G.sideT[r] -= dt; return; }
      const sd = G.side[r], hunt = CTX.hunt[sd];
      if (G.tgt[r] < 0 || !alive(G.tgt[r])) { G.tgt[r] = pickTarget(r, hunt ? SIGHT * 2 : SIGHT); G.losBad[r] = 0; }
      // the squad shares contact: at most two turn on one shout
      if (G.tgt[r] < 0 && G.sq[r] >= 0) {
        const q = G.sq[r];
        for (let j = 0; j < 10; j++) {
          const b = SQ.mem[q * 10 + j];
          if (b < 0 || b === r || G.life[b] !== LIFE.alive) continue;
          const bt = G.tgt[b];
          if (bt < 0 || !alive(bt)) continue;
          let on = 0;
          for (let k = 0; k < 10; k++) { const o = SQ.mem[q * 10 + k]; if (o >= 0 && o !== r && G.life[o] !== LIFE.dead && G.tgt[o] === bt) on++; }
          if (on >= 2) continue;
          if (Math.hypot(G.x[bt] - G.x[r], G.z[bt] - G.z[r]) < SIGHT * 1.3) { G.tgt[r] = bt; G.losBad[r] = 0; marchGoal(r); return; }
        }
      }
      const t = G.tgt[r];
      if (t < 0) { marchGoal(r); return; }
      if (p.melee) { meleeGoal(r, t, p); return; }
      const sees = losStanding(r, t);
      G.sees[r] = sees ? 1 : 0; G.losT[r] = T.simT;
      if (!sees) {
        G.losBad[r] += dt;
        if (G.losBad[r] > 2.6) {
          if (G.losBad[r] > 7) { G.tgt[r] = -1; G.losBad[r] = 0; return; }
          if (!flowGoal(r)) { G.gx[r] = G.x[t]; G.gz[r] = G.z[t]; }
          G.slot[r] = SL.push; return;
        }
      } else G.losBad[r] = 0;
      postureGoal(r, t, p, dt);
    }
    // the pursuit, the band, the hold (think.js after the LOS block)
    function postureGoal(r, t, p, dt) {
      const dist = Math.hypot(G.x[t] - G.x[r], G.z[t] - G.z[r]);
      if (G.life[t] === LIFE.routed && manMorale(r) > G.nerve[r] + 0.12 && dist < 110) {
        G.gx[r] = G.x[t]; G.gz[r] = G.z[t]; G.slot[r] = SL.push; return;
      }
      aimTick(r, t, dt, p);
      let slot = slotFor(r, t, p);
      // combat_iq: hurt and no cover anywhere -> fall back 9 m (open ground)
      const hurt = G.hp[r] < G.maxHp[r] * p.nerve;
      if ((slot === SL.cover || hurt || G.iqs[r] > 0) && hurt && p.tier !== "swat") {
        G.gx[r] = G.x[r] - (G.x[t] - G.x[r]) / (dist || 1) * 9; G.gz[r] = G.z[r] - (G.z[t] - G.z[r]) / (dist || 1) * 9;
        G.slot[r] = SL.fallback; return;
      }
      bandGoal(r, t, p, dist, slot);
      const holds = holding(r);
      // the ground is cover (think.js): a rattled man, a holder, or one
      // already in a fold takes the reverse slope
      if (terrainLos && !CTX.hunt[G.side[r]] && (G.supp[r] > 0.3 || G.hullX[r] === G.hullX[r] || holds)) {
        if (hullFor(r, t)) {
          G.gx[r] = G.hullX[r]; G.gz[r] = G.hullZ[r]; G.slot[r] = SL.hull;
          unclump(r, 0.95, 5);
          return;
        }
      }
      G.hullX[r] = NaN;
      if (holds) {
        const hx = G.gx[r] - G.hx[r], hz = G.gz[r] - G.hz[r], hd = Math.hypot(hx, hz);
        if (hd > 10) { G.gx[r] = G.hx[r] + hx / hd * 10; G.gz[r] = G.hz[r] + hz / hd * 10; }
        if (G.sees[r] && slot !== SL.cover) slot = SL.fire;
      }
      G.slot[r] = slot;
      unclump(r, 2.6, 4);
    }
    function meleeGoal(r, t, p) {
      const dist = Math.hypot(G.x[t] - G.x[r], G.z[t] - G.z[r]);
      if (p.beast && G.hp[r] < G.maxHp[r] * 0.3 && !p.brave) {
        const fx = G.x[r] - G.x[t], fz = G.z[r] - G.z[t], fl = Math.hypot(fx, fz) || 1;
        G.gx[r] = G.x[r] + fx / fl * 16; G.gz[r] = G.z[r] + fz / fl * 16; G.slot[r] = SL.fallback; G.tgt[r] = -1; return;
      }
      if (dist > p.reach) { G.gx[r] = G.x[t]; G.gz[r] = G.z[t]; } else { G.gx[r] = G.x[r]; G.gz[r] = G.z[r]; }
      G.sees[r] = 1;
      G.slot[r] = SL.push;
    }
    function alive(o) { return o >= 0 && (G.life[o] === LIFE.alive || G.life[o] === LIFE.routed); }

    // ---------------------------------------------------------------- THE FAR BRAIN: the squad decides
    /* The squad's senior man looks for the war (one search per squad per
       second, not ten); until he has CONTACT the squad is a march column and
       nobody else searches. With contact every man takes his own mark the
       way the page's man does (the nearest he can see, kept until it falls),
       because WHERE the fire lands is what decides a battle: ten rifles on
       the three nearest men is a different war from ten rifles spread over
       ten. His line of sight is re-asked on a slower clock than MID's. */
    function thinkSquad(q) {
      T.stats.thinks++;
      SQ.thinkAt[q] = T.simT + TICK.squad * (0.9 + rnd() * 0.2);
      let n = 0, cx = 0, cz = 0, engaged = 0;
      for (let j = 0; j < 10; j++) {
        const r = SQ.mem[q * 10 + j];
        if (r < 0 || G.life[r] !== LIFE.alive || G.tier[r] !== TIER.far) continue;
        cx += G.x[r]; cz += G.z[r]; n++;
        if (alive(G.tgt[r])) engaged++;
      }
      if (!n) return;
      SQ.cx[q] = cx / n; SQ.cz[q] = cz / n;
      if (engaged) { SQ.tgt[q] = 1; return; }
      const ld = lead(q);
      if (ld < 0 || G.tier[ld] !== TIER.far) { SQ.tgt[q] = -1; return; }
      const o = pickTarget(ld, CTX.hunt[G.side[ld]] ? SIGHT * 2 : SIGHT);
      if (o >= 0) { G.tgt[ld] = o; G.losAt[ld] = 0; G.losBad[ld] = 0; SQ.tgt[q] = 1; }
      else SQ.tgt[q] = -1;
    }
    // a FAR man: his nerve and his mark on the page's think cadence, his line
    // on the slow clock, his place from the squad
    function updFarMan(r) {
      const p = T.profs[G.prof[r]];
      if (T.simT < G.thinkAt[r]) return;
      const thought = true;
      const dt = Math.min(1.2, T.simT - G.thinkLast[r]); G.thinkLast[r] = T.simT;
      G.thinkAt[r] = T.simT + 0.14 + Math.min(0.42, CTX.crowd / 2600) + rnd() * 0.06;
      if (routCheck(r, dt)) return;
      if (G.life[r] !== LIFE.alive) return;
      if (G.sideT[r] > 0 && alive(G.tgt[r])) { G.sideT[r] -= dt; return; }
      let t = G.tgt[r];
      if (!alive(t)) {
        t = G.tgt[r] = -1;
        const q = G.sq[r];
        if (thought && (q < 0 || SQ.tgt[q] === 1)) {
          t = G.tgt[r] = pickTarget(r, CTX.hunt[G.side[r]] ? SIGHT * 2 : SIGHT);
          G.losAt[r] = 0; G.losBad[r] = 0;
        }
      }
      if (t < 0) { marchGoal(r); return; }
      if (p.melee) { meleeGoal(r, t, p); return; }
      if (!thought) return;
      // his line: re-asked on the slow clock, and only when he thinks (a
      // line found between thinks would fire from a slot chosen blind)
      if (T.simT >= G.losAt[r]) {
        const was = G.losT[r];
        G.losAt[r] = T.simT + TICK.los * (0.8 + rnd() * 0.4);
        const sees = losStanding(r, t);
        G.losT[r] = T.simT;
        if (!sees) G.losBad[r] += was > 0 ? Math.min(2, T.simT - was) : 0; else G.losBad[r] = 0;
        G.sees[r] = sees ? 1 : 0;
      }
      if (!G.sees[r]) {
        if (G.losBad[r] > 2.6) {
          if (G.losBad[r] > 7) { G.tgt[r] = -1; G.losBad[r] = 0; return; }
          if (!flowGoal(r)) { G.gx[r] = G.x[t]; G.gz[r] = G.z[t]; }
          G.slot[r] = SL.push; return;
        }
      }
      postureGoal(r, t, p, dt);
    }

    // ---------------------------------------------------------------- the body (step.js)
    let _sx = 0, _sz = 0, _sr = -1, _spx = 0, _spz = 0;
    function sepVisit(o) {
      if (o === _sr) return;
      const ox = _sx - G.x[o], oz = _sz - G.z[o], dd = ox * ox + oz * oz;
      if (dd > 0.81 || dd < 1e-8) return;
      const dl = Math.sqrt(dd), push = (0.9 - dl) * 0.5;
      _spx += ox / dl * push; _spz += oz / dl * push;
    }
    function move(r, dt) {
      const p = T.profs[G.prof[r]];
      const dx = G.gx[r] - G.x[r], dz = G.gz[r] - G.z[r], d = Math.hypot(dx, dz);
      const t = G.tgt[r];
      const tdist = alive(t) ? Math.hypot(G.x[t] - G.x[r], G.z[t] - G.z[r]) : 1e9;
      const sd = G.side[r], hunt = CTX.hunt[sd], sl = G.slot[r];
      let spd = 0;
      if (d > 1.1) {
        if (p.melee) {
          spd = sl === SL.fallback ? p.chase * 0.92 : sl === SL.push ? p.chase : p.march;
          if (hunt && tdist < 999) spd = Math.max(spd, p.chase * 1.08);
        } else {
          const hurtish = G.hp[r] < G.maxHp[r] * 0.45;
          spd = sl === SL.rout ? (hurtish ? 5.4 : 6.6) : sl === SL.fallback ? 5.2 :
            (sl === SL.push || sl === SL.march || sl === SL.flank) ? (hunt ? 7.6 : 6.2) :
            (sl === SL.cover || hurtish) ? 7.0 : 4.6;
          if (tdist < 1e9 && tdist > 42 && spd < 6.2) spd = hunt ? 7.6 : 6.4;
          if (hunt && tdist < 999) spd = Math.max(spd, 8.0);
        }
        const step = Math.min(d, spd * dt);
        let nx = G.x[r] + dx / d * step, nz = G.z[r] + dz / d * step;
        if (nav) {
          const ix = ((nx - nav.x0) / nav.cell) | 0, iz = ((nz - nav.z0) / nav.cell) | 0;
          if (ix >= 0 && iz >= 0 && ix < nav.w && iz < nav.h && nav.block[iz * nav.w + ix]) {
            // a wall: slide along whichever axis is open
            const ix0 = ((G.x[r] - nav.x0) / nav.cell) | 0, iz0 = ((G.z[r] - nav.z0) / nav.cell) | 0;
            if (!nav.block[iz0 * nav.w + ix]) nz = G.z[r]; else if (!nav.block[iz * nav.w + ix0]) nx = G.x[r]; else { nx = G.x[r]; nz = G.z[r]; }
          }
        }
        G.vx[r] = (nx - G.x[r]) / dt; G.vz[r] = (nz - G.z[r]) / dt;
        G.x[r] = nx; G.z[r] = nz;
        if (!(alive(t) && G.sees[r])) G.heading[r] = Math.atan2(dx, dz);
      } else { G.vx[r] = 0; G.vz[r] = 0; }
      G.spd[r] = spd;
      if (alive(t) && G.sees[r]) G.heading[r] = Math.atan2(G.x[t] - G.x[r], G.z[t] - G.z[r]);
      // separation off the body grid: what no formation slot can promise
      // (a column on the march keeps its own slots and is not in the grid)
      if (G.slot[r] !== SL.march || alive(t)) {
        _sx = G.x[r]; _sz = G.z[r]; _sr = r; _spx = 0; _spz = 0;
        forDisc(GF, _sx, _sz, 0.9, sepVisit);
        G.x[r] += _spx; G.z[r] += _spz;
      }
      G.y[r] = hAt(G.x[r], G.z[r]);
      // stance: a stopped man who is holding, pinned or hurt kneels; a man in
      // his fold works it (morale.js workHull): up to shoot, down to reload
      G.up[r] = 1;
      if (!p.melee) {
        if (G.life[r] === LIFE.routed) G.crouch[r] = 0;
        else if (G.slot[r] === SL.hull && G.hullX[r] === G.hullX[r]) {
          const hd = Math.hypot(G.hullX[r] - G.x[r], G.hullZ[r] - G.z[r]);
          if (hd > 3.2) { G.crouch[r] = 0; G.up[r] = 0; }
          else if (G.reloadT[r] > 0) { G.crouch[r] = 1; G.popT[r] = Math.min(G.popT[r], 0.3); G.up[r] = 0; }
          else {
            G.popT[r] -= dt;
            if (G.popT[r] <= 0) {
              const upNow = G.crouch[r] === 1;
              G.popT[r] = upNow ? (1.2 + (G.spawnI[r] % 7) * 0.14) : (1.1 + (G.spawnI[r] % 5) * 0.2);
              G.crouch[r] = upNow ? 0 : 1;
            }
            G.up[r] = G.crouch[r] ? 0 : 1;
          }
        }
        else if (G.crouch[r]) {
          if (spd > 0.1 || (!holding(r) && (!alive(t) || (G.supp[r] < 0.12 && G.hp[r] >= G.maxHp[r] * 0.5)))) G.crouch[r] = 0;
        } else if (spd <= 0.1 && (holding(r) || (alive(t) && (G.supp[r] > 0.35 || G.hp[r] < G.maxHp[r] * 0.5)))) G.crouch[r] = 1;
      }
      if (G.supp[r] > 0) G.supp[r] = Math.max(0, G.supp[r] - dt * MK.SUPP_DECAY);
    }

    // ---------------------------------------------------------------- the trigger (step.js + IQ.shot), batched
    let HB = new Float32Array(4096 * 4), nH = 0;
    function hitPush(t, dmg, by, head, miss) {
      if (nH * 4 + 4 > HB.length) { const g = new Float32Array(HB.length * 2); g.set(HB); HB = g; }
      HB[nH * 4] = t; HB[nH * 4 + 1] = dmg; HB[nH * 4 + 2] = by; HB[nH * 4 + 3] = head ? -1 : miss; nH++;
    }
    function fire(r, dt) {
      const p = T.profs[G.prof[r]];
      if (G.reloadT[r] > 0) { G.reloadT[r] -= dt; if (G.reloadT[r] <= 0) G.mag[r] = p.mag; }
      G.cool[r] -= dt;
      if (G.life[r] !== LIFE.alive) return;
      const t = G.tgt[r];
      if (!alive(t) || G.reloadT[r] > 0) return;
      const dist = Math.hypot(G.x[t] - G.x[r], G.z[t] - G.z[r]);
      if (p.melee) {
        if (dist > p.reach + 0.6) return;
        while (G.cool[r] <= 0) { G.cool[r] += 1 / (p.rate || 1); hitPush(t, p.bite * (0.85 + rnd() * 0.3), r, false, 0); }
        return;
      }
      let fireMax = p.fireMax;
      if (CTX.hunt[G.side[r]]) fireMax *= 1.6;
      const GT = T.gate, ready = G.cool[r] <= 0;
      if (!G.sees[r]) { if (ready) GT.nosee++; return; }
      if (dist > fireMax) { if (ready) GT.far++; return; }
      if (!FIRES[G.slot[r]] && dist > 12) { if (ready) GT.slot++; return; }
      if (!G.up[r]) { if (ready) GT.down++; return; }
      if (ready) GT.ready++;
      GT.fireT = (GT.fireT || 0) + dt;
      // THE LINE IS CHECKED WHEN THE TRIGGER IS PULLED (step.js): a think's
      // `sees` is up to half a second old, and a line lost since then is no
      // shot; he waits for his next think to look again
      if (G.cool[r] <= 0) {
        G.losT[r] = T.simT;
        if (!los(r, t)) { G.sees[r] = 0; G.cool[r] = 0.12; return; }
      }
      // no debt: a cooldown that ran out while he could not fire is not owed
      // shots (step.js SETS m.cool on a pull); only this tick's overshoot is
      if (G.cool[r] < -dt) G.cool[r] = -dt;
      let guard = 0;
      while (G.cool[r] <= 0 && guard++ < 8) {
        // the line at the trigger: a mate in the lane -> step off it, no shot
        const side = mateInLane(r, t);
        if (side) {
          GT.lane++;
          const dx = G.x[t] - G.x[r], dz = G.z[t] - G.z[r], d = Math.hypot(dx, dz) || 1, s = -side;
          G.gx[r] = G.x[r] + dz / d * s * 2.4; G.gz[r] = G.z[r] - dx / d * s * 2.4;
          G.slot[r] = SL.side; G.sideT[r] = 0.55; G.cool[r] = Math.max(G.cool[r], 0.18);
          return;
        }
        // IQ.shot: its own aimTick (dt 0: a NEW mark resets the aim and starts
        // the reaction beat, which only a think's posture runs down; a man
        // in the pursuit never postures, so a fresh mark keeps him silent,
        // exactly as on the page), then the beat, then the burst rhythm
        aimTick(r, t, 0, p);
        if (G.react[r] > 0) { GT.react++; G.cool[r] = G.react[r]; return; }
        GT.fire++;
        let cd;
        if (G.burst[r] > 0) { G.burst[r]--; cd = p.inCd; }
        else { G.burst[r] = p.eBurst - 1; cd = p.reCd * (0.82 + trait(r, 0x5EE7) * 0.36); }
        // hitChance
        const settle = 0.45 + 0.55 * Math.min(1, p.settle > 0 ? G.aimT[r] / p.settle : 1);
        let h = p.hit10 * settle - p.falloff * Math.max(0, dist - 10);
        if (G.spd[t] > 3.4) h *= 0.72;
        if (G.iqs[r] > 0) h *= 0.62;
        const ck = G.crouch[t] ? CROUCH_HIT : (G.slot[t] === SL.hull && G.up[t] && G.hullX[t] === G.hullX[t]) ? 0.7 : 1;
        h = Math.max(0.04, Math.min(0.92, h)) * ck * (T.cal[G.tier[r] === TIER.far ? "far" : "mid"] || 1);
        G.cool[r] += cd;
        G.mag[r]--;
        T.stats.shots[G.side[r]]++;
        const hit = rnd() < h;
        if (hit) {
          const head = rnd() < HEAD_P;
          hitPush(t, p.shotDmg * (head ? HEAD_K : 1), r, head, 0);
        } else {
          const miss = p.spread * dist * (0.5 + rnd() * 1.6);
          if (miss < 2.2) hitPush(t, 0, r, false, miss);
        }
        if (CTX.visR > 0) {
          const cx = G.x[r] - CTX.cam[0], cz = G.z[r] - CTX.cam[1];
          if (cx * cx + cz * cz < CTX.visR * CTX.visR) ev(EV.shot, r, t, hit ? 1 : 0);
        }
        if (G.mag[r] <= 0) { G.reloadT[r] = p.reload || 1.6; break; }
      }
    }
    // the batch: every round fired this step lands now
    function applyHits() {
      const t0 = now();
      for (let i = 0; i < nH; i++) {
        const t = HB[i * 4] | 0, dmg = HB[i * 4 + 1], by = HB[i * 4 + 2] | 0, flag = HB[i * 4 + 3];
        if (!alive(t)) continue;
        if (dmg <= 0) {           // a near miss: the snap rattles
          const miss = flag;
          if (G.kind[t] === 0) {
            if (G.tier[t] === TIER.full) { ev(EV.hitFull, t, by, -miss); continue; }
            G.supp[t] = Math.min(MK.SUPP_CAP, G.supp[t] + MK.SUPP_SNAP * (1.15 - miss / 2.2 * 0.7));
            G.iqs[t] = Math.max(G.iqs[t], 0.7);
          }
          continue;
        }
        T.stats.hits[G.side[by]]++;
        if (G.tier[t] === TIER.full) { ev(EV.hitFull, t, by, flag < 0 ? -1e6 - dmg : dmg); continue; }
        hurtRow(t, dmg, by);
      }
      nH = 0;
      T.ms.hits += now() - t0;
    }
    function hurtRow(t, dmg, by) {
      G.hp[t] -= dmg;
      if (G.kind[t] === 0) {
        G.iqs[t] = Math.max(G.iqs[t], 0.9);
        G.supp[t] = Math.min(MK.SUPP_CAP, G.supp[t] + MK.SUPP_HIT);
      }
      if (G.life[t] !== LIFE.routed && by >= 0 && G.side[by] !== G.side[t] && !alive(G.tgt[t])) G.tgt[t] = by;
      if (G.hp[t] <= 0) killRow(t, by);
    }
    function killRow(t, by) {
      G.hp[t] = 0; G.life[t] = LIFE.dead; G.spd[t] = 0; G.vx[t] = 0; G.vz[t] = 0;
      T.stats.kills[by >= 0 ? G.side[by] : (G.side[t] ? 0 : 1)]++;
      ev(EV.kill, t, by, G.mw[t]);
      if (G.kind[t] === 0) {
        const x = G.x[t], z = G.z[t], sd = G.side[t];
        forDisc(GF, x, z, 7, function (o) {
          if (o === t || G.side[o] !== sd || G.kind[o] !== 0 || !alive(o) || G.tier[o] === TIER.full) return;
          const dx = G.x[o] - x, dz = G.z[o] - z;
          if (dx * dx + dz * dz < 49) G.supp[o] = Math.min(MK.SUPP_CAP, G.supp[o] + MK.SUPP_MATE);
        });
      }
    }
    // a FULL unit's round landed on a row (the host's hurtMan, for a ghost)
    T.hurt = function (t, dmg, by, head) {
      if (!alive(t) || G.tier[t] === TIER.full) return false;
      if (dmg <= 0) {
        G.supp[t] = Math.min(MK.SUPP_CAP, G.supp[t] + MK.SUPP_SNAP * 0.8); G.iqs[t] = Math.max(G.iqs[t], 0.7);
        return false;
      }
      hurtRow(t, dmg, by == null ? -1 : by);
      return G.life[t] === LIFE.dead;
    };
    T.kill = function (t, by) { if (alive(t)) killRow(t, by == null ? -1 : by); };

    // ---------------------------------------------------------------- events
    function ev(type, a, b, v) {
      if (T.nEv * 4 + 4 > T.events.length) { const g = new Float32Array(T.events.length * 2); g.set(T.events); T.events = g; }
      const o = T.nEv * 4;
      T.events[o] = type; T.events[o + 1] = a; T.events[o + 2] = b; T.events[o + 3] = v;
      T.nEv++;
    }
    T.EV = EV;

    // ---------------------------------------------------------------- THE STEP
    let curMid = 0, curFar = 0, curSq = 0, accMid = 0, accFar = 0, accSq = 0;
    T.step = function (dt, ctx) {
      CTX = ctx;
      T.simT += dt;
      const tn = T.simT;
      const t0 = now();
      if (tn - hashAt >= TICK.hash || hashAt < 0) rehash();
      if (nav && nav.on) {
        if (tn - FL.at[0] > 1.4) flowSolve(0);
        else if (tn - FL.at[1] > 1.4) flowSolve(1);
      }
      const t1 = now(); T.ms.hash += t1 - t0;
      const n = S.rows;
      // MID: one slice of rows; each visited row integrates the exact time since its last visit
      accMid += n * dt / TICK.mid;
      let k = Math.min(n, accMid | 0); accMid -= k;
      const lim = t1 + BUD.mid;
      let done = 0;
      while (k-- > 0) {
        const r = curMid; curMid = (curMid + 1) % (n || 1);
        if (G.tier[r] !== TIER.mid) continue;
        const l = G.life[r];
        if (l !== LIFE.alive && l !== LIFE.routed) continue;
        const d = Math.min(2.0, tn - G.lastT[r]); G.lastT[r] = tn;
        if (d <= 0) continue;
        if (tn >= G.thinkAt[r]) {
          if (T.brain.mid) T.brain.mid(T, r, tn, d); else thinkMid(r);
        } else if (G.life[r] === LIFE.alive && alive(G.tgt[r])) aimTick(r, G.tgt[r], 0, T.profs[G.prof[r]]);
        if (G.life[r] === LIFE.fled) continue;
        move(r, d);
        fire(r, d);
        // the slice's budget: stop, and the rows not reached carry their time
        if ((++done & 31) === 0 && now() > lim) { accMid = Math.min(n, accMid + k); break; }
      }
      const t2 = now(); T.ms.mid += t2 - t1;
      // FAR: squads think on their own clock, men follow at the far tick
      if (SQ.n) {
        accSq += SQ.n * dt / TICK.squad;
        let ks = Math.min(SQ.n, accSq | 0); accSq -= ks;
        const limS = t2 + BUD.far * 0.5;
        let dq = 0;
        while (ks-- > 0) {
          const q = curSq; curSq = (curSq + 1) % SQ.n;
          if (tn >= SQ.thinkAt[q]) { thinkSquad(q); if ((++dq & 15) === 0 && now() > limS) { accSq = Math.min(SQ.n, accSq + ks); break; } }
        }
      }
      const t3 = now(); T.ms.squads += t3 - t2;
      accFar += n * dt / TICK.far;
      k = Math.min(n, accFar | 0); accFar -= k;
      const lim2 = t3 + BUD.far;
      done = 0;
      const TGs = G.tgt, LFs = G.life, LTs = G.lastT, SQs = G.sq, TRs = G.tier;
      while (k-- > 0) {
        const r = curFar; curFar = (curFar + 1) % (n || 1);
        if (TRs[r] !== TIER.far) continue;
        const l = LFs[r];
        if (l !== LIFE.alive && l !== LIFE.routed) continue;
        // A COLUMN OUT OF CONTACT keeps its own spacing and walks a straight
        // line: it is visited at the march tick, and the renderer carries
        // each man along his velocity in between (lastT is his clock)
        if (l === LIFE.alive && TGs[r] < 0 && tn - LTs[r] < TICK.march) {
          const q = SQs[r];
          if (q < 0 || SQ.tgt[q] !== 1) continue;
        }
        const d = Math.min(2.0, tn - LTs[r]); LTs[r] = tn;
        if (d <= 0) continue;
        if (T.brain.far) T.brain.far(T, r, tn, d); else updFarMan(r);
        if (LFs[r] === LIFE.fled) continue;
        move(r, d);
        fire(r, d);
        if ((++done & 31) === 0 && now() > lim2) { accFar = Math.min(n, accFar + k); break; }
      }
      const t4 = now(); T.ms.far += t4 - t3;
      applyHits();
    };
    T.SL = SL; T.TIER = TIER; T.LIFE = LIFE;
    // a row handed over from a FULL unit (demotion): its brain state starts clean
    T.adopt = function (r, st) {
      G.lastT[r] = T.simT; G.thinkAt[r] = T.simT; G.thinkLast[r] = T.simT - 0.25; G.losAt[r] = 0; G.bear[r] = NaN;
      if (st) {
        if (st.tgt != null) G.tgt[r] = st.tgt;
        if (st.supp != null) G.supp[r] = st.supp;
        if (st.mag != null) G.mag[r] = st.mag;
        if (st.cool != null) G.cool[r] = st.cool;
        if (st.reloadT != null) G.reloadT[r] = st.reloadT;
        if (st.crouch != null) G.crouch[r] = st.crouch;
        if (st.routT != null) G.routT[r] = st.routT;
        if (st.rallyT != null) G.rallyT[r] = st.rallyT;
      }
    };
    return T;
  }
  CBZ.battleTierSim = { create: create, EV: EV };
  if (typeof module !== "undefined" && module.exports) module.exports = CBZ.battleTierSim;
})();
