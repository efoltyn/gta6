/* ============================================================
   systems/airline.js — AEROPLANES THAT ACTUALLY GO SOMEWHERE.

   OWNER (2026-08-09): "have planes actually actually go up to the runway,
   take off, land at the other airport."

   WHAT WAS THERE BEFORE. Four airliners bolted to four gates and never
   moved; one scripted pushback that creeps four metres and resets; ambient
   GA traffic orbiting the city on fixed rings (city/airtraffic.js) that
   never touches a runway. Nothing in the game had ever taken off from one
   place and landed at another.

   WHAT THIS FILE ADDS, AND WHAT IT REFUSES TO ADD. It adds a SHUTTLE: an
   aeroplane that lives at a gate, boards, taxis to the holding point, lines
   up, rolls, rotates, climbs, cruises, descends on the extended centreline
   of the far field's into-wind end, touches down in the touchdown zone,
   brakes, taxis in, parks at a free stand, turns round and flies back. That
   is the whole feature.

   It adds NO AEROPLANE. The airframe is claimed out of the parked fleet
   island_airport.js and city/airport_kit.js already built — a full
   `placed` record, which is why every one of these comes free and none of it
   is re-implemented here:

     • THE PILOTS. The cabin ships two cockpit seats marked
       `reservedForNpc` with `role:"pilot"`; entities/npclife.js casts real
       uniformed bodies into them whenever anybody is close enough to see
       them, and island_airport.js's order-55.2 seat hold keeps them facing
       forward in a hull that is now moving. The owner asked for "planes
       flown by pilots" and the seats for them were already in the aeroplane.
     • THE CABIN — passengers, doors that ease open at the gate, the walk-in
       board, the deplane file, the seats you can sit in.
     • THE CONSEQUENCES. It is still a damageable civil aircraft: shoot one
       down on final and it dies the way it always did. Hijack one at the
       gate (`rec.taken`) and THE FLIGHT IS CANCELLED — the shuttle lets go
       of the airframe the same frame, because an aeroplane you stole is not
       an aeroplane the airline still operates.

   THE PROFILE IS SCALE-HONEST, NOT ABSOLUTE-HONEST, and that is a decision
   rather than an oversight. Halloran and Cape Harbor are 2.2 km apart. A
   real A320 needs ~30 km to climb to cruise and come back down; flown to the
   real numbers this aeroplane would be at 400 ft over the far threshold
   still accelerating. So the SHAPE is preserved — a steeper climb than
   descent, top-of-descent well before the field, a stabilised final on the
   centreline, wheels in the touchdown zone — and the magnitudes are scaled
   to the world the owner actually flies in. Cruise altitude is 6% of the leg
   (90-380 m), and the altitude is a closed-form TRAPEZOID of distance rather
   than an integrated climb rate, which is why it cannot oscillate, cannot
   overshoot and lands at exactly zero every time:

       alt = min(cruise, flown * tan(9deg), toTouchdown * tan(5.5deg))

   On a leg too short for cruise the two caps simply cross below it and the
   aeroplane flies a triangle. Nothing special-cases the short leg.

   Flags: `AIRLINE_V1=false` -> no shuttles, the fleet stays parked, and the
   world is exactly the one before this file. Ratchet:
   `CBZ.airlineAudit().stranded` (shuttles that hold an airframe but can
   reach no gate) pinned at 0.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.AIRLINE_V1 == null) CFG.AIRLINE_V1 = true;

  // ---- the numbers, all in metres and seconds ---------------------------
  const TAXI_SPD = 8.5;          // apron/taxiway speed
  const TAXI_ACC = 2.2;
  const TURN_RATE = 0.55;        // rad/s on the ground (a tight airliner turn)
  const AIR_TURN = 0.24;         // rad/s in the air -> a ~60 s 360, i.e. rate one
  /* TAKE-OFF ACCELERATION, and it is scaled for the same reason the climb
     profile is. An A320 accelerates at ~2 m/s2 and needs ~1.8 km of concrete.
     This world's longest runway is 1,090 m and its shortest is 900 — so at the
     real number the aeroplane uses 1,089 m of Halloran's 1,090 (measured: the
     take-off roll took 90 sim-seconds and rotated over the far threshold) and
     runs clean off the end at Cape Harbor. 4.5 m/s2 puts the roll at 484 m,
     which is 54% of the SHORTEST field — the margin a real one is built with.
     The audit at the bottom of this file now checks that relationship for
     every registered field instead of leaving it to arithmetic nobody redoes. */
  const ROLL_ACC = 4.5;          // take-off acceleration
  const VR = 66;                 // rotate speed
  const V_CLIMB = 92;
  const V_CRUISE = 132;
  const V_APP = 58;              // over the threshold
  const BRAKE = 3.2;             // after touchdown (brakes + reversers)
  const TAN_CLIMB = Math.tan(9 * Math.PI / 180);
  const TAN_GLIDE = Math.tan(5.5 * Math.PI / 180);
  const FINAL_D = 700;           // final approach fix, before the threshold
  const FLARE_D = 60;            // the profile commands zero THIS far short of
                                 // the aiming point, to absorb the ease lag
  const MAX_PITCH = 9 * Math.PI / 180;
  const MAX_BANK = 15 * Math.PI / 180;
  const TURN_S = 45;             // on stand, doors shut
  const BOARD_S = 40;            // doors open at the gate
  const HOLD_MAX = 150;          // how long a ticket holds the aeroplane
  const FARE_BASE = 120, FARE_PER_M = 0.25;

  const shuttles = (CBZ.airlineShuttles = []);
  let cityRef = null;
  let ticket = null;             // the player's booking (city/ticketing.js sets it)
  let uid = 0;

  function note(m, s) { if (CBZ.city && CBZ.city.note) { try { CBZ.city.note(m, s || 2.6); } catch (e) {} } }
  function fwd(h) { return { x: Math.cos(h), z: -Math.sin(h) }; }
  function headingTo(x, z, tx, tz) { return Math.atan2(z - tz, tx - x); }
  function wrap(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }
  function dist(ax, az, bx, bz) { return Math.hypot(bx - ax, bz - az); }

  /* ==============================================================
     CLAIMING AN AIRFRAME. The fleet is already on the ramp; a
     shuttle is a parked aeroplane that has somewhere to be. We bind
     records to gates by POSITION, because that is the one fact the
     two builders (island_airport.js and airport_kit.js) both state
     out loud — neither of them knows this file exists.
     ============================================================== */
  function bindGates() {
    const recs = (CBZ.airportKit && CBZ.airportKit.records) ? CBZ.airportKit.records() : null;
    if (!recs) return;
    for (let i = 0; i < CBZ.airports.length; i++) {
      const ap = CBZ.airports[i];
      for (let k = 0; k < ap.gates.length; k++) {
        const g = ap.gates[k];
        if (g.occupant && g.occupant.group) continue;      // already a live record
        g.occupant = null;
        for (let r = 0; r < recs.length; r++) {
          const rec = recs[r];
          if (!rec || !rec.group || !rec.group.parent || rec.taken || rec.destroyed) continue;
          if (rec.flightKind !== "airliner") continue;
          if (rec._airlineGate) continue;
          if (dist(rec.group.position.x, rec.group.position.z, g.x, g.z) > 6) continue;
          g.occupant = rec; rec._airlineGate = g; rec._airlineHome = ap;
          break;
        }
      }
    }
  }

  function freeGate(ap, holder) {
    for (let i = 0; i < ap.gates.length; i++) {
      const g = ap.gates[i];
      if (!g.occupant || g.occupant === holder) return g;
    }
    return null;
  }

  // Which end do you use to fly THIS course? The end whose departure
  // direction most nearly matches it — the whole runway-selection decision at
  // a one-runway field, minus the wind we do not simulate.
  function endForCourse(ap, course) {
    let best = ap.ends[0], bd = -2;
    for (let i = 0; i < ap.ends.length; i++) {
      const d = Math.cos(ap.ends[i].dir - course);
      if (d > bd) { bd = d; best = ap.ends[i]; }
    }
    return best;
  }

  function fare(a, b) {
    return Math.round((FARE_BASE + CBZ.airportDistance(a, b) * FARE_PER_M) / 10) * 10;
  }

  /* ==============================================================
     THE SHUTTLE
     ============================================================== */
  function makeShuttle(rec, ap, dest) {
    const s = {
      id: "flt" + (++uid),
      rec: rec, grp: rec.group,
      at: ap, to: dest, gate: rec._airlineGate || null,
      phase: "turn", t: 0, hold: 0,
      spd: 0, alt: 0, pitch: 0, bank: 0,
      route: [], wp: 0,
      liftoff: null, faf: null, td: null, arrEnd: null, depEnd: null,
      cruiseAlt: 0, legD: 0,
      dead: false, playerAboard: false,
    };
    s.grp.rotation.order = "YXZ";   // heading, then bank, then pitch — see below
    if (s.gate) s.gate.occupant = rec;
    return s;
  }

  function abandon(s, why) {
    if (s.dead) return;
    s.dead = true;
    if (s.gate && s.gate.occupant === s.rec) s.gate.occupant = null;
    if (s.rec) { s.rec._airlineGate = null; s.rec._airlineShuttle = null; }
    if (ticket && ticket.shuttle === s) {
      note("Flight " + s.id.toUpperCase() + " cancelled · " + why + ". Your fare is refunded.", 4);
      if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(ticket.price);
      ticket = null; CBZ.airlineTicket = null;
    }
  }

  // ---- ground route builders (all LOCAL to the field, then toWorld) ------
  function nearestConn(ap, lx) {
    const H = ap.runway.len / 2;
    const cs = ap.connectors && ap.connectors.length ? ap.connectors : [-H + 45, 0, H - 45];
    let best = cs[0], bd = Infinity;
    for (let i = 0; i < cs.length; i++) {
      const d = Math.abs(cs[i] - lx);
      if (d < bd) { bd = d; best = cs[i]; }
    }
    return best;
  }

  function routeOut(s) {
    const ap = s.at, g = s.gate;
    const H = ap.runway.len / 2;
    const course = headingTo(ap.x, ap.z, s.to.x, s.to.z);
    const end = endForCourse(ap, course);
    s.depEnd = end;
    // BACKTRACK, which is what a field with connectors rather than a
    // full-length parallel taxiway actually does: cross onto the runway at the
    // nearest connector, roll down to the threshold, turn round, line up.
    const conn = nearestConn(ap, end.sign * (H - 60));
    const gl = g ? { lx: g.lx, lz: g.lz } : ap.toLocal(s.grp.position.x, s.grp.position.z);
    const pts = [
      [gl.lx, ap.taxiZ],
      [conn, ap.taxiZ],
      [conn, 0],
      [end.sign * (H - 25), 0],
    ];
    s.route = pts.map(function (p) { const w = ap.toWorld(p[0], p[1]); return { x: w.x, z: w.z }; });
    s.wp = 0; s.wpBest = null; s.wpStale = 0;
  }

  function routeIn(s) {
    const ap = s.at, g = s.gate;
    const l = ap.toLocal(s.grp.position.x, s.grp.position.z);
    const conn = nearestConn(ap, l.lx);
    const pts = [[conn, 0], [conn, ap.taxiZ], [g.lx, ap.taxiZ], [g.lx, g.lz]];
    s.route = pts.map(function (p) { const w = ap.toWorld(p[0], p[1]); return { x: w.x, z: w.z }; });
    s.wp = 0; s.wpBest = null; s.wpStale = 0;
  }

  function armAir(s) {
    const from = s.at, to = s.to;
    const course = headingTo(from.x, from.z, to.x, to.z);
    const arr = endForCourse(to, course);
    s.arrEnd = arr;
    const d = fwd(arr.dir);
    s.faf = { x: arr.x - d.x * FINAL_D, z: arr.z - d.z * FINAL_D };
    s.td = { x: arr.tdz.x, z: arr.tdz.z };
    s.legD = CBZ.airportDistance(from, to);
    s.cruiseAlt = Math.max(90, Math.min(380, s.legD * 0.06));
    s.liftoff = { x: s.grp.position.x, z: s.grp.position.z };
    s.onFinal = false;
  }

  // ---- the shared mover: steer toward a point, obeying a turn rate ------
  function steer(s, tx, tz, rate, dt) {
    const want = headingTo(s.grp.position.x, s.grp.position.z, tx, tz);
    const dh = wrap(want - s.grp.rotation.y);
    const step = Math.max(-rate * dt, Math.min(rate * dt, dh));
    s.grp.rotation.y += step;
    return { dh: dh, rate: step / Math.max(1e-6, dt) };
  }

  function advance(s, dt) {
    const f = fwd(s.grp.rotation.y);
    const dx = f.x * s.spd * dt, dz = f.z * s.spd * dt;
    s.grp.position.x += dx; s.grp.position.z += dz;
    return { dx: dx, dz: dz };
  }

  function accelTo(s, target, acc, dt) {
    if (s.spd < target) s.spd = Math.min(target, s.spd + acc * dt);
    else s.spd = Math.max(target, s.spd - acc * dt);
  }

  /* ==============================================================
     ONE TICK OF ONE SHUTTLE
     ============================================================== */
  function tick(s, dt) {
    const rec = s.rec;
    if (!rec || !rec.group || !rec.group.parent) { abandon(s, "the aircraft is gone"); return; }
    if (rec.taken) { abandon(s, "the aircraft was taken"); return; }
    if (rec.destroyed) { abandon(s, "the aircraft was destroyed"); return; }

    const before = { x: s.grp.position.x, y: s.grp.position.y, z: s.grp.position.z };
    s.playerAboard = !!(CBZ.cabinRider && CBZ.cabinRider(rec));

    switch (s.phase) {
      case "turn": {
        s.spd = 0; s.t += dt;
        if (s.t >= TURN_S) {
          s.t = 0; s.hold = 0; s.phase = "boarding";
          if (ticket && ticket.shuttle === s) {
            note("Now boarding " + s.id.toUpperCase() + " to " + s.to.name + " · stand " + (s.gate ? s.gate.id : "?") + ".", 4);
          }
        }
        break;
      }
      case "boarding": {
        s.spd = 0; s.t += dt;
        // THE DOOR IS THE AIRPORT'S, NOT OURS. cityAircraftDoorSet is the same
        // verb the boarding arc and the deplane use; setting it here is what
        // makes a gate aeroplane read as one that is loading.
        if (CBZ.cityAircraftDoorSet) { try { CBZ.cityAircraftDoorSet(rec, true); } catch (e) {} }
        // A ticket HOLDS the aeroplane. Miss it anyway and the fare rolls to
        // the next departure rather than evaporating — a missed connection is
        // an annoyance, not a robbery.
        const waiting = ticket && ticket.shuttle === s && !s.playerAboard;
        if (waiting) s.hold += dt;
        if (s.t >= BOARD_S && (!waiting || s.hold >= HOLD_MAX)) {
          if (waiting) {
            note("Flight " + s.id.toUpperCase() + " has closed. Your seat rolls to the next departure.", 4);
            ticket.shuttle = null;
          }
          if (CBZ.cityAircraftDoorSet) { try { CBZ.cityAircraftDoorSet(rec, false); } catch (e) {} }
          if (s.gate && s.gate.occupant === rec) s.gate.occupant = null;
          routeOut(s);
          s.phase = "taxiOut"; s.t = 0;
          if (s.playerAboard) note("Doors closed. " + s.at.code + " to " + s.to.code + " · taxiing to runway " + s.depEnd.name + ".", 4);
        }
        break;
      }
      case "taxiOut":
      case "taxiIn": {
        const wpt = s.route[s.wp];
        if (!wpt) {
          if (s.phase === "taxiOut") { s.phase = "lineup"; s.t = 0; }
          else { s.phase = "park"; s.t = 0; }
          break;
        }
        const d = dist(s.grp.position.x, s.grp.position.z, wpt.x, wpt.z);
        const last = s.wp === s.route.length - 1;
        const t = steer(s, wpt.x, wpt.z, TURN_RATE, dt);
        // slow for a turn and for the last few metres — an airliner does not
        // take a taxiway corner at 8 m/s.
        const turnCut = 1 - Math.min(0.72, Math.abs(t.dh) * 0.55);
        const target = Math.max(1.6, TAXI_SPD * turnCut * (last ? Math.min(1, d / 18) : 1));
        accelTo(s, target, TAXI_ACC, dt);
        advance(s, dt);
        /* THE WATCHDOG, and it is not defensive padding. A turn-rate-limited
           follower ORBITS any waypoint whose capture radius is smaller than
           its own turn circle: at 8.5 m/s and 0.55 rad/s the circle is 15.5 m
           against a 9 m capture, so one badly-approached corner is an airliner
           doing laps of a taxiway intersection for ever — and a shuttle that
           never departs is a departures board that counts down to nothing.
           The turn-cut usually keeps the circle small enough; when it does not,
           a waypoint that has stopped getting closer for 10 s is a waypoint
           already made, so take it and fly. Cutting one corner is a far
           smaller lie than a wedged network. */
        if (s.wpBest == null || d < s.wpBest - 0.5) { s.wpBest = d; s.wpStale = 0; }
        else s.wpStale += dt;
        // The capture radius has to EXCEED the turn circle or the corner can
        // never be made: 8.5 m/s at 0.55 rad/s is a 15.5 m circle, and the old
        // 9 m sent the aeroplane round the intersection until the turn-cut
        // bled off enough speed to fall inside it (measured: a 780 m taxi took
        // 240 sim-seconds, an effective 3.2 m/s). 20 m captures cleanly, and
        // cutting a taxiway corner by that much is what aircraft do anyway.
        if (d < (last ? 2.2 : 20) || s.wpStale > 10) { s.wp++; s.wpBest = null; s.wpStale = 0; }
        break;
      }
      case "lineup": {
        // swing onto the centreline heading, then release the brakes.
        const dh = wrap(s.depEnd.dir - s.grp.rotation.y);
        const step = Math.max(-TURN_RATE * dt, Math.min(TURN_RATE * dt, dh));
        s.grp.rotation.y += step;
        accelTo(s, 1.2, TAXI_ACC, dt);
        advance(s, dt);
        if (Math.abs(dh) < 0.02) {
          s.grp.rotation.y = s.depEnd.dir;
          s.phase = "roll"; s.t = 0;
          armAir(s);
          if (s.playerAboard) note("Cleared for take-off, runway " + s.depEnd.name + ".", 3);
        }
        break;
      }
      case "roll": {
        accelTo(s, V_CLIMB, ROLL_ACC, dt);
        // hold the centreline: steer at the far threshold, gently.
        const far = s.at.toWorld(s.depEnd.sign * -(s.at.runway.len / 2 - 20), 0);
        steer(s, far.x, far.z, 0.25, dt);
        advance(s, dt);
        if (s.spd >= VR) {
          s.phase = "air"; s.t = 0;
          s.liftoff = { x: s.grp.position.x, z: s.grp.position.z };
        }
        break;
      }
      case "air": {
        // ---- horizontal: fly to the final approach fix, then the touchdown
        const toFaf = dist(s.grp.position.x, s.grp.position.z, s.faf.x, s.faf.z);
        const fafToTd = dist(s.faf.x, s.faf.z, s.td.x, s.td.z);
        // ON FINAL IS A LATCH, not a distance test. Once the fix is behind
        // you the distance to it grows again, and an un-latched test turns the
        // aeroplane round to go back and fly over it — measured, on the first
        // approach ever flown.
        if (!s.onFinal && toFaf < 60) s.onFinal = true;
        const beyondFaf = s.onFinal;
        const tgt = beyondFaf ? s.td : s.faf;
        const toTd = beyondFaf
          ? dist(s.grp.position.x, s.grp.position.z, s.td.x, s.td.z)
          : toFaf + fafToTd;
        // A stabilised final is allowed a firmer turn than an en-route leg:
        // measured, rate one put the wheels down 15 m off a 30 m centreline —
        // on the paint, but on the EDGE of it. Lining up is the one thing an
        // approach is for.
        const t = steer(s, tgt.x, tgt.z, beyondFaf ? AIR_TURN * 2.2 : AIR_TURN, dt);
        /* ---- speed: a CLOSED FORM OF DISTANCE, exactly like the altitude
           above, and for the same reason. The first version bled speed at a
           fixed rate from a fixed range and simply ran out of runway to do it
           in: measured, the aeroplane crossed Cape Harbor's threshold at
           75 m/s instead of 58, which is 879 m of braking on 750 m of
           concrete. Tying the speed to distance-to-touchdown makes crossing
           the threshold at V_APP a property of the arithmetic rather than a
           hope, on any leg length. The implied deceleration is steep because
           the legs are 2 km rather than the 30 km a real approach uses —
           the same scaling the climb profile already declares. */
        const vWant = Math.min(V_CRUISE, V_APP + Math.max(0, toTd - 120) * 0.075);
        accelTo(s, vWant, toTd > 1100 ? 1.3 : 4.0, dt);
        advance(s, dt);
        // ---- vertical: the closed-form trapezoid (see the header)
        const flown = dist(s.grp.position.x, s.grp.position.z, s.liftoff.x, s.liftoff.z);
        // THE FLARE BIAS. The profile is commanded to ZERO from FLARE_D short
        // of the touchdown point, not at it, because the easing below lags —
        // and an aeroplane still 12 m up as it crosses the touchdown point
        // does not land, it flies past and comes round again. Measured, on the
        // first approach ever flown: 250 sim-seconds orbiting Cape Harbor.
        const want = Math.max(0, Math.min(s.cruiseAlt, flown * TAN_CLIMB, Math.max(0, toTd - FLARE_D) * TAN_GLIDE));
        const prevAlt = s.alt;
        // ease rather than snap, so the profile's two corners are rounded the
        // way a real aeroplane rounds them — but tighten it near the ground,
        // where the lag is the difference between a landing and a go-around.
        s.alt += (want - s.alt) * Math.min(1, dt * (s.alt < 25 ? 3.6 : 1.8));
        s.grp.position.y = s.alt;
        // attitude: pitch from the actual flight-path angle, bank from the
        // actual turn rate. Both are consequences, never animations.
        const fpa = s.spd > 1 ? Math.atan2((s.alt - prevAlt) / Math.max(1e-4, dt), s.spd) : 0;
        s.pitch += (Math.max(-MAX_PITCH, Math.min(MAX_PITCH, fpa)) - s.pitch) * Math.min(1, dt * 2);
        const bWant = Math.max(-MAX_BANK, Math.min(MAX_BANK, t.rate * 2.6));
        s.bank += (bWant - s.bank) * Math.min(1, dt * 2);
        s.grp.rotation.z = s.pitch; s.grp.rotation.x = s.bank;
        // ARE THE WHEELS DOWN? Two ways, and the second is the one that makes
        // it impossible to miss: either the profile has flown you onto the
        // ground near the aiming point, OR you are PAST it measured along the
        // landing direction. A distance test alone is a test that grows again
        // the moment you overfly the mark, which is a go-around nobody asked
        // for and a shuttle that never arrives.
        const ld = fwd(s.arrEnd.dir);
        const past = (s.grp.position.x - s.td.x) * ld.x + (s.grp.position.z - s.td.z) * ld.z;
        if (beyondFaf && ((s.alt < 0.35 && toTd < 90) || past >= 0)) {
          s.grp.position.y = 0; s.alt = 0;
          s.pitch = 0; s.bank = 0;
          s.grp.rotation.z = 0; s.grp.rotation.x = 0;
          s.phase = "rollout"; s.t = 0;
          // arriving: the far field is now home.
          const prev = s.at; s.at = s.to; s.to = prev;
          s.gate = freeGate(s.at, rec);
          if (!s.gate) { s.stranded = true; s.gate = s.at.gates[0] || null; }
          if (s.gate) s.gate.occupant = rec;
          if (s.playerAboard) note("Welcome to " + s.at.name + ".", 4);
        }
        break;
      }
      case "rollout": {
        /* BRAKE AS HARD AS THE CONCRETE LEFT DEMANDS. The nominal rate stops
           an aeroplane that crossed the threshold at V_APP inside every field
           in the network (the shortFields audit checks exactly that), but a
           runway is a hard limit rather than a target: if anything ever puts
           an aircraft down long or fast, standing on the brakes is what a crew
           does, and running off the end into the sea is not an option the
           simulation should keep open. Solved from the runway actually
           remaining, so it is a no-op on a normal landing. */
        const l = s.at.toLocal(s.grp.position.x, s.grp.position.z);
        const remain = Math.max(20, s.at.runway.len / 2 - (-s.arrEnd.sign) * l.lx - 25);
        const need = (s.spd * s.spd - TAXI_SPD * TAXI_SPD) / (2 * remain);
        accelTo(s, TAXI_SPD, Math.max(BRAKE, need), dt);
        const far = s.at.toWorld(s.arrEnd.sign * -(s.at.runway.len / 2 - 20), 0);
        steer(s, far.x, far.z, 0.2, dt);
        advance(s, dt);
        if (s.spd <= TAXI_SPD + 0.1) { routeIn(s); s.phase = "taxiIn"; s.t = 0; }
        break;
      }
      case "park": {
        s.spd = 0;
        // settle exactly on the stand so the next departure starts from the
        // stand the field declared, not from where the taxi happened to stop.
        if (s.gate) {
          s.grp.position.x += (s.gate.x - s.grp.position.x) * Math.min(1, dt * 2.5);
          s.grp.position.z += (s.gate.z - s.grp.position.z) * Math.min(1, dt * 2.5);
          const dh = wrap(s.gate.worldHeading - s.grp.rotation.y);
          s.grp.rotation.y += dh * Math.min(1, dt * 2.5);
        }
        s.t += dt;
        if (s.t > 3) {
          if (s.gate) { s.grp.position.set(s.gate.x, 0, s.gate.z); s.grp.rotation.y = s.gate.worldHeading; }
          if (CBZ.cityAircraftDoorSet) { try { CBZ.cityAircraftDoorSet(rec, true); } catch (e) {} }
          if (CBZ.cityDeplane && !s.playerAboard) { try { CBZ.cityDeplane(rec, { limit: 6 }); } catch (e) {} }
          if (ticket && ticket.shuttle === s && s.playerAboard) {
            note("Arrived at " + s.at.name + ". Mind the step.", 4);
            ticket = null; CBZ.airlineTicket = null;
          }
          rec._airlineGate = s.gate;
          s.phase = "turn"; s.t = 0;
        }
        break;
      }
    }

    // keep the boardable record's own fields honest — 20 systems read these.
    rec.heading = s.grp.rotation.y;
    // AND CARRY WHOEVER IS IN THE CABIN. island_airport.js owns the room; this
    // is the one call that tells it the room moved.
    if (s.playerAboard && CBZ.cabinCarry) {
      CBZ.cabinCarry(rec, s.grp.position.x - before.x, s.grp.position.y - before.y, s.grp.position.z - before.z);
    }
  }

  /* ==============================================================
     BOOT / REBUILD. Landmass builders re-run on a world rebuild and
     hand us a fresh `placed` fleet; every shuttle we hold is then a
     ghost pointing at a detached group.
     ============================================================== */
  function boot() {
    shuttles.length = 0;
    uid = 0;
    if (CFG.AIRLINE_V1 === false) return;
    if (!CBZ.airports || CBZ.airports.length < 2) return;
    bindGates();
    // ONE SHUTTLE PER FIELD, each pointed at the busiest other field. Two
    // airports therefore give two aeroplanes passing each other in the air,
    // which is exactly the reading the owner asked for and costs two hulls
    // that were already built and parked.
    for (let i = 0; i < CBZ.airports.length; i++) {
      const ap = CBZ.airports[i];
      const others = CBZ.airportOthers(ap);
      if (!others.length) continue;
      let dest = others[0];
      for (const o of others) if (o.hub && !ap.hub) dest = o;
      let claimed = null;
      for (let k = 0; k < ap.gates.length; k++) {
        const g = ap.gates[k];
        const rec = g.occupant;
        if (rec && rec.group && rec.group.parent && !rec.taken && !rec.destroyed && !rec._airlineShuttle) {
          claimed = rec; break;
        }
      }
      if (!claimed) continue;
      const s = makeShuttle(claimed, ap, dest);
      claimed._airlineShuttle = s;
      // stagger the two so they are never in the same phase — half a turn
      // apart means one is boarding while the other is airborne.
      s.t = i * (TURN_S / 2);
      shuttles.push(s);
    }
  }
  CBZ.airlineReset = boot;

  CBZ.onUpdate(42.9, function (dt) {
    if (CFG.AIRLINE_V1 === false) return;
    if (!CBZ.game || CBZ.game.mode !== "city") return;
    if (!CBZ.airports || CBZ.airports.length < 2) return;
    if (cityRef !== CBZ.city) { cityRef = CBZ.city; boot(); }
    if (!shuttles.length) return;
    if (dt > 0.25) dt = 0.25;                 // a stall must not teleport an aeroplane
    for (let i = shuttles.length - 1; i >= 0; i--) {
      const s = shuttles[i];
      try { tick(s, dt); } catch (e) { try { console.error("[airline]", s.id, e); } catch (e2) {} abandon(s, "a fault"); }
      if (s.dead) shuttles.splice(i, 1);
    }
  });

  /* ==============================================================
     THE TICKET COUNTER'S SIDE OF THE WALL. city/ticketing.js owns
     the desk, the prompt and the money; this owns what a seat IS.
     ============================================================== */
  // Roughly how long until this shuttle is next boarding at `ap`, in seconds.
  // Honest about the phases it cannot time precisely (an airborne leg depends
  // on where it is), which is why the airborne case measures real distance.
  function etaBoarding(s, ap) {
    if (s.at === ap) {
      if (s.phase === "turn") return Math.max(0, TURN_S - s.t);
      if (s.phase === "boarding") return 0;
      return null;                          // it is leaving; catch the next one
    }
    if (s.to !== ap) return null;
    let d = 0;
    if (s.phase === "air") {
      const toTd = dist(s.grp.position.x, s.grp.position.z, s.td.x, s.td.z);
      d = toTd / V_CRUISE + 70;             // + rollout, taxi in, turnaround
    } else d = (s.legD || 2000) / V_CRUISE + 160;
    return d;
  }

  CBZ.airlineDepartures = function (ap) {
    const out = [];
    if (!ap) return out;
    for (let i = 0; i < shuttles.length; i++) {
      const s = shuttles[i];
      if (s.dead) continue;
      const other = s.at === ap ? s.to : (s.to === ap ? s.at : null);
      if (!other) continue;
      const eta = etaBoarding(s, ap);
      if (eta == null) continue;
      out.push({
        shuttle: s, id: s.id, to: other, eta: eta,
        gate: s.at === ap && s.gate ? s.gate.id : null,
        boarding: s.at === ap && s.phase === "boarding",
        price: fare(ap, other),
      });
    }
    out.sort(function (a, b) { return a.eta - b.eta; });
    return out;
  };

  CBZ.airlineBook = function (dep) {
    if (!dep || !dep.shuttle || dep.shuttle.dead) return null;
    ticket = {
      shuttle: dep.shuttle, id: dep.shuttle.id,
      from: dep.shuttle.at, to: dep.to, price: dep.price,
      gate: dep.gate, bought: true,
    };
    CBZ.airlineTicket = ticket;
    return ticket;
  };

  CBZ.airlineCancelTicket = function () { ticket = null; CBZ.airlineTicket = null; };
  CBZ.airlineFare = fare;

  /* ==============================================================
     THE RATCHET. `stranded` is a shuttle that landed with nowhere to
     park — the one failure that silently wedges the network. Pinned
     at 0. `crewed` is reported beside it because "planes flown by
     pilots" is the ask, and a flight whose cockpit seats are empty
     while somebody is watching is the failure of it.
     ============================================================== */
  /* IS THIS FIELD LONG ENOUGH FOR THE AEROPLANE THE NETWORK FLIES? Pure
     arithmetic off this file's own constants and the field's own runway, so it
     is answerable without flying anything and it stays true when somebody
     retunes an acceleration. `shortFields` is what stops the next airport
     being declared with 400 m of runway and discovering it by watching an
     airliner drive into the sea. 1.15 is the margin a real field is built to. */
  const TAKEOFF_RUN = (VR * VR) / (2 * ROLL_ACC);
  const LANDING_RUN = (V_APP * V_APP) / (2 * BRAKE);
  function fieldTooShort(ap) {
    if (!ap || !ap.runway) return false;
    if (ap.runway.len < TAKEOFF_RUN * 1.15) return true;
    return (ap.runway.len - ap.runway.tdz) < LANDING_RUN * 1.15;
  }

  CBZ.airlineAudit = function () {
    let stranded = 0, crewed = 0, airborne = 0;
    const rows = [];
    let shortFields = 0;
    const shortWhere = [];
    if (CBZ.airports) {
      for (const ap of CBZ.airports) {
        if (fieldTooShort(ap)) { shortFields++; shortWhere.push(ap.code + ":" + Math.round(ap.runway.len) + "m"); }
      }
    }
    for (let i = 0; i < shuttles.length; i++) {
      const s = shuttles[i];
      if (s.stranded) stranded++;
      if (s.phase === "air") airborne++;
      let pilots = 0;
      const cab = s.grp && s.grp.userData && s.grp.userData.cabin;
      if (cab && cab.seats) {
        for (const seat of cab.seats) if (seat.cockpit && seat.occupant) pilots++;
      }
      if (pilots > 0) crewed++;
      rows.push({
        id: s.id, phase: s.phase, at: s.at.code, to: s.to.code,
        spd: Math.round(s.spd), alt: Math.round(s.alt), pilots: pilots,
        gate: s.gate ? s.gate.id : null,
      });
    }
    return {
      shuttles: shuttles.length, airborne: airborne, crewed: crewed,
      stranded: stranded, ticket: ticket ? ticket.id : null, rows: rows,
      shortFields: shortFields, shortWhere: shortWhere,
      takeoffRun: Math.round(TAKEOFF_RUN), landingRun: Math.round(LANDING_RUN),
    };
  };
})();
