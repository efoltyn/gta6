#!/usr/bin/env node
/* ============================================================
   tools/world-hash.mjs — IS THE WORLD STILL THE SAME WORLD?

   Builds a mode headlessly (CBZ.startRun, no frames) and fingerprints what
   the build produced, so a speed change to the world builders can be proven
   BIT-IDENTICAL instead of eyeballed:

     scene    every object under CBZ.scene: path, matrixWorld, geometry
              attributes (position/normal/uv/color/index, exact float bits),
              instance matrices/colors, material colour + flags. One hash per
              top-level child, so a diff names the subtree that moved.
     fields   the height/water functions sampled on a grid over the world
              (terrainHeight, cityGroundHeightAt, groundAt, countryTerrain-
              HeightAt, citySeaBedY, cityWaterAt, cityWaterDepthAt, ...).
     colliders CBZ.colliders boxes.

   Math.random is replaced by a seeded PRNG in the page, so code that still
   rolls dice at build time hashes the same run to run (the game's own seeded
   streams are untouched).

     node tools/world-hash.mjs                     # this checkout, city
     node tools/world-hash.mjs --ref origin/main   # another commit (git archive)
     node tools/world-hash.mjs --modes city,escape --out a.json
     node tools/world-hash.mjs --against a.json    # exit 3 if anything differs
     node tools/world-hash.mjs --profile b.cpuprofile   # + V8 profile of the build

   Holds /tmp/cbz-speed.lock like tools/speed.mjs.
============================================================ */
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT0 = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const MODES = opt("--modes", "city").split(",");
const REF = opt("--ref", "");
const OUT = opt("--out", "");
const AGAINST = opt("--against", "");
const SEED = opt("--seed", "90210");
const GRID = +opt("--grid", 181);
const PROF = opt("--profile", "");   // write a .cpuprofile of the build (CBZ.startRun) here
const LOCK = "/tmp/cbz-speed.lock";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } }
async function takeLock() {
  let told = false;
  for (;;) {
    try { fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, started: Date.now(), cmd: "world-hash.mjs " + argv.join(" ") }), { flag: "wx" }); return; }
    catch (e) {
      if (e.code !== "EEXIST") throw e;
      let cur = null; try { cur = JSON.parse(fs.readFileSync(LOCK, "utf8")); } catch (_) {}
      if (cur && typeof cur !== "object") cur = { pid: cur };
      let pid = cur && +cur.pid, born = cur && (+cur.started || Date.parse(cur.at || "") || 0);
      if (!born) { try { born = fs.statSync(LOCK).mtimeMs; } catch (_) { born = 0; } }
      if ((pid && !pidAlive(pid)) || Date.now() - born > 30 * 60 * 1000) { try { fs.unlinkSync(LOCK); } catch (_) {} continue; }
      if (!told) { process.stderr.write(`[world-hash] waiting for ${LOCK} (pid ${pid})\n`); told = true; }
      await sleep(2000);
    }
  }
}
function releaseLock() { try { const cur = JSON.parse(fs.readFileSync(LOCK, "utf8")); if (cur.pid === process.pid) fs.unlinkSync(LOCK); } catch (_) {} }

let ROOT = ROOT0, tmp = null;
if (REF) {
  const sha = execFileSync("git", ["rev-parse", REF], { cwd: ROOT0, encoding: "utf8" }).trim();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cbz-whash-"));
  execFileSync("sh", ["-c", `git archive ${sha} | tar -x -C ${JSON.stringify(tmp)}`], { cwd: ROOT0 });
  ROOT = tmp;
}
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".wasm": "application/wasm", ".glb": "model/gltf-binary", ".bin": "application/octet-stream" };
function startServer(root) {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
    const f = path.join(root, path.normalize(p).replace(/^(\.\.[/\\])+/, ""));
    fs.readFile(f, (err, buf) => { if (err) { res.writeHead(404); return res.end(); } res.writeHead(200, { "Content-Type": MIME[path.extname(f).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" }); res.end(buf); });
  });
  return new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv)));
}
const CHROME = process.env.CBZ_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
async function launch() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "cbz-whash-chrome-"));
  const proc = spawn(CHROME, ["--headless=new", "--no-sandbox", "--ignore-gpu-blocklist", "--enable-webgl", "--mute-audio", "--window-size=1512,982",
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--no-first-run", "--disable-extensions",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  const wsUrl = await new Promise((res, rej) => { let b = ""; proc.stderr.on("data", (d) => { b += d; const m = b.match(/DevTools listening on (ws:\/\/\S+)/); if (m) res(m[1]); }); proc.on("exit", () => rej(new Error("chrome exited"))); });
  const ws = new WebSocket(wsUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id != null && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const mid = ++id; pend.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params, ...(sessionId ? { sessionId } : {}) })); });
  return { send, close() { try { ws.close(); } catch (_) {} try { proc.kill("SIGKILL"); } catch (_) {} try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {} } };
}

const PRELOAD = String.raw`(function(){ if (window.top !== window) return;
  var a = 0x9e3779b9; Math.random = function(){ a = (a + 0x6d2b79f5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
})();`;

const HASH = String.raw`(function(GRID){
  var C = window.CBZ;
  function H(){ this.h1 = 0x811c9dc5 | 0; this.h2 = 0x2545f491 | 0; this.n = 0; }
  H.prototype.i = function(v){ v |= 0; this.h1 = Math.imul(this.h1 ^ v, 16777619); this.h2 = Math.imul(this.h2 ^ ((v << 7) | (v >>> 25)), 0x5bd1e995); this.n++; };
  var f64 = new Float64Array(1), u32 = new Uint32Array(f64.buffer);
  H.prototype.f = function(v){ if (v == null) { this.i(0x7fff0001); return; } f64[0] = +v; this.i(u32[0]); this.i(u32[1]); };
  H.prototype.s = function(str){ str = String(str); for (var k = 0; k < str.length; k++) this.i(str.charCodeAt(k)); this.i(-1); };
  H.prototype.arr = function(a){ if (!a) { this.i(-2); return; } this.i(a.length);
    var u = new Uint32Array(a.buffer, a.byteOffset, (a.byteLength >> 2)); for (var k = 0; k < u.length; k++) this.i(u[k]); };
  H.prototype.hex = function(){ return ((this.h1 >>> 0).toString(16).padStart(8, "0")) + ((this.h2 >>> 0).toString(16).padStart(8, "0")); };
  var out = { scene: {}, fields: {}, counts: {} };
  var scene = C.scene; scene.updateMatrixWorld(true);
  var geoCache = new Map();
  function geoHash(g){ if (geoCache.has(g)) return geoCache.get(g); var h = new H();
    var at = g.attributes || {}; Object.keys(at).sort().forEach(function(k){ h.s(k); var A = at[k]; h.i(A.itemSize || 0); h.arr(A.array || (A.data && A.data.array)); });
    if (g.index) { h.s("index"); h.arr(g.index.array); }
    if (g.drawRange) { h.f(g.drawRange.start); h.f(g.drawRange.count); }
    (g.groups || []).forEach(function(gr){ h.f(gr.start); h.f(gr.count); h.f(gr.materialIndex); });
    var r = h.hex(); geoCache.set(g, r); return r; }
  function matHash(h, m){ if (!m) { h.i(-3); return; } if (Array.isArray(m)) { m.forEach(function(x){ matHash(h, x); }); return; }
    h.s(m.type); ["color","emissive","specular"].forEach(function(k){ if (m[k] && m[k].isColor) { h.f(m[k].r); h.f(m[k].g); h.f(m[k].b); } });
    ["opacity","roughness","metalness","emissiveIntensity","side","transparent","vertexColors","flatShading","alphaTest","depthWrite"].forEach(function(k){ if (m[k] != null) h.f(+m[k]); });
    ["map","normalMap","roughnessMap","emissiveMap","alphaMap","bumpMap"].forEach(function(k){ var t = m[k]; if (t) { var im = t.image; h.s(k); h.f(im && im.width); h.f(im && im.height); h.f(t.repeat && t.repeat.x); h.f(t.repeat && t.repeat.y); h.f(t.offset && t.offset.x); h.f(t.offset && t.offset.y); } }); }
  var nObj = 0, nVert = 0;
  function walk(o, h, p){ nObj++; h.s(p + "|" + o.type + "|" + (o.name || "")); h.i(o.visible ? 1 : 0);
    var e = o.matrixWorld.elements; for (var k = 0; k < 16; k++) h.f(e[k]);
    if (o.geometry) { h.s(geoHash(o.geometry)); var pa = o.geometry.attributes && o.geometry.attributes.position; if (pa) nVert += pa.count; }
    if (o.material) matHash(h, o.material);
    if (o.isInstancedMesh) { h.i(o.count); h.arr(o.instanceMatrix.array.subarray(0, o.count * 16)); if (o.instanceColor) h.arr(o.instanceColor.array.subarray(0, o.count * 3)); }
    for (var c = 0; c < o.children.length; c++) walk(o.children[c], h, p + "/" + c); }
  var tot = new H();
  for (var t = 0; t < scene.children.length; t++) { var ch = scene.children[t]; var h = new H(); walk(ch, h, "" + t);
    var key = t + ":" + ch.type + ":" + (ch.name || "") ; out.scene[key] = h.hex(); tot.s(key); tot.s(h.hex()); }
  out.counts.objects = nObj; out.counts.vertices = nVert;
  out.sceneTotal = tot.hex();
  // fields
  var P = C.CONTINENT_PLATE || { minX: -6000, maxX: 6000, minZ: -6000, maxZ: 6000 };
  var pad = 800, x0 = P.minX - pad, x1 = P.maxX + pad, z0 = P.minZ - pad, z1 = P.maxZ + pad;
  var names = ["terrainHeight","terrainVisualHeight","cityGroundHeightAt","groundAt","countryTerrainHeightAt","countryReliefAt","citySeaBedY","citySeaBedDepth","cityWaterAt","cityWaterDepthAt","cityNavWaterAt","citySeaHeightAt","groundWaterAt","terrainRangeMask"];
  names.forEach(function(nm){ var fn = C[nm]; if (typeof fn !== "function") return; var h = new H(), bad = 0;
    for (var i = 0; i < GRID; i++) for (var j = 0; j < GRID; j++) { var x = x0 + (x1 - x0) * (i + 0.37) / GRID, z = z0 + (z1 - z0) * (j + 0.61) / GRID;
      var v; try { v = fn(x, z); } catch (e) { v = null; bad++; }
      if (typeof v === "boolean") h.i(v ? 1 : 0); else if (typeof v === "number" || v == null) h.f(v); else if (typeof v === "object") { h.s(JSON.stringify(v)); } }
    out.fields[nm] = h.hex() + (bad ? " (" + bad + " threw)" : ""); });
  var cl = C.colliders || [], hc = new H(); cl.forEach(function(c){ ["minX","maxX","minZ","maxZ","y0","y1","h","top"].forEach(function(k){ hc.f(c[k]); }); });
  out.colliders = hc.hex(); out.counts.colliders = cl.length;
  return out;
})`;

await takeLock();
const WATCHDOG = setTimeout(() => { process.stderr.write("[world-hash] watchdog: 240 s under the lock, giving up\n"); try { B && B.close(); } catch (_) {} releaseLock(); process.exit(5); }, 240000);
let srv, B;
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { try { B && B.close(); } catch (_) {} releaseLock(); process.exit(130); });
const results = {};
try {
  srv = await startServer(ROOT);
  const base = `http://127.0.0.1:${srv.address().port}/`;
  B = await launch();
  for (const m of MODES) {
    const { browserContextId } = await B.send("Target.createBrowserContext", { disposeOnDetach: true });
    const { targetId } = await B.send("Target.createTarget", { url: "about:blank", browserContextId });
    const { sessionId } = await B.send("Target.attachToTarget", { targetId, flatten: true });
    const s = (mm, p) => B.send(mm, p, sessionId);
    await s("Page.enable"); await s("Runtime.enable");
    await s("Page.addScriptToEvaluateOnNewDocument", { source: PRELOAD });
    const ev = async (expression) => { const r = await s("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text).slice(0, 500)); return r.result.value; };
    await s("Page.navigate", { url: `${base}index.html?mode=${m}&seed=${SEED}` });
    const t0 = Date.now();
    for (;;) { let ok = false; try { ok = await ev("!!(window.CBZ && CBZ.bootComplete && CBZ.startRun && document.readyState === 'complete')"); } catch (_) {} if (ok) break; if (Date.now() - t0 > 240000) throw new Error("boot timeout"); await sleep(100); }
    if (PROF) { await s("Profiler.enable"); await s("Profiler.setSamplingInterval", { interval: 250 }); await s("Profiler.start"); }
    const bt = await ev("(function(){ var t = performance.now(); CBZ.startRun(); return performance.now() - t; })()");
    if (PROF) { const { profile } = await s("Profiler.stop"); fs.writeFileSync(MODES.length > 1 ? PROF.replace(/(\.cpuprofile)?$/, "." + m + ".cpuprofile") : PROF, JSON.stringify(profile)); }
    const th = Date.now();
    const r = await ev(HASH + "(" + GRID + ")");
    r.hashS = (Date.now() - th) / 1000; r.bootS = (th - t0) / 1000;
    r.buildMs = Math.round(bt);
    results[m] = r;
    process.stderr.write(`[world-hash] ${m}: scene ${r.sceneTotal} (${r.counts.objects} obj, ${r.counts.vertices} verts), build ${r.buildMs} ms (boot+build ${r.bootS}s, hash ${r.hashS}s)\n`);
    try { await B.send("Target.closeTarget", { targetId }); await B.send("Target.disposeBrowserContext", { browserContextId }); } catch (_) {}
  }
} finally {
  try { B && B.close(); } catch (_) {}
  try { srv && srv.close(); } catch (_) {}
  releaseLock(); clearTimeout(WATCHDOG);
  if (tmp) try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
}
if (OUT) fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
let diffs = 0;
if (AGAINST) {
  const A = JSON.parse(fs.readFileSync(AGAINST, "utf8"));
  for (const m of Object.keys(results)) {
    const a = A[m], b = results[m]; if (!a) { console.log(`${m}: not in ${AGAINST}`); continue; }
    const cmp = (label, x, y) => { const keys = new Set([...Object.keys(x || {}), ...Object.keys(y || {})]); for (const k of keys) if ((x || {})[k] !== (y || {})[k]) { diffs++; console.log(`  DIFF ${m} ${label} ${k}: ${(x || {})[k]} -> ${(y || {})[k]}`); } };
    cmp("scene", a.scene, b.scene); cmp("field", a.fields, b.fields);
    if (a.colliders !== b.colliders) { diffs++; console.log(`  DIFF ${m} colliders ${a.colliders} -> ${b.colliders}`); }
    console.log(`${m}: ${diffs ? "DIFFERENT" : "IDENTICAL"} (scene ${b.sceneTotal}, ${Object.keys(b.fields).length} fields, ${b.counts.colliders} colliders; build ${a.buildMs} -> ${b.buildMs} ms)`);
  }
} else for (const m of Object.keys(results)) console.log(`${m}: scene ${results[m].sceneTotal} fields ${JSON.stringify(results[m].fields)} colliders ${results[m].colliders}`);
process.exit(diffs ? 3 : 0);
