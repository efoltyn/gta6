/* ============================================================
   systems/gamepad.js — XBOX CONTROLLER SUPPORT (GTA V / RDR2 scheme).

   Plug an Xbox pad into the laptop and play the whole game on the stick,
   with the exact muscle-memory layout Rockstar players already have:

     ON FOOT                         DRIVING
     • Left stick   move             • Left stick   steer
     • Right stick  look             • Right stick  look (drive-by aim)
     • LT (hold)    aim / ADS        • RT           accelerate
     • RT           fire             • LT           brake / reverse
     • LB           next weapon      • RB / A       handbrake
     • RB           prev weapon      • Y            get out
     • A            sprint           • Start        pause
     • X            jump
     • B            reload
     • Y            enter/interact
     • D-pad Up     map              • Back         city power (Tab)
     • Start        pause/resume

   It never introduces a new input path: it feeds the SAME `CBZ.keys` map the
   keyboard/touch layers use for movement + hold actions, writes `CBZ.cam` /
   `CBZ.fps.fp` for look exactly like touch.js, and calls the public gameplay
   hooks (fpsFire / fpsSetAim / fpsReload / fpsNextWeapon…) for the rest. It
   only touches keys IT is holding, so a keyboard-and-pad player isn't fought.
   All standard W3C "standard mapping" indices (A0 B1 X2 Y3 LB4 RB5 LT6 RT7
   Back8 Start9 LS10 RS11 D-pad12-15), triggers as analog buttons[6]/[7].
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || typeof navigator === "undefined" || !navigator.getGamepads) return;
  const g = CBZ.game;

  // ---- tuning ----
  const DEAD_MOVE = 0.22;    // left-stick dead-zone
  const DEAD_LOOK = 0.16;    // right-stick dead-zone
  const LOOK_YAW = 3.1;      // rad/s at full deflection (hip)
  const LOOK_PITCH = 2.3;
  const AIM_LOOK_MUL = 0.5;  // slow the look down while aiming for precision
  const TRIG_ON = 0.35;      // trigger press threshold
  const INVERT_Y = false;

  // button indices (standard mapping)
  const B = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, LS: 10, RS: 11, DUP: 12, DDOWN: 13, DLEFT: 14, DRIGHT: 15 };

  let padIndex = -1;
  let announced = false;

  addEventListener("gamepadconnected", function (e) {
    if (padIndex < 0) padIndex = e.gamepad.index;
    if (!announced) {
      announced = true;
      const msg = "🎮 Controller connected — GTA-style layout ready.";
      if (CBZ.city && CBZ.city.note && g.mode === "city") CBZ.city.note(msg, 3);
      else if (CBZ.flashHint) CBZ.flashHint(msg, 3);
    }
  });
  addEventListener("gamepaddisconnected", function (e) {
    if (e.gamepad.index === padIndex) { releaseAllKeys(); setAim(false); setFire(false); padIndex = -1; }
  });

  function activePad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    if (!pads) return null;
    if (padIndex >= 0 && pads[padIndex]) return pads[padIndex];
    for (let i = 0; i < pads.length; i++) if (pads[i] && pads[i].connected) { padIndex = i; return pads[i]; }
    return null;
  }

  // trigger value: standard mapping puts triggers on buttons[6]/[7].value (0..1);
  // some backends only expose them on axes[4]/[5] in [-1,1] — read whichever.
  function trigger(pad, btnIdx, axisIdx) {
    const b = pad.buttons[btnIdx];
    let v = b ? (typeof b === "object" ? b.value : b) : 0;
    if ((v == null || v === 0) && pad.axes.length > axisIdx) { const a = pad.axes[axisIdx]; if (a != null && a !== 0) v = (a + 1) / 2; }
    return v || 0;
  }
  function pressed(pad, i) { const b = pad.buttons[i]; return !!(b && (typeof b === "object" ? b.pressed || b.value > 0.5 : b > 0.5)); }
  function axis(pad, i) { const v = pad.axes[i]; return v == null ? 0 : v; }
  function dz(v, d) { return Math.abs(v) < d ? 0 : (v - Math.sign(v) * d) / (1 - d); }   // dead-zone + rescale
  function curve(v) { return Math.sign(v) * v * v; }                                     // fine control near centre

  // ---- key management (only keys the pad is holding) ----
  const held = {};
  function setKey(k, on) {
    if (!CBZ.keys) return;
    if (on) { CBZ.keys[k] = true; held[k] = true; }
    else if (held[k]) { CBZ.keys[k] = false; delete held[k]; }
  }
  function reconcile(want) {
    // release pad-held keys no longer wanted
    for (const k in held) if (!want[k]) setKey(k, false);
    // press newly wanted keys
    for (const k in want) if (want[k]) setKey(k, true);
  }
  function releaseAllKeys() { for (const k in held) { if (CBZ.keys) CBZ.keys[k] = false; delete held[k]; } }

  // ---- edge tracking ----
  const prev = {};
  function edge(pad, i) { const now = pressed(pad, i); const was = !!prev[i]; prev[i] = now; return now && !was; }
  function down(pad, i) { const now = pressed(pad, i); prev[i] = now; return now; }

  // synthetic key TAP for edge-driven world handlers (interact E, map M, Tab…)
  function tapKey(key) {
    try {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: key, bubbles: true }));
      if (CBZ.keys) CBZ.keys[key.toLowerCase()] = true;
      setTimeout(function () {
        try { document.dispatchEvent(new KeyboardEvent("keyup", { key: key, bubbles: true })); } catch (e) {}
        if (CBZ.keys) CBZ.keys[key.toLowerCase()] = false;
      }, 60);
    } catch (e) {}
  }

  // aim / fire are level-driven but only emitted on CHANGE, so a mouse player
  // is never overridden by a resting trigger.
  let prevAim = false, prevFire = false;
  function setAim(on) { if (on !== prevAim) { prevAim = on; if (CBZ.fpsSetAim) CBZ.fpsSetAim(on); } }
  function setFire(on) { if (on !== prevFire) { prevFire = on; if (CBZ.fpsFire) CBZ.fpsFire(on); } }

  // ==========================================================================
  //  per-frame poll — runs in EVERY state (title/playing/paused) for menu nav
  // ==========================================================================
  CBZ.onAlways(2, function (dt) {
    const pad = activePad();
    if (!pad) { if (Object.keys(held).length) releaseAllKeys(); setAim(false); setFire(false); return; }
    dt = Math.min(dt || 0.016, 0.05);

    // ---- menu / flow (works on the title + pause screens) ----
    if (g.state !== "playing") {
      // release any gameplay holds while not playing
      if (Object.keys(held).length) releaseAllKeys();
      setAim(false); setFire(false);
      const startE = edge(pad, B.START), aE = edge(pad, B.A);
      if (g.state === "title") {
        if (startE || aE) { const b = document.getElementById("playBtn"); if (b) b.click(); }
      } else if (g.state === "paused") {
        if (startE || aE) { const b = document.getElementById("resumeBtn"); if (b && b.offsetParent !== null) b.click(); else if (CBZ.setState) CBZ.setState("playing"); }
      } else {
        // win/lose screens — A presses the primary button if present
        if (aE || startE) { const btn = document.querySelector(".screen:not(.hidden) .btn"); if (btn) btn.click(); }
      }
      // keep edge state fresh for other buttons so they don't false-fire on resume
      for (const k in B) edge(pad, B[k]);
      return;
    }

    // menu overlay open (shop/bench/map) → don't drive the world, but let Start pause
    if (CBZ.cityMenuOpen) {
      if (Object.keys(held).length) releaseAllKeys();
      setAim(false); setFire(false);
      if (edge(pad, B.START) && CBZ.setState) CBZ.setState("paused");
      if (edge(pad, B.B) || edge(pad, B.Y)) tapKey("Escape");   // back out of a menu
      for (const k in B) edge(pad, B[k]);
      return;
    }

    // ---- START = pause ----
    if (edge(pad, B.START) && CBZ.setState) { CBZ.setState("paused"); return; }

    const P = CBZ.player;
    const driving = !!(P && P.driving);
    const lx = dz(axis(pad, 0), DEAD_MOVE), ly = dz(axis(pad, 1), DEAD_MOVE);
    let rx = dz(axis(pad, 2), DEAD_LOOK), ry = dz(axis(pad, 3), DEAD_LOOK);
    const lt = trigger(pad, B.LT, 4), rt = trigger(pad, B.RT, 5);

    // ---- LOOK (right stick) → cam yaw/pitch + fps pitch, like touch.js ----
    if (CBZ.cam) {
      const aiming = !!(CBZ.isADS && CBZ.isADS());
      let mul = aiming ? AIM_LOOK_MUL : 1;
      if (aiming && CBZ.cityScopeHigh && CBZ.cityScopeHigh()) mul *= 0.4;   // magnified optic → very fine
      CBZ.cam.yaw -= curve(rx) * LOOK_YAW * mul * dt;
      const dpitch = curve(ry) * LOOK_PITCH * mul * dt * (INVERT_Y ? -1 : 1);
      // both conventions subtract the same delta (matches mouse + touch.js): a
      // right-stick pull DOWN tilts the view down in third AND first person.
      CBZ.cam.pitch = Math.max(-1.0, Math.min(0.9, CBZ.cam.pitch - dpitch));
      if (CBZ.fps && CBZ.fps.active) CBZ.fps.fp = Math.max(-1.3, Math.min(1.3, CBZ.fps.fp - dpitch));
    }

    const want = {};
    if (driving) {
      // ---- DRIVING ----
      if (lx < -0.15) want["a"] = true;         // steer left
      if (lx > 0.15) want["d"] = true;          // steer right
      if (rt > TRIG_ON) want["w"] = true;       // accelerate
      if (lt > TRIG_ON) want["s"] = true;       // brake / reverse
      if (down(pad, B.RB) || down(pad, B.A)) want[" "] = true;   // handbrake
      if (edge(pad, B.Y)) {
        // Do not synthesize E here. Cars, aircraft and armor each own a
        // different seat lifecycle, and the interaction panel is deliberately
        // suppressed while several of those systems have control. Call the
        // current ride's real exit function so controller Y is symmetrical:
        // one press gets in, one press gets out.
        if (P && P._aircraft && CBZ.cityPlayerAircraftExit) CBZ.cityPlayerAircraftExit();
        else if (P && P._vehicle && CBZ.cityExitVehicle) CBZ.cityExitVehicle();
        else if (CBZ.cityArmorActive && CBZ.cityArmorActive() && CBZ.cityExitArmor) CBZ.cityExitArmor();
        else tapKey("e");
      }
      // keep non-driving edges fresh
      edge(pad, B.LB); edge(pad, B.B); edge(pad, B.X); edge(pad, B.DUP); edge(pad, B.BACK);
      setAim(false); setFire(false);
    } else {
      // ---- ON FOOT ----
      // camera-relative movement: physics.js sums w/s/a/d then normalises, so the
      // cardinal booleans (mirroring touch.js) give correct camera-relative move.
      if (ly < -0.2) want["w"] = true;
      if (ly > 0.2) want["s"] = true;
      if (lx < -0.2) want["a"] = true;
      if (lx > 0.2) want["d"] = true;
      const moving = (lx || ly);
      if (down(pad, B.A) && moving) want["shift"] = true;   // sprint
      if (down(pad, B.X)) want[" "] = true;                 // jump (physics edge-detects)

      setAim(lt > TRIG_ON);                                 // LT hold = ADS
      setFire(rt > TRIG_ON);                                // RT = fire

      if (edge(pad, B.B) && CBZ.fpsReload) CBZ.fpsReload();          // reload
      if (edge(pad, B.LB) && CBZ.fpsNextWeapon) CBZ.fpsNextWeapon(); // next weapon
      if (edge(pad, B.RB) && CBZ.fpsPrevWeapon) CBZ.fpsPrevWeapon(); // prev weapon
      if (edge(pad, B.Y)) {
        // Large-animal riding does not set P.driving, so dismount it directly;
        // otherwise Y remains the normal binary interact/board button.
        if (P && P._rideScale > 1 && CBZ.cityDismount) CBZ.cityDismount();
        else tapKey("e");
      }
      if (edge(pad, B.DUP)) tapKey("m");                            // map
      if (edge(pad, B.BACK)) tapKey("Tab");                        // city power
    }
    reconcile(want);
  });
})();
