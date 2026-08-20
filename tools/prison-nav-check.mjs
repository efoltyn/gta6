#!/usr/bin/env node
/* tools/prison-nav-check.mjs — THE PRISON WALKS TO DOORS. The numeric gate for
   PRISON_NAV_V1.

   OWNER: "Instead of flickering when walking into a wall falling real physics
   and then finding door etc IDK consider this."

   The measurement that made the case, and the one this gate holds. A body is
   STALLED on a frame when it is trying to move — a live target more than a
   metre off, no pause, not seated or asleep — and achieves less than 35% of
   the step its own speed asked for. That is the signature of walking into
   something. Summed over the cast it says what share of the prison's attempted
   movement is spent pressed into geometry:

     block    shipped tree            with systems/prisonnav.js
     yard      7% stalled,  1 grinder
     mess     15% stalled,  3 grinders
     supper   20% stalled,  5 grinders
     secure   24% stalled, 12 grinders

   A "grinder" is one body stalled more than 1.5 s inside a 10 s sample —
   somebody the player would SEE standing in a wall. The gate is the stalled
   share and the grinder count, per block, plus the planner's own numbers
   (build cost, plan cost, failures) so a route that got cheaper by getting
   dumber cannot pass.

   --revert boots ?cfg_PRISON_NAV_V1=0 and demands the fault back: a probe
   that passes before and after proves nothing (mode-engine-check's law).

   Boot boilerplate: tools/prison-jitter-check.mjs, itself prison-sit-check's.
*/
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const HOURS = (arg("--hours", "9,12.5,18,22")).split(",").map(Number);
const REVERT = process.argv.includes("--revert");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 8880 + Math.floor(Math.random() * 40);
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const base = `http://127.0.0.1:${port}/`;
const target = base + (REVERT ? "?cfg_PRISON_NAV_V1=0" : "");
const dbg = 9880 + Math.floor(Math.random() * 40);
const profile = `/tmp/cbz-nav-${dbg}`;
await rm(profile, { recursive: true, force: true });
// wait for the static server BEFORE the browser starts: a browser that beats
// it to the port gets a connection-refused page and never retries on its own.
for (let i = 0; i < 60; i++) {
  try { const r = await fetch(base); if (r.ok) break; } catch (_) {}
  await sleep(250);
}
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
  const r = await send("Runtime.evaluate", { expression: `(function(){${expr}})()`, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) return { __err: r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description };
  return r.result && r.result.result && r.result.result.value;
};
await send("Runtime.enable"); await send("Page.enable");

// the browser can beat the static server to the punch — reload until the game
// is actually served (a failed load leaves a page whose title is the host).
let booted = false;
for (let i = 0; i < 90 && !booted; i++) {
  const v = await evl("return !!(window.CBZ && CBZ.bootComplete && CBZ.game)");
  booted = v === true;
  if (booted) break;
  if (i % 12 === 11) await send("Page.navigate", { url: target });
  await sleep(500);
}
let playing = false;
for (let i = 0; i < 40 && !playing; i++) {
  await evl("try{CBZ.setMode('escape'); CBZ.startRun && CBZ.startRun();}catch(e){return String(e);} return true;");
  await sleep(500);
  playing = await evl("return !!(CBZ.game && CBZ.game.state==='playing' && CBZ.game.mode==='escape');");
}
console.log(`playing(escape): ${playing}  hours=${HOURS.join("/")}${REVERT ? "  [revert]" : ""}`);
if (!playing) { console.log("ERRORS:", [...new Set(errors)].slice(0, 10)); done(2); }

const phaseOf = (hour) => ((hour - 6) / 24).toFixed(5);
const rows = [];
for (const H of HOURS) {
  // settle into the block first: routes and schedules converge, then measure
  await evl(`var ph=${phaseOf(H)};
    for (var c = 0; c < 14; c++) { if (CBZ.dayPhase) CBZ.dayPhase(ph); for (var k = 0; k < 30; k++) CBZ.stepSim(1/60); }
    return true;`);
  const S = await evl(`
    var ph = ${phaseOf(H)};
    var roster = [];
    function add(list, kind) {
      for (var i=0;i<list.length;i++){ var a=list[i]; if(!a||!a.group||a.dead) continue;
        roster.push({a:a,kind:kind,i:i,px:a.group.position.x,pz:a.group.position.z,tryF:0,stallF:0}); }
    }
    add(CBZ.npcs||[], "npc"); add(CBZ.guards||[], "guard");
    var FR = 600, worstMs = 0;
    for (var f=0; f<FR; f++) {
      if (CBZ.dayPhase && (f % 30 === 0)) CBZ.dayPhase(ph);
      var t0 = performance.now();
      CBZ.stepSim(1/60);
      var ms = performance.now() - t0;
      if (ms > worstMs) worstMs = ms;
      for (var r=0;r<roster.length;r++) {
        var e=roster[r], a=e.a, p=a.group.position;
        var moved = Math.hypot(p.x-e.px, p.z-e.pz); e.px=p.x; e.pz=p.z;
        if (a.dead || (a.ko|0)>0 || a._propLie || a._propSeat) continue;
        var t = a.target; if (!t) continue;
        if (Math.hypot(t.x-p.x, t.z-p.z) < 1.0) continue;   // arrived / posted
        if ((a.pause||0) > 0) continue;                      // deliberately standing
        e.tryF++;
        var want = (a._spd != null ? a._spd : a.speed) * (1/60) * 0.35;
        if (moved < want) e.stallF++;
      }
    }
    roster.sort(function(x,y){return y.stallF-x.stallF;});
    var stall=0, tryT=0, grinders=0, top=[];
    for (var r=0;r<roster.length;r++){ var e=roster[r]; stall+=e.stallF; tryT+=e.tryF; if (e.stallF/60 > 1.5) grinders++; }
    for (var r=0;r<3 && r<roster.length;r++){ var e=roster[r], a=e.a, p=a.group.position;
      top.push({kind:e.kind,i:e.i,state:a.aiState||"",stallS:Math.round(e.stallF/60*10)/10,
        at:[Math.round(p.x),Math.round(p.z)], tgt:[Math.round(a.target.x),Math.round(a.target.z)]}); }
    var A = CBZ.prisonNavAudit ? CBZ.prisonNavAudit() : {};
    return { block: CBZ.prisonSchedule?CBZ.prisonSchedule.id():null, actors: roster.length,
             trySecs: Math.round(tryT/60), stallSecs: Math.round(stall/60),
             pct: Math.round(100*stall/Math.max(1,tryT)), grinders: grinders, top: top,
             worstFrameMs: Math.round(worstMs*100)/100, nav: A };`);
  rows.push({ hour: H, ...S });
  const A = S.nav || {};
  console.log(`hour ${H} (${S.block}): trying ${S.trySecs} actor-s, stalled ${S.stallSecs} (${S.pct}%), grinders>1.5s ${S.grinders}/${S.actors}` +
    `  | nav plans ${A.plans || 0} (partial ${A.partials || 0}, none ${A.planFails || 0}) lastPlan ${A.lastPlanMs || 0}ms build ${A.buildMs || 0}ms  worstFrame ${S.worstFrameMs}ms`);
  for (const t of S.top) console.log("   ", JSON.stringify(t));
}

const worstPct = Math.max(...rows.map((r) => r.pct));
const worstGrind = Math.max(...rows.map((r) => r.grinders));
const nav = rows[rows.length - 1].nav || {};
const worstFrame = Math.max(...rows.map((r) => r.worstFrameMs));
console.log(`grid: ${nav.grid} @${nav.step}m  open ${nav.openCells}/${nav.cells} cells  build ${nav.buildMs}ms  version ${nav.version}`);

// systems/navigation.js's escapeRoute — the player's map arrows — now delegates
// its grid to prisonNav. That path has to keep working, vents and all.
const map = await evl(`
  var W = CBZ.WORLD, S = CBZ.SPAWN || { x: 0, z: 0 };
  var r = CBZ.navigation.plan("escape", { x: S.x, z: S.z }, { x: W.exit.x, z: W.exit.z });
  if (!r) return { no: true };
  var nx = CBZ.navigation.next(r, { x: S.x, z: S.z });
  var straight = Math.hypot(W.exit.x - S.x, W.exit.z - S.z);
  return { kind: r.kind, legs: r.points.length, dist: Math.round(r.distance),
           straight: Math.round(straight), instruction: nx && nx.instruction,
           vents: (CBZ.vents || []).length };`);
console.log("map route:", JSON.stringify(map));

const results = [];
function check(name, ok, detail) { results.push(ok); console.log((ok ? "  ok  " : "FAIL  ") + name + (detail != null ? "  " + detail : "")); }

if (REVERT) {
  // the shipped tree: a quarter of the curfew block's movement is a wall
  check("REVERT: the cast still grinds (worst block >= 12% stalled)", worstPct >= 12, `worst=${worstPct}%`);
  check("REVERT: bodies stuck in geometry (>= 3 grinders in one block)", worstGrind >= 3, `worst=${worstGrind}`);
} else {
  check("no block wastes a tenth of its movement on walls", worstPct <= 10, `worst=${worstPct}%`);
  check("nobody is left grinding (<= 1 grinder in any block)", worstGrind <= 1, `worst=${worstGrind}`);
  check("the planner actually ran", (nav.plans | 0) >= 1, `plans=${nav.plans}`);
  // a PARTIAL route (walk to the locked door and wait) is a good answer; a
  // plan that cannot even improve on standing still is the one to watch
  check("most asks come back with a walk to make",
    (nav.plans | 0) > 0 && (nav.planFails | 0) < (nav.plans | 0),
    `plans=${nav.plans} partial=${nav.partials} none=${nav.planFails}`);
  check("one plan stays inside a frame budget", (nav.lastPlanMs || 0) <= 6, `lastPlan=${nav.lastPlanMs}ms`);
  check("the grid build stays cheap", (nav.buildMs || 0) <= 25, `build=${nav.buildMs}ms`);
  check("no frame blew out", worstFrame <= 90, `worstFrame=${worstFrame}ms`);
  // NOT ">= the straight line": the vents are PORTALS with a flat cost, so the
  // honest route through the crawlspace is legitimately shorter than the walk.
  check("the player's map route still plans (navigation.js delegation)",
    !map.no && map.kind === "grid" && map.legs >= 2 && map.dist > 0 && map.dist <= map.straight * 3,
    `legs=${map.legs} dist=${map.dist}m straight=${map.straight}m`);
  check("the map route reads out a next instruction", !!(map.instruction), `"${map.instruction}"`);
}
const uniqErrors = [...new Set(errors)].filter((e) => !/ProgressEvent/.test(e));
if (uniqErrors.length) console.log("page errors:", uniqErrors.slice(0, 8));
const fails = results.filter((r) => !r).length;
console.log(fails ? `PRISON-NAV: FAIL (${fails}/${results.length})` : `PRISON-NAV: ok (${results.length} checks)`);
done(fails ? 1 : 0);
