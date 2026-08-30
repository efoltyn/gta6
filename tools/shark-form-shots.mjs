#!/usr/bin/env node
/* Orthographic anatomy plates for a wildlife species, rendered out of the REAL
   builder in a real browser — not a sketch of what the numbers ought to look
   like. Builds the species group, fits an ortho camera to its bounds and
   captures lateral / dorsal / anterior / three-quarter views at print DPI, plus
   the ring measurements the proportions argument is actually about.

     node tools/shark-form-shots.mjs --species bull_shark --out artifacts/shark-form/before

   Views are all fitted to the SAME world extent across a run, so a before plate
   and an after plate are directly comparable pixel-for-pixel. */

import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const argOf = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : args[i + 1]; };
const SPECIES = argOf("--species", "bull_shark");
const OUT = path.resolve(ROOT, argOf("--out", "artifacts/shark-form/shots"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const serverPort = 9740 + Math.floor(Math.random() * 100);
const debugPort = 10940 + Math.floor(Math.random() * 100);
const profile = `/tmp/cbz-shark-form-${debugPort}`;
const chromePath = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "/opt/pw-browsers/chromium");

await rm(profile, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], {
  env: { ...process.env, PORT: String(serverPort) }, stdio: "ignore",
});
const base = `http://127.0.0.1:${serverPort}/`;
const chrome = spawn(chromePath, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--enable-unsafe-swiftshader", "--enable-webgl", "--mute-audio",
  "--window-size=1200,800", `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profile}`, base,
], { stdio: "ignore" });

let ws = null, nextId = 1;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    const t = setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id); reject(new Error(`${method} timed out`));
    }, 60000);
    t.unref?.();
  });
}
async function evaluate(expression) {
  const out = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (out?.exceptionDetails) {
    throw new Error(out.exceptionDetails.exception?.description || out.exceptionDetails.text || "eval failed");
  }
  return out?.result?.value;
}
async function poll(expr, timeoutMs = 45000, step = 250) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { if (await evaluate(expr)) return true; await sleep(step); }
  return false;
}

let code = 0;
try {
  let page = null;
  for (let i = 0; i < 160 && !page; i++) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      page = pages.find((p) => p.type === "page" && p.url.startsWith(base));
    } catch (_) {}
    if (!page) await sleep(250);
  }
  if (!page) throw new Error("Chrome page did not become available");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
    if (!msg.id || !pending.has(msg.id)) return;
    const p = pending.get(msg.id); pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
  });
  await send("Runtime.enable");

  const ready = await poll(`!!(window.CBZ && window.THREE && CBZ.WILDLIFE_SPECIES &&
    CBZ.WILDLIFE_SPECIES[${JSON.stringify(SPECIES)}])`);
  if (!ready) throw new Error("wildlife species API did not load");

  /* ---- Build once, render four fitted ortho plates. The renderer is its own
     offscreen context so nothing about the live game page leaks into the
     plate: flat studio light, white ground, no fog, no sea. ---- */
  const setup = await evaluate(`(() => {
    const sp = CBZ.WILDLIFE_SPECIES[${JSON.stringify(SPECIES)}];
    const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
    const g = sp.build({ THREE, mat, rng: () => 0.5 });
    g.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(g);
    window.__form = { sp, g, box };

    // ---- the ring table that the silhouette is actually made of
    const shape = g.userData.sharkShape || {};
    const size = box.getSize(new THREE.Vector3());
    return JSON.stringify({
      id: sp.id, name: sp.name, scale: sp.scale || 1, shape,
      bounds: { x: [box.min.x, box.max.x], y: [box.min.y, box.max.y], z: [box.min.z, box.max.z] },
      size: { x: size.x, y: size.y, z: size.z },
    });
  })()`);

  const RES = 1800;
  const VIEWS = [
    { key: "lateral",  eye: [0, 0, 1],   up: [0, 1, 0], plane: "xy", label: "LATERAL" },
    { key: "dorsal",   eye: [0, 1, 0],   up: [-1, 0, 0], plane: "xz", label: "DORSAL" },
    { key: "anterior", eye: [1, 0, 0],   up: [0, 1, 0], plane: "zy", label: "ANTERIOR" },
    { key: "quarter",  eye: [0.72, 0.34, 0.60], up: [0, 1, 0], plane: "fit", label: "THREE-QUARTER" },
  ];

  for (const v of VIEWS) {
    const dataUrl = await evaluate(`(() => {
      const F = window.__form, g = F.g, box = F.box;
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xffffff);
      scene.add(new THREE.HemisphereLight(0xffffff, 0xb9c2c8, 1.05));
      const key = new THREE.DirectionalLight(0xffffff, 0.85);
      key.position.set(0.6, 1.0, 0.8); scene.add(key);
      const rim = new THREE.DirectionalLight(0xdfe8ef, 0.45);
      rim.position.set(-0.8, 0.3, -0.7); scene.add(rim);
      const clone = g.clone(true);
      scene.add(clone);

      const c = box.getCenter(new THREE.Vector3());
      const s = box.getSize(new THREE.Vector3());
      const radius = Math.max(s.x, s.y, s.z) * 0.5;
      const eye = new THREE.Vector3(${v.eye.join(",")}).normalize();
      const dist = radius * 8 + 6;
      const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, dist * 3);
      cam.position.copy(c).addScaledVector(eye, dist);
      cam.up.set(${v.up.join(",")});
      cam.lookAt(c);
      cam.updateMatrixWorld(true);

      // Fit tightly to the projected silhouette of the real geometry so every
      // plate frames the animal, not its bounding cube.
      const inv = new THREE.Matrix4().copy(cam.matrixWorld).invert();
      let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
      const p = new THREE.Vector3();
      clone.updateMatrixWorld(true);
      clone.traverse((o) => {
        if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
        const pos = o.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).applyMatrix4(inv);
          if (p.x < minU) minU = p.x; if (p.x > maxU) maxU = p.x;
          if (p.y < minV) minV = p.y; if (p.y > maxV) maxV = p.y;
        }
      });
      const padU = (maxU - minU) * 0.04 + 0.02, padV = (maxV - minV) * 0.04 + 0.02;
      minU -= padU; maxU += padU; minV -= padV; maxV += padV;
      const w = maxU - minU, h = maxV - minV;
      const px = ${RES}, py = Math.max(160, Math.round(px * h / w));
      cam.left = minU; cam.right = maxU; cam.top = maxV; cam.bottom = minV;
      cam.updateProjectionMatrix();

      const canvas = document.createElement("canvas");
      canvas.width = px; canvas.height = py;
      const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
      r.setPixelRatio(1); r.setSize(px, py, false);
      if ("outputEncoding" in r && THREE.sRGBEncoding) r.outputEncoding = THREE.sRGBEncoding;
      r.render(scene, cam);
      const url = canvas.toDataURL("image/png");
      r.dispose();
      return url;
    })()`);
    const b64 = String(dataUrl).split(",")[1];
    await writeFile(path.join(OUT, `${SPECIES}-${v.key}.png`), Buffer.from(b64, "base64"));
    console.log(`  wrote ${v.key}`);
  }

  await writeFile(path.join(OUT, `${SPECIES}-form.json`), setup + "\n");
  console.log(JSON.parse(setup).name + " plates -> " + path.relative(ROOT, OUT));
} catch (err) {
  console.error("shark-form-shots FAILED:", err.message);
  code = 1;
} finally {
  try { ws?.close(); } catch (_) {}
  chrome.kill("SIGKILL"); server.kill("SIGKILL");
  await sleep(200);
  try { await rm(profile, { recursive: true, force: true, maxRetries: 5 }); } catch (_) {}
}
process.exit(code);
