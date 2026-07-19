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

   DRAW-CALL DISCIPLINE (engine is draw-call bound): the runway/taxiway
   edge lights are ONE InstancedMesh; the concourse seat rows are ONE
   InstancedMesh; the perimeter fence posts are ONE InstancedMesh; ground
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
        bounds: { minX: -12.2, maxX: 11.8, minZ: -1.42, maxZ: 1.42 },
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
      // barrel (airliner CY=3.5/FH=3.95; private jet CY=2.1/FH=2.2).
      minY: liner ? 1.45 : 0.9,
      maxY: liner ? 5.55 : 3.25,
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
      const d = Math.hypot(rec.group.position.x - x, cy - y, rec.group.position.z - z);
      // The blast reaches the hull surface, not only the aircraft origin.
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
    // standable cabin deck (oriented-extent AABB, same trick as the
    // collider restore in playeraircraft.js)
    const th = rec.group.rotation.y;
    const ca = Math.abs(Math.cos(th)), sa = Math.abs(Math.sin(th));
    // cabin local half-extents; with the real cockpit door the standable deck
    // runs on through the bulkhead doorway to the cockpit front (local
    // x -12.8..14.6 instead of -12.6..12.2 — the wall clamp below is what
    // actually shapes the rooms, the platform just has to underlie them)
    const cock = !!cab.cockpitLeaf;
    const hx = cock ? 13.7 : 12.4, hz = 1.6;
    const ctr = cabinWorld(rec, cock ? 0.9 : -0.2, 0);
    const ex = ca * hx + sa * hz, ez = sa * hx + ca * hz;
    cabinState.platform = {
      minX: ctr.x - ex, maxX: ctr.x + ex, minZ: ctr.z - ez, maxZ: ctr.z + ez,
      top: rec.group.position.y + cab.floorTop,
    };
    if (CBZ.platforms) CBZ.platforms.push(cabinState.platform);
    // step in at the door row
    const inPt = cabinWorld(rec, 9.4, -0.6);
    P.pos.set(inPt.x, cabinState.platform.top, inPt.z);
    P.vy = 0; P.grounded = true;
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(P.pos);
    cabinState.inside = true; cabinState.rec = rec;
    if (CBZ.sfx) { try { CBZ.sfx("door"); } catch (e) {} }
  }

  function cabinCompleteExit(rec) {
    const P = CBZ.player;
    if (CBZ.propStand && P && P._propSeat) { try { CBZ.propStand(P); } catch (e) {} }
    if (P && rec && rec.group) {
      const out = cabinWorld(rec, rec.group.userData.cabin.doorX, -4.4);
      const gy = CBZ.floorAt ? CBZ.floorAt(out.x, out.z) : 0;
      P.pos.set(out.x, gy, out.z);
      P.vy = 0; P.grounded = true;
      if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(P.pos);
    }
    cabinForceClear(true);
    if (CBZ.sfx) { try { CBZ.sfx("door"); } catch (e) {} }
  }

  function cabinSitNearest() {
    const P = CBZ.player, rec = cabinState.rec;
    if (!P || !rec || !CBZ.propSit) return;
    const cab = rec.group.userData.cabin;
    if (!cab || !cab.seats || !cab.seats.length) return;
    const l = cabinLocal(rec, P.pos.x, P.pos.z);
    let best = null, bd = Infinity;
    for (let i = 0; i < cab.seats.length; i++) {
      const s0 = cab.seats[i];
      if (s0.occupant) continue;
      const d = (s0.x - l.x) * (s0.x - l.x) + (s0.z - l.z) * (s0.z - l.z);
      if (d < bd) { bd = d; best = s0; }
    }
    if (!best) return;
    const w = cabinWorld(rec, best.x, best.z);
    const th = rec.group.rotation.y;
    // seated body faces along (sin f, cos f) — aim it down the nose (+X local)
    try {
      const sat = CBZ.propSit(P, {
        x: w.x, y: rec.group.position.y + cab.floorTop + 0.45, z: w.z,
        face: th + Math.PI / 2, kind: "chair", lot: null, occupant: null,
      });
      if (sat) { best.occupant = P; P._aircraftCabinSeat = best; }
    } catch (e) {}
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
    // the milvehicle layer means the airliner card shows BOTH verbs together:
    //   [E] Hijack the airliner  (fly it — militaryvehicles.js, loud, 4★)
    //   [I] Board the cabin       (this — elevator-style walk-in, harmless)
    // Slot I never collides with the E hijack, so both are always offered when
    // you walk up to a parked airliner. The board reach is the milvehicle
    // candidate's own 5.5m footprint reach (militaryvehicles.js) — NOT the door
    // itself: the solid hull AABB spans the whole wing/fuselage footprint, so
    // on foot you're stopped ~17m out at the wingtip and can never actually
    // touch the forward port door. Pressing I arms the board; the per-frame
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
    CBZ.interactions.registerZone({
      id: "airliner_cabin", kind: "airliner_cabin", prio: 6,
      find: function (px, pz) {
        if (!cabinState.inside || cabinState.pending) return null;
        const P = CBZ.player;
        return P ? { x: px, z: pz } : null;
      },
      options: [
        {
          id: "airliner_exit", slot: "e", label: "Exit the airliner",
          onSelect: function () {
            if (!cabinState.inside) return;
            cabinState.pending = { rec: cabinState.rec, t: 0.5, dir: "out" };
          },
        },
        { id: "airliner_sit", slot: "i", label: "Take a seat", onSelect: cabinSitNearest },
      ],
    });
  }

  // per-frame: door easing, delayed board/exit, and inside upkeep (clamp the
  // player to the aisle box in plane-local space; bail out cleanly if the
  // plane is stolen, the player dies, or the mode changes)
  CBZ.onUpdate(55.2, function (dt) {
    if (!CBZ.game || CBZ.game.mode !== "city") {
      if (cabinState.inside || cabinState.pending) cabinForceClear(true);
      return;
    }
    cabinZones();
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
      if (!cab || !cab.panel) continue;
      let wantOpen = false;
      if (!rec.taken && rec.group.parent) {
        if ((cabinState.inside && cabinState.rec === rec) ||
            (cabinState.pending && cabinState.pending.rec === rec)) wantOpen = true;
        else if (P && !P.dead && !P.driving && !P._aircraft) {
          const d = cabinDoorWorld(rec);
          wantOpen = Math.hypot(P.pos.x - d.x, P.pos.z - d.z) < 3.4;
        }
      }
      const tgt = wantOpen ? 1 : 0;
      if (Math.abs(cab.doorT - tgt) > 0.001) {
        cab.doorT += (tgt - cab.doorT) * Math.min(1, dt * 3.2);
        cab.panel.position.x = cab.doorX - 1.18 * cab.doorT;   // slide aft along the hull
      }
      // cockpit pocket door: eases open as the boarded player nears the
      // bulkhead (~2u out), holds while they stand anywhere on the flight
      // deck, eases shut behind them — the same proximity grammar as the
      // boarding panel. Zero work unless the player is inside THIS cabin.
      if (cab.cockpitLeaf) {
        let wantCock = false;
        if (cabinState.inside && cabinState.rec === rec && P && !P.dead && !P.driving && !P._aircraft) {
          const lp = cabinLocal(rec, P.pos.x, P.pos.z);
          wantCock = lp.x > 10.1 && lp.x < 14.5 && Math.abs(lp.z) < 1.6;
        }
        const tc = wantCock ? 1 : 0;
        if (Math.abs(cab.cockpitT - tc) > 0.001) {
          cab.cockpitT += (tc - cab.cockpitT) * Math.min(1, dt * 5.5);
          cab.cockpitLeaf.position.z = 0.98 * cab.cockpitT;   // pocket into the starboard bulkhead
        }
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
        let lx = Math.max(-12.2, Math.min(cock ? 13.4 : 11.8, l.x));
        let lz;
        if (!cock || lx < 11.9) {
          lz = Math.max(-1.42, Math.min(1.42, l.z));           // cabin aisle box
        } else if (lx > 12.3) {
          lz = Math.max(-1.28, Math.min(1.28, l.z));           // cockpit room (narrower shell)
        } else if (Math.abs(l.z) <= 0.34 && cabU.cockpitT > 0.5) {
          lz = l.z;                                            // clean pass through the open leaf
        } else {
          lx = l.x < 12.1 ? 11.9 : 12.3;                       // solid bulkhead / shut leaf
          lz = Math.max(-1.42, Math.min(1.42, l.z));
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
  const A_MINX = -900, A_MAXX = 290, A_MINZ = -280, A_MAXZ = 40;
  // causeway widened to the 24m highway deck (x∈[-12,12])
  const CW_MINX = -12, CW_MAXX = 12, CW_MINZ = -566, CW_MAXZ = -280;

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
    placed.length = 0; _reg = false; cabinReset(); resetPassengerCabins();

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

    const RWY_Z = -90;            // runway centre line (z)
    const RWY_W = 30;             // width
    const RWY_X0 = -850, RWY_X1 = 240, RWY_LEN = RWY_X1 - RWY_X0;
    const RWY_CX = (RWY_X0 + RWY_X1) / 2;
    const TAX_Z = RWY_Z + 50;     // taxiway centre
    const APRON_Z = 0;            // ramp/apron centre (south, by terminal)

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
      rect(-40, APRON_Z + 6, 260, 80, C_TARMAC);
      for (const cx of [-160, 80]) rect(cx, (TAX_Z + APRON_Z) / 2 - 10, 16, TAX_Z - APRON_Z + 30, C_TARMAC);

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
      for (const cx of [-160, 80]) {
        rect(cx, (TAX_Z + APRON_Z) / 2 - 10, 0.5, TAX_Z - APRON_Z + 24, C_YELLOW);
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
      const tx = -40, tz = 24, tw = 150, td = 26;
      // doorSide 1 = +z (faces causeway/landside). retail glass = clear.
      terminal = CBZ.cityMakeBuilding(root, tx, tz, tw, td, 1, 0x6f8ba0, 1,
        { retail: true, glassKind: "clear", stairs: false });
      if (terminal && terminal.group) {
        const grp = root; // furniture lives in world space for simplicity
        const ix0 = tx - tw / 2 + 4, ix1 = tx + tw / 2 - 4;
        const fz = tz;    // concourse centre z

        // check-in desks along the landside wall (4 desks)
        for (let k = 0; k < 4; k++) {
          const dx = tx - tw / 2 + 20 + k * 30;
          box(dx, 0.55, tz + td / 2 - 3, 8, 1.1, 2.2, 0xc9cfd6, { cast: true });
          box(dx, 1.15, tz + td / 2 - 3, 8, 0.1, 2.4, 0x2b2f34);   // counter top
          solid(dx, tz + td / 2 - 3, 8, 2.4, 0, 1.2);
        }

        // seat rows — ONE InstancedMesh of seat blocks (gate waiting area)
        const seatGeo = new THREE.BoxGeometry(0.6, 0.45, 0.6);
        const seatPos = [];
        for (let r = 0; r < 3; r++) {
          const sz = tz - td / 2 + 5 + r * 4;
          for (let s = 0; s < 24; s++) {
            const sx = ix0 + 2 + s * ((ix1 - ix0 - 4) / 23);
            if (s % 8 === 7) continue; // aisle gaps
            seatPos.push([sx, sz]);
          }
        }
        const seatInst = new THREE.InstancedMesh(seatGeo, mat(0x35506e), seatPos.length);
        seatInst.castShadow = true; seatInst.receiveShadow = true;
        const dm = new THREE.Object3D();
        for (let i = 0; i < seatPos.length; i++) {
          dm.position.set(seatPos[i][0], 0.55, seatPos[i][1]);
          dm.updateMatrix(); seatInst.setMatrixAt(i, dm.matrix);
        }
        seatInst.instanceMatrix.needsUpdate = true; grp.add(seatInst);

        // seat backrests as a second instanced mesh (shared material)
        const backGeo = new THREE.BoxGeometry(0.6, 0.5, 0.12);
        const backInst = new THREE.InstancedMesh(backGeo, mat(0x2a4360), seatPos.length);
        backInst.castShadow = true;
        for (let i = 0; i < seatPos.length; i++) {
          dm.position.set(seatPos[i][0], 0.85, seatPos[i][1] + 0.24);
          dm.updateMatrix(); backInst.setMatrixAt(i, dm.matrix);
        }
        backInst.instanceMatrix.needsUpdate = true; grp.add(backInst);

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
    (function controlTower() {
      const cxp = -180, czp = 30, base = 4.5, H = 34;
      // shaft
      box(cxp, H / 2, czp, base, H, base, 0xb6bdc4, { cast: true });
      solid(cxp, czp, base, base, 0, H + 6);
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
      glass:  vmat("glass", 0x10161c),
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
    //  BackSide liner shell (visible only from inside), a raised deck over
    //  the wing carry-through, 11 rows of two-across benches, modular LIVE-NPC
    //  seat anchors (deterministic via the airport rng stream), interior
    //  window strips, ceiling light strips, an aft pressure wall and a
    //  cockpit bulkhead with door + a two-seat cockpit behind it. The
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
      // liner shell + deck + aisle carpet
      const realDoor = !!CBZ.CONFIG.COCKPIT_REAL_DOOR;
      if (realDoor) {
        // OPEN-ENDED liner: five zero-thickness planes with OUTWARD normals —
        // linerMat is BackSide, so from inside they render exactly like the
        // old box. No +x face: a box face can't take a doorway hole, and it
        // would wall off the cockpit the moment the bulkhead is cut. The -z
        // wall splits around a REAL boarding-door aperture (matching hull
        // carve in buildAirliner) so the open door is an opening, not paint.
        K.put(linerMat, new THREE.PlaneGeometry(3.2, 2.9), -12.8, 3.9, 0, 0, -Math.PI / 2);
        K.put(linerMat, new THREE.PlaneGeometry(24.9, 3.2), -0.35, 2.45, 0, Math.PI / 2, 0);
        K.put(linerMat, new THREE.PlaneGeometry(24.9, 3.2), -0.35, 5.35, 0, -Math.PI / 2, 0);
        K.put(linerMat, new THREE.PlaneGeometry(24.9, 2.9), -0.35, 3.9, 1.6);
        K.put(linerMat, new THREE.PlaneGeometry(22.75, 2.9), -1.425, 3.9, -1.6, 0, Math.PI);
        K.put(linerMat, new THREE.PlaneGeometry(1.05, 2.9), 11.575, 3.9, -1.6, 0, Math.PI);
        K.put(linerMat, new THREE.PlaneGeometry(1.1, 0.95), CABIN_DOOR_X, 4.875, -1.6, 0, Math.PI);
      } else {
        K.put(linerMat, new THREE.BoxGeometry(25.2, 2.9, 3.2), -0.2, 3.9, 0);
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
        cockpitLeaf.position.set(12.1, 3.425, 0);
        cockpitLeaf.userData.dynamic = true;
        g.add(cockpitLeaf);
        // COCKPIT ROOM behind the doorway — its own smaller BackSide shell,
        // open toward the bulkhead so the sight-line runs room-to-room both
        // ways. Sized (y 2.45..4.8, z ±1.5, front wall x 14.45) to stay well
        // inside the tapering nose hull; the exterior windshield glass band
        // pokes through the top front and reads as the windshield from
        // inside. Deck-height floor + a short ceiling light strip.
        K.put(linerMat, new THREE.PlaneGeometry(3.0, 2.35), 14.45, 3.625, 0, 0, Math.PI / 2);
        K.put(linerMat, new THREE.PlaneGeometry(2.35, 3.0), 13.275, 4.8, 0, -Math.PI / 2, 0);
        K.put(linerMat, new THREE.PlaneGeometry(2.35, 2.35), 13.275, 3.625, 1.5);
        K.put(linerMat, new THREE.PlaneGeometry(2.35, 2.35), 13.275, 3.625, -1.5, 0, Math.PI);
        K.put(cabinFloorMat, new THREE.BoxGeometry(2.5, 0.14, 3.0), 13.3, CABIN_FLOOR - 0.07, 0);
        K.put(cabinLightMat, new THREE.BoxGeometry(1.0, 0.05, 0.24), 12.8, 4.77, 0);
      } else {
        // legacy: solid bulkhead with a painted dark cockpit door
        K.put(cabinFloorMat, new THREE.BoxGeometry(0.14, 2.9, 3.1), 12.1, 3.9, 0);
        K.put(FLEET.dark, new THREE.BoxGeometry(0.08, 1.78, 0.8), 12.0, 3.42, 0);
      }
      // interior window strips + ceiling light strips
      for (const sgn of [-1, 1]) {
        K.put(FLEET.dark, new THREE.BoxGeometry(21, 0.5, 0.05), -0.7, 4.15, sgn * 1.55);
        K.put(cabinLightMat, new THREE.BoxGeometry(22, 0.05, 0.28), -0.5, 5.24, sgn * 0.5);
      }
      // cockpit behind the bulkhead: console block + two pilot seats
      K.put(FLEET.dark, new THREE.BoxGeometry(1.0, 0.85, 2.4), 14.2, 3.25, 0);
      for (const sgn of [-1, 1]) {
        K.put(FLEET.navy, new THREE.BoxGeometry(0.55, 0.16, 0.55), 13.1, 2.86, sgn * 0.58);
        K.put(FLEET.navy, new THREE.BoxGeometry(0.16, 0.8, 0.55), 12.75, 3.3, sgn * 0.58);
      }
      // Every physical seat is a reusable anchor. `reservedForNpc` preserves
      // the exact old deterministic occupancy map, but the occupant is now a
      // normal live NPC rather than model geometry. Consume the two old
      // shirt/skin RNG draws when reserved so later airport generation remains
      // byte-for-byte deterministic after removing the baked bodies.
      const seats = [];
      let seatId = 0;
      function addSeat(x, z, chance) {
        const reserved = rng() < chance;
        if (reserved) { rng(); rng(); }
        seats.push({
          id: "seat-" + (seatId++), x: x + 0.03, y: CABIN_FLOOR + 0.45, z,
          heading: Math.PI / 2, kind: "aircraft-seat",
          reservedForNpc: reserved, occupant: null,
        });
      }
      // COCKPIT CREW SEATS — real seat records the shared NPC life system can
      // claim. The captain's chair (port/left, z=-0.58) is reserved so a live
      // pilot is cast there (seat.role "pilot" → npclife's aircraftPilot
      // profile, uniformed via the job-cast wardrobe); the first officer's
      // chair stays free for the player to take. Pushed FIRST so the flight
      // deck fills before the rows. NO rng() here — the airport build stream
      // must keep the exact draw sequence the addSeat rows below consume
      // (determinism law: byte-identical worlds per seed).
      if (realDoor) {
        seats.push({
          id: "seat-captain", x: 13.13, y: CABIN_FLOOR + 0.45, z: -0.58,
          heading: Math.PI / 2, kind: "cockpit-seat", role: "pilot", cockpit: true,
          reservedForNpc: true, occupant: null,
        });
        seats.push({
          id: "seat-firstofficer", x: 13.13, y: CABIN_FLOOR + 0.45, z: 0.58,
          heading: Math.PI / 2, kind: "cockpit-seat", role: "pilot", cockpit: true,
          reservedForNpc: false, occupant: null,
        });
      }
      for (let rx = -11.2; rx <= 8.8; rx += 2.0) {
        for (const s of [-1, 1]) {
          const zc = s * 1.0;
          K.put(FLEET.navy, new THREE.BoxGeometry(0.62, 0.16, 1.1), rx, 2.87, zc);       // cushion
          K.put(FLEET.navy, new THREE.BoxGeometry(0.18, 0.85, 1.1), rx - 0.34, 3.32, zc); // back
          K.put(FLEET.dark, new THREE.BoxGeometry(0.5, 0.32, 0.95), rx, 2.66, zc);        // pedestal
          K.put(FLEET.dark, new THREE.BoxGeometry(0.16, 0.2, 0.32), rx - 0.36, 3.85, zc - 0.28); // headrests
          K.put(FLEET.dark, new THREE.BoxGeometry(0.16, 0.2, 0.32), rx - 0.36, 3.85, zc + 0.28);
          addSeat(rx, s * 1.28, 0.6);   // window
          addSeat(rx, s * 0.72, 0.3);   // aisle
        }
      }
      // DOORWAY (port, forward): with the real hull aperture the old dark
      // recess box would blank the opening, so it exists only in the legacy
      // branch; the warm sill light tucks under the aperture header instead.
      if (realDoor) {
        K.put(cabinLightMat, new THREE.BoxGeometry(1.0, 0.05, 0.05), CABIN_DOOR_X, 4.31, -1.79);
      } else {
        K.put(FLEET.dark, new THREE.BoxGeometry(1.14, 1.92, 0.1), CABIN_DOOR_X, 3.46, -1.64);
        K.put(cabinLightMat, new THREE.BoxGeometry(1.0, 0.06, 0.06), CABIN_DOOR_X, 4.48, -1.68);
      }
      // sliding DOOR PANEL — a separate live mesh the boarding system eases
      // aft along the hull; dynamic-tagged so batcher/freezer leave it alone
      const panel = new THREE.Mesh(new THREE.BoxGeometry(1.06, 1.86, 0.1), FLEET.white);
      panel.position.set(CABIN_DOOR_X, 3.45, -1.73);
      panel.userData.dynamic = true;
      const panelBand = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.3, 0.04), acc);
      panelBand.position.set(0, -0.35, -0.04);
      panel.add(panelBand);
      g.add(panel);
      g.userData.cabin = {
        floorTop: CABIN_FLOOR,
        doorX: CABIN_DOOR_X, doorZ: -1.7,
        seats, panel, doorT: 0,
        cockpitLeaf, cockpitT: 0,
      };
    }

    function buildAirliner(x, z, heading, livery) {
      const g = new THREE.Group();
      g.position.set(x, 0, z); g.rotation.y = heading;
      const acc = accentMat(livery || 0x2d5fb0);
      const K = partKit();
      const DIMS = AIRCRAFT_DIMS.airliner;
      // 27.9m centre barrel + 4.2m nose + 5.6m tail = 37.55m end-to-end.
      const L = 27.9, R = 1.9;
      const FH = DIMS.fuselage, FW = DIMS.fuselage;
      const CY = R + 1.6;         // fuselage centreline height — UNCHANGED (flight/camera anchors)
      const BELLY = CY - FH / 2;  // 1.6 — struts rise to here, wheels touch y=0

      // fuselage: white barrel + sculpted drooped nose + upswept tailcone
      // (pieces butt-join at full cross-section with a 0.05 overlap — seamless)
      if (CBZ.CONFIG.COCKPIT_REAL_DOOR) {
        // HOLLOW barrel — four skin slabs instead of one solid box, so the
        // boarding doorway can be a REAL aperture seen through from both
        // sides. Every inner slab face hides behind the BackSide cabin liner
        // (ceiling 5.35 / floor 2.45 / walls ±1.6) — naively splitting the
        // solid box would paint its cut faces as white walls ACROSS the
        // cabin. The port wall carries the carved door hole (x 9.95..11.05,
        // y 2.5..4.4, matching the liner aperture in buildCabin); the
        // sliding boarding panel pockets into this wall cavity when open.
        const ST = CY + FH / 2, SB = CY - FH / 2;                 // skin top / bottom
        K.put(FLEET.white, new THREE.BoxGeometry(L, ST - 5.37, FW), 0, (ST + 5.37) / 2, 0);       // roof
        K.put(FLEET.white, new THREE.BoxGeometry(L, 2.43 - SB, FW), 0, (2.43 + SB) / 2, 0);       // belly
        K.put(FLEET.white, new THREE.BoxGeometry(L, 2.94, 0.355), 0, 3.9, (FW - 0.355) / 2);      // starboard wall
        K.put(FLEET.white, new THREE.BoxGeometry(23.9, 2.94, 0.355), -2.0, 3.9, -(FW - 0.355) / 2);   // port wall aft of door
        K.put(FLEET.white, new THREE.BoxGeometry(2.9, 2.94, 0.355), 12.5, 3.9, -(FW - 0.355) / 2);    // port wall fwd of door
        K.put(FLEET.white, new THREE.BoxGeometry(1.1, 0.97, 0.355), 10.5, 4.885, -(FW - 0.355) / 2);  // door header
        K.put(FLEET.white, new THREE.BoxGeometry(1.1, 0.07, 0.355), 10.5, 2.465, -(FW - 0.355) / 2);  // door sill
      } else {
        K.put(FLEET.white, new THREE.BoxGeometry(L, FH, FW, 2, 1, 1), 0, CY, 0);
      }
      K.put(FLEET.white, fuseGeo(4.2, FH, FW, { nose: 0.24, noseY: -1.0 }), L / 2 + 2.05, CY, 0);
      K.put(FLEET.white, fuseGeo(5.6, FH, FW, { tail: 0.16, tailY: 1.25 }), -L / 2 - 2.75, CY, 0);
      // dark cockpit glass band wrapping the nose root
      K.put(FLEET.glass, new THREE.BoxGeometry(2.4, 0.95, FW + 0.1), L / 2 + 0.6, CY + 0.8, 0);
      // livery: coloured belly stripe wrapping under the white upper fuselage,
      // and the cabin windows as ONE long inset glass strip per side
      K.put(acc, new THREE.BoxGeometry(L, 0.95, FW + 0.12), 0, BELLY + 0.42, 0);
      if (CBZ.CONFIG.COCKPIT_REAL_DOOR) {
        // port window strip splits around the real doorway aperture
        K.put(FLEET.glass, new THREE.BoxGeometry(L - 6, 0.42, 0.1), 0.5, CY + 0.7, FW / 2 + 0.02);
        K.put(FLEET.glass, new THREE.BoxGeometry(20.4, 0.42, 0.1), -0.25, CY + 0.7, -(FW / 2 + 0.02));
        K.put(FLEET.glass, new THREE.BoxGeometry(0.4, 0.42, 0.1), 11.25, CY + 0.7, -(FW / 2 + 0.02));
      } else {
        for (const sgn of [-1, 1]) {
          K.put(FLEET.glass, new THREE.BoxGeometry(L - 6, 0.42, 0.1), 0.5, CY + 0.7, sgn * (FW / 2 + 0.02));
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
      navBox(g, FLEET.navR, -4.0, 3.1, -DIMS.span / 2);
      navBox(g, FLEET.navG, -4.0, 3.1, DIMS.span / 2);
      navBox(g, FLEET.navW, -19.35, 11.55, 0);
      navBox(g, FLEET.beacon, -2, 5.55, 0, 0.3);

      root.add(g);
      g.userData.aircraftDims = DIMS;
      g.userData.worldCollider = aircraftSolid(g, DIMS);
      return g;
    }

    function buildPrivateJet(x, z, heading, livery) {
      const g = new THREE.Group();
      g.position.set(x, 0, z); g.rotation.y = heading;
      const acc = accentMat(livery || 0x355c8a);
      const K = partKit();
      const L = 11, R = 1.1;      // barrel length / legacy radius (collider height stays R+3)
      const FH = 2.2, FW = 2.0;   // fuselage box cross-section
      const CY = R + 1.0;         // centreline height — UNCHANGED (2.1)
      const BELLY = CY - FH / 2;  // 1.0

      // fuselage: white barrel + LOW drooped nose taper + upswept tailcone
      K.put(FLEET.white, new THREE.BoxGeometry(L, FH, FW, 2, 1, 1), 0, CY, 0);
      K.put(FLEET.white, fuseGeo(3.6, FH, FW, { nose: 0.22, noseY: -0.62 }), L / 2 + 1.75, CY, 0);
      K.put(FLEET.white, fuseGeo(3.8, FH, FW, { tail: 0.18, tailY: 0.8 }), -L / 2 - 1.85, CY, 0);
      // dark cockpit glass band at the nose root
      K.put(FLEET.glass, new THREE.BoxGeometry(1.5, 0.72, FW + 0.08), L / 2 + 0.55, CY + 0.42, 0);
      // exec livery: angled accent swoosh rising to the nose + thin midnight
      // echo line under it; oval-ish cabin windows as ONE inset strip a side
      for (const sgn of [-1, 1]) {
        const fz = sgn * (FW / 2 + 0.02);
        K.put(acc, new THREE.BoxGeometry(7.5, 0.5, 0.06), 0.8, CY - 0.25, fz, 0, 0, 0.09);
        K.put(FLEET.navy, new THREE.BoxGeometry(6.2, 0.16, 0.05), 0.2, CY - 0.62, fz, 0, 0, 0.09);
        K.put(FLEET.glass, new THREE.BoxGeometry(6.4, 0.3, 0.06), 0.9, CY + 0.55, fz);
      }
      // stair-door hint: inset dark panel on the front-left (port) flank
      K.put(FLEET.dark, new THREE.BoxGeometry(0.95, 1.3, 0.07), 3.5, CY - 0.1, -(FW / 2 + 0.03));

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

    // parked airliners at the gates (along the terminal apron edge) — each a
    // STEALABLE aircraft (climb in and fly it off the gate).
    const liveries = [0x2d5fb0, 0xb33636, 0x1f7a4d, 0xc78a1f];
    for (let i = 0; i < 4; i++) {
      const gx = -120 + i * 55;
      const hd = Math.PI / 2 + (rng() - 0.5) * 0.05;
      boardablePlane(buildAirliner(gx, APRON_Z - 14, hd, liveries[i]), gx, APRON_Z - 14, hd, 30, 22, "Airliner");
    }
    // private jets on the far apron — also stealable
    boardablePlane(buildPrivateJet(95, APRON_Z - 6, Math.PI / 2 - 0.2, 0x355c8a), 95, APRON_Z - 6, Math.PI / 2 - 0.2, 14, 12, "Private Jet");
    boardablePlane(buildPrivateJet(118, APRON_Z + 2, Math.PI / 2 + 0.4, 0x6a3a6a), 118, APRON_Z + 2, Math.PI / 2 + 0.4, 14, 12, "Private Jet");

    // =====================================================================
    //  8) ONE AIRLINER MID-PUSHBACK (scripted, purely visual) — a jet on a
    //     connector taxiway being eased back by a tug. It creeps along a
    //     short path then resets, so the field reads ALIVE without any
    //     physics or collision churn. CBZ.onUpdate, alloc-free.
    // =====================================================================
    (function pushback() {
      const jet = buildAirliner(-160, TAX_Z - 6, Math.PI / 2, 0x444b55);
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
      // a baggage tug shoved up against the nose
      const tug = box(-160 + 16, 0.8, TAX_Z - 6, 3, 1.4, 2, 0xe8c020, { cast: true });
      // the tug ANIMATES (position.z below): tag it so the static batcher /
      // matrix freeze never bake it (an untagged plain mesh gets merged and
      // the pushback would visibly freeze).
      tug.userData.dynamic = true;
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
          jet.position.z = z; tug.position.z = z + 16;
          if (phase >= 1) { state = "taxi"; tug.visible = false; }
          return;
        }
        if (state === "taxi") {
          jet.position.z -= taxiSpeed * dt;
          // Clear the visible airport before recycling. The next lifecycle
          // begins parked, never driving backward through the player's view.
          if (jet.position.z < A_MINZ - 90) {
            jet.visible = false;
            jet.position.z = z0; tug.position.z = z0 + 16;
            phase = 0; dwellT = 45; state = "hidden";
          }
          return;
        }
        if (state === "hidden") {
          dwellT -= dt;
          if (dwellT <= 0) { jet.visible = true; tug.visible = true; setJetSolid(true); dwellT = 18; state = "dwell"; }
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
    jetBridge(-92.5); jetBridge(-37.5);

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
        if (!inGapX(x)) pts.push([x, A_MAXZ]);       // north (skip centre gap)
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
        // north split around centre gap
        panelRun(A_MINX, A_MAXZ, midX - PG, A_MAXZ);
        panelRun(midX + PG, A_MAXZ, A_MAXX, A_MAXZ);
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
        const fm = new THREE.MeshLambertMaterial({ color: 0x66717d, transparent: true, opacity: 0.52, depthWrite: true, side: THREE.DoubleSide });
        const fmesh = new THREE.Mesh(BGU.mergeBufferGeometries(panels), fm);
        fmesh.matrixAutoUpdate = false; root.add(fmesh);
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
      function airportActor(profile, x, z, opts, role) {
        if (CBZ.npcLife && CBZ.npcLife.definePopulation) {
          populationEntries.push({
            profile: profile, placement: { x: x, z: z, rng: rng }, overrides: opts || {},
            configure: function (p) { p._airportRole = role; },
          });
          return null;
        }
        if (CBZ.npcLife) {
          const p = CBZ.npcLife.spawnCity(profile, {
            x: x, z: z, parent: root, rng: rng,
          }, opts || {});
          if (p) p._airportRole = role;
          return p;
        }
        const p = CBZ.cityMakePed(x, z, rng, opts || {});
        if (!p || !p.group) return null;
        root.add(p.group);
        if (CBZ.cityPeds && CBZ.cityPeds.indexOf(p) < 0) CBZ.cityPeds.push(p);
        p._airportRole = role;
        return p;
      }
      // passengers in the terminal (carry-on, low aggression travellers)
      for (let i = 0; i < 14; i++) {
        const sx = -40 + (rng() - 0.5) * 130;
        const sz = 24 + (rng() - 0.5) * 18;
        airportActor("terminalTraveller", sx, sz, {
          kind: "civilian", archetype: "tourist", job: "traveller",
          wealth: 0.4 + rng() * 0.4, aggr: 0.06 + rng() * 0.08,
        }, "traveller");
      }
      // ground crew in hi-vis on the apron near the jets
      for (let i = 0; i < 6; i++) {
        const sx = -120 + rng() * 220;
        const sz = APRON_Z - 18 + (rng() - 0.5) * 18;
        airportActor("groundCrew", sx, sz, {
          kind: "worker", archetype: "laborer", job: "ground crew",
          outfit: 0xffc81f, wealth: 0.25, aggr: 0.12 + rng() * 0.06,
        }, "ground-crew");
      }
      if (populationEntries.length && CBZ.npcLife && CBZ.npcLife.definePopulation) {
        CBZ.npcLife.definePopulation("airport-authored", { root: root, entries: populationEntries });
      }
    })();

    // taxis at the landside curb (south of the terminal)
    if (CBZ.cityMakeCar && CBZ.cityEcon && CBZ.cityEcon.carByName) {
      const taxiModel = CBZ.cityEcon.carByName("Taxi") || CBZ.cityEcon.carByName("Sedan") || null;
      for (let i = 0; i < 3; i++) {
        try { CBZ.cityMakeCar(-70 + i * 14, 42, Math.PI / 2, false, taxiModel, 0.2); } catch (e) {}
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
        x: -40, z: APRON_Z - 16, cap: 6,
        home: { x: -40, z: 24 },                            // the terminal concourse
        spots: [
          { x: -120, z: APRON_Z - 14 },                     // gate 1 airliner
          { x: -10, z: APRON_Z - 14 },                      // mid-apron gate
          { x: 95, z: APRON_Z - 6 },                        // the private-jet apron
          { x: -40, z: APRON_Z + 18 },                      // the baggage / GSE line
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
    city.airportSpawn = { x: -40, y: 0, z: 7, yaw: Math.PI, place: "Halloran Field apron" };
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
    if (CBZ.registerNoSpawnZone) {
      CBZ.registerNoSpawnZone(city, { minX: A_MINX, maxX: A_MAXX, minZ: A_MINZ, maxZ: 9, label: "airport-airside" });
      CBZ.registerNoSpawnZone(city, { minX: -116, maxX: 36, minZ: 10, maxZ: 38, label: "airport-terminal" });
    }
    city.airportAudit = {
      bounds: { minX: A_MINX, maxX: A_MAXX, minZ: A_MINZ, maxZ: A_MAXZ },
      runway: { minX: RWY_X0, maxX: RWY_X1, minZ: RWY_Z - RWY_W / 2, maxZ: RWY_Z + RWY_W / 2 },
      noSpawn: [
        { minX: A_MINX, maxX: A_MAXX, minZ: A_MINZ, maxZ: 9, label: "airport-airside" },
        { minX: -116, maxX: 36, minZ: 10, maxZ: 38, label: "airport-terminal" },
      ],
      aircraft: AIRCRAFT_DIMS,
    };
    // give traffic a road down the causeway (runs along Z → vertical)
    if (city.roads) {
      city.roads.push({ x: (CW_MINX + CW_MAXX) / 2, z: (CW_MINZ + CW_MAXZ) / 2, vertical: true, len: CW_MAXZ - CW_MINZ, district: "highway", w: 24, lanesPerDir: 3, laneW: 3.6, median: true, medianW: 1.2 });
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
