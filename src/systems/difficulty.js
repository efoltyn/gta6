/* ============================================================
   systems/difficulty.js — "Difficulty ramp".

   The prison gets meaner the longer you stay loose. Over the first
   ~4 minutes of a run we smoothly crank every guard's eyesight
   (viewDist) and pace (speed) up to ~+35%, let heat cool a touch
   slower, and — to break up the memorise-the-route exploit — every
   so often a patrolling guard stops, plants its feet, and sweeps its
   head around to scan the area. The ramp climbs in discrete "tiers"
   that fire a subtle hint when crossed, so the difficulty creep is
   felt, not just numbers behind the curtain.

   Everything is restored to the stored base the instant a new run
   starts (we watch CBZ.game.elapsed fall back toward 0) and also if
   we ever leave the 'playing' state (win / pause-to-title), so a
   guard is never left frozen mid-scan on a menu screen.

   We run AFTER guards.js (order 20) drives the patrols so our scan
   pin overrides their movement, and AFTER detection.js (order 30)
   tweaks heat so we can gently offset its cooling.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || typeof CBZ.onUpdate !== "function") return; // never throw at load
  const g = CBZ.game;
  if (!g) return;

  // ---- tuning ----
  const RAMP_SECS = 240;     // ~4 minutes to reach full difficulty
  const MAX_BOOST = 0.35;    // +35% to viewDist and speed at full ramp
  const TIERS = 5;           // number of "step up" notifications across the ramp
  const COOL_SLOW = 0.55;    // at full ramp, ~55% of the would-be cooling is clawed back

  // scan pacing (only kicks in once the ramp is meaningfully up)
  const SCAN_MIN_RAMP = 0.18;   // no scanning during the easy opening
  const SCAN_CHANCE = 0.10;     // per eligible check, chance a guard starts a scan
  const SCAN_CHECK_CD = 1.6;    // seconds between scan-start dice rolls (cheap throttle)
  const SCAN_DUR_MIN = 1.4;     // how long a scan holds
  const SCAN_DUR_MAX = 2.6;
  const SCAN_SWEEP = 1.15;      // radians swept to each side while looking around
  const SCAN_SPEED = 2.4;       // sweep angular rate

  // ---- run-local state ----
  let ramp = 0;                 // smooth 0..1 difficulty
  let tier = 0;                 // last announced tier
  let lastElapsed = 0;          // to detect a run reset (elapsed falling)
  let scanRollT = 0;            // throttle for picking a scanner

  // single shared rng (seeded econ rng if present, else Math.random) so the
  // hot path never allocates a fresh closure per frame.
  const rng = (CBZ.econ && typeof CBZ.econ.rng === "function")
    ? function () { return CBZ.econ.rng(); }
    : Math.random;
  const lerpAngle = CBZ.lerpAngle || function (a, b, t) { return a + (b - a) * t; };

  // ---- per-guard base capture / restore ----
  // We store the natural patrol values ONCE, the first time we see a guard
  // at its base (the difficulty module hasn't touched it yet). Reinforcement
  // guards spawned mid-run are captured the frame they appear, so they get
  // boosted from THEIR own natural values, never compounded.
  function ensureBase(gd) {
    if (gd._diffBase) return;
    gd._diffBase = {
      viewDist: gd.viewDist,
      speed: gd.speed,
    };
  }

  // apply the current ramp multiplier, always recomputed from the stored
  // base so repeated frames never compound the boost.
  function applyBoost(gd, mult) {
    const b = gd._diffBase;
    if (!b) return;
    gd.viewDist = b.viewDist * mult;
    gd.speed = b.speed * mult;
  }

  // hard restore to natural values (new run / leaving play / cleanup)
  function restore(gd) {
    const b = gd._diffBase;
    if (!b) return;
    gd.viewDist = b.viewDist;
    gd.speed = b.speed;
    // drop any in-progress scan so the guard resumes patrol cleanly
    if (gd._scan) endScan(gd);
  }

  function restoreAll() {
    if (!CBZ.guards) return;
    for (const gd of CBZ.guards) restore(gd);
  }

  function endScan(gd) {
    gd._scan = null;
    gd._scanBaseYaw = null;
    gd._scanPin = null;
  }

  // ---- reset handling: watch elapsed drop toward 0 ----
  function maybeReset() {
    const e = g.elapsed || 0;
    // a fresh run zeroes elapsed; treat any meaningful backward jump as a reset.
    if (e + 0.5 < lastElapsed) {
      ramp = 0; tier = 0; scanRollT = 0;
      restoreAll();
    }
    lastElapsed = e;
  }

  // ---- the difficulty curve: smooth ease toward 1 over RAMP_SECS ----
  function computeRamp(e) {
    let t = e / RAMP_SECS;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    // smoothstep so it eases in gently and tops out softly (no hard cap snap)
    return t * t * (3 - 2 * t);
  }

  // ---- announce tier step-ups with a subtle hint ----
  const TIER_HINTS = [
    "The block is settling in for a long shift…",
    "⚠ The guards are getting restless.",
    "⚠ Patrols sharpen up — eyes everywhere.",
    "⚠ Lockdown footing. They're hunting harder now.",
    "⚠ Maximum vigilance — the whole block is on edge.",
  ];
  function checkTier() {
    // tiers spread across the ramp; the final tier lands at full difficulty
    const t = Math.min(TIERS, Math.floor(ramp * TIERS + 0.0001));
    if (t > tier) {
      tier = t;
      // The prison-flavor difficulty hints ("⚠ The guards are getting restless"…)
      // do NOT belong in the open CITY — advance the tier SILENTLY there (survival
      // is already excluded in the driver). The difficulty math still applies; only
      // the fourth-wall toast is suppressed.
      if (CBZ.game && CBZ.game.mode === "city") return;
      const msg = TIER_HINTS[Math.min(TIER_HINTS.length - 1, t - 1)];
      if (typeof CBZ.flashHint === "function" && msg) CBZ.flashHint(msg, 2.2);
    }
  }

  // ---- occasional patrol scan ----
  // A scanning guard freezes in place and sweeps its facing back and forth.
  // We pin its position each frame (guards.js will have nudged it along its
  // route just before us) and drive rotation.y ourselves. We only ever scan
  // a plain, calm patroller — never one that's down, alerted, hunting,
  // bribed, or dead — and we hand control straight back when the timer ends.
  function guardCalm(gd) {
    return !gd.dead && !(gd.ko > 0) && !(gd.hunt > 0) && !(gd.alert > 0) &&
           !(gd.bribed > 0) && gd.group && gd.waypoints && gd.waypoints.length > 1;
  }

  function startScan(gd) {
    gd._scan = SCAN_DUR_MIN + rng() * (SCAN_DUR_MAX - SCAN_DUR_MIN);
    gd._scanBaseYaw = gd.group.rotation.y;     // sweep around current facing
    // pin to wherever the guard is right now
    gd._scanPin = { x: gd.group.position.x, z: gd.group.position.z };
  }

  function driveScan(gd, dt) {
    // if the guard got disturbed mid-scan, bail out and let AI take over
    if (!guardCalm(gd)) { endScan(gd); return; }
    gd._scan -= dt;
    // hold position (undo guards.js patrol nudge this frame)
    gd.group.position.x = gd._scanPin.x;
    gd.group.position.z = gd._scanPin.z;
    // smooth back-and-forth head sweep around the base facing.
    // CBZ.now is a ms timestamp; guard it in case we somehow run before
    // the first loop tick has set it.
    const phase = (CBZ.now || 0) * 0.001 * SCAN_SPEED;
    const target = gd._scanBaseYaw + Math.sin(phase) * SCAN_SWEEP;
    gd.group.rotation.y = lerpAngle(gd.group.rotation.y, target, 1 - Math.pow(0.0006, dt));
    if (gd._scan <= 0) endScan(gd);
  }

  function updateScans(dt) {
    if (!CBZ.guards) return;
    // drive any scans already in progress
    for (const gd of CBZ.guards) if (gd._scan) driveScan(gd, dt);

    if (ramp < SCAN_MIN_RAMP) return;     // no scanning early on
    scanRollT -= dt;
    if (scanRollT > 0) return;
    scanRollT = SCAN_CHECK_CD;

    // pick at most ONE eligible patroller per check and maybe start it scanning.
    // scan likelihood scales with the ramp so it's rare early, common late.
    const chance = SCAN_CHANCE * (0.4 + 0.6 * ramp);
    // gather calm, non-scanning candidates cheaply (small array, fine on phones)
    let pick = null, n = 0;
    for (const gd of CBZ.guards) {
      if (gd._scan || !guardCalm(gd)) continue;
      n++;
      // reservoir pick: each candidate has equal chance of being the one
      if (rng() < 1 / n) pick = gd;
    }
    if (pick && rng() < chance) startScan(pick);
  }

  // ---- slower heat cooldown ----
  // detection.js (order 30) already applied its frame of cooling before we
  // run. We can't edit it, so we gently claw back a fraction of that cooling
  // as the ramp climbs — only while heat is actually present and decaying,
  // and never enough to make heat climb on its own. We mirror detection's
  // EXACT cooling formula (including the restricted-zone case) so the slice
  // we re-add is always strictly smaller than what detection just removed —
  // otherwise standing in a restricted zone at high ramp could make heat
  // creep UP on its own (detection only cools at 4/s in a zone, while a naive
  // estimate of 10/s would over-claw).
  function inZone(p) {
    // must match systems/detection.js zoneOf() so our cooling estimate is right
    if (p.x > 18.5 && p.x < 29.5 && p.z > -6.5 && p.z < 8.5) return true;   // armory
    if (p.x > 18.5 && p.x < 29.5 && p.z > 29.5 && p.z < 44.5) return true;  // staff lounge
    if (p.z > 47) return true;                                             // exit corridor
    return false;
  }

  function slowCooldown(dt) {
    const heat = g.detection || 0;
    if (heat <= 0.5 || heat >= 100) return;
    if (g.invuln > 0) return;                 // respect the spawn grace window
    const player = CBZ.player;
    if (!player || !player.pos) return;       // defensive: rig may not exist yet
    // mirror detection.js's cooling estimate so our offset is proportional and
    // can never exceed what was actually removed.
    const cooling = (!inZone(player.pos) && heat <= 60) ? 10 : 4;
    const giveBack = cooling * COOL_SLOW * ramp * dt;
    if (giveBack > 0) {
      // re-add a slice of the just-removed cooling; clamp so we never overshoot
      const target = Math.min(100, heat + giveBack);
      if (typeof CBZ.addHeat === "function") CBZ.addHeat(target - heat);
      else g.detection = target;
    }
  }

  // ---- main per-frame driver (playing only) ----
  CBZ.onUpdate(62, function (dt) {
    if (g.mode === "survival") return;   // prison difficulty curve / "guards restless" hints don't belong in disaster mode
    maybeReset();

    const prevRamp = ramp;
    ramp = computeRamp(g.elapsed || 0);

    // make sure every guard (including any spawned mid-run) has a stored base,
    // then apply the current boost from that base.
    const mult = 1 + MAX_BOOST * ramp;
    if (CBZ.guards) {
      for (const gd of CBZ.guards) {
        ensureBase(gd);
        applyBoost(gd, mult);
      }
    }

    if (ramp > prevRamp) checkTier();   // only test for step-ups while climbing

    updateScans(dt);
    slowCooldown(dt);
  });

  // ---- safety net: if we leave 'playing' without a reset (win screen, or a
  // pause that later drops back to title), make sure no guard is left boosted
  // or frozen mid-scan. onUpdate only fires while playing, so we watch state
  // on an always-runner (mirrors systems/reinforcements.js). A fresh run's
  // resetGame() does NOT touch guard viewDist/speed, so this restore is what
  // keeps the next run from inheriting a stale boost. ----
  let lastState = g.state;
  CBZ.onAlways(91, function () {
    const s = g.state;
    if (s !== lastState) {
      if (s !== "playing") restoreAll();
      lastState = s;
    }
  });

  // expose a tiny read-only hook for other systems / debugging
  CBZ.difficulty = {
    get ramp() { return ramp; },
    get multiplier() { return 1 + MAX_BOOST * ramp; },
    get tier() { return tier; },
  };
})();
