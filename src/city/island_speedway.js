/* ============================================================
   city/island_speedway.js — DIAMOND SPEEDWAY, THE CIRCUIT.

   WHY: a city this size has nowhere to open a car up. The drag of
   stop-lights and traffic is the whole point of the streets, but a
   gearhead needs a place where speed is the ONLY rule. So the
   northern bay gets a real superspeedway, reachable by its own
   causeway bridge off the commerce annex. You drive across the water,
   through the marshal gate on the back straight, and at the start/
   finish line under the gantry a flag stand offers the only thing the
   streets can't: JOIN THE RACE.

   WHAT THIS FILE IS: the LAND. One parametric racing line (defined
   ONCE — see the long note above trackFrame), and a real 3-D circuit
   swept along it:
     • a BANKED, CROWNED asphalt ribbon. The shape is authored as a
       CURVATURE DIAGRAM the way circuits actually are: zero down the
       back straight, gentle through the tri-oval front stretch, hard
       through the turns, joined by C2 transition spirals. Bank angle
       is derived FROM curvature, so it is steep in the turns and
       shallow on the straights and can never be discontinuous.
     • a flat inside apron at the foot of the banking, red/white kerbs
       through the turns, a graded outer embankment down to grade.
     • SAFER barrier walls with sponsor panels, catch fencing on posts
       and cable runs above them, retaining walls through the turns,
       and ONE marshal service gate on the back straight (the way on
       and off the circuit).
     • a trussed START/FINISH GANTRY over the racing surface with a
       five-column light rig driven live by the race countdown.
     • paint that belongs to a circuit: track limits, the rubbered-in
       groove and marbles baked into the asphalt, the starting grid,
       pit-in/pit-out blend lines.

   The ARCHITECTURE — grandstands, the pit lane and garages, the
   scoring pylon, the jumbotron, floodlight masts, hoardings, marshal
   posts, tyre walls, gravel run-off, the paddock — lives next door in
   city/speedway_structures.js and is authored against the same frame.

   The motorsports park around the circuit exists for the same reason a
   real speedway has a midway: the AUTO SHOWROOM is the cathedral —
   every car the city sells, on lit pads, so the track is also where you
   go to covet the next ride. A team garage, a trophy hall and the
   paddock round it out.

   PERF: every surface (asphalt, apron, embankment, walls, fences,
   hoardings, roofs) is ONE swept BufferGeometry; every repeated element
   (kerbs, fence posts, grid paint, seats, truss members, tyres, lamps)
   is an InstancedMesh. The race AI cars use the real driving brain
   (racedrivers.js) around the same line. Deterministic seed stream, so
   the park is identical every run.

   Publishes: CBZ.speedwayFrame / speedwaySurfaceY / speedwayTrackLen,
   the landmass builder, the zone interactions, and the race flow.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;
  const mat = CBZ.cmat || CBZ.mat || function (c, o) {
    return new THREE.MeshLambertMaterial(Object.assign({ color: c }, o && o.emissive ? { emissive: o.emissive, emissiveIntensity: o.ei || 0.5 } : {}));
  };

  // ====================================================================== //
  //  CONFIG FLAGS — every risky part of the rebuild is a one-line revert.    //
  //  (Self-defaulted here rather than in config.js because this file owns    //
  //   all of them; the `== null` guard means ?cfg_X=0 always wins.)          //
  // ====================================================================== //
  // SPEEDWAY_BANK — the circuit is REAL banked geometry: progressive bank
  // (steep through the turns, shallow on the back straight), spiral
  // transitions, crowned asphalt, a flat inside apron and a graded outer
  // embankment. Flip false (or ?cfg_SPEEDWAY_BANK=0) and the identical
  // ribbon builds dead flat — same layout, zero elevation.
  if (CBZ.CONFIG.SPEEDWAY_BANK == null) CBZ.CONFIG.SPEEDWAY_BANK = true;
  // SPEEDWAY_BANK_WALKABLE — publish the banked surface as a city ground
  // height (CBZ.registerCityGroundHeight) so the player and peds walk UP the
  // banking instead of through it. Off → the banking is scenery you clip.
  if (CBZ.CONFIG.SPEEDWAY_BANK_WALKABLE == null) CBZ.CONFIG.SPEEDWAY_BANK_WALKABLE = true;
  // SPEEDWAY_CAR_CONFORM — cars in this engine are 2D (they always drive at
  // y=0, see vehicles.js). This PRESENTATIONAL pass lifts/rolls/pitches any
  // car standing on the speedway onto the banked surface. Off → cars drive
  // through the banking at y=0.
  if (CBZ.CONFIG.SPEEDWAY_CAR_CONFORM == null) CBZ.CONFIG.SPEEDWAY_CAR_CONFORM = true;
  // SPEEDWAY_CATCH_FENCE — debris fencing (posts + cable runs + mesh) above
  // the SAFER wall. Off → bare wall, one less transparent surface.
  if (CBZ.CONFIG.SPEEDWAY_CATCH_FENCE == null) CBZ.CONFIG.SPEEDWAY_CATCH_FENCE = true;
  // SPEEDWAY_STRUCTURES — the rebuilt architecture (grandstands, pit lane +
  // garages, scoring pylon, jumbotron, floodlights, hoardings, marshal posts,
  // tyre walls, paddock) from city/speedway_structures.js. Off → track only.
  if (CBZ.CONFIG.SPEEDWAY_STRUCTURES == null) CBZ.CONFIG.SPEEDWAY_STRUCTURES = true;
  // SPEEDWAY_SITE — THE ARRIVAL. OWNER: "the racing arena … is not very
  // intentional feeling right now." The circuit was finished and the SITE was
  // not: the approach ran out onto an unfenced apron, nothing named the place
  // before you reached it, nobody worked the entrance, the racing surface had
  // no keep-out so a wandering pedestrian could stand on the racing line, and
  // the "public car park" was 264 m of painted stalls holding TEN cars — which
  // never existed, because the loop that made them ran inside a landmass
  // builder where CBZ.city.arena does not exist yet and every call threw into
  // a swallowing catch. Off → the pre-fix campus, exactly as it shipped.
  if (CBZ.CONFIG.SPEEDWAY_SITE == null) CBZ.CONFIG.SPEEDWAY_SITE = true;
  // SPEEDWAY_PARK_V2 — the car park at REAL dimensions and at the size the
  // campus actually holds. The lot shipped as 15 x 2 stalls of 2.7 x 5.2 on a
  // 6.3 aisle: those are COMPACT-car numbers (ULI's standard stall is
  // 2.74 x 5.49 and a two-way aisle is 7.32, so a double-loaded module is
  // 18.30 m, not 16.7), and 30 bays on a 264 m apron was a placeholder nobody
  // ever went back to. Off → the old 30-bay compact lot, byte for byte.
  if (CBZ.CONFIG.SPEEDWAY_PARK_V2 == null) CBZ.CONFIG.SPEEDWAY_PARK_V2 = true;

  // ---- footprint -----------------------------------------------------------
  // One authoritative transform owns every speedway surface. The campus is
  // kept clear of Halloran Field (west) and the Saltlands (east); R is what
  // the city region registers as speedway ownership.
  const _WOFF = (CBZ.worldOff && CBZ.worldOff("speedway")) || { dx: 0, dz: 0 };   // world-layout dial (zero today)
  const CX = 490 + _WOFF.dx, CZ = -350 + _WOFF.dz, R = 210;   // speedway/campus ownership radius
  // The visible venue is deliberately not a circular island.  Its irregular,
  // elongated boundary follows the circuit and grows a southern paddock
  // shoulder, so from the air it reads as a motorsports campus cut into the
  // country.  NOTE: this superellipse does NOT auto-follow the racing line —
  // if you resize the track (TRACK_HX / TRACK_DZ below) check it still
  // contains the outer embankment plus the grandstands.
  const SITE_HX = 205, SITE_HZ = 182, SITE_DZ = -23;
  const SITE_POW = 2.45;               // the superellipse exponent (see stadiumSiteGeometry)
  const ACCESS_X = CX - 98, ACCESS_Z = CZ - 190;
  const ANNEX = { cx: 348.5, cz: -700, r: 120 }; // existing commerce island (DO NOT TOUCH)

  // ---- THE SITE (arrival) --------------------------------------------------
  // ONE point on the campus boundary, inset by `m` metres, derived from the
  // SAME four constants stadiumSiteGeometry() sweeps. The perimeter fence, the
  // gate and the sign are all placed through this, so a resize of the campus
  // moves the whole arrival with it and there is nothing left to hand-sync —
  // the mistake the file's own comment warns about above SITE_HX.
  function siteEdge(a, m) {
    const ca = Math.cos(a), sa = Math.sin(a), p = 2 / SITE_POW;
    return {
      x: CX + Math.sign(ca) * Math.pow(Math.abs(ca), p) * (SITE_HX - m),
      z: CZ + SITE_DZ + Math.sign(sa) * Math.pow(Math.abs(sa), p) * (SITE_HZ - m),
    };
  }
  const FENCE_INSET = 5;
  // The landside rim, west flank round to east flank. The public arrives on
  // this half; the far side is the circuit and its own walls.
  function sitePerimeter() {
    const pts = [];
    for (let d = 184; d <= 356; d += 6) pts.push(siteEdge(d * Math.PI / 180, FENCE_INSET));
    return pts;
  }
  // WHERE THE APPROACH CROSSES THE PERIMETER — solved off the polyline, never
  // typed. That crossing IS the gate, and the causeway is extended to run
  // through it (it used to stop 22 m short, on open apron, at ACCESS_X).
  function gateOnPerimeter() {
    const pts = sitePerimeter();
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      if (a.x > CX || b.x > CX) continue;                  // west flank only
      if ((a.z - ACCESS_Z) * (b.z - ACCESS_Z) > 0) continue;
      const t = (ACCESS_Z - a.z) / ((b.z - a.z) || 1e-6);
      return { x: a.x + (b.x - a.x) * t, z: ACCESS_Z };
    }
    return { x: ACCESS_X, z: ACCESS_Z };
  }
  const GATE = gateOnPerimeter();
  // Half-width of the opening in the fence. Sized off what has to fit inside
  // it, not picked: the 24 m carriageway (12), the gate piers (13.3), and the
  // control hut standing outside them (16.5 +/- 1.35) — so 19 clears the lot
  // and the fence can never be drawn through the gate's own hardware.
  const GATE_GAP = 19;
  // The approach runs THROUGH the gate and stops on campus — clamped short of
  // the point where the perimeter comes back across the road line, so the deck
  // can never dead-end into its own fence.
  const ROAD_END_X = Math.min(GATE.x + 10, CX - 74);

  // ---- the public car park: ONE solve for the paint AND the metal ----------
  // The old lot painted stalls 14 m wide across 264 m of apron (a truck bay,
  // not a car bay) and filled them from an unrelated loop. Both now come from
  // CBZ.venueSite.bays, so the stripes and the cars are the same numbers.
  // Its footprint is boxed by three things it must not touch: the 24 m
  // approach deck to the south (z <= CZ-178), the glass showroom's west wall
  // to the east (buildComplex puts it at CX-72), and the perimeter fence to
  // the west — which is why the lot is 15 bays wide and not 97.
  const PARK_FILL = 0.42;              // how full a mid-week race day looks
  // A REAL LOT IS MOSTLY EMPTY AND METAL IS THE EXPENSIVE PART. The bay count
  // triples in this change and 0.68 of it would be ~90 full vehicle rigs on one
  // campus — a frame budget spent on scenery. The fill is a rate AND a hard
  // ceiling, and the ceiling bites in block order, so the cars that do exist
  // are the ones nearest the gate. (Same rule as ARENA_PARK_CARS.)
  const PARK_CARS = 46;
  // REAL 90-DEGREE SURFACE-PARKING GEOMETRY (ULI, Dimensions of Parking): a
  // standard stall is 2.74 x 5.49 m, a two-way aisle is 7.32, so a
  // double-loaded module is 18.30 m and an efficient lot lands near 30 m2 a
  // space. Every number below is one of those three or is solved from them.
  const STALL_W = 2.74, STALL_D = 5.49, AISLE_W = 7.32;
  const PARK_MOD = STALL_D * 2 + AISLE_W;            // 18.30
  // The spine lane (the gate -> park -> concourse walk) owns x CX-77.5 .. -72.5
  // and is painted into the surface texture below; the lot stops 1 m clear of it.
  const PARK_EAST = CX - 78.5;
  const PARK_SETBACK = 4;              // off the perimeter fence

  // WHERE THE PERIMETER STANDS AT THIS z — the SAME superellipse siteEdge()
  // sweeps, solved for x instead of for an angle, so the lot can never be sized
  // against a second copy of the campus boundary. Returns null past the ends.
  function fenceFlankX(z, side) {
    const s = Math.abs(z - (CZ + SITE_DZ)) / (SITE_HZ - FENCE_INSET);
    if (s >= 1) return null;
    const sa = Math.pow(s, SITE_POW / 2), ca = Math.sqrt(Math.max(0, 1 - sa * sa));
    return CX + side * Math.pow(ca, 2 / SITE_POW) * (SITE_HX - FENCE_INSET);
  }

  // ---- the public car park: ONE solve for the paint AND the metal ----------
  // The old lot painted stalls 14 m wide across 264 m of apron (a truck bay,
  // not a car bay) and filled them from an unrelated loop. Both now come from
  // CBZ.venueSite.bays, so the stripes and the cars are the same numbers.
  //
  // WHAT CHANGED, AND WHY IT WAS 15 BAYS WIDE FOR NO REASON. The comment here
  // used to say the lot was boxed by "the perimeter fence to the west — which
  // is why the lot is 15 bays wide and not 97". The perimeter was never
  // measured: at the lot's own southern edge the fence stands at CX-119.9, and
  // the lot's west edge was typed at CX-119 — so the number that was supposed
  // to be doing the boxing was a coincidence, and everything NORTH of that edge
  // (where the superellipse bows out fast: CX-149 twenty metres up, CX-168
  // forty) was simply never used. The campus's own painted courts say where the
  // ground is: `court(CX-132, CZ-204, CX+132, CZ-158)` is the public apron and
  // `court(CX-124, CZ-158, CX+124, CZ-126)` is the paddock apron. Three blocks
  // fit inside those two courts, and each one's WIDTH is solved against the
  // perimeter at its own southern edge — the binding edge, because the fence
  // only ever bows further west as z rises.
  const PARK_SPEC = [
    // 1. the public apron, from the approach road's north kerb (CZ-178) north
    //    to the showroom line (CZ-158): one module, and the block every
    //    arriving car meets first.
    { z0: CZ - 177.2, rows: 2, side: -1, east: PARK_EAST },
    // 2. the paddock apron WEST of the buildings. One module, stopping 12.7 m
    //    short of the stand concourse court at CZ-126 — a second module there
    //    would park cars in the concourse.
    { z0: CZ - 157.0, rows: 2, side: -1, east: PARK_EAST },
    // 3. the east end of the public apron, past the trophy lounge (buildComplex
    //    puts its east wall at CX+90). Narrow, because the perimeter comes back
    //    in on this flank too — which is exactly what the solve is for.
    { z0: CZ - 177.2, rows: 2, side: 1, west: CX + 94 },
  ];
  const PARK_LEGACY = { x0: CX - 119, z0: CZ - 176, cols: 15, rows: 2,
                        stallW: 2.7, stallD: 5.2, aisle: 6.3 };
  let _parkBlocks = null;
  const NO_BLOCKS = [];
  function parkBlocks() {
    if (_parkBlocks) return _parkBlocks;
    // NEVER MEMOISE THE FAILURE. venueSite is published by another file, so the
    // first caller can legitimately arrive before it exists; caching an empty
    // array here would leave the lot permanently unbuilt for the rest of the
    // run. (The single-lot version this replaces only ever cached a success —
    // keeping that property is the whole reason this is not one line.)
    if (!CBZ.venueSite || !CBZ.venueSite.bays) return NO_BLOCKS;
    const out = [];
    if (CBZ.CONFIG.SPEEDWAY_PARK_V2 === false) {
      const L0 = CBZ.venueSite.bays(PARK_LEGACY);
      if (!L0) return NO_BLOCKS;
      L0.x0 = PARK_LEGACY.x0; L0.z0 = PARK_LEGACY.z0; L0.rows = PARK_LEGACY.rows;
      out.push(L0);
      _parkBlocks = out;
      return _parkBlocks;
    }
    for (let i = 0; i < PARK_SPEC.length; i++) {
      const sp = PARK_SPEC[i], depth = (sp.rows / 2) * PARK_MOD;
      // IT REFUSES RATHER THAN OVERWRITES: the block is tested against the
      // perimeter along its whole depth, not just at a corner, and is simply
      // not built if the campus does not hold it.
      let ok = true, edge = sp.side < 0 ? -1e9 : 1e9;
      for (let t = 0; t <= 8; t++) {
        const fx = fenceFlankX(sp.z0 + depth * t / 8, sp.side);
        if (fx == null) { ok = false; break; }
        edge = sp.side < 0 ? Math.max(edge, fx + PARK_SETBACK) : Math.min(edge, fx - PARK_SETBACK);
      }
      if (!ok) continue;
      const x0 = sp.side < 0 ? edge : sp.west;
      const x1 = sp.side < 0 ? sp.east : edge;
      const cols = Math.floor((x1 - x0) / STALL_W);
      if (cols < 4) continue;
      const L = CBZ.venueSite.bays({
        x0: x0, z0: sp.z0, cols: cols, rows: sp.rows,
        stallW: STALL_W, stallD: STALL_D, aisle: AISLE_W,
      });
      if (!L) continue;
      L.x0 = x0; L.z0 = sp.z0; L.rows = sp.rows;
      out.push(L);
    }
    if (!out.length) return NO_BLOCKS;
    _parkBlocks = out;
    return _parkBlocks;
  }
  // the block every legacy consumer means when it says "the car park"
  function parkLayout() { const b = parkBlocks(); return b.length ? b[0] : null; }

  // ---- deterministic LCG (no Math.random per owner rule) -------------------
  // seeded from CBZ.WORLD_SEED via the named-stream registry (core/seed.js)
  // — one world-seed knob instead of a per-file magic literal. rng() is
  // re-armed at build entry so a rebuild replays the identical stream.
  let rng = null;
  function armRng() { rng = CBZ.seedStream ? CBZ.seedStream('speedway') : (function () { let s = 990217; return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; })(); }
  armRng();

  // ======================================================================= //
  //  THE RACING LINE — ONE DEFINITION. NOTHING ELSE.                        //
  //                                                                          //
  //  This file used to carry TWO parametric frames ("kept identical", by     //
  //  comment only): the builder's `ovalFrame` and the race engine's          //
  //  `CBZ_FRAME`. They had drifted — CBZ_FRAME's normal pointed INWARD while //
  //  ovalFrame's pointed outward — and because both were plain function      //
  //  declarations in the SAME IIFE scope, hoisting silently made the second  //
  //  one win everywhere. The whole park was therefore authored against an    //
  //  inward normal (grandstands in the infield, the SAFER wall on the wrong  //
  //  side of the track). There is now exactly one function, `trackFrame`,    //
  //  and both old names are gone.                                            //
  //                                                                          //
  //  HOW THE SHAPE IS DEFINED: not as an ellipse but as a CURVATURE          //
  //  DIAGRAM, the way circuits are actually designed. κ(s) is 0 down the     //
  //  back straight, a small constant through the tri-oval front stretch, a   //
  //  larger constant through each turn, and joined by smootherstep TRANSITION//
  //  SPIRALS so curvature is C² everywhere. Integrating κ gives heading;     //
  //  integrating heading gives the centreline. κ ≥ 0 everywhere ⇒ the curve  //
  //  is convex, which is what makes the nearest-point search below (and      //
  //  racedrivers.js's) single-valued. A closed curve needs exactly           //
  //  ∮κ ds = 2π and κ even about s=0 — both are enforced below, so the line  //
  //  closes to floating-point dust.                                          //
  //                                                                          //
  //  FRAME CONTRACT (additive-only; racedrivers.js reads the first seven):   //
  //    x, z         centreline point                                         //
  //    tx, tz       unit tangent (direction of travel)                       //
  //    nx, nz       unit OUTWARD normal (right of travel; the wall side)     //
  //    heading      atan2(tx, tz) — the car yaw that drives this point       //
  //    -- new, additive --                                                   //
  //    t            the parameter itself                                     //
  //    s            arc length from the start/finish line (m)                //
  //    y            surface height ON the centreline (m)                     //
  //    bank         bank angle (rad, + = outside edge higher)                //
  //    curv         curvature (1/m)                                          //
  //    halfW        half racing-surface width (m)                            //
  //    upx,upy,upz  unit surface normal of the banked plane                  //
  //  Surface height anywhere across the track: heightAtTU(t, u) — u is       //
  //  metres from the centreline along +n (outward).                          //
  // ======================================================================= //

  // ---- cross-section (metres) ----
  const TRACK_W = 22;                 // FROZEN: race code passes TRACK_W/2 as trackHalf
  const HALFW = TRACK_W / 2;
  const APRON_W = 9;                  // flat inside apron at the foot of the banking
  const APRON_BLEND = 3.5;            // apron → infield grade
  const SHOULDER_W = 1.6;             // outside verge between asphalt and wall
  const SKIRT_W = 15;                 // graded embankment from the wall down to grade
  const TRACK_Y0 = 0.12;              // INSIDE edge of the racing surface (the pivot)
  const APRON_Y = 0.10;
  const CROWN = 0.09;                 // crest of the crowned road surface
  const BANK_TURN = 14 * Math.PI / 180;
  const BANK_MIN = 3.5 * Math.PI / 180;
  const WALL_H = 1.05;                // SAFER barrier height above the surface
  const FENCE_H = 5.8;                // catch fence above the wall

  // ---- footprint targets (the site superellipse must contain these) ----
  const TRACK_HX = 156;               // centreline half-extent in X
  const TRACK_DZ = 12;                // centreline bbox centre, offset in Z from CZ
  const SF_T = 0.0;                   // start/finish = the tri-oval front-stretch apex

  // ---- pit complex cross-section (module scope: the builder AND the
  //      CBZ.speedwayPlaces export both read these — one copy, no drift) ----
  const PIT_WALL_U0 = -26.0;
  const PIT_LANE_OUT0 = -26.7, PIT_LANE_IN0 = -36.5;
  const GARAGE_FRONT0 = -38.5, GARAGE_DEPTH0 = 15;

  // ---- the curvature diagram (lap fractions, measured from the S/F line) ----
  const CV_A1 = 0.105;                // end of the constant tri-oval bulge
  const CV_SP = 0.043;                // TRANSITION SPIRAL length at each turn end
  const CV_A2 = CV_A1 + CV_SP;        // start of the constant-radius turn
  const CV_FRONT = 0.18;              // front-stretch curvature, relative to a turn
  let CV_A3 = 0.38;                   // end of the turn — SOLVED, never guessed (below)
  function smoother(e0, e1, x) {
    let u = (x - e0) / (e1 - e0);
    u = u < 0 ? 0 : (u > 1 ? 1 : u);
    return u * u * u * (u * (u * 6 - 15) + 10);   // C² smootherstep = the spiral
  }
  // κ(t)/κmax, even about t=0 (so the two turns mirror and the venue has one
  // axis of symmetry — a tri-oval, not an ellipse).
  function kShape(t) {
    let u = t - Math.floor(t);
    if (u > 0.5) u = 1 - u;
    const a4 = CV_A3 + CV_SP;
    if (u <= CV_A1) return CV_FRONT;
    if (u < CV_A2) return CV_FRONT + (1 - CV_FRONT) * smoother(CV_A1, CV_A2, u);
    if (u <= CV_A3) return 1;
    if (u < a4) return 1 - smoother(CV_A3, a4, u);
    return 0;
  }
  // THE CLOSURE CONDITION, and why the turn length is solved rather than typed.
  // ∮κ ds = 2π only guarantees the HEADING wraps once. For the loop to meet
  // itself, the X displacement over half a lap must also vanish — physically,
  // the front stretch and the back straight have to cancel. Guessing the turn
  // length left an ~80 m gap, and "fixing" that with a drift correction would
  // have sheared the whole track so the stored heading no longer matched the
  // real tangent (which is exactly what the AI's curvature braking reads).
  // So: bisect the turn length until half-lap ΔX is zero. Closes to ~1e-14.
  function shapeHalfDx(n) {
    let mean = 0;
    for (let i = 0; i < n; i++) mean += kShape((i + 0.5) / n);
    mean /= n;
    const ks = (Math.PI * 2) / mean, du = 1 / n;
    let phi = Math.PI, X = 0;
    const half = n >> 1;
    for (let i = 0; i < half; i++) {
      const km = ks * kShape((i + 0.5) / n);
      X += Math.cos(phi - km * du * 0.5) * du;
      phi -= km * du;
    }
    return X;
  }
  function solveShape() {
    let lo = CV_A2 + 0.02, hi = 0.5 - CV_SP - 0.001;
    for (let i = 0; i < 58; i++) {
      CV_A3 = (lo + hi) / 2;
      if (shapeHalfDx(2048) > 0) lo = CV_A3; else hi = CV_A3;
    }
    CV_A3 = (lo + hi) / 2;
  }

  const NS = 1024;                    // centreline samples (~0.73 m apart)
  const NA = 1024;                    // polar-angle → parameter lookup resolution
  let TBL = null;
  function ensureTable() {
    if (TBL) return TBL;
    solveShape();                                  // closes the loop exactly
    const ux = new Float64Array(NS + 1), uz = new Float64Array(NS + 1),
      up = new Float64Array(NS + 1), uk = new Float64Array(NS + 1);
    // 1. normalise the shape so the heading sweeps exactly 2π over one lap
    let mean = 0;
    for (let i = 0; i < NS; i++) mean += kShape((i + 0.5) / NS);
    mean /= NS;
    const kScale = (Math.PI * 2) / mean;          // dφ/du on a unit-perimeter lap
    // 2. integrate (midpoint). φ is the tangent angle in the XZ plane; it
    //    DECREASES because a positive curvature here turns left (real ovals
    //    turn left), which also fixes the outward normal as (-tz, tx).
    let phi = Math.PI, X = 0, Z = 0;               // t=0 heads -X at the front apex
    const du = 1 / NS;
    ux[0] = 0; uz[0] = 0; up[0] = phi; uk[0] = kScale * kShape(0);
    for (let i = 0; i < NS; i++) {
      const km = kScale * kShape((i + 0.5) / NS);
      const pm = phi - km * du * 0.5;
      X += Math.cos(pm) * du; Z += Math.sin(pm) * du;
      phi -= km * du;
      ux[i + 1] = X; uz[i + 1] = Z; up[i + 1] = phi; uk[i + 1] = kScale * kShape((i + 1) / NS);
    }
    // 3. remove the (sub-micron) integration drift so the loop closes exactly
    const dxE = ux[NS], dzE = uz[NS];
    for (let i = 0; i <= NS; i++) { const w = i / NS; ux[i] -= dxE * w; uz[i] -= dzE * w; }
    // 4. uniform scale to the target footprint + centre it on the venue
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i <= NS; i++) {
      if (ux[i] < x0) x0 = ux[i]; if (ux[i] > x1) x1 = ux[i];
      if (uz[i] < z0) z0 = uz[i]; if (uz[i] > z1) z1 = uz[i];
    }
    const L = (TRACK_HX * 2) / (x1 - x0);          // lap length in metres
    const ox = -(x0 + x1) / 2, oz = -(z0 + z1) / 2;
    const xc = CX, zc = CZ + TRACK_DZ;
    const PX = new Float64Array(NS + 1), PZ = new Float64Array(NS + 1),
      PP = new Float64Array(NS + 1), PK = new Float64Array(NS + 1);
    let kMax = 0;
    for (let i = 0; i <= NS; i++) {
      PX[i] = xc + (ux[i] + ox) * L;
      PZ[i] = zc + (uz[i] + oz) * L;
      PP[i] = up[i];
      PK[i] = uk[i] / L;
      if (PK[i] > kMax) kMax = PK[i];
    }
    PX[NS] = PX[0]; PZ[NS] = PZ[0];                // exact seam
    // 5. polar-angle → t table. The curve is convex (κ ≥ 0) so the angle about
    //    the centre is strictly monotonic in t: one pass builds an O(1) index.
    const A2T = new Float32Array(NA + 1);
    const ang0 = Math.atan2(PZ[0] - zc, PX[0] - xc);
    const AG = new Float64Array(NS + 1);           // "angle swept since t=0", 0..2π
    let prev = 0;
    for (let i = 0; i <= NS; i++) {
      let d = ang0 - Math.atan2(PZ[i] - zc, PX[i] - xc);
      d = ((d % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      if (i === 0) d = 0;
      if (i === NS) d = Math.PI * 2;
      while (d < prev) d += Math.PI * 2;           // keep it monotonic across the seam
      AG[i] = d; prev = d;
    }
    let cur = 0;
    for (let j = 0; j <= NA; j++) {
      const target = (Math.PI * 2) * j / NA;
      while (cur < NS && AG[cur + 1] < target) cur++;
      const a = AG[cur], b = AG[Math.min(NS, cur + 1)];
      const f = b > a ? (target - a) / (b - a) : 0;
      A2T[j] = (cur + Math.max(0, Math.min(1, f))) / NS;
    }
    TBL = { X: PX, Z: PZ, P: PP, K: PK, A2T: A2T, ang0: ang0, L: L, kMax: kMax || 1, xc: xc, zc: zc,
      hx: (x1 - x0) / 2 * L, hz: (z1 - z0) / 2 * L };
    return TBL;
  }

  function bankAtT(t) {
    if (CBZ.CONFIG.SPEEDWAY_BANK === false) return 0;
    const T = ensureTable();
    let u = t - Math.floor(t);
    const fi = u * NS, i = fi | 0, fr = fi - i;
    const k = T.K[i] + (T.K[i + 1] - T.K[i]) * fr;
    return BANK_MIN + (BANK_TURN - BANK_MIN) * (k / T.kMax);
  }

  // Surface height at parameter t, u metres outboard of the centreline.
  // THE single source of truth for the ribbon mesh, the walls, the ground
  // provider and the car conformer — they cannot disagree.
  function heightAtTU(t, u) {
    const b = bankAtT(t), tb = Math.tan(b);
    if (u >= -HALFW) {
      if (u <= HALFW) {
        const r = u / HALFW;
        return TRACK_Y0 + (u + HALFW) * tb + CROWN * (1 - r * r);
      }
      const yEdge = TRACK_Y0 + TRACK_W * tb;
      if (u <= HALFW + SHOULDER_W) return yEdge + (u - HALFW) * tb;
      const yS = yEdge + SHOULDER_W * tb;
      const w = (u - HALFW - SHOULDER_W) / SKIRT_W;
      if (w >= 1) return 0;
      return yS * (1 - (w * w * (3 - 2 * w)));     // graded embankment down to grade
    }
    if (u >= -(HALFW + APRON_W)) {
      const w = (u + HALFW + APRON_W) / APRON_W;
      return APRON_Y + (TRACK_Y0 - APRON_Y) * w;   // flat apron at the foot of the bank
    }
    const w2 = (-u - HALFW - APRON_W) / APRON_BLEND;
    if (w2 >= 1) return 0;
    return APRON_Y * (1 - w2);
  }

  // THE frame. Returns a fresh object (existing consumers keep references to
  // frames, so this must NOT be pooled).
  function trackFrame(t) {
    const T = ensureTable();
    let u = t - Math.floor(t);
    const fi = u * NS, i = fi | 0, fr = fi - i, i2 = i + 1;
    const x = T.X[i] + (T.X[i2] - T.X[i]) * fr;
    const z = T.Z[i] + (T.Z[i2] - T.Z[i]) * fr;
    const ps = T.P[i] + (T.P[i2] - T.P[i]) * fr;   // monotonic: no wrap artefacts
    const k = T.K[i] + (T.K[i2] - T.K[i]) * fr;
    const tx = Math.cos(ps), tz = Math.sin(ps);
    const nx = -tz, nz = tx;                        // OUTWARD (right of travel)
    const bank = CBZ.CONFIG.SPEEDWAY_BANK === false ? 0
      : BANK_MIN + (BANK_TURN - BANK_MIN) * (k / T.kMax);
    const sb = Math.sin(bank), cb = Math.cos(bank);
    return {
      x: x, z: z, tx: tx, tz: tz, nx: nx, nz: nz, heading: Math.atan2(tx, tz),
      t: u, s: u * T.L, curv: k, bank: bank, halfW: HALFW,
      y: TRACK_Y0 + HALFW * Math.tan(bank) + CROWN,
      upx: -nx * sb, upy: cb, upz: -nz * sb,
    };
  }
  CBZ.speedwayFrame = trackFrame;

  // ---- fast nearest-point parameter (O(1) angle index + Newton projection) --
  const _sc = { x: 0, z: 0, tx: 0, tz: 0, nx: 0, nz: 0 };
  function frameLite(t) {
    const T = ensureTable();
    let u = t - Math.floor(t);
    const fi = u * NS, i = fi | 0, fr = fi - i, i2 = i + 1;
    _sc.x = T.X[i] + (T.X[i2] - T.X[i]) * fr;
    _sc.z = T.Z[i] + (T.Z[i2] - T.Z[i]) * fr;
    const ps = T.P[i] + (T.P[i2] - T.P[i]) * fr;
    _sc.tx = Math.cos(ps); _sc.tz = Math.sin(ps);
    _sc.nx = -_sc.tz; _sc.nz = _sc.tx;
    return _sc;
  }
  function paramAtFast(x, z) {
    const T = ensureTable();
    let d = T.ang0 - Math.atan2(z - T.zc, x - T.xc);
    d = ((d % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const fj = d / (Math.PI * 2) * NA, j = fj | 0, fr = fj - j;
    let t = T.A2T[j] + (T.A2T[Math.min(NA, j + 1)] - T.A2T[j]) * fr;
    // project onto the curve: slide along the tangent until the offset is normal
    for (let it = 0; it < 4; it++) {
      const f = frameLite(t);
      const along = (x - f.x) * f.tx + (z - f.z) * f.tz;
      t += along / T.L;
      t -= Math.floor(t);
      if (Math.abs(along) < 0.02) break;
    }
    return t - Math.floor(t);
  }

  // Across-track offset of a world point (+ = outboard). Cheap: one param solve.
  function offsetAt(x, z, t) {
    const f = frameLite(t == null ? paramAtFast(x, z) : t);
    return (x - f.x) * f.nx + (z - f.z) * f.nz;
  }

  // The published ground oracle for the banked surface. Registered with
  // CBZ.registerCityGroundHeight at build time so floorAt() walks the banking.
  const SURF_R2 = (TRACK_HX + HALFW + SHOULDER_W + SKIRT_W + 8);
  function speedwaySurfaceY(x, z) {
    if (!TBL) return 0;
    const dx = x - TBL.xc, dz = z - TBL.zc;
    if (dx * dx + dz * dz > SURF_R2 * SURF_R2) return 0;
    const t = paramAtFast(x, z);
    const u = offsetAt(x, z, t);
    if (u < -(HALFW + APRON_W + APRON_BLEND) || u > HALFW + SHOULDER_W + SKIRT_W) return 0;
    return heightAtTU(t, u);
  }
  CBZ.speedwaySurfaceY = speedwaySurfaceY;
  CBZ.speedwayTrackLen = function () { return ensureTable().L; };

  // ---- an orientation basis that SITS ON the banked surface ----------------
  // Local axes: +Z along the tangent (the car/prop forward convention), +Y the
  // surface normal, +X = Y×Z. Everything placed on the track (kerb blocks,
  // paint ticks, wall segments) uses this so nothing floats or intersects.
  const _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3(),
    _bs = new THREE.Vector3(), _bm = new THREE.Matrix4();
  function surfMatrix(t, u, dy, sx, sy, sz, out) {
    const f = trackFrame(t);
    const sb = Math.sin(f.bank), cb = Math.cos(f.bank);
    _bz.set(f.tx, 0, f.tz);
    _by.set(-f.nx * sb, cb, -f.nz * sb);
    _bx.crossVectors(_by, _bz);
    const y = heightAtTU(t, u) + (dy || 0);
    const m = out || _bm;
    m.makeBasis(_bx, _by, _bz);
    m.scale(_bs.set(sx, sy, sz));
    m.setPosition(f.x + f.nx * u, y, f.z + f.nz * u);
    return m;
  }

  // ---- strip(): sweep a ribbon along the racing line ----------------------
  // The workhorse behind every surface in the park — the asphalt, the apron,
  // the embankment, the walls, the pit road, the grandstand rakes, the roofs,
  // the hoardings. ONE BufferGeometry, one draw call, always following the
  // curve. `prof` is an ordered list of cross-section rows:
  //     { u, dy, abs, uv }   u may be a number OR fn(w) for a tapering run
  //   u   across-track offset (m, + = outboard)
  //   dy  height offset above the track surface at that u, or (abs:true) the
  //       ABSOLUTE world height
  //   uv  texture U for this row (defaults to the row index fraction)
  // Row order matters: inner→outer (or bottom→top) produces outward/upward
  // facing triangles.
  // o.swapUV: put the ALONG-track coordinate on the texture's U axis instead
  // of V. Ground surfaces want across=U (lane paint runs along the track);
  // vertical bands — the SAFER wall, the pit wall, hoardings, roof fascias —
  // want along=U, because a sponsor board reads horizontally. Without this a
  // sponsor band renders rotated 90 degrees and tiles down the wall's height.
  // o.uFlip: MIRROR the along-track texture axis. A swept vertical band is read
  // from exactly ONE of its two faces, and on the face whose normal looks along
  // -n the track tangent runs to the reader's LEFT — so artwork laid on in +t
  // order comes out backwards. This is the second half of the upside-down
  // sponsor fault; the derivation and the ONE caller that needs it live in
  // speedway_structures.js `board()`. Nothing else should ever set it.
  let _root = null;
  function strip(prof, o) {
    o = o || {};
    const T = ensureTable();
    const t0 = o.t0 == null ? 0 : o.t0, t1 = o.t1 == null ? 1 : o.t1;
    const closed = !!o.closed;
    const arc = Math.abs(t1 - t0) * T.L;
    const seg = Math.max(4, o.seg || Math.round(arc / (o.step || 2.5)));
    const rows = closed ? seg : seg + 1;
    const n = prof.length;
    const pos = new Float32Array(rows * n * 3);
    const uvs = new Float32Array(rows * n * 2);
    const vTiles = o.vLen ? Math.max(1, Math.round(arc / o.vLen)) : 1;
    for (let i = 0; i < rows; i++) {
      const w = i / seg;
      const t = t0 + (t1 - t0) * w;
      const f = trackFrame(t);
      for (let j = 0; j < n; j++) {
        const e = prof[j];
        const u = typeof e.u === "function" ? e.u(w) : e.u;
        const y = e.abs ? (e.dy || 0) : heightAtTU(t, u) + (e.dy || 0);
        const p = (i * n + j) * 3;
        pos[p] = f.x + f.nx * u; pos[p + 1] = y; pos[p + 2] = f.z + f.nz * u;
        const q = (i * n + j) * 2;
        const uvRow = e.uv == null ? (n > 1 ? j / (n - 1) : 0) : e.uv;
        const along = (o.uFlip ? (1 - w) : w) * vTiles;
        if (o.swapUV) { uvs[q] = along; uvs[q + 1] = uvRow; }
        else { uvs[q] = uvRow; uvs[q + 1] = along; }
      }
    }
    const idx = [];
    for (let i = 0; i < seg; i++) {
      const i2 = closed ? ((i + 1) % rows) : (i + 1);
      for (let j = 0; j < n - 1; j++) {
        const a = i * n + j, b = a + 1, c = i2 * n + j, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    let m = o.mat;
    if (o.doubleSide && m && m.side !== THREE.DoubleSide) {
      m = m._shared ? m.clone() : m;
      m.side = THREE.DoubleSide;
    }
    const mesh = new THREE.Mesh(geo, m);
    mesh.receiveShadow = o.receive !== false;
    mesh.castShadow = !!o.cast;
    mesh.name = o.name || "speedway-strip";
    mesh.userData.speedway = true;          // keep it out of the inert merge pass
    (o.parent || _root).add(mesh);
    return mesh;
  }

  // ---- collider helpers ---------------------------------------------------
  // AABBs cannot represent banking, so a banked wall is approximated by a
  // stepped chain of short boxes along it, each spanning the full height from
  // grade (y0=0) to the wall top: the earth under the banking is solid, and
  // vehicles.js calls CBZ.collide() WITHOUT a height gate anyway.
  function solidBox(minX, maxX, minZ, maxZ, y0, y1) {
    CBZ.colliders.push({ minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ, y0: y0 || 0, y1: y1 });
  }
  function solidAt(cx, cz, w, d, h) {
    solidBox(cx - w / 2, cx + w / 2, cz - d / 2, cz + d / 2, 0, h);
  }
  // chain of AABBs following the racing line at across-track offset u
  function solidChain(t0, t1, u, thick, y0, yTop, step, skip) {
    const T = ensureTable();
    const arc = Math.abs(t1 - t0) * T.L;
    const n = Math.max(2, Math.round(arc / (step || 3.0)));
    const half = arc / n * 0.62;
    for (let i = 0; i < n; i++) {
      const t = t0 + (t1 - t0) * (i + 0.5) / n;
      if (skip && skip(t)) continue;
      const f = trackFrame(t);
      const x = f.x + f.nx * u, z = f.z + f.nz * u;
      const ex = Math.abs(f.tx) * half + Math.abs(f.nx) * thick / 2;
      const ez = Math.abs(f.tz) * half + Math.abs(f.nz) * thick / 2;
      const top = yTop == null ? (heightAtTU(t, u) + WALL_H) : (typeof yTop === "function" ? yTop(t) : yTop);
      solidBox(x - ex, x + ex, z - ez, z + ez, y0 || 0, top);
    }
  }

  // ====================================================================== //
  //  LANDMASS BUILDER                                                       //
  // ====================================================================== //
  CBZ.addLandmass(function (city) {
    const root = city.root;
    if (!root) return;
    armRng();
    _root = root;
    const T = ensureTable();
    const L = T.L;
    const SU = CBZ.CONFIG.SPEEDWAY_STRUCTURES !== false ? CBZ.speedwayStructures : null;

    // ---- shared palette ----
    const C = {
      GRASS: 0x668852, INFIELD: 0x5f814b, ASPHALT: 0x2b2d31, APRON: 0x3a3d42,
      CONCRETE: 0xb7bcc2, LINE: 0xeef2f6, PIT: 0x35383d, SAFER: 0xdadfe4,
      STEEL: 0x8a9099, STAND: 0x6c7480, SEAT: 0x37506e, RED: 0xc23a36,
      GREEN: 0x3ba24a, DECK: 0x6a6d72, CURB: 0xcfd3d8,
    };
    const C_DECK = C.DECK, C_CURB = C.CURB, C_STEEL = C.STEEL;

    // ---- layout, in (t, u) — everything below derives from the ONE frame --
    const WALL_U = HALFW + SHOULDER_W;               // SAFER barrier centreline
    const SKIRT_END = HALFW + SHOULDER_W + SKIRT_W;  // toe of the embankment
    const APRON_EDGE = -(HALFW + APRON_W);           // inside edge of the apron
    const PIT_T = 78 / L;                            // pit lane half-length (laps)
    const PIT_WALL_U = PIT_WALL_U0;
    const PIT_LANE_OUT = PIT_LANE_OUT0, PIT_LANE_IN = PIT_LANE_IN0;
    const GARAGE_FRONT = GARAGE_FRONT0, GARAGE_DEPTH = GARAGE_DEPTH0;
    const GATE_T = 0.5, GATE_HALF = 6.5 / L;         // service gate in the outer wall
    const TURN1 = [0.12, 0.42], TURN2 = [0.58, 0.88];

    // THE CONTRACT HANDED TO speedway_structures.js. Declared HERE, above the
    // barriers, because the SAFER wall and the inner retaining walls are
    // sponsor BOARDS and now go through the same `SU.board` solve the fascias
    // and hoardings do — they were the first two runs to be built and the last
    // two anyone would have thought to look at.
    const S = {
      root: root, frame: trackFrame, heightAt: heightAtTU, bankAt: bankAtT,
      strip: strip, solid: solidAt, solidBox: solidBox, solidChain: solidChain,
      L: L, CX: CX, CZ: CZ, HALFW: HALFW, APRON_W: APRON_W, TRACK_W: TRACK_W,
      SHOULDER_W: SHOULDER_W, SKIRT_W: SKIRT_W, WALL_H: WALL_H, C: C,
      rng: rng, label: CBZ.makeLabelSprite ? function (s, o) { return CBZ.makeLabelSprite(s, o); } : null,
    };
    // one line back to the pre-fix bands if the geometry ever needs comparing
    const BOARDS = (CBZ.CONFIG.SPEEDWAY_BOARDS_V2 !== false && SU && SU.board) ? SU.board : null;
    // the board + prop ledgers are per-build; clear them before anything draws
    if (SU && SU.buildReset) SU.buildReset();

    function flat(geo, m, y, opts) {
      opts = opts || {};
      const mesh = new THREE.Mesh(geo, m);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(opts.x || 0, y, opts.z || 0);
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      root.add(mesh);
      return mesh;
    }

    function stadiumSiteGeometry() {
      const shape = new THREE.Shape();
      const N = 192, power = 2.45;
      for (let i = 0; i <= N; i++) {
        const a = i / N * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        // Rounded superellipse with only metre-scale asymmetry.  The perturbation
        // removes the CAD-perfect rim without making the drivable edge jagged.
        const organic = 1 + Math.sin(a * 3 + 0.7) * 0.012 + Math.sin(a * 7 - 0.4) * 0.006;
        const lx = Math.sign(ca) * Math.pow(Math.abs(ca), 2 / power) * SITE_HX * organic;
        const lz = SITE_DZ + Math.sign(sa) * Math.pow(Math.abs(sa), 2 / power) * SITE_HZ * organic;
        // ShapeGeometry lies in XY. flat() rotates -90deg, so local Y=-world Z.
        if (i === 0) shape.moveTo(lx, -lz); else shape.lineTo(lx, -lz);
      }
      const geo = new THREE.ShapeGeometry(shape, 12);
      // Match CircleGeometry's UV convention so the world-coordinate canvas
      // bake below stays exact.
      const p = geo.attributes.position, uv = new Float32Array(p.count * 2);
      for (let i = 0; i < p.count; i++) {
        uv[i * 2] = (p.getX(i) + R) / (R * 2);
        uv[i * 2 + 1] = (p.getY(i) + R) / (R * 2);
      }
      geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      return geo;
    }

    // ====================================================================
    //  1. THE GROUND SKIN — grass, infield, courts, car parks.
    //  The DRIVABLE track is no longer painted here: it is real, raised,
    //  banked geometry (step 2). This skin only carries the ground the
    //  circuit sits IN, so nothing is coplanar and nothing can flicker.
    // ====================================================================
    const surfaceCanvas = document.createElement("canvas");
    surfaceCanvas.width = surfaceCanvas.height = 1024;
    const sx = surfaceCanvas.getContext("2d");
    function css(c) { return "#" + (c >>> 0).toString(16).padStart(6, "0"); }
    function cvx(x) { return (x - (CX - R)) / (R * 2) * surfaceCanvas.width; }
    function cvz(z) { return (z - (CZ - R)) / (R * 2) * surfaceCanvas.height; }
    // trace a closed canvas path parallel to the racing line at offset u —
    // sampled from the SAME frame the geometry uses, so paint and mesh agree.
    function pathU(u) {
      sx.beginPath();
      for (let i = 0; i <= 240; i++) {
        const f = trackFrame(i / 240);
        const px = cvx(f.x + f.nx * u), pz = cvz(f.z + f.nz * u);
        if (i === 0) sx.moveTo(px, pz); else sx.lineTo(px, pz);
      }
      sx.closePath();
    }
    const turf = sx.createRadialGradient(512, 512, 80, 512, 512, 724);
    turf.addColorStop(0, css(C.GRASS)); turf.addColorStop(0.78, css(C.GRASS));
    turf.addColorStop(1, css(0x738260));
    sx.fillStyle = turf; sx.fillRect(0, 0, surfaceCanvas.width, surfaceCanvas.height);
    sx.globalAlpha = 0.10; sx.fillStyle = css(C.INFIELD);
    for (let y = 0; y < surfaceCanvas.height; y += 42) sx.fillRect(0, y, surfaceCanvas.width, 20);
    sx.globalAlpha = 1;
    // the graded earth footprint the embankment is cut into (mostly hidden by
    // the skirt mesh; it stops a bright green fringe from peeking through)
    pathU(SKIRT_END + 2.5); sx.fillStyle = css(0x6f6c58); sx.fill();
    // the infield, mown short and darker than the surrounding country
    pathU(APRON_EDGE - APRON_BLEND - 1.5); sx.fillStyle = css(C.INFIELD); sx.fill();
    // infield service ring — the road the recovery trucks and marshals use
    sx.strokeStyle = css(0x4a4e53); sx.lineWidth = 9;
    pathU(-58); sx.stroke();
    sx.strokeStyle = "rgba(238,242,246,.45)"; sx.lineWidth = 1.5;
    pathU(-58); sx.stroke();
    // the infield paddock court behind the garages (support paddock, scrutineer
    // bay, recovery compound) — texture-baked so no coplanar slab can fight it
    {
      const x0 = cvx(CX - 74), x1 = cvx(CX + 74), z0 = cvz(CZ - 8), z1 = cvz(CZ + 58);
      sx.fillStyle = css(0x4a4e53); sx.fillRect(x0, z0, x1 - x0, z1 - z0);
      sx.fillStyle = css(0x747a80);
      sx.fillRect(cvx(CX - 6), z0, cvx(CX + 6) - cvx(CX - 6), z1 - z0);
      sx.strokeStyle = css(C.LINE); sx.globalAlpha = 0.6; sx.lineWidth = 2;
      for (let x = CX - 66; x <= CX + 66; x += 12) {
        if (Math.abs(x - CX) < 10) continue;
        sx.beginPath(); sx.moveTo(cvx(x), z0 + 6); sx.lineTo(cvx(x), z1 - 6); sx.stroke();
      }
      sx.globalAlpha = 1;
    }
    // south side: spectator concourse, paddock apron and the public car park
    // (the old `bays` argument is gone: stall paint is no longer a stroke over
    //  a whole apron, it comes off the car park's own layout — see paintBays.)
    function court(mx0, mz0, mx1, mz1, col) {
      const a = cvx(mx0), b = cvz(mz0), c2 = cvx(mx1), d = cvz(mz1);
      sx.fillStyle = css(col); sx.fillRect(a, b, c2 - a, d - b);
    }
    court(CX - 122, CZ - 126, CX + 122, CZ - 97, 0x8b8f94);   // stand concourse
    court(CX - 124, CZ - 158, CX + 124, CZ - 126, C.APRON);   // paddock apron
    court(CX - 132, CZ - 204, CX + 132, CZ - 158, C.APRON);   // public apron + car park
    // THE CAR PARK IS AS BIG AS THE CARS IN IT. The old `bays:true` stroke
    // painted a stripe every 14 m across the whole 264 m apron — 18 stalls
    // wide enough to park a semi in — and the fill loop offered ten cars. The
    // stripes now come from the SAME layout the parked cars are placed on, so
    // the lot is exactly as large as it is used, and the apron either side of
    // it stays plain tarmac (overflow / coach standing, which is what an empty
    // race-day apron actually is).
    // EVERY BLOCK STANDS ON APRON, BY CONSTRUCTION. The lot is solved against
    // the perimeter, so a block can legitimately reach past the courts painted
    // above (the west block does, by 22 m) — and painted stalls on grass is a
    // lie about what the ground is. Each block lays its own apron first, in the
    // same colour, so the solve can move without anyone re-typing a court.
    (function parkApron() {
      const BL = CBZ.CONFIG.SPEEDWAY_SITE !== false ? parkBlocks() : [];
      for (let b = 0; b < BL.length; b++) {
        const L = BL[b];
        court(L.x0 - 4, L.z0 - 3, L.x0 + L.w + 4, L.z0 + L.d + 4, C.APRON);
      }
    })();
    (function paintBays() {
      const BL = CBZ.CONFIG.SPEEDWAY_SITE !== false ? parkBlocks() : [];
      for (let b = 0; b < BL.length; b++) {
        const L = BL[b];
        // aisle band, so the lot reads as circulation + stalls rather than paint
        sx.fillStyle = css(0x33363b);
        sx.fillRect(cvx(L.x0 - 3), cvz(L.z0 + L.stallD),
          cvx(L.x0 + L.w + 3) - cvx(L.x0 - 3),
          cvz(L.z0 + L.stallD + L.aisle) - cvz(L.z0 + L.stallD));
        sx.strokeStyle = css(C.LINE); sx.globalAlpha = 0.72; sx.lineWidth = 1.8;
        for (let i = 0; i < L.stripes.length; i++) {
          const s2 = L.stripes[i];
          sx.beginPath();
          sx.moveTo(cvx(s2.x), cvz(s2.z0)); sx.lineTo(cvx(s2.x), cvz(s2.z1));
          sx.stroke();
        }
        sx.globalAlpha = 1;
      }
    })();
    // The spine lane from the gate up to the spectator concourse. It used to
    // run at ACCESS_X, which is now the middle of the car park; it runs up the
    // lot's east edge instead, between the stalls and the showroom, which is
    // the walk a person actually makes: gate → park → concourse.
    sx.fillStyle = css(0x4a4e53);
    sx.fillRect(cvx(CX - 77.5), cvz(ACCESS_Z), cvx(CX - 72.5) - cvx(CX - 77.5),
      cvz(CZ - 124) - cvz(ACCESS_Z));

    const surfaceTex = new THREE.CanvasTexture(surfaceCanvas);
    if (THREE.sRGBEncoding != null) surfaceTex.encoding = THREE.sRGBEncoding;
    surfaceTex.magFilter = THREE.LinearFilter;
    surfaceTex.minFilter = THREE.LinearMipmapLinearFilter;
    surfaceTex.generateMipmaps = true;
    surfaceTex.anisotropy = Math.min(8, CBZ.renderer && CBZ.renderer.capabilities ? CBZ.renderer.capabilities.getMaxAnisotropy() : 1);
    const grassSurfaceMat = new THREE.MeshLambertMaterial({ color: 0xffffff, map: surfaceTex });
    const speedwaySurface = flat(stadiumSiteGeometry(), grassSurfaceMat, 0.015, { x: CX, z: CZ });
    speedwaySurface.userData.terrain = true; speedwaySurface.userData.worldSurface = true;
    speedwaySurface.userData.surfaceOwner = "speedway";
    speedwaySurface.userData.unifiedSurface = true;
    speedwaySurface.userData.nonRectSurface = true;
    speedwaySurface.name = "speedway-island-surface";

    // ====================================================================
    //  2. THE RACING SURFACE — a swept, banked, crowned asphalt ribbon.
    //  Cross-section, inside → outside: infield grade, apron blend, flat
    //  apron, RACING SURFACE (banked + crowned), outside shoulder, SAFER
    //  wall, graded embankment down to grade.
    // ====================================================================
    // --- asphalt texture: rubbered-in groove, marbles off-line, paving
    //     seams, painted track limits and a few braking skids. U runs across
    //     the track (0 = inside white line), V repeats every ~26 m.
    const asphalt = (function () {
      const N = 512, cv = document.createElement("canvas");
      cv.width = cv.height = N;
      const g = cv.getContext("2d");
      g.fillStyle = "#2b2d31"; g.fillRect(0, 0, N, N);
      // aggregate speckle (deterministic arithmetic sequence — never random)
      for (let i = 0; i < 26000; i++) {
        const x = (i * 53) % N, y = (i * 97) % N;
        const v = 38 + ((i * 31) % 26);
        g.fillStyle = "rgba(" + v + "," + (v + 1) + "," + (v + 5) + ",0.55)";
        g.fillRect(x, y, 1, 1);
      }
      // rubbered-in racing groove: the line the field actually uses, dark and
      // polished, feathered at both edges
      const groove = g.createLinearGradient(0, 0, N, 0);
      groove.addColorStop(0.00, "rgba(0,0,0,0)");
      groove.addColorStop(0.19, "rgba(0,0,0,0)");
      groove.addColorStop(0.30, "rgba(10,10,12,0.55)");
      groove.addColorStop(0.42, "rgba(10,10,12,0.55)");
      groove.addColorStop(0.55, "rgba(0,0,0,0)");
      groove.addColorStop(1.00, "rgba(0,0,0,0)");
      g.fillStyle = groove; g.fillRect(0, 0, N, N);
      // marbles: shed rubber and dust piled off the racing line, up by the wall
      const marb = g.createLinearGradient(0, 0, N, 0);
      marb.addColorStop(0.00, "rgba(0,0,0,0)");
      marb.addColorStop(0.62, "rgba(0,0,0,0)");
      marb.addColorStop(0.78, "rgba(120,108,92,0.20)");
      marb.addColorStop(0.97, "rgba(132,118,98,0.30)");
      marb.addColorStop(1.00, "rgba(0,0,0,0)");
      g.fillStyle = marb; g.fillRect(0, 0, N, N);
      for (let i = 0; i < 5200; i++) {
        const x = 0.62 * N + ((i * 71) % Math.round(0.35 * N));
        const y = (i * 149) % N;
        const v = 120 + ((i * 23) % 40);
        g.fillStyle = "rgba(" + v + "," + (v - 12) + "," + (v - 30) + ",0.35)";
        g.fillRect(x, y, 2, 1);
      }
      // paving seams every quarter tile (~6.5 m of real track)
      g.strokeStyle = "rgba(18,19,22,0.55)"; g.lineWidth = 2;
      for (let y = 0; y < N; y += N / 4) { g.beginPath(); g.moveTo(0, y); g.lineTo(N, y); g.stroke(); }
      // braking / traction skids in the groove
      g.strokeStyle = "rgba(12,12,14,0.5)"; g.lineWidth = 5;
      for (let i = 0; i < 9; i++) {
        const x = 0.22 * N + ((i * 37) % Math.round(0.34 * N));
        const y = (i * 113) % N;
        g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 9, y + 34, x + 3, y + 74); g.stroke();
      }
      // painted track limits
      g.fillStyle = "#e9eef4";
      g.fillRect(0, 0, 11, N); g.fillRect(N - 11, 0, 11, N);
      const t = new THREE.CanvasTexture(cv);
      if (THREE.sRGBEncoding != null) t.encoding = THREE.sRGBEncoding;
      t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping;
      t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
      t.anisotropy = Math.min(8, CBZ.renderer && CBZ.renderer.capabilities ? CBZ.renderer.capabilities.getMaxAnisotropy() : 1);
      return t;
    })();

    // --- the ribbon itself (9 rows across so the crown and bank read) ---
    {
      const prof = [];
      const NU = 9;
      for (let j = 0; j < NU; j++) {
        const u = -HALFW + TRACK_W * j / (NU - 1);
        prof.push({ u: u, dy: 0, uv: (u + HALFW) / TRACK_W });
      }
      strip(prof, {
        closed: true, step: 2.2, vLen: 26, name: "speedway-racing-surface",
        mat: new THREE.MeshLambertMaterial({ color: 0xffffff, map: asphalt }),
      });
    }
    // --- apron (flat, at the foot of the banking) ---
    strip([
      { u: APRON_EDGE, dy: 0, uv: 0 },
      { u: APRON_EDGE + APRON_W * 0.5, dy: 0, uv: 0.5 },
      { u: -HALFW, dy: 0, uv: 1 },
    ], { closed: true, step: 3.0, vLen: 20, name: "speedway-apron", mat: mat(C.APRON) });
    // --- apron → infield grade, and the outside embankment ---
    strip([
      { u: APRON_EDGE - APRON_BLEND, dy: 0 }, { u: APRON_EDGE, dy: 0 },
    ], { closed: true, step: 4.0, name: "speedway-infield-verge", mat: mat(0x62804d) });
    strip([
      { u: HALFW, dy: 0, uv: 0 }, { u: WALL_U, dy: 0, uv: 1 },
    ], { closed: true, step: 2.6, name: "speedway-shoulder", mat: mat(0x9aa1a8) });
    strip([
      { u: WALL_U, dy: 0 },
      { u: WALL_U + SKIRT_W * 0.4, dy: 0 },
      { u: WALL_U + SKIRT_W * 0.75, dy: 0 },
      { u: SKIRT_END, dy: 0 },
    ], { closed: true, step: 4.0, name: "speedway-embankment", mat: mat(0x5f7349) });

    // --- KERBS: real red/white rumble blocks at the inside edge, through the
    //     turns only (where cars actually use them), fading out on the
    //     straights exactly like a real circuit. Two instanced draws. ---
    {
      const step = 2.1, n = Math.round(L / step);
      const kg = new THREE.BoxGeometry(1, 1, 1); kg._shared = true;
      const red = new THREE.InstancedMesh(kg, mat(C.RED), n);
      const wht = new THREE.InstancedMesh(kg, mat(0xe9eef4), n);
      red.count = 0; wht.count = 0;
      red.castShadow = wht.castShadow = false;
      red.receiveShadow = wht.receiveShadow = true;
      const M = new THREE.Matrix4();
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const kr = trackFrame(t).curv / T.kMax;
        if (kr < 0.55) continue;
        // taper the kerb height in and out so it never appears as a step
        const hgt = 0.16 * Math.min(1, (kr - 0.55) / 0.25);
        surfMatrix(t, -HALFW - 0.52, hgt / 2 - 0.02, 0.95, hgt, step * 0.92, M);
        const im = (i & 1) ? red : wht;
        if (im.count < n) im.setMatrixAt(im.count++, M);
      }
      for (const im of [red, wht]) {
        if (!im.count) continue;
        im.instanceMatrix.needsUpdate = true;
        im.userData.speedway = true;
        root.add(im);
      }
    }

    // ====================================================================
    //  3. PAINT — start/finish, the starting grid, pit blend lines.
    //  Every marking is swept or basis-oriented onto the BANKED surface,
    //  so nothing floats over the camber.
    // ====================================================================
    const sf = trackFrame(SF_T);
    city._sfLine = sf;
    {
      // start/finish stripe (swept, so it follows the crown across 22 m)
      const w = 1.7 / L;
      strip([{ u: -HALFW, dy: 0.02, uv: 0 }, { u: HALFW, dy: 0.02, uv: 1 }], {
        t0: SF_T - w, t1: SF_T + w, closed: false, seg: 3, name: "speedway-sf-line",
        mat: mat(C.LINE),
      });
      // the checkered timing-beam bars either side of it
      for (const off of [-2.6, 2.6]) {
        const t = SF_T + off / L, w2 = 0.5 / L;
        strip([{ u: -HALFW, dy: 0.02 }, { u: HALFW, dy: 0.02 }], {
          t0: t - w2, t1: t + w2, closed: false, seg: 2, name: "speedway-sf-bar",
          mat: mat(0x14181d),
        });
      }
      // PAINTED STARTING GRID — the staggered slots the field lines up in.
      // gridSlot() below returns the SAME geometry, so a car on the grid sits
      // exactly inside its painted box.
      const slotGeo = new THREE.BoxGeometry(1, 1, 1); slotGeo._shared = true;
      const slotIM = new THREE.InstancedMesh(slotGeo, mat(C.LINE), 64);
      slotIM.count = 0; slotIM.castShadow = false;
      const M = new THREE.Matrix4();
      const ROWS = 5, COLW = 2.6, ROWGAP = 6.0;
      for (let row = 0; row < ROWS; row++) {
        for (const lane of [-1, 1]) {
          const back = -(row * ROWGAP + (lane > 0 ? 0 : ROWGAP * 0.5) + 3.0);
          const t = SF_T + back / L;
          const u0 = lane * COLW;
          for (const e of [-1.4, 1.4]) {          // the two side ticks
            surfMatrix(t, u0 + e, 0.025, 0.18, 0.03, 2.0, M);
            if (slotIM.count < 64) slotIM.setMatrixAt(slotIM.count++, M);
          }
          surfMatrix(t - 1.05 / L, u0, 0.025, 2.9, 0.03, 0.18, M);   // the front line
          if (slotIM.count < 64) slotIM.setMatrixAt(slotIM.count++, M);
        }
      }
      slotIM.instanceMatrix.needsUpdate = true;
      slotIM.userData.speedway = true;
      root.add(slotIM);
    }
    // pit-in / pit-out blend lines: solid paint tapering off the racing surface
    // down to the pit wall, exactly the way a real pit entry is marked.
    {
      const blend = 46 / L;
      function lerpU(a, b) { return function (w) { return a + (b - a) * w; }; }
      // pit ENTRY (approaching the line, on the lap before): track → pit lane
      strip([
        { u: lerpU(-HALFW, PIT_LANE_OUT - 1.0), dy: 0.02 },
        { u: lerpU(-HALFW + 0.35, PIT_LANE_OUT - 0.65), dy: 0.02 },
      ], { t0: -PIT_T - blend, t1: -PIT_T, closed: false, step: 3.0, mat: mat(0xf0c419), name: "pit-in-blend" });
      // pit EXIT: pit lane → track
      strip([
        { u: lerpU(PIT_LANE_OUT - 1.0, -HALFW), dy: 0.02 },
        { u: lerpU(PIT_LANE_OUT - 0.65, -HALFW + 0.35), dy: 0.02 },
      ], { t0: PIT_T, t1: PIT_T + blend, closed: false, step: 3.0, mat: mat(0xf0c419), name: "pit-out-blend" });
      // the apron aprons themselves (paved run-off between apron and pit lane)
      strip([
        { u: PIT_LANE_OUT, dy: 0.09, abs: true }, { u: APRON_EDGE - APRON_BLEND, dy: 0.02, abs: true },
      ], { t0: -PIT_T - blend, t1: PIT_T + blend, closed: false, step: 4.0, mat: mat(0x54585e), name: "pit-verge" });
    }

    // ====================================================================
    //  4. BARRIERS — SAFER wall + catch fencing outside, retaining walls
    //  through the turns inside, and the pit wall along the front stretch.
    //
    //  ACCESS: the wall is a CONTINUOUS collider (the old one wasn't — its
    //  80 colliders were 1.2 m boxes 11.8 m apart, so cars drove straight
    //  through a wall that looked solid). A closed ring would make the
    //  circuit unreachable and the race unjoinable, so it has exactly two
    //  real openings, in the two places a real venue puts them:
    //    • the PADDOCK CROSSOVER just past the main grandstand, where the
    //      bank is shallowest and the embankment is a driveable ramp —
    //      the concourse plaza leads straight to it and it lands you on
    //      the apron by the pit exit;
    //    • the MARSHAL / RECOVERY GATE at the centre of the back straight.
    // ====================================================================
    const sponsorTex = SU && SU.tex ? SU.tex.sponsorBand(0, 96) : null;
    const GATES = [
      { t: 0.112, half: 7.5 / L },     // paddock crossover (front stretch, 5.4° bank)
      { t: GATE_T, half: GATE_HALF },  // marshal gate (back straight, 3.5° bank)
    ];
    // the wall arcs BETWEEN the gates — everything outboard sweeps these
    const ARCS = [];
    for (let i = 0; i < GATES.length; i++) {
      const a = GATES[i], b = GATES[(i + 1) % GATES.length];
      let t0 = a.t + a.half, t1 = b.t - b.half;
      while (t1 <= t0) t1 += 1;
      ARCS.push([t0, t1]);
    }
    function inGate(t) {
      for (const gt of GATES) {
        const d = Math.abs(((t - gt.t) % 1 + 1.5) % 1 - 0.5);
        if (d < gt.half) return true;
      }
      return false;
    }
    {
      // Outer SAFER barrier: a swept box section (track face → top cap → back
      // face) carrying a sponsor band, in ONE draw call, plus a stepped chain
      // of AABB colliders (an AABB cannot be banked, so the wall is
      // approximated by short boxes rising from grade to the wall top).
      const wallProf = [
        { u: WALL_U - 0.45, dy: 0, uv: 0 },
        { u: WALL_U - 0.45, dy: WALL_H, uv: 1 },
        { u: WALL_U + 0.45, dy: WALL_H, uv: 1 },
        { u: WALL_U + 0.45, dy: 0, uv: 0 },
      ];
      const wallMat = sponsorTex
        ? new THREE.MeshLambertMaterial({ color: 0xffffff, map: sponsorTex })
        : mat(C.SAFER);
      // one swept run per arc, so each gate is a REAL hole in the wall.
      // The band on it read RIGHT-TO-LEFT for the wall's whole life — a swept
      // vertical strip lays its texture along +t, and on the face that looks
      // back at the track +t runs to the reader's LEFT. Both of this wall's
      // faces have an audience (the drivers on one side, the grandstands on
      // the other), so both are printed and each gets its own U direction.
      for (const arc of ARCS) {
        if (BOARDS) {
          BOARDS(S, {
            t0: arc[0], t1: arc[1], u: WALL_U - 0.45, y0: 0, h: WALL_H, abs: false,
            face: -1, thick: 0.9, back: "read", capColor: C.SAFER,
            salt: 0, vLen: 12, step: 2.4, name: "speedway-safer-wall",
          });
        } else {
          strip(wallProf, { t0: arc[0], t1: arc[1], closed: false, step: 2.4, vLen: 12, swapUV: true, mat: wallMat, name: "speedway-safer-wall" });
        }
        solidChain(arc[0], arc[1], WALL_U, 1.1, 0, null, 3.0);
      }
      // hinged gate leaves parked open against the posts, both sides of each gap
      for (const gt of GATES) {
        for (const s of [-1, 1]) {
          const t = gt.t + s * gt.half;
          const f = trackFrame(t);
          const px = f.x + f.nx * WALL_U, pz = f.z + f.nz * WALL_U;
          const py = heightAtTU(t, WALL_U);
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2.6, 0.8), mat(0xf0c419));
          post.position.set(px, py + 1.3, pz); post.rotation.y = f.heading;
          post.userData.speedway = true;
          root.add(post);
          const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.5, 4.2), mat(0xd8dde3));
          leaf.position.set(px + f.nx * 2.2 - f.tx * s * 1.8, py + 0.9, pz + f.nz * 2.2 - f.tz * s * 1.8);
          leaf.rotation.y = f.heading + Math.PI / 2.6;
          leaf.userData.speedway = true;
          root.add(leaf);
          solidAt(px, pz, 1.1, 1.1, py + 2.6);
        }
      }

      // CATCH FENCING — posts, three cable runs and debris mesh above the
      // wall. Alpha-tested (not blended), so there is no sorting cost.
      if (CBZ.CONFIG.SPEEDWAY_CATCH_FENCE !== false) {
        const chain = SU && SU.tex ? SU.tex.chainLink() : null;
        if (chain) {
          const m = new THREE.MeshLambertMaterial({
            color: 0xb6bec6, map: chain, transparent: false, alphaTest: 0.42,
            side: THREE.DoubleSide,
          });
          for (const arc of ARCS) {
            const fence = strip([
              { u: WALL_U, dy: WALL_H - 0.1, uv: 0 },
              { u: WALL_U - 0.55, dy: WALL_H + FENCE_H, uv: 1 },
            ], {
              t0: arc[0], t1: arc[1], closed: false,
              step: 2.4, mat: m, name: "speedway-catch-fence", receive: false,
            });
            // tile the mesh: ~2.4 m per cell up the fence, ~2.6 m along it
            const uv = fence.geometry.attributes.uv;
            const tiles = Math.max(1, Math.round((arc[1] - arc[0]) * L / 2.6));
            for (let i = 0; i < uv.count; i++) {
              uv.setXY(i, uv.getX(i) * (FENCE_H / 2.4), uv.getY(i) * tiles);
            }
            uv.needsUpdate = true;
          }
        }
        // posts + cable runs (one instanced draw each)
        const nP = Math.round(L / 5.0);
        const pg = new THREE.BoxGeometry(1, 1, 1); pg._shared = true;
        const postIM = new THREE.InstancedMesh(pg, mat(0x767d85), nP + 4);
        postIM.count = 0; postIM.receiveShadow = false;
        const M = new THREE.Matrix4();
        for (let i = 0; i < nP; i++) {
          const t = i / nP;
          if (inGate(t)) continue;
          surfMatrix(t, WALL_U - 0.28, WALL_H + FENCE_H / 2, 0.22, FENCE_H, 0.22, M);
          if (postIM.count < nP + 4) postIM.setMatrixAt(postIM.count++, M);
        }
        if (postIM.count) { postIM.instanceMatrix.needsUpdate = true; postIM.userData.speedway = true; root.add(postIM); }
        for (const arc of ARCS) {
          for (const h of [1.9, 3.6, 5.4]) {
            strip([
              { u: WALL_U - 0.16 - h * 0.09, dy: WALL_H + h - 0.05 },
              { u: WALL_U - 0.16 - h * 0.09, dy: WALL_H + h + 0.05 },
            ], {
              t0: arc[0], t1: arc[1], closed: false,
              step: 3.2, mat: mat(0x9aa2aa), name: "speedway-fence-cable", receive: false,
            });
          }
          // the top rail the mesh hangs from, canted back over the track
          strip([
            { u: WALL_U - 0.72, dy: WALL_H + FENCE_H - 0.06 },
            { u: WALL_U - 0.38, dy: WALL_H + FENCE_H + 0.16 },
          ], {
            t0: arc[0], t1: arc[1], closed: false,
            step: 3.2, mat: mat(0x767d85), name: "speedway-fence-rail", receive: false,
          });
        }
      }

      // INNER retaining walls — turns only. The straights stay open to the
      // apron (that is how an oval works, and it is how you get to the infield).
      const innerProf = [
        { u: APRON_EDGE + 0.35, dy: 0, uv: 0 },
        { u: APRON_EDGE + 0.35, dy: 0.95, uv: 1 },
        { u: APRON_EDGE - 0.35, dy: 0.95, uv: 1 },
        { u: APRON_EDGE - 0.35, dy: 0, uv: 0 },
      ];
      const innerMat = SU && SU.tex
        ? new THREE.MeshLambertMaterial({ color: 0xffffff, map: SU.tex.sponsorBand(6, 96) })
        : mat(C.CONCRETE);
      for (const seg of [TURN1, TURN2]) {
        if (BOARDS) {
          // this one is read from OUTBOARD: the track sits at u = 0, the wall
          // at u = -20, so the reader is on the larger-u side. board() would
          // derive exactly that from -sign(u); it is stated for the record.
          BOARDS(S, {
            t0: seg[0], t1: seg[1], u: APRON_EDGE + 0.35, y0: 0, h: 0.95, abs: false,
            face: 1, thick: 0.7, back: "read", capColor: C.CONCRETE,
            salt: 6, vLen: 12, step: 2.6, name: "speedway-inner-wall",
          });
        } else {
          strip(innerProf, { t0: seg[0], t1: seg[1], closed: false, step: 2.6, vLen: 12, swapUV: true, mat: innerMat, name: "speedway-inner-wall" });
        }
        solidChain(seg[0], seg[1], APRON_EDGE, 0.9, 0, function (t) { return heightAtTU(t, APRON_EDGE) + 0.95; }, 3.0);
      }
    }

    // ====================================================================
    //  5. THE START/FINISH GANTRY — the single most iconic thing a circuit
    //  has, and the one this venue never had. A real trussed bridge over
    //  the racing surface with a five-column light rig (driven live by the
    //  race countdown, see the updater at the bottom of this file), a
    //  timing beam, and signage on both faces.
    // ====================================================================
    if (SU) {
      const U = SU.util;
      const grp = new THREE.Group(); grp.name = "speedway-sf-gantry"; root.add(grp);
      const steel = mat(0x39424c), acc = mat(0xc23a36);
      const uIn = APRON_EDGE - 4.5, uOut = WALL_U + 9.0;
      const fG = trackFrame(SF_T);
      function pt(u, y) {
        return [fG.x + fG.nx * u, y, fG.z + fG.nz * u];
      }
      const yIn = heightAtTU(SF_T, uIn), yOut = heightAtTU(SF_T, uOut);
      const BEAM = Math.max(yIn, yOut) + 10.5;
      const towerIM = U.makeIM(steel, 120);
      // two lattice towers
      for (const spec of [{ u: uIn, y: yIn }, { u: uOut, y: yOut }]) {
        const legs = [[-1.5, -1.5], [1.5, -1.5], [1.5, 1.5], [-1.5, 1.5]];
        for (let i = 0; i < 4; i++) {
          const ax = fG.x + fG.nx * (spec.u + legs[i][0]) + fG.tx * legs[i][1];
          const az = fG.z + fG.nz * (spec.u + legs[i][0]) + fG.tz * legs[i][1];
          U.pushStrut(towerIM, ax, spec.y, az, ax, BEAM + 1.4, az, 0.34);
          const j = (i + 1) % 4;
          const bx = fG.x + fG.nx * (spec.u + legs[j][0]) + fG.tx * legs[j][1];
          const bz = fG.z + fG.nz * (spec.u + legs[j][0]) + fG.tz * legs[j][1];
          for (let r = 0; r < 6; r++) {
            const h0 = spec.y + (BEAM + 1.4 - spec.y) * r / 6;
            const h1 = spec.y + (BEAM + 1.4 - spec.y) * (r + 1) / 6;
            U.pushStrut(towerIM, ax, h0, az, bx, h1, bz, 0.15);
            U.pushStrut(towerIM, ax, h1, az, bx, h1, bz, 0.15);
          }
        }
        solidAt(fG.x + fG.nx * spec.u, fG.z + fG.nz * spec.u, 4.4, 4.4, BEAM);
      }
      // the beam: top + bottom chords each side, plus a Warren web
      const a0 = pt(uIn, BEAM), b0 = pt(uOut, BEAM);
      for (const dz of [-1.5, 1.5]) {
        const ax = a0[0] + fG.tx * dz, az = a0[2] + fG.tz * dz;
        const bx = b0[0] + fG.tx * dz, bz = b0[2] + fG.tz * dz;
        U.pushStrut(towerIM, ax, BEAM, az, bx, BEAM, bz, 0.3);
        U.pushStrut(towerIM, ax, BEAM + 2.1, az, bx, BEAM + 2.1, bz, 0.3);
        const NW = 10;
        for (let w = 0; w < NW; w++) {
          const f0 = w / NW, f1 = (w + 1) / NW;
          U.pushStrut(towerIM,
            ax + (bx - ax) * f0, BEAM + (w % 2 ? 2.1 : 0), az + (bz - az) * f0,
            ax + (bx - ax) * f1, BEAM + (w % 2 ? 0 : 2.1), az + (bz - az) * f1, 0.14);
        }
      }
      U.finishIM(grp, towerIM);
      // signage panels on both faces of the beam
      const signTex = SU.tex.screen([
        { text: "DIAMOND SPEEDWAY", color: "#ffd451" },
      ], 1024, 128);
      const signMat = new THREE.MeshLambertMaterial({ map: signTex, emissive: 0xffffff, emissiveIntensity: 0.28, emissiveMap: signTex });
      const span = Math.abs(uOut - uIn);
      const midU = (uIn + uOut) / 2;
      // THE SIGN SPANS THE BEAM, IT DOES NOT LIE ALONG THE TRACK. `box(...,
      // w, h, d, yaw)` puts WIDTH on local +X and DEPTH on local +Z, and this
      // file's own basis (surfMatrix) says local +Z is the TANGENT — so the
      // extra +PI/2 turned a 40 m sign meant to hang across the carriageway
      // into a 40 m billboard lying down the straight, 0.2 m thin edge-on to
      // the cars that are supposed to read it. Same fault class as the
      // upside-down boards: a frame written by hand instead of derived.
      //
      // THREE FAULTS LIVED ON THIS ONE SIGN AND ALL THREE ARE THE OWNER'S
      // REPORT. (a) FLICKER: the artwork was a 0.20 m box nested INSIDE the
      // 0.34 m casing box drawn on the same centre — a mapped surface entirely
      // enclosed by an opaque one, i.e. a depth tie for its whole area. The
      // artwork is now two flat faces standing 0.04 m PROUD of the casing,
      // each carrying the house negative polygon offset (playercars.js's cab
      // glass) so the pair cannot tie at distance either.
      // (b) MIRRORED TEXT: one map on one box (or on one DoubleSide quad) is
      // the same bug the sponsor bands had — the U axis that runs to your right
      // from the front runs to your LEFT from behind. Two independent
      // one-sided faces, each yawed so its own +Z is the side it is read from,
      // is the pattern speedway_structures.js's monument() and gatehouse title
      // beam already use; SU.util.signFace is that pattern, and it books each
      // face into the ledger CBZ.speedwayBoardAudit() re-tests from buffers.
      // (c) BLOCKED FACE: the truss's top chord runs at BEAM + 2.1 and is
      // 0.30 thick, so its top surface stands at BEAM + 2.25 while the sign's
      // foot sat at BEAM + 2.20 — the chord cut 0.05 m off the bottom of every
      // letter, from +-1.5 m in front of the artwork. Lifting the sign 0.20 m
      // puts its foot at BEAM + 2.40 and buys 0.15 m of daylight over the
      // chord (and 0.20 m over the web diagonals, which peak at BEAM + 2.199).
      const SIGN_Y = BEAM + 3.6, SIGN_CASE_D = 0.34;
      U.box(grp, mat(0x22282f), fG.x + fG.nx * midU, SIGN_Y, fG.z + fG.nz * midU,
        span * 0.9, 2.9, SIGN_CASE_D, fG.heading);
      for (const face of [1, -1]) {
        U.signFace(grp, {
          x: fG.x + fG.nx * midU, y: SIGN_Y, z: fG.z + fG.nz * midU,
          yaw: fG.heading + (face > 0 ? 0 : Math.PI),
          w: span * 0.86, h: 2.4, mat: signMat,
          proud: SIGN_CASE_D / 2 + 0.04, name: "speedway-gantry-sign",
        });
      }
      // THE LIGHT RIG: five columns, two lamps each, hung under the beam over
      // the racing surface. Kept addressable so the countdown can drive them.
      GANTRY.lamps.length = 0;
      const housing = mat(0x14181d);
      for (let c = 0; c < 5; c++) {
        const u = (c - 2) * 4.2;
        U.box(grp, housing, fG.x + fG.nx * u, BEAM - 1.0, fG.z + fG.nz * u, 2.0, 2.2, 0.7, fG.heading);
        const col = [];
        for (let r = 0; r < 2; r++) {
          const lm = (CBZ.mat || mat)(0x2a1214, { emissive: 0x2a1214, ei: 0.15 });
          const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.36, 10, 8), lm);
          lamp.position.set(fG.x + fG.nx * u + fG.tx * 0.4, BEAM - 0.5 - r * 0.85,
            fG.z + fG.nz * u + fG.tz * 0.4);
          lamp.userData.speedway = true;
          grp.add(lamp);
          col.push(lm);
        }
        GANTRY.lamps.push(col);
      }
      setGantryLights(-1);
      // FLAG STAND on the pit wall at the line — the starter's platform
      {
        const fu = PIT_WALL_U + 1.3;
        const fx = fG.x + fG.nx * fu, fz = fG.z + fG.nz * fu;
        U.box(grp, mat(0x6f757d), fx, 1.1, fz, 3.4, 2.2, 2.6, fG.heading);
        U.box(grp, mat(0xc8ced5), fx, 2.3, fz, 3.6, 0.16, 2.8, fG.heading);
        for (const s of [-1, 1]) {
          U.box(grp, steel, fx + fG.tx * s * 1.5, 2.9, fz + fG.tz * s * 1.5, 0.12, 1.2, 0.12, fG.heading);
        }
        U.box(grp, acc, fx, 3.6, fz, 3.8, 0.16, 3.0, fG.heading);
        // THE RACK THE FLAGS HANG FROM. Four coloured cards floated 0.37 m over
        // the starter's deck between two uprights with nothing joining them —
        // the same fault as the marshal posts. One rail turns four floating
        // props into a starter's flag rack.
        U.box(grp, steel, fx, 3.18, fz, 0.1, 0.1, 3.0, fG.heading);
        const fl = [0x101317, 0xf0c419, 0x2ba24a, 0xc23a36];
        for (let i = 0; i < fl.length; i++) {
          U.box(grp, mat(fl[i]), fx + fG.tx * (i - 1.5) * 0.6, 2.93, fz + fG.tz * (i - 1.5) * 0.6,
            0.5, 0.4, 0.05, fG.heading);
        }
        solidAt(fx, fz, 3.8, 3.2, 2.4);
      }
    }

    // ====================================================================
    //  6. ARCHITECTURE — grandstands, the pit complex, the scoring pylon,
    //  the jumbotron, floodlight masts, hoardings, marshal posts, tyre
    //  walls, gravel run-off and the paddock (speedway_structures.js).
    // ====================================================================
    let grandstandAudience = [];
    if (SU) {
      // --- MAIN GRANDSTAND: curved, raked, roofed, facing the pits ---
      grandstandAudience = SU.grandstand(S, {
        t0: -0.085, t1: 0.085, rows: 22, uBase: 30, plinth: 1.7,
        name: "speedway-main-grandstand", word: "DIAMOND", audienceCap: 44,
        seatA: 0x2f4b70, seatB: 0x3d6491, wordColor: 0xe4e9ef,
        fasciaSalt: 1, sign: "DIAMOND SPEEDWAY",
      });
      // --- BACKSTRETCH STAND (past the service gate) ---
      SU.grandstand(S, {
        t0: 0.545, t1: 0.655, rows: 13, uBase: 30, plinth: 1.4,
        name: "speedway-backstretch-stand", word: "SPEEDWAY", audienceCap: 0,
        seatA: 0x3a5c40, seatB: 0x47704d, wordColor: 0xe4e9ef, fasciaSalt: 3, voms: false,
      });
      // --- TURN 1 STAND ---
      SU.grandstand(S, {
        t0: 0.185, t1: 0.275, rows: 11, uBase: 29, plinth: 1.2,
        name: "speedway-turn1-stand", audienceCap: 0,
        seatA: 0x6b4a2c, seatB: 0x7d5934, fasciaSalt: 5, voms: false,
      });

      // --- PIT LANE + GARAGES on the inside of the front stretch ---
      SU.pitComplex(S, {
        t0: -PIT_T, t1: PIT_T, wallU: PIT_WALL_U,
        laneIn: PIT_LANE_IN, laneOut: PIT_LANE_OUT,
        garageFront: GARAGE_FRONT, garageDepth: GARAGE_DEPTH, boxes: 12,
      });

      // --- SCORING PYLON + JUMBOTRON in the infield, facing the main stand ---
      {
        const fp = trackFrame(0.055);
        PYLON = SU.pylon(S, fp.x + fp.nx * -62, fp.z + fp.nz * -62, fp.heading);
        const fj = trackFrame(-0.05);
        JUMBO = SU.jumbotron(S, fj.x + fj.nx * -60, fj.z + fj.nz * -60,
          Math.atan2(fj.nx, fj.nz), 22, 12);
      }

      // --- FLOODLIGHT MASTS (clear of the stands) ---
      {
        const spots = [];
        for (const t of [0.135, 0.235, 0.32, 0.40, 0.46, 0.68, 0.79, 0.89]) {
          const f = trackFrame(t);
          spots.push({
            x: f.x + f.nx * (SKIRT_END + 7), z: f.z + f.nz * (SKIRT_END + 7),
            ax: T.xc, az: T.zc,
          });
        }
        SU.floodlights(S, spots);
      }

      // --- TRACKSIDE HOARDINGS ---
      SU.hoardings(S, [
        { t0: TURN1[0], t1: TURN1[1], u: APRON_EDGE - 2.6, h: 1.2, salt: 2 },
        { t0: TURN2[0], t1: TURN2[1], u: APRON_EDGE - 2.6, h: 1.2, salt: 7 },
        { t0: -0.10, t1: 0.10, u: GARAGE_FRONT - GARAGE_DEPTH - 6, h: 2.4, salt: 9, y0: 0.05 },
        { t0: 0.42, t1: 0.58, u: APRON_EDGE - 3.0, h: 1.3, salt: 11 },
      ]);

      // --- MARSHAL POSTS around the outside ---
      {
        const posts = [];
        for (const t of [0.115, 0.16, 0.31, 0.38, 0.46, 0.5, 0.68, 0.76, 0.84, 0.90]) {
          const u = (t === 0.5) ? SKIRT_END + 9 : SKIRT_END + 3.2;
          const f = trackFrame(t);
          posts.push({ x: f.x + f.nx * u, z: f.z + f.nz * u, heading: f.heading });
        }
        SU.marshalPosts(S, posts);
      }

      // --- GRAVEL RUN-OFF at both turn exits, backed by a tyre wall ---
      SU.gravelTraps(S, [
        { t0: 0.20, t1: 0.32, u0: -33, u1: -22.5 },
        { t0: 0.70, t1: 0.82, u0: -33, u1: -22.5 },
      ]);
      {
        const stacks = [];
        function tyreRun(t0, t1, u, n) {
          const fa = trackFrame(t0), fb = trackFrame(t1);
          const ax = fa.x + fa.nx * u, az = fa.z + fa.nz * u;
          const bx = fb.x + fb.nx * u, bz = fb.z + fb.nz * u;
          stacks.push({ x: (ax + bx) / 2, z: (az + bz) / 2, dx: (bx - ax) / n, dz: (bz - az) / n, n: n, h: 3 });
        }
        tyreRun(0.20, 0.32, -34.0, 22);
        tyreRun(0.70, 0.82, -34.0, 22);
        tyreRun(-PIT_T - 0.012, -PIT_T + 0.004, PIT_LANE_OUT + 0.9, 6);   // pit entry
        tyreRun(PIT_T - 0.004, PIT_T + 0.012, PIT_LANE_OUT + 0.9, 6);     // pit exit
        SU.tyreStacks(S, stacks);
      }

      // --- THE PADDOCK, behind the main grandstand ---
      SU.paddock(S, {
        x0: CX - 120, x1: CX + 120, z0: CZ - 156, z1: CZ - 127,
        trucks: 11, units: 5,
      });
    }

    // ====================================================================
    //  7. CAUSEWAY, MOTORSPORTS COMPLEX, POPULATION
    // ====================================================================
    buildCauseway(root, mat, { C_DECK, C_CURB, C_STEEL }, rng);
    buildComplex(root, rng);
    buildSite(root, city);
    populate(root, rng, city, grandstandAudience);

    // ---- the banked surface becomes real walkable ground -----------------
    if (CBZ.CONFIG.SPEEDWAY_BANK_WALKABLE !== false && CBZ.registerCityGroundHeight) {
      CBZ.registerCityGroundHeight(speedwaySurfaceY, {
        owner: "speedway", kind: "circle", cx: T.xc, cz: T.zc, r: SURF_R2,
        note: "banked racing surface + apron + embankment",
      });
    }

    // ---- regions: register the island + causeway -------------------------
    CBZ.registerCityRegion(city, { name: "Diamond Speedway", subtitle: "Motorsports Park", biome: "speedway", kind: "circle", cx: CX, cz: CZ, r: R, pad: 6, underlay: true, terrainGrade: true });
    const causewayZ = ACCESS_Z;
    CBZ.registerCityRegion(city, { name: "Diamond Causeway", subtitle: "Motorsports Park", biome: "speedway", kind: "rect", minX: 336, maxX: 360, minZ: -585, maxZ: causewayZ + 12, pad: 1 });
    CBZ.registerCityRegion(city, { name: "Diamond Causeway", subtitle: "Motorsports Park", biome: "speedway", kind: "rect", minX: 336, maxX: ACCESS_X + 12, minZ: causewayZ - 12, maxZ: causewayZ + 12, pad: 1 });
    if (city.roads) {
      const endX = CBZ.CONFIG.SPEEDWAY_SITE !== false ? ROAD_END_X : ACCESS_X;
      city.roads.push({ x: 348, z: (-585 + causewayZ) / 2, vertical: true, len: causewayZ - (-585), district: "highway", w: 24, lanesPerDir: 3, laneW: 3.6, median: true, medianW: 1.2 });
      // THE APPROACH NOW RUNS THROUGH THE GATE. It used to stop at ACCESS_X,
      // 22 m short of the campus boundary, on open apron — which is why the
      // arrival had no threshold: there was nothing for a gate to stand on.
      city.roads.push({ x: (348 + endX) / 2, z: causewayZ, vertical: false, len: endX - 348, district: "highway", w: 24, lanesPerDir: 3, laneW: 3.6, median: true, medianW: 1.2, venueSite: "speedway" });
    }
  }, 20);

  // ====================================================================== //
  //  THE SITE — the arrival nobody had built.                              //
  //                                                                        //
  //  A circuit is not a venue until you can tell where it BEGINS. Four      //
  //  things say so and this file had none of them: a monument that names    //
  //  the place before you reach it, a perimeter you cross at exactly one    //
  //  point, a gate somebody is standing in, and lamps down the approach so  //
  //  the threshold reads at night. Every one is drawn by CBZ.venueSite —    //
  //  the shared site kit in speedway_structures.js — and every position is  //
  //  derived from siteEdge()/GATE, so moving the campus moves the arrival.  //
  // ====================================================================== //
  let SITE = null;
  function buildSite(root, city) {
    if (CBZ.CONFIG.SPEEDWAY_SITE === false) return;
    const VS = CBZ.venueSite;
    if (!VS) return;                                   // degrade: campus as before
    SITE = { fencePanels: 0, gates: 0, bays: 0, keepouts: 0 };
    const grp = new THREE.Group(); grp.name = "speedway-site";
    root.add(grp);
    // ARGUMENT-ORDER ADAPTER, and it is not a nicety: this file's solidBox is
    // (minX, maxX, minZ, maxZ, …) while the shared kit — like every other
    // collider helper in city/ — is (minX, minZ, maxX, maxZ, …). Handing
    // solidBox straight in would silently swap two axes and put every gate and
    // fence collider somewhere else entirely.
    function siteSolid(minX, minZ, maxX, maxZ, y0, y1) {
      solidBox(minX, maxX, minZ, maxZ, y0, y1);
    }

    // --- the perimeter, one gap where the approach crosses it ---------------
    const f = VS.fence({
      root: grp, name: "speedway-perimeter", path: sitePerimeter(),
      h: 2.5, pitch: 4.0, colliderPitch: 12, solid: siteSolid,
      gaps: [{ x: GATE.x, z: GATE.z, half: GATE_GAP }],
    });
    if (f) SITE.fencePanels = f.panels;

    // --- the gate itself ----------------------------------------------------
    // yaw faces the outward normal (-x): whoever is arriving is driving east.
    const gate = VS.gatehouse({
      root: grp, x: GATE.x, z: GATE.z, yaw: -Math.PI / 2, half: 12, h: 5.6,
      booth: true, arms: true, arch: true,
      // the approach is a 3+3 divided highway: its inner lane runs 2.4 m off
      // the axis, so the control hut stands OUTSIDE the kerb, not on an island
      // the traffic would drive through.
      boothX: 16.5,
      title: "Diamond Speedway", bg: 0x121722, fg: 0xffd451,
      solid: siteSolid, name: "speedway-gate",
    });
    if (gate) SITE.gates = 1;

    // --- the sign you read BEFORE the gate, on the south verge --------------
    VS.monument({
      root: grp, x: GATE.x - 62, z: ACCESS_Z - 17, yaw: -0.6,
      w: 19, h: 5.0, lift: 1.6, title: "Diamond Speedway",
      sub: "Motorsports Park · Turn 1 Gate", bg: 0x121722, fg: 0xffd451,
      accent: 0xc23a36, solid: siteSolid, name: "speedway-monument",
    });

    // --- lamps down the approach and along the car park face ---------------
    const lamps = [];
    const BLK = parkBlocks();
    const L = BLK.length ? BLK[0] : null;
    function inAnyBlock(lx) {
      for (let b = 0; b < BLK.length; b++) {
        if (lx > BLK[b].x0 - 2 && lx < BLK[b].x0 + BLK[b].w + 2) return true;
      }
      return false;
    }
    for (let i = 0; i < 7; i++) {
      const lx = GATE.x - 76 + i * 13;
      lamps.push({ x: lx, z: ACCESS_Z - 14.5, fx: 0, fz: 1 });     // heads over the road
      // the NORTH verge is the car park's south kerb for its whole length, so
      // a lamp there would stand in the first row of stalls
      if (!inAnyBlock(lx)) lamps.push({ x: lx, z: ACCESS_Z + 14.5, fx: 0, fz: -1 });
    }
    for (let b = 0; b < BLK.length; b++) {
      // along each block's BACK kerb, heads hung out over the stalls — never in
      // the aisle, which is where the cars turn.
      const B = BLK[b], n = Math.max(2, Math.round(B.w / 26));
      for (let i = 0; i <= n; i++) {
        lamps.push({ x: B.x0 + (B.w / n) * i, z: B.z0 + B.d + 0.6, fx: 0, fz: -1 });
      }
    }
    VS.lampRow({ root: grp, pts: lamps, poleH: 7.2, reach: 2.4, rise: 0.34, poleR: 0.14, solid: siteSolid });

    // --- painted stalls are geometry too: a low kerb backs each row so the
    //     lot has a form when the paint is edge-on to the camera -------------
    if (BLK.length) {
      const kerb = mat(0xa8adb4);
      SITE.bays = 0;
      for (let b = 0; b < BLK.length; b++) {
        const B = BLK[b];
        SITE.bays += B.slots.length;
        for (let r = 0; r < B.rows; r++) {
          const zk = (r % 2) ? (B.z0 + B.stallD * 2 + B.aisle + 0.15) : (B.z0 - 0.15);
          const m = new THREE.Mesh(new THREE.BoxGeometry(B.w + 1.2, 0.16, 0.3), kerb);
          m.position.set(B.x0 + B.w / 2, 0.08, zk);
          m.receiveShadow = true; m.userData.speedway = true; grp.add(m);
        }
      }
    }

    // --- KEEP-OUT: nobody wanders onto the racing line ----------------------
    // A track is a RIBBON and a keep-out is a rect or a circle, so the band is
    // covered by a ring of overlapping discs sampled off the ONE racing frame.
    // r = 27 is derived, not tasted: it reaches from the inside apron edge
    // (-20) out past the SAFER wall (+12.6), and stops SHORT of the pit lane
    // (-26.7 out / -36.5 in), the garages (-38.5) and the marshal posts
    // (+30.8) — the three places where people are supposed to be standing.
    if (CBZ.registerNoSpawnZone) {
      const N = 20;
      for (let i = 0; i < N; i++) {
        const fr = trackFrame(i / N);
        CBZ.registerNoSpawnZone(city, {
          cx: fr.x, cz: fr.z, r: 27, civ: true, label: "speedway-track",
        });
        SITE.keepouts++;
      }
    }

    // --- the people who work the front door --------------------------------
    if (CBZ.cityStaffVenue && CBZ.cityStaffPost) {
      const posts = [];
      if (gate && gate.boothAt) {
        posts.push({ id: "speedway:gate", job: "security guard", archetype: "security",
          x: gate.boothAt.x, z: gate.boothAt.z, face: gate.boothAt.face,
          opts: { wealth: 0.3, aggr: 0.18 } });
      }
      if (L) {
        // at the MAIN lot's mouth (its east end, where the spine lane meets it),
        // not in the middle of a row where nobody would stand. One steward, not
        // one per block: three guards for three painted rectangles is staff
        // bloat, and the other two blocks are overflow the same man waves at.
        posts.push({ id: "speedway:park", job: "security guard", archetype: "worker",
          x: L.x0 + L.w + 3, z: L.z0 + L.stallD + L.aisle / 2, face: -Math.PI / 2,
          opts: { wealth: 0.24, aggr: 0.08 } });
      }
      // THE SHOWROOM HAS STOCK AND HAD NOBODY SELLING IT. The glass hall is at
      // campus-local x = -51 (buildComplex), campus origin (CX, CZ-169).
      posts.push({ id: "speedway:sales:0", job: "shopkeeper", archetype: "merchant",
        x: CX - 62, z: CZ - 161, face: Math.PI, pose: "foldarms",
        opts: { wealth: 0.62, aggr: 0.05, floorY: 0.2 } });   // the shell's slab top
      posts.push({ id: "speedway:sales:1", job: "shopkeeper", archetype: "merchant",
        x: CX - 40, z: CZ - 161, face: Math.PI,
        opts: { wealth: 0.58, aggr: 0.05, floorY: 0.2 } });
      CBZ.cityStaffVenue("speedway", {
        stations: posts.length,
        note: "gate booth, car park, showroom floor",
      });
      for (let i = 0; i < posts.length; i++) {
        const p = posts[i];
        p.venue = "speedway";
        try { CBZ.cityStaffPost(p); } catch (e) { /* staff layer absent */ }
      }
    }

    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();

    // --- the census the shared audit reads (BLOCK LAW #5) ------------------
    if (CBZ.venueSite && CBZ.venueSite.census) {
      CBZ.venueSite.census("speedway", function () {
        let parked = 0, staff = 0, posts = 0, keepouts = 0, roads = 0;
        const cars = CBZ.cityCars || [];
        for (let i = 0; i < cars.length; i++) if (cars[i] && cars[i]._venueSite === "speedway") parked++;
        const sp = CBZ.cityStaffPosts ? CBZ.cityStaffPosts() : [];
        for (let i = 0; i < sp.length; i++) {
          if (!sp[i] || sp[i].venue !== "speedway") continue;
          posts++; if (sp[i].ped && !sp[i].ped.dead) staff++;
        }
        const A = CBZ.city && CBZ.city.arena;
        const ns = (A && A.noSpawn) || [];
        for (let i = 0; i < ns.length; i++) if (ns[i] && ns[i].label === "speedway-track") keepouts++;
        const rd = (A && A.roads) || [];
        for (let i = 0; i < rd.length; i++) if (rd[i] && rd[i].venueSite === "speedway") roads++;
        const BL = parkBlocks();
        let widest = 0;
        for (let i = 0; i < BL.length; i++) widest = Math.max(widest, BL[i].slots.length);
        // THE TWO NEW RATCHETS.
        //  hoardingsFlipped — every sponsor board face AND every flat sign face
        //    in the park (the S/F gantry name, the four scoring-pylon boards,
        //    the jumbotron), re-tested from its SHIPPED position/uv buffers: V
        //    must rise with world height, U must rise toward the reader's
        //    right, and no text face may be DoubleSide. PIN AT 0. It is
        //    reported with `hoardings` (the total face count, which may only
        //    RISE) and `signFaces` beside it so a "fix" that simply stops
        //    drawing signage cannot pass.
        //  propsCut / propsKept — the campus's own decoration ledger.
        //    `propsCut` is what THIS build refused to draw (the vomitory boxes
        //    with no opening behind them, the surplus stair cores, three of
        //    every four marshal flag cards), so the purge is a number and not
        //    a claim. `propsFloating` is the honesty check on the re-seats and
        //    is pinned at 0 — a prop whose own arithmetic puts it in the air.
        const SS = CBZ.speedwayStructures;
        const BA = (SS && SS.boardAudit) ? SS.boardAudit() : null;
        const PA = (SS && SS.propAudit) ? SS.propAudit() : null;
        return {
          parked: parked, bays: SITE ? SITE.bays : 0, staff: staff, posts: posts,
          keepouts: keepouts, roadRecords: roads,
          gates: SITE ? SITE.gates : 0, fencePanels: SITE ? SITE.fencePanels : 0,
          hoardingsFlipped: BA ? BA.flipped : -1,
          hoardings: BA ? BA.faces : 0,
          signFaces: BA ? (BA.signs || 0) : 0,
          propsCut: PA ? PA.propsCut : 0,
          propsKept: PA ? PA.propsKept : 0,
          propsFloating: PA ? PA.propsFloating : -1,
          // the lot is three blocks now, and a block that REFUSED (the campus
          // did not hold it) is invisible in a bay total — so the count is
          // reported beside it. 3 means all three stood up.
          parkBlocks: BL.length, biggestBlock: widest,
          // `parked` is capped on purpose: 88 bays with 88 vehicle rigs in them
          // is a frame budget spent on scenery, and a mid-week lot is mostly
          // empty anyway. So `fill` is measured against the CAP and the cap is
          // printed beside it — a lot that stops filling still shows up, and
          // one that was never built still reads 0 bays.
          carCap: PARK_CARS,
          fill: (SITE && SITE.bays)
            ? +(parked / Math.min(SITE.bays, PARK_CARS)).toFixed(2) : 0,
        };
      });
    }
  }

  // ---- THE CARS IN THE CAR PARK ------------------------------------------
  // DEFERRED ON PURPOSE, and this is the whole bug the lot had: cityMakeCar
  // dereferences CBZ.city.arena.root, and city/mode.js only assigns
  // CBZ.city.arena AFTER buildCity() returns — so the old ten-car loop, which
  // ran inside the landmass builder, threw on the FIRST call every single time
  // and its catch swallowed it. The park has been empty since it was written.
  // (island_airport.js:2167 and airside.js:1261 use the same one-shot trick.)
  // `parkRoot`, not a done-flag: a world REBUILD makes a new arena root and
  // cityAddParkedCar purges every fixture whose root is stale, so the lot has
  // to be re-filled or it would come back empty on the second world.
  let parkRoot = null;
  CBZ.onUpdate(55.42, function () {
    if (CBZ.CONFIG.SPEEDWAY_SITE === false) return;
    if (!CBZ.game || CBZ.game.mode !== "city") return;
    if (!CBZ.city || !CBZ.city.arena || !CBZ.cityAddParkedCar) return;
    if (parkRoot === CBZ.city.arena.root) return;
    const BL = parkBlocks();
    if (!BL.length) return;
    parkRoot = CBZ.city.arena.root;
    // WHICH BAYS ARE TAKEN IS A POSITION HASH, never a draw on the shared
    // build stream: this runs long after the build, so a stream draw here
    // would be order-dependent and could not be deterministic per seed.
    // The CAP bites in block order, and block 0 is the one at the gate — so a
    // capped lot reads as "the near rows filled first", which is how a lot
    // actually fills, rather than as a random scatter across 88 bays.
    let made = 0;
    for (let b = 0; b < BL.length && made < PARK_CARS; b++) {
      const L = BL[b];
      for (let i = 0; i < L.slots.length && made < PARK_CARS; i++) {
        const s = L.slots[i];
        if (CBZ.hash01 && CBZ.hash01(s.x, s.z, 0x5D1) > PARK_FILL) continue;
        let c = null;
        try { c = CBZ.cityAddParkedCar(s.x, s.z, s.heading, {}); } catch (e) { c = null; }
        if (!c) continue;
        made++;
        c._venueSite = "speedway";
        if (c.group) c.group.userData.speedwayPark = true;
      }
    }
  });

  // ====================================================================== //
  //  CAUSEWAY                                                               //
  // ====================================================================== //
  function buildCauseway(root, mat, P, rng) {
    // REAL HIGHWAY: an L-shaped wide multi-lane causeway over the water from
    // the commerce annex (south) up + across to the speedway island. Uses the
    // shared CBZ.buildHighway builder (merged deck + baked lanes + instanced
    // guardrails/lights + continuous curb colliders). Falls back to the old
    // bespoke deck if the builder isn't present.
    const joinZ = ACCESS_Z;
    // The deck runs THROUGH the gate line now, not to a point 22 m short of
    // it: an approach that ends on open apron is exactly why the campus had no
    // threshold. ROAD_END_X is solved off the campus boundary (see GATE).
    const endX = CBZ.CONFIG.SPEEDWAY_SITE !== false ? ROAD_END_X : ACCESS_X;
    if (CBZ.buildHighway) {
      CBZ.buildHighway(root, {
        path: [{ x: 348, z: -585 }, { x: 348, z: joinZ }, { x: endX, z: joinZ }],
        width: 24, lanesPerDir: 3, median: true, medianW: 1.2, laneW: 3.6, theme: "asphalt",
        guardrail: false, elevated: false, rng: rng,
      });
      return;
    }
    // ---- fallback: bespoke L-shaped deck (only if buildHighway absent) ----
    // L-shaped deck: vertical leg (annex north edge → up), horizontal leg (→ island).
    const deckMat = mat(P.C_DECK), curbMat = mat(P.C_CURB);
    function deck(cx, cz, w, d) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.4, d), deckMat);
      m.position.set(cx, 0.2, cz); m.receiveShadow = true; root.add(m);
      return m;
    }
    // vertical leg: annex north edge to the island join
    deck(348, (-585 + joinZ) / 2, 14, joinZ - (-585) + 4);
    // horizontal leg: across to the speedway island
    deck((348 + ACCESS_X) / 2, joinZ, ACCESS_X - 348 + 4, 14);
    // pylons under the deck (visual support over water)
    const pyMat = mat(P.C_STEEL);
    for (let z = -575; z <= joinZ - 10; z += 24) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(1.2, 12, 1.2), pyMat); p.position.set(348, -5.5, z); root.add(p);
    }
    for (let x = 360; x <= ACCESS_X - 10; x += 24) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(1.2, 12, 1.2), pyMat); p.position.set(x, -5.5, joinZ); root.add(p);
    }
  }

  // ====================================================================== //
  //  MOTORSPORTS COMPLEX (buildings)                                        //
  // ====================================================================== //
  function buildComplex(root, rng) {
    // One coherent motorsports campus replaces the four random corner towers.
    // It sits well outside the south turn and uses purpose-built glass/garage
    // grammar: no procedural gray window panels, roof AC clutter or intersecting
    // building shells.
    const campus = new THREE.Group();
    campus.position.set(CX, 0, CZ - 169);
    campus.name = "speedway-motorsports-campus";
    root.add(campus);

    const concrete = mat(0x6f747b), steel = mat(0x242a31), roofMat = mat(0x343b44);
    const warm = mat(0xe5b34e, { emissive: 0xe5b34e, ei: 0.45 });
    const glass = new THREE.MeshPhongMaterial({
      color: 0x8fcbe5, emissive: 0x102b38, emissiveIntensity: 0.22,
      transparent: true, opacity: 0.48, side: THREE.DoubleSide, depthWrite: false,
    });
    function part(parent, x, y, z, w, h, d, material) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
      parent.add(m); return m;
    }
    function solid(wx, wz, w, d, h) {
      CBZ.colliders.push({ minX: wx - w / 2, maxX: wx + w / 2, minZ: wz - d / 2, maxZ: wz + d / 2, y0: 0, y1: h });
    }
    function shell(name, lx, w, d, h, glassFront) {
      const g = new THREE.Group(); g.position.set(lx, 0, 0); g.name = name; campus.add(g);
      part(g, 0, 0.10, 0, w, 0.20, d, concrete);
      part(g, 0, h, 0, w + 0.8, 0.28, d + 0.8, roofMat);
      part(g, 0, h / 2, -d / 2, w, h, 0.32, steel);
      part(g, -w / 2, h / 2, 0, 0.32, h, d, steel);
      part(g, w / 2, h / 2, 0, 0.32, h, d, steel);
      if (glassFront) {
        const panes = Math.max(3, Math.round(w / 5));
        for (let i = 0; i < panes; i++) {
          const pw = w / panes - 0.20;
          part(g, -w / 2 + (i + 0.5) * w / panes, h / 2, d / 2, pw, h - 0.6, 0.08, glass);
        }
      }
      const wx = campus.position.x + lx, wz = campus.position.z;
      solid(wx, wz - d / 2, w, 0.38, h);
      solid(wx - w / 2, wz, 0.38, d, h);
      solid(wx + w / 2, wz, 0.38, d, h);
      return { group: g, w: w, d: d, storeys: 1, FH: h };
    }

    const showroom = shell("speedway-glass-showroom", -51, 42, 22, 7.4, true);
    fillShowroom(showroom);

    // Six open team bays: a continuous working garage, not six fake buildings.
    const garage = shell("speedway-team-garage", 22, 72, 22, 7.0, false);
    for (let i = 0; i <= 6; i++) part(garage.group, -36 + i * 12, 3.5, 11, 0.35, 7, 0.5, steel);
    for (let i = 0; i < 6; i++) {
      const x = -30 + i * 12;
      part(garage.group, x, 0.16, 1, 10.5, 0.10, 17, concrete);
      part(garage.group, x, 6.35, -10.76, 8.5, 0.38, 0.18, warm);
    }

    // A small all-glass trophy lounge terminates the same facade line.
    const trophy = shell("speedway-trophy-lounge", 78, 24, 22, 7.4, true);
    fillTrophyHall(trophy);
    if (CBZ.makeLabelSprite) {
      const lab = CBZ.makeLabelSprite("DIAMOND MOTORSPORTS", { color: "#ffd451" });
      lab.scale.set(14, 3.2, 1); lab.position.set(0, 10.5, 0); campus.add(lab);
    }
  }

  function fillShowroom(b) {
    if (!b || !b.group) return;
    const CARS = (CBZ.cityEcon && CBZ.cityEcon.CARS) || [];
    const buildVis = CBZ.cityBuildPlayerCarVisual, infer = CBZ.cityInferCarStyle;
    if (!buildVis || !CARS.length) return;
    const FH = b.FH || 4.0;
    const w = b.w, d = b.d;
    // interior usable bounds (inset from walls)
    const ixMax = w / 2 - 2.2, izMax = d / 2 - 2.2;
    const padMat = (CBZ.cmat || CBZ.mat)(0x1b1e22, { emissive: 0x2e5a8a, ei: 0.18 });
    // lay out cars on a grid across floors so every floor is FULL of cars
    const perRow = Math.max(2, Math.floor((ixMax * 2) / 6));   // ~6m spacing
    const rowsPerFloor = Math.max(2, Math.floor((izMax * 2) / 5));
    const perFloor = perRow * rowsPerFloor;
    const storeys = Math.max(1, Math.min(b.storeys || 4, Math.ceil(CARS.length / perFloor)));
    let ci = 0;
    for (let fl = 0; fl < storeys && ci < CARS.length; fl++) {
      const fy = fl * FH + 0.15;     // floor slab top is at L*FH-0.1; sit pads just above
      for (let rz = 0; rz < rowsPerFloor && ci < CARS.length; rz++) {
        for (let rx = 0; rx < perRow && ci < CARS.length; rx++) {
          const model = CARS[ci++];
          const x = -ixMax + 2 + rx * ((ixMax * 2 - 4) / Math.max(1, perRow - 1));
          const z = -izMax + 2 + rz * ((izMax * 2 - 4) / Math.max(1, rowsPerFloor - 1));
          const heading = (ci * 0.7) % (Math.PI * 2);
          // GROUND-FLOOR STOCK IS REAL (owner law: no dumb props): every
          // showroom car on the drivable y=0 slab is a full cityCars record —
          // walk in, get in, drive it off the floor (grand theft, obviously).
          // Upper storeys stay display visuals: the car sim has no floor
          // altitude (every car drives at y=0), so a "real" car up there
          // would fall through the building the moment it moved.
          if (fl === 0 && CBZ.cityAddParkedCar) {
            let real = null;
            try {
              // world coords by parent-chain sum (build-time matrices are stale;
              // shell/campus/root are all unrotated, so a position walk is exact)
              let wx = x, wz = z;
              for (let o = b.group; o; o = o.parent) { wx += o.position.x; wz += o.position.z; }
              real = CBZ.cityAddParkedCar(wx, wz, heading, { modelName: model.name });
            } catch (e) { real = null; }
            if (real) {
              if (CBZ.makeLabelSprite) {
                const lab = CBZ.makeLabelSprite(model.name + " · $" + fmt(model.value), { color: "#eef4ff" });
                lab.scale.set(4.5, 1.1, 1);
                lab.position.set(x, fy + 1.9, z);
                b.group.add(lab);
              }
              continue;
            }
            // fall through to the display visual when the car system is absent
          }
          // display pad
          const pad = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.0, 0.12, 16), padMat);
          pad.position.set(x, fy + 0.06, z); b.group.add(pad);
          // the car visual, painted in its catalog colour
          let vis = null;
          try {
            const style = (infer && infer(model)) || model.detailStyle || "muscle";
            vis = buildVis(style, model.color);
          } catch (e) { vis = null; }
          if (vis) {
            vis.position.set(x, fy + 0.12, z);
            vis.rotation.y = heading;
            const sc = (0.9 + (model.s || 1) * 0.0); vis.scale.multiplyScalar(sc);
            b.group.add(vis);
          }
          if (CBZ.makeLabelSprite) {
            const lab = CBZ.makeLabelSprite(model.name + " · $" + fmt(model.value), { color: "#eef4ff" });
            lab.scale.set(4.5, 1.1, 1);
            lab.position.set(x, fy + 1.9, z);
            b.group.add(lab);
          }
        }
      }
    }
  }

  function fillTrophyHall(b) {
    if (!b || !b.group) return;
    const FH = b.FH || 4.0;
    const goldMat = (CBZ.cmat || CBZ.mat)(0xe0b53a, { emissive: 0xe0b53a, ei: 0.25 });
    const baseMat = (CBZ.cmat || CBZ.mat)(0x2a2d33);
    const ixMax = b.w / 2 - 2.5;
    // world offset by parent-chain sum: the build-time matrices are stale, and
    // shell/campus/root are all unrotated, so a position walk is exact (same
    // trick fillShowroom uses to place its real cars).
    let ox = 0, oz = 0;
    for (let o = b.group; o; o = o.parent) { ox += o.position.x; oz += o.position.z; }
    for (let fl = 0; fl < (b.storeys || 2); fl++) {
      const fy = fl * FH + 0.15;
      for (let i = 0; i < 5; i++) {
        const x = -ixMax + 1 + i * ((ixMax * 2 - 2) / 4);
        const z = -b.d / 2 + 2;
        const ped = new THREE.Mesh(new THREE.BoxGeometry(1, 1.1, 1), baseMat);
        ped.position.set(x, fy + 0.55, z); b.group.add(ped);
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.2, 0.9, 10), goldMat);
        cup.position.set(x, fy + 1.55, z); b.group.add(cup);
        // a plinth you can walk through is a hologram, and this hall is
        // enterable — the showroom next door is where you steal the cars.
        if (fl === 0) solidAt(ox + x, oz + z, 1.2, 1.2, fy + 2.0);
      }
    }
  }

  function fmt(n) {
    if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k";
    return String(n);
  }

  // ====================================================================== //
  //  POPULATE                                                              //
  // ====================================================================== //
  // WHO IS IN THAT SEAT. OWNER (2026-07-27): "'FIGHT FAN' AS ROLE OF NPCS —
  // THAT'S NOT AN NPC ROLE." "race fan" is the same bug: it is an evening, not
  // a trade, and `job` is the field that renders the overhead pill. Strip the
  // activity word, let the caster deal a real trade (city/peds.js cityDealRole),
  // and put what they are DOING here on the separate attending field
  // (city/level.js). One call, degrade-safe, no other line changes.
  function venueCast(p, role) {
    if (!p || !/spectator|concourse/.test(role || "")) return;
    p.job = null; p.archetype = "resident"; p._role = null; p._work = null;
    if (CBZ.cityDealRole) { try { CBZ.cityDealRole(p); } catch (e) {} }
    if (CBZ.citySetAttending) CBZ.citySetAttending(p, "the racing", "Redline Speedway");
  }

  function populate(root, rng, city, audience) {
    const makePed = CBZ.cityMakePed;
    const populationEntries = [];
    const modular = !!(CBZ.npcLife && CBZ.npcLife.definePopulation);
    function liveActor(profile, x, z, opts, anchor, role) {
      if (modular) {
        populationEntries.push({
          profile: profile,
          placement: anchor ? { anchor: anchor, rng: rng } : { x: x, z: z, rng: rng },
          overrides: opts || {},
          configure: role ? function (p) { p._venueRole = role; venueCast(p, role); } : null,
        });
        return null;
      }
      if (CBZ.npcLife) {
        const p = CBZ.npcLife.spawnCity(profile, anchor
          ? { parent: root, anchor: anchor, rng: rng }
          : { x: x, z: z, parent: root, rng: rng }, opts || {});
        if (p && role) { p._venueRole = role; venueCast(p, role); }
        return p;
      }
      if (!makePed || anchor) return null; // empty seat beats a decorative proxy
      const p = makePed(x, z, rng, opts || {});
      if (!p || !p.group) return null;
      root.add(p.group);
      if (CBZ.cityPeds && CBZ.cityPeds.indexOf(p) < 0) CBZ.cityPeds.push(p);
      if (role) p._venueRole = role;
      return p;
    }
    // Every live seat is a reusable population entry. The shared life layer
    // fills it incrementally and recreates the same bounded cast after reset.
    for (let i = 0; audience && i < audience.length; i++) {
      liveActor("venueSpectator", 0, 0, { job: "race fan" }, audience[i], "speedway-spectator");
    }
    if (makePed) {
      // CONCOURSE: the plaza behind the main grandstand and the paddock apron.
      // Deliberately clear of the racing surface and the embankment — the old
      // ring at radius 165..192 now lands ON the widened circuit.
      for (let i = 0; i < 16; i++) {
        const px = CX - 108 + (rng() * 216);
        const pz = CZ - 152 + rng() * 52;
        try { liveActor("venueSpectator", px, pz, { kind: "civilian", job: "race fan" }, null, "speedway-concourse"); } catch (e) { /* headless */ }
      }
      // PIT CREW along the working lane, in front of their garage bays.
      for (let i = 0; i < 8; i++) {
        const t = (-0.09 + i * 0.026);
        const f = trackFrame(t);
        const u = -31.5 - (i % 2) * 2.2;
        try {
          liveActor("venueWorker", f.x + f.nx * u, f.z + f.nz * u,
            { kind: "worker", job: "pit crew" }, null, "speedway-worker");
        } catch (e) { /* */ }
      }
      // MARSHALS at the two turn-exit posts.
      for (const t of [0.25, 0.75]) {
        const f = trackFrame(t);
        const u = HALFW + SHOULDER_W + SKIRT_W + 3.2;
        try {
          liveActor("venueWorker", f.x + f.nx * u + 2, f.z + f.nz * u + 2,
            { kind: "worker", job: "track marshal" }, null, "speedway-worker");
        } catch (e) { /* */ }
      }
    }
    if (modular) CBZ.npcLife.definePopulation("speedway-authored", { root: root, entries: populationEntries });
    // THE CAR PARK IS NO LONGER FILLED FROM HERE. Ten cityMakeCar calls used
    // to sit at this line and every one of them THREW — CBZ.city.arena is not
    // assigned until buildCity() RETURNS, and this is inside a landmass
    // builder — with the catch eating it, so the lot has been empty for its
    // whole life. It is filled by the deferred one-shot next to buildSite,
    // on the same bays the paint is drawn from.
    // STREAM NOTE (the order-fragile rule): that loop DID take 20 draws off
    // the shared 'speedway' stream before each throw, and they are gone. It is
    // safe only because they were the LAST build-time draws on it — populate()
    // is the final call in the builder and nothing after it consumes rng. If
    // you add a build-time rng consumer after this point, it will shift.
  }

  // ====================================================================== //
  //  THE RACE — zone interaction + a REAL race weekend.                     //
  //  Two engines behind one green flag:                                     //
  //   • REAL DRIVERS (default, CBZ.raceDrivers): the field is 6 liveried    //
  //     championship cars that actually DRIVE — grid start under a light    //
  //     gantry, braking into the turns, defending, colliding through the    //
  //     shared car-car crash pass, spinning + recovering. Laps/positions/   //
  //     gaps/lap-times come from CBZ.raceKit; the race reads on the         //
  //     racing HUD (racehud.js); the finish pays through the championship.  //
  //   • LEGACY spline puppets, kept verbatim as the one-line-revert         //
  //     fallback (CBZ.CONFIG.RACE_REAL_DRIVERS = false, or headless rigs    //
  //     without the driver module).                                         //
  // ====================================================================== //
  const RACE = {
    active: false, lap: 0, laps: 3, t0: 0,
    playerLastT: 0, playerProg: 0, playerLaps: 0,
    racers: [],         // legacy: {group, t, speed, place, laps, lastT, racer}
    checks: 0, lastCross: false, label: null,
    // real-driver race state
    rd: false, phase: "idle", kit: null, drivers: [], countT: 0,
    playerTotal: 0, lightsOffT: 0,
  };
  CBZ.speedwayRaceState = function () { return RACE; };   // probe/debug peek (headless gates)
  const LAP_PURSE = 7500;       // per finishing-position-scaled payout base
  const FIELD_N = 5;            // legacy AI opponents on the grid
  const FIELD_RD = 6;           // real driving opponents on the grid
  // Centreline length. NOT re-derived by chord sampling any more (that
  // under-measured a curved line by ~0.4%): the frame table is built by
  // arc-length integration, so T.L IS the exact lap distance and the race
  // kit's gap/lap-time maths gets the same number the geometry used.
  function lineLen() { return ensureTable().L; }
  function useRD() {
    if (RACE._rdBroken) return false;   // spawn failed once (headless rig) → legacy for good
    return !!(CBZ.raceDrivers && CBZ.raceDrivers.enabled() && CBZ.raceKit && CBZ.cityMakeCar);
  }

  // (The two duplicated frame functions that used to live here — ovalFrame
  //  and CBZ_FRAME, "kept identical" by comment only — are gone. There is
  //  exactly one: trackFrame, at the top of this file. See the long note
  //  there for what they had drifted into.)

  function note(m, s) { if (CBZ.city && CBZ.city.note) CBZ.city.note(m, s || 2.2); }

  function startRace() {
    if (RACE.active) { note("You're already racing!", 1.5); return; }
    // a live pink-slip duel (city/racecareer.js) holds the oval — one race
    // surface, one race at a time.
    if (CBZ.raceLadder && CBZ.raceLadder.pinkSlip && CBZ.raceLadder.pinkSlip().active) {
      note("The oval is settling a pink slip — wait for the flag.", 2.2); return;
    }
    const P = CBZ.player;
    if (!P || !P.driving) { note("Get in a car to race.", 1.8); return; }
    if (useRD()) { startRaceRD(); return; }
    RACE.active = true; RACE.laps = 3;
    RACE.playerLaps = 0; RACE.playerProg = 0; RACE.t0 = Date.now() / 1000;
    RACE.lastCross = false;
    // place the player at the S/F line param ~0 (param the player rolls through)
    RACE.playerLastT = paramAt(P.pos.x, P.pos.z);

    // === BUILD THE AI FIELD FROM THE CHAMPIONSHIP (racing.js) ===
    // Each opponent is a TOP-N ranked driver, in their TEAM-COLOURED, NUMBERED
    // car — built via cityBuildPlayerCarVisual(homeStyle, teamColor, liveryFor)
    // so the number on track matches the name on the standings board. Falls back
    // to the old fast-CARS field if racing.js isn't loaded (headless / partial).
    RACE.racers.length = 0;
    const RC = CBZ.cityRacing;
    const buildVis = CBZ.cityBuildPlayerCarVisual, infer = CBZ.cityInferCarStyle;
    const root = CBZ.city && CBZ.city.arena && CBZ.city.arena.root;
    let field = [];
    if (RC && RC.standings) {
      // top FIELD_N by current standing are the ones you have to beat
      field = RC.standings().slice(0, FIELD_N).map((racer) => ({ racer: racer }));
    }
    if (!field.length) {
      // legacy fallback — fast cars, no roster
      const CARS = (CBZ.cityEcon && CBZ.cityEcon.CARS) || [];
      const fast = CARS.filter((c) => /muscle|coupe/.test(c.body || "") && (c.value || 0) >= 17000);
      for (let i = 0; i < FIELD_N; i++) {
        const model = fast.length ? fast[i % fast.length] : (CARS[CARS.length - 1 - i] || CARS[0]);
        field.push({ model: model });
      }
    }
    for (let i = 0; i < field.length; i++) {
      const ent = field[i];
      const racer = ent.racer || null;
      const model = ent.model || null;
      let vis = null, baseSpeed = 38 + i * 1.2;
      try {
        if (racer) {
          // liveried, numbered opponent. Skill biases its base pace.
          baseSpeed = 36 + (racer.skill || 0.8) * 12;     // 45..48 for the aces
          vis = buildVis ? buildVis(racer.homeStyle || "muscle", racer.teamColor, RC.liveryFor(racer)) : null;
        } else {
          const style = (infer && infer(model)) || (model && model.detailStyle) || "muscle";
          vis = buildVis ? buildVis(style, model && model.color) : null;
        }
      } catch (e) { vis = null; }
      if (!vis) { vis = new THREE.Group(); }
      // stagger the grid behind the S/F line
      const startT = (1 - (i + 1) * 0.012 + 1) % 1;
      const f = trackFrame(startT);
      const lane = (i % 2 === 0 ? 1 : -1) * 2.2;
      vis.position.set(f.x + f.nx * lane, heightAtTU(startT, lane), f.z + f.nz * lane);
      vis.rotation.y = f.heading;
      vis.rotation.z = -trackFrame(startT).bank;
      if (root) root.add(vis); else if (CBZ.city && CBZ.city.root) CBZ.city.root.add(vis);
      RACE.racers.push({
        group: vis, t: startT, lane,
        base: baseSpeed,                                   // baseline pace (rubber-band target rides this)
        speed: baseSpeed, cur: 18, laps: 0, lastT: startT,
        racer: racer,
        name: racer ? (racer.name + " #" + racer.number) : ((model && model.name) || "Rival"),
        skill: racer ? (racer.skill || 0.8) : 0.8,
        place: i + 2,
      });
    }
    // Race state belongs in the racing HUD, not on a billboard following the
    // player's roof through the world.
    RACE.label = null;
    if (CBZ.raceHud) { CBZ.raceHud.show(); CBZ.raceHud.lights(-1); }
    const rnd = RC ? (RC.round + 1) : 1, seas = RC ? RC.season : 1;
    note("GREEN FLAG! Round " + rnd + " · 3 laps — beat the field!", 2.8);
  }
  // export the join flow so racing.js's "challenge to a race" can drop the flag.
  CBZ.cityStartSpeedwayRace = startRace;

  // Nearest centreline parameter to a world point. O(1): a polar-angle
  // index into the precomputed table (legal because the curve is convex)
  // plus four Newton projections along the tangent. The old 64-sample
  // linear scan is gone — this is both faster and metre-accurate, which
  // matters because the lap counter watches t wrap through the S/F line.
  function paramAt(x, z) {
    return paramAtFast(x, z);
  }

  // ====================================================================== //
  //  REAL RACE WEEKEND (CBZ.raceDrivers path)                               //
  // ====================================================================== //
  // the painted grid slot i (0 = pole): two staggered columns behind the S/F
  // line — the SAME geometry the painted grid boxes use (builder step 4).
  function gridSlot(i) {
    const f = trackFrame(SF_T);
    const row = i >> 1, lane = (i % 2 === 0) ? 1 : -1;
    const COLW = 2.6, ROWGAP = 6.0;
    const back = -(row * ROWGAP + (lane > 0 ? 0 : ROWGAP * 0.5) + 3.0);
    const x = f.x + f.tx * back + f.nx * (lane * COLW);
    const z = f.z + f.tz * back + f.nz * (lane * COLW);
    // heading follows the track tangent at the slot's own param
    const t = ((back / lineLen()) % 1 + 1) % 1;
    return { x, z, heading: trackFrame(t).heading };
  }

  // THE SPEEDWAY AS A TOOL. A second event asks for this object instead of
  // copying 120 lines of tri-oval constants, a nearest-point solver and grid
  // arithmetic. racedrivers.js registers it as `raceKit.course("speedway")`;
  // publishing the plain object here keeps load order degrade-safe.
  CBZ.speedwayCourse = {
    id: "speedway",
    mode: "line",
    line: trackFrame,
    lineLen: lineLen,
    trackHalf: TRACK_W / 2,
    gridSlot: gridSlot,
    paramAt: paramAt,
    surfaceY: speedwaySurfaceY,
    startT: SF_T,
  };
  (CBZ._raceCourseConsumers || (CBZ._raceCourseConsumers = Object.create(null)))["speedway-weekend"] = true;

  // ---- THE VENUE'S PLACES, published (consumed by city/racecareer.js) -----
  // The paddock rect + gate mirror the SU.paddock(...) call below and the
  // paddock fence's own gap formula (half = width * 0.06); the pit constants
  // mirror the pitComplex call. They are exported from THIS file because these
  // numbers are authored here — a consumer typing its own copy of CX/CZ is the
  // drift bug the "two frames kept identical by comment" note above documents.
  CBZ.speedwayPlaces = function () {
    let Ln = 0;
    try { Ln = ensureTable().L; } catch (e) { return null; }
    if (!(Ln > 0)) return null;
    const px0 = CX - 120, px1 = CX + 120;
    return {
      cx: CX, cz: CZ, siteR: R,
      structures: CBZ.CONFIG.SPEEDWAY_STRUCTURES !== false,
      paddock: {
        x0: px0, x1: px1, z0: CZ - 156, z1: CZ - 127,
        gate: { x: (px0 + px1) / 2, z: CZ - 156, half: (px1 - px0) * 0.06 },
      },
      pit: { t0: -78 / Ln, t1: 78 / Ln, boxes: 12, wallU: PIT_WALL_U0,
             laneOut: PIT_LANE_OUT0, laneIn: PIT_LANE_IN0,
             garageFront: GARAGE_FRONT0, garageDepth: GARAGE_DEPTH0 },
      campus: { x: CX, z: CZ - 169 },
    };
  };

  function startRaceRD() {
    const P = CBZ.player, car = P._vehicle;
    if (!car) { note("Get in a car to race.", 1.8); return; }
    const RD = CBZ.raceDrivers, RC = CBZ.cityRacing;
    RACE.active = true; RACE.rd = true; RACE.phase = "grid";
    RACE.laps = 3; RACE.countT = 3.9; RACE.lightsOffT = 0;
    RACE.playerLaps = -1;                    // grid sits BEHIND the line: the
    RACE.playerTotal = -0.02;                // roll-over crossing arms lap 1
    RACE.drivers = [];

    // === the field: top-6 championship drivers, pole by standing ===
    let field = (RC && RC.standings) ? RC.standings().slice(0, FIELD_RD) : [];
    if (!field.length) {
      // roster module absent: anonymous fast rivals so the race still runs
      for (let i = 0; i < FIELD_RD; i++) field.push({ name: "Rival " + (i + 1), number: 90 + i, teamColor: [0xc0392b, 0x1b6ec8, 0x2ba24a, 0xd66a2e, 0x6a2bd6, 0xe0a92e][i], accent: 0xeef2f6, skill: 0.72 + i * 0.04, homeStyle: "muscle" });
    }
    for (let i = 0; i < field.length; i++) {
      const racer = field[i], slot = gridSlot(i);
      const m = RD.spawn({
        x: slot.x, z: slot.z, heading: slot.heading,
        style: racer.homeStyle || "muscle", color: racer.teamColor,
        livery: RC && RC.liveryFor ? RC.liveryFor(racer) : { number: racer.number, base: racer.teamColor, accent: racer.accent },
        name: racer.name, number: racer.number,
        skill: racer.skill || 0.8,
        aggr: 0.35 + (racer.skill || 0.8) * 0.45,
        consistency: 0.55 + (racer.skill || 0.8) * 0.4,
        lane0: (i % 2 === 0 ? 1 : -1) * 2.6,     // hold your grid column off the launch
        tag: "speedway", course: "speedway",
        playerProgress: function () { return RACE.playerTotal; },
      });
      if (!m) continue;
      m.laps = -1;                            // behind the line, same as the player
      m._racer = racer;
      RACE.drivers.push(m);
    }
    if (!RACE.drivers.length) {               // spawn failed (headless rig) → legacy
      RACE.active = false; RACE.rd = false; RACE._rdBroken = true;
      if (CBZ.raceHud) CBZ.raceHud.hide();
      startRace();
      return;
    }

    // === the player takes the last grid slot (you qualify at the back —
    //     beating the champions means DRIVING through them) ===
    const ps = gridSlot(RACE.drivers.length);
    // The grid is BANKED. Both of these writes used to be a literal y = 0 —
    // the exact class CLAUDE.md names ("every car sat at a literal y = 0") —
    // which drops the car through the tri-oval's own banking on frame one and
    // makes the player's first frame a fall. speedwaySurfaceY IS the drawn
    // surface, so ask it rather than assuming the sea-level plate.
    const py = speedwaySurfaceY(ps.x, ps.z);
    car.pos.x = ps.x; car.pos.z = ps.z; car.heading = ps.heading;
    car.v = 0; car.vx = 0; car.vz = 0;
    car.group.position.set(ps.x, py, ps.z);
    car.group.rotation.y = ps.heading;
    P.pos.set(ps.x, py, ps.z);
    RACE.playerLastT = paramAt(ps.x, ps.z);

    // === the scorer ===
    const entrants = RACE.drivers.map(function (m) {
      return {
        id: "n" + m.number, name: m.name, number: m.number, color: m._racer.teamColor,
        driver: m,
        progress: function () { return m.laps + m.t; },
        speed: function () { return Math.abs((m.car && m.car.v) || 0); },
        lapFloor0: -1,
      };
    });
    entrants.push({
      id: "you", name: "YOU", number: null, color: null, isPlayer: true,
      progress: function () { return RACE.playerTotal; },
      speed: function () { const c = CBZ.player && CBZ.player._vehicle; return Math.abs((c && c.v) || 0); },
      lapFloor0: -1,
    });
    RACE.kit = CBZ.raceKit.create({ course: "speedway", laps: RACE.laps, entrants: entrants });

    if (CBZ.raceHud) { CBZ.raceHud.show(); CBZ.raceHud.lights(0); }
    const rnd = RC ? (RC.round + 1) : 1;
    note("ROUND " + rnd + " — " + RACE.drivers.length + " championship cars on the grid. Lights out and away we go…", 3.0);
  }

  // ---- START THE RUN ALREADY ON THE GRID ----------------------------------
  // OWNER (2026-07-29): "the racer story is poorly built, like the pilot — it
  // should START IN RACE."
  //
  // He is naming a real asymmetry. The PILOT origin opens at 1,750 m doing
  // 150 m/s because playeraircraft.js publishes CBZ.cityAirborneStart, and the
  // reason that reads so well is that it drops you INTO a situation instead of
  // next to one. The RACER origin had no such call, so `speedwaySpawn()` stood
  // you on the GRASS eighteen metres outside the barrier, on foot, facing away
  // from the track, with $350 and a five-stage career whose first beat was to
  // walk somewhere. Its own blurb already promised the opposite — "a loaner, a
  // BACK-ROW START, one way up" — and the code did not honour a word of it.
  //
  // This is deliberately NOT a second race path. It is the loaner plus the one
  // call the RACE verb already dispatches through (startRace → startRaceRD or
  // the legacy field), living HERE rather than in origins.js for exactly the
  // reason cityAirborneStart lives in playeraircraft.js: the grid geometry, the
  // banking and the lights convention belong to the file that owns them, and a
  // future mission that wants to open on a grid gets this for free.
  //
  // opts: {style} detailStyle of the loaner (default "muscle") · {color} paint
  // · {number} the door number · {slot} grid index (default: the back row).
  // Returns the player's car, or null if the world cannot supply a race — in
  // which case the caller stands the player up and prints its own feed line.
  const LOANER_COLOR = 0x9aa4b2;      // primer grey: a lent car, not a livery
  function loanerCar(opts) {
    if (!CBZ.cityMakeCar || !CBZ.city || !CBZ.city.arena) return null;
    const back = opts.slot != null ? opts.slot : (useRD() ? FIELD_RD : FIELD_N);
    const slot = gridSlot(back);
    // Same model lookup racedrivers.js's modelForStyle uses, so the loaner is
    // the same CLASS of car as the field it is lining up behind — and it is a
    // by-name catalog read, never a draw on the seeded rng (determinism law).
    const CARS = (CBZ.cityEcon && CBZ.cityEcon.CARS) || [];
    let base = null;
    for (const c of CARS) { if (c.detailStyle === (opts.style || "muscle")) { base = c; break; } }
    if (!base && CARS.length) base = CARS[0];
    if (!base) return null;
    // Clone, never mutate the catalog. The clone also carries a TOKEN value:
    // `owned` below is what stops the opening frame being filed as Grand Theft
    // Auto, but vehicles.js pays the OWNED chop fraction (0.85 vs 0.42), so a
    // full-value loaner would be a rookie's instant $30k faucet on minute one.
    // A race-prepped car with 99 on the door is not a resaleable street car.
    const model = Object.assign({}, base, {
      color: opts.color != null ? opts.color : LOANER_COLOR,
      value: Math.min(base.value || 0, 3500),
    });
    let car = null;
    try { car = CBZ.cityMakeCar(slot.x, slot.z, slot.heading, false, model, 0.3); } catch (e) { return null; }
    if (!car) return null;
    // A LOANER IS LENT, NOT STOLEN. Without this, cityEnterVehicle files the
    // opening frame of the story as Grand Theft Auto and hands the rookie a
    // wanted level before the lights have gone out.
    car.owned = true; car._raceCar = true; car._loaner = true;
    car.group.position.y = speedwaySurfaceY(slot.x, slot.z);
    if (CBZ.cityApplyRaceLivery) {
      try {
        CBZ.cityApplyRaceLivery(car.group, {
          number: opts.number != null ? opts.number : 99,
          base: model.color, accent: 0xeef2f6,
        });
      } catch (e) { /* headless rigs have no livery painter */ }
    }
    return car;
  }

  CBZ.cityRaceStart = function (opts) {
    opts = opts || {};
    const P = CBZ.player;
    if (!P || !CBZ.city || !CBZ.city.arena) return null;
    if (RACE.active) return P._vehicle || null;      // already racing: idempotent
    // The track is lazy maths around world constants, but a world that never
    // built the venue has no arena root to put a car in and no table to solve.
    let L = 0;
    try { L = ensureTable().L; } catch (e) { return null; }
    if (!(L > 0)) return null;

    // Race the car you are in if you are in one; otherwise you are lent one.
    let car = (P.driving && P._vehicle && !P._vehicle.dead) ? P._vehicle : null;
    let lent = false;
    if (!car) {
      car = loanerCar(opts);
      if (!car) return null;
      if (!CBZ.cityEnterVehicle || !CBZ.cityEnterVehicle(car)) return null;
      lent = true;
    }

    // startRaceRD re-seats the player on the back row itself; the LEGACY field
    // does not, so put the car on the grid HERE and both paths open the same
    // way. (This is also what makes the loaner's first frame legal on a banked
    // surface rather than hovering over the sea-level plate.)
    if (!lent) {
      const slot = gridSlot(useRD() ? FIELD_RD : FIELD_N);
      car.pos.x = slot.x; car.pos.z = slot.z; car.heading = slot.heading;
      car.v = 0; car.vx = 0; car.vz = 0;
      car.group.position.set(slot.x, speedwaySurfaceY(slot.x, slot.z), slot.z);
      car.group.rotation.y = slot.heading;
    }
    P.pos.set(car.group.position.x, car.group.position.y, car.group.position.z);
    P.vy = 0; P.grounded = true;
    if (CBZ.cam) { CBZ.cam.yaw = car.heading; CBZ.cam.pitch = 0.12; }

    startRace();
    if (!RACE.active) {
      // The dispatcher refused (no drivers, no kit, a broken RD rig that also
      // failed legacy). Hand the loaner back rather than leaving an orphan.
      if (lent && CBZ.cityExitVehicle) { try { CBZ.cityExitVehicle(); } catch (e) {} }
      return null;
    }
    return car;
  };

  function tickRD(dt) {
    const P = CBZ.player;
    // bailed out of the car mid-weekend
    if (!P || !P.driving || !P._vehicle || P._vehicle.dead) {
      if (RACE.phase === "grid") cancelRD("Race scratched — you left the grid.");
      else endRaceRD({ dnf: true });
      return;
    }
    const car = P._vehicle;

    // ---- GRID: the light gantry counts down; the field is held ----
    if (RACE.phase === "grid") {
      RACE.countT -= dt;
      const c = RACE.countT;
      if (c > 0) {
        if (CBZ.raceHud) CBZ.raceHud.lights(c > 2.4 ? 1 : c > 1.2 ? 2 : 3);
        return;
      }
      RACE.phase = "green"; RACE.lightsOffT = 1.4;
      if (CBZ.raceHud) CBZ.raceHud.lights("go");
      CBZ.raceDrivers.setState("race", "speedway");
      note("GREEN GREEN GREEN!", 1.8);
      if (CBZ.sfx) CBZ.sfx("coin");
    }
    if (RACE.lightsOffT > 0) {
      RACE.lightsOffT -= dt;
      if (RACE.lightsOffT <= 0 && CBZ.raceHud) CBZ.raceHud.lights(-1);
    }

    // ---- player progress (the same S/F-crossing lap counter the AI uses) ----
    const pt = paramAt(car.pos.x, car.pos.z);
    if (RACE.playerLastT > 0.85 && pt < 0.15) RACE.playerLaps++;
    else if (RACE.playerLastT < 0.15 && pt > 0.85) RACE.playerLaps--;   // backed over the line
    RACE.playerLastT = pt;
    RACE.playerTotal = RACE.playerLaps + pt;

    RACE.kit.update(dt);

    // ---- the racing HUD strip ----
    const ctx = RACE.kit.playerContext();
    if (ctx && CBZ.raceHud) {
      CBZ.raceHud.update({
        pos: ctx.row.pos, count: RACE.kit.entrants.length,
        lap: Math.max(1, Math.min(RACE.laps, RACE.playerLaps + 1)),
        laps: RACE.laps,
        lapT: RACE.kit.time - ctx.row.lapStart, best: ctx.row.best,
        gapA: ctx.ahead ? { name: ctx.ahead.name, s: ctx.gapA } : null,
        gapB: ctx.behind ? { name: ctx.behind.name, s: ctx.gapB } : null,
      });
    }

    // ---- checkered flag ----
    if (RACE.playerLaps >= RACE.laps) endRaceRD({});
  }

  // race scratched before the green — no result, no round burned.
  function cancelRD(msg) {
    CBZ.raceDrivers.despawnAll("speedway");
    RACE.active = false; RACE.rd = false; RACE.phase = "idle";
    RACE.drivers = []; RACE.kit = null;
    if (CBZ.raceHud) CBZ.raceHud.hide();
    note(msg, 2.4);
  }

  function endRaceRD(opts) {
    opts = opts || {};
    const kit = RACE.kit, RC = CBZ.cityRacing;
    kit.update(0);
    let order = kit.order.slice();
    const pRow = kit.playerRow();
    if (opts.dnf) { order = order.filter((e) => e !== pRow); order.push(pRow); }
    const place = order.indexOf(pRow) + 1;

    // === CHAMPIONSHIP: the finishing order IS the awards order ===
    if (RC && RC.awardRace) {
      RC.awardRace(order.map((e) => e.isPlayer ? { player: true } : (e.driver && e.driver._racer) || { name: e.name }));
      RC.bumpRound();
    }

    // === purse: position × laps × season-build multiplier (a DNF pays $0) ===
    const roundMul = RC ? (1 + RC.round * 0.10) : 1;
    const purse = opts.dnf ? 0 : Math.max(500, Math.round(LAP_PURSE * (7 - Math.min(7, place)) / 6 * RACE.laps * roundMul));
    if (purse && CBZ.city && CBZ.city.addCash) CBZ.city.addCash(purse);
    // cityEvent below owns respect/reputation when present; only old/partial
    // harnesses use the direct fallback (never award the same finish twice).
    if (!CBZ.cityEvent && CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(place <= 1 ? 12 : place <= 3 ? 5 : 1);

    // === settle the ticket-office book on this round's winner ===
    const w = order[0];
    settleBook(w && !w.isPlayer && w.driver ? w.driver._racer : null, !!(w && w.isPlayer));

    // === the results board ===
    const leader = order[0];
    const rows = order.map(function (e, i) {
      const drv = e.driver;
      const dnf = (drv && (drv.dnf || (drv.car && drv.car.dead))) || (e.isPlayer && !!opts.dnf);
      let time = "";
      if (dnf) time = "";
      else if (e.finished) time = (i === 0 || !leader.finished) ? (CBZ.raceHud ? CBZ.raceHud.fmtT(e.finishT) : e.finishT.toFixed(1)) : "+" + Math.max(0, e.finishT - leader.finishT).toFixed(1) + "s";
      else time = "+" + kit.gapSeconds(leader, e).toFixed(1) + "s";
      return {
        pos: i + 1, name: e.name, number: e.number, color: e.color,
        time: time, pts: pointsForPlace(i + 1), purse: e.isPlayer ? purse : 0,
        you: e.isPlayer, dnf: dnf,
      };
    });
    if (CBZ.raceHud) {
      CBZ.raceHud.hide();
      CBZ.raceHud.results(rows, {
        title: opts.dnf ? "DNF — OUT OF THE RACE" : (place === 1 ? "CHECKERED FLAG — YOU WIN!" : "RACE RESULTS"),
        sub: RC ? "Diamond Speedway · Season " + RC.season : "Diamond Speedway",
        foot: purse ? ("Purse $" + fmt(purse) + " · +" + pointsForPlace(place) + " championship points · Esc closes") : "No purse for a DNF · Esc closes",
      });
    }
    const ord = place === 1 ? "1st — CHECKERED FLAG!" : place === 2 ? "2nd" : place === 3 ? "3rd" : place + "th";
    note(opts.dnf ? "DNF — the field takes the money." : ("FINISH: " + ord + "  +$" + fmt(purse)), 4.0);
    // The career ledger hears the same result the player just saw. Previously
    // Diamond Speedway awarded a private NPC championship and paid cash but
    // left no durable evidence that the PLAYER had raced here.
    if (CBZ.cityEvent) CBZ.cityEvent("race-finish", {
      race: "legal",
      place: place,
      podium: !opts.dnf && place <= 3,
      win: !opts.dnf && place === 1,
      dnf: !!opts.dnf,
      profit: purse,
      driver: opts.dnf ? 0 : place === 1 ? 8 : place <= 3 ? 5 : 2,
      respect: opts.dnf ? 0 : place === 1 ? 12 : place <= 3 ? 5 : 1,
      message: opts.dnf ? "Diamond Speedway DNF." : "Diamond Speedway P" + place + ".",
    });

    // === SEASON FINALE: crown the champion when the calendar wraps ===
    if (RC && RC.round === 0 && RC.standings) {
      const champ = RC.standings()[0];
      if (champ) {
        const banner = "SEASON " + (RC.season - 1) + " CHAMPION: " + champ.name + " #" + champ.number +
          " (" + champ.points + " pts, " + champ.wins + " wins)";
        if (CBZ.city && CBZ.city.big) CBZ.city.big(banner); else note(banner, 4.5);
      }
    }

    // === teardown: the field packs up ===
    CBZ.raceDrivers.despawnAll("speedway");
    RACE.active = false; RACE.rd = false; RACE.phase = "idle";
    RACE.drivers = []; RACE.kit = null;
  }

  // dispose a liveried AI car visual the same way it was added — it carries
  // _playerCarOwned cloned paint, so detach + drop the cloned material (shared
  // geo/accents are flagged _shared and survive). Mirrors playercars cleanup.
  function disposeFieldCar(grp) {
    if (!grp) return;
    if (grp.parent) grp.parent.remove(grp);
    grp.traverse(function (o) {
      const m = o.material;
      if (m && !Array.isArray(m) && m._playerCarOwned && m.dispose) m.dispose();
    });
  }

  function endRace(playerPlace) {
    RACE.active = false;
    if (CBZ.raceHud) CBZ.raceHud.hide();
    const RC = CBZ.cityRacing;

    // === CHAMPIONSHIP RESULTS ===
    // build the finishing order: every AI by total progress + the player slotted
    // at playerPlace, then award descending points to the ranked racers + bump the
    // round. Player at place 1 means every AI shifts down one — the array order IS
    // the finishing order, and awardRace skips the player (no roster match).
    if (RC && RC.awardRace) {
      const ranked = RACE.racers.slice().filter((r) => r.racer)
        .sort((a, b) => (b.laps + b.t) - (a.laps + a.t));
      // splice the player into the order at (playerPlace-1)
      const order = [];
      let ri2 = 0;
      for (let pos = 1; pos <= ranked.length + 1; pos++) {
        if (pos === playerPlace) order.push({ player: true });
        else if (ri2 < ranked.length) order.push(ranked[ri2++].racer);
      }
      // any AI not yet placed (player was beyond the field) tack on the end
      while (ri2 < ranked.length) order.push(ranked[ri2++].racer);
      RC.awardRace(order);
      RC.bumpRound();
      // settle the ticket-office book on this round's winner
      const w0 = order[0];
      settleBook(w0 && !w0.player && w0.points != null ? w0 : null, !!(w0 && w0.player));
    }

    // remove AI cars (dispose their cloned livery materials)
    for (const r of RACE.racers) { disposeFieldCar(r.group); }
    RACE.racers.length = 0;
    if (RACE.label && RACE.label.parent) RACE.label.parent.remove(RACE.label);

    // purse scales with finishing position AND the round (a championship pays more
    // as the season builds toward the finale).
    const roundMul = RC ? (1 + RC.round * 0.10) : 1;
    const purse = Math.max(500, Math.round(LAP_PURSE * (7 - playerPlace) / 6 * (RACE.laps) * roundMul));
    // E10: the purse used to be printed money — now it's sponsorship spend the
    // two manufacturer treasuries actually fund (sim/motorsport.js's
    // paySponsorship, which also cuts the winning driver's fame bonus off this
    // same purse). Guarded fallback keeps this working headless / pre-E10.
    if (CBZ.motorsport && CBZ.motorsport.paySponsorship) CBZ.motorsport.paySponsorship(purse);
    else if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(purse);
    if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(playerPlace <= 1 ? 12 : playerPlace <= 3 ? 5 : 1);
    const ptsGained = pointsForPlace(playerPlace);
    const ord = playerPlace === 1 ? "1st — CHECKERED FLAG!" : playerPlace === 2 ? "2nd" : playerPlace === 3 ? "3rd" : playerPlace + "th";
    note("FINISH: " + ord + "  +$" + fmt(purse) + (RC ? "  ·  +" + ptsGained + " champ pts" : ""), 4.2);

    // SEASON FINALE: if the round just wrapped back to 0, crown the champion.
    if (RC && RC.round === 0 && RC.standings) {
      const champ = RC.standings()[0];
      if (champ) {
        const banner = "SEASON " + (RC.season - 1) + " CHAMPION: " + champ.name + " #" + champ.number +
          " (" + champ.points + " pts, " + champ.wins + " wins)";
        if (CBZ.city && CBZ.city.big) CBZ.city.big(banner); else note(banner, 4.5);
      }
    }
  }

  // F1/NASCAR descending points (mirror racing.js so the player's gain reads right
  // even when racing.js is absent).
  const _POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
  function pointsForPlace(place) {
    const i = (place | 0) - 1;
    if (i < 0) return 0;
    return i < _POINTS.length ? _POINTS[i] : 1;
  }

  // ---- the live race tick --------------------------------------------------
  CBZ.onUpdate(34.5, function (dt) {
    if (g.mode !== "city") return;
    if (g.state && g.state !== "playing") return;
    if (!RACE.active) return;
    if (RACE.rd) { tickRD(dt); return; }            // the REAL race weekend
    const P = CBZ.player;
    if (!P || !P.driving) { endRace(6); return; }   // bailed out of the car

    const total = RACE.laps;
    const circ = lineLen();                     // exact lap distance (m)

    // player progress FIRST (one paramAt/frame) — lap counting at the S/F crossing
    // AND the rubber-band reference for the AI field below.
    const pt = paramAt(P.pos.x, P.pos.z);
    if (RACE.playerLastT > 0.85 && pt < 0.15) RACE.playerLaps++;
    RACE.playerLastT = pt;
    const playerTotal = RACE.playerLaps + pt;

    // advance AI racers along the centreline (rubber-banded to the player)
    for (const r of RACE.racers) {
      // === RUBBER-BANDING (hybrid speed+skill, GameAIPro Ch.42) ===
      // target = base * skillBias * gapMod, where gapMod eases racers AHEAD of the
      // player slower and racers BEHIND faster (a rubber band that keeps the race
      // close + fair), clamped so the AI can never teleport. Then ease cur→target.
      const rt0 = r.laps + r.t;
      const gap = rt0 - playerTotal;                  // +ahead of player, −behind
      // gapMod: ~1.06 when far behind → ~0.95 when far ahead (smooth, bounded).
      const gapMod = 1.01 - Math.max(-0.11, Math.min(0.10, gap * 0.55));
      const skillBias = 0.92 + (r.skill || 0.8) * 0.16;   // 0.92..1.05 by skill
      let target = (r.base || r.speed) * skillBias * gapMod;
      target = Math.max(22, Math.min(56, target));    // hard clamp: stays fair, no teleport
      r.speed = target;
      r.cur += (target - r.cur) * Math.min(1, dt * 1.5);
      const dtp = (r.cur * dt) / circ;
      const prevT = r.t;
      r.t = (r.t + dtp) % 1;
      if (prevT > 0.85 && r.t < 0.15) r.laps++;     // crossed S/F
      const f = trackFrame(r.t);
      if (r.group) {
        r.group.position.set(f.x + f.nx * r.lane, heightAtTU(r.t, r.lane), f.z + f.nz * r.lane);
        r.group.rotation.y = f.heading;
        r.group.rotation.z = -f.bank;    // sit ON the banking (outside wheel up)
      }
    }

    // compute place: count racers whose total progress beats the player
    let place = 1;
    for (const r of RACE.racers) {
      const rt = r.laps + r.t;
      if (rt > playerTotal + 0.002) place++;
    }

    if (CBZ.raceHud) CBZ.raceHud.update({
      pos: place, count: RACE.racers.length + 1,
      lap: Math.min(total, RACE.playerLaps + 1), laps: total,
      lapT: Date.now() / 1000 - RACE.t0, best: 0, gapA: null, gapB: null,
    });

    // finish: player completed all laps
    if (RACE.playerLaps >= total) { endRace(place); return; }
    // DNF guard: racers all done + player hopelessly behind → still let them finish
  });

  // ====================================================================== //
  //  CHAMPIONSHIP STANDINGS OVERLAY                                         //
  //  A read-only table of CBZ.cityRacing.standings() — rank/name/#/pts/wins //
  //  so "View championship standings" at the line shows the season table.   //
  // ====================================================================== //
  let standEl = null, standOpen = false;
  function standOverlay() {
    if (standEl) return standEl;
    standEl = document.createElement("div");
    standEl.id = "speedwayStandings";
    standEl.setAttribute("role", "dialog");
    standEl.setAttribute("aria-modal", "true");
    standEl.setAttribute("aria-label", "Championship standings");
    standEl.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:48;display:none;width:min(560px,92vw);max-height:84vh;overflow:auto;background:rgba(12,14,20,.97);border:2px solid #2c3140;border-radius:12px;padding:14px 18px;box-sizing:border-box;color:#e8eef7;font-family:Fredoka,system-ui,sans-serif;box-shadow:0 14px 44px rgba(0,0,0,.6)";
    const closeFromTap = function (e) {
      const t = e.target && e.target.closest && e.target.closest("[data-speedway-close]");
      if (!t) return;
      e.preventDefault(); e.stopPropagation(); toggleStandings(false);
    };
    standEl.addEventListener("click", closeFromTap);
    standEl.addEventListener("touchend", closeFromTap, { passive: false });
    document.body.appendChild(standEl);
    return standEl;
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[<>&]/g, (c) => c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"); }
  function hex6(n) { return "#" + ("000000" + ((n >>> 0).toString(16))).slice(-6); }
  function touchUI() {
    if (CBZ.touchMode) return true;
    try {
      if (document.body && document.body.classList.contains("touch")) return true;
      return !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
    } catch (e) { return false; }
  }
  function standingsFoot() {
    if (!touchUI()) {
      return "<div style='font-size:11px;color:#6b7480;margin-top:8px;border-top:1px solid #2c3140;padding-top:6px'>Win rounds to climb · Esc closes</div>";
    }
    return "<div style='display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:12px;color:#8a93a3;margin-top:8px;border-top:1px solid #2c3140;padding-top:8px'>" +
      "<span>Win rounds to climb.</span>" +
      "<button type='button' data-speedway-close data-testid='speedway-standings-close' style='min-width:78px;min-height:42px;padding:8px 14px;border-radius:999px;cursor:pointer;touch-action:manipulation;background:#1b3440;border:2px solid rgba(125,231,255,.55);color:#eaf6ff;font:700 13px Fredoka,system-ui,sans-serif'>CLOSE</button></div>";
  }
  function renderStandings() {
    const el = standOverlay();
    const RC = CBZ.cityRacing;
    if (!RC || !RC.standings) {
      el.innerHTML = "<div style='font-size:13px;color:#8a93a3'>Championship not loaded.</div>" + standingsFoot();
      return;
    }
    const rows = RC.standings();
    const cols = "26px 26px 1.4fr 70px 56px 74px";
    let h = "<div style='display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px'>" +
      "<div style='font-size:18px;font-weight:700'>Championship</div>" +
      "<div style='font-size:12px;color:#8a93a3'>Season " + RC.season + " · Round " + (RC.round + 1) + "/" + RC.ROUNDS + "</div></div>";
    h += "<div style='display:grid;grid-template-columns:" + cols + ";gap:6px;font-size:10px;color:#8a93a3;border-bottom:1px solid #2c3140;padding-bottom:2px;margin-bottom:2px'>" +
      "<span>#</span><span>Car</span><span>Driver</span><span style='text-align:right'>Points</span><span style='text-align:right'>Wins</span><span style='text-align:right'>Worth</span></div>";
    rows.forEach(function (r, i) {
      const worth = RC.netWorthOf ? RC.netWorthOf(r) : 0;
      const wtxt = worth >= 1e6 ? "$" + (worth / 1e6).toFixed(1) + "M" : "$" + Math.round(worth / 1000) + "k";
      h += "<div style='display:grid;grid-template-columns:" + cols + ";gap:6px;align-items:center;font-size:13px;padding:2px 4px'>" +
        "<span style='color:" + (i === 0 ? "#ffd166" : "#8a93a3") + ";font-weight:" + (i === 0 ? "700" : "400") + "'>" + (i + 1) + "</span>" +
        "<span style='display:inline-block;text-align:center;font-weight:700;color:" + hex6(r.teamColor) + "'>" + r.number + "</span>" +
        "<span style='white-space:nowrap;overflow:hidden;text-overflow:ellipsis'>" + esc(r.name) + "</span>" +
        "<span style='text-align:right;color:#7ed957;font-weight:700'>" + r.points + "</span>" +
        "<span style='text-align:right;color:#9fe6c8'>" + r.wins + "</span>" +
        "<span style='text-align:right;color:#aeb6c2'>" + wtxt + "</span>" +
        "</div>";
    });
    h += standingsFoot();
    el.innerHTML = h;
  }
  function toggleStandings(force) {
    standOpen = force != null ? force : !standOpen;
    if (standOpen) { renderStandings(); standOverlay().style.display = "block"; }
    else if (standEl) standEl.style.display = "none";
  }
  CBZ.cityShowChampionship = toggleStandings;
  if (typeof addEventListener !== "undefined") {
    addEventListener("keydown", function (e) {
      if (g.mode !== "city") return;
      if (e.key === "Escape" && standOpen) { e.preventDefault(); toggleStandings(false); }
      if (e.key === "Escape" && bookOpen) { e.preventDefault(); toggleBook(false); }
    });
  }

  // ====================================================================== //
  //  THE RACE BOOK — the City Speedway lot downtown is the ticket office /  //
  //  betting parlor for the island (buildings.js dresses its interior).     //
  //  One open ticket at a time: back a championship driver — or yourself —  //
  //  to WIN the next speedway round; the ticket settles when that round's   //
  //  checkered flag falls (both race engines call settleBook).              //
  // ====================================================================== //
  const BOOK = { bet: null, stake: 500 };
  CBZ.cityRaceBook = BOOK;                    // read-only peek for other UIs
  const STAKES = [200, 500, 1000, 2000];

  // odds by championship standing: the title leader pays short, the tail of
  // the field pays long. You always pay a touch over "fair" (the house eats).
  function oddsFor(pos, n) { return Math.round((1.8 + (pos - 1) * (9 / Math.max(1, n - 1))) * 10) / 10; }
  const PLAYER_ODDS = 4.0;

  function settleBook(winnerRacer, playerWon) {
    const bet = BOOK.bet;
    if (!bet) return;
    BOOK.bet = null;
    const won = bet.number === "you" ? playerWon : !!(winnerRacer && winnerRacer.number === bet.number);
    if (won) {
      const pay = Math.round(bet.stake * bet.odds);
      if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(pay);
      note("RACE BOOK: " + bet.label + " WINS — ticket pays $" + fmt(pay) + "!", 3.6);
    } else {
      note("RACE BOOK: " + bet.label + " didn't win. Ticket's a coaster (−$" + fmt(bet.stake) + ").", 3.0);
    }
  }

  let bookEl = null, bookOpen = false;
  function bookOverlay() {
    if (bookEl) return bookEl;
    bookEl = document.createElement("div");
    bookEl.id = "speedwayBook";
    bookEl.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:48;display:none;width:min(540px,92vw);max-height:84vh;overflow:auto;background:rgba(12,14,20,.97);border:2px solid #2c3140;border-radius:12px;padding:14px 18px;box-sizing:border-box;color:#e8eef7;font-family:Fredoka,system-ui,sans-serif;box-shadow:0 14px 44px rgba(0,0,0,.6)";
    bookEl.addEventListener("click", function (e) {
      const t = e.target.closest && e.target.closest("[data-act]");
      if (!t) return;
      const act = t.dataset.act;
      if (act === "stake") {
        const i = STAKES.indexOf(BOOK.stake);
        BOOK.stake = STAKES[(i + 1) % STAKES.length];
        renderBook();
      } else if (act === "bet") {
        if (BOOK.bet) { note("One ticket at a time — yours rides on " + BOOK.bet.label + ".", 2.2); return; }
        if ((g.cash || 0) < BOOK.stake) { note("Not enough cash for that stake.", 1.8); return; }
        const num = t.dataset.num === "you" ? "you" : (t.dataset.num | 0);
        const odds = parseFloat(t.dataset.odds);
        if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(-BOOK.stake);
        BOOK.bet = { number: num, label: t.dataset.name, stake: BOOK.stake, odds: odds };
        note("Ticket placed: $" + fmt(BOOK.stake) + " on " + t.dataset.name + " @ " + odds + "x. Settles at the next checkered flag.", 3.2);
        renderBook();
      } else if (act === "close") toggleBook(false);
    });
    document.body.appendChild(bookEl);
    return bookEl;
  }
  function renderBook() {
    const el = bookOverlay();
    const RC = CBZ.cityRacing;
    const rows = RC && RC.standings ? RC.standings().slice(0, 8) : [];
    let h = "<div style='display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px'>" +
      "<div style='font-size:18px;font-weight:700'>Speedway Race Book</div>" +
      "<div style='font-size:12px;color:#8a93a3'>" + (RC ? "Season " + RC.season + " · next: Round " + (RC.round + 1) + "/" + RC.ROUNDS : "next race") + "</div></div>";
    h += "<div style='font-size:12px;color:#9fb0c6;margin-bottom:8px'>Back a driver to WIN the next race at Diamond Speedway. Ticket settles at the flag.</div>";
    h += "<div style='display:flex;gap:8px;align-items:center;margin-bottom:8px'>" +
      "<span style='font-size:12px;color:#8a93a3'>Stake</span>" +
      "<button data-act='stake' style='cursor:pointer;background:#1d2430;border:1px solid #2c3140;border-radius:8px;color:#ffd166;font-weight:700;font-size:14px;padding:4px 14px;font-family:inherit'>$" + BOOK.stake + " ⟳</button>" +
      (BOOK.bet ? "<span style='font-size:12px;color:#7ed957'>ticket live: $" + fmt(BOOK.bet.stake) + " on " + esc(BOOK.bet.label) + " @ " + BOOK.bet.odds + "x</span>" : "") +
      "</div>";
    const btn = (num, name, odds) =>
      "<button data-act='bet' data-num='" + num + "' data-name='" + esc(name) + "' data-odds='" + odds + "' " +
      "style='cursor:pointer;background:#16301f;border:1px solid #2c5c3a;border-radius:8px;color:#7ed957;font-weight:700;font-size:12px;padding:3px 10px;font-family:inherit'>" + odds + "x</button>";
    h += "<div style='display:grid;grid-template-columns:26px 1.4fr 70px 64px;gap:6px;font-size:10px;color:#8a93a3;border-bottom:1px solid #2c3140;padding-bottom:2px;margin-bottom:2px'><span>Car</span><span>Driver</span><span style='text-align:right'>Points</span><span style='text-align:right'>Win</span></div>";
    rows.forEach(function (r, i) {
      h += "<div style='display:grid;grid-template-columns:26px 1.4fr 70px 64px;gap:6px;align-items:center;font-size:13px;padding:2px 4px'>" +
        "<span style='font-weight:700;color:" + hex6(r.teamColor) + "'>" + r.number + "</span>" +
        "<span style='white-space:nowrap;overflow:hidden;text-overflow:ellipsis'>" + esc(r.name) + "</span>" +
        "<span style='text-align:right;color:#9fe6c8'>" + r.points + "</span>" +
        "<span style='text-align:right'>" + btn(r.number, r.name + " #" + r.number, oddsFor(i + 1, rows.length)) + "</span></div>";
    });
    h += "<div style='display:grid;grid-template-columns:26px 1.4fr 70px 64px;gap:6px;align-items:center;font-size:13px;padding:4px;margin-top:4px;border-top:1px solid #2c3140'>" +
      "<span style='color:#7de7ff;font-weight:700'>—</span><span style='color:#7de7ff'>YOURSELF (drive the race and win it)</span><span></span>" +
      "<span style='text-align:right'>" + btn("you", "YOU", PLAYER_ODDS) + "</span></div>";
    h += "<div style='display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#6b7480;margin-top:8px;border-top:1px solid #2c3140;padding-top:6px'>" +
      "<span>Races run at Diamond Speedway — take the causeway north.</span>" +
      "<button data-act='close' style='cursor:pointer;background:#1d2430;border:1px solid #2c3140;border-radius:8px;color:#e8eef7;font-size:12px;padding:3px 12px;font-family:inherit'>Close</button></div>";
    el.innerHTML = h;
  }
  function toggleBook(force) {
    bookOpen = force != null ? force : !bookOpen;
    if (bookOpen) { renderBook(); bookOverlay().style.display = "block"; }
    else if (bookEl) bookEl.style.display = "none";
  }
  CBZ.cityOpenRaceBook = toggleBook;

  // the CITY-side ticket office: an interaction zone over the "City Speedway"
  // lot (kind "raceway") — the betting parlor buildings.js dresses.
  let _bookLot, _bookArena = null;
  function racewayLot() {
    const A = CBZ.city && CBZ.city.arena;
    if (!A || !A.shopLots) return null;                 // not built yet — retry
    if (_bookLot !== undefined && _bookArena === A) return _bookLot;
    _bookArena = A; _bookLot = null;                    // re-scan per world build
    for (const l of A.shopLots) { if (l.kind === "raceway") { _bookLot = l; break; } }
    return _bookLot;
  }

  // ---- the START/FINISH zone: "JOIN THE RACE" (driving) + "View standings" --
  if (CBZ.interactions && CBZ.interactions.registerZone) {
    const I = CBZ.interactions;
    const ZREACH = 16;
    I.registerZone({
      id: "zone-speedway-race", kind: "speedway", prio: 9, driving: true,
      find: function (px, pz) {
        const f = trackFrame(0);
        if (Math.hypot(px - f.x, pz - f.z) > ZREACH) return null;
        if (!RACE._zt) RACE._zt = { x: f.x, z: f.z };
        return RACE._zt;
      },
      options: [{
        id: "speedway-join", slot: "i",
        label: function () { return RACE.active ? "Racing — finish your laps" : "JOIN THE RACE"; },
        onSelect: function () { if (!RACE.active) startRace(); },
      }, {
        id: "speedway-standings", slot: "e",
        label: function () { return "View championship standings"; },
        onSelect: function () { toggleStandings(true); },
      }],
    });
    // a SECOND zone so you can check the board ON FOOT too (the join zone is
    // driving-only). Same line, lower prio so the driving join wins in a car.
    I.registerZone({
      id: "zone-speedway-board", kind: "speedway-board", prio: 6,
      find: function (px, pz) {
        const f = trackFrame(0);
        if (Math.hypot(px - f.x, pz - f.z) > ZREACH + 4) return null;
        if (!RACE._zb) RACE._zb = { x: f.x, z: f.z };
        return RACE._zb;
      },
      options: [{
        id: "speedway-board-view", slot: "e",
        label: function () { return "Championship standings"; },
        onSelect: function () { toggleStandings(true); },
      }],
    });
    // THE TICKET OFFICE / BETTING PARLOR: the downtown "City Speedway" lot.
    // On foot inside/near the shop you can open the book or read the table —
    // the lot finally does what its sign says and points at the island.
    I.registerZone({
      id: "zone-raceway-book", kind: "raceway-book", prio: 5,
      find: function (px, pz) {
        const lot = racewayLot();
        if (!lot) return null;
        const reach = Math.max(lot.w || 14, lot.d || 12) * 0.5 + 4;
        if (Math.hypot(px - lot.cx, pz - lot.cz) > reach) return null;
        if (!RACE._zk) RACE._zk = { x: lot.cx, z: lot.cz };
        return RACE._zk;
      },
      options: [{
        id: "raceway-bet", slot: "i",
        label: function () {
          return BOOK.bet ? ("Ticket live: " + BOOK.bet.label + " @ " + BOOK.bet.odds + "x") : "Bet on the next speedway race";
        },
        onSelect: function () { toggleBook(true); },
      }, {
        id: "raceway-standings", slot: "e",
        label: function () { return "Championship standings"; },
        onSelect: function () { toggleStandings(true); },
      }],
    });
    if (I.describe) {
      I.describe("speedway", function () {
        return { label: "Start / Finish", note: RACE.active ? "On track · " + RACE.laps + " laps" : "Grid start · 3-lap purse" };
      });
      I.describe("speedway-board", function () {
        const RC = CBZ.cityRacing;
        return { label: "Championship", note: RC ? "Season " + RC.season + " · Round " + (RC.round + 1) + "/" + RC.ROUNDS : "Race standings" };
      });
      I.describe("raceway-book", function () {
        const RC = CBZ.cityRacing;
        return { label: "Speedway Race Book", note: RC ? "Round " + (RC.round + 1) + " odds board · bets settle at the flag" : "Race betting" };
      });
    }
  }

  // ====================================================================== //
  //  LIVE TRACK SURFACE + THE LIGHT GANTRY                                  //
  //                                                                          //
  //  Cars in this engine are two-dimensional: vehicles.js integrates x/z     //
  //  and pins every hull to y=0 (racedrivers.js does the same for the AI     //
  //  field). A banked circuit therefore needs a PRESENTATIONAL conformer —   //
  //  a pass that runs after every vehicle updater and lifts / rolls /        //
  //  pitches any car standing on the speedway onto the banked surface. It    //
  //  reads the SAME heightAtTU() the mesh was built from, so a car is never  //
  //  a millimetre off its own asphalt. Physics is untouched (collision is    //
  //  XZ-only and the walls are full-height AABBs from grade up).             //
  // ====================================================================== //
  const GANTRY = { lamps: [], stage: -2 };
  let PYLON = null, JUMBO = null;

  function setGantryLights(stage) {
    GANTRY.stage = stage;
    for (let c = 0; c < GANTRY.lamps.length; c++) {
      const col = GANTRY.lamps[c];
      const green = stage === 0;
      const lit = stage > 0 && c < stage;
      for (let i = 0; i < col.length; i++) {
        const m = col[i];
        if (!m || !m.emissive) continue;
        if (green) { m.color.setHex(0x3af06a); m.emissive.setHex(0x2ef05a); m.emissiveIntensity = 1.0; }
        else if (lit) { m.color.setHex(0xff3a30); m.emissive.setHex(0xff2b24); m.emissiveIntensity = 1.0; }
        else { m.color.setHex(0x2a1214); m.emissive.setHex(0x2a1214); m.emissiveIntensity = 0.12; }
      }
    }
  }

  function clearConform(c) {
    if (c._swRoll) { c.group.rotation.z -= c._swRoll; c._swRoll = 0; }
    if (c._swPitch) { c.group.rotation.x -= c._swPitch; c._swPitch = 0; }
  }

  // Order: just after the VEHICLES band. Every car mover (player 11, traffic
  // 37, race drivers 37.3, the car-car crash pass 37.6, misc 38) has already
  // written this frame's transform; the camera/presentation band has not read
  // it yet. See core/prio.js.
  CBZ.onUpdate(CBZ.PRIO ? CBZ.PRIO.after(CBZ.PRIO.VEHICLES, 5) : 42.05, function () {
    if (g.mode !== "city") return;
    if (CBZ.CONFIG.SPEEDWAY_CAR_CONFORM === false || CBZ.CONFIG.SPEEDWAY_BANK === false) return;
    if (!TBL) return;
    const cars = CBZ.cityCars;
    if (!cars || !cars.length) return;
    const T = TBL, lim = SURF_R2;
    const IN_EDGE = -(HALFW + APRON_W) - 1.5, OUT_EDGE = HALFW + SHOULDER_W + 0.4;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (!c || !c.group || !c.pos) continue;
      const dx = c.pos.x - T.xc, dz = c.pos.z - T.zc;
      if (dx * dx + dz * dz > lim * lim) { if (c._swRoll || c._swPitch) clearConform(c); continue; }
      const t = paramAtFast(c.pos.x, c.pos.z);
      const f = trackFrame(t);
      const u = (c.pos.x - f.x) * f.nx + (c.pos.z - f.z) * f.nz;
      if (u < IN_EDGE || u > OUT_EDGE) { if (c._swRoll || c._swPitch) clearConform(c); continue; }
      const y = heightAtTU(t, u);
      const tb = Math.tan(f.bank);
      const h = c.heading || 0;
      // car local +X is its LEFT flank; +Z is forward (vehicles.js convention)
      const lx = Math.cos(h), lz = -Math.sin(h);
      const fwx = Math.sin(h), fwz = Math.cos(h);
      const roll = Math.atan(tb * (f.nx * lx + f.nz * lz));
      const pitch = -Math.atan(tb * (f.nx * fwx + f.nz * fwz));
      c.group.position.y = y + (c._airY || 0);
      if (CBZ.player && CBZ.player._vehicle === c) {
        // the player's hull re-sets its full rotation every frame (order 11)
        c.group.rotation.z = (c._roll || 0) + (c._airRoll || 0) + roll;
        c.group.rotation.x = (c._pitch || 0) + (c._airPitch || 0) + pitch;
      } else {
        c.group.rotation.z += roll - (c._swRoll || 0);
        c.group.rotation.x += pitch - (c._swPitch || 0);
      }
      c._swRoll = roll; c._swPitch = pitch;
    }
  });

  // ---- the gantry light rig follows the real countdown -------------------
  CBZ.onUpdate(CBZ.PRIO ? CBZ.PRIO.after(CBZ.PRIO.VEHICLES, 6) : 42.06, function () {
    if (!GANTRY.lamps.length) return;
    let stage = -1;
    if (RACE.active && RACE.rd) {
      if (RACE.phase === "grid") {
        const c = RACE.countT;
        stage = c > 3.1 ? 1 : c > 2.3 ? 2 : c > 1.5 ? 3 : c > 0.7 ? 4 : c > 0 ? 5 : 0;
      } else if (RACE.lightsOffT > 0) stage = 0;
    } else if (RACE.active) stage = 0;
    if (stage !== GANTRY.stage) setGantryLights(stage);
  });

  // ---- the jumbotron + scoring pylon actually show the race --------------
  // Low-rate (1.5 s) and keyed, so the canvas is only re-uploaded when the
  // content genuinely changed — never once per frame.
  let _boardT = 0, _boardKey = "";
  CBZ.onUpdate(CBZ.PRIO ? CBZ.PRIO.after(CBZ.PRIO.PRESENTATION, 2) : 60.02, function (dt) {
    if (g.mode !== "city") return;
    if (!JUMBO && !PYLON) return;
    _boardT -= dt || 0;
    if (_boardT > 0) return;
    _boardT = 1.5;
    let key, big, small;
    const rows = [];
    if (RACE.active && RACE.kit && RACE.kit.order) {
      const ord = RACE.kit.order;
      key = "R" + RACE.playerLaps + "|" + ord.map(function (e) { return e.number == null ? "Y" : e.number; }).join(",");
      big = "LAP " + Math.max(1, Math.min(RACE.laps, RACE.playerLaps + 1)) + " / " + RACE.laps;
      small = ord.length ? ("P1  " + ord[0].name) : "GREEN FLAG";
      for (let i = 0; i < Math.min(6, ord.length); i++) {
        rows.push({ text: String(i + 1), right: ord[i].number == null ? "YOU" : ("#" + ord[i].number) });
      }
    } else if (RACE.active) {
      key = "L" + RACE.playerLaps;
      big = "LAP " + Math.max(1, RACE.playerLaps + 1) + " / " + RACE.laps;
      small = "DIAMOND SPEEDWAY";
    } else {
      const RC = CBZ.cityRacing;
      key = RC ? ("S" + RC.season + "R" + RC.round) : "idle";
      big = "DIAMOND SPEEDWAY";
      small = RC ? ("SEASON " + RC.season + " · ROUND " + (RC.round + 1) + "/" + RC.ROUNDS) : "GRAND CIRCUIT";
      const st = RC && RC.standings ? RC.standings() : [];
      for (let i = 0; i < Math.min(6, st.length); i++) {
        rows.push({ text: String(i + 1), right: "#" + st[i].number });
      }
    }
    if (key === _boardKey) return;
    _boardKey = key;
    if (JUMBO && JUMBO.tex && JUMBO.tex.redraw) {
      JUMBO.tex.redraw([
        { text: big, color: "#ffd451" },
        { text: small, color: "#9fe6c8", right: RACE.active ? "LIVE" : "", rightColor: "#ff5a5a" },
      ]);
    }
    if (PYLON && PYLON.tex && PYLON.tex.redraw && rows.length) PYLON.tex.redraw(rows);
  });
})();
