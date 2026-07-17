#!/usr/bin/env node
// Focused real-Chrome regression for the airport/world fixes requested in the
// July visual audit: rendered-mesh aircraft targeting/boarding, swept
// airframe-vs-building/airframe collision, persistent plane destruction,
// homing RPG selection, and removal of pooled glass/deco after wall carving.

import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const serverPort = 9000 + Math.floor(Math.random() * 120);
const debugPort = 10000 + Math.floor(Math.random() * 120);
const profile = `/tmp/cbz-aircraft-world-${debugPort}`;
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
  "--window-size=1280,800", `--remote-debugging-port=${debugPort}`,
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
  const out = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (out && out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description || out.exceptionDetails.text || "browser evaluation failed");
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
    if (await evaluate("document.readyState==='complete' && !!(window.CBZ && CBZ.game && document.getElementById('playBtn') && CBZ._landmassBuilders && CBZ._landmassBuilders.length>15)")) break;
    await sleep(250);
  }
  await evaluate("(() => { if (CBZ.CONFIG) CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false; return true; })()");
  let playing = false;
  for (let i = 0; i < 120 && !playing; i++) {
    await evaluate("(() => { const b=document.getElementById('playBtn'); if(b)b.click(); return true; })()");
    await sleep(500);
    playing = !!(await evaluate("CBZ.game && CBZ.game.state === 'playing'"));
  }
  if (!playing) throw new Error("city did not enter playing state");

  // Let deferred landmass registrars, glass pooling and one normal update pass
  // complete before inspecting the live world.
  await sleep(6500);
  const result = JSON.parse(await evaluate(`JSON.stringify((function () {
    const failures = [];
    const windowAudit = CBZ.debugWindowOpeningProbe
      ? CBZ.debugWindowOpeningProbe(CBZ.player.pos.x, CBZ.player.pos.z)
      : { ok: false, error: "window probe unavailable" };
    if (!windowAudit.ok || windowAudit.openings < 1) failures.push("carved host wall retained pooled glass or room dressing");

    const arena = CBZ.city && CBZ.city.arena;
    let waterPoint = arena ? { x: arena.maxX + 42, z: (arena.minZ + arena.maxZ) * 0.5 } : null;
    if (waterPoint && CBZ.cityWaterAt && !CBZ.cityWaterAt(waterPoint.x, waterPoint.z)) {
      for (let dz = -300; dz <= 300; dz += 20) {
        if (CBZ.cityWaterAt(waterPoint.x, waterPoint.z + dz)) { waterPoint.z += dz; break; }
      }
    }
    const sea = CBZ.SEA_Y == null ? -0.48 : CBZ.SEA_Y;
    const waterSurface = waterPoint && CBZ.aircraftSurfaceY
      ? CBZ.aircraftSurfaceY(waterPoint.x, waterPoint.z) : null;
    const water = { point: waterPoint, isWater: !!(waterPoint && CBZ.cityWaterAt && CBZ.cityWaterAt(waterPoint.x, waterPoint.z)), sea, aircraftSurface: waterSurface };
    if (!water.isWater || waterSurface == null || Math.abs(waterSurface - sea) > 0.001 || waterSurface >= -0.1) {
      failures.push("aircraft open-water surface still resolved to invisible y=0 ground");
    }

    const planes = (CBZ.cityMilitaryVehicles || []).filter(function (v) {
      return v && v.civilian && v.kind === "plane" && !v.destroyed && v.group && v.group.parent;
    });
    if (planes.length < 6) failures.push("airport civilian fleet did not register real reusable records");
    const rec = planes[0];
    let aircraft = null;
    if (rec) {
      const g = rec.group, dims = rec.aircraftDims;
      g.updateMatrixWorld(true);
      const q = g.getWorldQuaternion(new THREE.Quaternion());
      const cy = rec.flightKind === "airliner" ? 3.5 : 2.1;
      const hz = (dims.fuselage + 0.45) * 0.5;
      const bodyOrigin = new THREE.Vector3(0, cy, hz + 6).applyMatrix4(g.matrixWorld);
      const bodyDir = new THREE.Vector3(0, 0, -1).applyQuaternion(q).normalize();
      const bodyHit = CBZ.cityCivilAircraftRayTest(bodyOrigin.x, bodyOrigin.y, bodyOrigin.z, bodyDir.x, bodyDir.y, bodyDir.z, 14);
      // The swept main wing's tip sits aft of the root by ~4m. Ray its actual
      // visible seat, not the empty vertical plane through the fuselage centre.
      const wingOrigin = new THREE.Vector3(-3.6, 10, dims.span * 0.43).applyMatrix4(g.matrixWorld);
      const wingDir = new THREE.Vector3(0, -1, 0).applyQuaternion(q).normalize();
      const wingHit = CBZ.cityCivilAircraftRayTest(wingOrigin.x, wingOrigin.y, wingOrigin.z, wingDir.x, wingDir.y, wingDir.z, 14);
      const lockOrigin = new THREE.Vector3(dims.length * 0.5 + 35, cy, 0).applyMatrix4(g.matrixWorld);
      const center = new THREE.Vector3(0, cy, 0).applyMatrix4(g.matrixWorld);
      const lockDir = center.clone().sub(lockOrigin).normalize();
      const lock = CBZ.cityCivilAircraftAcquireTarget(lockOrigin.x, lockOrigin.y, lockOrigin.z, lockDir.x, lockDir.y, lockDir.z, 100, 0.95);
      aircraft = {
        count: planes.length,
        colliderL: rec.colliderL, fuselage: dims.fuselage, interactionSpan: rec.footL,
        bodyHit: !!(bodyHit && bodyHit.rec === rec), wingHit: !!wingHit,
        lock: !!(lock && lock.rec === rec),
      };
      if (!aircraft.bodyHit) failures.push("civil aircraft fuselage was not ray-targetable");
      if (!aircraft.wingHit) failures.push("visible civil aircraft wing did not take a gun ray");
      if (!(rec.colliderL <= dims.fuselage + 0.5 && rec.footL >= dims.span - 0.1)) failures.push("movement collider was not narrowed to fuselage");
      if (!aircraft.lock) failures.push("homing acquisition could not lock a real civilian aircraft record");
    }

    let boarding = null;
    if (rec && CBZ.cityTryNearestRide && CBZ.cityAimedMilitaryVehicle) {
      const oldPlayer = CBZ.player.pos.clone(), oldDriving = !!CBZ.player.driving;
      const oldCamPos = CBZ.camera.position.clone(), oldCamQ = CBZ.camera.quaternion.clone();
      const g = rec.group;
      g.updateMatrixWorld(true);
      const stand = new THREE.Vector3(7.8, 0.9, -5.0).applyMatrix4(g.matrixWorld);
      const look = new THREE.Vector3(7.8, 3.2, 0).applyMatrix4(g.matrixWorld);
      CBZ.player.dead = false; CBZ.player.driving = false; CBZ.player._aircraft = null; CBZ.player._vehicle = null;
      CBZ.player.pos.copy(stand);
      CBZ.camera.position.set(stand.x, stand.y + 1.05, stand.z);
      CBZ.camera.lookAt(look); CBZ.camera.updateMatrixWorld(true);
      const surface = CBZ.cityVehicleSurfaceDistance ? CBZ.cityVehicleSurfaceDistance(rec, stand.x, stand.z, stand.y) : null;
      const aimed = CBZ.cityAimedMilitaryVehicle();
      const used = CBZ.cityTryNearestRide();
      const boarded = !!(CBZ.player._aircraft && CBZ.player._aircraft.sourceRec === rec);
      if (boarded && CBZ.cityPlayerAircraftExit) CBZ.cityPlayerAircraftExit();
      CBZ.player.driving = oldDriving; CBZ.player.pos.copy(oldPlayer);
      CBZ.camera.position.copy(oldCamPos); CBZ.camera.quaternion.copy(oldCamQ); CBZ.camera.updateMatrixWorld(true);
      boarding = { surface: surface, aimed: aimed === rec, used: !!used, boarded: boarded };
      if (!(surface != null && surface <= 10.5) || !boarding.aimed || !boarding.used || !boarding.boarded) {
        failures.push("E/Y could not board the rendered aircraft aimed at from beside its fuselage");
      }
    }

    let collision = null;
    if (rec && CBZ.cityAircraftSweepProbe) {
      const fake = { kind: "jet", airClass: "jet", heading: 0, pitch: 0, roll: 0,
        speed: 80, vx: 0, vy: 0, vz: 80, group: new THREE.Group(), sourceRec: null };
      const wall = { minX: 8995, maxX: 9005, minZ: 8, maxZ: 10, y0: 0, y1: 45, ref: new THREE.Group() };
      CBZ.colliders.push(wall);
      const buildingSweep = CBZ.cityAircraftSweepProbe(fake,
        new THREE.Vector3(9000, 18, -28), new THREE.Vector3(9000, 18, 28));
      CBZ.colliders.splice(CBZ.colliders.indexOf(wall), 1);

      const od = rec.aircraftDims, oh = rec.group.rotation.y - (rec.modelYawOffset || 0);
      const fx = Math.sin(oh), fz = Math.cos(oh);
      const rootY = rec.group.position.y + od.height * 0.31 - 2.5 * 0.31;
      const savedCols = CBZ.colliders; CBZ.colliders = [];
      const aircraftSweep = CBZ.cityAircraftSweepProbe(fake,
        new THREE.Vector3(rec.pos.x - fx * 40, rootY, rec.pos.z - fz * 40),
        new THREE.Vector3(rec.pos.x + fx * 40, rootY, rec.pos.z + fz * 40));
      CBZ.colliders = savedCols;
      collision = {
        building: !!(buildingSweep && buildingSweep.building && buildingSweep.t < 1),
        buildingPart: buildingSweep && buildingSweep.part,
        aircraft: !!(aircraftSweep && aircraftSweep.aircraft && aircraftSweep.otherRec === rec && aircraftSweep.t < 1),
        aircraftPart: aircraftSweep && aircraftSweep.part,
      };
      collision.gateClear = planes.map(function (p) {
        const heading = (p.group.rotation.y || 0) - (p.modelYawOffset || 0);
        const c = { kind: "jet", airClass: p.flightKind === "airliner" ? "airliner" : "prop",
          heading: heading, pitch: 0, roll: 0, speed: 1, vx: Math.sin(heading), vy: 0, vz: Math.cos(heading),
          group: p.group, sourceRec: p };
        const a = p.pos.clone(), b = a.clone().add(new THREE.Vector3(Math.sin(heading) * 0.5, 0, Math.cos(heading) * 0.5));
        const h = CBZ.cityAircraftSweepProbe(c, a, b);
        return { name: p.flightKind, clear: !h || h.t > 0.08, hit: h && (h.aircraft ? "aircraft" : h.building ? "building" : h.part) };
      });
      if (!collision.building) failures.push("fast aircraft sweep tunneled through a building collider");
      if (!collision.aircraft) failures.push("relative aircraft sweep tunneled through another plane");
      if (collision.gateClear.some(function (x) { return !x.clear; })) failures.push("a parked gate plane began inside the new swept collision hull");
    }

    const victim = planes[planes.length - 1];
    let destruction = null;
    if (victim) {
      const col = victim.collider, group = victim.group;
      const p = group.position.clone(); p.y += victim.flightKind === "airliner" ? 3.5 : 2.1;
      const killed = CBZ.cityDamageCivilAircraft(victim, (victim.hp || victim.maxHp || 250) + 1, p, { byPlayer: false });
      destruction = {
        killed, destroyed: victim.destroyed, persistent: !!group.parent,
        colliderDetached: !col || (CBZ.colliders || []).indexOf(col) < 0,
        charred: !!group.userData.charred, hijackable: !!group.userData.hijackable,
      };
      if (!killed || !destruction.destroyed || !destruction.persistent || !destruction.colliderDetached || !destruction.charred || destruction.hijackable) {
        failures.push("destroyed civilian aircraft did not become a persistent non-boardable wreck");
      }
    }

    const rpg = (CBZ.FPS_WEAPONS || []).find(function (w) { return w && w.explosive; });
    const homingData = rpg && rpg.ammoTypes && rpg.ammoTypes.find(function (a) { return a.id === "homing" && a.homing; });
    // Test fixture only: avoid inventory-change UI/phone callbacks while this
    // single synchronous CDP probe owns the main thread.
    const rpgIndex = rpg ? CBZ.FPS_WEAPONS.indexOf(rpg) : -1;
    if (rpg && (CBZ.weaponInventory || []).indexOf(rpg.id) < 0) CBZ.weaponInventory.push(rpg.id);
    if (rpg) CBZ.currentWeaponId = rpg.id;
    if (CBZ.fps && rpgIndex >= 0) CBZ.fps.weapon = rpgIndex;
    const selected = !!(rpg && CBZ.currentWeaponId === rpg.id);
    const homingSet = !!(CBZ.fpsSetRocketAmmoType && CBZ.fpsSetRocketAmmoType("homing"));
    const homing = { data: !!homingData, selected, set: homingSet, active: CBZ.fpsRocketAmmoType && CBZ.fpsRocketAmmoType() };
    if (!homing.data || !homing.set || homing.active !== "homing") failures.push("homing RPG ammo was not data-backed and selectable");
    if (typeof CBZ.fpsReticleState !== "function") failures.push("muzzle-truth reticle state API was unavailable");
    if (typeof CBZ.cityReportMajorIncident !== "function") failures.push("major aircraft impact emergency dispatch API was unavailable");

    let emergencyDispatch = null;
    if (CBZ.cityDispatchEmergencyAt && CBZ.city && CBZ.city.arena) {
      const c = CBZ.city.arena.center || { x: 0, z: 0 };
      const fire = CBZ.cityDispatchEmergencyAt("firetruck", c.x, c.z, { y: 12 });
      const medic = CBZ.cityDispatchEmergencyAt("ambulance", c.x, c.z, { y: 12 });
      emergencyDispatch = { fire: !!(fire && fire.grp), ambulance: !!(medic && medic.grp) };
      if (CBZ.cityEmergencyReset) CBZ.cityEmergencyReset();
      if (!emergencyDispatch.fire || !emergencyDispatch.ambulance) failures.push("aircraft incident did not dispatch both fire and medical units");
    }

    return { windowAudit, water, aircraft, boarding, collision, destruction, homing,
      reticleApi: typeof CBZ.fpsReticleState === "function", emergencyDispatch,
      emergencyApi: typeof CBZ.cityReportMajorIncident === "function", failures };
  })())`));

  // End-to-end seeker proof: place the real player near a remaining gate plane,
  // aim the real FPS channel, fire one selected homing round, then let normal
  // onAlways projectile updates steer/impact it. This catches self-cover lock
  // rejection and "data exists but the actual rocket stays dumb" regressions.
  const homingSetup = JSON.parse(await evaluate(`JSON.stringify((function () {
    const rec = (CBZ.cityMilitaryVehicles || []).find(function (v) {
      return v && v.civilian && v.kind === "plane" && !v.destroyed && !v.taken && v.group && v.group.parent;
    });
    const rpg = (CBZ.FPS_WEAPONS || []).find(function (w) { return w && w.explosive; });
    if (!rec || !rpg) return { ok: false };
    const idx = CBZ.FPS_WEAPONS.indexOf(rpg), g = rec.group, dims = rec.aircraftDims;
    g.updateMatrixWorld(true);
    const start = new THREE.Vector3(dims.length * 0.5 + 38, 0, 0).applyMatrix4(g.matrixWorld);
    const gy = CBZ.floorAt ? (+CBZ.floorAt(start.x, start.z) || 0) : 0;
    CBZ.player.dead = false; CBZ.player.driving = false; CBZ.player._swim = false;
    CBZ.player.pos.set(start.x, gy, start.z);
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(CBZ.player.pos);
    if ((CBZ.weaponInventory || []).indexOf(rpg.id) < 0) CBZ.weaponInventory.push(rpg.id);
    CBZ.currentWeaponId = rpg.id; CBZ.game.cityHolstered = false;
    CBZ.fps.weapon = idx; CBZ.fps.rounds[idx] = 1; CBZ.fps.reserves[idx] = Math.max(1, CBZ.fps.reserves[idx] || 0);
    CBZ.setFPS(true); CBZ.fpsSetRocketAmmoType("homing");
    window.__homingAircraftProbe = { rec: rec, hp: rec.hp };
    return { ok: true, id: rec.flightKind, hp: rec.hp, at: [rec.group.position.x, rec.group.position.y, rec.group.position.z] };
  })())`));
  if (homingSetup.ok) {
    await sleep(450);
    await evaluate(`(function () {
      const q = window.__homingAircraftProbe, rec = q && q.rec;
      if (!rec || rec.destroyed) return false;
      const targetY = rec.group.position.y + (rec.flightKind === "airliner" ? 3.5 : 2.1);
      const c = CBZ.camera.position;
      const d = new THREE.Vector3(rec.group.position.x - c.x, targetY - c.y, rec.group.position.z - c.z).normalize();
      CBZ.cam.yaw = Math.atan2(-d.x, -d.z);
      CBZ.fps.fp = Math.asin(Math.max(-1, Math.min(1, d.y)));
      CBZ.fpsFire(true); CBZ.fpsFire(false);
      return true;
    })()`);
    await sleep(2200);
    result.homingFlight = JSON.parse(await evaluate(`JSON.stringify((function () {
      const q = window.__homingAircraftProbe, rec = q && q.rec;
      return rec ? { destroyed: !!rec.destroyed, hpBefore: q.hp, hpAfter: rec.hp, persistent: !!(rec.group && rec.group.parent), charred: !!(rec.group && rec.group.userData.charred) } : null;
    })())`));
  } else result.homingFlight = { error: "no remaining aircraft/RPG for flight probe" };
  if (!result.homingFlight || !result.homingFlight.destroyed || !result.homingFlight.persistent || !result.homingFlight.charred) {
    result.failures.push("selected homing rocket did not fly into and wreck its live aircraft target");
  }

  result.reticle = JSON.parse(await evaluate(`JSON.stringify((function () {
    const el = document.getElementById("crosshair");
    const state = CBZ.fpsReticleState ? CBZ.fpsReticleState() : null;
    const px = el ? parseFloat(el.style.width || getComputedStyle(el).width) : 999;
    const before = el ? getComputedStyle(el, "::before").backgroundImage : "";
    return { state, px, compact: px <= 30.01, shortTicks: /4px/.test(before) };
  })())`));
  if (!result.reticle.state || !result.reticle.compact || !result.reticle.shortTicks) {
    result.failures.push("aircraft reticle was still the oversized long-arm plus sign");
  }

  // Let the normal order-12 flight update (not the public crash shortcut) fly
  // a real adopted gate plane into a thin facade. This proves the integrator is
  // actually wired to the swept hull and cannot step through the wall.
  result.liveSweepSetup = JSON.parse(await evaluate(`JSON.stringify((function () {
    const rec=(CBZ.cityMilitaryVehicles||[]).find(v=>v&&v.civilian&&v.kind==="plane"&&!v.destroyed&&!v.taken&&v.group&&v.group.parent);
    if(!rec)return {ok:false,error:"no aircraft"};
    if(CBZ.setFPS)CBZ.setFPS(false);CBZ.player.dead=false;CBZ.player.driving=false;CBZ.player._aircraft=null;
    const craft=CBZ.citySpawnFlyableFromProp&&CBZ.citySpawnFlyableFromProp(rec);if(!craft)return {ok:false,error:"adoption failed"};
    craft.pos.y=24;craft.group.position.y=24;craft.onGround=false;craft._roof=null;craft.pitch=0;craft.roll=0;
    craft.airspeed=82;craft.speed=82;craft.thr=1;craft.sag=0;
    craft.vx=Math.sin(craft.heading)*82;craft.vy=0;craft.vz=Math.cos(craft.heading)*82;
    const cx=craft.pos.x+Math.sin(craft.heading)*22,cz=craft.pos.z+Math.cos(craft.heading)*22;
    const wall={minX:cx-5,maxX:cx+5,minZ:cz-5,maxZ:cz+5,y0:0,y1:62,ref:new THREE.Group()};
    CBZ.colliders.push(wall);window.__liveAircraftSweep={rec,craft,wall};
    return {ok:true,from:[craft.pos.x,craft.pos.y,craft.pos.z],wall:[cx,cz]};
  })())`));
  if (result.liveSweepSetup.ok) await sleep(650);
  result.liveSweepCrash = JSON.parse(await evaluate(`JSON.stringify((function () {
    const q=window.__liveAircraftSweep;if(!q)return null;
    const i=CBZ.colliders.indexOf(q.wall);if(i>=0)CBZ.colliders.splice(i,1);
    return {destroyed:!!q.craft.destroyed,recordDestroyed:!!q.rec.destroyed,charred:!!(q.rec.group&&q.rec.group.userData.charred),
      pilotReleased:!(CBZ.player&&CBZ.player._aircraft)};
  })())`));
  if (!result.liveSweepCrash || !result.liveSweepCrash.destroyed || !result.liveSweepCrash.recordDestroyed ||
      !result.liveSweepCrash.charred || !result.liveSweepCrash.pilotReleased) {
    result.failures.push("live flight integrator tunneled through a thin facade instead of crashing");
  }

  // Elevated ordnance must keep all structural work at the actual facade seat:
  // no road scorch and no hidden ground-floor damage call.
  result.elevatedBlast = JSON.parse(await evaluate(`JSON.stringify((function () {
    const calls = { scorch: [], chunk: [], damage: [], fracture: [] };
    const old = {
      scorch: CBZ.cityScorch, chunk: CBZ.cityChunk, damage: CBZ.cityDamageBuilding,
      fracture: CBZ.cityFracture && CBZ.cityFracture.blastAt,
    };
    CBZ.cityScorch = function (x, z, r) { calls.scorch.push([x, z, r]); };
    CBZ.cityChunk = function (x, y, z) { calls.chunk.push([x, y, z]); };
    CBZ.cityDamageBuilding = function (x, y, z) { calls.damage.push([x, y, z]); };
    if (CBZ.cityFracture) CBZ.cityFracture.blastAt = function (p) { calls.fracture.push([p.x, p.y, p.z]); };
    try {
      CBZ.cityExplosion(9000, 9000, { power: 1.4, radius: 7, y: 30, byPlayer: false });
    } finally {
      CBZ.cityScorch = old.scorch; CBZ.cityChunk = old.chunk; CBZ.cityDamageBuilding = old.damage;
      if (CBZ.cityFracture) CBZ.cityFracture.blastAt = old.fracture;
    }
    return { wrapped: !!(CBZ.cityExplosion && CBZ.cityExplosion._structWrapped), calls };
  })())`));
  const eb = result.elevatedBlast;
  if (!eb.wrapped || eb.calls.scorch.length || !eb.calls.chunk.length || Math.abs(eb.calls.chunk[0][1] - 30) > 0.01 ||
      !eb.calls.damage.length || Math.abs(eb.calls.damage[0][1] - 30) > 0.01 ||
      !eb.calls.fracture.length || Math.abs(eb.calls.fracture[0][1] - 30) > 0.01) {
    result.failures.push("elevated structural blast still coupled to the road/ground floor");
  }

  // Crash a genuinely adopted airport group through the public flight path.
  // The exact live model must stay as a charred, non-boardable wreck.
  result.externalCrash = JSON.parse(await evaluate(`JSON.stringify((function () {
    const rec = (CBZ.cityMilitaryVehicles || []).find(function (v) {
      return v && v.civilian && v.kind === "plane" && !v.destroyed && !v.taken && v.group && v.group.parent;
    });
    if (!rec) return { error: "no remaining external aircraft" };
    if (CBZ.setFPS) CBZ.setFPS(false);
    if (CBZ.player) CBZ.player.dead = false;
    const craft = CBZ.citySpawnFlyableFromProp && CBZ.citySpawnFlyableFromProp(rec);
    if (!craft) return { error: "adoption failed" };
    const wasParented = !!rec.group.parent;
    const calls = { damage: [], emergency: [] };
    const oldDamage = CBZ.cityDamageBuilding, oldEmergency = CBZ.cityReportMajorIncident;
    CBZ.cityDamageBuilding = function (x, y, z, power) { calls.damage.push([x, y, z, power]); return { x, y, z }; };
    CBZ.cityReportMajorIncident = function (x, y, z, opts) { calls.emergency.push([x, y, z, opts && opts.kind]); return { x, y, z }; };
    craft.pos.y = 22; craft.group.position.y = 22;
    craft.speed = 72; craft.airspeed = 72; craft.vx = 0; craft.vy = -3; craft.vz = 72;
    const facade = { minX: craft.pos.x - 8, maxX: craft.pos.x + 8, minZ: craft.pos.z + 1, maxZ: craft.pos.z + 3,
      y0: 0, y1: 55, ref: new THREE.Group() };
    let crashed = false;
    try {
      crashed = !!(CBZ.cityCrashPlayerAircraft && CBZ.cityCrashPlayerAircraft({
        x: craft.pos.x, y: craft.pos.y, z: craft.pos.z + 1, collider: facade, part: "left-wing",
      }));
    } finally {
      CBZ.cityDamageBuilding = oldDamage; CBZ.cityReportMajorIncident = oldEmergency;
    }
    const ud = rec.group.userData || {};
    return {
      crashed, destroyed: !!rec.destroyed, persistent: wasParented && !!rec.group.parent,
      charred: !!ud.charred, hijackable: !!ud.hijackable, milKind: ud.milKind || null,
      // Civilian aircraft intentionally have no broad AABB now; either an
      // old collider was detached or there was correctly nothing to detach.
      craftCleared: !ud.craft,
      colliderDetached: !rec.collider || !!rec._colliderDetached || (CBZ.colliders || []).indexOf(rec.collider) < 0,
      smokeApi: typeof CBZ.cityCrashSmoke === "function",
      facadeDamage: calls.damage.length, emergencyCalls: calls.emergency.length,
    };
  })())`));
  const ec = result.externalCrash;
  if (!ec.crashed || !ec.destroyed || !ec.persistent || !ec.charred || ec.hijackable || ec.milKind ||
      !ec.craftCleared || !ec.colliderDetached || !ec.smokeApi || ec.facadeDamage < 3 || ec.emergencyCalls < 1) {
    result.failures.push("adopted aircraft crash did not leave a charred persistent non-hijackable wreck");
  }

  console.log(JSON.stringify(result, null, 2));
  if (result.failures.length) process.exitCode = 1;
} finally {
  try { if (ws && ws.readyState === WebSocket.OPEN) await send("Browser.close"); } catch (_) {}
  if (!chrome.killed) chrome.kill("SIGTERM");
  if (!server.killed) server.kill("SIGTERM");
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
