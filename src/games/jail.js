/* ============================================================
   games/jail.js — THE COUNTY JAIL, as a GAME PACKAGE.

   WHERE IT IS AND WHAT IT IS (2026-07-27). OWNER: "the county jail is placed
   stupidly on the map and it's still where character goes when arrested — not
   the jail game — which is FAIR, it goes to jail not prison. But why an
   OPEN-TOP BUILDING IN THE MIDDLE OF TOWN with 0 effort." And: "the issue with
   the jail is its not in a building, we have buildings — the jail tries to be
   its own building."

   Both complaints were the same two lines of this file. The venue resolved to
   `cityPoliceStation()` + 24 m — and that function is a fallback chain onto the
   downtown City Hall shop lot, so the jail landed in the middle of the grid.
   Then it hand-raised three cells and an open yard: no roof, no shell, no
   region, no keep-out, no access road, nothing the rest of the world had ever
   heard of.

   Neither is fixed here, because neither is this file's job:
     · THE LAND is city/govcomplex.js's — the ONE sanctioned standalone-plot
       placer — as its tenth COMPLEXES row ("countyjail"). One row buys the
       clear-ground search, the region, the terrain grade, the keep-out, the
       access road, the map presence and a County Sheriff with a real detail.
     · THE BUILDING is CBZ.cityMakeBuilding's, raised by that row through the
       same `civic()` call the Capitol and City Hall are made of. Roof, walls,
       glass, colliders, stair core, floor plates and the batch merge, free.
   What THIS file authors is what it always should have: the cellblock inside
   that shell, the people, and the game. See §3.

   EVERY MECHANIC BELOW IS UNCHANGED. The pry clock, the guards' gaze cones,
   the rotating empty post, the keys off a restrained guard, the recapture, the
   transport race and the whole CBZ.cityBust seam read ANCHORS out of `V` now
   instead of literals — and that is the entire diff. Flag COUNTY_JAIL_V2 off
   (or no plot on this seed) falls back to the legacy yard at the legacy
   siting, byte for byte, so an arrest can never depend on any of this.

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
                    real cityRestrain collar). Door open → down the corridor,
                    across the booking hall (one post on the ring stands
                    INSIDE, so the way out of the building is watched on the
                    same rotation the yard is), out into the walled court and
                    through the ONE gate in it that has never latched → out
                    HOT: CBZ.cityAddStars + the escaped-convict floor, and the
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
  // COUNTY_JAIL_V2 — the jail as a BUILDING ON ITS OWN LAND (city/govcomplex.js
  // row "countyjail") instead of three cells and an open yard dropped 24 m off
  // a downtown lot. Off (or no plot: govcomplex absent, GOV_COMPLEX false, or
  // the placement search found no clear ground) → the legacy yard, byte for
  // byte, at the legacy siting. An arrest can never depend on this flag.
  if (CBZ.CONFIG.COUNTY_JAIL_V2 == null) CBZ.CONFIG.COUNTY_JAIL_V2 = true;
  function jailOn() { return CBZ.CONFIG.PKG_JAIL !== false; }

  // THE PLOT. govcomplex.js's tenth row claims the land, registers the region,
  // the keep-out and the access road, raises the SHELL (a real
  // CBZ.cityMakeBuilding, with its roof, its colliders, its stair core and its
  // floor plates) and walls the court behind the sally port. Everything it
  // committed to is published on `site.jail`; we re-derive none of it.
  function plotFor() {
    if (CBZ.CONFIG.COUNTY_JAIL_V2 === false) return null;
    const S = CBZ.govComplexes;
    if (!S || !S.length) return null;
    for (let i = 0; i < S.length; i++) {
      const s = S[i];
      if (s && s.id === "countyjail" && s.rect && s.jail && s.jail.building) return s.jail;
    }
    return null;
  }

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

  // ============================================================
  //  ONE SENTENCE FORMULA FOR THE WHOLE GAME (CBZ.cityJailSentence).
  //  This file's `sentenceFor` was the only sentence anywhere and it only ever
  //  described a beat in a holding cell. The stretch you actually SERVE is
  //  served in the PRISON (mode "escape"), so the same number now answers for
  //  both — the pen simply runs it at real-time scale instead of the holding
  //  cell's 3.2x. Nothing anywhere else may invent a second one; ask here.
  //    jail   — holding-cell seconds (the legacy/degrade number, unchanged)
  //    prison — real seconds to serve in the pen
  //    bail   — CITY CASH, the price set at booking (was the corrupt guard's
  //             bribe; same curve, honest name)
  //    hold   — real seconds in the holding cell before the transport rolls,
  //             i.e. how long your last chance to walk out of BOOKING lasts.
  // ============================================================
  const PRISON_SCALE = 3.0, HOLD_BASE = 34, HOLD_PER_STAR = 3;
  function jailSentence(wanted) {
    const w = Math.max(1, Math.min(5, wanted | 0));
    const jail = sentenceFor(w);
    return { stars: w, jail, prison: Math.round(jail * PRISON_SCALE),
      bail: bribeCost(w), hold: HOLD_BASE + HOLD_PER_STAR * w };
  }
  CBZ.cityJailSentence = jailSentence;
  // the pry: seconds of UNOBSERVED work on the cell door's loose plate before
  // it gives. No sweet spots, no attempts — the only clock is the patrol.
  const PRY_TIME = 24;

  // jailor economy — real cash for real collars. Nothing else pays.
  const WAGES = { catch: 400 };

  // runtime feel constants
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
  // ============================================================
  //  SHOW DON'T TELL (JAIL_SHOW_DONT_TELL — declared in entities/ai.js, gated
  //  by systems/capture.js's CBZ.jailTell).
  //
  //  OWNER: "the HUD is cluttered with 4th-wall breakers — summaries of events
  //  when the events should just HAPPEN." This file had two private popup
  //  wrappers — `feed` (a coloured line in the package log) and `big` (the
  //  city's full-screen banner) — and between them they narrated EVERY beat of
  //  a booking that the player was standing inside: "BOOKING" while the booking
  //  sheet opened in front of him, "TIME SERVED" while the cell door swung,
  //  "OVER THE WALL — MANHUNT" while four stars lit up and the sirens started.
  //
  //  Both wrappers survive, and both now go through the shared gate. What is
  //  KEPT is the booking sheet itself (a bounded modal with bare verbs — the
  //  one sanctioned panel here) and anything a PERSON says, which goes over
  //  that person's head through CBZ.citySay. Everything else is deleted and
  //  the world does the talking.
  // ============================================================
  function telling() { return !(CBZ.CONFIG.JAIL_SHOW_DONT_TELL !== false); }
  let toldFeeds = 0, toldBigs = 0;
  function feed(m, col) { if (!telling()) { toldFeeds++; return true; } if (C) C.hud.feed(m, col); return false; }
  function big(m) {
    if (!telling()) { toldBigs++; return true; }
    if (CBZ.city && CBZ.city.big) CBZ.city.big(m); else feed(m, "#ffd166");
    return false;
  }
  // a line somebody SAYS, over their head. This is what a narration turns into
  // when it carried something the player genuinely could not otherwise know.
  function say(h, text, col, secs) {
    const ped = h && h.ped ? h.ped : h;
    if (!ped || !CBZ.citySay) return false;
    try { CBZ.citySay(ped, text, col || "#ffd27b", secs || 2.2); return true; } catch (e) { return false; }
  }
  function anyGuard() { return (V && (V.sarge || V.guards[0])) || null; }
  function respect(n) { if (CBZ.city && CBZ.city.addRespect) { try { CBZ.city.addRespect(n); } catch (e) {} } }
  function stars() { return (CBZ.cityStars ? CBZ.cityStars() : (g.wanted | 0)) | 0; }
  function W(lx, lz) { return { x: V.origin.x + lx, z: V.origin.z + lz }; }
  function playerNear(lx, lz, r) { const P = CBZ.player; if (!P || !P.pos) return false; const w = W(lx, lz); return Math.hypot(P.pos.x - w.x, P.pos.z - w.z) <= r; }

  // pointer-lock / input suppression while a modal panel is up (city convention)
  function menuLock(on) { try { CBZ.cityMenuOpen = !!on; } catch (e) {} }

  /* ==========================================================
     3. BUILD — TWO SITINGS, ONE SET OF MECHANICS.

     OWNER (2026-07-27): "why an OPEN-TOP BUILDING IN THE MIDDLE OF TOWN with
     0 effort", and "the issue with the jail is its not in a building, we have
     buildings — the jail tries to be its own building."

     Both are answered by moving ANCHORS, never mechanics. The pry, the patrol
     gaze cones, the transport clock, the keys, the recapture, the jailor shift
     and the whole capture-funnel seam are untouched below this section: every
     one of them now reads a point out of `V` instead of a literal, and the two
     sitings differ in those points and in nothing else.

       PLOT (COUNTY_JAIL_V2, the shipping path) — city/govcomplex.js's tenth
         row claims a civic plot at the edge of town and raises a REAL
         CBZ.cityMakeBuilding shell on it. We dress its ground floor: a booking
         hall inside the front doors, a secure line across the plate, a row of
         real cells with real barred doors down the west wall, and a corridor.
         The court behind the sally port is the row's, walls and all, including
         the one gate in it that does not latch.
       YARD (the degrade) — the legacy three cells and open yard, at the legacy
         siting, unchanged. This is what runs with the flag off, with
         govcomplex absent, or on a seed where the placement search found no
         clear ground. An arrest may never depend on a flag.

     Local axis-aligned coords throughout (the venue group is never rotated, so
     ctx.solid's world AABBs stay in sync with the meshes).
     ========================================================== */
  const MAT = { wall: 0x6b7079, wallD: 0x4d525a, bar: 0x2b2f36, floor: 0x3c4046, desk: 0x4a2e1c,
    deskD: 0x33200f, bunk: 0x555a63, gold: 0xe8b64c, orange: 0xcf6a2a, rubble: 0x5a5148, sign: 0x11151b, wire: 0xb9bec6 };

  function build(ctx, venue) {
    C = ctx;
    const gp = venue.group;
    V = legacyV(venue, gp);

    const plot = plotFor();
    let built = false;
    if (plot) {
      try { built = buildInside(ctx, venue, plot); }
      catch (e) { console.error("[gamepkg:jail] plot build", e); built = false; }
    }
    // a plot build that refused (or threw part-way) must not leave half a
    // cellblock in the records the yard is about to fill: start it clean.
    if (!built) { V = legacyV(venue, gp); buildYard(ctx, venue); }
    V.onPlot = built;
    zones(ctx);
    V.ready = true;
  }

  // THE LEGACY ANCHOR BAG. Eight venue-LOCAL points, the legacy yard's own
  // literals, and nothing below this function may type one of them again.
  function legacyV(venue, gp) {
    return { origin: venue.origin, ready: false, _venue: venue, group: gp,
      cells: [], guards: [], inmates: [], posts: [], pending: [], onPlot: false,
      nearR: 60, runVia: null,
      // A GAZE IS A RADIUS AND A CONE, and the rule does not change between
      // sitings — only the scale does. The legacy yard's interior is 20x16 m
      // and 7 m of vision covers a real share of it; the county jail's court is
      // 68x44, where the same 7 m would make walking out unopposed and kill the
      // one mechanic this whole venue is about. The number is a property of the
      // SPACE, so it lives beside the space's other anchors.
      seeR: GUARD_SEE_R,
      gate: { x: 0, z: 7.2 },          // the gate itself (sign-on / the way in)
      gateZone: { x: 0, z: 7.6 },      // where the gate card shows
      gateIn: { x: 0, z: 9.6 },        // the perp walk's pause, just outside it
      stop: { x: 0, z: 14.0 },         // the cruiser's kerb
      desk: { x: 0, z: 5.4 },          // the booking desk you are marched to
      out: { x: 0, z: 10.5 },          // where a released body is put down
      gap: { x: 7.5, z: -8 },          // THE weak point — reach it and you are out
      gapOut: { x: 0.6, z: -0.8 },     // its outward normal (which way "out" is)
      gapApp: { x: 7.5, z: -6.8 } };   // the inside approach to it (runners aim here)
  }

  /* ----------------------------------------------------------
     3a. THE LEGACY YARD — the degrade path, unchanged.
        Footprint (local): yard interior X∈[-10,10], Z∈[-8,8].
          · GATE + desk on the +Z (front) wall — the entrance / sign-on.
          · 3 CELLS along the -X (west) wall, doors facing +X into the yard.
          · GUARD POSTS around the yard — the PATROL RING guards walk.
          · WALL GAP at the -Z/+X back corner — the escape target (no collider).
     ---------------------------------------------------------- */
  function buildYard(ctx, venue) {
    const gp = venue.group;
    const box = (x, y, z, w, h, d, m, ry) => ctx.box(gp, x, y, z, w, h, d, ctx.mat(m), ry);
    const WALL_H = 3.2, WALL_T = 0.6;
    claimLand(venue);            // ROADS DO NOT GO THROUGH A JAIL (see below)

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
      // A BUNK YOU CAN LIE ON. Same place, same silhouette, but it registers a
      // propuse BED, so "there is a bed in the cell" is a verb and not a claim.
      if (!fur("bed", gp, ctx, -9.1, 0, cz, 0, { len: 2.0, wide: 1.3, tone: "auto" })) {
        box(-9.1, 0.55, cz, 1.3, 0.35, 2.0, MAT.bunk); propPlain++;
      }
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
    signBoard(ctx, gp, 0, 2.5, 8.05, "BOOKING");

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
  }

  /* ----------------------------------------------------------
     3b. THE COUNTY JAIL — dressing the INSIDE of a real building.

     The shell is `CBZ.cityMakeBuilding`'s, raised by govcomplex.js's row: we
     get the roof, the four walls, the facade colliders, the stair core, the
     floor plates and the batch merge without drawing one of them. What is
     genuinely new — and it is the only thing this function authors — is a
     CELLBLOCK: a secure line across the plate, a row of cells with real barred
     doors on the same y0/y1 collider contract `setDoor` has always toggled, a
     patrol corridor, a day room and a booking counter inside the front doors.

     The floor covering and the ceiling light come from the shared interior kit
     (`CBZ.interiorShell`), which is the sanctioned "shell alone" export for
     exactly this case — a caller that lays out its own room and still wants
     the finished, lit floor. govcomplex declares floor 0 as "none" so the two
     files can never both dress this plate.

     EVERY LENGTH IS DERIVED from the shell's own floor rect. Hand this a
     bigger building and it lays more cells; hand it one too small and it
     refuses (returns false) and the legacy yard is built instead.
     ---------------------------------------------------------- */
  function buildInside(ctx, venue, P) {
    const b = P.building;
    if (!b || typeof b.lbox !== "function" || !CBZ.interiorFloorRoom) return false;
    const room = CBZ.interiorFloorRoom(b, 0);
    if (!room) return false;
    const gp = venue.group, O = venue.origin;
    const box = (x, y, z, w, h, d, m, ry) => ctx.box(gp, x, y, z, w, h, d, ctx.mat(m), ry);
    // building-local -> venue-local, and world -> venue-local. Neither frame is
    // ever rotated, so both are a translation and ctx.solid's AABBs stay true.
    const BX = b.ox - O.x, BZ = b.oz - O.z;
    const bl = (x, z) => ({ x: BX + x, z: BZ + z });
    const wl = (x, z) => ({ x: x - O.x, z: z - O.z });

    const x0 = room.x0, x1 = room.x1, z0 = room.z0, z1 = room.z1;
    const FY = room.y;                                          // the ground slab top
    // FLOOR TO CEILING. A cell whose walls stop short of the slab is the
    // owner's original complaint wearing a roof, so the block runs the full
    // storey height the shell declares rather than a comfortable 3 m.
    const CH = Math.max(2.4, (room.fh || 3.2) - 0.16);
    const SEC_Z = z1 - 9.0;                                     // the secure line
    const CELL_D = 3.8, CORR_W = 3.4;
    const doorX = x0 + CELL_D;                                  // the barred faces
    // too small a shell is not a jail. Refuse rather than cram.
    if (SEC_Z - z0 < 9.0 || (x1 - x0) < CELL_D + CORR_W + 5.0) return false;

    // ---- THE ANCHORS, all taken from what the row already committed to -----
    const sal = wl(P.sally.x, P.sally.z), wk = wl(P.weak.x, P.weak.z), st = wl(P.stop.x, P.stop.z);
    const dsk = bl(0, z1 - 4.6);
    V.gate = { x: sal.x, z: sal.z - 3.4 };
    V.gateZone = { x: sal.x, z: sal.z - 2.6 };
    V.gateIn = { x: sal.x, z: sal.z - 5.0 };
    V.stop = st;
    V.out = { x: st.x, z: st.z + 3.0 };
    V.desk = dsk;
    V.gap = wk;
    V.gapOut = { x: P.weak.ox, z: P.weak.oz };
    V.gapApp = { x: wk.x - P.weak.ox * 2.0, z: wk.z - P.weak.oz * 2.0 };
    V.nearR = 130;
    V.seeR = 11.0;      // see the note on V.seeR: a 68x44 court, not a 20x16 yard
    // and the way OUT of the building, for anyone the sim walks rather than
    // teleports: the secure gate, then the front doorway, then the court.
    V.runVia = [{ x: BX, z: BZ + SEC_Z }, { x: BX, z: (P.court.minZ - O.z) + 2.4 }];

    // the finished, lit floor — the shared kit, not a fourth copy of two boxes
    if (CBZ.interiorShell) { try { CBZ.interiorShell(room, { b: b }); } catch (e) {} }

    // TELL THE LEDGER THIS PLATE IS TAKEN. occupy.js keeps `_occupyProgrammed`
    // per building precisely so two occupations cannot stack two sets of
    // furniture on one floor, and power.js seats the County Sheriff here on
    // approach — whose floor ladder would otherwise dress the ground storey
    // straight over the cells. govcomplex's own note applies: civic() hands the
    // lot a SHALLOW COPY of the record and occupy.js reads the ledger off THAT,
    // so both objects are stamped. They share every closure by reference, so
    // this is one claim written twice, never two claims.
    for (const host of [b, P.lot && P.lot.building]) {
      if (!host) continue;
      host._occupyProgrammed = host._occupyProgrammed || Object.create(null);
      host._occupyAnchors = host._occupyAnchors || Object.create(null);
      host._occupyProgrammed[0] = "cellblock";
      host._occupyAnchors[0] = [];
    }

    // an interior wall in building-local coords, with a REAL collider. Interior
    // partitions in this game are conventionally non-solid; a jail's are not.
    const iwall = (bcx, bcz, w, d, h) => {
      h = h == null ? CH : h;
      const p = bl(bcx, bcz);
      box(p.x, FY + h / 2, p.z, w, h, d, MAT.wall);
      ctx.solid(p.x - w / 2, p.z - d / 2, p.x + w / 2, p.z + d / 2, FY, FY + h);
    };

    // ---- THE CELLS. Down the west wall, doors facing +X onto the corridor —
    //      the same arrangement (and the same records) the legacy yard used, so
    //      every mechanic below reads them without knowing which siting it is.
    const span = SEC_Z - z0 - 1.0;
    const N = Math.max(3, Math.min(6, Math.floor(span / 3.4)));
    const pitch = span / N, zBase = z0 + 0.5;
    for (let i = 0; i <= N; i++) iwall(x0 + CELL_D / 2, zBase + pitch * i, CELL_D, 0.24);
    for (let i = 0; i < N; i++) {
      const c = bl(x0 + CELL_D / 2, zBase + pitch * (i + 0.5)), half = pitch / 2 - 0.16;
      const dx = BX + doorX;
      // the bunk runs ALONG X (head to the west wall), so the kit is yawed a
      // quarter turn and its `len` is the 1.9 that used to be the box's width.
      if (!fur("bed", gp, ctx, BX + x0 + 1.15, FY, c.z, Math.PI / 2, { len: 1.9, wide: 0.92, tone: "auto" })) {
        box(BX + x0 + 1.15, FY + 0.55, c.z, 1.9, 0.34, 0.92, MAT.bunk); propPlain++;
      }
      box(BX + x0 + 0.62, FY + 0.28, c.z + half - 0.62, 0.5, 0.56, 0.5, MAT.wire);   // the pan
      box(BX + x0 + 0.62, FY + 0.72, c.z - half + 0.55, 0.42, 0.06, 0.42, MAT.wallD); // the shelf
      // the barred DOOR: the y0/y1 gate collider setDoor pushes and pops, plus
      // the bars we hide when it swings open.
      const dc = ctx.solid(dx - 0.18, c.z - half, dx + 0.18, c.z + half, FY, FY + CH);
      const bars = new THREE.Group(); gp.add(bars);
      barGate(ctx, bars, dx, c.z, half, CH, FY);
      V.cells.push({ i, lz: c.z, lx: c.x, doorX: dx, half: half, doorCol: dc, bars, locked: true });
    }
    setDoor(V.cells[1], false);       // cell 1 is the player's — open until an arrest

    // ---- THE SECURE LINE. Two solid runs and a barred gate standing OPEN
    //      between them: what holds you is the cell door, and a locked inner
    //      gate would make the pry unwinnable instead of tense.
    const GW = 1.15;
    iwall((x0 - GW) / 2, SEC_Z, Math.max(0.5, -GW - x0), 0.24);
    iwall((GW + x1) / 2, SEC_Z, Math.max(0.5, x1 - GW), 0.24);
    const leaf = new THREE.Group();
    const sg = bl(-GW, SEC_Z);
    leaf.position.set(sg.x, FY, sg.z); leaf.rotation.y = 1.22; gp.add(leaf);
    barGate(ctx, leaf, GW, 0, GW, CH, 0, true);
    signBoard(ctx, gp, bl(-6.2, SEC_Z + 0.14).x, FY + 2.35, bl(-6.2, SEC_Z + 0.14).z, "BOOKING");

    // ---- THE DAY ROOM, east of the corridor: tables somebody sits at ------
    const dayX = doorX + CORR_W;
    if (x1 - dayX > 6.5) {
      const cxd = (dayX + x1) / 2;
      for (let i = 0; i < 2; i++) {
        const tz = z0 + 3.0 + i * Math.max(4.0, (SEC_Z - z0 - 6.0));
        const t = bl(cxd, tz);
        // THE DAY ROOM IS WHERE THE BLOCK SITS. Six boxes that nobody could sit
        // at become one kit table with its own bench seats registered — the
        // same call city/beach.js and world/roombuild.js already make.
        if (!fur("table", gp, ctx, t.x, FY, t.z, Math.PI / 2, { len: 2.4, deep: 1.1, seats: 4, tone: "auto" })) {
          box(t.x, FY + 0.72, t.z, 2.4, 0.1, 1.1, MAT.deskD);
          for (const s of [-1, 1]) {
            box(t.x, FY + 0.35, t.z + s * 0.95, 2.4, 0.1, 0.4, MAT.wallD);
            box(t.x, FY + 0.18, t.z + s * 0.95, 2.2, 0.36, 0.12, MAT.wallD);
          }
          for (const s of [-1, 1]) box(t.x + s * 1.0, FY + 0.36, t.z, 0.12, 0.72, 0.12, MAT.bar);
          propPlain++;
        }
      }
    }

    // ---- THE BOOKING HALL, inside the front doors. The counter is the point
    //      city/wanted.js's perp walk ends at, so it stands square to the door.
    box(dsk.x, FY + 0.55, bl(0, z1 - 6.4).z, 7.2, 1.1, 0.92, MAT.desk);
    box(dsk.x, FY + 1.16, bl(0, z1 - 6.4).z, 7.4, 0.12, 1.02, MAT.deskD);
    ctx.solid(dsk.x - 3.6, bl(0, z1 - 6.4).z - 0.46, dsk.x + 3.6, bl(0, z1 - 6.4).z + 0.46, FY, FY + 1.16);
    // the property lockers behind the counter — where your guns actually go
    for (let i = 0; i < 4; i++) {
      const L = bl(4.6 + i * 1.05, SEC_Z + 0.75);
      box(L.x, FY + 1.0, L.z, 0.95, 2.0, 0.55, MAT.wallD);
    }
    ctx.solid(bl(4.1, SEC_Z + 0.75).x, bl(0, SEC_Z + 0.5).z, bl(8.3, SEC_Z + 0.75).x, bl(0, SEC_Z + 1.0).z, FY, FY + 2.0);
    // the bench you wait on
    for (let i = 0; i < 2; i++) {
      const B = bl(x0 + 2.2, z1 - 3.0 - i * 2.4);
      // THE BENCH YOU WAIT ON, and now you can actually wait on it. Facing the
      // booking counter, which is the only direction a man on this bench looks.
      if (!fur("bench", gp, ctx, B.x, FY, B.z, 0, { len: 1.8, back: true, tone: "auto" })) {
        box(B.x, FY + 0.44, B.z, 1.0, 0.12, 1.8, MAT.wallD);
        box(B.x - 0.42, FY + 0.22, B.z, 0.14, 0.44, 1.7, MAT.wallD);
        propPlain++;
      }
    }

    // ---- THE PATROL RING. Four posts, three guards, one slot always empty and
    //      the empty slot rotates — physics instead of a timer, unchanged. What
    //      IS new is that one post is INSIDE, behind the counter, so the way out
    //      of the building is watched on the same rotation the yard is. Post 0
    //      declares a `via` on the door's own axis (see marchGuards).
    const cq = { x: (P.court.minX + P.court.maxX) / 2 - O.x, z0: P.court.minZ - O.z, z1: P.court.maxZ - O.z,
      x0: P.court.minX - O.x, x1: P.court.maxX - O.x };
    const insideP = bl(0, z1 - 7.8);
    V.posts = [
      { lx: insideP.x, lz: insideP.z, face: 0, via: { lx: insideP.x, lz: cq.z0 + 7 } },
      { lx: insideP.x, lz: cq.z0 + (cq.z1 - cq.z0) * 0.55, face: 0 },
      // THE GAP CORNER, and it is in the ring on purpose: standing here the
      // service gate is inside a deputy's cone, so the way out is open only
      // while this is the empty slot. That is the legacy design, re-measured
      // against the real distance rather than re-typed.
      { lx: cq.x1 - 5.5, lz: V.gap.z + 1.6, face: Math.PI / 2 },
      { lx: cq.x0 + 9, lz: cq.z0 + (cq.z1 - cq.z0) * 0.34, face: -Math.PI / 2 },
    ];

    // ---- the LOOK (≤8 lights per venue; four here) -------------------------
    ctx.light(dsk.x, FY + 2.7, bl(0, z1 - 5.0).z, 0xfff1d8, 0.8, 18);            // booking hall
    ctx.light(bl(doorX + 1.6, (z0 + SEC_Z) / 2).x, FY + 2.7, bl(0, (z0 + SEC_Z) / 2).z, 0xbfe0ff, 0.6, 22);  // the block
    ctx.light(cq.x, 7.0, (cq.z0 + cq.z1) / 2, 0xfff1d8, 0.55, 40);               // the court
    ctx.light(V.gap.x - 5, 5.0, V.gap.z, 0xffcaa0, 0.6, 16);                     // the gate that does not latch

    // ---- CAST. Same roles, same dialogue, new posts. --------------------
    for (let i = 0; i < 3; i++) {
      const p = V.posts[i];
      queue({ role: "guard", name: "Deputy " + guardName(ctx, i), outfit: "security",
        at: [p.lx, p.lz], face: p.face, post: "pinned", pose: "stand",
        dialogue: ["Keep moving. Nothing to see.", "You do NOT want to be out in that yard after lights-out.", "Wall's forty feet of nothing. Don't be stupid."] }, "guard");
    }
    const sr = bl(3.9, z1 - 7.8);
    queue({ role: "guard", name: "Sgt. " + guardName(ctx, 9), outfit: "security",
      at: [sr.x, sr.z], face: 0, post: "pinned", pose: "stand",
      dialogue: ["Everything's for sale in here, friend.", "Doing a shift? Or doing time?"] }, "sarge");
    // an inmate in every cell but yours. Their mouths carry the escape hint.
    for (let i = 0, k = 0; i < V.cells.length; i++) {
      if (i === 1) continue;
      const cell = V.cells[i];
      queue({ role: "inmate", name: inmateName(ctx, k++), outfit: MAT.orange,
        at: [cell.lx, cell.lz], face: Math.PI / 2, post: "pinned", pose: "stand",
        dialogue: ["I been in here longer than the walls.", "That door plate's been loose since the riot. Work it when their backs are turned.", "Service gate on the east wall hasn't latched in years. Mind their eyes."] }, "inmate:" + i);
    }
    return true;
  }

  /* ==========================================================
     ROADS CONNECT PLACES, THEY DO NOT OVERLAP THEM (PRISON_ROAD_FIX).

     OWNER: "there's a road going through the jail." On the COUNTY_JAIL_V2 path
     the land is city/govcomplex.js's and comes with a region, a keep-out and
     its own access road, so the shared law (CBZ.roadClearance / roadClamp,
     city/roadrules.js) already refuses every other builder's deck.

     THE DEGRADE PATH HAD NONE OF THAT, and it is the one this file's own header
     complains about: `resolve()` sites the legacy yard on
     `cityPoliceStation() + 24 m` — i.e. 24 metres off a DOWNTOWN lot, inside a
     grid whose roads recur every ~52 m — and then registered nothing. There was
     no record in `city.regions` for a road to be blocked by and no `noSpawn`
     rect for props to be refused from, so the grid simply ran through the yard.
     Not one of the ~20 files that push to `city.roads` was at fault: the jail
     had never told the world it existed.

     Two registrations and one retro-clamp, all of them the sanctioned API and
     none of them new machinery. The clamp is what matters for a venue that
     mounts AFTER buildCity(): roadClamp never deletes a record (it keeps an
     8 m stub), so running it over the whole list is safe, and it is the same
     order-98 pass roadrules.js already applies to everybody else.
     ========================================================== */
  const YARD_HX = 12.5, YARD_HZ = 11.5;      // the legacy yard's own footprint + a kerb
  let claimed = null;
  function claimLand(venue) {
    const A = (CBZ.city && CBZ.city.arena) || null;
    const O = venue && venue.origin;
    if (!A || !O || claimed) return null;
    const R = { minX: O.x - YARD_HX, maxX: O.x + YARD_HX, minZ: O.z - YARD_HZ, maxZ: O.z + YARD_HZ };
    claimed = { rect: R, region: false, keepOut: false, clamped: 0 };
    try {
      if (CBZ.registerCityRegion) {
        const reg = CBZ.registerCityRegion(A, {
          name: "County Jail", subtitle: "Sheriff's Detention Facility", kind: "rect",
          minX: R.minX, maxX: R.maxX, minZ: R.minZ, maxZ: R.maxZ, pad: 6, terrainGrade: true,
        });
        // ownsPlace() reads `_govOwner` on both sides, which is how the jail's
        // OWN access road stays legal while everyone else's is clamped out.
        if (reg) { reg._govOwner = "countyjail"; claimed.region = true; }
      }
    } catch (e) {}
    try {
      if (CBZ.registerNoSpawnZone) {
        CBZ.registerNoSpawnZone(A, { minX: R.minX, maxX: R.maxX, minZ: R.minZ, maxZ: R.maxZ,
          label: "gov-countyjail", civ: true });   // posted deputies belong; the public does not
        claimed.keepOut = true;
      }
    } catch (e) {}
    // the grid roads PRE-DATE this venue, so the law has to be applied backwards
    // once. Anything already legal costs nothing and reports 0.
    try {
      if (A.roads && CBZ.roadClamp) {
        for (let i = 0; i < A.roads.length; i++) {
          const cut = CBZ.roadClamp(A.roads[i], { city: A, dest: { x: O.x, z: O.z } });
          if (cut > 0) claimed.clamped++;
        }
      }
    } catch (e) {}
    return claimed;
  }
  // how many city road segments still cross the legacy yard. MUST be 0.
  CBZ.countyJailRoadAudit = function () {
    const A = (CBZ.city && CBZ.city.arena) || null;
    if (!claimed || !A || !A.roads) return { claimed: !!claimed, crossing: 0, clamped: claimed ? claimed.clamped : 0,
      region: !!(claimed && claimed.region), keepOut: !!(claimed && claimed.keepOut) };
    const R = claimed.rect;
    let crossing = 0;
    for (let i = 0; i < A.roads.length; i++) {
      const r = A.roads[i];
      if (!r) continue;
      const hw = (+r.w || 12) / 2, hl = (+r.len || 0) / 2;
      const minX = r.vertical ? r.x - hw : r.x - hl, maxX = r.vertical ? r.x + hw : r.x + hl;
      const minZ = r.vertical ? r.z - hl : r.z - hw, maxZ = r.vertical ? r.z + hl : r.z + hw;
      if (maxX > R.minX && minX < R.maxX && maxZ > R.minZ && minZ < R.maxZ) crossing++;
    }
    return { claimed: true, crossing: crossing, clamped: claimed.clamped,
      region: claimed.region, keepOut: claimed.keepOut, rect: R };
  };

  /* ---- ZONES (stable interactions), shared by both sitings. GRAMMAR LAW
     (owner): a zone label is a BUTTON — one or two words, no key glyphs, no
     names, no sentences. The card title comes from the venue (packages.js
     describe). Every position is an anchor out of V, never a literal. ---- */
  function zones(ctx) {
    ctx.zone({ id: "gate", pos: [V.gateZone.x, V.gateZone.z], r: V.onPlot ? 3.2 : 2.6,
      label: () => {
        if (INM) return "Booking";
        if (JOB && JOB.active) return "Clock off";
        return "Sign on";
      },
      onUse: () => {
        if (INM) { openBooking(); return; }
        if (JOB && JOB.active) { endShift("clocked off"); return; }
        startShift();
      } });
    // the CELL: re-open the sentence options if you wandered the panel closed.
    ctx.zone({ id: "cell", pos: [V.cells[1].lx, V.cells[1].lz], r: 2.2,
      canShow: () => !!INM && INM.phase === "booking",
      label: () => "Read sheet",
      onUse: () => { if (INM) openBooking(); } });
    // the DESK is where a booking is answered — same point the sarge stands at.
    ctx.zone({ id: "desk", pos: [V.desk.x, V.desk.z], r: 2.8,
      canShow: () => !!INM && INM.phase === "booking",
      label: () => "Booking",
      onUse: () => { if (INM) openBooking(); } });
    // the DOOR PLATE: the physical escape. Pry = work it over time, unobserved.
    ctx.zone({ id: "pry", pos: [V.cells[1].doorX + 0.6, V.cells[1].lz], r: 1.9,
      canShow: () => !!INM && (INM.phase === "held" || INM.phase === "prying"),
      label: () => (INM && INM.phase === "prying" ? "Stop" : "Pry"),
      onUse: () => { if (!INM) return; if (INM.phase === "prying") stopPry(false); else startPry(); } });
  }

  // ---- small deterministic name pickers (build path → ctx.rand) -----------
  const GUARD_NAMES = ["Petrov", "Okafor", "Dunn", "Reyes", "Salk", "Voss", "Kane", "Marsh", "Hale", "Boyd"];
  const INMATE_NAMES = ["Slink", "Two-Time", "Ratchet", "Domino", "Whistler", "Bishop"];
  function guardName(ctx, i) { return GUARD_NAMES[Math.floor(ctx.rand(i, 7, "guard") * GUARD_NAMES.length) % GUARD_NAMES.length]; }
  function inmateName(ctx, i) { return INMATE_NAMES[Math.floor(ctx.rand(i, 3, "inmate") * INMATE_NAMES.length) % INMATE_NAMES.length]; }

  // ---- geometry helpers (chunky members, ≥0.3u, grounded) -----------------
  // a solid wall box centred at (cx,cz) with size (w,h,d) + a matching world
  // collider spanning y0=0..h (the y0/y1 gate shape used for cell doors too).
  /* ==========================================================
     REAL PROPS (CBZ.CONFIG.PRISON_REAL_PROPS).

     OWNER: "there's fake props." world/_template.js's law is the same one:
     "every prop is interactable or load-bearing. No garnish." Everything this
     file called a bunk, a table or a bench was a `box()` — a coloured slab with
     no verb, standing where a thing you can USE ought to be. You could not sit
     on the day-room bench you were sentenced to eat at, and the bunk in your
     own cell was a shelf.

     They are now drawn by CBZ.furnish (city/furniture.js) — the shared kit that
     ALREADY answers this, with ≥3 consumers — which draws the same silhouettes
     AND registers the propuse SEAT / BED anchor, so the walk→perch→swing arc,
     the sit prompt and `CBZ.propSit`/`propSleep` come free and no seating code
     is authored here at all.

     TWO THINGS THE KIT NEEDS FROM A VENUE and both are documented in its own
     header: `box` (our ctx.box, because CBZ.addBox parents into the PRISON root
     captured at parse time and this venue lives in the city) and `ox/oz`, so
     the registered anchors land in WORLD coordinates while the meshes stay
     venue-local. Get either wrong and you furnish another world.

     Degrade: no CBZ.furnish (FURNISH_KIT off, or an older merge) → the exact
     boxes this file used to draw, which is why `plainBox` still exists.
     ========================================================== */
  if (CBZ.CONFIG.PRISON_REAL_PROPS == null) CBZ.CONFIG.PRISON_REAL_PROPS = true;
  let propsMade = 0, propSeats = 0, propBeds = 0, propPlain = 0;
  function realProps() { return CBZ.CONFIG.PRISON_REAL_PROPS !== false && !!CBZ.furnish; }
  // the kit bundle for THIS venue. `y` is the floor the piece stands on.
  function furOpts(gp, ctx, extra) {
    // ctx.box draws; ctx.solid is what makes a thing you can lean on. The kit
    // hands us the y0/y1 it wants on `oo`, so a bunk frame is a real obstacle
    // and a duvet is not — the same split city/furniture.js makes for a
    // building's own lbox.
    const o = {
      box: function (x, y, z, w, h, d, color, oo) {
        const m = ctx.box(gp, x, y, z, w, h, d, ctx.mat(color), 0);
        if (oo && oo.solid) ctx.solid(x - w / 2, z - d / 2, x + w / 2, z + d / 2,
          oo.y0 != null ? oo.y0 : y - h / 2, oo.y1 != null ? oo.y1 : y + h / 2);
        return m;
      },
      ox: V.origin.x, oz: V.origin.z, solid: true,
    };
    if (extra) for (const k in extra) o[k] = extra[k];
    return o;
  }
  // place one piece; count what it registered so CBZ.prisonPropAudit() can tell
  // a real bunk from a slab. Never throws into a world build.
  function fur(kind, gp, ctx, x, y, z, yaw, opts) {
    if (!realProps() || typeof CBZ.furnish[kind] !== "function") return null;
    let r = null;
    try { r = CBZ.furnish[kind](x, y, z, yaw, furOpts(gp, ctx, opts)); } catch (e) { r = null; }
    if (!r) return null;
    propsMade++;
    propSeats += (r.seats && r.seats.length) | 0;
    propBeds += (r.beds && r.beds.length) | 0;
    return r;
  }
  // THE RATCHET for "no fake props": `plain` counts pieces still drawn as bare
  // boxes with no verb, and may only go DOWN; `sittable` may only go UP.
  CBZ.prisonPropAudit = function () {
    // ONE ANSWER FOR THE WHOLE WAVE. world/cellblock.js registers the escape
    // mode's bunks and day-room stools onto the same accumulator, so this
    // reports the prison and the county jail together and neither can hide
    // behind the other's number.
    const W = CBZ._prisonProps || { props: 0, seats: 0, beds: 0, plain: 0 };
    return {
      on: realProps(), kit: !!CBZ.furnish,
      props: propsMade + W.props,
      sittable: propSeats + W.seats,      // may only go UP
      sleepable: propBeds + W.beds,       // may only go UP
      plain: propPlain + W.plain,         // may only go DOWN
      venue: { props: propsMade, sittable: propSeats, sleepable: propBeds, plain: propPlain },
      wing: { props: W.props, sittable: W.seats, sleepable: W.beds, plain: W.plain },
    };
  };

  function wallSeg(box, ctx, cx, cz, w, h, d) {
    box(cx, h / 2, cz, w, h, d, MAT.wall);
    ctx.solid(cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2, 0.0, h);
  }

  // barred cell-door bars between chunky top/bottom rails (visual; the collider
  // is the real barrier). Toggled off when the door swings open.
  //   y0     — the floor it stands on (a shell's ground slab is at ~0.14, the
  //            legacy yard's is 0; defaulting to 0 keeps every old call exact).
  //   alongX — the run lies along X instead of Z (the secure line's gate).
  function barGate(ctx, parent, x, z, half, h, y0, alongX) {
    y0 = y0 || 0;
    const bx = (lx, ly, lz, w, hh, d, m) => ctx.box(parent, lx, ly, lz, w, hh, d, ctx.mat(m));
    const rw = alongX ? half * 2 + 0.2 : 0.22, rd = alongX ? 0.22 : half * 2 + 0.2;
    bx(x, y0 + 0.2, z, rw, 0.3, rd, MAT.wallD);                // bottom rail (chunky)
    bx(x, y0 + h - 0.15, z, rw, 0.3, rd, MAT.wallD);           // top rail
    for (let t = -half + 0.2; t <= half - 0.2 + 1e-6; t += 0.42)
      ctx.cyl(parent, alongX ? x + t : x, y0 + h / 2, alongX ? z : z + t, 0.05, 0.05, h - 0.4, ctx.mat(MAT.bar), 6);
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
    const moved = cell.locked !== !!locked;
    cell.locked = !!locked;
    if (cell.bars) cell.bars.visible = !!locked;
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    // The door speaks HERE, from the hardware, because that is the only place
    // that knows a leaf actually moved. recapture() used to shout its own cue
    // at the end of a state change — and for months it shouted a cue name that
    // no longer existed, so the bars slamming on a failed break played nothing.
    // Voicing the mover covers that beat and the eight other callers for free.
    if (moved && CBZ.worldSfx) {
      const w = W(cell.lx, cell.lz);
      CBZ.worldSfx(locked ? "door_close" : "door_open", w.x, w.z, { ref: 14 });
    }
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
  // ============================================================
  //  BOOKING — this compound stopped being the DESTINATION.
  //
  //  OWNER: "we have a whole jail minigame built that is for where you go when
  //  you are arrested… that minigame needs a lot of improving and pairing with
  //  the main game." So the three-cell yard is now the PRECINCT BOOKING STOP at
  //  the end of city/wanted.js's arrest ride, and the real prison (mode
  //  "escape" — cellblock, cafeteria, yard, towers, the three-strikes law) is
  //  where a sentence is actually served.
  //
  //  What a booking is, in order, all of it physical:
  //    · the charge sheet, read off what the WORLD says you did
  //      (CBZ.cityArrestCharges) — never a made-up list;
  //    · the forfeit, already applied by the arc, shown here;
  //    · your guns into the EVIDENCE LOCKER (CBZ.cityEvidenceSeize);
  //    · BAIL in city cash, or SERVE;
  //    · SERVE walks you into the holding cell and starts the TRANSPORT clock.
  //      The pry/keys escape survives as exactly what it should be — your last
  //      chance to be somewhere else when the van arrives.
  // ============================================================
  function beginBooking(opts) {
    if (!V || !V.ready || INM) return false;
    opts = opts || {};
    const w = Math.max(1, opts.stars ? (opts.stars | 0) : stars());
    const S0 = jailSentence(w);
    const charges = (CBZ.cityArrestCharges ? CBZ.cityArrestCharges(w, g.cityCrimeLabel) : ["Disorderly conduct"]);
    // the collar concludes the manhunt (you're in custody) — INCLUDING the
    // escaped-convict floor: without cityClearConvict a served/bailed release
    // walked you out into a re-asserted 3★ you'd already paid for.
    if (CBZ.cityWantedReset) { try { CBZ.cityWantedReset(); } catch (e) {} }
    if (CBZ.cityClearConvict) { try { CBZ.cityClearConvict(); } catch (e) {} }
    // …but the CUFFS stay on and the body stays held: cityWantedReset hands the
    // player back, and you are standing at a booking desk, not free.
    holdPlayer(true);
    // the property room takes the guns. Escaping does NOT give them back.
    const bagged = CBZ.cityEvidenceSeize ? CBZ.cityEvidenceSeize() : null;
    const hold = S0.hold + runAllowance();
    INM = { phase: "booking", sentence: S0.jail, prison: S0.prison, served: 0, wanted0: w,
      bribe: S0.bail, hold: hold, transportT: hold, pry: 0, _pryMark: 0,
      peaceful: !!opts.peaceful, lost: opts.lost | 0, charges,
      guns: bagged ? (bagged.inv || []).length + (bagged.melee ? 1 : 0) : 0,
      atDesk: !!opts.atDesk };
    if (!opts.atDesk) {
      // DEGRADE ONLY (flag off / no arc / no officer): the old instant landing.
      // Counted, because CBZ.arrestAudit().legacyTeleports existing at all is
      // what stops this quietly becoming the normal path again.
      const cell = V.cells[1], wc = W(cell.lx, cell.lz);
      teleportPlayer(wc.x, wc.z);
      if (CBZ.arrestCount) CBZ.arrestCount("legacyTeleports");
    }
    const s = bag(); s.stints++; save();
    // the charge sheet coming up in front of you IS the booking.
    big("BOOKING");
    openBooking();
    return true;
  }
  // THE CLOCK IS A RACE AGAINST A DISTANCE, so it has to know the distance.
  // The legacy yard puts 18 m between the player's cell and the hole in the
  // wall; the county jail puts ~73 m and three doorways between them. Leaving
  // HOLD_BASE fixed across both would not be "the same mechanic at a new
  // address" — it would be a silent ten-second nerf to the one escape this
  // venue exists for. So the van's ETA carries the RUN, at a sprint, and
  // nothing else moves: the pry is still 24 s of unobserved work and the patrol
  // rotation is still the only thing watching. Measured off the live anchors,
  // which is why the legacy siting gets exactly zero (17.7 m < 18) and the
  // sentence formula every other caller reads is untouched.
  const RUN_FREE = 18, RUN_SPD = 5.2;
  function runAllowance() {
    if (!V || !V.cells || !V.cells[1]) return 0;
    const c = V.cells[1];
    const d = Math.hypot(V.gap.x - c.lx, V.gap.z - c.lz);
    return Math.max(0, (d - RUN_FREE) / RUN_SPD);
  }

  // legacy name kept for the probe surface / any older caller
  function beginInmate(opts) { return beginBooking(opts); }

  // hold/free the player's body at the desk. The cuffs and the input lock are
  // city/wanted.js's (restrain.js's real zip-ties + physics.js's _cityArrested
  // gate) — this file owns neither and re-implements neither.
  function holdPlayer(on) {
    const P = CBZ.player;
    if (on) {
      if (P) { P._cityArrested = true; P.speed = 0; }
      if (CBZ.playerChar) { CBZ.playerChar.cuffed = true; CBZ.playerChar.handsUp = false; }
      if (CBZ.cityRestrain && CBZ.cityRestrain.cuffPlayer) { try { CBZ.cityRestrain.cuffPlayer(true); } catch (e) {} }
    } else if (CBZ.cityArrestUncuff) { try { CBZ.cityArrestUncuff(); } catch (e) {} }
    else {
      if (P) P._cityArrested = false;
      if (CBZ.playerChar) { CBZ.playerChar.cuffed = false; CBZ.playerChar.handsUp = false; }
      if (CBZ.cityRestrain && CBZ.cityRestrain.cuffPlayer) { try { CBZ.cityRestrain.cuffPlayer(false); } catch (e) {} }
    }
  }

  // SERVE: into the holding cell, ties cut, door locked, transport ordered.
  function doServe() {
    if (!INM) return;
    INM.phase = "held";
    holdPlayer(false);
    const cell = V.cells[1], wc = W(cell.lx, cell.lz);
    teleportPlayer(wc.x, wc.z);          // one pace through a door you are standing at
    setDoor(cell, true);
    panelMode = null; menuLock(false); if (C) C.hud.closePanel();
    // the door racking shut behind you is the "holding cell" line. What a
    // player genuinely cannot see is WHEN THE VAN COMES — so a screw tells him,
    // out loud, once, standing there. Not a HUD card.
    feed("Holding cell. Transport to the pen in " + Math.ceil(INM.transportT) + "s · " +
      INM.prison + "s to serve inside.", "#ffd166");
    feed("That plate's still loose. Last chance.", "#cfd6e6");
    say(anyGuard(), "\u201cVan's here in " + Math.ceil(INM.transportT) + ". Sit tight.\u201d", "#ffd27b", 3.0);
  }

  // THE TRANSPORT — the sealed handoff into the real prison. The van's door
  // closing IS the transition (city/elevators.js's law: a mode change hides
  // inside a sealed interior, never behind a visible teleport), and the fade
  // is city/death.js's EXISTING bust overlay, not a new HUD element.
  function toPrison() {
    if (!INM) return;
    const sec = INM.prison, bail = INM.bribe;
    const s = bag(); s.served++; save();
    setDoor(V.cells[1], true);
    holdPlayer(true);
    INM = null; panelMode = null; menuLock(false); if (C) C.hud.closePanel();
    // the pen reads these on its own reset (systems/state.js) — a handoff pair,
    // never a second sentence formula.
    g._jailSentenceIn = sec;
    g._jailBailIn = bail;
    const go = function () {
      holdPlayer(false);
      if (CBZ.cityArrestToPrison) CBZ.cityArrestToPrison();
      else { if (CBZ.setMode) CBZ.setMode("escape"); if (CBZ.setRole) CBZ.setRole("inmate"); if (CBZ.startRun) CBZ.startRun(); }
    };
    if (CBZ.cityBustOverlay) CBZ.cityBustOverlay(0, go, { title: "TRANSFERRED", note: "Prison transport · " + sec + "s to serve" });
    else go();
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
    holdPlayer(false);
    if (reason === "served") { s.served++; respect(2); big("TIME SERVED"); feed("You did your time. Back to the streets.", "#cfe8b0"); say(anyGuard(), "\u201cTime served. Out you go.\u201d", "#cfe8b0", 2.4); }
    else if (reason === "bailed" || reason === "bribed") {
      s.bribed++; big("RELEASED ON BAIL");
      say(V && V.sarge, "\u201cBond's posted. Door's that way.\u201d", "#ffd166", 2.4);
      // BAIL BUYS YOUR PROPERTY BACK TOO. Escaping does not — the locker keeps it.
      const back = CBZ.cityEvidenceReturn ? CBZ.cityEvidenceReturn() : 0;
      feed("Bond posted. You walk." + (back ? " Property returned (" + back + ")." : ""), "#ffd166");
      if (CBZ.arrestCount) CBZ.arrestCount("releases");
      // out the front, not out of thin air
      const wg = W(V.out.x, V.out.z); teleportPlayer(wg.x, wg.z);
    } else if (reason === "escaped") {
      s.escapes++;
      // OUT through the weak point — and HOT. Which way "out" is belongs to the
      // gap, not to this line: the legacy yard's hole faces -Z and the county
      // jail's service gate faces +X, and neither is typed here.
      const wg = W(V.gap.x + V.gapOut.x * 2.8, V.gap.z + V.gapOut.z * 2.8);
      teleportPlayer(wg.x, wg.z);
      g.escapedConvict = true;
      if (CBZ.cityAddStars) { try { CBZ.cityAddStars(4, "Jailbreak"); } catch (e) {} }
      else if (CBZ.cityForceStars) { try { CBZ.cityForceStars(4); } catch (e) {} }
      // FOUR STARS AND EVERY SIREN IN THE CITY IS THE ANNOUNCEMENT. A banner
      // reading "OVER THE WALL — MANHUNT" over the top of a live manhunt is
      // exactly the caption the owner is describing.
      big("OVER THE WALL · MANHUNT");
      // YOUR GUNS ARE STILL IN THE PROPERTY ROOM. Breaking out does not open
      // the locker; you are loose, broke of hardware, and hunted.
      const held = CBZ.cityEvidenceHeld ? CBZ.cityEvidenceHeld() : null;
      feed("You're out, and every cop in the city knows it. RUN." +
        (held && held.guns ? " (Your hardware's still in evidence.)" : ""), "#ff9a9a");
      if (CBZ.arrestCount) CBZ.arrestCount("escapes");
    }
    save();
    INM = null; panelMode = null; menuLock(false); if (C) C.hud.closePanel();
  }

  // ============================================================
  //  RELEASE FROM THE PEN — the other end of the pipe. Called by
  //  systems/capture.js when the sentence runs out, and by anything that
  //  legitimately opens the gate. Weapons come back out of evidence, the slate
  //  is clean, and you land at the law's own door rather than at a random
  //  spawn (the same point city/mode.js already uses for a jailbreak entry).
  // ============================================================
  function jailRelease(reason) {
    if (g.mode !== "escape") return false;
    g.jailSentence = 0; g._jailSentenceIn = 0; g._jailBailIn = 0;
    g.escapedConvict = false; g.escapedFromJail = false;
    if (!g.cityWorld) {                       // no city run behind this prison
      if (CBZ.winGame) { try { CBZ.winGame("route"); } catch (e) {} }
      return true;
    }
    if (CBZ.setMode) CBZ.setMode("city");
    if (CBZ.setRole) CBZ.setRole("inmate");
    if (CBZ.startRun) CBZ.startRun();
    // AFTER the city reset (which restores the character ledger, and whose
    // ledger records an EMPTY loadout because the guns were in evidence when it
    // was committed): hand the property back and put you on the precinct step.
    const back = CBZ.cityEvidenceReturn ? CBZ.cityEvidenceReturn() : 0;
    const st = CBZ.cityPoliceStation && CBZ.cityPoliceStation();
    const P = CBZ.player;
    if (st && P && P.pos) {
      const d = st.lot && st.lot.building && st.lot.building.door;
      const nx = d && d.nx != null ? d.nx : 0, nz = d && d.nz != null ? d.nz : 1;
      const nl = Math.hypot(nx, nz) || 1;
      P.pos.set(st.x + (nx / nl) * 3.0, 0, st.z + (nz / nl) * 3.0);
      P.vy = 0; P.grounded = true;
      if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(P.pos);
    }
    if (CBZ.cityWantedReset) { try { CBZ.cityWantedReset(); } catch (e) {} }
    if (CBZ.cityClearConvict) { try { CBZ.cityClearConvict(); } catch (e) {} }
    if (CBZ.city && CBZ.city.big) CBZ.city.big(reason === "bailed" ? "RELEASED ON BAIL" : "TIME SERVED");
    if (CBZ.city && CBZ.city.note) CBZ.city.note(back ? "Property returned at the desk." : "Nothing to collect at the desk.", 2.6);
    if (CBZ.arrestCount) CBZ.arrestCount("releases");
    return true;
  }
  CBZ.cityJailRelease = jailRelease;

  // recapture (spotted in the yard mid-breakout, or busted again outside
  // before you're clear): back in the cell, the stretch gets longer.
  // caught trying it on before the van comes: back in the cell, a longer
  // stretch waiting for you inside, and they MOVE THE TRANSPORT UP — the
  // punishment for a failed break is losing the time you needed for the next one.
  function recapture(byName) {
    if (!INM) return;
    const cell = V.cells[1]; const wc = W(cell.lx, cell.lz);
    teleportPlayer(wc.x, wc.z); setDoor(cell, true);
    INM.phase = "held";
    INM.prison += RECAP_PENALTY * PRISON_SCALE;
    INM.transportT = Math.min(INM.transportT, 16);
    INM.pry = 0; INM._pryMark = 0;      // they bolt a fresh plate on the door
    // being physically put back in the cell with the bars shut is "CAUGHT".
    big("CAUGHT");
    feed((byName ? byName + " drags you back. " : "Dragged back. ") + "+" +
      Math.round(RECAP_PENALTY * PRISON_SCALE) + "s inside, and the van's early.", "#ff9a9a");
    if (CBZ.shake) { try { CBZ.shake(0.7); } catch (e) {} }
    // (the bars shutting behind you are voiced by setDoor above — the leaf,
    // not the beat that asked for it.)
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
    INM.phase = "held"; INM.prison += RECAP_PENALTY * PRISON_SCALE; INM.pry *= 0.5; INM._pryMark = 0;
    if (spot && spot.ped && CBZ.citySay) { try { CBZ.citySay(spot.ped, "“Step AWAY from the door!”", "#ffd27b", 2.2); } catch (e) {} }
    feed((spot ? spot.name : "A guard") + " catches you at the door, the plate's hammered back. +" +
      Math.round(RECAP_PENALTY * PRISON_SCALE) + "s inside.", "#ff9a9a");
  }
  function popDoor(how) {
    if (!INM) return;
    INM.phase = "breakout";
    setDoor(V.cells[1], false);
    feed(how === "keys"
      ? "The keyring turns your lock. The gap's in the back corner. Mind their eyes."
      : "The plate gives, the door swings loose. The gap's in the back corner. Mind their eyes.", "#cfe8b0");
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
    if (INM) { feed("You're an inmate right now, you can't work the door."); return; }
    JOB = { active: true, caught: 0, wage: 0, escape: null, breakT: 14 + rng() * 10, t: 0 };
    const s = bag(); s.shifts++; save();
    feed("On duty. Runners go for the back-corner gap, cuff them before they're over.", "#cfe8b0");
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
    // the man is RUNNING, in front of you, and he already shouted on his way
    // past (citySay, above). That is the alarm.
    feed("Runner loose from the cells!", "#ff9a9a");
    return runner;
  }
  function driveRunner(dt) {
    if (!JOB || !JOB.escape) return;
    const e = JOB.escape, h = e.h, ped = h && h.ped;
    if (!ped || ped.dead) { JOB.escape = null; return; }
    e.t += dt;
    // MARCH FOR THE WEAK POINT (derived motion, like restrain.js escorts) — but
    // through the doors, not through the walls. `V.runVia` is the same one-field
    // answer the patrol ring uses: a short list of waypoints on the doorways'
    // own axis, walked in order, then the gap. The legacy yard declares none and
    // this is a straight line, exactly as before.
    if (!e.route) e.route = (V.runVia || []).concat([{ x: V.gapApp.x, z: V.gapApp.z }]);
    const leg = e.route[0];
    const goal = W(leg.x, leg.z);
    const dx = goal.x - ped.pos.x, dz = goal.z - ped.pos.z, d = Math.hypot(dx, dz) || 1;
    const step = Math.min(d, 3.2 * dt);
    ped.pos.x += dx / d * step; ped.pos.z += dz / d * step; ped.pos.y = 0;
    if (ped.group) { ped.group.position.set(ped.pos.x, 0, ped.pos.z); ped.group.rotation.y = Math.atan2(dx, dz); }
    if (CBZ.animChar && ped.char) CBZ.animChar(ped.char, step / Math.max(dt, 1e-3), dt);
    // caught?
    const P = CBZ.player;
    if (P && Math.hypot(P.pos.x - ped.pos.x, P.pos.z - ped.pos.z) <= CATCH_R) { catchRunner(); return; }
    // waypoint reached → next leg; the LAST leg is the gap, and reaching it is gone
    if (e.route.length > 1) { if (d <= 1.4) e.route.shift(); return; }
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
    if (cell) { const hw = W(cell.lx, cell.lz); ped.pos.set(hw.x, 0, hw.z); if (ped.group) ped.group.position.set(hw.x, 0, hw.z); ped.staffPost = { x: hw.x, z: hw.z, face: Math.PI / 2 }; setDoor(cell, true); }
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
    if (reason === "arrested") feed("Badge pulled, you're going in the cells yourself.", "#ff9a9a");
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
    near = !!(P && P.pos && Math.hypot(P.pos.x - V.origin.x, P.pos.z - V.origin.z) < (V.nearR || 60));

    // the patrol ring walks whenever anyone's watching — the guards' gaze
    // cones ARE the detection model, so the ring is the whole game.
    if (near || INM || JOB) marchGuards(dt);

    // ---- INMATE loop ----
    if (INM) {
      if (P && P.dead) { abortAll(); return; }
      if (INM.phase === "booking") {
        // Cuffed for the whole booking, but PINNED only while the sheet is
        // actually up. Holding the body with the panel closed would be a
        // soft-lock: physics.js zeroes movement off _cityArrested, and you
        // could not walk back to the desk zone that re-opens it.
        if (CBZ.playerChar) CBZ.playerChar.cuffed = true;
        if (P) { P._cityArrested = panelMode === "booking"; if (panelMode === "booking") P.speed = 0; }
        if (CBZ.animChar && CBZ.playerChar) { try { CBZ.animChar(CBZ.playerChar, 0, dt); } catch (e) {} }
      } else if (INM.phase === "held" || INM.phase === "prying" || INM.phase === "breakout") {
        // THE TRANSPORT CLOCK. It runs through every holding-cell phase, so the
        // pry and the run for the gap are a race against a real van, not a
        // decoration. The day rolls while you wait (dayPhase-aware, as before).
        INM.transportT -= dt;
        if (CBZ.dayPhase) { try { CBZ.dayPhase(CBZ.dayPhase() + dt * SERVE_DAY_RATE); } catch (e) {} }
        const mark = Math.ceil(INM.transportT);
        if (INM._tMark !== mark && (mark === 20 || mark === 10 || mark === 5)) {
          INM._tMark = mark;
          // the van is a THING that arrives; a deputy calls the count down the
          // corridor rather than the HUD ticking at you.
          if (feed("Transport in " + mark + "s.", mark <= 5 ? "#ff9a9a" : "#ffd27b") && mark <= 10)
            say(anyGuard(), "\u201c" + mark + " seconds!\u201d", "#ff9a9a", 1.6);
        }
        if (INM.transportT <= 0) { toPrison(); return; }
      }
      if (INM && INM.phase === "prying") {
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
      // A POST MAY DECLARE A WAY IN. The county jail's ring runs through the
      // building's own front doorway, and a guard marched on a straight line
      // from a yard post to the post behind the booking counter would walk
      // through the facade. `via` is ONE waypoint on the doorway's axis,
      // cleared before the post itself — the whole of the pathing this ring
      // needs, which is why it is a field and not a navmesh.
      if (h._ringAt !== h._ring) { h._ringAt = h._ring; h._via = post.via || null; }
      const tgt = h._via || post;
      const goal = W(tgt.lx, tgt.lz);
      const dx = goal.x - ped.pos.x, dz = goal.z - ped.pos.z, d = Math.hypot(dx, dz);
      if (d > 0.35) {
        const step = Math.min(d, GUARD_WALK * dt);
        ped.pos.x += dx / d * step; ped.pos.z += dz / d * step; ped.pos.y = 0;
        if (ped.group) { ped.group.position.set(ped.pos.x, 0, ped.pos.z); ped.group.rotation.y = Math.atan2(dx, dz); }
        if (CBZ.animChar && ped.char) CBZ.animChar(ped.char, step / Math.max(dt, 1e-3), dt);
        if (ped.staffPost) { ped.staffPost.x = ped.pos.x; ped.staffPost.z = ped.pos.z; }
      } else if (h._via) {
        h._via = null;                       // waypoint reached — on to the post itself
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
      if (d > ((V && V.seeR) || GUARD_SEE_R) || d < 0.01) continue;
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
    if (INM) holdPlayer(false);            // never leave a body cuffed and input-locked
    INM = null; JOB = null; PENDING = null; panelMode = null; menuLock(false);
    if (C) C.hud.closePanel();
  }
  // core/mission.js's ONE sweeper. A booking desk is a modal that holds the
  // player's body; it must not be able to survive a death or a mode exit.
  // Idempotent — abortAll on nothing is a no-op.
  if (CBZ.mission && CBZ.mission.onInterrupt) {
    CBZ.mission.onInterrupt(function (reason) {
      if (reason === "death" || (reason === "mode" && g.mode !== "city")) abortAll();
    });
  }

  /* ==========================================================
     7. PANELS — the sentence options only. GRAMMAR LAW (owner): every
        button is a VERB, one word (+ an optional number). The escape is
        NOT a button — it's a loose plate on a real door.
     ========================================================== */
  const BTN = "display:inline-block;margin:3px 5px 3px 0;padding:9px 15px;border-radius:11px;cursor:pointer;font-weight:800;font-size:14px;user-select:none;box-shadow:0 3px 0 rgba(0,0,0,.4);";
  function btn(act, label, bg, dis) { return "<span data-act='" + act + "' style='" + BTN + "background:" + (bg || "#1c6b40") + ";" + (dis ? "opacity:.35;pointer-events:none;" : "") + "'>" + label + "</span>"; }
  function head(title, sub) { return "<div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:8px'><b style='letter-spacing:2px;color:#e8b64c'>" + title + "</b><span style='opacity:.7;font-size:12px'>" + (sub || "") + " · Esc closes</span></div>"; }

  // THE BOOKING SCREEN. It is a bounded package panel (ctx.hud.panel), which is
  // the one sanctioned modal here — no floating card, no second HUD layer, and
  // every button is still a bare VERB.
  function openBooking() {
    if (!INM) return;
    if (INM.phase !== "booking") { panelMode = null; menuLock(false); if (C) C.hud.closePanel(); return; }
    panelMode = "booking"; menuLock(true);
    // the sheet is CLICKED — hand the mouse back (same beat the legacy bust
    // overlay ran; a locked pointer swallows every button on this card).
    if (document.exitPointerLock) { try { document.exitPointerLock(); } catch (e) {} }
    const canBail = C.wallet.cash() >= INM.bribe;
    const row = (k, v) => "<div style='display:flex;justify-content:space-between;font-size:12px;margin:2px 0'><span style='opacity:.7'>" + k + "</span><b>" + v + "</b></div>";
    const charges = INM.charges.map((c) =>
      "<div style='font-size:12px;margin:1px 0 1px 6px;opacity:.9'>· " + c + "</div>").join("");
    C.hud.panel(
      head("BOOKING", INM.wanted0 + "★ jacket") +
      "<div style='font-size:11px;letter-spacing:1px;opacity:.6;margin-top:4px'>CHARGES</div>" + charges +
      "<div style='height:6px'></div>" +
      row("Property seized", INM.guns ? INM.guns + " item" + (INM.guns === 1 ? "" : "s") + " → evidence" : "nothing") +
      row("Forfeited", INM.lost > 0 ? fmt(INM.lost) : "—") +
      row("Sentence", INM.prison + "s in state prison") +
      row("Bail set at", fmt(INM.bribe)) +
      row("On you", fmt(C.wallet.cash())) +
      "<div style='height:8px'></div>" +
      btn("serve", "SERVE", "#2a6b40") +
      btn("bail", "BAIL " + fmt(INM.bribe), canBail ? "#8a6a1f" : "#4a4433", !canBail),
      { serve: () => doServe(),
        bail: () => doBail(),
        // Esc does NOT walk you out of a booking desk — it just puts the sheet
        // down. The cell zone re-opens it.
        close: () => { menuLock(false); C.hud.closePanel(); panelMode = null; } });
  }
  function doBail() {
    if (!INM) return;
    if (!C.wallet.spend(INM.bribe, "Posted bail")) { feed("Not enough cash to post bond."); return; }
    releaseInmate("bailed");
  }
  function doBribe() { doBail(); }

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
  // is city/wanted.js's physical arrest arc the live path? If so it owns the
  // scene end-to-end and delivers here through CBZ.cityBookIn.
  function arcLive() {
    return CBZ.CONFIG.ARREST_ARC !== false && typeof CBZ.cityArrestCharges === "function";
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
            // mid-breakout collar = recapture; booking/held = already in custody.
            if (INM.phase === "breakout") recapture(opts && opts.cop && ((opts.cop.data && opts.cop.data.name) || opts.cop.name));
            return;
          }
          if (JOB && JOB.active) endShift("arrested");           // badge off, then in
          // ---- ONE PIPELINE, NOT TWO. ----
          // For this file's whole life this wrap SWALLOWED the arrest and
          // teleported the player into a cell — which meant city/wanted.js's
          // choreographed bust (hands up, cuffs, the officer closing, the cash
          // forfeit, g.busted, mission.onInterrupt("bust")) was dead code on
          // every real arrest, and the owner never saw a cuff.
          // With the arc live we do the opposite: fall THROUGH to wanted.js,
          // which runs the whole scene and hands custody back to us at the
          // booking desk via CBZ.cityBookIn. The intercept below survives only
          // as the degrade for ARREST_ARC = false.
          if (arcLive()) return orig.apply(this, arguments);
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
     8b. THE PIPE INTO THE MAIN GAME — two exports, and they are the whole
         seam city/wanted.js's arrest arc rides.

         cityJailGate()  — WHERE the cruiser is driving to, where it stops,
                           where the perp walk ends. The compound group is
                           never rotated (see §3), so local +Z is world +Z and
                           the outward normal is a constant, not a solve.
         cityBookIn()    — TAKE CUSTODY. Returns false if this venue cannot
                           (not mounted, flag off, already holding somebody),
                           and the arc then falls back to the legacy overlay +
                           straight transfer. An arrest may never evaporate.
     ========================================================== */
  CBZ.cityJailGate = function () {
    if (!V || !V.ready || !V.origin) return null;
    const stop = W(V.stop.x, V.stop.z);        // the cruiser's kerb — outside the wire
    return { x: stop.x, z: stop.z, nx: 0, nz: 1,
      gate: W(V.gateIn.x, V.gateIn.z),         // the sally port, on the way in
      desk: W(V.desk.x, V.desk.z) };           // the booking counter itself
  };
  // EVERY POINT THIS JAIL HAS, IN WORLD COORDS, from one place. `cityJailGate`
  // is the arrest arc's contract and stays exactly what it was; this is for
  // anything else that needs to know where the cells or the yard are (probes,
  // contracts, a future bail bondsman) so nothing ever re-derives them from a
  // literal again. `onPlot` is the honest answer to "is this the real jail or
  // the degrade yard".
  CBZ.cityJailAnchors = function () {
    if (!V || !V.ready || !V.origin) return null;
    return {
      onPlot: !!V.onPlot,
      origin: { x: V.origin.x, z: V.origin.z },
      stop: W(V.stop.x, V.stop.z),
      gate: W(V.gate.x, V.gate.z),
      desk: W(V.desk.x, V.desk.z),
      release: W(V.out.x, V.out.z),
      weak: W(V.gap.x, V.gap.z),
      weakOut: { x: V.gapOut.x, z: V.gapOut.z },
      cells: V.cells.map(function (c) { const w = W(c.lx, c.lz); return { i: c.i, x: w.x, z: w.z, locked: !!c.locked }; }),
      posts: V.posts.map(function (p) { const w = W(p.lx, p.lz); return { x: w.x, z: w.z, face: p.face, inside: !!p.via }; }),
    };
  };
  // THE REBUILD, AS A NUMBER. `roofed` and `walled` are what the owner actually
  // complained about ("an OPEN-TOP BUILDING IN THE MIDDLE OF TOWN") and they
  // are read off the LIVE world, not asserted: roofed means the cells stand
  // inside a real cityMakeBuilding shell, walled means the yard's wall came
  // from the complex row. `onOwnLand` means the plot is a registered region
  // with its own access road. All three may only ever go from false to true.
  CBZ.jailSiteAudit = function () {
    const S = CBZ.govComplexes || [];
    let site = null;
    for (let i = 0; i < S.length; i++) if (S[i] && S[i].id === "countyjail") site = S[i];
    const P = site && site.jail;
    const b = P && P.building;
    return {
      mounted: !!(V && V.ready),
      onOwnLand: !!(site && site.rect),
      roofed: !!(V && V.onPlot && b && b.storeys > 0),
      walled: !!(V && V.onPlot && P && P.wallH >= 4.0),
      roadedTo: site ? ((site.roads || []).length | 0) : 0,
      cells: V ? V.cells.length : 0,
      posts: V ? V.posts.length : 0,
      insidePosts: V ? V.posts.filter(function (p) { return !!p.via; }).length : 0,
      wallH: P ? P.wallH : 0,
      storeys: b ? (b.storeys | 0) : 0,
      weakPoints: 1,                       // by construction: ONE gate that does not latch
      // the escape, as a distance and the seconds the clock hands you for it
      runDist: (V && V.cells && V.cells[1]) ? +Math.hypot(V.gap.x - V.cells[1].lx, V.gap.z - V.cells[1].lz).toFixed(1) : 0,
      runAllowance: +runAllowance().toFixed(2),
      seeR: V ? V.seeR : 0,
      anchors: CBZ.cityJailAnchors ? CBZ.cityJailAnchors() : null,
    };
  };
  CBZ.cityBookIn = function (opts) {
    if (!jailOn() || !V || !V.ready || INM || g.mode !== "city") return false;
    if (CBZ.CONFIG.GAME_PACKAGES === false) return false;
    if (CBZ.cityCampaignActive && CBZ.cityCampaignActive()) return false;
    if (JOB && JOB.active) endShift("arrested");
    try { return !!beginBooking(opts || {}); }
    catch (e) { console.error("[gamepkg:jail] bookIn", e); return false; }
  };
  // the pen asks how long it is holding you for (systems/capture.js).
  CBZ.cityJailHeldSentence = function () { return (g.jailSentence | 0) || 0; };

  /* ==========================================================
     9. REGISTER — a SITE venue.

     THE PLOT FIRST. city/govcomplex.js's "countyjail" row has already claimed
     a civic plot at the edge of town, registered its region, its keep-out and
     a real access road, and raised the building; mounting on its centre is the
     whole of the siting fix. Only when there is no plot (flag off, govcomplex
     absent, or no clear ground on this seed) do we fall back to the old
     answer — the city's law intake (the precinct / City Hall desk, which is
     WHY the jail used to stand in the middle of town) with a constants-ish
     fallback near arena centre.
     ========================================================== */
  CBZ.games.register({
    id: "jail",
    title: "COUNTY JAIL",
    venue: {
      site: "cityjail",
      resolve(CBZ) {
        const plot = plotFor();
        if (plot && plot.origin) return { x: plot.origin.x, z: plot.origin.z };
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
      rules: { sentenceFor, bribeCost, jailSentence, PRISON_SCALE, PRY_TIME, RECAP_PENALTY, WAGES },
      mounted: () => !!(V && V.ready),
      near: () => near,
      arc: () => (INM ? { phase: INM.phase, sentence: INM.sentence, prison: INM.prison,
        transportT: +INM.transportT.toFixed(2), wanted0: INM.wanted0, bribe: INM.bribe,
        guns: INM.guns, lost: INM.lost, charges: INM.charges.slice(), pry: +INM.pry.toFixed(2) } : null),
      shift: () => (JOB ? { active: JOB.active, caught: JOB.caught, wage: JOB.wage, escape: !!JOB.escape } : null),
      state: () => (S ? JSON.parse(JSON.stringify(S)) : null),
      cast: () => (V ? { guards: V.guards.length, inmates: V.inmates.length, sarge: !!V.sarge, cells: V.cells.length, posts: V.posts.length } : null),
      anchor: () => (V ? { x: V.origin.x, z: V.origin.z } : null),
      // the rebuild, as numbers a probe can assert on
      site: () => (CBZ.jailSiteAudit ? CBZ.jailSiteAudit() : null),
      anchors: () => (CBZ.cityJailAnchors ? CBZ.cityJailAnchors() : null),
      onPlot: () => !!(V && V.onPlot),
      cellLocked: (i) => (V && V.cells[i] ? !!V.cells[i].locked : null),
      engages: () => jailEngages(),
      pending: () => !!PENDING,
      guardSees: () => !!guardSpots(CBZ.player),
      seed: (s) => seedRng(s),

      // ---- INMATE rigs ----
      // fire the REAL seam (respects the flag/guards) or force the arc directly.
      bust: (opts) => (CBZ.cityBust ? (CBZ.cityBust(opts || {}), true) : false),
      beginInmate: (opts) => beginInmate(opts || {}),
      bookIn: (opts) => !!(CBZ.cityBookIn && CBZ.cityBookIn(opts || { atDesk: true })),
      gate: () => (CBZ.cityJailGate ? CBZ.cityJailGate() : null),
      serve: () => { if (INM && INM.phase === "booking") { doServe(); return INM.phase === "held"; } return false; },
      // force the transport (the sealed handoff into the real prison)
      _transport: () => { if (INM && INM.phase !== "booking") { toPrison(); return true; } return false; },
      setTransport: (x) => { if (INM) { INM.transportT = +x || 0; return true; } return false; },
      bail: () => { if (INM) { doBail(); return !INM; } return false; },
      bribe: () => { if (INM) { doBail(); return !INM; } return false; },
      pry: () => { if (INM) { startPry(); return INM.phase === "prying"; } return false; },
      stopPry: () => { if (INM) { stopPry(false); return INM.phase === "held"; } return false; },
      setPry: (x) => { if (INM) { INM.pry = +x || 0; return true; } return false; },
      _pryComplete: () => { if (INM && (INM.phase === "prying" || INM.phase === "held")) { INM.pry = PRY_TIME; popDoor(); return INM.phase === "breakout"; } return false; },
      liftKeys: () => { if (canLiftKeys()) { takeKeys(); return INM.phase === "breakout"; } return false; },
      // TEARDOWN, for a probe that has to run many arrests in one page.
      // This is the file's OWN sweeper — the same one core/mission.js's
      // onInterrupt calls on a death or a mode exit — so a suite cleaning up
      // between sections exercises the real teardown instead of inventing a
      // second one. Idempotent: abortAll on nothing is a no-op.
      _abort: () => { abortAll(); return !INM && !JOB; },
      reachGap: () => { if (INM && INM.phase === "breakout") { const wg = W(V.gap.x, V.gap.z); teleportPlayer(wg.x, wg.z); releaseInmate("escaped"); return true; } return false; },
      phase: () => (INM ? INM.phase : null),

      // ---- JAILOR rigs ----
      startShift: () => (startShift(), !!(JOB && JOB.active)),
      endShift: (why) => { endShift(why || "clocked off"); return !JOB; },
      rigEscape: () => { const r = rigEscape(); return !!r; },
      catch: () => { if (JOB && JOB.escape) { const ped = JOB.escape.h && JOB.escape.h.ped; if (ped) { const w = W(V.gapApp.x - V.gapOut.x * 1.4, V.gapApp.z - V.gapOut.z * 1.4); teleportPlayer(w.x, w.z); ped.pos.set(w.x, 0, w.z); } catchRunner(); return true; } return false; },
      missEscape: () => { if (JOB && JOB.escape) { missRunner(); return true; } return false; },
    },
  });
})();
