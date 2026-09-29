/* ============================================================
   city/militaryvehicles.js — STEAL THE HARDWARE: every tank, chopper, jet and
   truck on the bases is a LIVE, DRIVABLE machine, not a dead prop.

   WHY (owner's #1 law — no prop without a felt, in-world reason): the air-force
   base (Fort Brandt) and the airport (Halloran Field) are wall-to-wall military
   and civil aircraft + a motor pool of tanks. If you can SEE an M1 idling in the
   motor pool and a Raptor on the strip, the only honest thing the game can do is
   let you climb in and TAKE it. A parked tank you can only walk around is a lie —
   it tells you the base is a diorama. So every placed machine registers here as a
   boardable; walk up, the ONE context-interaction panel offers "Commandeer the
   tank / Steal the helicopter / Steal the aircraft", and pressing it does the
   real thing: the crime fires, the manhunt lights up, and you are FLYING or
   DRIVING it. The risk (a 3–4★ base full of soldiers) is the felt earn.

   This module is the bridge between the static island props (island_military.js,
   island_airport.js place the groups + tag them) and the two existing player-
   control systems:
     • AIR  (heli / plane) → playeraircraft.js makeCraft + enterAircraft, via the
       NEW CBZ.citySpawnFlyableFromProp — we hide the static prop and fly a real
       flyable stand-in (so it gets rotors, missiles, the chase cam, the keep
       loop). It's HOT: bail and it's impounded, exactly like the stolen Raptor.
     • GROUND (tank / armored truck) → an order-11.6 ground-locked drive sim in
       THIS file that mirrors the car controller but moves the actual island prop
       group. P.driving=true makes physics.js yield + the GTA chase-cam frame it
       for free; the tank additionally gets an independent turret that tracks the
       mouse and fires real shells through CBZ.cityFireMissile.

   ENGINE CONTRACT: headless-guarded; every cross-module global is feature-
   detected so a missing sibling degrades gracefully and nothing throws at load.
   ADDITIVE — it never touches the car or aircraft control paths except through
   their public entry points, and it GUARDS hard against two systems co-owning the
   player (you cannot board armor while driving/flying, or fly while in armor).
   Draw-call frugal: armor reuses the island prop's existing geometry (we just
   move/rotate it); no per-frame allocation in the sim. Plain IIFE, window.CBZ,
   THREE r128, no build step. Loads AFTER vehicles.js / playeraircraft.js /
   interactions.js (index.html), so their globals exist when we wire in.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;

  // ---- the boardable registry. Each record:
  //   { group, pos(=group.position), heading, kind, model:{name}, footW, footL,
  //     taken, hot }
  // island_military.js / island_airport.js push these (deferred, after we load).
  const props = [];
  CBZ.cityMilitaryVehicles = props;

  function registerVehicle(rec) {
    if (!rec || !rec.group) return rec || null;
    if (rec.pos == null) rec.pos = rec.group.position;        // pos IS the group's live position
    if (rec.heading == null) rec.heading = rec.group.rotation.y || 0;
    if (rec.taken == null) rec.taken = false;
    if (rec.hot == null) rec.hot = true;                      // every base machine is hot the moment you take it
    if (rec.footW == null) rec.footW = 3;
    if (rec.footL == null) rec.footL = 5;
    if (!rec.model) rec.model = { name: rec.kind === "tank" ? "Tank" : rec.kind === "heli" ? "Helicopter" : rec.kind === "plane" ? "Aircraft" : "Vehicle" };
    props.push(rec);
    return rec;
  }
  CBZ.cityRegisterMilitaryVehicle = registerVehicle;

  // Distance to the outside of a vehicle's oriented footprint. Centre-distance
  // made the airport fleet impossible to board: an airliner is ~30m across and
  // its solid collider keeps the player far more than the old 5.5m centre radius
  // away. Measuring from the hull edge keeps small vehicles unchanged while an
  // airliner becomes interactable where a real door/fuselage would be.
  function footprintDistance(v, x, z) {
    const dx = x - v.pos.x, dz = z - v.pos.z;
    const a = -(v.heading || 0), ca = Math.cos(a), sa = Math.sin(a);
    const lx = dx * ca - dz * sa, lz = dx * sa + dz * ca;
    const ox = Math.max(0, Math.abs(lx) - Math.max(0.5, v.footW || 3) * 0.5);
    const oz = Math.max(0, Math.abs(lz) - Math.max(0.5, v.footL || 5) * 0.5);
    return Math.hypot(ox, oz);
  }

  const _boardPoint = new THREE.Vector3();
  const _boardBox = new THREE.Box3();
  const _boardRay = new THREE.Raycaster();
  const _boardDir = new THREE.Vector3();

  // Aircraft are not rectangles. Their full-span footprint is useful as a
  // broad phase, but it can select empty air (or a neighboring gate plane).
  // Measure from the rendered airframe while its parked root is unchanged.
  function vehicleSurfaceDistance(v, x, z, y) {
    if (!v || !v.group) return Infinity;
    if (v.kind !== "plane" && v.kind !== "heli") return footprintDistance(v, x, z);
    const p = v.group.position, r = v.group.rotation;
    const stamp = [p.x, p.y, p.z, r.x, r.y, r.z].join("/");
    if (!v._boardBounds || v._boardBoundsStamp !== stamp) {
      v.group.updateWorldMatrix(true, true);
      _boardBox.setFromObject(v.group);
      v._boardBounds = v._boardBounds || new THREE.Box3();
      v._boardBounds.copy(_boardBox);
      v._boardBoundsStamp = stamp;
    }
    const py = y == null ? ((CBZ.player && CBZ.player.pos && CBZ.player.pos.y) || 0) + 0.9 : y;
    return v._boardBounds.distanceToPoint(_boardPoint.set(x, py, z));
  }
  CBZ.cityVehicleSurfaceDistance = vehicleSurfaceDistance;

  function vehicleRayMeshes(v) {
    if (v._boardRayMeshes) return v._boardRayMeshes;
    const a = [];
    v.group.traverse(function (o) { if (o && o.isMesh && o.geometry) a.push(o); });
    v._boardRayMeshes = a;
    return a;
  }

  // Keyboard/controller boarding follows the same visible mesh authority as
  // touch and bullets.  The aimed airframe wins before proximity fallbacks.
  function aimedVehicle(P, maxRay, maxSurface) {
    if (!P || !P.pos || !CBZ.camera || !CBZ.camera.getWorldDirection) return null;
    _boardRay.set(CBZ.camera.position, CBZ.camera.getWorldDirection(_boardDir).normalize());
    _boardRay.near = 0; _boardRay.far = maxRay == null ? 24 : maxRay;
    let best = null, bd = _boardRay.far;
    for (let i = 0; i < props.length; i++) {
      const v = props[i];
      if (!v || v.destroyed || !v.group || !v.group.parent || v.group.visible === false) continue;
      if (vehicleSurfaceDistance(v, P.pos.x, P.pos.z, P.pos.y + 0.9) > (maxSurface == null ? 10.5 : maxSurface)) continue;
      _boardRay.far = bd;
      const hits = _boardRay.intersectObjects(vehicleRayMeshes(v), false);
      for (let h = 0; h < hits.length; h++) {
        const q = hits[h];
        if (!q.object || q.object.visible === false || q.distance >= bd) continue;
        bd = q.distance; best = v; break;
      }
    }
    return best;
  }
  CBZ.cityAimedMilitaryVehicle = function () { return aimedVehicle(CBZ.player, 24, 10.5); };

  // nearest NON-taken boardable within maxd (mirrors CBZ.cityNearestCar)
  function nearestVehicle(x, z, maxd, y) {
    let best = null, bd = (maxd == null ? 5.5 : maxd);
    for (let i = 0; i < props.length; i++) {
      const v = props[i];
      if (!v || v.taken || v.destroyed || !v.group || !v.group.parent) continue;
      // The interaction scanner asks this at 12 Hz for every prop in the
      // world; the surface distance below builds a Box3 (and a stamp string)
      // per aircraft. Nothing whose CENTRE is more than its own half-span
      // past the cutoff can have a surface inside it — one squared subtract.
      const cx = x - v.pos.x, cz = z - v.pos.z;
      const halfSpan = (v.kind === "plane" || v.kind === "heli") ? 45 : Math.max(v.footW || 3, v.footL || 5);
      if (cx * cx + cz * cz > (bd + halfSpan) * (bd + halfSpan)) continue;
      const d = vehicleSurfaceDistance(v, x, z, y);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }
  CBZ.cityNearestMilitaryVehicle = nearestVehicle;

  function nearestCivilAircraft(x, z, maxd, y) {
    let best = null, bd = maxd == null ? 10 : maxd;
    for (let i = 0; i < props.length; i++) {
      const v = props[i];
      if (!v || !v.civilian || v.kind !== "plane" || v.taken || !v.group || !v.group.parent) continue;
      const d = vehicleSurfaceDistance(v, x, z, y);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  // ---- small feature-detected helpers (match the storage.js voice) ----------
  function campaignActive() {
    try { return !!(CBZ.cityCampaignActive && CBZ.cityCampaignActive()); } catch (e) { return false; }
  }
  function campaignNotify(from, body) {
    if (!CBZ.campaignUI || typeof CBZ.campaignUI.notify !== "function") return;
    try { CBZ.campaignUI.notify("personal", from || "Vehicle", body); } catch (e) {}
  }
  function note(m, s) {
    if (campaignActive()) { campaignNotify("Vehicle", m); return; }
    if (CBZ.city && CBZ.city.note) { try { CBZ.city.note(m, s); } catch (e) {} }
  }
  function big(m) {
    if (campaignActive()) { campaignNotify("Dispatch", m); return; }
    if (CBZ.city && CBZ.city.big) { try { CBZ.city.big(m); } catch (e) {} }
  }
  function sfx(n) { if (CBZ.sfx) { try { CBZ.sfx(n); } catch (e) {} } }
  /* ---- THE SURFACE UNDER A TRACK ------------------------------------------
     OWNER: "even a tank can drive into the back."

     One line of that is a modelling problem and the rest is this function. A
     ramp is not a trigger volume and driving into a hold is not a cutscene:
     the tank climbs because the ground query it already makes returns a higher
     number when there is steel under the tracks. CBZ.mpGroundAt is EXACTLY the
     query the player's feet make (systems/physics.js groundAt calls it on the
     line after its static-platform loop), so a tank and a body now agree about
     what the floor is — on a cargo ramp, on a boat deck, on a lift, on
     anything any future rig declares. Feature-detected and flag-gated at the
     source; absent or off, this is the old one-liner exactly.

     `fromY` is the hull's CURRENT height, and passing it matters: mpGroundAt
     gates support at fromY + STEP_UP the same way the static loop does, so a
     tank cannot levitate onto a deck it was never touching — it has to come at
     the ramp from the bottom, like a tank. */
  function floorY(x, z, fromY) {
    let b = 0;
    if (CBZ.floorAt) { try { b = +CBZ.floorAt(x, z) || 0; } catch (e) { b = 0; } }
    if (CBZ.mpGroundAt) {
      try {
        const t = CBZ.mpGroundAt(x, z, fromY != null ? fromY : b, b);
        if (t > b && isFinite(t)) b = t;
      } catch (e) {}
    }
    return b;
  }
  function clampToCity(pos, r) {
    const A = CBZ.city && CBZ.city.arena;
    if (A && A.clampToCity) { try { A.clampToCity(pos, r); } catch (e) {} }
  }
  function wrapA(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }
  function vehName(rec) { return (rec && rec.model && rec.model.name) || (rec && rec.name) || "Vehicle"; }
  function activeCtx() { return g.mode === "city" && g.state === "playing"; }
  function aircraftFlying() { const P = CBZ.player; return !!(P && P._aircraft); }

  // ---- PARKED-COLLIDER BOOKKEEPING -----------------------------------------
  // Every island prop registers a solid world collider so the parked machine
  // blocks movement. When the machine is STOLEN the collider must leave with
  // it: the old code left it behind, so an invisible solid block haunted the
  // empty slot forever — and a commandeered hull was shoved out of its OWN
  // parked wall by cityCollideVehicle every frame. Detach/restore use the exact
  // same rec fields as playeraircraft.js (_colliderDetached/_colliderHeight/
  // _colliderY0Offset) so whichever module runs first wins and the other
  // no-ops — the two systems share one protocol on the same record.
  function detachParkedCollider(rec) {
    const col = rec && rec.collider;
    if (!col || rec._colliderDetached) return;
    if (rec._colliderHeight == null && col.y0 != null && col.y1 != null) {
      rec._colliderHeight = col.y1 - col.y0;
      rec._colliderY0Offset = col.y0 - (rec.pos.y || 0);
    }
    const i = CBZ.colliders ? CBZ.colliders.indexOf(col) : -1;
    if (i >= 0) CBZ.colliders.splice(i, 1);
    rec._colliderDetached = true;
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  }
  // re-park the solid wherever the hull now rests (abandoned armor stays a
  // real obstacle, not a ghost you walk through). Oriented footprint → AABB.
  function restoreParkedCollider(rec) {
    const col = rec && rec.collider;
    if (!col || !rec.group) return;
    // A hull STRAPPED INSIDE A HOLD must not re-park a world-space AABB: the
    // box would be computed for wherever the carrier happened to be standing
    // and would then haunt that patch of apron for the rest of the run while
    // the tank itself flew away. The same lie the airliner cabin's static deck
    // tells — and the reason vehicle_hold.js re-asserts poses instead.
    if (rec._heldBy) return;
    const a = rec.group.rotation.y || 0;
    const ca = Math.abs(Math.cos(a)), sa = Math.abs(Math.sin(a));
    const hw = Math.max(0.5, rec.colliderW || rec.footW || 3) * 0.5;
    const hl = Math.max(0.5, rec.colliderL || rec.footL || 5) * 0.5;
    const ex = ca * hw + sa * hl, ez = sa * hw + ca * hl;
    col.minX = rec.pos.x - ex; col.maxX = rec.pos.x + ex;
    col.minZ = rec.pos.z - ez; col.maxZ = rec.pos.z + ez;
    if (rec._colliderHeight != null) {
      col.y0 = (rec.pos.y || 0) + (rec._colliderY0Offset || 0);
      col.y1 = col.y0 + rec._colliderHeight;
    }
    col._city = true;   // base hardware is a city-world object; never solid in the prison space
    if (CBZ.colliders && CBZ.colliders.indexOf(col) < 0) CBZ.colliders.push(col);
    rec._colliderDetached = false;
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  }

  // AI dispatch uses the exact same ownership/collider protocol as theft.  A
  // parked machine becomes unavailable to the player while a named soldier is
  // in its seat, and returning it to the authored pad restores both the solid
  // footprint and the ordinary boarding verb.  Aircraft.js owns the flight;
  // this module remains the single authority for the parked registry.
  CBZ.cityClaimMilitaryVehicle = function (rec, pilot) {
    if (!rec || rec.taken || rec._aiActive || !rec.group || !rec.group.parent || !pilot || pilot.dead) return false;
    rec.taken = true; rec._aiActive = true; rec._aiPilot = pilot;
    rec._aiHome = {
      x: rec.pos.x, y: rec.pos.y || 0, z: rec.pos.z,
      heading: rec.group.rotation.y || rec.heading || 0,
    };
    detachParkedCollider(rec);
    return true;
  };
  CBZ.cityReleaseMilitaryVehicle = function (rec, destroyed) {
    if (!rec) return;
    rec._aiActive = false; rec._aiPilot = null;
    if (destroyed) {
      // A shot-down airframe remains spent; it never silently respawns on a pad.
      rec.taken = true;
      return;
    }
    const h = rec._aiHome;
    if (h && rec.group) {
      rec.pos.set(h.x, h.y, h.z);
      rec.group.position.copy(rec.pos);
      rec.group.rotation.set(0, h.heading, 0);
      rec.heading = h.heading;
    }
    rec.taken = false;
    restoreParkedCollider(rec);
  };

  // ============================================================
  //  BOARD VERB — self-registered into the ONE interaction registry (no
  //  interact.js edit). A source feeds the nearest non-taken machine when you're
  //  on foot (driving:false), a describe() names it, and the option commandeers
  //  it. WHY here, not interact.js: the registry is global + additive — new
  //  verbs register instead of bolting a keydown on, so they never collide.
  // ============================================================
  function wireInteraction() {
    if (!CBZ.interactions || !CBZ.interactions.registerSource) return false;
    if (wireInteraction._done) return true;
    const I = CBZ.interactions;
    I.registerSource({
      id: "src-milveh", kind: "milvehicle", layers: ["milvehicle"], prio: 3, driving: false,
      find: function (px, pz, ctx, push) {
        const py = ctx && ctx.pos && ctx.pos.y != null ? ctx.pos.y + 0.9 : null;
        const v = CBZ.cityNearestMilitaryVehicle && CBZ.cityNearestMilitaryVehicle(px, pz, 5.5, py);
        if (v) push(v, vehicleSurfaceDistance(v, px, pz, py));
      },
    });
    if (I.describe) {
      I.describe("milvehicle", function (v) {
        const civil = !!v.civilian;
        const airliner = v.flightKind === "airliner";
        return {
          label: civil
            ? "" + (airliner ? "Airliner" : "Private Jet")
            : "" + (v.model ? v.model.name : (v.name || "Vehicle")),
          note: (civil ? (airliner ? "Hijack this commercial flight" : "Steal this aircraft")
            : v.kind === "tank" ? "Commandeer the tank"
            : v.kind === "patriot" ? "Commandeer the missile battery"
            : v.kind === "mlrs" ? "Commandeer the rocket launcher"
            : v.kind === "heli" ? "Steal the helicopter"
            : v.kind === "plane" ? "Steal the aircraft"
            : "Steal the vehicle") + " · expect heat",
        };
      });
    }
    if (I.register) {
      I.register("milvehicle", {
        id: "milveh-take", slot: "e", ride: true, bad: true, campaignSafe: true,
        label: function (v) {
          return v.civilian ? (v.flightKind === "airliner" ? "Hijack" : "Steal")
            : (v.kind === "tank" || v.kind === "patriot" || v.kind === "mlrs") ? "Commandeer"
            : "Steal";
        },
        onSelect: function (v) { boardVehicle(v); },
      });
    }
    wireInteraction._done = true;
    return true;
  }

  // Campaign CSS deliberately keeps the legacy interaction card hidden. A
  // one-time gate update can still establish that a flight is ready, but must
  // read like an in-world message rather than a keyboard tutorial.
  let campaignAircraftTipShown = false;
  if (CBZ.onUpdate) CBZ.onUpdate(14.65, function () {
    if (campaignAircraftTipShown || !campaignActive() || !activeCtx()) return;
    const P = CBZ.player;
    if (!P || !P.pos || P.dead || P.driving || P._aircraft) return;
    const rec = nearestCivilAircraft(P.pos.x, P.pos.z, 10, P.pos.y + 0.9);
    if (!rec) return;
    campaignAircraftTipShown = true;
    const airliner = rec.flightKind === "airliner";
    campaignNotify("GHOSTLINE", (airliner ? "The gate airliner" : "The private jet") + " is fueled and ready at the gate.");
  });

  // ============================================================
  //  COMMANDEER — the shared theft entry. Guards the two-owner rule HARD, fires
  //  the crime + manhunt exactly like storage.js stealBaseJet, then dispatches
  //  to AIR (flyable stand-in) or GROUND (armor drive sim).
  // ============================================================
  function boardVehicle(rec) {
    if (!rec) return false;
    if (rec.destroyed) { note("The airframe is wrecked.", 1.5); return false; }
    if (rec.taken) {
      note(rec._aiActive ? "A crew is already moving this aircraft." : "That seat is occupied.", 1.5);
      return false;
    }
    if (!activeCtx()) return false;
    const P = CBZ.player; if (!P || P.dead) return false;
    if (P.driving || P._vehicle) { note("Get out of your vehicle first.", 1.4); return false; }
    if (aircraftFlying()) { note("Already airborne.", 1.4); return false; }
    if (armor) { return false; }                    // already commanding a ground machine

    const name = vehName(rec);
    const air = rec.kind === "heli" || rec.kind === "plane";
    // Captured BEFORE dispatch, because driveArmor unstraps it: taking the
    // controls of a machine already lashed inside your own hold is unloading
    // your cargo, not a second grand theft, and it must not re-fire the crime.
    const wasFreight = !!rec._heldBy;

    // dispatch FIRST — only commit the theft/heat if a controller actually took it
    let took = false;
    if (air) {
      if (CBZ.citySpawnFlyableFromProp) {
        // ELEVATOR-GRAMMAR BOARDING (aircraft_doors.js): the door visibly
        // opens, the player walks IN through the opening, the door closes,
        // and only THEN does the flight controller take over. The arc runs
        // the same citySpawnFlyableFromProp at its end; if that spawn fails
        // (or the arc is cancelled — death/mode flip), the theft reverts.
        // boardVehicle's public return semantics are unchanged: true =
        // boarding committed. Flag off / module missing → the old instant
        // teleport path below.
        const doors = CBZ.aircraftDoorArc;
        if (doors && !doors.active) {
          took = doors.boardProp(rec,
            function handover() {
              let c = null;
              try { c = CBZ.citySpawnFlyableFromProp(rec); } catch (e) { c = null; }
              return !!c;
            },
            function onFail() {
              // arc cancelled or the engine wouldn't start — hand the airframe
              // back (untake + re-solidify the parked hull)
              rec.taken = false;
              restoreParkedCollider(rec);
              note("It won't start, try again.", 1.6);
            });
        } else if (doors && doors.active) {
          return false;                       // one boarding at a time
        }
        if (!took) { try { took = !!CBZ.citySpawnFlyableFromProp(rec); } catch (e) { took = false; } }
      }
    } else {
      took = driveArmor(rec);
    }
    if (!took) { note("It won't start, try again.", 1.6); return false; }

    rec.taken = true;
    // the parked solid leaves with the machine (idempotent — the air path may
    // have already detached it inside citySpawnFlyableFromProp).
    detachParkedCollider(rec);
    if (wasFreight) return true;                    // unloading, not stealing
    // THEFT + HEAT (mirror storage.js stealBaseJet): grand theft of military
    // hardware is instant, loud, and pins a hard manhunt. Ground = 3★, air = 4★.
    if (CBZ.cityCrime) { try { CBZ.cityCrime(120, { type: rec.civilian ? "aircraft-hijacking" : "grand-theft-military", x: rec.pos.x, z: rec.pos.z, instant: true }); } catch (e) {} }
    if (CBZ.cityForceStars) { try { CBZ.cityForceStars(rec.kind === "heli" || rec.kind === "plane" ? 4 : 3); } catch (e) {} }
    big(rec.civilian ? "Tower reports a " + name + " departing with no clearance, owner not aboard." : "Base alert: a " + name + " just rolled off the reservation. Units scrambling.");
    // No abstract bell for the theft flag. The visible base response, wanted
    // escalation and dispatch message carry the event without a sound following
    // the stolen aircraft into the sky.
    return true;
  }
  CBZ.cityBoardMilitaryVehicle = boardVehicle;

  // ============================================================
  //  GROUND DRIVE SIM (order 11.6) — a ground-locked controller that mirrors the
  //  car sim (vehicles.js order-11) but moves the ACTUAL island prop group. We do
  //  NOT use P._vehicle (vehicles.js owns that singleton + its order-11 loop);
  //  instead a module `armor` flag owns this craft, and P.driving=true makes
  //  physics.js yield + the GTA chase-cam frame it. WHY drive the real prop and
  //  not a copy: the motor-pool tank IS the model you want to roll out — reusing
  //  its geometry is draw-call free and it visibly LEAVES its spot.
  // ============================================================
  let armor = null;          // the ground craft currently under player control, or null
  let _restoreChar = false;  // did we hide the player rig on board?

  // Ground feel comes from the machine (city/mil_armor.js spec.tune): the
  // owner's tank ~14 / truck ~20 m/s, and the rest at their real class —
  // a light utility vehicle is quicker than an 8x8, which is quicker than an
  // IFV. A hull without a rig (the airport's tugs, whatever registers later)
  // drives like a truck.
  function rigOf(rec) { const ud = rec && rec.group && rec.group.userData; return (ud && ud.rig) || null; }
  function armorTuning(rec) {
    const rig = rigOf(rec), t = (rig && rig.spec.tune) || {};
    return {
      accel: t.accel || 9,                         // m/s^2 toward top
      top: t.top || 20,                            // forward top speed
      rev: t.rev || 9,                             // reverse top speed
      brake: 18,
      turn: t.turn || 1.05,                        // rad/s hull rotation from A/D
      drag: 1.4,                                   // coast-down bleed
    };
  }

  function driveArmor(rec) {
    if (!rec || !rec.group) return false;
    const P = CBZ.player; if (!P) return false;
    armor = rec;
    rec.v = 0;
    rec.fireCD = 0;
    rec.heading = rec.group.rotation.y || rec.heading || 0;
    rec._tune = armorTuning(rec);
    // hand cityCollideVehicle the real hull footprint (it falls back to a small
    // 2×4.4 default otherwise) so the heavy machine shoulders walls/props at its
    // true size — a tank shouldn't slide through a fence post.
    if (!rec.dims) rec.dims = { width: rec.footW || 3, length: rec.footL || 5, wheelbase: (rec.footL || 5) * 0.5 };
    // TAKING THE CONTROLS UNSTRAPS IT. A latched load has its pose written by
    // its carrier every frame; the moment somebody is driving, the drive sim
    // owns the hull and the two must not both write it. No flag, no handshake —
    // the latch is released here and re-taken when the machine next comes to
    // rest inside a hold, which is also how you drive a tank back OUT.
    if (rec._heldBy && CBZ.vehicleHoldRelease) { try { CBZ.vehicleHoldRelease(rec); } catch (e) {} }
    // its own parked wall must go BEFORE the first sim tick or the hull gets
    // depenetrated out of itself (also covers direct CBZ.cityDriveArmor calls).
    detachParkedCollider(rec);
    P.driving = true;                               // physics.js yields; chase-cam engages
    P._aircraft = null;                             // belt-and-braces: never both
    P.vy = 0; P.grounded = false;
    // snap the player marker onto the hull so the chase-cam frames it
    const gy = floorY(rec.pos.x, rec.pos.z, rec.pos.y);
    P.pos.set(rec.pos.x, gy, rec.pos.z);
    _restoreChar = false;
    if (CBZ.playerChar && CBZ.playerChar.group && CBZ.playerChar.group.visible) {
      CBZ.playerChar.group.visible = false; _restoreChar = true;
    }
    // point the chase-cam down the hull's nose (cam frames behind cam.yaw)
    if (CBZ.cam) CBZ.cam.yaw = rec.heading + Math.PI;
    rec._lastHeading = rec.heading;
    rec._ripple = null; rec._burst = null;
    if (CBZ.city && CBZ.city.note) {
      const w = weaponOf(rec);
      const ctrl = w === "patriot" ? "[M] target · click LAUNCH"
        : w === "mlrs" ? "aim the pod · click RIPPLE"
          : w ? "mouse aims · click FIRE" : "";
      note(vehName(rec) + (ctrl ? " · " + ctrl : ""), 2.6);
    }
    return true;
  }
  CBZ.cityDriveArmor = driveArmor;

  // step out of the ground machine: settle it flat where it sits, drop the player
  // beside it on the surface, hand control back. The prop STAYS where you left it
  // (taken=true so it can't be re-boarded as a free prop), reading as abandoned.
  function exitArmor() {
    const rec = armor; armor = null;
    const P = CBZ.player;
    if (P) { P.driving = false; P._aircraft = null; }
    if (rec) {
      rec.v = 0;
      rec._ripple = null; rec._burst = null;
      const rig = rigOf(rec);
      if (rig) rig.settle();
      rec.group.rotation.set(0, rec.heading, 0);
      const gy = floorY(rec.pos.x, rec.pos.z, rec.pos.y);
      rec.pos.y = gy;
      rec.group.position.set(rec.pos.x, gy, rec.pos.z);
    }
    // PARKED INSIDE SOMEBODY'S HOLD? Then it is freight now. Asked before the
    // player is placed and before the collider is re-parked, because both of
    // those answers change if the hull is about to be strapped down.
    let held = null;
    if (rec && CBZ.vehicleHoldLatch) { try { held = CBZ.vehicleHoldLatch(rec); } catch (e) { held = null; } }
    if (P && rec) {
      // step out the SIDE (the driver's door), clear of the hull footprint —
      // the old forward drop landed inside longer hulls (and now inside the
      // re-parked collider). Right vector of heading = (cos, -sin). Inside a
      // hold the side clearance is deliberately tighter: 1.1 m off a 3.5 m tank
      // in a 4.4 m bay would put you through the wall, and the hold's own rig
      // walls would then shove you somewhere you did not ask to be.
      const side = rec.footW * 0.5 + (held ? 0.25 : 1.1);
      const ox = Math.cos(rec.heading) * side;
      const oz = -Math.sin(rec.heading) * side;
      const gy = floorY(rec.pos.x + ox, rec.pos.z + oz, rec.pos.y + 0.5);
      P.pos.set(rec.pos.x + ox, gy, rec.pos.z + oz);
      P.vy = 0; P.grounded = true;
    }
    // the abandoned hull becomes a solid obstacle again wherever it now rests
    // (a no-op for a strapped one — see restoreParkedCollider)
    if (rec) restoreParkedCollider(rec);
    // ...AND EVERYTHING COMES BACK OUT. `taken` normally stays true forever so
    // an abandoned hull cannot be re-boarded as free scenery, which is right on
    // an apron and catastrophic in a hold: it would mean the tank you flew
    // across the map can never be driven off the aeroplane again. A load you
    // strapped down yourself is not scenery, so it stays yours to take back.
    if (held && rec) rec.taken = false;
    if (_restoreChar && CBZ.playerChar && CBZ.playerChar.group && P) {
      CBZ.playerChar.group.visible = !P.dead;
      if (P) CBZ.playerChar.group.position.copy(P.pos);
    }
    _restoreChar = false;
  }
  CBZ.cityExitArmor = exitArmor;
  // Read-only seat ownership probe for controllers/touch. Armor intentionally
  // does not use P._vehicle, so callers cannot infer it from the car system.
  CBZ.cityArmorActive = function () { return !!armor; };
  // TOUCH SEAM (systems/touch_vehicle.js). Armor published ONE boolean, so the
  // touch layer could not tell a tank from a truck, could not read the hull's
  // speed for its dial, and had no fire verb to call — which is why a tank on
  // an iPad was a machine you could board and never leave (the on-foot cluster
  // is hidden by body.tveh-on the whole time you are in one). Two read-only
  // accessors and one call-through; no state moves out of this file.
  // core/mission.js also has to IDENTIFY this hull today by comparing the
  // player's position against every record (its own `armorIs` comment says so);
  // cityArmorRec is the honest answer whenever that file is next opened.
  CBZ.cityArmorRec = function () { return armor; };
  // What a hull can shoot is the machine's own answer (spec.weapon): cannon,
  // autocannon, hmg, patriot, mlrs — or nothing (the cargo truck).
  function weaponOf(rec) { const rig = rigOf(rec); return (rig && rig.spec.weapon) || null; }
  function armedArmor(rec) { return !!weaponOf(rec); }
  CBZ.cityArmorCanFire = function () { return armedArmor(armor); };
  CBZ.cityArmorFire = function () {
    const w = weaponOf(armor);
    if (!w) return false;
    if (w === "patriot") return firePatriot(armor);
    if (w === "mlrs") return fireMLRS(armor);
    if (w === "cannon") return fireTank(armor);
    return fireGun(armor, w);
  };

  // One input route for every stealable machine. Pressing F (pad Y) exits the
  // current seat or attempts the nearest parked ride; there is no artificial
  // ownership lock. Aircraft use footprint distance, so touching a door or
  // wing root works even when the model centre is many metres away.
  CBZ.cityTryNearestRide = function () {
    const P = CBZ.player;
    if (!P || !P.pos || P.dead || !activeCtx()) return false;
    /* SEATED FIRST: the way out of whatever you are in (cockpit, hull, car,
       saddle, chair, bed) is systems/seat_exit.js's, the ONE exit dispatcher
       the keyboard, the touch EXIT button and the gamepad all share. On a
       keyboard its capture-phase listener already consumed the press before
       this router runs; this line is for programmatic callers. It used to be
       four exit branches here plus a second [E] listener for armor below,
       and nothing for a chair: standing up off a bench with E went straight
       on to board the nearest parked car. */
    if (CBZ.seatExit && CBZ.seatExit()) return true;
    if (P.driving || P._aircraft || armor) return false;
    if (CBZ.cuffedPlayer && CBZ.cuffedPlayer.on()) return false;   // cuffed: no hands for a door, a hatch or a stick

    const aimed = aimedVehicle(P, 24, 10.5);
    if (aimed) {
      // Consume this use press even if the specifically aimed machine is
      // already crewed; otherwise a failed theft can fire an unrelated nearby
      // interaction and feels like the plane randomly ignored F/Y.
      boardVehicle(aimed);
      return true;
    }
    const machine = nearestVehicle(P.pos.x, P.pos.z, 9.5, P.pos.y + 0.9);
    if (machine) return boardVehicle(machine);
    if (CBZ.cityNearestCar && CBZ.cityEnterVehicle) {
      const car = CBZ.cityNearestCar(P.pos.x, P.pos.z, 4.8);
      if (car) return CBZ.cityEnterVehicle(car) !== false;
    }
    return false;
  };

  // [F] out of armor is systems/seat_exit.js's (CBZ.seatState "armor" reads
  // cityArmorActive/cityArmorRec and calls cityExitArmor). No second listener.

  // Declared at LOAD so the ordnance census counts a wired launcher, not a used
  // one (see aircraft.js's ordnance law).
  if (CBZ.ordnanceSite) {
    try { CBZ.ordnanceSite("armor:tank-main", "missile"); } catch (e) {}
    try { CBZ.ordnanceSite("armor:patriot-map", "patriot"); } catch (e) {}
    try { CBZ.ordnanceSite("armor:mlrs", "rocket227"); } catch (e) {}
  }

  // L-click fires whichever real weapon the commanded ground hull owns. A
  // Patriot still refuses until the full map has one designated waypoint.
  addEventListener("mousedown", function (e) {
    if (e.button !== 0) return;
    if (!armedArmor(armor)) return;
    if (!activeCtx() || !document.pointerLockElement) return;
    e.preventDefault();
    CBZ.cityArmorFire();
  });

  // THE MAIN GUN. The shell leaves the real muzzle along the real bore — the
  // turret's traverse AND the gun's elevation — through CBZ.cityFireMissile
  // (the one ordnance law: red lock ⇒ homing, else dead straight). Pool
  // saturated ⇒ the "tank" row detonates 30 m down the bore so the gun still
  // bites. Then the machine answers: tube recoils, hull rocks, muzzle blast.
  const _mz = new THREE.Vector3(), _md = new THREE.Vector3();
  function fireTank(rec) {
    const rig = rigOf(rec);
    if (!rig || rec.fireCD > 0) return false;
    const wp = rig.muzzleWorld(_mz), d = rig.gunDirWorld(_md);
    let fired = false;
    if (CBZ.cityFireMissile) {
      try { fired = !!CBZ.cityFireMissile(wp.x, wp.y, wp.z, d.x, d.y, d.z, { byPlayer: true, site: "armor:tank-main" }); } catch (e) { fired = false; }
    }
    if (!fired && CBZ.detonate) {
      const tx = wp.x + d.x * 30, tz = wp.z + d.z * 30;
      try { CBZ.detonate(tx, CBZ.blastSeatY ? CBZ.blastSeatY(tx, tz) : 1.0, tz, "tank", { byPlayer: true, dirx: d.x, dirz: d.z }); } catch (e) {}
    }
    rig.fired(1);
    rec.fireCD = 0.85;
    if (CBZ.shake) { try { CBZ.shake(0.6); } catch (e) {} }
    sfx("whoosh");
    if (CBZ.cityCrime) { try { CBZ.cityCrime(140, { x: rec.pos.x, z: rec.pos.z, type: "shots-fired" }); } catch (e) {} }
    return true;
  }

  // AUTOCANNON / HEAVY MG: a short burst per click, each round a real ray
  // down the bore against the collider grid and the ground, a tracer, and the
  // warhead the calibre deserves (30 mm HE = the grenade row, .50 = kinetic).
  const BURST = {
    autocannon: { n: 3, gap: 0.14, kind: "grenade", range: 900, cd: 0.55, flash: 0.45 },
    hmg: { n: 6, gap: 0.075, kind: "kinetic", range: 700, cd: 0.45, flash: 0.22 },
  };
  const _hit = { hit: false };
  function fireGun(rec, w) {
    const B = BURST[w];
    if (!B || rec.fireCD > 0 || rec._burst) return false;
    rec._burst = { left: B.n, t: 0, B: B, k: 0 };
    rec.fireCD = B.cd;
    if (CBZ.cityCrime) { try { CBZ.cityCrime(90, { x: rec.pos.x, z: rec.pos.z, type: "shots-fired" }); } catch (e) {} }
    return true;
  }
  // deterministic dispersion pattern (mils), no Math.random in a weapon
  const DISP = [[0, 0], [1.2, -0.8], [-1.0, 0.9], [0.6, 1.3], [-1.4, -0.5], [0.9, -1.2]];
  function burstRound(rec, rig, B) {
    const wp = rig.muzzleWorld(_mz), d = rig.gunDirWorld(_md);
    const dd = DISP[rec._burst.k++ % DISP.length];
    d.x += dd[0] * 0.002; d.y += dd[1] * 0.002; d.normalize();
    let t = B.range;
    if (CBZ.rayColliders) { try { const c = CBZ.rayColliders(wp.x, wp.y, wp.z, d.x, d.y, d.z, B.range, _hit); if (c) t = _hit.t; } catch (e) {} }
    if (d.y < -1e-3) {
      const gy = floorY(wp.x + d.x * t, wp.z + d.z * t);
      const tg = (wp.y - gy) / -d.y;
      if (tg > 0 && tg < t) t = tg;
    }
    const hx = wp.x + d.x * t, hy = wp.y + d.y * t, hz = wp.z + d.z * t;
    if (CBZ.tracer) { try { CBZ.tracer({ x: wp.x, y: wp.y, z: wp.z }, { x: hx, y: hy, z: hz }, { byPlayer: true }); } catch (e) {} }
    if (t < B.range - 1 && CBZ.detonate) {
      try { CBZ.detonate(hx, hy, hz, B.kind, { byPlayer: true, dirx: d.x, dirz: d.z }); } catch (e) {}
    }
    rig.fired(B.flash);
    if (CBZ.shake) { try { CBZ.shake(0.12); } catch (e) {} }
  }

  const _patriotMuzzle = new THREE.Vector3();
  function patriotWaypoint() {
    try { return CBZ.fullMap && CBZ.fullMap.waypoint ? CBZ.fullMap.waypoint("city") : null; }
    catch (e) { return null; }
  }
  function patriotTarget(wp) {
    /* ASK THE SHELL FIRST. Resolving a designated point against COLLIDERS was
       right in spirit and wrong on the most common building in the city: the
       eligibility below wants a box at least 3.2 m tall, and a glass office
       storey's face is a 0.55 m sill course, a 0.45 m header course and two
       3.1 m jambs at the corners. Nothing qualified, so a waypoint dropped on
       a downtown tower fell through to `floorAt + 0.65` and the round hit the
       KERB — MEASURED: the map promised a building and the strike cratered the
       crossing in front of it.
       Every shell in the world is minted by cityMakeBuilding and registered on
       the arena root, footprint and height included, so the question "is the
       designated point a building" has a direct answer. Colliders remain the
       fallback for everything raised outside that registry. */
    const A = CBZ.city && CBZ.city.arena;
    const shells = (A && A.root && A.root.userData && A.root.userData.shells) || null;
    if (shells) {
      let hit = null, hitD = 1e9;
      for (let i = 0; i < shells.length; i++) {
        const b = shells[i];
        if (!b || !(b.h > 0)) continue;
        const dx = Math.max(Math.abs(wp.x - b.ox) - b.w / 2, 0);
        const dz = Math.max(Math.abs(wp.z - b.oz) - b.d / 2, 0);
        const d = Math.hypot(dx, dz);
        if (d > 4.5 || d >= hitD) continue;
        hitD = d; hit = b;
      }
      if (hit) {
        // the middle storeys: high enough to open a bay and expose a floor,
        // low enough that the wound is legible from the street.
        const y = Math.min(hit.h - 1.6, Math.max(3.4, hit.h * 0.45));
        return { x: wp.x, y: y, z: wp.z };
      }
    }
    let wall = null, best = 5.0;
    const cols = CBZ.colliders || [];
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      const y0 = c.y0 == null ? 0 : c.y0, y1 = c.y1 == null ? 0 : c.y1;
      const ex = c.maxX - c.minX, ez = c.maxZ - c.minZ;
      if (y1 - y0 < 3.2 || Math.min(ex, ez) > 1.2 || c.noBreach) continue;
      const sx = Math.max(c.minX, Math.min(c.maxX, wp.x));
      const sz = Math.max(c.minZ, Math.min(c.maxZ, wp.z));
      const d = Math.hypot(wp.x - sx, wp.z - sz);
      if (d < best) { best = d; wall = c; }
    }
    if (wall) {
      // A cityMakeBuilding facade is split into one collider band per storey.
      // A first-match policy therefore always picked the ground band while the
      // map promised a building target. Union the vertically aligned bands on
      // this same face, then aim at the actual middle storeys.
      const wx = wall.maxX - wall.minX, wz = wall.maxZ - wall.minZ;
      const horiz = wx >= wz;
      const face = horiz ? (wall.minZ + wall.maxZ) * 0.5 : (wall.minX + wall.maxX) * 0.5;
      let band0 = wall.y0 == null ? 0 : wall.y0;
      let band1 = wall.y1 == null ? band0 + 8 : wall.y1;
      for (let i = 0; i < cols.length; i++) {
        const c = cols[i];
        const y0 = c.y0 == null ? 0 : c.y0, y1 = c.y1 == null ? 0 : c.y1;
        const ex = c.maxX - c.minX, ez = c.maxZ - c.minZ;
        if (y1 - y0 < 1.6 || Math.min(ex, ez) > 1.2 || c.noBreach || (ex >= ez) !== horiz) continue;
        const cface = horiz ? (c.minZ + c.maxZ) * 0.5 : (c.minX + c.maxX) * 0.5;
        if (Math.abs(cface - face) > 0.9) continue;
        const sx = Math.max(c.minX, Math.min(c.maxX, wp.x));
        const sz = Math.max(c.minZ, Math.min(c.maxZ, wp.z));
        if (Math.hypot(wp.x - sx, wp.z - sz) > best + 0.75) continue;
        band0 = Math.min(band0, y0); band1 = Math.max(band1, y1);
      }
      return { x: wp.x, y: Math.min(band1 - 1.2, Math.max(band0 + 3.0, band0 + (band1 - band0) * 0.46)), z: wp.z };
    }
    let floor = 0;
    try { floor = CBZ.floorAt ? +CBZ.floorAt(wp.x, wp.z) : 0; } catch (e) { floor = 0; }
    if (!isFinite(floor)) floor = 0;
    // Roofs/raised terrain stay real target surfaces; flat streets get a low
    // seat. The shared detonation then decides ground-coupled vs elevated FX.
    return { x: wp.x, y: Math.max(0.8, floor + 0.65), z: wp.z };
  }
  function firePatriot(rec) {
    if (!rec || rec.fireCD > 0 || !CBZ.cityFireMissileAt) return false;
    const rig = rigOf(rec);
    if (!rig) return false;
    const wp = patriotWaypoint();
    if (!wp) {
      note("Open the map and designate a Patriot impact point.", 2.4);
      if (CBZ.fullMap && CBZ.fullMap.open) { try { CBZ.fullMap.open(); } catch (e) {} }
      return false;
    }
    if (rig.loaded <= 0) { note("Launcher empty.", 1.8); return false; }
    if (!rig.launcherReady()) { note("Raising the launcher.", 1.2); return false; }
    let slot = -1;
    for (let i = 0; i < rig.muzzles.length; i++) if (rig.roundLoaded(i)) { slot = i; break; }
    if (slot < 0) return false;
    rig.launcherMuzzle(slot, _patriotMuzzle);
    const fired = CBZ.cityFireMissileAt(_patriotMuzzle.x, _patriotMuzzle.y, _patriotMuzzle.z,
      patriotTarget(wp), { byPlayer: true, site: "armor:patriot-map" });
    if (!fired) { note("Launch rail busy.", 1.4); return false; }
    rig.spend(slot);
    rec.fireCD = 1.55;
    if (CBZ.shake) { try { CBZ.shake(0.45); } catch (e) {} }
    if (CBZ.cityCrime) { try { CBZ.cityCrime(180, { x: rec.pos.x, z: rec.pos.z, type: "missile-launch" }); } catch (e) {} }
    note("Missile away · " + Math.round(Math.hypot(wp.x - rec.pos.x, wp.z - rec.pos.z)) + " m", 1.8);
    return true;
  }

  // ROCKET ARTILLERY. The pod aims where you look (the map waypoint wins if
  // one is set): azimuth to the point, elevation from its range. A click
  // RIPPLES every loaded tube, one round every 0.4 s, each onto its own spot
  // of a fixed spread pattern round the aim point, through the same lofted
  // cityFireMissileAt flight and detonate() the Patriot uses. Empty pod
  // reloads after spec.launcher.reload seconds in the seat.
  const SPREAD = [[0, 0], [11, 5], [-9, 7], [5, -10], [-6, -8], [12, -4]];
  // Without a waypoint the pod lays on the camera: bearing from cam.yaw,
  // RANGE from how far up you look — the default chase framing is ~150 m,
  // the horizon is 1.4 km. (A ground ray off a chase cam lands a few metres
  // in front of the truck, which is not an artillery range.)
  function mlrsAimPoint(rec) {
    const wp = patriotWaypoint();
    if (wp) return { x: wp.x, z: wp.z, map: true };
    if (!CBZ.cam) return null;
    const yaw = CBZ.cam.yaw + Math.PI, pitch = CBZ.cam.pitch || 0;
    const up = 1 - Math.max(0, Math.min(1, pitch / 0.55));
    const r = 120 + Math.pow(up, 1.5) * 1280;
    return { x: rec.pos.x + Math.sin(yaw) * r, z: rec.pos.z + Math.cos(yaw) * r, map: false };
  }
  function fireMLRS(rec) {
    const rig = rigOf(rec);
    if (!rig || rec._ripple || rec.fireCD > 0 || !CBZ.cityFireMissileAt) return false;
    if (rig.loaded <= 0) { note(rec._reloadT > 0 ? "Reloading · " + Math.ceil(rec._reloadT) + " s" : "Pod empty.", 1.6); return false; }
    if (!rig.launcherReady(0.25)) { note("Elevating the pod.", 1.2); return false; }
    const aim = mlrsAimPoint(rec);
    if (!aim) return false;
    rec._ripple = { t: 0, k: 0, aim: aim };
    if (CBZ.cityCrime) { try { CBZ.cityCrime(200, { x: rec.pos.x, z: rec.pos.z, type: "missile-launch" }); } catch (e) {} }
    note("Ripple · " + rig.loaded + " rockets · " + Math.round(Math.hypot(aim.x - rec.pos.x, aim.z - rec.pos.z)) + " m", 1.8);
    return true;
  }
  const _rk = new THREE.Vector3();
  function rippleStep(rec, rig) {
    const R = rec._ripple;
    let slot = -1;
    for (let i = 0; i < rig.muzzles.length; i++) if (rig.roundLoaded(i)) { slot = i; break; }
    if (slot < 0) { rec._ripple = null; rec._reloadT = rig.spec.launcher.reload; rec.fireCD = 0.8; return; }
    const off = SPREAD[R.k % SPREAD.length];
    const range = Math.hypot(R.aim.x - rec.pos.x, R.aim.z - rec.pos.z), k = Math.max(0.5, Math.min(2.2, range / 500));
    const tx = R.aim.x + off[0] * k, tz = R.aim.z + off[1] * k;
    let ty = 0.8;
    try { ty = Math.max(0.8, (CBZ.floorAt ? +CBZ.floorAt(tx, tz) || 0 : 0) + 0.65); } catch (e) {}
    rig.launcherMuzzle(slot, _rk);
    const ok = CBZ.cityFireMissileAt(_rk.x, _rk.y, _rk.z, { x: tx, y: ty, z: tz },
      { byPlayer: true, site: "armor:mlrs", fxKind: "rpg" });
    if (!ok) { R.t = 0.12; return; }            // pool full: the next tube waits a beat
    rig.spend(slot);
    R.k++;
    R.t = rig.spec.launcher.ripple || 0.4;
    if (CBZ.shake) { try { CBZ.shake(0.3); } catch (e) {} }
    sfx("whoosh");
  }

  CBZ.cityPatriotAudit = function () {
    const trucks = props.filter(function (v) { return v && v.kind === "patriot"; });
    const flight = CBZ.cityPatriotMissileAudit ? CBZ.cityPatriotMissileAudit() : null;
    let tubes = 0, visibleRounds = 0;
    for (let i = 0; i < trucks.length; i++) {
      const rig = rigOf(trucks[i]);
      if (!rig) continue;
      tubes += rig.muzzles.length;
      visibleRounds += rig.loaded;
    }
    return {
      flag: !CBZ.CONFIG || CBZ.CONFIG.PATRIOT_V1 !== false,
      trucks: trucks.length, tubes: tubes, visibleRounds: visibleRounds,
      commanding: !!(armor && armor.kind === "patriot"),
      hasMapTarget: !!patriotWaypoint(), launches: flight ? flight.launches : 0,
      impacts: flight ? flight.impacts : 0, sharedPool: !!(flight && flight.sharedPool),
    };
  };

  // ---- the ground-drive integration. Order 11.6 = just past the car sim (11)
  //      and before the aircraft sim (12). Owns rec.group + the player transform
  //      while armor is set. Zero per-frame allocation (scratch is hoisted).
  CBZ.onUpdate(11.6, function (dt) {
    if (!armor) return;
    const P = CBZ.player;
    const rec = armor;
    // SAFETY: if the world left "playing"/city, or the player died, force out so
    // a second system never inherits a half-owned player. (death.js takes over on
    // the ground.) Same fail-safe the aircraft sim uses for P.dead.
    if (!P || g.mode !== "city" || g.state !== "playing" || P.dead) { exitArmor(); return; }
    // also bail if a sibling somehow grabbed the player for a car/plane
    if (P._vehicle || P._aircraft) { armor = null; P.driving = false; return; }

    const k = CBZ.keys || {};
    const T = rec._tune || armorTuning(rec);

    // throttle / brake — mirror the car: W accel, S brakes then reverses
    let throttle = 0;
    if (k["w"]) throttle += 1;
    if (k["s"]) throttle -= 1;
    if (throttle > 0) {
      if (rec.v < 0) rec.v += T.brake * dt;
      else rec.v += T.accel * dt * (1 - Math.min(0.7, rec.v / T.top));
    } else if (throttle < 0) {
      if (rec.v > 0.4) rec.v -= T.brake * dt;
      else rec.v -= T.accel * 0.6 * dt;
    } else {
      // coast-down
      if (rec.v > 0) rec.v = Math.max(0, rec.v - T.drag * dt * Math.max(1, rec.v));
      else if (rec.v < 0) rec.v = Math.min(0, rec.v + T.drag * dt * Math.max(1, -rec.v));
    }
    rec.v = Math.max(-T.rev, Math.min(T.top, rec.v));

    // steering — A/D rotate the HULL heading (tracked vehicle: turns in place at
    // low speed, a touch tighter the faster the tracks spin)
    let steer = 0;
    if (k["a"]) steer += 1;
    if (k["d"]) steer -= 1;
    if (steer) {
      const spd = Math.abs(rec.v);
      const rate = T.turn * (0.55 + 0.45 * Math.min(1, spd / 6));    // some turn even when crawling
      rec.heading += steer * rate * dt * (rec.v < 0 ? -1 : 1);
    }

    // integrate position along the hull heading, then collide + clamp to the world
    const fx = Math.sin(rec.heading), fz = Math.cos(rec.heading);
    rec.pos.x += fx * rec.v * dt;
    rec.pos.z += fz * rec.v * dt;
    if (CBZ.cityCollideVehicle) { try { CBZ.cityCollideVehicle(rec); } catch (e) {} }
    clampToCity(rec.pos, rec.footW * 0.5);
    const gy = floorY(rec.pos.x, rec.pos.z, rec.pos.y);
    rec.pos.y = gy;
    rec.group.position.set(rec.pos.x, gy, rec.pos.z);
    rec.group.rotation.set(0, rec.heading, 0);

    // THE MACHINE MOVES WITH ITSELF: tracks/wheels roll by the distance and
    // the heading change this frame (inside track slower, pivot = opposite),
    // front axles steer, the hull squats and rocks on its own pivot.
    const rig = rigOf(rec);
    const omega = dt > 0 ? wrapA(rec.heading - (rec._lastHeading == null ? rec.heading : rec._lastHeading)) / dt : 0;
    rec._lastHeading = rec.heading;
    if (rig) rig.update(dt, rec.v, omega, steer);

    // AIM. A turret follows where the camera looks: yaw from cam.yaw, and the
    // gun ELEVATES with the look (cam.pitch is DOWN-positive — systems/camera
    // .js — so looking up from the default framing raises the barrel).
    if (rig && rig.turret && CBZ.cam) {
      const def = CBZ.CAM_DEFAULT_PITCH != null ? CBZ.CAM_DEFAULT_PITCH : 0.46;
      rig.aimTurret(wrapA(CBZ.cam.yaw + Math.PI - rec.heading), (def - (CBZ.cam.pitch || 0)) * 0.9, dt);
    } else {
      // Launchers: the rack slews to its target and stands up to fire.
      const w = weaponOf(rec);
      if (rig && w === "patriot") {
        const wp = patriotWaypoint();
        rig.aimLauncher(wp ? Math.atan2(wp.x - rec.pos.x, wp.z - rec.pos.z) - rec.heading : null,
          wp ? rig.spec.launcher.elevMax : 0, dt);
      } else if (rig && w === "mlrs") {
        const aim = rec._ripple ? rec._ripple.aim : mlrsAimPoint(rec);
        if (aim) {
          const range = Math.hypot(aim.x - rec.pos.x, aim.z - rec.pos.z);
          rig.aimLauncher(Math.atan2(aim.x - rec.pos.x, aim.z - rec.pos.z) - rec.heading,
            0.30 + Math.min(1, range / 1400) * 0.65, dt);
        }
      }
      if (CBZ.cam && CBZ.lerpAngle && Math.abs(rec.v) > 0.3 && w !== "mlrs" &&
          !(CBZ.camRecenterSuspended && CBZ.camRecenterSuspended())) {
        // no turret: frame it like a car — ease the chase cam back BEHIND the
        // hull while it rolls (CLAUDE.md: recenter writers respect
        // camRecenterSuspended, so a deliberate glance is never fought).
        CBZ.cam.yaw = CBZ.lerpAngle(CBZ.cam.yaw, rec.heading + Math.PI, 1 - Math.pow(0.2, dt));
      }
    }

    // bursts and ripples run on the sim clock, one round per beat
    if (rec._burst && rig) {
      rec._burst.t -= dt;
      while (rec._burst && rec._burst.t <= 0) {
        burstRound(rec, rig, rec._burst.B);
        rec._burst.left--;
        if (rec._burst.left <= 0) rec._burst = null;
        else rec._burst.t += rec._burst.B.gap;
      }
    }
    if (rec._ripple && rig) {
      rec._ripple.t -= dt;
      if (rec._ripple.t <= 0) rippleStep(rec, rig);
    }
    if (rec._reloadT > 0 && rig) {
      rec._reloadT -= dt;
      if (rec._reloadT <= 0) { rec._reloadT = 0; rig.reload(); note("Pod reloaded.", 1.4); }
    }

    if (rec.fireCD > 0) rec.fireCD = Math.max(0, rec.fireCD - dt);

    // own the player transform so physics (bails on P.driving) + the chase-cam
    // (follows player.pos + cam.yaw) both track the hull. The chase cam steers
    // its OWN framing off cam.yaw which the mouse drives, so we leave cam.yaw to
    // the player (it doubles as the turret aim) — a GTA tank: hull by A/D, aim by
    // mouse, camera behind the hull's general facing via the lazy cam follow.
    P.pos.set(rec.pos.x, gy, rec.pos.z);
    P.speed = Math.abs(rec.v);
    P.vy = 0; P.grounded = true;
    if (CBZ.playerChar && CBZ.playerChar.group) {
      CBZ.playerChar.group.position.copy(P.pos);
      CBZ.playerChar.group.visible = false;
    }
  });

  // ============================================================
  //  RESET — chain onto CBZ.cityVehiclesReset (mode.js fires it on every fresh
  //  run) so a new run drops us out of any armor. The island itself is persistent
  //  across city/prison hand-offs, so its boardable records must remain registered;
  //  otherwise the one-shot island registrars have nothing to hand back and the
  //  airport fleet becomes scenery after the first reset. Prune only records whose
  //  world group was actually removed by a landmass rebuild.
  // ============================================================
  function teardown() {
    if (armor) {
      const P = CBZ.player;
      if (P) { P.driving = false; P._aircraft = null; }
      if (_restoreChar && CBZ.playerChar && CBZ.playerChar.group && P) CBZ.playerChar.group.visible = !P.dead;
      try { restoreParkedCollider(armor); } catch (e) {}  // hull solidifies where the run left it
      armor = null; _restoreChar = false;
    }
    for (let i = props.length - 1; i >= 0; i--) {
      const rec = props[i];
      if (!rec || !rec.group || !rec.group.parent) props.splice(i, 1);
    }
  }
  CBZ.cityMilitaryVehiclesReset = teardown;

  function bindResetChain() {
    if (CBZ.cityVehiclesReset && !CBZ.cityVehiclesReset._milVehWrapped) {
      const orig = CBZ.cityVehiclesReset;
      const wrapped = function () { try { teardown(); } catch (e) {} return orig.apply(this, arguments); };
      // WRAPPER DISCIPLINE (CLAUDE.md): carry EVERY `*Wrapped` marker forward.
      // Without this, whichever sibling wrapped cityVehiclesReset before us
      // lost its own idempotence guard and re-wrapped on the next retry tick,
      // stacking a fresh layer of the same reset every few frames.
      for (const k in orig) if (k.endsWith("Wrapped")) wrapped[k] = orig[k];
      wrapped._milVehWrapped = true;
      CBZ.cityVehiclesReset = wrapped;
      return true;
    }
    return false;
  }
  // vehicles.js may load before or after us; try now, else on the first ticks,
  // and also retry the interaction wire-in (the registry exists by load order,
  // but guard anyway so a different load order still wires cleanly).
  wireInteraction();
  if (!bindResetChain() || !wireInteraction._done) {
    CBZ.onUpdate(14.6, function () {
      if (!CBZ.cityVehiclesReset || !CBZ.cityVehiclesReset._milVehWrapped) bindResetChain();
      if (!wireInteraction._done) wireInteraction();
    });
  }

  // ordnance-bus adoption, declared at LOAD (CBZ.blastAudit()).
  (CBZ.ordnanceBusSites = CBZ.ordnanceBusSites || []).push("armor:tank-fallback");

  // WALK-IN HOLD adoption (city/vehicle_hold.js), the CBZ.heliFleet pattern: a
  // fleet owner pushes ONE census function and every hold in the world — this
  // cargo plane's, the semi's trailer when that wave lands — can strap any of
  // its machines down. No per-vehicle registration, no trigger volumes, no
  // state of our own. Feature-detected; without the file this line is inert.
  if (CBZ.vehicleHoldWatch) CBZ.vehicleHoldWatch(function () { return props; });
})();
