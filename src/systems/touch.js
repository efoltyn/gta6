/* ============================================================
   systems/touch.js — iPad / phone controls (TOUCH_V2).

   The whole touch layer in one thumb-vocabulary:
     • LEFT-thumb dynamic joystick (recenters to where you press) = move.
     • RIGHT-half drag = look. Two fingers = pinch the chase cam.
     • TAP THE WORLD = THE VERB. A quick tap raycasts the real rendered
       meshes; if it hits a car / plane / rideable animal / ped it either
       triggers the SAME code path the keyboard uses (when in reach) or
       WALKS the player there and triggers on arrival. Tapping a car gets
       you in / steals it, a plane boards it, a ped opens the contextual
       #interact card (whose YES/NO rows are already click-driven).
     • MOVEMENT/COMBAT buttons are ICONS (fire reticle, jump arc, walk
       chevrons, first-person eye, weapon swap, reload, scope). But
       INTERACTION prompts carry WORDS: the owner wants a button that
       SAYS "HIJACK", so contextual verb pills (the #interact card, the
       walk-up shop/property prompts) spell out the action itself —
       never a keyboard letter. That supersedes the old "no words ever"
       rule, which now applies only to the movement cluster.
     • AUTO-SPRINT: on touch, moving defaults to a sprint whenever
       stamina allows (the desktop shift-to-run doctrine assumes a key a
       tablet doesn't have). The chevron button becomes a WALK toggle.

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
     TOUCH_AUTOSPRINT   — stamina-gated default sprint
     TOUCH_HUD_TIDY     — body.touch-tidy declutter CSS (mobile.css)
     TOUCH_VEHICLE      — drive/heli/wing button layer (touch_vehicle.js)
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
  const V2 = !CBZ.CONFIG || CBZ.CONFIG.TOUCH_V2 !== false;

  const SENS = 0.006, MAXR = 55, DEAD = 0.28;
  const WALK_MAX = 46;        // don't set off on a cross-map trek from one tap
  const WALK_TIMEOUT = 14;    // give up (moving target / stuck) after this many s

  let built = false, enabled = false;
  // AUTO-SPRINT state: on touch the default gait while the stick is deflected
  // is a sprint, easing off when stamina runs dry (hysteresis so it never
  // flaps at a threshold). walkMode is the chevron button's toggle — ON means
  // the player asked to stay slow. Desktop never runs any of this.
  let walkMode = false, stamOk = true, shiftOwned = false;
  const stick = { id: null, cx: 0, cy: 0, sx: 0, sy: 0, t0: 0, moved: 0 };
  const look = { id: null, lx: 0, ly: 0, sx: 0, sy: 0, t0: 0, moved: 0, free: false };
  const walk = { on: false, kind: null, rec: null, t: 0 };
  let baseEl, knobEl;
  const tapRay = window.THREE ? new THREE.Raycaster() : null;
  const tapNdc = window.THREE ? new THREE.Vector2() : null;
  const tapBox = window.THREE ? new THREE.Box3() : null;

  // ---- wordless glyphs (inline SVG so they render identically on iPad) -------
  const SVG = {
    fire: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2.3" fill="currentColor" stroke="none"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/></svg>',
    jump: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"/><path d="M6.5 8.5 12 3l5.5 5.5"/><path d="M4 21h16"/></svg>',
    sprint: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l7 7-7 7"/><path d="M12 5l7 7-7 7"/></svg>',
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
      btn("tsprint", "tbtn tsprint", SVG.sprint, "Walk / auto-sprint toggle") +
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
    // FIRE: in first-person it shoots/punches via the FPS module; otherwise
    // it's the third-person panic-fire / unarmed melee (matches desktop L-click).
    holdBtn("tfire", (down) => {
      if (((CBZ.fps && CBZ.fps.active) || (CBZ.weaponThirdPersonActive && CBZ.weaponThirdPersonActive())) && CBZ.fpsFire) CBZ.fpsFire(down);
      else if (down) {
        if (CBZ.game.mode === "survival") { if (CBZ.grapple) CBZ.grapple.punch(); }
        else if (CBZ.punch) CBZ.punch();
      }
    });
    tapBtn(document.getElementById("tview"), () => { if (CBZ.toggleFPS) CBZ.toggleFPS(); });
    tapBtn(document.getElementById("tswap"), () => { if (CBZ.fpsNextWeapon) CBZ.fpsNextWeapon(); });
    tapBtn(document.getElementById("treload"), () => { if (CBZ.fpsReload) CBZ.fpsReload(); });
    // WALK toggle. Auto-sprint (below) makes sprint the DEFAULT gait, so the
    // chevron button flipped meaning: lit = "stay at a walk" (stealth, aiming,
    // squeezing through a crowd). With TOUCH_AUTOSPRINT off it degrades to the
    // old manual sprint-hold semantics.
    const sb = document.getElementById("tsprint");
    tapBtn(sb, () => { walkMode = !walkMode; sb.classList.toggle("on", walkMode); });
    // AIM (ADS) — the missing iPad right-mouse: hold pulls the camera in /
    // tightens FOV / steadies recoil via the EXISTING CBZ.fpsSetAim hook the
    // gamepad triggers use. Hold = aim, release = unaim.
    holdBtn("taim", (down) => { if (CBZ.fpsSetAim) CBZ.fpsSetAim(down); });
    // SCOPE — sibling system (sniper scope + lock-on) exposes feature-detected
    // hooks; every call is guarded so this button is correct whether that API
    // is present, absent, or lands under a slightly different shape. Hold =
    // scope while pressed (CBZ.fpsScope(down)); tap with only a toggle API =
    // CBZ.fpsScopeToggle(). Distinct from AIM: scope = true sniper zoom.
    // Visibility for both is driven from the armed check below.
    holdBtn("tscope", (down) => {
      if (CBZ.fpsScope) CBZ.fpsScope(down);
      else if (down && CBZ.fpsScopeToggle) CBZ.fpsScopeToggle();
    });
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
  }
  function clearMove() { const k = CBZ.keys; k["w"] = k["a"] = k["s"] = k["d"] = false; }

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

  // ---- AUTO-SPRINT (the touch default gait) ---------------------------------
  // Owns CBZ.keys["shift"] ON FOOT while the touch layer is live: deflecting
  // the stick sprints whenever stamina is healthy (30/8 hysteresis so the gait
  // never flaps at a threshold), the chevron button holds you to a walk, and
  // away from foot travel shift is RELEASED — the old sprint TOGGLE left shift
  // latched, which a heli reads as collective-down the moment you lift off.
  // Registered after the walk-to updater (same order 9): while walk.on the
  // walk-to steering owns the gait and this pump stands aside.
  CBZ.onUpdate(9, function () {
    if (!enabled || walk.on) return;
    const k = CBZ.keys, P = CBZ.player;
    const auto = !CBZ.CONFIG || CBZ.CONFIG.TOUCH_AUTOSPRINT !== false;
    const onFoot = CBZ.game.state === "playing" && P && P.pos && !P.dead && !P.driving && !P._aircraft;
    if (!auto) {
      // flag off → the chevron degrades to the OLD manual sprint toggle (lit =
      // hold shift), still released the moment you leave your feet.
      const manual = onFoot && walkMode;
      if (manual !== shiftOwned) { k["shift"] = manual; shiftOwned = manual; }
      return;
    }
    if (!onFoot) {
      if (shiftOwned) { k["shift"] = false; shiftOwned = false; }
      return;
    }
    const st = P.stamina == null ? 100 : P.stamina;
    stamOk = stamOk ? st > 8 : st > 30;
    const moving = !!(k["w"] || k["a"] || k["s"] || k["d"]);
    k["shift"] = shiftOwned = !!(moving && !walkMode && stamOk);
  });

  // ---- touch input -----------------------------------------------------------
  window.addEventListener("touchstart", (e) => {
    enable();
    for (const t of e.changedTouches) {
      if (inUI(t.target)) continue;
      cancelWalk();   // any deliberate touch takes back manual control
      if (t.clientX < innerWidth * 0.5 && stick.id === null) {
        stick.id = t.identifier; stick.cx = t.clientX; stick.cy = t.clientY;
        stick.sx = t.clientX; stick.sy = t.clientY; stick.t0 = performance.now(); stick.moved = 0;
        baseEl.style.left = t.clientX + "px"; baseEl.style.top = t.clientY + "px";
        baseEl.classList.add("on"); knobEl.style.transform = "";
      } else if (look.id === null) {
        look.id = t.identifier; look.lx = t.clientX; look.ly = t.clientY;
        look.sx = t.clientX; look.sy = t.clientY; look.t0 = performance.now(); look.moved = 0;
        // in a vehicle, tell the camera agent to suspend auto-recenter while
        // this finger drags (glancing sideways at speed); feature-detected.
        const P = CBZ.player;
        if (CBZ.camFreeLook && P && (P.driving || P._aircraft)) { look.free = true; CBZ.camFreeLook(true); }
      }
    }
  }, { passive: true });

  let pinchPrev = 0;
  window.addEventListener("touchmove", (e) => {
    // two fingers = pinch-zoom the third-person camera
    if (e.touches.length >= 2 && !(CBZ.fps && CBZ.fps.active)) {
      const a = e.touches[0], b = e.touches[1];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (pinchPrev && CBZ.camZoom) CBZ.camZoom((pinchPrev - d) * 0.03);
      pinchPrev = d; clearMove();
      return;
    }
    pinchPrev = 0;
    for (const t of e.changedTouches) {
      if (t.identifier === stick.id) {
        const dx = t.clientX - stick.cx, dy = t.clientY - stick.cy;
        stick.moved = Math.max(stick.moved, Math.hypot(t.clientX - stick.sx, t.clientY - stick.sy));
        const len = Math.hypot(dx, dy) || 1, cl = Math.min(len, MAXR);
        knobEl.style.transform = "translate(" + (dx / len * cl) + "px," + (dy / len * cl) + "px)";
        setMove(dx / MAXR, dy / MAXR);
      } else if (t.identifier === look.id) {
        look.moved = Math.max(look.moved, Math.hypot(t.clientX - look.sx, t.clientY - look.sy));
        CBZ.cam.yaw -= (t.clientX - look.lx) * SENS;
        CBZ.cam.pitch -= (t.clientY - look.ly) * SENS;
        // third-person pitch range: the camera agent's hook decides (it knows
        // the collision-safe envelope); fallback still allows a REAL look-up —
        // the old -0.18 floor meant an iPad could barely raise its eyes.
        const pr = (CBZ.camTouchPitchRange && CBZ.camTouchPitchRange()) || [-0.6, 0.60];
        CBZ.cam.pitch = Math.max(pr[0], Math.min(pr[1], CBZ.cam.pitch));
        // in first-person, vertical drag drives the (wider) FPS aim pitch
        if (CBZ.fps && CBZ.fps.active) CBZ.fps.fp = Math.max(-1.3, Math.min(1.3, CBZ.fps.fp - (t.clientY - look.ly) * SENS));
        look.lx = t.clientX; look.ly = t.clientY;
      }
    }
  }, { passive: true });

  function endTouch(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === stick.id) {
        const wasTap = stick.moved < 12 && performance.now() - stick.t0 < 330;
        stick.id = null; clearMove();
        knobEl.style.transform = ""; baseEl.classList.remove("on");
        if (wasTap) tapWorld(t.clientX, t.clientY);
      } else if (t.identifier === look.id) {
        const wasTap = look.moved < 12 && performance.now() - look.t0 < 330;
        look.id = null;
        if (look.free) { look.free = false; if (CBZ.camFreeLook) CBZ.camFreeLook(false); }
        if (wasTap) tapWorld(t.clientX, t.clientY);
      }
    }
  }
  window.addEventListener("touchend", endTouch, { passive: true });
  window.addEventListener("touchcancel", endTouch, { passive: true });

  // coarse-pointer device (phone/tablet): turn it on right away
  if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) enable();

  // controls only show while actually playing; weapon buttons only while armed
  CBZ.onAlways(98, function () {
    if (!built) return;
    const root = document.getElementById("touch");
    const show = enabled && CBZ.game.state === "playing";
    root.style.display = show ? "block" : "none";
    if (!show) {
      if (stick.id !== null) { stick.id = null; clearMove(); }
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
