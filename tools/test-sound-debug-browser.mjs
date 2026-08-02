#!/usr/bin/env node
// Real-Chrome regression for the F8 sound-review feed. It verifies that the
// debugger reports a sound only after playback is scheduled, includes the
// logical cue + chosen asset + original caller, groups repeats, and hides/shows.

import { spawn } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const serverPort = 9650 + Math.floor(Math.random() * 100);
const debugPort = 10950 + Math.floor(Math.random() * 100);
const profile = `/tmp/cbz-sound-debug-${debugPort}`;
const screenshot = `/tmp/cbz-sound-debug-${debugPort}.png`;
const chromePath = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "/opt/pw-browsers/chromium");
const base = `http://127.0.0.1:${serverPort}/`;

let passed = 0;
let failed = 0;
function check(ok, label, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

await rm(profile, { recursive: true, force: true });
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], {
  env: { ...process.env, PORT: String(serverPort) }, stdio: "ignore",
});
let chrome = null;
let ws = null;
let nextId = 1;
const pending = new Map();

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, 30000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const out = await send("Runtime.evaluate", {
    expression, returnByValue: true, awaitPromise: true,
  });
  if (out && out.exceptionDetails) {
    throw new Error(out.exceptionDetails.exception?.description || out.exceptionDetails.text || "browser evaluation failed");
  }
  return out && out.result && out.result.value;
}
async function json(expression) {
  return JSON.parse(await evaluate(`JSON.stringify(${expression})`));
}
async function waitFor(expression, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const value = await evaluate(expression);
      if (value) return value;
    } catch (_) {}
    await sleep(100);
  }
  return null;
}
async function f8() {
  const key = { key: "F8", code: "F8", windowsVirtualKeyCode: 119, nativeVirtualKeyCode: 119 };
  await send("Input.dispatchKeyEvent", { type: "keyDown", ...key });
  await send("Input.dispatchKeyEvent", { type: "keyUp", ...key });
  await sleep(120);
}
async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  await Promise.race([exited, sleep(2000)]);
}

try {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch (_) {}
    if (i === 79) throw new Error("local server did not become ready");
    await sleep(100);
  }

  chrome = spawn(chromePath, [
    "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
    "--enable-unsafe-swiftshader", "--enable-webgl", "--mute-audio",
    "--autoplay-policy=no-user-gesture-required", "--window-size=1280,720",
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
    `${base}?soundDebug=1`,
  ], { stdio: "ignore" });

  let page = null;
  for (let i = 0; i < 120 && !page; i++) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      page = pages.find((p) => p.type === "page" && p.url.startsWith(base));
    } catch (_) {}
    if (!page) await sleep(200);
  }
  if (!page) throw new Error("Chrome page did not become available");

  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (!msg.id || !pending.has(msg.id)) return;
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
  });
  await send("Runtime.enable");
  await send("Page.enable");

  const ready = await waitFor("document.readyState==='complete' && !!(window.CBZ && CBZ.soundDebug && CBZ.initAudio && CBZ.openDoor)", 30000);
  if (!ready) throw new Error("game audio/debug APIs did not become ready");

  const initial = await json(`(function(){
    const root=document.getElementById("soundDebug");
    return {enabled:CBZ.soundDebug.enabled(),visible:!!root&&getComputedStyle(root).display!=="none",text:root?root.innerText:""};
  })()`);
  check(initial.enabled && initial.visible, "query flag enables the sound debugger");
  check(/SOUND DEBUG/.test(initial.text) && /F8 hide/.test(initial.text), "overlay explains its F8 control");

  await evaluate("CBZ.initAudio()");
  const audioReady = await waitFor("!!CBZ.getAudioCtx() && CBZ.getAudioCtx().state==='running'", 10000);
  check(!!audioReady, "Web Audio context is running");

  await evaluate("CBZ.sfx('coin',{force:true})");
  const coinPlayed = await waitFor("CBZ.soundDebug.history().some(function(x){return x.name==='coin'})", 15000);
  check(!!coinPlayed, "ordinary recorded cue reaches the feed");

  const coin = await json(`(function(){
    const rows=CBZ.soundDebug.history().filter(function(x){return x.name==="coin"});
    const root=document.getElementById("soundDebug");
    return {row:rows[rows.length-1]||null,text:root?root.innerText:""};
  })()`);
  check(coin.row && /\.(?:m4a|mp3)$/.test(coin.row.detail), "feed names the selected recording", coin.row?.detail || "missing");
  check(/\bcoin\b/.test(coin.text), "rendered row shows the played cue");

  await evaluate("CBZ.sfx('glass',{force:true})");
  const glassPlayed = await waitFor("CBZ.soundDebug.history().some(function(x){return x.name==='glass'})", 3000);
  check(!!glassPlayed, "direct-player glass cue is mapped and schedulable");

  await evaluate("CBZ.sfx('door_open',{force:true});CBZ.sfx('door_close',{force:true})");
  const physicalDoors = await waitFor(`(function(){
    const h=CBZ.soundDebug.history();
    return h.some(function(x){return x.name==="door_open"&&/doorOpen_1\\.m4a$/.test(x.detail)})&&
      h.some(function(x){return x.name==="door_close"&&/doorClose_1\\.m4a$/.test(x.detail)});
  })()`, 3000);
  check(!!physicalDoors, "direction-specific physical door recordings are mapped");

  await evaluate("CBZ.sfx('shoot_pistol',{force:true})");
  check(!!(await waitFor("CBZ.soundDebug.history().some(function(x){return x.name==='shoot_pistol'})", 3000)),
    "procedural/sample gun voices are reported");

  await evaluate("CBZ.carAudio.start();CBZ.carAudio.update(0.25,1,0.5,'sports',false)");
  const carVoices = await waitFor(`(function(){
    const h=CBZ.soundDebug.history();
    return h.some(function(x){return x.name==="car_start"})&&
      h.some(function(x){return x.name==="car_engine"})&&
      h.some(function(x){return x.name==="car_screech"});
  })()`, 3000);
  check(!!carVoices, "vehicle start, engine, and tyre voices are reported");
  await evaluate("CBZ.carAudio.stop()");

  await evaluate("CBZ.predatorStinger('notice')");
  const predatorVoice = await waitFor("CBZ.soundDebug.history().some(function(x){return x.name==='predator_stinger:notice'})", 3000);
  check(!!predatorVoice, "standalone predator procedural audio is reported");
  const predatorCaller = await evaluate(`(function(){
    const h=CBZ.soundDebug.history().filter(function(x){return x.name==="predator_stinger:notice"});
    return h.length?h[h.length-1].caller:"";
  })()`);
  check(/^src\/systems\/predator\.js:\d+$/.test(predatorCaller), "predator audio retains its source file", predatorCaller || "missing");

  const beforeUnknown = await evaluate("CBZ.soundDebug.history().length");
  await evaluate("CBZ.sfx('__qa_unmapped_sound__')");
  await sleep(150);
  const afterUnknown = await evaluate("CBZ.soundDebug.history().length");
  check(beforeUnknown === afterUnknown, "unmapped/non-playing requests are not reported");

  await evaluate(`CBZ.debugSoundPlayed("qa_repeat","procedural QA",null,"tools/test-sound-debug-browser.mjs:1");
    CBZ.debugSoundPlayed("qa_repeat","procedural QA",null,"tools/test-sound-debug-browser.mjs:1")`);
  const repeatText = await evaluate("document.getElementById('soundDebug').innerText");
  check(/qa_repeat\s+×2/.test(repeatText), "rapid repeats collapse into a readable counter");

  const shot = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
  await writeFile(screenshot, Buffer.from(shot.data, "base64"));

  await f8();
  const hidden = await json(`(function(){const r=document.getElementById("soundDebug");return {enabled:CBZ.soundDebug.enabled(),display:getComputedStyle(r).display};})()`);
  check(!hidden.enabled && hidden.display === "none", "F8 hides the debugger");
  await f8();
  const shown = await json(`(function(){const r=document.getElementById("soundDebug");return {enabled:CBZ.soundDebug.enabled(),display:getComputedStyle(r).display};})()`);
  check(shown.enabled && shown.display !== "none", "F8 restores the debugger");

  await evaluate("CBZ.soundDebug.clear()");
  check((await evaluate("CBZ.soundDebug.history().length")) === 0, "clear removes review history");
  console.log(`  screenshot: ${screenshot}`);
} catch (error) {
  failed++;
  console.error("  ✗ test crashed:", error && error.stack ? error.stack : error);
} finally {
  if (ws) {
    try { ws.close(); } catch (_) {}
  }
  await stopChild(chrome);
  await stopChild(server);
  let cleanupError = null;
  for (let i = 0; i < 3; i++) {
    try {
      await rm(profile, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      cleanupError = null;
      break;
    } catch (error) {
      cleanupError = error;
      await sleep(150);
    }
  }
  if (cleanupError) console.warn("  cleanup warning:", cleanupError.message);
}

console.log(`sound debug: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
