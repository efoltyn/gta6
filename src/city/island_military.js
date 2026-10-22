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

   THE MACHINES are NPC War's units (src/units/vehicles/*.js), the
   republic's: M1A2 Abrams, M2A3 Bradley, Stryker, Humvee / JLTV /
   MaxxPro, FMTV and M35 trucks, M142 HIMARS, Patriot, F-35A, AH-64,
   UH-60M, MQ-9 (in the hangar, scenery), B-52H, A400M (its hold is a
   room). They load and park when the player comes within 900 m of the
   wire (FLEET below), built through city/unitmodels.js (CBZ.milModels),
   the one path that builds a unit for the city on any page.

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
  // vehicle must take its parked collider WITH it — see placeUnit).
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

  // ========================================================================
  //   THE MACHINES ARE NPC WAR'S UNITS.
  //
  //   Every tank, truck, launcher and airframe on this base is the unit file
  //   NPC War fights with (src/units/vehicles/<id>.js): the same M1A2 with the
  //   same tracks, crew seats, armour and gun, in the battle, on these stands,
  //   and under the player who steals it. There is no second model of any of
  //   them here. What this file used to build (city/mil_armor.js's seven
  //   generic hulls, city/mil_air.js's five generic airframes and its own
  //   cargo lifter) is deleted.
  //
  //   NOTHING LOADS WITH THE CITY. The unit files are not on the page at
  //   boot: they load through CBZ.army.loadUnits (city/army.js) the first
  //   time the player comes within FLEET_NEAR of the wire (or something asks
  //   for a machine: the air response, the pilot origin, the war room), and
  //   the hulls are built one per frame after that. A city nobody drives to
  //   Fort Brandt in never pays for an Abrams.
  // ========================================================================
  // what stands on each kind of stand. A kind with several takes them in
  // turn down the row (the motor pool's light rank is JLTV, MaxxPro, ...;
  // the HQ lot keeps the Humvee, which is what fits a 6 m stall).
  const UNITS = {
    tank: ["m1_abrams"], ifv: ["bradley_ifv"], apc: ["stryker_apc"],
    luv: ["hmmwv"], luvPool: ["jltv", "maxxpro_mrap"],
    truck: ["fmtv", "m35_truck"], mlrs: ["m270_mlrs"], patriot: ["patriot_launcher"],
    fighter: ["f35"], attackHeli: ["ah64_apache"], heli: ["uh60_black_hawk"], drone: ["mq9_reaper"],
    bomber: ["b52"], cargo: ["a400m"],
  };
  function unitForStand(s, n) {
    const list = s.kind === "luv" && s.rank ? UNITS.luvPool : UNITS[s.kind];
    return list ? list[n % list.length] : null;
  }
  // militaryvehicles.js's taxonomy: how it boards (air = the flight path),
  // what the verb says, which fire control the seat gets
  const TAKE = { m1_abrams: "tank", patriot_launcher: "patriot", m270_mlrs: "mlrs" };
  function takeKind(id, def) {
    if (TAKE[id]) return TAKE[id];
    if (def.domain === "air") return def.drive === "rotor" ? "heli" : "plane";
    return "ground";
  }

  /* ---- THE A400M'S HOLD IS A ROOM (city/vehicle_hold.js) ------------------
     OWNER: "a cargo plane where you can open and close the back and even a
     tank can drive into the back." The unit's Atlas has the real hold (17.7 m
     + the 5.4 m ramp, 4.0 m wide, the floor at 1.55 m) and a ramp node hinged
     at the sill. vehicle_hold poses a ramp by rotation.x with 0 = lying flat
     aft, so the ramp goes on a pivot at its hinge with a fixed flattening
     node between: the unit file still owns the ramp node itself (its CDS run
     swings it), and the hold owns the pivot. Numbers are the unit file's. */
  const ATLAS = { floorTop: 1.55, z0: -6.40, z1: 14.80, halfW: 2.0, roof: 5.40, hingeY: 1.32,
    rampLen: 5.71, rampW: 3.95, rest: 0.304 };
  function atlasHold(rec, made) {
    if (!CBZ.vehicleHold) return null;
    const N = made.rig && made.rig.state && made.rig.state.nodes;
    const ramp = N && N.ramp;
    let pivot = null;
    if (ramp && ramp.parent) {
      const body = ramp.parent;
      pivot = new THREE.Group(); pivot.name = "a400m-ramp-pivot";
      pivot.position.copy(ramp.position);
      const flat = new THREE.Group(); flat.name = "a400m-ramp-flat";
      flat.rotation.x = -ATLAS.rest;                 // the closed skin, laid flat
      body.add(pivot); pivot.add(flat);
      body.remove(ramp); ramp.position.set(0, 0, 0); flat.add(ramp);
    }
    const A = ATLAS, mid = (A.z0 + A.z1) / 2, len = A.z1 - A.z0;
    return CBZ.vehicleHold(rec, {
      id: "a400m-" + placed.length,
      label: "Cargo hold",
      scale: 1,
      floor: { x: 0, z: mid, w: A.halfW * 2, d: len, top: A.floorTop },
      roof: A.roof,
      walls: [
        { x: -(A.halfW + 0.3), z: mid, w: 0.45, d: len, y0: 0, y1: A.roof + 0.6 },     // port side
        { x: (A.halfW + 0.3), z: mid, w: 0.45, d: len, y0: 0, y1: A.roof + 0.6 },       // starboard side
        { x: 0, z: A.z1 + 0.3, w: A.halfW * 2 + 0.9, d: 0.5, y0: 0, y1: A.roof + 0.6 }, // the flight-deck bulkhead
        { x: 0, z: 18.9, w: 5.6, d: 7.0, y0: 0, y1: 7.0 },                              // the nose
        { x: -3.2, z: -0.4, w: 1.2, d: 8.0, y0: 0, y1: 2.6 },                            // the gear sponsons
        { x: 3.2, z: -0.4, w: 1.2, d: 8.0, y0: 0, y1: 2.6 },
        /* no wall for the upswept tail over the ramp: systems/physics.js
           collide() treats a vehicle's collider at full height, so a y-gated
           box over the ramp mouth seals it against a tank (measured with the
           old lifter: the tank stopped 7 m short of the toe). */
      ],
      ramp: pivot ? {
        node: pivot, w: A.rampW, len: A.rampLen, x: 0,
        sillZ: A.z0, sillTop: A.floorTop, dir: -1,
        closedRx: A.rest, openRx: -Math.asin((A.floorTop - 0.02) / A.rampLen), seconds: 3.0,
      } : null,
    });
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
  //   THE MOTOR POOL AND THE FLIGHT LINE — the units, on their stands.
  // ========================================================================
  // module-local capture of every BOARDABLE machine placed on the base; each
  // is handed to militaryvehicles.js (CBZ.cityRegisterMilitaryVehicle) the
  // moment it stands on its stand.
  const placed = [];

  // the hull on its stand: a solid collider, and (unless the stand is
  // scenery, the two drones in the hangar) a stealable record
  function placeUnit(root, made, s, wx, wz) {
    const g = made.group, rotY = s.yaw || 0;
    g.position.set(wx, 0, wz);
    g.rotation.y = rotY;
    made.veh.h = made.veh.yaw = made.veh.heading = rotY;
    // parked hardware can become a live, moving machine under a named pilot:
    // keep it out of the static world merger
    g.userData.dynamic = true;
    root.add(g);
    const atlas = made.unitId === "a400m";
    // a rotor disc or a wing is not a wall: the solid is the body
    const bw = made.colliderW || made.footW, bl = made.colliderL || made.footL;
    const sideways = Math.abs(Math.sin(rotY)) > 0.5;
    // THE ATLAS IS NOT A BOX. One full-footprint AABB is precisely the wall
    // that stops a tank driving up its ramp; its solidity is the hold rig's
    // LOCAL walls (city/vehicle_hold.js), which also stay right when it flies.
    const solid = atlas ? null : col(wx, wz, sideways ? bl : bw, sideways ? bw : bl, 0, made.height, g);
    // what it is when a bomb lands beside it (systems/strike.js hardware),
    // boardable or scenery alike: its skin and hit points by what it is
    const D0 = made.def || {}, A0 = (D0.stats && D0.stats.armour) || {};
    g.userData.hwKind = D0.drive === "rotor" ? "heli" : D0.domain === "air" ? (D0.stats && D0.stats.remote ? "drone" : "plane")
      : (A0.front || 0) > 300 ? "tank" : (A0.side || 0) >= 9 ? "ground" : "truck";
    const kind = s.scenery ? null : takeKind(made.unitId, made.def);
    if (!kind) return null;
    g.userData.milKind = kind;
    g.userData.milName = made.name;
    if (made.aircraftDims) g.userData.aircraftDims = made.aircraftDims;
    const rec = {
      group: g, pos: g.position, heading: rotY,
      kind: kind, model: { name: made.name },
      unitId: made.unitId, unit: made,
      // the parked collider rides on the record so STEALING the machine can
      // remove it (the shared rec._colliderDetached protocol)
      collider: solid, colliderW: made.colliderW || null, colliderL: made.colliderL || null,
      // these models face +Z and stand on their wheels/tracks at y = 0
      modelYawOffset: 0, groundOffset: 0,
      aircraftDims: made.aircraftDims || null,
      footW: made.footW, footL: made.footL, taken: false, hot: true,
      stand: s,
    };
    if (s.kind === "attackHeli") rec.attackHeli = true;
    if (atlas) {
      rec.cargoLifter = true;
      // it flies like the heavy it is and carries no missiles
      // (playeraircraft.js honours both)
      rec.airClass = "airliner"; rec.armed = false;
      rec.hold = atlasHold(rec, made);
      // no hold rig = no walls at all, which is worse than a box: buy back a
      // fuselage AABB (never the 42 m span, so you can walk under the wings)
      if (!rec.hold || rec.hold.inert) {
        rec.collider = col(wx, wz, sideways ? made.footL : 5.6, sideways ? 5.6 : made.footL, 0, made.height, g);
      }
    }
    placed.push(rec);
    if (CBZ.cityRegisterMilitaryVehicle) CBZ.cityRegisterMilitaryVehicle(rec);
    return rec;
  }

  /* THE FLEET LOADS WHEN YOU COME TO IT. FLEET_NEAR is measured off the wire
     the base publishes (CBZ._militaryBase min/max), not its centre: 900 m is
     the far shore of the causeway and a fast jet's run-in, so every hull is on
     its stand before the player can see the apron. Built one per frame. */
  const FLEET_NEAR = 900;
  const FLEET = { gen: 0, state: "idle", stands: null, root: null, queue: [], promise: null, checkT: 0 };
  function fleetIds() {
    const out = [];
    (FLEET.stands || []).forEach(function (q) { if (out.indexOf(q.id) < 0) out.push(q.id); });
    return out;
  }
  function fleetEnsure() {
    if (!FLEET.stands) return null;
    if (FLEET.state !== "idle") return FLEET.promise;
    FLEET.state = "loading";
    const gen = FLEET.gen;
    FLEET.promise = CBZ.milModels.load(fleetIds()).then(function (got) {
      if (gen !== FLEET.gen) return;
      FLEET.queue = FLEET.stands.filter(function (q) { return got.indexOf(q.id) >= 0; });
      FLEET.state = "building"; FLEET.buildT = 0;
    }).catch(function (e) {
      console.warn("[fort] the motor pool did not load:", e);
      if (gen === FLEET.gen) FLEET.state = "idle";
    });
    return FLEET.promise;
  }
  /* A PARKED HULL PAST THE FOG IS NOT DRAWN. The apron is ~40 machines and a
     few thousand draw calls in full view; beyond the fog's far plane every one
     of them is fogged to nothing anyway, so it costs a phone the calls and
     buys no pixels. Twice a second, a distance test per stand. A machine somebody has taken (the player, the air response) is
     never hidden. */
  let sleepT = 0;
  function fleetSleep(dt) {
    if ((sleepT -= dt) > 0) return;
    sleepT = 0.5;
    const cam = CBZ.camera && CBZ.camera.position;
    if (!cam) return;
    const fog = CBZ.scene && CBZ.scene.fog;
    const R = (fog && fog.far > 0 ? fog.far : 1400) + 80, R2 = R * R;
    for (let i = 0; i < placed.length; i++) {
      const r = placed[i], g = r && r.group;
      if (!g || r.taken || r._aiActive || r._heldBy) { if (g && g.userData.fleetAsleep) { g.visible = true; g.userData.fleetAsleep = false; } continue; }
      const dx = r.pos.x - cam.x, dz = r.pos.z - cam.z;
      const far = dx * dx + dz * dz > R2;
      if (far && g.visible) { g.visible = false; g.userData.fleetAsleep = true; }
      else if (!far && g.userData.fleetAsleep) { g.visible = true; g.userData.fleetAsleep = false; }
    }
  }
  /* PARKING THE FLEET IS NOT FRAME WORK. Each hull's first build of its type
     lofts the template and paints its camo/markings canvas on the CPU (a
     Bradley's 512^2 fbm camo alone is ~70 ms; the 37 stands came to ~0.5 s
     cold), and the fleet starts at 900 m, out of sight. Parked one a frame,
     that was a 13 ms mean / 95 ms worst frame for the 40 frames after you
     came within 900 m. Now the hulls park in the page's idle time between
     frames (several per idle slice while it lasts, at least one per slice,
     never starved: a 250 ms timeout), so a frame never carries a build. */
  const IDLE = typeof window !== "undefined" && typeof window.requestIdleCallback === "function" ? window.requestIdleCallback.bind(window) : null;
  function fleetPark() {
    const q = FLEET.queue.shift();
    if (q) {
      try {
        const made = CBZ.milModels.build(q.id, { seed: q.n });
        if (made) placeUnit(FLEET.root, made, q.s, q.x, q.z);
      } catch (e) { console.warn("[fort] could not park " + q.id, e); }
      q.done = true;
    }
    if (!FLEET.queue.length) {
      FLEET.state = "ready";
      if (CBZ._militaryBase) CBZ._militaryBase.boardable = placed.length;
    }
  }
  function fleetIdle(deadline, gen) {
    FLEET.idleAsked = false;
    if (gen !== FLEET.gen || FLEET.state !== "building") return;
    do fleetPark();
    while (FLEET.state === "building" && deadline && !deadline.didTimeout && deadline.timeRemaining() > 6);
  }
  CBZ.fortBrandtFleet = {
    ensure: fleetEnsure,
    state: function () { return FLEET.state; },
    near: FLEET_NEAR,
    // stands of this kind (basekit's: "bomber", "heli"...) not built yet
    pending: function (kind) {
      if (FLEET.state === "ready") return 0;
      let n = 0;
      (FLEET.stands || []).forEach(function (q) { if (q.s.kind === kind && !q.done && !q.s.scenery) n++; });
      return n;
    },
    records: function () { return placed.slice(); },
  };
  if (CBZ.onUpdate) {
    CBZ.onUpdate(55.1, function (dt) {
      if (!FLEET.stands) return;
      if (FLEET.state === "idle") {
        // a page that raised the island without the city (NPC War's
        // `militaryisland` map) asked for the base: park it at once
        if (!CBZ.army) { fleetEnsure(); return; }
        if ((FLEET.checkT -= dt) > 0) return;
        FLEET.checkT = 0.5;
        const P = CBZ.player, B = CBZ._militaryBase;
        if (!P || !P.pos || !B) return;
        const dx = Math.max(B.minX - P.pos.x, 0, P.pos.x - B.maxX);
        const dz = Math.max(B.minZ - P.pos.z, 0, P.pos.z - B.maxZ);
        if (dx * dx + dz * dz < FLEET_NEAR * FLEET_NEAR) fleetEnsure();
        return;
      }
      if (FLEET.state === "ready") { fleetSleep(dt); return; }
      if (FLEET.state !== "building") return;
      // between frames when the page can (see fleetIdle). A page without
      // idle callbacks, or a page too busy to have finished in 1.5 s (a jet
      // covers the 900 m in ~4 s), parks one hull a frame, as it always did.
      FLEET.buildT = (FLEET.buildT || 0) + dt;
      if (IDLE && FLEET.buildT < 1.5) { if (!FLEET.idleAsked) { FLEET.idleAsked = true; const gen = FLEET.gen; IDLE(function (d) { fleetIdle(d, gen); }, { timeout: 250 }); } return; }
      fleetPark();
    });
  }

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
    // boardable capture; the fleet re-parks on the new stands when the player
    // next comes near (the militaryvehicles.js registry prunes the old ones).
    placed.length = 0;

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
      lodLights: "fort-brandt",        // the field's lights join the city's LOD lights (core/lodlights.js)
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

    // ---- THE MACHINES: which unit stands on which stand. Nothing is built
    // here: the fleet loads and parks when the player comes near (FLEET).
    FLEET.gen++; FLEET.root = root; FLEET.queue = []; FLEET.promise = null;
    FLEET.state = "idle"; FLEET.checkT = 0; FLEET.stands = []; FLEET.idleAsked = false; FLEET.buildT = 0;
    const perKind = {};
    (PLAN ? PLAN.stands : []).forEach(function (s) {
      if (s.kind === "b2") return;                       // city/strategic.js parks the B-2 on this stand (zoning fixture)
      const key = s.kind === "luv" && s.rank ? "luvPool" : s.kind;
      const id = unitForStand(s, (perKind[key] = (perKind[key] || 0) + 1) - 1);
      if (!id) return;
      const w = W(s);
      FLEET.stands.push({ s: s, id: id, n: FLEET.stands.length, x: w.x, z: w.z, done: false });
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
