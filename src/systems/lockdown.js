/* ============================================================
   systems/lockdown.js — FACILITY LOCKDOWN.

   When HEAT (game.detection) maxes out (~100) the whole block goes
   into a one-shot, debounced LOCKDOWN:
     • "LOCKDOWN" toast + a hard red flash + screen shake
     • a looping siren (CBZ.sfx("alarm") re-fired every ~1.2s)
     • a pulsing red full-screen vignette overlay (one fixed DIV,
       created once, only its opacity is animated — cheap on phones)
     • EVERY able guard is forced to hunt the player and gets a
       temporary speed boost (originals saved + restored on lift)
     • the yard door is slammed shut (CBZ.closeDoor)

   It LIFTS only once the player has stayed UNSEEN (witnessGuard()
   null) AND heat has cooled below ~25 for ~6 CONTINUOUS seconds —
   any glimpse or heat spike resets that timer. On lift the siren
   stops, the overlay fades out, guard speeds restore, and the door
   re-opens *only if the player actually holds the keycard*.

   Tense but always escapable: drop out of sight, let it cool.

   State is fully torn down on a new run (watching game.elapsed drop /
   leaving the playing state) so a fresh prison never starts sealed.

   --- review notes -------------------------------------------------
   Guards move on gd.speed in entities/guards.js (both patrol and
   hunt), so multiplying gd.speed is the right lever. The risk is
   entities/ai.js, whose actors() lazily snapshots gd.baseSpeed =
   gd.speed the first time a guard joins combat — and state.js's
   resetGame() calls aiReset() synchronously (it sets guard.hp=null,
   which re-arms that snapshot). If a lockdown were still live when a
   run reset, a BOOSTED gd.speed could get baked into baseSpeed and
   make guards permanently fast. To kill that window we detect the
   reset (elapsed dropping / leaving play) in BOTH ticks and restore
   guard speeds eagerly, never trusting a single deferred frame. We
   only ever touch guards we ourselves boosted (tagged _lockBoosted),
   never the rest of the roster.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || typeof CBZ.onUpdate !== "function" || typeof CBZ.onAlways !== "function") return;
  const g = CBZ.game;
  if (!g) return;

  // ---- tunables ----
  const TRIGGER_HEAT = 99;     // detection at/above this arms the lockdown
  const COOL_HEAT    = 25;     // heat must fall below this to start cooling
  const CLEAR_SECS   = 6.0;    // continuous unseen+cool seconds needed to lift
  const SIREN_EVERY  = 1.2;    // seconds between siren re-fires
  const HUNT_TOPUP   = 2.5;    // hunt seconds we keep refreshing on each guard
  const SPEED_BOOST  = 1.25;   // multiplier applied to guard.speed during lockdown
  const GRACE        = 1.5;    // min seconds a lockdown stays up before it can lift

  // ---- module state ----
  let active = false;          // is a lockdown currently running?
  let sirenT = 0;              // countdown to next siren blast
  let clearT = 0;              // accumulated continuous "clear" seconds
  let elapsedT = 0;            // seconds this lockdown has been live (for GRACE)
  let pulse = 0;              // 0..1 vignette intensity envelope (eased)
  let fading = false;          // overlay is fading out after a lift
  let lastElapsed = 0;         // to detect new-run resets (elapsed drops to ~0)
  const boosted = [];          // [{guard, base}] so we can restore exactly

  // ---- the overlay DIV (built lazily, once) ----
  let overlay = null;
  function ensureOverlay() {
    if (overlay || typeof document === "undefined") return overlay;
    const d = document.createElement("div");
    d.id = "lockdownOverlay";
    // sit above the heat vignette but below the menu screens (z-index 30),
    // so title/pause/win never get washed red. never eat clicks.
    const s = d.style;
    s.position = "fixed";
    s.left = s.top = s.right = s.bottom = "0";
    s.pointerEvents = "none";
    s.zIndex = "25";
    s.opacity = "0";
    // a strong inset red ring + a faint full-screen red wash
    s.boxShadow = "inset 0 0 240px 70px rgba(220,20,32,0.95)";
    s.background = "radial-gradient(circle at 50% 50%, rgba(255,30,40,0) 38%, rgba(190,12,22,0.55) 100%)";
    s.willChange = "opacity";
    // attach to body; tolerate a not-yet-ready DOM defensively
    if (document.body) document.body.appendChild(d);
    else if (document.documentElement) document.documentElement.appendChild(d);
    overlay = d;
    return overlay;
  }

  // ---- guard helpers ----
  function able(gd) {
    return gd && !gd.dead && !(gd.ko > 0) && !gd.corrupt;
  }

  // give every able guard the hunt + speed boost; called on trigger and
  // refreshed each frame so guards that spawn / wake mid-lockdown join in.
  function whipGuards() {
    if (!CBZ.guards) return;
    for (const gd of CBZ.guards) {
      if (!able(gd)) continue;
      // keep them locked onto the player
      if (!(gd.hunt > HUNT_TOPUP)) gd.hunt = HUNT_TOPUP;
      gd.alert = Math.max(gd.alert || 0, 1.0);
      // apply the boost once per guard; remember its real base speed
      if (!gd._lockBoosted && typeof gd.speed === "number") {
        gd._lockBoosted = true;
        const base = gd.speed;
        gd.speed = base * SPEED_BOOST;
        boosted.push({ guard: gd, base: base });
      }
    }
  }

  function restoreGuards() {
    for (const b of boosted) {
      const gd = b.guard;
      if (gd && gd._lockBoosted) {
        // restore the real base speed (so ai.js can never snapshot a
        // boosted value as baseSpeed after a reset / combat join)
        if (typeof gd.speed === "number") gd.speed = b.base;
        gd._lockBoosted = false;
      }
    }
    boosted.length = 0;
    // also clear the flag on any guard we might have missed (e.g. spawned
    // and despawned by reinforcements while we held it). Best-effort: we
    // no longer hold their base, so just clear the flag.
    if (CBZ.guards) for (const gd of CBZ.guards) if (gd && gd._lockBoosted) gd._lockBoosted = false;
  }

  // ---- begin / end ----
  function begin() {
    if (active) return;
    active = true;
    fading = false;
    sirenT = 0;          // blare immediately
    clearT = 0;
    elapsedT = 0;
    pulse = 0;

    ensureOverlay();

    if (CBZ.flashToast) try { CBZ.flashToast("LOCKDOWN"); } catch (e) {}
    if (CBZ.shake) try { CBZ.shake(0.7); } catch (e) {}
    // hard red flash via the shared #flash overlay, if present
    try {
      const fl = CBZ.el && CBZ.el.flash;
      if (fl) { fl.classList.remove("go"); void fl.offsetWidth; fl.classList.add("go"); }
    } catch (e) {}
    if (CBZ.setObjective) try { CBZ.setObjective("LOCKDOWN — get out of sight and lay low to lift it."); } catch (e) {}
    // a BRIEF real siren burst as the block seals — then the guards take over
    // (whipped up to beat/bed inmates). No annoying sustained loop.
    if (CBZ.sfx) try { CBZ.sfx("lockdown"); } catch (e) {}

    whipGuards();
    if (CBZ.closeDoor) try { CBZ.closeDoor(); } catch (e) {}
  }

  function end() {
    if (!active) return;
    active = false;
    fading = true;       // overlay eases out in the always-tick
    restoreGuards();

    if (CBZ.flashToast) try { CBZ.flashToast("ALL CLEAR"); } catch (e) {}
    if (CBZ.setObjective) try { CBZ.setObjective("The block calms down. Keep your head low."); } catch (e) {}

    // re-open the yard door ONLY if the player actually has the keycard
    if (g && g.hasKey && CBZ.openDoor) {
      try { CBZ.openDoor(); } catch (e) {}
      if (CBZ.flashHint) try { CBZ.flashHint("🔑 Your keycard pops the gate back open.", 2.0); } catch (e) {}
    }
  }

  // fully reset everything (new run / leaving play). Hard-clears the overlay
  // (no fade) and restores guard speeds immediately.
  function teardown() {
    if (boosted.length) restoreGuards();
    active = false;
    fading = false;
    sirenT = 0; clearT = 0; elapsedT = 0; pulse = 0;
    if (overlay) overlay.style.opacity = "0";
  }

  // watch for a new run: elapsed resets to ~0 in state.js resetGame().
  // Returns true if a reset was just detected (and torn down).
  function checkReset() {
    const el = g.elapsed || 0;
    let reset = false;
    if (el + 0.001 < lastElapsed) { teardown(); reset = true; }
    lastElapsed = el;
    return reset;
  }

  // ---- the live driver: only while playing ----
  CBZ.onUpdate(72, function (dt) {
    if (CBZ.game.mode !== "escape") return;   // jail-only — never in city/disaster (was leaking guard spam into the city)
    // a fresh run is detected here too (this tick runs first while playing),
    // so any boosted gd.speed is restored before combat.js can snapshot it.
    if (checkReset()) return;

    // clamp dt so a tab-stall can't fire dozens of sirens at once
    const d = dt > 0.1 ? 0.1 : (dt > 0 ? dt : 0);

    if (!active) {
      // arm the lockdown when heat tops out
      if (typeof g.detection === "number" && g.detection >= TRIGGER_HEAT) begin();
      return;
    }

    elapsedT += d;

    // keep guards whipped up (covers spawns / guards that stood back up)
    whipGuards();

    // (siren is now a continuous diegetic loop started in begin() — no retrigger)

    // ---- lift condition: unseen AND cool for CLEAR_SECS continuous ----
    let seen = false;
    if (CBZ.witnessGuard) { try { seen = !!CBZ.witnessGuard(); } catch (e) { seen = false; } }
    const cool = typeof g.detection === "number" ? g.detection < COOL_HEAT : true;

    if (!seen && cool && elapsedT >= GRACE) {
      clearT += d;
      if (clearT >= CLEAR_SECS) { end(); return; }
    } else {
      // any sight or heat spike resets the cooldown
      clearT = 0;
    }
  });

  // ---- overlay animation: runs ALWAYS so it can fade out on menus too ----
  CBZ.onAlways(73, function (dt) {
    const d = dt > 0.1 ? 0.1 : (dt > 0 ? dt : 0);

    // detect a new run / leaving play and tear down so we never start sealed
    checkReset();

    if (g.state !== "playing") {
      // never wash the title / pause / win screens red. Restore eagerly so a
      // lockdown that was live when the player paused/won/quit can't leave
      // guards boosted or strand the siren mid-loop.
      if (active || boosted.length) teardown();
      else if (overlay && overlay.style.opacity !== "0") { overlay.style.opacity = "0"; pulse = 0; fading = false; }
      return;
    }

    if (!overlay) {
      if (active || fading) ensureOverlay();
      if (!overlay) return;
    }

    if (active) {
      // ease pulse up toward 1, then strobe it for that emergency throb
      pulse += (1 - pulse) * Math.min(1, 6 * d);
      const strobe = 0.62 + 0.38 * (0.5 + 0.5 * Math.sin((CBZ.now || 0) * 0.011));
      overlay.style.opacity = (pulse * strobe).toFixed(3);
    } else if (fading) {
      // smooth fade-out after a lift
      pulse += (0 - pulse) * Math.min(1, 3 * d);
      overlay.style.opacity = pulse.toFixed(3);
      if (pulse < 0.01) { pulse = 0; fading = false; overlay.style.opacity = "0"; }
    }
  });
})();
