#!/usr/bin/env node
/* tools/raceway-shot.mjs — photograph the City Speedway ticket office:
   1. teleport the player INSIDE the raceway lot (the bespoke betting-parlor
      interior in buildings.js) and screenshot the room
   2. open the race book overlay (CBZ.cityOpenRaceBook) and screenshot the
      odds board UI
   Usage: node tools/raceway-shot.mjs */
import { spawn } from "node:child_process";
import { rm, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SHOTS = path.join(ROOT, "tools/shots");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await mkdir(SHOTS, { recursive: true });

const port = 8850 + Math.floor(Math.random() * 30);
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], {
  env: { ...process.env, PORT: String(port) }, stdio: "ignore",
});
const base = `http://127.0.0.1:${port}/`;
const dbg = 9850 + Math.floor(Math.random() * 30);
const profile = `/tmp/cbz-rway-${dbg}`;
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
let id = 1; const pending = new Map();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((r) => { const i = id++; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true });
  return r.result && r.result.result && r.result.result.value;
};
const shot = async (name) => {
  const s = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(path.join(SHOTS, name), Buffer.from(s.result.data, "base64"));
  console.log("shot:", path.join(SHOTS, name));
};
await send("Runtime.enable");
await send("Page.enable");

// the shop lottery doesn't seat every essential in every seed — walk seeds
// until one places the raceway lot.
async function bootSeed(seed) {
  await send("Page.navigate", { url: base + (seed != null ? "?seed=" + seed : "") });
  await sleep(1500);
  for (let i = 0; i < 60; i++) {
    if (await evl("!!(window.CBZ && CBZ.game && document.getElementById('playBtn'))")) break;
    await sleep(500);
  }
  let playing = false;
  for (let i = 0; i < 90 && !playing; i++) {
    await evl("(() => { const b = document.getElementById('playBtn'); if (b) { b.click(); b.dispatchEvent(new MouseEvent('mousedown', {bubbles:true})); b.dispatchEvent(new MouseEvent('mouseup', {bubbles:true})); } return true; })()");
    await sleep(600);
    playing = await evl("!!(window.CBZ && CBZ.game && CBZ.game.state === 'playing')");
  }
  return playing;
}
let lot = null;
for (const seed of [null, 2, 3, 4, 5, 7]) {
  const playing = await bootSeed(seed);
  console.log("seed", seed == null ? "(default)" : seed, "playing:", playing);
  if (!playing) continue;
  lot = await evl(`(() => {
    const A = CBZ.city && CBZ.city.arena; if (!A || !A.shopLots) return null;
    const l = A.shopLots.find((x) => x.kind === "raceway");
    if (!l) return null;
    const d = l.building && l.building.door;
    return { cx: l.cx, cz: l.cz, w: l.w, d: l.d, door: d ? { x: d.x, z: d.z, nx: d.nx, nz: d.nz } : null, name: l.building && l.building.name };
  })()`);
  console.log("raceway lot:", JSON.stringify(lot));
  if (lot) break;
}
if (!lot) { console.error("FAIL: no raceway lot in any tried seed"); process.exit(1); }
await evl("CBZ.dayPhase && CBZ.dayPhase(0.45)");

// stand just inside the door, facing the room, camera pulled behind the player
await evl(`(() => {
  const A = CBZ.city.arena;
  const l = A.shopLots.find((x) => x.kind === "raceway");
  const d = l.building.door;
  const ix = d.nx || 0, iz = d.nz || 0;
  CBZ.player.pos.set(d.x + ix * 2.2, 0, d.z + iz * 2.2);
  if (CBZ.playerChar) CBZ.playerChar.group.position.copy(CBZ.player.pos);
  if (CBZ.cam) { CBZ.cam.yaw = Math.atan2(ix, iz) + Math.PI; CBZ.cam.pitch = -0.12; }
  return true;
})()`);
await sleep(4000);
await shot("raceway-interior.png");
// a second vantage from deeper in, looking back across the betting windows
await evl(`(() => {
  const A = CBZ.city.arena;
  const l = A.shopLots.find((x) => x.kind === "raceway");
  const d = l.building.door;
  const ix = d.nx || 0, iz = d.nz || 0;
  CBZ.player.pos.set(d.x + ix * 6.5, 0, d.z + iz * 6.5);
  if (CBZ.playerChar) CBZ.playerChar.group.position.copy(CBZ.player.pos);
  return true;
})()`);
await sleep(2500);
await shot("raceway-interior2.png");

// the race book overlay
await evl("CBZ.cityOpenRaceBook && CBZ.cityOpenRaceBook(true)");
await sleep(800);
const book = await evl("(() => { const el = document.getElementById('speedwayBook'); return el && el.style.display === 'block' ? el.textContent.slice(0, 80) : null; })()");
console.log("book overlay:", JSON.stringify(book));
await shot("raceway-book.png");

try { chrome.kill(); } catch (_) {}
try { server.kill(); } catch (_) {}
console.log("done");
process.exit(0);
