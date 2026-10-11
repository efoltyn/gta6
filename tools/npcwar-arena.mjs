#!/usr/bin/env node
/* tools/npcwar-arena.mjs — WHO ACTUALLY WINS? NPC War's balance, by the
   hundred, in node.

   The owner's idea: NPC War is a fast sim, so let it dogfood the animals.
   Is one tiger beating a hundred men? Is punching broken? This runs a matchup
   over N seeds of the page's OWN sim (tools/lib/npcwar-node.mjs: the
   src/battle + src/units scripts, the real bestiary, gait rig, traits,
   creature_combat, ape_combat, combat_iq, ballistics), in parallel worker
   processes, and reports:

     win %          side A's wins over the seeds (a 95% Wilson interval with it)
     time           sim seconds to the decision (resolved runs)
     casualties     mean dead / fled / standing per side
     causes         who dealt what: shots (by gun), bites and strikes (by the
                    animal's move style), fists, vehicle guns, blasts, crushes;
                    hits, damage and kills each, per run
     wounds         where the rounds landed (zone) and what they reached (organ)
     morale         army breaks and rallies (brain.morale's events), and how
                    many men routed at least once

   Every matchup in data/npcwar/expectations.json carries a real-world band;
   the report marks each one IN, OUT (point estimate outside the band) or FAR
   (the whole 95% interval outside it).

     node tools/npcwar-arena.mjs                         the whole table
     node tools/npcwar-arena.mjs --only tiger            matchups whose id has "tiger"
     node tools/npcwar-arena.mjs --fast                  the balance-check subset
     node tools/npcwar-arena.mjs --seeds 24 --jobs 4
     node tools/npcwar-arena.mjs --a bengal_tiger --b men --n 1v10 --bw fists --bt civ [--gap 20] [--arena dunes]
     node tools/npcwar-arena.mjs --q "?a=lion&b=bengal_tiger&n=1v1"      a raw page URL
     node tools/npcwar-arena.mjs --json out.json         write the full results there too
     node tools/npcwar-arena.mjs ... --noswap            never swap the slots (A is always red)

   Workers: os.cpus() minus headroom (2), halved again when the load average
   is already over the core count, never more than the jobs. --jobs N
   overrides. Each worker boots one battle at a time and is recycled after 24.
   Results land in ~/harness/out/gta6/npcwar-arena/<stamp>.json (+ .txt).

   Node only. No Chrome.                                                     */
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fork, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { boot, settle, run, realBoom, BEAST_PACKS, FIGHT_FILES, ROOT } from "./lib/npcwar-node.mjs";
const TOOL_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const SELF = fileURLToPath(import.meta.url);
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };

/* ================================================================ ONE BATTLE
   (runs in a worker) */
function urlFor(mu) {
  if (mu.q) return mu.q.includes("auto=1") ? mu.q : mu.q + "&auto=1&probe=0";
  const p = new URLSearchParams();
  for (const k of ["a", "b", "n", "arena", "aw", "at", "bw", "bt", "as", "bs", "af", "bf", "hold"]) if (mu[k] != null) p.set(k, String(mu[k]));
  if (!p.has("arena")) p.set("arena", "dunes");
  p.set("auto", "1"); p.set("probe", "0");
  return "?" + p.toString();
}
function classify(m, imp) {
  imp = imp || {};
  const by = imp.by;
  if (imp.cause) return imp.cause === "explosion" && by && by.vehicle ? "blast:" + (by.unitId || "vehicle") : imp.cause;
  if (imp.bullet) return "shot:" + ((by && (by.wid || (by.weapon && by.weapon.id))) || "gun");
  if (imp.pen != null) return "round-on-armour";
  if (by && by.vehicle) return "vehicle-gun:" + (by.unitId || "?");
  if (by && by.beast) return (by.species ? by.species.id : "beast") + ":" + (by._atkStyle || "strike");
  if (by && !by.beast && !by.vehicle) return by.armed ? "melee-armed" : "fists";
  if (imp.byTeam) return "ordnance";
  return "other";
}
/* SIDES ARE SWAPPED ON ODD SEEDS. The open grounds used to deal one slot the
   better ground (30 v 30 identical riflemen went 83% to the first slot); the
   erg is folded on its centre line now (arenas/erg.js FOLD), but a raised
   venue is still a real place. So side A takes the first slot on even seeds
   and the second on odd ones, and every number below is reported by roster,
   not by slot. --noswap turns it off, to measure the slots themselves. */
let SWAP = false;
const RA = () => (SWAP ? "blue" : "red"), RB = () => (SWAP ? "red" : "blue");
const sideOf = (t) => (t === RA() ? "A" : t === RB() ? "B" : "?");
function swapped(mu) {
  const o = Object.assign({}, mu);
  for (const [x, y] of [["a", "b"], ["aw", "bw"], ["at", "bt"], ["as", "bs"], ["af", "bf"]]) { o[x] = mu[y]; o[y] = mu[x]; }
  if (typeof mu.n === "string" && mu.n.includes("v")) o.n = mu.n.split("v").reverse().join("v");
  for (const k in o) if (o[k] === undefined) delete o[k];
  return o;
}
function victimKind(m) { return m.vehicle ? (m.unitId || "vehicle") : m.beast ? (m.species ? m.species.id : "beast") : "man"; }

async function oneBattle(mu, seed) {
  const t0 = Date.now();
  // ?seed= is the page's own (settings.js BATTLE_SEED: lcg + the size draw);
  // opts.seed seeds the engine files' Math.random and the world jitter
  SWAP = mu.swap !== false && !mu.q && (seed & 1) === 1;
  const W = boot(urlFor(SWAP ? swapped(mu) : mu) + "&seed=" + seed, { packs: BEAST_PACKS, files: FIGHT_FILES, seed });
  if (W.err) return { seed, err: String(W.err && W.err.stack || W.err).slice(0, 400) };
  realBoom(W);
  await settle();
  const sb = W.sb;
  /* --gap: the two lines start this far apart instead of the map's own
     no-man's land (150 m on the dunes). The close-range ambush lives here. */
  if (mu.gap != null) {
    const MAP = vm.runInContext("MAP", sb);
    const g0 = MAP.gap, cx = MAP.cx;
    const sp = MAP.spawnAt;
    MAP.spawnAt = function (team, i, r) {
      const at = sp.apply(this, arguments);
      const side = team === "red" ? -1 : 1;   // the slot's side of the field
      at.x -= side * (g0 - +mu.gap) / 2;
      return at;
    };
  }
  // ---- the ledger: every blow through the one damage funnel
  const L = { by: { A: {}, B: {} }, killedBy: { A: {}, B: {} }, zones: { A: {}, B: {} }, organs: { A: {}, B: {} }, events: {}, routed: new Set(), firstBlood: null };
  const hm = sb.hurtMan;
  sb.hurtMan = function (m, dmg, imp) {
    if (!m || m.dead || m.fled) return hm.apply(this, arguments);
    const hp0 = m.hp;
    const r = hm.apply(this, arguments);
    const src = classify(m, imp);
    const vs = sideOf(m.team);
    const as = vs === "A" ? "B" : "A";          // a blow on A is dealt by B (fratricide is rare and noted as such)
    const by = imp && imp.by;
    const att = by && by.team ? sideOf(by.team) : as;
    const key = (att === vs ? "friendly:" : "") + src;
    const row = L.by[att === "?" ? as : att][key] || (L.by[att === "?" ? as : att][key] = { hits: 0, dmg: 0, kills: 0 });
    row.hits++;
    row.dmg += Math.max(0, Math.min(hp0, hp0 - Math.max(0, m.hp)));
    if (m.dead) {
      row.kills++;
      const kk = victimKind(m) + " <- " + key;
      L.killedBy[vs][kk] = (L.killedBy[vs][kk] || 0) + 1;
      if (L.firstBlood == null) L.firstBlood = +vm.runInContext("simT", sb).toFixed(1);
    }
    if (imp && imp.bullet) {
      if (imp.zone) L.zones[vs][imp.zone] = (L.zones[vs][imp.zone] || 0) + 1;
      if (imp.organ) L.organs[vs][imp.organ] = (L.organs[vs][imp.organ] || 0) + 1;
    }
    return r;
  };
  const we = sb.warEvent;
  if (typeof we === "function") {
    sb.warEvent = function (kind, d) {
      if (kind !== "streak") { const k = sideOf(d && d.team) + ":" + kind; L.events[k] = (L.events[k] || 0) + 1; }
      return we.apply(this, arguments);
    };
  }
  const B = W.B();
  const maxT = mu.maxT || 300;
  let nA = 0, nB = 0, counted = false;
  run(W, maxT, () => {
    const R = B.roster();
    if (!counted && R.length) {
      // the field is up once the spawn queue has drained (spawns stream in)
      const q = vm.runInContext("spawnQueue.length", sb);
      if (q === 0) { counted = true; for (const m of R) { if (m.team === RA()) nA++; else nB++; } }
    }
    for (const m of R) if (m.routed && !m.beast && !m.vehicle) L.routed.add(m.id);
    return true;
  });
  const T = B.tally();
  const A = B.audit();
  const arms = W.CBZ.battleArms && W.CBZ.battleArms.audit ? W.CBZ.battleArms.audit() : null;
  // the sent count, by the ledger the page itself keeps
  const a = RA(), b = RB();
  const sent = { A: T.dead[a] + T.fled[a] + T.alive[a], B: T.dead[b] + T.fled[b] + T.alive[b] };
  const beasts = {};
  for (const m of new Set(B.roster().concat(vm.runInContext("corpses", sb) || []))) {
    if (!m.beast) continue;
    const k = sideOf(m.team) + ":" + m.species.id;
    const b = beasts[k] || (beasts[k] = { n: 0, hp: m.maxHp, size: [], kills: 0, hpLeft: 0 });
    b.n++; b.kills += m.kills || 0; b.size.push(+(m._sizeMul || 1).toFixed(2)); b.hpLeft += m.dead ? 0 : Math.max(0, m.hp);
  }
  return {
    seed, wallMs: Date.now() - t0,
    winner: T.winner ? sideOf(T.winner) : null, swapped: SWAP,
    over: !!A.over, t: +T.simT.toFixed(1),
    sent, dead: { A: T.dead[a], B: T.dead[b] }, fled: { A: T.fled[a], B: T.fled[b] }, alive: { A: T.alive[a], B: T.alive[b] },
    shots: { A: A.stats[a].shots, B: A.stats[b].shots }, hits: { A: A.stats[a].hits, B: A.stats[b].hits },
    by: L.by, killedBy: L.killedBy, zones: L.zones, organs: L.organs, events: L.events, routed: L.routed.size,
    firstBlood: L.firstBlood, beasts, why: arms && arms.why ? arms.why : null,
  };
}


/* ================================================================ THE POOL */
export function jobCap(want) {
  const cores = os.cpus().length;
  let cap = Math.max(1, cores - 2);
  const load = os.loadavg()[0];
  if (load > cores) cap = Math.max(1, Math.floor(cap / 2));
  if (load > cores * 4) cap = Math.max(1, Math.min(cap, 2));
  return Math.max(1, Math.min(want || cap, cap));
}
export function runPool(jobs, nWorkers, onDone) {
  return new Promise((resolve) => {
    const out = [];
    let next = 0, live = 0;
    if (!jobs.length) return resolve(out);
    const spawnW = () => {
      const w = fork(SELF, ["--worker"], { stdio: ["ignore", "ignore", "inherit", "ipc"], execArgv: ["--max-old-space-size=2048"] });
      w._n = 0; live++;
      const feed = () => {
        if (next >= jobs.length || w._n >= 24) { w.send("exit"); return; }
        w._n++; w._job = jobs[next++];
        w.send(w._job);
      };
      w.on("message", (r) => { out.push(r); if (onDone) onDone(r, out.length, jobs.length); feed(); });
      w.on("exit", () => {
        live--;
        if (w._job && !out.some((r) => r.id === w._job.mu.id && r.seed === w._job.seed)) out.push({ id: w._job.mu.id, seed: w._job.seed, err: "worker died" });
        if (next < jobs.length) spawnW();
        else if (live === 0) resolve(out);
      });
      feed();
    };
    for (let i = 0; i < Math.min(nWorkers, jobs.length); i++) spawnW();
  });
}

/* ================================================================ SUMMARY */
export function wilson(k, n, z = 1.96) {
  if (!n) return [0, 1];
  const p = k / n, d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
export function summarize(mu, runs) {
  const ok = runs.filter((r) => !r.err);
  const n = ok.length;
  const winsA = ok.filter((r) => r.winner === "A").length, winsB = ok.filter((r) => r.winner === "B").length;
  const draws = n - winsA - winsB;
  const mean = (f) => (n ? ok.reduce((s, r) => s + f(r), 0) / n : 0);
  const resolved = ok.filter((r) => r.over);
  const tMean = resolved.length ? resolved.reduce((s, r) => s + r.t, 0) / resolved.length : null;
  const merge = (pick) => {
    const o = {};
    for (const r of ok) { const src = pick(r) || {}; for (const k in src) { const v = src[k]; if (typeof v === "number") o[k] = (o[k] || 0) + v; else { const t = o[k] || (o[k] = {}); for (const j in v) t[j] = (t[j] || 0) + v[j]; } } }
    for (const k in o) { if (typeof o[k] === "number") o[k] = +(o[k] / Math.max(1, n)).toFixed(2); else for (const j in o[k]) o[k][j] = +(o[k][j] / Math.max(1, n)).toFixed(1); }
    return o;
  };
  const pA = n ? winsA / n : 0;
  const ci = wilson(winsA, n);
  let verdict = "-";
  const band = mu.band && mu.band.winA;
  if (band && n) {
    if (pA >= band[0] - 1e-9 && pA <= band[1] + 1e-9) verdict = "IN";
    else if (ci[1] < band[0] || ci[0] > band[1]) verdict = "FAR";
    else verdict = "OUT";
  }
  // secondary bands: the loser's share dead, time
  const extra = [];
  if (mu.band && mu.band.deadB && n) {
    const f = mean((r) => r.dead.B / Math.max(1, r.sent.B));
    if (f < mu.band.deadB[0] || f > mu.band.deadB[1]) extra.push("deadB " + (f * 100).toFixed(0) + "% outside " + mu.band.deadB.map((x) => x * 100 + "%").join("-"));
  }
  if (mu.band && mu.band.deadA && n) {
    const f = mean((r) => r.dead.A / Math.max(1, r.sent.A));
    if (f < mu.band.deadA[0] || f > mu.band.deadA[1]) extra.push("deadA " + (f * 100).toFixed(0) + "% outside " + mu.band.deadA.map((x) => x * 100 + "%").join("-"));
  }
  if (extra.length && verdict === "IN") verdict = "OUT";
  return {
    id: mu.id, label: mu.label || mu.id, url: urlFor(mu), gap: mu.gap, n, errors: runs.length - n, errSample: runs.filter((r) => r.err).slice(0, 2).map((r) => r.err),
    winA: +pA.toFixed(3), ci: ci.map((x) => +x.toFixed(2)), winsA, winsB, draws, band: band || null, verdict, extra,
    tMean: tMean == null ? null : +tMean.toFixed(1),
    sent: { A: mean((r) => r.sent.A), B: mean((r) => r.sent.B) },
    dead: { A: +mean((r) => r.dead.A).toFixed(1), B: +mean((r) => r.dead.B).toFixed(1) },
    fled: { A: +mean((r) => r.fled.A).toFixed(1), B: +mean((r) => r.fled.B).toFixed(1) },
    routed: +mean((r) => r.routed).toFixed(1),
    firstBlood: +mean((r) => r.firstBlood || 0).toFixed(1),
    byA: merge((r) => r.by.A), byB: merge((r) => r.by.B),
    killedA: merge((r) => r.killedBy.A), killedB: merge((r) => r.killedBy.B),
    zonesA: merge((r) => r.zones.A), zonesB: merge((r) => r.zones.B),
    organsA: merge((r) => r.organs.A), organsB: merge((r) => r.organs.B),
    events: merge((r) => r.events),
    beasts: merge((r) => { const o = {}; for (const k in r.beasts) o[k] = { kills: r.beasts[k].kills, hpLeft: Math.round(r.beasts[k].hpLeft) }; return o; }),
    sizes: ok.slice(0, 1).map((r) => Object.fromEntries(Object.entries(r.beasts).map(([k, b]) => [k, { hp: b.hp, size: b.size.slice(0, 4) }])))[0] || {},
    wallMs: Math.round(mean((r) => r.wallMs)),
    runs: ok.map((r) => ({ seed: r.seed, win: r.winner, t: r.t, deadA: r.dead.A, deadB: r.dead.B, fledA: r.fled.A, fledB: r.fled.B })),
  };
}
const pct = (x) => (x * 100).toFixed(0).padStart(3) + "%";
export function tableLine(s) {
  const band = s.band ? (s.band[0] * 100).toFixed(0) + "-" + (s.band[1] * 100).toFixed(0) + "%" : "-";
  return s.id.padEnd(30) + " " + pct(s.winA) + " [" + (s.ci[0] * 100).toFixed(0).padStart(2) + "-" + (s.ci[1] * 100).toFixed(0).padStart(3) + "] " +
    band.padStart(8) + "  " + s.verdict.padEnd(4) + " " + String(s.tMean == null ? "-" : s.tMean).padStart(6) + "s  " +
    ("A " + s.dead.A + "/" + Math.round(s.sent.A) + " B " + s.dead.B + "/" + Math.round(s.sent.B)).padEnd(24) + " n=" + s.n + (s.draws ? " draws " + s.draws : "") + (s.errors ? " ERR " + s.errors : "");
}
function topCauses(by, k = 4) {
  return Object.entries(by).sort((a, b) => b[1].dmg - a[1].dmg).slice(0, k)
    .map(([src, v]) => src + " " + v.hits + "h/" + Math.round(v.dmg) + "dmg/" + v.kills + "k").join(", ");
}
export function detail(s) {
  const L = [];
  L.push("  " + s.label + "   " + s.url + (s.gap != null ? " gap=" + s.gap : ""));
  L.push("    A dealt: " + (topCauses(s.byA) || "nothing"));
  L.push("    B dealt: " + (topCauses(s.byB) || "nothing"));
  const z = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => k + " " + v).join(", ");
  if (Object.keys(s.zonesA).length || Object.keys(s.zonesB).length) L.push("    rounds landed on A: " + (z(s.zonesA) || "-") + " | organs " + (z(s.organsA) || "-") + "   on B: " + (z(s.zonesB) || "-") + " | organs " + (z(s.organsB) || "-"));
  if (Object.keys(s.events).length || s.routed) L.push("    morale: " + (z(s.events) || "no army events") + "; men routed " + s.routed + "; fled A " + s.fled.A + " B " + s.fled.B);
  if (Object.keys(s.beasts).length) L.push("    animals: " + Object.entries(s.beasts).map(([k, v]) => k + " kills " + v.kills + " hpLeft " + v.hpLeft).join(", ") + "  (row " + JSON.stringify(s.sizes) + ")");
  if (s.firstBlood) L.push("    first blood at " + s.firstBlood + " s; wall " + s.wallMs + " ms/run");
  if (s.extra.length) L.push("    also: " + s.extra.join("; "));
  if (s.errSample.length) L.push("    ERR " + s.errSample[0].split("\n")[0]);
  return L.join("\n");
}

export function loadMatchups() {
  const f = path.join(TOOL_ROOT, "data/npcwar/expectations.json");
  const J = JSON.parse(fs.readFileSync(f, "utf8"));
  return J.matchups;
}

async function main() {
  let list;
  if (arg("--q", null) || arg("--a", null)) {
    const mu = { id: arg("--id", "adhoc"), seeds: +arg("--seeds", 12) };
    if (arg("--q", null)) mu.q = arg("--q");
    for (const k of ["a", "b", "n", "arena", "aw", "at", "bw", "bt", "as", "bs", "hold"]) if (arg("--" + k, null) != null) mu[k] = arg("--" + k);
    if (arg("--gap", null) != null) mu.gap = +arg("--gap");
    if (arg("--maxT", null) != null) mu.maxT = +arg("--maxT");
    list = [mu];
  } else {
    list = loadMatchups();
    if (has("--fast")) list = list.filter((m) => m.fast);
    const only = arg("--only", null);
    if (only) list = list.filter((m) => only.split(",").some((o) => m.id.includes(o)));
  }
  // --noswap: every seed fights from the slots as written (red = A). The
  // start lines are mirror images now (arenas/erg.js FOLD), so identical
  // armies must split about evenly from either slot; this is how to see it.
  if (has("--noswap")) list.forEach((mu) => { mu.swap = false; });
  const seedsOver = arg("--seeds", null);
  const jobs = [];
  for (const mu of list) {
    const N = seedsOver ? +seedsOver : (has("--fast") && mu.fastSeeds) ? mu.fastSeeds : (mu.seeds || 12);
    for (let s = 1; s <= N; s++) jobs.push({ mu, seed: s * 101 + 7 });
  }
  const nW = jobCap(arg("--jobs", null) ? +arg("--jobs") : null);
  const t0 = Date.now();
  process.stderr.write("npcwar-arena: " + list.length + " matchups, " + jobs.length + " battles, " + nW + " workers (load " + os.loadavg()[0].toFixed(1) + ", " + os.cpus().length + " cores)\n");
  const res = await runPool(jobs, nW, (r, k, n) => { if (process.stderr.isTTY || k % 10 === 0 || k === n) process.stderr.write("\r  " + k + "/" + n + " " + ((Date.now() - t0) / 1000).toFixed(0) + " s   "); });
  process.stderr.write("\n");
  const sums = list.map((mu) => summarize(mu, res.filter((r) => r.id === mu.id)));
  const head = "matchup".padEnd(30) + " winA  [95% CI]     band  call    time   dead/sent";
  const txt = [head, "-".repeat(head.length + 20)].concat(sums.map(tableLine)).join("\n") + "\n\n" + sums.map(detail).join("\n\n") + "\n";
  console.log(txt);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  let sha = "";
  try { sha = process.env.NPCWAR_ROOT ? "tree " + ROOT : execSync("git rev-parse --short HEAD", { cwd: ROOT }).toString().trim() + (execSync("git status --porcelain src games", { cwd: ROOT }).toString().trim() ? "+dirty" : ""); } catch (e) {}
  const out = { when: new Date().toISOString(), head: sha, wallS: Math.round((Date.now() - t0) / 1000), workers: nW, summaries: sums };
  const dir = path.join(os.homedir(), "harness/out/gta6/npcwar-arena");
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, stamp + ".json"), JSON.stringify(out, null, 1));
    fs.writeFileSync(path.join(dir, stamp + ".txt"), txt);
    console.log(path.join(dir, stamp + ".txt"));
  } catch (e) {}
  if (arg("--json", null)) fs.writeFileSync(arg("--json"), JSON.stringify(out, null, 1));
}

/* ================================================================ WORKER / MAIN
   (at the bottom: everything above is initialised by the time it runs) */
if (has("--worker")) {
  process.on("message", async (job) => {
    if (job === "exit") process.exit(0);
    let res;
    try { res = await oneBattle(job.mu, job.seed); }
    catch (e) { res = { seed: job.seed, err: String(e && e.stack || e).slice(0, 600) }; }
    res.id = job.mu.id;
    process.send(res);
  });
} else if (path.resolve(process.argv[1] || "") === SELF) {
  await main();
}
