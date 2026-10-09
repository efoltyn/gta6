#!/usr/bin/env node
/* tools/layout-audit.mjs — IS THE WORLD ONE PLANNED PLACE? Measured.

   Owner (iPad, 2026-10): "a more general problem of the map layout and ground
   and road locations, everything feeling overly sparse, not dense in the right
   places. Sparse is fine, but it just feels like different parts were done
   unintentionally."

   Boots Gang City headless once (tools/lib/cdp.mjs), reads the PLAN DATA every
   generator built the world from (tools/lib/layout-dump.js: lots, metro plans,
   road records, the highway table, regions, a water grid, a tall-collider
   presence grid for everything else), then in plain node samples the world on
   a 100 m grid and reports:

     per cell   footprint coverage, floor-area ratio (FAR), height stats, road
                metres by class (highway / arterial / local / rural / alley),
                land use, the generator that produced it, the zoning field's
                intended intensity (when city/zoning.js is loaded)
     DENSITY    cliffs (a dense cell beside an empty land cell), dead zones
                (empty land enclosed by the built area), sprawl islands,
                the ring-by-ring gradient round every centre
     ROADS      dead-end stubs (by generator / class), disconnected networks,
                highways: access points per km and the longest urban run
                without one, streets with nothing on them
     SEAMS      generator-vs-generator overlaps and gaps, scale jumps across
                generator borders
     USES       homes fronting a freeway, estates beside industry, towers
                beside fields
     ZONING     (when the field exists) cells built far off the field's intent

   and prints a density heatmap (ASCII, whole world at 400 m + 100 m zooms).

   Usage:
     node tools/layout-audit.mjs                       boot, dump, analyse
     node tools/layout-audit.mjs --save d.json         ... and keep the dump
     node tools/layout-audit.mjs --dump d.json         analyse a saved dump (no browser)
     node tools/layout-audit.mjs --json out.json       write the numbers
     node tools/layout-audit.mjs --zoom x0,z0,x1,z1    extra 100 m zoom map
     node tools/layout-audit.mjs --tag before          the artifact's name in tools/audit/layout/
                                                       (<tag>.txt report, <tag>.json numbers)
     node tools/layout-audit.mjs --seed N
   Exit 0 always (it is a measurement); --strict exits 1 when a LAW breaks:
   homes inside a freeway corridor, a building in a highway's lanes. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const has = (k) => argv.includes(k);
const SEED = +opt("--seed", 90210);

// ============================================================ the dump
async function bootDump() {
  const { launch } = await import("./lib/cdp.mjs");
  const rig = await launch({ rafBudget: 30 });
  try {
    const t0 = Date.now();
    await rig.open("index.html", `mode=city&seed=${SEED}`);
    if (!await rig.wait("window.CBZ && CBZ.bootComplete && CBZ.startRun && document.readyState === 'complete'", 400000)) throw new Error("city never booted");
    const ms = await rig.evl("(function(){var t=performance.now();CBZ.startRun();return Math.round(performance.now()-t)})()");
    process.stderr.write(`booted ${((Date.now() - t0) / 1000).toFixed(1)} s (startRun ${ms} ms)\n`);
    const src = readFileSync(path.join(ROOT, "tools/lib/layout-dump.js"), "utf8");
    const txt = await rig.evl(src);
    if (rig.errors.length) process.stderr.write("page errors: " + rig.errors.slice(0, 4).join(" | ") + "\n");
    return JSON.parse(txt);
  } finally { await rig.close(); }
}

const D = has("--dump") ? JSON.parse(readFileSync(opt("--dump"), "utf8")) : await bootDump();
D.zoning = zoningFromDump(D);
if (has("--save")) writeFileSync(opt("--save"), JSON.stringify(D));
const res = analyse(D);
const report = print(res);
if (has("--json")) writeFileSync(opt("--json"), JSON.stringify(res, null, 1));
// the artifact: tools/audit/layout/ (ignored by the repo) keeps the report + numbers
{
  const dir = path.join(ROOT, "tools/audit/layout");
  mkdirSync(dir, { recursive: true });
  const tag = opt("--tag", "latest");
  writeFileSync(path.join(dir, tag + ".txt"), report + "\n");
  writeFileSync(path.join(dir, tag + ".json"), JSON.stringify(Object.assign({}, res, { maps: undefined }), null, 1));
  console.log(path.join(dir, tag + ".txt"));
}
if (has("--strict") && res.laws.length) process.exit(1);

// ============================================================ the zoning field
// The field is a pure function of the region layout and the highway table, so
// the audit rebuilds it in node from the dump (src/city/zoning.js, the same
// code the game plans with). A world from before the field existed is judged
// against the same field as a world built with it.
function zoningFromDump(D) {
  const require = createRequire(import.meta.url);
  const metroIds = new Set(D.metros.map((m) => m.id));
  globalThis.window = { CBZ: { CONFIG: {}, WORLD_SEED: D.seed,
    highwayNetTable: () => D.hw.map((h) => ({ id: h.id, name: h.name, pts: h.pts.map(([x, z]) => ({ x, z })), fillet: 0 })),
    HIGHWAY_NET_HALF: 15.3 } };
  require(path.join(ROOT, "src/city/metroplan.js"));
  require(path.join(ROOT, "src/city/metro.js"));
  require(path.join(ROOT, "src/city/zoning.js"));
  const CBZ = globalThis.window.CBZ;
  const city = Object.assign({}, D.city || { minX: -165, maxX: 165, minZ: -865, maxZ: -535 }, {
    regions: D.regions.map((r) => ({ name: r[0], biome: r[1] || undefined, minX: r[2], maxX: r[3], minZ: r[4], maxZ: r[5], kind: "rect", metro: metroIds.has(r[6]) ? r[6] : undefined })),
    roads: D.roads.filter((r) => r[6] === "highway").map((r) => {
      const vertical = Math.abs(r[0] - r[2]) < 0.01;
      return { x: (r[0] + r[2]) / 2, z: (r[1] + r[3]) / 2, vertical, len: Math.hypot(r[2] - r[0], r[3] - r[1]), w: r[4], district: "highway" };
    }),
  });
  const Z = CBZ.zoningLib.build(city);
  const g = D.waterGrid;
  const snap = Z.snapshot({ x0: g.x0, z0: g.z0, cell: g.cell, nx: g.nx, nz: g.nz });
  snap.inBuffer = (x, z, ext) => Z.inFreewayBuffer(x, z, ext);
  snap.ceilingAt = Z.ceilingAt;
  return snap;
}

// ============================================================ analysis
function analyse(D) {
  const G = D.waterGrid, C = G.cell, NX = G.nx, NZ = G.nz, N = NX * NZ;
  const ci = (x) => Math.floor((x - G.x0) / C), cj = (z) => Math.floor((z - G.z0) / C);
  const idx = (i, j) => (i < 0 || j < 0 || i >= NX || j >= NZ) ? -1 : j * NX + i;
  const cx = (i) => G.x0 + (i + 0.5) * C, cz = (j) => G.z0 + (j + 0.5) * C;
  const A = C * C;

  const water = new Float32Array(N);
  D.water.forEach((row, j) => { for (let i = 0; i < NX; i++) water[j * NX + i] = (+row[i]) / 5; });

  // ---- buildings into cells (rotated footprint's AABB, area-weighted)
  const cov = new Float32Array(N), far = new Float32Array(N), hmax = new Float32Array(N), hsum = new Float32Array(N), nb = new Int32Array(N);
  const genArea = Array.from({ length: N }, () => null);
  const useArea = Array.from({ length: N }, () => null);
  const USE = (b) => useOf(b);
  for (const b of D.bldgs) {
    const [x, z, w, d, rot, h, st0, , gen, place] = b;
    const st = st0 || Math.max(1, Math.round(h / 3.2));
    const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
    const ex = (w * c + d * s) / 2, ez = (w * s + d * c) / 2;
    const area = w * d, aabb = 4 * ex * ez;
    const i0 = ci(x - ex), i1 = ci(x + ex), j0 = cj(z - ez), j1 = cj(z + ez);
    const key = gen === "metro" || gen === "towngen" ? gen + ":" + place : gen;
    const u = USE(b);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = idx(i, j); if (k < 0) continue;
      const ox = Math.min(x + ex, G.x0 + (i + 1) * C) - Math.max(x - ex, G.x0 + i * C);
      const oz = Math.min(z + ez, G.z0 + (j + 1) * C) - Math.max(z - ez, G.z0 + j * C);
      if (ox <= 0 || oz <= 0) continue;
      const a = area * (ox * oz) / aabb;
      cov[k] += a / A; far[k] += a * st / A; hsum[k] += a * h; nb[k] += 1;
      if (h > hmax[k]) hmax[k] = h;
      (genArea[k] = genArea[k] || {})[key] = (genArea[k][key] || 0) + a;
      (useArea[k] = useArea[k] || {})[u] = (useArea[k][u] || 0) + a * st;
    }
  }
  // tall colliders nobody's plan accounts for (estates, airports, bases): presence only
  const other = new Float32Array(N);
  for (const [x, z] of D.other) { const k = idx(ci(x), cj(z)); if (k >= 0) other[k] += 625 / A; }

  // ---- roads into cells, by class
  const CLS = ["highway", "arterial", "local", "rural", "alley"];
  const road = CLS.map(() => new Float32Array(N));
  const clsOf = (r) => {
    const k = r[5];
    if (k === "highway") return 0;
    if (k === "art" || k === "arterial" || k === "col") return 1;
    if (k === "loc" || k === "local" || k === "cds") return 2;
    if (k === "rural" || k === "frontier") return 3;
    if (k === "alley") return 4;
    return -1;
  };
  const segs = [];
  for (const r of D.roads) { const c = clsOf(r); if (c < 0) continue; segs.push({ x0: r[0], z0: r[1], x1: r[2], z1: r[3], w: r[4], k: r[5], c, gen: r[6], place: r[7], el: r[8] }); }
  for (const h of D.hw) for (let p = 0; p + 1 < h.pts.length; p++) {
    segs.push({ x0: h.pts[p][0], z0: h.pts[p][1], x1: h.pts[p + 1][0], z1: h.pts[p + 1][1], w: h.width, k: "highway", c: 0, gen: "highway", place: h.name, hw: h.id, el: 0 });
  }
  // the highway table is the truth for the freeways (highwaynet.js): drop the
  // per-record copies of those routes. The OTHER "highway" records are the
  // causeways/bridges of city/highways.js (24 m, the old island links): keep
  // them, as freeway-class links.
  const tableW = new Set(D.hw.map((h) => h.width));
  const allSegs = segs.filter((s) => !(s.gen === "highway" && !s.hw && tableW.has(s.w)));
  for (const s of allSegs) if (s.gen === "highway" && !s.hw) s.place = "link";
  for (const s of allSegs) {
    const L = Math.hypot(s.x1 - s.x0, s.z1 - s.z0), n = Math.max(1, Math.ceil(L / 10));
    for (let t = 0; t < n; t++) {
      const f = (t + 0.5) / n, k = idx(ci(s.x0 + (s.x1 - s.x0) * f), cj(s.z0 + (s.z1 - s.z0) * f));
      if (k >= 0) road[s.c][k] += L / n;
    }
  }

  // ---- land use from regions (special sites) and parks
  const special = new Array(N).fill(null);
  const SPECIAL = /airport|military|speedway|arena|frontier/;
  for (const r of D.regions) {
    const [name, biome, x0, x1, z0, z1] = r;
    const isApproach = /approach|causeway|bridge|link/i.test(name);
    let tag = null;
    if (SPECIAL.test(biome)) tag = biome;
    else if (!biome && !isApproach && name) tag = "estate";      // govcomplex compounds, City Hall, County Jail
    else if (/forest|snow|desert|farmland/.test(biome)) tag = "biome:" + biome;
    if (!tag) continue;
    for (let j = cj(z0); j <= cj(z1); j++) for (let i = ci(x0); i <= ci(x1); i++) {
      const k = idx(i, j); if (k < 0) continue;
      if (!special[k] || tag === "estate") special[k] = tag;
    }
  }
  const park = new Float32Array(N);
  for (const [x0, z0, x1, z1, kind] of D.parks) {
    if (kind === "yard" || kind === "lot") continue;
    for (let j = cj(z0); j <= cj(z1); j++) for (let i = ci(x0); i <= ci(x1); i++) {
      const k = idx(i, j); if (k < 0) continue;
      const ox = Math.min(x1, G.x0 + (i + 1) * C) - Math.max(x0, G.x0 + i * C), oz = Math.min(z1, G.z0 + (j + 1) * C) - Math.max(z0, G.z0 + j * C);
      if (ox > 0 && oz > 0) park[k] += ox * oz / A;
    }
  }
  const zone = D.zoning && D.zoning.grid ? D.zoning : null;

  // ---- per-cell classification
  const roadsLen = (k) => road[0][k] + road[1][k] + road[2][k] + road[3][k] + road[4][k];
  const isWater = (k) => water[k] >= 0.6;
  const built = new Uint8Array(N);
  for (let k = 0; k < N; k++) built[k] = (cov[k] >= 0.015 || other[k] >= 0.12 || (road[2][k] + road[1][k]) >= 60) ? 1 : 0;
  const use = new Array(N);
  const gen = new Array(N);
  for (let k = 0; k < N; k++) {
    gen[k] = genArea[k] ? argmax(genArea[k]) : (other[k] >= 0.12 ? "other" : "");
    if (isWater(k)) use[k] = "water";
    else if (useArea[k] && cov[k] >= 0.015) use[k] = argmax(useArea[k]);
    else if (park[k] >= 0.3) use[k] = "park";
    else if (special[k]) use[k] = special[k].replace(/^biome:/, "");
    else if (other[k] >= 0.12) use[k] = "other";
    else use[k] = road[0][k] > 0 ? "corridor" : "open";
  }

  // ---- urban envelope: close the built mask by R cells (fills gaps <= 2R*C)
  const Rc = 2;
  const dil = morph(built, NX, NZ, Rc, true), env = morph(dil, NX, NZ, Rc, false);
  const landN = water.reduce((a, w) => a + (w < 0.6 ? 1 : 0), 0);

  // ===== DENSITY
  // dead zones: enclosed, unbuilt, land, not park / special / freeway corridor
  const dead = new Uint8Array(N);
  for (let k = 0; k < N; k++) {
    if (!env[k] || built[k] || isWater(k) || park[k] >= 0.3) continue;
    if (special[k] && !special[k].startsWith("biome:")) continue;
    if (road[0][k] > 0) continue;                       // the freeway's own verge
    dead[k] = 1;
  }
  const deadComps = components(dead, NX, NZ).filter((c) => c.cells.length >= 2).map((c) => ({
    ha: c.cells.length * A / 1e4, at: centroid(c.cells), near: nearGen(c.cells),
  })).sort((a, b) => b.ha - a.ha);
  // cliffs: FAR >= 1.0 next to an empty LAND cell that is not park/water/corridor
  const cliffs = [];
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const k = idx(i, j);
    if (far[k] < 1.0) continue;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const q = idx(i + di, j + dj); if (q < 0) continue;
      if (isWater(q) || park[q] >= 0.3 || road[0][q] > 0 || special[q] && !special[q].startsWith("biome:")) continue;
      if (cov[q] < 0.01) { cliffs.push({ at: [cx(i), cz(j)], far: r2(far[k]), h: Math.round(hmax[k]), gen: gen[k], to: use[q] }); break; }
    }
  }
  // sprawl islands: small built components far from anything bigger
  const comps = components(built, NX, NZ, true).map((c) => {
    let fa = 0; for (const k of c.cells) fa += far[k] * A;
    return { cells: c.cells, n: c.cells.length, floor: fa, at: centroid(c.cells), gen: nearGen(c.cells) };
  });
  const bigComps = comps.filter((c) => c.n >= 12);
  const islands = comps.filter((c) => c.n < 12 && c.floor > 0).map((c) => {
    let best = Infinity;
    for (const b of bigComps) if (b !== c) for (let t = 0; t < b.cells.length; t += 3) {
      const k = b.cells[t]; const d = Math.hypot(cx(k % NX) - c.at[0], cz((k / NX) | 0) - c.at[1]); if (d < best) best = d;
    }
    return { at: c.at, ha: c.n, floorM2: Math.round(c.floor), gen: c.gen, nearestTownM: Math.round(best) };
  }).filter((c) => c.nearestTownM > 500).sort((a, b) => b.nearestTownM - a.nearestTownM);
  // gradient round each centre: mean FAR of BUILT land cells in 250 m rings
  const centres = [];
  centres.push({ name: "Gang City downtown", x: 0, z: -700 });
  for (const m of D.metros) if (!(m.cores && m.cores[0] && m.cores[0].name === "downtown")) centres.push({ name: m.name + (m.id.endsWith("-ring") ? " ring" : ""), x: m.cores && m.cores[0] ? (m.cores[0].minX + m.cores[0].maxX) / 2 : coreOf(m).x, z: m.cores && m.cores[0] ? (m.cores[0].minZ + m.cores[0].maxZ) / 2 : coreOf(m).z });
  for (const s of D.settlements) if (!centres.some((c) => Math.hypot(c.x - s[1], c.z - s[2]) < 400)) centres.push({ name: s[0], x: s[1], z: s[2] });
  const gradients = centres.map((c) => {
    const rings = [];
    for (let r = 0; r < 8; r++) {
      let s = 0, n = 0, e = 0;
      for (let j = cj(c.z - (r + 1) * 250); j <= cj(c.z + (r + 1) * 250); j++) for (let i = ci(c.x - (r + 1) * 250); i <= ci(c.x + (r + 1) * 250); i++) {
        const k = idx(i, j); if (k < 0 || isWater(k)) continue;
        // the airport, a compound, a park: there on purpose, not a gap
        if (park[k] >= 0.3 || (special[k] && !special[k].startsWith("biome:"))) continue;
        const d = Math.hypot(cx(i) - c.x, cz(j) - c.z); if (d < r * 250 || d >= (r + 1) * 250) continue;
        s += far[k]; n++; if (!built[k]) e++;
      }
      rings.push(n ? { far: r2(s / n), empty: Math.round(100 * e / n) } : null);
    }
    let breaks = 0; for (let r = 1; r < rings.length; r++) if (rings[r] && rings[r - 1] && rings[r].far > rings[r - 1].far * 1.25 + 0.05) breaks++;
    return { name: c.name, at: [Math.round(c.x), Math.round(c.z)], rings, breaks };
  });

  // ===== ROADS
  const hashR = 60; const sh = new Map();
  const put = (s) => {
    const x0 = Math.floor(Math.min(s.x0, s.x1) / hashR), x1 = Math.floor(Math.max(s.x0, s.x1) / hashR);
    const z0 = Math.floor(Math.min(s.z0, s.z1) / hashR), z1 = Math.floor(Math.max(s.z0, s.z1) / hashR);
    for (let a = x0; a <= x1; a++) for (let b = z0; b <= z1; b++) { const key = a + "," + b; if (!sh.has(key)) sh.set(key, []); sh.get(key).push(s); }
  };
  const net = allSegs.filter((s) => s.k !== "frontier");   // the world-edge ring is its own road
  for (const s of net) put(s);
  const near = (x, z) => { const out = new Set(); const a = Math.floor(x / hashR), b = Math.floor(z / hashR); for (let u = a - 1; u <= a + 1; u++) for (let v = b - 1; v <= b + 1; v++) for (const s of sh.get(u + "," + v) || []) out.add(s); return out; };
  // union-find components; an end joins a segment it touches; two surface
  // streets that cross join; a freeway joins only at its own ends/docks
  const par = new Map(net.map((s) => [s, s]));
  const find = (s) => { while (par.get(s) !== s) { par.set(s, par.get(par.get(s))); s = par.get(s); } return s; };
  const join = (a, b) => { const x = find(a), y = find(b); if (x !== y) par.set(x, y); };
  const deadEnds = [];
  for (const s of net) {
    for (const [ex, ez] of [[s.x0, s.z0], [s.x1, s.z1]]) {
      let hit = false;
      for (const o of near(ex, ez)) {
        if (o === s) continue;
        if (pdist(ex, ez, o) <= o.w / 2 + Math.max(4, s.w / 2) + 1) { hit = true; join(s, o); }
      }
      if (!hit && s.k !== "cds" && !(s.gen === "estate")) deadEnds.push({ at: [Math.round(ex), Math.round(ez)], gen: s.gen, place: s.place, cls: CLS[s.c], w: s.w });
    }
    if (s.c === 0 || s.el) continue;
    for (const o of near((s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2)) if (o !== s && o.c !== 0 && !o.el && segCross(s, o)) join(s, o);
  }
  for (const ix of D.ix) for (const o of near(ix[0], ix[1])) if (pdist(ix[0], ix[1], o) < 40) for (const p of near(ix[0], ix[1])) if (pdist(ix[0], ix[1], p) < 40) join(o, p);
  for (const m of D.metros) for (const ix of m.interchanges) {
    const cand = [...near(ix[0], ix[1])].filter((o) => pdist(ix[0], ix[1], o) < 60);
    for (const o of cand) join(o, cand[0]);
  }
  const compLen = new Map();
  for (const s of net) { const r = find(s); const L = Math.hypot(s.x1 - s.x0, s.z1 - s.z0); const e = compLen.get(r) || { len: 0, gens: {}, at: [s.x0, s.z0] }; e.len += L; e.gens[s.gen + (s.place && s.gen !== "highway" ? ":" + s.place : "")] = 1; compLen.set(r, e); }
  const netComps = [...compLen.values()].sort((a, b) => b.len - a.len);
  const mainLen = netComps[0] ? netComps[0].len : 0;
  const islandsNet = netComps.slice(1).filter((c) => c.len > 150).map((c) => ({ km: r2(c.len / 1000), at: [Math.round(c.at[0]), Math.round(c.at[1])], gens: Object.keys(c.gens).slice(0, 6) }));
  const deadBy = {}; for (const d of deadEnds) { const k = d.gen + "/" + d.cls; deadBy[k] = (deadBy[k] || 0) + 1; }

  // highways: access points (interchanges, docks, at-grade T's) per route
  const hwAccess = D.hw.map((h) => {
    const pts = [];
    const hs = allSegs.filter((s) => s.hw === h.id);
    for (const s of net) {
      if (s.c === 0) continue;
      for (const [ex, ez] of [[s.x0, s.z0], [s.x1, s.z1]]) for (const q of hs) if (pdist(ex, ez, q) <= q.w / 2 + 8) pts.push([ex, ez]);
    }
    for (const m of D.metros) for (const ix of m.interchanges) for (const q of hs) if (pdist(ix[0], ix[1], q) < 40) pts.push([ix[0], ix[1]]);
    for (const ix of D.ix) for (const q of hs) if (pdist(ix[0], ix[1], q) < 40) pts.push([ix[0], ix[1]]);
    let len = 0; for (const s of hs) len += Math.hypot(s.x1 - s.x0, s.z1 - s.z0);
    const uniq = dedupe(pts, 120);
    // urban metres and the longest urban run between access points
    let urban = 0, run = 0, longest = 0, homeFront = 0;
    for (const s of hs) {
      const L = Math.hypot(s.x1 - s.x0, s.z1 - s.z0), n = Math.ceil(L / 20);
      for (let t = 0; t < n; t++) {
        const x = s.x0 + (s.x1 - s.x0) * (t + 0.5) / n, z = s.z0 + (s.z1 - s.z0) * (t + 0.5) / n, k = idx(ci(x), cj(z));
        const isU = k >= 0 && env[k];
        if (isU) { urban += L / n; run += L / n; } else run = 0;
        if (uniq.some((p) => Math.hypot(p[0] - x, p[1] - z) < 60)) run = 0;
        if (run > longest) longest = run;
      }
    }
    return { id: h.id, name: h.name, km: r2(len / 1000), access: uniq.length, kmPerAccess: r2(len / 1000 / Math.max(1, uniq.length)), urbanKm: r2(urban / 1000), longestUrbanRunKm: r2(longest / 1000) };
  });

  // streets with nothing on them (urban, non-rural, non-highway)
  const bh = new Map(); const BH = 50;
  for (const b of D.bldgs) { const key = Math.floor(b[0] / BH) + "," + Math.floor(b[1] / BH); if (!bh.has(key)) bh.set(key, []); bh.get(key).push(b); }
  const fronted = (x, z, reach) => {
    const a = Math.floor(x / BH), c = Math.floor(z / BH);
    for (let u = a - 1; u <= a + 1; u++) for (let v = c - 1; v <= c + 1; v++) for (const b of bh.get(u + "," + v) || []) {
      const e = Math.max(b[2], b[3]) / 2; if (Math.abs(b[0] - x) - e < reach && Math.abs(b[1] - z) - e < reach) return true;
    }
    for (const [ox, oz] of D.other) if (Math.abs(ox - x) < reach + 12 && Math.abs(oz - z) < reach + 12) return true;
    return false;
  };
  const otherHash = new Map();
  for (const o of D.other) { const key = Math.floor(o[0] / BH) + "," + Math.floor(o[1] / BH); if (!otherHash.has(key)) otherHash.set(key, []); otherHash.get(key).push(o); }
  const fronted2 = (x, z, reach) => {
    const a = Math.floor(x / BH), c = Math.floor(z / BH);
    for (let u = a - 1; u <= a + 1; u++) for (let v = c - 1; v <= c + 1; v++) {
      for (const b of bh.get(u + "," + v) || []) { const e = Math.max(b[2], b[3]) / 2; if (Math.abs(b[0] - x) - e < reach && Math.abs(b[1] - z) - e < reach) return true; }
      for (const o of otherHash.get(u + "," + v) || []) if (Math.abs(o[0] - x) < reach + 12 && Math.abs(o[1] - z) < reach + 12) return true;
    }
    return false;
  };
  void fronted;
  const emptyStreet = {}; let emptyTot = 0, streetTot = 0;
  for (const s of net) {
    if (s.c === 0 || s.c === 3 || s.el) continue;
    const L = Math.hypot(s.x1 - s.x0, s.z1 - s.z0), n = Math.max(1, Math.ceil(L / 25));
    for (let t = 0; t < n; t++) {
      const x = s.x0 + (s.x1 - s.x0) * (t + 0.5) / n, z = s.z0 + (s.z1 - s.z0) * (t + 0.5) / n, k = idx(ci(x), cj(z));
      if (k < 0 || !env[k] || isWater(k) || park[k] >= 0.3) continue;
      if (special[k] && !special[k].startsWith("biome:")) continue;
      streetTot += L / n;
      if (!fronted2(x, z, s.w / 2 + 40)) { const key = s.gen + "/" + CLS[s.c]; emptyStreet[key] = (emptyStreet[key] || 0) + L / n; emptyTot += L / n; }
    }
  }

  // ===== SEAMS: generator places side by side
  const places = {};
  for (const b of D.bldgs) {
    const key = b[8] === "metro" || b[8] === "towngen" ? b[8] + ":" + b[9] : b[8];
    const p = places[key] || (places[key] = { minX: 1e9, maxX: -1e9, minZ: 1e9, maxZ: -1e9, n: 0, st: [] });
    p.minX = Math.min(p.minX, b[0]); p.maxX = Math.max(p.maxX, b[0]); p.minZ = Math.min(p.minZ, b[1]); p.maxZ = Math.max(p.maxZ, b[1]); p.n++; p.st.push(b[6] || 1);
  }
  const seams = [];
  const keys = Object.keys(places);
  for (let a = 0; a < keys.length; a++) for (let b = a + 1; b < keys.length; b++) {
    const P = places[keys[a]], Q = places[keys[b]];
    const gx = Math.max(P.minX, Q.minX) - Math.min(P.maxX, Q.maxX), gz = Math.max(P.minZ, Q.minZ) - Math.min(P.maxZ, Q.maxZ);
    const gap = Math.max(0, gx, gz);
    if (gap > 700) continue;
    // cells on the shared border: built by both / empty between
    let both = 0;
    for (let k = 0; k < N; k++) if (genArea[k] && genArea[k][keys[a]] && genArea[k][keys[b]]) both++;
    seams.push({ a: keys[a], b: keys[b], gapM: Math.round(gap), sharedCells: both, medSt: [median(P.st), median(Q.st)] });
  }
  // scale jumps across a generator border (adjacent cells, different generator)
  const scaleJumps = [];
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const k = idx(i, j); if (!gen[k] || cov[k] < 0.02) continue;
    for (const [di, dj] of [[1, 0], [0, 1]]) {
      const q = idx(i + di, j + dj); if (q < 0 || !gen[q] || cov[q] < 0.02 || gen[q] === gen[k]) continue;
      const ha = hsum[k] / (cov[k] * A), hb = hsum[q] / (cov[q] * A);
      if (Math.max(ha, hb) / Math.max(3, Math.min(ha, hb)) >= 4) scaleJumps.push({ at: [cx(i), cz(j)], a: gen[k], b: gen[q], h: [Math.round(ha), Math.round(hb)] });
    }
  }

  // ===== MISMATCHED USES
  const hwSegs = allSegs.filter((s) => s.hw);
  const homesOnFreeway = [], buildingsInLanes = [];
  for (const b of D.bldgs) {
    const u = useOf(b);
    const e = Math.max(b[2], b[3]) / 2;
    for (const s of hwSegs) {
      const d = pdist(b[0], b[1], s) - e;
      if (d < s.w / 2 + 1) { buildingsInLanes.push({ at: [b[0], b[1]], type: b[7], gen: b[8], place: b[9], hw: s.place }); break; }
      if ((u === "rowhouse" || u === "suburb" || u === "exurb") && d < s.w / 2 + 25) { homesOnFreeway.push({ at: [b[0], b[1]], type: b[7], gen: b[8], place: b[9], hw: s.place, m: Math.round(d - s.w / 2) }); break; }
    }
  }
  // the zoning field's two laws, judged on the built world
  const CORE_OF = { cityborough: "downtown", citynorth: "downtown", "goldspire-ring": "goldspire", "capeharbor-ring": "capeharbor", "neonreef-ring": "neonreef" };
  let overCeiling = 0, inBuffer = 0; const overSample = [];
  if (zone) for (const b of D.bldgs) {
    const key = b[8] === "metro" && CORE_OF[b[9]];
    if (key) { const cap = zone.ceilingAt(b[0], b[1], key); if ((b[6] || 1) > cap) { overCeiling++; if (overSample.length < 8) overSample.push({ at: [b[0], b[1]], st: b[6], cap, place: b[9] }); } }
    if ((b[7] === "house" || b[7] === "row" || b[7] === "apt") && zone.inBuffer(b[0], b[1], Math.max(b[2], b[3]) / 2)) inBuffer++;
  }
  const estates = D.regions.filter((r) => !r[1] && r[0] && !/approach|causeway|bridge|link/i.test(r[0]));
  const estateVsIndustry = [];
  for (const r of estates) {
    let n = 0, dmin = Infinity;
    for (const b of D.bldgs) {
      if (useOf(b) !== "industrial") continue;
      const dx = Math.max(r[2] - b[0], 0, b[0] - r[3]), dz = Math.max(r[4] - b[1], 0, b[1] - r[5]);
      const d = Math.hypot(dx, dz); if (d < 250) { n++; dmin = Math.min(dmin, d); }
    }
    if (n) estateVsIndustry.push({ estate: r[0], industrialWithin250: n, nearestM: Math.round(dmin) });
  }
  const towerByField = [];
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const k = idx(i, j); if (hmax[k] < 60) continue;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const q = idx(i + di, j + dj); if (q < 0) continue;
      if (use[q] === "rural" || use[q] === "exurb" || (use[q] === "open" && !env[q])) { towerByField.push({ at: [cx(i), cz(j)], h: Math.round(hmax[k]), next: use[q] }); break; }
    }
  }

  // ===== ZONING vs BUILT (when the field exists)
  let zoningFit = null;
  if (zone) {
    const Z = zone; let n = 0, off = 0, under = 0, over = 0;
    const underM = new Uint8Array(N);
    for (let k = 0; k < N; k++) {
      if (isWater(k) || park[k] >= 0.3 || (special[k] && !special[k].startsWith("biome:"))) continue;
      const zi = ((cx(k % NX) - Z.x0) / Z.cell) | 0, zj = ((cz((k / NX) | 0) - Z.z0) / Z.cell) | 0;
      if (zi < 0 || zj < 0 || zi >= Z.nx || zj >= Z.nz) continue;
      const zu = Z.use[zj * Z.nx + zi];
      if (zu === "protected" || zu === "verge") continue;
      const t = Z.grid[zj * Z.nx + zi] / 100;      // intended intensity 0..1
      if (t < 0.15 && far[k] < 0.05) continue;
      n++;
      const want = intensityFar(t);
      // under-built = the field wants a town and NOTHING stands there (a
      // built district lighter than the ladder, e.g. Kingsport's Detroit
      // neighbourhoods of houses, is a style, not a gap)
      if (want > 0.15 && cov[k] < 0.01 && other[k] < 0.12) { under++; underM[k] = 1; }
      else if (far[k] > want * 4 + 0.3) over++;
      else continue;
      off++;
    }
    const gaps = components(underM, NX, NZ).filter((c) => c.cells.length >= 4).map((c) => ({ ha: c.cells.length, at: centroid(c.cells) })).sort((a, b) => b.ha - a.ha).slice(0, 12);
    zoningFit = { cells: n, offIntent: off, underBuilt: under, overBuilt: over, gaps };
  }

  // ===== totals
  let landCells = 0, builtLand = 0, envCells = 0, deadCells = 0, ruralBuilt = 0, ruralLand = 0;
  for (let k = 0; k < N; k++) {
    if (isWater(k)) continue; landCells++;
    if (built[k]) builtLand++;
    if (env[k]) envCells++;
    if (dead[k]) deadCells++;
    if (!env[k]) { ruralLand++; if (cov[k] > 0.002 || other[k] > 0) ruralBuilt++; }
  }
  const byGen = {}; for (const b of D.bldgs) { const k = b[8]; const e = byGen[k] || (byGen[k] = { n: 0, floorHa: 0 }); e.n++; e.floorHa += b[2] * b[3] * (b[6] || 1) / 1e4; }
  for (const k in byGen) byGen[k].floorHa = r2(byGen[k].floorHa);
  const roadKm = {}; CLS.forEach((c, n) => { let s = 0; for (let k = 0; k < N; k++) s += road[n][k]; roadKm[c] = r2(s / 1000); });

  const laws = [];
  if (homesOnFreeway.length) laws.push(`${homesOnFreeway.length} homes within 25 m of a freeway's edge`);
  if (buildingsInLanes.length) laws.push(`${buildingsInLanes.length} buildings in a freeway's lanes`);

  return {
    seed: D.seed, grid: { x0: G.x0, z0: G.z0, cell: C, nx: NX, nz: NZ },
    totals: { buildings: D.bldgs.length, byGen, roadKm, landHa: landCells, builtLandHa: builtLand, urbanEnvelopeHa: envCells,
      deadZoneHa: deadCells, deadShareOfUrban: r2(deadCells / Math.max(1, envCells)), ruralLandHa: ruralLand, ruralWithAnyBuildingHa: ruralBuilt, landN },
    density: { deadZones: deadComps.slice(0, 25), deadZoneCount: deadComps.length, cliffs: cliffs.length, cliffSample: cliffs.slice(0, 15), islands: islands.slice(0, 20), islandCount: islands.length, gradients },
    roads: { deadEnds: deadEnds.length, deadBy, deadSample: deadEnds.filter((d) => d.cls !== "local" || d.gen !== "metro").slice(0, 30), components: netComps.length, mainKm: r2(mainLen / 1000), disconnected: islandsNet, highways: hwAccess,
      emptyStreetKm: r2(emptyTot / 1000), urbanStreetKm: r2(streetTot / 1000), emptyStreetBy: Object.fromEntries(Object.entries(emptyStreet).map(([k, v]) => [k, r2(v / 1000)])) },
    seams: { pairs: seams.sort((a, b) => a.gapM - b.gapM).slice(0, 30), scaleJumps: scaleJumps.length, scaleSample: scaleJumps.slice(0, 12) },
    uses: { overCeiling, overSample, homesInZoningBuffer: inBuffer, homesOnFreeway: homesOnFreeway.length, homesOnFreewaySample: homesOnFreeway.slice(0, 15), buildingsInLanes: buildingsInLanes.length, buildingsInLanesSample: buildingsInLanes.slice(0, 10), estateVsIndustry, towerByField: towerByField.length, towerByFieldSample: towerByField.slice(0, 8) },
    zoningFit, laws,
    maps: { far: Array.from(far, (v) => r2(v)), cov: Array.from(cov, (v) => Math.round(v * 1000) / 1000), water: Array.from(water), use, gen, built: Array.from(built), env: Array.from(env), dead: Array.from(dead),
      roadHw: Array.from(road[0], Math.round), roadArt: Array.from(road[1], Math.round), roadLoc: Array.from(road[2], Math.round), hmax: Array.from(hmax, Math.round), other: Array.from(other, (v) => r2(v)) },
  };

  function nearGen(cells) {
    const tally = {};
    for (const k of cells) for (const [di, dj] of [[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2], [3, 3], [-3, -3], [3, -3], [-3, 3]]) {
      const q = idx((k % NX) + di, ((k / NX) | 0) + dj); if (q >= 0 && gen[q]) tally[gen[q]] = (tally[gen[q]] || 0) + 1;
    }
    return argmax(tally) || "";
  }
  function centroid(cells) { let x = 0, z = 0; for (const k of cells) { x += cx(k % NX); z += cz((k / NX) | 0); } return [Math.round(x / cells.length), Math.round(z / cells.length)]; }
}

function coreOf(m) { let best = null; for (const c of m.cells) if (!best || c[5] > best[5]) best = c; return best ? { x: (best[0] + best[2]) / 2, z: (best[1] + best[3]) / 2 } : { x: m.cx, z: m.cz }; }
// the FAR a zoning intensity asks for (city/zoning.js INTENSITY ladder)
function intensityFar(t) { return t >= 0.85 ? 3 : t >= 0.65 ? 1.2 : t >= 0.45 ? 0.6 : t >= 0.3 ? 0.3 : t >= 0.15 ? 0.08 : 0; }

function useOf(b) {
  const type = b[7], gen = b[8], u = b[10];
  if (gen === "downtown") return "downtown";
  if (gen === "metro") {
    if (u === "cbd") return "downtown";
    if (u === "industrial" || type === "ware" || type === "silo" || type === "tank") return "industrial";
    if (u === "farm" || type === "barn") return "rural";
    if (u === "exurb") return "exurb";
    if (type === "house") return "suburb";
    if (type === "row") return "rowhouse";
    if (type === "apt") return "midrise";
    if (type === "office" || type === "tower" || type === "mall") return u === "midtown" ? "midrise" : "commercial";
    if (type === "civic" || type === "clocktower" || type === "pavilion" || type === "stadium") return "civic";
    return u || "midrise";
  }
  if (gen === "annex") return "commercial";
  if (gen === "towngen") return u === "residential" ? (type === "home" ? "suburb" : "midrise") : u === "civic" ? "civic" : "commercial";
  return "other";
}

// ============================================================ helpers
function argmax(o) { let b = null, v = -Infinity; for (const k in o) if (o[k] > v) { v = o[k]; b = k; } return b; }
function r2(v) { return Math.round(v * 100) / 100; }
function median(a) { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1] || 0; }
function pdist(px, pz, s) {
  const dx = s.x1 - s.x0, dz = s.z1 - s.z0, L2 = dx * dx + dz * dz;
  let t = L2 > 0 ? ((px - s.x0) * dx + (pz - s.z0) * dz) / L2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (s.x0 + dx * t), pz - (s.z0 + dz * t));
}
function segCross(a, b) {
  const o = (ax, az, bx, bz, cx, cz) => Math.sign((bx - ax) * (cz - az) - (bz - az) * (cx - ax));
  return o(a.x0, a.z0, a.x1, a.z1, b.x0, b.z0) !== o(a.x0, a.z0, a.x1, a.z1, b.x1, b.z1) &&
    o(b.x0, b.z0, b.x1, b.z1, a.x0, a.z0) !== o(b.x0, b.z0, b.x1, b.z1, a.x1, a.z1);
}
function dedupe(pts, r) { const out = []; for (const p of pts) if (!out.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < r)) out.push(p); return out; }
function morph(m, NX, NZ, R, grow) {
  const out = new Uint8Array(m.length);
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    let v = grow ? 0 : 1;
    for (let dj = -R; dj <= R && (grow ? !v : v); dj++) for (let di = -R; di <= R; di++) {
      if (di * di + dj * dj > R * R + R) continue;
      const a = i + di, b = j + dj;
      const s = (a < 0 || b < 0 || a >= NX || b >= NZ) ? 0 : m[b * NX + a];
      if (grow && s) { v = 1; break; }
      if (!grow && !s) { v = 0; break; }
    }
    out[j * NX + i] = v;
  }
  return out;
}
function components(m, NX, NZ, diag) {
  const seen = new Uint8Array(m.length), out = [];
  const nb = diag ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] : [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let k = 0; k < m.length; k++) {
    if (!m[k] || seen[k]) continue;
    const cells = [], st = [k]; seen[k] = 1;
    while (st.length) {
      const c = st.pop(); cells.push(c);
      const i = c % NX, j = (c / NX) | 0;
      for (const [di, dj] of nb) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= NX || b >= NZ) continue; const q = b * NX + a; if (m[q] && !seen[q]) { seen[q] = 1; st.push(q); } }
    }
    out.push({ cells });
  }
  return out;
}

// ============================================================ report
function heat(res, x0, z0, x1, z1, agg) {
  const { grid: G, maps: M } = res;
  const C = G.cell * agg, lines = [];
  const glyph = (f, w, built, dead, env) => {
    if (w >= 0.6) return " ";
    if (dead) return "x";
    if (f <= 0.004) return built ? "," : (env ? "_" : ".");
    return f < 0.05 ? "-" : f < 0.15 ? ":" : f < 0.35 ? "=" : f < 0.7 ? "+" : f < 1.2 ? "*" : f < 2.5 ? "#" : "@";
  };
  for (let z = z0; z < z1; z += C) {
    let row = "";
    for (let x = x0; x < x1; x += C) {
      let f = 0, w = 0, n = 0, b = 0, d = 0, e = 0;
      for (let a = 0; a < agg; a++) for (let c = 0; c < agg; c++) {
        const i = Math.floor((x - G.x0) / G.cell) + a, j = Math.floor((z - G.z0) / G.cell) + c;
        if (i < 0 || j < 0 || i >= G.nx || j >= G.nz) continue;
        const k = j * G.nx + i; f += M.far[k]; w += M.water[k]; n++; b += M.built[k]; d += M.dead[k]; e += M.env[k];
      }
      row += n ? glyph(f / n, w / n, b > 0, d > n / 2, e > n / 2) : " ";
    }
    lines.push(row);
  }
  return lines;
}
function print(res) {
  const T = res.totals, L = [];
  L.push(`LAYOUT AUDIT seed ${res.seed} — ${T.buildings} buildings`);
  L.push(`  by generator   ${Object.entries(T.byGen).map(([k, v]) => `${k} ${v.n} (${v.floorHa} ha floor)`).join(" · ")}`);
  L.push(`  road km        ${Object.entries(T.roadKm).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  L.push(`  land ${T.landHa} ha · built ${T.builtLandHa} ha · urban envelope ${T.urbanEnvelopeHa} ha · DEAD ZONES ${T.deadZoneHa} ha (${Math.round(T.deadShareOfUrban * 100)}% of urban) · rural land with any building ${T.ruralWithAnyBuildingHa}/${T.ruralLandHa} ha`);
  const Dn = res.density;
  L.push(`DENSITY  dead zones ${Dn.deadZoneCount} · cliffs (FAR>=1 beside empty land) ${Dn.cliffs} · sprawl islands ${Dn.islandCount}`);
  for (const d of Dn.deadZones.slice(0, 12)) L.push(`   dead ${String(d.ha).padStart(4)} ha at ${d.at.join(",")} (${d.near})`);
  for (const c of Dn.cliffSample.slice(0, 6)) L.push(`   cliff at ${c.at.join(",")} FAR ${c.far} h ${c.h} m (${c.gen}) -> ${c.to}`);
  for (const s of Dn.islands.slice(0, 10)) L.push(`   island ${s.ha} ha at ${s.at.join(",")} ${s.gen} floor ${s.floorM2} m2, ${s.nearestTownM} m from the nearest town`);
  L.push(`  gradients (mean FAR per 250 m ring, % empty; breaks = rings denser than the one inside)`);
  for (const g of Dn.gradients) L.push(`   ${g.name.padEnd(22)} ${g.rings.map((r) => r ? `${r.far.toFixed(2)}/${String(r.empty).padStart(2)}` : "   -   ").join(" ")}  breaks ${g.breaks}`);
  const R = res.roads;
  L.push(`ROADS    dead ends ${R.deadEnds} ${JSON.stringify(R.deadBy)} · networks ${R.components} (main ${R.mainKm} km)`);
  for (const c of R.disconnected.slice(0, 10)) L.push(`   cut off ${c.km} km at ${c.at.join(",")} ${c.gens.join(" ")}`);
  for (const d of R.deadSample.slice(0, 12)) L.push(`   stub ${d.cls} ${d.gen}:${d.place} at ${d.at.join(",")}`);
  for (const h of R.highways) L.push(`   ${h.name.padEnd(20)} ${h.km} km · ${h.access} access points (${h.kmPerAccess} km each) · urban ${h.urbanKm} km · longest urban run with no access ${h.longestUrbanRunKm} km`);
  L.push(`   urban streets ${R.urbanStreetKm} km, ${R.emptyStreetKm} km with nothing on them ${JSON.stringify(R.emptyStreetBy)}`);
  const S = res.seams;
  L.push(`SEAMS    generator pairs within 700 m: ${S.pairs.length} · scale jumps across a border ${S.scaleJumps}`);
  for (const p of S.pairs.slice(0, 14)) L.push(`   ${p.a} | ${p.b}  gap ${p.gapM} m · shared cells ${p.sharedCells} · median storeys ${p.medSt.join(" vs ")}`);
  const U = res.uses;
  L.push(`USES     homes within 25 m of a freeway ${U.homesOnFreeway} · buildings in freeway lanes ${U.buildingsInLanes} · towers (>=60 m) beside fields ${U.towerByField}`);
  L.push(`         grown districts taller than their core allows ${U.overCeiling} · homes inside the 30 m freeway buffer ${U.homesInZoningBuffer}`);
  for (const o of U.overSample.slice(0, 4)) L.push(`   ${o.place} at ${o.at.join(",")} ${o.st} storeys, ceiling ${o.cap}`);
  for (const h of U.homesOnFreewaySample.slice(0, 8)) L.push(`   ${h.type} ${h.gen}:${h.place} at ${h.at.join(",")} ${h.m} m off ${h.hw}`);
  for (const e of U.estateVsIndustry) L.push(`   estate ${e.estate}: ${e.industrialWithin250} industrial buildings within 250 m (nearest ${e.nearestM} m)`);
  if (res.zoningFit) {
    L.push(`ZONING   cells judged ${res.zoningFit.cells} · off intent ${res.zoningFit.offIntent} (under-built ${res.zoningFit.underBuilt}, over-built ${res.zoningFit.overBuilt})`);
    for (const g of res.zoningFit.gaps) L.push(`   the field wants town, nothing built: ${g.ha} ha at ${g.at.join(",")}`);
  }
  if (res.laws.length) L.push(`LAWS     ${res.laws.join(" · ")}`);
  L.push(`HEATMAP  whole world, 400 m cells (FAR: . open land  _ in-town empty  , roads only  x dead zone  - <.05  : <.15  = <.35  + <.7  * <1.2  # <2.5  @ >=2.5; blank = water)`);
  const G = res.grid;
  for (const l of heat(res, G.x0, G.z0, G.x0 + G.nx * G.cell, G.z0 + G.nz * G.cell, 4)) L.push("   |" + l + "|");
  const zooms = [["Gang City + borough + annex", -1700, -1500, 900, 300], ["Kingsport", -5200, 900, -300, 4700]];
  const zo = opt("--zoom", ""); if (zo) { const p = zo.split(",").map(Number); zooms.push(["zoom", ...p]); }
  for (const [name, x0, z0, x1, z1] of zooms) {
    L.push(`HEATMAP  ${name}, ${x1 - x0 > 3000 ? 200 : 100} m cells x ${x0}..${x1} z ${z0}..${z1}`);
    for (const l of heat(res, x0, z0, x1, z1, x1 - x0 > 3000 ? 2 : 1)) L.push("   |" + l + "|");
  }
  console.log(L.join("\n"));
  return L.join("\n");
}
