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

  // ---- CAM_TP_V2 (owner: "TP camera zooms in and out on its own — kill
  // that. Behave like Fortnite: FIXED follow distance, locked over-shoulder
  // offset, rigid orbit around a pivot above the character, aim pulls to a
  // slightly tighter FIXED shoulder view"). Under the flag, city on-foot TP:
  //   · distance is a CONSTANT (DIST 4.0 / ADS 2.4) — no wheel-zoom scaling,
  //     no melee zoom; the only distance changes are the fast fixed-target
  //     ADS punch-in and the collision clamp (both snappy, never a drift);
  //   · FOV is a CONSTANT (60 / ADS 50) — the speed kick is off;
  //   · yaw orbit is RIGID 1:1 with the mouse (no smYaw trail) and the
  //     relaxed tier gets the same pitch-true look target as presenting;
  //   · position/look SmoothDamp collapse to near-rigid so the collision
  //     clamp engages/releases instantly (UE spring-arm behavior) instead of
  //     re-zooming gradually.
  // Also under V2: hold [B] on foot to swing the camera around and view your
  // character from the FRONT (outfit check); release to swing back.
  // FIRST PERSON IS UNTOUCHED: every FP path returns before this tier runs.
  // CAM_VEHICLE_RESTORE: city/view.js force-exits FP when you enter a car and
  // nothing put you back — remember the on-foot view and restore FP on exit.
  if (CBZ.CONFIG.CAM_TP_V2 == null) CBZ.CONFIG.CAM_TP_V2 = true;
  if (CBZ.CONFIG.CAM_VEHICLE_RESTORE == null) CBZ.CONFIG.CAM_VEHICLE_RESTORE = true;

  // ---- CAMERA POLISH PASS (2026-07-19) — each item behind its own flag, all
  // one-line reverts. The V2 personality (rigid boom, constant lens, decisive
  // clamp) is PRESERVED; these remove its rough edges, they don't soften it.
  if (CBZ.CONFIG.CAM_TOUCH_PITCH == null) CBZ.CONFIG.CAM_TOUCH_PITCH = true;         // widened touch-look pitch range hook (touch.js consults it)
  if (CBZ.CONFIG.CAM_OCCLUDE_FADE == null) CBZ.CONFIG.CAM_OCCLUDE_FADE = true;       // occlusion: FOLLOW the wall (floor 3.0→1.6) instead of ballooning; true occluder fade deferred (merged-batch materials can't fade per-group)
  if (CBZ.CONFIG.CAM_TOGGLE_BLEND == null) CBZ.CONFIG.CAM_TOGGLE_BLEND = true;       // FP<->TP toggle: short eased dolly instead of a teleport
  if (CBZ.CONFIG.CAM_VEHICLE_FREELOOK == null) CBZ.CONFIG.CAM_VEHICLE_FREELOOK = true; // driving: mouse-look suspends auto-recenter; hold MMB = look back
  if (CBZ.CONFIG.CAM_AIR_BANK == null) CBZ.CONFIG.CAM_AIR_BANK = true;               // chase cam leans into a fraction of aircraft roll (cars stay level)
  if (CBZ.CONFIG.CAM_SPRINT_FOV == null) CBZ.CONFIG.CAM_SPRINT_FOV = false;          // opt-in sprint FOV swell (+7° over 0.4s). SHIPS DARK — owner disliked auto-zoom; one flag flip to try it
  if (CBZ.CONFIG.CAM_SHOULDER_SWAP == null) CBZ.CONFIG.CAM_SHOULDER_SWAP = true;     // MMB click on foot flips the over-shoulder side (smooth ~0.2s through centre)
  if (CBZ.CONFIG.CAM_FACING_BLEND == null) CBZ.CONFIG.CAM_FACING_BLEND = true;       // draw/holster: body-facing ease ramps in over 0.25s instead of whipping to the new target
  if (CBZ.CONFIG.CAM_TP_BREATHE == null) CBZ.CONFIG.CAM_TP_BREATHE = false;          // taste flag: 0.07s TP position smoothing (rigid 0.02s stays default)

  // ---- CITY THIRD-PERSON FRAMING (Fortnite over-shoulder) — guarded FALLBACK ----
  // src/city/camera.js IS loaded by index.html (later than this file) and is the
  // AUTHORITATIVE tuning surface: it re-assigns CBZ.CITY_TP unconditionally, so
  // any edit made to the copy below is silently overwritten at load time. This
  // guarded copy exists only so the TP path never sees CITY_TP undefined if the
  // city file is ever dropped from the page. TUNE IN src/city/camera.js, NOT HERE.
  if (!CBZ.CITY_TP) CBZ.CITY_TP = {
    // (values mirror src/city/camera.js — the authoritative copy; keep in sync)
    HEIGHT: 1.7,       // rig pivot height — a touch above the head
    DIST: 4.35,        // three-pivot follow boom
    SIDE: 0.68,        // explicit right-shoulder offset
    PITCH: 0.10,       // default orbit pitch on city entry — mild down-gaze
    LOOK_Y: 1.52,      // look-target height above feet
    LEAD: 4.6,         // forward look-ahead
    DAMP_POS: 0.18,    // position SmoothDamp time (lazy settle; mirror of city/camera.js)
    DAMP_YAW: 9.0,     // relaxed yaw chase rate
    DAMP_YAW_AIM: 26,  // yaw chase while armed — near-rigid so aiming never feels mushy
    FOV: 60,           // base FOV
    // ARMED / ADS tier: armed-at-rest = the SAME frame as relaxed (holding a gun
    // doesn't move the camera); only RMB/ADS punches to the tight over-shoulder.
    DIST_AIM_BASE: 4.35, DIST_AIM_ADS: 2.65,
    SIDE_AIM_BASE: 0.68, SIDE_AIM_ADS: 1.12,
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

  // ============================================================
  //  CAMERA POLISH state + public hooks (the CAM_* flags above).
  //  touch.js / touch_vehicle.js consume these by feature-detection.
  // ============================================================
  // Touch third-person pitch range: iPad could barely look up (touch.js's old
  // hard [-0.18, 0.60]); widen toward desktop's [-1.0, 0.9] but stop short —
  // the touch boom at extreme up-pitch near walls is less recoverable without
  // a scroll-wheel escape hatch.
  CBZ.camTouchPitchRange = function () {
    if (CBZ.CONFIG.CAM_TOUCH_PITCH === false) return [-0.18, 0.60];
    // CAM_ADS_PITCH_WIDE: while AIMING on touch, open the envelope toward the
    // desktop range so an iPad can raise/drop the reticle onto high or low
    // targets. Touch-only (this clamp is consumed only by touch.js applyLookDelta).
    if (CBZ.CONFIG.CAM_ADS_PITCH_WIDE !== false && CBZ.isADS && CBZ.isADS()) return [-1.0, 0.9];
    return [-0.85, 0.75];
  };
  // Vehicle free-look (suspends the behind-the-car auto-recenter) + look-back.
  let flHold = false, flT = 0, lookBackHeld = false, lookBackK = 0, bankK = 0;
  CBZ.camFreeLook = function (on) { flHold = !!on; if (on) flT = 0.8; };
  CBZ.camLookBack = function (down) { lookBackHeld = !!down; };
  CBZ.camRecenterSuspended = function () {
    if (CBZ.CONFIG.CAM_VEHICLE_FREELOOK === false) return false;
    return flHold || flT > 0 || lookBackHeld || lookBackK > 0.03;
  };
  // Shoulder swap: MMB on foot (or CBZ.camSetShoulder from touch) flips the
  // over-shoulder side; shoulderK eases through centre so the swap sweeps.
  let shoulderSign = 1, shoulderK = 1;
  CBZ.camSetShoulder = function (v) {
    if (CBZ.CONFIG.CAM_SHOULDER_SWAP === false) return shoulderSign;
    shoulderSign = (v === -1 || v === 1) ? v : -shoulderSign;
    return shoulderSign;
  };
  // FP<->TP toggle blend state (a short eased dolly instead of a teleport).
  let fpPrev = null, blendT = 0;
  const BLEND_T = 0.30;
  const blendFrom = new THREE.Vector3(), blendLook = new THREE.Vector3(), _blScratch = new THREE.Vector3();
  // Draw/holster body-facing ramp: 0→1 over 0.25s after an armed flip, so the
  // body-yaw ease RATE ramps in instead of whipping to its new owner's target.
  let facingArmedPrev = null, facingT = 1, sprintFovK = 0;
  CBZ.camFacingEase = function () {
    if (CBZ.CONFIG.CAM_FACING_BLEND === false) return 1;
    return Math.min(1, Math.max(0.12, facingT / 0.25));
  };
  // MMB: look-back while driving/flying, shoulder swap on foot.
  addEventListener("mousedown", function (e) {
    if (e.button !== 1 || !cam.locked) return;
    const P = CBZ.player;
    if (P && (P.driving || P._aircraft)) { e.preventDefault(); CBZ.camLookBack(true); }
    else if (CBZ.game && CBZ.game.mode === "city" && CBZ.CONFIG.CAM_SHOULDER_SWAP !== false) { e.preventDefault(); CBZ.camSetShoulder(); }
  });
  addEventListener("mouseup", function (e) { if (e.button === 1) CBZ.camLookBack(false); });

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
    // scoped look is proportionally finer (systems/lockon.js real sniper scope)
    const sensMul = CBZ.fpsLookSensMul ? CBZ.fpsLookSensMul() : 1;
    cam.yaw -= e.movementX * SENS * sensMul;
    cam.pitch -= e.movementY * SENS * sensMul;
    // driving/flying: a deliberate mouse glance suspends the behind-the-vehicle
    // auto-recenter for a beat (CAM_VEHICLE_FREELOOK), so you can actually look
    // sideways at speed; it decays back to the chase ~0.8s after you stop.
    if (CBZ.CONFIG.CAM_VEHICLE_FREELOOK !== false && CBZ.player && (CBZ.player.driving || CBZ.player._aircraft) &&
        (Math.abs(e.movementX) + Math.abs(e.movementY)) > 1) flT = 0.8;
    // soft tier clamp, then a hard safety so |pitch| can never reach π/2
    cam.pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, cam.pitch));
    cam.pitch = Math.max(-PITCH_SAFETY, Math.min(PITCH_SAFETY, cam.pitch));
  });
  // ---- FRONT VIEW (hold [B]): swing the orbit 180° to face your character —
  // outfit/loadout check, Fortnite locker-style. Hold-to-view (release swings
  // back); only reachable in the city on-foot TP tier below, and never while
  // presenting a weapon (aim always wins). Pointer lock gates it so a stray
  // B in menus/typing does nothing. frontK eases 0↔1 and simply ADDS π·frontK
  // to the orbit yaw while collapsing the forward look-lead, so the camera
  // sweeps around and settles looking back at the character.
  let frontHeld = false, frontK = 0;
  document.addEventListener("keydown", (e) => {
    if (e.code === "KeyB" && cam.locked && !e.repeat) frontHeld = true;
  });
  document.addEventListener("keyup", (e) => {
    if (e.code === "KeyB") frontHeld = false;
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
  const cineV = { x: { v: 0 }, y: { v: 0 }, z: { v: 0 } };            // scripted-scene dolly
  const _cineLook = new THREE.Vector3();                              // scripted-scene look ease
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
  // vehicle view memory (CAM_VEHICLE_RESTORE): was the player in FP on foot?
  let _drvPrev = false, _fpOnFoot = false, _preDriveFP = false;

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
      const hit = CBZ.losRaycast ? CBZ.losRaycast(raycaster, CBZ.losBlockers) : raycaster.intersectObjects(CBZ.losBlockers, false);
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
  // Broadphase (perf): the camera arm is a few metres, but this used to slab-
  // test EVERY collider (~82k in the city) every frame — measured ~5.4ms. Query
  // the collider grid around the arm's midpoint instead; the radius covers the
  // whole segment so behaviour is identical, the candidate list is O(local).
  const _sweepNear = [];
  function sweepColliders(ox, oy, oz, dx, dy, dz, dist, rad) {
    let best = dist;
    const cs = CBZ.queryCollidersNear
      ? CBZ.queryCollidersNear(ox + dx * dist * 0.5, oz + dz * dist * 0.5, dist * 0.5 + rad + 1, _sweepNear)
      : CBZ.colliders;
    const sweepCityOn = !CBZ.game || CBZ.game.mode === "city";
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      if (c.noCam) continue;
      if (c._city && !sweepCityOn) continue;   // hidden city geometry never grabs the jail camera
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

  // FP<->TP TOGGLE BLEND (CAM_TOGGLE_BLEND): the eye and the 4m boom used to
  // hard-teleport on [V]/the touch eye button. While blendT runs, the frame
  // eases from the captured outgoing transform to the incoming rig's live
  // target (smoothstep) — a ~0.3s dolly. Runs on the wall clock so a low frame
  // rate can't stretch it into a cutscene.
  function applyToggleBlend() {
    if (blendT <= 0) return;
    blendT -= (CBZ.wallDt != null ? CBZ.wallDt : 0.016);
    if (blendT <= 0) { blendT = 0; return; }
    const p = 1 - blendT / BLEND_T;
    const k = p * p * (3 - 2 * p);
    _blScratch.copy(camera.position);
    camera.position.copy(blendFrom).lerp(_blScratch, k);
    _blScratch.copy(look);
    look.copy(blendLook).lerp(_blScratch, k);
    camera.lookAt(look);
  }

  function updateCamera(dt) {
    // FEEL-DT: the real-wall-clock present delta for camera settle (graceful —
    // falls back to the passed world dt if loop.js hasn't published feelDt or
    // CBZ.feelMotion is off). Gated by feelCam so the whole feel pass reverts
    // cleanly: when feelCam is off we settle on the world dt exactly as today.
    // Used ONLY for time-integration of the damps/exp-chase below; the velocity
    // calc keeps the world dt so look-ahead/FOV pacing is unchanged.
    const fdt = (CBZ.feelCam && CBZ.feelDt != null) ? CBZ.feelDt : dt;
    // ---- CAMERA POLISH per-frame state (cheap, runs in every branch) ----
    if (flT > 0 && !flHold) flT = Math.max(0, flT - fdt);          // free-look decay after the glance
    lookBackK += ((lookBackHeld ? 1 : 0) - lookBackK) * (1 - Math.exp(-11 * fdt));
    if (lookBackK < 0.001) lookBackK = 0;
    shoulderK += ((CBZ.CONFIG.CAM_SHOULDER_SWAP === false ? 1 : shoulderSign) - shoulderK) * (1 - Math.exp(-9 * fdt));
    {  // draw/holster facing ramp: reset on the armed flip, ramp back over 0.25s
      const armedNow = !!(CBZ.weaponThirdPersonActive && CBZ.weaponThirdPersonActive());
      if (facingArmedPrev === null) facingArmedPrev = armedNow;
      else if (armedNow !== facingArmedPrev) { facingArmedPrev = armedNow; facingT = 0; }
      if (facingT < 1) facingT = Math.min(1, facingT + fdt);
    }
    // ---- VEHICLE VIEW MEMORY: city/view.js force-drops FP the moment you
    // drive (the car owns the camera) and nothing ever restored it — every
    // car ride silently dumped an FP player into third person. Track the
    // on-foot view each frame; on the enter-edge remember it (the previous
    // frame's value — captured BEFORE view.js's forced setFPS(false)), on the
    // exit-edge give FP back. Guard-called; CAM_VEHICLE_RESTORE=false reverts.
    if (CBZ.CONFIG.CAM_VEHICLE_RESTORE !== false && CBZ.game.mode === "city") {
      const drv = !!player.driving;
      if (drv && !_drvPrev) _preDriveFP = _fpOnFoot;
      if (!drv && _drvPrev && _preDriveFP && !player.dead &&
          CBZ.game.state === "playing" && !(CBZ.cityCam && CBZ.cityCam.death) &&
          CBZ.setFPS && CBZ.fps && !CBZ.fps.active) CBZ.setFPS(true);
      if (!drv) _fpOnFoot = !!(CBZ.fps && CBZ.fps.active);
      _drvPrev = drv;
    } else _drvPrev = !!player.driving;
    // BIRD'S-EYE SOCIETY VIEW: a strategic camera for the math-only mass
    // simulation. It intentionally bypasses spring-arm collision and close
    // camera effects; the player remains frozen while the prison keeps living.
    // SCRIPTED CINEMATIC (city/cinematics.js): an authored scene owns the lens
    // outright — damped dolly toward the shot's position/look, hard snap on a
    // CUT. Highest priority: a cutscene must win over FP/driving/shoulder.
    const cc0 = CBZ.cineCam;
    if (cc0 && cc0.active) {
      introT = 0; prev.copy(player.pos); shakeAmt = 0;
      if (cc0.snap) {
        cc0.snap = false;
        camera.position.set(cc0.x, cc0.y, cc0.z);
        cineV.x.v = cineV.y.v = cineV.z.v = 0;
        _cineLook.set(cc0.lx, cc0.ly, cc0.lz);
      } else {
        camera.position.x = smoothDamp(camera.position.x, cc0.x, cineV.x, 0.34, fdt);
        camera.position.y = smoothDamp(camera.position.y, cc0.y, cineV.y, 0.34, fdt);
        camera.position.z = smoothDamp(camera.position.z, cc0.z, cineV.z, 0.34, fdt);
      }
      _cineLook.x += (cc0.lx - _cineLook.x) * (1 - Math.exp(-6 * fdt));
      _cineLook.y += (cc0.ly - _cineLook.y) * (1 - Math.exp(-6 * fdt));
      _cineLook.z += (cc0.lz - _cineLook.z) * (1 - Math.exp(-6 * fdt));
      camera.lookAt(_cineLook);
      return;
    }
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
      // LOOK-BACK (CAM_VEHICLE_FREELOOK): lookBackK eases 0↔1 and swings the
      // whole chase 180° — hold MMB (or the touch LOOK BACK pill) to check your
      // six, release to whip forward again.
      const vyaw = cam.yaw + Math.PI * lookBackK;
      const cfx = -Math.sin(vyaw), cfz = -Math.cos(vyaw);   // = the chase forward
      // Aircraft publish framing dimensions. A fixed car-sized 9.5m boom sat
      // inside a 30m commercial airliner, so the "third-person" hijack view was
      // mostly tail/fuselage. Cars and older craft keep the exact defaults.
      const craft = player._aircraft;
      const back = craft && craft.cameraBack != null ? craft.cameraBack : 9.5;
      const up = craft && craft.cameraUp != null ? craft.cameraUp : 10.0;
      const ahead = craft && craft.cameraAhead != null ? craft.cameraAhead : 6.0;
      const tx = player.pos.x - cfx * back, ty = player.pos.y + up, tz = player.pos.z - cfz * back;
      // AIRCRAFT FOLLOW AT SPEED (FLIGHT_SPEED_V2): a fixed 0.12s boom lags
      // ~smoothTime·speed behind its target, so at the new jet top speeds the
      // craft would drift toward the frame edge. Shrink the follow time as speed
      // rises so the chase stays tight; cars (no craft published) keep 0.12/0.10.
      // The floor dropped 0.05→0.03 when the jet cap doubled to 420: the old
      // floor was reached by ~200 m/s, so 200→420 got NO extra tightening and the
      // lag doubled (~21m). The 0.03 floor (reached ~250 m/s, slopes unchanged so
      // ≤200 m/s is byte-identical) halves that back to ~12m — 420 frames about
      // as tightly as 210 used to. A rocket only shrinks it further, still clamped.
      const airSpd = craft ? (craft.speed || 0) : 0;
      const fastAir = craft && (!CBZ.CONFIG || CBZ.CONFIG.FLIGHT_SPEED_V2 !== false);
      const posS = fastAir ? Math.max(0.03, 0.12 - airSpd * 0.00035) : 0.12;
      const lookSf = fastAir ? Math.max(0.03, 0.10 - airSpd * 0.00028) : 0.10;
      camera.position.x = smoothDamp(camera.position.x, tx, camV.x, posS, fdt);
      camera.position.y = smoothDamp(camera.position.y, ty, camV.y, posS, fdt);
      camera.position.z = smoothDamp(camera.position.z, tz, camV.z, posS, fdt);
      look.x = smoothDamp(look.x, player.pos.x + cfx * ahead, lookV.x, lookSf, fdt);
      look.y = smoothDamp(look.y, player.pos.y + 0.6, lookV.y, lookSf, fdt);
      look.z = smoothDamp(look.z, player.pos.z + cfz * ahead, lookV.z, lookSf, fdt);
      camera.lookAt(look);
      if (shakeAmt > 0.001) { const s = shakeAmt; camera.position.x += (Math.random() - 0.5) * s; camera.position.y += (Math.random() - 0.5) * s; shakeAmt *= Math.pow(0.0006, fdt); if (shakeAmt < 0.01) shakeAmt = 0; }
      fov = smoothDamp(fov, 66, fovV, 0.18, fdt); if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
      // AIRCRAFT BANK (CAM_AIR_BANK): lean the chase camera into a fraction of
      // the craft's roll — you feel the bank without the horizon whipping.
      // Cars publish no roll → bankK eases back to level. rotateZ runs AFTER
      // lookAt, so it tilts about the live view axis.
      if (CBZ.CONFIG.CAM_AIR_BANK !== false) {
        const tBank = craft ? Math.max(-0.35, Math.min(0.35, (craft.roll || 0) * 0.42)) : 0;
        bankK += (tBank - bankK) * (1 - Math.exp(-7 * fdt));
        if (Math.abs(bankK) > 0.0006) camera.rotateZ(bankK);
      } else bankK = 0;
      return;
    }

    // CITY camera: first-person by default, a third-person cinematic orbit on
    // death (the "WASTED" replay), and plain third-person when you toggle it or
    // hop in a car. city/view.js owns the cityCam state + rig visibility.
    if (CBZ.game.mode === "city" && CBZ.cityCam) {
      const cc = CBZ.cityCam;
      // arm the FP<->TP blend on the toggle edge (never during death/intro/scope)
      if (CBZ.CONFIG.CAM_TOGGLE_BLEND !== false) {
        const fpNow = !!(cc.fp && !player.dead && !player.driving);
        if (fpPrev === null) fpPrev = fpNow;
        else if (fpNow !== fpPrev) {
          fpPrev = fpNow;
          const scoped = CBZ.fpsScoped && CBZ.fpsScoped();
          if (!cc.death && introT <= 0 && !scoped) {
            blendT = BLEND_T; blendFrom.copy(camera.position); blendLook.copy(look);
          }
        }
      } else { fpPrev = null; blendT = 0; }
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
        const eye = player.pos.y + (player.prone ? 0.60 : player.crouch ? 1.22 : 1.66);   // prone (physics stance) = cheek on the deck
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
        // A LIVE SCOPE outranks the hip/ADS pair for the same reason: while the
        // factory sniper's real scope (lockon.js, fpsScopeFov) or a fitted
        // gunsmith optic (scopeview.js, cityScopeFov) is up, easing toward 70/56
        // here while fpsmode eased toward the scope's lens was the EXACT same
        // tug-of-war — the zoom never landed, "holding the scope but just looking
        // down the sights". Same precedence as fpsmode's block: lockon returns
        // null whenever a gunsmith optic owns the weapon, so exactly one wins.
        const fpScopeF = (CBZ.fpsScopeFov && CBZ.fpsScopeFov()) || (CBZ.cityScopeFov && CBZ.cityScopeFov());
        const fpHipFov = fpScopeF ? fpScopeF : ((CBZ.isADS && CBZ.isADS()) ? 70 - 14 : 70);
        fov = smoothDamp(fov, fpHipFov, fovV, 0.18, fdt); if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
        applyToggleBlend();          // ease in from the third-person boom on toggle
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

    // ADS-GATED CAMERA TIER (owner: "third person moves too much"): merely
    // OWNING an un-holstered gun used to flip every twitchy armed-tier switch
    // below — yaw snap 9→26, position damp 0.16→0.07, look damp →0.06,
    // pitch-follow 0→1, collision floor 3.0→2.6 — and the default city loadout
    // arms you at spawn, so the relaxed tier effectively never ran. tpPresent
    // narrows those switches to ACTUAL presenting: RMB/ADS, firing, or the
    // short post-shot settle (CBZ.tpPresenting, systems/fpsmode.js — honors
    // CBZ.CONFIG.CITY_TP_ADS_CAMERA; false = old merely-armed gate). Framing
    // (DIST/SIDE/FOV/HEIGHT + their _AIM_BASE twins) already ignores
    // merely-armed by design and keeps reading `shoulder`/`tpADS` unchanged.
    // Non-city shoulder (jail/survival, TP=null) keeps the old gate exactly.
    const tpPresent = shoulder && (!TP || !CBZ.tpPresenting || CBZ.tpPresenting());

    // ease the zoom distance toward its target. Normal third person is
    // a wider chase camera; armed third person becomes readable over-shoulder.
    // City scales the wheel-zoom around its own (much closer) default.
    const desiredZoom = TP
      ? (CBZ.CONFIG.CAM_TP_V2
          // FORTNITE LOCK: the boom is a constant — DIST at rest and merely-
          // armed, DIST_AIM_ADS only while scoping (fixed targets; the fast
          // ease below is the whole ADS punch-in). Wheel + melee zoom are out.
          ? (shoulder ? TP.DIST_AIM : TP.DIST)
          : (shoulder ? TP.DIST_AIM : (meleeFocus ? TP.DIST * 0.85 : TP.DIST * (zoomTarget / DEF))))
      : (driving ? Math.max(zoomTarget, 11) : (shoulder ? Math.min(zoomTarget, 7.6) : (meleeFocus ? Math.min(zoomTarget, 7.0) : zoomTarget)));
    camDist += (desiredZoom - camDist) * (1 - Math.pow(0.0015, fdt));

    // smoothed rig height (crouch dips the whole rig). Survival frames the
    // player higher — disasters need you to read the ground around you — and
    // sprinting lifts it a touch more instead of letting it sag low.
    const surv = CBZ.game.mode === "survival";
    const sprinting = surv && !!player.sprint;
    const baseHeight = player.prone ? 0.74 : (player.crouch ? 1.16 : (driving ? 2.35 : (TP ? (shoulder ? (TP.HEIGHT_AIM != null ? TP.HEIGHT_AIM : TP.HEIGHT + 0.1) : TP.HEIGHT) : (shoulder ? 1.64 : (meleeFocus ? 1.44 : (surv ? (sprinting ? 2.28 : 2.08) : 1.82))))));
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
      let campaignTP = false;
      try { campaignTP = !!(CBZ.cityCampaignActive && CBZ.cityCampaignActive()); } catch (e) {}
      if (campaignTP || CBZ.CONFIG.CAM_TP_V2) {
        // Campaign movement is calculated from cam.yaw in physics.js. Framing
        // the visible orbit from a different, delayed smYaw made WASD and the
        // camera disagree about "forward": the body drifted off-axis while the
        // lens swung around it, which read as movement controlling the camera.
        // One yaw now owns input, orbit, look target, and shoulder aim.
        // CAM_TP_V2 adopts the same RIGID orbit everywhere in the city —
        // Fortnite's camera has no yaw trail; the mouse IS the orbit.
        smYaw = cam.yaw; smYawOn = true;
        yaw = yawView = cam.yaw;
      } else {
        if (!smYawOn) { smYaw = cam.yaw; smYawOn = true; }
        const yawDt = CBZ.feelCam ? fdt : dt;
        smYaw += (cam.yaw - smYaw) * (1 - Math.exp(-(tpPresent ? TP.DAMP_YAW_AIM : TP.DAMP_YAW) * yawDt));
        yaw = smYaw;
        yawView = CBZ.feelCam ? cam.yaw : smYaw;   // crisp view dir vs lazy body
      }
    } else smYawOn = false;
    // ---- FRONT VIEW (hold [B], city on-foot TP only): ease frontK 0↔1 and
    // add π·frontK to BOTH yaws — the orbit sweeps smoothly around to the
    // character's face and back. Presenting a weapon vetoes it (aim wins);
    // losing pointer lock releases a stuck key. The look-lead collapse that
    // re-centres the character happens at aimLead/pitchFollow below.
    if (!cam.locked) frontHeld = false;
    const frontWant = (frontHeld && TP && !tpPresent && !player.driving && !player.dead) ? 1 : 0;
    frontK += (frontWant - frontK) * (1 - Math.exp(-9 * fdt));
    if (frontK < 0.0005) frontK = 0;
    if (frontK > 0) { yaw += Math.PI * frontK; yawView += Math.PI * frontK; }
    const rightX = Math.cos(yaw), rightZ = -Math.sin(yaw);
    const fwdX = -Math.sin(yaw), fwdZ = -Math.cos(yaw);
    // SHOULDER SWAP (CAM_SHOULDER_SWAP): shoulderK eases -1↔1 through centre,
    // flipping the whole side-offset family (framing AND aim offsets together
    // so the ADS punch-in lands over whichever shoulder is active).
    const sK = TP ? shoulderK : 1;
    const targetSide = (TP ? (shoulder ? TP.SIDE_AIM * 0.22 : TP.SIDE * 0.25) : (shoulder ? 0.26 : (meleeFocus ? 0.12 : 0))) * sK;
    const camSide = (TP ? (shoulder ? TP.SIDE_AIM : TP.SIDE) : (shoulder ? 0.86 : (meleeFocus ? 0.32 : 0))) * sK;
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
    const hit = CBZ.losRaycast ? CBZ.losRaycast(raycaster, CBZ.losBlockers) : raycaster.intersectObjects(CBZ.losBlockers, false);
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
      // CAM_OCCLUDE_FADE: the old floors (3.0/2.6) refused to follow the wall,
      // so a wall behind you BALLOONED the character (boom pinned at floor) or
      // clipped. Under the flag the boom FOLLOWS the wall down to a tight 1.5
      // instead — Minecraft-style "the camera respects walls" — which kills the
      // balloon pop. (A true occluder fade is deferred: per-group opacity isn't
      // affordable on merged batch materials; follow-the-wall is the honest v1.)
      const noBalloon = CBZ.CONFIG.CAM_OCCLUDE_FADE !== false && TP;
      const minCam = (CBZ.game.mode === "city" && !player.driving)
        ? (tpPresent ? ((CBZ.isADS && CBZ.isADS()) ? (noBalloon ? 1.5 : 1.8) : (noBalloon ? 1.5 : 2.6)) : (noBalloon ? 1.6 : 3.0))
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
    // front view: the forward look-lead collapses with frontK so the camera
    // settles looking AT the character (LOOK_Y height), not past them.
    const aimLead = (driving ? 8.5 : (shoulder ? (TP ? (tpADS ? 12.0 : TP.LEAD) : 12.0) : (meleeFocus ? 2.2 : (TP ? TP.LEAD : (surv ? 2.4 : 3.6))))) * (1 - frontK);
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
    // Only the armed shoulder needs its far aim target to carry pitch. Applying
    // this to relaxed third person as well double-pitched the orbit/look target
    // and made ordinary mouse-look change the character's screen framing.
    // (Gated on tpPresent: merely-armed is the relaxed chase now, so it must
    // stay pitch-blind like unarmed; presenting restores the pitch-true aim.)
    // CAM_TP_V2: the RELAXED tier gets the SAME pitch-true look target — the
    // pitch-blind relaxed math was the "weird" TP feel (mouse-up ballooned the
    // camera into a top-down stare instead of pitching the view). With
    // aimLead(4.6) ≈ camDist(4.0) the look target and the orbit rise together,
    // so the view pitches ~1:1 with the mouse and the character stays framed —
    // exactly the presenting-tier math the owner already liked. A partial
    // factor would be WORSE, not safer: below aimLead·pf = camDist (pf≈0.87)
    // the vertical response INVERTS (look-up pitches the view down).
    const pitchFollow = (TP && (tpPresent || CBZ.CONFIG.CAM_TP_V2))
      ? (TP.PITCH_LOOK != null ? TP.PITCH_LOOK : 1.0) * (1 - frontK)
      : 0;
    const aimLeadH = pitchFollow ? aimLead * Math.cos(cam.pitch) : aimLead;
    const ltx = tx + vel.x * lead + rightVX * targetSide + fwdVX * aimLeadH;
    const ltz = tz + vel.z * lead + rightVZ * targetSide + fwdVZ * aimLeadH;
    const lty = player.pos.y + (player.prone ? 0.62 : (player.crouch ? (TP ? 1.18 : 1.24) : (driving ? 1.9 : (shoulder ? (TP ? (tpADS ? 1.72 : TP.LOOK_Y) : 1.72) : (meleeFocus ? 1.52 : (TP ? TP.LOOK_Y : (surv ? 2.06 : 1.88)))))))
      + (pitchFollow ? Math.sin(cam.pitch) * aimLead * pitchFollow : 0);

    // ---- INTRO: far push-in, then orbit 180 degrees at the final zoom ----
    if (introT > 0) {
      // Cinematic duration is presentation time, not the bounded world clock;
      // a low frame rate must not turn the 3.55s arrival into a 14s lockout.
      introT -= (CBZ.wallDt != null ? CBZ.wallDt : fdt);
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
        // Legacy intros finish by pushing all the way into the player's eyes,
        // ready for fpsmode's handoff.  Campaign prison uses one continuous
        // third-person grammar, so retain the close orbit instead of briefly
        // becoming a first-person camera before springing back out.
        if (handoff > 0 && !(introOpts && introOpts.keepThirdPerson)) {
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
    // CAM_TP_V2: near-rigid position follow (0.02s) — Fortnite's boom has no
    // positional lag, and the rigidity is ALSO what makes the collision clamp
    // engage/release instantly instead of the old 0.18s drift that read as
    // "the camera zooms in and out on its own" next to every wall.
    // CAM_TP_BREATHE (taste flag, ships dark): 0.07s smoothing gives the rigid
    // V2 boom a slight breath; default stays the decisive 0.02s.
    const breathe = TP && CBZ.CONFIG.CAM_TP_V2 && CBZ.CONFIG.CAM_TP_BREATHE;
    const posS = TP ? (CBZ.CONFIG.CAM_TP_V2 ? (breathe ? 0.07 : 0.02) : (tpPresent ? 0.07 : TP.DAMP_POS)) : 0.085;
    camera.position.x = smoothDamp(camera.position.x, dx, camV.x, posS, fdt);
    camera.position.y = smoothDamp(camera.position.y, dy, camV.y, TP ? (CBZ.CONFIG.CAM_TP_V2 ? (breathe ? 0.075 : 0.025) : (tpPresent ? 0.08 : TP.DAMP_POS * 1.1)) : 0.10, fdt);
    camera.position.z = smoothDamp(camera.position.z, dz, camV.z, posS, fdt);

    // The look target carries the view DIRECTION (its target already tracks live
    // yaw via yawView). Under feelCam we additionally TIGHTEN its smoothTime so
    // the aim snaps toward live yaw (crisp rotation) — but only the look target,
    // NOT the position follow, so translation stays floaty. A small residue
    // (LOOK_TIGHTEN, not zero) keeps player-position noise from jittering the
    // view at low FPS. Off → today's lookS settle on world dt exactly.
    let lookS = TP ? (CBZ.CONFIG.CAM_TP_V2 ? 0.02 : (tpPresent ? 0.06 : TP.DAMP_POS * 0.65)) : 0.07;
    if (CBZ.feelCam) lookS *= LOOK_TIGHTEN;
    look.x = smoothDamp(look.x, ltx, lookV.x, lookS, fdt);
    look.y = smoothDamp(look.y, lty, lookV.y, lookS * 1.2, fdt);
    look.z = smoothDamp(look.z, ltz, lookV.z, lookS, fdt);
    camera.lookAt(look);
    applyToggleBlend();          // ease out from the first-person eye on toggle

    // screen shake offset, decaying (applied after positioning). City on-foot
    // TP takes shake at 60% unless actively presenting a weapon — FP never
    // receives CBZ.shake at all, so full-strength TP shake read as a camera
    // that never sits still while just walking around (owner complaint). The
    // decay still runs on the full shakeAmt, so timing is unchanged.
    if (shakeAmt > 0.001) {
      const s = shakeAmt * (TP && !tpPresent ? 0.6 : 1);
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
    // CAM_TP_V2: the lens is a CONSTANT (60 hip / 50 ADS) — Fortnite never
    // changes FOV with speed, and the ±5° sprint kick was half of the
    // "camera zooms on its own" complaint.
    let targetFov = TP
      ? (tpADS ? TP.FOV_AIM : (CBZ.CONFIG.CAM_TP_V2 ? TP.FOV : TP.FOV + Math.min(spd / 6, 1) * 5))
      : (shoulder ? 58 + Math.min(spd / 6, 1) * 2.5 : (meleeFocus ? 59 : 61 + Math.min(spd / 6, 1) * 6));
    // CAM_SPRINT_FOV (ships dark — flip to try): the Fortnite-style lens
    // breath — while genuinely sprinting the FOV swells +7° over ~0.4s and
    // eases back on stop. Decoupled from the collision clamp (the coupling was
    // what made the old speed-kick read as "zooms on its own"). Never during ADS.
    if (TP && CBZ.CONFIG.CAM_SPRINT_FOV && !tpADS) {
      const sprintingNow = !!(CBZ.keys && CBZ.keys["shift"]) && spd > 4.2 && !player.crouch;
      sprintFovK += ((sprintingNow ? 1 : 0) - sprintFovK) * (1 - Math.exp(-6 * fdt));
      targetFov += 7 * sprintFovK;
    } else sprintFovK = 0;
    // a LIVE SCOPE overrides the aimed lens with its own magnification while
    // you're holding aim on foot: the factory sniper's real scope (lockon.js,
    // fpsScopeFov — e.g. still engaged after a [V] toggle back to third person)
    // outranks nothing but itself, because it returns null whenever a fitted
    // gunsmith optic (city/gunmods.js + city/scopeview.js, cityScopeFov) owns
    // the weapon — the fitted optic wins its magnification, exactly one is
    // ever non-null (same precedence as fpsmode.js's FP FOV block). This tail
    // honoring only cityScopeFov was the third-person half of the fake-scope
    // bug: overlay up, lens easing back to the 50° ADS chase every frame.
    const scopeF = (CBZ.fpsScopeFov && CBZ.fpsScopeFov()) || (CBZ.cityScopeFov && CBZ.cityScopeFov());
    if (scopeF) targetFov = scopeF;
    // V2: snappier ADS lens punch (~0.12s, Fortnite's targeting transition)
    fov = smoothDamp(fov, targetFov, fovV, TP && CBZ.CONFIG.CAM_TP_V2 ? 0.12 : 0.18, fdt);
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  }

  CBZ.updateCamera = updateCamera;
  CBZ.onAlways(50, updateCamera);

  camera.position.set(CBZ.SPAWN.x, 3.0, CBZ.SPAWN.z + 7);
  camera.lookAt(CBZ.SPAWN.x, 1.0, CBZ.SPAWN.z);
})();
