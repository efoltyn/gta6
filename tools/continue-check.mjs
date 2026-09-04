#!/usr/bin/env node
/* ============================================================
   tools/continue-check.mjs — DOES THE GAME PAUSE, SAVE AND CONTINUE?

   Three claims, each proven against the live page, not the source:

     1. THE PRESENTED BOOT NEVER FREEZES THE PAGE. A 50 ms main-thread timer
        runs through the whole PLAY; the longest gap between its ticks is
        the longest the tab was unresponsive. The old single-task build made
        that gap the entire build (20-35 s); the sliced build (core/loop.js
        runSliced + the generator chain in city/world.js, city/worldmap.js,
        city/mode.js) has to keep it to one builder step.
     2. PAUSE IS REAL. CBZ.pauseGame() puts the state on "paused", the day
        clock stops (core/daynight.js), and CBZ.resumeGame() brings it back.
     3. CONTINUE IS REAL. Position, day, time of day, wanted level and hunger
        are moved, the ledger is committed, the PAGE IS RELOADED, and PLAY —
        which now says CONTINUE — puts the character back in that moment.

   Usage:
     node tools/continue-check.mjs             # frames off (fast, honest CPU)
     node tools/continue-check.mjs --frames    # draw too (SwiftShader-slow)
============================================================ */
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const FRAMES = argv.includes("--frames");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function claimPort(lo, span, probe) {
  for (let t = 0; t < 8; t++) {
    const p = lo + Math.floor(Math.random() * span);
    try { await probe(p); } catch (_) { return p; }
  }
  console.error("FAIL: no free port near " + lo);
  process.exit(1);
}
const httpPort = await claimPort(8800, 200, (p) => fetch(`http://127.0.0.1:${p}/`));
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], {
  env: { ...process.env, PORT: String(httpPort) }, stdio: "ignore",
});
const base = `http://127.0.0.1:${httpPort}`;
let up = false;
for (let i = 0; i < 60 && !up; i++) { try { await fetch(base); up = true; } catch (_) { await sleep(100); } }
if (!up) { console.error("FAIL: devserver never came up"); server.kill("SIGTERM"); process.exit(1); }

const dbg = await claimPort(10800, 250, (p) => fetch(`http://127.0.0.1:${p}/json/version`));
const profileDir = `/tmp/cbz-continue-${dbg}`;
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
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === "Runtime.exceptionThrown") {
    const d = msg.params.exceptionDetails || {}, ex = d.exception || {};
    errors.push(String(ex.description || ex.value || d.text || "exception").split("\n")[0].slice(0, 160));
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

const URL_ = base + "/index.html" + (FRAMES ? "" : "?cfg_RENDER_FRAMES=0");
async function openPage() {
  await send("Page.navigate", { url: URL_ });
  for (let i = 0; i < 900; i++) {
    try { if (await evl("!!(window.CBZ && CBZ.bootComplete && CBZ.bootMeter)")) return true; } catch (_) {}
    await sleep(100);
  }
  return false;
}

// PLAY through the presented path with a responsiveness probe running.
async function play() {
  await evl(`(function(){ window.__gap = { max: 0, n: 0, last: performance.now() };
    window.__gapTimer = setInterval(function(){ var t = performance.now(), d = t - __gap.last; __gap.last = t; __gap.n++; if (d > __gap.max) __gap.max = d; }, 50); })()`);
  const t0 = Date.now();
  send("Runtime.evaluate", { expression: "CBZ.startRunPresented()", awaitPromise: false, timeout: 900000 }).catch(() => {});
  let playing = false;
  for (let i = 0; i < 2400 && !playing; i++) {
    try { playing = !!(await evl("CBZ.game.state === 'playing' && !CBZ.bootMeter.active()")); } catch (_) {}
    if (!playing) await sleep(250);
  }
  const gap = await evl("(clearInterval(window.__gapTimer), window.__gap)");
  return { playing, ms: Date.now() - t0, gap };
}

const results = [];
const line = (k, v) => { results.push([k, v]); console.log("  " + k.padEnd(38) + String(v)); };
let ok = true;
const check = (k, cond, v) => { line(k, (cond ? "ok" : "FAIL") + (v != null ? "  (" + v + ")" : "")); if (!cond) ok = false; };

console.log("CONTINUE CHECK — " + URL_ + "\n");
if (!(await openPage())) bail("FAIL: page never booted");
const label0 = await evl("document.getElementById('playBtn').textContent");
line("PLAY label on a fresh ledger", label0);

console.log("\n1. THE PRESENTED BOOT");
const r1 = await play();
check("reached playing", r1.playing, r1.ms + " ms");
line("main-thread timer ticks during boot", r1.gap.n);
line("longest unresponsive gap", Math.round(r1.gap.max) + " ms");
check("gap is a builder step, not the build", r1.gap.max < r1.ms * 0.5);

console.log("\n2. PAUSE");
// nudge the clock to noon-ish so a moving clock is visible, then pause
await evl("CBZ.dayPhase(0.30); CBZ.pauseGame()");
const paused = await evl("CBZ.game.state");
const phaseA = await evl("CBZ.dayPhase()");
await evl("new Promise(r => setTimeout(r, 1200))");
const phaseB = await evl("CBZ.dayPhase()");
check("state is paused", paused === "paused", paused);
check("day clock held while paused", Math.abs(phaseB - phaseA) < 1e-6, phaseA.toFixed(5) + " → " + phaseB.toFixed(5));
await evl("CBZ.resumeGame()");
await evl("new Promise(r => setTimeout(r, 600))");
const phaseC = await evl("CBZ.dayPhase()");
check("state is playing after resume", (await evl("CBZ.game.state")) === "playing");
check("day clock moves again", phaseC > phaseB, phaseB.toFixed(5) + " → " + phaseC.toFixed(5));

console.log("\n3. SAVE, RELOAD, CONTINUE");
// a distinctive moment: walk 60 m from spawn, day 3 at dusk, 2 stars, hungry
const moment = await evl(`(function(){
  const P = CBZ.player; P.pos.x += 60; P.pos.z += 25; CBZ.playerChar.group.position.copy(P.pos);
  CBZ.dayCount(2); CBZ.dayPhase(0.61); CBZ.game.hunger = 37; CBZ.game.heat = 700; CBZ.game.wanted = 2;
  CBZ.cam.yaw = 2.5;
  CBZ.cityWorldCommit();
  const w = JSON.parse(localStorage.getItem("CBZ_CITY_WORLD_V2"));
  return { x: P.pos.x, z: P.pos.z, dayN: CBZ.dayCount(), day: CBZ.dayPhase(), wanted: CBZ.game.wanted, hunger: CBZ.game.hunger,
           ledger: { lastPos: w.lastPos, session: w.session, originPlayed: w.originPlayed } };
})()`);
check("ledger carries lastPos", !!(moment.ledger.lastPos), JSON.stringify(moment.ledger.lastPos));
check("ledger carries the session", !!(moment.ledger.session && moment.ledger.session.dayN === 2), JSON.stringify(moment.ledger.session));
if (!(await openPage())) bail("FAIL: page never re-booted");
const label1 = await evl("document.getElementById('playBtn').textContent");
const sub1 = await evl("(document.getElementById('playSub')||{}).textContent || ''");
check("PLAY says CONTINUE after the reload", /continue/i.test(label1), label1 + " — " + sub1);
const r2 = await play();
check("reached playing again", r2.playing, r2.ms + " ms");
const after = await evl(`({ x: CBZ.player.pos.x, z: CBZ.player.pos.z, dayN: CBZ.dayCount(), day: CBZ.dayPhase(),
  wanted: CBZ.game.wanted, hunger: CBZ.game.hunger, yaw: CBZ.cam.yaw })`);
const dist = Math.hypot(after.x - moment.x, after.z - moment.z);
check("position restored", dist < 2.5, dist.toFixed(2) + " m from where the save was taken");
check("calendar day restored", after.dayN === moment.dayN, after.dayN);
check("time of day restored", Math.abs(after.day - moment.day) < 0.01, after.day.toFixed(3));
check("wanted level restored", after.wanted === moment.wanted, after.wanted + "★");
check("hunger restored", Math.abs(after.hunger - moment.hunger) < 2, after.hunger);
check("look direction restored", Math.abs(after.yaw - 2.5) < 0.05, after.yaw.toFixed(2));

const fatal = errors.filter((e) => !/fonts|net::ERR_BLOCKED/.test(e));
line("\npage exceptions", fatal.length ? fatal.length + "  " + fatal.slice(0, 3).join(" | ") : "none");
console.log("\nCONTINUE CHECK: " + (ok ? "ok" : "FAIL"));
bail("", ok ? 0 : 1);
