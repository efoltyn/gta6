#!/usr/bin/env node
/* tools/president-sim-check.mjs — THE PRESIDENT WORLD, RUN FOR YEARS IN PLAIN NODE.

   No browser. Loads src/president/world.js + ai.js (the deterministic world
   model every President page and every multiplayer client runs) and checks
   that the one connected model behaves like an economy and like a map:

     scenarios   every scenario (Full World, the regions, the USA) boots: the
                 members it should have, each with a leader and a capital on
                 its own land, real numbers, a map frame on the map, sixty days
                 without a NaN
     data        every country row and every state row carries what a
                 country needs (leader, people, money, army, government)
     conquest    a scripted president CAN take everyone: Saudi Arabia, with a
                 war economy and one war at a time, annexes or puppets every
                 member of the Middle East, and the map shows his colour on
                 every city; annexing a puppet, and a beaten enemy yielding
     ai vs ai    N years of AI presidents in every scenario (seeds rotate):
                 no NaN/Infinity, prices positive, yields in range, every
                 living country a real GDP, the world happens (falls, wars);
                 the map moves (land changes hands somewhere) and does not
                 collapse (no run loses a quarter of its countries, or two
                 fifths of its cities change hands)
     bonds       a country that borrows hard (welfare +12% GDP) pays more for
                 money than the same country that does not
     war         air strikes on the world's biggest oil field cut its output
                 and raise the world oil price
     tariff      a 50% tariff on a supplier's steel cuts that supplier's
                 steel flow into the country that set it
     printing    printing money raises inflation and sinks the currency
     army        martial law hands the army power
     plot        a botched, discovered assassination costs you the world
     no gates    a country with no air force can still strike, a country
                 with no bombs can still try a nuke (outcomes differ, buttons do not)
     lockstep    the same seed + the same actions = the same world, byte for
                 byte, in the Full World and in a region

   node tools/president-sim-check.mjs [--years 10]
*/
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PW = require(path.join(ROOT, "src/president/world.js"));
require(path.join(ROOT, "src/president/ai.js"));
const SC = require(path.join(ROOT, "src/president/scenarios.js"));
const NA = require(path.join(ROOT, "src/president/nations.js"));
const ST = require(path.join(ROOT, "src/president/states.js"));

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : args[i + 1]; };
const YEARS = +arg("--years", 10);

let fails = 0, passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; console.log("  PASS " + name + (detail ? "  (" + detail + ")" : "")); }
  else { fails++; console.log("  FAIL " + name + (detail ? "  (" + detail + ")" : "")); }
}
const run = (S, days, acts) => { for (let d = 0; d < days; d++) PW.step(S, acts ? acts(S, d) : []); return S; };
const G = PW.GI;
// a country a test owns: seated "human" so no AI touches its levers
function seat(S, c) { PW.apply(S, { type: "seat", c: c, who: "test" }); }

// ------------------------------------------------------------ the data
console.log("DATA");
{
  const num = (v) => typeof v === "number" && isFinite(v);
  const badN = NA.list.filter((n) => !n.leader || !n.title || !num(n.pop) || !num(n.gdp) || !num(n.mil) || !num(n.troops) || !num(n.q) || !n.regime || !n.cities || !n.cities.length || !n.reg).map((n) => n.id);
  check("every country row is a whole country (leader, people, money, army, government, a capital)", !badN.length, badN.length ? badN.join(",") : NA.list.length + " countries, leaders as of " + NA.AS_OF);
  const badS = ST.list.filter((s) => !s.leader || !num(s.pop) || !num(s.gdp) || !num(s.guard) || !s.party || !s.cities.length).map((s) => s.id);
  check("every state row has its governor, people, economy and Guard", !badS.length && ST.list.length === 51, badS.length ? badS.join(",") : ST.list.length + " (50 states and DC)");
}

// ------------------------------------------------------------ every scenario boots
console.log("SCENARIOS");
const WANT = { world: [190, 200], mideast: [17, 17], africa: [54, 54], europe: [45, 52], asia: [30, 34], na: [23, 23], sa: [12, 12], americas: [35, 35], meaf: [70, 70], usa: [51, 51] };
for (const sc of SC.list) {
  const S = PW.create(5, { scen: sc.id });
  const M = PW.geo(S);
  const n = S.c.length, w = WANT[sc.id] || [1, 999];
  const noCap = S.c.filter((c) => c.cap < 0 || S.p[c.cap].owner !== c.id).map((c) => c.key);
  const fr = M.frame;
  run(S, 60);
  const js = JSON.stringify(S);
  const ok = n >= w[0] && n <= w[1] && !noCap.length && fr.w > 0 && fr.h > 0 && fr.y >= 0 && fr.y + fr.h <= M.H && !/NaN|Infinity/.test(js) && S.P.every((p) => p > 0);
  check(sc.name + " boots", ok, n + " members, " + S.p.length + " cities, frame " + fr.w + "x" + fr.h + " tiles" + (noCap.length ? ", no capital: " + noCap.join(",") : ""));
}

// ------------------------------------------------------------ conquest is possible
console.log("CONQUEST");
{
  // the pieces: a beaten country yields; a puppet can be annexed
  const S = PW.create(3, { scen: "mideast" });
  const sau = S.c.findIndex((c) => c.key === "sau"), yem = S.c.findIndex((c) => c.key === "yem");
  seat(S, sau);
  let w = null; for (let k = 0; k < 8 && !(w && w.ok); k++) w = PW.apply(S, { type: "war", c: sau, t: yem });
  const early = PW.apply(S, { type: "surrender", c: sau, t: yem });
  check("an enemy that is not beaten will not surrender", w && w.ok && !early.ok, early.why || "it gave up at once");
  // take Yemen's capital and most of its people, then ask
  const keep = S.p.filter((p) => p.owner === yem && p.id !== S.c[yem].cap).sort((a, b) => a.pop - b.pop)[0];
  for (const p of S.p) if (p.owner === yem && p.id !== S.c[yem].cap && p !== keep) { p.ctl = sau; S.tv++; }
  S.p[S.c[yem].cap].ctl = sau; S.tv++;
  const late = PW.apply(S, { type: "surrender", c: sau, t: yem });
  const m = S.c[sau].matters.find((x) => x.kind === "surrender");
  check("a beaten enemy surrenders, and the victor is asked what to do with it", late.ok && S.c[yem].lord === sau && !!m, late.ok ? "puppet now, the phone rings" : late.why);
  if (m) PW.apply(S, { type: "answer", c: sau, m: m.id, o: 0 });
  check("annexing it paints the whole country in the victor's colour", !S.c[yem].alive && S.p.filter((p) => p.ctl === yem).length === 0 && S.p.filter((p) => p.owner === sau).length > 7,
    S.p.filter((p) => p.owner === sau).length + " cities are Saudi");
}
{
  // the whole region, by a president who plays it straight: a war economy,
  // one war at a time against the weakest he can reach, peace when stuck
  const S = PW.create(7, { scen: "mideast" });
  const me = S.c.findIndex((c) => c.key === "sau");
  seat(S, me);
  const A = (a) => { a.c = me; return PW.apply(S, a); };
  const ANS = { surrender: 0, coup: 1, traitor: 1, callToArms: 1, polls: 0, unrest: 0, warning: 0, offer: 1, demand: 1, ultimatum: 1 };
  let warFrom = -1, warGain = 0, first = -1;
  const tried = {};
  for (let d = 0; d < 30 * 365 && !S.over; d++) {
    const c = S.c[me];
    if (!c.alive || c.out) break;
    for (const mm of c.matters.slice()) if (ANS[mm.kind] != null) A({ type: "answer", m: mm.id, o: ANS[mm.kind] });
    if (d % 30 === 0) {
      if (c.budget.military < 12) A({ type: "budget", k: "military", v: 12 });
      if (c.budget.research < 4) A({ type: "budget", k: "research", v: 4 });
      if (c.budget.security < 3) A({ type: "budget", k: "security", v: 3 });
      const def = -c.deficit / Math.max(1, c.gdp) * 100;
      if (def > 3 && c.tax < 55) A({ type: "tax", v: c.tax + 2 });
      if (def < -2 && c.tax > 20) A({ type: "tax", v: c.tax - 1 });
      if (c.unrest > 60) A({ type: "crackdown" });
    }
    const free = S.c.filter((o) => o.alive && o.id !== me && o.lord !== me);
    if (!c.war.length && d % 10 === 0 && free.length) {
      const cand = free.filter((o) => PW.reach(S, me, o.id) > 0).map((o) => {
        let s2 = PW.strength(o); for (const a of o.allies) if (S.c[a].alive && a !== me) s2 += PW.strength(S.c[a]) * 0.6;
        return { o, odds: PW.strength(c) / Math.max(0.1, s2) / (1 + (tried[o.id] || 0)) };
      }).sort((a, b) => b.odds - a.odds);
      if (cand.length && A({ type: "war", t: cand[0].o.id }).ok) { warFrom = S.day; warGain = c.gained; }
    }
    for (const e of c.war) A({ type: "posture", t: e, v: "attack" });
    if (d % 20 === 0) for (const e of c.war) A({ type: "surrender", t: e });
    if (c.war.length > 1 && d % 15 === 0) {
      const ws = c.war.slice().sort((a, b) => PW.strength(S.c[a]) - PW.strength(S.c[b]));
      for (const e of ws.slice(1)) A({ type: "peace", t: e, terms: "white" });
    }
    if (c.war.length && S.day - warFrom > 730 && c.gained <= warGain) {
      for (const e of c.war.slice()) { tried[e] = (tried[e] || 0) + 1; A({ type: "peace", t: e, terms: "white" }); }
      warFrom = S.day; warGain = c.gained;
    }
    for (const o of S.c) if (o.alive && o.lord === me) A({ type: "annex", t: o.id });
    PW.step(S, []);
    if (first < 0 && S.c.some((o) => !o.alive)) first = S.day;
  }
  const R = PW.realm(S, me);
  check("Saudi Arabia can conquer the whole Middle East", !!(S.over && S.over.winner === me && S.over.why === "conquest"),
    S.over ? (S.over.why + " in " + (S.day / 365).toFixed(1) + " years, " + R.conquered + " of " + R.rivals + " conquered") : R.conquered + " of " + R.rivals + " after " + (S.day / 365).toFixed(1) + " years");
  check("it takes effort, not a week", S.day > 365, (S.day / 365).toFixed(1) + " years");
  check("the map is his: his colour on every city", R.cities === R.of, R.cities + " of " + R.of + " cities");
}

// ------------------------------------------------------------ AI against AI, for years, in every scenario
console.log("AI VS AI: " + YEARS + " years in every scenario");
{
  const RUNS = [["world", 7], ["mideast", 21], ["africa", 99], ["europe", 7], ["asia", 21], ["na", 99], ["sa", 7], ["americas", 21], ["meaf", 99], ["usa", 7], ["usa", 21]];
  let moved = 0, worldMoved = 0;
  for (const [sc, seed] of RUNS) {
    const S = PW.create(seed, { scen: sc });
    const own0 = S.p.map((p) => p.owner);
    let bad = null, minP = Infinity, maxY = 0;
    for (let d = 0; d < YEARS * 365; d++) {
      PW.step(S, []);
      if (d % 30 === 0) {
        for (const p of S.P) minP = Math.min(minP, p);
        for (const c of S.c) if (c.alive) {
          maxY = Math.max(maxY, c.yld);
          if (!(c.gdp > 0) || !isFinite(c.gdp) || !isFinite(c.approval) || !isFinite(c.infl)) bad = bad || ("day " + d + " " + c.name + " gdp " + c.gdp);
        }
      }
    }
    const js = JSON.stringify(S);
    const changed = S.p.filter((p, i) => p.owner !== own0[i]).length, gone = S.c.filter((c) => !c.alive).length;
    const wars = S.log.filter((e) => e.k === "war").length, falls = S.fallen.length;
    moved += changed; if (sc === "world") worldMoved = changed;
    const L = sc + " seed " + seed;
    check(L + ": no NaN/Infinity, prices positive, yields in range", !/NaN|Infinity/.test(js) && minP > 0 && maxY > 0 && maxY <= 60, (js.length / 1024).toFixed(0) + " KB, lowest price " + minP.toPrecision(3) + ", highest yield " + maxY.toFixed(1) + "%");
    check(L + ": every living country has a real GDP", !bad, bad || S.c.filter((c) => c.alive).length + " alive");
    check(L + ": the world happens (falls, wars)", falls > 0, wars + " wars in the log, " + falls + " leaders fallen");
    check(L + ": no collapse", gone <= S.c.length * 0.25 && changed <= S.p.length * 0.4, changed + " of " + S.p.length + " cities changed hands, " + gone + " of " + S.c.length + " countries gone");
  }
  check("the map is not frozen: land changes hands, in the Full World too", moved > 0 && worldMoved > 0, moved + " cities across every run, " + worldMoved + " in the Full World");
}
// ------------------------------------------------------------ bonds respond
console.log("BONDS");
{
  const base = run(PW.create(7), 200);
  // the country with the lowest yield, so there is room to see it rise
  const c = base.c.findIndex(x => x.key === "deu");      // a solid borrower, so there is room to see it fall
  seat(base, c);
  const A = PW.clone(base), B = PW.clone(base);
  PW.apply(B, { type: "budget", c: c, k: "welfare", v: B.c[c].budget.welfare + 6 });
  run(A, 365); run(B, 365);
  const a = A.c[c], b = B.c[c];
  const defaulted = B.log.some(e => e.k === "default" && e.c === c);
  // the money owed (the ratio also moves with the GDP the spending buys)
  check("deficit spending raises debt (or ends in default)", defaulted || b.debt > a.debt * 1.03, "$" + Math.round(a.debt) + " bn -> $" + Math.round(b.debt) + " bn, " + (PW.debtRatio(a) * 100).toFixed(0) + "% -> " + (PW.debtRatio(b) * 100).toFixed(0) + "% of GDP" + (defaulted ? ", defaulted" : ""));
  check("the bond market charges for it", b.yld > a.yld + 0.5, a.yld.toFixed(2) + "% -> " + b.yld.toFixed(2) + "%");
  // and the full dose: a refinancing crisis
  const C = PW.clone(base);
  PW.apply(C, { type: "budget", c: c, k: "welfare", v: C.c[c].budget.welfare + 15 });
  run(C, 900);
  const crisis = C.log.some(e => (e.k === "crisis" || e.k === "default") && e.c === c) || C.c[c].defaulted > 0;
  check("spend far beyond your means and the market stops lending", crisis, "yield " + C.c[c].yld.toFixed(1) + "%, rating " + C.c[c].rating);
}

// ------------------------------------------------------------ war cuts supply
console.log("WAR");
{
  const base = run(PW.create(21), 120);
  // the single biggest oil field in the world
  let best = null, bo = 0;
  for (const p of base.p) { const n = p.fac.oil || 0; if (n > bo) { bo = n; best = p; } }
  const victim = best.ctl;
  const attacker = base.c.filter(x => x.alive && x.id !== victim).sort((a, b) => b.planes - a.planes)[0].id;
  seat(base, attacker); seat(base, victim);
  const A = PW.clone(base), B = PW.clone(base);
  const strike = (S, d) => d % 10 === 0 && d < 60 ? [{ type: "strike", c: attacker, t: victim, p: best.id, what: "oil" }] : [];
  const supA0 = A.c[victim].sup[G.oil];
  run(A, 90); run(B, 90, strike);
  check("the strikes hit the field", B.p[best.id].dmg.raw > 0.2, "damage " + (B.p[best.id].dmg.raw * 100).toFixed(0) + "%");
  check("the victim's oil output falls", B.c[victim].sup[G.oil] < A.c[victim].sup[G.oil] * 0.9, A.c[victim].sup[G.oil].toFixed(2) + " -> " + B.c[victim].sup[G.oil].toFixed(2) + " Mbbl/d (was " + supA0.toFixed(2) + ")");
  const pa = PW.worldPrice(A, "oil"), pb = PW.worldPrice(B, "oil");
  check("the world oil price rises", pb > pa * 1.03, "$" + pa.toFixed(1) + " -> $" + pb.toFixed(1));
  check("the attacker pays at the pump too", B.c[attacker].pl[G.fuel] > A.c[attacker].pl[G.fuel], "$" + A.c[attacker].pl[G.fuel].toFixed(1) + " -> $" + B.c[attacker].pl[G.fuel].toFixed(1) + "/bbl fuel at home");
}

// ------------------------------------------------------------ tariffs move trade
console.log("TARIFF");
{
  const base = run(PW.create(99), 90);
  // the biggest bilateral steel flow in the world that nobody has tariffed yet
  const F = base.flow[G.steel];
  let bi = -1, bj = -1, bf = 0;
  for (let i = 0; i < F.length; i++) for (let j = 0; j < F.length; j++) if (F[i][j] > bf && !base.c[i].tariffs[j]) { bf = F[i][j]; bi = i; bj = j; }
  seat(base, bi); seat(base, bj);
  const A = PW.clone(base), B = PW.clone(base);
  const r = PW.apply(B, { type: "tariff", c: bi, t: bj, good: "steel", v: 0.5 });
  run(A, 45); run(B, 45);
  const fa = PW.tradeFlow(A, bj, bi, "steel"), fb = PW.tradeFlow(B, bj, bi, "steel");
  check("the tariff is applied", r.ok, A.c[bi].name + " tariffs " + A.c[bj].name + " steel 50%");
  check("steel from the tariffed supplier falls", fb < fa * 0.8, fa.toFixed(4) + " -> " + fb.toFixed(4) + " Mt/d");
  check("steel costs more at home", B.c[bi].pl[G.steel] >= A.c[bi].pl[G.steel] * 0.999, "$" + A.c[bi].pl[G.steel].toFixed(0) + " -> $" + B.c[bi].pl[G.steel].toFixed(0) + "/t");
  check("relations pay for it", B.rel[bi][bj] < A.rel[bi][bj] - 5, A.rel[bi][bj].toFixed(0) + " -> " + B.rel[bi][bj].toFixed(0));
}

// ------------------------------------------------------------ printing money
console.log("PRINTING");
{
  const base = run(PW.create(7), 100);
  const c = base.c.findIndex(x => x.key === "deu"); seat(base, c);
  const A = PW.clone(base), B = PW.clone(base);
  PW.apply(B, { type: "print", c: c, v: 8 });
  run(A, 540); run(B, 540);
  check("printing raises inflation", B.c[c].infl > A.c[c].infl + 3, A.c[c].infl.toFixed(1) + "% -> " + B.c[c].infl.toFixed(1) + "%");
  check("printing sinks the currency", B.c[c].fx < A.c[c].fx * 0.9, A.c[c].fx.toFixed(3) + " -> " + B.c[c].fx.toFixed(3));
  check("the central bank leans against it", B.c[c].rate > A.c[c].rate, A.c[c].rate.toFixed(2) + "% -> " + B.c[c].rate.toFixed(2) + "%");
  // he likes you less, or he has had enough and gone (a new governor starts at 50)
  const quit = B.log.some(e => e.c === c && e.k === "resigned" && e.role === "bank") && !A.log.some(e => e.c === c && e.k === "resigned" && e.role === "bank");
  check("and the bank governor likes you less", quit || B.c[c].cab.bank.loyalty < A.c[c].cab.bank.loyalty, quit ? "he resigned" : A.c[c].cab.bank.loyalty.toFixed(0) + " -> " + B.c[c].cab.bank.loyalty.toFixed(0));
}

// ------------------------------------------------------------ the army's power
console.log("ARMY");
{
  const base = run(PW.create(21), 60);
  const c = base.c.filter(x => x.alive)[0].id; seat(base, c);
  const A = PW.clone(base), B = PW.clone(base);
  // the general may say no; ask until he says yes (that is a real answer too)
  let ok = false; for (let k = 0; k < 6 && !ok; k++) ok = PW.apply(B, { type: "martial", c: c, on: 1 }).ok;
  run(A, 200); run(B, 200);
  check("martial law is declared", ok && B.c[c].martial > 0);
  check("the army gains power", B.c[c].armyPower > A.c[c].armyPower + 15, A.c[c].armyPower.toFixed(0) + " -> " + B.c[c].armyPower.toFixed(0));
  check("freedom pays for it", B.c[c].freedom < A.c[c].freedom - 10, A.c[c].freedom.toFixed(0) + " -> " + B.c[c].freedom.toFixed(0));
}

// ------------------------------------------------------------ a plot found out
console.log("PLOT");
{
  const base = run(PW.create(7), 30);
  const c = base.c.findIndex(x => x.key === "fra"), t = base.c.findIndex(x => x.key === "irn"); seat(base, c);
  // find a stream position where the plot is discovered (the world decides)
  let B = null, res = null;
  for (let k = 0; k < 40; k++) {
    const T = PW.clone(base); T.rng = (T.rng + k * 7919) | 0;
    T.c[c].cab.security.loyalty = 100;
    const r = PW.apply(T, { type: "assassinate", c: c, t: t });
    if (r.ok && r.caught) { B = T; res = r; break; }
  }
  check("a discovered plot happens", !!B);
  if (B) {
    let sum0 = 0, sum1 = 0, n = 0;
    for (const o of base.c) if (o.id !== c && o.id !== t) { sum0 += base.rel[o.id][c]; sum1 += B.rel[o.id][c]; n++; }
    check("the world turns on you", sum1 / n < sum0 / n - 10, (sum0 / n).toFixed(0) + " -> " + (sum1 / n).toFixed(0) + " average relations");
    check("Holler hears it", B.c[c].heat.plot > 20, "plot heat " + B.c[c].heat.plot.toFixed(0));
  }
}

// ------------------------------------------------------------ nothing is gated
console.log("NO GATES");
{
  const S = run(PW.create(99), 30);
  const c = S.c.find(x => x.alive), t = S.c.find(x => x.alive && x.id !== c.id);
  seat(S, c.id);
  c.planes = 0; c.nukes = 0; c.cab.general.loyalty = 100; c.cab.general.hawk = 1;
  const p = S.p.find(q => q.ctl === t.id);
  // the General may refuse an unprovoked strike; that is an answer, not a gate
  let st = null; for (let k = 0; k < 8 && !(st && st.ok); k++) st = PW.apply(S, { type: "strike", c: c.id, t: t.id, p: p.id, what: "factories" });
  const ev = S.log.filter(e => e.k === "strike" && e.c === c.id).pop();
  check("no air force, the strike still flies", st && st.ok && ev && ev.wing > 0, ev ? ev.wing + " cruise missiles, " + ev.hit + " hit" : "no strike");
  let nk = null; for (let k = 0; k < 8 && !(nk && nk.ok); k++) nk = PW.apply(S, { type: "nuke", c: c.id, t: t.id });
  check("no bombs, the nuke is still a button", nk && nk.ok, nk && nk.stopped ? "it fizzled or was stopped" : "it went off");
  const bl = PW.apply(S, { type: "bailout", c: c.id, t: t.id, amt: c.gdp * 0.4, strings: "alliance" });
  check("a small treasury can still offer a bailout", bl.ok || bl.why === "no", bl.ok ? "taken" : "offered and refused");
}

// ------------------------------------------------------------ lockstep
console.log("LOCKSTEP");
{
  const acts = (S, d) => d === 40 ? [{ type: "tariff", c: 1, t: 2, good: "all", v: 0.25 }] : d === 80 ? [{ type: "war", c: 3, t: 4 }] : [];
  for (const scen of ["world", "mideast"]) {
    const A = run(PW.create(1234, { scen }), 400, acts);
    const B = run(PW.create(1234, { scen }), 400, acts);
    check(scen + ": same seed + same actions = same world", PW.checksum(A) === PW.checksum(B) && JSON.stringify(A) === JSON.stringify(B), "checksum " + PW.checksum(A).toString(16));
    const C2 = run(PW.clone(run(PW.create(1234, { scen }), 200, acts)), 200, (S, d) => acts(S, d + 200));
    check(scen + ": a snapshot resumes identically (join mid-game)", PW.checksum(C2) === PW.checksum(A) && JSON.stringify(C2) === JSON.stringify(A));
  }
}

console.log((fails ? "FAIL" : "PASS") + " president-sim-check: " + passes + " passed, " + fails + " failed");
process.exit(fails ? 1 : 0);
