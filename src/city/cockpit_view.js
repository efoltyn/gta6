/* ============================================================
   city/cockpit_view.js — THE SEAT. Puts the player's eye where the pilot's
   eye is, keeps the cockpit from being sliced by the world's near plane,
   and gives the head the small physical motions that make a static
   interior read as a moving aircraft.

   FIRST PERSON IS SACRED (owner). Nothing here re-tunes how the existing
   first-person feels. This is an ADDITION: the [V] toggle that view.js
   currently refuses while you're driving now does something when the thing
   you're driving is an aircraft. Same key, same grammar, new place to use it.

   ------------------------------------------------------------------
   1. WHY A SEPARATE RENDER PASS
   ------------------------------------------------------------------
   city/mode.js pushes the camera's near plane out to 0.75 m the moment an
   aircraft climbs past 24 m, and it is right to: a 0.1 m near paired with a
   7 km far throws away so much depth precision that the 0.42 m separation
   between land and sea quantises to one value and the ocean wins over the
   coastline. But a real instrument panel sits ~0.71 m from the pilot's eye
   (the 1947 Armed Forces-NRC design-eye standard, still the number cockpit
   geometry is laid out against) — i.e. INSIDE that near plane. Every metre
   we could gain by moving the panel away is a metre of "this cockpit is
   enormous".

   So the cockpit is drawn the way flight sims and FPS viewmodels have
   always drawn this: a SECOND, tiny pass with its own near/far
   (0.03 / 60 m), after the world pass, with the depth buffer cleared so
   the interior is unconditionally nearest. The cockpit lives in its own
   small THREE.Scene in BODY-LOCAL coordinates and never moves — the
   overlay camera moves inside it exactly as the real camera moves inside
   the world. Two cameras, one shared FOV and aspect, so the canopy frame
   and the horizon behind it can never swim relative to each other.

   Cost: one extra render of ~25 meshes with no shadows, only while you are
   actually sitting in a cockpit. `CBZ.CONFIG.COCKPIT_OVERLAY_PASS=false`
   falls back to drawing the cockpit in the main scene and pulling the near
   plane in — cheaper, correct enough, and the one-line revert.

   ------------------------------------------------------------------
   2. HEAD PHYSICS — small numbers, real sources
   ------------------------------------------------------------------
   FlightGear's cockpit view-movement system parameterises g-induced camera
   displacement in METRES PER G, and its GA default is 0.015. That is the
   right order of magnitude and the reason this feels like weight instead
   of like a camera shake preset: pulling 4 g sinks the pilot about 4.5 cm
   into the seat. Everything below is on that scale — millimetres and
   centimetres, never a swing:

     • g-load sink        the seat takes your weight in a turn or a pull-up
     • acceleration push  you go back into the seat on the throttle
     • look-into-turn     a pilot's head leans into the bank, always
     • ground rumble      ramps in above a taxi threshold, gone once airborne
     • engine / rotor     a helicopter's whole airframe buzzes at rotor rate
     • stall buffet       the one vibration that means something is wrong
     • touchdown jolt     one spring impulse scaled by the sink rate

   ------------------------------------------------------------------
   3. FREE-LOOK COSTS NOTHING NEW
   ------------------------------------------------------------------
   The flight controls already made the mouse pure free-look: A/D banks, Q/E
   is rudder, and playeraircraft.js eases CBZ.cam.yaw back behind the tail
   whenever CBZ.camRecenterSuspended() is false. So the head's yaw is simply
   the angle between where the free-look camera wants to point and where the
   nose points — look around the cockpit and your head turns; stop moving
   the mouse and the existing recenter walks your head forward again on its
   own. No new input, no new state, no new keybinding.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});

  // COCKPIT_OVERLAY_PASS — draw the cockpit interior in its own near-plane
  // pass (see §1). OFF → the cockpit is drawn in the main scene and the
  // camera's near plane is pulled to COCKPIT_NEAR_FALLBACK while seated.
  if (CFG.COCKPIT_OVERLAY_PASS == null) CFG.COCKPIT_OVERLAY_PASS = true;
  // COCKPIT_NEAR_FALLBACK — the near plane used only when the overlay pass
  // is off. 0.28 keeps the panel out of the clip plane while giving up much
  // less depth precision than the 0.1 used on foot.
  if (CFG.COCKPIT_NEAR_FALLBACK == null) CFG.COCKPIT_NEAR_FALLBACK = 0.28;
  // COCKPIT_HEAD_PHYSICS — the g-sink / rumble / buffet motion (§2).
  // OFF → the eye is rigidly bolted to the airframe.
  if (CFG.COCKPIT_HEAD_PHYSICS == null) CFG.COCKPIT_HEAD_PHYSICS = true;
  // COCKPIT_VIEW_DEFAULT — whether boarding an aircraft drops you straight
  // into the seat. OFF by default: the chase camera is the owner's tuned
  // flying view and must stay what you get unless you ask for the cockpit.
  if (CFG.COCKPIT_VIEW_DEFAULT == null) CFG.COCKPIT_VIEW_DEFAULT = false;

  function on() { return CFG.COCKPIT_V1 !== false; }
  function overlayWanted() { return CFG.COCKPIT_OVERLAY_PASS !== false; }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function fin(v, d) { const n = +v; return Number.isFinite(n) ? n : d; }

  // ---- state -------------------------------------------------------------
  let active = false;            // are we currently rendering from the seat
  let want = false;              // the player's standing preference ([V] sticky)
  let rec = null;                // the live cockpit record we're sitting in
  let toldOnce = false;          // one-time discovery hint

  // head motion state
  const head = { y: 0, vy: 0, z: 0, x: 0, yawX: 0, buzz: 0, rumble: 0, t: 0, _g: 0 };
  let lastSpeed = 0, wasGround = true;

  // ---- overlay scene -----------------------------------------------------
  let oScene = null, oCam = null, oSun = null, oAmb = null, wrapped = false;
  const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _e = new THREE.Euler();

  function ensureOverlay() {
    if (oScene) return oScene;
    oScene = new THREE.Scene();
    oScene.name = "cockpit-overlay";
    // The cockpit has its own tiny light rig rather than borrowing the
    // world's: it must stay readable inside a shadowed fuselage at noon and
    // must go properly dark at night so the backlit instruments become the
    // brightest thing in the frame — which is the entire point of a lit
    // panel. Direction is re-aimed every frame from the real sun, expressed
    // in BODY space, so banking really does sweep the sunlight across the
    // coaming.
    oAmb = new THREE.AmbientLight(0xffffff, 0.55);
    oScene.add(oAmb);
    oSun = new THREE.DirectionalLight(0xffffff, 0.75);
    oSun.castShadow = false;
    oSun.position.set(0.4, 1, 0.3);
    oScene.add(oSun);
    oCam = new THREE.PerspectiveCamera(66, 1, 0.03, 60);
    oScene.add(oCam);
    return oScene;
  }

  // Wrap the renderer ONCE, lazily, on first use. Wrapping late means we sit
  // outside core/profile.js's own wrapper if that loaded first and inside it
  // if it did not — either is correct, because we only ever act AFTER the
  // wrapped call returns (no re-entrancy into a live render).
  // The `_cockpitWrapped` marker follows the repo's wrapper-chaining rule:
  // anything that wraps this later must carry it forward.
  function ensureWrap() {
    if (wrapped) return;
    const r = CBZ.renderer;
    if (!r || typeof r.render !== "function") return;
    if (r.render._cockpitWrapped) { wrapped = true; return; }
    const inner = r.render.bind(r);
    const w = function (scene, camera) {
      const out = inner(scene, camera);
      // ONLY chase the main world pass. Offscreen render-target passes
      // (city/cctv.js's camera feed) and any future secondary view must not
      // get a cockpit stamped on top of them.
      if (active && oScene && scene === CBZ.scene && camera === CBZ.camera) {
        let rt = null;
        try { rt = r.getRenderTarget ? r.getRenderTarget() : null; } catch (e) { rt = null; }
        if (!rt) {
          const auto = r.autoClear;
          const shadowAuto = r.shadowMap && r.shadowMap.autoUpdate;
          try {
            if (r.shadowMap) r.shadowMap.autoUpdate = false;
            r.autoClear = false;
            r.clearDepth();                 // the interior is unconditionally nearest
            inner(oScene, oCam);
          } catch (e) { /* never let a cockpit break the frame */ }
          r.autoClear = auto;
          if (r.shadowMap) r.shadowMap.autoUpdate = shadowAuto;
        }
      }
      return out;
    };
    for (const k in r.render) if (k.slice(-7) === "Wrapped") w[k] = r.render[k];   // carry markers forward
    w._cockpitWrapped = true;
    r.render = w;
    wrapped = true;
  }

  // ---- mount / unmount ---------------------------------------------------
  // The cockpit geometry is authored in BODY-LOCAL coordinates, which is
  // exactly what both homes want: at identity inside the overlay scene, or
  // parented to the craft's nose-corrected anchor in the world scene. So
  // moving between them is a re-parent and nothing else — no transform to
  // recompute, no second authoring frame to keep in sync.
  function mount(r) {
    if (!r || !r.root) return;
    if (overlayWanted()) {
      ensureOverlay();
      if (r.root.parent !== oScene) oScene.add(r.root);
      r.root.position.set(0, 0, 0);
      r.root.quaternion.identity();
    } else if (r.anchor && r.root.parent !== r.anchor) {
      r.anchor.add(r.root);
    }
    r.root.visible = true;
    r.visible = true;
    // you are inside the pilot's head — do not also draw him in front of you
    const pilot = r.craft && r.craft.group && r.craft.group.userData && r.craft.group.userData.pilot;
    if (pilot) { r._pilotWas = pilot.visible; pilot.visible = false; }
  }
  function unmount(r) {
    if (!r || !r.root) return;
    r.root.visible = false;
    r.visible = false;
    if (r.anchor && r.root.parent !== r.anchor) r.anchor.add(r.root);
    const pilot = r.craft && r.craft.group && r.craft.group.userData && r.craft.group.userData.pilot;
    if (pilot && r._pilotWas != null) { pilot.visible = r._pilotWas; r._pilotWas = null; }
  }

  // ---- activation --------------------------------------------------------
  function craftNow() {
    const P = CBZ.player;
    if (!P || P.dead) return null;
    return P._aircraft || null;
  }

  function setActive(v) {
    v = !!v && on();
    if (v === active) return active;
    if (!v) { if (rec) unmount(rec); rec = null; active = false; resetHead(); return false; }
    const craft = craftNow();
    if (!craft) return false;
    const r = CBZ.cockpitAttach ? CBZ.cockpitAttach(craft) : null;
    if (!r) return false;
    rec = r; active = true;
    ensureWrap();
    mount(rec);
    resetHead();
    return true;
  }
  function resetHead() {
    head.y = head.vy = head.z = head.x = head.yawX = head.buzz = head.rumble = head._g = 0;
    lastSpeed = 0;
  }

  CBZ.cockpitViewActive = function () { return active; };
  CBZ.cockpitSetView = function (v) { want = !!v; return setActive(want && !!craftNow()); };
  // exposed so the touch layer can offer a COCKPIT pill (systems/touch_vehicle.js
  // owns that surface — this is the verb it should call)
  CBZ.cockpitToggleView = function () {
    if (!craftNow()) return false;
    want = !active;
    const ok = setActive(want);
    if (CBZ.city && CBZ.city.note) CBZ.city.note(ok ? "Cockpit view" : "Chase view", 1.0);
    return ok;
  };

  // [V] — the SAME key city/view.js uses on foot. That file returns early
  // while P.driving is true (it always has), so this listener owns the
  // aircraft case exclusively and the two can never both fire.
  addEventListener("keydown", function (e) {
    if (!on()) return;
    const g = CBZ.game;
    if (!g || g.mode !== "city" || g.state !== "playing") return;
    if (CBZ.cityMenuOpen) return;
    if (e.repeat || !e.key || e.key.toLowerCase() !== "v") return;
    if (!craftNow()) return;                 // on foot: view.js handles it
    e.preventDefault();
    CBZ.cockpitToggleView();
  });

  // ============================================================
  //  HEAD PHYSICS
  // ============================================================
  function updateHead(craft, dt, S) {
    if (CFG.COCKPIT_HEAD_PHYSICS === false) {
      head.y = head.z = head.x = head.yawX = head.buzz = head._g = 0;
      return;
    }
    head.t += dt;
    const sc = fin(CFG.COCKPIT_SCALE, 1.15);
    const spd = Math.abs(fin(craft.airspeed, fin(craft.speed, 0)));

    // --- g-load: 0.015 m per g (FlightGear's GA default). The seat takes
    // your weight; the eye drops. Negative g floats you up against the
    // straps, which is why this is signed and not an absolute value.
    const gSink = -(clamp(fin(S.g, 1), -2, 9) - 1) * 0.015 * sc;

    // --- longitudinal acceleration: you go back into the seat under power
    // and forward against the harness on the brakes.
    const accel = (spd - lastSpeed) / Math.max(0.001, dt);
    lastSpeed = spd;
    head.z += (clamp(-accel * 0.0026, -0.05, 0.05) * sc - head.z) * Math.min(1, dt * 5);

    // --- look into the turn. Every pilot does it and no static camera does,
    // so it is one of the cheapest tells that a person is flying this.
    const bank = fin(S.roll, 0);
    head.yawX += (clamp(-bank * 0.11, -0.10, 0.10) - head.yawX) * Math.min(1, dt * 3.5);
    // the head slides a centimetre toward the low wing as it turns to look
    // into the bank — the pilot's right is body -X, so a right bank (positive)
    // moves the head to -X.
    head.x += (clamp(-bank * 0.012, -0.02, 0.02) * sc - head.x) * Math.min(1, dt * 3.5);

    // --- vibration. Three sources, one accumulator, all scaled small enough
    // that you feel them rather than see them.
    let amp = 0, freq = 34;
    if (craft.airClass === "heli") {
      // a helicopter's whole airframe buzzes at rotor rate — the single most
      // recognisable thing about sitting in one
      amp = 0.0032 * clamp(fin(craft.rotorRate, 1), 0, 1.2) * sc;
      freq = 26;
    } else {
      amp = 0.0011 * clamp(fin(craft.thr, 0.3), 0, 1) * sc;
      freq = 48;
    }
    if (S.stalled) { amp += 0.010 * sc; freq = 17; }        // the buffet is a WARNING
    // ground roll: rumble ramps in above a taxi threshold and is gone the
    // moment the wheels leave. Airborne, a runway rumble is a bug you feel.
    const rTarget = craft.onGround ? clamp((spd - 2) / 32, 0, 1) : 0;
    head.rumble += (rTarget - head.rumble) * Math.min(1, dt * 6);
    amp += head.rumble * 0.007 * sc;
    head.buzz = Math.sin(head.t * freq) * amp + Math.sin(head.t * freq * 2.37) * amp * 0.45;

    // --- touchdown: one spring impulse the size of the sink rate. The
    // spring (not a decay curve) is what makes a firm landing overshoot and
    // a greaser barely move.
    const grounded = !!craft.onGround;
    if (grounded && !wasGround) {
      head.vy -= clamp(Math.abs(fin(craft.vy, 0)) * 0.010, 0.004, 0.10) * sc;
    }
    wasGround = grounded;
    const k = 90, c = 12;                                    // ~1.5 Hz, well damped
    head.vy += (-k * head.y - c * head.vy) * dt;
    head.y += head.vy * dt;
    head.y = clamp(head.y, -0.14, 0.10);
    // g-sink rides ALONGSIDE the spring rather than inside it: the spring is
    // for impulses (touchdown, a hard gust) and must return to zero, while the
    // g offset is a sustained position that should hold for as long as the
    // turn does. Summed at the read below.
    head._g = gSink;
  }

  // ============================================================
  //  THE PER-FRAME CAMERA WRITE
  //  onAlways(54): AFTER camera.js (50), fpsmode.js (52) and
  //  city/scopeview.js (53) — the last word on where the eye is, but never
  //  on what the FOV means (a fitted optic still wins, per CLAUDE.md).
  // ============================================================
  CBZ.onAlways(54, function (dt) {
    if (!on()) { if (active) setActive(false); return; }
    const craft = craftNow();

    // follow the player in and out of aircraft without any hook into the
    // boarding code: the door arc commits by setting P._aircraft, and we
    // simply notice. That also means a crash, a theft revert or a death
    // drops us out for free.
    if (!craft) { if (active) setActive(false); return; }
    if (!active) {
      if (want || CFG.COCKPIT_VIEW_DEFAULT === true) setActive(true);
      if (!active) {
        if (!toldOnce && CBZ.city && CBZ.city.note) {
          toldOnce = true;
          CBZ.city.note("[V] cockpit view", 1.6);
        }
        return;
      }
    }
    if (!rec || rec.craft !== craft || rec.detached) {
      setActive(false);
      if (want) setActive(true);
      if (!active) return;
    }

    const fdt = clamp(fin(CBZ.feelDt, dt), 0.0001, 0.1);
    const camera = CBZ.camera;
    const anchor = rec.anchor;
    if (!camera || !anchor || !anchor.parent) { setActive(false); return; }

    // Recomputed every frame rather than reused from the 18 Hz panel tick:
    // the head physics below reads g-load, bank and the stall flag, and a
    // buffet that arrives three frames late is a buffet you don't believe.
    // It is a handful of trig calls, and the smoothing filters inside it are
    // dt-driven, so running it twice in a frame changes nothing.
    const S = CBZ.cockpitFlightState(craft, rec.S);
    updateHead(craft, fdt, S);

    // ---- head orientation, in the airframe's frame ----------------------
    // Free-look reuses the existing vehicle camera: cam.yaw is the direction
    // the player has asked to look, and playeraircraft.js walks it back
    // behind the tail whenever the mouse is idle. The head angle is simply
    // the difference, clamped to a neck.
    let hy = 0, hp = 0;
    if (CBZ.cam) {
      const nose = fin(craft.heading, 0) + Math.PI;
      let d = fin(CBZ.cam.yaw, nose) - nose;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      hy = clamp(d, -2.30, 2.30);              // ~132° each way: you can check your six
      hp = clamp(fin(CBZ.cam.pitch, 0), -0.95, 0.95);
    }
    hy += head.yawX;
    // THE HALF TURN. A three.js camera looks down its own LOCAL -Z, but the
    // anchor's +Z is the NOSE. Composing the head rotation straight onto the
    // anchor would seat you facing the tail — so the head's yaw carries a
    // permanent 180°. (This is also what makes the free-look maths above come
    // out exact: hy was measured against `heading + PI`, so hy + PI is
    // precisely the camera yaw relative to the airframe.)
    const hyC = hy + Math.PI;

    // ---- eye position, body-local ---------------------------------------
    const eye = rec.spec.eye;
    _v.set(eye.x + head.x, eye.y + head.y + head._g + head.buzz, eye.z + head.z);

    // ---- overlay camera lives in the same body-local frame --------------
    if (overlayWanted() && oCam) {
      oCam.position.copy(_v);
      _e.set(hp, hyC, 0, "YXZ");               // yaw about body up, then pitch
      oCam.quaternion.setFromEuler(_e);
      // FOV and aspect MUST match the world camera or the canopy frame and
      // the horizon behind it drift apart under any FOV change (scoping,
      // speed effects). One assignment, every frame, no exceptions.
      if (oCam.fov !== camera.fov || oCam.aspect !== camera.aspect) {
        oCam.fov = camera.fov; oCam.aspect = camera.aspect; oCam.updateProjectionMatrix();
      }
      // the sun, expressed in body space, so a roll really does sweep the
      // light across the coaming
      if (oSun) {
        const sun = CBZ.sun;
        if (sun && sun.position) _v2.copy(sun.position).normalize();
        else _v2.set(0.4, 1, 0.3);
        anchor.getWorldQuaternion(_q).invert();
        _v2.applyQuaternion(_q);
        oSun.position.copy(_v2);
        const night = clamp(fin(CBZ.nightAmount, 0), 0, 1);
        oSun.intensity = 0.16 + (1 - night) * 0.72;
        oAmb.intensity = 0.16 + (1 - night) * 0.42;
      }
    }

    // ---- the world camera: same eye, same look, in world space ----------
    anchor.updateWorldMatrix(true, false);
    camera.position.copy(_v).applyMatrix4(anchor.matrixWorld);
    anchor.getWorldQuaternion(_q);
    _e.set(hp, hyC, 0, "YXZ");
    _q2.setFromEuler(_e);
    camera.quaternion.copy(_q).multiply(_q2);

    // ---- FOV precedence: a fitted optic always wins (CLAUDE.md) ---------
    const scoped = CBZ.cityScopeFov ? CBZ.cityScopeFov() : (CBZ.fpsScopeFov ? CBZ.fpsScopeFov() : null);
    const wantFov = scoped != null ? scoped : 68;
    if (Math.abs(camera.fov - wantFov) > 0.05) {
      camera.fov += (wantFov - camera.fov) * Math.min(1, fdt * 8);
      camera.updateProjectionMatrix();
    }
  });

  // ============================================================
  //  NEAR-PLANE FALLBACK — only when the overlay pass is off.
  //  city/mode.js sets the flight frustum at onAlways(94); this runs just
  //  after so the seated view isn't sliced in half. It writes ONLY while
  //  seated and ONLY when the overlay pass is disabled, so the flight
  //  frustum mode.js chose is untouched in every other case.
  // ============================================================
  CBZ.onAlways(94.6, function () {
    if (!active || overlayWanted()) return;
    const c = CBZ.camera;
    if (!c) return;
    const n = Math.max(0.02, fin(CFG.COCKPIT_NEAR_FALLBACK, 0.28));
    if (c.near !== n) { c.near = n; c.updateProjectionMatrix(); }
  });

  // ============================================================
  //  SEAM — WALKABLE CABINS IN FLIGHT
  //  Nothing in this engine currently carries a standing player on a moving
  //  surface; a concurrent water agent is building that primitive for
  //  yachts. The airliner in island_airport.js already has a real walk-in
  //  cabin and a real cockpit room with two seats — it is force-cleared the
  //  instant the plane becomes a controlled craft (island_airport.js:759)
  //  precisely because there is no such primitive.
  //
  //  When one lands, this is the whole hook: if the engine can carry a
  //  standing body on a moving deck, an airliner's cockpit stops needing a
  //  synthetic seat and the player can simply WALK to the captain's chair
  //  and sit in the geometry that is already modelled. Until then we report
  //  false and everyone degrades to the seated view above, which needs no
  //  carry primitive at all.
  // ============================================================
  CBZ.cockpitCabinWalkable = function () {
    return !!(CBZ.deckCarry || CBZ.platformCarry || CBZ.ridingSurfaceAt);
  };

  // released cockpits must never keep a stale camera claim
  CBZ.onAlways(95, function () {
    if (active && !craftNow()) setActive(false);
  });
})();
