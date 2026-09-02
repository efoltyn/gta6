/* ============================================================
   world/sea_craft.js — SMALL CRAFT IN ANY MODE, AND WHAT A SHARK DOES TO ONE.

   WHY THIS FILE EXISTS
   ------------------------------------------------------------
   Every boat in this game is a cityCars record. vehicles.js is city-only, so
   the shark sim — which borrows survival's island and never builds a road
   network — has never had a single boat on its water. The mode whose entire
   pitch is "you are the shark" was missing the one thing a shark is famous
   for being under.

   So this is the boat WITHOUT the car: a record shaped exactly like the one
   every marine seam in this repo already reads (`.pos`, `.group`, `.heading`,
   `.v/.vx/.vz`, `._hullSpec`, `._planing`) so that

     • CBZ.isMarineHull(rec)                is true,
     • CBZ.marineAutopilot(rec, dt, cmd)    drives it (piracy.js — the ONE AI
                                            hand on a wheel in this game; there
                                            is no second mover here),
     • CBZ.marineShoreBlock                 keeps it off the sand,
     • CBZ.waterRideAt / CBZ.waterWakeFor   seat it and wake it,
     • CBZ.waterFloat                       sinks it when it is holed,
     • water_stability.js's heel/capsize    rolls it when a shark hits it,
     • marine_predation.js and the mounted
       shark's own bite scan                can eat it.

   NOTHING HERE IS A SECOND COPY of any of those. The file is a registry, a
   mover that spends the autopilot, a seat for the people aboard, and the
   damage model for "a shark bit a piece out of my boat".

   THE RULES OF SHARK VS BOAT (§4) — the numbers decide, never a list of names
   ------------------------------------------------------------
     ENGULF  the whole hull goes in the mouth:  loa <= 0.62 * bodyLen  AND
             gape >= 0.8 * beam. 0.62 is wildlife_tame.js's own ENGULF_MAX for
             a body, used here for a hull so a meal is a meal whatever it is
             made of.
     BITE    a chunk comes off the rail:        CBZ.marineBiteableHull — the
             jaws close ACROSS the beam and the animal outweighs the hull
             (marine_predation.js §6 owns that gate; we do not fork it).
     RAM     everything else it can reach. The heeling moment decides whether
             the hull goes over, and the moment is physics, not a table:

                 moment[kN.m] = tonnes(shark) * closingSpeed[m/s] * (beam/2)

             against the hull's own righting moment, displacement * gm *
             sin(phi) (water_stability.js integrates it; §5 has a small
             self-contained fallback so the TIP is real even if that file is
             absent). Measured against the authored fleet that gives:
             a 1.5 t great white at 8 m/s puts 4.5 kN.m into a kayak whose
             whole righting moment is 0.04 — it goes over — and 12.6 into a
             speedboat that rights itself with 14.1, so it rocks hard and
             needs two or three passes. A 30 t megalodon at 10 m/s puts 630
             into a cruiser that rights with 220. Nobody typed any of that.

   FLAG: none. Git is the undo (CLAUDE.md).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  const craft = [];
  const AUDIT = {
    spawned: 0, eaten: 0, tipped: 0, sunk: 0, holed: 0, overboard: 0,
    biggestEatenM: 0, rams: 0, bites: 0,
  };

  function num(v, d) { return Number.isFinite(+v) ? +v : d; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function MH() { return CBZ.marineHulls || null; }
  function seaY(x, z) {
    if (typeof CBZ.citySeaHeightAt === "function") { try { return CBZ.citySeaHeightAt(x, z); } catch (e) {} }
    return -0.48;
  }
  function splash(x, z, p) {
    if (typeof CBZ.waterSplashAt !== "function") return;
    try { CBZ.waterSplashAt(x, seaY(x, z), z, clamp(p, 0.4, 4)); } catch (e) {}
  }
  // A deterministic 0..1 off a couple of numbers — this file never draws from
  // Math.random, because where a boat is and how it breaks is gameplay state.
  function h01(a, b) {
    if (typeof CBZ.hash01 === "function") { try { return CBZ.hash01(a, b, 0x5eac7a); } catch (e) {} }
    const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
    return s - Math.floor(s);
  }

  /* ---- THE PARENT. Island modes hang everything off the disaster arena's
     root (that is what survivorbot.js and the arena's own dressing use); the
     city hangs it off the city arena. Either way it is the group the world is
     reset by, so a craft never outlives its match. */
  function sceneRoot() {
    const A = (CBZ.surv && CBZ.surv.arena) || null;
    if (A && A.root) return A.root;
    if (CBZ.city && CBZ.city.arena && CBZ.city.arena.root) return CBZ.city.arena.root;
    return CBZ.scene || null;
  }

  // ============================================================
  //  §1. THE FLEET ROWS THIS FILE NEEDS AND WHERE THEY COME FROM
  // ============================================================
  /* water_hulls.js + yachts.js already register dinghy / boat / skiff /
     sloop / sportfish / trawler / cruiser / yacht. The three SMALL rows a
     beach fleet is mostly made of — a sea kayak, a PWC and a centre console —
     may or may not exist yet (another builder owns the geometry). So:

       • if the registry HAS the key, we use it, art and all;
       • if it does not, we register a spec-only row HERE, with the real
         dimensions and a stand-in mesh scaled from the nearest hull that does
         exist, so the RULES are right today and the art upgrades itself the
         moment the real row lands (registration is skipped when the key is
         already there — first parse wins, and a real builder always parses
         before we ever spawn).

     These are the dimensions, not decoration: the whole shark-vs-boat model
     reads loa/beam/massT off them. */
  const STANDIN = {
    kayak: {
      from: "dinghy",
      label: "Sea Kayak", model: "Sea Kayak",
      hull: {
        loa: 4.2, beam: 0.75, draft: 0.18, massT: 0.09,
        topKts: 5, cruiseKts: 3.2, planeKts: 0, canPlane: false, accel0: 0.5, humpFrac: 0.30,
        steerKind: "rudder", yawRate: 1.2, yawAccel: 3.0, yawDamp: 2.6,
        heelSign: 1, heelGain: 0.03, maxHeel: 0.30,
        rideAbove: 0.10, waveGain: 1.0, slamV: 2.0,
        deckY: 0.12, boardY: 0.20, sternOffset: 2.1, wakeScale: 0.25, audio: "bike",
      },
      stab: { gm: 0.05, phiV: 0.70, freeboard: 0.22, swampT: 2, crew: 1 },
    },
    jetski: {
      from: "dinghy",
      label: "Personal Watercraft", model: "Personal Watercraft",
      hull: {
        loa: 3.3, beam: 1.2, draft: 0.25, massT: 0.35,
        topKts: 48, cruiseKts: 30, planeKts: 9, canPlane: true, accel0: 5.4, humpFrac: 0.38,
        steerKind: "thrust", yawRate: 2.9, yawAccel: 9.0, yawDamp: 3.4,
        heelSign: -1, heelGain: 0.038, maxHeel: 0.34,
        rideAbove: 0.06, waveGain: 1.0, slamV: 2.4,
        deckY: 0.36, boardY: 0.42, sternOffset: 1.65, wakeScale: 0.7, audio: "bike",
      },
      stab: { gm: 0.25, phiV: 1.00, freeboard: 0.30, swampT: 4, crew: 2 },
    },
    console: {
      from: "boat",
      label: "Centre Console 25", model: "Centre Console 25",
      hull: {
        loa: 7.5, beam: 2.6, draft: 0.55, massT: 2.2,
        topKts: 42, cruiseKts: 28, planeKts: 11, canPlane: true, accel0: 3.4, humpFrac: 0.55,
        steerKind: "thrust", yawRate: 1.35, yawAccel: 3.4, yawDamp: 2.2,
        heelSign: -1, heelGain: 0.022, maxHeel: 0.22,
        rideAbove: 0.30, waveGain: 0.9, slamV: 3.6,
        deckY: 0.72, boardY: 0.78, sternOffset: 3.7, wakeScale: 1.0, audio: "sports",
      },
      stab: { gm: 0.90, phiV: 1.20, freeboard: 0.72, swampT: 18, crew: 4 },
    },
  };
  // What a missing key falls back to for its MESH when even the stand-in's
  // donor is gone.
  const MESH_FALLBACK = { kayak: "dinghy", jetski: "dinghy", console: "boat" };

  // Defaults for spec.stab, so a hull whose author has not declared stability
  // still has a real righting moment rather than a divide by zero. Same
  // numbers water_stability.js defaults to (the contract's table).
  const STAB_DEFAULT = {
    kayak: { gm: 0.05, phiV: 0.70, freeboard: 0.22, swampT: 2, crew: 1 },
    jetski: { gm: 0.25, phiV: 1.00, freeboard: 0.30, swampT: 4, crew: 2 },
    skiff: { gm: 0.35, phiV: 0.95, freeboard: 0.45, swampT: 5, crew: 3 },
    dinghy: { gm: 0.60, phiV: 1.15, freeboard: 0.42, swampT: 20, crew: 4 },
    boat: { gm: 0.90, phiV: 1.25, freeboard: 0.60, swampT: 14, crew: 5 },
    console: { gm: 0.90, phiV: 1.20, freeboard: 0.72, swampT: 18, crew: 4 },
    pirate_skiff: { gm: 0.50, phiV: 1.05, freeboard: 0.55, swampT: 8, crew: 6 },
    sloop: { gm: 0.80, phiV: 2.10, freeboard: 0.85, swampT: 40, crew: 4 },
    sportfish: { gm: 1.20, phiV: 1.40, freeboard: 1.10, swampT: 50, crew: 6 },
    cruiser: { gm: 1.40, phiV: 1.45, freeboard: 1.25, swampT: 60, crew: 8 },
    trawler: { gm: 1.00, phiV: 1.30, freeboard: 1.60, swampT: 90, crew: 6 },
    yacht: { gm: 2.40, phiV: 1.90, freeboard: 2.40, swampT: 999, crew: 14 },
  };
  function stabOf(spec) {
    if (!spec) return STAB_DEFAULT.dinghy;
    if (spec.stab) return spec.stab;
    const d = STAB_DEFAULT[spec.key];
    if (d) return d;
    // derived, so an unknown hull is never a special case: a stiffer boat is a
    // beamier one, and freeboard scales with length.
    const loa = num(spec.loa, 6), beam = num(spec.beam, 2);
    return {
      gm: clamp(beam * 0.22, 0.05, 3),
      phiV: clamp(0.6 + beam * 0.16, 0.7, 2.1),
      freeboard: clamp(loa * 0.09, 0.2, 2.4),
      swampT: clamp(loa * 2.4, 2, 999),
      crew: Math.max(1, Math.round(loa * 0.55)),
    };
  }
  CBZ.hullStabSpec = stabOf;        // read by the rules and by tools

  /* Register a stand-in row once, lazily, and only when nobody else has. */
  function ensureRow(key) {
    const R = MH();
    if (!R || typeof R.get !== "function") return null;
    let rec = R.get(key);
    if (rec) return rec;
    const S = STANDIN[key];
    if (!S || typeof R.register !== "function") return null;
    const donor = S.from;
    rec = R.register(key, {
      label: S.label, marque: "—", model: S.model, price: 0,
      // The stand-in mesh: the nearest registered hull, scaled to THESE
      // dimensions. It is a placeholder and it says so — the real builder's
      // row simply wins the `R.get(key)` above and none of this runs.
      build: function () {
        const g = R.build(donor) || R.build(MESH_FALLBACK[key] || "dinghy");
        if (!g) return new THREE.Group();
        const ds = R.spec(donor);
        if (ds && ds.loa > 0 && ds.beam > 0) {
          const sx = S.hull.beam / ds.beam, sz = S.hull.loa / ds.loa;
          g.scale.set(sx, Math.sqrt(sx * sz), sz);
        }
        g.userData.seaCraftStandIn = true;
        return g;
      },
      hull: S.hull,
    });
    if (rec && rec.spec && !rec.spec.stab) rec.spec.stab = S.stab;
    return rec;
  }

  // ============================================================
  //  §2. SPAWN / DESPAWN
  // ============================================================
  function seatsFor(spec) {
    const st = stabOf(spec);
    if (st && st.seats && st.seats.length) return st.seats;
    // Derived: down the centreline on the deck sole, facing forward, from a
    // quarter of the way aft to just abaft the bow. A boat with no authored
    // seats still puts its people IN it rather than on its origin.
    const loa = num(spec && spec.loa, 6);
    const n = Math.max(1, Math.min(14, num(st && st.crew, 2)));
    const y = num(spec && spec.deckY, loa * 0.09);
    const out = [];
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      out.push({ x: 0, y: y, z: loa * (0.28 - 0.52 * t), yaw: 0 });
    }
    return out;
  }

  function hullMeshOf(group) {
    // Same traverse marine_predation.js:266 uses to find a body's own hull:
    // the named mesh first, then the biggest one in the group.
    let named = null, big = null, bigN = -1;
    group.traverse(function (o) {
      if (!o.isMesh || !o.geometry) return;
      if (!named && /hull$/i.test(o.name || "")) named = o;
      const g = o.geometry;
      if (!g.attributes || !g.attributes.position) return;
      const n = g.attributes.position.count;
      if (n > bigN) { bigN = n; big = o; }
    });
    return named || big;
  }

  /* CBZ.seaCraft.spawn(key, x, z, heading, o)
       o.crew      how many bodies aboard (clamped to the hull's own maximum)
       o.anchored  hold station on a rode instead of steaming
       o.route     [{x,z}, ...] a loop of waypoints for a boat under way
       o.speed     m/s target under way (default the spec's cruise) */
  function spawn(key, x, z, heading, o) {
    o = o || {};
    const R = MH();
    if (!R) return null;
    ensureRow(key);
    let builtKey = R.get(key) ? key : (MESH_FALLBACK[key] || "dinghy");
    if (!R.get(builtKey)) builtKey = "dinghy";
    const spec = R.spec(builtKey);
    if (!spec) return null;
    let group = null;
    try { group = R.build(builtKey); } catch (e) { group = null; }
    if (!group) return null;
    const root = sceneRoot();
    if (!root) return null;
    group.position.set(x, seaY(x, z) + num(spec.rideAbove, 0.06), z);
    group.rotation.set(0, num(heading, 0), 0);
    root.add(group);

    const rec = {
      kind: "craft", key: key, detailStyle: builtKey,
      group: group, pos: group.position, heading: num(heading, 0),
      v: 0, vx: 0, vz: 0, _planing: 0, _yawRate: 0, _pitch: 0, _roll: 0, _trim: 0,
      _hullSpec: spec, _seaCraft: true,
      _playerCarFeel: R.feel ? R.feel(builtKey) : { marine: true, hull: builtKey },
      crew: [], anchored: !!o.anchored,
      anchor: { x: x, z: z },
      route: Array.isArray(o.route) && o.route.length ? o.route.slice() : null,
      routeI: 0, speed: num(o.speed, spec.cruiseMs * 0.55),
      dead: false, engineDead: false,
      hp: 120 + num(spec.massT, 1) * 40,
      maxHp: 120 + num(spec.massT, 1) * 40,
      ai: true, player: false,
      _hullMesh: hullMeshOf(group),
      _heel: 0, _heelV: 0, _capsized: false, _swamp: 0, _holed: false,
      _sinking: false, _sinkT: 0, _engulf: null,
      _seats: seatsFor(spec), _ramCd: 0, _lift: 0,
    };
    craft.push(rec);
    AUDIT.spawned++;
    const want = Math.min(num(o.crew, 0), rec._seats.length);
    for (let i = 0; i < want; i++) {
      const b = boardOne(rec, i);
      if (b) rec.crew.push(b);
    }
    return rec;
  }

  /* A body aboard. In island modes that is a survivor bot — the same crowd the
     shark already eats off the beach (CBZ.bots), so a shark that reaches over
     the gunwale takes a man off a boat with no new code at all. In the city
     the crew are cityPeds, and only when a spawner exists to make one. */
  function boardOne(rec, i) {
    const seat = rec._seats[i];
    if (!seat) return null;
    const p = seatWorld(rec, seat, _tmpV);
    let b = null;
    if (CBZ.islandModeOn && CBZ.islandModeOn(CBZ.game && CBZ.game.mode) && CBZ.spawnSurvivorBotAt) {
      try { b = CBZ.spawnSurvivorBotAt(p.x, p.z); } catch (e) { b = null; }
    } else if (typeof CBZ.citySpawnPedAt === "function") {
      try { b = CBZ.citySpawnPedAt(p.x, p.z); } catch (e) { b = null; }
    }
    if (!b) return null;
    b._aboard = rec;
    b._aboardSeat = i;
    if (b.char) b.char.sitting = true;
    if (b.pause != null) b.pause = 1e9;
    return b;
  }

  const _tmpV = new THREE.Vector3();
  const _tmpV2 = new THREE.Vector3();
  const _e = new THREE.Euler(0, 0, 0, "YXZ");
  const _q = new THREE.Quaternion();
  const _ride = {};
  const _rideOpts = { heading: 0, len: 1, beam: 1 };

  function seatWorld(rec, seat, out) {
    out.set(seat.x, seat.y, seat.z);
    rec.group.updateMatrixWorld(true);
    return out.applyMatrix4(rec.group.matrixWorld);
  }

  function despawn(rec) {
    if (!rec) return;
    releaseCrew(rec, false);
    if (rec._floatH) { try { rec._floatH.release(); } catch (e) {} rec._floatH = null; }
    if (rec.group && rec.group.parent) rec.group.parent.remove(rec.group);
    const i = craft.indexOf(rec);
    if (i >= 0) craft.splice(i, 1);
    rec.dead = true;
  }
  function despawnAll() { while (craft.length) despawn(craft[craft.length - 1]); }

  // ============================================================
  //  §3. THE MOVER — one autopilot, one ride, one wake
  // ============================================================
  function routePoint(rec) {
    if (!rec.route || !rec.route.length) return null;
    return rec.route[rec.routeI % rec.route.length];
  }

  function moveCruising(rec, dt) {
    const wp = routePoint(rec);
    if (!wp) return;
    let d = -1;
    if (typeof CBZ.marineAutopilot === "function") {
      try { d = CBZ.marineAutopilot(rec, dt, { x: wp.x, z: wp.z, speed: rec.speed, arrive: 8 }); } catch (e) { d = -1; }
    }
    if (d < 0) {
      // The autopilot refused (no water under it, no spec, the file absent):
      // hold way on the current heading rather than freezing mid-ocean.
      const s = rec.v = Math.max(0, rec.v * (1 - dt * 0.6));
      rec.pos.x += Math.sin(rec.heading) * s * dt;
      rec.pos.z += Math.cos(rec.heading) * s * dt;
      d = Math.hypot(wp.x - rec.pos.x, wp.z - rec.pos.z);
    }
    if (d >= 0 && d < 10) rec.routeI = (rec.routeI + 1) % rec.route.length;
  }

  function moveAnchored(rec, dt) {
    /* A REAL ANCHOR RODE: the hull drifts on the current and is restrained by
       the scope, so it swings round the anchor instead of being pinned to a
       coordinate. That swing is what makes a line of anchored skiffs read as
       boats rather than as props. */
    const spec = rec._hullSpec;
    let cx = 0, cz = 0;
    const wf = CBZ.waterField;
    if (wf && typeof wf.currentAt === "function") {
      try { const c = wf.currentAt(rec.pos.x, rec.pos.z); if (c) { cx = num(c.x, 0); cz = num(c.z, 0); } } catch (e) {}
    }
    if (!cx && !cz) {
      // no current field: a slow tidal set derived from the clock, so every
      // anchored hull in the bay swings together the way they really do
      const t = (typeof CBZ.waterClock === "function" ? CBZ.waterClock() : (Date.now() * 0.001)) * 0.06;
      cx = Math.cos(t) * 0.22; cz = Math.sin(t * 0.83) * 0.22;
    }
    rec.pos.x += cx * dt; rec.pos.z += cz * dt;
    const scope = num(spec && spec.loa, 6) * 1.2;
    const dx = rec.pos.x - rec.anchor.x, dz = rec.pos.z - rec.anchor.z;
    const r = Math.hypot(dx, dz);
    if (r > scope) {
      rec.pos.x = rec.anchor.x + dx / r * scope;
      rec.pos.z = rec.anchor.z + dz / r * scope;
    }
    // she lies to her rode: bow into the set
    if (r > 0.4) {
      const want = Math.atan2(dx, dz);
      let err = want - rec.heading;
      while (err > Math.PI) err -= Math.PI * 2;
      while (err < -Math.PI) err += Math.PI * 2;
      rec.heading += err * Math.min(1, dt * 0.45);
    }
    rec.v = 0; rec.vx = 0; rec.vz = 0;
  }

  function moveDrifting(rec, dt) {
    rec.v *= Math.max(0, 1 - dt * 0.8);
    rec.pos.x += rec.vx * dt; rec.pos.z += rec.vz * dt;
    rec.vx *= Math.max(0, 1 - dt * 0.9); rec.vz *= Math.max(0, 1 - dt * 0.9);
    if (typeof CBZ.marineShoreBlock === "function") {
      try { CBZ.marineShoreBlock(rec, rec._hullSpec, dt); } catch (e) {}
    }
  }

  /* THE RIDE. Seat the hull on the live surface with the wave attitude, then
     compose whatever roll the stability owner has for it. water_buoyancy.js's
     own pass only ever walks cityCars, which is exactly why this exists. */
  function ride(rec, dt) {
    const spec = rec._hullSpec;
    _rideOpts.heading = rec.heading;
    _rideOpts.len = num(spec.loa, 6);
    _rideOpts.beam = num(spec.beam, 2);
    let r = null;
    if (typeof CBZ.waterRideAt === "function") {
      try { r = CBZ.waterRideAt(rec.pos.x, rec.pos.z, _rideOpts, _ride); } catch (e) { r = null; }
    }
    const baseY = r ? num(r.y, seaY(rec.pos.x, rec.pos.z)) : seaY(rec.pos.x, rec.pos.z);
    let pitch = (r ? num(r.pitch, 0) : 0) + num(rec._pitch, 0);
    let roll = (r ? num(r.roll, 0) : 0) + num(rec._roll, 0);
    let y = baseY + num(spec.rideAbove, 0.06) * (1 - 0.55 * clamp(num(rec._planing, 0), 0, 1));

    // Extra roll and ride drop from the stability owner (water_stability.js),
    // feature-detected: without it §5's own small heel model is the answer.
    if (typeof CBZ.hullStabTick === "function") {
      try { CBZ.hullStabTick(rec, dt); } catch (e) {}
    }
    if (typeof CBZ.hullStabRoll === "function") {
      try { roll += num(CBZ.hullStabRoll(rec), 0); } catch (e) {}
    } else {
      roll += num(rec._heel, 0);
    }
    if (typeof CBZ.hullStabDrop === "function") {
      try { y -= num(CBZ.hullStabDrop(rec), 0); } catch (e) {}
    } else if (rec._capsized) {
      const st = stabOf(spec);
      y -= num(st.freeboard, 0.4) + num(spec.draft, 0.4) * 0.3;
    }

    rec.group.position.set(rec.pos.x, y, rec.pos.z);
    _e.set(pitch, rec.heading, roll, "YXZ");
    rec.group.quaternion.setFromEuler(_e);

    if (typeof CBZ.waterWakeFor === "function" && !rec._capsized && Math.abs(rec.v) > 0.4) {
      try { CBZ.waterWakeFor(rec, dt); } catch (e) {}
    }
  }

  function seatCrew(rec, dt) {
    for (let i = 0; i < rec.crew.length; i++) {
      const b = rec.crew[i];
      if (!b || b.dead || b._aboard !== rec) { rec.crew.splice(i--, 1); continue; }
      const seat = rec._seats[num(b._aboardSeat, i)] || rec._seats[0];
      if (!seat) continue;
      seatWorld(rec, seat, _tmpV);
      b.pos.x = _tmpV.x; b.pos.y = _tmpV.y; b.pos.z = _tmpV.z;
      if (b.group) b.group.rotation.y = rec.heading + num(seat.yaw, 0);
      if (b.target && b.target.set) b.target.set(_tmpV.x, 0, _tmpV.z);
      b.speed = 0;
      b.swim = false;
      // A seated body is posed by character.js's chair pose; the bot's own
      // mover is skipped while `_aboard` is set (entities/survivorbot.js), so
      // this is the ONE writer of that rig for the frame.
      if (b.char) {
        b.char.sitting = true;
        if (typeof CBZ.animChar === "function") { try { CBZ.animChar(b.char, 0, dt); } catch (e) {} }
      }
    }
  }

  function releaseCrew(rec, overboard) {
    for (let i = 0; i < rec.crew.length; i++) {
      const b = rec.crew[i];
      if (!b) continue;
      b._aboard = null; b._aboardSeat = null;
      if (b.char) b.char.sitting = false;
      if (b.pause != null) b.pause = 0;
      if (!overboard) continue;
    }
    rec.crew.length = 0;
  }

  /* CBZ.hullOccupantsOverboard(rec) — everyone in the water beside the hull,
     hurt but ALIVE and bleeding. That is marine_predation.js's own philosophy
     for a bitten boat (throwOccupants:1265) and it is load-bearing: the men in
     the water are what brings the rest of the sharks (§7 chum). */
  CBZ.hullOccupantsOverboard = function (rec) {
    if (!rec) return 0;
    if (!rec._seaCraft) {
      // a cityCars boat — marine_predation owns those bodies
      if (typeof CBZ.marineThrowOccupants === "function") {
        const p = rec.pos || (rec.group && rec.group.position);
        if (p) {
          const h = num(rec.heading, 0);
          try { CBZ.marineThrowOccupants(rec, p.x, p.z, Math.cos(h), Math.sin(h)); } catch (e) {}
        }
      }
      return 0;
    }
    const spec = rec._hullSpec, st = stabOf(spec);
    const beam = num(spec.beam, 2);
    // over the LOW rail: the side the hull is heeled toward
    const side = (num(rec._heel, 0) || (typeof CBZ.hullStabRoll === "function" ? num(CBZ.hullStabRoll(rec), 0) : 0)) >= 0 ? 1 : -1;
    const c = Math.cos(rec.heading), s = Math.sin(rec.heading);
    let n = 0;
    const list = rec.crew.slice();
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (!b || b.dead) continue;
      const off = beam * 0.5 + 1.5 + h01(i * 3.1, rec.pos.x) * 1.5;
      const along = (h01(i * 7.7, rec.pos.z) - 0.5) * num(spec.loa, 6) * 0.6;
      // hull-local: +z is the bow, +x is starboard
      const wx = rec.pos.x + s * along + c * (side * off);
      const wz = rec.pos.z + c * along - s * (side * off);
      b._aboard = null; b._aboardSeat = null;
      if (b.char) b.char.sitting = false;
      b.pos.x = wx; b.pos.z = wz;
      b.pos.y = seaY(wx, wz) - 1.0;
      if (b.target && b.target.set) b.target.set(wx, 0, wz);
      b.pause = 0;
      b.swim = true;
      b.panicT = 3.5;
      const mx = num(b.maxHp, 100);
      const to = mx * (0.20 + h01(i * 11.3, rec.pos.x + rec.pos.z) * 0.20);
      if (b.hp == null || b.hp > to) b.hp = Math.round(to);
      if (typeof CBZ.marineBleed === "function") { try { CBZ.marineBleed(b, 0.5); } catch (e) {} }
      splash(wx, wz, 1.2);
      n++;
    }
    rec.crew.length = 0;
    AUDIT.overboard += n;
    if (st && st.swampT) rec._swamp = Math.max(rec._swamp, 0);
    return n;
  };

  // ============================================================
  //  §4. THE RULES — who can do what to which hull
  // ============================================================
  const ENGULF_MAX = 0.62;          // wildlife_tame.js's own number, for a hull
  function specOfRec(rec) {
    if (!rec) return null;
    if (rec._hullSpec) return rec._hullSpec;
    const R = MH();
    if (R && R.specFor) { try { return R.specFor(rec); } catch (e) {} }
    return null;
  }
  function lenOf(a) {
    if (typeof CBZ.marineBodyLen === "function") { try { return +CBZ.marineBodyLen(a) || 0; } catch (e) {} }
    return 0;
  }
  function gapeOf(a) {
    if (typeof CBZ.marineGape === "function") { try { return +CBZ.marineGape(a) || 0; } catch (e) {} }
    return lenOf(a) * 0.19;
  }
  function tonnesOf(a) {
    if (typeof CBZ.marineTonnes === "function") { try { return +CBZ.marineTonnes(a) || 0; } catch (e) {} }
    const L = lenOf(a);
    return 0.014 * Math.pow(Math.max(0.1, L), 2.8);
  }

  /* A THIRD TERM THE FISH RULE NEVER NEEDED: MASS. Length and beam alone said
     a 6 m great white could swallow a 3.3 m jetski whole but not a 4.2 m sea
     kayak — the kayak is longer and weighs 25 kg, the PWC is stubby and weighs
     350. A fish that fits is a fish you can take; a machine that fits is still
     a machine, and you cannot swallow a fifth of your own displacement. 0.12
     of the animal's own tonnage is the line, and it is what puts the jetski
     back where it belongs (bitten, not eaten) without a single boat name. */
  const ENGULF_MASS = 0.12;
  CBZ.sharkCanEngulfHull = function (a, rec) {
    const s = specOfRec(rec);
    if (!a || !s || !rec || rec.dead) return false;
    const L = lenOf(a);
    if (!(L > 0) || !(s.loa > 0)) return false;
    if (s.loa > L * ENGULF_MAX) return false;
    if (gapeOf(a) < num(s.beam, 2) * 0.8) return false;
    return num(s.massT, 1) <= tonnesOf(a) * ENGULF_MASS;
  };
  CBZ.sharkCanBiteHull = function (a, rec) {
    const s = specOfRec(rec);
    if (!a || !s || !rec || rec.dead) return false;
    if (typeof CBZ.marineBiteableHull === "function") {
      try { return !!CBZ.marineBiteableHull(a, rec); } catch (e) {}
    }
    return gapeOf(a) >= num(s.beam, 2) && num(s.massT, 1) <= tonnesOf(a) * 1.4;
  };

  /* THE TIP. One moment, two callers (the mounted player shark and every wild
     one), and the physics decides — see the header for the measured table. */
  /* RAM_K IS THE ONE TUNED NUMBER IN THIS FILE and it was solved against the
     authored fleet, not guessed: at 0.7 a 2.1 t great white at 8 m/s puts 12.4
     kN.m into a speedboat whose righting moment is 13.4 — she rolls to the
     rail and comes back, which is the "two or three passes" a boat that size
     should survive — while the same animal puts 11.2 into a skiff that rights
     with 1.5 and rolls it on the first hit. A 0.16 t bull shark at 6 m/s still
     clears a kayak's 0.03 twelve times over. Nothing else in the model is
     tuned; every other number is a dimension off the hull registry. */
  const RAM_K = 0.7;
  CBZ.sharkRamHull = function (a, rec, o) {
    o = o || {};
    const s = specOfRec(rec);
    if (!a || !rec || !s || rec.dead) return 0;
    if (rec._ramCd > 0) return 0;
    rec._ramCd = 0.35;
    const p = rec.pos || (rec.group && rec.group.position);
    const ap = a.pos || (a.group && a.group.position);
    if (!p || !ap) return 0;
    const beam = num(s.beam, 2);
    // CLOSING SPEED, not the animal's cruise: a shark that drifts into a hull
    // does nothing to it. Read off whatever velocity the caller's animal
    // carries, floored so a lunge that has already landed still counts.
    let closing = num(o.speed, 0);
    if (!(closing > 0)) {
      const sh = a._shark || null;
      closing = num(a.speed, 0) || num(sh && sh.v, 0) || num(a._waterMove && a._waterMove.v, 0) || 4;
    }
    closing = clamp(closing, 1.5, 16);
    const under = o.from === "under";
    const moment = tonnesOf(a) * closing * (beam * 0.5) * RAM_K * (under ? 1.35 : 1);
    // WHICH WAY IT GOES OVER: the side the animal is on. A hull hit from
    // starboard heels to port, and one lifted from below rolls away from the
    // animal's own bearing.
    const dx = p.x - ap.x, dz = p.z - ap.z;
    const c = Math.cos(rec.heading), sn = Math.sin(rec.heading);
    const lateral = dx * c - dz * sn;         // +x is starboard in hull frame
    const sign = lateral >= 0 ? 1 : -1;

    let phi = 0;
    if (typeof CBZ.hullHeelImpulse === "function") {
      try { phi = num(CBZ.hullHeelImpulse(rec, moment * sign, { from: o.from || "ram", x: num(o.x, ap.x), z: num(o.z, ap.z) }), 0); } catch (e) { phi = 0; }
      if (typeof CBZ.hullCapsized === "function") {
        try { if (CBZ.hullCapsized(rec)) onCapsize(rec); } catch (e) {}
      }
    } else {
      phi = heelFallback(rec, moment * sign);
    }
    // the shove, the white water and the beat of lens. The push runs along the
    // contact line, i.e. away from the animal that just hit her.
    const m = Math.hypot(dx, dz) || 1;
    const push = clamp(moment / Math.max(1, num(s.massT, 1) * 9.81), 0, 6);
    rec.vx = num(rec.vx, 0) - (dx / m) * push;
    rec.vz = num(rec.vz, 0) - (dz / m) * push;
    rec.v = num(rec.v, 0) * 0.75;
    if (under) rec._lift = Math.max(num(rec._lift, 0), clamp(moment * 0.02, 0.2, 2.2));
    /* THE WHITE WATER IS THE SIZE OF THE THING THAT MADE IT. Scaled off the
       moment AND the hull, because a 4 m kayak rolling threw the same wall of
       spray as a megalodon hitting a cruiser and it hid the whole event. */
    splash(p.x, p.z, clamp(0.8 + moment * 0.006 + num(s.loa, 6) * 0.05, 0.8, 3.2));
    if (CBZ.shake && CBZ.player) {
      const d = Math.hypot(CBZ.player.pos.x - p.x, CBZ.player.pos.z - p.z);
      if (d < 60) { try { CBZ.shake(clamp(0.18 + moment * 0.004, 0.1, 0.5) * (1 - d / 60)); } catch (e) {} }
    }
    if (CBZ.sfx) { try { CBZ.sfx("hit", { volume: 0.5 }); } catch (e) {} }
    AUDIT.rams++;
    return phi;
  };

  // ---- §5. the fallback heel model (only when water_stability.js is absent)
  /* A hull is a spring: righting = displacement * gm * sin(phi) up to the
     angle of vanishing stability, and past it the sign flips and she goes.
     This is that one line integrated, nothing more, so the TIP is real in a
     build that does not have the stability file yet. When it IS there, none
     of this runs (see ride()). */
  function heelFallback(rec, moment) {
    const s = rec._hullSpec, st = stabOf(s);
    const disp = Math.max(0.02, num(s.massT, 1)) * 9.81;       // kN
    const gm = Math.max(0.02, num(st.gm, 0.5));
    const phiV = Math.max(0.3, num(st.phiV, 1.1));
    const maxRight = disp * gm * Math.sin(phiV);
    // the impulse arrives as angular velocity: I ~ disp*gm/omega^2, and the
    // natural roll period of a small hull is about 2 s, so omega ~ 3 rad/s
    const I = disp * gm / 9;
    rec._heelV = num(rec._heelV, 0) + (moment / Math.max(0.02, I)) * 0.12;
    if (Math.abs(moment) > maxRight) {
      // past the angle of vanishing stability on this one hit: she goes over
      rec._heel = Math.sign(moment) * Math.PI;
      rec._heelV = 0;
      onCapsize(rec);
      return rec._heel;
    }
    return num(rec._heel, 0);
  }
  function heelTick(rec, dt) {
    if (typeof CBZ.hullStabRoll === "function") return;     // B owns the roll
    if (rec._capsized) { rec._heel = Math.sign(rec._heel || 1) * Math.PI; rec._heelV = 0; return; }
    const s = rec._hullSpec, st = stabOf(s);
    const disp = Math.max(0.02, num(s.massT, 1)) * 9.81;
    const gm = Math.max(0.02, num(st.gm, 0.5));
    const phiV = Math.max(0.3, num(st.phiV, 1.1));
    const I = disp * gm / 9;
    const phi = num(rec._heel, 0);
    const right = -disp * gm * Math.sin(phi) * (Math.abs(phi) < phiV ? 1 : -1.2);
    rec._heelV = num(rec._heelV, 0) + (right / I) * dt - num(rec._heelV, 0) * Math.min(1, dt * 1.6);
    rec._heel = phi + rec._heelV * dt;
    if (Math.abs(rec._heel) > phiV * 1.35) { rec._heel = Math.sign(rec._heel) * Math.PI; onCapsize(rec); }
  }

  function onCapsize(rec) {
    if (rec._capsized) return;
    rec._capsized = true;
    rec.engineDead = true;
    rec.v = 0; rec._planing = 0;
    rec.anchored = false; rec.route = null;
    AUDIT.tipped++;
    CBZ.hullOccupantsOverboard(rec);
    splash(rec.pos.x, rec.pos.z, clamp(0.9 + num(rec._hullSpec && rec._hullSpec.loa, 6) * 0.14, 0.9, 3.2));
  }
  CBZ.seaCraftCapsize = onCapsize;      // the storyboard and the tests stage it

  // ============================================================
  //  §6. DAMAGE — a chunk out of the hull, and going down
  // ============================================================
  const _box3 = new THREE.Box3();
  const _shedBox = { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };

  /* CBZ.seaCraft.hurt(rec, dmg, {bite, point, normal, by})
     A bite takes MATERIAL: the piece is diced off the hull's own mesh with the
     hull's own material (cityShedSolid — "all debris comes off something"),
     the hole it left is a dark inset panel welded into the hull group so it
     rides with the boat, and the sea starts coming in. */
  function hurt(rec, dmg, o) {
    o = o || {};
    if (!rec || rec.dead) return false;
    rec.hp -= Math.max(0, num(dmg, 0));
    const spec = rec._hullSpec, st = stabOf(spec);
    if (o.bite) {
      AUDIT.bites++;
      const p = o.point || rec.pos;
      const nx = num(o.normal && o.normal.x, Math.cos(rec.heading));
      const nz = num(o.normal && o.normal.z, Math.sin(rec.heading));
      const mesh = rec._hullMesh || (rec._hullMesh = hullMeshOf(rec.group));
      const beam = num(spec.beam, 2), fb = num(st.freeboard, 0.5);
      const along = clamp(num(spec.loa, 6) * 0.14, 0.6, 1.2);
      if (mesh && typeof CBZ.cityShedSolid === "function") {
        try {
          rec.group.updateMatrixWorld(true);
          _box3.setFromObject(mesh);
          const half = Math.max(beam * 0.5, along * 0.5);
          _shedBox.minX = Math.max(_box3.min.x, p.x - half);
          _shedBox.maxX = Math.min(_box3.max.x, p.x + half);
          _shedBox.minZ = Math.max(_box3.min.z, p.z - half);
          _shedBox.maxZ = Math.min(_box3.max.z, p.z + half);
          _shedBox.minY = Math.max(_box3.min.y, seaY(p.x, p.z) - num(spec.draft, 0.4) * 0.4);
          _shedBox.maxY = Math.min(_box3.max.y, seaY(p.x, p.z) + fb + 0.15);
          if (_shedBox.maxX > _shedBox.minX && _shedBox.maxY > _shedBox.minY && _shedBox.maxZ > _shedBox.minZ) {
            const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
            CBZ.cityShedSolid(_shedBox, mat, { nx: nx, nz: nz, power: 1.6, budget: 24, rim: 0.4 });
          }
        } catch (e) {}
      }
      addBiteHole(rec, p, along, fb, beam);
      if (typeof CBZ.cityEjectaCone === "function") {
        try { CBZ.cityEjectaCone(p.x, seaY(p.x, p.z) + 0.5, p.z, nx, nz, 1.5, { spread: 0.9 }); } catch (e) {}
      }
      splash(p.x, p.z, 2.0);
      if (!rec._holed) { rec._holed = true; AUDIT.holed++; }
      // the sea comes in. swampT is the seconds of green water this hull can
      // take; a hole spends half of it at once.
      const add = num(st.swampT, 10) * 0.5;
      if (typeof CBZ.hullSwampAdd === "function") { try { CBZ.hullSwampAdd(rec, add); } catch (e) {} }
      rec._swamp = num(rec._swamp, 0) + add;
      if (typeof CBZ.marineFrenzyAt === "function") {
        try { CBZ.marineFrenzyAt(p.x, p.z, { boil: true, seconds: 30, press: 0.8 }); } catch (e) {}
      }
      CBZ.hullOccupantsOverboard(rec);
    }
    if (rec.hp <= 0 || o.flood) sink(rec);
    return true;
  }

  /* THE HOLE. r128 has no CSG, so the honest cheap answer is not to pretend a
     mesh was cut: a jagged dark inset panel, welded into the hull's own group
     at the bite point, reads as the inside of a boat you can now see. It rides
     with the hull because it is a child of it. */
  let _holeMat = null;
  function holeMat() {
    if (!_holeMat) {
      _holeMat = new THREE.MeshLambertMaterial({ color: 0x14181c, emissive: 0x05070a, emissiveIntensity: 0.4, side: THREE.DoubleSide });
      _holeMat._shared = true;
    }
    return _holeMat;
  }
  function addBiteHole(rec, p, along, fb, beam) {
    try {
      rec.group.updateMatrixWorld(true);
      const g = new THREE.BoxGeometry(Math.max(0.25, beam * 0.62), Math.max(0.25, fb * 1.15), Math.max(0.4, along));
      const m = new THREE.Mesh(g, holeMat());
      _tmpV2.set(p.x, seaY(p.x, p.z) + fb * 0.35, p.z);
      rec.group.worldToLocal(_tmpV2);
      m.position.copy(_tmpV2);
      // ragged: a small deterministic tilt so two bites never line up
      const j = h01(p.x, p.z);
      m.rotation.set((j - 0.5) * 0.5, (h01(p.z, p.x) - 0.5) * 0.6, (j - 0.5) * 0.4);
      m.castShadow = false;
      rec.group.add(m);
      rec._holes = (rec._holes || 0) + 1;
    } catch (e) {}
  }

  /* SHE GOES DOWN. Not a delete: the crew go over the side, the engine is
     gutted, and water_float.js's own flooding model takes the hull to the
     seabed with a real arc — the same owner that already sinks a drowned car
     and a corpse. */
  function sink(rec) {
    if (!rec || rec._sinking) return;
    rec._sinking = true;
    rec.engineDead = true;
    rec.v = 0; rec.vx = 0; rec.vz = 0;
    rec.route = null; rec.anchored = false;
    rec.dead = true;                        // the ENGINE is dead; the hull still floats
    AUDIT.sunk++;
    CBZ.hullOccupantsOverboard(rec);
    splash(rec.pos.x, rec.pos.z, 2.4);
    const spec = rec._hullSpec, st = stabOf(spec);
    if (typeof CBZ.waterFloat === "function") {
      const swampT = Math.max(1.5, num(st.swampT, 10) * 0.5);
      rec._floatH = CBZ.waterFloat(rec, {
        len: num(spec.loa, 6), beam: num(spec.beam, 2),
        buoy: 1, waterlog: 1 / swampT, keepDead: true,
        sinkPitch: (h01(rec.pos.x, rec.pos.z) < 0.5 ? -1 : 1) * 0.5,
        heading: function () { return rec.heading; },
        kind: "boat",
        onSettle: function () { despawn(rec); },
      });
    }
    rec._sinkT = 60;
  }

  // ============================================================
  //  §7. THE BOAT GOES IN THE MOUTH
  // ============================================================
  /* engulf(rec, eater) — the whole craft is drawn to the tooth ring over about
     half a second and then it is gone, its people killed through the SAME bus
     the mount's own survivor bite uses (so the killfeed and the mass ledger
     stay honest) and its own tonnage credited as a meal. */
  function engulf(rec, eater) {
    if (!rec || rec.dead || !eater || rec._engulf) return false;
    rec._engulf = { by: eater, t: 0, dur: 0.5 };
    rec.engineDead = true; rec.route = null; rec.anchored = false;
    rec.v = 0;
    return true;
  }

  function jawOf(a) {
    if (typeof CBZ.creatureJawWorld === "function") {
      try { return CBZ.creatureJawWorld(a); } catch (e) {}
    }
    const p = a && (a.pos || (a.group && a.group.position));
    if (!p) return null;
    const h = num(a.heading, 0);
    const L = lenOf(a) * 0.45;
    return { x: p.x + Math.cos(h) * L, y: p.y, z: p.z + Math.sin(h) * L };
  }

  function engulfTick(rec, dt) {
    const E = rec._engulf;
    const a = E.by;
    if (!a || a.dead) { rec._engulf = null; return; }
    E.t += dt;
    const J = jawOf(a);
    if (J) {
      const k = 1 - Math.exp(-dt * (6 + 20 * (E.t / E.dur)));
      rec.pos.x += (J.x - rec.pos.x) * k;
      rec.pos.z += (J.z - rec.pos.z) * k;
      rec._pullY = num(rec._pullY, rec.group.position.y);
      rec._pullY += (J.y - rec._pullY) * k;
      rec.group.position.set(rec.pos.x, rec._pullY, rec.pos.z);
      rec.heading = num(a.heading, rec.heading);
      _e.set(0.4 * (E.t / E.dur), rec.heading, num(rec._heel, 0), "YXZ");
      rec.group.quaternion.setFromEuler(_e);
      // the crew ride it into the mouth
      seatCrew(rec, dt);
    }
    if (E.t < E.dur) return;
    swallow(rec, a);
  }

  function swallow(rec, a) {
    const spec = rec._hullSpec;
    const loa = num(spec.loa, 6);
    const crewN = rec.crew.length;
    const name = (a.species && String(a.species.name || a.species.id).toLowerCase()) || "shark";
    // the people aboard, through the mode's own kill bus
    for (let i = 0; i < rec.crew.length; i++) {
      const b = rec.crew[i];
      if (!b || b.dead) continue;
      b._aboard = null;
      if (b.char) b.char.sitting = false;
      if (CBZ.surv && typeof CBZ.surv.hurt === "function" && CBZ.bots && CBZ.bots.indexOf(b) >= 0) {
        try {
          CBZ.surv.hurt(b, 9999, {
            fromX: a.pos.x, fromZ: a.pos.z, force: 6, fling: 3,
            cause: "eaten by a " + name, by: a, lens: false,
          });
        } catch (e) { b.dead = true; }
      } else if (typeof CBZ.cityKillPed === "function") {
        try { CBZ.cityKillPed(b, { fromX: a.pos.x, fromZ: a.pos.z, force: 6, byPlayer: true, by: a }, "eaten by a " + name); } catch (e) { b.dead = true; }
      } else b.dead = true;
    }
    rec.crew.length = 0;
    splash(rec.pos.x, rec.pos.z, 3.0);
    // the meal is billed BEFORE the record leaves the world, and it is billed
    // dead — the ladder refuses a chomp that did not kill (shark_sim.js).
    rec.dead = true;
    rec._engulf = null;
    AUDIT.eaten++;
    if (loa > AUDIT.biggestEatenM) AUDIT.biggestEatenM = +loa.toFixed(1);
    const isPlayer = !!(CBZ.cityMountedAnimal && CBZ.cityMountedAnimal() === a);
    if (typeof CBZ.wildlifeCreditMeal === "function") {
      try { CBZ.wildlifeCreditMeal(a, rec, "craft", { player: isPlayer }); } catch (e) {}
    }
    if (typeof CBZ.sharkSimBite === "function") {
      try { CBZ.sharkSimBite("craft", rec, a); } catch (e) {}
    }
    despawn(rec);
  }

  // ============================================================
  //  §8. THE TICK. Order 37.9 — before water_buoyancy's own pass (38.5, which
  //  only ever walks cityCars) and before the stability post-pass (38.7).
  // ============================================================
  CBZ.onUpdate(37.9, function (dt) {
    if (!craft.length) return;
    dt = clamp(num(dt, 0.016), 0.001, 0.05);
    for (let i = craft.length - 1; i >= 0; i--) {
      const rec = craft[i];
      if (!rec || !rec.group || !rec.group.parent) { craft.splice(i, 1); continue; }
      if (rec._ramCd > 0) rec._ramCd -= dt;

      if (rec._engulf) { engulfTick(rec, dt); continue; }
      if (rec._sinking) {
        // water_float owns the transform from here; we only time it out so a
        // wreck that drifted onto dry land still leaves.
        rec._sinkT -= dt;
        if (rec._sinkT <= 0) despawn(rec);
        continue;
      }

      if (rec._capsized) moveDrifting(rec, dt);
      else if (rec.engineDead) moveDrifting(rec, dt);
      else if (rec.anchored) moveAnchored(rec, dt);
      else if (rec.route) moveCruising(rec, dt);
      else moveDrifting(rec, dt);

      heelTick(rec, dt);
      /* WATER COMES IN THROUGH A HOLE, NOT THROUGH A CAPSIZE. A hull with a
         bite out of it founders on its own class's timetable (swampT is the
         seconds of green water it can take, so a 5.5 m open skiff has minutes
         less of it than a trawler); a hull merely turned over floats INVERTED
         the way a real one does — the air is trapped under it — and is
         abandoned wreckage rather than a boat that sinks because it rolled. */
      if (rec._holed) rec._swamp = num(rec._swamp, 0) + dt * 0.35;
      if (rec._capsized) {
        rec._wreckT = num(rec._wreckT, 0) + dt;
        if (rec._wreckT > 90) { despawn(rec); continue; }   // and the fleet restocks it
      }
      /* SHE MAY GO OVER A BEAT AFTER THE HIT. water_stability.js integrates a
         real roll, so a hull pushed past its angle of vanishing stability
         capsizes on some later frame, not inside the impulse call — this is
         where we notice, and it is the only place `tipped` is counted. */
      if (!rec._capsized && typeof CBZ.hullCapsized === "function" && CBZ.hullCapsized(rec)) onCapsize(rec);
      if (rec._swamp > 0 && rec._swamp >= num(stabOf(rec._hullSpec).swampT, 10)) { sink(rec); continue; }

      ride(rec, dt);
      if (rec.crew.length) seatCrew(rec, dt);
    }
  });

  // ============================================================
  //  §9. THE SEAM
  // ============================================================
  CBZ.seaCraft = {
    spawn: spawn,
    list: function () { return craft; },
    despawn: despawn,
    despawnAll: despawnAll,
    hurt: hurt,
    sink: sink,
    engulf: engulf,
    capsize: onCapsize,
    spec: specOfRec,
    stab: stabOf,
    audit: function () {
      let alive = 0, crewed = 0;
      for (let i = 0; i < craft.length; i++) {
        if (craft[i].dead || craft[i]._sinking) continue;
        alive++; crewed += craft[i].crew.length;
      }
      return {
        craft: alive, aboard: crewed,
        spawned: AUDIT.spawned, eaten: AUDIT.eaten, tipped: AUDIT.tipped,
        sunk: AUDIT.sunk, holed: AUDIT.holed, overboard: AUDIT.overboard,
        rams: AUDIT.rams, bites: AUDIT.bites,
        biggestEatenM: AUDIT.biggestEatenM,
      };
    },
    reset: function () {
      despawnAll();
      AUDIT.spawned = AUDIT.eaten = AUDIT.tipped = AUDIT.sunk = 0;
      AUDIT.holed = AUDIT.overboard = AUDIT.rams = AUDIT.bites = 0;
      AUDIT.biggestEatenM = 0;
    },
  };
})();
