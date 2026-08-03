/* ============================================================
   systems/touch.js — iPad / phone controls (TOUCH_V2).

   The whole touch layer in one thumb-vocabulary:
     • LEFT-thumb joystick = move. FIXED in the bottom-left corner (faint
       until touched): a movement touch must BEGIN inside its catch zone,
       so taps anywhere else on the left half (radar, HUD, world) are
       never mistaken for a move — they fall through exactly like
       right-half touches. TOUCH_FIXED_STICK=false restores the old
       recenter-to-the-press dynamic disc.
     • RIGHT-half drag = look. Two fingers = pinch the chase cam.
     • TAP THE WORLD = THE VERB. A quick tap raycasts the real rendered
       meshes; if it hits a car / plane / rideable animal / ped it either
       triggers the SAME code path the keyboard uses (when in reach) or
       WALKS the player there and triggers on arrival. Tapping a car gets
       you in / steals it, a plane boards it, a ped opens the contextual
       #interact card (whose YES/NO rows are already click-driven).
     • MOVEMENT/COMBAT buttons are ICONS (fire reticle, jump arc,
       first-person eye, weapon swap, reload, aim, scope). But
       INTERACTION prompts carry WORDS: the owner wants a button that
       SAYS "HIJACK", so contextual verb pills (the #interact card, the
       walk-up shop/property prompts) spell out the action itself —
       never a keyboard letter. That supersedes the old "no words ever"
       rule, which now applies only to the movement cluster.
     • GAIT LIVES IN THE STICK: sprint is not a button — ramming the
       stick to its rim sprints (stamina permitting, with hysteresis so
       the gait never flaps), easing back drops to a run. A quick PRESS
       on the stick base (the console L3 gesture) toggles crouch through
       the same Ctrl/C sneak-key path physics.js already reads.

   WHY tap-to-interact can't drift from the keyboard: for rides it calls
   the very functions CBZ.cityTryNearestRide() terminates in
   (cityEnterVehicle / cityBoardMilitaryVehicle / cityMountAnimal), just
   aimed at the specific tapped record. For peds it only aims the camera
   and asks CBZ.interactions to refresh — the panel, its targeting and its
   YES/NO handlers are entirely owned by city/interactions.js, so the same
   verbs the keyboard shows are the ones a tap fires. The same doctrine
   drives the verb pills: CBZ.touchActionPrompt / CBZ.touchPromptHTML
   re-skin a module's prompt but FIRE the module's own key handler (a
   synthesized keydown, the gamepad.js pattern) or a named CBZ function —
   never a reimplementation.

   Everything here is gated to touch / coarse-pointer devices, so desktop
   is byte-for-byte unchanged. One-line reverts (all default ON, all
   URL-overridable via ?cfg_X=0):
     TOUCH_V2           — ped-tap + walk-to layer
     TOUCH_VERB_PROMPTS — worded verb pills replacing key glyphs
     TOUCH_AUTOSPRINT   — stick-rim deflection sprint (the gait pump)
     TOUCH_HUD_TIDY     — body.touch-tidy declutter CSS (mobile.css)
     TOUCH_VEHICLE      — drive/heli/wing button layer (touch_vehicle.js)
     TOUCH_FIXED_STICK  — joystick anchored bottom-left (false = dynamic)
     TOUCH_AIM_SLIDE    — hold AIM/SCOPE and SLIDE onto FIRE to shoot
                          while the hold stays down; also seats those two
                          buttons beside the trigger (mobile.css .tslide)
     TOUCH_SCOPE_UP     — from SCOPE, an upward drag ALSO fires (owner: "drag
                          UP, not right"); same hold/release as the FIRE slide
     TOUCH_AIM_DRAG     — the console LT+right-stick grammar: while a finger
                          HOLDS aim/scope, dragging that same finger FINE-
                          AIMS the camera (identical math to the look-drag,
                          via applyLookDelta). The drag never cancels the
                          hold, works before/during/after a slide onto FIRE,
                          and the finger stays a slide-touch — the look slot
                          and its watchdog never claim or rob it.
     TOUCH_LOOK_WHILE_MOVE — two-thumb grammar: stick + look-drag work
                          TOGETHER. Pinch-zoom needs two FREE fingers;
                          a claimed finger (stick / slide-hold / UI) is
                          never half a pinch. false = legacy gate (any
                          two touches pinched, killing move+look).
     TOUCH_TP_CAMERA_V2 — the third-person-on-iPad pass (owner 2026-07-28,
                          "iPad needs third person improved"). Master flag
                          for the three below plus systems/camera.js's
                          CAM_TP_TOUCH_ZOOM / CAM_TOUCH_RECENTER /
                          CAM_TOUCH_PITCH_FULL.
     TOUCH_LOOK_ACCEL   — pointer acceleration on the LOOK drag only. A
                          thumb has ~1/3 of a mouse's usable travel, so a
                          flat px→radians ramp has to choose between fine
                          aim and being able to turn round; the curve
                          gives both (identity below ACC_LO, ×ACC_MAX at
                          a flick). NEVER while ADS/scoped — precision
                          there is the whole point — and never on the
                          aim/scope finger's fine-aim drag.
     TOUCH_LOOK_GLIDE   — a flick keeps turning for ~0.35 s and decays.
                          Third person only, never while aiming, and any
                          new touch kills it dead.
     TOUCH_RECENTER     — the level-the-view button (on foot in the icon
                          cluster; a RECENTER pill in the vehicle layer).
                          On foot it SHOWS ITSELF only when the view is
                          actually off-level, so the cluster stays calm.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  // Default ON. Kept inside this owned file (config.js's generic ?cfg_ loader
  // still honours a URL override before this runs). false → the new ped-tap +
  // walk-to layer is skipped and taps fall back to in-reach rides only.
  if (CBZ.CONFIG && CBZ.CONFIG.TOUCH_V2 == null) CBZ.CONFIG.TOUCH_V2 = true;
  if (CBZ.CONFIG && CBZ.CONFIG.TOUCH_VERB_PROMPTS == null) CBZ.CONFIG.TOUCH_VERB_PROMPTS = true;
  if (CBZ.CONFIG && CBZ.CONFIG.TOUCH_AUTOSPRINT == null) CBZ.CONFIG.TOUCH_AUTOSPRINT = true;
  if (CBZ.CONFIG && CBZ.CONFIG.TOUCH_HUD_TIDY == null) CBZ.CONFIG.TOUCH_HUD_TIDY = true;
  if (CBZ.CONFIG && CBZ.CONFIG.TOUCH_FIXED_STICK == null) CBZ.CONFIG.TOUCH_FIXED_STICK = true;
  if (CBZ.CONFIG && CBZ.CONFIG.TOUCH_AIM_SLIDE == null) CBZ.CONFIG.TOUCH_AIM_SLIDE = true;
  if (CBZ.CONFIG && CBZ.CONFIG.TOUCH_SCOPE_UP == null) CBZ.CONFIG.TOUCH_SCOPE_UP = true;
  if (CBZ.CONFIG && CBZ.CONFIG.TOUCH_AIM_UP == null) CBZ.CONFIG.TOUCH_AIM_UP = true;
  if (CBZ.CONFIG && CBZ.CONFIG.TOUCH_AIM_DRAG == null) CBZ.CONFIG.TOUCH_AIM_DRAG = true;
  if (CBZ.CONFIG && CBZ.CONFIG.TOUCH_LOOK_WHILE_MOVE == null) CBZ.CONFIG.TOUCH_LOOK_WHILE_MOVE = true;
  if (CBZ.CONFIG && CBZ.CONFIG.TOUCH_TP_CAMERA_V2 == null) CBZ.CONFIG.TOUCH_TP_CAMERA_V2 = true;
  if (CBZ.CONFIG && CBZ.CONFIG.TOUCH_LOOK_ACCEL == null) CBZ.CONFIG.TOUCH_LOOK_ACCEL = true;
  if (CBZ.CONFIG && CBZ.CONFIG.TOUCH_LOOK_GLIDE == null) CBZ.CONFIG.TOUCH_LOOK_GLIDE = true;
  if (CBZ.CONFIG && CBZ.CONFIG.TOUCH_RECENTER == null) CBZ.CONFIG.TOUCH_RECENTER = true;
  const V2 = !CBZ.CONFIG || CBZ.CONFIG.TOUCH_V2 !== false;
  const TPV2 = () => !CBZ.CONFIG || CBZ.CONFIG.TOUCH_TP_CAMERA_V2 !== false;
  const FIXED = !CBZ.CONFIG || CBZ.CONFIG.TOUCH_FIXED_STICK !== false;
  const SLIDE = !CBZ.CONFIG || CBZ.CONFIG.TOUCH_AIM_SLIDE !== false;
  const SCOPEUP = !CBZ.CONFIG || CBZ.CONFIG.TOUCH_SCOPE_UP !== false;
  const AIMUP = !CBZ.CONFIG || CBZ.CONFIG.TOUCH_AIM_UP !== false;
  const AIMDRAG = () => !CBZ.CONFIG || CBZ.CONFIG.TOUCH_AIM_DRAG !== false;

  const SENS = 0.006, MAXR = 74, DEAD = 0.28;   // MAXR matches the enlarged 168px disc (owner: bigger pad, less corner)
  // TOUCH_AIM_ASSIST tuning (touch-only aim help off the lock-on candidate pool):
  //   FRICTION — look sensitivity eases to *_MIN as the crosshair (screen centre)
  //     comes within *_NDC of a candidate, so the reticle "sticks" a little.
  //   MAGNETISM — a rate-capped pull toward the nearest candidate WITHIN *_NDC of
  //     the crosshair while aiming; RATE is the settle strength, CAP the hard
  //     per-second angular ceiling. Deliberately mild — assist, not autolock.
  const AIM_FRICTION_NDC = 0.14, AIM_FRICTION_MIN = 0.55;
  const AIM_MAG_NDC = 0.09, AIM_MAG_RATE = 2.2, AIM_MAG_CAP = 0.35;
  const STICK_ZONE = 1.6;      // catch zone = this × the visible disc radius
  const SPRINT_HI = 0.85, SPRINT_LO = 0.70;   // stick-rim sprint band (on/off)
  const SLIDE_PAD_IN = 12;     // fire's hit-rect grows this much for ENTRY —
                               // exactly bridges the 12px gap to AIM/SCOPE so
                               // there is NO dead zone between the buttons
  const SLIDE_PAD_OUT = 26;    // …and this much before a slide LEAVES fire
  // AIM's dedicated swipe-UP shot is intentionally shorter than a full
  // control-to-control roll. At 18px it clears ordinary thumb jitter but fires
  // before the drag can pitch the iPad camera very far; 10px release hysteresis
  // keeps a held burst stable. SCOPE keeps the older, longer threshold.
  const AIM_UP_TRIGGER = 18, AIM_UP_RELEASE = 10;
  const LOOK_STALE_MS = 3000;  // look watchdog: no move this long = ghost
  const WALK_MAX = 46;        // don't set off on a cross-map trek from one tap
  const WALK_TIMEOUT = 14;    // give up (moving target / stuck) after this many s
  // TOUCH_LOOK_ACCEL — the curve, in PIXELS PER MILLISECOND of finger travel.
  // Below ACC_LO the gain is exactly 1, so every slow, deliberate drag is the
  // old sensitivity to the last bit; between ACC_LO and ACC_HI it smoothsteps
  // to ACC_MAX. Calibration: a careful thumb tracks ~250 px/s (0.25) and stays
  // at 1.00; an ordinary turn runs ~1200 px/s (1.2) → ~1.55; a hard flick
  // ~3000 px/s (3.0) → the 2.10 ceiling. So "turn round to see who shot me" is
  // one flick instead of three drags, and nothing about aiming changed.
  const ACC_LO = 0.40, ACC_HI = 2.60, ACC_MAX = 2.10;
  // TOUCH_LOOK_GLIDE — release momentum. GLIDE_MIN is the release speed below
  // which nothing glides (so an ordinary settle-and-lift never drifts), CAP the
  // ceiling, and GLIDE_K the exponential decay rate: e^-8 ≈ 0.0003, so the
  // whole coast is spent inside ~0.35 s. Deliberately short — this is follow-
  // through, not a spinning chair.
  const GLIDE_MIN = 900, GLIDE_CAP = 2800, GLIDE_K = 8.0;
  // TOUCH_RECENTER — the on-foot button appears past OFF_SHOW radians away from
  // the resting pitch and hides again under OFF_HIDE. Hysteresis, so a thumb
  // resting near the boundary can never make it blink. 0.34 rad is ~19.5°:
  // wide enough that ordinary "look a bit down the street" browsing never
  // summons it, tight enough that a view genuinely stuck at the sky or the
  // pavement always offers the way back.
  const REC_OFF_SHOW = 0.34, REC_OFF_HIDE = 0.14;

  let built = false, enabled = false;
  // GAIT/STANCE state: sprint lives in the stick (rim deflection = shift) and
  // crouch is the L3 stick-press latch; both are pumped per frame below with
  // hysteresis so nothing flaps at a boundary. Desktop never runs any of this.
  let stamOk = true, shiftOwned = false, sprintBand = false, stickMag = 0;
  let crouchLatch = false, crouchOwned = false;
  let recenShown = false;      // TOUCH_RECENTER visibility latch (hysteresis)
  const stick = { id: null, cx: 0, cy: 0, sx: 0, sy: 0, t0: 0, moved: 0 };
  const look = { id: null, lx: 0, ly: 0, sx: 0, sy: 0, t0: 0, moved: 0, free: false, seen: 0 };
  const walk = { on: false, kind: null, rec: null, t: 0 };
  // slide-hold touches (aim/scope fingers), keyed by touch identifier — each
  // record knows how to fully release itself (used by end, the stale sweep,
  // and the page-blur clear). fireHolds refcounts every way FIRE can be down.
  const slideTouches = new Map();
  let fireHolds = 0, fireOn = false;
  let baseEl, knobEl;
  const tapRay = window.THREE ? new THREE.Raycaster() : null;
  const tapNdc = window.THREE ? new THREE.Vector2() : null;
  const tapBox = window.THREE ? new THREE.Box3() : null;
  // TOUCH_AIM_ASSIST magnetism scratch (reused; no per-frame allocation).
  const _amEye = window.THREE ? new THREE.Vector3() : null;
  const _amDir = window.THREE ? new THREE.Vector3() : null;
  const _ncHolder = { e: null, r: 0 };

  // ---- wordless glyphs (inline SVG so they render identically on iPad) -------
  const SVG = {
    fire: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2.3" fill="currentColor" stroke="none"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/></svg>',
    jump: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"/><path d="M6.5 8.5 12 3l5.5 5.5"/><path d="M4 21h16"/></svg>',
    eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    swap: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h13"/><path d="M14 6l3 3-3 3"/><path d="M20 15H7"/><path d="M10 12l-3 3 3 3"/></svg>',
    reload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4.5V9h-4.5"/></svg>',
    scope: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7.5"/><path d="M12 1.5v6M12 16.5v6M1.5 12h6M16.5 12h6"/></svg>',
    aim: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8V4.5A1.5 1.5 0 0 1 4.5 3H8"/><path d="M16 3h3.5A1.5 1.5 0 0 1 21 4.5V8"/><path d="M21 16v3.5a1.5 1.5 0 0 1-1.5 1.5H16"/><path d="M8 21H4.5A1.5 1.5 0 0 1 3 19.5V16"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/></svg>',
    homing: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none"/><path d="M12 4v-2.5M12 22.5V20M4 12H1.5M22.5 12H20"/></svg>',
    // RECENTER — two chevrons collapsing onto a horizon line: "bring the view
    // back to level". Deliberately unlike every other glyph in this cluster
    // (reticle / arc / eye / brackets / rings) so it reads at a glance.
    level: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12h19"/><path d="M8 6.6 12 10.4 16 6.6"/><path d="M8 17.4 12 13.6 16 17.4"/></svg>',
  };
  function btn(id, cls, glyph, label) {
    return '<button class="' + cls + '" id="' + id + '" type="button" aria-label="' + label + '">' + glyph + "</button>";
  }

  function enable() {
    if (enabled) return;
    enabled = true; CBZ.touchMode = true;
    document.body.classList.add("touch");
    // Declutter CSS (mobile.css) keys off this second class so the whole
    // tidy-up is one flag: CBZ.CONFIG.TOUCH_HUD_TIDY = false restores the
    // desktop-identical HUD arrangement while keeping the controls.
    if (!CBZ.CONFIG || CBZ.CONFIG.TOUCH_HUD_TIDY !== false) document.body.classList.add("touch-tidy");
    build();
  }
  // The interaction renderers load on both phones and tablets. This one shared
  // read decides when the iPad-only docked grammar is available, so they never
  // each invent a different viewport cutoff.
  CBZ.touchInteractionDocked = function () {
    return !!(enabled && innerWidth >= 700 && innerHeight >= 550);
  };

  function build() {
    if (built) return; built = true;
    const wrap = document.createElement("div");
    wrap.id = "touch";
    // column-reverse: first child sits at the BOTTOM (nearest the thumb).
    wrap.innerHTML =
      '<div id="tstick"><div id="tknob"></div></div>' +
      '<div id="tbtns">' +
      btn("tfire", "tbtn tbig tfire", SVG.fire, "Fire") +
      btn("tjump", "tbtn tjump", SVG.jump, "Jump") +
      btn("tview", "tbtn tsm", SVG.eye, "First-person view") +
      btn("tswap", "tbtn tsm", SVG.swap, "Next weapon") +
      btn("treload", "tbtn tsm", SVG.reload, "Reload") +
      btn("taim", "tbtn tsm", SVG.aim, "Aim") +
      btn("tscope", "tbtn tsm", SVG.scope, "Scope") +
      btn("thoming", "tbtn tsm", SVG.homing, "Homing on/off") +
      btn("trecen", "tbtn tsm", SVG.level, "Recenter the view") +
      '<div id="tfireup" aria-hidden="true">' + SVG.fire + "</div>" +
      "</div>";
    document.body.appendChild(wrap);
    baseEl = document.getElementById("tstick");
    knobEl = document.getElementById("tknob");

    holdBtn("tjump", (down) => { CBZ.keys[" "] = down; });
    // FIRE goes through the refcounted fireHold so the physical button and an
    // aim/scope finger that has SLID onto it can overlap without cutting each
    // other's trigger (fireAction sees one down on 0→1, one up on 1→0).
    holdBtn("tfire", fireHold);
    tapBtn(document.getElementById("tview"), () => { if (CBZ.toggleFPS) CBZ.toggleFPS(); });
    tapBtn(document.getElementById("tswap"), () => { if (CBZ.fpsNextWeapon) CBZ.fpsNextWeapon(); });
    // homing on/off (owner: toggleable "even on the iPad"). State reads as
    // lit vs dim + the lock squares standing down — no words, no popup.
    tapBtn(document.getElementById("thoming"), () => {
      if (CBZ.lockonHomingSet) CBZ.lockonHomingSet(!CBZ.lockonHomingOn());
      if (CBZ.sfx) CBZ.sfx("rack", { volume: 0.3, pitch: CBZ.lockonHomingOn && CBZ.lockonHomingOn() ? 1.25 : 0.8 });
    });
    tapBtn(document.getElementById("treload"), () => { if (CBZ.fpsReload) CBZ.fpsReload(); });
    // RECENTER (TOUCH_RECENTER) — a mouse levels the view in one flick; a thumb
    // has to drag back across the whole screen, which is why every console
    // third-person game binds this to a stick click. Camera-owned verb, so it
    // calls the camera agent's hook and this file writes no pitch of its own.
    tapBtn(document.getElementById("trecen"), () => {
      if (CBZ.camRecenter) CBZ.camRecenter();
      glide.vx = glide.vy = 0;
      if (CBZ.sfx) CBZ.sfx("key", { volume: 0.22, pitch: 1.1 });
    });
    // AIM (ADS) — the missing iPad right-mouse: hold pulls the camera in /
    // tightens FOV / steadies recoil via the EXISTING CBZ.fpsSetAim hook the
    // gamepad triggers use. Hold = aim, release = unaim.
    // SCOPE — sibling system (sniper scope + lock-on) exposes feature-detected
    // hooks; every call is guarded so this button is correct whether that API
    // is present, absent, or lands under a slightly different shape. Hold =
    // scope while pressed (CBZ.fpsScope(down)); tap with only a toggle API =
    // CBZ.fpsScopeToggle(). Distinct from AIM: scope = true sniper zoom.
    // Visibility for both is driven from the armed check below.
    // Both are SLIDE-holds (TOUCH_AIM_SLIDE): the touch keeps aim/scope down
    // for its whole life, and rolling onto FIRE shoots without lifting —
    // press aim, DRAG to shoot (mobile.css .tslide seats them beside FIRE).
    const aimFn = (down) => { if (CBZ.fpsSetAim) CBZ.fpsSetAim(down); };
    const scopeFn = (down) => {
      if (CBZ.fpsScope) CBZ.fpsScope(down);
      else if (down && CBZ.fpsScopeToggle) CBZ.fpsScopeToggle();
    };
    if (SLIDE) { slideHoldBtn("taim", aimFn); slideHoldBtn("tscope", scopeFn); }
    else { holdBtn("taim", aimFn); holdBtn("tscope", scopeFn); }
    if (SLIDE) document.getElementById("tbtns").classList.add("tslide");
    if (FIXED) baseEl.classList.add("tfixed");
    // RECENTER starts hidden: it is a self-summoning control (see the visibility
    // rule in the onAlways below) and a one-frame flash of a button that then
    // vanishes is worse than never showing it.
    const rc0 = document.getElementById("trecen"); if (rc0) rc0.style.display = "none";
  }

  // press-and-hold button (jump/fire). It now tracks WHICH fingers are on it
  // rather than counting bare events, for the reason the rest of this file
  // already documents at length: a swallowed touchend (system edge swipe,
  // notification shade, screenshot chord) is a real and routine event on iPad,
  // and the slide-holds got a stale sweep for exactly that while the two
  // MOST-pressed buttons in the game — FIRE and JUMP — never did. A lost
  // touchend on JUMP left CBZ.keys[" "] held down until the next blur, which
  // in a helicopter is the collective pinned up.
  const holdBtns = [];
  function holdBtn(id, fn) {
    const b = document.getElementById(id);
    const rec = { el: b, ids: new Set(), born: 0 };
    const down = (t) => {
      if (rec.ids.has(t)) return;
      rec.ids.add(t); rec.born = performance.now();
      if (rec.ids.size === 1) { b.classList.add("on"); fn(true); }
    };
    const up = (t) => {
      if (!rec.ids.delete(t)) return;
      if (rec.ids.size === 0) { b.classList.remove("on"); fn(false); }
    };
    rec.release = function () {
      if (!rec.ids.size) return;
      rec.ids.clear(); b.classList.remove("on");
      try { fn(false); } catch (e) {}
    };
    holdBtns.push(rec);
    b.addEventListener("touchstart", (e) => { e.preventDefault(); for (const t of e.changedTouches) down(t.identifier); }, { passive: false });
    const endF = (e) => { e.preventDefault(); for (const t of e.changedTouches) up(t.identifier); };
    b.addEventListener("touchend", endF, { passive: false });
    b.addEventListener("touchcancel", endF, { passive: false });
    b.addEventListener("mousedown", (e) => { e.preventDefault(); down("m"); });
    b.addEventListener("mouseup", () => up("m"));
  }
  // tap button (toggle/one-shot). The .on flash is not decoration: these fire on
  // touchSTART with no hold state, so without it a tap that DID work is
  // indistinguishable from a tap that missed the 52 px circle — and on a
  // stateless verb (swap / reload / recenter) there is no other confirmation.
  // The vehicle layer's tapBtn has always flashed; this is the cluster catching up.
  function tapBtn(b, fn) {
    const flash = () => { b.classList.add("on"); setTimeout(() => b.classList.remove("on"), 110); };
    b.addEventListener("touchstart", (e) => { e.preventDefault(); flash(); fn(); }, { passive: false });
    b.addEventListener("mousedown", (e) => { e.preventDefault(); flash(); fn(); });
  }

  // The trigger itself: in first-person it shoots/punches via the FPS module;
  // otherwise it's the third-person panic-fire / unarmed melee (desktop L-click).
  function fireAction(down) {
    // A mounted shark's mouth is its weapon. Consume both press and release so
    // the same iPad FIRE touch can never also punch or discharge a held gun.
    if (CBZ.cityMountedAnimalAttack && CBZ.cityMountedAnimalAttack(down)) return;
    if (((CBZ.fps && CBZ.fps.active) || (CBZ.weaponThirdPersonActive && CBZ.weaponThirdPersonActive())) && CBZ.fpsFire) CBZ.fpsFire(down);
    else if (down) {
      if (CBZ.game.mode === "survival") { if (CBZ.grapple) CBZ.grapple.punch(); }
      else if (CBZ.punch) CBZ.punch();
    }
  }
  // Refcounted trigger: every way FIRE can be down (the physical button, each
  // aim/scope finger currently slid onto it) holds one count; the weapon sees
  // exactly one clean down on 0→1 and one clean up on 1→0, so one finger
  // lifting can never cut another finger's burst.
  function fireHold(down) {
    fireHolds = Math.max(0, fireHolds + (down ? 1 : -1));
    const want = fireHolds > 0;
    if (want === fireOn) return;
    fireOn = want;
    const fb = document.getElementById("tfire");
    if (fb) fb.classList.toggle("on", want);
    fireAction(want);
  }
  // slide-hold (TOUCH_AIM_SLIDE) — the owner's "press aim, DRAG to shoot":
  // like holdBtn, but the touch KEEPS the hold for its entire life wherever
  // the finger roams (touchmove/touchend keep firing on the START target —
  // touch implicit capture — so no window listeners are needed), and while
  // held the finger can slide onto FIRE:
  //   • start on AIM  → aim held until the finger lifts, wherever it goes
  //   • slide onto FIRE (hit-rect inflated SLIDE_PAD_IN, closing the gap
  //     between the adjacent buttons — no dead zone) → fire begins
  //   • slide off FIRE (rect + SLIDE_PAD_OUT, hysteresis so a finger resting
  //     on the edge never stutters the trigger) → fire stops, aim still held
  //   • lift → fire (if engaged) and aim released together
  // A separate finger pressing FIRE directly keeps working throughout — see
  // fireHold. SCOPE gets the same grammar.
  function slideHoldBtn(id, fn) {
    const b = document.getElementById(id);
    let holds = 0;   // fingers currently holding THIS button's verb
    const wrap = () => document.getElementById("tbtns");
    const down = () => { if (++holds === 1) { b.classList.add("on"); fn(true);
      if (id === "taim" && AIMUP) { const w = wrap(); if (w) { w.classList.add("aimup-live");
        const sc = document.getElementById("tscope");
        w.classList.toggle("scope-shown", !!(sc && sc.style.display !== "none")); } } } };
    const up = () => { if (holds > 0 && --holds === 0) { b.classList.remove("on"); fn(false);
      if (id === "taim") { const w = wrap(); if (w) w.classList.remove("aimup-live");
        const fp = document.getElementById("tfireup"); if (fp) fp.classList.remove("fireon"); } } };
    b.addEventListener("touchstart", (e) => {
      e.preventDefault();
      const fb = document.getElementById("tfire");
      const fr = fb && fb.style.display !== "none" ? fb.getBoundingClientRect() : null;
      for (const t of e.changedTouches) {
        if (slideTouches.has(t.identifier)) continue;
        const tid = t.identifier;
        const rec = {
          fireIn: false, rect: fr, release: null,
          born: performance.now(),          // shields this fresh claim from the same event's window-level sweep (which sees our id as a "recycled newborn")
          lx: t.clientX, ly: t.clientY,     // fine-aim drag anchor (TOUCH_AIM_DRAG)
          sy: t.clientY,                    // stable start-Y for SCOPE drag-UP-to-fire (ly drifts w/ AIMDRAG)
        };
        rec.release = function () {
          if (!slideTouches.delete(tid)) return;   // already gone (sweep vs touchend)
          if (rec.fireIn) { rec.fireIn = false; fireHold(false); }
          up();
        };
        slideTouches.set(tid, rec);
        down();
      }
    }, { passive: false });
    b.addEventListener("touchmove", (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        const rec = slideTouches.get(t.identifier);
        if (!rec) continue;
        // TOUCH_AIM_DRAG — the console LT + right-stick grammar: the finger
        // HOLDING aim/scope fine-aims by dragging, through the very same
        // applyLookDelta the look slot uses (same sens/scoped scaling/pitch
        // clamps). Runs for the touch's whole life — before, during AND after
        // a roll across FIRE — and never affects the hold itself (implicit
        // touch capture keeps these events on the button regardless of where
        // the finger roams, so there is no slop that could cancel anything).
        // This finger is a slide-touch, never the look slot: the look
        // claim/adopt paths and the stale-watchdog all exclude slideTouches.
        if (AIMDRAG()) {
          // accel=false: this IS the fine-aim finger. TOUCH_LOOK_ACCEL exists
          // so a thumb can turn round in one flick; applying it here would
          // curve the one drag whose entire job is to be linear.
          applyLookDelta(t.clientX - rec.lx, t.clientY - rec.ly, false);
          rec.lx = t.clientX; rec.ly = t.clientY;
        }
        if (!rec.rect) continue;
        const r = rec.rect, p = rec.fireIn ? SLIDE_PAD_OUT : SLIDE_PAD_IN;
        let inFire = t.clientX >= r.left - p && t.clientX <= r.right + p &&
                     t.clientY >= r.top - p && t.clientY <= r.bottom + p;
        // The roll-onto-FIRE trigger mirrored to the vertical axis. AIM uses a
        // short, explicit pull so shooting starts before its fine-aim drag has
        // pitched the iPad camera far upward; SCOPE retains the older deliberate
        // travel. Both share the same fire/refcount/release path.
        const upRoute = (SCOPEUP && id === "tscope") || (AIMUP && id === "taim");
        if (upRoute) {
          const threshold = id === "taim"
            ? (rec.fireIn ? AIM_UP_RELEASE : AIM_UP_TRIGGER)
            : (rec.fireIn ? SLIDE_PAD_IN : SLIDE_PAD_OUT);
          if (rec.sy - t.clientY >= threshold) inFire = true;
        }
        if (inFire !== rec.fireIn) { rec.fireIn = inFire; fireHold(inFire);
          if (id === "taim") { const fp = document.getElementById("tfireup"); if (fp) fp.classList.toggle("fireon", inFire); } }
      }
    }, { passive: false });
    const end = (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        const rec = slideTouches.get(t.identifier);
        if (rec) rec.release();
      }
    };
    b.addEventListener("touchend", end, { passive: false });
    b.addEventListener("touchcancel", end, { passive: false });
    b.addEventListener("mousedown", (e) => { e.preventDefault(); down(); });
    b.addEventListener("mouseup", () => up());
  }

  // ---- verb-first prompts (the owner's "button that SAYS HIJACK") -----------
  // Modules with a private walk-up prompt route their HTML through these.
  // Desktop: strings come back unchanged ("[G] Vault — store"), byte-identical.
  // Touch (+TOUCH_VERB_PROMPTS): the key glyph disappears and the prompt
  // becomes a tappable pill that fires the module's OWN handler — either a
  // synthesized keypress (the gamepad.js pattern; every module keydown reads
  // e.key) or a named CBZ.* function for handlers a fake key can't reach.
  const verbPills = () => enabled && (!CBZ.CONFIG || CBZ.CONFIG.TOUCH_VERB_PROMPTS !== false);
  function pillHTML(act, label, small) {
    const attr = act.charAt(0) === "@" ? 'data-tfn="' + act.slice(1) + '"' : 'data-tkey="' + act + '"';
    return '<button type="button" class="tpill' + (small ? " tpill-sm" : "") + '" ' + attr + ">" + label + "</button>";
  }
  // One action: act = "g" (a key) or "@cityFnName" (a CBZ function), a worded
  // label, and an optional desktop string for prompts that aren't the plain
  // "[G] label" form (e.g. the aircraft's bare "✈" glyph).
  CBZ.touchActionPrompt = function (act, label, desktopHtml) {
    if (!verbPills()) return desktopHtml != null ? desktopHtml : "[" + String(act).toUpperCase() + "] " + label;
    return pillHTML(String(act), label);
  };
  // Rich prompt strings ("<b>[E]</b> Buy X · [F] next"): every [K] marker and
  // the text that follows it becomes one pill (first = primary, rest small).
  const KEYMARK = /(?:<b[^>]*>)?\[([A-Za-z])\](?:<\/b>)?\s*/g;
  CBZ.touchPromptHTML = function (html) {
    if (!verbPills() || typeof html !== "string") return html;
    KEYMARK.lastIndex = 0;
    let m; const marks = [];
    while ((m = KEYMARK.exec(html))) marks.push({ key: m[1].toLowerCase(), s: m.index, e: KEYMARK.lastIndex });
    if (!marks.length) return html;
    let out = html.slice(0, marks[0].s);
    for (let i = 0; i < marks.length; i++) {
      const seg = html.slice(marks[i].e, i + 1 < marks.length ? marks[i + 1].s : html.length);
      const label = seg.replace(/^\s*(?:[·|•]\s*)/, "").replace(/(?:\s*[·|•])\s*$/, "");
      out += pillHTML(marks[i].key, label, i > 0);
    }
    return out;
  };
  // Fire the logical key a pill stands for: a real KeyboardEvent pair on
  // document (the gamepad.js pattern) so capture- and bubble-phase module
  // listeners both hear it, with e.code carried for handlers that check it.
  CBZ.touchKeyTap = function (key) {
    key = String(key || "").toLowerCase();
    const init = { key: key, bubbles: true, cancelable: true };
    if (/^[a-z]$/.test(key)) init.code = "Key" + key.toUpperCase();
    try {
      document.dispatchEvent(new KeyboardEvent("keydown", init));
      document.dispatchEvent(new KeyboardEvent("keyup", init));
    } catch (e) {}
  };
  // CAPTURE-phase so a pill tap fires exactly ONE action: several legacy
  // prompt divs are themselves click-wired (bank/pawn/jewelry/…), and letting
  // the tap bubble into them would fire the verb twice.
  document.addEventListener("click", function (e) {
    if (!enabled) return;
    const p = e.target && e.target.closest && e.target.closest(".tpill[data-tkey],.tpill[data-tfn]");
    if (!p) return;
    e.preventDefault(); e.stopPropagation();
    const fn = p.getAttribute("data-tfn");
    if (fn) { if (typeof CBZ[fn] === "function") CBZ[fn](); return; }
    CBZ.touchKeyTap(p.getAttribute("data-tkey"));
  }, true);

  // Any UI a tap should reach natively (buttons/options/panels) — so a touch on
  // one never starts the joystick / look-drag or a world tap. .screen already
  // covers title/pause/win/lose overlays. The walk-up prompt divs are listed
  // by id: on touch they carry tappable verb pills (several were click-wired
  // all along), and #cRadar / #minimap taps open the full map (fullmap.js).
  const UI_SEL = "#tbtns, #tveh, #interact, .screen, #pkgPanel, #cpPanel, #fullMap, " +
    "#raceBoard, #speedwayStandings, #speedwayBook, " +
    "#phone, #dashboard, button, [data-act], .iopt, .tpill, #cRadar, #minimap, " +
    "#bankPrompt, #pawnPrompt, #jewelryPrompt, #clothingPrompt, #gunstorePrompt, " +
    "#shopliftPrompt, #cityStoragePrompt, #cityAircraftPrompt";
  const inUI = (t) => t && t.closest && t.closest(UI_SEL);

  function setMove(nx, ny) {
    const k = CBZ.keys;
    k["w"] = ny < -DEAD; k["s"] = ny > DEAD; k["a"] = nx < -DEAD; k["d"] = nx > DEAD;
    stickMag = Math.hypot(nx, ny);   // the gait pump maps this to walk/sprint
  }
  function clearMove() { const k = CBZ.keys; k["w"] = k["a"] = k["s"] = k["d"] = false; stickMag = 0; }

  // deflect the knob + movement keys from the stick centre (fixed: the anchor;
  // dynamic: wherever the press recentred it) — shared by touchstart/touchmove
  function stickDeflect(x, y) {
    const dx = x - stick.cx, dy = y - stick.cy;
    const len = Math.hypot(dx, dy) || 1, cl = Math.min(len, MAXR);
    knobEl.style.transform = "translate(" + (dx / len * cl) + "px," + (dy / len * cl) + "px)";
    setMove(dx / MAXR, dy / MAXR);
  }
  // Slot releases must NEVER fail halfway: ids clear FIRST, feature hooks are
  // fenced — a throwing camera hook must not leave a slot claimed forever.
  function releaseStick() {
    stick.id = null; clearMove();
    if (knobEl) knobEl.style.transform = "";
    if (baseEl) baseEl.classList.remove("on");
  }
  function releaseLook() {
    look.id = null;
    if (look.free) { look.free = false; try { if (CBZ.camFreeLook) CBZ.camFreeLook(false); } catch (err) {} }
  }
  // Road cars own explicit LEFT/RIGHT/GAS/BRAKE buttons. Aircraft and boats
  // deliberately return false here so their well-liked joystick stays intact.
  function carButtonsActive() {
    return !!(CBZ.touchVehicleMode && CBZ.touchVehicleMode() === "drive");
  }
  let interactDockSig = "";
  function syncInteractionDock() {
    const prisonPanel = document.querySelector("#pinteract.show");
    const sharedPanel = document.querySelector("#interact.show:not(.pi-quiet)");
    const panel = prisonPanel || sharedPanel;
    if (!panel || !CBZ.touchInteractionDocked || !CBZ.touchInteractionDocked()) {
      interactDockSig = "";
      return;
    }
    const opts = prisonPanel ? prisonPanel.querySelector(".pi-row") : document.getElementById("interactOpts");
    const choiceCount = prisonPanel
      ? prisonPanel.querySelectorAll(".pi-choice").length
      : (opts ? opts.children.length : 0);
    if (!opts || !choiceCount) return;
    // Reload is the requested first-row landmark. When the player is unarmed
    // and that slot is absent, fall back through the neighbouring stable
    // controls instead of leaving the choices floating in the old centre band.
    const ids = ["treload", "tswap", "tview", "tjump"];
    let anchor = null;
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el && el.getClientRects().length && getComputedStyle(el).visibility !== "hidden") {
        anchor = el;
        break;
      }
    }
    if (!anchor) return;
    const optsH = Math.max(52, opts.getBoundingClientRect().height);
    const signature = innerWidth + "x" + innerHeight + "|" + panel.id + "|" + anchor.id + "|" +
      choiceCount + "|" + Math.round(optsH);
    if (signature === interactDockSig) return;
    interactDockSig = signature;
    const r = anchor.getBoundingClientRect();
    const top = Math.max(72, Math.min(r.top, innerHeight - optsH - 18));
    // Keep one straight vertical rail clear of the entire FLOW column. Reload
    // supplies the top landmark; FIRE is wider, so its left edge supplies the
    // safe horizontal boundary for lower rows.
    let flowLeft = r.left;
    for (const id of ["treload", "tswap", "tview", "tjump", "tfire"]) {
      const el = document.getElementById(id);
      if (!el || !el.getClientRects().length) continue;
      flowLeft = Math.min(flowLeft, el.getBoundingClientRect().left);
    }
    const right = Math.max(88, innerWidth - flowLeft + 12);
    panel.style.setProperty("--touch-interact-top", Math.round(top) + "px");
    panel.style.setProperty("--touch-interact-right", Math.round(right) + "px");
  }

  // TOUCH_AIM_ASSIST: nearest lock-on candidate to the crosshair (screen centre)
  // in NDC, read from the live lock-on candidate pool (missile / vehicle targets)
  // that lockon.js projects. Returns null when the assist is off, this isn't a
  // touch session, or the pool is empty — a safe no-op. Reuses one holder object.
  function nearestAimCand() {
    if (!enabled || (CBZ.CONFIG && CBZ.CONFIG.TOUCH_AIM_ASSIST === false) || !CBZ.lockonCandidateScreen) return null;
    const c = CBZ.lockonCandidateScreen();
    if (!c || !c.n) return null;
    let best = null, bestR = 1e9;
    for (let i = 0; i < c.n; i++) {
      const e = c.arr[i];
      const r = Math.hypot(e.nx, e.ny);
      if (r < bestR) { bestR = r; best = e; }
    }
    if (!best) return null;
    _ncHolder.e = best; _ncHolder.r = bestR;
    return _ncHolder;
  }

  // TOUCH_LOOK_ACCEL / TOUCH_LOOK_GLIDE state. `glide` carries the release
  // velocity in PIXELS PER SECOND — the same unit applyLookDelta already eats —
  // so the coast runs through the identical clamp/friction/scoped-scaling path
  // a finger does and can never drift out of agreement with it.
  const glide = { vx: 0, vy: 0 };
  let _accT = 0, _flkX = 0, _flkY = 0, _flkT = 0;
  const lookAccelOn = () => TPV2() && (!CBZ.CONFIG || CBZ.CONFIG.TOUCH_LOOK_ACCEL !== false);
  const lookGlideOn = () => TPV2() && (!CBZ.CONFIG || CBZ.CONFIG.TOUCH_LOOK_GLIDE !== false);
  // Pointer acceleration, in px/ms of finger travel. Identity below ACC_LO, and
  // identity outright while ADS/scoped — a magnified reticle is the one place a
  // non-linear ramp would be a bug rather than a feature.
  function accelGain(dx, dy) {
    if (!lookAccelOn()) return 1;
    if (CBZ.isADS && CBZ.isADS()) return 1;
    if (CBZ.fpsScoped && CBZ.fpsScoped()) return 1;
    const now = performance.now();
    const ms = Math.max(4, Math.min(60, now - _accT));   // clamp: a dropped frame is not a flick
    _accT = now;
    const v = Math.hypot(dx, dy) / ms;
    if (v <= ACC_LO) return 1;
    const u = Math.min(1, (v - ACC_LO) / (ACC_HI - ACC_LO));
    return 1 + (ACC_MAX - 1) * u * u * (3 - 2 * u);
  }
  // GLIDE, ticked before the camera agent (onAlways 50) so the coast is
  // consumed the same frame it is produced. It is third-person follow-through:
  // it stands down in first person, while aiming, while the walk-to steer owns
  // the yaw, and the instant any finger touches the glass.
  CBZ.onAlways(49.5, function (dt) {
    if (!glide.vx && !glide.vy) return;
    if (!enabled || !lookGlideOn() || !CBZ.game || CBZ.game.state !== "playing" ||
        CBZ.cityMenuOpen || walk.on || look.id !== null || slideTouches.size ||
        (CBZ.fps && CBZ.fps.active) || (CBZ.isADS && CBZ.isADS())) { glide.vx = glide.vy = 0; return; }
    const d = Math.max(0.001, Math.min(0.05, dt || 0.016));
    applyLookDelta(glide.vx * d, glide.vy * d, false);
    const k = Math.exp(-GLIDE_K * d);
    glide.vx *= k; glide.vy *= k;
    if (Math.hypot(glide.vx, glide.vy) < 40) glide.vx = glide.vy = 0;
  });

  // THE camera-turn math, shared by the look-drag slot and the aim/scope
  // finger's fine-aim drag (TOUCH_AIM_DRAG) so the two can never diverge:
  // same SENS, same fpsLookSensMul scoped/ADS scaling (without it, scoped
  // touch look moved ~4.7x the world angle per pixel vs desktop — the old
  // weapons-agent finding), same camera-agent pitch envelope, same wider
  // first-person aim-pitch ride — and now the same acceleration curve, applied
  // in exactly ONE place so no consumer can grow a second one.
  // accel=false is the FINE-AIM path: the aim/scope finger's drag and the glide
  // coast both pass false, because a curve applied to a curve compounds and
  // fine aim must stay linear by definition.
  function applyLookDelta(dx, dy, accel) {
    if (CBZ.camRecenterCancel) CBZ.camRecenterCancel();   // the hand outranks the ease
    if (accel !== false) { const gAcc = accelGain(dx, dy); dx *= gAcc; dy *= gAcc; }
    const sMul = CBZ.fpsLookSensMul ? CBZ.fpsLookSensMul() : 1;
    // TOUCH_AIM_ASSIST — reticle FRICTION: ease look sensitivity down while the
    // crosshair sits over/near a lock-on candidate so the reticle sticks a touch
    // instead of sliding past. Mild + touch-only; identity (1) with no pool.
    let fMul = 1;
    const nc = nearestAimCand();
    if (nc && nc.r < AIM_FRICTION_NDC) fMul = AIM_FRICTION_MIN + (1 - AIM_FRICTION_MIN) * (nc.r / AIM_FRICTION_NDC);
    CBZ.cam.yaw -= dx * SENS * sMul * fMul;
    CBZ.cam.pitch -= dy * SENS * sMul * fMul;
    // third-person pitch range: the camera agent's hook decides (it knows
    // the collision-safe envelope); fallback still allows a REAL look-up —
    // the old -0.18 floor meant an iPad could barely raise its eyes.
    const pr = (CBZ.camTouchPitchRange && CBZ.camTouchPitchRange()) || [-0.6, 0.60];
    CBZ.cam.pitch = Math.max(pr[0], Math.min(pr[1], CBZ.cam.pitch));
    // in first-person, vertical drag drives the (wider) FPS aim pitch
    if (CBZ.fps && CBZ.fps.active) CBZ.fps.fp = Math.max(-1.3, Math.min(1.3, CBZ.fps.fp - dy * SENS * sMul * fMul));
  }

  // TOUCH_AIM_ASSIST — MAGNETISM: a small, rate-capped pull toward the nearest
  // on-screen lock-on candidate while AIMING on touch, so the reticle settles
  // onto a target you're already close to. Mirrors the shipped soft-lock's sign
  // convention (fpsmode applyAimLock) using the LIVE camera as the aim reference,
  // so the correction moves the candidate's projected centre toward the
  // crosshair. Runs after lockon.js's tick (onAlways 54) so the pool is fresh.
  // Stands down on desktop (enabled=touch only), when not ADS, with an empty
  // pool, or when the actor soft-lock already owns the aim (no double-pull).
  CBZ.onAlways(54.6, function (dt) {
    if (!enabled || (CBZ.CONFIG && CBZ.CONFIG.TOUCH_AIM_ASSIST === false)) return;
    if (!CBZ.camera || !CBZ.cam || !CBZ.game || CBZ.game.state !== "playing") return;
    if (!(CBZ.isADS && CBZ.isADS())) return;
    if (CBZ.aimLockTarget && CBZ.aimLockTarget()) return;   // actor soft-lock owns the aim
    if (!_amEye || !_amDir) return;
    const nc = nearestAimCand();
    if (!nc || nc.r > AIM_MAG_NDC) return;
    const e = nc.e;
    CBZ.camera.getWorldPosition(_amEye);
    CBZ.camera.getWorldDirection(_amDir); _amDir.normalize();
    const dx = e.x - _amEye.x, dy = e.y - _amEye.y, dz = e.z - _amEye.z;
    const dl = Math.hypot(dx, dy, dz) || 1;
    let dHead = Math.atan2(dx / dl, dz / dl) - Math.atan2(_amDir.x, _amDir.z);
    while (dHead > Math.PI) dHead -= 2 * Math.PI;
    while (dHead < -Math.PI) dHead += 2 * Math.PI;
    const dPitch = Math.asin(Math.max(-1, Math.min(1, dy / dl))) - Math.asin(Math.max(-1, Math.min(1, _amDir.y)));
    // proximity fade: strongest when the candidate is already near the crosshair,
    // zero at the engage edge → assist that helps you settle, never a snap-lock.
    const prox = 1 - nc.r / AIM_MAG_NDC;
    const kFrac = 1 - Math.exp(-AIM_MAG_RATE * prox * dt);
    const cap = AIM_MAG_CAP * dt;
    let sh = dHead * kFrac, sp = dPitch * kFrac;
    sh = Math.max(-cap, Math.min(cap, sh));
    sp = Math.max(-cap, Math.min(cap, sp));
    CBZ.cam.yaw += sh;
    if (CBZ.fps && CBZ.fps.active) CBZ.fps.fp = Math.max(-1.3, Math.min(1.3, CBZ.fps.fp + sp));
    else CBZ.cam.pitch = Math.max(-1.0, Math.min(0.9, CBZ.cam.pitch + sp));
  });

  function note(s) { if (CBZ.city && CBZ.city.note) CBZ.city.note(s, 1.5); }
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  function rootFor(object, roots) {
    let o = object;
    while (o) {
      const hit = roots.get(o);
      if (hit) return hit;
      o = o.parent;
    }
    return null;
  }

  // ---- tap-to-interact target model ------------------------------------------
  function reachOf(kind) {
    return kind === "car" ? 5.2 : kind === "machine" ? 6.2 : kind === "animal" ? 4.5 : 3.0;
  }
  // How close the player is to actually USING a target. Vehicles/animals measure
  // to the VISIBLE box (a plane's origin can be dozens of metres from its hull);
  // peds measure centre-to-centre and sit inside interactions.js's own REACH.
  function reachDist(kind, rec) {
    if (kind === "ped") {
      const p = rec.pos || (rec.group && rec.group.position);
      if (!p || !CBZ.player.pos) return Infinity;
      return Math.hypot(p.x - CBZ.player.pos.x, p.z - CBZ.player.pos.z);
    }
    if (!rec.group || !tapBox) return Infinity;
    tapBox.setFromObject(rec.group);
    return tapBox.distanceToPoint(CBZ.player.pos);
  }
  // Where to walk to reach it: the nearest point on a vehicle's footprint (so a
  // big hull is approached at its edge), or a ped's own position.
  function steerPoint(kind, rec) {
    if (kind !== "ped" && rec.group && tapBox) {
      tapBox.setFromObject(rec.group);
      const P = CBZ.player.pos;
      return { x: clamp(P.x, tapBox.min.x, tapBox.max.x), z: clamp(P.z, tapBox.min.z, tapBox.max.z) };
    }
    const p = rec.pos || (rec.group && rec.group.position) || CBZ.player.pos;
    return { x: p.x, z: p.z };
  }
  function faceToward(px, pz) {
    if (!CBZ.cam || !CBZ.player || !CBZ.player.pos) return;
    const dx = px - CBZ.player.pos.x, dz = pz - CBZ.player.pos.z;
    if (Math.abs(dx) + Math.abs(dz) < 1e-3) return;
    CBZ.cam.yaw = Math.atan2(-dx, -dz);   // forward = (-sin yaw, -cos yaw)
  }
  function recAlive(kind, rec) {
    if (!rec) return false;
    if (rec.dead) return false;
    if (kind === "car" && rec.player) return false;
    if (kind === "machine" && rec.taken) return false;
    if (rec.group && rec.group.parent === null) return false;
    return true;
  }
  // Fire the REAL verb. Rides call the exact functions the keyboard router ends
  // in; a ped just aims the camera and lets interactions.js raise its card.
  function triggerTarget(kind, rec) {
    if (!recAlive(kind, rec)) return false;
    if (kind === "car") return !!(CBZ.cityEnterVehicle && CBZ.cityEnterVehicle(rec) !== false);
    if (kind === "machine") return !!(CBZ.cityBoardMilitaryVehicle && CBZ.cityBoardMilitaryVehicle(rec));
    if (kind === "animal") return !!(CBZ.cityMountAnimal && CBZ.cityMountAnimal(rec));
    // a seat reached by walking finishes the same verb the direct tap fires
    if (kind === "seat") return !!(CBZ.propSit && CBZ.propSit(CBZ.player, rec));
    if (kind === "ped") {
      const p = rec.pos || (rec.group && rec.group.position);
      if (p) faceToward(p.x, p.z);
      if (CBZ.interactions && CBZ.interactions.refresh) CBZ.interactions.refresh();
      return true;
    }
    return false;
  }

  // Exact rendered-mesh picking. Proximity is measured to the visible object's
  // Box3, so a plane's door/wing root is usable even when its origin is far away.
  function tapWorld(x, y) {
    if (!tapRay || !CBZ.camera || !CBZ.player || !CBZ.player.pos || CBZ.game.state !== "playing") return false;
    if (CBZ.cityMenuOpen) return false;
    if (CBZ.player.driving || CBZ.player._aircraft || (CBZ.cityArmorActive && CBZ.cityArmorActive())) return false;
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    const rect = canvas ? canvas.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight };
    tapNdc.set(((x - rect.left) / Math.max(1, rect.width)) * 2 - 1, -((y - rect.top) / Math.max(1, rect.height)) * 2 + 1);
    tapRay.setFromCamera(tapNdc, CBZ.camera);

    const roots = new Map(), objects = [];
    function add(group, kind, rec) {
      if (!group || group.visible === false || roots.has(group)) return;
      roots.set(group, { kind: kind, rec: rec, group: group });
      objects.push(group);
    }
    const cars = CBZ.cityCars || [];
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i]; if (c && !c.dead && !c.player) add(c.group, "car", c);
    }
    const machines = CBZ.cityMilitaryVehicles || [];   // tanks, helis, planes, ground rigs
    for (let i = 0; i < machines.length; i++) {
      const m = machines[i]; if (m && !m.taken) add(m.group, "machine", m);
    }
    const wildlife = CBZ.cityWildlife || [];
    for (let i = 0; i < wildlife.length; i++) {
      const a = wildlife[i];
      if (a && CBZ.cityCanRideAnimal && CBZ.cityCanRideAnimal(a)) add(a.group, "animal", a);
    }
    if (V2) {   // tapping a person opens the contextual card
      const peds = CBZ.cityPeds || [];
      for (let i = 0; i < peds.length; i++) {
        const p = peds[i]; if (p && !p.dead && !p.player && p.group) add(p.group, "ped", p);
      }
      const cops = CBZ.cityCops || [];
      for (let i = 0; i < cops.length; i++) {
        const c = cops[i]; if (c && !c.dead && c.group) add(c.group, "ped", c);
      }
    }
    const hits = objects.length ? tapRay.intersectObjects(objects, true) : [];
    const target = hits.length ? rootFor(hits[0].object, roots) : null;

    // ---- TAP THE CHAIR TO SIT ON IT ------------------------------------
    // OWNER: "on iPad it pops up and says sit down / stand up. Good that the
    // capability is there, bad that there's a popup in the middle of the
    // screen. Maybe they should just press the chair to sit down — how does
    // Minecraft do it?"
    //
    // Minecraft's answer, and every good touch game's answer, is that THE
    // WORLD OBJECT IS THE BUTTON. You tap the thing; no prompt narrates the
    // possibility to you first. This codebase already made exactly that call
    // for vehicles — city/interactions.js's SILENT_RIDE ("no card, you just
    // press E / tap to take it. Keeps the HUD from announcing 'you may now
    // board' like a tutorial"). Seats were the one thing excluded, and the
    // comment there says why in as many words: "a seat has no tappable mesh".
    //
    // It does now. Seats are propuse ANCHORS rather than groups, so instead of
    // adding them to the raycast list we intersect the tap ray with the ground
    // plane the seat stands on and ask propNearestSeat what is under the
    // finger. Same result, no per-seat mesh bookkeeping, and it works for every
    // seat in the game — desk chairs, benches, deck chairs, cabin seats —
    // because they all register through the one anchor system.
    if (!target && CBZ.propNearestSeat && !CBZ.player.dead) {
      const P = CBZ.player;
      // where the ray crosses the player's own floor level
      const dirY = tapRay.ray.direction.y;
      if (dirY < -0.001) {
        const t = (P.pos.y - tapRay.ray.origin.y) / dirY;
        if (t > 0 && t < 40) {
          const gx = tapRay.ray.origin.x + tapRay.ray.direction.x * t;
          const gz = tapRay.ray.origin.z + tapRay.ray.direction.z * t;
          const seat = CBZ.propNearestSeat(gx, gz, 1.5, P.pos.y);
          if (seat) {
            const d = Math.hypot(seat.x - P.pos.x, seat.z - P.pos.z);
            if (d <= 3.6) { if (CBZ.propSit) CBZ.propSit(P, seat); return true; }
            if (d <= WALK_MAX) { startWalk("seat", seat); return true; }
            note("Get closer to sit down."); return true;
          }
        }
      }
    }
    // ---- TAP ANYWHERE TO GET UP ----------------------------------------
    // The mirror of the above, and the reason the "stand up" card can go too:
    // once you are seated the only verb you want is OUT, so any tap is it.
    if (!target && CBZ.player._propSeat && CBZ.propStand) { CBZ.propStand(CBZ.player); return true; }

    if (!target) return false;

    // In reach → fire immediately (same path as the keyboard).
    if (reachDist(target.kind, target.rec) <= reachOf(target.kind)) {
      return triggerTarget(target.kind, target.rec);
    }
    // Out of reach: pre-V2 just nudges; V2 walks there and triggers on arrival.
    if (!V2) { note(farNote(target.kind)); return true; }
    const p = target.rec.pos || (target.group && target.group.position);
    const d0 = p ? Math.hypot(p.x - CBZ.player.pos.x, p.z - CBZ.player.pos.z) : Infinity;
    if (d0 > WALK_MAX) { note(farNote(target.kind)); return true; }
    startWalk(target.kind, target.rec);
    return true;
  }
  function farNote(kind) {
    return kind === "machine" ? "Get closer to board it." :
      kind === "animal" ? "Get closer before you try to mount it." :
      kind === "ped" ? "Get closer to talk." : "Get closer to take that vehicle.";
  }
  // Testability hook: fire a world-tap at screen coordinates (x,y) exactly as a
  // real tap would, so the headless CDP probes can exercise the tap-to-interact
  // path directly (a synthesized touchstart/touchend pair is unreliable under
  // SwiftShader's long frames, which trip touch.js's 330 ms tap window).
  CBZ.cityTapWorld = tapWorld;

  // ---- walk-to-then-trigger --------------------------------------------------
  function startWalk(kind, rec) { walk.on = true; walk.kind = kind; walk.rec = rec; walk.t = 0; }
  function cancelWalk() {
    if (!walk.on) return;
    walk.on = false; walk.kind = null; walk.rec = null;
    const k = CBZ.keys; k["w"] = false; k["shift"] = false;   // auto-sprint pump re-owns shift next frame
  }
  // Runs while playing, BEFORE physics (onUpdate 10) so the keys/yaw it writes
  // are consumed the same frame. Steers by pointing the camera at the target and
  // holding W — exactly what a human would do — so the body faces where it goes.
  CBZ.onUpdate(9, function (dt) {
    if (!walk.on) return;
    const P = CBZ.player;
    if (!enabled || CBZ.game.state !== "playing" || CBZ.cityMenuOpen ||
        !P || !P.pos || P.dead || P.driving || P._aircraft ||
        (CBZ.cityArmorActive && CBZ.cityArmorActive())) { cancelWalk(); return; }
    const rec = walk.rec, kind = walk.kind;
    if (!recAlive(kind, rec)) { cancelWalk(); return; }
    walk.t += dt;

    if (reachDist(kind, rec) <= reachOf(kind)) {
      const k = CBZ.keys; k["w"] = false; k["shift"] = false;
      walk.on = false; walk.rec = null; walk.kind = null;
      triggerTarget(kind, rec);
      return;
    }
    if (walk.t > WALK_TIMEOUT) { cancelWalk(); note("Couldn't reach it."); return; }

    const sp = steerPoint(kind, rec);
    const dx = sp.x - P.pos.x, dz = sp.z - P.pos.z;
    const dist = Math.hypot(dx, dz) || 1;
    CBZ.cam.yaw = Math.atan2(-dx, -dz);
    const k = CBZ.keys;
    k["w"] = true; k["a"] = k["s"] = k["d"] = false;
    k["shift"] = dist > 5;    // jog most of the way, ease to a walk for the last few metres
  });

  // Stance routing for the L3 stick-press: in city/survival (with the physics
  // stance machine live) a press is a crouch INPUT EVENT — physics decides
  // crouch / stand / SLIDE (press while sprinting) / PRONE (double press) with
  // full frame context. The machine consumes press EDGES precisely because the
  // touch latch can't express a double-tap as key edges (down,up,down collapses
  // to one). Escape — and flags-off — keep the legacy keys["c"] latch, which
  // feeds jail's hold-to-sneak exactly as before. Never both: when this routes,
  // the latch is never set, so physics can't see a phantom keyboard edge too.
  function stanceRoute() {
    const P = CBZ.player, g = CBZ.game;
    return !!(CBZ.playerCrouchPress && g && g.state === "playing" && g.mode !== "escape" &&
      (!CBZ.CONFIG || CBZ.CONFIG.PLAYER_SLIDE !== false || CBZ.CONFIG.PLAYER_PRONE !== false) &&
      P && P.pos && !P.dead && !P.driving && !P._aircraft);
  }

  // ---- GAIT + STANCE PUMP (the stick IS the sprint button) ------------------
  // Owner: "hold the movement control all the way aggressively → sprint".
  // Deflection magnitude maps to gait: inside the rim nothing, RAMMED to the
  // rim shift goes down — band hysteresis (SPRINT_HI on / SPRINT_LO off) AND
  // the old stamina hysteresis (30/8) so neither boundary ever flaps. Off
  // foot or stick-up shift is RELEASED (a latched shift reads as collective-
  // down in a heli). While walk-to steers, it owns the gait and this pump
  // stands aside. The L3 crouch latch is pumped here too: it holds the REAL
  // sneak key ("c" — physics.js's sneakHeld; "control" would collide with the
  // heli collective) and auto-stands when you leave your feet, so a stale
  // crouch can never follow you into a car. TOUCH_AUTOSPRINT=false → touch
  // never writes shift (crouch latch still honoured).
  CBZ.onUpdate(9, function () {
    if (!enabled || walk.on) return;
    const k = CBZ.keys, P = CBZ.player;
    const auto = !CBZ.CONFIG || CBZ.CONFIG.TOUCH_AUTOSPRINT !== false;
    const onFoot = CBZ.game.state === "playing" && P && P.pos && !P.dead && !P.driving && !P._aircraft;
    if (!onFoot && crouchLatch) crouchLatch = false;
    // a latch left over from jail must not follow into a stance-machine mode:
    // its held "c" would read as a phantom keydown edge to physics' detector.
    if (crouchLatch && stanceRoute()) crouchLatch = false;
    const wantC = onFoot && crouchLatch;
    if (wantC !== crouchOwned) {
      crouchOwned = wantC; k["c"] = wantC;
    }
    // amber knob = low stance. Latch-crouched (jail), or the physics stance
    // machine's crouch/slide/prone (city/survival, where the latch stays off
    // and P.crouch is the machine's own truth).
    if (baseEl) baseEl.classList.toggle("tcrouch", wantC || (onFoot && CBZ.game.mode !== "escape" && !!P.crouch));
    if (!auto || !onFoot) {
      if (shiftOwned) { k["shift"] = false; shiftOwned = false; }
      return;
    }
    const st = P.stamina == null ? 100 : P.stamina;
    stamOk = stamOk ? st > 8 : st > 30;
    sprintBand = stick.id !== null && (sprintBand ? stickMag > SPRINT_LO : stickMag >= SPRINT_HI);
    k["shift"] = shiftOwned = !!(sprintBand && stamOk);
  });

  // ---- touch input -----------------------------------------------------------
  window.addEventListener("touchstart", (e) => {
    enable();
    sweepStale(e);
    glide.vx = glide.vy = 0;   // ANY new finger stops the coast dead (incl. UI taps)
    for (const t of e.changedTouches) {
      if (inUI(t.target)) continue;
      cancelWalk();   // any deliberate touch takes back manual control
      let grab = false;
      if (stick.id === null && !carButtonsActive()) {
        if (FIXED) {
          // FIXED stick: only a touch BORN inside the catch zone (STICK_ZONE ×
          // the visible disc) drives movement; every other left-half touch
          // falls through to look/world-tap exactly like the right half — so
          // a radar / HUD / world tap can never be mistaken for a move.
          const r = baseEl ? baseEl.getBoundingClientRect() : null;
          if (r && r.width > 0) {
            const ax = r.left + r.width / 2, ay = r.top + r.height / 2;
            if (Math.hypot(t.clientX - ax, t.clientY - ay) <= (r.width / 2) * STICK_ZONE) {
              grab = true; stick.cx = ax; stick.cy = ay;
            }
          }
        } else if (t.clientX < innerWidth * 0.5) {
          // dynamic stick (TOUCH_FIXED_STICK=false): recentres to the press
          grab = true; stick.cx = t.clientX; stick.cy = t.clientY;
          baseEl.style.left = t.clientX + "px"; baseEl.style.top = t.clientY + "px";
        }
      }
      if (grab) {
        stick.id = t.identifier;
        stick.sx = t.clientX; stick.sy = t.clientY; stick.t0 = performance.now(); stick.moved = 0;
        baseEl.classList.add("on"); knobEl.style.transform = "";
        if (FIXED) stickDeflect(t.clientX, t.clientY);   // rim-press moves at once
      } else if (look.id === null) {
        look.id = t.identifier; look.lx = t.clientX; look.ly = t.clientY;
        look.sx = t.clientX; look.sy = t.clientY; look.t0 = performance.now(); look.moved = 0;
        look.seen = performance.now();
        // in a vehicle, tell the camera agent to suspend auto-recenter while
        // this finger drags (glancing sideways at speed); feature-detected.
        const P = CBZ.player;
        if (CBZ.camFreeLook && P && (P.driving || P._aircraft)) { look.free = true; CBZ.camFreeLook(true); }
      }
    }
  }, { passive: true });

  let pinchPrev = 0;
  window.addEventListener("touchmove", (e) => {
    sweepStale(e);
    // two FREE fingers = pinch-zoom the third-person camera.
    // TOUCH_LOOK_WHILE_MOVE (default on): the old gate counted EVERY touch on
    // the page, so the basic two-thumb grammar — left thumb on the fixed stick,
    // right thumb dragging to look — was read as a pinch: clearMove() killed
    // the stick's WASD and the early return starved the look slot. You
    // literally had to STOP to look around (the survival play-report; city
    // mostly masked it because first-person skips this branch and vehicles
    // steer via UI buttons, but the bug was mode-agnostic). A finger that owns
    // the stick, an aim/scope slide-hold, or any UI button is CLAIMED — it is
    // never half a pinch. Flag off = the legacy any-two-touches gate, byte-
    // for-byte (pinch clears movement and returns).
    const strict = !CBZ.CONFIG || CBZ.CONFIG.TOUCH_LOOK_WHILE_MOVE !== false;
    let pa = null, pb = null;
    if (e.touches.length >= 2 && !(CBZ.fps && CBZ.fps.active)) {
      if (!strict) { pa = e.touches[0]; pb = e.touches[1]; }
      else {
        for (let i = 0; i < e.touches.length && !pb; i++) {
          const t = e.touches[i];
          if (t.identifier === stick.id || slideTouches.has(t.identifier) || inUI(t.target)) continue;
          if (!pa) pa = t; else pb = t;
        }
        if (!pb) pa = null;
      }
    }
    if (pa && pb) {
      const d = Math.hypot(pa.clientX - pb.clientX, pa.clientY - pb.clientY);
      // ONE call, and it now actually reaches the city boom: camera.js's camZoom
      // routes a touch pinch into the CAM_TP_TOUCH_ZOOM trim as well as the
      // legacy zoomTarget, so this line is unchanged and the gesture stopped
      // being a no-op on foot and in every vehicle. (It was dead the whole time
      // CAM_TP_V2 has shipped — the locked boom never read zoomTarget.)
      if (pinchPrev && CBZ.camZoom) CBZ.camZoom((pinchPrev - d) * 0.03);
      pinchPrev = d;
      // A pinch is a deliberate camera input: keep the vehicle's auto-recenter
      // suspended for it exactly as a look-drag does, or the car whips the yaw
      // back 0.8 s into a two-finger adjustment. camGlance, NOT camFreeLook —
      // this gesture has no release edge to pair with a latching hold.
      const Pp = CBZ.player;
      if (CBZ.camGlance && Pp && (Pp.driving || Pp._aircraft)) CBZ.camGlance();
      if (!strict) { clearMove(); return; }
      // strict pinch: both pinch fingers are free/world fingers, so the stick
      // (if a third finger holds it) KEEPS driving movement. The look slot may
      // be one of the pinching fingers — re-anchor it (and poison its tap
      // window) each move so the view neither swings during the pinch nor
      // jumps the frame after it ends.
      for (const t of e.changedTouches) {
        if (t.identifier === stick.id) {
          stick.moved = Math.max(stick.moved, Math.hypot(t.clientX - stick.sx, t.clientY - stick.sy));
          stickDeflect(t.clientX, t.clientY);
        } else if (t.identifier === look.id) {
          look.lx = t.clientX; look.ly = t.clientY;
          look.seen = performance.now(); look.moved = 999;
        }
      }
      return;
    }
    pinchPrev = 0;
    for (const t of e.changedTouches) {
      if (t.identifier === stick.id) {
        stick.moved = Math.max(stick.moved, Math.hypot(t.clientX - stick.sx, t.clientY - stick.sy));
        stickDeflect(t.clientX, t.clientY);
      } else if (t.identifier === look.id) {
        const nowL = performance.now();
        // FLICK VELOCITY for the release glide: an exponentially-weighted px/s
        // estimate rather than the last raw delta, because the final touchmove
        // before a lift is routinely a near-zero jitter sample and reading THAT
        // as the throw speed is why naive momentum implementations feel dead.
        const dtL = Math.max(1, Math.min(80, nowL - (look.seen || nowL)));
        const wV = Math.min(1, dtL / 45);
        _flkX += ((t.clientX - look.lx) * 1000 / dtL - _flkX) * wV;
        _flkY += ((t.clientY - look.ly) * 1000 / dtL - _flkY) * wV;
        _flkT = nowL;
        look.seen = nowL;
        look.moved = Math.max(look.moved, Math.hypot(t.clientX - look.sx, t.clientY - look.sy));
        applyLookDelta(t.clientX - look.lx, t.clientY - look.ly);   // shared with the aim-drag (one math)
        look.lx = t.clientX; look.ly = t.clientY;
      } else if (look.id === null && !inUI(t.target) && !slideTouches.has(t.identifier)) {
        // ADOPT a mid-flight drag: if the look slot freed while this finger
        // was already down (watchdog/sweep recovery, or the slot was wedged
        // when the finger landed), its next move takes the slot instead of
        // dying — the view can ALWAYS be dragged by something. touchmove's
        // target is the START target, so UI/button touches stay excluded;
        // the stick finger was matched above. Adopted = mid-drag: t0/moved
        // are poisoned so a quick lift can never read as a world-tap.
        look.id = t.identifier; look.lx = t.clientX; look.ly = t.clientY;
        look.sx = t.clientX; look.sy = t.clientY; look.t0 = -1e9; look.moved = 999;
        look.seen = performance.now();
        const P = CBZ.player;
        if (CBZ.camFreeLook && P && (P.driving || P._aircraft)) { look.free = true; CBZ.camFreeLook(true); }
      }
    }
  }, { passive: true });

  function endTouch(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === stick.id) {
        const dtms = performance.now() - stick.t0;
        // L3 grammar on the fixed stick: a quick PRESS (no drag) = crouch
        // toggle, committed only on release so drag-to-move never trips it.
        const press = FIXED && stick.moved < 10 && dtms < 250;
        const wasTap = !FIXED && stick.moved < 12 && dtms < 330;   // dynamic stick keeps the legacy world-tap
        releaseStick();
        if (press) {
          if (stanceRoute()) CBZ.playerCrouchPress();   // physics stance machine: crouch/slide/prone
          else crouchLatch = !crouchLatch;              // legacy latch (jail sneak / flags off)
        } else if (wasTap) { try { tapWorld(t.clientX, t.clientY); } catch (err) {} }
      } else if (t.identifier === look.id) {
        const wasTap = look.moved < 12 && performance.now() - look.t0 < 330;
        // THROW THE VIEW (TOUCH_LOOK_GLIDE). Only a genuine flick qualifies —
        // fast enough (GLIDE_MIN), still moving at the moment of the lift
        // (a sample older than 90 ms means the finger had already stopped and
        // a coast would be a lie), and never out of a tap.
        const gv = Math.hypot(_flkX, _flkY);
        if (!wasTap && lookGlideOn() && gv > GLIDE_MIN && performance.now() - _flkT < 90) {
          const s = Math.min(1, GLIDE_CAP / gv);
          glide.vx = _flkX * s; glide.vy = _flkY * s;
        }
        _flkX = _flkY = 0;
        releaseLook();
        if (wasTap) { try { tapWorld(t.clientX, t.clientY); } catch (err) {} }
      }
    }
  }
  window.addEventListener("touchend", endTouch, { passive: true });
  window.addEventListener("touchcancel", endTouch, { passive: true });

  // ---- stale-touch hygiene (the "can't look around any more" wedge) ---------
  // If a touchend/touchcancel is swallowed (system edge swipe, notification
  // shade, screenshot chord, multi-touch churn) a slot could stay claimed
  // forever and every new finger would bounce off it. Three recovery layers:
  //  (a) every touchstart/touchmove validates the tracked ids against the
  //      LIVE e.touches list and frees any ghost. On touchstart, an id that
  //      matches only a JUST-BORN touch is still a ghost (platforms recycle
  //      identifiers) — newborns are excluded so the slot frees and the new
  //      finger claims it cleanly.
  //  (b) watchdog: a look slot that hasn't produced a touchmove for
  //      LOOK_STALE_MS while OTHER touch traffic arrives is force-released
  //      even if the platform still lists its id. The slot's own events
  //      exempt it, so a parked-but-live finger is never robbed — and if one
  //      ever is, its next move is ADOPTED straight back (see touchmove).
  //      No stick watchdog: holding the stick at full tilt without moving
  //      for many seconds is NORMAL (running in a straight line).
  //  (c) blur / hidden tab / pagehide drops every claim, latch and held key.
  function sweepStale(e) {
    sweepHoldBtns(e);
    if (stick.id === null && look.id === null && slideTouches.size === 0) return;
    const born = e.type === "touchstart" ? e.changedTouches : null;
    const alive = (id) => {
      if (born) for (let i = 0; i < born.length; i++) if (born[i].identifier === id) return false;
      const L = e.touches;
      for (let i = 0; i < L.length; i++) if (L[i].identifier === id) return true;
      return false;
    };
    if (stick.id !== null && !alive(stick.id)) releaseStick();
    if (look.id !== null && !alive(look.id)) releaseLook();
    if (slideTouches.size) {
      // Slide claims are made by the BUTTON's own touchstart, which runs
      // BEFORE this window-level sweep sees the very same event — so to the
      // newborn-exclusion rule a fresh aim/scope finger looks like a recycled
      // ghost id and would be released the instant it was claimed. A rec that
      // was born within this event turn is real: spare it. Anything older
      // that fails the live-list check is a true ghost and still dies.
      const now = performance.now();
      for (const [id, rec] of slideTouches) if (!alive(id) && now - (rec.born || 0) > 60) rec.release();
    }
    if (look.id !== null && performance.now() - look.seen > LOOK_STALE_MS) {
      // (see sweepHoldBtns below for the hold-button half of this sweep)
      let own = false;
      const C = e.changedTouches;
      for (let i = 0; i < C.length; i++) if (C[i].identifier === look.id) { own = true; break; }
      if (!own) releaseLook();
    }
  }
  // The hold-button half of the sweep. A rec whose fingers are ALL gone from
  // the live e.touches list is a ghost and is released. Same 60 ms newborn
  // grace the slide claims need and for the identical reason: the button's own
  // touchstart runs at the target phase, BEFORE this window-level listener sees
  // the very same event, so a freshly-pressed finger would otherwise look like
  // a recycled ghost id and be released the instant it was claimed. Mouse
  // holds ("m") are never swept — a mouse has no lost-touchend failure mode.
  function sweepHoldBtns(e) {
    if (!holdBtns.length) return;
    const now = performance.now();
    for (let i = 0; i < holdBtns.length; i++) {
      const r = holdBtns[i];
      if (!r.ids.size || now - r.born < 60) continue;
      let live = false;
      r.ids.forEach(function (id) {
        if (id === "m") { live = true; return; }
        const L = e.touches;
        for (let j = 0; j < L.length; j++) if (L[j].identifier === id) { live = true; return; }
      });
      if (!live) r.release();
    }
  }
  // Losing the page mid-touch (app switch, tab change, phone lock) drops
  // every claim and held control — nothing may survive a refocus.
  function clearAllTouchState() {
    if (!enabled) return;   // layer never armed → desktop stays byte-identical
    for (let i = 0; i < holdBtns.length; i++) { try { holdBtns[i].release(); } catch (e) {} }
    releaseStick(); releaseLook(); pinchPrev = 0;
    glide.vx = glide.vy = 0; _flkX = _flkY = 0;   // no coast survives a refocus
    for (const rec of Array.from(slideTouches.values())) rec.release();
    fireHolds = 0;
    if (fireOn) {
      fireOn = false;
      const fb = document.getElementById("tfire");
      if (fb) fb.classList.remove("on");
      try { fireAction(false); } catch (err) {}
    }
    // Backstop: the holdBtns release loop above already covers JUMP, but these
    // two lines predate it and cost nothing, so they stay as the belt to its
    // braces — a stuck Space is the single worst thing to leave behind.
    if (CBZ.keys) CBZ.keys[" "] = false;
    const jb = document.getElementById("tjump");
    if (jb) jb.classList.remove("on");
  }
  window.addEventListener("blur", clearAllTouchState);
  window.addEventListener("pagehide", clearAllTouchState);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible") clearAllTouchState();
  });

  // coarse-pointer device (phone/tablet): turn it on right away
  if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) enable();

  // controls only show while actually playing; weapon buttons only while armed
  CBZ.onAlways(98, function () {
    if (!built) return;
    const root = document.getElementById("touch");
    const show = enabled && CBZ.game.state === "playing";
    root.style.display = show ? "block" : "none";
    if (!show) {
      if (stick.id !== null) releaseStick();
      if (walk.on) cancelWalk();
      return;
    }
    // touch_vehicle's context watcher runs at 97, immediately before this one.
    // If the player entered a road car while still holding the on-foot stick,
    // release it before another frame can leak its WASD into the car.
    if (carButtonsActive() && stick.id !== null) releaseStick();
    const armed = !!((CBZ.cityHasGun && CBZ.cityHasGun()) || (CBZ.fps && CBZ.fps.active));
    const sw = document.getElementById("tswap"), rl = document.getElementById("treload");
    if (sw) sw.style.display = armed ? "" : "none";
    if (rl) rl.style.display = armed ? "" : "none";
    // AIM whenever armed (fpsSetAim ships today); SCOPE only when the sibling
    // scope system says the held weapon can true-zoom. Both may show at once.
    const am = document.getElementById("taim");
    if (am) am.style.display = (armed && CBZ.fpsSetAim) ? "" : "none";
    const sc = document.getElementById("tscope");
    if (sc) sc.style.display = (armed && CBZ.fpsCanScope && CBZ.fpsCanScope()) ? "" : "none";
    // HOMING pill: only while the lock-on system has a live missile platform
    // (RPG in hand, armed aircraft, tank...). Lit = homing on, dim = dumb-fire.
    const hm = document.getElementById("thoming");
    if (hm) {
      // active reads the live platform (platKey), which lockTick still sets
      // in dumb-fire mode — so the pill stays visible to toggle back ON.
      hm.style.display = (CBZ.lockonState && CBZ.lockonState().active) ? "" : "none";
      hm.style.opacity = (CBZ.lockonHomingOn && CBZ.lockonHomingOn()) ? "" : "0.38";
    }
    syncInteractionDock();
    // RECENTER: THIRD PERSON ONLY, and only while it would actually do
    // something. In first person cam.pitch IS your aim, so levelling it is a
    // hostile act, not a convenience; and a button that is always lit but
    // usually a no-op is exactly the HUD clutter this file exists to avoid.
    // Hysteresis (SHOW 0.20 rad ≈ 11.5°, HIDE 0.075) so a thumb parked near the
    // boundary can never make it blink.
    const rc = document.getElementById("trecen");
    if (rc) {
      const tpNow = !(CBZ.fps && CBZ.fps.active) && !(CBZ.cityArmorActive && CBZ.cityArmorActive());
      const off = (TPV2() && (!CBZ.CONFIG || CBZ.CONFIG.TOUCH_RECENTER !== false) &&
        tpNow && CBZ.camRecenter && CBZ.camRecenterOff) ? CBZ.camRecenterOff() : 0;
      recenShown = recenShown ? off > REC_OFF_HIDE : off > REC_OFF_SHOW;
      const want = recenShown ? "" : "none";
      if (rc.style.display !== want) rc.style.display = want;
    }
  });

  /* ==========================================================================
     THE VERB LEDGER — CBZ.touchAudit()

     WHY this exists at all, in one sentence: city/strategic.js shipped
     CBZ.strategicBombDrop / strategicPayloadCycle / strategicBombHold /
     strategicBombCameraHold with the comment "the touch layer wires these to
     pills", and for the B-2's whole life NOTHING CALLED ANY OF THEM — the
     seams were built, published, documented and never consumed, and no counter
     anywhere could say so. A keyboard verb with no thumb is invisible until
     somebody plays on an iPad and finds a control that does not exist.

     So the sweep IS the ledger. Every row below is a keyboard/mouse verb this
     wave audited; `wired` is stamped by whichever touch file actually draws a
     control for it (never by declaring the row), and `hook` is the game-side
     function the control calls — a row whose hook is missing reports as
     `noHook` rather than covered, which is what keeps a degrade-safe
     feature-detect from reading as a lie.

     `uncovered` is the number that matters and it may only ever go DOWN.
     `skipped` is separate ON PURPOSE: a verb deliberately left off the glass
     (with its reason) must not be able to hide inside the covered count.
  ========================================================================== */
  const _verbs = new Map();
  // Declare an audited keyboard verb. ctx = where it lives, key = the desktop
  // input it mirrors, hook = the CBZ seam a touch control must call (null when
  // the control writes CBZ.keys directly, which needs no seam).
  CBZ.touchVerb = function (id, spec) {
    spec = spec || {};
    const row = _verbs.get(id) || { id: id, wired: null };
    row.ctx = spec.ctx || row.ctx || "";
    row.key = spec.key || row.key || "";
    row.hook = spec.hook !== undefined ? spec.hook : row.hook;
    if (spec.skip) row.skip = spec.skip;
    _verbs.set(id, row);
    return row;
  };
  // Stamped by the file that draws the control, at LOAD — so the audit reports
  // what the layer is WIRED with, not what a session happened to render.
  CBZ.touchVerbWired = function (id, control) {
    const row = _verbs.get(id) || CBZ.touchVerb(id, {});
    row.wired = control || true;
    return row;
  };
  CBZ.touchAudit = function () {
    const out = { verbs: 0, covered: 0, uncovered: [], skipped: [], noHook: [], controls: 0 };
    _verbs.forEach(function (r) {
      if (r.skip) { out.skipped.push(r.id + " (" + r.skip + ")"); return; }
      out.verbs++;
      if (r.wired) out.controls++;
      const hookOk = !r.hook || typeof CBZ[r.hook] === "function";
      if (r.wired && hookOk) out.covered++;
      else if (r.wired) out.noHook.push(r.id + " → CBZ." + r.hook);
      else out.uncovered.push(r.id);
    });
    out.touch = !!enabled;
    return out;
  };

  // ---- the sweep (on-foot cluster + look layer; the vehicle/aircraft rows are
  // declared and stamped by systems/touch_vehicle.js, which owns those controls)
  CBZ.touchVerb("move", { ctx: "foot", key: "WASD", hook: null });
  CBZ.touchVerb("sprint", { ctx: "foot", key: "Shift", hook: null });
  CBZ.touchVerb("crouch", { ctx: "foot", key: "C", hook: null });
  CBZ.touchVerb("jump", { ctx: "foot", key: "Space", hook: null });
  CBZ.touchVerb("look", { ctx: "any", key: "mouse", hook: null });
  CBZ.touchVerb("fire", { ctx: "foot", key: "LMB", hook: null });
  CBZ.touchVerb("aim", { ctx: "foot", key: "RMB", hook: "fpsSetAim" });
  CBZ.touchVerb("scope", { ctx: "foot", key: "RMB/scope", hook: "fpsCanScope" });
  CBZ.touchVerb("reload", { ctx: "foot", key: "R", hook: "fpsReload" });
  CBZ.touchVerb("weapon-next", { ctx: "foot", key: "Q/wheel", hook: "fpsNextWeapon" });
  CBZ.touchVerb("view-toggle", { ctx: "foot", key: "V", hook: "toggleFPS" });
  CBZ.touchVerb("homing", { ctx: "foot", key: "H", hook: "lockonHomingSet" });
  CBZ.touchVerb("interact", { ctx: "foot", key: "E", hook: null });
  CBZ.touchVerb("cam-recenter", { ctx: "foot", key: "—", hook: "camRecenter" });
  CBZ.touchVerb("cam-zoom", { ctx: "any", key: "wheel", hook: "camZoom" });
  // Declared and NOT drawn, each with the reason, so the count cannot launder them:
  CBZ.touchVerb("front-view", { ctx: "foot", key: "B", skip: "outfit check — the FRONT VIEW hold is a look-at-yourself pose, and CAM_TP_V2 gates it on pointer lock; a thumb has the phone's wardrobe for this" });
  CBZ.touchVerb("shoulder-swap", { ctx: "foot", key: "MMB", skip: "CBZ.camSetShoulder is one call away, but a 6th icon for a mirrored 0.68 m offset is not worth the corner" });

  CBZ.touchVerbWired("move", "#tstick");
  CBZ.touchVerbWired("sprint", "#tstick rim");
  CBZ.touchVerbWired("crouch", "#tstick press");
  CBZ.touchVerbWired("jump", "#tjump");
  CBZ.touchVerbWired("look", "look drag");
  CBZ.touchVerbWired("fire", "#tfire");
  CBZ.touchVerbWired("aim", "#taim");
  CBZ.touchVerbWired("scope", "#tscope");
  CBZ.touchVerbWired("reload", "#treload");
  CBZ.touchVerbWired("weapon-next", "#tswap");
  CBZ.touchVerbWired("view-toggle", "#tview");
  CBZ.touchVerbWired("homing", "#thoming");
  CBZ.touchVerbWired("interact", "world tap / .tpill");
  CBZ.touchVerbWired("cam-recenter", "#trecen");
  CBZ.touchVerbWired("cam-zoom", "pinch");
})();
