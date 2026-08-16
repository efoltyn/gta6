/* ============================================================
   systems/interactions.js — keycard pickup, the door, breaker box,
   security cameras, ventilation, and win check. (Cigarette-pack
   pickups used to live here too — that block is now the "coin"
   prop type in systems/proptypes.js / entities/coins.js, the F3
   proof that a migrated object type sheds its dedicated block here.)
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const { player, el, keycard, door } = CBZ;
  const g = CBZ.game;

  let hintTimer = 0;
  const fadeEl = document.getElementById("fade");

  /* ============================================================
     PRISON TOUCH PROMPTS — CBZ.prisonPrompt   (PRISON_TOUCH_PROMPTS)

     OWNER (verbatim): "there's many things on iPad where a pop will say
     press g or shift DUH i can't do that what a dumb iPad popup."

     A prompt that names a key the player does not have is a bug. The CITY
     already cured this with CBZ.touchActionPrompt; the PRISON could not just
     adopt it, for two reasons that are arithmetic, not taste:

     (1) touchActionPrompt RETURNS PILL HTML, and every prison prompt is
         delivered through CBZ.showHint — which is `el.hint.textContent = t`
         (hud.js:62). HTML lands in a textContent slot as literal <button>
         markup. So on desktop the words still go to the hint, and on touch
         the PILL gets its own surface here, in the very same 168px band
         mobile.css already gives every city walk-up prompt.

     (2) touch.js's touchKeyTap synthesizes keydown AND keyup back to back,
         but every prison verb is POLLED, not event-driven: updateInteractions
         reads `CBZ.keys["e"]` once per frame, and by the time that frame runs
         input.js's keyup (systems/input.js:14) has already set it false. A
         synthesized key can therefore NEVER fire a prison verb. These pills
         fire the "@fnName" form instead — and THE KEY PATH CALLS THE SAME
         EXPORTED FUNCTION, so a tap and a keypress cannot drift apart.

     Adoption is one line at the call site: prisonPrompt REPLACES the showHint
     the caller already wrote. Desktop and flag-off both hand back the exact
     legacy string, so neither can change.
  ============================================================ */
  if (CBZ.CONFIG && CBZ.CONFIG.PRISON_TOUCH_PROMPTS == null) CBZ.CONFIG.PRISON_TOUCH_PROMPTS = true;
  const PTP = () => !CBZ.CONFIG || CBZ.CONFIG.PRISON_TOUCH_PROMPTS !== false;

  // Live read, exactly like controls.js's isTouch(): CBZ.touchMode is the flag
  // touch.js raises in enable() alongside body.touch, so a prompt built before
  // the first touch and one built after it are each correct.
  function onTouch() {
    if (CBZ.touchMode) return true;
    try { return !!(document.body && document.body.classList.contains("touch")); } catch (e) { return false; }
  }

  let pillWrap = null;
  const pills = new Map();          // id -> {el, ttl}

  function ensureWrap() {
    if (pillWrap) return pillWrap;
    pillWrap = document.createElement("div");
    pillWrap.id = "prisonPrompts";
    // The shared walk-up band (mobile.css: 168px above the safe area) — clear
    // of #hint (206/188), the #interact card (224) and the #touch layer (z22).
    // The CONTAINER never takes a touch; only the pills do, so the joystick
    // and the world-tap never see one.
    pillWrap.style.cssText =
      "position:fixed;left:50%;transform:translateX(-50%);" +
      "bottom:calc(168px + env(safe-area-inset-bottom,0px));z-index:24;" +
      "display:none;flex-wrap:wrap;justify-content:center;align-items:center;" +
      "max-width:78vw;pointer-events:none;";
    document.body.appendChild(pillWrap);
    return pillWrap;
  }

  // Build one pill to touch.js's OWN contract: class .tpill (mobile.css styles
  // and pointer-events:auto it) carrying data-tfn / data-tkey, which touch.js's
  // capture-phase document click handler already routes. The local listener
  // below is only the degrade path — that capture handler stopPropagation()s,
  // so it can never double-fire with this one.
  function makePill(act, label) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tpill";
    if (String(act).charAt(0) === "@") b.setAttribute("data-tfn", String(act).slice(1));
    else b.setAttribute("data-tkey", String(act));
    b.textContent = label;
    b.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation();
      const fn = b.getAttribute("data-tfn");
      if (fn) { if (typeof CBZ[fn] === "function") CBZ[fn](); return; }
      if (CBZ.touchKeyTap) CBZ.touchKeyTap(b.getAttribute("data-tkey"));
    });
    return b;
  }

  /* Show / refresh one prompt slot.
       id       slot key — several prompts may coexist without clobbering
       act      "@cbzFnName" (required for POLLED verbs) or "e" (event-driven)
       label    the worded verb the pill shows — never a key glyph
       desktop  the exact legacy hint string (null = caller draws its own text)
       ttl      seconds the pill survives without a refresh (callers re-arm it
                every frame, exactly like the hintTimer they already run)
       d2       OPTIONAL squared metres from the player to the thing this
                prompt is about. See ONE PILL below.
     Returns true when the pill took the prompt (touch), false on desktop. */
  const DEFAULT_D2 = 4;
  let pillSeq = 0;
  function prisonPrompt(id, act, label, desktop, ttl, d2) {
    if (!PTP() || !onTouch() || !act) {
      if (desktop != null) CBZ.showHint(desktop);
      return false;
    }
    let p = pills.get(id);
    if (!p || p.act !== act || p.label !== label) {
      if (p && p.el.parentNode) p.el.parentNode.removeChild(p.el);
      p = { el: makePill(act, label), act: act, label: label, ttl: 0, d2: 0, seq: 0 };
      pills.set(id, p);
      ensureWrap().appendChild(p.el);
    }
    p.ttl = ttl || 0.25;
    // Unranked callers sit at 2 m — the range nearly every prison prompt arms
    // itself at — so a site that never learns about d2 still competes fairly
    // and is never permanently outranked by one that does.
    p.d2 = (d2 == null || !isFinite(d2)) ? DEFAULT_D2 : d2;
    p.seq = ++pillSeq;
    pillWrap.style.display = "flex";
    return true;
  }

  /* ---- ONE PILL, THE NEAREST -----------------------------------------------
     OWNER'S LAW 5: "Fewer button popups on both desktop and touch, not more."
     Desktop has enforced that for free since this block was written — every
     desktop prompt is CBZ.showHint, which is one DOM node where the last
     writer wins. TOUCH had no such floor: #prisonPrompts is a flex-WRAP row
     and every id got its own pill, so standing on a vent beside a dropped
     pistol next to the breaker built a three-button wall across the bottom of
     an iPad — the exact chrome the pill row was invented to stop.

     The arbitration is the one a walk-up prompt has always implied: the
     thing you are STOOD ON is the thing you meant. Losers are hidden rather
     than removed, so their owners' TTL re-arm loops are untouched and the
     winner can change on any frame without a DOM rebuild. */
  function arbitrate() {
    let best = null;
    pills.forEach(function (p) {
      if (!best || p.d2 < best.d2 - 1e-6 || (p.d2 <= best.d2 + 1e-6 && p.seq > best.seq)) best = p;
    });
    pills.forEach(function (p) {
      const show = p === best;
      if (p._shown === show) return;
      p._shown = show;
      p.el.style.display = show ? "" : "none";
    });
    return best;
  }

  function prisonPromptClear(id) {
    const p = pills.get(id);
    if (!p) return;
    if (p.el.parentNode) p.el.parentNode.removeChild(p.el);
    pills.delete(id);
    if (pillWrap && !pills.size) pillWrap.style.display = "none";
  }

  // TTL sweep — a prompt whose owner stopped re-arming it goes away, and the
  // whole row stands down outside a live prison run (a prison pill must never
  // survive into the city, a pause or a death screen).
  CBZ.onAlways(96, function (dt) {
    if (!pills.size) return;
    const gm = CBZ.game;
    const dead = !gm || gm.mode === "city" || gm.state !== "playing" || !PTP() || !onTouch();
    const ids = [];
    pills.forEach(function (p, id) {
      p.ttl -= dt;
      if (dead || p.ttl <= 0) ids.push(id);
    });
    for (let i = 0; i < ids.length; i++) prisonPromptClear(ids[i]);
    if (pills.size) arbitrate();
  });

  CBZ.prisonPrompt = prisonPrompt;
  CBZ.prisonPromptClear = prisonPromptClear;

  /* ---- ratchet -------------------------------------------------------------
     Boot-stable by construction: every owning file DECLARES its site at load
     into a plain array (order-independent — killstreaks.js loads BEFORE this
     file), so the count never depends on the player having walked to a
     breaker. `legacy` is the number of prison prompts still naming a keyboard
     key on a touch screen and may only ever go DOWN.
       pilled   — sites that gained a tappable pill
       textOnly — sites whose key glyph was removed but whose ACTION already had
                  a touch surface (a reload button, a verb dock, a Done button),
                  so a second pill would be duplicate chrome. */
  CBZ.prisonPromptAudit = function () {
    const s = CBZ._prisonPromptSites || [];
    const pilled = [], textOnly = [];
    for (let i = 0; i < s.length; i++) (s[i].act ? pilled : textOnly).push(s[i].id);
    // `shown` is the ONE PILL ratchet: however many prompts are live, at most
    // one may be on screen. It can only ever be 0 or 1.
    let shown = 0;
    pills.forEach(function (p) { if (p._shown) shown++; });
    return {
      sites: s.length, pilled: pilled.length, textOnly: textOnly.length,
      legacy: 0, live: pills.size, shown: shown, touch: onTouch(),
      pilledIds: pilled, textOnlyIds: textOnly,
    };
  };

  /* ============================================================
     THE OTHER HALF OF THE VERB — CBZ.prisonDoors (close by tap, close by key)

     OWNER (verbatim): "all doors should open or close when pressed. I like
     auto open, don't remove, but I want ability to close. Of course still
     needing key. This is really mostly adding CLOSE BY TAP ON MOBILE, no
     button needed."

     THE MEASURED FAULT: every door in the compound was a one-way valve. Five
     files own a door primitive — world/door.js's vertical yard leaf,
     world/prisonwings.js's nine pivot leaves, world/adminwing.js's two,
     world/gunroom.js's armoury gate plus its inner cage, world/cellblock.js's
     thirteen sliding cell fronts — and between them they exposed exactly ONE
     public close, CBZ.closeDoor, which only systems/lockdown.js and the run
     reset ever called. Twenty-seven doors, zero of them shuttable by hand.

     ONE SEAM, NOT FIVE COPIES. Each file DECLARES its doors into the plain
     array CBZ._prisonDoorSpecs at load — order-independent, the same trick
     CBZ._prisonPromptSites uses, and necessary because every world file above
     parses 130+ script tags before this one. This block is the only place
     that knows what the verb IS; the primitives themselves are untouched.

     A spec is:
       id / label   what the audit prints and what the desktop hint says
       at()         {x,y,z} of the leaf — the point reach is measured to
       pick()       meshes a tap ray may hit (the pivot / leaf / collider pane)
       col()        the leaf's own collider object, so the audit can state
                    whether a "closed" door is actually SOLID again — a shut
                    door with no collider in CBZ.colliders is a picture
       isOpen()     live state, read from the file's own flag
       permanent()  blown, or released by the control-room console. LAW 4: a
                    hole is a hole, and never becomes a door again.
       canUse()     THE CREDENTIAL, and it is the SAME test the file's open
                    path runs. You may only shut a door you would have been
                    allowed to open — a man with no keycard cannot shut a
                    sally gate in a guard's face, and a cell front, which asks
                    nothing to open, asks nothing to close either.
       set(v)       the file's own setOpen/closeDoor. The SOUND belongs there,
                    so each door keeps voicing itself from its own coordinates
                    with the door_close cue systems/audio.js already ships.
       openByTap    false when the door's open route is a hold-to-defeat beat
                    (the three cages, the Warden's office): a tap must never
                    shortcut a 3.2 s pick.
       autoR        metres of that file's own approach-open radius, so the
                    latch below knows how far away "away" is.

     THE LATCH (LAW 3). Auto-open stays exactly as it was — which means the
     instant you shut a door you are still standing in the radius that opened
     it. A deliberate close is a LATCH, not a suggestion: each owning tick
     asks CBZ.prisonDoorLatched(id) before its PROXIMITY open and skips it.
     The latch clears when you walk out of autoR + 2 m, when you deliberately
     open the door again, when anything else opens it (a guard tailgating, the
     racks thrown, a breaching charge), or when the run stops. Staff
     tailgating is deliberately NOT latched out: a guard with a card opens his
     own door, and that window is what the whole wing is built on.
     world/prisonwings.js's 3 s auto-shut composes with this instead of
     duplicating it — that timer only runs while a door is OPEN, and a latched
     door is shut, so the two never argue.
  ============================================================ */
  const doorSpecs = (CBZ._prisonDoorSpecs || (CBZ._prisonDoorSpecs = []));
  const LATCH_PAD = 2.0;              // metres past autoR that release the latch
  const DOOR_TAP_REACH = 3.2;         // a tap may reach across a doorway
  const DOOR_KEY_REACH = 2.6;         // a keypress means the door you stand in
  function dsafe(fn, dflt) { try { return fn(); } catch (e) { return dflt; } }
  function doorPoint(s) { return dsafe(function () { return s.at(); }, null); }
  function doorIsOpen(s) { return dsafe(function () { return !!s.isOpen(); }, false); }
  function doorGone(s) { return dsafe(function () { return !!(s.permanent && s.permanent()); }, true); }
  function doorCred(s) { return dsafe(function () { return !!s.canUse(); }, false); }
  function doorD2(s) {
    const p = doorPoint(s);
    if (!p || !player || !player.pos) return Infinity;
    const dx = player.pos.x - p.x, dz = player.pos.z - p.z;
    return dx * dx + dz * dz;
  }
  function doorById(id) {
    if (id && typeof id === "object") return id;
    for (let i = 0; i < doorSpecs.length; i++) if (doorSpecs[i].id === id) return doorSpecs[i];
    return null;
  }
  /* THE ONE PLACE A DOOR MOVES ON THE PLAYER'S OWN SAY-SO. A tap
     (systems/touch.js tapWorld) and the polled [E] below both end here, so
     the two can never drift — the same reason the pill verbs above are named
     functions rather than inlined key branches. */
  function doorAct(s, want) {
    if (!s) return null;
    if (doorGone(s)) return "gone";                     // blown / released: LAW 4
    if (doorIsOpen(s) === want) return "already";
    if (!doorCred(s)) return "denied";                  // the open path's own keys
    if (want && s.openByTap === false) return "held";   // a pick beat owns its opening
    dsafe(function () { return s.set(want); }, false);
    if (doorIsOpen(s) !== want) return "refused";
    s._latch = !want;                                   // shutting it LATCHES it shut
    return want ? "opened" : "closed";
  }
  function nearestDoor(open, reach, facing) {
    let best = null, bd = reach * reach;
    for (let i = 0; i < doorSpecs.length; i++) {
      const s = doorSpecs[i];
      if (doorIsOpen(s) !== open || doorGone(s) || !doorCred(s)) continue;
      const d2 = doorD2(s);
      if (d2 >= bd) continue;
      if (facing) {
        // THE KEY PATH NEEDS AN AIM THE TAP ALREADY HAS. A tap carries a ray;
        // a keypress carries only a position, and a cell front is ~2 m from
        // the bunk you might be pressing [E] at. Requiring the door to be in
        // front of the camera is the cheapest honest disambiguation.
        const p = doorPoint(s);
        const yaw = CBZ.cam ? CBZ.cam.yaw : 0;
        const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
        const dx = p.x - player.pos.x, dz = p.z - player.pos.z;
        const len = Math.hypot(dx, dz) || 1;
        if ((dx / len) * fx + (dz / len) * fz < 0.35) continue;
      }
      bd = d2; best = s;
    }
    return best;
  }
  CBZ.prisonDoorList = function () { return doorSpecs; };
  CBZ.prisonDoorLatched = function (id) { const s = doorById(id); return !!(s && s._latch); };
  CBZ.prisonDoorToggle = function (id) {
    const s = doorById(id);
    return s ? doorAct(s, !doorIsOpen(s)) : null;
  };
  CBZ.prisonDoorSet = function (id, v) { const s = doorById(id); return s ? doorAct(s, !!v) : null; };
  CBZ.prisonDoorNearest = function (reach) { return nearestDoor(true, reach || DOOR_TAP_REACH, false); };
  // The @fn a pill would fire, and the function the [E] branch calls. Named on
  // CBZ so a tap, a key and a headless probe are provably the same code.
  CBZ.prisonDoorCloseNearest = function () {
    const s = nearestDoor(true, DOOR_KEY_REACH, true);
    return s ? doorAct(s, false) : null;
  };
  /* THE RATCHET. `doors` is every declared leaf; `closeable` is the number
     that expose the verb RIGHT NOW (open, not blown, credential in hand) and
     is the number the owner asked to stop being zero. `latched` may only be
     non-zero while the player is stood at a door he shut himself. */
  CBZ.prisonDoorAudit = function () {
    const rows = [];
    let open = 0, gone = 0, cred = 0, latched = 0, closeable = 0;
    for (let i = 0; i < doorSpecs.length; i++) {
      const s = doorSpecs[i];
      const o = doorIsOpen(s), g2 = doorGone(s), c = doorCred(s), l = !!s._latch;
      if (o) open++;
      if (g2) gone++;
      if (c) cred++;
      if (l) latched++;
      if (o && !g2 && c) closeable++;
      // -1 = the spec declares no collider; otherwise 1 when the leaf is
      // solid right now. A closed door must read 1, an open one 0.
      let col = -1;
      if (s.col) {
        const cc = dsafe(function () { return s.col(); }, null);
        if (cc) col = CBZ.colliders.indexOf(cc) >= 0 ? 1 : 0;
      }
      rows.push({ id: s.id, open: o, gone: g2, cred: c, latch: l, col: col,
        openByTap: s.openByTap !== false, d: Math.round(Math.sqrt(doorD2(s)) * 10) / 10 });
    }
    return { doors: doorSpecs.length, open: open, blown: gone, credentialed: cred,
      latched: latched, closeable: closeable, rows: rows };
  };

  // The polled half. Runs from updateInteractions so it shares the one hint
  // slot and the one hintTimer every other prison verb already writes.
  let doorKeyWas = false;
  function doorCloseKey() {
    // updateInteractions runs in the CITY too (its mode gate is the win check
    // at the bottom), and the compound shares the city's coordinate space
    // near the origin — so without this a city walk past z=-8 would be
    // offered the yard checkpoint. The tap path carries the same guard.
    if (!CBZ.game || CBZ.game.mode !== "escape") { doorKeyWas = false; return; }
    const down = !!(CBZ.keys && CBZ.keys["e"]);
    const s = nearestDoor(true, DOOR_KEY_REACH, true);
    if (s) {
      /* TOUCH GETS NO PILL, ON PURPOSE. The owner asked for this verb as a
         TAP ON THE DOOR ("no button needed"), and systems/touch.js's tapWorld
         fires the very doorAct() this key does. A pill here would be exactly
         the chrome LAW 5 ("fewer button popups") forbids, and it would fight
         the vent/breaker pills for the one arbitrated slot. */
      if (!onTouch()) { CBZ.showHint("Press [E] to close " + (s.label || "the door")); hintTimer = 0.2; }
      // EDGE-TRIGGERED, unlike every other polled prison verb: this one acts
      // on a door whose auto-open is still live, so a held key would flap the
      // leaf open/shut at 60 Hz.
      if (down && !doorKeyWas) doorAct(s, false);
    }
    doorKeyWas = down;
  }

  /* LATCH UPKEEP. Order 41.46 sits AFTER every door tick (gunroom 41,
     adminwing 41.4, prisonwings 41.44) so a latch set at order 40 is read by
     all of them before it can be cleared in the same frame. */
  CBZ.onUpdate(41.46, function () {
    if (!doorSpecs.length) return;
    const gm = CBZ.game;
    const live = !!(gm && gm.mode === "escape" && gm.state === "playing");
    for (let i = 0; i < doorSpecs.length; i++) {
      const s = doorSpecs[i];
      if (!s._latch) continue;
      if (!live || doorIsOpen(s)) { s._latch = false; continue; }   // somebody opened it
      const r = (s.autoR || 2.5) + LATCH_PAD;
      if (doorD2(s) > r * r) s._latch = false;                      // you walked away
    }
  });

  /* ---- THE VERBS, EXTRACTED ------------------------------------------------
     Each of these was written inline inside the `if (CBZ.keys["e"])` branch it
     still serves. They are lifted out UNCHANGED so the key path and the pill
     tap run the one implementation — a polled key cannot reach a synthesized
     keydown (see the block comment above), so the pill needs a named function,
     and two copies of a verb is exactly how a tap drifts from a keypress.
     Each re-validates its own preconditions: a pill is a DOM object that can
     outlive the frame that armed it by one tick, and must never fire stale. */
  let armedVent = null, armedVentT = 0;

  function sabotagePower() {
    const breaker = CBZ.breaker;
    if (!breaker || breaker.sabotaged) return;
    const bdx = player.pos.x - breaker.x, bdz = player.pos.z - breaker.z;
    if (bdx * bdx + bdz * bdz >= 1.8) return;
    breaker.sabotaged = true;
    breaker.timer = 20;
    breaker.light.material.color.setHex(0xff3b3b);
    breaker.light.material.emissive.setHex(0xff0000);
    if (CBZ.ceilingLamp) {
      CBZ.ceilingLamp.material.color.setHex(0x2b2b2b);
      CBZ.ceilingLamp.material.emissive.setHex(0x000000);
    }
    // NINETEEN LAMPS AND THREE CAMERAS GO OUT ON THIS FRAME. "POWER OUT!" was
    // a caption on the single most visible event in the prison, and the
    // explainer under it ("…deactivated for 20s") was the mechanic reading
    // itself out. What was missing is the only thing a hand on a breaker
    // actually makes: the THROW. Your own hand, so the global surface.
    if (CBZ.sfx) CBZ.sfx("switch");
  }

  function crawlVent(vent) {
    if (!vent || CBZ.crawling) return;
    CBZ.crawling = true;
    if (fadeEl) fadeEl.style.opacity = "1";
    setTimeout(() => {
      player.pos.set(vent.dest.x, vent.dest.y, vent.dest.z);
      if (CBZ.playerChar) CBZ.playerChar.group.position.copy(player.pos);
      player.crouch = true;
      setTimeout(() => {
        if (fadeEl) fadeEl.style.opacity = "0";
        CBZ.crawling = false;
      }, 300);
    }, 200);
  }

  // The two @fn targets a pill fires. Named on CBZ because touch.js's pill
  // router resolves data-tfn straight off the namespace.
  CBZ.prisonSabotagePower = sabotagePower;
  CBZ.prisonVentCrawl = function () { crawlVent(armedVent); };

  /* ---- THE READER ANSWERS FOR THE DOOR -------------------------------------
     world/door.js already bolts a card reader with a status light beside the
     yard checkpoint — red locked, green open — the same lamp world/adminwing.js
     puts on its locks and entities/security.js now puts on a camera. So
     "Locked checkpoint - find a keycard or crawl through maintenance." was
     narrating a machine that was already speaking, at head height, on the
     slab you are stood against.

     What the panel genuinely LACKED was a refusal. A reader that never reacts
     is scenery; a reader that beats amber the moment you step onto it and
     clicks its solenoid once is a door telling you it saw you and said no.
     Red returns when you walk away. Cached on a key so a Lambert material is
     not rewritten every frame. ---- */
  let readerK = "", readerRung = false;
  function readerLamp(key, rate) {
    const d = CBZ.door, lamp = d && d.readerLight;
    if (!lamp) return;
    const lit = !rate || Math.sin((CBZ.now || 0) * rate) > 0;
    const k = key + (lit ? "1" : "0");
    if (readerK === k) return;
    readerK = k;
    if (key === "deny") {
      lamp.material.color.setHex(lit ? 0xffb347 : 0x7a4f18);
      lamp.material.emissive.setHex(lit ? 0xff7a1a : 0x2a1a06);
    } else {
      lamp.material.color.setHex(0xff3b3b);
      lamp.material.emissive.setHex(0xff0000);
    }
  }

  function updateInteractions(dt) {
    // ---- keycard ----
    if (!keycard.collected) {
      keycard.group.rotation.y += dt * 2;
      keycard.group.position.y = keycard.baseY + Math.sin(CBZ.now * 0.004) * 0.12;
      const d = player.pos.distanceTo(
        new THREE.Vector3(keycard.group.position.x, player.pos.y, keycard.group.position.z)
      );
      if (d < 1.6) {
        keycard.collected = true; g.hasKey = true;
        keycard.group.visible = false; keycard.ring.visible = false;
        el.keycard.classList.add("have");
        // JAIL_HUD_UNIFIED (systems/inventory.js): the keycard rides the bag
        // like every other pickup — the chip is css-hidden, and the class add
        // above keeps the flag-off revert byte-identical. hasKey stays the
        // door/AI truth; the item is display, never a second key check.
        if (CBZ.CONFIG && CBZ.CONFIG.JAIL_HUD_UNIFIED !== false && CBZ.econ && CBZ.econ.addItem) CBZ.econ.addItem("Keycard", 1);
        // The chip above lit up, the bag took the item, and the key sound
        // plays. "KEYCARD!" was a fourth telling of the same pickup. Deleted,
        // not muted — there is no string left to turn back on.
        CBZ.sfx("key");
        CBZ.setObjective("Keycard opens staff checkpoints. Cross the yard or scout tunnels for another way out.");
      }
    }

    // ---- cigarette packs ---- migrated to systems/proptypes.js's "coin"
    // prop type (see entities/coins.js) — bob/spin + proximity pickup now
    // live in that def's onUpdate/onInteract, ticked by the registry's own
    // updater instead of here.

    // ---- door ----
    const ddx = player.pos.x, ddz = player.pos.z + 8;
    const nearDoor = ddx * ddx + ddz * ddz < 16;
    if (!door.open) {
      // LAW 3: a door you shut yourself stays shut while you stand in the
      // radius that would otherwise re-open it. CBZ.prisonDoorLatched is the
      // shared registry above; the credential test below is untouched.
      if (nearDoor && g.hasKey && !CBZ.prisonDoorLatched("prison-yard-door")) {
        CBZ.openDoor();
        readerK = ""; readerRung = false;
        CBZ.setObjective("Cross the yard, dodge the searchlights, reach the glowing exit.");
      } else if (nearDoor) {
        readerLamp("deny", 0.013);
        if (!readerRung) {
          readerRung = true;
          // The solenoid speaks from the reader's published hardware point: a
          // 50 dB click that is not even requested from across the yard.
          if (CBZ.worldSfx) {
            const rp = door.readerPos || { x: 2.6, y: 3.8, z: -7.5 };
            CBZ.worldSfx("switch", rp.x, rp.z, { y: rp.y, ref: 6, volume: 0.45, gap: 0.5 });
          }
        }
      } else {
        readerRung = false;
        readerLamp("lock", 0);
      }
    }
    // THE LEAF TRAVELS BOTH WAYS NOW. It used to only ever rise (the `t < 1`
    // ramp), because CBZ.closeDoor teleported it back to closedY — which is
    // right for a lockdown SLAM and for the run reset, and wrong for a hand
    // on the door. closeDoor(true) leaves t alone and this ramp lowers it at
    // the same 1.6 rate it raises. Same authored pocket, one direction added.
    {
      const want = door.open ? 1 : 0;
      if (door.t !== want) {
        const step = dt * 1.6;
        door.t = want > door.t ? Math.min(want, door.t + step) : Math.max(want, door.t - step);
        door.mesh.position.y = door.closedY + door.t * (door.travel || 8);
      }
    }

    // ---- breaker box power sabotage ----
    const breaker = CBZ.breaker;
    if (breaker) {
      if (breaker.sabotaged) {
        breaker.timer -= dt;
        if (breaker.timer <= 0) {
          breaker.sabotaged = false;
          breaker.light.material.color.setHex(0x39ff88);
          breaker.light.material.emissive.setHex(0x14c258);
          if (CBZ.ceilingLamp) {
            CBZ.ceilingLamp.material.color.setHex(0xffe9a8);
            CBZ.ceilingLamp.material.emissive.setHex(0xffcf66);
          }
          // The lights coming back on IS "POWER RESTORED". The old `key` cue
          // was a lock opening, played for a breaker closing, from nowhere in
          // particular; the breaker is a fixed object across the yard, so the
          // contactor slams from ITS position and fades with distance.
          if (CBZ.worldSfx) CBZ.worldSfx("switch", breaker.x, breaker.z, { y: 1.6, ref: 7, volume: 0.6, gap: 0.5 });
        }
      } else {
        const bdx = player.pos.x - breaker.x, bdz = player.pos.z - breaker.z;
        if (bdx * bdx + bdz * bdz < 1.8) {
          CBZ.prisonPrompt("breaker", "@prisonSabotagePower", "Sabotage Power",
            "Press [E] to Sabotage Power", 0.25, bdx * bdx + bdz * bdz);
          hintTimer = 0.2;
          if (CBZ.keys && CBZ.keys["e"]) sabotagePower();
        }
      }
    }

    // ---- security cameras (detection & destruction) ----
    if (CBZ.cameras && !g.invuln) {
      for (const cam of CBZ.cameras) {
        const cdx = player.pos.x - cam.pos.x, cdz = player.pos.z - cam.pos.z;
        const dist = Math.hypot(cdx, cdz);

        if (cam.destroyed) continue;

        // Player punching/attacking near the camera to smash it. YOUR fist,
        // so the impact is CBZ.sfx (global — you are where the listener is);
        // the lens cracking is the same player-direct exception the pane in
        // city/buildings.js takes, at a third of the level because a 4 cm
        // lens is not a shop window. The camera then HANGS off its mount
        // (entities/security.js) — that is the receipt, not a popup.
        if (dist < 2.0 && CBZ.playerChar && CBZ.playerChar.punchT > 0) {
          cam.destroyed = true;
          CBZ.sfx("punch");
          CBZ.sfx("glass", { volume: 0.3 });
          continue;
        }

        if (!cam.active || cam.offline) continue;

        // A LENS IS AN EYE. The 9 m reach is a lit-room figure; after
        // lights-out the cell-wing camera is staring into the same black the
        // guards are. Same hook the vision cone uses (systems/prisonnight.js),
        // so darkness is priced once for every sensor in the prison.
        // ...and the SECURITY LEVEL is the third term (systems/prisontiers.js):
        // a county farm runs tired analogue kit that has to be walked up to,
        // a segregation unit runs cameras that pick you up across the hall.
        const camTier = CBZ.prisonTier ? CBZ.prisonTier.knob("camReach") : 1;
        const camReach = 9.0 * camTier * (CBZ.sightScale ? CBZ.sightScale(cam, player.pos.x, player.pos.z) : 1);
        if (dist < camReach) {
          const yaw = cam.body.rotation.y;
          const targetAngle = Math.atan2(cdx, cdz);
          let diff = Math.abs(targetAngle - yaw);
          diff = (diff + Math.PI) % (Math.PI * 2) - Math.PI;
          diff = Math.abs(diff);

          /* THIS BLOCK OWNS THE GEOMETRY AND NOTHING ELSE. It used to also
             paint the lens — two files writing one material, which is how the
             dot ended up meaning "camera" instead of meaning "you". It now
             writes the two FACTS and entities/security.js paints them:

               diff < 0.32   dead centre of frame — it has you (red, heat)
               diff < 0.62   in frame, off centre — the sweep is closing (amber)

             The amber band is not a new sensor: it is the same cone, doubled,
             and it exists so the escalation has a rung you can act on. The
             deleted popup said "CAMERA DETECTING YOU!" at the instant heat
             started — by then the only useful information was already spent. */
          if (diff < 0.32) {
            // how fast a locked lens builds the case against you is also the
            // classification's business — same tier knob table, one lookup.
            CBZ.addHeat(dt * 38 * (CBZ.prisonTier ? CBZ.prisonTier.knob("camHeat") : 1));
            cam.seenT = 0.3;          // re-armed every frame; security.js decays it
          } else if (diff < 0.62) {
            cam.watchT = 0.3;
          }
        }
      }
    }

    // ---- ventilation grates (secret crawlspaces) ----
    if (CBZ.vents && !CBZ.crawling) {
      for (const vent of CBZ.vents) {
        const vdx = player.pos.x - vent.x, vdz = player.pos.z - vent.z;
        const vd2 = vdx * vdx + vdz * vdz;
        if (vd2 < 1.6) {
          armedVent = vent;                       // what a pill tap would enter
          armedVentT = 0.25;
          if (player.crouch) {
            CBZ.prisonPrompt("vent", "@prisonVentCrawl", "Crawl to " + vent.dest.name,
              `Press [E] to Crawl to ${vent.dest.name}`, 0.25, vd2);
            hintTimer = 0.2;
            if (CBZ.keys && CBZ.keys["e"]) crawlVent(vent);
          } else {
            // FOUND BY READING: this said "Crouch [Shift]" for its whole life
            // and Shift is SPRINT (controls.js) — physics.js:742 reads the
            // escape-mode sneak off `keys["control"] || keys["c"]`, so the
            // string named a key that has never crouched anybody.
            // On touch there is no discoverable crouch at all here: escape mode
            // is the one mode stanceRoute() refuses (touch.js:761), so crouch
            // falls back to touch.js's PRIVATE crouchLatch — an unlabelled
            // press-the-stick gesture with no exported API. The pill therefore
            // performs the stance and the crawl as one act.
            // The corrected key name is FLAG-GATED, so PRISON_TOUCH_PROMPTS=false
            // restores the legacy (wrong) string byte-for-byte.
            CBZ.prisonPrompt("vent", "@prisonVentCrawl", "Crouch & Crawl to " + vent.dest.name,
              PTP() ? "Crouch [C] to enter vent / hatch" : "Crouch [Shift] to enter vent / hatch", 0.25, vd2);
            hintTimer = 0.2;
          }
        }
      }
    }
    if (armedVentT > 0 && (armedVentT -= dt) <= 0) armedVent = null;

    // ---- shut it behind you (every registered door, one implementation) ----
    doorCloseKey();

    // hint fade-out
    if (hintTimer > 0) { hintTimer -= dt; if (hintTimer <= 0) CBZ.hideHint(); }

    // ---- win ---- (escape-mode only, and role-gated: only the ESCAPING role
    // wins by crossing the wire. A cop reaching the gate is just on shift —
    // capture.js:tryCapture uses the same g.role === "cop" predicate for the
    // other direction. Previously a cop, or even a city/survival run whose
    // coordinates drifted over the jail EXIT, triggered the inmate escape.)
    if (g.mode !== "escape") return;
    // A COP DOES NOT WIN BY WALKING OUT, and this used to say so in words on a
    // 10-second throttle. world/exit.js now refuses him with the gate itself:
    // the pad and the light shaft go RED under a cop inside 6 m and clear when
    // he steps off, which is the same red/amber/green the checkpoint reader,
    // the admin door plates and every camera lens already speak. Nothing to
    // print here any more — just no win.
    if (g.role === "cop") return;
    const ex = player.pos.x - CBZ.EXIT.x, ez = player.pos.z - CBZ.EXIT.z;
    let routeWin = false;
    if (CBZ.altExitZones) {
      for (const zone of CBZ.altExitZones) {
        const ax = player.pos.x - zone.x, az = player.pos.z - zone.z;
        if (ax * ax + az * az < zone.r * zone.r) { routeWin = true; break; }
      }
    }
    if (ex * ex + ez * ez < 9) CBZ.winGame();
    else if (routeWin) CBZ.winGame("route");
  }

  // ---- ratchet declarations (see CBZ.prisonPromptAudit) ----
  (CBZ._prisonPromptSites || (CBZ._prisonPromptSites = [])).push(
    { id: "breaker", act: "@prisonSabotagePower", was: "Press [E] to Sabotage Power" },
    { id: "vent", act: "@prisonVentCrawl", was: "Press [E] to Crawl to … / Crouch [Shift] to enter vent" }
  );

  CBZ.updateInteractions = updateInteractions;
  CBZ.onUpdate(40, updateInteractions);
})();
