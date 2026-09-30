/* ============================================================
   systems/touch_vehicle.js — contextual TOUCH controls for driving
   and flying (iPad/phone). Desktop is byte-identical: nothing here
   runs unless the touch layer (touch.js) has enabled itself.

   The owner's grammar: while you're IN something, the on-foot icon
   cluster disappears and a per-state set of labeled hold-buttons
   appears — buttons that SAY what they do — plus a real racing-game
   dial speedometer (units per CBZ.speedRead — MPH by default, the same
   one conversion every other gauge reads) instead of a floating text.

     DRIVING  LEFT / RIGHT = steering; the GAS and BRAKE PEDALS = W / S
              through the existing car model (BRAKE slows first, then
              reverses at rest). The pedals are the Bullring race page's
              (a tall ridged gas under the thumb, a shorter brake inboard),
              for every car, the race cars included.
              The on-foot joystick stands down only for road cars.
              TILT is an optional, calibrated low-sensitivity analog steer.
     BOAT     stick = steer/throttle (unchanged). ASTERN = hold → Ctrl
              (water_helm's crash-stop; Space is the get-up now).
              VIEW = the [V] wheel view, same handler as the car's.
     HELI     stick = yaw/thrust (unchanged).
              UP     = hold  → CBZ.keys[" "]        (collective up)
              DOWN   = hold  → CBZ.keys["control"]  (collective down —
                       "control" on purpose: it never collides with the
                       on-foot sprint logic that owns "shift")
              FIRE   = tap   → CBZ.cityAircraftFireMissile() (armed craft)
     WING     stick = a REAL joystick now (FLIGHT_CONTROLS_V2): left/right =
              roll (a/d), up/down = PITCH (w/s — the stick writes WASD and the
              flight model maps W/S to pitch), so the left thumb finally flies
              the nose. Throttle is the right-thumb hold-pair, reusing the heli's
              Space/Ctrl power grammar:
              THR+   = hold  → CBZ.keys[" "]        (throttle up)
              THR−   = hold  → CBZ.keys["control"]  (throttle down / wheel brakes)
              FIRE as heli. (QE rudder is a desktop fine-tune; touch turns
              by banking, the natural mobile-flight feel — no extra pills.)

     ARMOR    the tank / armoured truck (city/militaryvehicles.js). It sets
              P.driving but NOT P._vehicle — it keeps a module-local record —
              so this layer's context watcher never matched it and an iPad
              player could BOARD A TANK AND NEVER GET OUT: no EXIT, no FIRE,
              no dial, and the on-foot cluster is hidden by body.tveh-on the
              whole time. Now a real context.
              FIRE  = tap → CBZ.cityArmorFire() (tank or map-targeted Patriot;
                      an unarmed truck has no dead button)
     NO EXIT PILL IN ANY CONTEXT. The way out of every seat (car, passenger
              seat, boat, cockpit, armor, saddle, chair, bed) is ONE button,
              #tExit, in ONE place, owned by systems/seat_exit.js. This layer
              used to draw its own EXIT / JUMP OUT / GET UP / DISMOUNT pill in
              a different spot per context.
     AUX RAIL (#tvAux) — a SECOND column standing directly above the dial, in
              the dial's own footprint, so weapon/ordnance controls never grow
              the primary thumb column past a thumb's reach. It carries the
              controls that are about the PAYLOAD rather than the airframe:

     B-2 ORDNANCE (city/strategic.js). The bomber shipped with four seams
              published FOR THIS FILE — strategicBombDrop, strategicPayloadCycle,
              strategicBombHold, strategicBombCameraHold — and not one of them
              had a caller anywhere in the repo, so on an iPad the B-2 was a
              plane with a bay you could not open:
              BOMB    = hold → CBZ.strategicBombHold(down). Tap releases one,
                        hold walks a carpet: the SAME tap/hold arc [B] runs,
                        because it IS that state machine, not a copy of it.
              PAYLOAD = tap  → CBZ.strategicPayloadCycle(), and the pill is
                        also the READOUT ("MK-84 ×16"). That second job is not
                        decoration: mobile.css hides #cityFlightHud under
                        body.tveh-on, so the strip that teaches the payload on
                        desktop is invisible on touch — the switch had no label
                        AND no state.
     Deliberately NOT on the glass: HOMING (lockon defaults to homing; the
              toggle stays on [H]), BOMB CAM (a cinematic, [C] hold), the Q/E
              trim pair (bank covers the turn), LOOK BACK (the look drag already
              swings the chase camera) and RECENTER (dead since 2026-08-04).

   Held buttons RE-ASSERT their key every frame from onUpdate(10) —
   just before vehicles (11) and aircraft (12) consume them — so a
   stick release (which clears WASD wholesale in touch.js) can never
   swallow a button the thumb is still pressing.

   One-line reverts: CBZ.CONFIG.TOUCH_VEHICLE = false (the whole layer),
   TOUCH_AIRCRAFT_V2 = false (the aux rail + armor context — the layer
   falls back byte-for-byte to the drive/heli/wing/chute/swim set).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (CBZ.CONFIG && CBZ.CONFIG.TOUCH_VEHICLE == null) CBZ.CONFIG.TOUCH_VEHICLE = true;
  // TOUCH_AIRCRAFT_V2 — the ordnance/armor pass (owner 2026-07-28: "the B-2
  // bomber and many other things that have new controls need new iPad
  // controls"). Master flag for the aux rail and the armor context;
  // off = this file behaves exactly as it did before the pass.
  if (CBZ.CONFIG && CBZ.CONFIG.TOUCH_AIRCRAFT_V2 == null) CBZ.CONFIG.TOUCH_AIRCRAFT_V2 = true;
  const on = () => !!(CBZ.touchMode) && (!CBZ.CONFIG || CBZ.CONFIG.TOUCH_VEHICLE !== false);
  const airV2 = () => !CBZ.CONFIG || CBZ.CONFIG.TOUCH_AIRCRAFT_V2 !== false;

  let root = null, dial = null, dialCtx = null, btnWrap = null, auxWrap = null, ammoEl = null;
  let mode = "";               // "" | "drive" | "boat" | "armor" | "heli" | "wing" | "chute" | "swim" | "mount"
  const held = Object.create(null);   // key -> true while a hold-button is down
  // Every holdFn control's release callback, so the blur/pagehide sweeper can
  // let go of a CALLBACK hold the same way it lets go of a KEY hold. LOOK BACK
  // has been a holdFn since it shipped and was never in that sweep: a swallowed
  // touchend (system edge swipe, notification shade) left the chase camera
  // pinned backwards with no button down to explain it.
  const heldFns = [];
  let lastDraw = 0, lastSpeed = -1, lastSub = "", lastPay = "", lastAuxT = 0;

  // ---- optional car tilt steering -------------------------------------------
  // Tilt does not synthesize twitchy A/D taps. It publishes one gentle analog
  // value into vehicles.js's existing smoothed steering seam. Four degrees of
  // hand wobble are ignored, full lock takes a deliberate 26-degree lean, the
  // curve eases in/out, and a 6/s low-pass removes sensor chatter.
  const TILT_DEAD = 4, TILT_FULL = 26, TILT_MAX = 0.88, TILT_RESPONSE = 6;
  let tiltOn = false, tiltBusy = false, tiltListening = false;
  let tiltCenter = null, tiltValue = 0, tiltSeen = 0, tiltAt = 0;

  function resetTiltCenter() {
    tiltCenter = null; tiltValue = 0; tiltSeen = 0; tiltAt = 0;
  }
  function deviceLateral(e) {
    const so = window.screen && window.screen.orientation;
    let a = so && Number.isFinite(so.angle) ? so.angle : Number(window.orientation || 0);
    a = ((a % 360) + 360) % 360;
    if (a === 90) return Number.isFinite(e.beta) ? e.beta : null;
    if (a === 270) return Number.isFinite(e.beta) ? -e.beta : null;
    if (a === 180) return Number.isFinite(e.gamma) ? -e.gamma : null;
    return Number.isFinite(e.gamma) ? e.gamma : null;
  }
  function onOrientation(e) {
    if (!tiltOn || mode !== "drive") return;
    const raw = deviceLateral(e);
    if (!Number.isFinite(raw)) return;
    const now = performance.now();
    if (tiltCenter == null) {
      tiltCenter = raw; tiltValue = 0; tiltSeen = now; tiltAt = now;
      return;
    }
    let d = raw - tiltCenter;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    const n0 = Math.max(0, Math.min(1, (Math.abs(d) - TILT_DEAD) / (TILT_FULL - TILT_DEAD)));
    const eased = n0 * n0 * (3 - 2 * n0);
    // Vehicle steering uses +left / -right. Positive device lateral is right.
    const target = -Math.sign(d) * eased * TILT_MAX;
    const dt = Math.max(1 / 120, Math.min(0.1, (now - (tiltAt || now - 16)) / 1000));
    tiltValue += (target - tiltValue) * (1 - Math.exp(-TILT_RESPONSE * dt));
    tiltSeen = tiltAt = now;
  }
  function paintTiltButton() {
    if (!btnWrap) return;
    const b = btnWrap.querySelector("#tvTilt");
    if (!b) return;
    b.textContent = tiltBusy ? "TILT…" : (tiltOn ? "TILT ON" : "TILT OFF");
    b.classList.toggle("tilt-on", tiltOn);
    b.setAttribute("aria-pressed", tiltOn ? "true" : "false");
  }
  async function setTilt(want) {
    want = !!want;
    if (tiltBusy || want === tiltOn) return tiltOn;
    if (!want) {
      tiltOn = false; resetTiltCenter(); paintTiltButton();
      return false;
    }
    tiltBusy = true; paintTiltButton();
    try {
      const DOE = window.DeviceOrientationEvent;
      if (!DOE) {
        if (CBZ.city && CBZ.city.note) CBZ.city.note("Tilt steering needs an HTTPS game link on this device.", 2.6);
        return false;
      }
      if (typeof DOE.requestPermission === "function") {
        const permission = await DOE.requestPermission();
        if (permission !== "granted") {
          if (CBZ.city && CBZ.city.note) CBZ.city.note("Tilt steering needs Motion & Orientation access.", 2.4);
          return false;
        }
      }
      if (!tiltListening) {
        window.addEventListener("deviceorientation", onOrientation, true);
        tiltListening = true;
      }
      tiltOn = true; resetTiltCenter();
      return true;
    } catch (err) {
      if (CBZ.city && CBZ.city.note) CBZ.city.note("Tilt steering was not available.", 2.0);
      return false;
    } finally {
      tiltBusy = false; paintTiltButton();
    }
  }

  // ---- DOM -------------------------------------------------------------------
  function pill(id, label, cls) {
    return '<button type="button" id="' + id + '" class="tvbtn ' + (cls || "") + '">' + label + "</button>";
  }
  // a pedal: the same button, pedal-shaped (css/mobile.css .tv-pedal), the word at its heel
  function pedal(id, label, cls) {
    return '<button type="button" id="' + id + '" class="tvbtn tv-pedal ' + cls + '" aria-label="' + label + '"><span>' + label + "</span></button>";
  }
  // The aux rail's LOOK is entirely the existing .tvbtn / .tv-sm / .tv-big /
  // .tv-go / .tv-warn vocabulary — nothing new is styled. Only its POSITION is
  // new, and it is one rule: a second column standing in the dial's own
  // footprint (the dial is 128 px tall at bottom:4, so bottom:142 clears it)
  // growing upward, so the primary thumb column never gets a seventh button.
  function auxCss() {
    if (document.getElementById("tvAuxCss")) return;
    const s = document.createElement("style");
    s.id = "tvAuxCss";
    s.textContent =
      "#tveh #tvAux{position:absolute;right:140px;bottom:142px;display:flex;" +
      "flex-direction:column-reverse;align-items:flex-end;gap:8px;}" +
      "#tveh #tvAux .tvbtn{min-width:96px;}" +
      /* SHARK SIM (.tv-shark on #tveh, see layout()): FIRE and JUMP are off
         the glass in this mode (systems/touch.js), so their corner thumb
         spots are empty — and that corner is exactly where the owner wants
         DIVE/RISE (2026-08-29: "they should be where the attack and jump
         buttons were"). #tveh sits at right:14/bottom:18 (+safe area) and
         #tbtns at right:16/bottom:22, so right:2/bottom:4 inside the layer
         lands the rail on the on-foot cluster's own corner. Column-reverse
         already puts DIVE (first) at the bottom where FIRE was, RISE above
         it where JUMP was; the sizes are FIRE's 84 and JUMP's 72, round,
         same 12px gap as #tbtns. */
      "#tveh.tv-shark #tvAux{right:2px;bottom:4px;align-items:center;gap:12px;}" +
      "#tveh.tv-shark #tvAux .tvbtn{width:84px;height:84px;min-width:84px;min-height:84px;" +
      "border-radius:50%;padding:0;font-size:15px;}" +
      "#tveh.tv-shark #tvAux #tvMRise{width:72px;height:72px;min-width:72px;min-height:72px;font-size:13px;}" +
      "@media (max-width:820px){#tveh #tvAux{right:118px;bottom:120px;}" +
      "#tveh #tvAux .tvbtn{min-width:86px;min-height:42px;font-size:13px;}" +
      // ..and the small-screen sizes track .tbtn's own shrink (mobile.css
      // takes .tbig to 70 and .tjump to 58 on phones)
      "#tveh.tv-shark #tvAux{right:2px;bottom:4px;}" +
      "#tveh.tv-shark #tvAux .tvbtn{width:70px;height:70px;min-width:70px;min-height:70px;font-size:13px;}" +
      "#tveh.tv-shark #tvAux #tvMRise{width:58px;height:58px;min-width:58px;min-height:58px;font-size:11.5px;}}";
    document.head.appendChild(s);
  }
  function build() {
    if (root) return;
    auxCss();
    root = document.createElement("div");
    root.id = "tveh";
    root.innerHTML =
      '<canvas id="tvDial" width="256" height="256"></canvas>' +
      '<div id="tvAux"></div>' +
      '<div id="tvBtns"></div>';
    document.body.appendChild(root);
    dial = root.querySelector("#tvDial");
    dialCtx = dial.getContext("2d");
    btnWrap = root.querySelector("#tvBtns");
    auxWrap = root.querySelector("#tvAux");
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
    let touchAt = -1e9;   // suppress the compatibility mousedown after a real tap
    el.addEventListener("touchstart", (e) => {
      e.preventDefault(); touchAt = performance.now(); el.classList.add("on");
    }, { passive: false });
    el.addEventListener("touchend", (e) => {
      e.preventDefault(); touchAt = performance.now(); el.classList.remove("on"); fn();
    }, { passive: false });
    el.addEventListener("touchcancel", () => el.classList.remove("on"), { passive: false });
    el.addEventListener("mousedown", (e) => {
      e.preventDefault(); if (performance.now() - touchAt < 700) return; fn();
    });
  }
  // press-and-hold that drives a callback instead of a key (camera hooks, the
  // bomb release, the bomb camera). Its release is REGISTERED so the layer's
  // stale-hold sweeper can drop it on blur — a callback hold is exactly as
  // capable of surviving a swallowed touchend as a key hold, and a latched
  // BOMB would keep walking a carpet run across the city after you alt-tabbed.
  function holdFn(el, fn) {
    let down = false;
    const dn = (e) => { e.preventDefault(); if (down) return; down = true; el.classList.add("on"); fn(true); };
    const up = (e) => { if (e && e.preventDefault) e.preventDefault(); if (!down) return; down = false; el.classList.remove("on"); fn(false); };
    el.addEventListener("touchstart", dn, { passive: false });
    el.addEventListener("touchend", up, { passive: false });
    el.addEventListener("touchcancel", up, { passive: false });
    el.addEventListener("mousedown", dn); el.addEventListener("mouseup", up);
    el.addEventListener("mouseleave", up);
    heldFns.push(function () { up(null); });
  }
  function clearHeld() {
    for (const k in held) { if (held[k]) { held[k] = false; if (CBZ.keys) CBZ.keys[k] = false; } }
    // Release, but do NOT forget: after a blur the buttons still exist and must
    // stay sweepable. Only layout() — which replaces the DOM outright — drops
    // the list, and it does that itself.
    for (let i = 0; i < heldFns.length; i++) { try { heldFns[i](); } catch (e) {} }
  }
  // Losing the page mid-hold (app switch, phone lock, edge swipe) can swallow
  // a touchend — BRAKE/UP/THR would stay latched through the refocus. Drop
  // every held key + lit button the moment the page leaves the foreground.
  // Desktop never builds this layer (root stays null), so it is untouched.
  function releaseAllHeld() {
    resetTiltCenter();   // resume calibrates from the iPad's new held angle
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

  /* THE DISASTER SWIMMER HAS NO DIAL (owner, 2026-08-16: "when swimming in nat
     disaster I don't want that meter thing").

     Survival mode already prints the air tank as a BAR: systems/survivalhud.js
     turns the STAMINA bar blue-then-red and feeds it the same P.breath the
     gauge was reading, so the round instrument was a second copy of one number,
     parked over the middle of the water. It stands down there.

     CITY swimming keeps it, deliberately — nothing else in the city HUD reads
     out breath, so on a phone the dial is the ONLY way to know how much air is
     left, and deleting it outright would take that away from a mode the owner
     was not talking about. */
  const survSwim = () => !!(CBZ.game && CBZ.islandModeOn(CBZ.game.mode));
  function dialOff(next) { return next === "mount" || (next === "swim" && survSwim()); }
  function setDialOff(off) {
    if (!dial) return;
    const want = off ? "none" : "";
    if (dial.style.display !== want) dial.style.display = want;
  }

  function layout(next) {
    mode = next;
    // SHARK SIM wears its own rail dress (see auxCss): DIVE/RISE stand in the
    // empty FIRE/JUMP corner as round thumb buttons. Class, not a second
    // layout — the pills, their order and their handlers are identical.
    if (root) root.classList.toggle("tv-shark", next === "mount" && CBZ.game.mode === "sharksim");
    clearHeld();
    heldFns.length = 0;          // the DOM these released is about to be replaced
    if (!btnWrap) return;
    btnWrap.className = next === "drive" ? "tv-car" : "";
    if (auxWrap) { auxWrap.innerHTML = ""; lastPay = ""; lastAuxT = 0; }
    if (!next) { btnWrap.innerHTML = ""; ammoEl = null; resetTiltCenter(); setDialOff(false); return; }
    // #tvBtns is column-REVERSE: the FIRST button here sits at the BOTTOM,
    // nearest the resting thumb — so the big primary hold goes first.
    const FIRE_BTN = '<button type="button" id="tvFire" class="tvbtn tv-fire" style="display:none">' + FIRE_SVG + '<span id="tvAmmo" class="tvAmmo"></span></button>';
    // VIEW swaps the cockpit/chase camera. Feature-detected the same way LOOK
    // BACK is, so a build without the cockpit files simply never shows it.
    // VIEW swaps the seated/chase camera. It is the SAME pill for a cockpit
    // and for a car's driver's seat — one verb, one button, the context picks
    // the hook (see the tvView handler) — because a thumb should not have to
    // learn that an aeroplane's inside view is a different button from a car's.
    const VIEW_BTN = pill("tvView", "VIEW", "tv-sm");
    // SEAT is the thumb's half of [G]. It is a small utility pill in the seat
    // you drive from and a big primary one in the seat you ride in, because in
    // the passenger seat taking the wheel back IS the main verb.
    const SEAT_BTN = paxOn() ? pill("tvSeat", "SEAT", "tv-sm") : "";
    let html = "";
    if (next === "pax") {
      // The door is systems/seat_exit.js's #tExit (it wears Jump at speed).
      html = pill("tvSeat", "TAKE THE WHEEL", "tv-big tv-go") + VIEW_BTN;
    } else if (next === "drive") {
      html =
        '<div class="tv-car-steer">' +
          pill("tvLeft", "LEFT", "tv-big tv-steer") + pill("tvRight", "RIGHT", "tv-big tv-steer") +
        "</div>" +
        // THE PEDALS (from the Bullring race page; owner 2026-09-29: "I like the
        // gas and brake, bring that into the real game"): a tall ridged GAS
        // under the resting right thumb, a shorter BRAKE inboard of it
        '<div class="tv-car-pedals">' +
          pedal("tvCarBrake", "BRAKE", "tv-brake") + pedal("tvGas", "GAS", "tv-gas") +
        "</div>" +
        '<div class="tv-car-utils">' +
          pill("tvTilt", "TILT OFF", "tv-sm tv-tilt") + SEAT_BTN + VIEW_BTN +
        "</div>" +
        // THE WINDOW: shown by the watcher only in the seat view with a gun in
        // hand (city/view.js CAR_FP_LEAN). Hold = lean out and fire.
        FIRE_BTN;
      resetTiltCenter();
    } else if (next === "boat") {
      // Boats keep the exact joystick helm the owner likes. ASTERN is the
      // water_helm crash-stop (it rides CTRL now — Space became the jump-key
      // get-up, and a hold pill on Space would stand a thumb up mid-stop).
      // Getting up onto your own deck is the one #tExit (systems/seat_exit.js,
      // city/boatwalk.js's boatStandUp). VIEW joined the row when hulls learned
      // first person ([V] — city/view.js helm eye).
      html = pill("tvBrake", "ASTERN", "tv-big tv-warn") + VIEW_BTN;
    } else if (next === "armor") {
      // Only an actually armed hull gets FIRE. Tanks aim through the look drag;
      // Patriots use the shared full-map target and launch through the same verb.
      html = isArmedArmor() ? FIRE_BTN : "";
    } else if (next === "heli") {
      html = pill("tvUp", "UP", "tv-big tv-go") + pill("tvDown", "DOWN", "tv-big") +
        FIRE_BTN + VIEW_BTN;
    } else if (next === "wing") {
      html = pill("tvThrUp", "THR +", "tv-big tv-go") + pill("tvThrDn", "THR −", "tv-big") +
        FIRE_BTN + VIEW_BTN;
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
    // the boat's astern pill — CTRL, the same key water_helm's crash-stop
    // polls on a keyboard (never Space: that key stands the driver up now)
    if (q("tvBrake")) holdBtn(q("tvBrake"), "control");
    if (q("tvSeat")) tapBtn(q("tvSeat"), () => { if (CBZ.citySeatShift) CBZ.citySeatShift(); });
    if (q("tvLeft")) holdBtn(q("tvLeft"), "a");
    if (q("tvRight")) holdBtn(q("tvRight"), "d");
    if (q("tvGas")) holdBtn(q("tvGas"), "w");
    if (q("tvCarBrake")) holdBtn(q("tvCarBrake"), "s");
    if (q("tvTilt")) tapBtn(q("tvTilt"), () => { setTilt(!tiltOn); });
    if (q("tvUp")) holdBtn(q("tvUp"), " ");
    if (q("tvDown")) holdBtn(q("tvDown"), "control");
    // throttle reuses the heli's power grammar (Space up / Ctrl down) so the
    // stick is free to be the pitch+roll joystick (FLIGHT_CONTROLS_V2).
    if (q("tvThrUp")) holdBtn(q("tvThrUp"), " ");
    if (q("tvThrDn")) holdBtn(q("tvThrDn"), "control");
    if (q("tvFire")) {
      if (mode === "drive") holdFn(q("tvFire"), function (down) {
        if (CBZ.carLeanOut) CBZ.carLeanOut(down);
        if (CBZ.fpsFire) CBZ.fpsFire(!!down);
      });
      else tapBtn(q("tvFire"), doFire);
    }
    // ONE VERB, TWO SEATS. An aircraft's inside view is cockpit_view.js's; a
    // car's is city/view.js's. The pill asks the aircraft owner first (it is
    // the one that refuses unless P._aircraft is set, exactly as the [V] key
    // listeners divide the same job) and falls through to the car.
    if (q("tvView")) tapBtn(q("tvView"), () => {
      if (CBZ.player && CBZ.player._aircraft) { if (CBZ.cockpitToggleView) CBZ.cockpitToggleView(); return; }
      if (CBZ.carFpToggle) CBZ.carFpToggle();
    });
    if (q("tvChute")) tapBtn(q("tvChute"), () => {
      const st = CBZ.cityChuteState ? CBZ.cityChuteState() : null;
      if (st && st.phase === "canopy") { if (CBZ.cityChuteCut) CBZ.cityChuteCut(); }
      else if (CBZ.cityChuteDeploy) CBZ.cityChuteDeploy();
    });
    if (q("tvRise")) holdBtn(q("tvRise"), " ");
    if (q("tvDive")) holdBtn(q("tvDive"), "control");
    ammoEl = btnWrap.querySelector("#tvAmmo");
    paintTiltButton();
    layoutAux(next);
    // The dial paints per CONTEXT and a mount publishes no speed, so rather than
    // leave the previous context's needle frozen on screen (a gauge that lies is
    // worse than no gauge) the instrument stands down for the saddle — and for
    // the survival swimmer (see dialOff).
    setDialOff(dialOff(next));
    lastSpeed = -1; lastSub = "";   // force a dial repaint for the new context
  }

  // ---- the AUX RAIL: payload / weapons / camera, above the dial -------------
  // Everything here is built for the CONTEXT and then shown or hidden per frame
  // by the watcher below — the same merge-order-safe pattern LOOK BACK and VIEW
  // already use, which is what lets a B-2 that finishes initialising a beat
  // after boarding still get its bay controls without a second layout pass.
  function layoutAux(next) {
    if (!auxWrap || !airV2()) return;
    const air = next === "heli" || next === "wing";
    const drv = next === "drive" || next === "armor";
    // A boat builds an aux rail for exactly ONE pill (DETONATE, below) — the
    // rest of its layout is deliberately untouched, so it still gets no
    // RECENTER and keeps the joystick helm exactly as it was.
    const boat = next === "boat";
    if (!air && !drv && !boat && next !== "mount") return;
    let h = "";
    // A MOUNT IS NOT A VEHICLE and must not be dressed as one — see the mount
    // branch in the watcher. It gets ONE pill, in the aux rail, well clear of
    // the on-foot cluster, because everything else about riding (move, look,
    // jump, aim, FIRE) is still the on-foot layer's job and stays on screen.
    if (next === "mount") {
      // Order matters in a column-reverse rail: DIVE sits nearest the thumb,
      // RISE directly above it (the swim context's own pairing). Getting off
      // is the one #tExit (systems/seat_exit.js), top centre, well away from
      // the thumb that is diving three metres under.
      if (mountDive()) {
        h += pill("tvMDive", "DIVE", "tv-big");
        h += pill("tvMRise", "RISE", "tv-big tv-go");
      }
      // In Shark Sim there is no rider to dismount — you ARE the shark, the
      // human is hidden, and shark_sim.js force-remounts every frame, so the
      // pill was a button that did nothing but flicker. No pill, no lie.
    }
    if (air) {
      // Bottom-up (column-reverse): the release sits nearest the thumb, its own
      // readout directly above it.
      h += pill("tvBomb", "BOMB", "tv-big tv-warn");
      h += pill("tvPay", "PAYLOAD", "tv-sm");
    }
    // (the DETONATE pill is gone: the detonator is a held object now, and the
    // phone keeps its own DETONATE for the getaway boom from a car)
    auxWrap.innerHTML = h;
    const q = (id) => auxWrap.querySelector("#" + id);
    // BOMB — hold, not tap: strategicBombHold IS the [B] state machine (tap
    // releases one, past 0.4 s it becomes a carpet run), so the thumb inherits
    // the whole arc instead of re-implementing half of it.
    // The mount's vertical axis. Two paths on purpose and BOTH are honest: the
    // key hold is the same one every other pill in this file uses (the mount
    // reads Space/Ctrl off CBZ.keys exactly as the swimmer does), and the named
    // seam is city/wildlife_tame.js's own expiring hold — so if a touchend is
    // ever swallowed, the 0.25 s expiry stands the axis down even though the
    // key would still be pumped. Belt and braces, no second implementation.
    if (q("tvMDive")) holdFn(q("tvMDive"), (down) => {
      held["control"] = down; if (!down) { const k = CBZ.keys; if (k) k["control"] = false; }
      if (CBZ.cityAquaticMountVertical) CBZ.cityAquaticMountVertical(down ? -1 : 0);
    });
    if (q("tvMRise")) holdFn(q("tvMRise"), (down) => {
      held[" "] = down; if (!down) { const k = CBZ.keys; if (k) k[" "] = false; }
      if (CBZ.cityAquaticMountVertical) CBZ.cityAquaticMountVertical(down ? 1 : 0);
    });
    if (q("tvBomb")) holdFn(q("tvBomb"), (down) => { if (CBZ.strategicBombHold) CBZ.strategicBombHold(down); });
    if (q("tvPay")) tapBtn(q("tvPay"), () => {
      if (CBZ.strategicPayloadCycle) CBZ.strategicPayloadCycle();
      lastPay = "";                      // repaint the label on the next tick
    });
    // DETONATE — a HOLD on the module's own logical key (touch.js's
    // touchKeyHold), because [B] in a seat is already exactly this verb:
    // explosives.js refuses the plant half while driving and detonates past
    // 0.5 s, so the pill inherits the arm delay — the thing that makes a
    // mis-brush of the glass NOT send the whole street up — instead of
    // reimplementing a faster, more dangerous copy of it. holdFn registers
    // the release, so blur/app-switch lands the keyup a lost touchend never
    // sends and the hold can never wedge armed.
  }

  // Is the touch vehicle layer currently OWNING the bottom-right instrument
  // corner? city/carcluster.js asks, so the desktop cluster can stand down to
  // a compact strip instead of stacking a second speedometer on top of this
  // dial. Degrade-safe on both sides: no touch layer → the answer is false and
  // the cluster draws exactly as it always did.
  CBZ.touchVehicleActive = function () { return !!(on() && mode); };
  CBZ.touchVehicleMode = function () { return mode || ""; };
  CBZ.touchCarTiltSet = setTilt;
  CBZ.touchCarTiltState = function () {
    return {
      enabled: tiltOn, calibrated: tiltCenter != null,
      value: tiltValue, sampleAgeMs: tiltSeen ? performance.now() - tiltSeen : null,
      deadDegrees: TILT_DEAD, fullDegrees: TILT_FULL, maxSteer: TILT_MAX,
    };
  };
  // Manual LEFT/RIGHT always wins. Otherwise a fresh tilt sample feeds the same
  // steering smoother as keyboard/buttons; null means "use ordinary A/D".
  CBZ.touchCarSteerValue = function (car) {
    const P = CBZ.player, k = CBZ.keys || {};
    if (!on() || mode !== "drive" || !tiltOn || !car || !P || P._vehicle !== car) return null;
    if (k["a"] || k["d"] || !tiltSeen || performance.now() - tiltSeen > 800) return null;
    return tiltValue;
  };
  CBZ.touchVehicleAudit = function () {
    const ids = btnWrap ? Array.from(btnWrap.querySelectorAll(".tvbtn")).map((b) => b.id) : [];
    const auxIds = auxWrap ? Array.from(auxWrap.querySelectorAll(".tvbtn")).map((b) => b.id) : [];
    return {
      mode: mode || "", joystick: mode !== "drive", controls: ids, auxControls: auxIds,
      carControls: ["tvLeft", "tvRight", "tvGas", "tvCarBrake"].every((id) => ids.indexOf(id) >= 0),
      tilt: CBZ.touchCarTiltState(),
    };
  };

  function marine(car) {
    if (CBZ.isMarineHull) return !!CBZ.isMarineHull(car);
    if (!car) return false;
    if (car._playerCarFeel) return !!car._playerCarFeel.marine;
    return !!(car._hullSpec || (car.model && car.model.body === "boat"));
  }
  // city/passengerseat.js, feature-detected end to end: without that file the
  // SEAT pill is never built and this layer is byte-identical to before.
  const paxOn = () => !!(CBZ.citySeatShift && (!CBZ.CONFIG || CBZ.CONFIG.PASSENGER_SEAT_V1 !== false));
  function rideMode(P) {
    if (!P) return "";
    if (P._aircraft) return P._aircraft.kind === "heli" ? "heli" : "wing";
    /* RIDING SHOTGUN IS ITS OWN CONTEXT. A thumb column with GAS, BRAKE, LEFT
       and RIGHT on it while nobody is driving is four buttons that lie, and
       hiding them one by one leaves a car layout with a hole in it. One
       context, three honest verbs: take the wheel, jump out, look back. Same
       for a hull — you are not at the helm, so there is no ASTERN. */
    if (paxOn() && CBZ.cityPaxRiding && CBZ.cityPaxRiding()) return "pax";
    if (P.driving && P._vehicle) return marine(P._vehicle) ? "boat" : "drive";
    return "";
  }
  // Pure classification hook: runtime audits can prove car/boat/heli/wing
  // routing without fabricating a half-built aircraft in the live world.
  CBZ.touchVehicleModeFor = rideMode;

  // ARMOR reads (city/militaryvehicles.js). Feature-detected on BOTH sides: a
  // build without the seam simply never offers the fire button and never grows
  // an armor context, and the pre-seam behaviour returns exactly.
  const armorOn = () => !!(airV2() && CBZ.cityArmorActive && CBZ.cityArmorActive());
  /* AN AQUATIC MOUNT IS A THIRD KIND OF SWIMMER. The "swim" context above gives
     the human swimmer DIVE/RISE (city/swim.js's Space/Ctrl grammar on two
     pills); the "mount" context gives a saddle its aux rail. Ride a SHARK
     and you are in the water with a vertical axis and neither of those covered
     it — owner, 2026-08-25: "in nat disaster world on touch when in the water
     you get rise and dive … in shark sim there's just water surface and you
     can't really dive". Same two verbs, same keys, same hold plumbing; they
     land in the AUX RAIL rather than the thumb column because a mount keeps the
     on-foot cluster (FIRE is the mounted bite — systems/touch.js routes it to
     CBZ.cityMountedAnimalAttack) and must not have it covered up.
     TOUCH_MOUNT_DIVE=0 → the saddle gets no rail (getting off is #tExit). */
  const mountDive = () => !!(airV2() && (!CBZ.CONFIG || CBZ.CONFIG.TOUCH_MOUNT_DIVE !== false) &&
    CBZ.cityAquaticMountRiding && CBZ.cityAquaticMountRiding());
  function armorRec() { return CBZ.cityArmorRec ? CBZ.cityArmorRec() : null; }
  function isArmedArmor() {
    if (CBZ.cityArmorCanFire) return !!CBZ.cityArmorCanFire();
    const r = armorRec(); return !!(r && (r.kind === "tank" || r.kind === "patriot") && CBZ.cityArmorFire);
  }

  function doFire() {
    if (mode === "armor") { if (CBZ.cityArmorFire) CBZ.cityArmorFire(); return; }
    if (CBZ.cityAircraftFireMissile) CBZ.cityAircraftFireMissile();
  }

  // ---- the dial (canvas 2D, retina-doubled) ---------------------------------
  // A real racing dial: 270° sweep, tick ring, needle, big centered speed in
  // whatever unit CBZ.speedRead serves (MPH by default).
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

  // ---- aux rail refresh -----------------------------------------------------
  // Show/hide by what the world can actually DO right now, and let each label
  // carry its own state. Nothing here is a second source of truth: the payload
  // name and count come from strategic.js's own readout (the exact function its
  // desktop strip reads).
  function show(el, want) {
    if (!el) return;
    const v = want ? "" : "none";
    if (el.style.display !== v) el.style.display = v;
  }
  function refreshAux() {
    if (!auxWrap || !airV2()) return;
    // ~11 Hz, the dial's own budget. strategicPayloadReadout builds a small
    // object and a string per call; at 60 Hz that is 60 throwaway objects a
    // second to answer a question whose answer changes on a button press.
    const nowA = performance.now();
    if (nowA - lastAuxT < 90) return;
    lastAuxT = nowA;
    const air = mode === "heli" || mode === "wing";
    // THE BOMBER IS THE CONTEXT, not the aircraft. Every other airframe in the
    // game — the gunship, the airliner, the Raptor, Fort Brandt's heavy bomber
    // — has no bay at all (strategic.js says so in as many words when [B] is
    // pressed in one), so these three controls exist only while the B-2 is the
    // thing you are flying.
    const pay = (air && CBZ.strategicPayloadReadout) ? CBZ.strategicPayloadReadout() : null;
    const b2 = !!(pay && pay.b2);
    show(auxWrap.querySelector("#tvBomb"), b2 && !!CBZ.strategicBombHold);
    show(auxWrap.querySelector("#tvPay"), b2 && !!CBZ.strategicPayloadCycle);
    const pb = auxWrap.querySelector("#tvPay");
    if (pb && b2) {
      // The pill IS the payload strip on touch: mobile.css hides
      // #cityFlightHud under body.tveh-on, so without this label the switch
      // would have neither a name nor a count — the exact "there's no way to
      // change payload" complaint, one layer down.
      //
      // AND IT IS THE REFUSAL CHANNEL. strategic.js answers a refused release
      // with payloadFlash("TOO LOW — CLIMB" / "BAY EMPTY") because its own
      // comment says the matching note() is deleted upstream by mode.js — so
      // on touch, where the strip that carries the flash is display:none, a
      // refused BOMB was completely silent. It reads as a broken button, which
      // is the exact failure that comment was written to prevent. The flash
      // takes the pill for its duration; `count` carries the rest.
      const flash = (pay.flash > 0 && pay.tag) ? String(pay.tag) : "";
      const lab = flash || ((pay.short || "PAYLOAD") + " ×" + (pay.count | 0));
      if (lab !== lastPay) { lastPay = lab; pb.textContent = lab; }
      pb.classList.toggle("tv-warn", !!flash || (pay.count | 0) <= 0);
    }
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
    else if (active) {
      next = rideMode(P);
      // Armor is intentionally outside rideMode: its hull is module-local and
      // exposes no P._vehicle, so the newer car/boat classifier remains intact.
      if (!next && armorOn()) next = "armor";
      // In the water the thumb needs the vertical axis (dive/rise). Same
      // precedence slot as a vehicle: the swim owns the body right now.
      if (!next && CBZ.citySwimming && CBZ.citySwimming()) next = "swim";
      // Riding retains the on-foot combat cluster and adds only a dismount pill.
      if (!next && airV2() && P._rideScale > 1 && CBZ.cityDismount) next = "mount";
    }
    if (!root && next) build();
    if (!root) return;
    if (next !== mode) {
      layout(next);
      root.style.display = next ? "block" : "none";
      // "tveh-on" HIDES THE ON-FOOT CLUSTER, and that is right for everything
      // you climb into and wrong for a saddle: you can still shoot, jump, aim
      // and swap weapons from horseback (fpsmode's shoulder owner only bails on
      // p.driving, which riding never sets), so claiming the corner would DELETE
      // combat from a mounted player. The mount context therefore lives entirely
      // in the aux rail and leaves #tbtns exactly where it is.
      document.body.classList.toggle("tveh-on", !!next && next !== "mount");
      document.body.classList.toggle("tveh-car", next === "drive");
      /* A PASSENGER HAS NO STICK EITHER. A joystick in the shotgun seat moves
         nothing — the same lie the GAS pedal would be — so the stick stands
         down. Its own class rather than `.tveh-car`, because that class ALSO
         re-places the dial for the car's two-column pedal grid and the
         passenger set is an ordinary column. */
      document.body.classList.toggle("tveh-pax", next === "pax");
    }
    if (!next) return;

    refreshAux();
    // VIEW appears only once the file that owns THIS context's inside view is
    // present (merge-order safety — the button may
    // assume its API exists). In a car the pill also stands down when the car
    // has no cabin to sit in: a bike or a boat gets no button rather than a
    // button that refuses.
    const vb = btnWrap.querySelector("#tvView");
    if (vb) {
      const car = mode === "drive";
      const ok = car
        ? !!(CBZ.carFpToggle && CBZ.carCabinInfo && CBZ.player && CBZ.player._vehicle &&
             CBZ.carCabinInfo(CBZ.player._vehicle))
        : !!CBZ.cockpitToggleView;
      const want = ok ? "" : "none";
      if (vb.style.display !== want) vb.style.display = want;
      if (ok && car) vb.classList.toggle("on", !!(CBZ.carFpActive && CBZ.carFpActive()));
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
    } else if (mode === "drive") {
      // the seat view with a firearm: the window is a firing position
      const fb = btnWrap.querySelector("#tvFire");
      if (fb) {
        const w = CBZ.equippedWeapon ? CBZ.equippedWeapon() : null;
        const gun = !!(w && !w.melee && !(CBZ.game && CBZ.game.cityMeleeWeapon));
        show(fb, !!(CBZ.carFpActive && CBZ.carFpActive() && gun));
      }
      if (ammoEl) ammoEl.style.display = "none";
    } else if (mode === "armor") {
      // The main gun carries no magazine (militaryvehicles.js gates it on a
      // 0.85 s fireCD, not on rounds), so the ammo badge is HIDDEN rather than
      // shown empty — a blank counter is a claim that you have none.
      const fb = btnWrap.querySelector("#tvFire");
      if (fb) show(fb, isArmedArmor());
      if (ammoEl) ammoEl.style.display = "none";
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
    } else if (mode === "drive" || mode === "boat") {
      /* THE TOUCH DIAL READS THE SAME SPEEDOMETER AS EVERY OTHER GAUGE.
         OWNER: "Touch still shows km/hr." It did, and it was the exact fault
         vehicles.js's CBZ.speedRead was built to end (owner 2026-08-15, "the
         normal cars show km/h... not mph"): this file had typed its own
         private conversion — v * 4.8, derived from hud.js's since-retracted
         guessed x3 — so the dial was mislabelled AND overstated even honest
         km/h by 33% (a metre-unit world is x3.6 km/h, x2.237 mph). Every
         desktop gauge was converted to the one shared read in that fix; the
         touch layer was the site everybody forgot. It asks now, so the dial
         shows MPH by default and follows ?cfg_CAR_SPEED_UNIT=kmh like the
         instrument cluster does — the two can never disagree again. The cap
         is unit-aware so the needle sweep is identical either way. */
      const car = P._vehicle;
      const read = CBZ.speedRead ? CBZ.speedRead(car && car.v)
        : { n: Math.round(Math.abs((car && car.v) || 0) * 2.2369), unit: "MPH" };
      if (read.n !== lastSpeed || read.unit !== lastSub) {
        lastSpeed = read.n; lastSub = read.unit;
        drawDial(read.n, read.unit === "KM/H" ? 260 : 160, read.unit, "", false);
      }
    } else if (mode === "armor") {
      // Same instrument, honest SCALE: armorTuning tops a tank at 14 m/s and a
      // truck at 20 (≈31/45 mph, 50/72 km/h), so the car dial's cap would pin
      // the needle in the first eighth and read as a broken gauge. The lower
      // cap lets a tank actually sweep. The sub-line names the hull, which is
      // also how you can tell at a glance why there is (or is not) a FIRE
      // button. Unit and number come from the same shared read as the cars.
      const rec = armorRec();
      const read = CBZ.speedRead ? CBZ.speedRead(rec && rec.v)
        : { n: Math.round(Math.abs((rec && rec.v) || 0) * 2.2369), unit: "MPH" };
      const sub = rec && rec.kind === "tank" ? "TANK" : rec && rec.kind === "patriot" ? "PATRIOT" : "ARMOR";
      if (read.n !== lastSpeed || sub !== lastSub) {
        lastSpeed = read.n; lastSub = sub;
        drawDial(read.n, read.unit === "KM/H" ? 120 : 75, read.unit, sub, false);
      }
    } else if (mode === "swim") {
      // Survival's swimmer reads its air off the bar, not off a gauge. Re-checked
      // here as well as at layout() because the match mode can change under a
      // context that never re-lays out.
      const off = survSwim();
      setDialOff(off);
      if (off) return;
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

  /* ---- THE VERB LEDGER (systems/touch.js owns CBZ.touchAudit) ---------------
     Declared and stamped at LOAD, so the audit reports what this layer is
     WIRED with rather than what a session happened to render. A row whose
     `hook` is absent counts as noHook, never as covered — which is what makes
     the degrade-safe feature-detects above readable as numbers instead of
     hopes. The B-2 rows are the whole reason this ledger exists: those four
     seams sat published and uncalled for the bomber's entire life.          */
  if (CBZ.touchVerb) {
    const V = CBZ.touchVerb, W = CBZ.touchVerbWired;
    V("drive-steer", { ctx: "drive", key: "A/D", hook: null }); W("drive-steer", "#tvLeft/#tvRight");
    V("drive-throttle", { ctx: "drive", key: "W", hook: null }); W("drive-throttle", "#tvGas");
    V("drive-brake", { ctx: "drive", key: "S", hook: null }); W("drive-brake", "#tvCarBrake");
    V("boat-astern", { ctx: "boat", key: "Space", hook: null }); W("boat-astern", "#tvBrake");
    V("vehicle-exit", { ctx: "drive/air/boat/pax", key: "F/E", hook: "seatExit" }); W("vehicle-exit", "#tExit");
    V("cockpit-view", { ctx: "air", key: "V", hook: "cockpitToggleView" }); W("cockpit-view", "#tvView");
    V("driver-seat", { ctx: "drive", key: "V", hook: "carFpToggle" }); W("driver-seat", "#tvView");
    V("heli-collective", { ctx: "heli", key: "Space/Ctrl", hook: null }); W("heli-collective", "#tvUp/#tvDown");
    V("wing-throttle", { ctx: "wing", key: "Space/Ctrl", hook: null }); W("wing-throttle", "#tvThrUp/#tvThrDn");
    V("air-missile", { ctx: "air", key: "LMB", hook: "cityAircraftFireMissile" }); W("air-missile", "#tvFire");
    V("chute-pull", { ctx: "chute", key: "Space/F", hook: "cityChuteDeploy" }); W("chute-pull", "#tvChute");
    V("chute-cut", { ctx: "chute", key: "Space/F", hook: "cityChuteCut" }); W("chute-cut", "#tvChute");
    V("swim-vertical", { ctx: "swim", key: "Space/Ctrl", hook: null }); W("swim-vertical", "#tvRise/#tvDive");
    V("bomb-release", { ctx: "b2", key: "B tap", hook: "strategicBombHold" }); W("bomb-release", "#tvBomb");
    V("bomb-carpet", { ctx: "b2", key: "B hold", hook: "strategicBombHold" }); W("bomb-carpet", "#tvBomb");
    V("payload-cycle", { ctx: "b2", key: "X", hook: "strategicPayloadCycle" }); W("payload-cycle", "#tvPay");
    V("payload-readout", { ctx: "b2", key: "#cityFlightHud", hook: "strategicPayloadReadout" }); W("payload-readout", "#tvPay label");
    V("armor-exit", { ctx: "armor", key: "E", hook: "seatExit" }); W("armor-exit", "#tExit");
    V("armor-fire", { ctx: "armor", key: "LMB", hook: "cityArmorFire" }); W("armor-fire", "#tvFire");
    V("mount", { ctx: "foot", key: "I / panel", hook: "cityMountAnimal" }); W("mount", "world tap");
    V("dismount", { ctx: "mount", key: "E", hook: "seatExit" }); W("dismount", "#tExit");
    // Declared and deliberately NOT drawn — the reason travels with the row so
    // the skipped list can never quietly absorb a real gap:
    V("hangar-buy", { ctx: "foot", key: "B", skip: "playeraircraft's [B] at a hangar only ever prints the steal-it notice; the F-22 is not buyable and a pill for a refusal is a lie" });
    V("bomb-camera", { ctx: "b2", key: "C hold", skip: "a cinematic, not a control; [C] keeps it" });
    V("air-homing", { ctx: "air", key: "H", skip: "homing is the default; the dumb-fire toggle stays on [H]" });
    V("heli-lateral", { ctx: "heli", key: "Q/E", skip: "bank covers the turn; two more pills were clutter" });
    V("wing-rudder", { ctx: "wing", key: "Q/E", skip: "bank covers the turn; two more pills were clutter" });
    V("armor-turret", { ctx: "armor", key: "mouse", skip: "the turret already tracks cam.yaw, and on touch cam.yaw IS the look drag, aiming the gun is aiming the camera, so a control would be a duplicate axis" });
  }
})();
