/* ============================================================
   city/passengerseat.js — SLIDE ACROSS, AND GO OUT THE DOOR.

   OWNER, verbatim: "When in vehicles in gang city like boat plane car etc on
   desktop a button should move me to passenger and same with touch and then if
   I go to the door I can eve jump out etc."

   TWO SENTENCES, TWO FAULTS, AND THEY ARE THE SAME FAULT
   -----------------------------------------------------
   There was exactly ONE seat in a vehicle in this game and it was the driver's.
   `cityEnterVehicle` sets `P.driving = true`, vehicles.js's CAR_DRIVER_VISIBLE
   block seats the player's real dressed rig at `+ci.seatX`, and every other
   chair in the cabin belongs to somebody else — boarding.js walks companions,
   hostages and captives to three of them and seats them where you can see them
   through the glass. You could give a stranger the shotgun seat of your own car
   and you could not sit in it.

   And getting out was a PARKING MANOEUVRE. `cityExitVehicle` reads, in order:
   `car.v = 0; car.vx = car.vz = 0`, then stands you 1.6 m off the driver's
   flank. Measured before this file existed: a Ferrari at 41 m/s (148 km/h),
   one press of the step-out verb, and the car is stationary on the same frame
   with the player standing beside it, unhurt. That is not an exit, it is a
   handbrake with a teleport attached — and it is why the second half of the ask
   ("then if I go to the door I can even jump out") has never been possible.

   WHAT A PASSENGER ACTUALLY IS HERE
   ---------------------------------
   Not a new mode. The player stays `P.driving` with the same `P._vehicle`, so
   the chase camera, the HUD, the minimap, the speed readout, the fuel burn, the
   car audio, the damage stager and every exit path keep believing exactly what
   they already believed. THREE things change, and each one is a sign or an
   empty bag rather than a branch:

     • THE CHAIR.  vehicles.js's seat solve is handed `-ci.seatX` instead of
       `+ci.seatX` (`seatSideX`). The fit, the lean with the car's roll, the
       cushion sink, the first-person head drop and the leg fold are the shipped
       solve, unchanged. `driveSteer` eases to 0 because a passenger has no
       wheel to hold.
     • THE CONTROLS.  The driving loop reads its keys out of a FROZEN EMPTY
       OBJECT, so throttle, brake, handbrake and steer are all false and the car
       runs the coast-and-friction branch it already owns. Nobody is driving, so
       it rolls to a stop. water_helm.js's hull loop takes the same empty bag.
       No input is intercepted, no key is swallowed, and one flag puts the live
       keyboard back at both sites at once.
     • THE DOOR YOU LEAVE BY.  `cityExitVehicle` mirrors its own offset, so a
       passenger steps out onto the kerb rather than through the driver.

   THE JUMP IS THE POINT, AND IT IS NOT A NEW PHYSICS
   -------------------------------------------------
   Below walking pace, going out of the door is the ordinary step-out. Above it,
   every piece of the bail already shipped, in two places nobody had connected:

     • THE BODY — `CBZ.body.fling` (systems/grapple.js) is the shared launch a
       blast, a throw and a disaster all use. It sets `_phys.air`, and from that
       frame systems/physics.js owns the body: it integrates the tumble, lands
       it, and pins `_phys.down` so you lie there for a beat before getting up.
       We choose a direction (the car's own velocity, plus outward through the
       door you opened) and a force, and write nothing else.
     • THE CAR — vehicles.js's AI loop has had a driverless-motion path since
       the day a cop could shoot a driver at the wheel: `wreckT` bleeds speed,
       slides the real lateral momentum against the real surface, collides with
       buildings, crumples on a hard hit and settles as abandoned. It was locked
       behind `c.ai && c.road`, and a car you have been driving has no lane —
       which is why a bailed-from car used to freeze mid-road. `_runaway` opens
       that same branch to a car whose driver simply left, with a coast decay
       (0.62/s) instead of a spin-out's scrub (0.04/s), because nothing hit it.

   So the car carries on down the road without you, hits what it hits, and stops
   where it stops. The door swings open as you go through it — boarding.js's own
   leaf, posed through the seam it already sweeps, so "a car door is only ever
   open because somebody is going through it" stays structurally true.

   AND SOMEBODY ELSE CAN DRIVE (PAX_CHAUFFEUR)
   -------------------------------------------
   boarding.js has shipped "have them run it to the warehouse" since the
   companion wave, and its first act was `cityExitVehicle()` — it put you on the
   kerb and drove off with your money. It now slides you into the shotgun seat
   instead, which is what handing somebody the keys has always meant. Its driver
   loop is then the ONLY integrator on that car: vehicles.js's player loop
   stands down for the frame (`cityPaxChauffeured`) rather than moving the car a
   second time, and this file re-seats the rig, the player position and the
   camera behind it.

   THE AIRCRAFT GAP IS DECLARED, NOT FAKED (PAX_AIRCRAFT, OFF)
   ----------------------------------------------------------
   A plane in this repo is not a `P._vehicle`; it is `P._aircraft`, flown by
   playeraircraft.js, and its passenger deck is a different, already-built
   thing — `CBZ.vehicleHold`'s walk-in room and island_airport's cabin seats,
   which ticketing.js already rides you across the map in. Leaving the controls
   in the air is bailout.js's subject and it answers it well (the graveyard
   spiral, or "someone else has the controls" when there is a crew). Wiring a
   ride-in-the-cabin state to a machine the player is flying is that file's
   wave, not this one's — so the button says so out loud instead of pretending,
   and the flag is declared here for whoever opens it. FORT_CONVOY's precedent.

   PUBLISHES
     CBZ.citySeatShift(opts)     the button — driver <-> shotgun
     CBZ.cityVehicleGetOut()     the door — step out, or jump at speed
     CBZ.cityPaxAboard(veh)      is the player riding shotgun in this thing
     CBZ.cityPaxRiding()         the vehicle he is riding, or null
     CBZ.cityPaxChauffeured(veh) somebody else is integrating this car
     CBZ.cityPaxRelease(veh)     drop the ride (cityExitVehicle calls it)
     CBZ.cityPaxAudit()          THE RATCHET

   RATCHET: `ghostThrottle` — frames on which the player was a passenger, with
   nobody at the wheel, and the vehicle GAINED speed anyway. A dead keyboard
   that is not actually dead is the entire failure mode of doing this with a
   sign instead of a mode, so it is measured directly and pinned at 0.
   `orphanRides` (a ride record outliving its vehicle) is pinned at 0 too.

   FLAGS: PASSENGER_SEAT_V1 (the seat + the button) · VEHICLE_BAIL (jumping
   from a moving vehicle; off = the old stop-dead step-out) · PAX_CHAUFFEUR
   (riding while a companion drives) · PAX_AIRCRAFT (declared, OFF).
   Tool: tools/passenger-check.mjs
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const CF = CBZ.CONFIG || (CBZ.CONFIG = {});
  if (CF.PASSENGER_SEAT_V1 == null) CF.PASSENGER_SEAT_V1 = true;
  if (CF.VEHICLE_BAIL == null) CF.VEHICLE_BAIL = true;
  if (CF.PAX_CHAUFFEUR == null) CF.PAX_CHAUFFEUR = true;
  // DECLARED AND OFF — see the header. Turning this on without doing the work
  // in playeraircraft.js/bailout.js buys a player sitting in a chair inside an
  // aeroplane that nobody is flying, which is worse than the honest refusal.
  if (CF.PAX_AIRCRAFT == null) CF.PAX_AIRCRAFT = false;

  const on = () => CF.PASSENGER_SEAT_V1 !== false;
  const bailOn = () => on() && CF.VEHICLE_BAIL !== false;
  const chauffeurOn = () => on() && CF.PAX_CHAUFFEUR !== false;
  const G = () => CBZ.game;
  const inCity = () => !!(CBZ.game && CBZ.game.mode === "city");
  function note(s, t) { if (CBZ.city && CBZ.city.note) CBZ.city.note(s, t || 1.8); }

  // Walking pace. Below this, opening the door is stepping out of a car that
  // has effectively stopped; above it, it is a jump. 2.4 m/s ~ 8.6 km/h — a
  // brisk walk, and comfortably above the crawl a car idles forward at.
  const STEP_OUT_MS = 2.4;
  const DOOR_HOLD = 1.15;          // seconds the door stands open behind a jump

  const TALLY = {
    shifts: 0, ridesStarted: 0, bails: 0, stepOuts: 0, refusedAircraft: 0,
    refusedNoSeat: 0, chauffeuredFrames: 0, paxFrames: 0,
    ghostThrottle: 0,              // PINNED AT 0
    orphanRides: 0,                // PINNED AT 0
    lastBailSpeed: 0, lastBailDamage: 0,
  };

  /* THE RIDE. One record, because there is one player. `lastSpeed` is the
     ghost-throttle probe's memory and nothing else reads it. */
  let ride = null;
  // A door standing open behind a jump: re-posed every frame until it times
  // out, because boarding.js's sweep shuts anything nobody claimed.
  let doorOpen = null;

  function speedOf(veh) {
    if (!veh) return 0;
    const vx = veh.vx, vz = veh.vz;
    if (Number.isFinite(vx) && Number.isFinite(vz) && (Math.abs(vx) + Math.abs(vz)) > 0.01) {
      return Math.hypot(vx, vz);
    }
    return Math.abs(veh.v || 0);
  }
  function marine(veh) {
    if (CBZ.isMarineHull) { try { if (CBZ.isMarineHull(veh)) return true; } catch (e) {} }
    if (!veh) return false;
    if (veh._playerCarFeel) return !!veh._playerCarFeel.marine;
    return !!(veh._hullSpec || (veh.model && veh.model.body === "boat"));
  }
  function cabinOf(veh) {
    if (!CBZ.carCabinInfo || !veh) return null;
    try { return CBZ.carCabinInfo(veh); } catch (e) { return null; }
  }
  /* Is there a second seat to slide into? A cabin publishes a seat half-track,
     so a car, a van and a truck all have one. A hull has no cabin record at all
     (water_helm hides the rig entirely) and yet plainly has somewhere else to
     stand, so it qualifies on being a hull. A motorcycle has neither, and gets
     told so rather than being silently ignored. */
  function hasSecondSeat(veh) {
    if (!veh || veh.dead) return false;
    if (marine(veh)) return true;
    return !!cabinOf(veh);
  }

  // ============================================================
  //  STATE — the four questions everybody else asks
  // ============================================================
  CBZ.cityPaxAboard = function (veh) {
    return !!(on() && ride && veh && ride.veh === veh);
  };
  CBZ.cityPaxRiding = function () { return ride ? ride.veh : null; };
  /* Somebody else is integrating this car this frame. Read by vehicles.js's
     player loop to stand down — two integrators on one car move it twice. */
  CBZ.cityPaxChauffeured = function (veh) {
    if (!chauffeurOn() || !ride || !veh || ride.veh !== veh) return false;
    const d = veh.npcDriver;
    return !!(d && !d.dead && d._cbzDriving);
  };
  CBZ.cityPaxRelease = function (veh) {
    if (!ride) return false;
    if (veh && ride.veh !== veh) return false;
    ride = null;
    return true;
  };

  // ============================================================
  //  THE BUTTON — slide across, and slide back
  // ============================================================
  /* opts.to    "shotgun" | "driver" — force a direction instead of toggling
     opts.quiet suppress the note (a caller that prints its own line) */
  CBZ.citySeatShift = function (opts) {
    opts = opts || {};
    if (!on() || !inCity()) return false;
    const P = CBZ.player;
    if (!P || P.dead || G().state !== "playing") return false;

    // AIRCRAFT: the declared gap. Say what is true and name the verb that
    // exists, rather than moving a body inside an aeroplane nobody is flying.
    if (P._aircraft) {
      TALLY.refusedAircraft++;
      if (!opts.quiet) {
        note(CF.PAX_AIRCRAFT === true
          // Flipping the flag on must not silently do nothing — say what the
          // flag actually is, which is a declaration of owed work.
          ? "PAX_AIRCRAFT is declared, not built — a cabin ride belongs to playeraircraft.js and bailout.js."
          : "You're the only one flying this — [F] steps out, and up here that's a jump.", 2.4);
      }
      return false;
    }
    if (!P.driving || !P._vehicle) return false;
    const car = P._vehicle;

    // ---- back to the wheel ----
    if (ride && ride.veh === car) {
      // A caller that ASKED for the shotgun seat and is already in it has got
      // what it wanted; only a toggle (or an explicit "driver") moves you back.
      if (opts.to === "shotgun") return true;
      /* Taking the wheel back ENDS a companion's errand, and it ends it in
         boarding.js rather than here: that loop drops any run whose car is
         `player` without a passenger aboard, so clearing the ride is the whole
         handover. No second stop path, no second place to keep in sync. */
      const chauffeur = car.npcDriver;
      ride = null;
      TALLY.shifts++;
      if (!opts.quiet) {
        note(chauffeur ? "You take the wheel back." : (marine(car) ? "Back at the helm." : "Back behind the wheel."), 1.8);
      }
      if (CBZ.sfx) CBZ.sfx("pickup", { volume: 0.5 });   // cloth: a body moving across upholstery
      return true;
    }
    if (opts.to === "driver") return false;      // already there

    // ---- across to the shotgun seat ----
    if (!hasSecondSeat(car)) {
      TALLY.refusedNoSeat++;
      if (!opts.quiet) note("There's only one seat on this thing.", 1.8);
      return false;
    }
    /* A SEAT WITH SOMEBODY IN IT IS NOT FREE. boarding.js seats companions,
       hostages and cuffed captives in real chairs and knows which ones are
       taken; asking it is the difference between riding shotgun and sitting in
       your hostage's lap. Feature-detected — with boarding absent, the cabin's
       own second seat is assumed empty, which is what it was before it existed. */
    const held = shotgunOccupant(car);
    if (held) {
      TALLY.refusedNoSeat++;
      if (!opts.quiet) note((held.name || "Someone") + " is in that seat.", 1.8);
      return false;
    }
    ride = { veh: car, t: 0, lastSpeed: speedOf(car), lastSteer: Math.abs(car._steerInput || 0) };
    TALLY.shifts++; TALLY.ridesStarted++;
    if (!opts.quiet) {
      note(marine(car)
        ? "You step back from the helm — nobody's steering."
        : "You slide over to the passenger seat — nobody's driving.", 2.2);
    }
    if (CBZ.sfx) CBZ.sfx("pickup", { volume: 0.5 });   // cloth: a body moving across upholstery
    return true;
  };

  function shotgunOccupant(veh) {
    const B = CBZ.boarding;
    if (!B || !B.seatsOf || !B.aboard) return null;
    let crew = null;
    try { crew = B.aboard(veh); } catch (e) { return null; }
    if (!crew || !crew.length) return null;
    for (let i = 0; i < crew.length; i++) {
      const p = crew[i];
      const s = p && p._cbzSeat;
      if (s && s.id === "shotgun") return p;
    }
    return null;
  }

  // ============================================================
  //  THE DOOR — step out, or go out of a moving one
  // ============================================================
  CBZ.cityVehicleGetOut = function () {
    if (!inCity()) return false;
    const P = CBZ.player;
    if (!P || P.dead) return false;
    // The air is bailout.js's, through the aircraft owner's own exit. Never
    // second-guess it from here.
    if (P._aircraft) {
      if (CBZ.cityPlayerAircraftExit) { CBZ.cityPlayerAircraftExit(); return true; }
      return false;
    }
    if (!P.driving || !P._vehicle) return false;
    const car = P._vehicle;
    const speed = speedOf(car);
    if (!bailOn() || speed <= STEP_OUT_MS) {
      TALLY.stepOuts++;
      if (CBZ.cityExitVehicle) CBZ.cityExitVehicle();
      return true;
    }
    return bail(car, speed);
  };

  function bail(car, speed) {
    const P = CBZ.player;
    const pax = !!(ride && ride.veh === car);
    const side = pax ? -1 : 1;                 // +X is the car's LEFT (the driver)
    const h = car.heading || 0;
    // the car's own axes: forward (sin h, cos h), local +X (cos h, −sin h)
    const fx = Math.sin(h), fz = Math.cos(h);
    const lx = Math.cos(h), lz = -Math.sin(h);
    let vx = car.vx, vz = car.vz;
    if (!Number.isFinite(vx) || !Number.isFinite(vz) || (Math.abs(vx) + Math.abs(vz)) < 0.01) {
      vx = fx * (car.v || 0); vz = fz * (car.v || 0);
    }
    const keep = { v: car.v, vx: vx, vz: vz };
    const hull = marine(car);

    // The leaf swings as you go through it and shuts itself a beat later.
    doorOpen = { veh: car, id: pax ? "shotgun" : "driver", t: 0 };
    poseDoor(0.001);

    /* THE EXIT IS THE SHIPPED ONE. cityExitVehicle owns releasing the rig,
       demoting the car, killing the engine voice and standing the body at the
       right door — all of which a jump wants too. What it ALSO does is park the
       car, so the way to make this a jump is to give the car its way back
       immediately afterwards rather than to write a second exit. */
    if (CBZ.cityExitVehicle) CBZ.cityExitVehicle();
    ride = null;

    if (!hull) {
      /* A ROAD CAR CARRIES ON. `_runaway` is read by exactly one place —
         vehicles.js's wreck branch — and it means "nothing hit this, its driver
         left". wreckT is the branch's own lease; 9 s is long enough for 40 m/s
         to coast down to a stop at the runaway decay, and the branch cancels
         itself the moment the car is actually stopped. */
      car.v = keep.v; car.vx = keep.vx; car.vz = keep.vz;
      car._runaway = true;
      car.abandoned = true;
      car.spin = (car.spin || 0);
      car.wreckT = Math.max(car.wreckT || 0, 9);
    }

    // ---- the body: the shared launch, then physics.js owns it -------------
    const dirX = lx * side, dirZ = lz * side;              // out through the door
    const inv = 1 / Math.max(0.001, speed);
    let dx = vx * inv * 0.74 + dirX * 0.66;
    let dz = vz * inv * 0.74 + dirZ * 0.66;
    const dm = Math.hypot(dx, dz) || 1; dx /= dm; dz /= dm;
    const force = Math.max(3.2, Math.min(13, speed * 0.55));
    const up = 1.0 + Math.min(2.0, speed * 0.055);
    if (CBZ.body && CBZ.body.fling) {
      try { CBZ.body.fling(P, { dir: { x: dx, z: dz }, force: force, up: up }); } catch (e) {}
    }
    // Clear of the flank before the tumble starts, so the first frame of the
    // jump is not inside the car you just left.
    P.pos.x += dirX * 0.5; P.pos.z += dirZ * 0.5;
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(P.pos);

    /* ROAD RASH. Tarmac at speed, priced off the one number that matters and
       nothing else — no second fall-damage path (physics.js's ladder still owns
       the landing, and a bad landing hurts on top of this). Lethal on purpose:
       stepping out of a car at 150 km/h should be a decision. */
    const dmg = Math.round(Math.max(0, (speed - STEP_OUT_MS) * 1.35));
    if (dmg > 0 && CBZ.cityHurtPlayer) {
      try { CBZ.cityHurtPlayer(dmg, car.pos.x, car.pos.z, hull ? "jumped from a moving boat" : "jumped from a moving car"); } catch (e) {}
    }
    TALLY.bails++; TALLY.lastBailSpeed = +speed.toFixed(2); TALLY.lastBailDamage = dmg;
    if (CBZ.sfx) CBZ.sfx("whoosh");
    if (CBZ.shake) CBZ.shake(Math.min(0.7, 0.15 + speed * 0.012));
    note(hull ? "Over the side!" : "You throw yourself out — the car keeps going.", 2.0);
    return true;
  }

  function poseDoor(t) {
    if (!doorOpen) return;
    const B = CBZ.boarding;
    if (!B || !B.door) return;
    try { B.door(doorOpen.veh, doorOpen.id, t); } catch (e) {}
  }

  // ============================================================
  //  THE DOOR TICK — before boarding.js's leaf sweep (33.5), because a
  //  leaf nobody claimed this frame is shut, and that is the invariant.
  // ============================================================
  CBZ.onUpdate(33.4, function (dt) {
    if (!doorOpen) return;
    const veh = doorOpen.veh;
    if (!veh || veh.dead || !veh.group || !veh.group.parent) { doorOpen = null; return; }
    doorOpen.t += dt;
    if (doorOpen.t >= DOOR_HOLD) { doorOpen = null; return; }
    // opens fast, hangs, then falls shut with the car's own motion
    const u = doorOpen.t / DOOR_HOLD;
    poseDoor(u < 0.25 ? u / 0.25 : Math.max(0.05, 1 - (u - 0.25) / 0.75));
  });

  // ============================================================
  //  THE RIDE TICK — self-healing, the ghost-throttle probe, and the
  //  seat/camera sync for the frames a companion owns the car.
  //  Order 36.7: after boarding.js's driver loop (36.6) has moved it.
  // ============================================================
  CBZ.onUpdate(36.7, function (dt) {
    if (!ride) return;
    const P = CBZ.player;
    const car = ride.veh;
    /* SELF-HEAL. Every way a ride can end without passing through
       cityExitVehicle — the car explodes, the player dies, the mode changes,
       something else takes the wheel out of band. A record that outlives its
       vehicle is the audit's `orphanRides` and it is pinned at 0, so it is
       counted here rather than quietly cleaned. */
    if (!inCity() || !P || P.dead || !P.driving || P._vehicle !== car ||
        !car || car.dead || !car.group || !car.group.parent) {
      if (car && (car.dead || !car.group || !car.group.parent)) TALLY.orphanRides++;
      ride = null;
      return;
    }
    ride.t += dt;
    TALLY.paxFrames++;

    const chauffeured = CBZ.cityPaxChauffeured(car);
    const sp = speedOf(car);
    /* THE RATCHET, MEASURED AT THE PEDAL RATHER THAN AT THE WHEELS.
       The first cut of this counter watched SPEED and flagged any gain, which
       is wrong in a way worth writing down: a passenger's car legitimately
       gains speed when something rams it, when a blast shoves it, or when it
       is pushed off a kerb, and none of those is an input reaching the
       controls. It also flagged the probe that sets a speed to test the coast.
       What the claim actually is — "the pedals are dead" — has an exact
       reading: vehicles.js writes `_lastThrottle` from the same key bag the
       loop steers with, once per frame, BEFORE anything physical happens. If
       the empty bag is doing its job that number is 0 on every frame of every
       ride, and if a key ever reaches it, it is not. `_steerInput` is the
       hull's equivalent (water_helm eases it from the same bag): it may be
       mid-decay from the turn you were in when you let go of the wheel, so
       only a RISE counts as somebody steering. */
    const thr = Math.abs(car._lastThrottle || 0);
    const steer = Math.abs(car._steerInput || 0);
    if (!chauffeured) {
      if (thr > 0.001) TALLY.ghostThrottle++;
      else if (steer > ride.lastSteer + 0.001) TALLY.ghostThrottle++;
    }
    ride.lastSpeed = sp;
    ride.lastSteer = steer;
    if (!chauffeured) return;                 // vehicles.js owns the frame

    // ---- somebody else is driving: we own the seat, the body and the shot ---
    TALLY.chauffeuredFrames++;
    const rideY = (car.group.position && car.group.position.y) || 0;
    P.pos.set(car.pos.x, rideY, car.pos.z);
    P.speed = sp;
    if (!(CBZ.carSeatPlayer && CBZ.carSeatPlayer(car, dt))) {
      if (CBZ.playerChar && CBZ.playerChar.group) {
        CBZ.playerChar.group.position.copy(P.pos);
        CBZ.playerChar.group.visible = false;
      }
    }
    if (CBZ.cityUpdatePlayerCarVisual) { try { CBZ.cityUpdatePlayerCarVisual(car, dt); } catch (e) {} }
    // the same recenter the driven car uses, on the same veto
    if (CBZ.cam && sp > 3 && !(CBZ.camRecenterSuspended && CBZ.camRecenterSuspended())) {
      CBZ.cam.yaw = CBZ.lerpAngle(CBZ.cam.yaw, car.heading + Math.PI, 1 - Math.pow(0.02, dt));
    }
  });

  // ============================================================
  //  INPUT — [G] on a keyboard, a pill on a thumb
  // ============================================================
  /* WHY [G] AND NOT A CARD ROW. The doctrine is that verbs live in the
     interaction registry — but the registry deliberately shows NO card while
     you are in a vehicle: `interactions.js`'s SILENT_RIDE set contains the
     "vehicle:inside" kind, so the panel is hidden outright and `current` is
     cleared, which means no row on that layer can reach a key or a touch pill.
     (Worth knowing, and OWED WORK for whoever opens that file: interact.js's
     "Let them out", "Everyone out" and "Have them run it to the warehouse" are
     registered on that layer and are therefore unreachable today. Fixing the
     fold is a change to what the HUD does while you drive, so it is not
     smuggled in here.)

     So an in-vehicle toggle is a key, exactly as [C] cycles the car's body
     style and [V] swaps to the driver's-seat view. [G] is the one letter
     already dead in this seat by DESIGN rather than by luck: city/combat.js's
     grenade throw refuses outright while `CBZ.player.driving`, which covers
     cars, boats and aircraft alike. Nothing else in a vehicle reads it. */
  addEventListener("keydown", function (e) {
    if (!on() || e.repeat) return;
    if (!inCity() || G().state !== "playing" || CBZ.cityMenuOpen) return;
    const P = CBZ.player;
    if (!P || P.dead) return;
    if (!P.driving && !P._aircraft) return;                // on foot: G is the grenade
    if ((e.key || "").toLowerCase() !== "g") return;
    e.preventDefault();
    CBZ.citySeatShift();
  });

  // ============================================================
  //  THE RATCHET
  // ============================================================
  CBZ.cityPaxAudit = function () {
    const car = ride ? ride.veh : null;
    return {
      riding: !!ride,
      vehicle: car ? (car.model && car.model.name) || (marine(car) ? "hull" : "car") : null,
      marine: car ? marine(car) : false,
      chauffeured: car ? CBZ.cityPaxChauffeured(car) : false,
      speed: car ? +speedOf(car).toFixed(2) : 0,
      doorOpen: !!doorOpen,
      shifts: TALLY.shifts, ridesStarted: TALLY.ridesStarted,
      bails: TALLY.bails, stepOuts: TALLY.stepOuts,
      lastBailSpeed: TALLY.lastBailSpeed, lastBailDamage: TALLY.lastBailDamage,
      paxFrames: TALLY.paxFrames, chauffeuredFrames: TALLY.chauffeuredFrames,
      refusedAircraft: TALLY.refusedAircraft, refusedNoSeat: TALLY.refusedNoSeat,
      ghostThrottle: TALLY.ghostThrottle,     // PINNED AT 0
      orphanRides: TALLY.orphanRides,         // PINNED AT 0
      flags: {
        seat: CF.PASSENGER_SEAT_V1 !== false,
        bail: CF.VEHICLE_BAIL !== false,
        chauffeur: CF.PAX_CHAUFFEUR !== false,
        aircraft: CF.PAX_AIRCRAFT === true,   // declared, off
      },
    };
  };
})();
