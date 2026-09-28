#!/usr/bin/env node
/* tools/prison-cars-check.mjs — THE YARD SORTS BY RACE, AND NOBODY WEARS A COLOUR.

   Owner (2026-09-28): "look at the colorful bands on people's arms. That's
   really dumb. Instead of a colorful band showing what gang you're in, it's
   the race ... and those are the gangs."

   Plain node, no browser. Loads the REAL rig (tools/lib/verbs-vm.mjs) plus
   entities/heritage.js, systems/prisoncars.js and entities/ai.js, deals a
   yard of men of every heritage through ai.js's own first think, and asserts:

     1. NO COLOUR MARKERS: no prison body carries an arm band (no `_band`, no
        mesh added under the forearm by the yard's deal), ai.js builds no band
        or painted turf disc, and the map / dashboard / name plate carry no
        team colour or Reds/Blues name.
     2. CAR = HERITAGE: every inmate's car is the car his heritage says; his
        `gang` (active in the car's business) is -1 or that same car; the
        roster's named key holders are in the car their heritage says; every
        car with men has exactly one key holder of its own.
     3. THE TABLES: the mess hall's stools are split into one contiguous run
        per car sized by headcount; a man may sit only in his own car's
        seats; at chow his errand walks him to his car's run.
     4. THE RULES: the player sat in another car's seat is told once by a man
        of THAT car, then that car puts hands on him; sharing smokes with
        another car is seen by his own.
     5. THE CLAIM: a new arrival is approached by a man of HIS OWN car.

     node tools/prison-cars-check.mjs      exit 0 = pass
*/
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { loadVerbsVM } from "./lib/verbs-vm.mjs";

const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
let checks = 0, fails = 0;
const failures = [], rows = [];
function check(ok, msg) { checks++; if (!ok) { fails++; failures.push(msg); } }
function lcg(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }
const DT = 1 / 30;

// ---------------------------------------------------------------- 1. static
{
  const ai = read("src/entities/ai.js");
  check(!/GANG_COLORS/.test(ai), "ai.js: no GANG_COLORS table");
  check(!/BoxGeometry\(0\.34,\s*0\.18,\s*0\.34\)/.test(ai), "ai.js: no arm-band box geometry");
  check(!/CircleGeometry\(9,\s*28\)/.test(ai), "ai.js: no painted turf disc");
  check(!/"the Reds"|"the Blues"|'Reds'|"Reds"|"Blues"/.test(ai), "ai.js: no Reds/Blues names in code");
  const fm = read("src/systems/fullmap.js");
  check(!/n\.gang === 0 \?/.test(fm), "fullmap.js: inmates are not dotted by gang colour");
  const db = read("src/systems/dashboard.js");
  check(!/f-red|f-blue|"Reds"|"Blues"/.test(db), "dashboard.js: no red/blue team rows");
  const it = read("src/systems/interact.js");
  check(!/\["Reds", "Blues"\]/.test(it), "interact.js: the name plate's role is not a colour gang");
  const npc = read("src/entities/npc.js");
  check(!/Reds ·|Blues ·|"Reds|"Blues|tagColor: m\.gang/.test(npc), "npc.js: the key holders carry no colour tag");
}

// ------------------------------------------------------------ the yard world
const W = loadVerbsVM({ mode: "escape" });
const { CBZ, THREE } = W;
CBZ.econ = { rng: lcg(7), hasItem: () => false };
CBZ.npcs = []; CBZ.guards = [];
CBZ.game.elapsed = 0; CBZ.game.state = "playing"; CBZ.scene = new THREE.Group();
CBZ.npcPickTarget = () => {}; CBZ.addHeat = () => {};
CBZ.WORLD = { northYard: { x0: -30, x1: 30, z0: -8, z1: 52 } };
const said = [];
CBZ.prisonSay = (a, text) => { said.push({ a, text }); return true; };
for (const f of ["src/entities/heritage.js", "src/systems/prisoncars.js", "src/entities/ai.js"]) {
  vm.runInContext(read(f), W.ctx, { filename: f });
}
const PC = CBZ.prisonCars;
check(!!PC && PC.N === 6, "prisoncars.js loaded with six cars");
check(typeof CBZ.heritageCar === "function", "heritage.js exports heritageCar");

// ---------------------------------------------------------- heritage -> car
const IDS = CBZ.HERITAGE_IDS || [];
check(IDS.length >= 14, "at least 14 heritages (" + IDS.length + ")");
for (const id of IDS) check(PC.carOfHeritage(id) >= 0, "heritage " + id + " has a car");
check(IDS.indexOf("skinhead") < 0, "skinhead is not a race");
check(PC.carOfHeritage((CBZ.heritageRoll("skinhead", "x") || {}).heritage) === PC.IDX.white, "the old skinhead roll rides with the White car");
const perCar = new Array(PC.N).fill(0);
for (const id of IDS) perCar[PC.carOfHeritage(id)]++;
check(perCar.every((k) => k >= 1), "every car has at least one heritage (" + perCar.join(",") + ")");

// ------------------------------------------------------------ deal the yard
const laKids = new Map();
function inmate(id, name, x, z, extra) {
  const look = CBZ.heritageRoll(id, name);
  const a = W.actor(Object.assign({}, look, { x, z, name, torso: 0xff7a1a, legs: 0xff7a1a, arms: 0xff7a1a, collar: 0xff9747 }));
  CBZ.heritageApply(a.char, look);
  Object.assign(a, { kind: "inmate", role: "inmate", data: { name }, gang: null, baseSpeed: 2, speed: 2,
    target: new THREE.Vector3(x, 0, z), hitCD: 0, ratings: { fighting: 55, toughness: 50 }, slice: 0,
    region: [x - 5, x + 5, z - 5, z + 5] }, extra || {});
  laKids.set(a, a.char.parts && a.char.parts.la ? a.char.parts.la.children.length : -1);
  CBZ.npcs.push(a);
  return a;
}
const rr = lcg(99);
let k = 0;
for (let rep = 0; rep < 3; rep++) for (const id of IDS) {
  inmate(id, id + " " + rep, -20 + rr() * 40, rr() * 45);
  k++;
}
// a roster key holder the list put in a car that is NOT his (his heritage wins)
const miscast = inmate("mexican", "Miscast", 0, 10, { gang: PC.IDX.black, crewRole: "shotcaller" });
const errs = [];
for (const n of CBZ.npcs) { try { CBZ.aiThink(n, DT); } catch (e) { if (errs.length < 3) errs.push(String(e && e.stack || e)); } }
check(errs.length === 0, "ai.js deals the yard without errors (" + (errs[0] || "") + ")");

let bands = 0, laGrew = 0, wrongCar = 0, badGang = 0, active = 0;
for (const n of CBZ.npcs) {
  const want = PC.carOfHeritage(n.char.heritage);
  if (n._band) bands++;
  if (n.char.parts && n.char.parts.la && n.char.parts.la.children.length !== laKids.get(n)) laGrew++;
  if (n.yardCar !== want) wrongCar++;
  if (!(n.gang === -1 || n.gang === n.yardCar)) badGang++;
  if (n.gang >= 0) active++;
}
check(bands === 0, "no inmate wears an arm band (" + bands + ")");
check(laGrew === 0, "nothing was hung on anybody's forearm by the deal (" + laGrew + ")");
check(wrongCar === 0, "every inmate's car follows his heritage (" + wrongCar + " wrong)");
check(badGang === 0, "active membership is only ever his own car (" + badGang + " wrong)");
check(miscast.yardCar === PC.IDX.paisa && miscast.gang === PC.IDX.paisa, "a roster man listed in the wrong car rides with his own (Paisa)");
const share = active / CBZ.npcs.length;
check(share > 0.2 && share < 0.7, "a share of each car is active in its business (" + share.toFixed(2) + ")");
const aud = PC.audit();
check(aud.mismatched.length === 0 && aud.bands === 0, "prisonCars.audit(): no mismatch, no bands (" + aud.mismatched.join(",") + ")");
for (let c = 0; c < PC.N; c++) {
  const men = CBZ.npcs.filter((n) => n.yardCar === c);
  const lead = men.filter((n) => n.isLeader);
  if (men.length) check(lead.length === 1 && lead[0].gang === c, PC.label(c) + ": one key holder of its own (" + lead.length + ")");
}
rows.push("cars: " + PC.CARS.map((c, i) => c.label + " " + aud.byCar[i]).join(", ") + " | active " + (share * 100).toFixed(0) + "%");

// ------------------------------------------------------------- 3. the tables
const seats = [];
for (const tz of [8.2, 12.4, 16.2]) for (const side of [-1, 1]) for (let q = 0; q < 5; q++) seats.push({ x: -23.1 + (q - 2) * 0.72, z: tz + side * 0.62, occupant: null });
PC.allotMess(seats, true);
check(seats.every((s) => typeof s._car === "number" && s._car >= 0), "every mess stool belongs to a car");
const counts = new Array(PC.N).fill(0); for (const s of seats) counts[s._car]++;
for (let c = 0; c < PC.N; c++) if (aud.byCar[c] > 0) check(counts[c] >= 2, PC.label(c) + " has at least 2 stools (" + counts[c] + ")");
// contiguous: along the table order a car's run is never interrupted by another's
{
  const order = seats.slice().sort((a, b) => (Math.round(a.z / 4) - Math.round(b.z / 4)) || (a.x - b.x) || (a.z - b.z));
  const seen = new Set(); let runs = 0, prev = -2;
  for (const s of order) { if (s._car !== prev) { runs++; if (seen.has(s._car)) runs += 100; seen.add(s._car); prev = s._car; } }
  check(runs < 100, "each car's stools are one contiguous run along the tables");
}
const aBlack = CBZ.npcs.find((n) => n.yardCar === PC.IDX.black);
const aWhite = CBZ.npcs.find((n) => n.yardCar === PC.IDX.white);
const blackSeat = seats.find((s) => s._car === PC.IDX.black), whiteSeat = seats.find((s) => s._car === PC.IDX.white);
check(PC.maySit(aBlack, blackSeat) && !PC.maySit(aBlack, whiteSeat), "a man sits at his own car's stools, never another car's");
// chow: his errand walks him to his car's run
CBZ.prisonSchedule = { enabled: () => true, id: () => "mess", hour: () => 12, inBlock: () => false };
// (he is handed one free stool of his car's run and walks to IT; once his
// car's stools are all spoken for he stands with his people at their end)
let walked = 0, tried = 0, onStool = 0, doubled = 0;
const taken = new Set();
for (const s of seats) s._carFor = null;
for (const n of CBZ.npcs) {
  n._carErrand = null;
  if (!PC.errand(n)) continue;
  tried++;
  const e = n._carErrand, spot = PC.messSpot(n.yardCar);
  if (e && e.seat) {
    onStool++;
    if (taken.has(e.seat)) doubled++;
    taken.add(e.seat);
    if (e.seat._car === n.yardCar && n.target.x === e.seat.x && n.target.z === e.seat.z) walked++;
  } else if (spot && Math.hypot(n.target.x - spot.x, n.target.z - spot.z) < 2.6) walked++;
}
check(tried > CBZ.npcs.length * 0.5, "most of the yard goes to chow (" + tried + "/" + CBZ.npcs.length + ")");
check(walked === tried, "every man at chow walks to HIS car's stools (" + walked + "/" + tried + ")");
check(onStool > 0 && doubled === 0, "each is handed his own stool, never one another man is walking to (" + onStool + " stools, " + doubled + " doubled)");
for (const n of CBZ.npcs) n._carErrand = null;

// --------------------------------------------------------------- 4. the rules
CBZ.prisonSchedule = { enabled: () => true, id: () => "yard", hour: () => 9, inBlock: () => false };
CBZ.prisonRestSeats = { mess: seats, yard: [] };
// the convict as entities/player.js builds him: bare colours, skin 0xf0c39a
CBZ.playerChar.skinTone = 0xf0c39a; CBZ.playerChar.heritage = null;
const mine = PC.playerCar();
check(mine === PC.IDX.white, "the default convict (fair skin, no heritage) is read as the White car (" + PC.label(mine) + ")");
// the player sits at the Black car's end of a table
CBZ.player.pos.set(blackSeat.x, 0, blackSeat.z);
CBZ.player._propSeat = blackSeat;
for (const n of CBZ.npcs) {           // everybody close enough to see it, nobody busy
  n.approach = null; n.aiState = "wander"; n.huntPlayer = 0;
  n.group.position.set(blackSeat.x + (rr() - 0.5) * 12, 0, blackSeat.z + (rr() - 0.5) * 12);
}
let warnedBy = null;
for (let t = 0; t < 4; t += DT) {
  PC.tick(DT);
  if (!warnedBy) warnedBy = CBZ.npcs.find((n) => n.approach && n.approach.carRule === "seat") || null;
}
check(!!warnedBy, "sitting at another car's table: somebody walks up about it");
check(!!warnedBy && warnedBy.yardCar === PC.IDX.black, "...and he is from the car whose table it is (" + (warnedBy ? PC.label(warnedBy.yardCar) : "-") + ")");
const t0 = PC.tension(mine, PC.IDX.black);
for (let t = 0; t < 9; t += DT) PC.tick(DT);
check(PC.tension(mine, PC.IDX.black) > t0, "staying put after the warning goes on both cars' books (tension " + t0.toFixed(1) + " -> " + PC.tension(mine, PC.IDX.black).toFixed(1) + ")");
check(said.some((s) => s.a && s.a.yardCar === mine), "your own car tells you off for it");
CBZ.player._propSeat = null;
// sharing with another car
said.length = 0;
const other = CBZ.npcs.find((n) => n.yardCar !== mine && n.yardCar >= 0);
PC.noteShare(other);
check(said.some((s) => s.a && s.a.yardCar === mine && /share/i.test(s.text)), "handing smokes to another car: your own car sees it and says so");

// --------------------------------------------------------------- 5. the claim
for (const n of CBZ.npcs) { n.approach = null; n.aiState = "wander"; n.huntPlayer = 0; }
CBZ.player.pos.set(0, 0, 20);
for (const n of CBZ.npcs) n.group.position.set((rr() - 0.5) * 20, 0, 20 + (rr() - 0.5) * 20);
const cl = PC.claimer();
check(!!cl && cl.yardCar === mine, "the new man's claimer is from his own car (" + (cl ? PC.label(cl.yardCar) : "-") + ")");
const stranger = CBZ.npcs.find((n) => n.yardCar !== mine && n.yardCar >= 0);
if (stranger.gang < 0) stranger.gang = stranger.yardCar;
check(!CBZ.joinGang(stranger).ok && CBZ.player.gang == null, "another car's man cannot take you in");
if (cl && cl.gang < 0) cl.gang = cl.yardCar;
const j = cl ? CBZ.joinGang(cl) : { ok: false };
check(j.ok && CBZ.player.gang === mine && CBZ.player.yardCar === mine, "your own car takes you in (gang = your car)");
check(CBZ.player.car === undefined, "the player's `car` (a VEHICLE in the city) is never written by the yard");

// ------------------------------------------------------------ 6. the outcast
// A car can put a man OUT (systems/prisonsnitch.js expels a known rat via
// prisonCars.leave). From then on he is nobody's: his own car's seat, phone
// and shower turn are somebody else's, his OLD car answers at its own table,
// and no car takes him back.
{
  for (const n of CBZ.npcs) { n.approach = null; n.aiState = "wander"; n.huntPlayer = 0; }
  const ownSeat = seats.find((s) => s._car === mine);
  CBZ.player.pos.set(ownSeat.x, 0, ownSeat.z);
  CBZ.player._propSeat = ownSeat;
  check(PC.playerViolation() === null, "a member at his own car's table breaks no rule");
  check(PC.leave("outcast") === true && PC.isOut() && PC.status() === "outcast", "prisonCars.leave(): the player is out");
  check(PC.playerCar() === -1 && PC.bloodCar() === mine, "out: playerCar() is nobody's, bloodCar() still says where he came from");
  check(CBZ.player._carOutcast === true && CBZ.player.gang == null, "the old _carOutcast flag mirrors it and the gang comes off");
  const v = PC.playerViolation();
  check(!!v && v.kind === "seat" && v.yardCar === mine, "an outcast at his OLD car's table is breaking its rule (" + JSON.stringify(v) + ")");
  for (const n of CBZ.npcs) { n.approach = null; n.group.position.set(ownSeat.x + (rr() - 0.5) * 10, 0, ownSeat.z + (rr() - 0.5) * 10); }
  said.length = 0;
  let by = null;
  for (let t = 0; t < 4 && !by; t += DT) { PC.tick(DT); by = CBZ.npcs.find((n) => n.approach && n.approach.carRule === "seat") || null; }
  check(!!by && by.yardCar === mine, "...and his old car is the one that walks up (" + (by ? PC.label(by.yardCar) : "-") + ")");
  CBZ.player._propSeat = null;
  const ph = PC.PHONES[PC.CARS[mine].phone];
  CBZ.player.pos.set(ph.x, 0, ph.z);
  const pv = PC.playerViolation();
  check(!!pv && pv.kind === "phone", "an outcast on his old car's phone is on somebody else's phone");
  CBZ.prisonSchedule = { enabled: () => true, id: () => "wake", hour: () => 5 + (["white", "black", "south", "paisa", "asian", "others"].indexOf(PC.CARS[mine].id) + 0.5) * 2 / 6, inBlock: () => false };
  check(PC.showerTurn() === mine, "(the shower turn is his old car's)");
  CBZ.player.pos.set(-14.4, 0, -40.9);
  const sv = PC.playerViolation();
  check(!!sv && sv.kind === "shower", "an outcast in his old car's shower turn is out of turn");
  const back = CBZ.npcs.find((n) => n.yardCar === mine);
  if (back && back.gang < 0) back.gang = back.yardCar;
  check(!CBZ.joinGang(back).ok && CBZ.player.gang == null, "no car takes an outcast back in");
  PC.reset();
  check(!PC.isOut() && PC.playerCar() === mine && CBZ.player._carOutcast === false, "a new run: he is his car's again");
  CBZ.prisonSchedule = { enabled: () => true, id: () => "yard", hour: () => 9, inBlock: () => false };
}

rows.push("mess stools by car: " + PC.CARS.map((c, i) => c.label + " " + counts[i]).join(", "));
for (const r of rows) console.log("  " + r);
if (W.errors.length) console.log("  vm errors: " + W.errors.slice(0, 3).join(" | "));
if (fails) { for (const f of failures) console.log("  FAIL " + f); console.log(`\n${checks - fails}/${checks} checks passed`); process.exit(1); }
console.log(`\n${checks}/${checks} checks passed`);
