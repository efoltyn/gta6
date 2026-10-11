#!/usr/bin/env node
/* tools/npcwar-balance-check.mjs — THE BALANCE ALARM. A fast subset of
   tools/npcwar-arena.mjs (the matchups marked `fast` in
   data/npcwar/expectations.json, at their `fastSeeds`), held to the
   real-world bands.

   FAILS only on a NEW FAR: the whole 95% interval of side A's win rate is
   outside its band (the sim is confidently wrong, not unlucky) on a matchup
   with no `known` note. A `known` one (filed in docs/npcwar/BALANCE.md with
   its owner) is listed, and reported FIXED once it lands in its band. OUT (the point
   estimate outside, the interval still touching the band) is printed as a
   warning: re-run the full matchup with the arena before calling it.

     node tools/npcwar-balance-check.mjs            exit 0 = every fast matchup is not FAR
     node tools/npcwar-balance-check.mjs --only tiger
     node tools/npcwar-balance-check.mjs --jobs 2

   Testbus-friendly: node only, no Chrome, deterministic per seed, the last
   line is the verdict, and under TESTBUS=1 it takes at most 2 workers (the
   bus runs other checks beside it).                                         */
import os from "node:os";
import { runPool, summarize, tableLine, detail, jobCap, loadMatchups } from "./npcwar-arena.mjs";

const argv = process.argv.slice(2);
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
let list = loadMatchups().filter((m) => m.fast);
const only = arg("--only", null);
if (only) list = list.filter((m) => only.split(",").some((o) => m.id.includes(o)));
const jobs = [];
for (const mu of list) for (let s = 1; s <= (mu.fastSeeds || 6); s++) jobs.push({ mu, seed: s * 101 + 7 });
const want = arg("--jobs", null) ? +arg("--jobs") : process.env.TESTBUS ? 2 : null;
const nW = jobCap(want);
const t0 = Date.now();
console.log("npcwar-balance-check: " + list.length + " matchups, " + jobs.length + " battles, " + nW + " workers (load " + os.loadavg()[0].toFixed(1) + ")");
const res = await runPool(jobs, nW);
const sums = list.map((mu) => summarize(mu, res.filter((r) => r.id === mu.id)));
for (const s of sums) console.log(tableLine(s));
const byId = Object.fromEntries(list.map((m) => [m.id, m]));
const far = sums.filter((s) => (s.verdict === "FAR" || s.errors > s.n) && !byId[s.id].known);
const known = sums.filter((s) => s.verdict === "FAR" && byId[s.id].known);
const fixed = sums.filter((s) => s.verdict === "IN" && byId[s.id].known);
const out = sums.filter((s) => s.verdict === "OUT");
for (const s of far) console.log("\nFAIL " + detail(s).trimStart());
for (const s of out) console.log("\nwarn " + detail(s).trimStart());
for (const s of known) console.log("known " + s.id + ": " + byId[s.id].known);
for (const s of fixed) console.log("FIXED " + s.id + " is in its band now: delete its `known` line in data/npcwar/expectations.json");
const secs = ((Date.now() - t0) / 1000).toFixed(0);
console.log("\n" + (far.length ? "FAIL" : "PASS") + " npcwar balance: " + sums.filter((s) => s.verdict === "IN").length + " in band, " + out.length + " out (warn), " + known.length + " known FAR, " + far.length + " new FAR" +
  (far.length ? " (" + far.map((s) => s.id + " " + Math.round(s.winA * 100) + "% v " + s.band.map((x) => Math.round(x * 100)).join("-") + "%").join(", ") + ")" : "") + " in " + secs + " s");
process.exit(far.length ? 1 : 0);
