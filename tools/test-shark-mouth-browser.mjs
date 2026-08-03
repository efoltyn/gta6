#!/usr/bin/env node
// Focused real-Chrome physics/attachment contract for authored shark mouths.
// It deliberately does not run the game suite: it builds the four shark assets,
// opens each through the production swim rig, and proves that the jaw hinge,
// tooth assemblies, visible bite socket, and close/reset all stay connected.

import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const serverPort = 9640 + Math.floor(Math.random() * 100);
const debugPort = 10840 + Math.floor(Math.random() * 100);
const profile = `/tmp/cbz-shark-mouth-${debugPort}`;
const chromePath = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "/opt/pw-browsers/chromium");

await rm(profile, { recursive: true, force: true });
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], {
  env: { ...process.env, PORT: String(serverPort) }, stdio: "ignore",
});
const base = `http://127.0.0.1:${serverPort}/`;
const chrome = spawn(chromePath, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--enable-unsafe-swiftshader", "--enable-webgl", "--mute-audio",
  "--window-size=960,640", `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profile}`, base,
], { stdio: "ignore" });

let ws = null, nextId = 1;
const pending = new Map(), browserErrors = [];
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    const timer = setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, 45000);
    timer.unref?.();
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
async function json(expression) {
  return JSON.parse(await evaluate(`JSON.stringify(${expression})`));
}
async function poll(expression, timeoutMs = 5000, intervalMs = 50) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const value = await evaluate(expression);
    if (value) return value;
    await sleep(intervalMs);
  }
  return false;
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
    if (msg.method === "Runtime.exceptionThrown") {
      const detail = msg.params?.exceptionDetails || {};
      browserErrors.push({
        text: detail.exception?.description || detail.text || "runtime exception",
        url: detail.url || "", line: detail.lineNumber, column: detail.columnNumber,
      });
      return;
    }
    if (!msg.id || !pending.has(msg.id)) return;
    const p = pending.get(msg.id); pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
  });
  await send("Runtime.enable");

  const ready = await poll(`!!(window.CBZ && window.THREE && CBZ.WILDLIFE_SPECIES &&
    CBZ.buildSwimRig && CBZ.swimJaw && CBZ.creatureJawPoint)`, 45000, 250);
  if (!ready) throw new Error("shark-mouth APIs did not load");

  const report = await json(`(() => {
    const ids = ["great_white_shark", "hammerhead_shark", "bull_shark", "megalodon"];
    const mat = CBZ.cmat || CBZ.mat || (c => new THREE.MeshLambertMaterial({ color: c }));
    const round = n => Math.round(n * 1e6) / 1e6;
    const xyz = v => [round(v.x), round(v.y), round(v.z)];
    function componentCount(root, pad) {
      const meshes = [];
      root.traverse(o => { if (o && o.isMesh) meshes.push(o); });
      const boxes = meshes.map(o => new THREE.Box3().setFromObject(o).expandByScalar(pad));
      const seen = new Set(); let components = 0;
      for (let i = 0; i < boxes.length; i++) {
        if (seen.has(i)) continue;
        components++; seen.add(i); const stack = [i];
        while (stack.length) {
          const at = stack.pop();
          for (let j = 0; j < boxes.length; j++) {
            if (!seen.has(j) && boxes[at].intersectsBox(boxes[j])) {
              seen.add(j); stack.push(j);
            }
          }
        }
      }
      return { meshes: meshes.length, components };
    }
    function frontNamed(root, name) {
      let best = null, bestX = -Infinity;
      root.traverse(o => {
        if (o && o.isMesh && o.name === name && o.position.x > bestX) {
          best = o; bestX = o.position.x;
        }
      });
      return best;
    }
    function verticalGap(upper, lower) {
      if (!upper || !lower) return Infinity;
      const ub = new THREE.Box3().setFromObject(upper);
      const lb = new THREE.Box3().setFromObject(lower);
      return Math.max(0, ub.min.y - lb.max.y);
    }
    return ids.map((id, speciesIndex) => {
      const sp = CBZ.WILDLIFE_SPECIES[id];
      if (!sp || !sp.build) return { id, missing: true };
      const group = sp.build({ THREE, mat, rng: () => 0.5 });
      group.scale.setScalar(sp.scale || 1);
      group.position.set(7 + speciesIndex * 3, 2 + speciesIndex, -4 - speciesIndex);
      group.rotation.y = 0.27 + speciesIndex * 0.11;
      group.traverse(o => { o.matrixAutoUpdate = true; });
      const actor = { species: sp, group, heading: 0 };
      CBZ.buildSwimRig(actor);
      const rig = actor.swim, contract = group.userData.aquaticMouth;
      if (!rig || !contract || !rig.jawGroup) return { id, missingRig: true };

      CBZ.swimJaw(actor, 0); group.updateMatrixWorld(true);
      const hingeClosed = rig.jawGroup.getWorldPosition(new THREE.Vector3());
      const lowerClosed = componentCount(rig.jawGroup, 0.003 * (sp.scale || 1));
      const upperClosed = componentCount(rig.jawUpper, 0.003 * (sp.scale || 1));
      const upperX0 = rig.jawUpper.position.x, upperY0 = rig.jawUpper.position.y;
      const cavityScale0 = rig.jawCavity.scale.y;
      const upperLip = frontNamed(rig.jawUpper, "sharkUpperLip");
      const lowerLip = frontNamed(rig.jawGroup, "sharkLowerLip");
      const restLipGap = verticalGap(upperLip, lowerLip);
      const bodyMeshes = group.children.filter(o => o && o.isMesh && o !== rig.jawCavity);
      let hingeBodyGap = Infinity;
      for (const mesh of bodyMeshes) {
        const d = new THREE.Box3().setFromObject(mesh).distanceToPoint(hingeClosed);
        if (d < hingeBodyGap) hingeBodyGap = d;
      }
      const localBite = CBZ.creatureJawPoint(actor);
      const biteContractError = Math.hypot(
        localBite.x - contract.bite.x,
        localBite.y - contract.bite.y,
        (localBite.z || 0) - (contract.bite.z || 0)
      );

      CBZ.swimJaw(actor, 1); group.updateMatrixWorld(true);
      const hingeOpen = rig.jawGroup.getWorldPosition(new THREE.Vector3());
      const biteWorld = new THREE.Vector3(localBite.x, localBite.y, localBite.z || 0)
        .applyMatrix4(group.matrixWorld);
      const toothRing = new THREE.Box3().setFromObject(rig.jawUpper)
        .union(new THREE.Box3().setFromObject(rig.jawGroup));
      const open = {
        hingeDrift: hingeClosed.distanceTo(hingeOpen),
        lowerAngle: Math.abs(rig.jawGroup.rotation.z - rig.jawLowerRz),
        expectedAngle: contract.travel || contract.maxOpen,
        upperTravel: Math.hypot(rig.jawUpper.position.x - upperX0, rig.jawUpper.position.y - upperY0),
        cavityReveal: rig.jawCavity.scale.y / cavityScale0,
        biteRingGap: toothRing.distanceToPoint(biteWorld),
        lipGap: verticalGap(upperLip, lowerLip),
      };

      CBZ.swimJaw(actor, 0); group.updateMatrixWorld(true);
      const hingeReset = rig.jawGroup.getWorldPosition(new THREE.Vector3());
      return {
        id, scale: sp.scale || 1, authored: contract.version >= 1,
        teeth: { upper: contract.upperTeeth, lower: contract.lowerTeeth },
        connected: { upper: upperClosed, lower: lowerClosed },
        hinge: { closed: xyz(hingeClosed), bodyGap: round(hingeBodyGap),
          openDrift: round(open.hingeDrift), resetDrift: round(hingeClosed.distanceTo(hingeReset)) },
        motion: { lowerAngle: round(open.lowerAngle), expectedAngle: round(open.expectedAngle),
          upperTravel: round(open.upperTravel), cavityReveal: round(open.cavityReveal),
          restLipGap: round(restLipGap), openLipGap: round(open.lipGap) },
        contact: { contractError: round(biteContractError), toothRingGap: round(open.biteRingGap),
          point: [round(localBite.x), round(localBite.y), round(localBite.z || 0)] },
        reset: { lowerAngle: round(Math.abs(rig.jawGroup.rotation.z - rig.jawLowerRz)),
          upperTravel: round(Math.hypot(rig.jawUpper.position.x - upperX0, rig.jawUpper.position.y - upperY0)),
          cavityScale: round(rig.jawCavity.scale.y), expectedCavityScale: round(cavityScale0) },
      };
    });
  })()`);

  const failures = [];
  for (const r of report) {
    if (r.missing || r.missingRig || !r.authored) failures.push(`${r.id}: missing authored hinged mouth`);
    if (!r.teeth || r.teeth.upper < 12 || r.teeth.lower < 12) failures.push(`${r.id}: incomplete front-and-side tooth ring`);
    if (!r.connected || r.connected.upper.components !== 1 || r.connected.lower.components !== 1) failures.push(`${r.id}: floating/disconnected mouth component`);
    if (!r.hinge || r.hinge.bodyGap > 0.01 || r.hinge.openDrift > 0.00001 || r.hinge.resetDrift > 0.00001) failures.push(`${r.id}: lower-jaw hinge detached or drifted`);
    if (!r.motion || Math.abs(r.motion.lowerAngle - r.motion.expectedAngle) > 0.00001 || r.motion.upperTravel <= 0 || r.motion.cavityReveal < 3) failures.push(`${r.id}: gape motion contract failed`);
    if (!r.motion || r.motion.restLipGap > 0.15 * r.scale || r.motion.openLipGap < r.motion.restLipGap + 0.16 * r.scale) failures.push(`${r.id}: rest mouth is open or full gape is unreadable`);
    if (!r.contact || r.contact.contractError > 0.00001 || r.contact.toothRingGap > 0.01) failures.push(`${r.id}: damage socket is outside visible tooth ring`);
    if (!r.reset || r.reset.lowerAngle > 0.00001 || r.reset.upperTravel > 0.00001 || Math.abs(r.reset.cavityScale - r.reset.expectedCavityScale) > 0.00001) failures.push(`${r.id}: mouth did not close back to authored rest`);
  }
  // This is a mouth contract, not a whole-page suite. Preserve and report
  // unrelated dirty-checkout errors, but fail only when the mouth owners (or
  // an unattributed inline script) throw.
  const contractErrors = browserErrors.filter(e => !e.url || /wildlife|creature_combat/.test(e.url));
  const unrelatedBrowserErrors = browserErrors.filter(e => !contractErrors.includes(e));
  if (contractErrors.length) failures.push(`${contractErrors.length} shark-mouth browser error(s)`);
  console.log(JSON.stringify({ sharks: report, contractErrors, unrelatedBrowserErrors, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  if (ws) ws.close();
  chrome.kill("SIGTERM");
  server.kill("SIGTERM");
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
