"use strict";
/* src/battle/teams.js — NPC War: TRAININGS, the TEAMS table, flags (flagURL).
   Split out of games/battle.html (docs/npcwar/ARCHITECTURE.md). Every
   src/battle file shares ONE script scope: top-level names here are visible
   to the other battle files. Anything that needs the loaded engine runs in
   CBZ.npcwar.onBoot(), in file order, once the armoury is in. */

const TRAININGS = [
  { id: "civ",   label: "UNTRAINED",  role: "civilian", hp: 90 },
  { id: "thug",  label: "STREET",     role: "thug",     hp: 100 },
  { id: "pro",   label: "TRAINED",    role: "guard",    hp: 120 },
  { id: "elite", label: "SOLDIER",    role: "soldier",  hp: 140 },
  { id: "swat",  label: "SWAT",       role: "agent",    hp: 160 },
];
/* THE TWO SLOTS. "red" and "blue" are slot keys (side A, side B) that every
   ledger, the front's protocol and the node tools key on; they are never
   shown. What a side IS (its name, its nation, its flag, its colour) is
   SIDES below, made by battle/core/sides.js from the roster. `color` here is
   the slot's fallback mark for a side that has no nation (an animal side). */
const TEAMS = {
  red:  { id: "red",  name: "", color: 0xff5a3d },
  blue: { id: "blue", name: "", color: 0x3fa8ff },
};
const SLOT_COLOR = { red: 0xff5a3d, blue: 0x3fa8ff };
/* A NATION'S MARK: the ID tape on the arms, the collar, the HUD bar (never
   the helmet). One per nation city/flags.js authors (a front spec brings its own). */
const NATION_MARK = { republic: 0x3f6fd0, kesh: 0xd23a3a, veridia: 0x2f9a55, solara: 0xe8721c, mbeya: 0xd39a1c };
const SIDES = { red: null, blue: null };
/* Recomputed whenever what is on a side can have changed (the war room's
   controls, readMenu, begin). */
function refreshSides(src) {
  const O = src || SET;              // the war room passes its unsaved form
  ["red", "blue"].forEach(function (t) {
    const nation = t === "red" ? O.nationA : O.nationB;
    const S = CBZ.battleSides.make({
      slot: t, roster: t === "red" ? O.redU : O.blueU, n: t === "red" ? O.redN : O.blueN,
      tier: t === "red" ? O.redT : O.blueT, nation: nation,
    });
    let col = SLOT_COLOR[t];
    if (S.army && NATION_MARK[S.nation] != null) col = NATION_MARK[S.nation];
    // two armies of the same nation keep the slot colours, or nobody can tell them apart
    S.color = col;
    SIDES[t] = S;
    TEAMS[t].color = col;
  });
  if (SIDES.red.army && SIDES.blue.army && SIDES.red.nation === SIDES.blue.nation) {
    SIDES.red.color = TEAMS.red.color = SLOT_COLOR.red; SIDES.blue.color = TEAMS.blue.color = SLOT_COLOR.blue;
  }
  // the page's chrome wears the sides' colours (battle.css reads --sc-red/--sc-blue)
  const root = typeof document !== "undefined" && document.documentElement;
  if (root && root.style && root.style.setProperty) {
    ["red", "blue"].forEach(function (t) {
      const c = TEAMS[t].color;
      root.style.setProperty("--sc-" + t, ((c >> 16) & 255) + "," + ((c >> 8) & 255) + "," + (c & 255));
    });
  }
  const vs = CBZ.battleSides.versus(SIDES.red, SIDES.blue);
  TEAMS.red.name = String(vs.a).toUpperCase();
  TEAMS.blue.name = String(vs.b).toUpperCase();
}
refreshSides();
// "40 GORILLAS WIN" / "THE REPUBLIC OF LIBERTY WINS"
function sidePlural(t) {
  return CBZ.battleSides.versus(SIDES.red, SIDES.blue).byNation ? false : SIDES[t].plural;
}
function sideWins(t) { return CBZ.battleSides.wins(TEAMS[t].name, sidePlural(t)); }
const FLAG_URL = {};
/* an ARMY fights under its nation's flag, painted by the game's one flag
   system (city/flags.js, in the armoury). Animals have none. */
function flagURL(t) {
  {
    const S = SIDES[t];
    if (!S || !S.army || !S.nation || !CBZ.flags || !CBZ.flags.dataURL) return "";
    const key = t + ":" + S.nation;
    if (FLAG_URL[key]) return FLAG_URL[key];
    let u = "";
    try { u = CBZ.flags.dataURL(S.nation, 96) || ""; } catch (e) {}
    return (FLAG_URL[key] = u);
  }
}
function flagImg(t) { const u = flagURL(t); return u ? "<img class=\"flagimg\" alt=\"\" src=\"" + u + "\">" : ""; }

/* actor.weapon strings chosen so BOTH consumers read them right:
   actorweapons.js resolves the appearance model, combat_iq.js classifies the
   competence column. "MIXED" and "EVERYTHING" pick per man, seeded. */
