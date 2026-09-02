#!/usr/bin/env node
// Focused real-Chrome contract for the canonical marine builders. The visual
// report proves pixels; this proves that every photographed room and rig audit
// is owned by the production registry rather than by the comparison preset.

import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const serverPort = 9650 + Math.floor(Math.random() * 100);
const debugPort = 10850 + Math.floor(Math.random() * 100);
const profile = `/tmp/cbz-marine-visual-${debugPort}`;
const chromePath = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "/opt/pw-browsers/chromium");

await rm(profile, { recursive: true, force: true });
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], {
  env: { ...process.env, PORT: String(serverPort) }, stdio: "ignore",
});
const base = `http://127.0.0.1:${serverPort}/?seed=marine-visual-contract`;
const chrome = spawn(chromePath, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--enable-unsafe-swiftshader", "--enable-webgl", "--mute-audio",
  "--window-size=1120,700", `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profile}`, base,
], { stdio: "ignore" });

let ws = null, nextId = 1;
const pending = new Map(), browserErrors = [];
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, 45000);
    timer.unref?.();
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const out = await send("Runtime.evaluate", {
    expression, returnByValue: true, awaitPromise: true,
  });
  if (out?.exceptionDetails) {
    throw new Error(out.exceptionDetails.exception?.description || out.exceptionDetails.text || "browser evaluation failed");
  }
  return out?.result?.value;
}

try {
  let page = null;
  for (let i = 0; i < 160 && !page; i++) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      page = pages.find((candidate) => candidate.type === "page" && candidate.url.startsWith(base));
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
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown") {
      const detail = message.params?.exceptionDetails || {};
      browserErrors.push(detail.exception?.description || detail.text || "runtime exception");
      return;
    }
    if (!message.id || !pending.has(message.id)) return;
    const operation = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(operation.timer);
    if (message.error) operation.reject(new Error(message.error.message));
    else operation.resolve(message.result);
  });
  await send("Runtime.enable");

  let ready = false;
  for (let i = 0; i < 180 && !ready; i++) {
    ready = !!(await evaluate(`document.readyState === "complete" && !!(
      window.CBZ && CBZ.marineHulls && CBZ.marineHulls.kit &&
      CBZ.marineHulls.keys().length >= 11 && CBZ.cityBuildPlayerCarVisual
    )`));
    if (!ready) await sleep(250);
  }
  if (!ready) throw new Error("marine registry did not become ready");

  const result = JSON.parse(await evaluate(`JSON.stringify((() => {
    const expected = {
      kayak: ["kayak-well"],
      jetski: ["jetski-saddle"],
      pirate_skiff: ["skiff-deck"],
      dinghy: ["dinghy-helm"],
      boat: ["speedboat-cockpit"],
      console: ["console-helm"],
      skiff: ["skiff-helm"],
      cruiser: ["cruiser-cockpit", "cruiser-saloon", "cruiser-flybridge"],
      yacht: ["yacht34-saloon", "yacht34-skylounge", "yacht34-wheelhouse", "yacht34-garage", "yacht34-sundeck"],
      trawler: ["captain-workdeck", "captain-wheelhouse", "captain-hold"],
      sportfish: ["sportfish-cockpit", "sportfish-saloon", "sportfish-flybridge", "sportfish-tower"],
      sloop: ["sloop-cockpit", "sloop-cabin", "sloop-rig"],
      yacht46: ["super-saloon", "super-bridge", "super-tier-2"],
      yacht88: ["super-saloon", "super-tier-1", "super-bridge", "super-tier-3", "super-garage-port", "super-garage-starboard"],
      yacht156: ["super-saloon", "super-tier-1", "super-tier-2", "super-bridge", "super-tier-4", "super-garage-port", "super-garage-starboard"],
    };
    const rigged = new Set(["skiff", "cruiser", "yacht", "trawler", "sportfish", "sloop", "yacht46", "yacht88", "yacht156"]);
    const failures = [], boats = [];
    const keys = CBZ.marineHulls.keys();
    const missing = Object.keys(expected).filter((key) => !keys.includes(key));
    const unexpected = keys.filter((key) => !expected[key]);
    if (missing.length) failures.push("missing registry hulls: " + missing.join(", "));
    if (unexpected.length) failures.push("unexpected uncensused hulls: " + unexpected.join(", "));
    for (const key of Object.keys(expected)) {
      const rec = CBZ.marineHulls.get(key);
      const root = CBZ.marineHulls.build(key);
      if (!rec || !root) { failures.push(key + ": build failed"); continue; }
      root.updateMatrixWorld(true);
      const rooms = Array.isArray(root.userData.marineRooms)
        ? root.userData.marineRooms.map((room) => room && room.id).filter(Boolean)
        : [];
      const roomSet = new Set(rooms);
      const want = expected[key];
      const roomMissing = want.filter((id) => !roomSet.has(id));
      const roomExtra = rooms.filter((id) => !want.includes(id));
      if (rooms.length !== roomSet.size) failures.push(key + ": duplicate room ids");
      if (roomMissing.length || roomExtra.length) {
        failures.push(key + ": room mismatch missing=[" + roomMissing + "] extra=[" + roomExtra + "]");
      }
      const fixtures = Number(root.userData.marineFixtureCount) || 0;
      if (fixtures < 1) failures.push(key + ": no production fixtures published");
      const rig = root.userData.marineRigAudit || {};
      const anchors = Number(rig.anchors) || 0;
      const gaps = Number(rig.gaps) || 0;
      if (gaps !== 0) failures.push(key + ": " + gaps + " disconnected rig endpoint(s)");
      if (rigged.has(key) && anchors < 2) failures.push(key + ": rig was not endpoint-solved");
      if (!root.userData.marineLivery) failures.push(key + ": authored marine livery is not protected");
      let meshes = 0;
      root.traverse((node) => { if (node.isMesh) meshes++; });
      if (meshes < 5) failures.push(key + ": implausibly empty build (" + meshes + " meshes)");
      const bounds = new THREE.Box3().setFromObject(root);
      const size = bounds.getSize(new THREE.Vector3());
      const spec = rec.spec || {};
      const finite = [size.x, size.y, size.z].every(Number.isFinite);
      if (!finite || size.x < Number(spec.beam || 1) * 0.65 || size.z < Number(spec.loa || 1) * 0.62) {
        failures.push(key + ": visual bounds do not cover the authored hull");
      }
      boats.push({ key, rooms: rooms.length, fixtures, anchors, gaps, meshes,
        bounds: [size.x, size.y, size.z].map((n) => Math.round(n * 100) / 100) });
    }
    // The census is derived from the expected map above rather than typed as
    // a literal: a hardcoded total is a second place to remember to edit, and
    // the only thing it ever caught was somebody forgetting to edit it.
    // (No backticks in here: this whole block is inside a template literal.)
    const roomTotal = boats.reduce((sum, boat) => sum + boat.rooms, 0);
    const roomWant = Object.values(expected).reduce((sum, list) => sum + list.length, 0);
    if (roomTotal !== roomWant) failures.push("room census is " + roomTotal + ", expected " + roomWant);
    return { keys, boats, roomTotal, failures };
  })())`));

  if (browserErrors.length) result.failures.push(`browser exceptions: ${browserErrors.join(" | ")}`);
  console.log(JSON.stringify(result, null, 2));
  if (result.failures.length) process.exitCode = 1;
} finally {
  try { if (ws && ws.readyState === WebSocket.OPEN) await send("Browser.close"); } catch (_) {}
  if (!chrome.killed) chrome.kill("SIGTERM");
  if (!server.killed) server.kill("SIGTERM");
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
