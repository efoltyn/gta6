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
   detection.js (heat math) and capture.js (the chase/grab).
   Everything is torn down the instant a new run starts (we watch
   CBZ.game.elapsed fall).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || typeof CBZ.onUpdate !== "function") return;

  const g = CBZ.game;
  if (!g) return;

  /* ============================================================
     THE TOWERS SHOUTED TWICE, AND KEPT SHOUTING.

     Measured (seed 90210, mode escape, heat pinned at 100, rAF frozen and the
     sim stepped by hand): at t=1.6 s this file fired BOTH popups on the SAME
     TICK — `flashToast("REINFORCEMENTS!")` landing at y 174-233 of a 608 px
     viewport and `flashHint("The towers called it in — riot squad incoming!")`
     at y 372-412. Two mid-screen cards, stacked down the middle of the screen,
     saying one thing twice. Then it did it AGAIN at t=4.82, with nothing
     killed and nothing changed, and again after every squad wipe: 7 pairs =
     14 popups in a 70 s manhunt, for a squad that never numbered more than 3.

     THREE FAULTS, and the third is the one that made it repeat:

     · NEITHER LINE WENT THROUGH THE GATE. systems/capture.js publishes
       `CBZ.jailTell` — "THE ONE GATE, shared with every other file in the
       prison's territory" — and lockdown · killstreaks · detection · gunroom ·
       games/jail all adopted it in one line each. This file was missed, so it
       kept writing raw `CBZ.flashToast`/`CBZ.flashHint`. Worse, capture.js's
       ratchet counts RAW EMITTERS off `CBZ._jailShowRaw`, which a file has to
       DECLARE — so `CBZ.jailShowAudit()` reported `toasts: 0` while this file
       was slamming one over the crosshair. The ratchet was not wrong; it was
       blind, exactly as capture.js:875 warns. Adopted here, so it is neither.

     · `announced` WAS CLEARED BY A STALE READ. `live` is computed at the top
       of the tick, BEFORE the spawn block; the `if (live)` at the bottom then
       used that stale 0 on the very tick the first responder arrived, undoing
       the `announced = true` set eight lines earlier. Hence the second shout
       exactly SPAWN_CD (3.2 s) later, every single surge.

     · A WIPE IS NOT A NEW CALL. Clearing `announced` whenever the roster hit
       zero meant killing the squad re-ran the whole announcement while the
       towers were still on the radio from the first time. `recallAll()` — the
       one place a surge actually ENDS (stand-down, new run, state exit) — is
       now the only thing that clears it, which is what line 63's "one-shot per
       surge" comment always claimed and never did.

     WHAT SAYS IT INSTEAD. Nothing that carried state is lost: detection.js's
     meter is already pinned red at `HUNTED!` for the whole surge (a bounded
     readout, not a popup), and the event itself is three officers sprinting at
     you from the tower corners with `hunt` primed. The line gets a MOUTH the
     way entities/ai.js's narration sink demands — the officer who just came
     down the stairs says it through `CBZ.prisonSay`, which is ranged (16 m),
     ranked and refuses for the downed. Out of earshot it says nothing at all,
     because a man 40 m away shouting into your ear was the bug.
     ============================================================ */
  // THE ONE GATE (systems/capture.js), degrade-safe in the exact shape
  // lockdown.js:44 / killstreaks.js:11 / detection.js:17 already use: both
  // return TRUE when the line was SUPPRESSED, so a caller with a diegetic
  // replacement can run it, and `JAIL_SHOW_DONT_TELL=false` still restores the
  // popups byte for byte.
  function tellToast(m) { if (CBZ.jailTell) return CBZ.jailTell.toast(m); if (CBZ.flashToast) try { CBZ.flashToast(m); } catch (e) {} return false; }
  function tellHint(m, s) { if (CBZ.jailTell) return CBZ.jailTell.hint(m, s); if (CBZ.flashHint) try { CBZ.flashHint(m, s); } catch (e) {} return false; }
  // systems/interact.js loads AFTER this file, so prisonSay is resolved at CALL
  // time, never captured at boot. No actor, or an actor out of earshot -> false
  // and we are silent, which is the honest answer.
  function sayIt(actor, line, secs) {
    if (!actor || typeof CBZ.prisonSay !== "function") return false;
    try {
      return CBZ.prisonSay(actor, line, {
        rank: CBZ.PRISON_SAY ? CBZ.PRISON_SAY.act : 1,
        secs: secs || 2.0,
      });
    } catch (e) { return false; }
  }

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
  let announced = false;     // one-shot "reinforcements!" toast per surge
  // run-reset detection shares CBZ.jailBoost's elapsed watcher (same 0.5
  // epsilon this module always used)
  const pollNewRun = CBZ.jailBoost ? CBZ.jailBoost.newRunWatcher() : null;

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
    // release any boost-ledger entries other jail systems hold on this guard
    // (harmless field restore on a rig we're about to free; without it the
    // shared ledger would retain the disposed guard until the next restoreAll)
    if (CBZ.jailBoost) {
      CBZ.jailBoost.restore("difficulty", gd);
      CBZ.jailBoost.restore("lockdown", gd);
    }
    // detach + free the whole rig (recursively walk the group)
    if (gd.group) {
      if (gd.group.parent) gd.group.parent.remove(gd.group);
      else if (CBZ.scene) CBZ.scene.remove(gd.group);
      if (gd.group.traverse) {
        try { gd.group.traverse(disposeMesh); } catch (e) {}
      }
    }
    if (gd.wedge) disposeMesh(gd.wedge);
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
  // Returns the OFFICER (falsy on refusal, so `if (spawnOne())` is unchanged).
  // The caller needs him: an announcement has to come out of a mouth, and the
  // man who just came down the tower stairs is the one with it.
  function spawnOne() {
    if (typeof CBZ.spawnGuard !== "function") return null;
    // respect both our own cap and the overall roster ceiling
    if (countLive() >= MAX_REINF) return null;
    if (CBZ.guards && CBZ.guards.length >= MAX_GUARDS) return null;

    const slot = SPAWNS[nextSlot % SPAWNS.length];
    nextSlot++;

    let gd = null;
    try {
      // CBZ.spawnGuard(waypoints, speed, viewDist, half, opts) — auto-pushed
      // onto CBZ.guards and added to the scene by entities/guards.js.
      gd = CBZ.spawnGuard(slot.route.map((p) => [p[0], p[1]]),
                          REINF_SPEED, REINF_VIEW, REINF_HALF, {});
    } catch (e) { gd = null; }
    if (!gd || !gd.group) return null;

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
    if (CBZ.shake) { try { CBZ.shake(0.35); } catch (e) {} }
    return gd;
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
    if (pollNewRun && pollNewRun()) recallAll();  // a fresh run zeroes elapsed
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
          const officer = spawnOne();
          if (officer) {
            spawnCd = SPAWN_CD;
            if (!announced) {
              announced = true;
              tellToast("REINFORCEMENTS!");
              // suppressed -> the man who just arrived says it himself, in
              // earshot or not at all
              if (tellHint("The towers called it in — riot squad incoming!", 2.4)) {
                sayIt(officer, "Riot squad on the yard — get down!", 2.0);
              }
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
    // `live` was read BEFORE the spawn block above, so it is stale on exactly
    // the tick a wave arrives — using it here is what cleared `announced` on
    // the same tick it was set and re-shouted the pair 3.2 s later. Re-read it:
    // `mine` is capped at 3, so the second count is free.
    const held = countLive();
    if (held) {
      if (heat <= HEAT_STAND) {
        standT += dt;
        if (standT >= STAND_HOLD) {
          // SPEAK FIRST, THEN RECALL. recallAll() flags every man dead and
          // frees his rig, and prisonSay refuses the dead — saying it after
          // the recall is a line that can never be delivered.
          const speaker = mine[0];
          if (tellHint("The riot squad stands down.", 2.0)) {
            sayIt(speaker, "Stand down. Back to your posts.", 2.0);
          }
          recallAll();
        }
      } else {
        standT = 0;                        // still warm — hold the line
      }
    } else {
      // Nobody fielded: nothing to recall. `announced` is deliberately NOT
      // cleared here. A surge ends at STAND-DOWN (or a new run / a state exit),
      // and recallAll() is the one place all three meet — so it owns the reset.
      // Clearing on an empty roster meant wiping the squad re-ran the entire
      // announcement while the towers were still on the radio from the first
      // time: measured at 4 extra double-popups across 4 wipes.
      standT = 0;
    }
  });

  // ---- safety net: if we ever leave 'playing' without a reset (e.g. a win
  // screen), make sure our extras don't linger into the next session. Rides
  // CBZ.jailBoost's shared state-exit dispatcher (onUpdate only fires while
  // playing): on WIN or back to TITLE, clear our reinforcements — a fresh
  // run will resetGame() anyway, but this keeps the win screen's scene clean.
  if (CBZ.jailBoost) CBZ.jailBoost.onStateExit(function () { recallAll(); }, ["won", "title"]);

  // tiny read-only hook for debugging / other systems
  CBZ.reinforcements = {
    get count() { return mine.length; },
    get capacity() { return MAX_REINF; },
  };
})();
