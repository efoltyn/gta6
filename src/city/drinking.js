/* ============================================================
   city/drinking.js — DRUNKENNESS: bars sell more than a heal now.

   CBZ.cityDrink(units) tips a running "drunk level" (0 sober .. MAX
   blackout-drunk); the level DECAYS on its own (you sober up over a
   few minutes) and, while it's up, the city itself gets loose under
   you:
     • the screen softens — a CSS blur+saturate filter straight on
       the WebGL canvas element (there's no post-processing pipeline
       to hook into, so the canvas IS the filter target — the brief's
       own suggested approach);
     • the view sways — a small BOUNDED yaw/pitch wobble added on TOP
       of your real look direction each frame and subtracted back off
       the next, so it never accumulates and never fights mouse-look;
     • your own feet drift sideways as you walk, and past a threshold
       you throw in occasional bigger lurches + a screen shake;
     • way over the line, the room spins and you BLACK OUT — fade to
       black, held in place (piggybacks the existing player.stun
       "no input this frame, gravity still applies" contract physics.js
       already honors — no new freeze flag needed), then you come to
       at the same spot, stone-cold sober, with a headache.

   API (other systems read/call this — keep the names + shape stable):
     CBZ.cityDrink(units)  — tip the level up by `units` (~1 unit per
                              drink). Safe to call from anywhere (the
                              origin-intro script may fire before the
                              player is officially "in city"); it just
                              banks the level, the VISUALS below are
                              what's city-mode-gated.
     CBZ.cityDrunk         — { level, blackout } state. level 0 = sober.
                              Read-only by convention — only this file
                              writes it.

   SAFETY: one onUpdate hook, two of OUR OWN overlay divs (this never
   touches #vignette — city/death.js's hitFlash already drives that
   element and fighting it over box-shadow was exactly the trap the
   brief warned about), and a guarded canvas CSS filter. Every branch
   bails the instant we're not in city mode (or the player is dead),
   clearing every visual so nothing can be left smeared on the screen
   across a mode switch or a respawn. Every external read is guarded
   (CBZ.x && CBZ.x()) so a missing canvas/camera/player/city object
   can never throw.

   NOT wired here (by design, per the brief): sleeping off drunkenness
   in your own bed. realestate.js's sleepHeal() is a local closure,
   never exported as CBZ.citySleepHeal — there's no clean seam to wrap
   without editing that file (off-limits), so we skip that nicety.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  // ---- tuning ---------------------------------------------------------
  const MAX_LEVEL            = 8;      // hard cap — more drinks past here do nothing
  const DECAY_PER_SEC        = 0.02;   // sober ~1 level per 50s; level 5 ≈ 4-4.5 min
  const BLACKOUT_LEVEL       = 5;      // level at which you go down
  const LURCH_LEVEL          = 5;      // level at which occasional big lurches kick in
  const BLUR_PER_LEVEL       = 1.15;   // px of canvas blur per level (max ≈ 9.2px)
  const SAT_PER_LEVEL        = 0.055;  // saturation lost per level
  const SAT_FLOOR            = 0.55;   // never desaturate past this
  const YAW_AMP_PER_LEVEL    = 0.0065; // rad of bounded camera-yaw sway per level
  const PITCH_AMP_PER_LEVEL  = 0.0038; // rad of bounded camera-pitch sway per level
  const DRIFT_PER_LEVEL      = 0.16;   // m/s of lateral stumble drift per level
  const FADE_OUT_DUR         = 2.0;    // blackout: fade to black
  const BLACK_HOLD_MIN       = 4, BLACK_HOLD_MAX = 6;   // seconds held fully black
  const FADE_IN_DUR          = 1.1;    // wake: fade back from black

  // ---- state ------------------------------------------------------------
  const state = { level: 0, blackout: false };
  CBZ.cityDrunk = state;

  CBZ.cityDrink = function (units) {
    const u = (typeof units === "number" && isFinite(units) && units > 0) ? units : 1;
    state.level = Math.min(MAX_LEVEL, state.level + u);
    if (g.mode === "city" && CBZ.cityHudDirty) CBZ.cityHudDirty();
    return state.level;
  };

  // ---- DOM: two overlays of our own, built lazily on first real use -----
  let blackEl = null, vigEl = null;
  function ensureEls() {
    if (blackEl) return;
    blackEl = document.createElement("div");
    blackEl.id = "drinkBlackout";
    blackEl.style.cssText = "position:fixed;inset:0;z-index:58;background:#000;opacity:0;pointer-events:none;";
    document.body.appendChild(blackEl);
    vigEl = document.createElement("div");
    vigEl.id = "drinkVignette";
    vigEl.style.cssText = "position:fixed;inset:0;z-index:40;pointer-events:none;box-shadow:inset 0 0 0 0 rgba(120,40,10,0);";
    document.body.appendChild(vigEl);
  }

  // ---- canvas blur/saturate — throttled: only touch style.filter when the
  //      ROUNDED value actually changed, so a stone-sober frame (or a frame
  //      where the level barely ticked) never forces a style write. --------
  let lastFilterKey = "";
  function applyCanvasFilter(level) {
    const canvas = CBZ.canvas;
    if (!canvas) return;
    if (level <= 0.02) {
      if (lastFilterKey !== "") { canvas.style.filter = ""; lastFilterKey = ""; }
      return;
    }
    const blur = Math.round(Math.min(MAX_LEVEL, level) * BLUR_PER_LEVEL * 10) / 10;
    const sat = Math.max(SAT_FLOOR, 1 - level * SAT_PER_LEVEL);
    const key = blur + "|" + sat.toFixed(2);
    if (key === lastFilterKey) return;
    lastFilterKey = key;
    canvas.style.filter = "blur(" + blur + "px) saturate(" + sat.toFixed(2) + ")";
  }
  function clearCanvasFilter() {
    if (lastFilterKey !== "") { if (CBZ.canvas) CBZ.canvas.style.filter = ""; lastFilterKey = ""; }
  }

  // ---- camera sway: a BOUNDED delta added on top of the real look each
  //      frame, then subtracted back off before the next delta is applied —
  //      so it can never accumulate/drift the aim and never fights the real
  //      mouse-look write in systems/camera.js's mousemove handler. --------
  let yawWob = 0, pitchWob = 0;
  function applySway(level, t) {
    const cam = CBZ.cam;
    if (!cam) return;
    const amp = Math.min(level, MAX_LEVEL);
    const yawTarget = Math.sin(t * 1.3) * YAW_AMP_PER_LEVEL * amp;
    const pitchTarget = Math.sin(t * 0.9 + 1.7) * PITCH_AMP_PER_LEVEL * amp;
    cam.yaw += (yawTarget - yawWob);
    cam.pitch += (pitchTarget - pitchWob);
    cam.pitch = Math.max(-1.45, Math.min(1.45, cam.pitch));   // same hard safety camera.js uses
    yawWob = yawTarget; pitchWob = pitchTarget;
  }
  function clearSway() {
    const cam = CBZ.cam;
    if (cam && (yawWob || pitchWob)) { cam.yaw -= yawWob; cam.pitch -= pitchWob; }
    yawWob = 0; pitchWob = 0;
  }

  // ---- stumble: a small lateral drift nudged straight into the player's
  //      own pos (physics.js already ran this frame at onUpdate(10), so this
  //      rides on top of it), perpendicular to the current look direction —
  //      plus, past LURCH_LEVEL, an occasional bigger one-off lurch + shake. -
  let lurchT = 0, lurchVX = 0, lurchVZ = 0;
  function applyStumble(level, dt, t) {
    const P = CBZ.player, cam = CBZ.cam;
    if (!P || !P.pos || P.driving || P.dead) return;
    const yaw = cam ? cam.yaw : 0;
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);      // "right" vector (matches physics.js's own rx/rz)
    const sway = Math.sin(t * 0.7) * DRIFT_PER_LEVEL * level;
    P.pos.x += rx * sway * dt;
    P.pos.z += rz * sway * dt;
    // big lurches are a short DECAYING VELOCITY, not an instant jump — an
    // instant 0.5-1.2m pos write can cross a whole wall in one frame (this
    // runs AFTER physics has already resolved the frame), i.e. tunneling.
    // A burst integrated per-frame keeps every step small, and the collide()
    // below (the same resolver physics.js exports) settles each step against
    // the real world colliders immediately.
    if (level >= LURCH_LEVEL) {
      lurchT -= dt;
      if (lurchT <= 0) {
        lurchT = 3 + Math.random() * 4;
        const dir = Math.random() * Math.PI * 2, mag = 2.2 + Math.random() * 2.0;   // m/s burst ≈ 0.35-0.7m total
        lurchVX = Math.cos(dir) * mag; lurchVZ = Math.sin(dir) * mag;
        if (CBZ.shake) CBZ.shake(0.3);
      }
    } else { lurchT = 0; lurchVX = lurchVZ = 0; }
    if (lurchVX || lurchVZ) {
      P.pos.x += lurchVX * dt; P.pos.z += lurchVZ * dt;
      const dec = Math.pow(0.002, dt); lurchVX *= dec; lurchVZ *= dec;
      if (Math.abs(lurchVX) < 0.05 && Math.abs(lurchVZ) < 0.05) lurchVX = lurchVZ = 0;
    }
    // never end a drunk frame inside a wall — with the player's real standing
    // band, so collide()'s height gate ignores floors above/below (same
    // feetY/headY contract physics.js's own resolver passes).
    if (CBZ.collide) CBZ.collide(P.pos, 0.5, P.pos.y + 0.1, P.pos.y + 1.8);
  }

  // ---- soft vignette pulse on OUR OWN div (never #vignette) --------------
  let vigActive = false;
  function applyVignette(level, t) {
    if (level <= 0.05) { clearVignette(); return; }
    ensureEls();
    vigActive = true;
    const breathe = 0.5 + 0.5 * Math.sin(t * 1.1);
    const spread = 30 + level * 10 + breathe * 14 * Math.min(level, 4);
    const alpha = Math.min(0.28, 0.03 + level * 0.028 + breathe * 0.03);
    vigEl.style.boxShadow = "inset 0 0 " + spread.toFixed(0) + "px " + (10 + level * 3).toFixed(0) + "px rgba(120,40,10," + alpha.toFixed(2) + ")";
  }
  function clearVignette() {
    if (vigActive && vigEl) vigEl.style.boxShadow = "inset 0 0 0 0 rgba(120,40,10,0)";
    vigActive = false;
  }

  // ---- blackout state machine: awake -> fadeout -> black -> fadein -------
  let phase = "awake", phaseT = 0, warnedTipsy = false, warnedDrunk = false;
  function beginBlackout() {
    ensureEls();
    phase = "fadeout"; phaseT = FADE_OUT_DUR; state.blackout = true;
    if (CBZ.city && CBZ.city.note) CBZ.city.note("The room's spinning...", 1.8);
  }
  function stepBlackout(dt) {
    ensureEls();
    const P = CBZ.player;
    if (P) P.stun = Math.max(P.stun || 0, 0.5);   // re-asserted every tick so physics.js never lets go early
    if (phase === "fadeout") {
      phaseT -= dt;
      const t = 1 - Math.max(0, phaseT) / FADE_OUT_DUR;
      blackEl.style.opacity = String(Math.min(1, t));
      if (phaseT <= 0) { phase = "black"; phaseT = BLACK_HOLD_MIN + Math.random() * (BLACK_HOLD_MAX - BLACK_HOLD_MIN); blackEl.style.opacity = "1"; }
    } else if (phase === "black") {
      phaseT -= dt;
      if (phaseT <= 0) {
        // WAKE: same spot (we never moved you while frozen), stone sober,
        // every effect cleared.
        state.level = 0; state.blackout = false;
        warnedTipsy = false; warnedDrunk = false;
        if (P) P.stun = 0;
        phase = "fadein"; phaseT = FADE_IN_DUR;
        if (CBZ.city && CBZ.city.note) CBZ.city.note("You black out... and wake up with a headache.", 3.2);
      }
    } else if (phase === "fadein") {
      phaseT -= dt;
      const t = Math.max(0, phaseT) / FADE_IN_DUR;
      blackEl.style.opacity = String(Math.max(0, t));
      if (phaseT <= 0) { phase = "awake"; blackEl.style.opacity = "0"; }
    }
  }

  function clearAllEffects() {
    clearCanvasFilter();
    clearSway();
    clearVignette();
    if (blackEl) blackEl.style.opacity = "0";
  }

  // ---- master per-frame update --------------------------------------------
  CBZ.onUpdate(34, function (dt) {
    const P = CBZ.player;
    const inCity = g.mode === "city";
    // out of city: nothing should be left smeared on screen. A stray
    // mid-blackout state (e.g. the player quit to the menu mid-fade) also
    // can't be left hanging — snap back to awake so re-entering city never
    // resumes a stale fade.
    if (!inCity) {
      clearAllEffects();
      if (phase !== "awake") { phase = "awake"; state.blackout = false; }
      return;
    }

    // death sobers you up on the spot — a fresh respawn shouldn't inherit a
    // blur/wobble/blackout from the life that just ended.
    if (P && P.dead) {
      if (state.level !== 0 || phase !== "awake") {
        state.level = 0; phase = "awake"; state.blackout = false; warnedTipsy = false; warnedDrunk = false;
      }
      clearAllEffects();
      return;
    }

    // decay: real time sobers you up, but not while the blackout sequence
    // itself is running (that phase owns the level and clears it on wake).
    if (state.level > 0 && phase === "awake") state.level = Math.max(0, state.level - DECAY_PER_SEC * dt);

    const t = (CBZ.now || 0) / 1000;

    if (phase !== "awake") {
      stepBlackout(dt);
      // keep the visuals live under the fade so the last frames before
      // black still read as drunk, not an abrupt cut
      applyCanvasFilter(state.level);
      applySway(state.level, t);
      applyVignette(state.level, t);
      return;
    }

    // blacking out is DEFERRED while driving — a black screen with the car
    // still rolling (stun only zeroes on-foot input; city/vehicles.js owns
    // the wheel) is a crash you never saw. The level holds past the
    // threshold and the collapse lands the moment both feet hit pavement.
    if (state.level >= BLACKOUT_LEVEL && !(P && P.driving)) { beginBlackout(); return; }

    applyCanvasFilter(state.level);
    applySway(state.level, t);
    applyStumble(state.level, dt, t);
    applyVignette(state.level, t);

    // quiet one-shot flavor notes on the way up — no persistent HUD edit
    if (state.level >= 0.5 && !warnedTipsy) { warnedTipsy = true; if (CBZ.city && CBZ.city.note) CBZ.city.note("Feeling that.", 1.6); }
    else if (state.level < 0.4) warnedTipsy = false;
    if (state.level >= 3 && !warnedDrunk) { warnedDrunk = true; if (CBZ.city && CBZ.city.note) CBZ.city.note("Properly drunk now — footing's going.", 2); }
    else if (state.level < 2.5) warnedDrunk = false;
  });
})();
