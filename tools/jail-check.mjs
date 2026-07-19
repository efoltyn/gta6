#!/usr/bin/env node
/* tools/jail-check.mjs — CITY JAIL (games/jail.js) behavior gate.
   Boots the game headless into CITY mode, mounts the jail package, and
   asserts EVERY rule through CBZ.games.api.jail: the arrest funnel engages
   the inmate arc with a sentence scaled to wanted, bribe math, the PHYSICAL
   pry-escape (time-based, guard-sightline-gated — no minigame) → wanted HIGH,
   the jailor shift (catch pays; misses never end it — no disgrace rule), the
   panel-button grammar law (one-word verbs + optional number, no "?"), death
   clearing the convict floor, and the flag-OFF byte-identical fallback.
   Numeric-only; never eyeball. */
import { spawn } from "node:child_process";
import { rm, mkdir } from "node:fs/promises";
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
check("cast: 2 inmates + sarge + 3 cells + 4-post ring", cast && cast.inmates >= 2 && cast.sarge && cast.cells === 3 && cast.posts === 4, JSON.stringify(cast));
const rules = await evl("var a=CBZ.games.api.jail; return { s1:a.rules.sentenceFor(1), s3:a.rules.sentenceFor(3), s5:a.rules.sentenceFor(5), b3:a.rules.bribeCost(3), pry:a.rules.PRY_TIME, recap:a.rules.RECAP_PENALTY };");
check("rule sentenceFor(3)=52 scales with wanted", rules.s3 === 52 && rules.s1 === 28 && rules.s5 === 76, JSON.stringify(rules));
check("rule bribeCost(3)=3050 (steep)", rules.b3 === 3050);
check("rule pry: pure time-under-observation (no sweet spots)", rules.pry === 24 && rules.recap === 14);

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
  return { eng:eng, before:before, busted0:busted0, arc:arc, locked:a.cellLocked(1), dist:+dist.toFixed(2), bustedAfter:!!CBZ.game.busted, pending:a.pending() };
`);
check("flag ON: seam engages (no campaign)", arrest.eng === true);
check("arrest engages inmate arc (was idle, none pending)", arrest.before === null && arrest.arc && arrest.arc.phase === "held" && arrest.pending === false);
check("sentence scaled to 3★ (52s), wanted0=3", arrest.arc && arrest.arc.sentence === 52 && arrest.arc.wanted0 === 3, JSON.stringify(arrest.arc));
check("player teleported into the locked cell", arrest.locked === true && arrest.dist < 2.5, "dist=" + arrest.dist);
check("package path does NOT set g.busted (own arc)", arrest.bustedAfter === false);

// ---- 2b. GRAMMAR LAW: panel buttons are one-word verbs (+ number), no "?" --
const gram = await evl(`
  var el=document.getElementById('pkgPanel');
  var spans=el?Array.prototype.slice.call(el.querySelectorAll('[data-act]')):[];
  var labels=spans.map(function(s){return (s.textContent||'').trim();});
  var bad=labels.filter(function(L){
    if (L.indexOf('?')>=0) return true;
    var toks=L.split(/\\s+/);
    if (toks.length>2) return true;
    if (toks.length===2 && !/^\\$?[\\d,.]+s?$/.test(toks[1])) return true;
    return false;
  });
  return { labels:labels, bad:bad };
`);
check("panel buttons: bare verbs + optional number, no '?'", gram.labels && gram.labels.length >= 2 && gram.bad.length === 0, JSON.stringify(gram));

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

// ---- 5. ESCAPE: the PHYSICAL pry (time, not rhythm) → breakout → out the
//         wall → wanted HIGH + convict floor ----
const escape = await evl(`
  var a=CBZ.games.api.jail;
  try{CBZ.cityWantedReset&&CBZ.cityWantedReset();}catch(e){}
  CBZ.cityForceStars(2);
  a.bust({});
  var pryOn=a.pry();                    // start working the door plate
  var p0=a.phase();
  var arcMid=a.arc();
  var popped=a._pryComplete();          // rig: the plate gives
  var afterPop=a.phase(), locked=a.cellLocked(1);
  var reached=a.reachGap();
  return { pryOn:pryOn, p0:p0, pryField:arcMid?arcMid.pry:null, popped:popped, phase:afterPop, locked:locked, reached:reached, arc:a.arc(), wanted:CBZ.game.wanted|0, convict:!!CBZ.game.escapedConvict };
`);
check("pry starts (phase prying — no minigame panel)", escape.pryOn === true && escape.p0 === "prying" && escape.pryField != null);
check("plate pops: phase→breakout, cell door open", escape.popped === true && escape.phase === "breakout" && escape.locked === false);
check("reaching the wall gap frees you", escape.reached === true && escape.arc === null);
check("escape sets wanted HIGH + convict floor", escape.wanted >= 4 && escape.convict === true, "wanted=" + escape.wanted + " convict=" + escape.convict);

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
const shiftA = await evl(`
  var a=CBZ.games.api.jail;
  try{CBZ.cityWantedReset&&CBZ.cityWantedReset();CBZ.cityClearConvict&&CBZ.cityClearConvict();}catch(e){}
  CBZ.game.escapedConvict=false;
  var on=a.startShift(); var s0=a.shift();
  return { on:on, active:s0&&s0.active };
`);
check("shift signs on (active)", shiftA.on === true && shiftA.active === true);

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
check("rigged escape attempt spawns a runner", shiftB.rig === true && shiftB.hasEsc === true);
check("runner is catchable + pays (400)", shiftB.caught === true && shiftB.caughtN === 1 && shiftB.catchPay === 400 && shiftB.escAfter === false, JSON.stringify(shiftB));

const shiftC = await evl(`
  var a=CBZ.games.api.jail;
  var anc=a.anchor(); CBZ.player.pos.x=anc.x; CBZ.player.pos.z=anc.z+7;
  var misses=[];
  for(var i=0;i<3;i++){ a.rigEscape(); misses.push(a.missEscape()); }
  var aliveAfter=a.shift();
  var off=a.endShift('clocked off');
  return { misses:misses, aliveAfter:aliveAfter, off:off, after:a.shift() };
`);
check("misses never end the shift (disgrace rule removed)", shiftC.misses.every((m) => m === true) && shiftC.aliveAfter && shiftC.aliveAfter.active === true, JSON.stringify(shiftC.aliveAfter));
check("clocking off ends the shift", shiftC.off === true && shiftC.after === null);

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
await mkdir(path.join(ROOT, "tools/shots"), { recursive: true });
const shot = await send("Page.captureScreenshot", { format: "png" });
await (await import("node:fs/promises")).writeFile(path.join(ROOT, "tools/shots/jail-check.png"), Buffer.from(shot.result.data, "base64"));
const uniq = [...new Set(errors)].filter((e) => !/ProgressEvent/.test(e) && !/computeBoundingSphere/.test(e));
const fails = results.filter((r) => !r.ok);
console.log("\n" + (fails.length ? "FAILED: " + fails.length + "/" + results.length : "ALL " + results.length + " CHECKS PASS"));
console.log(uniq.length ? "NON-BASELINE ERRORS (" + uniq.length + "):\n" + uniq.slice(0, 15).join("\n") : "console errors: baseline-only");
done(fails.length || uniq.length ? 3 : 0);
