"use strict";
/* src/battle/spawn.js — NPC War: SPAWN, and WHO BODY i OF A SIDE IS.
   Split out of games/battle.html (docs/npcwar/ARCHITECTURE.md). Every
   src/battle file shares ONE script scope: top-level names here are visible
   to the other battle files. Anything that needs the loaded engine runs in
   CBZ.npcwar.onBoot(), in file order, once the armoury is in. */

/* ============================================================ THE BOOK
   What body i of a side IS: its unit id, its training, its gun. The war
   room fields ONE roster per side (SET: redU/redT/redW). A host that fields
   several forces on one side (Gang City: a brigade here, a convoy there,
   martial law at the square) books each force as its own SEGMENT of spawn
   indices, with its own roster, training and guns, and its own crew plan
   (a force's men crew a force's vehicles, never another's). An empty book is
   the war room exactly as it always was. */
const SPAWN_BOOK = { red: [], blue: [] };   // [{ from, n, roster, tier, gun, force }]
function segOf(team, i) {
  const L = SPAWN_BOOK[team];
  if (!L || !L.length) return null;
  for (let k = L.length - 1; k >= 0; k--) { const s = L[k]; if (i >= s.from && i < s.from + s.n) return s; }
  return null;
}
// what body i of a roster is: the grammar (alternating "a|b", counted
// "m1_abrams*3,men*20") lives in battle/core/roster.js, the page-free half
function kindAt(u, i) {
  return CBZ.battleRoster.kindAt(u, i);
}
function unitIdAt(team, i) {
  const s = segOf(team, i);
  return s ? kindAt(s.roster, i - s.from) : kindAt(team === "red" ? SET.redU : SET.blueU, i);
}
function trainAt(team, i) {
  const s = segOf(team, i);
  return (s && s.tier) || (team === "red" ? SET.redT : SET.blueT);
}
function gunChoiceAt(team, i) {
  const s = segOf(team, i);
  return (s && s.gun) || (team === "red" ? SET.redW : SET.blueW);
}
/* A body that belongs to a booked force carries the force and its order
   (ai/orders.js reads m.order); a hold, move or withdrawal puts it on the
   home the force lays out for it. Nothing booked: nothing changes. */
function bookUnit(m) {
  if (!m) return m;
  const s = segOf(m.team, m.i);
  const F = s && s.force;
  if (F) {
    m.force = F;
    m.order = F.order || null;
    if (F.homeOf && m.order && m.order.type !== "attack") { const h = F.homeOf(m.i); if (h) m.home = { x: h.x, z: h.z }; }
  }
  return m;
}
// the way a body faces when it is put down: a host may say (a force's own
// heading); the war room's two lines face each other across the field
function spawnHeading(team, i) {
  if (HOST && HOST.spawnHeading) { const h = HOST.spawnHeading(team, i); if (h != null && isFinite(h)) return h; }
  return team === "red" ? Math.PI / 2 : -Math.PI / 2;
}

/* ============================================================ SPAWN */
function queueMen(perSide) {
  const r0 = spawnCount.red, b0 = spawnCount.blue;
  for (let i = 0; i < perSide; i++) {
    spawnQueue.push(["red", r0 + i], ["blue", b0 + i]);
  }
  spawnCount.red += perSide; spawnCount.blue += perSide;
  spawnTotal = spawnCount.red + spawnCount.blue;
}
const spawnCount = { red: 0, blue: 0 };
// one body of a side, made by what it is (men, an animal, a vehicle) and
// put in the unit store; null when it rides in a seat or failed to build
function spawnOne(team, i) {
  const kind = unitIdAt(team, i);
  // one registry says what a unit id IS (units/unitkit.js): men, an animal
  // species, or a vehicle (src/battle/vehicles.js makes those)
  const k = kind === "men" ? "men" : CBZ.unitKit ? CBZ.unitKit.kindOf(kind) : "species";
  const m = k === "men" ? makeMan(team, i)
    : k === "vehicle" ? (typeof makeVehicle === "function" ? makeVehicle(team, i, kind) : null)
    : makeBeast(team, i, kind);
  if (m) {
    bookUnit(m);
    // its row in the unit store (battle/core/store.js), every tier's ledger
    if (STORE) { m.row = STORE.alloc(team, m.vehicle ? "vehicle" : m.beast ? "beast" : "man"); STORE.sync(m.row, m); }
    men.push(m);
  }
  return m;
}
function drainSpawns() {
  let n = 0;
  while (spawnQueue.length && n < 10) {
    const s = spawnQueue.shift();
    spawnOne(s[0], s[1]);
    n++;
  }
}
