#!/usr/bin/env node
/* tools/president-earth-bake.mjs — THE REAL WORLD, AS TILES, FOR THE
   PRESIDENT GAME.

   OWNER (2026-10-28): "No made-up countries and no fake maps. Real
   countries on a real world map."

   Reads Natural Earth's 1:50m admin-0 countries (public domain), as the
   world-atlas package ships them (TopoJSON, ISO 3166 numeric ids), and
   rasterizes them onto the President game's tile grid: equirectangular,
   STEP degrees a tile, from LAT_N down to LAT_S (the polar caps carry no
   country anybody fights over and only stretch the projection). Writes
   src/president/earth.js: the grid run-length encoded, the country names,
   and their ISO numeric codes. Who is PLAYABLE (and everything about them)
   is src/president/nations.js; this file only says where land is and whose.

   USAGE  node tools/president-earth-bake.mjs [--src countries-50m.json] [--step 0.6]
          (no --src: fetched from cdn.jsdelivr.net/npm/world-atlas@2) */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const STEP = +arg("--step", 0.6);
const LAT_N = 76, LAT_S = -56, LON_W = -180;
const W = Math.round(360 / STEP), H = Math.round((LAT_N - LAT_S) / STEP);

let topo;
const src = arg("--src", null);
if (src) topo = JSON.parse(fs.readFileSync(src, "utf8"));
else topo = await (await fetch("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json")).json();

// ---- TopoJSON: quantized, delta-encoded arcs
const [sx, sy] = topo.transform.scale, [tx, ty] = topo.transform.translate;
const arcs = topo.arcs.map((a) => { let x = 0, y = 0; return a.map((p) => { x += p[0]; y += p[1]; return [x * sx + tx, y * sy + ty]; }); });
function ring(ids) {
  const out = [];
  for (const i of ids) {
    const a = i >= 0 ? arcs[i] : arcs[~i].slice().reverse();
    for (let k = out.length ? 1 : 0; k < a.length; k++) out.push(a[k]);
  }
  return out;
}
const geoms = topo.objects.countries.geometries;
const C = [];
for (const g of geoms) {
  if (!g.arcs) continue;
  const polys = g.type === "Polygon" ? [g.arcs] : g.arcs;
  const rings = [];
  // a ring that crosses the antimeridian (Chukotka, Fiji) is unwrapped into
  // one continuous run of longitudes, or the even-odd test paints a band right
  // round the world at its latitude; inside() tries lon, lon+360 and lon-360
  for (const p of polys) for (const r of p) {
    const pts = ring(r);
    for (let i = 1; i < pts.length; i++) {
      let x = pts[i][0];
      while (x - pts[i - 1][0] > 180) x -= 360;
      while (x - pts[i - 1][0] < -180) x += 360;
      pts[i] = [x, pts[i][1]];
    }
    rings.push(pts);
  }
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const r of rings) for (const [x, y] of r) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  C.push({ id: String(g.id || ""), name: g.properties.name, rings, x0, x1, y0, y1 });
}
// even-odd over every ring of the country: holes (Lesotho in South Africa) fall out
function inside(c, x, y) {
  return inside1(c, x, y) || inside1(c, x + 360, y) || inside1(c, x - 360, y);
}
function inside1(c, x, y) {
  if (x < c.x0 || x > c.x1 || y < c.y0 || y > c.y1) return false;
  let ins = false;
  for (const r of c.rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins;
    }
  }
  return ins;
}
// ---- rasterize: a tile is the country under its centre (or, for a coast
// tile whose centre is sea, the country under most of its four quarters, so
// thin countries and islands keep their tiles)
const grid = new Int16Array(W * H).fill(-1);
const used = new Set();
for (let ry = 0; ry < H; ry++) {
  const lat = LAT_N - (ry + 0.5) * STEP;
  const near = C.filter((c) => lat >= c.y0 - STEP && lat <= c.y1 + STEP);
  for (let rx = 0; rx < W; rx++) {
    const lon = LON_W + (rx + 0.5) * STEP;
    let hit = -1;
    for (let k = 0; k < near.length; k++) if (inside(near[k], lon, lat)) { hit = C.indexOf(near[k]); break; }
    if (hit < 0) {
      const votes = {};
      for (const [dx, dy] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) {
        for (let k = 0; k < near.length; k++) if (inside(near[k], lon + dx * STEP, lat + dy * STEP)) { const i = C.indexOf(near[k]); votes[i] = (votes[i] || 0) + 1; break; }
      }
      let best = -1, bv = 1;
      for (const k in votes) if (votes[k] > bv) { bv = votes[k]; best = +k; }
      hit = best;
    }
    grid[ry * W + rx] = hit;
    if (hit >= 0) used.add(hit);
  }
}
// keep only the countries that own a tile; renumber
const keep = [...used].sort((a, b) => C[a].name.localeCompare(C[b].name));
const remap = new Map(keep.map((k, i) => [k, i]));
// ---- run-length: value char (0x30 + v + 1, 0x30 = sea), length char (0x30 + n, n <= 4000)
let rle = "";
for (let i = 0; i < W * H;) {
  const v = grid[i] < 0 ? 0 : remap.get(grid[i]) + 1;
  let n = 1;
  while (i + n < W * H && n < 4000 && (grid[i + n] < 0 ? 0 : remap.get(grid[i + n]) + 1) === v) n++;
  rle += String.fromCharCode(0x30 + v) + String.fromCharCode(0x30 + n);
  i += n;
}
const names = keep.map((k) => C[k].name);
const isos = keep.map((k) => C[k].id);
const out = `/* ============================================================
   president/earth.js — GENERATED by tools/president-earth-bake.mjs. Do not
   edit by hand: re-run the tool.

   The real world on the President game's tile grid: Natural Earth 1:50m
   admin-0 countries (public domain, via the world-atlas package),
   equirectangular, ${STEP} degrees a tile, latitude ${LAT_N} N to ${-LAT_S} S.
   rle is (value, length) character pairs, both offset by 0x30: value 0 is
   sea, value k is names[k - 1]. iso is the ISO 3166 numeric code per name.
============================================================ */
(function (root) {
  "use strict";
  const G = (typeof window !== "undefined" && window) || root;
  const CBZ = G.CBZ = G.CBZ || {};
  CBZ.presEarth = {
    W: ${W}, H: ${H}, step: ${STEP}, latN: ${LAT_N}, latS: ${LAT_S}, lonW: ${LON_W},
    names: ${JSON.stringify(names)},
    iso: ${JSON.stringify(isos)},
    rle: ${JSON.stringify(rle)},
  };
  if (typeof module !== "undefined" && module.exports) module.exports = CBZ.presEarth;
})(this);
`;
fs.writeFileSync(path.join(ROOT, "src/president/earth.js"), out);
console.log(`earth: ${W}x${H} tiles, ${names.length} countries, rle ${rle.length} chars, file ${(out.length / 1024).toFixed(0)} KB`);
