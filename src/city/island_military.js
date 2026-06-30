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
     • MOTOR POOL of TANKS + armored trucks — the ground fleet,
       lined up the way real motor pools stage vehicles.
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
  const CEN_X = -620, CEN_Z = -700;          // base centre
  const HX = 240, HZ = 250;                   // half-extents
  const MINX = CEN_X - HX, MAXX = CEN_X + HX; // -860 .. -380
  const MINZ = CEN_Z - HZ, MAXZ = CEN_Z + HZ; // -950 .. -450

  // causeway deck (drivable bridge, widened to the 24m highway) from the
  // mainland west edge to the base gate. z-span = 24m about the centreline.
  const CW_MINX = -380, CW_MAXX = -133;
  const CW_MINZ = -712, CW_MAXZ = -688;
  const CW_CZ = (CW_MINZ + CW_MAXZ) / 2;      // -700, lines up with base centre

  // ---- local seeded RNG (owner rule: deterministic world) ----------------
  let _s = 0x5eed ^ 0x4d494c54;               // "MILT"
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }
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
  function col(wx, wz, w, d, y0, y1, ref) {
    CBZ.colliders.push({ minX: wx - w / 2, maxX: wx + w / 2, minZ: wz - d / 2, maxZ: wz + d / 2, y0: y0 || 0, y1: y1 == null ? 0 : y1, ref: ref || null });
  }
  // cylinder (barrels, rotors, fuel tanks, gun barrels) — fresh geo (few used).
  function cyl(parent, x, y, z, rt, rb, h, hex, seg) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 12), cm(hex));
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m);
    return m;
  }

  // ========================================================================
  //   REUSABLE LOW-POLY MILITARY MODEL FUNCTIONS
  //   Each returns a THREE.Group, built from boxes/cylinders on shared
  //   materials. Caller positions/rotates it and registers the collider.
  //   (Research idiom: low-poly hardware = primitives only, no external mesh.)
  // ========================================================================

  // FIGHTER JET — tapered nose, swept delta wings rooted into the fuselage,
  // twin canted tails + tailplanes, canopy. ~12m long.
  // KEY FIX: wing/tail ROOTS sink ~0.2m into the fuselage so there is no gap;
  // delta wings are a single un-rotated swept slab (no rotation.y seam); nose
  // is a 14-side cone whose fat base overlaps the body.
  // returns {group, footW, footL} for collider sizing.
  function makeJet() {
    const g = new THREE.Group();
    const len = 12, fw = 0.9, body0 = 0.55;                 // body centreline y
    // main fuselage tube (round so wings can sink into a curved flank)
    const fus = cyl(g, 0, body0 + 0.45, 0.2, fw * 0.5, fw * 0.5, len * 0.78, M.jetGrey, 14);
    fus.rotation.x = Math.PI / 2;
    // tapered nose cone — fat base overlaps the fuselage front, fine tip
    const nose = cyl(g, 0, body0 + 0.45, len * 0.5, 0.04, fw * 0.5, 2.6, M.jetGrey, 14);
    nose.rotation.x = Math.PI / 2;
    // tapered tail/afterbody — overlaps the rear of the tube
    const tail = cyl(g, 0, body0 + 0.45, -len * 0.46, 0.5, fw * 0.5, 2.4, M.jetGreyD, 14);
    tail.rotation.x = Math.PI / 2;
    // canopy — sits on the spine, slight forward bubble
    box(g, 0, body0 + 0.92, len * 0.16, 0.52, 0.42, 2.0, M.canopy);
    // spine fairing behind the canopy (blends canopy into the tail)
    box(g, 0, body0 + 0.78, -len * 0.18, 0.34, 0.32, 4.0, M.jetGreyD);
    // DELTA WINGS — one swept slab per side. Built as an angled box whose inner
    // edge sinks 0.25m into the round flank (root overlap → no gap). The sweep
    // is baked by offsetting the box rearward as it goes outboard via rotation
    // about its INNER edge: do it with a tapered box + a small y-rotation that
    // keeps the root buried.
    [-1, 1].forEach(function (s) {
      const wing = box(g, s * 2.4, body0 + 0.35, -0.5, 4.6, 0.14, 3.4, M.jetGreyD);
      wing.rotation.y = s * -0.30;                          // leading-edge sweep
      // root filler block buried in the fuselage so the angled root never gaps
      box(g, s * 0.35, body0 + 0.35, -0.4, 0.9, 0.16, 2.4, M.jetGreyD);
    });
    // TAILPLANES (horizontal) — roots buried in the tail cone flank
    [-1, 1].forEach(function (s) {
      const tp = box(g, s * 1.0, body0 + 0.42, -len * 0.42, 2.0, 0.1, 1.3, M.jetGreyD);
      tp.rotation.y = s * -0.22;
    });
    // TWIN VERTICAL STABILIZERS — canted out, roots sunk into the spine/tail
    [-1, 1].forEach(function (s) {
      const v = box(g, s * 0.42, body0 + 1.25, -len * 0.4, 0.12, 1.7, 1.7, M.jetGrey);
      v.rotation.z = s * 0.18;                              // cant outward
      v.rotation.x = -0.22;                                 // raked back
    });
    // engine nozzle — recessed into the tail cone
    cyl(g, 0, body0 + 0.45, -len * 0.56, 0.36, 0.42, 0.55, M.dark, 12).rotation.x = Math.PI / 2;
    return { group: g, footW: 9.5, footL: len };
  }

  // HEAVY BOMBER — round body, broad swept wings rooted into the fuselage with
  // 2 underslung engine pods PER WING (4 total), tapered nose, tall tail.
  // KEY FIX: wing roots sink into the round fuselage flank (no gap); 4 pods
  // total hang UNDER the wing and overlap its underside; nose tapers from body.
  function makeBomber() {
    const g = new THREE.Group();
    const len = 26, body = 2.4, cy = 2.2;                   // body centreline y
    // round fuselage tube
    const fus = cyl(g, 0, cy, 0, body * 0.5, body * 0.5, len * 0.8, M.jetGrey, 16);
    fus.rotation.x = Math.PI / 2;
    // tapered nose — fat base overlaps the front
    const nose = cyl(g, 0, cy, len * 0.46, 0.12, body * 0.5, 4.2, M.jetGrey, 16);
    nose.rotation.x = Math.PI / 2;
    // tapered tail cone
    const tail = cyl(g, 0, cy, -len * 0.46, 0.18, body * 0.5, 4.0, M.jetGrey, 16);
    tail.rotation.x = Math.PI / 2;
    // cockpit windows on the upper nose
    box(g, 0, cy + 0.7, len * 0.3, 1.1, 0.5, 1.8, M.canopy);
    // BROAD SWEPT WINGS — root buried 0.6m into the round flank
    [-1, 1].forEach(function (s) {
      const wing = box(g, s * 7.2, cy, 0.6, 12.5, 0.42, 5.0, M.jetGreyD);
      wing.rotation.y = s * -0.10;                          // gentle sweep
      // root filler so the swept root edge can't gap against the round body
      box(g, s * 1.2, cy, 0.6, 2.4, 0.46, 4.4, M.jetGreyD);
      // 2 engine pods per wing, hung UNDER the wing, base overlaps wing skin
      [4.0, 8.0].forEach(function (off) {
        const pod = cyl(g, s * off, cy - 0.7, 1.6, 0.62, 0.62, 3.0, M.steelD, 12);
        pod.rotation.x = Math.PI / 2;
        // pylon connecting pod to wing underside (overlap both)
        box(g, s * off, cy - 0.35, 1.0, 0.3, 0.7, 1.2, M.jetGreyD);
        // dark intake face
        cyl(g, s * off, cy - 0.7, 3.1, 0.5, 0.5, 0.3, M.dark, 12).rotation.x = Math.PI / 2;
      });
    });
    // tall vertical tail (root sunk into the tail cone)
    box(g, 0, cy + 2.3, -len * 0.4, 0.42, 4.4, 3.2, M.jetGrey);
    // horizontal stabilizers (roots sunk into the fin/tail)
    [-1, 1].forEach(function (s) {
      const hs = box(g, s * 2.6, cy + 0.4, -len * 0.42, 5.0, 0.32, 2.6, M.jetGreyD);
      hs.rotation.y = s * -0.08;
    });
    return { group: g, footW: 27, footL: len };
  }

  // HELICOPTER — body, glass nose, tail boom + rotor, main rotor, skids.
  function makeHeli() {
    const g = new THREE.Group();
    box(g, 0, 1.5, 0, 1.9, 1.7, 4.0, M.olive);           // cabin
    box(g, 0, 1.45, 2.2, 1.6, 1.4, 1.6, M.canopy);       // glass nose (overlaps cabin)
    box(g, 0, 2.0, -0.4, 1.6, 0.9, 2.6, M.oliveD);       // engine deck hump above cabin rear
    // tail boom — front overlaps the cabin so there's no gap
    box(g, 0, 1.85, -3.2, 0.5, 0.5, 4.8, M.oliveD);
    // tapered tail-boom collar where it meets the cabin
    box(g, 0, 1.7, -1.4, 0.9, 0.8, 1.2, M.oliveD);
    box(g, 0, 2.55, -5.5, 0.12, 1.3, 1.0, M.oliveD);     // tail fin (vertical stab)
    box(g, 0, 1.85, -5.5, 1.4, 0.16, 0.7, M.oliveD);     // tail horizontal stab
    // tail rotor (on the fin)
    const tr = cyl(g, 0.42, 2.4, -5.55, 0.06, 0.06, 1.4, M.dark, 8);
    tr.rotation.z = Math.PI / 2;
    box(g, 0.25, 2.4, -5.55, 0.18, 0.16, 0.16, M.steelD); // tail rotor hub
    // mast (sunk into the engine hump) + main rotor
    cyl(g, 0, 2.7, -0.4, 0.13, 0.13, 0.9, M.steelD, 8);
    const hub = new THREE.Mesh(bg(0.45, 0.2, 0.45), cm(M.steelD)); hub.position.set(0, 3.05, -0.4); g.add(hub);
    [0, Math.PI / 2].forEach(function (a) {
      const blade = new THREE.Mesh(bg(11, 0.06, 0.5), cm(M.dark));
      blade.position.set(0, 3.08, -0.4); blade.rotation.y = a; blade.castShadow = true; g.add(blade);
    });
    // skids — cross-tubes rise INTO the cabin floor (overlap), longitudinal rails
    [-0.8, 0.8].forEach(function (s) {
      box(g, s, 0.35, 0, 0.13, 0.13, 3.6, M.steelD);      // landing rail
    });
    [1.1, -1.1].forEach(function (z) {
      box(g, 0, 0.9, z, 1.6, 0.12, 0.12, M.steelD);       // cross-tube top
      [-0.8, 0.8].forEach(function (s) { box(g, s, 0.62, z, 0.1, 0.65, 0.1, M.steelD); }); // struts
    });
    return { group: g, footW: 2.4, footL: 9.0 };
  }

  // MAIN BATTLE TANK — hull, tracks, turret, long barrel.
  function makeTank() {
    const g = new THREE.Group();
    // hull — slightly raised so the running gear shows beneath
    box(g, 0, 1.0, 0, 3.0, 0.85, 5.4, M.olive);          // hull
    box(g, 0, 0.62, 0, 2.4, 0.4, 5.6, M.oliveD);         // lower hull / sponson
    // glacis (sloped front plate, overlaps the hull front)
    const glacis = box(g, 0, 0.85, 2.7, 2.4, 0.7, 1.0, M.oliveD);
    glacis.rotation.x = 0.5;
    // TRACKS — track skirt boxes each side; ROAD WHEELS roll beneath them
    [-1, 1].forEach(function (s) {
      box(g, s * 1.45, 0.7, 0, 0.65, 0.9, 6.0, M.tire);  // track run
      // 6 road wheels per side (cyl row instead of one flat strip)
      for (let i = 0; i < 6; i++) {
        const wz = -2.4 + i * 0.96;
        const w = cyl(g, s * 1.45, 0.42, wz, 0.42, 0.42, 0.4, M.dark, 10);
        w.rotation.z = Math.PI / 2;                       // wheel face outward
      }
      // drive sprocket (rear) + idler (front), a touch larger
      [-2.9, 2.9].forEach(function (wz) {
        const w = cyl(g, s * 1.45, 0.46, wz, 0.46, 0.46, 0.42, M.steelD, 10);
        w.rotation.z = Math.PI / 2;
      });
    });
    // TURRET — its OWN sub-group so the player tank can SLEW it independently of
    // the hull (militaryvehicles.js eases turret.rotation.y toward the aim, then
    // fires a shell from userData.muzzleLocal via turret.localToWorld). The turret
    // pivots about the ring centre at hull-top; every child keeps the exact local
    // transform it had on the hull, just re-parented to the turret + offset by the
    // pivot so the parked look is byte-identical. WHY a real turret: a tank you
    // can drive but can't aim is half a tank — the felt power is laying the gun.
    const turret = new THREE.Group();
    const TPY = 1.65;                                     // turret ring pivot height
    turret.position.set(0, TPY, 0);
    g.add(turret);
    g.userData.turret = turret;
    // local-space muzzle node (barrel tip, in TURRET space): the gun fires here.
    g.userData.muzzleLocal = new THREE.Vector3(0, 1.62 - TPY, 5.7);
    // turret body + mantlet + barrel + muzzle-brake, re-rooted to the turret
    // (subtract TPY from each child y so world placement is unchanged).
    box(turret, 0, 1.65 - TPY, -0.3, 2.2, 0.75, 2.8, M.oliveD);   // turret body
    box(turret, 0, 1.62 - TPY, 1.0, 1.2, 0.6, 0.7, M.oliveD);     // gun mantlet (front)
    const bar = cyl(turret, 0, 1.62 - TPY, 3.4, 0.14, 0.16, 4.6, M.steelD, 10);
    bar.rotation.x = Math.PI / 2;
    cyl(turret, 0, 1.62 - TPY, 5.5, 0.2, 0.2, 0.5, M.steelD, 10).rotation.x = Math.PI / 2; // muzzle brake
    box(turret, 0.5, 2.1 - TPY, -0.7, 0.55, 0.45, 0.6, M.oliveD); // commander cupola (turns with the turret)
    cyl(turret, -0.6, 2.2 - TPY, -0.2, 0.04, 0.04, 1.4, M.dark, 6); // antenna
    return { group: g, footW: 3.4, footL: 5.6 };
  }

  // ARMORED TRUCK — boxy cab + canvas-back bed, big wheels.
  function makeTruck() {
    const g = new THREE.Group();
    // chassis rail (overlaps under cab + bed)
    box(g, 0, 0.55, 0, 2.1, 0.4, 6.0, M.steelD);         // chassis
    // CAB — body + lower hood, windshield set INTO the cab face (overlap)
    box(g, 0, 1.25, 1.9, 2.2, 1.5, 1.8, M.oliveD);       // cab body
    box(g, 0, 0.85, 2.9, 2.1, 0.8, 0.9, M.oliveD);       // hood (overlaps cab)
    box(g, 0, 1.6, 2.78, 1.9, 0.7, 0.12, M.glassDark, { cast: false }); // windshield
    [-1, 1].forEach(function (s) {                        // side windows
      box(g, s * 1.06, 1.55, 1.9, 0.06, 0.55, 0.9, M.glassDark, { cast: false });
    });
    box(g, 0, 0.55, 3.4, 2.0, 0.35, 0.2, M.steelD);      // front bumper
    // COVERED BED — canvas back, base overlaps the chassis
    box(g, 0, 1.45, -1.6, 2.4, 1.9, 3.8, M.olive);       // bed cover
    box(g, 0, 0.85, -1.6, 2.2, 0.5, 3.8, M.oliveD);      // bed sides (lower)
    // FENDERS over each wheel (overlap the body)
    [-1, 1].forEach(function (s) {
      [-1.7, 1.5].forEach(function (z) { box(g, s * 1.05, 0.95, z, 0.35, 0.45, 1.3, M.oliveD); });
    });
    // WHEELS — 6x6 feel: paired rear, single front, faces outward
    [-1, 1].forEach(function (s) {
      [-2.0, -1.2, 1.5].forEach(function (z) {
        cyl(g, s * 1.05, 0.55, z, 0.55, 0.55, 0.42, M.tire, 12).rotation.z = Math.PI / 2;
        cyl(g, s * 1.05, 0.55, z, 0.2, 0.2, 0.44, M.steelD, 8).rotation.z = Math.PI / 2; // hub
      });
    });
    return { group: g, footW: 2.6, footL: 6.4 };
  }

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
        posts.push({ x: px, z: pz });
      }
      // collider wall: each edge splits around its gap
      if (ei === 1) {
        // east: wall from north corner down to gate, and gate to south corner
        col(MAXX, (MINZ + gateMin) / 2, 0.4, gateMin - MINZ, 0, 2.4);
        col(MAXX, (gateMax + MAXZ) / 2, 0.4, MAXZ - gateMax, 0, 2.4);
      } else if (horiz) {
        // N/S: split around the centre water-access gap (along X)
        const z = a.z;
        col((MINX + (gapCN - PG)) / 2, z, (gapCN - PG) - MINX, 0.4, 0, 2.4);
        col(((gapCN + PG) + MAXX) / 2, z, MAXX - (gapCN + PG), 0.4, 0, 2.4);
      } else {
        // W: split around the centre water-access gap (along Z)
        const x = a.x;
        col(x, (MINZ + (gapCW - PG)) / 2, 0.4, (gapCW - PG) - MINZ, 0, 2.4);
        col(x, ((gapCW + PG) + MAXZ) / 2, 0.4, MAXZ - (gapCW + PG), 0, 2.4);
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
    edges.forEach(function (e, ei) {
      const a = e[0], b = e[1];
      const dx = b.x - a.x, dz = b.z - a.z;
      const horiz = Math.abs(dx) > Math.abs(dz);
      if (ei === 1) {                                     // east split for the gate
        mkLink(root, MAXX, (MINZ + gateMin) / 2, 0.06, gateMin - MINZ);
        mkLink(root, MAXX, (gateMax + MAXZ) / 2, 0.06, MAXZ - gateMax);
      } else if (horiz) {                                 // N/S split for the water gap
        const z = a.z;
        mkLink(root, (MINX + (gapCN - PG)) / 2, z, (gapCN - PG) - MINX, 0.06);
        mkLink(root, ((gapCN + PG) + MAXX) / 2, z, MAXX - (gapCN + PG), 0.06);
      } else {                                            // W split for the water gap
        const x = a.x;
        mkLink(root, x, (MINZ + (gapCW - PG)) / 2, 0.06, (gapCW - PG) - MINZ);
        mkLink(root, x, ((gapCW + PG) + MAXZ) / 2, 0.06, MAXZ - (gapCW + PG));
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
    // base dirt/tarmac apron (flat at y≈0; engine world is flat, this is visual)
    const apron = new THREE.Mesh(bg(MAXX - MINX, 0.1, MAXZ - MINZ), cm(M.dirt));
    apron.position.set(CEN_X, -0.02, CEN_Z); apron.receiveShadow = true; apron.castShadow = false;
    root.add(apron);
    // RUNWAY: long tarmac strip down the south part of the island, with
    // centreline dashes (merged into one dash material).
    const RW_X = CEN_X, RW_Z = MAXZ - 70, RW_L = 360, RW_W = 26;
    const rw = new THREE.Mesh(bg(RW_L, 0.06, RW_W), cm(M.runway));
    rw.position.set(RW_X, 0.0, RW_Z); rw.receiveShadow = true; rw.castShadow = false; root.add(rw);
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
        width: 24, lanesPerDir: 2, laneW: 3.6, theme: "asphalt",
        guardrail: true, lights: true, elevated: false, rng: rng,
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
    box(root, gx, 1.7, CW_MAXZ + 2.5, 2.6, 1.0, 0.1, M.glassDark, { cast: false }); // window
    col(gx, CW_MAXZ + 4, 3, 3, 0, 2.8);
    // boom barrier (a striped bar across the lane), raised slightly so it reads
    const boom = box(root, cx, 1.1, CW_CZ, w * 0.9, 0.18, 0.18, M.warn);
    boom.rotation.z = 0.04;
    col(cx, CW_CZ, w * 0.9, 0.4, 0.9, 1.3);              // low collider (chest height)
    // red/white pylon posts flanking the lane
    [CW_MINZ + 1, CW_MAXZ - 1].forEach(function (z) { cyl(root, cx + 4, 0.7, z, 0.16, 0.2, 1.4, M.red, 8); });
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
  //   WATCHTOWER — legs, cabin, ladder hint. Solid collider footprint.
  // ========================================================================
  function watchtower(root, cx, cz) {
    const g = new THREE.Group(); g.position.set(cx, 0, cz); root.add(g);
    [-1, 1].forEach(function (sx) {
      [-1, 1].forEach(function (sz) { box(g, sx * 1.4, 3.0, sz * 1.4, 0.25, 6.0, 0.25, M.oliveD); });
    });
    box(g, 0, 6.2, 0, 3.4, 0.3, 3.4, M.olive);           // platform
    box(g, 0, 7.0, 0, 3.2, 1.4, 3.2, M.olive);           // cabin (open sides)
    box(g, 0, 8.0, 0, 3.6, 0.3, 3.6, M.oliveD);          // roof
    // searchlight
    cyl(g, 0, 7.1, 1.6, 0.3, 0.35, 0.5, M.warn, 8).rotation.x = Math.PI / 2;
    col(cx, cz, 3.4, 3.4, 0, 6.0);                        // base legs block
  }

  // ========================================================================
  //   PARADE GROUND FORMATION — instanced static soldiers standing in ranks.
  //   WHY instanced: a formation is dozens of identical figures; one draw call.
  //   These are scenery (no AI); a handful of LIVE soldiers patrol separately.
  // ========================================================================
  function paradeFormation(root, cx, cz) {
    // a simple blocky standing soldier as ONE merged geometry, then instanced.
    const parts = [];
    function add(w, h, d, x, y, z) { const gg = bg(w, h, d); gg.translate(x, y, z); parts.push(gg); }
    add(0.6, 0.9, 0.35, 0, 0.95, 0);     // torso
    add(0.28, 0.85, 0.28, -0.18, 0.43, 0); // left leg
    add(0.28, 0.85, 0.28, 0.18, 0.43, 0);  // right leg
    add(0.18, 0.7, 0.18, -0.42, 1.05, 0);  // left arm
    add(0.18, 0.7, 0.18, 0.42, 1.05, 0);   // right arm
    add(0.32, 0.32, 0.32, 0, 1.6, 0);      // head
    add(0.36, 0.14, 0.38, 0, 1.78, 0);     // helmet
    let merged;
    const BGU = THREE.BufferGeometryUtils;
    if (BGU && BGU.mergeBufferGeometries) { merged = BGU.mergeBufferGeometries(parts); parts.forEach(function (p) { p.dispose(); }); }
    else { merged = parts[0]; }            // fallback: torso only (still reads)
    const ROWS = 4, COLS = 8, GAP = 1.6;
    const im = new THREE.InstancedMesh(merged, cm(M.olive), ROWS * COLS);
    im.castShadow = true; im.receiveShadow = true;
    const d = new THREE.Object3D(); let idx = 0;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      d.position.set(cx - (COLS - 1) * GAP / 2 + c * GAP, 0, cz - (ROWS - 1) * GAP / 2 + r * GAP);
      d.rotation.y = 0; d.updateMatrix(); im.setMatrixAt(idx++, d.matrix);
    }
    im.instanceMatrix.needsUpdate = true; root.add(im);
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
    // collider: rotate the footprint roughly by snapping to nearest axis
    const fw = made.footW * (footScale || 1), fl = made.footL * (footScale || 1);
    const sideways = Math.abs(Math.sin(rotY || 0)) > 0.5;
    const cw = sideways ? fl : fw, cd = sideways ? fw : fl;
    col(wx, wz, cw, cd, 0, 3.0, made.group);
    if (kind) {
      made.group.userData.milKind = kind;
      made.group.userData.milName = name || kind;
      placed.push({
        group: made.group, pos: made.group.position, heading: rotY || 0,
        kind: kind, model: { name: name || kind },
        footW: fw, footL: fl, taken: false, hot: true,
      });
    }
    return made.group;
  }

  // ========================================================================
  //   MAIN BUILDER
  // ========================================================================
  CBZ.addLandmass(function (city) {
    const root = city.root || (CBZ.scene);

    // a city rebuild re-runs this whole builder → fresh prop groups. Clear the
    // boardable capture + the one-shot guard so the rebuilt hardware re-registers
    // (the militaryvehicles.js registry was cleared by its reset chain).
    placed.length = 0; _reg = false;

    buildGround(root);
    buildFence(root);
    const cw = buildCauseway(root);

    // ---- AIRSTRIP: parked fighter jets in a row + a heavy bomber ----
    const rwZ = MAXZ - 70;                                // runway centre Z
    const jetZ = rwZ - 22;                                // parked just north of runway
    for (let i = 0; i < 5; i++) {
      placeModel(root, makeJet, MINX + 90 + i * 34, jetZ, Math.PI, 1, "plane", "Fighter Jet");   // nose pointing -Z (toward runway)
    }
    placeModel(root, makeBomber, MAXX - 95, jetZ - 12, Math.PI, 1, "plane", "Heavy Bomber");      // the big one, set back

    // ---- HELIPADS: a row, each with a parked helicopter ----
    const padZ = CEN_Z + 30;
    for (let i = 0; i < 4; i++) {
      const px = MINX + 70 + i * 30;
      // pad disc + painted H
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 0.08, 20), cm(M.tarmac));
      pad.position.set(px, 0.02, padZ); pad.receiveShadow = true; root.add(pad);
      box(root, px, 0.06, padZ, 1.0, 0.02, 4.0, M.paint, { cast: false });           // H verticals
      box(root, px - 1.4, 0.06, padZ, 0.02 + 2.8, 0.02, 0.8, M.paint, { cast: false }); // H crossbar
      const ring = new THREE.Mesh(new THREE.TorusGeometry(6.2, 0.12, 6, 24), cm(M.paint));
      ring.rotation.x = Math.PI / 2; ring.position.set(px, 0.05, padZ); root.add(ring);
      placeModel(root, makeHeli, px, padZ, rng() * 0.4 - 0.2, 1, "heli", "Helicopter");
    }

    // ---- MOTOR POOL: a line of tanks + armored trucks ----
    const mpZ = CEN_Z - 70;
    for (let i = 0; i < 5; i++) placeModel(root, makeTank, MINX + 70 + i * 26, mpZ, Math.PI / 2, 1, "tank", "Main Battle Tank");
    for (let i = 0; i < 4; i++) placeModel(root, makeTruck, MINX + 70 + i * 26, mpZ - 18, Math.PI / 2, 1, "ground", "Armored Truck");

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
              label: function () { return "Browse the armory"; },
              onSelect: function () {
                // prefer a REAL shop if the engine exposes one
                if (typeof CBZ.cityOpenShop === "function") { CBZ.cityOpenShop("guns", tok); return; }
                if (typeof CBZ.cityOpenGunStore === "function") { CBZ.cityOpenGunStore(); return; }
                const msg = "Base armory — racked M4s, sidearms and crates. Quartermaster's out; help yourself at the city gun store.";
                if (CBZ.city && CBZ.city.note) CBZ.city.note(msg, 3.2);
              },
            },
          ],
        });
        if (CBZ.interactions.describe) {
          CBZ.interactions.describe("armory", function () {
            return { label: "Armory", note: "Weapons, ammo and gear — Command HQ" };
          });
        }
        armoryWired = (typeof CBZ.cityOpenShop === "function" || typeof CBZ.cityOpenGunStore === "function") ? "shop" : "note";
      }
    } catch (e) { armoryWired = "note"; }

    // ---- WATCHTOWERS at the four corners (the base is WATCHED) ----
    watchtower(root, MINX + 18, MINZ + 18);
    watchtower(root, MAXX - 18, MINZ + 18);
    watchtower(root, MINX + 18, MAXZ - 18);
    watchtower(root, MAXX - 18, MAXZ - 18);

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

    // ---- PARADE GROUND with a static instanced formation ----
    paradeFormation(root, CEN_X - 90, CEN_Z + 40);

    // ========================================================================
    //   TROOPS — live soldiers via cityMakePed: armed, olive patrol cap (the
    //   peds.js "soldier" job paints the cap). The city ped brain drives their
    //   roaming; because this region is registered as walkable, clampToCity
    //   keeps them inside the wire. A few are STATIONED idle at posts (gate,
    //   towers) by parking their target on the spot and idling them.
    // ========================================================================
    const troops = [];
    function trooper(x, z, opts) {
      if (!CBZ.cityMakePed) return null;
      opts = opts || {};
      const p = CBZ.cityMakePed(x, z, rng, Object.assign({
        job: "soldier", kind: "civilian", armed: true, weapon: "AK-47",
        aggr: 0.45, hp: 140,
      }, opts));
      if (p) { CBZ.cityPeds.push(p); troops.push(p); }
      return p;
    }
    // gate guards (stationed — stand the post)
    const gateGuard1 = trooper(cw.gx + 2, CW_MINZ + 2, { aggr: 0.35 });
    const gateGuard2 = trooper(cw.gx + 2, CW_MAXZ - 2, { aggr: 0.35 });
    [gateGuard1, gateGuard2].forEach(function (g) {
      if (g) { g.state = "idle"; g.pause = 9e9; g._stationed = { x: g.pos.x, z: g.pos.z }; }
    });
    // patrolling soldiers scattered across the base
    if (CBZ.cityScatterInRegion) {
      const reg = { kind: "rect", minX: MINX, maxX: MAXX, minZ: MINZ, maxZ: MAXZ, pad: 0 };
      const pts = CBZ.cityScatterInRegion(reg, 10, rng, 24);
      pts.forEach(function (pt) { trooper(pt.x, pt.z); });
    }

    // light patrol nudge: stationed guards drift back to their post if shoved.
    if (CBZ.onUpdate) {
      CBZ.onUpdate(38.7, function () {
        const g = window.CBZ.game || window.g;
        if (g && g.mode !== "city") return;
        for (let i = 0; i < troops.length; i++) {
          const t = troops[i];
          if (!t || t.dead || t.rage) continue;
          if (t._stationed) {
            const dx = t._stationed.x - t.pos.x, dz = t._stationed.z - t.pos.z;
            if (dx * dx + dz * dz > 9) {                   // wandered/shoved off post
              if (t.target && t.target.set) t.target.set(t._stationed.x, 0, t._stationed.z);
              t.state = "walk"; t.pause = 0;
            } else { t.state = "idle"; t.pause = Math.max(t.pause, 2); }
          }
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
      city.roads.push({ x: (CW_MINX + CW_MAXX) / 2, z: CW_CZ, vertical: false, len: CW_MAXX - CW_MINX, district: "highway" });
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
    CBZ._militaryBase = { center: { x: CEN_X, z: CEN_Z }, minX: MINX, maxX: MAXX, minZ: MINZ, maxZ: MAXZ, armoryWired: armoryWired, boardable: placed.length };
  }, 22);
})();
