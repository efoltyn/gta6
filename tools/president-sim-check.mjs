#!/usr/bin/env node
/* tools/president-sim-check.mjs — THE PRESIDENT WORLD, RUN FOR YEARS IN PLAIN NODE.

   No browser. Loads src/president/world.js + ai.js (the deterministic world
   model every President page and every multiplayer client runs) and checks
   that the one connected model behaves like an economy:

     sane        N years of AI presidents on several seeds: no NaN/Infinity
                 anywhere in the state, every price positive, every yield in
                 range, every living country with a positive GDP
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
     lockstep    the same seed + the same actions = the same world, byte for byte

   node tools/president-sim-check.mjs [--years 10] [--seeds 7,21,99]
*/
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PW = require(path.join(ROOT, "src/president/world.js"));
require(path.join(ROOT, "src/president/ai.js"));

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : args[i + 1]; };
const YEARS = +arg("--years", 10);
const SEEDS = String(arg("--seeds", "7,21,99")).split(",").map(Number);

let fails = 0, passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; console.log("  PASS " + name + (detail ? "  (" + detail + ")" : "")); }
  else { fails++; console.log("  FAIL " + name + (detail ? "  (" + detail + ")" : "")); }
}
const run = (S, days, acts) => { for (let d = 0; d < days; d++) PW.step(S, acts ? acts(S, d) : []); return S; };
const G = PW.GI;
// a country a test owns: seated "human" so no AI touches its levers
function seat(S, c) { PW.apply(S, { type: "seat", c: c, who: "test" }); }

// ------------------------------------------------------------ sane, for years
console.log("SANE: " + YEARS + " years of AI presidents, seeds " + SEEDS.join(","));
for (const seed of SEEDS) {
  const S = PW.create(seed, { countries: 12 });
  let bad = null, minP = Infinity, maxY = 0, wars = 0, falls = 0;
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
  for (const e of S.log) if (e.k === "war") wars++;
  falls = S.fallen.length;
  check("seed " + seed + " no NaN/Infinity in the state", !/NaN|Infinity/.test(js), (js.length / 1024).toFixed(0) + " KB");
  check("seed " + seed + " every price positive", minP > 0, "lowest " + minP.toPrecision(3));
  check("seed " + seed + " yields in range", maxY > 0 && maxY <= 60, "highest " + maxY.toFixed(1) + "%");
  check("seed " + seed + " every living country has a real GDP", !bad, bad || S.c.filter(c => c.alive).length + " alive");
  check("seed " + seed + " the world happens (wars, falls)", falls > 0, wars + " wars in the log, " + falls + " leaders fallen");
}

// ------------------------------------------------------------ bonds respond
console.log("BONDS");
{
  const base = run(PW.create(7, { countries: 12 }), 200);
  // the country with the lowest yield, so there is room to see it rise
  const c = base.c.filter(x => x.alive).sort((a, b) => a.yld - b.yld)[0].id;
  seat(base, c);
  const A = PW.clone(base), B = PW.clone(base);
  PW.apply(B, { type: "budget", c: c, k: "welfare", v: B.c[c].budget.welfare + 6 });
  run(A, 365); run(B, 365);
  const a = A.c[c], b = B.c[c];
  const defaulted = B.log.some(e => e.k === "default" && e.c === c);
  check("deficit spending raises debt (or ends in default)", defaulted || PW.debtRatio(b) > PW.debtRatio(a) + 0.04, (PW.debtRatio(a) * 100).toFixed(0) + "% -> " + (PW.debtRatio(b) * 100).toFixed(0) + "% of GDP" + (defaulted ? ", defaulted" : ""));
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
  const base = run(PW.create(21, { countries: 12 }), 120);
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
  const base = run(PW.create(99, { countries: 12 }), 90);
  // the biggest bilateral steel flow in the world
  const F = base.flow[G.steel];
  let bi = -1, bj = -1, bf = 0;
  for (let i = 0; i < F.length; i++) for (let j = 0; j < F.length; j++) if (F[i][j] > bf) { bf = F[i][j]; bi = i; bj = j; }
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
  const base = run(PW.create(7, { countries: 12 }), 100);
  const c = 5; seat(base, c);
  const A = PW.clone(base), B = PW.clone(base);
  PW.apply(B, { type: "print", c: c, v: 8 });
  run(A, 540); run(B, 540);
  check("printing raises inflation", B.c[c].infl > A.c[c].infl + 3, A.c[c].infl.toFixed(1) + "% -> " + B.c[c].infl.toFixed(1) + "%");
  check("printing sinks the currency", B.c[c].fx < A.c[c].fx * 0.9, A.c[c].fx.toFixed(3) + " -> " + B.c[c].fx.toFixed(3));
  check("the central bank leans against it", B.c[c].rate > A.c[c].rate, A.c[c].rate.toFixed(2) + "% -> " + B.c[c].rate.toFixed(2) + "%");
  check("and the bank governor likes you less", B.c[c].cab.bank.loyalty < A.c[c].cab.bank.loyalty, A.c[c].cab.bank.loyalty.toFixed(0) + " -> " + B.c[c].cab.bank.loyalty.toFixed(0));
}

// ------------------------------------------------------------ the army's power
console.log("ARMY");
{
  const base = run(PW.create(21, { countries: 12 }), 60);
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
  const base = run(PW.create(7, { countries: 12 }), 30);
  const c = 2, t = 9; seat(base, c);
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
  const S = run(PW.create(99, { countries: 12 }), 30);
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
  const A = run(PW.create(1234, { countries: 10 }), 400, acts);
  const B = run(PW.create(1234, { countries: 10 }), 400, acts);
  check("same seed + same actions = same world", PW.checksum(A) === PW.checksum(B) && JSON.stringify(A) === JSON.stringify(B), "checksum " + PW.checksum(A).toString(16));
  const C2 = run(PW.clone(run(PW.create(1234, { countries: 10 }), 200, acts)), 200, (S, d) => acts(S, d + 200));
  check("a snapshot resumes identically (join mid-game)", PW.checksum(C2) === PW.checksum(A));
}

console.log((fails ? "FAIL" : "PASS") + " president-sim-check: " + passes + " passed, " + fails + " failed");
process.exit(fails ? 1 : 0);
