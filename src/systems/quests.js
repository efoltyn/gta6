/* ============================================================
   systems/quests.js — favors, reputation, and the "befriend your way
   out" win. Talking to an actor can hand you a task; doing dirty work
   for them (beating someone up, pulling heists, paying tribute) raises
   their reputation toward you. Max it out and ANYONE — inmate, guard,
   even the Warden — will quietly let you walk out the back.

   This routes the menu's [1] Talk action through onTalk().

   NOBODY POINTS YOU AT THE GUN ROOM (owner, 2026-09-28: "Nobody should ever
   tell you to go in the gun room. That should be something you figure out
   on your own. Nothing should tell you that."). This file used to fill
   55-80% of idle talks with a "street intel" line naming the keycard and
   armory chain, and one favour in five was "get past the gun-room gate".
   Both are deleted. The favours left are things a man in a yard actually
   wants done for himself: somebody hurt, something lifted, smokes paid.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const econ = CBZ.econ;
  const g = CBZ.game;
  const FRIEND = 100; // rep needed for a freedom favor
  function allNames() {
    const list = [];
    for (const n of CBZ.npcs) list.push(n.data.name);
    for (const gd of CBZ.guards) if (gd.data) list.push(gd.data.name);
    return list;
  }

  // assemble a task for this actor
  function assignQuest(actor) {
    const roll = econ.rng();
    // pick a victim that isn't the quest-giver — cops and the warden are fair game
    const names = allNames().filter((nm) => nm !== actor.data.name);
    const victim = names[Math.floor(econ.rng() * names.length)] || "anyone";

    /* THE REWARDS WENT UP BECAUSE THE FLOOR WENT AWAY.
       entities/coins.js used to scatter 153 cigarettes across the compound in
       nineteen packs — the yard, the lounge, the south block, and three stacks
       inside the armoury — and the owner's rule is that cigarettes are EARNED,
       not collected off the ground like coins. Killing that spawn removes the
       game's largest single income, so it comes back through the three seams
       where it belongs: what a favour pays (here), what a man is actually
       carrying (economy.js's loadouts), and what a friend hands you
       (onTalk below). Same magnitudes — a favour still costs less than a
       Gun-Room Key and more than a bribe — so nothing in the price list moves. */
    // Every ask carries its reason, the way a man says it. The reason is
    // flavour only; the job is the same.
    const why = (list) => list[Math.floor(econ.rng() * list.length)];
    if (roll < 0.45) {
      const t = why([
        `${victim} owes me. Put him on the floor.`,
        `${victim} ran his mouth about my mother. Handle it.`,
        `Put ${victim} on the floor. He knows why.`,
        `${victim} took my spot at chow. Twice.`,
      ]);
      return { type: "beat", target: victim, text: t, reward: 12 };
    } else if (roll < 0.75) {
      const need = 1 + Math.floor(econ.rng() * 2);
      return { type: "steal", need, start: g.stealsDone || 0, text: need > 1 ? `Lift ${need} things. Don't get caught.` : why(["Lift something. Don't get caught.", "Bring me something off somebody. Anybody."]), reward: 15 };
    }
    const need = 6 + Math.floor(econ.rng() * 8);
    return { type: "gift", need, text: why([`Bring me ${need} smokes.`, `I'm short ${need} smokes. You're not.`]), reward: 0 };
  }

  function questDone(actor) {
    const q = actor.quest;
    if (!q) return false;
    if (q.type === "beat") return !!g.koLog[q.target];
    if (q.type === "steal") return (g.stealsDone || 0) - q.start >= q.need;
    if (q.type === "gift") return g.cigs >= q.need;
    return false;
  }

  /* ==========================================================================
     THE `Name: "` BUG WAS THIS FILE'S FAULT, NOT THE RENDERER'S

     Every line below used to be assembled as `${actor.data.name}: "${text}"`
     and handed to the old .pi-subtitle band (since deleted: every line now
     floats over the speaker's head, systems/speech.js), whose speaker element
     was screen-reader-only because you can see who is in front of you. So the name was
     printed twice (once invisibly, once with a colon stapled to the sentence)
     and interact.js:517's `String(msg).replace(/^[“"]|[”"]$/g, "")` then ate
     the CLOSING quote — its leading alternative can never match a string that
     starts with a name — leaving:

         Marcus: "Rough up Officer #3 for me.

     Fixed at BOTH ends and only one of them is the bug. Here: a spoken line is
     the words and nothing else — no name, no colon, no quotation marks, and no
     reward arithmetic ("+34 rep, +8 cigs") in a sentence a human being says.
     What the favour paid is shown by the pickup feed and the cig counter, the
     way every other payment in this game is shown.
     ========================================================================== */
  function complete(actor) {
    const q = actor.quest;
    if (q.type === "gift") econ.addCigs(-q.need);          // tribute is consumed
    if (q.reward) {
      econ.addCigs(q.reward);
      // the payment is a payment: one row in the corner feed, same as a lift
      if (CBZ.pickupNote) CBZ.pickupNote("Cigarettes", { count: q.reward });
    }
    actor.rep = (actor.rep || 0) + 34;
    actor.quest = null;
    CBZ.sfx("key");
    if (actor.rep >= FRIEND) return "You're alright. Come find me. I'll get you out of here.";
    if (q.type === "gift") return "That'll do.";
    return "Good. I won't forget it.";
  }

  // the [1] Talk handler
  function onTalk(actor) {
    actor.rep = actor.rep || 0;

    // A COUNT OUTRANKS A CONVERSATION. CBZ.prisonSchedule (systems/
    // prisonschedule.js) is the one clock; a screw standing on a number is not
    // taking your favour, and econ.talk already owns what he says about it.
    const S = CBZ.prisonSchedule;
    const counting = !!(S && S.enabled() && (S.is("count") || S.is("secure") || S.is("wake")));
    if (counting && (actor.kind === "guard" || actor.kind === "warden")) return econ.talk(actor);

    // THE FIXER. The Old Timer sells what your escape plan is missing (a
    // staff card, a hacksaw blade) for cigs you earned doing the favours
    // below. systems/escapeplan.js owns the stock and the prices; a null
    // answer means he has nothing you need and is his usual self.
    const fixer = CBZ.escapePlan && CBZ.escapePlan.fixerTalk ? CBZ.escapePlan.fixerTalk(actor) : null;
    if (fixer) return fixer;

    // befriended enough? they spring you — alternative victory.
    if (actor.rep >= FRIEND) {
      CBZ.winGame("befriend", actor);
      return { ok: true, msg: "Side gate. Walk, don't run, and don't look back at me." };
    }

    // active quest: report progress or complete it
    if (actor.quest) {
      if (questDone(actor)) return { ok: true, msg: complete(actor) };
      return { ok: true, msg: actor.quest.text };
    }

    /* WHAT'S ACTUALLY ON HIS MIND (PRISON_CONTRACTS, entities/ai.js).

       This file's favours are INVENTED — "rough up somebody, pull two heists,
       bring me eight cigs" — assembled from a die and a name plucked out of
       the roster, and the man asking has no relationship with the victim at
       all. A tab is the opposite: it already exists, it has an amount, a
       reason and a date, and the person it is against is somebody he has
       actually been standing next to in this yard.

       So when a man holding a sour claim gets asked what he needs, that is
       what he says — ahead of the generated favour, because it is the truer
       answer to the same question. He pitches it through the same approach
       machinery every other offer in this prison uses (so it STANDS if you
       walk off, and so the words come out of his mouth rather than the HUD),
       and the card re-renders into TAKE IT / HAGGLE / WALK next frame.

       Flag off, or an ai.js without the layer: this block does not exist and
       the favour roll below is the whole of onTalk exactly as it shipped. */
    const CT = CBZ.prisonContract;
    if (CT && CT.canOffer(actor)) {
      // ai.js's offer() speaks the pitch itself and marks the approach greeted
      // (autoListen cannot: the card is already open on this man, so `current`
      // never changes). Returning the words here would print a second copy.
      const c = CT.offer(actor);
      if (c) return { ok: true, msg: "" };
    }
    // He sent you, you went, you came back holding it. Talk is the ordinary
    // way to close a job with a man, and it should not need its own button on
    // a card that already has one — the button exists for the touch rail's
    // sake, and this is the same transaction reachable the same way as always.
    if (CT && CT.forCreditor(actor) && CT.satisfied(CT.live())) {
      const res = CT.settle(actor);
      if (res && res.ok) return { ok: true, msg: "" };     // he counts it out loud
    }

    /* RESPECT DECIDES WHETHER YOU ARE EVEN ASKED. A man does not hand his dirty
       work to somebody he met a minute ago, and he does not hand it to somebody
       who has picked his pocket. econ's respect ledger (a.rep, the same number
       this file has always paid into) now gates the offer instead of a flat
       60% die: strangers get chatter, regulars get favours, enemies get
       nothing. Absent econ.socialRead (a mode without it), the old flat roll. */
    const social = CBZ.econ.socialRead ? CBZ.econ.socialRead(actor) : null;
    let offerOdds = 0.6;
    if (social) {
      if (social.standing === "enemy") offerOdds = 0;
      else if (social.standing === "sour") offerOdds = 0.18;
      else if (social.standing === "stranger") offerOdds = 0.42;
      else if (social.standing === "known") offerOdds = 0.68;
      else offerOdds = 0.82;                       // solid — they come to you
      // a favour is business, and business happens in the yard or after dark
      if (S && S.enabled()) {
        if (S.is("yard") || S.is("work")) offerOdds += 0.10;
        else if (S.is("night")) offerOdds += 0.06;
      }
    }
    if (econ.rng() < offerOdds) {
      actor.quest = assignQuest(actor);
      return { ok: true, msg: actor.quest.text };
    }

    /* A FRIEND SHARES, AND HE SHARES HIS OWN. Ground cigarettes are gone from
       this prison (entities/coins.js) because currency you find on a floor is
       not currency. This is one of the seams the income moved into, and it is
       an honest one: the smokes come OFF HIS LOADOUT, so a man with empty
       pockets is generous with nothing, and he can only do it once in a while. */
    if (social && social.respect >= 34 && !(actor._friendGift > CBZ.now - 60000)) {
      const load = CBZ.econ.rollLoadout(actor);
      const give = Math.min(load.cigs, 2 + Math.floor(econ.rng() * 4));
      if (give > 0) {
        actor._friendGift = CBZ.now;
        load.cigs -= give;
        econ.addCigs(give);
        if (CBZ.pickupNote) CBZ.pickupNote("Cigarettes", { count: give });
        CBZ.sfx("loot");
        return { ok: true, msg: "Take these. You'll need them more than me." };
      }
    }

    return econ.talk(actor);
  }

  CBZ.quests = { onTalk, FRIEND };
})();
