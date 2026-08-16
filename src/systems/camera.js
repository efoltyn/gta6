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

  // ---- RDR2 ORBIT PASS (2026-08-03) — three owner complaints, one root ----
  // OWNER: (1) "I can't look all the way to the sky — a helicopter overhead is
  // unfindable"; (2) "looking up also changes the angle" — pitching should be a
  // clean orbit, not a reframing; (3) in a small room the camera should come IN
  // over the shoulder, smoothly, the way RDR2 does when you cross a doorway.
  //
  // (1) and (2) are the SAME arithmetic fault and it is measurable. The look
  // target used to be `LOOK_Y + sin(pitch)*LEAD` while the camera orbits to
  // `HEIGHT + sin(pitch)*DIST` — both move the SAME way, so the view direction
  // barely tilts at all. With the shipped city numbers (HEIGHT 1.7 / DIST 4.35 /
  // LOOK_Y 1.52 / LEAD 4.6) a full -1.0 rad (57°) mouse-up produced a view
  // pitched **4.6° up**: a 12:1 loss. The file's own comment predicted this
  // ("below aimLead·pf = camDist the vertical response INVERTS") and then landed
  // the tier 0.25 m above the inversion point. Meanwhile the camera really DID
  // swing under the pavement, where `dy = max(dy, ground+0.35)` pinned it — so
  // looking up put the lens at your heels, level, staring at your shins. There
  // was no sky in the frame because the frame never pointed at any.
  //
  // The answer is the textbook one and it deletes tuning rather than adding it:
  // a PURE ORBIT. The look target is anchored to the SAME pivot the camera
  // orbits and pushed along the mouse's own direction, so the view direction IS
  // the mouse direction (1:1, no gain, no inversion) and the character's place
  // in frame is INVARIANT to pitch — which is complaint (2) answered exactly.
  // The framing that offset is worth is preserved, not re-tasted: the constant
  // screen tilt is DERIVED each frame from the tier's own resting constants, so
  // at its resting pitch every tier frames identically to today.
  //   CAM_RDR2_ORBIT — the orbit + the widened up-pitch + the floor-aware boom
  //   CAM_ROOM_BOOM  — the interior pull-in (probes + damped boom/pivot)
  // FIRST PERSON IS SACRED: the FP branch returns long before any of this, and
  // pitchLimits() hands FP the untouched legacy envelope.
  if (CBZ.CONFIG.CAM_RDR2_ORBIT == null) CBZ.CONFIG.CAM_RDR2_ORBIT = true;
  if (CBZ.CONFIG.CAM_ROOM_BOOM == null) CBZ.CONFIG.CAM_ROOM_BOOM = true;

  // ---- TOUCH_TP_CAMERA_V2 (owner, 2026-07-28: "iPad needs third person
  // improved"). THE ROOT FINDING, and it is arithmetic rather than taste:
  // CBZ.camZoom has exactly ONE non-desktop caller in the whole repo —
  // touch.js's pinch — and under CAM_TP_V2 (default ON since the Fortnite pass)
  // the city on-foot boom is a CONSTANT (`shoulder ? TP.DIST_AIM : TP.DIST`)
  // that never reads zoomTarget, while the city driving/flying branch returns
  // early on its own fixed `cameraBack`. So **pinch-to-zoom has been a dead
  // gesture in the entire city — on foot AND in every vehicle — since the day
  // the boom was locked.** It still works in survival/jail because those tiers
  // are the only ones that still read zoomTarget.
  //
  // The fix does NOT re-open the wheel-zoom the owner asked to have killed: the
  // constant boom stays the constant boom, and touch gets a separate multiplier
  // (`tpTrim`) that ONLY a real pinch can move, clamped, reset with the zoom,
  // and never applied while ADS (the ADS punch-in is a fixed target by design —
  // a trimmed one would be a different bug of the same family).
  //   CAM_TP_TOUCH_ZOOM    — the pinch trim itself
  //   CAM_TOUCH_RECENTER   — CBZ.camRecenter(): level the view / hand the yaw
  //                          back to the vehicle's own auto-recenter
  //   CAM_TOUCH_PITCH_FULL — the touch TP pitch envelope opens to the desktop
  //                          range now that touch HAS an escape hatch (see
  //                          camTouchPitchRange for the whole argument)
  if (CBZ.CONFIG.TOUCH_TP_CAMERA_V2 == null) CBZ.CONFIG.TOUCH_TP_CAMERA_V2 = true;
  if (CBZ.CONFIG.CAM_TP_TOUCH_ZOOM == null) CBZ.CONFIG.CAM_TP_TOUCH_ZOOM = true;
  // DEFAULT OFF as of 2026-08-04 (owner: take the recenter button off the
  // iPad). This flag owns the MANUAL action and its two buttons only; the
  // vehicle's automatic recenter is a different writer (camRecenterSuspended,
  // in vehicles/playeraircraft/water_helm) and still runs. camRecenter() is
  // called from nowhere but #trecen and #tvRecen, so off = the buttons are
  // gone and the seam refuses, rather than a live control that no-ops.
  if (CBZ.CONFIG.CAM_TOUCH_RECENTER == null) CBZ.CONFIG.CAM_TOUCH_RECENTER = false;
  if (CBZ.CONFIG.CAM_TOUCH_PITCH_FULL == null) CBZ.CONFIG.CAM_TOUCH_PITCH_FULL = true;
  const tpTouch = () => CBZ.CONFIG.TOUCH_TP_CAMERA_V2 !== false && !!CBZ.touchMode;

  // ---- FIXED ANGLE (2026-08-15) — owner, with a photo of the frame he wants:
  // "when I look around it isn't looking around only, it's also changing my
  // camera angle — make it a FIXED angle like the one I'm showing."
  //
  // The RDR2 pass above answered the OTHER half of this. It made the view pitch
  // 1:1 with the mouse and held the character's place in frame — but it did that
  // with a PURE ORBIT, so the lens itself still swings a whole boom's worth: a
  // full look-up drops the camera to your heels (by design — that is how you get
  // sky in frame) and a look-down lifts it over your head into a top-down stare.
  // Framing invariance is not the same promise as a fixed shot, and the shot is
  // what the owner photographed: a lens a little above the shoulder, near level,
  // the street running to the horizon. That frame should be the frame, always.
  //
  // So the city on-foot rig is pinned to its resting angle (CITY_TP.PITCH) and
  // vertical look stops driving the CAMERA at all. It drives the GUN instead:
  //   · cam.pitch still moves 1:1 with the finger/mouse, clamped to an aim band
  //     sized so the impact point stays on screen (FIX_AIM_UP/FIX_AIM_DOWN vs a
  //     60° vertical FOV — see the numbers at the constants);
  //   · systems/fpsmode.js's aimForward() reads that pitch directly instead of
  //     the lens (CBZ.camAimDecoupled below), so rounds, the acquire cone and
  //     the reticle all agree — and the reticle, which is already drawn at the
  //     projected impact point, SLIDES up and down the screen. That slide is the
  //     feedback the camera used to give by tilting.
  // The sky is not lost: pressing AIM releases the pin and the pure orbit is
  // back, whole envelope included, so a helicopter overhead is still reachable
  // exactly as the RDR2 pass made it (CAM_FIXED_ADS_FREE=0 pins that too).
  // FIRST PERSON IS SACRED, as everywhere else in this file: fps.active returns
  // long before the tier runs and tpFixedFrame() refuses outright.
  if (CBZ.CONFIG.CAM_TP_FIXED_ANGLE == null) CBZ.CONFIG.CAM_TP_FIXED_ANGLE = true;
  if (CBZ.CONFIG.CAM_FIXED_ADS_FREE == null) CBZ.CONFIG.CAM_FIXED_ADS_FREE = true;
  // The aim band. Vertical half-FOV is 30° (CITY_TP.FOV 60), and the reticle is
  // the PROJECTED impact point, so an aim of θ lands it tan θ / tan 30° of the
  // way to the frame edge. 0.40 rad = 22.9° → 73% of the way up, comfortably on
  // screen with the cone drawn around it; 0.36 rad down is past where the
  // pavement takes the ray anyway. Wider than this and the crosshair leaves the
  // picture, which is a worse bug than the one being fixed.
  const FIX_AIM_UP = -0.40, FIX_AIM_DOWN = 0.36;
  const FIX_BLEND = 7.5;      // 1/s — pin↔free ease when AIM is pressed/released
  let fixedK = 0;             // 0 = free orbit (the RDR2 rig), 1 = pinned frame
  let _rigPitch = 0;          // the angle the boom actually flew at last frame

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
  // TOUCH BOOM TRIM (CAM_TP_TOUCH_ZOOM) — a MULTIPLIER on the fixed V2 boom,
  // not a second zoom target. The locked-distance personality is preserved
  // exactly: nothing moves it but a pinch, and with no pinch it is 1.0, so
  // every frame is byte-identical to today. Range is deliberately modest —
  // 4.35 m on foot becomes 2.70…8.70 m, 9.5 m behind a car becomes 5.9…19 m —
  // because the point is "let me see past the fuselage / read the street", not
  // "hand the wheel-zoom back".
  const TRIM_MIN = 0.62, TRIM_MAX = 2.0;
  let tpTrim = 1;
  CBZ.camTouchTrim = function () {
    return (CBZ.CONFIG.CAM_TP_TOUCH_ZOOM === false || !tpTouch()) ? 1 : tpTrim;
  };
  // The trim is multiplicative because a pinch is: the same finger travel must
  // pull the same FRACTION of the boom whether you are on foot at 4.35 m or
  // behind an airliner at 30 m. `d` keeps its existing sign convention from the
  // one live caller (touch.js: spread → negative → closer).
  CBZ.camTouchZoom = function (d) {
    if (CBZ.CONFIG.CAM_TP_TOUCH_ZOOM === false) return tpTrim;
    tpTrim = Math.max(TRIM_MIN, Math.min(TRIM_MAX, tpTrim * Math.exp((+d || 0) * 0.06)));
    return tpTrim;
  };
  // ONE entry point, unchanged for desktop. On touch the pinch drives the trim
  // (which is the only thing the city tiers actually read) AND the legacy
  // zoomTarget, so survival / jail — which still run the old wheel-zoom boom —
  // keep pinching exactly as they always did.
  CBZ.camZoom = function (d) {
    zoomTarget = clampZoom(zoomTarget + d);
    if (tpTouch()) CBZ.camTouchZoom(d);
  };
  CBZ.resetZoom = function () { zoomTarget = DEF; camDist = DEF; tpTrim = 1; };

  // Looking UP is the NEGATIVE-pitch direction (boom uses oy = sin(pitch)*camDist,
  // and the look target adds sin(pitch)*aimLead). The old MIN_PITCH = -0.18 capped
  // look-up at only ~-10°, so you could barely tilt the view up. Widen to a
  // generous ~57° up / ~51° down. A hard ±1.45 safety in the mousemove handler
  // keeps |pitch| away from π/2 (gimbal / camera-through-floor).
  const MIN_PITCH = -1.0, MAX_PITCH = 0.9;
  const PITCH_SAFETY = 1.45;
  // CAM_RDR2_ORBIT: third person opens the whole way up. The -1.0 soft clamp
  // was a THIRD of the envelope the hard safety already allowed, and it is what
  // makes a helicopter overhead unfindable. The new ceiling is not a taste
  // number — it is the gimbal safety minus one hair, so the soft clamp is what
  // you feel and the π/2 guard is still the thing that can never be reached.
  // 1.45 - 0.09 = 1.36 rad = 78° above horizontal. Looking DOWN is unchanged:
  // nothing was wrong with it and the floor is in the way at 51° anyway.
  // VIEW_UP_MAX is the cap on the VIEW, which under the pure orbit is no longer
  // the same number as cam.pitch: the view runs at pitch + the frame tilt, and
  // survival's resting tilt alone is 0.46 rad. Capping only the orbit pitch
  // would therefore let the survival view go PAST vertical and roll the world
  // over. The tilt is tapered against this same number where it is solved.
  const PITCH_UP_MARGIN = 0.09;
  const VIEW_UP_MAX = PITCH_SAFETY - PITCH_UP_MARGIN;   // 1.36 rad = 78°
  const MIN_PITCH_TP = -VIEW_UP_MAX;
  // The tilt the pure orbit last solved (see FRAME_TILT below). The up-limit is
  // spent on the VIEW, so a tier that frames its character 7° below the axis
  // must stop its ORBIT 7° earlier — otherwise the very last degrees of travel
  // would have to be paid for by re-centring the character, which is the
  // reframing this whole pass exists to delete. One frame stale by construction
  // and that is harmless: the tilt is a slow function of authored constants.
  // (Present-path only, like everything in this file — no sim state reads it.)
  let _frameTilt = 0;
  // ---- IS THE FRAME PINNED RIGHT NOW? (CAM_TP_FIXED_ANGLE) -----------------
  // Live state only — no cached edge, so every reader (the input clamps, the
  // rig, fpsmode's aim) answers from the same one place and can never disagree
  // by a frame. Deliberately narrow: the CITY on-foot third person is the tier
  // the owner photographed. Driving has its own chase, jail/survival run the
  // legacy boom, a parachute owns its own framing, and FIRST PERSON is sacred.
  function tpFixedFrame() {
    if (CBZ.CONFIG.CAM_TP_FIXED_ANGLE === false) return false;
    if (CBZ.fps && CBZ.fps.active) return false;
    if (!CBZ.game || CBZ.game.mode !== "city") return false;
    const P = CBZ.player;
    if (!P || P.driving || P.dead) return false;
    // AIM releases the pin: the tight ADS frame IS a reframing on purpose, and
    // it is the only way the sky stays reachable (see the flag comment).
    if (CBZ.CONFIG.CAM_FIXED_ADS_FREE !== false && CBZ.isADS && CBZ.isADS()) return false;
    try { if (CBZ.cityChuteState && CBZ.cityChuteState()) return false; } catch (e) {}
    if (CBZ.playerChar && CBZ.playerChar.skydiving) return false;
    return true;
  }
  // PUBLIC: systems/fpsmode.js asks this before it takes the aim direction off
  // the lens. When the frame is pinned the lens is no longer the aim, so a
  // getWorldDirection() there would nail every round to the resting pitch.
  CBZ.camAimDecoupled = tpFixedFrame;
  CBZ.camFixedFrameK = function () { return fixedK; };
  function pitchLimits() {
    if (CBZ.CONFIG.CAM_RDR2_ORBIT === false) return [MIN_PITCH, MAX_PITCH];
    // FIRST PERSON IS SACRED (owner mandate) — the eye keeps its shipped
    // envelope exactly; only the third-person boom opens up.
    if (CBZ.fps && CBZ.fps.active) return [MIN_PITCH, MAX_PITCH];
    // PINNED FRAME: the envelope is the AIM band, not the orbit envelope —
    // every input writer in the repo already routes through here (mouse, touch,
    // gamepad, recoil), so the band lands on all four with nothing to declare.
    if (tpFixedFrame()) return [FIX_AIM_UP, FIX_AIM_DOWN];
    const up = Math.max(0.6, VIEW_UP_MAX - Math.max(0, _frameTilt));
    return [Math.max(MIN_PITCH_TP, -up), MAX_PITCH];
  }
  // PUBLIC, because this file is not the only writer of cam.pitch and every
  // other one carries its own hand-typed copy of the old [-1.0, 0.9] envelope —
  // systems/gamepad.js, systems/touch.js (aim magnetism) and three sites in
  // systems/fpsmode.js. A controller that still stops at -1.0 cannot see the
  // helicopter a mouse can. Adoption is one degrade-safe line and nothing has
  // to be declared:
  //   const r = CBZ.camPitchRange ? CBZ.camPitchRange() : [-1.0, 0.9];
  // All five of those sites now call through; keep it that way — a new writer
  // that re-types the literal silently re-shrinks the envelope for one input.
  CBZ.camPitchRange = pitchLimits;
  const DEFAULT_PITCH = 0.46;   // lower angle — less of a top-down "high" view
  CBZ.CAM_DEFAULT_PITCH = DEFAULT_PITCH;
  const cam = { yaw: 0, pitch: DEFAULT_PITCH, locked: false };
  CBZ.cam = cam;

  // ============================================================
  //  CAMERA POLISH state + public hooks (the CAM_* flags above).
  //  touch.js / touch_vehicle.js consume these by feature-detection.
  // ============================================================
  // Touch third-person pitch range: iPad could barely look up (touch.js's old
  // hard [-0.18, 0.60]). It has widened twice — first toward desktop but
  // stopping short, and now (CAM_TOUCH_PITCH_FULL) all the way, because the
  // reason for stopping short was spent; the argument is at the branch itself.
  CBZ.camTouchPitchRange = function () {
    if (CBZ.CONFIG.CAM_TOUCH_PITCH === false) return [-0.18, 0.60];
    // CAM_ADS_PITCH_WIDE: while AIMING on touch, open the envelope toward the
    // desktop range so an iPad can raise/drop the reticle onto high or low
    // targets. Touch-only (this clamp is consumed only by touch.js applyLookDelta).
    if (CBZ.CONFIG.CAM_ADS_PITCH_WIDE !== false && CBZ.isADS && CBZ.isADS()) return pitchLimits();
    // CAM_TOUCH_PITCH_FULL: the remaining gap to desktop existed for ONE stated
    // reason — this file's own comment: "the touch boom at extreme up-pitch near
    // walls is less recoverable WITHOUT A SCROLL-WHEEL ESCAPE HATCH". Touch now
    // has two (the pinch trim above actually reaches the city boom, and
    // CBZ.camRecenter levels the view in one tap), so the reason is spent and
    // an iPad gets the same envelope a mouse does. Flag off = the old stop-short.
    if (CBZ.CONFIG.CAM_TOUCH_PITCH_FULL !== false && CBZ.CONFIG.TOUCH_TP_CAMERA_V2 !== false) return pitchLimits();
    return [-0.85, 0.75];
  };
  // ---- RECENTER (CAM_TOUCH_RECENTER) — the one control a thumb-driven third
  // person needs that a mouse never does: a mouse levels the view in a flick,
  // a thumb has to drag back across the whole screen. Two jobs, and neither is
  // a teleport: the orbit PITCH eases to the context's own resting angle
  // (CITY_TP.PITCH on foot, a mild down-gaze behind a vehicle), and any live
  // free-look suspension is DROPPED so the vehicle's own auto-recenter — which
  // has always honoured camRecenterSuspended — takes the yaw back itself. It
  // therefore adds no second yaw writer: the car/plane/boat still owns its yaw.
  let recT = 0, recFrom = 0, recTo = 0;
  const REC_T = 0.32;
  function recenterPitchTarget() {
    const P = CBZ.player;
    if (P && (P.driving || P._aircraft)) return 0.16;
    if (CBZ.game && CBZ.game.mode === "city" && CBZ.CITY_TP && CBZ.CITY_TP.PITCH != null) return CBZ.CITY_TP.PITCH;
    return DEFAULT_PITCH;
  }
  CBZ.camRecenter = function () {
    if (CBZ.CONFIG.CAM_TOUCH_RECENTER === false) return false;
    recFrom = cam.pitch; recTo = recenterPitchTarget(); recT = REC_T;
    // Drop the LATCHED free-look and its decay so the vehicle's own recenter
    // takes the yaw back. lookBackHeld is deliberately NOT cleared: that is a
    // live button somebody's other thumb is still holding, and a recenter must
    // not steal a control that is currently pressed.
    flHold = false; flT = 0;
    return true;
  };
  // ANY deliberate look input outranks a running recenter — otherwise the ease
  // would fight the finger for a third of a second after you touched the screen.
  CBZ.camRecenterCancel = function () { recT = 0; };
  // Would a recenter DO anything right now? The touch layer shows its button
  // only when the answer is yes, with hysteresis in the caller, so the control
  // appears exactly when it is worth a thumb and the screen stays calm.
  CBZ.camRecenterOff = function () {
    return Math.abs(cam.pitch - recenterPitchTarget());
  };
  // Vehicle free-look (suspends the behind-the-car auto-recenter) + look-back.
  let flHold = false, flT = 0, lookBackHeld = false, lookBackK = 0, bankK = 0;
  CBZ.camFreeLook = function (on) { flHold = !!on; if (on) flT = 0.8; };
  // A DELIBERATE GLANCE with no hold to release. camFreeLook LATCHES (flHold
  // stays true until somebody passes false), which is correct for a finger that
  // owns the look slot and fatal for a gesture that does not — a pinch, a
  // two-finger adjust, a gamepad nudge — because an unmatched true would
  // suspend every vehicle's auto-recenter FOREVER. This is the decay-only half:
  // exactly what the desktop mousemove handler already does inline (flT = 0.8).
  CBZ.camGlance = function () {
    if (CBZ.CONFIG.CAM_VEHICLE_FREELOOK === false) return false;
    flT = 0.8; return true;
  };
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
    // CBZ.invOpen (src/systems/inventory.js): the escape/survival stash [I]
    // also calls document.exitPointerLock() itself on open. It is the
    // non-city twin of cityMenuOpen and belongs on this list for the same
    // reason — without it, [I] unlocked the cursor, this handler read that as
    // a bare unlock and paused, and inventory.js's own `!playing && invOpen ->
    // close()` sweep then shut the bag on the next frame. Pressing I flashed
    // the stash and dropped you on the pause card.
    if (!cam.locked && CBZ.game.state === "playing" && !(CBZ.surv && CBZ.surv.spectating) && !(CBZ.fullMap && CBZ.fullMap.active) && !CBZ.cityMenuOpen && !CBZ.invOpen && !CBZ.settingsOpen && !(CBZ.cityCam && CBZ.cityCam.death) && !CBZ.game.busted && !(CBZ.game.mode === "city" && CBZ.player && CBZ.player.dead)) CBZ.setState("paused");
    else if (cam.locked && CBZ.game.state === "paused") CBZ.setState("playing");
  });
  document.addEventListener("mousemove", (e) => {
    if (!cam.locked) return;
    if (recT > 0 && (e.movementX || e.movementY)) recT = 0;   // the hand outranks the ease
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
    const _pl = pitchLimits();
    cam.pitch = Math.max(_pl[0], Math.min(_pl[1], cam.pitch));
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
  const airCineV = { x: { v: 0 }, y: { v: 0 }, z: { v: 0 } };         // live aircraft shot dolly
  const _airCineLook = new THREE.Vector3();                            // live aircraft shot look ease
  let airCineOn = false;
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

  // The floor-aware boom (CAM_RDR2_ORBIT): CAM_FLOOR_CLEAR is the SAME 0.35 m
  // the last-resort dy clamp has always used, so the radial clamp lands exactly
  // where the old vertical one did instead of introducing a second floor.
  const CAM_FLOOR_CLEAR = 0.35;
  const CAM_ARM_MIN = 0.45;                    // the arm shortens, it never collapses
  let _armDist = 0;                            // last frame's solved arm (audit)

  /* ---- CAM_WATER_FLOOR — THE THIRD-PERSON CAMERA COULD NEVER GO UNDER ----
     MEASURED (tools/visual-compare.mjs, preset underwater-look, seed 90210):
     with the swimmer teleported 420 m offshore over a 32 m water column and
     driven down repeatedly, the third-person camera's depth below the surface
     came back **-1.10 m every single time** — i.e. pinned 1.1 m ABOVE the
     water — and CBZ.cityCameraSubmerged() stayed false. The cause is the
     `absolute 0.6` in camFloorY below: it is a world-Y constant standing in
     for "the pavement", and over the sea the pavement is a fiction (city/
     swim.js's own note: CBZ.floorAt is flat 0 across the whole ocean, which is
     exactly the phantom floor that module exists to stop you standing on).

     The consequence was not subtle: in third person you could dive thirty
     metres and the CAMERA stayed in the air, so every underwater treatment in
     the game — the fog, the tint, the caustics, the muffle — was first-person
     only. Half the owner's brief was unreachable.

     The fix is to ask the ONE bathymetry oracle instead of a constant. Over
     water the camera's floor is the SEA BED (CBZ.citySeaBedYAt, the same
     surface world/terrain_overhaul.js draws and city/swim.js clamps the
     swimmer to), so the boom follows you down and stops on the bottom exactly
     as it stops on a pavement. On land nothing changes: the helper returns
     null and the absolute 0.6 stands, byte for byte.

     `?cfg_CAM_WATER_FLOOR=0` restores the pinned-above-the-water camera. */
  if (CBZ.CONFIG.CAM_WATER_FLOOR == null) CBZ.CONFIG.CAM_WATER_FLOOR = true;
  function waterCamFloor(x, z, py) {
    if (CBZ.CONFIG.CAM_WATER_FLOOR === false) return null;
    if (!CBZ.cityWaterAt || !CBZ.citySeaBedYAt || !CBZ.citySeaHeightAt) return null;
    let wet = false;
    try { wet = !!CBZ.cityWaterAt(x, z); } catch (e) { return null; }
    if (!wet) return null;
    // DELIBERATELY NARROW: only while the BODY is genuinely under the surface.
    // cityWaterAt is also true over a rain-flooded street (city/waterfield.js's
    // ground-water term), and there the bed is the street — relaxing the
    // pavement floor for a puddle would let the boom dip through the road.
    // A swimmer's origin is below the waterline; a wader's is not.
    const surfY = +CBZ.citySeaHeightAt(x, z);
    if (!Number.isFinite(surfY) || !(py < surfY - 0.2)) return null;
    const bedY = +CBZ.citySeaBedYAt(x, z);
    if (!Number.isFinite(bedY)) return null;
    // Same 0.35 m stand-off the pavement gets: the lens rests just above the
    // bottom rather than inside it.
    return bedY + CAM_FLOOR_CLEAR;
  }

  // ---- ROOM SENSE (CAM_ROOM_BOOM) -----------------------------------------
  // RDR2's interior camera is not a collision snap: crossing a doorway the boom
  // DAMPS in to a close over-the-shoulder and the pivot settles toward shoulder
  // height, and it damps back out on the way through. The signal is geometric
  // and needs two probes, because either one alone lies: an awning has a
  // ceiling and no walls, a street canyon has walls and no ceiling, and only a
  // ROOM has both. (There is a third copy of "am I under a roof" in this repo —
  // city/death.js's isIndoors and systems/weather.js's testIndoors, which are
  // already each other's copy. Both are event/throttled one-shots keyed to the
  // PLAYER; this one is keyed to the camera PIVOT and needs a free DISTANCE,
  // not a boolean. Promoting the trio into one shared query is the migration
  // this file owes — it is named in the report, not smuggled in here, because a
  // block with no migrated consumers is prose.)
  //
  // The probes are AXIS-ALIGNED, never camera-relative, so spinning on the spot
  // can never make the boom breathe; and the whole set re-measures at ROOM_HZ
  // rather than per frame, because it feeds a damp that could not resolve a
  // faster signal anyway. Cost: five swept-AABB queries 12x/s against the same
  // collider grid the boom already queries every frame.
  const ROOM_HZ = 12;
  const CEIL_PROBE = 6.0;                      // how far up we bother to look
  const ROOM_PROBE = 9.0;                      // how far out we bother to look
  const CEIL_TIGHT = 1.25, CEIL_OPEN = 3.6;    // free air above the pivot
  // SPAN, not clearance. Measuring the nearest wall would call a big hall tight
  // the moment you stood against its side; a room's size is wall-to-wall, and
  // wall-to-wall is also what decides whether a boom fits. SPAN_TIGHT is a
  // small room; SPAN_OPEN is derived — twice the exterior boom plus its
  // standoff (2·4.35 + 2·0.55 ≈ 9.8, rounded up), i.e. the span at which the
  // full follow distance simply fits and there is nothing to pull in from.
  const SPAN_TIGHT = 3.5, SPAN_OPEN = 10.0;
  const ROOM_CLEAR = 0.55;                     // camera radius (0.34) + standoff
  const INT_DIST_MIN = 1.5, INT_DIST_MAX = 2.2;// the RDR2 interior boom band
  const INT_MIN_CAM = 0.75;                    // indoor collision floor (see minCam)
  const INT_HEIGHT_DROP = 0.18;                // over-the-head pivot eases to over-the-shoulder
  const ROOM_TAU = 0.30;                       // damp time constant (both directions)
  let roomT = 0, roomCeil = CEIL_PROBE, roomSpan = ROOM_PROBE * 2, encK = 0;
  const _upRay = new THREE.Raycaster();
  const _upOrg = new THREE.Vector3(), _upDir = new THREE.Vector3(0, 1, 0);
  function sstep(a, b, x) {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }
  // ONE MEASUREMENT PER FRAME. senseRoom is now called from two places (the
  // tight-space FP check before the first-person hand-off, and the boom in the
  // third-person tail), and its enclosure damp integrates fdt — calling it
  // twice in a frame would double-step that damp and halve ROOM_TAU. The
  // second caller of a frame gets the first one's answer.
  let _camFrame = 0, _roomFrame = -1;
  function senseRoom(px, py, pz, fdt) {
    if (_roomFrame === _camFrame) return encK;
    _roomFrame = _camFrame;
    roomT -= fdt;
    if (roomT <= 0) {
      roomT = 1 / ROOM_HZ;
      // CEILING: colliders first (walls and slabs the world registers as
      // boxes), then the LOS meshes as the backstop — a roof that exists only
      // as geometry is exactly what death.js's isIndoors needed its up-ray for.
      let up = sweepColliders(px, py, pz, 0, 1, 0, CEIL_PROBE, 0.30);
      if (up >= CEIL_PROBE && CBZ.losBlockers && CBZ.losBlockers.length) {
        _upOrg.set(px, py, pz);
        _upRay.set(_upOrg, _upDir); _upRay.far = CEIL_PROBE;
        const h = CBZ.losRaycast ? CBZ.losRaycast(_upRay, CBZ.losBlockers)
                                 : _upRay.intersectObjects(CBZ.losBlockers, false);
        if (h.length && h[0].distance < up) up = h[0].distance;
      }
      roomCeil = up;
      // FLOOR PLAN: wall to wall on each world axis, and the NARROWER axis
      // wins — a corridor is as tight as its narrow side, and it is the narrow
      // side the boom has to live inside.
      const xp = sweepColliders(px, py, pz, 1, 0, 0, ROOM_PROBE, 0.30);
      const xm = sweepColliders(px, py, pz, -1, 0, 0, ROOM_PROBE, 0.30);
      const zp = sweepColliders(px, py, pz, 0, 0, 1, ROOM_PROBE, 0.30);
      const zm = sweepColliders(px, py, pz, 0, 0, -1, ROOM_PROBE, 0.30);
      roomSpan = Math.min(xp + xm, zp + zm);
    }
    const want = Math.min(1 - sstep(CEIL_TIGHT, CEIL_OPEN, roomCeil),
                          1 - sstep(SPAN_TIGHT, SPAN_OPEN, roomSpan));
    encK += (want - encK) * (1 - Math.exp(-fdt / ROOM_TAU));
    if (encK < 0.002) encK = 0;
    return encK;
  }
  // The interior boom is DERIVED from the room the probes actually found, never
  // typed: a wide lobby keeps more arm than a stairwell does, and the band is
  // the RDR2 reference range.
  function roomBoom() {
    return Math.max(INT_DIST_MIN, Math.min(INT_DIST_MAX, roomSpan * 0.5 - ROOM_CLEAR));
  }

  /* ==========================================================================
     A CELL IS TOO SMALL FOR A BOOM (CAM_TIGHT_FP).

     OWNER: "test my camera idea — third person mixed with first person for when
     they are in small rooms or cells etc where 3rd person gets messed up.
     maybe that's dumb but we will try it."

     It is not dumb; it is the only answer the geometry allows. A prison cell in
     world/cellblock.js is about 2.4 m across. A third-person camera needs the
     boom LENGTH plus the camera's own radius behind the character's back — call
     it 1.5 + 0.34 — and there is 1.2 m of room behind him. Every third-person
     camera ever written does one of two things with that: clip through the wall
     (you photograph the corridor and the cell disappears) or slam the lens into
     the back of his skull (you photograph the inside of a head). Both are what
     "3rd person gets messed up" means, and no amount of tuning fixes it because
     the space is smaller than the shot.

     So below a threshold the rig stops pretending. First person needs no room
     behind the character at all, and this game already has a good one — the
     standing owner mandate is FIRST PERSON IS SACRED, so nothing here touches
     it: this calls CBZ.setFPS exactly the way [V] and the touch eye button do,
     and systems/fpsmode.js runs unchanged and unaware. The switch even inherits
     the existing CAM_TOGGLE_BLEND dolly, so a doorway reads as a ~0.3 s move in
     rather than a cut.

     TWO RULES KEEP IT HONEST:
       · HYSTERESIS, not a threshold. In at 3.0 m of floor span, back out at
         4.6 m, so standing in a doorway cannot strobe the view.
       · THE PLAYER OUTRANKS IT. Toggling the view by hand (or fpsmode changing
         it for its own reasons) drops the claim immediately, and the claim can
         only be re-armed after the room has opened back up. If you want third
         person in your cell, you press the button once and you keep it.
     It gives back ONLY what it took: leaving a tight space restores first
     person if that is where it found you, and never forces third person on a
     player who chose first.

     Scoped to the prison (mode "escape") on purpose. The city has its own
     interior camera — the room-aware boom below, which the owner has already
     signed off — and the arenas have no rooms. Flag false = nothing at all.
     ========================================================================== */
  if (CBZ.CONFIG.CAM_TIGHT_FP == null) CBZ.CONFIG.CAM_TIGHT_FP = true;
  // MEASURED, not guessed (tools/prison-polish-check.mjs): a world/cellblock.js
  // cell probes at span 3.20 / ceiling 1.90, the wing's central hall at 18.0
  // with no lid at all (the block is open-topped, so only the cell roof slabs
  // read as a ceiling). 3.6 clears the cell with margin and is still nowhere
  // near a corridor; 5.2 is the release, wide enough that a doorway cannot
  // strobe and narrow enough that the hall always trips it.
  const FP_SPAN_IN = 3.6;      // narrow floor span that means "no room for a boom"
  const FP_SPAN_OUT = 5.2;     // …and the span that hands third person back
  const FP_CEIL_IN = 2.9;      // a lid too: a narrow alley is not a cell
  let autoFP = false;          // WE put the player in first person
  let autoFPWas = false;       // …and this is the view we found him in
  let tfpPrev = null;          // last frame's fps.active, to spot a manual flip
  let autoFPBlock = false;     // a manual toggle parks us until the room opens
  let _selfFlip = false;       // the setFPS call about to land is ours
  function tightFP(fdt) {
    const on = CBZ.CONFIG.CAM_TIGHT_FP !== false && !!CBZ.setFPS && !!CBZ.fps;
    const live = on && CBZ.game.mode === "escape" && CBZ.game.state === "playing" &&
      !player.dead && !player.driving && !(CBZ.simView && CBZ.simView.active) &&
      !(CBZ.cineCam && CBZ.cineCam.active);
    if (!live) {
      // hand the view back on the way out of play (death/pause/mode change), so
      // a run can never end with a camera nobody asked for latched on.
      if (autoFP && CBZ.setFPS) { autoFP = false; CBZ.setFPS(autoFPWas); }
      autoFP = false; autoFPBlock = false;
      tfpPrev = !!(CBZ.fps && CBZ.fps.active);
      return;
    }
    const nowFP = !!CBZ.fps.active;
    // SOMEBODY ELSE MOVED IT. Any change we did not make is the player's (or
    // fpsmode's) and outranks us until the room opens up again. `null` is the
    // FIRST observation, not a change: escape mode arms first person after the
    // intro (state.js -> armFPSAfterIntro), so a `false` seed would read that
    // as a hand toggle on frame one and park the rule for the whole run.
    if (tfpPrev !== null && nowFP !== tfpPrev && !_selfFlip) { autoFP = false; autoFPBlock = true; }
    _selfFlip = false;

    senseRoom(player.pos.x, player.pos.y + height, player.pos.z, fdt);
    const tight = roomSpan <= FP_SPAN_IN && roomCeil <= FP_CEIL_IN;
    const open = roomSpan >= FP_SPAN_OUT;
    if (open) autoFPBlock = false;

    if (!autoFP && tight && !autoFPBlock && !nowFP) {
      autoFP = true; autoFPWas = false;
      _selfFlip = true; CBZ.setFPS(true);
    } else if (autoFP && open) {
      autoFP = false;
      _selfFlip = true; CBZ.setFPS(autoFPWas);
    }
    tfpPrev = !!CBZ.fps.active;
  }
  // the numbers, for a probe: `span`/`ceil` are the live measurement, `auto` is
  // whether THIS rule owns the current view.
  CBZ.camRoomAudit = function () {
    return {
      on: CBZ.CONFIG.CAM_TIGHT_FP !== false, span: roomSpan, ceil: roomCeil,
      enc: encK, boom: roomBoom(), auto: autoFP, blocked: autoFPBlock,
      fp: !!(CBZ.fps && CBZ.fps.active),
    };
  };

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
    _camFrame++;                 // senseRoom answers once per frame (see it)
    // ---- CAMERA POLISH per-frame state (cheap, runs in every branch) ----
    if (flT > 0 && !flHold) flT = Math.max(0, flT - fdt);          // free-look decay after the glance
    // RECENTER ease (CAM_TOUCH_RECENTER). Runs on the wall-clock feel-dt like
    // every other polish term, writes ONLY cam.pitch, and is cancelled outright
    // by any look input — so it can never wrestle a finger or a mouse.
    if (recT > 0) {
      recT = Math.max(0, recT - fdt);
      const p = 1 - recT / REC_T, k = p * p * (3 - 2 * p);
      cam.pitch = recFrom + (recTo - recFrom) * k;
    }
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
      airCineOn = false;
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
    // LIVE AIRCRAFT SHOT. The ordnance/mission layer may publish framing
    // coordinates, but this shared module remains the sole camera transform
    // writer. Unlike CBZ.cineCam this does not freeze the player or flight
    // physics: it is a lens override while the aircraft keeps flying.
    let acv = null;
    if (typeof CBZ.aircraftCinematicView === "function") {
      try { acv = CBZ.aircraftCinematicView(); } catch (e) { acv = null; }
    }
    if (acv && acv.active && player._aircraft && !player.dead) {
      introT = 0;
      prev.copy(player.pos);
      bankK = 0;
      if (acv.snap || !airCineOn) {
        camera.position.set(acv.x, acv.y, acv.z);
        airCineV.x.v = airCineV.y.v = airCineV.z.v = 0;
        _airCineLook.set(acv.lx, acv.ly, acv.lz);
      } else {
        camera.position.x = smoothDamp(camera.position.x, acv.x, airCineV.x, 0.10, fdt);
        camera.position.y = smoothDamp(camera.position.y, acv.y, airCineV.y, 0.10, fdt);
        camera.position.z = smoothDamp(camera.position.z, acv.z, airCineV.z, 0.10, fdt);
        const lk = 1 - Math.exp(-8 * fdt);
        _airCineLook.x += (acv.lx - _airCineLook.x) * lk;
        _airCineLook.y += (acv.ly - _airCineLook.y) * lk;
        _airCineLook.z += (acv.lz - _airCineLook.z) * lk;
      }
      camera.lookAt(_airCineLook);
      if (shakeAmt > 0.001) {
        camera.position.x += (Math.random() - 0.5) * shakeAmt;
        camera.position.y += (Math.random() - 0.5) * shakeAmt;
        camera.position.z += (Math.random() - 0.5) * shakeAmt;
        shakeAmt *= Math.pow(0.0006, fdt);
        if (shakeAmt < 0.01) shakeAmt = 0;
      }
      fov = smoothDamp(fov, acv.fov || 52, fovV, 0.14, fdt);
      if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
      airCineOn = true;
      return;
    }
    if (airCineOn) {
      airCineOn = false;
      camV.x.v = camV.y.v = camV.z.v = 0;
      lookV.x.v = lookV.y.v = lookV.z.v = 0;
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
    // CAM_TIGHT_FP — decided BEFORE the first-person hand-off below, because
    // once fps.active is true this function returns and the room would never be
    // measured again (so nothing could ever hand third person back).
    tightFP(fdt);
    if (CBZ.fps && CBZ.fps.active && !player.dead && !player.driving) {
      introT = 0; prev.copy(player.pos);
      return;
    }

    // CITY DRIVING: a high GTA-style chase — well BEHIND and ABOVE the car,
    // looking down the road ahead — so you read the whole car, not the hood.
    // (Yaw is auto-steered behind the car by city/vehicles.js.)
    if (CBZ.game.mode === "city" && player.driving && !player.dead) {
      introT = 0; prev.copy(player.pos);
      // THE DRIVER'S SEAT (CAR_FP_VIEW, city/view.js). A car's first-person
      // view is a POSITION INSIDE THIS BRANCH, not a competing writer: view.js
      // solves the eye and hands back plain numbers, and this function — still
      // the one and only camera transform writer — applies them. It cannot
      // race the chase below because it RETURNS instead of it, and it cannot
      // race fpsmode/scopeview because those bow out while player.driving
      // (fpsmode's own guard, three branches up). A fitted optic still wins
      // the lens: view.js resolves fpsScopeFov before it hands the FOV over.
      if (CBZ.carFpPose) {
        const seat = CBZ.carFpPose(fdt);
        if (seat) {
          camera.position.set(seat.px, seat.py, seat.pz);
          camera.quaternion.set(seat.qx, seat.qy, seat.qz, seat.qw);
          if (Math.abs(camera.fov - seat.fov) > 0.01) { camera.fov = seat.fov; camera.updateProjectionMatrix(); }
          fov = seat.fov;                 // so the chase eases OUT of this lens, not into a stale one
          // keep the chase's smoothing state parked on the car so stepping
          // back out dollies from here instead of snapping from a stale target
          look.set(player.pos.x, player.pos.y + 0.6, player.pos.z);
          bankK = 0;
          // a blast still shakes you — harder from inside, if anything. Same
          // decay the chase uses, applied after the seat write so it reads as
          // the car being hit rather than the lens wobbling.
          if (shakeAmt > 0.001) {
            const s = shakeAmt * 0.6;
            camera.position.x += (Math.random() - 0.5) * s;
            camera.position.y += (Math.random() - 0.5) * s;
            camera.position.z += (Math.random() - 0.5) * s;
            shakeAmt *= Math.pow(0.0006, fdt);
            if (shakeAmt < 0.01) shakeAmt = 0;
          }
          return;
        }
      }
      // LOOK-BACK (CAM_VEHICLE_FREELOOK): lookBackK eases 0↔1 and swings the
      // whole chase 180° — hold MMB (or the touch LOOK BACK pill) to check your
      // six, release to whip forward again.
      const vyaw = cam.yaw + Math.PI * lookBackK;
      const cfx = -Math.sin(vyaw), cfz = -Math.cos(vyaw);   // = the chase forward
      // Aircraft publish framing dimensions. A fixed car-sized 9.5m boom sat
      // inside a 30m commercial airliner, so the "third-person" hijack view was
      // mostly tail/fuselage. Cars and older craft keep the exact defaults.
      const craft = player._aircraft;
      // CAM_TP_TOUCH_ZOOM: a pinch dollies the whole boom IN OR OUT ALONG
      // ITSELF — back and up take the same factor, so the depression angle is
      // untouched and the shot stays the shot the owner framed; only its reach
      // changes. `ahead` is a look-lead, not a boom, so it is deliberately not
      // scaled (trimming it would swing the aim point, not the camera).
      const tzk = CBZ.camTouchTrim();
      const back = (craft && craft.cameraBack != null ? craft.cameraBack : 9.5) * tzk;
      const up = (craft && craft.cameraUp != null ? craft.cameraUp : 10.0) * tzk;
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
    {  // same soft envelope the mouse handler applies (FP has already returned)
      const pl = pitchLimits();
      cam.pitch = Math.max(pl[0], Math.min(pl[1], cam.pitch));
    }

    // player velocity (planar) for look-ahead + FOV kick
    vel.set((player.pos.x - prev.x) / Math.max(dt, 1e-4), 0, (player.pos.z - prev.z) / Math.max(dt, 1e-4));
    prev.copy(player.pos);
    const spd = Math.hypot(vel.x, vel.z);

    if ((CBZ.meleeFocusT || 0) > 0) CBZ.meleeFocusT = Math.max(0, CBZ.meleeFocusT - dt);
    const chuteState = (CBZ.cityChuteState && CBZ.cityChuteState()) ||
      (CBZ.playerChar && CBZ.playerChar.skydiving) || null;
    const chuteCanopy = !!(chuteState && (chuteState.phase === "canopy" || chuteState.phase === "opening"));
    const shoulder = !chuteState && !!(CBZ.weaponThirdPersonActive && CBZ.weaponThirdPersonActive());
    const meleeFocus = !chuteState && !shoulder && (CBZ.meleeFocusT || 0) > 0;
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

    // ---- THE PIN (CAM_TP_FIXED_ANGLE) ---------------------------------------
    // fixedK eases so pressing/releasing AIM is a short swing, not a cut. Only
    // the city on-foot tier can hold it (TP): everywhere else the pin decays to
    // 0 and every line below is the arithmetic it was.
    const wantFixed = (TP && tpFixedFrame()) ? 1 : 0;
    fixedK += (wantFixed - fixedK) * (1 - Math.exp(-FIX_BLEND * fdt));
    if (fixedK < 0.0008) fixedK = 0;
    if (fixedK > 0.9992) fixedK = 1;
    // Coming OUT of an aim that reached for the sky, cam.pitch is outside the
    // aim band and no input writer will re-clamp it until the player touches
    // the stick — so the gun would stay pointed at a helicopter that isn't
    // there. Ease it home instead of snapping (the reticle is visibly riding
    // this number; a snap reads as the gun being yanked out of your hands).
    if (wantFixed) {
      const lo = FIX_AIM_UP, hi = FIX_AIM_DOWN;
      const t = Math.max(lo, Math.min(hi, cam.pitch));
      if (t !== cam.pitch) cam.pitch += (t - cam.pitch) * (1 - Math.exp(-9 * fdt));
    }
    // The angle the rig actually flies at. At fixedK=1 it is the tier's own
    // resting pitch — the owner's photographed frame — no matter where the aim
    // is pointed; at 0 it is cam.pitch and the pure orbit is untouched.
    const rigPitch = TP ? cam.pitch + (((TP.PITCH != null) ? TP.PITCH : cam.pitch) - cam.pitch) * fixedK : cam.pitch;
    _rigPitch = rigPitch;        // camAudit reads it; nothing in the sim does

    // ease the zoom distance toward its target. Normal third person is
    // a wider chase camera; armed third person becomes readable over-shoulder.
    // City scales the wheel-zoom around its own (much closer) default.
    // CAM_TP_TOUCH_ZOOM — the trim rides the LOCKED boom on touch and is 1 on
    // desktop and 1 until somebody actually pinches. It stands down entirely
    // while ADS: the punch-in is a FIXED target on purpose, and a trimmed
    // punch-in would re-create the very "the camera zooms on its own" complaint
    // the constant boom was written to answer.
    const tpZoomK = (CBZ.isADS && CBZ.isADS()) ? 1 : CBZ.camTouchTrim();
    const desiredZoom = chuteState
      ? (chuteCanopy ? 10.8 : 7.2) * tpZoomK
      : TP
      ? (CBZ.CONFIG.CAM_TP_V2
          // FORTNITE LOCK: the boom is a constant — DIST at rest and merely-
          // armed, DIST_AIM_ADS only while scoping (fixed targets; the fast
          // ease below is the whole ADS punch-in). Wheel + melee zoom are out.
          ? (shoulder ? TP.DIST_AIM : TP.DIST) * tpZoomK
          : (shoulder ? TP.DIST_AIM : (meleeFocus ? TP.DIST * 0.85 : TP.DIST * (zoomTarget / DEF))))
      : (driving ? Math.max(zoomTarget, 11) : (shoulder ? Math.min(zoomTarget, 7.6) : (meleeFocus ? Math.min(zoomTarget, 7.0) : zoomTarget)));
    // ---- ROOM-AWARE BOOM (CAM_ROOM_BOOM). `encK` is the damped enclosure, so
    // the doorway is a ~0.3s blend rather than a step, and the existing collision
    // clamp below stays exactly what it was: the LAST resort, not the mechanism.
    // It may only ever pull the boom IN — a room must never push the camera OUT,
    // which is what a bare lerp would do the moment the ADS punch-in (2.65 m) is
    // already tighter than the room's own derived boom.
    // THE PRISON HAS ROOMS TOO. This was gated on `TP`, which is the CITY
    // on-foot tier and null everywhere else — so the mode with the most and the
    // smallest interiors in the game (cells, the corridor, the gun room) was the
    // one mode the room-aware boom never ran in, and its camera behaved indoors
    // exactly the way the owner describes: messed up. The probes and the damp
    // are the same ones; only who is allowed to ask changed. Chute/driving still
    // opt out, and CAM_ROOM_BOOM=false still reverts the lot.
    const roomK = (!player.driving && !chuteState && CBZ.CONFIG.CAM_ROOM_BOOM !== false &&
        (TP || CBZ.game.mode === "escape"))
      ? senseRoom(player.pos.x, player.pos.y + height, player.pos.z, fdt)
      : (encK = 0);
    const wantDist = roomK > 0
      ? Math.min(desiredZoom, desiredZoom + (roomBoom() - desiredZoom) * roomK)
      : desiredZoom;
    camDist += (wantDist - camDist) * (1 - Math.pow(0.0015, fdt));

    // smoothed rig height (crouch dips the whole rig). Survival frames the
    // player higher — disasters need you to read the ground around you — and
    // sprinting lifts it a touch more instead of letting it sag low.
    const surv = CBZ.game.mode === "survival";
    const sprinting = surv && !!player.sprint;
    const baseHeight = chuteState ? (chuteCanopy ? 4.15 : 1.55)
      : player.prone ? 0.74 : (player.crouch ? 1.16 : (driving ? 2.35 : (TP ? (shoulder ? (TP.HEIGHT_AIM != null ? TP.HEIGHT_AIM : TP.HEIGHT + 0.1) : TP.HEIGHT) : (shoulder ? 1.64 : (meleeFocus ? 1.44 : (surv ? (sprinting ? 2.28 : 2.08) : 1.82))))));
    // CAM_ROOM_BOOM: indoors the pivot eases from over-the-HEAD (1.7 — right for
    // a 4.35 m boom reading the street ahead) to over-the-SHOULDER, which is
    // where the reference plates put it and what stops a 1.7 m boom from
    // photographing the top of your hat. Crouch/prone already own the pivot.
    const roomHeight = (roomK > 0 && !player.crouch && !player.prone && !chuteState)
      ? baseHeight - INT_HEIGHT_DROP * roomK : baseHeight;
    height = smoothDamp(height, roomHeight, heightV, 0.18, fdt);
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
    const sK = TP ? shoulderK : 1;   // shoulder-swap ease; spent on the offsets below
    const baseY = ty + (!TP && shoulder ? 0.08 : 0);

    // orbit offset from yaw/pitch. rigPitch === cam.pitch unless the frame is
    // pinned (CAM_TP_FIXED_ANGLE), in which case the whole boom — arm clamp,
    // shoulder-angle scaling, view basis and tilt taper below, all of which
    // read cp/sp — flies at the tier's resting angle and the aim is carried
    // separately by cam.pitch.
    const cp = Math.cos(rigPitch), sp = Math.sin(rigPitch);
    // ---- FLOOR-AWARE BOOM (CAM_RDR2_ORBIT) ----
    // Looking up swings the arm DOWN (oy = sin(pitch)·dist and up is negative
    // pitch), so a real sky look wants the camera metres UNDER the pavement.
    // The old answer clamped dy, which keeps the arm's LENGTH and therefore
    // breaks the orbit: the lens ends up level with your shins with the boom
    // still 4.35 m long, and the view never points anywhere near the sky. Clamp
    // the ARM instead, radially — the longest boom whose far end still clears
    // the floor. That is what a spring arm does when it drags on the ground, and
    // it is exactly why looking straight up in RDR2 drops the camera to your
    // heels and fills the frame with sky. The dy floor below survives as the
    // last-resort guard it was always meant to be.
    // camFloorY is the SAME floor the last-resort dy clamp uses, absolute 0.6
    // included — solving the arm against `player.pos.y + 0.35` while the clamp
    // then lifted the lens to 0.6 broke the orbit by 0.25 m, which at a 1.4 m
    // arm is 20° of framing error. One floor, both users.
    // CAM_WATER_FLOOR: over the sea the "absolute 0.6" pavement is a fiction
    // and was pinning the third-person lens above the waterline no matter how
    // deep the swimmer went (see the note beside waterCamFloor). Ask the
    // bathymetry there instead; on land this is the same expression it was.
    const _wFloor = waterCamFloor(player.pos.x, player.pos.z, player.pos.y);
    const camFloorY = _wFloor != null
      ? Math.max(player.pos.y + CAM_FLOOR_CLEAR, _wFloor)
      : Math.max(player.pos.y + CAM_FLOOR_CLEAR, 0.6);
    const orbitDist = (CBZ.CONFIG.CAM_RDR2_ORBIT !== false && sp < -1e-4)
      ? Math.min(camDist, Math.max(CAM_ARM_MIN, (baseY - camFloorY) / -sp))
      : camDist;
    _armDist = orbitDist;
    // ---- THE SHOULDER OFFSET IS A SCREEN ANGLE TOO ----
    // SIDE is authored in METRES against the full boom: 0.68 m at 4.35 m is 9°
    // of frame. Leave it alone while the floor clamp drags the arm in to 1.5 m
    // and the same 0.68 m becomes 24° — the character slides out of the frame
    // sideways as you pitch up, which is the horizontal half of exactly the
    // reframing complaint the pure orbit fixes vertically. Scaling by how much
    // of the arm survived holds the over-shoulder ANGLE constant instead.
    // Deliberately keyed to the FLOOR clamp only (orbitDist vs camDist): the
    // interior pull-in moves camDist itself, so armK stays 1 in a room and the
    // authored offset lands — which is what puts the character out on the left
    // in the RDR2 interior reference.
    const armK = (CBZ.CONFIG.CAM_RDR2_ORBIT !== false && camDist > 0.01)
      ? Math.min(1, orbitDist / camDist) : 1;
    // SHOULDER SWAP (CAM_SHOULDER_SWAP): shoulderK eases -1↔1 through centre,
    // flipping the whole side-offset family (framing AND aim offsets together
    // so the ADS punch-in lands over whichever shoulder is active).
    const targetSide = (chuteState ? 0 : (TP ? (shoulder ? TP.SIDE_AIM * 0.22 : TP.SIDE * 0.25) : (shoulder ? 0.26 : (meleeFocus ? 0.12 : 0)))) * sK * armK;
    const camSide = (chuteState ? 0 : (TP ? (shoulder ? TP.SIDE_AIM : TP.SIDE) : (shoulder ? 0.86 : (meleeFocus ? 0.32 : 0)))) * sK * armK;
    const baseX = tx + rightX * targetSide;
    const baseZ = tz + rightZ * targetSide;
    const ox = Math.sin(yaw) * cp * orbitDist;
    const oy = sp * orbitDist;
    const oz = Math.cos(yaw) * cp * orbitDist;
    // the non-TP tiers nudge the lens off the pivot; it is part of the PIVOT for
    // orbit purposes, or the pure orbit below would frame against a point the
    // camera is not actually swinging around.
    const dyExtra = TP ? 0 : (shoulder ? -0.05 : (meleeFocus ? 0.02 : (surv ? 0.34 : 0.14)));
    const pivotY = baseY + dyExtra;
    let dx = baseX + ox + rightX * camSide;
    let dy = pivotY + oy;
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
      let minCam = (CBZ.game.mode === "city" && !player.driving)
        ? (tpPresent ? ((CBZ.isADS && CBZ.isADS()) ? (noBalloon ? 1.5 : 1.8) : (noBalloon ? 1.5 : 2.6)) : (noBalloon ? 1.6 : 3.0))
        : 0.28;
      // CAM_ROOM_BOOM: the 1.6 m city floor is a STREET number — it exists so a
      // wall behind you in the dense grid can't slam the boom to your back. In a
      // 4 m room it is the opposite bug: the floor holds the lens INSIDE the
      // wall, which is exactly the "no clipping" half of the owner's interior
      // note. Where the room probes say we are in a room, the floor rides down
      // with the enclosure to the spring-arm minimum, because in a room the
      // boom is short BY DESIGN and has nothing to protect.
      // …and it may only ever LOWER the floor. Reading this as an unconditional
      // lerp toward INT_MIN_CAM was safe while the room probes were city-only
      // (every city floor is 1.5-3.0, i.e. above it), but the prison's floor is
      // 0.28 — there the same line would PUSH the lens out to 0.75 in exactly
      // the cells it exists to let it into. `minCam` is a floor; a room lifting
      // a floor is never the intent.
      if (roomK > 0 && minCam > INT_MIN_CAM) minCam = minCam + (INT_MIN_CAM - minCam) * roomK;
      const d = Math.max(minCam, occ - 0.25);
      dx = baseX + _rd.x * d; dy = baseY + _rd.y * d; dz = baseZ + _rd.z * d;
    }
    // never drop below the surface you're standing on (no looking up through
    // floors). Under CAM_RDR2_ORBIT the radial arm clamp above has already
    // solved for this, so this is the guard for the cases it can't see (a ledge
    // behind you, a boom the collision clamp pushed somewhere odd).
    dy = Math.max(dy, camFloorY);

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
    const aimLead = (chuteState ? 0.35
      : driving ? 8.5
      : shoulder ? (TP ? (tpADS ? 12.0 : TP.LEAD) : 12.0)
      : meleeFocus ? 2.2
      : TP ? TP.LEAD
      : surv ? 2.4 : 3.6) * (1 - frontK);
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
    // camera into a top-down stare instead of pitching the view).
    // CORRECTED 2026-08-03, and leaving the old text would be exactly the
    // stale-claim problem this repo keeps catching itself in. What stood here
    // was: "with aimLead(4.6) ≈ camDist(4.0) the look target and the orbit rise
    // together, so the view pitches ~1:1". Two errors, and the second is fatal.
    // (a) camDist is 4.35, not 4.0. (b) 1:1 is not what "rising together" gives
    // — it is what CANCELLING gives. Solve it: the view angle is
    //   atan2((LOOK_Y − HEIGHT) + (LEAD − DIST)·sin p, (LEAD + DIST)·cos p),
    // so the numerator's pitch term carries (4.6 − 4.35) = 0.25 against a
    // denominator of 8.95 — a gain of about 0.028, not 1. Measured over the
    // shipped constants, a full 1.0 rad of mouse-up bought 0.08 rad of view,
    // and the constant −0.18 offset flips even that the wrong way at small
    // angles. The comment's own next sentence had the diagnosis right and drew
    // the wrong conclusion from it: aimLead·pf ≈ camDist is not the SAFE point,
    // it is the DEAD point — the inversion boundary the tier was parked on.
    // The pure orbit below removes the whole quantity from the answer; this
    // pitchFollow term now only feeds the tilt solve's resting evaluation.
    const pitchFollow = (!chuteState && TP && (tpPresent || CBZ.CONFIG.CAM_TP_V2))
      ? (TP.PITCH_LOOK != null ? TP.PITCH_LOOK : 1.0) * (1 - frontK)
      : 0;
    // the tier's pitch-BLIND look height — still the authored framing number,
    // now used as the input to the tilt solve rather than as the answer.
    const lookYFlat = player.pos.y + (chuteState ? (chuteCanopy ? 3.45 : 0.92)
      : (player.prone ? 0.62 : (player.crouch ? (TP ? 1.18 : 1.24) : (driving ? 1.9 : (shoulder ? (TP ? (tpADS ? 1.72 : TP.LOOK_Y) : 1.72) : (meleeFocus ? 1.52 : (TP ? TP.LOOK_Y : (surv ? 2.06 : 1.88))))))));
    let ltx, lty, ltz;
    if (CBZ.CONFIG.CAM_RDR2_ORBIT !== false && !chuteState) {
      // ================= PURE ORBIT (the RDR2 answer) =====================
      // Anchor the look target to the SAME pivot the camera orbits and push it
      // along the mouse's own direction. Then camera→look is V by construction:
      // the view pitch IS cam.pitch (gain exactly 1, no inversion band), and the
      // character's place in the frame cannot move when you pitch — which is the
      // owner's "looking up also changes the angle", deleted rather than tuned.
      //
      // FRAME_TILT is the one thing worth preserving from the old rig: the angle
      // it framed the pivot BELOW the view axis. It is DERIVED, per frame, from
      // whatever constants this tier is actually running, evaluated at that
      // tier's own RESTING pitch — so at rest every tier (relaxed city, ADS,
      // melee, survival, jail) frames EXACTLY as it does today, and only the
      // pitch RESPONSE changes. Tune CITY_TP in city/camera.js and the resting
      // frame still follows; nothing here has to be re-tasted.
      const p0 = (TP && TP.PITCH != null) ? TP.PITCH : DEFAULT_PITCH;
      const s0 = Math.sin(p0), c0 = Math.cos(p0);
      // Solved against camDist, NOT the floor-clamped arm: the arm shortening
      // as you pitch up is the price of not going through the pavement, and it
      // must not also become a framing change — that would smuggle the reframe
      // back in through the vertical. camDist still carries the interior
      // pull-in, so a room DOES get its own tilt; only the sky look is held.
      const dY0 = (lookYFlat + (pitchFollow ? s0 * aimLead * pitchFollow : 0)) - (pivotY + s0 * camDist);
      const dH0 = (pitchFollow ? aimLead * c0 : aimLead) + camDist * c0;
      const tiltRaw = p0 + Math.atan2(dY0, Math.max(0.05, dH0));
      _frameTilt = tiltRaw;             // pitchLimits() spends the rest on the orbit
      // The taper is now a SAFETY NET, not the mechanism: pitchLimits() has
      // already stopped the orbit `tiltRaw` short of the ceiling, so this only
      // catches a frame where the tilt grew under a moving arm. Without either,
      // survival's 0.46 rad resting tilt would carry a full up-pitch past
      // vertical and roll the world over.
      const tilt = rigPitch < 0
        ? Math.min(tiltRaw, Math.max(0, VIEW_UP_MAX + rigPitch))
        : tiltRaw;
      // view basis: V = the mouse direction; U = the view-plane up, = R × V.
      // (R is the horizontal right vector the side offsets already ride on, so
      // the over-shoulder offset stays pitch-independent for free.)
      const vX = fwdVX * cp, vY = -sp, vZ = fwdVZ * cp;
      const uX = fwdVX * sp, uY = cp, uZ = fwdVZ * sp;
      // rise scales with the camera→look span, so the tilt is a SCREEN angle:
      // it survives the interior pull-in and the sky-look arm clamp unchanged.
      const rise = Math.tan(tilt) * (aimLead + orbitDist);
      ltx = tx + vel.x * lead + rightVX * targetSide + vX * aimLead + uX * rise;
      lty = pivotY + vY * aimLead + uY * rise;
      ltz = tz + vel.z * lead + rightVZ * targetSide + vZ * aimLead + uZ * rise;
    } else {
      // legacy look target (flag off, or under canopy): no tilt is being spent,
      // so hand the whole up-envelope back rather than leaving a stale one.
      _frameTilt = 0;
      const aimLeadH = pitchFollow ? aimLead * Math.cos(rigPitch) : aimLead;
      ltx = tx + vel.x * lead + rightVX * targetSide + fwdVX * aimLeadH;
      ltz = tz + vel.z * lead + rightVZ * targetSide + fwdVZ * aimLeadH;
      lty = lookYFlat + (pitchFollow ? Math.sin(rigPitch) * aimLead * pitchFollow : 0);
    }

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
    let targetFov = chuteState ? 66 : TP
      ? (tpADS ? TP.FOV_AIM : (CBZ.CONFIG.CAM_TP_V2 ? TP.FOV : TP.FOV + Math.min(spd / 6, 1) * 5))
      : (shoulder ? 58 + Math.min(spd / 6, 1) * 2.5 : (meleeFocus ? 59 : 61 + Math.min(spd / 6, 1) * 6));
    // CAM_SPRINT_FOV (ships dark — flip to try): the Fortnite-style lens
    // breath — while genuinely sprinting the FOV swells +7° over ~0.4s and
    // eases back on stop. Decoupled from the collision clamp (the coupling was
    // what made the old speed-kick read as "zooms on its own"). Never during ADS.
    if (!chuteState && TP && CBZ.CONFIG.CAM_SPRINT_FOV && !tpADS) {
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
    if (scopeF && !chuteState) targetFov = scopeF;
    // V2: snappier ADS lens punch (~0.12s, Fortnite's targeting transition)
    fov = smoothDamp(fov, targetFov, fovV, TP && CBZ.CONFIG.CAM_TP_V2 ? 0.12 : 0.18, fdt);
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  }

  // ---- CBZ.camAudit() — the numbers a gate can pin instead of a screenshot.
  // The three claims this pass makes are all arithmetic, so all three are
  // measurable from live state after any tick:
  //   d(viewPitch)/d(pitch) == 1  — the orbit is PURE. Sweep cam.pitch and the
  //                                 view must track 1:1 (until the last few
  //                                 degrees, where the tilt taper is deliberate).
  //                                 The shipped rig moved the view 0.08 rad for
  //                                 1.0 rad of mouse — and in the wrong sign.
  //   frameTilt                    — the pivot's angle below the view axis. Must
  //                                 be CONSTANT over that same sweep (that IS
  //                                 "pitching no longer reframes") and must equal
  //                                 the legacy value at the tier's resting pitch.
  //   clear >= 0.35                — the boom never goes through the floor, and
  //                                 `arm` (not a clamped dy) is what gave way.
  //   |viewPitch| < 1.45           — the view never reaches π/2 (world roll).
  // Plus the room sense, so "did the doorway actually register" is a number.
  CBZ.camAudit = function () {
    const P = CBZ.player, C = camera.position;
    const lim = pitchLimits();
    const dY = look.y - C.y, dH = Math.hypot(look.x - C.x, look.z - C.z);
    const viewPitch = -Math.atan2(dY, dH);                 // same sign as cam.pitch (down = +)
    const pY = (P ? P.pos.y + height : 0) - C.y;
    const pH = P ? Math.hypot(P.pos.x - C.x, P.pos.z - C.z) : 0;
    const pivotPitch = -Math.atan2(pY, pH);
    return {
      pitch: cam.pitch, pitchMin: lim[0], pitchMax: lim[1], pitchSafety: PITCH_SAFETY,
      viewUpMax: VIEW_UP_MAX, viewPitch: viewPitch, solvedTilt: _frameTilt,
      frameTilt: pivotPitch - viewPitch,
      dist: camDist, arm: _armDist,
      camY: C.y, groundY: P ? P.pos.y : 0, clear: P ? C.y - P.pos.y : 0,
      enclosure: encK, roomCeil: roomCeil, roomSpan: roomSpan, roomBoom: roomBoom(),
      orbit: CBZ.CONFIG.CAM_RDR2_ORBIT !== false,
      roomCam: CBZ.CONFIG.CAM_ROOM_BOOM !== false,
      // CAM_TP_FIXED_ANGLE: the pin, and the split it creates. `aimPitch` is
      // where the GUN points, `rigPitch` is where the BOOM flies. Pinned, the
      // second is constant while the first sweeps — which is the whole claim,
      // as one number a gate can pin instead of a screenshot.
      fixed: fixedK, fixedOn: tpFixedFrame(),
      aimPitch: cam.pitch, rigPitch: _rigPitch,
      aimBandUp: FIX_AIM_UP, aimBandDown: FIX_AIM_DOWN,
      aimDecoupled: CBZ.camAimDecoupled(),
    };
  };

  CBZ.updateCamera = updateCamera;
  CBZ.onAlways(50, updateCamera);

  camera.position.set(CBZ.SPAWN.x, 3.0, CBZ.SPAWN.z + 7);
  camera.lookAt(CBZ.SPAWN.x, 1.0, CBZ.SPAWN.z);
})();
