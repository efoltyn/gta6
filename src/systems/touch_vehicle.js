/* ============================================================
   systems/touch_vehicle.js — contextual TOUCH controls for driving
   and flying (iPad/phone). Desktop is byte-identical: nothing here
   runs unless the touch layer (touch.js) has enabled itself.

   The owner's grammar: while you're IN something, the on-foot icon
   cluster disappears and a per-state set of labeled hold-buttons
   appears — buttons that SAY what they do — plus a real racing-game
   dial speedometer (km/h) instead of a floating text readout.

     DRIVING  (TOUCH_DRIVE_PEDALS — owner: "it shouldn't be driving around
              with a keypad… add a gas next to the brake, and make the
              [stick] for flipping in air and for turning")
              stick  = the WHEEL: horizontal steers (a/d); the vertical
                       axis is the AIR-FLIP input while airborne
                       (touch.js publishes CBZ.touchDriveFlip; vehicles.js
                       consumes it) and does nothing on the ground.
              GAS    = hold  → CBZ.keys["w"]  (throttle)
              BRAKE  = hold  → CBZ.keys["s"]  (brake; held at a stop =
                       reverse — the same S the desktop uses)
              DRIFT  = hold  → CBZ.keys[" "]  (the space handbrake)
              EXIT   = tap   → CBZ.cityExitVehicle() (the same path the
                       interact registry's "Step out" verb calls)
              LOOK BACK = hold → CBZ.camLookBack(down) (camera agent's
                       feature-detected hook; button hides if absent)
              (TOUCH_DRIVE_PEDALS=false restores stick-throttle + the old
              single BRAKE-as-handbrake pill.)
     HELI     stick = yaw/thrust (unchanged).
              UP     = hold  → CBZ.keys[" "]        (collective up)
              DOWN   = hold  → CBZ.keys["control"]  (collective down —
                       "control" on purpose: it never collides with the
                       on-foot sprint logic that owns "shift")
              FIRE   = tap   → CBZ.cityAircraftFireMissile() (armed craft)
              EXIT   = tap   → CBZ.cityPlayerAircraftExit() (the [F] path)
     WING     stick = a REAL joystick now (FLIGHT_CONTROLS_V2): left/right =
              roll (a/d), up/down = PITCH (w/s — the stick writes WASD and the
              flight model maps W/S to pitch), so the left thumb finally flies
              the nose. Throttle is the right-thumb hold-pair, reusing the heli's
              Space/Ctrl power grammar:
              THR+   = hold  → CBZ.keys[" "]        (throttle up)
              THR−   = hold  → CBZ.keys["control"]  (throttle down / wheel brakes)
              FIRE / EXIT as heli. (QE rudder is a desktop fine-tune; touch turns
              by banking, the natural mobile-flight feel — no extra pills.)

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
  // GAS/BRAKE pedal pills + stick-as-wheel (touch.js reads this too; the
  // default lives here because this file owns the drive-mode grammar).
  if (CBZ.CONFIG && CBZ.CONFIG.TOUCH_DRIVE_PEDALS == null) CBZ.CONFIG.TOUCH_DRIVE_PEDALS = true;
  const on = () => !!(CBZ.touchMode) && (!CBZ.CONFIG || CBZ.CONFIG.TOUCH_VEHICLE !== false);
  const pedals = () => !CBZ.CONFIG || CBZ.CONFIG.TOUCH_DRIVE_PEDALS !== false;

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
    // VIEW swaps the cockpit/chase camera. Feature-detected the same way LOOK
    // BACK is, so a build without the cockpit files simply never shows it.
    const VIEW_BTN = pill("tvView", "VIEW", "tv-sm");
    let html = "";
    if (next === "drive") {
      // pedals: GAS sits FIRST (column-reverse → bottom, nearest the resting
      // thumb), BRAKE above it, the handbrake keeps its own small DRIFT pill.
      html = pedals()
        ? pill("tvGas", "GAS", "tv-big tv-go") + pill("tvBrake", "BRAKE", "tv-big tv-warn") +
          pill("tvDrift", "DRIFT", "tv-sm") + LOOK_BTN + pill("tvExit", "EXIT", "tv-sm")
        : pill("tvBrake", "BRAKE", "tv-big tv-warn") + LOOK_BTN + pill("tvExit", "EXIT", "tv-sm");
    } else if (next === "heli") {
      html = pill("tvUp", "UP", "tv-big tv-go") + pill("tvDown", "DOWN", "tv-big") +
        FIRE_BTN + LOOK_BTN + VIEW_BTN + pill("tvExit", "EXIT", "tv-sm");
    } else if (next === "wing") {
      html = pill("tvThrUp", "THR +", "tv-big tv-go") + pill("tvThrDn", "THR −", "tv-big") +
        FIRE_BTN + LOOK_BTN + VIEW_BTN + pill("tvExit", "EXIT", "tv-sm");
    } else if (next === "chute") {
      // Falling out of an aircraft is a CONTEXT, not a vehicle, but it is the
      // same problem this layer exists to solve: a keyboard verb the thumb
      // cannot reach. The stick already steers the canopy (it writes WASD and
      // the canopy reads A/D to turn, S to flare), so the only thing missing
      // was the one press that matters. PULL is deliberately the biggest
      // button on the screen and it is the only one — and once the canopy is
      // out the same button becomes CUT AWAY (bailout.js's cut-away verb), so
      // a touch player is never trapped under a chute they cannot close.
      html = pill("tvChute", "PULL", "tv-big tv-go");
    } else if (next === "swim") {
      // The swimmer's vertical axis (swim.js reads Space=rise / Ctrl=dive off
      // CBZ.keys). CBZ.citySwimVertical existed for touch and had ZERO callers
      // — on a phone or iPad you literally could not go under the water. Two
      // hold buttons on the existing key grammar close that: no new API, the
      // same keys the desktop uses, swept by the layer's own stale-hold guard.
      html = pill("tvDive", "DIVE", "tv-big") + pill("tvRise", "RISE", "tv-big tv-go");
    }
    btnWrap.innerHTML = html;
    const q = (id) => btnWrap.querySelector("#" + id);
    if (q("tvExit")) tapBtn(q("tvExit"), doExit);
    // with pedals, BRAKE is the real brake/reverse (S); the Space handbrake
    // moves to its own DRIFT pill. Flag off → the old BRAKE-as-handbrake.
    if (q("tvGas")) holdBtn(q("tvGas"), "w");
    if (q("tvBrake")) holdBtn(q("tvBrake"), next === "drive" && pedals() ? "s" : " ");
    if (q("tvDrift")) holdBtn(q("tvDrift"), " ");
    if (q("tvUp")) holdBtn(q("tvUp"), " ");
    if (q("tvDown")) holdBtn(q("tvDown"), "control");
    // throttle reuses the heli's power grammar (Space up / Ctrl down) so the
    // stick is free to be the pitch+roll joystick (FLIGHT_CONTROLS_V2).
    if (q("tvThrUp")) holdBtn(q("tvThrUp"), " ");
    if (q("tvThrDn")) holdBtn(q("tvThrDn"), "control");
    if (q("tvFire")) tapBtn(q("tvFire"), doFire);
    // LOOK BACK: hold pins the chase cam over the shoulder (camera agent's
    // feature-detected API — the button only shows once that API exists).
    if (q("tvLook")) holdFn(q("tvLook"), (down) => { if (CBZ.camLookBack) CBZ.camLookBack(down); });
    if (q("tvView")) tapBtn(q("tvView"), () => { if (CBZ.cockpitToggleView) CBZ.cockpitToggleView(); });
    if (q("tvChute")) tapBtn(q("tvChute"), () => {
      const st = CBZ.cityChuteState ? CBZ.cityChuteState() : null;
      if (st && st.phase === "canopy") { if (CBZ.cityChuteCut) CBZ.cityChuteCut(); }
      else if (CBZ.cityChuteDeploy) CBZ.cityChuteDeploy();
    });
    if (q("tvRise")) holdBtn(q("tvRise"), " ");
    if (q("tvDive")) holdBtn(q("tvDive"), "control");
    ammoEl = btnWrap.querySelector("#tvAmmo");
    lastSpeed = -1; lastSub = "";   // force a dial repaint for the new context
  }

  // Is the touch vehicle layer currently OWNING the bottom-right instrument
  // corner? city/carcluster.js asks, so the desktop cluster can stand down to
  // a compact strip instead of stacking a second speedometer on top of this
  // dial. Degrade-safe on both sides: no touch layer → the answer is false and
  // the cluster draws exactly as it always did.
  CBZ.touchVehicleActive = function () { return !!(on() && mode); };
  CBZ.touchVehicleMode = function () { return mode || ""; };

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
    // tick LABELS at the quarter marks (0, ¼, ½, ¾, full). With a grand ~1000+
    // scale a label per tick would crowd, so round quarters keep it legible;
    // values come straight off `max`, so a future rocket's dial re-numbers itself
    // for free. The 0 / full endpoints ride out toward the rim corners so they
    // clear the big centre readout that sits in the dial's bottom gap.
    c.save();
    c.textAlign = "center"; c.textBaseline = "middle";
    c.font = "600 13px Fredoka, system-ui, sans-serif";
    c.fillStyle = "rgba(159,176,198,.9)";
    for (let i = 0; i <= 8; i += 2) {
      const a = A0 + (A1 - A0) * (i / 8);
      const rl = (i === 0 || i === 8) ? R - 22 : R - 40;
      c.fillText(String(Math.round(max * i / 8)), cx + Math.cos(a) * rl, cy + Math.sin(a) * rl);
    }
    c.restore();
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
    // The chute wins over everything: you are not in a vehicle any more, and
    // any other pill set on screen while you are falling is a lie.
    const chute = active && CBZ.cityChuteState ? CBZ.cityChuteState() : null;
    if (chute) next = "chute";
    else if (active && P._aircraft) next = P._aircraft.kind === "heli" ? "heli" : "wing";
    else if (active && P.driving && P._vehicle) next = "drive";
    // In the water the thumb needs the vertical axis (dive/rise). Same
    // precedence slot as a vehicle: the swim owns the body right now.
    else if (active && CBZ.citySwimming && CBZ.citySwimming()) next = "swim";
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
    // VIEW appears only once the cockpit files are present (same merge-order
    // safety as LOOK BACK — neither button may assume its API exists)
    const vb = btnWrap.querySelector("#tvView");
    if (vb) {
      const want = CBZ.cockpitToggleView ? "" : "none";
      if (vb.style.display !== want) vb.style.display = want;
    }
    // Once the canopy is out the pull becomes the cut-away — same button, the
    // verb the phase actually offers. (It used to just hide, which on touch
    // left no way at all to close an open parachute.)
    if (mode === "chute") {
      const cb = btnWrap.querySelector("#tvChute");
      const st = CBZ.cityChuteState ? CBZ.cityChuteState() : null;
      if (cb) {
        const canCut = !!(st && st.phase === "canopy") && CBZ.CONFIG.BAILOUT_CUTAWAY !== false && !!CBZ.cityChuteCut;
        const label = canCut ? "CUT AWAY" : "PULL";
        if (cb.textContent !== label) cb.textContent = label;
        const want = (st && st.phase === "freefall") || canCut ? "" : "none";
        if (cb.style.display !== want) cb.style.display = want;
      }
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
    if (mode === "chute") {
      // Under a canopy the number that matters is how much air is left. The
      // dial re-scales to 400m so the needle actually SWEEPS on the way down
      // instead of sitting pinned at the bottom of an aircraft-sized gauge,
      // and it warns once you are inside the height where pulling still saves
      // you — the same threshold city/bailout.js uses.
      const st = CBZ.cityChuteState ? CBZ.cityChuteState() : null;
      if (!st) return;
      const agl = Math.max(0, Math.round(st.agl || 0));
      const open = st.phase !== "freefall";
      const warn = !open && agl < 120;
      const sub = open ? "CANOPY" : "PULL";
      if (agl !== lastSpeed || sub !== lastSub) {
        lastSpeed = agl; lastSub = sub;
        drawDial(agl, 400, "AGL m", sub, warn);
      }
    } else if (mode === "drive") {
      const car = P._vehicle;
      const kmh = Math.abs((car && car.v) || 0) * 4.8;   // hud.js mph≈v*3 → km/h≈v*4.8
      const key = Math.round(kmh);
      if (key !== lastSpeed) { lastSpeed = key; drawDial(kmh, 240, "km/h", "", false); }
    } else if (mode === "swim") {
      // Underwater the number that matters is air. Seconds left on the dial,
      // warning at the same 30% swim.js's own HUD threshold uses; the sub-line
      // says DIVING while the head is actually under so the gauge explains
      // itself the first time it drains.
      const sw = CBZ.citySwimState ? CBZ.citySwimState() : null;
      const airMax = (P.breathMax != null && P.breathMax > 0) ? P.breathMax : 28;
      const air = P.breath != null ? Math.max(0, P.breath) : airMax;
      const key2 = Math.round(air * 2);
      const sub2 = sw && sw.headUnder ? "DIVING" : "AIR";
      if (key2 !== lastSpeed || sub2 !== lastSub) {
        lastSpeed = key2; lastSub = sub2;
        drawDial(air, airMax, "air s", sub2, air < airMax * 0.3);
      }
    } else {
      const craft = P._aircraft; if (!craft) return;
      const derived = !CBZ.CONFIG || CBZ.CONFIG.FLIGHT_GAUGES_DERIVED !== false;
      const spd = craft.speed != null ? craft.speed : Math.hypot(craft.vx || 0, craft.vz || 0);
      // ALT reads height ABOVE GROUND (matching the desktop flight HUD) via the
      // aircraft surface oracle — not raw world-Y over the elevated city, which
      // is what made the readout look "capped" once you were up.
      const surf = derived && CBZ.aircraftSurfaceY && craft.pos ? CBZ.aircraftSurfaceY(craft.pos.x, craft.pos.z) : 0;
      const alt = Math.max(0, Math.round((craft.pos ? craft.pos.y : 0) - surf));
      const warn = !!(craft.stalled || craft.autorotating);
      // Gauge RANGE is a fixed GRAND scale (owner: "it should go up to THOUSANDS
      // — what if it's a military plane, or a rocket?"). max(1000, perfVmax·1.25)
      // keeps the dial reading in the thousands with headroom, so a 170 airliner
      // or a 420 jet sits LOW on the gauge instead of hugging its own cap, and a
      // future rocket fits without ever touching the gauge again. Needle + centre
      // readout stay linear and TRUE — only the SCALE is grand. FLIGHT_GAUGES_
      // DERIVED=false still reverts to the old fixed 40/90 fallback.
      const cap = derived && craft.perfVmax ? Math.max(1000, craft.perfVmax * 1.25) : (mode === "heli" ? 40 : 90);
      const key = Math.round(spd), sub = "ALT " + alt + (warn ? " !" : "");
      if (key !== lastSpeed || sub !== lastSub) {
        lastSpeed = key; lastSub = sub;
        drawDial(spd, cap, "SPD", sub, warn);
      }
    }
  });
})();
