#!/usr/bin/env node
// Deterministic real-Chrome audit for Mount Mercy. It keeps the player on foot
// (the stricter city projection) and photographs the same opaque mountain from
// several distances, while recording far-plane/frustum/material ownership.

import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SHOTS = path.join(ROOT, "tools/shots");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const serverPort = 9160 + Math.floor(Math.random() * 80);
const debugPort = 10160 + Math.floor(Math.random() * 80);
const profile = `/tmp/cbz-mount-mercy-${debugPort}`;
const chromePath = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "/opt/pw-browsers/chromium");

await mkdir(SHOTS, { recursive: true });
await rm(profile, { recursive: true, force: true });
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], {
  env: { ...process.env, PORT: String(serverPort) }, stdio: "ignore",
});
const base = `http://127.0.0.1:${serverPort}/`;
const chrome = spawn(chromePath, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--enable-unsafe-swiftshader", "--enable-webgl", "--mute-audio",
  "--window-size=1440,900", `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profile}`, base,
], { stdio: "ignore" });

let ws = null, nextId = 1;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    const timeout = setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, 45000);
    if (timeout.unref) timeout.unref();
  });
}
async function evaluate(expression) {
  const out = await send("Runtime.evaluate", {
    expression, returnByValue: true, awaitPromise: true,
  });
  if (out && out.exceptionDetails) {
    throw new Error(out.exceptionDetails.exception?.description || out.exceptionDetails.text || "browser evaluation failed");
  }
  return out && out.result && out.result.value;
}

try {
  let page = null;
  for (let i = 0; i < 120 && !page; i++) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      page = pages.find((p) => p.type === "page" && p.url.startsWith(base));
    } catch (_) {}
    if (!page) await sleep(250);
  }
  if (!page) throw new Error("Chrome page did not become available");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (!msg.id || !pending.has(msg.id)) return;
    const p = pending.get(msg.id); pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
  });
  await send("Runtime.enable");
  await send("Page.enable");

  for (let i = 0; i < 120; i++) {
    if (await evaluate("!!(window.CBZ && CBZ.game && document.getElementById('playBtn'))")) break;
    await sleep(250);
  }
  await evaluate("(() => { if (CBZ.CONFIG) CBZ.CONFIG.CITY_HITMAN_CAMPAIGN=false; return true; })()");
  let playing = false;
  for (let i = 0; i < 120 && !playing; i++) {
    await evaluate("(() => { const b=document.getElementById('playBtn'); if(b)b.click(); return true; })()");
    await sleep(500);
    playing = !!(await evaluate("CBZ.game && CBZ.game.state === 'playing'"));
  }
  if (!playing) throw new Error("city did not enter playing state");
  await sleep(6500);

  await evaluate(`(() => {
    if (CBZ.setFPS) CBZ.setFPS(false);
    if (CBZ.dayPhase) CBZ.dayPhase(0.36);
    if (!CBZ.renderer.__mountMercyAudit) {
      const original = CBZ.renderer.render.bind(CBZ.renderer);
      CBZ.renderer.render = function (scene, camera) {
        const q = window.__mountMercyCamera;
        if (q && camera) {
          camera.position.set(q[0], q[1], q[2]);
          camera.lookAt(q[3], q[4], q[5]);
          camera.updateMatrixWorld(true);
          const skyRig = CBZ.skyDome && CBZ.skyDome.parent;
          if (skyRig) { skyRig.position.copy(camera.position); skyRig.updateMatrixWorld(true); }
        }
        return original(scene, camera);
      };
      CBZ.renderer.__mountMercyAudit = true;
    }
    return true;
  })()`);

  const views = [
    { label: "near", distance: 500, lookX: 350 },
    { label: "mid", distance: 1000, lookX: 350 },
    { label: "airfield", distance: 1450, lookX: 350 },
    { label: "far", distance: 1750, lookX: 350 },
    { label: "far-limit", distance: 2050, lookX: 350 },
    // Aim well west of the massif so its bounding volume sits at the right
    // camera edge. This catches sphere/frustum pop that a centred view misses.
    { label: "camera-edge", distance: 1450, lookX: -650 },
  ];
  const samples = [];
  for (const view of views) {
    const { distance } = view;
    const cameraY = Math.min(92, 38 + distance * 0.022);
    await evaluate(`(() => {
      const x=350, z=-1597+${distance};
      CBZ.player._aircraft=null; CBZ.player.driving=null;
      CBZ.player.pos.set(x, CBZ.floorAt ? (+CBZ.floorAt(x,z)||0) : 0, z);
      if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(CBZ.player.pos);
      window.__mountMercyCamera=[x,${cameraY},z,${view.lookX},58,-1597];
      return true;
    })()`);
    // mode.js and the 4Hz city culler both get time to see the real player.
    await sleep(1250);
    const state = JSON.parse(await evaluate(`JSON.stringify((() => {
      const mesh=CBZ.scene.getObjectByName("mount-mercy-ground");
      const run=(mesh && mesh.parent ? mesh.parent.children : []).find(o => o && o.userData && o.userData.mountMercySkiRun);
      CBZ.camera.updateMatrixWorld(true);
      const pv=new THREE.Matrix4().multiplyMatrices(CBZ.camera.projectionMatrix,CBZ.camera.matrixWorldInverse);
      const frustum=new THREE.Frustum().setFromProjectionMatrix(pv);
      const box=mesh ? new THREE.Box3().setFromObject(mesh) : null;
      let ancestorVisible=true, p=mesh;
      while (p) { if (p.visible===false) ancestorVisible=false; p=p.parent; }
      const m=mesh && mesh.material;
      return {
        label:${JSON.stringify(view.label)}, distance:${distance}, cameraFar:CBZ.camera.far, cameraNear:CBZ.camera.near,
        meshVisible:!!(mesh && mesh.visible), ancestorVisible,
        frustumHit:!!(mesh && frustum.intersectsObject(mesh)), frustumCulled:mesh && mesh.frustumCulled,
        bounds:box ? { min:box.min.toArray().map(v=>+v.toFixed(1)), max:box.max.toArray().map(v=>+v.toFixed(1)) } : null,
        material:m ? { type:m.type, transparent:!!m.transparent, opacity:m.opacity, depthWrite:!!m.depthWrite, fog:!!m.fog, color:m.color && m.color.getHexString() } : null,
        skiRun:run ? { polygonOffset:!!run.material.polygonOffset, factor:run.material.polygonOffsetFactor, units:run.material.polygonOffsetUnits } : null
      };
    })())`));
    samples.push(state);
    if (view.label === "near" || view.label === "airfield" || view.label === "far-limit" || view.label === "camera-edge") {
      const shot = await send("Page.captureScreenshot", { format: "png" });
      await writeFile(path.join(SHOTS, `mount-mercy-${view.label}.png`), Buffer.from(shot.data, "base64"));
    }
  }

  const failures = [];
  for (const s of samples) {
    if (!s.meshVisible || !s.ancestorVisible) failures.push(`${s.label}: mountain hidden by ownership/culler`);
    if (!s.frustumHit) failures.push(`${s.label}: mountain outside active camera frustum`);
  }
  const material = samples[0] && samples[0].material;
  if (!material || material.transparent || material.opacity !== 1 || !material.depthWrite) failures.push("mountain material is not fully opaque/depth-writing");
  if (samples[0]?.frustumCulled !== false) failures.push("mountain still relies on object-sphere frustum toggling");
  if (!samples[0]?.skiRun?.polygonOffset) failures.push("ski run has no depth-fighting protection");
  console.log(JSON.stringify({ samples, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  if (chrome) chrome.kill("SIGTERM");
  if (server) server.kill("SIGTERM");
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
