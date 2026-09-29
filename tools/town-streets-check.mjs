#!/usr/bin/env node
/* tools/town-streets-check.mjs — DO TOWNS GET REAL STREETS?

   OWNER (respawned in a small town as president): "our road system and city
   building code don't generalize." Towns were flat sheets of recipe colour
   with the mainland's kerb pieces floating on them. Every town is now laid by
   city/streetkit.js, the downtown's own kit. This check grows every recipe in
   citytemplates.js / villagekit.js, every country settlement in countries.js,
   Dry Gulch, the studio downtown and a few odd shapes (odd-row main street,
   one-row strip, 5x4 organic), headless in plain node on the vendored r128,
   and asserts on the layout data:

     1. every street centreline is carriageway end to end
     2. every lot stands on a lot pad (never on footway or road)
     3. every door steps out onto the footway
     4. no street record crosses a lot
     5. every paint vertex (lanes, crosswalks, stop bars) is on carriageway
     6. every block has a continuous kerb + footway along all four faces
     7. the road surface covers exactly the streets (no void, no hole)
     8. the town keeps the footprint its placer reserved
     9. rural villages get dirt lanes: no kerb, no paint
    10. the road records carry the drawn cross-section

   No browser, no captures. Usage: node tools/town-streets-check.mjs
   Exit 0 = every town ok.                                                  */
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function makeEnv() {
  const ctx2d = new Proxy({}, { get: (t, k) => (k === "createLinearGradient" || k === "createRadialGradient") ? () => ({ addColorStop() {} }) : (typeof k === "string" ? (t[k] !== undefined ? t[k] : () => {}) : undefined), set: (t, k, v) => { t[k] = v; return true; } });
  const document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d, style: {} }),
    getElementById: () => null, body: { appendChild() {} }, head: { appendChild() {} },
    addEventListener() {},
  };
  const win = { document, console, Math, Date, setTimeout, clearTimeout, performance: { now: () => Date.now() }, navigator: { userAgent: "node" }, addEventListener() {}, innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 };
  win.window = win; win.self = win;
  win.CBZ = { CONFIG: {} };
  const context = vm.createContext(win);
  function load(rel) { vm.runInContext(fs.readFileSync(path.join(ROOT, rel), "utf8"), context, { filename: rel }); }
  load("src/vendor/three.r128.min.js");
  load("src/vendor/BufferGeometryUtils.js");
  return { win, load, context, CBZ: win.CBZ, THREE: win.THREE };
}

const env = makeEnv();
const CBZ = env.CBZ, THREE = env.THREE;
CBZ.colliders = []; CBZ.onUpdate = () => {}; CBZ.onAlways = () => {};
CBZ.hash01 = (x, z, s) => { let h = (Math.round(x * 16) * 374761393 + Math.round(z * 16) * 668265263 + s * 2246822519) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
CBZ.assets = { define() {}, has() { return false; }, get() { return null; } };
CBZ.cmat = (c) => new THREE.MeshLambertMaterial({ color: c });
CBZ.cityMakeBuilding = (root, x, z, w, d, storeys) => ({ w, d, ox: x, oz: z, storeys, FH: 3.2, lbox() { return null; } });
env.load("src/city/streetkit.js");
env.load("src/city/cityground.js");
env.load("src/city/citytemplates.js");
env.load("src/city/villagekit.js");
env.load("src/city/settlements.js");
env.load("src/city/roadrules.js");
env.load("src/city/towngen.js");
// countries data
CBZ.addLandmass = () => {};
env.load("src/city/countries.js");

function lcg(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }

const towns = [];
const T = CBZ.CITY_TEMPLATES;
for (const id of Object.keys(T)) towns.push({ label: "template:" + id, cfg: Object.assign({}, T[id]) });
// country settlements (wealth-scaled, their own cols/rows/road widths)
for (const cd of CBZ.COUNTRIES || []) for (const s of cd.settlements || []) {
  const base = CBZ.cityTemplate(s.baseTemplate);
  if (!base) continue;
  towns.push({ label: "country:" + cd.id + "/" + s.id, cfg: Object.assign({}, base, { cols: s.cols, rows: s.rows, blockW: s.blockW, blockD: s.blockD, roadW: s.roadW, name: s.name }) });
}
// odd shapes: odd-row mainstreet, 1-row, wide organic
towns.push({ label: "odd:mainstreet5x3", cfg: Object.assign({}, T.harvestmarket, { cols: 5, rows: 3 }) });
towns.push({ label: "odd:mainstreet2x1", cfg: Object.assign({}, T.pinecrest, { cols: 2, rows: 1 }) });
towns.push({ label: "odd:organic5x4", cfg: Object.assign({}, T.foundry, { cols: 5, rows: 4, roadW: 11 }) });
towns.push({ label: "desert:drygulch", cfg: { cols: 3, rows: 2, blockW: 64, blockD: 50, roadW: 12, pattern: "mainstreet", density: 0.5, name: "Dry Gulch", district: "desert", minFrontage: 16, minLotArea: 240, squarePrefab: "well" } });
towns.push({ label: "studio:downtown6x6", cfg: { cols: 6, rows: 6, blockW: 42, blockD: 42, roadW: 14, pattern: "grid", density: 0.95, name: "Talloran" } });

let fails = 0;
function fail(t, msg) { fails++; console.log("  FAIL", t, msg); }
let seedN = 0;
for (const t of towns) {
  seedN++;
  const root = new THREE.Group();
  const A = { roads: [], lots: [], shopLots: [], homeLots: [] };
  CBZ.streetKit.reset();
  const cx = 1000 * seedN, cz = -500 * seedN;
  const t0 = Date.now();
  const town = CBZ.buildTown(root, Object.assign({}, t.cfg, { cx, cz, rng: lcg(seedN * 7919 + 13), arena: A, district: t.cfg.id || "town" }));
  if (!town) { fail(t.label, "no town"); continue; }
  const ms = Date.now() - t0;
  { const c = t.cfg, R0 = town.rect, ROADW = c.roadW || 12, hxw = (c.cols || 3) * ((c.blockW || 36) + ROADW) / 2 + ROADW / 2, hzw = (c.rows || 3) * ((c.blockD || 36) + ROADW) / 2 + ROADW / 2;
    if (c.pattern !== "organic" && ((c.rows || 3) > 1 || c.pattern !== "mainstreet") && (Math.abs((R0.maxX - R0.minX) / 2 - hxw) > 0.01 || Math.abs((R0.maxZ - R0.minZ) / 2 - hzw) > 0.01)) fail(t.label, "footprint changed " + JSON.stringify(R0) + " vs half " + hxw + "," + hzw);
    if (ms > 1500) fail(t.label, "slow build " + ms + " ms"); }
  const surf = CBZ.streetKit.surfaces[0];
  const rural = t.cfg.streetStyle === "rural";
  const H = (x, z) => CBZ.streetKit.heightAt(x, z), RG = (x, z) => CBZ.streetKit.regionAt(x, z);
  const roads = town.roads;
  let bad = { centre: 0, lotOnStreet: 0, doorOff: 0, roadThroughLot: 0, paintOff: 0, footGap: 0 };
  if (!rural) {
    if (!surf) { fail(t.label, "no street surface registered"); continue; }
    const G = surf.solve;
    // 1) every street centreline is carriageway, end to end
    for (const r of roads) for (let k = 0; k <= 60; k++) {
      const u = -r.len / 2 + 0.5 + (r.len - 1) * k / 60;
      const x = r.vertical ? r.x : r.x + u, z = r.vertical ? r.z + u : r.z;
      if (RG(x, z) !== 0) bad.centre++;
    }
    // 2) every lot lies on a lot pad (never on footway or road)
    for (const L of town.lots) {
      const hw = L.w / 2, hd = L.d / 2;
      for (const [ax, az] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]]) if (RG(L.cx + ax * hw * 0.98, L.cz + az * hd * 0.98) !== 2) bad.lotOnStreet++;
      // 3) the door steps out onto the footway
      const dp = L.building.door;
      if (RG(dp.x, dp.z) !== 1) bad.doorOff++;
    }
    // 4) no street record crosses a block
    for (const r of roads) {
      const rx0 = r.vertical ? r.x - r.w / 2 : r.x - r.len / 2, rx1 = r.vertical ? r.x + r.w / 2 : r.x + r.len / 2;
      const rz0 = r.vertical ? r.z - r.len / 2 : r.z - r.w / 2, rz1 = r.vertical ? r.z + r.len / 2 : r.z + r.w / 2;
      for (const L of town.lots) {
        const ox = Math.min(rx1, L.cx + L.w / 2) - Math.max(rx0, L.cx - L.w / 2), oz = Math.min(rz1, L.cz + L.d / 2) - Math.max(rz0, L.cz - L.d / 2);
        if (ox > 0.01 && oz > 0.01) bad.roadThroughLot++;
      }
    }
    // 5) paint only on carriageway
    let paintV = 0;
    root.traverse((o) => {
      if (!o.isMesh || !/paint/.test(o.name)) return;
      const p = o.geometry.attributes.position.array;
      for (let i = 0; i < p.length; i += 3) { paintV++; if (RG(p[i], p[i + 2]) !== 0) bad.paintOff++; }
    });
    // 6) a continuous kerb + footway round every block: walk each block face
    //    at mid-footway depth, clear of the corner arcs
    for (let bi = 0; bi < G.NX; bi++) for (let bj = 0; bj < G.NZ; bj++) {
      const B = G.blockRect(bi, bj), mid = G.FW / 2;
      for (let k = 0; k <= 40; k++) {
        const fx = B.minX + G.R + (B.maxX - B.minX - 2 * G.R) * k / 40, fz = B.minZ + G.R + (B.maxZ - B.minZ - 2 * G.R) * k / 40;
        for (const [x, z] of [[fx, B.minZ + mid], [fx, B.maxZ - mid], [B.minX + mid, fz], [B.maxX - mid, fz]]) if (RG(x, z) !== 1) bad.footGap++;
      }
    }
    const cw = G.cornerDrops.size;
    const st = town.stats || null;
    // crosswalks only at interior junctions: count legs
    let legs = 0;
    for (let i = 0; i <= G.NX; i++) for (let j = 0; j <= G.NZ; j++) for (const s of [-1, 1]) { if (G.cwA(i, j, s)) legs++; if (G.cwB(i, j, s)) legs++; }
    // every paint quad + ground check: the lot ground mesh exists
    let groundMesh = null, surfaceMesh = null;
    root.traverse((o) => { if (o.name === "town-lot-ground") groundMesh = o; if (o.name === "town-street-surface") surfaceMesh = o; });
    if (!groundMesh) fail(t.label, "no lot ground mesh");
    // the carriageway area is the streets, not the town: surface area vs streets
    let area = 0; const g = surfaceMesh.geometry, p = g.attributes.position.array, ix = g.index.array;
    for (let q = 0; q < ix.length; q += 3) { const a = ix[q] * 3, b = ix[q + 1] * 3, c = ix[q + 2] * 3; area += Math.abs((p[b] - p[a]) * (p[c + 2] - p[a + 2]) - (p[c] - p[a]) * (p[b + 2] - p[a + 2])) / 2; }
    const R = town.rect, total = (R.maxX - R.minX) * (R.maxZ - R.minZ);
    let blocks = 0; for (let bi = 0; bi < G.NX; bi++) for (let bj = 0; bj < G.NZ; bj++) { const B = G.blockRect(bi, bj); blocks += (B.maxX - B.minX) * (B.maxZ - B.minZ) - (4 - Math.PI) * G.R * G.R; }
    const expected = total - blocks;          // streets + corner fillets
    const skirtArea = 2 * ((R.maxX - R.minX) + (R.maxZ - R.minZ)) * G.skirt + 4 * G.skirt * G.skirt;
    const ratio = (area - skirtArea) / expected;
    if (Math.abs(ratio - 1) > 0.01) fail(t.label, "road surface area " + area.toFixed(0) + " vs streets " + expected.toFixed(0) + " (ratio " + ratio.toFixed(3) + ")");
    for (const k in bad) if (bad[k]) fail(t.label, k + " = " + bad[k]);
    console.log((Object.values(bad).some(Boolean) ? "BAD " : "ok  ") + t.label.padEnd(34) + " grid " + G.NX + "x" + G.NZ +
      " widths x[" + G.hx.map((v) => v * 2).join(",") + "] z[" + G.hz.map((v) => v * 2).join(",") + "] R " + G.R.toFixed(2) +
      " lots " + town.lots.length + " crosswalk legs " + legs + " paintVerts " + paintV + " roadArea/streets " + ratio.toFixed(4) + " " + ms + "ms");
  } else {
    // rural: dirt lanes, no kit, no paint, no kerb
    let paint = 0, kerb = 0;
    root.traverse((o) => { if (o.isMesh && /paint|kerb|footway/.test(o.name)) paint++; if (o.userData && o.userData.roadPaint) kerb++; });
    if (surf) fail(t.label, "rural town registered a kerbed street surface");
    if (paint || kerb) fail(t.label, "rural town has paint/kerb meshes " + paint + "/" + kerb);
    for (const L of town.lots) for (const r of roads) {
      const inX = r.vertical ? Math.abs(L.cx - r.x) < r.w / 2 + L.w / 2 - 0.01 : true, inZ = r.vertical ? true : Math.abs(L.cz - r.z) < r.w / 2 + L.d / 2 - 0.01;
      if (inX && inZ) bad.roadThroughLot++;
    }
    for (const k in bad) if (bad[k]) fail(t.label, k + " = " + bad[k]);
    console.log("ok  " + t.label.padEnd(34) + " RURAL dirt lanes, lots " + town.lots.length);
  }
  // road records carry the drawn cross-section
  for (const r of roads) if (!(r.kit && r.w > 0 && r.lanesPerDir >= 1 && r.laneW * r.lanesPerDir * 2 <= r.w + 1e-9)) fail(t.label, "road record cross-section " + JSON.stringify(r));
  if (A.roads.length !== roads.length) fail(t.label, "arena roads " + A.roads.length + " vs " + roads.length);
}
console.log(fails ? "FAILURES: " + fails : "ALL TOWNS OK (" + towns.length + ")");
process.exit(fails ? 1 : 0);
