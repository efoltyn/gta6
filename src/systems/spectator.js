/* ============================================================
   systems/spectator.js — THE DEAD PLAYER'S CAMERA on the disaster island.

   Owner: "when you die, after showing your death, zoom out and you're like
   Minecraft creative mode where you can zoom in and out and basically watch
   the rest of the natural disaster".

   Three beats, one owner of the lens from the moment you die:

     death   a slow, close orbit of your body while the ragdoll lands
             (DEATH_SECS of world time, so the trauma slow-mo stretches it)
     pull    the lens rises and backs away from the body to a high, wide
             view of the island (PULL_SECS), still looking at where you fell.
             Touching any control ends it early and hands you the camera
             from exactly where it is
     free    a free-flying camera. The world, the round and every later
             disaster keep running; nothing waits for you

   CONTROLS
     desktop  W A S D fly (flat, along where you face), Space or E up,
              Shift or Q down, mouse look (pointer lock on click; dragging
              works without it), wheel dollies along the view
     touch    one finger drag looks, two fingers pinch to dolly and drag to
              pan, and the small up / down pair on the right climbs and sinks
   Everything is inertial: input sets a target velocity, the camera eases to
   it, and a flung finger keeps turning a moment after it lifts.

   THE CLAMP. The lens never goes under the island or the sea (the sea is
   read live, so a tsunami lifts the floor of the sky with it), never past
   a ring well outside the shore, and never above CEIL.

   Lens ownership: systems/camera.js returns early while owns() is true and
   this file writes CBZ.camera at onAlways(50.5), after it. The lab, which
   has no camera.js, gets the same camera from the same hook.

   API (CBZ.spectator)
     begin()          start the death beat on the current camera pose
     end()            hand the lens back (a new round, a mode change)
     owns()           true while this file writes the camera
     phase()          "death" | "pull" | "free" | null
     state()          numbers for probes: phase, t, pos, yaw, pitch, speed
     input            the touch / wheel / look state the kits drive
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  const DEATH_SECS = 2.4;     // the body, close, while the ragdoll lands
  const PULL_SECS = 2.8;      // the rise to the wide view
  const PULL_BACK = 24;       // m behind the body along the death bearing...
  const PULL_UP = 17;         // ...and this far above it
  const CLEAR = 1.4;          // m the lens keeps above ground or water
  const CEIL = 280;           // m: high enough to see the whole island and the nuke's cap
  const RING = 2.4;           // x the island radius: how far out you may fly
  const BASE_SPEED = 11;      // m/s at street height; grows with altitude
  const ACCEL = 4.5;          // 1/s: how quickly velocity eases to the input
  const LOOK_SENS = 0.0024;   // rad per mouse pixel
  const TOUCH_SENS = 0.0052;  // rad per finger pixel
  const PITCH_MAX = 1.45;
  const FLING_MAX = 3.2;      // rad/s: the fastest a lifted finger keeps turning

  const S = {
    phase: null, t: 0,
    pos: new THREE.Vector3(), vel: new THREE.Vector3(),
    yaw: 0, pitch: -0.4, yawV: 0, pitchV: 0,
    // the death orbit
    ang0: 0, r0: 6, h0: 3, ang: 0,
    // the pull
    from: new THREE.Vector3(), to: new THREE.Vector3(), look: new THREE.Vector3(),
    fov: 50, touched: false, dist: 0,
  };
  const _d = new THREE.Vector3(), _v = new THREE.Vector3();

  function body() {
    const P = CBZ.player;
    return P && P.pos ? P.pos : S.look;
  }
  function arena() { return CBZ.surv && CBZ.surv.arena; }
  function floorAt(x, z) {
    let y = -1e9;
    try { if (CBZ.surv && CBZ.surv.floorAt) y = CBZ.surv.floorAt(x, z); } catch (e) {}
    try { if (CBZ.survSeaHeightAt) y = Math.max(y, CBZ.survSeaHeightAt(x, z)); } catch (e) {}
    return y > -1e8 ? y : 0;
  }
  function ease(u) { u = Math.max(0, Math.min(1, u)); return u * u * u * (u * (u * 6 - 15) + 10); }
  function dirOf(yaw, pitch, out) {
    const c = Math.cos(pitch);
    return out.set(-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c);
  }
  function aimAt(x, y, z) {
    _d.set(x - S.pos.x, y - S.pos.y, z - S.pos.z);
    const l = _d.length() || 1;
    S.yaw = Math.atan2(-_d.x, -_d.z);
    S.pitch = Math.asin(Math.max(-1, Math.min(1, _d.y / l)));
  }

  /* ---- input ------------------------------------------------------------- */
  const input = {
    lookX: 0, lookY: 0,      // pending look in pixels (mouse / finger)
    dolly: 0,                // pending dolly impulse in m/s along the view
    panX: 0, panY: 0,        // pending touch pan in pixels
    up: false, down: false,  // the touch up / down pair
  };
  function keys() { return CBZ.keys || {}; }
  /* TAKING THE CAMERA. Only a FRESH input takes the lens out of the death:
     a flight key pressed after you died, the wheel, a finger on the pad.
     The W and Shift you were holding while you ran, and the mouse you were
     aiming with, do not cut your own death short; and the body always gets
     DEATH_MIN seconds before anything can. */
  const FLY_KEYS = { w: 1, a: 1, s: 1, d: 1, " ": 1, shift: 1, e: 1, q: 1, arrowup: 1, arrowdown: 1, arrowleft: 1, arrowright: 1 };
  const DEATH_MIN = 1.4;
  function wake() { S.touched = true; }
  addEventListener("keydown", function (e) {
    if (S.phase == null || e.repeat) return;
    if (FLY_KEYS[String(e.key || "").toLowerCase()]) wake();
  });

  function onMouseMove(e) {
    if (S.phase == null) return;
    const locked = document.pointerLockElement && document.pointerLockElement === CBZ.canvas;
    if (!locked && !drag.on) return;
    input.lookX += e.movementX || 0; input.lookY += e.movementY || 0;
    // a look once the camera is rising off the body takes it; during the
    // death itself the mouse is ignored
    if (S.phase === "pull" && Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0) > 2) wake();
  }
  const drag = { on: false };
  function onMouseDown(e) {
    if (S.phase == null || CBZ.touchMode) return;
    if (e.target !== CBZ.canvas) return;
    drag.on = true;
    // the lock makes looking feel like the game; a refused lock still drags
    if (CBZ.canvas && CBZ.canvas.requestPointerLock) {
      try { const r = CBZ.canvas.requestPointerLock(); if (r && r.catch) r.catch(function () {}); } catch (err) {}
    }
  }
  function onMouseUp() { drag.on = false; }
  function onWheel(e) {
    if (S.phase == null) return;
    if (e.target && e.target.closest && e.target.closest(".screen")) return;
    const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    input.dolly += -d * 0.06;
    wake();
  }
  addEventListener("mousemove", onMouseMove);
  addEventListener("mousedown", onMouseDown);
  addEventListener("mouseup", onMouseUp);
  addEventListener("wheel", onWheel, { passive: true });
  // Escape: the first one frees the cursor (the browser eats it), so the
  // PLAY AGAIN button can be clicked; a second, with the cursor free, opens
  // the pause card (the way to the main menu). camera.js never pauses on the
  // unlock itself while you spectate.
  addEventListener("keydown", function (e) {
    if (S.phase == null || e.key !== "Escape" || e.repeat) return;
    if (document.pointerLockElement === CBZ.canvas) return;
    if (CBZ.game && CBZ.game.state === "playing" && CBZ.pauseGame) { e.preventDefault(); CBZ.pauseGame(); }
  });

  /* the touch pad: full screen, under the HUD, only while spectating.
     data-act puts it on systems/touch.js's UI list, so the move stick and
     the look finger there never see these touches. */
  let pad = null, upBtn = null, dnBtn = null;
  const fingers = new Map();
  let pinch0 = 0, mid0x = 0, mid0y = 0;
  function buildPad() {
    if (pad) return;
    pad = document.createElement("div");
    pad.id = "specPad";
    pad.setAttribute("data-act", "spectate");
    pad.innerHTML =
      '<button id="specUp" type="button" aria-label="Up"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 14.5 12 8.5l6 6"/></svg></button>' +
      '<button id="specDown" type="button" aria-label="Down"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9.5 12 15.5l6-6"/></svg></button>';
    document.body.appendChild(pad);
    upBtn = pad.querySelector("#specUp"); dnBtn = pad.querySelector("#specDown");
    function hold(b, key) {
      const on = function (e) { e.preventDefault(); e.stopPropagation(); input[key] = true; b.classList.add("on"); wake(); };
      const off = function (e) { if (e) { e.preventDefault(); e.stopPropagation(); } input[key] = false; b.classList.remove("on"); };
      b.addEventListener("touchstart", on, { passive: false });
      b.addEventListener("touchend", off, { passive: false });
      b.addEventListener("touchcancel", off, { passive: false });
      b.addEventListener("mousedown", on); b.addEventListener("mouseup", off); b.addEventListener("mouseleave", off);
    }
    hold(upBtn, "up"); hold(dnBtn, "down");
    pad.addEventListener("touchstart", function (e) {
      if (e.target !== pad) return;
      e.preventDefault();
      for (const t of e.changedTouches) fingers.set(t.identifier, { x: t.clientX, y: t.clientY });
      resetPinch();
      S.yawV = S.pitchV = 0;
      wake();
    }, { passive: false });
    pad.addEventListener("touchmove", function (e) {
      e.preventDefault();
      let moved = false;
      for (const t of e.changedTouches) {
        const f = fingers.get(t.identifier); if (!f) continue;
        f.dx = t.clientX - f.x; f.dy = t.clientY - f.y; f.x = t.clientX; f.y = t.clientY; moved = true;
      }
      if (!moved) return;
      const list = Array.from(fingers.values());
      if (list.length === 1) {
        input.lookX += list[0].dx || 0; input.lookY += list[0].dy || 0;
      } else if (list.length >= 2) {
        const a = list[0], b = list[1];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        if (pinch0 > 0) input.dolly += (dist - pinch0) * 0.22;
        input.panX += mx - mid0x; input.panY += my - mid0y;
        pinch0 = dist; mid0x = mx; mid0y = my;
      }
      for (const f of fingers.values()) { f.dx = 0; f.dy = 0; }
    }, { passive: false });
    const end = function (e) {
      for (const t of e.changedTouches) fingers.delete(t.identifier);
      resetPinch();
    };
    pad.addEventListener("touchend", end, { passive: false });
    pad.addEventListener("touchcancel", end, { passive: false });
  }
  function resetPinch() {
    const list = Array.from(fingers.values());
    if (list.length >= 2) {
      pinch0 = Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y);
      mid0x = (list[0].x + list[1].x) / 2; mid0y = (list[0].y + list[1].y) / 2;
    } else pinch0 = 0;
  }
  function showPad(on) {
    if (on) buildPad();
    if (pad) pad.classList.toggle("on", !!on);
    document.body.classList.toggle("spectating", !!on);
  }

  /* ---- the beats --------------------------------------------------------- */
  function begin() {
    const cam = CBZ.camera; if (!cam) return;
    if (CBZ.fps && CBZ.fps.active && CBZ.setFPS) { try { CBZ.setFPS(false); } catch (e) {} }
    const p = body();
    S.phase = "death"; S.t = 0; S.touched = false;
    S.pos.copy(cam.position); S.vel.set(0, 0, 0); S.yawV = S.pitchV = 0;
    S.ang0 = Math.atan2(cam.position.z - p.z, cam.position.x - p.x);
    S.r0 = Math.max(3.5, Math.min(13, Math.hypot(cam.position.x - p.x, cam.position.z - p.z)));
    S.h0 = Math.max(1.4, Math.min(8, cam.position.y - p.y));
    S.ang = S.ang0;
    S.fov = cam.fov || 50;
    input.lookX = input.lookY = input.dolly = input.panX = input.panY = 0;
    input.up = input.down = false;
    showPad(true);
  }
  function goPull() {
    const p = body();
    S.phase = "pull"; S.t = 0;
    S.from.copy(S.pos);
    // back out along the orbit's bearing, up, and clear of the ground there
    const bx = Math.cos(S.ang), bz = Math.sin(S.ang);
    S.to.set(p.x + bx * PULL_BACK, p.y + PULL_UP, p.z + bz * PULL_BACK);
    S.to.y = Math.max(S.to.y, floorAt(S.to.x, S.to.z) + PULL_UP * 0.6);
    S.look.copy(p);
  }
  function goFree() {
    if (S.phase === "free") return;
    S.phase = "free"; S.t = 0;
    S.vel.set(0, 0, 0);
  }
  function end() {
    S.phase = null; S.t = 0;
    fingers.clear(); drag.on = false;
    input.up = input.down = false;
    showPad(false);
    if (document.pointerLockElement === CBZ.canvas && document.exitPointerLock) { try { document.exitPointerLock(); } catch (e) {} }
  }

  function clamp() {
    const A = arena();
    if (A && A.center) {
      const dx = S.pos.x - A.center.x, dz = S.pos.z - A.center.z, d = Math.hypot(dx, dz), lim = (A.radius || 120) * RING;
      if (d > lim) {
        S.pos.x = A.center.x + dx / d * lim; S.pos.z = A.center.z + dz / d * lim;
        const vr = (S.vel.x * dx + S.vel.z * dz) / d;
        if (vr > 0) { S.vel.x -= dx / d * vr; S.vel.z -= dz / d * vr; }
      }
    }
    const g = floorAt(S.pos.x, S.pos.z) + CLEAR;
    if (S.pos.y < g) { S.pos.y = g; if (S.vel.y < 0) S.vel.y = 0; }
    if (S.pos.y > CEIL) { S.pos.y = CEIL; if (S.vel.y > 0) S.vel.y = 0; }
  }

  function stepFree(dt) {
    const k = keys();
    // look: mouse / finger pixels this frame, plus the finger's fling
    const sens = CBZ.touchMode ? TOUCH_SENS : LOOK_SENS;
    if (input.lookX || input.lookY) {
      const dy = -input.lookX * sens, dp = -input.lookY * sens;
      S.yaw += dy; S.pitch += dp;
      // a finger's turn rate, kept for the coast after it lifts (capped: a
      // flick is a glance, not a spin)
      if (CBZ.touchMode && dt > 0) {
        S.yawV = Math.max(-FLING_MAX, Math.min(FLING_MAX, dy / dt));
        S.pitchV = Math.max(-FLING_MAX, Math.min(FLING_MAX, dp / dt));
      }
      input.lookX = input.lookY = 0;
    } else if (fingers.size) {
      S.yawV = S.pitchV = 0;            // a finger held still holds the view still
    } else if (S.yawV || S.pitchV) {
      S.yaw += S.yawV * dt; S.pitch += S.pitchV * dt;
      const f = Math.exp(-6 * dt);
      S.yawV *= f; S.pitchV *= f;
      if (Math.abs(S.yawV) + Math.abs(S.pitchV) < 0.01) S.yawV = S.pitchV = 0;
    }
    if (k.arrowleft) S.yaw += 1.6 * dt;
    if (k.arrowright) S.yaw -= 1.6 * dt;
    S.pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, S.pitch));

    // the speed grows with height: a street at a walk, the island at a glide
    const h = Math.max(0, S.pos.y - floorAt(S.pos.x, S.pos.z));
    const speed = BASE_SPEED * Math.max(0.6, Math.min(5, 0.55 + h / 22));
    const fx = -Math.sin(S.yaw), fz = -Math.cos(S.yaw);           // flat forward
    const rx = -fz, rz = fx;                                       // right
    const f = (k.w || k.arrowup ? 1 : 0) - (k.s || k.arrowdown ? 1 : 0);
    const r = (k.d ? 1 : 0) - (k.a ? 1 : 0);
    const u = (k[" "] || k.e || input.up ? 1 : 0) - (k.shift || k.q || input.down ? 1 : 0);
    let tx = fx * f + rx * r, tz = fz * f + rz * r;
    const tl = Math.hypot(tx, tz);
    if (tl > 1) { tx /= tl; tz /= tl; }
    const a = 1 - Math.exp(-ACCEL * dt);
    S.vel.x += (tx * speed - S.vel.x) * a;
    S.vel.z += (tz * speed - S.vel.z) * a;
    S.vel.y += (u * speed * 0.7 - S.vel.y) * a;
    // the dolly is an impulse along the view: wheel / pinch
    if (input.dolly) {
      dirOf(S.yaw, S.pitch, _v);
      const imp = Math.max(-60, Math.min(60, input.dolly)) * Math.max(0.6, Math.min(4, 0.6 + h / 30));
      S.vel.addScaledVector(_v, imp);
      input.dolly = 0;
    }
    // two-finger pan: the picture follows the fingers (grab the world)
    if (input.panX || input.panY) {
      const m = Math.max(0.03, (h + 6) * 0.0035);
      S.pos.x -= rx * input.panX * m; S.pos.z -= rz * input.panX * m;
      S.pos.y += input.panY * m;
      input.panX = input.panY = 0;
    }
    S.pos.addScaledVector(S.vel, dt);
    S.speed = S.vel.length();
  }

  function apply(cam, dt, shake) {
    cam.position.copy(S.pos);
    if (shake > 0.001) {
      cam.position.x += (Math.random() - 0.5) * shake;
      cam.position.y += (Math.random() - 0.5) * shake;
      cam.position.z += (Math.random() - 0.5) * shake;
    }
    dirOf(S.yaw, S.pitch, _v);
    cam.lookAt(S.pos.x + _v.x, S.pos.y + _v.y, S.pos.z + _v.z);
    const want = S.phase === "death" ? 48 : 58;
    S.fov += (want - S.fov) * (1 - Math.exp(-3 * dt));
    if (Math.abs(cam.fov - S.fov) > 0.01) { cam.fov = S.fov; cam.updateProjectionMatrix(); }
  }

  function frame(dt) {
    if (S.phase == null) return;
    const cam = CBZ.camera; if (!cam) return;
    const g = CBZ.game;
    // the round reset or the mode changed under us: let go of the lens
    if (!g || g.mode !== "survival" || !CBZ.player || !CBZ.player.dead) { end(); return; }
    if (g.state !== "playing") return;
    const wdt = Math.min(0.1, Math.max(0, dt || 0));
    const fdt = Math.min(0.1, Math.max(0, CBZ.wallDt != null ? CBZ.wallDt : wdt));
    S.t += S.phase === "death" ? wdt : fdt;
    const p = body();
    // the mouse you were aiming with does not steer a camera you do not own yet
    if (S.phase !== "free") { input.lookX = input.lookY = 0; }
    if (S.phase === "death") {
      if (S.t > DEATH_MIN && S.touched) goFree();
      else {
        S.ang = S.ang0 + S.t * 0.45;
        const e = ease(S.t / 1.2);
        const r = S.r0 + (6 - S.r0) * e, h = S.h0 + (3.2 - S.h0) * e;
        S.pos.set(p.x + Math.cos(S.ang) * r, p.y + h, p.z + Math.sin(S.ang) * r);
        const fl = floorAt(S.pos.x, S.pos.z) + 0.6;
        if (S.pos.y < fl) S.pos.y = fl;
        // never film the body through a wall (camera.js's own pull-in, when loaded)
        if (CBZ.camPullback) { try { CBZ.camPullback(p.x, p.y + 1, p.z, S.pos, 0.3, 0.45); } catch (e2) {} }
        aimAt(p.x, p.y + 0.6, p.z);
        if (S.t >= DEATH_SECS) goPull();
      }
    } else if (S.phase === "pull") {
      if (S.touched) goFree();
      else {
        const e = ease(S.t / PULL_SECS);
        S.pos.lerpVectors(S.from, S.to, e);
        // a slight arc: rise a little ahead of backing away
        S.pos.y += Math.sin(Math.PI * e) * 2.5;
        S.look.lerp(p, 1 - Math.exp(-6 * fdt));   // the body may still be sliding
        clamp();
        aimAt(S.look.x, S.look.y + 0.6, S.look.z);
        if (S.t >= PULL_SECS) goFree();
      }
    }
    if (S.phase === "free") { stepFree(fdt); clamp(); }
    let shake = 0;
    if (CBZ.camShakeLevel) { try { shake = CBZ.camShakeLevel() * (S.phase === "free" ? 0.35 : 0.2); } catch (e) {} }
    apply(cam, fdt, shake);
  }
  CBZ.onAlways(50.5, frame);

  CBZ.spectator = {
    begin, end,
    owns() { return S.phase != null; },
    phase() { return S.phase; },
    input,
    state() {
      const r = (v) => Math.round(v * 100) / 100;
      return {
        phase: S.phase, t: r(S.t), pos: [r(S.pos.x), r(S.pos.y), r(S.pos.z)],
        yaw: r(S.yaw), pitch: r(S.pitch), speed: r(S.speed || 0),
        aboveGround: r(S.pos.y - floorAt(S.pos.x, S.pos.z)),
      };
    },
  };
})();
