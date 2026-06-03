/* ============================================================
   systems/reinforcements.js — "Guard reinforcements".

   When the block goes loud — HEAT (game.detection) pinned above
   ~70 for a sustained beat — the towers radio it in and extra
   officers come pouring down from the corner watchtowers to run
   you down. We spawn at most ~3 of them, one at a time on a short
   cooldown, each entering from a tower corner ([-30,-8],[30,-8],
   [30,52]) with a patrol route bent toward your half of the yard
   and their HUNT primed so they make a beeline for you.

   When the heat finally cools — under ~20 for a sustained beat —
   the call is stood down and the reinforcements we summoned peel
   off and disappear (group pulled from the scene, geometry/material
   freed, spliced out of CBZ.guards). We ONLY ever touch guards we
   spawned ourselves (tagged ._reinf); the regular patrol roster is
   never disturbed.

   We load AFTER entities/guards.js (need CBZ.spawnGuard), AFTER
   detection.js (heat math) and capture.js (the chase/grab), and
   AFTER markers.js so the red HUNT chevron auto-attaches to our
   spawns just like any other guard. Everything is torn down the
   instant a new run starts (we watch CBZ.game.elapsed fall).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || typeof CBZ.onUpdate !== "function") return;

  const g = CBZ.game;
  if (!g) return;

  // ---- tuning ----------------------------------------------------------
  const HEAT_CALL = 70;      // heat at/above which the "call it in" timer builds
  const HEAT_STAND = 20;     // heat at/below which the "stand down" timer builds
  const CALL_HOLD = 1.6;     // seconds of sustained high heat before the FIRST wave
  const STAND_HOLD = 4.0;    // seconds of sustained low heat before we recall them
  const MAX_REINF = 3;       // never field more than this many of OUR guards
  const MAX_GUARDS = 16;     // hard ceiling on the whole roster (keep phones happy)
  const SPAWN_CD = 3.2;      // min seconds between successive reinforcement spawns
  const REPRIME_CD = 1.1;    // how often we top up an existing reinforcement's hunt
  const HUNT_SECS = 6.0;     // hunt timer we (re)apply so they keep chasing
  const ENTER_GRACE = 0.45;  // brief "just arrived" window (visual flair only)

  // corner tower spawn points + a bent patrol route that funnels the guard
  // toward the centre lane / exit approach where the player usually runs.
  // half-cones are wide and viewDist long: these are alert responders.
  const SPAWNS = [
    { start: [-30, -8], route: [[-30, -8], [-14, 2], [-6, 22], [-2, 44]] },
    { start: [ 30, -8], route: [[ 30, -8], [ 14, 2], [  6, 22], [ 2, 44]] },
    { start: [ 30, 52], route: [[ 30, 52], [ 16, 44], [ 6, 30], [ 0, 14]] },
  ];
  const REINF_SPEED = 3.9;   // a touch quicker than standard patrols
  const REINF_VIEW = 15;     // sharp eyes
  const REINF_HALF = 0.62;   // generous cone

  // ---- run-local state -------------------------------------------------
  const mine = [];           // ONLY the guards we spawned, in spawn order
  let callT = 0;             // accumulates while heat is high
  let standT = 0;            // accumulates while heat is low
  let spawnCd = 0;           // cooldown gate between spawns
  let reprimeCd = 0;         // cooldown gate for topping up hunt timers
  let nextSlot = 0;          // round-robins through SPAWNS so waves fan out
  let lastElapsed = 0;       // to detect a run reset (elapsed falling)
  let announced = false;     // one-shot "reinforcements!" toast per surge

  // ---- teardown of a single reinforcement ------------------------------
  // Pull the group from the scene, free its meshes, and remove the guard
  // from the global roster. Defensive throughout: any field may be missing
  // on a half-built or already-cleaned actor.
  function disposeMesh(o) {
    if (!o) return;
    if (o.geometry && o.geometry.dispose) { try { o.geometry.dispose(); } catch (e) {} }
    const m = o.material;
    if (m) {
      if (Array.isArray(m)) { for (const mm of m) if (mm && mm.dispose) try { mm.dispose(); } catch (e) {} }
      else if (m.dispose) { try { m.dispose(); } catch (e) {} }
    }
  }

  function removeReinf(gd) {
    if (!gd) return;
    // make absolutely sure it can't be doing anything this frame
    gd.hunt = 0; gd.alert = 0; gd.ko = 0; gd.dead = true;
    // detach + free the whole rig (recursively walk the group)
    if (gd.group) {
      if (gd.group.parent) gd.group.parent.remove(gd.group);
      else if (CBZ.scene) CBZ.scene.remove(gd.group);
      if (gd.group.traverse) {
        try { gd.group.traverse(disposeMesh); } catch (e) {}
      }
    }
    if (gd.wedge) disposeMesh(gd.wedge);
    if (gd._marker) disposeMesh(gd._marker); // markers.js attaches one lazily
    // splice out of the global roster (search by identity, never by index)
    if (CBZ.guards) {
      const i = CBZ.guards.indexOf(gd);
      if (i >= 0) CBZ.guards.splice(i, 1);
    }
  }

  // recall EVERY reinforcement we still hold
  function recallAll() {
    for (let i = mine.length - 1; i >= 0; i--) removeReinf(mine[i]);
    mine.length = 0;
    callT = 0; standT = 0; spawnCd = 0; reprimeCd = 0; announced = false;
  }

  // ---- spawn one reinforcement from a tower corner ---------------------
  function spawnOne() {
    if (typeof CBZ.spawnGuard !== "function") return false;
    // respect both our own cap and the overall roster ceiling
    if (countLive() >= MAX_REINF) return false;
    if (CBZ.guards && CBZ.guards.length >= MAX_GUARDS) return false;

    const slot = SPAWNS[nextSlot % SPAWNS.length];
    nextSlot++;

    let gd = null;
    try {
      // CBZ.spawnGuard(waypoints, speed, viewDist, half, opts) — auto-pushed
      // onto CBZ.guards and added to the scene by entities/guards.js.
      gd = CBZ.spawnGuard(slot.route.map((p) => [p[0], p[1]]),
                          REINF_SPEED, REINF_VIEW, REINF_HALF, {});
    } catch (e) { gd = null; }
    if (!gd || !gd.group) return false;

    gd._reinf = true;              // OUR tag — the only guards we ever touch
    gd._enterT = ENTER_GRACE;      // brief arrival flair window
    if (gd.data) gd.data.name = (gd.data.name || "Officer") + " (riot)";
    // make sure it actually starts at the tower corner it radioed from
    if (gd.group.position && gd.group.position.set) {
      gd.group.position.set(slot.start[0], 0, slot.start[1]);
    }
    if (gd.start && gd.start.set) gd.start.set(slot.start[0], 0, slot.start[1]);
    gd.wi = 0;
    // prime the chase — guards.js reads gd.hunt and runs the player down
    gd.hunt = HUNT_SECS;
    gd.alert = 0.8;

    mine.push(gd);

    // ---- arrival juice ----
    if (CBZ.sfx) { try { CBZ.sfx("alarm"); } catch (e) {} }
    if (CBZ.shake) { try { CBZ.shake(0.35); } catch (e) {} }
    return true;
  }

  // how many of ours are still alive & on the roster (prune stragglers)
  function countLive() {
    let n = 0;
    for (let i = mine.length - 1; i >= 0; i--) {
      const gd = mine[i];
      // if something else removed/killed it, drop our reference too
      if (!gd || gd.dead || !CBZ.guards || CBZ.guards.indexOf(gd) === -1) {
        mine.splice(i, 1);
        continue;
      }
      n++;
    }
    return n;
  }

  // ---- new-run reset: watch elapsed fall toward 0 ----------------------
  function maybeReset() {
    const e = g.elapsed || 0;
    if (e + 0.5 < lastElapsed) recallAll();  // a fresh run zeroes elapsed
    lastElapsed = e;
  }

  // ---- main driver (playing only) --------------------------------------
  CBZ.onUpdate(64, function (dt) {
    if (CBZ.game.mode !== "escape") return;   // jail-only — the riot squad never calls into the city
    maybeReset();

    if (spawnCd > 0) spawnCd -= dt;
    if (reprimeCd > 0) reprimeCd -= dt;

    const heat = g.detection || 0;
    const live = countLive();             // also prunes dead/removed refs

    // ---- decay arrival-grace timers ----
    if (live) {
      for (let i = 0; i < mine.length; i++) {
        const gd = mine[i];
        if (gd && gd._enterT > 0) gd._enterT -= dt;
      }
    }

    // ---- HIGH HEAT: build the call timer, then send waves ----
    if (heat >= HEAT_CALL) {
      standT = 0;                          // any high reading cancels stand-down
      callT += dt;
      if (callT >= CALL_HOLD) {
        // try to add one more responder when off cooldown and under cap
        if (spawnCd <= 0 && live < MAX_REINF &&
            (!CBZ.guards || CBZ.guards.length < MAX_GUARDS)) {
          if (spawnOne()) {
            spawnCd = SPAWN_CD;
            if (!announced) {
              announced = true;
              if (CBZ.flashToast) { try { CBZ.flashToast("REINFORCEMENTS!"); } catch (e) {} }
              if (CBZ.flashHint) { try { CBZ.flashHint("🚨 The towers called it in — riot squad incoming!", 2.4); } catch (e) {} }
            }
          }
        }
      }
    } else {
      // heat dipped below the call threshold: stop building toward new waves
      callT = 0;
    }

    // ---- keep the squad on the hunt while heat is still elevated ----
    // detection.js only re-primes guards it can see; our responders should
    // doggedly converge even around corners, so we top up their hunt timer
    // on a cheap cooldown as long as the situation is still hot.
    if (live && heat >= HEAT_STAND && reprimeCd <= 0) {
      reprimeCd = REPRIME_CD;
      for (let i = 0; i < mine.length; i++) {
        const gd = mine[i];
        if (!gd || gd.dead || gd.ko > 0) continue;
        if (gd.hunt <= HUNT_SECS * 0.4) gd.hunt = HUNT_SECS; // refresh before it lapses
      }
    }

    // ---- LOW HEAT: build the stand-down timer, then recall everyone ----
    if (live) {
      if (heat <= HEAT_STAND) {
        standT += dt;
        if (standT >= STAND_HOLD) {
          recallAll();
          if (CBZ.flashHint) { try { CBZ.flashHint("The riot squad stands down.", 2.0); } catch (e) {} }
        }
      } else {
        standT = 0;                        // still warm — hold the line
      }
    } else {
      // nobody fielded: nothing to recall, and let the surge announce again
      standT = 0; announced = false;
    }
  });

  // ---- safety net: if we ever leave 'playing' without a reset (e.g. a win
  // screen), make sure our extras don't linger into the next session. We use
  // an always-runner because onUpdate only fires while playing. ----
  let lastState = g.state;
  CBZ.onAlways(91, function () {
    const s = g.state;
    if (s !== lastState) {
      // on WIN or back to TITLE, clear our reinforcements (a fresh run will
      // resetGame() anyway, but this keeps the scene clean on the win screen)
      if (s === "won" || s === "title") recallAll();
      lastState = s;
    }
  });

  // tiny read-only hook for debugging / other systems
  CBZ.reinforcements = {
    get count() { return mine.length; },
    get capacity() { return MAX_REINF; },
  };
})();
