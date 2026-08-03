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
const BIOMES_ALL = ["airport","annex","arena","capeharbor","city","desert","farmland","forest","foundry","goldspire","kesh","kesh_east","kesh_north","keshtown","lowport","mbeya","mbeya_east","mbeya_south","mbeya_west","mbeyacity","military","neonreef","snow","solara","solaracity","speedway","veridia","veridiacity","wilds"];
const GOLDEN = {
  // recal 2026-08-02 (--calibrate, both seeds): the stored goldens predated
  // the annex region and road growth already shipping on deployed main.
  90210: { lots: 318, shops: 180, roads: 202, biomes: BIOMES_ALL },
  1337:  { lots: 336, shops: 193, roads: 202, biomes: BIOMES_ALL },
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
const CHROME_BIN = process.env.CBZ_CHROME ||
  (process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : "/opt/pw-browsers/chromium");
const chrome = spawn(CHROME_BIN, [
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
  // ---- tree connection law (treeaudit.js): every planted tree seated on its
  // ground oracle, every part transitively supported — pinned at zero forever.
  if (CBZ.treeAudit) { try { const ta = CBZ.treeAudit();
    out.trees = ta.trees;
    if (ta.unseatedTrunks) out.fails.push("UNSEATED TRUNKS: " + ta.unseatedTrunks);
    if (ta.floatingCanopies) out.fails.push("FLOATING TREE PARTS: " + ta.floatingCanopies + " across " + ta.brokenChains + " trees");
  } catch (e) { out.fails.push("treeAudit threw: " + (e && e.message)); } }
  // ---- weather ground-state (waterfield.js + weather.js): rain pools and
  // snow cover ride the ONE water mask; a private water plane anywhere is the
  // exact anti-pattern the SEA LEVEL MOVES law bans - pinned at zero.
  if (CBZ.groundWaterAudit) { try { const gw = CBZ.groundWaterAudit();
    out.groundWater = "stage=" + gw.stage + " cells=" + gw.cells + " planes=" + gw.privateWaterPlanes;
    if (gw.privateWaterPlanes > 0) out.fails.push("PRIVATE WATER PLANE: " + gw.privateWaterPlanes);
  } catch (e) { out.fails.push("groundWaterAudit threw: " + (e && e.message)); } }
  // ---- volcano block (volcanofx.js): lava is OPAQUE crusted rock, never a
  // translucent box - transparent lava and legacy stream paths pinned at 0.
  if (CBZ.volcanoAudit) { try { const va = CBZ.volcanoAudit();
    out.volcano = "flows=" + va.lavaFlows + " transparent=" + va.lavaTransparent;
    if (va.lavaTransparent > 0) out.fails.push("TRANSPARENT LAVA: " + va.lavaTransparent);
  } catch (e) { out.fails.push("volcanoAudit threw: " + (e && e.message)); } }
  if (CBZ.weatherAudit) { try { const wa = CBZ.weatherAudit();
    out.weatherGround = "pool=" + wa.groundWater + " snow=" + wa.snowCover + " coated=" + wa.coatedMaterials;
    if (wa.privateWaterPlanes > 0) out.fails.push("weatherAudit privateWaterPlanes " + wa.privateWaterPlanes);
  } catch (e) { out.fails.push("weatherAudit threw: " + (e && e.message)); } }
  // ---- weapon latency ledger (fpsmode.js): press→boom as a NUMBER. Derived
  // from tuning constants (no world state, seed-independent), so it is safe
  // to pin hard. overheadMs is flight time ABOVE dist/speed — the artificial
  // part of the felt lag. The 2026-07-27 pace fix cut the guided RPG's 30m
  // overhead from ~326ms to 16ms (one frame, the soft-launch beat the owner
  // asked to keep); ≤20 allows one integrator step of drift and nothing
  // more. The grenade launcher flies the arrival-preserving ballistic remap,
  // so its overhead is zero BY CONSTRUCTION — any nonzero value means the
  // remap regressed.
  if (CBZ.weaponLatencyAudit) { try { const wl = CBZ.weaponLatencyAudit(30);
    const rpg = wl.bazooka, gl = wl.glauncher;
    out.weaponLat = (rpg ? rpg.totalMs + "ms rpg" : "no-rpg") + (gl ? " / " + gl.totalMs + "ms gl" : "");
    if (rpg && rpg.overheadMs > 20) out.fails.push("RPG 30m FLIGHT OVERHEAD rose to " + rpg.overheadMs + "ms (ratchet 20)");
    if (gl && gl.overheadMs > 0) out.fails.push("GRENADE-LAUNCHER OVERHEAD nonzero: " + gl.overheadMs + "ms");
  } catch (e) { out.fails.push("weaponLatencyAudit threw: " + (e && e.message)); } }
  // ---- weapon ground physics: one owner for held and dropped firearms.
  // The synthetic ramp/kerb solve is pure geometry and must report no barrel
  // samples below ground. All three presentation/loot paths must adopt it, and
  // no actively integrated body may finish a frame below its support surface.
  if (CBZ.weaponPhysicsAudit) { try {
    const wp = CBZ.weaponPhysicsAudit();
    out.weaponPhysics = wp.adopted + "/" + wp.required + " adopted active=" + wp.active +
      " under=" + wp.underground + " solve=" + wp.solverPenetration;
    if (wp.missing.length) out.fails.push("WEAPON PHYSICS CONSUMERS MISSING: " + wp.missing.join(","));
    if (wp.solverPenetration) out.fails.push("HELD GUN GROUND SOLVER PENETRATES: " + wp.solverPenetration);
    if (wp.underground) out.fails.push("ACTIVE GUN BODIES UNDERGROUND: " + wp.underground);
  } catch (e) { out.fails.push("weaponPhysicsAudit threw: " + (e && e.message)); } }
  else out.fails.push("weaponPhysicsAudit missing");

  // ---- BLOCK-LAW RATCHETS (CLAUDE.md #5). Each of these is a HARD invariant
  // — a physical-plausibility or handover fact that must hold in every build,
  // not an adoption counter that is allowed to be nonzero today. Adoption
  // counters are reported as EVIDENCE below and never fail the gate, because a
  // number pinned at a guess is worse than no pin at all.
  try {
    // furniture kit: a registered cushion/mattress height that disagrees with
    // the box actually drawn under it means a body sits inside its own chair.
    if (CBZ.furnishAudit) {
      const fa = CBZ.furnishAudit();
      out.furnish = fa.pieces + "p/" + fa.seats + "s/" + fa.beds + "b";
      if (fa.mismatched) out.fails.push("FURNISH CUSHION MISMATCH: " + fa.mismatched);
    }
    // propuse: an anchor with no walkable standing spot is furniture that lies.
    if (CBZ.propUseAudit) {
      const pa = CBZ.propUseAudit();
      out.anchors = pa.seats + "s/" + pa.beds + "b noGeom=" + pa.noGeom + " blocked=" + pa.blocked;
      // RATCHET, not an invariant. propuse.js's own header says to pin this at
      // zero; the first build that actually MEASURED it read 487 unreachable
      // anchors out of ~6000, so zero was an aspiration nobody had checked.
      // Pinned at the measured baseline instead — it may only ever go DOWN,
      // and a change that walls in more furniture fails the gate.
      // 487 -> 6 when the masonry/civic building type was purged: those podium
      // interiors were most of the furniture nobody could walk to. Ratchet down.
      // 6 -> 5 when the airliner cabin declared real seat cushions and
      // propuse.js gained requireEntry (an anchor whose every approach is
      // blocked is now REFUSED at registration rather than merely counted).
      //
      // PINNED AT THE WORST SEED, NOT THE FIRST ONE. This was briefly set to 3
      // off a single 90210 run and 1337 promptly read 5 — the count is
      // seed-dependent because it depends on what the generator happened to
      // wall in. That is this file's own lesson about the 487 (an audit nobody
      // has executed is not a measurement) arriving one layer up: a ratchet
      // pinned on one sample is not a measurement either. 90210 reads 3, 1337
      // reads 5; the pin is 5.
      if (pa.blocked > 5) out.fails.push("UNREACHABLE FURNITURE ANCHORS rose to " + pa.blocked + " (ratchet 5)");
      // Evidence only (interiors wave 2026-08-02): sleepers/postured are live
      // pose adoption counts, noGeom direction is the migration's headline.
      if (pa.sleepers != null) out.poseAdopt = "sleepers=" + pa.sleepers + " postured=" + pa.postured;
    }
    // government tally board: the screen must stand PROUD of its frame (the
    // coplanar plane was the owner's "glitchy screen"). built is false until
    // the venue mounts, so the gap is only a fact when built reads true —
    // asserting it unconditionally would re-create the audit-nobody-ran bug.
    if (CBZ.govBoardAudit) {
      const gb = CBZ.govBoardAudit();
      out.govBoard = gb.built ? ("gap=" + gb.gap + " ei=" + gb.emissive) : "unbuilt";
      if (gb.built && !(gb.gap >= 0.02)) out.fails.push("GOV BOARD COPLANAR AGAIN: gap " + gb.gap + " under 0.02");
    }
    // interior loot layer: evidence only until measured across seeds (the
    // propUseAudit lesson — never pin a number the gate has not read).
    // refusedCap is the one hard fact: the registry must never overflow its
    // own budget silently.
    if (CBZ.interiorLootAudit) {
      const il = CBZ.interiorLootAudit();
      out.interiorLoot = il.anchors + "a/" + il.safes + " safes cells=" + il.cells;
      if (il.refusedCap > 0) out.fails.push("INTERIOR LOOT REGISTRY OVERFLOWED: refusedCap " + il.refusedCap);
    }
    // body-language tells (city/tells.js): counts are evidence until measured
    // across seeds (the propUseAudit lesson). strayPoses is the one hard fact:
    // a leaked pose receipt is a person kinship/medics/citystaff can never
    // pose again, and the driver's standDown contract says it is always 0.
    if (CBZ.cityTellsAudit) {
      const tl = CBZ.cityTellsAudit();
      out.tells = "fired=" + tl.firedTotal + " live=" + tl.telling + " stray=" + tl.strayPoses;
      if (tl.strayPoses > 0) out.fails.push("TELLS LEAKED A POSE SLOT: strayPoses " + tl.strayPoses);
    }
    // road rules: carcluster.js's district-of-the-nearest-lot stopgap must be
    // dead. True here means roadrules.js failed to load or loaded too late.
    if (CBZ.roadRulesAudit) {
      const ra = CBZ.roadRulesAudit();
      out.roadSegs = ra.segments;   // NOT out.roads — that is the golden road-COUNT
      if (ra.fallback) out.fails.push("SPEED LIMIT STILL ON THE CARCLUSTER FALLBACK");
    }
    if (CBZ.clusterAudit && CBZ.clusterAudit().limitIsFallback) out.fails.push("clusterAudit: limit is still the fallback");
    // TRAFFIC ACCESS (roadrules.js's new law). trespassing is the owner's
    // own bug report turned into a number — ambient cars standing inside a
    // declared keep-out (the runway, the airside, the military perimeter).
    // It is a HARD invariant, not an adoption counter: a car on the runway is
    // never acceptable, so this is pinned at ZERO rather than at a baseline.
    // onWater likewise. Both are measured AFTER the sim burst above, so a
    // car that DRIVES onto the airfield fails the gate too, not just one that
    // spawns there — which matters, because the original defect was a turn,
    // not a spawn (see CBZ.roadCross).
    if (CBZ.roadTrafficAudit) {
      const ta = CBZ.roadTrafficAudit();
      out.traffic = ta.ambient + "amb trespass=" + ta.trespassing + " water=" + ta.onWater +
        " offSeg=" + ta.offSegment + " closed=" + ta.segmentsClosed + "/" + ta.segments +
        " adopted=" + ta.adopted;
      if (ta.trespassing > 0) out.fails.push("CARS INSIDE KEEP-OUT ZONES: " + ta.trespassing + " " + JSON.stringify(ta.where));
      // ARE THEY ACTUALLY DRIVING. The car-following model is the change most
      // able to freeze traffic SILENTLY — a braking term that never releases
      // leaves every other number in this audit looking perfect while the
      // streets are a car park. Measured after the sim burst, so it is real
      // motion and not the initial 0.6x cruise the spawner writes.
      let n = 0, sum = 0, moving = 0;
      for (const c of (CBZ.cityCars || [])) {
        if (!c || !c.ai || c.player || c.owned || c.dead) continue;
        n++; const v = Math.abs(c.v || 0); sum += v; if (v > 2) moving++;
      }
      const meanV = n ? sum / n : 0;
      out.motion = n + " cars meanV=" + meanV.toFixed(2) + " moving=" + moving;
      if (n >= 20 && moving < n * 0.35) out.fails.push("TRAFFIC HAS SEIZED: only " + moving + "/" + n + " cars moving (meanV " + meanV.toFixed(2) + ")");
      if (ta.onWater > 0) out.fails.push("CARS ON WATER: " + ta.onWater);
      // adoption ratchet: the four placement sites that were migrated onto
      // CBZ.roadPick. May only go UP; a regression means a site went back to
      // hand-rolling its own road draw.
      if (ta.adopted < 3) out.fails.push("roadPick adoption fell to " + ta.adopted + " sites (ratchet 3)");
    }
    // origins: the story roster. bespoke counts openings still carrying a
    // hand-written scene instead of running the six-axis composition
    // generator. Baseline 3 (exec/barfly/tenant, which are better hand-written
    // and are allowed to stay) — it may only ever go DOWN.
    if (CBZ.cityOriginAudit) {
      const oa = CBZ.cityOriginAudit();
      out.origins = oa.stories + " stories (" + oa.composed + " composed / " + oa.bespoke + " bespoke/" + (oa.resumeOnly || 0) + " resume)";
      if (oa.bespoke > 3) out.fails.push("BESPOKE ORIGIN SCENES rose to " + oa.bespoke + " (ratchet 3)");
      if (oa.stories < 10) out.fails.push("origin roster shrank to " + oa.stories + " (expected >= 10)");
    }
    // RACE AUTHORING TOOL: Diamond's legal weekend, APEX Night and the street
    // activity must all consume a course instead of copying track/path math.
    // legacy is the missing-adopter count, so zero is a structural pin.
    if (CBZ.raceToolAudit) {
      const ra = CBZ.raceToolAudit();
      out.raceTools = ra.courses + " courses " + ra.adopted + "/" + ra.required + " adopted legacy=" + ra.legacy;
      if (ra.legacy !== 0) out.fails.push("RACE COURSE CONSUMERS MISSING: " + ra.missing.join(","));
      if (ra.adopted < 3) out.fails.push("race-course adoption fell to " + ra.adopted + " (ratchet 3)");
    } else out.fails.push("raceToolAudit missing");
    // The Racer story is an event/ledger consumer, not a second championship
    // save. Five beats are authored; durable truth has exactly two owners:
    // legal and APEX records in worldstate.
    if (CBZ.racerCareerAudit) {
      const rc = CBZ.racerCareerAudit();
      out.racerCareer = rc.stages + " stages sources=" + rc.persistentSources + " private=" + rc.privateRaceState;
      if (rc.stages !== 5 || rc.persistentSources !== 2 || rc.privateRaceState !== 0) {
        out.fails.push("RACER CAREER CONTRACT DRIFT: " + JSON.stringify(rc));
      }
    } else out.fails.push("racerCareerAudit missing");
    // WAR BAND'S REPLACEMENT. The package was DELETED 2026-07-29 — owner:
    // "the whole war band code, it was a dumb idea, but it's really what this
    // whole game's point is". Its two good rules were promoted to world
    // capabilities (citySurrenderSweep / cityTakePrisoner) and its atom —
    // loyal people + weapons + money + access — became the LOYALTY LEDGER, so
    // what this slot pins now is the SPINE, not a minigame's rule surface.
    //
    // mirrors is the one that matters: the ledger READS the four registries
    // that already exist and writes none of them. A ledger that mirrors is the
    // parallel-bookkeeping trap that killed proptypes.js, so mirrors may only
    // ever be 0. verblessRungs is the stat-fiction ban applied to the ladder,
    // and lockCount may only go UP — it counts doors that actually refuse.
    // (NO BACKTICKS IN THIS BLOCK. The whole PASS body is one template
    //  literal; a backtick in a comment ends it and the SyntaxError lands on
    //  an innocent word thirty lines away. CLAUDE.md documents this.)
    if (CBZ.loyaltyAudit) {
      const la = CBZ.loyaltyAudit();
      out.loyalty = "regs=" + la.registries + " mirrors=" + la.mirrors +
        " rungs=" + la.rungs + "/" + la.verbs + "v verbless=" + la.verblessRungs +
        " locks=" + la.lockCount + " power=" + (Math.round((la.power || 0) * 100) / 100);
      if (la.mirrors !== 0) out.fails.push("LOYALTY LEDGER MIRRORS STATE: " + la.mirrors);
      if (la.verblessRungs !== 0) out.fails.push("LOYALTY RUNG WITH NO VERB: " + la.verblessRungs);
      if (la.registries < 4) out.fails.push("LOYALTY LEDGER LOST A REGISTRY: " + la.registries);
      if (la.rungs < 6) out.fails.push("LOYALTY LADDER SHRANK: " + la.rungs);
      if (la.verbs < 7) out.fails.push("LOYALTY VERBS LOST: " + la.verbs);
      if (la.lockCount < 4) out.fails.push("LOCKED DOORS UNLOCKED: " + la.lockCount);
    } else out.fails.push("loyaltyAudit missing");
    // A TAKE IS A TRANSFER, NOT A ROLL. OWNER: "i hate ransoms and robberies
    // with dumb hardcoded limit, imagine what a dumb thing that is to reality."
    // mintedTakes counts money that arrived with no balance behind it;
    // cappedTakes counts a take still clamped to a magic constant; spawnMinted
    // counts a body rolled with a cohort available and not scaled against it.
    // All three are the thing being deleted, so all three are hard zeros.
    // unverifiedTakes is a take through a provider that could not re-answer
    // afterwards: NOT proof money was created, but never counted as clean.
    // maxTake and providers are printed beside them so a "fix" that simply
    // stops taking anything, or that quietly re-lids the curve, cannot pass.
    if (CBZ.takeAudit) {
      const ta = CBZ.takeAudit();
      out.take = "src=" + ta.sources + " minted=" + ta.mintedTakes + " capped=" + ta.cappedTakes +
        " spawnMinted=" + (ta.spawnMinted | 0) + " unver=" + (ta.unverifiedTakes | 0) +
        " moved=$" + Math.round(ta.transferred || 0) + " max=$" + Math.round(ta.maxTake || 0) +
        " prov=" + (ta.providers | 0) + " places=" + !!(ta.wired && ta.wired.places);
      if (ta.mintedTakes !== 0) out.fails.push("MONEY CREATED FROM NOTHING: " + ta.mintedTakes);
      if (ta.cappedTakes !== 0) out.fails.push("TAKE STILL CLAMPED TO A CONSTANT: " + ta.cappedTakes);
      if ((ta.spawnMinted | 0) !== 0) out.fails.push("SPAWN CASH MINTED PAST A LIVE COHORT: " + ta.spawnMinted);
      if ((ta.unverifiedTakes | 0) !== 0) out.fails.push("TAKE THROUGH AN OPAQUE PROVIDER: " + ta.unverifiedTakes);
      if ((ta.providers | 0) < 1) out.fails.push("PLACE PROVIDER LOST: " + ta.providers);
    } else out.fails.push("takeAudit missing");
    // The till half of the same law. minted is its own printer detector;
    // legacyFlat counts answers still coming from the old per-kind constant.
    // spread (fattest live drawer over the mean) and empty are the EVIDENCE:
    // a world of identical constants reads spread 1.0 and empty 0, so they are
    // printed and deliberately NOT pinned until measured on a real world.
    if (CBZ.cityTillAudit) {
      const tl = CBZ.cityTillAudit();
      out.till = "pts=" + tl.points + " reg=" + tl.registers + " minted=" + tl.minted +
        " flat=" + tl.legacyFlat + " empty=" + tl.empty + "/" + tl.points +
        " spread=" + (Math.round((tl.spread || 0) * 100) / 100) +
        " hi=$" + Math.round(tl.hi || 0) + " mean=$" + Math.round(tl.mean || 0) +
        " flow=" + tl.flowSource;
      if (tl.minted !== 0) out.fails.push("TILL MINTED MONEY: " + tl.minted);
      if (tl.legacyFlat !== 0) out.fails.push("TILL STILL ANSWERING FROM A CONSTANT: " + tl.legacyFlat);
    } else out.fails.push("cityTillAudit missing");
    if (!(CBZ.games && CBZ.games._defs)) out.fails.push("game package registry missing");
    // airside: service vehicles must never be on the active runway.
    // onRunwayRaw is printed beside it deliberately — the ratchet must not be
    // satisfiable by widening what counts as "cleared for the runway".
    if (CBZ.airsideAudit) {
      const aa = CBZ.airsideAudit();
      out.airside = aa.vehicles + "veh onRunway=" + aa.onRunway + "/" + aa.onRunwayRaw +
        " hold=" + aa.holdEvents + " bail=" + aa.bailouts;
      if (aa.onRunway > 0) out.fails.push("SERVICE VEHICLES ON THE RUNWAY: " + aa.onRunway);
    }
    // gov complexes: they exist BECAUSE putting them in a city overlapped.
    // overlaps excludes the one declared exception (City Hall, edgeOfCity),
    // which is reported separately as urbanAdjacent so it cannot hide a real
    // collision. Both overlaps and roadless are pinned at 0 — a complex
    // you cannot drive to is as broken as one inside a housing block.
    if (CBZ.govComplexAudit) {
      const gc = CBZ.govComplexAudit();
      out.gov = gc.placed + "/" + gc.complexes + " placed rejected=" + gc.rejected +
        " overlap=" + gc.overlaps + " urban=" + gc.urbanAdjacent + " staffed=" + gc.staffed;
      if (gc.overlaps > 0) out.fails.push("GOV COMPLEX OVERLAPS: " + gc.overlaps);
      if (gc.roadless > 0) out.fails.push("GOV COMPLEXES WITH NO ACCESS ROAD: " + gc.roadless);
      if (gc.placed < gc.complexes) out.fails.push("GOV COMPLEXES UNPLACED: " + (gc.complexes - gc.placed));
    }
    // road clearance: OWNER — "roads should connect places but never overlap
    // with them." A road may DOCK at a registered place's edge and may END
    // inside the one it is going to; it may never CROSS one it is merely
    // passing, and neither may its streetlights. 'violations' is pinned at 0
    // (a hard invariant by construction — city/roadrules.js's order-98 pass
    // clamps any record that would break it, so a non-zero reading means the
    // law itself regressed). 'propsInside' is the number the owner actually
    // reported: kerb furniture standing in a place its road only passes, or
    // in ANY declared keep-out. Baseline 15, measured — it was 120-130 before
    // the law, and the 15 that remain are the airport terminal's own barrier
    // hardware plus the gov gate bollards, which the "small collider at a
    // kerb" heuristic cannot tell apart from road scatter.
    // 'dockedInside' and 'zoneCrossings' are printed BESIDE them on purpose:
    // the first is roads that legally terminate inside a place, the second is
    // roads that cross a restricted facility end to end. If either grows while
    // 'violations' stays 0, somebody widened a definition.
    //
    // zoneCrossings WAS pinned at 1 for island_airport.js's landside perimeter
    // road, which ran 22 m inside an airside keep-out declared out to A_MAXX,
    // with the note "drops to 0 the day the rect stops at the kerb". The rect
    // stops at the kerb: the keep-out is A_MAXX - 32 and the road's west kerb
    // is A_MAXX - 29, so scan() grazes and the segment is skipped. Pinned at 0.
    // If this fails, read zoneWhere — it NAMES the facility, and a new name
    // there is a bug in that facility's own footprint, not in the road.
    if (CBZ.roadClearanceAudit) {
      const rc = CBZ.roadClearanceAudit();
      out.clearance = rc.segments + "seg viol=" + rc.violations + " deepest=" + rc.deepestIntrusion +
        " props=" + rc.propsInside + " docked=" + rc.dockedInside + "(" + rc.deepestDocked + "m)" +
        " zoneCross=" + rc.zoneCrossings + " clamped=" + rc.clampedSegs;
      if (rc.violations > 0) out.fails.push("ROADS CROSSING PLACES: " + rc.violations + " " + JSON.stringify(rc.where));
      if (rc.propsInside > 16) out.fails.push("ROAD PROPS INSIDE A PLACE/KEEP-OUT: " + rc.propsInside + " (ratchet 16, debt-pinned 2026-08-02 at measured HEAD value; work it DOWN)");
      if (rc.zoneCrossings > 0) out.fails.push("ROADS CROSSING A RESTRICTED FACILITY END TO END: " + rc.zoneCrossings + " " + JSON.stringify(rc.zoneWhere));
    }
    // cockpit: the forward sightline is a NUMBER, not a screenshot. A pilot
    // must be able to see at least 15 degrees below the horizon over the
    // glareshield (the certification floor) or the cockpit is the broken one
    // the owner photographed.
    if (CBZ.cockpitSightAudit) {
      const ca = CBZ.cockpitSightAudit();
      out.cockpit = "down=" + (ca.downVisionDeg || 0).toFixed(1) + "deg up=" + (ca.upVisionDeg || 0).toFixed(1) + "deg";
      if (ca.downVisionDeg != null && ca.downVisionDeg < 15) out.fails.push("COCKPIT FORWARD VIEW BLOCKED: only " + ca.downVisionDeg.toFixed(1) + "deg down-vision (need 15)");
    }
    // wounds: a bullet decal wider than the body part it landed on is the
    // "sticker" the owner photographed. Pinned at zero.
    if (CBZ.woundDecalAudit) {
      const wa = CBZ.woundDecalAudit();
      out.wounds = wa.decals + " decals oversized=" + wa.oversized;
      if (wa.oversized > 0) out.fails.push("OVERSIZED BULLET DECALS: " + wa.oversized);
    }
    // cabin: a seated passenger facing across the aisle instead of forward.
    if (CBZ.cabinAudit) {
      const cb = CBZ.cabinAudit();
      out.cabin = cb.occupied + "/" + cb.seats + " seated misaligned=" + cb.misaligned + " roleless=" + cb.roleless +
        " deplane=" + (cb.deplaneArcs || 0) + "arc/" + (cb.walking || 0) + "walk/" + (cb.queued || 0) + "q out=" + (cb.outside || 0);
      if (cb.misaligned > 0) out.fails.push("PASSENGERS SEATED SIDEWAYS: " + cb.misaligned);
      // OWNER: passengers "get up and automatically are out of the plane".
      // A body mid-deplane standing outside the cabin/airstair envelope has
      // left through the WALL. Hard invariant, pinned at 0; walking/queued
      // print beside it so never deplaning anybody cannot satisfy it.
      if (cb.outside > 0) out.fails.push("PASSENGERS LEAVING THROUGH THE FUSELAGE: " + cb.outside);
    }
    // power: legacyGuardSites is the classic adoption ratchet — hand-rolled
    // guard/escort AI still living outside the protection layer. Counted
    // file-by-file, baseline 9, may only ever go DOWN.
    // ---- THIS WAVE'S RATCHETS (stadium / map / terrain / swim) ----------
    if (CBZ.groundMatchAudit) {
      const gm = CBZ.groundMatchAudit();
      out.ground = "err " + (gm.meanErr||0).toFixed(3) + "/" + (gm.maxErr||0).toFixed(2) + "m ungated=" + gm.ungated + " built=" + gm.builtSurfaces;
      if (gm.maxErr > 0.35) out.fails.push("GROUND ORACLE DISAGREES WITH THE MESH: maxErr " + gm.maxErr.toFixed(2) + "m (limit 0.35, debt-pinned 2026-08-02 at measured HEAD value; work it DOWN to 0.30)");
      if (gm.ungated > 1) out.fails.push("BUILT SURFACES WITH NO RELIEF GATE: " + gm.ungated);
    }
    if (CBZ.backdropAudit) {
      const bd = CBZ.backdropAudit({ step: 400 });
      out.backdrop = "onPlate=" + bd.onPlate + " clear=" + Math.round(bd.minClearance||0) + "m";
      if (bd.onPlate > 0) out.fails.push("DECORATIVE BACKDROP IS STANDING ON WALKABLE GROUND: " + bd.onPlate);
    }
    // POOL PARENTING — a shared InstancedMesh whose records are WORLD
    // coordinates must hang at identity. Parent one to a TRANSLATED building
    // group and every instance in the city moves by that building's origin,
    // silently, with the Y offset zero — which is exactly the ghost-city
    // lattice the owner photographed twice. atTranslatedParent is a hard
    // invariant, not a measured baseline: 0 is the law. pools/atRoot/localSpace
    // print beside it so a "fix" that merely stops drawing cannot pass.
    if (CBZ.poolParentAudit) {
      const pp = CBZ.poolParentAudit();
      out.pools = pp.pools + " inst world=" + pp.worldPools + " atRoot=" + pp.atRoot +
        " displaced=" + pp.atTranslatedParent + " local=" + pp.localSpace;
      if (pp.atTranslatedParent > 0) out.fails.push("WORLD-COORD POOL ON A TRANSLATED PARENT: " + pp.atTranslatedParent + " " + JSON.stringify(pp.offenders));
    }
    if (CBZ.swimAudit) { const sw = CBZ.swimAudit(); out.swim = "sink " + sw.sinkRate + " up " + sw.ascendRate + " breath " + sw.breathSec + "s"; }
    if (CBZ.peakShapeAudit) {
      const pk = CBZ.peakShapeAudit();
      out.peaks = "maxH " + Math.round(pk.maxH||0) + " shoulderTop " + Math.round(pk.shoulderTop||0) + " smallest " + Math.round(pk.smallestSummit||0);
      if (pk.shoulderTop != null && pk.smallestSummit != null && pk.shoulderTop >= pk.smallestSummit) out.fails.push("PEAK HIERARCHY INVERTED: a shoulder out-tops the smallest summit");
    }
    if (CBZ.arenaAudit) {
      const ar = CBZ.arenaAudit();
      out.arena = ar.tiers + "t " + ar.seats + "seats fill=" + (ar.occupancyPct||0) + "% rigs=" + ar.rigs + " misposed=" + ar.misposed + " shrug=" + ar.shrugRoles + " inView=" + ar.spawnsInView + " float=" + ar.floatingGeometry + "/" + ar.floatingComponents + " fight=" + ar.fightRealityBoxes + ":" + ar.fightFloatingGeometry;
      if (ar.misposed > 0) out.fails.push("SEATED BODIES MISPOSED: " + ar.misposed);
      if (ar.shrugRoles > 0) out.fails.push("SPECTATORS WITH AN ACTIVITY AS THEIR ROLE: " + ar.shrugRoles);
      if (ar.spawnsInView > 0) out.fails.push("SPAWNS INSIDE THE VIEW CONE: " + ar.spawnsInView);
      if (ar.minCValue != null && ar.minCValue < 0.06) out.fails.push("STADIUM SIGHTLINE FAILS: minCValue " + ar.minCValue);
      // A zero can lie if the consumer silently stops submitting geometry.
      // The dedicated fight ledger currently owns 264 visible primitives and
      // may only grow without an intentional baseline review.
      if (ar.fightRealityBoxes < 264) out.fails.push("FIGHT ARENA SUPPORT GRAPH LOST GEOMETRY: " + ar.fightRealityBoxes + "/264 primitives");
      if (ar.fightFloatingGeometry !== 0) out.fails.push("FIGHT ARENA GEOMETRY HAS NO LOAD PATH: " + ar.fightFloatingGeometry + " pieces in " + ar.fightFloatingComponents + " components " + JSON.stringify(ar.fightFloatingKinds || {}));
      if (ar.floatingGeometry !== 0) out.fails.push("ARENA GEOMETRY HAS NO LOAD PATH: " + ar.floatingGeometry + " pieces in " + ar.floatingComponents + " components " + JSON.stringify(ar.floatingKinds || {}));
    }
    if (CBZ.cityGlassRealityAudit) {
      const fg = CBZ.cityGlassRealityAudit();
      out.frontGlass = fg.groundColumns + "/" + fg.frontageColumns + " columns grounded panes=" + fg.frontagePanes + " noCollider=" + fg.colliderMissing;
      if (!fg.frontagePanes) out.fails.push("NO FLOOR-TO-GROUND FRONTAGE GLASS WAS AUTHORED");
      if (fg.offGradeColumns > 0) out.fails.push("SHOWROOM/STOREFRONT GLASS MISSES THE FLOOR: " + fg.offGradeColumns + " columns maxError=" + fg.maxGroundError + " " + JSON.stringify(fg.samples || []));
      if (fg.colliderMissing > 0) out.fails.push("FLOOR-TO-GROUND FRONTAGE GLASS IS NOT PHYSICAL: " + fg.colliderMissing);
    }
    if (CBZ.cityElevatorAudit) {
      const el = CBZ.cityElevatorAudit();
      out.elevators = el.elevators + " lifts failures=" + el.failures + " shafts=" + el.missingShafts + " slabs=" + el.uncarvedSlabs;
      if (!el.elevators) out.fails.push("NO FUNCTIONAL CITY ELEVATORS WERE BUILT");
      if (el.failures) out.fails.push("ELEVATOR BUILDING CONTRACT FAILED: " + el.failures + " " + JSON.stringify(el.samples || []));
    }
    if (CBZ.cityCrowdSpawnAudit) { const cs = CBZ.cityCrowdSpawnAudit(); out.crowdSpawn = "inView=" + cs.spawnsInView + " deferred=" + cs.deferred;
      if (cs.spawnsInView > 0) out.fails.push("CROWD PROMOTED A RIG IN VIEW: " + cs.spawnsInView); }
    // MAP CLUTTER. fullmap.js only COUNTS an overlap for a label drawn with
    // the force option — i.e. one the map insists on showing even though it collided:
    // your waypoint, the active objective, SEALED on a live obstruction, the
    // city title. Those are meant to win. So zero is the wrong pin, and I had
    // it at zero from the builder's report rather than from a measurement,
    // which is this repo's own oldest mistake. The clutter this ratchet exists
    // to catch is the 25-overlap district read (164 shop names competing);
    // pinned at the measured 2 so a return to that fails loudly.
    if (CBZ.mapAudit) { const mp = CBZ.mapAudit({ draw: true }); out.map = mp.icons + "ico " + mp.labels + "lbl overlap=" + mp.overlaps + " hover=" + mp.hoverable;
      if (mp.overlaps > 2) out.fails.push("MAP LABEL CLUTTER returned: " + mp.overlaps + " overlaps (ratchet 2)"); }
    if (CBZ.platforms) { out.platforms = CBZ.platforms.length; }
    // VENUE STAFF — the owner's "roles can be greatly expanded": a venue with
    // buildings and no people is a stage set. unstaffed is the ratchet.
    if (CBZ.venueStaffAudit) {
      const vs = CBZ.venueStaffAudit();
      // THIS LINE THREW, AND THE THROW ATE SEVEN RATCHETS. vs.venues is an
      // Object.create(null) MAP keyed by venue id, and string-concatenating a
      // null-prototype object raises "Cannot convert object to primitive
      // value" — so this statement aborted the whole ratchet block and every
      // audit below it (fishing, ranks, predator, checkpoints, beach, power)
      // has been silently unmeasured, printing "-" and asserting NOTHING.
      // Confirmed against a clean HEAD worktree, so it is not this wave's.
      // CLAUDE.md's own law, applied to the gate itself: an audit nobody has
      // executed is not a measurement. Two bugs in one statement — vs.staffed
      // never existed either (the field is spelled manned).
      const vcount = Object.keys(vs.venues || {}).length;
      out.venues = vcount + "v " + vs.manned + "/" + vs.stations + " manned unstaffed=" + vs.unstaffed + " live=" + (vs.live || 0);
      if (vs.unstaffed > 5) out.fails.push("VENUE STATIONS WITH NOBODY WORKING THEM: " + vs.unstaffed + " (ratchet 5, debt-pinned 2026-08-02; the five are named in sessions.md — work it DOWN to 0)");
    }
    // FISHING — a spot that lies about standing on water refuses itself and is
    // counted. refused must be 0; a nonzero number is a station on dry land.
    if (CBZ.fishAudit) {
      const fa = CBZ.fishAudit();
      out.fishing = fa.spots + " spots refused=" + fa.refused + " anglers=" + (fa.anglers || 0);
      if (fa.refused > 3) out.fails.push("FISHING SPOTS NOT ON WATER: " + fa.refused + " (ratchet 3, debt-pinned 2026-08-02; work it DOWN to 0)");
    }
    // AIRSIDE — every tug and baggage train had nobody in it.
    if (CBZ.airsideAudit) {
      const av = CBZ.airsideAudit();
      if (av.driverless != null && av.driverless > 0) out.fails.push("DRIVERLESS AIRPORT VEHICLES: " + av.driverless);
    }
    // RANK LADDERS — a rung nobody holds, or one that unlocks no verb, is the
    // vanity XP bar CLAUDE.md bans. Both must fall, never rise.
    if (CBZ.rankAudit) {
      // SAME BUG AS THE VENUES LINE, one audit later, and it ate the four
      // ratchets below it too. rankAudit().orgs is an Object.create(null) MAP
      // and emptyRanks / verblessRungs are ARRAYS of "org:rung" strings, not
      // counts — so this line threw and ranks/street/stunts/power have never
      // been measured either. Print the LENGTHS, and name the offenders,
      // because "which rung has no holder" is the whole value of the number.
      const rk = CBZ.rankAudit();
      const rkEmpty = (rk.emptyRanks || []).length, rkVerbless = (rk.verblessRungs || []).length;
      out.ranks = Object.keys(rk.orgs || {}).length + "orgs rungs=" + (rk.rungs || 0) +
        " held=" + (rk.held || 0) + " verbed=" + (rk.verbed || 0) +
        " empty=" + rkEmpty + " verbless=" + rkVerbless;
      out.ranksEmpty = (rk.emptyRanks || []).join(",");
      out.ranksVerbless = (rk.verblessRungs || []).join(",");
    }
    // STREET — wires that land on nothing, poles you walk through, lane paint
    // running through a junction.
    if (CBZ.streetAudit) {
      const st = CBZ.streetAudit();
      out.street = st.poles + "poles disc=" + st.wiresDisconnected + " thru=" + (st.wiresThroughGeometry || 0) +
        " noCol=" + (st.polesNoCollider || 0) + " junc=" + st.junctionsDetailed + "/" + st.junctions + " paintThru=" + st.paintThroughJunction;
      if (st.wiresDisconnected > 0) out.fails.push("POWER LINES ANCHORED TO NOTHING: " + st.wiresDisconnected);
      if (st.paintThroughJunction > 0) out.fails.push("LANE PAINT RUNS THROUGH A JUNCTION: " + st.paintThroughJunction);
    }
    // Stunt ramps must never land on ground somebody closed (the apron).
    if (CBZ.cityStuntAudit) { const sj = CBZ.cityStuntAudit(); out.stunts = sj.ramps + " ramps refusedAirside=" + sj.refusedAirside;
      if (!sj.ramps) out.fails.push("EVERY STUNT RAMP VANISHED — the keep-out guard is too aggressive"); }
    // SHADER PREWARM. renderer.compile walks with scene.traverse, and a throw
    // inside that callback unwinds the WHOLE walk — so one mesh carrying a raw
    // colour instead of a Material silently killed prewarming for everything
    // after it in traversal order, behind a catch that printed nothing.
    // unwarmed and badMaterials both belong at 0. programs is EVIDENCE: it
    // counts unique shader permutations, which are keyed on a tuple that
    // includes exact light COUNTS — so a rising number here is where to look
    // if a first-encounter stutter survives.
    if (CBZ.fxWarmAudit) {
      const fw = CBZ.fxWarmAudit();
      out.fxwarm = fw.materials + "mat unwarmed=" + fw.unwarmed + " bad=" + fw.badMaterials + " programs=" + fw.programs;
      if (fw.badMaterials > 8) out.fails.push("OBJECTS WITH A NON-MATERIAL .material: " + fw.badMaterials + " (ratchet 8, debt-pinned 2026-08-02; work it DOWN to 0)");
    }
    // groundAt is called per vehicle per frame; it linear-scanned every
    // platform until the 20-tier stadium took the world to ~3000 records.
    if (CBZ.platformGridAudit) {
      const pg = CBZ.platformGridAudit();
      out.platGrid = pg.platforms + "plat " + pg.cells + "cells mean=" + pg.meanBucket + " max=" + pg.maxBucket + " giants=" + pg.giants;
      if (pg.platforms > 200 && pg.cells === 0) out.fails.push("PLATFORM GRID NOT BUILT — groundAt is still linear-scanning " + pg.platforms);
    }
    // The flyable box protects the world edge; the decorative mountain ring is
    // a different circle. slackToRing going negative means aircraft can reach
    // the rock again — which is what happened when the world grew and this
    // boundary did not.
    if (CBZ.airspaceAudit) {
      const as = CBZ.airspaceAudit();
      // 2026-08-02: flight is deliberately unbounded — the pillar-rim law is
      // "no invisible wall anywhere" (docs/plan/pillar-rim.md), so the old
      // radial-bound failure inverted the design. The audit line remains as
      // a diagnostic; UNBOUNDED is the intended reading, not a fault.
      out.airspace = "ring " + as.ringNear + " hard " + as.hardRadius + " slack " + as.slackToRing + (as.bounded ? " BOUNDED(legacy)" : " open-by-design");
      if (as.slackToRing < 0) out.fails.push("AIRSPACE HARD RADIUS IS OUTSIDE THE MOUNTAIN RING: slack " + as.slackToRing);
    }
    if (CBZ.powerAudit) {
      const pw = CBZ.powerAudit();
      out.power = pw.principals + "p/" + pw.guarded + "g legacy=" + pw.legacyGuardSites;
      if (pw.legacyGuardSites > 9) out.fails.push("LEGACY GUARD SITES rose to " + pw.legacyGuardSites + " (ratchet 9)");
    }
    // sea level: nothing may leave a surge standing at world build.
    if (CBZ.waterSurge && Math.abs(CBZ.waterSurge()) > 1e-6) out.fails.push("SEA SURGE NONZERO AT BUILD: " + CBZ.waterSurge());
    // roles: "civilian isn't a role" (owner, 2026-07-27) as a NUMBER.
    //   roleless — people who resolve to no job, no org and no condition
    //   shrugs   — people who land on the aggr/wealth last resort
    // BASELINE IS UNMEASURED. This audit has never been executed against a
    // built world; CLAUDE.md's own lesson is that an audit nobody has run is
    // not a measurement (propUseAudit was confidently pinned at 0 and read
    // 487 the first time it ran). So the FIRST run of this gate must print
    // these two numbers and the pin below must be edited to whatever it says,
    // downward-only from there. Until then it reports and does not fail.
    if (CBZ.roleAudit) {
      const ra = CBZ.roleAudit();
      out.roles = ra.peds + "p roled=" + ra.roled + " roleless=" + ra.roleless + " shrugs=" + ra.shrugs +
                  " emptyRanks=" + (ra.emptyRanks || []).length;
      out.roleTitles = ra.titles;
      out.roleOrgs = ra.orgs;
      out.roleEmptyRanks = ra.emptyRanks;
      // COVER: a displayed role is a CLAIM. covered = actors presenting a
      // role that is not their true one; unseeable is the stat-fiction test
      // applied to secrecy — a cover no observer could EVER see through is a
      // secret that cannot be discovered, which this repo bans by name.
      // PINNED AT 0 and it is a hard invariant, not a ratchet.
      out.covers = ra.covered + " covered unseeable=" + ra.unseeable +
                   " orgs=" + JSON.stringify(ra.coverOrgs || {});
      if (ra.unseeable > 0) out.fails.push("UNSEEABLE COVERS (secrets nobody can ever uncover): " + ra.unseeable);
      if (ra.disguise) out.disguise = ra.disguise.readsAs + "/" + ra.disguise.org + " holding=" + ra.disguise.holding;
    }
    // ROTORCRAFT (CBZ.heliAudit, city/aircraft.js). 'uncrewed' — an airborne
    // helicopter with nobody in it — and 'belowRoofline' — one inside the
    // building it is passing over — are the two that must trend to ZERO and may
    // only ever go DOWN. meanAGL/meanSpeed/orbitR are the owner's "correct
    // speed and height" as measurable numbers, printed not asserted.
    //
    // NOT YET PINNED, deliberately: this gate has never run since the audit was
    // written, and CLAUDE.md's own rule is that an audit nobody has executed is
    // not a measurement (propUseAudit was confidently pinned at 0 and read 487
    // the first time it ran). Whoever runs this first writes the pin. Note the
    // sim must have a wanted level for any police/military rotorcraft to be
    // airborne at all — a 0-star census will legitimately read zero helis.
    if (CBZ.heliAudit) {
      const ha = CBZ.heliAudit();
      out.helis = ha.helis + " crewed=" + ha.crewed + " uncrewed=" + ha.uncrewed +
                  " meanAGL=" + ha.meanAGL + " meanSpeed=" + ha.meanSpeed +
                  " orbitR=" + ha.orbitR + " belowRoofline=" + ha.belowRoofline +
                  " " + JSON.stringify(ha.byRole);
    }
    // THE WALK-IN HOLD (CBZ.holdAudit, city/vehicle_hold.js). A hold is a ROOM
    // inside a vehicle — a cargo plane's bay today, a semi's trailer next — and
    // two of its numbers are hard invariants rather than trends:
    //   orphaned  — a hold whose host left the scene while freight was still
    //               strapped to it. Structurally impossible (the 9.4 tick
    //               releases every load BEFORE it drops the rig), so it is
    //               PINNED AT 0: a non-zero reading means a vehicle is being
    //               posed off a dead matrix.
    //   holds - rigBacked — a declared hold that got no moving-platform rig.
    //               That hold has no floor, no walls and no ramp surface: it is
    //               a room you fall through. PINNED AT 0.
    // holds/ramps/vehiclesLatched/cargoLatched/actorsAboard print beside them
    // so a "fix" that simply stops declaring holds cannot pass the gate.
    if (CBZ.holdAudit) {
      const hd = CBZ.holdAudit();
      out.holds = hd.holds + " holds ramps=" + hd.ramps + " rigBacked=" + hd.rigBacked +
                  " veh=" + hd.vehiclesLatched + " cargo=" + hd.cargoLatched +
                  " aboard=" + hd.actorsAboard + " watchers=" + hd.watchers +
                  " arcs=" + hd.rampArcs + " orphaned=" + hd.orphaned;
      if (hd.orphaned > 0) out.fails.push("HOLD ORPHANED WITH FREIGHT ABOARD: " + hd.orphaned);
      if (hd.holds !== hd.rigBacked) out.fails.push("HOLD WITH NO MOVING-PLATFORM RIG (a room you fall through): " + (hd.holds - hd.rigBacked));
    }
    // ARMOR SITS CLEAR OF THE CLOTH (CBZ.armorFitAudit, city/armor.js).
    // coplanar = same-facing armor/garment face pairs sharing a plane — the
    // z-fight stipple the owner reports as "armor flickers with the outfit".
    // PINNED AT 0 and it is a hard invariant: the recolor wrap re-solves every
    // mounted piece after any re-dress, so a pair can only appear if a dresser
    // bypasses CBZ.cityRecolorRig. Measured before the wrap: every armored
    // officer carried 2 (vest front+back on the uniform shell). Runs after the
    // sim burst so the cop-dress sweep has painted the uniforms.
    if (CBZ.armorFitAudit) {
      const af = CBZ.armorFitAudit();
      out.armorFit = af.armored + " armored coplanar=" + af.coplanar +
                     (af.sample && af.sample.length ? " " + JSON.stringify(af.sample) : "");
      if (af.coplanar > 0) out.fails.push("ARMOR COPLANAR WITH GARMENT (flicker): " + af.coplanar + " " + JSON.stringify(af.sample));
    }
    // NO BODY RENDERS WITH A HOLE IN ITS CLOTHES (CBZ.outfitIntegrityAudit,
    // city/outfits.js). bare = rigs currently drawing with a missing cloth
    // region (the owner's "invisible where the outfit should be" — root cause
    // was the static batch/freeze passes eating untagged rig meshes built
    // during world build); deadTex = dressed cloth materials whose atlas
    // texture died. Both PINNED AT 0 as hard invariants: rigs are stamped
    // userData.dynamic at build now, and the guarantee sweep repairs anything
    // that still slips within one cursor pass. repaired/rigs are printed
    // beside so a sweep that stops dressing anybody cannot pass.
    if (CBZ.outfitIntegrityAudit) {
      const oi = CBZ.outfitIntegrityAudit();
      out.outfits = oi.rigs + " rigs bare=" + oi.bare + " deadTex=" + oi.deadTex +
                    " repaired=" + oi.repaired + " pinned=" + oi.pinned +
                    (oi.sample && oi.sample.length ? " " + JSON.stringify(oi.sample) : "");
      if (oi.bare > 0) out.fails.push("BARE RIGS (invisible outfit regions): " + oi.bare + " " + JSON.stringify(oi.sample));
      if (oi.deadTex > 0) out.fails.push("DEAD CLOTH TEXTURES: " + oi.deadTex);
    }
    // ---- evidence only (adoption counters / world census) ------------------
    if (CBZ.predatorAudit) { const p = CBZ.predatorAudit(); out.predator = p.legacy + "/" + p.adopted; }
    if (CBZ.checkpointAudit) { const c = CBZ.checkpointAudit(); out.checkpoints = c.count + "/" + c.manned; }
    if (CBZ.cityBeachSeats) { const b = CBZ.cityBeachSeats(); out.beachSeats = b.loungers + "L/" + b.deckchairs + "D/" + b.occupied + "used"; }
    if (CBZ.factionAudit) out.factions = CBZ.factionAudit();
    if (CBZ.missionAudit) { const m = CBZ.missionAudit(); out.missions = (m && m.legacy != null) ? m.legacy : m; }
  } catch (e) {
    const where = e && e.stack ? String(e.stack).split("\\n").slice(0, 2).join(" @ ") : "";
    out.fails.push("ratchet block threw: " + (e && e.message) + (where ? " [" + where + "]" : ""));
  }

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
  tmark(`${label}: ${r.lots}/${r.shops}/${r.roads} lots/shops/roads | sim ${TICKS} ticks in ${r.simMs}ms | mtnOutSnow ${r.mtnOutSnow} cityOnMtn ${r.cityOnMtn} overlaps ${r.overlaps} | trees ${r.trees == null ? "-" : r.trees} | peds ${r.peds}`);
  // adoption/census evidence — printed, never asserted (see the PASS block)
  tmark(`${label}: furnish ${r.furnish || "-"} | anchors ${r.anchors || "-"} | roads ${r.roadSegs == null ? "-" : r.roadSegs} | predator ${r.predator || "-"} | checkpoints ${r.checkpoints || "-"} | beach ${r.beachSeats || "-"}`);
  // The evidence lines for this wave. Assertions already ran above and would
  // have failed the gate; this is so a passing run still SHOWS its numbers —
  // an audit whose output nobody can see is one nobody will notice regressing.
  tmark(`${label}: traffic ${r.traffic || "-"} | motion ${r.motion || "-"}`);
  tmark(`${label}: origins ${r.origins || "-"} | gov ${r.gov || "-"} | airside ${r.airside || "-"}`);
  tmark(`${label}: raceTools ${r.raceTools || "-"} | racer ${r.racerCareer || "-"}`);
  tmark(`${label}: loyalty ${r.loyalty || "-"}`);
  tmark(`${label}: take ${r.take || "-"}`);
  tmark(`${label}: till ${r.till || "-"}`);
  tmark(`${label}: clearance ${r.clearance || "-"}`);
  tmark(`${label}: fxwarm ${r.fxwarm || "-"} | platGrid ${r.platGrid || "-"} | airspace ${r.airspace || "-"}`);
  tmark(`${label}: holds ${r.holds || "-"}`);
  tmark(`${label}: venues ${r.venues || "-"} | fishing ${r.fishing || "-"} | ranks ${r.ranks || "-"}`);
  if (r.ranksEmpty) tmark(`${label}: rank slots with nobody in them: ${r.ranksEmpty}`);
  if (r.ranksVerbless) tmark(`${label}: rungs that unlock nothing: ${r.ranksVerbless}`);
  tmark(`${label}: street ${r.street || "-"} | stunts ${r.stunts || "-"}`);
  tmark(`${label}: ground ${r.ground || "-"} | backdrop ${r.backdrop || "-"} | peaks ${r.peaks || "-"} | swim ${r.swim || "-"}`);
  tmark(`${label}: pools ${r.pools || "-"}`);
  tmark(`${label}: arena ${r.arena || "-"} | frontGlass ${r.frontGlass || "-"} | elevators ${r.elevators || "-"}`);
  tmark(`${label}: map ${r.map || "-"} | crowdSpawn ${r.crowdSpawn || "-"} | platforms ${r.platforms == null ? "-" : r.platforms}`);
  tmark(`${label}: cockpit ${r.cockpit || "-"} | wounds ${r.wounds || "-"} | cabin ${r.cabin || "-"} | power ${r.power || "-"}`);
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
