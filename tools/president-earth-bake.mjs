#!/usr/bin/env node
/* tools/president-earth-bake.mjs — THE REAL WORLD, AS TILES, FOR THE
   PRESIDENT GAME.

   OWNER (2026-10-28): "No made-up countries and no fake maps. Real
   countries on a real world map." And: "a full world game and then regions
   ... just usa like state vs state."

   Reads Natural Earth's 1:50m admin-0 countries (public domain, as the
   world-atlas package ships them: TopoJSON, ISO 3166 numeric ids) and
   Natural Earth's 1:50m admin-1 states and provinces (for the 50 US states
   and DC), and rasterizes them onto the President game's tile grid:
   equirectangular, STEP degrees a tile, from LAT_N down to LAT_S (the polar
   caps carry no country anybody fights over and only stretch the
   projection). Writes src/president/earth.js:
     names/iso/rle      every country (and territory) that owns a tile
     us/usNames/usRle   the state under every US tile (USA scenario)
   EVERY country gets at least one tile: a microstate the grid is too coarse
   for (Vatican, Monaco, Bahrain, Singapore, the small islands) is given the
   tile under its own centre, so it is on the map and can be taken. Same for
   DC among the states.

   Who is PLAYABLE (and everything about them) is src/president/nations.js
   and src/president/states.js; this file only says where land is and whose.

   USAGE  node tools/president-earth-bake.mjs [--src countries-50m.json]
            [--admin1 ne_50m_admin_1_states_provinces.geojson] [--step 0.3]
          (no --src / --admin1: fetched from cdn.jsdelivr.net) */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const STEP = +arg("--step", 0.3);
const LAT_N = 76, LAT_S = -56, LON_W = -180;
const W = Math.round(360 / STEP), H = Math.round((LAT_N - LAT_S) / STEP);

async function load(file, url) {
  if (file) return JSON.parse(fs.readFileSync(file, "utf8"));
  return await (await fetch(url)).json();
}
const topo = await load(arg("--src", null), "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json");
const adm1 = await load(arg("--admin1", null), "https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_50m_admin_1_states_provinces.geojson");

// ---- a shape: rings unwrapped across the antimeridian, with a bounding box.
// A ring that crosses it (Chukotka, Fiji, the Aleutians) becomes one
// continuous run of longitudes, or the even-odd test paints a band right round
// the world at its latitude; inside() tries lon, lon+360 and lon-360.
function shape(id, name, rawRings) {
  const rings = [];
  for (const r0 of rawRings) {
    const pts = r0.map((p) => [p[0], p[1]]);
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
  // the centre of the biggest ring (by box): where a microstate's one tile goes
  let big = null, ba = -1;
  for (const r of rings) {
    let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9;
    for (const [x, y] of r) { if (x < a0) a0 = x; if (x > a1) a1 = x; if (y < b0) b0 = y; if (y > b1) b1 = y; }
    const a = (a1 - a0) * (b1 - b0);
    if (a > ba) { ba = a; big = [(a0 + a1) / 2, (b0 + b1) / 2]; }
  }
  return { id, name, rings, x0, x1, y0, y1, centre: big || [(x0 + x1) / 2, (y0 + y1) / 2] };
}
// even-odd over every ring of the shape: holes (Lesotho in South Africa) fall out
function inside(c, x, y) { return inside1(c, x, y) || inside1(c, x + 360, y) || inside1(c, x - 360, y); }
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

// ---- TopoJSON countries: quantized, delta-encoded arcs
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
const C = [];
for (const g of topo.objects.countries.geometries) {
  if (!g.arcs) continue;
  if (g.properties.name === "Antarctica") continue;
  const polys = g.type === "Polygon" ? [g.arcs] : g.arcs;
  const raw = [];
  for (const p of polys) for (const r of p) raw.push(ring(r));
  // no ISO number (Kosovo, Somaliland, N. Cyprus): keyed by name
  C.push(shape(g.id ? String(g.id) : "n:" + g.properties.name, g.properties.name, raw));
}

// ---- rasterize: a tile is the shape under its centre (or, for a coast tile
// whose centre is sea, the shape under most of its four quarters, so thin
// countries and islands keep their tiles)
function raster(shapes, mask) {
  const grid = new Int16Array(W * H).fill(-1);
  for (let ry = 0; ry < H; ry++) {
    const lat = LAT_N - (ry + 0.5) * STEP;
    const near = [];
    for (let k = 0; k < shapes.length; k++) { const c = shapes[k]; if (lat >= c.y0 - STEP && lat <= c.y1 + STEP) near.push(k); }
    if (!near.length) continue;
    for (let rx = 0; rx < W; rx++) {
      if (mask && !mask(ry * W + rx)) continue;
      const lon = LON_W + (rx + 0.5) * STEP;
      let hit = -1;
      for (const k of near) if (inside(shapes[k], lon, lat)) { hit = k; break; }
      if (hit < 0) {
        const votes = {};
        for (const [dx, dy] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) {
          for (const k of near) if (inside(shapes[k], lon + dx * STEP, lat + dy * STEP)) { votes[k] = (votes[k] || 0) + 1; break; }
        }
        let best = -1, bv = 1;
        for (const k in votes) if (votes[k] > bv) { bv = votes[k]; best = +k; }
        hit = best;
      }
      grid[ry * W + rx] = hit;
    }
  }
  return grid;
}
const tileAt = (lon, lat) => {
  let x = Math.floor((lon - LON_W) / STEP); x = ((x % W) + W) % W;
  const y = Math.max(0, Math.min(H - 1, Math.floor((LAT_N - lat) / STEP)));
  return y * W + x;
};
// a shape the grid is too coarse for gets the tile under its own centre (sea
// or a big neighbour's land; never a small neighbour's only tiles)
function force(grid, shapes, count) {
  for (let k = 0; k < shapes.length; k++) {
    if (count[k] > 0) continue;
    const c = shapes[k];
    if (c.y1 < LAT_S || c.y0 > LAT_N) continue;
    const t = tileAt(c.centre[0], Math.max(LAT_S + STEP, Math.min(LAT_N - STEP, c.centre[1])));
    const was = grid[t];
    if (was >= 0 && count[was] < 12) continue;
    if (was >= 0) count[was]--;
    grid[t] = k; count[k] = 1;
  }
}
const grid = raster(C);
const cnt = new Int32Array(C.length);
for (const v of grid) if (v >= 0) cnt[v]++;
force(grid, C, cnt);

// keep only the countries that own a tile; renumber by name
const used = [];
for (let k = 0; k < C.length; k++) if (cnt[k] > 0) used.push(k);
const keep = used.sort((a, b) => C[a].name.localeCompare(C[b].name));
const remap = new Map(keep.map((k, i) => [k, i]));
const land = new Int16Array(W * H).fill(-1);
for (let i = 0; i < W * H; i++) if (grid[i] >= 0) land[i] = remap.get(grid[i]);

// ---- the US states, on the US's own tiles
const usaK = keep.findIndex((k) => C[k].id === "840");
const ST = [];
for (const f of adm1.features) {
  const p = f.properties;
  if (p.adm0_a3 !== "USA") continue;
  const g = f.geometry;
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  const raw = [];
  for (const poly of polys) for (const r of poly) raw.push(r);
  ST.push(shape(p.postal, p.name, raw));
}
ST.sort((a, b) => a.id.localeCompare(b.id));
const isUS = (i) => land[i] === usaK;
const sgrid = raster(ST, isUS);
// US tiles no state polygon caught (a coast tile won by the country's quarter
// vote): the nearest state, grown outward
{
  const q = [];
  for (let i = 0; i < W * H; i++) if (isUS(i) && sgrid[i] >= 0) q.push(i);
  for (let k = 0; k < q.length; k++) {
    const j = q[k], x = j % W, y = (j / W) | 0;
    for (const t of [x > 0 ? j - 1 : j + W - 1, x < W - 1 ? j + 1 : j - W + 1, y > 0 ? j - W : -1, y < H - 1 ? j + W : -1]) {
      if (t >= 0 && isUS(t) && sgrid[t] < 0) { sgrid[t] = sgrid[j]; q.push(t); }
    }
  }
}
const scnt = new Int32Array(ST.length);
for (const v of sgrid) if (v >= 0) scnt[v]++;
force(sgrid, ST, scnt);
for (let i = 0; i < W * H; i++) if (sgrid[i] >= 0 && land[i] < 0) land[i] = usaK;     // a forced state tile on the water is US land

// ---- run-length: value char (0x30 + v + 1, 0x30 = none), length char (0x30 + n, n <= 4000)
function rle(get) {
  let s = "";
  for (let i = 0; i < W * H;) {
    const v = get(i);
    let n = 1;
    while (i + n < W * H && n < 4000 && get(i + n) === v) n++;
    s += String.fromCharCode(0x30 + v) + String.fromCharCode(0x30 + n);
    i += n;
  }
  return s;
}
const rleW = rle((i) => land[i] + 1);
const rleU = rle((i) => sgrid[i] + 1);
const names = keep.map((k) => C[k].name);
const isos = keep.map((k) => C[k].id);
const out = `/* ============================================================
   president/earth.js — GENERATED by tools/president-earth-bake.mjs. Do not
   edit by hand: re-run the tool.

   The real world on the President game's tile grid: Natural Earth 1:50m
   admin-0 countries and 1:50m admin-1 US states (public domain),
   equirectangular, ${STEP} degrees a tile, latitude ${LAT_N} N to ${-LAT_S} S.
   rle is (value, length) character pairs, both offset by 0x30: value 0 is
   sea, value k is names[k - 1]. iso is the ISO 3166 numeric code per name
   ("n:<name>" where Natural Earth has none). usRle is the same over the US's
   tiles only: value k is us[k - 1] (postal code), 0 elsewhere.
============================================================ */
(function (root) {
  "use strict";
  const G = (typeof window !== "undefined" && window) || root;
  const CBZ = G.CBZ = G.CBZ || {};
  CBZ.presEarth = {
    W: ${W}, H: ${H}, step: ${STEP}, latN: ${LAT_N}, latS: ${LAT_S}, lonW: ${LON_W},
    names: ${JSON.stringify(names)},
    iso: ${JSON.stringify(isos)},
    rle: ${JSON.stringify(rleW)},
    us: ${JSON.stringify(ST.map((s) => s.id))},
    usNames: ${JSON.stringify(ST.map((s) => s.name))},
    usRle: ${JSON.stringify(rleU)},
  };
  if (typeof module !== "undefined" && module.exports) module.exports = CBZ.presEarth;
})(this);
`;
fs.writeFileSync(path.join(ROOT, "src/president/earth.js"), out);
const tiny = keep.filter((k) => cnt[k] <= 2).map((k) => C[k].name + " " + cnt[k]);
console.log(`earth: ${W}x${H} tiles, ${names.length} countries, ${ST.length} states, rle ${rleW.length}+${rleU.length} chars, file ${(out.length / 1024).toFixed(0)} KB`);
console.log("one- or two-tile countries: " + tiny.join(", "));
console.log("state tiles: " + ST.map((s, k) => s.id + " " + scnt[k]).join(", "));
