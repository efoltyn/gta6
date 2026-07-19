#!/usr/bin/env node
/* tools/label-check.mjs — verify the overhead "Lv.N Title" label replaces the
   big street-read panel. Boots the game, then makes the REAL aim_dossier loop
   lock a chosen ped by stubbing ONLY the pre-existing target selector
   (CBZ.aimedActor) — the loop, my showOverhead(), the sprite and the panel-vs-
   label branch all run for real. Frames the ped with an independent render
   camera and screenshots. Usage: node tools/label-check.mjs [out.png] */
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

// pick a ped, force it real+visible, and stub ONLY the pre-existing target
// selector so the real dossier loop locks it (isAimingWeapon() is already true
// from the default city loadout / shoulder stance).
const setup = await evl(`(() => {
  const C = window.CBZ, g = C.game;
  g.cityHolstered = false; g.cityMeleeWeapon = null;
  const peds = (C.cityPeds || []).filter(p => p && !p.dead && !p.vendor && (p.group || (p.char && p.char.group)));
  peds.sort((a,b) => (C.cityTitle(b) !== "Civilian") - (C.cityTitle(a) !== "Civilian") || C.cityLevel(b) - C.cityLevel(a));
  const p = peds[0]; if (!p) return { none:true, peds:(C.cityPeds||[]).length };
  p.dead = false; p.ko = 0; p.escaped = false; p.speed = 0; p.important = true;
  const grp = p.group || (p.char && p.char.group); grp.visible = true;
  window.__lc = { p, grp };
  const orig = C.aimedActor;
  C.aimedActor = function () { return { actor: window.__lc.p, crowd: null, dist: 3.5, head: false, point: null }; };
  C.__aimedActorOrig = orig;
  return { none:false, armed: C.playerArmed && C.playerArmed(), aiming: C.isAimingWeapon && C.isAimingWeapon(),
           level: C.cityLevel(p), title: C.cityTitle(p), name: p.name || null,
           pos: [ +grp.position.x.toFixed(1), +grp.position.y.toFixed(1), +grp.position.z.toFixed(1) ], headY: +C.charHeadY(p.char || p).toFixed(2) };
})()`);
console.log("setup:", JSON.stringify(setup));

// let the real loop run and build the label sprite
await sleep(1200);

const diag = await evl(`(() => {
  const C = window.CBZ;
  const t = C.cityAimDossierTarget, grp = window.__lc && window.__lc.grp;
  const panel = document.getElementById("cityAimDossier");
  const panelShown = !!(panel && panel.style.display !== "none" && panel.offsetParent !== null);
  let sprite = null;
  if (grp) for (const c of grp.children) { if (c && c.type === "Sprite" && c.material && c.material.map) { sprite = c; break; } }
  return JSON.stringify({
    hasTarget: !!t, targetIsChosen: t === (window.__lc && window.__lc.p),
    labelString: t ? ("Lv." + C.cityLevel(t) + " " + C.cityTitle(t)) : null,
    spriteFound: !!sprite, spriteVisible: !!(sprite && sprite.visible),
    spriteY: sprite ? +sprite.position.y.toFixed(2) : null,
    spriteScale: sprite ? [ +sprite.scale.x.toFixed(2), +sprite.scale.y.toFixed(2) ] : null,
    panelShown,
  });
})()`);
console.log("diag:", diag);

// frame the ped with an independent render camera (does not touch game aim)
await evl(`(() => {
  const C = window.CBZ, T = window.THREE, grp = window.__lc.grp;
  if (!C.renderer.__lc) {
    const o = C.renderer.render.bind(C.renderer);
    C.renderer.render = function (s, cam) {
      const t = window.__lcCam;
      if (t && cam && cam.position) { cam.position.set(t.px, t.py, t.pz); cam.lookAt(t.lx, t.ly, t.lz); if (cam.fov){cam.fov=42;cam.updateProjectionMatrix();} cam.updateMatrixWorld(); }
      return o(s, cam);
    };
    C.renderer.__lc = true;
  }
  const gp = grp.position, hy = C.charHeadY(window.__lc.p.char || window.__lc.p);
  window.__lcCam = { px: gp.x + 0.6, py: gp.y + hy + 0.1, pz: gp.z + 3.6, lx: gp.x, ly: gp.y + hy - 0.1, lz: gp.z };
  return true;
})()`);
await sleep(600);

const shot = await send("Page.captureScreenshot", { format: "png" });
await writeFile(OUT, Buffer.from(shot.result.data, "base64"));
console.log("shot:", OUT);
const uniq = [...new Set(errors)];
console.log(uniq.length ? "ERRORS (" + uniq.length + "):\n" + uniq.slice(0, 25).join("\n") : "ERRORS: none");
chrome.kill("SIGTERM"); server.kill("SIGTERM");
await rm(profile, { recursive: true, force: true }).catch(() => {});
process.exit(0);
