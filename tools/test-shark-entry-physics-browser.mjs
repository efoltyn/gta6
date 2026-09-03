#!/usr/bin/env node
/* Focused real-browser contract for shark water entry.

   This is deliberately about the invisible law behind the pictures:
     - identical mass/speed, clean alignment transfers less surface momentum
       than a shallow or broadside entry;
     - the body receives the equal/opposite section-by-section reaction;
     - the local cavity is in the canonical CPU water height field and decays;
     - one hull crossing produces one shoulder load, not a whole-mass event at
       the nose and another at the tail.
*/
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const serverPort = 9670 + Math.floor(Math.random() * 80);
const debugPort = 12170 + Math.floor(Math.random() * 80);
const profile = `/tmp/cbz-shark-entry-${debugPort}`;
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
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--enable-webgl", "--mute-audio", "--window-size=960,640",
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
  `${base}?seed=90210&mode=sharksim&cfg_BOOT_METER=0`,
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
      pending.delete(id); reject(new Error(`${method} timed out`));
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
async function poll(expression, timeoutMs = 45000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await evaluate(expression)) return true;
    await sleep(120);
  }
  return false;
}

let result = null, exitCode = 1;
try {
  let page = null;
  for (let i = 0; i < 240 && !page; i++) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      page = pages.find((p) => p.type === "page" && p.url.startsWith(base));
    } catch (_) {}
    if (!page) await sleep(125);
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
      const d = msg.params?.exceptionDetails || {};
      browserErrors.push(d.exception?.description || d.text || "runtime exception");
      return;
    }
    if (!msg.id || !pending.has(msg.id)) return;
    const p = pending.get(msg.id); pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
  });
  await send("Runtime.enable");
  await send("Log.enable");

  const ready = await poll(`!!(window.CBZ && CBZ.marineEntryProfile &&
    CBZ.marineWaterline && CBZ.waterSurfaceImpulse && CBZ.waterWaveHeight &&
    CBZ.waterImpactStats && CBZ.aquaticMountAudit && CBZ.waterField)`);
  if (!ready) throw new Error("entry-physics APIs did not load");

  result = await json(`(() => {
    const cleanIn = { heading: 0, pitch: Math.atan2(-15, 6), roll: 0,
      vx: 6, vy: -15, vz: 0, len: 20 };
    const shallowIn = { heading: 0, pitch: Math.atan2(-4, 15), roll: 0.15,
      vx: 15, vy: -4, vz: 0, len: 20 };
    const broadIn = { heading: 1.22, pitch: -0.18, roll: 1.08,
      vx: 6, vy: -15, vz: 0, len: 20 };
    const pick = (p) => ({ quality: +p.quality.toFixed(3), area: +p.area.toFixed(3),
      coupling: +p.coupling.toFixed(3), projectedM2: +p.projectedM2.toFixed(2) });
    const clean = pick(CBZ.marineEntryProfile(cleanIn));
    const shallow = pick(CBZ.marineEntryProfile(shallowIn));
    const broad = pick(CBZ.marineEntryProfile(broadIn));

    let seed = 0x4e71, wet = null;
    const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < 20 && !wet; i++) {
      const p = CBZ.waterField.randomWaterPoint(rng, { cx: 0, cz: -700, r0: 700, r1: 1800, clearance: 180 });
      if (p && CBZ.waterField.isSurfaceWater(p.x, p.z, 0)) wet = p;
    }
    if (!wet) wet = { x: 0, z: -1600 };

    CBZ.waterSurfaceImpulseClear();
    CBZ.waterSurfaceImpulse(wet.x, wet.z, { amplitude: 0.55, radius: 1.2, speed: 4.2, life: 2.0 });
    const t0 = CBZ.waterClock();
    const h1 = CBZ.waterWaveHeight(wet.x, wet.z, t0);
    const was0 = CBZ.CONFIG.WATER_ENTRY_PHYSICS;
    CBZ.CONFIG.WATER_ENTRY_PHYSICS = false;
    const h0 = CBZ.waterWaveHeight(wet.x, wet.z, t0);
    CBZ.CONFIG.WATER_ENTRY_PHYSICS = was0;
    const futureT = t0 + 2.15;
    const futureWith = CBZ.waterWaveHeight(wet.x, wet.z, futureT);
    const was = CBZ.CONFIG.WATER_ENTRY_PHYSICS;
    CBZ.CONFIG.WATER_ENTRY_PHYSICS = false;
    const futureBase = CBZ.waterWaveHeight(wet.x, wet.z, futureT);
    CBZ.CONFIG.WATER_ENTRY_PHYSICS = was;
    const surface = { initialDentM: +(h0 - h1).toFixed(3),
      residualM: +Math.abs(futureWith - futureBase).toFixed(5),
      audit: CBZ.waterSurfaceImpulseAudit() };

    let loadCalls = 0;
    const realHit = CBZ.waterHit;
    CBZ.waterHit = function (x, y, z, o) {
      if (o && o.entry && o.entry.phase === "shoulders") loadCalls++;
      return realHit.apply(this, arguments);
    };
    function cross(name, proto) {
      CBZ.waterSurfaceImpulseClear();
      const surf = CBZ.citySeaHeightAt(wet.x, wet.z);
      const actor = { species: { id: name, scale: 1 }, group: new THREE.Group(),
        heading: proto.heading, _breachLen: { L: 20, s: 1 },
        _breachEnds: { fwd: 10, aft: 10, s: 1 } };
      actor.group.scale.set(1, 1, 1);
      const motion = { v: Math.hypot(proto.vx, proto.vz), vy: proto.vy };
      const o = { x: wet.x, y: surf + 13, z: wet.z, heading: proto.heading,
        pitch: proto.pitch, roll: proto.roll, len: 20, dt: 1 / 60, motion };
      let shoulder0 = CBZ.aquaticMountAudit().breachEntryShoulderHits, loads0 = loadCalls;
      for (let i = 0; i < 260; i++) {
        o.vx = Math.cos(0) * motion.v; o.vz = 0; o.vy = motion.vy;
        o.y += motion.vy * o.dt;
        CBZ.marineWaterline(actor, o);
        if (actor._wl && !actor._wl.entry && actor._wl.t === false && i > 20) break;
      }
      const a = CBZ.aquaticMountAudit();
      return { speed: +Math.hypot(motion.v, motion.vy).toFixed(3),
        retained: +a.breachEntryRetained.toFixed(3), impulse: +a.breachEntryImpulse.toFixed(1),
        shoulderHits: a.breachEntryShoulderHits - shoulder0,
        loadCalls: loadCalls - loads0,
        quality: a.breachEntryQuality, area: a.breachEntryArea, coupling: a.breachEntryCoupling };
    }
    const cleanCross = cross("probe_clean", cleanIn);
    const broadCross = cross("probe_broad", broadIn);
    CBZ.waterHit = realHit;
    return { clean, shallow, broad, surface, cleanCross, broadCross,
      impact: CBZ.waterImpactStats() };
  })()`);

  const failures = [];
  if (!(result.clean.quality > 0.82)) failures.push("clean entry quality is not high");
  if (!(result.shallow.area > result.clean.area * 1.6)) failures.push("shallow entry did not expose more area");
  if (!(result.broad.coupling > result.clean.coupling * 3)) failures.push("broadside coupling is not decisively larger");
  if (!(result.broad.projectedM2 > result.clean.projectedM2 * 2)) failures.push("projected-area ordering failed");
  if (!(result.surface.initialDentM > 0.2)) failures.push("canonical surface did not open a cavity");
  if (!(result.surface.residualM < 0.002)) failures.push("surface impulse did not decay cleanly");
  if (!(result.cleanCross.shoulderHits === 1 && result.broadCross.shoulderHits === 1 &&
      result.cleanCross.loadCalls === 1 && result.broadCross.loadCalls === 1)) failures.push("a hull crossing did not produce exactly one shoulder load");
  if (!(result.cleanCross.speed > result.broadCross.speed * 1.12)) failures.push("clean entry did not retain more speed than broadside");
  if (browserErrors.length) failures.push(`browser exceptions: ${browserErrors.slice(0, 2).join(" | ")}`);
  result.failures = failures;
  exitCode = failures.length ? 1 : 0;
} catch (error) {
  result = { failures: [String(error?.stack || error)], browserErrors };
  exitCode = 1;
} finally {
  try { ws?.close(); } catch (_) {}
  chrome.kill(); server.kill();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}

console.log(JSON.stringify(result, null, 2));
process.exit(exitCode);
