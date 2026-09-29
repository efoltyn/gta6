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
     • the ROUTES are derived from each airport's RECORD (systems/airports.js
       + the layout city/airport_kit.js publishes on it): service roads in the
       field's own local metres, projected through its frame. Every field the
       kit builds — Halloran and Cape Harbor today — gets its own fleet
       (pushback tug, baggage train, catering lift, bowser, airstairs truck,
       follow-me), and crash tenders stand in its fire station's bays.
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

   SOMEBODY IS DRIVING (2026-07-27). This file shipped five machines with
   NOBODY IN ANY OF THEM. Every service vehicle now carries a real, killable
   ped in a declared npclife seat (section 8b — the police/gunship helicopter
   crew grammar verbatim) and three more work the ramp itself. Shoot a driver
   and his machine coasts to a stop; steal one and he is thrown out ALIVE.
   The bodies exist only inside 170 m (city/citystaff.js's CBZ.cityStaffPost),
   which is why eight ~16-draw-call rigs cost nothing when you are not there.
   Two cab shells had to GROW to make this honest: the catering and bowser cabs
   were 1.02 m and 1.10 m floor-to-roof — boxes no human could sit in — and the
   follow-me's saloon greenhouse was 0.56 m. All three now clear a seated head
   and all three stay under the 2.3 m jet-bridge underside.

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

  let _dome = null;
  function domeGeom(r) {
    if (_dome && _dome.r === r) return _dome.g;
    const gg = new THREE.SphereGeometry(r, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    gg._shared = true;
    _dome = { r: r, g: gg };
    return gg;
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
  // A wheel is a tyre with a painted steel rim and a hub in it (a bare black
  // puck read as a hockey disc). ONE geometry with vertex colours, so a
  // wheel is still one draw: open tyre tread, sidewall rings, rim discs and
  // hub caps merged per size.
  const wheelCache = new Map();
  let wheelMat = null;
  function wheelGeom(r, wd) {
    const k = r + "|" + wd;
    let g = wheelCache.get(k);
    if (g) return g;
    const parts = [];
    const tint = function (geo, hex) {
      const c = new THREE.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
      geo.setAttribute("color", new THREE.BufferAttribute(a, 3));
      return geo;
    };
    parts.push(tint(new THREE.CylinderGeometry(r, r, wd, 16, 1, true), 0x16181b));
    for (const sg of [-1, 1]) {
      const side = new THREE.RingGeometry(r * 0.6, r, 16, 1);
      const rim = new THREE.CircleGeometry(r * 0.6, 16);
      const hub = new THREE.CircleGeometry(r * 0.2, 10);
      for (const g2 of [side, rim, hub]) g2.rotateX(sg > 0 ? -Math.PI / 2 : Math.PI / 2);
      side.translate(0, sg * wd / 2, 0);
      rim.translate(0, sg * (wd / 2 - 0.03), 0);
      hub.translate(0, sg * (wd / 2 - 0.01), 0);
      parts.push(tint(side, 0x202327), tint(rim, 0xaeb3b8), tint(hub, 0x4a4f55));
    }
    const U = THREE.BufferGeometryUtils;
    const nonIdx = parts.map(function (q) { return q.index ? q.toNonIndexed() : q; });
    g = U && U.mergeBufferGeometries ? U.mergeBufferGeometries(nonIdx) : parts[0];
    g._shared = true;
    wheelCache.set(k, g);
    return g;
  }
  function wheel(parent, x, z, r, width, out) {
    const wd = width == null ? 0.3 : width;
    if (!wheelMat) { wheelMat = new THREE.MeshLambertMaterial({ vertexColors: true }); wheelMat._shared = true; }
    const w = geoMesh(parent, wheelGeom(r, wd), wheelMat, x, r, z, { rz: Math.PI / 2, noCast: true });
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

  /* COMPACT A BODY. Every box above is its own Mesh (a tug was 17 draw calls
     and the fleet with its carts well over a hundred, all moving, so none of
     it can ever be batched). Once a body is assembled, every STATIC part is
     merged into one mesh per material in the vehicle's own frame. Wheels
     (they spin), beacons (they pulse a private material) and anything with
     its own parent (the catering lift and its scissor arms) stay live. */
  function compact(rig, keep) {
    const U = THREE.BufferGeometryUtils;
    if (!U || !U.mergeBufferGeometries) return rig;
    const g = rig.grp, skip = new Set(rig.wheels || []);
    if (keep) for (const k of keep) skip.add(k);
    const byMat = new Map();
    for (const o of g.children.slice()) {
      if (!o.isMesh || skip.has(o) || (o.userData && o.userData.beaconMat) || o.children.length) continue;
      let list = byMat.get(o.material);
      if (!list) { list = []; byMat.set(o.material, list); }
      list.push(o);
    }
    byMat.forEach(function (list, m) {
      if (list.length < 2) return;
      const geos = [];
      let cast = false;
      for (const o of list) {
        o.updateMatrix();
        let gg = o.geometry.clone();
        gg.applyMatrix4(o.matrix);
        if (gg.index) gg = gg.toNonIndexed();
        if (!gg.attributes.uv) return;
        geos.push(gg);
        cast = cast || o.castShadow;
      }
      const merged = U.mergeBufferGeometries(geos);
      if (!merged) return;
      for (const o of list) g.remove(o);
      const mesh = new THREE.Mesh(merged, m);
      mesh.castShadow = cast; mesh.receiveShadow = false;
      mesh.userData.airsidePart = true;
      g.add(mesh);
    });
    return rig;
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
  //  2. STATE — one record per airfield. Every airport in CBZ.airports that
  //     city/airport_kit.js built gets its own fleet, its own routes and its
  //     own aircraft list; V is every vehicle of every field (u.fld says whose).
  // ============================================================
  const FIELDS = [];
  const V = [];
  let nearPeds = [];
  let frame = 0;
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
    // A SEAT A HUMAN FITS IN. The cushion top is 1.11 and the hoop canopy's
    // underside is 1.98, which leaves 0.87 of head room — a seated rig needs
    // ~0.82 above the cushion, so the driver's head sits just under the canvas
    // exactly the way a real tug driver's does. (Was 1.02 / top 1.27, which put
    // his head THROUGH the canopy. See SEATS below for the anchor.)
    bx(g, 0.52, 0.50, 0.46, 0, 0.86, -0.30, dark);                    // seat
    bx(g, 0.86, 0.06, 0.10, 0, 1.16, -0.06, dark);                    // wheel/tiller
    for (const s of [-1, 1]) bx(g, 0.08, 0.62, 0.08, s * 0.62, 1.72, -0.62, chrome);   // roll hoop
    bx(g, 1.34, 0.08, 0.42, 0, 2.02, -0.62, paint);                   // hoop canopy
    bx(g, 0.46, 0.14, 0.50, 0, 0.52, 1.86, chrome);                   // fore tow pin
    bx(g, 0.46, 0.14, 0.50, 0, 0.52, -1.82, chrome);                  // aft tow pin
    bx(g, 1.90, 0.10, 0.12, 0, 0.86, 1.72, cmat(0x1a1c20));           // rubber nose bumper
    const bm = beaconLamp(g, 0, 2.14, -0.62, 0xffb648, 0.30, 0.14);
    for (const s of [-1, 1]) for (const z of [1.06, -1.10]) wheel(g, s * 0.84, z, 0.36, 0.32, wheels);
    return compact({ grp: g, wheels: wheels, beacon: bm, dims: { width: 2.0, length: 3.6, height: 2.1, wheelbase: 2.2 } });
  }

  function buildBaggageTractor(tone) {
    const g = new THREE.Group();
    const wheels = [];
    const paint = vmat("paint", tone);
    const dark = cmat(0x24272b);
    bx(g, 1.42, 0.34, 2.50, 0, 0.54, 0, paint);                       // chassis deck
    geoMesh(g, taperBox(1.26, 0.48, 1.10, { nz: 0.76 }), paint, 0, 0.86, 0.86);        // bonnet
    // Seat pan top 1.18, canopy underside 2.025 — 0.845 of head room for a rig
    // that needs ~0.82. The canopy posts grew 0.30 to make that true, which is
    // also the honest height for a baggage tractor a person actually drives
    // (the old 1.745 canopy would have been a decapitation).
    bx(g, 0.54, 0.52, 0.48, 0, 0.92, -0.30, dark);                    // seat pan
    bx(g, 0.54, 0.46, 0.10, 0, 1.18, -0.54, dark);                    // seat back
    for (const s of [-1, 1]) for (const z of [0.30, -0.86]) bx(g, 0.07, 1.16, 0.07, s * 0.62, 1.47, z, cmat(0x9aa0a6));
    bx(g, 1.44, 0.07, 1.36, 0, 2.06, -0.28, cmat(0xe6e9ec));          // canopy roof
    bx(g, 0.30, 0.16, 0.60, 0, 0.60, -1.44, vmat("chrome", 0xc8ccd2));// drawbar
    bx(g, 0.26, 0.10, 0.10, 0, 1.02, 1.34, mat(0xfff2cc, { emissive: 0xffe9b8, ei: 0.7 }), { noCast: true });
    const bm = beaconLamp(g, 0, 2.16, -0.28, 0xffb648, 0.26, 0.13);
    for (const s of [-1, 1]) for (const z of [0.86, -0.94]) wheel(g, s * 0.66, z, 0.32, 0.28, wheels);
    return compact({ grp: g, wheels: wheels, beacon: bm, dims: { width: 1.7, length: 2.9, height: 2.15, wheelbase: 1.8 } });
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
    return compact({ grp: g, wheels: wheels, dims: { width: 1.7, length: 2.4, height: 1.6, wheelbase: 1.5 } });
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
    // CAB HEIGHT IS A HUMAN MEASUREMENT. The old shell was 1.02 m floor-to-roof
    // — a box nobody could sit in — so the roof is now 2.05, matching the lift
    // box's own 2.06 cap and staying inside this file's ≤2.1 m moving-height
    // discipline (jet-bridge underside 2.3). Floor 0.69, cushion 1.14, head
    // ~1.96: the driver is visible through his own glass.
    bx(g, 1.94, 1.36, 1.66, 0, 1.37, 1.62, paint);                    // cab
    bx(g, 1.80, 0.60, 0.10, 0, 1.62, 2.42, vmat("glass", 0x1d3a4a), { noCast: true });
    for (const s of [-1, 1]) bx(g, 0.10, 0.54, 1.30, s * 0.94, 1.58, 1.58, vmat("glass", 0x1d3a4a), { noCast: true });
    bx(g, 0.52, 0.46, 0.48, -0.42, 0.91, 1.62, dark);                 // driver's seat
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
    return compact({
      grp: g, wheels: wheels, beacon: bm,
      mast: { lift: lift, arms: arms, armLen: ARM, baseY: 0.72, th0: TH0, th1: TH1, t: 0, target: 0 },
      dims: { width: 2.3, length: 5.4, height: 2.1, wheelbase: 3.2 },
    }, arms.map(function (a) { return a.mesh; }));
  }

  function buildBowser(tone) {
    const g = new THREE.Group();
    const wheels = [];
    const paint = vmat("paint", tone);
    const steel = vmat("chrome", 0xc8ccd2);
    const dark = cmat(0x24272b);
    bx(g, 2.14, 0.40, 5.90, 0, 0.46, 0, cmat(0x3a3e44));              // chassis
    // Same fix as the catering cab: floor 0.69, roof 2.10 (the fill hatch is
    // already at 2.11, so the silhouette does not grow), cushion 1.14.
    bx(g, 2.00, 1.42, 1.80, 0, 1.40, 1.90, paint);                    // cab
    bx(g, 1.86, 0.62, 0.10, 0, 1.66, 2.76, vmat("glass", 0x1d3a4a), { noCast: true });
    for (const s of [-1, 1]) bx(g, 0.10, 0.56, 1.40, s * 0.97, 1.62, 1.86, vmat("glass", 0x1d3a4a), { noCast: true });
    bx(g, 0.52, 0.46, 0.48, -0.44, 0.91, 1.90, dark);                 // driver's seat
    // the tank: one squat cylinder lying along the body (top at 2.04 — it has
    // to clear the jet-bridge underside on the head-of-stand road)
    geoMesh(g, cylGeom(0.72, 3.40, 14), paint, 0, 1.32, -0.80, { rx: Math.PI / 2 });
    // dished tank heads (a pressure tank is not closed with flat discs)
    for (const e of [[0.9, Math.PI / 2], [-2.5, -Math.PI / 2]]) {
      const head = geoMesh(g, domeGeom(0.72), paint, 0, 1.32, e[0], { rx: e[1] });
      head.scale.set(1, 0.32, 1);
      geoMesh(g, cylGeom(0.745, 0.06, 14), steel, 0, 1.32, e[0], { rx: Math.PI / 2, noCast: true });   // the seam ring
    }
    bx(g, 1.86, 0.10, 2.90, 0, 2.02, -0.80, cmat(0xe6e9ec), { noCast: true });  // catwalk
    bx(g, 0.30, 0.14, 0.30, 0, 2.11, -0.80, steel, { noCast: true });           // fill hatch (roof stays < 2.2)
    bx(g, 1.10, 0.86, 0.66, 0, 0.94, -2.88, cmat(0x4a5058));                    // pump cabinet
    geoMesh(g, cylGeom(0.34, 0.44, 12), dark, 0.62, 1.10, -2.88, { rz: Math.PI / 2, noCast: true });  // hose reel
    bx(g, 0.70, 0.44, 0.06, 0, 1.60, -2.92, cmat(0xb02b26), { noCast: true });  // FLAMMABLE placard
    bx(g, 2.18, 0.14, 0.14, 0, 0.92, 0.60, cmat(0xd8b53a), { noCast: true });   // hazard band
    const bm = beaconLamp(g, 0, 1.86, 1.90, 0xffb648, 0.30, 0.14);
    for (const s of [-1, 1]) for (const z of [1.98, -1.20, -1.96]) wheel(g, s * 0.98, z, 0.44, 0.36, wheels);
    return compact({ grp: g, wheels: wheels, beacon: bm, dims: { width: 2.4, length: 6.0, height: 2.1, wheelbase: 3.6 } });
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
    // A REAL FOLLOW-ME IS A HIGH-ROOF OPS VAN, not a saloon — and it has to be,
    // because a 0.56 m greenhouse cannot hold a driver. Roof 1.92 over a cabin
    // floor of 0.62 gives 1.30 of head room; the board and beacon ride up with
    // it, which is exactly where a rooftop FOLLOW ME board belongs.
    bx(g, 1.54, 0.92, 1.74, 0, 1.46, -0.18, body);                    // greenhouse
    bx(g, 1.42, 0.42, 0.08, 0, 1.44, 0.70, vmat("glass", 0x1d3a4a), { noCast: true });
    bx(g, 1.42, 0.42, 0.08, 0, 1.44, -1.06, vmat("glass", 0x1d3a4a), { noCast: true });
    for (const s of [-1, 1]) bx(g, 0.08, 0.40, 1.50, s * 0.78, 1.44, -0.18, vmat("glass", 0x1d3a4a), { noCast: true });
    bx(g, 0.50, 0.44, 0.46, -0.34, 0.83, -0.05, dark);                 // driver's seat
    for (const s of [-1, 1]) bx(g, 0.04, 0.30, 3.10, s * 0.93, 0.72, -0.10, check, { noCast: true });   // checker flanks
    bx(g, 1.10, 0.34, 0.08, 0, 2.14, -0.18, check, { noCast: true });  // roof board
    bx(g, 1.18, 0.10, 0.34, 0, 1.96, -0.18, dark, { noCast: true });   // board mount / light bar base
    bx(g, 0.44, 0.16, 0.20, -0.34, 1.98, -0.18, mat(0xffb648, { emissive: 0xffb648, ei: 0.9 }), { noCast: true });
    const bm = beaconLamp(g, 0.34, 1.98, -0.18, 0xffb648, 0.30, 0.16);
    bx(g, 1.60, 0.16, 0.10, 0, 0.62, 2.06, dark, { noCast: true });    // bumper
    for (const s of [-1, 1]) for (const z of [1.28, -1.30]) wheel(g, s * 0.80, z, 0.33, 0.26, wheels);
    return compact({ grp: g, wheels: wheels, beacon: bm, dims: { width: 1.9, length: 4.2, height: 2.2, wheelbase: 2.6 } });
  }

  // THE BODIES ARE PUBLIC: island_airport.js's scripted pushback uses the
  // same tug instead of hand-rolling a second one out of loose boxes.
  function buildStairs(tone) {
    // Passenger airstairs on a light truck: a low cab at the front left, the
    // stair flight climbing from the tail to a railed platform over the cab,
    // canopy over the top landing. The platform floor is at the airliner's
    // door sill (3.6 m on this field's A320-class hull at 1.45).
    const g = new THREE.Group();
    const wheels = [];
    const paint = vmat("paint", tone);
    const white = cmat(0xe9ecee);
    const dark = cmat(0x24272b);
    const steel = cmat(0xaeb4ba);
    bx(g, 2.2, 0.36, 7.0, 0, 0.62, 0, cmat(0x3a3e44));                 // chassis
    bx(g, 1.2, 1.35, 1.9, -0.5, 1.45, 2.3, paint);                     // cab (left, low)
    bx(g, 1.1, 0.55, 0.08, -0.5, 1.8, 3.26, vmat("glass", 0x1d3a4a), { noCast: true });
    bx(g, 0.5, 0.45, 0.46, -0.5, 1.0, 2.2, dark);                      // driver's seat
    // the stair flight: stringers + treads from the tail (0.9 m) to the platform (3.6 m)
    const run = 5.2, rise = 2.7, n = 14, y0 = 0.9, z0 = -3.3;
    const ang = Math.atan2(rise, run), L = Math.hypot(run, rise);
    for (const sx of [-0.62, 0.62]) {
      const st = bx(g, 0.08, 0.28, L, sx, y0 + rise / 2, z0 + run / 2, paint);
      st.rotation.x = -ang;
      const hr = bx(g, 0.05, 0.05, L, sx * 1.05, y0 + rise / 2 + 1.0, z0 + run / 2, steel, { noCast: true });
      hr.rotation.x = -ang;
    }
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      bx(g, 1.16, 0.04, 0.3, 0, y0 + rise * t, z0 + run * t, steel, { noCast: true });
    }
    // the platform, its rails, the canopy, the bumper that meets the fuselage
    bx(g, 1.5, 0.12, 1.3, 0, y0 + rise, z0 + run + 0.6, steel);
    for (const sx of [-0.72, 0.72]) {
      bx(g, 0.05, 1.05, 1.3, sx, y0 + rise + 0.55, z0 + run + 0.6, white, { noCast: true });
      bx(g, 0.07, 2.1, 0.07, sx, y0 + rise + 1.05, z0 + run + 1.2, white);
    }
    bx(g, 1.7, 0.06, 1.5, 0, y0 + rise + 2.1, z0 + run + 0.55, white);          // canopy
    bx(g, 1.5, 0.18, 0.2, 0, y0 + rise + 0.05, z0 + run + 1.3, cmat(0x1a1c20)); // rubber bumper
    // the support frame from the chassis under the platform
    for (const sx of [-0.7, 0.7]) bx(g, 0.12, rise - 0.3, 0.12, sx, y0 + (rise - 0.3) / 2 + 0.3, z0 + run + 0.2, paint);
    const bm = beaconLamp(g, -0.5, 2.2, 2.3, 0xffb648, 0.26, 0.13);
    for (const s of [-1, 1]) for (const z of [2.3, -2.4]) wheel(g, s * 0.98, z, 0.42, 0.32, wheels);
    return compact({ grp: g, wheels: wheels, beacon: bm, dims: { width: 2.3, length: 7.2, height: 4.2, wheelbase: 4.7 } });
  }

  function buildCrashTender() {
    // ARFF crash tender, 6x6: a wide low cab with a raked windscreen and a
    // roof monitor, a water/foam body with roller-shutter lockers down both
    // flanks, a bumper turret, big off-road wheels. 12 m, 3.0 m, 3.6 m.
    const g = new THREE.Group();
    const wheels = [];
    const red = vmat("paint", 0xc0241c);
    const white = cmat(0xeceeef);
    const dark = cmat(0x24272b);
    const steel = vmat("chrome", 0xc8ccd2);
    bx(g, 2.6, 0.5, 11.2, 0, 0.95, -0.2, cmat(0x2a2d31));              // chassis
    geoMesh(g, taperBox(2.95, 1.9, 2.6, { nz: 0.86, top: 0.9 }), red, 0, 2.1, 4.2);   // cab
    bx(g, 2.7, 0.9, 0.1, 0, 2.55, 5.45, vmat("glass", 0x1d3a4a), { noCast: true });   // windscreen
    for (const s of [-1, 1]) bx(g, 0.1, 0.8, 1.6, s * 1.46, 2.5, 4.2, vmat("glass", 0x1d3a4a), { noCast: true });
    bx(g, 0.5, 0.45, 0.46, -0.6, 1.9, 4.0, dark);                      // driver's seat
    // the body: tank + lockers with shutters
    bx(g, 2.95, 2.4, 7.4, 0, 2.3, -1.9, red);
    for (const s of [-1, 1]) for (let k = 0; k < 4; k++) bx(g, 0.05, 1.5, 1.6, s * 1.49, 2.05, 0.9 - k * 1.8, cmat(0xb8bcc0), { noCast: true });
    bx(g, 3.0, 0.22, 11.3, 0, 1.55, -0.2, white, { noCast: true });   // the white band
    bx(g, 2.6, 0.12, 7.0, 0, 3.56, -1.9, steel, { noCast: true });   // roof walkway
    // roof monitor on the cab and the bumper turret
    geoMesh(g, cylGeom(0.28, 0.3, 10), steel, 0, 3.2, 4.0);
    bx(g, 0.18, 0.18, 1.6, 0, 3.42, 4.6, steel);
    bx(g, 0.14, 0.14, 1.0, 0, 1.0, 6.1, steel);
    bx(g, 2.9, 0.3, 0.2, 0, 0.8, 5.55, dark);                          // bumper
    // light bar
    bx(g, 1.8, 0.12, 0.3, 0, 3.08, 5.0, dark, { noCast: true });
    const bm = beaconLamp(g, 0, 3.2, 5.0, 0xff2a1a, 0.5, 0.14);
    for (const s of [-1, 1]) for (const z of [3.9, -1.6, -3.4]) wheel(g, s * 1.2, z, 0.65, 0.5, wheels);
    return compact({ grp: g, wheels: wheels, beacon: bm, dims: { width: 3.0, length: 12.0, height: 3.6, wheelbase: 7.3 } });
  }

  // THE BODIES ARE PUBLIC
  CBZ.airsideBodies = {
    tug: buildTug, tractor: buildBaggageTractor, cart: buildCart,
    catering: buildCatering, bowser: buildBowser, followMe: buildFollowMe,
    stairs: buildStairs, crashTender: buildCrashTender,
  };

  // ============================================================
  //  4. THE FIELD — read off the airport RECORD, never re-hardcoded.
  //
  //  Every field city/airport_kit.js built publishes its resolved layout on
  //  its record (ap.layout: runway, taxiway, stands, the head-of-stand road,
  //  the terminal plan) and its frame (ap.toWorld). The service network is
  //  authored in that field's LOCAL metres and projected through the frame,
  //  so a crooked field (Cape Harbor runs 11/29) gets the same fleet as a
  //  straight one and nothing here knows which field it is working.
  //
  //    head-of-stand road  under the jet bridges, in front of the noses
  //                        (two lanes, eastbound on the aircraft side)
  //    tail lane           behind the parked tails, clear of a taxiing
  //                        aeroplane's wingtip
  //    links               round both ends of the stand row
  //    the taxiway         the follow-me's beat, and the rare runway
  //                        inspection through a holding position
  //    the kerb            landside: a one-way departures lane
  // ============================================================
  function deriveField(ap) {
    const L = ap && ap.layout;
    if (!L || !L.stand || !L.terminal) return null;
    const B = ap.bounds;
    const T = L.terminal, SP = L.stand;
    const xs = L.stands.map(function (s) { return s.lx; });
    const x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    const conns = (L.conns || []).slice().sort(function (a, b) { return a - b; });
    const mid = conns.length > 2 ? conns.slice(1, conns.length - 1) : conns;
    const f = {
      ap: ap, id: ap.id, L: L,
      minX: B.minX, maxX: B.maxX, minZ: B.minZ, maxZ: B.maxZ,
      cx: (B.minX + B.maxX) / 2, cz: (B.minZ + B.maxZ) / 2,
      H: L.H, rwyHW: L.RW / 2,
      taxZ: L.taxiZ,
      hsZ: L.hsRoad.z + 1.6,              // eastbound, the aircraft side
      hsBackZ: L.hsRoad.z - 1.6,          // westbound
      laneZ: SP.tailZ - 4,                // the tail lane
      westX: Math.min(x0 - L.span / 2 - 10, T.x0 - 12),
      eastX: Math.max(x1 + L.span / 2 + 10, T.x1 + 12),
      fmZ: L.taxiZ - 2,
      holdZ: L.holdZ,
      connX: mid.length >= 2 ? [mid[0], mid[mid.length - 1]] : [conns[0], conns[conns.length - 1]],
      kerbZ: ap.kerbZ, kerbX0: T.x0 - 12, kerbX1: T.x1 + 18,
      stands: [], routes: {}, craft: [],
      inspT: 0, inspecting: false, kerbDone: false, fireDone: false, farAcc: 0,
    };
    // last guard: nothing in the network may sit on the runway strip
    const lanes = [f.hsZ, f.hsBackZ, f.laneZ, f.fmZ, f.kerbZ];
    for (let i = 0; i < lanes.length; i++) if (Math.abs(lanes[i]) < f.rwyHW + 6) return null;
    return f;
  }

  // ============================================================
  //  5. ROUTES — waypoint loops in LOCAL metres, stored in world.
  //
  //  Node fields: x, z (world) + lx, lz (local); dwell (s parked there);
  //  mast (catering: raise the box); hold (MANDATORY: wait until nothing on
  //  the field moves); rwy (on the runway, inspection clearance); dock (the
  //  vehicle is meant to touch an aeroplane here: a parked airframe's ground
  //  box does not block it — airstairs and a bowser park under a wing).
  // ============================================================
  function node(f, lx, lz, o) {
    const w = f.ap.toWorld(lx, lz);
    const n = { x: w.x, z: w.z, lx: lx, lz: lz, dwell: 0, mast: false, hold: false, rwy: false, dock: false };
    if (o) for (const k in o) n[k] = o[k];
    return n;
  }
  function nodeDrivable(x, z) {
    if (!CBZ.roadPointOpen) return true;
    try { return CBZ.roadPointOpen(x, z, "service") !== false; } catch (e) { return true; }
  }
  function validateRoute(r) {
    if (!r || !r.pts || !r.pts.length) return false;
    for (let i = 0; i < r.pts.length; i++) if (!nodeDrivable(r.pts[i].x, r.pts[i].z)) { r.blocked = i; return false; }
    return true;
  }
  // a node sitting inside a PARKED airframe's ground box is walked along the
  // lane (local x) until it is clear — dock nodes excepted, they are meant to
  function nudgeNodes(f) {
    let moved = 0;
    function clear(x, z) {
      for (const c of f.craft) { if (c.grp && c.grp.parent && inGroundBox(c, x, z)) return false; }
      return true;
    }
    for (const k in f.routes) {
      const pts = f.routes[k].pts;
      for (const n of pts) {
        if (n.dock || clear(n.x, n.z)) continue;
        for (let step = 6; step <= 60 && !clear(n.x, n.z); step += 6) {
          let done = false;
          for (const s of [-1, 1]) {
            const w = f.ap.toWorld(n.lx + s * step, n.lz);
            if (!clear(w.x, w.z) || !nodeDrivable(w.x, w.z)) continue;
            n.x = w.x; n.z = w.z; n.lx += s * step; moved++; done = true;
            break;
          }
          if (done) break;
        }
      }
    }
    return moved;
  }
  function routeSpan(r) { const n = r.pts.length; return (r.loop === false && n > 1) ? n - 1 : n; }
  function routeLen(r) {
    const n = r.pts.length, span = routeSpan(r);
    let s = 0;
    for (let i = 0; i < span; i++) { const a = r.pts[i], b = r.pts[(i + 1) % n]; s += Math.hypot(b.x - a.x, b.z - a.z); }
    return s;
  }
  function routePoint(r, s) {
    const pts = r.pts, m = pts.length, n = routeSpan(r);
    let left = s % Math.max(1, routeLen(r));
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % m];
      const seg = Math.hypot(b.x - a.x, b.z - a.z);
      if (left <= seg || i === n - 1) {
        const t = seg > 0.001 ? Math.max(0, Math.min(1, left / seg)) : 0;
        return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, heading: Math.atan2(b.x - a.x, b.z - a.z), next: (i + 1) % m };
      }
      left -= seg;
    }
    return { x: pts[0].x, z: pts[0].z, heading: 0, next: 1 % m };
  }

  function buildRoutes(f) {
    const R = f.routes;
    const st = f.stands;
    if (!st.length) return;
    const N = function (lx, lz, o) { return node(f, lx, lz, o); };
    // the airside circuit: eastbound on the head-of-stand road, round the
    // east end, westbound down the tail lane, round the west end
    function circuit(extra) {
      const pts = [N(f.westX, f.hsZ)];
      for (const s of extra) pts.push(s);
      pts.push(N(f.eastX, f.hsZ), N(f.eastX, f.laneZ), N(f.westX + 30, f.laneZ), N(f.westX, f.laneZ));
      return pts;
    }
    // BAGGAGE TRAIN: a stop at every stand, off the starboard side of the nose
    R.baggage = { name: "baggage", loop: true, pts: circuit(st.map(function (s) {
      return N(s.lx - 9, f.hsZ, { dwell: 8 + h01(s.lx, s.lz, 5201) * 6 });
    })) };
    // CATERING: every other stand, box raised while it is there
    const cat = [];
    for (let i = 0; i < st.length; i += 2) cat.push(N(st[i].lx - 14, f.hsZ, { dwell: 14 + h01(st[i].lx, st[i].lz, 5202) * 8, mast: true }));
    R.catering = { name: "catering", loop: true, pts: circuit(cat) };
    // FUEL: off the road and under the starboard wing, outboard of the engine
    const fs = st[Math.min(1, st.length - 1)];
    R.fuel = { name: "fuel", loop: true, pts: circuit([
      N(fs.lx - 19, f.hsZ), N(fs.lx - 19, fs.lz - 2, { dwell: 22 + h01(fs.lx, fs.lz, 5203) * 10, dock: true }), N(fs.lx - 19, f.hsZ, { dock: true }),
    ]) };
    // PUSHBACK TUG: works the noses
    const ns = st[Math.min(2, st.length - 1)];
    R.tug = { name: "tug", loop: true, pts: circuit([N(ns.lx + 4, f.hsZ, { dwell: 12 + h01(ns.lx, ns.lz, 5204) * 8 })]) };
    // AIRSTAIRS: to the L1 door of the first stand no bridge serves, square
    // to the fuselage, and back to the tail lane
    const open = st.filter(function (s) { return !s.bridge; });
    if (open.length) {
      const s = open.find(function (q) { return q.parked; }) || open[0];
      const dz = s.doorLz, dx = s.doorLx;
      R.stairs = { name: "stairs", loop: true, pts: [
        N(dx + 15, f.laneZ), N(dx + 15, dz, { dock: true }),
        N(dx + 3.9, dz, { dwell: 40 + h01(dx, dz, 5205) * 20, dock: true }),
        N(dx + 15, dz + 3, { dock: true }), N(dx + 15, f.laneZ + 2), N(dx + 40, f.laneZ),
      ] };
    }
    // FOLLOW-ME: the taxiway between the middle connectors
    const c0 = f.connX[0], c1 = f.connX[1];
    R.followme = { name: "followme", loop: true, pts: [
      N(c0 - 60, f.fmZ, { dwell: 4 }), N(c0, f.fmZ, { dwell: 3 }), N(c1, f.fmZ, { dwell: 3 }),
      N(c1 + 60, f.fmZ, { dwell: 4 }), N(c1, f.fmZ), N(c0, f.fmZ),
    ] };
    // RUNWAY INSPECTION — stops on the holding position, enters only when
    // nothing on the field moves, runs the runway, vacates.
    R.inspect = { name: "inspect", loop: false, pts: [
      N(c0, f.holdZ + 3, { dwell: 3 }),
      N(c0, 0, { rwy: true, hold: true }),
      N(c1, 0, { rwy: true, dwell: 2 }),
      N(c1, f.holdZ + 3),
      N(c1, f.fmZ),
    ] };
    // THE DEPARTURES KERB — a one-way lane, recycled out of sight (never a
    // lap of the terminal)
    const kerb = [N(f.kerbX0, f.kerbZ)];
    for (let i = 0; i < 3; i++) {
      const kx = f.kerbX0 + 12 + i * ((f.kerbX1 - f.kerbX0 - 24) / 2);
      kerb.push(N(kx, f.kerbZ, { dwell: 6 + h01(kx, f.kerbZ, 5206) * 9 }));
    }
    kerb.push(N(f.kerbX1, f.kerbZ));
    const tail = N(f.kerbX1 + 60, f.kerbZ);
    if (nodeDrivable(tail.x, tail.z)) kerb.push(tail);
    R.kerb = { name: "kerb", loop: false, shuttle: true, pts: kerb };
  }

  // ============================================================
  //  6. AIRCRAFT — discovery and right of way. Discovery is DATA: every
  //  airframe carries userData.aircraftDims, so one scan finds the parked
  //  fleet and anything the airline brings in.
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
      out.push({ grp: o, len: +d.length || 30, span: +d.span || 30, lastX: o.position.x, lastZ: o.position.z, moving: false });
    }
    return out;
  }
  function playerCraft() {
    const P = CBZ.player, a = P && P._aircraft;
    const g = a && (a.group || a.grp);
    return g && g.position ? g : null;
  }
  function refreshCraft(f, dt) {
    for (const c of f.craft) {
      if (!c.grp || !c.grp.parent) { c.moving = false; continue; }
      const p = c.grp.position;
      const moved = Math.hypot(p.x - c.lastX, p.z - c.lastZ);
      c.moving = c.grp.visible !== false && moved > 0.2 * Math.max(0.05, dt);
      c.lastX = p.x; c.lastZ = p.z;
    }
  }
  function anyCraftMoving(f) {
    for (const c of f.craft) if (c.moving) return true;
    return !!playerCraft();
  }
  function inGroundBox(c, wx, wz) {
    const g = c.grp, th = g.rotation.y, cs = Math.cos(th), sn = Math.sin(th);
    const dx = wx - g.position.x, dz = wz - g.position.z;
    const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;   // models point down local +X
    return Math.abs(lx) <= c.len * BOX_LEN_F && Math.abs(lz) <= c.span * BOX_SPAN_F;
  }
  // THE RULE: aircraft outrank ground vehicles. Returns the blocker, or null.
  function craftBlocks(u, wp) {
    const f = u.fld, px = u.pos.x, pz = u.pos.z, wx = wp.x, wz = wp.z;
    for (const c of f.craft) {
      if (!c.grp || !c.grp.parent || c.grp.visible === false) continue;
      const cx = c.grp.position.x, cz = c.grp.position.z;
      if (c.moving) {
        const r = HOLD_R + c.len * 0.5;
        if (Math.hypot(cx - wx, cz - wz) < r || Math.hypot(cx - px, cz - pz) < r) return c;
      } else if (!wp.dock && inGroundBox(c, wx, wz)) {
        return c;
      }
    }
    const pg = playerCraft();
    if (pg) {
      const r = HOLD_R + 18;
      if (Math.hypot(pg.position.x - wx, pg.position.z - wz) < r || Math.hypot(pg.position.x - px, pg.position.z - pz) < r) return { moving: true, grp: pg, len: 36, span: 36 };
    }
    return null;
  }

  // ============================================================
  //  7. REGISTRATION — one call, and the thing is a real vehicle.
  // ============================================================
  function register(f, rig, opts) {
    const grp = rig.grp;
    grp.userData.dynamic = true;
    grp.userData.airsideVehicle = true;
    let rec = null;
    if (CBZ.cityRegisterVehicle) {
      try {
        rec = CBZ.cityRegisterVehicle(grp, {
          body: opts.body || "van", style: opts.style || "van",
          persist: true, heading: opts.heading || 0, color: opts.color,
          model: { name: opts.name, value: opts.value || 6500, rarity: 0.06, body: opts.body || "van" },
          dims: rig.dims,
        });
      } catch (e) { rec = null; }
    }
    if (!rec) return null;
    const u = {
      fld: f, rec: rec, grp: grp, pos: rec.pos, kind: opts.kind, name: opts.name,
      wheels: rig.wheels || [], beacon: rig.beacon || null, mast: rig.mast || null,
      carts: [], trail: [],
      route: opts.route || null, i: opts.startNode || 0,
      v: 0, maxV: opts.maxV || 5.0, acc: opts.acc || 2.6, brake: opts.brake || 5.5,
      turnK: opts.turnK || 0.004,
      dwellT: 0, holdT: 0, held: false, cleared: false, released: false, parked: !!opts.parked,
      beaconT: h01(opts.startX || 0, opts.startZ || 0, 5301) * 2,
    };
    rec.heading = opts.heading || 0;
    grp.rotation.y = rec.heading;
    V.push(u);
    return u;
  }

  // ============================================================
  //  8. THE CREW — somebody is driving (police.js CHOP_SEATS grammar: a crew
  //  node on the vehicle, an npclife anchor per seat, the body minted by
  //  citystaff inside 170 m). Shoot the driver and the machine coasts to a
  //  stop; steal it and he is thrown out alive.
  // ============================================================
  const SEATS = {
    tug:      { job: "pushback driver", x:  0.00, y: 0.80, z: -0.30, cushionH: 0.31 },
    baggage:  { job: "baggage handler", x:  0.00, y: 0.71, z: -0.30, cushionH: 0.47 },
    catering: { job: "catering driver", x: -0.42, y: 0.69, z:  1.62, cushionH: 0.45 },
    fuel:     { job: "refueller",       x: -0.44, y: 0.69, z:  1.90, cushionH: 0.45 },
    followme: { job: "airfield driver", x: -0.34, y: 0.62, z: -0.05, cushionH: 0.43 },
    stairs:   { job: "ramp agent",      x: -0.50, y: 0.78, z:  2.20, cushionH: 0.45 },
  };
  function crewNode(u) {
    const grp = u.grp;
    if (!grp) return null;
    if (grp.userData._crewNode && grp.userData._crewNode.parent === grp) return grp.userData._crewNode;
    const n = new THREE.Group();
    const s = (grp.scale && grp.scale.x) || 1;
    n.scale.setScalar(s > 0.001 ? 1 / s : 1);
    n.name = "crew";
    n.userData.dynamic = true;
    grp.add(n);
    grp.userData._crewNode = n;
    return n;
  }
  function crewUp(u) {
    if (!u) return;
    const s = SEATS[u.kind];
    if (!s || !CBZ.cityStaffPost) return;
    u.post = CBZ.cityStaffPost({
      venue: "airside:" + u.fld.id, id: "airside:" + u.fld.id + ":" + u.kind + ":" + V.length,
      job: s.job, archetype: "laborer",
      x: u.pos.x, z: u.pos.z, face: u.rec ? u.rec.heading : 0,
      at: function () { return u.pos; },
      alive: function () { return !!(u.grp && u.grp.parent) && !u.released; },
      attach: function (ped) {
        if (!CBZ.npcLife || !CBZ.npcLife.attach) return false;
        const nd = crewNode(u);
        if (!nd) return false;
        ped._seatHold = true;
        return !!CBZ.npcLife.attach(ped, nd, { x: s.x, y: s.y, z: s.z, yaw: 0, pose: "sit", state: "sit", cushionH: s.cushionH, floorBelow: 0 });
      },
      release: function (ped, why) {
        u.driver = null;
        if (why !== "gone" && why !== "dead") return false;
        if (CBZ.cityUnseat) { try { CBZ.cityUnseat(ped, { state: ped.dead ? "dead" : "walk" }); } catch (e) {} }
        if (!ped.dead) { ped.staffPost = null; ped.state = "walk"; ped.pause = 0.6; }
        return true;
      },
      after: function (ped) { u.driver = ped; },
    });
  }

  // ============================================================
  //  9. THE BUILD — one landmass builder, after BOTH fields (21, 22).
  // ============================================================
  function teardown() {
    if (CBZ.cityCars) {
      for (let i = CBZ.cityCars.length - 1; i >= 0; i--) {
        const c = CBZ.cityCars[i];
        if (c && c.group && c.group.userData && (c.group.userData.airsideVehicle || c.group.userData.airsideKerb)) CBZ.cityCars.splice(i, 1);
      }
    }
    if (CBZ.cityStaffVenue) for (const f of FIELDS) { try { CBZ.cityStaffVenue("airside:" + f.id, { stations: 0 }); } catch (e) {} }
    for (let i = 0; i < V.length; i++) V[i].driver = null;
    V.length = 0;
    FIELDS.length = 0;
    nearPeds = [];
  }

  function buildField(city, ap) {
    const f = deriveField(ap);
    if (!f) return;
    const root = city.root;
    FIELDS.push(f);
    f.craft = discoverCraft(root, f);
    // the stands, from the record (door positions solved by the kit)
    f.stands = ap.gates.map(function (g) {
      const st = g.stand || {};
      return {
        lx: g.lx, lz: g.lz, id: g.id, bridge: !!st.bridge, parked: !!g.occupant,
        doorLx: g.doorL ? g.doorL.lx : g.lx + 2.9, doorLz: g.doorL ? g.doorL.lz : g.lz + 15,
      };
    }).sort(function (a, b) { return a.lx - b.lx; });
    buildRoutes(f);

    // ---- pave what we drive on: PAINT in the field's own canvas
    if (ap.paint) {
      ap.paint(function (P) {
        const ASPH = 0x3e4145, W = 0xe9ecef;
        // the tail lane and the two links: edge lines + dashed centre on the concrete
        for (const z of [f.laneZ - 3.5, f.laneZ + 3.5]) P.line([[f.westX - 3.5, z], [f.eastX + 3.5, z]], 0.18, W);
        P.line([[f.westX, f.laneZ], [f.eastX, f.laneZ]], 0.12, W, [3, 3]);
        for (const x of [f.westX, f.eastX]) {
          P.rect(x, (f.hsZ + f.laneZ) / 2, 7.4, Math.abs(f.hsZ - f.laneZ) + 7, ASPH, 0.35);
          for (const s of [-1, 1]) P.line([[x + s * 3.5, f.laneZ], [x + s * 3.5, f.hsBackZ - 1.6]], 0.18, W);
        }
        const fr = f.routes.fuel;
        if (fr) { const a = fr.pts[1]; for (const s of [-1, 1]) P.line([[a.lx + s * 2.4, f.hsBackZ - 1.6], [a.lx + s * 2.4, a.lz]], 0.15, W); }
        // the kerb: an edge line along the departures lane
        P.line([[f.kerbX0, f.kerbZ - 2.2], [f.kerbX1, f.kerbZ - 2.2]], 0.15, W);
      });
    }

    for (const k in f.routes) if (!validateRoute(f.routes[k])) delete f.routes[k];
    nudged += nudgeNodes(f);

    // ---- the service network as road records (axis-aligned fields only:
    //      a road record cannot carry a bearing)
    const ax = Math.min(Math.abs(Math.sin(ap.yaw)), Math.abs(Math.cos(ap.yaw))) < 0.03;
    if (city.roads && ax) {
      for (const z of [ap.layout.hsRoad.z, f.laneZ]) {
        const a = ap.toWorld(f.westX, z), b = ap.toWorld(f.eastX, z);
        const horiz = Math.abs(b.x - a.x) >= Math.abs(b.z - a.z);
        city.roads.push({
          x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, vertical: !horiz, len: Math.hypot(b.x - a.x, b.z - a.z), w: 7,
          district: "industrial", lanesPerDir: 1, laneW: 3.5, access: "service", speedLimit: 15, trafficWeight: 0,
        });
      }
    }

    if (CBZ.cityStaffVenue) CBZ.cityStaffVenue("airside:" + f.id, { stations: 9, note: "service vehicles + the ramp" });

    function place(routeName, frac) {
      const r = f.routes[routeName];
      if (!r) return null;
      const p = routePoint(r, routeLen(r) * frac);
      return { route: r, x: p.x, z: p.z, heading: p.heading, node: p.next };
    }
    function spawn(rig, opts) {
      if (!opts || !opts.route) return null;
      rig.grp.position.set(opts.x, 0, opts.z);
      rig.grp.rotation.y = opts.heading;
      root.add(rig.grp);
      const u = register(f, rig, opts);
      crewUp(u);
      return u;
    }
    function base(p, extra) {
      const o = { route: p.route, startNode: p.node, x: p.x, z: p.z, heading: p.heading, startX: p.x, startZ: p.z };
      for (const k in extra) o[k] = extra[k];
      return o;
    }
    let p = place("tug", 0.15);
    if (p) spawn(buildTug(0xe8c020), base(p, { kind: "tug", name: "Pushback Tug", color: 0xe8c020, value: 11000, maxV: 6.0, acc: 3.0, brake: 6.0, turnK: 0.002 }));
    p = place("baggage", 0.55);
    const tractor = !p ? null : spawn(buildBaggageTractor(0xd8dbdf), base(p, { kind: "baggage", name: "Baggage Tractor", color: 0xd8dbdf, value: 7000, maxV: 4.2, acc: 2.2, brake: 5.0, turnK: 0.02 }));
    if (tractor && p) {
      const nCarts = 2 + ((h01(p.x, p.z, 5401) * 2) | 0);
      for (let i = 0; i < nCarts; i++) {
        const cart = buildCart(p.x, p.z, i);
        cart.grp.userData.dynamic = true;
        cart.grp.userData.airsidePart = true;
        cart.grp.position.set(p.x - Math.sin(p.heading) * (3.6 + i * 3.0), 0, p.z - Math.cos(p.heading) * (3.6 + i * 3.0));
        cart.grp.rotation.y = p.heading;
        root.add(cart.grp);
        tractor.carts.push({ grp: cart.grp, wheels: cart.wheels, back: 3.6 + i * 3.0 });
      }
      for (let s = 0; s <= 16; s++) tractor.trail.push({ x: p.x - Math.sin(p.heading) * s * 0.8, z: p.z - Math.cos(p.heading) * s * 0.8 });
    }
    p = place("catering", 0.78);
    if (p) spawn(buildCatering(0xe6e9ec), base(p, { kind: "catering", name: "Catering Lift", color: 0xe6e9ec, value: 14000, maxV: 4.6, acc: 2.0, brake: 5.0, turnK: 0.03 }));
    p = place("fuel", 0.35);
    if (p) spawn(buildBowser(0x2f4d78), base(p, { kind: "fuel", name: "Fuel Bowser", color: 0x2f4d78, value: 18000, maxV: 4.4, acc: 1.8, brake: 4.6, turnK: 0.035 }));
    p = place("stairs", 0.25);
    if (p) spawn(buildStairs(0xdcdfe2), base(p, { kind: "stairs", name: "Airstairs Truck", color: 0xdcdfe2, value: 16000, maxV: 3.6, acc: 1.6, brake: 4.4, turnK: 0.03 }));
    p = place("followme", 0.42);
    if (p) spawn(buildFollowMe(), base(p, { kind: "followme", name: "Follow-Me Car", body: "sedan", style: "sedan", color: 0xf2c010, value: 9000, maxV: 11.0, acc: 4.5, brake: 8.0, turnK: 0.0016 }));

    // ---- the ramp crew: a marshaller off the first stand's starboard wingtip,
    //      two handlers on the equipment line
    if (CBZ.cityStaffPost && f.stands.length) {
      const s0 = f.stands[0];
      const post = function (id, lx, lz, lface, job) {
        const w = ap.toWorld(lx, lz);
        CBZ.cityStaffPost({
          venue: "airside:" + f.id, id: "airside:" + f.id + ":ramp:" + id, job: job, archetype: "laborer",
          x: w.x, z: w.z, face: lface + ap.yaw, pose: "foldarms", opts: { outfit: 0xf0a020, wealth: 0.3 },
        });
      };
      post("marshal", s0.lx - 30, s0.lz + 6, Math.PI / 2, "aircraft marshaller");
      post("load-a", s0.lx - 7, f.hsBackZ - 3.4, 0, "baggage handler");
      post("load-b", s0.lx + 22, f.hsBackZ - 3.4, 0.4, "ramp agent");
    }
    f.inspT = 240 + h01(f.cx, f.cz, 5501) * 180;
  }

  function buildAirside(city) {
    teardown();
    if (!on() || !CBZ.airports) return;
    for (const ap of CBZ.airports) { try { buildField(city, ap); } catch (e) { console.error("[airside]", ap && ap.id, e); } }
  }
  // ORDER 23: both fields exist (Halloran 21, Cape Harbor 22) and their
  // parked fleets are in the scene graph to be discovered.
  if (CBZ.addLandmass) CBZ.addLandmass(buildAirside, 23);

  // ============================================================
  //  10. DEFERRED: the landside kerb cars (ordinary catalogue cars) and the
  //      crash tenders parked in the fire station bays (the station is part
  //      of the streamed dressing, so its bays exist once it is built).
  // ============================================================
  CBZ.onUpdate(55.35, function () {
    if (!on() || !FIELDS.length) return;
    if (!CBZ.game || CBZ.game.mode !== "city") return;
    if (!CBZ.city || !CBZ.city.arena || !CBZ.cityAddParkedCar) return;
    for (const f of FIELDS) {
      if (!f.kerbDone && CBZ.CONFIG.AIRSIDE_KERB !== false) {
        f.kerbDone = true;
        const r = f.routes.kerb;
        if (r) {
          const NCARS = 4;
          for (let i = 0; i < NCARS; i++) {
            const p = routePoint(r, routeLen(r) * (i / NCARS));
            const wantTaxi = h01(p.x, p.z, 5601) < 0.5;
            let rec = null;
            try { rec = CBZ.cityAddParkedCar(p.x, p.z, p.heading, wantTaxi ? { modelName: "Taxi" } : {}); } catch (e) { rec = null; }
            if (!rec || !rec.group) continue;
            rec.group.userData.airsideKerb = true;
            rec.group.userData.dynamic = true;
            if (rec._occDriver) rec._occDriver.visible = true;
            const wheels = [];
            rec.group.traverse(function (o) { if (o.userData && o.userData.playerWheel) wheels.push(o); });
            V.push({
              fld: f, rec: rec, grp: rec.group, pos: rec.pos, kind: "kerb", name: "Kerb Traffic",
              wheels: wheels, beacon: null, mast: null, carts: [], trail: [],
              route: r, i: p.next, v: 0, maxV: 7.5 + h01(p.x, p.z, 5602) * 3,
              acc: 3.4, brake: 7.0, turnK: 0.0016,
              dwellT: 0, holdT: 0, held: false, cleared: false, released: false, beaconT: 0,
            });
          }
        }
      }
      if (!f.fireDone && f.ap.fire && f.ap.fire.bays && CBZ.cityRegisterVehicle) {
        f.fireDone = true;
        const root = CBZ.city.arena.root;
        let n = 0;
        for (const b of f.ap.fire.bays) {
          if (!b.open || n >= 2) continue;
          const rig = buildCrashTender();
          rig.grp.position.set(b.x, 0, b.z);
          rig.grp.rotation.y = b.heading;
          root.add(rig.grp);
          const u = register(f, rig, { kind: "tender", name: "Crash Tender", color: 0xc0241c, value: 42000, heading: b.heading, parked: true, startX: b.x, startZ: b.z });
          if (u) { u.released = false; n++; }
        }
      }
    }
  });

  // ============================================================
  //  11. THE DRIVE — one waypoint follower for every vehicle.
  // ============================================================
  function releaseCheck(u) {
    if (u.released) return true;
    const r = u.rec;
    if (!r) { u.released = true; return true; }
    if (r.player || r.stolen || r.owned || r.npcDriver) { u.released = true; return true; }
    if (r.dead || r._reap || !u.grp || !u.grp.parent) { u.released = true; return true; }
    return false;
  }
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
  function pushPlayerOut(u) {
    const P = CBZ.player;
    if (!P || P.dead || P.driving || !P.pos) return;
    const d = u.rec.dims || { width: 2, length: 4 };
    const hw = d.width * 0.5 + (P.radius || 0.45), hl = d.length * 0.5 + (P.radius || 0.45);
    const s = Math.sin(u.rec.heading), c = Math.cos(u.rec.heading);
    const dx = P.pos.x - u.pos.x, dz = P.pos.z - u.pos.z;
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    if (Math.abs(lx) >= hw || Math.abs(lz) >= hl) return;
    if ((P.pos.y || 0) > (d.height || 2) + 0.3) return;      // standing on the airstairs, not in the truck
    const px = hw - Math.abs(lx), pz = hl - Math.abs(lz);
    if (px < pz) { const k = lx >= 0 ? px : -px; P.pos.x += k * c; P.pos.z += -k * s; }
    else { const k = lz >= 0 ? pz : -pz; P.pos.x += k * s; P.pos.z += k * c; }
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(P.pos);
  }
  function advance(u) {
    const r = u.route, f = u.fld;
    u.i++;
    if (u.i >= r.pts.length) {
      if (r.loop) u.i = 0;
      else if (r.shuttle) {
        // the kerb car that reaches the far end has driven away; it comes back
        // to the head of the lane only where nobody can see either end
        const head = r.pts[0];
        const safe = !CBZ.npcTransitionSafe || (CBZ.npcTransitionSafe(head.x, head.z) && CBZ.npcTransitionSafe(u.pos.x, u.pos.z));
        if (!safe) { u.i = r.pts.length - 1; u.dwellT = 3.5; return; }
        u.i = 1 % r.pts.length;
        const nx = r.pts[u.i];
        u.pos.x = head.x; u.pos.z = head.z;
        u.rec.heading = Math.atan2(nx.x - head.x, nx.z - head.z);
        if (u.grp) u.grp.rotation.y = u.rec.heading;
        u.v = 0; u.rec.v = 0;
        u.trail.length = 0;
      } else {
        // the inspection is over: vacate, drop the clearance, back to the beat
        u.cleared = false;
        f.inspecting = false;
        u.route = f.routes.followme || r;
        u.i = 0;
        f.inspT = 300 + h01(u.pos.x, u.pos.z, 5502) * 240;
      }
    }
  }
  function mastStep(u, dt, wantUp) {
    const m = u.mast;
    if (!m) return;
    m.target = wantUp ? 1 : 0;
    if (Math.abs(m.t - m.target) < 0.002) return;
    m.t += (m.target - m.t) * Math.min(1, dt * 0.9);
    const th = m.th0 + (m.th1 - m.th0) * m.t;
    for (let i = 0; i < m.arms.length; i++) m.arms[i].mesh.rotation.x = m.arms[i].sign * th;
    m.lift.position.y = m.baseY + m.armLen * (Math.sin(th) - Math.sin(m.th0));
  }
  function trailStep(u, dt) {
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
      if (i >= t.length && t.length) cart.grp.position.set(t[t.length - 1].x, 0, t[t.length - 1].z);
      for (let w = 0; w < cart.wheels.length; w++) cart.wheels[w].rotation.x -= u.v * (dt || 0.016) * 2.0;
    }
  }
  function stopHere(u, dt) {
    u.v += Math.max(-u.brake * dt, -u.v);
    if (u.v < 0.02) u.v = 0;
    u.rec.v = u.v;
  }
  function stepVehicle(u, dt) {
    if (releaseCheck(u)) return;
    if (u.parked) { pushPlayerOut(u); return; }             // a tender in its bay
    if (u.post && u.post.lost) {                            // the driver is dead
      stopHere(u, dt); mastStep(u, dt, false); trailStep(u, dt); pushPlayerOut(u);
      return;
    }
    const r = u.route, pts = r && r.pts;
    if (!pts || !pts.length) return;
    const wp = pts[u.i % pts.length];
    const blocker = craftBlocks(u, wp);
    const mandatory = wp.hold && anyCraftMoving(u.fld);
    if (blocker || mandatory) {
      if (!u.held) holdEvents++;
      u.held = true;
      u.holdT += dt;
      stopHere(u, dt);
      mastStep(u, dt, false);
      if (!mandatory && blocker && !blocker.moving && u.holdT > HOLD_BAIL) { bailouts++; u.holdT = 0; u.held = false; advance(u); }
      trailStep(u, dt);
      return;
    }
    u.held = false; u.holdT = 0;
    if (u.dwellT > 0) {
      u.dwellT -= dt;
      stopHere(u, dt);
      mastStep(u, dt, !!wp.mast);
      trailStep(u, dt);
      pushPlayerOut(u);
      return;
    }
    mastStep(u, dt, false);
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
    let top = u.maxV;
    const nxt = pts[(u.i + 1) % pts.length];
    if (wp.dwell > 0 && d < 10) top = Math.min(top, 0.6 + d * 0.55);
    else if (nxt) {
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
    if (CBZ.cityCollideVehicle) { try { CBZ.cityCollideVehicle(u.rec); } catch (e) {} }
    u.grp.rotation.y = u.rec.heading;
    for (let w = 0; w < u.wheels.length; w++) u.wheels[w].rotation.x -= u.v * dt * 1.6;
    trailStep(u, dt);
    pushPlayerOut(u);
  }

  // ============================================================
  //  12. TICKS — 37.32 the slow scan (4 Hz), 37.35 the drive.
  // ============================================================
  let scanT = 0;
  function fieldFar(f) {
    const cam = CBZ.camera && CBZ.camera.position;
    if (!cam) return false;
    return Math.hypot(cam.x - f.cx, cam.z - f.cz) > FAR_D + (f.maxX - f.minX) * 0.5;
  }
  CBZ.onUpdate(37.32, function (dt) {
    if (!on() || !FIELDS.length || !V.length) return;
    if (!CBZ.game || CBZ.game.mode !== "city") return;
    scanT -= dt;
    if (scanT > 0) return;
    const period = Math.max(SCAN_HZ, SCAN_HZ - scanT);
    scanT = SCAN_HZ;
    for (const f of FIELDS) refreshCraft(f, period);
    nearPeds.length = 0;
    const cam = CBZ.camera && CBZ.camera.position;
    const peds = CBZ.cityPeds;
    if (!cam || !peds) return;
    for (const f of FIELDS) {
      if (Math.hypot(cam.x - f.cx, cam.z - f.cz) > 260 + (f.maxX - f.minX) * 0.5) continue;
      for (let i = 0; i < peds.length && nearPeds.length < 32; i++) {
        const p = peds[i];
        if (!p || p.dead || p.inCar || !p.pos) continue;
        if (p.pos.x < f.minX || p.pos.x > f.maxX || p.pos.z < f.minZ || p.pos.z > f.maxZ) continue;
        nearPeds.push(p);
      }
    }
  });
  CBZ.onUpdate(37.35, function (dt) {
    if (!on() || !FIELDS.length || !V.length) return;
    const g = CBZ.game;
    if (!g || g.mode !== "city" || g.state !== "playing") return;
    frame++;
    for (const f of FIELDS) {
      let step = dt;
      if (fieldFar(f)) {
        if (frame % FAR_STRIDE !== 0) { f.farAcc += dt; f.skip = true; continue; }
        step = Math.min(0.6, dt + f.farAcc); f.farAcc = 0;
      } else f.farAcc = 0;
      f.skip = false;
      f.step = step;
      // the rare runway inspection
      if (CBZ.CONFIG.AIRSIDE_RUNWAY_INSPECT !== false && f.routes.inspect && !f.inspecting) {
        f.inspT -= step;
        if (f.inspT <= 0) {
          for (const u of V) {
            if (u.fld !== f || u.kind !== "followme" || u.released) continue;
            u.route = f.routes.inspect; u.i = 0; u.dwellT = 0; u.holdT = 0; u.cleared = true;
            f.inspecting = true;
            break;
          }
          if (!f.inspecting) f.inspT = 120;
        }
      }
    }
    for (let i = 0; i < V.length; i++) {
      const u = V[i];
      if (u.released || u.fld.skip) continue;
      const step = u.fld.step || dt;
      stepVehicle(u, step);
      if (u.beacon) {
        u.beaconT += step;
        u.beacon.emissiveIntensity = ((u.beaconT % 1.1) < 0.5) ? 1.5 : 0.08;
      }
    }
    crewHold();
  });

  /* THE CREW HOLD — one owner for a driver's facing. npclife's syncAttached
     re-asserts the seat every frame, and ~40 ped sweeps write a WORLD bearing
     into group.rotation.y after it; on a body parented to a moving vehicle
     that lands as a side-look. This runs in the drive tick (after peds,
     social, aigoals) and writes the anchor's pose absolutely. */
  function crewHold() {
    for (let i = 0; i < V.length; i++) {
      const u = V[i];
      const a = u && u.driver;
      if (!a || a.dead || !a.group) continue;
      const rec = a._npcAttached;
      const an = rec && rec.anchor;
      if (!an || rec.parent !== a.group.parent) continue;
      if (CBZ.propArcActive && CBZ.propArcActive(a)) continue;
      const g2 = a.group;
      if (g2.position.x !== an.x || g2.position.y !== an.y || g2.position.z !== an.z) g2.position.set(an.x || 0, an.y || 0, an.z || 0);
      const r2 = g2.rotation, yaw = an.yaw || 0;
      if (r2.y !== yaw || r2.x !== 0 || r2.z !== 0) r2.set(0, yaw, 0);
    }
  }

  // ============================================================
  //  13. THE AUDIT. `onRunway` is the ratchet (a service vehicle on a runway
  //  without the inspection clearance, measured in each runway's own frame)
  //  and reads 0; `driverless` (a machine with a seat and no post) reads 0.
  // ============================================================
  // the live network, for the node check and a plan view
  CBZ.airsideRoutes = function () {
    return FIELDS.map(function (f) { return { id: f.id, routes: f.routes }; });
  };
  CBZ.airsideAudit = function () {
    let vehicles = 0, onRunway = 0, raw = 0, holding = 0, released = 0, kerb = 0, dwelling = 0, tenders = 0;
    let seats = 0, driverless = 0, crewed = 0, dormant = 0, driverDown = 0;
    for (const u of V) {
      if (u.released || !u.grp || !u.grp.parent) { released++; continue; }
      vehicles++;
      if (SEATS[u.kind]) {
        seats++;
        if (!u.post) driverless++;
        else if (u.post.lost) driverDown++;
        else if (u.driver && !u.driver.dead) crewed++;
        else dormant++;
      }
      if (u.kind === "kerb") kerb++;
      if (u.kind === "tender") tenders++;
      if (u.held) holding++;
      if (u.dwellT > 0) dwelling++;
      const l = u.fld.ap.toLocal(u.pos.x, u.pos.z);
      if (Math.abs(l.lx) <= u.fld.H && Math.abs(l.lz) <= u.fld.rwyHW) { raw++; if (!u.cleared) onRunway++; }
    }
    const perField = FIELDS.map(function (f) {
      let r = 0; for (const k in f.routes) r++;
      return { id: f.id, routes: r, aircraft: f.craft.length, inspecting: f.inspecting };
    });
    return {
      fields: FIELDS.length, vehicles: vehicles, onRunway: onRunway, holdingShort: holding,
      seats: seats, driverless: driverless, crewed: crewed, crewDormant: dormant, driverDown: driverDown,
      onRunwayRaw: raw, dwelling: dwelling, released: released, kerb: kerb, tenders: tenders,
      holdEvents: holdEvents, bailouts: bailouts, nudgedNodes: nudged,
      perField: perField, enabled: on(),
    };
  };
})();
