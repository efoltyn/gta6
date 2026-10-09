#!/usr/bin/env node
/* tools/ground-turf-check.mjs — THE TURF IS REAL AT EVERY DISTANCE, CHECKED
   IN PLAIN NODE.

   Owner (iPad, 2026-10-08): "the ground is just plain green". Measured on
   the tablet tier before the fix: the country round the city at eye level
   had a luminance CV of 0.07-0.12 and a 2-px local contrast of 0.5-2.7
   levels past 20 m. world/textures_surface.js's groundTurf() is now the one
   grass look (the continent plate, the annex, the metro lawns, the estate
   and government lawns), pure shader math so it is the same on every tier.

   This keeps a JS TWIN of groundTurf and FAILS (exit 1) when:
     • the GLSL changed and the twin was not updated (hash of the source);
     • the constants baked into the GLSL (TURF_SOIL_MEAN, TURF_NORM) are not
       what the function really averages to (the multiplier's mean must be
       1, or a metro's far land-use map stops matching its near tile);
     • the far field (every faded term replaced by its mean) does not average
       to the near field within 1 % (one world at every distance);
     • the near field varies less than a real lawn (luminance CV < 0.15),
       or carries no hue variation (g/r spread < 0.06);
   and checks the ROAD FIELD (the signed distance the skin reads for gravel
   shoulders and verges) against the live-world snapshot's road records.
   Usage: node tools/ground-turf-check.mjs
*/
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const THREE = require(path.join(ROOT, "src/vendor/three.r128.min.js"));
globalThis.window = { THREE, CBZ: { CONFIG: {} } };
require(path.join(ROOT, "src/world/textures_surface.js"));
const CBZ = globalThis.window.CBZ;
const fails = [];

// ---- 1. the twin is the GLSL's twin ------------------------------------
const GLSL_SHA = "1ca2830cb5a1";
const sha = createHash("sha1").update(CBZ.GROUND_TURF_GLSL).digest("hex").slice(0, 12);
if (sha !== GLSL_SHA) fails.push(`groundTurf GLSL changed (sha ${sha}, twin written for ${GLSL_SHA}): update the twin below, then the sha`);

// ---- the twin (keep in step with TURF_GLSL) ----------------------------
const fract = (x) => x - Math.floor(x);
const ss = (a, b, x) => { let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
function tfH(px, py) {
  px -= 289 * Math.floor(px / 289); py -= 289 * Math.floor(py / 289);
  let q0 = fract(px * 0.1031), q1 = fract(py * 0.1031), q2 = fract(px * 0.1031);
  const d = q0 * (q1 + 33.33) + q1 * (q2 + 33.33) + q2 * (q0 + 33.33);
  q0 += d; q1 += d; q2 += d;
  return fract((q0 + q1) * q2);
}
function tfN(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y); let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = tfH(ix, iy), b = tfH(ix + 1, iy), c = tfH(ix, iy + 1), e = tfH(ix + 1, iy + 1);
  return (a + (b - a) * fx) + ((c + (e - c) * fx) - (a + (b - a) * fx)) * fy;
}
const C = CBZ.groundTurfConst;
// raw: without TURF_NORM; far = every faded term at its mean
function turfRaw(x, z, far, soilMean, wear = 1) {
  const m150 = tfN(x * 0.0067 + 1.3, z * 0.0067 + 7.1), m61 = tfN(x * 0.0164 + 3.1, z * 0.0164 + 0.4), m23 = tfN(x * 0.0435 + 12.4, z * 0.0435 + 2.6);
  const dry = ss(0.50, 0.82, 0.6 * m61 + 0.4 * m150);
  const lush = (1 - ss(0.2, 0.52, m23)) * (1 - dry);
  let soil = soilMean, n8 = 0.5;
  if (!far) {
    soil = ss(0.68, 0.80, 0.68 * tfN(x * 0.09 + 7.7, z * 0.09 + 1.9) + 0.32 * tfN(x * 0.26 + 2.2, z * 0.26 + 5.5));
    n8 = tfN(x * 0.125 + 5.7, z * 0.125 + 3.3);
  }
  let v = 1 + 0.36 * (m23 - 0.5) + 0.26 * (m61 - 0.5) + 0.32 * (n8 - 0.5);
  if (!far) v += 0.26 * (tfN(x * 0.55 + 9.2, z * 0.55 + 4.4) - 0.5) + 0.18 * (tfN(x * 1.7 + 1.1, z * 1.7 + 8.8) - 0.5)
    + 0.22 * (tfN(x * 6.3, z * 6.3) - 0.5) + 0.14 * (tfN(x * 17 + 3.3, z * 17 + 3.3) - 0.5);
  const K = [[1.30, 1.04, 0.60], [0.80, 0.97, 0.86], [1.25, 0.76, 1.42]];
  // the soil term is divided by its own mean (any wear keeps mean 1)
  const dA = 0.8 * (0.3 + 0.7 * wear);
  return { soil, dry, k: [0, 1, 2].map((c) => (1 + (K[0][c] - 1) * dry * dA) / (1 + (K[0][c] - 1) * C.dryMean * dA) * (1 + (K[1][c] - 1) * lush * 0.85) *
    (1 + (K[2][c] - 1) * soil * 0.85 * wear) / (1 + (K[2][c] - 1) * 0.85 * C.soilMean * wear) * v) };
}

// ---- 2. its means ------------------------------------------------------
const R = 6000, STEP = 3.7, ZSTEP = STEP * 7.3;
let n = 0, sSoil = 0, sDry = 0;
for (let x = -R; x < R; x += STEP) for (let z = -R; z < R; z += ZSTEP) { const t = turfRaw(x, z, false, 0); sSoil += t.soil; sDry += t.dry; n++; }
const soilMean = sSoil / n, dryMean = sDry / n;
if (Math.abs(dryMean - C.dryMean) > 0.003) fails.push(`TURF_DRY_MEAN baked ${C.dryMean}, measured ${dryMean.toFixed(4)}`);
const near = [0, 0, 0], farM = [0, 0, 0];
let lS = 0, lS2 = 0, gS = 0, gS2 = 0;
const base = [0.086, 0.125, 0.047];       // the metro lawn's linear albedo (the turf multiplies it)
for (let x = -R; x < R; x += STEP) for (let z = -R; z < R; z += ZSTEP) {
  const a = turfRaw(x, z, false, soilMean).k.map((v, c) => v * C.norm[c]), b = turfRaw(x, z, true, soilMean).k.map((v, c) => v * C.norm[c]);
  for (let c = 0; c < 3; c++) { near[c] += a[c]; farM[c] += b[c]; }
  const col = a.map((v, c) => v * base[c]);
  const L = 0.2126 * col[0] + 0.7152 * col[1] + 0.0722 * col[2];
  lS += L; lS2 += L * L;
  const gr = col[1] / col[0]; gS += gr; gS2 += gr * gr;
}
for (let c = 0; c < 3; c++) { near[c] /= n; farM[c] /= n; }
const lm = lS / n, cv = Math.sqrt(lS2 / n - lm * lm) / lm, gm = gS / n, gsd = Math.sqrt(gS2 / n - gm * gm);
console.log(`turf: soil mean ${soilMean.toFixed(4)} (baked ${C.soilMean}) · dry mean ${dryMean.toFixed(4)} (baked ${C.dryMean}) · near mean ${near.map((v) => v.toFixed(3)).join("/")} · far mean ${farM.map((v) => v.toFixed(3)).join("/")} · lawn lum CV ${cv.toFixed(3)} · g/r ${gm.toFixed(2)} +- ${gsd.toFixed(3)}`);
if (Math.abs(soilMean - C.soilMean) > 0.002) fails.push(`TURF_SOIL_MEAN baked ${C.soilMean}, measured ${soilMean.toFixed(4)}`);
for (let c = 0; c < 3; c++) {
  if (Math.abs(near[c] - 1) > 0.006) fails.push(`turf near mean channel ${c} = ${near[c].toFixed(4)} (must be 1: TURF_NORM is stale, use ${(C.norm[c] / near[c]).toFixed(4)})`);
  if (Math.abs(farM[c] - near[c]) > 0.01) fails.push(`turf far mean channel ${c} = ${farM[c].toFixed(4)} vs near ${near[c].toFixed(4)}: the far field is not the near field averaged`);
}
// a kept lawn (wear 0.15) keeps mean 1 too
const kept = [0, 0, 0]; let nk = 0;
for (let x = -R; x < R; x += STEP * 3) for (let z = -R; z < R; z += ZSTEP) { const a = turfRaw(x, z, false, soilMean, 0.15).k; for (let c = 0; c < 3; c++) kept[c] += a[c] * C.norm[c]; nk++; }
for (let c = 0; c < 3; c++) { kept[c] /= nk; if (Math.abs(kept[c] - 1) > 0.008) fails.push(`kept-lawn (wear 0.15) mean channel ${c} = ${kept[c].toFixed(4)}`); }
console.log(`kept lawn (wear 0.15) mean ${kept.map((v) => v.toFixed(3)).join("/")}`);
if (cv < 0.15) fails.push(`lawn luminance CV ${cv.toFixed(3)} < 0.15: plain green`);
if (gsd < 0.06) fails.push(`lawn hue spread (g/r sd) ${gsd.toFixed(3)} < 0.06: one green`);

// ---- 3. the road field -------------------------------------------------
const snap = JSON.parse(readFileSync(path.join(ROOT, "tools/metro-world-snapshot.json"), "utf8"));
const roads = snap.roads.map((r) => ({ x: r[0], z: r[1], vertical: !!r[2], len: r[3], w: r[4], district: r[5] }));
const rect = { minX: -7320, maxX: 10408, minZ: -8700, maxZ: 7082 };       // the live plate (seed 90210)
const st = CBZ.groundRoadField.build(rect, roads, [], 2048);
let bad = 0, tried = 0;
for (const r of roads) {
  if (r.len < 120 || r.w < 9) continue;          // (a lane narrower than a texel pair: inside a town, never on the plate)
  const hw = r.w / 2;
  // mid-road: on the carriageway; 10 m off the edge: 10 m out (unless
  // another road is nearer there)
  const cx = r.x, cz = r.z;
  const ox = r.vertical ? hw + 10 : 0, oz = r.vertical ? 0 : hw + 10;
  const dc = CBZ.groundRoadField.sample(cx, cz), dOff = CBZ.groundRoadField.sample(cx + ox, cz + oz);
  tried++;
  if (!(dc < 0) || !(Math.abs(dOff - 10) < 1.5 || dOff < 10)) { bad++; if (bad < 4) console.log("  road-field miss:", JSON.stringify(r), "centre", dc.toFixed(1), "10 m out", dOff.toFixed(1)); }
}
console.log(`road field: ${st.N}² at ${st.texel} m, ${st.roads} roads in ${st.ms} ms · ${tried - bad}/${tried} road checks right`);
if (bad) fails.push(`${bad} road-field samples wrong (centre not on the carriageway, or the verge further than it is)`);

console.log(fails.length ? "FAIL" : "PASS — the turf averages to itself at every distance and varies like a lawn");
for (const f of fails) console.log("  FAIL " + f);
process.exit(fails.length ? 1 : 0);
