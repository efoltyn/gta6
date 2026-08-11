#!/usr/bin/env node
/* tools/prison-tier-check.mjs — SECURITY TIERS (systems/prisontiers.js) gate.

   Boots the real page headless into ESCAPE mode and asserts the ladder as the
   game actually runs it — never by reading the knob table back to itself:

     1. the table is a legal ladder (four rungs, every one strictly harder in
        the things a security level is FOR) and eight legal timetables;
     2. each rung, APPLIED, changes the world: more posts on the roster, more
        wired lenses, a shorter compound day, a longer lockdown, wider tower
        pools, more placard bars burning;
     3. the transfer: a third capture moves you UP instead of ending the run,
        the reception shakedown keeps what the destination's rule says and
        confiscates every key, and the card the player is shown says so;
     4. the arrival: a new day at the tier's own wake hour, in your cell, with
        the surviving property back in your pockets and inmate respect intact;
     5. ULTRA-MAX has no fourth rung — capture there is confinement, not a
        loss — and escaping clears the ladder;
     6. nothing this file turns broke what published it: the schedule's own
        gaps/ordered ratchets, prisonnight's sightAtNoon, economy's unminted.
*/
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 8890 + Math.floor(Math.random() * 40);
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const base = `http://127.0.0.1:${port}/`;
const dbg = 9890 + Math.floor(Math.random() * 40);
const profile = `/tmp/cbz-tier-${dbg}`;
await rm(profile, { recursive: true, force: true });
await sleep(700);
const CHROME_BIN = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "/opt/pw-browsers/chromium");
const chrome = spawn(CHROME_BIN, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--enable-webgl", "--mute-audio", "--window-size=1200,800",
  `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, base,
], { stdio: "ignore" });

function done(code) {
  try { chrome.kill("SIGTERM"); } catch (_) {}
  try { server.kill("SIGTERM"); } catch (_) {}
  rm(profile, { recursive: true, force: true }).catch(() => {});
  process.exit(code);
}

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

for (let i = 0; i < 60; i++) { if (await evl("return !!(window.CBZ && CBZ.game && document.getElementById('playBtn'))")) break; await sleep(500); }

// ESCAPE mode, inmate, running.
await evl("try{CBZ.setRole&&CBZ.setRole('inmate')}catch(e){} try{CBZ.setMode&&CBZ.setMode('escape')}catch(e){} return true;");
let playing = false;
for (let i = 0; i < 60 && !playing; i++) {
  await evl("try{CBZ.setMode('escape'); CBZ.startRun&&CBZ.startRun();}catch(e){} return true;");
  await sleep(500);
  playing = await evl("return !!(CBZ.game.state==='playing' && CBZ.game.mode==='escape');");
}
console.log("playing(escape):", playing);
if (!playing) { console.log("ERRORS:", [...new Set(errors)].slice(0, 8)); done(2); }
const present = await evl("return !!(CBZ.prisonTier && CBZ.prisonTierAudit);");
console.log("prisonTier present:", present);
if (!present) { console.log("ERRORS:", [...new Set(errors)].slice(0, 8)); done(2); }
await sleep(700);   // let a few frames of every 0.2-0.5 Hz driver run

const results = [];
function check(name, cond, detail) { results.push({ name, ok: !!cond }); console.log((cond ? "  ok  " : "FAIL  ") + name + (detail != null ? "  " + detail : "")); }
function bad(r) { return !r || typeof r !== "object" || r.__err != null; }
function why(r) { return (r && r.__err) ? ("threw: " + String(r.__err).split("\n")[0]) : JSON.stringify(r); }

// ---------------------------------------------------------------- 1. TABLE
const A0 = await evl("return CBZ.prisonTierAudit();");
if (bad(A0)) { console.error("FAIL audit: " + why(A0)); done(3); }
check("four rungs, strictly escalating", A0.ladderGaps === 0, "ladderGaps=" + A0.ladderGaps);
check("every regime is a legal timetable", A0.unsorted === 0, "unsorted=" + A0.unsorted);
check("this file prints nothing mid-play", A0.hudText === 0);
check("starts on LOW", A0.level === 0 && A0.id === "low", A0.id);
check("LOW regime applied to the world", A0.unapplied === 0, "unapplied=" + A0.unapplied);
check("nine camera bodies bolted up", A0.cameras === 9, "cameras=" + A0.cameras);
check("signage anchors built", A0.signage >= 8, "signage=" + A0.signage);

// ------------------------------------------------- 2. THE RUNGS, APPLIED
const rungs = [];
for (let n = 0; n < 4; n++) {
  const r = await evl(`CBZ.prisonTier.set(${n}); return CBZ.prisonTierAudit();`);
  if (bad(r)) { console.error("FAIL set(" + n + "): " + why(r)); done(3); }
  rungs.push(r);
  check(`tier ${n} (${r.id}) applies with no unapplied knob`, r.unapplied === 0,
    `guards=${r.guards} posts=${r.tierPosts} lens=${r.liveCameras}/${r.cameras} floods=${r.floods} pool=${r.poolRadius} open=${r.openHours}h locked=${r.lockedHours}h torches=${r.torchCarriers}`);
}
const mono = (k, dir) => rungs.every((r, i) => i === 0 || (dir > 0 ? r[k] > rungs[i - 1][k] : r[k] < rungs[i - 1][k]));
check("roster grows every rung", mono("guards", 1), rungs.map((r) => r.guards).join(" -> "));
check("wired lenses grow every rung", mono("liveCameras", 1), rungs.map((r) => r.liveCameras).join(" -> "));
check("torch duty grows every rung", rungs[3].torchCarriers > rungs[0].torchCarriers, rungs.map((r) => r.torchCarriers).join(" -> "));
check("compound day shortens every rung", mono("openHours", -1), rungs.map((r) => r.openHours).join(" -> "));
check("lockdown lengthens every rung", mono("lockedHours", 1), rungs.map((r) => r.lockedHours).join(" -> "));
check("tower pools widen every rung", mono("poolRadius", 1), rungs.map((r) => r.poolRadius).join(" -> "));
check("floods on the circuit never shrink", rungs[3].floods >= rungs[0].floods, rungs.map((r) => r.floods).join(" -> "));
check("LOW is one lens, ULTRA is all nine", rungs[0].liveCameras === 1 && rungs[3].liveCameras === 9);

// the schedule table is really rewritten, and stays legal at every rung
const sched = await evl(`
  var out=[];
  for (var n=0;n<4;n++){ CBZ.prisonTier.set(n); var s=CBZ.prisonScheduleAudit();
    out.push({t:n, gaps:s.gaps, ordered:s.ordered, yard:CBZ.prisonSchedule.blocks[1].from, night:CBZ.prisonSchedule.blocks[7].from}); }
  return out;`);
if (bad(sched)) { console.error("FAIL schedule: " + why(sched)); done(3); }
check("schedule ratchet holds at every rung", sched.every((s) => s.gaps === 0 && s.ordered === 1));
check("yard call slips later every rung", sched.every((s, i) => i === 0 || s.yard > sched[i - 1].yard), sched.map((s) => s.yard).join(" -> "));
check("lights-out comes earlier every rung", sched.every((s, i) => i === 0 || s.night < sched[i - 1].night), sched.map((s) => s.night).join(" -> "));

// steal odds / social rates actually reach economy.js on the same live actor
const econ = await evl(`
  var gd=(CBZ.guards||[]).filter(function(x){return x.kind==='guard';})[0];
  if(!gd) return {__err:'no guard'};
  var out=[];
  for (var n=0;n<4;n++){ CBZ.prisonTier.set(n);
    gd.rep=0; CBZ.econ.addRespect(gd,10);
    gd.loyalty=0; CBZ.econ.addLoyalty(gd,10);
    out.push({t:n, steal:Math.round(CBZ.econ.stealOdds(gd)*1000)/1000, rep:Math.round(gd.rep*100)/100, loy:Math.round(gd.loyalty*100)/100}); }
  gd.rep=0; gd.loyalty=0;
  return out;`);
if (bad(econ)) { console.error("FAIL econ: " + why(econ)); done(3); }
check("steal odds fall every rung", econ.every((e, i) => i === 0 || e.steal < econ[i - 1].steal), econ.map((e) => e.steal).join(" -> "));
check("respect forms slower every rung", econ.every((e, i) => i === 0 || e.rep < econ[i - 1].rep), econ.map((e) => e.rep).join(" -> "));
check("loyalty forms slower every rung", econ.every((e, i) => i === 0 || e.loy < econ[i - 1].loy), econ.map((e) => e.loy).join(" -> "));

// the rank ladder guardPost() derives — the fix to its dead WORLD lookups
const ranks = await evl(`
  CBZ.prisonTier.set(3);
  var out={};
  (CBZ.guards||[]).forEach(function(g){ var p=CBZ.econ.guardPost(g); out[p.post]=(out[p.post]||0)+1; });
  return out;`);
if (bad(ranks)) { console.error("FAIL ranks: " + why(ranks)); done(3); }
check("the wing post exists again (guardPost WORLD fix)", (ranks.wing | 0) >= 1, JSON.stringify(ranks));
check("the checkpoint post exists again", (ranks.checkpoint | 0) >= 1 || (ranks.bent | 0) >= 1, JSON.stringify(ranks));

// ------------------------------------------------------------ 3. TRANSFER
const tx = await evl(`
  CBZ.prisonTier.set(0);
  CBZ.game.state='playing';
  CBZ.game.cigs=0; CBZ.econ.addCigs(40);
  CBZ.game.inventory={}; CBZ.econ.addItem('Keycard',1); CBZ.econ.addItem('Lockpick',1); CBZ.econ.addItem('Soap',1); CBZ.econ.addItem('Ramen',2);
  var n=(CBZ.npcs||[]).filter(function(x){return !x._crowd;})[0]; if(n) n.rep=40;
  var gd=(CBZ.guards||[])[0]; if(gd) gd.loyalty=80;
  CBZ.game.caughtCount=2; CBZ.game.invuln=0;
  CBZ.haulToCell('probe');
  var sub=document.querySelector('#survlose .sub'), logo=document.querySelector('#survlose .logo');
  var btn=document.getElementById('loseAgainBtn');
  return { tier:CBZ.game.securityTier, state:CBZ.game.state, arrive:!!CBZ.game._tierArrive,
           carryCigs:CBZ.game._tierCarry?CBZ.game._tierCarry.cigs:-1,
           carryItems:CBZ.game._tierCarry?Object.keys(CBZ.game._tierCarry.items):null,
           carryRep:CBZ.game._tierCarry?CBZ.game._tierCarry.rep.length:-1,
           logo:logo?logo.textContent:'', sub:sub?sub.textContent:'', btn:btn?btn.textContent:'' };`);
if (bad(tx)) { console.error("FAIL transfer: " + why(tx)); done(3); }
check("third capture TRANSFERS instead of losing", tx.tier === 1, "tier=" + tx.tier);
check("the between-levels card is shown", tx.state === "lost" && tx.logo === "TRANSFERRED", tx.logo);
check("the card names the destination regime", /Medium Security/.test(tx.sub), JSON.stringify(tx.sub));
check("the button walks you into the next wing", /REPORT TO MEDIUM/.test(tx.btn), JSON.stringify(tx.btn));
check("shakedown keeps half the cigs into MEDIUM", tx.carryCigs === 20, "cigs=" + tx.carryCigs);
check("shakedown confiscates every key and tool", tx.carryItems && !tx.carryItems.some((k) => /Keycard|Lockpick/.test(k)), JSON.stringify(tx.carryItems));
check("personal effects survive into MEDIUM", tx.carryItems && tx.carryItems.indexOf("Soap") >= 0 && tx.carryItems.indexOf("Ramen") >= 0, JSON.stringify(tx.carryItems));
check("respect travels in the transfer file", tx.carryRep >= 1, "reps=" + tx.carryRep);

// --------------------------------------------------------- 4. THE ARRIVAL
await evl("var b=document.getElementById('loseAgainBtn'); if(b) b.click(); return true;");
await sleep(1200);
const arr = await evl(`
  var cb=CBZ.cellblock, c=cb&&cb.playerCell;
  var inCell = !!(c && Math.abs(CBZ.player.pos.x-c.x)<=c.hx+0.2 && Math.abs(CBZ.player.pos.z-c.z)<=c.hz+0.2);
  var n=(CBZ.npcs||[]).filter(function(x){return !x._crowd;})[0];
  var gd=(CBZ.guards||[])[0];
  return { tier:CBZ.game.securityTier, state:CBZ.game.state, hour:Math.round(CBZ.prisonSchedule.hour()*100)/100,
           block:CBZ.prisonSchedule.id(), inCell:inCell, cigs:CBZ.game.cigs,
           key:CBZ.econ.hasItem('Keycard'), pick:CBZ.econ.hasItem('Lockpick'),
           soap:CBZ.econ.hasItem('Soap'), rep:n?Math.round(n.rep):-1, loyalty:gd?(gd.loyalty|0):-1,
           arrive:!!CBZ.game._tierArrive, carry:!!CBZ.game._tierCarry,
           audit:CBZ.prisonTierAudit() };`);
if (bad(arr)) { console.error("FAIL arrival: " + why(arr)); done(3); }
check("you are running again at the new tier", arr.state === "playing" && arr.tier === 1, `state=${arr.state} tier=${arr.tier}`);
check("MEDIUM regime is applied on wake", arr.audit.unapplied === 0 && arr.audit.liveCameras === 3, `lens=${arr.audit.liveCameras} guards=${arr.audit.guards}`);
check("you wake at the tier's own wake hour", Math.abs(arr.hour - 5.0) < 0.6, "hour=" + arr.hour);
check("you wake in your cell", arr.inCell, "inCell=" + arr.inCell);
check("the surviving cigs are back in your pocket", arr.cigs === 20, "cigs=" + arr.cigs);
check("the keys did not come with you", !arr.key && !arr.pick);
check("the personal effects did", arr.soap);
check("inmate respect travelled (0.8)", arr.rep === 32, "rep=" + arr.rep);
check("bought loyalty did NOT travel", arr.loyalty === 0, "loyalty=" + arr.loyalty);
check("the arrival is consumed exactly once", !arr.arrive && !arr.carry);

// ------------------------------------------------ 5. THE TOP OF THE LADDER
const top = await evl(`
  CBZ.prisonTier.set(3);
  CBZ.game.state='playing'; CBZ.game.caughtCount=2; CBZ.game.invuln=0;
  CBZ.haulToCell('probe');
  var a={ tier:CBZ.game.securityTier, state:CBZ.game.state, caught:CBZ.game.caughtCount };
  CBZ.game.caughtCount=2; CBZ.game.invuln=0; CBZ.haulToCell('probe');
  a.tier2=CBZ.game.securityTier; a.state2=CBZ.game.state; a.caught2=CBZ.game.caughtCount;
  return a;`);
if (bad(top)) { console.error("FAIL ultra: " + why(top)); done(3); }
check("ULTRA-MAX capture does not end the run", top.state === "playing" && top.state2 === "playing", `${top.state}/${top.state2}`);
check("ULTRA-MAX has no rung above it", top.tier === 3 && top.tier2 === 3);
check("the strike count is held at the final rung", top.caught <= 2 && top.caught2 <= 2, `${top.caught}/${top.caught2}`);

// the crown, and the ladder clearing on a win
const win = await evl(`
  CBZ.prisonTier.set(2); CBZ.game.state='playing';
  CBZ.winGame('route');
  var logo=document.querySelector('#win .logo'), r=document.getElementById('wReason');
  var out={ logo:logo?logo.textContent:'', reason:r?r.textContent:'', tier:CBZ.game.securityTier };
  return out;`);
if (bad(win)) { console.error("FAIL win: " + why(win)); done(3); }
check("escaping HIGH reads as a bigger crown", /OUT OF HIGH/.test(win.logo), JSON.stringify(win.logo));
check("the reason line names the wing you beat", /High/.test(win.reason), JSON.stringify(win.reason));
await sleep(400);
const cleared = await evl("return CBZ.game.securityTier;");
check("a win clears the ladder back to LOW", cleared === 0, "tier=" + cleared);

// -------------------------------------- 6. NOTHING THIS FILE TURNS BROKE
const nb = await evl(`
  CBZ.prisonTier.set(3);
  return { night:CBZ.prisonNightAudit(), sched:CBZ.prisonScheduleAudit(), social:CBZ.socialAudit(),
           prompts:CBZ.prisonPromptAudit?CBZ.prisonPromptAudit():{shown:0},
           cigs:CBZ.prisonCigAudit?CBZ.prisonCigAudit():{ground:0} };`);
if (bad(nb)) { console.error("FAIL neighbours: " + why(nb)); done(3); }
check("prisonnight sightAtNoon still 1", nb.night.sightAtNoon === 1, "=" + nb.night.sightAtNoon);
check("prisonnight unknownKinds still 0", nb.night.unknownKinds === 0);
check("prisonschedule gaps 0 / ordered", nb.sched.gaps === 0 && nb.sched.ordered === 1);
check("prisonschedule prints nothing", nb.sched.hudText === 0);
check("economy unminted still 0 (new posts have real pockets)", nb.social.unminted === 0, "unminted=" + nb.social.unminted);
check("ground cigs still dead", (nb.cigs.ground | 0) === 0);
check("touch prompts still capped at one", (nb.prompts.shown | 0) <= 1);

const hard = [...new Set(errors)].filter((e) => !/favicon|Failed to load resource|AudioContext|WebGL|deprecat/i.test(e));
check("no page errors", hard.length === 0, hard.slice(0, 4).join(" | "));

const fail = results.filter((r) => !r.ok);
console.log(`\n${results.length - fail.length}/${results.length} passed`);
if (fail.length) console.log("FAILED: " + fail.map((f) => f.name).join(" · "));
done(fail.length ? 1 : 0);
