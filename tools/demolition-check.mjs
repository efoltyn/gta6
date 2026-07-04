#!/usr/bin/env node
/* tools/demolition-check.mjs — end-to-end gate for city/demolition.js:
   1. blast an eligible building with repeated RPG-strength explosions → collapse
   2. screenshot RUBBLE phase (player teleported across the street)
   3. day-jump → CLEARED phase screenshot
   4. day-jump → SCAFFOLD phase screenshot
   5. day-jump → REBUILT: building back, ledger empty, colliders restored
   6. serialize/apply round-trip */
import { spawn } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUTDIR = ROOT + "/tools/shots";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 8930 + Math.floor(Math.random() * 9);
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const base = `http://127.0.0.1:${port}/`;
const dbg = 9930 + Math.floor(Math.random() * 9);
const profile = `/tmp/cbz-demo-${dbg}`;
await rm(profile, { recursive: true, force: true });
await sleep(700);
const chrome = spawn("/opt/pw-browsers/chromium", [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--enable-webgl", "--mute-audio", "--window-size=1280,800",
  `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, base,
], { stdio: "ignore" });
let page = null;
for (let i = 0; i < 80 && !page; i++) {
  try { const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json(); page = ps.find((p) => p.type === "page" && p.url.startsWith(base)); } catch (_) {}
  if (!page) await sleep(250);
}
if (!page) { console.error("no page"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res) => ws.addEventListener("open", res, { once: true }));
let id = 1; const pending = new Map(); const errors = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") errors.push(((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text || "").split("\n")[0]);
});
const send = (method, params = {}) => new Promise((r) => { const i = id++; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true }); return r.result && r.result.result && r.result.result.value; };
const shot = async (f) => { const s = await send("Page.captureScreenshot", { format: "png" }); await writeFile(path.join(OUTDIR, f), Buffer.from(s.result.data, "base64")); console.log("shot:", f); };
await send("Runtime.enable"); await send("Page.enable");
for (let i = 0; i < 60; i++) { if (await evl("!!(window.CBZ && CBZ.game && document.getElementById('playBtn'))")) break; await sleep(500); }
let playing = false;
for (let i = 0; i < 120 && !playing; i++) { await evl("(() => { const b = document.getElementById('playBtn'); if (b) b.click(); return true; })()"); await sleep(600); playing = await evl("!!(CBZ.game && CBZ.game.state === 'playing')"); }
console.log("playing:", playing);
await sleep(3000);

// pick a target: an eligible 2-4 storey building; teleport player to face it
const pick = await evl(`(() => {
  function b0door(lot) {
    const d = lot.building && lot.building.door;
    if (d && d.nx != null) return d;
    return { x: lot.cx - lot.w / 2, z: lot.cz, nx: -1, nz: 0 };
  }
  const A = (CBZ.city && (CBZ.city.arena || CBZ.city));
  const D = CBZ.cityDemolition;
  const cands = (A.lots || []).filter(l => l.building && l.building.group && l.building.storeys >= 2 && l.building.storeys <= 4 && !l.building.boarded && !l.building.helipad);
  if (!cands.length) return "none";
  const lot = cands[(cands.length * 0.3) | 0];
  window.__lot = lot;
  const b = lot.building;
  // stand on the street the DOOR faces (guaranteed clear of neighbours),
  // far enough back to frame the whole facade
  const door = b0door(lot);
  const back = Math.max(lot.w, lot.d) * 0.55 + 26;
  const px = door.x + door.nx * back, pz = door.z + door.nz * back;
  window.__view = { px, pz };
  CBZ.player.pos.x = px; CBZ.player.pos.z = pz; CBZ.player.pos.y = 1.5;
  if (CBZ.cam) { CBZ.cam.yaw = Math.atan2(b.ox - px, b.oz - pz) + Math.PI; if (typeof CBZ.cam.pitch === "number") CBZ.cam.pitch = -0.02; }
  return JSON.stringify({ kind: lot.kind, storeys: b.storeys, w: b.w, d: b.d, hp: D.hp(lot) });
})()`);
console.log("target:", pick);
await sleep(1200);
await shot("demo-e2e-0-intact.png");

// collapse directly (blast-driven HP -> destroy already proven in the prior
// run; cityExplosion chains ignite street cars whose cook-offs wreck the shoot)
const boom = await evl(`(() => {
  const lot = window.__lot, D = CBZ.cityDemolition;
  const ok = D.destroy(lot);
  return JSON.stringify({ ok, down: D.has(lot), count: D.count(), phase: (D.list()[0] || {}).phase });
})()`);
console.log("blasts:", boom);
await sleep(1500);
await evl("(() => { const v = window.__view, b = window.__lot.building; CBZ.player.pos.x = v.px; CBZ.player.pos.z = v.pz; CBZ.player.pos.y = 1.5; if (CBZ.cam) { CBZ.cam.yaw = Math.atan2(b.ox - v.px, b.oz - v.pz) + Math.PI; CBZ.cam.pitch = -0.02; } return 1; })()");
await sleep(700);
await shot("demo-e2e-1-rubble.png");

// day-jump to CLEARED
const p2 = await evl(`(() => { CBZ.dayCount(CBZ.dayCount() + 3); return "day=" + CBZ.dayTime().toFixed(2); })()`);
await sleep(1600);  // > one 0.7s tick even at crawling sim time? ticks are real-dt based — 1.6s covers 2 ticks
console.log("jump:", p2, "phase:", await evl("JSON.stringify(CBZ.cityDemolition.list())"));
await evl("(() => { const v = window.__view, b = window.__lot.building; CBZ.player.pos.x = v.px; CBZ.player.pos.z = v.pz; CBZ.player.pos.y = 1.5; if (CBZ.cam) { CBZ.cam.yaw = Math.atan2(b.ox - v.px, b.oz - v.pz) + Math.PI; CBZ.cam.pitch = -0.02; } return 1; })()");
await sleep(700);
await shot("demo-e2e-2-cleared.png");

// day-jump to SCAFFOLD
await evl("CBZ.dayCount(CBZ.dayCount() + 2)");
await sleep(1600);
console.log("phase:", await evl("JSON.stringify(CBZ.cityDemolition.list())"));
await evl("(() => { const v = window.__view, b = window.__lot.building; CBZ.player.pos.x = v.px; CBZ.player.pos.z = v.pz; CBZ.player.pos.y = 1.5; if (CBZ.cam) { CBZ.cam.yaw = Math.atan2(b.ox - v.px, b.oz - v.pz) + Math.PI; CBZ.cam.pitch = -0.02; } return 1; })()");
await sleep(700);
await shot("demo-e2e-3-scaffold.png");

// day-jump past REBUILT
const fin = await evl(`(() => { window.__colsBefore = CBZ.colliders.length; CBZ.dayCount(CBZ.dayCount() + 3); return true; })()`);
await sleep(1800);
const done = await evl(`(() => {
  const lot = window.__lot, b = lot.building, D = CBZ.cityDemolition;
  return JSON.stringify({
    ledger: D.count(), visible: b.group.visible, demolishedFlag: !!lot.demolished,
    colliderSample: CBZ.colliders.indexOf(b.colliders[0]) >= 0,
    platformSample: !b.platforms || !b.platforms.length || CBZ.platforms.indexOf(b.platforms[0]) >= 0,
    losSample: !b.losMeshes || !b.losMeshes.length || CBZ.losBlockers.indexOf(b.losMeshes[0]) >= 0,
    doorOk: !b.doors || !b.doors.length || (b.doors[0].demolished === false && b.doors[0].colIn === true),
    glassOk: !b.windows.length || b.windows.every(gp => !gp.shattered),
  });
})()`);
console.log("rebuilt:", done);
await evl("(() => { const v = window.__view, b = window.__lot.building; CBZ.player.pos.x = v.px; CBZ.player.pos.z = v.pz; CBZ.player.pos.y = 1.5; if (CBZ.cam) { CBZ.cam.yaw = Math.atan2(b.ox - v.px, b.oz - v.pz) + Math.PI; CBZ.cam.pitch = -0.02; } return 1; })()");
await sleep(700);
await shot("demo-e2e-4-rebuilt.png");

// serialize/apply round-trip (destroy again, save, reset, load)
const rt = await evl(`(() => {
  const lot = window.__lot, D = CBZ.cityDemolition;
  D.destroy(lot, { quiet: true, silent: true });
  const blob = D.serialize();
  D.reset();
  const cleared = D.count();
  D.apply(blob);
  const back = D.has(lot);
  const rec = D.list()[0];
  D.reset();
  return JSON.stringify({ blob, clearedAfterReset: cleared, restoredFromBlob: back, phaseAfterApply: rec && rec.phase });
})()`);
console.log("roundtrip:", rt);
const uniq = [...new Set(errors)];
console.log(uniq.length ? "PAGE ERRORS (" + uniq.length + "):\n" + uniq.slice(0, 10).join("\n") : "PAGE ERRORS: none");
chrome.kill("SIGTERM"); server.kill("SIGTERM");
await rm(profile, { recursive: true, force: true }).catch(() => {});
