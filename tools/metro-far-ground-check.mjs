#!/usr/bin/env node
/* tools/metro-far-ground-check.mjs — ONE WORLD AT EVERY DISTANCE, CHECKED IN
   PLAIN NODE.

   Owner, 2026-09-29: "long distance and short distance should look the same.
   What changes is the horizon that you can see, not what's in the horizon."
   Past the near/far swap a metro's ground is drawn from the far land-use map
   (city/metro_ground.js farMap, sampled by the continent plate's ground
   skin). That map may not invent a look of its own: every 100 m cell of it
   must equal the AREA-WEIGHTED MEAN albedo of what the near tile draws there
   (city/metro_ground.js tileArrays: the same streets, footways, kerbs, lawns,
   lots, fields, with each surface's mean shader pattern — FARMAP_COLOURS).

   Builds every metro of the live-world snapshot (seed 90210, the same plans
   metro-plan-check / metro-far-check read), rasterises its far map, emits
   every near ground tile, and compares per 100 m cell where both cover
   >= 80% of it: luminance ratio and chroma (r/g, b/g) difference.
   FAILS (exit 1) when the median luminance error > 6% or the 90th percentile
   > 15%, or when one map op costs more than MAX_SLICE_MS (cities with >= 30
   comparable cells are judged; smaller towns are reported).
   Usage: node tools/metro-far-ground-check.mjs [--seed N] [--city id] [--json]
*/
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const opt = (k, d) => (argv.indexOf(k) >= 0 ? argv[argv.indexOf(k) + 1] : d);
const seed = +opt("--seed", 90210), only = opt("--city", "");
const snap = JSON.parse(readFileSync(path.join(ROOT, "tools/metro-world-snapshot.json"), "utf8"));
const THREE = require(path.join(ROOT, "src/vendor/three.r128.min.js"));
globalThis.window = { THREE, CBZ: { CONFIG: {}, WORLD_SEED: seed, highwayNetTable: () => snap.hw, HIGHWAY_NET_HALF: snap.H } };
for (const f of ["metroplan", "metro", "metro_ground"]) require(path.join(ROOT, "src/city/" + f + ".js"));
const CBZ = globalThis.window.CBZ, L = CBZ.metroLib, MG = CBZ.metroGround, FM = MG.FARMAP_COLOURS;
const CELL = 100, MED_MAX = 0.06, P90_MAX = 0.15, MAX_SLICE_MS = 12;
const KERB = [0.30, 0.30, 0.285];         // granite (~148 sRGB canvas, decoded)
const GKM = {                              // mean of mgSurface per ground kind (FARMAP_COLOURS's MG_MEAN)
  0: [1, 1, 1], 1: [0.94, 0.94, 0.94], 2: [0.96, 0.96, 0.96], 4: [0.99, 0.99, 0.99], 5: [0.9, 0.9, 0.9],
};

const city = {
  regions: snap.regions.map((r) => Object.assign({ kind: "rect" }, r)),
  roads: snap.roads.map((r) => ({ x: r[0], z: r[1], vertical: !!r[2], len: r[3], w: r[4], district: r[5] })),
  minX: snap.city.minX, maxX: snap.city.maxX, minZ: snap.city.minZ, maxZ: snap.city.maxZ, annex: snap.annex,
};
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const planned = [], rows = [], fails = [];
for (const site of L.siteTable(city)) {
  const P = L.planSite(city, site, planned);
  planned.push({ id: site.id, regions: L.planRegions(P), plan: P });
  if (only && site.id !== only) continue;
  // ---- far: the map, run the way metro.js runs it (sliced)
  const m = MG.farMap(P);
  // one op per call: the worst op is the floor of any slice metro.js runs
  // (median of 3 runs per op would be steadier; GC can spike one op)
  let worst = 0;
  for (;;) { const t = performance.now(); const done = m.step(1e-6); worst = Math.max(worst, performance.now() - t); if (done) break; }
  if (worst > MAX_SLICE_MS) fails.push(`${site.id}: a far-map op took ${worst.toFixed(1)} ms`);
  const cells = new Map();
  const cellOf = (x, z) => { const k = Math.floor(x / CELL) + "," + Math.floor(z / CELL); let c = cells.get(k); if (!c) cells.set(k, (c = { nA: 0, n: [0, 0, 0], fA: 0, f: [0, 0, 0], fN: 0 })); return c; };
  for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) {
    const o = (j * m.w + i) * 4, x = m.x0 + (i + 0.5) * m.cell, z = m.z0 + (j + 0.5) * m.cell;
    const c = cellOf(x, z); c.fN++;
    if (m.data[o + 3] < 40) continue;
    c.fA++;
    for (let q = 0; q < 3; q++) { const v = m.data[o + q] / 255; c.f[q] += v * v; }
  }
  // ---- near: every ground tile's up-facing triangles, area-weighted
  const S = MG.solve(P);
  for (const key of S.bins.keys()) {
    const B = MG.tileArrays(P, key).bufs;
    for (const name of ["roadA", "roadL", "foot", "kerb", "ground", "struct"]) {
      const b = B[name]; if (!b || !b.ni) continue;
      const pos = b.pos, idx = b.idx, nrm = b.nrm;
      for (let t = 0; t < b.ni; t += 3) {
        const a = idx[t], bb = idx[t + 1], cc = idx[t + 2];
        if (nrm[a * 3 + 1] < 100) continue;                            // up-facing only (Int8 x127)
        const ax = pos[a * 3], az = pos[a * 3 + 2], bx = pos[bb * 3], bz = pos[bb * 3 + 2], cx = pos[cc * 3], cz = pos[cc * 3 + 2];
        const area = Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2;
        if (area < 1e-6) continue;
        let alb;
        if (name === "roadA" || name === "roadL") alb = FM.asphalt;
        else if (name === "foot") { const k = b.col[a * 3] / 255; alb = FM.walk.map((v) => v * k); }
        else if (name === "kerb") { const k = b.col[a * 3] / 255; alb = KERB.map((v) => v * k); }
        else {
          const g = b.gk[a * 2], mm = GKM[g] || [1, 1, 1];
          alb = [0, 1, 2].map((q) => { const v = b.col[a * 3 + q] / 255; return v * v * mm[q]; });
          if (g === 3) { const s = [0.085, 0.06, 0.04]; alb = alb.map((v, q) => (s[q] * 0.38 + v * 0.62) * 0.97); }
        }
        const c = cellOf((ax + bx + cx) / 3, (az + bz + cz) / 3);
        c.nA += area; for (let q = 0; q < 3; q++) c.n[q] += area * alb[q];
      }
    }
  }
  const errs = [], chroma = [];
  for (const c of cells.values()) {
    if (c.nA < 0.8 * CELL * CELL || c.fA < 0.8 * c.fN) continue;
    const n = c.n.map((v) => v / c.nA), f = c.f.map((v) => v / c.fA);
    errs.push(lum(f) / lum(n) - 1);
    chroma.push(Math.max(Math.abs(f[0] / f[1] - n[0] / n[1]), Math.abs(f[2] / f[1] - n[2] / n[1])));
  }
  errs.sort((a, b) => Math.abs(a) - Math.abs(b)); chroma.sort((a, b) => a - b);
  const q = (arr, p) => arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] : 0;
  const bias = errs.reduce((s, v) => s + v, 0) / Math.max(1, errs.length);
  const r = { id: site.id, map: `${m.w}x${m.h} @ ${m.cell.toFixed(2)} m`, mapMs: +m.ms.toFixed(0), worstSliceMs: +worst.toFixed(1), cells: errs.length,
    lumErrMedian: +(100 * Math.abs(q(errs, 0.5))).toFixed(1), lumErrP90: +(100 * Math.abs(q(errs, 0.9))).toFixed(1), lumBias: +(100 * bias).toFixed(1), chromaP90: +q(chroma, 0.9).toFixed(3) };
  rows.push(r);
  if (errs.length >= 30 && (Math.abs(q(errs, 0.5)) > MED_MAX || Math.abs(q(errs, 0.9)) > P90_MAX))
    fails.push(`${site.id}: far ground vs near mean luminance error median ${r.lumErrMedian}% / p90 ${r.lumErrP90}%`);
}
if (argv.includes("--json")) console.log(JSON.stringify({ rows, fails }, null, 1));
else {
  for (const r of rows) console.log(`${r.id.padEnd(16)} map ${r.map.padEnd(18)} ${String(r.mapMs).padStart(4)} ms (worst op ${r.worstSliceMs} ms)  ${String(r.cells).padStart(4)} cells  lum err median ${r.lumErrMedian}%  p90 ${r.lumErrP90}%  bias ${r.lumBias}%  chroma p90 ${r.chromaP90}`);
  console.log(fails.length ? "FAIL\n  " + fails.join("\n  ") : "PASS — the far ground is the near ground's mean, cell by cell");
}
process.exit(fails.length ? 1 : 0);
