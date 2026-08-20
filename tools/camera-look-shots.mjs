#!/usr/bin/env node
/* tools/camera-look-shots.mjs — the pictures behind tools/camera-look-check.mjs.
 *
 * Boots the city once, parks the player, and renders the SAME third-person shot
 * at the pitches the old and new mouse handler produce from an identical drag.
 * `cam.pitch` is one scalar, so posing it directly is exactly what the handler
 * does — no input plumbing in the way, and both halves of the comparison come
 * out of one session, one spot, one yaw, one time of day.
 *
 * Writes tools/shots/look/*.png. Usage: node tools/camera-look-shots.mjs
 */
import { spawn } from "node:child_process";
import { rm, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUTDIR = path.join(ROOT, "tools/shots/look");
await mkdir(OUTDIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 8990 + Math.floor(Math.random() * 9);
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const base = `http://127.0.0.1:${port}/`;
const dbg = 9990 + Math.floor(Math.random() * 9);
const profile = `/tmp/cbz-lookshots-${dbg}`;
await rm(profile, { recursive: true, force: true });
await sleep(700);
const chrome = spawn(process.env.CBZ_CHROME || "/opt/pw-browsers/chromium", [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader", "--enable-webgl", "--mute-audio", "--window-size=1280,720",
  `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, base,
], { stdio: "ignore" });
function done(code) { try { chrome.kill(); } catch (e) {} try { server.kill(); } catch (e) {} process.exit(code); }

let pageInfo = null;
for (let i = 0; i < 80 && !pageInfo; i++) {
  try { const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json(); pageInfo = ps.find((p) => p.type === "page" && p.url.startsWith(base)); } catch (_) {}
  if (!pageInfo) await sleep(250);
}
if (!pageInfo) { console.error("FAIL: no page"); done(1); }
const ws = new WebSocket(pageInfo.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
let id = 1; const pending = new Map();
ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = id++; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expression) => { const r = await send("Runtime.evaluate", { expression, returnByValue: true }); return r.result && r.result.result && r.result.result.value; };
await send("Runtime.enable"); await send("Page.enable");

for (let i = 0; i < 60; i++) { if (await evl("!!(window.CBZ && CBZ.game && document.getElementById('playBtn'))")) break; await sleep(500); }
let playing = false;
for (let i = 0; i < 120 && !playing; i++) {
  await evl("(() => { const b = document.getElementById('playBtn'); if (b) b.click(); return true; })()");
  await sleep(600);
  playing = await evl("!!(window.CBZ && CBZ.game && CBZ.game.state === 'playing')");
}
if (!playing) { console.error("FAIL: never reached playing"); done(1); }
await sleep(7000);                       // let the arrival cinematic finish

// One spot, one yaw, one clock, for every frame in the comparison.
await evl(`(() => {
  const C = window.CBZ;
  C.cam.locked = true;
  C.cam.yaw = 0;
  if (C.setTimeOfDay) { try { C.setTimeOfDay(11); } catch (e) {} }
  if (C.player) C.player.dead = false;
  return true;
})()`);
await sleep(1200);

async function shot(name, setup) {
  await evl(`(() => { const C = window.CBZ; ${setup} return true; })()`);
  await sleep(1400);                     // the rig damps; give it the settle
  const r = await send("Page.captureScreenshot", { format: "png" });
  const b64 = r.result && r.result.result && r.result.result.data;
  if (!b64) { console.error("FAIL: no screenshot for " + name); done(1); }
  await writeFile(path.join(OUTDIR, name + ".png"), Buffer.from(b64, "base64"));
  const a = await evl("window.CBZ.camAudit()");
  console.log(`${name.padEnd(24)} cam.pitch ${(+a.pitch).toFixed(3).padStart(7)}  viewPitch ${(+a.viewPitch).toFixed(3).padStart(7)}  frameTilt ${(+a.frameTilt).toFixed(3)}`);
  return { name, pitch: +a.pitch, viewPitch: +a.viewPitch, frameTilt: +a.frameTilt };
}

const REST = await evl("(window.CBZ.CITY_TP && window.CBZ.CITY_TP.PITCH) || 0.10");
const D = 0.55;                          // ~230 px of drag at the shipped sens
const meta = { rest: REST, drag: D, shots: [] };

// ---- FREE ORBIT (the shipped default now; what jail/survival always ran) ----
await evl(`(() => { window.CBZ.CONFIG.CAM_TP_FIXED_ANGLE = false; return true; })()`);
await sleep(1200);
meta.shots.push(await shot("free-level",    `C.cam.pitch = ${REST};`));
meta.shots.push(await shot("free-pitch-up", `C.cam.pitch = ${REST - D};`));
meta.shots.push(await shot("free-pitch-down", `C.cam.pitch = ${REST + D};`));

// ---- PINNED (the old shipped default): the same three inputs, one frame ----
await evl(`(() => { window.CBZ.CONFIG.CAM_TP_FIXED_ANGLE = true; return true; })()`);
await sleep(1600);
meta.shots.push(await shot("pinned-level",  `C.cam.pitch = ${REST};`));
meta.shots.push(await shot("pinned-aim-up", `C.cam.pitch = -0.40;`));
meta.shots.push(await shot("pinned-aim-down", `C.cam.pitch = 0.36;`));
await evl(`(() => { window.CBZ.CONFIG.CAM_TP_FIXED_ANGLE = false; return true; })()`);

// ---- FIRST PERSON: the reference the third-person tier has to match --------
await evl(`(() => { const C = window.CBZ; C.setFPS(true); return true; })()`);
await sleep(2000);
meta.shots.push(await shot("fps-level",     `C.fps.fp = 0;`));
meta.shots.push(await shot("fps-look-down", `C.fps.fp = ${-D};`));
meta.shots.push(await shot("fps-look-up",   `C.fps.fp = ${D};`));

await writeFile(path.join(OUTDIR, "shots.json"), JSON.stringify(meta, null, 2));
console.log("\nwrote " + meta.shots.length + " frames to tools/shots/look/");
done(0);
