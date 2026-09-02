#!/usr/bin/env node
/* ============================================================
   tools/load-profile.mjs — THE LOAD-COST INSTRUMENT.

   Every other gate on the shelf measures the world once it EXISTS. This one
   measures what it costs to get there, which is the number the owner feels on
   a phone. Four phases, each printed with its own numbers:

     1. BOOT   — navigate, wait for the load event. Reports request count,
                 bytes on the wire, and V8 ScriptDuration at DOMContentLoaded
                 (i.e. how long parsing+compiling+running the ~467 classic
                 script tags actually took).
     2. BUILD  — calls CBZ.startRun() and times it. This is one synchronous
                 main-thread task; the number it prints is how long the tab is
                 FROZEN. Optionally breaks it down per landmass builder.
     3. FRAME  — how long after the build before renderer.info.render.calls
                 goes non-zero (shader compile + first upload).
     4. WEIGHT — scene object count, geometries, textures, JS heap, and every
                 request the PLAY press issued (so a new multi-MB asset on the
                 critical path shows up as a line item, not a mystery).

   Usage:
     node tools/load-profile.mjs                      # index.html, full run
     node tools/load-profile.mjs --builders           # + per-builder ms
     node tools/load-profile.mjs --cpu 4              # throttle CPU 4x (phone-ish)
     node tools/load-profile.mjs --profile            # + V8 CPU profile of the build (by file AND by function)
     node tools/load-profile.mjs --profile --profile-out build.cpuprofile   # keep the raw profile too
     node tools/load-profile.mjs --url /games/casino.html --no-build
     node tools/load-profile.mjs --cfg CITY_BOOT_SCREEN=0     # A/B a build flag

   WHY --cfg AND NOT A LIVE TOGGLE: build-time flags are read while the world
   is generated, so flipping one after boot proves nothing (scrolls/claude/
   verification.md). Every --cfg becomes a ?cfg_NAME=VALUE on the URL.

   NOTE ON THE NUMBERS: this runs SwiftShader, so anything GPU-side (the FRAME
   phase, and getProgramParameter inside --profile) is inflated well past a
   real GPU. CPU-side JS — the BUILD number, the per-builder table, byte counts
   and request counts — is honest. Compare runs, don't quote one in isolation.
============================================================ */
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : dflt;
};
const cfgs = argv.reduce((a, v, i) => (argv[i - 1] === "--cfg" ? a.concat(v) : a), []);
const PAGE = opt("--url", "/index.html");
const CPU = Math.max(1, Number(opt("--cpu", 1)) || 1);
const DO_BUILD = !flag("--no-build");
const DO_BUILDERS = flag("--builders");
const DO_PROFILE = flag("--profile");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Port discipline copied from tools/smoke-play.mjs: probe first, re-roll if
// something already answers, so a concurrent session's server/browser is never
// silently adopted. Windows here are disjoint from smoke-play's.
async function claimPort(lo, span, probe) {
  for (let t = 0; t < 8; t++) {
    const p = lo + Math.floor(Math.random() * span);
    try { await probe(p); } catch (_) { return p; }
  }
  console.error("FAIL: no free port near " + lo);
  process.exit(1);
}
const httpPort = await claimPort(8300, 200, (p) => fetch(`http://127.0.0.1:${p}/`));
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], {
  env: { ...process.env, PORT: String(httpPort) }, stdio: "ignore",
});
const base = `http://127.0.0.1:${httpPort}`;
let up = false;
for (let i = 0; i < 60 && !up; i++) { try { await fetch(base); up = true; } catch (_) { await sleep(100); } }
if (!up) { console.error("FAIL: devserver never came up on :" + httpPort); server.kill("SIGTERM"); process.exit(1); }

const dbg = await claimPort(10300, 250, (p) => fetch(`http://127.0.0.1:${p}/json/version`));
const profileDir = `/tmp/cbz-loadprofile-${dbg}`;
await rm(profileDir, { recursive: true, force: true });
// macOS (the owner's machine) has no /opt/pw-browsers — same resolution every
// other tool on the shelf uses. See scrolls/claude/verification.md.
const CHROME = process.env.CBZ_CHROME ||
  (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/opt/pw-browsers/chromium");
const query = cfgs.map((c) => {
  const [k, v] = c.split("=");
  return `cfg_${encodeURIComponent(k)}=${encodeURIComponent(v == null ? "1" : v)}`;
}).join("&");
const url = base + PAGE + (query ? (PAGE.includes("?") ? "&" : "?") + query : "");

const chrome = spawn(CHROME, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--enable-webgl", "--mute-audio", "--window-size=800,500",
  "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
  "--disable-background-networking", "--disable-component-update",
  "--no-first-run", "--no-default-browser-check", "--disable-extensions",
  `--remote-debugging-port=${dbg}`, `--user-data-dir=${profileDir}`, "about:blank",
], { stdio: "ignore" });

function bail(msg, code = 1) {
  console.error(msg);
  try { chrome.kill("SIGKILL"); } catch (_) {}
  try { server.kill("SIGTERM"); } catch (_) {}
  process.exit(code);
}

let target = null;
for (let i = 0; i < 100 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json()).find((t) => t.type === "page"); }
  catch (_) { /* browser still starting */ }
  if (!target) await sleep(200);
}
if (!target) bail("FAIL: chromium never exposed a page target");

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let nextId = 1;
const pending = new Map();
const events = [];
const consoleErrors = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (!msg.method) return;
  events.push(msg);
  if (msg.method === "Runtime.exceptionThrown") {
    const d = msg.params.exceptionDetails || {};
    // .text is usually the useless "Uncaught (in promise)" wrapper — the real
    // cause lives on the thrown value.
    const ex = d.exception || {};
    consoleErrors.push(String(ex.description || ex.className || ex.value || d.text || "exception")
      .split("\n")[0].slice(0, 160));
  }
};
function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => {
    pending.set(id, (m) => (m.error ? rej(new Error(method + ": " + m.error.message)) : res(m.result)));
    setTimeout(() => rej(new Error("timeout " + method)), 900000);
  });
}
async function evl(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, timeout: 900000 });
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text);
  return r.result.value;
}
const metrics = async () => (await send("Performance.getMetrics")).metrics
  .reduce((a, m) => ((a[m.name] = m.value), a), {});

await send("Network.enable");
// Google Fonts is unreachable from the sandbox and would otherwise add a flat
// ~14 s hang to DCL in every game equally — noise, not signal.
await send("Network.setBlockedURLs", { urls: ["*fonts.googleapis.com*", "*fonts.gstatic.com*"] });
await send("Page.enable");
await send("Runtime.enable");
// Without this, getMetrics returns an empty set and every counter reads 0.
await send("Performance.enable");
if (DO_PROFILE) { await send("Profiler.enable"); await send("Profiler.setSamplingInterval", { interval: 500 }); }
if (CPU > 1) await send("Emulation.setCPUThrottlingRate", { rate: CPU });

// ---------------------------------------------------------------- 1. BOOT
const t0 = Date.now();
await send("Page.navigate", { url });
let loaded = null;
for (let i = 0; i < 6000 && loaded == null; i++) {
  if (events.some((e) => e.method === "Page.loadEventFired")) loaded = Date.now() - t0;
  else await sleep(50);
}
const bootMetrics = await metrics();
// bootComplete is main.js's last act; without it a start would build a partial
// world (see the comment in src/main.js).
let booted = false;
for (let i = 0; i < 600 && !booted; i++) {
  booted = !!(await evl("!!(window.CBZ && CBZ.bootComplete)"));
  if (!booted) await sleep(100);
}
const netAtBoot = tallyNetwork();
const bootReqs = netAtBoot.count;

// Byte accounting is per-request and takes the LARGER of the two sources
// Chrome offers. loadingFinished.encodedDataLength is the tidy total for small
// responses but comes back 0 for large streamed ones (the 64.8 MB GLB was
// silently counted as zero until this was fixed) — those only ever report
// through the incremental dataReceived events.
function tallyNetwork() {
  const urls = [];
  const streamed = new Map();
  const finished = new Map();
  for (const e of events) {
    if (e.method === "Network.requestWillBeSent") urls.push(e.params.request.url);
    else if (e.method === "Network.dataReceived") {
      streamed.set(e.params.requestId, (streamed.get(e.params.requestId) || 0) + (e.params.encodedDataLength || 0));
    } else if (e.method === "Network.loadingFinished") {
      finished.set(e.params.requestId, e.params.encodedDataLength || 0);
    }
  }
  let bytes = 0;
  for (const id of new Set([...streamed.keys(), ...finished.keys()])) {
    bytes += Math.max(streamed.get(id) || 0, finished.get(id) || 0);
  }
  return { count: urls.length, bytes, urls, perRequest: { streamed, finished } };
}
function requestBytes(id, t) { return Math.max(t.perRequest.streamed.get(id) || 0, t.perRequest.finished.get(id) || 0); }
const fmtMB = (b) => (b / 1048576).toFixed(1) + " MB";
const line = (k, v) => console.log("  " + String(k).padEnd(34) + v);

console.log(`\nLOAD PROFILE — ${url}${CPU > 1 ? `  (CPU throttled ${CPU}x)` : ""}`);
console.log("\n1. BOOT (page open → title screen)");
line("time to load event", (loaded == null ? "never" : loaded + " ms"));
// FIRST PAINT is the number `defer` moves: with 569 render-blocking classic
// tags the title card could not paint until every script had run; deferred,
// the HTML paints first and the scripts run behind it. The load event is the
// same either way, so it cannot see the difference — this line can.
try {
  const paint = JSON.parse(await evl("JSON.stringify((performance.getEntriesByType('paint')||[]).map(e=>[e.name,Math.round(e.startTime)]))"));
  const fcp = (paint.find((e) => e[0] === "first-contentful-paint") || [])[1];
  line("first contentful paint", fcp == null ? "none recorded" : fcp + " ms");
} catch (_) {}
line("bootComplete reached", booted ? "yes" : "NO — main.js never ran");
line("requests", bootReqs);
line("bytes on the wire", fmtMB(netAtBoot.bytes));
line("V8 ScriptDuration (parse+run)", (bootMetrics.ScriptDuration || 0).toFixed(2) + " s");
line("JS heap", ((bootMetrics.JSHeapUsedSize || 0) / 1048576).toFixed(1) + " MB");

// --------------------------------------------------------------- 2. BUILD
let buildMs = null, builderRows = null, cpuTop = null, cpuFns = null;
if (DO_BUILD && booted) {
  if (DO_BUILDERS) {
    // Wrapping costs a little time itself; the table is for RANKING builders,
    // not for quoting an absolute per-builder ms.
    await evl(`(()=>{window.__lp=[];
      for (const b of (CBZ._landmassBuilders||[])) {
        const orig=b.fn, name=orig.name||('anon@order'+b.order);
        b.fn=function(){const t=performance.now();
          try{return orig.apply(this,arguments);}
          finally{window.__lp.push({name,order:b.order,ms:+(performance.now()-t).toFixed(1)});}};
      }})()`);
  }
  if (DO_PROFILE) await send("Profiler.start");
  buildMs = await evl(`(()=>{const t=performance.now();CBZ.startRun();return +(performance.now()-t).toFixed(1);})()`);
  if (DO_PROFILE) {
    const { profile } = await send("Profiler.stop");
    cpuTop = summarizeProfile(profile);
    cpuFns = summarizeProfileFns(profile);
    // --profile-out FILE: keep the raw .cpuprofile (open it in DevTools >
    // Performance > Load profile, or feed it to a script) — the two tables
    // below are a summary, and a summary is where the next question dies.
    const outPath = opt("--profile-out", null);
    if (outPath) { const { writeFile } = await import("node:fs/promises"); await writeFile(outPath, JSON.stringify(profile)); }
  }
  if (DO_BUILDERS) builderRows = JSON.parse(await evl("JSON.stringify(window.__lp||[])"));

  console.log("\n2. BUILD (CBZ.startRun — ONE synchronous task; the tab is frozen for all of it)");
  line("world build", buildMs + " ms");
  line("state / mode", await evl("CBZ.game.state + ' / ' + CBZ.game.mode"));
  if (builderRows) {
    builderRows.sort((a, b) => b.ms - a.ms);
    console.log("\n   landmass builders, slowest first (top 12 of " + builderRows.length + "):");
    for (const r of builderRows.slice(0, 12)) {
      console.log("     " + String(r.ms).padStart(8) + " ms   order " + String(r.order).padEnd(6) + r.name);
    }
    const rest = builderRows.slice(12).reduce((a, r) => a + r.ms, 0);
    if (rest > 0) console.log("     " + String(rest.toFixed(1)).padStart(8) + " ms   (the other " + (builderRows.length - 12) + ")");
  }
  if (cpuTop) {
    console.log("\n   CPU profile of the build — self time by file (top 12):");
    for (const r of cpuTop.slice(0, 12)) {
      console.log("     " + String(r.ms).padStart(8) + " ms  " + String(r.pct + "%").padStart(6) + "  " + r.what);
    }
    console.log("     (SwiftShader: getProgramParameter/bufferData are GPU-driver lines, inflated here)");
  }
  if (cpuFns) {
    console.log("\n   CPU profile of the build — self time by FUNCTION (top 25, JS only):");
    for (const r of cpuFns.slice(0, 25)) {
      console.log("     " + String(r.ms).padStart(8) + " ms  " + String(r.pct + "%").padStart(6) + "  " + r.what);
    }
  }
}

// Same samples, keyed by function instead of file — names the loop, not the
// module. Native frames (GC, GPU driver) are dropped so the JS work is
// readable; the by-file table above still shows the native share.
function summarizeProfileFns(profile) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const hits = new Map();
  for (const id of profile.samples) hits.set(id, (hits.get(id) || 0) + 1);
  const total = profile.samples.length || 1;
  const perSample = ((profile.endTime - profile.startTime) / 1000) / total;
  const byFn = new Map();
  for (const [id, n] of hits) {
    const node = byId.get(id);
    if (!node || !node.callFrame.url) continue;
    const cf = node.callFrame;
    const f = cf.url.replace(/^https?:\/\/[^/]+\//, "").replace(/\?.*$/, "");
    const key = (cf.functionName || "(anonymous)") + "  " + f + ":" + (cf.lineNumber + 1);
    byFn.set(key, (byFn.get(key) || 0) + n);
  }
  return [...byFn.entries()].sort((a, b) => b[1] - a[1])
    .map(([what, n]) => ({ what, ms: Math.round(n * perSample), pct: +((n / total) * 100).toFixed(1) }));
}

function summarizeProfile(profile) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const hits = new Map();
  for (const id of profile.samples) hits.set(id, (hits.get(id) || 0) + 1);
  const total = profile.samples.length || 1;
  const perSample = ((profile.endTime - profile.startTime) / 1000) / total;
  const byFile = new Map();
  for (const [id, n] of hits) {
    const node = byId.get(id);
    if (!node) continue;
    const f = (node.callFrame.url || "(native)").replace(/^https?:\/\/[^/]+\//, "").replace(/\?.*$/, "");
    byFile.set(f, (byFile.get(f) || 0) + n);
  }
  return [...byFile.entries()].sort((a, b) => b[1] - a[1])
    .map(([what, n]) => ({ what, ms: Math.round(n * perSample), pct: +((n / total) * 100).toFixed(1) }));
}

// --------------------------------------------------------------- 3. FRAME
if (DO_BUILD && booted) {
  const tf = Date.now();
  let calls = 0;
  for (let i = 0; i < 300 && !calls; i++) {
    await sleep(500);
    calls = (await evl("(CBZ.renderer&&CBZ.renderer.info&&CBZ.renderer.info.render.calls)||0")) | 0;
  }
  console.log("\n3. FRAME (build end → first rendered frame; SwiftShader-inflated)");
  line("time to first frame", (Date.now() - tf) + " ms");
  line("draw calls", calls);
}

// -------------------------------------------------------------- 4. WEIGHT
if (booted) {
  const w = JSON.parse(await evl(`JSON.stringify((()=>{
    let objs=0, meshes=0, hidden=0, visMB=0, hidMB=0; const geos=new Set(), mats=new Set();
    const visUp=(o)=>{while(o){if(!o.visible)return false;o=o.parent;}return true;};
    const gb=(g)=>{let b=0;for(const k in g.attributes)b+=g.attributes[k].array.byteLength;if(g.index)b+=g.index.array.byteLength;return b;};
    if(CBZ.scene) CBZ.scene.traverse((o)=>{objs++; if(!(o.isMesh||o.isPoints||o.isLine))return; meshes++;
      const v=visUp(o); if(!v)hidden++;
      if(o.material){ if(Array.isArray(o.material))o.material.forEach(m=>mats.add(m)); else mats.add(o.material); }
      const g=o.geometry; if(!g||geos.has(g))return; geos.add(g); const b=gb(g); if(v)visMB+=b; else hidMB+=b; });
    const r=CBZ.renderer&&CBZ.renderer.info;
    return {objs, meshes, hidden, geosUnique:geos.size, mats:mats.size, visMB:+(visMB/1048576).toFixed(0), hidMB:+(hidMB/1048576).toFixed(0),
            programs:r&&r.programs?r.programs.length:0,
            tris:r?r.render.triangles:0, geo:r?r.memory.geometries:0, tex:r?r.memory.textures:0,
            colliders:(CBZ.colliders||[]).length};})())`));
  const after = tallyNetwork();
  const playUrls = after.urls.slice(bootReqs);
  const m2 = await metrics();
  console.log("\n4. WEIGHT");
  line("scene objects (Object3D)", w.objs.toLocaleString());
  line("triangles / geometries / textures", `${w.tris.toLocaleString()} / ${w.geo} / ${w.tex}`);
  // THE NUMBER THAT KILLS A PHONE: every visible geometry's attribute bytes sit
  // in the JS process AND get uploaded to the GPU as soon as it enters the
  // frustum. 2026-09-01 baseline: 1,165 MB visible — the tab died at "99%".
  line("meshes (hidden originals)", `${w.meshes.toLocaleString()} (${w.hidden.toLocaleString()} hidden)`);
  line("geometry bytes visible / hidden", `${w.visMB} MB / ${w.hidMB} MB across ${w.geosUnique.toLocaleString()} unique geometries`);
  line("unique materials / GL programs", `${w.mats.toLocaleString()} / ${w.programs}`);
  line("colliders", w.colliders.toLocaleString());
  line("JS heap", ((m2.JSHeapUsedSize || 0) / 1048576).toFixed(1) + " MB");
  line("total requests / bytes", `${after.count} / ${fmtMB(after.bytes)}`);
  if (playUrls.length) {
    const kinds = new Map();
    for (const u of playUrls) {
      const k = u.startsWith("data:") ? "data: URI" : (u.match(/\/(assets\/[a-z]+)\//) || [, "other"])[1];
      kinds.set(k, (kinds.get(k) || 0) + 1);
    }
    console.log("\n   requests issued by the PLAY press:");
    for (const [k, n] of [...kinds.entries()].sort((a, b) => b[1] - a[1])) {
      console.log("     " + String(n).padStart(5) + "  " + k);
    }
    // Anything multi-MB on the critical path is the headline, so name it.
    const big = [];
    for (const e of events) {
      if (e.method !== "Network.requestWillBeSent") continue;
      const n = requestBytes(e.params.requestId, after);
      if (n < 4 * 1048576) continue;
      // A request still in flight when we sampled has only its partial byte
      // count — say so rather than quoting a confident half-number.
      const done = after.perRequest.finished.has(e.params.requestId);
      big.push(`${fmtMB(n)}${done ? "" : " (still in flight — partial)"}  ${e.params.request.url.replace(base, "")}`);
    }
    big.sort((a, b) => parseFloat(b) - parseFloat(a));
    if (big.length) {
      console.log("\n   ASSETS OVER 4 MB ON THE BOOT PATH:");
      for (const b of big) console.log("     " + b);
    }
  }
}

if (consoleErrors.length) {
  // One ProgressEvent is the documented pre-existing baseline; anything else
  // is a real fault (scrolls/claude/verification.md).
  const tally = new Map();
  for (const e of consoleErrors) tally.set(e, (tally.get(e) || 0) + 1);
  console.log("\nPAGE EXCEPTIONS (" + consoleErrors.length + ", " + tally.size + " distinct):");
  for (const [e, n] of [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log("  " + String(n).padStart(4) + "x  " + e);
  }
}
console.log("");

ws.close();
chrome.kill("SIGKILL");
server.kill("SIGTERM");
await rm(profileDir, { recursive: true, force: true }).catch(() => {});
process.exit(0);
