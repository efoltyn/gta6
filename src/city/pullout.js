/* ============================================================
   city/pullout.js — PULLING SOMEBODY OUT OF A CAR. One verb, every body.

   Owner, 2026-09-30: "Cops have no way to pull you out of a car yet, so
   while you're in one they just chase you. Everyone should have a way to
   do this."

   What existed: the PLAYER could carjack (boarding.js's door arc: walk to
   the handle, pull, the car answers through vehicles.js occJack, climb in)
   and nobody else could do anything to a car with a person in it. A cop
   "busted" a fleeing NPC car by standing within 3.2 m of it (the driver
   blinked onto the kerb); a violent ped "carjacked" by becoming the driver
   of the nearest car in one frame, while whoever had been driving it just
   stopped existing; a player in a car was pursued forever because the
   cuffs never go on through the glass.

   Now there is one pull-out, here, for any human on any occupied seat of
   any car in the shared vehicle system (city/vehicles.js + carseats.js):

     WHO     player on an NPC driver (the carjack: "Pull out", then he gets
             in), a cop on the player (then the real arrest), a cop on an NPC
             suspect (then cityNpcArrest), a carjacker on an NPC or on the
             player (then he drives off in it), crew on whoever you sent them
             after (then the job carries on with him on the pavement).
     WHEN    the car is stopped or nearly (MAX_V), and the actor can walk to
             the door. A moving car is chased, never jacked.
     HOW     the beats are CBZ.moves.board's (walk to the handle, pull, stand
             back while he comes out), the door is boarding.js's real leaf,
             the body that comes out goes through its own door on the car
             beats (boardingAlight) and then lands DOWN (an officer puts him
             on the ground, a carjack victim of the player's size gets thrown)
             or STUMBLING (a carjacker's shove). ~1.5 s from the handle.
     ESCAPE  until the grab lands, the car is not caught: a driver who
             floors it (speed over BREAK_V, or the car a long step out from
             under his hand)
             breaks it, and the man at the door is knocked back off it. An
             NPC driver makes that call once, when the actor is at his door
             (driverAnswer: a fleeing suspect always goes; otherwise nerve,
             and whether the man coming is a cop or has a gun).
     LOCKED  cars lock themselves: the player's car once it has done 4 m/s
             (every modern car does), a fleeing suspect's always. A locked
             door does not open: the actor puts the window in first (a slower
             step: crazed glass, the sound), and it stays in.

   The job is polled, not called back: this file reads CBZ.moves.carBeat to
   know where the actor's body is in its beats, and owns only the grab, the
   window, the escape, the fall and what happens next. The door hooks
   (jack / clear / shut / waitMax) are handed to boarding.js's carSpec.

   Pure where it can be (the rules: speed, the driver's answer, the break,
   the fall, the lock): tools/pullout-check.mjs runs them and the whole job
   against a scripted car in plain node.
============================================================ */
(function () {
  "use strict";
  const W = (typeof window !== "undefined") ? window : (typeof globalThis !== "undefined" ? globalThis.window : null);
  const CBZ = W && W.CBZ;
  if (!CBZ) return;
  const PO = CBZ.pullOut = CBZ.pullOut || {};

  const K = {
    MAX_V: 2.0,        // m/s: over this the car is moving, not stopped
    BREAK_V: 2.5,      // m/s: floored past this before the grab = gone
    BREAK_MOVE: 0.9,   // m: or this far out from under his hand
    REACH: 12,         // m: how far from the door an actor may start the walk
    DECIDE_R: 3.6,     // m: an NPC driver answers when the actor is this close
    GRAB: 0.45,        // s: hand in, fist in the collar
    GRAB_PLAYER: 0.7,  // s: the player gets a beat to floor it
    SMASH: 1.15,       // s: elbow through a locked window
    DRAG_MAX: 1.4,     // s: longest a victim's climb-out may run before he lands
    WAIT_MAX: 4.4,     // s: the actor's wait at the door (smash + grab + drag)
    CLOSE: 0.5,        // s: the door swung shut after a pull-only
    LOCK_V: 4.0,       // m/s: the player's doors lock above this
    SLOW_FOR: 0.5,     // s: a cop commits once the car has been stopped this long
    DOWN_COP: 2.4,     // s: on the ground under an officer
    DOWN_JACK: 1.1,    // s: a carjacked player thrown on the kerb
  };
  PO.K = K;
  PO.MAX_V = K.MAX_V;

  function P() { return CBZ.player || null; }
  function MV() { return CBZ.moves || null; }
  function Vb() { return CBZ.verbs || null; }
  let clock = 0;

  /* ============================================================
     THE RULES (pure)
     ============================================================ */
  PO.speedOf = function (car) {
    if (!car) return 0;
    const v = Number.isFinite(car.v) ? Math.abs(car.v) : 0;
    const h = Math.hypot(Number.isFinite(car.vx) ? car.vx : 0, Number.isFinite(car.vz) ? car.vz : 0);
    return v > h ? v : h;
  };
  /* The driver sees a man at his door. "floor" (he goes) or "hold" (foot on
     the brake, hands where they can be seen). Stable per person: it reads
     his nerve, never a die. */
  PO.driverAnswer = function (ctx) {
    ctx = ctx || {};
    if (ctx.fleeing) return "floor";                      // already running from the law
    const nerve = ctx.nerve == null ? 0.4 : ctx.nerve;
    if (ctx.cop) return nerve > 0.9 ? "floor" : "hold";   // most people stop for a badge
    if (ctx.armed) return nerve > 0.72 ? "floor" : "hold";
    return nerve > 0.5 ? "floor" : "hold";
  };
  // the grab has not landed and the car got away from the hand
  PO.broke = function (phase, speed, moved) {
    if (phase !== "walk" && phase !== "smash" && phase !== "grab") return false;
    return speed > K.BREAK_V || moved > K.BREAK_MOVE;
  };
  /* How the body lands: an officer puts him DOWN (so he can be cuffed), a
     player thrown out of his own car goes down, a runner is already running,
     a man coming out with a gun is on his feet, everybody else stumbles. */
  PO.fall = function (ctx) {
    ctx = ctx || {};
    if (ctx.cop) return "down";
    if (ctx.player) return "down";
    if (ctx.react === "flee" || ctx.react === "fight") return null;
    return "stumble";
  };
  // is this car locked right now (a fact about the car, read at the handle)
  PO.lockedNow = function (car) {
    if (!car || car._pullSmashed) return false;
    if (car.locked) return true;
    return car.pullover === 4 || ((car.npcWanted | 0) >= 1 && !!car.npcDriver);
  };

  /* ============================================================
     WHO IS IN THE SEAT
     ============================================================ */
  function playerSeatId(car) {
    const p = P();
    if (!p || !p.driving || p._vehicle !== car) return null;
    const S = CBZ.carSeats;
    const st = S && S.playerSeat ? S.playerSeat(car) : null;
    return st ? st.id : "driver";
  }
  // "player" | a ped | "ambient" (a seat record with nobody promoted yet) | null
  PO.occupantOf = function (car, seatId) {
    if (!car || car.dead) return null;
    seatId = seatId || "driver";
    if (playerSeatId(car) === seatId) return "player";
    const S = CBZ.carSeats;
    const o = S && S.occupant ? S.occupant(car, seatId) : null;
    if (o) {
      if (o.kind === "player") return "player";
      if (o.ref && !o.ref.dead && o.ref !== P()) return o.ref;
      if (o.ambient) return o.ambient.ped || "ambient";
    }
    if (seatId === "driver" && car.npcDriver && !car.npcDriver.dead) return car.npcDriver;
    if (car.occ && car.occ.seats) {
      for (let i = 0; i < car.occ.seats.length; i++) {
        const st = car.occ.seats[i];
        if (st.slot === seatId && !st.gone && (car.ai || car.npcDriver) && !car.player) return st.ped || "ambient";
      }
    }
    return null;
  };
  // the car a person is sitting in (not a crew seat you gave him: that is boarding's)
  PO.carOf = function (ped) {
    if (!ped || ped.dead) return null;
    if (ped === P() || ped === (CBZ.city && CBZ.city.playerActor)) {
      const p = P();
      return p && p.driving && p._vehicle && !p._vehicle.dead ? p._vehicle : null;
    }
    const c = ped._occCar || (ped.inCar && typeof ped.inCar === "object" && ped.inCar.pos ? ped.inCar : null);
    return c && !c.dead ? c : null;
  };
  function seatOfPed(car, ped) {
    if (!ped) return "driver";
    if (ped === P() || ped === (CBZ.city && CBZ.city.playerActor)) return playerSeatId(car) || "driver";
    if (ped._occSeat && ped._occSeat.slot) return ped._occSeat.slot;
    const S = CBZ.carSeats;
    const id = S && S.seatOf ? S.seatOf(car, ped) : null;
    return id || "driver";
  }
  function isCop(a) {
    if (!a) return false;
    if (a.kind === "cop" || a.kind === "swat" || a.swat || a.copRank) return true;
    return !!(CBZ.cityCops && CBZ.cityCops.indexOf(a) >= 0);
  }
  function isPlayerA(a) {
    const p = P();
    return !!(a && p && (a === p || a === CBZ.playerChar || a === (CBZ.city && CBZ.city.playerActor)));
  }
  function posOf(a) {
    if (!a) return null;
    if (isPlayerA(a)) { const p = P(); return p ? p.pos : null; }
    return a.pos || (a.group && a.group.position) || null;
  }

  /* ============================================================
     THE JOBS
     ============================================================ */
  const jobs = [];
  PO.jobs = jobs;
  PO.jobOf = function (actor) {
    for (let i = 0; i < jobs.length; i++) if (jobs[i].actor === actor && !jobs[i].done) return jobs[i];
    return null;
  };
  PO.busy = function (car) {
    for (let i = 0; i < jobs.length; i++) if (jobs[i].car === car && !jobs[i].done) return jobs[i];
    return null;
  };
  const TALLY = { started: 0, grabbed: 0, broken: 0, smashed: 0, arrests: 0, taken: 0, cut: 0 };
  PO.tally = TALLY;

  /* A job without an animation yet: the caller runs the beats (the player's
     door arc does) with job.hooks in its car spec. PO.start does both. */
  PO.prepare = function (actor, car, opts) {
    opts = opts || {};
    if (!actor || !car || car.dead) return null;
    const seat = opts.seat || seatOfPed(car, opts.victim);
    const job = {
      actor: actor, car: car, seat: seat,
      take: !!opts.take, cop: opts.cop != null ? !!opts.cop : isCop(actor),
      byPlayer: isPlayerA(actor),
      phase: "walk", t: 0, T: 0,
      sx: car.pos.x, sz: car.pos.z,
      locked: PO.lockedNow(car),
      // an officer on a car that ran from the law: whoever is at the wheel is the suspect
      suspect: false,
      answer: null, victims: [], victimPlayer: false, landed: false,
      mvSeen: false, broken: false, done: false, outcome: null,
      onDone: opts.onDone || null, onFail: opts.onFail || null,
      ownsBody: false,
    };
    job.hooks = {
      jack: function () { onJack(job); return 0; },
      clear: function () {
        if (job.phase !== "after" && job.phase !== "close" && !job.done) return false;
        const B = CBZ.boarding;
        return !(B && B.doorBusy && B.doorBusy(car, seat));
      },
      shut: function () { return job.phase === "smash" || (job.phase === "walk" && job.locked); },
      waitMax: K.WAIT_MAX,
      run: !!opts.run,
    };
    job.suspect = job.cop && (car.pullover === 4 || (car.npcWanted | 0) >= 1);
    jobs.push(job);
    TALLY.started++;
    return job;
  };
  PO.cancel = function (job) { if (job && !job.done) end(job, "cancelled"); };

  // can this actor pull this seat right now (null = yes, else why not)
  PO.why = function (actor, car, seat) {
    if (!actor || actor.dead || (actor.ko | 0) > 0) return "actor";
    if (!car || car.dead || car._cineLocked || car._heldBy) return "car";
    if (PO.busy(car)) return "busy";
    if (PO.jobOf(actor)) return "already";
    if (!isPlayerA(actor) && (actor._cbzArc || actor._cbzSeat || actor._boardOwn || actor._arresting || actor._seizing ||
        actor.inCar || actor.restraint)) return "actor";
    if (isPlayerA(actor) && (P().driving || P()._aircraft)) return "actor";
    if (PO.speedOf(car) > K.MAX_V) return "moving";
    if (!PO.occupantOf(car, seat || "driver")) return "empty";
    const ap = posOf(actor);
    if (!ap || Math.hypot(ap.x - car.pos.x, ap.z - car.pos.z) > K.REACH) return "far";
    return null;
  };

  PO.start = function (actor, car, opts) {
    opts = opts || {};
    const seat = opts.seat || seatOfPed(car, opts.victim);
    if (PO.why(actor, car, seat)) return null;
    const B = CBZ.boarding, M = MV();
    if (!B || !B.pullSpec || !M || !M.board) return null;
    const job = PO.prepare(actor, car, Object.assign({}, opts, { seat: seat }));
    if (!job) return null;
    const V = B.pullSpec(car, seat, actor, job.hooks);
    if (!V) { end(job, "nospec"); return null; }
    let ok = false;
    try { ok = !!M.board(actor, V, { pullOnly: !job.take, walkMax: K.REACH + 2 }); } catch (e) { ok = false; }
    if (!ok) { end(job, "nostart"); return null; }
    // THE BODY IS THE BEATS' NOW: peds.js skips a `_boardOwn` body, police.js
    // a `_pulling` one (the latch arrest.js's take uses is `_arresting`)
    if (!job.byPlayer) { actor._boardOwn = true; actor._pulling = true; job.ownsBody = true; }
    if (job.cop && actor.armed) actor._gunLowered = true;
    shout(job, job.cop ? "Out of the car!" : "Get out!");
    return job;
  };

  /* An officer on a car he wants somebody out of: the one call police.js and
     vehicles.js make. True when THIS officer is now at the door (the rest of
     the unit covers him); false leaves him to his normal footwork. */
  PO.copTry = function (cop, car, dist) {
    if (!cop || !car || car.dead || cop.dead || cop._pulling || (cop.ko | 0) > 0) return false;
    if (PO.speedOf(car) > K.MAX_V) { car._pullSlowAt = null; return false; }
    if (car._pullSlowAt == null) car._pullSlowAt = clock;
    if (clock - car._pullSlowAt < K.SLOW_FOR) return false;
    if (PO.busy(car)) return false;
    if (dist != null && dist > K.REACH) return false;
    const seat = playerSeatId(car) || "driver";
    return !!PO.start(cop, car, { cop: true, seat: seat, run: true });
  };

  function shout(job, line) {
    const a = job.actor;
    if (job.byPlayer || !a || !CBZ.speech || !CBZ.speech.say) return;
    try { CBZ.speech.say(a, line, { secs: 1.4 }); } catch (e) {}
  }

  /* ---- the handle has been pulled ---- */
  function onJack(job) {
    if (job.done) return;
    if (!PO.occupantOf(job.car, job.seat)) { job.phase = "after"; job.t = 0; return; }   // he got out on his own
    if (job.locked && !job.car._pullSmashed) { job.phase = "smash"; job.t = 0; job.smashed = false; return; }
    job.phase = "grab"; job.t = 0;
  }

  /* ---- the car got away from the hand ---- */
  function breakJob(job) {
    job.broken = true;
    TALLY.broken++;
    const a = job.actor, M = MV(), V = Vb();
    const atDoor = job.phase !== "walk" || (M && M.carBeat && M.carBeat(a) === "cpull");
    end(job, "broken");
    if (!atDoor || !V || !V.knockdown) return;
    // KNOCKED BACK OFF THE DOOR: the car goes, the door swings, he goes down
    const ap = posOf(a), c = job.car;
    if (!ap) return;
    let dx = ap.x - c.pos.x, dz = ap.z - c.pos.z;
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    try { V.knockdown(job.byPlayer && V.playerActor ? V.playerActor() : a, { dir: { x: dx, z: dz }, ko: false, dur: 0.9, power: 0.6 }); } catch (e) {}
    if (CBZ.sfx) { try { CBZ.sfx("thud"); } catch (e) {} }
  }

  /* ---- the grab lands: whoever is in the seat comes out ---- */
  function extract(job) {
    const c = job.car, a = job.actor;
    TALLY.grabbed++;
    const occ = PO.occupantOf(c, job.seat);
    if (occ === "player") {
      const p = P();
      job.victimPlayer = true;
      p._pulledOut = true;
      try { if (CBZ.cityExitVehicle) CBZ.cityExitVehicle(); } catch (e) {}
      p._pulledOut = false;
      c.locked = false;
      job.victims.push(p);
      return;
    }
    if (job.byPlayer) {
      // THE PLAYER'S CARJACK: the whole car answers the man at the door
      // (vehicles.js occJack: fight / flee / beg / freeze, the crime filed,
      // what each of them remembers of you). The seat commit skips its own.
      const before = c.npcDriver;
      if (CBZ.cityJackNow) { try { CBZ.cityJackNow(c, CBZ.city && CBZ.city.playerActor); } catch (e) {} }
      if (before && !before.dead) job.victims.push(before);
      return;
    }
    const out = CBZ.cityPullOccupant ? CBZ.cityPullOccupant(c, job.seat, a, { all: job.take, cop: job.cop }) : [];
    for (let i = 0; i < out.length; i++) if (out[i] && job.victims.indexOf(out[i]) < 0) job.victims.push(out[i]);
    if (job.take) c._jackDone = true;
  }

  /* ---- the victims are out of the door: how they land ---- */
  function land(job) {
    job.landed = true;
    const V = Vb(), c = job.car;
    if (!V) return;
    for (let i = 0; i < job.victims.length; i++) {
      const v = job.victims[i];
      if (!v || v.dead) continue;
      const pl = isPlayerA(v);
      const how = PO.fall({ cop: job.cop, player: pl, react: pl ? null : v._occLastReact });
      if (!how) continue;
      const vp = posOf(v); if (!vp) continue;
      let dx = vp.x - c.pos.x, dz = vp.z - c.pos.z;
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const tgt = pl && V.playerActor ? V.playerActor() : v;
      if (how === "down") {
        const dur = job.cop ? K.DOWN_COP : K.DOWN_JACK;
        if (pl && job.cop && CBZ.arrest && CBZ.arrest.subdue) { try { CBZ.arrest.subdue(dur + 0.4, "down"); } catch (e) {} }
        try { if (V.knockdown) V.knockdown(tgt, { dir: { x: dx, z: dz }, ko: false, dur: dur, power: 0.55 }); } catch (e) {}
        if (pl && CBZ.shake) { try { CBZ.shake(0.25); } catch (e) {} }
      } else {
        try { if (V.react) V.react(tgt, { reaction: "stagger", zone: "body", stagger: true, power: 0.8, dir: { x: dx, z: dz } }); } catch (e) {}
      }
    }
    if (CBZ.sfx) { try { CBZ.sfx("hit"); } catch (e) {} }
  }

  /* ---- the actor's beats are over: what the pull was FOR ---- */
  function afterPull(job) {
    const c = job.car, a = job.actor;
    if (!job.cop) return;
    // AN ARREST. The car is caught; the man on the ground is the officer's.
    c.pullover = 0; c.npcWanted = 0; c.reckless = false;
    if (c.driver) c.driver.aggr = 0.2;
    for (let i = 0; i < job.victims.length; i++) {
      const v = job.victims[i];
      if (!v || v.dead) continue;
      if (isPlayerA(v)) {
        // the real take (systems/arrest.js via wanted.js): he is down, so the
        // cuffs can go on, and he can still struggle
        if (CBZ.cityArrestTake) { try { CBZ.cityArrestTake(a, { violent: true }); TALLY.arrests++; } catch (e) {} }
      } else if (CBZ.cityNpcArrest && ((v.npcWanted | 0) >= 1 || job.suspect)) {
        try { CBZ.cityNpcArrest(v, a); TALLY.arrests++; } catch (e) {}
      }
    }
  }

  function releaseBody(job) {
    const a = job.actor;
    if (!job.ownsBody || !a) return;
    job.ownsBody = false;
    a._boardOwn = false; a._pulling = false;
    if (job.cop) a._gunLowered = false;
    if (a.target && a.target.set && a.pos) a.target.set(a.pos.x, 0, a.pos.z);
  }

  function end(job, outcome) {
    if (job.done) return;
    job.done = true; job.outcome = outcome; job.phase = "done";
    const i = jobs.indexOf(job); if (i >= 0) jobs.splice(i, 1);
    const c = job.car;
    if (c) { c._pullHoldT = 0; }
    const M = MV();
    if (outcome !== "done" && outcome !== "closed" && M && M.carBeat && M.carBeat(job.actor) && M.carAbort) {
      try { M.carAbort(job.actor); } catch (e) {}
    }
    releaseBody(job);
    const ok = outcome === "done" || outcome === "closed";
    if (!ok && outcome !== "cancelled") TALLY.cut++;
    const f = ok ? job.onDone : job.onFail;
    if (typeof f === "function") { try { f(job, outcome); } catch (e) { if (CBZ.CONFIG && CBZ.CONFIG.DEBUG) console.error("[pullout]", e); } }
  }

  function invalid(job) {
    const a = job.actor, c = job.car;
    if (!c || c.dead || (c.group && !c.group.parent)) return true;
    if (!a || a.dead) return true;
    // (the player's own carjack ends with him driving: that is its commit)
    if (isPlayerA(a)) { const p = P(); if (!p || p.dead || (p.driving && !job.take)) return true; }
    return false;
  }

  /* ============================================================
     THE TICK — at 33.4: before the player's door arc (33.45) reads its
     keys and before boarding.js's door sweep (33.5) shuts any door nobody
     posed this frame (the close below poses it).
     ============================================================ */
  PO.tick = function (dt) {
    clock += dt;
    lockTick();
    if (!jobs.length) return;
    const M = MV();
    for (let i = jobs.length - 1; i >= 0; i--) {
      const job = jobs[i];
      if (!job || job.done) continue;
      if (invalid(job)) { end(job, "invalid"); continue; }
      job.T += dt; job.t += dt;
      const a = job.actor, c = job.car;
      const beat = M && M.carBeat ? M.carBeat(a) : null;
      if (beat) job.mvSeen = true;
      else if (!job.mvSeen && job.T > 0.6 && job.phase !== "close") { end(job, "nostart"); continue; }

      // THE CAR GETS AWAY FROM THE HAND (distance counts from the moment the
      // hand is on the handle: a queue creeping forward while he walks up is
      // not an escape, it is a car he follows)
      if (!job.atHandle && beat && beat !== "cwalk") { job.atHandle = true; job.sx = c.pos.x; job.sz = c.pos.z; }
      const moved = job.atHandle ? Math.hypot(c.pos.x - job.sx, c.pos.z - job.sz) : 0;
      if (PO.broke(job.phase, PO.speedOf(c), moved)) { breakJob(job); continue; }

      // the actor's beats ended (done, skipped, or taken from him)
      if (job.mvSeen && !beat && job.phase !== "close") {
        if (job.phase === "walk" || job.phase === "smash" || job.phase === "grab") { end(job, "cut"); continue; }
        if (!job.landed) land(job);
        afterPull(job);
        if (job.take) {
          TALLY.taken++;
          // an NPC who got in is held by the car from here (vehicles.js's
          // carjacker seat): hand his rig back at full size and standing, so
          // the day he is put out again he is not a folded, shrunken man
          if (!job.byPlayer) {
            const g = a.group;
            if (g && g.scale && g.scale.x !== 1) g.scale.setScalar(1);
            if (M && M.stand) { try { M.stand(a, { instant: true }); } catch (e) {} }
          }
          end(job, "done");
          continue;
        }
        if (job.byPlayer) { end(job, "done"); continue; }
        releaseBody(job);
        job.phase = "close"; job.t = 0;
        continue;
      }

      // THE DRIVER ANSWERS, once, when the man is at his door
      if (!job.answer && job.phase === "walk") {
        const ap = posOf(a);
        const occ = PO.occupantOf(c, job.seat);
        if (ap && occ && occ !== "player" && Math.hypot(ap.x - c.pos.x, ap.z - c.pos.z) < K.DECIDE_R + 1.2) {
          const d = typeof occ === "object" ? occ : null;
          const T = d && CBZ.cityTraits ? CBZ.cityTraits(d) : null;
          job.answer = PO.driverAnswer({
            fleeing: c.pullover === 4 || ((c.npcWanted | 0) >= 1 && !!c.npcDriver) || !!(d && (d.npcWanted | 0) >= 1),
            cop: job.cop, armed: !!(a.armed || (job.byPlayer && CBZ.cityHasGun && CBZ.cityHasGun())),
            nerve: T ? T.nerve : (d && d.aggr != null ? d.aggr : 0.4),
          });
          if (job.cop && d && (d.npcWanted | 0) >= 1) job.suspect = true;
          if (job.answer === "floor" && c.ai && c.road && !c.player) c._pullFleeT = 5;
        }
      }
      if (job.answer === "hold" && (job.phase === "walk" || job.phase === "smash" || job.phase === "grab")) c._pullHoldT = 0.3;

      if (job.phase === "smash") {
        if (!job.smashed && job.t >= K.SMASH * 0.6) {
          job.smashed = true;
          TALLY.smashed++;
          if (CBZ.cityCarFrost) { try { CBZ.cityCarFrost(c); } catch (e) {} }
          if (CBZ.sfx) { try { CBZ.sfx("glass"); } catch (e) {} }
        }
        if (job.t >= K.SMASH) { c._pullSmashed = true; c.locked = false; job.locked = false; job.phase = "grab"; job.t = 0; }
        continue;
      }
      if (job.phase === "grab") {
        const hold = PO.occupantOf(c, job.seat) === "player" ? K.GRAB_PLAYER : K.GRAB;
        if (job.t >= hold) {
          if (!PO.occupantOf(c, job.seat)) { job.phase = "after"; job.t = 0; continue; }
          extract(job);
          job.phase = "drag"; job.t = 0;
        }
        continue;
      }
      if (job.phase === "drag") {
        let still = false;
        for (let k = 0; k < job.victims.length; k++) {
          const v = job.victims[k];
          if (v && !isPlayerA(v) && M && M.carBeat && M.carBeat(v)) still = true;
        }
        if (!still || job.t > K.DRAG_MAX) { land(job); job.phase = "after"; job.t = 0; }
        continue;
      }
      if (job.phase === "close") {
        const B = CBZ.boarding;
        const u = Math.min(1, job.t / K.CLOSE);
        if (B && B.door) { try { B.door(c, job.seat, 1 - u); } catch (e) {} }
        if (u >= 1) end(job, "closed");
        continue;
      }
    }
  };

  /* THE LOCKS. The player's car locks itself once it is going (and stays
     locked while he is in it); getting out unlocks it. A smashed window is
     a door anyone can open from then on. */
  let lockedCar = null;
  function lockTick() {
    const p = P();
    const car = p && p.driving ? p._vehicle : null;
    if (lockedCar && lockedCar !== car) { lockedCar.locked = false; lockedCar = null; }
    if (car && !car._pullSmashed && !car.locked && PO.speedOf(car) > K.LOCK_V) { car.locked = true; lockedCar = car; }
  }

  PO.reset = function () {
    for (let i = jobs.length - 1; i >= 0; i--) end(jobs[i], "cancelled");
    jobs.length = 0;
    lockedCar = null;
  };
  PO.clock = function () { return clock; };

  if (typeof CBZ.onUpdate === "function") CBZ.onUpdate(33.4, function (dt) { PO.tick(dt); });
})();
