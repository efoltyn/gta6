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

  const fadeEl = document.getElementById("fade");

  /* ============================================================
     THE PROMPT IS ON THE THING — CBZ.prisonPrompt

     OWNER (2026-09-05): "it should be like on the cell door it should say
     to press e to close, instead of a button in middle of screen saying
     press e to close cell. you always put the noun on the button but really
     the noun should be what the button is on and it shouldnt say what its
     on. sabotage power should just be sabotage."

     So a prompt is a VERB pinned to a WORLD POINT. The word never names the
     object — the object is under it. Desktop and touch render the SAME
     element: a key chip + the verb on a keyboard, a tappable pill on a
     touchscreen (the chip is hidden there by mobile.css's .ikey rule and the
     pill fires touch.js's own data-tfn / data-tkey routing).

       CBZ.prisonPrompt(id, act, verb, opts)
         id     slot key — the owner re-arms it every frame, TTL retires it
         act    "@cbzFnName" (a POLLED verb must name a function: touch.js's
                synthesized keydown/keyup is gone before the poll runs) or a
                key letter for an event-driven listener
         verb   the word. ONE verb, no noun: "Close", "Sabotage", "Crawl".
         opts   at    {x,y,z} the thing this is about. The label floats over
                      it. Absent = no thing (the nuke) → the bottom band.
                key   letter the desktop chip shows for an @fn act (dflt "E")
                hold  a hold-to-work beat (pick / saw) — the chip says HOLD
                sub   a small second line ("to Cell Block Aisle")
                d2    squared metres to the thing, for ONE PILL below
                ttl   seconds without a re-arm before it goes (dflt 0.25)

     ONE PILL, THE NEAREST (owner's law 5: "fewer button popups"). Several
     owners may arm at once — a vent beside a crate beside the breaker — and
     exactly one is shown: the thing you are stood closest to. Losers are
     hidden, not removed, so their owners' re-arm loops are untouched.
  ============================================================ */
  let promptLayer = null;
  const pills = new Map();          // id -> {wrap, el, act, verb, at, ttl, d2, seq, shown}
  const DEFAULT_D2 = 4;
  let pillSeq = 0;
  const _pv = new THREE.Vector3();

  function onTouch() {
    if (CBZ.touchMode) return true;
    try { return !!(document.body && document.body.classList.contains("touch")); } catch (e) { return false; }
  }

  function ensureLayer() {
    if (promptLayer) return promptLayer;
    promptLayer = document.createElement("div");
    promptLayer.id = "prisonPrompts";
    document.body.appendChild(promptLayer);
    return promptLayer;
  }

  function fireAct(act) {
    if (String(act).charAt(0) === "@") {
      const fn = String(act).slice(1);
      if (typeof CBZ[fn] === "function") CBZ[fn]();
    } else if (CBZ.touchKeyTap) CBZ.touchKeyTap(String(act));
  }

  // One prompt = an anchor div (positioned) holding the pill. The pill is a
  // <button class="tpill"> to touch.js's contract, so the capture-phase click
  // router there fires it and the UI_SEL list keeps a tap on it from becoming
  // a joystick press or a world tap. The local listener is the degrade path.
  function makePill(act, verb, opts) {
    const wrap = document.createElement("div");
    wrap.className = "wprompt" + (opts.at ? "" : " band");
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tpill";
    if (String(act).charAt(0) === "@") b.setAttribute("data-tfn", String(act).slice(1));
    else b.setAttribute("data-tkey", String(act));
    const key = document.createElement("span");
    key.className = "ikey wkey";
    const letter = (opts.key || (String(act).charAt(0) === "@" ? "e" : String(act))).toUpperCase();
    key.textContent = opts.hold ? "HOLD " + letter : letter;
    const word = document.createElement("span");
    word.className = "wverb";
    word.textContent = verb;
    b.appendChild(key); b.appendChild(word);
    if (opts.sub) {
      const sub = document.createElement("span");
      sub.className = "wsub";
      sub.textContent = opts.sub;
      b.appendChild(sub);
    }
    b.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation();
      fireAct(act);
    });
    wrap.appendChild(b);
    return wrap;
  }

  function prisonPrompt(id, act, verb, opts) {
    if (!act || !verb) return false;
    opts = opts || {};
    const sig = act + "|" + verb + "|" + (opts.sub || "") + "|" + (opts.hold ? 1 : 0) + "|" + (opts.at ? 1 : 0);
    let p = pills.get(id);
    if (!p || p.sig !== sig) {
      if (p && p.wrap.parentNode) p.wrap.parentNode.removeChild(p.wrap);
      p = { wrap: makePill(act, verb, opts), sig: sig, ttl: 0, d2: 0, seq: 0, at: null, shown: null };
      pills.set(id, p);
      ensureLayer().appendChild(p.wrap);
    }
    p.at = opts.at || null;
    p.ttl = opts.ttl || 0.25;
    // Unranked callers sit at 2 m — the range nearly every prison prompt arms
    // itself at — so a site that never learns about d2 still competes fairly.
    p.d2 = (opts.d2 == null || !isFinite(opts.d2)) ? DEFAULT_D2 : opts.d2;
    p.seq = ++pillSeq;
    promptLayer.classList.add("on");
    return true;
  }

  function prisonPromptClear(id) {
    const p = pills.get(id);
    if (!p) return;
    if (p.wrap.parentNode) p.wrap.parentNode.removeChild(p.wrap);
    pills.delete(id);
    if (promptLayer && !pills.size) promptLayer.classList.remove("on");
  }

  function arbitrate() {
    let best = null;
    pills.forEach(function (p) {
      if (!best || p.d2 < best.d2 - 1e-6 || (p.d2 <= best.d2 + 1e-6 && p.seq > best.seq)) best = p;
    });
    pills.forEach(function (p) {
      const show = p === best;
      if (p.shown !== show) { p.shown = show; p.wrap.style.display = show ? "" : "none"; }
    });
    return best;
  }

  /* Pin the shown prompt over its thing: project the world point through the
     LIVE camera (camera.js updates it at always-order 50; this runs at 96).
     A point behind the camera hides the label — a prompt is for what you are
     facing. A point in front but off the edge is clamped to a margin, the
     way a marker is, so a door at your shoulder still tells you it is there. */
  const EDGE = 0.06;
  function placePrompt(p) {
    if (!p.at) return;
    const cam = CBZ.camera;
    if (!cam) return;
    _pv.set(p.at.x, p.at.y, p.at.z).project(cam);
    if (_pv.z > 1) { p.wrap.style.visibility = "hidden"; return; }
    const w = window.innerWidth || 800, h = window.innerHeight || 600;
    const nx = Math.max(-1 + EDGE * 2, Math.min(1 - EDGE * 2, _pv.x));
    const ny = Math.max(-1 + EDGE * 3, Math.min(1 - EDGE * 2, _pv.y));
    const sx = Math.round((nx * 0.5 + 0.5) * w), sy = Math.round((-ny * 0.5 + 0.5) * h);
    if (p._sx !== sx || p._sy !== sy) {
      p._sx = sx; p._sy = sy;
      p.wrap.style.left = sx + "px";
      p.wrap.style.top = sy + "px";
    }
    p.wrap.style.visibility = "";
  }

  // TTL sweep + placement. A prompt whose owner stopped re-arming it goes
  // away, and the whole layer stands down outside a live prison run (a prison
  // prompt must never survive into the city, a pause or a death screen).
  CBZ.onAlways(96, function (dt) {
    if (!pills.size) return;
    const gm = CBZ.game;
    const dead = !gm || gm.mode === "city" || gm.state !== "playing";
    const ids = [];
    pills.forEach(function (p, id) {
      p.ttl -= dt;
      if (dead || p.ttl <= 0) ids.push(id);
    });
    for (let i = 0; i < ids.length; i++) prisonPromptClear(ids[i]);
    if (!pills.size) return;
    const best = arbitrate();
    if (best) placePrompt(best);
  });

  CBZ.prisonPrompt = prisonPrompt;
  CBZ.prisonPromptClear = prisonPromptClear;
  CBZ.prisonPromptShown = function () {
    let out = null;
    pills.forEach(function (p, id) {
      if (p.shown) out = { id: id, verb: p.wrap.querySelector(".wverb").textContent, sub: (p.wrap.querySelector(".wsub") || {}).textContent || "",
        key: p.wrap.querySelector(".wkey").textContent, anchored: !!p.at, x: p._sx, y: p._sy };
    });
    return out;
  };

  /* ---- ratchet -------------------------------------------------------------
     Boot-stable by construction: every owning file DECLARES its site at load
     into a plain array (order-independent — killstreaks.js loads BEFORE this
     file), so the count never depends on the player having walked to a
     breaker. `legacy` is the number of prison prompts still naming a keyboard
     key on a touch screen and may only ever go DOWN. `nouned` is the number of
     LIVE prompts whose verb carries a noun ("Close cell", "Sabotage Power")
     and must stay 0. */
  const NOUN_RE = /\b(the|your|a|an|power|door|cell|lock|racks|crate|padlock|safe|vent|hatch)\b/i;
  CBZ.prisonPromptAudit = function () {
    const s = CBZ._prisonPromptSites || [];
    const pilled = [], textOnly = [];
    for (let i = 0; i < s.length; i++) (s[i].act ? pilled : textOnly).push(s[i].id);
    let shown = 0, nouned = 0, anchored = 0;
    pills.forEach(function (p) {
      if (p.shown) shown++;
      if (p.at) anchored++;
      if (NOUN_RE.test(p.wrap.querySelector(".wverb").textContent)) nouned++;
    });
    return {
      sites: s.length, pilled: pilled.length, textOnly: textOnly.length,
      legacy: 0, live: pills.size, shown: shown, anchored: anchored, nouned: nouned, touch: onTouch(),
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

  // The polled half. Runs from updateInteractions.
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
      /* THE WORD IS ON THE DOOR: "[E] Close" pinned over the leaf itself, so
         nothing has to say WHICH door. TOUCH GETS NO PILL, ON PURPOSE: the
         owner asked for this verb as a TAP ON THE DOOR ("no button needed"),
         and systems/touch.js's tapWorld fires the very doorAct() this key
         does — a pill would be the chrome LAW 5 forbids. */
      if (!onTouch()) CBZ.prisonPrompt("door", "@prisonDoorCloseNearest", "Close", { at: doorPoint(s), d2: doorD2(s) });
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

  // Where a prompt HANGS: the face of the breaker box (CBZ.breaker.x/z is the
  // stand spot 0.7 m in front of it, world/props.js), and a hand's height
  // over a grate. Cheap objects, built per frame only while a prompt is live.
  function breakerPoint() {
    const b = CBZ.breaker;
    const box = b && b.box;
    if (box && box.position) return { x: box.position.x, y: box.position.y + 0.35, z: box.position.z };
    return { x: b.x, y: 2.0, z: b.z - 0.7 };
  }
  function ventPoint(v) {
    const g = v.grate;
    return { x: g ? g.x : v.x, y: (v.y || 0.1) + 0.55, z: g ? g.z : v.z };
  }

  function updateInteractions(dt) {
    /* THE ESCAPE IS A SCENARIO, NOT A MAP (2026-08-19).
       Everything below this line is the prison BREAKOUT: the keycard on the
       floor, the yard door's card reader, the breaker box you sabotage, the
       camera cones, the vents you crawl through. It had no mode gate at all —
       the gate was the WIN check at the bottom — so it ran in every mode, and
       modes/gungame.js plays a deathmatch on this exact geometry. Walk over a
       grate mid-match and the arena printed "Crouch [C] to enter vent / hatch"
       at you; stand on the breaker and it offered "Press [E] to Sabotage
       Power"; touch the keycard and setObjective rewrote your objective to
       "Cross the yard or scout tunnels for another way out." A vent that
       teleports you off the map is not a feature of a gun game.
       (The city was already living with the near-miss version of this — see
       doorCloseKey's guard, which exists because the compound shares the
       city's coordinate space near the origin. One gate at the top is what
       that comment wanted and could not have on its own.) */
    if (!CBZ.game || CBZ.game.mode !== "escape") return;

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
          // "Sabotage", over the box. The box is the noun.
          CBZ.prisonPrompt("breaker", "@prisonSabotagePower", "Sabotage",
            { at: breakerPoint(), d2: bdx * bdx + bdz * bdz });
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
            // "Crawl" over the grate; where it goes is the one thing the
            // grate itself cannot show, so it rides as the small second line.
            CBZ.prisonPrompt("vent", "@prisonVentCrawl", "Crawl",
              { at: ventPoint(vent), sub: "to " + vent.dest.name, d2: vd2 });
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
            // performs the stance and the crawl as one act — so on touch it
            // says "Crawl"; on a keyboard it names the key you actually need.
            CBZ.prisonPrompt("vent", "@prisonVentCrawl", onTouch() ? "Crawl" : "Crouch",
              { at: ventPoint(vent), key: "c", sub: "to " + vent.dest.name, d2: vd2 });
          }
        }
      }
    }
    if (armedVentT > 0 && (armedVentT -= dt) <= 0) armedVent = null;

    // ---- shut it behind you (every registered door, one implementation) ----
    doorCloseKey();

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
    { id: "breaker", act: "@prisonSabotagePower", was: "Press [E] to Sabotage Power", now: "Sabotage, over the box" },
    { id: "vent", act: "@prisonVentCrawl", was: "Press [E] to Crawl to … / Crouch [Shift] to enter vent", now: "Crawl, over the grate" },
    { id: "door", act: "@prisonDoorCloseNearest", was: "Press [E] to close your cell door", now: "Close, over the leaf" }
  );

  CBZ.updateInteractions = updateInteractions;
  CBZ.onUpdate(40, updateInteractions);
})();
