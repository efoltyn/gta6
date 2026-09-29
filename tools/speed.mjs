#!/usr/bin/env node
/* ============================================================
   tools/speed.mjs — THE SPEED TEST. One command, one table, one JSON.

   Closes the loop on game speed: how long each mode takes to LOAD (by phase)
   and what a frame of PLAY costs (per updater, per render), with a noise
   estimate on every number, saved and compared against a baseline so a
   regression or an improvement is called only when it clears the noise.

     node tools/speed.mjs                         # Gang City: load + in-game (default)
     node tools/speed.mjs --modes all             # every mode + the games/ pages
     node tools/speed.mjs --modes city,escape     # a list
     node tools/speed.mjs --load | --play         # one half only
     node tools/speed.mjs --runs 3                # repeats (fresh page each)
     node tools/speed.mjs --save tools/speed-baseline.json
     node tools/speed.mjs --against tools/speed-baseline.json
     node tools/speed.mjs --ref origin/main       # measure ANOTHER COMMIT (git archive → temp dir)
     node tools/speed.mjs --url http://127.0.0.1:8000/   # an already-running server / other worktree
     node tools/speed.mjs --root /tmp/snap        # serve a directory (e.g. git archive HEAD + only your files)
     node tools/speed.mjs --profile               # + V8 sampling profile: top functions (file:function)
     node tools/speed.mjs --attribute             # + DIAGNOSTIC: what HD settings / vegetation cost
     node tools/speed.mjs --device tablet         # iPad viewport + touch preload (absorbs ipad-perf)
     node tools/speed.mjs --gpu swiftshader       # software GL (default is the real GPU)
     node tools/speed.mjs --json out.json         # write the full result anywhere
     node tools/speed.mjs --seed 90210 --frames 90 --warm 20

   WHAT IT MEASURES (all in-page, performance.now(); no wall-clock guessing):
     LOAD, per mode: fetch+eval of every <script> (per-file, from each script's
       load event vs its responseEnd), bootComplete, the synchronous build
       (CBZ.startRun) split by every CBZ.bootStep checkpoint and every landmass
       builder, then the first frames (shader compile + upload) one by one.
       games/ pages: navigation → ready → entry → first draw call.
     PLAY (city by default): rAF is HELD and frames are stepped by hand with a
       synthetic 1/60 clock — the REAL loop() runs, updaters + always + render
       — at fixed camera spots (spawn street, densest downtown, an aerial look
       over the densest forest) plus a drive path. Per frame: every updater's
       ms, render() CPU ms, gl.finish() ms (GPU proxy: work still queued on
       the GPU after submit), renderer.info calls/triangles, GL-level draw
       count, programs. Median and p95 over the stepped frames.
     LOOK GUARD: pixel ratio, drawing buffer, quality tier, shadow map, fog
       far, visible tree/prop instances, texture pixels. A "faster" result
       that came with a drop in any of them is flagged LOOK REGRESSION, never
       a win (owner order 2026-09-28: "don't kill the HDness").

   HOW IT STAYS HONEST ON ANY COMMIT. Everything is injected by a preload
   (Page.addScriptToEvaluateOnNewDocument) that wraps what every commit has:
   CBZ.bootStep, CBZ._landmassBuilders, CBZ.updaters/always, renderer.render,
   requestAnimationFrame and the WebGL draw entry points. Nothing in the game
   is edited to be measured, so --ref <old sha> measures old code the same way.

   REAL GPU, HEADLESS. Measured 2026-09-28 on the owner's M1 Pro: headless
   Chrome's default GL is ANGLE-on-Metal (the real GPU); 20 fullscreen draws
   cost 2-3 ms there against 70-230 ms on SwiftShader. The old tools forced
   SwiftShader, which is why their frame numbers were noise. This one uses
   the real GPU by default (--gpu swiftshader to compare).

   HD, AS THE GAME PICKS IT. The window is a MacBook viewport (1512x982 CSS)
   at devicePixelRatio 2, on a FRESH profile, so the quality tier is whatever
   the game chooses for a first-time desktop player (--device tablet for the
   iPad class). Nothing is lowered to be measured.

   NOISE. Each metric carries a noise figure: across runs (half the range /
   MAD) when --runs > 1, else the within-run spread of the frame samples.
   A compare flags a change only past max(3 x combined noise, 5%, abs floor).
   `uptime` load averages are recorded at start and end of every result: a
   box at load 30 is not a regression.

   LOCK. Every measurement holds /tmp/cbz-speed.lock (machine-wide; waits,
   then runs; a lock whose pid is dead or >30 min old is stale and is taken).
   Other tools that boot headless cities should honour it.

   Exit: 0 ok, 1 a mode failed to boot/build, 4 --against found a regression.
============================================================ */
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TOOL_T0 = Date.now();
const ROOT0 = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
if (has("--help") || has("-h")) {
  const src = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
  console.log(src.slice(src.indexOf("/*"), src.indexOf("*/") + 2));
  process.exit(0);
}

const PAGE_MODES = {
  // index.html modes: ?mode=X, then CBZ.startRun()
  city: { kind: "cbz", page: "index.html", mode: "city" },
  escape: { kind: "cbz", page: "index.html", mode: "escape" },
  survival: { kind: "cbz", page: "index.html", mode: "survival" },
  sharksim: { kind: "cbz", page: "index.html", mode: "sharksim" },
  gungame: { kind: "cbz", page: "index.html", mode: "gungame" },
  // standalone pages: ready → entry (click or URL door) → first draw
  battle: { kind: "page", page: "games/battle.html", ready: "!!(window.__battle && document.getElementById('start'))", entry: "document.getElementById('start').click()" },
  warlord: { kind: "page", page: "games/warlord.html", query: "go=1", ready: "!!window.__warlordReady", entry: "" },
  bomb: { kind: "page", page: "games/bomb-survivor.html", ready: "!!(window.__bomb && document.getElementById('go'))", entry: "document.getElementById('go').click()" },
};
const ALL_MODES = Object.keys(PAGE_MODES);
const modesArg = opt("--modes", opt("--mode", "city"));
const MODES = modesArg === "all" ? ALL_MODES : modesArg.split(",").map((s) => s.trim()).filter(Boolean);
for (const m of MODES) if (!PAGE_MODES[m]) { console.error(`unknown mode ${m}; known: ${ALL_MODES.join(", ")}`); process.exit(2); }
const DO_LOAD = !has("--play") || has("--load");
const DO_PLAY = !has("--load") || has("--play");
const RUNS = Math.max(1, +opt("--runs", 1) || 1);
const SEED = opt("--seed", "90210");
const FRAMES = Math.max(10, +opt("--frames", 20) || 20);
const WARM = Math.max(0, +opt("--warm", 8));
const GPU = opt("--gpu", "real");
const DEVICE = opt("--device", "desktop");
const QUERY = opt("--query", "");
const PROFILE = has("--profile");
const ATTRIBUTE = has("--attribute");
const SAVE = opt("--save", "");
const AGAINST = opt("--against", "");
const JSON_OUT = opt("--json", "");
const URL_ARG = opt("--url", "");
const REF = opt("--ref", "");
const ROOT_ARG = opt("--root", "");   // serve this directory instead (a snapshot: HEAD + only the files under test)
const QUIET = has("--quiet");
const NO_NORM = has("--no-norm");
const BUILD_BUDGET_S = +opt("--budget", 420);
const SETTLE_MAX = Math.max(6, +opt("--settle", 40));
const LOCK = "/tmp/cbz-speed.lock";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (s) => { if (!QUIET) process.stderr.write(s + "\n"); };
const since = () => ((Date.now() - TOOL_T0) / 1000).toFixed(1) + "s";

/* ---------------- the machine-wide lock ---------------- */
function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } }
async function takeLock() {
  let told = false;
  for (;;) {
    try {
      fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, started: Date.now(), cmd: "speed.mjs " + argv.join(" ") }), { flag: "wx" });
      return;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      let cur = null;
      try { cur = JSON.parse(fs.readFileSync(LOCK, "utf8")); } catch (_) {}
      if (cur && typeof cur !== "object") cur = { pid: cur };
      // Stale = owner pid dead, or older than 30 min. Other tools write this
      // lock too ({pid, at: ISO} or a bare pid); read every format, and fall
      // back to the file's mtime for the age.
      let pid = cur && +cur.pid, born = cur && (+cur.started || Date.parse(cur.at || "") || 0);
      if (!pid) { try { pid = parseInt(fs.readFileSync(LOCK, "utf8"), 10) || 0; } catch (_) {} }
      if (!born) { try { born = fs.statSync(LOCK).mtimeMs; } catch (_) { born = 0; } }
      const stale = (pid && !pidAlive(pid)) || Date.now() - born > 30 * 60 * 1000;
      if (stale) { try { fs.unlinkSync(LOCK); } catch (_) {} continue; }
      if (!told) { log(`[speed] waiting for ${LOCK} (pid ${pid}: ${(cur && (cur.cmd || cur.who || cur.tool)) || "?"})`); told = true; }
      await sleep(2000);
    }
  }
}
function releaseLock() {
  try { const cur = JSON.parse(fs.readFileSync(LOCK, "utf8")); if (cur.pid === process.pid) fs.unlinkSync(LOCK); } catch (_) {}
}
function uptime() {
  const l = os.loadavg();
  return { load1: +l[0].toFixed(2), load5: +l[1].toFixed(2), load15: +l[2].toFixed(2), cpus: os.cpus().length };
}

/* ---------------- what to serve ---------------- */
let ROOT = ROOT0, tmpRefDir = null, commit = "";
function git(args, cwd) { return execFileSync("git", args, { cwd: cwd || ROOT0, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
if (REF) {
  const sha = git(["rev-parse", REF]);
  tmpRefDir = fs.mkdtempSync(path.join(os.tmpdir(), "cbz-speed-ref-"));
  execFileSync("sh", ["-c", `git archive ${sha} | tar -x -C ${JSON.stringify(tmpRefDir)}`], { cwd: ROOT0 });
  ROOT = tmpRefDir; commit = sha.slice(0, 10) + " (" + REF + ")";
} else if (ROOT_ARG) {
  ROOT = path.resolve(ROOT_ARG); commit = "root " + ROOT;
} else if (!URL_ARG) {
  try { commit = git(["rev-parse", "--short=10", "HEAD"]) + (git(["status", "--porcelain", "--untracked-files=no"]) ? "+dirty" : ""); } catch (_) {}
}

const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".wasm": "application/wasm",
  ".glb": "model/gltf-binary", ".gltf": "model/gltf+json", ".bin": "application/octet-stream", ".hdr": "application/octet-stream",
  ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".woff2": "font/woff2", ".ttf": "font/ttf", ".txt": "text/plain", ".3mf": "model/3mf" };
function startServer(root) {
  // In-process static server: no python spawn, keep-alive, no-store (every
  // load is a cold load, the same as tools/devserver.py serves).
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p.endsWith("/")) p += "index.html";
    const f = path.join(root, path.normalize(p).replace(/^(\.\.[/\\])+/, ""));
    if (!f.startsWith(root)) { res.writeHead(403); return res.end(); }
    fs.readFile(f, (err, buf) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "Content-Type": MIME[path.extname(f).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" });
      res.end(buf);
    });
  });
  srv.keepAliveTimeout = 30000;
  return new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv)));
}

/* ---------------- Chrome + CDP (one browser, flat sessions) ---------------- */
const CHROME = process.env.CBZ_CHROME || (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/opt/pw-browsers/chromium");
const VIEW = DEVICE === "tablet" ? { w: 1180, h: 820, dpr: 2 } : DEVICE === "phone" ? { w: 390, h: 844, dpr: 3 } : { w: 1512, h: 982, dpr: 2 };
async function launchChrome() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "cbz-speed-chrome-"));
  const gl = GPU === "swiftshader" ? ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
    : GPU === "metal" ? ["--use-angle=metal", "--ignore-gpu-blocklist"] : ["--ignore-gpu-blocklist"];
  const proc = spawn(CHROME, ["--headless=new", "--no-sandbox", ...gl, "--enable-webgl", "--mute-audio",
    `--window-size=${VIEW.w},${VIEW.h}`, `--force-device-scale-factor=${VIEW.dpr}`,
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
    "--disable-background-networking", "--disable-component-update", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  const wsUrl = await new Promise((res, rej) => {
    let buf = "";
    const to = setTimeout(() => rej(new Error("chrome never printed its DevTools endpoint")), 30000);
    proc.stderr.on("data", (d) => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(to); res(m[1]); } });
    proc.on("exit", () => rej(new Error("chrome exited")));
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map(); const listeners = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id != null && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return; }
    for (const l of listeners) l(m);
  };
  const send = (method, params = {}, sessionId, timeoutMs = 60000) => new Promise((res, rej) => {
    const mid = ++id; const t = setTimeout(() => { if (pend.delete(mid)) rej(new Error(`CDP timeout ${method}`)); }, timeoutMs);
    pend.set(mid, { res: (v) => { clearTimeout(t); res(v); }, rej: (e) => { clearTimeout(t); rej(e); } });
    ws.send(JSON.stringify({ id: mid, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  return { proc, ws, send, listeners, profile,
    close() { try { ws.close(); } catch (_) {} try { proc.kill("SIGKILL"); } catch (_) {} try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {} } };
}

/* ---------------- the preload: every commit, every page ---------------- */
const PRELOAD = String.raw`(function(){
if (window.top !== window || window.__speed) return;
var now = function(){ return performance.now(); };
var S = window.__speed = { scripts: [], errs: [], errN: 0, hold: false, q: [], t: 0, marks: {}, raf: [], rafLog: true,
  gls: [], draws: 0, tris: 0, firstDrawAt: 0, steps: [], builders: [], uacc: {}, useries: {}, render: 0, rdepth: 0, finishMs: 0 };
document.addEventListener("load", function(e){ var t = e.target; if (t && t.tagName === "SCRIPT" && t.src) {
  /* prisonRoot's child count after each script: the scripts that grow it are
     the prison being built at parse time, in EVERY mode */
  var pr = -1; try { pr = window.CBZ && CBZ.prisonRoot ? CBZ.prisonRoot.children.length : -1; } catch (_) {}
  S.scripts.push([t.src, now(), pr]); } }, true);
/* window "load" handlers (core/batch.js batches + freezes the prison there): time each */
S.loadHandlers = [];
var wael = window.addEventListener;
window.addEventListener = function(type, fn, o){
  if (type === "load" && typeof fn === "function" && !fn.__sp) { var src = srcOf() || fn.name || "?"; var f = fn;
    var w = function(e){ var s = now(); try { return f.apply(this, arguments); } finally { S.loadHandlers.push([src, now() - s, s]); } };
    w.__sp = 1; return wael.call(this, type, w, o); }
  return wael.apply(this, arguments); };
addEventListener("load", function(){ S.marks.loadStart = now(); });
document.addEventListener("DOMContentLoaded", function(){ S.marks.dcl = now(); });
addEventListener("error", function(e){ S.errN++; if (S.errs.length < 12) S.errs.push(String(e.message || e.type) + (e.filename ? " @" + String(e.filename).split("/").pop() + ":" + e.lineno : "")); }, true);
var ce = console.error; console.error = function(){ S.errN++; if (S.errs.length < 12) { try { S.errs.push(Array.prototype.map.call(arguments, function(a){ return a && a.stack ? String(a.stack).split("\n").slice(0,2).join(" ") : String(a); }).join(" ").slice(0, 240)); } catch (_) {} } return ce.apply(console, arguments); };
/* rAF: live frames are logged; held frames queue for S.step() */
var rAF = window.requestAnimationFrame.bind(window);
window.requestAnimationFrame = function(cb){
  if (S.hold) { S.q.push(cb); return 1e7 + S.q.length; }
  /* a frame requested BEFORE the hold that fires after it is queued too, or
     the title loop's in-flight frame would run the first (compiling) render
     unmeasured right after the build */
  return rAF(function(t){ if (S.hold) { S.q.push(cb); return; } var s = now(); try { cb(t); } finally { if (S.rafLog && S.raf.length < 6000) S.raf.push([t, s, now() - s]); } });
};
/* WebGL: capture contexts; count draws (always on; ~20 ns per call) */
var gc = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function(type){ var c = gc.apply(this, arguments); if (c && /webgl/.test(type) && S.gls.indexOf(c) < 0) S.gls.push(c); return c; };
function tri(mode, n){ return mode === 4 ? n / 3 : (mode === 5 || mode === 6) ? Math.max(0, n - 2) : 0; }
function hook(proto, name, cntIdx, instIdx){
  if (!proto || !proto[name]) return; var f = proto[name];
  proto[name] = function(){ if (!S.firstDrawAt) S.firstDrawAt = now(); S.draws++; S.tris += tri(arguments[0], arguments[cntIdx]) * (instIdx != null ? arguments[instIdx] : 1); return f.apply(this, arguments); };
}
[window.WebGLRenderingContext, window.WebGL2RenderingContext].forEach(function(C){ if (!C) return; var p = C.prototype;
  hook(p, "drawArrays", 2); hook(p, "drawElements", 1); hook(p, "drawArraysInstanced", 2, 3); hook(p, "drawElementsInstanced", 1, 4); hook(p, "drawRangeElements", 3); });
/* shader compile: time every GL call that can block on the GPU process's
   compiler (r128 with checkShaderErrors=false blocks at the first
   getProgramParameter/getActiveUniform of a new program, at first draw) */
S.compileMs = 0;
[window.WebGLRenderingContext, window.WebGL2RenderingContext].forEach(function(C){ if (!C) return; var p = C.prototype;
  ["compileShader","linkProgram","getProgramParameter","getShaderParameter","getActiveUniform","getActiveAttrib","getUniformLocation","getAttribLocation","getProgramInfoLog","getShaderInfoLog"].forEach(function(n){
    var f = p[n]; if (!f) return; p[n] = function(){ var s = now(); try { return f.apply(this, arguments); } finally { S.compileMs += now() - s; } }; }); });
var ANGLE = window.ANGLEInstancedArrays; if (ANGLE) { hook(ANGLE.prototype, "drawArraysInstancedANGLE", 2, 3); hook(ANGLE.prototype, "drawElementsInstancedANGLE", 1, 4); }
/* Name every updater: trap CBZ.onUpdate/onAlways so each entry carries the file:line that registered it (config.js's own source tag only exists under ?profile=1). */
function srcOf(){ var st = (new Error()).stack || ""; var L = st.split("\n");
  for (var i = 2; i < L.length; i++) { var m = L[i].match(/((?:src|games)\/[^:?)]+\.js)(?:\?[^:)\s]+)?:(\d+)/); if (m && !/src\/(config|core\/prio|core\/microboot|core\/studio)\.js/.test(m[1])) return m[1] + ":" + m[2]; }
  return ""; }
function trapReg(C, name, listName){ var cur = C[name];
  Object.defineProperty(C, name, { configurable: true, enumerable: true, get: function(){ return cur; }, set: function(fn){
    if (typeof fn !== "function" || fn.__sp) { cur = fn; return; }
    var w = function(order, f){ var list = C[listName]; var n0 = list ? list.length : 0; var r = fn.apply(this, arguments);
      list = C[listName]; if (list && list.length > n0) { var e = list[list.length - 1]; if (e && !e.__src) e.__src = srcOf(); } return r; };
    w.__sp = 1; cur = w; } });
  if (cur) C[name] = cur; }
var CBZv;
try { Object.defineProperty(window, "CBZ", { configurable: true, enumerable: true, get: function(){ return CBZv; }, set: function(v){
  CBZv = v; if (v && typeof v === "object" && !v.__spTrap) { v.__spTrap = 1; trapReg(v, "onUpdate", "updaters"); trapReg(v, "onAlways", "always"); } } }); } catch (_) {}

/* ---- the build: checkpoints + landmass builders (armed before startRun) ---- */
S.armBuild = function(){
  var C = window.CBZ; if (!C || S.buildArmed) return; S.buildArmed = 1;
  var bs = C.bootStep; C.bootStep = function(k){ S.steps.push([k == null ? "?" : String(k), now()]); if (bs) return bs.apply(this, arguments); };
  (C._landmassBuilders || []).forEach(function(b, i){ if (b.__sp) return; b.__sp = 1; var f = b.fn;
    var name = String(b.bootKey || b.file || (f && f.name) || ("builder#" + i)).replace(/^lm:/, "").replace(/^.*\//, "");
    b.fn = function(){ var st = S.steps[S.steps.length - 1]; if (st && st[0] === "?") st[0] = "lm:" + name;
      var s = now(); try { return f.apply(this, arguments); } finally { S.builders.push([name, now() - s]); } }; });
};
/* ---- per-frame accounting ---- */
function keyOf(e, kind){ return kind + "@" + e.order + " " + (e.__src || e.source || (e.fn && e.fn.name) || "?"); }
S.wrapUpdaters = function(){
  var C = window.CBZ; if (!C) return 0; var n = 0;
  [["u", C.updaters], ["a", C.always]].forEach(function(p){ var list = p[1] || [];
    for (var i = 0; i < list.length; i++) (function(e){ if (!e || e.__spw || typeof e.fn !== "function") return; e.__spw = 1; n++;
      var f = e.fn, k = keyOf(e, p[0]); if (S.uacc[k] == null) S.uacc[k] = 0;
      e.fn = function(dt){ var s = now(); try { return f.call(this, dt); } finally { S.uacc[k] += now() - s; } }; })(list[i]); });
  return n;
};
S.wrapRender = function(){
  var C = window.CBZ, r = C && C.renderer; if (!r || r.render.__sp) return !!r;
  var real = r.render;
  r.render = function(scene, cam){
    var main = cam === C.camera;
    if (S.rdepth++ === 0 && S.pose && main) S.applyPose(cam);
    var pl = r.info && r.info.programs, p0 = pl ? pl.length : 0;
    var s = now(); try { return real.apply(this, arguments); } finally { if (--S.rdepth === 0) { if (main) S.render += now() - s; else S.renderOther += now() - s; }
      if (pl && pl.length > p0) S.progWhy(pl, p0, main ? "main" : (srcOf() || (cam && (cam.name || cam.type)) || "other")); } };
  r.render.__sp = 1; return true;
};
/* WHY DID A PROGRAM COMPILE MID-PLAY? r128 keys a program by the joined
   parameter list (WebGLPrograms.getProgramCacheKey). For each new program,
   find the existing program of the same shader + custom key that differs in
   the FEWEST parameters and name those parameters (numPointLights 5>8,
   fog, instancing...). A new shader/custom key with no sibling is "new
   material". S.pcause: { "who | shader | what": count }. */
var PK = ["precision","isWebGL2","supportsVertexTextures","outputEncoding","instancing","instancingColor","map","mapEncoding","matcap","matcapEncoding","envMap","envMapMode","envMapEncoding","envMapCubeUV","lightMap","lightMapEncoding","aoMap","emissiveMap","emissiveMapEncoding","bumpMap","normalMap","objectSpaceNormalMap","tangentSpaceNormalMap","clearcoatMap","clearcoatRoughnessMap","clearcoatNormalMap","displacementMap","specularMap","roughnessMap","metalnessMap","gradientMap","alphaMap","combine","vertexColors","vertexAlphas","vertexTangents","vertexUvs","uvsVertexOnly","fog","useFog","fogExp2","flatShading","sizeAttenuation","logarithmicDepthBuffer","skinning","maxBones","useVertexTexture","morphTargets","morphNormals","premultipliedAlpha","numDirLights","numPointLights","numSpotLights","numHemiLights","numRectAreaLights","numDirLightShadows","numPointLightShadows","numSpotLightShadows","shadowMapEnabled","shadowMapType","toneMapping","physicallyCorrectLights","alphaTest","doubleSided","flipSided","numClippingPlanes","numClipIntersection","depthPacking","dithering","sheen","transmissionMap"];
function pparse(key){ var t = String(key).split(","), i = 0;
  for (; i < t.length - 1; i++) if (/^(highp|mediump|lowp)$/.test(t[i]) && /^(true|false)$/.test(t[i + 1])) break;
  if (i >= t.length - 1) return { head: String(key).slice(0, 60), p: null };
  var head = t[0] + (i > 1 ? "+defs" : ""), tail = t.slice(i + PK.length + 2).join(",");
  var h = 0; for (var k = 0; k < tail.length; k++) h = (h * 31 + tail.charCodeAt(k)) | 0;
  return { head: head, defs: t.slice(1, i).join(","), cust: h, p: t.slice(i, i + PK.length) }; }
S.pcause = {}; S.pnew = 0;
S.progWhy = function(pl, p0, who){
  for (var n = p0; n < pl.length; n++) { var np = pparse(pl[n].cacheKey), best = null, bd = 1e9;
    if (np.p) for (var j = 0; j < n; j++) { var op = pl[j].__pp || (pl[j].__pp = pparse(pl[j].cacheKey));
      if (!op.p || op.head !== np.head || op.cust !== np.cust || op.defs !== np.defs) continue;
      var d = []; for (var k = 0; k < PK.length; k++) if (op.p[k] !== np.p[k]) d.push(PK[k] + " " + op.p[k] + ">" + np.p[k]);
      if (d.length < bd) { bd = d.length; best = d; } }
    pl[n].__pp = np; S.pnew++;
    var what = best ? best.slice(0, 4).join("; ") : (np.p ? "new material/defines" : "raw shader");
    var key = who + " | " + np.head + " | " + what;
    S.pcause[key] = (S.pcause[key] || 0) + 1; } };
S.gl = function(){ var C = window.CBZ; if (C && C.renderer && C.renderer.getContext) return C.renderer.getContext(); return S.gls[S.gls.length - 1] || null; };
/* MACHINE SPEED: a fixed JS workload, median of 5, taken beside every
   measurement. On a shared Mac, run-to-run noise is the box, not the frames
   (measured: 3 runs at load 9→25 spread 20% while 20 vs 60 frames changed
   nothing). A compare scales CPU-ms metrics by the ratio of the two results'
   calibrations so a busy box is not read as a regression. */
S.calib = function(){ var a = [];
  for (var k = 0; k < 5; k++) { var t = now(), x = 0; for (var i = 0; i < 1500000; i++) { x += Math.sqrt(i ^ (x & 1023)); } a.push(now() - t); S._cx = x; }
  a.sort(function(p, q){ return p - q; }); return a[2]; };
S.hold_ = function(){ S.hold = true; S.rafLog = false; S.t = now(); };
/* Step n held frames with a synthetic 1/60 clock. Returns per-frame rows. */
S.step = function(n, o){
  o = o || {}; var C = window.CBZ, r = C && C.renderer, gl = S.gl(), out = [];
  if (r && r.info) r.info.autoReset = false;
  for (var i = 0; i < n; i++) {
    if (o.path) o.path(i, n);
    S.t += 1000 / 60;
    if (!S.q.length && !S.kicked && C && C.startLoop) { S.kicked = 1; C.startLoop(); }   // loop not pending: restart it into the hold queue
    var cbs = S.q; S.q = [];
    for (var k in S.uacc) S.uacc[k] = 0;
    S.render = 0; S.renderOther = 0; S.draws = 0; S.tris = 0; S.compileMs = 0;
    var p0 = r && r.info && r.info.programs ? r.info.programs.length : 0;
    if (r && r.info) r.info.reset();
    var s = now();
    for (var j = 0; j < cbs.length; j++) { try { cbs[j](S.t); } catch (e) { S.errN++; if (S.errs.length < 12) S.errs.push("[step] " + (e && e.message)); } }
    var cpu = now() - s, fin = 0;
    /* GPU proxy: a 1-pixel readback cannot return until the GPU has finished
       the frame (gl.finish() is a no-op wait in Chrome: measured 0.0 ms). */
    if (gl && o.finish !== false) { var f0 = now(); try { gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, S.px || (S.px = new Uint8Array(4))); } catch (_) {} fin = now() - f0; }
    var sim = 0, alw = 0, row = { cpu: cpu, fin: fin, render: S.render, rOther: S.renderOther, compile: S.compileMs, draws: S.draws, glTris: Math.round(S.tris) };
    if (o.perUpdater) row.u = {};
    for (var key in S.uacc) { var v = S.uacc[key]; if (key.charCodeAt(0) === 117) sim += v; else alw += v; if (o.perUpdater && v > 0) row.u[key] = v; }
    row.sim = sim; row.alw = alw;
    if (r && r.info) { row.calls = r.info.render.calls; row.tris = r.info.render.triangles; row.programs = r.info.programs ? r.info.programs.length : 0; row.newPrograms = row.programs - p0; }
    if (!cbs.length) row.empty = 1;
    out.push(row);
  }
  if (r && r.info) r.info.autoReset = true;
  return out;
};
})();`;

/* ---------------- page helpers (in-page functions sent as source) ---------------- */
// Everything below is evaluated in the page. Plain ES5-ish, no backticks.
const PAGE_LIB = String.raw`(function(){
var S = window.__speed, C = window.CBZ, now = function(){ return performance.now(); };
var VEG = /tree|forest|canopy|foliage|vegetation|palm|pine|spruce|conifer|bush|shrub|grass|frond|leaf|crown|trunk|thicket|hedge|saguaro|cactus|jungle|wood(?!en|work)|orchard|reed|fern/i;
function isVeg(o){ if (VEG.test(o.name || "")) return true; var m = o.material; if (Array.isArray(m)) m = m[0];
  if (m && /vegetation|foliage|leaf|bark|palm|tree|grass/i.test(m.name || "")) return true;
  if (o.geometry && VEG.test(o.geometry.name || "")) return true; return false; }
function visibleUp(o){ while (o) { if (!o.visible) return false; o = o.parent; } return true; }
function triOf(g){ if (!g) return 0; var n = g.index ? g.index.count : (g.attributes && g.attributes.position ? g.attributes.position.count : 0); var dr = g.drawRange; if (dr && dr.count !== Infinity) n = Math.min(n, dr.count); return n / 3; }
/* scene census: counts + vegetation + the LOOK fields */
S.census = function(){
  var sc = C.scene, out = { objects: 0, meshes: 0, visibleMeshes: 0, instanced: 0, instances: 0, visibleInstances: 0, sceneTris: 0,
    veg: { meshes: 0, instancedMeshes: 0, instances: 0, visibleInstances: 0, tris: 0, visibleTris: 0, castShadow: 0, names: {} } };
  var texSeen = new Set(), texPx = 0, texMax = 0;
  sc.traverse(function(o){ out.objects++;
    if (!o.isMesh && !o.isInstancedMesh && !o.isPoints && !o.isLine) return;
    out.meshes++; var vis = visibleUp(o); if (vis) out.visibleMeshes++;
    var inst = o.isInstancedMesh ? o.count : 1, t = triOf(o.geometry) * inst;
    if (o.isInstancedMesh) { out.instanced++; out.instances += inst; if (vis) out.visibleInstances += inst; }
    if (vis) out.sceneTris += t;
    var mats = Array.isArray(o.material) ? o.material : [o.material];
    for (var i = 0; i < mats.length; i++) { var m = mats[i]; if (!m) continue;
      ["map","normalMap","roughnessMap","emissiveMap","alphaMap","aoMap","bumpMap"].forEach(function(k){ var tx = m[k]; if (!tx || texSeen.has(tx)) return; texSeen.add(tx);
        var im = tx.image; var w = im && (im.width || (im.data && im.width)) || 0, h = im && im.height || 0; texPx += w * h; texMax = Math.max(texMax, w, h); }); }
    if (isVeg(o)) { var v = out.veg; if (o.isInstancedMesh) { v.instancedMeshes++; v.instances += inst; if (vis) v.visibleInstances += inst; } else v.meshes++;
      v.tris += t; if (vis) v.visibleTris += t; if (o.castShadow) v.castShadow++;
      var nm = (o.name || (o.material && o.material.name) || "?").replace(/[0-9]+/g, "#").slice(0, 40); v.names[nm] = (v.names[nm] || 0) + inst; }
  });
  out.sceneTris = Math.round(out.sceneTris); out.veg.tris = Math.round(out.veg.tris); out.veg.visibleTris = Math.round(out.veg.visibleTris);
  var top = Object.keys(out.veg.names).map(function(k){ return [k, out.veg.names[k]]; }).sort(function(a,b){ return b[1]-a[1]; }).slice(0, 12);
  out.veg.names = top;
  try { if (C.treeAudit) { var ta = C.treeAudit(); out.veg.registeredTrees = ta && ta.trees; } } catch (_) {}
  out.textures = { unique: texSeen.size, megapixels: +(texPx / 1e6).toFixed(2), maxDim: texMax };
  return out;
};
/* LIGHTS: r128 keys every lit program by the visible light COUNT per type, so
   a count that differs between spots (or frames) is a mid-play compile. */
S.lights = function(){
  var out = { point: 0, pointAll: 0, spot: 0, spotAll: 0, dir: 0, hemi: 0, amb: 0, groups: {} };
  C.scene.traverse(function(o){ if (!o.isLight) return; var v = visibleUp(o);
    var k = o.isPointLight ? "point" : o.isSpotLight ? "spot" : o.isDirectionalLight ? "dir" : o.isHemisphereLight ? "hemi" : "amb";
    if (k === "point" || k === "spot") { out[k + "All"]++; if (v) out[k]++; } else if (v) out[k]++;
    var path = [], q = o.parent; while (q && q !== C.scene && path.length < 3) { path.push((q.name || q.type).slice(0, 24)); q = q.parent; }
    var g = k + " " + path.reverse().join("/") + (v ? "" : " (hidden)"); out.groups[g] = (out.groups[g] || 0) + 1; });
  return out;
};
S.look = function(){
  var r = C.renderer, gl = r && r.getContext && r.getContext(), sun = C.sun, L = {};
  try { L.pixelRatio = +r.getPixelRatio().toFixed(3); } catch (_) {}
  try { L.drawingBuffer = gl.drawingBufferWidth + "x" + gl.drawingBufferHeight; L.bufferMP = +((gl.drawingBufferWidth * gl.drawingBufferHeight) / 1e6).toFixed(3); } catch (_) {}
  try { L.devicePixelRatio = devicePixelRatio; L.css = innerWidth + "x" + innerHeight; } catch (_) {}
  try { if (C.getQualityLevel) L.tier = C.getQualityLevel(); } catch (_) {}
  try { L.deviceClass = C.deviceClass; L.gpu = C.gpuName || ""; } catch (_) {}
  try { L.shadows = !!(r.shadowMap && r.shadowMap.enabled) && !!(sun && sun.castShadow); L.shadowMap = sun && sun.shadow ? sun.shadow.mapSize.x : 0; } catch (_) {}
  try { L.fogFar = C.scene.fog ? Math.round(C.scene.fog.far) : 0; } catch (_) {}
  try { L.antialias = gl.getContextAttributes().antialias; } catch (_) {}
  return L;
};
/* ---- the city's fixed spots (deterministic from the seed's world) ---- */
function P(){ return C.player; }
function ground(x, z){ try { var f = C.groundAt || C.cityGroundHeightAt || C.terrainHeight; if (f) { var y = f(x, z); if (y != null && isFinite(y)) return y; } } catch (_) {} return null; }
S.spots = function(){
  var p = P(), out = {};
  if (p && p.pos) out.spawn = { x: p.pos.x, y: p.pos.y, z: p.pos.z, player: true };
  /* densest downtown: the 160 m cell holding the most building-ish meshes */
  var cells = {}, vcells = {}, sc = C.scene, v3 = new THREE.Vector3(), m4 = new THREE.Matrix4();
  var root = (C.city && C.city.arena && C.city.arena.root) || sc;
  root.updateMatrixWorld(true);
  root.traverse(function(o){
    if (!o.isMesh) return;
    if (o.isInstancedMesh && isVeg(o)) {
      var step = Math.max(1, Math.floor(o.count / 400));
      for (var i = 0; i < o.count; i += step) { o.getMatrixAt(i, m4); v3.setFromMatrixPosition(m4).applyMatrix4(o.matrixWorld);
        var k = Math.floor(v3.x / 400) + "," + Math.floor(v3.z / 400); vcells[k] = (vcells[k] || 0) + step; }
      return;
    }
    if (isVeg(o)) return;
    var g = o.geometry; if (!g) return; if (!g.boundingBox) try { g.computeBoundingBox(); } catch (_) { return; }
    var bb = g.boundingBox; if (!bb || !isFinite(bb.max.y)) return;
    var hgt = (bb.max.y - bb.min.y) * o.matrixWorld.elements[5];
    if (hgt < 12) return;
    v3.setFromMatrixPosition(o.matrixWorld);
    var k2 = Math.floor(v3.x / 160) + "," + Math.floor(v3.z / 160); cells[k2] = (cells[k2] || 0) + 1;
  });
  function best(c, sz){ var bk = null, bn = -1; for (var k in c) if (c[k] > bn) { bn = c[k]; bk = k; } if (!bk) return null; var a = bk.split(","); return { x: (+a[0] + 0.5) * sz, z: (+a[1] + 0.5) * sz, n: bn }; }
  var d = best(cells, 160); if (d) {
    /* stand where a pedestrian stands (a pavement), not inside a tower */
    var bp = null, bd = 1e18; (C.cityPeds || []).forEach(function(q){ var qp = q && (q.pos || (q.group && q.group.position) || (q.mesh && q.mesh.position)); if (!qp || q.dead) return;
      var dd = (qp.x - d.x) * (qp.x - d.x) + (qp.z - d.z) * (qp.z - d.z); if (dd < bd) { bd = dd; bp = qp; } });
    if (bp && bd < 150 * 150) out.downtown = { x: bp.x, y: bp.y, z: bp.z, n: d.n, player: true, via: "ped" };
    else { var gy = ground(d.x, d.z); out.downtown = { x: d.x, y: (gy != null ? gy : (p ? p.pos.y : 0)), z: d.z, n: d.n, player: true }; } }
  var f = best(vcells, 400); if (f) { var fy = ground(f.x, f.z); if (fy == null) fy = 0;
    out.aerial = { x: f.x, y: fy, z: f.z, n: f.n, cam: { x: f.x - 160, y: fy + 110, z: f.z - 160, lx: f.x, ly: fy, lz: f.z } }; }
  return out;
};
S.applyPose = function(cam){ var q = S.pose; cam.position.set(q.x, q.y, q.z); cam.lookAt(q.lx, q.ly, q.lz); cam.updateMatrixWorld(true);
  try { var rig = C.skyDome && C.skyDome.parent; if (rig && rig.position) rig.position.set(q.x, 0, q.z); } catch (_) {} };
S.place = function(s){
  var p = P(); S.pose = s.cam || null;
  if (p && p.pos) { try { if (p.driving && C.exitVehicle) C.exitVehicle(); } catch (_) {}
    p.pos.x = s.x; p.pos.z = s.z; if (s.y != null && isFinite(s.y)) p.pos.y = s.y;
    if (p.vel) { p.vel.x = 0; p.vel.y = 0; p.vel.z = 0; } p.hp = Math.max(p.hp || 0, 100); }
  if (S.pose) S.applyPose(C.camera);
};
/* PIN: a spot is a spot. The campaign spawn is a rooftop drop, so an unpinned
   player falls through the measurement and every run sees a different view. */
S.pin = function(s){ return function(){ var p = P(); if (!p || !p.pos) return; p.pos.x = s.x; p.pos.z = s.z; if (s.y != null && isFinite(s.y)) p.pos.y = s.y;
  if (p.vel) { p.vel.x = 0; p.vel.y = 0; p.vel.z = 0; } p.hp = Math.max(p.hp || 0, 100); }; };
/* a straight drive from spawn toward downtown at 25 m/s */
S.pathFn = function(a, b){ return function(i, n){ var p = P(); if (!p || !p.pos) return; var f = Math.min(1, (i * 25 / 60) / Math.max(1, Math.hypot(b.x - a.x, b.z - a.z)));
  p.pos.x = a.x + (b.x - a.x) * f; p.pos.z = a.z + (b.z - a.z) * f; var gy = ground(p.pos.x, p.pos.z); if (gy != null) p.pos.y = gy; p.hp = Math.max(p.hp || 0, 100); }; };
S.summ = function(rows){
  function st(k){ var a = rows.map(function(r){ return r[k] || 0; }).sort(function(x,y){ return x-y; }); var n = a.length; if (!n) return null;
    var med = a[n >> 1], p95 = a[Math.min(n - 1, Math.floor(n * 0.95))];
    var dev = a.map(function(v){ return Math.abs(v - med); }).sort(function(x,y){ return x-y; })[n >> 1];
    return { med: med, p95: p95, mad: dev, n: n }; }
  var o = {}; ["cpu","fin","render","rOther","compile","sim","alw","calls","tris","draws","glTris","programs"].forEach(function(k){ o[k] = st(k); });
  /* hitches: frames over 3x the median, with who did it */
  var cm = o.cpu ? o.cpu.med : 0; o.hitches = []; o.hitchMs = 0;
  rows.forEach(function(r, i){ if (r.cpu > Math.max(3 * cm, cm + 50)) { o.hitchMs += r.cpu - cm; var w = null, wv = 0; if (r.u) for (var k in r.u) if (r.u[k] > wv) { wv = r.u[k]; w = k; }
    if (r.render - cm > wv) { w = "render"; wv = r.render; } o.hitches.push([i, Math.round(r.cpu), w, Math.round(wv), r.newPrograms || 0]); } });
  o.hitches = o.hitches.slice(0, 12);
  var s0 = 0; rows.forEach(function(r){ s0 += r.cpu + r.fin; }); o.meanFrame = s0 / rows.length;
  o.series = rows.map(function(r){ return Math.round((r.cpu + r.fin) * 10) / 10; });
  var ups = {}; rows.forEach(function(r){ if (r.u) for (var k in r.u) (ups[k] = ups[k] || []).push(r.u[k]); });
  var ul = Object.keys(ups).map(function(k){ var a = ups[k].concat(); while (a.length < rows.length) a.push(0); a.sort(function(x,y){ return x-y; });
    var sum = 0; for (var i = 0; i < a.length; i++) sum += a[i];
    return [k, a[a.length >> 1], a[Math.min(a.length - 1, Math.floor(a.length * 0.95))], sum / a.length]; });
  ul.sort(function(x, y){ return y[3] - x[3]; });
  o.updaters = ul.slice(0, 40);
  return o;
};
return true;
})()`;

/* ---------------- one page run ---------------- */
function modeUrl(base, m) {
  const d = PAGE_MODES[m];
  const q = [];
  if (d.kind === "cbz") q.push("mode=" + d.mode);
  if (d.query) q.push(d.query);
  q.push("seed=" + SEED);
  if (DEVICE !== "desktop") q.push("device=" + DEVICE);
  if (QUERY) q.push(QUERY.replace(/^[?&]/, ""));
  return base.replace(/\/?$/, "/") + d.page + "?" + q.join("&");
}

async function newPage(B) {
  const { browserContextId } = await B.send("Target.createBrowserContext", { disposeOnDetach: true });
  const { targetId } = await B.send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await B.send("Target.attachToTarget", { targetId, flatten: true });
  const s = (m, p, t) => B.send(m, p, sessionId, t);
  await s("Page.enable"); await s("Runtime.enable");
  const ev = async (expression, timeoutMs = 60000) => {
    const r = await s("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, timeout: timeoutMs }, timeoutMs + 5000);
    if (r.exceptionDetails) throw new Error("page threw: " + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text).slice(0, 400));
    return r.result.value;
  };
  let pre = PRELOAD;
  if (DEVICE !== "desktop") {
    try { pre = fs.readFileSync(path.join(ROOT0, "tools/preload/ipad.js"), "utf8") + "\n;" + PRELOAD; } catch (_) {}
    await s("Emulation.setDeviceMetricsOverride", { width: VIEW.w, height: VIEW.h, deviceScaleFactor: VIEW.dpr, mobile: DEVICE === "phone" });
    await s("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  }
  await s("Page.addScriptToEvaluateOnNewDocument", { source: pre });
  return { s, ev, close: async () => { try { await B.send("Target.closeTarget", { targetId }); } catch (_) {} try { await B.send("Target.disposeBrowserContext", { browserContextId }); } catch (_) {} } };
}

async function waitFor(ev, expr, budgetS, what) {
  const t = Date.now();
  while ((Date.now() - t) / 1000 < budgetS) {
    try { if (await ev(expr, 5000)) return true; } catch (_) {}
    await sleep(60);
  }
  throw new Error(`${what}: not ready after ${budgetS}s`);
}

// Aggregate the per-script table: eval = load(i) - max(load(i-1), responseEnd(i))
const SCRIPT_TABLE = String.raw`(function(){
  var S = window.__speed, res = {}; performance.getEntriesByType("resource").forEach(function(e){ res[e.name] = e; });
  var prev = 0, rows = [], fetchWait = 0, prisonEval = 0, prisonFiles = 0, pk = -1;
  S.scripts.forEach(function(s){ var e = res[s[0]]; var re = e ? e.responseEnd : 0; var st = Math.max(prev, re); fetchWait += Math.max(0, re - prev);
    var ev = Math.max(0, s[1] - st);
    if (pk >= 0 && s[2] > pk) { prisonEval += ev; prisonFiles++; } if (s[2] >= 0) pk = s[2];
    rows.push([s[0].replace(location.origin + "/", "").replace(/\?.*$/, ""), ev, e ? e.transferSize || e.encodedBodySize || 0 : 0]); prev = s[1]; });
  var lh = 0, lhTop = []; (S.loadHandlers || []).forEach(function(h){ lh += h[1]; lhTop.push([h[0], h[1]]); }); lhTop.sort(function(a,b){ return b[1]-a[1]; });
  var nav = performance.getEntriesByType("navigation")[0] || {};
  var byDir = {}; rows.forEach(function(r){ var d = r[0].split("/").slice(0, 2).join("/"); byDir[d] = (byDir[d] || 0) + r[1]; });
  var top = rows.slice().sort(function(a,b){ return b[1]-a[1]; }).slice(0, 15);
  var evalSum = 0; rows.forEach(function(r){ evalSum += r[1]; });
  var loadEnd = 0; (S.loadHandlers || []).forEach(function(h){ loadEnd = Math.max(loadEnd, h[2] + h[1]); });
  return { n: rows.length, lastScriptAt: prev, evalMs: evalSum, prisonEvalMs: prisonEval, prisonFiles: prisonFiles, loadHandlersMs: lh, loadHandlers: lhTop.slice(0, 5),
    titleReadyAt: prev, loadEventAt: S.marks.loadStart || 0, loadEnd: loadEnd, fetchWaitMs: fetchWait, dcl: S.marks.dcl || nav.domContentLoadedEventEnd || 0,
    responseStart: nav.responseStart || 0, top: top, byDir: byDir };
})()`;

async function runCbz(B, base, m, withPlay) {
  const P = await newPage(B);
  const out = { mode: m, ok: false };
  let prof = null;
  try {
    const url = modeUrl(base, m);
    const tNav = Date.now();
    await P.s("Page.navigate", { url });
    await waitFor(P.ev, "!!(window.CBZ && CBZ.bootComplete && CBZ.startRun && window.__speed && document.readyState === 'complete')", 240, "bootComplete");
    await P.ev(PAGE_LIB);
    const scr = await P.ev(SCRIPT_TABLE);
    const bootAt = await P.ev("(function(){ var S = window.__speed; S.bootAt = performance.now(); S.armBuild(); S.hold_(); return S.bootAt; })()");
    out.calibs = [await P.ev("window.__speed.calib()")];
    out.scripts = scr;
    out.tool = { booted: Date.now() - tNav };
    if (PROFILE) { await P.s("Profiler.enable"); await P.s("Profiler.setSamplingInterval", { interval: 1000 }); await P.s("Profiler.start"); }
    // THE BUILD: one synchronous task. Timed in-page.
    const b = await P.ev(`(function(){ var S = window.__speed; S.compileMs = 0; var t0 = performance.now(); var err = null;
      try { CBZ.startRun(); } catch (e) { err = String(e && e.stack || e).slice(0, 400); }
      var t1 = performance.now(); S.t = t1; S.wrapRender(); S.wrapUpdaters();
      return { t0: t0, t1: t1, err: err, compile: S.compileMs, state: CBZ.game && CBZ.game.state, steps: S.steps, builders: S.builders }; })()`, BUILD_BUDGET_S * 1000);
    if (b.err) throw new Error("startRun threw: " + b.err);
    if (PROFILE) { const { profile } = await P.s("Profiler.stop", {}, 240000); prof = { build: profile }; }
    out.buildMs = b.t1 - b.t0;
    out.buildCompileMs = b.compile;
    out.state = b.state;
    // checkpoint gaps (gap = work BEFORE that key) + builder table
    // CBZ.bootStep(key) marks the START of step `key` (systems/bootprogress.js
    // step()): a key's cost runs to the next checkpoint.
    const phases = [];
    if (b.steps.length) phases.push(["(before first checkpoint)", b.steps[0][1] - b.t0]);
    for (let i = 0; i < b.steps.length; i++) phases.push([b.steps[i][0], (i + 1 < b.steps.length ? b.steps[i + 1][1] : b.t1) - b.steps[i][1]]);
    out.phases = phases;
    out.builders = b.builders.slice().sort((x, y) => y[1] - x[1]);
    // the title loop's in-flight frame lands in the hold queue (see the preload)
    await P.ev("new Promise(function(r){ setTimeout(r, 40); })");
    // FIRST FRAMES: shader compile + uploads. One by one.
    if (PROFILE) { await P.s("Profiler.start"); }
    /* SETTLE: step frames one at a time until the last 5 compiled nothing
       and none of them is a hitch (max < 2x min, all < 250 ms). Frame 1 is
       "first frame"; frames 2.. up to the steady tail are "settle". */
    const first = await P.ev(`(function(){ var S = window.__speed, rows = []; S.pcause = {};
      for (var i = 0; i < ${SETTLE_MAX}; i++) { rows.push(S.step(1, { finish: true, perUpdater: true })[0]);
        if (rows.length >= 6) { var t = rows.slice(-5), mx = 0, mn = 1e9, np = 0;
          t.forEach(function(r){ var f = r.cpu + r.fin; mx = Math.max(mx, f); mn = Math.min(mn, f); np += r.newPrograms || 0; });
          if (!np && mx < 2 * mn && mx < 250) break; } }
      return rows; })()`, 600000);
    const top1 = (r) => { let w = "", v = 0; for (const k in r.u || {}) if (r.u[k] > v) { v = r.u[k]; w = k; } return w ? `${w} ${v.toFixed(0)}` : ""; };
    out.firstFrames = first.map((r) => ({ cpu: +r.cpu.toFixed(1), fin: +r.fin.toFixed(1), render: +r.render.toFixed(1), rOther: +r.rOther.toFixed(1), sim: +r.sim.toFixed(1), newPrograms: r.newPrograms, calls: r.calls, top: top1(r) }));
    const settled = first.length < SETTLE_MAX ? first.length - 5 : first.length;
    out.settleFrames = settled;
    out.firstFrameMs = first[0].cpu + first[0].fin;
    out.firstFrameCompileMs = first[0].compile;
    out.settleCompileMs = first.slice(1).reduce((a, r) => a + r.compile, 0);
    out.warmMs = first.slice(1, settled).reduce((a, r) => a + r.cpu + r.fin, 0);
    out.programs = first[first.length - 1].programs;
    out.firstPcause = await P.ev("window.__speed.pcause");
    if (PROFILE) { const { profile } = await P.s("Profiler.stop", {}, 240000); prof.first = profile; }
    out.boot = { dcl: scr.dcl, bootComplete: bootAt, scriptEval: scr.evalMs, fetchWait: scr.fetchWaitMs };
    out.loadMs = scr.titleReadyAt + out.buildMs + out.firstFrameMs + out.warmMs;   // nav → title interactive → build → frames until steady
    out.tool.built = Date.now() - tNav;
    out.look = await P.ev("window.__speed.look()");
    out.census = await P.ev("window.__speed.census()", 120000);
    out.ok = true;
    out.tool.census = Date.now() - tNav;
    if (withPlay) out.play = await playSpots(P, m);
    out.tool.played = Date.now() - tNav;
    if (out.play) for (const o of Object.values(out.play.spots)) if (o.calib) out.calibs.push(o.calib);
    out.calib = out.calibs.reduce((a, b) => a + b, 0) / out.calibs.length;
    if (PROFILE && withPlay) {
      await P.s("Profiler.start");
      await P.ev("window.__speed.step(" + FRAMES + ", {})", 300000);
      const { profile } = await P.s("Profiler.stop", {}, 240000); prof.play = profile;
    }
    out.errors = await P.ev("({ n: window.__speed.errN, first: window.__speed.errs.slice(0, 6) })");
    out.wallS = (Date.now() - tNav) / 1000;
  } catch (e) {
    out.error = String(e.message || e);
    try { out.errors = await P.ev("({ n: window.__speed.errN, first: window.__speed.errs.slice(0, 6) })", 5000); } catch (_) {}
  } finally {
    await P.close();
  }
  if (prof) out.profile = summarizeProfiles(prof);
  return out;
}

async function playSpots(P, m) {
  const tS = Date.now();
  const spots = m === "city" ? await P.ev("window.__speed.spots()", 120000) : await P.ev("(function(){ var p = CBZ.player; return p && p.pos ? { spawn: { x: p.pos.x, y: p.pos.y, z: p.pos.z, player: true } } : { spawn: { x: 0, y: 0, z: 0 } }; })()");
  const res = { spots: {}, spotsMs: Date.now() - tS };
  log(`[speed ${since()}]   spots located in ${res.spotsMs} ms`);
  const order = Object.keys(spots);
  await P.ev("(function(){ window.__speed._spawn = null; return 1; })()");
  for (const name of order) {
    const sp = spots[name];
    const r = await P.ev(`(function(){ var S = window.__speed; S.place(${JSON.stringify(sp)});
      var cal = S.calib(); var pin = S.pin(${JSON.stringify(sp)}); S.pcause = {};
      S.step(${WARM}, { finish: true, path: pin });
      var rows = S.step(${FRAMES}, { finish: true, perUpdater: true, path: pin });
      var o = S.summ(rows); o.spot = ${JSON.stringify(sp)}; o.look = S.look(); o.calib = (cal + S.calib()) / 2; o.pcause = S.pcause; o.lights = S.lights();
      o.emptyFrames = rows.filter(function(r){ return r.empty; }).length; return o; })()`, 300000);
    res.spots[name] = r;
    log(`[speed ${since()}]   ${m}/${name}: frame ${fmt(r.cpu.med)}+${fmt(r.fin.med)} ms (sim ${fmt(r.sim.med)}, render ${fmt(r.render.med)}) calls ${r.calls && r.calls.med} tris ${r.tris && r.tris.med}`);
  }
  if (m === "city" && spots.spawn && spots.downtown) {
    const r = await P.ev(`(function(){ var S = window.__speed; S.pose = null; S.place(${JSON.stringify(spots.spawn)});
      var fn = S.pathFn(${JSON.stringify(spots.spawn)}, ${JSON.stringify(spots.downtown)}); S.pcause = {};
      var rows = S.step(${FRAMES * 2}, { finish: true, perUpdater: true, path: fn });
      var o = S.summ(rows); o.spot = { path: "spawn->downtown @25m/s" }; o.pcause = S.pcause; return o; })()`, 300000);
    res.spots.drive = r;
    log(`[speed ${since()}]   ${m}/drive: frame ${fmt(r.cpu.med)}+${fmt(r.fin.med)} ms (sim ${fmt(r.sim.med)}, render ${fmt(r.render.med)}) calls ${r.calls && r.calls.med}`);
  }
  /* the diagnostic pass runs AFTER every measured spot, so its extra frames
     (world time moves on: aircraft fall, fires spread) never leak into them */
  if (ATTRIBUTE) for (const name of order) {
    await P.ev(`(function(){ var S = window.__speed, sp = ${JSON.stringify(spots[name])}; S.place(sp); S.step(${WARM}, { finish: true, path: S.pin(sp) }); return 1; })()`, 300000);
    res.spots[name].attribute = await attribute(P, spots[name]);
    log(`[speed ${since()}]   ${m}/${name}: attribution done`);
  }
  return res;
}

/* DIAGNOSTIC ONLY: what share of the frame do the HD settings and the trees
   explain at this spot? Same spot, same frame; toggles restored after. Never
   a default, never a "win". */
async function attribute(P, sp) {
  return P.ev(`(function(){
    var S = window.__speed, C = window.CBZ, r = C.renderer, sun = C.sun, N = 24, pin = S.pin(${JSON.stringify(sp)});
    function meas(){ S.step(4, { finish: true, path: pin }); var rows = S.step(N, { finish: true, path: pin }); var o = S.summ(rows);
      return { frame: +(o.cpu.med + o.fin.med).toFixed(2), render: +o.render.med.toFixed(2), fin: +o.fin.med.toFixed(2), sim: +o.sim.med.toFixed(2), calls: o.calls && o.calls.med, tris: o.tris && o.tris.med }; }
    var out = { base: meas() };
    var pr0 = r.getPixelRatio();
    r.setPixelRatio(devicePixelRatio); out.fullDPR = meas(); out.fullDPR.pr = devicePixelRatio;
    r.setPixelRatio(Math.max(0.5, pr0 / 2)); out.halfPR = meas(); out.halfPR.pr = Math.max(0.5, pr0 / 2);
    r.setPixelRatio(pr0);
    var sm0 = r.shadowMap.enabled, cs0 = sun && sun.castShadow;
    r.shadowMap.enabled = false; if (sun) sun.castShadow = false; out.noShadows = meas();
    r.shadowMap.enabled = sm0; if (sun) sun.castShadow = cs0;
    var q0 = C.getQualityLevel ? C.getQualityLevel() : null;
    if (q0 != null && q0 > 0 && C.setQualityLevel) { C.setQualityLevel(q0 - 1); out.tierDown = meas(); out.tierDown.tier = q0 - 1; C.setQualityLevel(q0); }
    if (q0 != null && q0 < 4 && C.setQualityLevel) { C.setQualityLevel(q0 + 1); out.tierUp = meas(); out.tierUp.tier = q0 + 1; C.setQualityLevel(q0); }
    /* vegetation by subtraction: hide every vegetation mesh, re-measure */
    var VEG = /tree|forest|canopy|foliage|vegetation|palm|pine|spruce|conifer|bush|shrub|grass|frond|leaf|crown|trunk|thicket|hedge|saguaro|cactus|jungle|wood(?!en|work)|orchard|reed|fern/i;
    var hid = [];
    C.scene.traverse(function(o){ if (!(o.isMesh || o.isInstancedMesh) || !o.visible) return; var m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (VEG.test(o.name || "") || (m && /vegetation|foliage|leaf|bark|palm|tree|grass/i.test(m.name || "")) || (o.geometry && VEG.test(o.geometry.name || ""))) hid.push(o); });
    var vis0 = hid.map(function(o){ return o.visible; });
    /* systems may re-show things each frame; hide inside a render wrapper */
    var rr = r.render; r.render = function(){ for (var i = 0; i < hid.length; i++) hid[i].visible = false; return rr.apply(this, arguments); };
    out.noVegetation = meas(); out.noVegetation.hidden = hid.length;
    r.render = rr; for (var i = 0; i < hid.length; i++) hid[i].visible = vis0[i];
    out.base2 = meas();
    return out; })()`, 300000);
}

async function runPage(B, base, m, withPlay) {
  const d = PAGE_MODES[m];
  const P = await newPage(B);
  const out = { mode: m, ok: false };
  try {
    const tNav = Date.now();
    await P.s("Page.navigate", { url: modeUrl(base, m) });
    await waitFor(P.ev, `!!(window.__speed && (${d.ready}))`, 240, "ready");
    const scr = await P.ev(SCRIPT_TABLE);
    out.scripts = scr;
    const readyAt = await P.ev("performance.now()");
    // entry: click (or the URL door already started it); then first draw after entry
    const entryAt = await P.ev(`(function(){ var S = window.__speed; S.firstDrawAt = 0; S.entryAt = performance.now(); ${d.entry || ""}; return S.entryAt; })()`);
    await waitFor(P.ev, "window.__speed.firstDrawAt > 0", 240, "first draw");
    // frames until cheap: live rAF log, 3 frames in a row under 50 ms or 8 s
    await P.ev(`new Promise(function(res){ var S = window.__speed, t0 = performance.now(); (function chk(){
      var f = S.raf.filter(function(x){ return x[1] >= S.entryAt; }); var c = 0; for (var i = f.length - 1; i >= 0 && f[i][2] < 50; i--) c++;
      if (c >= 3 || performance.now() - t0 > 8000) return res(1); setTimeout(chk, 50); })(); })`, 20000);
    const t = await P.ev(`(function(){ var S = window.__speed; var f = S.raf.filter(function(x){ return x[1] >= S.entryAt; });
      var warm = 0, heavy = f.length; for (var i = f.length - 1; i >= 0; i--) if (f[i][2] >= 50) { heavy = i; break; }
      var lastHeavy = heavy < f.length ? f[heavy][1] + f[heavy][2] : S.firstDrawAt;
      return { firstDraw: S.firstDrawAt, cheapAt: Math.max(lastHeavy, S.firstDrawAt), frames: f.slice(0, 8).map(function(x){ return +x[2].toFixed(1); }) }; })()`);
    out.boot = { dcl: scr.dcl, ready: readyAt, scriptEval: scr.evalMs, fetchWait: scr.fetchWaitMs };
    out.calib = await P.ev("window.__speed.calib()");
    out.entryToFirstDraw = t.firstDraw - entryAt;
    out.firstFrames = t.frames;
    out.loadMs = (d.entry ? readyAt : 0) + (t.cheapAt - (d.entry ? entryAt : 0));
    out.phases = [["script eval + page ready", readyAt], ["entry → first draw", t.firstDraw - entryAt], ["first draw → frames cheap", t.cheapAt - t.firstDraw]];
    out.ok = true;
    if (withPlay) {
      await P.ev("(function(){ var S = window.__speed; S.hold_(); return new Promise(function(r){ setTimeout(r, 60); }); })()");
      await P.ev(PAGE_LIB.replace("var S = window.__speed, C = window.CBZ", "var S = window.__speed, C = window.CBZ || {}"));
      const r = await P.ev(`(function(){ var S = window.__speed; S.wrapUpdaters && window.CBZ && window.CBZ.updaters && S.wrapUpdaters();
        S.step(${WARM}, { finish: true }); var rows = S.step(${FRAMES}, { finish: true, perUpdater: true }); var o = S.summ(rows);
        o.emptyFrames = rows.filter(function(r){ return r.empty; }).length; return o; })()`, 300000);
      out.play = { spots: { live: r } };
      log(`[speed ${since()}]   ${m}/live: frame ${fmt(r.cpu.med)}+${fmt(r.fin.med)} ms, draws ${r.draws && r.draws.med}`);
    }
    out.errors = await P.ev("({ n: window.__speed.errN, first: window.__speed.errs.slice(0, 6) })");
    out.wallS = (Date.now() - tNav) / 1000;
  } catch (e) {
    out.error = String(e.message || e);
    try { out.errors = await P.ev("({ n: window.__speed.errN, first: window.__speed.errs.slice(0, 6) })", 5000); } catch (_) {}
  } finally { await P.close(); }
  return out;
}

/* ---------------- V8 profile → top self-time functions ---------------- */
function summarizeProfiles(prof) {
  const res = {};
  for (const k of Object.keys(prof)) {
    const p = prof[k]; if (!p) continue;
    const byId = new Map(), parent = new Map(); for (const n of p.nodes) byId.set(n.id, n);
    for (const n of p.nodes) for (const c of n.children || []) parent.set(c, n.id);
    const fileOf = (cf) => (cf.url || "").replace(/^https?:\/\/[^/]+\//, "").replace(/\?.*$/, "") || "(native)";
    const keyOf = (cf) => `${fileOf(cf)}:${cf.functionName || "(anon)"}:${cf.lineNumber + 1}`;
    const self = new Map(), inclF = new Map(), inclFile = new Map();
    const dts = p.timeDeltas || [];
    for (let i = 0; i < p.samples.length; i++) {
      const n = byId.get(p.samples[i]); const dt = (dts[i + 1] != null ? dts[i + 1] : dts[i] || 0) / 1000;
      if (n.callFrame.functionName === "(idle)") continue;
      const key = keyOf(n.callFrame);
      self.set(key, (self.get(key) || 0) + dt);
      // inclusive: every function / file on the stack, once per sample
      const seenF = new Set(), seenFile = new Set();
      for (let id = n.id; id != null; id = parent.get(id)) {
        const cf = byId.get(id).callFrame; if (!cf.url) continue;
        const k = keyOf(cf), f = fileOf(cf);
        if (!seenF.has(k)) { seenF.add(k); inclF.set(k, (inclF.get(k) || 0) + dt); }
        if (!seenFile.has(f)) { seenFile.add(f); inclFile.set(f, (inclFile.get(f) || 0) + dt); }
      }
    }
    // inclusive-ish by file
    const byFile = new Map();
    for (const [key, ms] of self) { const f = key.split(":")[0]; byFile.set(f, (byFile.get(f) || 0) + ms); }
    const total = [...self.values()].reduce((a, b) => a + b, 0);
    res[k] = { totalMs: +total.toFixed(1),
      topFunctions: [...self].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([f, ms]) => [f, +ms.toFixed(1)]),
      topFiles: [...byFile].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([f, ms]) => [f, +ms.toFixed(1)]),
      inclusiveFunctions: [...inclF].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([f, ms]) => [f, +ms.toFixed(1)]),
      inclusiveFiles: [...inclFile].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([f, ms]) => [f, +ms.toFixed(1)]) };
  }
  return res;
}

/* ---------------- metrics: flatten, aggregate runs, compare ---------------- */
const fmt = (v, d = 1) => (v == null || !isFinite(v) ? "-" : (+v).toFixed(d));
function flatten(r) {
  // metric name → { v, noise (within-run), unit, lowerBetter }
  const M = {};
  const put = (k, v, noise = 0, unit = "ms") => { if (v != null && isFinite(v)) M[k] = { v: +(+v).toFixed(3), noise: +(+noise).toFixed(3), unit }; };
  const m = r.mode;
  if (r.calib) put(`${m}.calib`, r.calib, 0, "calib");
  if (r.loadMs != null) {
    put(`${m}.load.total`, r.loadMs);
    if (r.scripts) { put(`${m}.load.title`, r.scripts.titleReadyAt); put(`${m}.load.scriptEval`, r.scripts.evalMs);
      put(`${m}.load.prisonAtParse`, r.scripts.prisonEvalMs); put(`${m}.load.loadHandlers`, r.scripts.loadHandlersMs);
      if (r.scripts.loadEventAt) put(`${m}.load.loadEventAt`, r.scripts.loadEventAt); }
    if (r.buildMs != null) put(`${m}.load.build`, r.buildMs);
    if (r.firstFrameMs != null) put(`${m}.load.firstFrame`, r.firstFrameMs);
    if (r.firstFrameCompileMs != null) put(`${m}.load.firstFrameCompile`, r.firstFrameCompileMs + (r.settleCompileMs || 0));
    if (r.buildCompileMs != null) put(`${m}.load.buildCompile`, r.buildCompileMs);
    if (r.warmMs != null) put(`${m}.load.warmFrames`, r.warmMs);
    if (r.entryToFirstDraw != null) put(`${m}.load.entryToFirstDraw`, r.entryToFirstDraw);
    if (r.programs != null) put(`${m}.load.programs`, r.programs, 0, "n");
    if (r.phases && PAGE_MODES[m].kind === "cbz") for (const [k, v] of r.phases) put(`${m}.build.${k}`, v);
    if (r.builders) for (const [k, v] of r.builders) put(`${m}.builder.${k}`, v);
  }
  if (r.play) for (const [s, o] of Object.entries(r.play.spots)) {
    const nz = (x) => (x ? 1.253 * 1.4826 * x.mad / Math.sqrt(x.n) : 0);   // std. error of a median
    if (o.cpu) put(`${m}.play.${s}.frameCpu`, o.cpu.med, nz(o.cpu));
    if (o.fin) put(`${m}.play.${s}.gpuWait`, o.fin.med, nz(o.fin));
    if (o.cpu && o.fin) put(`${m}.play.${s}.frame`, o.cpu.med + o.fin.med, Math.hypot(nz(o.cpu), nz(o.fin)));
    if (o.cpu) put(`${m}.play.${s}.frameP95`, o.cpu.p95 + (o.fin ? o.fin.p95 : 0), 2 * nz(o.cpu));
    if (o.sim) put(`${m}.play.${s}.sim`, o.sim.med, nz(o.sim));
    if (o.alw) put(`${m}.play.${s}.always`, o.alw.med, nz(o.alw));
    if (o.render) put(`${m}.play.${s}.render`, o.render.med, nz(o.render));
    if (o.calls) put(`${m}.play.${s}.calls`, o.calls.med, o.calls.mad, "n");
    if (o.tris) put(`${m}.play.${s}.tris`, o.tris.med, o.tris.mad, "n");
    if (o.draws) put(`${m}.play.${s}.glDraws`, o.draws.med, o.draws.mad, "n");
    if (o.meanFrame != null) put(`${m}.play.${s}.meanFrame`, o.meanFrame, o.cpu ? 1.4826 * o.cpu.mad / Math.sqrt(o.cpu.n) + (o.hitchMs || 0) / o.cpu.n : 0);
    if (o.hitchMs != null) put(`${m}.play.${s}.hitchMs`, o.hitchMs, Math.max(20, 0.5 * o.hitchMs));
    if (o.rOther && o.rOther.med) put(`${m}.play.${s}.renderOther`, o.rOther.med, nz(o.rOther));
    // per updater: MEAN ms/frame (periodic and bursty work counts), noise from its spread
    if (o.updaters) for (const [k, med, p95, mean] of o.updaters.slice(0, 25)) put(`${m}.play.${s}.upd.${k}`, mean, Math.max(0.05, (p95 - med) / Math.sqrt(o.cpu ? o.cpu.n : 60)));
  }
  return M;
}
function aggregate(runs) {
  // runs: [{metrics}] → metric → { v: median of runs, noise: max(within, across) }
  const keys = new Set(); runs.forEach((r) => Object.keys(r).forEach((k) => keys.add(k)));
  const A = {};
  for (const k of keys) {
    const xs = runs.map((r) => r[k]).filter(Boolean);
    const vs = xs.map((x) => x.v).sort((a, b) => a - b);
    const med = vs[vs.length >> 1];
    const within = Math.max(...xs.map((x) => x.noise || 0));
    const across = vs.length > 1 ? (vs[vs.length - 1] - vs[0]) / 2 : 0;
    A[k] = { v: +med.toFixed(3), noise: +Math.max(within, across).toFixed(3), n: vs.length, unit: xs[0].unit, runs: vs.map((v) => +v.toFixed(2)) };
  }
  return A;
}
const LOOK_KEYS = ["pixelRatio", "bufferMP", "tier", "shadowMap", "shadows", "fogFar"];
function compare(cur, base) {
  const rows = []; let regress = 0, lookBad = [];
  const factors = {};
  for (const k of Object.keys(cur.metrics)) {
    if (/\.calib$/.test(k) && base.metrics[k] && !NO_NORM) factors[k.split(".")[0]] = base.metrics[k].v / cur.metrics[k].v;
  }
  for (const k of Object.keys(cur.metrics)) {
    let a = base.metrics[k], b = cur.metrics[k]; if (!a || !b || b.unit === "calib") continue;
    const f = factors[k.split(".")[0]];
    // machine-speed normalisation: CPU ms only (GPU wait and counts are not CPU)
    if (f && b.unit === "ms" && !/gpuWait/.test(k)) b = { ...b, v: b.v * f, noise: b.noise * f };
    if (/\.upd\.|\.builder\.|\.build\./.test(k) && Math.max(a.v, b.v) < 3) continue;
    const d = b.v - a.v;
    const noise = Math.hypot(a.noise || 0, b.noise || 0);
    if (/\.build\.lm:/.test(k)) continue;              // same number as .builder.<file>
    const sub = /\.upd\.|\.builder\.|\.build\./.test(k); // sub-items: single-sample jitter, wider floor
    const floor = b.unit === "n" ? Math.max(1, 0.02 * a.v) : sub ? Math.max(15, 0.15 * a.v) : Math.max(0.5, 0.05 * a.v);
    const thr = Math.max(3 * noise, floor);
    if (Math.abs(d) <= thr) continue;
    const verdict = d > 0 ? "SLOWER" : "faster";
    if (d > 0 && !/\.upd\.|\.builder\.|\.build\./.test(k)) regress++;
    rows.push([k, a.v, b.v, d, thr, verdict, b.unit]);
  }
  // LOOK GUARD
  for (const m of Object.keys(cur.look || {})) {
    const L1 = cur.look[m], L0 = base.look && base.look[m]; if (!L0 || !L1) continue;
    for (const f of LOOK_KEYS) {
      const x0 = L0[f], x1 = L1[f]; if (x0 == null || x1 == null) continue;
      if ((typeof x0 === "boolean" && x0 && !x1) || (typeof x0 === "number" && x1 < x0 - 1e-6)) lookBad.push(`${m}.${f}: ${x0} → ${x1}`);
    }
    const c0 = base.census && base.census[m], c1 = cur.census && cur.census[m];
    if (c0 && c1) {
      if (c1.veg && c0.veg && c1.veg.instances < c0.veg.instances * 0.9) lookBad.push(`${m}.trees(instances): ${c0.veg.instances} → ${c1.veg.instances}`);
      if (c1.visibleInstances < c0.visibleInstances * 0.9) lookBad.push(`${m}.visibleInstances: ${c0.visibleInstances} → ${c1.visibleInstances}`);
      if (c1.textures && c0.textures && c1.textures.megapixels < c0.textures.megapixels * 0.9) lookBad.push(`${m}.textureMP: ${c0.textures.megapixels} → ${c1.textures.megapixels}`);
    }
  }
  return { rows, regress, lookBad, factors };
}

/* ---------------- printing ---------------- */
function table(res) {
  const L = [];
  const p = (s) => L.push(s);
  p("");
  p(`SPEED  ${res.commit || res.url}  seed ${res.seed}  gpu ${res.gpu}  ${res.device} ${res.viewport}  runs ${res.runs}  load avg ${res.uptimeStart.load1}→${res.uptimeEnd.load1} (${res.uptimeStart.cpus} cpu)  tool ${res.toolWallS}s`);
  for (const m of res.modes) {
    const r = res.detail[m] && res.detail[m][0]; if (!r) continue;
    const M = res.metrics, g = (k) => M[`${m}.${k}`];
    const pm = (k, label, u = "ms") => { const x = g(k); if (x) p(`  ${label.padEnd(30)} ${fmt(x.v, u === "n" ? 0 : 1).padStart(10)} ${u === "n" ? "  " : "ms"} ±${fmt(x.noise, u === "n" ? 0 : 1)}`); };
    p("");
    p(`== ${m.toUpperCase()} ${r.ok ? "" : "FAILED: " + r.error}`);
    if (r.look) p(`  look: tier ${r.look.tier} pr ${r.look.pixelRatio} buffer ${r.look.drawingBuffer} (${r.look.css}@${r.look.devicePixelRatio}x) shadows ${r.look.shadows ? r.look.shadowMap : "off"} fog ${r.look.fogFar}  gpu ${String(r.look.gpu || "").slice(0, 50)}`);
    pm("load.total", "LOAD nav→playable");
    pm("load.title", "  title ready (nav → last script)");
    pm("load.scriptEval", "    script eval (all tags)");
    pm("load.prisonAtParse", `    of which prison built at parse (${r.scripts ? r.scripts.prisonFiles : "?"} files)`);
    pm("load.loadHandlers", "    window load handlers (prison batch)");
    pm("load.loadEventAt", "    (window load event fired at)");
    pm("load.build", "  build (startRun, one task)");
    pm("load.buildCompile", "    of which shader compile (in build)");
    pm("load.firstFrame", "  first frame");
    pm("load.firstFrameCompile", "  shader compile blocking (first+settle)");
    pm("load.warmFrames", "  settle (frames 2..steady)");
    pm("load.entryToFirstDraw", "  entry → first draw");
    pm("load.programs", "  programs compiled", "n");
    if (r.firstFrames && r.firstFrames.length && r.firstFrames[0].top != null) p("  settle frames: " + r.firstFrames.slice(0, 12).map((f) => `${fmt(f.cpu + f.fin, 0)}${f.newPrograms ? "/" + f.newPrograms + "p" : ""}`).join(" ") + `  (${r.settleFrames} to steady; worst: ${r.firstFrames.slice().sort((a, b) => b.cpu - a.cpu)[0].top})`);
    if (r.firstPcause && Object.keys(r.firstPcause).length) p("  first-frame programs, why: " + Object.entries(r.firstPcause).sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k, v]) => `${v}x ${k}`).join("  ||  "));
    if (r.phases && PAGE_MODES[m].kind === "cbz") {
      const top = r.phases.slice().sort((a, b) => b[1] - a[1]).slice(0, 8);
      p("  build checkpoints (ms from key to next): " + top.map(([k, v]) => `${k} ${fmt(v, 0)}`).join(" · "));
    }
    if (r.builders && r.builders.length) p("  landmass builders: " + r.builders.slice(0, 8).map(([k, v]) => `${k} ${fmt(v, 0)}`).join(" · "));
    if (r.scripts && r.scripts.top) p("  slowest scripts (eval): " + r.scripts.top.slice(0, 6).map(([k, v]) => `${k.split("/").pop()} ${fmt(v, 0)}`).join(" · "));
    if (r.census) p(`  scene: ${r.census.meshes} meshes (${r.census.visibleMeshes} visible), ${r.census.instances} instances, ${(r.census.sceneTris / 1e6).toFixed(2)}M visible tris; VEGETATION ${r.census.veg.instancedMeshes} inst-meshes + ${r.census.veg.meshes} meshes, ${r.census.veg.instances} instances (${r.census.veg.visibleInstances} visible), ${(r.census.veg.tris / 1e6).toFixed(2)}M tris${r.census.veg.registeredTrees != null ? ", treeAudit " + r.census.veg.registeredTrees + " trees" : ""}`);
    if (r.play) for (const s of Object.keys(r.play.spots)) {
      const o = r.play.spots[s];
      p(`  PLAY ${s.padEnd(9)} mean ${fmt(o.meanFrame)}  median frame ${fmt(g(`play.${s}.frame`) && g(`play.${s}.frame`).v)} ms ±${fmt(g(`play.${s}.frame`) && g(`play.${s}.frame`).noise, 2)} (p95 ${fmt(g(`play.${s}.frameP95`) && g(`play.${s}.frameP95`).v)})  sim ${fmt(o.sim && o.sim.med)}  always ${fmt(o.alw && o.alw.med)}  render ${fmt(o.render && o.render.med)}  gpuWait ${fmt(o.fin && o.fin.med)}  calls ${o.calls ? o.calls.med : "-"}  tris ${o.tris ? (o.tris.med / 1e6).toFixed(2) + "M" : "-"}${o.emptyFrames ? "  EMPTY " + o.emptyFrames : ""}`);
      if (o.updaters && o.updaters.length) p("     top updaters (mean/median ms): " + o.updaters.slice(0, 8).map((u) => `${u[0].replace(/^([ua])@/, "$1").replace(/^([ua][0-9.]+) src\//, "$1 ")} ${fmt(u[3], 1)}/${fmt(u[1], 1)}`).join(" · "));
      if (o.hitches && o.hitches.length) p("     hitches [frame, ms, worst, its ms, new programs]: " + o.hitches.slice(0, 5).map((h) => JSON.stringify(h)).join(" "));
      if (o.lights) p(`     lights visible: point ${o.lights.point}/${o.lights.pointAll} spot ${o.lights.spot}/${o.lights.spotAll} dir ${o.lights.dir} hemi ${o.lights.hemi} amb ${o.lights.amb}`);
      if (o.pcause && Object.keys(o.pcause).length) p("     new programs, why: " + Object.entries(o.pcause).sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, v]) => `${v}x ${k}`).join("  ||  "));
      if (o.attribute) {
        const A = o.attribute, b = (A.base.frame + A.base2.frame) / 2;
        const gb = (A.base.fin + A.base2.fin) / 2;
        const sh = (x) => x ? `${fmt(x.frame, 1)}ms (${fmt(100 * (b - x.frame) / b, 0)}%, gpu ${fmt(100 * (gb - x.fin) / gb, 0)}%)` : "-";
        p(`     ATTRIBUTE (diagnostic, % saved of frame / of GPU wait): base ${fmt(b)}ms gpu ${fmt(gb)}ms · no shadows ${sh(A.noShadows)} · pr/2 ${sh(A.halfPR)} · full DPR ${sh(A.fullDPR)} · tier-1 ${sh(A.tierDown)} · tier+1 ${sh(A.tierUp)} · no vegetation ${sh(A.noVegetation)} [calls ${A.base.calls}→${A.noVegetation.calls}, tris ${A.base.tris}→${A.noVegetation.tris}]`);
      }
    }
    if (r.errors && r.errors.n) p(`  console errors: ${r.errors.n}  ${(r.errors.first || []).slice(0, 2).join(" | ").slice(0, 200)}`);
    if (r.profile) for (const [k, pr] of Object.entries(r.profile)) {
      p(`  V8 PROFILE ${k} (${pr.totalMs} ms sampled) top self-time:`);
      for (const [f, ms] of pr.topFunctions.slice(0, 15)) p(`     ${fmt(ms, 0).padStart(7)} ms  ${f}`);
      p(`    inclusive by file (on the stack): ` + pr.inclusiveFiles.filter(([f]) => !/three\.r128|^\(/.test(f)).slice(0, 12).map(([f, ms]) => `${f.replace(/^src\//, "")} ${fmt(ms, 0)}`).join(" · "));
    }
  }
  return L.join("\n");
}

/* ---------------- main ---------------- */
let server = null, B = null;
const cleanup = () => { try { B && B.close(); } catch (_) {} try { server && server.close(); } catch (_) {} if (tmpRefDir) try { fs.rmSync(tmpRefDir, { recursive: true, force: true }); } catch (_) {} releaseLock(); };
process.on("SIGINT", () => { cleanup(); process.exit(130); });
process.on("SIGTERM", () => { cleanup(); process.exit(143); });

await takeLock();
const uptimeStart = uptime();
let exitCode = 0;
try {
  let base = URL_ARG;
  if (!base) { server = await startServer(ROOT); base = `http://127.0.0.1:${server.address().port}/`; }
  B = await launchChrome();
  log(`[speed ${since()}] chrome up (${GPU} gpu), serving ${URL_ARG || ROOT}  load ${uptimeStart.load1}`);
  const detail = {}, perRun = [];
  for (let run = 0; run < RUNS; run++) {
    const M = {};
    for (const m of MODES) {
      const t = Date.now();
      const kind = PAGE_MODES[m].kind;
      const withPlay = DO_PLAY && (m === "city" || MODES.length > 1 || has("--play"));
      const r = kind === "cbz" ? await runCbz(B, base, m, withPlay) : await runPage(B, base, m, withPlay);
      (detail[m] = detail[m] || []).push(r);
      Object.assign(M, flatten(r));
      log(`[speed ${since()}] run ${run + 1}/${RUNS} ${m}: ${r.ok ? `load ${fmt(r.loadMs, 0)} ms${r.buildMs != null ? ` (build ${fmt(r.buildMs, 0)}, first frame ${fmt(r.firstFrameMs, 0)})` : ""}` : "FAILED " + r.error}  [${((Date.now() - t) / 1000).toFixed(1)}s]`);
      if (!r.ok) exitCode = 1;
    }
    perRun.push(M);
  }
  const metrics = aggregate(perRun);
  const res = {
    tool: "speed.mjs", version: 1, at: new Date().toISOString(), commit, url: URL_ARG || null, seed: SEED, gpu: GPU, device: DEVICE,
    viewport: `${VIEW.w}x${VIEW.h}@${VIEW.dpr}`, runs: RUNS, frames: FRAMES, warm: WARM, modes: MODES, host: os.hostname(), cpu: os.cpus()[0].model,
    uptimeStart, uptimeEnd: uptime(), toolWallS: +((Date.now() - TOOL_T0) / 1000).toFixed(1),
    look: Object.fromEntries(MODES.map((m) => [m, detail[m] && detail[m][0] && detail[m][0].look]).filter((x) => x[1])),
    census: Object.fromEntries(MODES.map((m) => [m, detail[m] && detail[m][0] && detail[m][0].census]).filter((x) => x[1])),
    metrics, detail,
  };
  const text = table(res);
  process.stdout.write(text + "\n");
  if (AGAINST) {
    const base0 = JSON.parse(fs.readFileSync(AGAINST, "utf8"));
    const c = compare(res, base0);
    process.stdout.write(`\nCOMPARE vs ${AGAINST} (${base0.commit || base0.url}, load avg ${base0.uptimeStart && base0.uptimeStart.load1}); CPU ms normalised by machine speed x${Object.entries(c.factors).map(([m, f]) => m + " " + f.toFixed(3)).join(", ") || " (none: --no-norm or no calib)"}:\n`);
    if (!c.rows.length) process.stdout.write("  no change beyond noise\n");
    for (const [k, a, b, d, thr, v, u] of c.rows.sort((x, y) => Math.abs(y[3]) / (y[1] || 1) - Math.abs(x[3]) / (x[1] || 1)).slice(0, 40))
      process.stdout.write(`  ${v.padEnd(7)} ${k.padEnd(58)} ${fmt(a, u === "n" ? 0 : 1).padStart(9)} → ${fmt(b, u === "n" ? 0 : 1).padStart(9)}  (${d > 0 ? "+" : ""}${fmt(d, 1)}, ${fmt(100 * d / (a || 1), 0)}%, thr ${fmt(thr, 1)})\n`);
    if (c.lookBad.length) process.stdout.write("  LOOK REGRESSION (any speedup here is NOT a win):\n" + c.lookBad.map((s) => "    " + s).join("\n") + "\n");
    res.compare = { against: AGAINST, rows: c.rows, lookRegression: c.lookBad };
    if (c.regress || c.lookBad.length) exitCode = exitCode || 4;
  }
  const json = JSON.stringify(res, null, 1);
  if (SAVE) {
    // the committed baseline keeps metrics + look + census + run 1's detail (no per-frame series)
    const slim = { ...res, detail: Object.fromEntries(Object.entries(res.detail).map(([m, rs]) => {
      const r = JSON.parse(JSON.stringify(rs[0] || {}));
      if (r.play) for (const o of Object.values(r.play.spots)) { delete o.series; if (o.updaters) o.updaters = o.updaters.slice(0, 20); }
      if (r.scripts) r.scripts.byDir = undefined;
      return [m, [r]]; })) };
    fs.writeFileSync(SAVE, JSON.stringify(slim, null, 1)); log(`[speed] saved ${SAVE}`);
  }
  if (JSON_OUT) { fs.writeFileSync(JSON_OUT, json); log(`[speed] wrote ${JSON_OUT}`); }
  if (!SAVE && !JSON_OUT) { const f = path.join(os.tmpdir(), `cbz-speed-${Date.now()}.json`); fs.writeFileSync(f, json); log(`[speed] full JSON: ${f}`); }
  log(`[speed] done in ${((Date.now() - TOOL_T0) / 1000).toFixed(1)}s`);
} catch (e) {
  console.error("[speed] FAILED:", e.stack || e);
  exitCode = 1;
} finally {
  cleanup();
}
process.exit(exitCode);
