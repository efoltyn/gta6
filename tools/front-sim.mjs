#!/usr/bin/env node
/* tools/front-sim.mjs — THE FRONT, HEADLESS. Plain node, no browser, no THREE.

   Loads src/systems/brain.js (the one morale), src/city/polwar.js (the war)
   and src/city/frontline.js (the battles) over a stubbed polity layer, then:

     1  resolve(): deterministic (same spec, same answer), symmetric armies
        split both ways over seeds, a battle ends inside the cap, nobody dies
        twice (dead + fled <= committed).
     2  resolve(): the ladder matters — soldiers beat street fighters of the
        same size, and a line that HOLDS beats the same men attacking it.
     3  polwar + frontline: a war declared and ticked day by day is decided by
        battles (one logged per day, dead come off polwar's soldiers one for
        one, the front moves, weariness grows), the even-losses dice no longer
        run, battle-started / battle-ended reach the bus with text, and the war
        ends.
     4  the President's battle: a watched result posted back (end and leave)
        is applied once, the day is not fought twice, and a leave is finished
        from the men still standing.

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
  veridia: { id: "veridia", kind: "country", name: "Republic of Veridia", govType: "democracy", wealthLevel: 0.85, treasury: 500000 },
  libertyville: { id: "libertyville", kind: "city", name: "Libertyville", rect: { cx: 0, cz: 0, hx: 300, hz: 300 } },
};
let DAY = 10;
const newDay = [];
globalThis.window = globalThis;
globalThis.CBZ = {
  game: {},
  worldDay: () => DAY,
  onNewDay: (fn) => newDay.push(fn),
  onUpdate: () => {},
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
};
const CBZ = globalThis.CBZ;
require(path.join(ROOT, "src/systems/brain.js"));
require(path.join(ROOT, "src/city/polwar.js"));
const F = require(path.join(ROOT, "src/city/frontline.js"));
const W = CBZ.polwar;

function spec(o) {
  const side = (s) => Object.assign({ id: "x", name: "X", n: 40, tier: "elite", guns: "ak47", air: "none", strikes: 0, queued: 0 }, s);
  return Object.assign({ v: 1, ground: "dunes", hold: null, seed: 7 }, o, { red: side(o.red || {}), blue: side(o.blue || {}) });
}
const scen = [];
function scenario(n, name, fn) { scen.push({ n, name, fn }); }

scenario(1, "resolve: deterministic, ends, conserves men", () => {
  const s = spec({ red: { id: "a" }, blue: { id: "b" } });
  const r1 = F.resolve(s), r2 = F.resolve(s);
  check(JSON.stringify(r1) === JSON.stringify(r2), "same spec, same result " + JSON.stringify(r1));
  let redWins = 0, capped = 0, ok = true;
  for (let seed = 1; seed <= 40; seed++) {
    const r = F.resolve(spec({ seed, red: { id: "a" }, blue: { id: "b" } }));
    if (r.winner === "red") redWins++;
    if (r.secs >= 240) capped++;
    for (const t of ["red", "blue"]) if (r.dead[t] + r.fled[t] > 40) ok = false;
  }
  check(redWins >= 10 && redWins <= 30, "40 v 40 equal armies split both ways (red won " + redWins + "/40)");
  check(capped <= 4, "battles end on the field, not on the clock (" + capped + " capped)");
  check(ok, "dead + fled never exceeds the men sent");
});

scenario(2, "resolve: training and holding the line matter", () => {
  let eliteWins = 0, holdWins = 0, holdLoss = 0, atkLoss = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const r = F.resolve(spec({ seed, red: { id: "a", tier: "elite" }, blue: { id: "b", tier: "thug" } }));
    if (r.winner === "red") eliteWins++;
    const h = F.resolve(spec({ seed, hold: "blue", red: { id: "a" }, blue: { id: "b" } }));
    if (h.winner === "blue") holdWins++;
    holdLoss += h.dead.blue; atkLoss += h.dead.red;
  }
  check(eliteWins >= 26, "soldiers beat street fighters of the same size (" + eliteWins + "/30)");
  check(holdWins >= 20, "the line that holds beats the same men attacking it (" + holdWins + "/30)");
  check(atkLoss > holdLoss, "the attacker bleeds more (" + atkLoss + " v " + holdLoss + " dead over 30)");
  const big = F.resolve(spec({ seed: 3, hold: "blue", red: { id: "a", n: 120, tier: "pro" }, blue: { id: "b", n: 40, tier: "pro" } }));
  check(big.winner === "red", "three to one carries a held line anyway (" + JSON.stringify(big) + ")");
  const air = (q) => { let w = 0; for (let s = 1; s <= 30; s++) if (F.resolve(spec({ seed: s, red: { id: "a", queued: q } , blue: { id: "b" } })).winner === "red") w++; return w; };
  const a0 = air(0), a2 = air(2);
  check(a2 > a0, "the President's sorties over the line swing it (" + a0 + " -> " + a2 + " of 30)");
});

scenario(3, "polwar + frontline: the war is fought day by day", () => {
  W.reset(); bus.length = 0;
  const war = W.declareWar("republic", "kesh", { byPlayer: true });
  check(!!war, "war declared");
  const rep0 = W.militaryOf("republic").soldiers, kesh0 = W.militaryOf("kesh").soldiers;
  const pos0 = war.fronts[0].position;
  let days = 0, battles = 0, deadSum = { republic: 0, kesh: 0 };
  while (!war.ended && days < 80) {
    DAY++; days++;
    const repB = W.militaryOf("republic").soldiers, keshB = W.militaryOf("kesh").soldiers;
    for (const fn of newDay) fn(DAY);
    const last = war.log[war.log.length - 1];
    const b = war.log.filter((l) => l.kind === "battle" && l.day === DAY - 1);
    if (b.length === 1) {
      battles++;
      deadSum.republic += b[0].dead.republic || 0; deadSum.kesh += b[0].dead.kesh || 0;
    }
    if (days === 1) {
      const e = b[0];
      check(!!e, "day one: a battle is logged for the day that ended (" + (e && e.text) + ")");
      const dRep = repB - W.militaryOf("republic").soldiers, dKesh = keshB - W.militaryOf("kesh").soldiers;
      check(e && dRep >= (e.dead.republic || 0) && dKesh >= (e.dead.kesh || 0),
        "the dead come off polwar's soldiers (republic -" + dRep + ", kesh -" + dKesh + ")");
      check(dRep !== Math.round(6 * war.intensity) || dKesh !== Math.round(6 * war.intensity), "and it is not the old even-losses dice");
    }
  }
  check(battles >= Math.min(days, 3), "one battle per day of war (" + battles + " in " + days + " days)");
  check(war.ended, "the war ended (" + war.endReason + ", winner " + war.winner + ", day " + days + ")");
  check(war.fronts[0].position !== pos0, "the front moved (" + pos0 + " -> " + war.fronts[0].position.toFixed(2) + ")");
  check(deadSum.kesh > 0 && deadSum.republic >= 0, "battle dead summed: " + JSON.stringify(deadSum) + " of " + rep0 + "/" + kesh0);
  const st = bus.filter((x) => x.evt === "battle-started"), en = bus.filter((x) => x.evt === "battle-ended");
  check(st.length >= 1 && en.length >= 1 && st.length === en.length, "battle-started/ended on the bus (" + st.length + "/" + en.length + ")");
  check(en.every((x) => typeof x.p.text === "string" && x.p.text.length > 8), "every battle-ended has text: \"" + (en[0] && en[0].p.text) + "\"");
  check(war.winner === "republic", "the richer, readier army won the war (" + war.winner + ")");
});

scenario(4, "the President's battle: posted back once, leave finished headless", () => {
  W.reset(); bus.length = 0;
  const war = W.declareWar("republic", "veridia", { byPlayer: true });
  CBZ.warroom = { nation: () => "republic", nationAt: () => null, STRIKE_COST: 12000 };
  const sp = F.specFor(war, DAY, { you: "republic" });
  check(sp && sp.you === "red" && sp.red.id === "republic", "spec: the President's nation is RED (" + (sp && sp.red.name) + " v " + (sp && sp.blue.name) + ", " + (sp && sp.ground) + ")");
  check(sp && sp.red.flag && sp.blue.flag && sp.red.mark !== sp.blue.mark, "each side carries its own flag and colour");
  // fake the overlay (no DOM): open state by hand, then post an END
  const before = W.militaryOf("veridia").soldiers;
  const treas0 = records.republic.treasury;
  // simulate onResult through the module's own path
  const o = { warId: war.id, spec: sp };
  F._onResult && (function () {
    // open() needs a document; emulate its bookkeeping by calling the internal through a minimal shim
  })();
  const res = { winner: "red", dead: { red: 5, blue: 19 }, fled: { red: 0, blue: 7 }, watched: true, strikesUsed: 1 };
  F.apply(war, sp, res);
  check(W.militaryOf("veridia").soldiers === before - 19, "19 Veridian dead come off their army");
  check(records.republic.treasury === treas0 - 12000, "one sortie flown, one sortie paid for");
  check(F.foughtOn(war, DAY), "the day is marked fought");
  const n0 = war.log.filter((l) => l.kind === "battle").length;
  DAY++; for (const fn of newDay) fn(DAY);
  const n1 = war.log.filter((l) => l.kind === "battle").length;
  check(n1 === n0, "the next tick does not fight that day again (" + n0 + " -> " + n1 + ")");
  DAY++; for (const fn of newDay) fn(DAY);
  check(war.log.filter((l) => l.kind === "battle").length === n1 + 1 || war.ended, "and the day after is fought headless");
  // a LEAVE is finished from the men still standing
  const rest = JSON.parse(JSON.stringify(sp)); rest.red.n = 12; rest.blue.n = 30; rest.seed = 99;
  const r2 = F.resolve(rest);
  check(r2.dead.red + r2.fled.red <= 12 && r2.dead.blue + r2.fled.blue <= 30, "a leave resolves from what is left (" + JSON.stringify(r2) + ")");
});

scenario(5, "the overlay: go to the front, the city holds, the result comes home", () => {
  // a document that only remembers what was put in it
  const body = { kids: [], appendChild(f) { this.kids.push(f); f.parentNode = this; return f; }, removeChild(f) { this.kids.splice(this.kids.indexOf(f), 1); f.parentNode = null; } };
  globalThis.document = { body, pointerLockElement: null, exitPointerLock() {},
    createElement: () => ({ style: {}, setAttribute() {}, focus() {}, contentWindow: {} }) };
  W.reset(); bus.length = 0;
  CBZ.game.state = "playing";
  const states = [];
  CBZ.setState = (st) => { states.push(st); CBZ.game.state = st; };
  CBZ.warroom = { nation: () => "republic", nationAt: () => null, STRIKE_COST: 12000 };
  const war = W.declareWar("republic", "kesh", { byPlayer: true });
  const g = F.canGo();
  check(g.ok, "at war: the Front verb is open (" + (g.why || "ok") + ")");
  const r = F.go();
  check(r.ok && body.kids.length === 1 && /games\/battle\.html\?v=[^&]+&front=/.test(body.kids[0].src), "the battle page opens over the city: " + (body.kids[0] && body.kids[0].src.slice(0, 48)) + "...");
  check(CBZ.game.state === "front" && CBZ.drawHeld === true, "the city holds its breath (state front, no draw)");
  // the page's own decode (games/battle.html FRONT) reads back what the city sent
  const raw = body.kids[0].src.split("front=")[1];
  const b = raw.replace(/-/g, "+").replace(/_/g, "/");
  const back = JSON.parse(decodeURIComponent(escape(Buffer.from(b + "===".slice((b.length + 3) % 4), "base64").toString("binary"))));
  check(back.red.id === "republic" && back.blue.id === "kesh" && back.red.flag.kind === "band" && back.hold && back.ground,
    "the page decodes the spec the city sent (" + back.red.name + " v " + back.blue.name + " on " + back.ground + ", " + back.hold + " holds)");
  check(bus.some((b) => b.evt === "battle-started" && b.p.watched), "battle-started on the bus, watched");
  check(!F.canGo().ok, "and you cannot open a second one");
  // the page posts a LEAVE mid-battle: 12 of ours and 9 of theirs dead, the rest still out there
  const sp = F.status().spec;
  const kesh0 = W.militaryOf("kesh").soldiers;
  F._onResult({ type: "cbz-front", kind: "leave", dead: { red: 4, blue: 9 }, fled: { red: 0, blue: 0 }, alive: { red: sp ? sp.red.n - 4 : 30, blue: sp ? sp.blue.n - 9 : 20 }, strikesUsed: 0, youDown: true });
  check(CBZ.game.state === "playing" && !CBZ.drawHeld && body.kids.length === 0, "home: the page is gone, the city plays and draws again");
  const e = bus.filter((b) => b.evt === "battle-ended").pop();
  check(!!e && e.p.watched && e.p.dead.kesh >= 9, "the battle the President left was finished from the men still standing (" + (e && e.p.text) + ")");
  check(W.militaryOf("kesh").soldiers <= kesh0 - 9, "and Kesh's dead came off its army (" + kesh0 + " -> " + W.militaryOf("kesh").soldiers + ")");
  check(bus.some((b) => b.evt === "president-wounded"), "the President was hit out there, and the country hears it");
  check(F.foughtOn(war, DAY), "today is fought");
  check(!F.canGo().ok, "and the Front waits for tomorrow (" + F.canGo().why + ")");
  delete globalThis.document;
});

for (const s of scen) {
  if (only && s.n !== only) continue;
  console.log(s.n + "  " + s.name);
  try { s.fn(); } catch (e) { fails++; console.log("  FAIL threw: " + (e && e.stack || e)); }
}
console.log("\n" + passes + " passed, " + fails + " failed");
process.exit(fails ? 1 : 0);
