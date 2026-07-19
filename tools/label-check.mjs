#!/usr/bin/env node
/* tools/label-check.mjs — verify the overhead "Lv.N Title" label replaces the
   big street-read panel. Boots the game, enters first-person with a gun up,
   drops a live ped into the crosshair, and asserts the REAL aim_dossier loop
   surfaces an overhead label sprite (not the side panel). Screenshots the view.
   Usage: node tools/label-check.mjs [out.png] */
import { spawn } from "node:child_process";
import { rm, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = process.argv[2] || path.join(ROOT, "tools/shots/label-check.png");
await mkdir(path.join(ROOT, "tools/shots"), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const port = 8950 + Math.floor(Math.random() * 40);
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const base = `http://127.0.0.1:${port}/`;
const dbg = 9950 + Math.floor(Math.random() * 40);
const profile = `/tmp/cbz-label-${dbg}`;
await rm(profile, { recursive: true, force: true });
await sleep(700);
const chrome = spawn(process.env.CBZ_CHROME || "/opt/pw-browsers/chromium", [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--enable-webgl", "--mute-audio", "--window-size=1440,900",
  `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, base,
], { stdio: "ignore" });

let pageInfo = null;
for (let i = 0; i < 80 && !pageInfo; i++) {
  try { const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json(); pageInfo = ps.find((p) => p.type === "page" && p.url.startsWith(base)); } catch (_) {}
  if (!pageInfo) await sleep(250);
}
if (!pageInfo) { console.error("FAIL: no page"); process.exit(1); }
const ws = new WebSocket(pageInfo.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
let id = 1; const pending = new Map(); const errors = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; errors.push(`${d.url || "?"}:${d.lineNumber} ${(d.exception && d.exception.description || d.text || "").split("\n")[0]}`); }
  else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") { errors.push("console.error: " + m.params.args.map((a) => a.value || a.description || "").join(" ").slice(0, 200)); }
});
const send = (method, params = {}) => new Promise((r) => { const i = id++; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expression) => { const r = await send("Runtime.evaluate", { expression, returnByValue: true }); return r.result && r.result.result && r.result.result.value; };
await send("Runtime.enable");
await send("Page.enable");

for (let i = 0; i < 60; i++) { if (await evl("!!(window.CBZ && CBZ.game && document.getElementById('playBtn'))")) break; await sleep(500); }
let playing = false;
for (let i = 0; i < 120 && !playing; i++) {
  await evl("(() => { const b = document.getElementById('playBtn'); if (b) { b.click(); b.dispatchEvent(new MouseEvent('mousedown', {bubbles:true})); b.dispatchEvent(new MouseEvent('mouseup', {bubbles:true})); } return true; })()");
  await sleep(600);
  playing = await evl("!!(window.CBZ && CBZ.game && CBZ.game.state === 'playing')");
}
console.log("playing:", playing);
await sleep(2500);

// ---- set up the REAL aim path: FPS + gun up + a ped in the crosshair -------
// Teleport the player right behind a street-cluster ped (open ground, no glass
// wall between) and aim with a slight downward pitch. Try several candidates.
const setup = await evl(`(() => {
  const C = window.CBZ, g = C.game;
  g.cityHolstered = false; g.cityMeleeWeapon = null;      // ensure armed reads true
  if (!C.fpsActive || !C.fpsActive()) { try { C.toggleFPS(); } catch(e){} }
  const peds = (C.cityPeds || []).filter(p => p && !p.dead && !p.vendor && p.char && p.char.group);
  // rank by neighbour density (a street cluster is outdoors) then by a non-Civilian read
  const near = (p) => peds.reduce((n,q)=> n + (q!==p && Math.hypot(q.pos.x-p.pos.x, q.pos.z-p.pos.z) < 12 ? 1 : 0), 0);
  peds.sort((a,b) => (near(b) - near(a)) || ((C.cityTitle(b)!=="Civilian") - (C.cityTitle(a)!=="Civilian")));
  window.__cands = peds.slice(0, 6);
  return { none: !peds.length, peds: (C.cityPeds||[]).length, top: peds.slice(0,3).map(p=>({t:C.cityTitle(p),l:C.cityLevel(p),near:near(p)})) };
})()`);
console.log("setup:", JSON.stringify(setup));

// try each candidate: stand ~3.5m south of it, force it visible, and aim the
// camera by COMPUTED yaw/pitch straight at its group torso (eye-height agnostic).
// findActorHit skips group.visible===false and centres spheres on group.position.
const PIN = (ci) => `(() => {
  const C = window.CBZ, T = window.THREE; const p = (window.__cands||[])[${ci}]; if (!p) return false;
  const grp = p.group || (p.char && p.char.group); if (!grp) return false;
  p.dead = false; p.ko = 0; p.escaped = false; p.speed = 0; p.important = true;
  grp.visible = true;
  const gp = grp.position;
  C.player.pos.x = gp.x; C.player.pos.z = gp.z + 3.5; C.player.pos.y = gp.y;
  const cam = C.camera; const cp = cam ? cam.getWorldPosition(new T.Vector3()) : null;
  if (cp) {
    const dx = gp.x - cp.x, dy = (gp.y + 1.1) - cp.y, dz = gp.z - cp.z;
    const dist = Math.hypot(dx, dy, dz) || 1;
    if (C.cam) C.cam.yaw = Math.atan2(-dx, -dz);
    if (C.fps) C.fps.fp = Math.asin(Math.max(-1, Math.min(1, dy / dist)));
  }
  return !!C.cityAimDossierTarget;
})()`;
let locked = null, lockedCi = -1;
for (let ci = 0; ci < 6 && !locked; ci++) {
  const r = await evl(`(() => { const C=window.CBZ; const p=(window.__cands||[])[${ci}]; return p?{title:C.cityTitle(p),level:C.cityLevel(p),name:p.name||null}:null; })()`);
  if (!r) break;
  for (let k = 0; k < 6; k++) {
    await evl(PIN(ci));
    await sleep(240);
    if (await evl(`!!window.CBZ.cityAimDossierTarget`)) { locked = r; lockedCi = ci; break; }
  }
  console.log("candidate", ci, JSON.stringify(r), "locked:", !!locked);
}
// hold the winning aim steady for the screenshot
if (lockedCi >= 0) { for (let k = 0; k < 3; k++) { await evl(PIN(lockedCi)); await sleep(220); } }

if (!locked) {
  const dbg = await evl(`(() => {
    const C = window.CBZ, T = window.THREE; const p = (window.__cands||[])[0]; if (!p) return "no cand";
    const cam = C.camera; const cp = cam ? cam.getWorldPosition(new T.Vector3()) : null; const cd = cam ? cam.getWorldDirection(new T.Vector3()) : null;
    let hit = null; try { hit = C.aimedActor(360); } catch (e) { hit = "ERR " + e.message; }
    const ap = C.aimedPed ? C.aimedPed(C.player.pos.x, C.player.pos.z) : "no fn";
    const grp = p.char && p.char.group;
    return JSON.stringify({
      player: [+C.player.pos.x.toFixed(2), +C.player.pos.y.toFixed(2), +C.player.pos.z.toFixed(2)],
      pedPos: [+p.pos.x.toFixed(2), +p.pos.y.toFixed(2), +p.pos.z.toFixed(2)],
      pedGroupPos: grp ? [+grp.position.x.toFixed(2), +grp.position.y.toFixed(2), +grp.position.z.toFixed(2)] : null,
      pedGroupParent: grp && grp.parent ? (grp.parent.name || grp.parent.type) : null,
      pedVisible: grp ? grp.visible : null,
      dist: +Math.hypot(p.pos.x - C.player.pos.x, p.pos.z - C.player.pos.z).toFixed(2),
      camPos: cp ? [+cp.x.toFixed(2), +cp.y.toFixed(2), +cp.z.toFixed(2)] : null,
      camDir: cd ? [+cd.x.toFixed(2), +cd.y.toFixed(2), +cd.z.toFixed(2)] : null,
      camYaw: C.cam ? +C.cam.yaw.toFixed(3) : null, fpFp: C.fps ? +C.fps.fp.toFixed(3) : null,
      aimedActor: hit && hit.actor ? { name: hit.actor.name, dist: +(hit.dist || 0).toFixed(2) } : hit,
      aimedPedName: ap && ap.name ? ap.name : ap,
    });
  })()`);
  console.log("DBG:", dbg);
}

const diag = await evl(`(() => {
  const C = window.CBZ;
  const t = C.cityAimDossierTarget;
  const panel = document.getElementById("cityAimDossier");
  const panelShown = !!(panel && panel.style.display !== "none" && panel.offsetParent !== null);
  let sprite = null, grp = t && (t.group || (t.char && t.char.group));
  if (grp) { for (const c of grp.children) { if (c && c.type === "Sprite" && c.material && c.material.map) { sprite = c; break; } } }
  return JSON.stringify({
    hasTarget: !!t,
    targetLevel: t ? C.cityLevel(t) : null,
    targetTitle: t ? C.cityTitle(t) : null,
    labelString: t ? ("Lv." + C.cityLevel(t) + " " + C.cityTitle(t)) : null,
    spriteFound: !!sprite,
    spriteVisible: !!(sprite && sprite.visible),
    spriteScale: sprite ? [ +sprite.scale.x.toFixed(2), +sprite.scale.y.toFixed(2) ] : null,
    panelShown,
  });
})()`);
console.log("diag:", diag);

const shot = await send("Page.captureScreenshot", { format: "png" });
await writeFile(OUT, Buffer.from(shot.result.data, "base64"));
console.log("shot:", OUT);
const uniq = [...new Set(errors)];
console.log(uniq.length ? "ERRORS (" + uniq.length + "):\n" + uniq.slice(0, 25).join("\n") : "ERRORS: none");
chrome.kill("SIGTERM"); server.kill("SIGTERM");
await rm(profile, { recursive: true, force: true }).catch(() => {});
process.exit(0);
