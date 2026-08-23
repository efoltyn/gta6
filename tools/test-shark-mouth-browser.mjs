#!/usr/bin/env node
// Focused real-Chrome physics/attachment contract for predator mouth envelopes.
// It builds the shared shark variants plus the orca, opens each through the
// production swim rig, and proves that body shells (not loose dentures), tooth
// assemblies, bite socket, cavity reveal and close/reset stay connected.

import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const serverPort = 9640 + Math.floor(Math.random() * 100);
const debugPort = 10840 + Math.floor(Math.random() * 100);
const profile = `/tmp/cbz-predator-mouth-${debugPort}`;
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
    CBZ.WILDLIFE_SPECIES.orca && CBZ.orcaIdentity &&
    CBZ.buildSwimRig && CBZ.swimJaw && CBZ.creatureJawPoint && CBZ.biteCurve &&
    CBZ.biteTimeline && CBZ.aquaticBiteDuration)`, 45000, 250);
  if (!ready) throw new Error("predator-mouth APIs did not load");

  const report = await json(`(() => {
    const ids = ["great_white_shark", "hammerhead_shark", "bull_shark", "megalodon", "orca"];
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
    function named(root, name) {
      let found = null;
      if (!name) return null;
      root.traverse(o => { if (!found && o && o.isMesh && o.name === name) found = o; });
      return found;
    }
    function nestedIn(child, parent) {
      for (let o = child; o; o = o.parent) if (o === parent) return true;
      return false;
    }
    function worldCenter(mesh) {
      return mesh ? new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3()) : null;
    }
    function localFrontX(mesh, root) {
      if (!mesh || !root || !mesh.geometry || !mesh.geometry.attributes.position) return null;
      const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
      const pos = mesh.geometry.attributes.position, p = new THREE.Vector3();
      let x = -Infinity;
      for (let i = 0; i < pos.count; i++) {
        p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).applyMatrix4(inv);
        if (p.x > x) x = p.x;
      }
      return Number.isFinite(x) ? x : null;
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
      const upperLip = frontNamed(rig.jawUpper, "sharkUpperLip") || frontNamed(rig.jawUpper, "orcaUpperGum");
      const lowerLip = frontNamed(rig.jawGroup, "sharkLowerLip") || frontNamed(rig.jawGroup, "orcaLowerGum");
      const restLipGap = verticalGap(upperLip, lowerLip);
      const arcX = contract.upperReachX == null ? null
        : contract.upperReachX - (contract.protrude || 0) - (contract.dentalProtrude || 0);
      const uf = localFrontX(upperLip, group), lf = localFrontX(lowerLip, group);
      const lipProud = arcX == null || uf == null || lf == null ? null
        : Math.max(0, uf - arcX, lf - arcX) * (sp.scale || 1);
      const upperShell = named(group, contract.upperShell);
      const lowerShell = named(group, contract.lowerShell);
      const upperShell0 = worldCenter(upperShell), lowerShell0 = worldCenter(lowerShell);
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
        upperShellTravel: upperShell0 && upperShell
          ? upperShell0.distanceTo(worldCenter(upperShell)) : null,
        lowerShellTravel: lowerShell0 && lowerShell
          ? lowerShell0.distanceTo(worldCenter(lowerShell)) : null,
      };

      CBZ.swimJaw(actor, 0); group.updateMatrixWorld(true);
      const hingeReset = rig.jawGroup.getWorldPosition(new THREE.Vector3());
      const tl = CBZ.biteTimeline, biteDur = CBZ.aquaticBiteDuration(actor, null);
      return {
        id, scale: sp.scale || 1, authored: contract.version >= 4,
        envelope: {
          version: contract.version, shape: contract.shape,
          bodySplit: !!contract.bodySplit, articulated: !!contract.articulatedEnvelope,
          upperShell: contract.upperShell || null, lowerShell: contract.lowerShell || null,
          upperNested: upperShell ? nestedIn(upperShell, rig.jawUpper) : null,
          lowerNested: lowerShell ? nestedIn(lowerShell, rig.jawGroup) : false,
          upperShouldMove: !!(upperShell && contract.protrude > 0),
          lipProfile: contract.lipProfile || null,
        },
        teeth: { upper: contract.upperTeeth, lower: contract.lowerTeeth },
        connected: { upper: upperClosed, lower: lowerClosed },
        hinge: { closed: xyz(hingeClosed), bodyGap: round(hingeBodyGap),
          openDrift: round(open.hingeDrift), resetDrift: round(hingeClosed.distanceTo(hingeReset)) },
        motion: { lowerAngle: round(open.lowerAngle), expectedAngle: round(open.expectedAngle),
          upperTravel: round(open.upperTravel), cavityReveal: round(open.cavityReveal),
          restLipGap: round(restLipGap), openLipGap: round(open.lipGap),
          lipProud: lipProud == null ? null : round(lipProud),
          upperShellTravel: open.upperShellTravel == null ? null : round(open.upperShellTravel),
          lowerShellTravel: open.lowerShellTravel == null ? null : round(open.lowerShellTravel) },
        cadence: {
          version: tl.version, duration: round(biteDur),
          expansionS: round((tl.fullAt - tl.openAt) * biteDur),
          holdS: round((tl.holdTo - tl.fullAt) * biteDur),
          compressionS: round((tl.shutAt - tl.holdTo) * biteDur),
          recoveryS: round((1 - tl.shutAt) * biteDur),
          atOpen: round(CBZ.biteCurve(tl.openAt)),
          atFull: round(CBZ.biteCurve(tl.fullAt)),
          atHold: round(CBZ.biteCurve(tl.holdTo)),
          atShut: round(CBZ.biteCurve(tl.shutAt)),
        },
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
    if (!r.envelope || r.envelope.shape !== "articulated-body-envelope" || !r.envelope.bodySplit || !r.envelope.lowerNested) failures.push(`${r.id}: visible lower body shell is not owned by the jaw hinge`);
    if (r.envelope && r.envelope.upperShouldMove && !r.envelope.upperNested) failures.push(`${r.id}: moving upper body shell is not owned by the upper envelope`);
    if ((/shark/.test(r.id) || r.id === "megalodon") && (!r.envelope || r.envelope.lipProfile !== "recessed-arc-seal" || !r.motion || r.motion.lipProud > 0.001)) failures.push(`${r.id}: lip tissue protrudes beyond the authored oral arc`);
    if (!r.teeth || r.teeth.upper < 12 || r.teeth.lower < 12) failures.push(`${r.id}: incomplete front-and-side tooth ring`);
    if (!r.connected || r.connected.upper.components !== 1 || r.connected.lower.components !== 1) failures.push(`${r.id}: floating/disconnected mouth component`);
    if (!r.hinge || r.hinge.bodyGap > 0.01 || r.hinge.openDrift > 0.00001 || r.hinge.resetDrift > 0.00001) failures.push(`${r.id}: lower-jaw hinge detached or drifted`);
    if (!r.motion || Math.abs(r.motion.lowerAngle - r.motion.expectedAngle) > 0.00001 || r.motion.cavityReveal < 3 || r.motion.lowerShellTravel <= 0.01 * r.scale) failures.push(`${r.id}: lower body-envelope gape contract failed`);
    if (r.motion && r.envelope.upperShouldMove && (r.motion.upperTravel <= 0 || r.motion.upperShellTravel <= 0.01 * r.scale)) failures.push(`${r.id}: upper body envelope did not travel with the bite`);
    if (r.motion && !r.envelope.upperShouldMove && r.motion.upperShellTravel != null && r.motion.upperShellTravel > 0.00001) failures.push(`${r.id}: fixed upper body moved unexpectedly`);
    if (!r.motion || r.motion.restLipGap > 0.19 * r.scale || r.motion.openLipGap < r.motion.restLipGap + 0.08 * r.scale) failures.push(`${r.id}: rest mouth is open or full gape is unreadable`);
    if (!r.cadence || r.cadence.version < 2 || r.cadence.duration < 0.82 || r.cadence.duration > 1.10 || r.cadence.expansionS < 0.20 || r.cadence.holdS < 0.15 || r.cadence.compressionS < 0.20 || r.cadence.recoveryS < 0.14 || r.cadence.atOpen !== 0 || r.cadence.atFull !== 1 || r.cadence.atHold !== 1 || r.cadence.atShut !== 0) failures.push(`${r.id}: aquatic bite cadence is incomplete or too fast to read`);
    if (!r.contact || r.contact.contractError > 0.00001 || r.contact.toothRingGap > 0.01) failures.push(`${r.id}: damage socket is outside visible tooth ring`);
    if (!r.reset || r.reset.lowerAngle > 0.00001 || r.reset.upperTravel > 0.00001 || Math.abs(r.reset.cavityScale - r.reset.expectedCavityScale) > 0.00001) failures.push(`${r.id}: mouth did not close back to authored rest`);
  }
  // This is a mouth contract, not a whole-page suite. Preserve and report
  // unrelated dirty-checkout errors, but fail only when the mouth owners (or
  // an unattributed inline script) throw.
  const contractErrors = browserErrors.filter(e => !e.url || /wildlife|creature_combat/.test(e.url));
  const unrelatedBrowserErrors = browserErrors.filter(e => !contractErrors.includes(e));
  if (contractErrors.length) failures.push(`${contractErrors.length} predator-mouth browser error(s)`);
  console.log(JSON.stringify({ predators: report, contractErrors, unrelatedBrowserErrors, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  if (ws) ws.close();
  chrome.kill("SIGTERM");
  server.kill("SIGTERM");
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
