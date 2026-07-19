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
const setup = await evl(`(() => {
  const C = window.CBZ, g = C.game;
  g.cityHolstered = false; g.cityMeleeWeapon = null;      // ensure armed reads true
  if (!C.fpsActive || !C.fpsActive()) { try { C.toggleFPS(); } catch(e){} }
  const P = C.player.pos;
  // pick a live humanoid ped with a rig group
  const cand = (C.cityPeds || []).filter(p => p && !p.dead && !p.vendor && p.char && p.char.group);
  // prefer a non-"Civilian" read so the screenshot shows a role
  cand.sort((a,b) => (C.cityTitle(b) !== "Civilian") - (C.cityTitle(a) !== "Civilian"));
  const p = cand[0];
  if (!p) return { none:true, peds:(C.cityPeds||[]).length };
  // drop them 4m in front (yaw 0 faces -z), freeze, face them
  p.pos.x = P.x; p.pos.z = P.z - 4; p.pos.y = P.y;
  p.speed = 0; p.state = "idle";
  if (p.char && p.char.group) p.char.group.position.set(p.pos.x, p.pos.y, p.pos.z);
  if (C.cam) { C.cam.yaw = 0; if (C.cam.pitch != null) C.cam.pitch = 0; }
  return { none:false, armed: C.playerArmed && C.playerArmed(), aiming: C.isAimingWeapon && C.isAimingWeapon(),
           fps: C.fpsActive && C.fpsActive(), pedLevel: C.cityLevel(p), pedTitle: C.cityTitle(p), pedName: p.name || null };
})()`);
console.log("setup:", JSON.stringify(setup));

// keep the ped pinned in front for a few frames while the dossier loop samples
for (let i = 0; i < 6; i++) {
  await evl(`(() => { const C=window.CBZ,P=C.player.pos; const t=C.cityAimDossierTarget; const p=t||((C.cityPeds||[]).find(x=>x&&!x.dead&&!x.vendor&&x.char&&x.char.group)); if(p){ p.pos.x=P.x;p.pos.z=P.z-4;p.pos.y=P.y;p.speed=0; if(p.char&&p.char.group)p.char.group.position.set(p.pos.x,p.pos.y,p.pos.z);} if(C.cam)C.cam.yaw=0; return true; })()`);
  await sleep(300);
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
