#!/usr/bin/env node
// Focused real-Chrome contract for the sea-mount loop. It exercises the exact
// iPad world-pick seam, one ballistic dolphin breach/re-entry, one shark bite,
// and one megalodon-to-ship bite. This is intentionally not a broad game test.

import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const serverPort = 9520 + Math.floor(Math.random() * 100);
const debugPort = 10720 + Math.floor(Math.random() * 100);
const profile = `/tmp/cbz-aquatic-mount-${debugPort}`;
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
  "--window-size=1024,720", `--remote-debugging-port=${debugPort}`,
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

  const ready = await poll(`!!(window.CBZ && CBZ.bootComplete && CBZ.resetGame &&
    CBZ.cityTapWorld && CBZ.cityMountAnimal && CBZ.cityAquaticMountStep &&
    CBZ.cityMountedAnimalAttack && CBZ.aquaticMountAudit && CBZ.waterField &&
    CBZ.aquaticBiteDuration && CBZ.biteTimeline && CBZ.biteTimeline.version >= 2)`, 45000, 250);
  if (!ready) throw new Error("aquatic-mount APIs did not load");

  await evaluate(`(() => {
    if (CBZ.renderer && CBZ.renderer.render && !CBZ.renderer.__seaMountContractNoDraw) {
      CBZ.renderer.render = function () {};
      CBZ.renderer.__seaMountContractNoDraw = true;
    }
    if (CBZ.CONFIG) {
      CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false;
      CBZ.CONFIG.CITY_SCENE_DIRECTOR = false;
    }
    CBZ.setMode("city"); CBZ.resetGame(); CBZ.setState("playing");
    return true;
  })()`);

  const actorsReady = await poll(`(() => {
    const ids = new Set((CBZ.cityWildlife || []).filter(a => a && !a.dead).map(a => a.species && a.species.id));
    return ids.has("dolphin") && ids.has("great_white_shark") && ids.has("megalodon") && ids.has("tuna");
  })()`, 35000, 250);
  if (!actorsReady) throw new Error("city did not produce the four aquatic contract actors");

  // Project the real dolphin mesh into screen space and invoke touch.js's exact
  // world-tap hook. No private mount call is used for this first mount.
  const tapped = await json(`(() => {
    const byId = id => (CBZ.cityWildlife || []).find(a => a && !a.dead && a.species && a.species.id === id);
    const dolphin = byId("dolphin"), shark = byId("great_white_shark"), meg = byId("megalodon"), tuna = byId("tuna");
    let seed = 0x51ea9, wet = null;
    const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < 8 && !wet; i++) {
      const p = CBZ.waterField.randomWaterPoint(rng, { cx: 0, cz: -700, r0: 700, r1: 1800, clearance: 180 });
      if (p && CBZ.waterField.isSurfaceWater(p.x, p.z, 0)) wet = { x: p.x, z: p.z };
    }
    if (!wet) wet = { x: dolphin.pos.x, z: dolphin.pos.z };
    const surf = CBZ.citySeaHeightAt(wet.x, wet.z);
    dolphin.group.visible = true; dolphin.grow = null; dolphin.ridden = false;
    dolphin.group.position.set(wet.x, surf - (dolphin.swimDepth || 1), wet.z);
    dolphin.heading = dolphin.faceH = 0; CBZ.faceAnimalHeading(dolphin, 0);
    dolphin.group.traverse(o => { o.matrixAutoUpdate = true; });
    for (const a of (CBZ.cityWildlife || [])) if (a !== dolphin) a.group.visible = false;
    const P = CBZ.player;
    P.dead = false; P.ko = 0; P.stun = 0; P.driving = null; P._aircraft = null;
    P.pos.set(wet.x, surf - 0.25, wet.z + 0.4); P.vy = 0; P.grounded = false;
    const box = new THREE.Box3().setFromObject(dolphin.group);
    const center = box.getCenter(new THREE.Vector3());
    CBZ.camera.position.set(center.x - 8, center.y + 4.5, center.z + 7);
    CBZ.camera.lookAt(center); CBZ.camera.updateMatrixWorld(true); CBZ.camera.updateProjectionMatrix();
    const ndc = center.clone().project(CBZ.camera);
    const rect = CBZ.renderer.domElement.getBoundingClientRect();
    const sx = rect.left + (ndc.x + 1) * rect.width * 0.5;
    const sy = rect.top + (1 - ndc.y) * rect.height * 0.5;
    const hit = CBZ.cityTapWorld(sx, sy);
    window.__seaMountContract = { dolphin, shark, meg, tuna, wet, surf, dolphinY0: dolphin.group.position.y };
    const audit = CBZ.aquaticMountAudit();
    const authoredAquatics = Object.values(CBZ.WILDLIFE_SPECIES || {}).filter(sp => sp && sp.aquatic).length;
    return {
      hit: !!hit, mounted: CBZ.cityMountedAnimal() === dolphin,
      mountedSpecies: audit.mountedSpecies, rideableSpecies: audit.rideableSpecies,
      authoredAquatics, breachCap: !!CBZ.cityRideDefinition(dolphin.species).breach,
      screen: [Math.round(sx), Math.round(sy)], ndc: [ndc.x, ndc.y],
    };
  })()`);

  await evaluate(`(() => {
    const q = window.__seaMountContract;
    q.breach0 = CBZ.aquaticMountAudit().breaches;
    q.reentry0 = CBZ.aquaticMountAudit().reentries;
    q.apexY = q.dolphin.group.position.y;
    CBZ.cam.yaw = -Math.PI / 2;
    CBZ.keys.w = true; CBZ.keys.shift = true; CBZ.keys[" "] = true;
    return true;
  })()`);
  const breached = await poll(`(() => {
    const q = window.__seaMountContract, a = CBZ.aquaticMountAudit();
    q.apexY = Math.max(q.apexY, q.dolphin.group.position.y);
    return a.breaches > q.breach0;
  })()`, 3500, 35);
  await evaluate(`CBZ.keys[" "] = false`);

  // Sample the whole arc so "huge" means measured altitude, not a flag flip.
  const reentered = await poll(`(() => {
    const q = window.__seaMountContract, a = CBZ.aquaticMountAudit();
    q.apexY = Math.max(q.apexY, q.dolphin.group.position.y);
    return a.reentries > q.reentry0 && !a.airborne;
  })()`, 5000, 35);
  await evaluate(`CBZ.keys.w = false; CBZ.keys.shift = false`);

  const dolphin = await json(`(() => {
    const q = window.__seaMountContract, a = q.dolphin, ch = CBZ.playerChar;
    const audit = CBZ.aquaticMountAudit();
    const spec = audit.saddle || CBZ.cityRideVisualSpec(a);
    const seat = new THREE.Vector3(spec.x, spec.y, 0).applyEuler(a.group.rotation).add(a.group.position);
    const lh = new THREE.Vector3(), rh = new THREE.Vector3();
    ch.parts.ll.getWorldPosition(lh); ch.parts.rl.getWorldPosition(rh); lh.add(rh).multiplyScalar(0.5);
    const out = {
      breached: ${breached ? "true" : "false"}, reentered: ${reentered ? "true" : "false"},
      rise: q.apexY - q.dolphinY0, breaches: audit.breaches - q.breach0,
      reentries: audit.reentries - q.reentry0, airborne: audit.airborne,
      socketError: lh.distanceTo(seat), stillMounted: CBZ.cityMountedAnimal() === a,
      riderAquaticPose: !!(ch.riding && ch.riding.aquatic), speed: audit.speed,
      socket: seat.toArray(), hips: lh.toArray(),
      placedSocket: audit.placedSocket,
      animalRoot: a.group.position.toArray(), animalRotation: a.group.rotation.toArray().slice(0, 3),
      playerRoot: CBZ.player.pos.toArray(),
      charRoot: ch.group.position.toArray(), charRotation: ch.group.rotation.toArray().slice(0, 3),
      modelPosition: ch.model.position.toArray(), modelRotation: ch.model.rotation.toArray().slice(0, 3),
      modelScale: ch.model.scale.toArray(), hipY: ch.hipY,
    };
    CBZ.cityDismount();
    return out;
  })()`);
  await sleep(120);
  dolphin.swimHandoff = await json(`({ swimming: CBZ.citySwimming(), playerSwim: !!CBZ.player._swim,
    mounted: !!CBZ.cityMountedAnimal(), aquaticMount: !!CBZ.player._aquaticMount,
    x: CBZ.player.pos.x, y: CBZ.player.pos.y, z: CBZ.player.pos.z,
    surface: CBZ.citySeaHeightAt(CBZ.player.pos.x, CBZ.player.pos.z),
    depth: CBZ.cityWaterDepthAt(CBZ.player.pos.x, CBZ.player.pos.z),
    water: CBZ.cityWaterAt(CBZ.player.pos.x, CBZ.player.pos.z) })`);

  // The great white attacks another live aquatic actor through the shared
  // wildlife damage owner. Position by actual bounding boxes at the real jaw.
  const sharkStart = await json(`(() => {
    const q = window.__seaMountContract, a = q.shark, prey = q.tuna, surf = CBZ.citySeaHeightAt(q.wet.x, q.wet.z);
    for (const x of (CBZ.cityWildlife || [])) x.group.visible = (x === a || x === prey);
    a.dead = false; a.grow = null; a.group.visible = true; a.group.position.set(q.wet.x, surf - (a.swimDepth || 1), q.wet.z);
    a.heading = a.faceH = 0; CBZ.faceAnimalHeading(a, 0);
    CBZ.player.pos.set(a.pos.x, a.pos.y, a.pos.z); CBZ.player.dead = false;
    const mounted = CBZ.cityMountAnimal(a);
    q.sharkHp0 = prey.hp = prey.maxHp || 55; prey.dead = false; prey.grow = null; prey.ridden = true; prey.group.visible = true;
    // Keep the live target inside the active water cell while the mount owner
    // settles.  Leaving it at its original ambient spawn for this 140 ms gap
    // let wildlife cleanup detach the group before the exact jaw placement,
    // turning a geometry contract into a timing-dependent null target.
    prey.group.position.set(a.pos.x + 1.5, a.pos.y, a.pos.z);
    if (!prey.group.parent && CBZ.scene) CBZ.scene.add(prey.group);
    prey.group.traverse(o => { o.matrixAutoUpdate = true; });
    q.sharkHits0 = CBZ.aquaticMountAudit().hits;
    return { mounted: !!mounted, attackCap: !!CBZ.cityRideDefinition(a.species).attack };
  })()`);
  await sleep(140);
  await evaluate(`(() => {
    const q = window.__seaMountContract, a = q.shark, prey = q.tuna;
    if (!prey.group.parent && CBZ.scene) CBZ.scene.add(prey.group);
    prey.heading = prey.faceH = 0; CBZ.faceAnimalHeading(prey, 0);
    prey.group.updateMatrixWorld(true);
    const jp = CBZ.creatureJawPoint(a), mouth = new THREE.Vector3(jp.x, jp.y, jp.z);
    a.group.updateMatrixWorld(true); mouth.applyMatrix4(a.group.matrixWorld);
    let hull = null;
    prey.group.traverse(o => { if (!hull && o.isMesh && /hull$/i.test(o.name || "")) hull = o; });
    const box = new THREE.Box3().setFromObject(hull || prey.group), center = box.getCenter(new THREE.Vector3());
    // The mounted bite accelerates to ~8.5 m/s and resolves contact inside the
    // shared 0.82–1.10 s aquatic cadence. Lead the live target by the measured
    // approach distance; placing it only 0.35 m from the resting socket let
    // the surge pass the tuna before the first legal contact sample.
    // Align the structural fish hull, not fin tips: mounted contact now uses
    // that same oriented hull narrow phase, so the test must not centre an
    // ornamental filament and call the edible body aligned.
    prey.group.position.add(new THREE.Vector3(mouth.x + 2.65, mouth.y, mouth.z).sub(center));
    prey.group.updateMatrixWorld(true);
    const hullBox = new THREE.Box3().setFromObject(hull || prey.group);
    const hullCenter = hullBox.getCenter(new THREE.Vector3());
    const hullNear = hullBox.clampPoint(mouth, new THREE.Vector3());
    const probe = CBZ.cityAquaticBiteProbe();
    q.sharkProbe = { kind: probe && probe.kind, d: probe && probe.d,
      heading: a.heading, mountedHeading: CBZ.cityMountedHeading && CBZ.cityMountedHeading(),
      mouth: mouth.toArray(), hullCenter: hullCenter.toArray(), hullNear: hullNear.toArray(),
      hullGap: hullNear.distanceTo(mouth), preyPos: [prey.pos.x, prey.pos.y, prey.pos.z],
      groupPos: prey.group.position.toArray() };
    const consumed = CBZ.cityMountedAnimalAttack(true);
    q.sharkAttackStart = CBZ.aquaticMountAudit();
    return consumed;
  })()`);
  const sharkHit = await poll(`CBZ.aquaticMountAudit().hits > window.__seaMountContract.sharkHits0`, 1800, 35);
  const sharkClenched = await poll(`(() => {
    const q = window.__seaMountContract;
    return q.shark && q.shark.swim && q.shark._atkAnim > 0 && q.shark.swim.jawK <= 0.16;
  })()`, 700, 20);
  const shark = await json(`(() => {
    const q = window.__seaMountContract, audit = CBZ.aquaticMountAudit();
    const out = { hit: ${sharkHit ? "true" : "false"}, damage: q.sharkHp0 - q.tuna.hp,
      clenchedAfterContact: ${sharkClenched ? "true" : "false"}, target: audit.lastTarget,
      attacks: audit.attacks, stillMounted: CBZ.cityMountedAnimal() === q.shark,
      contactGap: audit.biteContactGap, penetration: audit.bitePenetration,
      collider: audit.biteCollider,
      seatError: audit.biteSeatError, seatBelowJaw: audit.biteSeatBelowJaw,
      seatFrames: audit.biteSeatFrames, surfaceStops: audit.surfaceStops };
    out.attackStart = q.sharkAttackStart;
    out.probe = q.sharkProbe;
    CBZ.cityDismount(); return out;
  })()`);
  await sleep(100);

  // The megalodon uses the same bite action, but the target grammar admits
  // marine vehicles and hands a gutted hull to the existing sinking owner.
  const megStart = await json(`(() => {
    const q = window.__seaMountContract, a = q.meg, surf = CBZ.citySeaHeightAt(q.wet.x, q.wet.z);
    for (const x of (CBZ.cityWildlife || [])) x.group.visible = (x === a);
    a.dead = false; a.grow = null; a.group.visible = true; a.group.position.set(q.wet.x, surf - (a.swimDepth || 2.2), q.wet.z);
    a.heading = a.faceH = 0; CBZ.faceAnimalHeading(a, 0);
    CBZ.player.pos.set(a.pos.x, a.pos.y, a.pos.z); CBZ.player.dead = false;
    const mounted = CBZ.cityMountAnimal(a);
    let ship = (CBZ.cityCars || []).find(c => c && !c.dead && c.model && c.model.body === "boat");
    if (!ship) {
      const model = CBZ.cityEcon && CBZ.cityEcon.carByName("Speedboat");
      ship = CBZ.cityMakeCar(q.wet.x + 12, q.wet.z, 0, false, model, 0);
    }
    ship.dead = false; ship._exploded = false; ship.engineHp = 100; ship.ai = false; ship.player = false;
    ship.group.visible = true; ship.group.traverse(o => { o.matrixAutoUpdate = true; });
    q.ship = ship; q.shipBites0 = CBZ.aquaticMountAudit().shipBites;
    return { mounted: !!mounted, shipBiteCap: !!CBZ.cityRideDefinition(a.species).shipBite,
      marine: !!(ship.model && ship.model.body === "boat") };
  })()`);
  await sleep(160);
  await evaluate(`(() => {
    const q = window.__seaMountContract, a = q.meg, ship = q.ship;
    const jp = CBZ.creatureJawPoint(a), mouth = new THREE.Vector3(jp.x, jp.y, jp.z);
    a.group.updateMatrixWorld(true); mouth.applyMatrix4(a.group.matrixWorld);
    const box = new THREE.Box3().setFromObject(ship.group), center = box.getCenter(new THREE.Vector3());
    ship.group.position.add(new THREE.Vector3(mouth.x + 0.8, mouth.y, mouth.z).sub(center));
    ship.group.updateMatrixWorld(true);
    const consumed = CBZ.cityMountedAnimalAttack(true);
    q.megAttackStart = CBZ.aquaticMountAudit();
    return consumed;
  })()`);
  const shipHit = await poll(`CBZ.aquaticMountAudit().shipBites > window.__seaMountContract.shipBites0`, 2200, 35);
  const megClenched = await poll(`(() => {
    const q = window.__seaMountContract;
    return q.meg && q.meg.swim && q.meg._atkAnim > 0 && q.meg.swim.jawK <= 0.16;
  })()`, 850, 20);
  // water_float deliberately throttles new wreck adoption to a 0.45 s scan;
  // wait for that owner rather than sampling early and merely assuming the
  // dead marine record will eventually become a physical sinking hull.
  const shipSinking = await poll(`!!window.__seaMountContract.ship._waterFloat`, 1200, 40);
  const megalodon = await json(`(() => {
    const q = window.__seaMountContract, ship = q.ship, audit = CBZ.aquaticMountAudit();
    const out = { hit: ${shipHit ? "true" : "false"}, engineHp: ship.engineHp, dead: !!ship.dead,
      exploded: !!ship._exploded, sinkingOwned: ${shipSinking ? "true" : "false"},
      clenchedAfterContact: ${megClenched ? "true" : "false"}, target: audit.lastTarget,
      shipBites: audit.shipBites - q.shipBites0, stillMounted: CBZ.cityMountedAnimal() === q.meg };
    out.attackStart = q.megAttackStart;
    CBZ.cityDismount(); return out;
  })()`);

  const failures = [];
  if (!tapped.hit || !tapped.mounted || tapped.mountedSpecies !== "dolphin") failures.push("iPad world press did not mount the rendered dolphin");
  if (tapped.rideableSpecies !== tapped.authoredAquatics) failures.push("not every aquatic species inherited the generated ride capability");
  if (!tapped.breachCap) failures.push("dolphin lacks the breach capability");
  if (!dolphin.breached || !dolphin.reentered || dolphin.rise < 4.0) failures.push("dolphin did not complete a huge ballistic breach and re-entry");
  if (dolphin.socketError > 0.08 || !dolphin.stillMounted || !dolphin.riderAquaticPose) failures.push("rider detached from the dolphin during the breach loop");
  if (!dolphin.swimHandoff.swimming || !dolphin.swimHandoff.playerSwim || dolphin.swimHandoff.mounted || dolphin.swimHandoff.aquaticMount) failures.push("dismount did not hand ownership back to swimming");
  if (!shark.attackStart || shark.attackStart.attackDuration < 0.82 || shark.attackStart.attackDuration > 1.10 || shark.attackStart.attackCooldown - shark.attackStart.attackDuration < 0.40) failures.push("mounted great white bypassed the shared bite cadence or recovery beat");
  if (!sharkStart.mounted || !sharkStart.attackCap || !shark.hit || shark.damage <= 0 || !shark.clenchedAfterContact || shark.target !== "animal" || !shark.stillMounted) failures.push("mounted great white did not visibly clamp after biting a live target");
  if (shark.collider !== "marine-hull-obb" || shark.contactGap > 0.30 || shark.penetration > 0.08 || shark.seatError > 0.02 ||
      shark.seatBelowJaw < 0.04 || shark.seatFrames < 3 || shark.surfaceStops < 1) {
    failures.push("mounted great white bypassed tooth-surface stop or did not hold the contacted prey surface in the lower mouth through compression");
  }
  if (!megalodon.attackStart || megalodon.attackStart.attackDuration < 0.92 || megalodon.attackStart.attackDuration > 1.10 || megalodon.attackStart.attackCooldown - megalodon.attackStart.attackDuration < 0.53) failures.push("mounted megalodon bypassed the hull-bite cadence or recovery beat");
  if (!megStart.mounted || !megStart.shipBiteCap || !megStart.marine || !megalodon.hit || megalodon.engineHp > 0 || !megalodon.dead || megalodon.exploded || !megalodon.sinkingOwned || !megalodon.clenchedAfterContact || megalodon.target !== "ship" || !megalodon.stillMounted) failures.push("megalodon did not clamp and hand a ship to sinking physics without an explosion");
  const contractErrors = browserErrors.filter(e => !e.url || !/\/systems\/camera\.js(?:\?|$)/.test(e.url));
  const unrelatedBrowserErrors = browserErrors.filter(e => !contractErrors.includes(e));
  if (contractErrors.length) failures.push(`${contractErrors.length} aquatic-mount browser error(s)`);

  console.log(JSON.stringify({ tapped, dolphin, sharkStart, shark, megStart, megalodon,
    contractErrors, unrelatedBrowserErrors, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  if (ws) ws.close();
  chrome.kill("SIGTERM");
  server.kill("SIGTERM");
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
