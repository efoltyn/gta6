/* ============================================================
   systems/intimidate.js — CBZ.intimidate

   "Logic in the NPCs": when the player POINTS A GUN at an inmate,
   the inmate reacts to the threat instead of carrying on with its
   day. Two outcomes, decided once per encounter from the inmate's
   stats + the situation:

     • SCARED  — unarmed or low-nerve inmates throw their HANDS UP:
                 they freeze, hunch, go wide-eyed and terrified
                 (posed by systems/reactions.js). While they're held
                 up you can ROB them at gunpoint ([G], or the ROB pill
                 on touch — a one-time full frisk).

     • DRAW    — armed, hard inmates may instead pull their OWN gun
                 and aim back: a Mexican stand-off. Keep your gun on
                 them too long and they fire — you're hit, and enough
                 lead drops you and drags you back to your cell
                 (escape mode has no death; getting "got" = captured).
                 Shoot first and you win the draw.

   Who carries a gun, and who draws vs. surrenders, is rolled from
   nerve, fighting rating, temperament (guts), gang backup, range and
   what you're holding. Vendors and pacifists never draw.

   FLOW: this module SENSES each frame (order 19, before the npc
   brain at 22), writing intent flags onto the actor. entities/ai.js
   delegates movement to think() while an inmate is reacting, and
   systems/reactions.js renders the hands-up / aim-back pose + face.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  const rng = function () { return CBZ.econ && CBZ.econ.rng ? CBZ.econ.rng() : Math.random(); };

  /* ============================================================
     "X FREEZES UP — [G] TO ROB" IS DELETED.

     OWNER (2026-08-11), verbatim: "the worst thing ever is in the prison game,
     the pop up 'X froze up. Rob him.' This spams and it's horrible and should
     be deleted." He is right, and the file had already agreed with him in
     writing: the `_prisonPromptSites` declaration at the bottom of this file
     records this exact string under `was:` — i.e. CONVERTED, history, replaced
     by the targeted `CBZ.prisonPrompt("rob", …, "Rob <name>")` a few lines
     above. The prompt shipped. The popup was never removed. Both ran.

     MEASURED (seed 90210, mode escape, rAF frozen, aim driven across the
     densest cluster of live inmates through the real CBZ.aimedActor path):
     ONE pan across five men produced 5 popups — while `Rob <name>` was armed
     THIRTY times over the same span, because the prompt re-arms every frame
     the shakedown is possible and the popup fires on top of it. FOUR pans over
     THE SAME FIVE MEN produced 20 popups in 16.8 s = 71 per minute, the same
     order as the 90/min punch spam docs/claude/sound.md was written to kill.

     WHY IT REPEATED FOREVER. `_reactHinted` looks like a one-shot latch, but
     `endIntimid()` clears it — and endIntimid runs HOLD (0.85 s) after you
     look away. So glancing off a man and back is a brand new encounter and a
     brand new popup, for the same man, at no cost, all day.

     WHAT SHOWS IT INSTEAD — all of it already shipped, which is the point:
       · he THROWS HIS HANDS UP, hunches, and goes wide-eyed and terrified
         (systems/reactions.js poses him). That IS "freezes up", rendered on
         the body the sentence was describing.
       · `Rob <name>` appears as a real prompt ON HIM, for exactly as long as
         the shakedown is actually possible, on desktop AND touch. The popup
         named a key ([G]) that a touch player does not have — the same
         fourth-wall control legend hud.js's CITY_CONTROL_RE already refuses.

     The other two lines in this file are not deleted, because they are not
     captions: one is a man DOING something to you and one is the ANSWER to a
     button you just pressed. Both go through the gate below and both get a
     MOUTH, the way entities/ai.js's narration sink demands.
     ============================================================ */
  // THE ONE GATE (systems/capture.js), degrade-safe, in the shape
  // lockdown.js:44 / killstreaks.js:11 / detection.js:17 already use. Returns
  // TRUE when the line was SUPPRESSED, so a caller with a diegetic replacement
  // runs it and `JAIL_SHOW_DONT_TELL=false` still restores the popup.
  function tellHint(m, s) { if (CBZ.jailTell) return CBZ.jailTell.hint(m, s); if (CBZ.flashHint) try { CBZ.flashHint(m, s); } catch (e) {} return false; }
  // systems/interact.js loads after this file: resolve prisonSay at CALL time.
  // Out of earshot (16 m) it returns false and we are silent, which is honest.
  function sayIt(actor, line, secs) {
    if (!actor || typeof CBZ.prisonSay !== "function") return false;
    try {
      return CBZ.prisonSay(actor, line, {
        rank: CBZ.PRISON_SAY ? CBZ.PRISON_SAY.act : 1,
        secs: secs || 2.0,
      });
    } catch (e) { return false; }
  }

  const HOLD = 0.85;        // how long a reaction lingers after you look away
  const ROB_RANGE = 6.5;    // max distance to shake someone down
  // One man, one "he pulled on me" line per this many seconds of run time.
  // Measured against the shipped behaviour: a 16.8 s four-pan over five men
  // fired 20 popups (71/min); at 12 s the same sweep cannot exceed one per man.
  const DRAW_SAY_CD = 12;

  // PRISON_TOUCH_PROMPTS (systems/interactions.js) used to be read HERE, to
  // strip the "[G]" glyph out of the popup on touch. The popup is gone, and
  // with it the whole problem: `CBZ.prisonPrompt` renders the key or the pill
  // per surface, once, in the place that owns that decision. Nothing in this
  // file has to know what a player is holding any more.

  function alive(a) { return a && !a.dead && !(a.ko > 0) && !a.escaped; }
  function playerDist(n) {
    const p = CBZ.player.pos, g = n.group.position;
    return Math.hypot(p.x - g.x, p.z - g.z);
  }
  function shortName(n) {
    return (n.data && n.data.name ? n.data.name : "He").replace(/^the |^a |^an /, "");
  }

  // any living gangmates close enough to embolden this inmate?
  function gangNearby(n) {
    if (n.gang == null) return false;
    for (let i = 0; i < CBZ.npcs.length; i++) {
      const m = CBZ.npcs[i];
      if (m === n || !m || m.gang !== n.gang || !alive(m)) continue;
      const dx = m.group.position.x - n.group.position.x;
      const dz = m.group.position.z - n.group.position.z;
      if (dx * dx + dz * dz < 100) return true;   // within ~10 units
    }
    return false;
  }

  // does this inmate carry a concealed firearm? decided once, from profile —
  // gang muscle / brawlers / bold types do; vendors and pacifists never.
  function decideGun(n) {
    if (n.role === "merchant" || n.role === "dealer") return false;
    const beh = n.behavior || "";
    if (beh === "pacifist") return false;
    const r = n.ratings || {}, p = n.personality || {};
    let c = 0.05;
    if (n.gang != null) c += 0.12;
    if (n.crewRole === "shotcaller" || n.crewRole === "enforcer" || n.crewRole === "collector") c += 0.20;
    const f = r.fighting || 40;
    if (f > 78) c += 0.20; else if (f > 58) c += 0.10;
    if (beh === "predator" || beh === "bully" || beh === "hothead" || beh === "unpredictable") c += 0.12;
    c += ((p.nerve != null ? p.nerve : 0.5) - 0.5) * 0.22;
    return rng() < Math.min(0.6, Math.max(0, c));
  }

  function initN(n) {
    n._intimidInit = true;
    n.hasGun = decideGun(n);
    n.intimidMode = null;     // null | "scared" | "draw" | "standoff"
    n.intimidT = 0;
    n.intimidDrawT = 0;
    n.intimidFireT = 0;
    n.poseHandsUp = false;
    n.poseAimBack = false;
    n._drewSayT = -1e9;      // never spoken yet (run-elapsed stamp, see DRAW_SAY_CD)
    // reflect the gun into their loot so a frisk / takedown can yield it
    if (n.hasGun && CBZ.econ && CBZ.econ.rollLoadout) {
      const ld = CBZ.econ.rollLoadout(n);
      if (ld && ld.items && ld.items.indexOf("Gun") < 0) ld.items.push("Gun");
    }
  }

  // first contact: surrender (hands up) or draw, based on stats + situation.
  function decideReaction(n, lethal) {
    const p = n.personality || {}, r = n.ratings || {};
    const nerve = p.nerve != null ? p.nerve : 0.5;
    const fight = (r.fighting || 40) / 100;
    const beh = CBZ.BEHAVIORS && CBZ.BEHAVIORS[n.behavior];
    const guts = beh && beh.guts != null ? beh.guts : 0.4;

    let draw = 0;
    if (n.hasGun) {
      draw = 0.08 + nerve * 0.5 + fight * 0.28 + guts * 0.22;
      const d = playerDist(n);
      if (d < 3) draw -= 0.28;                 // a gun in your face is sobering
      else if (d > 9) draw += 0.10;            // room to chance it at distance
      if (!lethal) draw += 0.18;               // you're only holding a taser
      if (gangNearby(n)) draw += 0.10;         // backup emboldens
      draw = Math.max(0, Math.min(0.92, draw));
    }

    if (n.hasGun && rng() < draw) {
      n.intimidMode = "draw";
      n.intimidDrawT = 0.4 + rng() * 0.3;
      n.poseHandsUp = false; n.poseAimBack = false;
      if (CBZ.npcEmote) CBZ.npcEmote(n, "");
    } else {
      n.intimidMode = "scared";
      n.poseHandsUp = true; n.poseAimBack = false;
      if (CBZ.npcEmote) CBZ.npcEmote(n, "");
      // NO POPUP HERE. The hands going up is the report, and `Rob <name>` is
      // armed on him a few lines below for exactly as long as it is true.
      // See the block at the top of this file.
    }
  }

  // an armed inmate squeezes off a return shot at the player.
  function npcFire(n) {
    const g = n.group.position;
    const fy = n.group.rotation.y;
    const from = { x: g.x + Math.sin(fy) * 0.5, y: 1.55, z: g.z + Math.cos(fy) * 0.5 };
    const pp = CBZ.player.pos;
    const to = { x: pp.x, y: 1.4, z: pp.z };
    CBZ.tracer && CBZ.tracer(from, to, { color: 0xffd24a, life: 0.07, muzzleScale: 1.1 });
    CBZ.sfx && CBZ.sfx("shoot_pistol");
    if (CBZ.shootPlayer) CBZ.shootPlayer(52, g.x, g.z, {
      heat: 16, shake: 0.62, stun: 0.22,
      haulMsg: "SHOT DOWN — DRAGGED TO YOUR CELL",
      hint: shortName(n) + " shoots back!",
    });
  }

  function endIntimid(n) {
    const wasArmed = n.intimidMode === "draw" || n.intimidMode === "standoff";
    n.intimidMode = null;
    n.intimidT = 0;
    n.poseHandsUp = false;
    n.poseAimBack = false;
    // _drewSayT is deliberately NOT cleared here: this function runs 0.85 s
    // after you look away, and clearing the latch is precisely what let the
    // same man re-shout on every pan.
    // someone who drew on you stays wary and bolts with the gun still out;
    // hands-up folks just go back to their day.
    if (wasArmed && alive(n) && n.aiState !== "fight" && n.aiState !== "snitch") {
      n.aiState = "flee"; n.fleeT = 1.5 + rng() * 1.5;
    }
  }

  let currentTarget = null;
  let robWas = false;

  function tick(dt) {
    if (CBZ.game.mode !== "escape" || CBZ.game.state !== "playing") {
      currentTarget = null;
      return;
    }

    const aiming = !!(CBZ.isAimingWeapon && CBZ.isAimingWeapon());
    const gun = CBZ.currentGun && CBZ.currentGun();
    const lethal = !!(gun && !gun.nonlethal);

    // who is directly in the player's gun sights? (inmates only — guards keep
    // their own hunt behavior.)
    let target = null;
    if (aiming && CBZ.aimedActor) {
      const hit = CBZ.aimedActor(gun ? gun.range : 40);
      if (hit && hit.actor && hit.actor.kind === "inmate" && alive(hit.actor)) target = hit.actor;
    }
    currentTarget = target;

    const npcs = CBZ.npcs || [];
    for (let i = 0; i < npcs.length; i++) {
      const n = npcs[i];
      if (!n || !n.group) continue;
      if (!n._intimidInit) initN(n);

      const aimedHere = (n === target);
      if (aimedHere) n.intimidT = HOLD;            // pin the reaction while pointed at

      if (n.intimidT > 0) {
        if (!alive(n)) { endIntimid(n); continue; }
        if (n.intimidMode == null) decideReaction(n, lethal);

        if (n.intimidMode === "draw") {
          n.intimidDrawT -= dt;
          if (n.intimidDrawT <= 0) {
            n.intimidMode = "standoff";
            n.poseAimBack = true;
            n.intimidFireT = 0.8 + ((n.personality && n.personality.nerve) || 0.5) * 1.7;
            CBZ.sfx && CBZ.sfx("switch");
            // A MAN AIMING BACK IS NOT A CAPTION — reactions.js already poses
            // him aiming at you and the "switch" above is the gun clearing his
            // waistband. But this one is a person ACTING ON YOU, so it keeps a
            // voice: he talks, over his own head, in earshot or not at all.
            //
            // THE COOLDOWN IS THE ANTI-SPAM, and it deliberately does NOT live
            // on the encounter. `endIntimid` wipes the per-encounter flags 0.85 s
            // after you look away, so an encounter-scoped latch let the same man
            // re-shout on every pan — measured at 3 of the 5 popups in a single
            // sweep. This rides run-elapsed instead, so it survives endIntimid
            // and one man is one line per DRAW_SAY_CD seconds no matter how many
            // times you glance at him.
            const now = (CBZ.game && CBZ.game.elapsed) || 0;
            if (now - (n._drewSayT || -1e9) >= DRAW_SAY_CD) {
              n._drewSayT = now;
              if (tellHint("" + shortName(n) + " pulls a gun on you!", 1.5)) {
                sayIt(n, "Back off! Back the fuck off!", 1.6);
              }
            }
          }
        } else if (n.intimidMode === "standoff") {
          if (aimedHere) {
            // you're still pointing at him — he steels himself, then fires
            n.intimidFireT -= dt;
            if (n.intimidFireT <= 0) {
              npcFire(n);
              n.intimidFireT = 1.0 + rng() * 0.7;
            }
          } else {
            // you looked away — he hesitates, regains a little composure
            n.intimidFireT = Math.min(2.0, n.intimidFireT + dt * 0.5);
          }
        }

        n.intimidT -= dt;
        if (n.intimidT <= 0) endIntimid(n);
      }
    }

    /* ---- rob at gunpoint: [G] (or the ROB pill) while aiming at a held-up
       inmate ----
       A SHAKEDOWN IS A TRANSFER, and this one always was — systems/economy.js's
       lootActor moves the cigarettes and items off the man's own loadout, so
       nothing here was ever minting. What it lacked was an ANSWER: robbing
       somebody you already stripped did nothing at all, silently, so the world
       gave you no way to learn that a person is a finite thing.
       It routes through city/take.js now, which DELEGATES straight back to
       lootActor (no second loot path, no duplicated currency) and reports what
       moved — cigs in `units`, and `taken` DOLLARS pinned at zero, because
       there are no dollars in here and pretending otherwise would be the exact
       fiction the block exists to delete. */
    // A shakedown is possible RIGHT NOW — arm the tappable pill for exactly as
    // long as that stays true (the TTL sweep in interactions.js retires it the
    // moment this stops being re-armed, e.g. you lower the gun or he bolts).
    // The pill fires "@prisonRobTarget", never a synthesized "g": this verb is
    // POLLED off CBZ.keys and a synthetic keydown/keyup pair is already over
    // before the next frame reads it.
    if (CBZ.prisonPrompt && canRob(target)) {
      CBZ.prisonPrompt("rob", "@prisonRobTarget", "Rob " + shortName(target), null);
    }

    const robNow = !!(CBZ.keys && CBZ.keys["g"]);
    if (robNow && !robWas) doRob(target);
    robWas = robNow;
  }

  function canRob(t) {
    return !!(t && t.intimidMode === "scared" && alive(t) && playerDist(t) < ROB_RANGE);
  }

  // The one implementation both the [G] key path and the ROB pill run.
  function doRob(target) {
    if (!canRob(target)) return;
    if (CBZ.cityTake && (!CBZ.CONFIG || CBZ.CONFIG.TAKE_IS_TRANSFER !== false)) {
      let r = null;
      try { r = CBZ.cityTake(target, { by: "player", site: "intimidate:gunpoint" }); } catch (e) { r = null; }
      if (!r || (!r.units && (!r.items || !r.items.length))) {
        // NOT a caption: this is the ANSWER to a button the player just
        // pressed, and without it a second shakedown does nothing, silently.
        // It is also the one line here guaranteed to be in earshot — you
        // cannot rob past ROB_RANGE (6.5 m) and prisonSay reaches 16 — so the
        // man you just frisked tells you himself.
        if (tellHint(shortName(target) + " has nothing left — you already took it.", 1.6)) {
          sayIt(target, "I've got nothing — you already took it.", 1.8);
        }
      }
    } else if (!target.looted) {
      if (CBZ.cityTakeLegacy) { try { CBZ.cityTakeLegacy("intimidate:gunpoint"); } catch (e) {} }
      CBZ.econ && CBZ.econ.lootActor && CBZ.econ.lootActor(target); // shows its own loot toast
    }
    target.intimidT = HOLD;                                       // keep them terrified
  }

  // Pill target: acts on whoever is currently under the gun, re-validated.
  CBZ.prisonRobTarget = function () { doRob(currentTarget); };

  const intimidate = {
    // called by ai.js aiThink: returns a move speed (0 = frozen) while this
    // inmate is reacting to the gun, or null to let the normal brain run.
    think: function (n, dt) {
      if (!n.intimidMode) return null;
      const pp = CBZ.player.pos, g = n.group.position;
      const want = Math.atan2(pp.x - g.x, pp.z - g.z);   // turn to face the player
      if (CBZ.lerpAngle) n.group.rotation.y = CBZ.lerpAngle(n.group.rotation.y, want, 1 - Math.pow(0.0006, dt));
      n.target.set(g.x, 0, g.z);                          // hold ground
      return 0;
    },
    target: function () { return currentTarget; },
  };
  CBZ.intimidate = intimidate;

  // ---- ratchet declaration (see CBZ.prisonPromptAudit in interactions.js) ----
  // `was:` now means what it says. Until 2026-08-11 this declared the popup as
  // converted while decideReaction was still firing it every encounter — the
  // census counted a prompt that existed and never noticed the caption beside
  // it. The caption is deleted; the prompt is the only surface.
  (CBZ._prisonPromptSites || (CBZ._prisonPromptSites = [])).push(
    { id: "rob", act: "@prisonRobTarget", was: "… freezes up — [G] to rob" }
  );

  // SENSE before the npc brain (npc.js @22) so think() sees fresh intent.
  CBZ.onUpdate(19, tick);
})();
