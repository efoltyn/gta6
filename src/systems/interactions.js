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
  let copGateHintT = 0;   // throttles the cop-role "not your exit" flavor line
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
     Returns true when the pill took the prompt (touch), false on desktop. */
  function prisonPrompt(id, act, label, desktop, ttl) {
    if (!PTP() || !onTouch() || !act) {
      if (desktop != null) CBZ.showHint(desktop);
      return false;
    }
    let p = pills.get(id);
    if (!p || p.act !== act || p.label !== label) {
      if (p && p.el.parentNode) p.el.parentNode.removeChild(p.el);
      p = { el: makePill(act, label), act: act, label: label, ttl: 0 };
      pills.set(id, p);
      ensureWrap().appendChild(p.el);
    }
    p.ttl = ttl || 0.25;
    pillWrap.style.display = "flex";
    return true;
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
    return {
      sites: s.length, pilled: pilled.length, textOnly: textOnly.length,
      legacy: 0, live: pills.size, touch: onTouch(),
      pilledIds: pilled, textOnlyIds: textOnly,
    };
  };

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
    CBZ.flashToast("POWER OUT!");
    CBZ.flashHint("Sabotaged power! All cameras and Cell Block lights are deactivated for 20s.", 3.2);
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
        CBZ.sfx("key"); CBZ.flashToast("KEYCARD!");
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
      if (nearDoor) {
        if (g.hasKey) {
          CBZ.openDoor();
          CBZ.setObjective("Cross the yard, dodge the searchlights, reach the glowing exit.");
        } else {
          CBZ.showHint("Locked checkpoint - find a keycard or crawl through maintenance.");
          hintTimer = 0.4;
        }
      }
    } else if (door.t < 1) {
      door.t = Math.min(1, door.t + dt * 1.6);
      door.mesh.position.y = door.closedY + door.t * 8; // slide up into the wall
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
          CBZ.sfx("key");
          CBZ.flashToast("POWER RESTORED");
        }
      } else {
        const bdx = player.pos.x - breaker.x, bdz = player.pos.z - breaker.z;
        if (bdx * bdx + bdz * bdz < 1.8) {
          CBZ.prisonPrompt("breaker", "@prisonSabotagePower", "Sabotage Power",
            "Press [E] to Sabotage Power");
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

        // Player punching/attacking near the camera to smash it
        if (dist < 2.0 && CBZ.playerChar && CBZ.playerChar.punchT > 0) {
          cam.destroyed = true;
          CBZ.sfx("punch");
          CBZ.flashHint("Security camera destroyed!", 2.2);
          continue;
        }

        if (!cam.active) continue;

        if (dist < 9.0) {
          const yaw = cam.body.rotation.y;
          const targetAngle = Math.atan2(cdx, cdz);
          let diff = Math.abs(targetAngle - yaw);
          diff = (diff + Math.PI) % (Math.PI * 2) - Math.PI;
          diff = Math.abs(diff);

          if (diff < 0.32) {
            // inside detection field
            CBZ.addHeat(dt * 38);
            CBZ.showHint("CAMERA DETECTING YOU!");
            hintTimer = 0.2;
            // Blink lens rapidly
            cam.lens.material.color.setHex(CBZ.now % 200 < 100 ? 0xffea00 : 0xff3b3b);
            cam.lens.material.emissive.setHex(CBZ.now % 200 < 100 ? 0xccbb00 : 0xff0000);
          } else {
            // Restore default colors
            cam.lens.material.color.setHex(0xff3b3b);
            cam.lens.material.emissive.setHex(0xff0000);
          }
        }
      }
    }

    // ---- ventilation grates (secret crawlspaces) ----
    if (CBZ.vents && !CBZ.crawling) {
      for (const vent of CBZ.vents) {
        const vdx = player.pos.x - vent.x, vdz = player.pos.z - vent.z;
        if (vdx * vdx + vdz * vdz < 1.6) {
          armedVent = vent;                       // what a pill tap would enter
          armedVentT = 0.25;
          if (player.crouch) {
            CBZ.prisonPrompt("vent", "@prisonVentCrawl", "Crawl to " + vent.dest.name,
              `Press [E] to Crawl to ${vent.dest.name}`);
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
              PTP() ? "Crouch [C] to enter vent / hatch" : "Crouch [Shift] to enter vent / hatch");
            hintTimer = 0.2;
          }
        }
      }
    }
    if (armedVentT > 0 && (armedVentT -= dt) <= 0) armedVent = null;

    // hint fade-out
    if (hintTimer > 0) { hintTimer -= dt; if (hintTimer <= 0) CBZ.hideHint(); }

    // ---- win ---- (escape-mode only, and role-gated: only the ESCAPING role
    // wins by crossing the wire. A cop reaching the gate is just on shift —
    // capture.js:tryCapture uses the same g.role === "cop" predicate for the
    // other direction. Previously a cop, or even a city/survival run whose
    // coordinates drifted over the jail EXIT, triggered the inmate escape.)
    if (g.mode !== "escape") return;
    if (g.role === "cop") {
      if (copGateHintT > 0) copGateHintT -= dt;
      const cx = player.pos.x - CBZ.EXIT.x, cz = player.pos.z - CBZ.EXIT.z;
      if (cx * cx + cz * cz < 9 && copGateHintT <= 0) {
        copGateHintT = 10;
        CBZ.flashHint("You're on shift — the gate clocks you right back in.", 2.2);
      }
      return;
    }
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
