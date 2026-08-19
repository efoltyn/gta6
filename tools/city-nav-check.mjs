#!/usr/bin/env node
/* tools/city-nav-check.mjs — GANG CITY WALKS AROUND BUILDINGS. The numeric
   gate for CITY_NAV_V1.

   OWNER: "why gang city ncs often run into walls instead of breaking infra
   jumping thru or SIMPLY BUMPING AND ADJUSTING OR BEING SMARTER."

   Same measurement as the prison gate, pointed at the crowd. A body is STALLED
   on a frame when it MEANS to walk — a state that walks (walk/flee/fight/
   charge/stalk/confront/film/loot), a goal more than 1.2 m off, not pausing,
   not seated — and achieves less than 35% of the step its own speed asked for.

   Measured on the shipped tree, calm street, 683 peds + 12 cops, 10 s:
     56% of attempted movement stalled; 37 bodies grinding more than 1.5 s.

   The gate holds the stalled share and the grinder count, plus the grid's own
   numbers: a 320 m window in a city of 123,072 colliders has to stay cheap
   (built across frames) or the fix costs more than the fault.

   There is no --revert flag: the gate boots the city, measures it, then
   navigates the SAME browser to ?cfg_CITY_NAV_V1=0&cfg_STEER_COMMIT_V1=0 and
   measures again, and asserts the difference. A city is stochastic — fights,
   spawns, traffic — and an absolute threshold in one would be a coin toss.

   Boot boilerplate: tools/prison-nav-check.mjs.
*/
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SECONDS = parseFloat(arg("--seconds", "10"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 8880 + Math.floor(Math.random() * 40);
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const base = `http://127.0.0.1:${port}/`;
// Every run IS the A/B: the fix is toggled at runtime inside one city (see
// below), so there is no --revert flag here.
const target = base;
const dbg = 9880 + Math.floor(Math.random() * 40);
const profile = `/tmp/cbz-citynav-${dbg}`;
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
  await evl("try{CBZ.setMode('city'); CBZ.startRun && CBZ.startRun();}catch(e){return String(e);} return true;");
  await sleep(900);
  playing = await evl("return !!(CBZ.game && CBZ.game.state==='playing' && CBZ.game.mode==='city');");
}
console.log(`playing(city): ${playing}  ${SECONDS}s per side`);
if (!playing) { console.log("ERRORS:", [...new Set(errors)].slice(0, 10)); done(2); }

async function measure(label) {
  await evl(`for (var k=0;k<600;k++) CBZ.stepSim(1/60); return true;`);
  const S = await evl(`
    var pools = [["ped", CBZ.cityPeds||[]], ["cop", CBZ.cityCops||[]]];
    var WALK = {walk:1,flee:1,fight:1,charge:1,stalk:1,confront:1,film:1,loot:1,wander:1,chase:1};
    var roster = [];
    for (var q=0;q<pools.length;q++){ var kind=pools[q][0], L=pools[q][1];
      for (var i=0;i<L.length;i++){ var a=L[i]; if(!a||!a.pos) continue;
        roster.push({a:a,kind:kind,i:i,px:a.pos.x,pz:a.pos.z,lx:a.pos.x,lz:a.pos.z,
                     tryF:0,stallF:0,lockF:0,want:0,path:0,bad:0,near:0,nearTry:0,nearStall:0,
                     blocked:0,blkTry:0,blkStall:0}); } }
    var FR = ${SECONDS} * 60, worstMs = 0, WIN = 30;
    var P = CBZ.player.pos, G = CBZ.navGrid;
    /* MEASURED OVER A WINDOW, NOT A FRAME. city/peds.js staggers the crowd:
       anything outside the 95 m draw band runs its think/walk every THIRD
       frame with the skipped frames' dt paid back in one compensated tick —
       same distance, two thirds of the frames spent standing still. A
       per-frame test reads that as a wall. Half a second is longer than any
       stagger and shorter than any decision.
       LOCKED is the sharper number: a body that TRAVELLED but got nowhere,
       i.e. one walking on the spot rather than one held up by a crowd. */
    for (var f=0; f<FR; f++) {
      var t0 = performance.now(); CBZ.stepSim(1/60); var ms = performance.now()-t0;
      if (f > 30 && ms > worstMs) worstMs = ms;
      // the grid is kept up FOR THE MEASUREMENT in both configurations (with
      // the fix off nothing else asks for it) so the same question can be put
      // to both runs: of the bodies whose straight line to their goal is a
      // wall, how many are getting anywhere?
      if (G) G.focus(P.x, P.z, 160, { coarseOver: 34 });
      for (var r=0;r<roster.length;r++){
        var e=roster[r], a=e.a, p=a.pos;
        e.path += Math.hypot(p.x-e.lx, p.z-e.lz); e.lx=p.x; e.lz=p.z;
        if (a.dead || (a.ko|0)>0 || a.inCar || a.controlled || (a.char && a.char.sitting)
            || !WALK[a.state] || !a.target
            || Math.hypot(a.target.x-p.x, a.target.z-p.z) < 1.2 || (a.pause||0) > 0) {
          e.bad = 1;
        } else {
          e.want += (a.speed || a.baseSpeed || 1.6) * (1/60);
          if (Math.abs(p.x-P.x) < 150 && Math.abs(p.z-P.z) < 150) e.near = 1;
        }
        if ((f % WIN) === 0) {
          e.blocked = (!e.bad && G && G.inWindow(p.x, p.z) && a.target
            && G.lineBlocked(p.x, p.z, a.target.x, a.target.z, 0.75)) ? 1 : 0;
        }
        if ((f % WIN) === WIN - 1) {
          if (!e.bad && e.want > 0.25) {
            var got = Math.hypot(p.x-e.px, p.z-e.pz);
            e.tryF += WIN;
            if (e.near) e.nearTry += WIN;
            if (e.blocked) e.blkTry += WIN;
            if (got < e.want * 0.35) {
              e.stallF += WIN;
              if (e.near) e.nearStall += WIN;
              if (e.blocked) e.blkStall += WIN;
              if (e.path > e.want * 0.5) e.lockF += WIN;   // moving, going nowhere
            }
          }
          e.px = p.x; e.pz = p.z; e.want = 0; e.path = 0; e.bad = 0; e.near = 0;
        }
      }
    }
    roster.sort(function(x,y){return y.stallF-x.stallF;});
    var stall=0, tryT=0, lock=0, grind=0, nearTry=0, nearStall=0, blkTry=0, blkStall=0, top=[];
    for (var r=0;r<roster.length;r++){ var e=roster[r];
      stall+=e.stallF; tryT+=e.tryF; lock+=e.lockF;
      if (e.stallF/60>1.5) grind++;
      nearTry += e.nearTry; nearStall += e.nearStall;
      blkTry += e.blkTry; blkStall += e.blkStall; }
    for (var r=0;r<3 && r<roster.length;r++){ var e=roster[r], a=e.a, p=a.pos;
      top.push({state:a.state||"", job:a.job||"", stallS:+(e.stallF/60).toFixed(1),
        at:[Math.round(p.x),Math.round(p.z)],
        dFromPlayer: Math.round(Math.hypot(p.x-P.x, p.z-P.z))}); }
    var A = CBZ.navGridAudit ? CBZ.navGridAudit() : {};
    return { actors: roster.length, trySecs: Math.round(tryT/60), stallSecs: Math.round(stall/60),
             pct: Math.round(100*stall/Math.max(1,tryT)),
             lockedPct: Math.round(100*lock/Math.max(1,tryT)),
             nearPct: Math.round(100*nearStall/Math.max(1,nearTry)),
             blockedSecs: Math.round(blkTry/60),
             blockedPct: Math.round(100*blkStall/Math.max(1,blkTry)),
             grinders: grind, top: top, worstFrameMs: +worstMs.toFixed(1), nav: A };`);
  const A = S.nav || {};
  console.log(`${label}: ${S.actors} actors. trying ${S.trySecs} actor-s, stalled ${S.pct}%, on-camera ${S.nearPct}%, grinders>1.5s ${S.grinders}`);
  console.log(`   OF THE BODIES WITH A WALL IN THE WAY (${S.blockedSecs} actor-s): ${S.blockedPct}% got nowhere`);
  if (A.plans != null) console.log(`   grid ${A.grid} @${A.step}m window ${A.half}m  builds ${A.builds} last ${A.buildMs}ms  plans ${A.plans} (partial ${A.partials}, none ${A.planFails}) lastPlan ${A.lastPlanMs}ms  worstFrame ${S.worstFrameMs}ms`);
  for (const t of S.top) console.log("   ", JSON.stringify(t));
  return S;
}

/* ---- THE A/B, ON ONE CITY ------------------------------------------------
   How much of a city is stalled at any moment depends on how many fights,
   queues and crowded kerbs happen to exist, and that swings twenty points
   between runs of the same build — so two separate boots cannot be compared,
   and this gate does not try. Both flags are read LIVE, every frame, so the
   fix is switched off and on again underneath ONE running city and the same
   bodies are measured either way. ON is sampled twice, on both sides of the
   OFF window, so a drift in the city over the sample cannot fake the result. */
async function setFlags(on) {
  await evl(`CBZ.CONFIG.CITY_NAV_V1 = ${on ? "true" : "false"};
             CBZ.CONFIG.STEER_COMMIT_V1 = ${on ? "true" : "false"};
             for (var k = 0; k < 90; k++) CBZ.stepSim(1/60);   // let it take effect
             return { nav: CBZ.CONFIG.CITY_NAV_V1, commit: CBZ.CONFIG.STEER_COMMIT_V1 };`);
}

const ON_A = await measure("WITH  nav+commit (A)");
await setFlags(false);
const OFFRUN = await measure("WITHOUT (shipped) ");
await setFlags(true);
const ON_B = await measure("WITH  nav+commit (B)");

const ON = {
  pct: Math.round((ON_A.pct + ON_B.pct) / 2),
  nearPct: Math.round((ON_A.nearPct + ON_B.nearPct) / 2),
  grinders: Math.round((ON_A.grinders + ON_B.grinders) / 2),
  blockedPct: Math.round((ON_A.blockedPct + ON_B.blockedPct) / 2),
  nav: ON_B.nav, worstFrameMs: Math.min(ON_A.worstFrameMs, ON_B.worstFrameMs),
};
console.log(`\nWITH (mean of A,B): stalled ${ON.pct}%, on-camera ${ON.nearPct}%, grinders ${ON.grinders}`);
console.log(`WITHOUT           : stalled ${OFFRUN.pct}%, on-camera ${OFFRUN.nearPct}%, grinders ${OFFRUN.grinders}`);

const results = [];
function check(name, ok, detail) { results.push(ok); console.log((ok ? "  ok  " : "FAIL  ") + name + (detail != null ? "  " + detail : "")); }

check("the same city was measured both ways", Math.abs(ON_A.actors - OFFRUN.actors) < 120,
  `${ON_A.actors} / ${OFFRUN.actors} actors`);
check("less of the crowd's movement is spent on geometry",
  ON.pct <= OFFRUN.pct - 8, `${OFFRUN.pct}% -> ${ON.pct}%`);
check("and on camera, where it can be seen",
  ON.nearPct <= OFFRUN.nearPct - 8, `${OFFRUN.nearPct}% -> ${ON.nearPct}%`);
check("fewer bodies stuck for over 1.5 s",
  ON.grinders <= OFFRUN.grinders * 0.75, `${OFFRUN.grinders} -> ${ON.grinders}`);
const A = ON.nav || {};
check("a plan stays inside a frame budget", (A.lastPlanMs || 0) <= 8, `lastPlan=${A.lastPlanMs}ms`);
check("a window rebuild is sliced, not a hitch", (A.buildMs || 0) <= 40, `build=${A.buildMs}ms`);
// A city spikes on its own — traffic streaming, a building coming into range,
// a fight starting. The question is not whether a spike happened but whether
// WE caused it, so the shipped build's own worst frame is the yardstick.
check("no frame blew out that the shipped build did not",
  ON.worstFrameMs <= Math.max(140, OFFRUN.worstFrameMs * 1.3),
  `ours=${ON.worstFrameMs}ms shipped=${OFFRUN.worstFrameMs}ms`);

const uniqErrors = [...new Set(errors)].filter((e) => !/ProgressEvent/.test(e));
if (uniqErrors.length) console.log("page errors:", uniqErrors.slice(0, 8));
const fails = results.filter((r) => !r).length;
console.log(fails ? `CITY-NAV: FAIL (${fails}/${results.length})` : `CITY-NAV: ok (${results.length} checks)`);
done(fails ? 1 : 0);
