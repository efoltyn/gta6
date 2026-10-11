"use strict";
/* src/battle/arms.js — NPC War: the guns on the menu, the mixed issue, bare hands.
   Split out of games/battle.html (docs/npcwar/ARCHITECTURE.md). Every
   src/battle file shares ONE script scope: top-level names here are visible
   to the other battle files. Anything that needs the loaded engine runs in
   CBZ.npcwar.onBoot(), in file order, once the armoury is in. */

const GUN_NAME = {
  sidearm: "Pistol", shotgun: "Shotgun", carbine: "Carbine", smg: "SMG",
  revolver: "Revolver", deagle: "Desert Eagle", ak47: "AK-47", uzi: "Uzi",
  sniper: "Sniper", lmg: "LMG", taser: "Taser", bazooka: "bazooka", glauncher: "glauncher",
};
const GUN_ORDER = ["ak47", "carbine", "lmg", "smg", "uzi", "shotgun", "sniper",
  "sidearm", "revolver", "deagle", "glauncher", "bazooka", "taser"];
const MIX_RIFLES = ["ak47", "carbine", "lmg", "smg", "shotgun", "sniper"];
/* the men's empty hands are a weapon row too — combat_iq's own melee exchange
   (IQ.melee: close, circle, guard, windup, swing) drives them, so "100 unarmed
   men vs the gorilla" is a supported army and not a special case. Punch damage
   by training: a SWAT officer hits harder than a clerk. */
const PUNCH = { civ: 6, thug: 8, pro: 10, elite: 12, swat: 14 };
const SWIM_PUNCH = Math.max(0, Math.min(1, parseFloat(Q.get("swimpunch") || "0.25")));
