#!/usr/bin/env node
// Real-Chrome regression test for the shared jail/city gun state and barrel
// origin. Requires a local server, by default:
//   python3 -m http.server 8765 --bind 127.0.0.1

import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";

const server = process.env.CBZ_PROFILE_URL || "http://127.0.0.1:8765/";
const port = 9800 + Math.floor(Math.random() * 100);
const profileDir = `/tmp/cbz-shared-weapons-${port}`;
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await rm(profileDir, { recursive: true, force: true });
const chrome = spawn(chromePath, [
  "--headless=new", "--enable-unsafe-swiftshader", "--disable-background-networking",
  "--disable-component-update", "--disable-default-apps", "--disable-extensions",
  "--no-default-browser-check", "--no-first-run", `--remote-debugging-port=${port}`,
  `--user-data-dir=${profileDir}`, "about:blank",
], { stdio: "ignore" });

let ws, nextId = 1;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, 30000);
  });
}
async function evaluate(expression) {
  const out = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (out && out.exceptionDetails) throw new Error(out.exceptionDetails.text || "browser evaluation failed");
  return out && out.result && out.result.value;
}
async function page() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const pages = await res.json();
      const found = pages.find((p) => p.type === "page");
      if (found) return found;
    } catch (_) {}
    await sleep(200);
  }
  throw new Error("Chrome page did not become available");
}

try {
  const target = await page();
  ws = new WebSocket(target.webSocketDebuggerUrl);
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
  // This is a weapon-state/transform test, not a frame-rate test. Stop the game
  // loop before navigation so the enormous city render cannot starve CDP while
  // retaining the real browser, Three.js, modules, ammo state, and transforms.
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: "window.requestAnimationFrame = function () { return 0; }; window.cancelAnimationFrame = function () {};",
  });
  await send("Page.navigate", { url: server });

  const deadline = Date.now() + 60000;
  while (Date.now() < deadline && !(await evaluate("!!(window.CBZ && CBZ.resetGame && CBZ.cityGiveWeapon && CBZ.fpsAddAmmo && CBZ.playerMuzzleWorld)"))) await sleep(250);

  const city = JSON.parse(await evaluate(`JSON.stringify((function () {
    CBZ.setMode("city"); CBZ.resetGame(); CBZ.setState("playing");
    CBZ.cityGiveWeapon("Pistol"); CBZ.cityGiveWeapon("Shotgun");
    CBZ.setCurrentWeapon("sidearm");
    const idx = CBZ.FPS_WEAPONS.findIndex(function (w) { return w.id === "sidearm"; });
    const before = CBZ.fps.reserves[idx];
    CBZ.cityAddAmmo(17);
    const sidearmName = CBZ.cityCurrentWeaponName();
    CBZ.fpsNextWeapon();
    const shotgunName = CBZ.cityCurrentWeaponName();
    CBZ.cityGiveWeapon("Bat");
    const melee = {
      name: CBZ.cityCurrentWeaponName(),
      cityHasGun: CBZ.cityHasGun(),
      engineArmed: CBZ.playerArmed(),
    };
    dispatchEvent(new KeyboardEvent("keydown", { key: "q" }));
    const afterMelee = {
      name: CBZ.cityCurrentWeaponName(),
      cityHasGun: CBZ.cityHasGun(),
      engineArmed: CBZ.playerArmed(),
    };
    CBZ.setFPS(false);
    const m = CBZ.playerMuzzleWorld();
    const p = CBZ.player.pos;
    return {
      inventory: CBZ.weaponInventory.slice(), selected: CBZ.currentWeaponId,
      sidearmName: sidearmName, shotgunName: shotgunName,
      ammoAdded: CBZ.fps.reserves[idx] - before,
      melee: melee, afterMelee: afterMelee,
      legacyCityWeapon: CBZ.game.cityWeapon == null,
      muzzleDistanceFromPlayer: Math.hypot(m.x - p.x, m.y - p.y, m.z - p.z),
      muzzleY: m.y,
    };
  })())`));

  await evaluate(`(function () {
    CBZ.setMode("escape"); CBZ.resetGame(); CBZ.setState("playing");
    CBZ.unlockWeapon("sidearm", { select: true }); CBZ.setFPS(true);
  })()`);
  await sleep(250);
  const jail = JSON.parse(await evaluate(`JSON.stringify((function () {
    const m = CBZ.playerMuzzleWorld(), c = CBZ.camera.position;
    return {
      selected: CBZ.currentWeaponId,
      muzzleDistanceFromCamera: Math.hypot(m.x - c.x, m.y - c.y, m.z - c.z),
      muzzleOffset: { x: m.x - c.x, y: m.y - c.y, z: m.z - c.z },
    };
  })())`));

  const failures = [];
  if (city.inventory.join(",") !== "sidearm,shotgun") failures.push("city did not use shared engine inventory");
  if (city.sidearmName !== "Pistol" || city.shotgunName !== "Shotgun") failures.push("city did not follow shared selection");
  if (city.ammoAdded !== 17) failures.push("city ammo did not reach selected shared gun");
  if (city.melee.name !== "Bat" || city.melee.cityHasGun || city.melee.engineArmed) failures.push("city melee did not suppress shared gun");
  if (city.afterMelee.name !== "Shotgun" || !city.afterMelee.cityHasGun || !city.afterMelee.engineArmed) failures.push("Q did not draw shared gun after melee");
  if (!city.legacyCityWeapon) failures.push("legacy city gun source of truth still populated");
  if (!(jail.muzzleDistanceFromCamera > 0.7)) failures.push("jail FPS muzzle remains at camera/face");
  console.log(JSON.stringify({ city, jail, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  try { if (ws && ws.readyState === WebSocket.OPEN) await send("Browser.close"); } catch (_) {}
  if (!chrome.killed) chrome.kill("SIGTERM");
  await rm(profileDir, { recursive: true, force: true }).catch(() => {});
}
