#!/usr/bin/env node
/* ============================================================
   tools/studio.mjs — THE VISUAL FEEDBACK LOOP.

   Boots the real game headless (SwiftShader WebGL), hijacks the
   renderer into an isolated photo-studio scene, spawns any asset
   by name, and writes multi-angle ORBIT contact sheets and
   animation FILMSTRIP sheets as single PNGs. Zero npm deps —
   raw Chrome DevTools Protocol over the pre-installed Chromium.

   Usage:
     node tools/studio.mjs <subject> [options]

   Subjects:
     rig                    default civilian character
     rig:cop|suit|tank      preset palettes
     car:<Name>             one ambient car (CBZ.cityEcon.CARS name)
     cars                   grid of every ambient car
     pcar:<style>           one player-car style
     pcars                  grid of every player-car style
     expr:<js>              any JS expression returning an Object3D
                            (or {group, rig} for an animatable rig)

   Options:
     --mode orbit|strip|both   (default: orbit for props, both for rigs)
     --anim idle|walk|run|sprint|punch|heavy|hook|upper|aim|surrender
     --speed <u/s>             locomotion speed for strip (default per anim)
     --frames <n>              filmstrip frames (default 10)
     --dur <s>                 filmstrip duration (default: anim-appropriate)
     --angles <n>              orbit angles (default 8)
     --out <path>              output png (default tools/shots/<subject>-<mode>.png)
     --url <http://...>        reuse a running dev server
     --day | --night           studio lighting flavor (default day)
     --zoom <f>                camera distance multiplier (default 1)
     --video (alias --gif)     also encode a .webm clip of the strip (the
                               bundled ffmpeg only speaks mjpeg-in/vp8-out)

   Examples:
     node tools/studio.mjs rig --anim run
     node tools/studio.mjs car:Sedan
     node tools/studio.mjs cars
     node tools/studio.mjs rig --anim punch --frames 12 --dur 0.5
============================================================ */

import { spawn } from "node:child_process";
import { rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CHROME = "/opt/pw-browsers/chromium";

// ---------- CLI ----------
const argv = process.argv.slice(2);
if (!argv.length || argv[0] === "--help") {
  console.log("usage: node tools/studio.mjs <subject> [--mode orbit|strip|both] [--anim walk] [--frames 10] [--angles 8] [--out file.png]");
  process.exit(argv.length ? 0 : 1);
}
const subject = argv[0];
const opt = {};
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith("--")) continue;
  const k = a.slice(2);
  const flag = ["day", "night", "gif", "video"].includes(k);
  opt[k] = flag ? true : argv[++i];
}
const isRig = subject.startsWith("rig") || subject.startsWith("expr:");
const mode = opt.mode || (isRig ? "both" : "orbit");
const anim = opt.anim || "walk";
const frames = +(opt.frames || 10);
const angles = +(opt.angles || 8);
const zoom = +(opt.zoom || 1);
const night = !!opt.night;
const wantVideo = !!(opt.video || opt.gif);
const slug = subject.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 40);
const outBase = opt.out
  ? opt.out.replace(/\.png$/i, "")
  : path.join(ROOT, "tools/shots", `${slug}${mode !== "orbit" && isRig ? "-" + anim : ""}`);

// ---------- static server (auto-start unless --url) ----------
let serverProc = null;
let baseUrl = opt.url;
async function ensureServer() {
  if (baseUrl) return;
  const port = 8600 + Math.floor(Math.random() * 300);
  serverProc = spawn("python3", [path.join(ROOT, "tools/devserver.py")], {
    env: { ...process.env, PORT: String(port) },
    stdio: "ignore",
  });
  baseUrl = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(baseUrl + "index.html", { method: "HEAD" });
      if (r.ok) return;
    } catch (_) {}
    await sleep(150);
  }
  throw new Error("dev server did not come up");
}

// ---------- CDP plumbing ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, nextId = 1;
const pending = new Map();

function send(method, params = {}, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, timeout);
  });
}

async function evaluate(expression, timeout = 60000) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, timeout);
  if (result.exceptionDetails) {
    const d = result.exceptionDetails;
    throw new Error("page: " + (d.exception && d.exception.description || d.text));
  }
  return result.result && result.result.value;
}

async function launchChrome() {
  const port = 9500 + Math.floor(Math.random() * 400);
  const profile = `/tmp/cbz-studio-${port}`;
  await rm(profile, { recursive: true, force: true });
  const chrome = spawn(CHROME, [
    "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
    "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
    "--enable-webgl", "--ignore-gpu-blocklist",
    "--disable-background-networking", "--disable-component-update",
    "--disable-extensions", "--hide-scrollbars", "--mute-audio",
    "--no-first-run", "--no-default-browser-check",
    "--window-size=1500,1050",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    baseUrl,
  ], { stdio: "ignore" });
  const deadline = Date.now() + 30000;
  let page = null;
  while (Date.now() < deadline && !page) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const pages = await res.json();
      page = pages.find((p) => p.type === "page" && p.url.startsWith(baseUrl));
    } catch (_) {}
    if (!page) await sleep(200);
  }
  if (!page) { chrome.kill("SIGKILL"); throw new Error("chrome page did not appear"); }
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (!msg.id || !pending.has(msg.id)) return;
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
  });
  await send("Runtime.enable");
  return { chrome, profile };
}

// ---------- the in-page studio harness ----------
// Injected once; exposes window.__studio with scene/lights/capture helpers.
const HARNESS = String.raw`(() => {
  if (window.__studio) return "ready";
  if (!window.CBZ || !window.THREE || !CBZ.renderer || !CBZ.makeCharacter) return null;
  const S = {};
  const W = 1440, H = 1000;
  // freeze the game loop's interest: it renders CBZ.scene/CBZ.camera; we own both.
  try { if (CBZ.game) CBZ.game.state = "studio"; } catch (e) {}

  const scene = new THREE.Scene();
  const NIGHT = __NIGHT__;
  scene.background = new THREE.Color(NIGHT ? 0x0b1018 : 0xbfd4e6);
  scene.fog = new THREE.Fog(scene.background.getHex(), 60, 160);
  const hemi = new THREE.HemisphereLight(NIGHT ? 0x30405c : 0xe8f2ff, NIGHT ? 0x11151c : 0x6b7480, NIGHT ? 0.55 : 0.95);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(NIGHT ? 0xaac4ff : 0xfff2df, NIGHT ? 0.65 : 1.15);
  key.position.set(14, 22, 10);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -14; key.shadow.camera.right = 14;
  key.shadow.camera.top = 14; key.shadow.camera.bottom = -14;
  key.shadow.camera.far = 80;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xdde8ff, NIGHT ? 0.35 : 0.5);
  rim.position.set(-16, 12, -18);
  scene.add(rim);
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(60, 48),
    new THREE.MeshLambertMaterial({ color: NIGHT ? 0x1a2028 : 0x8b929c })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  // subtle radial ring so scale reads
  const ring = new THREE.Mesh(new THREE.RingGeometry(3.96, 4.04, 64), new THREE.MeshBasicMaterial({ color: NIGHT ? 0x2c3644 : 0x757c86 }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.01;
  scene.add(ring);

  const cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 400);
  CBZ.scene = scene; CBZ.camera = cam;   // even if the RAF renders, it renders US
  const renderer = CBZ.renderer;
  renderer.shadowMap.enabled = true;
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  document.body.style.margin = "0";
  // keep the game's DOM but make sure the canvas is on top and visible
  const cv = renderer.domElement;
  cv.style.position = "fixed"; cv.style.left = "0"; cv.style.top = "0"; cv.style.zIndex = "99999";
  document.body.appendChild(cv);

  S.scene = scene; S.cam = cam; S.renderer = renderer; S.W = W; S.H = H;
  S.subject = null; S.rig = null;

  S.clearSubject = () => {
    if (S.subject) { scene.remove(S.subject); S.subject = null; S.rig = null; }
  };
  S.setSubject = (obj, rig) => {
    S.clearSubject();
    S.subject = obj; S.rig = rig || null;
    obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
    scene.add(obj);
  };
  S.fit = () => {
    const box = new THREE.Box3().setFromObject(S.subject);
    const c = box.getCenter(new THREE.Vector3());
    const s = box.getSize(new THREE.Vector3());
    const r = s.length() * 0.5 || 1;   // bounding-sphere radius (fits ALL of it)
    return { cx: c.x, cy: c.y, cz: c.z, r };
  };
  S.shoot = (az, elevDeg, distMul, look) => {
    const f = S.fit();
    // distance that guarantees the bounding sphere fits the vertical fov,
    // with margin; horizontal fov is wider (aspect 1.44) so vertical governs.
    const d = (f.r / Math.sin((cam.fov / 2) * Math.PI / 180)) * 1.12 * (distMul || 1);
    const el = (elevDeg || 12) * Math.PI / 180;
    cam.position.set(
      f.cx + Math.sin(az) * Math.cos(el) * d,
      Math.max(0.6, f.cy + Math.sin(el) * d),
      f.cz + Math.cos(az) * Math.cos(el) * d
    );
    cam.lookAt(look ? new THREE.Vector3(look[0], look[1], look[2]) : new THREE.Vector3(f.cx, f.cy, f.cz));
    cam.updateMatrixWorld();
    renderer.render(scene, cam);
  };
  // ---- contact-sheet composer (2D canvas) ----
  S.sheet = null;
  S.beginSheet = (cols, rows, cellW, cellH) => {
    const c = document.createElement("canvas");
    c.width = cols * cellW; c.height = rows * cellH + 30;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#0d1117"; ctx.fillRect(0, 0, c.width, c.height);
    S.sheet = { c, ctx, cols, rows, cellW, cellH, i: 0 };
  };
  S.stamp = (label) => {
    const sh = S.sheet;
    const col = sh.i % sh.cols, row = (sh.i / sh.cols) | 0;
    const x = col * sh.cellW, y = row * sh.cellH;
    // cover-crop: cut a source rect matching the cell's aspect (centered)
    // instead of squashing the whole canvas into the cell.
    const cellA = sh.cellW / sh.cellH, srcA = S.W / S.H;
    let sw = S.W, shh = S.H, sx0 = 0, sy0 = 0;
    if (srcA > cellA) { sw = S.H * cellA; sx0 = (S.W - sw) / 2; }
    else { shh = S.W / cellA; sy0 = (S.H - shh) / 2; }
    sh.ctx.drawImage(S.renderer.domElement, sx0, sy0, sw, shh, x, y, sh.cellW, sh.cellH);
    sh.ctx.strokeStyle = "#0d1117"; sh.ctx.lineWidth = 2;
    sh.ctx.strokeRect(x, y, sh.cellW, sh.cellH);
    if (label) {
      sh.ctx.fillStyle = "rgba(6,9,13,0.72)";
      sh.ctx.fillRect(x + 4, y + sh.cellH - 24, 8 + label.length * 8, 20);
      sh.ctx.fillStyle = "#e8eef6"; sh.ctx.font = "600 13px monospace";
      sh.ctx.fillText(label, x + 8, y + sh.cellH - 9);
    }
    sh.i++;
  };
  S.endSheet = (title) => {
    const sh = S.sheet;
    sh.ctx.fillStyle = "#9fb2c8"; sh.ctx.font = "600 15px monospace";
    sh.ctx.fillText(title || "", 8, sh.rows * sh.cellH + 21);
    return sh.c.toDataURL("image/png");
  };
  // ---- rig animation stepping ----
  S.step = (dt, speed) => { if (S.rig) CBZ.animChar(S.rig, speed || 0, dt); };
  S.warm = (seconds, speed) => {
    const n = Math.ceil(seconds / (1 / 60));
    for (let i = 0; i < n; i++) S.step(1 / 60, speed);
  };
  S.frameGrab = () => S.renderer.domElement.toDataURL("image/jpeg", 0.92);
  window.__studio = S;
  return "ready";
})()`;

// ---------- subject builders (run in page) ----------
function subjectExpr(spec) {
  if (spec === "rig" || spec.startsWith("rig:")) {
    const preset = spec.split(":")[1] || "civ";
    return String.raw`(() => {
      const presets = {
        civ:  { torso: 0x3a6ea5, collar: 0x33608f, arms: 0x3a6ea5, legs: 0x2b2f36, shoes: 0x23272e, skin: 0xd9a066, hair: 0x4a3526 },
        cop:  { torso: 0x2a3f5e, collar: 0x223451, arms: 0x2a3f5e, legs: 0x1d2733, shoes: 0x11151b, skin: 0xd9a066, cap: 0x22314a, badge: true, belt: 0x14181f },
        suit: { torso: 0x23262e, collar: 0xe8e8ea, arms: 0x23262e, legs: 0x1e2129, shoes: 0x101216, skin: 0xc98d5e, hair: 0x2c2018 },
        tank: { torso: 0xb9c0c9, collar: 0xb9c0c9, arms: 0xd9a066, legs: 0x39424d, shoes: 0x23272e, skin: 0xd9a066, hair: 0x1e1610 },
      };
      const rig = CBZ.makeCharacter(presets[${JSON.stringify(preset)}] || presets.civ);
      return { group: rig.group, rig };
    })()`;
  }
  if (spec.startsWith("car:")) {
    return `(() => { const g = CBZ.cityBuildAmbientCarVisual(${JSON.stringify(spec.slice(4))}); return { group: g }; })()`;
  }
  if (spec.startsWith("pcar:")) {
    return `(() => { const g = CBZ.cityBuildPlayerCarVisual(${JSON.stringify(spec.slice(5))}); return { group: g }; })()`;
  }
  if (spec === "cars" || spec === "pcars") {
    const ambient = spec === "cars";
    return String.raw`(() => {
      const names = ${ambient} ? CBZ.cityEcon.CARS.map(c => c.name) : CBZ.cityPlayerCarStyles.slice();
      const root = new THREE.Group();
      const cols = Math.ceil(Math.sqrt(names.length * 1.4));
      const sx = 6.4, sz = 6.8;
      names.forEach((n, i) => {
        const g = ${ambient} ? CBZ.cityBuildAmbientCarVisual(n) : CBZ.cityBuildPlayerCarVisual(n);
        const col = i % cols, row = (i / cols) | 0;
        g.position.set((col - (cols - 1) / 2) * sx, 0, (row) * sz);
        g.rotation.y = -0.55;
        root.add(g);
        const cv = document.createElement("canvas"); cv.width = 256; cv.height = 40;
        const cx = cv.getContext("2d"); cx.fillStyle = "rgba(7,10,14,.8)"; cx.fillRect(0,0,256,40);
        cx.fillStyle = "#fff"; cx.font = "600 20px sans-serif"; cx.textAlign = "center"; cx.fillText(n, 128, 27);
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true }));
        sp.scale.set(3.4, 0.5, 1); sp.position.set(g.position.x, 2.6, g.position.z);
        root.add(sp);
      });
      return { group: root, gridNames: names.length };
    })()`;
  }
  if (spec.startsWith("expr:")) {
    return `(() => { const r = (${spec.slice(5)}); return r && r.group ? r : { group: r }; })()`;
  }
  throw new Error("unknown subject: " + spec);
}

// ---------- anim presets ----------
const ANIMS = {
  idle:      { speed: 0, dur: 3.0, warm: 1.0 },
  walk:      { speed: 3.4, dur: 1.6, warm: 2.0 },
  run:       { speed: 6.4, dur: 1.1, warm: 2.0 },
  sprint:    { speed: 9.5, dur: 0.9, warm: 2.0 },
  punch:     { speed: 0, dur: 0.38, warm: 0.6, trigger: { kind: "jab", arm: "r", dur: 0.34 } },
  heavy:     { speed: 0, dur: 0.5, warm: 0.6, trigger: { kind: "jab", arm: "r", dur: 0.44 } },
  hook:      { speed: 0, dur: 0.44, warm: 0.6, trigger: { kind: "hook", arm: "r", dur: 0.38 } },
  upper:     { speed: 0, dur: 0.5, warm: 0.6, trigger: { kind: "upper", arm: "r", dur: 0.44 } },
  aim:       { speed: 0, dur: 1.0, warm: 0.2, set: "rig.aimingPose=true" },
  aimwalk:   { speed: 3.4, dur: 1.6, warm: 1.5, set: "rig.aimingPose=true" },
  surrender: { speed: 0, dur: 1.0, warm: 0.2, set: "rig.surrender=true" },
};

// ---------- capture flows ----------
async function captureOrbit() {
  const cols = Math.min(4, angles), rows = Math.ceil(angles / 4) + 1; // + top/front row
  await evaluate(`__studio.beginSheet(${cols}, ${rows}, 700, 486)`);
  for (let i = 0; i < angles; i++) {
    const az = (i / angles) * Math.PI * 2 + Math.PI / angles;
    await evaluate(`(__studio.shoot(${az}, 11, ${zoom}), __studio.stamp(${JSON.stringify("az " + Math.round((az * 180) / Math.PI) + "°")}))`);
  }
  // extra row: high 3/4, top-down, front low, rear low
  const extras = [[0.7, 38, "high 3/4"], [0.01, 74, "top"], [0, 4, "front low"], [Math.PI, 4, "rear low"]];
  for (const [az, el, label] of extras.slice(0, cols)) {
    await evaluate(`(__studio.shoot(${az}, ${el}, ${zoom}), __studio.stamp(${JSON.stringify(label)}))`);
  }
  const data = await evaluate(`__studio.endSheet(${JSON.stringify(subject + " — orbit")})`);
  const out = outBase + "-orbit.png";
  await savePng(data, out);
  return out;
}

async function captureStrip() {
  const a = ANIMS[anim];
  if (!a) throw new Error("unknown anim: " + anim + " (have: " + Object.keys(ANIMS).join(", ") + ")");
  const speed = opt.speed != null ? +opt.speed : a.speed;
  const dur = opt.dur != null ? +opt.dur : a.dur;
  const views = [[0.9, 10, "3/4"], [Math.PI / 2, 6, "side"]];
  await evaluate(`__studio.beginSheet(${frames}, ${views.length}, 300, 420)`);
  const gifFrames = [];
  for (let v = 0; v < views.length; v++) {
    const [az, el, vLabel] = views[v];
    // reset rig to neutral, warm to steady-state
    await evaluate(`(() => {
      const S = __studio, rig = S.rig;
      if (!rig) throw new Error("subject has no rig");
      rig.punchT = 0; rig.aimingPose = false; rig.surrender = false; rig.handsUp = false;
      rig.phase = 0; rig.breath = 0;
      S.warm(${a.warm}, ${speed});
      ${a.set ? a.set.replace(/\brig\b/g, "S.rig") + ";" : ""}
      ${a.trigger ? `S.rig.punchKind=${JSON.stringify(a.trigger.kind)};S.rig.punchArm=${JSON.stringify(a.trigger.arm)};S.rig.punchDur=${a.trigger.dur};S.rig.punchT=${a.trigger.dur};` : ""}
      return true;
    })()`);
    for (let f = 0; f < frames; f++) {
      const t = (f / Math.max(1, frames - 1)) * dur;
      const stepNow = f === 0 ? 0 : dur / (frames - 1);
      const label = `${vLabel} t=${t.toFixed(2)}`;
      await evaluate(`(() => {
        const S = __studio;
        const n = Math.round(${stepNow} / (1/120));
        for (let i = 0; i < n; i++) S.step(1/120, ${speed});
        S.shoot(${az}, ${el}, ${zoom * 0.8}, null);
        S.stamp(${JSON.stringify(label)});
        return true;
      })()`);
      if (wantVideo && v === 0) gifFrames.push(await evaluate(`__studio.frameGrab()`));
    }
  }
  const data = await evaluate(`__studio.endSheet(${JSON.stringify(subject + " — " + anim + " @" + speed + "u/s over " + dur + "s")})`);
  const out = outBase + "-strip.png";
  await savePng(data, out);
  if (wantVideo && gifFrames.length) await encodeVideo(gifFrames, outBase + ".webm", frames / Math.max(0.2, +(opt.dur || ANIMS[anim].dur)));
  return out;
}

async function savePng(dataUrl, file) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, Buffer.from(dataUrl.split(",")[1], "base64"));
}

async function encodeVideo(dataUrls, file, fps) {
  // Playwright's bundled ffmpeg is minimal: mjpeg/vp8 decode, vp8/webm encode,
  // image2pipe only — so we pipe canvas JPEG frames to stdin and emit .webm.
  const ff = existsSync("/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux") ? "/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux" : "ffmpeg";
  const code = await new Promise((res) => {
    const p = spawn(ff, ["-y", "-f", "image2pipe", "-c:v", "mjpeg",
      "-framerate", String(Math.max(4, Math.round(fps))), "-i", "pipe:0",
      "-c:v", "libvpx", "-b:v", "1.5M", "-vf", "scale=640:-2", file],
      { stdio: ["pipe", "ignore", "inherit"] });
    p.stdin.on("error", () => {});          // EPIPE if ffmpeg rejects input — exit code tells the story
    for (const d of dataUrls) p.stdin.write(Buffer.from(d.split(",")[1], "base64"));
    p.stdin.end();
    p.on("exit", res); p.on("error", (e) => { console.error("ffmpeg spawn:", e.message); res(1); });
  });
  if (code !== 0) console.error("video encode failed");
  else console.log(file);
}

// ---------- main ----------
let chromeHandle = null;
try {
  await ensureServer();
  chromeHandle = await launchChrome();
  // wait for game scripts to be parsed & studio harness to accept
  let ready = null;
  const harness = HARNESS.replace("__NIGHT__", String(night));
  for (let i = 0; i < 200 && ready !== "ready"; i++) {
    try { ready = await evaluate(harness); } catch (e) { /* still loading */ }
    if (ready !== "ready") await sleep(300);
  }
  if (ready !== "ready") throw new Error("game APIs never became ready (CBZ/THREE/renderer/makeCharacter)");

  const built = await evaluate(`(() => { const r = ${subjectExpr(subject)}; __studio.setSubject(r.group, r.rig); return { ok: true, grid: r.gridNames || 0 }; })()`);
  if (!built || !built.ok) throw new Error("subject failed to build");

  const outputs = [];
  if (mode === "orbit" || mode === "both") outputs.push(await captureOrbit());
  if (mode === "strip" || mode === "both") outputs.push(await captureStrip());
  console.log(outputs.join("\n"));
} finally {
  try { if (chromeHandle) { chromeHandle.chrome.kill("SIGTERM"); await rm(chromeHandle.profile, { recursive: true, force: true }); } } catch (_) {}
  if (serverProc) serverProc.kill("SIGTERM");
}
