#!/usr/bin/env node
/* tools/highway-clearance-check.mjs — NO BUILDING STANDS ON A FREEWAY.

   Owner (iPad, 2026-10-08): "the facades like townhouses are in a weird
   location near the highway". The metro planner (city/metroplan.js) is told
   where the freeways are as CORRIDORS: one axis-aligned rectangle per leg of
   highwaynet.js's route table. The deck the game draws is not that: every
   interior corner of a route is FILLETED into an arc (highways.js
   CBZ.highwaySmoothPath, radius 60-140 m), and the arc runs through the
   inside of the corner, where neither leg rectangle reaches. A building
   planned there stands on (or under) the curving deck.

   This plans every metro city exactly as the game does (metro-plan-check's
   world snapshot, seed 90210) and measures each building's footprint
   against the REAL deck centreline (the same smooth path the deck builder
   and the continent relief gate use). FAILS (exit 1) when any footprint
   comes within the deck half-width + CLEAR of a centreline, and lists them
   by city and building type. Also reports, informational, the rows/houses
   whose front (the side they face) has no street within reach.

   Zero browser, ~1 s. Usage: node tools/highway-clearance-check.mjs [--seed N] [--json]
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
require(path.join(ROOT, "src/city/highways.js"));          // CBZ.highwaySmoothPath: the deck's own centreline
require(path.join(ROOT, "src/city/zoning.js"));        // the world zoning field metro.js plans with
require(path.join(ROOT, "src/city/metroplan.js"));
require(path.join(ROOT, "src/city/metro.js"));
const CBZ = globalThis.window.CBZ;
const L = CBZ.metroLib;

const H = snap.H;            // deck half-width (3+3 lanes, shoulders, median)
const CLEAR = 4;             // a verge between the deck edge and any wall
const FRONT = 1.5 + 3.2 + 2; // a row house's front step + footway (+ slack) to the street edge

// the filleted centreline of every route, as segments
const segs = [];
for (const route of snap.hw) {
  const sp = CBZ.highwaySmoothPath(route.pts, route.fillet || 60, 9);
  for (let i = 0; i + 1 < sp.length; i++) segs.push({ ax: sp[i].x, az: sp[i].z, bx: sp[i + 1].x, bz: sp[i + 1].z, route: route.id });
}
function segDist(px, pz, s) {
  const dx = s.bx - s.ax, dz = s.bz - s.az, L2 = dx * dx + dz * dz;
  let t = L2 > 0 ? ((px - s.ax) * dx + (pz - s.az) * dz) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(s.ax + dx * t - px, s.az + dz * t - pz);
}
// footprint corners (metroplan's OBB: rot about +y)
function corners(b) {
  const c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0), hw = b.w / 2, hd = b.d / 2;
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([u, v]) => ({ x: b.x + u * c + v * s, z: b.z - u * s + v * c }));
}
// distance from a footprint to a centreline: sample the outline every 2 m
// plus the centre (a deck crossing the middle of a long terrace counts)
function footDist(b) {
  const cs = corners(b);
  const pts = [{ x: b.x, z: b.z }];
  for (let i = 0; i < 4; i++) {
    const p = cs[i], q = cs[(i + 1) % 4], n = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.z - p.z) / 2));
    for (let k = 0; k < n; k++) pts.push({ x: p.x + (q.x - p.x) * k / n, z: p.z + (q.z - p.z) * k / n });
  }
  const r = Math.hypot(b.w, b.d) / 2;
  let best = 1e9, who = null;
  for (const s of segs) {
    // cheap reject on the segment's box
    if (Math.max(s.ax, s.bx) < b.x - r - H - CLEAR - 1 || Math.min(s.ax, s.bx) > b.x + r + H + CLEAR + 1 ||
        Math.max(s.az, s.bz) < b.z - r - H - CLEAR - 1 || Math.min(s.az, s.bz) > b.z + r + H + CLEAR + 1) continue;
    for (const p of pts) { const d = segDist(p.x, p.z, s); if (d < best) { best = d; who = s.route; } }
  }
  return { d: best, route: who };
}

const city = {
  regions: snap.regions.map((r) => Object.assign({ kind: "rect" }, r)),
  roads: snap.roads.map((r) => ({ x: r[0], z: r[1], vertical: !!r[2], len: r[3], w: r[4], district: r[5] })),
  minX: snap.city.minX, maxX: snap.city.maxX, minZ: snap.city.minZ, maxZ: snap.city.maxZ, annex: snap.annex,
};
const planned = [];
const out = [];
let total = 0;
for (const site of L.siteTable(city)) {
  const P = L.planSite(city, site, planned);
  planned.push({ id: site.id, regions: L.planRegions(P), plan: P });
  const rec = { id: site.id, bldgs: P.bldgs.length, onDeck: 0, byType: {}, examples: [], rows: 0, frontless: 0, frontEx: [] };
  // street segments for the front test
  const SS = [];
  for (const st of P.streets) for (let i = 0; i + 1 < st.pts.length; i++) SS.push({ ax: st.pts[i].x, az: st.pts[i].z, bx: st.pts[i + 1].x, bz: st.pts[i + 1].z, w: st.w });
  for (const bb of P.bulbs || []) SS.push({ ax: bb.x, az: bb.z, bx: bb.x, bz: bb.z, w: bb.r * 2 });
  for (const b of P.bldgs) {
    const f = footDist(b);
    if (f.d < H + CLEAR) {
      rec.onDeck++;
      rec.byType[b.type] = (rec.byType[b.type] || 0) + 1;
      if (rec.examples.length < 5) rec.examples.push({ type: b.type, x: b.x, z: b.z, w: b.w, d: b.d, gap: +(f.d - H).toFixed(1), route: f.route });
    }
  }
  // A TERRACE FACES A STREET: the middle of a row house's front wall must
  // be within its front step + footway (1.5 + 3.2 m, +2 m slack) of a
  // street edge. A front with no street is a terrace facing a verge, a
  // freeway shoulder or nothing at all.
  for (const b of P.bldgs) {
    if (b.type !== "row" || !b.face || b.face === "rot") continue;
    rec.rows++;
    const f = { n: [0, 1], s: [0, -1], e: [1, 0], w: [-1, 0] }[b.face];
    if (!f) continue;
    const half = f[0] ? b.w / 2 : b.d / 2;
    const fx = b.x + f[0] * half, fz = b.z + f[1] * half;
    let best = 1e9;
    for (const q of SS) {
      if (Math.abs(q.ax - fx) > 400 && Math.abs(q.bx - fx) > 400 && Math.sign(q.ax - fx) === Math.sign(q.bx - fx)) continue;
      const d = segDist(fx, fz, q) - q.w / 2;
      if (d < best) best = d;
    }
    if (best > FRONT) { rec.frontless++; if (rec.frontEx.length < 4) rec.frontEx.push(`${b.x},${b.z} faces ${b.face} (street ${best > 1e8 ? "none" : best.toFixed(0) + " m"})`); }
  }
  total += rec.onDeck + rec.frontless;
  out.push(rec);
}
if (argv.includes("--json")) console.log(JSON.stringify(out, null, 1));
else for (const r of out) {
  console.log(`${r.id.padEnd(14)} ${String(r.bldgs).padStart(5)} buildings · ${r.onDeck} within ${H}+${CLEAR} m of a freeway centreline` +
    (r.onDeck ? "  " + JSON.stringify(r.byType) + "  e.g. " + r.examples.map((e) => `${e.type}@${e.x},${e.z} (gap ${e.gap} m, ${e.route})`).join("; ") : "") +
    ` · ${r.frontless}/${r.rows} row houses face no street` + (r.frontless ? "  e.g. " + r.frontEx.join("; ") : ""));
}
console.log(`\n${total} buildings on or against a freeway deck, or row houses facing no street — ${total ? "FAIL" : "PASS"}`);
process.exit(total ? 1 : 0);
