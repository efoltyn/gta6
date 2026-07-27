/* ============================================================
   city/airside.js — THE AIRPORT'S OWN TRAFFIC.

   OWNER REPORT: "there are cars spawning randomly inside airport near runway
   etc, its dumb, shows how dumb traffic and car spawning is."

   city/roadrules.js fixed the WRONG half of that: it closed the airfield to
   ordinary city traffic (roadOpen / roadPointOpen / roadPick now honour the
   `noSpawn` keep-outs the airport registers, so a saloon can no longer
   materialise on runway 09/27). That was necessary and it is not enough. An
   airfield with the wrong traffic deleted is an airfield with NO traffic — an
   empty diorama with four parked jets on it. A real airport is one of the
   busiest patches of tarmac in a city; what makes it read as one is not the
   aeroplanes, it is the SWARM around them: tugs, baggage trains, catering
   lifts, bowsers and a follow-me car, all crawling around on a road network
   nobody outside the fence is allowed to use.

   So this file is the other half. It gives the airside the traffic it SHOULD
   have, and it authors as little as it possibly can:

     • the VEHICLES are new (nothing in the game looked like a baggage train),
       built out of the repo's own primitives — cmat / boxGeom / taperBox /
       vehicleMat — and registered through CBZ.cityRegisterVehicle, so every
       one of them is a first-class CBZ.cityCars record: enterable, drivable,
       damageable, solid to other cars, choppable. Owner law, no dumb props.
       Stealing a baggage tug off a live apron works, and the service loop
       lets go of it the moment you do.
     • the ROUTES are derived from the airfield the world already built. The
       runway rectangle and island bounds come out of CBZ.city.arena
       .airportAudit; the gate stops come from the ACTUAL parked aircraft
       groups discovered in the arena (their real x/z), not from a second copy
       of island_airport.js's gate maths. If somebody moves the airport with
       the worldOff dial, this file moves with it and nobody edits a number.
     • the KERB traffic is ordinary cars: CBZ.cityAddParkedCar builds them, so
       the landside frontage gets the real catalogue models, real occupants,
       the real damage model — not five more boxes authored here.

   THE ONE RULE THAT MAKES IT AN AIRPORT
   -------------------------------------
   Aircraft outrank ground vehicles, always. A service vehicle whose next
   waypoint is near an aircraft UNDER POWER stops and waits for it. That
   single behaviour — a baggage train sitting still, engine running, while a
   jet is towed across in front of it — is what separates "an airport" from
   "vehicles driving around near planes". It is implemented once, in
   craftBlocks(), and every route obeys it.

   A parked aircraft is treated differently and deliberately so: it is a
   hazard where its HARDWARE IS, not because it is nearby. The test is an
   oriented box around the gear and engines (0.32 x length, 0.22 x span),
   which is exactly the part of an airliner that lives at vehicle height. Its
   nose cone, its underwing and its upswept tail are metres in the air — a
   head-of-stand road is supposed to run under the tails and a bowser is
   supposed to park under a wing — which is why that box is derived from the
   aircraft's own published dims rather than from its bounding rectangle. No
   aircraft is named anywhere in this file.

   NOBODY DRIVES ON THE RUNWAY. Every authored waypoint sits on the apron, the
   taxiway or the service road; the audit below counts violations and it must
   read zero. The ONE exception is a rare runway-inspection run by the
   follow-me car, which must hold short at the painted hold bars until nothing
   on the field is moving, is flagged `cleared` while it is out there, and is
   a one-line revert (AIRSIDE_RUNWAY_INSPECT).

   FLAGS
   -----
     CBZ.CONFIG.AIRSIDE_TRAFFIC          the whole file (default true)
     CBZ.CONFIG.AIRSIDE_KERB             landside kerb cars only
     CBZ.CONFIG.AIRSIDE_RUNWAY_INSPECT   the follow-me's runway run only

   AUDIT: CBZ.airsideAudit() -> {vehicles, onRunway, holdingShort, routes, …}.
   `onRunway` is the ratchet and reads 0 on a clean world.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  CBZ.CONFIG = CBZ.CONFIG || {};

  // Every risky behaviour is a one-line revert (CLAUDE.md). The sub-flags exist
  // because the runway run and the landside cars are the two pieces most likely
  // to want turning off independently of the apron swarm.
  if (CBZ.CONFIG.AIRSIDE_TRAFFIC == null) CBZ.CONFIG.AIRSIDE_TRAFFIC = true;
  if (CBZ.CONFIG.AIRSIDE_KERB == null) CBZ.CONFIG.AIRSIDE_KERB = true;
  if (CBZ.CONFIG.AIRSIDE_RUNWAY_INSPECT == null) CBZ.CONFIG.AIRSIDE_RUNWAY_INSPECT = true;

  function on() { return CBZ.CONFIG.AIRSIDE_TRAFFIC !== false; }

  // ============================================================
  //  0. PRIMITIVES — every one guard-called, every one the repo's own.
  //     A missing helper must degrade to something that still draws, never
  //     to a thrown error mid-worldgen (a landmass builder that throws takes
  //     its whole island's remaining geometry with it).
  // ============================================================
  const mat = CBZ.mat || function (c) { return new THREE.MeshLambertMaterial({ color: c }); };
  const cmat = CBZ.cmat || mat;                       // pooled: use for anything repeated
  const boxGeom = CBZ.boxGeom || function (w, h, d) { return new THREE.BoxGeometry(w, h, d); };
  const taperBox = CBZ.taperBox || function (w, h, d) { return new THREE.BoxGeometry(w, h, d); };
  const vmat = CBZ.vehicleMat || function (role, color) { return cmat(color != null ? color : 0xb0b4ba); };
  const h01 = CBZ.hash01 || function (x, z, salt) {
    const n = Math.sin(x * 127.1 + z * 311.7 + (salt | 0) * 0.017) * 43758.5453;
    return n - Math.floor(n);
  };
  const lerpAngle = CBZ.lerpAngle || function (a, b, t) {
    let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  };

  // Wheel/round stock is the single biggest repeat in this file (36 wheels
  // across the fleet), so it is pooled by size and flagged _shared — the car
  // teardown path skips _shared geometry, exactly like island_airport's tug.
  const roundCache = new Map();
  function cylGeom(r, len, seg) {
    const k = r + "|" + len + "|" + (seg || 10);
    let g = roundCache.get(k);
    if (!g) { g = new THREE.CylinderGeometry(r, r, len, seg || 10); g._shared = true; roundCache.set(k, g); }
    return g;
  }

  // Every mesh this file makes carries userData — which is also what spares it
  // from core/batch.js's static merge. A merged service vehicle would leave a
  // baked ghost of itself on the apron the first time it drove away.
  function bx(parent, w, h, d, x, y, z, m, opts) {
    const mesh = new THREE.Mesh(boxGeom(w, h, d), m);
    mesh.position.set(x, y, z);
    if (opts) {
      if (opts.rx) mesh.rotation.x = opts.rx;
      if (opts.ry) mesh.rotation.y = opts.ry;
      if (opts.rz) mesh.rotation.z = opts.rz;
    }
    mesh.castShadow = !(opts && opts.noCast);
    mesh.receiveShadow = false;
    mesh.userData.airsidePart = true;
    parent.add(mesh);
    return mesh;
  }
  function geoMesh(parent, geo, m, x, y, z, opts) {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    if (opts) {
      if (opts.rx) mesh.rotation.x = opts.rx;
      if (opts.ry) mesh.rotation.y = opts.ry;
      if (opts.rz) mesh.rotation.z = opts.rz;
    }
    mesh.castShadow = !(opts && opts.noCast);
    mesh.receiveShadow = false;
    mesh.userData.airsidePart = true;
    parent.add(mesh);
    return mesh;
  }
  // Road wheels: forward is local +Z for every vehicle in this game (heading ->
  // (sin h, cos h)), so the axle runs along X — cylinder rotated PI/2 about Z,
  // spun about X. playercars.js's own wheel spin uses exactly this pair.
  function wheel(parent, x, z, r, width, out) {
    const w = geoMesh(parent, cylGeom(r, width == null ? 0.3 : width), vmat("tire", 0x14161a), x, r, z, { rz: Math.PI / 2, noCast: true });
    w.userData.playerWheel = true;      // spins when the PLAYER drives it too
    if (out) out.push(w);
    return w;
  }
  // A beacon must own a PRIVATE material: cmat() hands back a pooled instance
  // and pulsing its emissiveIntensity would strobe every other surface that
  // asked for the same colour.
  function beaconLamp(parent, x, y, z, color, w, h) {
    const m = mat(color, { emissive: color, ei: 0.9 });
    const mesh = bx(parent, w || 0.34, h || 0.16, w || 0.34, x, y, z, m, { noCast: true });
    mesh.userData.beaconMat = m;
    return m;
  }

  // ============================================================
  //  1. TUNING — the whole behaviour of the fleet in one block.
  // ============================================================
  const HOLD_R = 22;            // metres of separation owed to a MOVING aircraft
  const HOLD_BAIL = 12;         // s held by a PARKED blocker before routing round it
  const ARRIVE = 3.2;           // waypoint capture radius
  const FAR_D = 620;            // beyond this from the field, tick at 1/3 rate
  const FAR_STRIDE = 3;
  const SCAN_HZ = 0.25;         // aircraft/ped rescan period (s)
  const PED_R = 2.3;            // lateral tolerance of the "somebody in my lane" brake
  // The PARKED-aircraft ground box, as fractions of that airframe's own
  // published length/span. These are not guesses: on the field's airliner the
  // nose gear sits at ~0.27 of half-length and the main bogies at ~0.06, so
  // 0.32 brackets every leg and still passes under the nose cone and the
  // upswept tailcone; the engine nacelles hang at ~0.18 of the span and the
  // wing root is 3 m up, so 0.22 brackets the nacelles and still lets a bowser
  // park outboard under the wing where it belongs. Fractions, so a smaller or
  // larger airframe needs no new number.
  const BOX_LEN_F = 0.32, BOX_SPAN_F = 0.22;

  // ============================================================
  //  2. STATE
  // ============================================================
  let F = null;                 // the derived airfield geometry (null = no airport)
  const V = [];                 // every vehicle this file owns
  const ROUTES = {};            // name -> {name, pts, loop}
  let craft = [];               // aircraft discovered on the field (live positions)
  let nearPeds = [];            // peds worth braking for, refreshed on the slow tick
  let scanT = 0, frame = 0, farAcc = 0;
  let kerbDone = false, kerbFromRoad = false;
  let inspT = 0, inspecting = false;
  let bailouts = 0, holdEvents = 0, nudged = 0;

  // ============================================================
  //  3. BODIES — five machines, all box/cylinder/taper stock in the shared
  //     material pool. Each returns {grp, wheels, ...rig} and NOTHING else:
  //     registration, routing and driving are somebody else's job below.
  //
  //     HEIGHT DISCIPLINE: the head-of-stand road passes under the two jet
  //     bridges (underside 2.3 m) and under the parked tails. Nothing here is
  //     allowed to stand taller than ~2.1 m WHILE MOVING — which is why the
  //     catering box only rises at a stand and the bowser's tank is squat.
  // ============================================================

  function buildTug(tone) {
    // Pushback tug: the lowest, flattest, squattest thing on the field. Its
    // whole silhouette is "no cab where a tailplane wants to be".
    const g = new THREE.Group();
    const wheels = [];
    const paint = vmat("paint", tone);
    const dark = cmat(0x24272b);
    const chrome = vmat("chrome", 0xc8ccd2);
    bx(g, 1.94, 0.40, 3.30, 0, 0.60, 0, paint);                       // ballast deck
    geoMesh(g, taperBox(1.80, 0.34, 1.50, { nz: 0.72, top: 0.9 }), paint, 0, 0.62, 1.30);  // sloped snout
    bx(g, 1.42, 0.64, 1.05, 0, 1.10, -0.62, paint);                   // rear-set cab tub
    bx(g, 1.30, 0.46, 0.92, 0, 1.42, -0.62, vmat("glass", 0x1d3a4a), { noCast: true });
    bx(g, 0.52, 0.50, 0.46, 0, 1.02, -0.30, dark);                    // seat
    bx(g, 0.86, 0.06, 0.10, 0, 1.16, -0.06, dark);                    // wheel/tiller
    for (const s of [-1, 1]) bx(g, 0.08, 0.62, 0.08, s * 0.62, 1.72, -0.62, chrome);   // roll hoop
    bx(g, 1.34, 0.08, 0.42, 0, 2.02, -0.62, paint);                   // hoop canopy
    bx(g, 0.46, 0.14, 0.50, 0, 0.52, 1.86, chrome);                   // fore tow pin
    bx(g, 0.46, 0.14, 0.50, 0, 0.52, -1.82, chrome);                  // aft tow pin
    bx(g, 1.90, 0.10, 0.12, 0, 0.86, 1.72, cmat(0x1a1c20));           // rubber nose bumper
    const bm = beaconLamp(g, 0, 2.14, -0.62, 0xffb648, 0.30, 0.14);
    for (const s of [-1, 1]) for (const z of [1.06, -1.10]) wheel(g, s * 0.84, z, 0.36, 0.32, wheels);
    return { grp: g, wheels: wheels, beacon: bm, dims: { width: 2.0, length: 3.6, height: 2.1, wheelbase: 2.2 } };
  }

  function buildBaggageTractor(tone) {
    const g = new THREE.Group();
    const wheels = [];
    const paint = vmat("paint", tone);
    const dark = cmat(0x24272b);
    bx(g, 1.42, 0.34, 2.50, 0, 0.54, 0, paint);                       // chassis deck
    geoMesh(g, taperBox(1.26, 0.48, 1.10, { nz: 0.76 }), paint, 0, 0.86, 0.86);        // bonnet
    bx(g, 0.54, 0.52, 0.48, 0, 0.98, -0.30, dark);                    // seat pan
    bx(g, 0.54, 0.46, 0.10, 0, 1.24, -0.54, dark);                    // seat back
    for (const s of [-1, 1]) for (const z of [0.30, -0.86]) bx(g, 0.07, 0.86, 0.07, s * 0.62, 1.32, z, cmat(0x9aa0a6));
    bx(g, 1.44, 0.07, 1.36, 0, 1.78, -0.28, cmat(0xe6e9ec));          // canopy roof
    bx(g, 0.30, 0.16, 0.60, 0, 0.60, -1.44, vmat("chrome", 0xc8ccd2));// drawbar
    bx(g, 0.26, 0.10, 0.10, 0, 1.02, 1.34, mat(0xfff2cc, { emissive: 0xffe9b8, ei: 0.7 }), { noCast: true });
    const bm = beaconLamp(g, 0, 1.88, -0.28, 0xffb648, 0.26, 0.13);
    for (const s of [-1, 1]) for (const z of [0.86, -0.94]) wheel(g, s * 0.66, z, 0.32, 0.28, wheels);
    return { grp: g, wheels: wheels, beacon: bm, dims: { width: 1.7, length: 2.9, height: 1.85, wheelbase: 1.8 } };
  }

  function buildCart(seedX, seedZ, idx) {
    // A towed baggage cart: open sides, canvas roof, a deterministic pile of
    // cases. The cases are hash-picked (never Math.random) so a rebuild of the
    // same seed loads the same bags on the same cart.
    const g = new THREE.Group();
    const wheels = [];
    const frame = cmat(0x8f959c);
    const bed = cmat(0x4a5058);
    bx(g, 1.46, 0.16, 2.10, 0, 0.54, 0, bed);                         // flatbed
    for (const s of [-1, 1]) bx(g, 0.06, 0.30, 2.10, s * 0.72, 0.76, 0, frame);        // side rails
    bx(g, 1.46, 0.30, 0.06, 0, 0.76, -1.02, frame);                   // tail rail
    for (const s of [-1, 1]) for (const z of [0.94, -0.94]) bx(g, 0.06, 0.86, 0.06, s * 0.70, 1.05, z, frame);
    bx(g, 1.60, 0.07, 2.24, 0, 1.52, 0, cmat(0xd8dbdf));              // canvas roof
    bx(g, 0.26, 0.14, 0.52, 0, 0.52, 1.32, frame);                    // drawbar
    const TONES = [0x8c3b3b, 0x2f4d78, 0x3f6b4a, 0x2b2e33, 0x7a6a3c, 0x5d3f6b];
    const n = 3 + ((h01(seedX + idx * 7.3, seedZ, 5101) * 3) | 0);
    for (let i = 0; i < n; i++) {
      const hx = h01(seedX + idx * 13.7, seedZ + i * 3.1, 5102);
      const hz = h01(seedX + idx * 5.9, seedZ + i * 7.7, 5103);
      const ht = h01(seedX + idx * 2.3, seedZ + i * 11.3, 5104);
      const w = 0.34 + hx * 0.24, d = 0.24 + hz * 0.22, hgt = 0.20 + ht * 0.16;
      bx(g, w, hgt, d, (hx - 0.5) * 0.9, 0.62 + hgt / 2 + (i > 2 ? 0.24 : 0), (hz - 0.5) * 1.5,
        cmat(TONES[(ht * TONES.length) | 0]));
    }
    for (const s of [-1, 1]) for (const z of [0.74, -0.74]) wheel(g, s * 0.60, z, 0.26, 0.22, wheels);
    return { grp: g, wheels: wheels, dims: { width: 1.7, length: 2.4, height: 1.6, wheelbase: 1.5 } };
  }

  function buildCatering(tone) {
    // Box body on a scissor mast. The mast is REAL geometry driven by one
    // angle: box height = armLen * sin(theta), arms mirrored so they cross.
    const g = new THREE.Group();
    const wheels = [];
    const paint = vmat("paint", tone);
    const steel = cmat(0x9aa0a6);
    const dark = cmat(0x24272b);
    bx(g, 2.06, 0.42, 5.10, 0, 0.46, 0, cmat(0x40454b));              // chassis rails
    bx(g, 1.94, 1.02, 1.66, 0, 1.20, 1.62, paint);                    // cab
    bx(g, 1.80, 0.60, 0.10, 0, 1.42, 2.42, vmat("glass", 0x1d3a4a), { noCast: true });
    for (const s of [-1, 1]) bx(g, 0.10, 0.54, 1.30, s * 0.94, 1.34, 1.58, vmat("glass", 0x1d3a4a), { noCast: true });
    bx(g, 1.90, 0.20, 0.16, 0, 0.70, 2.52, dark);                     // bumper

    // Scissor: two crossed arms a side, pivoting on the chassis behind the cab.
    // ARM and the sweep are chosen so the box floor lands at the airliner's
    // door sill (~3.5 m on this field) at full extension and at 0.72 stowed —
    // which is what keeps the roof under the jet bridges while it is driving.
    const ARM = 3.60, TH0 = 0.16, TH1 = 1.25, arms = [];
    const pivot = { y: 0.70, z: -0.95 };
    for (const s of [-1, 1]) {
      const a = bx(g, 0.14, 0.14, ARM, s * 0.86, pivot.y, pivot.z, steel);
      const b = bx(g, 0.14, 0.14, ARM, s * 0.72, pivot.y, pivot.z, steel);
      arms.push({ mesh: a, sign: 1 }, { mesh: b, sign: -1 });
    }
    // the lift: box body + roller shutter, parented so ONE y drives the lot
    const lift = new THREE.Group();
    lift.position.set(0, 0.72, -0.95);
    lift.userData.airsidePart = true;
    g.add(lift);
    bx(lift, 2.14, 1.30, 2.90, 0, 0.65, 0, paint);                    // box body
    bx(lift, 1.90, 1.00, 0.08, 0, 0.62, -1.48, cmat(0xcfd4d9));       // roller shutter (rear)
    bx(lift, 2.18, 0.14, 2.94, 0, 1.34, 0, cmat(0xe6e9ec), { noCast: true });   // roof cap
    for (let i = 0; i < 4; i++) bx(lift, 0.24, 0.10, 0.10, -0.72 + i * 0.48, 0.06, -1.50, cmat(i % 2 ? 0xd8b53a : 0x24272b), { noCast: true });
    bx(lift, 1.70, 0.06, 0.90, 0, 0.02, -1.90, steel, { noCast: true });        // fold-out platform
    const bm = beaconLamp(g, 0, 1.80, 1.62, 0xffb648, 0.30, 0.14);
    for (const s of [-1, 1]) for (const z of [1.70, -1.30, -2.02]) wheel(g, s * 0.94, z, 0.42, 0.34, wheels);
    return {
      grp: g, wheels: wheels, beacon: bm,
      mast: { lift: lift, arms: arms, armLen: ARM, baseY: 0.72, th0: TH0, th1: TH1, t: 0, target: 0 },
      dims: { width: 2.3, length: 5.4, height: 2.1, wheelbase: 3.2 },
    };
  }

  function buildBowser(tone) {
    const g = new THREE.Group();
    const wheels = [];
    const paint = vmat("paint", tone);
    const steel = vmat("chrome", 0xc8ccd2);
    const dark = cmat(0x24272b);
    bx(g, 2.14, 0.40, 5.90, 0, 0.46, 0, cmat(0x3a3e44));              // chassis
    bx(g, 2.00, 1.10, 1.80, 0, 1.24, 1.90, paint);                    // cab
    bx(g, 1.86, 0.62, 0.10, 0, 1.46, 2.76, vmat("glass", 0x1d3a4a), { noCast: true });
    for (const s of [-1, 1]) bx(g, 0.10, 0.56, 1.40, s * 0.97, 1.38, 1.86, vmat("glass", 0x1d3a4a), { noCast: true });
    // the tank: one squat cylinder lying along the body (top at 2.04 — it has
    // to clear the jet-bridge underside on the head-of-stand road)
    geoMesh(g, cylGeom(0.72, 3.40, 14), paint, 0, 1.32, -0.80, { rx: Math.PI / 2 });
    for (const z of [0.88, -2.48]) geoMesh(g, cylGeom(0.74, 0.10, 14), steel, 0, 1.32, z, { rx: Math.PI / 2, noCast: true });
    bx(g, 1.86, 0.10, 2.90, 0, 2.02, -0.80, cmat(0xe6e9ec), { noCast: true });  // catwalk
    bx(g, 0.30, 0.14, 0.30, 0, 2.11, -0.80, steel, { noCast: true });           // fill hatch (roof stays < 2.2)
    bx(g, 1.10, 0.86, 0.66, 0, 0.94, -2.88, cmat(0x4a5058));                    // pump cabinet
    geoMesh(g, cylGeom(0.34, 0.44, 12), dark, 0.62, 1.10, -2.88, { rz: Math.PI / 2, noCast: true });  // hose reel
    bx(g, 0.70, 0.44, 0.06, 0, 1.60, -2.92, cmat(0xb02b26), { noCast: true });  // FLAMMABLE placard
    bx(g, 2.18, 0.14, 0.14, 0, 0.92, 0.60, cmat(0xd8b53a), { noCast: true });   // hazard band
    const bm = beaconLamp(g, 0, 1.86, 1.90, 0xffb648, 0.30, 0.14);
    for (const s of [-1, 1]) for (const z of [1.98, -1.20, -1.96]) wheel(g, s * 0.98, z, 0.44, 0.36, wheels);
    return { grp: g, wheels: wheels, beacon: bm, dims: { width: 2.4, length: 6.0, height: 2.1, wheelbase: 3.6 } };
  }

  function buildFollowMe() {
    // Checkered, yellow, beacon on the roof, "FOLLOW ME" board. The checker is
    // the repo's own checkerTex so it costs one small canvas, not a texture
    // pipeline; it degrades to flat yellow when that helper is absent.
    const g = new THREE.Group();
    const wheels = [];
    const body = vmat("paint", 0xf2c010);
    const dark = cmat(0x1a1c20);
    let check = cmat(0xf2c010);
    if (CBZ.checkerTex) {
      try {
        const tex = CBZ.checkerTex("#f2c010", "#1a1c20", 6);
        tex.repeat.set(3, 1);
        check = new THREE.MeshLambertMaterial({ map: tex });
        check._shared = true;
      } catch (e) { check = cmat(0xf2c010); }
    }
    geoMesh(g, taperBox(1.82, 0.62, 4.10, { nz: 0.88, tz: 0.92, top: 0.86 }), body, 0, 0.74, 0);
    bx(g, 1.54, 0.56, 1.74, 0, 1.28, -0.18, body);                    // greenhouse
    bx(g, 1.42, 0.42, 0.08, 0, 1.30, 0.70, vmat("glass", 0x1d3a4a), { noCast: true });
    bx(g, 1.42, 0.42, 0.08, 0, 1.30, -1.06, vmat("glass", 0x1d3a4a), { noCast: true });
    for (const s of [-1, 1]) bx(g, 0.08, 0.40, 1.50, s * 0.78, 1.30, -0.18, vmat("glass", 0x1d3a4a), { noCast: true });
    for (const s of [-1, 1]) bx(g, 0.04, 0.30, 3.10, s * 0.93, 0.72, -0.10, check, { noCast: true });   // checker flanks
    bx(g, 1.10, 0.34, 0.08, 0, 1.78, -0.18, check, { noCast: true });  // roof board
    bx(g, 1.18, 0.10, 0.34, 0, 1.60, -0.18, dark, { noCast: true });   // board mount / light bar base
    bx(g, 0.44, 0.16, 0.20, -0.34, 1.62, -0.18, mat(0xffb648, { emissive: 0xffb648, ei: 0.9 }), { noCast: true });
    const bm = beaconLamp(g, 0.34, 1.62, -0.18, 0xffb648, 0.30, 0.16);
    bx(g, 1.60, 0.16, 0.10, 0, 0.62, 2.06, dark, { noCast: true });    // bumper
    for (const s of [-1, 1]) for (const z of [1.28, -1.30]) wheel(g, s * 0.80, z, 0.33, 0.26, wheels);
    return { grp: g, wheels: wheels, beacon: bm, dims: { width: 1.9, length: 4.2, height: 1.9, wheelbase: 2.6 } };
  }

  // ============================================================
  //  4. THE FIELD — derived, never re-hardcoded.
  //
  //  city.airportAudit publishes `bounds` and `runway`. Those two records are
  //  enough to recover the world-layout dial island_airport.js applies to
  //  every one of its own coordinates (CBZ.worldOff("airport")), so from here
  //  the airfield's own literals can be used verbatim and still track the dial:
  //      RWY_X0 = -850 + dx   ->   dx = runway.minX + 850
  //      RWY_Z  =  -90 + dz   ->   dz = runwayCentreZ + 90
  //  Everything else is a documented offset from those, matching the constants
  //  at island_airport.js:880-888. If the airfield is ever rebuilt at a
  //  different size, the assertions below fail closed (F stays null) rather
  //  than paving a service road across a runway.
  // ============================================================
  function deriveField(city) {
    const A = city && city.airportAudit;
    if (!A || !A.bounds || !A.runway) return null;
    const B = A.bounds, R = A.runway;
    if (!(B.maxX > B.minX) || !(R.maxX > R.minX)) return null;
    const rwyZ = (R.minZ + R.maxZ) / 2, rwyHW = (R.maxZ - R.minZ) / 2;
    const dx = R.minX + 850, dz = rwyZ + 90;
    // sanity: the dial recovered from the runway must agree with the one the
    // bounds imply, or this is not the airfield this file was written against.
    if (Math.abs((B.minX + 900) - dx) > 2 || Math.abs((B.minZ + 280) - dz) > 2) return null;

    const apronX = -40 + dx, apronZ = 0 + dz, taxZ = -40 + dz;
    const f = {
      minX: B.minX, maxX: B.maxX, minZ: B.minZ, maxZ: B.maxZ,
      cx: (B.minX + B.maxX) / 2, cz: (B.minZ + B.maxZ) / 2,
      rwyX0: R.minX, rwyX1: R.maxX, rwyZ: rwyZ, rwyHW: rwyHW,
      rwyMinZ: R.minZ, rwyMaxZ: R.maxZ,
      taxZ: taxZ,                         // taxiway centreline (island_airport: RWY_Z + 50)
      apronX: apronX, apronZ: apronZ,     // apron/terminal centreline
      connX: [-160 + dx, 80 + dx],        // the two painted runway connectors
      // terminal footprint (island_airport.js:1016 — tx/tz/tw/td)
      termX0: -115 + dx, termX1: 35 + dx, termZ0: 11 + dz, termZ1: 37 + dz,
      // ---- THE SERVICE NETWORK ----
      // THE HEAD-OF-STAND CORRIDOR — one road behind the stands with two
      // lanes, and the ONLY strip of ground the field actually offers here:
      // the parked tails reach z≈+9 and the terminal wall stands at z=+11, so
      // this corridor necessarily runs UNDER the upswept tailcones (which are
      // ~7 m up). South lane runs east, north lane runs west, drive-on-the-
      // right, and the landside kerb loop's return leg IS the north lane —
      // one road, two users, no second ribbon painted on top of the first.
      hsZ: apronZ + 4.6,                  // eastbound (airside service)
      hsBackZ: apronZ + 8.6,              // westbound (kerb return)
      // apron taxilane: the south edge of the taxiway paint, in front of the
      // parked noses. Never the taxiway centreline — that is for aircraft.
      laneZ: taxZ - 8,
      westX: apronX - 150,                // west link (crosses the taxiway)
      eastX: apronX + 118,                // east link (between gate 4 and the GA apron)
      holdZ: taxZ - 16,                   // the PAINTED hold-short bars
      fmZ: taxZ - 2,                      // the follow-me's taxiway lane
      // landside kerb: the frontage strip is genuinely only ~3 m deep (the
      // terminal's north wall at z=37, the island's north edge at z=40), so
      // the kerb is ONE one-way lane — which is what a real departures kerb is
      // anyway — looping back around the terminal's ends. 39 centres a car in
      // the strip AND keeps the shared wall resolver's body radius off the
      // terminal's north face, which is what would otherwise shunt a stopped
      // taxi towards the water.
      kerbZ: 39 + dz,
      kerbX0: -130 + dx, kerbX1: 50 + dx,
      dx: dx, dz: dz,
    };
    f.kerbBackZ = f.hsBackZ;              // the loop's return leg is the corridor
    // last guard: nothing in the network may sit on the runway.
    const lanes = [f.hsZ, f.hsBackZ, f.laneZ, f.fmZ, f.kerbZ];
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] > R.minZ - 6 && lanes[i] < R.maxZ + 6) return null;
    }
    return f;
  }

  // ============================================================
  //  5. THE PAVING — a service road nobody had ever drawn.
  //
  //  The airfield's baked surface texture paints grass, runway, taxiway and
  //  apron. It does NOT paint a service road, because until now nothing drove
  //  one. Rather than route the fleet over grass and hope it reads, this draws
  //  the road it uses: one merged ribbon per circuit plus its hold-short
  //  hatching. Cheap (3 meshes), static, and it is the visual explanation for
  //  why these vehicles go where they go.
  // ============================================================
  // One quad per polyline segment, extended half a width at each end so the
  // corners of a turn are covered without a corner primitive.
  function ribbonGeom(pts, width, y) {
    const geos = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len < 0.5) continue;
      const g = new THREE.PlaneGeometry(len + width, width);
      g.rotateX(-Math.PI / 2);                    // into the ground plane
      g.rotateY(-Math.atan2(dz, dx));             // long axis down the segment
      g.translate((a.x + b.x) / 2, y, (a.z + b.z) / 2);
      geos.push(g);
    }
    return geos;
  }
  function pave(root, geos, color, offset) {
    if (!geos.length) return null;
    const BGU = THREE.BufferGeometryUtils;
    // polygonOffset for the same reason island_airport's own paint uses it:
    // this ribbon sits 2 cm above a giant coplanar surface plane. `offset`
    // orders our OWN ribbons against each other where two of them touch.
    const m = (CBZ.mat ? CBZ.mat(color) : new THREE.MeshLambertMaterial({ color: color })).clone();
    m.polygonOffset = true;
    m.polygonOffsetFactor = -3 - (offset || 0);
    m.polygonOffsetUnits = -8 - (offset || 0) * 3;
    let mesh;
    if (BGU && BGU.mergeBufferGeometries) {
      mesh = new THREE.Mesh(BGU.mergeBufferGeometries(geos), m);
    } else {
      mesh = new THREE.Group();
      for (const g of geos) mesh.add(new THREE.Mesh(g, m));
    }
    mesh.receiveShadow = true; mesh.castShadow = false;
    mesh.userData.airsidePaint = true;      // spare it from the static batcher
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    root.add(mesh);
    return mesh;
  }

  // ============================================================
  //  6. ROUTES — waypoint loops, confined to apron / taxilane / service road.
  //
  //  Node fields:
  //    x, z      where
  //    dwell     seconds parked there (0 = roll through)
  //    mast      catering: raise the box while dwelling here
  //    hold      MANDATORY hold-short: wait here until nothing on the field
  //              is moving (only the runway-inspection route uses it)
  //    rwy       this node is on the runway (inspection clearance)
  //
  //  Both circuits are ONE-WAY and they never cross each other, so there is no
  //  junction logic in this file at all — the geometry does that work.
  // ============================================================
  function node(x, z, o) {
    const n = { x: x, z: z, dwell: 0, mast: false, hold: false, rwy: false };
    if (o) for (const k in o) n[k] = o[k];
    return n;
  }

  /* IS THIS WAYPOINT REAL GROUND? — ADOPTED from city/roadrules.js's vehicle
     CLASS filter. Nothing in this file bypasses the keep-out list by hand: it
     ASKS with the right class. "service" is the class roadrules added for
     exactly these vehicles — the keep-out that bars a taxi from the apron is
     precisely where a baggage tug belongs — so the query still refuses the one
     thing an authored waypoint can genuinely be wrong about out here, which is
     WATER. The landside kerb lane in particular threads a ~3 m strip between
     the terminal's north wall and the island's north edge; if a future world
     layout puts that strip in the sea, the kerb loop must not be built rather
     than drive four taxis into it. Degrades to "yes" when roadrules is absent. */
  function nodeDrivable(x, z) {
    if (!CBZ.roadPointOpen) return true;
    try { return CBZ.roadPointOpen(x, z, "service") !== false; } catch (e) { return true; }
  }
  function validateRoute(r) {
    if (!r || !r.pts || !r.pts.length) return false;
    for (let i = 0; i < r.pts.length; i++) {
      if (!nodeDrivable(r.pts[i].x, r.pts[i].z)) { r.blocked = i; return false; }
    }
    return true;
  }

  /* AND IS ANYTHING PARKED ON IT? — the second half of the same question, and
     the one the WORLD has to answer rather than the author. The scripted
     pushback jet sits exactly on a taxiway connector, so a hand-typed
     "hold short at the connector" waypoint lands inside a parked airframe and
     the vehicle holds against something that will never move. Rather than
     hard-code an offset that a future gate layout would break, every authored
     node is walked ALONG ITS OWN AXIS (never across it, so a nudge can never
     put a node on the runway) until it is clear of every discovered airframe's
     ground box. Returns how many nodes had to move — reported by the audit,
     because a big number means the route table has drifted from the field. */
  function nudgeNodes(f) {
    let moved = 0;
    function clear(x, z) {
      for (let i = 0; i < craft.length; i++) {
        const c = craft[i];
        if (!c.grp || !c.grp.parent) continue;
        if (inGroundBox(c, x, z)) return false;
      }
      return true;
    }
    for (const k in ROUTES) {
      const pts = ROUTES[k].pts;
      for (let i = 0; i < pts.length; i++) {
        const n = pts[i];
        if (clear(n.x, n.z)) continue;
        for (let step = 12; step <= 96 && !clear(n.x, n.z); step += 12) {
          for (const s of [-1, 1]) {
            const x = n.x + s * step;
            if (x < f.minX + 20 || x > f.maxX - 20) continue;
            if (!clear(x, n.z) || !nodeDrivable(x, n.z)) continue;
            n.x = x; moved++;
            break;
          }
        }
      }
    }
    return moved;
  }
  function routeLen(r) {
    let s = 0;
    for (let i = 0; i < r.pts.length; i++) {
      const a = r.pts[i], b = r.pts[(i + 1) % r.pts.length];
      s += Math.hypot(b.x - a.x, b.z - a.z);
    }
    return s;
  }
  // Point at arclength `s` around a route — used to STAGGER the fleet so five
  // vehicles do not start nose to tail on the same node.
  function routePoint(r, s) {
    const pts = r.pts, n = pts.length;
    let left = s % Math.max(1, routeLen(r));
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const seg = Math.hypot(b.x - a.x, b.z - a.z);
      if (left <= seg || i === n - 1) {
        const t = seg > 0.001 ? Math.max(0, Math.min(1, left / seg)) : 0;
        return {
          x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t,
          heading: Math.atan2(b.x - a.x, b.z - a.z), next: (i + 1) % n,
        };
      }
      left -= seg;
    }
    return { x: pts[0].x, z: pts[0].z, heading: 0, next: 1 % n };
  }

  function buildRoutes(f, stands) {
    // stands: the REAL parked airliners found on the apron, west to east. The
    // service stops are derived from where the aircraft actually are — this
    // file never recomputes island_airport's gate line.
    if (!stands || !stands.length) return;

    // --- the airside circuit, counter-clockwise -------------------------
    // head-of-stand (eastbound) -> east link -> apron taxilane (westbound) ->
    // west link. Both links CROSS THE TAXIWAY, which is exactly where the
    // hold-short rule earns its keep.
    function circuit(extra) {
      const pts = [node(f.westX, f.hsZ)];
      for (const s of extra) pts.push(s);
      pts.push(node(f.eastX, f.hsZ));
      pts.push(node(f.eastX, f.taxZ + 10));      // approach the taxiway crossing
      pts.push(node(f.eastX, f.laneZ));
      pts.push(node(f.westX + 40, f.laneZ));
      pts.push(node(f.westX, f.laneZ));
      pts.push(node(f.westX, f.taxZ + 10));      // and back across it
      return pts;
    }

    // BAGGAGE TRAIN — the one that reads best, so it gets the busiest route:
    // a stop at every stand, right behind the tail where the hold is.
    const bagStops = [];
    for (let i = 0; i < stands.length; i++) {
      bagStops.push(node(stands[i].x + 9, f.hsZ, { dwell: 8 + (h01(stands[i].x, stands[i].z, 5201) * 6) }));
    }
    ROUTES.baggage = { name: "baggage", loop: true, pts: circuit(bagStops) };

    // CATERING LIFT — two stands only, and it RAISES THE BOX while it is
    // parked at one. Nothing else on the field animates while stopped.
    const cateringStops = [];
    for (let i = 0; i < stands.length; i += 2) {
      cateringStops.push(node(stands[i].x - 10, f.hsZ, { dwell: 14 + h01(stands[i].x, stands[i].z, 5202) * 8, mast: true }));
    }
    ROUTES.catering = { name: "catering", loop: true, pts: circuit(cateringStops) };

    // FUEL BOWSER — the only route that leaves the road: it turns off the
    // head-of-stand road and noses UNDER THE WING of one stand, which is where
    // a bowser actually parks, then rejoins.
    const fuelStand = stands[Math.min(1, stands.length - 1)];
    ROUTES.fuel = {
      name: "fuel", loop: true,
      pts: circuit([
        node(fuelStand.x + 19, f.hsZ),
        node(fuelStand.x + 19, fuelStand.z - 3, { dwell: 22 + h01(fuelStand.x, fuelStand.z, 5203) * 10 }),
        node(fuelStand.x + 19, f.hsZ),
      ]),
    };

    // PUSHBACK TUG — works the front of the field: down the apron taxilane to
    // a nose position, wait for its jet, then back round.
    const noseStand = stands[Math.min(2, stands.length - 1)];
    ROUTES.tug = {
      name: "tug", loop: true,
      pts: [
        node(f.westX, f.hsZ),
        node(f.eastX, f.hsZ),
        node(f.eastX, f.taxZ + 10),
        node(f.eastX, f.laneZ),
        node(noseStand.x, f.laneZ, { dwell: 12 + h01(noseStand.x, noseStand.z, 5204) * 8 }),
        node(f.westX + 40, f.laneZ),
        node(f.westX, f.laneZ),
        node(f.westX, f.taxZ + 10),
      ],
    };

    // FOLLOW-ME — the taxiway is its beat. Out and back on ONE lane (there is
    // only ever one of these cars, so it can never meet itself), with the far
    // west end kept well clear of the stands.
    ROUTES.followme = {
      name: "followme", loop: true,
      pts: [
        node(f.rwyX0 + 150, f.fmZ, { dwell: 4 }),
        node(f.connX[0], f.fmZ, { dwell: 3 }),
        node(f.connX[1], f.fmZ, { dwell: 3 }),
        node(f.apronX + 190, f.fmZ, { dwell: 4 }),
        node(f.connX[1], f.fmZ),
        node(f.connX[0], f.fmZ),
      ],
    };

    // RUNWAY INSPECTION — deliberately NOT a loop. It is spliced in rarely,
    // stops AT the painted hold bars, and the node after them carries
    // `hold: true`, so the car may not begin the entry leg until NOTHING on
    // the whole field is moving. It then runs 09/27 and vacates. The `rwy`
    // nodes mark the only sanctioned runway presence in this game.
    ROUTES.inspect = {
      name: "inspect", loop: false,
      pts: [
        node(f.connX[0], f.holdZ, { dwell: 3 }),                 // stop on the bars
        node(f.connX[0], f.rwyZ, { rwy: true, hold: true }),     // enter only when clear
        node(f.connX[1], f.rwyZ, { rwy: true, dwell: 2 }),       // inspect the length
        node(f.connX[1], f.holdZ),                               // vacate
        node(f.connX[1], f.fmZ),                                 // rejoin the taxiway
      ],
    };

    // LANDSIDE KERB — ordinary road traffic, one-way around the terminal's
    // landside end: east along the departures kerb (stopping AT it), south
    // round the terminal's east wall, west along the corridor's north lane,
    // north round the west wall. Cars stop at the kerb and pull out again,
    // which is the whole read of an airport frontage.
    const kerbStops = [];
    for (let i = 0; i < 3; i++) {
      const kx = f.termX0 + 18 + i * ((f.termX1 - f.termX0 - 36) / 2);
      kerbStops.push(node(kx, f.kerbZ, { dwell: 6 + h01(kx, f.kerbZ, 5205) * 9 }));
    }
    ROUTES.kerb = {
      name: "kerb", loop: true,
      pts: [node(f.kerbX0, f.kerbZ)].concat(kerbStops, [
        node(f.kerbX1, f.kerbZ),
        node(f.kerbX1, f.termZ0 + 6),        // ease down the terminal's east side
        node(f.kerbX1, f.kerbBackZ),
        node(f.kerbX0, f.kerbBackZ),
        node(f.kerbX0, f.termZ0 + 6),        // and back up the west side
      ]),
    };
  }

  // ============================================================
  //  7. AIRCRAFT — discovery and right of way.
  //
  //  Discovery is DATA, not names: island_airport stamps every airframe it
  //  builds with userData.aircraftDims (its published length/span/height), so
  //  one children-scan finds the parked fleet AND the scripted pushback jet
  //  AND anything a future file parks out there, with no list to maintain.
  // ============================================================
  function discoverCraft(root, f) {
    const out = [];
    if (!root || !root.children) return out;
    for (let i = 0; i < root.children.length; i++) {
      const o = root.children[i];
      const d = o && o.userData && o.userData.aircraftDims;
      if (!d || !o.position) continue;
      if (o.position.x < f.minX - 40 || o.position.x > f.maxX + 40) continue;
      if (o.position.z < f.minZ - 40 || o.position.z > f.maxZ + 40) continue;
      out.push({
        grp: o, len: +d.length || 30, span: +d.span || 30,
        lastX: o.position.x, lastZ: o.position.z, moving: false,
      });
    }
    return out;
  }

  // The player's own aircraft is never in that list once it is flying, so it
  // is queried separately and always counts as under power.
  function playerCraft() {
    const P = CBZ.player, a = P && P._aircraft;
    const g = a && (a.group || a.grp);
    return g && g.position ? g : null;
  }

  function refreshCraft(dt) {
    for (let i = 0; i < craft.length; i++) {
      const c = craft[i];
      if (!c.grp || !c.grp.parent) { c.moving = false; continue; }
      const p = c.grp.position;
      const moved = Math.hypot(p.x - c.lastX, p.z - c.lastZ);
      // 0.2 m/s is under a walking pace: anything above it is a jet under tow
      // or under power, and it owns the ground.
      c.moving = c.grp.visible !== false && moved > 0.2 * Math.max(0.05, dt);
      c.lastX = p.x; c.lastZ = p.z;
    }
  }
  function anyCraftMoving() {
    for (let i = 0; i < craft.length; i++) if (craft[i].moving) return true;
    return !!playerCraft();
  }

  // Is (wx,wz) inside the part of a PARKED airframe that is actually at
  // vehicle height? Derived from the aircraft's own dims — the fractions
  // bracket the gear/engine belly and deliberately exclude the nose cone and
  // the upswept tail, which a service road is supposed to pass under.
  function inGroundBox(c, wx, wz) {
    const g = c.grp, th = g.rotation.y, cs = Math.cos(th), sn = Math.sin(th);
    const dx = wx - g.position.x, dz = wz - g.position.z;
    const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;   // models point down local +X
    return Math.abs(lx) <= c.len * BOX_LEN_F && Math.abs(lz) <= c.span * BOX_SPAN_F;
  }

  // THE RULE. Returns the blocking aircraft, or null.
  function craftBlocks(u, wx, wz) {
    const px = u.pos.x, pz = u.pos.z;
    for (let i = 0; i < craft.length; i++) {
      const c = craft[i];
      if (!c.grp || !c.grp.parent || c.grp.visible === false) continue;
      const cx = c.grp.position.x, cz = c.grp.position.z;
      if (c.moving) {
        const r = HOLD_R + c.len * 0.5;
        const dw = Math.hypot(cx - wx, cz - wz), dv = Math.hypot(cx - px, cz - pz);
        if (dw < r || dv < r) return c;
      } else if (inGroundBox(c, wx, wz)) {
        return c;
      }
    }
    const pg = playerCraft();
    if (pg) {
      const r = HOLD_R + 18;
      if (Math.hypot(pg.position.x - wx, pg.position.z - wz) < r ||
          Math.hypot(pg.position.x - px, pg.position.z - pz) < r) return { moving: true, grp: pg, len: 36, span: 36 };
    }
    return null;
  }

  // ============================================================
  //  8. REGISTRATION — one call, and the thing is a real vehicle.
  // ============================================================
  function register(rig, opts) {
    const grp = rig.grp;
    grp.userData.dynamic = true;           // never bake a moving group into the batch
    grp.userData.airsideVehicle = true;
    let rec = null;
    if (CBZ.cityRegisterVehicle) {
      try {
        rec = CBZ.cityRegisterVehicle(grp, {
          body: opts.body || "van", style: opts.style || "van",
          persist: true,                    // a world fixture: survives traffic resets
          heading: opts.heading || 0,
          color: opts.color,
          model: { name: opts.name, value: opts.value || 6500, rarity: 0.06, body: opts.body || "van" },
          dims: rig.dims,
        });
      } catch (e) { rec = null; }
    }
    if (!rec) return null;
    const u = {
      rec: rec, grp: grp, pos: rec.pos, kind: opts.kind, name: opts.name,
      wheels: rig.wheels || [], beacon: rig.beacon || null, mast: rig.mast || null,
      carts: [], trail: [],
      route: opts.route, i: opts.startNode || 0,
      v: 0, maxV: opts.maxV || 5.0, acc: opts.acc || 2.6, brake: opts.brake || 5.5,
      // steering time constant, as the per-second retention of the heading
      // error: a long articulated rig turns lazily, a follow-me car does not.
      turnK: opts.turnK || 0.004,
      dwellT: 0, holdT: 0, held: false, cleared: false, released: false,
      beaconT: h01(opts.startX || 0, opts.startZ || 0, 5301) * 2,
    };
    rec.heading = opts.heading || 0;
    grp.rotation.y = rec.heading;
    V.push(u);
    return u;
  }

  // ============================================================
  //  9. THE BUILD — one landmass builder, ordered AFTER the airport (21) so
  //     the audit record and the parked fleet already exist.
  // ============================================================
  function teardown() {
    // A city rebuild re-runs every landmass builder against a fresh root. Our
    // records are persist:true, so clearCars() deliberately KEEPS them — which
    // means we have to reap our own or the next world inherits a fleet of
    // ghosts parked in the old arena.
    if (CBZ.cityCars) {
      for (let i = CBZ.cityCars.length - 1; i >= 0; i--) {
        const c = CBZ.cityCars[i];
        if (c && c.group && c.group.userData && (c.group.userData.airsideVehicle || c.group.userData.airsideKerb)) {
          CBZ.cityCars.splice(i, 1);
        }
      }
    }
    V.length = 0;
    craft = [];
    nearPeds = [];
    for (const k in ROUTES) delete ROUTES[k];
    kerbDone = false; kerbFromRoad = false;
    inspecting = false;
    F = null;
  }

  function buildAirside(city) {
    teardown();
    if (!on()) return;
    const f = deriveField(city);
    if (!f) return;                       // no airport in this world: nothing to do
    F = f;
    const root = city.root;
    if (!root) { F = null; return; }

    // ---- the aircraft already parked out there ------------------------
    craft = discoverCraft(root, f);
    // stands = the airliner-sized ones on the apron, west to east. The parked
    // GA jets are deliberately excluded as SERVICE STOPS (nobody caters a
    // business jet on this field) but they stay in `craft` as obstacles.
    let stands = craft
      .filter(function (c) { return c.len > 30 && c.grp.position.z > f.taxZ - 4 && c.grp.position.z < f.termZ0; })
      .map(function (c) { return { x: c.grp.position.x, z: c.grp.position.z }; })
      .sort(function (a, b) { return a.x - b.x; });
    // A world with no parked airliners still gets a worked apron: the gate line
    // island_airport builds to, as the LAST resort only.
    if (!stands.length) {
      stands = [-80, -25, 30, 85].map(function (o) { return { x: f.apronX + o, z: f.apronZ - 19 }; });
    }

    buildRoutes(f, stands);

    // ---- pave what we drive on ----------------------------------------
    // The airfield's baked surface texture paints grass, runway, taxiway and
    // apron; it has never painted a service road, because nothing drove one.
    const y = 0.10;                       // the airfield surface plane sits at 0.08
    const mid = (f.hsZ + f.hsBackZ) / 2;
    const airsideRibbon = ribbonGeom([
      { x: f.westX, z: mid }, { x: f.eastX, z: mid },       // the two-lane corridor
    ], 8.4, y);
    airsideRibbon.push.apply(airsideRibbon, ribbonGeom([
      { x: f.eastX, z: mid }, { x: f.eastX, z: f.laneZ },   // east link over the taxiway
      { x: f.westX, z: f.laneZ }, { x: f.westX, z: mid },   // taxilane + west link
    ], 7, y));
    // the fuel spur, so the bowser's turn-off is visibly a road
    const fuelStand = stands[Math.min(1, stands.length - 1)];
    airsideRibbon.push.apply(airsideRibbon, ribbonGeom([
      { x: fuelStand.x + 19, z: f.hsZ }, { x: fuelStand.x + 19, z: fuelStand.z - 3 },
    ], 5, y));
    pave(root, airsideRibbon, 0x35383d, 0);

    // The kerb strip is ~3 m of land between the terminal wall and the island
    // edge, so the kerb lane is painted to fit it exactly; the loop's return
    // leg is the corridor above and is deliberately NOT painted twice.
    const kerbRibbon = ribbonGeom([
      { x: f.kerbX0, z: f.kerbZ }, { x: f.kerbX1, z: f.kerbZ },
      { x: f.kerbX1, z: f.termZ0 + 1.4 },
    ], 2.6, y);
    kerbRibbon.push.apply(kerbRibbon, ribbonGeom([
      { x: f.kerbX0, z: f.kerbZ }, { x: f.kerbX0, z: f.termZ0 + 1.4 },
    ], 2.6, y));
    pave(root, kerbRibbon, 0x3b3f45, 1);

    // Hold-short hatching where the service road crosses the LIVE taxiway.
    // These bars are the visible statement of the rule in section 7: this is
    // where a ground vehicle stops for an aircraft.
    const marks = [];
    for (const hx of [f.westX, f.eastX]) {
      for (let k = 0; k < 4; k++) marks.push.apply(marks, ribbonGeom([
        { x: hx - 3.4, z: f.taxZ + 11 + k * 0.9 }, { x: hx + 3.4, z: f.taxZ + 11 + k * 0.9 },
      ], 0.4, y + 0.012));
    }
    pave(root, marks, 0xd8b53a, 2);

    // ---- is every authored waypoint on real ground? ---------------------
    // Asked with the "service" class, so the airport keep-out (which is where
    // these vehicles BELONG) is not the thing being tested — water is. A route
    // that fails is dropped whole; its vehicle is simply never built.
    for (const k in ROUTES) if (!validateRoute(ROUTES[k])) delete ROUTES[k];
    // ...and is anything PARKED on it? (see nudgeNodes — this is what stops a
    // vehicle holding for ever against an airframe that will never move)
    nudged = nudgeNodes(f);

    // ---- the service network is a REAL road record ----------------------
    // ADOPTED: roadrules.js's per-segment access tag. Publishing the corridor
    // and the apron taxilane onto city.roads means roadSegmentAt/roadSpeedLimit
    // can answer for the apron (an honest posted 15, instead of the district
    // guess), and `access: "service"` RESERVES them: roadOpen(r) with the
    // default ambient class returns false, so no placement path can put a
    // saloon on the apron even if the keep-out list is ever edited. Weight 0
    // keeps roadPick's cumulative table byte-identical, so adding these two
    // records cannot shift where ambient traffic spawns for a given seed.
    if (city.roads) {
      const svcMid = (f.westX + f.eastX) / 2, svcLen = f.eastX - f.westX;
      city.roads.push({
        x: svcMid, z: mid, vertical: false, len: svcLen, w: 8.4,
        district: "industrial", lanesPerDir: 1, laneW: 4.2,
        access: "service", speedLimit: 15, trafficWeight: 0,
      });
      city.roads.push({
        x: svcMid, z: f.laneZ, vertical: false, len: svcLen, w: 7,
        district: "industrial", lanesPerDir: 1, laneW: 3.5,
        access: "service", speedLimit: 15, trafficWeight: 0,
      });
    }

    // ---- the fleet ------------------------------------------------------
    // Placement is staggered around each route by arclength so the five
    // machines are spread across the field on the first frame instead of
    // stacked on one node. Every draw is a position hash: no Math.random.
    function place(routeName, frac) {
      const r = ROUTES[routeName];
      if (!r) return null;
      const s = routeLen(r) * frac;
      const p = routePoint(r, s);
      return { route: r, x: p.x, z: p.z, heading: p.heading, node: p.next };
    }

    function spawn(rig, opts) {
      if (!opts || !opts.route) return null;
      rig.grp.position.set(opts.x, 0, opts.z);
      rig.grp.rotation.y = opts.heading;
      root.add(rig.grp);
      return register(rig, opts);
    }
    // TUG
    let p = place("tug", 0.15);
    if (p) spawn(buildTug(0xe8c020), {
      kind: "tug", name: "Pushback Tug", body: "van", style: "van", color: 0xe8c020, value: 11000,
      route: p.route, startNode: p.node, x: p.x, z: p.z, heading: p.heading, startX: p.x, startZ: p.z,
      maxV: 6.0, acc: 3.0, brake: 6.0, turnK: 0.002,
    });

    // BAGGAGE TRAIN — tractor + towed carts. The carts are NOT registered
    // vehicles: they are trailers, and they follow the tractor's own path
    // (section 11). Stealing the tractor takes the whole train with it.
    p = place("baggage", 0.55);
    const tractor = !p ? null : spawn(buildBaggageTractor(0xd8dbdf), {
      kind: "baggage", name: "Baggage Tractor", body: "van", style: "van", color: 0xd8dbdf, value: 7000,
      route: p.route, startNode: p.node, x: p.x, z: p.z, heading: p.heading, startX: p.x, startZ: p.z,
      maxV: 4.2, acc: 2.2, brake: 5.0, turnK: 0.02,
    });
    if (tractor && p) {
      const nCarts = 2 + ((h01(p.x, p.z, 5401) * 2) | 0);     // 2 or 3, deterministic
      for (let i = 0; i < nCarts; i++) {
        const cart = buildCart(p.x, p.z, i);
        cart.grp.userData.dynamic = true;
        cart.grp.userData.airsidePart = true;
        cart.grp.position.set(p.x - Math.sin(p.heading) * (3.6 + i * 3.0), 0, p.z - Math.cos(p.heading) * (3.6 + i * 3.0));
        cart.grp.rotation.y = p.heading;
        root.add(cart.grp);
        tractor.carts.push({ grp: cart.grp, wheels: cart.wheels, back: 3.6 + i * 3.0 });
      }
      // seed the breadcrumb trail straight out behind the tractor, or the
      // carts snap into line on the first frame instead of trailing.
      for (let s = 0; s <= 16; s++) {
        tractor.trail.push({ x: p.x - Math.sin(p.heading) * s * 0.8, z: p.z - Math.cos(p.heading) * s * 0.8 });
      }
    }

    // CATERING LIFT
    p = place("catering", 0.78);
    if (p) spawn(buildCatering(0xe6e9ec), {
      kind: "catering", name: "Catering Lift", body: "van", style: "van", color: 0xe6e9ec, value: 14000,
      route: p.route, startNode: p.node, x: p.x, z: p.z, heading: p.heading, startX: p.x, startZ: p.z,
      maxV: 4.6, acc: 2.0, brake: 5.0, turnK: 0.03,
    });

    // FUEL BOWSER
    p = place("fuel", 0.35);
    if (p) spawn(buildBowser(0x2f4d78), {
      kind: "fuel", name: "Fuel Bowser", body: "van", style: "van", color: 0x2f4d78, value: 18000,
      route: p.route, startNode: p.node, x: p.x, z: p.z, heading: p.heading, startX: p.x, startZ: p.z,
      maxV: 4.4, acc: 1.8, brake: 4.6, turnK: 0.035,
    });

    // FOLLOW-ME
    p = place("followme", 0.42);
    if (p) spawn(buildFollowMe(), {
      kind: "followme", name: "Follow-Me Car", body: "sedan", style: "sedan", color: 0xf2c010, value: 9000,
      route: p.route, startNode: p.node, x: p.x, z: p.z, heading: p.heading, startX: p.x, startZ: p.z,
      maxV: 11.0, acc: 4.5, brake: 8.0, turnK: 0.0016,
    });

    // first inspection is minutes away, deterministically — the audit's
    // onRunway ratchet reads 0 on a freshly built world and stays there.
    inspT = 240 + h01(f.rwyX0, f.rwyZ, 5501) * 180;
  }
  // ORDER 21.5: island_airport.js registers at 21, and landmass builders run in
  // order, so by the time this one is called the audit record exists and the
  // parked fleet is already in the scene graph to be discovered.
  if (CBZ.addLandmass) CBZ.addLandmass(buildAirside, 21.5);

  // ============================================================
  //  10. LANDSIDE KERB — ORDINARY cars, built by the ordinary car builder.
  //
  //  We ask the world first: if a road record actually serves the terminal
  //  frontage, roadPick/roadPlace own the placement and we adopt the block
  //  rather than re-typing a lane draw. It does not today — the only road
  //  record on this island is the causeway deck, which ends 290 m south of the
  //  terminal — so the fallback runs its own short kerb loop, which is exactly
  //  the arrangement roadrules.js's header describes.
  //
  //  Deferred to a one-shot updater (island_airport.js:2167 uses the same
  //  trick) because cityAddParkedCar needs a live CBZ.city.arena, which does
  //  not exist yet while landmass builders are running.
  // ============================================================
  CBZ.onUpdate(55.35, function () {
    if (kerbDone || !on() || !F) return;
    if (CBZ.CONFIG.AIRSIDE_KERB === false) { kerbDone = true; return; }
    if (!CBZ.game || CBZ.game.mode !== "city") return;
    if (!CBZ.city || !CBZ.city.arena || !CBZ.cityAddParkedCar) return;
    kerbDone = true;

    const r = ROUTES.kerb;
    if (!r) return;
    // Does a real road serve the kerb? (roadSegmentAt is roadrules.js's own
    // query — the answer is authoritative and costs one lookup.)
    const seg = CBZ.roadSegmentAt ? CBZ.roadSegmentAt(F.apronX, F.kerbZ, 8) : null;
    kerbFromRoad = !!(seg && CBZ.roadPick && CBZ.roadPlace);

    const NCARS = 4;
    for (let i = 0; i < NCARS; i++) {
      const p = routePoint(r, routeLen(r) * (i / NCARS));
      // half taxis, half ordinary cars — the model is otherwise position-hashed
      // by cityAddParkedCar, so the mix stays deterministic per seed.
      const wantTaxi = h01(p.x, p.z, 5601) < 0.5;
      let rec = null;
      try {
        rec = CBZ.cityAddParkedCar(p.x, p.z, p.heading, wantTaxi ? { modelName: "Taxi" } : {});
      } catch (e) { rec = null; }
      if (!rec || !rec.group) continue;
      rec.group.userData.airsideKerb = true;
      rec.group.userData.dynamic = true;
      if (kerbFromRoad && CBZ.roadPickUsed) CBZ.roadPickUsed("airside:kerb");
      // A parked record hides its driver body (vehicles.js occWanted keys off
      // c.ai, and ours must stay false so the order-37 lane keeper never fights
      // us for the wheel). These cars are DRIVING, so show the driver.
      if (rec._occDriver) rec._occDriver.visible = true;
      const wheels = [];
      rec.group.traverse(function (o) { if (o.userData && o.userData.playerWheel) wheels.push(o); });
      V.push({
        rec: rec, grp: rec.group, pos: rec.pos, kind: "kerb", name: "Kerb Traffic",
        wheels: wheels, beacon: null, mast: null, carts: [], trail: [],
        route: r, i: p.next, v: 0, maxV: 7.5 + h01(p.x, p.z, 5602) * 3,
        acc: 3.4, brake: 7.0,
        dwellT: 0, holdT: 0, held: false, cleared: false, released: false, beaconT: 0,
      });
    }
  });

  // ============================================================
  //  11. THE DRIVE — one waypoint follower for every vehicle in the file.
  // ============================================================
  function releaseCheck(u) {
    // The player took it (or a jacker did). Hand the wheel over for good, the
    // way traffic.js hands over a stolen ambulance — never fight the player
    // for a vehicle they are sitting in.
    if (u.released) return true;
    const r = u.rec;
    if (!r) { u.released = true; return true; }
    if (r.player || r.stolen || r.owned || r.npcDriver) { u.released = true; return true; }
    if (r.dead || r._reap || !u.grp || !u.grp.parent) { u.released = true; return true; }
    return false;
  }

  // Brake for whoever is in the lane ahead — the player first, then any ped
  // the slow scan collected. A tug that drives through the ground crew is
  // exactly the "dumb traffic" the owner was complaining about.
  function laneBrake(u, top) {
    const fx = Math.sin(u.rec.heading), fz = Math.cos(u.rec.heading);
    function test(px, pz, tol) {
      const dx = px - u.pos.x, dz = pz - u.pos.z;
      const ahead = dx * fx + dz * fz;
      if (ahead <= 0.4 || ahead > 12) return;
      if (Math.abs(dx * -fz + dz * fx) > tol) return;
      top = Math.min(top, Math.max(0, (ahead - 2.6) * 1.1));
    }
    const P = CBZ.player;
    if (P && P.pos && !P.dead && !P.driving) test(P.pos.x, P.pos.z, PED_R);
    for (let i = 0; i < nearPeds.length; i++) {
      const p = nearPeds[i];
      if (!p || p.dead || p.inCar || !p.pos) continue;
      test(p.pos.x, p.pos.z, PED_R);
    }
    return top;
  }

  // A body standing where the vehicle is has to be pushed out of it: these are
  // cityCars records, but resolveCars only separates CARS. Without this you
  // can stand inside a bowser.
  function pushPlayerOut(u) {
    const P = CBZ.player;
    if (!P || P.dead || P.driving || !P.pos) return;
    const d = u.rec.dims || { width: 2, length: 4 };
    const hw = d.width * 0.5 + (P.radius || 0.45), hl = d.length * 0.5 + (P.radius || 0.45);
    const s = Math.sin(u.rec.heading), c = Math.cos(u.rec.heading);
    const dx = P.pos.x - u.pos.x, dz = P.pos.z - u.pos.z;
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    if (Math.abs(lx) >= hw || Math.abs(lz) >= hl) return;
    const px = hw - Math.abs(lx), pz = hl - Math.abs(lz);
    if (px < pz) { const k = lx >= 0 ? px : -px; P.pos.x += k * c; P.pos.z += -k * s; }
    else { const k = lz >= 0 ? pz : -pz; P.pos.x += k * s; P.pos.z += k * c; }
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(P.pos);
  }

  function advance(u) {
    const r = u.route;
    u.i++;
    if (u.i >= r.pts.length) {
      if (r.loop) u.i = 0;
      else {
        // the inspection run is over: vacate, drop the clearance, go back to
        // the taxiway beat.
        u.cleared = false;
        inspecting = false;
        u.route = ROUTES.followme || r;
        u.i = 0;
        inspT = 300 + h01(u.pos.x, u.pos.z, 5502) * 240;
      }
    }
  }

  function mastStep(u, dt, wantUp) {
    const m = u.mast;
    if (!m) return;
    m.target = wantUp ? 1 : 0;
    if (Math.abs(m.t - m.target) < 0.002) return;
    m.t += (m.target - m.t) * Math.min(1, dt * 0.9);
    // ONE angle drives the whole mast: the arms scissor about it and the box
    // rides their tips, so the geometry cannot disagree with the animation.
    const th = m.th0 + (m.th1 - m.th0) * m.t;
    for (let i = 0; i < m.arms.length; i++) m.arms[i].mesh.rotation.x = m.arms[i].sign * th;
    m.lift.position.y = m.baseY + m.armLen * (Math.sin(th) - Math.sin(m.th0));
  }

  function trailStep(u, dt) {
    // ARTICULATION: the tractor drops a breadcrumb every 0.8 m; each cart is
    // placed at its own arclength back along that crumb trail and faces down
    // the segment it sits on. That is why the train SNAKES through a turn
    // instead of pivoting as one rigid stick.
    if (!u.carts.length) return;
    const t = u.trail;
    const head = t[0];
    if (!head || Math.hypot(u.pos.x - head.x, u.pos.z - head.z) > 0.8) {
      t.unshift({ x: u.pos.x, z: u.pos.z });
      if (t.length > 90) t.pop();
    }
    for (let ci = 0; ci < u.carts.length; ci++) {
      const cart = u.carts[ci];
      let left = cart.back, i = 0, px = u.pos.x, pz = u.pos.z;
      while (i < t.length) {
        const seg = Math.hypot(t[i].x - px, t[i].z - pz);
        if (seg >= left) {
          const k = seg > 0.001 ? left / seg : 0;
          const x = px + (t[i].x - px) * k, z = pz + (t[i].z - pz) * k;
          cart.grp.position.set(x, 0, z);
          cart.grp.rotation.y = Math.atan2(px - x, pz - z);
          break;
        }
        left -= seg; px = t[i].x; pz = t[i].z; i++;
      }
      if (i >= t.length && t.length) {
        cart.grp.position.set(t[t.length - 1].x, 0, t[t.length - 1].z);
      }
      for (let w = 0; w < cart.wheels.length; w++) cart.wheels[w].rotation.x -= u.v * (dt || 0.016) * 2.0;
    }
  }

  function stepVehicle(u, dt) {
    if (releaseCheck(u)) return;
    const r = u.route, pts = r && r.pts;
    if (!pts || !pts.length) return;
    const wp = pts[u.i % pts.length];

    // ---- RIGHT OF WAY -------------------------------------------------
    // Test the NEXT WAYPOINT, not the current position: a vehicle must stop
    // BEFORE it commits to ground an aircraft owns, which is the whole point
    // of a hold-short line.
    const blocker = craftBlocks(u, wp.x, wp.z);
    // a mandatory hold node additionally waits for the WHOLE field to be still
    const mandatory = wp.hold && anyCraftMoving();
    if (blocker || mandatory) {
      if (!u.held) holdEvents++;
      u.held = true;
      u.holdT += dt;
      u.v += Math.max(-u.brake * dt, -u.v);
      if (u.v < 0.02) u.v = 0;
      u.rec.v = u.v;
      mastStep(u, dt, false);
      // A PARKED blocker will never move, so a hold on one is a deadlock, not
      // a courtesy. Real drivers go round; after HOLD_BAIL we skip the node.
      if (!mandatory && blocker && !blocker.moving && u.holdT > HOLD_BAIL) {
        bailouts++; u.holdT = 0; u.held = false; advance(u);
      }
      trailStep(u, dt);
      return;
    }
    u.held = false; u.holdT = 0;

    // ---- DWELL --------------------------------------------------------
    if (u.dwellT > 0) {
      u.dwellT -= dt;
      u.v += Math.max(-u.brake * dt, -u.v);
      if (u.v < 0.02) u.v = 0;
      u.rec.v = u.v;
      mastStep(u, dt, !!wp.mast);
      trailStep(u, dt);
      pushPlayerOut(u);
      return;
    }
    mastStep(u, dt, false);

    // ---- STEER --------------------------------------------------------
    const dx = wp.x - u.pos.x, dz = wp.z - u.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < ARRIVE) {
      u.dwellT = wp.dwell || 0;
      advance(u);
      trailStep(u, dt);
      return;
    }
    const want = Math.atan2(dx, dz);
    u.rec.heading = lerpAngle(u.rec.heading, want, 1 - Math.pow(u.turnK || 0.004, dt));

    // ---- SPEED --------------------------------------------------------
    let top = u.maxV;
    const nxt = pts[(u.i + 1) % pts.length];
    if (wp.dwell > 0 && d < 10) top = Math.min(top, 0.6 + d * 0.55);      // ease into a stop
    else if (nxt) {
      // slow for the corner: the sharper the turn ahead, the earlier we lift
      const turn = Math.abs(((Math.atan2(nxt.x - wp.x, nxt.z - wp.z) - want + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (turn > 0.7 && d < 14) top = Math.min(top, 2.4 + d * 0.2);
    }
    top = laneBrake(u, top);
    const dv = top - u.v;
    u.v += Math.max(-u.brake * dt, Math.min(u.acc * dt, dv));
    if (u.v < 0) u.v = 0;

    u.pos.x += Math.sin(u.rec.heading) * u.v * dt;
    u.pos.z += Math.cos(u.rec.heading) * u.v * dt;
    u.rec.v = u.v;
    // walls are walls — the SAME oriented resolver every driven car uses
    if (CBZ.cityCollideVehicle) { try { CBZ.cityCollideVehicle(u.rec); } catch (e) {} }
    u.grp.rotation.y = u.rec.heading;
    for (let w = 0; w < u.wheels.length; w++) u.wheels[w].rotation.x -= u.v * dt * 1.6;
    trailStep(u, dt);
    pushPlayerOut(u);
  }

  // ============================================================
  //  12. TICKS
  //
  //  37.32 — the SLOW tick (4 Hz): rescan aircraft motion and collect the
  //          handful of peds worth braking for. Everything expensive lives
  //          here so the per-frame tick stays arithmetic.
  //  37.35 — the DRIVE tick: after the ambient lane keeper (37) and before
  //          resolveCars (37.6), so our vehicles are separated like any other
  //          car in the same frame they moved.
  // ============================================================
  function fieldFar() {
    const cam = CBZ.camera && CBZ.camera.position;
    if (!cam || !F) return false;
    return Math.hypot(cam.x - F.cx, cam.z - F.cz) > FAR_D + (F.maxX - F.minX) * 0.5;
  }

  CBZ.onUpdate(37.32, function (dt) {
    if (!on() || !F || !V.length) return;
    if (!CBZ.game || CBZ.game.mode !== "city") return;
    scanT -= dt;
    if (scanT > 0) return;
    const period = Math.max(SCAN_HZ, SCAN_HZ - scanT);
    scanT = SCAN_HZ;
    refreshCraft(period);
    // peds only matter when somebody can see the near-miss
    nearPeds.length = 0;
    const cam = CBZ.camera && CBZ.camera.position;
    if (!cam || Math.hypot(cam.x - F.cx, cam.z - F.cz) > 260 + (F.maxX - F.minX) * 0.5) return;
    const peds = CBZ.cityPeds;
    if (!peds) return;
    const x0 = F.westX - 20, x1 = F.eastX + 20, z0 = F.laneZ - 20, z1 = F.kerbZ + 20;
    for (let i = 0; i < peds.length && nearPeds.length < 32; i++) {
      const p = peds[i];
      if (!p || p.dead || p.inCar || !p.pos) continue;
      if (p.pos.x < x0 || p.pos.x > x1 || p.pos.z < z0 || p.pos.z > z1) continue;
      nearPeds.push(p);
    }
  });

  CBZ.onUpdate(37.35, function (dt) {
    if (!on() || !F || !V.length) return;
    const g = CBZ.game;
    if (!g || g.mode !== "city" || g.state !== "playing") return;
    frame++;

    // TIME SLICE: nobody is looking at the airfield from the far side of the
    // continent, so bank dt and tick a third as often out there.
    let step = dt;
    if (fieldFar()) {
      if (frame % FAR_STRIDE !== 0) { farAcc += dt; return; }
      step = dt + farAcc; farAcc = 0;
      if (step > 0.6) step = 0.6;             // never teleport on a long stall
    } else if (farAcc) {
      farAcc = 0;                             // walked back into view: drop the bank
    }

    // ---- the rare runway inspection ------------------------------------
    if (CBZ.CONFIG.AIRSIDE_RUNWAY_INSPECT !== false && ROUTES.inspect && !inspecting) {
      inspT -= step;
      if (inspT <= 0) {
        for (let i = 0; i < V.length; i++) {
          const u = V[i];
          if (u.kind !== "followme" || u.released) continue;
          // CLEARANCE is the whole route, not a node: the car is on runway
          // ground from the moment it leaves the hold bars until it is back
          // across them, and the audit must not read a violation in between.
          u.route = ROUTES.inspect; u.i = 0; u.dwellT = 0; u.holdT = 0; u.cleared = true;
          inspecting = true;
          break;
        }
        if (!inspecting) inspT = 120;          // no follow-me alive: try again later
      }
    }

    for (let i = 0; i < V.length; i++) {
      const u = V[i];
      if (u.released) continue;
      stepVehicle(u, step);
      // beacons: runtime-only FX, so a plain elapsed-time strobe is fine.
      if (u.beacon) {
        u.beaconT += step;
        u.beacon.emissiveIntensity = ((u.beaconT % 1.1) < 0.5) ? 1.5 : 0.08;
      }
    }
  });

  // ============================================================
  //  13. THE AUDIT (CLAUDE.md BLOCK LAW #5)
  //
  //  `onRunway` is the ratchet: a service vehicle standing on runway 09/27
  //  WITHOUT the inspection clearance. It is a live measurement of the world,
  //  not a count of call sites, and it must read 0 on a clean world.
  //
  //  `onRunwayRaw` is reported beside it deliberately: it counts EVERY vehicle
  //  physically inside the runway rectangle, cleared or not, so the ratchet
  //  cannot be quietly satisfied by widening the definition of "cleared".
  // ============================================================
  CBZ.airsideAudit = function () {
    let vehicles = 0, onRunway = 0, raw = 0, holding = 0, released = 0, kerb = 0, dwelling = 0;
    for (let i = 0; i < V.length; i++) {
      const u = V[i];
      if (u.released || !u.grp || !u.grp.parent) { released++; continue; }
      vehicles++;
      if (u.kind === "kerb") kerb++;
      if (u.held) holding++;
      if (u.dwellT > 0) dwelling++;
      if (F && u.pos.x >= F.rwyX0 && u.pos.x <= F.rwyX1 && u.pos.z >= F.rwyMinZ && u.pos.z <= F.rwyMaxZ) {
        raw++;
        if (!u.cleared) onRunway++;
      }
    }
    let routes = 0;
    for (const k in ROUTES) routes++;
    return {
      vehicles: vehicles,
      onRunway: onRunway,
      holdingShort: holding,
      routes: routes,
      // evidence, not pins
      onRunwayRaw: raw,
      inspecting: inspecting,
      dwelling: dwelling,
      released: released,
      kerb: kerb,
      kerbFromRoad: kerbFromRoad,
      aircraft: craft.length,
      aircraftMoving: (function () { let n = 0; for (let i = 0; i < craft.length; i++) if (craft[i].moving) n++; return n; })(),
      holdEvents: holdEvents,
      // BAILOUTS: a vehicle that waited HOLD_BAIL seconds on a PARKED airframe
      // and skipped that waypoint. It is the anti-deadlock valve, not damage —
      // nothing is abandoned and no route is lost. A steady climb here means an
      // authored waypoint is sitting inside a parked aircraft and nudgeNodes
      // could not move it clear; a flat number is normal.
      bailouts: bailouts,
      nudgedNodes: nudged,
      field: F ? { hsZ: F.hsZ, laneZ: F.laneZ, taxZ: F.taxZ, rwyZ: F.rwyZ, kerbZ: F.kerbZ } : null,
      enabled: on(),
    };
  };
})();
