#!/usr/bin/env node
// Focused real-Chrome regression for the airport/world fixes requested in the
// July visual audit: fuselage-only civilian aircraft collision/targeting,
// destructible persistent plane records, homing RPG selection, and removal of
// pooled glass/deco when a host wall is carved.

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
    if (await evaluate("!!(window.CBZ && CBZ.game && document.getElementById('playBtn'))")) break;
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
      const wingOrigin = new THREE.Vector3(0, 10, dims.span * 0.43).applyMatrix4(g.matrixWorld);
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
      if (aircraft.wingHit) failures.push("civil aircraft wing still behaved as a span-wide invisible solid");
      if (!(rec.colliderL <= dims.fuselage + 0.5 && rec.footL >= dims.span - 0.1)) failures.push("movement collider was not narrowed to fuselage");
      if (!aircraft.lock) failures.push("homing acquisition could not lock a real civilian aircraft record");
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

    return { windowAudit, water, aircraft, destruction, homing, failures };
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
    const crashed = !!(CBZ.cityCrashPlayerAircraft && CBZ.cityCrashPlayerAircraft({
      x: craft.pos.x, y: craft.pos.y, z: craft.pos.z, collider: null,
    }));
    const ud = rec.group.userData || {};
    return {
      crashed, destroyed: !!rec.destroyed, persistent: wasParented && !!rec.group.parent,
      charred: !!ud.charred, hijackable: !!ud.hijackable, milKind: ud.milKind || null,
      craftCleared: !ud.craft, colliderDetached: !!rec._colliderDetached,
      smokeApi: typeof CBZ.cityCrashSmoke === "function",
    };
  })())`));
  const ec = result.externalCrash;
  if (!ec.crashed || !ec.destroyed || !ec.persistent || !ec.charred || ec.hijackable || ec.milKind ||
      !ec.craftCleared || !ec.colliderDetached || !ec.smokeApi) {
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
