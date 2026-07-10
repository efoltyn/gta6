#!/usr/bin/env node
/* tools/street-shot.mjs — boot, play, then film the live street in third
   person: override the camera each frame (render-wrap trick), aim at a road
   with traffic + peds, screenshot. Integration eyeball for rigs + cars. */
import { spawn } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = process.argv[2] || path.join(ROOT, "tools/shots/street.png");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 8930 + Math.floor(Math.random() * 40);
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const base = `http://127.0.0.1:${port}/`;
const dbg = 9930 + Math.floor(Math.random() * 40);
await rm(`/tmp/cbz-street-${dbg}`, { recursive: true, force: true });
await sleep(700);
const chrome = spawn(process.env.CBZ_CHROME || (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/opt/pw-browsers/chromium"), ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-webgl", "--mute-audio", "--window-size=1600,1000", `--remote-debugging-port=${dbg}`, `--user-data-dir=/tmp/cbz-street-${dbg}`, base], { stdio: "ignore" });
let page = null;
for (let i = 0; i < 80 && !page; i++) { try { const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json(); page = ps.find((p) => p.type === "page" && p.url.startsWith(base)); } catch (_) {} if (!page) await sleep(250); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
let id = 1; const pending = new Map();
ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = id++; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expression) => { const r = await send("Runtime.evaluate", { expression, returnByValue: true }); return r.result && r.result.result && r.result.result.value; };
await send("Runtime.enable"); await send("Page.enable");
for (let i = 0; i < 60; i++) { if (await evl("!!(window.CBZ && CBZ.game && document.getElementById('playBtn'))")) break; await sleep(500); }
let playing = false;
for (let i = 0; i < 120 && !playing; i++) { await evl("(() => { const b = document.getElementById('playBtn'); if (b) b.click(); return true; })()"); await sleep(600); playing = await evl("!!(CBZ.game && CBZ.game.state === 'playing')"); }
await sleep(6000);   // let traffic/peds populate
// camera override: hover a busy sidewalk, looking down-street
const info = await evl(`(() => {
  if (!CBZ.renderer.__streetPatch) {
    const orig = CBZ.renderer.render.bind(CBZ.renderer);
    CBZ.renderer.render = function (s, cam) {
      const t = window.__cam;
      if (t && cam && cam.position) { cam.position.set(t[0], t[1], t[2]); cam.lookAt(t[3], t[4], t[5]); cam.updateMatrixWorld(); }
      return orig(s, cam);
    };
    CBZ.renderer.__streetPatch = true;
  }
  // find the densest cluster of walking peds and film it from street level
  const peds = (CBZ.cityPeds || []).filter((p) => p && !p.dead && p.group && p.group.visible && !p._parked);
  const cars = (CBZ.cityCars || []).filter((c) => c && c.group && c.group.visible);
  // pick the densest ped cluster that ALSO has traffic nearby (a real street,
  // not a beach outpost on a far island)
  let best = null, bestN = -1;
  for (const p of peds) {
    let carNear = false;
    for (const c of cars) { const dx = c.group.position.x - p.pos.x, dz = c.group.position.z - p.pos.z; if (dx * dx + dz * dz < 45 * 45) { carNear = true; break; } }
    if (!carNear) continue;
    let n = 0;
    for (const q of peds) { const dx = q.pos.x - p.pos.x, dz = q.pos.z - p.pos.z; if (dx * dx + dz * dz < 25 * 25) n++; }
    if (n > bestN) { bestN = n; best = p; }
  }
  let car = null, cd = 1e9;
  if (best) for (const c of cars) { const dx = c.group.position.x - best.pos.x, dz = c.group.position.z - best.pos.z; const d = dx * dx + dz * dz; if (d < cd) { cd = d; car = c; } }
  const fx = best ? best.pos.x : 0, fz = best ? best.pos.z : 0;
  const cx = car ? car.group.position.x : fx, cz = car ? car.group.position.z : fz;
  const mx = (fx + cx) / 2, mz = (fz + cz) / 2;
  // teleport the PLAYER to the cluster and face it (the camera rig follows
  // the player; overriding the camera transform directly gets overwritten
  // by whatever render path the game uses now)
  const dx = -7, dz = -7;
  CBZ.player.pos.x = mx + 7; CBZ.player.pos.z = mz + 7; CBZ.player.pos.y = 2;
  if (CBZ.cam) { CBZ.cam.yaw = Math.atan2(dx, dz); if (typeof CBZ.cam.pitch === "number") CBZ.cam.pitch = 0.08; }
  return { peds: bestN, carDist: Math.sqrt(cd) | 0, at: [mx | 0, mz | 0] };
})()`);
console.log("scene:", JSON.stringify(info));
await sleep(2500);
const shot = await send("Page.captureScreenshot", { format: "png" });
await writeFile(OUT, Buffer.from(shot.result.data, "base64"));
console.log(OUT);
chrome.kill("SIGTERM"); server.kill("SIGTERM");
await rm(`/tmp/cbz-street-${dbg}`, { recursive: true, force: true }).catch(() => {});
