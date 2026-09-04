/* ============================================================
   systems/markers.js — what a prison actor DOES about you when you are
   close, plus the shared cityTargetsPlayer() hostility predicate used by
   map surfaces.

   Hostility is communicated by actor behavior, sound, and the map — never
   by a floating marker over an enemy or predator's head.

   THE ICONS ARE GONE. (OWNER 2026-09-04: "when i try to steal multiple
   times from someone there's an emoji that shows over their head ... no
   emojis over heads, it should be bodily movement, i want npcs more real
   acting.")

   This file used to own three canvas sprites pinned over heads: an orange
   "!" for a screw whose alert was rising, a white "!" disc for a man who had
   told on you (or was on his way to), and a torch for a cop-role tip. A
   failed lift feeds the victim's grudge into detection.js's snitch roll, so
   the second or third time through the same man's pockets sent HIM to the
   guards — and the disc lit over his head. Every state those sprites
   announced is still here; each one is now a thing the man's body does,
   through systems/reactions.js:

     the mark you keep robbing   hand clamped over the pocket, body turned
                                 that side off you, eyes on your hands, and
                                 a step back when you come inside reach
                                 (CBZ.npcGuardPockets / CBZ.npcStepBack)
     a screw getting suspicious  he watches you (CBZ.npcStare); past half
                                 alert his free hand rests on his belt
     a man who told on you       he will not hold your eye — head turned off
                                 you with a sidelong glance every couple of
                                 seconds, and he backs off when you close
                                 (CBZ.npcAvert / CBZ.npcStepBack)
     a man worth a stop (cop)    the same shifty avert
     a man with an offer         he looks at you for the whole walk-up
                                 (unchanged from the previous wave)

   Range is the actor's, not a HUD's: no facing cone, no LOS raycast, no
   fade. A man notices you whether or not you are looking at him.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;

  function hunting(a) {
    return (a.hunt > 0 || a.huntPlayer > 0) && !a.dead && !(a.ko > 0) && !a.escaped;
  }

  // One binary fact for every tactical surface: is this LIVE actor currently
  // committed to harming/capturing the player? Cops, gangs, terrorists,
  // soldiers and predators all publish through their real brain state; map UI
  // no longer guesses from costume ("all cops red") or weapon alone.
  function cityTargetsPlayer(a) {
    if (!a || a.dead || (a.ko || 0) > 0 || a.escaped) return false;
    const pa = CBZ.city && CBZ.city.playerActor;
    if (a.animal) return a.state === "charge" || a.state === "stalk" || a.attackPlayer === true || a.targetPlayer === true || a.target === pa;
    if (a.curTarget === pa || a.npcTarget === pa || a.rage === pa || a.target === pa || a.targetActor === pa || a._aimTgt === pa) return true;
    if (a.huntPlayer > 0 || a.attackPlayer === true || a.targetPlayer === true) return true;
    // Some faction brains store the literal player record instead of the city
    // adapter.  Accept those explicit pointers, but never infer hostility just
    // because an actor is armed or belongs to an organization.
    if (a.curTarget === CBZ.player || a.rage === CBZ.player || a.target === CBZ.player || a.targetActor === CBZ.player) return true;
    return false;
  }
  CBZ.cityTargetsPlayer = cityTargetsPlayer;

  function guardish(a) {
    return !!(a && (a.wedge || a.kind === "guard" || a.kind === "warden"));
  }

  const NOTICE = 7.0, NOTICE2 = NOTICE * NOTICE;   // a man clocks you from here
  const REACH = 3.2;                               // inside this the mark covers his pocket
  const CLOSE = 2.8;                               // inside this a man who wants none of you steps off
  const POCKETS = "you going through my pockets";  // economy.js's grudgeWhy for a lift

  function tick(dt) {
    // City hostility stays physical and diegetic through its own tells;
    // cityTargetsPlayer() remains available to maps.
    if (CBZ.game && CBZ.game.mode === "city") return;
    const p = CBZ.player && CBZ.player.pos;
    const cop = CBZ.game && CBZ.game.role === "cop";
    const all = CBZ.guards.concat(CBZ.npcs);
    for (const a of all) {
      if (!a) continue;
      // the wedge is not a marker: it belongs to the torch, and a guard 50 m
      // away must still show his beam.
      if (guardish(a) && a.wedge) a.wedge.visible = !!a.flashlightOn;
      if (!p || !a.group || a.dead || (a.ko || 0) > 0 || a.escaped) continue;
      const dx = a.group.position.x - p.x, dz = a.group.position.z - p.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > NOTICE2) continue;
      // A HUNT IS THE THREAT. A man running you down is already doing the
      // most legible thing a body can do; nothing here should soften it.
      if (hunting(a)) continue;
      const d = Math.sqrt(d2);

      // the mark you keep robbing (economy.js set his grudgeWhy on the lift)
      if (a.grudgeWhy === POCKETS && (a.playerGrudge || 0) >= 1.5 && d < REACH) {
        if (CBZ.npcGuardPockets) CBZ.npcGuardPockets(a, 0.5);
        if (d < CLOSE && CBZ.npcStepBack) CBZ.npcStepBack(a);
        continue;
      }
      // a screw getting suspicious
      if (guardish(a)) {
        if ((a.alert || 0) > 0.15) {
          if ((a.alert || 0) > 0.45 && !a.flashlightOn && CBZ.npcGuardPockets) CBZ.npcGuardPockets(a, 0.5);
          else if (CBZ.npcStare) CBZ.npcStare(a, 0.6);
        }
        continue;
      }
      // a man who told on you, is on his way to, or is worth a stop
      const shifty = a.aiState === "snitch" || (a.reportedPlayerT || 0) > 0 || (cop && a.copMarked > 0);
      if (shifty) {
        if (CBZ.npcAvert) CBZ.npcAvert(a, 0.6);
        if (d < CLOSE && CBZ.npcStepBack) CBZ.npcStepBack(a);
        continue;
      }
      // a man with an offer looks at you for the whole walk-up
      if (a.approach && a.approach.t > 0 && CBZ.npcStare) CBZ.npcStare(a, 0.6);
    }
  }

  CBZ.onAlways(60, tick);
})();
