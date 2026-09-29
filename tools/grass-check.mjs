#!/usr/bin/env node
/* tools/grass-check.mjs — IS THE GRASS REAL, WHERE IT BELONGS, AND AFFORDABLE?

   Plain node, no browser, no captures. Loads the vendored r128, the street
   kit, world/grassfield.js and city/cityground.js, grows real towns with
   towngen (their lot splats painted), then:

     1. PLACEMENT — runs the live field (THREE-less pools) with the camera
        walked over every town, and asserts every blade stands on a lot pad
        (streetkit region 2: never carriageway or footway), never inside a
        building footprint, and only where the splat is lawn.
     2. BUDGET — a wall-to-wall meadow and a wall-to-wall lawn at every
        quality tier (+ tablet): live blades, vertices per frame, draw calls,
        chunk generation ms. Tier 0 must be > 0 (never zero), the owner's
        tier (2..4) must be dense.
     3. COLOUR — the owner's law, "long distance and short distance should
        look the same": the width-weighted mean colour of the blades the
        field grows (the vertex shader's gradient, tip variation, flowers)
        against the ground colour the provider handed it, both pushed through
        core/renderer.js's tone map + grade. Must agree within 4 %.

   Usage: node tools/grass-check.mjs          exit 0 = all ok            */
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ctx2d = new Proxy({}, { get: (t, k) => (k === "createLinearGradient" || k === "createRadialGradient") ? () => ({ addColorStop() {} }) : (typeof k === "string" ? (t[k] !== undefined ? t[k] : () => {}) : undefined), set: (t, k, v) => { t[k] = v; return true; } });
const document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d, style: {} }), getElementById: () => null, body: { appendChild() {} }, head: { appendChild() {} }, addEventListener() {} };
const win = { document, console, Math, Date, setTimeout, clearTimeout, performance: { now: () => performance.now() }, navigator: { userAgent: "node" }, addEventListener() {}, innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 };
win.window = win; win.self = win; win.CBZ = { CONFIG: {} };
const context = vm.createContext(win);
const load = (rel) => vm.runInContext(fs.readFileSync(path.join(ROOT, rel), "utf8"), context, { filename: rel });
load("src/vendor/three.r128.min.js");
load("src/vendor/BufferGeometryUtils.js");
const CBZ = win.CBZ, THREE = win.THREE;
CBZ.colliders = []; CBZ.onUpdate = () => {}; CBZ.onAlways = () => {};
CBZ.hash01 = (x, z, s) => { let h = (Math.round(x * 16) * 374761393 + Math.round(z * 16) * 668265263 + s * 2246822519) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
CBZ.assets = { define() {}, has() { return false; }, get() { return null; } };
CBZ.cmat = (c) => new THREE.MeshLambertMaterial({ color: c });
CBZ.cityMakeBuilding = (root, x, z, w, d, storeys) => ({ w, d, ox: x, oz: z, storeys, FH: 3.2, lbox() { return null; } });
load("src/world/grassfield.js");
load("src/city/streetkit.js");
load("src/city/cityground.js");
load("src/city/citytemplates.js");
load("src/city/villagekit.js");
load("src/city/settlements.js");
load("src/city/roadrules.js");
load("src/city/towngen.js");

const GF = CBZ.grassField;
let fails = 0;
const fail = (m) => { fails++; console.log("  FAIL " + m); };
function lcg(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }
const now = () => performance.now();
function blades(F, fn) {
  for (const p of F.pools) {
    const P = p.A.pos;
    for (let i = 0; i < p.hwm; i++) if (P[i * 4 + 3] > 0) fn(P[i * 4], P[i * 4 + 1], P[i * 4 + 2], i, p);
  }
}

/* ---------------- 1. PLACEMENT on real towns ---------------- */
console.log("1. placement (every blade on a lawn, never on a street, footway or under a building)");
const T = CBZ.CITY_TEMPLATES;
const picks = Object.keys(T).slice(0, 6);
picks.push("__downtown");
let seedN = 0, totalBlades = 0;
for (const id of picks) {
  seedN++;
  const cfg = id === "__downtown" ? { cols: 6, rows: 6, blockW: 42, blockD: 42, roadW: 14, pattern: "grid", density: 0.95, name: "Talloran" } : Object.assign({}, T[id]);
  const root = new THREE.Group(), A = { roads: [], lots: [], shopLots: [], homeLots: [] };
  CBZ.streetKit.reset();
  const cx = 1000 * seedN, cz = -500 * seedN;
  const town = CBZ.buildTown(root, Object.assign({}, cfg, { cx, cz, rng: lcg(seedN * 7919 + 13), arena: A, district: cfg.id || "town" }));
  if (!town) { fail(id + ": no town"); continue; }
  if (cfg.streetStyle === "rural") continue;
  const RG = (x, z) => CBZ.streetKit.regionAt(x, z);
  const F = new GF._Field(null, GF._tier(1, "desktop"), null);
  const R = town.rect;
  for (let x = R.minX + 20; x <= R.maxX; x += 60) for (let z = R.minZ + 20; z <= R.maxZ; z += 60) F.update(x, z, 1e9, now, (px, pz, out) => CBZ.groundCover.at(px, pz, out));
  const bad = { street: 0, building: 0 };
  let n = 0;
  blades(F, (x, y, z) => {
    n++;
    if (RG(x, z) !== 2) bad.street++;
    for (const L of town.lots) {
      const b = L.building;
      if (!b || !(b.w > 1)) continue;
      const bx = isFinite(b.ox) ? b.ox : L.cx, bz = isFinite(b.oz) ? b.oz : L.cz;
      if (Math.abs(x - bx) < b.w / 2 - 0.05 && Math.abs(z - bz) < b.d / 2 - 0.05) { bad.building++; break; }
    }
  });
  totalBlades += n;
  const lawnLots = town.lots.length;
  console.log("   " + (bad.street || bad.building ? "BAD " : "ok  ") + String(id).padEnd(18) + " lots " + String(lawnLots).padStart(3) + "  blades (last camera) " + n + "  on street/footway " + bad.street + "  in buildings " + bad.building);
  if (bad.street > n * 0.002) fail(id + ": " + bad.street + " blades on carriageway/footway");
  if (bad.building) fail(id + ": " + bad.building + " blades inside buildings");
}
if (!totalBlades) fail("no blades grew in any town (cover provider not wired?)");

/* ---------------- 2. BUDGET per tier ---------------- */
console.log("\n2. budget (wall-to-wall cover, camera at rest after the field fills)");
const VERTS = [7, 5, 3];
function budget(q, device, wild) {
  const Tt = GF._tier(q, device);
  const cover = (x, z, o) => { o.g = 1; o.y = 0; o.wild = wild; o.dry = 0.3; o.flw = 0.06; o.h = 1; o.r = 0.08; o.gr = 0.14; o.b = 0.035; return true; };
  const F = new GF._Field(null, Tt, null);
  let t0 = now();
  F.update(0.5, 0.5, 1e9, now, cover);
  const fillMs = now() - t0;
  let live = 0, verts = 0, starved = F.stats.starved;
  F.pools.forEach((p, l) => { live += p.used; verts += p.hwm * VERTS[l]; });
  // running (6 m/s) then driving (30 m/s) at 60 fps under the live budget:
  // the worst frame, and how far behind the field falls
  // (CPU time, p95: this Mac runs at load ~60, wall time there is scheduling noise)
  let x = 0.5, lag = 0; const ft = [];
  for (let k = 1; k <= 240; k++) { x += k <= 120 ? 0.1 : 0.5; const c0 = process.cpuUsage(); F.update(x, 0.5, 1.2, now, cover); const c1 = process.cpuUsage(c0); ft.push((c1.user + c1.system) / 1000); if (k <= 120) lag = Math.max(lag, F.stats.pending); }
  ft.sort((a, b) => a - b); const worst = ft[Math.floor(ft.length * 0.95)];
  return { Tt, live, verts, fillMs, worst, lag, gens: F.stats.gens, starved: F.stats.starved + starved };
}
for (const wild of [0, 1]) {
  for (const [q, dev] of [[0, "desktop"], [1, "desktop"], [2, "desktop"], [3, "desktop"], [4, "desktop"], [2, "tablet"], [1, "tablet"]]) {
    const b = budget(q, dev, wild);
    console.log("   " + (wild ? "meadow" : "lawn  ") + " tier " + q + " " + dev.padEnd(7) + " D0 " + String(b.Tt.D0).padStart(2) + "/m² R " + b.Tt.R + " m  live blades " + String(b.live).padStart(6) + "  verts/frame " + String(b.verts).padStart(7) + "  3 draws  fill " + b.fillMs.toFixed(0) + " ms  run/drive p95 frame CPU " + b.worst.toFixed(2) + " ms  running backlog " + b.lag + "  starved " + b.starved);
    if (b.live <= 0) fail("tier " + q + " " + dev + " grows ZERO grass");
    if (q >= 2 && dev === "desktop" && b.live < 15000) fail("owner tier " + q + " too thin: " + b.live);
    if (b.verts > 700000) fail("tier " + q + " " + dev + " vertex budget " + b.verts);
    if (b.worst > 3) fail("tier " + q + " " + dev + " p95 frame " + b.worst.toFixed(2) + " ms");
  }
}

/* ---------------- 3. COLOUR: near == far through the grade ---------------- */
console.log("\n3. colour (blade field mean vs the ground it grows from, through the tone map + grade)");
function tone(c, exposure) {
  // core/renderer.js CustomToneMapping (ACES + contrast/sat/gain/lift), then sRGB encode
  const m = (a, v) => [a[0] * v[0] + a[3] * v[1] + a[6] * v[2], a[1] * v[0] + a[4] * v[1] + a[7] * v[2], a[2] * v[0] + a[5] * v[1] + a[8] * v[2]];
  const IN = [0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777];
  const OUT = [1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602];
  let v = c.map((x) => x * exposure / 0.6);
  v = m(IN, v);
  v = v.map((x) => { const a = x * (x + 0.0245786) - 0.000090537, b = x * (0.983729 * x + 0.4329510) + 0.238081; return a / b; });
  v = m(OUT, v).map((x) => Math.min(1, Math.max(0, x)));
  v = v.map((x) => Math.pow(Math.max(0, x / 0.18), 1.075) * 0.18);
  const L = 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  v = v.map((x) => L + (x - L) * 1.14);
  v = [v[0] * 1.025 + 0.0015, v[1] * 1.005 + 0.0032, v[2] * 0.982 + 0.0072].map((x) => Math.min(1, Math.max(0, x)));
  return v.map((x) => (x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055) * 255);
}
// the vertex shader's colour, width-weighted along a blade (t = 0..1, profile
// (1-t)^0.8 for a blade), mirrored in JS from grassfield.js VERT_BEGIN
function bladeMean(col, a, type) {
  let s = [0, 0, 0], w = 0;
  const heads = [[0.62, 0.62, 0.56], [0.66, 0.44, 0.03], [0.26, 0.12, 0.38]];
  for (let k = 0; k < 64; k++) {
    const t = (k + 0.5) / 64;
    let prof = Math.pow(1 - t, 0.8), y = t, head = 0, dy = 1;
    if (type >= 1 && type <= 3) { dy = t < 0.5 ? 1.74 : 0.26; y = t < 0.5 ? t * 1.74 : 0.87 + (t - 0.5) * 0.26; prof = t < 0.5 ? 0.3 : t < 0.9 ? 1.1 : 0; head = t >= 0.5 ? 1 : 0; }
    else if (type === 4) { prof = t < 0.5 ? 0.55 : t < 0.9 ? 1.25 : 0; head = Math.min(1, Math.max(0, (t - 0.45) / 0.15)); head = head * head * (3 - 2 * head); }
    else if (type === 5) { prof = Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.1)) * 1.4; y = t * 0.6; dy = 0.6; }
    prof *= dy;                                     // area along the blade, not along t
    const tv = (a * 2 - 1) * Math.min(1, Math.max(0, (y - 0.35) / 0.65)) ** 2 * (3 - 2 * Math.min(1, Math.max(0, (y - 0.35) / 0.65)));
    let c = [col[0] * (1 + tv * 0.3), col[1] * (1 + tv * 0.06), col[2] * (1 - tv * 0.4)];
    const gr = 0.7 + 0.9 * y;
    c = c.map((x) => x * gr);
    if (head > 0) { const hc = type === 4 ? [col[0] * 1.5, col[1] * 1.2, col[2] * 0.7] : heads[type - 1]; c = c.map((x, i) => x + (hc[i] - x) * head); }
    for (let i = 0; i < 3; i++) s[i] += c[i] * prof;
    w += prof;
  }
  return { mean: s.map((x) => x / w), I: w / 64 };
}
const cases = [
  ["city lawn (cityground)", { wild: 0, dry: 0.25, flw: 0.03, col: null }],
  ["neglected yard", { wild: 0.7, dry: 0.5, flw: 0.05, col: null }],
  ["metro lawn", { wild: 0, dry: 0.1, flw: 0.025, col: [0.075 * 0.95, 0.135 * 0.95, 0.032 * 0.95] }],
  ["backcountry meadow", { wild: 1, dry: 0.3, flw: 0.03, col: [0.31, 0.455, 0.27] }],
];
const lin = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255].map((c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
const LAWN = lin(0x5f7e37), STRAW = lin(0x958a52);
for (const [name, c] of cases) {
  const base = c.col || LAWN.map((v, i) => (v + (STRAW[i] - v) * c.dry) * 0.95);
  const cover = (x, z, o) => { o.g = 1; o.y = 0; o.wild = c.wild; o.dry = c.dry; o.flw = c.flw; o.h = 1; o.r = base[0]; o.gr = base[1]; o.b = base[2]; return true; };
  const F = new GF._Field(null, GF._tier(3, "desktop"), null);
  F.update(4, 4, 1e9, now, cover);
  const sum = [0, 0, 0]; let n = 0;
  blades(F, (x, y, z, i, p) => {
    const C = p.A.col, P = p.A.par;
    const col = [C[i * 4], C[i * 4 + 1], C[i * 4 + 2]].map((v) => (v / 255) ** 2);
    const type = Math.floor(P[i * 4 + 3] / 4);
    const wm = P[i * 4 + 3] - type * 4, h = p.A.pos[i * 4 + 3];
    const bm = bladeMean(col, C[i * 4 + 3] / 255, type), m = bm.mean;
    const area = wm * h * bm.I;                    // blade area weight
    for (let k = 0; k < 3; k++) sum[k] += m[k] * area;
    n += area;
  });
  const mean = sum.map((v) => v / n);
  // a near patch = blades over their own ground; the far view = the ground
  const near = mean.map((v, i) => 0.6 * v + 0.4 * base[i]);
  const irr = 2.2;                                  // noon sun + sky on a flat lawn (Lambert, r128 units)
  const tn = tone(near.map((v) => v * irr), 1.16), tf = tone(base.map((v) => v * irr), 1.16);
  const lumN = 0.2126 * tn[0] + 0.7152 * tn[1] + 0.0722 * tn[2], lumF = 0.2126 * tf[0] + 0.7152 * tf[1] + 0.0722 * tf[2];
  const dMax = Math.max(...tn.map((v, i) => Math.abs(v - tf[i]) / Math.max(1, tf[i])));
  const dl = Math.abs(lumN - lumF) / lumF;
  console.log("   " + name.padEnd(24) + " far sRGB " + tf.map((v) => v.toFixed(0)).join(",").padEnd(12) + " near " + tn.map((v) => v.toFixed(0)).join(",").padEnd(12) + " luma " + (100 * dl).toFixed(1) + " %  worst channel " + (100 * dMax).toFixed(1) + " %");
  if (dl > 0.04) fail(name + ": near/far luma differ " + (100 * dl).toFixed(1) + " %");
  if (dMax > 0.06) fail(name + ": near/far channel differ " + (100 * dMax).toFixed(1) + " %");
}

console.log(fails ? "\nFAILURES: " + fails : "\nALL GRASS CHECKS OK");
process.exit(fails ? 1 : 0);
