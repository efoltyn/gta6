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
    const white = K.roleMat("yc-white", "paint", 0xf2f4f5);             // radomes, deck markings
    const pool = K.roleMat("yc-pool", "plastic", 0x2f93b8);

    // ---- 1) HULL. Six width steps down the length, each an extruded prism in
    // the (z,y) plane. Sheer RISES toward the bow (the reference's pronounced
    // sheer) and the freeboard tucks away almost to the water at the transom,
    // which is what gives the low broad stern.
    const STEPS = 7;
    for (let i = 0; i < STEPS; i++) {
      const t0 = -1 + (2 * i) / STEPS, t1 = -1 + (2 * (i + 1)) / STEPS;
      const z0 = t0 * 0.5 * L, z1 = t1 * 0.5 * L;
      const w = HB * 2 * beamFrac((t0 + t1) * 0.5);
      // sheer: main deck edge rises 0.055L from amidships to the stem
      const sh0 = FB + sheerRise(S, t0), sh1 = FB + sheerRise(S, t1);
      const k0 = KEEL * keelFrac(t0), k1 = KEEL * keelFrac(t1);
      K.addPrism(b, w, [[z0, k0], [z0, sh0], [z1, sh1], [z1, k1]], 0, cream);
    }
    // boot stripe at the waterline + a bulbous forefoot (a real ship has one and
    // it is visible on the reference at the bow when she is light)
    [1, -1].forEach(function (side) {
      K.addBox(b, 0.07, S.draft * 0.14, L * 0.86, side * (HB - 0.03), 0.05, -L * 0.02, boot);
    });
    const bulb = K.addCyl(b, S.beam * 0.055, L * 0.055, 0, KEEL * 0.70, L * 0.455, cream, 8);
    bulb.rotation.x = Math.PI / 2;

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

    [1, -1].forEach(function (side) {
      // side deck sole + bulwark, running the full parallel midbody
      K.addBox(b, S.sideW, 0.14, L * 0.62, side * (HB - S.sideW * 0.5 - 0.10), FB + 0.09, L * 0.02, teak);
      K.addBox(b, 0.16, 1.02, L * 0.62, side * (HB - 0.06), FB + 0.55, L * 0.02, cream);
      K.addRail(b, side * (HB - 0.16), -0.30 * L, 0.31 * L, FB + 0.16, chrome, 2.2);
    });

    // ---- 3b) THE FOREDECK, and the way up onto it. The deck edge rises with
    // the sheer, so the bow deck stands ~1.1 m above the side deck on a 156 m
    // hull — well past physics.js's 0.45 m STEP_UP. A real yacht answers that
    // with two or three steps at the break of the foredeck, and so does this:
    // drawn and declared from the SAME call arguments, both sides.
    const fdTop = FB + sheerRise(S, 0.72);
    K.addBox(b, HB * 2 * beamFrac(0.72) * 0.86, 0.16, L * 0.20, 0, fdTop + 0.08, 0.36 * L, teak);
    // a sunpad on it (kept AFT of the helideck footprint) and the pulpit rail
    K.addBox(b, HB * beamFrac(0.60) * 1.10, 0.20, L * 0.045, 0, fdTop + 0.24, 0.278 * L, pad);
    [1, -1].forEach(function (side) {
      K.addStairs(b, side * HB * beamFrac(0.66) * 0.55, 1.1, 0.252 * L, 1, FB + 0.16, fdTop + 0.16, 4, teak);
      K.addRail(b, side * HB * beamFrac(0.80) * 0.92, 0.28 * L, 0.46 * L, fdTop + 0.16, chrome, 2.0);
    });

    // ---- 4) THE SUPERSTRUCTURE. One block per tier, each narrower and shorter,
    // with a long horizontal band of near-black glass on every face. Soft
    // radiused corners are read as a chamfer prism rather than a box.
    for (let k = 0; k <= S.tiers; k++) {
      const y0 = S.deckY[k], y1 = S.deckY[k] + S.deckH - 0.22;
      const hb = S.supHB[k], z0 = S.supZ0[k], z1 = S.supZ1[k];
      // The block, chamfered fore and aft AT THE TOP ONLY. The bottom edge must
      // run flat from z1 to z0 along y0 — raising the forward bottom corner
      // (an earlier draft put it at 0.30 of the block height) leaves the whole
      // deckhouse hovering above the deck it stands on.
      K.addPrism(b, hb * 2, [[z0, y0], [z0 + 0.012 * L, y1], [z1 - 0.020 * L, y1], [z1, y0]], 0, cream);
      // horizontal window band, both flanks + the aft face
      const winY = y0 + (y1 - y0) * 0.56, winH = (y1 - y0) * 0.42;
      [1, -1].forEach(function (side) {
        K.addBox(b, 0.10, winH, (z1 - z0) * 0.82, side * (hb + 0.01), winY, (z0 + z1) * 0.5, glass);
      });
      K.addBox(b, hb * 1.68, winH, 0.10, 0, winY, z0 - 0.01, glass);
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
      K.addStairs(b, 0, 1.5, S.supZ0[k] + 0.6, 1, y0, y1, n, teak);
      [1, -1].forEach(function (side) {
        K.addBox(b, 0.07, 1.00, n * 0.36, side * 0.80, y0 + (y1 - y0) * 0.5 + 0.5, S.supZ0[k] + 0.6 + n * 0.18, chrome);
      });
    }

    // ---- 5) THE BRIDGE. On a hull this size the wheelhouse is NOT at the very
    // top: it takes the forward face of the second-from-top tier, which is what
    // the reference shows and what a real 156 m yacht does.
    const bTier = Math.max(1, S.tiers - 1);
    const bY = S.deckY[bTier], bHB = S.supHB[bTier], bZ = S.supZ1[bTier];
    const scr = K.addBox(b, bHB * 1.86, S.deckH * 0.44, 0.14, 0, bY + S.deckH * 0.62, bZ - 0.03 * L, glass);
    scr.rotation.x = -0.30;                                  // raked wheelhouse screen
    // the console, a real helm wheel, and two helm chairs behind it
    K.addPrism(b, bHB * 1.5, [[bZ - 0.055 * L, bY + 0.16], [bZ - 0.052 * L, bY + 1.06],
      [bZ - 0.030 * L, bY + 1.10], [bZ - 0.028 * L, bY + 0.16]], 0, dark);
    K.addBox(b, 0.42, 0.42, 0.08, 0, bY + 1.30, bZ - 0.048 * L, dark);
    [0.95, -0.95].forEach(function (x) {
      K.addBox(b, 0.60, 0.20, 0.60, x, bY + 0.56, bZ - 0.072 * L, pad);
      K.addBox(b, 0.60, 0.56, 0.16, x, bY + 0.94, bZ - 0.087 * L, pad);
    });
    // bridge wings — the overhangs a big ship berths from
    [1, -1].forEach(function (side) {
      K.addBox(b, (S.halfBeam - bHB) * 0.9, 0.14, 0.045 * L, side * (bHB + (S.halfBeam - bHB) * 0.45),
        bY, bZ - 0.045 * L, teak);
      K.addRail(b, side * (S.halfBeam - 0.2), bZ - 0.068 * L, bZ - 0.022 * L, bY + 0.07, chrome, 1.6);
    });

    // ---- 6) THE SALOON, one deck below the bridge: a real room behind the
    // aft glass with a floor, a long settee, a table and a bar.
    const sY = S.deckY[0], sHB = S.supHB[0];
    K.addBox(b, sHB * 1.9, 0.10, Math.abs(S.supZ1[0] - S.supZ0[0]) * 0.55, 0, sY + 0.10,
      S.supZ0[0] + Math.abs(S.supZ1[0] - S.supZ0[0]) * 0.30, teakDk);
    K.addBox(b, sHB * 1.5, 0.46, 0.70, 0, sY + 0.40, S.supZ0[0] + 1.4, pad);
    K.addBox(b, sHB * 1.1, 0.12, 1.5, 0, sY + 0.80, S.supZ0[0] + 3.4, teak);
    K.addBox(b, 1.6, 1.05, 0.60, sHB * 0.55, sY + 0.62, S.supZ0[0] + 6.0, dark);
    // and the sliding glass that closes it, aft
    K.addBox(b, sHB * 1.55, S.deckH * 0.62, 0.10, 0, sY + S.deckH * 0.40, S.supZ0[0] - 0.02, glass);

    // ---- 7) THE MAST CLUSTER: white radomes of varying size on a lattice, and
    // a bank of four slim exhaust stacks. Straight from the reference photo.
    const topY = S.deckY[S.tiers] + S.deckH - 0.22;
    const mastZ = 0.02 * L, mastHB = S.supHB[S.tiers];
    [1, -1].forEach(function (side) {
      const leg = K.addBox(b, 0.20, 0.075 * L, 0.20, side * mastHB * 0.52, topY + 0.037 * L, mastZ, grey);
      leg.rotation.z = side * 0.10;
    });
    K.addBox(b, mastHB * 1.05, 0.20, 0.30, 0, topY + 0.070 * L, mastZ, grey);
    K.addBox(b, 0.16, 0.055 * L, 0.16, 0, topY + 0.098 * L, mastZ, grey);       // masthead pole
    // three radomes of DIFFERENT size — one idea, three scales
    const rr = 0.0135 * L;
    [[0, 0.060, 1.25], [0.62, 0.046, 0.85], [-0.62, 0.046, 0.85]].forEach(function (o) {
      const r = rr * o[2];
      const dome = new THREE.Mesh(sphGeo(K, r, 10), white);
      dome.position.set(o[0] * mastHB, topY + o[1] * L + r * 0.4, mastZ - r * 0.6);
      dome.castShadow = false; b.add(dome);
      K.addCyl(b, r * 0.45, r * 0.7, o[0] * mastHB, topY + o[1] * L - r * 0.5, mastZ - r * 0.6, grey, 8);
    });
    // four slim stacks, angled aft, in a bank
    for (let i = 0; i < 4; i++) {
      const sx = (i - 1.5) * (mastHB * 0.42);
      const st = K.addCyl(b, 0.021 * L, 0.055 * L, sx, topY + 0.030 * L, mastZ - 0.045 * L, grey, 8);
      st.rotation.x = 0.16;
      K.addCyl(b, 0.019 * L, 0.008 * L, sx, topY + 0.058 * L, mastZ - 0.049 * L, dark, 8);
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
    const doors = [];
    if (C.YACHT_GARAGE !== false && S.garage) {
      const GA = S.garage;
      [1, -1].forEach(function (side, i) {
        const hbAt = HB * beamFrac(GA.z / (0.5 * L));
        // the recess behind the door (dark, so an open door reads as a hole)
        K.addBox(b, 0.30, GA.h * 0.94, GA.len * 0.94, side * (hbAt - 0.22), GA.y + GA.h * 0.5, GA.z, dark);
        // addBox is (w=x, h=y, d=z): the garage runs FORE AND AFT for GA.len and
        // across the beam for the hull's width there. An earlier draft had these
        // two swapped, which drew a 21 m sole athwart a 22 m hull.
        K.addBox(b, hbAt * 1.7, 0.14, GA.len * 0.9, 0, GA.y, GA.z, grey);          // garage sole
        const d = new THREE.Mesh(K.boxGeo(0.16, GA.h, GA.len), cream);
        d.position.set(side * hbAt, GA.y + GA.h * 0.5, GA.z);
        d.name = "yacht_door_" + (side > 0 ? "p" : "s");
        d.userData.noMerge = true;                       // it MOVES: never bake it
        d.userData.yachtDoor = { side: side, hinge: GA.y, h: GA.h, x: side * hbAt };
        d.castShadow = false;
        b.add(d);
        doors.push(d.name);
      });
    }

    // ---- 10) NAV LIGHTS + ground tackle. navLights() carries three separate
    // detector contracts in its exact colours — never re-author them.
    K.addBox(b, 0.030 * L, 0.020 * L, 0.030 * L, 0, FB + sheerRise(S, 0.88) + 0.35, 0.44 * L, chrome); // windlass
    K.addBox(b, 0.016 * L, 0.026 * L, 0.036 * L, 0, FB * 0.55, 0.482 * L, chrome);                     // anchor in the pocket
    K.navLights(b, HB, FB + 0.9, 0.42 * L, S.sternZ + 0.02 * L, S.deckY[S.tiers] + 0.11 * L);

    const root = K.finish(b, {
      width: S.beam, length: L, height: S.airDraft, wheelbase: L * 0.6,
    });
    root.userData.yacht = { solve: S, pads: padded, doors: doors };
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
    // one open deck per tier + the superstructure blocks as walls
    for (let k = 0; k <= S.tiers; k++) {
      walls.push({
        x: 0, z: (S.supZ0[k] + S.supZ1[k]) * 0.5, w: S.supHB[k] * 2,
        d: Math.abs(S.supZ1[k] - S.supZ0[k]), y0: S.deckY[k], y1: S.deckY[k] + S.deckH - 0.22,
      });
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
      K_stairDecks(decks, 0, 1.5, S.supZ0[k] + 0.6, 1, y0, y1, n);
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

  // ---- SKIFF — 5.5 m open fishing skiff. The owner's "small fishing boat".
  function buildSkiff(K, THREE) {
    const b = new THREE.Group(), M = K.M;
    const L = 5.5, W = 1.9, hw = W * 0.5;
    const hull = K.roleMat("sk-hull", "paint", 0xdfe6ea), inner = K.roleMat("sk-in", "plastic", 0x9aa6ad);
    const dark = M.dark(), chrome = M.chrome(), teak = M.teakDk(), grey = M.grey();
    K.addPrism(b, W * 0.92, [[-L * 0.5, -0.34], [-L * 0.5, 0.42], [L * 0.20, 0.44], [L * 0.26, -0.30]], 0, hull);
    K.addPrism(b, W * 0.60, [[L * 0.18, -0.28], [L * 0.18, 0.46], [L * 0.44, 0.54], [L * 0.46, -0.10]], 0, hull);
    K.addPrism(b, W * 0.20, [[L * 0.42, -0.08], [L * 0.42, 0.54], [L * 0.50, 0.58], [L * 0.49, 0.12]], 0, hull);
    K.addBox(b, W * 0.74, 0.08, L * 0.72, 0, 0.10, -L * 0.03, inner);              // sole
    K.addBox(b, W * 0.86, 0.10, 0.42, 0, 0.36, L * 0.30, teak);                    // bow casting deck
    K.addBox(b, W * 0.86, 0.10, 0.50, 0, 0.30, -L * 0.40, teak);                   // stern seat
    // centre console + wheel + a rack of rods: this is what makes it a FISHING boat
    K.addPrism(b, 0.50, [[-0.22, 0.14], [-0.20, 0.86], [0.18, 0.90], [0.24, 0.14]], 0, dark);
    const scr = K.addBox(b, 0.44, 0.22, 0.03, 0, 1.04, 0.18, M.glass()); scr.rotation.x = -0.32;
    K.addBox(b, 0.19, 0.19, 0.03, 0.11, 0.90, 0.0, dark);
    for (let i = 0; i < 4; i++) {
      const rod = K.addBox(b, 0.035, 1.35, 0.035, (i < 2 ? 1 : -1) * (hw - 0.16), 0.80, -0.30 - (i % 2) * 0.26, grey);
      rod.rotation.x = 0.42; rod.rotation.z = (i < 2 ? -0.22 : 0.22);
    }
    K.addBox(b, 0.62, 0.36, 0.52, 0, 0.32, -L * 0.18, inner);                      // fish box
    // outboard
    K.addBox(b, 0.32, 0.30, 0.36, 0, 0.52, -L * 0.5 - 0.15, dark);
    K.addBox(b, 0.11, 0.44, 0.16, 0, 0.08, -L * 0.5 - 0.15, dark);
    K.addBox(b, 0.24, 0.03, 0.24, 0, -0.06, -L * 0.5 - 0.15, dark);
    b.add(K.propGroup(0.6, [[0, -0.16, -L * 0.5 - 0.26]]));
    K.navLights(b, hw, 0.46, L * 0.40, -L * 0.46, null);
    return K.finish(b, { width: W, length: L, height: 1.2, wheelbase: L * 0.6 });
  }

  // ---- TRAWLER — 18 m working stern trawler. Wheelhouse forward, open work
  // deck aft, gantry, net drum, outriggers, deck floods. A real fishing boat.
  function buildTrawler(K, THREE) {
    const b = new THREE.Group(), M = K.M;
    const L = 18, W = 5.6, hw = W * 0.5, KEEL = -2.4, SHEER = 2.35;
    const hull = K.roleMat("tr-hull", "paint", 0x2a4c6a), house = K.roleMat("tr-house", "paint", 0xe4e7e6);
    const rust = K.roleMat("tr-rust", "plastic", 0x8a5a3a);
    const teak = M.teakDk(), dark = M.dark(), grey = M.grey(), chrome = M.chrome(), glass = M.glass();
    K.addPrism(b, W, [[-9.0, KEEL], [-9.0, SHEER], [-2.0, SHEER], [-1.0, KEEL]], 0, hull);
    K.addPrism(b, W * 0.94, [[-2.4, KEEL], [-2.4, SHEER], [4.4, SHEER + 0.25], [5.0, KEEL * 0.80]], 0, hull);
    K.addPrism(b, W * 0.62, [[4.2, KEEL * 0.84], [4.2, SHEER + 0.22], [7.6, SHEER + 0.70], [7.9, KEEL * 0.34]], 0, hull);
    K.addPrism(b, W * 0.22, [[7.4, KEEL * 0.36], [7.4, SHEER + 0.66], [9.0, SHEER + 0.82], [8.9, 0.20]], 0, hull);
    [1, -1].forEach(function (side) {
      K.addBox(b, 0.07, 0.30, 15.5, side * (hw - 0.03), 0.10, -0.5, K.roleMat("tr-boot", "plastic", 0x14181d));
      K.addBox(b, 0.16, 0.95, 12.0, side * (hw - 0.08), SHEER + 0.42, -2.2, hull);   // bulwark
    });
    K.addBox(b, W * 0.86, 0.14, 9.0, 0, SHEER, -4.2, teak);                          // work deck
    // wheelhouse forward, raised on a whaleback
    K.addPrism(b, W * 0.74, [[1.2, SHEER], [1.4, SHEER + 2.9], [4.6, SHEER + 2.9], [5.0, SHEER + 0.3]], 0, house);
    [1, -1].forEach(function (side) {
      K.addBox(b, 0.10, 0.95, 2.6, side * (W * 0.37 + 0.01), SHEER + 1.95, 3.0, glass);
    });
    const ws = K.addBox(b, W * 0.66, 1.0, 0.10, 0, SHEER + 1.98, 4.62, glass); ws.rotation.x = -0.26;
    K.addBox(b, W * 0.60, 0.14, 2.2, 0, SHEER + 0.16, 3.0, teak);                    // wheelhouse sole
    K.addPrism(b, W * 0.5, [[3.7, SHEER + 0.16], [3.8, SHEER + 1.10], [4.5, SHEER + 1.12], [4.6, SHEER + 0.16]], 0, dark);
    K.addBox(b, 0.34, 0.34, 0.06, 0, SHEER + 1.30, 3.72, dark);                      // helm wheel
    // GANTRY over the stern ramp + net drum + outriggers: the trawler read
    [1, -1].forEach(function (side) {
      const leg = K.addBox(b, 0.24, 4.6, 0.24, side * (hw - 0.55), SHEER + 2.3, -7.4, rust);
      leg.rotation.z = side * 0.06;
      // outrigger booms, stowed up
      const out = K.addBox(b, 0.16, 7.4, 0.16, side * (W * 0.30), SHEER + 4.4, 1.0, rust);
      out.rotation.z = side * 0.60; out.rotation.x = 0.16;
    });
    K.addBox(b, W * 0.92, 0.30, 0.34, 0, SHEER + 4.55, -7.4, rust);                  // gantry head
    const drum = K.addCyl(b, 0.85, W * 0.70, 0, SHEER + 1.15, -5.6, grey, 10);
    drum.rotation.z = Math.PI / 2;
    K.addCyl(b, 0.95, 0.14, 0, SHEER + 1.15, -5.6, dark, 10).rotation.z = Math.PI / 2;
    // deck floods on the gantry, and the masthead
    [0.8, -0.8].forEach(function (s) {
      K.addBox(b, 0.26, 0.20, 0.16, s * W * 0.3, SHEER + 4.35, -7.2, M.navWhite());
    });
    K.addBox(b, 0.14, 2.4, 0.14, 0, SHEER + 4.9, 3.4, grey);
    // stacked crates and a coil of warp on the work deck
    for (let i = 0; i < 3; i++) K.addBox(b, 0.9, 0.55, 0.7, (i - 1) * 1.2, SHEER + 0.42, -2.6, rust);
    K.addCyl(b, 0.55, 0.34, -1.6, SHEER + 0.31, -8.0, dark, 10);
    b.add(K.propGroup(2.0, [[0, KEEL * 0.72, -8.8]]));
    K.navLights(b, hw, SHEER + 0.9, 7.2, -8.8, SHEER + 5.9);
    return K.finish(b, { width: W, length: L, height: 8.4, wheelbase: L * 0.6 });
  }
  function trawlerDeck() {
    const SHEER = 2.35, decks = [
      { x: 0, z: -4.2, w: 4.8, d: 9.0, top: SHEER + 0.08 },
      { x: 0, z: 3.0, w: 3.4, d: 2.2, top: SHEER + 0.24 },
    ];
    K_stairDecks(decks, 1.5, 0.8, 1.0, 1, SHEER + 0.08, SHEER + 0.24, 3);
    return {
      decks: decks,
      walls: [
        { x: 0, z: 3.1, w: 4.14, d: 3.8, y0: SHEER + 0.24, y1: SHEER + 2.9 },
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
    K.addPrism(b, W, [[-6.25, KEEL], [-6.25, SHEER], [-0.4, SHEER], [0.3, KEEL * 0.92]], 0, hull);
    K.addPrism(b, W * 0.90, [[-0.8, KEEL * 0.94], [-0.8, SHEER], [3.2, SHEER + 0.16], [3.7, KEEL * 0.60]], 0, hull);
    K.addPrism(b, W * 0.58, [[3.0, KEEL * 0.64], [3.0, SHEER + 0.14], [5.5, SHEER + 0.44], [5.7, KEEL * 0.20]], 0, hull);
    K.addPrism(b, W * 0.20, [[5.3, KEEL * 0.24], [5.3, SHEER + 0.42], [6.25, SHEER + 0.50], [6.15, 0.14]], 0, hull);
    [1, -1].forEach(function (side) {
      K.addBox(b, 0.05, 0.34, 10.6, side * (hw - 0.04), SHEER - 0.42, -0.6, navy);
    });
    K.addBox(b, 2.9, 0.14, 0.9, 0, 0.28, -6.6, teak);                                // swim platform
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
    K.addPrism(b, W * 0.66, [[-1.6, SHEER], [-1.6, SHEER + 2.05], [2.4, SHEER + 2.05], [3.0, SHEER + 0.20]], 0, hull);
    K.addBox(b, W * 0.60, 1.05, 0.08, 0, SHEER + 1.10, -1.62, glass);
    [1, -1].forEach(function (side) {
      K.addBox(b, 0.08, 0.52, 3.4, side * (W * 0.33 + 0.01), SHEER + 1.34, 0.4, glass);
      K.addBox(b, 0.62, 0.10, 5.6, side * 1.68, SHEER + 0.14, 1.6, teak);            // side deck
      K.addRail(b, side * 1.98, -1.4, 5.2, SHEER + 0.18, chrome, 1.7);
    });
    const ws = K.addBox(b, W * 0.62, 0.85, 0.08, 0, SHEER + 1.66, 2.60, glass); ws.rotation.x = -0.38;
    // FLYBRIDGE helm + the TUNA TOWER above it
    K.addStairs(b, 1.45, 0.7, -1.5, 1, SHEER + 0.14, SHEER + 2.20, 6, chrome);
    K.addBox(b, W * 0.62, 0.12, 3.2, 0, SHEER + 2.20, 0.6, teak);
    K.addPrism(b, 1.7, [[1.5, SHEER + 2.20], [1.6, SHEER + 3.05], [2.3, SHEER + 3.08], [2.4, SHEER + 2.20]], 0, dark);
    [0.55, -0.55].forEach(function (x) { K.addBox(b, 0.48, 0.16, 0.48, x, SHEER + 2.40, -0.4, pad); });
    K.addRail(b, 1.30, -1.0, 2.2, SHEER + 2.26, chrome, 1.4);
    K.addRail(b, -1.30, -1.0, 2.2, SHEER + 2.26, chrome, 1.4);
    [1, -1].forEach(function (side) {
      const leg = K.addBox(b, 0.09, 2.6, 0.09, side * 1.05, SHEER + 3.5, 0.5, grey);
      leg.rotation.z = side * 0.05;
      // OUTRIGGERS, swept back and up
      const rig = K.addBox(b, 0.07, 6.4, 0.07, side * 1.15, SHEER + 3.6, 0.2, grey);
      rig.rotation.z = side * 1.02; rig.rotation.x = -0.22;
    });
    K.addBox(b, 1.9, 0.10, 1.7, 0, SHEER + 4.8, 0.5, grey);                          // tower platform
    K.addBox(b, 0.9, 0.55, 0.10, 0, SHEER + 5.12, 1.24, dark);                        // tower helm
    b.add(K.propGroup(1.4, [[0.75, -0.95, -6.3], [-0.75, -0.95, -6.3]]));
    K.navLights(b, hw, SHEER + 0.5, 5.1, -6.1, SHEER + 5.4);
    return K.finish(b, { width: W, length: L, height: 6.9, wheelbase: L * 0.6 });
  }
  function sportfishDeck() {
    const SHEER = 1.42, decks = [
      { x: 0, z: -6.6, w: 2.9, d: 0.9, top: 0.35 },
      { x: 0, z: -3.6, w: 3.44, d: 4.2, top: SHEER + 0.06 },
      { x: 1.68, z: 1.6, w: 0.62, d: 5.6, top: SHEER + 0.19 },
      { x: -1.68, z: 1.6, w: 0.62, d: 5.6, top: SHEER + 0.19 },
      { x: 0, z: 0.6, w: 2.67, d: 3.2, top: SHEER + 2.26 },
    ];
    K_stairDecks(decks, 1.15, 0.7, -6.15, 1, 0.35, SHEER + 0.06, 4);
    K_stairDecks(decks, 1.45, 0.7, -1.5, 1, SHEER + 0.14, SHEER + 2.20, 6);
    return {
      decks: decks,
      walls: [
        { x: 0, z: 0.5, w: 2.84, d: 4.4, y0: SHEER, y1: SHEER + 2.05 },
        { x: 1.30, z: 0.6, w: 0.08, d: 3.2, y0: SHEER + 2.26, y1: SHEER + 3.2 },
        { x: -1.30, z: 0.6, w: 0.08, d: 3.2, y0: SHEER + 2.26, y1: SHEER + 3.2 },
      ],
      riders: true, yaw: true, camYaw: false, bodyYaw: true, tilt: true,
      onLeave: "upward", id: "sportfish-decks",
    };
  }

  // ---- SLOOP — 13.5 m sailing yacht under auxiliary power. A mast, a boom, a
  // furled main and a fin keel: three draw calls of silhouette that change what
  // the whole anchorage looks like.
  function buildSloop(K, THREE) {
    const b = new THREE.Group(), M = K.M;
    const L = 13.5, W = 4.0, hw = W * 0.5, KEEL = -0.95, SHEER = 1.10;
    const hull = K.roleMat("sl-hull", "paint", 0xf4f6f7), stripe = K.roleMat("sl-stripe", "paint", 0x1b3f63);
    const teak = M.teak(), chrome = M.chrome(), glass = M.glass(), grey = M.grey(), dark = M.dark();
    const sail = K.roleMat("sl-sail", "plastic", 0xe6e8e6);
    K.addPrism(b, W * 0.86, [[-6.75, KEEL * 0.6], [-6.75, SHEER], [-1.0, SHEER], [-0.2, KEEL]], 0, hull);
    K.addPrism(b, W, [[-1.4, KEEL], [-1.4, SHEER], [3.4, SHEER + 0.14], [4.0, KEEL * 0.74]], 0, hull);
    K.addPrism(b, W * 0.56, [[3.2, KEEL * 0.78], [3.2, SHEER + 0.12], [5.8, SHEER + 0.42], [6.0, KEEL * 0.22]], 0, hull);
    K.addPrism(b, W * 0.16, [[5.6, KEEL * 0.26], [5.6, SHEER + 0.40], [6.75, SHEER + 0.52], [6.65, 0.12]], 0, hull);
    [1, -1].forEach(function (side) {
      K.addBox(b, 0.05, 0.14, 11.4, side * (hw - 0.04), SHEER - 0.30, -0.4, stripe);
      K.addRail(b, side * (hw - 0.18), -5.6, 6.0, SHEER + 0.04, chrome, 1.9);
    });
    // FIN KEEL + spade rudder — a sailing yacht's draft is all keel
    K.addBox(b, 0.34, 1.55, 2.6, 0, KEEL - 0.72, -0.2, dark);
    K.addBox(b, 0.55, 0.30, 3.0, 0, KEEL - 1.46, -0.2, dark);          // bulb
    K.addBox(b, 0.14, 1.20, 0.70, 0, KEEL - 0.55, -4.6, dark);
    // coachroof + cockpit + wheel
    K.addPrism(b, W * 0.56, [[-1.0, SHEER], [-0.9, SHEER + 0.78], [3.4, SHEER + 0.82], [3.8, SHEER + 0.10]], 0, hull);
    [1, -1].forEach(function (side) {
      K.addBox(b, 0.08, 0.34, 3.6, side * (W * 0.28 + 0.01), SHEER + 0.52, 1.2, glass);
    });
    K.addBox(b, W * 0.52, 0.10, 3.2, 0, SHEER - 0.28, -3.4, teak);     // cockpit sole
    K.addBox(b, 0.10, 0.90, 0.10, 0, SHEER + 0.10, -2.6, chrome);
    K.addCyl(b, 0.44, 0.06, 0, SHEER + 0.52, -2.6, chrome, 12).rotation.x = Math.PI / 2;
    // THE RIG: mast, boom, furled main, forestay, backstay
    K.addCyl(b, 0.13, 17.0, 0, SHEER + 8.6, 1.4, grey, 8);
    K.addCyl(b, 0.10, 5.2, 0, SHEER + 1.55, -1.0, grey, 8).rotation.x = Math.PI / 2;
    K.addCyl(b, 0.26, 4.6, 0, SHEER + 1.90, -0.9, sail, 8).rotation.x = Math.PI / 2;   // furled main
    const fs = K.addBox(b, 0.05, 16.4, 0.05, 0, SHEER + 8.3, 3.6, grey); fs.rotation.x = 0.20;
    const bs = K.addBox(b, 0.05, 16.4, 0.05, 0, SHEER + 8.3, -1.2, grey); bs.rotation.x = -0.10;
    K.addCyl(b, 0.30, 5.4, 0, SHEER + 5.0, 3.9, sail, 6).rotation.x = 0.20;            // furled headsail
    b.add(K.propGroup(0.9, [[0, KEEL - 0.10, -4.9]]));
    K.navLights(b, hw, SHEER + 0.30, 6.1, -6.5, SHEER + 17.0);
    return K.finish(b, { width: W, length: L, height: 19.0, wheelbase: L * 0.6 });
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
        wakeScale: 0.7, audio: "bike",
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
        wakeScale: 2.0, audio: "truck",
      },
      feel: { accel: 0.60, top: 0.82, turn: 0.50, drift: 1.15, roll: 0.5 },
    });
    queue({
      key: "sloop", label: "Marlow 44 Sloop", marque: "Marlow", model: "Marlow 44 Sloop",
      price: 480000, build: smallBuilder(buildSloop),
      hull: {
        // Under auxiliary diesel only — this game has no sail model and a boat
        // that claims to sail and does not would be a stat fiction.
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
        wakeScale: 1.1, audio: "truck",
      },
      feel: { accel: 0.30, top: 0.24, turn: 0.55, drift: 0.9, roll: 1.0 },
    });
  }

  /* ==========================================================================
     8. THE WORLD — vessels afloat, at anchor and under way

     Anchorages are DERIVED, not authored: waterfield.js's depthAt() is
     depth = 1.1 + 0.075 * |shoreAt|, so the offshore clearance a hull needs to
     float is the inverse of its own draft. A 6 m draft needs 65 m of shore
     clearance; nobody types a coordinate and hopes.
     ========================================================================== */
  const AFLOAT = [];             // {rec, key, kind, berth}
  let anchorage = [];            // registered deep-water berths
  let placedCount = 0, refusedCount = 0;

  function rng() {
    return CBZ.seedStream ? CBZ.seedStream("yachts") : (function () { let s = 981731; return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; })();
  }
  function clearanceFor(draft, loa) {
    // depthAt inverse, with a 1.6x under-keel factor, and never less than half
    // a hull length of swinging room.
    return Math.max(loa * 0.55, (Math.max(0.4, draft) * 1.6 - 1.1) / 0.075);
  }
  function hullRec(key) {
    return (CBZ.marineHulls && CBZ.marineHulls.get) ? CBZ.marineHulls.get(key) : null;
  }

  // Register the deep-water anchorage berths. THIS IS WHY IT MATTERS: marina.js's
  // freeBerth() picks the smallest berth that FITS, and its largest is the 34 m
  // Med quay — so without this a 156 m hull retrieved from a garage would be
  // dropped into a 34 m slot, or (worse) counted as beached. One call each.
  function registerAnchorage(city) {
    anchorage = [];
    if (!CBZ.cityBerth || !CBZ.cityBerth.register) return;
    const A = city || (CBZ.city && CBZ.city.arena);
    if (!A) return;
    const cz = A.center ? A.center.z : 0;
    const EEx = A.maxX + 26;
    const wf = CBZ.waterField;
    // Three roadstead berths of increasing size, walking out from the harbour.
    // Each is validated against the real water field before it is registered;
    // registerBerth also snaps to nearest water, so a moved coastline degrades
    // into a slightly different anchorage rather than a lie.
    const want = [
      { id: "yacht-road-0", loa: 60, beam: 12, off: 210, dz: 250 },
      { id: "yacht-road-1", loa: 100, beam: 17, off: 340, dz: 60 },
      { id: "yacht-road-2", loa: 175, beam: 26, off: 520, dz: -190 },
    ];
    for (const w of want) {
      let x = EEx + w.off, z = cz + w.dz;
      const need = clearanceFor(w.loa * 0.043, w.loa);
      if (wf && wf.nearestWater) {
        const p = wf.nearestWater(x, z, need, 900);
        if (!p) { refusedCount++; continue; }
        x = p.x; z = p.z;
      } else if (CBZ.cityWaterAt && !CBZ.cityWaterAt(x, z)) { refusedCount++; continue; }
      const b = CBZ.cityBerth.register({
        id: w.id, x: x, z: z, heading: -Math.PI / 2,
        loa: w.loa, beam: w.beam, kind: "anchorage",
        label: "Outer Roadstead " + (anchorage.length + 1),
      });
      if (b) anchorage.push(b); else refusedCount++;
    }
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
    placedCount = 0;
    if (!anchorage.length) registerAnchorage(CBZ.city.arena);

    const r = rng();
    // 1) THE SUPERYACHTS at anchor — biggest berth gets the biggest hull.
    const bigs = ["yacht46", "yacht88", "yacht156"];
    for (let i = 0; i < anchorage.length && i < bigs.length; i++) {
      const key = bigs[i];
      const rec = hullRec(key);
      if (!rec || !rec.model) continue;
      const b = anchorage[i];
      if (rec.spec.loa > b.loa + 0.5) continue;      // never squat a berth it does not fit
      place(key, rec, b.x, b.z, b.heading, b);
    }
    // 2) THE WORKING WATER. Small craft scattered over the near coastal band —
    // trawlers and skiffs out on the fishing ground, a sloop and a sportfisher
    // nearer in. Every position is validated water at the hull's own clearance.
    const work = [
      { key: "trawler", n: 3, r0: 260, r1: 1450 },
      { key: "skiff", n: 4, r0: 120, r1: 900 },
      { key: "sportfish", n: 2, r0: 180, r1: 1100 },
      { key: "sloop", n: 2, r0: 200, r1: 1200 },
      { key: "dinghy", n: 2, r0: 100, r1: 620 },
    ];
    const A = CBZ.city.arena;
    const cx = A.maxX + 60, cz = A.center ? A.center.z : 0;
    const wf = CBZ.waterField;
    for (const w of work) {
      const rec = hullRec(w.key);
      if (!rec || !rec.model) continue;
      const need = clearanceFor(rec.spec.draft, rec.spec.loa);
      for (let i = 0; i < w.n; i++) {
        const a = r() * Math.PI * 2;
        const rad = w.r0 + r() * (w.r1 - w.r0);
        let x = cx + Math.cos(a) * rad, z = cz + Math.sin(a) * rad;
        if (wf && wf.nearestWater) {
          const p = wf.nearestWater(x, z, need, 700);
          if (!p) { refusedCount++; continue; }
          x = p.x; z = p.z;
        } else if (CBZ.cityWaterAt && !CBZ.cityWaterAt(x, z)) { refusedCount++; continue; }
        place(w.key, rec, x, z, r() * Math.PI * 2, null);
      }
    }
  }

  function place(key, rec, x, z, heading, berth) {
    const model = CBZ.cityEcon.carByName(rec.model);
    // carByName NEVER returns null (economy.js ends `|| CARS[0]`), so a name we
    // did not get back is a ROAD CAR and must be refused — the exact trap
    // boatyard.js documents.
    if (!model || model.name !== rec.model) { refusedCount++; return null; }
    let car = null;
    try { car = CBZ.cityMakeCar(x, z, heading, false, model, 0); } catch (e) { car = null; }
    if (!car) { refusedCount++; return null; }
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
    const doors = [];
    car.group.traverse(function (o) { if (o.userData && o.userData.yachtDoor) doors.push(o); });
    const g = {
      car: car, doors: doors, open: 0, want: 0, tenders: [], cars: [],
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
    CBZ.addLandmass(function (city) {
      anchorage = [];
      AFLOAT.length = 0; GARAGES.length = 0;
      placedCount = 0; refusedCount = 0;
      registerAnchorage(city);
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
          canShow: function (t) { return !!(t && t.g && t.g.open > 0.6); },
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
      if (g.solve && g.solve.garage) garages++;
      if (g.pads && g.pads.length) helidecks += g.pads.length;
      tenders += g.tenders.length;
      holdCars += g.cars.length;
    }
    return {
      hulls: REGISTERED.length, registered: registered, unregistered: unregistered,
      afloat: AFLOAT.length, superyachts: superyachts,
      beached: beached, propless: propless,
      anchorages: anchorage.length, refused: refusedCount, placed: placedCount,
      helidecks: helidecks, garages: garages, tenders: tenders, holdCars: holdCars,
      maxDeckRigs: rigs,
      enabled: C.YACHTS !== false,
    };
  };

  CBZ.yachtFleet = function () { return AFLOAT.slice(); };
  CBZ.yachtOf = function (car) { return car && car._yacht ? hullRec(car._yacht) : null; };
  CBZ.yachtReset = function () { AFLOAT.length = 0; GARAGES.length = 0; anchorage = []; placedCount = 0; refusedCount = 0; };
})();
