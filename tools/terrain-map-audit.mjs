#!/usr/bin/env node
/* tools/terrain-map-audit.mjs — the MATHEMATICAL MAP (no visual).

   Boots the game headless, presses PLAY, then samples the LIVE world on a grid
   entirely IN-PAGE (one Runtime.evaluate — fast) and reports, as pure numbers:

     • biome histogram (cell count + AABB per biome from CBZ.cityBiomeAt)
     • relief field stats (max/mean height; where CBZ.terrainHeight /
       CBZ.snowTerrainHeightAt rise)
     • MOUNTAIN cells (relief > --mtn, default 25u) and the biome UNDER each —
       the headline metrics the owner asked for:
         - mountains OUTSIDE snow  (relief high where biome !== 'snow')
         - CITY on mountain        (biome city/urban where relief high)
     • region overlaps: pairwise AABB intersections of registered
       CBZ.city(.arena).regions that belong to DIFFERENT biomes

   Usage: node tools/terrain-map-audit.mjs [--seed N] [--step 40] [--mtn 25] [--span 3200]
   Closed loop, zero visual, zero npm deps. */
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const argn = (flag, def) => { const i = argv.indexOf(flag); return i >= 0 && argv[i + 1] != null ? Number(argv[i + 1]) : def; };
const SEED = argn("--seed", 90210), STEP = argn("--step", 40), MTN = argn("--mtn", 25), SPAN = argn("--span", 3200);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 8700 + Math.floor(Math.random() * 80);
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const base = `http://127.0.0.1:${port}/?seed=${SEED}`;
const dbg = 9700 + Math.floor(Math.random() * 80);
await rm(`/tmp/cbz-tmap-${dbg}`, { recursive: true, force: true });
await sleep(700);
const chrome = spawn("/opt/pw-browsers/chromium", ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-webgl", "--mute-audio", `--remote-debugging-port=${dbg}`, `--user-data-dir=/tmp/cbz-tmap-${dbg}`, base], { stdio: "ignore" });
let pg = null;
for (let i = 0; i < 80 && !pg; i++) { try { const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json(); pg = ps.find((p) => p.type === "page" && p.url.includes("seed")); } catch (_) {} if (!pg) await sleep(250); }
const ws = new WebSocket(pg.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
let id = 1; const pend = new Map();
ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = id++; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true }); if (r.result && r.result.exceptionDetails) { console.error("EVAL ERR:", JSON.stringify(r.result.exceptionDetails).slice(0, 300)); } return r.result && r.result.result && r.result.result.value; };
await send("Runtime.enable");
for (let i = 0; i < 60; i++) { if (await evl("!!(window.CBZ && CBZ.game && document.getElementById('playBtn'))")) break; await sleep(500); }
await evl("(() => { if (window.CBZ && CBZ.CONFIG) CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false; return true; })()");
let playing = false;
for (let i = 0; i < 120 && !playing; i++) { await evl("(() => { const b = document.getElementById('playBtn'); if (b) b.click(); return true; })()"); await sleep(600); playing = await evl("!!(CBZ.game && CBZ.game.state === 'playing')"); }
if (!playing) { console.error("never reached playing"); process.exit(1); }
await sleep(4000);

// ---- ONE in-page grid sweep: biome + relief at every cell ----
const SAMPLER = `(() => {
  const STEP=${STEP}, MTN=${MTN}, SPAN=${SPAN};
  const biomeAt = CBZ.cityBiomeAt || (()=> "?");
  const th = CBZ.terrainHeight || (()=>0);
  const sh = CBZ.snowTerrainHeightAt || (()=>0);
  const fl = CBZ.floorAt || (()=>0);
  const flat = CBZ.TERRAIN_FLAT || null;
  const src = (x,z) => { let a=0,b=0,c=0; try{a=th(x,z)||0}catch(e){} try{b=sh(x,z)||0}catch(e){} try{c=fl(x,z)||0}catch(e){} return {th:Math.round(a),sh:Math.round(b),fl:Math.round(c)}; };
  const B = {};                    // biome -> {n, minX,maxX,minZ,maxZ}
  let cells=0, mtnCells=0, reliefMax=0, reliefSum=0;
  const mtnOutSnow=[], cityOnMtn=[];
  let mtnBiome={};                 // biome -> mountain-cell count
  for (let x=-SPAN; x<=SPAN; x+=STEP) {
    for (let z=-SPAN; z<=SPAN; z+=STEP) {
      cells++;
      let b = "?"; try { b = biomeAt(x,z) || "?"; } catch(e){}
      const bb = B[b] || (B[b]={n:0,minX:1e9,maxX:-1e9,minZ:1e9,maxZ:-1e9});
      bb.n++; if(x<bb.minX)bb.minX=x; if(x>bb.maxX)bb.maxX=x; if(z<bb.minZ)bb.minZ=z; if(z>bb.maxZ)bb.maxZ=z;
      // relief = the visible/walkable ground the player sees. Sample all three
      // oracles so a violation names its SOURCE (backdrop vs snow vs floor).
      let hh=0; try { hh=Math.max(th(x,z)||0, sh(x,z)||0, fl(x,z)||0); } catch(e){}
      reliefSum+=hh; if(hh>reliefMax)reliefMax=hh;
      if (hh>MTN) {
        mtnCells++; mtnBiome[b]=(mtnBiome[b]||0)+1;
        const snowy = /snow/i.test(b);
        if (!snowy) { if (mtnOutSnow.length<40) mtnOutSnow.push(Object.assign({x,z,h:Math.round(hh),biome:b}, src(x,z))); }
        if (/city|down|urban|commerc|resid/i.test(b)) { if (cityOnMtn.length<40) cityOnMtn.push(Object.assign({x,z,h:Math.round(hh),biome:b}, src(x,z))); }
      }
    }
  }
  // registered regions (bounds + biome)
  const A = CBZ.city && (CBZ.city.arena || CBZ.city);
  const regs = (A && A.regions ? A.regions : []).map(r => ({
    name:r.name||null, biome:r.biome||null, kind:r.kind||"rect", underlay:!!r.underlay,
    minX:r.minX,maxX:r.maxX,minZ:r.minZ,maxZ:r.maxZ, cx:r.cx,cz:r.cz,r:r.r,
  }));
  return JSON.stringify({
    cfg:{STEP,MTN,SPAN}, flat, cells, mtnCells, reliefMax:Math.round(reliefMax),
    reliefMean:+(reliefSum/cells).toFixed(2), biomes:B, mtnBiome, mtnOutSnow, cityOnMtn, regs,
  });
})()`;
const raw = await evl(SAMPLER);
const d = JSON.parse(raw || "{}");

// ---- region overlaps (different-biome AABB intersections), computed in Node ----
function aabb(r) {
  if (r.kind === "circle") return { minX: r.cx - r.r, maxX: r.cx + r.r, minZ: r.cz - r.r, maxZ: r.cz + r.r };
  return { minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ };
}
function inter(a, b) { const ix = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX); const iz = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ); return ix > 0 && iz > 0 ? ix * iz : 0; }
const regs = (d.regs || []).filter((r) => r.minX != null || r.kind === "circle");
const overlaps = [];
for (let i = 0; i < regs.length; i++) for (let j = i + 1; j < regs.length; j++) {
  const a = regs[i], b = regs[j];
  if (a.underlay || b.underlay) continue;                       // wilds/ownership underlay is not a real clash
  if (a.biome && b.biome && a.biome === b.biome) continue;      // same biome = sibling, fine
  const ov = inter(aabb(a), aabb(b));
  if (ov > 400) overlaps.push({ a: (a.name || a.biome), b: (b.name || b.biome), area: Math.round(ov) });
}
overlaps.sort((p, q) => q.area - p.area);

// ---- report (numbers only) ----
const L = [];
L.push(`TERRAIN MAP AUDIT  seed=${SEED}  step=${STEP}u  mtnThresh=${MTN}u  span=±${SPAN}u`);
L.push(`grid cells: ${d.cells}   relief max=${d.reliefMax}u  mean=${d.reliefMean}u`);
L.push(`FLAT contract: ${d.flat ? JSON.stringify(d.flat) : "(none)"}`);
L.push("");
L.push(`BIOME COVERAGE (cells | AABB):`);
Object.entries(d.biomes || {}).sort((a, b) => b[1].n - a[1].n).forEach(([b, v]) =>
  L.push(`  ${b.padEnd(12)} ${String(v.n).padStart(6)}   x[${v.minX}..${v.maxX}] z[${v.minZ}..${v.maxZ}]`));
L.push("");
L.push(`MOUNTAIN cells (relief>${MTN}u): ${d.mtnCells}  (${(100 * d.mtnCells / d.cells).toFixed(1)}% of grid)`);
L.push(`  mountain cells BY biome: ${JSON.stringify(d.mtnBiome || {})}`);
const outN = (d.mtnOutSnow || []).length, cityN = (d.cityOnMtn || []).length;
L.push("");
L.push(`>>> MOUNTAINS OUTSIDE SNOW: ${outN}${outN >= 40 ? "+" : ""} sample cells  ${outN ? "(VIOLATION — owner wants mountains snow-only)" : "(clean)"}`);
(d.mtnOutSnow || []).slice(0, 12).forEach((c) => L.push(`     (${c.x},${c.z}) h=${c.h} biome=${c.biome}`));
L.push(`>>> CITY ON MOUNTAIN: ${cityN}${cityN >= 40 ? "+" : ""} sample cells  ${cityN ? "(VIOLATION — cities must not sit on relief)" : "(clean)"}`);
(d.cityOnMtn || []).slice(0, 12).forEach((c) => L.push(`     (${c.x},${c.z}) h=${c.h} biome=${c.biome}`));
L.push("");
L.push(`REGION OVERLAPS (different-biome AABB clashes >400u²): ${overlaps.length}`);
overlaps.slice(0, 20).forEach((o) => L.push(`     ${o.a}  ✕  ${o.b}   ~${o.area}u²`));
console.log("\n" + L.join("\n") + "\n");

chrome.kill("SIGTERM"); server.kill("SIGTERM");
process.exit(0);
