#!/usr/bin/env node
/* tools/prison-beds-check.mjs — EVERY MAN HAS A BED. The numeric gate.

   OWNER (verbatim): "Scale the number of cells so every single NPC has a bed."

   MEASURED FAULT, on bfaccbd, live escape run at 23:00: 50 housed inmates
   against 42 registered mattresses — 26 in the cell house (13 doubles) and 16
   in the south dorm. `CBZ.prisonRestAudit().sleepGap` read +8. Eight men were
   ordered to bed every night by systems/prisonschedule.js's muster with nowhere
   to lie down, so they stood in the wing until dawn.

   AND THE OTHER HALF OF THE SAME ASK (2026-08-16). Capacity was solved and the
   wing still could not get the men into it: at the night block 23 of 61 men
   were lying down — 38% — with 43 racks free the whole time. Instrumented, it
   was four faults, and the biggest of them was that world/door.js's keycard
   leaf at (0, -8) is the cell house's ONLY entrance and is shut for the whole
   run, so fifty of the sixty-six racks were behind a door no inmate can open.
   `abed` is that fault as a number and this file pins its floor.

   THE RATCHET THIS FILE HOLDS, and there are only four numbers in it:

     abed          the share of the men this system is RESPONSIBLE for who are
                   actually LYING at the night block. 0.38 before the routing
                   wave; 0.85 on the finished one. Floor 0.60 — below every
                   post-wave measurement including a bad run, because the
                   metric carries irreducible run-to-run spread (§4b) and a
                   threshold set on a lucky run is worse than none. It is the
                   LOOSE half of this gate; the four below it are the ratchet.
     homelessInside a man standing INSIDE his own housing with no rack to his
                   name. 0 on every measured run; pinned at 0. NOT `homeless`,
                   which also counts men locked out in the yard — being locked
                   out is what securing a wing does.
     doubleClaimed racks with two names on them. Measured at 3; pinned at 0.
     lodged        bodies the sweep found inside a mattress and could not step
                   clear. See below on why this and not `bunkStanders` is what
                   a DAYLIGHT block can assert on.

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

   WHY THE DAYLIGHT ASSERTION ASKS `lodged` AND NOT `bunkStanders`. It used to
   ask `bunkStanders` and it flaked one run in four, and the flake was real
   information: systems/prisonrest.js sweeps bodies out of the bedding at 2 Hz,
   a walking man crosses a 1.04 x 2.36 m mattress footprint in far less than
   half a second, and this file sampled at an arbitrary phase between two
   sweeps. It was measuring TRAFFIC. `lodged` is the same scan taken one
   instruction after the sweep — bodies it found and could not move, because
   `CBZ.rest.stepOff` refuses a rack with no solved entry point rather than
   pushing a body into a wall. A mattress drawn without a propuse anchor, which
   is the failure the assertion exists for, still turns it red; a man walking
   past no longer does. Nothing is weakened: "nobody is LEFT standing in a
   mattress" is the assertion's own wording, and this is that sentence.

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
/* …AND THE RE-PIN LOOP RUNS INSIDE THE PAGE. It used to be two CDP round trips
   per half second of sim, which for the three-block evening below is well over
   a thousand of them and made the gate round-trip bound rather than sim bound.
   The loop is byte-identical in what it does to the world — pin the phase, step
   thirty frames, repeat — it just stops asking the debugger's permission twenty
   times a second. Kept to ten seconds of sim per evaluate so a slow build never
   sits inside one call long enough to look hung. */
async function holdHour(hour, seconds, wantId) {
  const chunks = Math.max(1, Math.round(seconds / 0.5));
  for (let i = 0; i < chunks; i += 20) {
    const n = Math.min(20, chunks - i);
    await evl(`var ph = ${phaseOf(hour)};
      for (var c = 0; c < ${n}; c++) {
        if (CBZ.dayPhase) CBZ.dayPhase(ph);
        for (var k = 0; k < 30; k++) CBZ.stepSim(1 / 60);
      }
      return true;`);
  }
  let blk = null;
  for (let i = 0; i < 40; i++) {
    await pin(hour); await step(6);
    blk = await evl(`return CBZ.prisonSchedule ? CBZ.prisonSchedule.id() : null;`);
    if (!wantId || blk === wantId) break;
  }
  return blk;
}
const runNight = (seconds) => holdHour(23, seconds, "night");
/* WALK THE EVENING, DO NOT JUMP INTO IT. The wing musters on the 18:30 klaxon,
   the leaves rack at 21:00 and the lights go out at 22:00, and each of those is
   an order the men are given time to obey — systems/prisonschedule.js opens the
   block gate for the count and shuts it behind the last man. Pinning straight
   to 23:00 from the boot block photographs a wing that was never given its
   evening, which is not the measurement the game makes. */
async function runEvening() {
  // the block lengths the game actually runs, at escape's 30 s/in-game-hour:
  // count 18:30-21:00 is 75 s, secure 21:00-22:00 is 30 s. Shortening the
  // count is not a faster gate, it is a different prison — a man walking in
  // from the sally port is 165 m out at 1.5-2.8 m/s and the evening return is
  // exactly as long as it needs to be for him.
  await holdHour(19, 75, "count");
  await holdHour(21.5, 30, "secure");
  return runNight(75);
}

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
    /* THE SAME PREDICATE sleepGap USES, AND THAT IS THE WHOLE POINT of the
       "agrees with an independent count" assertion two checks down: this line
       asked for a.escaped to be false and the build's own count does not, so
       the two disagreed by one the moment a single man went over the wire
       inside the four seconds before this sample — a second flake, found the
       same way as the first. Excluding the dead only is also the stricter
       reading for a boot-time CAPACITY claim: the wing must be able to sleep
       every rig it SPAWNS, and a man who has already got out is still one. */
    if (!a || a._crowd || !a.group || a.dead) continue;
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
const blk = await runEvening();
const night = await evl(`
  var r = CBZ.prisonRestAudit(), s = CBZ.prisonScheduleAudit();
  return { r: r, s: s, block: s.block, hour: s.hour, lightsOut: s.lightsOut };
`);
if (bad(night)) { check("night: the audit reads", false, why(night)); done(4); }
console.log("  ..  block:", night.block, "hour:", night.hour, "(held", blk + ")");
console.log("  ..  restAudit(night):", JSON.stringify(night.r));
// WHERE THE MEN WHO ARE NOT IN BED ARE STANDING. A residue you cannot locate
// is a residue you cannot argue with; every fault this gate's abed floor was
// written for was found by reading exactly this list off a live run.
console.log("  ..  still afoot:", JSON.stringify(night.r.afootAt));

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

/* ---- 4b. AND THE MEN ARE IN THEM (2026-08-16) ---------------------------
   Capacity is not the ask answered. `abed` is the share of the men this system
   is RESPONSIBLE for at lights-out who are actually lying down, and the routing
   wave took it from 0.38 to the 0.85-0.87 band.

   WHAT IS OUT OF THE DENOMINATOR, AND WHY EACH ONE IS NOT A FUDGE. `settling`
   drops the dead (no bed is owed), the escaped (a man over the wire is not a
   man the wing failed to bed — counting him would let a build score BETTER by
   losing prisoners) and the BUSY: knocked out, hunting, fighting, fleeing,
   grabbed. systems/prisonrest.js §3 is forbidden to touch those bodies at all
   — "a real brain state outranks the furniture" — so scoring it on them is
   scoring it on somebody else's work.

   THE VARIANCE THAT REMAINS, STATED PLAINLY, BECAUSE IT IS NOT ALL REMOVABLE.
   Excluding the busy took out one term. The dominant one is left: WHERE THE
   MEN HAPPEN TO BE STANDING WHEN THE 18:30 KLAXON SOUNDS. The social AI puts a
   different cast in the south block, the yard and the lower track every run,
   the block gate shuts at the 22:00 lights-out klaxon whatever is happening,
   and a man who was 120 m out at the return does not make it.

   WHAT WAS ACTUALLY MEASURED, AND ON WHAT — the builds were NOT identical, so
   the spread must not be quoted as if they were:

     0.38   38a1e5c, before any of this work
     0.78   routing wave, dorm lead-in still cutting the workshop corner
     0.64   same build, a run that left more men in the far south
     0.85   the complete build — and the only run on it so far

   ONE sample on the finished code is not a distribution. ABED_FLOOR is
   therefore set at 0.60, below every post-wave measurement including the bad
   one, and it is deliberately the LOOSE half of this gate: it exists to catch
   a regression back toward 0.38 and it does not prove the wave correct. THAT
   job belongs to the four assertions below it, every one of which read the
   same value on every run — bunkStanders 0, lodged 0, doubleClaimed 0,
   homelessInside 0 — plus the gate being shut at lights-out. Raise the floor
   when there are several runs on one build to raise it against; tightening it
   beyond ~0.85 is a DESIGN change, not a test change, because it means
   mustering earlier than the evening return or putting a second housing unit
   in the south block, and neither is this file's call to make.

   `homelessInside` is the invariant, and it is deliberately NOT `homeless`.
   Six to eight men are typically still in the yard when the gate racks shut,
   and being locked out is what securing a wing DOES — they are counted, named
   and printed by `afootAt` above, but they are not a fault. A man standing
   INSIDE his own housing with no mattress to his name is. */
const ABED_FLOOR = 0.60;          // below every post-wave measurement, incl. the bad one
check("night: MOST OF THE WING IS ACTUALLY IN A BED (abed >= 0.60)",
  night.r.abed != null && night.r.abed >= ABED_FLOOR,
  `abed=${night.r.abed} lying=${night.r.lying} of ${night.r.settling} settling` +
  ` (${night.r.inmates} rigs, ${night.r.inmates - night.r.live} over the wire, ${night.r.busy} in a brain state)`);
check("night: nobody who made the count is left without a rack",
  night.r.homelessInside === 0,
  `homelessInside=${night.r.homelessInside} (of ${night.r.homeless} with no rack; the rest are locked out in the yard)`);
check("night: no rack has two names on it",
  night.r.doubleClaimed === 0, `doubleClaimed=${night.r.doubleClaimed} reserved=${night.r.reserved}/${night.r.beds}`);
/* THE KEYCARD IS STILL THE KEYCARD. The wing gate is racked for the count and
   for nothing else — a schedule that left the escape objective standing open
   at 02:00 would have bought this number by giving the game away. */
check("night: the block gate is shut at lights-out",
  night.s.gateOpen === false && night.s.gateOpenOffCount === 0,
  `gateOpen=${night.s.gateOpen} openOffCount=${night.s.gateOpenOffCount} hold=${night.s.hold}`);

// ---- 5. AND IT SURVIVES THE DAY -------------------------------------------
// A capacity claim taken once at 23:00 proves nothing if the wing loses beds
// on a block change. Walk the clock through the day and back.
{
  const dayBlk = await holdHour(13, 12, "work");
  const day = await evl(`var r = CBZ.prisonRestAudit(); return { block: "${dayBlk}", beds: r.beds, inmates: r.inmates, gap: r.sleepGap, st: r.bunkStanders, lodged: r.lodged, lying: r.lying };`);
  const back = await runEvening();
  const again = await evl(`var r = CBZ.prisonRestAudit(); return { beds: r.beds, inmates: r.inmates, gap: r.sleepGap, st: r.bunkStanders, lying: r.lying };`);
  if (bad(day) || bad(again)) check("day: the audit reads", false, why(day) + " / " + why(again));
  else {
    console.log("  ..  restAudit(work block):", JSON.stringify(day), "held", back);
    check("day: the beds empty when the block is up", day.block === "work" && day.lying < night.r.lying, `block=${day.block} lying ${night.r.lying} -> ${day.lying}`);
    // …and the sweep that keeps bodies out of the bedding runs on the LIVE
    // wing, not only on a reset. A daylight block with a body LEFT standing in
    // a mattress is the owner's original sentence, whatever the beds count
    // says — and `lodged` is that sentence sampled where it means something
    // (see this file's header on the 1-in-4 flake it replaces).
    check("day: nobody is left standing in a mattress in daylight",
      day.lodged === 0, `lodged=${day.lodged} (bunkStanders sampled mid-sweep=${day.st})`);
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
