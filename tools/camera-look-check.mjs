#!/usr/bin/env node
/* tools/camera-look-check.mjs — THE LOOK-DIRECTION GATE.
 *
 * The bug this exists to stop coming back: `cam.pitch` is DOWN-positive (the
 * third-person orbit is `oy = sin(pitch)·dist`) while `fps.fp` is UP-positive,
 * and every raw input writer used to subtract the drag as if the two were the
 * same convention. First person looked where you dragged; third person looked
 * the opposite way, on the mouse, the thumb and the stick alike.
 *
 * So this measures the ONE thing a player feels, in both tiers, through the
 * REAL event handlers: drag DOWN and the view must go DOWN; drag RIGHT and it
 * must swing RIGHT. Ground truth is the live camera.getWorldDirection() — not
 * any internal angle — so no convention can hide inside it, and third person
 * is required to carry the SAME SIGN as first person on both axes.
 *
 * Two third-person tiers are measured, because the city pins its frame:
 *   FREE ORBIT  (CAM_TP_FIXED_ANGLE off — this is what jail/survival always
 *               run): the LENS is the aim, so the lens is the probe.
 *   PINNED CITY (shipped default): the lens is held at the tier's resting
 *               angle on purpose and the mouse moves the AIM, so cam.pitch
 *               itself is the probe — and down-positive means a drag DOWN has
 *               to make it GROW.
 *
 * Usage: node tools/camera-look-check.mjs
 */
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 8950 + Math.floor(Math.random() * 40);
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const base = `http://127.0.0.1:${port}/`;
const dbg = 9950 + Math.floor(Math.random() * 40);
const profile = `/tmp/cbz-camlook-${dbg}`;
await rm(profile, { recursive: true, force: true });
await sleep(700);
const chrome = spawn(process.env.CBZ_CHROME || "/opt/pw-browsers/chromium", [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader", "--enable-webgl", "--mute-audio", "--window-size=1280,820",
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
await send("Runtime.enable");

for (let i = 0; i < 60; i++) { if (await evl("!!(window.CBZ && CBZ.game && document.getElementById('playBtn'))")) break; await sleep(500); }
let playing = false;
for (let i = 0; i < 120 && !playing; i++) {
  await evl("(() => { const b = document.getElementById('playBtn'); if (b) b.click(); return true; })()");
  await sleep(600);
  playing = await evl("!!(window.CBZ && CBZ.game && CBZ.game.state === 'playing')");
}
if (!playing) { console.error("FAIL: never reached playing"); done(1); }

// The arrival cinematic OWNS position and look while it runs, so every sample
// taken under it is noise. Wait it out (CAM intro is ~3.55s of presentation
// time) and prove the lens has actually gone quiet before measuring anything.
await sleep(6000);
await evl(`(() => {
  const C = window.CBZ;
  // Both look handlers gate on a pointer lock (camera.js on CBZ.cam.locked,
  // fpsmode.js on document.pointerLockElement). Headless cannot grant a real
  // one, so open both gates and then drive the REAL listeners with real events.
  try { Object.defineProperty(document, "pointerLockElement", { configurable: true, get: () => document.body }); } catch (e) {}
  C.cam.locked = true;
  if (C.player) { C.player.dead = false; }
  return true;
})()`);

const dirExpr = `(() => { const T = window.THREE, v = new T.Vector3(); window.CBZ.camera.getWorldDirection(v);
  return { x: +v.x.toFixed(5), y: +v.y.toFixed(5), z: +v.z.toFixed(5), pitch: +window.CBZ.cam.pitch.toFixed(5), yaw: +window.CBZ.cam.yaw.toFixed(5) }; })()`;

async function quiet(maxMs = 20000) {   // wait until the lens stops drifting on its own
  const t0 = Date.now();
  let prev = await evl(dirExpr);
  while (Date.now() - t0 < maxMs) {
    await sleep(400);
    const now = await evl(dirExpr);
    if (Math.abs(now.x - prev.x) + Math.abs(now.y - prev.y) + Math.abs(now.z - prev.z) < 0.002) return true;
    prev = now;
  }
  return false;
}

const DRAG = 60;   // px — well clear of any per-frame ease
async function drag(mx, my) {
  await evl(`(() => {
    const C = window.CBZ;
    C.cam.locked = true;                       // the desktop look gate (camera.js)
    const e = new MouseEvent("mousemove", { bubbles: true });
    // Chromium drops movementX/Y from the init dict of a synthetic event, so
    // define them on the instance — the handlers only ever read the properties.
    Object.defineProperty(e, "movementX", { value: ${mx} });
    Object.defineProperty(e, "movementY", { value: ${my} });
    document.dispatchEvent(e);
    return true;
  })()`);
  await sleep(700);
}
const headingOf = (d) => Math.atan2(d.x, d.z);
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

async function level() {
  await evl(`(() => { const C = window.CBZ; C.cam.pitch = 0; if (C.fps) C.fps.fp = 0; return true; })()`);
  await sleep(700);
  await quiet(6000);
}

async function measure(label) {
  await level();
  const a = await evl(dirExpr);
  await drag(0, DRAG);                       // DRAG DOWN
  const b = await evl(dirExpr);
  await level();
  const c = await evl(dirExpr);
  await drag(DRAG, 0);                       // DRAG RIGHT
  const d = await evl(dirExpr);
  const r = {
    dViewY: b.y - a.y,                       // < 0 = the view went DOWN
    dCamPitch: b.pitch - a.pitch,            // > 0 = the AIM went down (down-positive)
    dHead: wrap(headingOf(d) - headingOf(c)),
    dCamYaw: wrap(d.yaw - c.yaw),
  };
  console.log(`${label}  drag-down: viewY ${r.dViewY.toFixed(4)} / cam.pitch ${r.dCamPitch >= 0 ? "+" : ""}${r.dCamPitch.toFixed(4)}` +
              `   drag-right: heading ${r.dHead >= 0 ? "+" : ""}${r.dHead.toFixed(4)} / cam.yaw ${r.dCamYaw.toFixed(4)}`);
  return r;
}

async function setFps(on) {
  await evl(`(() => { const C = window.CBZ; const is = !!(C.fps && C.fps.active); if (is !== ${on}) C.setFPS(${on}); return true; })()`);
  await sleep(900);
  await quiet(6000);
}
async function setPin(on) {
  await evl(`(() => { window.CBZ.CONFIG.CAM_TP_FIXED_ANGLE = ${on}; return true; })()`);
  await sleep(900);
  await quiet(8000);
}

const env = await evl(`(() => { const C = window.CBZ; return {
  mode: C.game.mode, state: C.game.state, locked: !!C.cam.locked,
  plockSpoofed: document.pointerLockElement === document.body,
  pinnedByDefault: !!(C.camAimDecoupled && C.camAimDecoupled()),
  orbit: C.CONFIG.CAM_RDR2_ORBIT !== false,
}; })()`);
console.log("env:", JSON.stringify(env));

await setFps(true);
const fp = await measure("first-person       ");
await setFps(false);
await setPin(false);
const tpFree = await measure("third-person free  ");
await setPin(true);
const tpPin = env.pinnedByDefault ? await measure("third-person pinned") : null;

const fails = [];
const EPS = 0.01;
// --- first person: the reference every third-person tier has to match ------
if (!(fp.dViewY < -EPS)) fails.push("first-person: dragging DOWN did not lower the view");
if (!(Math.abs(fp.dHead) > EPS)) fails.push("first-person: dragging RIGHT moved no yaw");
// --- free-orbit third person (jail/survival, and the city with the pin off) -
if (!(tpFree.dViewY < -EPS)) fails.push("third-person (free orbit): dragging DOWN did not lower the view — the pitch inversion is back");
if (Math.sign(tpFree.dViewY) !== Math.sign(fp.dViewY)) fails.push("third-person (free orbit) pitches the opposite way from first person");
if (Math.sign(tpFree.dHead) !== Math.sign(fp.dHead)) fails.push("third-person (free orbit) yaws the opposite way from first person");
// --- pinned city third person: the lens is fixed BY DESIGN, so check the aim
if (tpPin) {
  if (!(tpPin.dCamPitch > EPS)) fails.push("third-person (pinned city): dragging DOWN did not aim DOWN (cam.pitch is down-positive, so it must grow)");
  if (Math.sign(tpPin.dCamYaw) !== Math.sign(fp.dCamYaw)) fails.push("third-person (pinned city) yaws the opposite way from first person");
}

if (fails.length) { console.error("FAIL:\n  " + fails.join("\n  ")); done(1); }
console.log("PASS: every tier looks where you drag, with matching signs on both axes.");
done(0);
