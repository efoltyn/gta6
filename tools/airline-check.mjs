#!/usr/bin/env node
/* tools/airline-check.mjs — DOES AN AEROPLANE ACTUALLY GET THERE?

   The math gate proves the world still builds. It cannot prove the thing this
   wave exists for, which is a sentence about TIME: an airliner leaves a stand
   at one airport and, some minutes later, is parked at a stand at a different
   airport, having used a runway at both ends.

   So this probe boots the world once, fast-forwards the two dwell timers (the
   turnaround and the boarding window are wall-clock waiting, not behaviour),
   and then steps the simulation by hand until the shuttle parks — recording
   the phase timeline, the altitude envelope and the touchdown point as it
   goes. Everything it asserts is a NUMBER off live game state:

     1  both fields register, and CBZ.airportAudit().malformed is 0
     2  the frame is real: a local point round-trips through toWorld/toLocal,
        and the SECOND field's runway is genuinely off-axis (otherwise the
        whole packaging claim is untested)
     3  a shuttle claims a REAL parked airframe (a `placed` record with a
        cabin), not a new one
     4  it reaches every phase in order: boarding -> taxiOut -> lineup ->
        roll -> air -> rollout -> taxiIn -> park
     5  it left the ground (peak altitude) and came back to exactly 0
     6  the wheels touched down INSIDE the destination runway rectangle,
        measured in that runway's own local frame
     7  it ends parked at a stand belonging to the OTHER airport
     8  CBZ.airlineAudit().stranded is 0 and no console error fired

   Usage: node tools/airline-check.mjs [--seed 90210] [--dt 0.1] [--max 6000]
   Exit 0 = AIRLINE: ok.
*/
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const argS = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const SEED = +argS("--seed", "90210");
// dt 0.25 is the airline's OWN per-frame clamp, so the flight sees exactly the
// step it would see after a bad frame and nothing here is tested at a dt the
// shipping code refuses. It matters: a full-world stepSim costs ~0.4 s of wall
// clock here whatever dt you hand it, so 1/60 would spend forty minutes
// simulating four minutes of taxiing.
const DT = +argS("--dt", "0.25");
// A full leg is ~700 sim-seconds, and most of that is TAXI: a 1,090 m runway
// reached by a connector two-thirds of the way down it means a real backtrack.
// 3,600 ticks (900 sim-s) leaves headroom without waiting on a wedged run.
const MAX = +argS("--max", "3600");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const tmark = (l) => console.log(`[t+${((Date.now() - T0) / 1000).toFixed(1)}s] ${l}`);

async function claimPort(lo, span, probe) {
  for (let t = 0; t < 6; t++) {
    const p = lo + Math.floor(Math.random() * span);
    try { await probe(p); } catch (_) { return p; }
  }
  console.error("AIRLINE: FAIL no free port"); process.exit(1);
}
const port = await claimPort(9550, 120, (p) => fetch(`http://127.0.0.1:${p}/`));
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const origin = `http://127.0.0.1:${port}/`;
{ let up = false; for (let i = 0; i < 40 && !up; i++) { try { await fetch(origin); up = true; } catch (_) { await sleep(100); } }
  if (!up) { console.error("AIRLINE: FAIL devserver"); process.exit(1); } }
const dbg = await claimPort(10900, 150, (p) => fetch(`http://127.0.0.1:${p}/json/version`));
const profile = `/tmp/cbz-airline-${dbg}`;
await rm(profile, { recursive: true, force: true });
const CHROME_BIN = process.env.CBZ_CHROME ||
  (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/opt/pw-browsers/chromium");
const chrome = spawn(CHROME_BIN, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--enable-webgl", "--mute-audio", "--window-size=480,300",
  `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, `${origin}?seed=${SEED}`,
], { stdio: "ignore" });

let page = null;
for (let i = 0; i < 150 && !page; i++) {
  try { const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json(); page = ps.find((p) => p.type === "page" && p.url.startsWith(origin)); } catch (_) {}
  if (!page) await sleep(100);
}
if (!page) { console.error("AIRLINE: FAIL no page"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
let id = 1; const pend = new Map(); const errors = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") {
    const d = m.params.exceptionDetails;
    errors.push(`${d.url || "?"}:${d.lineNumber} ${(d.exception && d.exception.description || d.text || "").split("\n")[0]}`);
  } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
    errors.push("console.error: " + m.params.args.map((a) => a.value || a.description || "").join(" ").slice(0, 200));
  }
});
const send = (m, params = {}) => new Promise((r) => { const i = id++; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params })); });
const evl = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); return r.result && r.result.result && r.result.result.value; };
await send("Runtime.enable"); await send("Page.enable");

// ---- wait for the world (math-gate.mjs's own boot handshake: boot-complete
//      first, THEN click PLAY — clicking an early DOM fragment is the race) --
let ready = false;
for (let i = 0; i < 400 && !ready; i++) {
  try { ready = !!(await evl("!!(window.CBZ && CBZ.game && (CBZ.bootComplete || CBZ.game.state === 'title') && CBZ.stepSim && document.getElementById('playBtn'))")); } catch (_) {}
  if (!ready) await sleep(150);
}
if (!ready) { console.error("AIRLINE: FAIL never booted"); chrome.kill(); server.kill(); process.exit(1); }
let playing = false;
for (let i = 0; i < 240 && !playing; i++) {
  playing = await evl("(() => { if (CBZ.game && CBZ.game.state === 'playing') return true; const b = document.getElementById('playBtn'); if (b) b.click(); return CBZ.game && CBZ.game.state === 'playing'; })()");
  if (!playing) await sleep(200);
}
if (!playing) { console.error("AIRLINE: FAIL never reached playing"); chrome.kill(); server.kill(); process.exit(1); }
tmark("world built");

const fails = [];

// ---- 1 + 2: the registry and the frame ----------------------------------
const reg = await evl(`(() => {
  const a = CBZ.airportAudit ? CBZ.airportAudit() : null;
  if (!a) return { err: "no airportAudit" };
  const rows = a.rows.map(r => r.id + "/" + r.code + " rwy" + r.runway + " " + Math.round(r.len) + "m " + r.gates + "stands");
  const off = CBZ.airports.map(p => ({ id: p.id, yaw: +p.yaw.toFixed(3), axis: Math.min(Math.abs(Math.sin(p.yaw)), Math.abs(Math.cos(p.yaw))) }));
  return { count: a.count, gates: a.gates, desks: a.desks, malformed: a.malformed, rows, off };
})()`);
tmark("airports " + reg.count + " stands=" + reg.gates + " desks=" + reg.desks + " malformed=" + reg.malformed);
for (const r of reg.rows) tmark("  " + r);
if (reg.count < 2) fails.push("FEWER THAN TWO AIRPORTS: " + reg.count);
if (reg.malformed > 0) fails.push("MALFORMED AIRPORT RECORDS: " + reg.malformed);
if (!reg.off.some(o => o.axis > 0.12)) fails.push("NO OFF-AXIS FIELD — the frame is untested (every runway follows a world axis)");

// ---- 3: a shuttle on a real airframe ------------------------------------
const claim = await evl(`(() => {
  const A = CBZ.airlineAudit ? CBZ.airlineAudit() : null;
  if (!A) return { err: "no airlineAudit" };
  const recs = (CBZ.airportKit && CBZ.airportKit.records) ? CBZ.airportKit.records() : [];
  const s = CBZ.airlineShuttles[0];
  return {
    shuttles: A.shuttles, rows: A.rows,
    real: !!(s && recs.indexOf(s.rec) >= 0),
    cabin: !!(s && s.grp.userData.cabin && s.grp.userData.cabin.seats.length),
    seats: s ? s.grp.userData.cabin.seats.length : 0,
    cockpitSeats: s ? s.grp.userData.cabin.seats.filter(q => q.cockpit).length : 0,
    from: s ? s.at.code : null, to: s ? s.to.code : null,
  };
})()`);
tmark("shuttles " + claim.shuttles + " | first: " + claim.from + "->" + claim.to +
  " realParkedRecord=" + claim.real + " cabinSeats=" + claim.seats + " cockpitSeats=" + claim.cockpitSeats);
if (!claim.shuttles) fails.push("NO SHUTTLES CLAIMED AN AIRFRAME");
if (!claim.real) fails.push("SHUTTLE IS NOT FLYING A REGISTERED PARKED AIRCRAFT (it built its own)");
if (!claim.cockpitSeats) fails.push("NO COCKPIT SEATS — nothing for a pilot to sit in");

// ---- 4-7: fly the leg ---------------------------------------------------
await evl(`(() => {
  // skip the two DWELL timers; they are waiting, not behaviour.
  const s = CBZ.airlineShuttles[0];
  s.t = 1e4;
  window.__fl = {
    s: s, seen: [], maxAlt: 0, td: null, start: s.at.id,
    startPos: { x: s.grp.position.x, z: s.grp.position.z }, offRunway: 0,
  };
  return true;
})()`);

let ticks = 0, done = false, last = "";
while (ticks < MAX && !done) {
  const r = await evl(`(() => {
    const F = window.__fl, s = F.s;
    for (let i = 0; i < 60; i++) {
      // THE TWO DWELLS ARE WAITING, NOT BEHAVIOUR. The turnaround and the
      // boarding window are wall-clock timers; simulating 85 real seconds of
      // an aeroplane standing still proves nothing and costs a third of the
      // run. Everything from pushing the throttles up is simulated in full.
      if (s.phase === "turn" || s.phase === "boarding") s.t = 1e4;
      const prev = s.phase;
      CBZ.stepSim(${DT});
      if (s.dead) return { dead: true, phase: "dead" };
      if (s.phase !== prev) {
        F.seen.push(s.phase);
        if (prev === "air") F.td = { x: s.grp.position.x, z: s.grp.position.z, spd: s.spd };
      }
      if (s.alt > F.maxAlt) F.maxAlt = s.alt;
      // ROLLOUT DISCIPLINE: while braking, the wheels must stay on the runway.
      if (s.phase === "rollout") {
        const l = s.at.toLocal(s.grp.position.x, s.grp.position.z);
        if (Math.abs(l.lz) > s.at.runway.w / 2 + 4 || Math.abs(l.lx) > s.at.runway.len / 2 + 8) F.offRunway++;
      }
      if (s.phase === "turn" && F.seen.indexOf("park") >= 0) return { done: true, phase: s.phase };
    }
    return { phase: s.phase, alt: Math.round(s.alt), spd: Math.round(s.spd), at: s.at.code, to: s.to.code };
  })()`);
  ticks += 60;
  if (!r) { fails.push("PROBE LOST THE PAGE"); break; }
  if (r.dead) { fails.push("THE FLIGHT WAS ABANDONED MID-LEG"); break; }
  if (r.phase !== last) { tmark(`  t=${(ticks * DT).toFixed(0)}s sim  phase=${r.phase} alt=${r.alt || 0}m v=${r.spd || 0}m/s ${r.at || ""}`); last = r.phase; }
  if (r.done) done = true;
}

const fin = await evl(`(() => {
  const F = window.__fl, s = F.s;
  const A = CBZ.airlineAudit();
  let tdLocal = null, onRunway = false;
  if (F.td) {
    const l = s.at.toLocal(F.td.x, F.td.z);
    tdLocal = { lx: Math.round(l.lx), lz: Math.round(l.lz) };
    onRunway = Math.abs(l.lz) <= s.at.runway.w / 2 + 3 && Math.abs(l.lx) <= s.at.runway.len / 2;
  }
  const gate = s.gate;
  const atGate = !!(gate && Math.hypot(s.grp.position.x - gate.x, s.grp.position.z - gate.z) < 3);
  return {
    seen: F.seen, maxAlt: Math.round(F.maxAlt), offRunway: F.offRunway,
    start: F.start, ended: s.at.id, endedCode: s.at.code,
    moved: Math.round(Math.hypot(s.grp.position.x - F.startPos.x, s.grp.position.z - F.startPos.z)),
    tdLocal, onRunway, tdSpd: F.td ? Math.round(F.td.spd) : null,
    atGate, gate: gate ? gate.id : null, finalY: +s.grp.position.y.toFixed(3),
    stranded: A.stranded, crewed: A.crewed, rows: A.rows,
  };
})()`);

tmark("phases: " + fin.seen.join(" -> "));
tmark(`peak altitude ${fin.maxAlt}m | touchdown local (${fin.tdLocal ? fin.tdLocal.lx + "," + fin.tdLocal.lz : "-"}) at ${fin.tdSpd}m/s onRunway=${fin.onRunway} | rollout off-runway ticks ${fin.offRunway}`);
tmark(`${fin.start} -> ${fin.ended} (${fin.moved}m moved) parked at stand ${fin.gate} atGate=${fin.atGate} y=${fin.finalY} | stranded=${fin.stranded} crewed=${fin.crewed}`);

const NEED = ["taxiOut", "lineup", "roll", "air", "rollout", "taxiIn", "park"];
for (const p of NEED) if (fin.seen.indexOf(p) < 0) fails.push("PHASE NEVER REACHED: " + p);
if (!done) fails.push("THE LEG DID NOT COMPLETE within " + MAX + " ticks (" + (MAX * DT) + " sim-seconds)");
if (fin.maxAlt < 60) fails.push("IT NEVER REALLY FLEW: peak altitude " + fin.maxAlt + "m");
if (Math.abs(fin.finalY) > 0.01) fails.push("PARKED OFF THE GROUND: y=" + fin.finalY);
if (fin.start === fin.ended) fails.push("IT LANDED WHERE IT STARTED: " + fin.ended);
if (!fin.onRunway) fails.push("TOUCHDOWN WAS NOT ON THE DESTINATION RUNWAY: local " + JSON.stringify(fin.tdLocal));
if (fin.offRunway > 0) fails.push("IT LEFT THE RUNWAY DURING ROLLOUT: " + fin.offRunway + " ticks");
if (!fin.atGate) fails.push("IT DID NOT PARK ON ITS STAND (" + fin.gate + ")");
if (fin.stranded > 0) fails.push("STRANDED SHUTTLES: " + fin.stranded);

const known = (e) => /ProgressEvent/.test(e);
const bad = errors.filter((e) => !known(e));
if (bad.length) fails.push("CONSOLE ERRORS: " + bad.slice(0, 3).join(" | "));

chrome.kill("SIGTERM"); server.kill("SIGTERM");
if (fails.length) { console.error("AIRLINE: FAIL\n  " + fails.join("\n  ")); process.exit(1); }
console.log("AIRLINE: ok (" + fin.start + " -> " + fin.ended + ", peak " + fin.maxAlt + "m, stand " + fin.gate + ")");
process.exit(0);
