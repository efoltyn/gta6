#!/usr/bin/env node
/* tools/npcwar-infantry-bench.mjs — HOW MANY: the infantry core's own cost,
   in node, at 1k / 10k / 100k / 1M men a side. The same sim the duel and the
   squad checks run (src/battle/core/infantry.js); nothing is simplified for
   size.

   Each army is squads of ten in their wedges, side by side 60 m apart, rank
   behind rank 150 m deep (a real deployment's density), the two fronts 350 m
   apart on rolling ground, advancing to contact. It measures the step (dt
   0.1 s) in two phases: the approach (nobody in sight yet) and the fight
   (the front ranks in contact), and the share of each part of the step.

     node tools/npcwar-infantry-bench.mjs                    1k 10k 100k 1M
     node tools/npcwar-infantry-bench.mjs 1000 50000        the sizes you name
     NPCWAR_BENCH_SECS=20                                   sim seconds of fighting measured (default 12)
     NPCWAR_BENCH_JSON=out.json                             also write the numbers */
import fs from "node:fs";
import { ctx, side, field } from "./lib/infantry-node.mjs";

const SIZES = process.argv.slice(2).map(Number).filter((n) => n > 0);
if (!SIZES.length) SIZES.push(1000, 10000, 100000, 1000000);
const SECS = +(process.env.NPCWAR_BENCH_SECS || 12);
const sb = ctx(), CBZ = sb.CBZ;
const out = [];
const fmt = (x, d = 2) => (x == null || x !== x ? "-" : x.toFixed(d));

for (const N of SIZES) {
  if (global.gc) global.gc();
  const t0 = Date.now();
  const nsq = Math.ceil(N / 10);
  const wide = Math.max(1, Math.ceil(Math.sqrt(nsq * 2.5)));      // squads across the front
  const deep = Math.ceil(nsq / wide);
  const front = wide * 60, depth = deep * 150;
  const half = Math.max(800, front / 2 + 400, 175 + depth + 400);
  // (a 60 km field for a million a side is laid on a 16 m grid: 15M heights, not 1.6 billion)
  const g = field({ kind: "rolling", seed: 7, half, cell: half > 12000 ? 16 : half > 3000 ? 8 : half > 1500 ? 4 : 1.5 });
  const S = CBZ.battleStore.create(2 * N + 64);
  const I = CBZ.battleInfantry.create(S, { ground: g, seed: 4242 });
  const ta = I.unitType(side("usa")), tb = I.unitType(side("irgc"));
  for (let s = 0; s < 2; s++) {
    const west = s === 0;
    for (let i = 0; i < N; i++) {
      const sq = (i / 10) | 0, slot = i % 10;
      const col = sq % wide, row = (sq / wide) | 0;
      const k = slot === 0 ? 0 : slot <= 4 ? slot : slot - 5, sd = slot === 0 ? 0 : slot <= 4 ? -1 : 1;
      const back = row * 150 + (slot === 0 ? 0 : 4 + k * 4.2), lat = (col - (wide - 1) / 2) * 60 + sd * (5 + k * 4.2);
      const r = S.alloc(s, "man");
      S.cols.x[r] = west ? -175 - back : 175 + back;
      S.cols.z[r] = lat;
      S.cols.heading[r] = west ? Math.PI / 2 : -Math.PI / 2;
      I.add(r, west ? ta : tb, s * nsq + sq, slot, s);
    }
  }
  I.order[0] = { kind: "advance", x: 2000, z: 0 };
  I.order[1] = { kind: "advance", x: -2000, z: 0 };
  const buildMs = Date.now() - t0;
  const dt = 0.1;
  const cpu = () => { const c = process.cpuUsage(); return (c.user + c.system) / 1000; };
  // the approach: until the first round
  const ap = []; let t = 0;
  while (I.stats.shots[0] + I.stats.shots[1] === 0 && t < 120) {
    const a = performance.now(); I.step(dt); I.nEv = 0; ap.push(performance.now() - a); t += dt;
  }
  const contactAt = t;
  // the fight
  const ms0 = Object.assign({}, I.ms);
  const fr = [], fc = [];
  let tf = 0;
  while (tf < SECS) {
    const a = performance.now(), c = cpu(); I.step(dt); I.nEv = 0; fr.push(performance.now() - a); fc.push(cpu() - c); tf += dt;
  }
  const avg = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
  const p95 = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]; };
  const part = {};
  for (const k in I.ms) part[k] = (I.ms[k] - (ms0[k] || 0)) / fr.length;
  let inC = 0, dead = 0, down = 0;
  for (let r = 0; r < S.rows; r++) { if (S.cols.life[r] === 4) dead++; else if (S.cols.down[r]) down++; if (I.simT - S.cols.contactT[r] < 5) inC++; }
  let bytes = 0; for (const k in S.cols) bytes += S.cols[k].byteLength;
  const row = { perSide: N, buildMs, approachMs: avg(ap.slice(5)), contactAt, fightMs: avg(fr), fightCpuMs: avg(fc), p95: p95(fr), part, inContact: inC, dead, down,
    realtime: (dt * 1000) / avg(fr), storeMB: bytes / 1048576, rounds: I.stats.rounds };
  out.push(row);
  console.log("\n" + N.toLocaleString() + " v " + N.toLocaleString() + "   (built in " + (buildMs / 1000).toFixed(1) + " s; " + wide + " squads across, " + deep + " deep; store " + fmt(row.storeMB, 0) + " MB)");
  console.log("  approach   " + fmt(row.approachMs) + " ms a 0.1 s step     first round at " + fmt(contactAt, 1) + " s");
  console.log("  fight      " + fmt(row.fightMs) + " ms a 0.1 s step (p95 " + fmt(row.p95) + ", cpu " + fmt(row.fightCpuMs) + ")   = " + fmt(row.realtime, 2) + "x real time on one core");
  console.log("             grid " + fmt(part.grid) + "  think " + fmt(part.think) + "  fire " + fmt(part.fire) + "  move " + fmt(part.move) + "  rounds " + fmt(part.rounds) + "  squads " + fmt(part.squad));
  console.log("  after " + SECS + " s  in contact " + inC.toLocaleString() + "   down " + down.toLocaleString() + "   dead " + dead.toLocaleString() + "   rounds " + I.stats.rounds.toLocaleString());
  { const L = I.stats.losBy, steps = ap.length + fr.length; console.log("  sight lines a step by who asked: " + I.LOS_TAG.map((k, i) => k + " " + (L[i] / steps).toFixed(0)).join("  ") + "   (" + (I.stats.los / steps / (2 * N)).toFixed(2) + " a man)"); }
}
if (process.env.NPCWAR_BENCH_JSON) fs.writeFileSync(process.env.NPCWAR_BENCH_JSON, JSON.stringify(out, null, 1));
