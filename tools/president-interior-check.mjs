#!/usr/bin/env node
/* ============================================================
   tools/president-interior-check.mjs — THE PRESIDENT'S HOUSE, FINISHED.

   OWNER (2026-09-30): "THE INTERIOR OF IT IS TERRIBLE. IT'S LIKE A PLASTER
   OVER EVERYTHING AND GOES INTO THE DOORWAYS ETC AND LOOKS CHEAP AND UNLIKE
   THE JAIL GAME WHICH IS AMAZING REALISTIC."

   Plain node, no browser. The real buildings.js / interior_programs.js /
   furniture.js / govcomplex.js / fitout.js build the Executive Mansion and
   the West Wing in a vm (vendored three r128, engine globals stubbed), then
   the lazy fit-out of every state floor is built the way the game builds it
   when you walk in (CBZ.fitoutBuildNow), and every surface is measured:

     DOORWAYS   every opening in a state wall (a leaf door, a pair, an arch,
                the oval's passages) has a CLEAR BOX: the opening's width, the
                floor to the head, through the wall's whole thickness. Nothing
                drawn may stand in it (eager or fitted), except the door's own
                leaf and the floor finish. A casing frames the opening from
                OUTSIDE its width; a skin, a rail or a skirting that runs
                across it is exactly the owner's "goes into the doorways".
     CASED      every opening has its casing on both faces (two jambs + a
                head), standing outside the clear box and touching it.
     MATERIALS  per room, what the surfaces are made of. A state room must
                carry real finishes: textured walls (painted plaster with its
                own grain), a real floor (oak parquet / marble / carpet), wood
                panelling where the room is panelled, mouldings, and its
                ceiling. The census prints every room's surface kinds and the
                share of the room's visible area that is a FLAT colour; a room
                that is mostly flat colour is the "plaster over everything".
     CEILING    a lit room has a ceiling plane and at least one fixture whose
                light is baked (the fit-out's vertex light), never a real light.
     COST       draw calls per fitted floor (merged buckets) stay a handful.

   USAGE  node tools/president-interior-check.mjs [-v]   exit 1 on any failure
============================================================ */
import fs from "fs";
import vm from "vm";
const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const VERBOSE = process.argv.includes("-v");
const ctx = { console, Math, Date, JSON, Object, Array, Number, String, Set, Map, WeakMap, Float32Array, Uint16Array, Uint32Array, Int32Array, Uint8Array, Float64Array, ArrayBuffer, Symbol, Error, parseInt, parseFloat, isFinite, isNaN, Infinity, NaN, Proxy, Reflect, Promise, setTimeout, clearTimeout };
ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx; ctx.addEventListener = function () {}; ctx.removeEventListener = function () {};
ctx.performance = { now: () => Date.now() }; ctx.requestAnimationFrame = function () {};
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
  createElement() { return { width: 300, height: 150, style: {}, getContext() { return this._c || (this._c = ctx2d(this)); }, addEventListener() {}, toDataURL() { return ""; } }; },
  getElementById() { return null; }, querySelector() { return null; }, body: { appendChild() {} }, addEventListener() {},
};
ctx.Uint8ClampedArray = Uint8ClampedArray;
vm.createContext(ctx);
function load(rel) { vm.runInContext(fs.readFileSync(ROOT + "/" + rel, "utf8"), ctx, { filename: rel }); }
load("src/vendor/three.r128.min.js");
const THREE = ctx.THREE;
const matCache = new Map();
const CBZ = ctx.CBZ = {
  CONFIG: {}, colliders: [], platforms: [], losBlockers: [], game: { mode: "city", state: "playing" },
  cmat(c, o) { o = o || {}; const k = c + "|" + (o.emissive || 0) + "|" + (o.ei || 0); if (!matCache.has(k)) { const m = new THREE.MeshLambertMaterial({ color: c, emissive: o.emissive || 0 }); m._shared = true; matCache.set(k, m); } return matCache.get(k); },
  boxGeom(w, h, d) { return new THREE.BoxGeometry(w, h, d); },
  hash01(x, z, s) { const v = Math.sin(x * 12.9898 + z * 78.233 + (s || 0) * 0.123) * 43758.5453; return v - Math.floor(v); },
  onUpdate() {}, onAlways() {}, _lm: [], addLandmass(fn, order) { this._lm.push({ fn, order }); },
  markCollidersDirty() {}, markPlatformsDirty() {},
};
CBZ.mat = CBZ.cmat;
for (const rel of ["src/systems/stairs.js", "src/city/buildings_civic.js", "src/city/buildings.js", "src/city/fitout.js", "src/city/interior_programs.js",
  "src/city/elevators.js", "src/city/furniture.js", "src/world/roombuild.js", "src/city/govcomplex.js"]) load(rel);

let fails = 0, passes = 0;
function ok(c, m, extra) { if (c) { passes++; if (VERBOSE) console.log("  ok   " + m); } else { fails++; console.log("  FAIL " + m); if (extra && extra.length) for (const e of extra.slice(0, VERBOSE ? 60 : 10)) console.log("       " + e); } }

CBZ.registerCityRegion = function (city, r) { (city.regions = city.regions || []).push(r); return r; };
CBZ.registerNoSpawnZone = function () {};
const city = { root: new THREE.Group(), roads: [], lots: [], shopLots: [], regions: [], minX: -500, maxX: 500, minZ: -500, maxZ: 500, center: { x: 0, z: 0 } };
const oe = console.error, errs = [];
console.error = function () { errs.push([...arguments].map(String).join(" ").slice(0, 300)); };
const ow = console.warn; console.warn = function () {};
CBZ._lm.find((l) => l.order === 42).fn(city);
console.error = oe; console.warn = ow;
ok(!errs.length, "the govcomplex pass builds without errors", errs);

// ---- the president's buildings: every b a state plan drew rooms in ----------
const SR = CBZ.stateRoomsAll ? CBZ.stateRoomsAll() : [];
const blds = [];
for (const r of SR) if (r.b && blds.indexOf(r.b) < 0) blds.push(r.b);
ok(blds.length === 2, "the Mansion and the West Wing carry state rooms: " + blds.length);

// ---- the Situation Room (presidency.js builds it on the plate the plan left) --
let sitBuilt = false;
{
  const arena = { root: new THREE.Group() };
  CBZ.city = { arena };
  CBZ.scene = arena.root;
  CBZ.interactions = { registerZone() {}, registerFor() {}, describe() {} };
  CBZ.propRegisterSeat = function () {};
  try { load("src/city/presidency.js"); sitBuilt = !!(CBZ.presidency && CBZ.presidency._buildRoom && CBZ.presidency._buildRoom()); }
  catch (e) { ok(false, "presidency.js builds the Situation Room in node: " + String(e && e.message || e)); }
}
ok(sitBuilt, "the Situation Room builds headless");

// ---- the lazy fit-out of every state floor, built as walking in builds it ---
const FIT = [];       // { b, k, rec }
for (const b of blds) {
  const site = CBZ.fitoutSiteOf ? CBZ.fitoutSiteOf(b) : null;
  if (!site) { ok(false, "the fit-out knows the building"); continue; }
  for (const k in site.floors) {
    const t0 = Date.now();
    const rec = CBZ.fitoutBuildNow ? CBZ.fitoutBuildNow(b, +k) : null;
    const ms = Date.now() - t0;
    FIT.push({ b, k: +k, prog: site.floors[k].prog, rec, ms });
  }
}
if (VERBOSE) for (const f of FIT) console.log("       fit " + f.prog + "@" + f.k + " extra " + JSON.stringify((CBZ.fitoutSiteOf(f.b).floors[f.k].extra || []).map((e) => e.prog)) + " meshes " + (f.rec && f.rec.meshes ? f.rec.meshes.map((m) => m.material.name + ":" + m.geometry.attributes.position.count).join(" ") : "-"));
ok(FIT.length >= 5 && FIT.every((f) => f.rec && f.rec.group), "every state floor fits out: " + FIT.map((f) => f.prog + (f.rec && f.rec.group ? "" : "(none)")).join(" "));

const box3 = new THREE.Box3();
const hex = (m) => (m.material && m.material.color ? m.material.color.getHex().toString(16) : "?");
// every drawn TRIANGLE of a building, building-local, with what it is made
// of (a merged bucket or a facade is one mesh, so a mesh's bounds say nothing:
// the faces do). kind: the fit-out material key, a textured material's name,
// or flat#hex for a flat colour.
const _v = new THREE.Vector3();
function facesOf(b) {
  const gx = b.group.position.x, gz = b.group.position.z, out = [];
  b.group.updateWorldMatrix(true, true);
  b.group.traverse((m) => {
    if (!m.isMesh || m.visible === false) return;
    let p = m; while (p && p !== b.group) { if (p.visible === false) return; p = p.parent; }
    const fit = !!(m.parent && m.parent.userData && m.parent.userData.fitout);
    const kind = fit ? (m.material && m.material.name || "").replace("fitout:", "")
      : m.material && m.material.map ? (m.material.name || "textured") : "flat#" + hex(m);
    const g = m.geometry, pos = g.attributes.position, idx = g.index;
    const n = idx ? idx.count : pos.count;
    const P = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    // an InstancedMesh draws its geometry once per instance matrix
    const mats = [];
    if (m.isInstancedMesh) for (let i = 0; i < m.count; i++) { const im = new THREE.Matrix4(); m.getMatrixAt(i, im); mats.push(new THREE.Matrix4().multiplyMatrices(m.matrixWorld, im)); }
    else mats.push(m.matrixWorld);
    for (const MW of mats) for (let t = 0; t < n; t += 3) {
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (let j = 0; j < 3; j++) {
        const v = idx ? idx.getX(t + j) : t + j;
        _v.fromBufferAttribute(pos, v).applyMatrix4(MW);
        const x = _v.x - gx, y = _v.y, z = _v.z - gz;
        P[j][0] = x; P[j][1] = y; P[j][2] = z;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
      }
      const ax = P[1][0] - P[0][0], ay = P[1][1] - P[0][1], az = P[1][2] - P[0][2];
      const bx = P[2][0] - P[0][0], by = P[2][1] - P[0][1], bz = P[2][2] - P[0][2];
      const cxn = ay * bz - az * by, cyn = az * bx - ax * bz, czn = ax * by - ay * bx, cl = Math.hypot(cxn, cyn, czn) || 1;
      const area = 0.5 * cl;
      out.push({ x0, x1, y0, y1, z0, z1, area, kind, fit, m, nx: cxn / cl, ny: cyn / cl, nz: czn / cl,
        P: [P[0].slice(), P[1].slice(), P[2].slice()] });
    }
  });
  return out;
}

const _faces = new Map();
function facesFor(b) { if (!_faces.has(b)) _faces.set(b, facesOf(b)); return _faces.get(b); }

// ---- DOORWAYS ---------------------------------------------------------------
const OPS = CBZ.stateOpeningsAll ? CBZ.stateOpeningsAll() : [];
ok(OPS.length >= 40, "the state plans file every opening they cut: " + OPS.length);
for (const b of blds) {
  const boxes = facesFor(b);
  const mine = OPS.filter((o) => o.b === b);
  const doors = (CBZ.cityUnitDoors ? CBZ.cityUnitDoors.all() : []).filter((d) => d.b === b);
  const leaves = new Set();
  for (const d of doors) { if (d.mesh) leaves.add(d.mesh); if (d.pair && d.pair.mesh) leaves.add(d.pair.mesh); }
  const intr = [], uncased = [];
  for (const o of mine) {
    // the clear box, building-local: the opening's width less 1 cm a side,
    // 5 cm over the floor to 3 cm under the head, through the wall's thickness
    const hw = o.w / 2 - 0.01, ht = o.t / 2 + 0.04;
    const cb = o.runX
      ? { x0: o.x - hw, x1: o.x + hw, z0: o.z - ht, z1: o.z + ht }
      : { x0: o.x - ht, x1: o.x + ht, z0: o.z - hw, z1: o.z + hw };
    cb.y0 = o.floorY + 0.05; cb.y1 = o.floorY + o.h - 0.03;
    for (const a of boxes) {
      if (leaves.has(a.m)) continue;
      if (a.y1 <= cb.y0 || a.y0 >= cb.y1) continue;
      const ix = Math.min(a.x1, cb.x1) - Math.max(a.x0, cb.x0), iz = Math.min(a.z1, cb.z1) - Math.max(a.z0, cb.z0);
      if (ix > 0.004 && iz > 0.004) {
        intr.push(o.label + " (" + o.kind + " " + o.w.toFixed(2) + " m, floor " + o.floorY.toFixed(2) + ") @" + o.x.toFixed(2) + "," + o.z.toFixed(2) +
          " crossed by " + a.kind + (a.fit ? " [fit]" : "") + " " + (a.x1 - a.x0).toFixed(2) + "x" + (a.y1 - a.y0).toFixed(2) + "x" + (a.z1 - a.z0).toFixed(2) +
          " y" + (a.y0 - o.floorY).toFixed(2) + ".." + (a.y1 - o.floorY).toFixed(2) +
          (VERBOSE ? " bbox " + (function () { a.m.geometry.computeBoundingBox(); const q = a.m.geometry.boundingBox; return [q.min.x, q.max.x, q.min.y, q.max.y, q.min.z, q.max.z].map((v) => v.toFixed(1)).join(","); })() + " chain " + (function () { const n = []; let p = a.m; while (p && n.length < 6) { n.push((p.name || p.type) + "@" + [p.position.x, p.position.y, p.position.z].map((v) => v.toFixed(1)) + (p.userData && Object.keys(p.userData).length ? JSON.stringify(Object.keys(p.userData)) : "")); p = p.parent; } return n.join("<"); })() : "") +
          (VERBOSE ?  " mesh " + (a.m.name || "") + " geo " + a.m.geometry.type + "/" + (a.m.geometry.name || "") + " mat " + a.m.material.type + "/" + (a.m.material.name || "") + " ud " + JSON.stringify(Object.keys(a.m.userData || {})) + " pos " + [a.m.position.x, a.m.position.y, a.m.position.z].map((v) => v.toFixed(2)) + " scl " + [a.m.scale.x, a.m.scale.y, a.m.scale.z].map((v) => v.toFixed(2)) + " rotY " + a.m.rotation.y.toFixed(2) + " verts " + a.m.geometry.attributes.position.count : ""));
        break;
      }
    }
    // cased: something stands against each jamb, on both faces, outside the box
    if (o.cased) {
      let jambs = 0;
      for (const s of [-1, 1]) for (const e of [-1, 1]) {
        const jx = o.runX ? o.x + e * (o.w / 2 + 0.03) : o.x + s * (o.t / 2 + 0.02);
        const jz = o.runX ? o.z + s * (o.t / 2 + 0.02) : o.z + e * (o.w / 2 + 0.03);
        if (boxes.some((a) => a.x0 <= jx + 0.02 && a.x1 >= jx - 0.02 && a.z0 <= jz + 0.02 && a.z1 >= jz - 0.02 && a.y0 <= o.floorY + 1.0 && a.y1 >= o.floorY + 1.6)) jambs++;
      }
      if (jambs < 4) uncased.push(o.label + " @" + o.x.toFixed(2) + "," + o.z.toFixed(2) + " jambs " + jambs + "/4");
    }
  }
  const tag = b === blds[0] ? "Mansion" : "West Wing";
  ok(!intr.length, tag + ": nothing stands in any doorway (" + intr.length + " of " + mine.length + " openings crossed)", intr);
  ok(!uncased.length, tag + ": every opening is cased on both faces (" + uncased.length + ")", uncased);
}

// ---- MATERIALS, per room ------------------------------------------------------
// What you SEE in a room: every face drawn there, less the eager faces a
// fitted finish lies over (a skin 6 mm off a flat wall, a parquet floor 3 mm
// over a flat field). A flat face counts as covered where a fitted face of
// the same facing lies 0.5-45 mm in front of it at that point (sampled at the
// centroid and three inner points of every triangle).
function inTri(T, x, y, z) {
  const A = T.P[0], B = T.P[1], C = T.P[2];
  const v0x = C[0] - A[0], v0y = C[1] - A[1], v0z = C[2] - A[2], v1x = B[0] - A[0], v1y = B[1] - A[1], v1z = B[2] - A[2];
  const v2x = x - A[0], v2y = y - A[1], v2z = z - A[2];
  const d00 = v0x * v0x + v0y * v0y + v0z * v0z, d01 = v0x * v1x + v0y * v1y + v0z * v1z, d11 = v1x * v1x + v1y * v1y + v1z * v1z;
  const d02 = v0x * v2x + v0y * v2y + v0z * v2z, d12 = v1x * v2x + v1y * v2y + v1z * v2z;
  const inv = 1 / (d00 * d11 - d01 * d01 || 1e-12), u = (d11 * d02 - d01 * d12) * inv, v = (d00 * d12 - d01 * d02) * inv;
  return u >= -1e-3 && v >= -1e-3 && u + v <= 1.001;
}
const CELL = 1.0;
const fitGrid = new Map();
function fitIndex(b) {
  if (fitGrid.has(b)) return fitGrid.get(b);
  const G = new Map();
  for (const t of facesFor(b)) {
    if (!t.fit) continue;
    for (let gx = Math.floor(t.x0 / CELL); gx <= Math.floor(t.x1 / CELL); gx++)
      for (let gz = Math.floor(t.z0 / CELL); gz <= Math.floor(t.z1 / CELL); gz++) {
        const k = gx + "," + gz; let L = G.get(k); if (!L) G.set(k, L = []); L.push(t);
      }
  }
  fitGrid.set(b, G);
  return G;
}
function covered(b, t, x, y, z) {
  const L = fitIndex(b).get(Math.floor((x + t.nx * 0.02) / CELL) + "," + Math.floor((z + t.nz * 0.02) / CELL));
  if (!L) return false;
  for (const f of L) {
    if (f.nx * t.nx + f.ny * t.ny + f.nz * t.nz < 0.98) continue;
    const dd = (f.P[0][0] - x) * t.nx + (f.P[0][1] - y) * t.ny + (f.P[0][2] - z) * t.nz;
    if (dd < 0.0005 || dd > 0.045) continue;
    if (inTri(f, x + t.nx * dd, y + t.ny * dd, z + t.nz * dd)) return true;
  }
  return false;
}
const ROOMS = SR;
const census = [];
for (const r of ROOMS) {
  const b = r.b;
  // the room's own volume: over its finished floor, under its finished
  // ceiling (a slab's faces inside the floor or above the ceiling are nobody's)
  const kk = b.floorTops.reduce((bi, t, i) => (Math.abs(t - r.floorY) < Math.abs(b.floorTops[bi] - r.floorY) ? i : bi), 0);
  const ceilY = (b.floorTops[kk + 1] != null ? b.floorTops[kk + 1] : r.floorY + b.FH) - 0.2;
  const tris = facesFor(b).filter((a) => {
    const cx = (a.P[0][0] + a.P[1][0] + a.P[2][0]) / 3, cz = (a.P[0][2] + a.P[1][2] + a.P[2][2]) / 3;
    if (!(cx > r.x0 - b.ox - 0.005 && cx < r.x1 - b.ox + 0.005 && cz > r.z0 - b.oz - 0.005 && cz < r.z1 - b.oz + 0.005)) return false;
    const cy = (a.P[0][1] + a.P[1][1] + a.P[2][1]) / 3;
    if (cy < r.floorY + 0.0155 || cy > ceilY - 0.0115) return false;
    // a stair (the grand stair's well, the service core) is measured on its own
    for (const h of (b.shaftRects || [])) if (cx > h.x0 && cx < h.x1 && cz > h.z0 && cz < h.z1) return false;
    return true;
  });
  const area = Object.create(null);
  let tot = 0, flat = 0;
  for (const a of tris) {
    let s = a.area;
    if (!a.fit) {
      // the eager face: how much of it still shows through the finish
      const c = [(a.P[0][0] + a.P[1][0] + a.P[2][0]) / 3, (a.P[0][1] + a.P[1][1] + a.P[2][1]) / 3, (a.P[0][2] + a.P[1][2] + a.P[2][2]) / 3];
      const pts = [c].concat(a.P.map((v) => [(c[0] + v[0]) / 2, (c[1] + v[1]) / 2, (c[2] + v[2]) / 2]));
      let hid = 0;
      for (const q of pts) if (covered(b, a, q[0], q[1], q[2])) hid++;
      s *= 1 - hid / pts.length;
      if (s <= 0) continue;
    }
    const k = a.kind.indexOf("flat#") === 0 || a.kind === "flat" ? "flat" : a.kind;
    area[k] = (area[k] || 0) + s; tot += s;
    if (k === "flat") flat += s;
  }
  const kinds = Object.keys(area).filter((k) => k !== "flat" && k !== "glow" && k !== "glass").sort((p, q) => area[q] - area[p]);
  census.push({ key: r.key, kinds, area, tot, flatShare: tot ? flat / tot : 1 });
}
// furniture is flat-coloured by design (the kit's pieces, sat on and slept in);
// what may not be flat is the ROOM: walls, floors, joinery, ceiling
// THE SITUATION ROOM: walnut veneer panelling, a fabric acoustic band, carpet,
// an acoustic tile ceiling — measured in the fitted floor over its plate
{
  const site = CBZ.govComplexes.find((q) => q.id === "execmansion");
  const mb = blds.find((b) => b._sitRoom) || (site && site.lot && site.lot.building);
  const R = mb && mb._sitRoom;
  const area = Object.create(null);
  if (R) for (const t of facesFor(blds.find((b) => b.ox === mb.ox && b.oz === mb.oz) || mb)) {
    if (!t.fit) continue;
    const cx = (t.P[0][0] + t.P[1][0] + t.P[2][0]) / 3 + mb.ox, cz = (t.P[0][2] + t.P[1][2] + t.P[2][2]) / 3 + mb.oz;
    const cy = (t.P[0][1] + t.P[1][1] + t.P[2][1]) / 3;
    if (cx < R.minX || cx > R.maxX || cz < R.minZ || cz > R.maxZ || cy < R.y - 0.01 || cy > R.ceil + 0.01) continue;
    area[t.kind] = (area[t.kind] || 0) + t.area;
  }
  ok(area.veneer > 20 && area.carpet > 20 && area.ceiling > 20 && area.fabric > 4,
    "the Situation Room is panelled in walnut, carpeted, under an acoustic ceiling: " + Object.keys(area).map((k) => k + " " + area[k].toFixed(0) + " m2").join(", "));
}
// THE GRAND STAIR is the house's showpiece: marble treads and risers, a runner
{
  const mb = blds.find((b) => b.shaftRects && b.shaftRects.some((h) => h.levels && h.levels.indexOf(1) >= 0));
  const well = mb && mb.shaftRects.find((h) => h.levels && h.levels.indexOf(1) >= 0);
  let marble = 0, rug = 0;
  if (well) for (const t of facesFor(mb)) {
    if (!t.fit) continue;
    const cx = (t.P[0][0] + t.P[1][0] + t.P[2][0]) / 3, cz = (t.P[0][2] + t.P[1][2] + t.P[2][2]) / 3;
    if (cx < well.x0 - 0.5 || cx > well.x1 + 0.5 || cz < well.z0 - 0.5 || cz > well.z1 + 0.5) continue;
    if (t.kind === "marble") marble += t.area; else if (t.kind === "rug") rug += t.area;
  }
  ok(marble > 20 && rug > 8, "the grand stair is laid in veined marble with a woven runner: marble " + marble.toFixed(1) + " m2, runner " + rug.toFixed(1) + " m2");
}
const bad = census.filter((c) => c.flatShare > 0.35 || c.kinds.length < 3);
for (const c of census) if (VERBOSE || bad.indexOf(c) >= 0)
  console.log("       " + c.key.padEnd(16) + " flat " + (c.flatShare * 100).toFixed(0).padStart(3) + "%  " + c.kinds.map((k) => k + " " + (100 * c.area[k] / c.tot).toFixed(0) + "%").join(", "));
ok(!bad.length, "every state room shows real finishes (<=35% of its visible area flat colour, >=3 textured kinds): " + (census.length - bad.length) + "/" + census.length);
{
  const miss = census.filter((c) => c.kinds.indexOf("plaster") < 0).map((c) => c.key);
  ok(!miss.length, "every room's walls are painted plaster (" + miss.length + ")", miss);
  const nofloor = census.filter((c) => !["marble", "parquet", "carpet", "tile"].some((n) => c.kinds.indexOf(n) >= 0)).map((c) => c.key);
  ok(!nofloor.length, "every room has a laid floor: marble, parquet, carpet or tile (" + nofloor.length + ")", nofloor);
  const joinery = census.filter((c) => c.kinds.indexOf("paint") < 0 && c.kinds.indexOf("veneer") < 0).map((c) => c.key);
  ok(!joinery.length, "every room has its joinery: skirting, casings, cornice (" + joinery.length + ")", joinery);
  const panelled = census.filter((c) => c.kinds.indexOf("veneer") >= 0).length;
  ok(panelled >= 8, "wood panelling, bookcases and veneered joinery in the offices and libraries: " + panelled + " rooms");
}

// ---- CEILINGS + LIGHT + COST --------------------------------------------------
for (const f of FIT) {
  if (!f.rec || !f.rec.group) continue;
  const tag = f.prog + "@" + f.k;
  ok(f.rec.lights >= 2, tag + ": fixtures with baked light: " + f.rec.lights);
  ok(f.rec.meshes.length <= 14, tag + ": merged into a handful of draw calls (one per material): " + f.rec.meshes.length);
  const verts = f.rec.meshes.reduce((n, m) => n + m.geometry.attributes.position.count, 0);
  // one floor is built per fit-out tick as you approach: it must stay a frame-sized job
  ok(verts < 160000, tag + ": " + verts + " vertices, built in " + f.ms + " ms (node, one floor per tick)");
  const kinds = f.rec.meshes.map((m) => (m.material.name || "").replace("fitout:", ""));
  ok(kinds.indexOf("plaster") >= 0, tag + ": a plaster skin and ceiling: " + kinds.join(","));
}

console.log(census.length + " rooms, " + OPS.length + " openings, " + FIT.length + " fitted floors");
console.log("PRESIDENT-INTERIOR: " + (fails ? "FAIL" : "OK") + " " + passes + " passed, " + fails + " failed");
process.exit(fails ? 1 : 0);
