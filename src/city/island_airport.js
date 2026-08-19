/* ============================================================
   city/island_airport.js — THE AIRPORT ISLAND (archipelago landmass).

   WHY (owner's #1 law — every object earns its place): a real city has
   a way OUT. The mainland's north edge faces open sea, and there was
   nothing on it but water. This island answers "where do you fly from?"
   — a working international airport reached by a single causeway you can
   drive across. The runway is the long flat dragstrip you can floor a
   stolen car down; the terminal is a real enterable concourse (check-in,
   gate seating) full of passengers with luggage worth lifting; the apron
   is parked airliners and private jets (cover, climb-on vantage, a
   pushback in motion); the tower watches it all from a glass cab. The
   perimeter fence is the WHY you can't just drive into the sea — there's
   one road on and off, the causeway, exactly like a real island airfield.

   CABIN LIFE (2026-07-27, owner's two bugs): the airliner cabin is a ROOM
   with ordinary game NPCs in it, not a diorama. Seats are authored in REAL
   metres (0.79 m pitch, 0.44 m width, 0.43 m cushion — see SEAT/R() below)
   instead of in AIRLINER_SCALE units, so the furniture fits the 1.8 m people
   rather than the 1.45x hull; the seat's plane-local facing is re-asserted
   every frame by cabinPassengerHold() instead of being a one-shot write ~40
   world-space yaw writers could stomp; the gate lounge is real benches with
   real propuse SEAT anchors; and every person this island places carries the
   job they actually do. CBZ.cabinAudit() is the ratchet
   ({seats, occupied, misaligned, roleless} — the last two pin at ZERO).

   DRAW-CALL DISCIPLINE (engine is draw-call bound): the runway/taxiway
   edge lights are ONE InstancedMesh; the gate lounge is FOUR (cushions,
   backs, armrests, beams); the perimeter fence posts are ONE; ground
   markings are merged via BufferGeometryUtils into a handful of meshes;
   every repeated colour comes from the shared CBZ.mat/cmat pool. Parked
   aircraft share materials across the fleet. Deterministic seeded rng so
   the field is identical every run.

   FOOTPRINT: rect centre (-40,-120), half (330,160)
     → minX=-370 maxX=290 minZ=-280 maxZ=40   (region 'airport')
   CAUSEWAY: rect minX=-7 maxX=7 minZ=-566 maxZ=-280  (region 'airport-causeway')
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const mat = CBZ.mat;
  const cmat = CBZ.cmat || CBZ.mat;
  // One unit is one metre. The airliner follows the published A320 envelope;
  // business-jet values describe the actual low-poly model below. Keeping the
  // dimensions on the group gives boarding, collision, flight and audit code a
  // single source of truth instead of five unrelated footprint literals.
  const AIRCRAFT_DIMS = Object.freeze({
    airliner: Object.freeze({ family: "A320-class", length: 37.57, span: 35.80, height: 11.76, fuselage: 3.95 }),
    privatejet: Object.freeze({ family: "business-jet", length: 21.50, span: 13.50, height: 6.35, fuselage: 2.00 }),
  });
  CBZ.CITY_AIRCRAFT_DIMS = AIRCRAFT_DIMS;

  // AIRLINER up-scale — ONE factor every derived airliner coordinate follows
  // (owner: "make the plane a bit bigger"). It bakes into the airliner geometry
  // (via a scale-wrapping part kit), the cabin/cockpit walkable boxes, the seat
  // anchors, the boarding door-arc waypoints (stashed on cab.scale) and the
  // external-facing dims copy on the group — so flight collision, hijack reach
  // and targeting all track without touching the frozen AIRCRAFT_DIMS envelope.
  // CBZ.CONFIG.AIRLINER_SCALE = 1.0 reverts to the original size.
  const AL_SC = (function () {
    const v = CBZ.CONFIG && +CBZ.CONFIG.AIRLINER_SCALE;
    return v > 0 ? v : 1;
  })();

  // ---- CABIN LIFE V2 flags ---------------------------------------------------
  // config.js parses first and applies ?cfg_X=… overrides before this file runs,
  // so a `== null` default here is still URL-flippable (aim_dossier.js does the
  // same). They belong in config.js proper; that file is not this agent's to
  // edit, so they self-default at the point of use.
  CBZ.CONFIG = CBZ.CONFIG || {};
  // CABIN_SEATED_V2 — the per-frame seat HOLD. A passenger's facing used to be a
  // ONE-SHOT write (npclife.attach → group.rotation.set) into a field ~40 other
  // systems write in WORLD space; on → the airport re-asserts each occupied
  // seat's plane-LOCAL transform every frame, after those systems have run.
  if (CBZ.CONFIG.CABIN_SEATED_V2 == null) CBZ.CONFIG.CABIN_SEATED_V2 = true;
  // CABIN_REAL_SEATS — cabin furniture authored in REAL metres (31" pitch, 17.5"
  // width, 0.43 m cushion) instead of in AIRLINER_SCALE units. Off → the legacy
  // 1.4-unit-pitch bench rows that grew 45% with the hull while the people did not.
  if (CBZ.CONFIG.CABIN_REAL_SEATS == null) CBZ.CONFIG.CABIN_REAL_SEATS = true;
  // AIRPORT_STAFF_ROLES — every person this island places carries the job they
  // actually do, and the flight deck/cabin crew get theirs stamped on the body
  // npclife cast into the seat.
  if (CBZ.CONFIG.AIRPORT_STAFF_ROLES == null) CBZ.CONFIG.AIRPORT_STAFF_ROLES = true;
  // TERMINAL_GATE_SEATS — the concourse gate benches are SITTABLE: each seat
  // registers a propuse SEAT anchor with a declared cushion, and a handful of
  // travellers are seated on them. Off → the benches are still drawn at real
  // furniture dimensions (that part is not a behaviour change and stays), but
  // nothing registers and nobody sits — the pre-change state where the gate
  // lounge was scenery. One line, no second code path.
  if (CBZ.CONFIG.TERMINAL_GATE_SEATS == null) CBZ.CONFIG.TERMINAL_GATE_SEATS = true;

  // ONE REAL METRE, expressed in the units the airliner part-kit expects.
  //
  // WHY THIS EXISTS: `K.put()` inside buildAirliner multiplies every coordinate
  // AND scales every geometry by AL_SC (CBZ.CONFIG.AIRLINER_SCALE, 1.45 today).
  // That is exactly right for the HULL — the owner's dial is meant to grow the
  // aeroplane. It is exactly WRONG for anything a 1.8 m human sits in: at 1.45
  // the old seat rows were a 2.03 m pitch with a 0.65 m cushion, i.e. bar stools
  // two metres apart, which is what made the cabin read as a scale model with
  // dolls in it. R(m) converts a published real-world dimension into the
  // authoring unit K.put wants, so the seats stay human-sized at any AIRLINER_SCALE
  // and the surplus tube width simply becomes a wider aisle.
  // CABIN_REAL_SEATS=false is the one-line revert: R() becomes the identity, so
  // every cabin dimension below is read as a HULL unit again and the furniture
  // grows with AIRLINER_SCALE exactly as it used to. (It restores the old
  // BEHAVIOUR — furniture tied to the hull dial — not the old bench layout,
  // which is gone on purpose.)
  function R(m) { return (CBZ.CONFIG.CABIN_REAL_SEATS === false) ? m : m / AL_SC; }
  // …and the WORLD-METRE size R(m) actually produced. The rig's chair solve
  // (entities/character.js) reads cushion heights in world metres, so a seat
  // must DECLARE Rm(h), not h: with the flag on that is h exactly, with it off
  // it is h·AIRLINER_SCALE — which keeps the declaration honest in both modes
  // instead of quietly lying to the pose in one of them.
  function Rm(m) { return R(m) * AL_SC; }

  // Published economy-cabin geometry (all metres). Seat pitch and width are the
  // 31"/17.5" narrowbody standard; the cushion/back/armrest heights are the
  // furniture-metric numbers propuse.js's SEAT_H table is built from.
  const SEAT = Object.freeze({
    pitch: 0.79,        // front-to-back between rows (31 in)
    width: 0.44,        // per-seat width across the cabin (17.5 in)
    cushionY: 0.43,     // cushion TOP above the cabin floor
    cushionT: 0.10,     // cushion slab thickness
    cushionD: 0.48,     // cushion depth, fore-aft
    backH: 0.55,        // seat back height above the cushion
    backT: 0.09,
    armY: 0.18,         // armrest height above the cushion
    aisleMin: 0.48,     // narrowbody centre aisle
    abreast: 3,         // 3-3
    recline: 0.14,      // radians the back leans aft
  });
  // The cushion height the seat is DRAWN at and the body is POSED against —
  // ONE number, resolved at BUILD time from propuse.js's SEAT_H table (the
  // kit's source of truth for "how high is a seat of this kind"). Resolved
  // late on purpose: propuse.js parses AFTER this file, so a parse-time read
  // would always miss and silently fork the number in two. Degrade-safe: no
  // propuse, no problem — SEAT.cushionY is the same published value.
  function seatCushion() {
    const h = CBZ.propSeatHeight ? +CBZ.propSeatHeight("aircraft-seat") : 0;
    return h > 0 ? h : SEAT.cushionY;
  }

  // Real passenger hookup. Aircraft geometry only owns seats and cabin bounds;
  // actual people are ordinary live NPCs supplied by the shared life system.
  // Keeping this as a registry (rather than baking voxel bodies into each
  // model) lets one NPC implementation populate every present/future cabin.
  const passengerCabins = CBZ.aircraftPassengerCabins || (CBZ.aircraftPassengerCabins = []);
  const passengerCabinListeners = new Set();
  CBZ.onAircraftPassengerCabinState = function (fn) {
    if (typeof fn !== "function") return function () {};
    passengerCabinListeners.add(fn);
    return function () { passengerCabinListeners.delete(fn); };
  };
  function emitPassengerCabin(type, cabin, rec) {
    passengerCabinListeners.forEach(function (fn) {
      try { fn({ type, cabin: cabin || null, rec: rec || (cabin && cabin.rec) || null }); } catch (e) {}
    });
  }
  function resetPassengerCabins() {
    let changed = false;
    for (let i = passengerCabins.length - 1; i >= 0; i--) {
      const cab = passengerCabins[i];
      if (!cab || cab.provider !== "airport") continue;
      cab.active = false;
      passengerCabins.splice(i, 1);
      changed = true;
    }
    if (changed) emitPassengerCabin("reset", null, null);
  }

  // ---- deterministic LCG: same airfield every run ----
  // seeded from CBZ.WORLD_SEED via the named-stream registry (core/seed.js)
  // — one world-seed knob instead of a per-file magic literal. rng() is
  // re-armed at build entry so a rebuild replays the identical stream.
  let rng = null;
  function armRng() { rng = CBZ.seedStream ? CBZ.seedStream('airport') : (function () { let s = 0x51A1A0; return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; })(); }
  armRng();

  // ---- boardable capture: the parked airliners + private jets register as
  // STEALABLE aircraft (kind 'plane') so the player can climb in and fly one off
  // the apron (#1 law: a parked jet you can only walk past is a dead prop). The
  // airport loads BEFORE militaryvehicles.js, so we DEFER the hand-off (onUpdate
  // 55.1, after worldgen) and run it ONCE. The mid-pushback airliner is left out —
  // it's scripted by its own loop and boarding it would fight that animation.
  const placed = [];
  let _reg = false;
  // Terminal gate-lounge SEAT anchors this island registered with propuse.js,
  // kept so the deferred sitting pass finds them without a world-wide
  // propNearestSeat scan over every chair in the city.
  const gateSeats = [];
  let gateSeated = false;
  /* AIRPORT_ENTRY_V2 — the landside overhaul: the frontage fence opening +
     sea wall, the forecourt (gate, canopy, footway, lamps), the taxi rank and
     the tower's door/stairs/controller. One flag, one revert: off restores the
     unbroken perimeter run, the sealed tower collider and an empty kerb. */
  if (CBZ.CONFIG.AIRPORT_ENTRY_V2 == null) CBZ.CONFIG.AIRPORT_ENTRY_V2 = true;
  // the terminal taxi rank + the tower cab (AIRPORT_ENTRY_V2)
  const taxiRank = [];
  let rankDone = false;
  let towerDone = false;
  /* The tower's stair treads and cab floor are CBZ.platforms records. That
     array is created once in config.js and is never bulk-cleared on a world
     rebuild (govcomplex and arena_venue push to it too), so a builder that
     re-runs must reap its OWN — otherwise every rebuild leaves a ghost
     staircase standing in mid-air where the last one was. */
  const towerPlats = [];
  function towerPlatsClear() {
    const P = CBZ.platforms;
    if (P) for (let i = 0; i < towerPlats.length; i++) {
      const k = P.indexOf(towerPlats[i]);
      if (k >= 0) P.splice(k, 1);
    }
    towerPlats.length = 0;
  }
  /* A DRIVER'S SEAT INSIDE A PARKED CAR. The same crew-node trick airside.js
     uses on its service vehicles: one inverse-scaled child of the car group so
     the anchor is authored in real metres whatever the hull scale, marked
     dynamic so the static batcher never swallows a live rig. */
  function taxiSeatNode(car) {
    const grp = car && car.group;
    if (!grp) return null;
    if (grp.userData._rankSeat && grp.userData._rankSeat.parent === grp) return grp.userData._rankSeat;
    const n = new THREE.Group();
    const s = (grp.scale && grp.scale.x) || 1;
    n.scale.setScalar(s > 0.001 ? 1 / s : 1);
    n.name = "cabbie";
    n.userData.dynamic = true;
    grp.add(n);
    grp.userData._rankSeat = n;
    return n;
  }
  const GATE_SITTERS = 12;      // the rest of the lounge stays genuinely free
  function boardablePlane(grp, x, z, heading, footW, footL, name) {
    if (!grp) return grp;
    grp.userData.milKind = "plane";
    grp.userData.milName = name || "Aircraft";
    grp.userData.hijackable = true;
    const dims = grp.userData.aircraftDims || null;
    const rec = {
      group: grp, pos: grp.position, heading: heading || 0,
      kind: "plane", model: { name: name || "Aircraft" },
      // Civil airport aircraft are not military-jet stand-ins. The player-air
      // bridge reuses this exact parked group as the flyable so taking an
      // airliner visibly removes THAT airliner from its gate. Airport models
      // point down local +X while the shared flight model treats local +Z as
      // forward, hence the -90deg visual yaw offset.
      civilian: true,
      flightKind: (name === "Airliner") ? "airliner" : "privatejet",
      modelYawOffset: -Math.PI / 2,
      groundOffset: 0,
      collider: grp.userData.worldCollider || null,
      aircraftDims: dims,
      footW: dims ? dims.length : (footW || 18),
      footL: dims ? dims.span : (footL || 18),
      // Full span remains the interaction/flight footprint. Physical collision
      // is only the fuselage, so a wing no longer creates a giant invisible
      // wall while the body itself remains solid.
      colliderW: dims ? dims.length : (footW || 18),
      colliderL: dims ? Math.max(2.2, dims.fuselage + 0.45) : Math.min(5, footL || 5),
      // Parked civilian aircraft are ordinary damageable world objects. Their
      // HP lives on this same reusable record so gunfire, RPGs, boarding and
      // the flight hand-off never create parallel fake copies of the plane.
      maxHp: name === "Airliner" ? 420 : 250,
      hp: name === "Airliner" ? 420 : 250,
      taken: false, destroyed: false, hot: true,
    };
    placed.push(rec);
    const cab = grp.userData.cabin;
    if (rec.flightKind === "airliner" && cab) {
      const hook = {
        id: "airport-airliner-" + passengerCabins.length,
        provider: "airport", kind: "airliner", group: grp, rec,
        active: true, state: "parked", floorTop: cab.floorTop,
        bounds: { minX: -12.2 * AL_SC, maxX: 11.8 * AL_SC, minZ: -1.42 * AL_SC, maxZ: 1.42 * AL_SC },
        door: { x: cab.doorX, z: cab.doorZ },
        seats: cab.seats,
        passengerSeats: cab.seats.filter(function (seat) { return !!seat.reservedForNpc; }),
      };
      cab.passengerCabin = hook;
      passengerCabins.push(hook);
      emitPassengerCabin("registered", hook, rec);
    } else if (rec.flightKind === "privatejet" && cab && cab.seats && cab.seats.length) {
      // private jets carry live passengers too (visible through the new clear
      // cabin panes) — seats only, no walk-in boarding zone.
      const hook = {
        id: "airport-privatejet-" + passengerCabins.length,
        provider: "airport", kind: "privatejet", group: grp, rec,
        active: true, state: "parked", floorTop: cab.floorTop,
        door: { x: cab.doorX, z: cab.doorZ },
        seats: cab.seats,
        passengerSeats: cab.seats.filter(function (seat) { return !!seat.reservedForNpc; }),
      };
      cab.passengerCabin = hook;
      passengerCabins.push(hook);
      emitPassengerCabin("registered", hook, rec);
    }
    return grp;
  }

  // ============================================================
  //  CIVIL AIRCRAFT TARGETING / DAMAGE
  //
  //  The old gun path only knew about the police gunship. Parked passenger
  //  aircraft therefore swallowed no bullets and an RPG could paint a blast
  //  in empty space behind one. These APIs expose the SAME `placed` records
  //  used by boarding/flight. Narrow phase is an oriented FUSELAGE box — full
  //  wingspan is deliberately excluded, preserving the no-invisible-wing-wall
  //  rule for movement and weapons alike.
  // ============================================================
  function civilBodyBounds(rec) {
    const dims = rec && (rec.aircraftDims || (rec.group && rec.group.userData && rec.group.userData.aircraftDims));
    if (!dims) return null;
    const liner = rec.flightKind === "airliner";
    return {
      hx: Math.max(1, dims.length * 0.5),
      hz: Math.max(1.1, (dims.fuselage + 0.45) * 0.5),
      // Landing gear is not a span-wide target. This brackets the actual body
      // barrel (airliner CY=3.5/FH=3.95; private jet CY=2.1/FH=2.2). The
      // airliner band follows AL_SC so the up-scaled hull is fully bracketed.
      minY: liner ? 1.45 * AL_SC : 0.9,
      maxY: liner ? 5.55 * AL_SC : 3.25,
    };
  }

  function slabAxis(origin, dir, lo, hi, span) {
    if (Math.abs(dir) < 1e-8) return origin >= lo && origin <= hi;
    let a = (lo - origin) / dir, b = (hi - origin) / dir;
    if (a > b) { const q = a; a = b; b = q; }
    if (a > span.min) span.min = a;
    if (b < span.max) span.max = b;
    return span.min <= span.max;
  }

  const civilRaycaster = new THREE.Raycaster();
  const civilRayOrigin = new THREE.Vector3();
  const civilRayDirection = new THREE.Vector3();

  CBZ.cityCivilAircraftRayTest = function (ox, oy, oz, dx, dy, dz, maxT) {
    let best = null, bd = maxT == null ? Infinity : maxT;
    civilRayOrigin.set(ox, oy, oz);
    civilRayDirection.set(dx, dy, dz).normalize();
    for (let i = 0; i < placed.length; i++) {
      const rec = placed[i];
      if (!rec || rec.destroyed || rec.taken || !rec.group || !rec.group.parent || rec.group.visible === false) continue;
      civilRaycaster.ray.origin.copy(civilRayOrigin);
      civilRaycaster.ray.direction.copy(civilRayDirection);
      civilRaycaster.near = 0;
      civilRaycaster.far = bd;
      // Raycast the visible fuselage/wing meshes themselves. The old oriented
      // box let bullets paint holes in empty air at the corners and looked like
      // a glass wall wrapped around every aircraft.
      // Cache only renderable TRIANGLE meshes. Recursive group raycasting also
      // visits label sprites; Sprite.raycast requires Raycaster.camera and was
      // throwing every frame for ordinary muzzle rays. It also made UI labels
      // into physical aircraft targets. Mesh transforms remain live, so this
      // cache does not freeze the parked/moving aircraft pose.
      if (!rec._rayMeshes) {
        rec._rayMeshes = [];
        rec.group.traverse(function (o) { if (o && o.isMesh && o.geometry) rec._rayMeshes.push(o); });
      }
      const hits = civilRaycaster.intersectObjects(rec._rayMeshes, false);
      let hit = null;
      for (let h = 0; h < hits.length; h++) {
        const q = hits[h];
        if (q.distance >= bd || !q.object || q.object.visible === false || (q.object.material && q.object.material.visible === false)) continue;
        hit = q; break;
      }
      if (!hit) continue;
      bd = hit.distance;
      best = { rec, dist: hit.distance, x: hit.point.x, y: hit.point.y, z: hit.point.z, object: hit.object };
    }
    return best;
  };

  CBZ.cityCivilAircraftAcquireTarget = function (ox, oy, oz, dx, dy, dz, range, coneDot) {
    range = range || 260; coneDot = coneDot == null ? Math.cos(Math.PI / 10) : coneDot;
    let best = null, bestScore = Infinity;
    for (let i = 0; i < placed.length; i++) {
      const rec = placed[i];
      if (!rec || rec.destroyed || rec.taken || !rec.group || !rec.group.parent || rec.group.visible === false) continue;
      const b = civilBodyBounds(rec); if (!b) continue;
      const targetY = rec.group.position.y + (b.minY + b.maxY) * 0.5;
      const tx = rec.group.position.x - ox, ty = targetY - oy, tz = rec.group.position.z - oz;
      const distance = Math.hypot(tx, ty, tz);
      if (distance < 5 || distance > range) continue;
      const dot = (tx * dx + ty * dy + tz * dz) / distance;
      if (dot < coneDot) continue;
      const score = (1 - dot) * 8 + distance / range * 0.08;
      if (score >= bestScore) continue;
      const target = rec;
      bestScore = score;
      best = {
        kind: "civil-aircraft", rec: target, dot, distance,
        radius: target.flightKind === "airliner" ? 3.4 : 2.1,
        seek: function () {
          if (!target || target.destroyed || target.taken || !target.group || !target.group.parent || target.group.visible === false) return null;
          const tb = civilBodyBounds(target);
          return tb ? { x: target.group.position.x, y: target.group.position.y + (tb.minY + tb.maxY) * 0.5, z: target.group.position.z } : null;
        },
      };
    }
    return best;
  };

  // PLURAL twin for systems/lockon.js UNIVERSAL acquisition: every live parked
  // aircraft becomes a candidate at once — the single-best acquire above only
  // ever surfaced one of a whole apron row (it stays for the legacy pull-time
  // homing callers). Anchor height + seek getter are cached per rec so the
  // per-frame enumeration allocates nothing. cb(...) === false stops the walk.
  function civilLockSeek(rec) {
    if (!rec._lockSeek) {
      const b = civilBodyBounds(rec);
      rec._lockMidY = b ? (b.minY + b.maxY) * 0.5 : 2.5;   // fuselage mid-height
      rec._lockSeek = function () {
        if (!rec || rec.destroyed || rec.taken || !rec.group || !rec.group.parent || rec.group.visible === false) return null;
        return { x: rec.group.position.x, y: rec.group.position.y + rec._lockMidY, z: rec.group.position.z };
      };
    }
    return rec._lockSeek;
  }
  CBZ.cityCivilAircraftEnumTargets = function (cb) {
    for (let i = 0; i < placed.length; i++) {
      const rec = placed[i];
      if (!rec || rec.destroyed || rec.taken || !rec.group || !rec.group.parent || rec.group.visible === false) continue;
      const seek = civilLockSeek(rec);
      if (cb(rec, seek, rec.group.position.x, rec.group.position.y + rec._lockMidY, rec.group.position.z,
             rec.flightKind === "airliner" ? 3.4 : 2.1, "civil-aircraft") === false) return;
    }
  };

  function detachCivilCollider(rec) {
    const col = rec && rec.collider;
    if (!col || rec._colliderDetached) return;
    const i = CBZ.colliders ? CBZ.colliders.indexOf(col) : -1;
    if (i >= 0) CBZ.colliders.splice(i, 1);
    rec._colliderDetached = true;
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  }

  function charAircraft(group) {
    if (!group || group.userData.charred) return;
    group.userData.charred = true;
    group.traverse(function (o) {
      if (!o.material) return;
      function charOne(src) {
        const m = src && src.clone ? src.clone() : src;
        if (m && m.color) m.color.multiplyScalar(0.22);
        if (m && m.emissive) m.emissive.multiplyScalar(0.08);
        if (m) { m.transparent = false; m.opacity = 1; m.needsUpdate = true; }
        return m;
      }
      o.material = Array.isArray(o.material) ? o.material.map(charOne) : charOne(o.material);
    });
  }

  // PASSENGER SPILL (shared): detach every seated occupant of a cabin hook AT
  // WORLD POSE and route them through the normal ped kill path, so a downed
  // hull sheds tumbling, killfeed-logged bodies instead of freezing, deleting
  // or tarmac-teleporting them. TWO consumers: the shot-down branch below and
  // playeraircraft.js's crash transition — author no third copy. Living
  // occupants go through cityKillPed (bus-wrapped: explosion-magnitude
  // ragdoll + gore + killfeed line for free); already-dead seat slumpers get
  // the same tumble via cityRagdoll directly (cityKillPed no-ops on the
  // dead). MUST run BEFORE the wreck blast: a blast that kills a still-
  // attached body trips peds.js's seatedCorpse gate and the corpse freezes
  // mid-air. Flag AIR_CABIN_SPILL reverts to the old vanish/freeze behaviour.
  if (CBZ.CONFIG.AIR_CABIN_SPILL == null) CBZ.CONFIG.AIR_CABIN_SPILL = true;
  // A body leaving an aircraft seat with no landing point of its own is put
  // down at the foot of the airstairs instead of at its seat's world pose (see
  // cityUnseat). One-line revert to the old fall-through-the-deck behaviour.
  if (CBZ.CONFIG.AIRCRAFT_EXIT_BY_DOOR == null) CBZ.CONFIG.AIRCRAFT_EXIT_BY_DOOR = true;
  // ---- TAKE A BODY OUT OF A SEAT (CBZ.cityUnseat) ---------------------------
  // syncAttached() now RE-ASSERTS an attached body's seat transform every
  // frame, so a seated body cannot be nudged, shoved or teleported out of a
  // chair — DETACHING is the only way one leaves a seat, and `_seatHold=false`
  // is the documented escape hatch for the frame in which that happens. That
  // three-step dance (drop the hold, detach at world pose, clear the seat's
  // back-pointer) was written inline in citySpillCabin and is exactly what a
  // HIJACK needs too: an ejected pilot wants the detach half WITHOUT the kill.
  // So it lives here once and every caller gets it. Callers that want the body
  // somewhere specific pass x/z (+ ground:true to drop it onto the terrain).
  // Returns true if the actor actually left a seat.
  function cityUnseat(a, opts) {
    if (!a || !a.group) return false;
    opts = opts || {};
    a._seatHold = false;
    if (opts.seat && opts.seat.occupant === a) opts.seat.occupant = null;
    /* ---- A BODY LEAVES AN AIRCRAFT THROUGH THE DOOR ----------------------
       OWNER BUG (2026-07-27, verbatim): "when i board an airplane the
       passengers are able to exit without going out the door — they just get
       up and automatically are out of the plane."

       They do, and it was arithmetic. detach() puts a freed body at its
       decomposed world pose — which for a cabin seat is a point 3.6 m up,
       INSIDE the fuselage — and peds.js's ordinary brain then clamps
       `pos.y = 0` on its next tick. The body falls through the deck, through
       the hull (whose AABB is detached the whole time the player is aboard)
       and stands on the tarmac. Nobody wrote a teleport; a height clamp did
       it. EVERY non-lethal exit in the game took that route: the scare-bolt
       (peds.js), npclife's prune-release, the orphan detach, the mode reset —
       none of which is a file that should have to know an aircraft has a door.

       So the DEFAULT landing point for a body leaving an aircraft seat is now
       the foot of its own airstairs, and callers get it for free. Explicit
       x/z still wins (cityVacateFlightDeck spaces its crew by hand), and
       `keepPose:true` is the opt-out for the one caller that genuinely wants
       the seat pose — citySpillCabin, where the body must ragdoll from where
       it was sitting. */
    if (opts.x == null && !opts.keepPose && CBZ.CONFIG.AIRCRAFT_EXIT_BY_DOOR !== false) {
      const rec0 = a._npcAttached;
      const host = rec0 && rec0.parent;
      const cab0 = host && host.userData && host.userData.cabin;
      // npclife's normalizeSeat drops the raw `cockpit` flag but keeps `role`
      // and a `source` back-pointer, so ask all three rather than the one that
      // happens to survive normalisation today.
      const anc0 = rec0 && rec0.anchor;
      const cockpit0 = !!(anc0 && (anc0.cockpit || anc0.role === "pilot" ||
        (anc0.source && anc0.source.cockpit)));
      if (cab0 && !cockpit0) {
        const foot = doorFootWorld(host, cab0, 0);
        if (foot) { opts.x = foot.x; opts.z = foot.z; if (opts.ground == null) opts.ground = true; }
      }
    }
    let left = false;
    const NL = CBZ.npcLife;
    try { if (NL && NL.detach) left = !!NL.detach(a, { state: opts.state || (a.dead ? "dead" : "walk") }); } catch (e) {}
    if (opts.x != null && opts.z != null && a.pos && a.pos.set) {
      const gy = opts.y != null ? opts.y
        : (opts.ground !== false && CBZ.floorAt ? (+CBZ.floorAt(opts.x, opts.z) || 0) : (a.pos.y || 0));
      a.pos.set(opts.x, gy, opts.z);
      if (a.group.position && a.group.position.copy) a.group.position.copy(a.pos);
      if (a.target && a.target.set) a.target.set(opts.x, 0, opts.z);
    }
    if (!a.dead) { a.speed = 0; a.pause = Math.max(a.pause || 0, 0.3); }
    return left;
  }
  CBZ.cityUnseat = cityUnseat;

  function citySpillCabin(hook, x, z, byPlayer) {
    if (!hook || !hook.seats || CBZ.CONFIG.AIR_CABIN_SPILL === false) return 0;
    let spilled = 0;
    for (let si = 0; si < hook.seats.length; si++) {
      const a = hook.seats[si] && hook.seats[si].occupant;
      if (!a || a === CBZ.player || !a.group) continue;
      const wasDead = !!a.dead;
      // keepPose: a spill is a BLAST, and a blast throws the body from where it
      // was sitting. This is the one exit that must NOT walk to the door.
      cityUnseat(a, { state: wasDead ? "dead" : "walk", keepPose: true });
      if (!wasDead) {
        if (CBZ.cityKillPed) { try { CBZ.cityKillPed(a, { fromX: x, fromZ: z, force: 14, byPlayer: !!byPlayer }, "explosion"); } catch (e) {} }
      } else if (CBZ.cityRagdoll && a.pos) {
        const ddx = a.pos.x - x, ddz = a.pos.z - z, dl = Math.hypot(ddx, ddz) || 1;
        try { CBZ.cityRagdoll(a, a.pos, { x: ddx / dl, y: 0.55, z: ddz / dl }, 12); } catch (e) {}
      }
      spilled++;
    }
    return spilled;
  }
  CBZ.citySpillCabin = citySpillCabin;

  CBZ.cityDamageCivilAircraft = function (rec, amount, point, opts) {
    opts = opts || {};
    if (!rec || rec.destroyed || rec.taken || !rec.group || !rec.group.parent || !(amount > 0)) return false;
    rec.hp = Math.max(0, (rec.hp == null ? rec.maxHp || 250 : rec.hp) - amount);
    if (point && point.x != null) rec._lastDamagePoint = { x: point.x, y: point.y, z: point.z };
    const hpFrac = rec.maxHp > 0 ? rec.hp / rec.maxHp : 0;
    if (hpFrac <= 0.58) rec._damaged = true;
    if (hpFrac <= 0.24) { rec._burning = true; rec._burnT = Math.min(rec._burnT || 0, 0.05); }
    if (rec.hp > 0) return false;

    rec.destroyed = true; rec.taken = true; rec.hot = false;
    detachCivilCollider(rec);
    const grp = rec.group, b = civilBodyBounds(rec);
    const x = point && point.x != null ? point.x : grp.position.x;
    const y = point && point.y != null ? point.y : grp.position.y + (b ? (b.minY + b.maxY) * 0.5 : 2.5);
    const z = point && point.z != null ? point.z : grp.position.z;
    grp.userData.hijackable = false;
    grp.userData.milKind = null;
    grp.userData.destroyed = true;
    grp.userData.craft = null;
    charAircraft(grp);
    // Leave the actual model as a wreck; a small permanent list/settle keeps it
    // from reading as an untouched aircraft paused behind the fireball.
    grp.rotation.x += rec.flightKind === "airliner" ? -0.04 : -0.09;
    grp.rotation.z += rec.flightKind === "airliner" ? 0.12 : 0.20;
    grp.position.y -= rec.flightKind === "airliner" ? 0.18 : 0.12;
    if (cabinState.rec === rec) cabinForceClear(false);
    const hook = grp.userData.cabin && grp.userData.cabin.passengerCabin;
    if (hook) { hook.state = "destroyed"; hook.active = false; emitPassengerCabin("destroyed", hook, rec); }

    // PASSENGERS SPILL, NOT VANISH — see citySpillCabin below. Order matters
    // and used to be wrong: the wreck blast killed occupants while still
    // ATTACHED (peds.js's seatedCorpse gate skips ragdoll for attached
    // bodies → corpses froze mid-air), then npclife's pruneCabins deleted the
    // spawned ones and tarmac-teleported the claimed ones (peds.js pos.y=0) —
    // bodies popping out of the bottom of a flying hull. Spill FIRST, blast
    // after, so the bodies get the real tumble.
    if (hook) citySpillCabin(hook, x, z, !!opts.byPlayer);

    const heavy = rec.flightKind === "airliner";
    if (CBZ.cityAirstrikeExplosion) {
      try { CBZ.cityAirstrikeExplosion(x, z, { power: heavy ? 2.4 : 1.8, radius: heavy ? 12 : 9, byPlayer: !!opts.byPlayer, y }); } catch (e) {}
    } else if (CBZ.cityExplosion) {
      try { CBZ.cityExplosion(x, z, { power: heavy ? 2.1 : 1.6, radius: heavy ? 11 : 8, byPlayer: !!opts.byPlayer, y }); } catch (e) {}
    }
    if (CBZ.cityShatter) { try { CBZ.cityShatter(x, z, heavy ? 20 : 14); } catch (e) {} }
    if (CBZ.cityCrashSmoke) {
      try { CBZ.cityCrashSmoke(x, y, z); if (heavy) CBZ.cityCrashSmoke(x - 1.4, y + 0.5, z + 0.8); } catch (e) {}
    }
    if (CBZ.shake) { try { CBZ.shake(heavy ? 1.5 : 1.0); } catch (e) {} }
    return true;
  };

  // Parked planes now share the readable damage ladder cars have: rounds first
  // chip the skin, low integrity starts an engine/fuselage smoke trail, and an
  // ignored burning airframe eventually cooks off into the same persistent
  // wreck transition. The currently flown record is excluded because its live
  // craft controller owns HP and crash physics.
  if (CBZ.onUpdate) CBZ.onUpdate(35.64, function (dt) {
    if (CBZ.game.mode !== "city" || CBZ.game.state !== "playing") return;
    for (let i = 0; i < placed.length; i++) {
      const rec = placed[i];
      if (!rec || !rec._burning || rec.destroyed || rec.taken || !rec.group || !rec.group.parent) continue;
      rec._burnT = (rec._burnT || 0) - dt;
      if (rec._burnT <= 0) {
        rec._burnT = 0.16 + rng() * 0.12;
        const p = rec._lastDamagePoint || {
          x: rec.group.position.x, y: rec.group.position.y + (rec.flightKind === "airliner" ? 3.6 : 2.2), z: rec.group.position.z,
        };
        if (CBZ.cityCrashSmoke) { try { CBZ.cityCrashSmoke(p.x, p.y, p.z); } catch (e) {} }
      }
      rec.hp = Math.max(0, rec.hp - dt * (rec.flightKind === "airliner" ? 2.5 : 3.8));
      if (rec.hp <= 0) CBZ.cityDamageCivilAircraft(rec, 1, rec._lastDamagePoint, { byPlayer: false, fire: true });
    }
  });

  CBZ.cityCivilAircraftSplash = function (x, y, z, radius, maxDamage, opts) {
    radius = Math.max(0.1, radius || 10); maxDamage = maxDamage || 0;
    let hit = 0;
    for (let i = 0; i < placed.length; i++) {
      const rec = placed[i];
      if (!rec || rec.destroyed || rec.taken || !rec.group || !rec.group.parent) continue;
      const b = civilBodyBounds(rec); if (!b) continue;
      const cy = rec.group.position.y + (b.minY + b.maxY) * 0.5;
      // CAPSULE, NOT ORIGIN-SPHERE (measured): the old test took the distance
      // from the aircraft ORIGIN with a ~3.5m hull allowance, so on a 54m
      // airliner a rocket into the TAIL read as a 20m+ miss and did literally
      // nothing. Project the blast onto the fuselage AXIS (plane-local x,
      // clamped to the half-length), measure to THAT point — every station
      // along the hull is now equally hittable; the radial allowance is the
      // fuselage half-width exactly as before.
      const loc = cabinLocal(rec, x, z);
      const ax = Math.max(-b.hx, Math.min(b.hx, loc.x));
      const axW = cabinWorld(rec, ax, 0);
      const d = Math.hypot(axW.x - x, cy - y, axW.z - z);
      const hullD = Math.max(0, d - Math.max(b.hz, rec.flightKind === "airliner" ? 3.5 : 2.2));
      if (hullD > radius) continue;
      const damage = maxDamage * Math.max(0.18, 1 - hullD / radius);
      if (damage > 0) { CBZ.cityDamageCivilAircraft(rec, damage, { x, y, z }, opts); hit++; }
    }
    return hit;
  };

  // ============================================================
  //  CABIN BOARDING — the elevator-grammar door flow for the parked
  //  airliners (owner request): walk to the forward port door → prompt →
  //  the panel SLIDES open → step inside a real cabin (aisle, seat rows,
  //  seated passengers, cockpit door) → exit the same way, or take a seat
  //  (CBZ.propSit, guard-called). While the player is inside we detach the
  //  plane's solid hull AABB (the same rec.collider the theft flow
  //  detaches, same flag) and stand them on a temporary CBZ.platforms deck
  //  record; both are restored/removed on exit, on death, on mode change,
  //  and when the plane is stolen out from under us. All geometry math is
  //  done in PLANE-LOCAL space so it works at any parked heading.
  // ============================================================
  const cabinState = { inside: false, rec: null, platform: null, pending: null, zonesReg: false };

  function cabinLocal(rec, wx, wz) {
    const th = rec.group.rotation.y, c = Math.cos(th), s = Math.sin(th);
    const dx = wx - rec.group.position.x, dz = wz - rec.group.position.z;
    return { x: dx * c - dz * s, z: dx * s + dz * c };
  }
  function cabinWorld(rec, lx, lz) {
    const th = rec.group.rotation.y, c = Math.cos(th), s = Math.sin(th);
    return {
      x: rec.group.position.x + lx * c + lz * s,
      z: rec.group.position.z - lx * s + lz * c,
    };
  }
  function cabinDoorWorld(rec) {
    const cab = rec.group.userData.cabin;
    return cabinWorld(rec, cab.doorX, cab.doorZ);
  }
  // Local→world for a cabin whose RECORD we may not have (an attached body only
  // knows the group it hangs from). cabinWorld's arithmetic, one level down.
  function cabinWorldG(grp, lx, lz) {
    const th = grp.rotation.y, c = Math.cos(th), s = Math.sin(th);
    return { x: grp.position.x + lx * c + lz * s, z: grp.position.z - lx * s + lz * c };
  }
  // How far OUT of the door the airstairs put you down. aircraft_doors.js's
  // own outLocal for the panel door is `doorZ - 1.6*scale`; one more step
  // clears the bottom tread so a released body is not standing on it.
  function doorFootLocal(cab, n) {
    const sc = cab.scale || 1;
    return { x: cab.doorX + (n || 0) * 1.3, z: cab.doorZ - (1.6 * sc + 1.4) };
  }
  function doorFootWorld(grp, cab, n) {
    if (!grp || !cab || cab.doorX == null || !grp.position) return null;
    const l = doorFootLocal(cab, n);
    return cabinWorldG(grp, l.x, l.z);
  }
  function cabinRemovePlatform() {
    if (cabinState.platform && CBZ.platforms) {
      const i = CBZ.platforms.indexOf(cabinState.platform);
      if (i >= 0) CBZ.platforms.splice(i, 1);
    }
    cabinState.platform = null;
  }
  // restoreCollider=true → put the hull AABB back (normal exit). false → the
  // plane was stolen out from under us; the flight system owns the collider
  // lifecycle now (its restorePropCollider reattaches on park).
  function cabinForceClear(restoreCollider) {
    const rec = cabinState.rec;
    const P = CBZ.player;
    if (P && P._aircraftCabinSeat) {
      if (P._aircraftCabinSeat.occupant === P) P._aircraftCabinSeat.occupant = null;
      P._aircraftCabinSeat = null;
    }
    cabinRemovePlatform();
    if (rec) {
      if (restoreCollider && rec._cabinDetached && rec.collider && !rec.taken) {
        if (CBZ.colliders && CBZ.colliders.indexOf(rec.collider) < 0) CBZ.colliders.push(rec.collider);
        rec._colliderDetached = false;
        if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
      }
      rec._cabinDetached = false;
    }
    cabinState.inside = false; cabinState.rec = null; cabinState.pending = null;
  }
  function cabinReset() { cabinForceClear(false); }

  // ============================================================
  //  ALREADY ABOARD (owner bug, 2026-07-27, verbatim): "when i go to steal an
  //  airplane i board the plane and then the cockpit door opens, and when i
  //  press E again to hijack it, instead of throwing the pilot out and sitting
  //  in the seat, the door and steps open as if I'm hijacking from outside the
  //  plane — but i already boarded and opened the cockpit door."
  //
  //  Two separate defects, both real:
  //   (1) the boarding arc was UNCONDITIONAL. aircraft_doors.js's begin() had
  //       no notion of "the player is already past this door", so a hijack
  //       fired from the flight deck marched him back OUT through the fuselage,
  //       redeployed the airstairs and replayed the walk-up. The state "I am
  //       aboard" existed (cabinState.inside) and nothing ever asked it. These
  //       two exports are that question, and aircraft_doors.js answers the arc
  //       with a short flight-deck beat instead of the full walk-in.
  //   (2) THE PILOT WAS NEVER EJECTED. citySpawnFlyableFromProp simply handed
  //       the player the controls; the captain stayed sitting in his chair for
  //       the whole flight. cityVacateFlightDeck is the missing half, and it is
  //       the un-killed twin of citySpillCabin — the crew are thrown out ALIVE
  //       and panicked, because being hijacked is not a death.
  // ============================================================
  // "Is the player standing inside this aircraft right now?" (any aircraft if
  // rec is omitted). The ONE query — never re-derive it from a position test.
  CBZ.cityCabinAboard = function (rec) {
    if (!cabinState.inside || cabinState.pending) return false;
    const P = CBZ.player;
    if (!P || P.dead || P.driving || P._aircraft) return false;
    if (rec && cabinState.rec !== rec) return false;
    return true;
  };
  // Where the flight deck is, in world space, for a caller that needs to walk
  // the player to it. Null when this airframe has no reachable flight deck.
  CBZ.cityCabinFlightDeck = function (rec) {
    const cab = rec && rec.group && rec.group.userData && rec.group.userData.cabin;
    if (!cab || !cab.cockpitLeaf || cab.deckX == null) return null;
    const w = cabinWorld(rec, cab.deckX, cab.deckZ || 0);
    return { x: w.x, z: w.z, y: (rec.group.position.y || 0) + cab.floorTop, open: cab.cockpitT > 0.5 };
  };
  // Throw the flight crew out of their seats — ALIVE. Not a death: the
  // killfeed is for deaths, and a hijacked pilot who runs for the terminal is
  // not one. The bodies leave through cityUnseat (the only sanctioned way out
  // of a seat now that syncAttached re-asserts the transform every frame), land
  // on the apron clear of the forward door, and panic like any civilian who
  // just watched an aircraft get stolen. Returns how many were put off.
  CBZ.cityVacateFlightDeck = function (rec, opts) {
    opts = opts || {};
    const cab = rec && rec.group && rec.group.userData && rec.group.userData.cabin;
    if (!cab || !cab.seats) return 0;
    let n = 0;
    for (let i = 0; i < cab.seats.length; i++) {
      const s = cab.seats[i];
      if (!s || !s.cockpit) continue;
      const a = s.occupant;
      if (a === CBZ.player) { s.occupant = null; continue; }
      if (!a || !a.group) continue;
      // put them down on the apron beside the forward door, spaced apart
      const out = cabinWorld(rec, cab.doorX, -(4.6 + n * 1.4) * (cab.scale || 1));
      cityUnseat(a, { seat: s, state: "walk", x: out.x, z: out.z, ground: true });
      if (a.dead) { n++; continue; }
      a.job = a.job || "pilot";
      a.rage = null; a.targetActor = null;
      // a real witness: they run, and they report it (the theft's own
      // cityCrime call already owns the heat — this is the human reaction)
      if (CBZ.cityPanic) { try { CBZ.cityPanic(out.x, out.z, 2.0, opts.byPlayer ? CBZ.player : null); } catch (e) {} }
      n++;
    }
    if (n && CBZ.cityFlavor && opts.byPlayer !== false) {
      CBZ.cityFlavor(n > 1 ? "You throw the flight crew out of the cockpit." : "You throw the pilot out of his seat.", "#ffd27a");
    }
    return n;
  };

  /* ======================================================================
      THE DOOR IS YOURS  (CBZ.CONFIG.AIRLINER_DOOR_MANUAL)

      OWNER: "i should be able to open and close the door."

      Every door in this file already eased itself on PROXIMITY and nothing
      else: walk up, it slides; walk away, it shuts. aircraft_doors.js can
      force one open for the length of a boarding arc (`rec._doorArcOpen`) and
      that is the ONLY writer that ever outranked the proximity rule — there
      was no "is it open" query and no way for a person to hold one shut.

      This adds ONE nullable field, `cab.doorManual`, and no second animation
      path: null = the automatic rule, true = you are holding it open, false =
      you are holding it shut. The easing at 55.2 is unchanged apart from the
      one branch that reads it, and it sits BELOW the arc flags on purpose —
      an automated board or deplane still opens the door it needs, exactly as
      it did before, so a door you shut can never deadlock a boarding.
     ====================================================================== */
  if (CBZ.CONFIG.AIRLINER_DOOR_MANUAL == null) CBZ.CONFIG.AIRLINER_DOOR_MANUAL = true;
  // The door hardware on this airframe, whichever kind it wears. `t` is the
  // live open fraction of the thing you can SEE moving, so a caller never has
  // to know whether it is looking at a sliding panel or a hinged airstair.
  function aircraftDoor(rec) {
    const ud = rec && rec.group && rec.group.userData;
    if (!ud) return null;
    if (ud.cabin && ud.cabin.panel) return { kind: "panel", cab: ud.cabin, t: ud.cabin.doorT || 0 };
    if (ud.doorRig && ud.doorRig.panel) return { kind: "stair", cab: ud.doorRig, t: ud.doorRig.t || 0 };
    if (ud.cabin) return { kind: "panel", cab: ud.cabin, t: ud.cabin.doorT || 0 };
    return null;
  }
  function trackPhysicalDoorSound(owner, current, target, playerCause) {
    if (!owner) return;
    if (owner._physicalDoorAudioTarget == null) owner._physicalDoorAudioTarget = current > 0.5 ? 1 : 0;
    if (owner._physicalDoorAudioTarget === target) return;
    owner._physicalDoorAudioTarget = target;
    let audible = false;
    if (target === 1 && playerCause) {
      owner._physicalDoorAudioCycle = true;
      audible = true;
    } else if (target === 0 && (playerCause || owner._physicalDoorAudioCycle)) {
      owner._physicalDoorAudioCycle = false;
      audible = true;
    }
    if (audible && CBZ.sfx) {
      try { CBZ.sfx(target ? "door_open" : "door_close"); } catch (e) {}
    }
  }
  // THE ONE "is this aircraft's door open" answer. aircraft_doors.js never had
  // one — `rec._doorArcOpen` only says an arc is FORCING it, not what the
  // hardware is actually doing — so anything that needed to know guessed.
  CBZ.cityAircraftDoor = function (rec) {
    const d = aircraftDoor(rec);
    if (!d) return null;
    return {
      kind: d.kind, t: d.t, open: d.t > 0.5,
      manual: d.cab.doorManual == null ? null : !!d.cab.doorManual,
      arc: !!(rec && rec._doorArcOpen),
    };
  };
  // Hold it open / hold it shut / hand it back to the automatic rule (null).
  CBZ.cityAircraftDoorSet = function (rec, open) {
    const d = aircraftDoor(rec);
    if (!d) return false;
    const wasOpen = d.cab.doorManual == null ? d.t > 0.5 : !!d.cab.doorManual;
    const next = (open == null) ? null : !!open;
    d.cab.doorManual = next;
    // This API is owned by the two at-the-door interaction verbs below. The
    // boarding/deplaning and proximity writers use their own physical state
    // paths, so a manual click cannot accidentally bless those with audio.
    if (next != null && next !== wasOpen && CBZ.sfx) {
      try { CBZ.sfx(next ? "door_open" : "door_close"); } catch (e) {}
    }
    if (next != null) {
      // The manual interaction already spoke for this transition. Align the
      // animation-side tracker so the next frame cannot echo it.
      d.cab._physicalDoorAudioTarget = next ? 1 : 0;
      d.cab._physicalDoorAudioCycle = false;
    }
    return true;
  };

  /* ======================================================================
      DEPLANING USES THE DOOR  (CBZ.CONFIG.AIRCRAFT_DEPLANE)

      OWNER: "the passengers are able to exit without going out the door."

      cityUnseat above stops a freed body materialising on the tarmac. This is
      the other half: the ORDERLY exit, which is the boarding grammar run
      backwards. aircraft_doors.js's board arc is walk → open → step →
      handover → close; a deplane is open → stand → aisle → door → stairs →
      released, and the beats are named the same way for the same reason.

      HOW A PASSENGER IS DRIVEN, and this is the whole trick: they are NOT
      detached and handed to the street brain, which is what would let them
      walk through the fuselage. They stay ATTACHED, and the arc mutates the
      anchor npclife already stores — so npclife's own syncAttached (33.8)
      moves them, peds.js keeps skipping them entirely (no wander, no path, no
      y-clamp), they ride a plane that is being pushed back, and the ONLY
      thing this file authors is a path and a clock. The body is detached once
      it is standing on the apron, which is the first moment the street brain
      is the right owner.

      They leave ONE AT A TIME through a real aisle, because a queue at the
      door is what deplaning looks like and because two bodies on the same
      aisle centreline would interpenetrate.
     ====================================================================== */
  if (CBZ.CONFIG.AIRCRAFT_DEPLANE == null) CBZ.CONFIG.AIRCRAFT_DEPLANE = true;
  const DEPLANE_SPD = 1.15;            // m/s down the aisle — an unhurried walk
  const deplanes = [];                 // live arcs, one per aircraft

  function deplaneOf(rec) {
    for (let i = 0; i < deplanes.length; i++) if (deplanes[i].rec === rec) return deplanes[i];
    return null;
  }
  // Everyone still sitting in a PASSENGER seat, front to back — the order a
  // cabin actually empties. Dedupe is by ACTOR, not by the wrapper record, so
  // calling cityDeplane twice on the same aircraft cannot queue anybody twice.
  function deplaneHas(d, a) {
    if (d.walking && d.walking.a === a) return true;
    for (let i = 0; i < d.queue.length; i++) if (d.queue[i].a === a) return true;
    return false;
  }
  function deplaneQueue(cab) {
    const out = [];
    for (let i = 0; i < cab.seats.length; i++) {
      const s = cab.seats[i], a = s && s.occupant;
      if (!a || a === CBZ.player || s.cockpit || s.pose === "stand") continue;
      if (!a.group || a.dead || !a._npcAttached) continue;
      out.push({ seat: s, a: a });
    }
    out.sort(function (p, q) { return q.seat.x - p.seat.x; });   // +X is the nose: forward rows first
    return out;
  }

  // Start (or top up) the orderly deplane of one aircraft. Returns how many
  // passengers are queued. Safe to call repeatedly.
  CBZ.cityDeplane = function (rec, opts) {
    opts = opts || {};
    if (CBZ.CONFIG.AIRCRAFT_DEPLANE === false) return 0;
    const cab = rec && rec.group && rec.group.parent && rec.group.userData && rec.group.userData.cabin;
    if (!cab || !cab.seats || rec.destroyed) return 0;
    const q = deplaneQueue(cab);
    if (!q.length) return 0;
    let d = deplaneOf(rec);
    if (!d) { d = { rec: rec, cab: cab, queue: [], walking: null, gap: 0 }; deplanes.push(d); }
    for (let i = 0; i < q.length; i++) {
      if (opts.limit > 0 && d.queue.length >= opts.limit) break;
      if (!deplaneHas(d, q[i].a)) d.queue.push(q[i]);
    }
    return d.queue.length;
  };

  // Take a passenger OUT of the seat record but leave them attached: the seat
  // is free the moment they stand, which is also what stops cabinHoldSeats
  // (which iterates seats, not bodies) from dragging a walker back into it.
  function deplaneStand(w) {
    const a = w.a, rec0 = a._npcAttached;
    if (!rec0 || !rec0.anchor) return false;
    if (w.seat.occupant === a) w.seat.occupant = null;
    const an = rec0.anchor;
    w.from = { x: an.x, y: an.y, z: an.z };
    an.pose = "stand"; an.state = "walk";
    if (a.char) { a.char.sitting = false; a.char.seatRef = null; }
    a._deplaning = true;
    w.phase = "stand"; w.t = 0;
    return true;
  }

  // ONE path, in plane-local metres, and every leg of it is a straight line a
  // real person could walk: out of the row into the aisle, forward up the
  // aisle, square to the door, then down the stairs to the apron.
  function deplaneLegs(cab, w) {
    const f = doorFootLocal(cab, 0);
    return [
      { x: w.from.x, z: 0, y: cab.floorTop },                    // into the aisle
      { x: cab.doorX, z: 0, y: cab.floorTop },                   // up the aisle
      { x: cab.doorX, z: cab.doorZ, y: cab.floorTop },           // square to the door
      { x: f.x, z: f.z, y: 0 },                                  // down the airstairs
    ];
  }

  function deplaneStep(d, dt) {
    const cab = d.cab, rec = d.rec;
    const grp = rec.group;
    if (!grp || !grp.parent || rec.destroyed) return true;       // aircraft gone: drop the arc
    // THE DOOR OPENS FIRST, through the SAME flag the boarding arc uses, so the
    // panel/airstair plays its one existing animation and a manually shut door
    // is overridden for exactly as long as people are getting off.
    rec._doorArcOpen = true;
    const w = d.walking;
    if (!w) {
      d.gap -= dt;
      if (d.gap > 0) return false;
      if (!d.queue.length) return true;                          // everyone is off
      const nx = d.queue.shift();
      if (!nx.a || nx.a.dead || !nx.a._npcAttached) return false;
      if (!deplaneStand(nx)) return false;
      nx.legs = deplaneLegs(cab, nx);
      nx.leg = 0;
      d.walking = nx;
      return false;
    }
    const a = w.a, rec0 = a._npcAttached;
    if (!a.group || !rec0 || !rec0.anchor) { a._deplaning = false; d.walking = null; d.gap = 0.4; return false; }
    // SHOT ON THE AISLE. The body drops where it stands (keepPose) — a corpse
    // does not finish walking to the door, and the queue behind it moves up.
    if (a.dead) {
      a._deplaning = false;
      try { cityUnseat(a, { state: "dead", keepPose: true }); } catch (e) {}
      d.walking = null; d.gap = 0.5;
      return false;
    }
    const an = rec0.anchor, tgt = w.legs[w.leg];
    const dx = tgt.x - an.x, dz = tgt.z - an.z;
    const dist = Math.hypot(dx, dz);
    const stepD = DEPLANE_SPD * dt;
    if (dist <= stepD || dist < 0.02) {
      an.x = tgt.x; an.z = tgt.z; an.y = tgt.y;
      w.leg++;
      if (w.leg >= w.legs.length) {
        // ON THE APRON — and only NOW is the street brain the right owner.
        const out = doorFootWorld(grp, cab, 0);
        a._deplaning = false;
        cityUnseat(a, { state: "walk", x: out && out.x, z: out && out.z, ground: true });
        if (!a.dead && a.target && a.target.set) {
          a.pause = 0.2;
          // and they WALK OFF the stand rather than standing in the stairs'
          // footprint waiting for the next person to land on top of them.
          const far = cabinWorldG(grp, cab.doorX, cab.doorZ - 7.5 * (cab.scale || 1));
          a.target.set(far.x, 0, far.z);
        }
        d.walking = null;
        d.gap = 1.1;                                             // the queue steps up
        return false;
      }
      return false;
    }
    const k = stepD / dist;
    an.x += dx * k; an.z += dz * k;
    // y is carried by the SAME fraction of the leg that x/z are, so standing up
    // is a lift and the airstair descent is a ramp — never a snap, and it lands
    // exactly on the leg's height at the moment the leg ends.
    an.y += (tgt.y - an.y) * k;
    an.yaw = Math.atan2(dx, dz);
    an.pitch = 0; an.roll = 0;
    if (CBZ.animChar && a.char && a.group.visible) {
      try { CBZ.animChar(a.char, DEPLANE_SPD, dt); } catch (e) {}
    }
    return false;
  }

  function deplaneTick(dt) {
    for (let i = deplanes.length - 1; i >= 0; i--) {
      const d = deplanes[i];
      let done = false;
      try { done = deplaneStep(d, dt); } catch (e) { done = true; }
      if (!done) continue;
      // hand the door back to whatever owns it next (the manual flag, or the
      // proximity rule) — this arc must not leave a plane propped open.
      // Hand the door back — but never out from under a LIVE player boarding
      // arc, which owns the same flag (aircraft_doors.js setDoorFlag).
      if (d.rec && !(CBZ.aircraftDoorArc && CBZ.aircraftDoorArc.active)) d.rec._doorArcOpen = false;
      if (d.walking && d.walking.a) d.walking.a._deplaning = false;
      deplanes.splice(i, 1);
    }
  }
  function deplaneReset() {
    for (let i = 0; i < deplanes.length; i++) {
      const d = deplanes[i];
      // Hand the door back — but never out from under a LIVE player boarding
      // arc, which owns the same flag (aircraft_doors.js setDoorFlag).
      if (d.rec && !(CBZ.aircraftDoorArc && CBZ.aircraftDoorArc.active)) d.rec._doorArcOpen = false;
      if (d.walking && d.walking.a) d.walking.a._deplaning = false;
    }
    deplanes.length = 0;
  }
  // Census for the audit: how many arcs are live and how many bodies are on
  // the aisle right now.
  function deplaneCensus() {
    let walking = 0, queued = 0;
    for (let i = 0; i < deplanes.length; i++) {
      if (deplanes[i].walking) walking++;
      queued += deplanes[i].queue.length;
    }
    return { arcs: deplanes.length, walking: walking, queued: queued };
  }

  /* THE STANDABLE DECK, SOLVED FROM THE LIVE POSE.
     This used to be four lines inlined in cabinCompleteBoard, computed ONCE at
     the moment you stepped aboard — which was correct for exactly as long as
     an airliner was a thing that never moved. systems/airline.js flies this
     same airframe between two airports with you standing in it, so the deck
     has to be re-solvable every frame from wherever the hull now is. Same
     oriented-extent AABB as before (the trick playeraircraft.js's collider
     restore uses); `into` lets the caller update the record already in
     CBZ.platforms in place rather than churn the array. */
  function cabinSolvePlatform(rec, into) {
    const cab = rec.group.userData.cabin;
    const th = rec.group.rotation.y;
    const ca = Math.abs(Math.cos(th)), sa = Math.abs(Math.sin(th));
    // cabin local half-extents; with the real cockpit door the standable deck
    // runs on through the bulkhead doorway to the cockpit front (local
    // x -12.8..14.6 instead of -12.6..12.2 — the wall clamp elsewhere is what
    // actually shapes the rooms, the platform just has to underlie them)
    const cock = !!cab.cockpitLeaf;
    const hx = (cock ? 13.7 : 12.4) * AL_SC, hz = 1.6 * AL_SC;
    const ctr = cabinWorld(rec, (cock ? 0.9 : -0.2) * AL_SC, 0);
    const ex = ca * hx + sa * hz, ez = sa * hx + ca * hz;
    const p = into || {};
    p.minX = ctr.x - ex; p.maxX = ctr.x + ex;
    p.minZ = ctr.z - ez; p.maxZ = ctr.z + ez;
    p.top = rec.group.position.y + cab.floorTop;
    return p;
  }

  /* CARRY THE PASSENGER (AIRLINE_RIDE). A cabin is a room, and a room that
     flies has to take the person in it with it. Called by whoever is MOVING
     the airframe, once per frame, with the world delta it just applied:

       • standing — translate the player by the same delta. The per-frame wall
         clamp in the 55.2 upkeep then shapes them to the aisle exactly as it
         does on the ground, so nothing about the room's geometry is special-
         cased for flight.
       • seated — propuse.js's order-42 hold re-pins the player to the seat
         record's own x/y/z/face every frame, and `P._propSeat` IS the record
         cabinSitSeat handed it. So the ride is: re-solve that record from the
         live hull pose and let the hold do the work. Fighting the hold by
         writing P.pos would lose every frame.

     Returns false when this rec is not the one the player is inside, so a
     mover can call it unconditionally. */
  CBZ.cabinCarry = function (rec, dx, dy, dz) {
    if (!cabinState.inside || cabinState.rec !== rec) return false;
    const P = CBZ.player;
    if (!P || P.dead || !rec.group || !rec.group.parent) return false;
    const seat = P._aircraftCabinSeat;
    if (seat && P._propSeat) {
      const w = cabinWorld(rec, seat.x, seat.z);
      const s = P._propSeat;
      s.x = w.x; s.y = rec.group.position.y + seat.y; s.z = w.z;
      s.face = rec.group.rotation.y + (seat.heading == null ? Math.PI / 2 : seat.heading);
    } else if (!P._propSeat) {
      P.pos.x += dx; P.pos.y += dy; P.pos.z += dz;
      P.vy = 0; P.grounded = true;
      if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(P.pos);
    }
    if (cabinState.platform) cabinSolvePlatform(rec, cabinState.platform);
    return true;
  };

  // Is the player standing/sitting in THIS aircraft's cabin? The one honest
  // answer for a caller that must not move an aeroplane out from under them.
  CBZ.cabinRider = function (rec) {
    return !!(cabinState.inside && cabinState.rec === rec && CBZ.player && !CBZ.player.dead);
  };

  function cabinCompleteBoard(rec) {
    const P = CBZ.player;
    if (!P || P.dead || P.driving || P._aircraft) return;
    if (!rec || rec.taken || !rec.group || !rec.group.parent) return;
    const cab = rec.group.userData.cabin; if (!cab) return;
    // hull AABB off (same detach the theft flow uses — shared flag, so the
    // two systems can hand the collider to each other without double-work)
    if (rec.collider && !rec._colliderDetached) {
      const i = CBZ.colliders ? CBZ.colliders.indexOf(rec.collider) : -1;
      if (i >= 0) CBZ.colliders.splice(i, 1);
      rec._colliderDetached = true; rec._cabinDetached = true;
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    }
    cabinState.platform = cabinSolvePlatform(rec, null);
    if (CBZ.platforms) CBZ.platforms.push(cabinState.platform);
    // step in at the door row
    const inPt = cabinWorld(rec, 9.4 * AL_SC, -0.6 * AL_SC);
    P.pos.set(inPt.x, cabinState.platform.top, inPt.z);
    P.vy = 0; P.grounded = true;
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(P.pos);
    cabinState.inside = true; cabinState.rec = rec;
    // A manually shut door cannot survive you walking through it.
    if (cab.doorManual === false) cab.doorManual = null;
    // YOU BOARDED, SO THEY GET OFF. This is the moment the owner was watching
    // when he reported passengers leaving without using the door: an airframe
    // at the gate with a full cabin and somebody walking up the airstairs is
    // an aircraft that is turning round. The arc queues them and the door
    // stays open for as long as it takes; nothing else about boarding changes.
    // Eight, not the whole cabin: a steady file of people past you IS the read,
    // and 26 of them at an unhurried walking pace would still be going ten
    // minutes after you had flown the aircraft away.
    if (CBZ.CONFIG.AIRCRAFT_DEPLANE !== false) {
      try { CBZ.cityDeplane(rec, { limit: 8 }); } catch (e) {}
    }
  }

  function cabinCompleteExit(rec) {
    const P = CBZ.player;
    if (CBZ.propStand && P && P._propSeat) { try { CBZ.propStand(P); } catch (e) {} }
    if (P && rec && rec.group) {
      const out = cabinWorld(rec, rec.group.userData.cabin.doorX, -4.4 * AL_SC);
      const hullY = rec.group.position.y || 0;
      if (hullY >= 0.6) {
        // BELT AND BRACES for the airborne case. The verb above refuses to
        // start while the hull is up, but the arc has a 0.5 s commit window and
        // an aeroplane can rotate inside it. Stepping out of a moving aircraft
        // is then exactly what it should be — you leave at the DOOR and you
        // fall — rather than a teleport to the ground the old line performed.
        P.pos.set(out.x, hullY + (rec.group.userData.cabin.floorTop || 0), out.z);
        P.vy = 0; P.grounded = false;
      } else {
        const gy = CBZ.floorAt ? CBZ.floorAt(out.x, out.z) : 0;
        P.pos.set(out.x, gy, out.z);
        P.vy = 0; P.grounded = true;
      }
      if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(P.pos);
    }
    cabinForceClear(true);
  }

  // ---- REAL cockpit-door collider (CBZ.CONFIG.AIRLINER_COCKPIT_DOOR_SOLID) ---
  // A y-gated world AABB across the flight-deck bulkhead doorway, elevator
  // grammar: solid stops you, "open" parks the y-band above everyone so you
  // walk through. The existing cab.cockpitT easing (untouched) drives it. The
  // collider is attached ONLY while the player is inside this cabin (the doorway
  // is unreachable otherwise), so a parked plane's shut door never leaves a
  // phantom wall on the apron, and it is dropped the instant the plane is taken,
  // destroyed, or the player leaves the cabin.
  function cockpitDoorDetach(cab) {
    if (cab._cockpitCol && CBZ.colliders) {
      const i = CBZ.colliders.indexOf(cab._cockpitCol);
      if (i >= 0) { CBZ.colliders.splice(i, 1); if (CBZ.markCollidersDirty) CBZ.markCollidersDirty(); }
    }
    cab._cockpitColOn = false;
  }
  function cockpitDoorCollider(rec, cab, insideThis) {
    if (!cab.cockpitLeaf || (CBZ.CONFIG && CBZ.CONFIG.AIRLINER_COCKPIT_DOOR_SOLID === false)) {
      if (cab._cockpitColOn) cockpitDoorDetach(cab);
      return;
    }
    const want = insideThis && !rec.taken && !rec.destroyed && rec.group && rec.group.parent;
    if (!want) { if (cab._cockpitColOn) cockpitDoorDetach(cab); return; }
    if (!cab._cockpitCol) {
      // doorway box in cabin-local space (AL_SC-scaled): thin across the
      // bulkhead at x≈12.1, spanning the leaf width in z, deck→header in y.
      // Baked to a world AABB via the parked-heading transform (stable for the
      // whole aboard session — the plane never moves while you're standing in it).
      const S = AL_SC, bx = 12.1 * S, thk = 0.13 * S, hz = 0.5 * S;
      const cs = [cabinWorld(rec, bx - thk, -hz), cabinWorld(rec, bx + thk, -hz),
                  cabinWorld(rec, bx - thk, hz), cabinWorld(rec, bx + thk, hz)];
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const c of cs) { if (c.x < minX) minX = c.x; if (c.x > maxX) maxX = c.x; if (c.z < minZ) minZ = c.z; if (c.z > maxZ) maxZ = c.z; }
      cab._cockpitCol = { minX, maxX, minZ, maxZ, y0: 2.5 * S, y1: 4.4 * S };
      cab._cockpitColYSolid = [2.5 * S, 4.4 * S];
    }
    const col = cab._cockpitCol;
    if (!cab._cockpitColOn) {
      if (CBZ.colliders && CBZ.colliders.indexOf(col) < 0) CBZ.colliders.push(col);
      cab._cockpitColOn = true;
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    }
    // door-arc owns the solid state: >half-shut leaf is solid, an opened leaf
    // parks the collider's y-band above everyone (matches the soft-clamp gate).
    if (cab.cockpitT <= 0.5) { col.y0 = cab._cockpitColYSolid[0]; col.y1 = cab._cockpitColYSolid[1]; }
    else { col.y0 = 1e9; col.y1 = 1e9 + 1; }
  }

  // The nearest FREE, SITTABLE seat in the cabin you are standing in, in
  // plane-local space. `cabin-crew` is a standing post, not a seat, so it is
  // never offered; a seat someone is already in is never offered either.
  function cabinFreeSeat(rec, maxD) {
    const cab = rec && rec.group && rec.group.userData && rec.group.userData.cabin;
    if (!cab || !cab.seats || !cab.seats.length) return null;
    const P = CBZ.player; if (!P) return null;
    const l = cabinLocal(rec, P.pos.x, P.pos.z);
    let best = null, bd = maxD == null ? Infinity : maxD * maxD;
    for (let i = 0; i < cab.seats.length; i++) {
      const s0 = cab.seats[i];
      if (s0.occupant || s0.pose === "stand") continue;
      const d = (s0.x - l.x) * (s0.x - l.x) + (s0.z - l.z) * (s0.z - l.z);
      if (d < bd) { bd = d; best = s0; }
    }
    return best;
  }

  // Sit the PLAYER in a specific cabin seat through the repo's own seat verb.
  // Every number the ad-hoc anchor carries is read off the seat record itself
  // (position, cushion, floor) instead of being retyped here — the airliner used
  // to hardcode a 0.45 cushion in this function AND in the seat builder, which
  // is exactly the duplication that lets a body drift out of a chair the moment
  // one of the two moves. propuse.js refuses its walk-in ARC for an unregistered
  // anchor on a moving host (rec._reg), so this is the honest instant commit.
  function cabinSitSeat(seat) {
    const P = CBZ.player, rec = cabinState.rec;
    if (!P || !rec || !seat || seat.occupant || !CBZ.propSit) return false;
    const w = cabinWorld(rec, seat.x, seat.z);
    const th = rec.group.rotation.y;
    // a seated body faces along (sin f, cos f); the seat's heading is a
    // plane-LOCAL yaw, so the world facing is the parked heading plus it.
    try {
      const sat = CBZ.propSit(P, {
        x: w.x, y: rec.group.position.y + seat.y, z: w.z,
        face: th + (seat.heading == null ? Math.PI / 2 : seat.heading),
        kind: seat.kind || "aircraft-seat", lot: null, occupant: null,
        cushionH: seat.cushionH, floorBelow: seat.floorBelow,
      });
      if (sat) { seat.occupant = P; P._aircraftCabinSeat = seat; return true; }
    } catch (e) {}
    return false;
  }

  function cabinZones() {
    if (cabinState.zonesReg || !CBZ.interactions || !CBZ.interactions.registerZone || !CBZ.interactions.register) return;
    cabinState.zonesReg = true;
    // BOARD THE CABIN — walk-in boarding lives as a SECOND verb on the SAME
    // "milvehicle" candidate the theft flow uses, NOT a separate interaction
    // zone. A zone is its own candidate, and the interaction registry only ever
    // surfaces ONE candidate's options at a time (interactions.js scores a
    // single `current` target) — so a door zone right on the hull was always
    // shadowed by militaryvehicles.js's HIJACK option and never reachable
    // (proved by a CDP probe: pressing E hijacked the plane instead). Riding
    // the milvehicle layer means interactions.js's dualRideRows builds the
    // airliner's two-verb card from this option + militaryvehicles.js's
    // "milveh-take" (the ONE ride that keeps a card — verbs, never YES/NO):
    //   [E] BOARD   (this — elevator-style walk-in, harmless; the E-router
    //               yields to the card so E boards instead of hijacking)
    //   [I] HIJACK  (fly it — militaryvehicles.js, loud, 4★)
    // Both rows fire the options' own onSelect. The board reach is the milvehicle
    // candidate's own 5.5m footprint reach (militaryvehicles.js) — NOT the door
    // itself: the solid hull AABB spans the whole wing/fuselage footprint, so
    // on foot you're stopped ~17m out at the wingtip and can never actually
    // touch the forward port door. Firing BOARD arms the board; the per-frame
    // door-ease below force-opens the panel for the 0.55s pending window
    // (wantOpen keys off cabinState.pending), THEN cabinCompleteBoard steps you
    // into the cabin — the same "walk up → door slides → step in" elevator
    // grammar, without demanding a door-touch the collider forbids.
    CBZ.interactions.register("milvehicle", {
      id: "airliner_board", slot: "i", prio: 1,
      canShow: function (v, ctx) {
        if (!v || v.flightKind !== "airliner" || v.taken) return false;
        if (!v.group || !v.group.parent || !v.group.userData || !v.group.userData.cabin) return false;
        if (cabinState.inside || cabinState.pending) return false;
        const P = CBZ.player;
        if (!P || P.dead || P.driving || P._aircraft) return false;
        return true;
      },
      label: "Board the cabin",
      onSelect: function (v) {
        if (!v || v.taken || cabinState.inside || cabinState.pending) return;
        cabinState.pending = { rec: v, t: 0.55, dir: "in" };   // door slides, then you step in
      },
    });
    // ---- INSIDE THE CABIN: a ROOM, not one room-sized button ----------------
    // OWNER: the cabin should be "a thing build that our game NPCs can interact
    // with". It was not, and the reason was scoring, not the people: the old
    // zone's find() returned the PLAYER'S OWN POSITION, so it scored at distance
    // 0 with prio 6 — the same base as interact.js's "src-ped" — and
    // interactions.js only ever resolves ONE candidate. Every passenger you
    // walked up to lost to the room they were sitting in, so a cabin full of
    // real, hittable, dossier-carrying NPCs could not be talked to. Two honest
    // zones fix it without touching the registry:
    //   • the EXIT lives AT THE DOOR (a real distance, real door grammar) so it
    //     stops out-scoring people in the aisle,
    //   • sitting is a SEAT candidate on the seat you are next to, which picks
    //     up interactions.js's existing silent-seat rule (walk up, press E, you
    //     sit, no card) instead of a room-wide "Take a seat" verb.
    // Both sit BELOW src-ped's prio, so a person always wins over furniture.
    // STABLE target objects: interactions.js compares candidates by object
    // IDENTITY (sameTarget: a.t === b.t) for its hysteresis, so a zone that
    // returns a fresh literal every 12 Hz scan can never be recognised as the
    // same thing you were already looking at. One scratch record per zone,
    // mutated in place.
    const doorTarget = { x: 0, z: 0 };
    const seatTarget = { x: 0, z: 0, kind: "aircraft-seat", seat: null };
    CBZ.interactions.registerZone({
      id: "airliner_cabin", kind: "airliner_cabin", prio: 5, radius: 4.2,
      find: function () {
        if (!cabinState.inside || cabinState.pending) return null;
        const rec = cabinState.rec;
        if (!rec || !rec.group || !rec.group.userData.cabin) return null;
        const d = cabinDoorWorld(rec);
        doorTarget.x = d.x; doorTarget.z = d.z;
        return doorTarget;
      },
      options: [
        {
          id: "airliner_exit", slot: "e", label: "Exit the airliner",
          /* YOU CANNOT STEP OFF AN AEROPLANE THAT IS FLYING. This gate had no
             reason to exist while an airliner was a thing bolted to a gate;
             systems/airline.js flies this same hull with you in it, and the
             exit below puts you on the GROUND under the door — i.e. it would
             have teleported a passenger 130 m straight down out of a cruise.
             Asked of the airframe's own height, not of who is moving it, so
             it holds for any future mover. */
          canShow: function () {
            const rec = cabinState.rec;
            return !!rec && !!rec.group && rec.group.position.y < 0.6;
          },
          onSelect: function () {
            if (!cabinState.inside) return;
            const rec = cabinState.rec;
            if (rec && rec.group && rec.group.position.y >= 0.6) return;
            cabinState.pending = { rec: rec, t: 0.5, dir: "out" };
          },
        },
      ],
    });
    /* THE DOOR, FROM INSIDE — a zone of its own, and it has to be, because
       interactions.js resolves exactly ONE verb per candidate (resolveRows)
       and `slot:"e"` scores +18, so a door option sharing the cabin zone with
       "Exit the airliner" could never surface. Two zones is also the honest
       shape: you stand AT the doorway to work the door and in the AISLE to
       leave, so the tighter radius wins where the door is what you meant and
       the exit verb comes straight back one step inboard. The exit is
       deliberately NOT gated on the door being open — the exit arc sets
       `pending`, which force-opens the panel, so a shut door can never trap
       anybody in the cabin. */
    const inDoorTarget = { x: 0, z: 0 };
    CBZ.interactions.registerZone({
      id: "airliner_doorway", kind: "aircraft_door", prio: 6, radius: 1.6,
      find: function () {
        if (CBZ.CONFIG.AIRLINER_DOOR_MANUAL === false) return null;
        if (!cabinState.inside || cabinState.pending) return null;
        const rec = cabinState.rec;
        if (!rec || rec.taken || !rec.group || !rec.group.userData.cabin) return null;
        const d = cabinDoorWorld(rec);
        inDoorTarget.x = d.x; inDoorTarget.z = d.z;
        return inDoorTarget;
      },
      options: [
        {
          id: "airliner_door_in", slot: "e",
          label: function () {
            const d = CBZ.cityAircraftDoor(cabinState.rec);
            return (d && d.open) ? "Close the door" : "Open the door";
          },
          onSelect: function () {
            const rec = cabinState.rec;
            const d = rec && CBZ.cityAircraftDoor(rec);
            if (!d) return;
            CBZ.cityAircraftDoorSet(rec, !d.open);
          },
        },
      ],
    });
    /* THE DOOR, from outside. A separate zone because out here there is no
       cabin zone to hang it on, and it deliberately outranks the milvehicle
       ride card (prio 3) — at arm's length from an open doorway, "open/close
       the door" is the verb you meant, and stepping back one metre gives
       BOARD/HIJACK straight back. The radius is the same 3.2 the automatic
       proximity ease already uses, so the verb appears exactly when the door
       is reacting to you anyway; on an airliner whose hull AABB keeps you
       further out than that, it simply never appears and nothing regresses. */
    const outDoorTarget = { x: 0, z: 0, rec: null };
    CBZ.interactions.registerZone({
      id: "aircraft_door_out", kind: "aircraft_door", prio: 5, radius: 3.2,
      find: function (px, pz) {
        if (CBZ.CONFIG.AIRLINER_DOOR_MANUAL === false) return null;
        if (cabinState.inside || cabinState.pending) return null;
        const P = CBZ.player;
        if (!P || P.dead || P.driving || P._aircraft) return null;
        let best = null, bd = 3.2 * 3.2;
        for (let i = 0; i < placed.length; i++) {
          const rec = placed[i];
          if (!rec || rec.taken || rec.destroyed || !rec.group || !rec.group.parent) continue;
          const ud = rec.group.userData;
          const rig = ud && ud.doorRig;
          const cab = ud && ud.cabin;
          let w = null;
          if (cab && cab.panel) w = cabinWorld(rec, cab.doorX, cab.doorZ);
          else if (rig && rig.panel) w = cabinWorld(rec, rig.doorX, rig.doorZ);
          if (!w) continue;
          const dd = (w.x - px) * (w.x - px) + (w.z - pz) * (w.z - pz);
          if (dd < bd) { bd = dd; best = { rec: rec, x: w.x, z: w.z }; }
        }
        if (!best) return null;
        outDoorTarget.x = best.x; outDoorTarget.z = best.z; outDoorTarget.rec = best.rec;
        return outDoorTarget;
      },
      options: [
        {
          id: "aircraft_door_toggle", slot: "e",
          label: function (t) {
            const d = t && CBZ.cityAircraftDoor(t.rec);
            return (d && d.open) ? "Close the door" : "Open the door";
          },
          onSelect: function (t) {
            const d = t && CBZ.cityAircraftDoor(t.rec);
            if (!d) return;
            CBZ.cityAircraftDoorSet(t.rec, !d.open);
          },
        },
      ],
    });
    CBZ.interactions.registerZone({
      id: "airliner_seat", kind: "seat", prio: 4, radius: 1.6,
      find: function () {
        if (!cabinState.inside || cabinState.pending) return null;
        const P = CBZ.player;
        if (!P || P._propSeat) return null;              // already sitting
        const rec = cabinState.rec; if (!rec) return null;
        const s = cabinFreeSeat(rec, 1.6);
        if (!s) return null;
        const w = cabinWorld(rec, s.x, s.z);
        seatTarget.x = w.x; seatTarget.z = w.z; seatTarget.seat = s;
        return seatTarget;
      },
      options: [
        { id: "airliner_sit", slot: "e", label: "Take the seat",
          onSelect: function (t) { if (t && t.seat) cabinSitSeat(t.seat); } },
      ],
    });
  }

  // ============================================================
  //  WHAT THEY ACTUALLY DO  (AIRPORT_STAFF_ROLES)
  //
  //  OWNER: "above pilot should say 'level X Pilot' — and not because
  //  hardcoding, because NPCs should show role and level, role should be what
  //  they actually do."
  //
  //  MEASURED: city/level.js's CBZ.cityTitle() — the ONE function both the
  //  overhead pill (aim_dossier.js tagLabel) and the leaderboard read — did not
  //  look at `a.job` at all. Its chain was vipTitle → kind ("cop"/"security") →
  //  military rank → rampage → bounty → gang rank → ARCH_TITLE[archetype] →
  //  aggr/wealth → "Civilian", so a captain sitting in his own cockpit fell all
  //  the way through to "Lv.N Civilian" no matter what his job said. That half
  //  now lives in level.js, where it fixes every worker in the game at once.
  //
  //  This island owns the OTHER half and it is the half the owner actually
  //  asked for — "role should be what they actually do": every person placed
  //  here carries a truthful job, including the bodies npclife casts into cabin
  //  seats. Deliberately NOT via `vipTitle`, even though cityTitle reads that
  //  first and it would have been one line: vipTitle would ALSO make a baggage
  //  handler read as a celebrity to interactions_rich.js (isVip), a whale to
  //  leaderboard.js and rich to economy.js. A job is not a VIP flag, and buying
  //  the pill with three false side effects is exactly the parallel-bookkeeping
  //  trade CLAUDE.md's block law forbids.
  // ============================================================
  function airportRole(a, job, roleId) {
    if (!a) return a;
    // Census marker, set INDEPENDENTLY of the stamp: an audit that identifies
    // its subjects by the very field it is auditing can only ever report zero,
    // which is how you get a ratchet nobody has actually measured.
    a._airportPlaced = 1;
    if (!job || CBZ.CONFIG.AIRPORT_STAFF_ROLES === false) return a;
    a.job = job;                       // the truth: what this person does
    a._airportRole = roleId || job;
    return a;
  }

  // ============================================================
  //  THE SEAT HOLD  (CABIN_SEATED_V2) — why passengers sat sideways.
  //
  //  npclife.attach() writes the seat's yaw into `group.rotation` ONCE, and
  //  syncAttached() re-asserts speed/state/char.sitting every frame but never
  //  the transform. A cabin passenger stays a full member of CBZ.cityPeds, and
  //  41 files in this repo iterate cityPeds and write `group.rotation.y` with no
  //  `_npcAttached` guard (peds.js is the only file in the codebase that
  //  guards). Those are WORLD-space bearings — `Math.atan2(target.x - ped.pos.x,
  //  target.z - ped.pos.z)`, and ped.pos IS world space for an attached actor —
  //  landing on a group parented to the airliner, so the body settles at
  //  worldBearing − planeHeading: aimed at a lot across the map, rotated by the
  //  parked heading. The two that actually reach a seated tourist are
  //  aigoals.js's face() (its filters are dead/_parked/inCar/controlled/ko — a
  //  seated passenger passes every one) and social.js's couple/friend vignettes
  //  (any ped within 30 m of the player, i.e. precisely when you are standing in
  //  the cabin looking at them).
  //
  //  THE CURE IS OWNERSHIP, NOT A GUARD IN 41 FILES: the seat's transform stops
  //  being a value other systems can win and becomes a truth this island
  //  re-asserts every frame at order 55.2 — after peds.js (34), npclife (33.8),
  //  social.js (34.5/34.6), aigoals and propuse's own hold (42), and before any
  //  onAlways camera read. Absolute writes only, so nothing can accumulate.
  //  It is the same shape as propuse.js's per-frame hold for world furniture;
  //  this is the moving-host twin.
  // ============================================================
  function cabinHoldSeats(hook) {
    const grp = hook && hook.group;
    if (!grp || !grp.parent || hook.active === false || hook.state === "destroyed") return;
    // Only the seats npclife can CAST into (hook.passengerSeats is exactly the
    // list its cabinSeats() reads), so a 216-seat cabin costs ~27 checks a
    // frame, not 216. The player's own seat is owned by cabinForceClear.
    const seats = hook.passengerSeats && hook.passengerSeats.length ? hook.passengerSeats : hook.seats;
    if (!seats || !seats.length) return;
    for (let i = 0; i < seats.length; i++) {
      const s = seats[i], a = s.occupant;
      if (!a || a === CBZ.player) continue;
      const g2 = a.group;
      // STALE-CLAIM TOLERANCE (propuse's rule: correctness never depends on a
      // release call). npclife detaches a body on death/despawn but only clears
      // the seat when the WHOLE cabin is pruned, so a killed passenger used to
      // hold his seat forever and the row could never be re-used or sat in.
      if (!g2 || g2.parent !== grp || a._npcAttached == null || a.culled) { s.occupant = null; continue; }
      // A corpse in the seat is the point of CHAR_SEATED_HITTABLE — let
      // npclife's one-shot slump own the body and never straighten it back up.
      if (a.dead) continue;
      if (CBZ.propArcActive && CBZ.propArcActive(a)) continue;   // someone's arc owns it
      if (g2.position.x !== s.x || g2.position.y !== s.y || g2.position.z !== s.z) {
        g2.position.set(s.x, s.y, s.z);
      }
      const yaw = s.heading == null ? Math.PI / 2 : s.heading;
      const r2 = g2.rotation;
      // pitch/roll are zeroed too: a drafted street body can arrive carrying a
      // knockdown's leftover rotation.z, and nothing in the attached path ever
      // eases it back (peds.js's recovery is in the branch that skips them).
      if (r2.y !== yaw || r2.x !== 0 || r2.z !== 0) r2.set(0, yaw, 0);
      // WHAT THEY DO. npclife picks the CASTING profile from seat.role (only
      // "pilot" buys the uniformed rig), which is why the cabin crew is cast
      // through the pilot profile — but a flight attendant is not a pilot, and
      // the seat is what knows the difference. Stamped straight onto the body,
      // NOT through airportRole(): a drafted citizen is handed back to the
      // street by npclife's releaseProfile (which restores the job it recorded
      // before the profile was applied), and leaving this island's census marker
      // on them afterwards would make them a permanent phantom in the audit.
      if (s.job && a.job !== s.job && CBZ.CONFIG.AIRPORT_STAFF_ROLES !== false) {
        a.job = s.job; a._airportRole = s.job;
      }
    }
  }
  function cabinPassengerHold() {
    if (CBZ.CONFIG.CABIN_SEATED_V2 === false) return;
    for (let i = 0; i < passengerCabins.length; i++) cabinHoldSeats(passengerCabins[i]);
  }

  // WAITING PASSENGERS in the gate lounge — city/beach.js's sunbathers,
  // verbatim: CBZ.cityPostNpc puts an ORDINARY ped on the spot and CBZ.propSit
  // runs the same seat arc a bedroom chair runs. No terminal body, no terminal
  // brain, no terminal update loop. Committed INSTANT on purpose (these bodies
  // were never standing up, so playing the walk-in arc at them would be a person
  // materialising and then climbing onto furniture they are already on), and
  // WHO sits is a position hash, not a draw on the airport build stream.
  // Deferred one-shot: cityMakePed and the ped roster are not guaranteed to
  // exist while the landmass is still building.
  function seatGateLounge() {
    if (gateSeated || !gateSeats.length) return;
    if (!CBZ.cityPostNpc || !CBZ.propSit || !CBZ.cityPeds) return;
    gateSeated = true;
    let n = 0;
    for (let i = 0; i < gateSeats.length && n < GATE_SITTERS; i++) {
      const rec = gateSeats[i];
      if (!rec || rec.occupant) continue;
      if (CBZ.hash01 && CBZ.hash01(rec.x, rec.z, 0xa17e) > 0.34) continue;   // most seats stay empty
      const ped = CBZ.cityPostNpc(rec.x, rec.z, {
        archetype: "tourist", aggr: 0.07, wealth: 0.45, src: "airport:gate-lounge",
      });
      if (!ped) continue;
      airportRole(ped, "traveller", "gate-lounge");
      if (!CBZ.propSit(ped, rec, { instant: true })) {
        if (CBZ.cityUnpostNpc) CBZ.cityUnpostNpc(ped);
        continue;
      }
      n++;
    }
  }

  // ---- THE RATCHET ------------------------------------------------------------
  // Physical-plausibility invariant for aircraft cabin life, the propUseAudit /
  // treeAudit shape. `misaligned` and `roleless` are the two that may only ever
  // read ZERO: a seated passenger whose facing has drifted more than 25° off the
  // seat he is sitting in is the owner's "sideways" bug reappearing, and an
  // airport staffer with no job string is the "role should be what they actually
  // do" bug reappearing. `seats`/`occupied` are census, not pass/fail.
  const MISALIGN = 25 * Math.PI / 180;
  CBZ.cabinAudit = function () {
    let seats = 0, occupied = 0, misaligned = 0, roleless = 0;
    for (let i = 0; i < passengerCabins.length; i++) {
      const hook = passengerCabins[i];
      const list = hook && hook.seats;
      if (!list) continue;
      const grp = hook.group;
      for (let k = 0; k < list.length; k++) {
        const s = list[k];
        if (s.pose === "stand") continue;            // a standing post is not a seat
        seats++;
        const a = s.occupant;
        if (!a || a === CBZ.player) continue;
        const g2 = a.group;
        if (!g2 || g2.parent !== grp || a.dead) continue;   // detached / slumped: not a seated passenger
        occupied++;
        const want = s.heading == null ? Math.PI / 2 : s.heading;
        let d = (g2.rotation.y - want) % (Math.PI * 2);
        if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2;
        // A passenger walking the aisle is deliberately not in his seat and is
        // deliberately not facing it — the deplane arc owns him.
        if (a._deplaning) continue;
        if (Math.abs(d) > MISALIGN || Math.abs(g2.rotation.x) > MISALIGN || Math.abs(g2.rotation.z) > MISALIGN) misaligned++;
        if (!a.job || !String(a.job).trim()) roleless++;    // in a crew seat with no job
      }
    }
    // …and every body this island POSTED on the ground (terminal travellers,
    // ground crew, gate agents). `_airportPlaced` is stamped at placement, never
    // by the role stamp, so removing a role genuinely moves this number.
    const peds = CBZ.cityPeds || [];
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!p || !p._airportPlaced || p.dead) continue;
      if (!p.job || !String(p.job).trim()) roleless++;
    }
    /* THE DEPLANE INVARIANT — `outside` is the owner's bug as a number.
       A body that is still attached to a cabin but is standing OUTSIDE the
       fuselage envelope has left through the wall, which is exactly the thing
       the door arc exists to make impossible. It may only ever read 0.
       `walking`/`queued` are census beside it so a "fix" that simply never
       deplanes anybody cannot pass. */
    const dc = deplaneCensus();
    let outside = 0;
    for (let i = 0; i < deplanes.length; i++) {
      const d = deplanes[i], w = d.walking;
      const an = w && w.a && w.a._npcAttached && w.a._npcAttached.anchor;
      if (!an || !d.cab) continue;
      // the walkable envelope: the cabin box, plus the stair run out of the door
      const sc = d.cab.scale || 1;
      const inCabin = Math.abs(an.z) <= 2.0 * sc && an.x > -14.5 * sc && an.x < 15.0 * sc;
      const onStair = Math.abs(an.x - d.cab.doorX) <= 2.0 * sc &&
        an.z <= d.cab.doorZ + 0.2 && an.z >= d.cab.doorZ - (1.6 * sc + 2.0);
      if (!inCabin && !onStair) outside++;
    }
    return {
      seats: seats, occupied: occupied, misaligned: misaligned, roleless: roleless,
      deplaneArcs: dc.arcs, walking: dc.walking, queued: dc.queued, outside: outside,
    };
  };

  // per-frame: door easing, delayed board/exit, and inside upkeep (clamp the
  // player to the aisle box in plane-local space; bail out cleanly if the
  // plane is stolen, the player dies, or the mode changes)
  CBZ.onUpdate(55.2, function (dt) {
    if (!CBZ.game || CBZ.game.mode !== "city") {
      if (deplanes.length) deplaneReset();     // never freeze a body mid-aisle
      if (cabinState.inside || cabinState.pending) cabinForceClear(true);
      return;
    }
    cabinZones();
    // THE SEAT HOLD runs first, and it runs whether or not the player is
    // anywhere near a plane: the corruption it undoes is written by systems that
    // key off the PLAYER's proximity (social vignettes) and by the goal brain
    // (any time), so a hold gated on "am I aboard" would leave every cabin you
    // can see through the windows sitting wrong.
    cabinPassengerHold();
    // ...and the deplane arc runs immediately after it, for the same reason it
    // is ordered here at all: cabinHoldSeats owns a body while it is IN a seat,
    // this owns it from the moment it stands until its feet are on the apron,
    // and the two can never disagree because a walker's seat record is already
    // cleared (deplaneStand) before the first step is taken.
    deplaneTick(dt);
    seatGateLounge();
    const P = CBZ.player;
    // door panels ease toward open near the player / while boarding / inside
    for (let i = 0; i < placed.length; i++) {
      const rec = placed[i];
      const cab = rec.group && rec.group.userData && rec.group.userData.cabin;
      const hook = cab && cab.passengerCabin;
      if (hook) {
        const state = rec.destroyed ? "destroyed" : (rec.taken ? "taken" : "parked");
        if (state !== hook.state) {
          hook.state = state; hook.active = state !== "destroyed";
          emitPassengerCabin(state, hook, rec);
        }
      }
      // AIRSTAIR rig (private jets): ease the hinged stair door open near the
      // player / while a boarding arc holds it (rec._doorArcOpen — set by
      // aircraft_doors.js during the walk-in choreography).
      const rig = rec.group && rec.group.userData && rec.group.userData.doorRig;
      if (rig && rig.panel && rec.group.parent) {
        let rigOpen = false;
        let rigPlayerCause = false;
        // the boarding arc marks the rec taken the moment the theft commits,
        // so the arc's open-flag must win over the taken gate
        if (rec._doorArcOpen) rigOpen = true;
        else if (!rec.taken) {
          // YOU OWN IT if you set it (see AIRLINER_DOOR_MANUAL); the arc flag
          // above still outranks you, so an automated board/deplane self-opens.
          if (rig.doorManual != null && CBZ.CONFIG.AIRLINER_DOOR_MANUAL !== false) rigOpen = !!rig.doorManual;
          else if (P && !P.dead && !P.driving && !P._aircraft) {
            const dw = cabinWorld(rec, rig.doorX, rig.doorZ);
            rigOpen = Math.hypot(P.pos.x - dw.x, P.pos.z - dw.z) < 3.2;
            rigPlayerCause = rigOpen;
          }
        }
        const rt = rigOpen ? 1 : 0;
        trackPhysicalDoorSound(rig, rig.t, rt, rigPlayerCause);
        if (Math.abs(rig.t - rt) > 0.001) {
          rig.t += (rt - rig.t) * Math.min(1, dt * 2.8);
          rig.panel.rotation.x = rig.closedRot + (rig.openRot - rig.closedRot) * rig.t;
        }
      }
      if (!cab || !cab.panel) continue;
      let wantOpen = false;
      let cabinPlayerCause = false;
      // aircraft_doors.js boarding arc: holds the panel open even though the
      // rec is already marked taken (the theft commits at door-open)
      if (rec._doorArcOpen && rec.group.parent) wantOpen = true;
      else if (!rec.taken && rec.group.parent) {
        if (cabinState.pending && cabinState.pending.rec === rec) {
          wantOpen = true; cabinPlayerCause = true;
        }
        // MANUAL BEATS PROXIMITY, AND AN ARC BEATS MANUAL. Standing inside the
        // cabin used to force the door open for ever — which is precisely why
        // "close the door" had nowhere to live. The board/exit arcs and the
        // deplane still set _doorArcOpen/pending above, so nothing automated
        // can be locked out by a door you shut.
        else if (cab.doorManual != null && CBZ.CONFIG.AIRLINER_DOOR_MANUAL !== false) wantOpen = !!cab.doorManual;
        else if (cabinState.inside && cabinState.rec === rec) {
          wantOpen = true; cabinPlayerCause = true;
        }
        else if (P && !P.dead && !P.driving && !P._aircraft) {
          const d = cabinDoorWorld(rec);
          wantOpen = Math.hypot(P.pos.x - d.x, P.pos.z - d.z) < 3.4;
          cabinPlayerCause = wantOpen;
        }
      }
      // A passenger deplane may own the same arc flag. It is audible only when
      // the player is actually inside this aircraft; an apron animation outside
      // the player's space stays silent.
      if (cabinState.inside && cabinState.rec === rec) cabinPlayerCause = true;
      const tgt = wantOpen ? 1 : 0;
      trackPhysicalDoorSound(cab, cab.doorT, tgt, cabinPlayerCause);
      if (Math.abs(cab.doorT - tgt) > 0.001) {
        cab.doorT += (tgt - cab.doorT) * Math.min(1, dt * 3.2);
        cab.panel.position.x = cab.doorX - 1.18 * AL_SC * cab.doorT;   // slide aft along the hull
      }
      // cockpit pocket door: eases open as the boarded player nears the
      // bulkhead (~2u out), holds while they stand anywhere on the flight
      // deck, eases shut behind them — the same proximity grammar as the
      // boarding panel. Zero work unless the player is inside THIS cabin.
      if (cab.cockpitLeaf) {
        const insideThis = cabinState.inside && cabinState.rec === rec && P && !P.dead && !P.driving && !P._aircraft;
        let wantCock = false;
        if (insideThis) {
          const lp = cabinLocal(rec, P.pos.x, P.pos.z);
          wantCock = lp.x > 10.1 * AL_SC && lp.x < 14.5 * AL_SC && Math.abs(lp.z) < 1.6 * AL_SC;
        }
        const tc = wantCock ? 1 : 0;
        trackPhysicalDoorSound(cab.cockpitLeaf, cab.cockpitT, tc, insideThis);
        if (Math.abs(cab.cockpitT - tc) > 0.001) {
          cab.cockpitT += (tc - cab.cockpitT) * Math.min(1, dt * 5.5);
          cab.cockpitLeaf.position.z = 0.98 * AL_SC * cab.cockpitT;   // pocket into the starboard bulkhead
        }
        // REAL cockpit-door collider (owner: a closed cockpit door must
        // physically stop you, like every other real door). Present ONLY while
        // you are aboard THIS cabin — the only place the flight-deck doorway is
        // reachable — so a parked plane's shut door never becomes a phantom wall
        // out on the apron. The door-easing arc above OWNS its solid state.
        cockpitDoorCollider(rec, cab, insideThis);
      }
    }
    // pending board/exit resolves once the door has had time to slide
    if (cabinState.pending) {
      cabinState.pending.t -= dt;
      if (cabinState.pending.t <= 0) {
        const pend = cabinState.pending;
        cabinState.pending = null;
        if (pend.dir === "in") cabinCompleteBoard(pend.rec);
        else cabinCompleteExit(pend.rec);
      }
    }
    // inside upkeep
    if (cabinState.inside) {
      const rec = cabinState.rec;
      if (!P || P.dead || !rec || !rec.group || !rec.group.parent) { cabinForceClear(true); return; }
      if (P._aircraft || P.driving) { cabinForceClear(false); return; }   // stole it from the cockpit
      if (P._aircraftCabinSeat && !P._propSeat) {
        if (P._aircraftCabinSeat.occupant === P) P._aircraftCabinSeat.occupant = null;
        P._aircraftCabinSeat = null;
      }
      if (!P._propSeat) {
        const l = cabinLocal(rec, P.pos.x, P.pos.z);
        // two rooms + a doorway: cabin aisle box, cockpit box, and a bulkhead
        // band (x 11.9..12.3) you can only cross through the door aperture
        // (|z| ≤ 0.34) while the leaf is mostly open — the walls are real.
        const cabU = rec.group.userData.cabin;
        const cock = cabU && cabU.cockpitLeaf;
        let lx = Math.max(-12.2 * AL_SC, Math.min((cock ? 13.4 : 11.8) * AL_SC, l.x));
        let lz;
        if (!cock || lx < 11.9 * AL_SC) {
          lz = Math.max(-1.42 * AL_SC, Math.min(1.42 * AL_SC, l.z));           // cabin aisle box
        } else if (lx > 12.3 * AL_SC) {
          lz = Math.max(-1.28 * AL_SC, Math.min(1.28 * AL_SC, l.z));           // cockpit room (narrower shell)
        } else if (Math.abs(l.z) <= 0.34 * AL_SC && cabU.cockpitT > 0.5) {
          lz = l.z;                                            // clean pass through the open leaf
        } else {
          lx = l.x < 12.1 * AL_SC ? 11.9 * AL_SC : 12.3 * AL_SC;               // solid bulkhead / shut leaf
          lz = Math.max(-1.42 * AL_SC, Math.min(1.42 * AL_SC, l.z));
        }
        if (lx !== l.x || lz !== l.z) {
          const w = cabinWorld(rec, lx, lz);
          P.pos.x = w.x; P.pos.z = w.z;
        }
      }
    }
  });

  // ---- region geometry ----
  // The west side is deliberately the long side of the field: Neon Reef ends
  // at x=-950, leaving a clean 50 m water/terrain seam before this footprint.
  // That unused land lets the airport carry a runway which actually reads at
  // aircraft scale without pushing east into Diamond Speedway.
  const _WOFF = (CBZ.worldOff && CBZ.worldOff("airport")) || { dx: 0, dz: 0 };   // world-layout dial (zero today)
  const A_MINX = -900 + _WOFF.dx, A_MAXX = 290 + _WOFF.dx, A_MINZ = -280 + _WOFF.dz, A_MAXZ = 40 + _WOFF.dz;
  // causeway widened to the 24m highway deck (x∈[-12,12]). The NORTH end
  // (CW_MINZ, mainland shore) is pinned; the south end lands on the field's
  // north edge and tracks the dial with it. The x-lane never moves — it is
  // the mainland's slip — which is what caps this island's dx (the field's
  // east edge must keep a shoulder east of the deck).
  const CW_MINX = -12, CW_MAXX = 12, CW_MINZ = -566, CW_MAXZ = A_MINZ;

  // ---- shared palette (one bucket per colour → batcher collapses them) ----
  const C_TARMAC = 0x3c3f44;   // apron / taxiway asphalt
  const C_RUNWAY = 0x2c2f33;   // darker runway asphalt
  const C_GRASS  = 0x5d7c46;   // infield grass
  const C_PAINT  = 0xeef1f4;   // white runway paint
  const C_YELLOW = 0xd8b53a;   // taxiway centreline / hold lines
  const C_CONC   = 0x9aa0a6;   // concrete kerb / terminal slab
  const C_METAL  = 0xb9c0c8;   // fuselage aluminium
  const C_DKMET  = 0x6b7178;   // engines / underbelly
  const C_GLASS  = 0x9fc7df;   // tower cab + terminal glass
  const C_FENCE  = 0x8a9099;   // chain-link tone

  CBZ.addLandmass(function (city) {
    const root = city.root;
    armRng();
    // a city rebuild re-runs this builder → fresh plane groups. Clear the capture
    // + one-shot guard so the rebuilt fleet re-registers as boardable, and
    // drop any stale cabin-boarding state (platform/collider refs die with
    // the old groups).
    placed.length = 0; _reg = false; deplaneReset(); cabinReset(); resetPassengerCabins();
    // the gate-lounge anchors die with the propuse reset cityBuildings already
    // ran (it runs BEFORE the landmass hooks), so only our index needs clearing
    gateSeats.length = 0; gateSeated = false;
    // the taxi rank re-arms with the world; its cars are ordinary parked
    // records (cleared by clearCars) and its drivers are citystaff posts
    // (cleared with the venue), so only our own index needs resetting.
    taxiRank.length = 0; rankDone = false;
    towerDone = false; towerPlatsClear();
    if (CBZ.cityStaffVenue) {
      try { CBZ.cityStaffVenue("airport-rank", { stations: 0 }); } catch (e) {}
      try { CBZ.cityStaffVenue("airport-tower", { stations: 0 }); } catch (e) {}
    }

    const BGU = THREE.BufferGeometryUtils;

    // ---- helpers --------------------------------------------------------
    // flat box mesh
    function box(x, y, z, w, h, d, color, opts) {
      opts = opts || {};
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
        opts.emissive ? mat(color, { emissive: opts.emissive, ei: opts.ei || 0.5 }) : mat(color));
      m.position.set(x, y, z);
      if (opts.ry) m.rotation.y = opts.ry;
      m.castShadow = !!opts.cast; m.receiveShadow = opts.receive !== false;
      root.add(m);
      return m;
    }
    // a solid collider (and optional y-gating for things you can drive under)
    function solid(x, z, w, d, y0, y1, ref) {
      const c = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, ref: ref || null };
      if (y0 != null) c.y0 = y0;
      if (y1 != null) c.y1 = y1;
      CBZ.colliders.push(c);
      return c;
    }
    function aircraftSolid(group, dims) {
      // No broad-phase rectangle around parked aircraft. It was necessarily
      // larger than the tapered visual hull, blocking the player before they
      // reached the door and catching bullets in mid-air. Boarding uses the
      // oriented footprint and gunfire now raycasts the actual meshes.
      return null;
    }
    // a flat painted quad lying on the ground (collected for merging)
    function quadGeo(x, z, w, d, y) {
      const g = new THREE.PlaneGeometry(w, d);
      g.rotateX(-Math.PI / 2);
      g.translate(x, y == null ? 0.02 : y, z);
      return g;
    }
    function mergePaint(geoms, color, y) {
      if (!geoms.length) return;
      const pm = mat(color).clone();
      pm.polygonOffset = true; pm.polygonOffsetFactor = -2; pm.polygonOffsetUnits = -6;
      if (BGU && BGU.mergeBufferGeometries) {
        const m = new THREE.Mesh(BGU.mergeBufferGeometries(geoms), pm);
        m.receiveShadow = true; m.castShadow = false; m.matrixAutoUpdate = false;
        root.add(m);
      } else {
        for (const gm of geoms) { const m = new THREE.Mesh(gm, pm); m.receiveShadow = true; root.add(m); }
      }
    }

    // The airfield's own coordinate system (runway/taxiway/apron + all the
    // hardware parked on it) rides the SAME dial as the A_* footprint, so
    // the island translates as one rigid piece. The canvas paint mapping is
    // (world - A_MINX)/gw — the offset cancels, so paint lands identically
    // on the moved grass.
    const ADX = _WOFF.dx, ADZ = _WOFF.dz;
    const RWY_Z = -90 + ADZ;      // runway centre line (z)
    const RWY_W = 30;             // width
    const RWY_X0 = -850 + ADX, RWY_X1 = 240 + ADX, RWY_LEN = RWY_X1 - RWY_X0;
    const RWY_CX = (RWY_X0 + RWY_X1) / 2;
    const TAX_Z = RWY_Z + 50;     // taxiway centre
    const APRON_Z = 0 + ADZ;      // ramp/apron centre (south, by terminal)
    const APRON_X = -40 + ADX;    // apron/terminal centreline (x)
    const CONN_XS = [-160 + ADX, 80 + ADX];   // runway->apron connector taxiways
    /* THE TERMINAL FOOTPRINT, PUBLISHED ONCE (AIRPORT_ENTRY_V2). It used to be
       four literals inside buildTerminal(), which is why the fence, the kerb
       and the forecourt could each hold a different idea of where the building
       stops — and a fence that disagrees with the frontage by a metre is a
       fence standing in the drop-off. Everything landside now derives from
       these four numbers. */
    const TERM_W = 150, TERM_D = 26;
    const TERM_Z = 24 + ADZ;                       // terminal centre (z)
    const TERM_X0 = APRON_X - TERM_W / 2;          // -115 + ADX
    const TERM_X1 = APRON_X + TERM_W / 2;          //   35 + ADX
    const TERM_FRONT = TERM_Z + TERM_D / 2;        //   37 + ADZ — the DOORS face +z
    const FRONT_Z = A_MAXZ;                        //   40 + ADZ — the island's north edge
    const KERB_Z = 38.5 + ADZ;                     // the drop-off lane (the road record's own z)
    const PERIM_X = A_MAXX - 22;                   //  268 + ADX — the east perimeter spur

    // =====================================================================
    //  1) ONE AIRFIELD SURFACE — grass, runway, taxiway and apron are baked
    //     into one texture on one plane.  The old five nearly-coplanar slabs
    //     were the airport flicker: at flight distance their 0.1m separation
    //     collapsed to the same depth value and green won through asphalt.
    // =====================================================================
    (function ground() {
      const gw = A_MAXX - A_MINX, gd = A_MAXZ - A_MINZ;
      const canvas = document.createElement("canvas");
      canvas.width = 2048; canvas.height = 1024;
      const ctx = canvas.getContext("2d");
      function css(c) { return "#" + (c >>> 0).toString(16).padStart(6, "0"); }
      function rect(x, z, w, d, color) {
        ctx.fillStyle = css(color);
        ctx.fillRect((x - w / 2 - A_MINX) / gw * canvas.width,
          (z - d / 2 - A_MINZ) / gd * canvas.height,
          w / gw * canvas.width, d / gd * canvas.height);
      }
      function runwayText(text, x, z, worldSize, rotation) {
        ctx.save();
        ctx.translate((x - A_MINX) / gw * canvas.width, (z - A_MINZ) / gd * canvas.height);
        ctx.rotate(rotation || 0);
        ctx.fillStyle = css(C_PAINT);
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.font = "900 " + Math.max(14, worldSize / gd * canvas.height) + "px Arial Black, sans-serif";
        ctx.fillText(text, 0, 0);
        ctx.restore();
      }
      ctx.fillStyle = css(C_GRASS); ctx.fillRect(0, 0, canvas.width, canvas.height);
      // restrained mowing bands add scale without another geometry layer
      ctx.globalAlpha = 0.08; ctx.fillStyle = "#8aa96b";
      for (let z = A_MINZ; z < A_MAXZ; z += 28) rect((A_MINX + A_MAXX) / 2, z + 7, gw, 14, 0x8aa96b);
      ctx.globalAlpha = 1;
      rect(RWY_CX, RWY_Z, RWY_LEN, RWY_W, C_RUNWAY);
      rect(RWY_CX, TAX_Z, RWY_LEN - 20, 18, C_TARMAC);
      rect(APRON_X, APRON_Z + 6, 260, 80, C_TARMAC);
      // CONNECTOR TAXIWAYS — apron <-> taxiway. The depth used to be written
      // `TAX_Z - APRON_Z + 30`, and TAX_Z is NORTH of APRON_Z (RWY_Z+50 = -40
      // against 0), so that expression is -40 + 30 = **-10**: a NEGATIVE depth.
      // The two connectors were therefore 10 m stubs sitting at z in [-35,-25]
      // instead of the ~50 m ribbons that actually join the ramp to the
      // taxiway — the airfield has been missing its connectors for their whole
      // life, and it is why nothing could taxi off the apron. Absolute span,
      // plus 10 m of overrun at each end so the joins are not hairline.
      const CONN_D = Math.abs(TAX_Z - APRON_Z) + 20;
      const CONN_CZ = (TAX_Z + APRON_Z) / 2;
      for (const cx of CONN_XS) rect(cx, CONN_CZ, 16, CONN_D, C_TARMAC);

      // runway white paint
      rect(RWY_CX, RWY_Z - RWY_W / 2 + 0.6, RWY_LEN - 8, 0.6, C_PAINT);
      rect(RWY_CX, RWY_Z + RWY_W / 2 - 0.6, RWY_LEN - 8, 0.6, C_PAINT);
      const dashL = 6, step = 12;
      for (let x = RWY_X0 + 24; x < RWY_X1 - 24; x += step) rect(x + dashL / 2, RWY_Z, dashL, 0.5, C_PAINT);
      for (const endSgn of [-1, 1]) {
        const baseX = endSgn < 0 ? RWY_X0 + 5 : RWY_X1 - 19;
        for (let k = 0; k < 8; k++) rect(baseX + 7, RWY_Z - RWY_W / 2 + 2.2 + k * 3.4, 14, 1.4, C_PAINT);
      }
      for (const ax of [RWY_X0 + 60, RWY_X1 - 60]) {
        rect(ax, RWY_Z - 4.5, 18, 2.2, C_PAINT);
        rect(ax, RWY_Z + 4.5, 18, 2.2, C_PAINT);
      }
      // Designators are PAINT in the same authoritative surface texture, not
      // floating sprites hovering above the runway.
      runwayText("09", RWY_X0 + 29, RWY_Z, 9, Math.PI / 2);
      runwayText("27", RWY_X1 - 29, RWY_Z, 9, -Math.PI / 2);
      // taxiway yellow centrelines and hold bars
      rect(RWY_CX, TAX_Z, RWY_LEN - 24, 0.5, C_YELLOW);
      for (const cx of CONN_XS) {
        // same negative-depth bug as the tarmac above — the centreline was
        // -16 deep, so the connectors had no visible guidance line either.
        rect(cx, CONN_CZ, 0.5, Math.abs(TAX_Z - APRON_Z) + 14, C_YELLOW);
        for (let i = 0; i < 4; i++) rect(cx, TAX_Z - 14 - i * 0.9, 14, 0.4, C_YELLOW);
      }
      const tex = new THREE.CanvasTexture(canvas);
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.generateMipmaps = true;
      tex.anisotropy = Math.min(8, CBZ.renderer && CBZ.renderer.capabilities ? CBZ.renderer.capabilities.getMaxAnisotropy() : 1);
      const grass = new THREE.Mesh(new THREE.PlaneGeometry(gw, gd), new THREE.MeshLambertMaterial({ color: 0xffffff, map: tex }));
      grass.rotation.x = -Math.PI / 2;
      // Keep one deliberate depth layer above the continent underlay. 8cm is
      // visually flush but remains separable in the far camera's depth buffer.
      grass.position.set((A_MINX + A_MAXX) / 2, 0.08, (A_MINZ + A_MAXZ) / 2);
      grass.receiveShadow = true; grass.matrixAutoUpdate = false; grass.updateMatrix();
      grass.userData.terrain = true; grass.userData.worldSurface = true;
      grass.userData.surfaceOwner = "airport";
      grass.userData.unifiedSurface = true;
      grass.name = "airport-island-surface";
      root.add(grass);
    })();

    // =====================================================================
    //  2) RUNWAY 09/27 — E-W, 1,090 long × 30 wide, centred north of mid.
    //     Real markings: solid edge lines, dashed centreline, threshold
    //     "piano keys", runway designator numbers, aiming-point bars.
    // =====================================================================
    // Runway numbers are already painted into the unified surface above.

    // =====================================================================
    //  3) EDGE LIGHTS — ONE InstancedMesh down both runway edges + the
    //     taxiway/apron edge. Emissive amber so they glow at night. This is
    //     the single biggest "repeat" on the field, so it MUST be instanced.
    // =====================================================================
    (function edgeLights() {
      const positions = [];
      // runway edge lights every 18m, both sides
      for (let x = RWY_X0; x <= RWY_X1; x += 18) {
        positions.push([x, RWY_Z - RWY_W / 2 - 0.8]);
        positions.push([x, RWY_Z + RWY_W / 2 + 0.8]);
      }
      // taxiway centreline studs (green-ish but reuse amber pool to stay 1 mesh)
      for (let x = RWY_X0 + 10; x <= RWY_X1 - 10; x += 24) positions.push([x, RWY_Z + RWY_W / 2 + 26]);
      const geo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
      const m = mat(0xffb648, { emissive: 0xffb648, ei: 0.9 });
      const inst = new THREE.InstancedMesh(geo, m, positions.length);
      inst.castShadow = false; inst.receiveShadow = false;
      const dummy = new THREE.Object3D();
      for (let i = 0; i < positions.length; i++) {
        dummy.position.set(positions[i][0], 0.25, positions[i][1]);
        dummy.updateMatrix(); inst.setMatrixAt(i, dummy.matrix);
      }
      inst.instanceMatrix.needsUpdate = true;
      root.add(inst);
    })();

    // =====================================================================
    //  4) TAXIWAY (parallel to runway, to its south) + APRON pad in front
    //     of the terminal. Asphalt strips with yellow centrelines.
    // =====================================================================
    // Taxiway/apron asphalt and paint are part of the unified ground texture.

    // =====================================================================
    //  5) TERMINAL — enterable concourse via cityMakeBuilding. A long, low
    //     glass shell facing the apron. Inside: seat rows (instanced),
    //     check-in desks, a gate sign. Door faces the causeway (south).
    // =====================================================================
    let terminal = null;
    (function buildTerminal() {
      const tx = APRON_X, tz = TERM_Z, tw = TERM_W, td = TERM_D;
      // doorSide 1 = +z (faces causeway/landside). retail glass = clear.
      terminal = CBZ.cityMakeBuilding(root, tx, tz, tw, td, 1, 0x6f8ba0, 1,
        { retail: true, glassKind: "clear", stairs: false });
      city.airportTerminal = terminal;
      if (terminal && terminal.group) {
        // One identity group keeps the terminal's world-authored coordinates
        // unchanged while giving the interior audit an exact fixture owner.
        const grp = new THREE.Group();
        const terminalAuditBoxes = [];
        root.add(grp);
        function terminalBox(x, y, z, w, h, d, color, opts) {
          const m = box(x, y, z, w, h, d, color, opts);
          m.userData.interiorAuditIgnore = true;
          grp.add(m); // grp is identity, so the box keeps its world transform
          terminalAuditBoxes.push({
            name: "terminal-check-in",
            minX: x - w / 2, maxX: x + w / 2,
            minY: y - h / 2, maxY: y + h / 2,
            minZ: z - d / 2, maxZ: z + d / 2,
          });
          return m;
        }
        const ix0 = tx - tw / 2 + 4, ix1 = tx + tw / 2 - 4;
        const fz = tz;    // concourse centre z

        // check-in desks along the landside wall (4 desks)
        for (let k = 0; k < 4; k++) {
          const dx = tx - tw / 2 + 20 + k * 30;
          terminalBox(dx, 0.55, tz + td / 2 - 3, 8, 1.1, 2.2, 0xc9cfd6, { cast: true });
          terminalBox(dx, 1.15, tz + td / 2 - 3, 8, 0.1, 2.4, 0x2b2f34);   // counter top
          solid(dx, tz + td / 2 - 3, 8, 2.4, 0, 1.2);
        }

        // =============================================================
        //  GATE LOUNGE (TERMINAL_GATE_SEATS) — beam benches you can sit on.
        //
        //  The old "seat rows" were 63 lone 0.6-cube blocks whose top face sat
        //  at 0.775 m, spread SIX METRES apart across the concourse, with no
        //  anchor of any kind: nothing in the game could sit on them and no
        //  arrangement of them read as a waiting area. Same diorama defect as
        //  the cabin, same cure — real furniture dimensions (0.44 m cushion,
        //  0.55 m seat width, 0.45 m back, armrest between every seat) in real
        //  4-seat beam clusters, and every seat DECLARES its cushion to
        //  propuse.js so a body gets character.js's feet-on-the-floor solve
        //  instead of the legacy squat. Four instanced meshes, so the whole
        //  lounge is four draws.
        // =============================================================
        const GATE_CUSH = (CBZ.propSeatHeight ? +CBZ.propSeatHeight("waiting") : 0) || 0.44;
        const GATE_W = 0.55, GATE_D = 0.50, GATE_BACK = 0.45, GATE_ARM = 0.18;
        const PER_BENCH = 4, ROW_GAP = 2.6, BENCH_N = 6;
        const cush = [], back = [], arms = [], beams = [];
        for (let r = 0; r < 3; r++) {
          const sz = tz - td / 2 + 5 + r * ROW_GAP;
          for (let c = 0; c < BENCH_N; c++) {
            // clusters sit under the gate signage, not smeared end to end
            const bx = tx - 60 + c * 24;
            if (bx < ix0 + 2 || bx > ix1 - 2) continue;
            beams.push([bx, sz]);
            for (let s = 0; s < PER_BENCH; s++) {
              const sx = bx + (s - (PER_BENCH - 1) / 2) * GATE_W;
              cush.push([sx, sz]);
              back.push([sx, sz]);
              // seats face the apron glass (-z): body looks along (sin f, cos f)
              if (CBZ.propRegisterSeat && CBZ.CONFIG.TERMINAL_GATE_SEATS !== false) {
                // requireEntry: the concourse interior is furnished by
                // cityMakeBuilding, not by this file, so we cannot promise the
                // floor in front of every bench is walkable. Anything boxed in
                // is dropped rather than registered as a chair nothing can
                // reach — propUseAudit().blocked can only fall from here.
                const rec = CBZ.propRegisterSeat(sx, 0, sz, Math.PI, "waiting", null,
                  { cushion: GATE_CUSH, floorBelow: 0, requireEntry: true });
                if (rec) gateSeats.push(rec);
              }
            }
            for (let a = 0; a <= PER_BENCH; a++) arms.push([bx + (a - PER_BENCH / 2) * GATE_W, sz]);
          }
        }
        const dm = new THREE.Object3D();
        function inst(list, geo, m, y, dz, cast) {
          if (!list.length) return;
          const im = new THREE.InstancedMesh(geo, m, list.length);
          im.castShadow = !!cast; im.receiveShadow = true;
          for (let i = 0; i < list.length; i++) {
            dm.position.set(list[i][0], y, list[i][1] + dz);
            dm.updateMatrix(); im.setMatrixAt(i, dm.matrix);
          }
          im.instanceMatrix.needsUpdate = true; grp.add(im);
        }
        inst(cush, new THREE.BoxGeometry(GATE_W - 0.03, 0.10, GATE_D), mat(0x35506e), GATE_CUSH - 0.05, 0, true);
        inst(back, new THREE.BoxGeometry(GATE_W - 0.03, GATE_BACK, 0.08), mat(0x2a4360), GATE_CUSH + GATE_BACK / 2, GATE_D / 2 - 0.02, true);
        inst(arms, new THREE.BoxGeometry(0.06, 0.05, 0.42), mat(0x8d959d), GATE_CUSH + GATE_ARM, -0.02, false);
        inst(beams, new THREE.BoxGeometry(PER_BENCH * GATE_W + 0.12, 0.30, 0.14), mat(0x6b7178), 0.16, 0, false);
        if (CBZ.interiorTrackFixture) CBZ.interiorTrackFixture(
          "airport-terminal", terminal, grp, { boxes: terminalAuditBoxes });

        if (CBZ.makeLabelSprite) {
          const s = CBZ.makeLabelSprite("INTERNATIONAL TERMINAL", { color: "#dfeaff" });
          if (s) { s.position.set(tx, 5.2, tz + td / 2 + 0.4); s.scale.set(20, 2.4, 1); root.add(s); }
          const g1 = CBZ.makeLabelSprite("GATES A1–A8 →", { color: "#ffd451" });
          if (g1) { g1.position.set(tx + 40, 3.0, fz - td / 2 + 1.5); g1.scale.set(12, 1.6, 1); root.add(g1); }
        }
      }
    })();

    // =====================================================================
    //  6) CONTROL TOWER — a tall shaft with a glass cab on top, set beside
    //     the apron with a clear sightline down the runway. Solid collider.
    // =====================================================================
    /* THE TOWER IS A WORKPLACE, NOT A SILHOUETTE (AIRPORT_ENTRY_V2).
       OWNER (2026-07-28, verbatim): "theres the tall glass building that looks
       like a cool radio tower but its a dumb empty prop."

       It was: a shaft, a glass box and a collider that sealed the whole thing
       from y=0 to y=40. Nothing to open, nothing to climb, nobody inside.
       What it gets is the three things that make any building in this game
       real, and each is an EXISTING block rather than a tower system:
         • a DOORWAY — the shaft collider splits either side of a real opening,
           which is the elevator/door grammar reduced to its honest minimum for
           a structure cityMakeBuilding never built;
         • a CLIMB — a switchback stair core of platform records, so the cab is
           reachable on foot the same way every occupied floor in the game is;
         • a WORKER — CBZ.cityStaffPost, job "air traffic controller", seated at
           a console in the cab and visible through the glass.
       The beacon it already had stays; the cab gets a floodlight bar so it
       reads as lit from the apron at night. */
    (function controlTower() {
      const cxp = -180 + ADX, czp = 30 + ADZ, base = 4.5, H = 34;
      const V2 = CBZ.CONFIG.AIRPORT_ENTRY_V2 !== false;
      // shaft
      box(cxp, H / 2, czp, base, H, base, 0xb6bdc4, { cast: true });
      if (!V2) {
        solid(cxp, czp, base, base, 0, H + 6);
      } else {
        /* THE DOORWAY. One collider became three: the shaft is solid above the
           head height of the opening, and the ground band is split into the two
           jambs either side of it. The door faces +z (the apron/terminal side,
           which is where anybody walking here comes from). */
        const DW = 1.6, DH = 2.5;                       // clear opening
        const jamb = (base - DW) / 2;
        solid(cxp, czp, base, base, DH, H + 6);         // everything above the head
        solid(cxp - (DW + jamb) / 2, czp, jamb, base, 0, DH);   // west jamb
        solid(cxp + (DW + jamb) / 2, czp, jamb, base, 0, DH);   // east jamb
        solid(cxp, czp - base / 2 + 0.15, DW, 0.3, 0, DH);      // …and the back wall behind it
        // the door leaf itself, standing open against the jamb — an opening you
        // can SEE is what stops this reading as a hole in a wall.
        const leaf = box(cxp + DW / 2 + 0.12, DH / 2, czp + base / 2 + 0.22, 0.09, DH, DW * 0.92,
          0x3e4a56, { cast: true });
        leaf.rotation.y = 0.5;
        box(cxp, DH + 0.35, czp + base / 2 + 0.06, DW + 0.7, 0.5, 0.35, 0x2f3a46,
          { cast: true, emissive: 0x1d3550, ei: 0.3 });   // door head / sign band
      }
      // cab (wider glass box) + roof + dish — OWNER RULE (bda61ab): no gray
      // panes; the cab is the same clear tinted glass as every city facade.
      // mat() is fresh-per-call so mutating is safe; transparent keeps it out
      // of batch.js's opaque merge. cast:false — clear glass throws no shadow.
      const cab = box(cxp, H + 1.6, czp, base + 4, 3.2, base + 4, 0xbfe9f7, { cast: false, emissive: 0x3f8aa6, ei: 0.5 });
      cab.material.transparent = true; cab.material.opacity = 0.6;
      box(cxp, H + 3.6, czp, base + 4.6, 0.6, base + 4.6, 0x3a4046, { cast: true }); // cab roof
      box(cxp, H + 4.6, czp - 1, 0.3, 1.4, 0.3, 0xd24a3a, { emissive: 0xff5a4a, ei: 0.9 }); // beacon
      if (CBZ.makeLabelSprite) {
        const s = CBZ.makeLabelSprite("TWR", { color: "#cfe3ff" });
        if (s) { s.position.set(cxp, H + 1.6, czp + base + 2.2); s.scale.set(5, 2.6, 1); root.add(s); }
      }
      if (!V2) return;

      /* THE CLIMB. A switchback stair core of PLATFORM records — the same
         CBZ.platforms the airliner cabin deck stands on, so the player's own
         physics carries them up with nothing new to write. Twelve flights of
         four treads wrapping the shaft's inner face; each landing is a
         platform you can stand on and each tread is a step under physics.js's
         0.45 STEP_UP, which is what makes it climbable rather than decorative. */
      /* THE RISER IS PINNED AT 0.42 BECAUSE physics.js's STEP_UP IS 0.45 — the
         same constraint arena_venue.js's bowl is built to. And the flight
         wraps OUTSIDE the shaft, not inside it: the shaft is a solid collider
         from the door head to the cab, so a tread within base/2 of the axis
         would put a climber inside it and the resolver would shove them off.
         WR is therefore derived from the shaft, not chosen — half the shaft
         plus a body's shoulder — and the treads (1.4 m wide) clear the
         collider face by 0.15 m while still landing under the cab's own
         overhang (half of base+4 = 4.25) so the top step is on the floor. */
      const RISE = 0.42;
      const WR = base / 2 + 0.85;                       // 3.10 — outside the shaft
      const PER_LEG = 8;
      const steps = Math.ceil(H / RISE);
      const stairs = [];
      for (let s = 0; s < steps; s++) {
        const y = (s + 1) * RISE;
        if (y > H + 1.2) break;
        // four legs round the shaft, turning the corner at each landing
        const leg = (s / PER_LEG | 0) % 4;
        const off = ((s % PER_LEG) / PER_LEG - 0.5) * 2 * WR;
        let sx = cxp, sz = czp;
        if (leg === 0) { sx = cxp + off; sz = czp - WR; }
        else if (leg === 1) { sx = cxp + WR; sz = czp + off; }
        else if (leg === 2) { sx = cxp - off; sz = czp + WR; }
        else { sx = cxp - WR; sz = czp - off; }
        stairs.push([sx, y, sz]);
        if (CBZ.platforms) {
          const pr = { minX: sx - 0.7, maxX: sx + 0.7, minZ: sz - 0.7, maxZ: sz + 0.7, top: y };
          CBZ.platforms.push(pr); towerPlats.push(pr);
        }
      }
      if (stairs.length && BGU && BGU.mergeBufferGeometries) {
        const gs = [];
        for (let i = 0; i < stairs.length; i++) {
          const g = new THREE.BoxGeometry(1.4, 0.10, 1.4);
          g.translate(stairs[i][0], stairs[i][1] - 0.05, stairs[i][2]);
          gs.push(g);
        }
        const sm = new THREE.Mesh(BGU.mergeBufferGeometries(gs), mat(0x767d85));
        sm.castShadow = false; sm.receiveShadow = true;
        sm.matrixAutoUpdate = false; root.add(sm);
      }
      // the cab FLOOR — the top landing, and the deck the controller's chair
      // and console stand on.
      const CAB_Y = H + 0.05;
      if (CBZ.platforms) {
        const cf = {
          minX: cxp - (base + 4) / 2, maxX: cxp + (base + 4) / 2,
          minZ: czp - (base + 4) / 2, maxZ: czp + (base + 4) / 2, top: CAB_Y,
        };
        CBZ.platforms.push(cf); towerPlats.push(cf);
      }
      box(cxp, CAB_Y - 0.06, czp, base + 4, 0.12, base + 4, 0x4a5158, { cast: false });

      // ---- THE CONSOLE. A desk arc facing the runway (-z, down the field),
      //      with a lit screen bank — what an air traffic controller sits at.
      const DESK_Z = czp - 1.9;
      box(cxp, CAB_Y + 0.42, DESK_Z, 4.6, 0.10, 0.9, 0x2b3138, { cast: false });   // worktop
      box(cxp, CAB_Y + 0.20, DESK_Z, 4.4, 0.44, 0.7, 0x3c444c, { cast: false });   // pedestal
      box(cxp, CAB_Y + 0.86, DESK_Z - 0.28, 3.6, 0.78, 0.08,
        0x1d5f74, { emissive: 0x3fc6e6, ei: 0.75, cast: false });                  // screen bank
      // cab floodlight bar — one emissive strip under the roof, no light object.
      box(cxp, H + 3.15, czp, base + 3.4, 0.10, 0.22,
        0xfff0cf, { emissive: 0xffe6b0, ei: 0.8, cast: false });

      /* ---- THE CONTROLLER. cityStaffPost, so the body exists only when
         somebody could see the cab and is reaped when they leave. The trade
         itself is NOT declared here: "air traffic controller" is a row in
         citystaff.js's TRADES table, which is the additive merge that already
         gives 27 venue jobs a workplace, a shift and a wage — so this job has
         all three instead of being label #121 aigoals never heard of. */
      if (CBZ.onUpdate && CBZ.cityStaffPost) {
        CBZ.onUpdate(55.37, function () {
          if (towerDone) return;
          if (!CBZ.game || CBZ.game.mode !== "city") return;
          if (!CBZ.city || !CBZ.city.arena) return;
          towerDone = true;
          if (CBZ.cityStaffVenue) {
            try { CBZ.cityStaffVenue("airport-tower", { stations: 1, note: "the cab" }); } catch (e) {}
          }
          CBZ.cityStaffPost({
            venue: "airport-tower", id: "airport:twr:1",
            job: "air traffic controller", archetype: "office",
            // he STANDS at the console rather than riding a chair anchor: the
            // cab floor is a platform record, and a posted body pinned on it
            // holds whatever height we spawn it at (peds.js's staffPost branch
            // returns from move() before the y-clamp) — which is exactly why
            // this one is posted UNSEATED and needs no seat at all.
            x: cxp, z: DESK_Z + 1.0, face: Math.PI,
            opts: { floorY: CAB_Y },
            pose: "foldarms",
            near: 260, far: 420,        // he is 34 m up: you see him from further out
            after: function (ped) { ped.job = "air traffic controller"; ped._airportPlaced = true; },
          });
        });
      }
    })();

    // =====================================================================
    //  7) AIRCRAFT — airliner + private-jet builders. These are the EXACT
    //     groups the player flies (the civil steal path in playeraircraft.js
    //     attaches the flight state to the parked group), so the airframes
    //     are sculpted properly: position-attribute tapered noses/tailcones
    //     (the aircraft.js taperBox pattern adapted to these +X-nosed
    //     models), real two-tone liveries, nacelles with intake rings,
    //     bogie gear and nav lights. CONTRACT KEPT: group root at ground
    //     level (wheels touch y=0, groundOffset 0), nose down local +X,
    //     same footprint/centreline heights, worldCollider via solid().
    //     Draw discipline: every material's parts merge into ONE child mesh
    //     (~12 draws per plane — fewer than the old loose-box builders).
    // =====================================================================
    // ---- local sculpt helpers (aircraft.js:44 taperBox pattern, r128) ----
    // fuseGeo: box whose Y/Z cross-section lerps from `tail` scale (-X end)
    // to `nose` scale (+X end); noseY/tailY shift those ends vertically
    // (quadratic — droops a cockpit, upsweeps a tailcone).
    function fuseGeo(len, h, d, o) {
      o = o || {};
      const sN = o.nose != null ? o.nose : 1, sT = o.tail != null ? o.tail : 1;
      const yN = o.noseY || 0, yT = o.tailY || 0;
      const geo = new THREE.BoxGeometry(len, h, d, o.seg || 5, 2, 2);
      const pos = geo.attributes.position, hl = len / 2;
      for (let i = 0; i < pos.count; i++) {
        const t = (pos.getX(i) + hl) / len;              // 0 tail end → 1 nose end
        const s = sT + (sN - sT) * t;
        pos.setY(i, pos.getY(i) * s + yN * t * t + yT * (1 - t) * (1 - t));
        pos.setZ(i, pos.getZ(i) * s);
      }
      pos.needsUpdate = true; geo.computeVertexNormals();
      return geo;
    }
    // wingGeo: ONE symmetric wing pair — chord tapers root→tip, tips sweep
    // aft (-X) and rise (dihedral). Also used for tailplanes.
    function wingGeo(span, rootC, tipC, th, sweep, dihedral) {
      const geo = new THREE.BoxGeometry(rootC, th, span, 2, 1, 6);
      const pos = geo.attributes.position, hs = span / 2;
      for (let i = 0; i < pos.count; i++) {
        const t = Math.abs(pos.getZ(i)) / hs;            // 0 root → 1 tip
        pos.setX(i, pos.getX(i) * (1 + (tipC / rootC - 1) * t) - sweep * t);
        pos.setY(i, pos.getY(i) + (dihedral || 0) * t);
      }
      pos.needsUpdate = true; geo.computeVertexNormals();
      return geo;
    }
    // finGeo: vertical stabiliser — chord tapers with height, sweeps aft.
    function finGeo(h, rootC, tipC, th, sweep) {
      const geo = new THREE.BoxGeometry(rootC, h, th, 2, 6, 1);
      const pos = geo.attributes.position, hh = h / 2;
      for (let i = 0; i < pos.count; i++) {
        const t = (pos.getY(i) + hh) / h;                // 0 base → 1 tip
        pos.setX(i, pos.getX(i) * (1 + (tipC / rootC - 1) * t) - sweep * t);
      }
      pos.needsUpdate = true; geo.computeVertexNormals();
      return geo;
    }
    // fleet materials — carfx vehicle roles when available (metal sheen and
    // reflective glass beat flat Lambert on an airframe), pooled mat()
    // fallback. carfx's shared roles are _shared-flagged against disposal;
    // paint roles are per-colour and live as long as the airport root.
    function vmat(role, color, opts) {
      if (CBZ.vehicleMat) { try { return CBZ.vehicleMat(role, color, opts); } catch (e) {} }
      return mat(color != null ? color : C_METAL, opts);
    }
    const FLEET = {
      white:  vmat("paint", 0xf2f4f6, { roughness: 0.5, metalness: 0.3 }),
      navy:   vmat("paint", 0x1b2438, { roughness: 0.55 }),
      glass:  vmat("glass", 0x101a24), // was 0x10161c — that cleared crashdeform's frost window (b-r>0.045) by 0.002, half an 8-bit step; this clears by 0.033 with the same near-black read
      metal:  vmat("metal", 0xc8ccd2),
      dark:   vmat("plastic", 0x14181d),
      tire:   vmat("tire", 0x1a1d21),
      navR:   mat(0xff3524, { emissive: 0xff3524, ei: 0.95 }),
      navG:   mat(0x2fd45c, { emissive: 0x2fd45c, ei: 0.95 }),
      navW:   mat(0xf4f8ff, { emissive: 0xf4f8ff, ei: 0.9 }),
      beacon: mat(0xff2a2a, { emissive: 0xff2a2a, ei: 1.0 }),
      accents: {},
    };
    function accentMat(c) {
      const k = "a" + c;
      if (!FLEET.accents[k]) FLEET.accents[k] = vmat("paint", c, { roughness: 0.45 });
      return FLEET.accents[k];
    }
    // per-plane part collector: geometries bucket by material and each
    // bucket merges into ONE child mesh (loose meshes without BGU). The
    // children carry no userData/colliders, so the batcher/freezer treat
    // the parent group exactly as before (collider-ref = live group).
    function partKit() {
      const byMat = new Map();
      return {
        put: function (m, geo, x, y, z, rx, ry, rz) {
          if (rz) geo.rotateZ(rz);
          if (rx) geo.rotateX(rx);
          if (ry) geo.rotateY(ry);
          geo.translate(x, y, z);
          let arr = byMat.get(m);
          if (!arr) { arr = []; byMat.set(m, arr); }
          arr.push(geo);
        },
        bake: function (g) {
          byMat.forEach(function (geos, m) {
            if (geos.length > 1 && BGU && BGU.mergeBufferGeometries) {
              const mesh = new THREE.Mesh(BGU.mergeBufferGeometries(geos), m);
              mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh);
            } else {
              for (const gm of geos) {
                const mesh = new THREE.Mesh(gm, m);
                mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh);
              }
            }
          });
        },
      };
    }
    // tiny static emissive marker (nav lights / beacons)
    function navBox(g, m, x, y, z, s) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(s || 0.26, s || 0.26, s || 0.26), m);
      b.position.set(x, y, z); g.add(b);
      return b;
    }

    // =====================================================================
    //  CABIN INTERIOR (owner: "planes should, like elevators, have a door
    //  and a real place inside, and real passengers sitting"). Every
    //  airliner gets a real cabin baked into the same merged part-kit:
    //  BackSide liner shell (visible only from inside), a raised deck over the
    //  wing carry-through, ~36 rows of REAL 3-3 economy seating at a 0.79 m
    //  pitch with an overwing exit row, LIVE-NPC seat anchors (occupancy from a
    //  position hash, never the shared build stream), overhead bins at human
    //  reach height, an aft pressure wall and a cockpit bulkhead with door + a
    //  two-seat flight deck behind it. The
    //  boarding door is a separate SLIDING panel mesh (animated by the
    //  boarding system below — tagged dynamic so the freezer spares it).
    //  Costs a handful of merged draws per plane; zero per-frame work when
    //  nobody is near.
    // =====================================================================
    const CABIN_FLOOR = 2.5;             // deck top (clears the wing box at 2.42)
    const CABIN_DOOR_X = 10.5;           // door local x (forward, port side)
    const linerMat = new THREE.MeshLambertMaterial({ color: 0xe8eaee, side: THREE.BackSide });
    const cabinFloorMat = mat(0x33383f);
    const cabinLightMat = mat(0xfff2d8, { emissive: 0xffe9b8, ei: 0.75 });

    function buildCabin(K, g, acc) {
      // liner shell + deck + aisle carpet — the MERGE of two truths:
      //  • REAL WINDOWS (vehicles pass): the liner leaves the hull's open
      //    window band at y 3.99..4.41, so sightlines pass hull pane →
      //    cavity → cabin in BOTH directions (no fake dark strips).
      //  • REAL DOORS (cockpit pass): OPEN-ENDED planes, outward normals
      //    (BackSide renders inward) — no +x face (the cockpit doorway
      //    lives there) and the -z wall splits around the true boarding
      //    aperture carved in the hull.
      const realDoor = !!CBZ.CONFIG.COCKPIT_REAL_DOOR;
      const glassV2 = realDoor && !(CBZ.CONFIG && CBZ.CONFIG.AIRLINER_COCKPIT_GLASS_V2 === false);
      if (realDoor) {
        K.put(linerMat, new THREE.PlaneGeometry(3.2, 2.9), -12.8, 3.9, 0, 0, -Math.PI / 2);   // aft end cap
        K.put(linerMat, new THREE.PlaneGeometry(24.9, 3.2), -0.35, 2.45, 0, Math.PI / 2, 0);  // floor shell
        K.put(linerMat, new THREE.PlaneGeometry(24.9, 3.2), -0.35, 5.35, 0, -Math.PI / 2, 0); // ceiling shell
        // +z side: belly + crown bands leave the window band open (3.99..4.41)
        K.put(linerMat, new THREE.PlaneGeometry(24.9, 1.54), -0.35, 3.22, 1.6);               // belly band
        K.put(linerMat, new THREE.PlaneGeometry(24.9, 0.94), -0.35, 4.88, 1.6);               // crown band
        K.put(linerMat, new THREE.PlaneGeometry(2.35, 0.44), -11.625, 4.2, 1.6);              // aft band cap
        K.put(linerMat, new THREE.PlaneGeometry(0.65, 0.44), 11.775, 4.2, 1.6);               // fwd band cap
        // -z side: same bands, split around the boarding-door aperture
        // (x 9.95..11.05, y 2.5..4.4) so the open door is an opening.
        K.put(linerMat, new THREE.PlaneGeometry(22.75, 1.54), -1.425, 3.22, -1.6, 0, Math.PI); // belly aft of door
        K.put(linerMat, new THREE.PlaneGeometry(1.05, 1.54), 11.575, 3.22, -1.6, 0, Math.PI);  // belly fwd of door
        K.put(linerMat, new THREE.PlaneGeometry(24.9, 0.94), -0.35, 4.88, -1.6, 0, Math.PI);   // crown band (above door top 4.4)
        K.put(linerMat, new THREE.PlaneGeometry(2.35, 0.44), -11.625, 4.2, -1.6, 0, Math.PI);  // aft band cap
        K.put(linerMat, new THREE.PlaneGeometry(0.65, 0.44), 11.775, 4.2, -1.6, 0, Math.PI);   // fwd band cap
      } else {
        // legacy liner (real-windows split, boxes): belly/crown + band caps
        K.put(linerMat, new THREE.BoxGeometry(25.2, 1.54, 3.2), -0.2, 3.22, 0);    // liner belly (2.45..3.99)
        K.put(linerMat, new THREE.BoxGeometry(25.2, 0.94, 3.2), -0.2, 4.88, 0);    // liner crown (4.41..5.35)
        K.put(linerMat, new THREE.BoxGeometry(2.35, 0.44, 3.2), -11.625, 4.2, 0);  // aft band cap
        K.put(linerMat, new THREE.BoxGeometry(0.95, 0.44, 3.2), 11.925, 4.2, 0);   // fwd band cap
      }
      K.put(cabinFloorMat, new THREE.BoxGeometry(25.2, 0.14, 3.1), -0.2, CABIN_FLOOR - 0.07, 0);
      K.put(FLEET.navy, new THREE.BoxGeometry(23.4, 0.03, 0.8), -0.2, CABIN_FLOOR + 0.02, 0);
      // aft pressure wall + cockpit bulkhead
      K.put(cabinFloorMat, new THREE.BoxGeometry(0.14, 2.9, 3.1), -12.7, 3.9, 0);
      let cockpitLeaf = null;
      if (realDoor) {
        // REAL bulkhead doorway (0.9 wide, deck to 4.4) + a sliding pocket
        // LEAF that tucks into the starboard bulkhead segment when open. The
        // leaf is a live dynamic mesh (batcher/freezer spare it), eased open
        // by the cabin updater below exactly like the boarding panel. Widened
        // to z ±1.62 so the segments seal against the liner walls at ±1.6.
        K.put(cabinFloorMat, new THREE.BoxGeometry(0.14, 2.9, 1.17), 12.1, 3.9, -1.035);
        K.put(cabinFloorMat, new THREE.BoxGeometry(0.14, 2.9, 1.17), 12.1, 3.9, 1.035);
        K.put(cabinFloorMat, new THREE.BoxGeometry(0.14, 0.95, 0.94), 12.1, 4.875, 0);
        cockpitLeaf = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.95, 0.98), FLEET.dark);
        if (AL_SC !== 1) cockpitLeaf.geometry.scale(AL_SC, AL_SC, AL_SC);   // same leaf, up-scaled with the hull
        cockpitLeaf.position.set(12.1 * AL_SC, 3.425 * AL_SC, 0);
        cockpitLeaf.userData.dynamic = true;
        g.add(cockpitLeaf);
        // COCKPIT ROOM behind the doorway — its own smaller BackSide shell,
        // open toward the bulkhead so the sight-line runs room-to-room both
        // ways. Sized (y 2.45..4.8, z ±1.5, front wall x 14.45) to stay well
        // inside the tapering nose hull; the exterior windshield glass band
        // pokes through the top front and reads as the windshield from
        // inside. Deck-height floor + a short ceiling light strip.
        if (glassV2) {
          // cockpit FRONT: drop the windscreen height — keep only a low
          // glareshield/dash panel, so from the pilot seats the view runs
          // forward out the glass windscreen band (bidirectional see-through).
          //
          // THE HEIGHT IS SOLVED, NOT PICKED. Captain's eye sits at model y
          // 3.585, x 13.218; this wall is at x 14.45, i.e. 1.232 ahead of him.
          // At the old y 3.0 the panel's top edge was 3.55 — thirty-five
          // MILLIMETRES below his eye — which is 1.6 degrees of down-vision and
          // is why the owner's screenshot has no forward view at all. The
          // certification floor (FAR/CS 25.773) is ~15 degrees below the
          // horizon, so the top must sit at most 1.232·tan(15°) = 0.330 below
          // the eye: y_top <= 3.255, hence a 1.1-tall panel centred at 2.70.
          // Measured after: 15.2 degrees. Root cause of the original number is
          // that AIRLINER_SCALE (1.45) grew the room, the furniture and the
          // seat anchors — but a seated human's eye height is a human
          // constant, so the pilot ended up below his own console.
          K.put(linerMat, new THREE.PlaneGeometry(3.0, 1.1), 14.45, 2.70, 0, 0, Math.PI / 2);
        } else {
          K.put(linerMat, new THREE.PlaneGeometry(3.0, 2.35), 14.45, 3.625, 0, 0, Math.PI / 2);
        }
        K.put(linerMat, new THREE.PlaneGeometry(2.35, 3.0), 13.275, 4.8, 0, -Math.PI / 2, 0);
        if (glassV2) {
          // cockpit SIDES: split each wall into belly + crown leaving the SAME
          // window band (y 3.99..4.41) open as the cabin, so the flight deck and
          // the seated pilot read through the side quarter-windows from outside.
          for (const csn of [1, -1]) {
            const ry = csn > 0 ? 0 : Math.PI;
            K.put(linerMat, new THREE.PlaneGeometry(2.35, 1.54), 13.275, 3.22, csn * 1.5, 0, ry);   // belly band
            K.put(linerMat, new THREE.PlaneGeometry(2.35, 0.39), 13.275, 4.605, csn * 1.5, 0, ry);  // crown band
          }
        } else {
          K.put(linerMat, new THREE.PlaneGeometry(2.35, 2.35), 13.275, 3.625, 1.5);
          K.put(linerMat, new THREE.PlaneGeometry(2.35, 2.35), 13.275, 3.625, -1.5, 0, Math.PI);
        }
        K.put(cabinFloorMat, new THREE.BoxGeometry(2.5, 0.14, 3.0), 13.3, CABIN_FLOOR - 0.07, 0);
        K.put(cabinLightMat, new THREE.BoxGeometry(1.0, 0.05, 0.24), 12.8, 4.77, 0);
      } else {
        // legacy: solid bulkhead with a painted dark cockpit door
        K.put(cabinFloorMat, new THREE.BoxGeometry(0.14, 2.9, 3.1), 12.1, 3.9, 0);
        K.put(FLEET.dark, new THREE.BoxGeometry(0.08, 1.78, 0.8), 12.0, 3.42, 0);
      }
      // ceiling light strips (interior fake window strips removed — the real
      // hull panes + open liner band replace them)
      for (const sgn of [-1, 1]) {
        K.put(cabinLightMat, new THREE.BoxGeometry(22, 0.05, 0.28), -0.5, 5.24, sgn * 0.5);
      }
      // ================================================================
      //  THE CABIN — REAL SEATING (CABIN_REAL_SEATS)
      //
      //  OWNER: "PLANE PASSENGERS SIT SIDEWAYS NOT LIKE NPCS JUST SITTING. SO
      //  MANY THINGS ARE LIKE DIORAMA ABOUT PLANES AND NOT LIKE JUST A FEATURE,
      //  A THING BUILD THAT OUR GAME NPCS CAN INTERACT WITH."
      //
      //  MEASURED, not guessed. Two separate defects produced that screenshot:
      //
      //  (1) FACING was a ONE-SHOT WRITE. npclife.attach() writes the seat yaw
      //      into `group.rotation` once, at attach time, and syncAttached()
      //      re-asserts speed/state/sitting every frame but NEVER the transform.
      //      A cabin passenger stays a full member of CBZ.cityPeds, and 41 files
      //      in this repo iterate cityPeds and write `group.rotation.y` with no
      //      `_npcAttached` guard (peds.js is the ONLY file that guards). Those
      //      writes are WORLD-space bearings (Math.atan2(target.x - ped.pos.x,
      //      …) — and ped.pos IS world space for an attached actor) landing on a
      //      group whose parent is the airliner, so the body ends up at
      //      worldBearing − planeHeading: pointing at a shop across the map,
      //      rotated by the parked heading. aigoals.js's face() and social.js's
      //      couple/friend vignettes (which fire on anyone within 30 m of the
      //      player, i.e. exactly when you are standing in the cabin) are the two
      //      that reach a seated tourist. The cure is the per-frame hold below
      //      (cabinPassengerHold, CABIN_SEATED_V2) — facing becomes a TRUTH the
      //      airport re-asserts after those systems run, not a value they can win.
      //
      //  (2) SCALE. K.put multiplies every coordinate and scales every geometry
      //      by AIRLINER_SCALE (1.45). The hull is MEANT to grow; the humans are
      //      not, and nobody had re-derived the furniture. The old rows were a
      //      1.4-unit pitch = 2.03 m between rows, a 0.65 m cushion and 0.81 m
      //      between neighbours — bar stools two metres apart. That is the
      //      diorama: correct-looking geometry at the wrong scale for the only
      //      thing in the room with a real size, the person. Every dimension
      //      below is now the published economy number passed through R().
      //
      //  What we author is only what is genuinely new: the seat SHAPE and where
      //  the anchors go. Bodies, brains, damage, death and the kill feed come
      //  from the ordinary ped path (npclife casts real CBZ.cityPeds into these
      //  anchors), and the pose comes from character.js's declared-cushion chair
      //  solve — the same one propuse.js hands a bed or a deck chair.
      // ================================================================
      // cockpit behind the bulkhead: console block + two pilot seats, both at
      // human scale (a flight-deck seat is a chair, not a sofa).
      K.put(FLEET.dark, new THREE.BoxGeometry(R(0.72), R(0.62), R(1.75)), 14.2, CABIN_FLOOR + R(0.52), 0);
      const PIL_Z = R(0.55);                    // half the side-by-side seat spacing
      for (const sgn of [-1, 1]) {
        K.put(FLEET.navy, new THREE.BoxGeometry(R(0.50), R(SEAT.cushionT), R(0.50)),
          13.13, CABIN_FLOOR + R(0.45 - SEAT.cushionT / 2), sgn * PIL_Z);              // cushion
        K.put(FLEET.navy, new THREE.BoxGeometry(R(0.10), R(0.60), R(0.50)),
          13.13 - R(0.29), CABIN_FLOOR + R(0.75), sgn * PIL_Z, 0, 0, SEAT.recline);   // back
      }
      const seats = [];
      let seatId = 0;
      // Occupancy is a POSITION HASH, never a draw on the shared build stream.
      // The private-jet club-four already does this ("order-safe for the airport
      // build") and it is strictly better than the rng() draws this loop used to
      // consume: adding or removing a row can no longer shift every later
      // airport decision, so the seat map is stable under edits AND identical
      // per seed across clients (determinism law).
      const PX = g.position.x, PZ = g.position.z;
      function seatHash(x, z, salt) {
        return CBZ.hash01 ? CBZ.hash01(PX + x * 7.13, PZ + z * 11.71, salt) : 0.5;
      }
      // COCKPIT CREW SEATS — real seat records the shared NPC life system can
      // claim. The captain's chair (port/left, -z) is reserved so a live pilot is
      // cast there (seat.role "pilot" → npclife's aircraftPilot profile,
      // uniformed via the job-cast wardrobe); the first officer's chair stays
      // free for the player to take. `job` is the truth about what they DO — the
      // hold below stamps it onto whichever body gets cast here, and level.js's
      // cityTitle() turns it into the overhead "Lv.N Pilot" pill with no string
      // hardcoded anywhere near the HUD.
      // cockpit.js reads these anchors for the pilot EYE point, so the cushion-top
      // convention (anchor y == cushion top) must not drift.
      if (realDoor) {
        seats.push({
          id: "seat-captain", x: 13.13 * AL_SC, y: (CABIN_FLOOR + R(0.45)) * AL_SC, z: -PIL_Z * AL_SC,
          heading: Math.PI / 2, kind: "cockpit-seat", role: "pilot", job: "pilot", cockpit: true,
          reservedForNpc: true, occupant: null,
          cushionH: Rm(0.45), floorBelow: Rm(0.45),   // world metres above the deck (see Rm)
        });
        // TWO PILOTS PER AIRCRAFT (owner, 2026-07-27). This chair used to carry
        // `reservedForNpc: false` with a note that it stayed free for the
        // player — but an airliner with one pilot aboard is wrong, and the
        // player takes a seat by DISPLACING its occupant now
        // (CBZ.cityVacateFlightDeck), exactly as he does the captain's. So the
        // first officer is crewed like every other flight deck.
        seats.push({
          id: "seat-firstofficer", x: 13.13 * AL_SC, y: (CABIN_FLOOR + R(0.45)) * AL_SC, z: PIL_Z * AL_SC,
          heading: Math.PI / 2, kind: "cockpit-seat", role: "pilot", job: "co-pilot", cockpit: true,
          reservedForNpc: true, occupant: null,
          cushionH: Rm(0.45), floorBelow: Rm(0.45),
        });
      }
      // ---- the economy cabin: 3-3, 0.79 m pitch, 0.44 m seats ----------------
      // Block centre is pinned OUTBOARD against the liner wall (|z| = 1.6 in
      // authoring units) so the window seat sits by the window at any
      // AIRLINER_SCALE and every surplus centimetre of the up-scaled tube goes to
      // the aisle instead of to dead space behind the last seat. At AL_SC = 1
      // that lands the real 0.48 m narrowbody aisle exactly; at 1.45 it opens to
      // ~1.9 m, which is the honest consequence of the owner's hull dial and
      // reads as a widebody aisle rather than as oversized furniture.
      const HALF_W = R(SEAT.width * SEAT.abreast / 2);            // half a 3-abreast block
      const BLOCK_Z = Math.max(HALF_W + R(SEAT.aisleMin / 2), 1.6 - HALF_W - R(0.03));
      const X_AFT = -11.8, X_FWD = 8.8;                           // seating zone (clear of both bulkheads)
      const PITCH = R(SEAT.pitch);
      const CUSH = seatCushion();                                 // metres above the deck (propuse's table)
      const CUSH_Y = CABIN_FLOOR + R(CUSH - SEAT.cushionT / 2);
      const ANCHOR_Y = CABIN_FLOOR + R(CUSH);
      // Overwing EXIT ROW: two rows omitted mid-cabin. Real, free (it is a skip,
      // not geometry) and it breaks the corridor read of an unbroken seat run.
      const EXIT_X0 = -1.0, EXIT_X1 = -1.0 + PITCH * 2;
      // Boarding load: reserved seats fill FRONT-TO-BACK under a hard cap, which
      // is both what a boarding aircraft looks like and what keeps the rig count
      // sane — the old map reserved ~90% of every row (≈54 live rigs per plane,
      // 216 across the gate line). The rest of the cabin stays genuinely empty so
      // the player has somewhere to sit.
      const NPC_CAP = 26;
      let reservedN = 0;
      const rowsX = [];
      for (let rx = X_FWD; rx >= X_AFT - 1e-6; rx -= PITCH) {
        if (rx < EXIT_X1 && rx > EXIT_X0) continue;
        rowsX.push(rx);
      }
      for (let r = 0; r < rowsX.length; r++) {
        const rx = rowsX[r];
        // forward rows board first: 0.62 at the bulkhead decaying to 0.10 aft
        const fill = 0.62 - 0.52 * (r / Math.max(1, rowsX.length - 1));
        for (const side of [-1, 1]) {
          const zc = side * BLOCK_Z;
          // CUSHION — one slab per 3-abreast block; the armrests below are what
          // divide it into seats, exactly as a real bench-built economy block is
          // built. Depth is the real 0.48 m squab.
          K.put(FLEET.navy, new THREE.BoxGeometry(R(SEAT.cushionD), R(SEAT.cushionT), R(SEAT.width * SEAT.abreast)),
            rx, CUSH_Y, zc);
          // RECLINED BACK. `-X` is aft, and K.put's rz rotates the geometry
          // BEFORE translating it, so a positive angle carries the top of the
          // back aft. (The old code assigned rotation.z to K.put's return value,
          // which is undefined — the recline had never actually run.)
          K.put(FLEET.navy, new THREE.BoxGeometry(R(SEAT.backT), R(SEAT.backH), R(SEAT.width * SEAT.abreast)),
            rx - R(SEAT.cushionD / 2 + SEAT.backT / 2), CABIN_FLOOR + R(CUSH + SEAT.backH / 2), zc,
            0, 0, SEAT.recline);
          // PEDESTAL — the boxed underseat leg, floor to cushion underside.
          K.put(FLEET.dark, new THREE.BoxGeometry(R(0.30), R(CUSH - SEAT.cushionT), R(SEAT.width * SEAT.abreast - 0.14)),
            rx, CABIN_FLOOR + R((CUSH - SEAT.cushionT) / 2), zc);
          // ARMRESTS — one per seat division (4 across a 3-abreast block). This
          // is what a seated body's forearms land on, and without them the
          // passengers read as sitting on a shelf.
          for (let a = 0; a <= SEAT.abreast; a++) {
            K.put(FLEET.dark, new THREE.BoxGeometry(R(0.42), R(0.05), R(0.06)),
              rx + R(0.02), CABIN_FLOOR + R(CUSH + SEAT.armY), zc + side * R((a - SEAT.abreast / 2) * SEAT.width));
          }
          // SEATS + HEADRESTS, outboard (window) to inboard (aisle).
          for (let k = 1; k >= -1; k--) {
            const sz = zc + side * R(k * SEAT.width);
            K.put(FLEET.dark, new THREE.BoxGeometry(R(0.10), R(0.20), R(0.28)),
              rx - R(SEAT.cushionD / 2 + SEAT.backT + Math.sin(SEAT.recline) * SEAT.backH * 0.5),
              CABIN_FLOOR + R(CUSH + SEAT.backH - 0.02), sz);
            // A body sits a hair FORWARD of the cushion centre (backside against
            // the squab's rear third), so the anchor leads the cushion centre.
            const ax = rx + R(0.04);
            const reserve = reservedN < NPC_CAP && seatHash(ax, sz, 0x5EA7) < fill;
            if (reserve) reservedN++;
            seats.push({
              id: "seat-" + (seatId++), x: ax * AL_SC, y: ANCHOR_Y * AL_SC, z: sz * AL_SC,
              heading: Math.PI / 2,                       // plane-LOCAL yaw: +X is the nose
              // NO `job` here on purpose: npclife's aircraftPassenger profile
              // already casts these bodies with job "traveller", and a seat only
              // overrides the profile where the SEAT knows better (the flight
              // deck and the crew post, below).
              kind: "aircraft-seat",
              row: r, col: k, window: k === 1,
              reservedForNpc: reserve, occupant: null,
              // Declared geometry for the V2 chair sit (entities/character.js via
              // CBZ.propSeatRef): the anchor sits ON the cushion top and the
              // cushion top is that same height above the deck. Both are REAL
              // METRES because the rig that reads them is real-metre sized — this
              // pair is the one place R() must NOT be applied.
              cushionH: Rm(CUSH), floorBelow: Rm(CUSH),
            });
          }
        }
      }
      // OVERHEAD BINS — dropped to real reach height (underside ~1.62 m above the
      // deck) so the furniture band, not the 4 m up-scaled ceiling, is what your
      // eye measures the room against. The bin lip carries the reading-light rail,
      // which is the second-strongest cabin cue after the armrests.
      {
        const runL = X_FWD - X_AFT + R(1.2), runC = (X_FWD + X_AFT) / 2;
        for (const side of [-1, 1]) {
          K.put(FLEET.navy, new THREE.BoxGeometry(runL, R(0.34), R(0.50)),
            runC, CABIN_FLOOR + R(1.79), side * (1.6 - R(0.27)));
          K.put(cabinLightMat, new THREE.BoxGeometry(runL, R(0.03), R(0.10)),
            runC, CABIN_FLOOR + R(1.60), side * (1.6 - R(0.48)));
        }
      }
      // ONE standing uniformed crew member in the forward vestibule, facing AFT
      // over the seated cabin (heading -pi/2 → local -X, the mirror of the
      // passengers' +X). A "stand" anchor (attach sets sitting=false) spawned
      // fresh through the flight-crew profile, so it reuses the npclife cabin
      // fill + lifecycle (pruneCabins releases it on theft/crash) with NO change
      // to the verified attach path. Its JOB is a flight attendant's, not a
      // pilot's — `role:"pilot"` here only selects npclife's uniformed
      // aircraftPilot CASTING profile; the hold stamps the truthful job on the
      // body afterwards. Flip AIRLINER_CABIN_CREW false to remove.
      if (!CBZ.CONFIG || CBZ.CONFIG.AIRLINER_CABIN_CREW !== false) {
        seats.push({
          id: "seat-crew", x: 9.8 * AL_SC, y: CABIN_FLOOR * AL_SC, z: 0,
          heading: -Math.PI / 2, kind: "cabin-crew", role: "pilot", job: "flight attendant",
          pose: "stand", state: "idle",
          reservedForNpc: true, occupant: null,
        });
      }
      // DOORWAY (port, forward): with the real hull aperture the old dark
      // recess box would blank the opening, so it exists only in the legacy
      // branch; the warm sill light tucks under the aperture header instead.
      // (The flight crew is the captain/FO pair pushed above — the older
      // unconditional pilot anchors are superseded by that richer pair.)
      if (realDoor) {
        K.put(cabinLightMat, new THREE.BoxGeometry(1.0, 0.05, 0.05), CABIN_DOOR_X, 4.31, -1.79);
      } else {
        K.put(FLEET.dark, new THREE.BoxGeometry(1.14, 1.92, 0.1), CABIN_DOOR_X, 3.46, -1.64);
        K.put(cabinLightMat, new THREE.BoxGeometry(1.0, 0.06, 0.06), CABIN_DOOR_X, 4.48, -1.68);
      }
      // sliding DOOR PANEL — a separate live mesh the boarding system eases
      // aft along the hull; dynamic-tagged so batcher/freezer leave it alone
      const panel = new THREE.Mesh(new THREE.BoxGeometry(1.06, 1.86, 0.1), FLEET.white);
      if (AL_SC !== 1) panel.geometry.scale(AL_SC, AL_SC, AL_SC);
      panel.position.set(CABIN_DOOR_X * AL_SC, 3.45 * AL_SC, -1.73 * AL_SC);
      panel.userData.dynamic = true;
      const panelBand = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.3, 0.04), acc);
      if (AL_SC !== 1) panelBand.geometry.scale(AL_SC, AL_SC, AL_SC);
      panelBand.position.set(0, -0.35 * AL_SC, -0.04 * AL_SC);
      panel.add(panelBand);
      g.add(panel);
      g.userData.cabin = {
        floorTop: CABIN_FLOOR * AL_SC,
        doorX: CABIN_DOOR_X * AL_SC, doorZ: -1.7 * AL_SC,
        scale: AL_SC,                                  // read by aircraft_doors.js to scale the walk-in arc offsets
        seats, panel, doorT: 0,
        rows: rowsX.length, abreast: SEAT.abreast,     // read by cabinAudit
        cockpitLeaf, cockpitT: 0,
        // WHERE THE FLIGHT DECK IS — the standing point between the two pilot
        // chairs, plane-local. aircraft_doors.js walks the player here for the
        // short "already aboard" hijack beat instead of marching him back out
        // of the fuselage and replaying the airstairs (CBZ.cityCabinFlightDeck).
        deckX: 12.7 * AL_SC, deckZ: 0,
      };
    }

    function buildAirliner(x, z, heading, livery) {
      const g = new THREE.Group();
      // The complete airframe is one movable object. Without this root tag the
      // static batcher descends into the plane, extracts eligible cabin meshes,
      // and bakes them into world space at the gate. Flying the remaining group
      // then leaves that cabin shell behind.
      g.userData.dynamic = true;
      g.position.set(x, 0, z); g.rotation.y = heading;
      const acc = accentMat(livery || 0x2d5fb0);
      // scale-baking part kit: every geometry the airliner and its cabin submit
      // is uniformly scaled by AL_SC and its placement multiplied through, so the
      // whole airframe grows by ONE factor while group.scale stays 1 — flight,
      // collision, batching and the human-sized passenger rigs are all untouched.
      const K0 = partKit();
      const K = AL_SC === 1 ? K0 : {
        put: function (m, geo, px, py, pz, rx, ry, rz) {
          geo.scale(AL_SC, AL_SC, AL_SC);
          return K0.put(m, geo, px * AL_SC, py * AL_SC, pz * AL_SC, rx, ry, rz);
        },
        bake: function (gg) { return K0.bake(gg); },
      };
      const DIMS = AIRCRAFT_DIMS.airliner;
      // COCKPIT GLASS V2: swap the opaque windscreen band + fwd hull band-caps
      // for real see-through glass (only meaningful with the real cockpit room).
      const glassV2 = !!CBZ.CONFIG.COCKPIT_REAL_DOOR && !(CBZ.CONFIG && CBZ.CONFIG.AIRLINER_COCKPIT_GLASS_V2 === false);
      // 27.9m centre barrel + 4.2m nose + 5.6m tail = 37.55m end-to-end.
      const L = 27.9, R = 1.9;
      const FH = DIMS.fuselage, FW = DIMS.fuselage;
      const CY = R + 1.6;         // fuselage centreline height — UNCHANGED (flight/camera anchors)
      const BELLY = CY - FH / 2;  // 1.6 — struts rise to here, wheels touch y=0

      // fuselage: white barrel + sculpted drooped nose + upswept tailcone.
      // TWO merged truths: REAL WINDOWS (an OPEN band at cabin-window height —
      // the clear pane strip genuinely looks into the lit cabin and out of it)
      // and a REAL BOARDING DOOR (hollow tube so the doorway is an aperture
      // seen through from both sides, panel pocketing into the wall cavity).
      const WIN_Y0 = CY + 0.49, WIN_Y1 = CY + 0.91;          // band 3.99..4.41 (pane strip is CY+0.7 ± 0.21)
      const WIN_X0 = 0.5 - (L - 6) / 2, WIN_X1 = 0.5 + (L - 6) / 2;   // pane strip x extent
      const HULL_Y0 = CY - FH / 2, HULL_Y1 = CY + FH / 2;
      if (CBZ.CONFIG.COCKPIT_REAL_DOOR) {
        // HOLLOW barrel: roof + belly slabs, and SIDE WALLS split into
        // belly/crown bands leaving the window band open (inner faces hide
        // behind the BackSide liner). Port wall also splits around the door
        // hole (x 9.95..11.05, y 2.5..4.4, matching the liner aperture).
        const WZ = (FW - 0.355) / 2;                              // wall centre |z|
        K.put(FLEET.white, new THREE.BoxGeometry(L, HULL_Y1 - 5.37, FW), 0, (HULL_Y1 + 5.37) / 2, 0);  // roof
        K.put(FLEET.white, new THREE.BoxGeometry(L, 2.43 - HULL_Y0, FW), 0, (2.43 + HULL_Y0) / 2, 0);  // belly
        // starboard wall: belly band + crown band + fore/aft band caps
        K.put(FLEET.white, new THREE.BoxGeometry(L, WIN_Y0 - 2.43, 0.355), 0, (WIN_Y0 + 2.43) / 2, WZ);
        K.put(FLEET.white, new THREE.BoxGeometry(L, 5.37 - WIN_Y1, 0.355), 0, (5.37 + WIN_Y1) / 2, WZ);
        K.put(FLEET.white, new THREE.BoxGeometry(WIN_X0 + L / 2, 0.44, 0.355), (-L / 2 + WIN_X0) / 2, CY + 0.7, WZ);
        // fwd band cap → cockpit STARBOARD quarter-window: clear glass at the
        // hull surface over the open band (same pane grammar as the cabin strip)
        // when GLASS V2 is on; opaque white cap is the pre-V2 fallback.
        if (glassV2) K.put(FLEET.glass, new THREE.BoxGeometry(L / 2 - WIN_X1, 0.42, 0.1), (WIN_X1 + L / 2) / 2, CY + 0.7, FW / 2 + 0.02);
        else K.put(FLEET.white, new THREE.BoxGeometry(L / 2 - WIN_X1, 0.44, 0.355), (WIN_X1 + L / 2) / 2, CY + 0.7, WZ);
        // port wall: same bands, belly band split around the door hole
        K.put(FLEET.white, new THREE.BoxGeometry(23.9, WIN_Y0 - 2.43, 0.355), -2.0, (WIN_Y0 + 2.43) / 2, -WZ);   // aft of door
        K.put(FLEET.white, new THREE.BoxGeometry(2.9, WIN_Y0 - 2.43, 0.355), 12.5, (WIN_Y0 + 2.43) / 2, -WZ);    // fwd of door
        K.put(FLEET.white, new THREE.BoxGeometry(L, 5.37 - WIN_Y1, 0.355), 0, (5.37 + WIN_Y1) / 2, -WZ);         // crown band
        K.put(FLEET.white, new THREE.BoxGeometry(WIN_X0 + L / 2, 0.44, 0.355), (-L / 2 + WIN_X0) / 2, CY + 0.7, -WZ);  // aft band cap
        // fwd band cap → cockpit PORT quarter-window (glass) when GLASS V2 is on.
        if (glassV2) K.put(FLEET.glass, new THREE.BoxGeometry(L / 2 - WIN_X1, 0.42, 0.1), (WIN_X1 + L / 2) / 2, CY + 0.7, -(FW / 2 + 0.02));
        else K.put(FLEET.white, new THREE.BoxGeometry(L / 2 - WIN_X1, 0.44, 0.355), (WIN_X1 + L / 2) / 2, CY + 0.7, -WZ);   // fwd band cap
        K.put(FLEET.white, new THREE.BoxGeometry(1.1, 0.07, 0.355), 10.5, 2.465, -WZ);                            // door sill
      } else {
        // legacy split barrel (real windows, solid walls — no door aperture)
        K.put(FLEET.white, new THREE.BoxGeometry(L, WIN_Y0 - HULL_Y0, FW, 2, 1, 1), 0, (WIN_Y0 + HULL_Y0) / 2, 0);   // belly slab
        K.put(FLEET.white, new THREE.BoxGeometry(L, HULL_Y1 - WIN_Y1, FW, 2, 1, 1), 0, (HULL_Y1 + WIN_Y1) / 2, 0);   // crown slab
        K.put(FLEET.white, new THREE.BoxGeometry(WIN_X0 + L / 2, WIN_Y1 - WIN_Y0 + 0.02, FW), (-L / 2 + WIN_X0) / 2, CY + 0.7, 0);  // aft band cap
        K.put(FLEET.white, new THREE.BoxGeometry(L / 2 - WIN_X1, WIN_Y1 - WIN_Y0 + 0.02, FW), (WIN_X1 + L / 2) / 2, CY + 0.7, 0);   // fwd band cap
      }
      K.put(FLEET.white, fuseGeo(4.2, FH, FW, { nose: 0.24, noseY: -1.0 }), L / 2 + 2.05, CY, 0);
      K.put(FLEET.white, fuseGeo(5.6, FH, FW, { tail: 0.16, tailY: 1.25 }), -L / 2 - 2.75, CY, 0);
      // cockpit WINDSCREEN: GLASS V2 makes it real see-through glass (the SAME
      // tint as the cabin strips) wrapping the flight-deck front, so the lit
      // cockpit and the uniformed pilot read from the apron and the runway shows
      // from the pilot seats. The opaque dark band is the pre-V2 fallback (kept
      // for the solid-nose legacy build where there is no cockpit room behind).
      if (glassV2) K.put(FLEET.glass, new THREE.BoxGeometry(2.4, 0.95, FW + 0.02), L / 2 + 0.6, CY + 0.8, 0);
      else K.put(FLEET.dark, new THREE.BoxGeometry(2.4, 0.95, FW + 0.1), L / 2 + 0.6, CY + 0.8, 0);
      // livery: coloured belly stripe wrapping under the white upper fuselage,
      // and the cabin windows as ONE long CLEAR pane strip per side over the
      // open band, with white window-frame pillars at seat pitch behind it.
      K.put(acc, new THREE.BoxGeometry(L, 0.95, FW + 0.12), 0, BELLY + 0.42, 0);
      if (CBZ.CONFIG.COCKPIT_REAL_DOOR) {
        // starboard: one clear strip; port: split around the doorway aperture.
        // White frame pillars at seat pitch sit behind the panes on BOTH
        // sides (skipping the door span on port) so the strip reads as a row
        // of windows, not one long slit.
        K.put(FLEET.glass, new THREE.BoxGeometry(L - 6, 0.42, 0.1), 0.5, CY + 0.7, FW / 2 + 0.02);
        K.put(FLEET.glass, new THREE.BoxGeometry(20.4, 0.42, 0.1), -0.25, CY + 0.7, -(FW / 2 + 0.02));
        K.put(FLEET.glass, new THREE.BoxGeometry(0.4, 0.42, 0.1), 11.25, CY + 0.7, -(FW / 2 + 0.02));
        for (let px = WIN_X0 + 0.25; px < WIN_X1 - 0.2; px += 2.0) {
          K.put(FLEET.white, new THREE.BoxGeometry(0.34, WIN_Y1 - WIN_Y0 + 0.04, 0.12), px, CY + 0.7, FW / 2 - 0.015);
          if (px < 9.8 || px > 11.2) {
            K.put(FLEET.white, new THREE.BoxGeometry(0.34, WIN_Y1 - WIN_Y0 + 0.04, 0.12), px, CY + 0.7, -(FW / 2 - 0.015));
          }
        }
      } else {
        for (const sgn of [-1, 1]) {
          K.put(FLEET.glass, new THREE.BoxGeometry(L - 6, 0.42, 0.1), 0.5, CY + 0.7, sgn * (FW / 2 + 0.02));
          for (let px = WIN_X0 + 0.25; px < WIN_X1 - 0.2; px += 2.0) {
            K.put(FLEET.white, new THREE.BoxGeometry(0.34, WIN_Y1 - WIN_Y0 + 0.04, 0.12), px, CY + 0.7, sgn * (FW / 2 - 0.015));
          }
        }
      }

      // ONE swept tapered wing pair + upturned accent winglets
      K.put(FLEET.white, wingGeo(DIMS.span, 5.5, 2.2, 0.55, 4.5, 0.9), 0.5, BELLY + 0.55, 0);
      for (const sgn of [-1, 1]) K.put(acc, new THREE.BoxGeometry(1.5, 2.1, 0.32), -4.2, 3.95, sgn * (DIMS.span / 2 - 0.2));

      // underwing engines: sculpted nacelle + accent intake lip ring + dark
      // inlet disc + dark exhaust + pylon up into the wing
      for (const sgn of [-1, 1]) {
        const nz = sgn * 5.6;
        K.put(FLEET.white, fuseGeo(4.0, 1.5, 1.5, { nose: 0.94, tail: 0.66 }), 2.2, 1.4, nz);
        K.put(acc, new THREE.BoxGeometry(0.34, 1.68, 1.68), 4.15, 1.4, nz);
        K.put(FLEET.dark, new THREE.BoxGeometry(0.2, 1.22, 1.22), 4.3, 1.4, nz);
        K.put(FLEET.dark, new THREE.BoxGeometry(0.5, 0.92, 0.92), 0.28, 1.42, nz);
        K.put(FLEET.white, new THREE.BoxGeometry(1.9, 1.0, 0.42), 1.4, 2.25, nz);
      }

      // tail: swept accent fin + two-tone geometric logo block + tailplane
      K.put(acc, finGeo(6.2, 5.2, 2.6, 0.5, 2.6), -16.5, 8.65, 0);
      K.put(FLEET.white, new THREE.BoxGeometry(1.6, 1.6, 0.62), -18.3, 10.05, 0);
      K.put(FLEET.navy, new THREE.BoxGeometry(0.95, 0.95, 0.7), -17.9, 9.65, 0);
      K.put(FLEET.white, wingGeo(11, 3.4, 1.5, 0.4, 1.8, 0.35), -17.6, CY + 1.1, 0);

      // gear: 2-wheel nose leg + two 4-wheel main bogies, chunky struts.
      // Wheel pairs are axle-spanning cylinders; every wheel bottoms at y=0.
      K.put(FLEET.metal, new THREE.BoxGeometry(0.36, 1.4, 0.36), 10, 1.0, 0);
      for (const sgn of [-1, 1]) K.put(FLEET.tire, new THREE.CylinderGeometry(0.42, 0.42, 0.3, 10), 10, 0.42, sgn * 0.34, Math.PI / 2);
      for (const sgn of [-1, 1]) {
        const mz = sgn * 3.1;
        K.put(FLEET.metal, new THREE.BoxGeometry(0.42, 1.2, 0.42), -2.2, 1.15, mz);   // strut into the belly
        K.put(FLEET.metal, new THREE.BoxGeometry(2.6, 0.4, 0.5), -2.2, 0.72, mz);     // bogie beam
        for (const bx of [-3.05, -1.35]) K.put(FLEET.tire, new THREE.CylinderGeometry(0.55, 0.55, 1.34, 10), bx, 0.55, mz, Math.PI / 2);
      }
      buildCabin(K, g, acc);        // real interior + sliding boarding door
      K.bake(g);

      // nav lights: port red / starboard green wingtips, white tail, beacon
      // (positions follow AL_SC so they ride the up-scaled wingtips/tail/nose)
      navBox(g, FLEET.navR, -4.0 * AL_SC, 3.1 * AL_SC, -DIMS.span / 2 * AL_SC);
      navBox(g, FLEET.navG, -4.0 * AL_SC, 3.1 * AL_SC, DIMS.span / 2 * AL_SC);
      navBox(g, FLEET.navW, -19.35 * AL_SC, 11.55 * AL_SC, 0);
      navBox(g, FLEET.beacon, -2 * AL_SC, 5.55 * AL_SC, 0, 0.3 * AL_SC);

      root.add(g);
      // external-facing size (flight collision, hijack reach, targeting, camera
      // foot) tracks the up-scale via a per-plane copy; the frozen shared
      // AIRCRAFT_DIMS envelope is never mutated.
      g.userData.aircraftDims = AL_SC === 1 ? DIMS : {
        family: DIMS.family, length: DIMS.length * AL_SC, span: DIMS.span * AL_SC,
        height: DIMS.height * AL_SC, fuselage: DIMS.fuselage * AL_SC,
      };
      g.userData.worldCollider = aircraftSolid(g, DIMS);
      return g;
    }

    function buildPrivateJet(x, z, heading, livery) {
      const g = new THREE.Group();
      // Keep the mini-cabin and exterior under the same movable transform.
      g.userData.dynamic = true;
      g.position.set(x, 0, z); g.rotation.y = heading;
      const acc = accentMat(livery || 0x355c8a);
      const K = partKit();
      const L = 11, R = 1.1;      // barrel length / legacy radius (collider height stays R+3)
      const FH = 2.2, FW = 2.0;   // fuselage box cross-section
      const CY = R + 1.0;         // centreline height — UNCHANGED (2.1)
      const BELLY = CY - FH / 2;  // 1.0

      // fuselage: white barrel + LOW drooped nose taper + upswept tailcone.
      // REAL WINDOWS (airliner pattern, scaled down): the barrel splits into
      // belly + crown slabs with an OPEN band at window height (x -2.7..2.7),
      // so the clear pane strip looks into a real lit mini-cabin.
      const JW_Y0 = CY + 0.4, JW_Y1 = CY + 0.7;              // band 2.5..2.8
      const JW_X0 = -2.7, JW_X1 = 2.7;
      const JH_Y0 = CY - FH / 2, JH_Y1 = CY + FH / 2;
      K.put(FLEET.white, new THREE.BoxGeometry(L, JW_Y0 - JH_Y0, FW, 2, 1, 1), 0, (JW_Y0 + JH_Y0) / 2, 0);   // belly slab
      K.put(FLEET.white, new THREE.BoxGeometry(L, JH_Y1 - JW_Y1, FW, 2, 1, 1), 0, (JH_Y1 + JW_Y1) / 2, 0);   // crown slab
      K.put(FLEET.white, new THREE.BoxGeometry(JW_X0 + L / 2, JW_Y1 - JW_Y0 + 0.02, FW), (-L / 2 + JW_X0) / 2, CY + 0.55, 0);  // aft band cap
      K.put(FLEET.white, new THREE.BoxGeometry(L / 2 - JW_X1, JW_Y1 - JW_Y0 + 0.02, FW), (JW_X1 + L / 2) / 2, CY + 0.55, 0);   // fwd band cap
      K.put(FLEET.white, fuseGeo(3.6, FH, FW, { nose: 0.22, noseY: -0.62 }), L / 2 + 1.75, CY, 0);
      K.put(FLEET.white, fuseGeo(3.8, FH, FW, { tail: 0.18, tailY: 0.8 }), -L / 2 - 1.85, CY, 0);
      // cockpit band: opaque-dark on purpose (solid sculpted nose behind it)
      K.put(FLEET.dark, new THREE.BoxGeometry(1.5, 0.72, FW + 0.08), L / 2 + 0.55, CY + 0.42, 0);
      // MINI CABIN behind the panes: split BackSide liner (visible only from
      // outside-through-glass / inside), floor, and a club-four of seats.
      K.put(linerMat, new THREE.BoxGeometry(5.8, 1.25, 1.7), 0, 1.875, 0);       // liner belly (1.25..2.5)
      K.put(linerMat, new THREE.BoxGeometry(5.8, 0.25, 1.7), 0, 2.925, 0);       // liner crown (2.8..3.05)
      K.put(linerMat, new THREE.BoxGeometry(0.2, 0.32, 1.7), -2.8, 2.65, 0);     // aft band cap
      K.put(linerMat, new THREE.BoxGeometry(0.2, 0.32, 1.7), 2.8, 2.65, 0);      // fwd band cap
      K.put(cabinFloorMat, new THREE.BoxGeometry(5.6, 0.1, 1.6), 0, 1.32, 0);    // deck
      const jetSeats = [];
      let jsIdx = 0;
      // club-four: two facing pairs, port and starboard. Occupancy by position-
      // hash (never the shared rng stream — order-safe for the airport build).
      for (const side of [-1, 1]) {
        for (const fx of [-1, 1]) {
          const sx = fx * 1.2, sz = side * 0.45;
          K.put(FLEET.navy, new THREE.BoxGeometry(0.5, 0.14, 0.5), sx, 1.44, sz);                 // cushion
          K.put(FLEET.navy, new THREE.BoxGeometry(0.14, 0.62, 0.5), sx + fx * 0.28, 1.78, sz);    // back (facing inward)
          const occ = (CBZ.hash01 ? CBZ.hash01(x + jsIdx, z - jsIdx, 9101) : ((jsIdx * 0.37) % 1)) < 0.62;
          jetSeats.push({
            id: "jetseat-" + (jsIdx++), x: sx, y: 1.32 + 0.42, z: sz,
            heading: fx > 0 ? -Math.PI / 2 : Math.PI / 2, kind: "aircraft-seat",
            reservedForNpc: occ, occupant: null,
            // V2 chair-sit geometry: exec recliner — the cushion mesh tops out
            // just 0.14 above the 1.37 deck, and this anchor floats 0.37 above
            // it. Declaring the truth lets the pose pick its low-lounger solve
            // (knees above hips, feet planted forward) instead of a squat.
            cushionH: 0.14, floorBelow: 0.37,
          });
        }
      }
      // exec livery: angled accent swoosh rising to the nose + thin midnight
      // echo line under it; the cabin windows are a CLEAR pane strip over the
      // open band with white frame pillars behind it.
      for (const sgn of [-1, 1]) {
        const fz = sgn * (FW / 2 + 0.02);
        K.put(acc, new THREE.BoxGeometry(7.5, 0.5, 0.06), 0.8, CY - 0.25, fz, 0, 0, 0.09);
        K.put(FLEET.navy, new THREE.BoxGeometry(6.2, 0.16, 0.05), 0.2, CY - 0.62, fz, 0, 0, 0.09);
        K.put(FLEET.glass, new THREE.BoxGeometry(5.4, 0.3, 0.06), 0, CY + 0.55, fz);
        for (let px = -2.0; px <= 2.0; px += 1.0) {
          K.put(FLEET.white, new THREE.BoxGeometry(0.24, 0.34, 0.1), px, CY + 0.55, sgn * (FW / 2 - 0.02));
        }
      }
      // AIRSTAIR DOOR (port, forward): a REAL hinged panel that tips outward-
      // down into boarding stairs (aircraft_doors.js eases it via doorRig).
      // Dark recess behind it = the doorway; dynamic-tagged for the freezer.
      K.put(FLEET.dark, new THREE.BoxGeometry(0.95, 1.3, 0.07), 3.5, CY - 0.1, -(FW / 2 + 0.03));
      const stairGeo = new THREE.BoxGeometry(0.95, 1.3, 0.07);
      stairGeo.translate(0, 0.65, 0);                          // pivot at the sill (bottom edge)
      const stair = new THREE.Mesh(stairGeo, FLEET.white);
      stair.position.set(3.5, CY - 0.75, -(FW / 2 + 0.06));
      stair.userData.dynamic = true;
      for (const sy of [0.35, 0.75, 1.1]) {                    // tread strips on the inner face
        const tread = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.07, 0.05), FLEET.dark);
        tread.position.set(0, sy, 0.05);
        stair.add(tread);
      }
      g.add(stair);
      g.userData.doorRig = {
        panel: stair, t: 0, mode: "stair",
        closedRot: 0, openRot: -1.72,                          // tips outboard-down into a stair
        doorX: 3.5, doorZ: -(FW / 2 + 0.06),
      };
      g.userData.cabin = g.userData.cabin || { floorTop: 1.37, doorX: 3.5, doorZ: -(FW / 2 + 0.06), seats: jetSeats, panel: null, doorT: 0 };

      // low swept wing pair + accent winglets
      K.put(FLEET.white, wingGeo(13.5, 3.0, 1.2, 0.32, 2.4, 0.5), -0.6, BELLY + 0.35, 0);
      for (const sgn of [-1, 1]) K.put(acc, new THREE.BoxGeometry(0.8, 1.05, 0.3), -3.0, 2.2, sgn * 6.65);

      // aft-mounted twin engine pods: sculpted pod + accent intake lip +
      // dark inlet disc + dark exhaust, on a stub pylon off the tail barrel
      for (const sgn of [-1, 1]) {
        const ez = sgn * (FW / 2 + 0.62);
        K.put(FLEET.white, fuseGeo(2.6, 1.0, 1.0, { nose: 0.92, tail: 0.6 }), -5.2, CY + 0.55, ez);
        K.put(acc, new THREE.BoxGeometry(0.26, 1.12, 1.12), -4.0, CY + 0.55, ez);
        K.put(FLEET.dark, new THREE.BoxGeometry(0.16, 0.8, 0.8), -3.9, CY + 0.55, ez);
        K.put(FLEET.dark, new THREE.BoxGeometry(0.4, 0.6, 0.6), -6.4, CY + 0.55, ez);
        K.put(FLEET.white, new THREE.BoxGeometry(1.3, 0.5, 0.5), -5.1, CY + 0.35, sgn * (FW / 2 + 0.18));
      }

      // refined T-tail: swept accent fin, white logo block, tailplane on top
      K.put(acc, finGeo(3.4, 2.6, 1.2, 0.3, 1.4), -8.0, 4.4, 0);
      K.put(FLEET.white, new THREE.BoxGeometry(0.55, 0.55, 0.42), -8.95, 5.25, 0);
      K.put(FLEET.white, wingGeo(4.6, 1.5, 0.9, 0.3, 0.7, 0), -9.0, 6.2, 0);

      // tricycle gear with belly cover plates; wheels bottom at y=0
      K.put(FLEET.metal, new THREE.BoxGeometry(0.24, 0.8, 0.24), 4.4, 0.7, 0);
      K.put(FLEET.tire, new THREE.CylinderGeometry(0.3, 0.3, 0.3, 10), 4.4, 0.3, 0, Math.PI / 2);
      K.put(FLEET.white, new THREE.BoxGeometry(0.8, 0.6, 0.08), 4.4, 0.78, 0.24);      // nose gear door
      for (const sgn of [-1, 1]) {
        K.put(FLEET.metal, new THREE.BoxGeometry(0.28, 0.7, 0.28), -1.7, 0.75, sgn * 1.05);
        K.put(FLEET.tire, new THREE.CylinderGeometry(0.35, 0.35, 0.32, 10), -1.7, 0.35, sgn * 1.05, Math.PI / 2);
        K.put(FLEET.white, new THREE.BoxGeometry(0.85, 0.65, 0.08), -1.7, 0.75, sgn * 1.34); // gear covers
      }
      K.bake(g);

      // nav lights: port red / starboard green wingtips, white tail, beacon
      navBox(g, FLEET.navR, -3.0, 1.95, -6.6, 0.2);
      navBox(g, FLEET.navG, -3.0, 1.95, 6.6, 0.2);
      navBox(g, FLEET.navW, -10.0, 5.9, 0, 0.2);
      navBox(g, FLEET.beacon, 0.4, 3.32, 0, 0.22);

      root.add(g);
      g.userData.aircraftDims = AIRCRAFT_DIMS.privatejet;
      g.userData.worldCollider = aircraftSolid(g, AIRCRAFT_DIMS.privatejet);
      return g;
    }

    /* ===================================================================
       THE AIRFRAMES, PUBLISHED (owner 2026-08-09: "package the airport so
       you can just duplicate and put it somewhere else easily without
       rewriting that code").

       These three functions are the only part of this file a SECOND airport
       actually needs, and until now they were locked inside this closure.
       They stay here — this is where the part kit, the cabin, the livery
       materials and the seat maths live, and moving them would fork the one
       airliner the game has. Publishing them costs three lines and buys
       city/airport_kit.js and systems/airline.js the whole aeroplane: hull,
       cabin, seats, pilots, doors, damage model and the hand-off to the
       player's flight physics, with no second copy of any of it.

       `boardable` is the important one: it is what makes a group a member of
       `placed`, and `placed` is what the gun path, the blast path, the
       boarding arc and the flight hand-off all read. A plane built without
       it is scenery.
       =================================================================== */
    CBZ.airportKit = {
      airliner: buildAirliner,        // (x, z, heading, livery) -> group
      jet: buildPrivateJet,           // (x, z, heading, livery) -> group
      boardable: boardablePlane,      // (group, x, z, heading, footW, footL, name)
      dims: AIRCRAFT_DIMS,
      scale: AL_SC,
      // the live boardable roster, so a flight can find the record it built
      records: function () { return placed; },
    };

    // parked airliners at the gates (along the terminal apron edge) — each a
    // STEALABLE aircraft (climb in and fly it off the gate).
    const liveries = [0x2d5fb0, 0xb33636, 0x1f7a4d, 0xc78a1f];
    // the larger the airliner, the further SOUTH it parks, so the up-scaled tail
    // stays clear of the terminal frontage (z=11) while the nose noses out toward
    // the taxiway. AL_SC=1 keeps the original gate line (one-number revert).
    const gateZ = APRON_Z - 14 - 11 * (AL_SC - 1);
    for (let i = 0; i < 4; i++) {
      const gx = -120 + ADX + i * 55;
      const hd = Math.PI / 2 + (rng() - 0.5) * 0.05;
      boardablePlane(buildAirliner(gx, gateZ, hd, liveries[i]), gx, gateZ, hd, 30, 22, "Airliner");
    }
    // private jets on the far apron — also stealable
    boardablePlane(buildPrivateJet(95 + ADX, APRON_Z - 6, Math.PI / 2 - 0.2, 0x355c8a), 95 + ADX, APRON_Z - 6, Math.PI / 2 - 0.2, 14, 12, "Private Jet");
    boardablePlane(buildPrivateJet(118 + ADX, APRON_Z + 2, Math.PI / 2 + 0.4, 0x6a3a6a), 118 + ADX, APRON_Z + 2, Math.PI / 2 + 0.4, 14, 12, "Private Jet");

    // =====================================================================
    //  8) ONE AIRLINER MID-PUSHBACK (scripted, purely visual) — a jet on a
    //     connector taxiway being eased back by a tug. It creeps along a
    //     short path then resets, so the field reads ALIVE without any
    //     physics or collision churn. CBZ.onUpdate, alloc-free.
    // =====================================================================
    (function pushback() {
      const jet = buildAirliner(-160 + ADX, TAX_Z - 6, Math.PI / 2, 0x444b55);
      const jetCollider = jet.userData.worldCollider;
      let jetSolid = true;
      function setJetSolid(on) {
        if (!jetCollider || jetSolid === on || !CBZ.colliders) return;
        const i = CBZ.colliders.indexOf(jetCollider);
        if (on && i < 0) CBZ.colliders.push(jetCollider);
        else if (!on && i >= 0) CBZ.colliders.splice(i, 1);
        jetSolid = on;
        if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
      }
      // a baggage tug shoved up against the nose — a REAL VEHICLE (owner law:
      // no dumb props): a proper little machine (cab, wheels, hitch) registered
      // in CBZ.cityCars via cityRegisterVehicle, so you can hop in and drive it
      // around the apron. The pushback animation yields the moment it's taken.
      const tug = new THREE.Group();
      tug.position.set(-160 + ADX + 16, 0, TAX_Z - 6);
      (function buildTug() {
        function tb(w, h, d, x, y, z, color, emissive) {
          const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
            emissive ? mat(color, { emissive: emissive, ei: 0.6 }) : mat(color));
          m.position.set(x, y, z); m.castShadow = true; tug.add(m);
          return m;
        }
        tb(2.6, 0.7, 1.9, 0.2, 0.75, 0, 0xe8c020);              // deck / hood
        tb(1.4, 0.9, 1.7, -0.5, 1.5, 0, 0xe8c020);              // cab back
        tb(0.9, 0.5, 0.12, 0.35, 1.35, 0, 0x2a2e33);            // dash
        tb(0.5, 0.6, 0.5, -0.5, 1.25, 0, 0x2a2e33);             // seat
        tb(0.5, 0.1, 1.7, 1.55, 0.55, 0, 0x6b7178);             // tow hitch
        tb(0.3, 0.18, 0.1, 1.45, 0.9, 0, 0xfff2cc, 0xffe9b8);   // work lamp
        const wgeo = new THREE.CylinderGeometry(0.34, 0.34, 0.3, 10);
        wgeo._shared = true;
        for (const wx of [0.85, -0.85]) for (const wz of [0.72, -0.72]) {
          const wh = new THREE.Mesh(wgeo, mat(0x17191d));
          wh.rotation.x = Math.PI / 2; wh.position.set(wx, 0.34, wz);
          wh.userData.playerWheel = true;                        // spins when driven
          tug.add(wh);
        }
      })();
      root.add(tug);
      // the tug ANIMATES (position.z below): tag it so the static batcher /
      // matrix freeze never bake it (an untagged group gets merged and the
      // pushback would visibly freeze).
      tug.userData.dynamic = true;
      let tugRec = null;
      if (CBZ.cityRegisterVehicle) {
        try {
          tugRec = CBZ.cityRegisterVehicle(tug, {
            body: "van", style: "van", persist: true, color: 0xe8c020,
            model: { name: "Baggage Tug", value: 9000, rarity: 0.1, body: "van" },
            dims: { width: 2.0, length: 3.4, height: 2.0, wheelbase: 1.7 },
          });
        } catch (e) { tugRec = null; }
      }
      // the pushback choreography must never fight the player for the tug
      function tugFree() { return !tugRec || (!tugRec.player && !tugRec.stolen && !tugRec.owned); }
      // One-way ground operation: dwell → push once → taxi away → reset only
      // while hidden. The old implementation eventually reversed the visible
      // airliner back into its start pose, even after a long pause.
      const z0 = TAX_Z - 6, z1 = TAX_Z - 30;
      const pushSeconds = 34, taxiSpeed = 3.2;
      let state = "dwell", phase = 0, dwellT = 12;
      CBZ.onUpdate(40, function (dt) {
        if (!jet || !jet.parent) return;
        if (state === "dwell") {
          dwellT -= dt;
          if (dwellT <= 0) { setJetSolid(false); state = "push"; }
          return;
        }
        if (state === "push") {
          phase = Math.min(1, phase + dt / pushSeconds);
          const e = phase * phase * (3 - 2 * phase);
          const z = z0 + (z1 - z0) * e;
          jet.position.z = z;
          if (tugFree()) tug.position.z = z + 16;
          if (phase >= 1) state = "taxi";   // tug stays parked in view — it's a real, enterable vehicle now
          return;
        }
        if (state === "taxi") {
          jet.position.z -= taxiSpeed * dt;
          // Clear the visible airport before recycling. The next lifecycle
          // begins parked, never driving backward through the player's view.
          if (jet.position.z < A_MINZ - 90) {
            jet.visible = false;
            jet.position.z = z0;
            if (tugFree()) { tug.position.z = z0 + 16; tug.position.x = -160 + ADX + 16; }
            phase = 0; dwellT = 45; state = "hidden";
          }
          return;
        }
        if (state === "hidden") {
          dwellT -= dt;
          if (dwellT <= 0) { jet.visible = true; setJetSolid(true); dwellT = 18; state = "dwell"; }
        }
      });
    })();

    // =====================================================================
    //  9) GATE EQUIPMENT — only equipment physically tied to the terminal.
    //     The former loose fuel/stair/cart box cluster read as placeholder
    //     geometry and obstructed approaches, so it is intentionally gone.
    // =====================================================================
    // jet-bridge stubs at the two EMPTY gate slots between the parked
    // airliners (occupied gates board by stair truck — the airliners park
    // tail-to-terminal, so a bridge at their gate would skewer the tail).
    // Elevated corridors off the terminal face: constants only, NO colliders
    // (underside 2.1u+, everything walks under), clear of every plane
    // collider (x ±15 around gates) and of the stolen-plane roll-out path.
    function jetBridge(bx) {
      box(bx, 3.4, 4.5, 3.0, 2.2, 13, 0x9fb4c4, { cast: true });     // corridor from the terminal
      box(bx, 3.4, -2.8, 3.6, 2.6, 2.6, 0x7d8894, { cast: true });   // gate-end head block
    }
    jetBridge(-92.5 + ADX); jetBridge(-37.5 + ADX);

    // =====================================================================
    //  10) PERIMETER FENCE — the WHY you can't drive into the sea except via
    //      the causeway. A thin collider wall around the footprint with a
    //      gap at the causeway mouth, plus ONE InstancedMesh of posts so it
    //      reads as chain-link. Y-gated low so it's a fence, not a building.
    // =====================================================================
    (function fence() {
      const T = 0.4, H = 2.4, gapX0 = CW_MINX - 2, gapX1 = CW_MAXX + 2;
      // PEDESTRIAN water-access gaps on the three SEAWARD edges (N/W/E). ~3m
      // wide — wider than the 0.55 player radius so you can WALK through to the
      // sea (swim.js auto-engages past the shore), narrower than a car so NPC
      // cars (pinned by clampToCity) still can't drive into the ocean. The
      // causeway side (south) keeps its full fence + checkpoint gate.
      const PG = 3;                                  // pedestrian gap half-span ≈1.5m
      const midX = (A_MINX + A_MAXX) / 2, midZ = (A_MINZ + A_MAXZ) / 2;
      /* ---- THE FRONTAGE OPENING (AIRPORT_ENTRY_V2) ---------------------
         OWNER (2026-07-28, verbatim): "ingress egress of the airport is
         awful… the road should lead up to the entrance for drop off — rn
         theres a FENCE literally right in front of the dropoff."

         He is describing this run, and it was not a near miss. The terminal's
         doors face +z at TERM_FRONT (37); the drop-off lane is at KERB_Z
         (38.5); this fence stood at A_MAXZ (40). A metre and a half of glass
         between the kerb and the sea, unbroken for 1190 m, with the nearest
         opening 190 m west at the water slipway — so the frontage read as a
         cage and the only way in was a 300 m detour round the east perimeter.

         THE OPENING IS DERIVED, NOT PICKED, and the derivation is the one the
         coordinator asked for: `city.roads` already carries a landside kerb
         record along this edge (pushed at the bottom of this file, centreline
         KERB_Z, deck 14 m) running from the terminal centreline east to
         PERIM_X. A 14 m deck centred at 38.5 spans z 31.5..45.5 — it CROSSES
         this fence line for its entire length. The fence was standing inside a
         road. So the run opens exactly where the road crosses it, extended one
         terminal half-bay west so the whole frontage is clear rather than
         ending in a stub beside the doors.

         What replaces it is what the fence was actually FOR out here. Its job
         on this edge was never security — airside is 30 m south behind its own
         keep-out — it was "you cannot drive into the sea". That is a KERB, so
         the opened span gets a 0.55 m balustrade with a real collider at the
         water's edge: it stops a car, you can see over it, and it cannot read
         as a wall in front of a doorway.

         MIGRATION OWED, and it is worth stating precisely because a shared
         block landed for this while this change was being written:
         roadrules.js now has CBZ.roadGapRun / roadGapAfterRoads — "a wall meets
         a road and yields" — which SPLITS a barrier run wherever a road crosses
         it, from the road's own derived carriage width. That is the general law
         this opening is a hand-derived instance of, and the whole perimeter
         (all four runs, the posts and the causeway gate) should move onto it.
         It is not a one-liner: this fence is built at order 21 and the roads it
         must yield to are pushed at the BOTTOM of this same builder, so it
         needs roadGapAfterRoads' order-98.6 deferral, which means the post
         InstancedMesh and the merged panel geometry have to be solved in that
         callback rather than here. Deliberately left as the next change rather
         than rushed; the colliders this section leaves are already stamped with
         the block's own exemption words (`roadBarrier`, `gate`) so
         roadBlockAudit reads them correctly in the meantime. */
      const OPEN_X0 = TERM_X0 - 10;                  // one half-bay west of the doors
      const OPEN_X1 = A_MAXX;                        // …east to the corner the perimeter road turns at
      const frontOpen = (x) => (CBZ.CONFIG.AIRPORT_ENTRY_V2 !== false && x > OPEN_X0 && x < OPEN_X1);
      // The perimeter stays visually fenced but has no world-sized collision
      // slabs. Those slabs were the repeated "invisible wall outside the
      // airport" report; gameplay boundaries must come from visible geometry,
      // terrain and water, never a hundreds-of-metres AABB.

      // decorative sand/ramp APRONS (no collider) at each seaward gap so it
      // reads as a slipway/beach down to the water.
      function apron(x, z, w, d) {
        const a = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat(0xcdb88a));
        a.rotation.x = -Math.PI / 2; a.position.set(x, 0.03, z);
        a.receiveShadow = true; a.matrixAutoUpdate = false; a.updateMatrix(); root.add(a);
      }
      apron(midX, A_MAXZ + 4, PG * 2 + 2, 10);       // north slipway
      apron(A_MINX - 4, midZ, 10, PG * 2 + 2);       // west slipway
      apron(A_MAXX + 4, midZ, 10, PG * 2 + 2);       // east slipway

      // posts — one instanced mesh, skipping ALL gate/gap spans
      const postGeo = new THREE.BoxGeometry(0.18, H, 0.18);
      const pts = [];
      const stepP = 8;
      const inGapZ = (z) => (z > midZ - PG && z < midZ + PG);
      const inGapX = (x) => (x > midX - PG && x < midX + PG);
      for (let x = A_MINX; x <= A_MAXX; x += stepP) {
        if (!inGapX(x) && !frontOpen(x)) pts.push([x, A_MAXZ]);  // north (skip centre gap + the frontage)
        if (x < gapX0 || x > gapX1) pts.push([x, A_MINZ]); // south (skip causeway gate)
      }
      for (let z = A_MINZ; z <= A_MAXZ; z += stepP) {
        if (!inGapZ(z)) { pts.push([A_MINX, z]); pts.push([A_MAXX, z]); } // W/E skip centre gaps
      }
      const inst = new THREE.InstancedMesh(postGeo, mat(C_FENCE), pts.length);
      inst.castShadow = false; const dm = new THREE.Object3D();
      for (let i = 0; i < pts.length; i++) { dm.position.set(pts[i][0], H / 2, pts[i][1]); dm.updateMatrix(); inst.setMatrixAt(i, dm.matrix); }
      inst.instanceMatrix.needsUpdate = true; root.add(inst);
      // thin mesh "mesh-fabric" panels (merged) so it isn't just posts
      if (BGU && BGU.mergeBufferGeometries) {
        const panels = [];
        function panelRun(x0, z0, x1, z1) {
          const len = Math.hypot(x1 - x0, z1 - z0);
          if (len < 0.5) return;
          const g = new THREE.BoxGeometry(len, H * 0.85, 0.05);
          g.rotateY(Math.atan2(z1 - z0, x1 - x0));
          g.translate((x0 + x1) / 2, H * 0.5, (z0 + z1) / 2);
          panels.push(g);
        }
        // north split around the centre gap AND the frontage opening
        panelRun(A_MINX, A_MAXZ, midX - PG, A_MAXZ);
        if (CBZ.CONFIG.AIRPORT_ENTRY_V2 !== false) panelRun(midX + PG, A_MAXZ, OPEN_X0, A_MAXZ);
        else panelRun(midX + PG, A_MAXZ, A_MAXX, A_MAXZ);
        // west split around centre gap
        panelRun(A_MINX, A_MINZ, A_MINX, midZ - PG);
        panelRun(A_MINX, midZ + PG, A_MINX, A_MAXZ);
        // east split around centre gap
        panelRun(A_MAXX, A_MINZ, A_MAXX, midZ - PG);
        panelRun(A_MAXX, midZ + PG, A_MAXX, A_MAXZ);
        // south split around causeway gate
        panelRun(A_MINX, A_MINZ, gapX0, A_MINZ);
        panelRun(gapX1, A_MINZ, A_MAXX, A_MINZ);
        // This is collision-bearing security fencing, so it must remain plainly
        // visible against bright sea/sky.  At 0.18 opacity the collider read as
        // an invisible wall anywhere between the widely spaced posts.  A darker,
        // depth-writing mesh keeps the chain-link feel while making every solid
        // span agree with what the player can actually see.
        const fm = CBZ.glass
          // the SAME glass as the towers, seen from both sides. The old flat
          // grey 0x66717d had no emissive lift, which is exactly why an
          // airliner window read as a dead grey slot instead of a pane.
          ? CBZ.glass({ opacity: 0.5, side: THREE.DoubleSide })
          : new THREE.MeshLambertMaterial({ color: 0x66717d, transparent: true, opacity: 0.52, depthWrite: true, side: THREE.DoubleSide });
        const fmesh = new THREE.Mesh(BGU.mergeBufferGeometries(panels), fm);
        fmesh.matrixAutoUpdate = false; root.add(fmesh);
      }
      // …and the SEA WALL that takes over the opened span's real job. One
      // merged run, y-gated 0..0.55 so it stops a car and a walking body
      // without ever reading as a barrier in front of a door.
      if (CBZ.CONFIG.AIRPORT_ENTRY_V2 !== false) {
        const BH = 0.55, seg = 30;
        for (let x = OPEN_X0; x < OPEN_X1; x += seg) {
          const w = Math.min(seg, OPEN_X1 - x);
          box(x + w / 2, BH / 2, A_MAXZ, w, BH, 0.30, C_CONC, { cast: false });
          // `roadBarrier` is roadrules.js's own word (colliderExempt) and it is
          // the literally correct one: this run lies ALONGSIDE the kerb lane at
          // the water's edge, which is what a barrier is for. Without the stamp
          // roadBlockAudit would read a 415 m parapet as a wall in a
          // carriageway and the gap law would try to cut the one thing out here
          // that must never be cut.
          solid(x + w / 2, A_MAXZ, w, 0.30, 0, BH).roadBarrier = true;
        }
      }
    })();

    // =====================================================================
    //  10b) THE FORECOURT (AIRPORT_ENTRY_V2) — "the road should lead up to
    //       the entrance for drop off". Opening the fence is half of it; the
    //       other half is that an entrance has to READ as one. Nothing here
    //       invents a system: it is paint, four box primitives and one call
    //       each to the shared lamp solve and the parked-car builder.
    //
    //       WHERE THE VOLUME IS. The frontage strip at the doors is genuinely
    //       only 3 m deep (TERM_FRONT 37 → FRONT_Z 40), which is a kerb lane
    //       and nothing else — no room for a column, a rank or a footpath. But
    //       EAST of the terminal the landside is wide open: from TERM_X1 (35)
    //       to PERIM_X (268) with 26 m of depth. That is where an airport
    //       forecourt belongs and where all the volume goes; the frontage
    //       itself gets a CANTILEVERED canopy that costs no floor at all.
    // =====================================================================
    (function forecourt() {
      if (CBZ.CONFIG.AIRPORT_ENTRY_V2 === false) return;
      const PLZ_X0 = TERM_X1 + 6, PLZ_X1 = TERM_X1 + 96;   // 41 → 131 + ADX
      const PLZ_Z0 = 14 + ADZ, PLZ_Z1 = FRONT_Z;           // 26 m of real depth
      // ---- the plaza deck, painted so the ground says where to drive.
      mergePaint([quadGeo((PLZ_X0 + PLZ_X1) / 2, (PLZ_Z0 + PLZ_Z1) / 2,
        PLZ_X1 - PLZ_X0, PLZ_Z1 - PLZ_Z0, 0.05)], 0x53585e, 0.05);

      /* ---- THE ENTRY GATE at the plaza's east mouth. You drive under it and
         you have arrived — which is the whole difference between an entrance
         and a hole in a fence.

         IT IS A SINGLE PYLON, not a pair, and that is measured rather than
         stylistic: the lane centre is KERB_Z (38.5) and the island's edge is
         FRONT_Z (40), so a car's own half-width already reaches 39.5 and there
         is no room on the north side for a post that a car would not clip. The
         north side of the gate is therefore the SEA WALL the fence opening left
         behind — 0.55 m of parapet that is already there — and the gantry
         cantilevers to it. Clear width 5.85 m against a 2 m car.
         Colliders on the pylon only; the gantry is 6.6 m up. */
      const GATE_Z = KERB_Z - 5.5;                     // pylon centre, south side
      box(PLZ_X1, 3.4, GATE_Z, 1.1, 6.8, 1.1, C_CONC, { cast: true });
      // `gate` — roadrules.js's colliderExempt word for hardware that stands
      // beside a carriageway ON PURPOSE. A gatepost is the one collider at a
      // road's edge that is not an accident.
      solid(PLZ_X1, GATE_Z, 1.1, 1.1, 0, 6.8).gate = true;
      box(PLZ_X1, 6.6, (GATE_Z + FRONT_Z) / 2, 1.2, 0.9, FRONT_Z - GATE_Z,
        0x2f3a46, { cast: true, emissive: 0x1d3550, ei: 0.35 });
      if (CBZ.makeLabelSprite) {
        const s = CBZ.makeLabelSprite("→ DEPARTURES · ARRIVALS", { color: "#ffd451" });
        if (s) { s.position.set(PLZ_X1, 6.6, (GATE_Z + FRONT_Z) / 2 + 0.7); s.scale.set(13, 1.7, 1); root.add(s); }
      }
      // the PEDESTRIAN gate — its own opening well south of the carriageway,
      // two posts with 2.4 m between them, and the footway threads it.
      const PED_Z = GATE_Z - 4.5;                      // 28.5 — clear of the lane
      [PED_Z - 1.2, PED_Z + 1.2].forEach(function (pz) {
        box(PLZ_X1, 1.6, pz, 0.5, 3.2, 0.5, C_CONC, { cast: true });
        solid(PLZ_X1, pz, 0.5, 0.5, 0, 3.2).gate = true;
      });

      /* FOOTWAY — the pedestrian leg of the arrival, walked end to end:
         through the pedestrian gate, west across the plaza, north to the
         frontage, then along the terminal wall to the doors. Three straight
         runs, all south of the carriageway, so a walker never shares ground
         with the drop-off lane. Paint only — nothing here has a collider. */
      const foot = [];
      const TURN_X = TERM_X1 - 4;
      foot.push(quadGeo((TURN_X + PLZ_X1 + 6) / 2, PED_Z,
        (PLZ_X1 + 6) - TURN_X, 1.4, 0.07));            // gate → the turn
      foot.push(quadGeo(TURN_X, (PED_Z + TERM_FRONT + 0.42) / 2,
        1.4, (TERM_FRONT + 0.42) - PED_Z, 0.07));      // north to the frontage
      // …and the frontage leg narrows to 0.8 m, because that is all the strip
      // has: wall at TERM_FRONT (37), lane edge at 37.8. A wider path here
      // would only be paint drawn under the cars.
      foot.push(quadGeo((TERM_X0 + TURN_X) / 2, TERM_FRONT + 0.42,
        TURN_X - TERM_X0, 0.8, 0.07));                 // along the wall to the doors
      foot.push(quadGeo(APRON_X, KERB_Z, 9, 0.5, 0.07));  // and a crossing at the doors
      mergePaint(foot, 0xd8dde3, 0.07);

      // ---- THE CANOPY over the doors. CANTILEVERED off the terminal's north
      //      wall on angled struts — a columned porte-cochère cannot fit in a
      //      3 m strip without standing in the lane, and a canopy you have to
      //      swerve round is a worse entrance than none.
      const CAN_W = 62, CAN_OUT = 2.6, CAN_Y = 5.4;
      box(APRON_X, CAN_Y, TERM_FRONT + CAN_OUT / 2, CAN_W, 0.35, CAN_OUT,
        0x8d97a1, { cast: true });
      for (let k = -2; k <= 2; k++) {
        const sx = APRON_X + k * (CAN_W / 5);
        const st = box(sx, CAN_Y - 0.95, TERM_FRONT + 0.75, 0.22, 2.3, 0.22, 0x6b737b, { cast: false });
        st.rotation.x = -0.62;                    // leans back to the wall
      }
      // …and it is LIT, because an entrance canopy that goes dark at dusk is
      // where the whole read falls over. One emissive strip, no light object.
      box(APRON_X, CAN_Y - 0.24, TERM_FRONT + CAN_OUT - 0.25, CAN_W - 3, 0.12, 0.30,
        0xfff0cf, { emissive: 0xffe6b0, ei: 0.85, cast: false });

      // ---- LAMPS along the arrival, through the SHARED solve (CLAUDE.md:
      //      "A LUMINAIRE IS A POLE, AN ARM AND A HEAD ON THE ARM'S TIP").
      //      Degrade-safe: no lampMast, no lamps — never a hand-rolled mast.
      const LM = CBZ.lampMast ? CBZ.lampMast({ poleH: 6.2, reach: 1.7, rise: 0.32, poleR: 0.12 }) : null;
      if (LM) {
        for (let x = PLZ_X0 + 10; x <= PLZ_X1 - 6; x += 26) {
          const g = new THREE.Group();
          g.position.set(x, 0, PLZ_Z0 + 1.6);
          g.rotation.y = 0;                        // local +Z faces the lane (north)
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(LM.poleR, LM.poleR * 1.3, LM.poleH, 6), mat(0x6f767d));
          pole.position.y = LM.poleCY; g.add(pole);
          const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, LM.armLen, 5), mat(0x6f767d));
          arm.rotation.x = LM.armRotX; arm.position.set(0, LM.armCY, LM.armCZ); g.add(arm);
          const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.62), mat(0x4c535a));
          head.position.set(0, LM.headY, LM.headZ); g.add(head);
          const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.05, 0.5),
            mat(0xfff2d0, { emissive: 0xffe9b8, ei: 0.9 }));
          bulb.position.set(0, LM.bulbY, LM.bulbZ); g.add(bulb);
          root.add(g);
          solid(x, PLZ_Z0 + 1.6, 0.4, 0.4, 0, LM.poleH);
        }
      }

      /* ---- THE TAXI RANK ------------------------------------------------
         OWNER (verbatim): "in front there can be a line of taxis waiting to
         pick people up — they dont have to move — full of taxi drivers."

         And it costs no new verb. `cab driver` is already a CITY_JOBS trade
         (aigoals.js) and shops.js already registers `ped-cab-ride` — "Flag a
         cab" — on the ped:civ layer, gated only on the job string, the player
         not driving and wanted < 2. It does NOT filter a seated body, and
         interact.js's `src-ped` source finds any live ped by world position —
         which npclife syncs every frame for an attached actor. So a driver
         sitting in a parked cab is a fully interactive cab driver the moment
         he has the job string. Nothing here registers a verb.

         THE RANK IS ITS OWN LANE, per real airport grammar and per the owner's
         constraint: it sits at RANK_Z, 15 m south of the drop-off lane, so a
         stationary queue can never block the kerb it serves. Placement is a
         position hash, never Math.random. */
      const RANK_Z = KERB_Z - 15, RANK_N = 6, RANK_GAP = 6.4;
      const rankPaint = [];
      rankPaint.push(quadGeo(PLZ_X0 + 8 + (RANK_N - 1) * RANK_GAP / 2, RANK_Z,
        RANK_N * RANK_GAP + 2, 3.2, 0.08));
      mergePaint(rankPaint, 0xd8b53a, 0.08);
      if (CBZ.makeLabelSprite) {
        const s = CBZ.makeLabelSprite("TAXI", { color: "#ffd451" });
        if (s) { s.position.set(PLZ_X0 + 4, 2.6, RANK_Z); s.scale.set(4.6, 2.0, 1); root.add(s); }
      }
      // deferred: cityAddParkedCar needs a live arena, and cityStaffPost needs
      // the ped roster — neither exists while a landmass builder is running.
      // Same one-shot trick the parked fleet and the kerb traffic already use.
      if (CBZ.onUpdate) {
        CBZ.onUpdate(55.36, function () {
          if (rankDone) return;
          if (!CBZ.game || CBZ.game.mode !== "city") return;
          if (!CBZ.city || !CBZ.city.arena || !CBZ.cityAddParkedCar) return;
          rankDone = true;
          // DECLARE THE VENUE FIRST — cityStaffVenue CLEARS the venue's posts,
          // so calling it after the loop would reap every driver we just hired.
          if (CBZ.cityStaffVenue) {
            try { CBZ.cityStaffVenue("airport-rank", { stations: RANK_N, note: "terminal taxi rank" }); } catch (e) {}
          }
          for (let i = 0; i < RANK_N; i++) {
            const tx2 = PLZ_X0 + 8 + i * RANK_GAP;
            let rec = null;
            try { rec = CBZ.cityAddParkedCar(tx2, RANK_Z, Math.PI / 2, { modelName: "Taxi" }); } catch (e) { rec = null; }
            if (!rec || !rec.group) continue;
            rec.group.userData.airportTaxi = true;
            taxiRank.push(rec);
            // A DRIVER, not a decal. citystaff mints the body only inside 170 m
            // (invisible AND unwatchable by construction) and reaps it past 320;
            // the seat is npclife's anchor grammar, exactly as airside.js's
            // service-vehicle crew works, so syncAttached holds the pose and
            // peds.js leaves the body alone.
            if (!CBZ.cityStaffPost) continue;
            (function (car, idx) {
              CBZ.cityStaffPost({
                venue: "airport-rank", id: "airport:taxi:" + idx,
                job: "cab driver", archetype: "merchant",
                x: car.pos.x, z: car.pos.z, face: Math.PI / 2,
                alive: function () { return !!(car.group && car.group.parent) && !car.player && !car.stolen; },
                attach: function (ped) {
                  if (!CBZ.npcLife || !CBZ.npcLife.attach) return false;
                  const node = taxiSeatNode(car);
                  if (!node) return false;
                  ped._seatHold = true;
                  return !!CBZ.npcLife.attach(ped, node, {
                    x: 0.34, y: 0.62, z: 0.10, yaw: 0, pose: "sit", state: "sit",
                    cushionH: 0.43, floorBelow: 0,
                  });
                },
                release: function (ped, why) {
                  if (why !== "gone" && why !== "dead") return false;
                  if (CBZ.cityUnseat) { try { CBZ.cityUnseat(ped, { state: ped.dead ? "dead" : "walk", keepPose: true }); } catch (e) {} }
                  return true;
                },
                after: function (ped) { ped.job = "cab driver"; },
              });
            })(rec, i);
          }
        });
      }
    })();

    // =====================================================================
    //  11) CAUSEWAY — the one drivable road on/off the island. Deck plane
    //      from the mainland north edge (z≈-566) to the airport south edge
    //      (z=-280), low concrete kerbs (colliders) so you can't drive off
    //      the side, and a dashed centre line.
    // =====================================================================
    (function causeway() {
      const cx = (CW_MINX + CW_MAXX) / 2, len = CW_MAXZ - CW_MINZ;
      const cz = (CW_MINZ + CW_MAXZ) / 2;
      // REAL HIGHWAY: a wide multi-lane causeway across the water (merged deck +
      // baked lanes + instanced guardrails/lights + continuous curb colliders).
      if (CBZ.buildHighway) {
        CBZ.buildHighway(root, {
          path: [{ x: cx, z: CW_MINZ }, { x: cx, z: CW_MAXZ }],
          width: 24, lanesPerDir: 3, median: true, medianW: 1.2, laneW: 3.6, theme: "asphalt",
          guardrail: false, elevated: false, rng: rng,
        });
        return;
      }
      // ---- fallback: bespoke narrow deck (only if buildHighway absent) ----
      const deck = new THREE.Mesh(new THREE.PlaneGeometry(CW_MAXX - CW_MINX, len), mat(0x44484d));
      deck.rotation.x = -Math.PI / 2; deck.position.set(cx, 0.02, cz);
      deck.receiveShadow = true; deck.matrixAutoUpdate = false; deck.updateMatrix(); root.add(deck);
      // no curb/rail collision: the open deck is jumpable and traversable
      // dashed centre line (merged)
      const dl = [];
      for (let z = CW_MINZ + 4; z < CW_MAXZ - 4; z += 8) dl.push(quadGeo(cx, z, 0.4, 4, 0.04));
      mergePaint(dl, 0xe9e9ea);
      // light poles down the causeway — one instanced mesh
      const poleGeo = new THREE.BoxGeometry(0.25, 6, 0.25);
      const n = Math.floor(len / 26), inst = new THREE.InstancedMesh(poleGeo, mat(0x6b7178), n * 2);
      const dm = new THREE.Object3D(); let idx = 0;
      for (let i = 0; i < n; i++) {
        const z = CW_MINZ + 13 + i * 26;
        dm.position.set(CW_MINX - 1.0, 3, z); dm.updateMatrix(); inst.setMatrixAt(idx++, dm.matrix);
        dm.position.set(CW_MAXX + 1.0, 3, z); dm.updateMatrix(); inst.setMatrixAt(idx++, dm.matrix);
      }
      inst.instanceMatrix.needsUpdate = true; root.add(inst);
    })();

    // =====================================================================
    //  12) POPULATE — passengers with luggage in the concourse, ground crew
    //      in hi-vis on the apron, a couple taxis at the landside curb. A
    //      handful of interactive rigs via cityMakePed (rifle-able cash);
    //      the apron crowd is light so the field doesn't tank the budget.
    // =====================================================================
    (function populate() {
      if (!CBZ.cityMakePed) return;
      const populationEntries = [];
      // One registration path for every authored airport person.  The old
      // block called cityMakePed and threw the returned rig away, so the
      // terminal's alleged passengers/crew never entered the scene or the
      // interactive city roster.  npcLife owns the normal path; this fallback
      // mirrors its registerCity contract for builds that omit that module.
      // `job` is now stamped through airportRole() rather than only living in
      // the makePed overrides, so ONE function owns "what does this airport
      // person do" for the concourse, the apron, the desks and the cabins alike
      // — and cabinAudit().roleless can actually measure it.
      function airportActor(profile, x, z, opts, role, job, post) {
        function fit(p) {
          if (!p) return p;
          airportRole(p, job || (opts && opts.job), role);
          // posted staff hold their spot: occupy.js's `staffPost` is peds.js's
          // OWN rooted-worker brain (no wander, no crowd recast, still gunpoint-
          // aware, still dies through the kill bus). No new loop, no new roster.
          if (post) {
            p.staffPost = { x: x, z: z, face: post.face || 0 };
            p.state = "idle"; p.speed = 0;
            if (p.group && post.face != null) p.group.rotation.y = post.face;
          }
          return p;
        }
        if (CBZ.npcLife && CBZ.npcLife.definePopulation) {
          populationEntries.push({
            profile: profile, placement: { x: x, z: z, rng: rng, yaw: post ? post.face : null },
            overrides: opts || {}, configure: fit,
          });
          return null;
        }
        if (CBZ.npcLife) {
          return fit(CBZ.npcLife.spawnCity(profile, { x: x, z: z, parent: root, rng: rng }, opts || {}));
        }
        const p = CBZ.cityMakePed(x, z, rng, opts || {});
        if (!p || !p.group) return null;
        root.add(p.group);
        if (CBZ.cityPeds && CBZ.cityPeds.indexOf(p) < 0) CBZ.cityPeds.push(p);
        return fit(p);
      }
      // passengers in the terminal (carry-on, low aggression travellers)
      for (let i = 0; i < 14; i++) {
        const sx = APRON_X + (rng() - 0.5) * 130;
        const sz = 24 + ADZ + (rng() - 0.5) * 18;
        airportActor("terminalTraveller", sx, sz, {
          kind: "civilian", archetype: "tourist", job: "traveller",
          wealth: 0.4 + rng() * 0.4, aggr: 0.06 + rng() * 0.08,
        }, "traveller", "traveller");
      }
      // ground crew in hi-vis on the apron near the jets. The spawn band used
      // to straddle the parked airliners' own lanes (measured: 6 of 7 bodies
      // standing inside a fuselage footprint — the owner's "people under
      // planes"), so each roll is now pushed OUT of the two airliner gate
      // lanes: a ramp agent works beside the hull, never inside it.
      const GATE_LANES = [-120 + ADX, -10 + ADX];
      for (let i = 0; i < 6; i++) {
        let sx = -120 + ADX + rng() * 220;
        const sz = APRON_Z - 18 + (rng() - 0.5) * 18;
        for (let gl = 0; gl < GATE_LANES.length; gl++) {
          const d = sx - GATE_LANES[gl];
          if (Math.abs(d) < 6) sx = GATE_LANES[gl] + (d >= 0 ? 6.5 : -6.5);
        }
        airportActor("groundCrew", sx, sz, {
          kind: "worker", archetype: "laborer", job: "ground crew",
          outfit: 0xffc81f, wealth: 0.25, aggr: 0.12 + rng() * 0.06,
        }, "ground-crew", "ground crew");
      }
      // GATE AGENTS behind the four check-in desks, facing the queue (-z). The
      // desks have existed since this island was built and nobody has ever stood
      // at one; a counter with no one behind it is the same dead prop as a seat
      // nothing can sit on. They are posted, not wandering, so the desk is
      // always staffed. Desk geometry (dx, tz + td/2 - 3) is read from the same
      // constants the desks were drawn with — no second copy of the layout.
      {
        const tx = APRON_X, tz = TERM_Z, tw = TERM_W, td = TERM_D;
        for (let k = 0; k < 4; k++) {
          const dx = tx - tw / 2 + 20 + k * 30;
          airportActor("venueWorker", dx, tz + td / 2 - 1.4, {
            kind: "worker", archetype: "laborer", job: "gate agent",
            outfit: 0x2f4f78, wealth: 0.35, aggr: 0.08,
          }, "gate-agent", "gate agent", { face: Math.PI });
        }
      }
      if (populationEntries.length && CBZ.npcLife && CBZ.npcLife.definePopulation) {
        CBZ.npcLife.definePopulation("airport-authored", { root: root, entries: populationEntries });
      }
    })();

    // Taxis at the landside kerb. TWO things were wrong with the old line and
    // the comment was one of them:
    //   • it said "south of the terminal", but the terminal's door is
    //     doorSide 1 = +z = NORTH. The kerb is north.
    //   • z was 42 + ADZ, and the island's own north edge is A_MAXZ = 40 + ADZ
    //     — so all three taxis were parked two metres OFF the island, sitting
    //     on the shoreline/water. Nobody had ever plotted them against the
    //     rect they belong to.
    // 38.5 puts them on the 3 m kerb strip between the terminal's north wall
    // (z 37) and the island edge, which is where a kerb actually is.
    if (CBZ.cityMakeCar && CBZ.cityEcon && CBZ.cityEcon.carByName) {
      const taxiModel = CBZ.cityEcon.carByName("Taxi") || CBZ.cityEcon.carByName("Sedan") || null;
      for (let i = 0; i < 3; i++) {
        try { CBZ.cityMakeCar(-70 + ADX + i * 14, 38.5 + ADZ, Math.PI / 2, false, taxiModel, 0.2); } catch (e) {}
      }
    }

    // =====================================================================
    //  WORK-ANCHOR — the ground crew's apron: turn the planes at the gates.
    //  The aigoals brain routes ground crew through these apron task points on
    //  the schedule. WHY: the field is WORKED — crew marshals/fuels/loads the
    //  jets parked at the gates. The terminal is their base/home. Reuses the
    //  apron + gate coords already built (no new geometry).
    // =====================================================================
    if (CBZ.registerWorkAnchor) {
      CBZ.registerWorkAnchor({
        biome: "airport", kind: "terminal", role: "ground crew",
        x: APRON_X, z: APRON_Z - 16, cap: 6,
        home: { x: APRON_X, z: 24 + ADZ },                  // the terminal concourse
        spots: [
          // The two gate spots used to be the AIRCRAFT ORIGIN coordinates, so
          // aigoals routed crew to stand at the fuselage centre on schedule —
          // the other half of the owner's "people under planes". +7 in x puts
          // the task point BESIDE the hull (a ramp agent's position), still on
          // the same gate line.
          { x: -113 + ADX, z: APRON_Z - 14 - 11 * (AL_SC - 1) },  // beside gate 1 airliner (tracks the up-scaled gate line)
          { x: -3 + ADX, z: APRON_Z - 14 - 11 * (AL_SC - 1) },    // beside the mid-apron gate
          { x: 95 + ADX, z: APRON_Z - 6 },                        // the private-jet apron
          { x: APRON_X, z: APRON_Z + 18 },                        // the baggage / GSE line
        ],
      });
    }

    // =====================================================================
    //  13) REGISTER THE REGIONS — walkable airport footprint + the causeway
    //      deck. world.js/swim.js/fullmap consult these.
    // =====================================================================
    CBZ.registerCityRegion(city, {
      name: "Halloran Field", subtitle: "International Airport", biome: "airport", kind: "rect",
      minX: A_MINX, maxX: A_MAXX, minZ: A_MINZ, maxZ: A_MAXZ, pad: 6,
    });
    CBZ.registerCityRegion(city, {
      name: "Halloran Causeway", subtitle: "International Airport", kind: "rect",
      minX: CW_MINX, maxX: CW_MAXX, minZ: CW_MINZ, maxZ: CW_MAXZ, pad: 1,
    });
    // Canonical PLAYER spawn: open apron between the terminal wall (z=11)
    // and the parked gate aircraft (z=-14). It is on solid airport ground,
    // outside every building/aircraft collider, and faces the airliners/runway.
    // Also replace the arena's old downtown fallback so every generic city
    // spawn consumer (origin fallback, rented room, no-hospital fallback) agrees.
    city.airportSpawn = { x: APRON_X, y: 0, z: 7 + ADZ, yaw: Math.PI, place: "Halloran Field apron" };
    city.spawn = { x: city.airportSpawn.x, z: city.airportSpawn.z };
    // NO-SPAWN keep-outs (owner: "NPCs spawning all over the runway and
    // inside the airport — they belong in terminal areas/curbs"). Every
    // scatter/relocation path (worldmap.js citySpawnBlocked) refuses these:
    //   • AIRSIDE — everything south of the terminal frontage: the runway
    //     (z≈-90), taxiway (z≈-40) and the open apron/ramp.
    //   • the terminal building's own footprint (tx=-40,tz=24,tw=150,td=26 →
    //     x[-115,35] z[11,37]) so nobody materializes inside the concourse.
    // Hand-placed staff (populate()'s ground crew/passengers) don't route
    // through the scatter paths, so the authored airport life is untouched.
    /* THE KEEP-OUT IS THE MOVEMENT AREA, NOT THE ISLAND (AIRPORT_ENTRY_V2).
       Walking the arrival end to end in code is what found this: the causeway
       lands at (0, A_MINZ) and the east perimeter road starts at (PERIM_X,
       A_MINZ) — 268 m apart, with NO road record between them and nothing but
       airside in between. The route the previous wave intended (causeway →
       east along the south edge → north up the perimeter → west to the kerb)
       had its first leg missing, so the only way off the causeway really was
       across the field.

       The link cannot be `access:"service"` — it is the airport's main
       entrance — so the keep-out has to be the right SHAPE instead. It was the
       whole southern island; it is now the movement area, with a 26 m landside
       access corridor along the south edge. That corridor is 149 m south of
       the runway's own strip edge (RWY_Z -90, half-width 15 → -105, against a
       corridor ending at -254), so nothing about the runway, the taxiway or
       the apron changes: `airsideAudit().onRunway` reads a different rect
       entirely, and the keep-out still bars every ambient path from all of it.
       ONE declaration, consumed twice — the audit mirror used to be a hand
       copy, which is how a keep-out and its own census start disagreeing. */
    const LANDSIDE_S = CBZ.CONFIG.AIRPORT_ENTRY_V2 !== false ? 26 : 0;
    const NO_SPAWN = [
      { minX: A_MINX, maxX: A_MAXX - 32, minZ: A_MINZ + LANDSIDE_S, maxZ: 9 + ADZ, label: "airport-airside" },
      { minX: -116 + ADX, maxX: 36 + ADX, minZ: 10 + ADZ, maxZ: 38 + ADZ, label: "airport-terminal" },
    ];
    if (CBZ.registerNoSpawnZone) {
      for (let i = 0; i < NO_SPAWN.length; i++) CBZ.registerNoSpawnZone(city, NO_SPAWN[i]);
    }
    city.airportAudit = {
      bounds: { minX: A_MINX, maxX: A_MAXX, minZ: A_MINZ, maxZ: A_MAXZ },
      runway: { minX: RWY_X0, maxX: RWY_X1, minZ: RWY_Z - RWY_W / 2, maxZ: RWY_Z + RWY_W / 2 },
      noSpawn: NO_SPAWN,
      aircraft: AIRCRAFT_DIMS,
    };

    /* ===================================================================
       HALLORAN JOINS THE NETWORK (systems/airports.js). Not a copy of the
       layout above — every number handed over is the SAME variable the
       surface was drawn from, so the record cannot drift from the runway
       and the worldOff dial moves both together. The frame's origin is the
       runway MIDPOINT and its local +Z is the apron side, which is exactly
       how this island was always authored; that is why the conversion below
       is subtraction and nothing else.

       Without this the network has one node and a flight has nowhere to go.
       =================================================================== */
    if (CBZ.registerAirport) {
      /* THE STANDS. The four gates are the four the fleet is parked on, read
         off the same expression the parked loop used. The two after them are
         REMOTE STANDS on the east ramp, 115 m clear of the terminal and 32 m
         clear of the private-jet line — and they are not decoration: a field
         whose every stand is occupied by a permanently parked aeroplane is a
         field an arriving flight cannot park at, which is exactly how a
         shuttle network wedges itself. A real airport keeps remote stands for
         the same reason. */
      const gateLX = [];
      for (let i = 0; i < 4; i++) gateLX.push((-120 + ADX + i * 55) - RWY_CX);
      gateLX.push((150 + ADX) - RWY_CX, (205 + ADX) - RWY_CX);
      CBZ.registerAirport({
        id: "halloran", name: "Halloran Field", code: "HLR",
        city: "Los Vantos", hub: true, builtBy: "island_airport",
        x: RWY_CX, z: RWY_Z, yaw: 0,
        runway: { len: RWY_LEN, w: RWY_W, tdz: 180 },
        // the two connector taxiways this island actually drew (CONN_XS)
        connectors: CONN_XS.map(function (x) { return x - RWY_CX; }),
        taxiZ: TAX_Z - RWY_Z,
        apronZ: APRON_Z - RWY_Z,
        standZ: gateZ - RWY_Z,
        termZ: TERM_Z - RWY_Z,
        kerbZ: KERB_Z - RWY_Z,
        gates: gateLX.map(function (lx, i) {
          return {
            id: i < 4 ? ("HLR-" + (i + 1)) : ("HLR-R" + (i - 3)),
            lx: lx, lz: gateZ - RWY_Z, heading: -Math.PI / 2, size: "airliner",
          };
        }),
        // the westmost of the four check-in counters the concourse already
        // draws (buildTerminal's `dx = tx - tw/2 + 20 + k*30`, k=0), with the
        // player standing on the queue side of it.
        desk: {
          lx: (APRON_X - TERM_W / 2 + 20) - RWY_CX,
          lz: (TERM_Z + TERM_D / 2 - 5.2) - RWY_Z,
          heading: 0, label: "Halloran Field",
        },
        bounds: { minX: A_MINX, maxX: A_MAXX, minZ: A_MINZ, maxZ: A_MAXZ },
      });
    }
    // give traffic a road down the causeway (runs along Z → vertical)
    if (city.roads) {
      /* THE CAUSEWAY RUNS ONTO THE ISLAND, not up to its edge. It used to stop
         dead at CW_MAXZ (=== A_MINZ), which is the shoreline — so it shared no
         ground with anything and CBZ.roadJunctions, which derives a junction
         from two records OVERLAPPING, could never find one here. It now reaches
         the approach link below, and the two cross at (CW_X, LINK_Z): one real,
         derived T-junction where the bridge meets the airport. */
      const LINK_Z = A_MINZ + 13, CW_X = (CW_MINX + CW_MAXX) / 2;
      const cwEnd = CBZ.CONFIG.AIRPORT_ENTRY_V2 !== false ? LINK_Z : CW_MAXZ;
      city.roads.push({ x: CW_X, z: (CW_MINZ + cwEnd) / 2, vertical: true, len: cwEnd - CW_MINZ, district: "highway", w: 24, lanesPerDir: 3, laneW: 3.6, median: true, medianW: 1.2 });

      /* ---- THE PERIMETER ACCESS ROAD --------------------------------------
         Until now the airport had NO landside road. The causeway arrives at
         the island's SOUTH edge (CW_MAXZ === A_MINZ) and the terminal's door
         is doorSide 1 = +z = NORTH — so the only way a car could reach the
         terminal kerb was to drive up the middle of the airfield and ACROSS
         RUNWAY 09/27. That is the physical half of the owner's "cars inside
         the airport near the runway": even after roadrules.js stopped ambient
         traffic from being PLACED airside, the geometry still said the runway
         was the road to the terminal.

         So the island gets the road a real airport has: up the EAST side, well
         clear of the runway's east threshold (RWY_X1), then west along the
         north edge to the departures kerb. Two ordinary road records — the
         same shape every builder pushes — so the road network, the navmesh,
         speed limits and roadPick all understand it with no special case.

         Both are tagged `district: "airport"`, which roadrules.js weights low
         (a service perimeter is not Main Street) but leaves OPEN.

         THE KERB LEG is outside the keep-out by construction: z = 38.5, north
         of the zone's z <= 9 + ADZ ceiling.

         THE PERIMETER SPUR WAS NOT, and the earlier version of this comment
         claimed it was. The airside zone was declared out to A_MAXX while this
         road sits at A_MAXX - 22 — so it ran 22 m INSIDE the keep-out for its
         whole 289 m length, which is precisely the "roads overlap places like
         the airport" the owner reported, introduced by the very change that
         was meant to stop traffic crossing the runway. Caught by
         roadClearance's zoneCrossings, not by reading.

         Fixed on the ZONE side rather than by moving the road, because the
         zone was the thing that was wrong: an airfield's landside perimeter
         service road is not airside. The east edge is now A_MAXX - 32
         (= 258 + ADX), which still sits 18 m EAST of RWY_X1 (240 + ADX), so
         the runway and its full strip stay inside the keep-out while the road
         (centreline 268, kerbs 261-275) falls outside it. THE RECT NOW STOPS
         AT THE KERB, which is the condition math-gate.mjs's zoneCrossings pin
         was waiting on: it is pinned at 0, not 1.

         THIS ROAD IS THE TERMINAL'S LANDSIDE ACCESS and is deliberately left
         OPEN to ordinary traffic — the kerb IS ordinary traffic. The thing the
         owner saw lapping the terminal was never this record: it was
         airside.js's ROUTES.kerb, a closed waypoint loop whose return leg ran
         down the head-of-stand SERVICE corridor behind the building. That is
         fixed where it lived, in airside.js, and the two service records that
         file publishes carry access:"service" so roadOpen/roadPick refuse an
         ambient car on them regardless of what any keep-out says. */
      const TERM_X = -40 + ADX;                 // terminal centreline (APRON_X, which is scoped to the paint pass)
      city.roads.push({
        x: PERIM_X, z: (A_MINZ + KERB_Z) / 2, vertical: true, len: KERB_Z - A_MINZ,
        district: "airport", w: 14, lanesPerDir: 1, laneW: 3.4,
      });
      city.roads.push({
        x: (TERM_X + PERIM_X) / 2, z: KERB_Z, vertical: false,
        len: Math.abs(PERIM_X - TERM_X), district: "airport",
        w: 14, lanesPerDir: 1, laneW: 3.4,
      });
      /* THE APPROACH LINK — the leg that was missing. Without it the causeway
         and the perimeter spur are two roads that never touch, and the whole
         "drive to the terminal" story dead-ends the moment you come off the
         bridge. It runs the landside access corridor the keep-out now leaves
         along the south edge (see NO_SPAWN's LANDSIDE_S), from the causeway's
         own centreline east to the foot of the perimeter, so the four records
         finally form ONE route: causeway → link → perimeter → kerb. */
      if (CBZ.CONFIG.AIRPORT_ENTRY_V2 !== false) {
        // it starts WEST of the causeway centreline so the crossing is a real
        // overlap (a junction is derived, never authored) and ends ON the
        // perimeter's south end, so all four records form one continuous route.
        const LX0 = CW_X - 22, LX1 = PERIM_X + 10;
        city.roads.push({
          x: (LX0 + LX1) / 2, z: LINK_Z, vertical: false,
          len: LX1 - LX0, district: "airport",
          w: 14, lanesPerDir: 1, laneW: 3.4,
        });
      }
    }

    // ---- MAKE THE PARKED FLEET STEALABLE (deferred — militaryvehicles.js loads
    // after this island). Run once after worldgen; feature-detected so a missing
    // module just leaves the jets as solid scenery.
    if (CBZ.onUpdate) {
      CBZ.onUpdate(55.1, function () {
        if (_reg) return;
        if (!CBZ.cityRegisterMilitaryVehicle) return;
        placed.forEach(function (p) { CBZ.cityRegisterMilitaryVehicle(p); });
        _reg = true;
      });
    }
  }, 21);
})();
