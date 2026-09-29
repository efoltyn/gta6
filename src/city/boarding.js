/* ============================================================
   city/boarding.js — A DOOR IS A DOOR, AND A PASSENGER IS A PERSON.

   OWNER, verbatim: "if i have a player hostage or if they are my security,
   when i get into a car i open door, and they also go to car and open door —
   not glitch into car — walk or run from where they are and open the
   passenger door and get in. really make the interior of the car exist like
   buildings with glass where you see npcs from outside. also add the ability
   for me to tell them to get out. this goes for planes too." And from the
   heist loop: "members of your gang/friends/hostages who are with you in the
   vault can help you carry bags and drive the truck to your warehouse...
   then can with them load [the cargo plane] up and fly somewhere else."

   WHAT WAS ACTUALLY WRONG. Every one of those sentences names the same
   defect, which is that the car had no DOOR and its seats held no PEOPLE:

     • `cityEnterVehicle` (vehicles.js) is instant and door-less — the rig
       blinks out and the car is yours. `aircraft_doors.js` has had the beats
       the owner loves (walk → open → step → handover → close) since the
       airliner wave; cars were never given them.
     • Not one of the FIVE follower kinds had a vehicle branch. Partner and
       hostage (social.js's `follow`), hired security (protection.js), crew
       companions (peds.js `companionThink`) all just jog after the moving
       car forever; the crew brain even TELEPORTS to `P.pos + 3` when it falls
       60 m behind, which is inside the car you are driving.
     • The one follower that did have a seat had the worst one:
       restrain.js's `seat()` is `group.visible = false` plus
       `pos.set(car.pos)`. A hidden rig standing at the car's origin. That is
       the "glitch into car" in the ask, spelled out in four lines.

   WHAT THIS FILE OWNS.  A phased boarding arc that any BODY can run — the
   player and N NPCs at once — plus the orders that fire it.  It authors:

     1. A REAL DOOR for a car. Cars ship with door SEAMS (playercars.js draws
        the crease and the handle) and no leaf. We build one, lazily, per
        seat, parented to the car's own visual group so it rides every
        heading, pitch and roll for free — a painted skin below the beltline
        and a glass pane above it, hinged at the leading edge, swinging out
        the way a car door swings. Same trick `aircraft_doors.js` uses for the
        airstair (`grp.userData._cbzStair`), same lifetime.
     2. A MULTI-ACTOR ARC. `aircraft_doors.js` keeps ONE arc in a module
        singleton because only the player ever ran it. Four companions
        boarding at once needs four, so the arc record is per-actor and the
        phases are the same words: walk → open → step → seat → close.
     3. WALKING THAT IS ACTUALLY WALKING. The walk beat writes `ped.target`
        and lets peds.js's own `move()` do the work — context steering,
        separation, the 3-pass depenetration, vaulting, and `animChar` off
        the real speed. Nothing here integrates a position while a leg is
        available to do it. That is the difference between "walk or run from
        where they are" and a lerp.
     4. SEATS DERIVED, NOT TYPED. `CBZ.carCabinInfo(car)` already publishes
        the floor, the cushion, the seat half-track and the rear bench. Four
        seats fall out of it. Aircraft seats come from the airframe's own
        `userData.cabin.seats` (island_airport authors them, with `cushionH`
        and `floorBelow` for the V2 chair solve) or, for a walk-in hold, from
        `CBZ.vehicleHold`'s floor.
     5. ORDERS. Per-follower and group: get in · get out · wait here · carry
        the bags · drive this to my warehouse.

   WHAT THIS FILE DOES NOT OWN — and the seams it consumes instead:
     • seating a body            `CBZ.npcLife.attach` / `syncAttached`
     • getting one out           `CBZ.cityUnseat` (the ONE sanctioned exit)
     • a body through a car door  `CBZ.moves.board` / `.alight` (entities/
                                 moves_posture.js): this file gives it the
                                 car (carSpec), the leaf and the hands
     • a room inside a vehicle   `CBZ.vehicleHold`
     • money on the ground       `CBZ.cashBags`
     • fear                      `CBZ.cityScare` — a terrified companion
                                 bolts, and that outranks any order
     • what a favour is worth    `CBZ.cityRelShift`

   THE SEATS ARE city/carseats.js's (car wave 2026-09-27). This file used to
   derive its own four (driver/shotgun/rearL/rearR) and write up, right
   here, that vehicles.js's occupancy table put the driver on the OTHER side.
   Both now read one model: driver at +X (the car's left), every body's own
   seat count (a coupe's two, a van's 3-across bench, an SUV's third row),
   each seat with the door that serves it, and one occupancy map
   (car.seatOcc) that the player, companions, ambient occupants and a future
   remote player all claim seats in. carSeats() below is a VIEW of that model
   in the record shape the arcs need, not a second derivation.

   THE PLAYER USES ANY DOOR. The door you walk up to decides the seat: the
   driver's door drives (or drags the driver out), a passenger door of a car
   somebody is driving is a RIDE (passengerseat.js cityRideVehicle), a
   passenger door of an empty car sits you there with the wheel free ([G]).
   The verb is pinned on the door (systems/interactions.js prompt layer).

   FLAGS (defaulted here, never in config.js — the wave law):
     COMPANION_BOARDING_V1  the arcs, the seats, the door leaves
     FOLLOWER_ORDERS_V1     the verbs and the order state
     CAR_DOOR_ARC           the PLAYER's own car door beat (separate revert:
                            you can keep companions boarding while putting
                            your own entry back to instant)
   Ratchet: `CBZ.companionBoardAudit()` — `teleports` is the hard invariant
   and it is PINNED AT 0. A body that arrives at a seat without walking there
   is the whole bug this file exists to delete, so the audit measures it
   directly: every position write this file makes is diffed against the
   previous one and anything over TELE_EPS metres in a frame is counted.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const CF = CBZ.CONFIG || (CBZ.CONFIG = {});
  if (CF.COMPANION_BOARDING_V1 == null) CF.COMPANION_BOARDING_V1 = true;
  if (CF.FOLLOWER_ORDERS_V1 == null) CF.FOLLOWER_ORDERS_V1 = true;
  if (CF.CAR_DOOR_ARC == null) CF.CAR_DOOR_ARC = true;

  function on() { return CF.COMPANION_BOARDING_V1 !== false; }
  function ordersOn() { return CF.FOLLOWER_ORDERS_V1 !== false; }
  function carArcOn() { return on() && CF.CAR_DOOR_ARC !== false; }
  function G() { return CBZ.game; }
  function inCity() { return CBZ.game && CBZ.game.mode === "city"; }
  function note(s, t) { if (CBZ.city && CBZ.city.note) CBZ.city.note(s, t || 1.6); }
  function nameOf(p) { return (p && (p.name || p.job)) || "They"; }

  /* A body this file is not allowed to move: dead, ragdolling, or already
     owned by somebody else's arc. */
  function usable(p) {
    return !!(p && !p.dead && p.group && p.char && p.pos && !p.culled);
  }

  // ---- the teleport ledger. Every write goes through here. ------------------
  const TELE_EPS = 1.2;                       // metres in one tick
  const TALLY = {
    boarded: 0, alighted: 0, arcsRun: 0, arcsFailed: 0, teleports: 0,
    ordersServed: 0, bagsCarriedByNpcs: 0, bagsStowed: 0, npcDrives: 0,
    scareAborts: 0, seatFull: 0,
  };
  /* Move a body and COUNT it if the step was not a step. `soft` marks the one
     legitimate discontinuity — `cityUnseat` putting a body at its own door,
     which is a detach, not a walk — so the invariant stays honest instead of
     being weakened to accommodate it. */
  function place(ped, x, y, z, soft) {
    if (!ped || !ped.pos) return;
    const dx = x - ped.pos.x, dz = z - ped.pos.z;
    if (!soft && Math.hypot(dx, dz) > TELE_EPS) TALLY.teleports++;
    ped.pos.set(x, y == null ? 0 : y, z);
    if (ped.group && ped.group.position !== ped.pos) ped.group.position.set(x, y == null ? 0 : y, z);
    if (ped.target && ped.target.set) ped.target.set(x, 0, z);
  }

  // ============================================================
  //  GEOMETRY — local frames, world points, and the cabin query
  // ============================================================
  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
  const _mp = new THREE.Vector3(), _mq = new THREE.Quaternion(), _ms = new THREE.Vector3();

  /* The frame every anchor in this file is expressed in. For a car that is
     `carVisual` when one exists (vehicles.js:1299 does the same and says why),
     otherwise the record's group; for an aircraft it is the airframe group. */
  function frameOf(veh) {
    const grp = veh && (veh.group || veh);
    if (!grp || !grp.userData) return null;
    return (grp.userData.carVisual) || grp;
  }
  function worldOf(veh, lx, ly, lz, out) {
    const f = frameOf(veh); if (!f) return null;
    f.updateWorldMatrix(true, false);
    (out || _v).set(lx, ly, lz).applyMatrix4(f.matrixWorld);
    return out || _v;
  }
  function yawOf(veh) {
    const grp = veh && (veh.group || veh);
    if (!grp) return 0;
    if (veh && veh.heading != null) return veh.heading;
    return grp.rotation ? (grp.rotation.y || 0) : 0;
  }

  function cabin(veh) {
    if (!veh) return null;
    if (!CBZ.carCabinInfo) return null;
    try { return CBZ.carCabinInfo(veh); } catch (e) { return null; }
  }
  function dimsOf(veh) {
    const grp = veh && (veh.group || veh);
    return (grp && grp.userData && grp.userData.vehicleDims) || null;
  }

  // ============================================================
  //  SEATS — four for a car, the airframe's own list for a plane,
  //  a patch of deck for a walk-in hold.
  // ============================================================
  /* A seat record, in the vehicle's local frame:
       { id, kind, side (+1 left / -1 right), row,
         x, y, z, yaw, cushionH, floorBelow,     ← the npcLife anchor
         doorX, doorZ,                            ← the aperture (in the skin)
         outX, outZ,                              ← where you stand to open it
         hinge: {x, z, len, y0, y1, belt} }       ← the leaf we build
     `y` is the CUSHION top, which is what npclife wants (island_airport's own
     seat records say so: "anchor y == cushion top"). */
  function carSeats(veh) {
    const S = CBZ.carSeats;
    const m = S && S.of(veh); if (!m) return null;
    const ci = m.ci;
    const d = dimsOf(veh);
    const halfW = Math.max(0.62, ((d && d.width) || (ci.w + 0.30)) * 0.5);
    const y0 = Math.max(0.06, ci.floorY - 0.04), y1 = Math.max(y0 + 0.35, ci.roofY - 0.06);
    const belt = Math.max(y0 + 0.12, Math.min(y1 - 0.10, ci.beltY));
    const out = [];
    for (let i = 0; i < m.seats.length; i++) {
      const st = m.seats[i];
      const door = st.doorId ? m.byDoor[st.doorId] : null;
      // `side` is the flank you get in from — the middle of a bench has none
      // of its own, it has its door's
      const side = door ? door.side : (st.side || -1);
      const zc = door ? door.zc : st.z + 0.06;
      const len = door ? Math.max(0.6, door.z1 - door.z0) : 0.9;
      out.push({
        id: st.id, kind: st.isDriver ? "driver" : (st.row ? "rear" : "front"),
        side: side, col: st.col, row: st.row,
        x: st.x, y: st.cushionY, z: st.z, yaw: 0,
        cushionH: Math.max(0.10, st.cushionY - ci.floorY), floorBelow: 0,
        doorId: st.doorId || null,
        doorX: side * halfW, doorZ: zc,
        outX: side * (halfW + 0.92), outZ: zc + 0.02,
        hinge: { x: side * (halfW - 0.03), z: door ? door.z1 : zc + len * 0.5, len: len, y0: y0, y1: y1, belt: belt },
      });
    }
    return out;
  }
  const carSeatKind = (seat) => seat && (seat.kind === "driver" || seat.kind === "front" || seat.kind === "rear");
  function claimSeat(veh, seat, ped) {
    if (CBZ.carSeats && carSeatKind(seat)) CBZ.carSeats.claim(veh, seat.id, { kind: "npc", ref: ped });
  }
  function releaseSeat(veh, seat, ped) {
    if (!CBZ.carSeats || !carSeatKind(seat) || !veh) return;
    const o = CBZ.carSeats.occupant(veh, seat.id);
    if (o && o.ref === ped) CBZ.carSeats.release(veh, seat.id);
  }

  /* An aircraft. Three shapes, in order of how real they are:
       (a) a cabin with an authored seat list (island_airport's airliner and
           private jet) — those records already carry cushionH/floorBelow and a
           plane-local `heading`, so we pass them straight through;
       (b) a walk-in hold (CBZ.vehicleHold) — a ROOM, not a cabin: bodies
           STAND on the deck, in two files down the bay, and board up the ramp;
       (c) nothing — no seats, no arc, degrade to whatever the caller had. */
  function aircraftSeats(veh) {
    const grp = veh && (veh.group || veh);
    const ud = grp && grp.userData;
    const list = [];
    const cab = ud && ud.cabin;
    if (cab && Array.isArray(cab.seats) && cab.seats.length) {
      const sc = cab.scale || 1;
      const doorX = cab.doorX != null ? cab.doorX : -1.6 * sc;
      const doorZ = cab.doorZ != null ? cab.doorZ : 0;
      for (let i = 0; i < cab.seats.length; i++) {
        const s = cab.seats[i];
        // the flight deck is not a passenger seat; a hijack owns those chairs
        if (s.cockpit || s.occupant) continue;
        list.push({
          id: s.id || ("cabin-" + i), kind: "cabin", side: -1, row: s.row || 0,
          x: s.x || 0, y: s.y || 0, z: s.z || 0,
          yaw: s.heading != null ? s.heading : Math.PI / 2,
          cushionH: s.cushionH, floorBelow: s.floorBelow,
          doorX: doorX, doorZ: doorZ,
          outX: doorX, outZ: doorZ - 1.6 * sc,
          inY: (grp.position.y || 0) + (cab.floorTop || 0),
          seatRef: s, hinge: null,
        });
      }
      if (list.length) return list;
    }
    const hold = CBZ.vehicleHoldOf ? CBZ.vehicleHoldOf(veh) : null;
    const H = hold && hold._hold;
    if (H && H.floor) {
      const F = H.floor, R = H.ramp;
      const sc = H.scale || 1;
      const cols = [-F.w * 0.26, F.w * 0.26];
      const rows = Math.max(1, Math.min(6, Math.floor(F.d / 1.6)));
      const dir = R ? R.dir : -1;
      // stand them from the FRONT of the bay backwards, so freight driving in
      // up the ramp never has to push through a row of people.
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols.length; c++) {
          list.push({
            id: "hold-" + r + "-" + c, kind: "hold", side: cols[c] < 0 ? -1 : 1, row: r,
            x: (F.x || 0) + cols[c], y: F.top / sc, z: (F.z || 0) + F.d * 0.5 - 0.9 - r * 1.5,
            yaw: 0, pose: "stand",
            cushionH: null, floorBelow: null,
            doorX: R ? R.x : 0, doorZ: R ? R.sillZ : ((F.z || 0) - F.d * 0.5),
            outX: R ? R.x : 0,
            outZ: R ? (R.sillZ + dir * (R.len + 1.8)) : ((F.z || 0) - F.d * 0.5 - 2.4),
            inY: (grp.position.y || 0) + F.top,
            hold: hold, hinge: null,
          });
        }
      }
      return list;
    }
    return null;
  }

  function seatsOf(veh) {
    if (!veh) return null;
    const grp = veh.group || veh;
    if (!grp || !grp.parent) return null;
    const air = !!(veh.airClass || veh.aircraft || (grp.userData && (grp.userData.cabin || grp.userData.cargoHold)));
    const s = air ? aircraftSeats(veh) : carSeats(veh);
    return (s && s.length) ? s : null;
  }
  function seatById(veh, id) {
    const s = seatsOf(veh); if (!s) return null;
    for (let i = 0; i < s.length; i++) if (s[i].id === id) return s[i];
    return null;
  }

  // ---- who is in which seat ------------------------------------------------
  function crewOf(veh) {
    if (!veh) return null;
    return veh._cbzCrew || (veh._cbzCrew = Object.create(null));
  }
  function occupantOf(veh, id) {
    const c = veh && veh._cbzCrew; const p = c && c[id];
    return (p && !p.dead && p._cbzSeat && p._cbzSeat.veh === veh) ? p : null;
  }
  /* Is this seat spoken for by ANYBODY — us, the player, the ambient occupancy
     record, or restrain's captive? A seat plan that ignores the bodies already
     in the car is how you get two people in one chair. */
  function seatTaken(veh, seat) {
    if (occupantOf(veh, seat.id)) return true;
    /* A SEAT SOMEBODY IS WALKING TOWARDS IS TAKEN. The claim is made at the
       START of the arc, not at the end of it — otherwise two companions
       twenty metres apart both pick the shotgun seat, both walk to the same
       door, and the second one loses a race he never knew he was in. */
    const held = veh._cbzCrew && veh._cbzCrew[seat.id];
    if (held && !held.dead && (held._cbzSeat || held._cbzArc)) return true;
    if (seat.id === "driver" && veh.npcDriver && !veh.npcDriver.dead) return true;
    if (seat.seatRef && seat.seatRef.occupant) return true;
    // the ONE occupancy map: the player, the ambient crew, anybody seated
    if (CBZ.carSeats && carSeatKind(seat)) {
      const o = CBZ.carSeats.occupant(veh, seat.id);
      if (o && !(held && o.ref === held && held._cbzArc)) return true;
    }
    return false;
  }
  /* Pick the seat this particular body belongs in. A cuffed captive rides in
     the BACK — that is not decoration, it is the reason the one-captive limit
     could be lifted: restrain.js capped `car._captive` at one body because it
     had one hiding place, and a real bench has two. */
  function pickSeat(veh, ped, role) {
    const seats = seatsOf(veh); if (!seats) return null;
    const rear = [], front = [];
    for (let i = 0; i < seats.length; i++) {
      if (seatTaken(veh, seats[i])) continue;
      if (seats[i].id === "driver" && role !== "driver") continue;
      (seats[i].row ? rear : front).push(seats[i]);
    }
    const wantsRear = role === "captive" || role === "hostage";
    const order = wantsRear ? rear.concat(front) : front.concat(rear);
    if (role === "driver") {
      for (let i = 0; i < seats.length; i++) if (seats[i].id === "driver" && !seatTaken(veh, seats[i])) return seats[i];
      return null;
    }
    return order[0] || null;
  }

  // ============================================================
  //  THE DOOR. A road car or SUV now HAS one (playercars.js buildCarDoors:
  //  a hinged skin + card + framed pane in a real aperture, posed through
  //  CBZ.carDoorPose) and that is what this file swings. The leaf below is
  //  the FALLBACK for bodies that still ship a seam and no door — the van,
  //  the cybertruck, the box rig: paint below the beltline, glass above it,
  //  hinged at the leading edge.
  // ============================================================
  const _leaves = [];          // every door (real record or fallback leaf) this file has posed
  /* Which real door a seat goes through: its own row's door on its side, or
     — a coupe — the front door on its side. null = no real door, use the leaf. */
  function realDoorFor(veh, seat) {
    const list = CBZ.carDoors ? CBZ.carDoors(veh) : null;
    if (!list || !list.length || !seat.doorId) return null;
    for (let i = 0; i < list.length; i++) if (list[i].id === seat.doorId) return list[i];
    return null;
  }
  function leafFor(veh, seat) {
    if (!seat) return null;
    const f = frameOf(veh); if (!f) return null;
    const bag = f.userData._cbzDoorLeaves || (f.userData._cbzDoorLeaves = Object.create(null));
    const key = seat.doorId || seat.id;             // two seats, one door: one leaf
    if (bag[key]) return bag[key];
    const spec = realDoorFor(veh, seat);
    if (spec) {
      const rec = { real: true, veh: veh, id: spec.id, t: 0 };
      bag[key] = rec;
      _leaves.push({ g: rec, seat: seat });
      return rec;
    }
    if (!seat.hinge) return null;
    const H = seat.hinge;
    const cmat = CBZ.cmat || CBZ.mat;
    const mat = CBZ.mat || CBZ.cmat;
    if (!cmat) return null;
    /* THE DOOR IS PART OF THE CAR, SO IT WEARS THE CAR'S PAINT — and the only
       way to be sure of that is to take the material the body is already
       wearing rather than to guess a hex. `car.color` is the authored paint
       for a player-built car and simply absent on plenty of ambient ones, and
       a grey leaf bolted to a navy flank is exactly what the storyboard
       photographed. So: reuse the material of the biggest opaque mesh in the
       visual, which is the body shell by construction. Reused, never mutated —
       these materials are shared and tinting one would repaint the city. */
    let paint = null;
    try {
      let bestVol = 0;
      f.traverse(function (o) {
        if (!o.isMesh || !o.material || o.material.transparent) return;
        if (o.userData && o.userData._cbzDoorLeaf) return;
        const g = o.geometry;
        if (!g) return;
        if (!g.boundingBox && g.computeBoundingBox) g.computeBoundingBox();
        const bb = g.boundingBox; if (!bb) return;
        const vol = Math.abs((bb.max.x - bb.min.x) * (bb.max.y - bb.min.y) * (bb.max.z - bb.min.z));
        if (vol > bestVol) { bestVol = vol; paint = Array.isArray(o.material) ? o.material[0] : o.material; }
      });
    } catch (e) { paint = null; }
    if (!paint) paint = cmat((veh && veh.color) || 0x8d939c);
    // The glass is OURS, never the cached body material — we set transparency
    // on it, and a shared material would tint every pane in the city.
    let glass = null;
    try {
      glass = mat(0x16242e);
      glass.transparent = true; glass.opacity = 0.34; glass.depthWrite = false;
      if (glass.side != null) glass.side = THREE.DoubleSide;
    } catch (e) { glass = paint; }
    const g = new THREE.Group();
    g.position.set(H.x, 0, H.z);
    const beltH = Math.max(0.10, H.belt - H.y0);
    const glassH = Math.max(0.06, H.y1 - H.belt);
    const skin = new THREE.Mesh(new THREE.BoxGeometry(0.055, beltH, H.len), paint);
    skin.position.set(0, H.y0 + beltH * 0.5, -H.len * 0.5);
    skin.castShadow = false; skin.receiveShadow = false;
    g.add(skin);
    const pane = new THREE.Mesh(new THREE.BoxGeometry(0.035, glassH, H.len * 0.92), glass);
    pane.position.set(0, H.belt + glassH * 0.5, -H.len * 0.5);
    pane.castShadow = false; pane.receiveShadow = false;
    g.add(pane);
    // the handle, so an open door reads as a door and not as a peeled panel
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.20), paint);
    handle.position.set(seat.side * 0.05, H.belt - 0.11, -H.len * 0.30);
    g.add(handle);
    // Batching merges static geometry at load; anything with userData is
    // spared, and these are built long after that pass anyway. Tagged so the
    // rig-disposal traversals treat them like the transient props they are.
    g.userData.transient = true;
    g.userData._cbzDoorLeaf = seat.id;
    g.userData.handleMesh = handle;                 // where a hand closes on this leaf (carHand)
    skin.userData._cbzDoorLeaf = seat.id;
    pane.userData._cbzDoorLeaf = seat.id;
    handle.userData._cbzDoorLeaf = seat.id;
    g.visible = false;
    f.add(g);
    bag[key] = g;
    _leaves.push({ g: g, seat: seat });
    return g;
  }
  /* t 0 = shut flush with the flank, 1 = open. A car door swings about its
     LEADING edge, so the free end travels outboard and forward; the sign
     falls out of which flank the seat is on rather than being typed twice. */
  function poseLeaf(g, seat, t) {
    if (!g) return;
    t = Math.max(0, Math.min(1, t));
    if (g.real) {
      g.t = t;
      CBZ.carDoorPose(g.veh, g.id, t);
      if (t > 0.002 && _posed.indexOf(g) < 0) _posed.push(g);   // claimed this frame
      return;
    }
    g.visible = t > 0.002;
    g.rotation.y = -seat.side * 1.02 * Math.max(0, Math.min(1, t));
    if (g.visible && _posed.indexOf(g) < 0) _posed.push(g);   // claimed this frame
  }

  // ============================================================
  //  THE ARC — per actor, so a whole crew boards at once.
  //  walk → open → step → seat → close     (and the reverse, out)
  // ============================================================
  /* Where navigation stops and choreography starts. Big enough that
     `contextSteer` never gets to fight the car it is being asked to walk into,
     small enough that the visible journey is still a real walk across real
     ground. */
  const APPROACH_R = 4.0;
  const arcs = [];
  function arcOf(ped) { for (let i = 0; i < arcs.length; i++) if (arcs[i].ped === ped) return arcs[i]; return null; }

  /* THE ONE-LINE ADOPTION. Every follower brain asks this before it writes a
     transform; true means this file owns the body right now. It is also what
     makes "wait here" a STATE rather than a popup — a waiting follower is one
     whose brain politely declines to follow. Degrade-safe by construction:
     the callers all read `CBZ.boardingHolds && CBZ.boardingHolds(p)`. */
  CBZ.boardingHolds = function (ped) {
    if (!ped) return false;
    if (ped._cbzArc || ped._boardOwn) return true;   // mid-arc: we are steering
    if (ped._cbzSeat) return true;              // seated: npclife holds it
    if (ped._cbzWait) return true;              // ordered to hold this spot
    if (ped._cbzBag && ped._cbzBag.job) return true;   // running money
    if (ped._cbzDriving) return true;           // at the wheel
    return false;
  };

  function beginArc(ped, veh, seat, dir, opts) {
    if (!on() || !usable(ped) || !veh || !seat) return false;
    if (ped._cbzArc) return false;
    opts = opts || {};
    const a = {
      ped: ped, veh: veh, seat: seat, dir: dir,
      phase: dir === "in" ? "walk" : "open",
      t: 0, walkT: 0, u: 0, run: !!opts.run,
      leaf: leafFor(veh, seat),
      // everything the follower brains own, put back the way we found it
      save: { state: ped.state, speed: ped.speed, pause: ped.pause, controlled: ped.controlled },
      lastX: ped.pos.x, lastZ: ped.pos.z,
      onDone: opts.onDone || null, role: opts.role || "crew",
    };
    ped._cbzArc = a;
    ped.rage = null; ped.path = null; ped.finalGoal = null;
    /* THIS BODY HAS BEEN SEEN. `_spawnHidden` is peds.js's "do not reveal yet"
       latch, and npclife's attach honours it so a stadium spectator does not
       pop in six metres from the camera — correct, and exactly wrong here. A
       companion is not a crowd row: he has just walked across the street in
       front of you to reach this door, so he is already revealed by the time
       he sits down. Measured on the storyboard plate before this line existed:
       endedInsideCabin 1, visibleInsideCabin 0 — a man correctly seated in the
       car and invisible through the glass he was put there to be seen through. */
    ped._spawnHidden = false;
    if (ped.group) ped.group.visible = true;
    if (dir === "in") {
      crewOf(veh)[seat.id] = ped;               // claim it before the walk, so
      ped._cbzClaim = { veh: veh, id: seat.id }; // two companions never race
      claimSeat(veh, seat, ped);
    }
    arcs.push(a);
    TALLY.arcsRun++;
    return true;
  }

  function endArc(a, ok) {
    const i = arcs.indexOf(a); if (i >= 0) arcs.splice(i, 1);
    const ped = a.ped;
    if (!ok && ped && CBZ.moves && CBZ.moves.carBeat && CBZ.moves.carBeat(ped) && CBZ.moves.carAbort) {
      try { CBZ.moves.carAbort(ped); } catch (e) {}
    }
    if (ped) {
      ped._cbzArc = null;
      ped._boardRun = false;
      ped._boardOwn = false;
      if (!ok && ped._cbzClaim && ped._cbzClaim.veh === a.veh) {
        const c = a.veh._cbzCrew;
        if (c && c[ped._cbzClaim.id] === ped) c[ped._cbzClaim.id] = null;
        releaseSeat(a.veh, a.seat, ped);
      }
      ped._cbzClaim = null;
      if (!ped._cbzSeat) {
        /* GIVE THE BODY BACK. `_boardOwn` is cleared above; `inCar` is cleared
           here because a failed arc must never leave a living person carrying
           the engine's "I am riding in a vehicle" flag — that latch is what
           makes peds.js skip a body entirely, and nobody else would ever be
           there to release it. */
        ped.inCar = false;
        if (!ok && !ped.dead) {
          ped.state = a.save.state || "walk";
          ped.speed = 0;
          ped.pause = Math.max(ped.pause || 0, 0.3);
          if (ped.target && ped.target.set) ped.target.set(ped.pos.x, 0, ped.pos.z);
        }
      }
    }
    if (!ok) TALLY.arcsFailed++;
    if (a.leaf) poseLeaf(a.leaf, a.seat, 0);
    if (a.onDone) { try { a.onDone(ok); } catch (e) {} }
  }

  /* An arc dies the moment its premise does — the body, the vehicle, the mode.
     FEAR OUTRANKS THE ORDER: `cityScare` is the one decision about whether a
     person freezes or bolts, and a companion who has decided to run is not
     going to calmly open a car door first. That is not a failure of the arc,
     it is the arc losing an argument to a better system, so it is counted
     separately from the ones that broke. */
  function arcInvalid(a) {
    if (!inCity() || !on()) return true;
    const ped = a.ped, veh = a.veh;
    if (!usable(ped)) return true;
    if (!veh || veh.dead || !(veh.group && veh.group.parent)) return true;
    if (a.dir === "in" && (ped.state === "flee" || ped.fear > 55) && !a.seatedAlready) {
      TALLY.scareAborts++;
      return true;
    }
    return false;
  }

  // the point a body occupies at fraction u of the STEP: outside → aperture →
  // seat, all in vehicle-local space, so a moving car carries them correctly.
  function stepLocal(seat, u, out) {
    const o = out || _v2;
    if (u < 0.45) {
      const k = u / 0.45;
      o.set(seat.outX + (seat.doorX - seat.outX) * k, 0, seat.outZ + (seat.doorZ - seat.outZ) * k);
    } else {
      const k = (u - 0.45) / 0.55;
      const s = k * k * (3 - 2 * k);
      o.set(seat.doorX + (seat.x - seat.doorX) * s, 0, seat.doorZ + (seat.z - seat.doorZ) * s);
    }
    return o;
  }

  function startCarBeats(a) {
    const ped = a.ped, veh = a.veh, seat = a.seat;
    if (!seat || !seat.hinge || !CBZ.moves || !CBZ.moves.board) return false;
    const V = carSpec(veh, seat, ped, { run: a.run });
    if (!V) return false;
    a.mvDone = 0;
    const ok = CBZ.moves.board(ped, V, {
      onDone: function () { a.mvDone = 1; }, onAbort: function () { a.mvDone = -1; },
    });
    if (!ok) return false;
    a.phase = "mv"; a.t = 0;
    return true;
  }

  function sit(a) {
    const ped = a.ped, veh = a.veh, seat = a.seat;
    const NL = CBZ.npcLife;
    if (!NL || !NL.attach) return false;
    /* A CAR SEAT IS SAT LIKE THE PLAYER SITS IT — through the ONE placement
       (vehicles.js CBZ.carSeatPlacement): rooted on the cabin FLOOR in the
       car's visual frame, cushion declared in the scaled group's units, and
       the rig fitted by CBZ.carSeatFit for THIS body. That is exactly the
       pose the door beats (carSpec below) land a body in, so the hand-off
       from the last beat to the held seat does not move. npclife applies the
       fit, re-asserts it every frame and hands the body back its own size on
       detach — this file no longer scales the rig itself (it used to, after
       the attach, with a second cheaper fit for seats without a hinge).
       Aircraft rows and holds keep their own authored records. */
    const pl = (carSeatKind(seat) && CBZ.carSeatPlacement) ? CBZ.carSeatPlacement(veh, seat.id) : null;
    let anchor, parent;
    if (pl) { anchor = pl.anchor; parent = pl.parent; }
    else {
      anchor = {
        x: seat.x, y: seat.y, z: seat.z, yaw: seat.yaw || 0,
        pose: seat.pose || "sit", state: seat.pose === "stand" ? "idle" : "sit",
      };
      if (seat.cushionH != null) anchor.cushionH = seat.cushionH;
      if (seat.floorBelow != null) anchor.floorBelow = seat.floorBelow;
      parent = (seat.kind === "hold" && seat.hold && seat.hold.group) || (veh.group || veh);
    }
    ped._seatHold = true;
    let ok = false;
    try { ok = !!NL.attach(ped, parent, anchor); } catch (e) { ok = false; }
    if (!ok) return false;
    ped.inCar = veh;
    ped.controlled = true;
    ped._spawnHidden = false;
    if (ped.group) ped.group.visible = true;      // seen through the glass, which is the point
    ped._cbzSeat = { veh: veh, id: seat.id, seat: seat, role: a.role };
    if (seat.seatRef) seat.seatRef.occupant = ped;
    crewOf(veh)[seat.id] = ped;
    claimSeat(veh, seat, ped);
    ped._cbzClaim = null;
    TALLY.boarded++;
    // riding with you is a favour, and the ledger that counts who is loyal is
    // the spine — a companion who gets in your car has done something for you.
    if (a.role !== "captive" && a.role !== "hostage" && CBZ.cityRelShift) {
      try { CBZ.cityRelShift(ped, "ranWork", 0.35); } catch (e) {}
    }
    // whatever they were carrying comes aboard with them
    stowCarriedBag(ped, veh);
    return true;
  }

  function standUp(a) {
    const ped = a.ped, veh = a.veh, seat = a.seat;
    const w = worldOf(veh, seat.doorX, 0, seat.doorZ, _v);
    const gy = (w && CBZ.floorAt) ? (+CBZ.floorAt(w.x, w.z) || 0) : 0;
    // (the cabin fit is npclife's: detach hands the body back at its own size)
    if (ped._npcAttached && CBZ.cityUnseat) {
      // the ONE sanctioned exit — a detach at the door, not a shove
      try { CBZ.cityUnseat(ped, { x: w.x, z: w.z, y: gy, ground: true, state: "walk" }); } catch (e) {}
    } else if (w) {
      place(ped, w.x, gy, w.z, true);
    }
    ped.inCar = false;
    ped.controlled = !!a.save.controlled;
    if (seat.seatRef && seat.seatRef.occupant === ped) seat.seatRef.occupant = null;
    const c = veh._cbzCrew; if (c && c[seat.id] === ped) c[seat.id] = null;
    releaseSeat(veh, seat, ped);
    // restrain.js's captive list is a public field on the car; a body that
    // leaves through this door leaves that list too, or "drag them out" keeps
    // offering to remove somebody who is already standing on the pavement.
    if (veh._captives) {
      const k = veh._captives.indexOf(ped);
      if (k >= 0) veh._captives.splice(k, 1);
      if (veh._captive === ped) veh._captive = veh._captives[0] || null;
    } else if (veh._captive === ped) veh._captive = null;
    ped._cbzSeat = null;
    ped.pause = Math.max(ped.pause || 0, 0.35);     // find your feet
    /* HAND THE RESTRAINT FSM ITS STATE BACK. restrain.js's `in_vehicle` branch
       re-asserts `pos = car.pos` every frame for the legacy hidden rig, so a
       tied man we just walked out of the car would be dragged back into it at
       38.5 with the state still reading "riding". He is standing on the kerb
       and he is still tied: that is `cuffed`, and saying so is what keeps the
       two systems from arguing. He stays cuffed — getting out of a car is not
       getting free. */
    if (ped.restraint && (ped.restraint.state === "in_vehicle" || ped.restraint.state === "boarding")) {
      ped.restraint.state = "cuffed";
      ped.restraint.vehicle = null;
      if (CBZ.interactions && CBZ.interactions.refresh) { try { CBZ.interactions.refresh(); } catch (e) {} }
    }
    TALLY.alighted++;
    return true;
  }

  /* NO ARC, NO DOOR. Every leaf is posed by exactly one live arc and hidden by
     its teardown — but "hidden by its teardown" is a promise made in five
     places, and the storyboard caught a leaf standing open on a car nobody was
     boarding. A per-frame sweep makes it structural instead of a promise: a
     leaf that no arc claimed THIS frame is shut, so the only way a car door can
     be open is that somebody is going through it right now. */
  const _posed = [];
  function sweepLeaves() {
    for (let i = 0; i < _leaves.length; i++) {
      const rec = _leaves[i];
      if (rec.g.real) {
        const grp = rec.g.veh && rec.g.veh.group;
        if (!grp || !grp.parent) { _leaves.splice(i--, 1); continue; }
        if (_posed.indexOf(rec.g) >= 0) continue;
        if (rec.g.t > 0) { rec.g.t = 0; CBZ.carDoorPose(rec.g.veh, rec.g.id, 0); }
        continue;
      }
      if (!rec.g.parent) { _leaves.splice(i--, 1); continue; }
      if (_posed.indexOf(rec.g) >= 0) continue;
      if (rec.g.visible) { rec.g.visible = false; rec.g.rotation.y = 0; }
    }
    _posed.length = 0;
  }

  CBZ.onUpdate(33.5, function (dt) {
    if (!arcs.length) { if (_leaves.length) sweepLeaves(); return; }
    for (let i = arcs.length - 1; i >= 0; i--) {
      const a = arcs[i];
      if (arcInvalid(a)) { endArc(a, false); continue; }
      a.t += dt;
      const ped = a.ped, veh = a.veh, seat = a.seat;

      /* ---- IN: walk — the CROSSING, on the shared mover ---------------------
         We write the goal and peds.js's own move() walks it: context steering,
         crowd separation, the 3-pass depenetration, the vault probe, and
         animChar off the real speed. This is "walk or run from where they are",
         and it must be the shared mover or it is not walking, it is a lerp. */
      if (a.phase === "walk") {
        a.walkT += dt;
        const w = worldOf(veh, seat.outX, 0, seat.outZ, _v);
        ped.state = "walk";
        ped.path = null;
        if (ped.target && ped.target.set) ped.target.set(w.x, 0, w.z);
        const d = Math.hypot(w.x - ped.pos.x, w.z - ped.pos.z);
        ped._boardRun = a.run || d > 9;            // far away? you jog to the car
        if (a.leaf) poseLeaf(a.leaf, seat, Math.max(0, Math.min(1, (3.2 - d) / 2.2)));
        /* HAND OVER EARLY, AND HERE IS WHY. The shared navigation is RIGHT to
           refuse the last two metres: `cityNav.contextSteer` reads the car as
           what it is — a collider — bends the heading away from it and raises
           `blocked`, which cuts the forward step to a quarter. Measured on the
           storyboard plate: two companions covered 3.75 m of a 9.5 m walk in
           eight seconds, crabbing sideways beside the door they were trying to
           reach. Navigation exists to route AROUND vehicles; walking INTO one
           is choreography, and aircraft_doors.js made exactly this call for the
           player when it guides him the final stretch itself. So the crossing
           is navigation and the last 4 m are the arc's. `_boardOwn` is the latch
         peds.js honours for that handover — deliberately NOT `inCar`, which
         means "riding in that car" and which vehicles.js answers by snapping
         the body to the car's origin (measured: a 5.84 m jump in one tick, the
         exact glitch this file exists to delete). */
        if (d < APPROACH_R || a.walkT > 14) {
          a.phase = "approach"; a.t = 0; a.appT = 0;
          ped._boardRun = false;
          ped._boardOwn = true;                    // peds.js hands the body over
          startCarBeats(a);                        // a car door: the posture layer's beats
        }
        continue;
      }
      /* ---- a CAR door: CBZ.moves.board / .alight own the body (walk to the
         handle, pull, step in, sit — or out and clear) and call back when
         the body is in the seat or on the kerb. */
      if (a.phase === "mv") {
        if (!a.mvDone) { if (a.t > 12) endArc(a, false); continue; }
        if (a.mvDone < 0) { endArc(a, false); continue; }
        if (a.dir === "in") {
          if (!sit(a)) { endArc(a, false); continue; }
          a.phase = "close"; a.t = 0;
        } else {
          ped._boardOwn = false;
          ped.state = "walk";
          if (ped.target && ped.target.set) ped.target.set(ped.pos.x, 0, ped.pos.z);
          endArc(a, true);
        }
        continue;
      }
      /* ---- IN: approach — the last few metres, guided, still on foot -------
         Not a teleport and not an ease-to-a-pose: a real walk at a real speed,
         with the legs driven off the distance actually covered (restrain.js's
         idiom, and the only honest way to animate a body somebody else moved).
         Bounded, so a blocked kerb can never wedge the arc. */
      if (a.phase === "approach") {
        a.appT += dt;
        const w = worldOf(veh, seat.outX, 0, seat.outZ, _v);
        const dx = w.x - ped.pos.x, dz = w.z - ped.pos.z;
        const d = Math.hypot(dx, dz);
        if (a.leaf) poseLeaf(a.leaf, seat, Math.max(0, Math.min(1, (3.2 - d) / 2.2)));
        if (d > 0.28 && a.appT < 4.0) {
          const spd = a.run ? 3.6 : 2.6;
          const stepD = Math.min(d, spd * dt);
          const wasX = ped.pos.x, wasZ = ped.pos.z;
          place(ped, ped.pos.x + (dx / d) * stepD, 0, ped.pos.z + (dz / d) * stepD);
          ped.group.rotation.y = CBZ.lerpAngle
            ? CBZ.lerpAngle(ped.group.rotation.y, Math.atan2(dx, dz), 1 - Math.pow(0.0009, dt))
            : Math.atan2(dx, dz);
          const moved = Math.hypot(ped.pos.x - wasX, ped.pos.z - wasZ) / Math.max(dt, 1e-4);
          if (CBZ.animChar) { try { CBZ.animChar(ped.char, moved, dt); } catch (e) {} }
          continue;
        }
        a.phase = "open"; a.t = 0;
        continue;
      }
      // ---- IN/OUT: the door stands open, and you can see in ------------------
      if (a.phase === "open") {
        if (a.leaf) poseLeaf(a.leaf, seat, Math.min(1, 0.35 + a.t / 0.4));
        if (a.dir === "out" && !a.unseated && seat.hinge && CBZ.moves && CBZ.moves.alight) {
          a.unseated = true;
          standUp(a);
          ped._boardOwn = true;
          const V = carSpec(veh, seat, ped, { alight: true });
          a.mvDone = 0;
          if (V && CBZ.moves.alight(ped, V, {
            onDone: function () { a.mvDone = 1; }, onAbort: function () { a.mvDone = -1; },
          })) { a.phase = "mv"; a.t = 0; continue; }
          a.phase = "step"; a.t = 0; a.u = 0;
          continue;
        }
        if (a.dir === "out" && !a.unseated) {
          if (a.t >= 0.34) {
            a.unseated = true;
            standUp(a);
            // hold the body OUT of peds.js's mover for the length of the step,
            // or its steering would fight the walk back through the aperture
            ped._boardOwn = true;
            a.phase = "step"; a.t = 0; a.u = 0;
          }
          continue;
        }
        if (a.t >= 0.38) {
          if (a.dir === "in") { ped.state = "walk"; ped._boardOwn = true; }
          a.phase = "step"; a.t = 0; a.u = 0;
          a.stepFrom = { x: ped.pos.x, z: ped.pos.z };
        }
        continue;
      }
      // ---- the STEP: through the aperture, continuous, never a jump ---------
      if (a.phase === "step") {
        const dur = seat.kind === "hold" ? 1.35 : 0.72;
        a.u = Math.min(1, a.u + dt / dur);
        /* THE OUT LEG STARTS AT THE APERTURE, NOT AT THE SEAT. `standUp` has
           already run — `cityUnseat` put the body down at the door, which is
           u = 0.45 on this curve. Running the full curve backwards would jump
           him back INTO the chair for one frame and then walk him out of it,
           which is a teleport the audit would (correctly) count. */
        const uu = a.dir === "in" ? a.u : 0.45 * (1 - a.u);
        const L = stepLocal(seat, uu, _v2);
        const w = worldOf(veh, L.x, 0, L.z, _v);
        /* START FROM WHERE THE FEET ACTUALLY ARE. The walk beat ends when the
           body is WITHIN reach of the door point, not standing exactly on it —
           steering and separation see to that — so snapping onto the curve's
           first sample would be a metre-scale jump on frame one. Blending out
           of the real stopping position over the first quarter of the step
           makes the join continuous BY CONSTRUCTION rather than by luck, which
           is the difference between an invariant and a tolerance. */
        if (a.dir === "in" && a.stepFrom && a.u < 0.25) {
          const k = a.u / 0.25;
          w.x = a.stepFrom.x + (w.x - a.stepFrom.x) * k;
          w.z = a.stepFrom.z + (w.z - a.stepFrom.z) * k;
        }
        const wasX = ped.pos.x, wasZ = ped.pos.z;
        let y = 0;
        if (seat.inY != null) {
          // walk UP onto a deck, do not levitate — height is a function of how
          // far through the aperture you are (aircraft_doors.js's own fix)
          const k = Math.max(0, Math.min(1, (uu - 0.45) / 0.55));
          y = seat.inY * (k * k * (3 - 2 * k));
        }
        place(ped, w.x, y, w.z);
        // face into the doorway on the way in, out of it on the way out
        const carYaw = yawOf(veh);
        const faceIn = carYaw + (seat.yaw || 0);
        const faceDoor = carYaw + seat.side * Math.PI * 0.5;
        const bl = Math.max(0, Math.min(1, (uu - 0.35) / 0.45));
        ped.group.rotation.y = CBZ.lerpAngle
          ? CBZ.lerpAngle(faceDoor, faceIn, a.dir === "in" ? bl : (1 - bl))
          : faceIn;
        // peds.js skips a body with `inCar` set, so its animChar never runs —
        // drive the legs off the measured displacement (restrain.js's idiom)
        const moved = Math.hypot(ped.pos.x - wasX, ped.pos.z - wasZ) / Math.max(dt, 1e-4);
        if (CBZ.animChar) { try { CBZ.animChar(ped.char, moved, dt); } catch (e) {} }
        if (a.u >= 1) {
          if (a.dir === "in") {
            if (!sit(a)) { endArc(a, false); continue; }
          } else {
            ped._boardOwn = false;
            ped.state = "walk";
            if (ped.target && ped.target.set) ped.target.set(ped.pos.x, 0, ped.pos.z);
          }
          a.phase = "close"; a.t = 0;
        }
        continue;
      }
      // ---- the door closes behind you --------------------------------------
      if (a.phase === "close") {
        if (a.leaf) poseLeaf(a.leaf, seat, Math.max(0, 1 - a.t / 0.42));
        if (a.t >= 0.42) { a.seatedAlready = true; endArc(a, true); }
        continue;
      }
      endArc(a, false);
    }
    sweepLeaves();
  });

  // ============================================================
  //  THE SQUAD — five follower kinds, one list.
  // ============================================================
  function detailMembers() {
    const out = [];
    const P = CBZ.protection;
    if (!P || typeof P.details !== "function") return out;
    let list = null;
    try { list = P.details(); } catch (e) { return out; }
    if (!list) return out;
    const arr = Array.isArray(list) ? list : Object.keys(list).map(function (k) { return list[k]; });
    for (let i = 0; i < arr.length; i++) {
      const d = arr[i];
      if (!d || !d.principal || d.principal.kind !== "player") continue;
      const m = d.memberPedRefs || [];
      for (let k = 0; k < m.length; k++) if (usable(m[k])) out.push(m[k]);
    }
    return out;
  }

  /* Everybody who is WITH you. The roles matter because they decide the seat
     (a cuffed man rides in the back) and what a favour is worth. */
  function squad(maxD) {
    const P = CBZ.player;
    if (!P || !inCity()) return [];
    const R = maxD || 60, R2 = R * R;
    const out = [], seen = new Set();
    const g = G() || {};
    function add(p, role) {
      if (!usable(p) || seen.has(p)) return;
      const dx = p.pos.x - P.pos.x, dz = p.pos.z - P.pos.z;
      if (!p._cbzSeat && dx * dx + dz * dz > R2) return;
      seen.add(p);
      out.push({ ped: p, role: role });
    }
    if (g.cityHostage) add(g.cityHostage, "hostage");
    if (g.cityPartner && g.cityPartner.companion && !g.cityPartner.kidnapped) add(g.cityPartner, "partner");
    const peds = CBZ.cityPeds || [];
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!p || p.dead) continue;
      if (p.companion) add(p, "crew");
      else if (p.restraint && (p.restraint.state === "escorted" || p.restraint.state === "cuffed" || p.restraint.state === "in_vehicle")) add(p, "captive");
    }
    const guards = detailMembers();
    for (let i = 0; i < guards.length; i++) add(guards[i], "guard");
    return out;
  }
  CBZ.followerSquad = function (maxD) { return squad(maxD); };

  // ============================================================
  //  ORDERS
  // ============================================================
  function vehOf(opts) {
    if (opts && opts.veh) return opts.veh;
    const P = CBZ.player;
    if (P && P._aircraft) return P._aircraft;
    if (P && P.driving && P._vehicle) return P._vehicle;
    if (P && P._vehicle) return P._vehicle;
    return null;
  }
  function nearestBoardable(x, z, r) {
    let best = null, bd = (r || 22) * (r || 22);
    const cars = CBZ.cityCars || [];
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (!c || c.dead || !c.group || !c.group.parent) continue;
      if (!c.player && !c.owned && !c.stolen) continue;
      const dx = c.pos.x - x, dz = c.pos.z - z, dd = dx * dx + dz * dz;
      if (dd < bd) { bd = dd; best = c; }
    }
    return best;
  }

  function orderBoard(ped, role, opts) {
    if (!ordersOn()) return false;
    const veh = vehOf(opts) || nearestBoardable(CBZ.player.pos.x, CBZ.player.pos.z, 26);
    if (!veh) return false;
    if (ped._cbzSeat && ped._cbzSeat.veh === veh) return true;
    if (ped._cbzArc) return false;
    if (ped._cbzSeat) orderAlight(ped, { silent: true });
    const seat = pickSeat(veh, ped, (opts && opts.slot === "driver") ? "driver" : role);
    if (!seat) {
      /* NO ROOM. This is a STATE, not a popup: they stop trying, hold where
         they are, and the fact is readable from the audit and from the fact
         that they are standing beside a full car. */
      ped._cbzNoSeat = 2.5;
      TALLY.seatFull++;
      return false;
    }
    ped._cbzWait = null;
    return beginArc(ped, veh, seat, "in", { role: role, run: !!(opts && opts.run) });
  }
  function orderAlight(ped, opts) {
    if (!ped) return false;
    const s = ped._cbzSeat;
    if (!s) {
      if (ped._cbzArc && ped._cbzArc.dir === "in") { endArc(ped._cbzArc, false); return true; }
      return false;
    }
    if (ped._cbzArc) return false;
    if (ped._cbzDriving) stopDriving(ped);
    return beginArc(ped, s.veh, s.seat, "out", { role: s.role, onDone: opts && opts.onDone });
  }

  function order(ped, verb, opts) {
    if (!ordersOn() || !usable(ped)) return false;
    opts = opts || {};
    let ok = false;
    const role = opts.role || roleOf(ped);
    if (verb === "board" || verb === "in") ok = orderBoard(ped, role, opts);
    else if (verb === "alight" || verb === "out") ok = orderAlight(ped, opts);
    else if (verb === "wait") {
      ped._cbzWait = { x: opts.x != null ? opts.x : ped.pos.x, z: opts.z != null ? opts.z : ped.pos.z };
      ped._cbzBag = null;
      ok = true;
    } else if (verb === "follow") {
      ped._cbzWait = null; ped._cbzBag = null;
      ok = true;
    } else if (verb === "bags") {
      ped._cbzWait = null;
      ped._cbzBag = { job: "seek", bag: null, to: opts.to || null };
      ok = true;
    } else if (verb === "drive") {
      ok = orderDrive(ped, opts);
    }
    if (ok) TALLY.ordersServed++;
    return ok;
  }
  function roleOf(ped) {
    if (!ped) return "crew";
    if (ped.restraint) return "captive";
    if (ped.hostage) return "hostage";
    const g = G();
    if (g && g.cityPartner === ped) return "partner";
    if (ped.companion) return "crew";
    return "guard";
  }
  CBZ.followerOrder = order;
  CBZ.followerOrderAll = function (verb, opts) {
    const s = squad(opts && opts.maxD);
    let n = 0;
    for (let i = 0; i < s.length; i++) {
      if (opts && opts.roles && opts.roles.indexOf(s[i].role) < 0) continue;
      if (order(s[i].ped, verb, Object.assign({ role: s[i].role }, opts || {}))) n++;
    }
    return n;
  };

  // ============================================================
  //  "GET IN" IS IMPLICIT. You open your door; they come to theirs.
  // ============================================================
  function squadBoard(veh, opts) {
    if (!on() || !veh) return 0;
    const s = squad(45);
    let n = 0;
    for (let i = 0; i < s.length; i++) {
      const p = s[i].ped;
      if (p._cbzSeat || p._cbzArc || p._cbzWait) continue;
      // a captive only rides if you are actually escorting him somewhere
      if (s[i].role === "captive" && p.restraint && p.restraint.state === "cuffed" &&
          Math.hypot(p.pos.x - CBZ.player.pos.x, p.pos.z - CBZ.player.pos.z) > 9) continue;
      if (orderBoard(p, s[i].role, { veh: veh, run: true })) n++;
    }
    if (!n) {
      // nobody got a seat and somebody wanted one — say it once, quietly
      for (let i = 0; i < s.length; i++) if (s[i].ped._cbzNoSeat > 0) { note("No room left · " + nameOf(s[i].ped) + " waits.", 1.6); break; }
    }
    return n;
  }
  /* `opts.freeOnly` gets out everyone who is aboard BY CHOICE and leaves the
     tied and the terrified where they are — which is what has to happen when
     you step out of your own car: your crew and your paid security pile out
     with you, and the man you have cuffed on the back seat does NOT, because
     opening his door for him is a decision you make, not a side effect of
     yours. He comes out through restrain.js's own verb. */
  function squadAlight(veh, opts) {
    let n = 0;
    const c = veh && veh._cbzCrew;
    if (!c) return 0;
    for (const k in c) {
      const p = c[k];
      if (!p || !p._cbzSeat) continue;
      if (opts && opts.freeOnly) {
        const r = p._cbzSeat.role;
        if (r === "captive" || r === "hostage" || p.restraint || p.hostage) continue;
      }
      if (orderAlight(p)) n++;
    }
    return n;
  }
  CBZ.boarding = {
    seatsOf: seatsOf, seatById: seatById,
    board: function (ped, veh, opts) { return orderBoard(ped, (opts && opts.role) || roleOf(ped), Object.assign({ veh: veh }, opts || {})); },
    alight: orderAlight,
    aboard: function (veh) {
      const out = []; const c = veh && veh._cbzCrew;
      for (const k in (c || {})) { const p = c[k]; if (p && !p.dead && p._cbzSeat) out.push(p); }
      return out;
    },
    seatOf: function (ped) { return ped && ped._cbzSeat ? ped._cbzSeat.seat : null; },
    /* THE DOOR, WITHOUT AN ARC. A leaf is built and posed by this file and
       shut by the per-frame sweep above, which is exactly right — "the only
       way a car door can be open is that somebody is going through it right
       now". A player throwing himself out of a moving car IS somebody going
       through it; he simply is not running one of these arcs, because he is
       not an NPC being walked to a chair. So the seam is the pose call and
       nothing else: the caller re-asserts it every frame it wants the door
       open (order < 33.5) and the sweep shuts it the frame they stop, which
       keeps the invariant a sweep rather than a promise. */
    door: function (veh, seatId, t) {
      if (!on() || !veh) return false;
      const seat = seatById(veh, seatId || "shotgun");
      if (!seat) return false;
      const leaf = leafFor(veh, seat);
      if (!leaf) return false;
      poseLeaf(leaf, seat, t == null ? 1 : t);
      return true;
    },
    squadBoard: squadBoard, squadAlight: squadAlight,
    arcs: function () { return arcs.length; },
    freeSeats: function (veh) {
      const s = seatsOf(veh); if (!s) return 0;
      let n = 0; for (let i = 0; i < s.length; i++) if (!seatTaken(veh, s[i])) n++;
      return n;
    },
  };

  // ============================================================
  //  THE PLAYER'S OWN DOOR — the beat the owner already loves, on a car.
  //  A wrap, per the sanctioned precedent (wanted.js:427 `_starsWrapped`):
  //  vehicles.js still commits, synchronously, at the handover.
  // ============================================================
  let pArc = null;
  /* THE BODY GOES THROUGH THE DOOR ON THE ONE POSTURE LAYER.
     Owner, 2026-09-29: "fix getting into cars" — "the human animation of it
     is bad." What ran here was a GLIDE (4.6 m/s, legs cycling over a lerp)
     to a point off the flank, half a second sliding upright into the
     aperture, and then vehicles.js popping the rig into the seat folded and
     shrunk to its cabin fit in one frame. Getting out was the same pop
     backwards. The beats now live where every other sit lives,
     entities/moves_posture.js CBZ.moves.board / .alight: walk to the
     handle, pull, step round the door, inboard leg in over the sill, duck,
     hips down onto the cushion, outer leg in — and the reverse. This file
     hands it the car (carSpec: the frame, the door, the seat, the fit the
     seat will hold) and does what only it knows: the door leaf and the
     hands on the car. Same beats for the player, a companion, a captive, a
     driver being dragged out. */
  const _cm = new THREE.Matrix4();
  function carSpec(veh, seat, actor, opts) {
    opts = opts || {};
    const MV = CBZ.moves;
    if (!seat || !seat.hinge || !MV || !MV.board || !actor) return null;
    const f = frameOf(veh), ci = cabin(veh);
    if (!f || !ci) return null;
    const P = CBZ.player;
    const ch = actor === P ? CBZ.playerChar : actor.char;
    if (!ch) return null;
    const SF = CBZ.carSeatFit ? CBZ.carSeatFit(ch, veh, seat.id) : null;
    const floorY = SF ? SF.floorY : ci.floorY;
    const fit = SF ? SF.fit : Math.max(0.5, Math.min(1, Math.max(0.30, ci.roofY - ci.cushionY) / 0.95));
    const cushionY = seat.y;
    const s = seat.side < 0 ? -1 : 1, H = seat.hinge;
    const halfW = Math.abs(seat.doorX), len = H.len, z1 = H.z, z0 = z1 - len;
    const aZ = Math.max(z0 + 0.22, Math.min(z1 - 0.30, seat.z + 0.05));
    // the open leaf's middle (poseLeaf swings the free edge out ~1 rad)
    const lmx = s * (halfW + 0.43 * len), lmz = z1 - 0.26 * len;
    const C = opts.victim ? { x: s * (halfW + 1.0), z: z0 - 0.15 } : { x: s * (halfW + 0.62), z: z0 - 0.38 };
    // THE SEAT THE HOLDER WILL HOLD: the player's is vehicles.js seatDriver's
    // own record (same fields, so it keeps ours); an NPC's is sit()'s below.
    const kind = (actor === P || seat.kind === "driver") ? "car" : "carseat";
    const ref = { cushion: Math.max(0.05, cushionY - floorY) / fit, floorBelow: 0, kind: kind, _fit: fit, _seat: seat.id };
    const V = {
      side: s,
      toWorld: function (lx, ly, lz, out) {
        f.updateWorldMatrix(true, false);
        _v.set(lx, ly, lz).applyMatrix4(f.matrixWorld);
        out.x = _v.x; out.y = _v.y; out.z = _v.z;
        return out;
      },
      yaw: function () { return yawOf(veh); },
      H: { x: s * (halfW + 0.46), z: z0 - 0.02 },
      A: { x: s * (halfW + 0.26), z: aZ },
      S: { x: seat.x, y: floorY, z: seat.z },
      C: C,
      yawH: -s * (Math.PI / 2 - 0.30),       // square to the car, a touch toward the handle
      yawA: -s * Math.PI / 4,                // forward and in: the inboard leg leads
      yawS: seat.yaw || 0,
      yawOut: s * 0.95,
      yawShut: Math.atan2(lmx - C.x, lmz - C.z),
      doorX: s * halfW, sillY: floorY + 0.06,
      fit: fit, ref: ref,
      run: !!opts.run, fast: !!opts.fast, victim: !!opts.victim,
      jack: opts.jack || null, clear: opts.clear || null,
      groundY: null,
      beat: null,
    };
    if (opts.alight) {
      const w = V.toWorld(C.x, 0, C.z, {});
      V.groundY = CBZ.floorAt ? (+CBZ.floorAt(w.x, w.z) || 0) : ((veh.group && veh.group.position.y) || 0);
    }
    V.beat = doorBeat(actor, veh, seat, V);
    return V;
  }

  /* HANDS ON THE CAR (systems/verbs_pickup.js CBZ.verbs.touch — the plant
     solver every hand on the world goes through):
       handle  the hand closes on the outside door handle (the pull bar
               playercars.js lofts onto the skin; the fallback leaf's own
               handle box) and rides it while the leaf swings
       inner   seated: the hand on the door card's pull, inside the leaf
       frame   the palm on the ROOF RAIL over the opening while the body ducks
       shut    the palm flat on the leaf by its free edge, pushing it to
     All read off the car's own door data, live every frame (the leaf moves). */
  const _chP = new THREE.Vector3(), _chN = new THREE.Vector3(), _chA = new THREE.Vector3();
  const _chM = new THREE.Matrix4();
  // the door leaf's frame -> world (a shut real door is detached from the car, so compose it)
  function leafMatrix(car, leaf) {
    if (!leaf) return null;
    if (leaf.real) {
      const g = CBZ.carDoorGroup ? CBZ.carDoorGroup(car, leaf.id) : null;
      if (!g) return null;
      const f = g.parent || frameOf(car);
      if (!f) return null;
      f.updateWorldMatrix(true, false);
      g.updateMatrix();
      return { m: _chM.multiplyMatrices(f.matrixWorld, g.matrix), door: g.userData.carDoor };
    }
    leaf.updateWorldMatrix(true, false);
    return { m: _chM.copy(leaf.matrixWorld), door: null, g: leaf };
  }
  function carHand(actor, car, seat, leaf, what) {
    const V = CBZ.verbs;
    if (!V || !V.touch || !actor || !seat) return;
    const side = seat.side < 0 ? -1 : 1, H = seat.hinge;
    if (what === "handle" || what === "inner") {
      const L = leafMatrix(car, leaf);
      if (!L) return;
      const len = (L.door && L.door.len) || (H && H.len) || 1;
      const belt = (L.door && L.door.belt) || (H && H.belt) || 0.9;
      if (what === "inner") {
        // the pull on the door card, inboard of the skin, forward of the free edge
        _chP.set(-side * 0.07, belt - 0.10, -len * 0.62).applyMatrix4(L.m);
        _chN.set(-side, 0, 0).transformDirection(L.m);
      } else if (L.door && L.door.handle) {
        const h = L.door.handle, t = h.tilt || 0;
        _chP.set(h.x, h.y, h.z).applyMatrix4(L.m);
        _chN.set(side * Math.cos(t), side * Math.sin(t), 0).transformDirection(L.m);
      } else if (L.g && L.g.userData.handleMesh) {
        const hm = L.g.userData.handleMesh;
        hm.updateWorldMatrix(true, false);
        hm.getWorldPosition(_chP);
        _chN.set(side, 0, 0).transformDirection(L.m);
      } else return;
      _chA.set(0, 0, 1).transformDirection(L.m);
      V.touch(actor, { point: _chP, normal: _chN, axis: _chA, kind: "handle", sustain: true, key: "car-handle", inCar: true, step: false });
      return;
    }
    if (what === "frame" && H) {
      // the roof rail over the aperture, a little inboard of the flank, behind the hinge
      const w = worldOf(car, H.x - side * 0.10, (H.y1 || 1.2) + 0.02, H.z - (H.len || 1) * 0.55, _chP);
      if (!w) return;
      const f = frameOf(car);
      _chN.set(0, 1, 0);
      _chA.set(-side, 0, 0).transformDirection(f.matrixWorld);   // fingers over the roof
      V.touch(actor, { point: _chP, normal: _chN, along: _chA, kind: "palm", sustain: true, key: "car-frame", inCar: true, step: false });
      return;
    }
    if (what === "shut") {
      const L = leafMatrix(car, leaf);
      if (!L) return;
      const len = (L.door && L.door.len) || (H && H.len) || 1;
      const belt = (L.door && L.door.belt) || (H && H.belt) || 0.9;
      // the face of the leaf the body is on: the outer skin, or (stood in
      // the aperture behind the open door) the door card inside it
      const ap = actor === CBZ.player ? CBZ.player.pos : actor.pos;
      _chP.set(side * 0.03, belt - 0.06, -len * 0.75).applyMatrix4(L.m);
      _chN.set(side, 0, 0).transformDirection(L.m);
      if (ap && (ap.x - _chP.x) * _chN.x + (ap.z - _chP.z) * _chN.z < 0) {
        _chP.set(-side * 0.08, belt - 0.06, -len * 0.75).applyMatrix4(L.m);
        _chN.negate();
      }
      V.touch(actor, { point: _chP, normal: _chN, kind: "palm", sustain: true, key: "car-shut", inCar: true, step: false });
    }
  }
  /* THE DOOR FOLLOWS THE BODY. One callback per boarding body, called by the
     posture beats every frame with (beat, u): the leaf opens as the hand
     pulls, stands open while the body goes through, and shuts behind it. */
  function doorBeat(actor, veh, seat, V) {
    const leaf = leafFor(veh, seat);
    let t = 0;
    return function (name, u) {
      let hand = null;
      if (name === "walk") { t = 0; if (u < 0.9) hand = "handle"; }
      else if (name === "pull") { t = 0.55 * u; hand = "handle"; }
      else if (name === "wait") { t = Math.max(t, 0.55 + 0.45 * u); if (u < 0.6) hand = "handle"; }
      else if (name === "swing") { t = Math.max(t, 0.55 + 0.45 * u); hand = u < 0.35 ? "handle" : "frame"; }
      else if (name === "in") { t = 1; if (u < 0.72) hand = "frame"; }
      else if (name === "open") { t = V.victim ? 1 : Math.max(t, u); if (!V.victim) hand = "inner"; }
      else if (name === "out") { t = 1; if (u > 0.12 && u < 0.86) hand = "frame"; }
      else if (name === "step") { t = 1; }
      else if (name === "shut") {
        t = 1 - u; if (u < 0.7) hand = "shut";
        if (u >= 1 && !V._shutSfx && actor === CBZ.player && CBZ.sfx) { V._shutSfx = true; try { CBZ.sfx("door_close"); } catch (e) {} }
      }
      if (leaf) poseLeaf(leaf, seat, t);
      if (hand) { try { carHand(actor, veh, seat, leaf, hand); } catch (e) {} }
    };
  }

  /* SKIP: moving, or pressing the verb again. A key already held when the
     beat started (a thumb still on the stick as it tapped the car) has to
     be let go first, so walking up to a car and tapping it never skips. */
  function moveKeysDown() {
    const k = CBZ.keys;
    return !!(k && (k.w || k.a || k.s || k.d));
  }
  function endPlayerArc() {
    const a = pArc; pArc = null;
    if (a && a.leaf) poseLeaf(a.leaf, a.seat, 0);
  }
  function beginPlayerArc(car, commit, seatId, jack) {
    if (!carArcOn() || pArc) return false;
    if (CBZ.aircraftDoorArc && CBZ.aircraftDoorArc.active) return false;
    const P = CBZ.player, MV = CBZ.moves;
    if (!P || P.dead || P.driving || P._aircraft || !MV || !MV.board) return false;
    if (P._doorArc) return false;                 // propuse / aircraft owns the body
    const seat = seatById(car, seatId || "driver");
    if (!seat || !seat.hinge) return false;
    const doorId = seat.doorId || seat.id;
    const V = carSpec(car, seat, P, {
      jack: jack ? function () { return CBZ.cityJackNow && CBZ.cityJackNow(car); } : null,
      clear: jack ? function () { return !doorBusy(car, doorId); } : null,
    });
    if (!V) return false;
    const a = { car: car, seat: seat, leaf: leafFor(car, seat), phase: "seq", t: 0, commit: commit, armed: !moveKeysDown() };
    pArc = a;
    const ok = MV.board(P, V, {
      onDone: function () {
        if (pArc === a) { a.phase = "close"; a.t = 0; }
        const c = a.commit; a.commit = null;
        if (c) { try { c(); } catch (e) {} }
        if (CBZ.sfx) { try { CBZ.sfx("door_close"); } catch (e) {} }
      },
      onAbort: function () {
        if (pArc === a) endPlayerArc();
        // never swallow the input: he asked to get in, so let him in
        const c = a.commit; a.commit = null;
        if (c && !P.dead && !P.driving && inCity()) { try { c(); } catch (e) {} }
      },
    });
    if (!ok) { if (pArc === a) pArc = null; return false; }
    if (CBZ.sfx) { try { CBZ.sfx("door_open"); } catch (e) {} }
    return true;
  }
  CBZ.onUpdate(33.45, function (dt) {
    if (!pArc) return;
    const a = pArc, P = CBZ.player, car = a.car;
    if (a.phase === "seq" || a.phase === "out") {
      const MV = CBZ.moves;
      if (!P || !MV || !MV.carBeat || !MV.carBeat(P)) { if (a.phase === "out" || !a.commit) pArc = null; return; }
      const k = moveKeysDown();
      if (!k) a.armed = true;
      else if (a.armed) MV.skip(P, 4);
      return;
    }
    if (!inCity() || !P || P.dead || !car || car.dead || !(car.group && car.group.parent)) { endPlayerArc(); return; }
    a.t += dt;
    if (a.phase === "close") {
      // seated: reach out and pull it shut
      if (a.leaf) poseLeaf(a.leaf, a.seat, Math.max(0, 1 - a.t / 0.4));
      if (a.t >= 0 && a.t < 0.3 && P.driving && !(CBZ.carFpActive && CBZ.carFpActive())) {
        try { carHand(P, car, a.seat, a.leaf, "inner"); } catch (e) {}
      }
      if (a.t >= 0.4) endPlayerArc();
      return;
    }
    endPlayerArc();
  });

  /* WHO IS GOING THROUGH A DOOR RIGHT NOW. A body alighting (a carjack
     victim, a companion) owns its aperture until it has stepped clear of it;
     a jacker waits for that instead of sitting down on him. */
  const alighting = [];
  function doorBusy(car, doorId) {
    const MV = CBZ.moves;
    for (let i = alighting.length - 1; i >= 0; i--) {
      const r = alighting[i];
      const nm = MV && MV.carBeat ? MV.carBeat(r.ped) : null;
      if (!nm || r.ped.dead) { alighting.splice(i, 1); continue; }
      if (r.car === car && r.doorId === doorId && (nm === "aopen" || nm === "aout")) return true;
    }
    return false;
  }
  /* ANY SEATED BODY OUT OF ANY CAR SEAT, on its legs (vehicles.js calls this
     for everybody a jack or a bail puts out of a car). Only for a car the
     camera is near: a far one has nobody watching the door. */
  CBZ.boardingAlight = function (p, car, slotId, opts) {
    opts = opts || {};
    if (!carArcOn() || !inCity() || !p || p.dead || !car || car.dead || !CBZ.moves || !CBZ.moves.alight) return false;
    const cam = CBZ.camera && CBZ.camera.position;
    if (cam) { const dx = car.pos.x - cam.x, dz = car.pos.z - cam.z; if (dx * dx + dz * dz > 70 * 70) return false; }
    const seat = seatById(car, slotId || "driver");
    if (!seat || !seat.hinge) return false;
    const V = carSpec(car, seat, p, { fast: opts.fast !== false, victim: true, alight: true });
    if (!V) return false;
    if (opts.exit && opts.exit.y != null) V.groundY = opts.exit.y;
    const rec = { ped: p, car: car, doorId: seat.doorId || seat.id };
    const done = function () { const i = alighting.indexOf(rec); if (i >= 0) alighting.splice(i, 1); };
    if (!CBZ.moves.alight(p, V, { onDone: done, onAbort: done })) return false;
    alighting.push(rec);
    return true;
  };

  /* WHICH SEAT A PRESS MEANS. The door you are nearest decides it (city/
     carseats.js nearestDoor: the first free seat that door serves).
       drive  the wheel — yours, or somebody's you are about to drag out
       ride   another seat of a car somebody else is driving
       sit    another seat of a car nobody is driving (you take the car, the
              wheel stays free: [G] to slide over)
     opts.seat forces a seat (scripts, the debug API). */
  function choosePlayerSeat(car, opts) {
    const S = CBZ.carSeats, P = CBZ.player;
    if (!S || !P || !car) return null;
    const m = S.of(car); if (!m) return null;
    const npc = !!(CBZ.carNpcDriven && CBZ.carNpcDriven(car));
    let seat = opts && opts.seat ? m.byId[opts.seat] : null;
    let door = seat && seat.doorId ? m.byDoor[seat.doorId] : null;
    if (!seat) {
      const nd = S.nearestDoor(car, P.pos.x, P.pos.z, function (st, o) {
        return !o || (st.isDriver && o.kind === "npc");       // a driver can be dragged out
      });
      if (!nd) return null;
      seat = nd.seat; door = nd.door;
    }
    if (!seat || seat.isDriver) return { mode: "drive", seat: m.byId.driver || null, door: door };
    const o = S.occupant(car, seat.id);
    if (o && o.ref !== P) return { mode: "drive", seat: m.byId.driver || null, door: door };
    return { mode: npc ? "ride" : "sit", seat: seat, door: door };
  }
  function crewTakesWheel(car) {
    if (!warehouseDest()) return false;
    const s = squad(45);
    for (let i = 0; i < s.length; i++) {
      const r = s[i].role, p = s[i].ped;
      if (r === "captive" || r === "hostage" || p._cbzArc || p._cbzWait) continue;
      if (orderDrive(p, { veh: car })) return true;
    }
    return false;
  }
  CBZ.boardingChooseSeat = choosePlayerSeat;

  // ---- THE VERB ON THE DOOR ------------------------------------------------
  // One pinned label over the door you are at: "Drive", "Ride" / "Sit" with
  // the seat as the sub line, "Drag out" when somebody is at the wheel. Its
  // chip says F, the one get-in key; the press is city/interactions.js's F
  // (the looked-at car's ride verb, else the router), and the touch tap on
  // the car. All of them land in cityEnterVehicle, which asks
  // choosePlayerSeat the same question.
  const _dw = { x: 0, y: 0, z: 0 };
  function seatWords(seat) {
    if (!seat) return "";
    if (seat.row === 0) return seat.side ? "front" : "front, middle";
    const where = seat.row === 1 ? "back" : "third row";
    return seat.side ? where : where + ", middle";
  }
  let doorCar = null;
  CBZ.cityDoorEnter = function () {
    const car = doorCar;
    if (!car || car.dead || !CBZ.cityEnterVehicle) return false;
    return CBZ.cityEnterVehicle(car) !== false;
  };
  /* WHICH CAR. The door you are standing at, not the car whose CENTRE is
     nearest: two cars parked nose to tail put the next car's middle closer
     to you than the door you walked up to, and the old nearest-centre pick
     then found no door in range and showed nothing at all (or pinned the
     verb on the wrong car). Every stopped car within reach offers its own
     door; the nearest DOOR wins. */
  const _dwT = { x: 0, y: 0, z: 0 };
  CBZ.onUpdate(33.3, function () {
    doorCar = null;
    if (!carArcOn() || !inCity() || !CBZ.prisonPrompt || pArc) return;
    const P = CBZ.player;
    if (!P || P.dead || P.driving || P._aircraft || P._doorArc) return;
    const S = CBZ.carSeats, list = CBZ.cityCars;
    if (!S || !list) return;
    let car = null, pick = null, d2 = 3.2 * 3.2;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c || c.player || c.dead || c._cineLocked || !c.pos) continue;
      const cx = c.pos.x - P.pos.x, cz = c.pos.z - P.pos.z;
      if (cx * cx + cz * cz > 49 || Math.abs(c.v || 0) > 2.4) continue;
      const pk = choosePlayerSeat(c, null);
      if (!pk || !pk.door) continue;
      S.doorWorld(c, pk.door, _dwT);
      const dx = _dwT.x - P.pos.x, dz = _dwT.z - P.pos.z;
      const dd = dx * dx + dz * dz;
      if (dd < d2) { d2 = dd; car = c; pick = pk; _dw.x = _dwT.x; _dw.y = _dwT.y; _dw.z = _dwT.z; }
    }
    if (!car) return;
    let verb, sub = "";
    if (pick.mode === "drive") {
      verb = jackable(car) ? "Drag out" : "Drive";
    } else {
      verb = pick.mode === "ride" ? "Ride" : "Sit";
      sub = seatWords(pick.seat);
    }
    doorCar = car;
    CBZ.prisonPrompt("car-door", "@cityDoorEnter", verb, { at: _dw, sub: sub, d2: d2, key: "F", city: true });
  });
  // somebody is at the wheel (or aboard) who has to be got out first
  function jackable(car) {
    const S = CBZ.carSeats;
    const o = S ? S.occupant(car, "driver") : null;
    return !!((o && o.kind === "npc") || (car.npcDriver && !car.npcDriver.dead) ||
      (CBZ.carOccupied && CBZ.carOccupied(car)));
  }
  // the prompt census (systems/interactions.js prisonPromptAudit) counts this site
  (CBZ._prisonPromptSites || (CBZ._prisonPromptSites = [])).push(
    { id: "car-door", act: "@cityDoorEnter", was: "no prompt at all: E on a car always took the driver's seat" }
  );

  function wrapEnter() {
    if (typeof CBZ.cityEnterVehicle !== "function") return false;
    if (CBZ.cityEnterVehicle._boardWrapped) return true;
    const orig = CBZ.cityEnterVehicle;
    const wrapped = function (car, opts) {
      /* ---- THE INSTANT SEAT, AND WHY IT HAD TO EXIST -------------------
         THIS WRAPPER CHANGED cityEnterVehicle's CONTRACT AND NOTHING WAS
         TOLD. The unwrapped call is synchronous: it returns true and the
         player IS driving on the next line. With the door arc on, it returns
         true and the player is driving ~1.5 s LATER, when the animation's
         commit fires. A human pressing E cannot tell the difference — that
         is the whole point of the arc — but every SCRIPTED caller is written
         against the old contract, and each one is now quietly broken:

           island_speedway cityRaceStart  the racer origin's grid start
           captain.js                     taking the helm
           games/racing.js                the APEX paddock loaner
           militaryvehicles / yachts / swim

         The racer origin is where it showed. It seats the player, calls
         startRace() on the very next line, startRace reads `P.driving`,
         finds it false, and refuses — so the story never opened on the grid
         and, before the fix in that file, abandoned its primer-grey loaner
         on the asphalt and tried again next frame. Twenty grey cars on the
         start straight, and the actual cause was a door animation.

         A scripted start is not somebody walking up to a car: there is no
         door to watch, usually no camera on the player yet, and the caller
         needs the seat NOW. `{ instant: true }` says exactly that and takes
         the original synchronous path. The arc is untouched for every human
         press, which is every call that does not pass the flag. */
      if (opts && opts.instant) return orig.apply(this, arguments);
      if (!carArcOn() || !car || car.player) return orig.apply(this, arguments);
      // pressed again while the beat plays: play the rest of it fast
      if (pArc) { if (CBZ.moves && CBZ.moves.skip) CBZ.moves.skip(CBZ.player, 4); return true; }
      const self = this, args = arguments;
      const pick = choosePlayerSeat(car, opts);
      const mode = pick ? pick.mode : "drive";
      const seatId = pick && pick.seat ? pick.seat.id : "driver";
      let commit;
      if (mode === "ride") commit = function () { return CBZ.cityRideVehicle && CBZ.cityRideVehicle(car, seatId); };
      else if (mode === "sit") {
        commit = function () {
          const r = orig.apply(self, args);
          if (r !== false && CBZ.citySeatShift) CBZ.citySeatShift({ to: seatId, quiet: true });
          return r;
        };
      } else commit = function () { return orig.apply(self, args); };
      const started = beginPlayerArc(car, commit, seatId, mode === "drive" && jackable(car));
      if (!started) return commit();
      // THE CREW COMES WITH YOU — to their OWN doors. A car you sat in the
      // passenger side of gets a driver from the crew when there is somewhere
      // to go (boarding's own "run it to the warehouse" errand).
      if (on() && mode === "sit") crewTakesWheel(car);
      if (on() && mode !== "ride") squadBoard(car);
      return true;                              // committed, same as the old call
    };
    for (const k in orig) { if (/Wrapped$/.test(k)) wrapped[k] = orig[k]; }
    wrapped._boardWrapped = true;
    CBZ.cityEnterVehicle = wrapped;
    return true;
  }
  if (!wrapEnter()) { const iv = setInterval(function () { if (wrapEnter()) clearInterval(iv); }, 0); }

  /* EXIT runs the real exit FIRST and then climbs out. Callers of
     cityExitVehicle (networld.js wraps it, the pause menu calls it, death
     calls it) expect `P.driving === false` when it returns, and deferring
     that would be a lie they cannot see. So the state is torn down at once
     and the BODY starts in the seat it just left (CBZ.moves.alight writes
     the seated pose the same frame): door open, outer leg out, hand on the
     frame, stand, step clear, shut it. A car still rolling (a bail), a
     hull, a death: no climb, the old door beat. */
  function wrapExit() {
    if (typeof CBZ.cityExitVehicle !== "function") return false;
    if (CBZ.cityExitVehicle._boardWrapped) return true;
    const orig = CBZ.cityExitVehicle;
    const wrapped = function () {
      const P = CBZ.player;
      const car = P && P._vehicle;
      const mine = car && CBZ.carSeats ? CBZ.carSeats.playerSeat(car) : null;
      const npcRide = !!(car && CBZ.cityPaxNpcRide && CBZ.cityPaxNpcRide(car));
      const spd = car ? (Number.isFinite(car.v) ? Math.abs(car.v) : Math.hypot(car.vx || 0, car.vz || 0)) : 0;
      const r = orig.apply(this, arguments);
      // YOU GOT OUT, SO THEY GET OUT — through their own doors, on their own
      // legs. Not the captive: see squadAlight's note.
      if (on() && car && !car.dead && !npcRide) { try { squadAlight(car, { freeOnly: true }); } catch (e) {} }
      if (carArcOn() && car && !car.dead && car.group && car.group.parent && P && !P.driving) {
        const seat = seatById(car, mine ? mine.id : "driver");
        if (seat && seat.hinge) {
          if (pArc) endPlayerArc();
          const V = (!P.dead && spd < 1.5 && CBZ.moves && CBZ.moves.alight) ? carSpec(car, seat, P, { alight: true }) : null;
          const a = { car: car, seat: seat, leaf: leafFor(car, seat), phase: "out", t: 0, commit: null, armed: !moveKeysDown() };
          const clear = function () { if (pArc === a) pArc = null; };
          if (V && CBZ.moves.alight(P, V, { onDone: clear, onAbort: function () { clear(); if (a.leaf) poseLeaf(a.leaf, seat, 0); } })) {
            pArc = a;
            if (CBZ.sfx) { try { CBZ.sfx("door_open"); } catch (e) {} }
          } else if (a.leaf) {
            // no body to climb out (a bail at speed, a death): the door just
            // swings shut behind wherever the exit put him
            a.phase = "close"; a.t = -0.45;
            pArc = a;
            if (CBZ.sfx) { try { CBZ.sfx("door_close"); } catch (e) {} }
          }
        }
      }
      return r;
    };
    for (const k in orig) { if (/Wrapped$/.test(k)) wrapped[k] = orig[k]; }
    wrapped._boardWrapped = true;
    CBZ.cityExitVehicle = wrapped;
    return true;
  }
  if (!wrapExit()) { const iv2 = setInterval(function () { if (wrapExit()) clearInterval(iv2); }, 0); }

  // ============================================================
  //  CARRYING THE BAGS — the heist half of the ask.
  //  `CBZ.cashBags` is player-only by construction (one global `_carried`,
  //  mounted on `CBZ.playerChar`), so we do not pretend otherwise: we claim a
  //  loose bag with its own public `carried` flag — which is exactly the flag
  //  the bag physics loop already skips on — and mount it on the NPC's rig
  //  with the same shoulder solve inventory.js uses. Nothing is minted, no
  //  value moves, and the bag is still the same physical object.
  // ============================================================
  function bagList() {
    if (!CBZ.cashBags || !CBZ.cashBags.list) return [];
    try { return CBZ.cashBags.list(); } catch (e) { return []; }
  }
  function freeBagNear(x, z, r) {
    const list = bagList();
    let best = null, bd = r * r;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (!b || b.carried || b.air || b.dead || b._cbzBy) continue;
      const dx = b.x - x, dz = b.z - z, dd = dx * dx + dz * dz;
      if (dd < bd) { bd = dd; best = b; }
    }
    return best;
  }
  function mountBag(ped, bag) {
    const ch = ped.char;
    const host = (ch && ch.body) || (ch && ch.group) || null;
    if (!host || !bag.mesh) return false;
    host.add(bag.mesh);
    if (ch.group) ch.group.updateMatrixWorld(true); else host.updateMatrixWorld(true);
    host.matrixWorld.decompose(_mp, _mq, _ms);
    const declared = (ch.group && ch.group.userData && ch.group.userData.humanScale) || 0;
    const hostScale = declared > 0.01 ? declared : (Math.abs(_ms.x) > 1e-4 ? _ms.x : 1);
    bag.mesh.scale.setScalar((bag.mesh.userData._bagScale || 1) / hostScale);
    const sh = ch && ch.parts && ch.parts.ra;
    if (sh) {
      sh.getWorldPosition(_v);
      host.worldToLocal(_v);
      const side = _v.x >= 0 ? 1 : -1;
      bag.mesh.position.set(_v.x + side * 0.12 / hostScale, _v.y - 0.34 / hostScale, _v.z - 0.20 / hostScale);
    } else {
      bag.mesh.position.set(0.30 / hostScale, 0.95 / hostScale, -0.10 / hostScale);
    }
    bag.mesh.rotation.set(0.08, -0.20, -0.46);
    return true;
  }
  /* HE PICKS IT UP WITH HIS HAND (systems/verbs_pickup.js): the bag is his
     the moment he reaches for it (nobody else goes for it), he bends to it,
     it comes off the ground in his hand, and it goes up onto his shoulder
     when the lift ends. His bag duty waits while his hand is on it. */
  function takeBag(ped, bag) {
    if (!bag || bag.carried || bag._cbzBy || ped._cbzTaking) return false;
    if (!ped.char || !bag.mesh) return false;
    bag.carried = true; bag.held = true; bag.air = false;
    bag._cbzBy = ped;
    ped._cbzTaking = bag;
    const shoulder = function () {
      ped._cbzTaking = null;
      if (bag._cbzBy !== ped || bag.dead) return;
      bag.mesh.visible = true;
      if (ped.dead || !mountBag(ped, bag)) {
        // he went down (or has no body): the bag stays where it lay
        bag.carried = false; bag.held = false; bag._cbzBy = null;
        return;
      }
      ped._cbzHeldBag = bag;
      if (CBZ.setCharPose) { try { CBZ.setCharPose(ped.char, "haul"); } catch (e) {} }
      TALLY.bagsCarriedByNpcs++;
    };
    if (CBZ.verbs && CBZ.verbs.pickup) CBZ.verbs.pickup(ped, bag.mesh, { pose: "grip", keep: true, onDone: shoulder });
    else shoulder();
    return true;
  }
  /* Board with a bag and the bag rides too. A hold takes it as real freight
     (`latchCargo` re-asserts the pose from the host's live world matrix, so a
     duffel in a cargo plane pitches WITH the aeroplane); a car without a hold
     gets it parented to the body shell at the footwell, which is the same
     picture for a tenth of the machinery. */
  function stowCarriedBag(ped, veh) {
    const bag = ped && ped._cbzHeldBag;
    if (!bag) return false;
    const hold = CBZ.vehicleHoldOf ? CBZ.vehicleHoldOf(veh) : null;
    if (bag.mesh && bag.mesh.parent) bag.mesh.parent.remove(bag.mesh);
    if (hold && hold.latchCargo) {
      const f = hold._hold && hold._hold.floor;
      const w = f ? worldOf(veh, f.x || 0, f.top + 0.14, (f.z || 0) + (TALLY.bagsStowed % 5) * 0.8 - 1.6, _v) : null;
      const root = (CBZ.city && CBZ.city.arena && CBZ.city.arena.root) || CBZ.scene;
      if (root) root.add(bag.mesh);
      if (w) { bag.x = w.x; bag.y = w.y; bag.z = w.z; bag.mesh.position.set(w.x, w.y, w.z); }
      bag.mesh.scale.setScalar(bag.mesh.userData._bagScale || 1);
      bag.carried = false; bag.held = true;
      try { hold.latchCargo(bag); } catch (e) {}
    } else {
      const grp = veh.group || veh;
      const seat = ped._cbzSeat && ped._cbzSeat.seat;
      grp.add(bag.mesh);
      bag.mesh.scale.setScalar(bag.mesh.userData._bagScale || 1);
      bag.mesh.position.set(seat ? seat.x * 0.5 : 0, seat ? Math.max(0.06, seat.y - 0.34) : 0.28, seat ? seat.z - 0.22 : -0.6);
      bag.mesh.rotation.set(0, 0, 0);
      bag.carried = true;                       // the bag loop skips it; we mirror x/z below
      bag._cbzStowed = veh;
    }
    bag._cbzBy = null;
    ped._cbzHeldBag = null;
    if (CBZ.setCharPose) { try { CBZ.setCharPose(ped.char, "stand"); } catch (e) {} }
    TALLY.bagsStowed++;
    if (CBZ.cityRelShift) { try { CBZ.cityRelShift(ped, "ranWork", 0.6); } catch (e) {} }
    return true;
  }

  // ============================================================
  //  THE ORDER TICK — waiting, bag duty, no-seat cooldowns, and the
  //  self-healing that keeps a seat honest when its owner dies or the
  //  car does.
  // ============================================================
  CBZ.onUpdate(33.6, function (dt) {
    if (!inCity() || !ordersOn()) return;
    const P = CBZ.player; if (!P) return;
    const peds = CBZ.cityPeds || [];
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!p) continue;
      if (p._cbzNoSeat > 0) p._cbzNoSeat -= dt;

      // --- a seat whose premise died ------------------------------------
      const s = p._cbzSeat;
      if (s) {
        if (p.dead || !s.veh || s.veh.dead || !(s.veh.group && s.veh.group.parent)) {
          const c = s.veh && s.veh._cbzCrew;
          if (c && c[s.id] === p) c[s.id] = null;
          if (s.veh && s.seat) releaseSeat(s.veh, s.seat, p);
          if (s.seat && s.seat.seatRef && s.seat.seatRef.occupant === p) s.seat.seatRef.occupant = null;
          p._cbzSeat = null; p.inCar = false;
        }
        continue;
      }
      if (p.dead) { p._cbzWait = null; p._cbzBag = null; continue; }

      // --- WAIT HERE: a state, not a popup ------------------------------
      if (p._cbzWait && !p._cbzArc) {
        const w = p._cbzWait;
        const d = Math.hypot(w.x - p.pos.x, w.z - p.pos.z);
        if (d > 1.4) { p.state = "walk"; if (p.target) p.target.set(w.x, 0, w.z); }
        else { p.state = "idle"; p.speed = 0; if (p.target) p.target.set(p.pos.x, 0, p.pos.z); }
        continue;
      }

      // --- BAG DUTY: pick one up, carry it to the ride -------------------
      const job = p._cbzBag;
      if (job && p._cbzTaking) { p.state = "idle"; p.speed = 0; continue; }   // his hand is on a bag
      if (job && !p._cbzArc) {
        if (p._cbzHeldBag) {
          const veh = job.to || vehOf(null) || nearestBoardable(P.pos.x, P.pos.z, 40);
          if (!veh) { p._cbzBag = null; continue; }
          const hold = CBZ.vehicleHoldOf ? CBZ.vehicleHoldOf(veh) : null;
          const drop = hold && hold._hold && hold._hold.ramp
            ? worldOf(veh, hold._hold.ramp.x, 0, hold._hold.ramp.sillZ + hold._hold.ramp.dir * (hold._hold.ramp.len + 1.4), _v)
            : worldOf(veh, 0, 0, 0, _v);
          const d = Math.hypot(drop.x - p.pos.x, drop.z - p.pos.z);
          p.state = "walk"; p._boardRun = false;
          if (p.target) p.target.set(drop.x, 0, drop.z);
          if (d < 2.6) {
            if (hold) { stowCarriedBag(p, veh); job.job = "seek"; }
            else if (orderBoard(p, roleOf(p), { veh: veh })) job.job = "riding";
            else { stowCarriedBag(p, veh); job.job = "seek"; }
          }
          continue;
        }
        const bag = job.bag && !job.bag.dead && !job.bag._cbzBy ? job.bag : freeBagNear(p.pos.x, p.pos.z, 44);
        if (!bag) { p._cbzBag = null; continue; }
        job.bag = bag;
        const d = Math.hypot(bag.x - p.pos.x, bag.z - p.pos.z);
        p.state = "walk"; p._boardRun = d > 8;
        if (p.target) p.target.set(bag.x, 0, bag.z);
        if (d < 1.5) { takeBag(p, bag); job.bag = null; }
        continue;
      }
    }
    // stowed bags keep an honest world position so `nearest` never lies
    const bags = bagList();
    for (let i = 0; i < bags.length; i++) {
      const b = bags[i];
      if (b && b._cbzStowed && b.mesh && b.mesh.parent) {
        b.mesh.getWorldPosition(_v);
        b.x = _v.x; b.y = _v.y; b.z = _v.z;
      }
    }
  });

  // ============================================================
  //  "DRIVE THIS TO MY WAREHOUSE" — a companion takes the wheel.
  //  vehicles.js's own npcDriver + traffic AI would wander; the honest
  //  version is giglife.js's proven driver loop (which itself mirrors
  //  advanceRoadRage) pointed at a real destination. `car.road = null` is
  //  what tells the ambient road AI to leave this car alone.
  // ============================================================
  const driving = [];
  function warehouseDest() {
    const CS = CBZ.cashStore;
    if (CS && CS.owned && CS.warehouse) {
      let owned = false;
      try { owned = !!CS.owned(); } catch (e) { owned = false; }
      if (owned) {
        let W = null;
        try { W = CS.warehouse(); } catch (e) { W = null; }
        if (W) {
          const d = W.dock || W.door || W.origin;
          if (d && d.x != null) return { x: d.x, z: d.z, name: "the Freeport yard" };
        }
      }
    }
    const ST = CBZ.cityStorage;
    if (ST && ST.spots) {
      let spots = null;
      try { spots = ST.spots(); } catch (e) { spots = null; }
      if (spots && spots.length) {
        for (let i = 0; i < spots.length; i++) {
          const s = spots[i];
          if (!s || s.x == null) continue;
          const k = s.prop && s.prop.kind;
          if (k === "warehouse" || k === "compound" || k === "garage") {
            return { x: s.x, z: s.z, name: (s.prop && s.prop.name) || "your lockup" };
          }
        }
        return { x: spots[0].x, z: spots[0].z, name: "your lockup" };
      }
    }
    return null;
  }
  function stopDriving(ped) {
    const rec = ped && ped._cbzDriving;
    if (!rec) return false;
    const i = driving.indexOf(rec); if (i >= 0) driving.splice(i, 1);
    const car = rec.car;
    if (car) {
      car.npcDriver = null; car.ai = false; car.v = 0; car.vx = car.vz = 0;
      car._cbzDrive = null;
    }
    ped._cbzDriving = null;
    return true;
  }
  function orderDrive(ped, opts) {
    const dest = (opts && opts.to && opts.to.x != null) ? opts.to : warehouseDest();
    if (!dest) {
      // DEGRADE HONESTLY: no property, no destination, no fake errand.
      note("You've got nowhere to send it, buy a lockup first.", 2.2);
      return false;
    }
    const P = CBZ.player;
    const car = (opts && opts.veh) || (ped._cbzSeat && ped._cbzSeat.veh) || (P && P._vehicle) || nearestBoardable(P.pos.x, P.pos.z, 26);
    if (!car || car.dead) return false;
    if (car.airClass || car.aircraft) return false;      // a plane is not a truck
    /* YOU CANNOT HAND OVER A WHEEL YOU ARE HOLDING — but throwing you out onto
       the kerb was never what "have them run it to the warehouse" meant. Slide
       across to the shotgun seat instead and RIDE, which is the whole point of
       giving somebody else the keys; only fall back to the old step-out when
       the passenger seat is not available (flag off, no cabin, seat taken). */
    if (P && P.driving && P._vehicle === car && !(CBZ.cityPaxAboard && CBZ.cityPaxAboard(car))) {
      const rode = !!(CBZ.citySeatShift && CBZ.citySeatShift({ to: "passenger", quiet: true }));
      if (!rode) { try { CBZ.cityExitVehicle(); } catch (e) {} }
    }
    const seat = seatById(car, "driver");
    if (!seat) return false;
    const rec = { ped: ped, car: car, dest: dest, t: 0 };
    function takeWheel() {
      car.npcDriver = ped;
      car.ai = true;
      car.road = null;                       // ambient road AI skips a car with no lane
      car.pullover = 0;
      car.baseV = Math.max(9, car.baseV || 11);
      car._cbzDrive = dest;
      ped._cbzDriving = rec;
      ped.inCar = car;
      driving.push(rec);
      TALLY.npcDrives++;
      note(nameOf(ped) + " takes the wheel, running it to " + dest.name + ".", 2.4);
      if (CBZ.cityRelShift) { try { CBZ.cityRelShift(ped, "ranWork", 1); } catch (e) {} }
    }
    if (ped._cbzSeat && ped._cbzSeat.id === "driver" && ped._cbzSeat.veh === car) { takeWheel(); return true; }
    if (ped._cbzSeat) orderAlight(ped, { silent: true });
    return beginArc(ped, car, seat, "in", {
      role: "driver", run: true,
      onDone: function (ok) { if (ok) takeWheel(); },
    });
  }

  CBZ.onUpdate(36.6, function (dt) {
    if (!driving.length) return;
    const A = CBZ.city && CBZ.city.arena;
    for (let i = driving.length - 1; i >= 0; i--) {
      const rec = driving[i], car = rec.car, ped = rec.ped;
      /* `car.player` still ends a run — a car you have taken the wheel of is
         not one your companion is delivering. The ONE exception is the car you
         are riding SHOTGUN in: the record stays `player` (the camera, the HUD
         and the exit all hang off that), you are simply not the one driving.
         vehicles.js's own loop stands down for exactly this case, so this
         remains the only integrator on the car. */
      const rideAlong = car && car.player && CBZ.cityPaxAboard && CBZ.cityPaxAboard(car);
      if (!car || car.dead || !car.group || !car.group.parent || (car.player && !rideAlong) ||
          !usable(ped) || ped.inCar !== car) { stopDriving(ped); continue; }
      const dest = rec.dest;
      const dx = dest.x - car.pos.x, dz = dest.z - car.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 5.5) {
        car.v = 0; car.vx = car.vz = 0; car.ai = false; car._cbzDrive = null;
        note(nameOf(ped) + " parked it at " + dest.name + ".", 2.4);
        stopDriving(ped);
        continue;
      }
      const desired = Math.atan2(dx, dz);
      car.heading = CBZ.lerpAngle ? CBZ.lerpAngle(car.heading, desired, 1 - Math.pow(0.0009, dt)) : desired;
      const top = Math.max(8, car.baseV || 11);
      const want = dist < 14 ? Math.min(top, dist * 0.9) : top;
      car.v += Math.max(-22 * dt, Math.min(15 * dt, want - car.v));
      if (car.v < 0) car.v = 0;
      car.vx = Math.sin(car.heading) * car.v; car.vz = Math.cos(car.heading) * car.v;
      car.pos.x += car.vx * dt; car.pos.z += car.vz * dt;
      // the SHARED wall resolver — without it a beeline drives through houses
      if ((!CF || CF.VEH_COLLIDE_FIX !== false) && CBZ.cityCollideVehicle) {
        try { CBZ.cityCollideVehicle(car); } catch (e) {}
      }
      if (A && A.clampToCity) A.clampToCity(car.pos, 1.4);
      car.group.position.set(car.pos.x, car.group.position.y || 0, car.pos.z);
      car.group.rotation.y = car.heading;
    }
  });

  // ============================================================
  //  RATCHET. `teleports` is the hard invariant of this whole wave.
  // ============================================================
  CBZ.companionBoardAudit = function () {
    let seated = 0, waiting = 0, hauling = 0, leaves = 0, stowed = 0;
    const peds = CBZ.cityPeds || [];
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i]; if (!p) continue;
      if (p._cbzSeat) seated++;
      if (p._cbzWait) waiting++;
      if (p._cbzHeldBag) hauling++;
    }
    const cars = CBZ.cityCars || [];
    for (let i = 0; i < cars.length; i++) {
      const f = frameOf(cars[i]);
      const bag = f && f.userData && f.userData._cbzDoorLeaves;
      if (bag) for (const k in bag) leaves++;
    }
    const bags = bagList();
    for (let i = 0; i < bags.length; i++) if (bags[i] && (bags[i]._cbzStowed || bags[i]._cbzBy)) stowed++;
    return {
      boarded: TALLY.boarded, alighted: TALLY.alighted,
      arcsRun: TALLY.arcsRun, arcsFailed: TALLY.arcsFailed, arcsLive: arcs.length,
      teleports: TALLY.teleports,             // PINNED AT 0
      ordersServed: TALLY.ordersServed,
      bagsCarriedByNpcs: TALLY.bagsCarriedByNpcs, bagsStowed: TALLY.bagsStowed,
      npcDrives: TALLY.npcDrives, drivesLive: driving.length,
      scareAborts: TALLY.scareAborts, seatFull: TALLY.seatFull,
      seatedNow: seated, waitingNow: waiting, haulingNow: hauling,
      doorLeaves: leaves, bagsHeldOrStowed: stowed,
      squad: squad().length,
      flags: {
        boarding: CF.COMPANION_BOARDING_V1 !== false,
        orders: CF.FOLLOWER_ORDERS_V1 !== false,
        carDoor: CF.CAR_DOOR_ARC !== false,
      },
    };
  };
})();
