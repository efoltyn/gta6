/* ============================================================
   systems/quests.js — favors, reputation, and the "befriend your way
   out" win. Talking to an actor can hand you a task; doing dirty work
   for them (beating someone up, pulling heists, paying tribute) raises
   their reputation toward you. Max it out and ANYONE — inmate, guard,
   even the Warden — will quietly let you walk out the back.

   This routes the menu's [1] Talk action through onTalk().
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

    if (roll < 0.45) {
      return { type: "beat", target: victim, text: `Rough up ${victim} for me.`, reward: 8 };
    } else if (roll < 0.75) {
      const need = 1 + Math.floor(econ.rng() * 2);
      return { type: "steal", need, start: g.stealsDone || 0, text: `Pull off ${need} clean heist${need > 1 ? "s" : ""}.`, reward: 10 };
    }
    const need = 6 + Math.floor(econ.rng() * 8);
    return { type: "gift", need, text: `Bring me ${need} 🚬 as tribute.`, reward: 0 };
  }

  function questDone(actor) {
    const q = actor.quest;
    if (!q) return false;
    if (q.type === "beat") return !!g.koLog[q.target];
    if (q.type === "steal") return (g.stealsDone || 0) - q.start >= q.need;
    if (q.type === "gift") return g.cigs >= q.need;
    return false;
  }

  function complete(actor) {
    const q = actor.quest;
    if (q.type === "gift") econ.addCigs(-q.need);          // tribute is consumed
    if (q.reward) econ.addCigs(q.reward);
    actor.rep = (actor.rep || 0) + 34;
    actor.quest = null;
    CBZ.sfx("key");
    if (actor.rep >= FRIEND) return `${actor.data.name} grins: "You're alright. Come find me — I'll get you out."`;
    return `${actor.data.name}: "Nice work." (+34 rep${q.reward ? ", +" + q.reward + " 🚬" : ""})`;
  }

  // the [1] Talk handler
  function onTalk(actor) {
    actor.rep = actor.rep || 0;

    // befriended enough? they spring you — alternative victory.
    if (actor.rep >= FRIEND) {
      CBZ.winGame("befriend", actor);
      return { ok: true, msg: `${actor.data.name} slips you out a side gate. You're free!` };
    }

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
    return econ.talk(actor);
  }

  CBZ.quests = { onTalk, FRIEND };
})();
