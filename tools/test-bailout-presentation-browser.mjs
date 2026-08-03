#!/usr/bin/env node
// Focused real-Chrome contract for the parachuting presentation. It exercises
// the runtime builders and canonical character rig directly, so line topology,
// harness ownership, freefall posture, canopy posture, and first-person hands
// cannot silently fall back to the old feet-converging presentation.

import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const serverPort = 9520 + Math.floor(Math.random() * 120);
const debugPort = 10820 + Math.floor(Math.random() * 120);
const profile = `/tmp/cbz-bailout-presentation-${debugPort}`;
const captureDir = path.join(ROOT, "artifacts", "visual-comparisons", "parachute-live-player-view");
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

let ws = null;
let nextId = 1;
const pending = new Map();
const browserErrors = [];
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
async function json(expression) {
  return JSON.parse(await evaluate(`JSON.stringify(${expression})`));
}

try {
  let page = null;
  for (let i = 0; i < 120 && !page; i++) {
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
    const msg = JSON.parse(event.data);
    if (msg.method === "Runtime.exceptionThrown") {
      browserErrors.push(msg.params?.exceptionDetails?.exception?.description || msg.params?.exceptionDetails?.text || "runtime exception");
      return;
    }
    if (!msg.id || !pending.has(msg.id)) return;
    const operation = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) operation.reject(new Error(msg.error.message)); else operation.resolve(msg.result);
  });
  await send("Runtime.enable");

  let ready = false;
  for (let i = 0; i < 180 && !ready; i++) {
    ready = !!(await evaluate("!!(window.CBZ && CBZ.bootComplete && CBZ.makeCharacter && CBZ.poseSkydiver && CBZ.cityBuildChuteCanopy && CBZ.cityEnsureBailoutHarness && CBZ.cityBuildBailoutFirstPerson && CBZ.cityPoseBailoutFirstPerson)"));
    if (!ready) await sleep(250);
  }
  if (!ready) throw new Error("parachuting presentation APIs did not load");

  const result = await json(`(() => {
    const round = (value) => Number(value.toFixed(3));
    const canopy = CBZ.cityBuildChuteCanopy();
    const anchors = canopy.userData.harnessAnchors || [];
    const anchorXs = Array.from(new Set(anchors.map((point) => round(point[0]))));
    const anchorZs = Array.from(new Set(anchors.map((point) => round(point[2]))));
    const closestAnchorToFeet = Math.min(...anchors.map((point) => Math.hypot(point[0], point[1] + canopy.userData.hang, point[2])));

    const ch = CBZ.makeCharacter({
      skin: 0xb87955, torso: 0x2f6597, collar: 0x2f6597,
      arms: 0x2f6597, legs: 0x1e2a38, shoes: 0x211b18, hair: 0x302016,
    });
    const harness = CBZ.cityEnsureBailoutHarness(ch);
    for (let i = 0; i < 120; i++) CBZ.poseSkydiver(ch, { phase: "freefall", t: 1.4, opening: 0, flare: 0 }, 1 / 60);
    const freefall = {
      torsoPitch: round(ch.body.rotation.x),
      leftArmSpread: round(ch.parts.la.rotation.z),
      rightArmSpread: round(ch.parts.ra.rotation.z),
      leftThigh: round(ch.parts.ll.rotation.x),
      leftKnee: round(ch.low.ll.rotation.x),
      neck: round(ch.neck.rotation.x),
    };
    for (let i = 0; i < 120; i++) CBZ.poseSkydiver(ch, { phase: "canopy", t: 2.2, opening: 1, flare: 0 }, 1 / 60);
    const canopyPose = {
      torsoPitch: round(ch.body.rotation.x),
      leftArm: round(ch.parts.la.rotation.x),
      rightArm: round(ch.parts.ra.rotation.x),
      leftThigh: round(ch.parts.ll.rotation.x),
      leftKnee: round(ch.low.ll.rotation.x),
    };
    for (let i = 0; i < 90; i++) CBZ.poseSkydiver(ch, { phase: "canopy", t: 3.1, opening: 1, flare: 1 }, 1 / 60);
    const flare = {
      leftArm: round(ch.parts.la.rotation.x),
      rightArm: round(ch.parts.ra.rotation.x),
      leftElbow: round(ch.low.la.rotation.x),
      rightElbow: round(ch.low.ra.rotation.x),
    };

    const fp = CBZ.cityBuildBailoutFirstPerson();
    CBZ.cityPoseBailoutFirstPerson(fp, { phase: "freefall", t: 1.1, flare: 0 });
    const firstPersonFreefall = {
      risers: fp._bailoutParts.risers.visible,
      handsVisible: fp._bailoutParts.left.visible && fp._bailoutParts.right.visible,
      toggles: fp._bailoutParts.left.userData.toggle.visible || fp._bailoutParts.right.userData.toggle.visible,
    };
    CBZ.cityPoseBailoutFirstPerson(fp, { phase: "canopy", t: 1.8, flare: 0 });
    const canopyHandY = fp._bailoutParts.left.position.y;
    const firstPersonCanopy = {
      risers: fp._bailoutParts.risers.visible,
      brakeLines: fp._bailoutParts.brakeLines.visible,
      handsVisible: fp._bailoutParts.left.visible && fp._bailoutParts.right.visible,
      leftToggle: fp._bailoutParts.left.userData.toggle.visible,
      rightToggle: fp._bailoutParts.right.userData.toggle.visible,
    };
    CBZ.cityPoseBailoutFirstPerson(fp, { phase: "canopy", t: 1.8, flare: 1 });

    return {
      canopy: {
        name: canopy.name,
        cells: canopy.userData.cells,
        upperLines: canopy.userData.upperLineCount,
        risers: canopy.userData.riserCount,
        anchors: anchors.length,
        anchorXs, anchorZs,
        closestAnchorToFeet: round(closestAnchorToFeet),
      },
      harness: {
        attachedToBody: harness.root.parent === ch.body,
        torsoParts: harness.root.children.length,
        thighLoops: harness.extra.length,
      },
      freefall, canopyPose, flare,
      firstPersonFreefall, firstPersonCanopy,
      firstPersonFlareDrop: round(canopyHandY - fp._bailoutParts.left.position.y),
    };
  })()`);

  // Live player-view seam: reset the actual city, cancel its intro through the
  // normal FPS owner, then perform a real high-altitude bailout. These reads
  // verify that camera.js frames the body/canopy and fpsmode.js hands the lens
  // to the dedicated viewmodel while hiding its ordinary firearm layer.
  await evaluate(`(() => {
    CBZ.CONFIG.CONTROLS_AUTO = false;
    if (CBZ.controls && CBZ.controls.hide) CBZ.controls.hide();
    CBZ.setMode("city"); CBZ.resetGame(); CBZ.setState("playing");
    CBZ.setFPS(true);
    return true;
  })()`);
  await sleep(220);
  await evaluate(`(() => {
    CBZ.setFPS(false);
    const P = CBZ.player;
    P.dead = false; P.driving = null; P._aircraft = null;
    P.pos.set(0, 460, 0); P.vy = -20; P.grounded = false; P._fallPeak = 20;
    return true;
  })()`);
  await sleep(360);
  const liveGenericFall = await json(`(() => ({
    pose: CBZ.playerChar.skydiving && CBZ.playerChar.skydiving.phase,
    generic: !!(CBZ.playerChar.skydiving && CBZ.playerChar.skydiving.generic),
    torsoPitch: Number(CBZ.playerChar.body.rotation.x.toFixed(3)),
    harnessVisible: !!(CBZ.playerChar._bailoutHarness && CBZ.playerChar._bailoutHarness.root.visible),
  }))()`);
  await evaluate("CBZ.setFPS(true)");
  await sleep(220);
  const liveGenericFirstPerson = await json(`(() => {
    const rig = CBZ.camera.children.find((part) => part && part.userData && part.userData.bailoutFirstPerson);
    return {
      active: !!(CBZ.fps && CBZ.fps.active),
      rigVisible: !!(rig && rig.visible),
      risersVisible: !!(rig && rig._bailoutParts && rig._bailoutParts.risers.visible),
      blockHands: !!(rig && rig._bailoutParts && rig._bailoutParts.left.visible && rig._bailoutParts.right.visible),
    };
  })()`);
  const began = await evaluate(`(() => {
    CBZ.setFPS(false);
    const P = CBZ.player;
    P.dead = false; P.driving = null; P._aircraft = null;
    P.pos.set(0, 460, 0); P.vy = 0; P.grounded = false;
    if (CBZ.cam) { CBZ.cam.yaw = 0; CBZ.cam.pitch = 0.12; }
    const craft = {
      pos: new THREE.Vector3(0, 460, 0), heading: 0, speed: 42,
      vx: 0, vy: 0, vz: 42, roll: 0.04, pitch: 0, belly: 1.2,
      onGround: false, group: new THREE.Group(), pilot: null,
      airClass: "fighter", kind: "jet", mass: 11000,
    };
    window.__bailoutContractCraft = craft;
    return CBZ.cityBailOut(craft);
  })()`);
  if (!began) throw new Error("live high-altitude bailout was rejected");
  await sleep(750);

  const liveFreefall = await json(`(() => {
    const P = CBZ.player, ch = CBZ.playerChar, camera = CBZ.camera;
    camera.updateMatrixWorld(true);
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    );
    return {
      phase: CBZ.cityChuteState() && CBZ.cityChuteState().phase,
      bodyPose: ch.skydiving && ch.skydiving.phase,
      torsoPitch: Number(ch.body.rotation.x.toFixed(3)),
      bodyFramed: frustum.intersectsBox(new THREE.Box3().setFromObject(ch.group)),
      cameraDistance: Number(camera.position.distanceTo(P.pos).toFixed(3)),
      cameraHeight: Number((camera.position.y - P.pos.y).toFixed(3)),
      fov: Number(camera.fov.toFixed(2)),
      harnessVisible: !!(ch._bailoutHarness && ch._bailoutHarness.root.visible),
    };
  })()`);
  if (process.env.CBZ_CAPTURE_BAILOUT === "1") {
    await mkdir(captureDir, { recursive: true });
    const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, fromSurface: true });
    await writeFile(path.join(captureDir, "third-person-freefall.png"), Buffer.from(shot.data, "base64"));
  }

  await evaluate("CBZ.cityChuteDeploy()");
  for (let i = 0; i < 60; i++) {
    const opening = Number(await evaluate("(CBZ.cityChuteState() && CBZ.cityChuteState().opening) || 0"));
    if (opening >= 0.98) break;
    await sleep(100);
  }
  const liveCanopy = await json(`(() => {
    const P = CBZ.player, ch = CBZ.playerChar, camera = CBZ.camera;
    const canopy = CBZ.scene.children.find((part) => part && part.userData && part.userData.bailoutCanopy);
    camera.updateMatrixWorld(true);
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    );
    return {
      phase: CBZ.cityChuteState() && CBZ.cityChuteState().phase,
      opening: Number((CBZ.cityChuteState() && CBZ.cityChuteState().opening || 0).toFixed(3)),
      bodyPose: ch.skydiving && ch.skydiving.phase,
      canopyVisible: !!(canopy && canopy.visible),
      canopyFramed: !!(canopy && frustum.intersectsBox(new THREE.Box3().setFromObject(canopy))),
      bodyFramed: frustum.intersectsBox(new THREE.Box3().setFromObject(ch.group)),
      cameraDistance: Number(camera.position.distanceTo(P.pos).toFixed(3)),
      cameraHeight: Number((camera.position.y - P.pos.y).toFixed(3)),
      fov: Number(camera.fov.toFixed(2)),
    };
  })()`);
  if (process.env.CBZ_CAPTURE_BAILOUT === "1") {
    const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, fromSurface: true });
    await writeFile(path.join(captureDir, "third-person-canopy.png"), Buffer.from(shot.data, "base64"));
  }

  await evaluate("CBZ.setFPS(true)");
  await sleep(320);
  const liveFirstPerson = await json(`(() => {
    const P = CBZ.player, camera = CBZ.camera;
    const rig = camera.children.find((part) => part && part.userData && part.userData.bailoutFirstPerson);
    let weaponRoot = CBZ.fpsWeaponModels && CBZ.fpsWeaponModels[0];
    while (weaponRoot && weaponRoot.parent && weaponRoot.parent !== camera) weaponRoot = weaponRoot.parent;
    return {
      active: !!(CBZ.fps && CBZ.fps.active),
      worldBodyHidden: !CBZ.playerChar.group.visible,
      rigVisible: !!(rig && rig.visible),
      risersVisible: !!(rig && rig._bailoutParts && rig._bailoutParts.risers.visible),
      weaponViewmodelVisible: !!(weaponRoot && weaponRoot.visible),
      crosshairDisplay: document.getElementById("crosshair")?.style.display || "",
      cameraEyeHeight: Number((camera.position.y - P.pos.y).toFixed(3)),
    };
  })()`);
  if (process.env.CBZ_CAPTURE_BAILOUT === "1") {
    const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, fromSurface: true });
    await writeFile(path.join(captureDir, "first-person-canopy.png"), Buffer.from(shot.data, "base64"));
  }

  const failures = [];
  if (result.canopy.name !== "bailout-ram-air-canopy" || result.canopy.cells !== 13)
    failures.push("canopy was not the authored ram-air cell wing");
  if (result.canopy.upperLines !== 20 || result.canopy.risers !== 4 || result.canopy.anchors !== 4)
    failures.push("suspension topology was not 20 upper lines cascaded into four risers");
  if (result.canopy.anchorXs.length !== 2 || result.canopy.anchorZs.length !== 2 || result.canopy.closestAnchorToFeet < 1.25)
    failures.push("riser anchors collapsed back toward one foot-level point");
  if (!result.harness.attachedToBody || result.harness.torsoParts < 8 || result.harness.thighLoops !== 2)
    failures.push("harness did not remain player-owned with torso webbing and two leg loops");
  if (!(result.freefall.torsoPitch > 1 && result.freefall.leftArmSpread > 0.95 && result.freefall.rightArmSpread < -0.95 && result.freefall.leftKnee > 0.8))
    failures.push("freefall did not settle into the belly-to-earth box pose");
  if (!(result.canopyPose.leftArm < -2.2 && result.canopyPose.rightArm < -2.2 && result.canopyPose.leftThigh < -0.9 && result.canopyPose.leftKnee > 1.1))
    failures.push("open-canopy body did not hang seated with hands on risers");
  if (!(result.flare.leftArm > result.canopyPose.leftArm + 0.8 && result.flare.rightArm > result.canopyPose.rightArm + 0.8))
    failures.push("third-person flare did not pull both toggles down");
  if (result.firstPersonFreefall.risers || result.firstPersonFreefall.toggles || !result.firstPersonFreefall.handsVisible)
    failures.push("first-person freefall did not show two block hands without canopy controls");
  if (!result.firstPersonCanopy.risers || !result.firstPersonCanopy.brakeLines || !result.firstPersonCanopy.leftToggle || !result.firstPersonCanopy.rightToggle || !result.firstPersonCanopy.handsVisible)
    failures.push("first-person canopy did not put both hands on two riser/toggle groups");
  if (!(result.firstPersonFlareDrop > 0.25)) failures.push("first-person flare did not pull both hands down");
  if (liveGenericFall.pose !== "freefall" || !liveGenericFall.generic || liveGenericFall.torsoPitch < 0.75 || liveGenericFall.harnessVisible)
    failures.push("ordinary long fall did not claim the shared freefall pose without inventing a harness");
  if (!liveGenericFirstPerson.active || !liveGenericFirstPerson.rigVisible || liveGenericFirstPerson.risersVisible || !liveGenericFirstPerson.blockHands)
    failures.push("ordinary long fall did not show first-person block hands without canopy risers");
  if (liveFreefall.phase !== "freefall" || liveFreefall.bodyPose !== "freefall" || !liveFreefall.bodyFramed || !liveFreefall.harnessVisible || liveFreefall.torsoPitch < 1)
    failures.push("live third-person freefall did not publish and frame the authored body/harness pose");
  if (!(liveFreefall.cameraDistance > 5 && liveFreefall.cameraDistance < 10 && liveFreefall.cameraHeight > 0.5))
    failures.push("live third-person freefall camera did not use the skydiving boom");
  if (liveCanopy.phase !== "canopy" || liveCanopy.opening < 0.95 || liveCanopy.bodyPose !== "canopy" || !liveCanopy.canopyVisible || !liveCanopy.canopyFramed || !liveCanopy.bodyFramed)
    failures.push("live third-person canopy did not fully open and frame both player and wing");
  if (!(liveCanopy.cameraDistance > 8 && liveCanopy.cameraDistance < 15 && liveCanopy.cameraHeight > 2.5 && liveCanopy.fov > 62))
    failures.push("live third-person canopy camera did not use the wider full-rig framing");
  if (!liveFirstPerson.active || !liveFirstPerson.worldBodyHidden || !liveFirstPerson.rigVisible || !liveFirstPerson.risersVisible || liveFirstPerson.weaponViewmodelVisible || liveFirstPerson.crosshairDisplay !== "none")
    failures.push("live first-person handoff did not show the parachute rig alone");
  if (browserErrors.length) failures.push(`${browserErrors.length} uncaught browser error(s)`);

  console.log(JSON.stringify({ ...result, liveGenericFall, liveGenericFirstPerson, liveFreefall, liveCanopy, liveFirstPerson, browserErrors, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  if (ws) ws.close();
  chrome.kill("SIGTERM");
  server.kill("SIGTERM");
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
