#!/usr/bin/env node
/* ============================================================
   tools/memscope.mjs — WHERE THE MEMORY AND THE BOOT TIME GO, by owner.

   speed.mjs says HOW MUCH (heap MB, GPU MB, load ms). memscope says WHO:
   which builder, which CBZ.<key>, which scene node holds it, what is still
   on the GPU while hidden or 600 m away, which typed arrays are kept in JS
   after upload, which buffers were uploaded twice, what grows when the
   player moves, and what the build spent its time on.

     node tools/memscope.mjs                          # slice gangcity-downtown, phone profile
     node tools/memscope.mjs --slice kingsport-downtown
     node tools/memscope.mjs --full                   # the whole city (slow: big snapshots)
     node tools/memscope.mjs --query stream=1         # extra url params (streaming on)
     node tools/memscope.mjs --device desktop         # MacBook profile instead of the phone
     node tools/memscope.mjs --no-leak                # skip the move-and-return leak pass
     node tools/memscope.mjs --no-heap                # skip heap snapshots (GPU + boot only, ~20 s)
     node tools/memscope.mjs --tour 6 --tour-frames 40 --far 600
     node tools/memscope.mjs --url http://127.0.0.1:8000/   # another server / worktree
     node tools/memscope.mjs --root <dir>             # serve another tree
     node tools/memscope.mjs --json out.json          # default ~/harness/out/gta6/memscope-<label>.json
     node tools/memscope.mjs --top 20 --no-lock

   WHAT IT PRINTS (and writes in full to the JSON):
   A. JS HEAP BY OWNER. A V8 heap snapshot (CDP HeapProfiler.takeHeapSnapshot,
      streamed and parsed here, never held as one string), its DOMINATOR TREE
      (Cooper-Harvey-Kennedy, the same iterative algorithm Chrome DevTools and
      memlab use) and every node's RETAINED size = what would be freed if that
      node went away. Owners are named in-page before the snapshot:
        own:<builder>     every Object3D a landmass builder added (the add()
                          is intercepted; a builder is whoever was running)
        own:step:<key>    added during startRun between builders (bootStep key)
        own:script:<file> added while a <script> was evaluating (parse-time builds)
        own:runtime       added after the build (streaming, spawns, effects)
        CBZ.<key>         every object/array hanging off CBZ
      Plus the class histogram (self size by constructor, incl. ArrayBuffer
      backing stores) and the biggest dominators NOBODY above owns, each with
      its shortest retainer path from Window (module closures, caches).
      Plus a SAMPLING HEAP PROFILE of script eval + build (HeapProfiler.
      startSampling: live objects at stop, by allocating stack): bytes by
      builder and by allocation site file:function:line. (Backing stores of
      typed arrays are not sampled by V8; the snapshot and B cover those.)
   B. GPU BY OWNER. A scene walk that sums, per owner, the bytes of every
      geometry attribute, index, instance buffer and texture, deduplicated by
      object, and knows which ones are REALLY on the GPU: the preload wraps
      bufferData/texImage2D/texStorage/renderbufferStorage and records every
      ArrayBuffer and image source that was uploaded plus the bytes of every
      live GL object (the GL total is the truth; "unattributed" = GL total minus
      the walk = render targets, shadow maps, drawing buffer, orphans). Flags:
        cpuHeld   typed arrays still in JS after upload (static usage: free
                  them unless raycasts/collision read them; dynamic: needed)
        hidden    uploaded but invisible (itself or an ancestor)
        far       uploaded, visible, and > --far m from the player (streaming bait)
        notUp     built but never uploaded (JS-only cost, still heap)
        dupes     identical attribute arrays uploaded as separate buffers
      And texture sources the page keeps alive (canvas/img: w*h*4 each).
   C. LEAKS WHILE MOVING (memlab's three-snapshot idea, two snapshots here):
      snapshot A at spawn, teleport the player around --tour stops (a ring
      in a slice, slice centres in --full), stepping --tour-frames real loop
      frames at each, back to spawn, settle, snapshot B. Objects in B whose
      heap id did not exist in A are what the trip left behind; grouped by
      class x owner (nearest named dominator), each cluster with a retainer
      path (what keeps it alive). GPU walk and GL totals are diffed too.
   D. BOOT BY BUILDER: script eval ms, startRun ms, every landmass builder and
      bootStep phase, first frames; a CPU profile of startRun reduced to the
      top SELF functions and self time per file (tools/cpuprofile-top.mjs's
      arithmetic).

   WHY THESE (research 2026-09-29): memlab (facebook/memlab) finds leaks by
   diffing heap snapshots across an action and clustering retainer traces;
   DevTools' "Retained size" is the dominator tree; CDP's sampling heap
   profiler gives allocation stacks for live objects at ~zero cost; three.js'
   renderer.info.memory only COUNTS geometries/textures (no bytes), so bytes
   come from the GL calls; iOS Safari kills a tab on heap + GPU + decoded
   images + canvas backing stores together, which is why B counts sources.
   performance.measureUserAgentSpecificMemory needs cross-origin isolation
   (COOP/COEP) that this page does not have, so it is not used.

   HONEST LIMITS: owners are "who called add()"; a geometry shared by two
   builders is retained by neither alone and shows in the shared/unowned
   rows. The heap snapshot forces a full GC. The in-page bookkeeping (a
   WeakMap + WeakRefs per added Object3D) costs a few MB, reported as
   "memscope overhead" in the class table (WeakRef). The drawing buffer is
   estimated. Everything is injected by a preload: no game file is edited.

   COST (measured 2026-09-29, slice gangcity-downtown, phone, box at load
   120): boot + build + GPU walk + boot table ~30 s (--no-heap). The heap
   snapshot of that slice is 4.7-6.7M objects: ~10 s to build in Chrome, the
   renderer peaks near 1.5 GB RSS while it does, and the dominator analysis
   is now seconds-to-a-minute (the "affected" worklist; the first version
   took 8 min). Each snapshot is a real memory spike on the Mac: use
   --no-heap when the question is GPU / boot only, --no-leak for one snapshot.

   Honors /tmp/cbz-speed.lock like speed.mjs (--no-lock skips).
============================================================ */
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import v8 from "node:v8";
import { fileURLToPath } from "node:url";

const T0 = Date.now();
if (process.argv.includes("--help") || process.argv.includes("-h")) { const src = fs.readFileSync(fileURLToPath(import.meta.url), "utf8"); console.log(src.slice(src.indexOf("/*"), src.indexOf("*/") + 2)); process.exit(0); }
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const ROOT0 = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (s) => process.stderr.write(`[memscope ${((Date.now() - T0) / 1000).toFixed(1)}s] ${s}\n`);
const MB = (b) => (b / 1048576);
const f1 = (v) => (v == null || !isFinite(v) ? "-" : v.toFixed(1));
const pad = (s, n) => String(s).padEnd(n).slice(0, n);
const lpad = (s, n) => String(s).padStart(n);

const FULL = has("--full");
const SLICE = FULL ? "" : opt("--slice", "gangcity-downtown");
const DEVICE = opt("--device", "phone");
const SEED = opt("--seed", "90210");
const QUERY = opt("--query", "");
const TOP = +opt("--top", 20);
const FAR = +opt("--far", 600);
const TOUR_N = +opt("--tour", FULL ? 4 : 6);
const TOUR_FRAMES = +opt("--tour-frames", 40);
const SETTLE = +opt("--settle", 30);
const DO_HEAP = !has("--no-heap");
const DO_LEAK = DO_HEAP && !has("--no-leak");
const LABEL = (FULL ? "city" : SLICE.replace(/[^a-z0-9-]/gi, "_")) + "-" + DEVICE;
const HOUT = path.join(os.homedir(), "harness/out/gta6");
const JSON_OUT = opt("--json", path.join(fs.existsSync(HOUT) ? HOUT : os.tmpdir(), `memscope-${LABEL}.json`));
const VIEW = DEVICE === "tablet" ? { w: 1180, h: 820, dpr: 2 } : DEVICE === "phone" ? { w: 390, h: 844, dpr: 3 } : { w: 1512, h: 982, dpr: 2 };
const PHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const CHROME = process.env.CBZ_CHROME || (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/opt/pw-browsers/chromium");

/* ---------------- lock (same file + staleness rule as speed.mjs) ---------------- */
const LOCK = "/tmp/cbz-speed.lock";
let haveLock = false;
const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
async function takeLock() {
  let told = false;
  for (;;) {
    try { fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, started: Date.now(), cmd: "memscope.mjs " + argv.join(" ") }), { flag: "wx" }); haveLock = true; return; }
    catch (e) {
      if (e.code !== "EEXIST") throw e;
      let cur = {}; try { cur = JSON.parse(fs.readFileSync(LOCK, "utf8")); } catch (_) {}
      const born = +cur.started || (() => { try { return fs.statSync(LOCK).mtimeMs; } catch (_) { return 0; } })();
      if ((cur.pid && !pidAlive(+cur.pid)) || Date.now() - born > 30 * 60 * 1000) { try { fs.unlinkSync(LOCK); } catch (_) {} continue; }
      if (!told) { log(`waiting for ${LOCK} (pid ${cur.pid}: ${cur.cmd || "?"})`); told = true; }
      await sleep(500);
    }
  }
}
function releaseLock() { if (!haveLock) return; try { const c = JSON.parse(fs.readFileSync(LOCK, "utf8")); if (c.pid === process.pid) fs.unlinkSync(LOCK); } catch (_) {} haveLock = false; }

/* ---------------- static server + chrome (speed.mjs's recipe: real GPU, fresh profile) ---------------- */
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".wasm": "application/wasm",
  ".glb": "model/gltf-binary", ".bin": "application/octet-stream", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".woff2": "font/woff2", ".ttf": "font/ttf" };
function startServer(root) {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
    const f = path.join(root, path.normalize(p).replace(/^(\.\.[/\\])+/, ""));
    if (!f.startsWith(root)) { res.writeHead(403); return res.end(); }
    fs.readFile(f, (err, buf) => { if (err) { res.writeHead(404, { "Content-Type": "text/html" }); return res.end("<!doctype html>"); }
      res.writeHead(200, { "Content-Type": MIME[path.extname(f).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-cache" }); res.end(buf); });
  });
  return new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv)));
}
let CH = null, SRV = null; const CHROME_ERR = [];
function cleanup() { try { CH && CH.close(); } catch (_) {} try { SRV && SRV.close(); } catch (_) {} releaseLock(); }
async function launchChrome() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "cbz-memscope-"));
  const proc = spawn(CHROME, ["--headless=new", "--no-sandbox", "--ignore-gpu-blocklist", "--enable-webgl", "--mute-audio",
    `--window-size=${VIEW.w},${VIEW.h}`, `--force-device-scale-factor=${VIEW.dpr}`,
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
    "--disable-background-networking", "--disable-component-update", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    "--enable-precise-memory-info", "--js-flags=--expose-gc --max-old-space-size=8192",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  const wsUrl = await new Promise((res, rej) => {
    let buf = ""; const to = setTimeout(() => rej(new Error("chrome never printed its DevTools endpoint")), 30000);
    proc.stderr.on("data", (d) => { CHROME_ERR.push(String(d)); if (CHROME_ERR.length > 200) CHROME_ERR.shift(); buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(to); res(m[1]); } });
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
  const send = (method, params = {}, sessionId, timeoutMs = 120000) => new Promise((res, rej) => {
    const mid = ++id; const t = setTimeout(() => { if (pend.delete(mid)) rej(new Error(`CDP timeout ${method}`)); }, timeoutMs);
    pend.set(mid, { res: (v) => { clearTimeout(t); res(v); }, rej: (e) => { clearTimeout(t); rej(e); } });
    ws.send(JSON.stringify({ id: mid, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  return { send, listeners, close() { try { ws.close(); } catch (_) {} try { proc.kill("SIGKILL"); } catch (_) {} try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {} } };
}

/* ---------------- the preload (runs before any game script) ---------------- */
const PRELOAD = String.raw`(function(){
if (window.top !== window || window.__ms) return;
var now = function(){ return performance.now(); };
var M = window.__ms = { owner: null, curStep: null, building: false, built: false, own: new WeakMap(), roots: {}, nRoots: 0,
  builders: [], steps: [], hold: false, q: [], t: 0, errs: [], upBuf: new WeakSet(), upSrc: new WeakSet(),
  gl: { buf: 0, tex: 0, rb: 0, nbuf: 0, ntex: 0, nrb: 0 }, gls: [], scriptEnd: 0 };
addEventListener("error", function(e){ if (M.errs.length < 10) M.errs.push(String(e.message || e.type) + (e.filename ? " @" + String(e.filename).split("/").pop() + ":" + e.lineno : "")); }, true);
/* rAF hold: frames are stepped by hand with a synthetic 1/60 clock (speed.mjs's model) */
var rAF = window.requestAnimationFrame.bind(window);
window.requestAnimationFrame = function(cb){ if (M.hold) { M.q.push(cb); return 1e7 + M.q.length; }
  return rAF(function(t){ if (M.hold) { M.q.push(cb); return; } cb(t); }); };
M.step = function(n, each){ var C = window.CBZ;
  for (var i = 0; i < n; i++) { if (each) each(i); M.t += 1000 / 60;
    if (!M.q.length && !M.kicked && C && C.startLoop) { M.kicked = 1; try { C.startLoop(); } catch (e) { M.errs.push("[startLoop] " + (e && e.message)); } }
    var cbs = M.q; M.q = []; for (var j = 0; j < cbs.length; j++) { try { cbs[j](M.t); } catch (e) { if (M.errs.length < 10) M.errs.push("[step] " + (e && e.message)); } } } };
/* who is adding right now */
function cur(){ if (M.owner) return M.owner; if (M.building) return "step:" + (M.curStep || "startRun"); if (M.built) return "runtime";
  var cs = document.currentScript; return "script:" + (cs && cs.src ? cs.src.replace(/^.*?\/(src|games)\//, "").replace(/\?.*$/, "") : "inline"); }
/* the game file that called add() (runtime/step adds only: a stack per subtree root) */
function srcFile(){ var L = String((new Error()).stack || "").split("\n");
  for (var i = 2; i < L.length; i++) { var m = L[i].match(/\/(?:src|games)\/([^:?)]+\.js)/); if (m && !/^(vendor\/|config\.js|core\/loop\.js|bootstrap\.js)/.test(m[1])) return m[1]; } return ""; }
function hookThree(){ var T = window.THREE; if (M.hooked || !T || !T.Object3D || !T.Object3D.prototype.add) return; M.hooked = 1;
  var add = T.Object3D.prototype.add;
  T.Object3D.prototype.add = function(){ var r = add.apply(this, arguments);
    try { var o = cur(), po = M.own.get(this);
      for (var i = 0; i < arguments.length; i++) { var c = arguments[i]; if (!c || !c.isObject3D || M.own.has(c)) continue;
        var oo = o; if (po !== o && (o === "runtime" || o.indexOf("step:") === 0)) { var sf = srcFile(); if (sf) oo = o + " @" + sf; } else if (po && po.indexOf(o + " @") === 0) oo = po;
        M.own.set(c, oo); if (po !== oo) { (M.roots[oo] || (M.roots[oo] = [])).push(new WeakRef(c)); M.nRoots++; } } } catch (_) {}
    return r; }; }
document.addEventListener("load", function(e){ var t = e.target; if (t && t.tagName === "SCRIPT") { hookThree(); M.scriptEnd = now(); } }, true);
/* GL: bytes per live GL object + which ArrayBuffers / image sources were uploaded */
var OBJ = new WeakMap();
function setB(o, kind, key, bytes){ if (!o) return; var r = OBJ.get(o); if (!r) { r = { k: kind, total: 0, parts: {} }; OBJ.set(o, r); M.gl["n" + kind]++; }
  var old = r.parts[key] || 0; r.parts[key] = bytes; r.total += bytes - old; M.gl[kind] += bytes - old; }
function freeB(o){ var r = o && OBJ.get(o); if (!r) return; M.gl[r.k] -= r.total; M.gl["n" + r.k]--; OBJ.delete(o); }
var SZ = { 32856: 4, 32849: 4, 34842: 8, 34836: 16, 33321: 1, 33323: 2, 33325: 2, 33326: 4, 33327: 4, 33328: 8, 33190: 4, 33189: 2, 35056: 4, 36012: 4, 35907: 4, 34843: 8, 34837: 16, 36168: 1, 32854: 2, 36194: 2, 35898: 4, 34041: 4 };
function bpp(ifmt, type){ if (SZ[ifmt]) return SZ[ifmt]; var ch = ifmt === 6409 || ifmt === 6406 ? 1 : ifmt === 6410 ? 2 : ifmt === 6402 ? 1 : 4;
  var b = type === 5126 ? 4 : (type === 5131 || type === 36193) ? 2 : (type === 5125 || type === 34042) ? 4 : (type === 5123) ? 2 : 1; return ch * b; }
function markSrc(s){ if (!s || typeof s !== "object") return; if (s.buffer instanceof ArrayBuffer) M.upBuf.add(s.buffer); else M.upSrc.add(s); }
function hookGL(P){ if (!P || P.__ms) return; P.__ms = 1;
  function W(n, f){ var o = P[n]; if (!o) return; P[n] = function(){ var r = o.apply(this, arguments); try { f.call(this, arguments); } catch (_) {} return r; }; }
  W("bindBuffer", function(a){ (this.__msBB || (this.__msBB = {}))[a[0]] = a[1]; });
  W("bufferData", function(a){ var b = this.__msBB && this.__msBB[a[0]]; var d = a[1], n = 0;
    if (typeof d === "number") n = d; else if (d) { var e = d.BYTES_PER_ELEMENT || 1; n = a[4] ? a[4] * e : d.byteLength - (a[3] || 0) * e; markSrc(d); }
    setB(b, "buf", "d", n); });
  W("bufferSubData", function(a){ markSrc(a[2]); });
  W("deleteBuffer", function(a){ freeB(a[0]); }); W("deleteTexture", function(a){ freeB(a[0]); }); W("deleteRenderbuffer", function(a){ freeB(a[0]); });
  W("activeTexture", function(a){ this.__msU = a[0]; });
  W("bindTexture", function(a){ var tb = this.__msTB || (this.__msTB = {}); var u = this.__msU || 33984; (tb[u] || (tb[u] = {}))[a[0]] = a[1]; });
  function bound(gl, target){ var bt = (target >= 34069 && target <= 34074) ? 34067 : target; var tb = gl.__msTB && gl.__msTB[gl.__msU || 33984]; return tb && tb[bt]; }
  W("texImage2D", function(a){ var t = bound(this, a[0]), w, h, src, type;
    if (a.length === 6) { src = a[5]; type = a[4]; w = src && (src.naturalWidth || src.videoWidth || src.displayWidth || src.width) || 0; h = src && (src.naturalHeight || src.videoHeight || src.displayHeight || src.height) || 0; }
    else { w = a[3]; h = a[4]; type = a[7]; src = a[8]; }
    markSrc(src); setB(t, "tex", a[0] + ":" + a[1], w * h * bpp(a[2], type)); });
  W("texSubImage2D", function(a){ markSrc(a[a.length - 1]); if (a.length > 7) markSrc(a[8]); });
  W("texImage3D", function(a){ var t = bound(this, a[0]); markSrc(a[9]); setB(t, "tex", a[0] + ":" + a[1], a[3] * a[4] * a[5] * bpp(a[2], a[8])); });
  W("texStorage2D", function(a){ var t = bound(this, a[0]); setB(t, "tex", "s", a[3] * a[4] * bpp(a[2], 0) * (a[1] > 1 ? 4 / 3 : 1) * (a[0] === 34067 ? 6 : 1)); });
  W("texStorage3D", function(a){ var t = bound(this, a[0]); setB(t, "tex", "s", a[3] * a[4] * a[5] * bpp(a[2], 0) * (a[1] > 1 ? 4 / 3 : 1)); });
  W("compressedTexImage2D", function(a){ var t = bound(this, a[0]); var d = a[6]; markSrc(d); setB(t, "tex", a[0] + ":" + a[1], d ? d.byteLength : 0); });
  W("generateMipmap", function(a){ var t = bound(this, a[0]); var r = t && OBJ.get(t); if (!r) return; var l0 = 0; for (var k in r.parts) if (/:0$|^s$/.test(k)) l0 += r.parts[k]; setB(t, "tex", "mip", l0 / 3); });
  W("bindRenderbuffer", function(a){ this.__msRB = a[1]; });
  W("renderbufferStorage", function(a){ setB(this.__msRB, "rb", "s", a[2] * a[3] * bpp(a[1], 0)); });
  W("renderbufferStorageMultisample", function(a){ setB(this.__msRB, "rb", "s", a[3] * a[4] * bpp(a[2], 0) * Math.max(1, a[1])); });
}
hookGL(window.WebGLRenderingContext && WebGLRenderingContext.prototype);
hookGL(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype);
var gc0 = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function(type){ var c = gc0.apply(this, arguments); if (c && /webgl/.test(type) && M.gls.indexOf(c) < 0) M.gls.push(c); return c; };
M.glRead = function(){ var o = { buf: M.gl.buf, tex: M.gl.tex, rb: M.gl.rb, nbuf: M.gl.nbuf, ntex: M.gl.ntex, nrb: M.gl.nrb, db: 0 };
  M.gls.forEach(function(g){ try { var at = g.getContextAttributes() || {}, px = g.drawingBufferWidth * g.drawingBufferHeight, s = at.antialias ? 4 : 1;
    o.db += px * (4 + (at.depth || at.stencil ? 4 : 0)) * s + (s > 1 ? px * 4 : 0); } catch (_) {} });
  o.total = o.buf + o.tex + o.rb + o.db; return o; };

/* ---- the build: name the builders (named wrappers show in CPU and heap profiles as ms_B_<name>) ---- */
M.arm = function(){ var C = window.CBZ; if (!C || M.armed) return; M.armed = 1;
  var bs = C.bootStep; C.bootStep = function(k){ M.curStep = k == null ? "?" : String(k); M.steps.push([M.curStep, now()]); if (bs) return bs.apply(this, arguments); };
  (C._landmassBuilders || []).forEach(function(b, i){ var f = b.fn; if (typeof f !== "function" || f.__ms) return;
    var name = String(b.bootKey || b.file || (f.name && f.name !== "fn" ? f.name : "") || ("builder@" + b.order)).replace(/^lm:/, "").replace(/^.*\//, "").replace(/\.js$/, "");
    var safe = name.replace(/[^A-Za-z0-9_$]/g, "_");
    var w = new Function("f", "M", "nm", "now", "return function ms_B_" + safe + "(){ var p = M.owner; M.owner = nm; var s = now(); try { return f.apply(this, arguments); } finally { M.builders.push([nm, now() - s]); M.owner = p; } }")(f, M, name, now);
    w.__ms = 1; b.fn = w; });
};
M.build = function(){ var C = window.CBZ; M.arm(); M.hold = true; M.t = now(); M.building = true; var t0 = now(), err = null;
  try { C.startRun(); } catch (e) { err = String(e && e.stack || e).slice(0, 400); }
  var t1 = now(); M.building = false; M.built = true;
  return { ms: t1 - t0, t0: t0, err: err, state: C.game && C.game.state, builders: M.builders, steps: M.steps.map(function(s){ return [s[0], s[1] - t0]; }) }; };

/* ---- named roots for the heap snapshot (removed right after it) ---- */
M.mkRoots = function(){ var H = {}, C = window.CBZ, n = 0;
  for (var o in M.roots) { var list = M.roots[o], live = [], k = 0;
    for (var i = 0; i < list.length; i++) { var x = list[i].deref(); if (!x) continue; live.push(list[i]);
      var p = x.parent, nested = false; while (p) { if (M.own.get(p) === o) { nested = true; break; } p = p.parent; }
      if (!nested) { H["own:" + o + "#" + (k++)] = x; n++; } }
    M.roots[o] = live; }
  if (C) for (var key in C) { var v; try { v = C[key]; } catch (_) { continue; } if (v && typeof v === "object") { H["CBZ." + key] = v; n++; } }
  window.__msRoots = H; return n; };
M.rmRoots = function(){ delete window.__msRoots; };

/* ---- GPU walk: bytes per owner, uploaded or not, flags ---- */
M.gpuWalk = function(farM){
  var C = window.CBZ, sc = C.scene, T = window.THREE, P = C.player && C.player.pos, own = {}, geoInfo = new Map(), seenBuf = new Set(), seenTex = new Set();
  var dup = new Map(), big = [], texRows = [], tot = { gpu: 0, geo: 0, tex: 0, cpuStatic: 0, cpuDyn: 0, notUp: 0, notUpHidden: 0, hidden: 0, far: 0, srcKept: 0 };
  function O(k){ return own[k] || (own[k] = { gpu: 0, geo: 0, tex: 0, cpuStatic: 0, cpuDyn: 0, notUp: 0, notUpHidden: 0, hidden: 0, far: 0, srcKept: 0, meshes: 0, instances: 0, tris: 0 }); }
  function ownerOf(o){ for (var x = o; x; x = x.parent) { var w = M.own.get(x); if (w) return w; } return "unowned"; }
  function vis(o){ for (var x = o; x; x = x.parent) if (!x.visible) return false; return true; }
  function hash(arr){ var u = arr.byteLength % 4 === 0 ? new Uint32Array(arr.buffer, arr.byteOffset, arr.byteLength >> 2) : new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    var h = 2166136261 ^ u.length, n = u.length, step = Math.max(1, Math.floor(n / 2048));
    for (var i = 0; i < n; i += step) { h ^= u[i]; h = Math.imul(h, 16777619); } h ^= u[n - 1]; h = Math.imul(h, 16777619); return (h >>> 0).toString(36) + ":" + arr.byteLength; }
  function attr(a, R, flags, label){ if (!a) return 0; var d = a.isInterleavedBufferAttribute ? a.data : a; if (seenBuf.has(d)) return 0; seenBuf.add(d);
    var arr = d.array, e = arr && arr.BYTES_PER_ELEMENT || 4, n = (d.count || 0) * (d.stride || d.itemSize || 1) * e; if (arr && arr.byteLength > n) n = arr.byteLength;
    var up = arr ? (M.upBuf.has(arr.buffer)) : true;
    if (!up) { R.notUp += n; tot.notUp += n; if (flags.hidden) { R.notUpHidden += n; tot.notUpHidden += n; } return 0; }
    R.gpu += n; R.geo += n; tot.gpu += n; tot.geo += n;
    var held = arr && arr.length ? arr.byteLength : 0;
    if (held) { if (d.usage === 35048) { R.cpuDyn += held; tot.cpuDyn += held; } else { R.cpuStatic += held; tot.cpuStatic += held; } }
    if (flags.hidden) { R.hidden += n; tot.hidden += n; } else if (flags.far) { R.far += n; tot.far += n; }
    if (arr && arr.byteLength >= 16384) { var h = hash(arr), q = dup.get(h); if (!q) dup.set(h, q = { n: 0, bytes: arr.byteLength, owners: {}, label: label, arrs: new Set() });
      if (!q.arrs.has(arr.buffer)) { q.arrs.add(arr.buffer); q.n++; q.owners[flags.owner] = 1; } }
    return n; }
  function tex(t, R, owner, flags){ if (!t || !t.isTexture || seenTex.has(t)) return; seenTex.add(t);
    var im = t.image, faces = 1; if (Array.isArray(im)) { faces = im.length || 6; im = im[0]; }
    var w = im && (im.width || im.naturalWidth) || 0, h = im && (im.height || im.naturalHeight) || 0, dep = im && im.depth || 1, data = im && im.data;
    var b = t.type === 1015 ? 16 : t.type === 1016 ? 8 : 4; if (t.format === 1028 || t.format === 1024 || t.format === 1021) b /= 4; else if (t.format === 1025 || t.format === 1030) b /= 2;
    var mip = t.generateMipmaps && t.minFilter !== 1003 && t.minFilter !== 1006 ? 4 / 3 : 1;
    var bytes = t.isCompressedTexture ? (t.mipmaps || []).reduce(function(s, m){ return s + (m.data ? m.data.byteLength : 0); }, 0) * faces : w * h * dep * b * mip * faces;
    var up = data ? (data.buffer && M.upBuf.has(data.buffer)) : (im && M.upSrc.has(im)) || (t.isCompressedTexture && t.mipmaps && t.mipmaps[0] && t.mipmaps[0].data && M.upBuf.has(t.mipmaps[0].data.buffer));
    var src = im && (im instanceof HTMLCanvasElement || im instanceof HTMLImageElement || (window.ImageBitmap && im instanceof ImageBitmap)) ? w * h * 4 * faces : 0;
    if (data && data.byteLength) src += data.byteLength;
    R.srcKept += src; tot.srcKept += src;
    if (!up) { R.notUp += bytes; tot.notUp += bytes; }
    else { R.gpu += bytes; R.tex += bytes; tot.gpu += bytes; tot.tex += bytes; if (flags.hidden) { R.hidden += bytes; tot.hidden += bytes; } }
    texRows.push([owner, t.name || (im && im.src ? String(im.src).split("/").pop().slice(0, 40) : (im && im.tagName ? im.tagName.toLowerCase() : data ? "data" : "?")), w + "x" + h + (faces > 1 ? "x" + faces : ""), bytes, up ? 1 : 0, src]); }
  /* pass 1: per geometry, who owns it (first user), is ANY user visible, are ALL users far */
  var meshes = [], sph = T && new T.Sphere();
  sc.updateMatrixWorld(true);
  sc.traverse(function(o){ if (!o.geometry && !o.material) return;
    var ow = ownerOf(o), v = vis(o), far = false, g = o.geometry;
    if (P && g && !o.isInstancedMesh) { try { if (!g.boundingSphere) g.computeBoundingSphere(); sph.copy(g.boundingSphere).applyMatrix4(o.matrixWorld);
      far = Math.hypot(sph.center.x - P.x, sph.center.z - P.z) - sph.radius > farM; } catch (_) {} }
    meshes.push([o, ow, v, far]);
    if (g) { var gi = geoInfo.get(g); if (!gi) geoInfo.set(g, gi = { owner: ow, vis: false, allFar: true, users: 0, name: o.name || g.name || o.type });
      gi.users++; if (v) gi.vis = true; if (!far || !v) gi.allFar = gi.allFar && far; } });
  /* pass 2: tally */
  meshes.forEach(function(m){ var o = m[0], R = O(m[1]); R.meshes++; var inst = o.isInstancedMesh ? o.count : 1; if (o.isInstancedMesh) R.instances += inst;
    var g = o.geometry; if (g && m[2]) { var nIdx = g.index ? g.index.count : (g.attributes && g.attributes.position ? g.attributes.position.count : 0); R.tris += nIdx / 3 * inst; }
    if (o.isInstancedMesh) { var fl = { hidden: !m[2], far: false, owner: m[1] }; attr(o.instanceMatrix, R, fl, "instanceMatrix"); attr(o.instanceColor, R, fl, "instanceColor"); }
    var mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach(function(mt){ if (!mt) return; for (var k in mt) { var v = mt[k]; if (v && v.isTexture) tex(v, R, m[1], { hidden: !m[2] }); }
      if (mt.uniforms) for (var u in mt.uniforms) { var uv = mt.uniforms[u] && mt.uniforms[u].value; if (uv && uv.isTexture) tex(uv, R, m[1], { hidden: !m[2] }); } }); });
  geoInfo.forEach(function(gi, g){ var R = O(gi.owner), fl = { hidden: !gi.vis, far: gi.vis && gi.allFar, owner: gi.owner }, s = 0, held = 0;
    var names = Object.keys(g.attributes || {});
    names.forEach(function(k){ s += attr(g.attributes[k], R, fl, gi.name + "." + k); var a = g.attributes[k]; if (a && a.array && a.array.length) held += a.array.byteLength; });
    s += attr(g.index, R, fl, gi.name + ".index"); if (g.index && g.index.array && g.index.array.length) held += g.index.array.byteLength;
    for (var mk in (g.morphAttributes || {})) (g.morphAttributes[mk] || []).forEach(function(a){ s += attr(a, R, fl, gi.name + ".morph"); });
    if (s > 0) big.push([gi.owner, String(gi.name).slice(0, 40), s, held, gi.users, gi.vis ? (gi.allFar ? "far" : "vis") : "HIDDEN"]); });
  /* shadow maps + render targets hanging off CBZ */
  var rts = [], seenRT = new Set();
  sc.traverse(function(o){ if (o.isLight && o.shadow && o.shadow.map && !seenRT.has(o.shadow.map)) { seenRT.add(o.shadow.map); var m = o.shadow.map; rts.push(["shadow:" + (o.name || o.type), m.width + "x" + m.height, m.width * m.height * 8]); } });
  for (var ck in C) { var cv; try { cv = C[ck]; } catch (_) { continue; } if (cv && cv.isWebGLRenderTarget && !seenRT.has(cv)) { seenRT.add(cv); rts.push(["CBZ." + ck, cv.width + "x" + cv.height, cv.width * cv.height * (4 + (cv.depthBuffer ? 4 : 0))]); } }
  var dups = []; dup.forEach(function(q){ if (q.n > 1) dups.push([q.label, q.n, q.bytes, (q.n - 1) * q.bytes, Object.keys(q.owners).join(",")]); });
  dups.sort(function(a, b){ return b[3] - a[3]; }); big.sort(function(a, b){ return b[2] - a[2]; }); texRows.sort(function(a, b){ return b[3] - a[3]; });
  var ri = C.renderer && C.renderer.info;
  return { owners: own, tot: tot, big: big.slice(0, 40), dups: dups.slice(0, 20), dupBytes: dups.reduce(function(s, d){ return s + d[3]; }, 0), tex: texRows.slice(0, 30), texCount: seenTex.size,
    geoCount: geoInfo.size, rts: rts, gl: M.glRead(), info: ri ? { geometries: ri.memory.geometries, textures: ri.memory.textures, programs: ri.programs ? ri.programs.length : 0 } : null,
    player: P ? { x: +P.x.toFixed(1), z: +P.z.toFixed(1) } : null, roots: M.nRoots }; };

/* ---- the tour ---- */
M.ground = function(x, z){ var C = window.CBZ; try { var f = C.groundAt || C.cityGroundHeightAt || C.terrainHeight; if (f) { var y = f(x, z); if (y != null && isFinite(y)) return y; } } catch (_) {} return null; };
M.place = function(x, z, y){ var C = window.CBZ, p = C.player; if (!p || !p.pos) return false;
  try { if (p.driving && C.exitVehicle) C.exitVehicle(); } catch (_) {}
  if (y == null) y = M.ground(x, z); p.pos.x = x; p.pos.z = z; if (y != null) p.pos.y = y;
  if (p.vel) { p.vel.x = 0; p.vel.y = 0; p.vel.z = 0; } p.hp = Math.max(p.hp || 0, 100); return true; };
})();`;

/* ---------------- heap snapshot: streaming parse ---------------- */
export class SnapParser {
  constructor() { this.phase = 0; this.head = ""; this.tail = ""; this.strings = []; this.k = 0; this.cur = 0; this.inNum = false; this.sRaw = null; this.sEsc = false; this.sBs = false; }
  seek(chunk, marker) {
    const buf = this.tail + chunk, i = buf.indexOf(marker);
    if (i < 0) { this.tail = buf.slice(-marker.length); return null; }
    this.tail = ""; return buf.slice(i + marker.length);
  }
  nums(chunk, arr) {   // returns rest after ']' or null
    let k = this.k, cur = this.cur, inNum = this.inNum;
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk.charCodeAt(i);
      if (c >= 48 && c <= 57) { cur = cur * 10 + (c - 48); inNum = true; }
      else {
        if (inNum) { if (k >= arr.a.length) { const b = new Uint32Array(arr.a.length * 2 + 1024); b.set(arr.a); arr.a = b; } arr.a[k++] = cur; cur = 0; inNum = false; }
        if (c === 93) { arr.n = k; this.k = 0; this.cur = 0; this.inNum = false; return chunk.slice(i + 1); }
      }
    }
    this.k = k; this.cur = cur; this.inNum = inNum; return null;
  }
  strs(chunk) {
    let i = 0, start = -1;
    if (this.sRaw != null) start = 0;
    for (; i < chunk.length; i++) {
      const c = chunk.charCodeAt(i);
      if (this.sRaw == null) { if (c === 34) { this.sRaw = ""; this.sBs = false; start = i + 1; } else if (c === 93) { this.phase = 9; return; } continue; }
      if (this.sEsc) { this.sEsc = false; continue; }
      if (c === 92) { this.sEsc = true; this.sBs = true; continue; }
      if (c === 34) { const raw = this.sRaw + chunk.slice(start, i); let s = raw; if (this.sBs) { try { s = JSON.parse('"' + raw + '"'); } catch (_) {} }
        this.strings.push(s); this.sRaw = null; start = -1; }
    }
    if (this.sRaw != null) this.sRaw += chunk.slice(start);
  }
  push(chunk) {
    for (;;) {
      if (this.phase === 0) {
        this.head += chunk; const m = /"nodes":\[/.exec(this.head); if (!m) return;
        const txt = this.head.slice(0, m.index).replace(/,\s*$/, "") + "}";
        this.meta = JSON.parse(txt).snapshot; const nf = this.meta.meta.node_fields.length, ef = this.meta.meta.edge_fields.length;
        this.nodes = { a: new Uint32Array(this.meta.node_count * nf + 16), n: 0 }; this.edges = { a: new Uint32Array(this.meta.edge_count * ef + 16), n: 0 };
        chunk = this.head.slice(m.index + m[0].length); this.head = null; this.phase = 1; continue;
      }
      if (this.phase === 1) { const r = this.nums(chunk, this.nodes); if (r == null) return; chunk = r; this.phase = 2; continue; }
      if (this.phase === 2) { const r = this.seek(chunk, '"edges":['); if (r == null) return; chunk = r; this.phase = 3; continue; }
      if (this.phase === 3) { const r = this.nums(chunk, this.edges); if (r == null) return; chunk = r; this.phase = 4; continue; }
      if (this.phase === 4) { const r = this.seek(chunk, '"strings":['); if (r == null) return; chunk = r; this.phase = 5; continue; }
      if (this.phase === 5) { this.strs(chunk); return; }
      return;
    }
  }
}

async function takeSnapshot(B, sid, crashP) {
  const p = new SnapParser(); let bytes = 0;
  let lastPct = -1;
  const l = (m) => { if (m.sessionId !== sid) return;
    if (m.method === "HeapProfiler.addHeapSnapshotChunk") { if (!bytes) log("snapshot streaming"); bytes += m.params.chunk.length; p.push(m.params.chunk); }
    else if (m.method === "HeapProfiler.reportHeapSnapshotProgress") { const pct = Math.floor(m.params.done / Math.max(1, m.params.total) * 4) * 25; if (pct !== lastPct) { lastPct = pct; log(`snapshot build ${pct}% (${m.params.done}/${m.params.total})`); } } };
  B.listeners.push(l);
  try { const g0 = Date.now(); await Promise.race([crashP, B.send("HeapProfiler.collectGarbage", {}, sid, 120000)]); log(`gc ${Date.now() - g0} ms`);
    await Promise.race([crashP, B.send("HeapProfiler.takeHeapSnapshot", { reportProgress: true, captureNumericValue: false }, sid, 900000)]); }
  finally { B.listeners.splice(B.listeners.indexOf(l), 1); }
  if (p.phase !== 9 && p.phase !== 5) throw new Error("heap snapshot truncated (phase " + p.phase + ")");
  p.jsonMB = MB(bytes);
  return p;
}

/* dominator tree + retained sizes + owners (+ optional diff against earlier ids) */
export function analyze(snap, { prevIds = null, top = 20 } = {}) {
  const t0 = Date.now();
  const M = snap.meta.meta, nf = M.node_fields.length, ef = M.edge_fields.length;
  const oT = M.node_fields.indexOf("type"), oN = M.node_fields.indexOf("name"), oI = M.node_fields.indexOf("id"), oS = M.node_fields.indexOf("self_size"), oE = M.node_fields.indexOf("edge_count");
  const eT = M.edge_fields.indexOf("type"), eN = M.edge_fields.indexOf("name_or_index"), eTo = M.edge_fields.indexOf("to_node");
  const NT = M.node_types[0], ET = M.edge_types[0], S = snap.strings;
  const nodes = snap.nodes.a, edges = snap.edges.a, N = snap.nodes.n / nf;
  const WEAK = ET.indexOf("weak"), ELEM = ET.indexOf("element"), HID = ET.indexOf("hidden"), PROP = ET.indexOf("property"), CTX = ET.indexOf("context"), SHORT = ET.indexOf("shortcut"), INTL = ET.indexOf("internal");
  const tObj = NT.indexOf("object"), tNative = NT.indexOf("native"), tSyn = NT.indexOf("synthetic"), tHidden = NT.indexOf("hidden"), tCode = NT.indexOf("code"), tClosure = NT.indexOf("closure");
  const first = new Uint32Array(N + 1); for (let i = 0, e = 0; i < N; i++) { first[i] = e; e += nodes[i * nf + oE] * ef; first[i + 1] = e; }
  const self = (n) => nodes[n * nf + oS];
  const nm = (n) => S[nodes[n * nf + oN]] || "";
  const ename = (e) => { const t = edges[e + eT], v = edges[e + eN]; return (t === ELEM || t === HID) ? v : S[v]; };
  /* postorder DFS from the synthetic root, skipping weak edges */
  const post = new Uint32Array(N), pIdx = new Int32Array(N).fill(-1), stN = new Uint32Array(N), stE = new Uint32Array(N), seen = new Uint8Array(N);
  let sp = 0, cnt = 0; stN[0] = 0; stE[0] = first[0]; seen[0] = 1; sp = 1;
  while (sp) {
    const n = stN[sp - 1]; let e = stE[sp - 1]; const end = first[n + 1]; let pushed = false;
    for (; e < end; e += ef) { if (edges[e + eT] === WEAK) continue; const t = edges[e + eTo] / nf; if (seen[t]) continue; seen[t] = 1; stE[sp - 1] = e + ef; stN[sp] = t; stE[sp] = first[t]; sp++; pushed = true; break; }
    if (!pushed) { sp--; pIdx[n] = cnt; post[cnt++] = n; }
  }
  /* predecessors (CSR, reachable only) */
  const pc = new Uint32Array(cnt + 1);
  for (let po = 0; po < cnt; po++) { const n = post[po]; for (let e = first[n]; e < first[n + 1]; e += ef) { if (edges[e + eT] === WEAK) continue; const t = pIdx[edges[e + eTo] / nf]; if (t >= 0) pc[t + 1]++; } }
  for (let i = 0; i < cnt; i++) pc[i + 1] += pc[i];
  const preds = new Uint32Array(pc[cnt]), fill = pc.slice(0, cnt);
  for (let po = 0; po < cnt; po++) { const n = post[po]; for (let e = first[n]; e < first[n + 1]; e += ef) { if (edges[e + eT] === WEAK) continue; const t = pIdx[edges[e + eTo] / nf]; if (t >= 0) preds[fill[t]++] = po; } }
  /* Cooper-Harvey-Kennedy on postorder numbers, with DevTools' "affected"
     worklist: a node is recomputed only when one of its predecessors' idom
     moved. Without it a 6.7M-node city heap took 635 full passes (8 min). */
  const root = cnt - 1, dom = new Int32Array(cnt).fill(-1); dom[root] = root;
  const affected = new Uint8Array(cnt);
  for (let e = first[post[root]]; e < first[post[root] + 1]; e += ef) { if (edges[e + eT] === WEAK) continue; const t = pIdx[edges[e + eTo] / nf]; if (t >= 0) affected[t] = 1; }
  let changed = true, iters = 0;
  while (changed) { changed = false; iters++;
    for (let po = root - 1; po >= 0; po--) {
      if (!affected[po]) continue; affected[po] = 0;
      let nd = -1;
      for (let j = pc[po]; j < pc[po + 1]; j++) { const p = preds[j]; if (dom[p] < 0) continue;
        if (nd < 0) { nd = p; continue; } let a = p, b = nd; while (a !== b) { while (a < b) a = dom[a]; while (b < a) b = dom[b]; } nd = a; }
      if (nd >= 0 && dom[po] !== nd) { dom[po] = nd; changed = true;
        const n = post[po]; for (let e = first[n]; e < first[n + 1]; e += ef) { if (edges[e + eT] === WEAK) continue; const t = pIdx[edges[e + eTo] / nf]; if (t >= 0) affected[t] = 1; } }
    }
  }
  const ret = new Float64Array(cnt); for (let po = 0; po < cnt; po++) ret[po] = self(post[po]);
  for (let po = 0; po < root; po++) if (dom[po] >= 0) ret[dom[po]] += ret[po];
  let totalSelf = 0; for (let po = 0; po < cnt; po++) totalSelf += self(post[po]);
  /* class histogram */
  const cls = (n) => { const t = nodes[n * nf + oT]; const s = nm(n);
    if (t === tObj || t === tNative) return s.length > 60 ? s.slice(0, 60) : s;
    if (t === tClosure) return "(closure)"; if (t === tCode) return "(code) " + (s.startsWith("system /") ? s.slice(9, 40) : ""); return "(" + NT[t] + ")"; };
  const hist = new Map();
  for (let po = 0; po < cnt; po++) { const n = post[po]; const k = cls(n); let h = hist.get(k); if (!h) hist.set(k, h = [0, 0]); h[0] += self(n); h[1]++; }
  /* named roots: window.__msRoots */
  let holder = -1;
  for (let n = 0; n < N && holder < 0; n++) for (let e = first[n]; e < first[n + 1]; e += ef) { const t = edges[e + eT]; if ((t === PROP) && S[edges[e + eN]] === "__msRoots") { holder = edges[e + eTo] / nf; break; } }
  const named = new Map();   // po -> name
  if (holder >= 0) for (let e = first[holder]; e < first[holder + 1]; e += ef) { if (edges[e + eT] !== PROP) continue; const t = pIdx[edges[e + eTo] / nf]; if (t >= 0 && !named.has(t)) named.set(t, S[edges[e + eN]]); }
  const group = (name) => name.replace(/#\d+$/, "");
  const byOwner = new Map(), byHolder = new Map();
  const namedAll = []; if (holder >= 0) for (let e = first[holder]; e < first[holder + 1]; e += ef) { if (edges[e + eT] !== PROP) continue; const t = pIdx[edges[e + eTo] / nf]; if (t >= 0) namedAll.push([t, S[edges[e + eN]]]); }
  for (const [po, name] of namedAll) { const g = group(name); const m = g.startsWith("own:") ? byOwner : byHolder; let r = m.get(g); if (!r) m.set(g, r = { retained: 0, roots: 0 }); r.retained += ret[po]; r.roots++; }
  /* nearest named dominator for every node (reverse postorder: dominators first) */
  const ownerOf = new Int32Array(cnt).fill(-1), gName = []; const gIdx = new Map();
  for (let po = root; po >= 0; po--) { const nmd = named.get(po); if (nmd != null) { const g = group(nmd); let gi = gIdx.get(g); if (gi == null) { gi = gName.length; gName.push(g); gIdx.set(g, gi); } ownerOf[po] = gi; } else if (po !== root && dom[po] >= 0) ownerOf[po] = ownerOf[dom[po]]; }
  /* BFS parents for retainer paths, seeded at Window objects first; never through our own bookkeeping */
  let par = null, parE = null;
  const bfs = () => { if (par) return; par = new Int32Array(N).fill(-1); parE = new Int32Array(N).fill(-1); const q = new Uint32Array(N); let qh = 0, qt = 0;
    const seen2 = new Uint8Array(N);
    for (let e = first[0]; e < first[1]; e += ef) { const t = edges[e + eTo] / nf; if (/^Window\b/.test(nm(t)) || edges[e + eT] === SHORT) { if (!seen2[t]) { seen2[t] = 1; q[qt++] = t; } } }
    seen2[0] = 1; q[qt++] = 0;
    while (qh < qt) { const n = q[qh++]; for (let e = first[n]; e < first[n + 1]; e += ef) { if (edges[e + eT] === WEAK) continue; const t = edges[e + eTo] / nf; if (seen2[t]) continue;
      const en = ename(e); if (en === "__msRoots" || en === "__ms") continue; seen2[t] = 1; par[t] = n; parE[t] = e; q[qt++] = t; } } };
  const pathTo = (n) => { bfs(); const segs = []; let c = n, hops = 0;
    while (c >= 0 && par[c] >= 0 && hops < 40) { const e = parE[c], t = edges[e + eT], v = ename(e);
      segs.push(t === ELEM ? `[${v}]` : t === HID ? `{${v}}` : t === CTX ? `::${v}` : t === INTL ? `<${v}>` : `.${v}`); c = par[c]; hops++; }
    let head = c >= 0 ? nm(c) : "?"; if (/^Window\b/.test(head)) head = "Window"; if (c >= 0 && par[c] >= 0) head = "... " + head; segs.reverse();
    const s = head + segs.join(""); return s.length > 220 ? s.slice(0, 100) + " ... " + s.slice(-110) : s; };
  /* biggest dominators nobody named owns (direct children of the root's dominance, walked down while one child holds most) */
  const unowned = [];
  const kids = new Map(); for (let po = 0; po < root; po++) if (ownerOf[po] < 0 && dom[po] >= 0 && ownerOf[dom[po]] < 0) { const d = dom[po]; if (!kids.has(d)) kids.set(d, []); kids.get(d).push(po); }
  { const cand = []; for (let po = 0; po < root; po++) if (ownerOf[po] < 0 && ret[po] > 256 * 1024) cand.push(po);
    // keep nodes whose dominator is a synthetic/"tiny-self" hub: the top of each unowned subtree
    cand.sort((a, b) => ret[b] - ret[a]); if (cand.length > 4000) cand.length = 4000;
    const taken = new Set();
    for (const po of cand) { let d = dom[po], inside = false; while (d >= 0 && d !== root) { if (taken.has(d)) { inside = true; break; } d = dom[d]; } if (inside) continue;
      const n = post[po], t = nodes[n * nf + oT]; if (t === tSyn || /^\(GC roots\)|^\(Global handles\)|^system \/ NativeContext|^Window\b|^\(Internalized strings\)/.test(nm(n))) continue;
      taken.add(po); unowned.push(po); if (unowned.length >= 12) break; } }
  const out = { ms: 0, nodes: N, reachable: cnt, domIters: iters, totalMB: MB(totalSelf),
    classes: [...hist].sort((a, b) => b[1][0] - a[1][0]).slice(0, 25).map(([k, v]) => ({ cls: k, MB: +MB(v[0]).toFixed(2), n: v[1] })),
    owners: [...byOwner].sort((a, b) => b[1].retained - a[1].retained).map(([k, v]) => ({ owner: k.replace(/^own:/, ""), MB: +MB(v.retained).toFixed(2), bytes: v.retained, roots: v.roots })),
    holders: [...byHolder].sort((a, b) => b[1].retained - a[1].retained).slice(0, 40).map(([k, v]) => ({ holder: k, MB: +MB(v.retained).toFixed(2), bytes: v.retained })),
    unowned: unowned.map((po) => ({ MB: +MB(ret[po]).toFixed(2), cls: cls(post[po]), path: pathTo(post[po]) })),
    namedRoots: named.size, jsonMB: +snap.jsonMB.toFixed(0) };
  /* ids (sorted) so a later snapshot can diff against this one */
  const ids = new Uint32Array(cnt); for (let po = 0; po < cnt; po++) ids[po] = nodes[post[po] * nf + oI]; ids.sort();
  out._ids = ids;
  if (prevIds) {
    const inPrev = (id) => { let lo = 0, hi = prevIds.length - 1; while (lo <= hi) { const m = (lo + hi) >> 1, v = prevIds[m]; if (v === id) return true; if (v < id) lo = m + 1; else hi = m - 1; } return false; };
    const clusters = new Map(); let newSelf = 0, newN = 0, newRet = 0;
    for (let po = 0; po < root; po++) { const n = post[po]; if (inPrev(nodes[n * nf + oI])) continue; const s = self(n); newSelf += s; newN++;
      const own = ownerOf[po] >= 0 ? gName[ownerOf[po]].replace(/^own:/, "") : "(unowned)", k = own + " | " + cls(n);
      let c = clusters.get(k); if (!c) clusters.set(k, c = { owner: own, cls: cls(n), n: 0, self: 0, rep: -1, repS: -1 }); c.n++; c.self += s; if (s > c.repS) { c.repS = s; c.rep = n; } }
    let totPrev = 0; out.diff = { newMB: +MB(newSelf).toFixed(2), newObjects: newN,
      clusters: [...clusters.values()].sort((a, b) => b.self - a.self).slice(0, top).map((c) => ({ owner: c.owner, cls: c.cls, n: c.n, MB: +MB(c.self).toFixed(3), path: pathTo(c.rep) })) };
    void totPrev; void newRet;
  }
  out.ms = Date.now() - t0;
  return out;
}

/* ---------------- profiles ---------------- */
function cpuTop(P, n = 15) {
  const byId = new Map(P.nodes.map((x) => [x.id, x]));
  const key = (x) => { const f = x.callFrame; return `${(f.url || "").replace(/^.*?\/(src|games)\//, "").replace(/\?.*$/, "") || "(native)"}:${f.functionName || "(anon)"}:${f.lineNumber + 1}`; };
  const file = (x) => (x.callFrame.url || "").replace(/^.*?\/(src|games)\//, "").replace(/\?.*$/, "") || "(" + (x.callFrame.functionName || "native") + ")";
  const dt = new Map(), ts = P.timeDeltas || [];
  for (let i = 0; i < P.samples.length; i++) dt.set(P.samples[i], (dt.get(P.samples[i]) || 0) + (ts[i + 1] || 0));
  const self = new Map(), byFile = new Map(); let total = 0;
  for (const [id, us] of dt) { total += us; const x = byId.get(id); self.set(key(x), (self.get(key(x)) || 0) + us); byFile.set(file(x), (byFile.get(file(x)) || 0) + us); }
  const s = (m) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ k, ms: Math.round(v / 1000) }));
  return { totalMs: Math.round(total / 1000), self: s(self), byFile: s(byFile) };
}
function heapSampleTop(P, n = 15) {
  const parent = new Map(), flat = [];
  const walk = (x, p) => { parent.set(x.id, p); flat.push(x); for (const c of x.children || []) walk(c, x); };
  walk(P.head, null);
  const byId = new Map(flat.map((x) => [x.id, x]));
  const byB = new Map(), bySite = new Map(), byFile = new Map(); let total = 0;
  const srcOf = (u) => (u || "").replace(/^.*?\/(src|games)\//, "").replace(/\?.*$/, "");
  for (const smp of P.samples || []) {
    const leaf = byId.get(smp.nodeId); if (!leaf) continue; total += smp.size;
    let b = "(not in a builder)", site = null, fl = null;
    for (let x = leaf; x; x = parent.get(x.id)) { const f = x.callFrame;
      if (!site && /\/(src|games)\//.test(f.url || "")) { site = `${srcOf(f.url)}:${f.functionName || "(anon)"}:${f.lineNumber + 1}`; fl = srcOf(f.url); }
      if (f.functionName && f.functionName.startsWith("ms_B_")) { b = f.functionName.slice(5); break; } }
    site = site || "(native/three)"; fl = fl || "(native/three)";
    byB.set(b, (byB.get(b) || 0) + smp.size); bySite.set(site, (bySite.get(site) || 0) + smp.size); byFile.set(fl, (byFile.get(fl) || 0) + smp.size);
  }
  const s = (m) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ k, MB: +MB(v).toFixed(2) }));
  return { totalMB: +MB(total).toFixed(1), byBuilder: s(byB), bySite: s(bySite), byFile: s(byFile) };
}

/* ---------------- main ---------------- */
async function main() {
  if (!has("--no-lock")) await takeLock();
  process.on("SIGINT", () => { cleanup(); process.exit(130); });
  let base = opt("--url", "");
  if (!base) { SRV = await startServer(path.resolve(opt("--root", ROOT0))); base = `http://127.0.0.1:${SRV.address().port}/`; }
  base = base.replace(/\/?$/, "/");
  const B = CH = await launchChrome();
  const { browserContextId } = await B.send("Target.createBrowserContext", { disposeOnDetach: true });
  await B.send("Target.setDiscoverTargets", { discover: true }).catch(() => {});
  const { targetId } = await B.send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId: sid } = await B.send("Target.attachToTarget", { targetId, flatten: true });
  const s = (m, p, t) => B.send(m, p, sid, t);
  /* a renderer that dies (OOM on a big world) must fail the run, not hang it */
  let crashed = null; const crashP = new Promise((_, rej) => B.listeners.push((m) => {
    if (/crash/i.test(m.method || "")) log("event " + m.method + " " + JSON.stringify(m.params || {}).slice(0, 200));
    if ((m.method === "Inspector.targetCrashed" && m.sessionId === sid) || (m.method === "Target.detachedFromTarget" && m.params.sessionId === sid) || (m.method === "Target.targetCrashed" && m.params.targetId === targetId)) { crashed = m.method; rej(new Error("renderer crashed/detached (" + m.method + ")")); } }));
  crashP.catch(() => {});
  const ev = async (expression, timeoutMs = 120000) => {
    const r = await Promise.race([crashP, s("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, timeout: timeoutMs }, timeoutMs + 5000)]);
    if (r.exceptionDetails) throw new Error("page threw: " + String(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text).slice(0, 400));
    return r.result.value;
  };
  await s("Page.enable"); await s("Runtime.enable"); await s("Inspector.enable").catch(() => {}); await s("HeapProfiler.enable"); await s("Profiler.enable");
  let pre = PRELOAD;
  if (DEVICE !== "desktop") {
    try { pre = fs.readFileSync(path.join(ROOT0, "tools/preload/ipad.js"), "utf8") + "\n;" + pre; } catch (_) {}
    await s("Emulation.setDeviceMetricsOverride", { width: VIEW.w, height: VIEW.h, deviceScaleFactor: VIEW.dpr, mobile: DEVICE === "phone" });
    await s("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    if (DEVICE === "phone") await s("Emulation.setUserAgentOverride", { userAgent: PHONE_UA, platform: "iPhone", acceptLanguage: "en-US" });
  }
  await s("Page.addScriptToEvaluateOnNewDocument", { source: pre });
  /* same-origin blank first, so the sampling heap profiler is running in the
     page's own renderer before the first game script evaluates */
  await s("Page.navigate", { url: base + "__memscope_blank.html" }); await sleep(300);
  await s("HeapProfiler.startSampling", { samplingInterval: +opt("--sample-kb", 128) * 1024 });
  const q = ["mode=city", "seed=" + SEED]; if (SLICE) q.push("slice=" + encodeURIComponent(SLICE)); if (QUERY) q.push(QUERY.replace(/^[?&]/, ""));
  const url = base + "index.html?" + q.join("&");
  log(`boot ${url} (${DEVICE})`);
  const tNav = Date.now();
  await s("Page.navigate", { url });
  for (let t = Date.now(); ; ) {
    try { if (await ev("!!(window.CBZ && CBZ.bootComplete && CBZ.startRun && document.readyState === 'complete')", 5000)) break; } catch (_) {}
    if (Date.now() - t > 240000) throw new Error("bootComplete never came"); await sleep(80);
  }
  const titleAt = await ev("({ now: performance.now(), scriptEnd: __ms.scriptEnd })");
  const R = { version: 1, label: LABEL, url, device: DEVICE, slice: SLICE || null, at: new Date().toISOString(), load: os.loadavg().map((x) => +x.toFixed(1)) };
  /* D. the build, CPU-profiled */
  await s("Profiler.setSamplingInterval", { interval: 500 }); await s("Profiler.start");
  const b = await ev("__ms.build()", 600000);
  const { profile: cpuProf } = await s("Profiler.stop", {}, 240000);
  if (b.err) throw new Error("startRun threw: " + b.err);
  log(`startRun ${b.ms.toFixed(0)} ms; settling ${SETTLE} frames`);
  const fr0 = Date.now();
  await sleep(60);
  await ev(`__ms.step(${SETTLE}), 1`, 600000);
  const settleMs = Date.now() - fr0;
  log("settled; reading the sampling heap profile");
  const { profile: heapProf } = await s("HeapProfiler.stopSampling", {}, 900000);
  log("sampling profile read");
  R.boot = { navToTitleMs: Math.round(titleAt.now), scriptEvalEndMs: Math.round(titleAt.scriptEnd), startRunMs: Math.round(b.ms), settleFramesMs: settleMs, settleFrames: SETTLE, wallMs: Date.now() - tNav,
    builders: b.builders.slice().sort((x, y) => y[1] - x[1]).map(([k, v]) => ({ k, ms: Math.round(v) })),
    phases: b.steps.map((st, i) => ({ k: st[0], ms: Math.round((i + 1 < b.steps.length ? b.steps[i + 1][1] : b.ms) - st[1]) })).sort((x, y) => y.ms - x.ms),
    cpu: cpuTop(cpuProf, 20) };
  R.allocs = heapSampleTop(heapProf, 20);
  /* headline memory */
  const memNow = async () => { const h = await s("Runtime.getHeapUsage"); const g = await ev("__ms.glRead()");
    return { heapMB: +MB(h.usedSize).toFixed(1), arrayBuffersMB: +MB(h.backingStorageSize || 0).toFixed(1), gpuMB: +MB(g.total).toFixed(1), gl: { bufMB: +MB(g.buf).toFixed(1), texMB: +MB(g.tex).toFixed(1), rbMB: +MB(g.rb).toFixed(1), drawingBufferMB: +MB(g.db).toFixed(1), buffers: g.nbuf, textures: g.ntex },
      phoneMB: +MB(h.usedSize + (h.backingStorageSize || 0) + g.total).toFixed(1) }; };
  R.mem = await memNow();
  /* B. GPU walk */
  log("gpu walk");
  R.gpu = await ev(`__ms.gpuWalk(${FAR})`, 300000);
  /* A. heap snapshot */
  if (DO_HEAP) {
    log("heap snapshot A");
    await ev("__ms.mkRoots()");
    const snapA = await takeSnapshot(B, sid, crashP);
    await ev("__ms.rmRoots()");
    log(`snapshot A ${snapA.jsonMB.toFixed(0)} MB json, ${snapA.meta.node_count} nodes; dominators`);
    R.heap = analyze(snapA, { top: TOP });
    log(`analysis ${R.heap.ms} ms (${R.heap.domIters} passes)`);
    const idsA = R.heap._ids; delete R.heap._ids;
    /* C. the tour */
    if (DO_LEAK) {
      const stops = await ev(`(function(){ var C = CBZ, p = C.player && C.player.pos, out = [], n = ${TOUR_N};
        if (!p) return null; var home = { x: p.x, y: p.y, z: p.z };
        if (C.slice) { for (var i = 0; i < n; i++) { var a = i / n * Math.PI * 2; out.push({ x: C.slice.x + Math.cos(a) * C.slice.r * 0.7, z: C.slice.z + Math.sin(a) * C.slice.r * 0.7, name: "ring" + i }); } }
        else { var S = C.SLICES || {}, ks = Object.keys(S).slice(0, n); ks.forEach(function(k){ out.push({ x: S[k].x, z: S[k].z, name: k }); }); }
        return { home: home, stops: out }; })()`);
      if (stops) {
        log(`tour: ${stops.stops.map((x) => x.name).join(" > ")} > home (${TOUR_FRAMES} frames each)`);
        const gpu0 = R.gpu;
        for (const st of stops.stops) await ev(`(function(){ __ms.place(${st.x}, ${st.z}); __ms.step(${TOUR_FRAMES}, function(){ __ms.place(${st.x}, ${st.z}); }); return 1; })()`, 600000);
        const h = stops.home;
        await ev(`(function(){ __ms.place(${h.x}, ${h.z}, ${h.y}); __ms.step(${TOUR_FRAMES + 30}, function(i){ if (i < 5) __ms.place(${h.x}, ${h.z}, ${h.y}); }); return 1; })()`, 600000);
        R.memAfterTour = await memNow();
        const gpu1 = await ev(`__ms.gpuWalk(${FAR})`, 300000);
        await ev("__ms.mkRoots()");
        log("heap snapshot B");
        const snapB = await takeSnapshot(B, sid, crashP);
        await ev("__ms.rmRoots()");
        const aB = analyze(snapB, { prevIds: idsA, top: TOP });
        delete aB._ids;
        const gd = {}; const ks = new Set([...Object.keys(gpu0.owners), ...Object.keys(gpu1.owners)]);
        for (const k of ks) { const a = gpu0.owners[k] || { gpu: 0, meshes: 0 }, c = gpu1.owners[k] || { gpu: 0, meshes: 0 }; if (a.gpu !== c.gpu || a.meshes !== c.meshes) gd[k] = { gpuMB: +MB(c.gpu - a.gpu).toFixed(2), meshes: c.meshes - a.meshes }; }
        R.leak = { stops: stops.stops, heapBeforeMB: R.heap.totalMB, heapAfterMB: aB.totalMB, diff: aB.diff, classesAfter: aB.classes.slice(0, 10),
          gpuByOwner: Object.entries(gd).sort((a, b) => Math.abs(b[1].gpuMB) - Math.abs(a[1].gpuMB)).slice(0, 15),
          glBefore: gpu0.gl, glAfter: gpu1.gl, infoBefore: gpu0.info, infoAfter: gpu1.info, memBefore: R.mem, memAfter: R.memAfterTour };
      }
    }
  }
  R.errors = await ev("__ms.errs");
  R.toolMs = Date.now() - T0;
  cleanup();
  fs.mkdirSync(path.dirname(JSON_OUT), { recursive: true });
  fs.writeFileSync(JSON_OUT, JSON.stringify(R, null, 1));
  print(R);
  console.log(`\nJSON: ${JSON_OUT}`);
}

function print(R) {
  const o = [];
  const m = R.mem;
  o.push(`\n=== MEMSCOPE ${R.label}  (${(R.toolMs / 1000).toFixed(0)} s)  ${R.url.replace(/^.*\?/, "?")}`);
  o.push(`PHONE TOTAL ${f1(m.phoneMB)} MB = JS heap ${f1(m.heapMB)} + ArrayBuffers ${f1(m.arrayBuffersMB)} + GPU ${f1(m.gpuMB)} (buffers ${m.gl.bufMB}, textures ${m.gl.texMB}, renderbuffers ${m.gl.rbMB}, drawing buffer ~${m.gl.drawingBufferMB})`);
  const bt = R.boot;
  o.push(`BOOT nav->title ${bt.navToTitleMs} ms (scripts done ${bt.scriptEvalEndMs}) | startRun ${bt.startRunMs} ms | first ${bt.settleFrames} frames ${bt.settleFramesMs} ms`);
  if (R.heap) {
    const h = R.heap;
    o.push(`\n-- A. JS HEAP BY OWNER (retained = freed if it went away; snapshot ${f1(h.totalMB)} MB, ${h.reachable} objects, ${h.namedRoots} named roots)`);
    o.push("   who added it (builder / step / script / runtime)          MB   roots");
    h.owners.slice(0, TOP).forEach((x) => o.push(`   ${pad(x.owner, 52)} ${lpad(x.MB.toFixed(1), 7)} ${lpad(x.roots, 6)}`));
    o.push("   who holds it (CBZ.<key>)                                   MB");
    h.holders.slice(0, 12).forEach((x) => o.push(`   ${pad(x.holder, 52)} ${lpad(x.MB.toFixed(1), 7)}`));
    o.push("   biggest dominators NOBODY above owns (module closures, caches):");
    h.unowned.slice(0, 8).forEach((x) => o.push(`   ${lpad(x.MB.toFixed(1), 7)} MB  ${pad(x.cls, 28)} ${x.path}`));
    o.push("   by class (self size):");
    h.classes.slice(0, 12).forEach((x) => o.push(`   ${pad(x.cls, 52)} ${lpad(x.MB.toFixed(1), 7)} ${lpad(x.n, 8)}`));
  }
  const a = R.allocs;
  o.push(`\n-- A2. LIVE ALLOCATIONS BY BUILDER (sampling heap profile, script eval + build + ${bt.settleFrames} frames; ${a.totalMB} MB sampled, V8 heap only)`);
  a.byBuilder.slice(0, 10).forEach((x) => o.push(`   ${pad(x.k, 52)} ${lpad(x.MB.toFixed(1), 7)}`));
  o.push("   top allocation sites:");
  a.bySite.slice(0, 10).forEach((x) => o.push(`   ${pad(x.k, 70)} ${lpad(x.MB.toFixed(1), 7)}`));
  const g = R.gpu, T = g.tot;
  o.push(`\n-- B. GPU BY OWNER (walk ${f1(MB(T.gpu))} MB of GL ${f1(MB(g.gl.total))} MB; unattributed ${f1(MB(g.gl.total - T.gpu))} = render targets/shadow/drawing buffer/orphans; three.info geo ${g.info && g.info.geometries} tex ${g.info && g.info.textures})`);
  o.push(`   flags: cpuHeld static ${f1(MB(T.cpuStatic))} MB (dynamic ${f1(MB(T.cpuDyn))}) | hidden-but-resident ${f1(MB(T.hidden))} | far>${FAR}m ${f1(MB(T.far))} | JS-only never drawn ${f1(MB(T.notUp))} (of it hidden ${f1(MB(T.notUpHidden))}) | dup buffers ${f1(MB(g.dupBytes))} | tex sources kept ${f1(MB(T.srcKept))}`);
  o.push("   owner                                      gpuMB   geo   tex cpuHeld hidden   far jsOnly meshes   inst  ktris");
  Object.entries(g.owners).sort((x, y) => (y[1].gpu + y[1].notUp) - (x[1].gpu + x[1].notUp)).slice(0, TOP).forEach(([k, v]) =>
    o.push(`   ${pad(k, 40)} ${lpad(f1(MB(v.gpu)), 7)} ${lpad(f1(MB(v.geo)), 5)} ${lpad(f1(MB(v.tex)), 5)} ${lpad(f1(MB(v.cpuStatic)), 7)} ${lpad(f1(MB(v.hidden)), 6)} ${lpad(f1(MB(v.far)), 5)} ${lpad(f1(MB(v.notUp)), 6)} ${lpad(v.meshes, 6)} ${lpad(v.instances, 6)} ${lpad(Math.round(v.tris / 1000), 6)}`));
  o.push("   biggest geometries (owner | name | MB | cpu-held MB | users | state):");
  g.big.slice(0, 10).forEach((x) => o.push(`   ${pad(x[0], 28)} ${pad(x[1], 30)} ${lpad(f1(MB(x[2])), 6)} ${lpad(f1(MB(x[3])), 6)} ${lpad(x[4], 5)} ${x[5]}`));
  if (g.dups.length) { o.push("   duplicate uploads (label | copies | MB each | wasted MB | owners):"); g.dups.slice(0, 8).forEach((x) => o.push(`   ${pad(x[0], 36)} ${lpad(x[1], 4)} ${lpad(f1(MB(x[2])), 6)} ${lpad(f1(MB(x[3])), 6)}  ${x[4].slice(0, 60)}`)); }
  o.push("   biggest textures (owner | name | size | gpuMB | uploaded | source kept MB):");
  g.tex.slice(0, 8).forEach((x) => o.push(`   ${pad(x[0], 28)} ${pad(x[1], 26)} ${pad(x[2], 12)} ${lpad(f1(MB(x[3])), 6)} ${x[4] ? "up" : "NO"} ${lpad(f1(MB(x[5])), 6)}`));
  if (g.rts.length) o.push("   render targets: " + g.rts.map((x) => `${x[0]} ${x[1]} ${f1(MB(x[2]))}MB`).join(", "));
  if (R.leak) {
    const L = R.leak, d = L.diff || { clusters: [] };
    o.push(`\n-- C. LEAKS WHILE MOVING (${L.stops.length} stops and home): heap ${f1(L.heapBeforeMB)} -> ${f1(L.heapAfterMB)} MB; objects born on the trip and still alive: ${d.newObjects} (${d.newMB} MB)`);
    o.push(`   phone ${L.memBefore.phoneMB} -> ${L.memAfter.phoneMB} MB | GL ${f1(MB(L.glBefore.total))} -> ${f1(MB(L.glAfter.total))} MB (buffers ${L.glBefore.nbuf}->${L.glAfter.nbuf}, textures ${L.glBefore.ntex}->${L.glAfter.ntex}) | three geo ${L.infoBefore && L.infoBefore.geometries}->${L.infoAfter && L.infoAfter.geometries} tex ${L.infoBefore && L.infoBefore.textures}->${L.infoAfter && L.infoAfter.textures}`);
    d.clusters.slice(0, 12).forEach((c) => o.push(`   ${lpad(c.MB.toFixed(2), 7)} MB ${lpad(c.n, 6)}x  ${pad(c.owner, 24)} ${pad(c.cls, 26)} ${c.path}`));
    if (L.gpuByOwner.length) o.push("   GPU change by owner: " + L.gpuByOwner.slice(0, 8).map(([k, v]) => `${k} ${v.gpuMB >= 0 ? "+" : ""}${v.gpuMB}MB/${v.meshes >= 0 ? "+" : ""}${v.meshes}`).join(", "));
  }
  o.push(`\n-- D. BOOT BY BUILDER (startRun ${bt.startRunMs} ms; CPU profile ${bt.cpu.totalMs} ms sampled)`);
  bt.builders.slice(0, 12).forEach((x) => o.push(`   ${pad(x.k, 44)} ${lpad(x.ms, 6)} ms`));
  o.push("   bootStep phases:"); bt.phases.slice(0, 8).forEach((x) => o.push(`   ${pad(x.k, 44)} ${lpad(x.ms, 6)} ms`));
  o.push("   top self time:"); bt.cpu.self.slice(0, 12).forEach((x) => o.push(`   ${lpad(x.ms, 6)} ms  ${x.k}`));
  o.push("   self time by file:"); bt.cpu.byFile.slice(0, 8).forEach((x) => o.push(`   ${lpad(x.ms, 6)} ms  ${x.k}`));
  if (R.errors && R.errors.length) o.push("\npage errors: " + R.errors.join(" | "));
  console.log(o.join("\n"));
}

/* big snapshots need a big node heap: re-exec once with room */
if (!process.env.MEMSCOPE_LIB && v8.getHeapStatistics().heap_size_limit < 6e9 && !process.env.MEMSCOPE_CHILD) {
  const r = spawn(process.execPath, ["--max-old-space-size=8000", fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: "inherit", env: { ...process.env, MEMSCOPE_CHILD: "1" } });
  r.on("exit", (c) => process.exit(c == null ? 1 : c));
} else if (!process.env.MEMSCOPE_LIB) main().catch((e) => { console.error("[memscope] " + (e && e.stack || e)); if (/crash/.test(String(e))) console.error("chrome stderr tail:\n" + CHROME_ERR.join("").split("\n").slice(-25).join("\n")); cleanup(); process.exit(1); });
