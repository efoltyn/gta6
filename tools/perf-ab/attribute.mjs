#!/usr/bin/env node
/* tools/perf-ab/attribute.mjs — ONE-BOOT perf attribution ("the pie chart").
 *
 * Boots the city headless ONCE, then measures everything toggleable in-scene
 * with NO reliance on wall-clock frame rate:
 *   • per-subsystem DRAW CALLS + TRIANGLES (exact, device-independent — the
 *     research consensus proxy: draw calls correlate with real frame time
 *     better than software-raster ms)
 *   • shadow tax (draw-call + triangle delta of the sun's shadow pass)
 *   • fill-rate probe (render at full vs quarter res — relative indicator)
 *   • quality-tier sweep (0/2/4) draw/tri/ms
 *   • sim-CPU ranking (per-updater ms over a stepSim burst — shape is valid)
 *
 * Draw/tri counts are EXACT on SwiftShader; ms is RELATIVE only. See LOG.md.
 *
 * Usage: node tools/perf-ab/attribute.mjs [--seed 90210] [--scenario calm|chaos]
 *        [--qforce 4] [--cfg FLAG=0,FLAG2=1] [--json out.json] [--tag name]
 */
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const argv = process.argv.slice(2);
const argS = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const SEED = +argS("--seed", "90210");
const SCENARIO = argS("--scenario", "calm");
const QFORCE = argS("--qforce", "4");
const CFG = argS("--cfg", "");          // e.g. MATRIX_FREEZE=0,BATCH_V2=0
const OUT = argS("--json", "");
const TAG = argS("--tag", SCENARIO + "-q" + QFORCE);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function claimPort(lo, span, probe) {
  for (let t = 0; t < 8; t++) { const p = lo + Math.floor(Math.random() * span); try { await probe(p); } catch (_) { return p; } }
  throw new Error("no free port near " + lo);
}
const port = await claimPort(9500, 200, (p) => fetch(`http://127.0.0.1:${p}/`));
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const origin = `http://127.0.0.1:${port}/`;
{ let up = false; for (let i = 0; i < 50 && !up; i++) { try { await fetch(origin); up = true; } catch (_) { await sleep(100); } } if (!up) { console.error("devserver never came up"); process.exit(1); } }
const dbg = await claimPort(10800, 200, (p) => fetch(`http://127.0.0.1:${p}/json/version`));
const prof = `/tmp/cbz-attr-${dbg}`;
await rm(prof, { recursive: true, force: true });
const cfgQuery = CFG ? "&" + CFG.split(",").filter(Boolean).map((kv) => { const [k, v] = kv.split("="); return `cfg_${k}=${v}`; }).join("&") : "";
const chrome = spawn("/opt/pw-browsers/chromium", [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--enable-webgl", "--mute-audio", "--window-size=1280,720",
  `--remote-debugging-port=${dbg}`, `--user-data-dir=${prof}`, `${origin}?seed=${SEED}&qforce=${QFORCE}${cfgQuery}`,
], { stdio: "ignore" });

let page = null;
for (let i = 0; i < 200 && !page; i++) { try { const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json(); page = ps.find((p) => p.type === "page" && p.url.startsWith(origin)); } catch (_) {} if (!page) await sleep(100); }
if (!page) { console.error("no page"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
let id = 1; const pend = new Map(); const errors = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; errors.push(`${d.url || "?"}:${d.lineNumber} ${(d.exception && d.exception.description || d.text || "").split("\n")[0]}`); }
  else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") { errors.push("console.error: " + m.params.args.map((a) => a.value || a.description || "").join(" ").slice(0, 200)); }
});
const send = (method, params = {}) => new Promise((r) => { const i = id++; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expression, awaitPromise = false) => { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise }); if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return r.result && r.result.result && r.result.result.value; };
await send("Runtime.enable"); await send("Page.enable");

const T0 = Date.now();
const mark = (m) => console.error(`[t+${((Date.now()-T0)/1000).toFixed(1)}s] ${m}`);
// wait for boot (title screen ready) — the proven math-gate path
{ let ok = false; for (let i = 0; i < 400 && !ok; i++) { try { ok = !!(await evl("!!(window.CBZ && CBZ.game && (CBZ.bootComplete || CBZ.game.state==='title') && CBZ.stepSim && document.getElementById('playBtn'))")); } catch (_) {} if (!ok) await sleep(150); } if (!ok) { console.error("boot never completed"); process.exit(1); } }
mark("boot ready");
// click PLAY to build the full continent + spawn ambient life (resetGame alone
// builds only a stub world — the play flow is what triggers buildCity + spawns)
{ let playing = false; for (let i = 0; i < 240 && !playing; i++) { playing = await evl("(() => { if (CBZ.game && CBZ.game.state==='playing') return true; const b = document.getElementById('playBtn'); if (b) b.click(); return CBZ.game && CBZ.game.state==='playing'; })()"); if (!playing) await sleep(200); } if (!playing) { console.error("never reached playing"); process.exit(1); } }
mark("playing");
// wait for the world to actually stream in (colliders stabilize), then force tier + scenario
{ let prev = -1, stable = 0, c = 0; for (let i = 0; i < 80 && stable < 3; i++) { c = await evl("(CBZ.colliders||[]).length"); if (c > 5000 && Math.abs(c - prev) < 300) stable++; else stable = 0; prev = c; await sleep(700); } mark("world stable colliders=" + c); }
await evl(`(() => {
  try {
    if ("${QFORCE}" !== "" && CBZ.setQualityLevel) CBZ.setQualityLevel(parseInt("${QFORCE}",10));
    if ("${SCENARIO}" === "chaos") {
      CBZ.game.wanted = 5; CBZ.game.heat = 12000;
      if (CBZ.spawnCityPeds) CBZ.spawnCityPeds(220);
      if (CBZ.spawnCityCrowd) CBZ.spawnCityCrowd(360);
      if (CBZ.spawnCityTraffic) CBZ.spawnCityTraffic(90);
      if (CBZ.cityAlarm) CBZ.cityAlarm(CBZ.player.pos.x, CBZ.player.pos.z, 120, 1, CBZ.city.playerActor);
    }
    return true;
  } catch (e) { return String(e && (e.stack||e)); }
})()`);
// settle a few frames so tier change + spawns take effect and farcull sweeps run
for (let i = 0; i < 6; i++) { await evl("CBZ.stepSim && CBZ.stepSim(1/60)"); await sleep(150); }
mark("settled; measuring");

// ---- staged in-page measurement (shared state on window.__A so each stage is
// its own bounded evaluate; render count under SwiftShader makes one giant
// evaluate too slow to reason about) ----
const N = 6;  // ms sample count (SwiftShader ms is RELATIVE-only)
const SETUP = `(() => {
  const R = CBZ.renderer, S = CBZ.scene, C = CBZ.camera, info = R.info, sun = CBZ.sun;
  const A = window.__A = { R, S, C, info, sun,
    rc: () => ({ calls: info.render.calls, tris: info.render.triangles }),
    med: (fn, n) => { const xs=[]; for (let i=0;i<n;i++){ const t=performance.now(); fn(); xs.push(performance.now()-t);} xs.sort((a,b)=>a-b); return +xs[xs.length>>1].toFixed(2); },
    renderMain: () => { R.shadowMap.needsUpdate = false; R.render(S, C); },
    renderShadow: () => { R.shadowMap.needsUpdate = true; R.render(S, C); } };
  R.shadowMap.enabled = true; R.shadowMap.autoUpdate = false;
  R.shadowMap.needsUpdate = true; for (let i = 0; i < 4; i++) R.render(S, C);   // warmup
  // scene census (no renders)
  let objects=0, meshes=0, vis=0, inst=0, lights=0, sprites=0; const geos=new Set(), mats=new Set();
  let transparent=0, textured=0, emissive=0, matAuto=0;
  S.traverse(o => { objects++; if (o.matrixAutoUpdate) matAuto++;
    if (o.isMesh) { meshes++; if (o.visible) vis++;
      const ml = Array.isArray(o.material)?o.material:[o.material]; let tx=false,tr=false,em=false;
      for (const m of ml){ if(!m)continue; mats.add(m.uuid); if(m.map)tx=true; if(m.transparent||m.opacity<1)tr=true; if(m.emissive&&m.emissive.getHex&&m.emissive.getHex()!==0)em=true; }
      if(tx)textured++; if(tr)transparent++; if(em)emissive++; if(o.geometry) geos.add(o.geometry.uuid); }
    if (o.isInstancedMesh) inst++; if (o.isLight) lights++; if (o.isSprite) sprites++; });
  return { scene: { objects, meshes, visibleMeshes: vis, instancedMeshes: inst, lights, sprites,
      uniqueGeometries: geos.size, uniqueMaterials: mats.size, texturedMeshes: textured,
      transparentMeshes: transparent, emissiveMeshes: emissive, matrixAutoUpdateObjects: matAuto },
    info: { geometries: info.memory.geometries, textures: info.memory.textures, programs: (info.programs||[]).length },
    heapMB: performance.memory ? +(performance.memory.usedJSHeapSize/1048576).toFixed(1) : null,
    counts: { peds:(CBZ.cityPeds||[]).length, cops:(CBZ.cityCops||[]).length, cars:(CBZ.cityCars||[]).length,
      crowd: CBZ.cityCrowdCount?CBZ.cityCrowdCount():null, colliders:(CBZ.colliders||[]).length, losBlockers:(CBZ.losBlockers||[]).length } };
})()`;

const BASE = `(() => {
  const A = window.__A, R = A.R, S = A.S, C = A.C, N = ${N};
  A.renderShadow(); const withShadow = A.rc();
  A.renderMain();   const mainOnly = A.rc();
  const baseline = { mainCalls: mainOnly.calls, mainTris: mainOnly.tris,
    shadowUpdateCalls: withShadow.calls, shadowUpdateTris: withShadow.tris,
    shadowPassCalls: withShadow.calls - mainOnly.calls, shadowPassTris: withShadow.tris - mainOnly.tris };
  const ms = { mainMedian: A.med(A.renderMain, N), shadowUpdateMedian: A.med(A.renderShadow, N) };
  ms.shadowTaxMedian = +(ms.shadowUpdateMedian - ms.mainMedian).toFixed(2);
  const sz = R.getSize(new THREE.Vector2()); const prevPR = R.getPixelRatio();
  const fullMs = A.med(A.renderMain, N);
  R.setSize(Math.max(64, sz.x/4|0), Math.max(64, sz.y/4|0), false); const quarterMs = A.med(A.renderMain, N);
  R.setSize(sz.x, sz.y, false); R.setPixelRatio(prevPR); C.aspect = sz.x/sz.y; C.updateProjectionMatrix();
  const fillRate = { fullResMs: fullMs, quarterResMs: quarterMs, ratio: +(quarterMs/(fullMs||1)).toFixed(3),
    note: "ratio~1 => CPU/draw-call bound; <<1 => fill/fragment bound (SwiftShader-indicative)" };
  return { baseline, ms, fillRate };
})()`;

const CAT = `(() => {
  const A = window.__A, S = A.S;
  A.renderMain(); const base = A.rc();
  const hide = (objs) => { const arr=(objs||[]).filter(Boolean); const saved=arr.map(o=>[o,o.visible]);
    for (const o of arr) o.visible=false; A.renderMain(); const s=A.rc();
    for (const [o,v] of saved) o.visible=v; return { hidden: arr.length, dCalls: base.calls-s.calls, dTris: base.tris-s.tris }; };
  const grp = a => (a||[]).map(x=>x&&x.group).filter(Boolean);
  const peds = grp(CBZ.cityPeds).concat(grp(CBZ.cityCops)), cars = grp(CBZ.cityCars);
  const crowd = S.getObjectByName ? S.getObjectByName("city-crowd") : null;
  const cityRoot = CBZ.city && CBZ.city.arena && CBZ.city.arena.root;
  const categories = { pedsAndCops: hide(peds), cars: hide(cars), ambientCrowd: hide(crowd?[crowd]:[]),
    staticCityRoot: hide(cityRoot?[cityRoot]:[]), prisonRoot: hide(CBZ.prisonRoot?[CBZ.prisonRoot]:[]) };
  const bk = new Map();
  for (const c of S.children) { const k=(c.name||c.type||"?"); if(!bk.has(k)) bk.set(k,[]); bk.get(k).push(c); }
  const topLevel = Array.from(bk.entries()).map(([k,arr]) => { const r=hide(arr); return { key:k, n:arr.length, dCalls:r.dCalls, dTris:r.dTris }; })
    .filter(r=>r.dCalls>0||r.dTris>0).sort((a,b)=>b.dCalls-a.dCalls);
  return { base, categories, topLevel };
})()`;

const TIERS = `(() => {
  const A = window.__A, R = A.R, S = A.S, C = A.C, sun = A.sun, N = ${N};
  const prev = CBZ.getQualityLevel ? CBZ.getQualityLevel() : ${+QFORCE || 4};
  const tiers = {};
  for (const q of [0, 4]) {
    if (CBZ.setQualityLevel) CBZ.setQualityLevel(q);
    R.shadowMap.needsUpdate = true; R.render(S, C); const ws2 = A.rc();
    R.shadowMap.needsUpdate = false; R.render(S, C); const mo = A.rc();
    tiers["q"+q] = { pixelRatio: R.getPixelRatio(), shadowMap: sun&&sun.shadow?sun.shadow.mapSize.x:null,
      sunShadow: sun?sun.castShadow:null, mainCalls: mo.calls, mainTris: mo.tris,
      shadowPassCalls: ws2.calls-mo.calls, shadowPassTris: ws2.tris-mo.tris,
      fullFrameMs: A.med(()=>{ R.shadowMap.needsUpdate=true; R.render(S,C); }, N) };
  }
  if (CBZ.setQualityLevel) CBZ.setQualityLevel(prev);
  return { tiers };
})()`;

const SIM = `(() => {
  const wrapSet = [];
  const wrap = (list, kind) => { for (let i=0;i<list.length;i++){ const e=list[i], orig=e.fn; const st={kind,order:e.order,source:e.source||"",total:0,calls:0,peak:0}; wrapSet.push({e,orig,st});
    e.fn=function(dt){ const t=performance.now(); try{ return orig(dt);} finally{ const ms=performance.now()-t; st.total+=ms; st.calls++; if(ms>st.peak)st.peak=ms; } }; } };
  wrap(CBZ.updaters, "update"); wrap(CBZ.always, "always");
  const K = 120, t0 = performance.now();
  for (let i=0;i<K;i++) CBZ.stepSim(1/60);
  const total = performance.now() - t0;
  for (const w of wrapSet) w.e.fn = w.orig;
  const top = wrapSet.map(w=>w.st).filter(s=>s.calls).sort((a,b)=>b.total-a.total).slice(0,18)
    .map(s=>({ kind:s.kind, order:s.order, source:s.source, totalMs:+s.total.toFixed(1), avgMsPerTick:+(s.total/s.calls).toFixed(3), peakMs:+s.peak.toFixed(2) }));
  return { sim: { ticks:K, totalMs:+total.toFixed(0), msPerTick:+(total/K).toFixed(3), top } };
})()`;

const report = { tag: TAG, seed: SEED, scenario: SCENARIO, qforce: QFORCE, cfg: CFG };
const stage = async (label, expr) => { const t = Date.now(); let r; try { r = await evl(expr, true); } catch (e) { console.error(`stage ${label} FAILED:`, e.message); throw e; } console.error(`[stage ${label}] ${((Date.now()-t)/1000).toFixed(1)}s`); Object.assign(report, r); };
try {
  await stage("setup", SETUP);
  await stage("base", BASE);
  await stage("cat", CAT);
  await stage("tiers", TIERS);
  await stage("sim", SIM);
} catch (e) { const st = await evl("JSON.stringify({state:CBZ.game&&CBZ.game.state,mode:CBZ.game&&CBZ.game.mode})"); console.error("state=", st); process.exit(1); }
report.consoleErrors = errors.slice(0, 20);

const json = JSON.stringify(report, null, 2);
if (OUT) { await writeFile(path.isAbsolute(OUT) ? OUT : path.join(ROOT, OUT), json); }
process.stdout.write(json + "\n");

try { if (ws && ws.readyState === WebSocket.OPEN) await send("Browser.close"); } catch (_) {}
if (!chrome.killed) chrome.kill("SIGTERM");
if (!server.killed) server.kill("SIGTERM");
await rm(prof, { recursive: true, force: true }).catch(() => {});
process.exit(0);
