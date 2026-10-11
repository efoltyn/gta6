"use strict";
/* src/battle/teams.js — NPC War: TRAININGS, the TEAMS table, flags (drawFlag / flagURL).
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
/* A NATION'S MARK: the bright band on the helmet cover, the collar, the HUD
   bar. One per nation city/flags.js authors (a front spec brings its own). */
const NATION_MARK = { republic: 0x3f6fd0, kesh: 0xd23a3a, veridia: 0x2f9a55, solara: 0xe8721c, mbeya: 0xd39a1c };
const SIDES = { red: null, blue: null };
/* Recomputed whenever what is on a side can have changed (the war room's
   controls, readMenu, begin). AT THE FRONT A SIDE IS A NATION: its name and
   the colour its helmet covers and smoke carry come from the front spec. */
function refreshSides(src) {
  const O = src || SET;              // the war room passes its unsaved form
  ["red", "blue"].forEach(function (t) {
    const nation = FRONT ? (FRONT[t].id || null) : (t === "red" ? O.nationA : O.nationB);
    const S = CBZ.battleSides.make({
      slot: t, roster: t === "red" ? O.redU : O.blueU, n: t === "red" ? O.redN : O.blueN,
      tier: t === "red" ? O.redT : O.blueT, nation: nation,
    });
    if (FRONT) { S.title = String(FRONT[t].name || S.title || ""); S.army = true; }
    let col = SLOT_COLOR[t];
    if (FRONT && isFinite(FRONT[t].mark)) col = FRONT[t].mark;
    else if (S.army && NATION_MARK[S.nation] != null) col = NATION_MARK[S.nation];
    // two armies of the same nation keep the slot colours, or nobody can tell them apart
    S.color = col;
    SIDES[t] = S;
    TEAMS[t].color = col;
  });
  if (!FRONT && SIDES.red.army && SIDES.blue.army && SIDES.red.nation === SIDES.blue.nation) {
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
  TEAMS.red.name = FRONT ? SIDES.red.title.toUpperCase() : String(vs.a).toUpperCase();
  TEAMS.blue.name = FRONT ? SIDES.blue.title.toUpperCase() : String(vs.b).toUpperCase();
}
refreshSides();
// "40 GORILLAS WIN" / "THE REPUBLIC OF LIBERTY WINS"
function sidePlural(t) {
  return FRONT ? false : CBZ.battleSides.versus(SIDES.red, SIDES.blue).byNation ? false : SIDES[t].plural;
}
function sideWins(t) { return CBZ.battleSides.wins(TEAMS[t].name, sidePlural(t)); }
/* A NATION'S FLAG, painted from its row (city/frontline.js LOOK). The
   republic's is the one over the capital (city/president_public.js). */
function drawFlag(c, F, w, h) {
  F = F || { kind: "stripes", stripes: ["#555", "#999", "#555"] };
  const star = function (x, y, R, r) {
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r : R;
      c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    c.closePath(); c.fill();
  };
  c.fillStyle = F.field || "#444"; c.fillRect(0, 0, w, h);
  if (F.kind === "band") {
    c.fillStyle = F.band; c.fillRect(0, h * 0.36, w, h * 0.28);
    c.fillStyle = F.stripe; c.fillRect(0, h * 0.44, w, h * 0.12);
    if (F.star) { c.fillStyle = F.star; star(w * 0.2, h * 0.2, h * 0.107, h * 0.048); }
  } else if (F.kind === "cross") {
    c.fillStyle = F.cross; c.fillRect(w * 0.28, 0, w * 0.14, h); c.fillRect(0, h * 0.42, w, h * 0.16);
  } else if (F.kind === "tri") {
    c.fillStyle = F.band; c.fillRect(0, h * 0.4, w, h * 0.2);
    c.fillStyle = F.tri; c.beginPath(); c.moveTo(0, 0); c.lineTo(w * 0.38, h / 2); c.lineTo(0, h); c.closePath(); c.fill();
  } else if (F.kind === "sun") {
    c.fillStyle = F.disc; c.beginPath(); c.arc(w * 0.5, h * 0.5, h * 0.26, 0, Math.PI * 2); c.fill();
  } else {
    const st = F.stripes || [];
    for (let i = 0; i < st.length; i++) { c.fillStyle = st[i]; c.fillRect(0, h * i / st.length, w, h / st.length + 1); }
  }
}
const FLAG_URL = {};
function flagURL(t) {
  if (!FRONT || !FRONT[t]) {
    // an ARMY in the war room fights under its nation's flag, painted by the
    // game's one flag system (city/flags.js, in the armoury). Animals have none.
    const S = SIDES[t];
    if (!S || !S.army || !S.nation || !CBZ.flags || !CBZ.flags.dataURL) return "";
    const key = t + ":" + S.nation;
    if (FLAG_URL[key]) return FLAG_URL[key];
    let u = "";
    try { u = CBZ.flags.dataURL(S.nation, 96) || ""; } catch (e) {}
    return (FLAG_URL[key] = u);
  }
  if (FLAG_URL[t]) return FLAG_URL[t];
  // the city's one flag system (city/flags.js) painted it: use that picture as is
  if (FRONT[t].flagUrl) return (FLAG_URL[t] = FRONT[t].flagUrl);
  const cv = document.createElement("canvas"); cv.width = 96; cv.height = 64;
  drawFlag(cv.getContext("2d"), FRONT[t].flag, 96, 64);
  return (FLAG_URL[t] = cv.toDataURL());
}
function flagImg(t) { const u = flagURL(t); return u ? "<img class=\"flagimg\" alt=\"\" src=\"" + u + "\">" : ""; }
if (FRONT) {
  // the road in: two flags over the loading bar, and nothing to choose
  const hero = document.querySelector("#menu .hero");
  if (hero) hero.innerHTML = "<div class=\"kick\">THE FRONT" + (FRONT.where ? ", " + String(FRONT.where).toUpperCase() : "") + "</div>" +
    "<h1 style=\"font-size:clamp(48px,11vw,96px)\">" + flagImg("red") + " " + TEAMS.red.name + " <em>v</em> " + TEAMS.blue.name + " " + flagImg("blue") + "</h1>";
}

/* actor.weapon strings chosen so BOTH consumers read them right:
   actorweapons.js resolves the appearance model, combat_iq.js classifies the
   competence column. "MIXED" and "EVERYTHING" pick per man, seeded. */
