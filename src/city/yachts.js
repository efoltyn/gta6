/* ===========================================================================
   city/yachts.js — THE SUPERYACHT CLASS + THE SMALL-CRAFT FLEET

   OWNER (2026-07-29, verbatim): "add yachts small fishing boats we already
   have some good boat assets, and then add some massive beautiful yachts,
   helipads on them and places to park cars etc and small boats attached".

   WHAT THIS FILE IS NOT
   ------------------------------------------------------------
   It is NOT a second boat system. `world/water_hulls.js` already owns the
   marine hull REGISTRY (physics spec derivation, the drawing kit, the
   merge-by-material pass, the walkable-deck rig, the economy push), and
   `city/marina.js` owns berths, and `city/boatyard.js` derives its whole sales
   catalog from the registry. So a new vessel here is a ROW, and every one of
   those systems picks it up with no edit:

     · buyable at the boatyard          (catalog() walks marineHulls.list())
     · counted in net worth             (economy.js holdingsWorth via carByName)
     · berthed, not beached             (marina.js's citySpawnOwnedCar wrapper)
     · sized a berth that FITS          (marina.js hullLadder() reads the LOA)
     · drivable with real hydrodynamics (water_helm.js integrates the spec)
     · floats on the live swell         (water_buoyancy.js reads the spec)
     · walkable                         (movingPlatform via the deck spec)
     · enterable / stealable / killable (it is an ordinary CBZ.cityCars record)

   THE BLOCK — CBZ.yachtBuild(spec) : ONE NUMBER IN, A WHOLE SHIP OUT
   ------------------------------------------------------------
   The same grammar as CBZ.powerKit(tier) and CBZ.predatorKit(actor): you hand
   it a LENGTH OVERALL and it derives beam, draft, freeboard, displacement, top
   speed, turning circle, deck count, deck height, superstructure setback,
   helideck radii, garage size and every walkable surface. NO SECOND YACHT IS
   EVER HAND-TYPED. Adding a size is a row in FLEET below.

   Every law is solved, not tasted, and each one is anchored on a real ship at
   one end and on water_hulls.js's OWN authored 34 m yacht at the other — so the
   curve REPRODUCES the vessel that already shipped:

     beam        B  = 0.649 L^0.698     (34 -> 7.60 authored 7.6 · 156 -> 22.0)
     draft       T  = 0.2157 L^0.6586   (34 -> 2.20 authored 2.2 · 156 ->  6.0)
     freeboard   F  = 0.1749 L^0.7305   (34 -> 2.30 authored 2.3 · 156 ->  7.0)
     displacement   = Lwl.B.T.Cb.rho    Cb 0.50, rho 1.025
                                        (34 -> 268 t authored 260 t: 3%)
     top speed   Fn = 1.2506 L^-0.2775  (34 -> 16.0 kn authored 16 · 156 -> 22.5)
     accel0         = 5.325 L^-0.6438   (34 -> 0.55 authored 0.55)
     turn radius R  = 2.2 L             (34 -> yawRate 0.110 authored 0.110)

   The displacement law is the one worth reading twice: it is the block
   coefficient, not a fitted curve, and it lands within 3% of a number a human
   typed by hand. That is the check that says the rest of the ladder is honest.

   THE REFERENCE (owner's attached photo: a 156 m Lürssen-class under way)
   ------------------------------------------------------------
   Cream hull AND superstructure in one continuous colour, teak decks, near-black
   glass in long horizontal bands, FIVE levels each stepping back and narrowing,
   TWO helidecks (a big one forward with a painted circled H, one aft on the top
   deck with a helicopter on it), a mast cluster of white radomes and four slim
   stacks, a knife entry with pronounced sheer, a low broad stern with a beach
   platform at the waterline, white stanchion rails on every deck edge, tenders
   in SIDE SHELL GARAGES rather than on deck. All of that is derived below.

   NEVER SCENERY (owner law). Every vessel here is a real CBZ.cityCars record:
   board it, drive it, ram it, sink it, steal it. The tenders in the garage are
   real hulls from the same registry. The helicopter on the pad is registered
   through CBZ.cityRegisterMilitaryVehicle — the same seam island_airport.js
   uses for civil aircraft — so it flies on the EXISTING air system.

   DETERMINISM: this is a build path. Every draw goes through CBZ.hash01 /
   CBZ.seedStream("yachts"). No Math.random.

   LOAD ORDER, and it decides the shape of this file: index.html parses
   yachts.js at :969 and world/water_hulls.js at :1333. CBZ.marineHulls DOES
   NOT EXIST when this IIFE runs. So hulls are pushed onto the shared
   CBZ.marineHullPending queue (water_hulls.js drains it through its own
   register(), so a queued hull is derived and priced by exactly the authored
   path), and every build() reads CBZ.marineHulls.kit LAZILY — build() is only
   ever called when a hull is actually spawned, long after boot.

   FLAGS (one-line reverts; config.js is fenced)
     CBZ.CONFIG.YACHTS          (true)  register the superyacht class at all
     CBZ.CONFIG.YACHT_FLEET     (true)  the small-craft fleet rows
     CBZ.CONFIG.YACHT_AFLOAT    (true)  put vessels in the world at build time
     CBZ.CONFIG.YACHT_HELIDECK  (true)  helidecks + the parked airframe
     CBZ.CONFIG.YACHT_GARAGE    (true)  side shell doors, tenders, the car deck
     CBZ.CONFIG.YACHT_DECKS     (true)  walkable decks (movingPlatform)

   Exposes: CBZ.yachtBuild, CBZ.yachtSolve, CBZ.yachtFleet, CBZ.yachtOf,
            CBZ.yachtGarage, CBZ.yachtAudit.
   =========================================================================== */
(function () {
  "use strict";
  const CBZ = (window.CBZ = window.CBZ || {});
  const C = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (C.YACHTS == null) C.YACHTS = true;
  if (C.YACHT_FLEET == null) C.YACHT_FLEET = true;
  if (C.YACHT_AFLOAT == null) C.YACHT_AFLOAT = true;
  if (C.YACHT_HELIDECK == null) C.YACHT_HELIDECK = true;
  // YACHT_HELI_PARKED — put an AIRFRAME on the aft pad, separately from the
  // pads themselves. It is its own flag because of an honest limitation, and
  // the limitation is worth stating rather than hiding: the ONLY rotorcraft
  // builder this repo exports is CBZ.debugBuildPoliceAir.gunship(), so the
  // helicopter sitting on a billionaire's sun deck is an attack helicopter.
  // It is a REAL one — boardable and flyable through the existing air system,
  // which is the part that matters — but it is not what the reference photo
  // shows. Flip this false for bare pads until a civil light twin exists.
  if (C.YACHT_HELI_PARKED == null) C.YACHT_HELI_PARKED = true;
  if (C.YACHT_GARAGE == null) C.YACHT_GARAGE = true;
  if (C.YACHT_DECKS == null) C.YACHT_DECKS = true;

  const KN = 0.514444;                    // knots -> m/s
  const G = 9.81;
  const RHO = 1.025;                      // seawater, t/m^3
  const CB = 0.50;                        // block coefficient, fast displacement yacht

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function kit() { return (CBZ.marineHulls && CBZ.marineHulls.kit) || null; }

  /* ==========================================================================
     1. THE SOLVE — CBZ.yachtSolve(loa, opts)

     Every number the ship is made of, from its length. Pure arithmetic: no
     THREE, no globals, safe to call before or after boot, and the reason a
     yacht is a ROW rather than 700 lines.
     ========================================================================== */
  function solve(loa, opts) {
    opts = opts || {};
    const L = Math.max(18, +loa || 46);
    const Lwl = L * 0.92;
    const B = opts.beam != null ? +opts.beam : 0.649 * Math.pow(L, 0.698);
    const HB = B * 0.5;
    const T = opts.draft != null ? +opts.draft : 0.2157 * Math.pow(L, 0.6586);
    const FB = opts.freeboard != null ? +opts.freeboard : 0.1749 * Math.pow(L, 0.7305);
    const massT = opts.massT != null ? +opts.massT : Lwl * B * T * CB * RHO;

    // SPEED. Froude number falls with length — a big ship's speed comes from
    // its waterline, not from pushing harder. (Dilbar: 156 m, 22.5 kn, Fn 0.31;
    // the shipped 34 m yacht: 16 kn, Fn 0.47.)
    const root = Math.sqrt(G * Lwl);
    const fnTop = opts.fnTop != null ? +opts.fnTop : 1.2506 * Math.pow(L, -0.2775);
    const topKts = opts.topKts != null ? +opts.topKts : (fnTop * root) / KN;
    const topMs = topKts * KN;

    // DECK STACK. Deck height barely grows with length — real superyacht decks
    // are 3.0-3.6 m whatever the hull — so a longer ship looks bigger by having
    // MORE decks, which is exactly what the reference photo shows.
    const DH = opts.deckH != null ? +opts.deckH : 2.95 + 0.0035 * L;
    // main deck + TIERS superstructure decks. 156 -> 4 (five levels: the
    // reference). 88 -> 3. Anything under 76 m -> 2.
    const tiers = opts.tiers != null ? (opts.tiers | 0) : clamp(Math.floor(L / 38) + 1, 2, 4);

    // The side deck is the critical circulation loop: it is the only fore/aft
    // route that is not interior, so it is solved with a hard floor rather than
    // left to fall out of the superstructure width.
    const sideW = clamp(0.13 * B, 0.85, 2.6);
    const stepIn = Math.max(0.55, 0.055 * B);   // each tier narrows by this
    const supHB = [];
    for (let k = 0; k <= tiers; k++) supHB.push(Math.max(1.35, HB - sideW - stepIn * k));

    // Fore/aft extent of each tier. Tier 0 (the main-deck superstructure) runs
    // from 30% aft of amidships to 22% forward; every tier above steps back at
    // both ends, which is the stacked-wedding-cake silhouette.
    const supZ0 = [], supZ1 = [];
    for (let k = 0; k <= tiers; k++) {
      supZ0.push(-0.300 * L + 0.045 * L * k);
      supZ1.push(0.220 * L - 0.030 * L * k);
    }

    // Deck soles above the waterline.
    const deckY = [FB];
    for (let k = 1; k <= tiers; k++) deckY.push(FB + DH * k);

    // HELIDECKS. A real yacht cannot certify one under ~62 m; two need ~95 m of
    // deck to separate them. Forward pad radius is capped by the hull's own
    // beam THERE (the bow has tapered), the upper pad is a cantilever off the
    // top tier so it may exceed that tier's width — which is what the reference
    // photo shows and why it is a separate number.
    const pads = opts.pads != null ? (opts.pads | 0) : (L >= 95 ? 2 : (L >= 62 ? 1 : 0));
    const zFwdPad = 0.335 * L;
    const fwdHB = HB * beamFrac(zFwdPad / (0.5 * L));
    const padFwdR = Math.min(0.055 * L, fwdHB * 0.92);
    const padUpR = Math.min(0.048 * L, HB * 0.72);
    const zUpPad = -0.130 * L;

    // GARAGES. A shell door in the flank, one each side, forward of amidships.
    // Height is set by the tender that has to come out of it (the 4.5 m RIB
    // water_hulls.js already registers) with 0.5 m of clearance.
    const garage = L >= 55 ? {
      z: -0.055 * L, len: clamp(0.135 * L, 6.0, 26.0),
      h: clamp(0.030 * L, 2.1, 5.0), y: FB - clamp(0.030 * L, 2.1, 5.0) - 0.35,
    } : null;
    // The CAR DECK is the starboard garage on anything long enough to swing a
    // car inside it (a car is 4.6 x 2.0; the deck needs 6 m of clear run).
    const carDeck = (garage && garage.len >= 8.5) ? {
      z: garage.z, len: garage.len, w: Math.min(B * 0.72, 9.0), y: garage.y, h: garage.h,
      slots: clamp(Math.floor(garage.len / 5.6), 1, 4),
    } : null;

    // The transom beach club / swim platform: at water level, and the ONE place
    // a swimmer can get aboard.
    const platY = 0.30 + L * 0.0022;
    const sternZ = -0.5 * L;

    return {
      loa: L, Lwl: Lwl, beam: B, halfBeam: HB, draft: T, freeboard: FB, massT: massT,
      topKts: topKts, topMs: topMs, fnTop: fnTop,
      deckH: DH, tiers: tiers, deckY: deckY, sideW: sideW,
      supHB: supHB, supZ0: supZ0, supZ1: supZ1,
      pads: pads, padFwdR: padFwdR, padUpR: padUpR, zFwdPad: zFwdPad, zUpPad: zUpPad,
      garage: garage, carDeck: carDeck,
      platY: platY, sternZ: sternZ, bowZ: 0.5 * L,
      keel: -T, airDraft: FB + DH * tiers + 0.085 * L,
    };
  }

  // The hull's half-beam as a fraction of maximum, at t = z / (L/2) in [-1, 1].
  // Full-beam transom, a long parallel midbody, and a knife entry forward: the
  // 1.7 exponent is what makes the bow a fine wedge instead of a rounded nose.
  function beamFrac(t) {
    if (t <= -0.62) return 0.94 + 0.06 * ((t + 1) / 0.38);   // slight tuck at the transom
    if (t <= 0.35) return 1;
    const u = clamp((t - 0.35) / 0.65, 0, 1);
    return Math.max(0.03, 1 - Math.pow(u, 1.7) * 0.98);
  }

  /* ==========================================================================
     2. THE PHYSICS BLOCK — what water_hulls.js's deriveSpec() consumes

     Authored numbers only (LOA, beam, draft, tonnes, knots, accel, yaw); every
     drag coefficient is solved from them by water_hulls.js. Nothing here
     hand-tunes a drag constant, which is the whole point of that inversion.
     ========================================================================== */
  function hullBlock(S) {
    const L = S.loa;
    const R = 2.2 * L;                    // turning radius: 2.2 hull lengths
    const yawRate = S.topMs / R;
    // Yaw lag grows as the square root of length: a 156 m hull takes 5.2 s to
    // spin up to its (tiny) turn rate where a 34 m one takes 2.4 s.
    const tau = 2.44 * Math.sqrt(L / 34);
    return {
      loa: L, beam: S.beam, draft: S.draft, massT: Math.round(S.massT),
      topKts: S.topKts, cruiseKts: S.topKts * 0.81, planeKts: 0, canPlane: false,
      accel0: 5.325 * Math.pow(L, -0.6438),
      // It never gets near the hump (Fn 0.31 at 156 m against a hump at 0.50),
      // so it pays wave-making all the way to the top and can never climb out.
      humpFrac: 0.72,
      steerKind: "rudder",
      steerLock: 0.30 * Math.pow(34 / L, 0.15),
      steerRate: 1.5 * Math.pow(34 / L, 0.40),
      yawRate: yawRate, yawAccel: yawRate / tau, yawDamp: 0.55 * (2.44 / tau),
      thrusterYaw: 0.10 * Math.sqrt(34 / L),
      swayL: 0.50 * Math.pow(34 / L, 0.40), swayQ: 0.09 * Math.pow(34 / L, 0.40),
      pivotAft: L * 0.27,
      trimRestDeg: 1.2 * Math.pow(34 / L, 0.3), trimHumpDeg: 2.6 * Math.pow(34 / L, 0.3),
      trimPlaneDeg: 1.2,
      heelSign: 1,                                  // displacement: heels OUT of the turn
      heelGain: 0.030 * Math.pow(34 / L, 0.4),
      maxHeel: 0.075 * Math.sqrt(34 / L),
      rideAbove: 0.05,
      // A 156 m 10,000-tonne hull in a 0.4 m swell should be a WALL, not a cork.
      waveGain: 0.22 * Math.pow(34 / L, 0.6),
      slamV: 6.0 * Math.pow(L / 34, 0.25),
      deckY: S.freeboard + 0.07, boardY: S.platY + 0.09,
      sternOffset: L * 0.5,
      // THE BRIDGE EYE — the same numbers buildYacht §5 draws the bridge from
      // (bTier = second-from-top tier, console clamped human-sized), so the
      // first-person helm (city/view.js) and the take-the-helm walk-up point
      // (city/boatwalk.js) land you standing between the helm seats, behind
      // the console, looking out the raked glass. A different formula here is
      // a captain steering from inside a bulkhead.
      helm: {
        x: 0,
        y: S.deckY[Math.max(1, S.tiers - 1)] + 1.66,
        z: S.supZ1[Math.max(1, S.tiers - 1)] - clamp(0.032 * L, 1.65, 4.25) - 0.9,
      },
      wakeScale: 5.0 * (S.beam / 7.6),
      audio: "truck",
    };
  }

  /* ==========================================================================
     3. THE GEOMETRY — one builder, every size
     ========================================================================== */
  const _sph = new Map();
  function sphGeo(K, r, seg) {
    const key = r + "|" + seg;
    let g = _sph.get(key);
    if (!g) { g = new K.THREE.SphereGeometry(r, seg, Math.max(4, seg >> 1)); g._shared = true; _sph.set(key, g); }
    return g;
  }

  function buildYacht(S, art) {
    const K = kit();
    const THREE = window.THREE;
    if (!K || !THREE) return new (THREE ? THREE.Group : Object)();
    const b = new THREE.Group();
    const L = S.loa, HB = S.halfBeam, FB = S.freeboard, KEEL = S.keel;
    const M = K.M;

    // ---- PALETTE. Warm cream hull AND superstructure in ONE continuous colour
    // (the reference's defining feature), teak decks, near-black glass.
    // roleMat() is water_hulls' own cached-material helper routed through
    // CBZ.vehicleMat, so this is not a 567th raw material construction.
    const cream = K.roleMat("yc-cream", "paint", art && art.hull != null ? art.hull : 0xe9e2d2);
    const boot = K.roleMat("yc-boot", "plastic", 0x171b20);            // antifoul boot stripe
    const teak = M.teak();
    const teakDk = M.teakDk();
    const glass = M.glass();                                            // the ONE fleet glass
    const chrome = M.chrome();                                          // stanchions + rails
    const grey = M.grey();
    const dark = M.dark();
    const pad = M.pad();
    const liner = M.liner(), wood = M.wood(), screen = M.screen(), warm = M.warm();
    const white = K.roleMat("yc-white", "paint", 0xf2f4f5);             // radomes, deck markings
    const pool = K.sharedMat("yc-pool", 0x2f93b8, { emissive: 0x0b2631, ei: 0.20 });
    const bTier = Math.max(1, S.tiers - 1);
    const garageBayDepth = S.garage ? clamp(0.060 * L, 3.2, 6.6) : 0;

    // ---- 1) HULL. ONE LOFTED SHELL, driven by the SAME solve numbers.
    // It was seven width-stepped prisms: six visible plan jumps down each
    // flank, vertical topsides and a flat bottom. Nothing changes about the
    // ship's dimensions here — beamFrac(), sheerRise() and keelFrac() are fed
    // to the loft verbatim as its plan, sheer and keel curves — but the six
    // steps become one surface with a round bilge forward and a hard chine
    // aft, flare at the entry, tumblehome aft and a raked transom.
    //
    // THE GARAGE DOOR IS NOW A RECESSED PANEL, not a hole. The loft primitive
    // takes a deck opening (o.cockpit) but has no side opening, so cutting the
    // flank would mean splitting the shell into five lofts and creasing the
    // topsides at four stations. The bay, its sole, bulkhead, cradles, tender
    // and light are all still there behind it, and the door still swings; what
    // it opens onto is the recess rather than a rectangular void.
    const HL = (K.loft && K.loft()) || CBZ.hullLoft || null;
    let st = null, out = null;
    if (HL) {
      st = HL.stationsFromLines({
        loa: L, beam: S.beam, draft: S.draft, freeboard: FB,
        roundBilge: true, bilgeN: 2.2, maxBeamHeight: 0.74,
        flareBow: 18, tumblehome: 3, transomRake: 4,
        n: clamp(Math.round(L / 4) + 9, 17, 33),
        // beamFrac() floors at 0.03 of the beam, which on a 156 m ship is a
        // 66 cm stem station — far wider than the loft's collapse threshold,
        // so the two halves never meet and the bow ends in an open hole. The
        // plan must reach EXACTLY zero at the stem; nothing else about the
        // curve changes.
        planHalfBeam: function (t) { return t >= 0.995 ? 0 : beamFrac(2 * t - 1); },
        keelProfile: function (t) { return keelFrac(2 * t - 1); },
        sheerProfile: function (t) { return FB + sheerRise(S, 2 * t - 1); },
      });
      if (K.warpBilge) K.warpBilge(st, 4.6, 1.9, 0.24, 0.58);
      if (K.loftHull) K.loftHull(b, st, cream, { rings: 13, transom: "flat" });
      out = HL.outline(st);
    }
    const sheerAt = function (z) { return out ? out.sheerYAt(z) : FB; };
    const hbAt = function (z) { return out ? out.halfBeamAt(z) : HB; };
    const keelAt = function (z) { return out ? out.keelYAt(z) : KEEL; };
    // boot stripe at the waterline, ON the skin (the old one was a straight
    // 0.86 L box at the maximum half-beam, so both ends stood off the hull)
    if (HL && st && K.skinRun) {
      [1, -1].forEach(function (side) {
        const bs = HL.strip(K.skinRun(st, side, -L * 0.485, L * 0.44, S.draft * 0.06, 0.02, L * 0.03),
          Math.max(0.09, S.draft * 0.07), boot, { segments: 72, radial: 5 });
        if (bs) { bs.castShadow = false; b.add(bs); }
        // the aft chine strake — the hard corner the warped bilge makes
        const ch = HL.strip(K.chineRun(st, side, S.beam * 0.006, 0).filter(function (p) { return p[2] < L * 0.10; }),
          Math.max(0.07, S.beam * 0.012), cream, { segments: 44, radial: 4 });
        if (ch) { ch.castShadow = false; b.add(ch); }
        // BOW THRUSTER TUNNEL and the anchor pocket, both on the skin
        if (K.hullDisc) K.hullDisc(b, st, side, L * 0.385, keelAt(L * 0.385) * 0.55, Math.max(0.35, L * 0.012), dark, { thick: 0.12, seg: 16 });
        // proud by 1 cm, not sunk into the plating: a panel pushed inward
        // grazes the skin and z-fights, which reads as a black box on the bow
        if (K.hullPanel) K.hullPanel(b, st, side, L * 0.445, FB - S.draft * 0.28, L * 0.030, L * 0.016, dark, { thick: 0.06, outset: 0.010 });
      });
    }
    // BULBOUS BOW, seated on the forefoot the loft actually drew rather than
    // at a fixed fraction of the moulded depth.
    const bulbZ = L * 0.455;
    const bulb = K.addCyl(b, S.beam * 0.055, L * 0.055, 0, keelAt(bulbZ) - S.draft * 0.10, bulbZ, cream, 10);
    bulb.rotation.x = Math.PI / 2;
    K.addCyl(b, S.beam * 0.040, S.beam * 0.040, 0, keelAt(bulbZ) - S.draft * 0.10, bulbZ + L * 0.030, cream, 10).rotation.x = Math.PI / 2;

    // ---- 2) THE BEACH PLATFORM at the waterline: the ONE boarding point from
    // the sea, and the reference's whole stern read.
    const platW = HB * 2 * beamFrac(-0.985) * 0.74;
    K.addBox(b, platW, 0.20, L * 0.045, 0, S.platY, S.sternZ - L * 0.018, teak);
    // boarding steps down into the water (a swimmer must be able to haul out)
    for (let i = 0; i < 3; i++) {
      K.addBox(b, 1.2, 0.10, 0.34, platW * 0.34, S.platY - 0.42 * (i + 1), S.sternZ - L * 0.012, chrome);
    }
    // TRANSOM STAIRS platform -> main deck. FB is far past physics.js's 0.45 m
    // STEP_UP, so without these the boarding point is a dead end.
    const nStep = Math.max(4, Math.round((FB - S.platY) / 0.34));
    [1, -1].forEach(function (side) {
      K.addStairs(b, side * platW * 0.38, Math.min(1.5, platW * 0.20), S.sternZ + L * 0.004, 1,
        S.platY + 0.10, FB + 0.07, nStep, teak);
    });

    // ---- 3) THE DECKS. Main deck sole aft of the superstructure, side decks
    // both sides full length, then one sole per tier. Rails on every edge.
    K.addBox(b, HB * 1.72, 0.16, Math.abs(S.supZ0[0] - S.sternZ) - L * 0.03, 0,
      FB, (S.supZ0[0] + S.sternZ) * 0.5 + L * 0.012, teak);
    // POOL + loungers on the aft main deck (the reference's stern).
    const poolW = Math.min(HB * 0.9, L * 0.055), poolL = L * 0.055;
    const poolZ = S.supZ0[0] - poolL * 0.9;
    K.addBox(b, poolW + 0.5, 0.22, poolL + 0.5, 0, FB + 0.11, poolZ, teakDk);
    K.addBox(b, poolW, 0.10, poolL, 0, FB + 0.20, poolZ, pool);
    // sun loungers: drawn as merged geometry, deliberately WITHOUT propuse
    // anchors — a propuse anchor is world-space and this deck sails away.
    for (let i = 0; i < 4; i++) {
      const lx = (i < 2 ? 1 : -1) * (poolW * 0.5 + 1.5), lz = poolZ + (i % 2 ? 1.4 : -1.4);
      K.addBox(b, 0.78, 0.14, 2.05, lx, FB + 0.36, lz, pad);
      K.addBox(b, 0.10, 0.42, 0.10, lx + 0.34, FB + 0.20, lz + 0.85, chrome);
      K.addBox(b, 0.10, 0.42, 0.10, lx - 0.34, FB + 0.20, lz + 0.85, chrome);
    }

    // SIDE DECKS as ribbons ON the deck edge. The 0.62 L boxes they used to be
    // ran at a constant half-beam through a bow that has already shed a
    // quarter of it by the forward end of the run, so the outboard edge of
    // each side deck floated outside the ship.
    const sdZ0 = -0.30 * L, sdZ1 = 0.31 * L;
    [1, -1].forEach(function (side) {
      if (out && K.sheet) {
        const inner = [], outer = [];
        for (let i = 0; i <= 18; i++) {
          const z = sdZ0 + (sdZ1 - sdZ0) * (i / 18), y = sheerAt(z) + 0.09;
          outer.push([side * Math.max(0.4, hbAt(z) - 0.14), y, z]);
          inner.push([side * Math.max(0.3, hbAt(z) - 0.14 - S.sideW), y, z]);
        }
        K.sheet(b, [inner, outer], teak, { flip: side > 0 });
        K.bulwark(b, out, side, sdZ0, sdZ1, 0.96, 0.16, cream, cream, chrome, L * 0.02);
        K.sheerRail(b, out, side, sdZ0 + L * 0.01, sdZ1 - L * 0.01, 0.96, chrome,
          { spacing: 2.2, inset: 0.30, height: 0.90 });
      } else {
        K.addBox(b, S.sideW, 0.14, L * 0.62, side * (HB - S.sideW * 0.5 - 0.10), FB + 0.09, L * 0.02, teak);
        K.addRail(b, side * (HB - 0.16), sdZ0, sdZ1, FB + 0.16, chrome, 2.2);
      }
    });

    // ---- 3b) THE FOREDECK, and the way up onto it. The deck edge rises with
    // the sheer, so the bow deck stands ~1.1 m above the side deck on a 156 m
    // hull — well past physics.js's 0.45 m STEP_UP. A real yacht answers that
    // with two or three steps at the break of the foredeck, and so does this:
    // drawn and declared from the SAME call arguments, both sides.
    const fdTop = FB + sheerRise(S, 0.72);
    // The foredeck is the shape of the DECK EDGE forward, not a rectangle: at
    // 0.46 L the hull carries a fifth of its beam and the old slab (sized off
    // the beam at 0.36 L) stood clear outboard of the stem on every size.
    if (out && K.sheet) {
      const fp = [], fm = [], fs = [];
      for (let i = 0; i <= 14; i++) {
        const z = 0.26 * L + (0.235 * L) * (i / 14);
        const y = sheerAt(z) + 0.08, x = Math.max(0.10, hbAt(z) - 0.12);
        fp.push([x, y, z]); fm.push([0, y + 0.06, z]); fs.push([-x, y, z]);
      }
      K.sheet(b, [fp, fm, fs], teak, {});
    } else {
      K.addBox(b, HB * 2 * beamFrac(0.72) * 0.86, 0.16, L * 0.20, 0, fdTop + 0.08, 0.36 * L, teak);
    }
    // a sunpad on it (kept AFT of the helideck footprint) and the pulpit rail
    K.addBox(b, HB * beamFrac(0.60) * 1.10, 0.20, L * 0.045, 0, sheerAt(0.278 * L) + 0.24, 0.278 * L, pad);
    [1, -1].forEach(function (side) {
      K.addStairs(b, side * HB * beamFrac(0.66) * 0.55, 1.1, 0.252 * L, 1, FB + 0.16, fdTop + 0.16, 4, teak);
      // the PULPIT rail follows the deck edge to the stem; a straight run at
      // one x left the forward third of it standing outside the bow
      if (out && K.sheerRail) K.sheerRail(b, out, side, 0.28 * L, 0.462 * L, 0.09, chrome, { spacing: L * 0.035, inset: 0.22, height: 0.95 });
      else K.addRail(b, side * HB * beamFrac(0.80) * 0.92, 0.28 * L, 0.46 * L, fdTop + 0.16, chrome, 2.0);
    });

    // ---- 4) THE SUPERSTRUCTURE. One block per tier, each narrower and shorter,
    // with a long horizontal band of near-black glass on every face. Soft
    // radiused corners are read as a chamfer prism rather than a box.
    for (let k = 0; k <= S.tiers; k++) {
      const y0 = S.deckY[k], y1 = S.deckY[k] + S.deckH - 0.22;
      const hb = S.supHB[k], z0 = S.supZ0[k], z1 = S.supZ1[k];
      // A real shell with windows and an aft doorway. This replaces the old
      // closed prism whose paint sat directly behind every pane of glass.
      K.addCabinShell(b, { width: hb * 2, z0: z0, z1: z1, y0: y0, y1: y1,
        doorW: Math.min(1.9, hb * 0.58), body: cream, liner: liner, glass: glass });
      // Each tier is a real room, not just an opaque wedding-cake block. The
      // same tier index names the room, furnishes it and feeds the visual census.
      const roomId = k === 0 ? "super-saloon" : (k === bTier ? "super-bridge" : "super-tier-" + k);
      const roomLabel = k === 0 ? "Main saloon" : (k === bTier ? "Bridge" : (k === S.tiers ? "Observation lounge" : "Upper lounge " + k));
      const span = Math.abs(z1 - z0), midZ = (z0 + z1) * 0.5;
      K.declareRoom(b, roomId, roomLabel);
      K.addBox(b, hb * 1.90, 0.10, span * 0.985, 0, y0 + 0.10, midZ, wood);
      K.addBox(b, hb * 1.86, 0.06, span * 0.98, 0, y1 - 0.20, midZ, liner);
      if (k !== bTier) {
        const loungeZ = z0 + Math.min(4.4, span * 0.24);
        const setteeD = Math.min(5.2, span * 0.28);
        K.addFixtureBox(b, "settee", 0.72, 0.50, setteeD, hb * 0.63, y0 + 0.36, loungeZ, pad);
        K.addFixtureBox(b, "settee-back", 0.14, 0.78, setteeD, hb * 0.86, y0 + 0.72, loungeZ, pad);
        K.addTable(b, hb * 0.18, y0 + 0.10, loungeZ, Math.min(2.1, hb * 0.55), 1.25, wood, chrome);
        const diningZ = z0 + span * 0.62;
        K.addTable(b, 0, y0 + 0.10, diningZ, Math.min(3.0, hb * 0.92), 1.35, wood, chrome);
        [-1, 1].forEach(function (side) {
          K.addSeat(b, side * Math.min(1.45, hb * 0.42), y0 + 0.10, diningZ - 0.92, Math.PI, pad, chrome);
          K.addSeat(b, side * Math.min(1.45, hb * 0.42), y0 + 0.10, diningZ + 0.92, 0, pad, chrome);
        });
        K.addCabinet(b, -hb * 0.78, y0 + 0.10, z0 + span * 0.40, Math.min(0.72, hb * 0.18), 0.96, Math.min(3.8, span * 0.20), liner);
        K.addFixtureBox(b, "bar-counter", Math.min(0.82, hb * 0.20), 0.10, Math.min(3.8, span * 0.20), -hb * 0.76, y0 + 1.12, z0 + span * 0.40, wood);
        K.addScreen(b, -hb + 0.14, y0 + 1.48, loungeZ, Math.min(1.8, span * 0.12), 0.82, Math.PI / 2, screen);
        K.addFixtureBox(b, "ceiling-light", Math.min(1.4, hb * 0.35), 0.04, 0.32, 0, y1 - 0.25, loungeZ, warm);
        // Long ships need room rhythm, not a single sofa stranded in an 80 m
        // corridor. Repeat human-scale seating bays and open bulkhead frames;
        // the count derives from room length and caps at five zones.
        const zoneCount = clamp(Math.round(span / 14), 1, 5);
        for (let q = 1; q < zoneCount; q++) {
          const z = z0 + span * (0.16 + (0.68 * q) / zoneCount);
          const side = q % 2 ? -1 : 1;
          const sx = side * hb * 0.54;
          K.addFixtureBox(b, "lounge-settee", Math.min(3.4, hb * 0.72), 0.48, 0.72, sx, y0 + 0.35, z, pad);
          K.addFixtureBox(b, "lounge-settee-back", Math.min(3.4, hb * 0.72), 0.76, 0.14, sx, y0 + 0.70, z - 0.30, pad);
          K.addTable(b, sx - side * Math.min(1.55, hb * 0.28), y0 + 0.10, z, 1.25, 0.92, wood, chrome);
          K.addFixtureBox(b, "area-rug", Math.min(4.8, hb * 1.05), 0.025, 3.0, sx * 0.45, y0 + 0.17, z, teakDk);
          [-1, 1].forEach(function (frameSide) {
            K.addBox(b, 0.16, S.deckH * 0.72, 0.16, frameSide * hb * 0.72,
              y0 + S.deckH * 0.40, z - span * 0.045, liner);
          });
          K.addBox(b, hb * 1.44, 0.16, 0.18, 0, y1 - 0.30, z - span * 0.045, liner);
          K.addFixtureBox(b, "ceiling-light", Math.min(1.4, hb * 0.35), 0.04, 0.32, 0, y1 - 0.25, z, warm);
        }
      }
      // this tier's own open deck: the walkable strip forward and aft of the
      // block above it, plus a rail all round
      if (k < S.tiers) {
        const hbUp = S.supHB[k + 1], z0Up = S.supZ0[k + 1], z1Up = S.supZ1[k + 1];
        K.addBox(b, hb * 2, 0.14, Math.abs(z0Up - z0), 0, S.deckY[k + 1], (z0 + z0Up) * 0.5, teak);
        K.addBox(b, hb * 2, 0.14, Math.abs(z1 - z1Up), 0, S.deckY[k + 1], (z1 + z1Up) * 0.5, teak);
        [1, -1].forEach(function (side) {
          K.addBox(b, hb - hbUp, 0.14, Math.abs(z1Up - z0Up), side * (hb + hbUp) * 0.5, S.deckY[k + 1], (z0Up + z1Up) * 0.5, teak);
          K.addRail(b, side * (hb - 0.14), z0 + 0.3, z1 - 0.3, S.deckY[k + 1] + 0.07, chrome, 2.2);
        });
      } else {
        // the top tier's own open sun deck aft of the block
        K.addRail(b, hb - 0.14, z0 + 0.3, z1 - 0.3, y1 + 0.07, chrome, 2.2);
        K.addRail(b, -(hb - 0.14), z0 + 0.3, z1 - 0.3, y1 + 0.07, chrome, 2.2);
      }
    }

    // ---- 4b) THE STAIRS between tiers, on the centreline at each tier's aft
    // face. Drawn from the SAME call arguments the deck spec uses, so the boxes
    // you see and the surfaces you stand on can never disagree. Without them
    // every deck above the main one is unreachable: a 3.5 m deck height is
    // eight times physics.js's 0.45 m STEP_UP.
    for (let k = 0; k < S.tiers; k++) {
      const y0 = S.deckY[k] + 0.10, y1 = S.deckY[k + 1] + 0.08;
      const n = Math.max(6, Math.round((y1 - y0) / 0.32));
      const stairX = Math.max(1.05, S.supHB[k] * 0.56);
      K.addStairs(b, stairX, 1.5, S.supZ0[k] + 0.6, 1, y0, y1, n, teak);
      [1, -1].forEach(function (side) {
        K.addBox(b, 0.07, 1.00, n * 0.36, stairX + side * 0.80, y0 + (y1 - y0) * 0.5 + 0.5, S.supZ0[k] + 0.6 + n * 0.18, chrome);
      });
    }

    // ---- 5) THE BRIDGE. On a hull this size the wheelhouse is NOT at the very
    // top: it takes the forward face of the second-from-top tier, which is what
    // the reference shows and what a real 156 m yacht does.
    const bY = S.deckY[bTier], bHB = S.supHB[bTier], bZ = S.supZ1[bTier];
    const scr = K.addBox(b, bHB * 1.86, S.deckH * 0.44, 0.14, 0, bY + S.deckH * 0.62, bZ - 0.03 * L, glass);
    scr.rotation.x = -0.30;                                  // raked wheelhouse screen
    // Human-sized bridge furniture. The old console depth was a percentage of
    // LOA, so on the 156 m ship it became a monolithic room-sized slab.
    const consoleZ = bZ - clamp(0.032 * L, 1.65, 4.25);
    const consoleW = Math.min(bHB * 1.62, 10.5);
    K.addFixtureBox(b, "bridge-console", consoleW, 0.78, 0.82, 0, bY + 0.55, consoleZ, dark);
    const nDisplay = clamp(Math.round(consoleW / 1.75), 3, 6);
    for (let i = 0; i < nDisplay; i++) {
      const x = nDisplay === 1 ? 0 : -consoleW * 0.38 + (consoleW * 0.76 * i) / (nDisplay - 1);
      K.addScreen(b, x, bY + 1.08, consoleZ - 0.43, Math.min(1.25, consoleW / nDisplay * 0.78), 0.48, 0, screen);
    }
    K.addFixtureCyl(b, "helm-wheel", 0.28, 0.07, 0, bY + 1.18, consoleZ + 0.43, dark, 12).rotation.x = Math.PI / 2;
    [-1.0, 1.0].forEach(function (x) {
      K.addSeat(b, x, bY + 0.10, consoleZ - 1.25, 0, pad, chrome);
    });
    K.addTable(b, Math.min(2.35, bHB * 0.55), bY + 0.10, consoleZ - 1.25, 1.15, 1.45, wood, chrome);
    K.addCabinet(b, -bHB * 0.78, bY + 0.10, consoleZ - 1.20, Math.min(0.72, bHB * 0.18), 0.92, 2.2, liner);
    K.addFixtureBox(b, "bridge-light", Math.min(1.8, bHB * 0.40), 0.04, 0.34, 0, bY + S.deckH - 0.34, consoleZ - 0.4, warm);
    // bridge wings — the overhangs a big ship berths from
    [1, -1].forEach(function (side) {
      K.addBox(b, (S.halfBeam - bHB) * 0.9, 0.14, 0.045 * L, side * (bHB + (S.halfBeam - bHB) * 0.45),
        bY, bZ - 0.045 * L, teak);
      K.addRail(b, side * (S.halfBeam - 0.2), bZ - 0.068 * L, bZ - 0.022 * L, bY + 0.07, chrome, 1.6);
    });

    // ---- 7) THE MAST CLUSTER. Dimensions are equipment dimensions, not a raw
    // percentage of hull length: a radar dome does not become a 5 m boulder
    // merely because the ship beneath it is 156 m long.
    const topY = S.deckY[S.tiers] + S.deckH - 0.22;
    const mastZ = 0.02 * L, mastHB = S.supHB[S.tiers];
    const mastH = clamp(3.2 + L * 0.011, 3.7, 5.0);
    const mastBaseY = topY + 0.10, mastBarY = mastBaseY + mastH * 0.62;
    [1, -1].forEach(function (side) {
      K.addTubeBetween(b,
        [side * mastHB * 0.58, mastBaseY, mastZ - 0.55],
        [side * mastHB * 0.38, mastBarY, mastZ], 0.10, grey, 8);
    });
    K.addTubeBetween(b, [-mastHB * 0.38, mastBarY, mastZ], [mastHB * 0.38, mastBarY, mastZ], 0.11, grey, 8);
    K.addTubeBetween(b, [0, mastBarY, mastZ], [0, mastBaseY + mastH, mastZ], 0.08, grey, 8);
    // three radomes of DIFFERENT size — one idea, three scales
    const rr = clamp(0.50 + L * 0.0022, 0.58, 0.86);
    [[0, 0.72, 1.12], [0.62, 0.30, 0.78], [-0.62, 0.30, 0.78]].forEach(function (o) {
      const r = rr * o[2];
      const dome = new THREE.Mesh(sphGeo(K, r, 10), white);
      dome.position.set(o[0] * mastHB, mastBarY + o[1] + r * 0.4, mastZ - r * 0.6);
      dome.castShadow = false; b.add(dome);
      K.addCyl(b, r * 0.34, r * 0.62, o[0] * mastHB, mastBarY + o[1] - r * 0.31, mastZ - r * 0.6, grey, 8);
    });
    // Four genuinely slim stacks, each landed on a common exhaust plinth.
    const stackR = clamp(0.24 + L * 0.0009, 0.27, 0.38);
    const stackH = clamp(1.65 + L * 0.005, 1.85, 2.45);
    K.addFixtureBox(b, "exhaust-plinth", mastHB * 1.35, 0.28, 1.35, 0, mastBaseY + 0.14, mastZ - 1.45, grey);
    for (let i = 0; i < 4; i++) {
      const sx = (i - 1.5) * Math.max(stackR * 2.7, mastHB * 0.24);
      const st = K.addCyl(b, stackR, stackH, sx, mastBaseY + 0.28 + stackH * 0.5, mastZ - 1.45, grey, 10);
      st.rotation.x = 0.16;
      K.addCyl(b, stackR * 0.84, 0.18, sx, mastBaseY + 0.28 + stackH, mastZ - 1.45 - Math.sin(0.16) * stackH * 0.5, dark, 10);
    }

    // ---- 8) THE HELIDECKS.
    const padded = [];
    if (C.YACHT_HELIDECK !== false && S.pads > 0) {
      // FORWARD PAD, on the foredeck, with the painted circled H. Its height is
      // derived FROM the foredeck (0.18 m proud of it — one low step, and a
      // real helideck is a raised platform), never from the waterline: the two
      // rise with the sheer together and cannot cross.
      const fwdY = fdTop + 0.34;
      helipad(K, b, 0, fwdY, S.zFwdPad, S.padFwdR, teak, white, chrome, grey);
      padded.push({ x: 0, y: fwdY, z: S.zFwdPad, r: S.padFwdR, which: "fwd" });
      if (S.pads > 1) {
        // UPPER PAD, cantilevered aft off the top tier — wider than the tier it
        // stands on, exactly as in the reference.
        const uy = topY + 0.14;      // one step up off the sun deck
        helipad(K, b, 0, uy, S.zUpPad, S.padUpR, teak, white, chrome, grey);
        // the cantilever's own supports, so it is not floating
        [1, -1].forEach(function (side) {
          K.addBox(b, 0.22, S.deckH * 0.9, 0.22, side * S.padUpR * 0.78, uy - S.deckH * 0.45, S.zUpPad - S.padUpR * 0.55, grey);
        });
        // helipad()'s top surface IS uy — the airframe stands on that, not on
        // an offset from it.
        padded.push({ x: 0, y: uy, z: S.zUpPad, r: S.padUpR, which: "up" });
      }
    }

    // ---- 9) SIDE SHELL GARAGES: a door panel in the flank each side, and the
    // tender/car deck behind it. The panel is a separate NAMED mesh so the
    // garage driver can swing it without touching the merged hull.
    const doors = [], stowed = [];
    if (C.YACHT_GARAGE !== false && S.garage) {
      const GA = S.garage;
      K.declareRoom(b, "super-garage-port", "Port tender garage");
      K.declareRoom(b, "super-garage-starboard", S.carDeck ? "Starboard tender and vehicle garage" : "Starboard tender garage");
      [1, -1].forEach(function (side, i) {
        const hbAt = HB * beamFrac(GA.z / (0.5 * L));
        const bayCenterX = hbAt - garageBayDepth * 0.55;
        const innerX = hbAt - garageBayDepth;
        // The dark surface is the real inner bulkhead, not a fake black panel
        // immediately behind the shell door. The full bay depth stays visible.
        K.addBox(b, 0.22, GA.h * 0.94, GA.len * 0.94,
          side * innerX, GA.y + GA.h * 0.5, GA.z, dark);
        // addBox is (w=x, h=y, d=z): the garage runs FORE AND AFT for GA.len and
        // across the beam for the hull's width there. An earlier draft had these
        // two swapped, which drew a 21 m sole athwart a 22 m hull.
        K.addBox(b, hbAt * 1.7, 0.14, GA.len * 0.9, 0, GA.y, GA.z, grey);          // garage sole
        // THE TENDER ON ITS CRADLE. A garage with nothing in it is the same
        // stat fiction as a helideck with no pad: the owner asked for "small
        // boats attached", and the thing you see stowed here IS the thing
        // launchTender() puts in the water (it hides this node and mints the
        // real 4.5 m RIB from the same registry). One named group, noMerge, so
        // hiding it costs nothing.
        const stow = new THREE.Group();
        stow.name = "yacht_tender_" + (side > 0 ? "p" : "s");
        stow.userData.noMerge = true;
        stow.position.set(side * bayCenterX, GA.y + 0.45, GA.z);
        stow.rotation.y = Math.PI / 2;
        const tl = Math.min(GA.len * 0.42, 6.4);
        const tub = K.roleMat("yc-tender", "plastic", 0x2b3138);
        stow.add(new THREE.Mesh(K.boxGeo(1.55, 0.42, tl), K.roleMat("yc-tenderh", "paint", 0xdfe4e8)));
        [1, -1].forEach(function (sd) {
          const t = new THREE.Mesh(K.cylGeo(0.24, 0.24, tl * 0.92, 8), tub);
          t.position.set(sd * 0.72, 0.26, 0); t.rotation.x = Math.PI / 2; stow.add(t);
        });
        const con = new THREE.Mesh(K.boxGeo(0.5, 0.55, 0.5), dark);
        con.position.set(0, 0.5, tl * 0.10); stow.add(con);
        const cr = new THREE.Mesh(K.boxGeo(1.9, 0.5, 0.3), grey);
        cr.position.set(0, -0.42, 0); stow.add(cr);
        b.add(stow);
        stowed.push(stow.name);

        // Cradle rails, service locker and a landed overhead light make this a
        // launch room instead of a tender suspended in a dark void.
        K.addFixtureBox(b, "tender-cradle", Math.min(2.8, hbAt * 0.42), 0.20, 0.18,
          side * bayCenterX, GA.y + 0.16, GA.z - tl * 0.28, chrome);
        K.addFixtureBox(b, "tender-cradle", Math.min(2.8, hbAt * 0.42), 0.20, 0.18,
          side * bayCenterX, GA.y + 0.16, GA.z + tl * 0.28, chrome);
        K.addCabinet(b, side * (innerX + 0.45), GA.y + 0.07, GA.z + GA.len * 0.34,
          Math.min(1.0, hbAt * 0.18), Math.min(1.8, GA.h * 0.70), Math.min(2.2, GA.len * 0.18), liner);
        K.addFixtureBox(b, "garage-light", Math.min(1.8, hbAt * 0.34), 0.05, 0.28,
          side * bayCenterX, GA.y + GA.h - 0.28, GA.z, warm);

        // THE SHELL DOOR. The hull is one continuous lofted surface now, so
        // the door is a RECESSED PANEL on the skin rather than the lid of a
        // rectangular hole: a dark reveal cut back into the topsides, and the
        // cream door leaf sitting in it. It still swings (driveDoors reads
        // userData.yachtDoor), and it still opens onto the real bay.
        const doorY = GA.y + GA.h * 0.5;
        const skinX = (st && K.hullSectionX) ? K.hullSectionX(st, GA.z, doorY) : hbAt;
        if (K.hullPanel && st) {
          K.hullPanel(b, st, side, GA.z, doorY, GA.len + 0.34, GA.h + 0.30, dark,
            { thick: 0.08, outset: -0.02 });
        }
        const d = new THREE.Mesh(K.boxGeo(0.16, GA.h, GA.len), cream);
        d.position.set(side * (skinX + 0.03), doorY, GA.z);
        d.name = "yacht_door_" + (side > 0 ? "p" : "s");
        d.userData.noMerge = true;                       // it MOVES: never bake it
        d.userData.yachtDoor = { side: side, hinge: GA.y, h: GA.h, x: side * (skinX + 0.03) };
        d.castShadow = false;
        b.add(d);
        doors.push(d.name);
      });
    }

    // ---- 10) NAV LIGHTS + ground tackle. navLights() carries three separate
    // detector contracts in its exact colours — never re-author them.
    K.addBox(b, 0.030 * L, 0.020 * L, 0.030 * L, 0, sheerAt(0.44 * L) + 0.35, 0.44 * L, chrome); // windlass
    // THE ANCHOR, in its pocket on each flank. It used to be a single box on
    // the CENTRELINE at 0.482 L, where the hull is a few centimetres wide, so
    // it hung off the stem like a slab bolted to the point of the bow.
    [1, -1].forEach(function (side) {
      if (st && K.hullPanel) K.hullPanel(b, st, side, L * 0.445, FB - S.draft * 0.28, L * 0.020, L * 0.011, chrome, { thick: 0.05, outset: 0.022 });
      else K.addBox(b, 0.016 * L, 0.026 * L, 0.036 * L, side * HB * 0.2, FB * 0.55, 0.470 * L, chrome);
    });
    // the sidelights sit on the DECK EDGE at 0.42 L, where the hull carries
    // about half its beam — HB put both of them out over the water.
    K.navLights(b, hbAt(0.42 * L), sheerAt(0.42 * L) + 0.30, 0.42 * L, S.sternZ + 0.02 * L, S.deckY[S.tiers] + 0.11 * L);

    const root = K.finish(b, {
      width: S.beam, length: L, height: S.airDraft, wheelbase: L * 0.6,
    });
    root.userData.yacht = { solve: S, pads: padded, doors: doors, stowed: stowed };
    return root;
  }

  // Sheer: the deck edge rises toward the stem. 0 amidships-aft, +0.055L at the
  // stem — the reference's pronounced sheer, and what stops a big hull reading
  // as an extruded brick.
  function sheerRise(S, t) {
    if (t <= 0) return 0;
    // 0.014 L at the stem — 2.2 m on a 156 m hull, which is what a real one
    // carries. It was 0.055 L for one draft and that is 8.6 m: the side deck
    // (a flat box at constant height) ended up BURIED inside the hull forward,
    // and the foredeck stood four metres above anything you could reach.
    // Sheer bends the silhouette; it must never outrun a stair flight.
    return 0.014 * S.loa * Math.pow(t, 2.1);
  }
  // Moulded depth fraction: full draft along the midbody, tucking up at both
  // ends so the ship has a real forefoot and a real counter.
  function keelFrac(t) {
    const a = Math.abs(t);
    if (a <= 0.66) return 1;
    return Math.max(0.10, 1 - Math.pow((a - 0.66) / 0.34, 1.6) * 0.92);
  }

  // A certified helideck: teak/nonskid disc, a painted white perimeter circle,
  // the H, a safety net skirt and four floods. ~5 draw calls, all merged.
  function helipad(K, b, cx, y, cz, R, deckMat, paintMat, railMat, greyMat) {
    const SEG = 22;
    // the deck itself — a shallow cylinder so the edge reads round
    K.addCyl(b, R, 0.18, cx, y - 0.09, cz, deckMat, SEG);
    // painted perimeter circle at 0.88R
    for (let i = 0; i < SEG * 2; i++) {
      const a = (i / (SEG * 2)) * Math.PI * 2;
      const seg = K.addBox(b, R * 0.09, 0.03, R * 0.16,
        cx + Math.cos(a) * R * 0.88, y + 0.02, cz + Math.sin(a) * R * 0.88, paintMat);
      seg.rotation.y = -a;
    }
    // the H — two uprights and a crossbar, 0.30R tall
    const hh = R * 0.30, hw = R * 0.20;
    K.addBox(b, R * 0.055, 0.03, hh * 2, cx - hw, y + 0.02, cz, paintMat);
    K.addBox(b, R * 0.055, 0.03, hh * 2, cx + hw, y + 0.02, cz, paintMat);
    K.addBox(b, hw * 2, 0.03, R * 0.055, cx, y + 0.02, cz, paintMat);
    // safety net skirt + perimeter lights
    for (let i = 0; i < SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      K.addBox(b, 0.10, 0.06, 0.55, cx + Math.cos(a) * (R + 0.30), y - 0.28, cz + Math.sin(a) * (R + 0.30), greyMat);
      if (i % 3 === 0) K.addBox(b, 0.09, 0.14, 0.09, cx + Math.cos(a) * (R + 0.05), y + 0.09, cz + Math.sin(a) * (R + 0.05), railMat);
    }
  }

  /* ==========================================================================
     4. THE WALKABLE DECK SPEC — built from the SAME numbers as the geometry
     ========================================================================== */
  function yachtDeckSpec(S) {
    const L = S.loa, HB = S.halfBeam, FB = S.freeboard;
    const decks = [], walls = [];
    const platW = HB * 2 * beamFrac(-0.985) * 0.74;
    decks.push({ x: 0, z: S.sternZ - L * 0.018, w: platW, d: L * 0.045, top: S.platY + 0.10 });
    decks.push({
      x: 0, z: (S.supZ0[0] + S.sternZ) * 0.5 + L * 0.012,
      w: HB * 1.72, d: Math.abs(S.supZ0[0] - S.sternZ) - L * 0.03, top: FB + 0.08,
    });
    // side decks
    [1, -1].forEach(function (side) {
      decks.push({ x: side * (HB - S.sideW * 0.5 - 0.10), z: L * 0.02, w: S.sideW, d: L * 0.62, top: FB + 0.16 });
      walls.push({ x: side * (HB - 0.06), z: L * 0.02, w: 0.16, d: L * 0.62, y0: FB + 0.16, y1: FB + 1.20 });
    });
    // foredeck (up the sheer), and the flight that reaches it — the SAME
    // arguments buildYacht draws, so there is one source for both.
    const fdTop = FB + sheerRise(S, 0.72);
    decks.push({ x: 0, z: 0.36 * L, w: HB * 2 * beamFrac(0.72) * 0.86, d: L * 0.20, top: fdTop + 0.16 });
    K_stairDecks(decks, HB * beamFrac(0.66) * 0.55, 1.1, 0.252 * L, 1, FB + 0.16, fdTop + 0.16, 4);
    K_stairDecks(decks, -HB * beamFrac(0.66) * 0.55, 1.1, 0.252 * L, 1, FB + 0.16, fdTop + 0.16, 4);
    // Every tier gets an interior sole and perimeter walls with an aft doorway.
    // A previous solid block made the furnished room impossible to enter.
    for (let k = 0; k <= S.tiers; k++) {
      const hb = S.supHB[k], z0 = S.supZ0[k], z1 = S.supZ1[k];
      const span = Math.abs(z1 - z0), y0 = S.deckY[k] + 0.10, y1 = S.deckY[k] + S.deckH - 0.22;
      const doorW = Math.min(1.9, hb * 0.58), sideW = Math.max(0.25, hb - doorW * 0.5);
      decks.push({ x: 0, z: (z0 + z1) * 0.5, w: hb * 1.86, d: span * 0.94, top: y0 + 0.05 });
      walls.push({ x: hb, z: (z0 + z1) * 0.5, w: 0.14, d: span, y0: y0, y1: y1 });
      walls.push({ x: -hb, z: (z0 + z1) * 0.5, w: 0.14, d: span, y0: y0, y1: y1 });
      walls.push({ x: doorW * 0.5 + sideW * 0.5, z: z0, w: sideW, d: 0.14, y0: y0, y1: y1 });
      walls.push({ x: -(doorW * 0.5 + sideW * 0.5), z: z0, w: sideW, d: 0.14, y0: y0, y1: y1 });
      walls.push({ x: 0, z: z1, w: hb * 2, d: 0.14, y0: y0, y1: y1 });
      if (k < S.tiers) {
        const y = S.deckY[k + 1] + 0.08;
        decks.push({ x: 0, z: (S.supZ0[k] + S.supZ0[k + 1]) * 0.5, w: S.supHB[k] * 2, d: Math.abs(S.supZ0[k + 1] - S.supZ0[k]), top: y });
        decks.push({ x: 0, z: (S.supZ1[k] + S.supZ1[k + 1]) * 0.5, w: S.supHB[k] * 2, d: Math.abs(S.supZ1[k] - S.supZ1[k + 1]), top: y });
        [1, -1].forEach(function (side) {
          decks.push({
            x: side * (S.supHB[k] + S.supHB[k + 1]) * 0.5, z: (S.supZ0[k + 1] + S.supZ1[k + 1]) * 0.5,
            w: Math.max(0.6, S.supHB[k] - S.supHB[k + 1]), d: Math.abs(S.supZ1[k + 1] - S.supZ0[k + 1]), top: y,
          });
        });
      }
    }
    // the top tier's roof IS the upper sun deck. -0.22 is the SAME expression
    // buildYacht's tier prism ends at; a different constant here is a player
    // standing on nothing.
    const topY = S.deckY[S.tiers] + S.deckH - 0.22;
    decks.push({ x: 0, z: (S.supZ0[S.tiers] + S.supZ1[S.tiers]) * 0.5, w: S.supHB[S.tiers] * 2,
      d: Math.abs(S.supZ1[S.tiers] - S.supZ0[S.tiers]), top: topY });
    // the helidecks are surfaces you stand on
    if (C.YACHT_HELIDECK !== false && S.pads > 0) {
      // helipad() lays its deck as a cylinder spanning y-0.18..y, so the
      // walkable surface is EXACTLY the y it was drawn at. Both numbers below
      // are the same expressions buildYacht passes it — never an offset from
      // them, which is how a player ends up standing 12 cm above a helideck.
      decks.push({ x: 0, z: S.zFwdPad, w: S.padFwdR * 1.7, d: S.padFwdR * 1.7, top: fdTop + 0.34 });
      if (S.pads > 1) decks.push({ x: 0, z: S.zUpPad, w: S.padUpR * 1.7, d: S.padUpR * 1.7, top: topY + 0.14 });
    }
    // the garage sole is a deck (this is where a car sits, and it must ride)
    if (C.YACHT_GARAGE !== false && S.garage) {
      decks.push({ x: 0, z: S.garage.z, w: HB * 1.2 * beamFrac(S.garage.z / (0.5 * L)), d: S.garage.len * 0.9, top: S.garage.y + 0.07 });
    }
    // STAIRS. Transom -> main deck (both sides), then one central flight per
    // tier. Same call arguments as the drawn boxes, so geometry and physics can
    // never disagree.
    const nStep = Math.max(4, Math.round((FB - S.platY) / 0.34));
    K_stairDecks(decks, platW * 0.38, Math.min(1.5, platW * 0.20), S.sternZ + L * 0.004, 1, S.platY + 0.10, FB + 0.07, nStep);
    K_stairDecks(decks, -platW * 0.38, Math.min(1.5, platW * 0.20), S.sternZ + L * 0.004, 1, S.platY + 0.10, FB + 0.07, nStep);
    for (let k = 0; k < S.tiers; k++) {
      const y0 = S.deckY[k] + 0.10, y1 = S.deckY[k + 1] + 0.08;
      const n = Math.max(6, Math.round((y1 - y0) / 0.32));
      K_stairDecks(decks, Math.max(1.05, S.supHB[k] * 0.56), 1.5, S.supZ0[k] + 0.6, 1, y0, y1, n);
    }
    return {
      decks: decks, walls: walls,
      riders: true, yaw: true, camYaw: false, bodyYaw: true, tilt: true,
      onLeave: "upward", id: "yacht-decks-" + Math.round(S.loa),
    };
  }
  // A local copy of the KIT's stairDecks so the deck spec can be solved BEFORE
  // water_hulls.js has parsed (registration happens at its parse time, and the
  // deck spec is part of the registration record).
  function K_stairDecks(out, x, w, zBase, dir, y0, y1, steps) {
    const rise = (y1 - y0) / steps, run = 0.36;
    for (let i = 0; i < steps; i++) {
      out.push({ x: x, z: zBase + dir * (run * (i + 0.5)), w: w, d: run, top: y0 + rise * (i + 1) });
    }
  }
  /* ==========================================================================
     5. CBZ.yachtBuild(spec) — THE ENTRY. A register-shaped record.
     ========================================================================== */
  function yachtBuild(spec) {
    spec = spec || {};
    const S = solve(spec.loa, spec);
    const rec = {
      key: spec.key || ("yacht" + Math.round(S.loa)),
      label: spec.label || (spec.marque || "Yacht") + " " + Math.round(S.loa),
      marque: spec.marque || null,
      model: spec.model || spec.label || null,
      price: spec.price != null ? Math.round(spec.price) : null,
      hull: hullBlock(S),
      // The feel record is what playercars.js's driven loop reads. A ship this
      // heavy answers slowly at every one of them.
      feel: {
        accel: clamp(0.22 * Math.pow(34 / S.loa, 0.45), 0.05, 0.4),
        top: clamp(0.40 * Math.pow(S.loa / 34, 0.12), 0.3, 0.75),
        turn: clamp(0.16 * Math.pow(34 / S.loa, 0.55), 0.03, 0.3),
        drift: 0.7, roll: 0.30,
      },
      build: null, deck: null,
      _solve: S,
    };
    rec.build = function () { return buildYacht(S, spec.art || null); };
    if (C.YACHT_DECKS !== false) rec.deck = yachtDeckSpec(S);
    // Price: the boatyard's own PRICE_BANDS top out at $30M, which is right for
    // an "entry superyacht" and wrong for 156 m. Real large-yacht build cost
    // runs ~$1.0-1.4M per metre over 90 m, so it is derived, not typed.
    if (rec.price == null) {
      rec.price = Math.round((S.loa < 60 ? 260000 * S.loa
        : 1.15e6 * S.loa * Math.pow(S.loa / 60, 0.35)) / 50000) * 50000;
    }
    return rec;
  }

  CBZ.yachtSolve = solve;
  CBZ.yachtBuild = yachtBuild;

  /* ==========================================================================
     6. THE FLEET — every vessel is a ROW
     ========================================================================== */
  const REGISTERED = [];
  function queue(rec) {
    if (!rec || !rec.key) return null;
    if (!Array.isArray(CBZ.marineHullPending)) CBZ.marineHullPending = [];
    CBZ.marineHullPending.push(rec);
    REGISTERED.push(rec.key);
    return rec;
  }

  // ---- THE SUPERYACHTS. Three sizes; adding a fourth is one call. -----------
  if (C.YACHTS !== false) {
    queue(yachtBuild({
      key: "yacht46", loa: 46, marque: "Verano", model: "Verano 150",
      label: "Verano 150", art: { hull: 0xeee7d8 },
    }));
    queue(yachtBuild({
      key: "yacht88", loa: 88, marque: "Corveline", model: "Corveline 290",
      label: "Corveline 290", art: { hull: 0xe9e2d2 },
    }));
    // THE FLAGSHIP — the owner's reference proportions: 156 m, five levels,
    // two helidecks, cream on cream, 22 m of beam.
    queue(yachtBuild({
      key: "yacht156", loa: 156, marque: "Vosswerft", model: "Vosswerft Aurora 512",
      label: "Vosswerft Aurora 512", art: { hull: 0xe7dfcd },
    }));
  }

  /* ==========================================================================
     7. THE SMALL-CRAFT FLEET — "small fishing boats", by name
     ------------------------------------------------------------
     These are NOT yachtBuild output: a working boat is not a scaled-down
     superyacht, and pretending otherwise would be the same lie water_hulls.js
     deleted when it stopped aliasing "Yacht" onto a 6.2 m runabout. Each is an
     authored hull with the registry's own physics inversion doing the work
     (author LOA/beam/draft/tonnes/knots/accel; every drag coefficient solved).
     ========================================================================== */
  function smallBuilder(fn) { return function () { const K = kit(); return K ? fn(K, window.THREE) : new window.THREE.Group(); }; }

  // ---- SKIFF — Coastline Skiff 18. 5.5 m of welded aluminium: a jon-style
  // workboat with a modest V, a flat sheer, a plumb-ish stem and a squared
  // transom. It used to be three stepped prisms and a centre console — the
  // thinnest builder in the game and the most obviously fake hull in the
  // fleet. Now it is a LOFTED SURFACE (world/hull_loft.js) with everything a
  // real one carries: thwarts you can sit on, oars in their locks, a tiller
  // outboard, a bow cleat, a jerry can, a bucket and a cooler.
  //
  // The shell material is DOUBLE-SIDED on purpose. An open boat is seen from
  // inside, and a FrontSide hull is one you can see the sea through from the
  // helm.
  function buildSkiff(K, THREE) {
    const b = new THREE.Group(), M = K.M;
    const L = 5.5, W = 1.9, hw = W * 0.5, FB = 0.62;
    const HL = (K.loft && K.loft()) || CBZ.hullLoft || null;
    const alu = K.sharedMat("sk-alu", 0x9aa5ad, { emissive: 0x1b2024, ei: 0.18, double: true });
    const plate = K.sharedMat("sk-plate", 0x818d95, { emissive: 0x161b1f, ei: 0.16, double: true });
    const dark = M.dark(), chrome = M.chrome(), grey = M.grey();
    const wood = M.wood(), teak = M.teakDk(), pad = M.pad();
    K.declareRoom(b, "skiff-helm", "Open fishing cockpit");

    let out = null;
    if (HL) {
      const st = HL.stationsFromLines({
        loa: L, beam: W, draft: 0.28, freeboard: FB,
        sheerBow: 0.14, sheerStern: 0.02,          // a workboat sheer is nearly flat
        deadrise: 8, deadriseBow: 26,              // a modest V, warping forward
        flareBow: 9, tumblehome: 0,
        transomRake: 3,                            // squared transom, barely raked
        midBody0: 0.14, midBody1: 0.72,            // a jon carries her beam a long way
        transomBeamFrac: 0.96, entryPow: 1.25,
        rockerAft: 1.0, tKeel: 0.34, n: 15,
      });
      if (K.loftHull) K.loftHull(b, st, alu, { rings: 9, chine: "auto", transom: "flat" });
      out = HL.outline(st);
    }
    const sheerAt = (z) => (out ? out.sheerYAt(z) : FB);
    const hbAt = (z) => (out ? out.halfBeamAt(z) : hw);
    const keelAt = (z) => (out ? out.keelYAt(z) : -0.28);

    // THE SOLE. A welded boat has a plate floor above the bilge; without it
    // you stand on the inside of the bottom and see the keel between your feet.
    K.addBox(b, W * 0.76, 0.03, L * 0.62, 0, -0.04, -0.15, plate);
    // RIB RIDGES on the inside of the topsides — the frames that make a metal
    // boat read as METAL rather than as a moulded tub.
    [1, -1].forEach(function (side) {
      [-2.0, -1.15, -0.30, 0.55, 1.35].forEach(function (z) {
        const y = (sheerAt(z) + keelAt(z)) * 0.5;
        K.addBox(b, 0.030, sheerAt(z) - keelAt(z) - 0.08, 0.055, side * (hbAt(z) - 0.035), y, z, plate);
      });
      // stringer running fore and aft under the gunwale
      K.addBox(b, 0.035, 0.055, L * 0.78, side * (hbAt(0) - 0.05), sheerAt(0) - 0.14, -0.1, plate);
    });
    // RUBBING STRAKE + GUNWALE CAPPING, laid ON the sheer the loft reports
    // instead of at a guessed offset — the whole reason outline() exists.
    if (HL && out) {
      [1, -1].forEach(function (side) {
        const run = [];
        for (let i = 0; i <= 8; i++) {
          const z = -L * 0.48 + (L * 0.96) * (i / 8);
          run.push([side * (hbAt(z) + 0.018), sheerAt(z) - 0.045, z]);
        }
        const rub = HL.strip(run, 0.035, dark, { segments: 48, radial: 5 });
        if (rub) { rub.castShadow = false; b.add(rub); }
        const cap = HL.strip(run.map(function (p) { return [p[0] * 0.985, sheerAt(p[2]) + 0.012, p[2]]; }), 0.028, grey, { segments: 48, radial: 5 });
        if (cap) { cap.castShadow = false; b.add(cap); }
      });
    }
    // THREE THWARTS — real planks across real gunwales, at the three places a
    // jon boat actually has them: forward, amidships (the rowing station) and
    // aft by the tiller.
    [1.42, 0.10, -1.42].forEach(function (z, i) {
      const w = hbAt(z) * 2 - 0.10, y = sheerAt(z) - 0.16;
      K.markFixture(b, K.addBox(b, w, 0.045, 0.30, 0, y, z, wood), "thwart");
      [1, -1].forEach(function (side) {           // knees under each end
        K.addBox(b, 0.045, 0.14, 0.10, side * (w * 0.5 - 0.06), y - 0.09, z, plate);
      });
      if (i === 1) K.addBox(b, w * 0.9, 0.025, 0.26, 0, y + 0.036, z, pad);   // the rower's cushion
    });
    // OARLOCKS + OARS. The locks are pins in the gunwale; the oars lie along
    // the topsides with their looms through the locks, which is where oars go.
    [1, -1].forEach(function (side) {
      const zl = 0.42;
      K.addCyl(b, 0.022, 0.13, side * (hbAt(zl) - 0.03), sheerAt(zl) + 0.06, zl, chrome, 8);
      // THE OAR IS A SPAR, so it is solved between two real endpoints rather
      // than posed: the handle rests on the aft thwart, the loom lies in the
      // gunwale, the blade is on the far end of the loom. addTubeBetween is
      // the fleet's primitive for exactly this and it audits both ends.
      const aft = [side * (hbAt(-1.55) - 0.13), sheerAt(-1.55) - 0.13, -1.55];
      const fwd = [side * (hbAt(1.30) - 0.15), sheerAt(1.30) - 0.07, 1.30];
      const loom = K.addTubeBetween(b, aft, fwd, 0.022, wood, 8);
      if (loom) K.markFixture(b, loom, "oar");
      const blade = K.addBox(b, 0.115, 0.020, 0.50,
        fwd[0] - side * 0.02, fwd[1] + 0.01, fwd[2] + 0.32, wood);
      blade.rotation.z = side * 0.08;
      K.addCyl(b, 0.030, 0.18, aft[0] + side * 0.02, aft[1] + 0.01, aft[2] + 0.55, dark, 8).rotation.x = Math.PI / 2;
      // rod holders bored through the gunwale capping — solved from the
      // capping down to where the tube actually lands inside the boat
      [-0.55, -0.95].forEach(function (z) {
        K.addTubeBetween(b,
          [side * (hbAt(z) - 0.035), sheerAt(z) + 0.03, z],
          [side * (hbAt(z) - 0.075), sheerAt(z) - 0.22, z - 0.05], 0.026, dark, 8);
      });
    });
    // THE WORKING GEAR: a fish box on the sole, a jerry can lashed forward, a
    // bucket for bailing and a cooler to sit on.
    K.addFixtureBox(b, "fish-box", 0.62, 0.34, 0.52, 0, 0.15, -0.62, plate);
    K.addFixtureBox(b, "fuel-can", 0.28, 0.34, 0.22, 0.42, 0.15, -1.85, K.sharedMat("sk-can", 0xc23a26, { emissive: 0x2c0a05, ei: 0.20 }));
    K.addCyl(b, 0.135, 0.28, -0.44, 0.12, -1.85, K.sharedMat("sk-bucket", 0x3f6f52, { emissive: 0x0d1b13, ei: 0.18 }), 10);
    K.addFixtureBox(b, "cooler", 0.44, 0.30, 0.62, 0, 0.13, 1.05, K.sharedMat("sk-cool", 0xdfe4e8, { emissive: 0x2c3136, ei: 0.20 }));
    // bow deck plate + cleat + towing eye; a stern painter cleat to match
    K.addBox(b, hbAt(2.2) * 1.9, 0.028, 0.42, 0, sheerAt(2.2) - 0.03, 2.24, plate);
    K.markFixture(b, K.addBox(b, 0.17, 0.045, 0.055, 0, sheerAt(2.2) + 0.02, 2.16, chrome), "bow-cleat");
    K.addBox(b, 0.05, 0.05, 0.09, 0, sheerAt(2.6) - 0.14, L * 0.49, chrome);
    K.addBox(b, 0.15, 0.04, 0.05, 0, sheerAt(-2.5) + 0.02, -2.48, chrome);
    // THE OUTBOARD — the fleet's shared part, on a tiller. A 40 hp on a 5.5 m
    // aluminium skiff is exactly right and it is steered by hand, so there is
    // a tiller arm and no wheel anywhere on this boat.
    const props = [];
    if (K.outboard) {
      // outboard()'s y IS the anti-ventilation plate, and on a real boat that
      // plate is level with the bottom at the transom. Read the keel line.
      const ob = K.outboard(b, 0, keelAt(-L * 0.5) + 0.04, -L * 0.5 - 0.16, 40);
      props.push(ob.propAt);
      const tiller = K.addCyl(b, 0.020, 0.62, 0.12, sheerAt(-2.4) + 0.04, -2.28, dark, 8);
      tiller.rotation.x = Math.PI / 2 - 0.10;
      tiller.rotation.y = -0.22;
      K.markFixture(b, tiller, "tiller");
    }
    if (props.length) b.add(K.propGroup(0.55, props));
    K.navLights(b, hw, FB - 0.06, L * 0.38, -L * 0.46, null);
    b.userData.marineFixtureCount += 3;                 // sole, gunwale capping, transom
    return K.finish(b, { width: W, length: L, height: 1.2, wheelbase: L * 0.6 });
  }

  // ---- TRAWLER — 18 m working stern trawler. Wheelhouse forward, open work
  // deck aft, gantry, net drum, outriggers, deck floods. A real fishing boat.
  function buildTrawler(K, THREE) {
    const b = new THREE.Group(), M = K.M;
    const L = 18, W = 5.6, hw = W * 0.5, KEEL = -2.4, SHEER = 2.35;
    const hull = K.roleMat("tr-hull", "paint", 0x2a4c6a), house = K.roleMat("tr-house", "paint", 0xe4e7e6);
    const rust = K.sharedMat("tr-rust", 0x8a5a3a, { emissive: 0x211108, ei: 0.18 });
    const teak = M.teakDk(), dark = M.dark(), grey = M.grey(), chrome = M.chrome(), glass = M.glass();
    const liner = M.liner(), wood = M.wood(), screen = M.screen(), warm = M.warm(), pad = M.pad();
    K.declareRoom(b, "captain-workdeck", "Working deck");
    K.declareRoom(b, "captain-wheelhouse", "Wheelhouse");
    K.declareRoom(b, "captain-hold", "Open fish hold");
    // ---- THE HULL: ONE LOFTED DISPLACEMENT SHELL ----------------------------
    // Was four width-stepped prisms with vertical sides. A working stern
    // trawler is a full-bodied displacement hull: round bilge all the way, a
    // BAR KEEL she can take the ground on, a high flared bow that throws a
    // North Sea sea away from the working deck, and TUMBLEHOME aft — the
    // topsides leaning back in over the counter, which is the single line that
    // says "fishing boat" and which a box can never have.
    const HL = (K.loft && K.loft()) || CBZ.hullLoft || null;
    const boot = K.roleMat("tr-boot", "plastic", 0x14181d);
    let st = null, out = null;
    if (HL) {
      st = HL.stationsFromLines({
        loa: L, beam: W, draft: -KEEL, freeboard: SHEER,
        sheerBow: 0.85, sheerStern: 0.12,
        roundBilge: true, bilgeN: 2.1, maxBeamHeight: 0.62,
        flareBow: 27, tumblehome: 13, transomRake: 14,
        midBody0: 0.18, midBody1: 0.66, transomBeamFrac: 0.78,
        entryPow: 0.95, rockerAft: 0.96, tKeel: 0.44, n: 19,
      });
      if (K.warpBilge) K.warpBilge(st, 2.9, 1.7, 0.20, 0.62);
      // A RAKED STEM, leaning FORWARD at the top: the overhang that gives a
      // working boat its reserve buoyancy in a head sea, and the reason a
      // trawler's bow does not read as the end of a barge.
      if (K.rakeStem) K.rakeStem(st, -16 * Math.PI / 180, 0.24);
      if (K.loftHull) K.loftHull(b, st, hull, { rings: 13, transom: "flat" });
      out = HL.outline(st);
    }
    const sheerAt = function (z) { return out ? out.sheerYAt(z) : SHEER; };
    const hbAt = function (z) { return out ? out.halfBeamAt(z) : hw; };
    const keelAt = function (z) { return out ? out.keelYAt(z) : KEEL; };
    if (HL && st) {
      // THE BAR KEEL: a rectangular bar down the centreline, following the
      // rocker. A trawler sits on this in a drying harbour.
      const bar = [];
      for (let i = 0; i <= 20; i++) {
        const z = -8.6 + (16.4 * i) / 20;
        bar.push([0, keelAt(z) - 0.16, z]);
      }
      const kbar = HL.strip(bar, 0.17, hull, { segments: 56, radial: 4 });
      if (kbar) { kbar.castShadow = false; b.add(kbar); }
      [1, -1].forEach(function (side) {
        // boot stripe, the working sheer stripe, and TWO rubbing strakes —
        // the timber a trawler wears where she lies against a quay wall.
        const bs = HL.strip(K.skinRun(st, side, -8.7, 8.2, 0.14, 0.02, 0.7), 0.13, boot, { segments: 60, radial: 5 });
        if (bs) { bs.castShadow = false; b.add(bs); }
        const stripe = HL.strip(K.skinRun(st, side, -8.6, 8.0, function (z) { return sheerAt(z) - 0.36; }, 0.02, 0.7), 0.07, house, { segments: 60, radial: 5 });
        if (stripe) { stripe.castShadow = false; b.add(stripe); }
        [0.85, 1.55].forEach(function (dy) {
          const rs = HL.strip(K.skinRun(st, side, -8.5, 7.6, function (z) { return sheerAt(z) - dy; }, 0.05, 0.7), 0.09, rust, { segments: 56, radial: 5 });
          if (rs) { rs.castShadow = false; b.add(rs); }
        });
        // engine-room and cabin lights, ON the skin
        [-4.6, -2.4, -0.2].forEach(function (z) {
          K.hullPanel(b, st, side, z, sheerAt(z) - 0.78, 0.58, 0.34, glass, { thick: 0.06, outset: 0.006 });
        });
      });
    }
    // BULWARKS as a WALL along the sheer — a plate that follows the deck edge
    // in, out and up, with a capping rail on top. It used to be a 12 m straight
    // box at the maximum half-beam, so it cut through the tumblehome aft and
    // stood off the flare forward.
    [1, -1].forEach(function (side) {
      if (out && K.bulwark) {
        // ALL THE WAY TO THE STEM. It converges to a point with the deck edge,
        // so the topsides stay closed forward and the whaleback has something
        // to sit on instead of floating a metre above the sheer.
        K.bulwark(b, out, side, -8.4, 9.5, 1.05, 0.16, hull, hull, rust, 0.7);
        // FREEING PORTS: the slots a boarding sea drains back out through, cut
        // in the bottom of the bulwark where they actually are.
        [-6.6, -5.0, -3.4, -1.8, -0.2].forEach(function (z) {
          if (st) K.hullPanel(b, st, side, z, sheerAt(z) + 0.16, 0.62, 0.24, dark, { thick: 0.22, outset: 0.02 });
        });
      } else {
        K.addBox(b, 0.16, 0.95, 12.0, side * (hw - 0.08), SHEER + 0.42, -2.2, hull);
      }
    });
    // THE WORK DECK, laid to the bulwark line: the old 4.82 m slab ran past
    // the hull's own half-beam at the transom, where she has tucked in to 2.26.
    if (out && K.sheet) {
      const wp = [], wm = [], wsb = [];
      for (let i = 0; i <= 12; i++) {
        const z = -8.55 + (8.85 * i) / 12;
        const y = SHEER, x = Math.max(0.2, hbAt(z) - 0.20);
        wp.push([x, y, z]); wm.push([0, y, z]); wsb.push([-x, y, z]);
      }
      K.sheet(b, [wp, wm, wsb], teak, {});
    } else {
      K.addBox(b, W * 0.86, 0.14, 9.0, 0, SHEER, -4.2, teak);
    }
    // THE WHALEBACK: the curved covered deck over the forecastle that a real
    // trawler carries so green water rolls off instead of filling the bow.
    if (out && K.sheet) {
      // It caps the topsides at the BULWARK line — 1.05 m above the sheer,
      // where the bulwark stops — not down inside it, or the dome is buried
      // plate and all you see is a grey wedge sticking out of the bow.
      const rows = [];
      const ARC = 6;
      for (let a = 0; a <= ARC; a++) {
        const row = [], f = a / ARC, ang = f * Math.PI;
        for (let i = 0; i <= 12; i++) {
          const z = 4.9 + (4.6 * i) / 12;
          const hb = Math.max(0.02, hbAt(z) - 0.02), y = sheerAt(z) + 1.05;
          row.push([Math.cos(ang) * hb, y + Math.sin(ang) * Math.min(0.85, hb * 0.55), z]);
        }
        rows.push(row);
      }
      K.sheet(b, rows, house, { flip: true });
      // the break of the whaleback: the athwartships face where it meets the
      // open work deck, so it is a covered forecastle and not a floating shell
      const face = [], base = [];
      for (let a = 0; a <= ARC; a++) {
        const ang = (a / ARC) * Math.PI, hb = Math.max(0.06, hbAt(4.9) - 0.03), y = sheerAt(4.9) + 1.05;
        face.push([Math.cos(ang) * hb, y + Math.sin(ang) * Math.min(0.85, hb * 0.55), 4.9]);
        base.push([Math.cos(ang) * hb, y, 4.9]);
      }
      K.sheet(b, [base, face], house, {});
      K.addFixtureBox(b, "whaleback-hatch", 0.62, 0.10, 0.62, 0, sheerAt(6.3) + 1.55, 6.3, rust);
    }
    // wheelhouse forward, raised on a whaleback
    K.addCabinShell(b, { width: W * 0.74, z0: 1.25, z1: 4.65, y0: SHEER + 0.08, y1: SHEER + 2.90,
      doorW: 1.08, body: house, liner: liner, glass: glass });
    K.addBox(b, W * 0.82, 0.16, 3.75, 0, SHEER + 2.96, 3.02, house);                  // roof overhang
    K.addBox(b, W * 0.60, 0.14, 2.2, 0, SHEER + 0.16, 3.0, teak);                    // wheelhouse sole
    K.addBox(b, W * 0.58, 0.05, 2.0, 0, SHEER + 2.70, 3.0, liner);                   // headliner
    K.addFixtureBox(b, "helm-console", 3.15, 0.72, 0.58, 0, SHEER + 0.55, 4.05, dark);
    [-0.78, 0, 0.78].forEach(function (x) {
      K.addScreen(b, x, SHEER + 1.08, 3.75, 0.62, 0.36, 0, screen);
    });
    K.addFixtureCyl(b, "helm-wheel", 0.30, 0.07, -0.48, SHEER + 1.20, 3.72, dark, 12).rotation.x = Math.PI / 2;
    [-0.06, 0.10].forEach(function (x) {
      const lever = K.addFixtureBox(b, "engine-lever", 0.055, 0.30, 0.055, x, SHEER + 1.04, 3.62, chrome);
      lever.rotation.x = -0.28;
    });
    K.addSeat(b, -0.82, SHEER + 0.22, 3.05, 0, pad, chrome);
    K.addCabinet(b, -1.66, SHEER + 0.22, 2.05, 0.42, 0.92, 1.2, liner);
    K.addFixtureBox(b, "wheelhouse-light", 0.88, 0.04, 0.28, 0, SHEER + 2.62, 3.0, warm);
    // GANTRY over the stern ramp + net drum + outriggers. Every spar begins at
    // a deck/roof socket and ends at the cross member or boom tip.
    [1, -1].forEach(function (side) {
      K.addTubeBetween(b, [side * (hw - 0.52), SHEER + 0.08, -7.25], [side * (hw - 0.72), SHEER + 4.55, -7.40], 0.13, rust, 8);
      K.addTubeBetween(b, [side * 1.55, SHEER + 2.78, 2.05], [side * 4.15, SHEER + 6.25, -0.85], 0.09, rust, 8);
      K.addTubeBetween(b, [side * 1.55, SHEER + 2.78, 2.05], [side * 1.95, SHEER + 4.55, -0.35], 0.045, chrome, 8);
    });
    K.addTubeBetween(b, [-(hw - 0.72), SHEER + 4.55, -7.40], [(hw - 0.72), SHEER + 4.55, -7.40], 0.15, rust, 8);
    // Net drum is stern-mounted and human-scaled, leaving the centre work lane
    // and Captain hold sightline clear.
    const drum = K.addCyl(b, 0.58, W * 0.52, 0, SHEER + 0.78, -7.10, grey, 10);
    drum.rotation.z = Math.PI / 2;
    K.addCyl(b, 0.66, 0.14, 0, SHEER + 0.78, -7.10, dark, 10).rotation.z = Math.PI / 2;
    [-1.65, 1.65].forEach(function (x) {
      K.addFixtureBox(b, "drum-pedestal", 0.26, 0.74, 0.44, x, SHEER + 0.38, -7.10, rust);
    });
    // deck floods on the gantry, and the masthead
    [0.8, -0.8].forEach(function (s) {
      K.addBox(b, 0.26, 0.20, 0.16, s * W * 0.3, SHEER + 4.35, -7.2, M.navWhite());
    });
    K.addTubeBetween(b, [0, SHEER + 2.88, 3.40], [0, SHEER + 6.40, 3.40], 0.075, grey, 8);
    K.addTubeBetween(b, [-0.82, SHEER + 5.25, 3.40], [0.82, SHEER + 5.25, 3.40], 0.065, grey, 8);
    K.addCyl(b, 0.28, 0.12, 0, SHEER + 5.38, 3.40, grey, 10);                       // radar on mast crossbar
    // Fish totes and net bins hug the bulwarks; the central work lane stays open.
    [-1.70, 1.70].forEach(function (x) {
      K.addFixtureBox(b, "fish-tote", 1.05, 0.62, 1.15, x, SHEER + 0.38, -3.0, rust);
      K.addFixtureBox(b, "net-bin", 1.10, 0.74, 1.30, x, SHEER + 0.44, -5.1, dark);
    });
    K.addFixtureCyl(b, "warp-coil", 0.46, 0.26, -1.85, SHEER + 0.25, -8.05, dark, 10);
    b.add(K.propGroup(2.0, [[0, KEEL * 0.72, -8.8]]));
    K.navLights(b, hbAt(7.2), sheerAt(7.2) + 1.15, 7.2, -8.8, SHEER + 5.9);
    return K.finish(b, { width: W, length: L, height: 8.4, wheelbase: L * 0.6 });
  }
  function trawlerDeck() {
    const SHEER = 2.35, decks = [
      { x: 0, z: -4.25, w: 4.4, d: 8.6, top: SHEER + 0.08 },
      { x: 0, z: 3.0, w: 3.4, d: 2.2, top: SHEER + 0.24 },
    ];
    K_stairDecks(decks, 1.5, 0.8, 1.0, 1, SHEER + 0.08, SHEER + 0.24, 3);
    return {
      decks: decks,
      walls: [
        { x: 2.07, z: 3.1, w: 0.12, d: 3.6, y0: SHEER + 0.24, y1: SHEER + 2.9 },
        { x: -2.07, z: 3.1, w: 0.12, d: 3.6, y0: SHEER + 0.24, y1: SHEER + 2.9 },
        { x: 1.36, z: 1.34, w: 1.36, d: 0.12, y0: SHEER + 0.24, y1: SHEER + 2.9 },
        { x: -1.36, z: 1.34, w: 1.36, d: 0.12, y0: SHEER + 0.24, y1: SHEER + 2.9 },
        { x: 0, z: 4.76, w: 4.04, d: 0.12, y0: SHEER + 0.24, y1: SHEER + 2.9 },
        { x: 2.72, z: -2.2, w: 0.16, d: 12.0, y0: SHEER + 0.08, y1: SHEER + 1.0 },
        { x: -2.72, z: -2.2, w: 0.16, d: 12.0, y0: SHEER + 0.08, y1: SHEER + 1.0 },
      ],
      riders: true, yaw: true, camYaw: false, bodyYaw: true, tilt: true,
      onLeave: "upward", id: "trawler-decks",
    };
  }

  // ---- SPORTFISHER — 12.5 m convertible. Tuna tower, fighting chair, outriggers.
  function buildSportfish(K, THREE) {
    const b = new THREE.Group(), M = K.M;
    const L = 12.5, W = 4.3, hw = W * 0.5, KEEL = -1.15, SHEER = 1.42;
    const hull = K.roleMat("sf-hull", "paint", 0xf2f5f7), navy = K.roleMat("sf-navy", "paint", 0x14314f);
    const teak = M.teak(), dark = M.dark(), chrome = M.chrome(), glass = M.glass(), pad = M.pad(), grey = M.grey();
    const liner = M.liner(), wood = M.wood(), screen = M.screen(), warm = M.warm();
    K.declareRoom(b, "sportfish-cockpit", "Fishing cockpit");
    K.declareRoom(b, "sportfish-saloon", "Convertible saloon");
    K.declareRoom(b, "sportfish-flybridge", "Flybridge");
    K.declareRoom(b, "sportfish-tower", "Tuna tower helm");
    // ---- THE HULL: ONE LOFTED CAROLINA HULL ---------------------------------
    // Was four width-stepped prisms. A 41-foot convertible is a warped-plane
    // deep-V with a HARD CHINE that is the widest point of every section, and
    // a CAROLINA BOW — the enormous flare (34 degrees) that knocks the spray
    // flat and is the single most recognisable line on this class of boat. No
    // tumblehome anywhere: the transom is square and full-width because the
    // cockpit behind it is the whole point of the vessel.
    const HL = (K.loft && K.loft()) || CBZ.hullLoft || null;
    let st = null, out = null;
    if (HL) {
      st = HL.stationsFromLines({
        loa: L, beam: W, draft: -KEEL, freeboard: SHEER,
        sheerBow: 0.70, sheerStern: 0.05,
        deadrise: 16, deadriseBow: 55, flareBow: 34, tumblehome: 0,
        transomRake: 10, midBody0: 0.14, midBody1: 0.66, transomBeamFrac: 0.96,
        entryPow: 1.05, rockerAft: 0.95, tKeel: 0.40, n: 17,
        // THE CHINE, authored rather than solved off the deadrise: with a bow
        // this fine and a flare this big the solved corner folds — it climbs
        // and then dives again forward, which is a crease no planing hull has.
        // Deepest aft, out of the water by two thirds of the length, then up
        // to the stem: that exit is what makes a Carolina bow look like one.
        chineY: function (t) { return 0.30 - 1.50 * Math.pow(Math.max(0, t - 0.32), 1.30); },
      });
      if (K.loftHull) {
        K.loftHull(b, st, hull, {
          rings: 11, chine: "auto", transom: "flat",
          deck: true, deckCamber: 0.09, deckCols: 9,
        });
      }
      out = HL.outline(st);
    }
    const sheerAt = function (z) { return out ? out.sheerYAt(z) : SHEER; };
    const hbAt = function (z) { return out ? out.halfBeamAt(z) : hw; };
    const keelAt = function (z) { return out ? out.keelYAt(z) : KEEL; };
    if (HL && st) {
      [1, -1].forEach(function (side) {
        // the navy sheer stripe, on the skin
        const band = HL.strip(K.skinRun(st, side, -6.1, 5.6, function (z) { return sheerAt(z) - 0.42; }, 0.012, 0.5), 0.15, navy, { segments: 52, radial: 5 });
        if (band) { band.castShadow = false; b.add(band); }
        // SPRAY RAILS: the chine strake itself plus a second rail half way up
        // the bottom. Both are what keep a boat this fast dry, and both are
        // read off the loft's own corner rather than guessed.
        const cr = HL.strip(K.chineRun(st, side, 0.04, 0.01), 0.055, hull, { segments: 46, radial: 4 });
        if (cr) { cr.castShadow = false; b.add(cr); }
        const lower = HL.strip(K.skinRun(st, side, -6.1, 4.6, function (z) { return keelAt(z) * 0.42; }, 0.03, 0.5), 0.040, hull, { segments: 46, radial: 4 });
        if (lower) { lower.castShadow = false; b.add(lower); }
      });
    }
    K.addBox(b, Math.max(2.2, hbAt(-6.2) * 1.55), 0.14, 0.9, 0, 0.28, -6.6, teak);   // swim platform
    K.addStairs(b, 1.15, 0.7, -6.15, 1, 0.35, SHEER + 0.06, 4, teak);
    K.addBox(b, W * 0.80, 0.12, 4.2, 0, SHEER, -3.6, teak);                          // cockpit
    // FIGHTING CHAIR on a pedestal — the whole point of the boat
    K.addCyl(b, 0.28, 0.55, 0, SHEER + 0.28, -3.4, grey, 10);
    K.addBox(b, 0.62, 0.16, 0.62, 0, SHEER + 0.60, -3.4, pad);
    K.addBox(b, 0.62, 0.72, 0.14, 0, SHEER + 1.02, -3.72, pad);
    K.addBox(b, 0.10, 0.55, 0.10, 0, SHEER + 0.90, -2.95, chrome);                   // rod gimbal
    // transom fish door, live well, rocket launcher rod holders
    K.addBox(b, 0.70, 0.68, 0.08, 1.0, SHEER + 0.34, -5.72, navy);
    K.addBox(b, 0.9, 0.5, 0.6, -1.2, SHEER + 0.25, -5.3, grey);
    // saloon + raised helm
    K.addCabinShell(b, { width: W * 0.66, z0: -1.60, z1: 2.60, y0: SHEER, y1: SHEER + 2.05,
      doorW: 1.02, body: hull, liner: liner, glass: glass });
    [1, -1].forEach(function (side) {
      // SIDE DECK on the deck edge, up over the flared bow and round to the
      // stem. The 5.6 m box it used to be was 1.99 m outboard at z 4.4, where
      // this hull is 0.9 m wide: the last third of it hung in mid-air.
      if (out && K.sheet) {
        const inner = [], outer = [];
        for (let i = 0; i <= 12; i++) {
          const z = -1.3 + (7.2 * i) / 12, y = sheerAt(z) + 0.05;
          outer.push([side * Math.max(0.08, hbAt(z) - 0.06), y, z]);
          inner.push([side * Math.max(0.05, Math.min(1.45, hbAt(z) - 0.68)), y, z]);
        }
        K.sheet(b, [inner, outer], teak, { flip: side > 0 });
        K.sheerRail(b, out, side, -1.3, 5.9, 0.05, chrome, { spacing: 1.5, inset: 0.10, height: 0.72 });
      } else {
        K.addBox(b, 0.62, 0.10, 5.6, side * 1.68, SHEER + 0.14, 1.6, teak);
        K.addRail(b, side * 1.98, -1.4, 5.2, SHEER + 0.18, chrome, 1.7);
      }
    });
    // Compact convertible saloon with a clear aft threshold and forward aisle.
    K.addBox(b, 2.68, 0.08, 3.82, 0, SHEER + 0.08, 0.42, wood);
    K.addBox(b, 2.60, 0.05, 3.60, 0, SHEER + 1.85, 0.42, liner);
    K.addFixtureBox(b, "saloon-settee", 0.55, 0.46, 1.75, 1.02, SHEER + 0.34, -0.10, pad);
    K.addFixtureBox(b, "saloon-settee-back", 0.12, 0.70, 1.75, 1.27, SHEER + 0.68, -0.10, pad);
    K.addTable(b, 0.28, SHEER + 0.08, -0.10, 0.72, 0.92, wood, chrome);
    K.addCabinet(b, -1.05, SHEER + 0.08, 0.70, 0.46, 0.86, 1.45, liner);
    K.addFixtureBox(b, "galley-counter", 0.54, 0.09, 1.45, -1.02, SHEER + 0.99, 0.70, wood);
    K.addScreen(b, -0.38, SHEER + 1.08, 2.02, 0.54, 0.30, 0, screen);
    K.addFixtureBox(b, "saloon-light", 0.72, 0.04, 0.25, 0, SHEER + 1.79, 0.35, warm);
    // FLYBRIDGE helm + the TUNA TOWER above it
    K.addStairs(b, 1.45, 0.7, -1.5, 1, SHEER + 0.14, SHEER + 2.20, 6, chrome);
    K.addBox(b, W * 0.62, 0.12, 3.2, 0, SHEER + 2.20, 0.6, teak);
    K.addPrism(b, 1.7, [[1.5, SHEER + 2.20], [1.6, SHEER + 3.05], [2.3, SHEER + 3.08], [2.4, SHEER + 2.20]], 0, dark);
    K.addScreen(b, 0, SHEER + 2.98, 1.72, 0.62, 0.30, 0, screen);
    [0.55, -0.55].forEach(function (x) { K.addBox(b, 0.48, 0.16, 0.48, x, SHEER + 2.40, -0.4, pad); });
    K.addRail(b, 1.30, -1.0, 2.2, SHEER + 2.26, chrome, 1.4);
    K.addRail(b, -1.30, -1.0, 2.2, SHEER + 2.26, chrome, 1.4);
    [1, -1].forEach(function (side) {
      // Four tube ends land on the flybridge and tower platform.
      K.addTubeBetween(b, [side * 1.05, SHEER + 2.26, -0.12], [side * 0.78, SHEER + 4.80, -0.10], 0.055, grey, 8);
      K.addTubeBetween(b, [side * 1.05, SHEER + 2.26, 1.12], [side * 0.78, SHEER + 4.80, 1.10], 0.055, grey, 8);
      // Outriggers sweep outboard and aft from visible roof sockets.
      K.addTubeBetween(b, [side * 1.10, SHEER + 3.12, 0.55], [side * 4.25, SHEER + 6.25, -2.25], 0.045, grey, 8);
      K.addTubeBetween(b, [side * 1.10, SHEER + 3.12, 0.55], [side * 1.62, SHEER + 4.15, -0.25], 0.028, chrome, 8);
    });
    K.addBox(b, 1.9, 0.10, 1.7, 0, SHEER + 4.8, 0.5, grey);                          // tower platform
    K.addBox(b, 0.9, 0.55, 0.10, 0, SHEER + 5.12, 1.24, dark);                        // tower helm
    K.addScreen(b, 0, SHEER + 5.18, 1.17, 0.50, 0.24, 0, screen);
    K.addSeat(b, 0, SHEER + 4.86, 0.20, 0, pad, chrome);
    b.userData.marineFixtureCount += 7;                                                  // cockpit + flybridge work fittings
    b.add(K.propGroup(1.4, [[0.75, -0.95, -6.3], [-0.75, -0.95, -6.3]]));
    K.navLights(b, hbAt(5.1), sheerAt(5.1) + 0.10, 5.1, -6.1, SHEER + 5.4);
    return K.finish(b, { width: W, length: L, height: 6.9, wheelbase: L * 0.6 });
  }
  function sportfishDeck() {
    const SHEER = 1.42, decks = [
      { x: 0, z: -6.6, w: 2.9, d: 0.9, top: 0.35 },
      { x: 0, z: -3.6, w: 3.44, d: 4.2, top: SHEER + 0.06 },
      // the side decks are a ribbon on the sheer now: shorter, narrower and
      // inside the hull at both ends
      { x: 1.55, z: 0.6, w: 0.60, d: 3.8, top: SHEER + 0.08 },
      { x: -1.55, z: 0.6, w: 0.60, d: 3.8, top: SHEER + 0.08 },
      { x: 0, z: 0.42, w: 2.68, d: 3.82, top: SHEER + 0.12 },
      { x: 0, z: 0.6, w: 2.67, d: 3.2, top: SHEER + 2.26 },
    ];
    K_stairDecks(decks, 1.15, 0.7, -6.15, 1, 0.35, SHEER + 0.06, 4);
    K_stairDecks(decks, 1.45, 0.7, -1.5, 1, SHEER + 0.14, SHEER + 2.20, 6);
    return {
      decks: decks,
      walls: [
        { x: 1.42, z: 0.5, w: 0.10, d: 4.2, y0: SHEER + 0.12, y1: SHEER + 2.05 },
        { x: -1.42, z: 0.5, w: 0.10, d: 4.2, y0: SHEER + 0.12, y1: SHEER + 2.05 },
        { x: 0.96, z: -1.58, w: 0.92, d: 0.10, y0: SHEER + 0.12, y1: SHEER + 2.05 },
        { x: -0.96, z: -1.58, w: 0.92, d: 0.10, y0: SHEER + 0.12, y1: SHEER + 2.05 },
        { x: 0, z: 2.58, w: 2.74, d: 0.10, y0: SHEER + 0.12, y1: SHEER + 2.05 },
        { x: 1.30, z: 0.6, w: 0.08, d: 3.2, y0: SHEER + 2.26, y1: SHEER + 3.2 },
        { x: -1.30, z: 0.6, w: 0.08, d: 3.2, y0: SHEER + 2.26, y1: SHEER + 3.2 },
      ],
      riders: true, yaw: true, camYaw: false, bodyYaw: true, tilt: true,
      onLeave: "upward", id: "sportfish-decks",
    };
  }

  // ---- THE SAIL — a cambered triangle, not a flat one ----------------------
  // A sail is CLOTH. The wind is IN it, so it takes a belly; the draft is
  // deepest about 40% aft of the luff and it dies out at the head because the
  // chord does. Drawn as one flat triangle it reads as a sheet of paper taped
  // to the mast — which is exactly why this file used to draw a fat pale tube
  // and call it a furled main. An 8x8 cambered grid costs 128 triangles and
  // reads as a sail from every angle.
  //
  //   tack  the forward lower corner (the gooseneck, or the stemhead)
  //   head  the top corner (up the mast, or up the forestay)
  //   clew  the aft lower corner (the boom end, or the sheet car)
  //
  // The three corners are arbitrary points in hull space, so the SAME routine
  // draws a main on a boom eased to port and a jib set off a forestay: there
  // is no "rotate the sail until it looks right" step, because the corners ARE
  // the hardware. `belly` is maximum draft as a fraction of chord (8-12% is a
  // real sail) and `toward` is the side the wind pushes it, so both sails on
  // one boat cannot end up bellying in opposite directions.
  function sailGeo(THREE, tack, head, clew, belly, toward, N) {
    const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
    const T = V(tack), H = V(head), C = V(clew);
    const n = H.clone().sub(T).cross(C.clone().sub(T));
    if (!(n.lengthSq() > 1e-9)) return null;
    n.normalize();
    if (toward && n.dot(V(toward)) < 0) n.negate();
    const g0 = Math.max(3, N || 8), row = g0 + 1;
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= g0; i++) {
      const u = i / g0;                       // 0 at the foot, 1 at the head
      const Lp = T.clone().lerp(H, u);        // the luff
      const Ep = C.clone().lerp(H, u);        // the leech
      const chord = Ep.distanceTo(Lp);
      for (let j = 0; j <= g0; j++) {
        const v = j / g0;
        const p = Lp.clone().lerp(Ep, v);
        p.addScaledVector(n, Math.sin(Math.PI * Math.pow(v, 1.22)) * chord * belly);
        pos.push(p.x, p.y, p.z);
        uv.push(v, u);
      }
    }
    for (let i = 0; i < g0; i++) {
      for (let j = 0; j < g0; j++) {
        const a = i * row + j;
        idx.push(a, a + 1, a + row + 1, a, a + row + 1, a + row);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setIndex(idx);
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
  // A sail is NEVER merged: mergeByMaterial() batches by material id, and the
  // main and the jib share one cloth, so a merge would fuse them into a single
  // nameless mesh. They are named so a mode that wants them furled can hide
  // `sail_main` / `sail_jib` by name.
  function addSail(root, THREE, name, mat, tack, head, clew, belly, toward) {
    const g = sailGeo(THREE, tack, head, clew, belly, toward, 8);
    if (!g) return null;
    const m = new THREE.Mesh(g, mat);
    m.name = name;
    m.castShadow = false;
    m.userData.noMerge = true;
    m.userData.marineFixture = "sail";
    root.add(m);
    root.userData.marineFixtureCount = (root.userData.marineFixtureCount || 0) + 1;
    return m;
  }

  // ---- SLOOP — Marlow 44. 13.5 m keelboat, AND SHE HAS SAILS ----------------
  // She was four width-stepped prisms, a box keel, a box bulb, and — the line
  // this rebuild exists to delete — a fat sail-coloured CYLINDER along the
  // boom standing in for a furled mainsail, because "the game has no sail
  // model". A sailing yacht with no sails is the same stat fiction as a hull
  // that is a lie: the silhouette is the entire point of the boat. So the
  // sails are here, set and drawing, on a boat that is now a real round-bilge
  // canoe body with a ballast fin under it.
  //
  // NO CHINE ANYWHERE. That is the difference between this hull and every
  // powerboat in the fleet: a displacement sailing hull is one continuous
  // curve from the sheer round the turn of the bilge to the keel, and the
  // draft you see on the spec sheet is nearly all fin.
  function buildSloop(K, THREE) {
    const b = new THREE.Group(), M = K.M;
    const L = 13.5, W = 4.0, hw = W * 0.5, SHEER = 1.10, CANOE = -0.72;
    const HL = (K.loft && K.loft()) || (window.CBZ && window.CBZ.hullLoft) || null;
    // The shell is DOUBLE-SIDED and it is its own material: mergeByMaterial()
    // only batches meshes that share one, so a unique material is what keeps
    // the hull a single addressable mesh the fleet audit can measure.
    const hull = K.sharedMat("sl-hull", 0xf4f6f7, { emissive: 0x3a3f42, ei: 0.20, double: true });
    const stripe = K.roleMat("sl-stripe", "paint", 0x1b3f63);
    const teak = M.teak(), chrome = M.chrome(), glass = M.glass(), grey = M.grey(), dark = M.dark();
    const pad = M.pad(), liner = M.liner(), wood = M.wood(), screen = M.screen(), warm = M.warm();
    const sail = K.sharedMat("sl-sail", 0xe6e8e6, { emissive: 0x3c3d3c, ei: 0.28, double: true });
    K.declareRoom(b, "sloop-cockpit", "Sailing cockpit");
    K.declareRoom(b, "sloop-cabin", "Main cabin");
    K.declareRoom(b, "sloop-rig", "Standing rigging");

    // The deck hole runs from the transom right forward to the coachroof's
    // front: that gap IS the cockpit well, the bridgedeck and the sunken
    // cabin, and what is left of the lid is the side decks and the foredeck.
    const CK = { z0: -5.20, z1: 3.50, halfW: 1.12 };
    let out = null, ST = null;
    if (HL) {
      ST = HL.stationsFromLines({
        loa: L, beam: W, draft: 0.72, freeboard: SHEER,
        sheerBow: 0.46, sheerStern: 0.05,
        roundBilge: true, bilgeN: 2.6, maxBeamHeight: 0.72,
        flareBow: 9, tumblehome: 5,
        transomRake: 14,                       // the counter overhangs aft
        midBody0: 0.24, midBody1: 0.74, transomBeamFrac: 0.54,
        entryPow: 1.35, rockerAft: 0.50, tKeel: 0.46, n: 19,
      });
      if (K.loftHull) {
        K.loftHull(b, ST, hull, {
          rings: 11, transom: "flat",           // NO o.chine: a keelboat has none
          deck: true, deckCamber: 0.09, deckCols: 9, cockpit: CK,
        });
      }
      out = HL.outline(ST);
    }
    const sheerAt = (z) => (out ? out.sheerYAt(z) : SHEER);
    const hbAt = (z) => (out ? out.halfBeamAt(z) : hw);
    const keelAt = (z) => (out ? out.keelYAt(z) : CANOE);

    // BOOT TOP and the sheer stripe. BOTH are read off the SKIN (skinRun ->
    // hullSectionX), not off the maximum half-beam: a round-bilge hull is
    // narrower at the waterline than at the turn of the bilge, so a boot
    // stripe drawn at 0.985 of the max half-beam hangs off the hull in a dark
    // arc under the bow — which is exactly what the first render of this hull
    // showed.
    if (HL && ST) {
      [1, -1].forEach(function (side) {
        const bt = HL.strip(K.skinRun(ST, side, -L * 0.46, L * 0.45, 0.02, 0.010, 0.55),
          0.035, M.boot(), { segments: 52, radial: 5 });
        if (bt) { bt.castShadow = false; b.add(bt); }
        const sp = HL.strip(K.skinRun(ST, side, -L * 0.46, L * 0.46, (z) => sheerAt(z) - 0.20, 0.014, 0.55),
          0.045, stripe, { segments: 52, radial: 5 });
        if (sp) { sp.castShadow = false; b.add(sp); }
      });
    }

    // ---- THE BALLAST FIN, THE BULB AND THE SPADE RUDDER ---------------------
    // A sailing yacht's 2.45 m of draft is almost all appendage: the canoe
    // body only draws 0.72. Each is drawn with its real PLANFORM (a swept
    // leading edge and a shorter tip chord), which is what a foil looks like
    // from the side — the old build used constant-section boxes.
    K.addPrism(b, 0.30, [[-0.72, -2.06], [-1.12, -0.58], [1.32, -0.58], [0.56, -2.06]], 0, dark);
    const bulb = K.addCyl(b, 0.17, 2.30, 0, -2.18, 0.05, dark, 10);
    bulb.rotation.x = Math.PI / 2;
    [1, -1].forEach(function (side) {
      const nose = new THREE.Mesh(K.cylGeo(0.02, 0.17, 0.42, 10), dark);
      nose.position.set(0, -2.18, 0.05 + side * 1.36);
      nose.rotation.x = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      nose.castShadow = false;
      b.add(nose);
    });
    K.addPrism(b, 0.13, [[-4.88, -1.92], [-4.78, -0.34], [-3.98, -0.34], [-4.20, -1.92]], 0, dark);
    K.addCyl(b, 0.045, 1.70, 0, -1.10, -4.52, chrome, 8);                    // rudder stock

    // ---- COACHROOF, COCKPIT, COAMINGS ---------------------------------------
    K.addCabinShell(b, { width: W * 0.56, z0: -1.00, z1: 3.45, y0: 0.48, y1: SHEER + 0.82,
      doorW: 0.86, body: hull, liner: liner, glass: glass });
    K.addBox(b, W * 0.52, 0.10, 3.30, 0, SHEER - 0.28, -3.40, teak);          // cockpit sole
    K.addBox(b, W * 0.50, 0.42, 0.14, 0, SHEER - 0.02, -1.12, teak);          // bridgedeck
    [1, -1].forEach(function (side) {
      // COAMINGS: the raised lips a cockpit is a well inside of, and the
      // benches you actually sit on to sail her.
      K.addBox(b, 0.10, 0.34, 3.30, side * 1.10, SHEER + 0.14, -3.40, hull);
      K.markFixture(b, K.addBox(b, 0.48, 0.10, 2.90, side * 0.80, SHEER - 0.12, -3.50, teak), "cockpit-bench");
      K.addBox(b, 0.06, 0.26, 2.90, side * 1.03, SHEER + 0.05, -3.50, pad);
      // primary winch on the coaming, in front of the helmsman
      K.markFixture(b, K.addCyl(b, 0.085, 0.20, side * 0.86, SHEER + 0.36, -2.05, chrome, 10), "winch");
      // jib sheet car on the side deck
      K.addBox(b, 0.09, 0.06, 0.34, side * 1.30, sheerAt(1.05) + 0.04, 1.05, grey);
    });
    // the binnacle: a pedestal, a real wheel, an engine control and a compass
    K.addCyl(b, 0.10, 0.90, 0, SHEER + 0.10, -2.60, chrome, 10);
    const wheel = K.addCyl(b, 0.44, 0.06, 0, SHEER + 0.56, -2.60, chrome, 14);
    wheel.rotation.x = Math.PI / 2;
    K.markFixture(b, wheel, "helm-wheel");
    K.addCyl(b, 0.11, 0.12, 0, SHEER + 0.62, -2.42, dark, 10);                // compass dome
    K.addFixtureBox(b, "engine-control", 0.05, 0.24, 0.05, 0.16, SHEER + 0.34, -2.42, chrome);
    K.addScreen(b, -0.18, SHEER + 0.40, -2.44, 0.20, 0.14, 0, screen);
    K.addBox(b, W * 0.46, 0.16, 0.60, 0, SHEER - 0.02, -5.05, teak);          // stern seat / sugar scoop
    K.addBox(b, 0.44, 0.06, 0.34, 0, 0.34, -L * 0.5 - 0.62, teak);            // boarding step under the counter

    // ---- THE CABIN, entered down the companionway ---------------------------
    K.addBox(b, 2.02, 0.08, 4.25, 0, 0.48, 1.15, wood);
    K.addBox(b, 1.94, 0.05, 3.90, 0, SHEER + 0.62, 1.20, liner);
    [1, -1].forEach(function (side) {
      K.addFixtureBox(b, "cabin-settee", 0.54, 0.38, 1.70, side * 0.72, 0.72, 0.65, pad);
      K.addFixtureBox(b, "cabin-settee-back", 0.12, 0.62, 1.70, side * 0.96, 1.02, 0.65, pad);
    });
    K.addTable(b, 0, 0.52, 0.65, 0.72, 0.90, wood, chrome);
    K.addFixtureBox(b, "v-berth", 1.55, 0.28, 1.55, 0, 0.72, 2.72, pad);
    K.addCabinet(b, -0.92, 0.52, -0.42, 0.42, 0.72, 0.92, liner);
    K.addFixtureBox(b, "galley-counter", 0.50, 0.08, 0.92, -0.90, 1.29, -0.42, wood);
    K.addScreen(b, 0.86, 1.38, -0.30, 0.44, 0.27, Math.PI / 2, screen);
    K.addSeat(b, 0.68, 0.52, -0.45, 0, pad, chrome);
    for (let i = 0; i < 3; i++) K.addBox(b, 0.82, 0.08, 0.30, 0, 0.56 + i * 0.14, -1.05 - i * 0.30, teak);
    K.addFixtureBox(b, "cabin-light", 0.65, 0.04, 0.22, 0, SHEER + 0.56, 0.75, warm);

    // ---- FOREDECK GEAR + a guardrail that FOLLOWS THE SHEER -----------------
    // The old rail was a straight run of stanchions at a fixed x, so forward of
    // amidships it walked off the side of the boat. Laid on the sheer the loft
    // reports, it cannot.
    // The guardrail is the fleet's own sheerRail(): stanchions and two wires
    // that FOLLOW the sheer. The old one was a straight run at a fixed x, so
    // forward of amidships it walked off the side of the boat.
    if (out && K.sheerRail) {
      [1, -1].forEach(function (side) {
        K.sheerRail(b, out, side, -4.80, 5.60, 0.02, chrome, { height: 0.72, inset: 0.12, spacing: 1.45 });
      });
    }
    K.markFixture(b, K.addBox(b, 0.34, 0.20, 0.30, 0, sheerAt(5.30) + 0.12, 5.30, chrome), "windlass");
    K.addBox(b, 0.20, 0.36, 0.44, 0, sheerAt(5.95) + 0.05, 5.95, chrome);      // anchor on the roller
    [1, -1].forEach(function (side) {
      K.addBox(b, 0.16, 0.05, 0.06, side * Math.max(0.12, hbAt(4.40) - 0.22), sheerAt(4.40) + 0.04, 4.40, chrome);
      K.addBox(b, 0.16, 0.05, 0.06, side * (hbAt(-4.60) - 0.22), sheerAt(-4.60) + 0.04, -4.60, chrome);
    });

    // ---- THE RIG. Spars are SOLVED between real endpoints (addTubeBetween
    // audits both ends); wire rigging is swept as thin strips, because a stay
    // is a cable and a cable is not a cylinder you rotate into place.
    const MZ = 1.40;
    const mastFoot = [0, SHEER + 0.06, MZ], mastTop = [0, SHEER + 17.05, MZ];
    const hound = [0, SHEER + 15.72, 1.79];   // ON the forestay, solved for its height
    const stemHead = [0, sheerAt(6.20) + 0.16, 6.20];
    const goose = [0, SHEER + 1.58, MZ - 0.08];
    // THE BOOM IS EASED TO PORT (+x here; navLights puts port red at +x and
    // this whole fleet keeps that sign), about 11 degrees off the centreline,
    // which is where a boom sits on a broad reach — and it is why the sails
    // read as sails instead of as a flat plate seen edge-on from every angle.
    const boomEnd = [1.04, SHEER + 1.82, -3.72];
    K.addTubeBetween(b, mastFoot, mastTop, 0.125, grey, 10);
    K.addTubeBetween(b, goose, boomEnd, 0.095, grey, 8);
    K.addTubeBetween(b, [0, SHEER + 0.38, MZ - 0.04], [boomEnd[0] * 0.290, SHEER + 1.65, MZ - 1.54], 0.032, chrome, 8);  // vang, ON the boom
    // mast collar, halyard winches and a pair of cleats at the foot
    K.addCyl(b, 0.20, 0.16, 0, SHEER + 0.10, MZ, chrome, 12);
    [1, -1].forEach(function (side) {
      K.markFixture(b, K.addCyl(b, 0.075, 0.17, side * 0.30, SHEER + 0.32, MZ - 0.26, chrome, 10), "halyard-winch");
    });
    // SPREADERS + shrouds: without them the mast is a pole balanced on a deck.
    const sprY = SHEER + 8.65;
    K.addTubeBetween(b, [-1.18, sprY, MZ], [1.18, sprY, MZ], 0.038, grey, 7);
    if (HL) {
      const wire = function (pts, r) {
        const s = HL.strip(pts, r, chrome, { segments: 26, radial: 5 });
        if (s) { s.castShadow = false; b.add(s); }
      };
      wire([stemHead, mastTop], 0.016);                                        // forestay
      wire([[0, sheerAt(-6.10) + 0.14, -6.10], mastTop], 0.016);               // backstay
      [1, -1].forEach(function (side) {
        const chain = [side * 1.74, sheerAt(1.05) + 0.10, 1.05];
        wire([chain, [side * 1.18, sprY, MZ], mastTop], 0.013);                // cap shroud
        wire([[side * 1.70, sheerAt(1.85) + 0.10, 1.85], [0.03 * side, sprY - 0.22, MZ]], 0.011);  // lower
      });
      // the mainsheet: boom end down to a traveller across the bridgedeck
      wire([boomEnd, [boomEnd[0] * 0.5, SHEER + 0.22, -1.60], [0, SHEER + 0.18, -1.16]], 0.010);
      K.addBox(b, 1.30, 0.07, 0.09, 0, SHEER + 0.24, -1.16, grey);             // traveller track
    }

    // ---- THE SAILS. Set, drawing, cambered, double-sided. --------------------
    const PORT = [1, 0, 0];
    addSail(b, THREE, "sail_main",
      sail, [0, SHEER + 1.70, MZ - 0.10], [0, SHEER + 16.42, MZ], boomEnd, 0.085, PORT);
    addSail(b, THREE, "sail_jib",
      sail, [0, stemHead[1] + 0.06, 6.16], hound, [1.32, SHEER + 1.22, 1.02], 0.075, PORT);

    b.userData.marineFixtureCount += 4;                                        // companionway, coamings, pushpit, pulpit
    b.add(K.propGroup(0.7, [[0, -0.70, -3.58]]));
    K.addCyl(b, 0.05, 0.52, 0, -0.62, -3.26, chrome, 8).rotation.x = Math.PI / 2 - 0.22;  // shaft
    K.navLights(b, hbAt(5.20) + 0.04, sheerAt(5.20) + 0.06, 5.20, -L * 0.47, SHEER + 17.00);
    return K.finish(b, { width: W, length: L, height: 19.0, wheelbase: L * 0.6 });
  }
  function sloopDeck() {
    const SHEER = 1.10, decks = [
      { x: 0, z: -3.40, w: 2.08, d: 3.30, top: SHEER - 0.23 },     // cockpit sole
      { x: 0, z: -1.12, w: 2.00, d: 0.42, top: SHEER + 0.19 },     // bridgedeck
      { x: 0, z: 1.15, w: 2.02, d: 4.25, top: 0.52 },              // cabin sole
      // The side decks stop where the hull actually narrows. The old spec ran
      // them to z 5.7 at x 1.62, which on a real sloop's plan is over water.
      { x: 1.32, z: 0.60, w: 0.62, d: 6.20, top: SHEER + 0.10 },
      { x: -1.32, z: 0.60, w: 0.62, d: 6.20, top: SHEER + 0.10 },
      { x: 0, z: 4.30, w: 1.60, d: 1.80, top: SHEER + 0.24 },      // foredeck
    ];
    K_stairDecks(decks, 0, 0.82, -1.05, -1, 0.52, SHEER - 0.23, 3);
    return {
      decks: decks,
      walls: [
        { x: 1.12, z: 1.20, w: 0.10, d: 4.35, y0: 0.52, y1: SHEER + 0.82 },
        { x: -1.12, z: 1.20, w: 0.10, d: 4.35, y0: 0.52, y1: SHEER + 0.82 },
        { x: 0.76, z: -0.96, w: 0.72, d: 0.10, y0: 0.52, y1: SHEER + 0.82 },
        { x: -0.76, z: -0.96, w: 0.72, d: 0.10, y0: 0.52, y1: SHEER + 0.82 },
        { x: 0, z: 3.38, w: 2.18, d: 0.10, y0: 0.52, y1: SHEER + 0.82 },
        // the cockpit coamings, so the well is a well you stand in
        { x: 1.10, z: -3.40, w: 0.10, d: 3.30, y0: SHEER - 0.23, y1: SHEER + 0.32 },
        { x: -1.10, z: -3.40, w: 0.10, d: 3.30, y0: SHEER - 0.23, y1: SHEER + 0.32 },
      ],
      riders: true, yaw: true, camYaw: false, bodyYaw: true, tilt: true,
      onLeave: "upward", id: "sloop-decks",
    };
  }

  if (C.YACHT_FLEET !== false) {
    queue({
      key: "skiff", label: "Coastline Skiff 18", marque: "Coastline", model: "Coastline Skiff 18",
      price: 21000, build: smallBuilder(buildSkiff),
      hull: {
        loa: 5.5, beam: 1.9, draft: 0.28, massT: 0.55,
        topKts: 28, cruiseKts: 20, planeKts: 8, canPlane: true,
        accel0: 3.4, humpFrac: 0.46,
        steerKind: "thrust", steerLock: 0.58, steerRate: 7.0,
        yawRate: 2.05, yawAccel: 6.0, yawDamp: 2.8, pivotAft: 1.4,
        swayL: 2.5, swayQ: 0.40,
        trimRestDeg: 2.2, trimHumpDeg: 8.5, trimPlaneDeg: 3.6,
        heelSign: -1, heelGain: 0.028, maxHeel: 0.24,
        rideAbove: 0.05, waveGain: 1.05, slamV: 2.6,
        deckY: 0.14, boardY: 0.30, sternOffset: 2.75,
        // SEATED on the aft thwart with a hand on the tiller — this boat has
        // no console and no wheel, so the old standing-at-the-console eye was
        // an eye standing in mid-air.
        helm: { x: 0.10, y: 1.24, z: -1.42 },
        wakeScale: 0.7, audio: "bike",
        // Three men on a 5.5 m open boat with 0.62 m of freeboard: she is
        // stiff enough to work from and she swamps in five seconds of green
        // water over the side.
        stab: {
          gm: 0.35, phiV: 0.95, freeboard: 0.62, swampT: 5, crew: 3,
          seats: [
            { x: 0.10, y: 0.44, z: -1.42, yaw: 0 },
            { x: 0, y: 0.44, z: 0.10, yaw: 0 },
            { x: 0, y: 0.44, z: 1.42, yaw: 0 },
          ],
        },
      },
      feel: { accel: 1.15, top: 0.66, turn: 1.35, drift: 1.45, roll: 0.9 },
    });
    queue({
      key: "trawler", label: "Bergen Fisher 60", marque: "Bergen", model: "Bergen Fisher 60",
      price: 690000, build: smallBuilder(buildTrawler), deck: trawlerDeck(),
      hull: {
        loa: 18, beam: 5.6, draft: 2.4, massT: 95,
        topKts: 10.5, cruiseKts: 9, planeKts: 0, canPlane: false,
        // A loaded trawler is a truck: it takes ~25 s to make 10 knots and it
        // never plans anything quickly.
        accel0: 0.80, humpFrac: 0.68,
        steerKind: "rudder", steerLock: 0.36, steerRate: 2.0,
        yawRate: 0.22, yawAccel: 0.14, yawDamp: 0.75, pivotAft: 4.9,
        thrusterYaw: 0.05,
        swayL: 0.78, swayQ: 0.14,
        trimRestDeg: 1.6, trimHumpDeg: 3.2, trimPlaneDeg: 1.6,
        heelSign: 1, heelGain: 0.034, maxHeel: 0.12,
        rideAbove: 0.05, waveGain: 0.62, slamV: 5.0,
        deckY: 2.43, boardY: 2.43, sternOffset: 9.0,
        // at the wheel buildTrawler bolts at (-0.48, SHEER+1.20, 3.72), on the
        // wheelhouse sole (2.43) — the offset wheel is the authored art
        helm: { x: -0.48, y: 4.01, z: 3.12 },
        wakeScale: 2.6, audio: "truck",
      },
      feel: { accel: 0.34, top: 0.30, turn: 0.30, drift: 0.85, roll: 0.5 },
    });
    queue({
      key: "sportfish", label: "Ravenna 41 Convertible", marque: "Ravenna", model: "Ravenna 41 Convertible",
      price: 1450000, build: smallBuilder(buildSportfish), deck: sportfishDeck(),
      hull: {
        loa: 12.5, beam: 4.3, draft: 1.15, massT: 14,
        topKts: 34, cruiseKts: 27, planeKts: 16, canPlane: true,
        accel0: 1.70, humpFrac: 0.56,
        steerKind: "rudder", steerLock: 0.44, steerRate: 3.4,
        yawRate: 0.66, yawAccel: 0.90, yawDamp: 1.25, pivotAft: 3.4,
        thrusterYaw: 0.30,
        swayL: 1.20, swayQ: 0.21,
        trimRestDeg: 2.2, trimHumpDeg: 6.2, trimPlaneDeg: 2.8,
        heelSign: -1, heelGain: 0.021, maxHeel: 0.17,
        rideAbove: 0.05, waveGain: 0.60, slamV: 4.0,
        deckY: 1.48, boardY: 0.35, sternOffset: 6.6,
        // a convertible is driven from the FLYBRIDGE (sole SHEER+2.20, twin
        // seats at z -0.4) — seated eye up on the perch, not in the saloon
        helm: { x: 0, y: 4.68, z: -0.4 },
        wakeScale: 2.0, audio: "truck",
      },
      feel: { accel: 0.60, top: 0.82, turn: 0.50, drift: 1.15, roll: 0.5 },
    });
    queue({
      key: "sloop", label: "Marlow 44 Sloop", marque: "Marlow", model: "Marlow 44 Sloop",
      price: 480000, build: smallBuilder(buildSloop), deck: sloopDeck(),
      hull: {
        // The speeds are still the AUXILIARY DIESEL's: she carries her main
        // and her jib now, but nothing in this game models wind, and a boat
        // whose stat sheet claimed sailing performance it could not deliver
        // would be the stat fiction the other way round.
        loa: 13.5, beam: 4.0, draft: 2.45, massT: 12,
        topKts: 8, cruiseKts: 6.5, planeKts: 0, canPlane: false,
        accel0: 0.70, humpFrac: 0.60,
        steerKind: "rudder", steerLock: 0.48, steerRate: 3.0,
        yawRate: 0.40, yawAccel: 0.36, yawDamp: 1.0, pivotAft: 3.6,
        swayL: 0.95, swayQ: 0.16,
        trimRestDeg: 0.9, trimHumpDeg: 2.0, trimPlaneDeg: 0.9,
        // A keelboat heels HARD and comes back: the ballast bulb is the whole
        // difference between this and a powerboat.
        heelSign: 1, heelGain: 0.075, maxHeel: 0.34,
        rideAbove: 0.05, waveGain: 0.80, slamV: 4.6,
        deckY: 1.14, boardY: 1.14, sternOffset: 6.75,
        // a sailboat is steered from the AFT cockpit, standing behind the
        // binnacle wheel at z -2.6 — the derived forward-wheelhouse ratio
        // would put the eye on the coachroof
        helm: { x: 0, y: 2.49, z: -3.3 },
        wakeScale: 1.1, audio: "truck",
        // Four aboard a 13.5 m keelboat: the helmsman behind the binnacle and
        // three on the cockpit benches. She has a ballast bulb, so phiV 2.1 —
        // knock her flat and she comes back up.
        stab: {
          gm: 0.80, phiV: 2.10, freeboard: 1.10, swampT: 40, crew: 4,
          seats: [
            { x: 0, y: 0.98, z: -2.05, yaw: 0 },
            { x: 0.80, y: 0.98, z: -3.10, yaw: 0 },
            { x: -0.80, y: 0.98, z: -3.10, yaw: 0 },
            { x: 0.80, y: 0.98, z: -4.20, yaw: 0 },
          ],
        },
      },
      feel: { accel: 0.30, top: 0.24, turn: 0.55, drift: 0.9, roll: 1.0 },
    });
  }

  /* ==========================================================================
     8. THE WORLD — vessels afloat, at anchor and under way

     THIS SECTION SHIPPED BROKEN AND THE POST-MORTEM IS THE DESIGN.
     ------------------------------------------------------------
     The first version put the roadstead at `A.maxX + 26 + {210,340,520}`,
     inheriting marina.js's fallback comment that `A.maxX + 26` is "the east
     seawall line". It is not. There is land east of A.maxX in this world, so
     every step of those offsets walked further INLAND, and the probe measured
     all three anchor points on dry ground. Then the second fault finished the
     job: the required clearance was `max(loa*0.55, (draft*1.6 - 1.1)/0.075)` =
     146 m for the biggest berth, i.e. 12 m of water, demanded inside a 900 m
     ring search AROUND AN INLAND POINT. `nearestWater` only succeeds where
     `shoreAt < -clearance`, so it returned null three times, `anchorages` read
     0, and the three superyachts — the whole headline — never existed. The
     small craft survived only because their clearances are small.

     TWO RULES CAME OUT OF IT AND BOTH ARE ENFORCED BELOW.

     (1) DO NOT NAME A PLACE IN THE SEA. Derive it — from the harbour the world
         already built (marina.js's berths are water-verified at registration)
         or, failing that, whatever water the field can find near the city.
         Never a coordinate.

         v2 of this derived it by GRADIENT DESCENT on the signed shoreline
         field and that was wrong for a reason that generalises: A SIGNED
         DISTANCE FIELD IS NOT A MAP. continent.js carves the harbour as a
         28..95 u ring whose signed value is a V pinned at -33.5 (= 3.61 m of
         water), and the COUNTRY BELT between that ring and the ocean is a
         RIDGE. Descent walked to the bottom of the V and stopped, because
         crossing a ridge is precisely what descent cannot do. See THE
         NAVIGATOR below: the roadstead is now RAY MARCHED outward on a fan of
         bearings, which crosses whatever is in the way.

     (2) A REFUSAL MUST BE LOUD. `superyachts: 0` looked like configuration for
         a whole merge because one `refused` counter covered two unrelated
         causes and nothing recorded WHY. The audit now carries
         `refusedNoWater` / `refusedNoFit` separately, an `anchorFail` reason
         string, and `anchorDepth` — the depth actually achieved — so the next
         time this cannot supply an anchorage it says so in words.

     And the demand itself is honest: `depthAt` is 1.1 + 0.075*|shoreAt|, so
     8.7 m of water is 101 m of shore clearance. A ship needs under-keel
     clearance, not a canyon: draft*1.35 + 0.6 (a 6 m draft anchors in 8.7 m)
     with a swinging-room floor of 0.35 * LOA. `CBZ.yachtDepthProfile()` prints
     the sounding outward from the harbour so this can be checked rather than
     argued about, and `anchorFloats` evaluates the acceptance test in place.
     ========================================================================== */
  const AFLOAT = [];             // {key, car, berth}
  let anchorage = [];            // registered deep-water berths
  // THREE REFUSAL SCOPES, and they are separate because the retry below runs
  // twice a second: a counter that ACCUMULATES across retries would report a
  // single unplaceable hull as hundreds of refusals and bury the real number.
  // Each scope is RESET by the pass that owns it, so every reading is the
  // current state of the world rather than a history of attempts.
  let placedCount = 0;
  let refusedWater = 0, refusedFit = 0;   // small craft — reset by spawnFleet
  let roadNoWater = 0, roadNoFit = 0;     // the roadstead — reset by registerAnchorage
  let bigNoFit = 0;                       // big-hull placement — reset by placeBigs
  let anchorFail = null;         // WHY there is no roadstead, in words
  let anchorDepth = 0;           // metres of water actually achieved
  let anchorRange = 0;           // metres from the harbour to the roadstead
  let anchorTries = 0, bigTries = 0, bigsDone = false;

  function rng() {
    return CBZ.seedStream ? CBZ.seedStream("yachts") : (function () { let s = 981731; return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; })();
  }
  // The inverse of waterfield.js's own depthAt(), at a real under-keel factor.
  function clearanceFor(draft, loa) {
    const wantDepth = Math.max(1.4, +draft || 0.5) * 1.35 + 0.6;
    return Math.max((loa || 6) * 0.35, (wantDepth - 1.1) / 0.075);
  }
  function depthOf(shore) { return shore >= 0 ? 0 : Math.min(62, 1.1 + (-shore) * 0.075); }
  function hullRec(key) {
    return (CBZ.marineHulls && CBZ.marineHulls.get) ? CBZ.marineHulls.get(key) : null;
  }

  /* ---- THE NAVIGATOR ------------------------------------------------------
     v1 of this marched DOWN the signed shoreline field (gradient descent) and
     it was wrong for a reason worth writing down, because it is a whole class
     of bug: A SIGNED DISTANCE FIELD IS NOT A MAP, AND IT HAS TROUGHS.

     continent.js:569 carves the harbour as a Chebyshev RING around the city
     rect, BAY0 28 u to BAY1 95 u, and the signed value inside it is
        sBay = -min(bd - 28, 95 - bd)
     which is a V: deepest at the ring's midline, bd = 61.5, where it reads
     exactly -33.5 — and shoreField takes the MIN of that against everything
     else, so -33.5 is a HARD CEILING on depth anywhere in the harbour. Through
     waterfield.js's own depthAt (1.1 + 0.075*|shore|) that is 3.61 m. The probe
     measured 3.6. Gradient descent walked to the bottom of that V, found every
     neighbouring step shallower, fanned out, failed, and stopped — correctly,
     by its own contract, in the deepest water it could see.

     And it could never have done better, because between the harbour moat and
     the open ocean lies the COUNTRY BELT (continent.js's east/west/north/south
     underlay bands, from BAY1 out to the plate edge). That is a RIDGE in the
     field. No descent method crosses a ridge — that is what descent means.

     So the roadstead is not found by feel. It is found the way a ship finds
     one: point the bow away from the land and keep going until the sounding is
     deep enough. This RAY MARCHES outward on a fan of bearings, crossing
     whatever is in the way, and takes the NEAREST bearing that answers — so
     the anchorage is as close to the harbour as the geography permits and not
     one metre closer. A deep-water roadstead being a real voyage out of the
     harbour is the honest shape of this world, not a defect in it.
  ------------------------------------------------------------------------- */
  const BAY_CAP_SHORE = -33.5;   // continent.js's harbour-ring floor, for reporting

  // Outward: away from the landmass, so "seaward" is a fact about the plate
  // rather than a guess about the coast.
  function outwardBearing(seed, A) {
    const P = CBZ.CONTINENT_PLATE;
    const cx = P ? (P.minX + P.maxX) * 0.5 : (A && A.center ? A.center.x : 0);
    const cz = P ? (P.minZ + P.maxZ) * 0.5 : (A && A.center ? A.center.z : 0);
    const dx = seed.x - cx, dz = seed.z - cz;
    return (dx * dx + dz * dz > 1) ? Math.atan2(dz, dx) : 0;
  }
  function marchReach(A) {
    const P = CBZ.CONTINENT_PLATE;
    // far enough to clear the plate and then run out into open water
    if (P) return Math.max(4000, Math.hypot(P.maxX - P.minX, P.maxZ - P.minZ) * 0.6 + 3500);
    return 9000;
  }

  // The nearest point on a fan of outward bearings where the water is genuinely
  // deep enough. Returns the deepest point SEEN when nothing qualifies, so the
  // audit can still say how close it got instead of reporting nothing.
  function offshore(seed, need, A) {
    const wf = CBZ.waterField;
    if (!wf || !wf.shoreAt) return null;
    const base = outwardBearing(seed, A);
    const reach = marchReach(A), STEP = 110;
    let best = null, deepest = null;
    // +-90 deg in 15 deg steps. Wide on purpose: a harbour can face into a bay
    // whose mouth is square to the plate-centre bearing, and a fan too narrow
    // to see the mouth is the same class of failure as a descent too local to
    // leave the trough. 13 bearings is free — this runs ONCE per world.
    for (let k = -6; k <= 6; k++) {
      const a = base + k * (Math.PI / 12);
      const ca = Math.cos(a), sa = Math.sin(a);
      // Nothing past the best radius found so far can beat it, so later
      // bearings march only as far as they could still win.
      const lim = best ? Math.min(reach, best.r) : reach;
      for (let r = STEP; r <= lim; r += STEP) {
        const x = seed.x + ca * r, z = seed.z + sa * r;
        const sh = wf.shoreAt(x, z);
        if (!deepest || sh < deepest.shore) deepest = { x: x, z: z, shore: sh, r: r, bearing: a };
        if (sh < -need && CBZ.cityWaterAt && CBZ.cityWaterAt(x, z)) {
          if (!best || r < best.r) best = { x: x, z: z, shore: sh, r: r, bearing: a, deep: true };
          break;                                    // this bearing is answered
        }
      }
    }
    if (best) return best;
    if (!deepest) return null;
    deepest.deep = false;
    return deepest;
  }

  // A point we KNOW is water, derived from what the world built. The marina's
  // berths went through registerBerth's own water verification, so they are the
  // best seed in the game; the field search is the belt and braces.
  function harbourSeed(A) {
    if (CBZ.cityBerth && CBZ.cityBerth.list) {
      try {
        const list = CBZ.cityBerth.list();
        let best = null, bs = 0;
        for (const b of list) {
          const s = CBZ.waterField.shoreAt(b.x, b.z);
          if (s < bs) { bs = s; best = b; }         // the wettest berth on the quay
        }
        if (best) return { x: best.x, z: best.z, from: "berth:" + best.id };
      } catch (e) {}
    }
    const wf = CBZ.waterField;
    if (wf && wf.nearestWater && A) {
      const cx = A.center ? A.center.x : 0, cz = A.center ? A.center.z : 0;
      // Small clearance on purpose: this only has to be WATER. Depth is the
      // march's job, and asking for depth here is exactly the mistake that
      // broke the first version.
      const p = wf.nearestWater(cx, cz, 6, 6000);
      if (p) return { x: p.x, z: p.z, from: "field" };
    }
    return null;
  }

  /* ---- THE ROADSTEAD ------------------------------------------------------
     One berth per superyacht, sized from the HULL rather than from three typed
     numbers, marched out to water that will actually float it, and spread along
     the coast so three ships do not anchor on top of each other.            */
  const BIGS = ["yacht46", "yacht88", "yacht156"];
  function registerAnchorage(city) {
    anchorage = [];
    anchorFail = null;
    anchorDepth = 0; anchorRange = 0;
    roadNoWater = 0; roadNoFit = 0;
    anchorTries++;
    if (!CBZ.cityBerth || !CBZ.cityBerth.register) { anchorFail = "no-berth-block"; return; }
    const A = city || (CBZ.city && CBZ.city.arena);
    if (!A) { anchorFail = "no-arena"; return; }
    const wf = CBZ.waterField;
    if (!wf || !wf.shoreAt) { anchorFail = "no-waterfield"; return; }
    const seed = harbourSeed(A);
    if (!seed) { anchorFail = "no-water-near-city"; return; }

    // Nearest genuinely deep water, sized on the LARGEST hull's need.
    const big = hullRec("yacht156");
    const bigNeed = big && big.spec ? clearanceFor(big.spec.draft, big.spec.loa) : 101;
    const road = offshore(seed, bigNeed, A);
    if (!road) { anchorFail = "march-failed:" + seed.from; return; }
    anchorDepth = +depthOf(road.shore).toFixed(1);
    anchorRange = Math.round(road.r || 0);
    if (!road.deep) {
      // Say WHY it is shallow, not just that it is. If we are pinned at the
      // harbour ring's own floor then the march never left the moat and the
      // diagnosis is the field's V, not the sea.
      anchorFail = (road.shore > BAY_CAP_SHORE - 1.5 && road.shore < BAY_CAP_SHORE + 1.5)
        ? ("trapped-in-harbour-ring:" + anchorDepth + "m")
        : ("shallow-roadstead:" + anchorDepth + "m@" + anchorRange + "m");
    }

    // Spread the row ACROSS the outward bearing — a line of ships at anchor,
    // all the same distance offshore.
    const bh = road.bearing || 0;
    const tx = -Math.sin(bh), tz = Math.cos(bh);
    for (let i = 0; i < BIGS.length; i++) {
      const rec = hullRec(BIGS[i]);
      if (!rec || !rec.spec) { roadNoFit++; continue; }
      const S = rec.spec;
      const off = (i - 1) * Math.max(210, S.loa * 1.7);
      let x = road.x + tx * off, z = road.z + tz * off;
      // The offset can slide onto a bank or a headland, and `road` is the point
      // we PROVED. Verify the offset and fall back rather than lose the berth —
      // three hulls anchored closer together than ideal is a rounding error, a
      // missing 156 m superyacht is the bug that shipped.
      const need = clearanceFor(S.draft, S.loa);
      const sh = wf.shoreAt(x, z);
      if (!(sh < -need) || !CBZ.cityWaterAt || !CBZ.cityWaterAt(x, z)) { x = road.x; z = road.z; }
      if (!CBZ.cityWaterAt || !CBZ.cityWaterAt(x, z)) { roadNoWater++; continue; }
      const b = CBZ.cityBerth.register({
        id: "yacht-road-" + i,
        x: x, z: z,
        heading: bh + Math.PI,          // bow back toward the land she came from
        // Berth dimensions come off the HULL, not from three typed numbers —
        // the old {60,100,175} row was also where the 146 m clearance demand
        // came from (it estimated draft as berthLoa*0.043 = 7.5 m). 1.12 x LOA
        // and 1.30 x beam clear marina.js's fits() — `(b.beam + 0.5) >= beam` —
        // with room to spare at every size.
        loa: S.loa * 1.12, beam: S.beam * 1.30, kind: "anchorage",
        // Already verified water, so marina.js's own 90 m snap never fires.
        // Passed anyway as belt and braces: 90 m is shorter than one hull
        // length here, and a berth silently dropped is exactly how this feature
        // vanished the first time.
        snap: Math.max(120, S.loa * 1.5),
        label: "Outer Roadstead " + (i + 1),
      });
      if (b) anchorage.push(b); else roadNoWater++;
    }
    if (!anchorage.length && !anchorFail) anchorFail = "no-berth-registered";
  }

  /* ---- PLACING THE BIG HULLS. Idempotent, so the retry below is free. ---- */
  function placeBigs() {
    if (C.YACHT_AFLOAT === false) { bigsDone = true; return; }
    if (!CBZ.cityMakeCar || !CBZ.cityEcon || !CBZ.cityEcon.carByName) return;
    if (!CBZ.city || !CBZ.city.arena) return;
    // Bounded independently of the roadstead's own tries: a roadstead that
    // EXISTS but cannot seat a hull would otherwise retry for ever at 2 Hz.
    if (++bigTries > 30) { bigsDone = true; return; }
    if (!anchorage.length) registerAnchorage(CBZ.city.arena);
    if (!anchorage.length) return;                  // retry next tick
    bigNoFit = 0;                                   // this pass, not the history
    let placed = 0;
    for (let i = 0; i < BIGS.length; i++) {
      const key = BIGS[i];
      let already = false;
      for (const a of AFLOAT) if (a.key === key) { already = true; break; }
      if (already) { placed++; continue; }
      const rec = hullRec(key);
      if (!rec || !rec.model) { bigNoFit++; continue; }
      // The smallest FREE berth that fits — the same rule marina.js's
      // freeBerth() uses, so a 46 m hull never squats the 175 m roadstead.
      let berth = null;
      for (const b of anchorage) {
        if (b.occupant && !b.occupant.dead) continue;
        if (rec.spec.loa > b.loa + 0.5 || rec.spec.beam > b.beam + 0.5) continue;
        if (!berth || (b.loa * b.beam) < (berth.loa * berth.beam)) berth = b;
      }
      if (!berth) { bigNoFit++; continue; }
      if (place(key, rec, berth.x, berth.z, berth.heading, berth)) placed++;
    }
    if (placed >= BIGS.length) bigsDone = true;
  }

  // Put the fleet in the water. Called off spawnCityTraffic (which needs
  // CBZ.city.arena, only assigned after buildCity returns, and which clears
  // cityCars on every run) — exactly the seam marina.js and world.js use.
  function spawnFleet() {
    if (C.YACHT_AFLOAT === false) return;
    if (!CBZ.cityMakeCar || !CBZ.cityEcon || !CBZ.cityEcon.carByName) return;
    if (!CBZ.city || !CBZ.city.arena) return;
    // spawnCityTraffic CLEARS cityCars on every run and then we re-fire, which
    // is exactly why nothing here is `_persist`: a persisted fleet would survive
    // the clear and we would add a SECOND one on top of it every respawn. This
    // is marina.js's proven pattern — the world owns the lifetime, we own the
    // placement. Our own bookkeeping goes with it.
    AFLOAT.length = 0;
    GARAGES.length = 0;
    placedCount = 0; refusedWater = 0; refusedFit = 0;
    bigsDone = false; anchorTries = 0; bigTries = 0;
    for (const b of anchorage) b.occupant = null;

    // 1) THE SUPERYACHTS at anchor. If the roadstead is not ready yet the tick
    //    below retries — it must never be a one-shot again.
    placeBigs();

    // 2) THE WORKING WATER. Small craft scattered over the near coastal band.
    //    Seeded from the HARBOUR, not from A.maxX: same lesson, same fix.
    const r = rng();
    const work = [
      { key: "trawler", n: 3, r0: 260, r1: 1450 },
      { key: "skiff", n: 4, r0: 120, r1: 900 },
      { key: "sportfish", n: 2, r0: 180, r1: 1100 },
      { key: "sloop", n: 2, r0: 200, r1: 1200 },
      { key: "dinghy", n: 2, r0: 100, r1: 620 },
    ];
    // WHERE THE WORKING FLEET LIVES. Seeded from the ROADSTEAD when there is
    // one, not the harbour: the flagship now lies in genuinely deep water some
    // way offshore, and the sea you cross to reach her should be a working one
    // rather than empty. It also cures the refusals — a trawler needs 36.5 m of
    // shore clearance and the harbour ring is capped at 33.5, so trawlers
    // seeded inside the moat could never be placed there by construction.
    const road0 = anchorage.length ? anchorage[Math.min(1, anchorage.length - 1)] : null;
    const seed = road0 || harbourSeed(CBZ.city.arena);
    const cx = seed ? seed.x : (CBZ.city.arena.center ? CBZ.city.arena.center.x : 0);
    const cz = seed ? seed.z : (CBZ.city.arena.center ? CBZ.city.arena.center.z : 0);
    const wf = CBZ.waterField;
    for (const w of work) {
      const rec = hullRec(w.key);
      if (!rec || !rec.model) { refusedFit++; continue; }
      const need = clearanceFor(rec.spec.draft, rec.spec.loa);
      for (let i = 0; i < w.n; i++) {
        // ALL THREE DRAWS UP FRONT. A `continue` between them would make the
        // number of draws on this stream depend on how many placements the
        // water field refused — self-consistent here (the world is
        // deterministic per seed) but exactly the order-fragile shape
        // CLAUDE.md bans, and one shared-stream refactor away from being a
        // real desync.
        const a = r() * Math.PI * 2;
        const rad = w.r0 + r() * (w.r1 - w.r0);
        const hd = r() * Math.PI * 2;
        let x = cx + Math.cos(a) * rad, z = cz + Math.sin(a) * rad;
        if (wf && wf.nearestWater) {
          const p = wf.nearestWater(x, z, need, 900);
          if (!p) { refusedWater++; continue; }
          x = p.x; z = p.z;
        } else if (CBZ.cityWaterAt && !CBZ.cityWaterAt(x, z)) { refusedWater++; continue; }
        place(w.key, rec, x, z, hd, null);
      }
    }
  }

  function place(key, rec, x, z, heading, berth) {
    const model = CBZ.cityEcon.carByName(rec.model);
    // carByName NEVER returns null (economy.js ends `|| CARS[0]`), so a name we
    // did not get back is a ROAD CAR and must be refused — the exact trap
    // boatyard.js documents.
    if (!model || model.name !== rec.model) { refusedFit++; return null; }
    let car = null;
    try { car = CBZ.cityMakeCar(x, z, heading, false, model, 0); } catch (e) { car = null; }
    if (!car) { refusedFit++; return null; }
    car.ai = false; car.v = 0; car.baseV = 0; car.road = null;   // moored/at anchor
    car._yacht = key;
    if (berth) { berth.occupant = car; car._berthId = berth.id; }
    AFLOAT.push({ key: key, car: car, berth: berth || null });
    placedCount++;
    return car;
  }

  /* ==========================================================================
     9. THE GARAGE — shell doors, the tenders inside them, the cars on the deck
     ------------------------------------------------------------
     "places to park cars etc and small boats attached".

     The car deck is a REAL walkable/rideable surface (it is in the deck spec
     above), stocked at build time with real registered cars. The tenders are
     real hulls from this same registry — a launched tender is not a copy of a
     boat, it IS the boat the game already builds.
     ========================================================================== */
  const GARAGES = [];        // {car, doors:[Mesh], open:0..1, want:0|1, tenders:[], cars:[]}

  function garageOf(car) {
    for (let i = 0; i < GARAGES.length; i++) if (GARAGES[i].car === car) return GARAGES[i];
    return null;
  }

  function fitGarage(car) {
    if (C.YACHT_GARAGE === false || !car || !car.group) return null;
    // WHERE THE RECORD LIVES. water_hulls' finish() nests the drawn body inside
    // a root and stamps the root, and city/vehicles.js may nest THAT root again
    // when it promotes a custom visual — so a one-level scan is a coin flip.
    // One traverse, once per vessel, and it cannot be wrong.
    let info = null;
    car.group.traverse(function (o) { if (!info && o.userData && o.userData.yacht) info = o.userData.yacht; });
    if (!info) return null;
    const doors = [], stow = [];
    car.group.traverse(function (o) {
      if (o.userData && o.userData.yachtDoor) doors.push(o);
      else if (o.name && o.name.indexOf("yacht_tender_") === 0) stow.push(o);
    });
    const g = {
      car: car, doors: doors, open: 0, want: 0, tenders: [], cars: [],
      stow: stow, aboard: stow.length,
      solve: info.solve, pads: info.pads || [],
    };
    GARAGES.push(g);
    stockGarage(g);
    return g;
  }

  // WHAT IS IN THE GARAGE. Deterministic (position hash — never the shared rng
  // stream), and every item is a first-class registered vehicle.
  function stockGarage(g) {
    const S = g.solve;
    if (!S || !S.carDeck || !CBZ.cityRegisterVehicle) return;
    const car = g.car;
    const cd = S.carDeck;
    const econ = CBZ.cityEcon;
    if (!econ || !econ.CARS || !econ.CARS.length) return;
    const node = new window.THREE.Group();
    node.name = "yacht_hold";
    node.userData.dynamic = true;                 // live records live here — never batch
    car.group.add(node);
    g.node = node;
    const h = function (salt) { return CBZ.hash01 ? CBZ.hash01(car.pos.x, car.pos.z, salt) : 0.5; };
    // One garage car per slot. They are drawn by the ROAD fleet's own builder,
    // so the yacht authors no car geometry.
    for (let i = 0; i < cd.slots; i++) {
      const m = econ.CARS[(h(6100 + i) * econ.CARS.length) | 0];
      if (!m) continue;
      let grp = null;
      try { grp = CBZ.cityBuildPlayerCarVisual ? CBZ.cityBuildPlayerCarVisual(m.detailStyle || m.designStyle || "sedan") : null; } catch (e) { grp = null; }
      if (!grp) continue;
      grp.position.set(0, cd.y + 0.34, cd.z + (i - (cd.slots - 1) * 0.5) * 5.2);
      grp.rotation.y = Math.PI / 2;               // athwartships, the way a real car deck stows
      node.add(grp);
      g.cars.push({ grp: grp, model: m });
    }
  }

  // Swing the shell doors. ONE eased driver for every yacht in the world; the
  // panel is the only unmerged mesh in the hull precisely so this costs nothing.
  function driveDoors(dt) {
    for (let i = GARAGES.length - 1; i >= 0; i--) {
      const g = GARAGES[i];
      if (!g.car || g.car.dead || !g.car.group || !g.car.group.parent) { GARAGES.splice(i, 1); continue; }
      const want = g.want ? 1 : 0;
      if (Math.abs(g.open - want) < 0.001) { g.open = want; continue; }
      // 3.2 s full travel — a 5-tonne shell door is not a car door.
      g.open += clamp(want - g.open, -dt / 3.2, dt / 3.2);
      const t = g.open * g.open * (3 - 2 * g.open);          // smoothstep
      for (const d of g.doors) {
        const info = d.userData.yachtDoor;
        // hinged at the BOTTOM: it falls outward into a boarding platform,
        // which is what a real shell door does and what makes it a surface.
        d.rotation.z = -info.side * t * (Math.PI * 0.47);
        d.position.y = info.hinge + info.h * 0.5 * Math.cos(t * Math.PI * 0.47);
        d.position.x = info.x + info.side * info.h * 0.5 * Math.sin(t * Math.PI * 0.47);
      }
    }
  }

  // Launch a tender out of the garage. It is a REAL hull — the same 4.5 m RIB
  // water_hulls.js registers — placed in the water beside the ship.
  function launchTender(g) {
    if (!g || !CBZ.cityMakeCar || !CBZ.cityEcon || !CBZ.cityEcon.carByName) return null;
    const rec = hullRec("dinghy");
    if (!rec || !rec.model) return null;
    const model = CBZ.cityEcon.carByName(rec.model);
    if (!model || model.name !== rec.model) return null;
    const S = g.solve, car = g.car;
    const hd = car.heading || 0;
    // starboard beam, one beam-width off, abreast of the garage
    const sx = Math.cos(hd), sz = -Math.sin(hd);
    const fx = Math.sin(hd), fz = Math.cos(hd);
    const x = car.pos.x - sx * (S.halfBeam + 4.5) + fx * S.garage.z;
    const z = car.pos.z - sz * (S.halfBeam + 4.5) + fz * S.garage.z;
    if (CBZ.cityWaterAt && !CBZ.cityWaterAt(x, z)) return null;
    let t = null;
    try { t = CBZ.cityMakeCar(x, z, hd, false, model, 0); } catch (e) { t = null; }
    if (!t) return null;
    t.ai = false; t.v = 0; t.baseV = 0; t.road = null; t._yachtTender = g.car;
    // THE BOAT YOU SAW IS THE BOAT YOU GET: strike the stowed one off its
    // cradle as the real hull enters the water. Leaving both would be a lie.
    const cradle = g.stow && g.stow.length ? g.stow[g.tenders.length % g.stow.length] : null;
    if (cradle) { cradle.visible = false; g.aboard = Math.max(0, (g.aboard | 0) - 1); }
    g.tenders.push(t);
    return t;
  }
  CBZ.yachtGarage = {
    of: garageOf,
    open: function (car, on) { const g = garageOf(car); if (g) g.want = on ? 1 : 0; return !!g; },
    launch: function (car) { const g = garageOf(car); return g ? launchTender(g) : null; },
    list: function () { return GARAGES.slice(); },
  };

  /* ==========================================================================
     10. THE HELIDECK'S AIRFRAME

     Registered through CBZ.cityRegisterMilitaryVehicle — the SAME seam
     island_airport.js uses for civil aircraft — so it boards and flies on the
     existing air system. This file writes no flight model.
     ========================================================================== */
  function fitHelideck(g) {
    if (C.YACHT_HELIDECK === false || C.YACHT_HELI_PARKED === false) return;
    if (!g || !g.pads || !g.pads.length) return;
    if (!CBZ.cityRegisterMilitaryVehicle || !CBZ.debugBuildPoliceAir) return;
    // The AFT pad carries the ship's helicopter (the reference photo); the
    // forward pad is left clear, which is what a forward pad is FOR.
    const pad = g.pads.length > 1 ? g.pads[1] : g.pads[0];
    let grp = null;
    try { grp = CBZ.debugBuildPoliceAir.gunship ? CBZ.debugBuildPoliceAir.gunship() : null; } catch (e) { grp = null; }
    if (!grp) return;
    grp.position.set(pad.x, pad.y + 0.55, pad.z);
    grp.rotation.y = Math.PI;
    grp.userData.dynamic = true;
    g.car.group.add(grp);
    g.heli = grp;
    try {
      g.heliRec = CBZ.cityRegisterMilitaryVehicle({
        group: grp, kind: "heli", name: "Yacht Helicopter",
        model: { name: "Helicopter", value: 4200000, rarity: 0.02, body: "heli" },
        footW: 3.4, footL: 12.0, hot: false,
      });
    } catch (e) { g.heliRec = null; }
  }

  /* ==========================================================================
     11. WIRING — one landmass pass for the berths, one traffic wrap for the
     fleet, one cheap scan for garages/helidecks, one eased door driver.
     ========================================================================== */
  if (CBZ.addLandmass) {
    // RESET ONLY. The first version ALSO registered the roadstead here, at
    // landmass order 67 — one shot, mid-build, and if it came back empty the
    // superyachts simply never existed for the rest of the session with no
    // record of why. Registration now happens at spawn time and RETRIES, so a
    // water field that is not ready costs a tick instead of the whole feature.
    CBZ.addLandmass(function () {
      anchorage = [];
      AFLOAT.length = 0; GARAGES.length = 0;
      placedCount = 0; refusedWater = 0; refusedFit = 0;
      roadNoWater = 0; roadNoFit = 0; bigNoFit = 0;
      anchorFail = null; anchorDepth = 0; anchorRange = 0; anchorTries = 0; bigTries = 0; bigsDone = false;
      return null;
    }, 67);                            // right after marina.js (66) — berths first
  }

  (function wrapTraffic() {
    function bind() {
      if (!CBZ.spawnCityTraffic || CBZ.spawnCityTraffic._yachtWrapped) return !!(CBZ.spawnCityTraffic && CBZ.spawnCityTraffic._yachtWrapped);
      const orig = CBZ.spawnCityTraffic;
      const w = function (n) { const r = orig(n); try { spawnFleet(); } catch (e) {} return r; };
      // carry EVERY existing wrap marker forward (the repo's wrapper doctrine)
      for (const k in orig) { try { w[k] = orig[k]; } catch (e) {} }
      w._yachtWrapped = true;
      CBZ.spawnCityTraffic = w;
      return true;
    }
    if (!bind() && CBZ.onUpdate) {
      CBZ.onUpdate(14.7, function () { if (CBZ.spawnCityTraffic && CBZ.spawnCityTraffic._yachtWrapped) return; bind(); });
    }
  })();

  // Garage/helideck fitting: a cheap scan that only ever looks at cars flagged
  // as ours, at 2 Hz, and never at all on a world with no yachts in it.
  let fitT = 0;
  if (CBZ.onUpdate) CBZ.onUpdate(9.45, function (dt) {
    const g = CBZ.game;
    if (!g || g.mode !== "city") return;
    driveDoors(dt);
    fitT += dt;
    if (fitT < 0.5) return;
    fitT = 0;
    // THE RETRY. `anchorages: 0` must never again be a permanent state reached
    // silently: if the roadstead did not come up, try again. Bounded at 30
    // attempts (15 s) so a world that genuinely has no deep water stops asking
    // and leaves `anchorFail` in the audit as the explanation.
    if (!bigsDone && anchorTries < 30 && C.YACHT_AFLOAT !== false) {
      try { placeBigs(); } catch (e) { /* never let a retry break the tick */ }
    }
    for (let i = 0; i < AFLOAT.length; i++) {
      const a = AFLOAT[i];
      if (!a.car || a.car.dead || a.car._garageTried) continue;
      a.car._garageTried = true;
      const gg = fitGarage(a.car);
      if (gg) fitHelideck(gg);
    }
  });

  // THE VERBS. One zone per yacht, on the existing interaction layer — no new
  // popup, no second HUD. The shell door and the tender are the two things a
  // yacht can do that nothing else in the game can.
  if (CBZ.interactions && CBZ.interactions.registerZone) {
    CBZ.interactions.registerZone({
      id: "yacht-garage", kind: "yachtgarage", radius: 7.5,
      find: function (px, pz) {
        for (let i = 0; i < GARAGES.length; i++) {
          const g = GARAGES[i];
          if (!g.car || g.car.dead || !g.solve || !g.solve.garage) continue;
          const S = g.solve, hd = g.car.heading || 0;
          const fx = Math.sin(hd), fz = Math.cos(hd), sx = Math.cos(hd), sz = -Math.sin(hd);
          const gx = g.car.pos.x + fx * S.garage.z, gz = g.car.pos.z + fz * S.garage.z;
          for (const side of [1, -1]) {
            const dx = px - (gx + sx * side * (S.halfBeam + 1.2));
            const dz = pz - (gz + sz * side * (S.halfBeam + 1.2));
            if (dx * dx + dz * dz < 56) return { g: g, x: gx, z: gz, pos: { x: gx, y: 0, z: gz } };
          }
        }
        return null;
      },
      options: [
        {
          id: "yacht-door", slot: "e",
          label: function (t) { return t && t.g && t.g.want ? "Close the shell door" : "Open the shell door"; },
          onSelect: function (t) { if (t && t.g) t.g.want = t.g.want ? 0 : 1; },
        },
        {
          id: "yacht-tender", slot: "i",
          canShow: function (t) { return !!(t && t.g && t.g.open > 0.6 && (t.g.aboard | 0) > 0); },
          label: function () { return "Launch the tender"; },
          onSelect: function (t) {
            if (!t || !t.g) return;
            const tender = launchTender(t.g);
            if (!tender) return;
            // Hand over through the SHARED boarding-door arc: walk -> open ->
            // step -> handover, the same beats an aircraft door runs. A
            // launched tender you cannot get into is a prop, and CBZ.
            // cityEnterVehicle is the ONE entry path (wanted.js and modshop.js
            // both wrap it, so the crime check and the visual promotion come
            // free). If the arc is absent, hand over directly rather than
            // leaving the boat floating there.
            const board = function () { return CBZ.cityEnterVehicle ? CBZ.cityEnterVehicle(tender) : false; };
            if (CBZ.aircraftDoorArc && CBZ.aircraftDoorArc.boardProp) {
              try { if (CBZ.aircraftDoorArc.boardProp(tender, board)) return; } catch (e) {}
            }
            try { board(); } catch (e) {}
          },
        },
      ],
    });
  }

  /* ==========================================================================
     12. THE RATCHET — CBZ.yachtAudit()

       hulls          vessels this file registered into the ONE hull registry
       registered     how many of those the registry actually holds (a queued
                      hull that never landed is a silent fleet loss)
       afloat         live vessels in the world right now
       superyachts    of those, ones with a solved deck stack
       unregistered   MUST BE 0 — a hull we queued that the registry refused
       beached        MUST BE 0 — vessels sitting on dry land (the sea builder's
                      own copy of marina.js's ratchet, measured on OUR fleet)
       propless       MUST BE 0 — vessels with no berth AND no water under them
       helidecks / garages / tenders / holdCars — world presence of the three
                      features the owner asked for by name. A helideck with no
                      pad, or a garage with no car deck, is a stat fiction.
       maxDeckRigs    movingPlatform rigs our fleet is holding (cap is 64)
       refused        placements the water field turned down (evidence, not a
                      failure: an anchorage the coast cannot supply is correctly
                      refused rather than faked)
     ========================================================================== */
  CBZ.yachtAudit = function () {
    let registered = 0, unregistered = 0, beached = 0, propless = 0;
    let superyachts = 0, helidecks = 0, garages = 0, tenders = 0, holdCars = 0, rigs = 0;
    let tenderBays = 0, tendersAboard = 0;
    for (const k of REGISTERED) {
      const r = hullRec(k);
      if (r) registered++; else unregistered++;
    }
    for (const a of AFLOAT) {
      if (!a.car || a.car.dead) continue;
      const wet = CBZ.cityWaterAt ? !!CBZ.cityWaterAt(a.car.pos.x, a.car.pos.z) : true;
      if (!wet) beached++;
      if (!wet && !a.berth) propless++;
      if (a.car._deckRig) rigs++;
      const r = hullRec(a.key);
      if (r && r.deck && r.spec && r.spec.loa >= 40) superyachts++;
    }
    for (const g of GARAGES) {
      if (g.solve && g.solve.garage) { garages++; tenderBays++; }
      tendersAboard += (g.aboard | 0);
      if (g.pads && g.pads.length) helidecks += g.pads.length;
      tenders += g.tenders.length;
      holdCars += g.cars.length;
    }
    return {
      hulls: REGISTERED.length, registered: registered, unregistered: unregistered,
      afloat: AFLOAT.length, superyachts: superyachts,
      beached: beached, propless: propless,
      anchorages: anchorage.length, placed: placedCount,
      // ONE COUNTER COVERING TWO CAUSES IS WHAT LET THE ROADSTEAD BUG HIDE for a
      // whole merge. `refused` is kept as the total for continuity; the split is
      // the diagnosis. noWater = the field could not supply water deep enough;
      // noFit = there was water but no berth the hull fits.
      refused: refusedWater + refusedFit + roadNoWater + roadNoFit + bigNoFit,
      refusedNoWater: refusedWater + roadNoWater,
      refusedNoFit: refusedFit + roadNoFit + bigNoFit,
      // WHY there is no roadstead, in words, and how deep it actually got.
      // `superyachts: 0` must never again be indistinguishable from a config.
      anchorFail: anchorFail, anchorDepth: anchorDepth, anchorRange: anchorRange,
      anchorTries: anchorTries,
      // The acceptance test, evaluated in-place so it cannot drift from the law
      // the berth was sized by: the deepest hull afloat must have real water
      // under her keel, not merely a berth record.
      anchorFloats: (function () {
        const bg = hullRec("yacht156");
        if (!bg || !bg.spec) return null;
        return anchorDepth >= bg.spec.draft * 1.35 + 0.6;
      })(),
      helidecks: helidecks, garages: garages,
      tenderBays: tenderBays,        // garages with a shell door (structural)
      tendersAboard: tendersAboard,  // tenders stowed on their cradles right now
      tenders: tenders,              // tenders launched into the water (a verb)
      holdCars: holdCars,
      maxDeckRigs: rigs,
      enabled: C.YACHTS !== false,
    };
  };

  CBZ.yachtFleet = function () { return AFLOAT.slice(); };
  CBZ.yachtOf = function (car) { return car && car._yacht ? hullRec(car._yacht) : null; };
  CBZ.yachtReset = function () {
    AFLOAT.length = 0; GARAGES.length = 0; anchorage = [];
    placedCount = 0; refusedWater = 0; refusedFit = 0;
    roadNoWater = 0; roadNoFit = 0; bigNoFit = 0;
    anchorFail = null; anchorDepth = 0; anchorRange = 0; anchorTries = 0; bigTries = 0; bigsDone = false;
  };
  /* THE SOUNDING LINE. The orchestrator asked for a depth profile outward from
     the harbour to decide "is the sea shallow" vs "is the search stuck"; this
     answers it permanently instead of once. Pure read, allocation-light, safe
     any time after the world builds. `bayCapDepth` is the arithmetic ceiling
     continent.js's harbour ring imposes (shoreAt is clamped to -33.5 anywhere
     inside it) and `saturateDepthAt` is where waterfield.js's depthAt tops out
     at 62 m — between them they bracket every reading this table can produce. */
  CBZ.yachtDepthProfile = function (ranges, bearingDeg) {
    const wf = CBZ.waterField;
    const A = CBZ.city && CBZ.city.arena;
    if (!wf || !wf.shoreAt || !A) return { error: "no-world" };
    const seed = harbourSeed(A);
    if (!seed) return { error: "no-water-near-city" };
    const base = bearingDeg == null ? outwardBearing(seed, A) : (bearingDeg * Math.PI / 180);
    const R = ranges || [0, 250, 500, 1000, 2000, 3000, 5000, 8000];
    const ca = Math.cos(base), sa = Math.sin(base);
    const rows = R.map(function (r) {
      const x = seed.x + ca * r, z = seed.z + sa * r;
      const sh = wf.shoreAt(x, z);
      return {
        m: r, x: Math.round(x), z: Math.round(z),
        shore: Math.round(sh), depth: +depthOf(sh).toFixed(1),
        water: CBZ.cityWaterAt ? !!CBZ.cityWaterAt(x, z) : null,
      };
    });
    const bg = hullRec("yacht156");
    return {
      seed: { x: Math.round(seed.x), z: Math.round(seed.z), from: seed.from },
      bearingDeg: Math.round(base * 180 / Math.PI),
      reach: Math.round(marchReach(A)),
      needFlagship: bg && bg.spec ? +clearanceFor(bg.spec.draft, bg.spec.loa).toFixed(1) : null,
      bayCapDepth: +depthOf(BAY_CAP_SHORE).toFixed(2),
      saturateDepthAt: Math.round((62 - 1.1) / 0.075),
      rows: rows,
    };
  };

  // The roadstead, in words, for a probe that wants the diagnosis rather than
  // the counters.
  CBZ.yachtRoadstead = function () {
    return anchorage.map(function (b) {
      return {
        id: b.id, x: Math.round(b.x), z: Math.round(b.z),
        loa: +b.loa.toFixed(1), beam: +b.beam.toFixed(1),
        water: CBZ.cityWaterAt ? !!CBZ.cityWaterAt(b.x, b.z) : null,
        shore: CBZ.waterField ? Math.round(CBZ.waterField.shoreAt(b.x, b.z)) : null,
        occupied: !!(b.occupant && !b.occupant.dead),
      };
    });
  };
})();
