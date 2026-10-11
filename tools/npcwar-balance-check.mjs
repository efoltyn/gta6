#!/usr/bin/env node
/* tools/npcwar-balance-check.mjs — THE BALANCE ALARM. A fast subset of
   tools/npcwar-arena.mjs (the matchups marked `fast` in
   data/npcwar/expectations.json, at their `fastSeeds`), held to the
   real-world bands.

   FAILS only on FAR: the whole 95% interval of side A's win rate is outside
   its band, i.e. the sim is confidently wrong, not unlucky. OUT (the point
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
const far = sums.filter((s) => s.verdict === "FAR" || s.errors > s.n);
const out = sums.filter((s) => s.verdict === "OUT");
for (const s of far.concat(out)) console.log("\n" + (s.verdict === "FAR" ? "FAIL " : "warn ") + detail(s).trimStart());
const secs = ((Date.now() - t0) / 1000).toFixed(0);
console.log("\n" + (far.length ? "FAIL" : "PASS") + " npcwar balance: " + (sums.length - far.length - out.length) + " in band, " + out.length + " out (warn), " + far.length + " FAR" +
  (far.length ? " (" + far.map((s) => s.id + " " + Math.round(s.winA * 100) + "% v " + s.band.map((x) => x * 100).join("-") + "%").join(", ") + ")" : "") + " in " + secs + " s");
process.exit(far.length ? 1 : 0);
