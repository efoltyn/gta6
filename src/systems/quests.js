/* ============================================================
   systems/quests.js — what a man asks you to do when you Talk to him.

   2026-09-30: NO MORE CHORE GENERATOR. This file used to roll a die on
   every Talk and invent a job: a random victim pulled off the roster with a
   flavour reason ("ran his mouth about my mother"), "lift two things"
   counted against ANY steal, "bring me 9 smokes" checked against your cig
   balance, and a beat-up checked against a sticky global KO log that could
   already be true before he asked. Three of those and the man hit rep 100
   and Talk ended the run on the spot ("Side gate").

   Now a man only asks for what the yard really has going on with him:
     1. a debt between real people (entities/ai.js prisonContract tabs),
        which ai.js pitches itself;
     2. a named man coming for HIM (someone holding beef against him, or
        squared up on him right now): "put him down first";
     3. a named man HE holds beef against.
   Nothing going on with this man: no job. Completion checks the specific
   thing: that man, put on the floor by you AFTER the ask (or dead).

   Run his favours to the end (rep FRIEND) and he does not open a gate. He
   offers to ride with you (systems/prisonfriends.js: walks with you, runs off
   snitches, swings at whoever is on you), and a friend who rides with you
   will start something with the nearest CO when you ask him (ai.js's
   diversion). The escape is still yours to make.

   NOBODY POINTS YOU AT THE GUN ROOM (owner, 2026-09-28).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const econ = CBZ.econ;
  const g = CBZ.game;
  const FRIEND = 100;       // favours run to the end: he offers to ride with you
  const DIVERT_GAP = 90000; // ms between a friend's diversions

  function nm(a) { return CBZ.actorName ? CBZ.actorName(a) : String((a && a.data && a.data.name) || "him"); }

  // the one thing on his mind, from real state, or null
  function realAsk(actor) {
    const F = CBZ.prisonFavor;
    if (!F) return null;
    const threat = F.threat(actor);
    const target = threat || F.grudge(actor);
    if (!target || target === actor) return null;
    const who = nm(target);
    const text = threat
      ? (econ.rng() < 0.5 ? `${who}'s coming for me. Put him down first.` : `${who} wants me. Get to him first.`)
      : (econ.rng() < 0.5 ? `${who}. Put him on the floor.` : `Me and ${who} got a problem. Put him down.`);
    // the KO log is sticky; clearing his name now means only a knockdown
    // AFTER the ask can close this job
    if (g.koLog && target.data) delete g.koLog[target.data.name];
    return { type: "beat", target, name: target.data.name, text, reward: 12 };
  }

  function questDone(actor) {
    const q = actor.quest;
    if (!q || q.type !== "beat") return false;
    return !!(q.target && q.target.dead) || !!(g.koLog && g.koLog[q.name]);
  }
  // the man left the yard (transferred, escaped) before you got to him
  function questGone(actor) {
    const q = actor.quest;
    return !q || q.type !== "beat" || !q.target || q.target.escaped || !(CBZ.npcs || []).includes(q.target);
  }

  function complete(actor) {
    const q = actor.quest;
    if (q.reward) {
      econ.addCigs(q.reward);
      if (CBZ.pickupNote) CBZ.pickupNote("Cigarettes", { count: q.reward });
    }
    const before = actor.rep || 0;
    actor.rep = before + 34;
    actor.quest = null;
    CBZ.sfx("key");
    // crossing the line: prisonfriends.js sees rep >= FRIEND and he offers
    if (before < FRIEND && actor.rep >= FRIEND) return "I owe you.";
    return "Good.";
  }

  // the [1] Talk handler. Returns { ok, msg } (systems/interact.js's contract)
  function onTalk(actor) {
    actor.rep = actor.rep || 0;

    // A COUNT OUTRANKS A CONVERSATION.
    const S = CBZ.prisonSchedule;
    const counting = !!(S && S.enabled() && (S.is("count") || S.is("secure") || S.is("wake")));
    if (counting && (actor.kind === "guard" || actor.kind === "warden")) return econ.talk(actor);

    // THE FIXER (systems/escapeplan.js): null = nothing to sell you.
    const fixer = CBZ.escapePlan && CBZ.escapePlan.fixerTalk ? CBZ.escapePlan.fixerTalk(actor) : null;
    if (fixer) return fixer;

    // A FRIEND WHO RIDES WITH YOU MAKES NOISE FOR YOU. He walks up on the
    // nearest CO and keeps him busy (ai.js's diversion state).
    if (actor.pfFriend && actor.rep >= FRIEND && !actor.quest && CBZ.prisonFavor &&
        !(actor._divertAt > CBZ.now - DIVERT_GAP) && CBZ.prisonFavor.divert(actor)) {
      actor._divertAt = CBZ.now;
      return { ok: true, msg: "I'll keep him busy. Go." };
    }

    // a job he gave you: done, gone, or still open
    if (actor.quest) {
      if (questDone(actor)) return { ok: true, msg: complete(actor) };
      if (questGone(actor)) { actor.quest = null; return { ok: true, msg: "Forget it. He's gone." }; }
      return { ok: true, msg: actor.quest.text };
    }

    // a real debt he holds (PRISON_CONTRACTS, entities/ai.js). ai.js speaks
    // the pitch itself; returning words here would print a second copy.
    const CT = CBZ.prisonContract;
    if (CT && CT.canOffer(actor)) {
      const c = CT.offer(actor);
      if (c) return { ok: true, msg: "" };
    }
    if (CT && CT.forCreditor(actor) && CT.satisfied(CT.live())) {
      const res = CT.settle(actor);
      if (res && res.ok) return { ok: true, msg: "" };     // he counts it out loud
    }

    // a man does not hand his business to somebody he doesn't know, or hates
    const social = econ.socialRead ? econ.socialRead(actor) : null;
    const trusted = !social || (social.standing !== "enemy" && social.standing !== "sour" && social.standing !== "stranger");
    if (trusted && actor.kind !== "guard" && actor.kind !== "warden") {
      const q = realAsk(actor);
      if (q) { actor.quest = q; return { ok: true, msg: q.text }; }
    }

    // A FRIEND SHARES, AND HE SHARES HIS OWN: off his loadout, once a minute.
    if (social && social.respect >= 34 && !(actor._friendGift > CBZ.now - 60000)) {
      const load = econ.rollLoadout(actor);
      const give = Math.min(load.cigs, 2 + Math.floor(econ.rng() * 4));
      if (give > 0) {
        actor._friendGift = CBZ.now;
        load.cigs -= give;
        econ.addCigs(give);
        if (CBZ.pickupNote) CBZ.pickupNote("Cigarettes", { count: give });
        CBZ.sfx("loot");
        return { ok: true, msg: "Here. Take a few." };
      }
    }

    return econ.talk(actor);
  }

  CBZ.quests = { onTalk, FRIEND };
})();
