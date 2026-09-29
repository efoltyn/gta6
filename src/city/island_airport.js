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
      // DOCKED AT A JET BRIDGE (city/airport_kit.js stamps the cab's deck on
      // the hull while it is docked): you step off into the bridge, level with
      // the sill, not down onto the apron.
      const dock = rec.group.userData.bridgeDock;
      if (dock && hullY < 0.6) {
        P.pos.set(dock.x, dock.y + 0.05, dock.z);
        P.vy = 0; P.grounded = true;
        if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(P.pos);
        cabinForceClear(true);
        return;
      }
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
      label: "Board",
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
          id: "airliner_exit", slot: "e", label: "Get off",
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
            return (d && d.open) ? "Close" : "Open";
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
            return (d && d.open) ? "Close" : "Open";
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
        { id: "airliner_sit", slot: "e", label: "Sit",
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
  const C_CONC   = 0x9aa0a6;   // concrete kerb / terminal slab
  const C_METAL  = 0xb9c0c8;   // fuselage aluminium
  const C_FENCE  = 0x8a9099;   // chain-link tone

  CBZ.addLandmass(function (city) {
    const root = city.root;
    armRng();
    // a city rebuild re-runs this builder → fresh plane groups. Clear the capture
    // + one-shot guard so the rebuilt fleet re-registers as boardable, and
    // drop any stale cabin-boarding state (platform/collider refs die with
    // the old groups).
    placed.length = 0; _reg = false; deplaneReset(); cabinReset(); resetPassengerCabins();
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

    /* =====================================================================
       HALLORAN FIELD, DRAWN BY THE ONE AIRFIELD BUILDER (city/airport_kit.js).

       Redraw 2026-09-29 (owner: "Make them more real ... just redraw it all,
       like you did with cars"). This island used to draw its own ground,
       paint, lights, terminal (a 3.2 m generic retail shell with a barrel
       roof floated over it), roof, bridges and fence in ~900 lines of world
       coordinates, and Cape Harbor carried a second, smaller copy of the
       same ideas. Both fields are now one call to CBZ.buildAirfield with a
       spec. What stays below is what only Halloran has: the aircraft and
       cabin systems, the climbable tower, the forecourt and taxi rank, the
       causeway, the island's roads.

       THE FIELD IS CODE E, because the aeroplane is: the A320-class hull at
       AIRLINER_SCALE 1.45 spans 52 m. So the runway is 45 m wide (it was 30,
       narrower than the wings over it), the taxiway 23 m, the stands 60 m
       apart (52 m span + 7.5 m clearance; they were 55), and they are NOSE-IN
       contact stands with jet bridges docked to the L1 door (they were parked
       nose-out, tail to the terminal, which no gate on earth does). To fit
       that on the island the runway moved 113 m south (z -90 -> -203): the
       taxiway is 95 m off its centreline, and a parked tail clears a taxiing
       wingtip by 7.5 m. The terminal keeps its landside face, width and
       kerb, and grows 20 m deeper toward the apron to hold a real gate floor.
       ===================================================================== */
    const ADX = _WOFF.dx, ADZ = _WOFF.dz;
    const RWY_X0 = -850 + ADX, RWY_X1 = 240 + ADX, RWY_LEN = RWY_X1 - RWY_X0;
    const RWY_CX = (RWY_X0 + RWY_X1) / 2;
    const RWY_Z = -203 + ADZ, RWY_W = 45;
    const TAX_Z = RWY_Z + 95;
    const TERM_X0 = -115 + ADX, TERM_X1 = 35 + ADX;
    const TERM_Z0 = -9 + ADZ, TERM_FRONT = 37 + ADZ;          // airside glass / landside doors
    const TERM_W = TERM_X1 - TERM_X0, TERM_D = TERM_FRONT - TERM_Z0, TERM_Z = (TERM_Z0 + TERM_FRONT) / 2;
    const APRON_X = -40 + ADX, APRON_Z = -60 + ADZ;
    const FRONT_Z = A_MAXZ;                        // the island's north edge
    const KERB_Z = 38.5 + ADZ;                     // the drop-off lane (the road record's own z)
    const PERIM_X = A_MAXX - 22;                   // the east perimeter spur
    // landside forecourt, east of the terminal
    const PLZ_X0 = TERM_X1 + 6, PLZ_X1 = TERM_X1 + 96;
    const PLZ_Z0 = 14 + ADZ, PLZ_Z1 = FRONT_Z;
    const GATE_PZ = KERB_Z - 5.5, PED_Z = GATE_PZ - 4.5, TURN_X = TERM_X1 - 4;
    const RANK_Z = KERB_Z - 15, RANK_N = 6, RANK_GAP = 6.4;
    const PARTS = CBZ.airfieldParts || null;
    const LX = function (x) { return x - RWY_CX; }, LZ = function (z) { return z - RWY_Z; };
    // three contact stands, 60 m apart, under the terminal; two remote stands
    // on the east ramp (the airline needs free stands to arrive at)
    const CONTACT_XS = [-100 + ADX, -40 + ADX, 20 + ADX];
    const REMOTE_XS = [110 + ADX, 175 + ADX];


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
      /* THE STAIR, SOLVED ONCE (see THE CLIMB below for why these numbers).
         Solved up here because the cab floor needs a WELL where the top of the
         flight comes up through it: the whole helix runs under the 8.5 m cab
         floor, and that floor was one platform + one slab straight across it.
         From the cab you could never go down (groundAt keeps the highest
         surface in step reach, so you walked on the floor over the stair and
         the only way off was the 34 m edge), and on the way up the climber's
         head went through the slab for the last five treads. */
      const RISE = 0.42, WR = base / 2 + 0.85, PER_LEG = 8, CAB_Y = H + 0.05;
      const stairs = [];
      for (let s = 0; s < Math.ceil(H / RISE); s++) {
        const y = (s + 1) * RISE;
        if (y > H + 1.2) break;
        const leg = (s / PER_LEG | 0) % 4;
        const off = ((s % PER_LEG) / PER_LEG - 0.5) * 2 * WR;
        let sx = cxp, sz = czp;
        if (leg === 0) { sx = cxp + off; sz = czp - WR; }
        else if (leg === 1) { sx = cxp + WR; sz = czp + off; }
        else if (leg === 2) { sx = cxp - off; sz = czp + WR; }
        else { sx = cxp - WR; sz = czp - off; }
        stairs.push([sx, y, sz]);
      }
      // the well: every tread a head would put into the cab slab (a body is
      // 1.7 m; the slab's underside is 0.45 under the floor), minus the last
      // tread, which IS at floor height
      let well = null;
      for (const st of stairs) {
        if (!(st[1] > CAB_Y - 2.3 && st[1] < CAB_Y - 0.2)) continue;
        if (!well) well = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
        well.x0 = Math.min(well.x0, st[0] - 0.7); well.x1 = Math.max(well.x1, st[0] + 0.7);
        well.z0 = Math.min(well.z0, st[2] - 0.7); well.z1 = Math.max(well.z1, st[2] + 0.7);
      }
      /* THE BUILDING (de-slop 2026-09-27): it was a grey box shaft, a
         see-through box for a cab, a slab for a roof and a glowing red stick
         for a beacon, with "TWR" on a board hung in the air in front of the
         glass. It is now airport_kit.js's tower: an octagonal concrete shaft
         with its pour-lift reveals, a sill, raked glazing with mullions, a
         deep roof with plant, radome, antenna mast and a red obstruction
         light that is lit at night. Its shaft apothem (2.2) sits inside the
         4.5 m collider and inside the stair's 2.4 m inner edge; its cab is
         the same 8.5 m square the cab-floor platform already is. */
      if (PARTS) {
        PARTS.tower(root, cxp, czp, { H: H, apothem: 2.2, cabHalf: (base + 4) / 2, cabH: 3.2, plinth: false,
          floorHole: (V2 && well) ? { x0: well.x0 - cxp, x1: well.x1 - cxp, z0: well.z0 - czp, z1: well.z1 - czp } : null }, root);
      } else {
        box(cxp, H / 2, czp, base, H, base, 0xb6bdc4, { cast: true });
      }
      if (!V2) {
        solid(cxp, czp, base, base, 0, H + 6);
      } else {
        /* THE DOORWAY. One collider became three: the shaft is solid above the
           head height of the opening, and the ground band is split into the two
           jambs either side of it. The door faces +z (the apron/terminal side,
           which is where anybody walking here comes from). */
        const DW = 1.6, DH = 2.5;                       // clear opening
        const jamb = (base - DW) / 2;
        // everything above the head — up to the cab floor, not through it:
        // the shaft ran on to H+6, a 4.5 m solid pillar in the middle of the
        // cab, with the console and the controller's post inside it
        solid(cxp, czp, base, base, DH, H - 0.45);
        // the cab: raked glass on four sides (it had no walls at all — the
        // glass was a picture, and the floor ended at a 34 m drop) and a roof
        const CHF = (base + 4) / 2;
        for (const sg of [-1, 1]) {
          solid(cxp, czp + sg * (CHF - 0.06), CHF * 2, 0.14, H, H + 3.2);
          solid(cxp + sg * (CHF - 0.06), czp, 0.14, CHF * 2, H, H + 3.2);
        }
        solid(cxp, czp, CHF * 2 + 1.4, CHF * 2 + 1.4, H + 3.2, H + 3.8);
        solid(cxp - (DW + jamb) / 2, czp, jamb, base, 0, DH);   // west jamb
        solid(cxp + (DW + jamb) / 2, czp, jamb, base, 0, DH);   // east jamb
        solid(cxp, czp - base / 2 + 0.15, DW, 0.3, 0, DH);      // …and the back wall behind it
        // the door leaf itself, standing open against the jamb — an opening you
        // can SEE is what stops this reading as a hole in a wall.
        const leaf = box(cxp + DW / 2 + 0.12, DH / 2, czp + base / 2 + 0.22, 0.09, DH, DW * 0.92,
          0x3e4a56, { cast: true });
        leaf.rotation.y = 0.5;
        // the door frame and a small steel canopy over it (the old head was
        // a glowing box standing in for a sign nobody wrote)
        box(cxp, DH + 0.06, czp + base / 2 - 0.05, DW + 0.24, 0.12, 0.2, 0x2f3a46, { cast: true });
        for (const sg of [-1, 1]) box(cxp + sg * (DW / 2 + 0.06), DH / 2, czp + base / 2 - 0.05, 0.12, DH, 0.2, 0x2f3a46, { cast: false });
        box(cxp, DH + 0.45, czp + base / 2 + 0.55, DW + 1.0, 0.08, 1.1, 0x5b636b, { cast: true });
        // the opening itself: the dark of the stair core behind the door
        box(cxp, DH / 2, czp + 2.21, DW, DH, 0.04, 0x0e1012, { cast: false });
      }
      // cab (wider glass box) + roof + dish — OWNER RULE (bda61ab): no gray
      // panes; the cab is the same clear tinted glass as every city facade.
      // mat() is fresh-per-call so mutating is safe; transparent keeps it out
      // of batch.js's opaque merge. cast:false — clear glass throws no shadow.
      if (!PARTS) {
        const cab = box(cxp, H + 1.6, czp, base + 4, 3.2, base + 4, 0xbfe9f7, { cast: false, emissive: 0x3f8aa6, ei: 0.5 });
        cab.material.transparent = true; cab.material.opacity = 0.6;
        box(cxp, H + 3.6, czp, base + 4.6, 0.6, base + 4.6, 0x3a4046, { cast: true }); // cab roof
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
      // (the stair itself is solved at the top of controlTower: RISE, WR,
      // PER_LEG, `stairs`, and the cab-floor `well`)
      if (CBZ.platforms) for (const st of stairs) {
        const pr = { minX: st[0] - 0.7, maxX: st[0] + 0.7, minZ: st[2] - 0.7, maxZ: st[2] + 0.7, top: st[1] };
        CBZ.platforms.push(pr); towerPlats.push(pr);
      }
      // the planner's view of it: ground -> each corner -> the cab
      if (CBZ.stairs && stairs.length > 1) {
        if (CBZ.stairs.removeOwner) CBZ.stairs.removeOwner("airport-tower");
        const a0 = stairs[0], a1 = stairs[1];
        const path = [{ x: a0[0] - (a1[0] - a0[0]) * 1.2, y: 0, z: a0[2] - (a1[2] - a0[2]) * 1.2 }];
        for (let i = 0; i < stairs.length; i++) {
          const st = stairs[i];
          if (i === 0 || i === stairs.length - 1 || (i % PER_LEG) === PER_LEG - 1 || (i % PER_LEG) === 0) {
            path.push({ x: st[0], y: st[1], z: st[2] });
          }
        }
        const zl = stairs[stairs.length - 1];
        path.push({ x: zl[0] - (zl[0] - cxp) * 0.35, y: CAB_Y, z: zl[2] - (zl[2] - czp) * 0.35 });
        CBZ.stairs.link({ path: path, width: 1.3, kind: "stair", owner: "airport-tower" });
      }
      /* THE STAIR AS STEEL. It was 81 loose 1.4 m plates floating round
         the shaft. A real external tower stair is grating treads carried on
         an outer stringer, a handrail on posts, and brackets back to the
         wall. Each tread is drawn at its real going (0.72 m, the step
         spacing) over the unchanged 1.4 m platform records. */
      if (stairs.length && PARTS) {
        const treads = [], steel = [];
        const legOf = function (s) { return (s / PER_LEG | 0) % 4; };
        // outward unit vector for each leg (away from the shaft)
        const OUT = [[0, -1], [1, 0], [0, 1], [-1, 0]];
        const ALONG = [[1, 0], [0, 1], [-1, 0], [0, -1]];
        for (let i = 0; i < stairs.length; i++) {
          const L = legOf(i), a = ALONG[L], o = OUT[L];
          const w = a[0] ? 0.72 : 1.3, d = a[0] ? 1.3 : 0.72;
          treads.push(PARTS.put(new THREE.BoxGeometry(w, 0.05, d), stairs[i][0], stairs[i][1] - 0.03, stairs[i][2]));
          // wall bracket under the inner edge
          steel.push(PARTS.put(new THREE.BoxGeometry(a[0] ? 0.06 : 0.5, 0.25, a[0] ? 0.5 : 0.06),
            stairs[i][0] - o[0] * 0.4, stairs[i][1] - 0.2, stairs[i][2] - o[1] * 0.4));
          // handrail post every other tread, outer edge
          if (i % 2 === 0) {
            steel.push(PARTS.put(new THREE.BoxGeometry(0.05, 1.0, 0.05), stairs[i][0] + o[0] * 0.66, stairs[i][1] + 0.5, stairs[i][2] + o[1] * 0.66));
          }
        }
        // stringer + handrail per run of consecutive treads on the same leg
        for (let i = 0; i < stairs.length - 1; i++) {
          if (legOf(i) !== legOf(i + 1)) continue;
          const o = OUT[legOf(i)], A = stairs[i], B = stairs[i + 1];
          steel.push(PARTS.member(A[0] + o[0] * 0.68, A[1] - 0.12, A[2] + o[1] * 0.68, B[0] + o[0] * 0.68, B[1] - 0.12, B[2] + o[1] * 0.68, 0.06, 0.28));
          steel.push(PARTS.member(A[0] + o[0] * 0.66, A[1] + 1.0, A[2] + o[1] * 0.66, B[0] + o[0] * 0.66, B[1] + 1.0, B[2] + o[1] * 0.66, 0.05));
        }
        PARTS.addMerged(root, treads, cmat(0x4d535a), { cast: true });
        PARTS.addMerged(root, steel, cmat(0x9aa1a8), { cast: true });
      }
      // the cab FLOOR — the top landing, and the deck the controller's chair
      // and console stand on.
      if (CBZ.platforms) {
        // the cab floor, around its stair well
        const X0 = cxp - (base + 4) / 2, X1 = cxp + (base + 4) / 2, Z0 = czp - (base + 4) / 2, Z1 = czp + (base + 4) / 2;
        const rects = [];
        if (!well) rects.push([X0, X1, Z0, Z1]);
        else {
          const hx0 = Math.max(X0, well.x0), hx1 = Math.min(X1, well.x1), hz0 = Math.max(Z0, well.z0), hz1 = Math.min(Z1, well.z1);
          rects.push([X0, X1, Z0, hz0], [X0, X1, hz1, Z1], [X0, hx0, hz0, hz1], [hx1, X1, hz0, hz1]);
        }
        for (const r of rects) {
          if (r[1] - r[0] < 0.02 || r[3] - r[2] < 0.02) continue;
          const cf = { minX: r[0], maxX: r[1], minZ: r[2], maxZ: r[3], top: CAB_Y };
          CBZ.platforms.push(cf); towerPlats.push(cf);
        }
      }
      if (!PARTS) box(cxp, CAB_Y - 0.06, czp, base + 4, 0.12, base + 4, 0x4a5158, { cast: false });

      // ---- THE CONSOLE. A desk arc facing the runway (-z, down the field),
      //      with a lit screen bank — what an air traffic controller sits at.
      const DESK_Z = czp - 1.9;
      // A console at CONSOLE height: a 0.76 m worktop on a 0.74 m pedestal,
      // and a row of low tilted monitors under the sightline (a controller
      // looks OUT). It was a 0.42 m knee-high slab with a 3.6 m glowing
      // panel standing across the window in front of him.
      if (PARTS) {
        const cDark = [], cTop = [], cLit = [];
        cDark.push(PARTS.put(new THREE.BoxGeometry(4.4, 0.72, 0.7), cxp, CAB_Y + 0.36, DESK_Z));
        cTop.push(PARTS.put(new THREE.BoxGeometry(4.6, 0.05, 0.9), cxp, CAB_Y + 0.765, DESK_Z + 0.05));
        for (let i = 0; i < 4; i++) {
          const mx = cxp - 1.65 + i * 1.1;
          cDark.push(PARTS.put(new THREE.BoxGeometry(0.06, 0.14, 0.06), mx, CAB_Y + 0.86, DESK_Z - 0.2));
          const scr = new THREE.BoxGeometry(0.62, 0.38, 0.04); scr.rotateX(-0.25); scr.translate(mx, CAB_Y + 1.1, DESK_Z - 0.22);
          cDark.push(scr);
          const px = new THREE.BoxGeometry(0.56, 0.32, 0.01); px.rotateX(-0.25); px.translate(mx, CAB_Y + 1.1, DESK_Z - 0.195);
          cLit.push(px);
        }
        PARTS.addMerged(root, cDark, cmat(0x2f353c), {});
        PARTS.addMerged(root, cTop, cmat(0x1f2327), {});
        PARTS.addMerged(root, cLit, mat(0x1d5f74, { emissive: 0x3fc6e6, ei: 0.6 }), {});
      }
      // cab ceiling light — one emissive strip under the roof, no light
      // object, lit at night and dim by day.
      const fl = box(cxp, H + 3.1, czp, base + 3.0, 0.06, 0.3,
        0xfff0cf, { emissive: 0xffe6b0, ei: 0.2, cast: false });
      if (PARTS) PARTS.glow(fl.material, 0.2, 0.9, root);

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

    /* THE AIRFRAMES, PUBLISHED: the kit and systems/airline.js build and fly
       the ONE airliner this file defines (hull, cabin, seats, pilots, doors,
       damage, the hand-off to the player's flight physics). `boardable` is
       what makes a group a member of `placed`, and `placed` is what the gun
       path, the blast path, the boarding arc and the flight hand-off read. */
    CBZ.airportKit = {
      airliner: buildAirliner,        // (x, z, heading, livery) -> group
      jet: buildPrivateJet,           // (x, z, heading, livery) -> group
      boardable: boardablePlane,      // (group, x, z, heading, footW, footL, name)
      dims: AIRCRAFT_DIMS,
      scale: AL_SC,
      records: function () { return placed; },
    };

    const AP = CBZ.buildAirfield ? CBZ.buildAirfield(city, {
      id: "halloran", name: "Halloran Field", code: "HLR", city: "Los Vantos", hub: true,
      builtBy: "island_airport", subtitle: "International Airport", biome: "airport",
      x: RWY_CX, z: RWY_Z, yaw: 0,
      bounds: { minX: A_MINX, maxX: A_MAXX, minZ: A_MINZ, maxZ: A_MAXZ },
      runway: { len: RWY_LEN, w: RWY_W },
      blast: 45,
      taxiZ: TAX_Z - RWY_Z, taxiX0: -525, taxiX1: 525,
      conns: [-500, -160, 170, 500],
      terminal: {
        x0: LX(TERM_X0), x1: LX(TERM_X1), z0: LZ(TERM_Z0), z1: LZ(TERM_FRONT),
        levels: 2, mezzY: 4.5, islands: 4, canopy: 7, name: "Halloran Field",
        entrances: [LX(-95 + ADX), LX(-40 + ADX), LX(15 + ADX)],
      },
      kerbZ: LZ(KERB_Z),
      stands: CONTACT_XS.map(function (x, i) { return { id: "HLR-" + (i + 1), num: String(i + 1), lx: LX(x), bridge: true }; })
        .concat(REMOTE_XS.map(function (x, i) { return { id: "HLR-R" + (i + 1), num: "R" + (i + 1), lx: LX(x) }; })),
      parked: ["HLR-1", "HLR-2", "HLR-3"],
      jets: [{ lx: LX(215 + ADX), lz: LZ(-53 + ADZ), heading: -Math.PI / 2 + 0.2 }, { lx: LX(240 + ADX), lz: LZ(-38 + ADZ), heading: -Math.PI / 2 - 0.3 }],
      aprons: [{ x0: LX(-175 + ADX), z0: TAX_Z - RWY_Z + 11.5, x1: LX(255 + ADX), z1: LZ(TERM_Z0) }],
      paved: [
        { x0: 75, z0: 106.5, x1: 125, z1: 140, color: 0x3c3f44 },       // fire station apron
        { x0: -45, z0: 106.5, x1: 55, z1: 126, color: 0x8f8d87 },       // maintenance hangar apron
        { x0: -155, z0: 106.5, x1: -55, z1: 148, color: 0x3c3f44 },     // GA hangars
        { x0: -255, z0: 106.5, x1: -175, z1: 145, color: 0x8f8d87 },    // cargo apron
        { x0: -575, z0: 193, x1: 130, z1: 199, color: 0x3c3f44 },       // airside service road
        { x0: -278, z0: 150, x1: -266, z1: 199, color: 0x3c3f44 },      // fuel fill stand access
      ],
      tower: { external: true },           // the climbable tower is built below
      noSpawn: [
        { minX: A_MINX, maxX: A_MAXX - 32, minZ: A_MINZ + 26, maxZ: TERM_Z0 + 6, label: "airport-airside" },
        { minX: TERM_X0 - 1, maxX: TERM_X1 + 1, minZ: TERM_Z0 - 1, maxZ: TERM_FRONT + 1, label: "airport-terminal" },
      ],
      paint: function (P0, Lh) {
        // landside, in the field's local metres
        const W = 0xeef1f4, Y = 0xd8b53a, WALK = 0xa9a7a0, PLAZA = 0x4a4d52;
        P0.box(LX(TERM_X0 - 12), LZ(TERM_FRONT), LX(PERIM_X + 7), LZ(FRONT_Z), PLAZA);
        P0.box(LX(PLZ_X0), LZ(PLZ_Z0), LX(PLZ_X1), LZ(PLZ_Z1), PLAZA);
        P0.rect(LX((TURN_X + PLZ_X1 + 6) / 2), LZ(PED_Z), (PLZ_X1 + 6) - TURN_X, 1.8, WALK);
        P0.rect(LX(TURN_X), LZ((PED_Z + TERM_FRONT + 0.42) / 2), 1.8, (TERM_FRONT + 0.42) - PED_Z, WALK);
        for (let k = 0; k < 3; k++) P0.rect(LX(APRON_X), LZ(TERM_FRONT + 0.85 + k * 0.9), 4.0, 0.45, W);
        {
          const rx0 = LX(PLZ_X0 + 8 - 3.2), rx1 = LX(PLZ_X0 + 8 + (RANK_N - 1) * RANK_GAP + 3.2), rz = LZ(RANK_Z);
          P0.line([[rx0, rz - 1.6], [rx1, rz - 1.6], [rx1, rz + 1.6], [rx0, rz + 1.6], [rx0, rz - 1.6]], 0.2, Y);
          P0.text("TAXI", rx0 - 2.4, rz, 1.6, Math.PI / 2, Y, 3.0);
        }
        P0.line([[LX(PLZ_X0), LZ(KERB_Z - 1.8)], [LX(PLZ_X1), LZ(KERB_Z - 1.8)]], 0.15, W);
        // the tower pad and its footpath to the terminal's west end
        P0.rect(LX(-180 + ADX), LZ(30 + ADZ), 14, 14, 0x8f8d87);
        P0.box(LX(-173 + ADX), LZ(33.6 + ADZ), LX(TERM_X0), LZ(35.4 + ADZ), WALK);
        // the landside lots west of the tower: rental return and a surface lot
        P0.box(LX(-462 + ADX), LZ(4 + ADZ), LX(-195 + ADX), LZ(34 + ADZ), 0x45484c);
        for (let x = LX(-458 + ADX); x < LX(-368 + ADX); x += 2.6) for (const z of [LZ(9 + ADZ), LZ(27 + ADZ)]) P0.rect(x, z, 0.12, 5, W);
        P0.line([[LX(-462 + ADX), LZ(18 + ADZ)], [LX(-368 + ADX), LZ(18 + ADZ)]], 0.12, W, [3, 3]);
      },
      dressing: {
        hangars: [
          { lx: 5, lz: 158, yaw: Math.PI, w: 90, d: 66, h: 24, type: "portal", open: 0.5 },
          { lx: -80, lz: 166, yaw: Math.PI, w: 44, d: 38, h: 15, type: "arch", open: 0.5 },
          { lx: -130, lz: 166, yaw: Math.PI, w: 44, d: 38, h: 15, type: "arch", open: 0 },
        ],
        sheds: [{ lx: -215, lz: 162, yaw: Math.PI, w: 70, d: 36, h: 10, airside: 4, docks: 6 }],
        fuel: { lx: -330, lz: 160, yaw: 0, tanks: [[-26, -2, 8, 11], [0, -2, 8, 11], [26, -2, 8, 11]], bund: { x0: -38, z0: -14, x1: 38, z1: 12 } },
        fire: { lx: 100, lz: 151, yaw: Math.PI, bays: 4 },
        carpark: { lx: LX(-266 + ADX), lz: LZ(18 + ADZ), w: 68, d: 28, levels: 3 },
        rental: { lx: LX(-340 + ADX), lz: LZ(18 + ADZ), w: 44, d: 14 },
        asr: { lx: -500, lz: 160, h: 20 },
        radome: { lx: -560, lz: 185, h: 16 },
        ils: { end: 1, locDist: 40, gsOffset: 30, gsSide: 1 },
        approach: [{ end: 1, len: 420, flashers: 5 }, { end: 0, len: 420, flashers: 0 }],
        masts: [[170, 140], [235, 140], [295, 140], [370, 140], [447, 140], [515, 140], [-10, 118], [-200, 125]],
        windsocks: [[-295, 55, 0.9], [295, 55, 0.9]],
        ulds: [[-245, 132, 0, 1], [-242, 128, 0, 1], [-239, 124, 0, 1], [-205, 132, Math.PI / 2, 1], [-201, 132, Math.PI / 2, 0], [-197, 132, Math.PI / 2, 1], [-193, 132, Math.PI / 2, 1]],
      },
    }) : null;
    const gateZ = AP ? AP.gates[0].z : -46 + ADZ;

    /* THE TERMINAL, as the rest of the game knows it: forex.js hangs its
       exchange desk on the shell record, escalators.js runs its bank to the
       gate floor from the anchor, citystaff/interior audits read the group. */
    if (AP && AP.terminal) {
      const tp = AP.terminal.plan, st = tp.stair;
      city.airportTerminal = {
        ox: (TERM_X0 + TERM_X1) / 2, oz: TERM_Z, w: TERM_W, d: TERM_D, h: AP.terminal.eave,
        group: AP.terminal.group, airfield: AP.id,
        gateFloorY: tp.mezzY + 0.06,
        escalator: st ? { x: st.x + RWY_CX + 7, z: tp.zm + RWY_Z + 4.5, run: 8, riseY: tp.mezzY - 0.1, dirZ: -1, width: 1.9 } : null,
      };
    }

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

      // A SLIPWAY at each seaward gap: a concrete ramp from the island's edge
      // down under the water, with a kerb each side. (It was a flat beige
      // sheet floating 3 cm over the sea, 10 m out from the shore.)
      function slipway(x, z, dx, dz) {
        if (!PARTS) return;
        const LEN = 11, W = PG * 2 + 2, DROP = 1.6;
        const ang = Math.atan2(DROP, LEN), L = Math.hypot(LEN, DROP);
        const yaw = Math.atan2(dx, dz);                 // local +z -> seaward
        const ramp = [], kerb = [];
        const g = PARTS.boxM(W, 0.3, L, 1);
        g.rotateX(ang); g.translate(0, 0.06 - DROP / 2 - 0.15, LEN / 2);
        ramp.push(g);
        for (const sg of [-1, 1]) {
          const k = PARTS.boxM(0.35, 0.45, L, 1);
          k.rotateX(ang); k.translate(sg * (W / 2 + 0.17), 0.06 - DROP / 2 + 0.1, LEN / 2);
          kerb.push(k);
        }
        const grp = new THREE.Group();
        grp.position.set(x, 0, z); grp.rotation.y = yaw;
        PARTS.addMerged(grp, ramp, PARTS.concreteMat(0xa9a59b), {});
        PARTS.addMerged(grp, kerb, PARTS.concreteMat(0x8f8b83), { cast: true });
        root.add(grp);
      }
      slipway(midX, A_MAXZ, 0, 1);                    // north slipway
      slipway(A_MINX, midZ, -1, 0);                   // west slipway
      slipway(A_MAXX, midZ, 1, 0);                    // east slipway

      // THE FENCE (de-slop 2026-09-27): galvanised round posts every 3 m
      // with 45 degree barbed-wire outriggers leaning out to sea, a top rail,
      // three barbed strands and a real see-through chain-link fabric
      // (airport_kit.js). It was square posts every 8 m and panels of the
      // towers' window GLASS. Same runs, same gaps, still no collider.
      const runs = [];
      runs.push([A_MINX, A_MAXZ, midX - PG, A_MAXZ]);
      if (CBZ.CONFIG.AIRPORT_ENTRY_V2 !== false) runs.push([midX + PG, A_MAXZ, OPEN_X0, A_MAXZ]);
      else runs.push([midX + PG, A_MAXZ, A_MAXX, A_MAXZ]);
      runs.push([A_MINX, A_MINZ, A_MINX, midZ - PG], [A_MINX, midZ + PG, A_MINX, A_MAXZ]);
      runs.push([A_MAXX, A_MINZ, A_MAXX, midZ - PG], [A_MAXX, midZ + PG, A_MAXX, A_MAXZ]);
      runs.push([A_MINX, A_MINZ, gapX0, A_MINZ], [gapX1, A_MINZ, A_MAXX, A_MINZ]);
      /* THE AIRSIDE FENCE (redraw 2026-09-29). The island's edge fences above
         only keep cars out of the sea; the movement area had no security
         line at all — the landside access corridor along the south edge ran
         straight onto the runway strip. Airside is now fenced: along the
         north side of the access corridor, up the west shore, across to the
         terminal's west gable along the landside/airside line, and from its
         east gable round the east ramp, inside the perimeter road. The
         terminal building itself closes the line between its two gables. */
      const AIR_S = A_MINZ + 27, AIR_N = TERM_Z0 + 7, AIR_E = PERIM_X - 10;
      const secure = [
        [A_MINX + 3, AIR_S, AIR_E, AIR_S],
        [A_MINX + 3, AIR_S, A_MINX + 3, AIR_N],
        [A_MINX + 3, AIR_N, TERM_X0 - 0.3, AIR_N],
        [TERM_X1 + 0.3, AIR_N, AIR_E, AIR_N],
        [AIR_E, AIR_S, AIR_E, AIR_N],
      ];
      if (PARTS) {
        PARTS.fence(root, runs, { height: H, center: { x: midX, z: midZ } });
        PARTS.fence(root, secure, { height: 2.9, center: { x: (A_MINX + AIR_E) / 2, z: (AIR_S + AIR_N) / 2 } });
      } else {
        const postGeo = new THREE.BoxGeometry(0.18, H, 0.18);
        const pts = [];
        for (const r of runs) {
          const L = Math.hypot(r[2] - r[0], r[3] - r[1]), n = Math.max(1, Math.round(L / 8));
          for (let i = 0; i <= n; i++) pts.push([r[0] + (r[2] - r[0]) * i / n, r[1] + (r[3] - r[1]) * i / n]);
        }
        const inst = new THREE.InstancedMesh(postGeo, mat(C_FENCE), pts.length);
        const dm = new THREE.Object3D();
        for (let i = 0; i < pts.length; i++) { dm.position.set(pts[i][0], H / 2, pts[i][1]); dm.updateMatrix(); inst.setMatrixAt(i, dm.matrix); }
        inst.instanceMatrix.needsUpdate = true; root.add(inst);
      }
      // …and the SEA WALL that takes over the opened span's real job. One
      // merged run, y-gated 0..0.55 so it stops a car and a walking body
      // without ever reading as a barrier in front of a door.
      if (CBZ.CONFIG.AIRPORT_ENTRY_V2 !== false) {
        const BH = 0.55, seg = 30;
        const wallG = [], copeG = [];
        for (let x = OPEN_X0; x < OPEN_X1; x += seg) {
          const w = Math.min(seg, OPEN_X1 - x);
          if (PARTS) {
            // precast units with a 10 mm joint every 2.5 m, under a coping
            for (let u = 0; u < w - 0.01; u += 2.5) {
              const uw = Math.min(2.5, w - u) - 0.01;
              wallG.push(PARTS.put(PARTS.boxM(uw, BH - 0.08, 0.28, 1), x + u + uw / 2 + 0.005, (BH - 0.08) / 2, A_MAXZ));
            }
            copeG.push(PARTS.put(PARTS.boxM(w, 0.09, 0.4, 1), x + w / 2, BH - 0.045, A_MAXZ));
          } else {
            box(x + w / 2, BH / 2, A_MAXZ, w, BH, 0.30, C_CONC, { cast: false });
          }
          // `roadBarrier` is roadrules.js's own word (colliderExempt) and it is
          // the literally correct one: this run lies ALONGSIDE the kerb lane at
          // the water's edge, which is what a barrier is for. Without the stamp
          // roadBlockAudit would read a 415 m parapet as a wall in a
          // carriageway and the gap law would try to cut the one thing out here
          // that must never be cut.
          solid(x + w / 2, A_MAXZ, w, 0.30, 0, BH).roadBarrier = true;
        }
        if (PARTS) {
          PARTS.addMerged(root, wallG, PARTS.concreteMat(0xb3afa6), {});
          PARTS.addMerged(root, copeG, PARTS.concreteMat(0xc9c5bc), { cast: true });
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
      // The plaza deck, the footway (gate -> turn -> frontage -> doors), the
      // zebra at the doors and the rank bay are PAINT in the airfield surface
      // now (section 1). They used to be separate quads laid at 0.05-0.08 on
      // top of a plane that itself sits at 0.08: coplanar, and they flickered.
      // The drop-off canopy is the terminal roof's landside overhang (5b).

      /* ---- THE ENTRY GATE at the plaza's east mouth. You drive under it and
         you have arrived. IT IS A SINGLE COLUMN, not a pair, and that is
         measured: the lane centre is KERB_Z (38.5) and the island's edge is
         FRONT_Z (40), so there is no room north of the lane for a post a car
         would not clip. The column stands south of the lane and a sign
         gantry cantilevers over it to the sea wall. It was a 6.8 m concrete
         block with a glowing box on top and a sign facing ALONG the lane
         (edge-on to every driver) that carried a middle dot. */
      const G = PARTS ? [] : null, GS = PARTS ? [] : null;
      const armZ0 = GATE_PZ, armZ1 = FRONT_Z - 0.2, ARM_Y = 6.9;
      if (PARTS) {
        GS.push(PARTS.put(new THREE.CylinderGeometry(0.32, 0.36, 7.4, 12), PLZ_X1, 3.7, GATE_PZ));
        GS.push(PARTS.put(new THREE.CylinderGeometry(0.6, 0.6, 0.3, 12), PLZ_X1, 0.15, GATE_PZ));
        // the cantilever: a two-chord truss with diagonals
        for (const dy of [0, 0.7]) G.push(PARTS.member(PLZ_X1, ARM_Y + dy, armZ0, PLZ_X1, ARM_Y + dy, armZ1, 0.14));
        for (let z = armZ0, k = 0; z < armZ1 - 0.5; z += 0.9, k++) {
          G.push(PARTS.member(PLZ_X1, ARM_Y + (k % 2 ? 0.7 : 0), z, PLZ_X1, ARM_Y + (k % 2 ? 0 : 0.7), Math.min(armZ1, z + 0.9), 0.06));
        }
        // the sign panel hung under the arm, square to the arriving traffic
        GS.push(PARTS.put(new THREE.BoxGeometry(0.16, 1.3, 5.2), PLZ_X1, ARM_Y - 0.75, KERB_Z));
        for (const dz of [-2, 2]) G.push(PARTS.member(PLZ_X1, ARM_Y, KERB_Z + dz, PLZ_X1, ARM_Y - 0.1, KERB_Z + dz, 0.05));
        PARTS.addMerged(root, GS, PARTS.steelMat(0x7d858d), { cast: true });
        PARTS.addMerged(root, G, cmat(0x5b636b), { cast: true });
      }
      // `gate` — roadrules.js's colliderExempt word for hardware that stands
      // beside a carriageway ON PURPOSE.
      solid(PLZ_X1, GATE_PZ, 0.8, 0.8, 0, 7.4).gate = true;
      if (CBZ.makeLabelSprite) {
        // both faces of the panel: arriving traffic reads the east face
        for (const sg of [1, -1]) {
          const s = CBZ.makeLabelSprite("DEPARTURES DROP-OFF", { color: "#f4f6f8", board: "#1f4f8a" });
          if (s) {
            s.position.set(PLZ_X1 + sg * 0.1, ARM_Y - 0.75, KERB_Z);
            s.rotation.y = sg * Math.PI / 2;
            s.scale.set(5.0, 1.2, 1);
            root.add(s);
          }
        }
      }
      // the PEDESTRIAN entrance — its own opening well south of the
      // carriageway, marked by two steel bollards 2.4 m apart that the
      // footway threads (two 3.2 m concrete posts holding up nothing).
      const bol = [];
      [PED_Z - 1.2, PED_Z + 1.2].forEach(function (pz) {
        if (PARTS) {
          bol.push(PARTS.put(new THREE.CylinderGeometry(0.1, 0.11, 1.0, 10), PLZ_X1, 0.5, pz));
          bol.push(PARTS.put(new THREE.CylinderGeometry(0.115, 0.115, 0.08, 10), PLZ_X1, 0.82, pz));
        }
        solid(PLZ_X1, pz, 0.3, 0.3, 0, 1.0).gate = true;
      });
      if (PARTS) PARTS.addMerged(root, bol, cmat(0x3b4148), { cast: true });

      // ---- LAMPS along the arrival, through the SHARED solve (CLAUDE.md:
      //      "A LUMINAIRE IS A POLE, AN ARM AND A HEAD ON THE ARM'S TIP").
      //      Degrade-safe: no lampMast, no lamps — never a hand-rolled mast.
      //      The lens is a lamp: dark by day, lit at night (one material).
      const LM = CBZ.lampMast ? CBZ.lampMast({ poleH: 6.2, reach: 1.7, rise: 0.32, poleR: 0.12 }) : null;
      if (LM) {
        const poleM = cmat(0x6f767d), headM = cmat(0x4c535a);
        const bulbM = PARTS ? PARTS.glow(mat(0xfff2d0, { emissive: 0xffe9b8, ei: 0.1 }), 0.1, 1.0, root) : mat(0xfff2d0, { emissive: 0xffe9b8, ei: 0.9 });
        for (let x = PLZ_X0 + 10; x <= PLZ_X1 - 6; x += 26) {
          const g = new THREE.Group();
          g.position.set(x, 0, PLZ_Z0 + 1.6);
          g.rotation.y = 0;                        // local +Z faces the lane (north)
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(LM.poleR, LM.poleR * 1.3, LM.poleH, 8), poleM);
          pole.position.y = LM.poleCY; g.add(pole);
          const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, LM.armLen, 6), poleM);
          arm.rotation.x = LM.armRotX; arm.position.set(0, LM.armCY, LM.armCZ); g.add(arm);
          const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.62), headM);
          head.position.set(0, LM.headY, LM.headZ); g.add(head);
          const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.05, 0.5), bulbM);
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
         position hash, never Math.random. The bay is painted (section 1);
         the TAXI board stands on its own post at the head of the rank (it
         used to hang 2.6 m up on nothing). */
      if (CBZ.makeLabelSprite) {
        const s = CBZ.makeLabelSprite("TAXI", { color: "#1b1d20", board: "#ffd451" });
        if (s) { s.position.set(PLZ_X0 + 4.2, 2.5, RANK_Z); s.scale.set(1.6, 0.8, 1); root.add(s); }
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 2.1, 8), cmat(0x6f767d));
        post.position.set(PLZ_X0 + 4.2, 1.05, RANK_Z - 0.08); post.castShadow = true;
        root.add(post);
        solid(PLZ_X0 + 4.2, RANK_Z - 0.08, 0.15, 0.15, 0, 2.1);
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
      // (stand lanes = the three nose-in contact stands; the check-in and
      // gate agents are posted by the terminal itself, city/airport_kit.js)
      const GATE_LANES = CONTACT_XS;
      for (let i = 0; i < 6; i++) {
        let sx = -135 + ADX + rng() * 175;
        const sz = gateZ + 6 + (rng() - 0.5) * 16;
        for (let gl = 0; gl < GATE_LANES.length; gl++) {
          const d = sx - GATE_LANES[gl];
          if (Math.abs(d) < 6) sx = GATE_LANES[gl] + (d >= 0 ? 6.5 : -6.5);
        }
        airportActor("groundCrew", sx, sz, {
          kind: "worker", archetype: "laborer", job: "ground crew",
          outfit: 0xffc81f, wealth: 0.25, aggr: 0.12 + rng() * 0.06,
        }, "ground-crew", "ground crew");
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
        x: APRON_X, z: gateZ + 10, cap: 6,
        home: { x: APRON_X, z: 24 + ADZ },                  // the terminal concourse
        // BESIDE each hull (never at its origin: "people under planes"), the
        // GA ramp, and the head-of-stand equipment line under the bridges
        spots: [
          { x: CONTACT_XS[0] + 8, z: gateZ + 6 },
          { x: CONTACT_XS[1] + 8, z: gateZ + 6 },
          { x: CONTACT_XS[2] + 8, z: gateZ + 6 },
          { x: 215 + ADX, z: -53 + ADZ },
          { x: APRON_X, z: TERM_Z0 - 6 },
        ],
      });
    }

    // =====================================================================
    //  13) REGIONS, SPAWN, KEEP-OUTS. The field's own region ("Halloran
    //      Field", the island rect) and its airside keep-outs are registered
    //      by the kit from the spec above; the causeway is Halloran's.
    // =====================================================================
    CBZ.registerCityRegion(city, {
      name: "Halloran Causeway", subtitle: "International Airport", kind: "rect",
      minX: CW_MINX, maxX: CW_MAXX, minZ: CW_MINZ, maxZ: CW_MAXZ, pad: 1,
    });
    // Canonical PLAYER spawn: the apron in front of the terminal glass,
    // between two stands (clear of every nose, bridge and drive column),
    // facing the aircraft and the runway.
    city.airportSpawn = { x: -70 + ADX, y: 0, z: TERM_Z0 - 5, yaw: Math.PI, place: "Halloran Field apron" };
    city.spawn = { x: city.airportSpawn.x, z: city.airportSpawn.z };
    city.airportAudit = {
      bounds: { minX: A_MINX, maxX: A_MAXX, minZ: A_MINZ, maxZ: A_MAXZ },
      runway: { minX: RWY_X0, maxX: RWY_X1, minZ: RWY_Z - RWY_W / 2, maxZ: RWY_Z + RWY_W / 2 },
      taxiway: { z: TAX_Z, w: 23 },
      terminal: { minX: TERM_X0, maxX: TERM_X1, minZ: TERM_Z0, maxZ: TERM_FRONT },
      noSpawn: [
        { minX: A_MINX, maxX: A_MAXX - 32, minZ: A_MINZ + 26, maxZ: TERM_Z0 + 6, label: "airport-airside" },
        { minX: TERM_X0 - 1, maxX: TERM_X1 + 1, minZ: TERM_Z0 - 1, maxZ: TERM_FRONT + 1, label: "airport-terminal" },
      ],
      aircraft: AIRCRAFT_DIMS,
      airport: AP ? AP.id : null,
    };
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
