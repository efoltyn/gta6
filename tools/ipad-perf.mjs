#!/usr/bin/env node
/* tools/ipad-perf.mjs — ONE boot of Gang Life as an iPad sees it, measured.

   Emulates the owner's iPad before navigation (1180x820 CSS viewport, DPR 2,
   touch with maxTouchPoints 5, iPadOS's desktop-Safari user agent, pointer
   coarse via tools/preload/ipad.js), clicks PLAY on the real title card, waits
   for the city to stop building, holds the tier the game chose, then:

     PHASE 1  drawing off (?cfg_RENDER_FRAMES=0), CPU throttled via CDP:
              per-frame JS sim cost (avg/p50/p95) and the heaviest systems.
     PHASE 2  drawing on, unthrottled: exact renderer.info calls/triangles
              (median of settled frames), drawing-buffer pixels, programs,
              shader light counts, shadow map, fog/cull, actors, JS heap,
              and where the in-view triangles are.

   WHY TWO PHASES. Headless draws through SwiftShader at 2-12 s a frame, so a
   "frame time" window yields 2 frames of software-raster noise and nothing
   about the JS. Split, the sim ms are real CPU ms (x throttle) and the render
   counters are exact; renderMsSwiftShader is only a relative raster proxy.

   Usage: node tools/ipad-perf.mjs [--url http://127.0.0.1:PORT/] [--throttle 4]
          [--seconds 8] [--json out.json] [--query "&cfg_X=1"]
   Without --url it serves this checkout on a free port. */
import { spawn } from "node:child_process";
import { rm, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const THROTTLE = +arg("--throttle", "4");
const SECONDS = +arg("--seconds", "8");
const OUT = arg("--json", "");
const QUERY = arg("--query", "");
const W = +arg("--width", "1180"), H = +arg("--height", "820"), DPR = +arg("--dpr", "2");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now(); const mark = (m) => console.error(`[t+${((Date.now() - T0) / 1000).toFixed(1)}s] ${m}`);

async function freePort(lo) { for (let t = 0; t < 20; t++) { const p = lo + Math.floor(Math.random() * 300); try { await fetch(`http://127.0.0.1:${p}/`); } catch (_) { return p; } } throw new Error("no port"); }

let origin = arg("--url", ""), server = null;
if (!origin) {
  const port = await freePort(9100);
  server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
  origin = `http://127.0.0.1:${port}/`;
  let up = false; for (let i = 0; i < 60 && !up; i++) { try { await fetch(origin); up = true; } catch (_) { await sleep(100); } }
  if (!up) { console.error("devserver down"); process.exit(1); }
}
const CHROME = process.env.CBZ_CHROME || (() => {
  const base = path.join(process.env.HOME, ".cache/puppeteer/chrome-headless-shell");
  return `${base}/mac_arm-141.0.7390.54/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
})();
const dbg = await freePort(11200);
const prof = path.join(process.env.TMPDIR || "/tmp", `cbz-ipadperf-${dbg}`);
await rm(prof, { recursive: true, force: true });
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--enable-webgl", "--ignore-gpu-blocklist", "--mute-audio", "--enable-precise-memory-info", `--window-size=${W},${H}`, `--remote-debugging-port=${dbg}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
const cleanup = () => { try { chrome.kill("SIGKILL"); } catch (_) {} try { server && server.kill("SIGKILL"); } catch (_) {} };
process.on("exit", cleanup);

let page = null;
for (let i = 0; i < 200 && !page; i++) { try { const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json(); page = ps.find((p) => p.type === "page"); } catch (_) {} if (!page) await sleep(100); }
if (!page) { console.error("no page"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
let id = 1; const pend = new Map(); const errors = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") errors.push(String(m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text).slice(0, 200));
});
const send = (method, params = {}) => new Promise((r) => { const i = id++; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expression, awaitPromise = false) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
  if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  return r.result && r.result.result && r.result.result.value;
};

await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: DPR, mobile: false });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15" });
await send("Page.addScriptToEvaluateOnNewDocument", { source: await readFile(path.join(ROOT, "tools/preload/ipad.js"), "utf8") });
await send("Page.navigate", { url: `${origin}?seed=90210&cfg_RENDER_FRAMES=0${QUERY}` });
mark(`nav ${origin} ${W}x${H}@${DPR} throttle ${THROTTLE}x`);


{ let ok = false; for (let i = 0; i < 600 && !ok; i++) { try { ok = !!(await evl("!!(window.CBZ && CBZ.game && CBZ.game.state==='title' && CBZ.setQualityPreset && document.getElementById('playBtn'))")); } catch (_) {} if (!ok) await sleep(200); } if (!ok) { console.error("no title"); process.exit(1); } }
const titleInfo = await evl(`({ level: CBZ.qualityLevel, auto: !!CBZ.qualityAuto, locked: !!CBZ.qualityLocked, device: CBZ.deviceClass || null,
  label: (document.querySelector('#qualityPreset .quality-preset-label')||{}).textContent,
  lit: [...document.querySelectorAll('#qualityPreset [data-quality-preset]')].filter(b=>b.classList.contains('active')).map(b=>b.dataset.qualityPreset).join(',') })`);
mark("title " + JSON.stringify(titleInfo));
// Hold the tier the device booted at: the frameless phases below are timer-
// pumped and would read as 200fps to the auto governor and climb it.
await evl("(CBZ.qualityLocked = true, true)");
{ let p = false; for (let i = 0; i < 300 && !p; i++) { p = await evl("(()=>{if(CBZ.game&&CBZ.game.state==='playing')return true;const b=document.getElementById('playBtn');if(b)b.click();return !!(CBZ.game&&CBZ.game.state==='playing');})()"); if (!p) await sleep(300); } if (!p) { console.error("no play"); process.exit(1); } }
mark("playing mode=" + await evl("CBZ.game.mode"));
{ let prev = -1, stable = 0, c = 0; for (let i = 0; i < 150 && stable < 4; i++) { c = await evl("(CBZ.colliders||[]).length"); if (c > 3000 && Math.abs(c - prev) < 200) stable++; else stable = 0; prev = c; await sleep(1000); } mark("world stable colliders=" + c); }
// Hold whatever tier the game chose at boot: the frameless phase below is
// timer-pumped and would read as 200fps to the auto governor and climb it.
const bootTier = await evl("({ level: CBZ.qualityLevel, auto: !!CBZ.qualityAuto, locked: !!CBZ.qualityLocked, res: CBZ.dynResScale == null ? null : CBZ.dynResScale })");
await evl("(CBZ.qualityLocked = true, true)");
await sleep(3000);

// ---- PHASE 1: per-frame JS (sim) cost, CPU-throttled, drawing off ----------
await send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
await evl(`(() => {
  const M = window.__ipm = { stats: [], on: true, n: 0, sim: [], cur: 0 };
  function wrap(list, kind) { for (let i = 0; i < list.length; i++) { const e = list[i], f = e.fn; const s = { kind, order: e.order, total: 0, n: 0 };
    M.stats.push(s); e.fn = function (dt) { const t0 = performance.now(); try { return f(dt); } finally { if (M.on) { const ms = performance.now() - t0; s.total += ms; s.n++; M.cur += ms; } } }; } }
  wrap(CBZ.updaters || [], 'u'); wrap(CBZ.always || [], 'a');
  // a frame boundary: the first always-runner closes the previous frame's sum
  CBZ.always.unshift({ order: -1e9, fn: function () { if (M.on) { if (M.n) M.sim.push(M.cur); M.cur = 0; M.n++; } } });
  return true; })()`);
mark(`phase 1: sim cost for ${SECONDS}s at ${THROTTLE}x`);
await sleep(SECONDS * 1000);
const sim = await evl(`(() => {
  const M = window.__ipm; M.on = false;
  const s = M.sim.slice().sort((a, b) => a - b), avg = s.reduce((a, b) => a + b, 0) / Math.max(1, s.length);
  const top = M.stats.filter(x => x.n).map(x => ({ k: x.kind + x.order, msPerFrame: +(x.total / Math.max(1, M.sim.length)).toFixed(2) })).sort((a, b) => b.msPerFrame - a.msPerFrame).slice(0, 12);
  return { frames: M.sim.length, avgMs: +avg.toFixed(2), p50: +(s[Math.floor(s.length * .5)] || 0).toFixed(2), p95: +(s[Math.floor(s.length * .95)] || 0).toFixed(2), top };
})()`);
mark("sim " + JSON.stringify({ frames: sim.frames, avgMs: sim.avgMs }));
await send("Emulation.setCPUThrottlingRate", { rate: 1 });

// ---- PHASE 2: drawing on; exact render counters over settled frames --------
await evl(`(() => {
  const M = window.__ipr = { calls: [], tris: [], rms: [] };
  const R = CBZ.renderer, orig = R.render.bind(R);
  R.render = function (s, c) { const t0 = performance.now(); const r = orig(s, c);
    if (s === CBZ.scene) { M.rms.push(performance.now() - t0); M.calls.push(R.info.render.calls); M.tris.push(R.info.render.triangles); }
    return r; };
  CBZ.CONFIG.RENDER_FRAMES = true;
  return true; })()`);
const WARM = 3, TAKE = 4;
for (let i = 0; i < 400; i++) { const n = await evl("window.__ipr.calls.length"); if (n >= WARM + TAKE) break; await sleep(1000); }
mark("phase 2 frames done");

const report = await evl(`(() => {
  const P = window.__ipr; const take = (a) => a.slice(${WARM});
  const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  if (CBZ.viewScopeRestore) CBZ.viewScopeRestore();
  const R = CBZ.renderer, gl = R.getContext(), db = R.getDrawingBufferSize(new THREE.Vector2());
  const lp = CBZ.lightPinAudit ? CBZ.lightPinAudit() : null;
  const cam = CBZ.camera, fr = new THREE.Frustum(), pm = new THREE.Matrix4();
  cam.updateMatrixWorld(); pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); fr.setFromProjectionMatrix(pm);
  const tri = new Map(); const arena = CBZ.city && CBZ.city.arena && CBZ.city.arena.root;
  (function walk(o, bucket) {
    if (!o.visible || o.layers.mask === 0) return;
    if (o.parent === CBZ.scene || o.parent === arena) bucket = (o.name || o.type) + (o.parent === arena ? '@arena' : '');
    if ((o.isMesh || o.isInstancedMesh) && o.geometry && o.geometry.attributes) {
      const g = o.geometry; if (!g.boundingSphere) { try { g.computeBoundingSphere(); } catch (e) {} }
      let inView = true; try { inView = o.frustumCulled === false || o.isInstancedMesh || fr.intersectsObject(o); } catch (e) {}
      if (inView) { const n = (g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0)) / 3 * (o.isInstancedMesh ? o.count : 1);
        const t = tri.get(bucket) || { tris: 0, meshes: 0, near: 1e9, far: 0 }; t.tris += n; t.meshes++;
        if (o.parent === arena) { const b = { x: 0, y: 0, z: 0, r: 0 }; if (o.isInstancedMesh) { const a = o.instanceMatrix.array; let mnx=1e9,mxx=-1e9,mnz=1e9,mxz=-1e9,mny=1e9,mxy=-1e9; for (let q = 0; q < o.count * 16; q += 16) { const x=a[q+12],y=a[q+13],z=a[q+14]; if(x<mnx)mnx=x; if(x>mxx)mxx=x; if(y<mny)mny=y; if(y>mxy)mxy=y; if(z<mnz)mnz=z; if(z>mxz)mxz=z; } b.x=(mnx+mxx)/2; b.y=(mny+mxy)/2; b.z=(mnz+mxz)/2; b.r=Math.hypot(mxx-mnx,mxy-mny,mxz-mnz)/2; } else { const s = g.boundingSphere; const v = s.center.clone().applyMatrix4(o.matrixWorld); b.x=v.x; b.y=v.y; b.z=v.z; b.r=s.radius; } { const dd = Math.hypot(b.x - cam.position.x, b.y - cam.position.y, b.z - cam.position.z) - b.r; t.near = Math.min(t.near, dd); t.far = Math.max(t.far, dd); } }
        tri.set(bucket, t); }
    }
    for (let i = 0; i < o.children.length; i++) walk(o.children[i], bucket);
  })(CBZ.scene, 'scene');
  const topTris = [...tri.entries()].map(([k, v]) => ({ k, kTris: Math.round(v.tris / 1000), meshes: v.meshes, nearM: Math.round(v.near), farM: Math.round(v.far) })).sort((a, b) => b.kTris - a.kTris).slice(0, 12);
  return {
    device: CBZ.deviceClass || null, cam: [Math.round(CBZ.camera.position.x), Math.round(CBZ.camera.position.y), Math.round(CBZ.camera.position.z)],
    drawingBuffer: [db.x, db.y], megapixels: +(db.x * db.y / 1e6).toFixed(2), pixelRatio: R.getPixelRatio(), msaaSamples: gl.getParameter(gl.SAMPLES),
    renderFrames: take(P.calls).length, calls: med(take(P.calls)), callsAll: P.calls, triangles: med(take(P.tris)), renderMsSwiftShader: +med(take(P.rms)).toFixed(0),
    programs: R.info.programs.length, geometries: R.info.memory.geometries, textures: R.info.memory.textures,
    shadow: { on: !!(CBZ.sun && CBZ.sun.castShadow), map: CBZ.sun && CBZ.sun.shadow.mapSize.x },
    lights: lp, lightBudget: [CBZ.CONFIG.LIGHT_BUDGET_POINT, CBZ.CONFIG.LIGHT_BUDGET_SPOT],
    fog: CBZ.scene.fog ? [Math.round(CBZ.scene.fog.near), Math.round(CBZ.scene.fog.far)] : null, cull: CBZ.cityCullRadius,
    pedKinds: (() => { const m = {}; for (const p of (CBZ.cityPeds || [])) { const k = (p && (p.kind || '?')) + (p && p.vis ? '' : ''); m[k] = (m[k] || 0) + 1; } return m; })(),
    fogReach: CBZ.fogReachAudit ? CBZ.fogReachAudit() : null,
    weight: (() => { let objs = 0, meshes = 0; const geos = new Set(), mats = new Set();
      CBZ.scene.traverse((o) => { objs++; if (o.isMesh || o.isInstancedMesh) { meshes++; if (o.geometry) geos.add(o.geometry); const m = o.material; if (Array.isArray(m)) m.forEach((x) => mats.add(x)); else if (m) mats.add(m); } });
      let bytes = 0; geos.forEach((g) => { for (const k in g.attributes) { const a = g.attributes[k]; if (a && a.array) bytes += a.array.byteLength; } if (g.index && g.index.array) bytes += g.index.array.byteLength; });
      return { object3D: objs, meshes, geometries: geos.size, geometryMB: Math.round(bytes / 1048576), materials: mats.size, colliders: (CBZ.colliders || []).length }; })(),
    actors: { peds: (CBZ.cityPeds||[]).length, cars: (CBZ.cityCars||[]).length, crowd: CBZ.cityCrowdCount ? CBZ.cityCrowdCount() : null },
    heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(0) : null,
    topTris,
  }; })()`);
report.bootTier = bootTier; report.sim = sim;
report.errors = errors.slice(0, 8);
report.title = titleInfo;
report.throttle = THROTTLE; report.viewport = [W, H, DPR];
console.log(JSON.stringify(report, null, 2));
if (OUT) await writeFile(OUT, JSON.stringify(report, null, 2));
cleanup();
process.exit(0);
