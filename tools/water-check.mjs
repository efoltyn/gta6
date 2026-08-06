#!/usr/bin/env node
/* ============================================================
   tools/water-check.mjs — HOW FAST THE WATER COMES IN AND OUT.

   OWNER, 2026-08-06: make the tsunami and the flash flood make sense
   "in terms of how quickly the water comes in and comes out."

   Both events were internally consistent and externally nonsense for the
   same reason: every phase was scaled off the event's own runtime instead
   of off a real speed, so nothing could disagree with anything and nothing
   was right. This drives both hazards through their whole arc and samples
   the ONE number that matters — the water level, every simulated second —
   then asserts on the SHAPE of that curve.

   TSUNAMI
     · the bore is a velocity, not a fraction of the runtime, and it is
       pinned under 20 m/s (measured run-up fronts: 5-11)
     · the drawdown warning is long enough to read
     · the island stays flooded for a real beat
     · the sea DRAWS BACK below rest between waves
     · there are TWO waves and the second is the bigger one

   FLASH FLOOD
     · the rising limb is steeper than the falling limb — the defining
       property of a flood hydrograph, and the old curve had it backwards
       while carrying a comment that claimed otherwise
     · the recession is a decay, not a ramp
     · it leaves the street wet

   Usage: node tools/water-check.mjs [--seed 90210]
   ============================================================ */

import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const t = process.argv[i];
  if (!t.startsWith("--")) continue;
  args[t.slice(2)] = (i + 1 < process.argv.length && !process.argv[i + 1].startsWith("--")) ? process.argv[++i] : true;
}
const seed = args.seed || "90210";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serverPort = 9750 + Math.floor(Math.random() * 140);
const debugPort = 11500 + Math.floor(Math.random() * 140);
const profile = `/tmp/cbz-water-${debugPort}`;
const chromePath = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "/opt/pw-browsers/chromium");
const base = `http://127.0.0.1:${serverPort}/?seed=${seed}`;

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail == null ? "" : "  [" + detail + "]"));
}

await rm(profile, { recursive: true, force: true });
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], {
  cwd: ROOT, env: { ...process.env, PORT: String(serverPort) }, stdio: "ignore",
});
const chrome = spawn(chromePath, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-webgl",
  "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--mute-audio",
  "--window-size=1000,650", `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profile}`, base,
], { cwd: ROOT, stdio: "ignore" });

let ws = null, nextId = 1;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(method + " timed out")); } }, 150000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function ev(expr) {
  const msg = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  const r = msg && msg.result;
  if (r && r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "evaluation failed");
  return r && r.result && r.result.value;
}
const json = async (e) => JSON.parse(await ev(`JSON.stringify(${e})`));

let failed = 0;
try {
  let page = null;
  for (let i = 0; i < 200 && !page; i++) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      page = pages.find((p) => p.type === "page" && p.url.startsWith(base));
    } catch (_) {}
    if (!page) await sleep(250);
  }
  if (!page) throw new Error("Chrome page never became available");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (!m.id || !pending.has(m.id)) return;
    const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p.timer);
    if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m);
  });
  await send("Runtime.enable");
  for (let i = 0; i < 220; i++) {
    if (await ev("document.readyState==='complete' && !!(window.CBZ && CBZ.stepSim && CBZ.disasters && CBZ.disasters.force && CBZ.waterSurge)")) break;
    await sleep(250);
  }

  /* One sampler for both hazards: force it, then record the shared sea surge
     and the standing-water depth once per simulated second from the first
     frame of the WARNING to the moment the director goes idle. Everything
     below is read off that one curve. */
  const SAMPLE = (id) => `(function () {
    CBZ.setMode("survival"); CBZ.resetGame(); CBZ.setState("playing");
    window.requestAnimationFrame = function () { return 0; };
    const alive = function () { if (CBZ.game.state !== "playing") CBZ.setState("playing"); };
    CBZ.disasters.force(${JSON.stringify(id)});
    const A = CBZ.surv.arena;
    /* SAMPLE THE WHOLE ISLAND, NOT ONE STREET CORNER. groundWaterAt returns 0
       for anything the field considers sea, anything standing above the local
       reference floor, and anything ahead of the travelling front — so a
       single hard-coded probe point reads a confident zero for reasons that
       have nothing to do with the hazard. Take the deepest of a ring. */
    const PTS = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2, r = A.radius * (0.25 + 0.45 * (i % 3) / 2);
      PTS.push([A.center.x + Math.cos(a) * r, A.center.z + Math.sin(a) * r]);
    }
    const deepest = function () {
      let m = 0;
      for (let i = 0; i < PTS.length; i++) {
        const d = CBZ.groundWaterAt ? CBZ.groundWaterAt(PTS[i][0], PTS[i][1]) : 0;
        if (d > m) m = d;
      }
      return m;
    };
    const R = { surge: [], pool: [], phase: [], state: [], warnSurge: [] };
    for (let i = 0; i < 200 && CBZ.disasters.state() !== "warn"; i++) { alive(); CBZ.stepSim(1 / 60); }
    // the WARNING, sampled at 4 Hz — the drawdown lives here
    for (let s = 0; s < 120 && CBZ.disasters.state() === "warn"; s++) {
      for (let i = 0; i < 15; i++) { alive(); CBZ.stepSim(1 / 60); }
      R.warnSurge.push(+(CBZ.waterSurge ? CBZ.waterSurge() : 0).toFixed(3));
    }
    // the EVENT, one sample per simulated second
    for (let s = 0; s < 140 && CBZ.disasters.state() === "active"; s++) {
      for (let i = 0; i < 60; i++) { alive(); CBZ.stepSim(1 / 60); }
      R.surge.push(+(CBZ.waterSurge ? CBZ.waterSurge() : 0).toFixed(3));
      R.pool.push(+deepest().toFixed(3));
      const a = CBZ.disasters.tsunamiAudit ? CBZ.disasters.tsunamiAudit() : null;
      R.phase.push((a && a.phase) || "-");
      R.waves = a ? a.waves : 0;
      R.bore = a ? a.boreSpeed : 0;
    }
    R.endState = CBZ.disasters.state();
    return R;
  })()`;

  // ---------------------------------------------------------------- TSUNAMI
  const T = await json(SAMPLE("flood"));
  console.log("\\nTSUNAMI — the wave train");
  const ph = T.phase;
  const uniq = ph.filter((p, i) => p !== ph[i - 1]);
  console.log("  phases: " + uniq.join(" -> "));
  console.log("  surge/s: " + T.surge.join(" "));

  check("the drawdown warning is long enough to read",
    T.warnSurge.length >= 40, (T.warnSurge.length / 4).toFixed(1) + " s of drawdown");
  const drawMin = Math.min(...T.warnSurge);
  check("...and the sea visibly empties during it", drawMin < -4, "min surge " + drawMin.toFixed(1) + " m");
  check("the bore is a run-up speed, not a wipe", T.bore > 0 && T.bore <= 20, T.bore + " m/s (measured 5-11)");

  const peak1 = Math.max(...T.surge.slice(0, Math.floor(T.surge.length * 0.55)));
  const floodedSecs = ph.filter((p) => p === "flooded").length;
  check("the island STAYS flooded for a real beat", floodedSecs >= 5, floodedSecs + " s standing");

  const hasDrawback = ph.includes("drawback");
  const backMin = Math.min(...T.surge);
  check("the sea DRAWS BACK between waves", hasDrawback && backMin < -1,
    "min surge between waves " + backMin.toFixed(1) + " m");

  check("there are TWO waves", T.waves === 2, "waves=" + T.waves);
  const peak2 = Math.max(...T.surge.slice(Math.floor(T.surge.length * 0.55)));
  check("...and the second one is BIGGER", peak2 > peak1 * 1.1,
    "wave 1 " + peak1.toFixed(1) + " m -> wave 2 " + peak2.toFixed(1) + " m");
  check("the sea is back to rest by the end", Math.abs(T.surge[T.surge.length - 1]) < 2.5,
    "final surge " + T.surge[T.surge.length - 1]);

  // ------------------------------------------------------------ FLASH FLOOD
  const F = await json(SAMPLE("flashflood"));
  console.log("\\nFLASH FLOOD — the hydrograph");
  console.log("  surge/s: " + F.surge.join(" "));
  console.log("  street depth/s: " + F.pool.join(" "));
  /* THE HYDROGRAPH IS THE SURGE. That is the lever the flood actually drives
     (surgeSet), and it is the curve the shape assertions are about; the
     ground-water pool is the film left on the streets and is checked
     separately at the end. */
  const pool = F.surge.map(function (v) { return Math.max(0, v); });
  const pk = Math.max(...pool);
  const pkAt = pool.indexOf(pk);
  // rising limb = to the peak; falling limb = peak to half-peak
  let halfAt = pool.length - 1;
  for (let i = pkAt; i < pool.length; i++) { if (pool[i] <= pk * 0.5) { halfAt = i; break; } }
  const rise = pkAt + 1, fall = halfAt - pkAt;
  check("the water comes in FAST", rise <= 6, rise + " s to peak (" + pk.toFixed(2) + " m)");
  check("the rising limb is steeper than the falling limb", fall > rise,
    "rise " + rise + " s vs half-drain " + fall + " s");
  check("...and the recession is a long tail, not a ramp", pool.length - pkAt >= 12,
    (pool.length - pkAt) + " s of falling limb");
  // a decay curve loses more in its first half than its second
  const dropA = pool[pkAt] - pool[Math.min(pool.length - 1, pkAt + Math.floor((pool.length - pkAt) / 2))];
  const dropB = pool[Math.min(pool.length - 1, pkAt + Math.floor((pool.length - pkAt) / 2))] - pool[pool.length - 1];
  check("the recession DECAYS (fast at first, then hangs)", dropA > dropB * 1.4,
    "first half -" + dropA.toFixed(2) + " m, second half -" + dropB.toFixed(2) + " m");
  const wetTail = F.pool.slice(-3).some(function (v) { return v > 0.02; });
  check("it leaves the street wet", wetTail,
    "street film " + F.pool.slice(-3).map(function (v) { return v.toFixed(3); }).join("/") + " m");

  failed = results.filter((r) => !r.ok).length;
  console.log("\\n" + (failed ? "WATER: " + failed + " FAILED" : "WATER: ok") + "  (" + results.length + " assertions)");
} catch (e) {
  console.error("WATER CHECK ERROR:", e.message);
  failed = 1;
} finally {
  try { ws && ws.close(); } catch (_) {}
  chrome.kill("SIGKILL"); server.kill("SIGKILL");
  try { await rm(profile, { recursive: true, force: true }); } catch (_) {}
  process.exit(failed ? 1 : 0);
}
