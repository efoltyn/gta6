#!/usr/bin/env node
/* tools/prison-beds-check.mjs — EVERY MAN HAS A BED. The numeric gate.

   OWNER (verbatim): "Scale the number of cells so every single NPC has a bed."

   MEASURED FAULT, on bfaccbd, live escape run at 23:00: 50 housed inmates
   against 42 registered mattresses — 26 in the cell house (13 doubles) and 16
   in the south dorm. `CBZ.prisonRestAudit().sleepGap` read +8. Eight men were
   ordered to bed every night by systems/prisonschedule.js's muster with nowhere
   to lie down, so they stood in the wing until dawn.

   THE RATCHET THIS FILE HOLDS, and there are only two numbers in it:

     sleepGap      housed inmates minus registered beds. MUST be <= 0, and it
                   is asserted AT THE NIGHT BLOCK, not at spawn — a wing that
                   sleeps everybody at t=0 and loses beds to a schedule change
                   has not solved anything.
     bunkStanders  bodies whose feet are inside a mattress rectangle while not
                   lying on it. Pinned at 0 by systems/prisonrest.js; a bed
                   added without a propuse anchor raises it, which is exactly
                   the "mattress with no anchor" failure this gate exists to
                   catch. A bare addBox slab would instead show up as beds not
                   rising at all, so both halves are checked.

   WHY THE ARITHMETIC IS NOT A CONSTANT. entities/npc.js:547 sizes the
   anonymous tier as `houses - npcs.length - cells`, so adding cells feeds back
   into the population: +1 cell = +2 racks, but also +1 cell-house resident
   (world/cellblock.js deals a body to every non-vacant cell) and possibly +1
   ambient body. The gate therefore measures the settled world rather than
   trusting any per-cell figure.

   Boot boilerplate copied from tools/prison-polish-check.mjs (itself
   jail-check's, itself math-gate's), including the macOS Chrome fallback.
*/
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 8940 + Math.floor(Math.random() * 40);
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const base = `http://127.0.0.1:${port}/`;
const dbg = 9940 + Math.floor(Math.random() * 40);
const profile = `/tmp/cbz-beds-${dbg}`;
await rm(profile, { recursive: true, force: true });
await sleep(700);
const CHROME_BIN = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "/opt/pw-browsers/chromium");
const chrome = spawn(CHROME_BIN, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--enable-webgl", "--mute-audio", "--window-size=1280,800",
  `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, base,
], { stdio: "ignore" });

function done(code) { try { chrome.kill("SIGTERM"); } catch (_) {} try { server.kill("SIGTERM"); } catch (_) {} rm(profile, { recursive: true, force: true }).catch(() => {}); process.exit(code); }

let page = null;
for (let i = 0; i < 80 && !page; i++) {
  try { const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json(); page = ps.find((p) => p.type === "page" && p.url.startsWith(base)); } catch (_) {}
  if (!page) await sleep(250);
}
if (!page) { console.error("FAIL: no page"); done(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
let id = 1; const pending = new Map(); const errors = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; errors.push(`${d.url || "?"}:${d.lineNumber} ${(d.exception && d.exception.description || d.text || "").split("\n")[0]}`); }
  else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") { errors.push("console.error: " + m.params.args.map((a) => a.value || a.description || "").join(" ").slice(0, 200)); }
});
const send = (method, params = {}) => new Promise((r) => { const i = id++; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: `(function(){${expr}})()`, returnByValue: true });
  if (r.result && r.result.exceptionDetails) return { __err: r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description };
  return r.result && r.result.result && r.result.result.value;
};
await send("Runtime.enable"); await send("Page.enable");

for (let i = 0; i < 90; i++) { if (await evl("return !!(window.CBZ && CBZ.bootComplete && CBZ.game)")) break; await sleep(500); }
let playing = false;
for (let i = 0; i < 40 && !playing; i++) {
  await evl("try{CBZ.setMode('escape'); CBZ.startRun && CBZ.startRun();}catch(e){return String(e);} return true;");
  await sleep(500);
  playing = await evl("return !!(CBZ.game && CBZ.game.state==='playing' && CBZ.game.mode==='escape');");
}
console.log("playing(escape):", playing);
if (!playing) { console.log("ERRORS:", [...new Set(errors)].slice(0, 10)); done(2); }

const results = [];
function check(name, cond, detail) { results.push({ name, ok: !!cond }); console.log((cond ? "  ok  " : "FAIL  ") + name + (detail != null ? "  " + detail : "")); }
function bad(r) { return !r || typeof r !== "object" || r.__err != null; }
function why(r) { return (r && r.__err) ? ("threw: " + String(r.__err).split("\n")[0]) : JSON.stringify(r); }

const step = (n) => evl(`for(var i=0;i<${n | 0};i++) CBZ.stepSim(1/60); return true;`);
/* THE CLOCK IS THE WORLD'S SUN and stepping the sim turns it (a 150 s day, so
   ten seconds of sim is an hour and a half). Re-pinning it every chunk is the
   only way to hold a block open long enough for forty men to walk to bed. */
const phaseOf = (hour) => ((hour - 6) / 24).toFixed(5);
const pin = (hour) => evl(`if (CBZ.dayPhase) CBZ.dayPhase(${phaseOf(hour)}); return CBZ.prisonSchedule ? CBZ.prisonSchedule.id() : null;`);
/* HOLD AN HOUR OPEN. Two things make this more than "set the phase and step":
   the clock is the WORLD'S SUN and stepping turns it, so the phase is re-pinned
   every half second rather than every two — a whole block is only an hour wide
   and a two-second chunk can walk clean through it. And systems/dayplan.js's
   `cur` only moves inside `poll()`, so the block the schedule BELIEVES it is in
   lags the phase until the next tick: the run is not at an hour until
   prisonSchedule.id() says so, and asserting on the phase instead is how this
   gate once reported "block=secure hour=23". */
async function holdHour(hour, seconds, wantId) {
  const chunks = Math.max(1, Math.round(seconds / 0.5));
  for (let i = 0; i < chunks; i++) { await pin(hour); await step(30); }
  let blk = null;
  for (let i = 0; i < 40; i++) {
    await pin(hour); await step(6);
    blk = await evl(`return CBZ.prisonSchedule ? CBZ.prisonSchedule.id() : null;`);
    if (!wantId || blk === wantId) break;
  }
  return blk;
}
const runNight = (seconds) => holdHour(23, seconds, "night");

// ---- 1. THE WING AS BOOTED ------------------------------------------------
await step(240);
const boot = await evl(`
  if (!CBZ.prisonBeds || !CBZ.prisonRestAudit) return { no: true };
  var w = CBZ.prisonBeds(), r = CBZ.prisonRestAudit(), c = CBZ.cellblockAudit();
  var pop = CBZ.prisonPopulationAudit ? CBZ.prisonPopulationAudit() : null;
  /* COUNTED HERE, NOT ASKED OF THE BUILD. A gate that reads the build's own
     sleepGap can only ever agree with it, and the fault this file exists for
     was partly IN that number: before 2026-08-15 systems/prisonrest.js asked
     \`role === "inmate"\` and \`role\` is a TRADE, so the prison's dealer, its
     two merchants and its five crew runners were not in the count and it
     reported 0 with eight men on their feet. entities/npc.js:26 stamps
     \`kind: "inmate"\` on every body its factory makes; \`_crowd\` still
     excludes the anonymous city tier; the old role test stays as an OR so
     nothing that used to count drops out. Run this gate against bfaccbd and
     THIS is the line that goes red. */
  var rigs = 0, list = CBZ.npcs || [], byRole = {};
  for (var i = 0; i < list.length; i++) {
    var a = list[i];
    if (!a || a._crowd || !a.group || a.dead || a.escaped) continue;
    if (a.kind !== "inmate" && a.role !== "inmate") continue;
    rigs++; byRole[a.role || "?"] = (byRole[a.role || "?"] | 0) + 1;
  }
  return { w: w, r: r, c: c, pop: pop, rigs: rigs, byRole: byRole };
`);
if (bad(boot) || boot.no) { check("wing: publishes its own capacity", false, why(boot)); done(3); }
console.log("  ..  prisonBeds():", JSON.stringify(boot.w));
console.log("  ..  cellblockAudit():", JSON.stringify(boot.c));
console.log("  ..  restAudit(boot):", JSON.stringify(boot.r));

check("wing: the cell house registers every rack it draws",
  boot.w.beds === boot.w.cells * boot.w.perCell + boot.w.housingStacks * 2 && boot.w.perCell >= 2,
  `cells=${boot.w.cells} perCell=${boot.w.perCell} beds=${boot.w.beds} dormStacks=${boot.w.housingStacks}`);
check("wing: the drawn mattresses reached the propuse registry",
  boot.r.beds === boot.w.beds,
  `restAudit.beds=${boot.r.beds} prisonBeds.beds=${boot.w.beds}`);
/* THE OWNER'S SENTENCE, WITH THE COUNT TAKEN BY THIS FILE. Asserted at BOOT
   and not at 23:00 on purpose: by the night block the run has lost men to
   fights and escapes, and a wing that only sleeps its population once some of
   it is dead has not been scaled. */
check("wing: it can sleep EVERY prisoner rig it spawns",
  boot.rigs - boot.r.beds <= 0,
  `rigs=${boot.rigs} ${JSON.stringify(boot.byRole)} beds=${boot.r.beds} short=${boot.rigs - boot.r.beds}`);
check("wing: the build's own sleepGap agrees with an independent count",
  boot.r.sleepGap === boot.rigs - boot.r.beds,
  `reported=${boot.r.sleepGap} measured=${boot.rigs - boot.r.beds}`);

// ---- 2. THE HELD COORDINATES ---------------------------------------------
// world/cellblock.js's header names them. Growing the block may not move one.
{
  const r = await evl(`
    var cb = CBZ.cellblock, S = CBZ.SPAWN, a = CBZ.cellblockAudit();
    var pc = cb.playerCell;
    return {
      spawn: { x: S.x, y: S.y, z: S.z },
      playerTag: pc && pc.tag, playerDoorZ: pc && pc.doorZ, playerX: pc && pc.x,
      inCell: a.spawnInPlayerCell, margin: a.spawnMargin, spawnBlocked: a.spawnBlocked,
      gap: a.doorGapBlocked, spine: a.spineBlocked,
      bounds: cb.bounds,
    };
  `);
  if (bad(r)) check("held: the audit reads", false, why(r));
  else {
    check("held: CBZ.SPAWN is still (-11, -39)", r.spawn.x === -11 && r.spawn.z === -39, JSON.stringify(r.spawn));
    check("held: SPAWN is 1.0 m north of the player cell's own door",
      r.playerTag === "A-1" && Math.abs((r.playerDoorZ - r.spawn.z) - 1.0) < 1e-6 && Math.abs(r.playerX - r.spawn.x) < 1e-6,
      `cell=${r.playerTag} doorZ=${r.playerDoorZ} cellX=${r.playerX}`);
    check("held: the player can stand where the game puts him",
      r.inCell === true && r.spawnBlocked === 0, `inCell=${r.inCell} margin=${r.margin} blocked=${r.spawnBlocked}`);
    check("held: the south throat and the patrol spine are clear",
      r.gap === 0 && r.spine === 0, `doorGapBlocked=${r.gap} spineBlocked=${r.spine}`);
    check("held: the shell footprint has not moved",
      r.bounds.minX === -15.5 && r.bounds.maxX === 15.5 && r.bounds.minZ === -43.5,
      JSON.stringify(r.bounds));
  }
}

// ---- 3. THE VENT, THE WAYPOINT, THE HATCHES: still open floor -------------
{
  const r = await evl(`
    var cb = CBZ.cellblock;
    function inCell(x, z) { var c = cb.cellAt(x, z, 0); return c ? c.tag : null; }
    return {
      vent: inCell(-14.2, -31),          // ventilation.js:41 crawl point
      post: inCell(0, -39),              // guards.js:79 patrol waypoint
      floorHatch: inCell(-12.2, -38.2),  // escape_routes.js:96 — INSIDE A-1 on purpose
      ceilHatch: inCell(11.6, -36.4),    // escape_routes.js:119 — must stay in the cross-aisle
      throat: inCell(0, -8),
    };
  `);
  if (bad(r)) check("held: the route points read", false, why(r));
  else {
    check("held: the ventilation crawl is not inside a cell", r.vent === null, `cellAt(-14.2,-31)=${r.vent}`);
    check("held: the officer-post waypoint is not inside a cell", r.post === null, `cellAt(0,-39)=${r.post}`);
    check("held: the utility crawl is still inside A-1", r.floorHatch === "A-1", `cellAt(-12.2,-38.2)=${r.floorHatch}`);
    check("held: the ceiling hatch is still in the cross-aisle", r.ceilHatch === null, `cellAt(11.6,-36.4)=${r.ceilHatch}`);
    check("held: the south throat is open floor", r.throat === null, `cellAt(0,-8)=${r.throat}`);
  }
}

// ---- 4. LIGHTS OUT: THE ONLY TWO NUMBERS THAT MATTER ----------------------
const blk = await runNight(90);
const night = await evl(`
  var r = CBZ.prisonRestAudit(), s = CBZ.prisonScheduleAudit();
  return { r: r, block: s.block, hour: s.hour, lightsOut: s.lightsOut };
`);
if (bad(night)) { check("night: the audit reads", false, why(night)); done(4); }
console.log("  ..  block:", night.block, "hour:", night.hour, "(held", blk + ")");
console.log("  ..  restAudit(night):", JSON.stringify(night.r));

check("night: the run is actually at lights-out",
  night.block === "night" && night.lightsOut === true, `block=${night.block} hour=${night.hour}`);
check("night: EVERY MAN HAS A BED (sleepGap <= 0)",
  night.r.sleepGap != null && night.r.sleepGap <= 0,
  `inmates=${night.r.inmates} beds=${night.r.beds} sleepGap=${night.r.sleepGap}`);
check("night: nobody is standing inside a mattress (bunkStanders 0)",
  night.r.bunkStanders === 0, `bunkStanders=${night.r.bunkStanders}`);
check("night: the beds are reachable — men are actually lying in them",
  night.r.lying > 0, `lying=${night.r.lying} of ${night.r.inmates}`);
check("night: no bed is a floor mat", night.r.mats === 0 && night.r.matsRefused === 0,
  `mats=${night.r.mats} refused=${night.r.matsRefused}`);

// ---- 5. AND IT SURVIVES THE DAY -------------------------------------------
// A capacity claim taken once at 23:00 proves nothing if the wing loses beds
// on a block change. Walk the clock through the day and back.
{
  const dayBlk = await holdHour(13, 12, "work");
  const day = await evl(`var r = CBZ.prisonRestAudit(); return { block: "${dayBlk}", beds: r.beds, inmates: r.inmates, gap: r.sleepGap, st: r.bunkStanders, lying: r.lying };`);
  const back = await runNight(60);
  const again = await evl(`var r = CBZ.prisonRestAudit(); return { beds: r.beds, inmates: r.inmates, gap: r.sleepGap, st: r.bunkStanders, lying: r.lying };`);
  if (bad(day) || bad(again)) check("day: the audit reads", false, why(day) + " / " + why(again));
  else {
    console.log("  ..  restAudit(work block):", JSON.stringify(day), "held", back);
    check("day: the beds empty when the block is up", day.block === "work" && day.lying < night.r.lying, `block=${day.block} lying ${night.r.lying} -> ${day.lying}`);
    // …and the sweep that keeps bunkStanders at 0 runs on the LIVE wing, not
    // only on a reset. A daylight block with a body standing in a mattress is
    // the owner's original sentence, whatever the beds count says.
    check("day: nobody is left standing in a mattress in daylight", day.st === 0, `bunkStanders=${day.st}`);
    check("day: no bed is lost to a block change", day.beds === night.r.beds && again.beds === night.r.beds,
      `beds ${night.r.beds} -> ${day.beds} -> ${again.beds}`);
    check("day: the gap stays closed across a full cycle", again.gap <= 0 && again.st === 0,
      `sleepGap=${again.gap} bunkStanders=${again.st}`);
  }
}

const okN = results.filter((r) => r.ok).length;
console.log(`\nPRISON-BEDS: ${okN}/${results.length} ok`);
const failed = results.filter((r) => !r.ok).map((r) => r.name);
if (failed.length) console.log("FAILED: " + failed.join(" | "));
const hard = [...new Set(errors)].filter((e) => !/favicon|Failed to load resource/i.test(e));
if (hard.length) console.log("console errors:", hard.slice(0, 6));
done(failed.length ? 1 : 0);
