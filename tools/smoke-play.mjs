#!/usr/bin/env node
/* tools/smoke-play.mjs — boot the game headless, press PLAY, run N seconds,
   collect every console error/page exception, take a gameplay screenshot.
   The pass/fail gate for rig/vehicle refactors: the city must come up clean.
   Usage: node tools/smoke-play.mjs [seconds=12] [out.png] */
import { spawn } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RUN_S = +(process.argv[2] || 12);
const OUT = process.argv[3] || path.join(ROOT, "tools/shots/smoke-play.png");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const port = 8950 + Math.floor(Math.random() * 40);
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], {
  env: { ...process.env, PORT: String(port) }, stdio: "ignore",
});
const base = `http://127.0.0.1:${port}/`;
const dbg = 9950 + Math.floor(Math.random() * 40);
const profile = `/tmp/cbz-smoke-${dbg}`;
await rm(profile, { recursive: true, force: true });
await sleep(700);
const chrome = spawn("/opt/pw-browsers/chromium", [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--enable-webgl", "--mute-audio", "--window-size=1440,900",
  `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, base,
], { stdio: "ignore" });

let page = null;
for (let i = 0; i < 80 && !page; i++) {
  try {
    const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json();
    page = ps.find((p) => p.type === "page" && p.url.startsWith(base));
  } catch (_) {}
  if (!page) await sleep(250);
}
if (!page) { console.error("FAIL: no page"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
let id = 1; const pending = new Map(); const errors = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") {
    const d = m.params.exceptionDetails;
    errors.push(`${d.url || "?"}:${d.lineNumber} ${(d.exception && d.exception.description || d.text || "").split("\n")[0]}`);
  } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
    errors.push("console.error: " + m.params.args.map((a) => a.value || a.description || "").join(" ").slice(0, 200));
  }
});
const send = (method, params = {}) => new Promise((r) => { const i = id++; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true });
  return r.result && r.result.result && r.result.result.value;
};
await send("Runtime.enable");
await send("Page.enable");

// wait for scripts, click play
for (let i = 0; i < 60; i++) {
  if (await evl("!!(window.CBZ && CBZ.game && document.getElementById('playBtn'))")) break;
  await sleep(500);
}
let playing = false;
for (let i = 0; i < 120 && !playing; i++) {
  // re-click until the handler is attached and the state actually flips
  await evl("(() => { const b = document.getElementById('playBtn'); if (b) { b.click(); b.dispatchEvent(new MouseEvent('mousedown', {bubbles:true})); b.dispatchEvent(new MouseEvent('mouseup', {bubbles:true})); } return true; })()");
  await sleep(600);
  playing = await evl("!!(window.CBZ && CBZ.game && CBZ.game.state === 'playing')");
}
console.log("playing:", playing);
// simulate a run forward + a couple of punches so the anim paths execute
await evl(`(() => {
  const kd = (code, key) => { const e = new KeyboardEvent("keydown", { code, key, bubbles: true }); document.dispatchEvent(e); window.dispatchEvent(e); };
  const ku = (code, key) => { const e = new KeyboardEvent("keyup", { code, key, bubbles: true }); document.dispatchEvent(e); window.dispatchEvent(e); };
  kd("KeyW", "w"); setTimeout(() => ku("KeyW", "w"), 2500);
  setTimeout(() => { if (CBZ.playerChar) { CBZ.playerChar.punchKind = "jab"; CBZ.playerChar.punchArm = "r"; CBZ.playerChar.punchDur = 0.34; CBZ.playerChar.punchT = 0.34; } }, 2800);
  return true;
})()`);
await sleep(RUN_S * 1000);
const state = await evl(`JSON.stringify({
  state: CBZ.game && CBZ.game.state,
  mode: CBZ.game && CBZ.game.mode,
  peds: (CBZ.cityPeds || []).length,
  playerY: CBZ.player && CBZ.player.pos && +CBZ.player.pos.y.toFixed(2),
  fps: CBZ.game && CBZ.game.fps,
})`);
console.log("state:", state);
const shot = await send("Page.captureScreenshot", { format: "png" });
await writeFile(OUT, Buffer.from(shot.result.data, "base64"));
console.log("shot:", OUT);
const uniq = [...new Set(errors)];
console.log(uniq.length ? "ERRORS (" + uniq.length + "):\n" + uniq.slice(0, 25).join("\n") : "ERRORS: none");
chrome.kill("SIGTERM"); server.kill("SIGTERM");
await rm(profile, { recursive: true, force: true }).catch(() => {});
process.exit(uniq.length ? 2 : 0);
