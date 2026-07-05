#!/usr/bin/env node
/* tools/race-check.mjs — THE RACING GAME gate.
   Boots the game headless, then exercises BOTH race products end-to-end
   against the real sim (no mocks):

   SPEEDWAY WEEKEND
   1. spawns + enters a car at the S/F line, starts the race
      (CBZ.cityStartSpeedwayRace → real-driver path)
   2. asserts a 6-car liveried field of REAL car records exists (in
      CBZ.cityCars, ai=false, brains attached)
   3. waits out the start-light countdown, then samples per-driver telemetry
      (param t, speed v) for a window: drivers must LAUNCH (v climbs from 0),
      show real speed variance (braking), progress along the track, and run
      corners slower than straights (the tri-oval's tight arcs are at
      t≈0/0.5, flat arcs at t≈0.25/0.75)
   4. screenshots the live race + HUD
   5. forces the finish by driving the player's S/F crossings (teleport the
      car back/forth across the line — the REAL lap-counting code path),
      then asserts: results board shown, purse paid, championship round
      bumped + points awarded, race book settled, field despawned
   STREET RACE
   6. opens the activity board, clicks Illegal Street Race → GO, asserts 3
      REAL rival cars spawn with road-legal waypoint paths, progress over a
      window, HUD live; screenshot; forfeit by exiting the car and assert
      full cleanup.

   Sim time crawls headless (~CLAUDE.md); the probe polls state, never
   wall-clock game events. Usage: node tools/race-check.mjs */
import { spawn } from "node:child_process";
import { rm, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SHOTS = path.join(ROOT, "tools/shots");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await mkdir(SHOTS, { recursive: true });

const port = 8890 + Math.floor(Math.random() * 40);
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], {
  env: { ...process.env, PORT: String(port) }, stdio: "ignore",
});
const base = `http://127.0.0.1:${port}/`;
const dbg = 9890 + Math.floor(Math.random() * 40);
const profile = `/tmp/cbz-race-${dbg}`;
await rm(profile, { recursive: true, force: true });
await sleep(700);
const chrome = spawn("/opt/pw-browsers/chromium", [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--enable-webgl", "--mute-audio", "--window-size=1440,900",
  `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, base,
], { stdio: "ignore" });

let page = null;
for (let i = 0; i < 80 && !page; i++) {
  try {
    const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json();
    page = ps.find((p) => p.type === "page" && p.url.startsWith(base));
  } catch (_) {}
  if (!page) await sleep(250);
}
if (!page) { console.error("FAIL: no page"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
let id = 1; const pending = new Map(); const errors = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") {
    const d = m.params.exceptionDetails;
    errors.push(`${d.url || "?"}:${d.lineNumber} ${(d.exception && d.exception.description || d.text || "").split("\n")[0]}`);
  } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
    errors.push("console.error: " + m.params.args.map((a) => a.value || a.description || "").join(" ").slice(0, 200));
  }
});
const send = (method, params = {}) => new Promise((r) => { const i = id++; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true });
  return r.result && r.result.result && r.result.result.value;
};
const shot = async (name) => {
  const s = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(path.join(SHOTS, name), Buffer.from(s.result.data, "base64"));
  console.log("shot:", path.join(SHOTS, name));
};
await send("Runtime.enable");
await send("Page.enable");

let fails = 0;
const check = (name, ok, detail) => {
  console.log((ok ? "PASS" : "FAIL") + ": " + name + (detail ? " — " + detail : ""));
  if (!ok) fails++;
};
// headless pointer lock is flaky: losing it drops the game into the PAUSED
// overlay and re-locking can be rejected without a user gesture — force the
// state machine directly whenever we need the sim running.
const resume = async () => {
  for (let i = 0; i < 10; i++) {
    if (await evl("CBZ.game.state === 'playing'")) return true;
    await evl("CBZ.setState && CBZ.setState('playing')");
    await sleep(400);
  }
  return await evl("CBZ.game.state === 'playing'");
};

// ---- boot + play ----
for (let i = 0; i < 60; i++) {
  if (await evl("!!(window.CBZ && CBZ.game && document.getElementById('playBtn'))")) break;
  await sleep(500);
}
let playing = false;
for (let i = 0; i < 120 && !playing; i++) {
  await evl("(() => { const b = document.getElementById('playBtn'); if (b) { b.click(); b.dispatchEvent(new MouseEvent('mousedown', {bubbles:true})); b.dispatchEvent(new MouseEvent('mouseup', {bubbles:true})); } return true; })()");
  await sleep(600);
  playing = await evl("!!(window.CBZ && CBZ.game && CBZ.game.state === 'playing')");
}
check("game playing", playing);
await evl("CBZ.dayPhase && CBZ.dayPhase(0.45)");   // daylight for legible shots

// ================= SPEEDWAY WEEKEND =================
// spawn + enter a fast car at the S/F line (t=0 of the oval → x=620, z=-330)
const setup = await evl(`(() => {
  const car = CBZ.citySpawnOwnedCar(618, -333, "Ferrari 488");
  if (!car) return "no car";
  CBZ.player.pos.set(car.pos.x, 0, car.pos.z);
  CBZ.cityEnterVehicle(car);
  CBZ.city.addCash(1000);
  // a zero-stake self-bet so the finish exercises the book settle path
  if (CBZ.cityRaceBook) CBZ.cityRaceBook.bet = { number: "you", label: "YOU", stake: 0, odds: 4 };
  CBZ.cityStartSpeedwayRace();
  return "ok";
})()`);
check("race started", setup === "ok", String(setup));
await sleep(1500);
const field = await evl(`(() => {
  const L = CBZ.raceDrivers ? CBZ.raceDrivers.list("speedway") : [];
  return {
    n: L.length,
    real: L.every((m) => m.car && CBZ.cityCars.indexOf(m.car) >= 0 && m.car.ai === false),
    liveried: L.every((m) => m.car && m.car.group && m.car.group.userData && !!m.car.group.userData.raceLivery),
    names: L.map((m) => m.name + " #" + m.number),
    gridHeld: L.every((m) => m.state === "grid" || m.state === "race"),
  };
})()`);
check("6-car field of REAL car records", field && field.n === 6 && field.real, JSON.stringify(field && field.names));
check("field is liveried", field && field.liveried);
const lights = await evl("(() => { const el = document.getElementById('raceLights'); return el && el.style.display !== 'none'; })()");
check("start-light gantry showing", !!lights);
await shot("race-grid.png");

// wait out the countdown (3.9 game-s; headless sim time crawls — poll)
let green = false;
for (let i = 0; i < 300 && !green; i++) {
  green = await evl("CBZ.raceDrivers.list('speedway').some((m) => m.state !== 'grid')");
  if (!green) await sleep(1000);
}
check("green flag (drivers released)", green);

// ---- telemetry window: do the opponents actually DRIVE? ----
// Headless sim time crawls (CLAUDE.md), so all rates are normalised by GAME
// time (the race kit's clock), and the window runs until ~22 game-seconds.
const snap = "JSON.stringify({ gt: CBZ.raceKit._last ? CBZ.raceKit._last.time : 0, d: CBZ.raceDrivers.list('speedway').map((m) => ({ t: +m.t.toFixed(4), v: +((m.car && m.car.v) || 0).toFixed(2), laps: m.laps, state: m.state, hp: m.car && m.car.engineHp })) })";
const s0 = JSON.parse(await evl(snap));
const samples = [];
let sN;
for (let i = 0; i < 160; i++) {
  sN = JSON.parse(await evl(snap));
  samples.push(sN);
  if (sN.gt - s0.gt > 22) break;
  await sleep(1000);
}
{
  const gameDt = Math.max(0.1, sN.gt - s0.gt);
  const n = s0.d.length;
  let launched = 0, varies = 0, progressed = 0;
  const speeds = [];
  const cornerV = [], straightV = [];
  for (let d = 0; d < n; d++) {
    const vs = samples.map((s) => s.d[d].v);
    const vmax = Math.max(...vs), vmin = Math.min(...vs.slice(Math.floor(vs.length / 3)));
    if (vmax > 22) launched++;
    if (vmax - vmin > 6) varies++;
    const prog = (sN.d[d].laps + sN.d[d].t) - (s0.d[d].laps + s0.d[d].t);
    const avgSpeed = prog * 800 / gameDt;              // lineLen ≈ 800m
    speeds.push(+avgSpeed.toFixed(1));
    if (avgSpeed > 8) progressed++;
    for (const s of samples) {
      const { t, v } = s.d[d];
      if (v < 12) continue;
      const corner = (t < 0.08 || t > 0.92) || (t > 0.42 && t < 0.58);
      const straight = (t > 0.17 && t < 0.33) || (t > 0.67 && t < 0.83);
      if (corner) cornerV.push(v); else if (straight) straightV.push(v);
    }
  }
  const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  console.log("telemetry:", samples.length, "samples over", gameDt.toFixed(1), "game-s · avg speeds", JSON.stringify(speeds));
  check("drivers launch to race speed (v>22)", launched >= 4, launched + "/" + n);
  check("drivers modulate speed (brake/accel spread >6)", varies >= 4, varies + "/" + n);
  check("field progresses along the track (avg >8 m/s)", progressed >= 4, progressed + "/" + n + " " + JSON.stringify(speeds));
  check("corners slower than straights", cornerV.length > 4 && straightV.length > 4 && avg(cornerV) < avg(straightV) - 2,
    "corner avg " + avg(cornerV).toFixed(1) + " vs straight avg " + avg(straightV).toFixed(1) +
    " (" + cornerV.length + "/" + straightV.length + " samples)");
}
const hudLive = await evl(`(() => {
  const rh = document.getElementById('raceHud');
  const pos = document.getElementById('rhPos');
  return { shown: rh && rh.style.display !== 'none', pos: pos && pos.textContent, lap: document.getElementById('rhLap') && document.getElementById('rhLap').textContent };
})()`);
check("race HUD live (position + lap)", hudLive && hudLive.shown && /^P\d+\/7$/.test(hudLive.pos || ""), JSON.stringify(hudLive));
await shot("race-live.png");

// ---- force the finish through the REAL lap-counting path: hop the player
//      FORWARD around the lap (t = 0.3 → 0.6 → 0.9 → 0.05) so every S/F
//      crossing is a forward crossing. Land 4u OUTSIDE the groove so we
//      don't teleport into the field. ----
await resume();
const cashBefore = await evl("CBZ.game.cash");
const roundBefore = await evl("CBZ.cityRacing ? CBZ.cityRacing.round : -1");
const hopTo = (t) => evl(`(() => {
  const CX = 470, CZ = -330, RX = 150, RZ = 95, TB = 16;
  const pt = (t) => { const a = t * Math.PI * 2; let x = CX + Math.cos(a) * RX, z = CZ + Math.sin(a) * RZ; const fr = Math.max(0, Math.sin(a)); z += fr * fr * TB; return { x, z }; };
  const p = pt(${t}), p2 = pt(${t} + 0.002);
  const dx = p2.x - p.x, dz = p2.z - p.z, L = Math.hypot(dx, dz) || 1;
  const nx = -dz / L, nz = dx / L;              // outward normal
  const c = CBZ.player._vehicle; if (!c) return false;
  c.pos.x = p.x + nx * 4; c.pos.z = p.z + nz * 4;
  c.heading = Math.atan2(dx / L, dz / L);
  c.v = 0; c.vx = 0; c.vz = 0;
  c.group.position.set(c.pos.x, 0, c.pos.z);
  c.group.rotation.y = c.heading;
  CBZ.player.pos.set(c.pos.x, 0, c.pos.z);
  return true;
})()`);
// headless can crawl below 1 fps — each hop must be SEEN by a race tick
// before the next one, or the S/F crossing (lastT→t) never registers.
const tickWait = async () => {
  const t0 = await evl("CBZ.raceKit._last ? CBZ.raceKit._last.time : 0");
  for (let i = 0; i < 40; i++) {
    await sleep(600);
    const t1 = await evl("CBZ.raceKit._last ? CBZ.raceKit._last.time : 0");
    if (t1 > t0) return true;
  }
  return false;
};
outer:
for (let lap = 0; lap < 4; lap++) {
  for (const t of [0.3, 0.6, 0.9, 0.05]) {
    await hopTo(t);
    await tickWait();
    if (await evl("(() => { const b = document.getElementById('raceBoard'); return b && b.style.display === 'block'; })()")) break outer;
  }
}
let finished = false;
for (let i = 0; i < 20 && !finished; i++) {
  finished = await evl("(() => { const b = document.getElementById('raceBoard'); return b && b.style.display === 'block'; })()");
  if (!finished) await sleep(700);
}
check("finish: results board shown", finished);
await shot("race-results.png");
const post = await evl(`JSON.stringify({
  cash: CBZ.game.cash,
  round: CBZ.cityRacing ? CBZ.cityRacing.round : -1,
  topPts: CBZ.cityRacing ? Math.max(...CBZ.cityRacing.racers.map((r) => r.points)) : -1,
  fieldLeft: CBZ.raceDrivers.list('speedway').length,
  betSettled: !CBZ.cityRaceBook.bet,
  boardText: (document.getElementById('raceBoard') || {}).textContent ? document.getElementById('raceBoard').textContent.slice(0, 120) : "",
})`);
const P = JSON.parse(post || "{}");
check("purse paid", P.cash > cashBefore, "$" + cashBefore + " → $" + P.cash);
check("championship round bumped", P.round === (roundBefore + 1) % 8, roundBefore + " → " + P.round);
check("championship points awarded to the field", P.topPts >= 18, "top " + P.topPts);
check("race book settled", !!P.betSettled);
check("field despawned", P.fieldLeft === 0);
await evl("CBZ.raceHud && CBZ.raceHud.closeResults()");

// ================= STREET RACE =================
const street = await evl(`(() => {
  // back on a city street with a car + cash
  CBZ.player.pos.set(10, 0, 10);
  const car = CBZ.citySpawnOwnedCar(10, 10, "Dodge Charger");
  if (!car) return "no car";
  CBZ.cityEnterVehicle(car);
  CBZ.city.addCash(1000);
  CBZ.cityOpenActivities("Racing");
  const card = document.querySelector("#cityActivities .ca-card[data-id=street-race]");
  if (!card) return "no card";
  card.click();
  const go = document.querySelector("#cityActivityModal [data-act=go]");
  if (!go) return "no go button";
  go.click();
  return "ok";
})()`);
check("street race started", street === "ok", String(street));
check("game resumed after menus", await resume());
await sleep(2000);
const sriv = await evl(`(() => {
  const L = CBZ.raceDrivers ? CBZ.raceDrivers.list("street") : [];
  return {
    n: L.length,
    real: L.every((m) => m.car && CBZ.cityCars.indexOf(m.car) >= 0),
    pathed: L.every((m) => m.path && m.path.length >= 3 && m.cpTotal > 0),
    hud: (document.getElementById('raceHud') || { style: {} }).style.display !== 'none',
  };
})()`);
check("3 REAL street rivals on road-legal paths", sriv && sriv.n === 3 && sriv.real && sriv.pathed, JSON.stringify(sriv));
check("street race HUD live", sriv && sriv.hud);
const w0 = await evl("JSON.stringify(CBZ.raceDrivers.list('street').map((m) => { const wp = m.path[Math.min(m.wpi, m.path.length - 1)]; return { w: m.wpi, x: +m.car.pos.x.toFixed(1), z: +m.car.pos.z.toFixed(1), dw: +Math.hypot(wp.x - m.car.pos.x, wp.z - m.car.pos.z).toFixed(1) }; }))");
// run ~8 game-seconds of street racing (adaptive — headless time crawls)
{
  const gt0 = await evl("CBZ.raceKit._last ? CBZ.raceKit._last.time : 0");
  for (let i = 0; i < 90; i++) {
    if (i % 10 === 0) await resume();          // pointer-lock churn re-pauses sometimes
    const gt = await evl("CBZ.raceKit._last ? CBZ.raceKit._last.time : 0");
    if (gt - gt0 > 8) break;
    await sleep(1000);
  }
}
const w1 = await evl("JSON.stringify(CBZ.raceDrivers.list('street').map((m) => { const wp = m.path[Math.min(m.wpi, m.path.length - 1)]; return { w: m.wpi, x: +m.car.pos.x.toFixed(1), z: +m.car.pos.z.toFixed(1), v: +m.car.v.toFixed(1), dw: +Math.hypot(wp.x - m.car.pos.x, wp.z - m.car.pos.z).toFixed(1) }; }))");
{
  const a = JSON.parse(w0), b = JSON.parse(w1);
  let moved = 0, onPath = 0;
  for (let i = 0; i < a.length; i++) {
    if (Math.hypot(b[i].x - a[i].x, b[i].z - a[i].z) > 8) moved++;
    // path-following = advanced a waypoint OR closed hard on the current one
    if (b[i].w > a[i].w || (b[i].w === a[i].w && a[i].dw - b[i].dw > 10)) onPath++;
  }
  check("street rivals drive (moved >8u)", moved >= 2, moved + "/" + a.length + " " + w1);
  check("street rivals follow the course", onPath >= 2, onPath + "/" + a.length + " " + w0 + " → " + w1);
}
await shot("race-street.png");
// forfeit by stepping out — the race must clean itself up (poll: sub-fps sim)
await resume();
await evl("CBZ.cityExitVehicle()");
let cleaned = null;
for (let i = 0; i < 60; i++) {
  cleaned = await evl(`(() => ({
    left: CBZ.raceDrivers.list('street').length,
    hud: (document.getElementById('raceHud') || { style: { display: 'none' } }).style.display,
  }))()`);
  if (cleaned && cleaned.left === 0) break;
  await sleep(1000);
}
check("street forfeit cleans up rivals", cleaned && cleaned.left === 0, JSON.stringify(cleaned));

// ---- console errors: only the pre-existing ProgressEvent is acceptable ----
const bad = errors.filter((e) => !/ProgressEvent|computeBoundingSphere/.test(e));
check("no new console errors", bad.length === 0, bad.slice(0, 4).join(" | "));

console.log(fails ? `RESULT: ${fails} FAILURES` : "RESULT: all checks passed");
try { chrome.kill(); } catch (_) {}
try { server.kill(); } catch (_) {}
process.exit(fails ? 1 : 0);
