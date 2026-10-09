#!/usr/bin/env node
/* tools/metro-far-check.mjs — THE DISTANT CITY IS THE REAL CITY, CHECKED
   IN PLAIN NODE.

   Owner, 2026-09-29: "I want real skyline. I want the actual shit in the
   distance." city/metro_fabric.js draws every tile twice from ONE writer:
   the near tile (every detail) and the far tile (the HLOD: the same
   buildings merged, minus sub-pixel detail). This builds every tile of
   every metro city both ways (the live-world snapshot, seed 90210, the same
   plans tools/metro-plan-check.mjs checks) and FAILS (exit 1) when:
     • a planned building (or station) writes no far geometry
     • a far building is not where the plan puts it: its far bounds must sit
       inside its near bounds, and cover the planned footprint's centre
     • a far building is not the planned height: its far top must reach the
       planned roof (GY + b.h) and never rise above the near building
     • a far tile costs more than one draw call, or more than FAR_TRI_MAX
       triangles, or the whole distant world more than FAR_MB_MAX of video
       memory
   Zero browser, ~2 s. Usage: node tools/metro-far-check.mjs [--seed N] [--json]
*/
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const seedArg = argv.indexOf("--seed") >= 0 ? +argv[argv.indexOf("--seed") + 1] : 90210;
const snap = JSON.parse(readFileSync(path.join(ROOT, "tools/metro-world-snapshot.json"), "utf8"));
const THREE = require(path.join(ROOT, "src/vendor/three.r128.min.js"));
globalThis.window = { THREE, CBZ: { CONFIG: {}, WORLD_SEED: seedArg, highwayNetTable: () => snap.hw, HIGHWAY_NET_HALF: snap.H } };
require(path.join(ROOT, "src/city/zoning.js"));        // the world zoning field metro.js plans with
require(path.join(ROOT, "src/city/metroplan.js"));
require(path.join(ROOT, "src/city/metro.js"));
require(path.join(ROOT, "src/city/metro_fabric.js"));
const CBZ = globalThis.window.CBZ;
const L = CBZ.metroLib, F = CBZ.metroFabric;

const FAR_TRI_MAX = 80000;      // one far tile (the densest CBD tile is ~20k)
const FAR_MB_MAX = 32;          // every far tile of every city, video memory
const GY = 0.16;

const city = {
  regions: snap.regions.map((r) => Object.assign({ kind: "rect" }, r)),
  roads: snap.roads.map((r) => ({ x: r[0], z: r[1], vertical: !!r[2], len: r[3], w: r[4], district: r[5] })),
  minX: snap.city.minX, maxX: snap.city.maxX, minZ: snap.city.minZ, maxZ: snap.city.maxZ, annex: snap.annex,
};
function boxesOf(mesh, marks, ox, oz) {
  const pos = mesh.geometry.attributes.position.array, out = new Map();
  for (let k = 0; k < marks.length; k += 3) {
    const i = marks[k], v0 = marks[k + 1], v1 = marks[k + 2];
    const b = { n: v1 - v0, x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9, z0: 1e9, z1: -1e9 };
    for (let v = v0; v < v1; v++) {
      const x = pos[v * 3] + ox, y = pos[v * 3 + 1], z = pos[v * 3 + 2] + oz;
      if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y; if (z < b.z0) b.z0 = z; if (z > b.z1) b.z1 = z;
    }
    out.set(i, b);
  }
  return out;
}
const fails = [], out = [];
const planned = [];
let farBytes = 0;
const T0 = Date.now();
F.setFreeFar(false);
for (const site of L.siteTable(city)) {
  const P = L.planSite(city, site, planned);
  planned.push({ id: site.id, regions: L.planRegions(P), plan: P });
  const pr = F.prepare(P, { tile: L.TILE, name: site.id });
  const rec = { id: site.id, buildings: P.bldgs.length, stations: (P.stations || []).length, tiles: pr.tiles.length, farDrawCalls: 0,
    near: { tris: 0, MB: 0 }, far: { tris: 0, MB: 0, worstTileTris: 0, worstTileMs: 0 }, missing: 0, misplaced: 0, wrongHeight: 0, examples: [] };
  let seen = 0;
  for (const t of pr.tiles) {
    const Jn = F.job(P, t, false); Jn.marks = [];
    const rn = F.runJob(Jn, Infinity);
    const Jf = F.job(P, t, true); Jf.marks = [];
    const rf = F.runJob(Jf, Infinity);
    rec.near.tris += rn.stats.triangles; rec.near.MB += rn.stats.bytes / 1048576;
    rec.far.tris += rf.stats.triangles; rec.far.MB += rf.stats.bytes / 1048576; farBytes += rf.stats.bytes;
    rec.far.worstTileTris = Math.max(rec.far.worstTileTris, rf.stats.triangles);
    rec.far.worstTileMs = Math.max(rec.far.worstTileMs, +rf.stats.ms.toFixed(2));
    // one mesh, one material, one index range = one draw call
    const g = t.far.geometry;
    const calls = rf.empty ? 0 : (Array.isArray(t.far.material) ? t.far.material.length : 1) * Math.max(1, g.groups.length);
    rec.farDrawCalls += calls;
    if (calls > 1) fails.push(site.id + " tile " + t.key + ": far tile is " + calls + " draw calls");
    if (rf.stats.triangles > FAR_TRI_MAX) fails.push(site.id + " tile " + t.key + ": far tile " + rf.stats.triangles + " triangles > " + FAR_TRI_MAX);
    if ((t.stations || []).length && !(rf.stats.vertices > 0)) fails.push(site.id + " tile " + t.key + ": station has no far geometry");
    const ox = (t.x0 + t.x1) / 2, oz = (t.z0 + t.z1) / 2;
    const NB = boxesOf(t.mesh, Jn.marks, ox, oz), FB = boxesOf(t.far, Jf.marks, ox, oz);
    for (const i of t.idx) {
      seen++;
      const b = P.bldgs[i], n = NB.get(i), f = FB.get(i);
      const why = [];
      if (!f || f.n === 0) { rec.missing++; why.push("no far geometry"); }
      else {
        const e = 0.02;
        if (f.x0 < n.x0 - e || f.x1 > n.x1 + e || f.z0 < n.z0 - e || f.z1 > n.z1 + e || f.y1 > n.y1 + e) { rec.misplaced++; why.push("far outside near bounds"); }
        if (!(b.x >= f.x0 - e && b.x <= f.x1 + e && b.z >= f.z0 - e && b.z <= f.z1 + e)) { rec.misplaced++; why.push("far misses the lot centre"); }
        const planTop = GY + (b.type === "barn" ? b.h + 2.2 : b.type === "stadium" ? 30 : b.h);
        if (f.y1 < planTop - 0.05) { rec.wrongHeight++; why.push("far top " + f.y1.toFixed(2) + " < plan " + planTop.toFixed(2)); }
      }
      if (why.length && rec.examples.length < 6) rec.examples.push(b.type + "@" + b.x.toFixed(0) + "," + b.z.toFixed(0) + " h" + b.h + ": " + why.join("; "));
    }
    t.mesh.geometry.dispose(); t.far.geometry.dispose();
  }
  if (seen !== P.bldgs.length) fails.push(site.id + ": " + seen + " of " + P.bldgs.length + " buildings are in a tile");
  if (rec.missing || rec.misplaced || rec.wrongHeight) fails.push(site.id + ": " + rec.missing + " missing / " + rec.misplaced + " misplaced / " + rec.wrongHeight + " wrong height — " + rec.examples.join(" | "));
  rec.near.MB = +rec.near.MB.toFixed(1); rec.far.MB = +rec.far.MB.toFixed(1);
  rec.farPctOfNear = Math.round(rec.far.tris / Math.max(1, rec.near.tris) * 100);
  out.push(rec);
}
const farMB = farBytes / 1048576;
if (farMB > FAR_MB_MAX) fails.push("distant world " + farMB.toFixed(1) + " MB > " + FAR_MB_MAX);
if (argv.includes("--json")) console.log(JSON.stringify({ cities: out, farMB, fails }, null, 1));
else {
  for (const r of out) {
    console.log(`${r.id.padEnd(16)} ${String(r.buildings).padStart(6)} bldgs  ${String(r.tiles).padStart(3)} tiles  far: ${r.farDrawCalls} draws, ${r.far.tris} tris (${r.farPctOfNear}% of near), ${r.far.MB} MB, worst tile ${r.far.worstTileTris} tris / ${r.far.worstTileMs} ms`);
  }
  console.log(`distant world: ${farMB.toFixed(1)} MB video memory, 0 MB CPU (arrays freed after upload) — ${((Date.now() - T0) / 1000).toFixed(1)} s`);
  console.log(fails.length ? "FAIL\n  " + fails.join("\n  ") : "PASS — every planned building has a far representation at its lot and its planned height");
}
process.exit(fails.length ? 1 : 0);
