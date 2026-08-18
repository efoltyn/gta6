#!/usr/bin/env node
/* tools/prison-sit-check.mjs — A SEATED BODY IS AT ITS SEAT. The numeric gate
   for SIT_PHYS_V1.

   OWNER (verbatim): "guys can sit on air, like, close to a chair, but, like,
   not on the chair. They can just sit on nothing, fix the physics."

   MEASURED FAULTS, live escape run on the pre-fix tree, all within ninety
   seconds of the morning yard block:

     · TEN cell residents in the full seated pose exactly 1.06 m from their
       own bunks — bunk latOut (0.56) + body radius (0.5), the depenetration
       signature. world/cellblock.js's leash pinned each man to the mattress
       edge at order 22.6 and systems/actorcollide.js's wall clamp (order 25)
       ejected him from the now-solid bunk frame every frame. The clamp ran
       later, so it won the frame, and the wing sat on air.
     · ONE yard sitter 2.13 m off the stool he legitimately claimed, still in
       the seated pose — nothing re-pins a seated PLAIN actor (peds pin
       themselves via state "sit"; the prison cast has no such owner), so the
       schedule's muster dragged him off his seat.
     · A body handed to the sit ARC glided the whole walk-in leg IN the seated
       pose (char.sitting latched before the arc, the walk phase wrote no rig
       state), measured seated at 2.25 m from the bench and closing.
     · The PLAYER could not sit in the prison at all: propuse's pin force-
       stands outside mode "city", so the sit arc completed and stood you
       straight back up — sat 0 of the next 160 frames.

   THE RATCHET THIS GATE HOLDS:

     seatDrift    (CBZ.cellblockAudit)  bunk-posed residents not at their
                                        bunk spot. Was 10; pinned at 0.
     airSitters   (CBZ.propUseAudit)    claimed seats whose occupant is in
                                        the seated pose >0.35 m from the
                                        anchor. Was 1+; pinned at 0.
     glideFault   (measured here)       frames of a live sit arc spent in the
                                        seated pose >0.8 m from the seat.
                                        Pinned at 0.
     player sit   (measured here)       sits on a prison bench, IS still
                                        seated 3 s later, at the anchor, and
                                        stands cleanly on propStand.

   --revert boots the same world with ?cfg_SIT_PHYS_V1=0 and asserts the
   OPPOSITE where the old tree misbehaved deterministically: seatDrift >= 1
   (the clamp ejects the wing again) and the player is back on his feet within
   two seconds of sitting. A probe that passes before and after proves nothing
   (mode-engine-check's law) — this one cannot.

   Boot boilerplate copied from tools/prison-beds-check.mjs (itself
   polish-check's, itself math-gate's), including the macOS Chrome fallback.
*/
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REVERT = process.argv.includes("--revert");
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 8880 + Math.floor(Math.random() * 40);
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const base = `http://127.0.0.1:${port}/`;
const target = base + (REVERT ? "?cfg_SIT_PHYS_V1=0" : "");
const dbg = 9880 + Math.floor(Math.random() * 40);
const profile = `/tmp/cbz-sit-${dbg}`;
await rm(profile, { recursive: true, force: true });
await sleep(700);
const CHROME_BIN = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "/opt/pw-browsers/chromium");
const chrome = spawn(CHROME_BIN, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--enable-webgl", "--mute-audio", "--window-size=1280,800",
  `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, target,
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
console.log(`playing(escape): ${playing}  flag: SIT_PHYS_V1=${REVERT ? "0" : "1"}`);
if (!playing) { console.log("ERRORS:", [...new Set(errors)].slice(0, 10)); done(2); }

const results = [];
function check(name, cond, detail) { results.push({ name, ok: !!cond }); console.log((cond ? "  ok  " : "FAIL  ") + name + (detail != null ? "  " + detail : "")); }

const step = (n) => evl(`for(var i=0;i<${n | 0};i++) CBZ.stepSim(1/60); return true;`);
// the clock is the world's sun — hold a block open by re-pinning the phase
// inside the page (the beds-check idiom, see that file's note on round trips)
const phaseOf = (hour) => ((hour - 6) / 24).toFixed(5);
async function holdHour(hour, seconds) {
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
  return evl("return CBZ.prisonSchedule ? CBZ.prisonSchedule.id() : null;");
}

// ---- 1. THE WING AT MORNING YARD — the bunk sitters -----------------------
// 7:00-11:30 is the yard block; the cell cast keeps its dealt poses. Twenty
// sim-seconds is ~40 leash/clamp rounds per body: if the clamp still ejects
// the wing, every bunk sitter has drifted by now.
const blk1 = await holdHour(9, 20);
const wing = await evl(`
  var c = CBZ.cellblockAudit ? CBZ.cellblockAudit() : null;
  if (!c) return { no: true };
  var sitters = 0, list = CBZ.npcs || [];
  for (var i = 0; i < list.length; i++) {
    var n = list[i];
    if (n && n._cellPose === "bunk" && n.char && n.char.sitting) sitters++;
  }
  return { block: "${blk1}", seatDrift: c.seatDrift, bunkSitters: sitters };`);
console.log("wing:", JSON.stringify(wing));
check("cell cast has bunk sitters (the measurement is not vacuous)", wing.bunkSitters >= 1, `bunkSitters=${wing.bunkSitters}`);
if (REVERT) {
  check("REVERT: the clamp ejects the wing again (seatDrift >= 1)", wing.seatDrift >= 1, `seatDrift=${wing.seatDrift}`);
} else {
  check("no bunk sitter is off his bunk (seatDrift 0)", wing.seatDrift === 0, `seatDrift=${wing.seatDrift}`);
}

// ---- 2. CHOW — claimed seats hold their bodies ----------------------------
// 11:30-13:00 is mess; systems/prisonrest.js sits a third of the hall. Forty
// sim-seconds spans many muster sweeps — the drag that pulled a sitter 2.13 m
// off his stool fired well inside that.
if (!REVERT) {
  const blk2 = await holdHour(12.2, 40);
  const chow = await evl(`
    var r = CBZ.prisonRestAudit ? CBZ.prisonRestAudit() : {};
    var u = CBZ.propUseAudit ? CBZ.propUseAudit() : {};
    var worst = 0, list = CBZ.npcs || [];
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (!a || !a._propSeat || !a.group || !a.char || !a.char.sitting) continue;
      if (CBZ.propArcActive && CBZ.propArcActive(a)) continue;
      var p = a.group.position, s = a._propSeat;
      var d = Math.hypot(p.x - s.x, p.z - s.z);
      if (d > worst) worst = d;
    }
    return { block: "${blk2}", seated: r.seated | 0, airSitters: u.airSitters, worst: Math.round(worst * 100) / 100 };`);
  console.log("chow:", JSON.stringify(chow));
  check("somebody actually sat down at chow", chow.seated >= 1, `seated=${chow.seated}`);
  check("no claimed sitter is off his seat (airSitters 0)", chow.airSitters === 0, `airSitters=${chow.airSitters}`);
  check("worst seated offset is arm's-length of zero", chow.worst <= 0.35, `worst=${chow.worst}m`);
}

// ---- 3. THE ARC WALKS, IT DOES NOT GLIDE ----------------------------------
// Hand one live inmate to CBZ.rest.sit from 2.3 m out and sample every frame
// of the transition: a body in the seated pose >0.8 m from the seat is the
// glide (entry points solve ~0.55 m out; the lower beat raises the flag well
// inside that). Also proves the arc really ran and the pin holds the landing.
if (!REVERT) {
  const glide = await evl(`
    var seats = [];
    CBZ.propSeatsIn(-30, 30, -8, 52, 0, seats);
    var s = null;
    for (var i = 0; i < seats.length; i++) if (!seats[i].occupant) { s = seats[i]; break; }
    if (!s) return { no: "seat" };
    var a = null, list = CBZ.npcs || [];
    for (var i = 0; i < list.length; i++) {
      var n = list[i];
      if (n && n.group && n.char && !n.char.sitting && !n._propSeat && !n._propBed && !n.dead
          && !(CBZ.rest && CBZ.rest.busy(n)) && !(CBZ.propArcActive && CBZ.propArcActive(n))) { a = n; break; }
    }
    if (!a) return { no: "inmate" };
    a.group.position.set(s.x + 2.3, 0, s.z);
    var ok = CBZ.rest.sit(a, s);
    if (!ok) return { no: "sit refused" };
    var glideFault = 0, arcSeen = 0;
    for (var f = 0; f < 240; f++) {
      CBZ.stepSim(1 / 60);
      var arc = CBZ.propArcActive(a);
      if (arc) arcSeen++;
      var p = a.group.position;
      var d = Math.hypot(p.x - s.x, p.z - s.z);
      if (a.char.sitting && d > 0.8) glideFault++;
      if (!arc && f > 30) break;
    }
    var p2 = a.group.position;
    return { arcSeen: arcSeen, glideFault: glideFault, sat: !!a.char.sitting,
             land: Math.round(Math.hypot(p2.x - s.x, p2.z - s.z) * 100) / 100 };`);
  console.log("glide:", JSON.stringify(glide));
  check("the sit arc actually ran", glide.arcSeen >= 10, `arcSeen=${glide.arcSeen}`);
  check("no frame of the arc sat on air (glideFault 0)", glide.glideFault === 0, `glideFault=${glide.glideFault}`);
  check("the body landed seated ON the seat", glide.sat && glide.land <= 0.35, `sat=${glide.sat} land=${glide.land}m`);
}

// ---- 4. THE PLAYER CAN SIT IN HIS OWN PRISON ------------------------------
// Tap-to-sit and the [E] card both end in CBZ.propSit(player, seat). Sit him
// on a yard bench, give the arc two seconds, then hold three more: the pin
// must keep him seated AT the anchor (the old guard stood him up the frame
// the arc finished). propStand must then release him cleanly.
const player = await evl(`
  var seats = [];
  CBZ.propSeatsIn(-30, 30, -8, 52, 0, seats);
  var s = null;
  for (var i = 0; i < seats.length; i++) if (!seats[i].occupant) { s = seats[i]; break; }
  if (!s) return { no: "seat" };
  var P = CBZ.player;
  P.pos.set(s.x + 1.2, 0, s.z + 0.6);
  if (CBZ.playerChar) CBZ.playerChar.group.position.set(P.pos.x, 0, P.pos.z);
  var ok = CBZ.propSit(P, s);
  for (var f = 0; f < 120; f++) CBZ.stepSim(1 / 60);          // the arc, generously
  var midSat = !!(CBZ.playerChar && CBZ.playerChar.sitting);
  for (var f = 0; f < 180; f++) CBZ.stepSim(1 / 60);          // three held seconds
  var p = P.pos;
  var held = { sat: !!(CBZ.playerChar && CBZ.playerChar.sitting), claim: !!P._propSeat,
               d: Math.round(Math.hypot(p.x - s.x, p.z - s.z) * 100) / 100 };
  CBZ.propStand(P, { instant: true });
  for (var f = 0; f < 30; f++) CBZ.stepSim(1 / 60);
  return { ok: ok, midSat: midSat, held: held,
           stood: !(CBZ.playerChar && CBZ.playerChar.sitting) && !P._propSeat };`);
console.log("player:", JSON.stringify(player));
check("propSit accepted the player", player.ok === true);
if (REVERT) {
  check("REVERT: the old guard stands the player straight back up", player.held && !player.held.sat && !player.held.claim,
    `sat=${player.held && player.held.sat}`);
} else {
  check("player is STILL seated three seconds on", player.held && player.held.sat && player.held.claim,
    `sat=${player.held && player.held.sat} claim=${player.held && player.held.claim}`);
  check("player is seated AT the seat", player.held && player.held.d <= 0.05, `d=${player.held && player.held.d}m`);
  check("propStand releases him cleanly", player.stood === true);
}

// ---- verdict --------------------------------------------------------------
const fails = results.filter((r) => !r.ok);
const uniqErrors = [...new Set(errors)].filter((e) => !/ProgressEvent/.test(e));
if (uniqErrors.length) console.log("page errors:", uniqErrors.slice(0, 8));
console.log(fails.length ? `PRISON-SIT: FAIL (${fails.length}/${results.length})` : `PRISON-SIT: ok (${results.length} checks)`);
done(fails.length ? 1 : 0);
