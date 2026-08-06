/* ============================================================
   systems/quests.js — favors and reputation. Talking to an actor can hand
   you a task; doing dirty work for them (beating someone up, pulling heists,
   paying tribute) raises their reputation toward you and pays in cigs.

   This routes the menu's Talk action through onTalk().

   BEFRIEND IS GONE (2026-08-06). OWNER: "remove befriend that's not a thing
   remove that completely from the game." The verb, its "♥ rep" chip, its
   "FRIEND - Befriend to walk free" HUD line and the rep-100 `winGame(
   "befriend")` it existed to reach are all deleted — you did not make a
   friend, you ran errands until a number hit 100 and a side gate opened,
   which is exactly the fake-mechanic shape the complaint names. What is left
   is the part that was always real: people ask you for things, you do them,
   they pay you, and the block's intel points at the keycard→armory spine.
   Rep still accumulates and still gates who talks straight to you; it is no
   longer a win condition and is no longer printed at the player.

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
  const FRIEND = 100; // rep at which an actor stops holding anything back
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
    "Forget the crates. Find the card that opens the armory — that's the only door that changes anything.",
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

    if (roll < 0.40) {
      return { type: "beat", target: victim, text: `Rough up ${victim} for me.`, reward: 8 };
    } else if (roll < 0.68) {
      const need = 1 + Math.floor(econ.rng() * 2);
      return { type: "steal", need, start: g.stealsDone || 0, text: `Pull off ${need} clean heist${need > 1 ? "s" : ""}.`, reward: 10 };
    } else if (roll < 0.90 && armoryFavorLive()) {
      // THE STAR. Not "fetch me N of something" — the one errand in the block
      // that ends with you holding a gun, which is a change of CATEGORY and
      // the only reward CLAUDE.md's gun-room grammar counts.
      return { type: "armory", text: "Get past the gun-room gate and come back with a piece.", reward: 14 };
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

  function complete(actor) {
    const q = actor.quest;
    if (q.type === "gift") econ.addCigs(-q.need);          // tribute is consumed
    if (q.reward) econ.addCigs(q.reward);
    actor.rep = (actor.rep || 0) + 34;
    actor.quest = null;
    CBZ.sfx("key");
    if (actor.rep >= FRIEND) return `${actor.data.name}: "You're alright. Anything you need in here, you ask me first."`;
    return `${actor.data.name}: "Nice work."${q.reward ? ` (+${q.reward} cigs)` : ""}`;
  }

  // the Talk handler
  function onTalk(actor) {
    actor.rep = actor.rep || 0;

    // active quest: report progress or complete it
    if (actor.quest) {
      if (questDone(actor)) return { ok: true, msg: complete(actor) };
      return { ok: true, msg: `${actor.data.name}: "${actor.quest.text}"` };
    }

    // sometimes hand out a new task, otherwise just chat
    if (econ.rng() < 0.6) {
      actor.quest = assignQuest(actor);
      return { ok: true, msg: `${actor.data.name}: "Do me a favor — ${actor.quest.text}"` };
    }
    /* THE TEACHING LINE, and it deliberately lives in the FALLBACK slot. Put
       ahead of the favor roll it would have halved quest assignment; here it
       only ever replaces generic filler, so the block's idle chatter is what
       tells you the game has a spine — and it goes quiet the moment you are
       actually holding the card, because a hint you have already acted on is
       nagging. */
    if (SPINE && !g.hasKey && !armoryOpen() && econ.rng() < 0.55) {
      return { ok: true, msg: `${actor.data.name}: "${chainLine(actor)}"` };
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
