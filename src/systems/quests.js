/* ============================================================
   systems/quests.js — favors, reputation, and the "befriend your way
   out" win. Talking to an actor can hand you a task; doing dirty work
   for them (beating someone up, pulling heists, paying tribute) raises
   their reputation toward you. Max it out and ANYONE — inmate, guard,
   even the Warden — will quietly let you walk out the back.

   This routes the menu's [1] Talk action through onTalk().

   SPINE EMPHASIS (PRISON_ARMORY_SPINE, declared in world/gunroom.js). OWNER,
   verbatim: "it's not about getting cigarettes and opening the dumb chests —
   it's getting a keycard which already gets you into a very cool armory room."
   Two of the three favors this file could hand out were beat-somebody-up and
   pull-a-heist; the third was TRIBUTE IN CIGARETTES, i.e. the block's people
   were themselves pointing the player at the noise. Surgical answer, and the
   quest engine below is untouched:
     · a FOURTH favor, "armory", asks for the thing the whole game is about —
       and it obeys contracts.js's binding rule that the generator picks the
       VERB while the WORLD supplies the specifics: it is only ever offered
       when CBZ.armory actually exists and the chain is not already finished,
       so nobody can ask you for something the world cannot answer;
     · the idle-chat slot (the ~40% of talks that produced generic filler)
       becomes STREET INTEL naming the keycard→armory chain, chosen by a stable
       hash of the speaker so the same person always says the same thing — a
       character trait, not a re-rolled die;
     · the tribute favor's own text said "Bring me 8 as tribute." — eight of
       WHAT. That noun has been missing since the file shipped; it is a cig.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const econ = CBZ.econ;
  const g = CBZ.game;
  const FRIEND = 100; // rep needed for a freedom favor
  // gunroom.js owns the default (it loads first); undefined reads as ON.
  const SPINE = !(CBZ.CONFIG && CBZ.CONFIG.PRISON_ARMORY_SPINE === false);

  // ---- the chain, asked of the live world and never cached ----------------
  function armoryOpen() { return !!(CBZ.armory && CBZ.armory.open); }
  function armed() {
    return !!(CBZ.hasAnyWeapon ? CBZ.hasAnyWeapon()
      : (CBZ.weaponInventory && CBZ.weaponInventory.length));
  }
  // never offer a favor the world cannot supply, and never one already served
  function armoryFavorLive() { return SPINE && !!CBZ.armory && !(armoryOpen() && armed()); }

  // stable per-speaker pick — the same inmate always tells you the same thing
  function nameHash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0x7fffffff;
    return h;
  }
  const CHAIN_TALK = [
    "Smokes buy you a nap. A keycard buys you the gun room.",
    "There's a rack of guns behind that red door. All that's between you and it is a card.",
    "Forget the crates. Find the card that opens the armory. That's the only door that changes anything.",
    "Screw walks around with the only key to the cage inside. Think about that.",
  ];
  function chainLine(actor) {
    if (actor.kind === "warden") return "The gun room stays locked. My key, my rules.";
    const nm = (actor.data && actor.data.name) || "someone";
    return CHAIN_TALK[nameHash(nm) % CHAIN_TALK.length];
  }

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
    if (roll < 0.40) {
      return { type: "beat", target: victim, text: `Rough up ${victim} for me.`, reward: 12 };
    } else if (roll < 0.68) {
      const need = 1 + Math.floor(econ.rng() * 2);
      return { type: "steal", need, start: g.stealsDone || 0, text: `Pull off ${need} clean heist${need > 1 ? "s" : ""}.`, reward: 15 };
    } else if (roll < 0.90 && armoryFavorLive()) {
      // THE STAR. Not "fetch me N of something" — the one errand in the block
      // that ends with you holding a gun, which is a change of CATEGORY and
      // the only reward CLAUDE.md's gun-room grammar counts.
      return { type: "armory", text: "Get past the gun-room gate and come back with a piece.", reward: 22 };
    }
    const need = 6 + Math.floor(econ.rng() * 8);
    return { type: "gift", need, text: `Bring me ${need} cigs as tribute.`, reward: 0 };
  }

  function questDone(actor) {
    const q = actor.quest;
    if (!q) return false;
    if (q.type === "beat") return !!g.koLog[q.target];
    if (q.type === "steal") return (g.stealsDone || 0) - q.start >= q.need;
    if (q.type === "gift") return g.cigs >= q.need;
    if (q.type === "armory") return armoryOpen() && armed();
    return false;
  }

  /* ==========================================================================
     THE `Name: "` BUG WAS THIS FILE'S FAULT, NOT THE RENDERER'S

     Every line below used to be assembled as `${actor.data.name}: "${text}"`
     and handed to systems/interact.js's .pi-subtitle — a SPEECH surface whose
     speaker element (.pi-subtitle-speaker) is deliberately screen-reader-only
     because you can see who is standing in front of you. So the name was
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
    if (q.type === "armory") return "You actually did it. There's people in here who'll want to know that.";
    if (q.type === "gift") return "That'll do. You're good for it, I'll say that much.";
    return "Nice work. I don't forget who does what I ask.";
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
      return { ok: true, msg: `Do me a favour. ${actor.quest.text}` };
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

    /* THE TEACHING LINE, and it deliberately lives in the FALLBACK slot. Put
       ahead of the favor roll it would have halved quest assignment; here it
       only ever replaces generic filler, so the block's idle chatter is what
       tells you the game has a spine — and it goes quiet the moment you are
       actually holding the card, because a hint you have already acted on is
       nagging. AT NIGHT IT COMES OUT MORE READILY: the tier is dark, the
       screws are on the far side of a locked grille, and this is the hour men
       in a prison actually say what they are thinking. */
    const nightWhisper = !!(S && S.enabled() && S.is("night"));
    if (SPINE && !g.hasKey && !armoryOpen() && econ.rng() < (nightWhisper ? 0.8 : 0.55)) {
      return { ok: true, msg: chainLine(actor) };
    }
    return econ.talk(actor);
  }

  /* Ratchet: `spineFavors` counts favors that point at the keycard→armory
     chain (may only go UP) and `cigFavors` counts the ones that ask for
     cigarettes (may only go DOWN). `chainLines` is the intel pool — printed
     beside them so "fixing" the ratio by deleting content cannot pass. */
  CBZ.questSpineAudit = function () {
    return {
      spine: SPINE,
      favorTypes: 4,
      spineFavors: armoryFavorLive() ? 1 : 0,
      cigFavors: 1,
      chainLines: CHAIN_TALK.length,
      chainLive: SPINE && !g.hasKey && !armoryOpen(),
      armoryReachable: !!CBZ.armory,
    };
  };

  CBZ.quests = { onTalk, FRIEND };
})();
