#!/usr/bin/env node
/* tools/aimlock-check.mjs — verify the GTA-style soft aim-lock. Boots the game,
   enters first-person with a gun up + ADS, places a live ped OFF-AXIS in front,
   and checks the real per-frame applyAimLock() acquires it (CBZ.aimLockTarget)
   and pulls the aim onto it (CBZ.aimedActor returns the same ped). */
import { spawn } from "node:child_process";
import { rm, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = process.argv[2] || path.join(ROOT, "tools/shots/aimlock.png");
await mkdir(path.join(ROOT, "tools/shots"), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 8950 + Math.floor(Math.random() * 40);
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const base = `http://127.0.0.1:${port}/`;
const dbg = 9950 + Math.floor(Math.random() * 40);
const profile = `/tmp/cbz-aimlock-${dbg}`;
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
const setup = await evl(`(() => {
  const C = window.CBZ, g = C.game;
  g.cityHolstered = false; g.cityMeleeWeapon = null;
  if (!C.fpsActive || !C.fpsActive()) { try { C.toggleFPS(); } catch(e){} }
  const P = C.player.pos;
  const peds = (C.cityPeds||[]).filter(p=>p&&!p.dead&&(p.group||(p.char&&p.char.group)));
  const p = peds[0]; if (!p) return { none:true };
  const grp = p.group || p.char.group; grp.visible = true; p.dead=false; p.ko=0; p.escaped=false; p.speed=0; p.important=true;
  // place OFF-AXIS: 6m ahead (-z), 2.5m to the +x side (~23°, inside the cone)
  const gx = P.x + 2.5, gz = P.z - 6, gy = P.y;
  p.pos.x = gx; p.pos.z = gz; p.pos.y = gy; grp.position.set(gx, gy, gz);
  if (C.cam) { C.cam.yaw = 0; if (C.cam.pitch != null) C.cam.pitch = 0; }
  if (C.fps) C.fps.fp = 0;
  if (C.fpsSetAim) C.fpsSetAim(true);
  window.__p = p;
  return { none:false, fps: C.fpsActive&&C.fpsActive(), armed: C.playerArmed&&C.playerArmed(), ads: C.isADS&&C.isADS(),
           yaw0: +C.cam.yaw.toFixed(3), name: p.name||null };
})()`);
console.log("setup:", JSON.stringify(setup));
// angle (deg) between the live aim and the direction to the current lock target
const angleToLock = `(() => {
  const C = window.CBZ, T = window.THREE, lt = C.aimLockTarget && C.aimLockTarget(); if (!lt) return null;
  const grp = lt.group || (lt.char && lt.char.group); if (!grp) return null;
  const eye = C.camera.getWorldPosition(new T.Vector3());
  const fwd = new T.Vector3(); C.camera.getWorldDirection(fwd);
  const gp = grp.position; const d = new T.Vector3(gp.x - eye.x, (gp.y + 1.0) - eye.y, gp.z - eye.z).normalize();
  return +(Math.acos(Math.max(-1, Math.min(1, fwd.dot(d)))) * 180 / Math.PI).toFixed(2);
})()`;
// keep aim held + ped pinned; let applyAimLock() run; sample convergence
let angFirst = null;
for (let k = 0; k < 10; k++) {
  await evl(`(() => { const C=window.CBZ,p=window.__p; if(C.fpsSetAim)C.fpsSetAim(true); if(p){const g=p.group||p.char.group; g.visible=true; p.speed=0;} return true; })()`);
  await sleep(200);
  if (k === 0) angFirst = await evl(angleToLock);
}
const angLast = await evl(angleToLock);
console.log("convergence(deg): first=" + angFirst + " last=" + angLast);
const res = await evl(`(() => {
  const C = window.CBZ, p = window.__p;
  let aimed = null; try { const h = C.aimedActor(120); aimed = h && h.actor ? (h.actor === p ? "TARGET" : (h.actor.name||"other")) : null; } catch(e){ aimed = "ERR"; }
  const lt = C.aimLockTarget ? C.aimLockTarget() : null;
  return JSON.stringify({
    ads: C.isADS && C.isADS(),
    lockIsTarget: lt === p, lockName: lt ? (lt.name||"?") : null,
    aimedActor: aimed, yaw: +C.cam.yaw.toFixed(3),
  });
})()`);
console.log("result:", res);
const shot = await send("Page.captureScreenshot", { format: "png" });
await writeFile(OUT, Buffer.from(shot.result.data, "base64"));
console.log("shot:", OUT);
console.log(errors.length ? "ERRORS:\n" + [...new Set(errors)].slice(0, 10).join("\n") : "ERRORS: none");
chrome.kill("SIGTERM"); server.kill("SIGTERM");
await rm(profile, { recursive: true, force: true }).catch(() => {});
process.exit(0);
