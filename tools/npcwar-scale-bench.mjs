#!/usr/bin/env node
/* tools/npcwar-scale-bench.mjs — HOW MANY: the tiered battle's own cost, in node.

   The page's own sim (games/battle.html's src/battle files in a vm, the same
   lift tools/npcwar-headless.mjs uses) fights N v N riflemen on the dunes
   with the tiers on (src/battle/mass.js, core/tiersim.js, core/lod.js) and
   the lens parked over the middle of the field, where the lines meet. Each
   frame is 1/30 s of sim. It reports, per frame, the milliseconds spent in:

     full    the FULL rigs' brains and bodies (think.js, step.js, fire.js: the
             page's own stepMan for every man in `men`; no rigs are drawn in
             node, so this is the BRAIN cost, not the animation)
     mid     tiersim's MID slice          far     tiersim's FAR slice + squads
     hash    the two hashed grids + the flow fields      hits  the batched resolve
     host    mass.js: syncing FULL rows, events, counts, the scheduler, ghosts
   plus the row count per tier, the heap and the store's bytes. A worker takes
   mid + far + hash + hits off the main thread (core/simworker.js); the page
   keeps full + host.

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
  const W = boot("?a=men&b=men&n=" + N + "v" + N + "&arena=dunes&aw=ak47&bw=ak47&at=elite&bt=elite&auto=1&probe=0&worker=0", { seed: 4242, realClock: true });
  if (W.err) { console.log("boot threw: " + W.err); continue; }
  await settle();
  const bootMs = Date.now() - t0;
  // the lens over the middle, low: the FULL ring is where the lines meet
  const lens = "if (cam) { setCamMode('free'); cam.focus.set(MAP.cx, 0, MAP.cz); cam.wFocus.copy(cam.focus); } CBZ.camera.position.set(MAP.cx, MAP.groundAt(MAP.cx, MAP.cz) + 22, MAP.cz);";
  G(W, lens);
  // the FULL brains, timed where the page runs them
  G(W, "window.__fullMs = 0; { const _s = stepMan; stepMan = function (m, d) { const t = performance.now(); _s(m, d); __fullMs += performance.now() - t; }; }");
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
    const s = G(W, "({ full: __fullMs, T: MASS.T ? Object.assign({}, MASS.T.ms) : null, host: MASS.stats.ms.sync + MASS.stats.ms.events + MASS.stats.ms.sched, shots: MASS.T ? MASS.T.stats.shots[0] + MASS.T.stats.shots[1] : 0, simT: simT })");
    if (prev) {
      const fr = { wall: wall, cpu: cpu, full: s.full - prev.full, host: s.host - prev.host };
      if (s.T) { fr.mid = s.T.mid - prev.T.mid; fr.far = (s.T.far - prev.T.far) + (s.T.squads - prev.T.squads); fr.hash = s.T.hash - prev.T.hash; fr.hits = s.T.hits - prev.T.hits; }
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
    tiers: m && m.on ? m.tiers : { full: T.alive.red + T.alive.blue, mid: 0, far: 0 },
    ms: { full: avg("full"), mid: avg("mid"), far: avg("far"), hash: avg("hash"), hits: avg("hits"), host: avg("host"), wall: avg("wall"), cpu: avg("cpu") },
    p95wall: pct(frames.map((f) => f.wall), 0.95),
    heapMB: heap / 1048576, storeMB: storeBytes / 1048576,
    dead: T.dead, alive: T.alive,
  };
  /* A SHARED MACHINE STEALS WALL TIME. The tier timers are wall clocks; on a
     box with more runnable threads than cores they include the time this
     process sat descheduled. The frame's CPU time (process.cpuUsage) does
     not, so every per-tier number is also given scaled by cpu / wall: the
     cost on a core that is ours. */
  row.cpuShare = row.ms.wall > 0 ? Math.min(1, row.ms.cpu / row.ms.wall) : 1;
  row.cpuMs = {};
  for (const k of ["full", "mid", "far", "hash", "hits", "host"]) row.cpuMs[k] = row.ms[k] * row.cpuShare;
  out.push(row);
  console.log("\n" + N + " v " + N + "  (boot " + (bootMs / 1000).toFixed(1) + " s, first shot at " + row.contactAt + " s, " + frames.length + " frames measured after it)");
  console.log("  rows by tier     full " + row.tiers.full + "   mid " + row.tiers.mid + "   far " + row.tiers.far);
  console.log("  ms / frame       full " + fmt(row.ms.full) + "   mid " + fmt(row.ms.mid) + "   far " + fmt(row.ms.far) + "   hash " + fmt(row.ms.hash) + "   hits " + fmt(row.ms.hits) + "   host " + fmt(row.ms.host));
  console.log("  on our own core  full " + fmt(row.cpuMs.full) + "   mid " + fmt(row.cpuMs.mid) + "   far " + fmt(row.cpuMs.far) + "   hash " + fmt(row.cpuMs.hash) + "   hits " + fmt(row.cpuMs.hits) + "   host " + fmt(row.cpuMs.host) + "   (cpu/wall " + fmt(row.cpuShare) + ")");
  console.log("  main thread      in-page " + fmt(row.ms.cpu) + " ms cpu (" + fmt(row.ms.wall) + " wall, p95 " + fmt(row.p95wall) + ")   with the worker ~" + fmt(row.cpuMs.full + row.cpuMs.host) + " ms + render");
  console.log("  memory           heap +" + fmt(row.heapMB, 1) + " MB   store " + fmt(row.storeMB, 1) + " MB   (" + fmt(row.storeMB * 1048576 / (2 * N), 0) + " B a row)");
  console.log("  after " + SECS + " s       dead " + T.dead.red + " / " + T.dead.blue + "   standing " + T.alive.red + " / " + T.alive.blue);
}
if (process.env.NPCWAR_BENCH_JSON) fs.writeFileSync(process.env.NPCWAR_BENCH_JSON, JSON.stringify(out, null, 1));
