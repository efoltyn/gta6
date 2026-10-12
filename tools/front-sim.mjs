#!/usr/bin/env node
/* tools/front-sim.mjs — THE FRONT, HEADLESS. Plain node, no browser, no THREE.

   Loads src/systems/brain.js, src/city/polwar.js (the war) and
   src/city/frontline.js (the battles) over a stubbed polity layer and a
   stubbed CBZ.army that records what it is asked and lets the test say how a
   battle went (the battle itself is the battle core's, fought in the world:
   tools/army-headless.mjs holds that half).

     1  the armies: what a nation sends is read off what it is (a rich army
        rides Bradleys behind Abrams, a middling one Strykers, a poor one
        technicals); the President's nation is RED; who holds the ground.
     2  polwar + frontline: each day of war starts ONE battle in the world
        (two forces through CBZ.army.spawnForce: the holder holds, the
        attacker attacks its line), polwar rolls no soldiers' dice while it is
        fought, and when the field is called the bodies on the ground come off
        polwar one for one, the front moves, the bus hears it, the loser falls
        back and the field is cleared once nobody is watching.
     3  the President's front: F: Front marks today's battle on his map (and
        starts it if it has not), never a second one.

     node tools/front-sim.mjs        # all
     node tools/front-sim.mjs 2      # one                                   */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const only = process.argv[2] ? +process.argv[2] : 0;
let fails = 0, passes = 0;
function check(ok, msg) { if (ok) { passes++; console.log("  PASS " + msg); } else { fails++; console.log("  FAIL " + msg); } }

// ---------------------------------------------------------------- the stubs
const bus = [];
const records = {
  republic: { id: "republic", kind: "country", name: "The Republic", govType: "democracy", wealthLevel: 1, treasury: 900000 },
  kesh: { id: "kesh", kind: "country", name: "Kingdom of Kesh", govType: "monarchy", wealthLevel: 0.35, treasury: 200000 },
  veridia: { id: "veridia", kind: "country", name: "Republic of Veridia", govType: "democracy", wealthLevel: 0.65, treasury: 500000 },
  libertyville: { id: "libertyville", kind: "city", name: "Libertyville", rect: { cx: 0, cz: 0, hx: 300, hz: 300 } },
};
let DAY = 10;
const newDay = [], ticks = [];
globalThis.window = globalThis;
globalThis.CBZ = {
  game: {},
  worldDay: () => DAY,
  onNewDay: (fn) => newDay.push(fn),
  onUpdate: (o, fn) => ticks.push(fn),
  polity: {
    get: (id) => records[id] || null,
    list: (k) => Object.values(records).filter((r) => r.kind === k),
    countryOf: (id) => records[id] && records[id].kind === "country" ? records[id] : records.republic,
  },
  COUNTRIES: [
    { id: "kesh", settlements: [{ id: "keshtown", capital: true, cx: 1900, cz: -1600 }] },
    { id: "veridia", settlements: [{ id: "veridiacity", capital: true, cx: -1800, cz: 1500 }] },
  ],
  relations: { get: () => -80, event: () => {}, set: () => {}, warPressure: () => 0 },
  presidency: { emit: (evt, p) => bus.push({ evt, p }), on: () => {} },
  cityPopulationDie: () => {},
  player: { pos: { x: 99999, z: 99999 }, hp: 200, maxHp: 200 },
};
const CBZ = globalThis.CBZ;
/* THE ARMY, STUBBED: every force it is asked for, every order, every disband;
   status() reads what the test wrote into force.st */
const ARMY = { spawned: [], orders: [], disbanded: [], simT: 0 };
CBZ.army = {
  realm: { get simT() { return ARMY.simT; } },
  spawnForce(spec) {
    const n = spec.units.map((u) => u.split("*")).filter((p) => p[0] === "men").reduce((s, p) => s + (+p[1] || 1), 0);
    const F = { id: spec.id, spec, n, st: { ready: true, alive: n, dead: 0, fled: 0, routed: 0, vehicles: 0, x: spec.at.x, z: spec.at.z, contact: false } };
    ARMY.spawned.push(F);
    return F;
  },
  orderForce(F, o) { ARMY.orders.push({ id: F.id, o }); return true; },
  disband(F) { ARMY.disbanded.push(F.id); return true; },
  status(F) { return F.st; },
};
const waypoints = [];
CBZ.fullMap = { setWaypoint: (x, z, label) => { waypoints.push({ x, z, label }); return {}; } };
require(path.join(ROOT, "src/systems/brain.js"));
require(path.join(ROOT, "src/city/polwar.js"));
const FL = require(path.join(ROOT, "src/city/frontline.js"));
const W = CBZ.polwar;
// one second of play: the frontline's watcher runs on the city's update
function second(n) { for (let k = 0; k < (n || 1); k++) { ARMY.simT += 1; for (const t of ticks) t(1); } }
// a battle the test decides: the loser's men die and run, the winner's stand
function fight(B, winT, deadW, deadL) {
  const L = winT === "red" ? "blue" : "red";
  const fw = B.forces[winT], fl = B.forces[L];
  fw.st.contact = fl.st.contact = true;
  second(3);
  fw.st.dead = deadW; fw.st.alive = fw.n - deadW;
  fl.st.dead = Math.min(fl.n, deadL); fl.st.fled = Math.max(0, Math.floor((fl.n - fl.st.dead) / 2));
  fl.st.alive = fl.n - fl.st.dead - fl.st.fled; fl.st.routed = fl.st.alive;
  second(2);
}
const scen = [];
function scenario(n, name, fn) { scen.push({ n, name, fn }); }

scenario(1, "the armies: read off what the nation is", () => {
  W.reset();
  const rich = FL.unitsFor("republic", 60, { planes: 8 }), mid = FL.unitsFor("veridia", 44, { planes: 1 }), poor = FL.unitsFor("kesh", 45, { planes: 0 });
  check(rich.some((u) => /^m1_abrams\*/.test(u)) && rich.some((u) => /^bradley_ifv\*6/.test(u)) && rich.some((u) => /^ah64_apache/.test(u)),
    "a rich army rides Bradleys behind Abrams, an Apache overhead (" + rich.join(", ") + ")");
  check(mid.some((u) => /^stryker_apc\*4/.test(u)) && mid.some((u) => /^hmmwv/.test(u)), "a middling one Strykers and a Humvee (" + mid.join(", ") + ")");
  check(poor.some((u) => /^technical\*3/.test(u)) && !poor.some((u) => /abrams|bradley|stryker/.test(u)), "a poor one technicals (" + poor.join(", ") + ")");
  check(rich[rich.length - 1] === "men*60", "the men are the crews and the dismounts, counted once");
  const war = W.declareWar("republic", "kesh", { byPlayer: true });
  CBZ.warroom = { nation: () => "republic", nationAt: () => null };
  const sp = FL.specFor(war, DAY, { you: "republic" });
  check(sp && sp.red.id === "republic" && sp.you === "red", "the President's nation is RED (" + (sp && sp.red.name + " v " + sp.blue.name) + ")");
  check(sp && (sp.hold === "red" || sp.hold === "blue") && isFinite(sp.x) && isFinite(sp.z), "a holder and a place (" + (sp && sp.hold + " at " + sp.x + "," + sp.z) + ")");
});

scenario(2, "polwar + frontline: one battle a day, fought in the world", () => {
  W.reset(); bus.length = 0; ARMY.spawned.length = 0; ARMY.orders.length = 0; ARMY.disbanded.length = 0;
  CBZ.warroom = { nation: () => "republic", nationAt: () => null };
  const war = W.declareWar("republic", "kesh", { byPlayer: true });
  check(!!war, "war declared");
  const pos0 = war.fronts[0].position;
  const rep0 = W.militaryOf("republic").soldiers, kesh0 = W.militaryOf("kesh").soldiers;
  DAY++; for (const fn of newDay) fn(DAY);
  const B = FL.battles()[war.id];
  check(!!B && ARMY.spawned.length === 2, "the day's battle started in the world: two forces (" + ARMY.spawned.map((f) => f.spec.side + " " + f.spec.units.join("+")).join(" v ") + ")");
  const hold = B.spec.hold, atk = hold === "red" ? "blue" : "red";
  const fh = B.forces[hold].spec, fa = B.forces[atk].spec;
  check(fh.order.type === "hold" && fa.order.type === "attack" && Math.hypot(fa.order.at.x - fh.at.x, fa.order.at.z - fh.at.z) < 1,
    "the holder holds its line, the attacker attacks it (" + fh.side + " holds, " + fa.side + " attacks)");
  check(fh.hostile !== undefined && (fh.side === "republic" ? fh.hostile === "never" : fh.hostile === "always"), "the President's men are his; the enemy's shoot him");
  check(W.militaryOf("republic").soldiers === rep0 && W.militaryOf("kesh").soldiers === kesh0, "no soldiers' dice while it is fought (" + rep0 + "/" + kesh0 + " unchanged)");
  check(bus.some((b) => b.evt === "battle-started"), "battle-started on the bus");
  DAY++; for (const fn of newDay) fn(DAY);
  check(ARMY.spawned.length === 2, "a battle still being fought is not started twice");
  fight(B, "red", 3, 21);
  const keshDead = B.forces.blue.st.dead;
  check(!!B.called, "the field was called when a side broke");
  check(W.militaryOf("kesh").soldiers === kesh0 - keshDead && W.militaryOf("republic").soldiers === rep0 - 3,
    "the bodies on the ground came off polwar one for one (kesh -" + keshDead + ", republic -3)");
  check(war.fronts[0].position !== pos0, "the front moved (" + pos0 + " -> " + war.fronts[0].position.toFixed(3) + ")");
  const en = bus.filter((b) => b.evt === "battle-ended");
  check(en.length === 1 && /Republic/.test(en[0].p.text), "battle-ended with text: \"" + (en[0] && en[0].p.text) + "\"");
  const fb = ARMY.orders.filter((o) => o.id === B.forces.blue.id && o.o.type === "withdraw");
  check(fb.length === 1, "the loser falls back toward home");
  second(130);
  check(ARMY.disbanded.length === 2 && !FL.battles()[war.id], "the field is cleared once nobody is watching");
  let days = 0;
  while (!war.ended && days < 60) {
    DAY++; days++;
    for (const fn of newDay) fn(DAY);
    const b2 = FL.battles()[war.id];
    if (b2 && !b2.called) { fight(b2, "red", 2, 18); second(130); }
  }
  check(war.ended && war.winner === "republic", "the war was decided by its battles (" + war.endReason + ", " + war.winner + ", " + days + " more days)");
});

scenario(3, "the President's front: marked on his map, never twice", () => {
  W.reset(); bus.length = 0; ARMY.spawned.length = 0; waypoints.length = 0;
  CBZ.warroom = { nation: () => "republic", nationAt: () => null };
  const war = W.declareWar("republic", "veridia", { byPlayer: true });
  const g = FL.canGo();
  check(g.ok, "at war: the Front verb is open (" + (g.why || "ok") + ")");
  const r = FL.go();
  check(r.ok && ARMY.spawned.length === 2 && waypoints.length === 1 && waypoints[0].label === "The front", "F: Front starts today's battle and marks it on his map (" + r.line + ")");
  const r2 = FL.go();
  check(r2.ok && ARMY.spawned.length === 2 && waypoints.length === 2, "asking again marks the same battle, it does not start another");
  DAY++; for (const fn of newDay) fn(DAY);
  check(ARMY.spawned.length === 2, "the daily tick finds it being fought");
  void war;
});

for (const s of scen) {
  if (only && s.n !== only) continue;
  console.log(s.n + "  " + s.name);
  try { s.fn(); } catch (e) { fails++; console.log("  FAIL threw: " + (e && e.stack || e)); }
}
console.log("\n" + passes + " passed, " + fails + " failed");
process.exit(fails ? 1 : 0);
