/* ============================================================
   systems/aitactics.js — SHARED COP-GRADE TACTICAL PRIMITIVES.

   WHY THIS FILE EXISTS: city/police.js's hunting branch had four real
   tactical layers (LOS-memory→SEARCH-sweep, deterministic flank-lane
   assignment, reactive cover-peek cycling, glass-breach/door-routing when
   blind) that made cops read as smart, while every other armed NPC system
   (city/squadai.js's gang-vs-gang / VIP-guard / player-crew fights) only had
   pure standoff-band positioning — zero code sharing, a parallel dumber
   brain. This module is the FIX: the exact same math, pulled out of
   police.js into generic functions parametrized by actor state (position,
   target, a handful of memory fields the caller attaches to its own actor —
   mirroring the cop's lostT/lkx/lkz/_flank/_coverT naming so the port is
   1:1 readable) instead of hardcoded cop fields. police.js's hunting branch
   now CALLS these; it does not reimplement them. squadai.js's combat layers
   call them too, so gang wars get the same depth cops have.

   What stays OUT of this module (cop-only, not generalized this pass):
   gun-stop challenge/comply/execute, radio dispatch, roadblocks, PIT,
   chopper, holster hysteresis. Those remain entirely in police.js.

   Exposes (all pure-ish: read/write only the actor object passed in):
     CBZ.aiTactics.updateLOS(actor, tx, tz, dt, opts)   — throttled LOS probe
       + lost-sight memory. Writes actor._losCD/_losClear/sees/lostT/lkx/lkz.
       Returns { sees, justLost } (justLost = lostT just crossed opts.giveUpT).
     CBZ.aiTactics.flankLane(actor, index, opts)         — deterministic
       left/center/right (or wider) lane assignment, cached on actor._flank.
     CBZ.aiTactics.flankApproach(actor, dx, dz, dist, opts) — approach vector
       biased by the actor's flank lane (the "encircle, don't conga-line"
       offset police.js applied to its final approach step).
     CBZ.aiTactics.coverPeek(actor, dx, dz, dist, dt, opts) — reactive
       sidestep-to-cover-then-peek cycle. Returns a {x,z} steer delta while
       active, else null (caller falls through to its normal approach).
     CBZ.aiTactics.blindFlank(actor, dx, dz, dist, dt, opts) — perpendicular
       "can't see them, work the corner" dodge/flank step used while blind.
     CBZ.aiTactics.breachOrRoute(actor, target, tx, tz, dist, dt, opts) —
       glass-breach-when-blind (CBZ.cityNpcBreachGlass) then door-routing via
       cityNav.indoorLotAt when walled out. Returns a {x,z} steer goal while
       a detour is active, else null.
     CBZ.aiTactics.searchStart(actor, last, opts) / searchTick(actor, dt, opts)
       — SEARCH-state sweep around a last-known point once contact is lost
       long enough (start() arms it, mirrors police.js goSearch; tick()
       advances it and returns a {x,z} steer goal, or null once the sweep
       has ended — caller should then resume its normal branch).

   Every function early-returns false/null/no-op if the actor lacks the
   fields it needs (no .target, no .pos) — same headless-safe discipline as
   the rest of city/*. No Math.random(): callers pass an `opts.rng` (a
   seeded LCG) for every probabilistic choice; a missing rng falls back to
   a local seeded LCG so this file is never the source of a determinism bug.
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  // local fallback seeded LCG — only used if a caller forgets to pass opts.rng
  // (every real caller in police.js/squadai.js passes its own module rng).
  let _s = 271828;
  function fallbackRng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }
  function rngOf(opts) { return (opts && typeof opts.rng === "function") ? opts.rng : fallbackRng; }

  // ============================================================
  //  LOS-MEMORY / SEARCH-SWEEP (extracted from police.js ~1696-1723, 1837-1865)
  // ============================================================
  const _ray = new THREE.Raycaster();
  const _o = new THREE.Vector3(), _d = new THREE.Vector3();
  // raw wall raycast — does a building block this straight line? Shared by
  // every caller (mirrors police.js's losClear). Throttled per-actor by the
  // caller via _losCD, not here, so a busy frame never re-rays everyone.
  function rawLosClear(ax, az, bx, bz, far) {
    const blk = CBZ.losBlockers;
    if (!blk || !blk.length) return true;
    _o.set(ax, 1.4, az);
    _d.set(bx - ax, 0, bz - az);
    const len = _d.length(); if (len < 0.5) return true;
    _d.multiplyScalar(1 / len);
    _ray.set(_o, _d); _ray.far = far || 60;
    const hits = CBZ.losRaycast ? CBZ.losRaycast(_ray, blk) : _ray.intersectObjects(blk, false);
    return hits.length === 0;
  }
  CBZ.aiTactics = CBZ.aiTactics || {};

  // updateLOS: throttled raycast (re-tested every ~0.22-0.34s, jittered) with a
  // glass-breach re-confirm (sees through a hole the actor itself just shot)
  // and an optional "painted" override (e.g. police's chopper spotlight, or any
  // future spotter feed) that counts as a sighting without a raycast at all.
  // opts: { range, breachReach, painted, far, giveUpT }
  CBZ.aiTactics.updateLOS = function (actor, tx, tz, dt, opts) {
    if (!actor || !actor.pos) return { sees: false, justLost: false };
    opts = opts || {};
    const range = opts.range != null ? opts.range : 48;
    const ax = actor.pos.x, az = actor.pos.z;
    const dist = Math.hypot(tx - ax, tz - az);
    const rng = rngOf(opts);

    if (actor._losCD == null) actor._losCD = rng() * 0.25;
    actor._losCD -= (dt || 0);
    if (actor._losCD <= 0) {
      actor._losCD = 0.22 + rng() * 0.12;
      actor._losClear = dist < range && rawLosClear(ax, az, tx, tz, opts.far);
      // GLASS WE JUST SHOT OUT reads as open air to the cheap wall raycast (it
      // still hits the facade box); re-test the glass-aware way so the actor
      // sees through its own hole instead of standing there re-breaking nothing.
      if (!actor._losClear && (actor._breachedT || 0) > 0 && opts.breachReach &&
          dist < opts.breachReach && CBZ.clearLineOfFire) {
        const ty = opts.targetY != null ? opts.targetY : 1.4;
        actor._losClear = CBZ.clearLineOfFire(ax, (actor.pos.y || 0) + 1.4, az, tx, ty, tz);
      }
    }
    const sees = dist < range && (actor._losClear || !!opts.painted || dist < 4);
    actor.sees = sees;
    let justLost = false;
    if (sees) {
      actor.lostT = 0;
      actor.lkx = tx; actor.lkz = tz;            // remember where we last saw the target
    } else {
      actor.lostT = (actor.lostT || 0) + (dt || 0);
      const giveUpT = opts.giveUpT != null ? opts.giveUpT : 4;
      if (actor.lostT > giveUpT) justLost = true;   // caller should kick off a search
    }
    return { sees, justLost, dist };
  };

  // searchSweep: GTA-style "go to last-known, then sweep nearby before giving
  // up". start() arms the state (mirrors police.js goSearch); tick() advances
  // it and returns a {x,z} steer goal (or null once the sweep should end).
  // opts: { dur, sweepRadMin, sweepRadMax, reachR, rng }
  CBZ.aiTactics.searchStart = function (actor, last, opts) {
    if (!actor) return false;
    if (!last || last.x == null) { actor.searchT = 0; return false; }
    opts = opts || {};
    const rng = rngOf(opts);
    const dur = opts.dur != null ? opts.dur : (6 + rng() * 4);
    actor.searchT = dur;
    actor.searchGoal = { x: last.x, z: last.z };
    actor._sweepGoal = null;
    return true;
  };
  // returns the next {x,z} to walk toward, or null when the search just ended
  // (caller should then clear its own target/giveUp state for this actor).
  CBZ.aiTactics.searchTick = function (actor, dt, opts) {
    if (!actor || !(actor.searchT > 0)) return null;
    opts = opts || {};
    const rng = rngOf(opts);
    actor.searchT -= (dt || 0);
    const sg = actor.searchGoal;
    if (!sg) { actor.searchT = 0; return null; }
    const sdx = sg.x - actor.pos.x, sdz = sg.z - actor.pos.z, sd = Math.hypot(sdx, sdz);
    const reachR = opts.reachR != null ? opts.reachR : 3;
    let goalDx = sdx, goalDz = sdz;
    if (sd < reachR) {
      // reached the last-known — pick a new nearby sweep point (wander, hoping
      // to re-spot), re-rolled once the previous sweep point is reached too.
      if (!actor._sweepGoal || Math.hypot(actor.pos.x - actor._sweepGoal.x, actor.pos.z - actor._sweepGoal.z) < 2.5) {
        const ang = rng() * 6.28;
        const radMin = opts.sweepRadMin != null ? opts.sweepRadMin : 6;
        const radMax = opts.sweepRadMax != null ? opts.sweepRadMax : 16;
        const rad = radMin + rng() * (radMax - radMin);
        actor._sweepGoal = { x: sg.x + Math.cos(ang) * rad, z: sg.z + Math.sin(ang) * rad };
      }
      goalDx = actor._sweepGoal.x - actor.pos.x; goalDz = actor._sweepGoal.z - actor.pos.z;
    }
    if (actor.searchT <= 0) { actor.searchGoal = null; actor._sweepGoal = null; return null; }
    return { x: goalDx, z: goalDz, sweeping: sd < reachR };
  };

  // ============================================================
  //  FLANK-LANE ASSIGNMENT (extracted from police.js ~1737, 1814-1820, 1824-1828)
  // ============================================================
  // deterministic lane by roster index so a squad fans out (left/center/right)
  // instead of conga-lining single file. Cached on actor._flank — set ONCE,
  // same as police.js's `if (c._flank == null) c._flank = ((i % 3) - 1);`.
  CBZ.aiTactics.flankLane = function (actor, index, lanes) {
    if (!actor) return 0;
    if (actor._flank == null) {
      const n = lanes != null ? lanes : 3;          // default: -1 left, 0 center, +1 right
      actor._flank = (index % n) - ((n - 1) / 2 | 0);
    }
    return actor._flank;
  };

  // approach offset for a final close-in step: spreads the squad onto an
  // encircling arc around the target rather than everyone beelining the same
  // point. amt is the lateral spread distance (police.js used stars-scaled 4-7).
  CBZ.aiTactics.flankApproach = function (actor, dx, dz, dist, amt) {
    const px = -dz / (dist || 1), pz = dx / (dist || 1);
    const lane = actor._flank || 0;
    return { x: dx + px * lane * amt, z: dz + pz * lane * amt };
  };

  // blindFlank: "I can't see them — work the corner" perpendicular dodge while
  // blind, flipping side every ~1.2-2.0s so the actor doesn't grind on one
  // spot. A little closing bias keeps it from orbiting forever.
  // opts: { period, periodJitter, sideAmt, closeBias, rng }
  CBZ.aiTactics.blindFlank = function (actor, dx, dz, dist, dt, opts) {
    if (!actor) return { x: dx, z: dz };
    opts = opts || {};
    const rng = rngOf(opts);
    const period = opts.period != null ? opts.period : 1.2;
    const jitter = opts.periodJitter != null ? opts.periodJitter : 0.8;
    actor._flankT = (actor._flankT || 0) - (dt || 0);
    if (actor._flankT <= 0 || actor._flankSide == null) {
      actor._flankT = period + rng() * jitter;
      actor._flankSide = (actor._flankSide === 1) ? -1 : 1;
    }
    const px = -dz / (dist || 1), pz = dx / (dist || 1);
    const sideAmt = opts.sideAmt != null ? opts.sideAmt : 5;
    const closeBias = opts.closeBias != null ? opts.closeBias : 0.35;
    return { x: px * actor._flankSide * sideAmt + dx * closeBias, z: pz * actor._flankSide * sideAmt + dz * closeBias };
  };

  // ============================================================
  //  COVER-PEEK CYCLING (extracted from police.js ~1758, 1763-1768)
  // ============================================================
  // arm(): call right after a shot to maybe trigger a duck-for-cover beat
  // (chance-gated by the caller — police.js only ducks vs an armed player).
  CBZ.aiTactics.coverArm = function (actor, opts) {
    if (!actor) return;
    opts = opts || {};
    const rng = rngOf(opts);
    const dur = opts.dur != null ? opts.dur : (1.0 + rng());
    actor._coverT = dur;
    actor._coverDir = rng() < 0.5 ? -1 : 1;
  };
  // tick(): while armed, sidestep perpendicular to the target (peeking out a
  // little toward it) and count down; returns the {x,z} steer delta while
  // active, else null once the cover beat has ended (caller resumes normal
  // approach/shoot logic that frame).
  CBZ.aiTactics.coverPeek = function (actor, dx, dz, dist, dt, opts) {
    if (!actor || !(actor._coverT > 0)) return null;
    opts = opts || {};
    actor._coverT -= (dt || 0);
    const px = -dz / (dist || 1), pz = dx / (dist || 1);
    const sideAmt = opts.sideAmt != null ? opts.sideAmt : 4;
    const peek = opts.peek != null ? opts.peek : 0.15;
    return { x: px * actor._coverDir * sideAmt + dx * peek, z: pz * actor._coverDir * sideAmt + dz * peek };
  };

  // ============================================================
  //  GLASS-BREACH-WHEN-BLIND + DOOR-ROUTING-WHEN-BLIND
  //  (extracted from police.js ~1770-1812)
  // ============================================================
  // breachOrRoute: when the actor is blind (no LOS, _losClear===false) and
  // close enough, first try shooting out blocking glass (capability-gated —
  // only actors whose caller opts in via opts.canBreach, e.g. armed shooters)
  // via the shared CBZ.cityNpcBreachGlass; if that's not available/applicable,
  // fall back to routing toward the target building's DOOR (cityNav.indoorLotAt)
  // so the actor makes for a real opening instead of grinding on the facade.
  // Returns { kind: "breach" | "door", x, z } while a detour is active this
  // frame, else null (caller should fall through to its normal flank/approach).
  CBZ.aiTactics.breachOrRoute = function (actor, target, tx, tz, dist, dt, opts) {
    if (!actor || !target) return null;
    opts = opts || {};
    const rng = rngOf(opts);
    const blind = actor._losClear === false && !actor.sees;
    if (!blind) { actor._doorGoal = null; return null; }

    // ---- glass breach: only within reach, only if the caller's actor can
    // plausibly do it (capability flag — cops/armed shooters; never a fistfighter). ----
    const breachReach = opts.breachReach != null ? opts.breachReach : 16;
    if (opts.canBreach && dist < breachReach && actor._losClear === false && CBZ.cityNpcBreachGlass) {
      if (CBZ.cityNpcBreachGlass(actor, target, breachReach)) {
        actor._losCD = 0;     // re-test the (now open) line of sight immediately next tick
        return { kind: "breach", x: tx - actor.pos.x, z: tz - actor.pos.z };
      }
    }

    // ---- door routing: no glass to breach, but the target is INSIDE a
    // building we're walled out of → make for that building's door instead of
    // grinding on the wall. Only when genuinely blind + close-ish (a far
    // target stays the flank/search code's job). Throttled lookup, cheap. ----
    if (!opts.canRouteDoors) return null;
    const doorRange = opts.doorRange != null ? opts.doorRange : 34;
    if (dist >= doorRange) { actor._doorGoal = null; return null; }
    if (!CBZ.cityNav || !CBZ.cityNav.indoorLotAt) return null;
    actor._doorCD = (actor._doorCD || 0) - (dt || 0);
    if (actor._doorCD <= 0) {
      actor._doorCD = 0.5 + rng() * 0.3;
      const lot = CBZ.cityNav.indoorLotAt(tx, tz);
      const door = lot && lot.building && lot.building.door;
      // only route to the door if it actually sits between us and the wall
      // (closer to us than the target itself) — don't run AWAY from a target
      // who's already standing in the doorway.
      actor._doorGoal = (door && Math.hypot(door.x - actor.pos.x, door.z - actor.pos.z) > 2.4) ? { x: door.x, z: door.z } : null;
    }
    if (!actor._doorGoal) return null;
    const ddx = actor._doorGoal.x - actor.pos.x, ddz = actor._doorGoal.z - actor.pos.z;
    if (Math.hypot(ddx, ddz) < 2.2 || actor.sees) { actor._doorGoal = null; return null; }   // reached / sightline opened
    return { kind: "door", x: ddx, z: ddz };
  };

  // ============================================================
  //  ENGAGE / TICK — the thin composition non-cop callers actually invoke.
  //  (peds.js's important-ped tactical handoff: CBZ.aiTactics.engage(actor,
  //  target, dt) — called every think() tick while an important armed ped is
  //  mid-fight. Composes the primitives above exactly the way police.js's
  //  hunting branch chains them, but as one cheap call so a non-cop system
  //  doesn't need to hand-roll the LOS→search/flank/cover state machine.)
  //
  //  Call signature MUST match peds.js ~3146: tac.engage(actor, target, dt).
  //  `actor` is the ped (has .pos Vector3-like, .target Vector3 w/ .set,
  //  .armed). `target` is the thing it's raging at (has .pos), i.e. the
  //  actor's `.rage`. opts (optional 4th arg) lets a future caller tune
  //  ranges/chances without touching this file again; every field defaults.
  //
  //  Effect: refines actor.target (already pointed straight at target.pos by
  //  the caller) into a tactical steer goal — flank arc while it can see,
  //  cover-peek sidesteps while close, blind-dodge/search/door-route while it
  //  can't see. Attack range/fire checks in peds.js compare real distance to
  //  target.pos (not actor.target), so nudging actor.target only changes HOW
  //  the ped closes in, never whether it's allowed to shoot once in range.
  //  Returns true if it ran (false if actor/target lack .pos — caller's
  //  try/catch means a false here is harmless either way).
  // ============================================================
  let _tacIdxNext = 0;
  CBZ.aiTactics.engage = function (actor, target, dt, opts) {
    if (!actor || !actor.pos || !actor.target || !target || !target.pos) return false;
    opts = opts || {};
    const rng = rngOf(opts);
    const tx = target.pos.x, tz = target.pos.z;
    const dx = tx - actor.pos.x, dz = tz - actor.pos.z;
    const dist = Math.hypot(dx, dz) || 0.001;

    if (actor._tacIdx == null) actor._tacIdx = _tacIdxNext++;
    if (actor._flank == null) CBZ.aiTactics.flankLane(actor, actor._tacIdx, opts.lanes);

    const los = CBZ.aiTactics.updateLOS(actor, tx, tz, dt, opts.los);
    let goal = null;

    if (!los.sees) {
      goal = CBZ.aiTactics.breachOrRoute(actor, target, tx, tz, dist, dt, opts.breach || {
        canBreach: !!actor.armed, canRouteDoors: true, rng: rng,
      });
      if (!goal) {
        if (los.justLost) CBZ.aiTactics.searchStart(actor, { x: actor.lkx, z: actor.lkz }, opts.search);
        goal = CBZ.aiTactics.searchTick(actor, dt, opts.search);
      }
      if (!goal) goal = CBZ.aiTactics.blindFlank(actor, dx, dz, dist, dt, opts.blind);
    } else {
      actor.searchT = 0; actor.searchGoal = null;   // re-spotted — drop any stale search
      goal = CBZ.aiTactics.coverPeek(actor, dx, dz, dist, dt, opts.cover);
      if (!goal) {
        const amt = opts.flankAmt != null ? opts.flankAmt : 5;
        goal = CBZ.aiTactics.flankApproach(actor, dx, dz, dist, amt);
        // occasionally duck into a cover-peek beat while armed and close, same
        // chance-gated arm() police.js does after a shot — here just rate-limited
        // since this module has no shot-callback hook of its own.
        if (actor.armed) {
          actor._tacCoverCD = (actor._tacCoverCD || 0) - (dt || 0);
          if (actor._tacCoverCD <= 0) {
            actor._tacCoverCD = 1.0 + rng() * 1.5;
            const coverRange = opts.coverRange != null ? opts.coverRange : 14;
            const coverChance = opts.coverChance != null ? opts.coverChance : 0.15;
            if (dist < coverRange && rng() < coverChance) CBZ.aiTactics.coverArm(actor, opts.cover);
          }
        }
      }
    }

    if (goal) actor.target.set(actor.pos.x + goal.x, 0, actor.pos.z + goal.z);
    return true;
  };
  // tick: alias kept for forward/backward compat — peds.js falls back to
  // tac.tick() if .engage isn't present; same primitive composition either name.
  CBZ.aiTactics.tick = CBZ.aiTactics.engage;
})();
