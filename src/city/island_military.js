/* ============================================================
   city/island_military.js — THE MILITARY BASE ISLAND.

   A walled army installation off the mainland's west edge, joined
   by a guarded causeway (east gate) and the Redhollow logging road
   (north gate). THE LAYOUT IS world/basekit.js's (CBZ.basePlan — the
   one base planner, which world/airbase.js uses too), local frame
   centred on the base, +z toward the airfield:

     • AIRFIELD (south): a 420 m runway sets the axis; a parallel
       taxiway with hold-short bars feeds the apron. Fighters in three
       hardened shelters and on the flight line, nose to the taxiway;
       the B-2 (city/strategic.js), the B-52 and the A400M on their own
       stands, its ramp toward the cargo lane; helicopters on marked
       pads on the helo ramp; two arched hangars, the tower, crash-
       rescue and ops along the back of the apron; the fuel farm
       bunded and set back at the west end.
     • GATE ROAD from the east gate across the base.
     • CANTONMENT (north): HQ with the armory and the flagpole facing
       the parade field, parking, four barracks on their street, the
       range on the west wire; the motor pool (sheds, hardstand, three
       ranks facing the gate road); Patriot/MLRS in HESCO revetments;
       ammunition igloos behind traverses on the north wire.
     • WATCHTOWERS at the corners and the gate; HESCO wing walls.
   tools/base-plan-check.mjs audits the plan: no overlaps, every
   aircraft on pavement, nothing on the runway.

   ENGINE CONTRACT: registers as an archipelago landmass (see
   worldmap.js). Every parked machine is a solid collider so it
   reads as real and blocks movement. Repeats (fence posts, parade
   formation, sandbags) are InstancedMesh / merged geometry on a
   single shared material — draw-call frugal, as the engine demands.
   Plain IIFE, window.CBZ, THREE r128, no build step.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  // ---- FOOTPRINT (owner-specified) ---------------------------------------
  const _WOFF = (CBZ.worldOff && CBZ.worldOff("military")) || { dx: 0, dz: 0 };   // world-layout dial (zero today)
  const CEN_X = -620 + _WOFF.dx, CEN_Z = -700 + _WOFF.dz;    // base centre
  const HX = 240, HZ = 250;                   // half-extents
  const MINX = CEN_X - HX, MAXX = CEN_X + HX; // -860 .. -380
  const MINZ = CEN_Z - HZ, MAXZ = CEN_Z + HZ; // -950 .. -450

  // causeway deck (drivable bridge, widened to the 24m highway) from the
  // mainland west edge to the base gate. z-span = 24m about the centreline.
  // Island end = the base's east edge (tracks the world-layout dial); the
  // MAINLAND end stays pinned at the authored shore point x=-133 — moving
  // the island only stretches the deck, it never detaches either shore.
  const CW_MINX = MAXX, CW_MAXX = -133;
  const CW_MINZ = CEN_Z - 12, CW_MAXZ = CEN_Z + 12;
  const CW_CZ = (CW_MINZ + CW_MAXZ) / 2;      // == CEN_Z, lines up with the base gate

  // ---- THE PLAN (world/basekit.js) — computed at load, it is pure data -----
  // The deep shelter city/bunkers.js digs (zoning.js "brandt-shelter",
  // authored -762,-872) is reserved so nothing is planned on top of it.
  // `PLAN` is in the base's LOCAL frame (centre 0,0; +z is the airfield).
  const PLAN = CBZ.basePlan ? CBZ.basePlan({
    hx: HX, hz: HZ, northGate: 60, fighters: 5, hangars: 2,
    reserve: [{ id: "brandt-shelter", x: -762 - -620, z: -872 - -700, w: 36, d: 30 }],
  }) : null;
  // THE FIXED HARDWARE OTHER FILES PARK ON THIS BASE, in the AUTHORED frame
  // city/zoning.js keeps them in (it adds the layout dial itself). The B-2's
  // stand is the plan's: strategic.js parks it there through protectedSite.
  if (PLAN && PLAN.fixtures) {
    CBZ.fortBrandtFixtures = {};
    Object.keys(PLAN.fixtures).forEach(function (k) {
      const f = PLAN.fixtures[k];
      CBZ.fortBrandtFixtures[k] = { ax: -620 + f.x, az: -700 + f.z, w: f.w, d: f.d, yaw: f.yaw };
    });
  }

  // ---- local seeded RNG (owner rule: deterministic world) ----------------
  // seeded from CBZ.WORLD_SEED via the named-stream registry (core/seed.js)
  let rng = null;
  function armRng() { rng = CBZ.seedStream ? CBZ.seedStream("military") : (function () { let s = 0x5eed ^ 0x4d494c54; return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; })(); }
  armRng();
  function rr(a, b) { return a + rng() * (b - a); }

  // ---- shared material palette (one material per colour, reused) ----------
  // cmat() is the engine's CACHED-material factory: identical colour → same
  // material instance → the batcher can collapse draw calls.
  const M = {
    tarmac: 0x33373b, dirt: 0x6b5d44, runway: 0x2c2f33, paint: 0xd8d8c8,
    olive: 0x4a5238, oliveD: 0x3a4230, oliveL: 0x5c6648, steel: 0x5a6068,
    steelD: 0x3c4046, tire: 0x14161a, glassDark: 0x223044, jetGrey: 0x77808a,
    jetGreyD: 0x5a626b, canopy: 0x2a3b4d, sand: 0xb6a373, sandbag: 0x9a8a5e,
    fence: 0x9aa0a6, fenceP: 0x6a7077, fuel: 0x7d8a6a, red: 0xb43a32,
    warn: 0xd4a017, dark: 0x202327, hangarRoof: 0x6e7682,
  };
  function cm(hex, opts) { return CBZ.cmat ? CBZ.cmat(hex, opts) : CBZ.mat(hex, opts); }
  function bg(w, h, d) { return CBZ.boxGeom ? CBZ.boxGeom(w, h, d) : new THREE.BoxGeometry(w, h, d); }

  // place a box mesh under `parent` (local coords). Optionally a world collider.
  function box(parent, x, y, z, w, h, d, hex, opts) {
    opts = opts || {};
    const m = new THREE.Mesh(bg(w, h, d), cm(hex, opts.matOpts));
    m.position.set(x, y, z);
    m.castShadow = opts.cast !== false;
    m.receiveShadow = opts.receive !== false;
    parent.add(m);
    return m;
  }
  // a vertical-span world collider (engine AABB). wx/wz are WORLD coords.
  // Returns the collider object so callers can keep a handle to it (a stolen
  // vehicle must take its parked collider WITH it — see placeModel).
  function col(wx, wz, w, d, y0, y1, ref) {
    const c = { minX: wx - w / 2, maxX: wx + w / 2, minZ: wz - d / 2, maxZ: wz + d / 2, y0: y0 || 0, y1: y1 == null ? 0 : y1, ref: ref || null };
    CBZ.colliders.push(c);
    return c;
  }
  // cylinder (barrels, rotors, fuel tanks, gun barrels) — fresh geo (few used).
  function cyl(parent, x, y, z, rt, rb, h, hex, seg) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 12), cm(hex));
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m);
    return m;
  }

  // ---- vehicle-detail helpers (the "look at all vehicles" pass) ------------
  // NEW MATERIAL API (world/carfx.js loads before the islands): military hulls
  // stay deliberately MATTE Lambert (army paint doesn't gleam) — vehicleMat is
  // only for the accents that SHOULD catch light: canopy glass, gun steel,
  // rubber. All three roles are shared carfx singletons → zero extra material
  // cost per vehicle. Falls back to flat Lambert when carfx is absent.
  // The second argument is the COLOUR — it was only ever used as the no-carfx
  // fallback and was never handed to the factory, so M.canopy (0x2a3b4d) and
  // M.glassDark (0x223044) never reached a single pane: every canopy on the
  // base wore whatever tint the first vehicle in the world happened to pick.
  // Forwarding it is the whole fix; every other vmat wrapper in the game
  // (aircraft.js, playeraircraft.js, airtraffic.js, vehicles.js…) already did.
  function vmat(role, hex, opts) {
    if (CBZ.vehicleMat) {
      try { const m = CBZ.vehicleMat(role, hex, opts); if (m && m.isMaterial) return m; } catch (e) {}
    }
    return cm(hex != null ? hex : M.dark);
  }
  // box/cylinder with an EXPLICIT material (glass, gun steel, rubber)
  function mbox(parent, x, y, z, w, h, d, material) {
    const m = new THREE.Mesh(bg(w, h, d), material);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m);
    return m;
  }
  function mcyl(parent, x, y, z, rt, rb, h, material, seg) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 12), material);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m);
    return m;
  }
  // small static emissive marker (wingtip nav lights) — cached per colour.
  function navBox(parent, x, y, z, s, hex) {
    return box(parent, x, y, z, s, s, s, hex, { matOpts: { emissive: hex, ei: 0.9 }, cast: false });
  }

  // The rocket exhaust (CBZ.createRocketPlume / setRocketPlume) lives in
  // weapons/munitions.js with every other munition flare and trail.
  // SHAPE HELPERS (r128 idiom — sculpt the position attribute, recompute
  // normals; same pattern as aircraft.js taperBox/bladeGeo). Fully constant
  // per inputs → deterministic worlds.
  // taperBox: scales each vertex's X/Y by a factor of its Z (nose=+Z → nz,
  // tail=-Z → tz) with optional roofline (top) / keel (bot) narrowing.
  // taperBox lives ONCE in world/carfx.js now (was copied into 6 builders).
  function taperBox(w, h, d, opt) { return CBZ.taperBox(w, h, d, opt); }
  // sculpted taperBox mesh (fuselage fairings, canopies, hulls)
  function tbox(parent, x, y, z, w, h, d, opt, material) {
    const m = new THREE.Mesh(taperBox(w, h, d, opt), material);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m);
    return m;
  }
  // WING slab rooted at the fuselage flank, reaching outboard along ±X
  // (side −1/+1): as a vertex goes outboard (t 0→1) the chord narrows (taper),
  // shifts rearward (sweep), the slab thins (thin) and optionally droops
  // (rotor blades). Root edge sits AT the mesh position → bury it in the hull.
  function wingGeo(side, span, chord, thick, sweep, taper, thin, droop) {
    const geo = new THREE.BoxGeometry(span, thick, chord, 6, 1, 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), t = (x + span / 2) / span;    // 0 root → 1 tip
      pos.setX(i, side * (x + span / 2));                  // root edge at x=0
      pos.setZ(i, pos.getZ(i) * (1 - (taper || 0) * t) - (sweep || 0) * t);
      pos.setY(i, pos.getY(i) * (1 - (thin || 0) * t) - (droop || 0) * t * t);
    }
    pos.needsUpdate = true; geo.computeVertexNormals();
    return geo;
  }
  function wing(parent, x, y, z, side, span, chord, thick, sweep, taper, thin, hexOrMat, droop) {
    const mat = (hexOrMat && hexOrMat.isMaterial) ? hexOrMat : cm(hexOrMat);
    const m = new THREE.Mesh(wingGeo(side, span, chord, thick, sweep, taper, thin, droop), mat);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m);
    return m;
  }

  // ========================================================================
  //   THE AIRCRAFT. Every airframe is a lofted surface from city/mil_air.js
  //   (real metres, nose +Z, wheels on y = 0, built once and cloned per
  //   placement). What stays here is the one airframe with a ROOM in it.
  // ========================================================================
  function makeJet() { return CBZ.milAir.make("fighter"); }
  function makeBomber() { return CBZ.milAir.make("bomber"); }
  function makeHeli() { return CBZ.milAir.make("utilityHeli"); }
  function makeAttackHeli() { return CBZ.milAir.make("attackHeli"); }
  function makeDrone() { return CBZ.milAir.make("drone"); }

  // ========================================================================
  //  CARGO LIFTER — A400M-class, built from the INSIDE OUT.
  //
  //  OWNER: "a cargo plane where you can open and close the back and even a
  //  tank can drive into the back — but like elevators it must actually have a
  //  back of plane that exists, so other players can be inside the plane like a
  //  room." The hold is authored first as a 4.4 x 19 x 3.0 m room sized off
  //  the tank (3.5 wide, 6.4 long, 2.7 tall) and the aeroplane is wrapped
  //  around it: a 5.6 m lofted fuselage (the real A400M's), a high wing so no
  //  spar crosses the room, gear in sponsons so the deck stays flat at 1.35 m,
  //  an aft body that is an OPEN-BOTTOMED shell so the ramp has somewhere to
  //  stow, four turboprops with eight-blade props, and a T-tail.
  //
  //  The ramp is its own group (userData.cargoRamp) hinged at the deck sill, so
  //  city/vehicle_hold.js poses it by rotating ONE node and solves the walkable
  //  slope from its live angle.
  // ========================================================================
  const CARGO = {
    deckY: 1.35,          // cargo floor top, model+world metres
    roofY: 4.35,          // hold ceiling
    halfW: 2.2,           // hold interior half-width (tank is 3.5 wide)
    holdZ0: -11.5,        // aft sill (the aperture)
    holdZ1: 7.5,          // forward bulkhead
    rampLen: 3.7,
    rampW: 3.9,
    rampOpenRx: -0.3648,  // toe on the tarmac: asin((1.35-0.03)/3.7) = 20.9°
    rampClosedRx: 1.24,   // stood up across the aperture (71°); toe ends 1.2 m aft, 3.5 m up, inside the aft shell
  };
  if (CBZ.milAir) CBZ.milAir.define("cargo", function () {
    const K$ = CBZ.milAir.kit, B = new K$.Build("cargo");
    const loft = K$.loft, wingG = K$.wing, xf = K$.xf, mir = K$.mir, bx = K$.box;
    const HULL = cm(0x6d7681), SHADE = cm(0x4d545c), PANEL = cm(M.jetGrey);
    const GLASS = vmat("glass", M.canopy), RUBBER = vmat("tire", M.tire), GUN = vmat("plastic", M.dark);
    // A HOLD IS A LIT ROOM: painted as lit, the ceiling carries its own
    // emissive (a downward face never sees the sun).
    const BAY = cm(0x9aa1a9), DECKM = cm(0x666c74), CEIL = cm(0xb4bbc2, { emissive: 0x39434b, ei: 0.85 });
    const STRIP = cm(0xeef3f6, { emissive: 0xcfe2ec, ei: 0.9 }), WEB = cm(0x8a3f34);
    const DECKI = vmat("interior", 0x0d0e10), GLOW = cm(0x0c1a1c, { emissive: 0x2f6f6a, ei: 0.5 });
    const WARN = cm(M.warn), STEELD = cm(M.steelD), BLADE = cm(0x23272c);
    const Z0 = CARGO.holdZ0, Z1 = CARGO.holdZ1, DY = CARGO.deckY, RY = CARGO.roofY, HW = CARGO.halfW;
    const holdMidZ = (Z0 + Z1) / 2, holdLen = Z1 - Z0;
    const K = B.main;
    const S = function (z, y, w, t, b, p, pb, open) { const s = { z: z, y: y, w: w, t: t, b: b, p: p || 2, pb: pb || p || 2 }; if (open != null) s.open = open; return s; };

    // ===================== FUSELAGE — nose to aperture ======================
    // 5.6 m wide, 0.95-6.2 m tall; the squared bottom (pb 4.5) is what keeps
    // the deck corners inside the skin. Windscreen and flight-deck side
    // windows are the hull's own quads re-emitted as glass.
    const FUS = [
      S(19.6, 3.35, 0.25, 0.25, 0.25, 2),
      S(19.0, 3.40, 1.20, 1.15, 1.10, 2.2),
      S(17.8, 3.50, 2.05, 1.95, 1.75, 2.4, 3.0),
      S(16.2, 3.55, 2.60, 2.50, 2.10, 2.7, 3.6),
      S(14.2, 3.55, 2.80, 2.65, 2.30, 3.0, 4.2),
      S(11.0, 3.45, 2.80, 2.75, 2.50, 3.0, 4.5),
      S(Z1, 3.45, 2.80, 2.75, 2.50, 3.0, 4.5),
      S(Z0, 3.45, 2.80, 2.75, 2.50, 3.0, 4.5),
    ];
    const fus = loft(FUS, {
      n: 32, capBack: false, split: function (z, th) {
        const s = Math.sin(th);
        if (z > 15.4 && z < 18.2) return s > 0.5;
        if (z > 13.0 && z < 15.2) return s > 0.42 && s < 0.78;
        return false;
      },
    });
    K.add(fus[0], HULL); if (fus[1]) K.add(fus[1], GLASS);
    // flight-deck liner so the glass looks into a room, not out the far side
    K.add(loft(FUS.slice(1, 6).map(function (s) { return S(s.z, s.y, s.w - 0.1, s.t - 0.1, s.b - 0.1, s.p, s.pb); }), { n: 32, caps: false, flipped: true }), DECKI);
    // ===================== AFT BODY — the open-bottomed ramp tunnel ==========
    const AFT = [
      S(Z0, 3.45, 2.80, 2.75, 2.50, 3.0, 4.5, 0.9),
      S(-14.0, 4.00, 2.62, 2.20, 2.10, 3.0, 3.6, 0.9),
      S(-17.0, 4.70, 2.10, 1.55, 1.45, 2.8, 3.0, 0.9),
      S(-19.5, 5.20, 1.40, 0.95, 0.80, 2.5, 2.5, 0.55),
      S(-22.0, 5.60, 0.70, 0.55, 0.45, 2.2, 2.2, 0.2),
      S(-23.3, 5.80, 0.12, 0.12, 0.10, 2, 2, 0.2),
    ];
    K.add(loft(AFT, { n: 32 }), HULL);
    K.add(loft(AFT.slice(0, 4).map(function (s) { return S(s.z, s.y, s.w - 0.12, s.t - 0.12, s.b - 0.12, s.p, s.pb, s.open); }), { n: 32, flipped: true }), BAY);
    // the cut face at the aperture: hull ring down to the hold's doorway
    K.add(K$.annulus(FUS[FUS.length - 1], S(Z0, (DY + RY) / 2, HW + 0.02, (RY - DY) / 2 + 0.02, (RY - DY) / 2 + 0.25, 8), 32, [0, 0, -1]), SHADE);
    // ===================== THE HOLD ITSELF ==================================
    K.add(xf(bx(HW * 2, 0.12, holdLen), 0, DY - 0.06, holdMidZ), DECKM);
    K.add(xf(bx(0.30, 0.02, holdLen - 0.4), 0, DY + 0.012, holdMidZ), WARN);
    [-1.55, -0.55, 0.55, 1.55].forEach(function (rx) { K.add(xf(bx(0.16, 0.07, holdLen - 0.6), rx, DY + 0.035, holdMidZ), STEELD); });
    for (let i = 0; i < 10; i++) {
      const tz = Z0 + 1.2 + i * ((holdLen - 2.4) / 9);
      [-1.9, 1.9].forEach(function (tx) { K.add(xf(bx(0.20, 0.10, 0.20), tx, DY + 0.05, tz), GUN); });
    }
    [-1, 1].forEach(function (s) {
      K.add(xf(bx(0.06, RY - DY, holdLen), s * (HW - 0.03), (DY + RY) / 2, holdMidZ), BAY);             // wall liner
      for (let i = 0; i < 11; i++) {
        const rz = Z0 + 0.9 + i * ((holdLen - 1.8) / 10);
        K.add(xf(bx(0.10, RY - DY - 0.4, 0.16), s * (HW - 0.09), (DY + RY) / 2 + 0.1, rz), SHADE);     // frames
      }
      K.add(xf(bx(0.56, 0.09, holdLen - 4.5), s * (HW - 0.32), DY + 0.50, holdMidZ + 0.5), WEB);         // troop bench
      K.add(xf(bx(0.07, 0.75, holdLen - 4.5), s * (HW - 0.07), DY + 0.92, holdMidZ + 0.5), WEB);
      K.add(xf(bx(0.30, 0.08, holdLen - 1.6), s * 1.02, RY - 0.09, holdMidZ), STRIP);                   // light strip
      K.add(xf(bx(0.10, 0.20, holdLen - 1.6), s * (HW - 0.04), RY - 0.30, holdMidZ), cm(0x3b4148));      // duct run
    });
    K.add(xf(bx(HW * 2 - 0.1, 0.06, holdLen), 0, RY - 0.03, holdMidZ), CEIL);
    K.add(xf(bx(HW * 2, RY - DY, 0.36), 0, (DY + RY) / 2, Z1 + 0.18), cm(0x767d85));                    // fwd bulkhead
    K.add(xf(bx(0.90, 2.0, 0.10), -1.25, DY + 1.0, Z1 - 0.02), cm(0x2b3037));                             // doorway to the flight deck
    K.add(xf(bx(1.5, 1.1, 0.10), 0.85, DY + 1.4, Z1 - 0.02), cm(0x565d66));                               // stowed pallet
    K.add(xf(bx(0.14, 0.60, 0.45), -(HW - 0.14), DY + 1.5, Z0 + 1.6), cm(0x2f353c));                     // loadmaster panel
    K.add(xf(bx(0.04, 0.34, 0.30), -(HW - 0.20), DY + 1.5, Z0 + 1.6), cm(0x14343a, { emissive: 0x2f8f8a, ei: 0.55 }));
    K.add(xf(bx(HW * 2 + 0.6, DY - 0.95, 0.2), 0, (DY + 0.95) / 2, Z0 + 0.1), SHADE);                     // under-deck bulkhead
    // ===================== FLIGHT DECK ======================================
    // Two real chairs: city/cockpit.js derives the pilot's eye from them
    // (0.72 m over the cushion → 5.62, inside the windscreen band).
    const SEATY = 4.90;
    K.add(xf(bx(2.6, 0.5, 4.4), 0, 4.30, 13.3), DECKI);                                                    // deck sole
    K.add(xf(bx(2.8, 1.8, 0.2), 0, 5.45, 11.1), DECKI);                                                    // rear bulkhead
    K.add(xf(bx(1.70, 0.40, 0.09), 0, 5.17, 15.05, -0.28), GLOW);                                         // main panel
    K.add(xf(bx(1.66, 0.10, 0.32), 0, 5.43, 14.85), DECKI);                                                // glareshield
    K.add(xf(bx(0.34, 0.52, 0.72), 0, 4.93, 14.2), DECKI);                                                 // pedestal
    [-1, 1].forEach(function (s) {
      K.add(xf(bx(0.52, 0.12, 0.54), s * 0.46, SEATY - 0.06, 13.55), DECKI);
      K.add(xf(bx(0.52, 0.86, 0.11), s * 0.46, SEATY + 0.38, 13.24, -0.12), DECKI);
    });
    B.ud.cabin = { seats: [
      { id: "seat-captain", role: "pilot", cockpit: true, x: 0.46, y: SEATY, z: 13.55 },
      { id: "seat-firstofficer", role: "copilot", cockpit: true, x: -0.46, y: SEATY, z: 13.55 },
    ] };
    // crew door, port (+X) side forward
    K.add(xf(bx(0.08, 2.0, 0.95), 2.74, 2.4, 9.6), SHADE);
    // ===================== HIGH WING + FAIRING ==============================
    const WK = [{ x: 0, le: 3.6, te: -2.4, tc: 0.15, y: 6.25 }, { x: 2.9, le: 3.4, te: -2.35, tc: 0.15, y: 6.28 }, { x: 21.2, le: -1.4, te: -3.9, tc: 0.11, y: 6.85 }];
    const W = wingG([K$.planAt(WK, 0), K$.planAt(WK, 2.9), K$.planAt(WK, 21.2)], { K: 7 });
    K.add([W, mir(W)], HULL);
    K.add(loft([S(5.8, 6.0, 0.3, 0.2, 0.2), S(4.6, 6.05, 1.8, 0.55, 0.3, 2.6), S(-3.2, 6.05, 1.8, 0.5, 0.3, 2.6), S(-5.0, 6.0, 0.4, 0.2, 0.2)], { n: 20 }), SHADE);
    // ===================== FOUR TURBOPROPS ==================================
    const ENG = [[6.6, 5.95, 7.4, -2.2], [12.2, 6.2, 5.9, -2.9]];
    let pi = 0;
    ENG.forEach(function (e) {
      const x = e[0], y = e[1], zf = e[2], za = e[3];
      const nac = loft([S(zf, y, 0.55, 0.55, 0.62, 2, 2), S(zf - 1.0, y, 0.68, 0.7, 0.95, 2.2, 2.6), S(zf - 4.2, y + 0.05, 0.66, 0.72, 0.9, 2.2, 2.6), S(za + 1.2, y + 0.2, 0.46, 0.45, 0.55, 2.2, 2.2), S(za, y + 0.3, 0.12, 0.12, 0.12)].map(function (s) { s.x = x; return s; }), { n: 18 });
      K.add([nac, mir(nac)], PANEL);
      const inl = xf(new THREE.CircleGeometry(0.28, 10), x, y - 0.6, zf - 0.5);
      K.add([inl, mir(inl)], GUN);
      [1, -1].forEach(function (s) {
        const prop = B.node("prop" + pi, s * x, y, zf + 0.25); B.ud.milAir.props.push("prop" + pi); pi++;
        const PK = B.kit(prop);
        PK.add(loft([K$.rnd(zf + 1.35, 0.03, y, s * x), K$.rnd(zf + 0.9, 0.36, y, s * x), K$.rnd(zf + 0.1, 0.55, y, s * x)], { n: 14 }), SHADE);  // spinner
        for (let b = 0; b < 8; b++) {
          const bl = xf(wingG([{ x: 0.45, le: 0.2, c: 0.42, tc: 0.12 }, { x: 1.8, le: 0.16, c: 0.4, tc: 0.08 }, { x: 2.65, le: -0.18, c: 0.2, tc: 0.07 }], { K: 3 }), 0, 0, 0, 1.2);
          PK.add(xf(bl, s * x, y, zf + 0.25, 0, 0, b * Math.PI / 4 + (s > 0 ? 0 : Math.PI / 8)), BLADE);
        }
      });
    });
    // ===================== T-TAIL ===========================================
    K.add(xf(wingG([{ x: 0, le: -15.2, c: 7.0, tc: 0.12 }, { x: 7.45, le: -19.6, c: 3.4, tc: 0.10 }], { K: 6 }), 0, 5.9, 0, 0, 0, Math.PI / 2), PANEL);
    const TP = wingG([{ x: 0.2, le: -19.4, c: 3.7, tc: 0.10, y: 13.35 }, { x: 9.75, le: -21.4, c: 1.8, tc: 0.09, y: 13.5 }], { K: 5 });
    K.add([TP, mir(TP)], PANEL);
    K.add(loft([S(-18.6, 13.35, 0.05, 0.05, 0.05), S(-19.3, 13.36, 0.42, 0.4, 0.34), S(-22.6, 13.36, 0.42, 0.4, 0.34), S(-23.9, 13.36, 0.06, 0.06, 0.06)], { n: 14 }), SHADE);
    // ===================== GEAR — sponsons + nose leg =======================
    [-1, 1].forEach(function (s) {
      K.add(loft([S(5.4, 1.55, 0.12, 0.12, 0.12), S(4.4, 1.6, 0.8, 1.0, 0.8, 2.6, 3.2), S(-1.8, 1.6, 0.8, 1.0, 0.8, 2.6, 3.2), S(-3.0, 1.6, 0.12, 0.12, 0.12)].map(function (q) { q.x = s * 2.95; return q; }), { n: 16 }), HULL);
      [-0.9, 1.2, 3.3].forEach(function (wz) {
        [3.42, 2.68].forEach(function (wx) {
          const w = K$.wheel(0.70, 0.36);
          K.add(xf(w.tire, s * wx, 0.70, wz), RUBBER).add(xf(w.hub, s * wx, 0.70, wz), STEELD);
        });
      });
    });
    K.add(K$.rod([0, 1.4, 13.2], [0, 0.55, 13.25], 0.12), STEELD).add(K$.rod([0, 1.35, 12.2], [0, 0.7, 13.2], 0.07), STEELD);
    [-1, 1].forEach(function (s) { const w = K$.wheel(0.55, 0.3); K.add(xf(w.tire, s * 0.3, 0.55, 13.25), RUBBER).add(xf(w.hub, s * 0.3, 0.55, 13.25), STEELD); });
    // ===================== THE RAMP =========================================
    // Hinged at the deck sill; built lying flat aft (rotation.x 0 =
    // horizontal) and stowed upright by the hold on declaration.
    const ramp = B.node("cargoRamp", 0, DY, Z0); B.refs.cargoRamp = "cargoRamp";
    const RK = B.kit(ramp);
    const RL = CARGO.rampLen, RW = CARGO.rampW;
    RK.add(xf(bx(RW, 0.20, RL), 0, DY - 0.10, Z0 - RL / 2), DECKM);
    RK.add(xf(bx(0.30, 0.02, RL - 0.3), 0, DY + 0.02, Z0 - RL / 2), WARN);
    [-1, 1].forEach(function (s) {
      RK.add(xf(bx(0.16, 0.10, RL - 0.2), s * (RW / 2 - 0.14), DY + 0.06, Z0 - RL / 2), STEELD);
      RK.add(xf(bx(0.08, 0.36, RL - 0.6), s * (RW / 2 + 0.03), DY + 0.14, Z0 - RL / 2), SHADE);
      for (let i = 0; i < 4; i++) RK.add(xf(bx(0.14, 0.20, 0.80), s * 0.85, DY - 0.24, Z0 - 0.6 - i * 0.90), SHADE);
    });
    for (let i = 0; i < 6; i++) RK.add(xf(bx(RW - 0.5, 0.02, 0.20), 0, DY + 0.015, Z0 - 0.42 - i * 0.60), cm(0x3f454c));
    RK.add(xf(bx(RW - 0.2, 0.10, 0.30), 0, DY - 0.13, Z0 - RL - 0.12), STEELD);
    K$.navLights(B, [[21.2, 6.85, -2.2, 0xff4a3d], [-21.2, 6.85, -2.2, 0x37d67a], [0, 5.85, -23.35, 0xf2f4ff], [0, 6.15, 15.4, 0xf2f4ff]]);
    B.finish({ family: "A400M-class", length: 43.5, span: 42.4, height: 13.9 });
    // the ramp is posed per placement, so it is stowed on the template
    ramp.rotation.x = CARGO.rampClosedRx;
    return B;
  });
  function makeCargoPlane() {
    const r = CBZ.milAir.make("cargo");
    r.ramp = r.group.userData.cargoRamp;
    return r;
  }

  // ---- PLACE ONE, AND DECLARE ITS HOLD ------------------------------------
  // Deliberately NOT placeModel(): that pushes one full-footprint world AABB,
  // and a solid rectangle over the whole aeroplane is precisely the wall that
  // stops a tank driving up the ramp. This airframe's solidity comes from the
  // HOLD RIG instead (LOCAL walls on systems/platforms_moving.js), which is the
  // strictly better answer anyway — a static AABB is a lie the moment the
  // aeroplane turns, and this one is meant to fly with people inside it.
  // (The one case that DOES get a world AABB is the flag-off path at the
  // bottom of this function, where there is no rig to be solid with.)
  function placeCargoPlane(root, wx, wz, rotY, name) {
    const made = makeCargoPlane();
    made.group.position.set(wx, 0, wz);
    made.group.rotation.y = rotY || 0;
    made.group.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    root.add(made.group);
    made.group.userData.milKind = "plane";
    made.group.userData.milName = name || "Cargo Lifter";
    made.group.userData.dynamic = true;
    made.group.userData.aircraftDims = made.aircraftDims;
    const rec = {
      group: made.group, pos: made.group.position, heading: rotY || 0,
      kind: "plane", model: { name: name || "Cargo Lifter" },
      collider: null,                       // see the note above — the rig owns it
      modelYawOffset: 0, groundOffset: 0,
      aircraftDims: made.aircraftDims,
      footW: made.footW, footL: made.footL, taken: false, hot: true,
      cargoLifter: true,
      // it flies like the heavy it is, and it carries no missiles — a freighter
      // with air-to-air rails would be the "military = fighter" assumption the
      // whole airframe exists to break (playeraircraft.js honours both fields)
      airClass: "airliner", armed: false,
    };
    placed.push(rec);

    // ---- ONE CALL. This is the whole adoption. --------------------------
    if (CBZ.vehicleHold) {
      const Z0 = CARGO.holdZ0, Z1 = CARGO.holdZ1, DY = CARGO.deckY, RY = CARGO.roofY, HW = CARGO.halfW;
      const midZ = (Z0 + Z1) / 2, len = Z1 - Z0;
      rec.hold = CBZ.vehicleHold(rec, {
        id: "cargo-lifter-" + placed.length,
        label: "Cargo hold",
        scale: 1,
        floor: { x: 0, z: midZ, w: HW * 2, d: len, top: DY },
        roof: RY,
        walls: [
          { x: -(HW + 0.2), z: midZ, w: 0.45, d: len, y0: 0, y1: RY + 0.6 },     // port flank
          { x: (HW + 0.2), z: midZ, w: 0.45, d: len, y0: 0, y1: RY + 0.6 },      // starboard flank
          { x: 0, z: Z1 + 0.2, w: HW * 2 + 0.9, d: 0.5, y0: 0, y1: RY + 0.6 },   // forward bulkhead
          { x: 0, z: 12.0, w: 5.2, d: 9.0, y0: 0, y1: 6.6 },                     // forward fuselage
          { x: -3.05, z: 1.2, w: 1.3, d: 7.4, y0: 0, y1: 2.6 },                  // gear sponsons
          { x: 3.05, z: 1.2, w: 1.3, d: 7.4, y0: 0, y1: 2.6 },
          /* NO WALL FOR THE UPSWEPT TAIL, and this is a measured decision, not
             an omission. A y-gated box at y0 4.7 over the ramp mouth is free
             for a pedestrian (standing on the 1.35 m deck your head is at 3.15
             — you can never touch it) and it is a SEALED DOOR for a tank:
             systems/physics.js collide() documents that a caller omitting
             feetY/headY gets every collider at FULL HEIGHT, and vehicles.js's
             cityCollideVehicle omits both. Measured with the wall in: the tank
             stopped dead 7 m short of the ramp toe at full throttle. */
        ],
        ramp: {
          node: made.ramp, w: CARGO.rampW, len: CARGO.rampLen, x: 0,
          sillZ: Z0, sillTop: DY, dir: -1,
          closedRx: CARGO.rampClosedRx, openRx: CARGO.rampOpenRx, seconds: 3.0,
        },
      });
    }
    // FLAG OFF (or the hold block absent) = NO RIG, and therefore no walls at
    // all — a 37-metre aeroplane you can walk straight through, which is a
    // worse revert than the feature is a risk. So the degraded path buys back
    // a conventional world AABB: the FUSELAGE box only, never the 42 m span,
    // so it is solid where the aeroplane is and you can still walk under the
    // wings. It carries on `rec.collider`, the field the theft path already
    // detaches, exactly as placeModel's does.
    if (!rec.hold || rec.hold.inert) {
      const sideways = Math.abs(Math.sin(rotY || 0)) > 0.5;
      rec.collider = col(wx, wz, sideways ? made.footL : 5.4, sideways ? 5.4 : made.footL,
                         0, made.height != null ? made.height : 13.4, made.group);
    }
    return rec;
  }

  // GROUND ARMOR lives in city/mil_armor.js (real-dimension plate-lofted
  // hulls, instanced running gear, turret/gun/launcher rigs). These are the
  // names the base, CBZ.milModels, world/airbase.js and the warlord wrecks
  // already call, so they stay — as one line each.
  function armor(kind, opts) { return CBZ.milArmor[kind](opts); }
  function makeTank() { return armor("tank"); }
  function makeTruck(opts) { return armor("truck", opts); }
  function makePatriot() { return armor("patriot"); }
  function makeIFV() { return armor("ifv"); }
  function makeAPC() { return armor("apc"); }
  function makeLUV() { return armor("luv"); }
  function makeMLRS() { return armor("mlrs"); }

  // ========================================================================
  //   PERIMETER FENCE — InstancedMesh posts (the draw-call-frugal repeat)
  //   plus full-height world colliders forming a sealed wall, with a GAP
  //   at the east causeway gate.
  // ========================================================================
  function buildFence(root) {
    const SPAN = 4;                                       // metres between posts
    // gate gap on the EAST edge, centred on the causeway lane (widened to the
    // 24m highway deck so the road actually passes through).
    const gateMin = CW_CZ - 13, gateMax = CW_CZ + 13;
    const segs = [];                                      // {a:{x,z}, b:{x,z}, skip?}
    // four edges as point pairs
    const edges = [
      [{ x: MINX, z: MINZ }, { x: MAXX, z: MINZ }],       // north (-Z)
      [{ x: MAXX, z: MINZ }, { x: MAXX, z: MAXZ }],       // east (+X) — has the gate
      [{ x: MAXX, z: MAXZ }, { x: MINX, z: MAXZ }],       // south (+Z)
      [{ x: MINX, z: MAXZ }, { x: MINX, z: MINZ }],       // west (-X)
    ];
    // PEDESTRIAN water-access gaps on the three SEAWARD edges (N/S/W). ~3m wide
    // — wider than the 0.55 player radius so you can WALK through to the sea
    // (swim.js auto-engages past the shore), narrower than a car so NPC cars
    // (pinned by clampToCity) can't drive into the ocean. The causeway side
    // (east) keeps its full fence + checkpoint gate untouched.
    const PG = 3;                              // pedestrian gap half-span ≈1.5m
    // gap centres along each seaward edge (mid-edge)
    const gapCN = CEN_X;                       // north/south gap at x = base centre
    const gapCW = CEN_Z;                       // west gap at z = base centre
    /* ONE WALL RUN, MINUS WHATEVER CARRIAGEWAYS CROSS IT. The authored gate
       above is kept as the degrade path; this is what makes the perimeter
       correct for every OTHER road that reaches the reservation, without this
       file holding a second copy of any road's position. Called from a
       roadGapAfterRoads step (see the builder), so the road list is complete. */
    function wallCol(x0, z0, x1, z1) {
      const pieces = CBZ.roadGapRun
        ? CBZ.roadGapRun(x0, z0, x1, z1, { id: "military:perimeter", thick: 0.4 })
        : [{ x0: x0, z0: z0, x1: x1, z1: z1 }];
      for (let i = 0; i < pieces.length; i++) {
        const s = pieces[i];
        const w = Math.abs(s.x1 - s.x0), d = Math.abs(s.z1 - s.z0);
        if (Math.max(w, d) < 0.5) continue;
        col((s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2, w < 0.4 ? 0.4 : w, d < 0.4 ? 0.4 : d, 0, 2.4);
      }
    }
    // collect post positions + build collider wall segments
    const posts = [];
    edges.forEach(function (e, ei) {
      const a = e[0], b = e[1];
      const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz);
      const n = Math.max(1, Math.round(L / SPAN));
      const ux = dx / L, uz = dz / L;
      const horiz = Math.abs(dx) > Math.abs(dz);
      for (let i = 0; i <= n; i++) {
        const px = a.x + ux * (L * i / n), pz = a.z + uz * (L * i / n);
        // east edge: skip posts inside the gate gap
        if (ei === 1 && pz > gateMin && pz < gateMax) continue;
        // seaward edges: skip posts inside the pedestrian water-access gap
        if (ei !== 1 && horiz && px > gapCN - PG && px < gapCN + PG) continue;   // N/S (along X)
        if (ei !== 1 && !horiz && pz > gapCW - PG && pz < gapCW + PG) continue;  // W (along Z)
        // …and inside any CARRIAGEWAY. A post you drive through is the same bug
        // as a collider you cannot: both are the fence not knowing the road.
        if (CBZ.roadGapAt && CBZ.roadGapAt(px, pz, 0)) continue;
        posts.push({ x: px, z: pz });
      }
      // collider wall: each edge splits around its gap AND around every road
      if (ei === 1) {
        // east: wall from north corner down to gate, and gate to south corner
        wallCol(MAXX, MINZ, MAXX, gateMin);
        wallCol(MAXX, gateMax, MAXX, MAXZ);
      } else if (horiz) {
        // N/S: split around the centre water-access gap (along X)
        const z = a.z;
        wallCol(MINX, z, gapCN - PG, z);
        wallCol(gapCN + PG, z, MAXX, z);
      } else {
        // W: split around the centre water-access gap (along Z)
        const x = a.x;
        wallCol(x, MINZ, x, gapCW - PG);
        wallCol(x, gapCW + PG, x, MAXZ);
      }
    });
    // decorative sand/ramp APRONS (no collider) at each seaward gap → slipway.
    (function aprons() {
      function apron(x, z, w, d) {
        const m = new THREE.Mesh(bg(w, 0.06, d), cm(M.sand));
        m.position.set(x, 0.03, z); m.receiveShadow = true; m.castShadow = false; root.add(m);
      }
      apron(gapCN, MINZ - 4, PG * 2 + 2, 10);   // north slipway
      apron(gapCN, MAXZ + 4, PG * 2 + 2, 10);   // south slipway
      apron(MINX - 4, gapCW, 10, PG * 2 + 2);   // west slipway
    })();
    // INSTANCED chain-link posts (one draw call for all of them)
    const postGeo = bg(0.18, 2.3, 0.18);
    const im = new THREE.InstancedMesh(postGeo, cm(M.fenceP), posts.length);
    im.castShadow = true; im.receiveShadow = true;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < posts.length; i++) {
      dummy.position.set(posts[i].x, 1.15, posts[i].z);
      dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix);
    }
    im.instanceMatrix.needsUpdate = true;
    root.add(im);
    // a thin translucent "mesh" band between posts so it reads as chain-link,
    // not floating poles: one merged thin box per edge (cheap, 3 meshes).
    // the fabric follows the SAME split as the posts and the colliders — three
    // descriptions of one object, so they go through one law (the lampMast /
    // ATTACH rule: two constants describing one thing must never be typed apart)
    function linkRun(x0, z0, x1, z1) {
      const pieces = CBZ.roadGapRun
        ? CBZ.roadGapRun(x0, z0, x1, z1, { id: "military:perimeter", thick: 0.4 })
        : [{ x0: x0, z0: z0, x1: x1, z1: z1 }];
      for (let i = 0; i < pieces.length; i++) {
        const s = pieces[i];
        const w = Math.abs(s.x1 - s.x0), d = Math.abs(s.z1 - s.z0);
        if (Math.max(w, d) < 0.5) continue;
        mkLink(root, (s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2, w < 0.06 ? 0.06 : w, d < 0.06 ? 0.06 : d);
      }
    }
    edges.forEach(function (e, ei) {
      const a = e[0], b = e[1];
      const dx = b.x - a.x, dz = b.z - a.z;
      const horiz = Math.abs(dx) > Math.abs(dz);
      if (ei === 1) {                                     // east split for the gate
        linkRun(MAXX, MINZ, MAXX, gateMin);
        linkRun(MAXX, gateMax, MAXX, MAXZ);
      } else if (horiz) {                                 // N/S split for the water gap
        const z = a.z;
        linkRun(MINX, z, gapCN - PG, z);
        linkRun(gapCN + PG, z, MAXX, z);
      } else {                                            // W split for the water gap
        const x = a.x;
        linkRun(x, MINZ, x, gapCW - PG);
        linkRun(x, gapCW + PG, x, MAXZ);
      }
    });
  }
  // the fabric is real chain-link now (world/basekit.js: one alpha-tested
  // diamond-mesh material for every base fence), under a steel top rail. It
  // was a 25%-opaque grey slab, which read as fog standing on a line.
  function mkLink(root, cx, cz, w, d) {
    if (CBZ.baseKit && CBZ.baseKit.chainLink) {
      const along = w >= d;
      CBZ.baseKit.chainLink(root, along ? cx - w / 2 : cx, along ? cz : cz - d / 2, along ? cx + w / 2 : cx, along ? cz : cz + d / 2, 2.05, 0.1);
      box(root, cx, 2.2, cz, along ? w : 0.06, 0.06, along ? 0.06 : d, M.fenceP, { cast: false });
      return;
    }
    const m = new THREE.Mesh(bg(w, 1.9, d), new THREE.MeshLambertMaterial({ color: M.fence, transparent: true, opacity: 0.25 }));
    m.position.set(cx, 1.1, cz); m.castShadow = false; m.receiveShadow = false; root.add(m);
  }

  // ========================================================================
  //   CAUSEWAY — drivable bridge deck + curb colliders + the gate.
  // ========================================================================
  function buildCauseway(root) {
    const w = CW_MAXX - CW_MINX, cx = (CW_MINX + CW_MAXX) / 2;
    // REAL HIGHWAY: a wide multi-lane causeway from the mainland west edge to
    // the base gate (merged deck + baked lanes + instanced guardrails/lights +
    // continuous curb colliders). Falls back to the old bespoke deck if absent.
    if (CBZ.buildHighway) {
      CBZ.buildHighway(root, {
        path: [{ x: CW_MINX, z: CW_CZ }, { x: CW_MAXX, z: CW_CZ }],
        width: 24, lanesPerDir: 3, median: true, medianW: 1.2, laneW: 3.6, theme: "asphalt",
        guardrail: false, elevated: false, rng: rng,
      });
    } else {
      // ---- fallback: bespoke narrow deck (only if buildHighway absent) ----
      const deck = new THREE.Mesh(bg(w, 0.2, CW_MAXZ - CW_MINZ + 0.5), cm(M.tarmac));
      deck.position.set(cx, 0.0, CW_CZ); deck.receiveShadow = true; deck.castShadow = false; root.add(deck);
      // curbs (low walls each side) — visual + collider so you can't drive off
      [CW_MINZ - 0.1, CW_MAXZ + 0.1].forEach(function (z) {
        box(root, cx, 0.35, z, w, 0.7, 0.5, M.steelD);
        col(cx, z, w, 0.5, 0, 0.7);
      });
      // support pylons under the deck (visual depth; the sea is at y=-0.5)
      for (let i = 0; i <= 6; i++) {
        const px = CW_MINX + (w) * i / 6;
        [CW_MINZ, CW_MAXZ].forEach(function (z) { cyl(root, px, -0.8, z, 0.5, 0.6, 1.6, M.steelD, 8); });
      }
    }

    // ---- THE CHECKPOINT, at the gate in the wire (the plan's gate) ----
    // The guardhouse, the overwatch tower and the HESCO wing walls are the
    // plan's (world/basekit.js). What is drawn here is the barrier itself:
    // a short striped arm per carriageway pivoting at the kerb, parked RAISED
    // (the base is open to traffic), the pivot posts the only colliders.
    // (THE FLOATING-YELLOW-LINE FIX stays fixed: the arm is sized by the
    // carriageway, never by the causeway's length.)
    const gx = MAXX - 4;
    const ARM_L = 9.5, ARM_A = 1.15;            // arm length / raised angle (rad)
    function boom(px, pz, dirX, dirZ) {
      const g = new THREE.Group();
      g.position.set(px, 0, pz);
      g.rotation.y = Math.atan2(dirX, dirZ);
      root.add(g);
      cyl(g, 0, 0.7, 0, 0.16, 0.2, 1.4, M.red, 8);                 // pivot post
      box(g, 0, 1.05, -0.35, 0.5, 0.7, 0.5, M.steelD);               // counterweight housing
      const arm = box(g, 0, 0.9 + Math.sin(ARM_A) * ARM_L / 2, Math.cos(ARM_A) * ARM_L / 2, 0.16, 0.16, ARM_L, M.warn);
      arm.rotation.x = -ARM_A;                    // +z end raised
      col(px, pz, 0.5, 0.5, 0, 1.4);
    }
    boom(gx, CW_CZ - 10.8, 0, 1);
    boom(gx, CW_CZ + 10.8, 0, -1);
    if (PLAN && PLAN.anchors.northGate) boom(CEN_X + PLAN.anchors.northGate.x + 7.6, CEN_Z - PLAN.hz + 4, -1, 0);
    return { gx: gx };
  }

  // ========================================================================
  //   PARADE GROUND FORMATION — reusable REAL-ACTOR anchors.
  //   Identity/build belongs to npcLife + cityMakePed; this function expresses
  //   only where a formation member stands. The old InstancedMesh silhouettes
  //   looked human but could not react, fight, die, or leave their post.
  // ========================================================================
  function paradeFormation(cx, cz) {
    const ROWS = 4, COLS = 8, GAP = 1.6;
    const anchors = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      anchors.push({
        x: cx - (COLS - 1) * GAP / 2 + c * GAP,
        z: cz - (ROWS - 1) * GAP / 2 + r * GAP,
        yaw: 0, row: r, column: c,
      });
    }
    return anchors;
  }

  // ========================================================================
  //   STATIC HARDWARE PLACEMENT — drop a model, register a solid collider.
  // ========================================================================
  // module-local capture of every BOARDABLE machine placed on the base, so we can
  // hand them to militaryvehicles.js as stealable vehicles. _reg guards the
  // one-shot deferred registration (the islands load BEFORE militaryvehicles.js).
  const placed = [];
  let _reg = false;

  // kind/name (optional) tag a placed group as a boardable military vehicle:
  //   kind 'tank' | 'heli' | 'plane' | 'ground' (the militaryvehicles.js taxonomy)
  function placeModel(root, modelFn, wx, wz, rotY, footScale, kind, name) {
    const made = modelFn();
    made.group.position.set(wx, 0, wz);
    made.group.rotation.y = rotY || 0;
    made.group.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    root.add(made.group);
    // collider: rotate the footprint roughly by snapping to nearest axis.
    // Height is PER MODEL (each maker measures itself): the old flat y1=3.0
    // let you jump straight through the bomber's ~7m tail fin.
    const fw = made.footW * (footScale || 1), fl = made.footL * (footScale || 1);
    // a rotor disc or a glider wing is not a wall: airframes publish the
    // solid body they actually have (colliderW/L); footW stays the true span
    const bw = (made.colliderW || made.footW) * (footScale || 1), bl = (made.colliderL || made.footL) * (footScale || 1);
    const sideways = Math.abs(Math.sin(rotY || 0)) > 0.5;
    const cw = sideways ? bl : bw, cd = sideways ? bw : bl;
    const solid = col(wx, wz, cw, cd, 0, made.height != null ? made.height : 3.0, made.group);
    if (kind) {
      made.group.userData.milKind = kind;
      made.group.userData.milName = name || kind;
      // Parked hardware can become a live, moving machine under a named pilot.
      // Keep the authored group out of the static world merger so dispatch can
      // move THIS helicopter/tank instead of spawning a visual copy.
      made.group.userData.dynamic = true;
      if (made.aircraftDims) made.group.userData.aircraftDims = made.aircraftDims;
      placed.push({
        group: made.group, pos: made.group.position, heading: rotY || 0,
        kind: kind, model: { name: name || kind },
        // the parked collider rides on the record so STEALING the machine can
        // remove it (militaryvehicles/playeraircraft detach it via the shared
        // rec._colliderDetached protocol; without this an invisible solid
        // block haunted the empty slot forever). Same field the airport uses.
        collider: solid,
        // flight-model hints for playeraircraft's fly-the-actual-prop path:
        // these models face +Z = flight forward (no yaw offset) and park on
        // their gear/tracks at y=0 (no ground offset).
        modelYawOffset: 0, groundOffset: 0,
        aircraftDims: made.aircraftDims || null,
        footW: fw, footL: fl, taken: false, hot: true,
      });
    }
    return made.group;
  }

  /* ========================================================================
     THE HARDWARE, PUBLISHED.

     Everything above this line is a MODEL FACTORY: makeJet, makeBomber,
     makeCargoPlane, makeHeli, makeTank, makeTruck each return a THREE.Group
     (nose +Z, standing on its wheels at y=0) and know nothing about Fort
     Brandt. Everything BELOW it is the base — the placement, the landmass
     registration, the causeway, the militia. Only the second half needs the
     city; the first half never did.

     Until now there was no way to say so. Anything that wanted a fighter
     jet had to boot the entire archipelago to get one, which is why a
     slice page ended up modelling its own — the hardware was in here, and
     in here was unreachable. These four lines are the whole fix, and they
     cost the shipped game nothing: the base below still calls the same
     local functions it always did.

     `world/airbase.js` asks for CBZ.milModels FIRST and only falls back to
     its own primitives when this file is absent. So loading this file is
     what upgrades every standalone page to the real hardware.
  ======================================================================== */
  CBZ.milModels = {
    jet: makeJet,
    bomber: makeBomber,
    cargo: makeCargoPlane,
    heli: makeHeli,
    attackHeli: makeAttackHeli,
    drone: makeDrone,
    tank: makeTank,
    truck: makeTruck,
    patriot: makePatriot,
    ifv: makeIFV,
    apc: makeAPC,
    luv: makeLUV,
    mlrs: makeMLRS,
  };

  // ========================================================================
  //   MAIN BUILDER
  // ========================================================================
  // GUARDED, because a page may want the hardware without the archipelago.
  // Every other island in the repo that can be loaded piecemeal already
  // guards this the same way (marina.js, snowboard.js, bank.js, captain.js);
  // unguarded, a missing addLandmass throws at LOAD and takes the model
  // factories above down with it — the module is lost for the sake of a
  // registration nobody asked for.
  if (CBZ.addLandmass) CBZ.addLandmass(function (city) {
    const root = city.root || (CBZ.scene);

    // a city rebuild re-runs this whole builder → fresh prop groups. Clear the
    // boardable capture + the one-shot guard so the rebuilt hardware re-registers
    // (the militaryvehicles.js registry was cleared by its reset chain).
    placed.length = 0; _reg = false;

    /* THE PERIMETER IS SOLVED AGAINST THE ROAD NETWORK, SO IT WAITS FOR IT.
       buildFence's gate used to be a pair of typed numbers (CW_CZ ± 13, "widened
       to the 24 m highway deck so the road actually passes through") — a hole
       hand-measured in this file against a road record this file does not push
       until 350 lines later, and it is the ONLY hole. Any other road that ever
       reaches this reservation meets 2.4 m of sealed collider wall. The shared
       law in city/roadrules.js already knows where every carriageway in the
       world is; it just cannot know it at order 22, which is why this whole
       build step is handed to roadGapAfterRoads and runs at 98.6 instead. The
       authored gate stays as the degrade path. */
    if (!(CBZ.roadGapAfterRoads && CBZ.roadGapAfterRoads(function () { buildFence(root); }))) buildFence(root);
    const cw = buildCauseway(root);

    /* ======================================================================
       THE BASE, LAID OUT. world/basekit.js plans it (the one base planner:
       world/airbase.js asks the same one) and raises every structure: the
       painted airfield, hardened shelters, arched hangars, the tower, the
       bunded fuel farm, the motor-pool sheds, HESCO revetments and walls,
       the igloos, the range, the watchtowers. This file places the MACHINES
       on the plan's stands (they are stealable, so they are ours to register)
       and wires the things only Fort Brandt has: the armory, the troops, the
       garrison anchors.

       WHAT IT WAS: fighters parked 22 m off the runway with their noses
       pointed away from it, hangars 300 m from any pavement, helicopters on
       dirt, the bomber across open ground, office-tower hangars. Every number
       below now comes from PLAN, and tools/base-plan-check.mjs proves no two
       footprints overlap and every aircraft stands on pavement.
    ====================================================================== */
    const BASE = new THREE.Group();
    BASE.name = "fort-brandt";
    BASE.position.set(CEN_X, 0, CEN_Z);
    root.add(BASE);
    const host = {
      root: BASE, y: 0, worldY: 0, axisAligned: true, ladderRoot: root,
      groundName: "military-island-surface", dirt: "#6b5d44",
      toWorld: function (lx, lz) { return { x: CEN_X + lx, z: CEN_Z + lz }; },
      solid: function (lx, lz, w, d, y0, y1) { return col(CEN_X + lx, CEN_Z + lz, w, d, y0, y1); },
      // the enterable shells (HQ, barracks, crash-rescue, ops, guardhouse) are
      // the city's own: real doors, stairs, rooms. No shell factory loaded →
      // the kit stands a plain block in its place.
      building: function (lx, lz, w, d, storeys, color, door, o) {
        if (!CBZ.cityMakeBuilding) return null;
        try {
          return CBZ.cityMakeBuilding(root, CEN_X + lx, CEN_Z + lz, w, d, storeys, color, door,
            { facade: o.facade || "office", dress: false, stairs: storeys > 1, houseNumber: 1 });
        } catch (e) { return null; }
      },
    };
    const KIT = (CBZ.baseKit && CBZ.baseKit.raise && PLAN) ? CBZ.baseKit.raise(PLAN, host) : { towers: [], hangars: [], buildings: {} };
    if (KIT.ground) {
      const gnd = KIT.ground;
      gnd.userData.terrain = true; gnd.userData.worldSurface = true;
      gnd.userData.surfaceOwner = "military"; gnd.userData.unifiedSurface = true;
    }
    const W = function (p) { return { x: CEN_X + p.x, z: CEN_Z + p.z }; };

    // ---- THE MACHINES, on their stands --------------------------------------
    const MODEL = {
      fighter: [makeJet, "plane"], drone: [makeDrone, null], bomber: [makeBomber, "plane"],
      heli: [makeHeli, "heli"], attackHeli: [makeAttackHeli, "heli"],
      tank: [makeTank, "tank"], ifv: [makeIFV, "ground"], apc: [makeAPC, "ground"], luv: [makeLUV, "ground"],
      truck: [makeTruck, "ground"], patriot: [makePatriot, "patriot"], mlrs: [makeMLRS, "mlrs"],
    };
    (PLAN ? PLAN.stands : []).forEach(function (s) {
      const w = W(s);
      if (s.kind === "b2") return;                       // city/strategic.js parks the B-2 on this stand (zoning fixture)
      if (s.kind === "cargo") { placeCargoPlane(root, w.x, w.z, s.yaw, s.name); return; }
      const m = MODEL[s.kind];
      if (!m) return;
      try {
        placeModel(root, m[0], w.x, w.z, s.yaw, 1, s.scenery ? null : m[1], s.name);
        const rec = placed[placed.length - 1];
        if (rec && rec.group && rec.pos && Math.abs(rec.pos.x - w.x) < 0.01 && Math.abs(rec.pos.z - w.z) < 0.01) {
          rec.stand = s;
          if (s.kind === "attackHeli") rec.attackHeli = true;
        }
      } catch (e) { /* a missing model must not take the base down with it */ }
    });

    // ---- THE FLAG, in front of HQ ------------------------------------------
    const hqW = PLAN ? W(PLAN.anchors.hq) : { x: CEN_X - 110, z: CEN_Z - 108 };
    const flagW = PLAN ? W(PLAN.anchors.flag) : { x: hqW.x, z: hqW.z + 22 };
    const hqX = hqW.x, hqZ = hqW.z;
    if (CBZ.flags) CBZ.flags.pole(root, { x: flagW.x, y: 0, z: flagW.z, height: 12, base: true, finial: "eagle" });

    // ARMORY ZONE: a spot just inside the HQ door where the player can browse
    // weapons. WHY a zone, not a wall-store: the engine's gunstore.js is bound
    // to a specifically-STAMPED gun-shop lot (buildings.js sets lot.building
    // .gunstore); this island's HQ isn't that lot, so we surface our own
    // interaction. If a real city gun store exists, we hand the player off to
    // it (CBZ.cityOpenShop / the gunstore wall); otherwise it's an in-world note.
    const armW = PLAN ? W(PLAN.anchors.armory) : { x: hqX, z: hqZ + 6 };
    const armoryX = armW.x, armoryZ = armW.z;           // inside, behind the door
    let armoryWired = "note";
    try {
      if (CBZ.interactions && CBZ.interactions.registerZone) {
        const tok = { x: armoryX, z: armoryZ, kind: "armory" };
        CBZ.interactions.registerZone({
          id: "military-armory", kind: "armory", radius: 4.5,
          find: function (px, pz) {
            const dx = tok.x - px, dz = tok.z - pz;
            return (dx * dx + dz * dz) < 4.5 * 4.5 ? tok : null;
          },
          options: [
            {
              id: "armory-browse", slot: "e",
              label: function () { return "Browse"; },
              onSelect: function () {
                // prefer a REAL shop if the engine exposes one
                if (typeof CBZ.cityOpenShop === "function") { CBZ.cityOpenShop("guns", tok); return; }
                if (typeof CBZ.cityOpenGunStore === "function") { CBZ.cityOpenGunStore(); return; }
                const msg = "Base armory, racked M4s, sidearms and crates. Quartermaster's out; help yourself at the city gun store.";
                if (CBZ.city && CBZ.city.note) CBZ.city.note(msg, 3.2);
              },
            },
          ],
        });
        if (CBZ.interactions.describe) {
          CBZ.interactions.describe("armory", function () {
            return { label: "Armory", note: "Weapons, ammo and gear" };
          });
        }
        armoryWired = (typeof CBZ.cityOpenShop === "function" || typeof CBZ.cityOpenGunStore === "function") ? "shop" : "note";
      }
    } catch (e) { armoryWired = "note"; }

    // ---- WATCHTOWERS: the kit stood them; the corner decks are published on
    // CBZ._militaryBase.towers (garrison.js stands the corner sentries on
    // them, and they climb the ladders to get there)
    const towers = (KIT.towers || []).filter(function (t) { return t.corner; });

    // ---- SANDBAG POSITIONS at both gates --------------------------------------
    if (CBZ.baseKit && CBZ.baseKit.sandbags && PLAN) {
      CBZ.baseKit.sandbags({ root: BASE }, host, PLAN.hx - 26, -19);
      if (PLAN.anchors.northGate) CBZ.baseKit.sandbags({ root: BASE }, host, PLAN.anchors.northGate.x - 14, -PLAN.hz + 10);
    }

    // ---- PARADE GROUND — anchors are filled by real troops below ----
    const parW = PLAN ? W(PLAN.anchors.parade) : { x: CEN_X - 110, z: CEN_Z - 46 };
    const paradeAnchors = paradeFormation(parW.x, parW.z);
    const barW = PLAN ? W(PLAN.anchors.barracks) : { x: CEN_X - 35, z: CEN_Z - 193 };
    const mpW = PLAN ? W(PLAN.anchors.motorPool) : { x: CEN_X + 140, z: CEN_Z - 56 };

    // ========================================================================
    //   TROOPS — live soldiers via cityMakePed: armed, olive patrol cap (the
    //   peds.js "soldier" job paints the cap). The city ped brain drives their
    //   roaming; because this region is registered as walkable, clampToCity
    //   keeps them inside the wire. A few are STATIONED idle at posts (gate,
    //   towers) by parking their target on the spot and idling them.
    // ========================================================================
    const troops = [], troopSpecs = [];
    CBZ.cityMilitaryPersonnel = troops;
    let troopRespawn = -1;
    function spawnTrooper(spec) {
      if (!CBZ.cityMakePed) return null;
      const opts = spec.opts || {};
      const actorOpts = Object.assign({
        job: "soldier", kind: "civilian", armed: true, weapon: "AK-47",
        aggr: 0.45, hp: 140,
      }, opts);
      const p = CBZ.npcLife
        ? CBZ.npcLife.spawnCity(spec.profile || "militarySoldier", { x: spec.x, z: spec.z, parent: root, rng: rng }, actorOpts)
        : CBZ.cityMakePed(spec.x, spec.z, rng, actorOpts);
      if (p && !CBZ.npcLife) { root.add(p.group); CBZ.cityPeds.push(p); }
      if (p) {
        p.organization = "military";
        p.organizationLoyalty = 100;
        troops.push(p);
        if (spec.setup) spec.setup(p);
      }
      return p;
    }
    function trooper(x, z, opts, profile, setup) {
      const spec = { x: x, z: z, opts: opts || {}, profile: profile || "militarySoldier", setup: setup || null };
      troopSpecs.push(spec);
      return spawnTrooper(spec);
    }
    // Every former proxy slot is now an ordinary live soldier. The formation
    // metadata controls only the post/drill; normal ped combat and damage can
    // interrupt it, after which a survivor returns to the same reusable anchor.
    let paradeCursor = 0;
    function fillParade(budget) {
      let made = 0;
      while (paradeCursor < paradeAnchors.length && made < budget) {
        const i = paradeCursor++, a = paradeAnchors[i];
        const p = trooper(a.x, a.z, { aggr: 0.35 }, "militaryDrill", function (p) {
          p.group.rotation.y = a.yaw;
          p.state = "idle"; p.pause = 2;
          p._stationed = { x: a.x, z: a.z, yaw: a.yaw };
          p._drill = { index: i, row: a.row, column: a.column, phase: (i % 8) * 0.35 };
          p.activityState = "stand";
        });
        if (!p) continue;
        made++;
      }
      return made;
    }
    fillParade(2);                       // establish the post; finish incrementally
    // GATE GUARDS — the fourth "a body is stationed here" record shape in this
    // repo (`_stationed`), and the one this file authored for itself. It now
    // ALSO declares the shared post (city/garrison.js), which is what buys the
    // three beats `_stationed` never had: he consults cityScare instead of
    // standing through a grenade, he RETURNS when it is quiet, and his post
    // names the Sergeant who ordered it — kill the guard commander and the gate
    // goes soft. `_stationed` is deliberately KEPT so the tick below (aircrew,
    // respawn, the drill salute, the 5-star sortie) is untouched; the shared
    // brain claims only the non-drill bodies, and only when it is present.
    const guardSetup = function (g) {
      g.state = "idle"; g.pause = 9e9; g._stationed = { x: g.pos.x, z: g.pos.z };
      if (CBZ.cityPostStand) {
        CBZ.cityPostStand(g, {
          x: g.pos.x, z: g.pos.z, face: Math.atan2(-1, 0), kind: "sentry",
          relaxed: true, job: "soldier", tag: "fort:gate",
          org: "army", verb: "post", alertVerb: "standto",
          home: { x: barW.x, z: barW.z },
          // THIS file's updater already owns these bodies (aircrew, respawn,
          // the sortie). `driven` keeps garrison.js's own sweep off them so the
          // brain runs exactly once, from the loop that was always here.
          driven: true,
        });
      }
    };
    // the two gate sentries stand on the plaza kerbs either side of the booms
    trooper(cw.gx - 4, CW_CZ - 12, { aggr: 0.35 }, null, guardSetup);
    trooper(cw.gx - 4, CW_CZ + 12, { aggr: 0.35 }, null, guardSetup);
    // NO-SPAWN keep-outs: the runway strip (owner's rule — nobody spawns or
    // idles on a runway, not even patrols) and the parked aircraft's ramp.
    // Registered BEFORE the patrol scatter below so cityScatterInRegion
    // already steers around them. Both straight off the plan.
    if (CBZ.registerNoSpawnZone && PLAN) {
      const ko = PLAN.keepOut, ap = PLAN.apron;
      CBZ.registerNoSpawnZone(city, {
        minX: CEN_X + ko.x0, maxX: CEN_X + ko.x1, minZ: CEN_Z + ko.z0, maxZ: CEN_Z + ko.z1,
        label: "military-runway",
      });
      CBZ.registerNoSpawnZone(city, {
        minX: CEN_X + ap.x0, maxX: CEN_X + PLAN.hx - 8, minZ: CEN_Z + ap.z0, maxZ: CEN_Z + ap.z1,
        label: "military-apron",
      });
    }
    // patrolling soldiers scattered across the base
    if (CBZ.cityScatterInRegion) {
      const reg = { kind: "rect", minX: MINX, maxX: MAXX, minZ: MINZ, maxZ: MAXZ, pad: 0 };
      const pts = CBZ.cityScatterInRegion(reg, 10, rng, 24);
      pts.forEach(function (pt) { trooper(pt.x, pt.z); });
    }

    // light patrol nudge: stationed guards drift back to their post if shoved.
    if (CBZ.onUpdate) {
      CBZ.onUpdate(38.7, function (dt) {
        const g = window.CBZ.game || window.g;
        if (g && g.mode !== "city") return;
        // clearCityPeds removes the bodies but the authored formation persists.
        // Detect that reset boundary and refill the SAME specs incrementally;
        // the updater is registered once with this landmass, so it never stacks.
        const roster = CBZ.cityPeds || [];
        let liveOwned = 0;
        for (let i = 0; i < troops.length; i++) if (roster.indexOf(troops[i]) >= 0) liveOwned++;
        if (troops.length && liveOwned === 0 && troopSpecs.length) { troops.length = 0; troopRespawn = 0; }
        if (!CBZ.citySpawnDraining && troopRespawn >= 0) {
          let budget = 2;
          while (troopRespawn < troopSpecs.length && budget-- > 0) spawnTrooper(troopSpecs[troopRespawn++]);
          if (troopRespawn >= troopSpecs.length) troopRespawn = -1;
        }
        // Finish replaying the already-authored specs before authoring the
        // remaining parade rows. Otherwise a reset during incremental build
        // lets the replay cursor chase newly appended specs and spawn each new
        // drill soldier twice.
        if (!CBZ.citySpawnDraining && troopRespawn < 0 && paradeCursor < paradeAnchors.length) fillParade(2);
        for (let i = 0; i < troops.length; i++) {
          const t = troops[i];
          if (!t || t.dead) continue;
          // AIRCREW: a soldier flying one of this base's aircraft is off the
          // parade tick. He used to be force-HIDDEN every frame, which was
          // correct while the "crew" was an invisible bookkeeping entry — but
          // aircraft.js now SEATS these bodies in the airframe (npclife anchor,
          // visible through the canopy, shootable). An attached rig owns its own
          // visibility (attach() shows it, peds.js re-applies distance LOD), so
          // hiding it here would erase the crew the owner asked for. Only an
          // UNSEATED aircrew — the legacy bookkeeping case — still hides.
          if (t._milPilot) {
            // HE IS RUNNING TO THE AIRCRAFT, NOT SITTING IN IT.
            // city/aircraft.js's AIR_CREW_BOARD beat claims a man BEFORE he has
            // crossed the apron (that is the whole point: the owner wants to
            // SEE the scramble), and the two lines below — speed 0, and hide
            // any unseated aircrew — would have made him an invisible statue
            // for the entire walk. `_milBoarding` is set only for that window
            // and cleared the moment he is in the seat or the sortie is given
            // up, after which everything here behaves exactly as it did.
            if (t._milBoarding) continue;
            t.speed = 0;
            if (!t._npcAttached) t.group.visible = false;
            else {
              // SEATED AIRCREW carry their own render LOD here, because the
              // `continue` below skips every other visibility pass they would
              // normally get — without it three character rigs draw from any
              // distance forever. 120 m is past peds.js's 95 m street cutoff on
              // purpose: these bodies are ~95 m UP, and the slant range to a
              // gunship overhead is most of that budget.
              const PL = CBZ.player;
              t.group.visible = !PL || !PL.pos ? true
                : ((t.pos.x - PL.pos.x) * (t.pos.x - PL.pos.x) +
                   (t.pos.y - (PL.pos.y || 0)) * (t.pos.y - (PL.pos.y || 0)) +
                   (t.pos.z - PL.pos.z) * (t.pos.z - PL.pos.z)) < 120 * 120;
            }
            continue;
          }
          const combat = !!(t.rage || t.npcWanted || t.state === "fight" || t.state === "flee" || t.state === "shoot");
          if (combat) { t.pause = 0; t.activityState = t.state; continue; }
          // THE BASE IS ANSWERING AN ALARM. city/fortresponse.js drives this
          // body this frame (converging on a mark, or holding a stand-to slot
          // on the wire) and it ticks at 38.72, AFTER us — so without this
          // yield we would walk him back to his parade anchor every frame and
          // he would jitter between the two orders forever. Same yield, and
          // for the same reason, as the `_post` branch below.
          if (t._fortResp) { t.pause = 0; continue; }
          if (t._stationed) {
            // THE SHARED BRAIN OWNS THE NON-DRILL POSTS. A body carrying a
            // garrison.js record gets the full stationed arc there (scare,
            // abandon, return, the order gate, combatIQ posture with a leash)
            // and this loop must not fight it for the same transform. The DRILL
            // ranks keep the branch below on purpose: the salute beat and the
            // 0.4 m parade tolerance are this file's own choreography, and
            // handing them to a generic sentry brain would delete them.
            if (t._post && !t._drill && CBZ.cityPostTick) { CBZ.cityPostTick(t, dt); continue; }
            const dx = t._stationed.x - t.pos.x, dz = t._stationed.z - t.pos.z;
            const postRadius2 = t._drill ? 0.16 : 9;
            if (dx * dx + dz * dz > postRadius2) {          // wandered/shoved off post
              if (t.target && t.target.set) t.target.set(t._stationed.x, 0, t._stationed.z);
              t.state = "walk"; t.pause = 0; t.activityState = "return-to-post";
            } else {
              t.state = "idle"; t.pause = Math.max(t.pause, 2);
              t.group.rotation.y = CBZ.lerpAngle ? CBZ.lerpAngle(t.group.rotation.y, t._stationed.yaw || 0, 0.14) : (t._stationed.yaw || 0);
              t.activityState = t._drill ? "drill" : "stand";
              // One rank at a time moves through a short inspection/salute
              // beat. The rest remain at attention; legs never run in place.
              if (t._drill && t.char && t.char.parts) {
                t._drill.phase += (dt || 0) * 0.75;
                const salute = ((t._drill.phase + t._drill.row * 0.7) % 6) < 1.2;
                const ra = t.char.parts.ra, la = t.char.parts.la;
                if (ra) { ra.rotation.x = salute ? -1.45 : 0; ra.rotation.z = salute ? -0.28 : 0; }
                if (la) { la.rotation.x = 0; la.rotation.z = 0; }
              }
            }
          }
        }

        // ================================================================
        //  THE ORDER NOBODY COULD OBEY — DELETED 2026-08-09.
        //
        //  What stood here handed up to eight riflemen `rage = playerActor`
        //  the moment the meter hit 5★, wherever the player was. MEASURED
        //  (seed 90210, 5★ pinned, live world): the base centre is 1520 m west
        //  and 480 m north of the arena centre, the nearest trooper starts
        //  1332 m from the city, and `combat_iq.posture` — the only thing
        //  steering a body in state "fight" — is LOCAL tactical positioning
        //  that explicitly nulls `ped.path`. There is no route across the sea.
        //  After twenty seconds: nine men ordered, nearest still 1086 m away,
        //  ZERO on the causeway, three grinding against the east wire, one had
        //  moved 1.1 m. After eighty seconds the gunship had flown out,
        //  orbited and come home and both fighters were on final — and not one
        //  rifleman had left the island.
        //
        //  An order that cannot be obeyed does not read as an order. It reads
        //  as stupidity, which is exactly the word the owner used.
        //
        //  city/fortresponse.js owns the answer now, and it is the honest one:
        //  trouble ON the reservation is converged on and fought; a manhunt a
        //  kilometre away puts the base on STAND-TO (the wire manned, weapons
        //  out) and lets the air response — whose crews now RUN to their
        //  airframes, city/aircraft.js AIR_CREW_BOARD — prosecute it. Getting
        //  infantry off the island needs a road convoy down the causeway; that
        //  is declared, unimplemented and named in fortresponse.js's header
        //  and in `CBZ.fortAudit().convoy`, not quietly faked here.
        //
        //  `_milResponding` is still CLEARED below, and deliberately: a body
        //  carrying it from a save, a hot-reload or an older build must be let
        //  go rather than left holding a target forever.
        // ================================================================
        const playerActor = CBZ.city && CBZ.city.playerActor;
        for (let i = 0; i < troops.length; i++) {
          const t = troops[i];
          if (!t || !t._milResponding) continue;
          t._milResponding = false;
          if (t.rage === playerActor) t.rage = null;
          if (t.targetActor === playerActor) t.targetActor = null;
          if (!t.dead) { t.state = t._stationed ? "walk" : "idle"; t.pause = 0; }
        }
      });
    }

    // ========================================================================
    //   WORK-ANCHOR — the soldier's beat: the gate + a patrol ring of posts
    //   (the checkpoint, the HQ flag, the motor pool, a tower corner). The
    //   aigoals brain walks soldiers this ring on the same schedule/nav. WHY:
    //   a base is GUARDED — the soldier's job is to walk the wire. Barracks =
    //   home. Reuses coords already built; no new geometry.
    // ========================================================================
    if (CBZ.registerWorkAnchor) {
      CBZ.registerWorkAnchor({
        biome: "military", kind: "armory", role: "soldier", patrol: true,
        x: cw.gx - 8, z: CW_CZ, cap: 8,
        home: { x: barW.x, z: barW.z },                     // the barracks street
        spots: [
          { x: cw.gx - 8, z: CW_CZ - 12 },                  // the checkpoint gate
          { x: flagW.x + 6, z: flagW.z },                   // the HQ flagpole
          { x: mpW.x, z: mpW.z },                           // the motor pool
          { x: MINX + 24, z: MAXZ - 24 },                   // a watchtower corner
        ],
      });
    }

    // ========================================================================
    //   REGISTER THE WALKABLE REGIONS (archipelago contract)
    // ========================================================================
    CBZ.registerCityRegion(city, {
      name: "Fort Brandt", subtitle: "Military Reservation", biome: "military", kind: "rect",
      minX: MINX, maxX: MAXX, minZ: MINZ, maxZ: MAXZ, pad: 6,
    });
    CBZ.registerCityRegion(city, {
      name: "Brandt Bridge", subtitle: "Military Reservation", kind: "rect",
      minX: CW_MINX, maxX: CW_MAXX, minZ: CW_MINZ, maxZ: CW_MAXZ, pad: 1,
    });
    // give traffic a road across the causeway (runs along X → not vertical)
    if (city.roads) {
      city.roads.push({ x: (CW_MINX + CW_MAXX) / 2, z: CW_CZ, vertical: false, len: CW_MAXX - CW_MINX, district: "highway", w: 24, lanesPerDir: 3, laneW: 3.6, median: true, medianW: 1.2 });
    }

    // ========================================================================
    //   MAKE THE HARDWARE STEALABLE — register every parked tank / heli / jet /
    //   bomber / truck as a boardable so the player can climb in and TAKE it (the
    //   #1 law: a machine you can only walk around is a dead prop). militaryvehicles
    //   .js loads AFTER this island, so DEFER the hand-off one tick (onUpdate 55.1,
    //   after worldgen) and run it ONCE. Feature-detected: no module → the props
    //   are still solid scenery, nothing throws.
    // ========================================================================
    if (CBZ.onUpdate) {
      CBZ.onUpdate(55.1, function () {
        if (_reg) return;
        if (!CBZ.cityRegisterMilitaryVehicle) return;
        placed.forEach(function (p) { CBZ.cityRegisterMilitaryVehicle(p); });
        _reg = true;
      });
    }

    // expose a tiny debug handle (no UI, no hidden stats — just a console aid)
    // PUBLISH THE ANCHORS, DO NOT MAKE ANYBODY RE-TYPE THEM. city/garrison.js
    // stands sentries on this base and every one of these coordinates is
    // already a real thing this file drew — the gate it fenced, the flagpole it
    // raised, the barracks row it named as the soldiers' home, the motor pool
    // its own work-anchor ring walks. Copying those literals into a second file
    // is the copy-rect disease CLAUDE.md keeps catching (terrain_overhaul's
    // snowSector, biome_farmland's DESERT_MINZ), and it is how a base move
    // silently leaves sentries standing in a field. One object, derived here,
    // where the numbers live.
    const RWY = PLAN ? PLAN.runway : { x: 0, z: HZ - 65, len: 2 * HX - 60, w: 30 };
    CBZ._militaryBase = {
      center: { x: CEN_X, z: CEN_Z }, minX: MINX, maxX: MAXX, minZ: MINZ, maxZ: MAXZ,
      armoryWired: armoryWired, boardable: placed.length,
      gate: { x: cw.gx + 2, z: CW_CZ },
      hq: { x: hqX, z: hqZ },
      flag: { x: flagW.x, z: flagW.z },
      armory: { x: armoryX, z: armoryZ },
      motorPool: { x: mpW.x, z: mpW.z },
      parade: { x: parW.x, z: parW.z },
      barracks: { x: barW.x, z: barW.z },
      runway: { x: CEN_X + RWY.x, z: CEN_Z + RWY.z, len: RWY.len, w: RWY.w },
      towers: towers,
      // THE PLAN ITSELF, local (centre 0,0): games/military.js builds its
      // night-job props on plan.sites, so it never lands on a hangar again
      plan: PLAN,
      sites: PLAN ? PLAN.sites : null,
      // the way an aircraft on this base gets to the runway: stand -> apron
      // lane -> taxiway -> threshold, in WORLD metres, and the roll heading
      // (yaw, models face +z). city/strategic.js taxis the B-2 down it.
      taxiFrom: function (wx, wz, dir) {
        if (!PLAN || !CBZ.baseTaxiPath) return null;
        const lx = wx - CEN_X, lz = wz - CEN_Z;
        let best = null, bd = 64;
        PLAN.stands.forEach(function (s) { const d = Math.hypot(s.x - lx, s.z - lz); if (d < bd) { bd = d; best = s; } });
        if (!best) return null;
        const t = CBZ.baseTaxiPath(PLAN, best, dir);
        return {
          points: t.points.map(function (p) { return { x: CEN_X + p.x, z: CEN_Z + p.z }; }),
          heading: t.heading, rollLen: t.rollLen,
        };
      },
    };
  }, 22);
})();
