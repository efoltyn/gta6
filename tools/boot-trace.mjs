#!/usr/bin/env node
/* ============================================================
   tools/boot-trace.mjs — WHERE DOES THE BUILD ACTUALLY GO?

   THE PROBLEM THIS SOLVES. Building Gang City is one synchronous task that
   owns the page's main thread from PLAY until the world exists. While it
   runs, NOTHING that needs that thread can answer: no rAF, no timer, no
   `Runtime.evaluate`, no DOM read, no console flush. So every tool we have
   asks the same useless question in the same useless way — poll `CBZ.game
   .state` and wait — and every one of them reports the identical answer for
   two completely different situations:

     · the build is SLOW      (it will finish, in four minutes, or twelve)
     · the build is STUCK     (a builder is looping and it will never finish)

   tools/boot-health.mjs cannot tell those apart. Neither can visual-compare,
   nor any of the *-check gates, which is why a contended box and a real
   regression produce the same red line. That ambiguity has cost hours.

   HOW THIS SEES THROUGH THE FREEZE. `navigator.sendBeacon` hands its request
   to the BROWSER process and returns immediately; the network service, not
   the page, does the sending. So a beacon fired from INSIDE the blocked task
   arrives while the main thread is still blocked. This tool wraps
   `CBZ.bootStep` — the ~50 checkpoints the loading meter already calls, one
   per landmass builder plus the city/mode phases — so every checkpoint pings
   a sink in this process on its way past. What you get is a live, timestamped
   trace of a thread that cannot talk to you:

     [ 12.4s] +12.4s  city:core
     [ 15.1s] + 2.7s  city:buildings
     [ 18.0s] + 2.9s  lm:continent.js
     ...
     [286.3s] +215.0s lm:biome_snow.js      <- there it is

   A step that never closes is the stuck one, and its name is the file to open.
   No profiler, no trace viewer, no guessing.

   It traces the OTHER modes too, which is the comparison that matters:
   Prison Escape and Disaster Survival build small worlds and boot in seconds
   on the same machine where Gang City does not finish. Run all three and the
   difference stops being a feeling.

     node tools/boot-trace.mjs                    # Gang City
     node tools/boot-trace.mjs --mode escape
     node tools/boot-trace.mjs --mode survival
     node tools/boot-trace.mjs --all              # all three, one browser
     node tools/boot-trace.mjs --budget 900       # give it 15 minutes

   Exit codes: 0 built, 3 still running when the budget expired (the report
   names the step it was inside), 1 the page never came up.
============================================================ */
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const has = (f) => argv.includes(f);
const BUDGET = Math.max(30, Number(opt("--budget", 600)) || 600);
const MODES = has("--all") ? ["escape", "survival", "city"] : [opt("--mode", "city")];
/* --params "cfg_RENDER_FRAMES=0" boots the page with URL flags. The one you
   will reach for most: drawing off, which is the difference between "the CPU
   build finished and I can ask questions" and "the rasterizer owns this tab". */
const PARAMS = opt("--params", "");
const deep = has("--deep");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (s) => process.stdout.write(s + "\n");

async function freePort(lo, span) {
  for (let i = 0; i < 60; i++) {
    const p = lo + Math.floor(Math.random() * span);
    const busy = await new Promise((res) => {
      const s = http.createServer();
      s.once("error", () => res(true));
      s.once("listening", () => s.close(() => res(false)));
      s.listen(p, "127.0.0.1");
    });
    if (!busy) return p;
  }
  throw new Error("no free port");
}

/* ---- the sink: where beacons land ---------------------------------------
   Deliberately its own origin (a different port) so nothing about it can be
   confused with the page's own traffic, and CORS never enters into it —
   sendBeacon posts are no-cors by definition. */
const SINKPORT = await freePort(7300, 300);
let hits = [];
const sink = http.createServer((req, res) => {
  hits.push({ at: Date.now(), url: req.url });
  res.writeHead(204, { "Access-Control-Allow-Origin": "*" });
  res.end();
});
await new Promise((r) => sink.listen(SINKPORT, "127.0.0.1", r));

const PORT = await freePort(8300, 300);
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")],
  { env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${PORT}/`); break; } catch (_) { await sleep(100); } }

const DBG = await freePort(10300, 300);
const CHROME = process.env.CBZ_CHROME ||
  (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/opt/pw-browsers/chromium");
const chrome = spawn(CHROME, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--enable-webgl", "--mute-audio", "--window-size=900,600",
  "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
  `--remote-debugging-port=${DBG}`, `--user-data-dir=/tmp/cbz-boottrace-${DBG}`, "about:blank",
], { stdio: "ignore" });

const bye = (code, msg) => {
  if (msg) log(msg);
  try { chrome.kill("SIGKILL"); } catch (_) {}
  try { server.kill("SIGTERM"); } catch (_) {}
  try { sink.close(); } catch (_) {}
  process.exit(code);
};

let target = null;
for (let i = 0; i < 120 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${DBG}/json/list`)).json()).find((t) => t.type === "page"); } catch (_) {}
  if (!target) await sleep(250);
}
if (!target) bye(1, "FAIL: chromium never exposed a page");

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let msgId = 0; const pend = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
});
const send = (method, params, ms = 20000) => new Promise((res) => {
  const id = ++msgId;
  pend.set(id, res);
  ws.send(JSON.stringify({ id, method, params: params || {} }));
  setTimeout(() => { if (pend.delete(id)) res({ __to: true }); }, ms);
});
const ev = async (expression, ms) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true }, ms);
  if (r.__to) return "__BUSY__";
  if (r.result && r.result.exceptionDetails) return "__THROW__ " + (r.result.exceptionDetails.text || "");
  return r.result && r.result.result && r.result.result.value;
};
await send("Runtime.enable");
await send("Page.enable");

/* The wrap. Two beacons per checkpoint is wasteful; one is enough because a
   step's duration is the gap to the NEXT one, which is exactly how
   bootprogress.js measures itself. The final `done` beacon is fired from the
   meter's own finish path, so a build that completes says so. */
const INSTALL = (mode) => `(function(){
  var SINK = "http://127.0.0.1:${SINKPORT}/";
  function ping(what){ try { navigator.sendBeacon(SINK + encodeURIComponent(what)); } catch (e) {} }
  window.__bootTrace = ping;
  var real = CBZ.bootStep;
  CBZ.bootStep = function (key) { ping("step/" + key); if (real) return real.apply(this, arguments); };
  /* AND THE FRAMES. The checkpoints stop at boot:frames — the phase where the
     world is BUILT but not yet DRAWN, and ~107 shader programs compile inside
     the first draws. On a software rasterizer that phase, not the build, is
     what owns the thread; without a beacon per frame the trace just goes
     quiet and you cannot tell a 200-second frame from a hang. One ping per
     render call, so the gaps in the tail of the trace ARE the frame times. */
  /* AND ONE PING PER FRAME OF THE MAIN LOOP, drawn or not. The always-chain
     runs at the tail of every loop() pass, so this fires whether or not the
     render call happened — which is the only way to tell a page stuck in the
     RASTERIZER from one stuck in its own per-frame SIM. With
     ?cfg_RENDER_FRAMES=0 the render beacons stop and these keep going: the
     gap between two of them is one whole updater+always chain.
     (No backticks in this block: it lives inside a template literal.) */
  if (CBZ.onAlways && !window.__tickTraced) {
    window.__tickTraced = true;
    var tn = 0;
    CBZ.onAlways(99, function () { ping("tick/" + (++tn)); });
    if (CBZ.always && CBZ.always.sort) CBZ.always.sort(function (a, b) { return a.order - b.order; });
  }
  if (CBZ.renderer && CBZ.renderer.render && !CBZ.renderer.render.__traced) {
    var rr = CBZ.renderer.render.bind(CBZ.renderer), fn = 0;
    var wrapped = function () { ping("frame/" + (++fn)); return rr.apply(null, arguments); };
    wrapped.__traced = true;
    CBZ.renderer.render = wrapped;
  }
  // the two ends the checkpoints do not cover
  var realStart = CBZ.startRun;
  if (realStart && !realStart.__traced) {
    CBZ.startRun = function () { ping("phase/startRun"); return realStart.apply(this, arguments); };
    CBZ.startRun.__traced = true;
  }
  /* --deep: NAME THE SYSTEM, not just the phase. Once the build is over, the
     phase trace has nothing left to say — every checkpoint has fired and the
     thread is inside the per-frame chain. This wraps every registered updater
     and always-runner so each one pings BEFORE it runs: whatever the last
     ping names is the function that did not return. It is ~200 beacons a
     frame, which is fine for the two or three frames it takes to catch a
     hang, and it arms itself at the LAST build checkpoint so the build trace
     stays readable. (No backticks in this block.) */
  if (${deep} && !window.__deepArmed) {
    window.__deepArmed = true;
    var armDeep = function () {
      if (window.__deepOn) return; window.__deepOn = true;
      var wrap = function (list, kind) {
        for (var i = 0; i < list.length; i++) (function (u) {
          if (u.__deep) return;
          u.__deep = true;
          var f = u.fn, name = kind + ":" + (u.source || "?") + "@" + u.order;
          u.fn = function (dt) { ping("run/" + name); return f.call(this, dt); };
        })(list[i]);
      };
      wrap(CBZ.updaters || [], "upd");
      wrap(CBZ.always || [], "alw");
      ping("phase/deep-armed");
    };
    var bs = CBZ.bootStep;
    CBZ.bootStep = function (key) { var r = bs.apply(this, arguments); if (key === "boot:frames") armDeep(); return r; };
  }
  ping("phase/armed:${mode}");
  return true;
})()`;

async function openPage() {
  await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/index.html${PARAMS ? "?" + PARAMS : ""}` });
  for (let i = 0; i < 400; i++) {
    if (await ev("!!(window.CBZ && CBZ.bootComplete && CBZ.bootStep && document.getElementById('playBtn'))") === true) return true;
    await sleep(250);
  }
  return false;
}

let worstCode = 0;
for (const mode of MODES) {
  log("");
  log("=".repeat(72));
  log("  MODE: " + mode);
  log("=".repeat(72));
  if (!(await openPage())) { bye(1, "FAIL: page never reached bootComplete"); }
  await ev(INSTALL(mode));
  hits = [];
  const t0 = Date.now();
  /* Fire and DO NOT await. The main thread is about to disappear; awaiting it
     is the mistake every other tool in here makes. */
  send("Runtime.evaluate", {
    expression: `(function(){
      if (CBZ.setMode) CBZ.setMode(${JSON.stringify(mode)});
      if (CBZ.game) CBZ.game.mode = ${JSON.stringify(mode)};
      var b = document.getElementById("playBtn"); if (b) b.click();
      return true;
    })()`, awaitPromise: false, timeout: 3600000,
  }, 3600000).catch(() => {});

  let last = t0, seen = 0, done = false;
  const deadline = t0 + BUDGET * 1000;
  const rows = [];
  while (Date.now() < deadline && !done) {
    await sleep(500);
    while (seen < hits.length) {
      const h = hits[seen++];
      const what = decodeURIComponent(h.url.replace(/^\//, ""));
      const el = (h.at - t0) / 1000, d = (h.at - last) / 1000;
      last = h.at;
      rows.push({ what, el, d });
      // Frames are the noisy half of the trace and the interesting number is
      // the COST, not the count: print the expensive ones and every tenth.
      if (what.startsWith("run/")) {
        if (d >= 2) log(`  [${el.toFixed(1).padStart(7)}s] +${d.toFixed(1).padStart(6)}s  ${what}   <- slow`);
        continue;
      }
      if (what.startsWith("frame/") || what.startsWith("tick/")) {
        const n = +what.slice(what.indexOf("/") + 1);
        if (d < 1.0 && n % 10 !== 1) continue;
        log(`  [${el.toFixed(1).padStart(7)}s] +${d.toFixed(1).padStart(6)}s  ${what}${d >= 5 ? "   <- one frame" : ""}`);
        continue;
      }
      log(`  [${el.toFixed(1).padStart(7)}s] +${d.toFixed(1).padStart(6)}s  ${what}`);
    }
    /* DONE means "built AND drawing", and it has to be asked in a way that is
       true for every mode. An earlier version tested CBZ.city.arena, which
       only the CITY mode has — so Prison Escape ran its whole budget looking
       finished-but-unreported. The mode-agnostic version: the thread answers
       (so it is not inside a long task), the state machine says playing, and
       frames have kept arriving since the last build checkpoint. */
    const st = await ev("(window.CBZ && CBZ.game) ? CBZ.game.state : '?'", 1500);
    if (st === "playing") {
      const isLive = (w) => w.startsWith("frame/") || w.startsWith("tick/") || w.startsWith("run/");
      const lastStep = rows.map((r, i) => (isLive(r.what) ? -1 : i)).reduce((a, b) => Math.max(a, b), -1);
      // "alive" is frames when the page draws and loop passes when it does not
      // (?cfg_RENDER_FRAMES=0 draws nothing, and demanding frames there would
      // report a perfectly healthy page as hung — the exact confusion this
      // whole tool exists to end).
      const after = rows.slice(lastStep + 1).filter((r) => r.what.startsWith("frame/") || r.what.startsWith("tick/")).length;
      if (after >= 3) done = true;
    }
  }
  const total = (Date.now() - t0) / 1000;
  log("");
  if (done) {
    log(`  BUILT in ${total.toFixed(1)}s over ${rows.length} checkpoints`);
  } else {
    const stuckIn = rows.length ? rows[rows.length - 1].what : "(nothing — it never reached the first checkpoint)";
    const runs = rows.filter((r) => r.what.startsWith("run/"));
    if (runs.length) log(`  Deep trace saw ${runs.length} system calls; the last to start was ${runs[runs.length - 1].what.slice(4)}`);
    const quiet = (Date.now() - last) / 1000;
    log(`  STILL RUNNING after ${total.toFixed(1)}s (budget).`);
    log(`  Last checkpoint: ${stuckIn}  ·  silent for ${quiet.toFixed(1)}s`);
    log(`  That silence IS the answer: whatever runs after ${stuckIn} is where the time goes.`);
    worstCode = 3;
  }
  if (rows.length) {
    const steps = rows.filter((r) => !r.what.startsWith("frame/") && !r.what.startsWith("tick/"));
    const frames = rows.filter((r) => r.what.startsWith("frame/"));
    const ticks = rows.filter((r) => r.what.startsWith("tick/"));
    const buildEnd = steps.length ? steps[steps.length - 1].el : 0;
    const sorted = steps.slice().sort((a, b) => b.d - a.d).slice(0, 8);
    log("  slowest checkpoints (gap = the work BEFORE that name):");
    for (const r of sorted) log(`    ${r.d.toFixed(1).padStart(7)}s  ${r.what}`);
    /* THE LINE THAT SETTLES THE ARGUMENT. Build time and frame time are two
       different problems with two different fixes, and every tool we have
       reports them as one number. Separate them here, always. */
    log("");
    log(`  BUILD (CPU, last checkpoint):  ${buildEnd.toFixed(1)}s over ${steps.length} checkpoints`);
    if (frames.length) {
      const cost = frames.map((f) => f.d).sort((a, b) => a - b);
      const med = cost[cost.length >> 1];
      log(`  FRAMES drawn:                  ${frames.length}  ·  median ${med.toFixed(2)}s  ·  worst ${cost[cost.length - 1].toFixed(1)}s`);
      log(`  ${med > 1 ? "The RENDERER is the wall here, not the build." : "Frames are cheap; any wall is in the build."}`);
    } else {
      log("  FRAMES drawn:                  0  — nothing was ever rendered");
    }
    if (ticks.length) {
      const tc = ticks.map((t) => t.d).sort((a, b) => a - b);
      const tmed = tc[tc.length >> 1];
      log(`  LOOP passes (sim ticks):       ${ticks.length}  ·  median ${tmed.toFixed(2)}s  ·  worst ${tc[tc.length - 1].toFixed(1)}s`);
      if (!frames.length) log("  Drawing is OFF, so that median IS the per-frame SIM cost.");
    } else {
      log("  LOOP passes (sim ticks):       0  — the loop never completed a pass");
    }
  }
}

bye(worstCode, "");
