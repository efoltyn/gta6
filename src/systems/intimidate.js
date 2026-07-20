/* ============================================================
   systems/intimidate.js — CBZ.intimidate

   "Logic in the NPCs": when the player POINTS A GUN at an inmate,
   the inmate reacts to the threat instead of carrying on with its
   day. Two outcomes, decided once per encounter from the inmate's
   stats + the situation:

     • SCARED  — unarmed or low-nerve inmates throw their HANDS UP:
                 they freeze, hunch, go wide-eyed and terrified
                 (posed by systems/reactions.js). While they're held
                 up you can ROB them at gunpoint ([G] to shake them
                 down — a one-time full frisk).

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
      if (!n._reactHinted) {
        n._reactHinted = true;
        CBZ.flashHint && CBZ.flashHint("" + shortName(n) + " freezes up — [G] to rob", 1.7);
      }
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

    // ---- rob at gunpoint: [G] while aiming at a held-up inmate ----
    const robNow = !!(CBZ.keys && CBZ.keys["g"]);
    if (robNow && !robWas && target && target.intimidMode === "scared" &&
        !target.looted && playerDist(target) < ROB_RANGE) {
      CBZ.econ && CBZ.econ.lootActor && CBZ.econ.lootActor(target); // shows its own loot toast
      target.intimidT = HOLD;                                       // keep them terrified
    }
    robWas = robNow;
  }

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

  // SENSE before the npc brain (npc.js @22) so think() sees fresh intent.
  CBZ.onUpdate(19, tick);
})();
