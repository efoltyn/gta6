#!/usr/bin/env node
/* ============================================================
   tools/snitch-sim.mjs — TELLING, AND THE WARDEN WHO ORDERS IT, IN PLAIN NODE.

   Loads the real src/systems/prisonsnitch.js and src/systems/prisonwarden.js
   into a stub world (no THREE scene, no browser): a yard of inmates, a few
   officers whose only mover is "walk straight at waypoints[0]", the player.
   Then plays the owner's asks and asserts what the WORLD did:

     1. a stabbing the player saw -> Tell a guard -> an officer walks to the
        stabber, tosses him, he is cuffed and moved to seg
     2. being seen talking to staff -> snitch rep up, the watchers know
     3. your car turns on you over the line (and not under it)
     4. a lie (a name with nothing on him) is caught when checked, and the
        warden holds it; a lie about a man who IS holding checks out
     5. the warden never runs the law himself: a hunt / a yard case that
        lands on him becomes an order an officer carries out

       node tools/snitch-sim.mjs
   Exit 0 = pass.
============================================================ */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let fails = 0, checks = 0;
function check(ok, what) { checks++; if (!ok) { fails++; console.log("  FAIL " + what); } else console.log("  ok   " + what); }

function V(x, z) { return { x, y: 0, z, set(a, b, c) { this.x = a; this.y = b; this.z = c; return this; }, copy(o) { this.x = o.x; this.z = o.z; return this; } }; }
let seed = 7;
function rng() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }

function world(opts) {
  opts = opts || {};
  const said = [];
  const updates = [];
  const npcs = [], guards = [];
  let idn = 0;
  function inmate(name, x, z, over) {
    const n = Object.assign({ id: ++idn, kind: "inmate", data: { name }, group: { position: V(x, z), rotation: { y: 0 }, visible: true },
      target: V(x, z), gang: -1, aiState: "wander", loadout: { items: [], cigs: 6 }, region: [x - 2, x + 2, z - 2, z + 2] }, over || {});
    npcs.push(n); return n;
  }
  function officer(name, x, z, over) {
    const gd = Object.assign({ id: ++idn, kind: "guard", data: { name }, group: { position: V(x, z), rotation: { y: 0 } },
      waypoints: [V(x, z)], wi: 0, speed: 3, hunt: 0, alert: 0 }, over || {});
    guards.push(gd); return gd;
  }
  const CBZ = {
    onUpdate(p, fn) { updates.push({ p, fn }); updates.sort((a, b) => a.p - b.p); },
    game: { mode: "escape", state: "playing", role: "inmate", inventory: {}, detection: 0, elapsed: 0 },
    player: { pos: V(0, 0), gang: null },
    npcs, guards,
    prisonSay(a, line) { said.push({ who: a && a.data ? a.data.name : "?", line }); return true; },
    econ: { rng, addCigs(n) { CBZ.game.cigs = (CBZ.game.cigs || 0) + n; }, announceLoot() {}, hasPhoneAccess() { return false },
      grantPhoneTime(s) { CBZ.game.phoneTimeT = s; }, PHONE_TIME_SECS: 90 },
    prisonBrain: {
      crime() { return 0; }, memberDown() {},
      beginCase(gd, n) { n.cuffed = true; n._lawBy = gd; gd._yardCase = n; CBZ._cases.push({ gd, n }); return true; },
      endCase(gd) { if (gd._yardCase) gd._yardCase._lawBy = null; gd._yardCase = null; },
    },
    _cases: [],
    requestInmateHunt(n, s) { n.huntPlayer = s; return true; },
    provokeGang() { return 0; },
    addGangStanding() {},
    prisonSchedule: { hourLength() { return 30; }, id() { return "yard"; }, until() { return 20; } },
    jailBoost: { apply(tag, gd, f) { Object.assign(gd, f); }, restore() {}, newRunWatcher() { return () => false; }, onStateExit() {} },
    guardFaceTo() {}, guardStand() {}, guardIdle() {},
  };
  const sandbox = { window: { CBZ }, CBZ, console, Math, THREE: { Vector3: function (x, y, z) { return V(x, z); } } };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  function load(rel) { vm.runInContext(readFileSync(join(ROOT, rel), "utf8"), sandbox, { filename: rel }); }
  if (opts.warden) load("src/systems/prisonwarden.js");
  load("src/systems/prisonsnitch.js");
  function step(dt) {
    CBZ.game.elapsed += dt;
    // the only mover: officers walk straight at their first waypoint
    for (const gd of guards) {
      if (gd.pause > 0) { gd.pause -= dt; continue; }
      const w = gd.waypoints && gd.waypoints[0];
      if (!w) continue;
      const p = gd.group.position, dx = w.x - p.x, dz = w.z - p.z, d = Math.hypot(dx, dz);
      if (d > 0.05) { const k = Math.min(1, (gd.speed || 3) * dt / d); p.x += dx * k; p.z += dz * k; }
    }
    for (const u of updates) u.fn(dt);
  }
  function run(secs, dt) { dt = dt || 0.1; for (let t = 0; t < secs; t += dt) step(dt); }
  return { CBZ, inmate, officer, step, run, said, S: () => CBZ.prisonSnitch._S };
}

/* ---- 1. a stabbing you saw, told to a guard, gets the stabber moved ---- */
console.log("1. seen stabbing -> tell a guard -> the stabber is punished");
{
  const W = world();
  const { CBZ } = W;
  const stabber = W.inmate("Rico Vance", 8, 0, { _shankOut: true, loadout: { items: ["Shiv"], cigs: 4 } });
  const victim = W.inmate("Moss", 9, 0.5);
  const officer = W.officer("Officer #2", 1.5, 0.5);
  W.officer("Officer #5", 40, 30);
  W.run(0.2);
  CBZ.prisonBrain.crime("fight", 8, 0, stabber, 0.6, { victim });
  const facts = CBZ.prisonSnitch.facts();
  check(facts.some((f) => f.kind === "stab" && f.who === "Rico"), "the player knows Rico stabbed Moss");
  check(CBZ.prisonSnitch.canTell(officer), "Tell is live on the guard next to him");
  const r = CBZ.prisonSnitch.open(officer);
  check(r.ok, "the guard listens");
  const items = CBZ.prisonSnitch.menu(officer);
  check(items && items[0] === "tellA", "the card turns into what he knows");
  check(CBZ.prisonSnitch.label("tellA") === "Rico stabbed Moss", `the item reads "Rico stabbed Moss" (got "${CBZ.prisonSnitch.label("tellA")}")`);
  CBZ.prisonSnitch.pick(officer, "tellA");
  check(CBZ.prisonSnitch.audit().tasks.length === 1, "an officer is sent to check it");
  W.run(12);
  check(CBZ._cases.some((c) => c.n === stabber), "the stabber was cuffed by an officer");
  check(!stabber.loadout.items.includes("Shiv"), "his blade was taken off him");
  W.run(12);
  check(stabber._seg === true && stabber.escaped === true, "the stabber is gone from the yard (seg)");
  const a = CBZ.prisonSnitch.audit();
  check(a.log.favors >= 1, "the favor landed when it checked out (" + (CBZ.game.snitchPass ? "a look-away" : "cigs") + ")");
  W.run(12 * 30 + 5);
  check(stabber._seg === false && stabber.escaped === false, "twelve hours later he is back on the tier");
  check(stabber._ratTarget === true && (stabber.playerGrudge || 0) >= 8, "and he knows who put him there (only the player saw it)");
}

/* ---- 2. being seen talking raises snitch rep ---- */
console.log("2. seen talking to staff -> snitch rep");
{
  const W = world();
  const { CBZ } = W;
  const perp = W.inmate("Tate", 8, 8, { _shankOut: true, loadout: { items: ["Shiv"] } });
  const officer = W.officer("Officer #1", 1, 0);
  const watchers = [W.inmate("Ace", 3, 3), W.inmate("Bo", -3, 4), W.inmate("Cy", 4, -3), W.inmate("Dex", -4, -2)];
  W.run(0.6);                        // the scan sees Tate's blade
  check(CBZ.prisonSnitch.facts().some((f) => f.kind === "blade"), "the player saw Tate's blade");
  const rep0 = CBZ.prisonSnitch.rep();
  CBZ.prisonSnitch.open(officer);
  CBZ.prisonSnitch.pick(officer, "tellA");
  const seenBy = watchers.filter((m) => CBZ.prisonSnitch.knows(m)).length;
  check(CBZ.prisonSnitch.rep() > rep0, `rep rose from ${rep0} to ${CBZ.prisonSnitch.rep()}`);
  check(seenBy >= 2, `${seenBy} of 4 men standing there know he talks`);
}

/* ---- 3. the car turns over the line ---- */
console.log("3. your car turns on you over the threshold");
{
  const C = world().CBZ.prisonSnitch.CORE;
  check(!C.carTurns(20, 1, 6), "one of six knowing, rep 20: still with you");
  check(C.carTurns(20, 3, 6), "three of six knowing: done");
  check(C.carTurns(C.CAR_REP, 0, 6), "rep at the line: done");
  const W = world();
  const { CBZ } = W;
  // systems/prisoncars.js's surface: the player runs with the Black car (1)
  CBZ.player.yardCar = 1;
  CBZ.prisonCars = {
    CARS: [{ label: "Southsiders", yard: { x: -22, z: 30 } }, { label: "Black car", yard: { x: 22, z: 16 } }],
    carOf(a) { if (a === CBZ.player) return CBZ.player.yardCar; return typeof a.yardCar === "number" ? a.yardCar : -1; },
    label(i) { return this.CARS[i] ? this.CARS[i].label : ""; },
  };
  const car = [0, 1, 2, 3, 4, 5].map((i) => W.inmate("Car" + i, 8 + i * 2, 12, { yardCar: 1 }));
  W.inmate("Other", 9, 14, { yardCar: 0 });
  const officer = W.officer("Officer #3", 1, 0);
  W.run(0.6);                        // running with a car = knowing its stash
  check(CBZ.prisonSnitch.facts().some((f) => f.kind === "stash"), "the player knows his own car's stash");
  CBZ.prisonSnitch.open(officer);
  const items = CBZ.prisonSnitch.menu(officer);
  const slot = items.find((v) => /stash/.test(CBZ.prisonSnitch.label(v)));
  check(!!slot && CBZ.prisonSnitch.label(slot) === "Black car stash", "the stash is on the card, by car name");
  CBZ.prisonSnitch.pick(officer, slot);
  W.run(40);
  check(CBZ.prisonSnitch.carTurned(), "the stash got raided; only the car knew: the car turned");
  check(CBZ.player._carOutcast === true, "he is out of the car");
  check(car.every((m) => m._ratTarget), "every man in it has him down as a rat");
  W.run(30);
  check(car.some((m) => (m.huntPlayer || 0) > 0), "and they come for him");
}

/* ---- 4. a lie is caught ---- */
console.log("4. a lie is caught when it is checked");
{
  const W = world({ warden: true });
  const { CBZ } = W;
  const enemy = W.inmate("Duke", 12, 6, { playerGrudge: 6, loadout: { items: [], cigs: 2 } });
  const officer = W.officer("Officer #4", 20, 10);
  const warden = W.officer("the Warden", 0.8, 0, { kind: "warden" });
  // in his office, on his summons: stub the meet open
  CBZ.warden.meeting = () => true;
  check(CBZ.prisonSnitch.canTell(warden), "with nothing seen, there is still a name to put in");
  CBZ.prisonSnitch.open(warden);
  const items = CBZ.prisonSnitch.menu(warden);
  check(CBZ.prisonSnitch.label(items[0]) === "Name Duke", `the card offers "Name Duke" (got "${CBZ.prisonSnitch.label(items[0])}")`);
  const st0 = CBZ.game.wardenStanding || 0;
  CBZ.prisonSnitch.pick(warden, items[0]);
  W.run(20);
  const a = CBZ.prisonSnitch.audit();
  check(a.log.caught === 1, "the officer found nothing: the lie is caught");
  check((CBZ.game.wardenStanding || 0) < st0, `the warden holds it (standing ${st0} -> ${CBZ.game.wardenStanding})`);
  check(enemy._ratTarget === true, "and Duke knows who named him");
  check(!enemy._seg, "Duke was not punished for nothing");
  // a lie that turns out true
  const W2 = world({ warden: true });
  const holder = W2.inmate("Knox", 10, 4, { playerGrudge: 6, loadout: { items: ["Pills"], cigs: 2 } });
  W2.officer("Officer #6", 16, 8);
  const w2 = W2.officer("the Warden", 0.8, 0, { kind: "warden" });
  W2.CBZ.warden.meeting = () => true;
  W2.CBZ.prisonSnitch.open(w2);
  W2.CBZ.prisonSnitch.pick(w2, "tellA");
  W2.run(20);
  check(W2.CBZ.prisonSnitch.audit().log.caught === 0 && !holder.loadout.items.includes("Pills"), "a name on a man who IS holding checks out (the pills are gone)");
}

/* ---- 5. the warden orders; he does not run the law ---- */
console.log("5. the warden never cuffs or chases: he orders");
{
  const W = world({ warden: true });
  const { CBZ } = W;
  const warden = W.officer("the Warden", 0, 0, { kind: "warden" });
  const off = W.officer("Officer #7", 6, 0);
  warden.hunt = 4;
  CBZ.warden.body(warden, 0.1);
  check(warden.hunt === 0, "a hunt that landed on him is gone from him");
  check(off.hunt >= 3, "and on his officer instead");
  const fighter = W.inmate("Lugo", 5, 5);
  const off2 = W.officer("Officer #8", 7, 7);
  warden._yardCase = fighter;
  CBZ.warden.body(warden, 0.1);
  check(!warden._yardCase, "a yard case put on him is handed off");
  check(off2.pause > 0 && off2._facePt, "the officer stops and turns to him for the order");
  W.run(1.5);
  check(CBZ._cases.some((c) => c.gd !== warden && c.n === fighter), "the officer runs the case");
  check(!CBZ._cases.some((c) => c.gd === warden), "the warden cuffed nobody");
  check(W.said.some((s) => s.who === "Officer #8" && /sir/i.test(s.line)), "\"Sir.\"");
}

console.log(`\nsnitch-sim: ${checks - fails}/${checks} passed`);
process.exit(fails ? 1 : 0);
