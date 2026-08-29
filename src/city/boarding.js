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
     • the player's door beats   the grammar of `city/aircraft_doors.js`
     • a room inside a vehicle   `CBZ.vehicleHold`
     • money on the ground       `CBZ.cashBags`
     • fear                      `CBZ.cityScare` — a terrified companion
                                 bolts, and that outranks any order
     • what a favour is worth    `CBZ.cityRelShift`

   THE SEAT-SIDE DISAGREEMENT (read before you add a fifth seat). Two live
   conventions disagree about which side the driver is on. playercars.js:822
   declares "+X is the car's LEFT: LHD" and vehicles.js:1303 seats the PLAYER
   at `+ci.seatX`; but vehicles.js's own `OCC_SLOTS` gives the driver
   `side: -1`, and gangs.js's `DB_SEATS.driver.x` is -0.42 to match. Both are
   internally consistent and they are mirror images of each other. We follow
   the PLAYER, because the player is the one body you can inspect and the one
   that is definitely in the driver's seat: driver `+seatX`, shotgun
   `-seatX`. Using `carOccupancySeat`'s slots here would have sat every
   companion in the player's lap. Reconciling the two tables is owed work and
   belongs to whoever owns vehicles.js, not to a boarding arc.

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
    const ci = cabin(veh); if (!ci) return null;
    const d = dimsOf(veh);
    const halfW = Math.max(0.62, ((d && d.width) || (ci.w + 0.30)) * 0.5);
    const cushionH = Math.max(0.10, ci.cushionY - ci.floorY);
    const frontZ = ci.seatZ;
    // The rear bench: authored when playercars.js dressed a two-row cabin,
    // otherwise derived one seat-pitch behind the fronts — and only kept when
    // it still lands inside the cabin box. A coupe honestly has two seats.
    let rearZ = ci.rearSeatZ;
    if (rearZ == null) {
      const guess = frontZ - 0.80;
      rearZ = (guess > ci.zRear + 0.26) ? guess : null;
    }
    const leafLen = Math.max(0.60, Math.min(1.08, (ci.zFront - ci.zRear) * 0.42));
    const y0 = Math.max(0.06, ci.floorY - 0.04), y1 = Math.max(y0 + 0.35, ci.roofY - 0.06);
    const belt = Math.max(y0 + 0.12, Math.min(y1 - 0.10, ci.beltY));
    const out = [];
    function push(id, side, row, z, xk) {
      out.push({
        id: id, kind: row ? "rear" : (id === "driver" ? "driver" : "front"),
        side: side, row: row,
        x: side * ci.seatX * xk, y: ci.cushionY, z: z, yaw: 0,
        cushionH: cushionH, floorBelow: 0,
        doorX: side * halfW, doorZ: z + 0.06,
        outX: side * (halfW + 0.92), outZ: z + 0.04,
        hinge: { x: side * (halfW - 0.03), z: z + leafLen * 0.5, len: leafLen, y0: y0, y1: y1, belt: belt },
      });
    }
    // +X is the car's LEFT and the driver sits there — see the header note.
    push("driver", +1, 0, frontZ, 1);
    push("shotgun", -1, 0, frontZ, 1);
    if (rearZ != null) {
      push("rearL", +1, 1, rearZ, 0.96);
      push("rearR", -1, 1, rearZ, 0.96);
    }
    return out;
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
    if (seat.id === "driver") {
      const P = CBZ.player;
      if (P && P.driving && P._vehicle === veh) return true;
      if (veh.npcDriver) return true;
    }
    if (seat.seatRef && seat.seatRef.occupant) return true;
    if (veh.occ && Array.isArray(veh.occ.seats)) {
      const slot = seat.id === "rearL" ? "rearL" : seat.id === "rearR" ? "rearR" : seat.id;
      for (let i = 0; i < veh.occ.seats.length; i++) {
        const s = veh.occ.seats[i];
        if (s.slot === slot && s.ped && !s.ped.dead && !s.gone) return true;
      }
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
  //  THE DOOR LEAF — a car ships with a door SEAM and no door.
  //  Paint below the beltline, glass above it, hinged at the leading edge.
  // ============================================================
  const _leaves = [];          // every door leaf this file has ever built
  function leafFor(veh, seat) {
    if (!seat || !seat.hinge) return null;
    const f = frameOf(veh); if (!f) return null;
    const bag = f.userData._cbzDoorLeaves || (f.userData._cbzDoorLeaves = Object.create(null));
    if (bag[seat.id]) return bag[seat.id];
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
    skin.userData._cbzDoorLeaf = seat.id;
    pane.userData._cbzDoorLeaf = seat.id;
    handle.userData._cbzDoorLeaf = seat.id;
    g.visible = false;
    f.add(g);
    bag[seat.id] = g;
    _leaves.push({ g: g, seat: seat });
    return g;
  }
  /* t 0 = shut flush with the flank, 1 = open. A car door swings about its
     LEADING edge, so the free end travels outboard and forward; the sign
     falls out of which flank the seat is on rather than being typed twice. */
  function poseLeaf(g, seat, t) {
    if (!g) return;
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
    }
    arcs.push(a);
    TALLY.arcsRun++;
    return true;
  }

  function endArc(a, ok) {
    const i = arcs.indexOf(a); if (i >= 0) arcs.splice(i, 1);
    const ped = a.ped;
    if (ped) {
      ped._cbzArc = null;
      ped._boardRun = false;
      ped._boardOwn = false;
      if (!ok && ped._cbzClaim && ped._cbzClaim.veh === a.veh) {
        const c = a.veh._cbzCrew;
        if (c && c[ped._cbzClaim.id] === ped) c[ped._cbzClaim.id] = null;
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

  function sit(a) {
    const ped = a.ped, veh = a.veh, seat = a.seat;
    const NL = CBZ.npcLife;
    if (!NL || !NL.attach) return false;
    const anchor = {
      x: seat.x, y: seat.y, z: seat.z, yaw: seat.yaw || 0,
      pose: seat.pose || "sit", state: seat.pose === "stand" ? "idle" : "sit",
    };
    if (seat.cushionH != null) anchor.cushionH = seat.cushionH;
    if (seat.floorBelow != null) anchor.floorBelow = seat.floorBelow;
    const parent = (seat.kind === "hold" && seat.hold && seat.hold.group) || (veh.group || veh);
    ped._seatHold = true;
    let ok = false;
    try { ok = !!NL.attach(ped, parent, anchor); } catch (e) { ok = false; }
    if (!ok) return false;
    /* THE RIG IS STYLISED AND THE CABIN IS NOT. vehicles.js solves ONE uniform
       scale backwards so the seated eye lands on the cabin's authored eye
       height (`fitSeatedRig`); an unscaled adult in a sedan puts his crown
       0.2 m through the headliner. That solve is private, so we do the cheap
       honest version of the same thing: the ratio of the cabin's own
       cushion-to-roof clearance to a standing torso. A hold is a room with
       full standing height and gets left alone. */
    if (seat.kind !== "hold" && seat.kind !== "cabin") {
      const ci = cabin(veh);
      if (ci && ped.group) {
        const clear = Math.max(0.30, ci.roofY - ci.cushionY);
        const fit = Math.max(0.50, Math.min(1, clear / 0.95));
        ped._cbzFit = fit;
        ped.group.scale.setScalar(fit);
      }
    }
    ped.inCar = veh;
    ped.controlled = true;
    ped._spawnHidden = false;
    if (ped.group) ped.group.visible = true;      // seen through the glass, which is the point
    ped._cbzSeat = { veh: veh, id: seat.id, seat: seat, role: a.role };
    if (seat.seatRef) seat.seatRef.occupant = ped;
    crewOf(veh)[seat.id] = ped;
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
    /* UNDO THE CABIN FIT BEFORE THE DETACH, AND MAKE THE MATRIX AGREE.
       npclife's `detach` writes the DECOMPOSED WORLD pose back onto the group —
       scale included — so a rig still carrying its 0.6 cabin fit walks away
       from the car permanently shrunk. Resetting the scalar is not enough on
       its own: the decomposition reads `matrixWorld`, which still holds last
       frame's numbers until something forces it. */
    if (ped.group && ped._cbzFit) {
      ped.group.scale.setScalar(1);
      ped._cbzFit = 0;
      if (ped.group.updateMatrixWorld) ped.group.updateMatrixWorld(true);
    }
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
  function playerGuide(P, tx, tz, dt, speed) {
    const dx = tx - P.pos.x, dz = tz - P.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.24) return true;
    const step = Math.min(d, (speed || 4.4) * dt);
    P.pos.x += (dx / d) * step;
    P.pos.z += (dz / d) * step;
    const ch = CBZ.playerChar;
    if (ch && ch.group) {
      ch.group.position.x = P.pos.x;
      ch.group.position.z = P.pos.z;
      ch.group.rotation.y = Math.atan2(dx, dz);
      if (CBZ.animChar) { try { CBZ.animChar(ch, step / Math.max(dt, 1e-4), dt); } catch (e) {} }
    }
    return false;
  }
  function endPlayerArc(commit) {
    if (!pArc) return;
    const a = pArc; pArc = null;
    const P = CBZ.player;
    if (P && P._doorArcOwner === "car") { P._doorArc = false; P._doorArcOwner = null; }
    if (a.leaf) poseLeaf(a.leaf, a.seat, 0);
    if (commit && a.commit) { try { a.commit(); } catch (e) {} }
  }
  function beginPlayerArc(car, commit) {
    if (!carArcOn() || pArc) return false;
    if (CBZ.aircraftDoorArc && CBZ.aircraftDoorArc.active) return false;
    const P = CBZ.player;
    if (!P || P.dead || P.driving || P._aircraft) return false;
    if (P._doorArc) return false;                 // propuse / aircraft owns the body
    const seat = seatById(car, "driver");
    if (!seat || !seat.hinge) return false;
    // already standing at the door? then this is a re-press, not a walk-up.
    pArc = { car: car, seat: seat, leaf: leafFor(car, seat), phase: "walk", t: 0, walkT: 0, commit: commit };
    P._doorArc = true; P._doorArcOwner = "car";
    if (CBZ.sfx) { try { CBZ.sfx("door_open"); } catch (e) {} }
    return true;
  }
  CBZ.onUpdate(33.45, function (dt) {
    if (!pArc) return;
    const a = pArc, P = CBZ.player, car = a.car;
    if (!inCity() || !P || P.dead || !car || car.dead || !(car.group && car.group.parent)) {
      // never swallow the input: the player asked to get in, so let him in
      endPlayerArc(true);
      return;
    }
    a.t += dt;
    if (a.phase === "walk") {
      a.walkT += dt;
      const w = worldOf(car, a.seat.outX, 0, a.seat.outZ, _v);
      const arrived = playerGuide(P, w.x, w.z, dt, 4.6);
      const d = Math.hypot(w.x - P.pos.x, w.z - P.pos.z);
      if (a.leaf) poseLeaf(a.leaf, a.seat, Math.max(0, Math.min(1, (2.6 - d) / 1.9)));
      if (arrived || a.walkT > 2.4) { a.phase = "open"; a.t = 0; }
      return;
    }
    if (a.phase === "open") {
      if (a.leaf) poseLeaf(a.leaf, a.seat, 1);
      if (a.t >= 0.36) { a.phase = "step"; a.t = 0; a.from = { x: P.pos.x, z: P.pos.z }; }
      return;
    }
    if (a.phase === "step") {
      const u = Math.min(1, a.t / 0.5);
      const L = stepLocal(a.seat, u * 0.55, _v2);       // to the aperture, not the seat:
      const w = worldOf(car, L.x, 0, L.z, _v);          // vehicles.js owns the seat itself
      P.pos.x = w.x; P.pos.z = w.z;
      const ch = CBZ.playerChar;
      if (ch && ch.group) { ch.group.position.x = P.pos.x; ch.group.position.z = P.pos.z; }
      if (u >= 1) {
        a.phase = "close"; a.t = 0;
        if (a.commit) { try { a.commit(); } catch (e) {} a.commit = null; }
        if (CBZ.sfx) { try { CBZ.sfx("door_close"); } catch (e) {} }
      }
      return;
    }
    if (a.phase === "close") {
      if (a.leaf) poseLeaf(a.leaf, a.seat, Math.max(0, 1 - a.t / 0.4));
      if (a.t >= 0.4) endPlayerArc(false);
      return;
    }
  });

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
      if (pArc) return true;                    // arc already playing: swallow the re-press
      const self = this, args = arguments;
      const started = beginPlayerArc(car, function () { return orig.apply(self, args); });
      if (!started) return orig.apply(this, arguments);
      // THE CREW COMES WITH YOU. They start walking the moment you do, from
      // wherever they are, to their OWN door — not to yours.
      if (on()) squadBoard(car);
      return true;                              // committed, same as the old call
    };
    for (const k in orig) { if (/Wrapped$/.test(k)) wrapped[k] = orig[k]; }
    wrapped._boardWrapped = true;
    CBZ.cityEnterVehicle = wrapped;
    return true;
  }
  if (!wrapEnter()) { const iv = setInterval(function () { if (wrapEnter()) clearInterval(iv); }, 0); }

  /* EXIT runs the real exit FIRST and plays the door behind it. Callers of
     cityExitVehicle (networld.js wraps it, the pause menu calls it, death
     calls it) expect `P.driving === false` when it returns, and deferring
     that would be a lie they cannot see. The beat is still honest: the leaf
     is open while you climb out and shuts once you are clear. */
  function wrapExit() {
    if (typeof CBZ.cityExitVehicle !== "function") return false;
    if (CBZ.cityExitVehicle._boardWrapped) return true;
    const orig = CBZ.cityExitVehicle;
    const wrapped = function () {
      const P = CBZ.player;
      const car = P && P._vehicle;
      const r = orig.apply(this, arguments);
      // YOU GOT OUT, SO THEY GET OUT — through their own doors, on their own
      // legs. Not the captive: see squadAlight's note.
      if (on() && car && !car.dead) { try { squadAlight(car, { freeOnly: true }); } catch (e) {} }
      if (carArcOn() && car && !car.dead && car.group && car.group.parent) {
        const seat = seatById(car, "driver");
        if (seat && seat.hinge) {
          const leaf = leafFor(car, seat);
          if (leaf) {
            pArc = { car: car, seat: seat, leaf: leaf, phase: "close", t: -0.45, commit: null };
            P._doorArc = false;                 // he is out and walking; only the door is busy
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
  function takeBag(ped, bag) {
    if (!bag || bag.carried || bag._cbzBy) return false;
    if (!mountBag(ped, bag)) return false;
    bag.carried = true; bag.held = true; bag.air = false;
    bag._cbzBy = ped;
    ped._cbzHeldBag = bag;
    if (CBZ.setCharPose) { try { CBZ.setCharPose(ped.char, "haul"); } catch (e) {} }
    TALLY.bagsCarriedByNpcs++;
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
          if (s.seat && s.seat.seatRef && s.seat.seatRef.occupant === p) s.seat.seatRef.occupant = null;
          if (p.group && p._cbzFit) { p.group.scale.setScalar(1); p._cbzFit = 0; }
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
    if (P && P.driving && P._vehicle === car) {
      const rode = !!(CBZ.citySeatShift && CBZ.citySeatShift({ to: "shotgun", quiet: true }));
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
