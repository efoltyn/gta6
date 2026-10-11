#!/usr/bin/env node
/* tools/npcwar-worker-check.mjs — THE SIM WORKER, PROVEN IN NODE.

   core/simworker.js runs as a real thread (node worker_threads behind a small
   Web Worker shim: self, importScripts, postMessage), and the page (the vm
   lift of games/battle.html, tools/lib/npcwar-node.mjs) runs a tiered war
   through core/simlink.js in both of its modes:

     shared     SharedArrayBuffer columns (a cross-origin isolated page)
     transfer   no SharedArrayBuffer (GitHub Pages): snapshots ping-ponged as
                transferables, the FULL rows sent each step, row state fetched
                before a promotion

   and holds: the worker came up in the mode asked for; the MID/FAR rows move
   (positions change in the page's own store); rounds land both ways (rows die,
   FULL men are hit through hurtMan); squads are promoted and demoted as the
   lens moves; the war ends; and its result is a war, not a stall (the
   loser's dead within reach of the in-page tiers on the same seed).

     node tools/npcwar-worker-check.mjs          both modes
     node tools/npcwar-worker-check.mjs transfer one                              */
import { boot, settle, G, ROOT } from "./lib/npcwar-node.mjs";
import { Worker as NodeWorker } from "node:worker_threads";
import path from "node:path";

const ONLY = process.argv[2] || "";
let fails = 0, passes = 0;
function check(ok, msg) { if (ok) { passes++; console.log("  PASS " + msg); } else { fails++; console.log("  FAIL " + msg); } }

/* the shim: what a browser's Worker gives simworker.js, on a node thread */
const BOOT = `
const { parentPort, workerData } = require("node:worker_threads");
const fs = require("node:fs"), vm = require("node:vm");
globalThis.self = globalThis;
self.location = { href: "file://" + workerData.file, search: "" };
self.importScripts = function () {
  for (const u of arguments) { const p = new URL(u, self.location.href).pathname; vm.runInThisContext(fs.readFileSync(p, "utf8"), { filename: p }); }
};
self.postMessage = (m, tr) => parentPort.postMessage(m, tr);
parentPort.on("message", (m) => { if (self.onmessage) self.onmessage({ data: m }); });
vm.runInThisContext(fs.readFileSync(workerData.file, "utf8"), { filename: workerData.file });
`;
const threads = [];
class WorkerShim {
  constructor(url) {
    const file = path.join(ROOT, "src/battle/core", String(url).replace(/\?.*$/, "").replace(/^.*\//, ""));
    this.t = new NodeWorker(BOOT, { eval: true, workerData: { file } });
    threads.push(this.t);
    this.t.on("message", (m) => { if (this.onmessage) this.onmessage({ data: m }); });
    this.t.on("error", (e) => { if (this.onerror) this.onerror({ message: e && e.message }); });
  }
  postMessage(m, tr) { this.t.postMessage(m, tr); }
  terminate() { this.t.terminate(); }
}
// a real yield: worker replies are delivered between frames, as in a browser
const tick = () => new Promise((r) => setTimeout(r, 1));

async function war(mode, worker, seed) {
  const sandbox = worker ? { Worker: WorkerShim } : {};
  if (mode === "transfer") sandbox.crossOriginIsolated = false;
  const W = boot("?a=men&b=men&n=1500v1500&arena=dunes&aw=ak47&bw=ak47&at=elite&bt=elite&auto=1&probe=0&fullcap=80&midcap=300" +
    (worker ? "&worker=1" : "&worker=0"), { seed, sandbox });
  if (W.err) throw W.err;
  await settle();
  const B = W.B();
  const out = { mode: G(W, "MASS.audit().worker"), ready: false, moved: 0, promoted: 0, demoted: 0, fullHit: 0, over: false };
  const x0 = G(W, "Array.from(STORE.cols.x.subarray(0, 64))");
  G(W, "window.__fh = 0; { const _h = hurtMan; hurtMan = function (m, d, i) { if (m && !m.ghost && i && i.by && i.by.ghost) __fh++; return _h(m, d, i); }; }");
  let lens = 0;
  for (let f = 0; f < 30 * 240; f++) {
    // the lens sweeps along the lines: squads come and go from the FULL ring
    if (f % 30 === 0) { lens = (lens + 6) % 400; G(W, "setCamMode('free'); cam.focus.set(MAP.cx, 0, MAP.cz + " + (lens - 200) + "); cam.wFocus.copy(cam.focus); cam.dist = cam.wDist = 30; cam.pitch = cam.wPitch = 0.6;"); }
    B.advance(1 / 30, 1 / 30);
    if (worker) await tick();
    if (f % 150 === 0) {
      const a = B.audit();
      if (a.over) break;
    }
  }
  const a = B.audit(), T = B.tally();
  out.ready = worker ? G(W, "!!(MASS.link && MASS.link.ready)") : true;
  const x1 = G(W, "Array.from(STORE.cols.x.subarray(0, 64))");
  out.moved = x0.filter((x, i) => Math.abs(x - x1[i]) > 2).length;
  out.promoted = a.mass.stats.promoted; out.demoted = a.mass.stats.demoted;
  out.fullHit = G(W, "__fh");
  out.over = a.over; out.secs = Math.round(T.simT); out.dead = T.dead; out.winner = T.winner;
  out.lag = worker ? G(W, "MASS.link ? MASS.link.lag : -1") : 0;
  out.workerMs = worker ? G(W, "MASS.link ? MASS.link.ms : -1") : 0;
  return out;
}

for (const mode of ["shared", "transfer"]) {
  if (ONLY && ONLY !== mode) continue;
  console.log(mode + ": 1500 v 1500, the tiers in the sim worker");
  const r = await war(mode, true, 1000);
  check(r.mode === mode, "the worker came up " + mode + " (" + r.mode + ")");
  check(r.ready, "and answered (ready)");
  check(r.moved > 32, "the rows move in the page's store (" + r.moved + " of 64 sampled moved > 2 m)");
  check(r.dead.red + r.dead.blue > 100, "rows die (" + r.dead.red + " / " + r.dead.blue + " dead)");
  check(r.fullHit > 0, "the worker's rounds land on FULL men through hurtMan (" + r.fullHit + ")");
  check(r.promoted > 0 && r.demoted > 0, "squads promoted and demoted as the lens moves (" + r.promoted + " up, " + r.demoted + " down)");
  check(r.over, "the war ended (" + r.secs + " s, winner " + r.winner + ")");
  const p = await war(mode, false, 1000);
  const lw = (x) => (x.winner === "red" ? x.dead.blue : x.dead.red) / 1500;
  check(Math.abs(lw(r) - lw(p)) < 0.3, "a war, not a stall: loser's dead " + (lw(r) * 100).toFixed(0) + "% in the worker, " + (lw(p) * 100).toFixed(0) + "% in the page (same seed)");
}
for (const t of threads) t.terminate();
console.log("\n" + passes + " passed, " + fails + " failed");
process.exit(fails ? 1 : 0);
