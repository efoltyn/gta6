/* ============================================================
   systems/hunt.js — WHERE THE PREY WILL BE.

   THE ONE QUESTION THIS FILE ANSWERS, for every game on this engine:
   a hunter that needs TIME to arrive — a bomb that falls for nine seconds,
   an aeroplane a minute out, a skiff closing at eleven knots, a cruiser
   staging a wall down the road — must aim at where the target WILL BE, and
   must know how badly it does not know. Aiming at where somebody IS is the
   single most common AI bug in this repo and it has been re-authored, badly
   and privately, four separate times:

     • city/aircraft.js:1750-1766  heliGun — the ONLY honest one. Tracks the
       player's velocity off frame deltas (the actor "doesn't expose a
       velocity this module can trust" — its own words), leads by
       slantRange/380, caps the lead at 9 m. Private to the module, works
       for exactly one target: CBZ.player.
     • city/piracy.js:1974-1990    interceptCmd — "aim where the prize WILL
       BE". lead = range / MY top speed, clamped to 8 s. A private module
       function, on no bus, boat-shaped.
     • city/police.js:2977-3010    rbStage — projects the suspect 120-200 u
       along his car's velocity and snaps the wall to the street grid. Not a
       verb at all: it reads CBZ.city.arena.xLines, CBZ.player.driving and
       cityCars, so nothing outside the city can ask it anything.
     • city/squadai.js:585         the bodyguard screen — principal + v*2.4.

   None of them shares a line with any other. None can be asked about an
   arbitrary actor. None says how WRONG it expects to be, which is the part
   that actually matters: `entities/ai.js`'s "cutoff" tactic and
   `systems/aitactics.js`'s SEARCH sweep are both built on the opposite
   assumption — a fixed offset behind a man, a sweep around where he was
   LAST SEEN. This file is the missing half.

   ---------------------------------------------------------------- THE MATH
   A walking man is not a bullet and he is not a random number. He is a
   PERSISTENT RANDOM WALK: he holds a heading for a while and then he does
   not. That model (Ornstein-Uhlenbeck velocity; Furth 1920) has exactly one
   parameter — the correlation time tau — and it hands us BOTH numbers a
   hunter needs, in closed form, from the same process:

       drift(t)  = v * tau * (1 - e^-x)                        x = t / tau
       spread(t) = v * tau * sqrt( 2(x - 1 + e^-x) - (1 - e^-x)^2 )

   drift is the expected displacement along the heading he is on NOW;
   spread is the RMS radius of where he actually turns out to be, CONDITIONED
   on that heading being known. Both limits are the ones you would demand:

     • t << tau: drift -> v*t (he keeps walking) and spread -> v*t^1.5 /
       sqrt(tau) * 0.816, which vanishes FASTER than the distance — nine
       seconds out, a bomb can be aimed.
     • t >> tau: drift saturates at v*tau (he has turned; the expectation
       stops moving) and spread -> v*sqrt(2*tau*t), the diffusive law. Sixty
       seconds out, a 5.4 m/s man with tau 8 s has drifted 43 m and is
       smeared over 152 m — WIDER THAN A CITY BLOCK. That is not a
       disappointing answer, it IS the answer: at a minute's flying time the
       occupancy of one particular street is not knowable, so a hunter that
       bets a whole run on it is betting on nothing.

   tau is MEASURED, not assumed: the tracker watches how fast the target is
   turning and shortens tau accordingly, so a man who jukes gets a small
   drift and a huge spread. Juking beats the lead — by arithmetic, not by a
   special case.

   NOTHING HERE READS A MODE, A CITY RECORD OR A ROSTER. It reads a position
   (`a.pos` or `a.group.position`, the same pair systems/physics.js reads)
   and it answers about that one actor.

   ---------------------------------------------------------- HOW YOU ADOPT
   ONE LINE, and it REPLACES the line you already wrote:

       const p = CBZ.hunt ? CBZ.hunt.at(foe, t) : foe.pos;   // ← that is all

   `at()` self-tracks, so there is no set-up call, nothing to register and no
   record to keep. Call it every frame or once an hour; it works out the
   velocity itself from the positions it is shown, exactly as heliGun does,
   and it prefers a velocity the actor publishes (`velX/velZ`, `vx/vz`) when
   it has not seen enough frames yet. Companions, all optional:

       CBZ.hunt.spread(a, t)                metres of 1-sigma smear at t
       CBZ.hunt.within(d, R, sigma)         soft membership, 1 inside R
       CBZ.hunt.intercept(hx, hz, spd, a)   the classic solve: {x, z, t}
       CBZ.hunt.track(a)                    a mover's one line; REPLACES the
                                            velX/velZ a mover publishes today
       CBZ.hunt.speed(a) / CBZ.hunt.tau(a)  what it thinks it knows

   Flag `CBZ.CONFIG.HUNT_LEAD_V1 = false` makes `at()` return the present
   position and `spread()` return 0 — every adopting site reverts to aiming
   at where he is, at once, with no edit.

   ------------------------------------------------------------- THE RATCHET
   `CBZ.huntAudit()`:
     legacy        — private lead/intercept implementations still in the
                     engine, counted by hand at the file:line above. **3**
                     (squadai's 2.4 s screen is a formation offset, not a
                     hunt, and is not counted). May only go DOWN.
     overconfident — THE FORECAST GRADES ITSELF. One ask in 32 is remembered
                     with its declared spread; when its deadline passes, the
                     actor's REAL position is compared against it, and this
                     counts the checks that came in beyond 3 sigma. A
                     forecast that lies about its own uncertainty is worse
                     than no forecast, because a hunter spends a minute of
                     flying on it. May only go DOWN.
     calibration   — meanErr / meanSpread over those checks. 1.0 means the
                     spread is telling the truth; well under 1 means it is
                     needlessly timid, well over 1 means it is lying.
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  if (CBZ.hunt) return;                       // one definition, first tag wins

  const C = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (C.HUNT_LEAD_V1 == null) C.HUNT_LEAD_V1 = true;
  // ?cfg_HUNT_LEAD_V1=0 IS THE ONLY WAY TO A/B THIS ON A games/ PAGE. The URL
  // override lives in src/config.js and a slice page does not load it — which
  // is why the shipped one-shot games have never been able to flip an engine
  // flag from the address bar, the one lever the verification doctrine names
  // for a build-time behaviour. It re-derives from the SAME parameter
  // config.js reads, so in the city the two cannot disagree.
  try {
    if (typeof location !== "undefined" && location.search) {
      const q = new URLSearchParams(location.search).get("cfg_HUNT_LEAD_V1");
      if (q != null && q !== "") C.HUNT_LEAD_V1 = !(q === "0" || q === "false");
    }
  } catch (e) { /* no URL (a tool, a worker): the default stands */ }

  // A HEADING HELD FOR EIGHT SECONDS is the engine's default animal. It is
  // the order of magnitude of every wandering brain in this repo — peds.js
  // re-picks a goal on a 5-12 s timer, the survival runners on 5-12, the
  // prison yard on ~10 — and a caller who knows better passes opts.tau.
  const TAU0 = 8.0;
  const TAU_MIN = 0.45;                       // a target juking this hard is a smear, not a point
  const VEL_SMOOTH = 0.30;                    // s — exp time constant on the velocity estimate
  const TURN_SMOOTH = 0.90;                   // s — ...and on the turn rate that shortens tau
  const MAX_T = 240;                          // no forecast is worth four minutes

  // ---------------------------------------------------------------- clocks
  // The city runs on CBZ.now, a slice page on micro.elapsed, and a tool may
  // have neither. One reader, so a record's timestamps can never come from
  // two different clocks in one session — and note the UNIT: `CBZ.now` is
  // MILLISECONDS (core/loop.js sets it from the rAF timestamp and advances it
  // by dt*1000 in stepSim) while `micro.elapsed` is SECONDS. Everything in
  // this file is seconds, so the city clock is divided here and nowhere else.
  let _clock = null;
  function nowSec() {
    if (_clock === null) {
      _clock = (typeof CBZ.now === "number") ? "city"
        : (CBZ.micro && typeof CBZ.micro.elapsed === "number") ? "micro" : "perf";
    }
    if (_clock === "city" && typeof CBZ.now === "number") return CBZ.now / 1000;
    if (_clock === "micro" && CBZ.micro) return CBZ.micro.elapsed;
    return (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
  }

  function posOf(a) {
    if (!a) return null;
    // the pair systems/physics.js reads, in its order: a prison record keeps
    // position on .group.position and has no .pos at all, and several shared
    // systems use !a.pos as their "not a positioned actor" test — so never
    // alias one onto the other, just read both.
    if (a.pos && typeof a.pos.x === "number") return a.pos;
    if (a.group && a.group.position) return a.group.position;
    return null;
  }

  // A record lives on the actor under one key. No registry, no map keyed on
  // an object (which is what keeps corpses alive), no parallel bookkeeping —
  // the state dies with the actor, which is the only lifetime that is right.
  function rec(a) {
    let r = a._hunt;
    if (!r) r = a._hunt = { t: -1, x: 0, z: 0, vx: 0, vz: 0, sp: 0, turn: 0, hdg: 0, n: 0, seq: 0 };
    return r;
  }

  // ------------------------------------------------------------- THE TRACK
  // Derive velocity from how far the body actually moved, because a record's
  // declared velocity field is not trustworthy across this codebase (a ped's
  // `.speed` is a BASE speed, a prison actor has neither) — the same
  // diagnosis city/aircraft.js wrote for its door gunner. A published
  // velocity is used only until there are two real samples to beat it.
  function sample(a, now) {
    const p = posOf(a); if (!p) return null;
    const r = rec(a);
    if (r.t < 0) {
      r.t = now; r.x = p.x; r.z = p.z; r.n = 0;
      // seed off whatever the record does publish, so the very first ask is
      // already led rather than blind
      const vx = num(a.velX, num(a.vx, 0)), vz = num(a.velZ, num(a.vz, 0));
      r.vx = vx; r.vz = vz; r.sp = Math.sqrt(vx * vx + vz * vz);
      if (r.sp > 1e-4) r.hdg = Math.atan2(r.vz, r.vx);
      return r;
    }
    const dt = now - r.t;
    if (dt < 1e-4) return r;                  // same frame, asked twice — one sample
    if (dt > 2.0) {                           // a gap (paused, spawned, teleported): re-seed
      r.t = now; r.x = p.x; r.z = p.z; r.n = 0; r.vx = r.vz = 0; r.sp = 0; r.turn = 0; r.seq++;
      return r;
    }
    const ivx = (p.x - r.x) / dt, ivz = (p.z - r.z) / dt;
    r.t = now; r.x = p.x; r.z = p.z;
    // TELEPORT GUARD: a respawn is not a 400 m/s sprint. 60 m/s is faster
    // than anything that walks and slower than anything that flies badly.
    if (Math.abs(ivx) > 60 || Math.abs(ivz) > 60) { r.n = 0; r.vx = r.vz = 0; r.sp = 0; r.seq++; return r; }
    const k = 1 - Math.pow(0.001, dt / Math.max(1e-3, VEL_SMOOTH));
    r.vx += (ivx - r.vx) * k;
    r.vz += (ivz - r.vz) * k;
    r.sp = Math.sqrt(r.vx * r.vx + r.vz * r.vz);
    // TURN RATE — this is what MEASURES tau instead of assuming it. Read off
    // the instantaneous heading, not the smoothed one, or the smoothing
    // hides exactly the juke we are trying to price.
    if (ivx * ivx + ivz * ivz > 0.04) {
      const h = Math.atan2(ivz, ivx);
      let d = h - r.hdg;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      r.hdg = h;
      const kt = 1 - Math.pow(0.001, dt / TURN_SMOOTH);
      r.turn += (Math.abs(d) / dt - r.turn) * kt;
    }
    if (r.n < 4) r.n++;
    return r;
  }
  function num(v, d) { return (typeof v === "number" && isFinite(v)) ? v : d; }

  // ------------------------------------------------------------ THE LEDGER
  // The forecast grades itself (see THE RATCHET). Bounded ring, one ask in
  // 32, a deterministic counter and never Math.random — this file runs
  // inside world-building sessions that must stay byte-identical per seed.
  const CHECK_EVERY = 32, CHECK_MAX = 128;
  const pending = [];
  let askN = 0;
  const A = { asks: 0, checks: 0, errSum: 0, spreadSum: 0, over: 0, worst: 0 };

  function drain(now) {
    for (let i = pending.length - 1; i >= 0; i--) {
      const e = pending[i];
      if (now < e.due) continue;
      pending.splice(i, 1);
      const p = posOf(e.a);
      // a body that stopped existing tells us nothing about the forecast
      if (!p || e.a.dead || e.a.alive === false || e.a.culled) continue;
      // NOR DOES ONE THAT TELEPORTED. The first run of this ledger reported
      // calibration 2.25 and a worst error of 2,121 m — which is not a bad
      // forecast, it is a half ending and every man respawning across the
      // intermission while his prediction was still in the ring. `seq` ticks
      // whenever the tracker re-seeds (a >2 s gap, or motion faster than any
      // walker), and a check whose actor re-seeded is DISCARDED rather than
      // scored. An audit that counts a respawn as an error is an audit that
      // will be tuned against, which is worse than not having one.
      if (rec(e.a).seq !== e.seq) continue;
      const err = Math.sqrt((p.x - e.x) * (p.x - e.x) + (p.z - e.z) * (p.z - e.z));
      A.checks++; A.errSum += err; A.spreadSum += e.sp;
      if (err > A.worst) A.worst = err;
      if (err > 3 * Math.max(e.sp, 1)) A.over++;
    }
  }

  // ----------------------------------------------------------------- VERBS
  const hunt = (CBZ.hunt = {});
  const _out = { x: 0, z: 0 };                // scratch, like ordnance.js's row

  hunt.speed = function (a, opts) {
    const r = sample(a, nowSec());
    if (!r) return 0;
    return (opts && typeof opts.speed === "number") ? opts.speed : r.sp;
  };

  // How long does this one hold a heading? A target that is turning hard has
  // already told us its own tau: the reciprocal of its turn rate, floored so
  // a spin does not make the answer zero.
  hunt.tau = function (a, opts) {
    if (opts && typeof opts.tau === "number") return Math.max(TAU_MIN, opts.tau);
    const r = sample(a, nowSec());
    const turn = r ? r.turn : 0;
    return Math.max(TAU_MIN, 1 / (1 / TAU0 + turn));
  };

  // metres of 1-sigma smear at t seconds. THE CONDITIONAL variance of the
  // OU process — conditioned on the heading we can see — which is why it
  // goes as t^1.5 early and sqrt(t) late instead of t everywhere.
  hunt.spread = function (a, t, opts) {
    if (!C.HUNT_LEAD_V1) return 0;
    const now = nowSec();
    const r = sample(a, now);
    if (!r) return 0;
    const tau = hunt.tau(a, opts), v = hunt.speed(a, opts);
    const T = Math.max(0, Math.min(MAX_T, num(t, 0)));
    if (!(v > 1e-4) || T <= 0) return 0;
    const e = Math.exp(-T / tau);
    const f = 2 * (T / tau - 1 + e) - (1 - e) * (1 - e);
    return v * tau * Math.sqrt(Math.max(0, f));
  };

  // WHERE WILL HE BE. The one call worth adopting.
  hunt.at = function (a, t, out) {
    const o = out || _out;
    const p = posOf(a);
    if (!p) { o.x = 0; o.z = 0; return o; }
    o.x = p.x; o.z = p.z;
    if (!C.HUNT_LEAD_V1) return o;
    const now = nowSec();
    const r = sample(a, now);
    drain(now);
    const T = Math.max(0, Math.min(MAX_T, num(t, 0)));
    if (!r || T <= 0) return o;
    const v = hunt.speed(a);
    if (!(v > 1e-4)) return o;
    const tau = hunt.tau(a);
    const d = v * tau * (1 - Math.exp(-T / tau));
    o.x = p.x + (r.vx / v) * d;
    o.z = p.z + (r.vz / v) * d;
    A.asks++;
    // the self-grading sample. Only forecasts worth a second are worth
    // checking, and the ring is bounded so a busy frame cannot grow it.
    if (T >= 1 && ((++askN % CHECK_EVERY) === 0) && pending.length < CHECK_MAX) {
      pending.push({ a: a, x: o.x, z: o.z, sp: hunt.spread(a, T), due: now + T, seq: r.seq });
    }
    return o;
  };

  // SOFT MEMBERSHIP — 1 inside R, and outside it the honest probability that
  // the smear reaches in. This is the line a caller writes as
  // `if (d > R) continue;` and it is the whole difference between a gate that
  // pretends to know and one that does not.
  hunt.within = function (d, R, sigma) {
    const dd = num(d, 0), r = num(R, 0), s = num(sigma, 0);
    if (dd <= r) return 1;
    if (!(s > 1e-3)) return 0;
    const q = (dd - r) / s;
    return Math.exp(-0.5 * q * q);
  };

  // THERE IS NO `score(x, z, R, list)` DISC QUERY IN HERE, AND THAT IS
  // DELIBERATE. It was written, it read well, and no caller in this change
  // wanted a disc — every real question so far is a CORRIDOR (a street, a
  // stick, a lane), which `within` already answers. A shared block with a
  // function nobody calls is the `forex.convert()` disease this repo keeps
  // catching itself in. Add it back the day a second consumer needs it.

  // THE CLASSIC SOLVE, for a hunter that closes at a speed: find the t at
  // which we and he arrive together. Fixed-point rather than the quadratic,
  // because drift() is not linear in t — five passes converge to under a
  // metre for anything that walks. `opts.travel(x, z)` is the seam for a
  // hunter whose travel time is not distance/speed (an aeroplane pays for
  // its turn); pass it and `spd` is ignored.
  hunt.intercept = function (hx, hz, spd, a, opts) {
    const p = posOf(a); if (!p) return null;
    const travel = opts && opts.travel;
    if (!travel && !(spd > 0)) return null;
    const maxT = (opts && opts.maxT) || MAX_T;
    let t = travel ? travel(p.x, p.z) : Math.sqrt((p.x - hx) * (p.x - hx) + (p.z - hz) * (p.z - hz)) / spd;
    let q = _scr2;
    for (let i = 0; i < 5; i++) {
      t = Math.max(0, Math.min(maxT, t));
      q = hunt.at(a, t, _scr2);
      const nt = travel ? travel(q.x, q.z)
        : Math.sqrt((q.x - hx) * (q.x - hx) + (q.z - hz) * (q.z - hz)) / spd;
      if (Math.abs(nt - t) < 0.02) { t = nt; break; }
      t = nt;
    }
    t = Math.max(0, Math.min(maxT, t));
    q = hunt.at(a, t, _scr2);
    return { x: q.x, z: q.z, t: t, spread: hunt.spread(a, t, opts) };
  };
  const _scr2 = { x: 0, z: 0 };

  // THE MOVER'S ONE LINE, and it REPLACES the velocity field a mover
  // hand-publishes today. `at()` self-tracks, so this is never REQUIRED —
  // but self-tracking only sees the actor on the frames somebody asks about
  // it, and a planner that asks once a minute would re-seed the record every
  // time and read zero velocity forever. A mover that calls this owns its own
  // sampling rate and can never be sampled too slowly to be forecast.
  hunt.track = function (a) { sample(a, nowSec()); return a; };

  // ---------------------------------------------------------------- RATCHET
  // LEGACY: counted by hand, file:line, in this file's header. Not a guess
  // and not a grep — a grep for "lead" in this repo returns camera code.
  // Lower it only by migrating one of the four sites named up there.
  const LEGACY = 3;
  CBZ.huntAudit = function () {
    return {
      legacy: LEGACY,
      asks: A.asks,
      checks: A.checks,
      pending: pending.length,
      meanErr: A.checks ? +(A.errSum / A.checks).toFixed(2) : 0,
      meanSpread: A.checks ? +(A.spreadSum / A.checks).toFixed(2) : 0,
      calibration: (A.checks && A.spreadSum > 0) ? +(A.errSum / A.spreadSum).toFixed(3) : 0,
      overconfident: A.over,
      worstErr: +A.worst.toFixed(1),
      on: !!C.HUNT_LEAD_V1,
    };
  };
})();
