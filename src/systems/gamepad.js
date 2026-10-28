/* ============================================================
   systems/gamepad.js — XBOX CONTROLLER SUPPORT (GTA V / RDR2 scheme).

   Plug an Xbox pad into the laptop and play the whole game on the stick,
   with the exact muscle-memory layout Rockstar players already have:

     ON FOOT                         DRIVING
     • Left stick   move             • Left stick   steer
     • Right stick  look             • Right stick  look (drive-by aim)
     • LT (hold)    aim / ADS        • RT           accelerate
     • RT           fire             • LT           brake / reverse
     • LB (tap)     next weapon      • RB / A       handbrake
     • RB           prev weapon      • Y            get out
     • A            sprint           • Start        pause
     • X            jump
     • B            reload
     • Y            enter/interact (Gang City: F, into or out of any vehicle)
     • D-pad Up     map              • Back         city power (Tab)
     • D-pad Right  E (Gang City), held as long as the button is: a tap uses
                    the thing / a person's first option, a hold is the grab
     • D-pad Left   Q, the wheel: every option a person or thing has
     • LB held +    a person's I J K L, laid out the way the keys are:
       Y / X / A / B  Y = I (top), X = J (left), A = K (bottom), B = L
                    (right). LB let go without one is the weapon swap.
     • Start        pause/resume
   WHICH BUTTON IS SHOWN. While the pad is the last thing you touched
   (CBZ.padActive()), the option chips print the pad's button, not the key
   (CBZ.padGlyph(key): "LB+Y" for I, "Y" for F, the d-pad arrow for E / Q).

   A CINEMATIC QUESTION (city/campaign_ui.js, CBZ.padPrompt): while three
   answers stand round the d-pad, d-pad up / left / right answer it and the
   pad moves, aims and fires nothing.

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

  // ---- WHICH HAND IS ON THE GAME: the pad, or the keyboard and mouse ----
  function nowMs() { return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now(); }
  let lastPadT = -1e9, lastKbT = 0;
  addEventListener("keydown", function (e) { if (e.isTrusted !== false) lastKbT = nowMs(); }, true);
  addEventListener("mousedown", function (e) { if (e.isTrusted !== false) lastKbT = nowMs(); }, true);
  addEventListener("mousemove", function (e) { if (Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0) > 3) lastKbT = nowMs(); }, true);
  function padTouched(pad) {
    for (let i = 0; i < pad.buttons.length; i++) if (pressed(pad, i)) return true;
    for (let i = 0; i < Math.min(4, pad.axes.length); i++) if (Math.abs(pad.axes[i] || 0) > 0.35) return true;
    return false;
  }
  CBZ.padActive = function () { return padIndex >= 0 && lastPadT > lastKbT; };
  // the pad's button for a key the option chips print (null: no pad button)
  const GLYPH = { i: "LB+Y", j: "LB+X", k: "LB+A", l: "LB+B", f: "Y", e: "\u25B6", q: "\u25C0", m: "\u25B2" };
  // THE PRISON'S CARD (systems/interact.js) keys a man's options E J K L and
  // its E is the pad's Y (the one hand key there): LB + X/A/B are J/K/L on
  // both cards, and the chord's top button is the card's first key, I in the
  // city and E in the prison
  function escapeMode() { return !!(CBZ.game && CBZ.game.mode === "escape"); }
  const GLYPH_ESC = { e: "Y", j: "LB+X", k: "LB+A", l: "LB+B" };
  CBZ.padGlyph = function (key) {
    const k = String(key || "").toLowerCase();
    return (escapeMode() ? GLYPH_ESC[k] : GLYPH[k]) || null;
  };

  addEventListener("gamepadconnected", function (e) {
    if (padIndex < 0) padIndex = e.gamepad.index;
    if (!announced) {
      announced = true;
      const msg = "Controller connected. GTA-style layout ready.";
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

  // E HELD ON THE PAD. Gang City's hold E is the hands' grab
  // (city/interactions.js), so D-pad right is a real press and release, not
  // a 60 ms tap: down sends keydown, up sends keyup, exactly like the key.
  let padEDown = false;
  function padE(on) {
    if (on === padEDown) return;
    padEDown = on;
    try { document.dispatchEvent(new KeyboardEvent(on ? "keydown" : "keyup", { key: "e", bubbles: true })); } catch (e) {}
    if (CBZ.keys) CBZ.keys.e = on;
  }

  // the talk shoulder (LB held): face button -> option key
  const CHORD = [[B.Y, "i"], [B.X, "j"], [B.A, "k"], [B.B, "l"]];
  let lbHeld = false, lbChord = false;

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
    if (!pad) { if (Object.keys(held).length) releaseAllKeys(); setAim(false); setFire(false); padE(false); return; }
    dt = Math.min(dt || 0.016, 0.05);
    if (padTouched(pad)) lastPadT = nowMs();

    // ---- menu / flow (works on the title + pause screens) ----
    if (g.state !== "playing") {
      // release any gameplay holds while not playing
      if (Object.keys(held).length) releaseAllKeys();
      padE(false);
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
      padE(false);
      setAim(false); setFire(false);
      if (edge(pad, B.START) && CBZ.setState) CBZ.setState("paused");
      if (edge(pad, B.B) || edge(pad, B.Y)) tapKey("Escape");   // back out of a menu
      for (const k in B) edge(pad, B[k]);
      return;
    }

    // ---- START = pause ----
    if (edge(pad, B.START) && CBZ.setState) { CBZ.setState("paused"); return; }

    // ---- A CINEMATIC QUESTION IS UP (city/campaign_ui.js): the d-pad answers
    // it and the pad drives nothing else (no walk, no look, no trigger) ----
    // ---- SOMETHING IN YOUR HANDS OWNS THE PAD (city/president_book.js: the
    // briefing book turns on the d-pad / bumpers, points with the stick) ----
    const OWN = CBZ.padOwner;
    if (OWN && OWN.active && OWN.active()) {
      if (Object.keys(held).length) releaseAllKeys();
      padE(false);
      setAim(false); setFire(false);
      try { OWN.pad(pad, function (i) { return edge(pad, i); }, B); } catch (e) {}
      for (const k in B) edge(pad, B[k]);
      return;
    }
    const PR = CBZ.padPrompt;
    if (PR && PR.active && PR.active()) {
      if (Object.keys(held).length) releaseAllKeys();
      padE(false);
      setAim(false); setFire(false);
      if (edge(pad, B.DUP)) PR.pick("up");
      if (edge(pad, B.DLEFT)) PR.pick("left");
      if (edge(pad, B.DRIGHT)) PR.pick("right");
      for (const k in B) edge(pad, B[k]);
      return;
    }

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
      // The two conventions are OPPOSITE, so they cannot share a sign — this
      // block used to subtract for both and claim in its own comment that a
      // stick pull down tilted the view down "in third AND first person". It
      // did so only in first person. cam.pitch is DOWN-POSITIVE (see the
      // convention note in systems/camera.js beside `const cam = {...}`), so a
      // downward stick ADDS there; fps.fp is UP-positive and still subtracts.
      // systems/camera.js owns the pitch envelope — a hand-typed copy here would
      // stop the stick short of where a mouse can already look.
      const r = CBZ.camPitchRange ? CBZ.camPitchRange() : [-1.0, 0.9];
      CBZ.cam.pitch = Math.max(r[0], Math.min(r[1], CBZ.cam.pitch + dpitch));
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
      // Y is F: the way out of whatever you are in, through the one exit
      // dispatcher (systems/seat_exit.js), so a passenger's first press asks
      // the driver to pull over exactly as the keyboard's does.
      if (edge(pad, B.Y) && !(CBZ.seatExit && CBZ.seatExit())) tapKey(CBZ.game && CBZ.game.mode === "city" ? "f" : "e");
      // keep non-driving edges fresh
      if (edge(pad, B.DLEFT)) tapKey("q");      // the wheel on your own car
      edge(pad, B.LB); edge(pad, B.B); edge(pad, B.X); edge(pad, B.DUP); edge(pad, B.BACK);
      padE(false);
      if (edge(pad, B.DRIGHT) && CBZ.verbWheel && CBZ.verbWheel.isOpen()) tapKey("e");
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
      // LB HELD IS THE TALK SHOULDER: the face buttons are a person's I J K L
      // (Y top = I, X left = J, A bottom = K, B right = L, the keys' own
      // diamond) and nothing else while it is down. LB let go without one of
      // them is the weapon swap it always was.
      const lb = pressed(pad, B.LB);
      if (lb) {
        if (!lbHeld) { lbHeld = true; lbChord = false; }
        for (let c = 0; c < CHORD.length; c++) if (edge(pad, CHORD[c][0])) {
          const k = CHORD[c][1];
          tapKey(k === "i" && escapeMode() ? "e" : k);
          lbChord = true;
        }
      } else if (lbHeld) {
        lbHeld = false;
        if (!lbChord && CBZ.fpsNextWeapon) CBZ.fpsNextWeapon();     // next weapon
      }
      if (!lb && down(pad, B.A) && moving) want["shift"] = true;   // sprint
      if (!lb && down(pad, B.X)) want[" "] = true;                 // jump (physics edge-detects)

      setAim(lt > TRIG_ON);                                 // LT hold = ADS
      setFire(rt > TRIG_ON);                                // RT = fire

      if (!lb && edge(pad, B.B) && CBZ.fpsReload) CBZ.fpsReload();   // reload
      if (edge(pad, B.RB) && CBZ.fpsPrevWeapon) CBZ.fpsPrevWeapon(); // prev weapon
      // THE KEYBOARD MAP ON A PAD: Y = F (get in / get out of anything),
      // D-pad right = E held as long as the button is (use the thing; a hold
      // is the grab), D-pad left = Q (the verb wheel: a person's I J K L and
      // the rest; D-pad right then fires its highlighted verb).
      // (Gang City only; the other games keep Y as their one hand key, E)
      // (Gang City and the islands: the one key map, city/interactions.js)
      const city = !!(CBZ.game && (CBZ.game.mode === "city" || (CBZ.economyMode && CBZ.economyMode())));
      if (!lb && edge(pad, B.Y) && !(CBZ.seatExit && CBZ.seatExit())) tapKey(city ? "f" : "e");
      edge(pad, B.DRIGHT);
      padE(!!city && pressed(pad, B.DRIGHT));
      if (edge(pad, B.DLEFT) && city) tapKey("q");
      if (edge(pad, B.DUP)) tapKey("m");                            // map
      if (edge(pad, B.BACK)) tapKey("Tab");                        // city power
    }
    reconcile(want);
  });
})();
