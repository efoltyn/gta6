/* ============================================================
   systems/liftcore.js — THE LIFT, AS A MACHINE. No THREE, no DOM.

   One state machine for every lift in the game: the city's walk-in cabs
   (city/elevators.js) and the island towers' shaft cars
   (world/disaster_arena.js). Each owner keeps its own body (sealed cab
   rooms swapped mid-ride in the city, a real car climbing a shaft on the
   island) and hands this file an `io` of senses and effectors. What a lift
   DOES is decided here, once, so the two can never disagree about it:

     call(i)  the call button at stop i. The car COMES (if it is elsewhere)
              and the doors OPEN. Pressed again while they are open, they
              stay open longer. Never rides you anywhere.
     go(j)    a floor button in the car. Only a rider standing in the car
              can press it; the doors close and the car goes to stop j,
              and the doors open there. A rider who steps back out while
              the doors close cancels the trip.
     park(i)  an empty car goes home with its doors shut.

   States:  idle   parked at `at`, doors shut
            come   empty car travelling to a call (`dest`)
            open   doors open at `at` (after a call, or `arrived` after a ride)
            close  doors closing at `at`; rides to `dest` once sealed
            ride   the rider travelling at -> dest
            park   empty car travelling home, doors stay shut

   The doors HOLD while anyone stands in the doorway or in the car; an
   empty car's doors close on their own (WAIT_OPEN after a call, as soon as
   the rider is clear after an arrival).

   io (all optional except where the owner needs them):
     inside(i) doorway(i)   is the player in the car / the leaf line at stop i
     doorOpen(i)            0..1 how far the doors at stop i are open
     door(i, open)          drive the doors at stop i
     seal(i)                the doors at stop i are fully shut (collider)
     travel(m, dt)          move the car along m.at -> m.dest; true on arrival.
                            m.t is the time in the state, m.moved is scratch
                            the owner may use (reset on entry)
     arrive(i, rode)        the car reached stop i (rode: with the rider)
     lit(on)                the call buttons / hall lanterns
     sfx(name)
   ============================================================ */
(function (root) {
  "use strict";

  const WAIT_OPEN = 4.0;      // a called car's doors hold this long for a boarder
  const LEAVE_ARM = 1.2;      // arrival: the leave check arms after this...
  const LEAVE_OPEN = 0.5;     // ...and once the doors are this far open
  const REOPEN_HOLD = 1.4;    // a doorway reopen holds this much longer
  const CALL_COOL = 0.8;      // after the doors shut, the call button re-arms

  function create(stops, home) {
    return { n: stops | 0, at: home | 0, dest: -1, st: "idle", t: 0, cool: 0,
      arrived: false, moved: false, queued: -1 };
  }
  function has(io, k) { return io && typeof io[k] === "function"; }
  function inside(io, i) { return has(io, "inside") ? !!io.inside(i) : false; }
  function doorway(io, i) { return has(io, "doorway") ? !!io.doorway(i) : false; }
  function doorOpen(io, i) { return has(io, "doorOpen") ? +io.doorOpen(i) || 0 : 0; }
  function door(io, i, open) { if (has(io, "door")) io.door(i, open); }
  function lit(io, on) { if (has(io, "lit")) io.lit(on); }
  function sfx(io, s) { if (has(io, "sfx")) io.sfx(s); }

  function enter(m, st) { m.st = st; m.t = 0; m.moved = false; }
  function openAt(m, io, i, arrived) {
    m.at = i; m.dest = -1; m.arrived = !!arrived;
    enter(m, "open");
    door(io, i, true);
  }

  // THE CALL BUTTON. Returns true when the press did something.
  function call(m, i, io) {
    if (i < 0 || i >= m.n) return false;
    if ((m.st === "open" || m.st === "close") && m.at === i) {
      if (m.st === "close" && m.dest >= 0) return false;       // a rider is leaving from here
      if (m.st === "close") { enter(m, "open"); door(io, i, true); }
      m.t = 0; m.arrived = false;                              // hold the doors a fresh WAIT_OPEN
      lit(io, true); sfx(io, "switch");
      return true;
    }
    if (m.cool > 0 && m.st === "idle" && m.at === i) return false;   // the doors just shut: a mashed key cannot flap them
    if (m.st === "idle" || m.st === "park") {
      lit(io, true); sfx(io, "switch");
      if (m.st === "idle" && m.at === i) { openAt(m, io, i, false); return true; }
      m.dest = i; enter(m, "come");
      return true;
    }
    if (m.st === "come") {
      if (m.dest === i) return true;
      m.dest = i; m.moved = false;        // an empty car can be redirected
      lit(io, true); sfx(io, "switch");
      return true;
    }
    // open/close elsewhere, or riding: remember it; an EMPTY car comes after
    // its doors shut (a rider's trip is never hijacked)
    if (m.queued !== i) { m.queued = i; lit(io, true); sfx(io, "switch"); }
    return true;
  }

  // A FLOOR BUTTON in the car.
  function go(m, j, io) {
    if (j < 0 || j >= m.n || j === m.at) return false;
    if (!inside(io, m.at)) return false;
    if (m.st === "open") {
      m.dest = j; m.arrived = false;
      enter(m, "close");
      door(io, m.at, false);
      lit(io, true); sfx(io, "switch");
      return true;
    }
    if (m.st === "close" || m.st === "idle") {
      m.dest = j;
      if (m.st === "idle") enter(m, "close");   // sealed already: rides next step
      lit(io, true); sfx(io, "switch");
      return true;
    }
    return false;
  }

  function park(m, i) {
    if (m.st !== "idle" || i === m.at || i < 0 || i >= m.n) return false;
    m.dest = i; enter(m, "park");
    return true;
  }

  // somebody sealed in an idle car (a glitch, a load): let them out here
  function rescue(m, i, io) {
    if (m.st !== "idle") return false;
    openAt(m, io, i, true);
    return true;
  }

  function settleIdle(m, io, cool) {
    m.dest = -1; m.arrived = false;
    enter(m, "idle");
    if (cool) m.cool = cool;
    if (m.queued >= 0) {                      // a call that came in while busy
      const q = m.queued; m.queued = -1;
      m.cool = 0;
      call(m, q, io);
      return;
    }
    lit(io, false);
  }

  // Returns a short status word for the owner's readout (or "").
  function step(m, dt, io) {
    if (m.cool > 0) m.cool = Math.max(0, m.cool - dt);
    if (m.st === "idle") return "";
    m.t += dt;
    const i = m.at;

    if (m.st === "come" || m.st === "park") {
      if (has(io, "travel") && !io.travel(m, dt)) return m.st === "come" ? "coming" : "";
      if (m.st === "park") { m.at = m.dest; settleIdle(m, io, 0); return ""; }
      const to = m.dest;
      if (has(io, "arrive")) io.arrive(to, false);
      sfx(io, "blip");
      openAt(m, io, to, false);
      return "open";
    }

    if (m.st === "open") {
      if (inside(io, i)) return "aboard";                        // a rider choosing a floor: hold
      if (doorway(io, i)) { m.t = Math.min(m.t, WAIT_OPEN - 0.6); return "open"; }
      const leave = m.arrived ? (m.t > LEAVE_ARM && doorOpen(io, i) > LEAVE_OPEN)
        : (m.t >= WAIT_OPEN || m.queued >= 0);
      if (leave) { m.dest = -1; enter(m, "close"); door(io, i, false); }
      return "open";
    }

    if (m.st === "close") {
      if (doorway(io, i)) {                                      // someone in the leaf line: reopen
        enter(m, "open"); m.t = WAIT_OPEN - REOPEN_HOLD; m.dest = -1; m.arrived = false;
        door(io, i, true);
        return "open";
      }
      if (m.dest >= 0 && !inside(io, i)) m.dest = -1;            // stepped back out: no trip
      if (doorOpen(io, i) <= 0) {
        if (has(io, "seal")) io.seal(i);
        if (m.dest >= 0) { enter(m, "ride"); sfx(io, "rumble"); return "ride"; }
        settleIdle(m, io, CALL_COOL);
        return "";
      }
      return "closing";
    }

    if (m.st === "ride") {
      if (has(io, "travel") && !io.travel(m, dt)) return "ride";
      const to = m.dest;
      if (has(io, "arrive")) io.arrive(to, true);
      sfx(io, "blip");
      openAt(m, io, to, true);
      return "arrived";
    }
    return "";
  }

  const LiftCore = { create, call, go, park, rescue, step, settleIdle,
    WAIT_OPEN, CALL_COOL, LEAVE_ARM };
  if (typeof module !== "undefined" && module.exports) module.exports = LiftCore;
  if (root && root.CBZ) root.CBZ.liftCore = LiftCore;
})(typeof window !== "undefined" ? window : null);
