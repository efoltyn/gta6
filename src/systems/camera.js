/* ============================================================
   systems/camera.js — third-person follow camera.
   Techniques (researched): Unity-style critically-damped SmoothDamp
   so the camera lags then settles without overshoot, velocity-based
   look-ahead so you see where you're going, a subtle FOV kick at
   speed, smoothed crouch height, and raycast collision so it never
   clips through walls.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const { camera, canvas, player } = CBZ;
  const SENS = CBZ.TUNE.sens;

  // ---- CITY THIRD-PERSON FRAMING (Fortnite over-shoulder) — guarded FALLBACK ----
  // src/city/camera.js IS loaded by index.html (later than this file) and is the
  // AUTHORITATIVE tuning surface: it re-assigns CBZ.CITY_TP unconditionally, so
  // any edit made to the copy below is silently overwritten at load time. This
  // guarded copy exists only so the TP path never sees CITY_TP undefined if the
  // city file is ever dropped from the page. TUNE IN src/city/camera.js, NOT HERE.
  if (!CBZ.CITY_TP) CBZ.CITY_TP = {
    // (values mirror src/city/camera.js — the authoritative copy; keep in sync)
    HEIGHT: 1.7,       // rig pivot height — a touch above the head
    DIST: 4.0,         // behind-the-back distance (Fortnite default frame)
    SIDE: 0.55,        // subtle lateral offset RIGHT — char just left of centre
    PITCH: 0.10,       // default orbit pitch on city entry — mild down-gaze
    LOOK_Y: 1.52,      // look-target height above feet
    LEAD: 4.6,         // forward look-ahead
    DAMP_POS: 0.16,    // position SmoothDamp time (lazy settle)
    DAMP_YAW: 9.0,     // relaxed yaw chase rate
    DAMP_YAW_AIM: 26,  // yaw chase while armed — near-rigid so aiming never feels mushy
    FOV: 60,           // base FOV
    // ARMED / ADS tier: armed-at-rest = the SAME frame as relaxed (holding a gun
    // doesn't move the camera); only RMB/ADS punches to the tight over-shoulder.
    DIST_AIM_BASE: 4.0,  DIST_AIM_ADS: 2.4,
    SIDE_AIM_BASE: 0.55, SIDE_AIM_ADS: 0.85,
    FOV_AIM_BASE: 60,    FOV_AIM_ADS: 50,
    HEIGHT_AIM_BASE: 1.7, HEIGHT_AIM_ADS: 1.58,
    PITCH_LOOK: 1.0,   // how strongly the armed look target follows player pitch (FIX 1: aim vertically + stable framing)
    get DIST_AIM() { return (CBZ.isADS && CBZ.isADS()) ? this.DIST_AIM_ADS : this.DIST_AIM_BASE; },
    get SIDE_AIM() { return (CBZ.isADS && CBZ.isADS()) ? this.SIDE_AIM_ADS : this.SIDE_AIM_BASE; },
    get FOV_AIM()  { return (CBZ.isADS && CBZ.isADS()) ? this.FOV_AIM_ADS  : this.FOV_AIM_BASE; },
    get HEIGHT_AIM() { return (CBZ.isADS && CBZ.isADS()) ? this.HEIGHT_AIM_ADS : this.HEIGHT_AIM_BASE; },
  };

  // ---- zoom (scroll wheel / pinch). default sits wide; clamps in [MIN,MAX] ----
  const ZMIN = 5.2, ZMAX = 16, DEF = CBZ.TUNE.camDist;
  let camDist = DEF;        // smoothed actual distance
  let zoomTarget = DEF;     // where zoom wants to be
  function clampZoom(v) { return Math.max(ZMIN, Math.min(ZMAX, v)); }
  CBZ.camZoom = function (d) { zoomTarget = clampZoom(zoomTarget + d); };
  CBZ.resetZoom = function () { zoomTarget = DEF; camDist = DEF; };

  // Looking UP is the NEGATIVE-pitch direction (boom uses oy = sin(pitch)*camDist,
  // and the look target adds sin(pitch)*aimLead). The old MIN_PITCH = -0.18 capped
  // look-up at only ~-10°, so you could barely tilt the view up. Widen to a
  // generous ~57° up / ~51° down. A hard ±1.45 safety in the mousemove handler
  // keeps |pitch| away from π/2 (gimbal / camera-through-floor).
  const MIN_PITCH = -1.0, MAX_PITCH = 0.9;
  const PITCH_SAFETY = 1.45;
  const DEFAULT_PITCH = 0.46;   // lower angle — less of a top-down "high" view
  CBZ.CAM_DEFAULT_PITCH = DEFAULT_PITCH;
  const cam = { yaw: 0, pitch: DEFAULT_PITCH, locked: false };
  CBZ.cam = cam;

  // ---- FEEL-CAM (de-lagged, real-time follow) -----------------------------
  // Two coupled feel fixes, both reversible via CBZ.feelCam (default ON):
  //  (A) REAL-TIME SETTLE: every SmoothDamp / exp-chase below integrates with
  //      the wall-clock CBZ.feelDt (graceful: `feelDt != null ? feelDt : dt`)
  //      instead of the world's 0.05-clamped dt. At ~5 FPS the clamped dt makes
  //      the camera settle at ~25% real speed (the slow-mo-under-load follow);
  //      feelDt restores real-time settling WITHOUT changing any smoothTime
  //      constant — the float/lazy character is byte-identical, just paced to
  //      real time. The SMOOTH-TIME tunables (DAMP_POS etc.) are untouched, so
  //      the translation follow stays exactly as floaty as the owner tuned it.
  //  (B) CRISP ROTATION: mouse-look already writes cam.yaw INSTANTLY in the DOM
  //      event — that is the responsive aim. The city rig then RE-smooths it via
  //      smYaw and re-lags the look target, re-adding rotational latency on top
  //      of an already-instant aim (the "view turns a beat after my mouse" feel
  //      research flags as the dizzying over-delay). Under feelCam the VIEW
  //      DIRECTION (look target) uses LIVE cam.yaw 1:1 while the lagged smYaw
  //      still frames the BODY/orbit — so turning is crisp but the body keeps
  //      its cinematic trail. Consensus from research: rotation instant,
  //      translation smoothed.
  // MP-SAFE: this is a pure per-client present-path read of player.pos/cam.yaw;
  // no net hook lives in this file and every client runs identical own-view
  // logic. OFF (CBZ.feelCam === false) → reverts to today's smYaw framing +
  // world-dt settle exactly. The FOV speed-kick is preserved unchanged.
  if (CBZ.feelCam === undefined) CBZ.feelCam = true;
  // look-target smoothTime is multiplied by this when feelCam is on: the look
  // target carries the ROTATIONAL view direction (via the big aimLead term),
  // so tightening it snaps the aim toward live yaw while a small residue keeps
  // player-position noise from jittering the view at low FPS. Position follow
  // SmoothDamp is NOT tightened (translation stays floaty).
  const LOOK_TIGHTEN = 0.28;

  // screen shake — punches/KOs call CBZ.shake(magnitude)
  let shakeAmt = 0;
  CBZ.shake = function (m) { shakeAmt = Math.max(shakeAmt, m); };

  CBZ.requestLock = function () {
    if (CBZ.touchMode) return; // phones drive the camera via on-screen look-pad
    try {
      const req = canvas.requestPointerLock && canvas.requestPointerLock();
      if (req && req.catch) req.catch(() => {});
    } catch (_) {}
  };

  document.addEventListener("pointerlockchange", () => {
    cam.locked = document.pointerLockElement === canvas;
    // don't pause while spectating a death — the cursor is intentionally free
    // so you can click the Play Again / Menu buttons, and the world keeps going
    // CBZ.settingsOpen (src/systems/settings.js): the pause/settings panel
    // calls document.exitPointerLock() itself while open. MP-CRITICAL: this
    // client may be the elected sim-host (see GO-LIVE.md) — setState("paused")
    // freezes core/loop.js's `g.state === "playing"` gate, which stops the
    // WORLD SIM (NPCs/traffic/physics) for every connected guest, not just the
    // local view. The settings panel must never trigger that, so it's added to
    // this exemption list exactly like cityMenuOpen/fullMap.active above.
    // g.busted: the BUSTED cutscene (city/wanted.js bust()) releases the lock
    // itself while mode is still "city"/"playing" — without this exemption the
    // release spuriously paused the world mid-cutscene.
    if (!cam.locked && CBZ.game.state === "playing" && !(CBZ.surv && CBZ.surv.spectating) && !(CBZ.fullMap && CBZ.fullMap.active) && !CBZ.cityMenuOpen && !CBZ.settingsOpen && !(CBZ.cityCam && CBZ.cityCam.death) && !CBZ.game.busted && !(CBZ.game.mode === "city" && CBZ.player && CBZ.player.dead)) CBZ.setState("paused");
    else if (cam.locked && CBZ.game.state === "paused") CBZ.setState("playing");
  });
  document.addEventListener("mousemove", (e) => {
    if (!cam.locked) return;
    cam.yaw -= e.movementX * SENS;
    cam.pitch -= e.movementY * SENS;
    // soft tier clamp, then a hard safety so |pitch| can never reach π/2
    cam.pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, cam.pitch));
    cam.pitch = Math.max(-PITCH_SAFETY, Math.min(PITCH_SAFETY, cam.pitch));
  });
  // scroll wheel zooms the third-person camera (ignored in first-person)
  addEventListener("wheel", (e) => {
    if ((CBZ.simView && CBZ.simView.active) || (CBZ.fullMap && CBZ.fullMap.active)) return; // overview/map owns the pointer
    if ((CBZ.fps && CBZ.fps.active) || (CBZ.weaponThirdPersonActive && CBZ.weaponThirdPersonActive())) return;
    CBZ.camZoom(e.deltaY * 0.012);
  }, { passive: true });

  // ---- Unity-style SmoothDamp (per scalar) ----
  function smoothDamp(cur, target, vel, smoothTime, dt) {
    smoothTime = Math.max(0.0001, smoothTime);
    const omega = 2 / smoothTime;
    const x = omega * dt;
    const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    let change = cur - target;
    const temp = (vel.v + omega * change) * dt;
    vel.v = (vel.v - omega * temp) * exp;
    return target + (change + temp) * exp;
  }

  // smoothed state
  const camV = { x: { v: 0 }, y: { v: 0 }, z: { v: 0 } };
  const look = new THREE.Vector3(player.pos.x, player.pos.y + 1.4, player.pos.z);
  const lookV = { x: { v: 0 }, y: { v: 0 }, z: { v: 0 } };
  let fov = 62, fovV = { v: 0 }, heightV = { v: 0 };
  let height = 1.4;
  const prev = new THREE.Vector3().copy(player.pos);
  const vel = new THREE.Vector3();

  const raycaster = new THREE.Raycaster();
  const _ro = new THREE.Vector3(), _rd = new THREE.Vector3();
  // lazy-follow yaw for the city RDR2 cam — trails cam.yaw with exp smoothing
  // (input itself is untouched; only the rig's framing lags)
  let smYaw = 0, smYawOn = false;
  // one-shot: settle the orbit pitch to the CITY_TP near-level default on city entry
  let _cityPitchInit = false;

  // cinematic spawn intro: far reveal -> push in -> 180 orbit handoff
  let introT = 0;
  let introYaw0 = 0;
  const INTRO = 3.55;
  const introLook = new THREE.Vector3();
  const introPos = new THREE.Vector3();
  const introEye = new THREE.Vector3();
  const introAim = new THREE.Vector3();
  // opts.compact (city/origins.js): the two INDOOR origin scenes (a top-floor
  // office, a tiny apartment) spawn the player inside a real room, where the
  // default huge outdoor pull-back (-24,+34,+58 world-space) fights
  // keepIntroCamInRoom through an entire building's walls the whole beat. In
  // compact mode the "far" establishing anchor computed in the per-frame tick
  // below is instead a MODEST, FACING-RELATIVE pull-back (a few metres beyond
  // the front-reveal distance) that's room-clamped just like the reveal shot
  // — same front-reveal -> orbit -> FP push-in shape, scaled for an interior.
  // No-arg / non-compact calls are 100% unchanged.
  const introFarPt = new THREE.Vector3();
  let introOpts = null;
  CBZ.startIntro = function (opts) {
    introT = INTRO;
    introYaw0 = cam.yaw;
    introOpts = opts || null;
    // re-arm the once-per-ENTRY city pitch level (below) EVERY run: the latch
    // used to fire once per page, so run 2+ kept mode.js's steep spawn pitch —
    // armed-3PS amplifies pitch by aimLead (~12m), so a stale 0.4 slung the
    // look target metres overhead (ceiling stare, character out of frame).
    _cityPitchInit = false;
    const spawn = CBZ.player ? CBZ.player.pos : CBZ.SPAWN;
    // snap to a much farther establishing shot so frame one feels deliberate
    // (irrelevant for compact mode too — the very next onAlways(50) tick
    // overwrites this before any frame renders; left as the same default
    // snap so the pre-tick camera state is never literally undefined).
    camera.position.set(spawn.x - 24, spawn.y + 34, spawn.z + 58);
    camera.lookAt(spawn.x, spawn.y + 1.18, spawn.z);
  };
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  function keepIntroCamInRoom(baseX, baseY, baseZ, pos) {
    _ro.set(baseX, baseY, baseZ);
    _rd.copy(pos).sub(_ro);
    const d = _rd.length();
    if (d > 0.001) {
      _rd.normalize();
      raycaster.set(_ro, _rd);
      raycaster.far = d;
      const hit = raycaster.intersectObjects(CBZ.losBlockers, false);
      if (hit.length > 0 && hit[0].distance < d) {
        pos.copy(_ro).addScaledVector(_rd, Math.max(1.5, hit[0].distance - 0.45));
      }
    }
    pos.y = Math.max(pos.y, 0.8);
    return pos;
  }

  // Swept-sphere (approx boxcast) of the camera arm against every solid
  // collider. Returns the nearest distance along the normalized ray (ox,oy,oz)+
  // t*(dx,dy,dz) at which a collider — expanded by the camera radius — is hit,
  // clamped to `dist`. Colliders carry an optional [y0,y1] vertical span (the
  // survival buildings); prison walls have none and act full-height. Tree
  // trunks opt out via noCam so they don't jostle the camera.
  function sweepColliders(ox, oy, oz, dx, dy, dz, dist, rad) {
    let best = dist;
    const cs = CBZ.colliders;
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      if (c.noCam) continue;
      const minX = c.minX - rad, maxX = c.maxX + rad, minZ = c.minZ - rad, maxZ = c.maxZ + rad;
      const minY = (c.y0 != null ? c.y0 : -1e4) - rad, maxY = (c.y1 != null ? c.y1 : 1e4) + rad;
      let t0 = 0, t1 = best, ta, tb, tmp;
      if (dx > -1e-8 && dx < 1e-8) { if (ox < minX || ox > maxX) continue; }
      else { ta = (minX - ox) / dx; tb = (maxX - ox) / dx; if (ta > tb) { tmp = ta; ta = tb; tb = tmp; } if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) continue; }
      if (dy > -1e-8 && dy < 1e-8) { if (oy < minY || oy > maxY) continue; }
      else { ta = (minY - oy) / dy; tb = (maxY - oy) / dy; if (ta > tb) { tmp = ta; ta = tb; tb = tmp; } if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) continue; }
      if (dz > -1e-8 && dz < 1e-8) { if (oz < minZ || oz > maxZ) continue; }
      else { ta = (minZ - oz) / dz; tb = (maxZ - oz) / dz; if (ta > tb) { tmp = ta; ta = tb; tb = tmp; } if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) continue; }
      if (t0 > 0.001 && t0 < best) best = t0;   // t0<=0 → pivot already inside; ignore
    }
    return best;
  }

  function updateCamera(dt) {
    // FEEL-DT: the real-wall-clock present delta for camera settle (graceful —
    // falls back to the passed world dt if loop.js hasn't published feelDt or
    // CBZ.feelMotion is off). Gated by feelCam so the whole feel pass reverts
    // cleanly: when feelCam is off we settle on the world dt exactly as today.
    // Used ONLY for time-integration of the damps/exp-chase below; the velocity
    // calc keeps the world dt so look-ahead/FOV pacing is unchanged.
    const fdt = (CBZ.feelCam && CBZ.feelDt != null) ? CBZ.feelDt : dt;
    // BIRD'S-EYE SOCIETY VIEW: a strategic camera for the math-only mass
    // simulation. It intentionally bypasses spring-arm collision and close
    // camera effects; the player remains frozen while the prison keeps living.
    const sv = CBZ.simView;
    if (sv && sv.active && CBZ.game.mode === "escape") {
      introT = 0;
      prev.copy(player.pos); // prevent a false velocity spike on hand-off
      shakeAmt = 0;
      const targetX = sv.x, targetY = sv.height, targetZ = sv.z + sv.height * 0.16;
      camera.position.x = smoothDamp(camera.position.x, targetX, camV.x, 0.16, fdt);
      camera.position.y = smoothDamp(camera.position.y, targetY, camV.y, 0.16, fdt);
      camera.position.z = smoothDamp(camera.position.z, targetZ, camV.z, 0.16, fdt);
      look.set(sv.x, 0, sv.z);
      camera.lookAt(look);
      fov = smoothDamp(fov, 52, fovV, 0.16, fdt);
      if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
      return;
    }

    // FIRST-PERSON (systems/fpsmode.js) fully owns the camera POSITION + LOOK +
    // FOV every frame at onAlways(52) — AFTER this. Bow out entirely while it's
    // active so we never race its lens. The old city `cc.fp` branch above was the
    // intended FP hand-off, but cc.fp is never set true (city FP runs on
    // fps.active), so this function used to fall straight through to the
    // THIRD-PERSON tail and ease camera.fov toward a ~61° chase FOV every frame —
    // while fpsmode eased the SAME fov toward the ADS target (~36° on RMB). Two
    // writers tugging opposite directions = the ADS zoom flickering in/out while
    // holding right-click. One owner = a rock-steady hold. (Keep prev/introT
    // synced so the 3rd-person hand-off on toggle-off doesn't spike velocity or
    // replay the intro.) fpsmode positions the FP camera in ALL modes, so this is
    // safe for jail/escape FP too — they had the identical race.
    if (CBZ.fps && CBZ.fps.active && !player.dead && !player.driving) {
      introT = 0; prev.copy(player.pos);
      return;
    }

    // CITY DRIVING: a high GTA-style chase — well BEHIND and ABOVE the car,
    // looking down the road ahead — so you read the whole car, not the hood.
    // (Yaw is auto-steered behind the car by city/vehicles.js.)
    if (CBZ.game.mode === "city" && player.driving && !player.dead) {
      introT = 0; prev.copy(player.pos);
      const cfx = -Math.sin(cam.yaw), cfz = -Math.cos(cam.yaw);   // = the car's forward
      const back = 9.5, up = 10.0, ahead = 6.0;
      const tx = player.pos.x - cfx * back, ty = player.pos.y + up, tz = player.pos.z - cfz * back;
      camera.position.x = smoothDamp(camera.position.x, tx, camV.x, 0.12, fdt);
      camera.position.y = smoothDamp(camera.position.y, ty, camV.y, 0.12, fdt);
      camera.position.z = smoothDamp(camera.position.z, tz, camV.z, 0.12, fdt);
      look.x = smoothDamp(look.x, player.pos.x + cfx * ahead, lookV.x, 0.10, fdt);
      look.y = smoothDamp(look.y, player.pos.y + 0.6, lookV.y, 0.10, fdt);
      look.z = smoothDamp(look.z, player.pos.z + cfz * ahead, lookV.z, 0.10, fdt);
      camera.lookAt(look);
      if (shakeAmt > 0.001) { const s = shakeAmt; camera.position.x += (Math.random() - 0.5) * s; camera.position.y += (Math.random() - 0.5) * s; shakeAmt *= Math.pow(0.0006, fdt); if (shakeAmt < 0.01) shakeAmt = 0; }
      fov = smoothDamp(fov, 66, fovV, 0.18, fdt); if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
      return;
    }

    // CITY camera: first-person by default, a third-person cinematic orbit on
    // death (the "WASTED" replay), and plain third-person when you toggle it or
    // hop in a car. city/view.js owns the cityCam state + rig visibility.
    if (CBZ.game.mode === "city" && CBZ.cityCam) {
      const cc = CBZ.cityCam;
      if (cc.death) {                              // cinematic death replay: orbit your body — or your KILLER while spectating
        introT = 0; shakeAmt = 0; cc.death.t += dt;
        // city/death.js sets cc.death.spectate to the live actor that killed you
        // (Fortnite-style kill-cam). Orbit THEM — a touch wider + slower — else
        // orbit your fallen body exactly as before.
        const spec = cc.death.spectate;
        const subj = (spec && spec.pos && !spec.culled && !spec._parked) ? spec.pos : player.pos;
        const watching = subj !== player.pos;
        const ang = (cc.death.ang0 || 0) + cc.death.t * (watching ? 0.45 : 0.8);
        const r = watching ? 6.6 : 5.5, h = watching ? 3.4 : 3.0, ly = watching ? 1.1 : 0.7;
        camera.position.set(subj.x + Math.cos(ang) * r, subj.y + h, subj.z + Math.sin(ang) * r);
        look.set(subj.x, subj.y + ly, subj.z); camera.lookAt(look);
        fov = smoothDamp(fov, 48, fovV, 0.2, fdt); if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
        return;
      }
      if (cc.fp && !player.dead && !player.driving) {   // first-person
        introT = 0; prev.copy(player.pos);
        const eye = player.pos.y + (player.crouch ? 1.22 : 1.66);
        const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
        const fX = -Math.sin(cam.yaw), fZ = -Math.cos(cam.yaw);
        // sit AT the head (not ahead of it) and keep horizontal follow tight so
        // looking around is responsive, but EASE the eye height so stair treads
        // and the door-step don't jolt the whole view up and down.
        camera.position.x = player.pos.x;
        camera.position.z = player.pos.z;
        camera.position.y = smoothDamp(camera.position.y, eye, camV.y, 0.06, fdt);
        const ey = camera.position.y;
        look.set(player.pos.x + fX * cp * 6, ey - sp * 6, player.pos.z + fZ * cp * 6);
        camera.lookAt(look);
        if (shakeAmt > 0.001) { const s = shakeAmt; camera.position.x += (Math.random() - 0.5) * s; camera.position.y += (Math.random() - 0.5) * s; shakeAmt *= Math.pow(0.0006, fdt); if (shakeAmt < 0.01) shakeAmt = 0; }
        // FOV must be ADS-AWARE so this writer and fpsmode.js's ADS writer AGREE.
        // Both run every frame in city first-person (this at onAlways(50), fpsmode
        // at onAlways(52)). If this always eased toward the 70° hip while fpsmode
        // eased toward hip-14 (=56°) on RMB, they tug-of-war'd: the zoom never
        // settled and any per-shot perturbation tipped the unstable equilibrium
        // back toward hip — the "left-click unzooms while holding RMB" bug. Easing
        // toward the SAME 56° target during ADS makes both writers converge, so the
        // zoom holds rock-steady through firing. (Hip 70 / drop 14 mirror fpsmode.)
        const fpHipFov = (CBZ.isADS && CBZ.isADS()) ? 70 - 14 : 70;
        fov = smoothDamp(fov, fpHipFov, fovV, 0.18, fdt); if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
        return;
      }
    }

    // SPECTATE death-cam: slowly orbit the fallen body, drift to a higher,
    // pulled-back framing so you watch the chaos play out.
    if (CBZ.surv && CBZ.surv.spectating) {
      cam.yaw += fdt * 0.22;
      cam.pitch += (0.52 - cam.pitch) * Math.min(1, fdt * 1.5);
      zoomTarget = clampZoom(zoomTarget + (12.5 - zoomTarget) * Math.min(1, fdt * 1.2));
    }
    cam.pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, cam.pitch));

    // player velocity (planar) for look-ahead + FOV kick
    vel.set((player.pos.x - prev.x) / Math.max(dt, 1e-4), 0, (player.pos.z - prev.z) / Math.max(dt, 1e-4));
    prev.copy(player.pos);
    const spd = Math.hypot(vel.x, vel.z);

    if ((CBZ.meleeFocusT || 0) > 0) CBZ.meleeFocusT = Math.max(0, CBZ.meleeFocusT - dt);
    const shoulder = !!(CBZ.weaponThirdPersonActive && CBZ.weaponThirdPersonActive());
    const meleeFocus = !shoulder && (CBZ.meleeFocusT || 0) > 0;
    // driving a car in the city → a wider, higher GTA-style chase (yaw is
    // auto-steered behind the car by city/vehicles.js).
    const driving = CBZ.game.mode === "city" && !!player.driving;
    // CITY ON-FOOT (Fortnite over-shoulder feel): tunables in CBZ.CITY_TP (defined
    // at the top of this file) — lower, closer, over-the-right-shoulder, lazy follow.
    const TP = (CBZ.game.mode === "city" && !driving && CBZ.CITY_TP) ? CBZ.CITY_TP : null;
    // On city ENTRY, settle the orbit pitch to the near-level CITY_TP default
    // (horizon high, not a top-down look-down). Done ONCE per entry so the
    // player's own pitch input is never fought. city/camera.js used to own this
    // hook, but it isn't loaded — so this is the broken-link replacement: without
    // it the city started at DEFAULT_PITCH 0.46 (the filmed "too high" tilt).
    if (TP) {
      if (!_cityPitchInit) { cam.pitch = TP.PITCH; _cityPitchInit = true; }
    } else _cityPitchInit = false;

    // ease the zoom distance toward its target. Normal third person is
    // a wider chase camera; armed third person becomes readable over-shoulder.
    // City scales the wheel-zoom around its own (much closer) default.
    const desiredZoom = TP
      ? (shoulder ? TP.DIST_AIM : (meleeFocus ? TP.DIST * 0.85 : TP.DIST * (zoomTarget / DEF)))
      : (driving ? Math.max(zoomTarget, 11) : (shoulder ? Math.min(zoomTarget, 7.6) : (meleeFocus ? Math.min(zoomTarget, 7.0) : zoomTarget)));
    camDist += (desiredZoom - camDist) * (1 - Math.pow(0.0015, fdt));

    // smoothed rig height (crouch dips the whole rig). Survival frames the
    // player higher — disasters need you to read the ground around you — and
    // sprinting lifts it a touch more instead of letting it sag low.
    const surv = CBZ.game.mode === "survival";
    const sprinting = surv && !!player.sprint;
    const baseHeight = player.crouch ? 1.16 : (driving ? 2.35 : (TP ? (shoulder ? (TP.HEIGHT_AIM != null ? TP.HEIGHT_AIM : TP.HEIGHT + 0.1) : TP.HEIGHT) : (shoulder ? 1.64 : (meleeFocus ? 1.44 : (surv ? (sprinting ? 2.28 : 2.08) : 1.82)))));
    height = smoothDamp(height, baseHeight, heightV, 0.18, fdt);
    const tx = player.pos.x, ty = player.pos.y + height, tz = player.pos.z;
    // city: the rig yaw lazily chases the input yaw (frame-rate independent),
    // so quick mouse flicks read as a smoothed pan instead of a rigid lock.
    // `yaw` frames the BODY/orbit (lazy trail); `yawView` aims the look target.
    // Under feelCam the look target uses LIVE cam.yaw 1:1 (crisp aim) while the
    // body keeps its smYaw trail (cinematic) — rotation instant, body floaty.
    // smYaw integrates on feel-dt so its trail settles in REAL time (at 5 FPS
    // the world-dt version chased at ~25% speed = the "view drags behind my
    // mouse" lag). Off → identical to today (smYaw frames both, world-dt chase).
    let yaw = cam.yaw, yawView = cam.yaw;
    if (TP) {
      if (!smYawOn) { smYaw = cam.yaw; smYawOn = true; }
      const yawDt = CBZ.feelCam ? fdt : dt;
      smYaw += (cam.yaw - smYaw) * (1 - Math.exp(-(shoulder ? TP.DAMP_YAW_AIM : TP.DAMP_YAW) * yawDt));
      yaw = smYaw;
      yawView = CBZ.feelCam ? cam.yaw : smYaw;   // crisp view dir vs lazy body
    } else smYawOn = false;
    const rightX = Math.cos(yaw), rightZ = -Math.sin(yaw);
    const fwdX = -Math.sin(yaw), fwdZ = -Math.cos(yaw);
    const targetSide = TP ? TP.SIDE * 0.25 : (shoulder ? 0.26 : (meleeFocus ? 0.12 : 0));
    const camSide = TP ? (shoulder ? TP.SIDE_AIM : TP.SIDE) : (shoulder ? 0.86 : (meleeFocus ? 0.32 : 0));
    const baseX = tx + rightX * targetSide;
    const baseY = ty + (!TP && shoulder ? 0.08 : 0);
    const baseZ = tz + rightZ * targetSide;

    // orbit offset from yaw/pitch
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const ox = Math.sin(yaw) * cp * camDist;
    const oy = sp * camDist;
    const oz = Math.cos(yaw) * cp * camDist;
    let dx = baseX + ox + rightX * camSide;
    let dy = baseY + oy + (TP ? 0 : (shoulder ? -0.05 : (meleeFocus ? 0.02 : (surv ? 0.34 : 0.14))));
    let dz = baseZ + oz + rightZ * camSide;

    // ---- camera collision (spring-arm): pull the camera in to just before
    // the nearest solid between the player and the desired cam position, so a
    // wall behind you never sits between the camera and the character. We test
    // BOTH the LOS meshes AND a swept-sphere against EVERY solid collider —
    // many walls (the whole prison) aren't LOS-flagged, which is exactly why
    // the camera used to clip straight through them. The sphere radius pads the
    // near-plane so thin walls can't poke through. (Standard third-person
    // camera-collision / boxcast technique.)
    _ro.set(baseX, baseY, baseZ);
    _rd.set(dx - baseX, dy - baseY, dz - baseZ);
    const rayDist = _rd.length();
    _rd.normalize();
    let occ = rayDist;
    raycaster.set(_ro, _rd); raycaster.far = rayDist;
    const hit = raycaster.intersectObjects(CBZ.losBlockers, false);
    if (hit.length > 0 && hit[0].distance < occ) occ = hit[0].distance;
    occ = Math.min(occ, sweepColliders(baseX, baseY, baseZ, _rd.x, _rd.y, _rd.z, rayDist, 0.34));
    if (occ < rayDist) {
      // The DENSE city boxes the camera in on all sides; with a 0.28 floor it
      // slammed to your back every step (a broken first-person feel). Keep a
      // usable third-person distance there — accept a touch of wall clip over a
      // collapsed camera. The open prison/island rarely trigger this, so they
      // keep their tight 0.28 pull-in.
      // City floor keeps the third-person cam usable in the dense grid (a tighter
      // floor slammed it to your back every step). But the armed over-shoulder /
      // ADS tier WANTS to ride in tight (DIST_AIM ~1.45 on RMB) — with the 2.4
      // floor the Fortnite ADS punch-in could never land near a wall. So while
      // armed in the city we relax the floor toward the spring-arm minimum so the
      // tight ADS frame actually happens; the side-offset keeps the character in
      // shot, not buried in the lens.
      // PRIMARY FIX: split the collision floor by ADS state. Resting-armed must
      // NOT collapse tight (a wall behind you in the dense street would yank the
      // boom from 4.8 → ~1.1, ballooning the character + dropping the angle low —
      // THE main 3PS framing bug). Only RMB/ADS may ride in close for the punch-in.
      const minCam = (CBZ.game.mode === "city" && !player.driving)
        ? (shoulder ? ((CBZ.isADS && CBZ.isADS()) ? 1.8 : 2.6) : 3.0)
        : 0.28;
      const d = Math.max(minCam, occ - 0.25);
      dx = baseX + _rd.x * d; dy = baseY + _rd.y * d; dz = baseZ + _rd.z * d;
    }
    // never drop below the surface you're standing on (no looking up through floors)
    dy = Math.max(dy, player.pos.y + 0.35, 0.6);

    // look target leads the player in the direction of travel. In survival we
    // ease the forward lead (a long lead drops the player low in frame when
    // sprinting) and raise the look height so you sit centred, not bottom-third.
    const lead = shoulder ? 0.05 : (meleeFocus ? 0.08 : 0.08);
    // FORTNITE parity (owner reference shots): merely HOLDING a weapon must not
    // reshape the frame — the long 12m aim lead (and the shoulder look height
    // below) apply only while actually scoping (RMB/ADS). Armed-at-rest in the
    // city uses the same LEAD/LOOK_Y as the relaxed chase, so equipping a gun
    // leaves the camera exactly where it was. Jail/survival shoulder (no TP)
    // keeps the old constants.
    const tpADS = !!(TP && shoulder && CBZ.isADS && CBZ.isADS());
    const aimLead = driving ? 8.5 : (shoulder ? (TP ? (tpADS ? 12.0 : TP.LEAD) : 12.0) : (meleeFocus ? 2.2 : (TP ? TP.LEAD : (surv ? 2.4 : 3.6))));
    // The look target carries the VIEW DIRECTION via the aimLead·forward term.
    // Derive that forward/right from yawView (= live cam.yaw under feelCam) so
    // the aim tracks the mouse 1:1; off (or non-TP) yawView===yaw → identical.
    const rightVX = Math.cos(yawView), rightVZ = -Math.sin(yawView);
    const fwdVX = -Math.sin(yawView), fwdVZ = -Math.cos(yawView);
    // ARMED-3PS PITCH FOLLOW (FIX 1 root cause): the over-shoulder look target now
    // tracks the player's pitch so the camera AIMS where you point and the framing
    // stays a stable behind-the-shoulder shot. The camera position already orbits
    // up/down with sin(pitch)*camDist; pulling the look point up by the SAME
    // sin(pitch)·aimLead (and shortening the horizontal lead by cos(pitch)) makes
    // the view pitch with the mouse instead of ballooning the cam up into a
    // top-down stare. Only the armed city tier opts in (pf>0); the relaxed TP
    // chase, driving, melee and jail/survival paths are byte-identical (pf=0).
    const pitchFollow = TP ? (TP.PITCH_LOOK != null ? TP.PITCH_LOOK : 1.0) : 0;
    const aimLeadH = pitchFollow ? aimLead * Math.cos(cam.pitch) : aimLead;
    const ltx = tx + vel.x * lead + rightVX * targetSide + fwdVX * aimLeadH;
    const ltz = tz + vel.z * lead + rightVZ * targetSide + fwdVZ * aimLeadH;
    const lty = player.pos.y + (player.crouch ? (TP ? 1.18 : 1.24) : (driving ? 1.9 : (shoulder ? (TP ? (tpADS ? 1.72 : TP.LOOK_Y) : 1.72) : (meleeFocus ? 1.52 : (TP ? TP.LOOK_Y : (surv ? 2.06 : 1.88))))))
      + (pitchFollow ? Math.sin(cam.pitch) * aimLead * pitchFollow : 0);

    // ---- INTRO: far push-in, then orbit 180 degrees at the final zoom ----
    if (introT > 0) {
      introT -= dt;
      const p = 1 - introT / INTRO;
      const introDist = Math.min(camDist, 7.6);
      const frontPitch = Math.max(cam.pitch, 0.18);
      const frontCp = Math.cos(frontPitch), frontSp = Math.sin(frontPitch);
      if (p < 0.62) {
        const k = p < 0.10 ? 0 : easeInOut((p - 0.10) / 0.52);
        let wx, wy, wz;
        if (introOpts && introOpts.compact) {
          // facing-relative near pull-back (see CBZ.startIntro comment above),
          // clamped inside the room exactly like the front-reveal point below.
          const farDist = introOpts.dist != null ? introOpts.dist : introDist + 1.6;
          introFarPt.set(
            baseX + Math.sin(introYaw0) * frontCp * farDist,
            baseY + frontSp * farDist + 0.85,
            baseZ + Math.cos(introYaw0) * frontCp * farDist
          );
          keepIntroCamInRoom(baseX, baseY, baseZ, introFarPt);
          wx = introFarPt.x; wy = introFarPt.y; wz = introFarPt.z;
        } else {
          wx = player.pos.x - 24; wy = player.pos.y + 34; wz = player.pos.z + 58;
        }
        const frontX = baseX + Math.sin(introYaw0) * frontCp * introDist;
        const frontY = baseY + frontSp * introDist + 0.35;
        const frontZ = baseZ + Math.cos(introYaw0) * frontCp * introDist;
        introPos.set(frontX, frontY, frontZ);
        keepIntroCamInRoom(baseX, baseY, baseZ, introPos);
        camera.position.set(lerp(wx, introPos.x, k), lerp(wy, introPos.y, k), lerp(wz, introPos.z, k));
        look.set(lerp(player.pos.x, ltx, k), lerp(player.pos.y + 1.18, lty, k), lerp(player.pos.z, ltz, k));
      } else {
        const k = easeInOut((p - 0.62) / 0.38);
        const orbitYaw = introYaw0 + Math.PI * k;
        const orbitRightX = Math.cos(orbitYaw), orbitRightZ = -Math.sin(orbitYaw);
        const ocp = Math.cos(frontPitch), osp = Math.sin(frontPitch);
        const oox = Math.sin(orbitYaw) * ocp * introDist;
        const ooy = osp * introDist;
        const ooz = Math.cos(orbitYaw) * ocp * introDist;
        introLook.set(ltx, lty, ltz);
        introPos.set(
          baseX + oox + orbitRightX * camSide,
          baseY + ooy + 0.22 - (shoulder ? 0.34 : (meleeFocus ? 0.16 : 0.06)),
          baseZ + ooz + orbitRightZ * camSide
        );
        keepIntroCamInRoom(baseX, baseY, baseZ, introPos);
        const handoff = easeInOut(Math.max(0, Math.min(1, (k - 0.70) / 0.30)));
        if (handoff > 0) {
          const finalYaw = introYaw0 + Math.PI;
          const fpPitch = Math.max(-0.05, Math.min(0.26, cam.pitch * 0.55));
          const fcp = Math.cos(fpPitch);
          introEye.set(player.pos.x, player.pos.y + (player.crouch ? 1.45 : 2.05), player.pos.z);
          introAim.set(
            introEye.x - Math.sin(finalYaw) * fcp,
            introEye.y + Math.sin(fpPitch),
            introEye.z - Math.cos(finalYaw) * fcp
          );
          introPos.lerp(introEye, handoff);
          introLook.lerp(introAim, handoff);
        }
        camera.position.copy(introPos);
        look.copy(introLook);
      }
      camera.lookAt(look);
      // keep smoothdamp state synced so the hand-off doesn't jolt
      camV.x.v = camV.y.v = camV.z.v = 0; lookV.x.v = lookV.y.v = lookV.z.v = 0;
      if (introT <= 0) {
        introT = 0;
        cam.yaw = introYaw0 + Math.PI;
        introOpts = null;
        if (CBZ.onIntroComplete) CBZ.onIntroComplete();
      }
      return;
    }

    // SmoothDamp the camera toward the desired position. Prison/survival keep
    // the tight track; the city RDR2 cam runs a lazier settle (DAMP_POS) so the
    // follow breathes — aiming snaps back to a tight 0.07 so guns stay crisp.
    // POSITION smoothTime is UNCHANGED (translation stays floaty); we only swap
    // the integration dt → feel-dt so the floaty follow settles in REAL time
    // instead of the ~25%-speed slow-mo the world-clamped dt produced at 5 FPS.
    const posS = TP ? (shoulder ? 0.07 : TP.DAMP_POS) : 0.085;
    camera.position.x = smoothDamp(camera.position.x, dx, camV.x, posS, fdt);
    camera.position.y = smoothDamp(camera.position.y, dy, camV.y, TP ? (shoulder ? 0.08 : TP.DAMP_POS * 1.1) : 0.10, fdt);
    camera.position.z = smoothDamp(camera.position.z, dz, camV.z, posS, fdt);

    // The look target carries the view DIRECTION (its target already tracks live
    // yaw via yawView). Under feelCam we additionally TIGHTEN its smoothTime so
    // the aim snaps toward live yaw (crisp rotation) — but only the look target,
    // NOT the position follow, so translation stays floaty. A small residue
    // (LOOK_TIGHTEN, not zero) keeps player-position noise from jittering the
    // view at low FPS. Off → today's lookS settle on world dt exactly.
    let lookS = TP ? (shoulder ? 0.06 : TP.DAMP_POS * 0.65) : 0.07;
    if (CBZ.feelCam) lookS *= LOOK_TIGHTEN;
    look.x = smoothDamp(look.x, ltx, lookV.x, lookS, fdt);
    look.y = smoothDamp(look.y, lty, lookV.y, lookS * 1.2, fdt);
    look.z = smoothDamp(look.z, ltz, lookV.z, lookS, fdt);
    camera.lookAt(look);

    // screen shake offset, decaying (applied after positioning)
    if (shakeAmt > 0.001) {
      const s = shakeAmt;
      camera.position.x += (Math.random() - 0.5) * s;
      camera.position.y += (Math.random() - 0.5) * s;
      camera.position.z += (Math.random() - 0.5) * s;
      shakeAmt *= Math.pow(0.0006, fdt); // fast decay (real-time under load)
      if (shakeAmt < 0.01) shakeAmt = 0;
    }

    // FOV kick at speed for a sense of pace — wider base + a bigger kick make
    // movement feel quicker without changing the actual move speed.
    // armed-at-rest keeps the default lens + speed kick (Fortnite parity —
    // holding a gun doesn't change the camera); only scoping narrows to FOV_AIM.
    let targetFov = TP
      ? (tpADS ? TP.FOV_AIM : TP.FOV + Math.min(spd / 6, 1) * 5)
      : (shoulder ? 58 + Math.min(spd / 6, 1) * 2.5 : (meleeFocus ? 59 : 61 + Math.min(spd / 6, 1) * 6));
    // a fitted optic (city/gunmods.js + city/scopeview.js) overrides the aimed
    // lens with its own magnification while you're holding aim on foot.
    const scopeF = CBZ.cityScopeFov && CBZ.cityScopeFov();
    if (scopeF) targetFov = scopeF;
    fov = smoothDamp(fov, targetFov, fovV, 0.18, fdt);
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  }

  CBZ.updateCamera = updateCamera;
  CBZ.onAlways(50, updateCamera);

  camera.position.set(CBZ.SPAWN.x, 3.0, CBZ.SPAWN.z + 7);
  camera.lookAt(CBZ.SPAWN.x, 1.0, CBZ.SPAWN.z);
})();
