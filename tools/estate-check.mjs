#!/usr/bin/env node
/* tools/estate-check.mjs — THE ESTATE KIT, MEASURED IN PLAIN NODE.

   No browser, no capture. Vendored three r128 and the REAL buildings.js,
   buildings_civic.js, systems/stairs.js, interior_programs.js,
   elevators.js, furniture.js, roombuild.js and govcomplex.js run in a vm
   with only the engine globals stubbed. Then:

     1. the Executive Mansion (tier 5), the Governor's Residence (tier 4) and
        a tier-3 villa on three other gate sides are built through their rows
        and measured:
          FLOATERS  a piece touching neither the ground nor anything else
          SUNK      a piece below y 0
          GHOST     a standing solid (0.45-2 m, a body's height) with no
                    collider under at least half its footprint
          DOUBLE    two estate solids in one place
          SURFACE   every drawn ground triangle vs CBZ.estateGroundAt (the
                    height the player, the peds and the cars stand on):
                    drawn above the ground = feet in the paving
          winding   ground triangles facing down
     2. the whole govcomplex landmass pass runs on a stub city and the
        Mansion's inside is read back: storey height, dressed floors, the
        service core's side, the grand stair, the presidential rooms and
        the walk surfaces at the stair hall.

   USAGE   node tools/estate-check.mjs        exit 1 on any FLOATER / SUNK /
                                              GHOST / down-facing / NaN
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
  CONFIG: {}, colliders: [], platforms: [], losBlockers: [], game: { mode: "city" },
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
const M = report("execmansion", 3000, -2000);
report("governor", -3000, 1500);

// a tier-3 private villa through the public one-call API, gate on +X
for (const side of [3, 0, 2]) {
  const id = "villa-test-" + side;
  const villa = CBZ.estateKit.register({
    id: id, name: "Villa", hx: 90, hz: 80, gateSide: side,
    principal: { key: null, tier: 3, org: "private", role: "Owner", wealth: 0.9, family: true },
    estate: { tier: 3, house: { v: -22, w: 30, d: 20, storeys: 2, fh: 3.8, civic: { crown: "pediment", order: "ionic", stone: true, monumental: true, externalPerron: true } },
      helipad: { u: 50, v: 30, r: 10 }, parterres: [{ u: 0, v: -58, w: 30, d: 16 }] },
  });
  console.log("registered", id, !!villa);
  report(id, 800, 900);
}

{
console.log("\n=== the whole govcomplex pass, and the Mansion's inside ===");
for (const rel of ["src/city/elevators.js", "src/city/furniture.js", "src/world/roombuild.js"]) {
  try { vm.runInContext(fs.readFileSync(ROOT + "/" + rel, "utf8"), ctx, { filename: rel }); } catch (e) { console.log("load fail", rel, e.message); }
}
CBZ.colliders.length = 0; CBZ.platforms.length = 0;
const regions = [];
CBZ.registerCityRegion = function (city, r) { regions.push(r); (city.regions = city.regions || []).push(r); return r; };
CBZ.registerNoSpawnZone = function () {};
const city = { root: new THREE.Group(), roads: [], lots: [], shopLots: [], regions: [], minX: -500, maxX: 500, minZ: -500, maxZ: 500, center: { x: 0, z: 0 } };
const lm = CBZ._lm.find((l) => l.order === 42);
const errs = [];
const oe = console.error; console.error = function () { errs.push([...arguments].map(String).join(" ").slice(0, 300)); };
lm.fn(city);
console.error = oe;
console.log("errors", errs.length, errs.slice(0, 8));
const S = CBZ.govComplexes || [];
console.log("sites", S.map((s) => s.id + (s.rect ? "" : "(unplaced)")).join(" "));
const m = S.find((s) => s.id === "execmansion");
if (m && m.lot) {
  const b = m.lot.building;
  console.log("mansion", "FH", b.FH, "storeys", b.storeys, "dressed floors", JSON.stringify(b._occupyProgrammed), "stairCore", !!(b._stairCore || (m.lot._rawMain && m.lot._rawMain._stairCore)));
  console.log("grandStair", JSON.stringify(m.grandStair));
  const P = b.stairPlan; if (P) console.log("core rect (local)", JSON.stringify(P.rect), "side", P.side);
  console.log("roomTrim", JSON.stringify(b._roomTrim));
  const rooms = CBZ.presidentInteriorRooms ? CBZ.presidentInteriorRooms() : [];
  console.log("presidential rooms", rooms.map((r) => r.key + "@" + (+r.floorY).toFixed(2) + (r.landmarks && r.landmarks.presidentialDesk ? "(desk)" : "")).join(" "));
  // the flight's walk surface + a floor at each level where a body stands
  const pl = CBZ.platforms;
  const gs = m.grandStair;
  if (gs && CBZ.groundAt) {
    const mid = { x: (gs.bottom.x + gs.top.x) / 2, z: (gs.bottom.z + gs.top.z) / 2 };
    console.log("groundAt mid-flight from floor", CBZ.groundAt ? CBZ.groundAt(mid.x, mid.z, 2.0) : "n/a");
  }
  // walk surfaces: is there a platform under the landing, the first floor, the second?
  function topAt(x, z) { const t = []; for (const p of pl) if (x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ && !p.ramp) t.push(+p.top.toFixed(2)); return JSON.stringify([...new Set(t)].sort((a, b) => a - b)); }
  const cx = m.cx, cz = m.cz;
  console.log("platform tops: hall", topAt(cx, cz - 30), " landing", gs ? topAt(gs.landing.x, gs.landing.z) : "-", " stairwell(open)", topAt(cx - 25.5, cz - 34 + 3));
  console.log("site.layout keys", Object.keys(m.layout || {}).join(","));
}


// ==========================================================================
// THE WALK. Every enterable shell every complex raised (CBZ.govShells), its
// stair core built the way the game builds it (CBZ.cityStairCore), then:
//   FLOOR   a grid over every storey: the walk surface (the same ground law
//           physics.js uses: platforms, ramps, stepped flights, STEP_UP
//           reach) must equal floorTops[k], and no drawn floor surface (an
//           upward face of >= 0.15 m2) may stand more than 2 cm over it:
//           feet in the carpet. And there must BE a drawn floor within 2 cm.
//   STAIRS  every CBZ.stairs link the shell owns (grand stair flights, the
//           core's storey links) walked up at 5 cm on that ground law: it
//           must arrive (|end error| < 3 cm), never rise more than a riser in
//           one step, have a drawn tread within 2 cm of the feet on every
//           sample, a clear column from the ankles to 2.0 m over the feet (no
//           ceiling, slab, beam or fixture in the head path) and no solid in
//           the body band.
//   TREADS  every published grand-stair tread answers its own top.
// ==========================================================================
{
  const STEP_UP = 0.45;
  const plats = () => CBZ.platforms;
  function groundAt(x, z, fromY) {
    let best = CBZ.estateGroundAt ? CBZ.estateGroundAt(x, z) : 0;
    const reach = (fromY != null ? fromY : best) + STEP_UP;
    for (const p of plats()) {
      if (x < p.minX || x > p.maxX || z < p.minZ || z > p.maxZ) continue;
      if (p.obb) {
        const o = p.obb, rx = x - o.cx, rz = z - o.cz;
        const a = rx * o.ux + rz * o.uz, c = rx * o.uz - rz * o.ux;
        if (a < -o.hl || a > o.hl || c < -o.hw || c > o.hw) continue;
      }
      let top = p.top;
      if (p.ramp) {
        const r = p.ramp;
        let t = r.dir ? ((x - r.ox) * r.dx + (z - r.oz) * r.dz) / r.len
          : (r.axis === "x") ? (x - r.x0) / (r.x1 - r.x0) : (z - r.z0) / (r.z1 - r.z0);
        if (t < 0) t = 0; else if (t > 1) t = 1;
        top = CBZ.rampTop(r, t);
      }
      if (top <= reach && top > best) best = top;
    }
    return best;
  }
  // triangle grid of a building's DRAWN geometry (world space)
  function triGrid(group) {
    const G = new Map(), C = 0.5;
    const key = (i, j) => i * 100003 + j;
    const tris = [];
    group.updateMatrixWorld(true);
    const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], m4 = new THREE.Matrix4(), mw = new THREE.Matrix4();
    group.traverse((o) => {
      if (!o.isMesh) return;
      let vis = true;
      for (let q = o; q; q = q.parent) if (q.visible === false) { vis = false; break; }
      if (!vis) return;
      const g = o.geometry, pa = g.attributes.position, idx = g.index ? g.index.array : null;
      const nT = idx ? idx.length / 3 : pa.count / 3;
      const inst = o.isInstancedMesh ? o.count : 1;
      for (let k = 0; k < inst; k++) {
        if (o.isInstancedMesh) { o.getMatrixAt(k, m4); mw.multiplyMatrices(o.matrixWorld, m4); } else mw.copy(o.matrixWorld);
        for (let t = 0; t < nT; t++) {
          for (let c = 0; c < 3; c++) { const vi = idx ? idx[t * 3 + c] : t * 3 + c; v[c].fromBufferAttribute(pa, vi).applyMatrix4(mw); }
          const ax = v[1].x - v[0].x, az = v[1].z - v[0].z, bx = v[2].x - v[0].x, bz = v[2].z - v[0].z;
          const area2 = ax * bz - az * bx;                 // signed XZ area x2
          if (Math.abs(area2) < 1e-7) continue;           // a wall seen edge-on: no vertical line hits it
          const ux = v[1].x - v[0].x, uy = v[1].y - v[0].y, uz = v[1].z - v[0].z, wx = v[2].x - v[0].x, wy = v[2].y - v[0].y, wz = v[2].z - v[0].z;
          const ny = uz * wx - ux * wz, nx = uy * wz - uz * wy, nz = ux * wy - uy * wx, nl = Math.hypot(nx, ny, nz) || 1;
          const T = { p: v.map((q) => [q.x, q.y, q.z]), a2: area2, up: ny / nl, area: Math.abs(area2) / 2, name: (o.name || "") + "[" + [o.scale.x, o.scale.y, o.scale.z].map((q) => +q.toFixed(2)).join("x") + " y" + o.position.y.toFixed(2) + "]" };
          tris.push(T);
          const x0 = Math.min(v[0].x, v[1].x, v[2].x), x1 = Math.max(v[0].x, v[1].x, v[2].x), z0 = Math.min(v[0].z, v[1].z, v[2].z), z1 = Math.max(v[0].z, v[1].z, v[2].z);
          for (let i = Math.floor(x0 / C); i <= Math.floor(x1 / C); i++) for (let j = Math.floor(z0 / C); j <= Math.floor(z1 / C); j++) {
            const kk = key(i, j); let L = G.get(kk); if (!L) G.set(kk, L = []); L.push(T);
          }
        }
      }
    });
    // every surface crossing the vertical line at (x,z): [{y, up, area}]
    function at(x, z) {
      const L = G.get(key(Math.floor(x / C), Math.floor(z / C)));
      const out = [];
      if (!L) return out;
      for (const T of L) {
        const p = T.p;
        const l1 = ((x - p[0][0]) * (p[2][2] - p[0][2]) - (z - p[0][2]) * (p[2][0] - p[0][0])) / T.a2;
        const l2 = ((p[1][0] - p[0][0]) * (z - p[0][2]) - (p[1][2] - p[0][2]) * (x - p[0][0])) / T.a2;
        const l0 = 1 - l1 - l2;
        if (l0 < -1e-6 || l1 < -1e-6 || l2 < -1e-6) continue;
        out.push({ y: l0 * p[0][1] + l1 * p[1][1] + l2 * p[2][1], up: T.up, area: T.area, name: T.name, T: T });
      }
      return out;
    }
    return { at, n: tris.length };
  }
  function solidAt(x, z, lo, hi, r) {
    for (const c of CBZ.colliders) {
      if (c.y1 != null && c.y1 <= lo) continue;
      if (c.y0 != null && c.y0 >= hi) continue;
      if (x + r <= c.minX || x - r >= c.maxX || z + r <= c.minZ || z - r >= c.maxZ) continue;
      if (c.stairSoffit) continue;
      return c;
    }
    return null;
  }
  function gsr0(srec, b) { const g = srec && srec.grandStair; return g && Math.abs(g.bottom.x - b.ox) < b.w / 2 && Math.abs(g.bottom.z - b.oz) < b.d / 2 ? g : null; }
  const shells = (CBZ.govShells ? CBZ.govShells() : []).filter((s) => s.b && s.b.group && Array.isArray(s.b.floorTops));
  let W = { floorPts: 0, floorBad: 0, sunk: 0, bare: 0, stairSamples: 0, stairBad: 0, head: 0, treadMiss: 0, blocked: 0, noArrive: 0, links: 0, treads: 0, treadBad: 0 };
  const samples = { sunk: [], bare: [], walk: [], head: [], tread: [], blocked: [], arrive: [] };
  const NOTE_MAX = process.argv.includes("-v") ? 60 : 12;
  let perShell = {};
  // at most 3 samples of a kind per shell, so one bad building cannot hide the next
  function note(k, s) { perShell[k] = (perShell[k] | 0) + 1; if (perShell[k] <= 3 && samples[k].length < NOTE_MAX) samples[k].push(s); }
  const VERBOSE = process.argv.includes("-v");
  let W0 = {};
  for (const sh of shells) {
    W0 = Object.assign({}, W); perShell = {};
    const b = sh.b, sid = typeof sh.site === "string" ? sh.site : (sh.site && sh.site.id), srec = (CBZ.govComplexes || []).find((q) => q.id === sid) || null, tag = sid + "/" + (sh.name || "shell") + "@" + b.ox.toFixed(0) + "," + b.oz.toFixed(0);
    if ((b.storeys | 0) >= 2 && CBZ.cityStairCore) { try { CBZ.cityStairCore({ building: b }); } catch (e) { console.log("core fail", tag, e.message); } }
    const TG = triGrid(b.group);
    const tops = b.floorTops, wt = b.wt != null ? b.wt : 0.4;
    const holes = (b.shaftRects || []);
    const inHole = (lx, lz, k) => holes.some((r) => lx > r.x0 - 0.3 && lx < r.x1 + 0.3 && lz > r.z0 - 0.3 && lz < r.z1 + 0.3 && (k === 0 ? !r.levels : true));
    // ---- FLOORS
    for (let k = 0; k < (b.storeys | 0); k++) {
      const ft = tops[k];
      for (let lx = -b.w / 2 + wt + 0.35; lx < b.w / 2 - wt - 0.3; lx += 0.7) for (let lz = -b.d / 2 + wt + 0.35; lz < b.d / 2 - wt - 0.3; lz += 0.7) {
        if (inHole(lx, lz, k)) continue;
        const x = b.ox + lx, z = b.oz + lz;
        if (solidAt(x, z, ft + 0.1, ft + 1.2, 0.05)) continue;             // inside furniture/a wall: nobody stands here
        const g = groundAt(x, z, ft + 0.05);
        W.floorPts++;
        if (Math.abs(g - ft) > 0.02) {
          // a raised walk surface (a dais, the stair) is fine when something is DRAWN at it
          const hitS = TG.at(x, z).some((h) => h.up > 0.7 && Math.abs(h.y - g) <= 0.02);
          if (!hitS && process.env.DBG && samples.walk.length < 1) console.log("DBG plats", JSON.stringify(CBZ.platforms.filter((p) => x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ).map((p) => ({ x0: +(p.minX - b.ox).toFixed(2), x1: +(p.maxX - b.ox).toFixed(2), z0: +(p.minZ - b.oz).toFixed(2), z1: +(p.maxZ - b.oz).toFixed(2), top: p.top, ramp: p.ramp }))));
          if (!hitS) { W.floorBad++; note("walk", tag + " k" + k + " walk " + g.toFixed(3) + " vs floor " + ft.toFixed(3) + " @" + lx.toFixed(1) + "," + lz.toFixed(1)); }
          continue;
        }
        const hs = TG.at(x, z);
        // a FINISH is the top drawn thing there: an up-face with nothing drawn
        // over it for a metre (under a desk, a bench or a bed it is furniture)
        const topY = hs.reduce((m, h) => (h.y > g + 0.021 && h.y < g + 1.2 && h.y > m ? h.y : m), -1e9);
        const over = hs.filter((h) => h.up > 0.7 && h.area >= 0.15 && h.y > g + 0.021 && h.y <= g + 0.25 && h.y >= topY - 1e-4);
        if (over.length) { W.sunk++; const h = over.sort((a, c) => c.y - a.y)[0]; note("sunk", tag + " k" + k + " drawn floor +" + (h.y - g).toFixed(3) + " over the walk @" + lx.toFixed(1) + "," + lz.toFixed(1) + " " + h.name); }
        if (!hs.some((h) => h.up > 0.7 && Math.abs(h.y - g) <= 0.021)) { W.bare++; note("bare", tag + " k" + k + " nothing drawn at the walk height " + g.toFixed(3) + " @" + lx.toFixed(1) + "," + lz.toFixed(1)); }
      }
    }
    // ---- STAIRS: every link this shell owns
    const links = CBZ.stairs.links().filter((L) => L.owner === b || (L.owner && L.owner.group && L.owner.group === b.group));
    for (const L of links) {
      W.links++;
      let y = L.path[0].y, maxUp = 0, bad = 0;
      for (let i = 1; i < L.path.length; i++) {
        const a = L.path[i - 1], c = L.path[i];
        const n = Math.max(1, Math.ceil(Math.hypot(c.x - a.x, c.z - a.z) / 0.05));
        for (let s2 = 1; s2 <= n; s2++) {
          const x = a.x + (c.x - a.x) * s2 / n, z = a.z + (c.z - a.z) * s2 / n;
          const g = groundAt(x, z, y);
          if (g - y > maxUp) maxUp = g - y;
          y = g; W.stairSamples++;
          const hs = TG.at(x, z);
          if (!hs.some((h) => h.up > 0.7 && Math.abs(h.y - y) <= 0.021)) { W.treadMiss++; bad++; note("tread", tag + " link" + L.id + " no tread under the feet at y " + y.toFixed(3) + " @" + (x - b.ox).toFixed(2) + "," + (z - b.oz).toFixed(2)); }
          // the column from over a riser (a nosing may overhang the toes) to 2 m
          const head = hs.filter((h) => h.y > y + 0.25 && h.y < y + 2.0);
          if (head.length) { W.head++; bad++; const h = head.sort((p, q) => p.y - q.y)[0]; if (process.env.DBG && samples.head.length < 3) console.log("DBG all", y.toFixed(3), JSON.stringify(head.map((q) => [+(q.y - y).toFixed(3), q.T.p.map((w) => w.map((u, ii) => +(u - (ii === 0 ? b.ox : ii === 2 ? b.oz : 0)).toFixed(2)))])));
          if (process.env.DBG && samples.head.length < 0) console.log("DBG head tri", JSON.stringify(h.T.p.map((q) => q.map((u, ii) => +(u - (ii === 0 ? b.ox : ii === 2 ? b.oz : 0)).toFixed(2)))), "path", JSON.stringify(L.path.map((q) => [+(q.x - b.ox).toFixed(2), +q.y.toFixed(2), +(q.z - b.oz).toFixed(2)])));
          note("head", tag + " link" + L.id + " drawn surface " + (h.y - y).toFixed(2) + " m over the feet (y " + y.toFixed(2) + ") @" + (x - b.ox).toFixed(2) + "," + (z - b.oz).toFixed(2) + " " + h.name); }
          const c2 = solidAt(x, z, y + 0.42, y + 1.7, 0.05);
          if (c2) { W.blocked++; bad++; note("blocked", tag + " link" + L.id + " solid in the body band at y " + y.toFixed(2) + " @" + (x - b.ox).toFixed(2) + "," + (z - b.oz).toFixed(2) + " col y" + (c2.y0 != null ? c2.y0.toFixed(2) : "-") + ".." + (c2.y1 != null ? c2.y1.toFixed(2) : "-")); }
        }
      }
      const end = L.path[L.path.length - 1];
      if (Math.abs(y - end.y) > 0.03 || maxUp > 0.2) { W.noArrive++; note("arrive", tag + " link" + L.id + " ends at " + y.toFixed(3) + " for " + end.y.toFixed(3) + " maxUp " + maxUp.toFixed(3)); }
      if (bad) W.stairBad++;
    }
    // ---- FROM THE FRONT DOOR TO EVERY FLOOR: the AI route (CBZ.stairs.route
    // chains the links) walked on the same ground law, arriving at the floor
    const dn = b.localDoor;
    const core = b._stairCore || (b.group.userData && b.group.userData.stairCore) || null;
    if (dn && (b.storeys | 0) >= 2) {
      const from = { x: b.ox + dn.x + dn.nx * 1.6, y: tops[0], z: b.oz + dn.z + dn.nz * 1.6 };
      const kMax = core ? core.floors : 1;
      for (let k = 1; k <= Math.min(kMax, (b.storeys | 0) - 1); k++) {
        W.routes = (W.routes | 0) + 1;
        const h = core ? core.headAt(k) : null;
        const to = h ? { x: h.x + h.nx * 1.2, y: tops[k], z: h.z + h.nz * 1.2 } : (gsr0(srec, b) ? gsr0(srec, b).landing : null);
        const rt = to ? CBZ.stairs.route(from, to) : null;
        if (!rt || !rt.length) { W.noRoute = (W.noRoute | 0) + 1; note("arrive", tag + " no route from the door to floor " + k); continue; }
        let y = from.y, px = from.x, pz = from.z;
        for (const q of rt) {
          const n = Math.max(1, Math.ceil(Math.hypot(q.x - px, q.z - pz) / 0.05));
          for (let s3 = 1; s3 <= n; s3++) y = groundAt(px + (q.x - px) * s3 / n, pz + (q.z - pz) * s3 / n, y);
          px = q.x; pz = q.z;
        }
        if (Math.abs(y - tops[k]) > 0.03) { W.noRoute = (W.noRoute | 0) + 1; note("arrive", tag + " door->floor " + k + " walked to y " + y.toFixed(3) + " for " + tops[k].toFixed(3)); }
      }
    }
    const gsr = srec && srec.grandStair;
    if (gsr && gsr.treads && Math.abs(gsr.bottom.x - b.ox) < b.w / 2 && Math.abs(gsr.bottom.z - b.oz) < b.d / 2) {
      for (const t of gsr.treads) {
        W.treads++;
        const g = groundAt(t.x, t.z, t.top - 0.05);
        if (Math.abs(g - t.top) > 0.01) { W.treadBad++; note("tread", tag + " grand tread top " + t.top.toFixed(3) + " walks at " + g.toFixed(3)); }
      }
    }
    const mine = Object.keys(W).map((k) => W[k] - (W0[k] || 0));
    if (VERBOSE || mine.some((v, i) => i > 0 && ["floorBad", "sunk", "bare", "head", "treadMiss", "blocked", "noArrive", "treadBad"].indexOf(Object.keys(W)[i]) >= 0 && v)) {
      const d = {}; Object.keys(W).forEach((k, i) => { if (mine[i]) d[k] = mine[i]; });
      console.log("  shell", tag, "storeys", b.storeys, "FH", b.FH, JSON.stringify(d));
    }
  }
  console.log("\n=== the walk: " + shells.length + " shells ===");
  console.log("floor points", W.floorPts, "walk!=floor", W.floorBad, "feet under a drawn floor", W.sunk, "no drawn floor", W.bare);
  console.log("stair links", W.links, "samples", W.stairSamples, "links with faults", W.stairBad, "| no tread", W.treadMiss, "head path", W.head, "body blocked", W.blocked, "no arrival", W.noArrive, "| grand treads", W.treads, "bad", W.treadBad, "| door->floor routes", W.routes | 0, "failed", W.noRoute | 0);
  for (const k in samples) if (samples[k].length) console.log("  " + k + ":", samples[k].join("\n    "));
  FAIL += (W.noRoute | 0) + W.floorBad + W.sunk + W.bare + W.treadMiss + W.head + W.blocked + W.noArrive + W.treadBad;
}
}
console.log(FAIL ? "\nESTATE CHECK: " + FAIL + " failures" : "\nESTATE CHECK: clean");
process.exit(FAIL ? 1 : 0);
