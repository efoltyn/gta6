#!/usr/bin/env node
/* tools/npcwar-fidelity.mjs — THE TIERS FIGHT THE SAME WAR. In node, no browser.

   The same engagement (the page's own field, spawn, rosters and orders) is
   fought by the page's FULL brain on every man, and again with every squad
   forced into a tier (src/battle/mass.js ?tier=mid|far, core/tiersim.js),
   and again MIXED: a FULL ring round the lens, MID round that, FAR beyond
   (?fullcap / ?midcap small enough that all three tiers fight at once).
   Over N seeds each, it compares what a war is judged by:

     winner     the share of seeds each side wins (same winner >= 90% of the
                seeds the reference agrees with itself on, else within noise)
     dead       the loser's dead + fled, as a share of its army (within 15
                points of the reference mean)
     decision   seconds to the end (within 25% of the reference mean)
     curve      the fighting strength of both sides every 2 s, mean over
                seeds; the largest gap from the reference curve (printed)

   The reference is the FULL page. A tier passes a case when all three
   verdicts hold; the run passes when every tier passes every case.

     node tools/npcwar-fidelity.mjs            4 cases x 8 seeds x 4 fidelities
     node tools/npcwar-fidelity.mjs 6 2        6 seeds, case 2 only
     NPCWAR_FID_JSON=out.json                  also write every run's numbers  */
import { boot, settle, run, G } from "./lib/npcwar-node.mjs";
import fs from "node:fs";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const CHILD = process.argv[2] === "--one";
const NSEED = CHILD ? 1 : +(process.argv[2] || 8);
const ONLY = CHILD ? 0 : (process.argv[3] ? +process.argv[3] : 0);
const JOBS = Math.max(1, +(process.env.NPCWAR_FID_JOBS || Math.min(6, Math.max(2, os.cpus().length - 2))));
const CASES = [
  { id: "even-dunes", q: "?a=men&b=men&n=100v100&arena=dunes&aw=ak47&bw=ak47&at=elite&bt=elite" },
  { id: "hold-grass", q: "?a=men&b=men&n=150v90&arena=grass&aw=ak47&bw=ak47&at=pro&bt=pro" },
  { id: "elite-thug", q: "?a=men&b=men&n=100v120&arena=dunes&aw=ak47&bw=ak47&at=elite&bt=thug" },
  { id: "mixed-snow", q: "?a=men&b=men&n=120v120&arena=snow&aw=mixed&bw=ak47&at=pro&bt=thug" },
];
const FIDS = [
  { id: "full", extra: "" },
  { id: "mid", extra: "&tier=mid&worker=0" },
  { id: "far", extra: "&tier=far&worker=0" },
  // a lens over the middle of the field: the nearest ~60 men FULL, the next ~120 MID, the rest FAR
  { id: "mixed", extra: "&tier=auto&fullcap=60&midcap=120&worker=0", lens: true },
];

async function fight(q, seed, lens) {
  const W = boot(q + "&auto=1&probe=0", { seed });
  if (W.err) throw W.err;
  await settle();
  if (lens) G(W, "cam.mode = 'free'; setCamMode('free'); cam.focus.set(MAP.cx, 0, MAP.cz); cam.wFocus.set(MAP.cx, 0, MAP.cz); cam.wDist = cam.dist = 30; cam.wPitch = cam.pitch = 0.5; CBZ.camera.position.set(MAP.cx, 20, MAP.cz);");
  const curve = [];
  const t0 = Date.now();
  run(W, 300, (t) => {
    if (lens) G(W, "CBZ.camera.position.set(MAP.cx, 20, MAP.cz);");
    if (Math.abs(t - Math.round(t)) < 1e-6 && t % 2 === 0) {
      const T = W.B().tally();
      curve.push([T.alive.red - T.routed.red, T.alive.blue - T.routed.blue]);
    }
    return true;
  });
  const T = W.B().tally();
  const a = W.B().audit();
  return { secs: T.simT, win: T.winner || (T.alive.red >= T.alive.blue ? "red" : "blue"), dead: T.dead, fled: T.fled, curve,
    mass: a.mass && a.mass.on ? { tiers: a.mass.tiers, promoted: a.mass.stats.promoted, demoted: a.mass.stats.demoted } : null,
    shots: a.stats ? [a.stats.red.shots, a.stats.blue.shots] : null, wall: Date.now() - t0 };
}
function n0(q) { const m = /n=(\d+)v(\d+)/.exec(q); return { red: +m[1], blue: +m[2] }; }
const mean = (a) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
function summarize(runs, N) {
  const redWin = runs.filter((r) => r.win === "red").length / runs.length;
  const maj = redWin >= 0.5 ? "red" : "blue", L = maj === "red" ? "blue" : "red";
  const lossOf = (r) => { const l = r.win === "red" ? "blue" : "red"; return (r.dead[l] + r.fled[l]) / N[l]; };
  const winLossOf = (r) => { const w = r.win; return (r.dead[w] + r.fled[w]) / N[w]; };
  const len = Math.max(...runs.map((r) => r.curve.length));
  const curve = [];
  for (let k = 0; k < len; k++) {
    const at = (r, s) => (r.curve[k] || r.curve[r.curve.length - 1])[s];
    curve.push([mean(runs.map((r) => at(r, 0))) / N.red, mean(runs.map((r) => at(r, 1))) / N.blue]);
  }
  return { redWin, maj, loserLoss: mean(runs.map(lossOf)), winnerLoss: mean(runs.map(winLossOf)), secs: mean(runs.map((r) => r.secs)), curve };
}
function curveGap(a, b) {
  let g = 0;
  for (let k = 0; k < Math.max(a.length, b.length); k++) {
    const x = a[k] || a[a.length - 1], y = b[k] || b[b.length - 1];
    g = Math.max(g, Math.abs(x[0] - y[0]), Math.abs(x[1] - y[1]));
  }
  return g;
}
// a child fights one (case, fidelity, seed) and prints its JSON
if (CHILD) {
  const ci = +process.argv[3], fi = +process.argv[4], seed = +process.argv[5];
  const c = CASES[ci], f = FIDS[fi];
  const r = await fight(c.q + f.extra, seed, f.lens);
  process.stdout.write(JSON.stringify(r) + "\n");
  process.exit(0);
}
// the parent fans every fight out over JOBS node processes (each a vm of the page)
const SELF = fileURLToPath(import.meta.url);
const jobs = [];
for (let ci = 0; ci < CASES.length; ci++) {
  if (ONLY && ONLY !== ci + 1) continue;
  for (let fi = 0; fi < FIDS.length; fi++) for (let s = 0; s < NSEED; s++) jobs.push({ ci: ci, fi: fi, seed: 1000 + s * 7919 });
}
const results = new Map();
await new Promise((done) => {
  let next = 0, live = 0;
  const pump = () => {
    while (live < JOBS && next < jobs.length) {
      const j = jobs[next++];
      live++;
      const ch = spawn(process.execPath, [SELF, "--one", String(j.ci), String(j.fi), String(j.seed)], { stdio: ["ignore", "pipe", "ignore"] });
      let buf = "";
      ch.stdout.on("data", (d) => { buf += d; });
      ch.on("close", () => {
        live--;
        const line = buf.split("\n").find((l) => l.startsWith("{"));
        if (line) results.set(j.ci + ":" + j.fi + ":" + j.seed, JSON.parse(line));
        else console.log("  (a fight died: case " + (j.ci + 1) + " " + FIDS[j.fi].id + " seed " + j.seed + ")");
        if (next >= jobs.length && live === 0) done(); else pump();
      });
    }
  };
  if (!jobs.length) done(); else pump();
});
const out = {};
let fails = 0, checks = 0;
for (let ci = 0; ci < CASES.length; ci++) {
  const c = CASES[ci];
  if (ONLY && ONLY !== ci + 1) continue;
  const N = n0(c.q);
  out[c.id] = {};
  for (let fi = 0; fi < FIDS.length; fi++) {
    const f = FIDS[fi];
    const runs = [];
    for (let s = 0; s < NSEED; s++) { const r = results.get(ci + ":" + fi + ":" + (1000 + s * 7919)); if (r) runs.push(r); }
    out[c.id][f.id] = { runs, sum: summarize(runs, N) };
  }
  const ref = out[c.id].full.sum;
  console.log("\n" + c.id + "  (" + c.q.replace(/^\?/, "") + ", " + NSEED + " seeds)");
  console.log("  tier    red wins   loser lost  winner lost  decision   curve gap   wall/run");
  for (const f of FIDS) {
    const s = out[c.id][f.id].sum, runs = out[c.id][f.id].runs;
    const pct = (x) => (x * 100).toFixed(0).padStart(3) + "%";
    let verdict = "";
    if (f.id !== "full") {
      // same winner: the tier's majority matches, and its win share is within
      // the binomial noise of N seeds (2 sigma of the pooled share, floor 0.25)
      const p = (ref.redWin + s.redWin) / 2, sig = Math.max(0.125, Math.sqrt(p * (1 - p) / NSEED));
      const winOk = Math.abs(s.redWin - ref.redWin) <= 2 * sig;
      const lossOk = Math.abs(s.loserLoss - ref.loserLoss) <= 0.15;
      const timeOk = Math.abs(s.secs - ref.secs) <= 0.25 * ref.secs;
      checks++;
      if (!(winOk && lossOk && timeOk)) fails++;
      verdict = (winOk && lossOk && timeOk ? "  PASS" : "  FAIL") + (winOk ? "" : " winner") + (lossOk ? "" : " losses") + (timeOk ? "" : " time");
    }
    console.log("  " + f.id.padEnd(6) + "  " + pct(s.redWin) + "       " + pct(s.loserLoss) + "        " + pct(s.winnerLoss) + "      " +
      s.secs.toFixed(0).padStart(4) + " s     " + (f.id === "full" ? "   -  " : curveGap(s.curve, ref.curve).toFixed(2).padStart(6)) +
      "     " + (mean(runs.map((r) => r.wall)) / 1000).toFixed(1) + " s" + verdict);
  }
}
if (process.env.NPCWAR_FID_JSON) fs.writeFileSync(process.env.NPCWAR_FID_JSON, JSON.stringify(out));
console.log("\n" + (checks - fails) + "/" + checks + " tier x case verdicts hold");
process.exit(fails ? 1 : 0);
