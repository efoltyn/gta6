#!/usr/bin/env node
/* tools/math-gate.mjs — THE ULTRAFAST CLOSED LOOP (owner doctrine: tests are
   MATH, visuals are for the owner's eyes).

   One headless boot; per seed: build the world (the only unavoidable real
   cost), read PURE STATE, then drive the simulation BY HAND — CBZ.stepSim(dt)
   ticks the whole updater chain synchronously with NO rendering, so hundreds
   of sim ticks cost seconds of CPU instead of minutes of software-rasterized
   frames. No screenshots, no frame waits, no wall-clock "gameplay" sleeps.

   Asserts, per seed:
     • generator invariants (lots/shops/roads, shop-door reachability,
       finite region bounds) — same math as smoke-play.mjs
     • terrain/biome doctrine (grid sweep over CBZ.terrainHeight/cityBiomeAt,
       span auto-derived from CBZ.TERRAIN_FLAT so it scales with the world):
       city-on-mountain = 0, cross-biome region overlaps = 0,
       mountains-outside-snow under a small backdrop tolerance
     • sim burst: N ticks with scripted input (run + punch) — state must
       still be 'playing' and the player position finite afterwards
     • console: zero errors beyond the single known baseline ProgressEvent
   Then re-runs the FIRST seed and asserts byte-identical counts + biome
   histogram (multiplayer determinism law).

   Usage: node tools/math-gate.mjs [--seeds 90210,1337] [--ticks 400]
          [--step 50] [--mtn 25] [--nodet]
   Exit 0 = MATHGATE: ok. Anything else = FAIL (exit 1).
   Visual tools (studio/street-shot/smoke screenshot) still exist for
   owner-requested appearance work — they are NOT part of this loop. */
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const argS = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const SEEDS = argS("--seeds", "90210").split(",").map((s) => +s.trim()).filter((n) => Number.isFinite(n));
// --ticks default is 400, not 600: the delayed-updater-crash class saturates at
// tick 300 (5 sim-s @ 60/s), so 400 clears it with 33% headroom while trimming
// ~10s/run. Bump to 600 pre-deploy for extra tail headroom. (See tools/TESTING-LOOPS.md.)
const TICKS = +argS("--ticks", 400), STEP = +argS("--step", 50), MTN = +argS("--mtn", 25);
const DET = !argv.includes("--nodet");
const CALIBRATE = argv.includes("--calibrate");
// GOLDEN BASELINES (per seed) — closes the benchmark's F4/F8 blind spots
// (missing landmass, silent world shrink): counts must stay within BAND of
// the stored golden, and the BIOME NAME SET must match exactly. Update these
// deliberately when a world-content merge intends to change them — run
// `node tools/math-gate.mjs --calibrate --seeds 90210,1337` and paste.
const BIOMES_ALL = ["airport","arena","capeharbor","city","desert","farmland","forest","foundry","goldspire","kesh","kesh_east","kesh_north","keshtown","lowport","mbeya","mbeya_east","mbeya_south","mbeya_west","mbeyacity","military","neonreef","snow","solara","solaracity","speedway","veridia","veridiacity","wilds"];
const GOLDEN = {
  90210: { lots: 325, shops: 178, roads: 178, biomes: BIOMES_ALL },   // recal: snow move re-rolled Pinecrest; roads +16 = HIGHWAY_NET_V2
  1337:  { lots: 335, shops: 192, roads: 178, biomes: BIOMES_ALL },
};
const BAND = 0.12;
const MTN_OUT_SNOW_MAX = 60;   // backdrop-ring cells the audit reports on a clean world
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const tmark = (l) => console.log(`[t+${((Date.now() - T0) / 1000).toFixed(1)}s] ${l}`);

// disjoint port windows (smoke 9050+/10050+, audit 8400+/10350+, legacy lower)
async function claimPort(lo, span, probe) {
  for (let tries = 0; tries < 6; tries++) {
    const p = lo + Math.floor(Math.random() * span);
    try { await probe(p); } catch (_) { return p; }
  }
  console.error("MATHGATE: FAIL no free port near " + lo); process.exit(1);
}
const port = await claimPort(9350, 150, (p) => fetch(`http://127.0.0.1:${p}/`));
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const origin = `http://127.0.0.1:${port}/`;
{ let up = false;
  for (let i = 0; i < 40 && !up; i++) { try { await fetch(origin); up = true; } catch (_) { await sleep(100); } }
  if (!up) { console.error("MATHGATE: FAIL devserver never came up on :" + port); process.exit(1); } }
const dbg = await claimPort(10650, 200, (p) => fetch(`http://127.0.0.1:${p}/json/version`));
const profile = `/tmp/cbz-mathgate-${dbg}`;
await rm(profile, { recursive: true, force: true });
const chrome = spawn("/opt/pw-browsers/chromium", [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--enable-webgl", "--mute-audio", "--window-size=480,300",
  `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, `${origin}?seed=${SEEDS[0]}`,
], { stdio: "ignore" });

let page = null;
for (let i = 0; i < 150 && !page; i++) {
  try { const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json(); page = ps.find((p) => p.type === "page" && p.url.startsWith(origin)); } catch (_) {}
  if (!page) await sleep(100);
}
if (!page) { console.error("MATHGATE: FAIL no page"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
let id = 1; const pend = new Map(); const errors = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") {
    const d = m.params.exceptionDetails;
    errors.push(`${d.url || "?"}:${d.lineNumber} ${(d.exception && d.exception.description || d.text || "").split("\n")[0]}`);
  } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
    errors.push("console.error: " + m.params.args.map((a) => a.value || a.description || "").join(" ").slice(0, 200));
  }
});
const send = (method, params = {}) => new Promise((r) => { const i = id++; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expression) => { const r = await send("Runtime.evaluate", { expression, returnByValue: true }); return r.result && r.result.result && r.result.result.value; };
await send("Runtime.enable"); await send("Page.enable");

// the whole per-seed pass as ONE in-page expression (pure state; no frames)
const PASS = `(() => {
  const STEP=${STEP}, MTN=${MTN}, TICKS=${TICKS};
  const out = { fails: [] };
  const g = CBZ.game, A = CBZ.city && CBZ.city.arena;
  if (!A) return { fails: ["no arena"] };
  // ---- scripted input + SIM BURST (headless sim step — no rendering) ----
  const kd = (c,k) => { const e = new KeyboardEvent("keydown",{code:c,key:k,bubbles:true}); document.dispatchEvent(e); window.dispatchEvent(e); };
  const ku = (c,k) => { const e = new KeyboardEvent("keyup",{code:c,key:k,bubbles:true}); document.dispatchEvent(e); window.dispatchEvent(e); };
  const simT0 = performance.now();
  kd("KeyW","w");
  for (let i = 0; i < TICKS; i++) {
    CBZ.stepSim(1/60);
    if (i === (TICKS*0.4|0)) { ku("KeyW","w"); if (CBZ.playerChar) { CBZ.playerChar.punchKind="jab"; CBZ.playerChar.punchArm="r"; CBZ.playerChar.punchDur=0.34; CBZ.playerChar.punchT=0.34; } }
  }
  out.simMs = Math.round(performance.now() - simT0);
  if (!g || g.state !== "playing") out.fails.push("state=" + (g && g.state) + " after sim burst");
  const P = CBZ.player;
  if (!P || !P.pos || !isFinite(P.pos.x) || !isFinite(P.pos.y) || !isFinite(P.pos.z)) out.fails.push("player pos not finite");
  // ---- generator invariants (same math as smoke-play) ----
  const lots = A.lots || [], shops = A.shopLots || [], roads = A.roads || [];
  out.lots = lots.length; out.shops = shops.length; out.roads = roads.length;
  if (!lots.length) out.fails.push("no lots");
  if (shops.length < 12) out.fails.push("only " + shops.length + " shops");
  let orphans = 0;
  for (const l of shops) {
    const d = l.building && l.building.door; if (!d) { orphans++; continue; }
    let best = 1e9;
    for (const r of roads) {
      const dx = r.vertical ? Math.abs(d.x - r.x) : Math.max(0, Math.abs(d.x - r.x) - r.len / 2);
      const dz = r.vertical ? Math.max(0, Math.abs(d.z - r.z) - r.len / 2) : Math.abs(d.z - r.z);
      best = Math.min(best, Math.hypot(dx, dz));
    }
    if (best > 45) orphans++;
  }
  if (orphans) out.fails.push(orphans + " shop doors far from any road");
  let badR = 0;
  for (const r of (A.regions || [])) if (!isFinite(r.minX) || !isFinite(r.maxX)) badR++;
  if (badR) out.fails.push(badR + " regions with non-finite bounds");
  // ---- terrain/biome doctrine sweep (span derives from the FLAT contract) ----
  const flat = CBZ.TERRAIN_FLAT || { minX:-1600, maxX:1600, minZ:-1600, maxZ:1600 };
  const cx = (flat.minX + flat.maxX) / 2, cz = (flat.minZ + flat.maxZ) / 2;
  const span = Math.max(flat.maxX - flat.minX, flat.maxZ - flat.minZ) / 2 + 400;
  const biomeAt = CBZ.cityBiomeAt || (() => "?");
  const th = CBZ.terrainHeight || (() => 0), sh = CBZ.snowTerrainHeightAt || (() => 0);
  const hist = {}; let mtnOutSnow = 0, cityOnMtn = 0, cells = 0;
  for (let x = cx - span; x <= cx + span; x += STEP) for (let z = cz - span; z <= cz + span; z += STEP) {
    cells++;
    let b = "?"; try { b = biomeAt(x, z) || "?"; } catch (_) {}
    // NaN-STRICT (benchmark F7): ||0 masked NaN leaks in every loop — count
    // non-finite samples explicitly and fail on any.
    let h = 0;
    try {
      const h1 = th(x, z), h2 = sh(x, z);
      if (!Number.isFinite(h1) || !Number.isFinite(h2)) { out.nonFinite = (out.nonFinite || 0) + 1; }
      h = Math.max(h1 || 0, h2 || 0);
    } catch (_) { out.nonFinite = (out.nonFinite || 0) + 1; }
    hist[b] = (hist[b] || 0) + 1;
    if (h > MTN) {
      if (b !== "snow" && b !== "?") mtnOutSnow++;
      if (/city|urban|downtown|commerce/i.test(b)) cityOnMtn++;
    }
  }
  out.cells = cells; out.mtnOutSnow = mtnOutSnow; out.cityOnMtn = cityOnMtn;
  out.hist = JSON.stringify(Object.keys(hist).sort().map((k) => k + ":" + hist[k]));
  if (cityOnMtn > 0) out.fails.push("CITY ON MOUNTAIN: " + cityOnMtn + " cells");
  if (mtnOutSnow > ${MTN_OUT_SNOW_MAX}) out.fails.push("MOUNTAINS OUTSIDE SNOW: " + mtnOutSnow + " cells");
  // ---- cross-biome region overlaps: PEER landmasses interpenetrating is the
  // bug class (config.js's own words). Two shapes are LEGITIMATE and skipped:
  //   • nesting — a venue fully (>=85%) inside a host of another biome
  //     (the jail compound / casino venues sit INSIDE the city on purpose)
  //   • links — causeway/bridge regions deliberately touch both shores
  const aabb = (r) => r.kind === "circle" ? { minX:r.cx-r.r, maxX:r.cx+r.r, minZ:r.cz-r.r, maxZ:r.cz+r.r } : r;
  const isLink = (r) => /causeway|bridge|link/i.test(r.name || "");
  const regs = (A.regions || []).filter((r) => r && !r.underlay && (isFinite(r.minX) || r.kind === "circle"));
  let overlaps = 0; const oSamples = [];
  for (let i = 0; i < regs.length; i++) for (let j = i + 1; j < regs.length; j++) {
    const a = regs[i], b = regs[j];
    if (!a.biome || !b.biome || a.biome === b.biome) continue;
    if (isLink(a) || isLink(b)) continue;
    const A2 = aabb(a), B2 = aabb(b);
    const w = Math.min(A2.maxX, B2.maxX) - Math.max(A2.minX, B2.minX);
    const h = Math.min(A2.maxZ, B2.maxZ) - Math.max(A2.minZ, B2.minZ);
    if (w <= 0 || h <= 0 || w * h <= 400) continue;
    const areaA = (A2.maxX-A2.minX)*(A2.maxZ-A2.minZ), areaB = (B2.maxX-B2.minX)*(B2.maxZ-B2.minZ);
    if (w * h >= 0.85 * Math.min(areaA, areaB)) continue;   // nesting, not a clash
    overlaps++; if (oSamples.length < 8) oSamples.push((a.name||a.biome) + " x " + (b.name||b.biome) + " ~" + Math.round(w*h) + "u2");
  }
  out.overlaps = overlaps; out.overlapSamples = oSamples;
  if (overlaps) out.fails.push("REGION OVERLAPS: " + overlaps + " [" + oSamples.join("; ") + "]");
  if (out.nonFinite) out.fails.push("NON-FINITE terrain samples: " + out.nonFinite);
  out.peds = (CBZ.cityPeds || []).length;
  return out;
})()`;

async function runSeed(seed, label) {
  const errBefore = errors.length;
  await send("Page.navigate", { url: `${origin}?seed=${seed}` });
  // boot-complete, never an early DOM fragment (the PLAY-before-boot race)
  let ready = false;
  for (let i = 0; i < 400 && !ready; i++) { try { ready = !!(await evl("!!(window.CBZ && CBZ.game && (CBZ.bootComplete || CBZ.game.state === 'title') && CBZ.stepSim && document.getElementById('playBtn'))")); } catch (_) {} if (!ready) await sleep(150); }
  if (!ready) return { fails: ["never booted"] };
  await evl("(() => { if (CBZ.CONFIG) CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false; return true; })()");
  let playing = false;
  for (let i = 0; i < 240 && !playing; i++) { playing = await evl("(() => { if (CBZ.game && CBZ.game.state === 'playing') return true; const b = document.getElementById('playBtn'); if (b) b.click(); return CBZ.game && CBZ.game.state === 'playing'; })()"); if (!playing) await sleep(200); }
  if (!playing) return { fails: ["never reached playing"] };
  tmark(`${label}: world built`);
  const r = (await evl(PASS)) || { fails: ["pass expression returned nothing"] };
  // GOLDEN assertions (skipped in --calibrate, which prints paste-ready values)
  const gold = GOLDEN[seed];
  if (CALIBRATE) {
    console.log('  GOLDEN[' + seed + '] = { lots: ' + r.lots + ', shops: ' + r.shops + ', roads: ' + r.roads + ', biomes: ' + JSON.stringify((JSON.parse(r.hist || "[]")).map((e) => e.split(":")[0]).sort()) + ' };');
  } else if (gold) {
    const off = (v, gv, name) => { if (Math.abs(v - gv) > gv * BAND) r.fails.push("GOLDEN " + name + " " + v + " vs " + gv + " (band " + Math.round(BAND * 100) + "%)"); };
    off(r.lots, gold.lots, "lots"); off(r.shops, gold.shops, "shops"); off(r.roads, gold.roads, "roads");
    const seen = (JSON.parse(r.hist || "[]")).map((e) => e.split(":")[0]).sort();
    if (JSON.stringify(seen) !== JSON.stringify(gold.biomes)) r.fails.push("GOLDEN biome set " + JSON.stringify(seen) + " vs " + JSON.stringify(gold.biomes));
  }
  r.newErrors = errors.slice(errBefore).filter((e) => !/ProgressEvent/.test(e));
  if (r.newErrors.length) r.fails.push(r.newErrors.length + " console errors");
  tmark(`${label}: ${r.lots}/${r.shops}/${r.roads} lots/shops/roads | sim ${TICKS} ticks in ${r.simMs}ms | mtnOutSnow ${r.mtnOutSnow} cityOnMtn ${r.cityOnMtn} overlaps ${r.overlaps} | peds ${r.peds}`);
  return r;
}

const results = [];
let allFails = [];
for (const seed of SEEDS) {
  const r = await runSeed(seed, `seed ${seed}`);
  results.push({ seed, r });
  for (const f of (r.fails || [])) allFails.push(`seed ${seed}: ${f}`);
}
if (DET && results.length && !(results[0].r.fails || []).length) {
  const r2 = await runSeed(SEEDS[0], `seed ${SEEDS[0]} (det)`);
  const a = results[0].r;
  if (r2.lots !== a.lots || r2.shops !== a.shops || r2.roads !== a.roads || r2.hist !== a.hist) {
    allFails.push(`DETERMINISM: seed ${SEEDS[0]} differs across builds (${a.lots}/${a.shops}/${a.roads} vs ${r2.lots}/${r2.shops}/${r2.roads})`);
  } else tmark("determinism: ok");
  for (const f of (r2.fails || [])) allFails.push(`det rerun: ${f}`);
}

for (const { r } of results) for (const e of (r.newErrors || [])) console.log("  ERR:", e);
const head = results.map(({ seed, r }) => `${seed}:${r.lots}/${r.shops}/${r.roads}`).join(" ");
if (allFails.length) {
  console.log("MATHGATE: FAIL — " + allFails.join(" | "));
  chrome.kill("SIGTERM"); server.kill("SIGTERM");
  process.exit(1);
}
console.log(`MATHGATE: ok (${head} | ${TICKS} ticks | ${DET ? "det ok | " : ""}errors baseline-only)`);
chrome.kill("SIGTERM"); server.kill("SIGTERM");
await rm(profile, { recursive: true, force: true }).catch(() => {});
process.exit(0);
