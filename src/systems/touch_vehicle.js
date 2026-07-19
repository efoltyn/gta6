/* ============================================================
   systems/touch_vehicle.js — contextual TOUCH controls for driving
   and flying (iPad/phone). Desktop is byte-identical: nothing here
   runs unless the touch layer (touch.js) has enabled itself.

   The owner's grammar: while you're IN something, the on-foot icon
   cluster disappears and a per-state set of labeled hold-buttons
   appears — buttons that SAY what they do — plus a real racing-game
   dial speedometer (km/h) instead of a floating text readout.

     DRIVING  stick = steer/throttle (unchanged; it writes WASD).
              BRAKE  = hold  → CBZ.keys[" "]  (the space handbrake/drift)
              EXIT   = tap   → CBZ.cityExitVehicle() (the same path the
                       interact registry's "Step out" verb calls)
              LOOK BACK = hold → CBZ.camLookBack(down) (camera agent's
                       feature-detected hook; button hides if absent)
     HELI     stick = yaw/thrust (unchanged).
              UP     = hold  → CBZ.keys[" "]        (collective up)
              DOWN   = hold  → CBZ.keys["control"]  (collective down —
                       "control" on purpose: it never collides with the
                       on-foot sprint logic that owns "shift")
              FIRE   = tap   → CBZ.cityAircraftFireMissile() (armed craft)
              EXIT   = tap   → CBZ.cityPlayerAircraftExit() (the [F] path)
     WING     stick = bank (a/d) as before; throttle moves to buttons so
              the thumb can hold power through a whole climb:
              THR+   = hold  → CBZ.keys["w"]
              THR−   = hold  → CBZ.keys["s"] (wheel brakes on the ground)
              FIRE / EXIT as heli.

   Held buttons RE-ASSERT their key every frame from onUpdate(10) —
   just before vehicles (11) and aircraft (12) consume them — so a
   stick release (which clears WASD wholesale in touch.js) can never
   swallow a button the thumb is still pressing.

   One-line revert: CBZ.CONFIG.TOUCH_VEHICLE = false.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (CBZ.CONFIG && CBZ.CONFIG.TOUCH_VEHICLE == null) CBZ.CONFIG.TOUCH_VEHICLE = true;
  const on = () => !!(CBZ.touchMode) && (!CBZ.CONFIG || CBZ.CONFIG.TOUCH_VEHICLE !== false);

  let root = null, dial = null, dialCtx = null, btnWrap = null, ammoEl = null;
  let mode = "";               // "" | "drive" | "heli" | "wing"
  const held = Object.create(null);   // key -> true while a hold-button is down
  let lastDraw = 0, lastSpeed = -1, lastSub = "";

  // ---- DOM -------------------------------------------------------------------
  function pill(id, label, cls) {
    return '<button type="button" id="' + id + '" class="tvbtn ' + (cls || "") + '">' + label + "</button>";
  }
  function build() {
    if (root) return;
    root = document.createElement("div");
    root.id = "tveh";
    root.innerHTML =
      '<canvas id="tvDial" width="256" height="256"></canvas>' +
      '<div id="tvBtns"></div>';
    document.body.appendChild(root);
    dial = root.querySelector("#tvDial");
    dialCtx = dial.getContext("2d");
    btnWrap = root.querySelector("#tvBtns");
  }

  // press-and-hold: the key goes down with the finger and is re-asserted per
  // frame by the onUpdate(10) pump below until the finger lifts.
  function holdBtn(el, key) {
    const dn = (e) => { e.preventDefault(); el.classList.add("on"); held[key] = true; if (CBZ.keys) CBZ.keys[key] = true; };
    const up = (e) => { e.preventDefault(); el.classList.remove("on"); held[key] = false; if (CBZ.keys) CBZ.keys[key] = false; };
    el.addEventListener("touchstart", dn, { passive: false });
    el.addEventListener("touchend", up, { passive: false });
    el.addEventListener("touchcancel", up, { passive: false });
    el.addEventListener("mousedown", dn); el.addEventListener("mouseup", up);
    el.addEventListener("mouseleave", up);
  }
  function tapBtn(el, fn) {
    el.addEventListener("touchstart", (e) => { e.preventDefault(); el.classList.add("on"); }, { passive: false });
    el.addEventListener("touchend", (e) => { e.preventDefault(); el.classList.remove("on"); fn(); }, { passive: false });
    el.addEventListener("touchcancel", () => el.classList.remove("on"), { passive: false });
    el.addEventListener("mousedown", (e) => { e.preventDefault(); fn(); });
  }
  // press-and-hold that drives a callback instead of a key (camera hooks)
  function holdFn(el, fn) {
    const dn = (e) => { e.preventDefault(); el.classList.add("on"); fn(true); };
    const up = (e) => { e.preventDefault(); el.classList.remove("on"); fn(false); };
    el.addEventListener("touchstart", dn, { passive: false });
    el.addEventListener("touchend", up, { passive: false });
    el.addEventListener("touchcancel", up, { passive: false });
    el.addEventListener("mousedown", dn); el.addEventListener("mouseup", up);
    el.addEventListener("mouseleave", up);
  }
  function clearHeld() {
    for (const k in held) { if (held[k]) { held[k] = false; if (CBZ.keys) CBZ.keys[k] = false; } }
  }
  // Losing the page mid-hold (app switch, phone lock, edge swipe) can swallow
  // a touchend — BRAKE/UP/THR would stay latched through the refocus. Drop
  // every held key + lit button the moment the page leaves the foreground.
  // Desktop never builds this layer (root stays null), so it is untouched.
  function releaseAllHeld() {
    if (!root) return;
    clearHeld();
    if (btnWrap) btnWrap.querySelectorAll(".tvbtn.on").forEach((el) => el.classList.remove("on"));
  }
  window.addEventListener("blur", releaseAllHeld);
  window.addEventListener("pagehide", releaseAllHeld);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible") releaseAllHeld();
  });

  // fire reticle (same glyph language as touch.js's icon cluster)
  const FIRE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2.3" fill="currentColor" stroke="none"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/></svg>';

  function layout(next) {
    mode = next;
    clearHeld();
    if (!btnWrap) return;
    if (!next) { btnWrap.innerHTML = ""; ammoEl = null; return; }
    // #tvBtns is column-REVERSE: the FIRST button here sits at the BOTTOM,
    // nearest the resting thumb — so the big primary hold goes first.
    const FIRE_BTN = '<button type="button" id="tvFire" class="tvbtn tv-fire" style="display:none">' + FIRE_SVG + '<span id="tvAmmo" class="tvAmmo"></span></button>';
    const LOOK_BTN = pill("tvLook", "LOOK BACK", "tv-sm");   // camera-agent hook; hidden unless CBZ.camLookBack exists
    let html = "";
    if (next === "drive") {
      html = pill("tvBrake", "BRAKE", "tv-big tv-warn") + LOOK_BTN + pill("tvExit", "EXIT", "tv-sm");
    } else if (next === "heli") {
      html = pill("tvUp", "UP", "tv-big tv-go") + pill("tvDown", "DOWN", "tv-big") +
        FIRE_BTN + LOOK_BTN + pill("tvExit", "EXIT", "tv-sm");
    } else if (next === "wing") {
      html = pill("tvThrUp", "THR +", "tv-big tv-go") + pill("tvThrDn", "THR −", "tv-big") +
        FIRE_BTN + LOOK_BTN + pill("tvExit", "EXIT", "tv-sm");
    }
    btnWrap.innerHTML = html;
    const q = (id) => btnWrap.querySelector("#" + id);
    if (q("tvExit")) tapBtn(q("tvExit"), doExit);
    if (q("tvBrake")) holdBtn(q("tvBrake"), " ");
    if (q("tvUp")) holdBtn(q("tvUp"), " ");
    if (q("tvDown")) holdBtn(q("tvDown"), "control");
    if (q("tvThrUp")) holdBtn(q("tvThrUp"), "w");
    if (q("tvThrDn")) holdBtn(q("tvThrDn"), "s");
    if (q("tvFire")) tapBtn(q("tvFire"), doFire);
    // LOOK BACK: hold pins the chase cam over the shoulder (camera agent's
    // feature-detected API — the button only shows once that API exists).
    if (q("tvLook")) holdFn(q("tvLook"), (down) => { if (CBZ.camLookBack) CBZ.camLookBack(down); });
    ammoEl = btnWrap.querySelector("#tvAmmo");
    lastSpeed = -1; lastSub = "";   // force a dial repaint for the new context
  }

  function doExit() {
    const P = CBZ.player; if (!P) return;
    if (P._aircraft && CBZ.cityPlayerAircraftExit) CBZ.cityPlayerAircraftExit();
    else if (P.driving && CBZ.cityExitVehicle) CBZ.cityExitVehicle();
  }
  function doFire() {
    if (CBZ.cityAircraftFireMissile) CBZ.cityAircraftFireMissile();
  }

  // ---- the dial (canvas 2D, retina-doubled) ---------------------------------
  // A real racing dial: 270° sweep, tick ring, needle, big centered km/h.
  // Aircraft reuse the same instrument with airspeed + an ALT sub-line.
  const A0 = Math.PI * 0.75, A1 = Math.PI * 2.25;   // sweep angles
  function drawDial(speed, max, unit, sub, warn) {
    const c = dialCtx; if (!c) return;
    const W = 256, cx = W / 2, cy = W / 2, R = 108;
    const n = Math.max(0, Math.min(1, speed / max));
    c.clearRect(0, 0, W, W);
    // face
    c.beginPath(); c.arc(cx, cy, R + 14, 0, Math.PI * 2);
    c.fillStyle = "rgba(8,12,18,.74)"; c.fill();
    c.lineWidth = 3; c.strokeStyle = "rgba(232,236,242,.18)"; c.stroke();
    // passive arc + lit arc up to the needle
    c.lineCap = "round";
    c.beginPath(); c.arc(cx, cy, R - 6, A0, A1);
    c.lineWidth = 10; c.strokeStyle = "rgba(232,236,242,.10)"; c.stroke();
    c.beginPath(); c.arc(cx, cy, R - 6, A0, A0 + (A1 - A0) * n);
    c.strokeStyle = warn ? "#ffb04c" : (n > 0.72 ? "#ff7a5c" : "#7de7ff"); c.stroke();
    // ticks
    c.lineWidth = 2; c.strokeStyle = "rgba(232,236,242,.4)";
    for (let i = 0; i <= 8; i++) {
      const a = A0 + (A1 - A0) * (i / 8);
      const r0 = R - 18, r1 = R - 26;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      c.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      c.stroke();
    }
    // needle
    const na = A0 + (A1 - A0) * n;
    c.beginPath();
    c.moveTo(cx + Math.cos(na + Math.PI) * 14, cy + Math.sin(na + Math.PI) * 14);
    c.lineTo(cx + Math.cos(na) * (R - 30), cy + Math.sin(na) * (R - 30));
    c.lineWidth = 5; c.strokeStyle = "#ffd166"; c.stroke();
    c.beginPath(); c.arc(cx, cy, 8, 0, Math.PI * 2); c.fillStyle = "#ffd166"; c.fill();
    // numbers
    c.textAlign = "center"; c.fillStyle = warn ? "#ffb04c" : "#e8ecf2";
    c.font = "700 52px Fredoka, system-ui, sans-serif";
    c.fillText(String(Math.round(speed)), cx, cy + 66);
    c.font = "600 20px Fredoka, system-ui, sans-serif";
    c.fillStyle = "rgba(159,176,198,.95)";
    c.fillText(unit, cx, cy + 90);
    if (sub) { c.font = "600 19px Fredoka, system-ui, sans-serif"; c.fillText(sub, cx, cy - 44); }
  }

  // ---- key pump: held buttons win over a released stick ---------------------
  // Runs at 10, just before player driving (11) / flight (12) read CBZ.keys.
  CBZ.onUpdate(10, function () {
    if (!mode) return;
    const k = CBZ.keys; if (!k) return;
    for (const key in held) if (held[key]) k[key] = true;
  });

  // ---- context watcher + dial repaint ---------------------------------------
  CBZ.onAlways(97, function () {
    const P = CBZ.player;
    const active = on() && P && CBZ.game.state === "playing" && !CBZ.cityMenuOpen && !P.dead;
    let next = "";
    if (active && P._aircraft) next = P._aircraft.kind === "heli" ? "heli" : "wing";
    else if (active && P.driving && P._vehicle) next = "drive";
    if (!root && next) build();
    if (!root) return;
    if (next !== mode) {
      layout(next);
      root.style.display = next ? "block" : "none";
      document.body.classList.toggle("tveh-on", !!next);
    }
    if (!next) return;

    // LOOK BACK appears only once the camera agent's API exists (merge-order safe)
    const lb = btnWrap.querySelector("#tvLook");
    if (lb) {
      const want = CBZ.camLookBack ? "" : "none";
      if (lb.style.display !== want) lb.style.display = want;
    }
    // fire button + ammo badge only on armed craft
    if (mode === "heli" || mode === "wing") {
      const craft = P._aircraft, fb = btnWrap.querySelector("#tvFire");
      if (fb) {
        const armed = craft && craft.armed !== false;
        fb.style.display = armed ? "" : "none";
        if (armed && ammoEl) {
          const a = String(craft.ammo == null ? "" : craft.ammo);
          if (a !== ammoEl.textContent) ammoEl.textContent = a;
        }
      }
    }

    // dial repaint, throttled (~12 Hz — SwiftShader/phone friendly)
    const now = performance.now();
    if (now - lastDraw < 80) return;
    lastDraw = now;
    if (mode === "drive") {
      const car = P._vehicle;
      const kmh = Math.abs((car && car.v) || 0) * 4.8;   // hud.js mph≈v*3 → km/h≈v*4.8
      const key = Math.round(kmh);
      if (key !== lastSpeed) { lastSpeed = key; drawDial(kmh, 240, "km/h", "", false); }
    } else {
      const craft = P._aircraft; if (!craft) return;
      const spd = craft.speed != null ? craft.speed : Math.hypot(craft.vx || 0, craft.vz || 0);
      const alt = Math.max(0, Math.round(craft.pos ? craft.pos.y : 0));
      const warn = !!(craft.stalled || craft.autorotating);
      const key = Math.round(spd), sub = "ALT " + alt + (warn ? " ⚠" : "");
      if (key !== lastSpeed || sub !== lastSub) {
        lastSpeed = key; lastSub = sub;
        drawDial(spd, mode === "heli" ? 40 : 90, "SPD", sub, warn);
      }
    }
  });
})();
