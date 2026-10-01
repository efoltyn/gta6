#!/usr/bin/env node
/* tools/capitol-check.mjs — THE CAPITOL, CITY HALL AND THE GOVERNOR'S HOUSE,
   measured in plain node (no browser, no capture).

   Vendored three r128 and the real buildings_civic.js (the monument kit),
   buildings.js, stairs.js, interior_programs.js (the civic programs),
   elevators.js, furniture.js and govcomplex.js run the whole govcomplex
   landmass pass on a stub city; then, for the three civic rows:

     PROGRAMS  every declared floor of every shell was dressed, and no
               program threw (a throw is otherwise swallowed by §5c)
     PORTICO   every drawn tread of the Capitol's two flights answers its own
               top on the ground law, the deck is the principal floor, the
               apron and the vestibule are filed in the ground oracle
     DOME      the drum, the dome and the inside of both exist; the well is
               carved through every slab and the roof, and fits inside the
               drum's inner wall
     CHAMBER   both wings carry five tiers of walk surfaces, desks with seats,
               the rostrum's registered levels, the gallery's void carved
     LAW       no drawn up-face on a civic floor sits 2.1..25 cm over the
               slab unless a walk surface is registered at its top
     COST      meshes / instanced / emissive per shell (the batcher merges the
               plain ones; emissive and instanced are real draw calls)

   USAGE   node tools/capitol-check.mjs [-v]      exit 1 on any failure */
import fs from "fs";
import vm from "vm";
const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const V = process.argv.includes("-v");
const ctx = { console, Math, Date, JSON, Object, Array, Number, String, Set, Map, WeakMap, Float32Array, Uint16Array, Uint32Array, Int32Array, Uint8Array, Float64Array, ArrayBuffer, Symbol, Error, parseInt, parseFloat, isFinite, isNaN, Infinity, NaN, Proxy, Reflect, Promise, setTimeout, clearTimeout };
ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx; ctx.addEventListener = function () {}; ctx.removeEventListener = function () {}; ctx.performance = { now: () => Date.now() }; ctx.requestAnimationFrame = function () {};
function ctx2d(c) {
  const base = { canvas: c, getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(w * h * 4).fill(128), width: w, height: h }; },
    createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; }, measureText(t) { return { width: String(t).length * 8 }; },
    createLinearGradient() { return { addColorStop() {} }; }, createRadialGradient() { return { addColorStop() {} }; }, createPattern() { return {}; } };
  return new Proxy(base, { get(t, k) { if (k in t) return t[k]; return function () {}; }, set(t, k, v) { t[k] = v; return true; } });
}
ctx.document = { createElement() { return { width: 300, height: 150, style: {}, getContext() { return this._c || (this._c = ctx2d(this)); }, addEventListener() {}, toDataURL() { return ""; } }; },
  getElementById() { return null; }, querySelector() { return null; }, body: { appendChild() {} }, addEventListener() {} };
ctx.Uint8ClampedArray = Uint8ClampedArray;
vm.createContext(ctx);
function load(rel) { vm.runInContext(fs.readFileSync(ROOT + "/" + rel, "utf8"), ctx, { filename: rel }); }
load("src/vendor/three.r128.min.js");
const THREE = ctx.THREE;
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
for (const f of ["src/city/flags.js", "src/systems/stairs.js", "src/city/buildings_civic.js", "src/city/buildings.js", "src/city/interior_programs.js", "src/city/govcomplex.js",
  "src/city/elevators.js", "src/city/furniture.js", "src/world/roombuild.js"]) load(f);
// a program's throw is swallowed by §5c's dressFloor; surface it here
const THROWN = [];
const IP = CBZ.interiorProgram;
CBZ.interiorProgram = function (name, room, c) {
  const b = c && c.b;
  const raw = b && b.lbox;
  try { return IP.apply(this, arguments); }
  catch (e) { THROWN.push(name + ": " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e)); if (b && raw) b.lbox = raw; if (b) b._interiorBound = false; throw e; }
};
CBZ.registerCityRegion = function (city, r) { (city.regions = city.regions || []).push(r); return r; };
CBZ.registerNoSpawnZone = function () {};
const city = { root: new THREE.Group(), roads: [], lots: [], shopLots: [], regions: [], minX: -500, maxX: 500, minZ: -500, maxZ: 500, center: { x: 0, z: 0 } };
const errs = [];
const oe = console.error; console.error = function () { errs.push([...arguments].map(String).join(" ").slice(0, 300)); };
CBZ._lm.find((l) => l.order === 42).fn(city);
console.error = oe;

let FAIL = 0;
const fail = (s) => { FAIL++; console.log("  FAIL " + s); };
const STEP_UP = 0.45;
function groundAt(x, z, fromY) {
  let best = CBZ.estateGroundAt ? CBZ.estateGroundAt(x, z) : 0;
  const reach = (fromY != null ? fromY : best) + STEP_UP;
  for (const p of CBZ.platforms) {
    if (x < p.minX || x > p.maxX || z < p.minZ || z > p.maxZ) continue;
    if (p.obb) { const o = p.obb, rx = x - o.cx, rz = z - o.cz; const a = rx * o.ux + rz * o.uz, c = rx * o.uz - rz * o.ux; if (a < -o.hl || a > o.hl || c < -o.hw || c > o.hw) continue; }
    let top = p.top;
    if (p.ramp) { const r = p.ramp; let t = r.dir ? ((x - r.ox) * r.dx + (z - r.oz) * r.dz) / r.len : (r.axis === "x") ? (x - r.x0) / (r.x1 - r.x0) : (z - r.z0) / (r.z1 - r.z0); t = Math.max(0, Math.min(1, t)); top = CBZ.rampTop(r, t); }
    if (top <= reach && top > best) best = top;
  }
  return best;
}
console.log("errors", errs.length, errs.slice(0, 6));
if (errs.length) fail("the landmass pass logged " + errs.length + " errors");
if (THROWN.length) { fail(THROWN.length + " programs threw"); THROWN.slice(0, 6).forEach((t) => console.log("    " + t)); }
const sites = CBZ.govComplexes || [];
const shells = CBZ.govShells();
const cost = (g) => { let m = 0, i = 0, e = 0; g.traverse((o) => { if (!o.isMesh) return; m++; if (o.isInstancedMesh) i++; if (o.material && o.material.emissive && o.material.emissive.getHex() && !o.isInstancedMesh) e++; }); return { meshes: m, instanced: i, emissive: e }; };
for (const id of ["capitol", "cityhall", "governor"]) {
  const s = sites.find((q) => q.id === id);
  if (!s || !s.rect) { fail(id + " was not placed"); continue; }
  console.log("\n=== " + id + " ===");
  for (const sh of shells.filter((q) => q.site === id)) {
    const b = sh.b, n = b.floorTops.length - 1;
    const want = sh.name === "The Capitol" || sh.name === "City Hall" || /Governor/.test(sh.name || "") ? n : (/Wing/.test(sh.name || "") ? n : 0);
    const site = sites.find((q) => q.id === id);
    const host = site && site.lot && site.lot._rawMain === b ? site.lot.building : b;
    const got = host._govDressed | 0;
    console.log(" ", sh.name || "shell", "storeys", b.storeys, "FH", b.FH, "dressed", got + "/" + n, JSON.stringify(cost(b.group)));
    if (want && got < want) fail(sh.name + " dressed " + got + " of " + want + " floors");
  }
}
// ---- THE CAPITOL
const cap = sites.find((q) => q.id === "capitol");
if (cap && cap.capitol) {
  const P = cap.capitol.portico, D = cap.capitol.dome;
  const main = cap.lot && cap.lot._rawMain;
  if (!P) fail("no portico"); else {
    let bad = 0;
    for (const t of P.treads) { const g = groundAt(t.x, t.z, t.top - 0.05); if (Math.abs(g - t.top) > 0.01) bad++; }
    console.log("portico: deck", P.deck, "treads", P.treads.length, "bad", bad, "flights", JSON.stringify(P.flights), "pediment apex", P.pediment && P.pediment.apex.toFixed(1));
    if (bad) fail(bad + " portico treads do not answer their own top");
    if (Math.abs(P.deck - main.floorTops[1]) > 1e-6) fail("the deck is not the principal floor");
    const vx = main.ox, vz = main.oz + P.zf + 2;                      // the vestibule, under the deck
    const gv = groundAt(vx, vz, 0.2);
    console.log("vestibule ground", gv.toFixed(3), " forecourt", groundAt(cap.cx, cap.cz + 10, 0.2).toFixed(3), " lawn", groundAt(cap.cx - 60, cap.cz + 40, 0.2).toFixed(3));
    if (Math.abs(gv - 0.10) > 0.011) fail("vestibule floor " + gv + " is not the drawn 0.10");
  }
  if (!D) fail("no dome"); else {
    console.log("dome: drum R", D.drumR.toFixed(2), "inner", D.innerR.toFixed(2), "springing", D.springing.toFixed(1), "apex", D.apex.toFixed(1));
    const W = main._civicPlan && main._civicPlan.rotunda && main._civicPlan.rotunda.well;
    if (W * Math.SQRT2 >= D.innerR) fail("the well's corners (" + (W * Math.SQRT2).toFixed(2) + ") reach past the drum's inner wall");
    const carved = main.floorSlabs.map((f) => !!f.carved);
    console.log("well: slabs carved", JSON.stringify(carved), "roof", !!(main.roofSlab && main.roofSlab.carved));
    if (carved.some((c) => !c) || !(main.roofSlab && main.roofSlab.carved)) fail("the rotunda's well is not open to the dome");
  }
  const ST = main._civicPlan && main._civicPlan.stair;
  if (!ST) fail("the Capitol has no grand stair"); else {
    let bad = 0;
    for (const t of ST.treads) { const g = groundAt(t.x, t.z, t.top - 0.05); if (Math.abs(g - t.top) > 0.01) bad++; }
    console.log("grand stair: treads", ST.treads.length, "bad", bad, "links", JSON.stringify(ST.links));
    if (bad) fail(bad + " grand-stair treads do not answer their own top");
  }
  const dressed = cap.lot.building._occupyProgrammed || {};
  console.log("main floors", JSON.stringify(dressed));
  const anc = cap.lot.building._occupyAnchors || {};
  const kinds = {};
  Object.keys(anc).forEach((k) => anc[k].forEach((a) => { kinds[a.kind] = (kinds[a.kind] | 0) + 1; }));
  console.log("anchors", JSON.stringify(kinds));
  if (!kinds.boss) fail("the Capitol has no principal's seat");
  // the wings
  for (const sh of shells.filter((q) => q.site === "capitol" && /Wing/.test(q.name || ""))) {
    const b = sh.b;
    const tiers = CBZ.platforms.filter((p) => p.obb && p.minX > b.ox - b.w / 2 && p.maxX < b.ox + b.w / 2 && p.minZ > b.oz - b.d / 2 && p.maxZ < b.oz + b.d / 2);
    const tops = [...new Set(tiers.map((p) => +(p.top - b.floorTops[0]).toFixed(2)))].sort();
    console.log(sh.name, "tier facets", tiers.length, "tops", JSON.stringify(tops), "void carved", !!(b.floorSlabs[0] && b.floorSlabs[0].carved));
    if (tiers.length < 60 || tops.length !== 5) fail(sh.name + " chamber tiers missing");
    if (!(b.floorSlabs[0] && b.floorSlabs[0].carved)) fail(sh.name + " gallery void not carved");
    // every tier facet's drawn top answers the walk at its centre
    let bad = 0;
    for (const p of tiers) { const g = groundAt(p.obb.cx, p.obb.cz, p.top - 0.05); if (Math.abs(g - p.top) > 0.01) bad++; }
    if (bad) fail(sh.name + " " + bad + " tier facets do not walk at their own top");
  }
}
// ---- THE FLOOR LAW over every civic shell: a low up-face with no platform
{
  let n = 0, bad = 0;
  const samples = [];
  for (const sh of shells.filter((q) => ["capitol", "cityhall", "governor"].indexOf(q.site) >= 0)) {
    const b = sh.b;
    b.group.updateMatrixWorld(true);
    const box = new THREE.Box3();
    b.group.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh) return;
      box.setFromObject(o);
      for (let k = 0; k < b.floorTops.length - 1; k++) {
        const ft = b.floorTops[k];
        if (box.min.y < ft - 0.05 || box.min.y > ft + 0.03) continue;
        const up = box.max.y - ft;
        if (up <= 0.021 || up > 0.25) continue;
        // a skirting, a strip, a flag's base: the walk law's own threshold
        // (an up-face of >= 0.15 m2 per triangle is a floor you could stand on)
        if (box.max.x - box.min.x < 0.3 || box.max.z - box.min.z < 0.3 || (box.max.x - box.min.x) * (box.max.z - box.min.z) < 0.3) continue;
        n++;
        const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
        const g = groundAt(cx, cz, ft + 0.05);
        // only when it is the TOP thing there (a counter's plinth under the
        // counter is furniture, not a floor): the first surface looking down
        const rc = new THREE.Raycaster(new THREE.Vector3(cx, ft + 1.19, cz), new THREE.Vector3(0, -1, 0), 0, 1.2);
        const hit = rc.intersectObject(b.group, true).find((q) => q.face && q.face.normal && q.object.isMesh);
        if (hit && hit.point.y > box.max.y + 0.01) continue;
        if (Math.abs(g - box.max.y) > 0.021 && !CBZ.colliders.some((c) => cx > c.minX && cx < c.maxX && cz > c.minZ && cz < c.maxZ && (c.y1 == null || c.y1 > ft + 0.1) && (c.y0 == null || c.y0 < ft + 1.2))) {
          bad++;
          if (samples.length < 8) samples.push(sh.name + " k" + k + " +" + up.toFixed(3) + " @" + (cx - b.ox).toFixed(1) + "," + (cz - b.oz).toFixed(1) + " " + (o.name || "") + " " + (o.material && o.material.color && o.material.color.getHexString()));
        }
      }
    });
  }
  console.log("\nfloor law: low up-faces", n, "without a walk surface or a solid", bad);
  if (bad) { fail(bad + " drawn surfaces 2-25 cm over a civic floor with nothing registered"); samples.forEach((s) => console.log("    " + s)); }
}
{
  const main = cap && cap.lot && cap.lot._rawMain;
  if (main && V) {
    const by = {};
    main.group.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && o.material && o.material.emissive && o.material.emissive.getHex()) { const k = (o.name || "-") + ":" + o.material.color.getHexString(); by[k] = (by[k] | 0) + 1; } });
    console.log("emissive by name:colour", JSON.stringify(by));
  }
}
// ---- the principal has a seat in City Hall and the Governor's house too
for (const id of ["cityhall", "governor"]) {
  const s2 = sites.find((q) => q.id === id);
  const anc = (s2 && s2.lot && s2.lot.building && s2.lot.building._occupyAnchors) || {};
  const kinds = {};
  Object.keys(anc).forEach((k) => anc[k].forEach((a) => { kinds[a.kind] = (kinds[a.kind] | 0) + 1; }));
  console.log(id, "floors", JSON.stringify(s2 && s2.lot && s2.lot.building && s2.lot.building._occupyProgrammed), "anchors", JSON.stringify(kinds));
  if (!kinds.boss) fail(id + " has no principal's seat");
}
// ---- NaN / runaway geometry in every civic shell (and the hyphens)
{
  let nan = 0, huge = 0;
  const box = new THREE.Box3();
  for (const sh of shells.filter((q) => ["capitol", "cityhall", "governor"].indexOf(q.site) >= 0)) {
    sh.b.group.updateMatrixWorld(true);
    sh.b.group.traverse((o) => {
      if (!o.isMesh) return;
      const a = o.geometry.attributes.position.array;
      for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) { nan++; break; }
      if (o.isInstancedMesh) return;
      box.setFromObject(o);
      const bx = box.max.x - box.min.x, bz = box.max.z - box.min.z;
      if (bx > sh.b.w + 60 || bz > sh.b.d + 60 || box.max.y > 80 || box.min.y < -1) huge++;
    });
  }
  console.log("geometry: NaN meshes", nan, "runaway boxes", huge);
  if (nan || huge) fail("bad geometry in a civic shell");
}
if (CBZ.civicInteriorAudit) console.log("civic audit", JSON.stringify(CBZ.civicInteriorAudit()));
console.log(FAIL ? "\nCAPITOL CHECK: " + FAIL + " failures" : "\nCAPITOL CHECK: clean");
process.exit(FAIL ? 1 : 0);
