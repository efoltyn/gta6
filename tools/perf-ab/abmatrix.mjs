#!/usr/bin/env node
/* tools/perf-ab/abmatrix.mjs — CLEAN single-boot A/B matrix of RUNTIME levers.
 *
 * Boots the city ONCE, FREEZES the rAF loop (so the game can't render behind
 * our back and pollute counts), then toggles one lever at a time and records
 * the EXACT draw-call / triangle / visible-mesh delta (device-independent) plus
 * a small relative ms median. Every lever here is runtime — the owner can feel
 * each via a URL flag / setting without a rebuild.
 *
 * Usage: node tools/perf-ab/abmatrix.mjs [--seed 90210] [--scenario calm|chaos] [--json out.json]
 */
import { spawn } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const argv = process.argv.slice(2);
const argS = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const SEED = +argS("--seed", "90210");
const SCENARIO = argS("--scenario", "calm");
const OUT = argS("--json", "");
const TAG = argS("--tag", "abmatrix-" + SCENARIO);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function claimPort(lo, span, probe) { for (let t = 0; t < 8; t++) { const p = lo + Math.floor(Math.random() * span); try { await probe(p); } catch (_) { return p; } } throw new Error("no port near " + lo); }
const port = await claimPort(9500, 200, (p) => fetch(`http://127.0.0.1:${p}/`));
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const origin = `http://127.0.0.1:${port}/`;
{ let up = false; for (let i = 0; i < 50 && !up; i++) { try { await fetch(origin); up = true; } catch (_) { await sleep(100); } } if (!up) { console.error("devserver down"); process.exit(1); } }
const dbg = await claimPort(10800, 200, (p) => fetch(`http://127.0.0.1:${p}/json/version`));
const prof = `/tmp/cbz-abm-${dbg}`; await rm(prof, { recursive: true, force: true });
const chrome = spawn("/opt/pw-browsers/chromium", ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-webgl", "--mute-audio", "--window-size=1280,720", `--remote-debugging-port=${dbg}`, `--user-data-dir=${prof}`, `${origin}?seed=${SEED}&qforce=4`], { stdio: "ignore" });
let page = null;
for (let i = 0; i < 200 && !page; i++) { try { const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json(); page = ps.find((p) => p.type === "page" && p.url.startsWith(origin)); } catch (_) {} if (!page) await sleep(100); }
if (!page) { console.error("no page"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
let id = 1; const pend = new Map(); const errors = [];
ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value || a.description || "").join(" ").slice(0, 120)); });
const send = (method, params = {}) => new Promise((r) => { const i = id++; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expression, awaitPromise = false) => { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise }); if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result && r.result.result && r.result.result.value; };
await send("Runtime.enable");
const T0 = Date.now(); const mark = (m) => console.error(`[t+${((Date.now() - T0) / 1000).toFixed(1)}s] ${m}`);

{ let ok = false; for (let i = 0; i < 400 && !ok; i++) { try { ok = !!(await evl("!!(window.CBZ && CBZ.game && (CBZ.bootComplete||CBZ.game.state==='title') && CBZ.stepSim && document.getElementById('playBtn'))")); } catch (_) {} if (!ok) await sleep(150); } if (!ok) { console.error("no boot"); process.exit(1); } }
mark("boot");
{ let p = false; for (let i = 0; i < 240 && !p; i++) { p = await evl("(()=>{if(CBZ.game&&CBZ.game.state==='playing')return true;const b=document.getElementById('playBtn');if(b)b.click();return CBZ.game&&CBZ.game.state==='playing';})()"); if (!p) await sleep(200); } if (!p) { console.error("no play"); process.exit(1); } }
mark("playing");
{ let prev = -1, stable = 0, c = 0; for (let i = 0; i < 80 && stable < 3; i++) { c = await evl("(CBZ.colliders||[]).length"); if (c > 5000 && Math.abs(c - prev) < 300) stable++; else stable = 0; prev = c; await sleep(700); } mark("world stable colliders=" + c); }
if (SCENARIO === "chaos") { await evl(`(()=>{try{CBZ.game.wanted=5;CBZ.game.heat=12000;CBZ.spawnCityPeds&&CBZ.spawnCityPeds(220);CBZ.spawnCityCrowd&&CBZ.spawnCityCrowd(360);CBZ.spawnCityTraffic&&CBZ.spawnCityTraffic(90);CBZ.cityAlarm&&CBZ.cityAlarm(CBZ.player.pos.x,CBZ.player.pos.z,120,1,CBZ.city.playerActor);}catch(e){}return true;})()`); }
for (let i = 0; i < 6; i++) { await evl("CBZ.stepSim&&CBZ.stepSim(1/60)"); await sleep(120); }
if (SCENARIO === "chaos") mark("chaos spawned");

// ---- one big measurement, rAF FROZEN so counts are clean ----
const MEASURE = `(() => {
  const R = CBZ.renderer, S = CBZ.scene, C = CBZ.camera, info = R.info, sun = CBZ.sun;
  if (CBZ.setQualityLevel) CBZ.setQualityLevel(4);
  // FREEZE the game loop: swallow further rAF callbacks so nothing renders but us
  window.__raf = window.requestAnimationFrame; window.requestAnimationFrame = function(){ return 0; };
  R.shadowMap.enabled = true; R.shadowMap.autoUpdate = false;
  const rc = () => ({ calls: info.render.calls, tris: info.render.triangles });
  const vis = () => { let v = 0; S.traverse(o => { if (o.isMesh && o.visible) v++; }); return v; };
  const med = (fn, n) => { const xs = []; for (let i=0;i<n;i++){ const t=performance.now(); fn(); xs.push(performance.now()-t);} xs.sort((a,b)=>a-b); return +xs[xs.length>>1].toFixed(1); };
  const N = 5;
  const rMain = () => { R.shadowMap.needsUpdate = false; R.render(S, C); };
  const rShadow = () => { R.shadowMap.needsUpdate = true; R.render(S, C); };
  rShadow(); for (let i=0;i<3;i++) rMain();   // warmup + settle shadow map
  const snap = (label) => { rMain(); const c = rc(); return { label, calls: c.calls, tris: c.tris, visibleMeshes: vis(), mainMs: med(rMain, N) }; };
  const out = { results: [] };

  // BASELINE (q4, shadows on, main pass)
  const base = snap("baseline_q4");
  out.results.push(base);
  const d = (o) => ({ ...o, dCalls: base.calls - o.calls, dTris: base.tris - o.tris, dVisible: base.visibleMeshes - o.visibleMeshes });

  // SHADOW PASS cost (clean): with-update vs main-only
  rShadow(); const ws = rc(); const shadowMs = med(rShadow, N);
  rMain(); const mo = rc(); const mainMs = med(rMain, N);
  out.shadow = { passCalls: ws.calls - mo.calls, passTris: ws.tris - mo.tris,
    shadowUpdateMs: shadowMs, mainOnlyMs: mainMs, shadowTaxMs: +(shadowMs - mainMs).toFixed(1),
    note: "passCalls = draw calls in the sun shadow-map render (device-independent). ms is SwiftShader-relative; real-GPU PCFSoft cost is higher share." };

  // SHADOWS OFF entirely
  R.shadowMap.enabled = false; const off = snap("shadows_off"); R.shadowMap.enabled = true; rShadow();
  out.results.push(d(off));

  // SHADOW RES sweep (relative ms; draws unchanged)
  const applyShadowRes = (px) => { if (sun && sun.shadow) { sun.shadow.mapSize.set(px, px); if (sun.shadow.map){ sun.shadow.map.dispose(); sun.shadow.map = null; } R.shadowMap.needsUpdate = true; R.render(S,C); } };
  const origRes = sun && sun.shadow ? sun.shadow.mapSize.x : 2048;
  out.shadowRes = {};
  for (const px of [512, 1024, 2048]) { applyShadowRes(px); out.shadowRes["r"+px] = med(rShadow, N); }
  applyShadowRes(origRes);

  // PIXEL RATIO (fill-rate proxy; draws unchanged)
  const opr = R.getPixelRatio();
  out.pixelRatio = {};
  for (const pr of [0.72, 1.0]) { R.setPixelRatio(pr); out.pixelRatio["pr"+pr] = med(rMain, N); }
  R.setPixelRatio(opr);

  // DRAW DISTANCE (farcull radius) — set radius, run sweeps (onAlways 3.6), render
  const origCull = CBZ.cityCullRadius;
  const applyCull = (mult) => { CBZ.cityCullRadius = origCull * mult; for (let i=0;i<10;i++) CBZ.stepSim(1/60); };
  for (const m of [0.5, 0.25]) { applyCull(m); const r = snap("drawdist_x" + m); out.results.push({ ...d(r), cullRadius: CBZ.cityCullRadius }); }
  CBZ.cityCullRadius = origCull; for (let i=0;i<10;i++) CBZ.stepSim(1/60);

  // CATEGORY HIDES (clean)
  const grp = a => (a||[]).map(x=>x&&x.group).filter(Boolean);
  const hide = (label, objs) => { const arr=(objs||[]).filter(Boolean); const sv=arr.map(o=>[o,o.visible]); for(const o of arr)o.visible=false; const r=snap(label); for(const [o,v] of sv)o.visible=v; return { ...d(r), hidden: arr.length }; };
  const crowd = S.getObjectByName ? S.getObjectByName("city-crowd") : null;
  const cityRoot = CBZ.city && CBZ.city.arena && CBZ.city.arena.root;
  out.results.push(hide("hide_pedsCops", grp(CBZ.cityPeds).concat(grp(CBZ.cityCops))));
  out.results.push(hide("hide_cars", grp(CBZ.cityCars)));
  out.results.push(hide("hide_crowd", crowd ? [crowd] : []));
  out.results.push(hide("hide_dynamicAll", grp(CBZ.cityPeds).concat(grp(CBZ.cityCops), grp(CBZ.cityCars), crowd ? [crowd] : [])));
  out.results.push(hide("hide_staticCity", cityRoot ? [cityRoot] : []));

  out.counts = { peds:(CBZ.cityPeds||[]).length, cops:(CBZ.cityCops||[]).length, cars:(CBZ.cityCars||[]).length, crowd: CBZ.cityCrowdCount?CBZ.cityCrowdCount():null, colliders:(CBZ.colliders||[]).length };
  out.heapMB = performance.memory ? +(performance.memory.usedJSHeapSize/1048576).toFixed(1) : null;
  out.info = { geometries: info.memory.geometries, textures: info.memory.textures, programs: (info.programs||[]).length, uniqueMaterials: null };
  // restore loop
  window.requestAnimationFrame = window.__raf;
  return out;
})()`;

mark("measuring (rAF frozen)");
let report = { tag: TAG, seed: SEED, scenario: SCENARIO };
try { const r = await evl(MEASURE, true); Object.assign(report, r); }
catch (e) { console.error("MEASURE failed:", e.message); process.exit(1); }
mark("done");
report.consoleErrors = errors.filter(e => !/ProgressEvent/.test(e)).slice(0, 15);
const json = JSON.stringify(report, null, 2);
if (OUT) await writeFile(path.isAbsolute(OUT) ? OUT : path.join(ROOT, OUT), json);
process.stdout.write(json + "\n");
try { if (ws && ws.readyState === WebSocket.OPEN) await send("Browser.close"); } catch (_) {}
if (!chrome.killed) chrome.kill("SIGTERM"); if (!server.killed) server.kill("SIGTERM");
await rm(prof, { recursive: true, force: true }).catch(() => {});
process.exit(0);
