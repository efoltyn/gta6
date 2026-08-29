#!/usr/bin/env node
/* tools/passenger-check.mjs — THE PASSENGER SEAT GATE.

   Boots the game headless once, then drives the REAL sim with CBZ.stepSim(dt)
   (math-gate's loop: no rendering, no wall-clock sleeps) and asserts the whole
   arc the owner asked for, on a car and on a boat:

     1. SEAT       [G]/citySeatShift moves the player to the shotgun seat and
                   the rig is actually THERE — the seated body's world X is on
                   the opposite side of the car's centreline from where it was
                   at the wheel, by about a full seat half-track.
     2. DEAD PEDALS  hold W for 60 ticks as a passenger: the car must not gain
                   speed. This is the ratchet (`ghostThrottle` pinned at 0) and
                   it is checked twice — once from the audit's own counter and
                   once from the outside, against measured speed.
     3. COAST      a car left at speed with nobody driving rolls ON and then
                   STOPS: distance covered must be real (> 8 m) and terminal
                   speed ~0. A car that freezes on the spot is the pre-`_runaway`
                   bug and fails here.
     4. BACK       [G] again returns the wheel: W accelerates the car again.
     5. JUMP       above walking pace, the exit verb is a BAIL — the player
                   leaves the car, takes damage scaled by speed, is airborne
                   (physics.js owns `_phys.air`), and THE CAR KEEPS GOING.
     6. STEP OUT   below walking pace the same verb is the ordinary step-out:
                   no damage, no launch.
     7. HULL       a boat: the helm goes dead the same way (throttle held, no
                   speed gained), and the seat verb is accepted.
     8. HONEST     the audit's two invariants are 0, and the aircraft refusal
                   is a refusal (PAX_AIRCRAFT declared off) rather than a
                   silently moved body.

   Two-sided: `--revert` runs the same script with ?cfg_PASSENGER_SEAT_V1=0 and
   asserts the OLD world comes back — the seat verb refuses, holding W as a
   "passenger" drives the car (because there is no passenger), and stepping out
   of a car at speed parks it on the spot. A fix nobody can turn off has not
   been measured.

   Usage: node tools/passenger-check.mjs [--revert]
   Exit 0 = PASSENGER: ok. Anything else = FAIL (exit 1). */
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REVERT = process.argv.includes("--revert");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const port = 8890 + Math.floor(Math.random() * 40);
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], {
  env: { ...process.env, PORT: String(port) }, stdio: "ignore",
});
const base = `http://127.0.0.1:${port}/`;
const url = base + (REVERT ? "?cfg_PASSENGER_SEAT_V1=0" : "");
const dbg = 9890 + Math.floor(Math.random() * 40);
const profile = `/tmp/cbz-pax-${dbg}`;
await rm(profile, { recursive: true, force: true });
await sleep(700);
const CHROME_BIN = process.env.CBZ_CHROME ||
  (process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : "/opt/pw-browsers/chromium");
const chrome = spawn(CHROME_BIN, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--enable-webgl", "--mute-audio", "--window-size=1280,800",
  `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, url,
], { stdio: "ignore" });

function done(code) {
  try { chrome.kill(); } catch (e) {}
  try { server.kill(); } catch (e) {}
  process.exit(code);
}

let page = null;
for (let i = 0; i < 100 && !page; i++) {
  try {
    const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json();
    page = ps.find((p) => p.type === "page" && p.url.startsWith(base));
  } catch (_) {}
  if (!page) await sleep(250);
}
if (!page) { console.error("FAIL: no page"); done(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener("open", res, { once: true });
  ws.addEventListener("error", rej, { once: true });
});
let id = 1; const pending = new Map(); const errors = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") {
    const d = m.params.exceptionDetails;
    errors.push(`${d.url || "?"}:${d.lineNumber} ${((d.exception && d.exception.description) || d.text || "").split("\n")[0]}`);
  }
});
const send = (method, params = {}) => new Promise((r) => {
  const i = id++; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params }));
});
const evl = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true });
  const res = r.result || {};
  if (res.exceptionDetails) {
    return { __ex: ((res.exceptionDetails.exception && res.exceptionDetails.exception.description) || res.exceptionDetails.text || "?").split("\n")[0] };
  }
  return res.result && res.result.value;
};
await send("Runtime.enable");

let fails = 0;
const check = (name, ok, detail) => {
  console.log((ok ? "PASS" : "FAIL") + ": " + name + (detail == null ? "" : " — " + detail));
  if (!ok) fails++;
};

// ---- boot ----
for (let i = 0; i < 80; i++) {
  if (await evl("!!(window.CBZ && CBZ.game && document.getElementById('playBtn'))")) break;
  await sleep(500);
}
let playing = false;
for (let i = 0; i < 80 && !playing; i++) {
  await evl("(() => { const b = document.getElementById('playBtn'); if (b) b.click(); return true; })()");
  await sleep(600);
  playing = await evl("CBZ.game && CBZ.game.state === 'playing'");
}
check("game playing in city", !!playing && (await evl("CBZ.game.mode")) === "city");
if (!playing) done(1);

// A hand-driven sim: keys are written straight into CBZ.keys and stepSim runs
// the whole updater chain, exactly as math-gate does.
const HELPERS = `window.__pax = {
  keys: function (o) { for (const k in CBZ.keys) CBZ.keys[k] = false; for (const k in o) CBZ.keys[k] = !!o[k]; },
  step: function (n, dt) { for (let i = 0; i < (n || 1); i++) CBZ.stepSim(dt || 1/60); },
  car: function () { return CBZ.player._vehicle; },
  spd: function () { const c = CBZ.player._vehicle || window.__pax.last; if (!c) return 0;
    return (Number.isFinite(c.vx) && (Math.abs(c.vx) + Math.abs(c.vz)) > 0.01) ? Math.hypot(c.vx, c.vz) : Math.abs(c.v || 0); },
  rigX: function () { const c = CBZ.player._vehicle, ch = CBZ.playerChar; if (!c || !ch) return null;
    const g = (c.group.userData && c.group.userData.carVisual) || c.group;
    g.updateWorldMatrix(true, false);
    const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
    return new THREE.Vector3().copy(ch.group.position).applyMatrix4(inv).x; },
  /* A CLEAR STRETCH OF ROAD. Every speed measurement below is about friction
     and momentum, and the city is full of walls: the first cut of this probe
     measured a car WEDGED against a building (speed oscillating 4 -> 9 -> 5
     while it covered 0.4 m in five seconds, because collideVehicle pushed it
     back out every frame) and read that as "the coast is broken". So park on
     the longest straight road the generator made, pointing along it, and shove
     the ambient traffic out of the way first. */
  place: function () {
    const c = CBZ.player._vehicle; if (!c) return null;
    const A = CBZ.city && CBZ.city.arena;
    const roads = (A && A.roads) || [];
    let best = null;
    for (let i = 0; i < roads.length; i++) {
      const r = roads[i];
      if (!r || !(r.len > 0)) continue;
      if (!best || r.len > best.len) best = r;
    }
    if (!best) return null;
    for (const o of (CBZ.cityCars || [])) {
      if (o === c || o.dead) continue;
      if (Math.hypot(o.pos.x - best.x, o.pos.z - best.z) < 90) { o.pos.x += 900; o.pos.z += 900; }
    }
    c.pos.x = best.x; c.pos.z = best.z;
    // forward is (sin h, cos h): h=0 runs +Z, h=PI/2 runs +X.
    c.heading = best.vertical ? 0 : Math.PI / 2;
    c.v = 0; c.vx = 0; c.vz = 0; c.wreckT = 0; c._runaway = false;
    c.group.position.set(c.pos.x, c.group.position.y || 0, c.pos.z);
    CBZ.player.pos.set(c.pos.x, 0, c.pos.z);
    for (let i = 0; i < 10; i++) CBZ.stepSim(1 / 60);
    return { x: best.x, z: best.z, len: best.len, vertical: !!best.vertical };
  },
}; "ok"`;
check("probe installed", (await evl(HELPERS)) === "ok");

// ---- put the player in a fast car, on a road, and let the door arc finish ----
const seated = await evl(`(() => {
  CBZ.player.dead = false;
  const P = CBZ.player;
  const car = CBZ.citySpawnOwnedCar(P.pos.x + 5, P.pos.z, "Ferrari 488");
  if (!car) return "no car";
  P.pos.set(car.pos.x, 0, car.pos.z);
  CBZ.cityEnterVehicle(car);
  window.__pax.last = car;
  for (let i = 0; i < 240 && !P.driving; i++) CBZ.stepSim(1/60);   // the door arc
  return P.driving ? "driving" : "stuck-in-arc";
})()`);
check("player is driving a car", seated === "driving", String(seated));

// =============== 1. THE SEAT ===============
const seat = await evl(`(() => {
  const before = window.__pax.rigX();
  const ok = !!(CBZ.citySeatShift && CBZ.citySeatShift());
  window.__pax.step(6);
  const after = window.__pax.rigX();
  return { ok: ok, before: before, after: after,
           riding: !!(CBZ.cityPaxRiding && CBZ.cityPaxRiding()) };
})()`);
if (REVERT) {
  check("REVERT: the seat verb refuses", !seat.ok && !seat.riding, JSON.stringify(seat));
} else {
  check("seat verb accepted, ride is live", !!seat.ok && !!seat.riding, JSON.stringify(seat));
  const moved = seat.before != null && seat.after != null &&
    Math.sign(seat.after) === -Math.sign(seat.before) && Math.abs(seat.after - seat.before) > 0.4;
  check("the rig is in the OTHER seat", moved,
    `driver x=${seat.before && seat.before.toFixed(3)} → pax x=${seat.after && seat.after.toFixed(3)}`);
}

// =============== 2. THE DEAD PEDALS ===============
const dead = await evl(`(() => {
  const c = window.__pax.car();
  window.__pax.site = window.__pax.place();
  window.__pax.keys({ w: true });
  const before = window.__pax.spd();
  window.__pax.step(90);
  const after = window.__pax.spd();
  window.__pax.keys({});
  const a = CBZ.cityPaxAudit ? CBZ.cityPaxAudit() : null;
  return { before: before, after: after, ghost: a ? a.ghostThrottle : -1 };
})()`);
if (REVERT) {
  check("REVERT: holding W drives the car (no passenger exists)", dead.after > 2,
    `${dead.before.toFixed(2)} → ${dead.after.toFixed(2)} m/s`);
} else {
  check("holding W as a passenger moves nothing", dead.after < 0.15,
    `${dead.before.toFixed(2)} → ${dead.after.toFixed(2)} m/s`);
  check("RATCHET ghostThrottle == 0", dead.ghost === 0, "ghostThrottle=" + dead.ghost);
}

// =============== 3. THE DRIVERLESS COAST ===============
if (!REVERT) {
  const coast = await evl(`(() => {
    const c = window.__pax.car();
    window.__pax.place();
    const h = c.heading;
    c.v = 22; c.vx = Math.sin(h) * 22; c.vz = Math.cos(h) * 22;
    const x0 = c.pos.x, z0 = c.pos.z;
    let peak = 0;
    for (let i = 0; i < 1200; i++) { CBZ.stepSim(1/60); const s = window.__pax.spd(); if (s > peak) peak = s; }
    return { dist: Math.hypot(c.pos.x - x0, c.pos.z - z0), end: window.__pax.spd(), peak: peak };
  })()`);
  check("a car with nobody driving carries on", coast.dist > 25, `${coast.dist.toFixed(1)} m covered`);
  check("...and rolls to a stop", coast.end < 1.5, `ended at ${coast.end.toFixed(2)} m/s`);
  check("...without ever speeding up", coast.peak <= 22.5, `peak ${coast.peak.toFixed(2)} m/s`);
}

// =============== 4. BACK TO THE WHEEL ===============
if (!REVERT) {
  const back = await evl(`(() => {
    const ok = !!CBZ.citySeatShift();
    window.__pax.place();
    window.__pax.keys({ w: true });
    window.__pax.step(90);
    const after = window.__pax.spd();
    window.__pax.keys({});
    return { ok: ok, riding: !!CBZ.cityPaxRiding(), after: after };
  })()`);
  check("the wheel comes back", back.ok && !back.riding);
  check("...and the throttle works again", back.after > 4, `${back.after.toFixed(2)} m/s`);
}

// =============== 5. THE JUMP ===============
const jump = await evl(`(() => {
  const P = CBZ.player;
  const c = P._vehicle;
  if (!c) return { err: "not in a car" };
  P.hp = 100;
  window.__pax.place();
  const h = c.heading;
  c.v = 26; c.vx = Math.sin(h) * 26; c.vz = Math.cos(h) * 26;
  const hp0 = P.hp;
  const out = (CBZ.cityVehicleGetOut ? CBZ.cityVehicleGetOut() : CBZ.cityExitVehicle());
  const carSpeedRightAfter = Math.hypot(c.vx || 0, c.vz || 0);
  const air = !!(P._phys && P._phys.air);
  const x0 = c.pos.x, z0 = c.pos.z;
  for (let i = 0; i < 150; i++) CBZ.stepSim(1/60);
  return { out: !!out, driving: !!P.driving, hp: P.hp, hp0: hp0, air: air,
           carSpeed: carSpeedRightAfter,
           carRan: Math.hypot(c.pos.x - x0, c.pos.z - z0) };
})()`);
check("the exit verb ran", !!jump.out && !jump.driving, JSON.stringify(jump));
if (REVERT) {
  check("REVERT: stepping out at speed parks the car", jump.carSpeed < 0.01 && jump.carRan < 1,
    `car ${jump.carSpeed.toFixed(2)} m/s, ran ${jump.carRan.toFixed(2)} m`);
  check("REVERT: no bail damage", jump.hp >= jump.hp0, `hp ${jump.hp0} → ${jump.hp}`);
} else {
  check("jumping out launches the body", !!jump.air);
  check("...and it hurts, scaled by speed", jump.hp < jump.hp0, `hp ${jump.hp0} → ${jump.hp}`);
  check("...and the car keeps going", jump.carSpeed > 20 && jump.carRan > 15,
    `car left at ${jump.carSpeed.toFixed(1)} m/s and ran ${jump.carRan.toFixed(1)} m`);
}

// =============== 6. THE ORDINARY STEP-OUT ===============
if (!REVERT) {
  const stepOut = await evl(`(() => {
    const P = CBZ.player;
    P.dead = false; P.hp = 100;
    if (P._phys) { P._phys.air = false; P._phys.down = 0; P._phys.vx = P._phys.vz = P._phys.vy = 0; }
    const car = CBZ.citySpawnOwnedCar(P.pos.x + 5, P.pos.z, "Ferrari 488");
    if (!car) return { err: "no car" };
    P.pos.set(car.pos.x, 0, car.pos.z);
    CBZ.cityEnterVehicle(car);
    for (let i = 0; i < 240 && !P.driving; i++) CBZ.stepSim(1/60);
    if (!P.driving) return { err: "arc stuck" };
    car.v = 0; car.vx = 0; car.vz = 0;
    const hp0 = P.hp;
    CBZ.cityVehicleGetOut();
    return { driving: !!P.driving, hp: P.hp, hp0: hp0, air: !!(P._phys && P._phys.air) };
  })()`);
  check("standing still, the door is just a step out",
    !stepOut.err && !stepOut.driving && !stepOut.air && stepOut.hp === stepOut.hp0,
    JSON.stringify(stepOut));
}

// =============== 7. A HULL ===============
const hull = await evl(`(() => {
  const P = CBZ.player;
  P.dead = false; P.hp = 100;
  if (P._phys) { P._phys.air = false; P._phys.down = 0; }
  // marina.js redirects an owned hull to a real berth on real water, which is
  // the only place water_helm will own the frame.
  const b = CBZ.citySpawnOwnedCar(P.pos.x, P.pos.z, "Speedboat");
  if (!b) return { skip: "no hull could be spawned" };
  P.pos.set(b.pos.x, 0, b.pos.z);
  // The walk-to-the-door beat is boarding.js's and is not what this section
  // measures — and you cannot walk across water to a berth, so with the arc on
  // the probe just watches a player swim. Take the seat directly, then put the
  // flag back so nothing downstream sees a changed world.
  const prevArc = CBZ.CONFIG.CAR_DOOR_ARC;
  CBZ.CONFIG.CAR_DOOR_ARC = false;
  CBZ.cityEnterVehicle(b);
  CBZ.CONFIG.CAR_DOOR_ARC = prevArc;
  for (let i = 0; i < 60 && !P.driving; i++) CBZ.stepSim(1/60);
  const wet = !!(CBZ.cityWaterAt && CBZ.cityWaterAt(b.pos.x, b.pos.z));
  if (!P.driving) return { skip: "could not board the hull (marine=" +
    (CBZ.isMarineHull ? CBZ.isMarineHull(b) : "?") + " onWater=" + wet + ")" };
  const shifted = !!(CBZ.citySeatShift && CBZ.citySeatShift());
  b.v = 0; b.vx = 0; b.vz = 0;
  window.__pax.keys({ w: true });
  window.__pax.step(90);
  const after = Math.hypot(b.vx || 0, b.vz || 0);
  window.__pax.keys({});
  return { shifted: shifted, after: after, onWater: wet,
           riding: !!(CBZ.cityPaxRiding && CBZ.cityPaxRiding()) };
})()`);
if (hull.skip) {
  console.log("SKIP: hull — " + hull.skip);
} else if (REVERT) {
  check("REVERT: the helm verb refuses on a boat", !hull.shifted && !hull.riding, JSON.stringify(hull));
} else {
  check("a boat's helm hands over too", !!hull.shifted && !!hull.riding, JSON.stringify(hull));
  check("...and the unmanned helm takes no throttle", hull.after < 0.3, `${hull.after.toFixed(2)} m/s`);
}

// =============== 8. THE INVARIANTS ===============
const audit = await evl("CBZ.cityPaxAudit ? CBZ.cityPaxAudit() : null");
if (REVERT) {
  check("REVERT: the file is present but stood down", !!audit && audit.flags && audit.flags.seat === false,
    JSON.stringify(audit && audit.flags));
} else {
  check("RATCHET ghostThrottle pinned at 0", audit && audit.ghostThrottle === 0, JSON.stringify(audit));
  check("RATCHET orphanRides pinned at 0", audit && audit.orphanRides === 0);
  check("the aircraft gap is DECLARED, not faked", audit && audit.flags.aircraft === false);
  check("real work happened (shifts + bails + step-outs)",
    audit && audit.shifts >= 2 && audit.bails >= 1 && audit.stepOuts >= 1,
    `shifts=${audit && audit.shifts} bails=${audit && audit.bails} stepOuts=${audit && audit.stepOuts}`);
}

const realErrors = errors.filter((e) => !/ProgressEvent/.test(e));
check("no console exceptions", realErrors.length === 0, realErrors.slice(0, 4).join(" | "));

console.log(fails === 0 ? (REVERT ? "PASSENGER(revert): ok" : "PASSENGER: ok") : `PASSENGER: ${fails} FAILED`);
done(fails === 0 ? 0 : 1);
