#!/usr/bin/env node
// Render every ambient model or promoted player-car style in headless Chrome.
// Usage:
//   node tools/render-vehicle-gallery.mjs ambient
//   node tools/render-vehicle-gallery.mjs player

import { spawn } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";

const kind = process.argv[2] === "ambient" ? "ambient" : "player";
const server = process.env.CBZ_GALLERY_URL || "http://127.0.0.1:8000/";
const output = process.argv[3] || `/tmp/cbz-${kind}-vehicle-gallery.png`;
const port = 9800 + Math.floor(Math.random() * 120);
const profileDir = `/tmp/cbz-vehicle-gallery-${port}`;
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

await rm(profileDir, { recursive: true, force: true });
const chrome = spawn(chromePath, [
  "--headless=new",
  "--enable-unsafe-swiftshader",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-default-apps",
  "--disable-extensions",
  "--hide-scrollbars",
  "--no-default-browser-check",
  "--no-first-run",
  "--ignore-certificate-errors",
  "--window-size=1800,1250",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profileDir}`,
  server,
], { stdio: "ignore" });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let ws;
let nextId = 1;
const pending = new Map();

async function json(path) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  if (!res.ok) throw new Error(`DevTools HTTP ${res.status}`);
  return res.json();
}

async function waitForPage() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const pages = await json("/json/list");
      const page = pages.find((p) => p.type === "page" && p.url.startsWith(server));
      if (page) return page;
    } catch (_) {}
    await sleep(200);
  }
  throw new Error("Chrome page did not become available");
}

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, 15000);
  });
}

async function connect(page) {
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (!msg.id || !pending.has(msg.id)) return;
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
  });
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1800, height: 1250, deviceScaleFactor: 1, mobile: false });
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "gallery evaluation failed");
  return result.result && result.result.value;
}

const galleryExpression = `(() => {
  const kind = ${JSON.stringify(kind)};
  if (!window.CBZ || !CBZ.renderer || !CBZ.cityBuildPlayerCarVisual || !CBZ.cityBuildAmbientCarVisual) return null;
  const names = kind === "ambient"
    ? CBZ.cityEcon.CARS.map((c) => c.name)
    : CBZ.cityPlayerCarStyles.slice();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x18202b);
  scene.add(new THREE.HemisphereLight(0xddeeff, 0x29333d, 1.35));
  const sun = new THREE.DirectionalLight(0xffffff, 1.25);
  sun.position.set(-18, 32, 26);
  scene.add(sun);
  const cols = kind === "ambient" ? 7 : 6;
  const rows = Math.ceil(names.length / cols);
  const sx = 7.2, sz = 7.4;
  const makeLabel = (text) => {
    const cv = document.createElement("canvas");
    cv.width = 512; cv.height = 72;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "rgba(7,10,14,.82)"; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = "#f4f7fb"; ctx.font = "600 25px sans-serif"; ctx.textAlign = "center";
    ctx.fillText(text, cv.width / 2, 46);
    const tex = new THREE.CanvasTexture(cv);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    s.scale.set(4.7, 0.66, 1);
    return s;
  };
  names.forEach((name, i) => {
    const root = kind === "ambient" ? CBZ.cityBuildAmbientCarVisual(name) : CBZ.cityBuildPlayerCarVisual(name);
    const col = i % cols, row = Math.floor(i / cols);
    root.position.set((col - (cols - 1) / 2) * sx, 0.08, (row - (rows - 1) / 2) * sz);
    root.rotation.y = -0.62;
    scene.add(root);
    const label = makeLabel(kind === "ambient" ? name : (CBZ.cityPlayerCarStyleLabels[name] || name));
    label.position.set(root.position.x, 3.2, root.position.z);
    scene.add(label);
  });
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(cols * sx + 8, rows * sz + 8),
    new THREE.MeshLambertMaterial({ color: 0x4c5865 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  scene.add(ground);
  const viewWidth = Math.max(cols * sx + 12, (rows * sz + 12) * (1800 / 1250));
  const viewHeight = viewWidth / (1800 / 1250);
  const camera = new THREE.OrthographicCamera(-viewWidth / 2, viewWidth / 2, viewHeight / 2, -viewHeight / 2, 0.1, 300);
  camera.position.set(0, Math.max(34, rows * 10), rows * 11.5);
  camera.lookAt(0, 0.8, 0);
  CBZ.game.state = "gallery";
  CBZ.scene = scene;
  CBZ.camera = camera;
  const canvas = CBZ.renderer.domElement;
  document.body.innerHTML = "";
  document.body.style.margin = "0";
  document.body.style.background = "#18202b";
  document.body.appendChild(canvas);
  canvas.style.display = "block";
  CBZ.renderer.setSize(1800, 1250, false);
  CBZ.renderer.shadowMap.enabled = false;
  CBZ.renderer.render(scene, camera);
  return { count: names.length, names };
})()`;

try {
  const page = await waitForPage();
  await connect(page);
  let result = null;
  for (let i = 0; i < 120 && !result; i++) {
    result = await evaluate(galleryExpression);
    if (!result) await sleep(250);
  }
  if (!result) throw new Error("vehicle gallery APIs did not become ready");
  await sleep(250);
  await evaluate("CBZ.renderer.render(CBZ.scene, CBZ.camera); true");
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(output, Buffer.from(shot.data, "base64"));
  process.stdout.write(`${kind}: rendered ${result.count} vehicles to ${output}\n`);
} finally {
  if (!chrome.killed) chrome.kill("SIGTERM");
  await rm(profileDir, { recursive: true, force: true }).catch(() => {});
}
