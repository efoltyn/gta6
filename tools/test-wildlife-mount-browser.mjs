#!/usr/bin/env node
// Focused real-Chrome contract for mounted wildlife. One live rideable actor is
// enough to prove the ownership seam: physics moves one root, wildlife supplies
// gait/jump, and the human rig remains seated on the authored saddle socket.

import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const serverPort = 9440 + Math.floor(Math.random() * 120);
const debugPort = 10640 + Math.floor(Math.random() * 120);
const profile = `/tmp/cbz-wildlife-mount-${debugPort}`;
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
      browserErrors.push(msg.params?.exceptionDetails?.exception?.description || msg.params?.exceptionDetails?.text || "runtime exception");
      return;
    }
    if (!msg.id || !pending.has(msg.id)) return;
    const p = pending.get(msg.id); pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
  });
  await send("Runtime.enable");

  let ready = false;
  for (let i = 0; i < 180 && !ready; i++) {
    ready = !!(await evaluate("!!(window.CBZ && CBZ.bootComplete && CBZ.resetGame && CBZ.cityMountAnimal && CBZ.cityRideVisualSpec && CBZ.playerChar && CBZ.stepSim)"));
    if (!ready) await sleep(250);
  }
  if (!ready) throw new Error("mounted-wildlife APIs did not load");

  // This contract reads live transforms and gait, not pixels. Keep the update
  // loop but remove software-GPU drawing so the result is fast and stable.
  await evaluate(`(() => {
    if (CBZ.renderer && CBZ.renderer.render && !CBZ.renderer.__mountContractNoDraw) {
      CBZ.renderer.render = function () {};
      CBZ.renderer.__mountContractNoDraw = true;
    }
    if (CBZ.CONFIG) {
      CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false;
      CBZ.CONFIG.CITY_SCENE_DIRECTOR = false;
    }
    CBZ.setMode("city"); CBZ.resetGame(); CBZ.setState("playing");
    return true;
  })()`);

  let candidate = false;
  for (let i = 0; i < 120 && !candidate; i++) {
    candidate = !!(await evaluate(`(CBZ.cityWildlife || []).some(function (a) {
      return a && !a.dead && !a.external && a.gait && CBZ.cityCanRideAnimal(a);
    })`));
    if (!candidate) await sleep(250);
  }
  if (!candidate) throw new Error("city did not produce a live rideable wildlife actor");

  const mounted = await json(`(() => {
    const list = (CBZ.cityWildlife || []).filter(function (a) {
      return a && !a.dead && !a.external && a.gait && CBZ.cityCanRideAnimal(a);
    });
    // Bison exercises the hard socket: a wide body plus a forward hump means
    // the seated point has a real rearward X offset. Horse remains fallback.
    const preferred = ["bison", "horse", "zebra", "moose"];
    const a = list.sort(function (x, y) {
      const xi = preferred.indexOf(x.species.id), yi = preferred.indexOf(y.species.id);
      return (xi < 0 ? 99 : xi) - (yi < 0 ? 99 : yi);
    })[0];
    if (!a) return { ok: false };
    a.tamed = true; a.dead = false; a.grow = null; a.stay = false;
    a.group.visible = true;
    const P = CBZ.player, floor = CBZ.floorAt ? (+CBZ.floorAt(a.pos.x, a.pos.z) || 0) : 0;
    P.dead = false; P.ko = 0; P.stun = 0; P.driving = null;
    P.pos.set(a.pos.x + 0.5, floor, a.pos.z);
    P.vy = 0; P.grounded = true;
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(P.pos);
    const ok = CBZ.cityMountAnimal(a);
    window.__mountContract = { actor: a, gait0: a.gait.step || 0 };
    return { ok: !!ok, species: a.species.id };
  })()`);
  if (!mounted.ok) throw new Error("cityMountAnimal rejected the prepared tame actor");
  await sleep(550);

  const idle = await json(`(() => {
    const a = window.__mountContract.actor, P = CBZ.player, ch = CBZ.playerChar;
    const hip = new THREE.Vector3(), rightHip = new THREE.Vector3();
    ch.parts.ll.getWorldPosition(hip); ch.parts.rl.getWorldPosition(rightHip); hip.add(rightHip).multiplyScalar(0.5);
    const spec = CBZ.cityRideVisualSpec(a);
    const h = a.faceH == null ? a.heading : a.faceH;
    const sx = a.group.position.x + Math.cos(h) * spec.x;
    const sz = a.group.position.z + Math.sin(h) * spec.x;
    return {
      mounted: CBZ.cityMountedAnimal() === a && P._mountedAnimal === a && a.ridden === true,
      species: a.species.id,
      rootXZ: Math.hypot(a.group.position.x - P.pos.x, a.group.position.z - P.pos.z),
      rootY: Math.abs(a.group.position.y - P.pos.y),
      hipSocketError: Math.abs(hip.y - (a.group.position.y + spec.y)),
      hipSocketXZError: Math.hypot(hip.x - sx, hip.z - sz),
      rider: !!ch.riding,
      leftSpread: ch.parts.ll.rotation.z,
      rightSpread: ch.parts.rl.rotation.z,
      leftThigh: ch.parts.ll.rotation.x,
      leftKnee: ch.low.ll.rotation.x,
      width: spec.width,
      jump: spec.jump,
    };
  })()`);

  await evaluate(`(() => {
    const a = window.__mountContract.actor;
    window.__mountContract.x0 = CBZ.player.pos.x;
    window.__mountContract.z0 = CBZ.player.pos.z;
    window.__mountContract.gait0 = a.gait.step || 0;
    CBZ.cam.yaw = 0;
    CBZ.keys.w = true;
    return true;
  })()`);
  await sleep(1100);

  const travel = await json(`(() => {
    const q = window.__mountContract, a = q.actor, P = CBZ.player, ch = CBZ.playerChar;
    return {
      distance: Math.hypot(P.pos.x - q.x0, P.pos.z - q.z0),
      animalRootError: Math.hypot(a.group.position.x - P.pos.x, a.group.position.z - P.pos.z),
      gaitDelta: (a.gait.step || 0) - q.gait0,
      motionMoved: a._motionMoved || 0,
      motionAlignment: a._motionAlignment,
      riderWalking: !(ch.riding && ch.parts.ll.rotation.x < -0.75 && ch.low.ll.rotation.x > 0.75),
      stillMounted: CBZ.cityMountedAnimal() === a,
    };
  })()`);
  await evaluate("CBZ.keys.w = false");
  await sleep(120);

  await evaluate(`(() => {
    const a = window.__mountContract.actor;
    window.__mountContract.groundY = CBZ.player.pos.y;
    window.__mountContract.animalGroundY = a.group.position.y;
    CBZ.keys[" "] = true;
    return true;
  })()`);
  await sleep(130);
  await evaluate("CBZ.keys[' '] = false");

  const airborne = await json(`(() => {
    const q = window.__mountContract, a = q.actor, P = CBZ.player, ch = CBZ.playerChar;
    const hip = new THREE.Vector3(), rightHip = new THREE.Vector3();
    ch.parts.ll.getWorldPosition(hip); ch.parts.rl.getWorldPosition(rightHip); hip.add(rightHip).multiplyScalar(0.5);
    const spec = CBZ.cityRideVisualSpec(a);
    const h = a.faceH == null ? a.heading : a.faceH;
    const sx = a.group.position.x + Math.cos(h) * spec.x;
    const sz = a.group.position.z + Math.sin(h) * spec.x;
    return {
      grounded: P.grounded,
      vy: P.vy,
      playerRise: P.pos.y - q.groundY,
      animalRise: a.group.position.y - q.animalGroundY,
      animalRootYError: Math.abs(a.group.position.y - P.pos.y),
      hipSocketError: Math.abs(hip.y - (a.group.position.y + spec.y)),
      hipSocketXZError: Math.hypot(hip.x - sx, hip.z - sz),
      riderAirbornePose: !!(ch.riding && ch.riding.airborne),
      stillMounted: CBZ.cityMountedAnimal() === a,
    };
  })()`);

  await sleep(1200);
  const landed = await json(`(() => {
    const a = window.__mountContract.actor, P = CBZ.player;
    const out = {
      grounded: P.grounded,
      vy: P.vy,
      rootError: Math.hypot(a.group.position.x - P.pos.x, a.group.position.z - P.pos.z),
      stillMounted: CBZ.cityMountedAnimal() === a,
    };
    CBZ.cityDismount();
    out.dismounted = !CBZ.cityMountedAnimal() && !P._mountedAnimal && !CBZ.playerChar.riding && !a.ridden;
    return out;
  })()`);

  const failures = [];
  if (!idle.mounted || !idle.rider) failures.push("mount ownership flags were not published");
  if (idle.rootXZ > 0.03 || idle.rootY > 0.03) failures.push("animal did not share the physical player root at rest");
  if (idle.hipSocketError > 0.035 || idle.hipSocketXZError > 0.035) failures.push("rider hips missed the animal saddle socket");
  if (!(idle.leftSpread < -0.32 && idle.rightSpread > 0.32 && idle.leftThigh < -0.75 && idle.leftKnee > 0.75))
    failures.push("rider did not settle into the legs-around-flanks pose");
  if (!(travel.distance > 1 && travel.gaitDelta > 0.05 && travel.motionMoved > 0 && travel.motionAlignment > 0.8))
    failures.push("movement did not read as aligned animal gait");
  if (travel.animalRootError > 0.03 || travel.riderWalking || !travel.stillMounted)
    failures.push("rider separated or returned to a human walk while travelling");
  if (airborne.grounded || !(airborne.vy > 0) || !(airborne.playerRise > 0.05) || !(airborne.animalRise > 0.05))
    failures.push("mounted jump did not lift the shared animal root");
  if (airborne.animalRootYError > 0.03 || airborne.hipSocketError > 0.035 || airborne.hipSocketXZError > 0.035 || !airborne.riderAirbornePose || !airborne.stillMounted)
    failures.push("animal and seated rider separated in the air");
  if (!landed.grounded || Math.abs(landed.vy) > 0.05 || landed.rootError > 0.03 || !landed.stillMounted)
    failures.push("mount did not land as one still-mounted assembly");
  if (!landed.dismounted) failures.push("dismount did not clear ownership state");
  if (browserErrors.length) failures.push(`${browserErrors.length} uncaught browser error(s)`);

  console.log(JSON.stringify({ mounted, idle, travel, airborne, landed, browserErrors, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  if (ws) ws.close();
  chrome.kill("SIGTERM");
  server.kill("SIGTERM");
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
