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
     TOUCH_LOOK_WHILE_MOVE — two-thumb grammar: stick + look-drag work
                          TOGETHER. Pinch-zoom needs two FREE fingers;
                          a claimed finger (stick / slide-hold / UI) is
                          never half a pinch. false = legacy gate (any
                          two touches pinched, killing move+look).
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
  if (CBZ.CONFIG && CBZ.CONFIG.TOUCH_LOOK_WHILE_MOVE == null) CBZ.CONFIG.TOUCH_LOOK_WHILE_MOVE = true;
  const V2 = !CBZ.CONFIG || CBZ.CONFIG.TOUCH_V2 !== false;
  const FIXED = !CBZ.CONFIG || CBZ.CONFIG.TOUCH_FIXED_STICK !== false;
  const SLIDE = !CBZ.CONFIG || CBZ.CONFIG.TOUCH_AIM_SLIDE !== false;

  const SENS = 0.006, MAXR = 74, DEAD = 0.28;   // MAXR matches the enlarged 168px disc (owner: bigger pad, less corner)
  const STICK_ZONE = 1.6;      // catch zone = this × the visible disc radius
  const SPRINT_HI = 0.85, SPRINT_LO = 0.70;   // stick-rim sprint band (on/off)
  const SLIDE_PAD_IN = 12;     // fire's hit-rect grows this much for ENTRY —
                               // exactly bridges the 12px gap to AIM/SCOPE so
                               // there is NO dead zone between the buttons
  const SLIDE_PAD_OUT = 26;    // …and this much before a slide LEAVES fire
  const LOOK_STALE_MS = 3000;  // look watchdog: no move this long = ghost
  const WALK_MAX = 46;        // don't set off on a cross-map trek from one tap
  const WALK_TIMEOUT = 14;    // give up (moving target / stuck) after this many s

  let built = false, enabled = false;
  // GAIT/STANCE state: sprint lives in the stick (rim deflection = shift) and
  // crouch is the L3 stick-press latch; both are pumped per frame below with
  // hysteresis so nothing flaps at a boundary. Desktop never runs any of this.
  let stamOk = true, shiftOwned = false, sprintBand = false, stickMag = 0;
  let crouchLatch = false, crouchOwned = false;
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

  // ---- wordless glyphs (inline SVG so they render identically on iPad) -------
  const SVG = {
    fire: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2.3" fill="currentColor" stroke="none"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/></svg>',
    jump: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"/><path d="M6.5 8.5 12 3l5.5 5.5"/><path d="M4 21h16"/></svg>',
    eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    swap: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h13"/><path d="M14 6l3 3-3 3"/><path d="M20 15H7"/><path d="M10 12l-3 3 3 3"/></svg>',
    reload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4.5V9h-4.5"/></svg>',
    scope: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7.5"/><path d="M12 1.5v6M12 16.5v6M1.5 12h6M16.5 12h6"/></svg>',
    aim: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8V4.5A1.5 1.5 0 0 1 4.5 3H8"/><path d="M16 3h3.5A1.5 1.5 0 0 1 21 4.5V8"/><path d="M21 16v3.5a1.5 1.5 0 0 1-1.5 1.5H16"/><path d="M8 21H4.5A1.5 1.5 0 0 1 3 19.5V16"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/></svg>',
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
    tapBtn(document.getElementById("treload"), () => { if (CBZ.fpsReload) CBZ.fpsReload(); });
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
  }

  // press-and-hold button (jump/fire)
  function holdBtn(id, fn) {
    const b = document.getElementById(id);
    const on = (e) => { e.preventDefault(); b.classList.add("on"); fn(true); };
    const off = (e) => { e.preventDefault(); b.classList.remove("on"); fn(false); };
    b.addEventListener("touchstart", on, { passive: false });
    b.addEventListener("touchend", off, { passive: false });
    b.addEventListener("touchcancel", off, { passive: false });
    b.addEventListener("mousedown", on); b.addEventListener("mouseup", off);
  }
  // tap button (toggle/one-shot)
  function tapBtn(b, fn) {
    b.addEventListener("touchstart", (e) => { e.preventDefault(); fn(); }, { passive: false });
    b.addEventListener("mousedown", (e) => { e.preventDefault(); fn(); });
  }

  // The trigger itself: in first-person it shoots/punches via the FPS module;
  // otherwise it's the third-person panic-fire / unarmed melee (desktop L-click).
  function fireAction(down) {
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
    const down = () => { if (++holds === 1) { b.classList.add("on"); fn(true); } };
    const up = () => { if (holds > 0 && --holds === 0) { b.classList.remove("on"); fn(false); } };
    b.addEventListener("touchstart", (e) => {
      e.preventDefault();
      const fb = document.getElementById("tfire");
      const fr = fb && fb.style.display !== "none" ? fb.getBoundingClientRect() : null;
      for (const t of e.changedTouches) {
        if (slideTouches.has(t.identifier)) continue;
        const tid = t.identifier;
        const rec = { fireIn: false, rect: fr, release: null };
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
        if (!rec || !rec.rect) continue;
        const r = rec.rect, p = rec.fireIn ? SLIDE_PAD_OUT : SLIDE_PAD_IN;
        const inFire = t.clientX >= r.left - p && t.clientX <= r.right + p &&
                       t.clientY >= r.top - p && t.clientY <= r.bottom + p;
        if (inFire !== rec.fireIn) { rec.fireIn = inFire; fireHold(inFire); }
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
    if (!objects.length) return false;
    const hits = tapRay.intersectObjects(objects, true);
    if (!hits.length) return false;
    const target = rootFor(hits[0].object, roots);
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
    const wantC = onFoot && crouchLatch;
    if (wantC !== crouchOwned) {
      crouchOwned = wantC; k["c"] = wantC;
      if (baseEl) baseEl.classList.toggle("tcrouch", wantC);   // amber knob = crouched
    }
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
    for (const t of e.changedTouches) {
      if (inUI(t.target)) continue;
      cancelWalk();   // any deliberate touch takes back manual control
      let grab = false;
      if (stick.id === null) {
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
      if (pinchPrev && CBZ.camZoom) CBZ.camZoom((pinchPrev - d) * 0.03);
      pinchPrev = d;
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
        look.seen = performance.now();
        look.moved = Math.max(look.moved, Math.hypot(t.clientX - look.sx, t.clientY - look.sy));
        // scoped/ADS look is proportionally finer — the same fpsLookSensMul the
        // desktop mousemove applies. Without it, scoped touch look moved ~4.7x
        // the world angle per pixel vs desktop (weapons-agent finding).
        const sMul = CBZ.fpsLookSensMul ? CBZ.fpsLookSensMul() : 1;
        CBZ.cam.yaw -= (t.clientX - look.lx) * SENS * sMul;
        CBZ.cam.pitch -= (t.clientY - look.ly) * SENS * sMul;
        // third-person pitch range: the camera agent's hook decides (it knows
        // the collision-safe envelope); fallback still allows a REAL look-up —
        // the old -0.18 floor meant an iPad could barely raise its eyes.
        const pr = (CBZ.camTouchPitchRange && CBZ.camTouchPitchRange()) || [-0.6, 0.60];
        CBZ.cam.pitch = Math.max(pr[0], Math.min(pr[1], CBZ.cam.pitch));
        // in first-person, vertical drag drives the (wider) FPS aim pitch
        if (CBZ.fps && CBZ.fps.active) CBZ.fps.fp = Math.max(-1.3, Math.min(1.3, CBZ.fps.fp - (t.clientY - look.ly) * SENS * sMul));
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
        if (press) crouchLatch = !crouchLatch;   // the gait/stance pump applies it
        else if (wasTap) { try { tapWorld(t.clientX, t.clientY); } catch (err) {} }
      } else if (t.identifier === look.id) {
        const wasTap = look.moved < 12 && performance.now() - look.t0 < 330;
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
    if (slideTouches.size) { for (const [id, rec] of slideTouches) if (!alive(id)) rec.release(); }
    if (look.id !== null && performance.now() - look.seen > LOOK_STALE_MS) {
      let own = false;
      const C = e.changedTouches;
      for (let i = 0; i < C.length; i++) if (C[i].identifier === look.id) { own = true; break; }
      if (!own) releaseLook();
    }
  }
  // Losing the page mid-touch (app switch, tab change, phone lock) drops
  // every claim and held control — nothing may survive a refocus.
  function clearAllTouchState() {
    if (!enabled) return;   // layer never armed → desktop stays byte-identical
    releaseStick(); releaseLook(); pinchPrev = 0;
    for (const rec of Array.from(slideTouches.values())) rec.release();
    fireHolds = 0;
    if (fireOn) {
      fireOn = false;
      const fb = document.getElementById("tfire");
      if (fb) fb.classList.remove("on");
      try { fireAction(false); } catch (err) {}
    }
    if (CBZ.keys) CBZ.keys[" "] = false;   // tjump's element-level hold too
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
  });
})();
