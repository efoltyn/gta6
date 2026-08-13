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

  const HOLD = 0.85;        // how long a reaction lingers after you look away
  const ROB_RANGE = 6.5;    // max distance to shake someone down

  // PRISON_TOUCH_PROMPTS (declared in systems/interactions.js): "[G] to rob"
  // names a key a touch player does not have. The CUE loses the glyph on touch
  // and a real ROB pill is armed for as long as the shakedown is actually
  // possible — see the tick loop. Desktop and flag-off are unchanged.
  const PTP = () => !CBZ.CONFIG || CBZ.CONFIG.PRISON_TOUCH_PROMPTS !== false;
  const onTouch = () => !!(CBZ.touchMode ||
    (document.body && document.body.classList.contains("touch")));
  const robCue = () => (PTP() && onTouch() ? "rob him" : "[G] to rob");

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
    if (n.char) n.char.handsUp = false;   // a recycled rig must not start overhead
    n._reactHinted = false;
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

    /* HOW OFTEN A MAN CHANCES IT.
       OWNER, 2026-08-13: "i hold a gun at you far away you raise your hands or
       charge at me or run away USUALLY RAISE HANDS."

       The old curve did the opposite. Baseline at average stats (nerve .5,
       fighting 40, guts .4) was 0.53 — already a coin flip — and then the
       distance term ADDED ten points beyond 9 m, exactly where the owner wants
       surrender. With a taser and a crewmate nearby it reached the 0.92 cap.
       Pointing a gun across the yard drew a weapon on you roughly one time in
       five, which is what "overridden by how aggressive other inmates are"
       felt like.

       Two changes, and only two:
         · the baseline is halved, so a drawn gun is a thing a hard man does,
           not the median response;
         · the distance term FLIPS. Range is now what makes a man comply — he
           has time to see the muzzle, and nothing to gain by racing it. Close
           quarters is where chancing it starts to make sense, because at
           arm's length a grab is a real option and the shot is not.
       The modifiers that were already reading right (taser, backup) stand. */
    let draw = 0;
    if (n.hasGun) {
      draw = 0.04 + nerve * 0.26 + fight * 0.15 + guts * 0.12;
      const d = playerDist(n);
      if (d < 2.5) draw += 0.14;               // close enough to grab the barrel
      else if (d > 9) draw -= 0.16;            // he has time to think, and does
      if (!lethal) draw += 0.18;               // you're only holding a taser
      if (gangNearby(n)) draw += 0.10;         // backup emboldens
      draw = Math.max(0, Math.min(0.72, draw));
    }

    if (n.hasGun && rng() < draw) {
      n.intimidMode = "draw";
      n.intimidDrawT = 0.4 + rng() * 0.3;
      n.poseHandsUp = false; n.poseAimBack = false;
      if (CBZ.npcEmote) CBZ.npcEmote(n, "");
    } else {
      n.intimidMode = "scared";
      n.poseHandsUp = true; n.poseAimBack = false;
      // ONE ARM DRIVER. `poseHandsUp` is read only by systems/reactions.js,
      // which poses arms by ADDING a damped offset and backing that offset out
      // again at the top of the next frame — so the surrender restarted from
      // the idle base every frame and could never converge, while
      // entities/character.js kept damping the same arms toward the walk/idle
      // target (~-0.34, at the sides). Two drivers, neither winning: hands
      // hovering by the hips, twitching with the gait.
      //
      // character.js already solved this and the prison simply never opted in.
      // `ch.handsUp` does three things at once there: the idle counter-swing
      // branch (line ~2276) stops writing the arms, the late surrender layer
      // (line ~2786) damps them to -2.60 with the elbow/splay detail, and
      // reactions.js's own `animOwnsArms` guard sees the flag and skips its
      // additive write. Setting it makes character.js the sole arm driver,
      // which is what its comment there says the pose needs.
      if (n.char) n.char.handsUp = true;
      // NO POPUP. The pose above IS the message — hands overhead, frozen,
      // facing you. "X freezes up" captioned a body the player is looking at.
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
    // hand the arms back to the idle animator, or he keeps them overhead for
    // the rest of the run (character.js owns them for as long as this is set).
    if (n.char) n.char.handsUp = false;
    n._reactHinted = false;
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
            CBZ.flashHint && CBZ.flashHint("" + shortName(n) + " pulls a gun on you!", 1.5);
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
    // NO PILL. A shakedown used to raise its own button the moment the man
    // froze, which is the same fourth-wall break as the popup that sat beside
    // it: a new control appearing to announce a state the player can see. The
    // verb now lives where every other thing you can do to a person lives —
    // systems/interact.js's option panel, which already reskins itself for
    // seventeen kinds of approach and simply gained one more (a man at
    // gunpoint). That panel is deliberately short-ranged, so the verbs arrive
    // when you have WALKED UP to him, while the hands-up pose carries the read
    // from across the yard. [G] stays as a hotkey for anyone who wants it.
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
        CBZ.flashHint && CBZ.flashHint(shortName(target) + " has nothing left — you already took it.", 1.6);
      }
    } else if (!target.looted) {
      if (CBZ.cityTakeLegacy) { try { CBZ.cityTakeLegacy("intimidate:gunpoint"); } catch (e) {} }
      CBZ.econ && CBZ.econ.lootActor && CBZ.econ.lootActor(target); // shows its own loot toast
    }
    target.intimidT = HOLD;                                       // keep them terrified
  }

  // The interact panel dispatches here. It passes the actor its own row is
  // about; the argument is honoured so the panel and the shakedown can never
  // act on two different men, and falls back to whoever is under the gun for
  // the [G] hotkey, which has no actor of its own. doRob re-validates either
  // way, so a stale panel row cannot rob somebody who already put his hands
  // down.
  CBZ.prisonRobTarget = function (who) { doRob(who || currentTarget); };

  // "Let him go" — lower the gun on this one man. Ends the hold immediately
  // rather than waiting out HOLD, so choosing to release reads as a decision
  // instead of as the player drifting out of range.
  CBZ.intimidateRelease = function (who) {
    const t = who || currentTarget;
    if (t && t.intimidMode) endIntimid(t);
  };

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

  // The "rob" prompt site is GONE, not muted — the verb moved into the
  // interact panel's own option list (systems/interact.js verbsFor), so there
  // is no prompt left for CBZ.prisonPromptAudit to count. CBZ.prisonRobTarget
  // stays exported because the panel dispatches through it.

  // SENSE before the npc brain (npc.js @22) so think() sees fresh intent.
  CBZ.onUpdate(19, tick);
})();
