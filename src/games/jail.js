/* ============================================================
   games/jail.js — LOCKUP, as a GAME PACKAGE.

   ONE prison sim standing in the CITY, two roles on it — and ONE law
   (owner doctrine): the jail is ABOUT ESCAPING, and the guards exist to
   stop you. No arcade layer: no rhythm minigames, no checkpoint timers,
   no miss counters. Everything is physical and reuses the engine.

     role INMATE — getting arrested (the city's REAL capture funnel,
       CBZ.cityBust — wrapped below with the _jailWrapped idiom) lands
       you in a real cell in the city jail venue with a SENTENCE scaled
       to your wanted level, and three ways out:
         · SERVE  — time passes (day clock rolls, dayPhase-aware).
         · BRIBE  — real city cash to the corrupt guard, at a steep price.
         · ESCAPE — physical, never a minigame. Two acquired means:
                    PRY the cell door's loose plate, over real time, ONLY
                    while no patrolling guard's gaze is on you (real ped
                    sightlines — the same cone that recaptures you in the
                    yard); get caught working it and the plate is hammered
                    back + time added. OR lift the KEYS off a guard you've
                    dealt with — dead, or zip-tied through the bars (the
                    real cityRestrain collar). Door open → slip the
                    rotating patrols to the wall gap → over the wall HOT:
                    CBZ.cityAddStars + the escaped-convict floor, and the
                    manhunt follows you into the street.
     role JAILOR — the gate desk signs you on for a guard shift. No beat
       timers, no disgrace meter: seeded inmates periodically BREAK for
       the wall gap; SEE the runner, cut them off, and the cuff is the
       real CBZ.cityRestrain collar — each catch pays. A runner that gets
       over is simply gone (a fresh arrival takes the bunk). Clock off at
       the desk whenever.

   WHAT IS REUSED (engine), not forked:
     - CAPTURE FUNNEL: the city's own arrest pipeline (city/wanted.js
       bust()). We wrap the PUBLIC seam CBZ.cityBust. The wrap now
       GUARANTEES delivery: mid-mount arrests are HELD and delivered the
       moment the venue lands (wall-clock failsafe to the original bust),
       an arrest during a shift ends the shift first, and a bust while
       you're mid-breakout is a RECAPTURE — never a world swap out of the
       city run. Flag off / an active campaign / the standalone CELL
       BLOCK Z escape mode still fall through to the original,
       byte-identical.
     - PEDS: guards (role "guard" → Guard Blacks, NOT the cop flag) and
       inmates are REAL city peds via ctx.npc — brain, wardrobe, gunpoint
       hands-up, cityKillPed death, collision. Guards WALK a real patrol
       ring between posts (derived motion, the restrain.js escort
       pattern) and their gaze cones are the only detection there is.
     - WANTED: escaping reuses CBZ.cityAddStars / g.escapedConvict (the
       3★-floor manhunt). An arrest CLOSES a live manhunt including the
       convict floor (CBZ.cityClearConvict — you're in custody).
     - MONEY: bribes/wages are REAL city cash through ctx.wallet.
     - RESTRAIN: catching a runner uses CBZ.cityRestrain.cuff, the same
       verbs bounty-hunting exposes.
   WHAT IS ADDED (domain only): the walled compound (cells with real
   y0/y1 door colliders, the patrol ring, the wall gap, the gate desk),
   the two role loops, the pry/keys escape model, and the thin sim glue.

   Determinism: BUILD paths use ctx.rand/ctx.stream only (multiplayer
   law). Live gameplay RNG (which inmate breaks, when) is runtime.
   Revert: CBZ.CONFIG.PKG_JAIL = false → nothing mounts, the wrap
   no-ops, every arrest reverts to the original outcome.
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
  // the pry: seconds of UNOBSERVED work on the cell door's loose plate before
  // it gives. No sweet spots, no attempts — the only clock is the patrol.
  const PRY_TIME = 24;

  // jailor economy — real cash for real collars. Nothing else pays.
  const WAGES = { catch: 400 };

  // runtime feel constants
  const SERVE_SPEED = 3.2;          // jail-seconds served per real second
  const SERVE_DAY_RATE = 0.010;     // dayPhase advanced per real second while serving
  const RECAP_PENALTY = 14;         // sentence added when they drag you back / catch you prying
  const GUARD_SEE_R = 7.0;          // a guard clocks you inside this radius…
  const GUARD_CONE = 0.85;          // …and within this half-angle of its gaze
  const GAP_REACH = 2.4;            // reaching the wall gap = free
  const CATCH_R = 2.6;              // jailor: grab a runner inside this radius
  const RUNNER_REACH = 2.2;         // a runner over the wall gap = gone
  const POST_HOLD = 11;             // seconds a guard holds a post before walking the ring
  const GUARD_WALK = 1.7;           // patrol walk speed (u/s)

  // one reseedable runtime RNG (gameplay only — never a build path)
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  let rng = mulberry32(0x1A11B0);
  function seedRng(s) { rng = mulberry32((s | 0) || 1); }

  /* ==========================================================
     2. MODULE STATE + venue refs
     ========================================================== */
  let C = null;      // package ctx (once mounted)
  let V = null;      // venue refs { origin, ready, cells[], guards[], inmates[], posts[], gate, gap, ... }
  let S = null;      // persisted record bag
  let INM = null;    // inmate arc: { phase: held|serving|prying|breakout, sentence, served, wanted0, bribe, pry, ... }
  let JOB = null;    // jailor shift: { active, caught, wage, escape, breakT, t }
  let PENDING = null;   // an arrest accepted before the venue mounted (seam, §8)
  let ORIG_BUST = null; // the unwrapped city bust (pending-arrest failsafe)
  let panelMode = null;
  let near = false;

  function bag() { return S || (S = C.state(() => ({ stints: 0, served: 0, bribed: 0, escapes: 0, shifts: 0, catches: 0, breaksStopped: 0, wagesEarned: 0 }))); }
  function save() { if (C) C.saveState(); }
  function fmt(n) { return "$" + Math.round(n || 0).toLocaleString("en-US"); }
  function feed(m, col) { if (C) C.hud.feed(m, col); }
  function big(m) { if (CBZ.city && CBZ.city.big) CBZ.city.big(m); else feed(m, "#ffd166"); }
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
          · GUARD POSTS around the yard — the PATROL RING guards walk.
          · WALL GAP at the -Z/+X back corner — the escape target (no collider).
     ========================================================== */
  const MAT = { wall: 0x6b7079, wallD: 0x4d525a, bar: 0x2b2f36, floor: 0x3c4046, desk: 0x4a2e1c,
    deskD: 0x33200f, bunk: 0x555a63, gold: 0xe8b64c, orange: 0xcf6a2a, rubble: 0x5a5148, sign: 0x11151b, wire: 0xb9bec6 };

  function build(ctx, venue) {
    C = ctx;
    const gp = venue.group;
    V = { origin: venue.origin, ready: false, _venue: venue, group: gp,
      cells: [], guards: [], inmates: [], posts: [], pending: [],
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

    // ---- the PATROL RING: 4 posts, 3 guards — one post always stands EMPTY,
    //      and the empty slot rotates as the guards walk on. The gap-corner
    //      post is IN the ring, so the way out is only sometimes unwatched:
    //      the escape window is a real hole in a real rotation, not a timer.
    V.posts = [
      { lx: 2.5, lz: -4.5, face: Math.PI },
      { lx: 5.5, lz: 3.0, face: -Math.PI / 2 },
      { lx: -2.0, lz: 4.5, face: 0 },
      { lx: 6.5, lz: -5.5, face: Math.PI },      // gap corner — the watched exit
    ];

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
    // inmate peds in the two flanking cells — seeded civvies in jail orange.
    // Their mouths carry the escape hint (dialogue is the sanctioned teacher).
    for (let i = 0; i < 2; i++) {
      const ci = i === 0 ? 0 : 2, cz = cellZ[ci];
      queue({ role: "inmate", name: inmateName(ctx, i), outfit: MAT.orange,
        at: [-8.6, cz], face: Math.PI / 2, post: "pinned", pose: "stand",
        dialogue: ["I been in here longer than the walls.", "That door plate's been loose since the riot. Work it when their backs are turned.", "The Sarge takes cash. Everybody knows."] }, "inmate:" + ci);
    }

    // ---- ZONES (stable interactions). GRAMMAR LAW (owner): a zone label is a
    //      BUTTON — one or two words, no key glyphs, no names, no sentences.
    //      The card title comes from the venue (packages.js describe). ----
    ctx.zone({ id: "gate", pos: [0, 7.6], r: 2.6,
      label: () => {
        if (INM) return "Return";
        if (JOB && JOB.active) return "Clock off";
        return "Sign on";
      },
      onUse: () => {
        if (INM) { openInmate(); return; }
        if (JOB && JOB.active) { endShift("clocked off"); return; }
        startShift();
      } });
    // the CELL: re-open the sentence options if you wandered the panel closed.
    ctx.zone({ id: "cell", pos: [V.cells[1].lx, V.cells[1].lz], r: 2.2,
      canShow: () => !!INM && INM.phase !== "breakout" && INM.phase !== "prying",
      label: () => "Weigh options",
      onUse: () => { if (INM) openInmate(); } });
    // the DOOR PLATE: the physical escape. Pry = work it over time, unobserved.
    ctx.zone({ id: "pry", pos: [V.cells[1].doorX + 0.6, V.cells[1].lz], r: 1.9,
      canShow: () => !!INM && (INM.phase === "held" || INM.phase === "prying"),
      label: () => (INM && INM.phase === "prying" ? "Stop" : "Pry"),
      onUse: () => { if (!INM) return; if (INM.phase === "prying") stopPry(false); else startPry(); } });

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
  }

  /* ==========================================================
     4. INMATE ARC — the arrest lands you in a cell; three ways out.
     ========================================================== */
  function beginInmate(opts) {
    if (!V || !V.ready || INM) return false;
    opts = opts || {};
    const w = Math.max(1, stars());
    // the collar concludes the manhunt (you're in custody) — INCLUDING the
    // escaped-convict floor: without cityClearConvict a served/bribed release
    // walked you out into a re-asserted 3★ you'd already paid for.
    if (CBZ.cityWantedReset) { try { CBZ.cityWantedReset(); } catch (e) {} }
    if (CBZ.cityClearConvict) { try { CBZ.cityClearConvict(); } catch (e) {} }
    INM = { phase: "held", sentence: sentenceFor(w), served: 0, wanted0: w,
      bribe: bribeCost(w), pry: 0, _pryMark: 0, peaceful: !!opts.peaceful };
    // teleport into the middle cell and lock it behind you
    const cell = V.cells[1];
    const wc = W(cell.lx, cell.lz);
    teleportPlayer(wc.x, wc.z);
    setDoor(cell, true);
    const s = bag(); s.stints++; save();
    big("BUSTED — CITY JAIL");
    feed("Booked. " + w + "★ jacket → " + INM.sentence + "s.", "#ffd166");
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

  // recapture (spotted in the yard mid-breakout, or busted again outside
  // before you're clear): back in the cell, the stretch gets longer.
  function recapture(byName) {
    if (!INM) return;
    const cell = V.cells[1]; const wc = W(cell.lx, cell.lz);
    teleportPlayer(wc.x, wc.z); setDoor(cell, true);
    INM.phase = "held"; INM.sentence += RECAP_PENALTY;
    INM.pry = 0; INM._pryMark = 0;      // they bolt a fresh plate on the door
    big("CAUGHT");
    feed((byName ? byName + " drags you back. " : "Dragged back. ") + "+" + RECAP_PENALTY + "s on the sentence.", "#ff9a9a");
    openInmate();
  }

  /* ---- the PRY: physical escape, gated by real guard sightlines ---------- */
  function startPry() {
    if (!INM || (INM.phase !== "held" && INM.phase !== "prying")) return;
    INM.phase = "prying";
    panelMode = null; menuLock(false); if (C) C.hud.closePanel();
    feed("You work the door plate. Stop when the screws look over.", "#ffd27b");
  }
  function stopPry(quiet) {
    if (!INM || INM.phase !== "prying") return;
    INM.phase = "held";
    if (!quiet) feed("You ease off the plate.", "#cfd6e6");
  }
  // spotted mid-pry: no teleport (you're already in the cell) — the plate gets
  // hammered half back and the sentence grows. The spotting guard sells it.
  function caughtPrying(spot) {
    if (!INM) return;
    INM.phase = "held"; INM.sentence += RECAP_PENALTY; INM.pry *= 0.5; INM._pryMark = 0;
    if (spot && spot.ped && CBZ.citySay) { try { CBZ.citySay(spot.ped, "“Step AWAY from the door!”", "#ffd27b", 2.2); } catch (e) {} }
    feed((spot ? spot.name : "A guard") + " catches you at the door — the plate's hammered back. +" + RECAP_PENALTY + "s.", "#ff9a9a");
  }
  function popDoor(how) {
    if (!INM) return;
    INM.phase = "breakout";
    setDoor(V.cells[1], false);
    feed(how === "keys"
      ? "The keyring turns your lock. The gap's in the back corner. Mind their eyes."
      : "The plate gives — the door swings loose. The gap's in the back corner. Mind their eyes.", "#cfe8b0");
  }

  /* ---- GUARD KEYS: the second physical means (owner doctrine — escape is
     acquired, never a minigame). Every guard carries the ring; a guard you've
     DEALT WITH gives it up — dead (the kill bus already told the story) or
     zip-tied through the bars (gunpoint hands-up → the real cityRestrain
     collar). One reach-in and your door is open: no pry clock, straight to
     the breakout. Registered on the SHARED registry ("ped"/"corpse" layers)
     so the verbs ride the same card grammar as every street interaction —
     "Take keys" is a bare verb, the guard's name stays in the card title. */
  function jailGuardPed(p) {
    if (!V || !p) return false;
    if (V.sarge && V.sarge.ped === p) return true;
    for (let i = 0; i < V.guards.length; i++) if (V.guards[i] && V.guards[i].ped === p) return true;
    return false;
  }
  function canLiftKeys() { return !!(INM && (INM.phase === "held" || INM.phase === "prying")); }
  function takeKeys() {
    if (!canLiftKeys()) return;
    if (INM.phase === "prying") stopPry(true);   // drop the pry mid-motion — the ring beats the plate
    popDoor("keys");
  }
  if (CBZ.interactions && CBZ.interactions.register) {
    // a restrained guard (cuffed or marched) surrenders the ring
    CBZ.interactions.register("ped", {
      id: "jail-keys", slot: "e", prio: 95,
      canShow: (p) => canLiftKeys() && jailGuardPed(p) && !p.dead &&
        !!(CBZ.cityRestrain && /^(cuffed|escorted)$/.test(CBZ.cityRestrain.stateOf(p) || "")),
      label: "Take keys",
      onSelect: () => takeKeys(),
    });
    // a dead guard can't hold onto anything
    CBZ.interactions.register("corpse", {
      id: "jail-keys-corpse", slot: "e", prio: 95,
      canShow: (b) => canLiftKeys() && jailGuardPed(b),
      label: "Take keys",
      onSelect: () => takeKeys(),
    });
  }

  /* ==========================================================
     5. JAILOR SHIFT — sign on, walk the block, stop the breaks.
        No beat timers, no miss meters: runners are real peds making a
        real run; each collar pays; a runner that clears the wall is gone.
     ========================================================== */
  function startShift() {
    if (JOB && JOB.active) return;
    if (INM) { feed("You're an inmate right now — you can't work the door."); return; }
    JOB = { active: true, caught: 0, wage: 0, escape: null, breakT: 14 + rng() * 10, t: 0 };
    const s = bag(); s.shifts++; save();
    feed("On duty. Runners go for the back-corner gap — cuff them before they're over.", "#cfe8b0");
  }

  // a seeded inmate makes a break: un-pin one and march it to the gap.
  function rigEscape() {
    if (!JOB || !JOB.active || JOB.escape) return null;
    const pool = V.inmates.filter((h) => h && h.ped && !h.ped.dead && !h._parked);
    if (!pool.length) return null;
    const runner = pool[(rng() * pool.length) | 0];
    // open its cell, flag it wanted (so a cuff is a clean collar, no crime), run it.
    const cell = V.cells[runner._cellIdx]; if (cell) setDoor(cell, false);
    if (runner.ped) { runner.ped.staffPost = null; runner.ped.npcWanted = Math.max(1, runner.ped.npcWanted | 0); }
    if (runner.ped && CBZ.citySay) { try { CBZ.citySay(runner.ped, "“See you around, screw!”", "#ff9a9a", 2.0); } catch (e) {} }
    JOB.escape = { h: runner, t: 0 };
    feed("Runner loose from the cells!", "#ff9a9a");
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
    // over the wall = gone
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
  }
  function missRunner() {
    if (!JOB || !JOB.escape) return;
    const h = JOB.escape.h;
    homeInmate(h);                                   // gone over the wall — a replacement takes the cell
    JOB.escape = null;
    feed("One got over the wall.", "#ff9a9a");
  }

  function endShift(reason) {
    if (!JOB) return;
    const s = bag();
    s.wagesEarned += JOB.wage; save();
    if (JOB.escape) homeInmate(JOB.escape.h);        // any live runner goes back inside
    if (reason === "arrested") feed("Badge pulled — you're going in the cells yourself.", "#ff9a9a");
    else feed("Clocked off. Caught " + JOB.caught + " runner" + (JOB.caught === 1 ? "" : "s") + " · " + fmt(JOB.wage), "#cfe8b0");
    JOB = null; if (C) C.hud.closePanel(); panelMode = null; menuLock(false);
  }

  /* ==========================================================
     6. UPDATE — drive whichever loop is live; march the patrol ring;
        cheap when idle.
     ========================================================== */
  function update(ctx, dt) {
    if (!V || !V.ready || (V._venue && ctx.venue !== V._venue)) return;
    if (V.pending && V.pending.length) drainCast();
    if (g.mode !== "city") { if (INM || JOB || PENDING) abortAll(); return; }
    if (!dt || dt > 0.4) dt = 0.05;

    // a collar accepted before the venue mounted lands the moment we tick
    if (PENDING) deliverPending(false);

    const P = CBZ.player;
    near = !!(P && P.pos && Math.hypot(P.pos.x - V.origin.x, P.pos.z - V.origin.z) < 60);

    // the patrol ring walks whenever anyone's watching — the guards' gaze
    // cones ARE the detection model, so the ring is the whole game.
    if (near || INM || JOB) marchGuards(dt);

    // ---- INMATE loop ----
    if (INM) {
      if (P && P.dead) { abortAll(); return; }
      if (INM.phase === "serving") {
        INM.served += dt * SERVE_SPEED;
        if (CBZ.dayPhase) { try { CBZ.dayPhase(CBZ.dayPhase() + dt * SERVE_DAY_RATE); } catch (e) {} }
        if (panelMode === "serving") refreshServe();
        if (INM.served >= INM.sentence) releaseInmate("served");
      } else if (INM.phase === "prying") {
        // progress ONLY at the door and ONLY unobserved — the patrol is the clock
        const cell = V.cells[1];
        if (!playerNear(cell.doorX + 0.3, cell.lz, 2.8)) { stopPry(true); return; }
        const spot = guardSpots(P);
        if (spot) { caughtPrying(spot); return; }
        INM.pry += dt;
        // diegetic progress — the metal tells you, no meter
        if (INM._pryMark === 0 && INM.pry >= PRY_TIME * 0.34) { INM._pryMark = 1; feed("The first bolt backs out.", "#ffd27b"); }
        else if (INM._pryMark === 1 && INM.pry >= PRY_TIME * 0.67) { INM._pryMark = 2; feed("The plate's half off. Nearly there.", "#ffd27b"); }
        if (INM.pry >= PRY_TIME) popDoor();
      } else if (INM.phase === "breakout") {
        // reach the gap = free; caught in a guard's cone = dragged back.
        if (playerNear(V.gap.x, V.gap.z, GAP_REACH)) { releaseInmate("escaped"); return; }
        const spot = guardSpots(P);
        if (spot) recapture(spot.name);
      }
      return;
    }

    // ---- JAILOR loop ----
    if (JOB && JOB.active) {
      JOB.t += dt;
      if (JOB.escape) driveRunner(dt);
      else { JOB.breakT -= dt; if (JOB.breakT <= 0) { JOB.breakT = 18 + rng() * 14; rigEscape(); } }
      return;
    }
  }

  // THE PATROL RING: 3 guards on 4 posts. Each guard holds a post (gaze
  // sweeping — the human telegraph), then WALKS to the next ring slot
  // (derived motion, the restrain.js escort pattern; staffPost stays synced
  // so the ped brain never fights the march). One post is always empty —
  // that rotating hole is the escape window, physics instead of a timer.
  function marchGuards(dt) {
    const n = V.posts.length;
    for (let i = 0; i < V.guards.length; i++) {
      const h = V.guards[i], ped = h && h.ped;
      if (!ped || ped.dead || ped.surrender || ped._covered) continue;
      if (h._ring == null) { h._ring = i % n; h._holdT = POST_HOLD * (0.55 + 0.3 * i); h._scan = i * 1.7; }
      const post = V.posts[h._ring % n];
      const goal = W(post.lx, post.lz);
      const dx = goal.x - ped.pos.x, dz = goal.z - ped.pos.z, d = Math.hypot(dx, dz);
      if (d > 0.35) {
        const step = Math.min(d, GUARD_WALK * dt);
        ped.pos.x += dx / d * step; ped.pos.z += dz / d * step; ped.pos.y = 0;
        if (ped.group) { ped.group.position.set(ped.pos.x, 0, ped.pos.z); ped.group.rotation.y = Math.atan2(dx, dz); }
        if (CBZ.animChar && ped.char) CBZ.animChar(ped.char, step / Math.max(dt, 1e-3), dt);
        if (ped.staffPost) { ped.staffPost.x = ped.pos.x; ped.staffPost.z = ped.pos.z; }
      } else {
        h._scan = (h._scan || 0) + dt * 0.8;
        const face = (post.face || 0) + Math.sin(h._scan) * 0.9;
        if (ped.group) ped.group.rotation.y = face;
        if (ped.staffPost) { ped.staffPost.x = goal.x; ped.staffPost.z = goal.z; ped.staffPost.face = face; }
        h._holdT -= dt;
        if (h._holdT <= 0) { h._ring = (h._ring + 1) % n; h._holdT = POST_HOLD; }
      }
    }
  }
  // is the player inside any guard's see-radius AND gaze cone? Returns
  // { ped, name } of the spotter (recapture cause + the one who barks).
  function guardSpots(P) {
    if (!P || !P.pos) return null;
    for (let i = 0; i < V.guards.length; i++) {
      const h = V.guards[i], ped = h && h.ped; if (!ped || ped.dead) continue;
      const dx = P.pos.x - ped.pos.x, dz = P.pos.z - ped.pos.z, d = Math.hypot(dx, dz);
      if (d > GUARD_SEE_R || d < 0.01) continue;
      const facing = ped.group ? ped.group.rotation.y : 0;
      let da = Math.atan2(dx, dz) - facing;
      while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
      if (Math.abs(da) <= GUARD_CONE) return { ped, name: (ped.data && ped.data.name) || ped.name || "A guard" };
    }
    return null;
  }

  // clean teardown if the world/mode drops out from under an active loop.
  function abortAll() {
    if (V && V.cells && V.cells[1]) setDoor(V.cells[1], false);
    INM = null; JOB = null; PENDING = null; panelMode = null; menuLock(false);
    if (C) C.hud.closePanel();
  }

  /* ==========================================================
     7. PANELS — the sentence options only. GRAMMAR LAW (owner): every
        button is a VERB, one word (+ an optional number). The escape is
        NOT a button — it's a loose plate on a real door.
     ========================================================== */
  const BTN = "display:inline-block;margin:3px 5px 3px 0;padding:9px 15px;border-radius:11px;cursor:pointer;font-weight:800;font-size:14px;user-select:none;box-shadow:0 3px 0 rgba(0,0,0,.4);";
  function btn(act, label, bg, dis) { return "<span data-act='" + act + "' style='" + BTN + "background:" + (bg || "#1c6b40") + ";" + (dis ? "opacity:.35;pointer-events:none;" : "") + "'>" + label + "</span>"; }
  function head(title, sub) { return "<div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:8px'><b style='letter-spacing:2px;color:#e8b64c'>" + title + "</b><span style='opacity:.7;font-size:12px'>" + (sub || "") + " · Esc closes</span></div>"; }

  function openInmate() {
    if (!INM) return;
    if (INM.phase === "serving") { panelMode = "serving"; menuLock(true); openServe(); return; }
    if (INM.phase === "breakout" || INM.phase === "prying") { panelMode = null; menuLock(false); if (C) C.hud.closePanel(); return; }
    panelMode = "inmate"; menuLock(true);
    const canBribe = C.wallet.cash() >= INM.bribe;
    const left = Math.max(0, Math.ceil(INM.sentence - INM.served));
    C.hud.panel(
      head("CITY JAIL", INM.wanted0 + "★ jacket") +
      "<div style='font-size:12px;opacity:.85;margin:2px 0 8px'>Sentence <b>" + left + "s</b> · cash <b>" + fmt(C.wallet.cash()) + "</b></div>" +
      btn("serve", "SERVE", "#2a6b40") +
      btn("bribe", "BRIBE " + fmt(INM.bribe), canBribe ? "#8a6a1f" : "#4a4433", !canBribe),
      { serve: () => { INM.phase = "serving"; openServe(); },
        bribe: () => doBribe(),
        close: () => { menuLock(false); C.hud.closePanel(); } });
  }
  function openServe() {
    panelMode = "serving";
    C.hud.panel(
      head("DOING TIME", "the clock rolls") +
      "<div id='jl_serve' style='font-size:14px;margin:6px 0'></div>" +
      barHTML("jl_servebar", "linear-gradient(90deg,#6ab04c,#2a6b40)", 0) +
      "<div style='margin-top:8px'>" + btn("bribe", "BRIBE " + fmt(INM.bribe), "#8a6a1f") + btn("stop", "STOP", "#26343c") + "</div>",
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
  function barHTML(id, col, pct) { return "<div style='height:12px;border-radius:6px;background:rgba(0,0,0,.5);overflow:hidden;border:1px solid rgba(255,255,255,.18);margin:3px 0'><div id='" + id + "' style='height:100%;width:" + pct + "%;background:" + col + "'></div></div>"; }

  /* ==========================================================
     8. THE CAPTURE-FUNNEL SEAM — wrap CBZ.cityBust (the _jailWrapped idiom).
        The wrap GUARANTEES delivery into the jail: the only fall-throughs
        are the DOCUMENTED ones (flag off, packages off, an active campaign,
        non-city modes — the standalone Cell Block Z runs live there).
        Everything else lands in a cell:
          · venue not mounted yet → the collar is HELD and delivered the
            moment the venue lands (mount hurried; wall-clock failsafe to
            the original bust so an arrest can never evaporate);
          · busted mid-breakout → RECAPTURE (never a world swap that
            discards the city run);
          · busted while held/serving → already in custody (swallowed);
          · arrested on a jailor shift → the shift ends, then you go in.
        Loads after us, so wrap it lazily.
     ========================================================== */
  function jailEngages() {
    return jailOn() && CBZ.CONFIG.GAME_PACKAGES !== false && g.mode === "city"
      && !(CBZ.cityCampaignActive && CBZ.cityCampaignActive());
  }
  function deliverPending(viaOrig) {
    if (!PENDING) return;
    // wasted beats busted: a player who DIED while the collar was in flight is
    // not delivered to a cell post-respawn — death already wiped the slate
    // (CITY_WANTED_CLEARS_ON_DEATH), so the arrest evaporates with the corpse.
    if (CBZ.player && CBZ.player.dead) { PENDING = null; return; }
    const p = PENDING; PENDING = null;
    if (!viaOrig && V && V.ready && jailEngages()) {
      try { if (beginInmate(p.opts)) return; } catch (e) { console.error("[gamepkg:jail] pending arrest", e); }
    }
    if (ORIG_BUST && g.mode === "city") { try { ORIG_BUST(p.opts); } catch (e) {} }
  }
  function wrapBust() {
    if (typeof CBZ.cityBust !== "function") return false;      // not loaded yet → retry
    if (CBZ.cityBust._jailWrapped) return true;                 // already wrapped → stop
    const orig = CBZ.cityBust;
    ORIG_BUST = orig;
    const wrapped = function (opts) {
      if (jailEngages()) {
        try {
          if (INM) {
            // mid-breakout collar = recapture; held/serving = already in custody.
            if (INM.phase === "breakout") recapture(opts && opts.cop && ((opts.cop.data && opts.cop.data.name) || opts.cop.name));
            return;
          }
          if (JOB && JOB.active) endShift("arrested");           // badge off, then in
          if (V && V.ready) { if (beginInmate(opts || {})) return; }
          else {
            PENDING = { opts: opts || {}, t: 0 };
            try { if (CBZ.games && CBZ.games._claimAndMount) CBZ.games._claimAndMount(null); } catch (e) {}
            if (V && V.ready) { deliverPending(false); return; }
            // held: update() delivers on mount; this failsafe guarantees the
            // arrest still CONCLUDES even if the venue can never mount.
            setTimeout(function () { deliverPending(false); }, 6000);
            return;
          }
        } catch (e) { console.error("[gamepkg:jail] arrest", e); }
      }
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
    title: "CITY JAIL",
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
      rules: { sentenceFor, bribeCost, PRY_TIME, RECAP_PENALTY, WAGES },
      mounted: () => !!(V && V.ready),
      near: () => near,
      arc: () => (INM ? { phase: INM.phase, sentence: INM.sentence, served: +INM.served.toFixed(2), wanted0: INM.wanted0, bribe: INM.bribe, pry: +INM.pry.toFixed(2) } : null),
      shift: () => (JOB ? { active: JOB.active, caught: JOB.caught, wage: JOB.wage, escape: !!JOB.escape } : null),
      state: () => (S ? JSON.parse(JSON.stringify(S)) : null),
      cast: () => (V ? { guards: V.guards.length, inmates: V.inmates.length, sarge: !!V.sarge, cells: V.cells.length, posts: V.posts.length } : null),
      anchor: () => (V ? { x: V.origin.x, z: V.origin.z } : null),
      cellLocked: (i) => (V && V.cells[i] ? !!V.cells[i].locked : null),
      engages: () => jailEngages(),
      pending: () => !!PENDING,
      guardSees: () => !!guardSpots(CBZ.player),
      seed: (s) => seedRng(s),

      // ---- INMATE rigs ----
      // fire the REAL seam (respects the flag/guards) or force the arc directly.
      bust: (opts) => (CBZ.cityBust ? (CBZ.cityBust(opts || {}), true) : false),
      beginInmate: (opts) => beginInmate(opts || {}),
      serve: () => { if (INM) { INM.phase = "serving"; return true; } return false; },
      _serveComplete: () => { if (INM && INM.phase === "serving") { INM.served = INM.sentence; releaseInmate("served"); return true; } return false; },
      bribe: () => { if (INM) { doBribe(); return !INM; } return false; },
      pry: () => { if (INM) { startPry(); return INM.phase === "prying"; } return false; },
      stopPry: () => { if (INM) { stopPry(false); return INM.phase === "held"; } return false; },
      setPry: (x) => { if (INM) { INM.pry = +x || 0; return true; } return false; },
      _pryComplete: () => { if (INM && (INM.phase === "prying" || INM.phase === "held")) { INM.pry = PRY_TIME; popDoor(); return INM.phase === "breakout"; } return false; },
      liftKeys: () => { if (canLiftKeys()) { takeKeys(); return INM.phase === "breakout"; } return false; },
      reachGap: () => { if (INM && INM.phase === "breakout") { const wg = W(V.gap.x, V.gap.z); teleportPlayer(wg.x, wg.z); releaseInmate("escaped"); return true; } return false; },
      phase: () => (INM ? INM.phase : null),

      // ---- JAILOR rigs ----
      startShift: () => (startShift(), !!(JOB && JOB.active)),
      endShift: (why) => { endShift(why || "clocked off"); return !JOB; },
      rigEscape: () => { const r = rigEscape(); return !!r; },
      catch: () => { if (JOB && JOB.escape) { const ped = JOB.escape.h && JOB.escape.h.ped; if (ped) { const w = W(V.gap.x, V.gap.z + 3); teleportPlayer(w.x, w.z); ped.pos.set(w.x, 0, w.z); } catchRunner(); return true; } return false; },
      missEscape: () => { if (JOB && JOB.escape) { missRunner(); return true; } return false; },
    },
  });
})();
