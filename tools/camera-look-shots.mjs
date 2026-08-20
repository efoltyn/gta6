#!/usr/bin/env node
/* tools/camera-look-shots.mjs — the pictures behind tools/camera-look-check.mjs.
 *
 * Renders the SAME third-person shot at the pitches the old and new mouse
 * handler produce from an identical drag. `cam.pitch` is one scalar, so posing
 * it directly is exactly what the handler does — no input plumbing in the way.
 *
 * ONE BROWSER PER FRAME, and that is not paranoia. Under swiftshader the
 * drawing buffer survives exactly one read per session: shot one comes back as
 * a full 270 KB scene and every shot after it as a byte-identical 15288-byte
 * cleared canvas. Page.captureScreenshot, an explicit renderer.render() +
 * toDataURL, a two-rAF compositor barrier and a hook inside the game's own
 * render call all fail the same way at the same place. So each frame gets a
 * fresh boot: slow, and the only thing that actually produces pictures.
 *
 * Writes tools/shots/look/*.png + shots.json.
 * Usage: node tools/camera-look-shots.mjs            (all frames)
 *        node tools/camera-look-shots.mjs --shot=free-level   (one frame)
 */
import { spawn } from "node:child_process";
import { rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SELF = fileURLToPath(import.meta.url);
const OUTDIR = path.join(ROOT, "tools/shots/look");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The drag under test, in radians. 0.38 rad (~160 px at the shipped sens) is
// deliberately short of the envelope: a full-envelope look-up fills the frame
// with this game's near-white sky and a full look-down fills it with pavement,
// and two featureless frames prove nothing to a reader. At 0.38 the horizon
// stays in shot at both ends, so the pictures show the view MOVING against
// fixed landmarks instead of leaving the world entirely.
const D = 0.38;
// tier: which camera is being photographed. `pitch` is cam.pitch for the third
// person tiers and fps.fp for first person (the two conventions are opposite,
// which is the whole subject of this comparison).
const SHOTS = [
  { name: "free-level",      tier: "free",   pitch: null, note: "resting frame" },
  { name: "free-pitch-up",   tier: "free",   pitch: -D,   note: "drag UP" },
  { name: "free-pitch-down", tier: "free",   pitch: +D,   note: "drag DOWN" },
  { name: "pinned-level",    tier: "pinned", pitch: null, note: "resting frame" },
  { name: "pinned-aim-up",   tier: "pinned", pitch: -0.40, note: "drag UP (aim band top)" },
  { name: "pinned-aim-down", tier: "pinned", pitch: +0.36, note: "drag DOWN (aim band bottom)" },
  { name: "fps-level",       tier: "fps",    pitch: 0,    note: "resting frame" },
  { name: "fps-look-down",   tier: "fps",    pitch: -D,   note: "drag DOWN" },
  { name: "fps-look-up",     tier: "fps",    pitch: +D,   note: "drag UP" },
];

const arg = process.argv.find((a) => a.startsWith("--shot="));
await mkdir(OUTDIR, { recursive: true });

if (!arg) {
  // ---- driver: one child, one browser, one frame ---------------------------
  const meta = { drag: D, shots: [] };
  for (const s of SHOTS) {
    // RESUMABLE. A frame costs a whole browser boot on a software renderer
    // (~10 minutes here), so a run that dies on frame seven must not throw away
    // the six that landed. Delete a PNG to re-shoot just that one.
    if (existsSync(path.join(OUTDIR, s.name + ".png")) && existsSync(path.join(OUTDIR, s.name + ".json"))) {
      process.stdout.write(`=== ${s.name} === (already rendered, skipping)\n`);
      meta.shots.push(JSON.parse(await readFile(path.join(OUTDIR, s.name + ".json"), "utf8")));
      continue;
    }
    process.stdout.write(`\n=== ${s.name} ===\n`);
    const code = await new Promise((res) => {
      const c = spawn(process.execPath, [SELF, `--shot=${s.name}`], { stdio: "inherit" });
      c.on("exit", res);
    });
    if (code !== 0) { console.error(`FAIL: ${s.name} exited ${code}`); process.exit(1); }
    meta.shots.push(JSON.parse(await readFile(path.join(OUTDIR, s.name + ".json"), "utf8")));
  }
  await writeFile(path.join(OUTDIR, "shots.json"), JSON.stringify(meta, null, 2));
  console.log(`\nwrote ${meta.shots.length} frames to tools/shots/look/`);
  process.exit(0);
}

const SHOT = SHOTS.find((s) => s.name === arg.slice("--shot=".length));
if (!SHOT) { console.error("unknown shot: " + arg); process.exit(1); }

const port = 8900 + Math.floor(Math.random() * 60);
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const base = `http://127.0.0.1:${port}/`;
const dbg = 9900 + Math.floor(Math.random() * 60);
const profile = `/tmp/cbz-lookshot-${dbg}`;
await rm(profile, { recursive: true, force: true });
await sleep(700);
const chrome = spawn(process.env.CBZ_CHROME || "/opt/pw-browsers/chromium", [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader", "--enable-webgl", "--mute-audio", "--hide-scrollbars",
  "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows", "--window-size=1280,720",
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
await sleep(7000);                       // the arrival cinematic owns the lens

await evl(`(() => {
  const C = window.CBZ;
  C.cam.locked = true;
  window.__frames = 0;
  (function tick() { window.__frames++; requestAnimationFrame(tick); })();
  return true;
})()`);
async function waitFrames(n, maxMs = 30000) {
  const start = await evl("window.__frames");
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { await sleep(120); if ((await evl("window.__frames")) - start >= n) return true; }
  return false;
}

const REST = await evl("(window.CBZ.CITY_TP && window.CBZ.CITY_TP.PITCH) || 0.10");
const PIN = SHOT.tier === "pinned";
const FPS = SHOT.tier === "fps";
await evl(`(() => { window.CBZ.CONFIG.CAM_TP_FIXED_ANGLE = ${PIN}; return true; })()`);

// ---- stand somewhere the comparison is legible ---------------------------
// The city can spawn you on the 40th floor of a tower, where the boom is wedged
// against glass and every frame is the same pane. Find open street level, then
// prove it with the CAMERA rather than the map: camAudit().frameTilt is the
// pivot's angle below the view axis, a few hundredths at rest, and anything
// near a radian means the lens has collapsed onto the character.
const candidates = await evl(`(() => {
  const C = window.CBZ, near = [], out = [];
  const gh = C.cityGroundHeightAt;
  if (!gh || !C.queryCollidersNear) return out;
  const blocked = (x, y, z) => {
    C.queryCollidersNear(x, z, 4, near);
    for (let i = 0; i < near.length; i++) { const c = near[i];
      if (!c || c.y1 == null) continue;
      if (x > c.minX - 2.5 && x < c.maxX + 2.5 && z > c.minZ - 2.5 && z < c.maxZ + 2.5 &&
          y + 2.0 > c.y0 && y < c.y1) return true; }
    return false;
  };
  // A COMPARISON NEEDS LANDMARKS. An empty field is street level and clear and
  // completely useless: pitch up and the frame is sky, pitch down and it is
  // grass, and neither picture tells the reader the view moved. Prefer a spot
  // that has something TALL close enough to fill the upper half of the frame
  // while still leaving the player a clear cell to stand in.
  const tallNear = (x, z) => {
    C.queryCollidersNear(x, z, 26, near);
    let best = 0;
    for (let i = 0; i < near.length; i++) { const c = near[i];
      if (c && c.y1 != null && c.y1 > best) best = c.y1; }
    return best;
  };
  for (let r = 24; r <= 340 && out.length < 20; r += 8) {
    for (let a = 0; a < 24 && out.length < 20; a++) {
      const t = a / 24 * Math.PI * 2;
      const x = Math.cos(t) * r, z = Math.sin(t) * r;
      const g = gh(x, z);
      if (!(g > -1 && g < 4)) continue;
      if (blocked(x, g, z)) continue;
      out.push({ x: +x.toFixed(2), y: +g.toFixed(2), z: +z.toFixed(2), tall: +tallNear(x, z).toFixed(1) });
    }
  }
  out.sort((a, b) => b.tall - a.tall);          // the most built-up clear spot first
  return out;
})()`);
let spot = null;
for (const c of candidates) {
  await evl(`(() => { const C = window.CBZ, s = ${JSON.stringify(c)};
    C.player.pos.x = s.x; C.player.pos.y = s.y + 0.05; C.player.pos.z = s.z;
    C.player.vy = 0; C.player.dead = false; C.player.driving = null;
    if (!!(C.fps && C.fps.active)) C.setFPS(false);
    C.cam.locked = true; C.cam.yaw = 0; C.cam.pitch = ${REST};
    if (C.game.state !== "playing") C.setState("playing"); return true; })()`);
  await waitFrames(18);
  const a = await evl("window.CBZ.camAudit()");
  if (Math.abs(a.frameTilt) < 0.35 && a.arm > 2.0) { spot = c; break; }
}
if (!spot) { console.error("FAIL: no street spot where the camera settles"); done(1); }
console.log("  spot " + JSON.stringify(spot) + "  (tallest neighbour " + spot.tall + "m)");

// ---- hold the pose, then take the one frame this session gets -------------
// THE ARRIVAL CINEMATIC ENDS IN FIRST PERSON (CBZ.armFPSAfterIntro has
// onIntroComplete flip setActive(true)), and it lands after the spot search —
// so an unguarded "third person" shot is quietly a first-person one. Every
// frame of the settle re-asserts the tier, the player and the look, so the only
// thing that differs between two shots is the number under test.
const pitchSet = SHOT.pitch == null
  ? `C.cam.pitch = ${REST};`
  : (FPS ? `C.fps.fp = ${SHOT.pitch};` : `C.cam.pitch = ${REST + SHOT.pitch};`);
for (let i = 0; i < 7; i++) {
  await evl(`(() => { const C = window.CBZ;
    if (C.game.state !== "playing") C.setState("playing");
    if (!!(C.fps && C.fps.active) !== ${FPS}) C.setFPS(${FPS});
    C.CONFIG.CAM_TP_FIXED_ANGLE = ${PIN};
    C.player.pos.x = ${spot.x}; C.player.pos.y = ${spot.y + 0.05}; C.player.pos.z = ${spot.z};
    C.player.vy = 0; C.player.dead = false; C.player.driving = null;
    C.cam.locked = true; C.cam.yaw = 0;
    ${pitchSet}
    return true; })()`);
  await waitFrames(2);
}
await waitFrames(6);

const audit = await evl("window.CBZ.camAudit()");
if (!FPS && Math.abs(audit.frameTilt) > 0.45) {
  console.error(`FAIL: ${SHOT.name} — the rig never settled (frameTilt ${(+audit.frameTilt).toFixed(3)})`);
  done(1);
}
// ---- THE SHUTTER --------------------------------------------------------
// Read the pixels out of an OFFSCREEN TARGET, not off the canvas. The WebGL
// canvas here does not preserve its drawing buffer, so toDataURL() returns
// whatever the compositor left behind — which in practice was a byte-identical
// 15288-byte cleared frame for most poses, while one lucky pose returned a real
// 272 KB scene. Page.captureScreenshot has the same problem from the other
// side. Rendering into a WebGLRenderTarget and calling readRenderTargetPixels
// removes the compositor from the question entirely: the pixels come back
// because they were asked for, and a 2D canvas (which DOES preserve) turns them
// into the PNG. `triangles` is reported so an empty frame can be told apart
// from an empty SCENE.
const grabbed = await evl(`(() => {
  const C = window.CBZ, T = window.THREE;
  const w = C.renderer.domElement.width, h = C.renderer.domElement.height;
  const rt = new T.WebGLRenderTarget(w, h);
  const prev = C.renderer.getRenderTarget();
  C.renderer.setRenderTarget(rt);
  C.renderer.render(C.scene, C.camera);
  const px = new Uint8Array(w * h * 4);
  C.renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);
  C.renderer.setRenderTarget(prev);
  const tris = C.renderer.info.render.triangles;
  rt.dispose();
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d"), img = ctx.createImageData(w, h);
  // WebGL's origin is bottom-left; a 2D canvas is top-left. Flip row by row.
  for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
  ctx.putImageData(img, 0, 0);
  return { url: cv.toDataURL("image/png"), w: w, h: h, tris: tris };
})()`);
const dataUrl = grabbed && grabbed.url;
if (grabbed) console.log(`  render ${grabbed.w}x${grabbed.h}, ${grabbed.tris} triangles`);
if (!dataUrl || dataUrl.indexOf("base64,") < 0) { console.error("FAIL: no frame for " + SHOT.name); done(1); }
const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf("base64,") + 7), "base64");
// 15288 bytes is this renderer's signature for a CLEARED 1280x720 canvas — the
// exact size every second-and-later read in a session came back as. Refuse it
// by name; a real frame, even one that is all sky, is nowhere near it.
if (!grabbed.tris) { console.error(`FAIL: ${SHOT.name} — the scene drew nothing`); done(1); }
if (buf.length < 2500) { console.error(`FAIL: ${SHOT.name} — degenerate frame (${buf.length} bytes)`); done(1); }
await writeFile(path.join(OUTDIR, SHOT.name + ".png"), buf);
const rec = { name: SHOT.name, tier: SHOT.tier, note: SHOT.note, bytes: buf.length,
              camPitch: +(+audit.pitch).toFixed(3), viewPitch: +(+audit.viewPitch).toFixed(3),
              frameTilt: +(+audit.frameTilt).toFixed(3), fpsFp: await evl("(window.CBZ.fps && window.CBZ.fps.fp) || 0") };
await writeFile(path.join(OUTDIR, SHOT.name + ".json"), JSON.stringify(rec));
console.log(`  ${SHOT.name.padEnd(18)} cam.pitch ${rec.camPitch.toFixed(3).padStart(7)}  viewPitch ${rec.viewPitch.toFixed(3).padStart(7)}  ${buf.length} bytes`);
done(0);
