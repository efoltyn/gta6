#!/usr/bin/env node
/* ============================================================
   tools/boot-meter-check.mjs — DOES THE LOADING METER TELL THE TRUTH?

   The boot meter (src/systems/bootprogress.js) claims two things that are
   easy to fake and worth proving:

     1. IT KEEPS COUNTING WHILE THE MAIN THREAD IS DEAD. The world build is
        one synchronous 20-30 s task; nothing on the page can repaint during
        it. The meter is drawn by a WORKER onto an OffscreenCanvas, so PLAY is
        fired WITHOUT awaiting it and the drawing thread's own tape (timestamp,
        percentage, every ~200 ms) is read back afterwards. Samples that land
        INSIDE the frozen window — where the page could not run a single rAF,
        timer or CDP evaluate — are the proof that the number was moving.
        (A note on pictures: this also films the tab over a CDP screencast,
        but that capture path does not include worker-drawn canvas layers in
        headless software compositing — a blank meter in those JPEGs proves
        nothing either way. They are here for the DOM around it.)
     2. THE PERCENTAGE MEANS SOMETHING. Every checkpoint is replayed from the
        meter's own tape: the step order, where the bar was placed, what the
        step was predicted to cost and what it actually cost. The report
        prints the worst prediction errors — those are exactly the steps that
        make a bar feel like it is lying.

   Run it twice: the first run has no learned timings (seed table only), the
   second is calibrated on this machine and should be markedly tighter.

     node tools/boot-meter-check.mjs
     node tools/boot-meter-check.mjs --shots 10   # more mid-build frames
     node tools/boot-meter-check.mjs --keep       # keep the PNGs

   SwiftShader inflates the post-build shader-compile phase; the CPU-side
   build steps are honest. Compare runs, don't quote one in isolation.
============================================================ */
import { spawn } from "node:child_process";
import { rm, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const SHOTS = Math.max(2, Number(opt("--shots", 7)) || 7);
const OUT = opt("--out", "/tmp/cbz-bootmeter");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function claimPort(lo, span, probe) {
  for (let t = 0; t < 8; t++) {
    const p = lo + Math.floor(Math.random() * span);
    try { await probe(p); } catch (_) { return p; }
  }
  console.error("FAIL: no free port near " + lo);
  process.exit(1);
}
const httpPort = await claimPort(8600, 200, (p) => fetch(`http://127.0.0.1:${p}/`));
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], {
  env: { ...process.env, PORT: String(httpPort) }, stdio: "ignore",
});
const base = `http://127.0.0.1:${httpPort}`;
let up = false;
for (let i = 0; i < 60 && !up; i++) { try { await fetch(base); up = true; } catch (_) { await sleep(100); } }
if (!up) { console.error("FAIL: devserver never came up"); server.kill("SIGTERM"); process.exit(1); }

const dbg = await claimPort(10600, 250, (p) => fetch(`http://127.0.0.1:${p}/json/version`));
const profileDir = `/tmp/cbz-bootmeter-${dbg}`;
await rm(profileDir, { recursive: true, force: true });
const CHROME = process.env.CBZ_CHROME ||
  (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/opt/pw-browsers/chromium");
const chrome = spawn(CHROME, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--enable-webgl", "--mute-audio", "--window-size=900,620",
  "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
  "--disable-background-networking", "--disable-component-update",
  "--no-first-run", "--no-default-browser-check", "--disable-extensions",
  `--remote-debugging-port=${dbg}`, `--user-data-dir=${profileDir}`, "about:blank",
], { stdio: "ignore" });

function bail(msg, code = 1) {
  console.error(msg);
  try { chrome.kill("SIGKILL"); } catch (_) {}
  try { server.kill("SIGTERM"); } catch (_) {}
  process.exit(code);
}
let target = null;
for (let i = 0; i < 100 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json()).find((t) => t.type === "page"); }
  catch (_) {}
  if (!target) await sleep(200);
}
if (!target) bail("FAIL: chromium never exposed a page target");

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let nextId = 1;
const pending = new Map();
const errors = [];
const frames = [];
let castT0 = 0;
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === "Runtime.exceptionThrown") {
    const d = msg.params.exceptionDetails || {}, ex = d.exception || {};
    errors.push(String(ex.description || ex.value || d.text || "exception").split("\n")[0].slice(0, 160));
  } else if (msg.method === "Page.screencastFrame") {
    // The screencast is served by the BROWSER process from the compositor, so
    // frames keep arriving while the page's main thread is inside a landmass
    // builder. That is the whole point: these are the pixels a player sees
    // during the freeze.
    frames.push({ at: Date.now() - castT0, data: msg.params.data });
    const sid = msg.params.sessionId;
    ws.send(JSON.stringify({ id: nextId++, method: "Page.screencastFrameAck", params: { sessionId: sid } }));
  }
};
function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => {
    pending.set(id, (m) => (m.error ? rej(new Error(method + ": " + m.error.message)) : res(m.result)));
    setTimeout(() => rej(new Error("timeout " + method)), 900000);
  });
}
async function evl(expression, awaitPromise = true) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise, timeout: 900000 });
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text);
  return r.result.value;
}

await send("Network.enable");
await send("Network.setBlockedURLs", { urls: ["*fonts.googleapis.com*", "*fonts.gstatic.com*"] });
await send("Page.enable");
await send("Runtime.enable");
await mkdir(OUT, { recursive: true });

async function openPage() {
  await send("Page.navigate", { url: base + "/index.html" });
  for (let i = 0; i < 900; i++) {
    try { if (await evl("!!(window.CBZ && CBZ.bootComplete && CBZ.bootMeter)")) return true; } catch (_) {}
    await sleep(100);
  }
  return false;
}

// One PLAY, start to playable. `film` records the screen through the freeze
// (browser-process screencast — it does not need the page's main thread).
async function runOnce(film) {
  const t0 = Date.now();
  frames.length = 0; castT0 = t0;
  if (film) await send("Page.startScreencast", { format: "jpeg", quality: 65, maxWidth: 900, maxHeight: 620, everyNthFrame: 1 });
  // fire and DO NOT await: the main thread is about to vanish for half a
  // minute, and that is exactly the window worth watching.
  send("Runtime.evaluate", { expression: "CBZ.startRunPresented()", awaitPromise: false, timeout: 900000 }).catch(() => {});
  let playing = false;
  for (let i = 0; i < 2400 && !playing; i++) {
    try { playing = !!(await evl("CBZ.game.state === 'playing' && !CBZ.bootMeter.active()")); } catch (_) {}
    if (!playing) await sleep(250);
  }
  const totalMs = Date.now() - t0;
  if (film) await send("Page.stopScreencast").catch(() => {});
  let wtape = null;
  if (playing) {
    await evl("CBZ.bootMeter.askTape()").catch(() => {});
    await sleep(200);
    wtape = JSON.parse(await evl("JSON.stringify(CBZ.bootMeter.tape()||null)"));
  }
  return {
    playing, totalMs, wtape,
    drawMode: await evl("CBZ.bootMeter.mode()"),
    tape: playing ? JSON.parse(await evl("JSON.stringify(CBZ.bootMeter.log())")) : [],
    measured: playing ? JSON.parse(await evl("JSON.stringify(CBZ.bootMeter.measured())")) : {},
    weights: playing ? JSON.parse(await evl("JSON.stringify(CBZ.bootMeter.weights())")) : {},
    cardHidden: await evl("(function(){var e=document.getElementById('bootload');return !e||e.style.display==='none';})()"),
    apology: await evl("(function(){var e=document.getElementById('bootload');return e?/first load|keep this tab|Generating terrain/i.test(e.textContent):false;})()"),
    filmed: frames.slice(),
  };
}

if (!(await openPage())) bail("FAIL: page never reached bootComplete with a boot meter on it");
const r1 = await runOnce(true);

// Second pass: SAME browser profile, so the meter starts with what it learned
// from the first build — the number that matters is whether the predictions
// tightened. Fresh page, so the world is genuinely built again.
let r2 = null;
if (!flag("--single")) {
  if (!(await openPage())) bail("FAIL: reload never reached bootComplete");
  r2 = await runOnce(false);
}

// ---- report --------------------------------------------------------------
const line = (k, v) => console.log("  " + String(k).padEnd(32) + v);
function errRows(r) {
  const seen = new Set(), out = [];
  for (const row of r.tape) {
    if (seen.has(row.key)) continue;
    seen.add(row.key);
    const actual = r.measured[row.key];
    if (actual == null) continue;
    out.push({ key: row.key, at: row.at, predict: row.predict, actual: Math.round(actual) });
  }
  return out;
}
function medianErr(rows) {
  const e = rows.filter((r) => r.actual >= 60 && r.predict > 0)
    .map((r) => Math.abs(r.actual - r.predict) / Math.max(r.actual, r.predict) * 100)
    .sort((a, b) => a - b);
  return e.length ? e[e.length >> 1] : null;
}
function monotonic(tape) {
  let prev = -1;
  for (const r of tape) { if (r.at < prev - 0.001) return false; prev = r.at; }
  return true;
}

const shots = [];
for (let i = 0; i < SHOTS && r1.filmed.length; i++) {
  const f = r1.filmed[Math.min(r1.filmed.length - 1, Math.round((i * (r1.filmed.length - 1)) / (SHOTS - 1)))];
  const file = path.join(OUT, `boot-${String(i).padStart(2, "0")}-t${Math.round(f.at / 100) / 10}s.jpg`);
  await writeFile(file, Buffer.from(f.data, "base64"));
  shots.push({ at: f.at, file });
}

console.log("\nBOOT METER CHECK");
console.log("\n1. HOW IT DRAWS");
line("draw path", r1.drawMode + (r1.drawMode === "worker" ? "  (counts through the freeze)" : "  (repaints only when the thread yields)"));
line("apology paragraph present", r1.apology ? "YES — should be gone" : "no");

console.log("\n2. WHAT THE SCREEN DID DURING THE FREEZE (" + OUT + ")");
line("compositor frames filmed", r1.filmed.length + (r1.filmed.length ? "  (t+" + (r1.filmed[0].at / 1000).toFixed(1) + "s .. t+" + (r1.filmed[r1.filmed.length - 1].at / 1000).toFixed(1) + "s)" : ""));
for (const sh of shots) line("t+" + (sh.at / 1000).toFixed(1) + "s", path.basename(sh.file));
if (r1.wtape && r1.wtape.tape && r1.wtape.tape.length) {
  const off = r1.wtape.pageNow - r1.wtape.workerNow, t = r1.wtape.tape;
  console.log("\n   the drawing thread's own tape (page ms → % on screen):");
  const stepIdx = Math.max(1, Math.floor(t.length / 12));
  for (let i = 0; i < t.length; i += stepIdx) console.log("     " + String(Math.round(t[i][0] + off)).padStart(8) + " ms   " + String(t[i][1]).padStart(6) + " %");
  let adv = 0;
  for (let i = 1; i < t.length; i++) if (t[i][1] > t[i - 1][1]) adv++;
  line("samples that advanced", adv + " of " + (t.length - 1));
}

const rows1 = errRows(r1), rows2 = r2 ? errRows(r2) : null;
console.log("\n3. THE TAPE — checkpoint, where the bar went, predicted vs actual");
console.log("     COLD (seed table only)" + (rows2 ? "                              CALIBRATED (2nd build, same browser)" : ""));
const byKey2 = new Map((rows2 || []).map((r) => [r.key, r]));
for (const r of rows1) {
  const e1 = r.predict > 0 ? Math.round((r.actual - r.predict) / r.predict * 100) : 0;
  let right = "";
  if (rows2) {
    const b = byKey2.get(r.key);
    right = b ? "   |  " + String(b.at.toFixed(1) + "%").padStart(6) + "  pred " + String(b.predict + "ms").padStart(7) + "  act " + String(b.actual + "ms").padStart(7) + "  err " + String(Math.round((b.actual - b.predict) / Math.max(1, b.predict) * 100) + "%").padStart(6) : "";
  }
  console.log("  " + String(r.at.toFixed(1) + "%").padStart(6) + "  " + r.key.padEnd(24) +
    "pred " + String(r.predict + "ms").padStart(7) + "  act " + String(r.actual + "ms").padStart(7) + "  err " + String(e1 + "%").padStart(6) + right);
}

// Proof of life: worker samples that advanced INSIDE the frozen window (from
// the first checkpoint to the last), where the page itself could not run a
// single rAF, timer or CDP evaluate.
function frozenWindowAdvance(r) {
  if (!r.wtape || !r.wtape.tape || !r.tape.length) return null;
  const off = r.wtape.pageNow - r.wtape.workerNow;
  const from = r.tape[0].t, to = r.tape[r.tape.length - 1].t;
  let inWindow = 0, advanced = 0, prev = null;
  for (const [wt, pct] of r.wtape.tape) {
    const t = wt + off;
    if (t < from || t > to) { prev = pct; continue; }
    inWindow++;
    if (prev != null && pct > prev) advanced++;
    prev = pct;
  }
  return { inWindow, advanced, spanMs: Math.round(to - from) };
}
const alive = frozenWindowAdvance(r1);
console.log("\n4. VERDICT");
const m1 = medianErr(rows1), m2 = rows2 ? medianErr(rows2) : null;
line("steps reported", r1.tape.length + (r2 ? " / " + r2.tape.length : ""));
line("bar monotonic", (monotonic(r1.tape) && (!r2 || monotonic(r2.tape))) ? "yes" : "NO — a target went backwards");
line("reached playing", r1.playing ? "yes in " + (r1.totalMs / 1000).toFixed(1) + " s" + (r2 ? " / " + (r2.totalMs / 1000).toFixed(1) + " s" : "") : "NO");
line("card hidden at the end", r1.cardHidden ? "yes" : "NO — still covering the game");
line("learned timings stored", Object.keys(r1.weights).length + " steps");
line("meter alive while frozen", alive
  ? alive.advanced + " of " + alive.inWindow + " worker samples advanced across the " + (alive.spanMs / 1000).toFixed(1) + " s build"
  : "NO — the drawing thread never reported");
line("median step error", (m1 == null ? "n/a" : m1.toFixed(0) + "% cold") + (m2 == null ? "" : "  →  " + m2.toFixed(0) + "% calibrated"));
if (errors.length) { console.log("\n  page errors:"); for (const e of errors.slice(0, 8)) console.log("    " + e); }

const ok = r1.playing && monotonic(r1.tape) && (!r2 || monotonic(r2.tape)) && r1.cardHidden && !r1.apology &&
  r1.tape.length > 5 && !!alive && alive.advanced > 10 && (m2 == null || m2 <= 40);
console.log("\n" + (ok ? "BOOT METER: ok" : "BOOT METER: FAILED"));
console.log("(frames kept at " + OUT + " — look at them)");
try { chrome.kill("SIGKILL"); } catch (_) {}
try { server.kill("SIGTERM"); } catch (_) {}
process.exit(ok ? 0 : 1);
