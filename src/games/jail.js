/* ============================================================
   games/jail.js — LOCKUP, as a GAME PACKAGE.

   The recursive-platform proof the owner named: "jail gives option to be
   jailor or in jail." ONE prison sim standing in the CITY, two games on it:

     role INMATE — getting arrested (the city's REAL capture funnel,
       CBZ.cityBust — wrapped below with the _jailWrapped idiom) now lands
       you in a real cell in the city jail venue with a SENTENCE scaled to
       your wanted level, and three ways out:
         · SERVE IT   — time passes (day clock rolls, dayPhase-aware), you
                        "do your time" for a small respect gain.
         · BRIBE      — real city cash to the corrupt guard, at a steep price.
         · ESCAPE     — a panel lockpick minigame (telegraphed sweet spots)
                        pops the cell, then you SLIP PAST the sweeping guard
                        posts to the wall gap. Getting out sets your wanted
                        level HIGH (the real CBZ.cityAddStars + escaped-convict
                        floor) — the manhunt follows you into the street.
     role JAILOR — [E] at the gate desk signs you on for a PAID guard shift:
         · PATROL     — hit checkpoint beats on a timer for wages.
         · SHAKEDOWN  — a cell flags contraband; confiscate it for a bonus.
         · BREAKS     — seeded inmate peds periodically make a run for the
                        wall gap; CATCH them (proximity + the real
                        CBZ.cityRestrain verbs) before they get over for the
                        payout. Miss three and the shift ends in disgrace.

   WHAT IS REUSED (engine), not forked:
     - CAPTURE FUNNEL: the city's own arrest pipeline (city/wanted.js bust()
       → today: fine + Cell Block Z escape mode). We wrap the PUBLIC seam
       CBZ.cityBust. Flag off — or an active campaign, or the standalone
       CELL BLOCK Z escape mode — falls straight through to the original,
       byte-identical. The separate escape MODE is never touched.
     - PEDS: guards (role "guard" → Guard Blacks, NOT the cop flag) and
       inmates (seeded civvies in jail orange) are REAL city peds via
       ctx.npc — brain, wardrobe, gunpoint hands-up, cityKillPed death,
       collision. Posts hold with ped.staffPost; a break un-pins one and we
       march it like restrain.js marches a captive.
     - WANTED: escaping reuses CBZ.cityAddStars / g.escapedConvict (the same
       3★-floor manhunt a jailbreak already implies elsewhere).
     - MONEY: bribes/wages are REAL city cash through ctx.wallet.
     - RESTRAIN: catching a runner uses CBZ.cityRestrain.cuff + the precinct
       intake, the same verbs bounty-hunting already exposes.
   WHAT IS ADDED (domain only): the walled jail compound (cells with real
   y0/y1 door colliders, guard posts, the wall gap, the gate desk), the two
   role loops, the panels, the lockpick model, and the thin sim glue.

   Determinism: BUILD paths use ctx.rand/ctx.stream only (multiplayer law).
   Live gameplay RNG (lockpick sweet spots, which inmate breaks) is runtime.
   Revert: CBZ.CONFIG.PKG_JAIL = false → nothing mounts, the wrap no-ops,
   every arrest reverts to the original outcome.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.games) return;
  const THREE = window.THREE;
  const g = CBZ.game;

  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.PKG_JAIL == null) CBZ.CONFIG.PKG_JAIL = true;
  function jailOn() { return CBZ.CONFIG.PKG_JAIL !== false; }

  /* ==========================================================
     1. PURE RULES — plain functions, unit-testable via api.
     ========================================================== */
  // sentence (in "jail-seconds") scales with the worst thing you were wanted
  // for at the moment of the collar. A 1★ pinch is a short beat; a 5★ spree
  // is a long stretch.
  const SENTENCE_BASE = 16, SENTENCE_PER_STAR = 12;
  function sentenceFor(wanted) {
    const w = Math.max(1, Math.min(5, wanted | 0));
    return SENTENCE_BASE + SENTENCE_PER_STAR * w;
  }
  // the corrupt guard's price: steep, and it climbs hard with your stars —
  // the DA wants more to make a serious jacket disappear.
  const BRIBE_BASE = 500, BRIBE_PER_STAR = 850;
  function bribeCost(wanted) {
    const w = Math.max(1, Math.min(5, wanted | 0));
    return BRIBE_BASE + BRIBE_PER_STAR * w;
  }
  // lockpick: N pins, a cursor sweeps 0..1, a telegraphed sweet zone. A pin is
  // set when you commit inside the band; the band NARROWS each pin (the last is
  // a razor). Pure judge so a probe can rig exact rolls.
  const LOCK_PINS = 3, LOCK_ATTEMPTS = 5;
  function lockHalfWidth(pin) { return Math.max(0.05, 0.16 - 0.035 * (pin | 0)); }
  function lockpickJudge(cursor, center, hw) { return Math.abs(cursor - center) <= hw; }

  // jailor economy — real cash for real work.
  const WAGES = { checkpoint: 120, catch: 400, confiscate: 250, shiftBonus: 300, signOn: 0 };
  const SHIFT_MISS_LIMIT = 3;

  // runtime feel constants
  const SERVE_SPEED = 3.2;          // jail-seconds served per real second
  const SERVE_DAY_RATE = 0.010;     // dayPhase advanced per real second while serving
  const RECAP_PENALTY = 14;         // sentence added when a break is foiled
  const GUARD_SEE_R = 7.0;          // breakout: a guard clocks you inside this radius…
  const GUARD_CONE = 0.85;          // …and within this half-angle of its gaze
  const GAP_REACH = 2.4;            // reaching the wall gap = free
  const CATCH_R = 2.6;              // jailor: grab a runner inside this radius
  const RUNNER_REACH = 2.2;         // a runner over the wall gap = a miss
  const CP_REACH = 3.0;             // patrol checkpoint hit radius

  // one reseedable runtime RNG (gameplay only — never a build path)
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  let rng = mulberry32(0x1A11B0);
  function seedRng(s) { rng = mulberry32((s | 0) || 1); }

  /* ==========================================================
     2. MODULE STATE + venue refs
     ========================================================== */
  let C = null;      // package ctx (once mounted)
  let V = null;      // venue refs { origin, ready, cells[], guards[], inmates[], posts[], checkpoints[], gate, gap, ... }
  let S = null;      // persisted record bag
  let INM = null;    // inmate arc: { phase, sentence, served, wanted0, bribe, lock, attempts, ... }
  let JOB = null;    // jailor shift: { active, cpIdx, misses, caught, wage, escape, shakedown, ... }
  let panelMode = null;
  let near = false;

  function bag() { return S || (S = C.state(() => ({ stints: 0, served: 0, bribed: 0, escapes: 0, shifts: 0, catches: 0, breaksStopped: 0, wagesEarned: 0 }))); }
  function save() { if (C) C.saveState(); }
  function fmt(n) { return "$" + Math.round(n || 0).toLocaleString("en-US"); }
  function feed(m, col) { if (C) C.hud.feed(m, col); }
  function big(m) { if (CBZ.city && CBZ.city.big) CBZ.city.big(m); else feed(m, "#ffd166"); }
  function toast(m) { if (C) C.hud.toast(m); }
  function respect(n) { if (CBZ.city && CBZ.city.addRespect) { try { CBZ.city.addRespect(n); } catch (e) {} } }
  function stars() { return (CBZ.cityStars ? CBZ.cityStars() : (g.wanted | 0)) | 0; }
  function W(lx, lz) { return { x: V.origin.x + lx, z: V.origin.z + lz }; }
  function playerNear(lx, lz, r) { const P = CBZ.player; if (!P || !P.pos) return false; const w = W(lx, lz); return Math.hypot(P.pos.x - w.x, P.pos.z - w.z) <= r; }

  // pointer-lock / input suppression while a modal panel is up (city convention)
  function menuLock(on) { try { CBZ.cityMenuOpen = !!on; } catch (e) {} }

  /* ==========================================================
     3. BUILD — the jail compound. Deterministic, chunky, every prop a job.
        Local axis-aligned coords (the group is never rotated so ctx.solid's
        world AABBs stay in sync with the meshes).

        Footprint (local): yard interior X∈[-10,10], Z∈[-8,8].
          · GATE + desk on the +Z (front) wall — the entrance / sign-on.
          · 3 CELLS along the -X (west) wall, doors facing +X into the yard.
          · GUARD POSTS in the yard (peds sweep them — the patrol rotation).
          · WALL GAP at the -Z/+X back corner — the escape target (no collider).
     ========================================================== */
  const MAT = { wall: 0x6b7079, wallD: 0x4d525a, bar: 0x2b2f36, floor: 0x3c4046, desk: 0x4a2e1c,
    deskD: 0x33200f, bunk: 0x555a63, gold: 0xe8b64c, orange: 0xcf6a2a, rubble: 0x5a5148, sign: 0x11151b, wire: 0xb9bec6 };

  function build(ctx, venue) {
    C = ctx;
    const gp = venue.group;
    V = { origin: venue.origin, ready: false, _venue: venue, group: gp,
      cells: [], guards: [], inmates: [], posts: [], checkpoints: [], pending: [],
      gate: { x: 0, z: 7.2 }, gap: { x: 7.5, z: -8 } };

    const box = (x, y, z, w, h, d, m, ry) => ctx.box(gp, x, y, z, w, h, d, ctx.mat(m), ry);
    const WALL_H = 3.2, WALL_T = 0.6;

    // ---- FLOOR pad (reads as a yard; also the visual footprint) -------------
    box(0, 0.02, 0, 21.2, 0.12, 17.2, MAT.floor);

    // ---- PERIMETER WALLS (chunky) with a GATE gap (+Z) and a WALL GAP (-Z) --
    // wallSeg(cx,cz,w,h,d): a box wall centred at (cx,cz) + a matching collider.
    const wall = (cx, cz, w, h, d) => wallSeg(box, ctx, cx, cz, w, h, d);
    // front (+Z=8): two segments flanking the 4u gate opening at X∈[-2,2]
    wall(-6, 8, 8, WALL_H, WALL_T);      // front-left  (X -10..-2)
    wall(6, 8, 8, WALL_H, WALL_T);       // front-right (X  2..10)
    // back (-Z=-8): one run, leaving the WALL GAP open at X∈[5.5,9.5] (no collider)
    wall(-2.25, -8, 15.5, WALL_H, WALL_T);   // back-left (X -10..5.5)
    // the busted edge beside the gap + a rubble spill (the escape hole reads)
    wallStub(box, ctx, 5.2, -8, 0.6, WALL_T, WALL_H * 0.55);
    rubblePile(box, ctx, 7.5, -7.3);
    // left (-X=-10) and right (+X=10): full runs along Z
    wall(-10, 0, WALL_T, WALL_H, 16);
    wall(10, 0, WALL_T, WALL_H, 16);
    // razorwire coils along the tops (thin, purely the LOOK of a hard yard)
    for (let x = -9; x <= 9; x += 2.2) wireCoil(ctx, gp, x, WALL_H + 0.18, 8);
    for (let x = -9; x <= 9; x += 2.2) { if (x > 5 && x < 9.6) continue; wireCoil(ctx, gp, x, WALL_H + 0.18, -8); }

    // ---- 3 contiguous CELLS along the west wall. Interior X∈[-10,-6.6]
    //      (depth 3.4), centred on Z; dividers between/around them. ----
    const cellZ = [-3.4, 0, 3.4], cellHalf = 1.7, doorX = -6.6, cellX = -8.3, doorH = WALL_H - 0.3;
    const dividers = [-5.1, -1.7, 1.7, 5.1];              // 4 walls make 3 cells
    for (const dz of dividers) wall(cellX, dz, 3.4, WALL_H - 0.4, WALL_T);   // run along X
    for (let i = 0; i < 3; i++) {
      const cz = cellZ[i];
      box(-9.1, 0.55, cz, 1.3, 0.35, 2.0, MAT.bunk);      // a bunk — it reads as a cell
      // the barred DOOR: a real y0/y1 gate collider across the doorway (X=doorX),
      // plus the visual bars we toggle off when it swings open.
      const dc = ctx.solid(doorX - 0.18, cz - cellHalf, doorX + 0.18, cz + cellHalf, 0.0, doorH);
      const bars = new THREE.Group(); gp.add(bars);
      barGate(ctx, bars, doorX, cz, cellHalf, doorH);
      V.cells.push({ i, lz: cz, lx: cellX, doorX, half: cellHalf, doorCol: dc, bars, locked: true });
    }
    // cell 1 (middle) is the PLAYER cell — stands empty & OPEN until an arrest.
    setDoor(V.cells[1], false);

    // ---- GATE DESK (front, inside the entrance): sign-on point + corrupt guard
    box(0, 0.6, 6.6, 3.0, 1.2, 0.9, MAT.desk);
    box(0, 1.25, 6.6, 3.1, 0.14, 1.0, MAT.deskD);
    ctx.solid(-1.5, 6.1, 1.5, 7.1, 0.0, 1.25);
    signBoard(ctx, gp, 0, 2.5, 8.05, "CITY  JAIL");

    // ---- GUARD POSTS (yard) — peds sweep these; the ring is the patrol rotation
    V.posts = [ { lx: 2.5, lz: -4.5, face: Math.PI }, { lx: 5.5, lz: 3.0, face: -Math.PI / 2 }, { lx: -2.0, lz: 4.5, face: 0 } ];
    // ---- PATROL CHECKPOINTS (jailor beat) — around the OPEN yard (clear of cells)
    V.checkpoints = [ { lx: -5.0, lz: 6.5 }, { lx: 8.0, lz: 6.5 }, { lx: 8.0, lz: -6.5 }, { lx: -5.0, lz: -6.5 } ];

    // ---- the LOOK: a few flood lights (≤8 budget) --------------------------
    ctx.light(0, 5.2, 0, 0xfff1d8, 0.9, 20);
    ctx.light(7.2, 4.0, -6.5, 0xffcaa0, 0.7, 10);      // the gap glows (the eye finds the way out)
    ctx.light(-8, 4.0, 0, 0xbfe0ff, 0.5, 9);           // cell block

    // ---- CAST (deferred: real peds want the live arena, casino/boxing pattern)
    // 3 guards in GUARD BLACKS (role "guard" → security-guard fit, NOT cop).
    for (let i = 0; i < 3; i++) {
      const p = V.posts[i];
      queue({ role: "guard", name: "Officer " + guardName(ctx, i), outfit: "security",
        at: [p.lx, p.lz], face: p.face, post: "pinned", pose: "stand",
        dialogue: ["Keep moving. Nothing to see.", "You do NOT want to be out here after lights-out.", "Wall's electrified. Don't be stupid."] }, "guard");
    }
    // the corrupt guard behind the gate desk (the bribe man / sign-on)
    queue({ role: "guard", name: "Sgt. " + guardName(ctx, 9), outfit: "security",
      at: [0, 6.0], face: 0, post: "pinned", pose: "stand",
      dialogue: ["Everything's for sale in here, friend.", "Doing a shift? Or doing time?"] }, "sarge");
    // inmate peds in the two flanking cells — seeded civvies in jail orange
    for (let i = 0; i < 2; i++) {
      const ci = i === 0 ? 0 : 2, cz = cellZ[ci];
      queue({ role: "inmate", name: inmateName(ctx, i), outfit: MAT.orange,
        at: [-8.6, cz], face: Math.PI / 2, post: "pinned", pose: "stand",
        dialogue: ["I been in here longer than the walls.", "You get one shot at that gap. Don't waste it.", "The Sarge takes cash. Everybody knows."] }, "inmate:" + ci);
    }

    // ---- ZONES (stable interactions) ---------------------------------------
    // the GATE DESK: sign on as a guard, OR (mid-arc) the inmate handle.
    ctx.zone({ id: "gate", pos: [0, 7.6], r: 2.6,
      label: () => {
        if (INM) return "[E] Back to your cell (you're an inmate)";
        if (JOB && JOB.active) return "[E] Clock off the guard shift";
        return "[E] LOCKUP — sign on for a guard shift";
      },
      onUse: () => {
        if (INM) { openInmate(); return; }
        if (JOB && JOB.active) { endShift("clocked off"); return; }
        startShift();
      } });
    // the CELL: re-open the inmate arc if you wandered the panel closed.
    ctx.zone({ id: "cell", pos: [V.cells[1].lx, V.cells[1].lz], r: 2.2,
      canShow: () => !!INM,
      label: () => "[E] Your options",
      onUse: () => { if (INM) openInmate(); } });

    V.ready = true;
  }

  // ---- small deterministic name pickers (build path → ctx.rand) -----------
  const GUARD_NAMES = ["Petrov", "Okafor", "Dunn", "Reyes", "Salk", "Voss", "Kane", "Marsh", "Hale", "Boyd"];
  const INMATE_NAMES = ["Slink", "Two-Time", "Ratchet", "Domino", "Whistler", "Bishop"];
  function guardName(ctx, i) { return GUARD_NAMES[Math.floor(ctx.rand(i, 7, "guard") * GUARD_NAMES.length) % GUARD_NAMES.length]; }
  function inmateName(ctx, i) { return INMATE_NAMES[Math.floor(ctx.rand(i, 3, "inmate") * INMATE_NAMES.length) % INMATE_NAMES.length]; }

  // ---- geometry helpers (chunky members, ≥0.3u, grounded) -----------------
  // a solid wall box centred at (cx,cz) with size (w,h,d) + a matching world
  // collider spanning y0=0..h (the y0/y1 gate shape used for cell doors too).
  function wallSeg(box, ctx, cx, cz, w, h, d) {
    box(cx, h / 2, cz, w, h, d, MAT.wall);
    ctx.solid(cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2, 0.0, h);
  }

  // barred cell-door bars between chunky top/bottom rails (visual; the collider
  // is the real barrier). Toggled off when the door swings open.
  function barGate(ctx, parent, x, z, half, h) {
    const bx = (lx, ly, lz, w, hh, d, m) => ctx.box(parent, lx, ly, lz, w, hh, d, ctx.mat(m));
    bx(x, 0.2, z, 0.22, 0.3, half * 2 + 0.2, MAT.wallD);       // bottom rail (chunky)
    bx(x, h - 0.15, z, 0.22, 0.3, half * 2 + 0.2, MAT.wallD);  // top rail
    for (let bz = -half + 0.2; bz <= half - 0.2 + 1e-6; bz += 0.42)
      ctx.cyl(parent, x, h / 2, z + bz, 0.05, 0.05, h - 0.4, ctx.mat(MAT.bar), 6);   // vertical bar
  }
  function wallStub(box, ctx, cx, cz, len, t, h) { box(cx, h / 2, cz, len, h, t, MAT.wallD); }
  function rubblePile(box, ctx, cx, cz) {
    box(cx - 0.5, 0.35, cz, 1.0, 0.7, 0.9, MAT.rubble);
    box(cx + 0.6, 0.5, cz + 0.4, 0.8, 1.0, 0.8, MAT.rubble);
    box(cx + 0.1, 0.3, cz - 0.5, 0.9, 0.6, 0.7, MAT.rubble);
  }
  function wireCoil(ctx, parent, x, y, z) {
    const c = ctx.cyl(parent, x, y, z, 0.12, 0.12, 1.9, ctx.mat(MAT.wire), 6);
    c.rotation.z = Math.PI / 2;
  }
  function signBoard(ctx, parent, x, y, z, text) {
    const tex = ctx.canvasTex(256, 64, (cc, w, h) => {
      cc.fillStyle = "#11151b"; cc.fillRect(0, 0, w, h);
      cc.strokeStyle = "#e8b64c"; cc.lineWidth = 4; cc.strokeRect(4, 4, w - 8, h - 8);
      cc.fillStyle = "#e8b64c"; cc.font = "bold 30px Arial"; cc.textAlign = "center"; cc.textBaseline = "middle";
      cc.fillText(text, w / 2, h / 2);
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.8), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
    m.position.set(x, y, z); parent.add(m);
  }

  /* ---- toggle a cell door's real collider + its visual bars -------------- */
  function setDoor(cell, locked) {
    if (!cell) return;
    const arr = CBZ.colliders || (CBZ.colliders = []);
    const i = arr.indexOf(cell.doorCol);
    if (locked && i < 0) arr.push(cell.doorCol);
    else if (!locked && i >= 0) arr.splice(i, 1);
    cell.locked = !!locked;
    if (cell.bars) cell.bars.visible = !!locked;
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  }

  /* deferred cast (arena root/peds land after our order-88 build) */
  function queue(spec, tag) { if (V && V.pending) V.pending.push({ spec, tag }); }
  function arenaLive() { return !!(CBZ.city && CBZ.city.arena && CBZ.city.arena.root); }
  function drainCast() {
    if (!V || !V.pending) return;
    if (C.npc && !arenaLive()) return;                 // real peds want the live arena
    const pend = V.pending; V.pending = null;           // null first → idempotent
    for (const item of pend) {
      const h = C.npc(item.spec);
      if (item.tag === "guard") V.guards.push(h);
      else if (item.tag === "sarge") V.sarge = h;
      else if (item.tag && item.tag.indexOf("inmate:") === 0) {
        const ci = +item.tag.split(":")[1];
        h._cellIdx = ci; h._homeLz = V.cells[ci] ? V.cells[ci].lz : 0;
        V.inmates.push(h);
      }
    }
    // record each guard's base post + a scan phase so their gaze sweeps
    V.guards.forEach((h, i) => { if (h) { h._post = V.posts[i % V.posts.length]; h._scan = i * 1.7; } });
  }

  /* ==========================================================
     4. INMATE ARC — the arrest lands you in a cell; three ways out.
     ========================================================== */
  function beginInmate(opts) {
    if (!V || !V.ready || INM) return false;
    opts = opts || {};
    const w = Math.max(1, stars());
    // the collar concludes the manhunt (you're in custody) — the same finality
    // a real bust has. We snapshot the stars FIRST (they set the sentence).
    if (CBZ.cityWantedReset) { try { CBZ.cityWantedReset(); } catch (e) {} }
    INM = { phase: "held", sentence: sentenceFor(w), served: 0, wanted0: w,
      bribe: bribeCost(w), lock: null, attempts: LOCK_ATTEMPTS, peaceful: !!opts.peaceful };
    // teleport into the middle cell and lock it behind you
    const cell = V.cells[1];
    const wc = W(cell.lx, cell.lz);
    teleportPlayer(wc.x, wc.z);
    setDoor(cell, true);
    const s = bag(); s.stints++; save();
    big("BUSTED — CITY JAIL");
    feed("Booked. " + w + "★ jacket → " + INM.sentence + "s. Serve it, buy your way out, or run.", "#ffd166");
    openInmate();
    return true;
  }

  function teleportPlayer(x, z) {
    const P = CBZ.player; if (!P || !P.pos) return;
    P.pos.x = x; P.pos.z = z; if (P.vy != null) P.vy = 0;
    if (P.driving && CBZ.cityExitVehicle) { try { CBZ.cityExitVehicle(); } catch (e) {} }
    if (CBZ.playerChar && CBZ.playerChar.group) { CBZ.playerChar.group.position.x = x; CBZ.playerChar.group.position.z = z; }
  }

  function releaseInmate(reason) {
    if (!INM) return;
    const s = bag();
    setDoor(V.cells[1], false);                          // door swings open
    if (reason === "served") { s.served++; respect(2); big("TIME SERVED"); feed("You did your time. Back to the streets.", "#cfe8b0"); }
    else if (reason === "bribed") { s.bribed++; big("RELEASED"); feed("The Sarge pockets it. You never happened.", "#ffd166"); }
    else if (reason === "escaped") {
      s.escapes++;
      // OUT the wall gap — and HOT. Reuse the real wanted API + convict floor.
      const wg = W(V.gap.x + 1.5, V.gap.z - 2.0);
      teleportPlayer(wg.x, wg.z);
      g.escapedConvict = true;
      if (CBZ.cityAddStars) { try { CBZ.cityAddStars(4, "Jailbreak"); } catch (e) {} }
      else if (CBZ.cityForceStars) { try { CBZ.cityForceStars(4); } catch (e) {} }
      big("OVER THE WALL — MANHUNT");
      feed("You're out — and every cop in the city knows it. RUN.", "#ff9a9a");
    }
    save();
    INM = null; panelMode = null; menuLock(false); if (C) C.hud.closePanel();
  }

  // recapture (a foiled break): back in the cell, the stretch gets longer
  function recapture(byName) {
    if (!INM) return;
    const cell = V.cells[1]; const wc = W(cell.lx, cell.lz);
    teleportPlayer(wc.x, wc.z); setDoor(cell, true);
    INM.phase = "held"; INM.lock = null; INM.sentence += RECAP_PENALTY;
    big("CAUGHT");
    feed((byName ? byName + " drags you back. " : "Dragged back. ") + "+"+ RECAP_PENALTY + "s on the sentence.", "#ff9a9a");
    openInmate();
  }

  /* ---- lockpick minigame ------------------------------------------------- */
  function startLock() {
    if (!INM) return;
    INM.phase = "picking";
    INM.lock = { cursor: 0, dir: 1, speed: 0.9 + rng() * 0.35, pin: 0, center: 0.3 + rng() * 0.4, hw: lockHalfWidth(0), set: false };
    openLock();
  }
  function pickAttempt() {
    if (!INM || INM.phase !== "picking" || !INM.lock) return "not-picking";
    const L = INM.lock;
    if (lockpickJudge(L.cursor, L.center, L.hw)) {
      L.pin++;
      if (L.pin >= LOCK_PINS) {                          // lock is open
        INM.lock = null; INM.phase = "breakout";
        setDoor(V.cells[1], false);
        big("LOCK POPPED");
        feed("Cell's open. Now SLIP PAST the guards to the wall gap — mind their gaze.", "#cfe8b0");
        menuLock(false); if (C) C.hud.closePanel(); panelMode = null;
        return "open";
      }
      L.hw = lockHalfWidth(L.pin); L.center = 0.15 + rng() * 0.7; L.set = true;
      openLock();
      return "pin";
    }
    INM.attempts--;
    if (INM.attempts <= 0) {                              // the pick snaps — the block hears it
      INM.phase = "held"; INM.lock = null;
      feed("The pick SNAPS. A guard glances over — back to the bunk.", "#ff9a9a");
      openInmate();
      return "snapped";
    }
    feed("Pin slips. " + INM.attempts + " tries left.", "#ffd27b");
    openLock();
    return "miss";
  }

  /* ==========================================================
     5. JAILOR SHIFT — sign on, patrol, shake down, stop the breaks.
     ========================================================== */
  function startShift() {
    if (JOB && JOB.active) return;
    if (INM) { feed("You're an inmate right now — you can't work the door."); return; }
    JOB = { active: true, cpIdx: 0, cpTimer: 22, misses: 0, caught: 0, wage: 0,
      escape: null, shakedown: null, breakT: 16 + rng() * 10, shakeT: 24 + rng() * 12, t: 0 };
    const s = bag(); s.shifts++; save();
    big("ON DUTY — GUARD SHIFT");
    feed("Walk the beat: hit the flashing checkpoints, shake down contraband, and STOP the breaks. Three over the wall and you're fired.", "#cfe8b0");
    markCheckpoint();
  }
  function markCheckpoint() {
    if (!JOB || !JOB.active) return;
    feed("Checkpoint " + ((JOB.cpIdx % V.checkpoints.length) + 1) + "/" + V.checkpoints.length + " — walk to it.", "#9ad0ff");
  }
  function checkpointHit() {
    if (!JOB || !JOB.active) return;
    JOB.wage += WAGES.checkpoint;
    if (C) C.wallet.give(WAGES.checkpoint, "Beat pay");
    JOB.cpIdx++; JOB.cpTimer = 22;
    markCheckpoint();
  }

  // a seeded inmate makes a break: un-pin one and we march it to the gap.
  function rigEscape() {
    if (!JOB || !JOB.active || JOB.escape) return null;
    const pool = V.inmates.filter((h) => h && h.ped && !h.ped.dead && !h._parked);
    if (!pool.length) return null;
    const runner = pool[(rng() * pool.length) | 0];
    // open its cell, flag it wanted (so a cuff is a clean collar, no crime), run it.
    const cell = V.cells[runner._cellIdx]; if (cell) setDoor(cell, false);
    if (runner.ped) { runner.ped.staffPost = null; runner.ped.npcWanted = Math.max(1, runner.ped.npcWanted | 0); }
    JOB.escape = { h: runner, t: 0 };
    big("BREAK IN PROGRESS");
    feed("Runner loose from the cells! Cut them off before the wall.", "#ff9a9a");
    return runner;
  }
  function driveRunner(dt) {
    if (!JOB || !JOB.escape) return;
    const e = JOB.escape, h = e.h, ped = h && h.ped;
    if (!ped || ped.dead) { JOB.escape = null; return; }
    e.t += dt;
    // march toward the wall gap (derived motion, like restrain.js escorts)
    const goal = W(V.gap.x, V.gap.z + 1.2);
    const dx = goal.x - ped.pos.x, dz = goal.z - ped.pos.z, d = Math.hypot(dx, dz) || 1;
    const step = Math.min(d, 3.2 * dt);
    ped.pos.x += dx / d * step; ped.pos.z += dz / d * step; ped.pos.y = 0;
    if (ped.group) { ped.group.position.set(ped.pos.x, 0, ped.pos.z); ped.group.rotation.y = Math.atan2(dx, dz); }
    if (CBZ.animChar && ped.char) CBZ.animChar(ped.char, step / Math.max(dt, 1e-3), dt);
    // caught?
    const P = CBZ.player;
    if (P && Math.hypot(P.pos.x - ped.pos.x, P.pos.z - ped.pos.z) <= CATCH_R) { catchRunner(); return; }
    // over the wall = a miss
    if (d <= RUNNER_REACH) { missRunner(); return; }
  }
  // return a runner to its cell: re-home, re-pin, re-lock. The cell block never
  // empties (a missed runner is a fresh arrival taking the bunk) so the shift
  // keeps generating breaks.
  function homeInmate(h) {
    const ped = h && h.ped; if (!ped) return;
    if (CBZ.cityRestrain && CBZ.cityRestrain.release) { try { CBZ.cityRestrain.release(ped, { silent: true }); } catch (e) {} }
    ped.npcWanted = 0; ped._parked = false; if (ped.group) ped.group.visible = true;
    const cell = V.cells[h._cellIdx];
    if (cell) { const hw = W(-8.6, cell.lz); ped.pos.set(hw.x, 0, hw.z); if (ped.group) ped.group.position.set(hw.x, 0, hw.z); ped.staffPost = { x: hw.x, z: hw.z, face: Math.PI / 2 }; setDoor(cell, true); }
  }
  function catchRunner() {
    if (!JOB || !JOB.escape) return;
    const h = JOB.escape.h, ped = h && h.ped;
    // the REAL restrain verb makes the collar, then we walk them back inside.
    if (ped && CBZ.cityRestrain) { try { CBZ.cityRestrain.cuff(ped); } catch (e) {} }
    homeInmate(h);
    JOB.escape = null; JOB.caught++; JOB.wage += WAGES.catch;
    if (C) C.wallet.give(WAGES.catch, "Runner caught");
    const s = bag(); s.catches++; s.breaksStopped++; save();
    big("RUNNER DOWN"); toast("Caught — " + fmt(WAGES.catch));
  }
  function missRunner() {
    if (!JOB || !JOB.escape) return;
    const h = JOB.escape.h;
    homeInmate(h);                                   // gone over the wall — a replacement takes the cell
    JOB.escape = null; JOB.misses++;
    big("OVER THE WALL"); feed("One got away. Misses: " + JOB.misses + "/" + SHIFT_MISS_LIMIT, "#ff9a9a");
    if (JOB.misses >= SHIFT_MISS_LIMIT) endShift("disgrace");
  }

  // a cell flags contraband: go shake it down inside a window for a bonus.
  function rigShakedown() {
    if (!JOB || !JOB.active || JOB.shakedown) return null;
    const ci = (rng() * V.cells.length) | 0;
    JOB.shakedown = { cell: ci, t: 12 };
    feed("Contraband smell from a cell — [walk to it] to shake it down (" + Math.round(JOB.shakedown.t) + "s).", "#ffd27b");
    return JOB.shakedown;
  }
  function confiscate() {
    if (!JOB || !JOB.shakedown) return;
    JOB.shakedown = null; JOB.wage += WAGES.confiscate;
    if (C) C.wallet.give(WAGES.confiscate, "Contraband seized");
    toast("Contraband seized — " + fmt(WAGES.confiscate));
  }

  function endShift(reason) {
    if (!JOB) return;
    const s = bag();
    const disgrace = reason === "disgrace";
    let bonus = 0;
    if (!disgrace && JOB.misses <= 1) { bonus = WAGES.shiftBonus; if (C) C.wallet.give(bonus, "Clean shift bonus"); }
    s.wagesEarned += JOB.wage + bonus; save();
    if (disgrace) { big("SHIFT OVER — DISGRACED"); feed("Three over the wall. The warden pulls your badge. Wages: " + fmt(JOB.wage), "#ff9a9a"); }
    else { big("SHIFT COMPLETE"); feed("Clocked off. Caught " + JOB.caught + " · wages " + fmt(JOB.wage + bonus) + (bonus ? " (bonus)" : ""), "#cfe8b0"); }
    if (JOB.escape) homeInmate(JOB.escape.h);        // any live runner goes back inside
    JOB = null; if (C) C.hud.closePanel(); panelMode = null; menuLock(false);
  }

  /* ==========================================================
     6. UPDATE — drive whichever loop is live; sweep guards; cheap when idle.
     ========================================================== */
  function update(ctx, dt) {
    if (!V || !V.ready || (V._venue && ctx.venue !== V._venue)) return;
    if (V.pending && V.pending.length) drainCast();
    if (g.mode !== "city") { if (INM || JOB) abortAll(); return; }
    if (!dt || dt > 0.4) dt = 0.05;

    const P = CBZ.player;
    near = !!(P && P.pos && Math.hypot(P.pos.x - V.origin.x, P.pos.z - V.origin.z) < 60);

    // guards sweep their gaze (the telegraph) whenever anyone's watching.
    if (near || INM || JOB) sweepGuards(dt);

    // ---- INMATE loop ----
    if (INM) {
      if (P && P.dead) { abortAll(); return; }
      if (INM.phase === "serving") {
        INM.served += dt * SERVE_SPEED;
        if (CBZ.dayPhase) { try { CBZ.dayPhase(CBZ.dayPhase() + dt * SERVE_DAY_RATE); } catch (e) {} }
        if (panelMode === "serving") refreshServe();
        if (INM.served >= INM.sentence) releaseInmate("served");
      } else if (INM.phase === "picking" && INM.lock) {
        const L = INM.lock;
        L.cursor += L.dir * L.speed * dt;
        if (L.cursor >= 1) { L.cursor = 1; L.dir = -1; } else if (L.cursor <= 0) { L.cursor = 0; L.dir = 1; }
        if (panelMode === "lock") refreshLock();
      } else if (INM.phase === "breakout") {
        // reach the gap = free; caught in a guard's cone = back inside.
        if (playerNear(V.gap.x, V.gap.z, GAP_REACH)) { releaseInmate("escaped"); return; }
        const spot = guardSpots(P);
        if (spot) recapture(spot);
      }
      return;
    }

    // ---- JAILOR loop ----
    if (JOB && JOB.active) {
      JOB.t += dt;
      // patrol checkpoint (proximity)
      const cp = V.checkpoints[JOB.cpIdx % V.checkpoints.length];
      if (cp && playerNear(cp.lx, cp.lz, CP_REACH)) checkpointHit();
      else { JOB.cpTimer -= dt; if (JOB.cpTimer <= 0) { JOB.cpIdx++; JOB.cpTimer = 22; feed("Missed the beat — next checkpoint.", "#ffd27b"); markCheckpoint(); } }
      // shakedown window
      if (JOB.shakedown) {
        JOB.shakedown.t -= dt;
        const sc = V.cells[JOB.shakedown.cell];
        if (sc && playerNear(sc.lx, sc.lz, 2.4)) confiscate();
        else if (JOB.shakedown.t <= 0) { JOB.shakedown = null; feed("The contraband got flushed. Too slow.", "#ffd27b"); }
      } else { JOB.shakeT -= dt; if (JOB.shakeT <= 0) { JOB.shakeT = 26 + rng() * 14; rigShakedown(); } }
      // escape attempts
      if (JOB.escape) driveRunner(dt);
      else { JOB.breakT -= dt; if (JOB.breakT <= 0) { JOB.breakT = 18 + rng() * 14; rigEscape(); } }
      return;
    }
  }

  // guard gaze sweep = the "staffPost patrol rotation": each guard's facing
  // oscillates around its post, and the post itself drifts along the ring so
  // the coverage rotates. Telegraphed windows to slip through.
  function sweepGuards(dt) {
    for (let i = 0; i < V.guards.length; i++) {
      const h = V.guards[i], ped = h && h.ped; if (!ped || ped.dead) continue;
      const post = h._post || V.posts[i % V.posts.length];
      h._scan = (h._scan || 0) + dt * 0.8;
      const face = (post.face || 0) + Math.sin(h._scan) * 0.9;
      if (!ped._covered && !(ped.surrender)) { ped.group.rotation.y = face; if (ped.staffPost) ped.staffPost.face = face; }
    }
  }
  // is the player inside any guard's see-radius AND gaze cone? returns the
  // guard's name if spotted (the recapture cause).
  function guardSpots(P) {
    if (!P || !P.pos) return null;
    for (let i = 0; i < V.guards.length; i++) {
      const h = V.guards[i], ped = h && h.ped; if (!ped || ped.dead) continue;
      const dx = P.pos.x - ped.pos.x, dz = P.pos.z - ped.pos.z, d = Math.hypot(dx, dz);
      if (d > GUARD_SEE_R || d < 0.01) continue;
      const facing = ped.group ? ped.group.rotation.y : 0;
      let da = Math.atan2(dx, dz) - facing;
      while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
      if (Math.abs(da) <= GUARD_CONE) return (ped.data && ped.data.name) || ped.name || "A guard";
    }
    return null;
  }

  // clean teardown if the world/mode drops out from under an active loop.
  function abortAll() {
    if (V && V.cells && V.cells[1]) setDoor(V.cells[1], false);
    INM = null; JOB = null; panelMode = null; menuLock(false);
    if (C) C.hud.closePanel();
  }

  /* ==========================================================
     7. PANELS
     ========================================================== */
  const BTN = "display:inline-block;margin:3px 5px 3px 0;padding:9px 15px;border-radius:11px;cursor:pointer;font-weight:800;font-size:14px;user-select:none;box-shadow:0 3px 0 rgba(0,0,0,.4);";
  function btn(act, label, bg, dis) { return "<span data-act='" + act + "' style='" + BTN + "background:" + (bg || "#1c6b40") + ";" + (dis ? "opacity:.35;pointer-events:none;" : "") + "'>" + label + "</span>"; }
  function head(title, sub) { return "<div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:8px'><b style='letter-spacing:2px;color:#e8b64c'>" + title + "</b><span style='opacity:.7;font-size:12px'>" + (sub || "") + " · Esc closes</span></div>"; }

  function openInmate() {
    if (!INM) return;
    panelMode = "inmate"; menuLock(true);
    if (INM.phase === "serving") { openServe(); return; }
    if (INM.phase === "picking") { openLock(); return; }
    if (INM.phase === "breakout") { menuLock(false); if (C) C.hud.closePanel(); return; }
    const canBribe = C.wallet.cash() >= INM.bribe;
    C.hud.panel(
      head("LOCKUP — YOUR CELL", INM.wanted0 + "★ jacket") +
      "<div style='font-size:12px;opacity:.85;margin:2px 0 8px'>Sentence <b>" + INM.sentence + "s</b> · cash <b>" + fmt(C.wallet.cash()) + "</b></div>" +
      "<div style='display:flex;gap:14px;flex-wrap:wrap'>" +
        "<div style='flex:1;min-width:180px'><div style='color:#cfe8b0;font-weight:800;font-size:12px'>DO YOUR TIME</div>" +
          "<div style='font-size:12px;opacity:.85;margin:4px 0'>Wait it out. The block respects a man who serves.</div>" + btn("serve", "SERVE " + INM.sentence + "s", "#2a6b40") + "</div>" +
        "<div style='flex:1;min-width:180px'><div style='color:#ffd166;font-weight:800;font-size:12px'>BRIBE THE SARGE</div>" +
          "<div style='font-size:12px;opacity:.85;margin:4px 0'>Cash makes the jacket vanish. Steep.</div>" + btn("bribe", "PAY " + fmt(INM.bribe), canBribe ? "#8a6a1f" : "#4a4433", !canBribe) + "</div>" +
        "<div style='flex:1;min-width:180px'><div style='color:#ff9a9a;font-weight:800;font-size:12px'>ESCAPE</div>" +
          "<div style='font-size:12px;opacity:.85;margin:4px 0'>Pick the lock, slip the guards. You'll walk out HOT.</div>" + btn("escape", "PICK THE LOCK", "#8a1f1f") + "</div>" +
      "</div>",
      { serve: () => { INM.phase = "serving"; openServe(); },
        bribe: () => doBribe(),
        escape: () => startLock(),
        close: () => { menuLock(false); C.hud.closePanel(); } });
  }
  function openServe() {
    panelMode = "serving";
    C.hud.panel(
      head("DOING TIME", "the clock rolls") +
      "<div id='jl_serve' style='font-size:14px;margin:6px 0'></div>" +
      barHTML("jl_servebar", "linear-gradient(90deg,#6ab04c,#2a6b40)", 0) +
      "<div style='margin-top:8px'>" + btn("bribe", "Buy out — " + fmt(INM.bribe), "#8a6a1f") + btn("stop", "Back", "#26343c") + "</div>",
      { bribe: () => doBribe(), stop: () => { INM.phase = "held"; openInmate(); }, close: () => { menuLock(false); C.hud.closePanel(); } });
    refreshServe();
  }
  function refreshServe() {
    if (!INM) return;
    const pct = Math.max(0, Math.min(100, INM.served / INM.sentence * 100));
    const e = document.getElementById("jl_serve"); if (e) e.textContent = "Time left: " + Math.max(0, Math.ceil(INM.sentence - INM.served)) + "s";
    const b = document.getElementById("jl_servebar"); if (b) b.style.width = pct + "%";
  }
  function doBribe() {
    if (!INM) return;
    if (!C.wallet.spend(INM.bribe, "Bribed the guard")) { feed("Not enough cash for the Sarge."); return; }
    releaseInmate("bribed");
  }
  function openLock() {
    if (!INM || !INM.lock) { openInmate(); return; }
    panelMode = "lock";
    const L = INM.lock;
    C.hud.panel(
      head("PICKING THE LOCK", "pin " + (L.pin + 1) + "/" + LOCK_PINS + " · " + INM.attempts + " tries") +
      "<div style='font-size:12px;opacity:.85;margin:2px 0 8px'>Hit PICK when the marker is over the lit band. The band narrows each pin.</div>" +
      "<div id='jl_lockwrap' style='position:relative;height:26px;border-radius:8px;background:rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.18);overflow:hidden'>" +
        "<div id='jl_zone' style='position:absolute;top:0;bottom:0;background:rgba(106,176,76,.55)'></div>" +
        "<div id='jl_cur' style='position:absolute;top:0;bottom:0;width:3px;background:#ffd166'></div>" +
      "</div>" +
      "<div style='margin-top:8px'>" + btn("pick", "PICK", "#8a1f1f") + btn("give", "Give up", "#26343c") + "</div>",
      { pick: () => pickAttempt(), give: () => { INM.phase = "held"; INM.lock = null; openInmate(); }, close: () => { menuLock(false); C.hud.closePanel(); } });
    refreshLock();
  }
  function refreshLock() {
    if (!INM || !INM.lock) return;
    const L = INM.lock;
    const z = document.getElementById("jl_zone"); if (z) { z.style.left = ((L.center - L.hw) * 100) + "%"; z.style.width = (L.hw * 2 * 100) + "%"; }
    const c = document.getElementById("jl_cur"); if (c) c.style.left = (L.cursor * 100) + "%";
  }
  function barHTML(id, col, pct) { return "<div style='height:12px;border-radius:6px;background:rgba(0,0,0,.5);overflow:hidden;border:1px solid rgba(255,255,255,.18);margin:3px 0'><div id='" + id + "' style='height:100%;width:" + pct + "%;background:" + col + "'></div></div>"; }

  /* ==========================================================
     8. THE CAPTURE-FUNNEL SEAM — wrap CBZ.cityBust (the _jailWrapped idiom).
        Flag off, an active campaign, escape mode, or an unmounted venue all
        fall THROUGH to the original bust → the byte-identical fallback
        (fine + Cell Block Z handoff). Loads after us, so wrap it lazily.
     ========================================================== */
  function engageInmate() {
    return jailOn() && V && V.ready && g.mode === "city" && !INM && !(JOB && JOB.active)
      && !(CBZ.cityCampaignActive && CBZ.cityCampaignActive());
  }
  function wrapBust() {
    if (typeof CBZ.cityBust !== "function") return false;      // not loaded yet → retry
    if (CBZ.cityBust._jailWrapped) return true;                 // already wrapped → stop
    const orig = CBZ.cityBust;
    const wrapped = function (opts) {
      if (engageInmate()) { try { if (beginInmate(opts || {})) return; } catch (e) { console.error("[gamepkg:jail] arrest", e); } }
      return orig.apply(this, arguments);                       // fallback: unchanged
    };
    // copy EVERY *Wrapped marker forward (the explosion-wrapper law) so other
    // modules' idempotence guards survive us.
    for (const k in orig) { if (/Wrapped$/.test(k)) wrapped[k] = orig[k]; }
    wrapped._jailWrapped = true;
    CBZ.cityBust = wrapped;
    return true;
  }
  if (!wrapBust()) { const iv = setInterval(function () { if (wrapBust()) clearInterval(iv); }, 0); }

  /* ==========================================================
     9. REGISTER — a SITE venue (no jail lot kind): resolve to the city's law
        intake (the precinct / City Hall desk) and build the compound out
        front, with a constants-ish fallback near arena centre.
     ========================================================== */
  CBZ.games.register({
    id: "jail",
    title: "LOCKUP",
    venue: {
      site: "cityjail",
      resolve(CBZ) {
        const st = CBZ.cityPoliceStation && CBZ.cityPoliceStation();
        if (st) {
          const lot = st.lot || {};
          const cx = lot.cx != null ? lot.cx : st.x, cz = lot.cz != null ? lot.cz : st.z;
          let ox = st.x - cx, oz = st.z - cz; const ol = Math.hypot(ox, oz) || 1; ox /= ol; oz /= ol;
          return { x: st.x + ox * 24, z: st.z + oz * 24 };       // out front of the law's door
        }
        const A = (CBZ.city && CBZ.city.arena) || CBZ._settlementArena;
        if (A && A.root && A.lots && A.lots.length) {             // constants fallback: arena centre-ish
          const l0 = A.lots[0];
          return { x: (l0.cx || 0) + 30, z: (l0.cz || 0) + 30 };
        }
        return null;                                             // world not ready → retry
      },
    },
    build(ctx, venue) { build(ctx, venue); },
    update(ctx, dt) { try { update(ctx, dt); } catch (e) { /* never break the frame loop */ } },

    /* probe surface — the gate asserts THROUGH this (numeric verify) */
    api: {
      rules: { sentenceFor, bribeCost, lockpickJudge, lockHalfWidth, WAGES, LOCK_PINS, LOCK_ATTEMPTS, SHIFT_MISS_LIMIT },
      mounted: () => !!(V && V.ready),
      near: () => near,
      arc: () => (INM ? { phase: INM.phase, sentence: INM.sentence, served: +INM.served.toFixed(2), wanted0: INM.wanted0, bribe: INM.bribe, attempts: INM.attempts, lock: INM.lock ? { cursor: +INM.lock.cursor.toFixed(3), center: +INM.lock.center.toFixed(3), hw: +INM.lock.hw.toFixed(3), pin: INM.lock.pin } : null } : null),
      shift: () => (JOB ? { active: JOB.active, cpIdx: JOB.cpIdx, misses: JOB.misses, caught: JOB.caught, wage: JOB.wage, escape: !!JOB.escape, shakedown: !!JOB.shakedown } : null),
      state: () => (S ? JSON.parse(JSON.stringify(S)) : null),
      cast: () => (V ? { guards: V.guards.length, inmates: V.inmates.length, sarge: !!V.sarge, cells: V.cells.length } : null),
      anchor: () => (V ? { x: V.origin.x, z: V.origin.z } : null),
      cellLocked: (i) => (V && V.cells[i] ? !!V.cells[i].locked : null),
      engages: () => engageInmate(),
      seed: (s) => seedRng(s),

      // ---- INMATE rigs ----
      // fire the REAL seam (respects the flag/guards) or force the arc directly.
      bust: (opts) => (CBZ.cityBust ? (CBZ.cityBust(opts || {}), true) : false),
      beginInmate: (opts) => beginInmate(opts || {}),
      serve: () => { if (INM) { INM.phase = "serving"; return true; } return false; },
      _serveComplete: () => { if (INM && INM.phase === "serving") { INM.served = INM.sentence; releaseInmate("served"); return true; } return false; },
      bribe: () => { if (INM) { doBribe(); return !INM; } return false; },
      startLock: () => (INM ? (startLock(), true) : false),
      setLock: (cursor, center, hw) => { if (INM && INM.lock) { if (cursor != null) INM.lock.cursor = cursor; if (center != null) INM.lock.center = center; if (hw != null) INM.lock.hw = hw; return true; } return false; },
      pick: () => pickAttempt(),
      reachGap: () => { if (INM && INM.phase === "breakout") { const wg = W(V.gap.x, V.gap.z); teleportPlayer(wg.x, wg.z); releaseInmate("escaped"); return true; } return false; },
      phase: () => (INM ? INM.phase : null),

      // ---- JAILOR rigs ----
      startShift: () => (startShift(), !!(JOB && JOB.active)),
      endShift: (why) => { endShift(why || "clocked off"); return !JOB; },
      hitCheckpoint: () => { if (JOB && JOB.active) { const cp = V.checkpoints[JOB.cpIdx % V.checkpoints.length]; const w = W(cp.lx, cp.lz); teleportPlayer(w.x, w.z); checkpointHit(); return JOB.cpIdx; } return -1; },
      rigEscape: () => { const r = rigEscape(); return !!r; },
      catch: () => { if (JOB && JOB.escape) { const ped = JOB.escape.h && JOB.escape.h.ped; if (ped) { const w = W(V.gap.x, V.gap.z + 3); teleportPlayer(w.x, w.z); ped.pos.set(w.x, 0, w.z); } catchRunner(); return true; } return false; },
      missEscape: () => { if (JOB && JOB.escape) { missRunner(); return true; } return false; },
      rigShakedown: () => { const s = rigShakedown(); return !!s; },
    },
  });
})();
