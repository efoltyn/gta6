#!/usr/bin/env node
/* tools/federal-hq-check.mjs — THE BUREAU AND THE DEFENCE HQ, MEASURED IN
   PLAIN NODE. No browser, no capture.

   Same vm as tools/estate-check.mjs (vendored three r128, the REAL
   buildings.js / buildings_civic.js / stairs.js / interior_programs.js /
   govcomplex.js), then:
     1. the `agency` and `defence` rows are built on their own and measured
        exactly like the estates: FLOATERS, SUNK, GHOST solids (a standing
        piece a body walks into with no collider under it), NaN.
     2. the whole govcomplex pass runs on a stub city and every floor the
        two sites dress is read back: which program, how many boxes, and
        THE FLOOR LAW for the federal programs (nothing drawn below the
        storey's walk surface, no finish whose top rises more than 2 cm
        over it).
   USAGE  node tools/federal-hq-check.mjs      exit 1 on any failure
*/
import fs from "fs";
import vm from "vm";
const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const ctx = { console, Math, Date, JSON, Object, Array, Number, String, Set, Map, WeakMap, Float32Array, Uint16Array, Uint32Array, Int32Array, Uint8Array, Float64Array, ArrayBuffer, Symbol, Error, parseInt, parseFloat, isFinite, isNaN, Infinity, NaN, Proxy, Reflect, Promise, setTimeout, clearTimeout };
ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx; ctx.addEventListener = function () {}; ctx.removeEventListener = function () {}; ctx.performance = { now: () => Date.now() }; ctx.requestAnimationFrame = function () {};
// a headless 2D canvas: every drawing call is a no-op, image data is real
function ctx2d(c) {
  const base = {
    canvas: c,
    getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(w * h * 4).fill(128), width: w, height: h }; },
    createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; },
    measureText(t) { return { width: String(t).length * 8 }; },
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; },
    createPattern() { return {}; },
  };
  return new Proxy(base, { get(t, k) { if (k in t) return t[k]; return function () {}; }, set(t, k, v) { t[k] = v; return true; } });
}
ctx.document = {
  createElement(tag) {
    const c = { width: 300, height: 150, style: {}, getContext() { return this._c || (this._c = ctx2d(this)); }, addEventListener() {}, toDataURL() { return ""; } };
    return c;
  },
  getElementById() { return null; }, querySelector() { return null; }, body: { appendChild() {} }, addEventListener() {},
};
ctx.Uint8ClampedArray = Uint8ClampedArray;
vm.createContext(ctx);
function load(rel) { vm.runInContext(fs.readFileSync(ROOT + "/" + rel, "utf8"), ctx, { filename: rel }); }
load("src/vendor/three.r128.min.js");
const THREE = ctx.THREE;
if (!THREE) throw new Error("no THREE");
// ---- engine stubs --------------------------------------------------------
const matCache = new Map();
const CBZ = ctx.CBZ = {
  // the game's config.js BLD_EXTRAS=false pins these before the civic grammar parses
  CONFIG: { BLD_EXTRAS: false, BLD_MASONRY_V1: false, BLD_MASONRY_TEXTURE: false, BLD_WEATHERING_V1: false, BLD_ROOF_CLUTTER_V1: false, DETAIL_BUILDING_DRESS: false }, colliders: [], platforms: [], losBlockers: [], game: { mode: "city" },
  cmat(c, o) { o = o || {}; const k = c + "|" + (o.emissive || 0) + "|" + (o.ei || 0); if (!matCache.has(k)) { const m = new THREE.MeshLambertMaterial({ color: c, emissive: o.emissive || 0 }); m._shared = true; matCache.set(k, m); } return matCache.get(k); },
  boxGeom(w, h, d) { return new THREE.BoxGeometry(w, h, d); },
  hash01(x, z, s) { const v = Math.sin(x * 12.9898 + z * 78.233 + (s || 0) * 0.123) * 43758.5453; return v - Math.floor(v); },
  onUpdate() {}, onAlways() {}, _lm: [], addLandmass(fn, order) { this._lm.push({ fn, order }); },
  markCollidersDirty() {}, markPlatformsDirty() {},
};
CBZ.mat = CBZ.cmat;
load("src/systems/stairs.js");
load("src/city/buildings_civic.js");
load("src/city/buildings.js");
load("src/city/interior_programs.js");
load("src/city/govcomplex.js");

let FAIL = 0;
const defs = CBZ.govComplexDefs;
function runRow(id, cx, cz) {
  const def = defs.find((d) => d.id === id);
  const root = new THREE.Group();
  const rect = { minX: cx - def.hx, maxX: cx + def.hx, minZ: cz - def.hz, maxZ: cz + def.hz };
  const site = { id, def, rect, cx, cz, roads: [] };
  CBZ.colliders.length = 0; CBZ.platforms.length = 0;
  const out = def.build({ root, rect, cx, cz, site, city: { roads: [] } });
  root.updateMatrixWorld(true);
  return { root, site, out, def, cols: CBZ.colliders.slice(), plats: CBZ.platforms.slice() };
}
function isBuildingGroup(o) {
  // a cityMakeBuilding group: carries the shell's lbox children; we mark them below
  return !!(o.userData && o.userData.__bld);
}
function boxesOf(root, skipSet) {
  const out = [];
  const tmp = new THREE.Box3(), m4 = new THREE.Matrix4(), mw = new THREE.Matrix4();
  root.traverse((o) => {
    if (!o.isMesh) return;
    let p = o, inB = false;
    while (p) { if (skipSet.has(p)) { inB = true; break; } p = p.parent; }
    if (inB) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    if (o.isInstancedMesh) {
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m4);
        mw.multiplyMatrices(o.matrixWorld, m4);
        tmp.copy(o.geometry.boundingBox).applyMatrix4(mw);
        out.push({ min: tmp.min.clone(), max: tmp.max.clone(), name: (o.name || o.material.name || "inst") + "#" + i, mesh: o, inst: i });
      }
    } else {
      tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      out.push({ min: tmp.min.clone(), max: tmp.max.clone(), name: o.name || o.geometry.type, mesh: o });
    }
  });
  return out;
}
function nan(root) {
  const bad = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const a = o.geometry.attributes.position.array;
    let hit = false;
    for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) { hit = true; break; }
    if (!Number.isFinite(o.position.x + o.position.y + o.position.z)) hit = true;
    if (hit) bad.push((o.name || o.geometry.type) + " parent:" + (o.parent && o.parent.name) + " pos:" + o.position.toArray().map(v => +(+v).toFixed(2)));
  });
  return bad;
}
function report(id, cx, cz) {
  const R = runRow(id, cx, cz);
  const bld = new Set();
  // building groups = children added by cityMakeBuilding (they have lbox-made children); detect via the shells
  const main = R.out.seat && R.out.seat.b;
  const shells = [];
  if (main) shells.push(main);
  if (R.site.layout) {}
  R.root.children.forEach((ch) => { if (ch.isGroup && ch.children.length > 40 && ch.position.lengthSq() > 0) { bld.add(ch); } });
  const B = boxesOf(R.root, bld);
  // ---- NOTHING FLOATS: every box either touches the ground or touches another box
  const tol = 0.045, floaters = [];
  for (let i = 0; i < B.length; i++) {
    const a = B[i];
    if (a.min.y <= 0.06) continue;
    if (a.min.y <= 0.2 && a.max.y - a.min.y < 0.06) continue;      // paint on tarmac: a decal, not a piece
    let ok = false;
    for (let j = 0; j < B.length && !ok; j++) {
      if (i === j) continue;
      const b = B[j];
      if (a.min.x > b.max.x + tol || a.max.x < b.min.x - tol || a.min.z > b.max.z + tol || a.max.z < b.min.z - tol) continue;
      if (a.min.y > b.max.y + tol || a.max.y < b.min.y - tol) continue;
      ok = true;
    }
    // resting on a building shell (a thing on the perron / against a wall)
    if (!ok) for (const g of bld) {
      const gb = new THREE.Box3().setFromObject(g);
      if (a.min.x <= gb.max.x + tol && a.max.x >= gb.min.x - tol && a.min.z <= gb.max.z + tol && a.max.z >= gb.min.z - tol && a.min.y <= gb.max.y + tol) { ok = true; break; }
    }
    if (!ok) floaters.push(a.name + " y" + a.min.y.toFixed(2) + " @" + ((a.min.x + a.max.x) / 2 - cx).toFixed(1) + "," + ((a.min.z + a.max.z) / 2 - cz).toFixed(1));
  }
  // ---- BELOW GROUND
  const sunk = B.filter((b) => b.min.y < -0.02).map((b) => b.name + " " + b.min.y.toFixed(2) + " @" + ((b.min.x + b.max.x) / 2 - cx).toFixed(1) + "," + ((b.min.z + b.max.z) / 2 - cz).toFixed(1) + " h" + (b.max.y - b.min.y).toFixed(2));
  // ---- SOLIDS: anything standing 0.45..2 m that a body would walk into must sit on colliders
  const cols = R.cols;
  function covered(b) {
    const A = (b.max.x - b.min.x) * (b.max.z - b.min.z);
    if (A < 1e-4) return 1;
    let s = 0;
    for (const c of cols) {
      const lo = Math.max(0.1, b.min.y + 0.05), hi = Math.min(b.max.y, 2.0);
      if (c.y1 != null && c.y1 < lo) continue;
      if (c.y0 != null && c.y0 > hi) continue;
      const D = 0.16;
      const ix = Math.min(b.max.x, c.maxX + D) - Math.max(b.min.x, c.minX - D), iz = Math.min(b.max.z, c.maxZ + D) - Math.max(b.min.z, c.minZ - D);
      if (ix > 0 && iz > 0) s += ix * iz;
    }
    return Math.min(1, s / A);
  }
  const ghosts = [];
  for (const b of B) {
    const h = b.max.y - Math.max(0, b.min.y);
    if (b.min.y > 1.6 || h < 0.45 || b.max.y < 0.5) continue;          // flat ground, kerbs, overhead
    if (b.max.x - b.min.x < 0.2 || b.max.z - b.min.z < 0.2) continue;   // a jet of water, a raised boom arm
    const cov = covered(b);
    if (cov < 0.5) ghosts.push(b.name + " cov" + cov.toFixed(2) + " h" + h.toFixed(2) + " @" + ((b.min.x + b.max.x) / 2 - cx).toFixed(1) + "," + ((b.min.z + b.max.z) / 2 - cz).toFixed(1));
  }
  // ---- surfaces wound up
  let down = 0, tris = 0, sheets = 0;
  R.root.traverse((o) => {
    if (!o.isMesh || !(o.name || "").startsWith("estate-") && !(o.name || "").startsWith("helipad-deck")) return;
    sheets++;
    const p = o.geometry.attributes.position.array, idx = o.geometry.index.array;
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
      const ux = p[b] - p[a], uz = p[b + 2] - p[a + 2], wx = p[c] - p[a], wz = p[c + 2] - p[a + 2];
      if (uz * wx - ux * wz < 0) down++;
      tris++;
    }
  });
  // ---- DOUBLE: two estate solids standing in one place (the fence's piers on
  // its own plinth run are one structure and are skipped)
  const own = cols.filter((c) => !c.ref);
  const dbl = [];
  for (let i = 0; i < own.length; i++) for (let j = i + 1; j < own.length; j++) {
    const a = own[i], b = own[j];
    const ix = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX), iz = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
    if (ix <= 0.02 || iz <= 0.02) continue;
    if (Math.min(a.y1, b.y1) - Math.max(a.y0 || 0, b.y0 || 0) <= 0.02) continue;
    const sz = (c) => [(c.maxX - c.minX).toFixed(2), (c.maxZ - c.minZ).toFixed(2), (c.y1 - (c.y0 || 0)).toFixed(2)].join("x");
    const fenceish = (c) => (c.maxX - c.minX > 5 || c.maxZ - c.minZ > 5) && (c.maxX - c.minX < 0.9 || c.maxZ - c.minZ < 0.9);
    if (fenceish(a) || fenceish(b)) continue;
    dbl.push(sz(a) + " & " + sz(b) + " @" + ((a.minX + a.maxX) / 2 - cx).toFixed(1) + "," + ((a.minZ + a.maxZ) / 2 - cz).toFixed(1));
  }
  // ---- the ground oracle agrees with every drawn surface (triangle centroids)
  const gm = {};
  R.root.traverse((o) => {
    if (!o.isMesh || !(o.name || "").startsWith("estate-")) return;
    const p = o.geometry.attributes.position.array, idx = o.geometry.index.array;
    let n = 0, bad = 0, worst = 0;
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
      const x = (p[a] + p[b] + p[c]) / 3, y = (p[a + 1] + p[b + 1] + p[c + 1]) / 3, z = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
      const g = CBZ.estateGroundAt(x, z);
      n++;
      const d = y - g;                       // drawn above the ground you stand on
      if (d > 0.012) { bad++; worst = Math.max(worst, d); }
    }
    gm[o.name.replace(/^estate-[^-]+-/, "")] = n + " tri, above-ground " + bad + (bad ? " worst " + worst.toFixed(3) : "");
  });
  // ---- draw calls: a rough count of what the batcher cannot merge
  let meshes = 0, inst = 0, textured = 0;
  R.root.traverse((o) => { if (o.isMesh) { meshes++; if (o.isInstancedMesh) inst++; if (o.material && o.material.map) textured++; } });
  // ---- ground oracle
  const G = CBZ.estateGroundAt;
  const L = R.site.layout || {};
  const probe = {};
  if (L.court) { probe.court = G(L.court.center.x + 20, L.court.center.z); probe.island = G(L.court.center.x + 8, L.court.center.z); probe.islandKerb = G(L.court.center.x + L.court.r - 0.1, L.court.center.z); }
  if (L.drive) probe.drive = G(L.drive.a.x, (L.drive.a.z + L.drive.b.z) / 2);
  probe.lawn = G(cx - 100, cz + 30);
  if (L.helipad) probe.helipad = G(L.helipad.x + 3, L.helipad.z + 3);
  probe.outside = G(cx + 1000, cz);
  console.log("\n=== " + id + " ===");
  console.log("objects", B.length, "meshes", meshes, "instanced", inst, "textured", textured, "NaN meshes", JSON.stringify(nan(R.root).slice(0, 12)));
  console.log("sheets", sheets, "tris", tris, "down-facing", down);
  console.log("colliders", cols.length, "platforms", R.plats.length);
  console.log("ground oracle", JSON.stringify(probe, (k, v) => typeof v === "number" ? +v.toFixed(3) : v));
  console.log("SURFACE vs ORACLE", JSON.stringify(gm));
  console.log("DOUBLE SOLIDS", dbl.length, dbl.slice(0, 30));
  console.log("FLOATERS", floaters.length, floaters.slice(0, 40));
  console.log("SUNK", sunk.length, sunk.slice(0, 10));
  console.log("GHOST SOLIDS", ghosts.length, ghosts.slice(0, 40));
  if (main) console.log("house FH", main.FH, "h", main.h, "floorTops", main.floorTops, "order", main.civicOrder && { R: +main.civicOrder.R.toFixed(3), entY: +main.civicOrder.entY.toFixed(2), cols: main.civicOrder.cols.length });
  if (R.site.grandStair) console.log("grand stair", JSON.stringify(R.site.grandStair));
  if (L.order) console.log("layout.order", JSON.stringify(L.order).slice(0, 300));
  if (L.helipad) console.log("helipad", JSON.stringify(L.helipad));
  FAIL += floaters.length + sunk.length + ghosts.length + down + nan(R.root).length;
  return R;
}

report("agency", 5000, 5000);
report("defence", -5000, 5000);

console.log("\n=== the whole govcomplex pass: the two HQs inside ===");
for (const rel of ["src/city/elevators.js", "src/city/furniture.js", "src/world/roombuild.js"]) {
  try { vm.runInContext(fs.readFileSync(ROOT + "/" + rel, "utf8"), ctx, { filename: rel }); } catch (e) { console.log("load fail", rel, e.message); }
}
CBZ.colliders.length = 0; CBZ.platforms.length = 0;
CBZ.registerCityRegion = function (city, r) { (city.regions = city.regions || []).push(r); return r; };
CBZ.registerNoSpawnZone = function () {};
const FED = new Set(["securitylobby", "opscenter", "briefingroom", "directorsuite"]);
const LAW = [];
const TALLY = {};
const rawProg = CBZ.interiorProgram;
CBZ.interiorProgram = function (name, room, pctx) {
  const b = pctx && pctx.b;
  if (!FED.has(name) || !b || typeof b.lbox !== "function") return rawProg.apply(this, arguments);
  let ft = room.y || 0;
  if (ft < 0.1 && Array.isArray(b.floorTops) && b.floorTops[0] != null) ft = b.floorTops[0];
  const lb = b.lbox; let n = 0;
  b.lbox = function (lx, ly, lz, w, h, d, col, o) {
    n++;
    const bot = ly - h / 2, top = ly + h / 2;
    const finish = h <= 0.05 && w * d > 4 && bot < ft + 0.03;     // a covering, a rug, a mat
    if (finish) { if (top > ft + 0.021 || top < ft - 0.001) LAW.push(name + " FINISH top " + (top - ft).toFixed(3) + " @" + lx.toFixed(1) + "," + lz.toFixed(1)); }
    else if (bot < ft - 0.005) LAW.push(name + " SUNK bottom " + (bot - ft).toFixed(3) + " @" + lx.toFixed(1) + "," + lz.toFixed(1));
    return lb.apply(this, arguments);
  };
  let out;
  try { out = rawProg.apply(this, arguments); } finally { b.lbox = lb; }
  TALLY[name] = (TALLY[name] || 0) + 1;
  TALLY[name + ":boxes"] = (TALLY[name + ":boxes"] || 0) + n;
  if (!out) LAW.push(name + " returned null on a " + (room.x1 - room.x0).toFixed(1) + "x" + (room.z1 - room.z0).toFixed(1) + " plate");
  return out;
};
const city = { root: new THREE.Group(), roads: [], lots: [], shopLots: [], regions: [], minX: -500, maxX: 500, minZ: -500, maxZ: 500, center: { x: 0, z: 0 } };
const lm = CBZ._lm.find((l) => l.order === 42);
const errs = [];
const oe = console.error; console.error = function () { errs.push([...arguments].map(String).join(" ").slice(0, 300)); };
lm.fn(city);
console.error = oe;
console.log("errors", errs.length, errs.slice(0, 8));
FAIL += errs.length;
for (const id of ["agency", "defence"]) {
  const s = (CBZ.govComplexes || []).find((q) => q.id === id);
  if (!s || !s.lot) { console.log(id, "NOT PLACED"); FAIL++; continue; }
  const b = s.lot.building;
  console.log(id, "main", s.lot.building.name, "FH", b.FH, "storeys", b.storeys, "floors", JSON.stringify(b._occupyProgrammed));
  const anc = b._occupyAnchors || {};
  console.log("  anchors", Object.keys(anc).map((k) => k + ":" + anc[k].map((a) => a.kind || "seat").join("/")).join("  "));
}
console.log("federal programs", JSON.stringify(TALLY));
console.log("FLOOR LAW", LAW.length, LAW.slice(0, 20));
FAIL += LAW.length;
console.log(FAIL ? "\nFEDERAL HQ CHECK: " + FAIL + " failures" : "\nFEDERAL HQ CHECK: clean");
process.exit(FAIL ? 1 : 0);
