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
const TEAMS = {
  red:  { id: "red",  name: "RED",  color: 0xff5a3d },
  blue: { id: "blue", name: "BLUE", color: 0x3fa8ff },
};
// AT THE FRONT A SIDE IS A NATION: its name, and the bright colour its helmet
// covers and smoke carry (the cloth is set with the uniforms below)
if (FRONT) {
  ["red", "blue"].forEach(function (t) {
    TEAMS[t].name = String(FRONT[t].name || TEAMS[t].name).toUpperCase();
    if (isFinite(FRONT[t].mark)) TEAMS[t].color = FRONT[t].mark;
  });
}
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
  if (!FRONT || !FRONT[t]) return "";
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
