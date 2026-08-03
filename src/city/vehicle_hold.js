/* ============================================================
   city/vehicle_hold.js — THE WALK-IN HOLD: a ROOM inside a vehicle.

   OWNER, verbatim: "i want you to make a cargo plane where you can open and
   close the back and even a tank can drive into the back — but like elevators
   it must actually have a back of plane that exists, so other players (when
   multiplayer exists) can be inside the plane like a room. this opens the door
   to rocketship logic and more."

   Read that twice, because the second clause is the whole spec. Not "a boarding
   animation that puts a tank icon on your plane". A ROOM. It exists whether or
   not you are looking at it, it keeps existing while the vehicle moves, and
   anything standing in it — a body, a tank, a duffel of bank money — is still
   standing in it when the vehicle lands somewhere else.

   WHAT WAS ALREADY HERE, AND WHY NONE OF IT WAS THIS
   --------------------------------------------------
   • systems/platforms_moving.js is the moving-room primitive, and it is the
     right one — but it carries exactly ONE rider, the player, and it knows
     nothing about doors, vehicles or freight.
   • entities/npclife.js attach()/syncAttached() rides BODIES inside a moving
     group, and does it properly (the transform is re-asserted every frame).
   • city/aircraft_doors.js is the elevator-grammar door arc: walk → open →
     step → handover → close. It had four door kinds and no RAMP.
   • city/island_airport.js's airliner cabin is a real walkable interior — and
     its deck is a WORLD-SPACE AABB computed once at board time that never
     updates, which is why you can only walk that cabin while it is parked.
     (movingPlatformAudit() has been counting that defect for weeks.)
   • vehicle-inside-vehicle: nothing. Zero. It had never been done.

   So this file writes the ONE thing missing and reuses all four of the above.
   It contains no surface mathematics, no collision resolver, no seat solver and
   no door easing of its own. What it owns is the ROOM: the declaration, the
   ramp's phased arc, and the LATCH.

   ============================================================
   THE ADOPTION CONTRACT — read this before writing a second one
   ============================================================
   ONE call. A hold belongs to any vehicle with a group and a pose; nothing in
   here says "aircraft", which is deliberate — the semi-truck / van wave, and a
   rocket's payload bay after it, adopt with exactly this and nothing else:

     const hold = CBZ.vehicleHold(rec, {
       id:    "semi-trailer",
       label: "Trailer",
       floor: { x: 0, z: -3.2, w: 2.5, d: 12.0, top: 1.15 },   // LOCAL metres
       roof:  3.4,
       walls: [ {x:-1.3, z:-3.2, w:0.2, d:12, y0:1.15, y1:3.4},
                {x: 1.3, z:-3.2, w:0.2, d:12, y0:1.15, y1:3.4},
                {x: 0,   z: 3.0, w:2.7, d:0.2, y0:1.15, y1:3.4} ],
       ramp:  { node: tailgateGroup, w: 2.4, len: 2.6,
                sillZ: -9.2, sillTop: 1.15, closedRx: 1.45, openRx: -0.44 },
     });

   `rec` may be a boardable record ({group, pos, heading}) or a bare Object3D.
   Coordinates are the HOST GROUP'S LOCAL FRAME in model units; a group with a
   uniform scale is handled for you (spec.scale overrides the detection).
   Everything is optional except `floor`. Degrade-safe by construction:

     CBZ.vehicleHold ? CBZ.vehicleHold(rec, spec) : null

   and every consumer already writes `hold && hold.open()`.

   WHAT YOU GET FOR THAT ONE CALL
     · a real walk-in floor that stays correct at any heading, pitch or roll
     · hull walls that stay solid while the vehicle moves
     · a rear ramp with a phased open/close arc, a walkable slope while it is
       down, an interaction verb on foot AND a touch pill (the shared layer —
       no second input path), and door audio
     · VEHICLES that drive in and latch (see THE LATCH below)
     · CARGO that stays put — any Object3D, or any {x,y,z,mesh} record, which
       is exactly the shape inventory.js's cash duffels already have
     · NPCs aboard, through npcLife.attach — no bespoke occupant system
     · a line in CBZ.holdAudit()

   ============================================================
   THE LATCH — what "a tank drove into the back" actually means
   ============================================================
   Two regimes, and picking the wrong one is the whole difficulty:

   LOOSE (driving). While the player is at that vehicle's controls it owns its
   own pose completely; we do not touch it. It drives up the ramp because the
   ramp is a real walk surface and the ground query the drive sim already makes
   now consults CBZ.mpGroundAt — the SAME query the player's feet use. There is
   no "boarding" state and no trigger volume to fall out of.

   LATCHED (strapped). The moment it stops moving inside the hold volume — the
   driver got out, or it was never crewed — it is strapped down: we record its
   pose in the HOST'S LOCAL FRAME and re-assert it from the host's live world
   matrix every frame. Full pose, not a delta: a latched tank rolls and pitches
   with the airframe, which is what a chained load does and what a delta carry
   could never give you. It unlatches the instant somebody takes its controls.

   WHY NOT REPARENT THE TANK INTO THE PLANE (the obvious answer): because
   `rec.pos` IS `rec.group.position` for every boardable in this engine, and a
   dozen systems — interaction distance, the collider restore, missile
   acquisition, the minimap — read it as WORLD space. Reparenting silently turns
   all of them into liars. npcLife can reparent a BODY because it owns the whole
   life cycle of one; a boardable vehicle is shared property. So the group stays
   in world space and we write its world pose from the host's matrix, which is
   arithmetically the same picture and breaks nothing.

   FLAGS  CBZ.CONFIG.VEHICLE_HOLD_V1 (default true) — one-line revert; every
          hold goes inert and the vehicles fly with an empty back.
          CBZ.CONFIG.VEHICLE_HOLD_AUTOLATCH (default true) — the sweep only.

   AUDIT  CBZ.holdAudit()
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const CF = CBZ.CONFIG || (CBZ.CONFIG = {});
  if (CF.VEHICLE_HOLD_V1 == null) CF.VEHICLE_HOLD_V1 = true;
  if (CF.VEHICLE_HOLD_AUTOLATCH == null) CF.VEHICLE_HOLD_AUTOLATCH = true;

  function on() { return CF.VEHICLE_HOLD_V1 !== false; }
  function inCity() { return CBZ.game && CBZ.game.mode === "city"; }

  const holds = [];
  const watchers = [];          // census fns -> [vehicleRec, ...] eligible to latch
  let arcsRun = 0, latchTally = 0, cargoTally = 0, orphaned = 0;

  // ---- scratch (zero per-frame allocation in the tick) ----------------------
  const _m = new THREE.Matrix4();
  const _mi = new THREE.Matrix4();
  const _p = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3();
  const _v = new THREE.Vector3();
  const _q2 = new THREE.Quaternion();
  const _e = new THREE.Euler(0, 0, 0, "YXZ");
  const _IDENT = new THREE.Matrix4();

  function sfx(n) { if (CBZ.sfx) { try { CBZ.sfx(n); } catch (e) {} } }
  function note(m, s) { if (CBZ.city && CBZ.city.note) { try { CBZ.city.note(m, s); } catch (e) {} } }

  // The host's live world matrix WITHOUT walking its whole subtree. A cargo
  // plane is ~200 meshes; updateMatrixWorld(true) on it every frame to read one
  // transform would be the sort of quiet cost this repo keeps finding in itself.
  function hostMatrix(grp, out) {
    grp.updateMatrix();
    const par = grp.parent;
    if (par && par.matrixWorld) out.multiplyMatrices(par.matrixWorld, grp.matrix);
    else out.copy(grp.matrix);
    return out;
  }

  // ============================================================
  //  ONE HOLD
  // ============================================================
  function makeHold(host, spec) {
    const grp = host && host.isObject3D ? host : (host && host.group);
    if (!grp || !grp.isObject3D || !spec || !spec.floor) return null;
    const rec = host && !host.isObject3D ? host : null;

    // A uniformly-scaled model (island_military authors its bomber at 1.5)
    // publishes local numbers in MODEL units, but platforms_moving works in the
    // parent's frame — where those numbers are scaled. Detect it once instead of
    // making every caller remember, which is how the airliner's cab.scale bug
    // class starts.
    const sc = spec.scale != null ? +spec.scale : ((grp.scale && grp.scale.x) || 1) || 1;
    const F = spec.floor;
    const floor = {
      id: "floor",
      x: (+F.x || 0) * sc, z: (+F.z || 0) * sc,
      w: Math.abs(+F.w || 0) * sc, d: Math.abs(+F.d || 0) * sc,
      top: (+F.top || 0) * sc,
    };
    const roof = (spec.roof != null ? +spec.roof : (F.top + 2.6)) * sc;

    // ---- the ramp, in the host's (scaled) local frame -----------------------
    const R = spec.ramp || null;
    const ramp = R ? {
      node: R.node || null,
      w: Math.abs(+R.w || floor.w / sc) * sc,
      len: Math.abs(+R.len || 3) * sc,
      x: (+R.x || 0) * sc,
      sillZ: (R.sillZ != null ? +R.sillZ : (F.z - F.d / 2)) * sc,
      sillTop: (R.sillTop != null ? +R.sillTop : +F.top) * sc,
      // Sign convention: the ramp node hangs at the sill and rotates about local
      // X. closedRx stands it up across the aperture, openRx lays it down aft.
      // The DOWN-angle we do geometry with is simply -rotation.x.
      closedRx: R.closedRx != null ? +R.closedRx : 1.30,
      openRx: R.openRx != null ? +R.openRx : -0.30,
      seconds: R.seconds != null ? +R.seconds : 2.6,
      // aft is -Z by this engine's aircraft convention (nose +Z); a host whose
      // tail points the other way declares dir:+1.
      dir: R.dir === 1 ? 1 : -1,
    } : null;

    const H = {
      id: spec.id || ("hold" + holds.length),
      label: spec.label || spec.id || "Hold",
      grp: grp, rec: rec, spec: spec, scale: sc,
      floor: floor, roof: roof, ramp: ramp,
      rampT: ramp ? 0 : 1,          // no ramp declared = permanently open room
      rampWant: ramp ? 0 : 1,
      phase: ramp ? "closed" : "open",
      rig: null, rampDeck: null,
      vehicles: [], cargo: [], actors: [],
      alive: true, sweepT: 0,
      lastRx: null,
    };

    // ---- THE ONE RIG. Floor + ramp + hull walls are all the same primitive --
    const decks = [{ id: "floor", x: floor.x, z: floor.z, w: floor.w, d: floor.d, top: floor.top }];
    if (ramp) {
      // Declared at its FULLY OPEN extent (that is the widest footprint the
      // broad-phase radius must cover) and stowed until the arc lowers it.
      const toeZ = ramp.sillZ + ramp.dir * ramp.len;
      decks.push({
        id: "ramp", off: true,
        x: ramp.x, z: (ramp.sillZ + toeZ) / 2, w: ramp.w, d: Math.abs(ramp.len),
        top: ramp.sillTop,
        ramp: { axis: "z", z0: toeZ, y0: 0.02 * sc, z1: ramp.sillZ, y1: ramp.sillTop },
      });
    }
    const walls = [];
    if (spec.walls) {
      for (let i = 0; i < spec.walls.length; i++) {
        const w = spec.walls[i]; if (!w) continue;
        walls.push({
          x: (+w.x || 0) * sc, z: (+w.z || 0) * sc,
          w: Math.abs(+w.w || 0) * sc, d: Math.abs(+w.d || 0) * sc,
          y0: w.y0 != null ? +w.y0 * sc : null,
          y1: w.y1 != null ? +w.y1 * sc : 0,
        });
      }
    }
    H.rig = CBZ.movingPlatform ? CBZ.movingPlatform(grp, {
      id: "hold:" + H.id,
      decks: decks,
      walls: walls.length ? walls : null,
      // A hold's floor is a floor: carry the standing body, revolve it about the
      // pivot, follow the airframe's pitch and roll. The camera is NOT yawed —
      // platforms_moving's note 3, and a banking aeroplane is the single worst
      // place to grab a player's mouse.
      riders: true, yaw: true, camYaw: false, bodyYaw: true, tilt: true,
      onLeave: "upward",
      // THE FLOOR MOVES WHEN THE VEHICLE DOES, NOT A FRAME LATER. Every rig
      // platforms_moving was written for is moved by an owner that ticks
      // before its 9.5 pass; a HOST VEHICLE is moved at 11 (cars), 11.6
      // (armour) or 12 (flight), so the default pass latches a pose that is
      // one whole frame stale. See THE THREE BEATS below.
      late: true,
    }) : null;
    H.rampDeck = H.rig && H.rig.deck ? H.rig.deck("ramp") : null;

    if (ramp && ramp.node) poseRampNode(H, 0);
    holds.push(H);
    return H;
  }

  function easeT(t) { return t * t * (3 - 2 * t); }

  function poseRampNode(H, t) {
    const R = H.ramp; if (!R || !R.node) return;
    const rx = R.closedRx + (R.openRx - R.closedRx) * easeT(t);
    if (H.lastRx === rx) return;
    H.lastRx = rx;
    R.node.rotation.x = rx;
    R.node.visible = true;
  }

  // Keep the walkable slope honest against the ramp's ACTUAL angle rather than
  // against `rampT`. The deck switches on the moment the slab reaches horizontal
  // and its geometry tracks the swing from there, so walking onto a ramp that is
  // still settling puts you on the real surface, at the real height, and rides
  // it the rest of the way down.
  function syncRampDeck(H) {
    const d = H.rampDeck, R = H.ramp;
    if (!d || !R) return;
    const rx = R.closedRx + (R.openRx - R.closedRx) * easeT(H.rampT);
    const a = -rx;                                  // down-angle from horizontal
    if (a < -0.04) { d.off = true; return; }
    const ca = Math.cos(a), sa = Math.sin(a);
    const toeZ = R.sillZ + R.dir * R.len * ca;
    const toeY = R.sillTop - R.len * sa;
    d.off = false;
    d.x = R.x; d.hw = R.w / 2;
    d.z = (R.sillZ + toeZ) / 2; d.hd = Math.abs(R.sillZ - toeZ) / 2 + 0.001;
    d.ramp.z0 = toeZ; d.ramp.y0 = toeY;
    d.ramp.z1 = R.sillZ; d.ramp.y1 = R.sillTop;
  }

  // ---- is this WORLD point inside the room? -------------------------------
  // Yaw-only footprint (platforms_moving's own localOf) plus a real vertical
  // band. That is the answer callers want and it costs four multiplies.
  const _lo = { x: 0, y: 0, z: 0 };
  function containsLocal(H, x, y, z, pad, below) {
    if (!H.rig || H.rig.inert) return null;
    const l = H.rig.localOf(x, y, z, _lo);
    const p = pad || 0;
    const F = H.floor;
    if (l.x < F.x - F.w / 2 - p || l.x > F.x + F.w / 2 + p) return null;
    if (l.z < F.z - F.d / 2 - p || l.z > F.z + F.d / 2 + p) return null;
    if (y != null && (l.y < F.top - (below || 1.2) || l.y > H.roof + 1.0)) return null;
    return l;
  }

  // ============================================================
  //  LATCHING
  // ============================================================
  function localPoseOf(H, grp) {
    hostMatrix(H.grp, _m);
    _mi.copy(_m).invert();
    grp.updateMatrix();
    // the latched group lives in the SAME parent as the host (city root), so its
    // own local matrix is already the world one for our purposes; be exact anyway
    const par = grp.parent;
    if (par && par.matrixWorld) _m.multiplyMatrices(par.matrixWorld, grp.matrix);
    else _m.copy(grp.matrix);
    _m.premultiply(_mi);
    const out = { p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3() };
    _m.decompose(out.p, out.q, out.s);
    return out;
  }

  function reassert(H, ent) {
    const grp = ent.grp;
    if (!grp || !grp.parent) return false;
    hostMatrix(H.grp, _m);
    _m.decompose(_p, _q, _s);
    _v.copy(ent.local.p).applyMatrix4(_m);
    if (ent.kind === "cargo") {
      setCargoPose(ent, _v.x, _v.y, _v.z);
      if (grp.quaternion) grp.quaternion.copy(_q2.copy(_q).multiply(ent.local.q));
      return true;
    }
    grp.position.set(_v.x, _v.y, _v.z);
    grp.quaternion.copy(_q2.copy(_q).multiply(ent.local.q));
    const r = ent.rec;
    if (r) {
      if (r.pos && r.pos !== grp.position) { r.pos.x = _v.x; r.pos.y = _v.y; r.pos.z = _v.z; }
      _e.setFromQuaternion(grp.quaternion, "YXZ");
      r.heading = _e.y;
      if (r.v != null) r.v = 0;
    }
    return true;
  }

  // Cargo is deliberately duck-typed. An Object3D works; so does inventory.js's
  // cash duffel, which is a plain {x, y, z, mesh, air} record — because a bag
  // from a bank job landing in a plane's hold is the owner's OTHER half of this
  // ask, and making that wave publish an Object3D just to be liftable would be
  // the tail wagging the dog.
  function setCargoPose(ent, x, y, z) {
    const o = ent.obj;
    if (o.isObject3D) { o.position.set(x, y, z); return; }
    o.x = x; o.y = y; o.z = z;
    if (o.air) o.air = false;                    // a strapped load is not in flight
    if (o.vx != null) { o.vx = 0; o.vy = 0; o.vz = 0; }
    if (o.mesh && o.mesh.position) o.mesh.position.set(x, y, z);
  }
  function cargoGroup(o) {
    if (!o) return null;
    if (o.isObject3D) return o;
    if (o.mesh && o.mesh.isObject3D) return o.mesh;
    if (o.group && o.group.isObject3D) return o.group;
    return null;
  }

  function latchVehicle(H, rec) {
    if (!on() || !rec) return null;
    const grp = rec.isObject3D ? rec : rec.group;
    if (!grp || !grp.parent) return null;
    if (rec._heldBy) return rec._heldBy === H ? H : null;
    const ent = { kind: "vehicle", rec: rec.isObject3D ? null : rec, grp: grp, local: localPoseOf(H, grp) };
    H.vehicles.push(ent);
    rec._heldBy = H;
    latchTally++;
    return H;
  }
  function latchCargo(H, obj) {
    if (!on() || !obj) return null;
    const grp = cargoGroup(obj);
    if (!grp || (grp.isObject3D && !grp.parent)) return null;
    if (obj._heldBy) return obj._heldBy === H ? H : null;
    const ent = { kind: "cargo", obj: obj, grp: grp, local: localPoseOf(H, grp) };
    H.cargo.push(ent);
    obj._heldBy = H;
    cargoTally++;
    return H;
  }
  function releaseFrom(H, thing) {
    for (let i = H.vehicles.length - 1; i >= 0; i--) {
      const e = H.vehicles[i];
      if (thing == null || e.rec === thing || e.grp === thing) {
        if (e.rec) e.rec._heldBy = null;
        H.vehicles.splice(i, 1);
        if (thing != null) return true;
      }
    }
    for (let i = H.cargo.length - 1; i >= 0; i--) {
      const e = H.cargo[i];
      if (thing == null || e.obj === thing || e.grp === thing) {
        e.obj._heldBy = null;
        H.cargo.splice(i, 1);
        if (thing != null) return true;
      }
    }
    return thing == null;
  }

  // ============================================================
  //  ACTORS ABOARD — one line over npcLife, never a second seat system
  // ============================================================
  function attachActor(H, actor, anchor) {
    if (!actor || !CBZ.npcLife || !CBZ.npcLife.attach) return false;
    anchor = anchor || {};
    const sc = H.scale;
    const ok = CBZ.npcLife.attach(actor, H.grp, {
      x: anchor.x || 0,
      y: anchor.y != null ? anchor.y : H.floor.top / sc,
      z: anchor.z || 0,
      yaw: anchor.yaw || 0,
      pose: anchor.pose || "stand",
      state: anchor.state || (anchor.pose === "sit" ? "sit" : "idle"),
      cushionH: anchor.cushionH,
      floorBelow: anchor.floorBelow,
    });
    if (ok && H.actors.indexOf(actor) < 0) H.actors.push(actor);
    return ok;
  }

  // ============================================================
  //  THE RAMP ARC — the elevator law, applied to the back of a vehicle
  // ============================================================
  // Four phases and no shortcut between them, exactly as city/elevators.js and
  // city/aircraft_doors.js run them: the door is a THING THAT TAKES TIME, you
  // watch it move, and you walk through the opening it makes rather than being
  // placed on the far side of it.
  function setRamp(H, wantOpen) {
    if (!H.ramp) return false;
    const want = wantOpen ? 1 : 0;
    if (H.rampWant === want) return false;
    H.rampWant = want;
    H.phase = want ? "opening" : "closing";
    arcsRun++;
    sfx(want ? "door_open" : "door_close");
    return true;
  }

  function tickRamp(H, dt) {
    const R = H.ramp; if (!R) return;
    if (H.rampT !== H.rampWant) {
      const step = dt / Math.max(0.2, R.seconds);
      if (H.rampWant > H.rampT) H.rampT = Math.min(1, H.rampT + step);
      else H.rampT = Math.max(0, H.rampT - step);
      if (H.rampT === H.rampWant) H.phase = H.rampWant ? "open" : "closed";
      poseRampNode(H, H.rampT);
      syncRampDeck(H);
    }
  }

  // ============================================================
  //  THE THREE BEATS, AND THE ORDER IS THE WHOLE CORRECTNESS ARGUMENT
  // ============================================================
  // A moving room has three jobs and they do NOT want the same side of the
  // frame. Running them together is a measurable bug, not a stylistic choice,
  // and `CBZ.onUpdate` priorities are how this engine says so:
  //
  //   9.4  THE DOOR, BEFORE ANY FLOOR IS READ. The ramp animates ahead of
  //        everything, so the deck record the physics seam serves at 10 is
  //        this frame's hinge angle and nobody ever stands on last frame's
  //        ramp. The housekeeping sweep rides along here.
  //
  //  12.7  THE LOAD, AFTER THE CARRIER HAS MOVED. Strapped freight is written
  //        from the host's live matrix, so it must run AFTER whatever moved the
  //        host: the car sim (11), the armor sim (11.6), the flight sim (12)
  //        and the pilot pass (12.5) — and before npclife's syncAttached (33.8)
  //        re-seats the bodies. MEASURED with this at 9.4 instead: a cargo
  //        plane climbing at ~18 m/s left its chained tank 0.3 m of lag per
  //        frame, so the load visibly floated off the deck in the climb. The
  //        latch is exact; the ORDER was what made it look sloppy.
  //
  //  12.8  THE FLOOR AND THE BODY ON IT — systems/platforms_moving.js's LATE
  //        pass, which this file's rigs opt into with `late: true`. It is the
  //        SAME fault as 12.7 and the half that was still live: that file's
  //        default pass latches at 9.5 because everything it was written for
  //        (yachts 9.45, water hulls 9.4, marina 9.3) moves before it, and a
  //        HOST VEHICLE does not. Measured on this lifter at 95 m/s: 1.58 m of
  //        deck slid out from under a standing rider every single frame. Fixed
  //        where the ordering lives rather than by chasing the symptom with a
  //        correction term.
  //
  // A machine whose driver takes the controls is released by the controller
  // itself (militaryvehicles.js driveArmor), so the two never both write it.
  let carriedFrames = 0;
  CBZ.onUpdate(9.4, function (dt) {
    if (!on() || !holds.length) return;
    if (!(dt > 0)) dt = 1 / 60;
    const city = inCity();
    for (let i = holds.length - 1; i >= 0; i--) {
      const H = holds[i];
      if (!H.grp || !H.grp.parent) {
        // A landmass rebuild took the host out of the scene. Release everything
        // rather than re-asserting poses off a dead matrix, and drop the rig.
        if (H.alive) {
          H.alive = false; orphaned++;
          releaseFrom(H, null);
          if (H.rig && H.rig.release) H.rig.release();
        }
        holds.splice(i, 1);
        continue;
      }
      if (!city) continue;
      tickRamp(H, dt);
      H.sweepT -= dt;
      if (H.sweepT <= 0) { H.sweepT = 0.3; if (CF.VEHICLE_HOLD_AUTOLATCH !== false) sweep(H); }
    }
  });

  CBZ.onUpdate(12.7, function () {
    if (!on() || !holds.length || !inCity()) return;
    for (let i = 0; i < holds.length; i++) {
      const H = holds[i];
      if (!H.alive || !H.grp || !H.grp.parent) continue;
      for (let k = H.vehicles.length - 1; k >= 0; k--) {
        const e = H.vehicles[k];
        if (!e.grp.parent || (e.rec && e.rec._heldBy !== H)) { if (e.rec) e.rec._heldBy = null; H.vehicles.splice(k, 1); continue; }
        if (reassert(H, e)) carriedFrames++;
      }
      for (let k = H.cargo.length - 1; k >= 0; k--) {
        const e = H.cargo[k];
        const gone = e.grp && e.grp.isObject3D && !e.grp.parent;
        // `carried` is the live "in somebody's hands" flag. Deliberately NOT
        // `held`, which inventory.js uses as a HISTORICAL marker ("this money
        // has been in the player's hands at some point", read by bagsHeldFrom)
        // — releasing on that would unstrap every duffel the player had ever
        // picked up the instant it touched a deck.
        if (gone || e.obj._heldBy !== H || e.obj.carried === true) {
          e.obj._heldBy = null; H.cargo.splice(k, 1); continue;
        }
        if (reassert(H, e)) carriedFrames++;
      }
      for (let k = H.actors.length - 1; k >= 0; k--) {
        const a = H.actors[k];
        if (!a || !a._npcAttached || a._npcAttached.parent !== H.grp) H.actors.splice(k, 1);
      }
    }
  });

  function driverOf(rec) {
    // "somebody has the controls of this machine right now" — asked of the two
    // controllers that can own one, both feature-detected.
    if (!rec) return false;
    if (CBZ.cityArmorRec && CBZ.cityArmorRec() === rec) return true;
    const P = CBZ.player;
    if (P && P._vehicle && (P._vehicle === rec || P._vehicle.group === rec.group)) return true;
    if (rec.group && rec.group.userData && rec.group.userData.craft) return true;
    return false;
  }

  function sweep(H) {
    // never strap a load to a vehicle whose own back door is shut on nothing,
    // and never while the ramp is mid-swing (the geometry is still moving)
    if (H.phase === "opening" || H.phase === "closing") return;
    for (let w = 0; w < watchers.length; w++) {
      let list = null;
      try { list = watchers[w](); } catch (e) { list = null; }
      if (!list || !list.length) continue;
      for (let i = 0; i < list.length; i++) {
        const rec = list[i];
        if (!rec || rec === H.rec || rec._heldBy || rec.destroyed) continue;
        const grp = rec.group; if (!grp || !grp.parent || grp === H.grp) continue;
        if (driverOf(rec)) continue;
        if (Math.abs(rec.v || 0) > 0.4) continue;
        const p = rec.pos || grp.position;
        if (!containsLocal(H, p.x, p.y, p.z, -0.35)) continue;
        latchVehicle(H, rec);
        note(((rec.model && rec.model.name) || "The vehicle") + " is chained down in the " + H.label.toLowerCase() + ".", 2.2);
      }
    }
    /* LOOSE FREIGHT — the cash-duffel wave's records, if that wave has landed.
       The owner's other half of this ask: bank money goes in the hold and gets
       flown to a warehouse.

       THE DUFFEL FALLS THROUGH THE DECK, and catching it is this block. A bag
       set down resolves its rest height with inventory.js's own floorY, which
       is CBZ.floorAt — TERRAIN, with no knowledge of moving decks — so a bag
       dropped in the hold is written to the apron under the aeroplane before we
       ever see it. That file belongs to another wave and it is one line from
       being right (`CBZ.mpGroundAt`, exactly as militaryvehicles.js now does);
       until it takes it, we repair from this side, and the repair is bounded so
       it cannot become a bug of its own: a bag counts as freight only if it is
       within 2.4 m of THIS deck's plane, which is true for a parked aeroplane
       and is never true for a bag lying on the ground under a flying one. */
    const bags = CBZ.cashBags && CBZ.cashBags.list ? safeList(CBZ.cashBags.list) : null;
    if (bags) {
      for (let i = 0; i < bags.length; i++) {
        const b = bags[i];
        if (!b || b._heldBy || b.carried || b.air) continue;
        const l = containsLocal(H, b.x, b.y, b.z, -0.1, 2.4);
        if (!l) continue;
        const sunk = l.y < H.floor.top - 0.05;
        if (!latchCargo(H, b)) continue;
        if (sunk) {                            // put it back on the deck it fell through
          const e = H.cargo[H.cargo.length - 1];
          if (e && e.obj === b) { e.local.p.y = H.floor.top + 0.14; reassert(H, e); }
        }
      }
    }
  }
  function safeList(fn) { try { return fn(); } catch (e) { return null; } }

  // ============================================================
  //  PUBLIC API
  // ============================================================
  function handleFor(H) {
    return {
      id: H.id,
      label: H.label,
      get group() { return H.grp; },
      get phase() { return H.phase; },
      get rampT() { return H.rampT; },
      get open() { return H.rampT > 0.98; },
      get closed() { return H.rampT < 0.02; },
      openRamp() { return setRamp(H, true); },
      closeRamp() { return setRamp(H, false); },
      toggleRamp() { return setRamp(H, H.rampWant < 0.5); },
      contains(x, y, z) { return !!containsLocal(H, x, y, z, 0); },
      // Guarded, not assumed: without systems/platforms_moving.js there is no
      // rig and these must degrade to identity rather than throw — the same
      // contract the INERT handle below honours.
      localOf(x, y, z, out) {
        if (!H.rig) { out = out || {}; out.x = x; out.y = y; out.z = z; return out; }
        return H.rig.localOf(x, y, z, out);
      },
      worldOf(lx, ly, lz, out) {
        if (!H.rig) { out = out || {}; out.x = lx; out.y = ly; out.z = lz; return out; }
        return H.rig.worldOf(lx * H.scale, ly * H.scale, lz * H.scale, out);
      },
      deckTop() { return H.floor.top; },
      latchVehicle(rec) { return !!latchVehicle(H, rec); },
      latchCargo(obj) { return !!latchCargo(H, obj); },
      release(thing) { return releaseFrom(H, thing); },
      attachActor(actor, anchor) { return attachActor(H, actor, anchor); },
      occupants() {
        return {
          vehicles: H.vehicles.length, cargo: H.cargo.length, actors: H.actors.length,
          player: !!(CBZ.player && CBZ.player.pos && containsLocal(H, CBZ.player.pos.x, CBZ.player.pos.y, CBZ.player.pos.z, 0)),
        };
      },
      dispose() {
        H.alive = false;
        releaseFrom(H, null);
        if (H.rig && H.rig.release) H.rig.release();
        const i = holds.indexOf(H); if (i >= 0) holds.splice(i, 1);
      },
      _hold: H,
    };
  }

  const INERT = {
    id: "inert", label: "Hold", group: null, phase: "closed", rampT: 0, open: false, closed: true,
    openRamp() { return false; }, closeRamp() { return false; }, toggleRamp() { return false; },
    contains() { return false; },
    localOf(x, y, z, out) { out = out || {}; out.x = x; out.y = y; out.z = z; return out; },
    worldOf(x, y, z, out) { out = out || {}; out.x = x; out.y = y; out.z = z; return out; },
    deckTop() { return 0; },
    latchVehicle() { return false; }, latchCargo() { return false; }, release() { return false; },
    attachActor() { return false; },
    occupants() { return { vehicles: 0, cargo: 0, actors: 0, player: false }; },
    dispose() {}, inert: true,
  };

  CBZ.vehicleHold = function (host, spec) {
    if (!on()) return INERT;
    const H = makeHold(host, spec);
    if (!H) return INERT;
    const h = handleFor(H);
    H.handle = h;
    // the host record carries its own hold, so every consumer that already has
    // a `rec` (the door arc, the theft path, a mission) needs no lookup table
    if (H.rec) H.rec.hold = h;
    if (H.grp.userData) H.grp.userData.cargoHold = h;
    return h;
  };

  // The hold that owns this group / record / world point.
  CBZ.vehicleHoldOf = function (x) {
    if (!x) return null;
    for (let i = 0; i < holds.length; i++) {
      const H = holds[i];
      if (H.grp === x || H.rec === x || (x.group && H.grp === x.group)) return H.handle;
    }
    return null;
  };
  CBZ.vehicleHoldAt = function (x, y, z) {
    for (let i = 0; i < holds.length; i++) if (containsLocal(holds[i], x, y, z, 0)) return holds[i].handle;
    return null;
  };
  // aircraft_doors.js's ramp beat calls this; so does anything scripted.
  CBZ.vehicleHoldRamp = function (target, wantOpen) {
    const h = CBZ.vehicleHoldOf(target);
    if (!h) return false;
    return wantOpen ? h.openRamp() : h.closeRamp();
  };
  // "this vehicle just came to rest — is it inside somebody's hold?" One call
  // for the ground controllers; returns the hold it latched into, or null.
  CBZ.vehicleHoldLatch = function (rec) {
    if (!on() || !rec) return null;
    const p = rec.pos || (rec.group && rec.group.position);
    if (!p) return null;
    for (let i = 0; i < holds.length; i++) {
      const H = holds[i];
      if (H.rec === rec || H.grp === rec.group) continue;
      if (!containsLocal(H, p.x, p.y, p.z, -0.35)) continue;
      return latchVehicle(H, rec) ? H.handle : null;
    }
    return null;
  };
  CBZ.vehicleHoldRelease = function (thing) {
    if (!thing) return false;
    const H = thing._heldBy;
    if (H) return releaseFrom(H, thing);
    for (let i = 0; i < holds.length; i++) if (releaseFrom(holds[i], thing)) return true;
    return false;
  };
  // A census provider, the CBZ.heliFleet pattern: a fleet owner pushes ONE
  // function and every hold in the world can strap its machines down. The
  // truck/van wave adds its car registry with a single line and is finished.
  CBZ.vehicleHoldWatch = function (fn) { if (typeof fn === "function") watchers.push(fn); return watchers.length; };
  CBZ.vehicleHoldList = function () { const a = []; for (let i = 0; i < holds.length; i++) a.push(holds[i].handle); return a; };

  // ============================================================
  //  THE RAMP VERB — ONE registration for EVERY hold, forever
  // ============================================================
  // Registered here rather than by each consumer, which is the difference
  // between a block and a pile: the semi-truck wave declares a hold and its
  // tailgate verb (and its touch pill, via the shared layer) already exists.
  let wired = false;
  function wireInteraction() {
    if (wired || !CBZ.interactions || !CBZ.interactions.registerSource || !CBZ.interactions.register) return false;
    const I = CBZ.interactions;
    I.registerSource({
      id: "src-vehhold", kind: "vehhold", layers: ["vehhold"], prio: 6, driving: false,
      find: function (px, pz, ctx, push) {
        if (!on() || !holds.length) return;
        const py = ctx && ctx.pos && ctx.pos.y != null ? ctx.pos.y : 0;
        let best = null, bd = Infinity;
        for (let i = 0; i < holds.length; i++) {
          const H = holds[i];
          if (!H.ramp || !H.rig || !H.grp || !H.grp.parent) continue;
          // the control point is the ramp sill — where a loadmaster stands
          const w = H.rig.worldOf(H.ramp.x, H.floor.top, H.ramp.sillZ, _lo);
          const dx = w.x - px, dz = w.z - pz;
          let d = Math.hypot(dx, dz);
          // ...and anywhere inside the room counts, so you can shut the back
          // door behind you without walking to the tail
          if (containsLocal(H, px, py + 0.9, pz, 0)) d = Math.min(d, 1.2);
          if (d < bd && d < 7.5) { bd = d; best = H; }
        }
        if (best) push(best.handle, bd);
      },
    });
    if (I.describe) {
      I.describe("vehhold", function (h) {
        const H = h && h._hold; if (!H) return { label: "Hold" };
        const occ = h.occupants();
        const load = occ.vehicles || occ.cargo
          ? (occ.vehicles ? occ.vehicles + " vehicle" + (occ.vehicles > 1 ? "s" : "") : "") +
            (occ.vehicles && occ.cargo ? " · " : "") +
            (occ.cargo ? occ.cargo + " load" + (occ.cargo > 1 ? "s" : "") : "")
          : "Empty";
        return {
          label: H.label,
          note: (H.phase === "open" ? "Ramp down" : H.phase === "closed" ? "Ramp up" : "Ramp moving") + " · " + load,
        };
      });
    }
    I.register("vehhold", {
      id: "vehhold-ramp", slot: "e",
      label: function (h) {
        const H = h && h._hold;
        if (!H) return "Ramp";
        if (H.phase === "opening") return "Lowering the ramp…";
        if (H.phase === "closing") return "Raising the ramp…";
        return H.rampWant > 0.5 ? "Raise the " + H.label.toLowerCase() + " ramp" : "Lower the " + H.label.toLowerCase() + " ramp";
      },
      enabled: function (h) { const H = h && h._hold; return !!H && H.phase !== "opening" && H.phase !== "closing"; },
      onSelect: function (h) { if (h) h.toggleRamp(); },
    });
    wired = true;
    return true;
  }
  wireInteraction();
  if (!wired) CBZ.onUpdate(14.62, function () { if (!wired) wireInteraction(); });

  // ---- the pilot's ramp switch --------------------------------------------
  // At the controls, city/interactions.js stands the whole interact fabric down
  // (FLIGHT_KEYS_OWNED) — correctly, because a verb panel must never shadow a
  // flight control. So the one thing a pilot genuinely needs from back there
  // gets one key, and only while he is flying something that HAS a hold.
  addEventListener("keydown", function (e) {
    if (e.repeat || !on() || !inCity()) return;
    if ((e.key || "").toLowerCase() !== "r") return;
    const P = CBZ.player;
    const craft = P && P._aircraft;
    if (!craft || !craft.group) return;
    const h = CBZ.vehicleHoldOf(craft.group) || (craft.sourceRec && CBZ.vehicleHoldOf(craft.sourceRec));
    if (!h) return;
    e.preventDefault();
    h.toggleRamp();
    note(h.rampT > 0.5 || h.phase === "closing" ? "Raising the ramp." : "Lowering the ramp.", 1.4);
  });

  // ============================================================
  //  THE RATCHET — CBZ.holdAudit()
  // ============================================================
  // `orphaned` is the honest failure mode: a hold whose host left the scene
  // while it still had loads strapped to it. It is structurally 0 because the
  // tick releases before it drops the rig — pin it there. `holds`/`latched`
  // print beside it so a "fix" that simply stops declaring holds cannot pass.
  CBZ.holdAudit = function () {
    let decks = 0, ramps = 0, openN = 0, veh = 0, crg = 0, act = 0, plr = 0;
    const P = CBZ.player;
    for (let i = 0; i < holds.length; i++) {
      const H = holds[i];
      decks++;
      if (H.ramp) ramps++;
      if (H.rampT > 0.98) openN++;
      veh += H.vehicles.length; crg += H.cargo.length; act += H.actors.length;
      if (P && P.pos && containsLocal(H, P.pos.x, P.pos.y, P.pos.z, 0)) plr++;
    }
    return {
      holds: holds.length, decks: decks, ramps: ramps, rampsOpen: openN,
      vehiclesLatched: veh, cargoLatched: crg, actorsAboard: act,
      playerAboard: plr, watchers: watchers.length,
      rampArcs: arcsRun, latchesEver: latchTally, cargoLatchesEver: cargoTally,
      carriedFrames: carriedFrames, orphaned: orphaned,
      rigBacked: holds.filter(function (H) { return H.rig && !H.rig.inert; }).length,
    };
  };
})();
