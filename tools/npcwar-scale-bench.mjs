#!/usr/bin/env node
/* tools/npcwar-scale-bench.mjs — HOW MANY, ON THE PAGE: the whole battle's
   cost in node, with the page's own host around the infantry core.

   The page's sim (games/battle.html's src/battle files in a vm, the lift
   tools/npcwar-headless.mjs uses) fights N v N riflemen on the dunes. Every
   man is a row of the infantry core (src/battle/core/infantry.js); the lens
   is parked over the middle of the field where the lines meet, so the rigs
   (mass.js puppets) are there too. Each frame is 1/30 s of sim. Per frame:

     core    the infantry core's step (src/battle/core/infantry.js: grids,
             thinks and triggers, movement, rounds, squads), on its own fixed
             0.1 s clock (so a frame is a third of a step on average)
     host    mass.js: the page's bodies synced into rows, the core's events,
             the rounds drawn, the rigs scheduled and built and posed
     page    the page's own sub-step over its own bodies (stepMan, physics)
   For the core alone at 1k / 10k / 100k / 1M a side, see
   tools/npcwar-infantry-bench.mjs (no page, no rigs).

     node tools/npcwar-scale-bench.mjs                 1k, 10k, 100k a side
     node tools/npcwar-scale-bench.mjs 5000 50000      the sizes you name
     NPCWAR_BENCH_SECS=40                              sim seconds per size (default 36)
     NPCWAR_BENCH_JSON=out.json                        also write the numbers          */
import { boot, settle, G } from "./lib/npcwar-node.mjs";
import fs from "node:fs";

const SIZES = process.argv.slice(2).map(Number).filter((n) => n > 0);
if (!SIZES.length) SIZES.push(1000, 10000, 100000);
const SECS = +(process.env.NPCWAR_BENCH_SECS || 36);
const out = [];
const fmt = (x, d) => (x == null ? "-" : x.toFixed(d == null ? 2 : d));
function pct(a, p) { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))] || 0; }

for (const N of SIZES) {
  if (global.gc) global.gc();
  const heap0 = process.memoryUsage().heapUsed;
  const t0 = Date.now();
  const W = boot("?a=men&b=men&n=" + N + "v" + N + "&arena=dunes&aw=ak47&bw=ak47&at=elite&bt=elite&auto=1&probe=0", { seed: 4242, realClock: true });
  if (W.err) { console.log("boot threw: " + W.err); continue; }
  await settle();
  const bootMs = Date.now() - t0;
  const lens = "if (cam) { setCamMode('free'); cam.focus.set(MAP.cx, 0, MAP.cz); cam.wFocus.copy(cam.focus); } CBZ.camera.position.set(MAP.cx, MAP.groundAt(MAP.cx, MAP.cz) + 22, MAP.cz);";
  G(W, lens);
  G(W, "window.__pageMs = 0; { const _s = stepMan; stepMan = function (m, d) { const t = performance.now(); _s(m, d); __pageMs += performance.now() - t; }; }");
  const B = W.B();
  const frames = [];
  const realNow = () => Number(process.hrtime.bigint()) / 1e6;
  let prev = null, contactAt = -1;
  const total = Math.round(SECS * 30);
  for (let f = 0; f < total; f++) {
    G(W, lens);
    const a = realNow(), c0 = process.cpuUsage();
    B.advance(1 / 30, 1 / 30);
    const wall = realNow() - a, cu = process.cpuUsage(c0), cpu = (cu.user + cu.system) / 1000;
    const s = G(W, "({ page: __pageMs, core: MASS.I ? MASS.I.ms.total : 0, host: MASS.stats.ms.sync + MASS.stats.ms.events + MASS.stats.ms.sched + MASS.stats.ms.draw + (MASS.stats.ms.step - (MASS.I ? MASS.I.ms.total : 0)), shots: MASS.I ? MASS.I.stats.shots[0] + MASS.I.stats.shots[1] : 0, simT: simT })");
    if (prev) {
      const fr = { wall: wall, cpu: cpu, page: s.page - prev.page, core: s.core - prev.core, host: s.host - prev.host };
      if (contactAt < 0 && s.shots > 0) contactAt = s.simT;
      if (contactAt >= 0) frames.push(fr);
    }
    prev = s;
  }
  const a = B.audit(), m = a.mass;
  const heap = process.memoryUsage().heapUsed - heap0;
  const storeBytes = G(W, "(function(){ let b = 0; for (const k in STORE.cols) b += STORE.cols[k].byteLength; return b; })()");
  const T = B.tally();
  const avg = (k) => frames.length ? frames.reduce((s, f) => s + (f[k] || 0), 0) / frames.length : 0;
  const row = {
    perSide: N, bootMs, contactAt: Math.round(contactAt * 10) / 10, framesMeasured: frames.length,
    rigs: m && m.on ? m.rigs : 0, rows: m && m.on ? m.alive : 0,
    ms: { core: avg("core"), host: avg("host"), page: avg("page"), wall: avg("wall"), cpu: avg("cpu") },
    p95wall: pct(frames.map((f) => f.wall), 0.95),
    heapMB: heap / 1048576, storeMB: storeBytes / 1048576,
    dead: T.dead, alive: T.alive,
  };
  out.push(row);
  console.log("\n" + N + " v " + N + "  (boot " + (bootMs / 1000).toFixed(1) + " s, first shot at " + row.contactAt + " s, " + frames.length + " frames measured after it)");
  console.log("  men              rows " + row.rows + "   rigs near the lens " + row.rigs);
  console.log("  ms / frame       core " + fmt(row.ms.core) + "   host " + fmt(row.ms.host) + "   page " + fmt(row.ms.page) + "   (frame wall " + fmt(row.ms.wall) + ", p95 " + fmt(row.p95wall) + ", cpu " + fmt(row.ms.cpu) + ")");
  console.log("  memory           heap +" + fmt(row.heapMB, 1) + " MB   store " + fmt(row.storeMB, 1) + " MB   (" + fmt(row.storeMB * 1048576 / (2 * N), 0) + " B a row)");
  console.log("  after " + SECS + " s       dead " + T.dead.red + " / " + T.dead.blue + "   standing " + T.alive.red + " / " + T.alive.blue);
}
if (process.env.NPCWAR_BENCH_JSON) fs.writeFileSync(process.env.NPCWAR_BENCH_JSON, JSON.stringify(out, null, 1));
