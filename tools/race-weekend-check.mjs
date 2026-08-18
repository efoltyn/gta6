#!/usr/bin/env node
/* tools/race-weekend-check.mjs — THE RACE-WEEKEND-V2 gate.

   race-check.mjs already proves the race RUNS (a real six-car field, drivers
   that launch, brake for corners and progress; a finish that pays and settles).
   This one proves the wave that made the weekend legible and the paint visible:

   A. THE PAINT  (CBZ.carPaintAudit)
      `washed` — body-paint materials whose env reflection out-weighs the car's
      own colour — must be 0, and the world must show more than a handful of
      distinct paints. Two-sided: `?cfg_CAR_PAINT_V2=0` must bring the fault
      BACK, because a fix nobody can turn off has not been measured.

   B. THE HUD  (CBZ.raceHud.audit)
      The tower, the track map, the sector bar, the fastest lap and the lap
      times all had NO producer before this wave — every one of them was
      structurally 0. `blindPanels` must reach 0 during a live race.

   C. THE RACE
      • the HUD is live ON THE GRID (POS/LAP populated during the countdown)
      • five start lamps, not three
      • the chequered flag opens a COOLDOWN instead of deleting the field
      • a retired car is not classified ahead of a running one
      • the slipstream tows somebody (CBZ.raceDraftAudit)

   Usage: node tools/race-weekend-check.mjs [--port N] [--keep] */
import { spawn } from "node:child_process";
import { rm, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SHOTS = path.join(ROOT, "tools/shots");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await mkdir(SHOTS, { recursive: true });

const argv = process.argv.slice(2);
const argPort = (() => { const i = argv.indexOf("--port"); return i >= 0 ? +argv[i + 1] : 0; })();

let server = null;
const port = argPort || (8890 + Math.floor(Math.random() * 40));
if (!argPort) {
  server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], {
    env: { ...process.env, PORT: String(port) }, stdio: "ignore",
  });
  await sleep(700);
}
const base = `http://127.0.0.1:${port}/`;

const CHROME_BIN = process.env.CBZ_CHROME ||
  (process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : "/opt/pw-browsers/chromium");

let fails = 0;
const check = (name, ok, detail) => {
  console.log((ok ? "PASS" : "FAIL") + ": " + name + (detail ? " — " + detail : ""));
  if (!ok) fails++;
};

/* ---- one browser session against a URL, returns {evl, shot, close} ------- */
async function session(url) {
  const dbg = 9700 + Math.floor(Math.random() * 200);
  const profile = `/tmp/cbz-rw-${dbg}`;
  await rm(profile, { recursive: true, force: true });
  const chrome = spawn(CHROME_BIN, [
    "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
    "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
    "--enable-webgl", "--mute-audio", "--window-size=1440,900",
    `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, url,
  ], { stdio: "ignore" });
  let page = null;
  for (let i = 0; i < 100 && !page; i++) {
    try {
      const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json();
      page = ps.find((p) => p.type === "page" && p.url.startsWith("http://127.0.0.1:" + port));
    } catch (_) {}
    if (!page) await sleep(300);
  }
  if (!page) { try { chrome.kill(); } catch (_) {} throw new Error("no page at " + url); }
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
      errors.push(`${(d.url || "?").split("/").pop()}:${d.lineNumber} ${(d.exception && d.exception.description || d.text || "").split("\n")[0]}`);
    } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      errors.push("console.error: " + m.params.args.map((a) => a.value || a.description || "").join(" ").slice(0, 180));
    }
  });
  const send = (method, params = {}) => new Promise((r) => { const i = id++; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evl = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: false });
    if (r.result && r.result.exceptionDetails) return { __err: String(r.result.exceptionDetails.text || "") + " " + ((r.result.exceptionDetails.exception || {}).description || "") };
    return r.result && r.result.result && r.result.result.value;
  };
  const shot = async (name) => {
    const s = await send("Page.captureScreenshot", { format: "png" });
    if (s.result && s.result.data) {
      await writeFile(path.join(SHOTS, name), Buffer.from(s.result.data, "base64"));
      console.log("      shot: tools/shots/" + name);
    }
  };
  await send("Runtime.enable");
  await send("Page.enable");
  // boot + click PLAY
  for (let i = 0; i < 80; i++) {
    if (await evl("!!(window.CBZ && CBZ.game && document.getElementById('playBtn'))")) break;
    await sleep(500);
  }
  let playing = false;
  for (let i = 0; i < 100 && !playing; i++) {
    await evl("(() => { const b = document.getElementById('playBtn'); if (b) { b.click(); b.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); b.dispatchEvent(new MouseEvent('mouseup',{bubbles:true})); } return 1; })()");
    await sleep(600);
    playing = await evl("!!(window.CBZ && CBZ.game && CBZ.game.state === 'playing')");
  }
  const resume = async () => {
    for (let i = 0; i < 10; i++) {
      if (await evl("CBZ.game.state === 'playing'")) return true;
      await evl("CBZ.setState && CBZ.setState('playing')");
      await sleep(350);
    }
    return await evl("CBZ.game.state === 'playing'");
  };
  const close = () => { try { ws.close(); } catch (_) {} try { chrome.kill(); } catch (_) {} };
  return { evl, shot, resume, close, errors, playing };
}

// ===========================================================================
//  A. THE PAINT — two-sided
// ===========================================================================
console.log("\n=== A. PAINT (CBZ.carPaintAudit) ===");
const paintOf = async (S) => {
  /* The speedway car park is the filmed case, but DO NOT go and stand in it:
     the lot filler is a deferred one-shot on CBZ.onUpdate(55.42) keyed to the
     arena root, not to where the player is, so the cars exist whether or not
     anybody is looking at them — and teleporting the player by writing `pos`
     drops him through the ground (no y solve), which loses the car later and
     took the whole race half of this gate down with it the first time. Boot,
     wait for the world's cars, census them where they stand. */
  await S.evl("CBZ.dayPhase && CBZ.dayPhase(0.45)");
  let a = null;
  for (let i = 0; i < 40; i++) {
    a = await S.evl("JSON.stringify(CBZ.carPaintAudit ? CBZ.carPaintAudit() : null)");
    const p = a ? JSON.parse(a) : null;
    if (p && p.cars > 12) return p;
    await sleep(1000);
  }
  return a ? JSON.parse(a) : null;
};

const after = await session(base);
check("boot (after side)", after.playing);
const pA = await paintOf(after);
console.log("   after :", JSON.stringify(pA));
check("A1 paint V2 is on", !!(pA && pA.v2));
check("A1 washed paints = 0", !!(pA && pA.washed === 0), pA ? pA.washed + "/" + pA.paints + " over load " + pA.maxMetalEnvLoad : "no audit");
check("A2 the car's own colour is most of it (diffuseShare > .6)",
  !!(pA && pA.minDiffuseShare > 0.6), pA ? String(pA.minDiffuseShare) : "-");
check("A3 the world is not one colour (distinct paints >= 6)",
  !!(pA && pA.distinctHex >= 6), pA ? pA.distinctHex + " distinct over " + pA.cars + " cars" : "-");
// A deliberately repainted car (a gang ride, a respray, a livery) is SUPPOSED
// to differ from its catalog hue, so this is a small budget with the offenders
// NAMED rather than a hard zero — a hard zero here would only ever be satisfied
// by deleting the repaint verbs.
check("A4 essentially every car wears the paint it was asked for",
  !!(pA && pA.mutedHex <= 2), pA ? pA.mutedHex + " of " + pA.cars + " " + JSON.stringify(pA.muted) : "-");

// ===========================================================================
//  B + C. THE RACE — on the same session
// ===========================================================================
/* ---- DRIVE THE CLOCK, DON'T WAIT ON IT ----------------------------------
   Under SwiftShader on a loaded machine this game renders at roughly 0.03
   game-seconds per wall second: the first draft of this gate polled for 200
   wall-seconds and got FOUR AND A HALF game-seconds of racing, which is not
   one sector of one lap, let alone a lap time or a fastest lap. So it looked
   like three broken panels and was a broken measurement.

   core/loop.js publishes `CBZ.stepSim(dt)` for exactly this: one full updater
   pass at a fixed dt with NO render. Stub rAF so the render loop stops
   re-arming itself, then the burst below IS the clock — a 3-lap race runs in
   seconds of CPU, at a fixed 1/60 step, identically on any machine. (The
   race-stadium visual preset uses the same freeze for the same reason.) */
const freezeClock = async () => after.evl(`(() => {
  if (window.__rafFrozen) return true;
  window.__rafFrozen = true;
  window.__rafReal = window.requestAnimationFrame;
  window.requestAnimationFrame = function () { return 0; };
  return true;
})()`);
// With rAF stubbed nothing renders on its own, so a screenshot would capture
// the last frame drawn before the freeze. Draw one on demand instead.
const draw = async () => after.evl("(() => { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (e) {} return 1; })()");
const burst = async (seconds, step) => {
  step = step || (1 / 60);
  const n = Math.round(seconds / step);
  // chunked so one evaluate never blocks the debugger for minutes
  const per = 600;
  for (let done = 0; done < n; done += per) {
    const k = Math.min(per, n - done);
    await after.evl(`(() => { for (let i = 0; i < ${k}; i++) CBZ.stepSim(${step}); return 1; })()`);
  }
};


console.log("\n=== B/C. THE RACE WEEKEND ===");
await after.resume();
// Freeze the render loop HERE, before anything that needs sim ticks: the
// boarding arc below is driven by updaters, and waiting on rendered frames for
// it is the same 0.03-game-seconds-per-wall-second trap as waiting on the race.
await freezeClock();
/* SEATING THE PLAYER IS NOT SYNCHRONOUS. city/boarding.js WRAPS
   `cityEnterVehicle` with a walk-to-your-own-door arc: the call returns true
   immediately and `player.driving` only flips when the arc lands, several sim
   ticks later. Calling the race verb in the same breath therefore hits
   startRace's `if (!P.driving) { note("Get in a car to race."); return; }` and
   the whole weekend silently does not happen. Seat first, THEN drop the flag. */
const seated = await after.evl(`(() => {
  const car = CBZ.citySpawnOwnedCar(618, -333, "Ferrari 488");
  if (!car) return "no car";
  CBZ.player.pos.set(car.pos.x, 0, car.pos.z);
  CBZ.cityEnterVehicle(car);
  CBZ.city.addCash(1000);
  return "ok";
})()`);
check("player car spawned", seated === "ok", String(seated));
let driving = false;
for (let i = 0; i < 40 && !driving; i++) {
  await after.resume();
  await burst(0.5);
  driving = await after.evl("!!(CBZ.player.driving && CBZ.player._vehicle)");
}
check("player is in the car (boarding arc landed)", driving);
const setup = await after.evl(`(() => {
  CBZ.cityStartSpeedwayRace();
  const S = CBZ.speedwayRaceState();
  if (!S.active) return "race refused";
  if (!S.rd) return "fell back to the LEGACY spline field (rd=false)";
  return "ok";
})()`);
check("race started on the real-driver path", setup === "ok", String(setup));
// One tick of the frozen clock: tickRD is what fills the HUD, and with rAF
// stubbed nothing runs on its own. 0.3 s is a tick, and is nowhere near the
// 3.9 s countdown — so this reads the GRID, which is the point of C2/B1.
await burst(0.3);

// ---- ON THE GRID: the HUD must already be saying something -----------------
const grid = await after.evl(`JSON.stringify((() => {
  const S = CBZ.speedwayRaceState();
  const t = (id) => { const e = document.getElementById(id); return e ? e.textContent : null; };
  const lit = Array.prototype.filter.call(document.querySelectorAll('#raceLights .lamp'), (l) => /red|green/.test(l.className)).length;
  return {
    phase: S.phase, lamps: document.querySelectorAll('#raceLights .lamp').length, lit: lit,
    pos: t('rhPos'), lap: t('rhLap'),
    towerRows: document.querySelectorAll('#rhTower .rRow').length,
    mapShown: !!(document.getElementById('rhMap') && document.getElementById('rhMap').style.display !== 'none'),
  };
})())`);
const G = grid ? JSON.parse(grid) : {};
console.log("   grid  :", grid);
check("C1 five start lamps (was three)", G.lamps === 5, String(G.lamps));
check("C2 HUD is LIVE on the grid (POS/LAP not em-dashes)",
  /^P\d+\/\d+$/.test(G.pos || "") && /^\d+\/\d+$/.test(G.lap || ""), G.pos + " " + G.lap);
check("B1 timing tower shows the whole field on the grid", G.towerRows >= 6, String(G.towerRows));
check("B2 track map mounted", !!G.mapShown);
/* C2b THE GRID IS A GRID. Every car is stationary on a painted slot a few
   metres apart, so no two of them can be seconds apart — an interval on the
   grid larger than a couple of seconds means somebody's course parameter was
   seeded on the wrong side of the start line and they are being scored a lap
   down before the lights go out. That is exactly what `coarseParam` did to the
   POLE car (see island_speedway.js gridSlot), and this is the number that
   catches it coming back. */
const gridGaps = await after.evl(`JSON.stringify((() => {
  const kit = CBZ.raceKit._last; if (!kit) return null;
  kit.update(0);
  const tot = kit.order.map((e) => +e.total.toFixed(4));
  let worst = 0;
  for (let i = 1; i < kit.order.length; i++) worst = Math.max(worst, kit.gapSeconds(kit.order[i-1], kit.order[i]));
  return { totals: tot, worstGap: +worst.toFixed(1), spread: +(Math.max.apply(null, tot) - Math.min.apply(null, tot)).toFixed(4) };
})())`);
const GG = gridGaps ? JSON.parse(gridGaps) : null;
console.log("   gridGaps:", gridGaps);
check("C2b nobody is a lap down ON THE GRID (progress spread < 0.2 lap)",
  !!(GG && GG.spread < 0.2), GG ? "spread " + GG.spread + " worst interval " + GG.worstGap + "s" : "-");
await after.shot("rw-grid.png");

// ---- green flag ------------------------------------------------------------
await after.resume();
let green = false;
for (let i = 0; i < 40 && !green; i++) {
  await burst(0.5);
  green = await after.evl("CBZ.speedwayRaceState().phase !== 'grid'");
}
check("green flag", !!green);

/* ---- AND SOMEBODY HAS TO DRIVE ------------------------------------------
   The first version of this window let the field race while the player sat on
   his grid slot with the throttle shut, then reported that lap times and
   sector times "had no producer". They have a producer; nobody had driven past
   a timing line. YOUR lap time is your lap.

   The player is walked along the real centreline at racing pace — position and
   heading written, then one sim step — so every read comes out of the SHIPPING
   code path: island_speedway's own S/F crossing counter increments the lap,
   its own sectorTick closes the sectors, and raceKit times them. Nothing here
   tells the game what a lap time is; it drives, and the game says. */
const drivePlayer = async (seconds, mps) => {
  const n = Math.round(seconds * 60);
  const per = 300;
  for (let done = 0; done < n; done += per) {
    const k = Math.min(per, n - done);
    await after.evl(`(() => {
      const c = CBZ.player && CBZ.player._vehicle; if (!c) return 0;
      const L = CBZ.speedwayTrackLen(), dt = 1/60, v = ${mps || 36};
      let t = CBZ.speedwayCourse.paramAt(c.pos.x, c.pos.z);
      for (let i = 0; i < ${k}; i++) {
        t = (t + v * dt / L) % 1;
        const f = CBZ.speedwayFrame(t);
        const y = CBZ.speedwaySurfaceY ? CBZ.speedwaySurfaceY(f.x, f.z) : 0;
        c.pos.x = f.x; c.pos.z = f.z; c.heading = f.heading; c.v = v;
        c.vx = Math.sin(f.heading) * v; c.vz = Math.cos(f.heading) * v;
        c.group.position.set(f.x, y, f.z); c.group.rotation.y = f.heading;
        CBZ.player.pos.set(f.x, y, f.z);
        CBZ.stepSim(dt);
      }
      return 1;
    })()`);
  }
};

// ---- run a real race window and watch the reads appear ---------------------
{
  // Three laps of an 800 m oval at 36 m/s is ~67 game-seconds, so lap times,
  // all three sectors and a fastest lap all have room to actually happen.
  let last = null;
  for (let i = 0; i < 24; i++) {
    await drivePlayer(4);
    last = await after.evl(`JSON.stringify({
      gt: CBZ.raceKit._last ? CBZ.raceKit._last.time : 0,
      hud: CBZ.raceHud.audit(),
      draft: CBZ.raceDraftAudit ? CBZ.raceDraftAudit() : null,
      sec: (CBZ.speedwayRaceState().secShow || []).filter(Boolean).length,
      flap: CBZ.speedwayRaceState().flap,
      done: CBZ.speedwayRaceState().playerDone,
    })`);
    const L = last ? JSON.parse(last) : null;
    if (L && (L.done || (L.sec >= 3 && L.flap > 0))) break;
  }
  const L = last ? JSON.parse(last) : {};
  console.log("   live  :", last);
  await draw(); await after.shot("rw-live.png");
  const H = L.hud || {};
  check("B3 tower fed", H.towerRows >= 6, String(H.towerRows));
  check("B4 map fed with every car", H.mapCars >= 7, String(H.mapCars));
  check("B5 lap times reach the HUD", !!(H.panels && H.panels.lapTimes), JSON.stringify(H.panels));
  check("B6 sector times produced", (L.sec || 0) > 0 || H.sectors > 0, "secShow " + L.sec + " seen " + H.sectors);
  check("B7 fastest lap of the field produced", (L.flap || 0) > 0, String(L.flap));
  check("B8 no blind panels left", H.blindPanels === 0, "blind " + H.blindPanels + " " + JSON.stringify(H.panels));
  check("C3 slipstream tows somebody", !!(L.draft && L.draft.towsSeen > 0),
    L.draft ? "tows " + L.draft.towsSeen + " peak " + L.draft.peak : "no audit");
}

/* ---- the flag opens a COOLDOWN, it does not delete the field ---------------
   Keep driving until the player takes the chequered flag, then look at the
   world in that very frame: before this wave `endRaceRD` fired on the same
   tick the player crossed and `despawnAll("speedway")` deleted six cars
   mid-corner under a results board. The rivals have to still BE there. */
let sawCooldown = false, cooldownFieldAlive = 0, sawBoard = false;
for (let i = 0; i < 40; i++) {
  await drivePlayer(2);
  const st = await after.evl(`JSON.stringify((() => { const S = CBZ.speedwayRaceState(); return {
    phase: S.phase, done: S.playerDone, laps: S.playerLaps,
    field: CBZ.raceDrivers.list('speedway').length,
    board: !!(document.getElementById('raceBoard') && document.getElementById('raceBoard').style.display === 'block'),
  }; })())`);
  const S = st ? JSON.parse(st) : {};
  if (S.done && !sawCooldown) {
    sawCooldown = true; cooldownFieldAlive = S.field;
    console.log("   flag  :", st);
    await draw(); await after.shot("rw-cooldown.png");
  }
  if (S.board) { sawBoard = true; break; }
}
check("C4 the flag opens a cool-down, the race does not just stop",
  sawCooldown, sawCooldown ? "field still on track: " + cooldownFieldAlive : "never latched playerDone");
check("C5 the field is still racing during the cool-down", cooldownFieldAlive >= 5, String(cooldownFieldAlive));

// PARKING IT CALLS THE RESULTS IN — the third way out of the cool-down.
let finished = sawBoard;
for (let i = 0; i < 30 && !finished; i++) {
  await after.evl("(() => { const c = CBZ.player._vehicle; if (c) { c.v = 0; c.vx = 0; c.vz = 0; } return 1; })()");
  await burst(1.5);
  finished = await after.evl("!!(document.getElementById('raceBoard') && document.getElementById('raceBoard').style.display === 'block')");
}
check("C6 results board shown after the cool-down", finished);
await draw(); await after.shot("rw-results.png");
const board = await after.evl(`JSON.stringify((() => {
  const rows = Array.prototype.map.call(document.querySelectorAll('#raceBoard .row'), (r) => r.innerText.replace(/\\s+/g, ' ').trim());
  return { rows: rows, text: (document.getElementById('raceBoard') || {}).innerText || "" };
})())`);
const B = board ? JSON.parse(board) : {};
console.log("   board :", JSON.stringify((B.rows || []).slice(0, 9)));
check("C7 the board carries a best-lap column", /Best lap/i.test(B.text || ""));
check("C8 the board names a fastest lap", /Fastest lap/i.test(B.text || ""));

/* ===========================================================================
   D. THE SPEEDOMETER SAYS WHICH UNIT IT IS, AND MEANS IT
   Owner: "the normal cars in gang city show km/h on the speedometer not mph."
   A world unit is a metre and car.v is units/s, so 1 u/s is 2.2369 mph and 3.6
   km/h exactly. Three consumers each used to carry their own factor (2.4, 2.4
   and a self-described "rough" 3.0) — and 3.0 on a 35 u/s sedan draws 105 under
   an MPH label when the true mph is 78 and the true km/h is 126, which is how a
   speedometer comes to read like the other unit. One conversion now.
   =========================================================================== */
console.log("\n=== D. SPEEDOMETER UNITS ===");
const spd = await after.evl(`JSON.stringify((() => {
  if (!CBZ.speedRead) return null;
  const was = CBZ.CONFIG.CAR_SPEED_UNIT;
  CBZ.CONFIG.CAR_SPEED_UNIT = "mph"; const m = CBZ.speedRead(35);
  CBZ.CONFIG.CAR_SPEED_UNIT = "kmh"; const k = CBZ.speedRead(35);
  CBZ.CONFIG.CAR_SPEED_UNIT = was;
  return { mph: m, kmh: k, mphOf10: CBZ.speedMph(10), limit55: CBZ.speedLimitRead(55) };
})())`);
const D = spd ? JSON.parse(spd) : null;
console.log("   speed :", spd);
check("D1 one conversion is published", !!D);
check("D2 a 35 u/s sedan is 78 MPH, not 84 and not 105",
  !!(D && D.mph && D.mph.n === 78 && D.mph.unit === "MPH"), D ? JSON.stringify(D.mph) : "-");
check("D3 the same car is 126 KM/H when asked in km/h",
  !!(D && D.kmh && D.kmh.n === 126 && D.kmh.unit === "KM/H"), D ? JSON.stringify(D.kmh) : "-");
check("D4 both units come off the same metres-per-second (ratio 1.609)",
  !!(D && Math.abs(D.kmh.n / D.mph.n - 1.609344) < 0.01),
  D ? (D.kmh.n / D.mph.n).toFixed(4) : "-");
check("D5 speeding is judged in the same mph the dial draws",
  !!(D && Math.abs(D.mphOf10 - 22.369) < 0.01), D ? String(D.mphOf10) : "-");

const bad = (after.errors || []).filter((e) => !/ProgressEvent|computeBoundingSphere/.test(e));
check("no new console errors", bad.length === 0, bad.slice(0, 4).join(" | "));
after.close();

// ===========================================================================
//  A (revert side) — the fault must COME BACK with the flag off
// ===========================================================================
console.log("\n=== A(revert). ?cfg_CAR_PAINT_V2=0 ===");
try {
  const before = await session(base + "?cfg_CAR_PAINT_V2=0");
  const pB = await paintOf(before);
  console.log("   before:", JSON.stringify(pB));
  check("A5 revert restores the authored numbers", !!(pB && pB.v2 === false));
  check("A6 the WASH comes back with the flag off (two-sided proof)",
    !!(pB && pB.washed > 0), pB ? pB.washed + "/" + pB.paints + " washed, load " + pB.maxMetalEnvLoad : "-");
  check("A7 and diffuse share collapses",
    !!(pB && pA && pB.minDiffuseShare < pA.minDiffuseShare - 0.15),
    pB && pA ? pB.minDiffuseShare + " vs " + pA.minDiffuseShare : "-");
  before.close();
} catch (e) {
  check("A5-A7 revert side ran", false, String(e && e.message || e));
}

console.log(fails ? `\nRESULT: ${fails} FAILURES` : "\nRESULT: all checks passed");
if (server) { try { server.kill(); } catch (_) {} }
process.exit(fails ? 1 : 0);
