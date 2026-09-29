/* ============================================================
   city/island_military.js — THE MILITARY BASE ISLAND.

   A walled army installation off the mainland's west edge, joined
   by a single guarded causeway. WHY each thing exists (owner's
   #1 law — no prop without an in-world reason):

     • CAUSEWAY + CHECKPOINT — a base is SEALED; there is exactly
       one way on or off (the bridge), and a manned gate decides
       who passes. Drive in, the barrier + guard shack + soldiers
       are the reason you slow down. The perimeter FENCE makes the
       gate matter (you can't just walk in over open ground).
     • AIRSTRIP w/ parked JETS + a BOMBER — this is an AIR base;
       the runway and the hardware on it are why it's here.
     • HELIPADS w/ HELICOPTERS — rotary wing alongside fixed wing.
     • MOTOR POOL — tanks, infantry carriers, light vehicles, rocket
       artillery, missile launchers and cargo trucks (city/mil_armor.js
       draws them), staged in ranks the way real motor pools do.
     • HANGARS — enterable sheds that shelter/repair the aircraft.
     • BARRACKS — soldiers have to sleep somewhere.
     • COMMAND HQ w/ ARMORY — the brain of the base, and the one
       reason a player WALKS in: the armory ("Browse the armory").
     • WATCHTOWERS / SANDBAG BUNKERS / radar / fuel / flag — the
       texture of a base that's actively defended.

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
    warn: 0xd4a017, dark: 0x202327, hangarRoof: 0x6e7682, flagRed: 0xc0392b,
    flagWhite: 0xecf0f1, flagBlue: 0x2c3e6b,
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
  function mkLink(root, cx, cz, w, d) {
    const m = new THREE.Mesh(bg(w, 1.9, d), new THREE.MeshLambertMaterial({ color: M.fence, transparent: true, opacity: 0.25 }));
    m.position.set(cx, 1.1, cz); m.castShadow = false; m.receiveShadow = false; root.add(m);
  }

  // ========================================================================
  //   GROUND PLANES — dirt apron over the whole island, tarmac runway/pads.
  // ========================================================================
  function buildGround(root) {
    // One textured plane owns dirt and runway. The former dirt box plus asphalt
    // box remained overlapping even after their tops were separated by 8cm;
    // the flight frustum quantised that gap and produced the recurring runway
    // flicker. Baking the runway into the land skin removes the hidden faces.
    const W = MAXX - MINX, D = MAXZ - MINZ;
    const RW_X = CEN_X, RW_Z = MAXZ - 70, RW_L = 360, RW_W = 26;
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1024;
    const ctx = canvas.getContext("2d");
    function css(c) { return "#" + (c >>> 0).toString(16).padStart(6, "0"); }
    function rect(x, z, w, d, color) {
      ctx.fillStyle = css(color);
      ctx.fillRect((x - w / 2 - MINX) / W * canvas.width,
        (z - d / 2 - MINZ) / D * canvas.height,
        w / W * canvas.width, d / D * canvas.height);
    }
    ctx.fillStyle = css(M.dirt); ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 0.08;
    for (let z = MINZ; z < MAXZ; z += 34) rect(CEN_X, z + 8, W, 16, 0x8a7754);
    ctx.globalAlpha = 1;
    rect(RW_X, RW_Z, RW_L, RW_W, M.runway);
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = Math.min(8, CBZ.renderer && CBZ.renderer.capabilities ? CBZ.renderer.capabilities.getMaxAnisotropy() : 1);
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshLambertMaterial({ color: 0xffffff, map: tex }));
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(CEN_X, 0, CEN_Z); apron.receiveShadow = true; apron.castShadow = false;
    apron.userData.terrain = true; apron.userData.worldSurface = true;
    apron.userData.surfaceOwner = "military";
    apron.userData.unifiedSurface = true;
    apron.name = "military-island-surface";
    root.add(apron);
    // RUNWAY: long tarmac strip down the south part of the island, with
    // centreline dashes (merged into one dash material).
    // dashed centreline via InstancedMesh (frugal repeat)
    const nDash = 18, dashGeo = bg(8, 0.02, 0.6);
    const dim = new THREE.InstancedMesh(dashGeo, cm(M.paint), nDash);
    const dd = new THREE.Object3D();
    for (let i = 0; i < nDash; i++) {
      dd.position.set(RW_X - RW_L / 2 + 18 + i * 18, 0.05, RW_Z);
      dd.updateMatrix(); dim.setMatrixAt(i, dd.matrix);
    }
    dim.instanceMatrix.needsUpdate = true; dim.receiveShadow = true; root.add(dim);
    // runway threshold piano keys (both ends)
    [-RW_L / 2 + 6, RW_L / 2 - 6].forEach(function (ex) {
      for (let k = -3; k <= 3; k++) box(root, RW_X + ex, 0.05, RW_Z + k * 2.6, 5, 0.02, 1.1, M.paint, { cast: false });
    });
    return { RW_X: RW_X, RW_Z: RW_Z, RW_L: RW_L, RW_W: RW_W };
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

    // ---- CHECKPOINT GATE at the base (west) end of the causeway ----
    const gx = CW_MINX + 6;                               // just inside the base
    // guard shack
    box(root, gx, 1.4, CW_MAXZ + 4, 3, 2.8, 3, M.olive);
    box(root, gx, 2.6, CW_MAXZ + 4, 3.4, 0.3, 3.4, M.oliveD);   // roof
    // window — OWNER RULE (bda61ab): no gray panes; same clear tinted glass as
    // every city facade. FRESH material (never cmat(): transparent glass must
    // stay out of the shared cache, and batch.js skips transparent from merge).
    const shackWin = new THREE.Mesh(bg(2.6, 1.0, 0.1), new THREE.MeshLambertMaterial({
      color: 0xbfe9f7, emissive: 0x3f8aa6, emissiveIntensity: 0.5, transparent: true, opacity: 0.6 }));
    shackWin.position.set(gx, 1.7, CW_MAXZ + 2.5);
    shackWin.castShadow = false; shackWin.receiveShadow = true;
    root.add(shackWin);
    col(gx, CW_MAXZ + 4, 3, 3, 0, 2.8);
    // boom barriers — one raised arm per carriageway at the GATE. THE FLOATING-
    // YELLOW-LINE FIX (owner: "still a floating yellow line at the highway near
    // Fort Brandt"): the old code sized the bar with `w` — the causeway LENGTH
    // (~547m post-move), not the road width — so a single amber box spanned 90%
    // of the causeway along its centreline at y=1.1 with a 0.04 roll that
    // floated its far tip ~10m in the air over the deck: THE floating yellow
    // line. It also dropped a `w*0.9`-long chest-height collider down the whole
    // median (an invisible wall against lane changes). Real checkpoint grammar
    // instead: a short striped arm per side pivoting at the kerb, parked RAISED
    // (the base is open to traffic — matching the old behaviour, where the
    // median collider never actually blocked the travel lanes), with the pivot
    // posts as the only (tiny) colliders. Geometry-only + fixed constants —
    // deterministic, and paint/deck stay solely owned by buildHighway above.
    const ARM_L = 9.5, ARM_A = 1.15;            // arm length / raised angle (rad)
    [[CW_MINZ + 1.2, 1], [CW_MAXZ - 1.2, -1]].forEach(function (pv) {
      const pz = pv[0], toward = pv[1];         // arm reaches toward the median
      cyl(root, gx, 0.7, pz, 0.16, 0.2, 1.4, M.red, 8);           // pivot post
      col(gx, pz, 0.5, 0.5, 0, 1.4);
      const arm = box(root, gx,
        0.9 + Math.sin(ARM_A) * ARM_L / 2,
        pz + toward * Math.cos(ARM_A) * ARM_L / 2,
        0.16, 0.16, ARM_L, M.warn);
      // rotation.x = r maps the box's +Z to (0, -sin r, cos r): the +Z-reaching
      // arm raises with r = -a, the -Z-reaching one with r = +a (box symmetry).
      arm.rotation.x = -toward * ARM_A;         // raised — the gate reads manned but open
    });
    // sandbag stack beside the gate (bunkered guard post)
    sandbagBunker(root, gx + 4, CW_MINZ - 3);
    return { gx: gx };
  }

  // ========================================================================
  //   SANDBAG BUNKER — instanced sandbag rows in a short L (frugal repeat).
  // ========================================================================
  function sandbagBunker(root, cx, cz) {
    const rows = [];
    // build an L-shaped low wall of bag positions
    for (let i = 0; i < 6; i++) rows.push({ x: cx - 3 + i, z: cz, layer: 0 });
    for (let i = 0; i < 5; i++) rows.push({ x: cx - 3 + i + 0.5, z: cz, layer: 1 });
    for (let j = 1; j < 5; j++) rows.push({ x: cx - 3, z: cz + j, layer: 0 });
    const geo = bg(1.0, 0.45, 0.7);
    const im = new THREE.InstancedMesh(geo, cm(M.sandbag), rows.length);
    im.castShadow = true; im.receiveShadow = true;
    const d = new THREE.Object3D();
    for (let i = 0; i < rows.length; i++) {
      d.position.set(rows[i].x, 0.22 + rows[i].layer * 0.45, rows[i].z);
      d.updateMatrix(); im.setMatrixAt(i, d.matrix);
    }
    im.instanceMatrix.needsUpdate = true; root.add(im);
    col(cx - 0.5, cz, 7, 0.9, 0, 1.0);                   // wall collider
    col(cx - 3, cz + 2.5, 0.9, 5, 0, 1.0);
  }

  // ========================================================================
  //   WATCHTOWER — four legs, a railed deck at 6.35 m under a roof, and a
  //   caged ladder up the face toward the base (world/ladderkit.js draws it,
  //   systems/climb.js climbs it; a soldier can go up it and come down it).
  //   WHAT IT WAS: a "ladder hint" with no ladder, a SOLID box where the cabin
  //   should be (the "open sides" were a 3.2 x 1.4 x 3.2 block) and a 3.4 m
  //   solid column from the ground to the deck, so the patrol spot at a tower
  //   corner stood inside it. Now the legs are the columns, the ground under
  //   the tower is ground, the deck is a platform with a waist-high parapet
  //   you cannot walk off, and the roof is high enough to stand under.
  //   `inX`: the base's centre x — the ladder goes on the face toward it.
  // ========================================================================
  function watchtower(root, cx, cz, inX) {
    const DECK = 6.35, PAR = 1.0, ROOF = 8.6, HW = 1.7;
    const s = (inX == null ? CEN_X : inX) >= cx ? 1 : -1;       // the ladder face, +x or -x
    const g = new THREE.Group(); g.position.set(cx, 0, cz); root.add(g);
    [-1, 1].forEach(function (sx) {
      [-1, 1].forEach(function (sz) {
        box(g, sx * 1.4, (DECK - 0.3) / 2, sz * 1.4, 0.25, DECK - 0.3, 0.25, M.oliveD);
        col(cx + sx * 1.4, cz + sz * 1.4, 0.3, 0.3, 0, DECK - 0.3);
        // corner posts, parapet to roof
        box(g, sx * 1.55, (DECK + PAR + ROOF - 0.15) / 2, sz * 1.55, 0.12, ROOF - 0.15 - DECK - PAR, 0.12, M.oliveD);
      });
    });
    // a brace ring half way up the legs
    box(g, 0, 3.0, -1.4, 2.8, 0.14, 0.14, M.oliveD); box(g, 0, 3.0, 1.4, 2.8, 0.14, 0.14, M.oliveD);
    box(g, -1.4, 3.0, 0, 0.14, 0.14, 2.8, M.oliveD); box(g, 1.4, 3.0, 0, 0.14, 0.14, 2.8, M.oliveD);
    box(g, 0, DECK - 0.15, 0, HW * 2, 0.3, HW * 2, M.olive);                 // deck slab
    // the parapet: three full walls, and the ladder face split round the gap
    const py = DECK + PAR / 2;
    box(g, 0, py, -HW + 0.05, HW * 2, PAR, 0.1, M.olive, { cast: false });
    box(g, 0, py, HW - 0.05, HW * 2, PAR, 0.1, M.olive, { cast: false });
    box(g, -s * (HW - 0.05), py, 0, 0.1, PAR, HW * 2, M.olive, { cast: false });
    const seg = HW - 0.42;
    box(g, s * (HW - 0.05), py, -(0.42 + seg / 2), 0.1, PAR, seg, M.olive, { cast: false });
    box(g, s * (HW - 0.05), py, 0.42 + seg / 2, 0.1, PAR, seg, M.olive, { cast: false });
    box(g, 0, ROOF, 0, 3.6, 0.3, 3.6, M.oliveD);                            // roof
    // searchlight on the outer parapet, looking out over the wire
    cyl(g, -s * 1.45, DECK + PAR + 0.25, 0, 0.3, 0.35, 0.5, M.warn, 8).rotation.z = Math.PI / 2;
    if (CBZ.ladderKit) {
      CBZ.ladderKit.deck({
        minX: cx - HW, maxX: cx + HW, minZ: cz - HW, maxZ: cz + HW, top: DECK, rail: PAR,
        gaps: [{ x: cx + s * HW, z: cz, w: 0.42 }],
      });
      CBZ.ladderKit.build(root, {
        x: cx + s * (HW + 0.05), z: cz, nx: s, nz: 0, y0: 0, y1: DECK,
        name: "watchtower", tag: "military:watchtower", mode: "city",
      }, cm(M.steelD));
      return { x: cx, z: cz, y: DECK };
    }
    col(cx, cz, 3.4, 3.4, 0, DECK);            // no ladder kit: the old solid footprint
    return null;
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

    buildGround(root);
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

    // ---- AIRSTRIP: parked fighter jets in a row + a heavy bomber ----
    const rwZ = MAXZ - 70;                                // runway centre Z
    const jetZ = rwZ - 22;                                // parked just north of runway
    for (let i = 0; i < 5; i++) {
      placeModel(root, makeJet, MINX + 90 + i * 34, jetZ, Math.PI, 1, "plane", "Fighter Jet");   // nose pointing -Z (toward runway)
    }
    placeModel(root, makeBomber, MAXX - 95, jetZ - 12, Math.PI, 1, "plane", "Heavy Bomber");      // the big one, set back
    // THE CARGO LIFTER, on its own loading apron and facing the OTHER WAY on
    // purpose: nose north up the strip, ramp pointing back down the taxiway
    // toward the motor pool, because the tanks are the load. A base where the
    // freighter is parked so its ramp faces a fence is a base nobody thought
    // about. Placed by its own function — it declares a walk-in HOLD and
    // deliberately pushes no full-footprint collider (see placeCargoPlane).
    placeCargoPlane(root, MAXX - 150, jetZ - 34, 0, "Cargo Lifter");
    // TWO RECON DRONES in the second row behind the fighters: nobody climbs
    // into a drone, so they are solid scenery, not boardables.
    for (let i = 0; i < 2; i++) placeModel(root, makeDrone, MINX + 100 + i * 36, jetZ - 30, Math.PI, 1);

    // ---- HELIPADS: a row, each with a parked helicopter ----
    const padZ = CEN_Z + 30;
    for (let i = 0; i < 4; i++) {
      const px = MINX + 70 + i * 30;
      // pad disc + painted H
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 0.08, 20), cm(M.tarmac));
      pad.position.set(px, 0.02, padZ); pad.receiveShadow = true; root.add(pad);
      // the H stands 3 cm proud of the disc top (0.06): it was 1 cm, both in
      // shared untextured colours, and the pale paint shimmered through the
      // tarmac from any height a helicopter flies at
      box(root, px, 0.075, padZ, 1.0, 0.03, 4.0, M.paint, { cast: false });           // H verticals
      box(root, px - 1.4, 0.075, padZ, 0.02 + 2.8, 0.03, 0.8, M.paint, { cast: false }); // H crossbar
      const ring = new THREE.Mesh(new THREE.TorusGeometry(6.2, 0.12, 6, 24), cm(M.paint));
      ring.rotation.x = Math.PI / 2; ring.position.set(px, 0.05, padZ); root.add(ring);
      // the two nearest the strip carry the ATTACK helicopters: the wanted-level
      // gunship scrambles from these (aircraft.js prefers rec.attackHeli)
      const attack = i < 2;
      placeModel(root, attack ? makeAttackHeli : makeHeli, px, padZ, rng() * 0.4 - 0.2, 1, "heli", attack ? "Attack Helicopter" : "Helicopter");
      if (attack) placed[placed.length - 1].attackHeli = true;
    }

    // ---- MOTOR POOL: three ranks staged nose-east toward the gate --------
    //   front rank: the tanks; middle: the infantry carriers + the light
    //   vehicles; rear: the launchers and the cargo trucks.
    const mpZ = CEN_Z - 70;
    for (let i = 0; i < 5; i++) placeModel(root, makeTank, MINX + 70 + i * 26, mpZ, Math.PI / 2, 1, "tank", "Main Battle Tank");
    [
      [makeIFV, "Infantry Fighting Vehicle"], [makeIFV, "Infantry Fighting Vehicle"],
      [makeAPC, "Armored Personnel Carrier"], [makeAPC, "Armored Personnel Carrier"],
      [makeLUV, "Light Utility Vehicle"], [makeLUV, "Light Utility Vehicle"],
    ].forEach(function (v, i) { placeModel(root, v[0], MINX + 70 + i * 22, mpZ + 18, Math.PI / 2, 1, "ground", v[1]); });
    [
      [makePatriot, "patriot", "Missile Launcher"], [makePatriot, "patriot", "Missile Launcher"],
      [makeMLRS, "mlrs", "Rocket Artillery"],
      [makeTruck, "ground", "Cargo Truck"], [makeTruck, "ground", "Cargo Truck"],
    ].forEach(function (v, i) { placeModel(root, v[0], MINX + 70 + i * 26, mpZ - 18, Math.PI / 2, 1, v[1], v[2]); });

    // ---- HANGARS: big enterable sheds (engine building shells) ----
    // door faces -Z toward the apron/runway. Single big storey.
    const hangars = [];
    for (let i = 0; i < 3; i++) {
      const hx = MINX + 110 + i * 80, hz = CEN_Z - 130;
      let b = null;
      try {
        b = CBZ.cityMakeBuilding(root, hx, hz, 40, 30, 1, M.hangarRoof, 0, { facade: "office" });
      } catch (e) { /* keep building the rest of the base */ }
      hangars.push({ x: hx, z: hz, b: b });
    }

    // ---- BARRACKS: row of long low buildings ----
    for (let i = 0; i < 4; i++) {
      const bx = MAXX - 60, bz = MINZ + 60 + i * 34;
      try { CBZ.cityMakeBuilding(root, bx, bz, 22, 26, 2, 0x6f7560, 3, { facade: "office" }); } catch (e) {}
    }

    // ---- COMMAND HQ (enterable) + ARMORY interaction inside ----
    const hqX = CEN_X + 60, hqZ = CEN_Z - 40;
    let hq = null;
    try { hq = CBZ.cityMakeBuilding(root, hqX, hqZ, 34, 28, 3, 0x55603f, 1, { facade: "office" }); } catch (e) {}
    // flagpole + flag in front of HQ (the base's heart reads as the HQ)
    cyl(root, hqX - 12, 6, hqZ + 18, 0.12, 0.14, 12, M.steel, 8);
    box(root, hqX - 11.0, 11, hqZ + 18, 2.0, 1.3, 0.05, M.flagBlue, { cast: false });
    box(root, hqX - 10.0, 10.5, hqZ + 18, 3.0, 0.45, 0.05, M.flagRed, { cast: false });
    box(root, hqX - 10.0, 11.4, hqZ + 18, 3.0, 0.45, 0.05, M.flagWhite, { cast: false });

    // ARMORY ZONE: a spot just inside the HQ door where the player can browse
    // weapons. WHY a zone, not a wall-store: the engine's gunstore.js is bound
    // to a specifically-STAMPED gun-shop lot (buildings.js sets lot.building
    // .gunstore); this island's HQ isn't that lot, so we surface our own
    // interaction. If a real city gun store exists, we hand the player off to
    // it (CBZ.cityOpenShop / the gunstore wall); otherwise it's an in-world note.
    const armoryX = hqX, armoryZ = hqZ - 4;              // inside, behind the door
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

    // ---- WATCHTOWERS at the four corners (the base is WATCHED) ----
    // (published on CBZ._militaryBase.towers: garrison.js stands the corner
    // sentries on these decks, and they climb the ladders to get there)
    const towers = [
      watchtower(root, MINX + 18, MINZ + 18, CEN_X),
      watchtower(root, MAXX - 18, MINZ + 18, CEN_X),
      watchtower(root, MINX + 18, MAXZ - 18, CEN_X),
      watchtower(root, MAXX - 18, MAXZ - 18, CEN_X),
    ].filter(Boolean);

    // ---- SANDBAG BUNKERS scattered at posts ----
    sandbagBunker(root, CEN_X - 30, MINZ + 40);
    sandbagBunker(root, CEN_X + 90, CEN_Z + 60);

    // ---- FUEL DEPOT: cylindrical tanks (collider) near the apron ----
    for (let i = 0; i < 3; i++) {
      const fx = MAXX - 40, fz = CEN_Z + 80 + i * 14;
      const t = cyl(root, fx, 3, fz, 4, 4, 6, M.fuel, 16);
      box(root, fx, 6.3, fz, 8.2, 0.4, 8.2, M.steelD);   // domed top hint
      col(fx, fz, 8, 8, 0, 6);
    }

    // ---- RADAR DISH on a mast (the base SEES) ----
    const radX = CEN_X + 30, radZ = MINZ + 50;
    cyl(root, radX, 4, radZ, 0.4, 0.5, 8, M.steel, 8);
    const dish = new THREE.Mesh(new THREE.SphereGeometry(3, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), cm(M.steel));
    dish.position.set(radX, 8, radZ); dish.rotation.x = -0.6; dish.castShadow = true; root.add(dish);
    col(radX, radZ, 1.2, 1.2, 0, 8);

    // ---- PARADE GROUND — anchors are filled by real troops below ----
    const paradeAnchors = paradeFormation(CEN_X - 90, CEN_Z + 40);

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
          home: { x: MAXX - 60, z: MINZ + 60 },
          // THIS file's updater already owns these bodies (aircrew, respawn,
          // the sortie). `driven` keeps garrison.js's own sweep off them so the
          // brain runs exactly once, from the loop that was always here.
          driven: true,
        });
      }
    };
    trooper(cw.gx + 2, CW_MINZ + 2, { aggr: 0.35 }, null, guardSetup);
    trooper(cw.gx + 2, CW_MAXZ - 2, { aggr: 0.35 }, null, guardSetup);
    // NO-SPAWN keep-out: the active runway strip (owner's rule — nobody
    // spawns or idles on a runway, not even patrols). Registered BEFORE the
    // patrol scatter below so cityScatterInRegion already steers around it.
    // Rect recomputed from the same anchors the runway build uses
    // (RW_X=CEN_X, RW_Z=MAXZ-70, RW_L=360, RW_W=26) plus a small margin.
    if (CBZ.registerNoSpawnZone) {
      CBZ.registerNoSpawnZone(city, {
        minX: CEN_X - 188, maxX: CEN_X + 188,
        minZ: (MAXZ - 70) - 17, maxZ: (MAXZ - 70) + 17,
        label: "military-runway",
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
        x: cw.gx + 2, z: CW_CZ, cap: 8,
        home: { x: MAXX - 60, z: MINZ + 60 },              // the barracks row
        spots: [
          { x: cw.gx + 2, z: CW_CZ },                       // the checkpoint gate
          { x: hqX - 12, z: hqZ + 18 },                     // the HQ flagpole
          { x: CEN_X - 70, z: CEN_Z - 70 },                 // the motor pool
          { x: MINX + 18, z: MAXZ - 18 },                   // a watchtower corner
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
    CBZ._militaryBase = {
      center: { x: CEN_X, z: CEN_Z }, minX: MINX, maxX: MAXX, minZ: MINZ, maxZ: MAXZ,
      armoryWired: armoryWired, boardable: placed.length,
      gate: { x: cw.gx + 2, z: CW_CZ },
      hq: { x: hqX, z: hqZ },
      flag: { x: hqX - 12, z: hqZ + 18 },
      armory: { x: armoryX, z: armoryZ },
      motorPool: { x: CEN_X - 70, z: CEN_Z - 70 },
      parade: { x: CEN_X - 90, z: CEN_Z + 40 },
      barracks: { x: MAXX - 60, z: MINZ + 60 },
      runway: { x: CEN_X, z: MAXZ - 70, len: 360, w: 26 },
      towers: towers,
    };
  }, 22);
})();
