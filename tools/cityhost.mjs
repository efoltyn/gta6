#!/usr/bin/env node
/* ============================================================
   tools/cityhost.mjs — GANG CITY, BOOTED ONCE, ANSWERING FOREVER.

   THE PROBLEM, in the owner's words: "prison game can be tested fast, but the
   racer game takes forever to test because it's a huge game... that is the
   loop — how long it takes to test effectively."

   THE ARITHMETIC THAT MAKES IT TRUE. TESTING-LOOPS.md measured it: one
   headless Gang City build is 40-50 s, and the number of BUILDS dominates
   every loop's wall time. Prison Escape builds in ~1 s, so its loop is its
   test; Gang City's loop is its boot. And every tool in tools/ pays that
   boot privately — racer-story-check boots one world, the before/after
   preset boots TWO, and asking one more question means booting one more
   world. The build is the fixed cost only because nothing ever kept a built
   world alive.

   THIS KEEPS IT ALIVE. One long-lived headless browser holds one built Gang
   City behind a tiny HTTP API. The boot is paid ONCE, when the host starts;
   every question after that costs what the question costs:

       node tools/cityhost.mjs                 # boot + serve (foreground)
       node tools/city.mjs eval "CBZ.cityCars.length"        # ~1 s
       node tools/city.mjs shot grid.png --t 0 --s -60       # ~1-2 s
       node tools/city.mjs step 30                           # 30 sim-seconds
       node tools/city.mjs rerun --origin racer              # fresh RUN: ~2 s
       node tools/city.mjs reload --origin racer             # fresh CODE: ~60 s

   TWO LOOPS, and knowing which one you are in is the whole discipline:
     rerun   (~2 s, measured)  — a fresh LIFE on the built world with the
             scripts the page already parsed. CBZ.startRun() re-populates
             (mode.js's build() early-outs on `city.built`). This is the
             prison-game loop: probe, change a QUESTION, probe again.
     reload  (~60 s)           — a fresh PAGE: new script chain, new build,
             new warm-up frame. This is what an EDIT to a src/ file needs —
             rerun cannot see code the page has not re-parsed.

   TIME IS A PARAMETER, exactly like the tsunami pages: /step holds the live
   loop (CBZ.loopHold) and advances the sim with CBZ.stepSim in whole
   simulated seconds, so "the grid at t+0, the green flag at t+5, lap one at
   t+30" are addressable moments, not luck. /shot draws exactly one frame
   (CBZ.renderFrame) whatever the drawing flag says, so the host boots with
   ?cfg_RENDER_FRAMES=0 — no rasterizer tax on the sim — and still hands back
   pictures. The first shot pays the one-time shader compile; the host pays
   it at startup so no client ever does.

   API (JSON in, JSON out; a portfile at tools/.cityhost.json names the port):
     GET  /status                     {up, mode, origin, simTime, cars, peds, ...}
     POST /eval    {expr}             evaluate in-page, return by value
     POST /step    {seconds, dt?}     hold the loop, stepSim it forward
     POST /hold    {on}               hold/release the live loop explicitly
     POST /shot    {file?, cam?, look?, fov?}  one rendered frame → PNG path
     POST /rerun   {origin?}          fresh run on the built world (~2 s)
     POST /reload  {origin?}          fresh page — picks up code edits (~60 s)
     POST /quit                       shut the host down

   Flags: --params "seed=90210&cfg_X=0" (extra URL params; RENDER_FRAMES=0 and
   a pinned seed=90210 are defaults), --origin <id> (story for the first run),
   --draw (boot with drawing ON — you want this only to eyeball the host),
   --port N (API port, default 7801).
============================================================ */
import { spawn } from "node:child_process";
import { writeFile, mkdir, rm } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SHOTS = path.join(ROOT, "tools/shots");
const PORTFILE = path.join(ROOT, "tools/.cityhost.json");
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const has = (f) => argv.includes(f);
const API = Number(opt("--port", 7801));
const ORIGIN0 = opt("--origin", "");
const DRAW = has("--draw");
const EXTRA = opt("--params", "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (s) => process.stdout.write(`[cityhost ${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}\n`);
await mkdir(SHOTS, { recursive: true });

/* ---- the browser ---------------------------------------------------------- */
async function freePort(lo, span) {
  for (let i = 0; i < 60; i++) {
    const p = lo + Math.floor(Math.random() * span);
    const busy = await new Promise((res) => {
      const s = http.createServer();
      s.once("error", () => res(true));
      s.once("listening", () => s.close(() => res(false)));
      s.listen(p, "127.0.0.1");
    });
    if (!busy) return p;
  }
  throw new Error("no free port");
}
const WEB = await freePort(8400, 200);
const DBG = await freePort(10600, 200);
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")],
  { env: { ...process.env, PORT: String(WEB) }, stdio: "ignore" });
for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${WEB}/`); break; } catch (_) { await sleep(100); } }
const CHROME = process.env.CBZ_CHROME ||
  (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/opt/pw-browsers/chromium");
const profile = `/tmp/cbz-cityhost-${DBG}-${Date.now()}`;
const chrome = spawn(CHROME, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--enable-webgl", "--mute-audio", "--window-size=1120,690",
  "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
  `--remote-debugging-port=${DBG}`, `--user-data-dir=${profile}`, "about:blank",
], { stdio: "ignore" });

let shuttingDown = false;
async function shutdown(code, msg) {
  if (shuttingDown) return; shuttingDown = true;
  if (msg) log(msg);
  try { await rm(PORTFILE, { force: true }); } catch (_) {}
  try { chrome.kill("SIGKILL"); } catch (_) {}
  try { server.kill("SIGTERM"); } catch (_) {}
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0, "SIGINT"));
process.on("SIGTERM", () => shutdown(0, "SIGTERM"));

let target = null;
for (let i = 0; i < 120 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${DBG}/json/list`)).json()).find((t) => t.type === "page"); } catch (_) {}
  if (!target) await sleep(250);
}
if (!target) await shutdown(1, "FAIL: chromium never exposed a page");
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let msgId = 0; const pend = new Map(); const consoleErrors = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") {
    const d = m.params.exceptionDetails || {};
    consoleErrors.push(String((d.exception && (d.exception.description || d.exception.value)) || d.text || "exception").split("\n")[0].slice(0, 200));
  } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
    consoleErrors.push(m.params.args.map((a) => a.value || a.description || "").join(" ").split("\n")[0].slice(0, 200));
  }
});
const send = (method, params, ms = 120000) => new Promise((res) => {
  const i = ++msgId;
  pend.set(i, res);
  ws.send(JSON.stringify({ id: i, method, params: params || {} }));
  setTimeout(() => { if (pend.delete(i)) res({ __to: true }); }, ms);
});
const ev = async (expression, ms) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, ms);
  if (r.__to) return { err: "timeout — the page's main thread did not answer" };
  if (r.result && r.result.exceptionDetails) {
    const d = r.result.exceptionDetails;
    return { err: String((d.exception && d.exception.description) || d.text || "threw").split("\n").slice(0, 3).join(" | ") };
  }
  return { value: r.result && r.result.result && r.result.result.value };
};
await send("Runtime.enable");
await send("Page.enable");

/* ---- boot the world ONCE -------------------------------------------------- */
const params = [
  DRAW ? "" : "cfg_RENDER_FRAMES=0",
  /seed=/.test(EXTRA) ? "" : "seed=90210",
  EXTRA,
].filter(Boolean).join("&");
log(`booting Gang City → http://127.0.0.1:${WEB}/index.html?${params}`);
await send("Page.navigate", { url: `http://127.0.0.1:${WEB}/index.html?${params}` });
for (let i = 0; i < 300; i++) {
  const r = await ev("!!(window.CBZ && CBZ.bootComplete && document.getElementById('playBtn'))", 5000);
  if (r.value === true) break;
  await sleep(400);
}
log("title up; pressing PLAY" + (ORIGIN0 ? ` as "${ORIGIN0}"` : ""));
if (ORIGIN0) await ev(`(function(){ if (CBZ.setCityOrigin) CBZ.setCityOrigin(${JSON.stringify(ORIGIN0)}); var b=document.querySelector('.origin-btn[data-origin=${JSON.stringify(ORIGIN0)}]'); if (b) b.click(); return 1; })()`);
await ev(`(function(){ var b=document.getElementById("playBtn"); if (b) b.click(); return 1; })()`);
let built = false;
for (let i = 0; i < 240 && !built; i++) {
  const r = await ev("!!(window.CBZ && CBZ.game && CBZ.game.state==='playing' && CBZ.city && CBZ.city.arena)", 20000);
  if (r.value === true) built = true; else await sleep(1500);
}
if (!built) await shutdown(2, "FAIL: the world build never finished — run tools/boot-trace.mjs to see which step it died in");
log(`world built in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

/* Pay the one-time shader compile NOW, so no client's first /shot does.
   (With --draw the live loop already paid it.) */
if (!DRAW) {
  const w0 = Date.now();
  await ev("CBZ.renderFrame && CBZ.renderFrame()", 600000);
  log(`shader warm-up frame: ${((Date.now() - w0) / 1000).toFixed(1)}s (one-time)`);
}

/* ---- the API --------------------------------------------------------------- */
function body(req) {
  return new Promise((res) => {
    let b = "";
    req.on("data", (c) => { b += c; if (b.length > 1 << 20) req.destroy(); });
    req.on("end", () => { try { res(b ? JSON.parse(b) : {}); } catch (_) { res({}); } });
  });
}
const j = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };

/* One camera vocabulary for /shot: absolute {x,y,z} or the speedway's track
   coords {t,s,u,h} (same fields the visual presets use), because that venue is
   what gets photographed most. Anything fancier goes through /eval. */
const CAM_EXPR = (cam, look, fov) => `(function(){
  var C = ${JSON.stringify(cam || null)}, L = ${JSON.stringify(look || null)}, F = ${JSON.stringify(fov || null)};
  function node(n){
    if (!n) return null;
    if (n.x != null && n.z != null) return { x:+n.x, y:+(n.y||0), z:+n.z };
    if (typeof CBZ.speedwayFrame !== "function") return null;
    var LEN = CBZ.speedwayTrackLen ? CBZ.speedwayTrackLen() : 1000;
    var t = (+(n.t||0) + (+(n.s||0))/LEN); t -= Math.floor(t);
    var f = CBZ.speedwayFrame(t);
    var x = f.x + f.nx*(+(n.u||0)), z = f.z + f.nz*(+(n.u||0));
    var y = 0; try { y = Math.max(CBZ.speedwaySurfaceY(x,z)||0, CBZ.floorAt?CBZ.floorAt(x,z):0); } catch(e){}
    return { x:x, y:y + (+(n.h||2)), z:z };
  }
  var cam = CBZ.camera;
  var cp = node(C), lp = node(L);
  if (cp) cam.position.set(cp.x, cp.y, cp.z);
  if (lp) cam.lookAt(lp.x, lp.y, lp.z);
  if (F) { cam.fov = +F; cam.updateProjectionMatrix(); }
  try { if (typeof CBZ.skySync === "function") CBZ.skySync(); else { var rig = CBZ.skyDome && CBZ.skyDome.parent; if (rig) rig.position.set(cam.position.x, 0, cam.position.z); } } catch(e){}
  return CBZ.renderFrame ? CBZ.renderFrame() : false;
})()`;

let shotN = 0;
const api = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  try {
    if (req.method === "GET" && u.pathname === "/status") {
      const r = await ev(`JSON.stringify((function(){ var g=CBZ.game; return {
        mode: g.mode, state: g.state, origin: g.cityOrigin, elapsed: Math.round(g.elapsed*10)/10,
        hold: !!CBZ.loopHold, drawing: !(CBZ.CONFIG && CBZ.CONFIG.RENDER_FRAMES===false),
        cars: (CBZ.cityCars||[]).length, peds: (CBZ.cityPeds||[]).length,
        animals: (CBZ.cityWildlife||[]).length,
        race: CBZ.speedwayRaceState ? (function(R){ return {active:R.active, phase:R.phase, drivers:R.drivers.length}; })(CBZ.speedwayRaceState()) : null };
      })())`, 15000);
      return j(res, 200, { up: true, bootedSec: Math.round((Date.now() - t0) / 1000), errors: consoleErrors.slice(-5), page: r.err ? { err: r.err } : JSON.parse(r.value) });
    }
    if (req.method === "POST" && u.pathname === "/eval") {
      const { expr } = await body(req);
      if (!expr) return j(res, 400, { err: "expr required" });
      const r = await ev(`JSON.stringify((function(){ try { return { v: (function(){ ${expr.includes("return ") ? expr : "return (" + expr + ")"} })() }; } catch (e) { return { thrown: String(e && (e.stack || e)).slice(0, 400) }; } })())`, 120000);
      if (r.err) return j(res, 500, { err: r.err });
      return j(res, 200, JSON.parse(r.value));
    }
    if (req.method === "POST" && u.pathname === "/step") {
      const { seconds = 1, dt = 1 / 30 } = await body(req);
      const r = await ev(`(function(){
        CBZ.loopHold = true;
        var n = Math.max(1, Math.round(${+seconds} / ${+dt}));
        var t0 = performance.now();
        for (var i = 0; i < n; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(${+dt}); }
        return JSON.stringify({ ticks: n, simSec: n * ${+dt}, wallMs: Math.round(performance.now() - t0) });
      })()`, 600000);
      if (r.err) return j(res, 500, { err: r.err });
      return j(res, 200, JSON.parse(r.value));
    }
    if (req.method === "POST" && u.pathname === "/hold") {
      const { on } = await body(req);
      await ev(`(CBZ.loopHold = ${!!on}, true)`, 10000);
      return j(res, 200, { hold: !!on });
    }
    if (req.method === "POST" && u.pathname === "/shot") {
      const { file, cam, look, fov } = await body(req);
      const r = await ev(CAM_EXPR(cam, look, fov), 600000);
      if (r.err) return j(res, 500, { err: r.err });
      const s = await send("Page.captureScreenshot", { format: "png" }, 120000);
      if (!s.result || !s.result.data) return j(res, 500, { err: "captureScreenshot failed" });
      const name = file || `cityhost-${String(++shotN).padStart(3, "0")}.png`;
      const p = path.isAbsolute(name) ? name : path.join(SHOTS, name);
      await writeFile(p, Buffer.from(s.result.data, "base64"));
      return j(res, 200, { file: p });
    }
    if (req.method === "POST" && u.pathname === "/rerun") {
      const { origin } = await body(req);
      /* A RERUN IS A NEW LIFE, and a life has THREE homes — the exact list
         systems/newlife.js documents: the in-memory ledger, localStorage,
         and sqlitedb's OPFS mirror, which is worldstate load()'s FIRST stop
         when present and survives both localStorage.clear() and navigation.
         The first cut of this endpoint cleared one home, then two, and each
         time the "fresh" character resurrected with the old life's records —
         found by putting a setter trap on game.cityWorld and reading the
         assigning stack, which named sqlitedb.cachedWorld(). This is
         newlife.js's own wipe sequence, minus its reload: block the 5 s
         autosave FIRST (or it writes the just-cleared ledger straight back
         mid-wipe), clear all three, then start. */
      const r = await ev(`(async function(){
        CBZ.loopHold = false;
        var g = CBZ.game;
        g._citySaveBlocked = true;
        try { localStorage.clear(); } catch (e) {}
        try { if (CBZ.sqlitedb && CBZ.sqlitedb.clearWorld) await CBZ.sqlitedb.clearWorld(); } catch (e) {}
        g.cityWorld = null; g.cityCampaign = null; g.cityCampaignPending = null;
        ${origin ? `if (CBZ.setCityOrigin) CBZ.setCityOrigin(${JSON.stringify(origin)}); g.cityOriginPicked = true;` : ""}
        g._citySaveBlocked = false;
        if (CBZ.startRun) { CBZ.startRun(); return "startRun"; }
        return "no startRun";
      })()`, 600000);
      if (r.err) return j(res, 500, { err: r.err });
      // wait for the (cheap — world already built) reset to land
      for (let i = 0; i < 120; i++) {
        const s = await ev("!!(CBZ.game && CBZ.game.state==='playing' && CBZ.city && CBZ.city.arena)", 20000);
        if (s.value === true) return j(res, 200, { rerun: true, via: r.value });
        await sleep(1000);
      }
      return j(res, 500, { err: "rerun never reached playing" });
    }
    if (req.method === "POST" && u.pathname === "/reload") {
      /* THE EDIT LOOP. /rerun re-runs the WORLD with the scripts the page
         already parsed — a 2-second round trip, but blind to code edits.
         This reloads the PAGE (fresh script chain, fresh build, fresh
         one-time warm-up frame), which is what testing an edit to a src/
         file actually requires. ~45-60 s on this box — still several times
         cheaper than a cold tool boot, and the host survives it. */
      const { origin } = await body(req);
      const o2 = origin || ORIGIN0;
      const r0 = Date.now();
      await send("Page.navigate", { url: `http://127.0.0.1:${WEB}/index.html?${params}&bust=${Date.now()}` });
      let title = false;
      for (let i = 0; i < 200 && !title; i++) {
        const r = await ev("!!(window.CBZ && CBZ.bootComplete && document.getElementById('playBtn'))", 5000);
        if (r.value === true) title = true; else await sleep(400);
      }
      if (!title) return j(res, 500, { err: "reload: title never came up" });
      // all three save layers — sqlitedb's OPFS mirror survives navigation
      await ev("(async function(){ try { localStorage.clear(); } catch (e) {} try { if (CBZ.sqlitedb && CBZ.sqlitedb.clearWorld) await CBZ.sqlitedb.clearWorld(); } catch (e) {} CBZ.game.cityWorld = null; return true; })()", 30000);
      if (o2) await ev(`(function(){ if (CBZ.setCityOrigin) CBZ.setCityOrigin(${JSON.stringify(o2)}); var b=document.querySelector('.origin-btn[data-origin=${JSON.stringify(o2)}]'); if (b) b.click(); return 1; })()`);
      await ev(`(function(){ var b=document.getElementById("playBtn"); if (b) b.click(); return 1; })()`);
      let ok2 = false;
      for (let i = 0; i < 240 && !ok2; i++) {
        const r = await ev("!!(CBZ.game && CBZ.game.state==='playing' && CBZ.city && CBZ.city.arena)", 20000);
        if (r.value === true) ok2 = true; else await sleep(1500);
      }
      if (!ok2) return j(res, 500, { err: "reload: build never finished" });
      if (!DRAW) await ev("CBZ.renderFrame && CBZ.renderFrame()", 600000);
      shotN = 0;
      return j(res, 200, { reload: true, origin: o2 || null, sec: Math.round((Date.now() - r0) / 1000) });
    }
    if (req.method === "POST" && u.pathname === "/quit") {
      j(res, 200, { bye: true });
      setTimeout(() => shutdown(0, "quit requested"), 100);
      return;
    }
    return j(res, 404, { err: "unknown endpoint" });
  } catch (e) {
    return j(res, 500, { err: String(e && e.message || e) });
  }
});
await new Promise((r) => api.listen(API, "127.0.0.1", r));
await writeFile(PORTFILE, JSON.stringify({ port: API, web: WEB, pid: process.pid, started: Date.now() }));
log(`READY — api http://127.0.0.1:${API}  (portfile tools/.cityhost.json)`);
log(`try:  node tools/city.mjs status`);
