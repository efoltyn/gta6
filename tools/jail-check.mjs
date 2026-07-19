#!/usr/bin/env node
/* tools/jail-check.mjs — LOCKUP (games/jail.js) behavior gate.
   Boots the game headless into CITY mode, mounts the jail package, and
   asserts EVERY rule through CBZ.games.api.jail: the arrest funnel engages
   the inmate arc with a sentence scaled to wanted, bribe math, the lockpick
   → escape sets wanted HIGH, the jailor shift (checkpoints/catch/3-miss end),
   and the flag-OFF byte-identical fallback. Numeric-only; never eyeball. */
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 8990 + Math.floor(Math.random() * 40);
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const base = `http://127.0.0.1:${port}/`;
const dbg = 9990 + Math.floor(Math.random() * 40);
const profile = `/tmp/cbz-jail-${dbg}`;
await rm(profile, { recursive: true, force: true });
await sleep(700);
const chrome = spawn(process.env.CBZ_CHROME || "/opt/pw-browsers/chromium", [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--enable-webgl", "--mute-audio", "--window-size=1440,900",
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

// ---- 1. mount + cast + pure rules ----
const cast = await evl("return CBZ.games.api.jail.cast();");
check("cast: 3 guards", cast && cast.guards >= 3, JSON.stringify(cast));
check("cast: 2 inmates + sarge + 3 cells", cast && cast.inmates >= 2 && cast.sarge && cast.cells === 3, JSON.stringify(cast));
const rules = await evl("var a=CBZ.games.api.jail; return { s1:a.rules.sentenceFor(1), s3:a.rules.sentenceFor(3), s5:a.rules.sentenceFor(5), b3:a.rules.bribeCost(3), jHit:a.rules.lockpickJudge(0.5,0.5,0.1), jMiss:a.rules.lockpickJudge(0.9,0.5,0.1) };");
check("rule sentenceFor(3)=52 scales with wanted", rules.s3 === 52 && rules.s1 === 28 && rules.s5 === 76, JSON.stringify(rules));
check("rule bribeCost(3)=3050 (steep)", rules.b3 === 3050);
check("rule lockpickJudge band", rules.jHit === true && rules.jMiss === false);

// ---- 2. ARREST via the REAL seam → inmate arc, sentence scaled to wanted ----
const arrest = await evl(`
  var a=CBZ.games.api.jail;
  try{CBZ.cityWantedReset&&CBZ.cityWantedReset();}catch(e){}
  CBZ.cityForceStars(3);
  var eng=a.engages(), before=a.arc(), busted0=!!CBZ.game.busted;
  a.bust({});                       // the wrapped CBZ.cityBust (the funnel seam)
  var arc=a.arc(), anchor=a.anchor(), P=CBZ.player.pos;
  var cellW={x:anchor.x-8.3, z:anchor.z};
  var dist=Math.hypot(P.x-cellW.x, P.z-cellW.z);
  return { eng:eng, before:before, busted0:busted0, arc:arc, locked:a.cellLocked(1), dist:+dist.toFixed(2), bustedAfter:!!CBZ.game.busted };
`);
check("flag ON: seam engages (no campaign)", arrest.eng === true);
check("arrest engages inmate arc (was idle)", arrest.before === null && arrest.arc && arrest.arc.phase === "held");
check("sentence scaled to 3★ (52s), wanted0=3", arrest.arc && arrest.arc.sentence === 52 && arrest.arc.wanted0 === 3, JSON.stringify(arrest.arc));
check("player teleported into the locked cell", arrest.locked === true && arrest.dist < 2.5, "dist=" + arrest.dist);
check("package path does NOT set g.busted (own arc)", arrest.bustedAfter === false);

// ---- 3. SERVE ----
const serve = await evl("var a=CBZ.games.api.jail; a.serve(); return { phase:a.phase(), done:a._serveComplete(), arc:a.arc() };");
check("SERVE runs then releases (arc clears)", serve.phase === "serving" && serve.done === true && serve.arc === null);

// ---- 4. BRIBE math (real cash, steep) ----
const bribe = await evl(`
  var a=CBZ.games.api.jail;
  try{CBZ.cityWantedReset&&CBZ.cityWantedReset();}catch(e){}
  CBZ.cityForceStars(2);
  a.bust({});
  var cost=a.arc().bribe;
  CBZ.game.cash = cost + 5000;            // fund the wallet
  var cash0=CBZ.game.cash;
  a.bribe();
  return { cost:cost, spent:cash0-CBZ.game.cash, arc:a.arc() };
`);
check("bribe cost = bribeCost(2)=2200", bribe.cost === 2200, "cost=" + bribe.cost);
check("bribe spends exactly the price, releases", bribe.spent === 2200 && bribe.arc === null, "spent=" + bribe.spent);

// ---- 5. ESCAPE: lockpick rig → breakout → out the wall → wanted HIGH ----
const escape = await evl(`
  var a=CBZ.games.api.jail;
  try{CBZ.cityWantedReset&&CBZ.cityWantedReset();}catch(e){}
  CBZ.cityForceStars(2);
  a.bust({});
  a.startLock();
  var p0=a.phase();
  var picks=[];
  for(var i=0;i<3;i++){ a.setLock(0.5,0.5,0.5); picks.push(a.pick()); }
  var afterPick=a.arc(), locked=a.cellLocked(1);
  var reached=a.reachGap();
  return { p0:p0, picks:picks, phase:afterPick?afterPick.phase:null, locked:locked, reached:reached, arc:a.arc(), wanted:CBZ.game.wanted|0, convict:!!CBZ.game.escapedConvict };
`);
check("lockpick starts (phase picking)", escape.p0 === "picking");
check("3 rigged picks pop the lock (last='open')", escape.picks[2] === "open", JSON.stringify(escape.picks));
check("cell door opens, phase→breakout", escape.phase === "breakout" && escape.locked === false);
check("reaching the wall gap frees you", escape.reached === true && escape.arc === null);
check("escape sets wanted HIGH + convict floor", escape.wanted >= 4 && escape.convict === true, "wanted=" + escape.wanted + " convict=" + escape.convict);

// ---- 6. JAILOR shift: checkpoints advance + pay; catch pays; 3 misses end it
const shiftA = await evl(`
  var a=CBZ.games.api.jail;
  try{CBZ.cityWantedReset&&CBZ.cityWantedReset();CBZ.cityClearConvict&&CBZ.cityClearConvict();}catch(e){}
  CBZ.game.escapedConvict=false;
  var on=a.startShift(); var s0=a.shift();
  var cash0=CBZ.game.cash;
  var i1=a.hitCheckpoint(); var i2=a.hitCheckpoint();   // two beats
  var cashCp=CBZ.game.cash;
  return { on:on, active:s0&&s0.active, cp1:i1, cp2:i2, cpIdx:a.shift().cpIdx, cpPay:cashCp-cash0 };
`);
check("shift signs on (active)", shiftA.on === true && shiftA.active === true);
check("checkpoints advance the beat", shiftA.cpIdx >= 2 && shiftA.cp2 > shiftA.cp1);
check("checkpoints pay wages (2×120)", shiftA.cpPay === 240, "pay=" + shiftA.cpPay);

const shiftB = await evl(`
  var a=CBZ.games.api.jail;
  // park the player at the gate so a rigged break isn't auto-caught by proximity
  var anc=a.anchor(); CBZ.player.pos.x=anc.x; CBZ.player.pos.z=anc.z+7;
  var cash0=CBZ.game.cash;
  var rig=a.rigEscape(); var hasEsc=!!a.shift().escape;
  var caught=a.catch();                 // grab the runner
  var s=a.shift();
  return { rig:rig, hasEsc:hasEsc, caught:caught, caughtN:s.caught, catchPay:CBZ.game.cash-cash0, escAfter:s.escape };
`);
check("rigged escape attempt spawns a runner", shiftB.rig === true && shiftB.hasEsc === true);
check("runner is catchable + pays (400)", shiftB.caught === true && shiftB.caughtN === 1 && shiftB.catchPay === 400 && shiftB.escAfter === false, JSON.stringify(shiftB));

const shiftC = await evl(`
  var a=CBZ.games.api.jail;
  var anc=a.anchor(); CBZ.player.pos.x=anc.x; CBZ.player.pos.z=anc.z+7;
  var misses=[];
  for(var i=0;i<3;i++){ a.rigEscape(); misses.push(a.missEscape()); }
  return { misses:misses, shift:a.shift() };
`);
check("three misses end the shift (disgrace)", shiftC.misses.every((m) => m === true) && shiftC.shift === null, JSON.stringify(shiftC.shift));

// ---- 7. FLAG OFF → the ORIGINAL arrest outcome, byte-identical ----
const off = await evl(`
  var a=CBZ.games.api.jail;
  try{CBZ.cityWantedReset&&CBZ.cityWantedReset();}catch(e){}
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
check("flag OFF: seam no longer engages", off.eng === false);
check("flag OFF: package arc never engages", off.arcBefore === null && off.arcAfter === null);
check("flag OFF: ORIGINAL bust runs (g.busted=true, the fallback state)", off.busted === true);

// ---- summary ----
const shot = await send("Page.captureScreenshot", { format: "png" });
await (await import("node:fs/promises")).writeFile(path.join(ROOT, "tools/shots/jail-check.png"), Buffer.from(shot.result.data, "base64"));
const uniq = [...new Set(errors)].filter((e) => !/ProgressEvent/.test(e) && !/computeBoundingSphere/.test(e));
const fails = results.filter((r) => !r.ok);
console.log("\n" + (fails.length ? "FAILED: " + fails.length + "/" + results.length : "ALL " + results.length + " CHECKS PASS"));
console.log(uniq.length ? "NON-BASELINE ERRORS (" + uniq.length + "):\n" + uniq.slice(0, 15).join("\n") : "console errors: baseline-only");
done(fails.length || uniq.length ? 3 : 0);
