#!/usr/bin/env node
/* tools/metro-facades-check.mjs — THE METRO STREETS WEAR THE REAL FACADE
   KIT, CHECKED IN PLAIN NODE.

   city/metro_fabric.js's FACADE CELLS hand every metro building near the
   camera to city/facade_kit.js's grammars (the Gang City downtown's real 3D
   facades) and write the result into one mesh per 200 m cell. This plans
   every metro city (the live-world snapshot, seed 90210), builds EVERY
   facade cell through the same sliced job the game runs, and FAILS (exit 1)
   when:
     • a dressed building's kit geometry leaves its footprint by more than
       KIT_REACH + 0.3 m (onto the footway, into a neighbour), dips under
       the lot, or rises more than 1.2 m over its parapet (the fabric owns the
       roofline, and the far HLOD has to match it)
     • a cell at full detail costs more than CELL_TRI_MAX triangles, or a
       chunk of it more than one draw call or 64k vertices (16-bit index)
     • a dressable district ends up with no kit at all (the grammars did not
       load, or every box was thrown away)
     • any building throws while it is written (the fabric only warns)
     • a plan flagged uniform gets a single variant (plan.uniform: the
       planned capital is identical blocks on purpose)
   and reports VARIETY: distinct material / colour / window / roofline
   combinations among the 20 buildings nearest each spot, and how many
   next-door pairs in the whole city came out identical.
   Then it reports what streams in around two real spots in Kingsport: the
   densest CBD street and a rowhouse street (every cell within the stream
   radius, each at the level of detail metro.js would stream it at), in
   triangles (all of it, and what a 100-degree view down the street draws),
   draw calls, vertices, MB, and the CPU time of the 3 ms slices it is built
   in (process CPU time: on a loaded machine wall time measures the
   scheduler, not the code).
   Zero browser, a few seconds. Usage: node tools/metro-facades-check.mjs [--seed N] [--json]
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
require(path.join(ROOT, "src/core/seed.js"));
// the kit and its grammars, in index.html's order
require(path.join(ROOT, "src/city/facade_kit.js"));
const html = readFileSync(path.join(ROOT, "index.html"), "utf8");
for (const m of html.matchAll(/<script src="(src\/city\/facades\/[a-z]+\.js)/g)) require(path.join(ROOT, m[1]));
require(path.join(ROOT, "src/city/metroplan.js"));
require(path.join(ROOT, "src/city/metro.js"));
require(path.join(ROOT, "src/city/metro_fabric.js"));
const CBZ = globalThis.window.CBZ;
const L = CBZ.metroLib, F = CBZ.metroFabric;
// an emitter that throws is caught per building and only warned about: count them
let emitterWarnings = 0; const warnEx = [];
const _warn = console.warn;
console.warn = function () { const t = Array.from(arguments).map(String).join(" "); if (/metro_fabric/.test(t)) { emitterWarnings++; if (warnEx.length < 3) warnEx.push(t.slice(0, 200)); return; } return _warn.apply(console, arguments); };

const CELL_TRI_MAX = 800000;    // one 100 m cell at full detail (the densest block of deco towers, Karvel's copy of the old CBD, is ~720k)
const STREAM_R = 250;           // metro.js KIT_R
const SPOTS_ONLY = argv.includes("--spots");
const GY = 0.16;

const city = {
  regions: snap.regions.map((r) => Object.assign({ kind: "rect" }, r)),
  roads: snap.roads.map((r) => ({ x: r[0], z: r[1], vertical: !!r[2], len: r[3], w: r[4], district: r[5] })),
  minX: snap.city.minX, maxX: snap.city.maxX, minZ: snap.city.minZ, maxZ: snap.city.maxZ, annex: snap.annex,
};
const fails = [], out = [];
const T0 = Date.now();
F.setFreeFar(false);
if (!CBZ.facadeStyles || CBZ.facadeStyles() < 20) fails.push("facade kit: only " + (CBZ.facadeStyles ? CBZ.facadeStyles() : 0) + " grammars loaded");
const planned = [];
const cellsOf = {};
for (const site of L.siteTable(city)) {
  const P = L.planSite(city, site, planned);
  planned.push({ id: site.id, regions: L.planRegions(P), plan: P });
  const pr = F.prepare(P, { tile: L.TILE, name: site.id });
  const rec = { id: site.id, buildings: P.bldgs.length, dressed: 0, cells: pr.kit.length, tris: 0, verts: 0, MB: 0, worstCellTris: 0, worstCellMs: 0,
    grammars: {}, outside: 0, examples: [] };
  const byGrammar = {};
  cellsOf[site.id] = [];
  for (const c of pr.kit) {
    if (SPOTS_ONLY) { cellsOf[site.id].push({ c, P, n: c.idx.length }); continue; }
    const J = F.job(P, c, "kit"); J.marks = [];
    const t0 = Date.now();
    const r = F.runJob(J, Infinity);
    const ms = r.stats.ms;
    rec.tris += r.stats.triangles; rec.verts += r.stats.vertices; rec.MB += r.stats.bytes / 1048576;
    rec.worstCellTris = Math.max(rec.worstCellTris, r.stats.triangles);
    rec.worstCellMs = Math.max(rec.worstCellMs, +ms.toFixed(1));
    cellsOf[site.id].push({ c, P, tris: r.stats.triangles, verts: r.stats.vertices, bytes: r.stats.bytes, ms, n: c.idx.length });
    if (r.stats.triangles > CELL_TRI_MAX) fails.push(site.id + " cell " + c.key + ": " + r.stats.triangles + " triangles > " + CELL_TRI_MAX);
    // one draw call per chunk (the chunks are all one material); every
    // chunk under 64k vertices (16-bit index)
    const geos = (c.meshes || []).slice(0, c.chunks).map((m) => m.geometry);
    for (const g of geos) {
      if (g.groups.length > 1) fails.push(site.id + " cell " + c.key + ": a chunk with " + g.groups.length + " draw calls");
      if (g.attributes.position.count >= 65536) fails.push(site.id + " cell " + c.key + ": a chunk of " + g.attributes.position.count + " vertices");
    }
    rec.chunks = (rec.chunks || 0) + geos.length;
    // every dressed building's kit stays on its lot (marks count vertices across the chunks)
    const pos = new Float32Array(geos.reduce((a, g) => a + g.attributes.position.array.length, 0));
    { let o = 0; for (const g of geos) { pos.set(g.attributes.position.array, o); o += g.attributes.position.array.length; } }
    const ox = (c.ix + 0.5) * F.KIT_CELL, oz = (c.iz + 0.5) * F.KIT_CELL;
    const M = J.marks;
    for (let k = 0; k < M.length; k += 3) {
      const i = M[k], v0 = M[k + 1], v1 = M[k + 2], b = F.variants(P)[i];     // the building as the fabric draws it
      const parts = F.kitParts(P, b, c.masks[i]);
      const gname = parts ? parts[0].style : "?";
      byGrammar[gname] = byGrammar[gname] || { bldgs: 0, tris: 0 };
      if (v1 > v0) { rec.dressed++; byGrammar[gname].bldgs++; byGrammar[gname].tris += (v1 - v0) / 2; }
      if (!parts) continue;
      const p = parts[0];
      const cs = Math.cos(p.rot), sn = Math.sin(p.rot);
      const lim = F.KIT_REACH + 0.3;
      let top = 0; for (const q of parts) top = Math.max(top, q.wallTop);
      let bad = "";
      for (let v = v0; v < v1 && !bad; v++) {
        const wx = pos[v * 3] + ox - b.x, wy = pos[v * 3 + 1], wz = pos[v * 3 + 2] + oz - b.z;
        // world -> the building's frame (metro_fabric frame(): world = (lx c + lz s, -lx s + lz c))
        const lx = wx * cs - wz * sn, lz = wx * sn + wz * cs;
        const hw = (isRowish(b) ? p.w : b.w) / 2, hd = (isRowish(b) ? p.d : b.d) / 2;
        if (Math.abs(lx) > hw + lim || Math.abs(lz) > hd + lim) bad = "off its lot (" + lx.toFixed(2) + "," + lz.toFixed(2) + " vs " + hw.toFixed(2) + "x" + hd.toFixed(2) + ")";
        else if (wy < GY - 0.31) bad = "under the lot (y " + wy.toFixed(2) + ")";
        else if (wy > GY + top + 1.2) bad = "over the parapet (y " + wy.toFixed(2) + " vs " + (GY + top).toFixed(2) + ")";
      }
      if (bad) { rec.outside++; if (rec.examples.length < 6) rec.examples.push(b.type + "/" + gname + "@" + b.x.toFixed(0) + "," + b.z.toFixed(0) + ": " + bad); }
    }
    for (const g of geos) g.dispose();
  }
  rec.MB = +rec.MB.toFixed(1);
  rec.grammars = byGrammar;
  for (const gname in byGrammar) if (byGrammar[gname].bldgs === 0) fails.push(site.id + ": no " + gname + " building got any kit");
  if (rec.outside) fails.push(site.id + ": " + rec.outside + " dressed buildings leave their lot — " + rec.examples.join(" | "));
  if (pr.kit.length && !rec.dressed) fails.push(site.id + ": facade cells but nothing dressed");
  out.push(rec);
}
function isRowish(b) { return b.type === "row" || ((b.type === "office" || b.type === "apt") && b.style === "row"); }

// ---- two real Kingsport streets: what streams in around them -----------
// every cell within the stream radius, built at the level metro.js would
// stream it at from this spot (by its nearest distance); `view` is what a
// 100-degree view straight down the street's long axis draws of it
function around(id, x, z, dirX, dirZ) {
  let tris = 0, verts = 0, bytes = 0, ms = 0, n = 0, worstMs = 0, bld = 0, view = 0, chunks = 0;
  const sl = [];
  const R = F.KIT_LOD_R, lv = R.map(() => 0), perLevel = R.map(() => []);
  for (const e of cellsOf[id] || []) {
    const c = e.c;
    const dx = Math.max(c.x0 - x, 0, x - c.x1), dz = Math.max(c.z0 - z, 0, z - c.z1);
    const d = Math.hypot(dx, dz);
    if (d > STREAM_R) continue;
    let lod = 0; while (lod + 1 < R.length && d >= R[lod + 1]) lod++;
    // a street-level camera (third person: eye ~3 m up), metro.js's slack
    c.lod = lod; c.anchor = { y: GY + 3, slack: 15 };
    // the way metro.js runs it: 3 ms slices; the worst single slice is what
    // a frame can feel
    const J = F.job(e.P, c, "kit");
    let r = null;
    while (!r) { const c0 = process.cpuUsage(); r = F.runJob(J, 3); const u = process.cpuUsage(c0); sl.push((u.user + u.system) / 1000); }
    for (const m of c.meshes || []) m.geometry.dispose();
    chunks += r.stats.chunks || 0;
    n++; lv[lod]++; tris += r.stats.triangles; verts += r.stats.vertices; bytes += r.stats.bytes; ms += r.stats.ms; bld += e.n;
    worstMs = Math.max(worstMs, r.stats.ms);
    perLevel[lod].push(Math.round(r.stats.triangles / 1000) + "k/" + r.stats.ms.toFixed(0) + "ms");
    // in the view cone? (the cell's centre within 50 deg of the view axis, or the camera's own cell)
    const cx = (c.ix + 0.5) * F.KIT_CELL - x, cz = (c.iz + 0.5) * F.KIT_CELL - z, L = Math.hypot(cx, cz);
    if (L < 75 || (cx * dirX + cz * dirZ) / L > Math.cos(50 * Math.PI / 180)) view += r.stats.triangles;
  }
  sl.sort((a, b) => a - b);
  const pct = (q) => sl.length ? +sl[Math.min(sl.length - 1, Math.floor(sl.length * q))].toFixed(1) : 0;
  return { cells: n, levels: lv, buildings: bld, tris, view, verts, chunks, slices: sl.length, sliceP50: pct(0.5), sliceP99: pct(0.99), sliceMax: pct(1), MB: +(bytes / 1048576).toFixed(1), buildMs: +ms.toFixed(0), worstCellMs: +worstMs.toFixed(1),
    perLevel: perLevel.map((l) => l.join(" ")) };
}
const K = planned.find((p) => p.id === "kingsport");
const spots = {};
if (K) {
  const P = K.plan;
  // the CBD street: the cell with the most tower floor area; the row street:
  // the cell with the most rows
  const score = (pred, w) => {
    const m = new Map();
    for (const b of P.bldgs) if (pred(b)) { const k = Math.floor(b.x / 200) + "," + Math.floor(b.z / 200); const r = m.get(k) || { s: 0, x: 0, z: 0, n: 0 }; r.s += w(b); r.x += b.x; r.z += b.z; r.n++; m.set(k, r); }
    let best = null; for (const r of m.values()) if (!best || r.s > best.s) best = r;
    return best ? { x: best.x / best.n, z: best.z / best.n } : null;
  };
  const cbd = score((b) => b.type === "tower", (b) => b.w * b.d * b.h);
  const row = score((b) => isRowish(b), () => 1);
  if (cbd) spots.cbd = Object.assign({ at: [Math.round(cbd.x), Math.round(cbd.z)] }, around("kingsport", cbd.x, cbd.z, 1, 0));
  if (row) spots.rows = Object.assign({ at: [Math.round(row.x), Math.round(row.z)] }, around("kingsport", row.x, row.z, 1, 0));
}
// ---- VARIETY: the 20 buildings nearest each spot, what they look like ----
function variety(P, x, z) {
  const V = F.variants(P);
  const idx = P.bldgs.map((b, i) => i).sort((a, b) => Math.hypot(P.bldgs[a].x - x, P.bldgs[a].z - z) - Math.hypot(P.bldgs[b].x - x, P.bldgs[b].z - z)).slice(0, 20);
  const key = (vb) => { const v = vb.v || {}; return [vb.style, (vb.wall >>> 0).toString(16), v.vbits | 0, vb.roof, v.cornice ? "c" : "", v.painted ? "p" : "", v.bayWin ? "b" : "", Math.round((vb.fh || 0) * 10), Math.round((v.bay || 0) * 10)].join("/"); };
  const combos = new Set(), mats = new Set(), walls = new Set(), wins = new Set(), roofs = new Set();
  for (const i of idx) { const vb = V[i], v = vb.v || {}; combos.add(key(vb)); mats.add(vb.style + (v.painted ? "-painted" : v.stoneFront ? "-stone" : "")); walls.add(vb.wall); wins.add(v.vbits | 0); roofs.add([vb.roof, v.cornice ? "cornice" : "", v.bayWin ? "baywin" : "", Math.round((v.par || 0) * 2)].join("")); }
  // identical next-door pairs along the plan (same district/type within 70 m)
  let same = 0, pairs = 0;
  for (let i = 1; i < V.length; i++) {
    const a = P.bldgs[i - 1], b = P.bldgs[i];
    if (a.dist !== b.dist || a.type !== b.type || Math.abs(a.x - b.x) + Math.abs(a.z - b.z) >= 70) continue;
    pairs++; if (key(V[i - 1]) === key(V[i])) same++;
  }
  return { n: idx.length, combos: combos.size, materials: mats.size, wallColours: walls.size, windows: wins.size, rooflines: roofs.size, identicalNeighbours: same + "/" + pairs };
}
if (K) {
  if (spots.cbd) spots.cbd.variety = variety(K.plan, spots.cbd.at[0], spots.cbd.at[1]);
  if (spots.rows) spots.rows.variety = variety(K.plan, spots.rows.at[0], spots.rows.at[1]);
  // UNIFORM: a plan flagged uniform is drawn exactly as planned
  const U = Object.assign({}, K.plan, { uniform: true });
  const VU = F.variants(U);
  let changed = 0; for (let i = 0; i < VU.length; i++) if (VU[i] !== U.bldgs[i]) changed++;
  if (changed) fails.push("uniform plan: " + changed + " buildings got a variant");
}
if (emitterWarnings) fails.push(emitterWarnings + " emitter warnings (a building threw while being written): " + warnEx.join(" | "));
const S = F.kitStats;
if (argv.includes("--json")) console.log(JSON.stringify({ cities: out, spots, boxes: S, fails }, null, 1));
else {
  for (const r of out) {
    const gl = Object.keys(r.grammars).map((g) => g + " " + r.grammars[g].bldgs + " (" + Math.round(r.grammars[g].tris / Math.max(1, r.grammars[g].bldgs)) + " tris ea)").join(", ");
    console.log(`${r.id.padEnd(16)} ${String(r.dressed).padStart(5)}/${r.buildings} dressed in ${r.cells} cells (${r.chunks} chunks at full detail): ${r.tris} tris, ${r.MB} MB total, worst cell ${r.worstCellTris} tris / ${r.worstCellMs} ms`);
    console.log(`${"".padEnd(16)} ${gl}`);
  }
  for (const k in spots) {
    const q = spots[k];
    console.log(`kingsport ${k} street @${q.at}: ${q.cells} cells within ${STREAM_R} m (per level ${q.levels.join("/")}), ${q.buildings} buildings: ${q.tris} tris streamed in ${q.chunks} draw calls, ~${q.view} in a 100-deg view, ${q.verts} verts, ${q.MB} MB, ${q.buildMs} ms wall to build; ${q.slices} slices of 3 ms, CPU p50 ${q.sliceP50} / p99 ${q.sliceP99} / max ${q.sliceMax} ms`);
    q.perLevel.forEach((l, i) => console.log(`   L${i} cells (tris/ms): ${l}`));
    if (q.variety) console.log(`   variety of the 20 nearest: ${q.variety.combos} distinct combos, ${q.variety.materials} materials, ${q.variety.wallColours} wall colours, ${q.variety.windows} window types, ${q.variety.rooflines} rooflines; identical next-door pairs in the city ${q.variety.identicalNeighbours}`);
  }
  for (const g in S.colour || {}) {
    const c = S.colour[g], n = c.n;
    console.log(`colour ${g.padEnd(11)} ${String(n).padStart(5)} bldgs: gain r/g/b ${c.gain.map((v) => (v / n).toFixed(2)).join("/")}, ${c.remapped} re-mapped by lightness; kit mean minus wall ${c.meanDiff.map((v) => (v / n).toFixed(0)).join("/")} (0-255)`);
  }
  console.log(`kit boxes: ${S.boxes} emitted, ${S.kept} kept, ${S.glass} glass (the shader's glass shows), ${S.roof} roof/buried, ${S.face} party-wall/footway, ${S.cut} cut by storefronts/tiers — ${((Date.now() - T0) / 1000).toFixed(1)} s`);
  console.log(fails.length ? "FAIL\n  " + fails.join("\n  ") : "PASS — every dressed building's kit stays on its lot and under its parapet; one draw call per chunk, every chunk 16-bit");
}
process.exit(fails.length ? 1 : 0);
