#!/usr/bin/env node
/* tools/president-check.mjs — THE PRESIDENT PLAYS. One boot, every organ.

   Boots the real title-card President run (seed 260811 unless --seed), then
   asks each organ of the mode the one question a player asks of it, in the
   order a player meets them:
     presidency.js   status()/site()/events — the spine every other organ reads
     president_hud   is the strip on screen while I hold the seat
     president_agenda after a new day, did the Chief of Staff hand me work
     motorcade       is the car in the court; does go() actually move me
     presidency.js   arm an attack: does it come to MY gate as bodies
     president_regime declare a dictatorship: does the house change
     interior_programs the audited rooms did not regress
   Every organ is feature-detected: an organ that is not loaded SKIPS (so the
   gate is useful while the wave is half built) — but an organ that IS loaded
   and answers wrong FAILS. Page errors from any president file fail the run.

   Days are advanced through polity's own wrap hook (_checkDayWrap), never by
   waiting 150 real seconds. Sim time runs through CBZ.stepSim(1/60).

   Usage: node tools/president-check.mjs [--seed N] [--quick]
   Boot boilerplate: tools/city-nav-check.mjs. */
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SEED = arg("--seed", "260811");
const QUICK = process.argv.includes("--quick");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 8760 + Math.floor(Math.random() * 40);
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const base = `http://127.0.0.1:${port}/`;
const target = `${base}?seed=${SEED}`;
const dbg = 9760 + Math.floor(Math.random() * 40);
const profile = `/tmp/cbz-president-${dbg}`;
await rm(profile, { recursive: true, force: true });
for (let i = 0; i < 60; i++) { try { const r = await fetch(base); if (r.ok) break; } catch (_) {} await sleep(250); }
const CHROME_BIN = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/opt/pw-browsers/chromium");
const proxy = process.env.CBZ_CHROME_PROXY || process.env.HTTPS_PROXY || "";
const chrome = spawn(CHROME_BIN, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--enable-webgl", "--mute-audio", "--window-size=1280,800",
  ...(proxy ? [`--proxy-server=${proxy}`, "--proxy-bypass-list=127.0.0.1;localhost;[::1]"] : []),
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
  else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") { errors.push("console.error: " + m.params.args.map((a) => a.value || a.description || "").join(" ").slice(0, 240)); }
});
const send = (method, params = {}) => new Promise((r) => { const i = id++; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: `(function(){${expr}})()`, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) return { __err: r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description };
  return r.result && r.result.result && r.result.result.value;
};
await send("Runtime.enable"); await send("Page.enable");

// ---- boot THE PRESIDENT through the real title card --------------------------
let ready = false;
for (let i = 0; i < 240 && !ready; i++) {
  ready = (await evl("return !!(window.CBZ && CBZ.game && CBZ.stepSim && document.getElementById('playBtn') && document.querySelector('[data-origin=\"president\"]'))")) === true;
  if (!ready) { if (i % 30 === 29) await send("Page.navigate", { url: target }); await sleep(500); }
}
if (!ready) { console.error("FAIL: President title card never appeared", [...new Set(errors)].slice(0, 6)); done(2); }
await evl("document.querySelector('[data-origin=\"president\"]').click(); return true;");
let playing = false;
for (let i = 0; i < 200 && !playing; i++) {
  await evl("var b=document.getElementById('playBtn'); if (b && CBZ.game.state!=='playing') b.click(); return true;");
  await sleep(500);
  playing = (await evl("return CBZ.game.state==='playing' && CBZ.game.mode==='city';")) === true;
}
if (!playing) { console.error("FAIL: never reached playing", [...new Set(errors)].slice(0, 6)); done(2); }
let site = false;
for (let i = 0; i < 240 && !site; i++) {
  site = (await evl("var L=CBZ.govComplexes||[]; for (var i=0;i<L.length;i++) if (L[i]&&L[i].id==='execmansion'&&L[i].rect) return !!CBZ.presidency; return false;")) === true;
  if (!site) await sleep(500);
}
if (!site) { console.error("FAIL: Executive Mansion never built"); done(2); }
// settle: the origin swears in, lazy builders (room, staff, car) get frames
await evl("for (var k=0;k<240;k++) CBZ.stepSim(1/60); return true;");
console.log(`President run booted (seed ${SEED}).`);

const results = [];
function check(name, ok, detail) { results.push(ok); console.log((ok ? "  ok  " : "FAIL  ") + name + (detail != null ? "  " + detail : "")); }
function skip(name, why) { console.log("  --  " + name + "  (skipped: " + why + ")"); }
const tick = (n) => evl(`for (var k=0;k<${n};k++) CBZ.stepSim(1/60); return true;`);
const newDay = () => evl("CBZ.polity._checkDayWrap(0.95); CBZ.polity._checkDayWrap(0.05); for (var k=0;k<120;k++) CBZ.stepSim(1/60); return CBZ.worldDay();");

// ---- 1. the spine ----------------------------------------------------------
const st = await evl("if (!CBZ.presidency || !CBZ.presidency.status) return null; return CBZ.presidency.status();");
if (!st) skip("presidency.status()", "not exported yet");
else {
  check("status(): the player holds the country", st.seat === true && st.began === true, JSON.stringify({ seat: st.seat, began: st.began, title: st.title }));
  check("status(): numbers are read off the systems", typeof st.approval === "number" && typeof st.treasury === "number" && typeof st.emergency === "number" && st.threat && typeof st.threat.members === "number",
    `approval=${st.approval} treasury=${st.treasury} emergency=${st.emergency} threat=${st.threat && st.threat.members}`);
  check("status(): a term with an end", st.termDay == null || st.termDay > st.day, `day ${st.day} term ends ${st.termDay}`);
  const s2 = await evl("var s=CBZ.presidency.site&&CBZ.presidency.site(); return s?{id:s.id,gate:s.gate}:null;");
  check("site(): the Mansion", !!(s2 && s2.id === "execmansion" && s2.gate), JSON.stringify(s2));
  const ev = await evl("return !!(CBZ.presidency.on && CBZ.presidency.emit);");
  check("events: on()/emit() exist", ev === true);
}

// ---- 2. the HUD ------------------------------------------------------------
const hud = await evl("return CBZ.presidentHudAudit ? CBZ.presidentHudAudit() : null;");
if (!hud) skip("president HUD", "no presidentHudAudit");
else check("HUD strip is mounted and visible while I hold the seat", hud.mounted === true && hud.visible === true && (hud.fields | 0) >= 4, JSON.stringify(hud));

// ---- 3. the Chief of Staff --------------------------------------------------
const hasAgenda = await evl("return !!CBZ.presidentAgendaAudit;");
if (!hasAgenda) skip("agenda", "no presidentAgendaAudit");
else {
  const d = await newDay();
  const ag = await evl("return CBZ.presidentAgendaAudit();");
  check("a new day hands the president 2–3 tasks", ag && Array.isArray(ag.today) && ag.today.length >= 2 && ag.today.length <= 3, `day ${d}: ${JSON.stringify(ag && ag.today)}`);
  const live = await evl("return CBZ.mission && CBZ.mission.live ? CBZ.mission.live().map(function(m){return m.id;}) : [];");
  check("…through the one mission system", Array.isArray(live) && live.length >= 1, JSON.stringify(live));
  check("the podium stands on the stylobate", !!(ag && ag.podiumBuilt));
}

// ---- 4. the motorcade -------------------------------------------------------
const mc = await evl("return CBZ.motorcadeAudit ? CBZ.motorcadeAudit() : null;");
if (!mc) skip("motorcade", "no motorcadeAudit");
else {
  check("the state car is parked in the motor court", mc.car === true, JSON.stringify(mc));
  const ride = await evl(`
    if (!CBZ.motorcade || !CBZ.motorcade.go) return null;
    var dests = (CBZ.motorcadeAudit().destinations||[]).filter(function(d){return !/mansion|home/i.test(d);});
    if (!dests.length) return { noDest: true };
    var p0 = { x: CBZ.player.pos.x, z: CBZ.player.pos.z };
    var r = CBZ.motorcade.go(dests[0]);
    for (var k=0;k<180;k++) CBZ.stepSim(1/60);
    var p1 = { x: CBZ.player.pos.x, z: CBZ.player.pos.z };
    var L = CBZ.govComplexes||[], near = null;
    for (var i=0;i<L.length;i++){ var s=L[i]; if(!s||!s.rect) continue; var g=s.gate||{x:s.cx,z:s.cz}; var dd=Math.hypot(g.x-p1.x,g.z-p1.z); if(near==null||dd<near.d) near={id:s.id,d:Math.round(dd)}; }
    return { dest: dests[0], r: r, moved: Math.round(Math.hypot(p1.x-p0.x,p1.z-p0.z)), near: near };`);
  if (!ride || ride.noDest) skip("motorcade.go()", "no destinations");
  else check("go() moves the president to another seat of power", ride.moved > 500 && ride.near && ride.near.d < 80, JSON.stringify(ride));
  // home again for the rest of the checks
  await evl("if (CBZ.motorcade && CBZ.motorcade.go) { var h=(CBZ.motorcadeAudit().destinations||[]).filter(function(d){return /mansion|home/i.test(d);})[0]; if (h) CBZ.motorcade.go(h); } for (var k=0;k<120;k++) CBZ.stepSim(1/60); return true;");
}

// ---- 5. the threat comes to the gate ----------------------------------------
if (!st) skip("gate attack", "no status()");
else {
  const atk = await evl(`
    var S = CBZ.presidency, site = S.site(), gate = site.gate || { x: site.cx, z: site.cz + site.rect.maxZ };
    // stand in the motor court so a gate attack is "near"
    CBZ.player.pos.set(site.cx, 0.1, site.cz + 18); CBZ.player.vy = 0;
    var seen = { armed: 0, gateTarget: 0, bodies: 0, attacks: 0, targets: [] };
    for (var day = 0; day < 4; day++) {
      S._armAttack();
      var s0 = S.status();
      seen.armed += s0.threat.armed ? 1 : 0;
      seen.targets.push(s0.threat.target);
      var isGate = /mansion|gate/i.test(String(s0.threat.target || ""));
      if (isGate) seen.gateTarget++;
      for (var k = 0; k < ${QUICK ? 1500 : 2700}; k++) {   // 25–45 s of sim
        CBZ.stepSim(1/60);
        if (k % 60 === 0) {
          var n = 0, P = CBZ.cityPeds || [];
          for (var i = 0; i < P.length; i++) { var p = P[i]; if (p && !p.dead && p.organization === 'cell' && Math.hypot(p.pos.x - gate.x, p.pos.z - gate.z) < 140) n++; }
          if (n > seen.bodies) seen.bodies = n;
        }
      }
      seen.attacks = S.status().threat && (S.audit().attacksDone | 0);
      if (seen.gateTarget && seen.bodies) break;
      CBZ.polity._checkDayWrap(0.95); CBZ.polity._checkDayWrap(0.05);
    }
    return seen;`);
  check("an armed attack reports its target", atk && atk.armed >= 1, JSON.stringify(atk));
  check("within a few days the target is MY gate", !!(atk && atk.gateTarget >= 1), `targets: ${atk && JSON.stringify(atk.targets)}`);
  check("…and it arrives as bodies at the gate, not a headline", !!(atk && atk.bodies >= 1), `cell bodies near gate: ${atk && atk.bodies}`);
}

// ---- 6. the regime on the building ------------------------------------------
const rg = await evl("return CBZ.presidentRegimeAudit ? CBZ.presidentRegimeAudit() : null;");
if (!rg) skip("regime dressing", "no presidentRegimeAudit");
else {
  const after = await evl(`
    var h = CBZ.presidency.seat(); if (!h) return null;
    var before = CBZ.presidentRegimeAudit();
    h.rec.govType = 'dictatorship';
    for (var k=0;k<240;k++) CBZ.stepSim(1/60);
    var mid = CBZ.presidentRegimeAudit();
    h.rec.govType = 'democracy';
    for (var k=0;k<240;k++) CBZ.stepSim(1/60);
    var back = CBZ.presidentRegimeAudit();
    return { before: before, dictatorship: mid, back: back };`);
  check("a dictatorship hangs its banners on the Mansion", !!(after && after.dictatorship && (after.dictatorship.pieces | 0) > (after.before.pieces | 0)), JSON.stringify(after));
  check("…and the republic takes them down again", !!(after && (after.back.pieces | 0) <= (after.before.pieces | 0) + 0), after && `pieces ${after.before.pieces} -> ${after.dictatorship.pieces} -> ${after.back.pieces}`);
}

// ---- 6b. the feet -----------------------------------------------------------
// Every NPC on the compound must stand ON what the world raised under him
// (stylobate 0.30, paving 0.10, hall slab) — the player's own groundAt law.
const feet = await evl(`
  if (!CBZ.groundAt || !CBZ.presidency || !CBZ.presidency.site) return null;
  var s = CBZ.presidency.site(); CBZ.player.pos.set(s.cx, 0.31, s.cz - 12); CBZ.player.vy = 0;
  for (var k = 0; k < 600; k++) CBZ.stepSim(1/60);        // let citystaff mint the household + press
  var P = CBZ.cityPeds || [], n = 0, bad = 0, worst = 0, raised = 0, sample = [];
  for (var i = 0; i < P.length; i++) { var p = P[i]; if (!p || !p.pos || p.dead || p.inCar || p.culled) continue;
    if (Math.hypot(p.pos.x - s.cx, p.pos.z - s.cz) > 90) continue;
    var g = CBZ.groundAt(p.pos.x, p.pos.z, p.pos.y); var d = Math.abs(p.pos.y - g); n++;
    if (g > 0.05) raised++;
    if (d > worst) worst = d;
    if (d > 0.06) { bad++; if (sample.length < 4) sample.push({ job: p.job, y: +p.pos.y.toFixed(2), g: +g.toFixed(2) }); } }
  return { bodies: n, onRaisedGround: raised, sunkOrFloating: bad, worst: +worst.toFixed(3), sample: sample };`);
if (!feet) skip("NPC feet", "no groundAt/site");
else {
  check("NPCs on the compound stand on the surface under them", feet.bodies > 0 && feet.sunkOrFloating === 0, JSON.stringify(feet));
  check("…and some of that surface is raised (the check is not vacuous)", feet.onRaisedGround > 0, `raised=${feet.onRaisedGround}/${feet.bodies}`);
}

// ---- 7. the house -----------------------------------------------------------
const ia = await evl("return CBZ.presidentInteriorAudit ? CBZ.presidentInteriorAudit() : null;");
if (!ia) skip("interior audit", "no presidentInteriorAudit");
// baseline measured before the interior wave (seed 260811): rooms 6, usable 56, symbols 13
else check("the authored rooms did not regress", (ia.namedRooms | 0) >= 6 && (ia.usableProps | 0) >= 56 && (ia.stateSymbols | 0) >= 13, `rooms=${ia.namedRooms} usable=${ia.usableProps} symbols=${ia.stateSymbols} empty=${ia.emptyDecor}`);

// ---- errors from the president files ---------------------------------------
const uniq = [...new Set(errors)].filter((e) => !/ProgressEvent/.test(e));
const ours = uniq.filter((e) => /presiden|motorcade|govcomplex|interior_programs|statecraft|regimes|elections|candidacy/.test(e));
check("no page errors from the president wave's files", ours.length === 0, ours.slice(0, 6).join(" | "));
if (uniq.length) console.log("other page errors (informational):", uniq.filter((e) => !ours.includes(e)).slice(0, 5));

const fails = results.filter((r) => !r).length;
console.log(fails ? `PRESIDENT: FAIL (${fails}/${results.length})` : `PRESIDENT: ok (${results.length} checks)`);
done(fails ? 1 : 0);
