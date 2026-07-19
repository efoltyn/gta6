#!/usr/bin/env node
/* tools/speech-check.mjs — verify NPC lines render as an ATTRIBUTED subtitle
   (speaker name + line) via CBZ.citySay, the surface citySayBark now routes to.
   Drives a real ped through citySay and reads back #citySpeech. Screenshots it. */
import { spawn } from "node:child_process";
import { rm, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = process.argv[2] || path.join(ROOT, "tools/shots/speech-check.png");
await mkdir(path.join(ROOT, "tools/shots"), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 8950 + Math.floor(Math.random() * 40);
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const base = `http://127.0.0.1:${port}/`;
const dbg = 9950 + Math.floor(Math.random() * 40);
const profile = `/tmp/cbz-speech-${dbg}`;
await rm(profile, { recursive: true, force: true });
await sleep(700);
const chrome = spawn(process.env.CBZ_CHROME || "/opt/pw-browsers/chromium", [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader", "--enable-webgl", "--mute-audio", "--window-size=1280,820",
  `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, base,
], { stdio: "ignore" });
let pageInfo = null;
for (let i = 0; i < 80 && !pageInfo; i++) { try { const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json(); pageInfo = ps.find((p) => p.type === "page" && p.url.startsWith(base)); } catch (_) {} if (!pageInfo) await sleep(250); }
if (!pageInfo) { console.error("FAIL: no page"); process.exit(1); }
const ws = new WebSocket(pageInfo.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
let id = 1; const pending = new Map(); const errors = [];
ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; } if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; errors.push(`${d.url || "?"}:${d.lineNumber} ${(d.exception && d.exception.description || d.text || "").split("\n")[0]}`); } });
const send = (method, params = {}) => new Promise((r) => { const i = id++; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expression) => { const r = await send("Runtime.evaluate", { expression, returnByValue: true }); return r.result && r.result.result && r.result.result.value; };
await send("Runtime.enable"); await send("Page.enable");
for (let i = 0; i < 60; i++) { if (await evl("!!(window.CBZ && CBZ.game && document.getElementById('playBtn'))")) break; await sleep(500); }
let playing = false;
for (let i = 0; i < 120 && !playing; i++) { await evl("(() => { const b = document.getElementById('playBtn'); if (b) b.click(); return true; })()"); await sleep(600); playing = await evl("!!(window.CBZ && CBZ.game && CBZ.game.state === 'playing')"); }
console.log("playing:", playing);
await sleep(2500);
// drive a real ped through the attributed speech surface, near the camera
const res = await evl(`(() => {
  const C = window.CBZ, P = C.player.pos;
  const peds = (C.cityPeds || []).filter(p => p && !p.dead && p.group && p.name);
  peds.sort((a,b) => Math.hypot(a.pos.x-P.x,a.pos.z-P.z) - Math.hypot(b.pos.x-P.x,b.pos.z-P.z));
  const p = peds[0]; if (!p) return { none:true };
  p.pos.x = P.x + 2; p.pos.z = P.z; if (p.group) p.group.position.set(p.pos.x, p.pos.y, p.pos.z);
  C.citySay(p, "Wrong block, opp.", null, 6);
  const el = document.getElementById("citySpeech");
  const nm = el && el.querySelector(".citySpeechSpeaker");
  const ln = el && el.querySelector(".citySpeechLine");
  return { none:false, name: p.name, shown: !!(el && el.classList.contains("show")),
           speaker: nm ? nm.textContent : null, line: ln ? ln.textContent : null };
})()`);
console.log("speech:", JSON.stringify(res));
await sleep(400);
const shot = await send("Page.captureScreenshot", { format: "png" });
await writeFile(OUT, Buffer.from(shot.result.data, "base64"));
console.log("shot:", OUT);
console.log(errors.length ? "ERRORS:\n" + [...new Set(errors)].slice(0, 10).join("\n") : "ERRORS: none");
chrome.kill("SIGTERM"); server.kill("SIGTERM");
await rm(profile, { recursive: true, force: true }).catch(() => {});
process.exit(0);
