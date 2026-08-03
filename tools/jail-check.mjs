#!/usr/bin/env node
/* tools/jail-check.mjs — CITY JAIL (games/jail.js) behavior gate.
   Boots the game headless into CITY mode, mounts the jail package, and asserts
   EVERY rule through CBZ.games.api.jail. Numeric-only; never eyeball.

   THE CHAIN IT GATES, in the order the game actually runs it:
     bust → BOOKING (charges off the world, property to evidence, a bail price,
     a transport clock whose ETA carries the run distance) → SERVE (into cell 1,
     the door racks shut) → the PHYSICAL pry, advanced by REAL sim time and
     stopped by a real guard's gaze cone (no minigame, no sweet spots) OR a
     guard's KEYS → breakout → the wall gap → wanted HIGH + the convict floor.
     Plus: the sealed TRANSPORT handoff into the pen, BAIL math in real cash,
     the jailor shift (a collar pays 400; misses never end it — no disgrace
     rule), the panel-button grammar law (bare verbs + an optional number, no
     "?"), death clearing the convict floor, and the flag-OFF fallback.

   RE-AUTHORED 2026-08-03. The behavioural half of this suite had been written
   against a jail where an arrest teleported you straight into a locked cell,
   and it had not run since (no Chrome fallback on macOS). Three things had
   drifted underneath it and all three are now tested as they really are:
     · the arc opens in phase "booking" at a desk, not "held" in a cell;
     · the cell is wherever the plot put it — coordinates come from the LIVE
       records (a.anchors().cells), never from `anchor.x - 8.3`, which was the
       legacy yard's offset and had been ~42 m wrong since the county jail
       moved onto its own plot;
     · `_serveComplete()` no longer exists. Serving is resolved in the PEN.
   And one thing was simply a bug in the SUITE: nothing cleaned the arc between
   sections, so one stale INM swallowed every later arrest (games/jail.js's wrap
   returns early while an arc is live) and produced a 14-failure cascade out of
   a single missing teardown. Every section now starts with reset(). */
import { spawn } from "node:child_process";
import { rm, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 8990 + Math.floor(Math.random() * 40);
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const base = `http://127.0.0.1:${port}/`;
// This suite gates the package's SYNCHRONOUS intercept (bust → cell), which
// since wanted.js's e2b5f13 "the arrest is a scene" is the documented DEGRADE
// path behind ARREST_ARC. With the arc live the wrap deliberately falls
// through to the choreographed scene (cuffs → drive → booking desk →
// CBZ.cityBookIn) and every synchronous assertion here is wrong by design —
// this test simply hadn't been run since (no Chrome fallback on macOS).
const bootUrl = `${base}?cfg_ARREST_ARC=0`;
const dbg = 9990 + Math.floor(Math.random() * 40);
const profile = `/tmp/cbz-jail-${dbg}`;
await rm(profile, { recursive: true, force: true });
await sleep(700);
// standard chrome resolution (verification.md): the pw-browsers path does not
// exist on the owner's Mac — fall back to installed Chrome there.
const CHROME_BIN = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "/opt/pw-browsers/chromium");
const chrome = spawn(CHROME_BIN, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--enable-webgl", "--mute-audio", "--window-size=1440,900",
  `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, bootUrl,
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
const evl = async (expr) => { const r = await send("Runtime.evaluate", { expression: `(function(){${expr}})()`, returnByValue: true }); if (r.result && r.result.exceptionDetails) return { __err: r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description }; return r.result && r.result.result && r.result.result.value; };
await send("Runtime.enable"); await send("Page.enable");

// wait for scripts
for (let i = 0; i < 60; i++) { if (await evl("return !!(window.CBZ && CBZ.game && document.getElementById('playBtn'))")) break; await sleep(500); }
// sandbox origin (avoid the exec campaign, which owns its own prison), CITY mode, play
await evl("try{CBZ.setCityOrigin&&CBZ.setCityOrigin('barfly')}catch(e){} try{CBZ.setMode&&CBZ.setMode('city')}catch(e){} return true;");
let playing = false;
for (let i = 0; i < 120 && !playing; i++) {
  await evl("var b=document.getElementById('playBtn'); if(b){b.click();} try{if(CBZ.game.state!=='playing'){CBZ.setMode('city');CBZ.startRun&&CBZ.startRun();}}catch(e){} return true;");
  await sleep(600);
  playing = await evl("return !!(window.CBZ && CBZ.game && CBZ.game.state==='playing' && CBZ.game.mode==='city');");
}
console.log("playing(city):", playing);
// wait for the city arena + the jail package to mount
let mounted = false;
for (let i = 0; i < 60 && !mounted; i++) {
  mounted = await evl("return !!(CBZ.city&&CBZ.city.arena&&CBZ.city.arena.shopLots&&CBZ.games&&CBZ.games.api&&CBZ.games.api.jail&&CBZ.games.api.jail.mounted&&CBZ.games.api.jail.mounted());");
  if (!mounted) await sleep(500);
}
console.log("jail mounted:", mounted);
if (!mounted) { console.log("ERRORS:", [...new Set(errors)].slice(0, 10)); done(2); }

const results = [];
function check(name, cond, detail) { results.push({ name, ok: !!cond, detail }); console.log((cond ? "  ok  " : "FAIL  ") + name + (detail != null ? "  " + detail : "")); }
// evl() answers {__err} when the page threw. A section that throws must FAIL
// with its message, never silently evaluate `undefined.foo` in the next line.
function bad(r) { return !r || typeof r !== "object" || r.__err != null; }
function why(r) { return (r && r.__err) ? ("threw: " + String(r.__err).split("\n")[0]) : JSON.stringify(r); }
// EVERY SECTION STARTS CLEAN. The whole 14-failure cascade this suite last
// printed was one missing teardown: an arc left live in section 3 swallowed
// the arrest in section 4 (the wrap returns early while INM exists), so the
// bribe read the PREVIOUS arrest's 3-star price, the jailor shift refused to
// sign on ("you're an inmate right now"), and the flag-off pass inherited an
// arc it was asserting was null. `_abort` is games/jail.js's own sweeper —
// the one core/mission.js's onInterrupt already calls — so cleaning between
// sections exercises the real teardown rather than inventing a second one.
async function reset() {
  return await evl(`
    var a=CBZ.games.api.jail;
    a._abort();
    try{CBZ.cityWantedReset&&CBZ.cityWantedReset();}catch(e){}
    try{CBZ.cityClearConvict&&CBZ.cityClearConvict();}catch(e){}
    CBZ.game.escapedConvict=false; CBZ.game.busted=false;
    return { arc:a.arc(), shift:a.shift(), wanted:CBZ.game.wanted|0 };
  `);
}

// ---- 1. mount + cast + pure rules ----
const cast = await evl("return CBZ.games.api.jail.cast();");
check("cast: 3 guards", cast && cast.guards >= 3, JSON.stringify(cast));
// cells >= 3: the interiors wave grew the county jail's cell row (4 as of
// 2026-08-03); the contract is "a full cell row exists", not its exact length
check("cast: 2 inmates + sarge + 3+ cells + 4-post ring", cast && cast.inmates >= 2 && cast.sarge && cast.cells >= 3 && cast.posts === 4, JSON.stringify(cast));
const rules = await evl("var a=CBZ.games.api.jail; var J=a.rules.jailSentence(3); return { s1:a.rules.sentenceFor(1), s3:a.rules.sentenceFor(3), s5:a.rules.sentenceFor(5), b2:a.rules.bribeCost(2), b3:a.rules.bribeCost(3), pry:a.rules.PRY_TIME, recap:a.rules.RECAP_PENALTY, scale:a.rules.PRISON_SCALE, wage:a.rules.WAGES.catch, J:J };");
check("rule sentenceFor(3)=52 scales with wanted", rules.s3 === 52 && rules.s1 === 28 && rules.s5 === 76, JSON.stringify(rules));
check("rule bribeCost: 2★=2200, 3★=3050 (steep)", rules.b2 === 2200 && rules.b3 === 3050, "b2=" + rules.b2 + " b3=" + rules.b3);
check("rule pry: pure time-under-observation (no sweet spots)", rules.pry === 24 && rules.recap === 14);
// ONE SENTENCE FORMULA FOR THE WHOLE GAME (CBZ.cityJailSentence). The pen runs
// the SAME number at real-time scale, and every assertion below about a
// prison stretch or a bail price is derived from this row, never retyped.
check("rule jailSentence(3): jail 52 → prison 156 (x3), bail 3050, hold 43",
  rules.scale === 3 && rules.J.jail === 52 && rules.J.prison === 156 &&
  rules.J.bail === 3050 && rules.J.hold === 43, JSON.stringify(rules.J));
check("rule jailor wage: a collar pays 400 and nothing else pays", rules.wage === 400);

// ---- 2. ARREST via the REAL seam → the BOOKING arc, sentence scaled to wanted.
//
//  WHAT CHANGED AND WHY. This section used to assert `phase === "held"` and a
//  player standing in a locked cell one frame after the bust. That was true of
//  the jail this file was written against; it is not what the code promises
//  now. games/jail.js's beginBooking() opens at a BOOKING DESK — charges read
//  off CBZ.cityArrestCharges, property into evidence, a bail price and a
//  transport clock — and SERVE is the verb that walks you into the cell and
//  racks the door. So the arrest is asserted where it actually lands, and the
//  cell/lock contract moved to section 3 where it now belongs.
//
//  The cell coordinate is taken from the LIVE record (a.anchors().cells) rather
//  than the old `anchor.x - 8.3`, which was the legacy yard's cell offset and
//  had been wrong by ~42 m ever since the county jail moved onto its own plot.
await reset();
const arrest = await evl(`
  var a=CBZ.games.api.jail;
  CBZ.cityForceStars(3);
  var eng=a.engages(), before=a.arc(), busted0=!!CBZ.game.busted;
  var tel0=(CBZ.arrestAudit?CBZ.arrestAudit().legacyTeleports:0)|0;
  a.bust({});                       // the wrapped CBZ.cityBust (the funnel seam)
  var arc=a.arc(), P=CBZ.player.pos;
  var an=a.anchors(), cell=an&&an.cells?an.cells[1]:null;
  var dist=cell?Math.hypot(P.x-cell.x, P.z-cell.z):-1;
  var st=a.site();
  return { eng:eng, before:before, busted0:busted0, arc:arc,
    locked:a.cellLocked(1), dist:+dist.toFixed(2), onPlot:!!a.onPlot(),
    bustedAfter:!!CBZ.game.busted, pending:a.pending(),
    teleports:((CBZ.arrestAudit?CBZ.arrestAudit().legacyTeleports:0)|0)-tel0,
    runDist:st?st.runDist:0, runAllow:st?st.runAllowance:0, hold:arc?arc.transportT:0 };
`);
if (bad(arrest)) check("arrest section ran", false, why(arrest));
else {
  check("flag ON: seam engages (no campaign)", arrest.eng === true);
  check("arrest opens the BOOKING arc (was idle, none pending)",
    arrest.before === null && arrest.arc && arrest.arc.phase === "booking" && arrest.pending === false,
    JSON.stringify({ before: arrest.before, phase: arrest.arc && arrest.arc.phase, pending: arrest.pending }));
  check("sentence scaled to 3★: jail 52s → prison 156s, wanted0=3",
    arrest.arc && arrest.arc.sentence === 52 && arrest.arc.prison === 156 && arrest.arc.wanted0 === 3,
    JSON.stringify(arrest.arc));
  check("charges read off the world (never invented)",
    arrest.arc && Array.isArray(arrest.arc.charges) && arrest.arc.charges.length >= 1,
    JSON.stringify(arrest.arc && arrest.arc.charges));
  // THE DEGRADE PATH IS COUNTED. With ARREST_ARC off there is no scene to walk
  // you in, so this bust legitimately moves the body — and wanted.js tallies
  // exactly that as `legacyTeleports`. The number existing is what stops the
  // teleport quietly becoming the normal path again.
  check("degrade bust lands you in cell 1 and is COUNTED as a legacy teleport",
    arrest.dist >= 0 && arrest.dist < 2.5 && arrest.teleports === 1,
    "dist=" + arrest.dist + " legacyTeleports+" + arrest.teleports + " onPlot=" + arrest.onPlot);
  // the door is OPEN at booking: nothing has closed on you yet — SERVE is the
  // verb that shuts it (asserted in section 3).
  check("booking leaves the cell door OPEN (SERVE is what shuts it)", arrest.locked === false);
  // THE VAN'S ETA CARRIES THE RUN. runAllowance is derived, never typed:
  // max(0, (runDist - 18) / 5.2) — a sprint over the distance between your cell
  // and the weak point, so the same mechanic is winnable at both sitings.
  const wantAllow = Math.max(0, (arrest.runDist - 18) / 5.2);
  check("transport clock carries the run distance (allowance = (dist-18)/5.2)",
    Math.abs(arrest.runAllow - wantAllow) < 0.02 && arrest.hold > 0,
    "runDist=" + arrest.runDist + " allowance=" + arrest.runAllow + " expect=" + wantAllow.toFixed(2) + " hold=" + arrest.hold);
  check("package path does NOT set g.busted (own arc)", arrest.bustedAfter === false);
}

// ---- 2b. GRAMMAR LAW: panel buttons are one-word verbs (+ number), no "?" --
const gram = await evl(`
  var el=document.getElementById('pkgPanel');
  var spans=el?Array.prototype.slice.call(el.querySelectorAll('[data-act]')):[];
  var labels=spans.map(function(s){return (s.textContent||'').trim();});
  var badL=labels.filter(function(L){
    if (L.indexOf('?')>=0) return true;
    var toks=L.split(/\\s+/);
    if (toks.length>2) return true;
    if (toks.length===2 && !/^\\$?[\\d,.]+s?$/.test(toks[1])) return true;
    return false;
  });
  return { labels:labels, bad:badL };
`);
if (bad(gram)) check("grammar section ran", false, why(gram));
else check("panel buttons: bare verbs + optional number, no '?'",
  gram.labels && gram.labels.length >= 2 && gram.bad.length === 0, JSON.stringify(gram));

// ---- 3. SERVE → the holding cell, door racked, transport running ----------
//  The old assertion (`_serveComplete()`) tested an API that no longer exists:
//  serving your time is not resolved in the holding cell any more, it is
//  resolved in the PEN. What SERVE promises here is a physical state: you are
//  in cell 1, the door is shut, and the van is coming.
const serve = await evl(`
  var a=CBZ.games.api.jail;
  var ok=a.serve();
  var arc=a.arc(), P=CBZ.player.pos;
  var an=a.anchors(), cell=an&&an.cells?an.cells[1]:null;
  return { ok:ok, phase:a.phase(), locked:a.cellLocked(1),
    dist:cell?+Math.hypot(P.x-cell.x,P.z-cell.z).toFixed(2):-1,
    transportT:arc?arc.transportT:0, prison:arc?arc.prison:0 };
`);
if (bad(serve)) check("SERVE section ran", false, why(serve));
else check("SERVE: phase→held, in cell 1, door LOCKED, transport clock running",
  serve.ok === true && serve.phase === "held" && serve.locked === true &&
  serve.dist >= 0 && serve.dist < 2.5 && serve.transportT > 0 && serve.prison === 156,
  JSON.stringify(serve));

// ---- 3b. THE PRY IS REAL TIME, NOT A MINIGAME -----------------------------
//  This is the one rule the whole venue exists for, so it is driven by the
//  REAL update loop rather than by a rig: CBZ.stepSim(1/60) bursts tick
//  games/jail.js's own update(), which is what advances INM.pry — and which is
//  also what catches you if a deputy's gaze cone crosses the door while you
//  work it. Both outcomes are correct behaviour, so both are asserted and the
//  JSON says which one fired.
const pry = await evl(`
  var a=CBZ.games.api.jail;
  var started=a.pry(), p0=a.phase();
  var pry0=a.arc()?a.arc().pry:0, prison0=a.arc()?a.arc().prison:0;
  var saw=a.guardSees();
  for (var i=0;i<45;i++) CBZ.stepSim(1/60);        // 0.75 s of real sim
  var arc=a.arc();
  return { started:started, p0:p0, saw:saw, pry0:pry0, prison0:prison0,
    pry1:arc?arc.pry:null, phase:a.phase(), prison1:arc?arc.prison:null };
`);
if (bad(pry)) check("pry section ran", false, why(pry));
else {
  check("pry starts from the cell (phase prying — no minigame panel)",
    pry.started === true && pry.p0 === "prying", JSON.stringify({ started: pry.started, p0: pry.p0 }));
  // unobserved: the plate gives to TIME. observed: the screws hammer it back
  // and add RECAP_PENALTY * PRISON_SCALE = 42 s to the stretch.
  const advanced = pry.phase === "prying" && pry.pry1 > pry.pry0 + 0.4;
  const caught = pry.phase === "held" && pry.prison1 === pry.prison0 + 42;
  check("pry advances with UNOBSERVED time (or a guard in the cone stops it, +42s)",
    advanced || caught, JSON.stringify(pry));
}

// ---- 3c. THE TRANSPORT is a SEALED handoff, not a teleport ----------------
//  toPrison() must hand the pen its sentence and its bail through the two
//  documented fields and go through city/death.js's overlay (a mode change
//  hides inside a sealed interior — city/elevators.js's law). The overlay's
//  `done` callback is what actually swaps worlds, so it is CAPTURED here
//  instead of run: this suite is gating the city side and must not be dragged
//  into mode "escape" halfway through. Both stubs are restored immediately.
const transport = await evl(`
  var a=CBZ.games.api.jail;
  var arc=a.arc();
  var ov=null, went=0;
  var O1=CBZ.cityBustOverlay, O2=CBZ.cityArrestToPrison;
  CBZ.cityBustOverlay=function(lost,done,opts){ ov={lost:lost,opts:opts||{}}; };  // capture, never call done
  CBZ.cityArrestToPrison=function(){ went++; };
  CBZ.game._jailSentenceIn=0; CBZ.game._jailBailIn=0;
  var fired=a._transport();
  var res={ fired:fired, ov:ov, went:went, arc:a.arc(),
    sentIn:CBZ.game._jailSentenceIn|0, bailIn:CBZ.game._jailBailIn|0,
    locked:a.cellLocked(1), was:{ prison:arc?arc.prison:0, bribe:arc?arc.bribe:0 } };
  CBZ.cityBustOverlay=O1; CBZ.cityArrestToPrison=O2;
  // toPrison() hands the body over CUFFED and input-locked and relies on the
  // overlay's done() to release it. We captured done() instead of running it,
  // so we owe the release ourselves — otherwise every later section drives a
  // player who is still under arrest.
  try{ CBZ.player._cityArrested=false; CBZ.player.speed=CBZ.player.speed||1; }catch(e){}
  try{ if(CBZ.playerChar){CBZ.playerChar.cuffed=false;CBZ.playerChar.handsUp=false;} }catch(e){}
  try{ CBZ.cityRestrain&&CBZ.cityRestrain.cuffPlayer&&CBZ.cityRestrain.cuffPlayer(false); }catch(e){}
  return res;
`);
if (bad(transport)) check("transport section ran", false, why(transport));
else check("TRANSPORT: sealed overlay 'TRANSFERRED' + sentence/bail handed to the pen",
  transport.fired === true && transport.ov && transport.ov.opts.title === "TRANSFERRED" &&
  transport.went === 0 && transport.arc === null && transport.locked === true &&
  transport.sentIn === transport.was.prison && transport.bailIn === transport.was.bribe,
  JSON.stringify(transport));

// ---- 4. BAIL math (real cash, steep) --------------------------------------
//  Stars are pinned through the seam's own opts rather than through the wanted
//  system, so the price asserted here is the price the formula owes and cannot
//  drift with a heat-decay tick landing between forceStars() and the collar.
await reset();
const bribe = await evl(`
  var a=CBZ.games.api.jail;
  a.bust({ stars:2 });
  var arc=a.arc();
  var cost=arc?arc.bribe:-1;
  CBZ.game.cash = cost + 5000;            // fund the wallet
  var cash0=CBZ.game.cash;
  var freed=a.bail();
  return { w0:arc?arc.wanted0:-1, cost:cost, spent:cash0-CBZ.game.cash, freed:freed, arc:a.arc(), locked:a.cellLocked(1) };
`);
if (bad(bribe)) check("bail section ran", false, why(bribe));
else {
  check("bail price = bribeCost(2) = 2200 at a 2★ jacket",
    bribe.w0 === 2 && bribe.cost === 2200, "wanted0=" + bribe.w0 + " cost=" + bribe.cost);
  check("bail spends exactly the price, opens the door, clears the arc",
    bribe.spent === 2200 && bribe.freed === true && bribe.arc === null && bribe.locked === false,
    JSON.stringify(bribe));
}

// ---- 5. ESCAPE: SERVE → the physical plate → the wall gap → wanted HIGH ----
//  The pry now runs from the HOLDING CELL, which is the only place the plate
//  exists — so the chain is booking → SERVE → pry → breakout → gap, and that
//  ordering IS the mechanic (the pry is your last chance before the van).
await reset();
const escape = await evl(`
  var a=CBZ.games.api.jail;
  a.bust({ stars:2 });
  var served=a.serve();                 // into the cell, door shut
  var pryOn=a.pry();                    // start working the door plate
  var p0=a.phase();
  var arcMid=a.arc();
  var popped=a._pryComplete();          // rig: the plate gives
  var afterPop=a.phase(), locked=a.cellLocked(1);
  var reached=a.reachGap();
  return { served:served, pryOn:pryOn, p0:p0, pryField:arcMid?arcMid.pry:null,
    popped:popped, phase:afterPop, locked:locked, reached:reached, arc:a.arc(),
    wanted:CBZ.game.wanted|0, convict:!!CBZ.game.escapedConvict };
`);
if (bad(escape)) check("escape section ran", false, why(escape));
else {
  check("pry starts from the holding cell (phase prying — no minigame panel)",
    escape.served === true && escape.pryOn === true && escape.p0 === "prying" && escape.pryField != null,
    JSON.stringify({ served: escape.served, p0: escape.p0, pry: escape.pryField }));
  check("plate pops: phase→breakout, cell door open",
    escape.popped === true && escape.phase === "breakout" && escape.locked === false);
  check("reaching the wall gap frees you", escape.reached === true && escape.arc === null);
  check("escape sets wanted HIGH + convict floor",
    escape.wanted >= 4 && escape.convict === true, "wanted=" + escape.wanted + " convict=" + escape.convict);
}

// ---- 5a. KEYS: the SECOND physical means (owner doctrine — never a minigame)
//  A guard you have dealt with gives up the ring and the door opens with no pry
//  clock at all. `liftKeys` is gated on the same held/prying window the plate
//  is, so this also proves the two routes are alternatives rather than a
//  sequence you must do in order.
await reset();
const keys = await evl(`
  var a=CBZ.games.api.jail;
  a.bust({ stars:1 });
  a.serve();
  var before=a.phase();
  var got=a.liftKeys();
  var res={ before:before, got:got, phase:a.phase(), locked:a.cellLocked(1) };
  a._abort();
  return res;
`);
if (bad(keys)) check("keys section ran", false, why(keys));
else check("guard KEYS open the door with no pry clock (held → breakout)",
  keys.before === "held" && keys.got === true && keys.phase === "breakout" && keys.locked === false,
  JSON.stringify(keys));

// ---- 5b. DEATH closes the manhunt (CITY_WANTED_CLEARS_ON_DEATH): the convict
//          floor dies with you — a corpse is as caught as it gets ----
const death = await evl(`
  try{CBZ.cityWantedReset&&CBZ.cityWantedReset();}catch(e){}
  CBZ.game.escapedConvict = true;
  CBZ.cityForceStars(3);
  if (CBZ.cityInfamyResetOnDeath) CBZ.cityInfamyResetOnDeath();
  return { flag: CBZ.CONFIG.CITY_WANTED_CLEARS_ON_DEATH, convict: !!CBZ.game.escapedConvict, wanted: CBZ.game.wanted|0, heat: CBZ.game.heat||0 };
`);
check("death clears stars, heat AND the convict floor", death.flag === true && death.convict === false && death.wanted === 0 && death.heat === 0, JSON.stringify(death));

// ---- 6. JAILOR shift: catches pay; misses NEVER end it (no disgrace rule) --
//  A shift is REFUSED while you are an inmate yourself (games/jail.js's
//  startShift guard), which is exactly why every check in this section failed
//  before: an arc left live upstream made "you're an inmate right now" the real
//  answer, a.shift() returned null, and the next line dereferenced it.
await reset();
const shiftA = await evl(`
  var a=CBZ.games.api.jail;
  var arcClear = a.arc()===null;
  var on=a.startShift(); var s0=a.shift();
  return { arcClear:arcClear, on:on, active:!!(s0&&s0.active) };
`);
if (bad(shiftA)) check("shift section ran", false, why(shiftA));
else check("shift signs on (active) with no arc held",
  shiftA.arcClear === true && shiftA.on === true && shiftA.active === true, JSON.stringify(shiftA));

const shiftB = await evl(`
  var a=CBZ.games.api.jail;
  // park the player at the gate so a rigged break isn't auto-caught by proximity
  var anc=a.anchor(); CBZ.player.pos.x=anc.x; CBZ.player.pos.z=anc.z+7;
  var cash0=CBZ.game.cash;
  var rig=a.rigEscape(); var hasEsc=!!a.shift().escape;
  var caught=a.catch();                 // grab the runner (the real cityRestrain collar)
  var s=a.shift();
  return { rig:rig, hasEsc:hasEsc, caught:caught, caughtN:s.caught, catchPay:CBZ.game.cash-cash0, escAfter:s.escape };
`);
if (bad(shiftB)) check("runner section ran", false, why(shiftB));
else {
  check("rigged escape attempt spawns a runner", shiftB.rig === true && shiftB.hasEsc === true, JSON.stringify(shiftB));
  check("runner is catchable + pays (400)", shiftB.caught === true && shiftB.caughtN === 1 && shiftB.catchPay === 400 && shiftB.escAfter === false, JSON.stringify(shiftB));
}

const shiftC = await evl(`
  var a=CBZ.games.api.jail;
  var anc=a.anchor(); CBZ.player.pos.x=anc.x; CBZ.player.pos.z=anc.z+7;
  var misses=[];
  for(var i=0;i<3;i++){ a.rigEscape(); misses.push(a.missEscape()); }
  var aliveAfter=a.shift();
  var off=a.endShift('clocked off');
  return { misses:misses, aliveAfter:aliveAfter, off:off, after:a.shift() };
`);
if (bad(shiftC)) check("miss section ran", false, why(shiftC));
else {
  check("misses never end the shift (disgrace rule removed)", shiftC.misses.every((m) => m === true) && shiftC.aliveAfter && shiftC.aliveAfter.active === true, JSON.stringify(shiftC.aliveAfter));
  check("clocking off ends the shift", shiftC.off === true && shiftC.after === null);
}

// ---- 7. FLAG OFF → the ORIGINAL arrest outcome, byte-identical ----
await reset();
const off = await evl(`
  var a=CBZ.games.api.jail;
  CBZ.game.busted=false;
  CBZ.CONFIG.PKG_JAIL=false;
  var eng=a.engages();
  var arcBefore=a.arc();
  CBZ.cityForceStars(2);
  CBZ.cityBust({});                     // the seam — now falls through to orig
  var res={ eng:eng, arcBefore:arcBefore, arcAfter:a.arc(), busted:!!CBZ.game.busted };
  // restore
  CBZ.CONFIG.PKG_JAIL=true;
  try{CBZ.cityWantedReset&&CBZ.cityWantedReset();}catch(e){}
  return res;
`);
if (bad(off)) check("flag-off section ran", false, why(off));
else {
  check("flag OFF: seam no longer engages", off.eng === false);
  check("flag OFF: package arc never engages", off.arcBefore === null && off.arcAfter === null, JSON.stringify({ before: off.arcBefore, after: off.arcAfter }));
  check("flag OFF: ORIGINAL bust runs (g.busted=true, the fallback state)", off.busted === true);
}

// ---- summary ----
await mkdir(path.join(ROOT, "tools/shots"), { recursive: true });
const shot = await send("Page.captureScreenshot", { format: "png" });
await (await import("node:fs/promises")).writeFile(path.join(ROOT, "tools/shots/jail-check.png"), Buffer.from(shot.result.data, "base64"));
const uniq = [...new Set(errors)].filter((e) => !/ProgressEvent/.test(e) && !/computeBoundingSphere/.test(e));
const fails = results.filter((r) => !r.ok);
console.log("\n" + (fails.length ? "FAILED: " + fails.length + "/" + results.length : "ALL " + results.length + " CHECKS PASS"));
console.log(uniq.length ? "NON-BASELINE ERRORS (" + uniq.length + "):\n" + uniq.slice(0, 15).join("\n") : "console errors: baseline-only");
done(fails.length || uniq.length ? 3 : 0);
