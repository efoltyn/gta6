#!/usr/bin/env node
/* ============================================================
   tools/president-rooms-check.mjs — THE PRESIDENT'S HOUSE, MEASURED.

   OWNER (President mode, iPad): "your feet go underground ... that building
   is so low quality for the president game". Plain node, no browser: the
   real buildings.js / interior_programs.js / furniture.js / govcomplex.js
   build the Executive Mansion and the West Wing in a vm (vendored three
   r128, engine globals stubbed), every box the five state-room programs
   draw is captured, and:

     FLOOR LAW   no wide box tops out between 2.1 and 25 cm over its floor
                 unless a registered walk platform carries it (a rug is 2 cm)
     SUNK        nothing drawn below its floor top
     CEILING     nothing drawn above its ceiling (the next slab's underside)
     STAIR       nothing but floor finish inside the grand stair or the core
     CLIP        no loose piece standing inside a wall
     DOORS       every state door opens onto a clear doorway (nothing in the
                 leaf's path either side), and the door is filed with the
                 unit-door registry as free (E opens it)
     ROOMS       the rooms and landmarks the office / staff / protection
                 code hangs on exist (ovaloffice: desk, portal, spots, tv)
     SIT ROOM    presidency.js builds the Situation Room on the floor top,
                 its carpet under the 2 cm law, snapped to the facade

   USAGE  node tools/president-rooms-check.mjs [-v]    exit 1 on any failure
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
const upd = [];
const CBZ = ctx.CBZ = {
  CONFIG: {}, colliders: [], platforms: [], losBlockers: [], game: { mode: "city", state: "playing" },
  cmat(c, o) { o = o || {}; const k = c + "|" + (o.emissive || 0) + "|" + (o.ei || 0); if (!matCache.has(k)) { const m = new THREE.MeshLambertMaterial({ color: c, emissive: o.emissive || 0 }); m._shared = true; matCache.set(k, m); } return matCache.get(k); },
  boxGeom(w, h, d) { return new THREE.BoxGeometry(w, h, d); },
  hash01(x, z, s) { const v = Math.sin(x * 12.9898 + z * 78.233 + (s || 0) * 0.123) * 43758.5453; return v - Math.floor(v); },
  onUpdate(o, fn) { upd.push(fn); }, onAlways() {}, _lm: [], addLandmass(fn, order) { this._lm.push({ fn, order }); },
  markCollidersDirty() {}, markPlatformsDirty() {},
};
CBZ.mat = CBZ.cmat;
for (const rel of ["src/systems/stairs.js", "src/city/buildings_civic.js", "src/city/buildings.js", "src/city/interior_programs.js",
  "src/city/elevators.js", "src/city/furniture.js", "src/world/roombuild.js", "src/city/govcomplex.js"]) load(rel);

let fails = 0, passes = 0;
const notes = [];
function ok(c, m, extra) { if (c) passes++; else { fails++; console.log("  FAIL " + m); if (extra && extra.length) for (const e of extra.slice(0, VERBOSE ? 40 : 8)) console.log("       " + e); } }

// ---- capture every box the state programs draw ----------------------------
const STATE = new Set(["statehall", "stateresidence", "stateprivate", "cabinetroom", "ovaloffice"]);
const runs = [];
const orig = CBZ.interiorProgram;
CBZ.interiorProgram = function (name, room, c) {
  const b = c && c.b;
  if (!STATE.has(name) || !b || !b.group) return orig.apply(this, arguments);
  const kids0 = b.group.children.length, cols0 = CBZ.colliders.length, plats0 = CBZ.platforms.length;
  const out = orig.apply(this, arguments);
  let Y = room.y || 0;
  if (Y < 0.1 && Array.isArray(b.floorTops)) Y = b.floorTops[0];
  let k = 0, bd = 1e9;
  for (let i = 0; i < b.floorTops.length; i++) { const q = Math.abs(b.floorTops[i] - Y); if (q < bd) { bd = q; k = i; } }
  const ceil = (b.floorTops[k + 1] != null ? b.floorTops[k + 1] : Y + b.FH) - 0.2;
  runs.push({ name, b, Y, k, ceil, meshes: b.group.children.slice(kids0).filter((m) => m.isMesh), cols: CBZ.colliders.slice(cols0), plats: CBZ.platforms.slice(plats0), out });
  return out;
};
CBZ.registerCityRegion = function (city, r) { (city.regions = city.regions || []).push(r); return r; };
CBZ.registerNoSpawnZone = function () {};
const city = { root: new THREE.Group(), roads: [], lots: [], shopLots: [], regions: [], minX: -500, maxX: 500, minZ: -500, maxZ: 500, center: { x: 0, z: 0 } };
const oe = console.error, errs = [];
console.error = function () { errs.push([...arguments].map(String).join(" ").slice(0, 300)); };
const ow = console.warn; console.warn = function () {};
CBZ._lm.find((l) => l.order === 42).fn(city);
console.error = oe; console.warn = ow;
ok(!errs.length, "the govcomplex pass builds without errors", errs);
ok(runs.length === 5, "all five state programs ran: " + runs.map((r) => r.name).join(" "));

const box3 = new THREE.Box3();
function aabb(m) {
  m.updateWorldMatrix(true, false);
  if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
  box3.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld);
  // bgroup is at the building's local frame: convert to building-local x/z
  return { x0: box3.min.x, x1: box3.max.x, y0: box3.min.y, y1: box3.max.y, z0: box3.min.z, z1: box3.max.z };
}
const hex = (m) => m.material && m.material.color ? m.material.color.getHex().toString(16) : "?";
const ov = (a, b, e) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > (e || 0) && Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0) > (e || 0);

for (const R of runs) {
  const b = R.b, Y = R.Y, tag = R.name;
  const gx = b.group.position ? b.group.position.x : 0, gz = b.group.position ? b.group.position.z : 0;
  // the lead's shell() (floor covering 0x33373f, ceiling strip 0xeef2ff) is not this plan's
  const SHELL = new Set(["33373f", "eef2ff"]);
  const boxes = R.meshes.filter((m) => m.visible !== false && !SHELL.has(hex(m))).map((m) => { const a = aabb(m); a.m = m; a.rot = Math.abs(m.rotation.y) > 1e-4; a.x0 -= gx; a.x1 -= gx; a.z0 -= gz; a.z1 -= gz; return a; });
  const plats = CBZ.platforms.filter((p) => Math.abs(p.top - Y) < 1.0);
  const lx = (x) => x - b.ox, lz = (z) => z - b.oz;
  // FLOOR LAW
  const law = [];
  for (const a of boxes) {
    if (a.rot) continue;
    const top = a.y1 - Y, w = a.x1 - a.x0, d = a.z1 - a.z0;
    if (a.y0 - Y > 0.03 || top <= 0.021 || top > 0.25 || Math.min(w, d) < 0.25) continue;
    const cx = (a.x0 + a.x1) / 2 + b.ox, cz = (a.z0 + a.z1) / 2 + b.oz;
    const carried = plats.some((p) => cx >= p.minX && cx <= p.maxX && cz >= p.minZ && cz <= p.maxZ && p.top >= a.y1 - 0.012);
    // only the TOPMOST surface is walked on: a plinth under a carcass is not a floor
    const lcx = (a.x0 + a.x1) / 2, lcz = (a.z0 + a.z1) / 2;
    const covered = boxes.some((o) => o !== a && o.y0 <= a.y1 + 0.012 && o.y1 > a.y1 + 0.01 &&
      o.x0 <= a.x0 + 0.02 && o.x1 >= a.x1 - 0.02 && o.z0 <= a.z0 + 0.02 && o.z1 >= a.z1 - 0.02);
    if (!carried && !covered) law.push(hex(a.m) + " top+" + top.toFixed(3) + " " + w.toFixed(2) + "x" + d.toFixed(2) + " @" + ((a.x0 + a.x1) / 2).toFixed(1) + "," + ((a.z0 + a.z1) / 2).toFixed(1));
  }
  ok(!law.length, tag + ": FLOOR LAW, no wide finish 2.1-25 cm over the floor (" + law.length + ")", law);
  const sunk = boxes.filter((a) => a.y0 < Y - 0.006).map((a) => hex(a.m) + " y0 " + (a.y0 - Y).toFixed(3) + " @" + ((a.x0 + a.x1) / 2).toFixed(1) + "," + ((a.z0 + a.z1) / 2).toFixed(1));
  ok(!sunk.length, tag + ": nothing drawn under the floor top (" + sunk.length + ")", sunk);
  const high = boxes.filter((a) => a.y1 > R.ceil + 0.006).map((a) => hex(a.m) + " y1 " + (a.y1 - R.ceil).toFixed(3) + " over the ceiling @" + ((a.x0 + a.x1) / 2).toFixed(1) + "," + ((a.z0 + a.z1) / 2).toFixed(1));
  ok(!high.length, tag + ": nothing drawn into the slab above (" + high.length + ")", high);
  // STAIR / CORE: only floor finishes may cover a reserved hole that is open on this storey
  const holes = (b.shaftRects || []).filter((h) => !h.levels || h.levels.indexOf(R.k) >= 0 || (R.k === 0 && h.levels));
  const inHole = [];
  for (const a of boxes) {
    if (a.y1 - Y <= 0.021) continue;
    for (const h of holes) if (ov(a, { x0: h.x0 + 0.02, x1: h.x1 - 0.02, z0: h.z0 + 0.02, z1: h.z1 - 0.02 }, 0.02)) { inHole.push(hex(a.m) + " in " + JSON.stringify([+h.x0.toFixed(1), +h.x1.toFixed(1), +h.z0.toFixed(1), +h.z1.toFixed(1)]) + " y " + (a.y0 - Y).toFixed(2) + ".." + (a.y1 - Y).toFixed(2) + " box " + [a.x0, a.x1, a.z0, a.z1].map((v) => v.toFixed(2)).join(",")); break; }
  }
  ok(!inHole.length, tag + ": nothing stands in the stair or the core (" + inHole.length + ")", inHole);
  // CLIP: loose pieces vs walls (tall solid colliders this program made)
  // walls = full-height solid partitions, piers and cheeks (plaster, stone, cream);
  // a bookcase is furniture against a wall, not one
  const WALLC = new Set(["e9e4da", "d9d5cc", "f1ece0"]);
  const walls = R.cols.filter((c) => c.ref && (c.y1 - c.y0) > 2.3 && WALLC.has(hex(c.ref)) && !(c.ref.rotation && Math.abs(c.ref.rotation.y) > 1e-4))
    .map((c) => ({ x0: c.minX - b.ox, x1: c.maxX - b.ox, z0: c.minZ - b.oz, z1: c.maxZ - b.oz, y0: c.y0, y1: c.y1, ref: c.ref }));
  const wallRefs = new Set(walls.map((w) => w.ref));
  const clip = [];
  for (const a of boxes) {
    if (a.rot || wallRefs.has(a.m) || a.y1 - Y <= 0.021) continue;
    for (const w of walls) {
      const ix = Math.min(a.x1, w.x1) - Math.max(a.x0, w.x0), iz = Math.min(a.z1, w.z1) - Math.max(a.z0, w.z0), iy = Math.min(a.y1, w.y1) - Math.max(a.y0, w.y0);
      if (ix > 0.03 && iz > 0.03 && iy > 0.02) { clip.push(hex(a.m) + " " + (a.x1 - a.x0).toFixed(2) + "x" + (a.z1 - a.z0).toFixed(2) + " y" + (a.y0 - Y).toFixed(2) + ".." + (a.y1 - Y).toFixed(2) + " in a wall @" + ((a.x0 + a.x1) / 2).toFixed(2) + "," + ((a.z0 + a.z1) / 2).toFixed(2) + " wall " + [w.x0, w.x1, w.z0, w.z1].map((v) => v.toFixed(2)).join(",")); break; }
    }
  }
  ok(!clip.length, tag + ": no piece inside a wall (" + clip.length + ")", clip);
  // FLOATERS: every box reaches the floor, the ceiling, a wall or the shell
  // through a chain of boxes that touch (a chandelier hangs from its rose,
  // a painting from its wall, a cushion sits on its sofa)
  {
    const wt = b.wt != null ? b.wt : 0.4;
    const S = { x0: -b.w / 2 + wt, x1: b.w / 2 - wt, z0: -b.d / 2 + wt, z1: b.d / 2 - wt };
    // a potted tree's leaves hang round its trunk by design (furniture.js)
    const LEAF = new Set(["3f7a45", "5a8f4a", "2f6338", "5a4632"]);
    const all = boxes.filter((a) => !LEAF.has(hex(a.m))).map((a) => ({ a, ok: false }));
    const near = (p, q, e) => p.x0 <= q.x1 + e && p.x1 >= q.x0 - e && p.z0 <= q.z1 + e && p.z1 >= q.z0 - e && p.y0 <= q.y1 + e && p.y1 >= q.y0 - e;
    const solids = R.cols.filter((c) => (c.y1 - c.y0) > 2.3).map((c) => ({ x0: c.minX - b.ox, x1: c.maxX - b.ox, z0: c.minZ - b.oz, z1: c.maxZ - b.oz, y0: c.y0, y1: c.y1 }));
    // the stair core's and the lead's partitions are walls too (colliders made before this program)
    for (const c of CBZ.colliders) if ((c.y1 - c.y0) > 2.0 && Math.abs(c.minX - b.ox) < b.w && Math.abs(c.minZ - b.oz) < b.d && c.y0 < R.ceil && c.y1 > Y) solids.push({ x0: c.minX - b.ox, x1: c.maxX - b.ox, z0: c.minZ - b.oz, z1: c.maxZ - b.oz, y0: c.y0, y1: c.y1 });
    // the Situation Room's walls are presidency.js's (built at run time on b._sitRoom)
    if (b._sitRoom && R.k === 0) { const q = b._sitRoom; solids.push({ x0: q.minX - b.ox, x1: q.maxX - b.ox, z0: q.minZ - b.oz, z1: q.maxZ - b.oz, y0: Y, y1: R.ceil }); }
    for (const n of all) {
      const a = n.a;
      if (a.y0 <= Y + 0.03 || a.y1 >= R.ceil - 0.025) n.ok = true;
      else if (a.x0 <= S.x0 + 0.06 || a.x1 >= S.x1 - 0.06 || a.z0 <= S.z0 + 0.06 || a.z1 >= S.z1 - 0.06) n.ok = true;
      else if (solids.some((w) => near(a, w, 0.03))) n.ok = true;
    }
    for (let pass = 0, grew = true; grew && pass < 40; pass++) {
      grew = false;
      for (const n of all) if (!n.ok && all.some((m) => m.ok && m !== n && near(n.a, m.a, 0.035))) { n.ok = true; grew = true; }
    }
    const fl = all.filter((n) => !n.ok).map((n) => hex(n.a.m) + " " + (n.a.x1 - n.a.x0).toFixed(2) + "x" + (n.a.z1 - n.a.z0).toFixed(2) + " y" + (n.a.y0 - Y).toFixed(2) + ".." + (n.a.y1 - Y).toFixed(2) + " @" + ((n.a.x0 + n.a.x1) / 2).toFixed(2) + "," + ((n.a.z0 + n.a.z1) / 2).toFixed(2));
    ok(!fl.length, tag + ": nothing floats (" + fl.length + ")", fl);
  }
  // PIECES IN PIECES: two solid pieces standing in each other (a sofa in a
  // table, a chair in a bookcase). Colliders of one piece never overlap.
  {
    const own = R.cols.filter((c) => (c.y1 - c.y0) <= 2.3 && (c.y1 - c.y0) > 0.05 && c.ref && !(c.ref.rotation && Math.abs(c.ref.rotation.y) > 1e-4));
    const bad = [];
    for (let i = 0; i < own.length; i++) for (let j = i + 1; j < own.length; j++) {
      const p = own[i], q = own[j];
      const ix = Math.min(p.maxX, q.maxX) - Math.max(p.minX, q.minX), iz = Math.min(p.maxZ, q.maxZ) - Math.max(p.minZ, q.minZ), iy = Math.min(p.y1, q.y1) - Math.max(p.y0, q.y0);
      if (ix > 0.04 && iz > 0.04 && iy > 0.04) bad.push(hex(p.ref) + " & " + hex(q.ref) + " " + ix.toFixed(2) + "x" + iz.toFixed(2) + " @" + ((p.minX + p.maxX) / 2 - b.ox).toFixed(1) + "," + ((p.minZ + p.maxZ) / 2 - b.oz).toFixed(1));
    }
    ok(!bad.length, tag + ": no two solid pieces stand in each other (" + bad.length + ")", bad);
  }
  // DOORS
  const doors = (CBZ.cityUnitDoors ? CBZ.cityUnitDoors.all() : []).filter((d) => d.free && Math.abs(d.floorY - Y) < 0.05 && Math.abs(d.x - b.ox) < b.w / 2 && Math.abs(d.z - b.oz) < b.d / 2);
  const blocked = [];
  for (const d of doors) {
    const lm = d.mesh, alongX = lm.scale.x > lm.scale.z, w = alongX ? lm.scale.x : lm.scale.z;
    const cxl = lx(d.x), czl = lz(d.z);
    const zone = alongX ? { x0: cxl - w / 2 + 0.05, x1: cxl + w / 2 - 0.05, z0: czl - 0.95, z1: czl + 0.95 } : { x0: cxl - 0.95, x1: cxl + 0.95, z0: czl - w / 2 + 0.05, z1: czl + w / 2 - 0.05 };
    for (const a of boxes) {
      if (a.m === d.mesh || a.m === d.openMesh || a.y1 - Y <= 0.021 || a.y0 - Y > 1.9) continue;
      if (ov(a, zone, 0.01)) { blocked.push(d.label + " @" + cxl.toFixed(1) + "," + czl.toFixed(1) + " blocked by " + hex(a.m) + " " + (a.x1 - a.x0).toFixed(2) + "x" + (a.z1 - a.z0).toFixed(2) + " y" + (a.y0 - Y).toFixed(2) + " @" + ((a.x0 + a.x1) / 2).toFixed(2) + "," + ((a.z0 + a.z1) / 2).toFixed(2)); break; }
    }
  }
  ok(doors.length >= 3, tag + ": state doors filed free with the unit-door registry: " + doors.length);
  ok(!blocked.length, tag + ": every doorway is clear both sides (" + blocked.length + ")", blocked);
  ok(doors.every((d) => d.openMesh && d.openMesh.visible === false && d.col), tag + ": every door has a collider and a hidden open leaf");
  // the plan's own rooms went to the fit-out (ceiling + baked light)
  const fit = R.out && R.out.fit;
  ok(fit && fit.rooms && fit.rooms.length >= 3 && fit.lights && fit.lights.length >= 2, tag + ": ceilings and light sources handed to the fit-out: " + (fit ? fit.rooms.length + " rooms, " + fit.lights.length + " lights" : "none"));
  notes.push(tag + " y" + Y.toFixed(2) + " ceil+" + (R.ceil - Y).toFixed(2) + " boxes " + boxes.length + " doors " + doors.length + " walls " + walls.length);
}

// ---- ROOMS the rest of the President's code hangs on -----------------------
const rooms = CBZ.presidentInteriorRooms();
const byKey = {};
for (const r of rooms) byKey[r.key] = r;
for (const k of ["statehall", "stateresidence", "stateprivate", "cabinetroom", "pressroom", "ovaloffice", "statedining", "familysalon", "privatesuite"]) ok(!!byKey[k], "room on the ledger: " + k);
const O = byKey.ovaloffice;
if (O) {
  for (const k of ["presidentialDesk", "arrivalPortal", "throne", "tv", "tvBack", "staffDoor", "chiefSpot", "line0", "line1", "line2", "pressSpot", "secretaryPost", "securePhone", "pardonFolder", "fireplace", "visitorTable"])
    ok(!!O.landmarks[k], "ovaloffice landmark " + k);
  const A = O.approach, d = O.landmarks.presidentialDesk, t = O.landmarks.throne;
  // president_office.js seats you at desk + n * THRONE_BACK
  ok(A && Math.hypot(d.x + A.nx * 1.12 - t.x, d.z + A.nz * 1.12 - t.z) < 0.05, "the chair is where the office code will seat you (desk + n*1.12)");
  ok(Math.abs(A.nx * A.tx + A.nz * A.tz) < 1e-6 && Math.abs(Math.hypot(A.nx, A.nz) - 1) < 1e-6, "the office frame is orthonormal");
  // the people's spots stand inside the oval, clear of each other
  const inside = (p) => { const lx2 = -((p.x - A.x) * A.tx + (p.z - A.z) * A.tz), lz2 = (p.x - A.x) * A.nx + (p.z - A.z) * A.nz; const a = A.depth / 2, bb = A.span / 2; return ((lz2 - a) / a) ** 2 + (lx2 / bb) ** 2 < 0.9; };
  for (const k of ["chiefSpot", "line0", "line1", "line2", "pressSpot", "staffDoor"]) ok(inside(O.landmarks[k]), "ovaloffice " + k + " stands inside the oval");
  ok(Math.abs(O.floorY - 4.2) < 0.3 && O.deskTop > 0.7 && O.deskTop < 0.8, "the office floor and desk height: floor " + O.floorY + " top " + O.deskTop);
  const seat = (CBZ.propSeatsNear ? null : null);
}
// the browser check's baseline (tools/president-check.mjs §7): never fewer rooms, seats, symbols
{
  const ia = CBZ.presidentInteriorAudit();
  ok((ia.namedRooms | 0) >= 6 && (ia.usableProps | 0) >= 56 && (ia.stateSymbols | 0) >= 13,
    "the house did not regress: rooms " + ia.namedRooms + " usable " + ia.usableProps + " symbols " + ia.stateSymbols);
}
const P = byKey.pressroom;
ok(P && P.landmarks.podium && P.landmarks.podium.y > P.floorY + 0.3, "the podium stands on the registered dais");
ok(CBZ.presidentInteriorPressPoints().length >= 3, "the press corps has places in the briefing room: " + CBZ.presidentInteriorPressPoints().length);

// ---- THE SITUATION ROOM (presidency.js) -------------------------------------
{
  const site = CBZ.govComplexes.find((s) => s.id === "execmansion");
  const mb = site && site.lot && site.lot.building;
  ok(!!(mb && mb._sitRoom), "the state floor reserves the Situation Room's plate for presidency.js", []);
  const arena = { root: new THREE.Group() };
  CBZ.city = { arena };
  CBZ.scene = arena.root;
  CBZ.interactions = { registerZone(z) { (CBZ._zones = CBZ._zones || []).push(z); }, registerFor() {}, describe() {} };
  CBZ.propRegisterSeat = function () {};
  try { load("src/city/presidency.js"); } catch (e) { ok(false, "presidency.js loads in node: " + e.message); }
  const PZ = CBZ.presidency;
  let built = false;
  try { built = !!(PZ && PZ._buildRoom && PZ._buildRoom()); } catch (e) { ok(false, "the Situation Room builds: " + e.stack.split("\n").slice(0, 3).join(" | ")); }
  ok(built, "the Situation Room builds headless");
  if (built && mb) {
    const Y = mb.floorTops[0];
    const grp = PZ._room.group;
    const bad = [], under = [];
    grp.traverse((m) => {
      if (!m.isMesh || m.visible === false) return;
      const a = aabb(m);
      if (a.y0 < Y - 0.006) under.push(hex(m) + " y0 " + (a.y0 - Y).toFixed(3));
      const top = a.y1 - Y, w = a.x1 - a.x0, d = a.z1 - a.z0;
      if (a.y0 - Y < 0.03 && top > 0.021 && top <= 0.25 && Math.min(w, d) > 0.25) bad.push(hex(m) + " top+" + top.toFixed(3) + " " + w.toFixed(2) + "x" + d.toFixed(2));
    });
    ok(!bad.length, "Situation Room: FLOOR LAW (" + bad.length + ")", bad);
    ok(!under.length, "Situation Room: nothing under the floor (" + under.length + ")", under);
    const PIp = process.argv.indexOf("--plan");
    if (PIp > 0 && process.argv[PIp + 1]) {
      const r0 = PZ._room.rect, Sc = 40, pad = 1;
      const W = (r0.maxX - r0.minX + 2 * pad) * Sc, H = (r0.maxZ - r0.minZ + 2 * pad) * Sc;
      const list = [];
      grp.traverse((m) => { if (m.isMesh && m.visible !== false) { const a = aabb(m); a.m = m; if (a.y0 < Y + 2.2) list.push(a); } });
      list.sort((p, q) => p.y1 - q.y1);
      let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '"><rect width="100%" height="100%" fill="#777"/>';
      for (const a of list) svg += '<rect x="' + (a.x0 - r0.minX + pad) * Sc + '" y="' + (a.z0 - r0.minZ + pad) * Sc + '" width="' + Math.max(1, (a.x1 - a.x0) * Sc) + '" height="' + Math.max(1, (a.z1 - a.z0) * Sc) + '" fill="#' + (a.m.material && a.m.material.color ? a.m.material.color.getHexString() : "888888") + '"/>';
      for (const st of PZ._room.stations || []) svg += '<circle cx="' + (st.x - r0.minX + pad) * Sc + '" cy="' + (st.z - r0.minZ + pad) * Sc + '" r="7" fill="yellow"/>';
      svg += "</svg>";
      fs.writeFileSync(process.argv[PIp + 1] + "/sitroom.svg", svg);
    }
    const R = PZ._room.rect, S = mb._sitRoom;
    ok(R && Math.abs(R.minX - S.minX) < 0.01 && Math.abs(R.maxZ - S.maxZ) < 0.01, "the room stands on the plate the state floor left for it");
    const z = (CBZ._zones || []).map((q) => q.options.map((o) => (typeof o.label === "function" ? "fn" : o.label)).join("/")).join(" ");
    ok(/Open/.test(z) && /Brief/.test(z), "the Sit Room door says Open and its screen says Brief: " + z);
  }
}

// --plan <dir>: a top-down SVG of every floor (boxes drawn low to high in their
// own colours, doors red) for a human eye. A drawing of the plan, not a capture.
const PI = process.argv.indexOf("--plan");
if (PI > 0 && process.argv[PI + 1]) {
  const dir = process.argv[PI + 1];
  fs.mkdirSync(dir, { recursive: true });
  for (const R of runs) {
    const b = R.b, S = 24, W = b.w * S, H = b.d * S;
    const gx = b.group.position ? b.group.position.x : 0, gz = b.group.position ? b.group.position.z : 0;
    const list = R.meshes.filter((m) => m.visible !== false).map((m) => { const a = aabb(m); a.m = m; return a; })
      .filter((a) => a.y0 < R.Y + 2.0).sort((p, q) => p.y1 - q.y1);
    let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '"><rect width="100%" height="100%" fill="#777"/>';
    const X = (x) => ((x - gx) + b.w / 2) * S, Z = (z) => ((z - gz) + b.d / 2) * S;
    for (const a of list) {
      const rot = Math.abs(a.m.rotation.y) > 1e-4;
      const col = "#" + (a.m.material && a.m.material.color ? a.m.material.color.getHexString() : "888888");
      if (rot) {
        const L = a.m.scale.x, D = a.m.scale.z, cx = (X(a.x0) + X(a.x1)) / 2, cz = (Z(a.z0) + Z(a.z1)) / 2;
        svg += '<rect x="' + (cx - L * S / 2) + '" y="' + (cz - D * S / 2) + '" width="' + L * S + '" height="' + D * S + '" fill="' + col + '" transform="rotate(' + (-a.m.rotation.y * 180 / Math.PI) + ' ' + cx + ' ' + cz + ')"/>';
      } else svg += '<rect x="' + X(a.x0) + '" y="' + Z(a.z0) + '" width="' + Math.max(1, (a.x1 - a.x0) * S) + '" height="' + Math.max(1, (a.z1 - a.z0) * S) + '" fill="' + col + '"/>';
    }
    for (const d of CBZ.cityUnitDoors.all()) if (d.free && Math.abs(d.floorY - R.Y) < 0.05 && Math.abs(d.x - b.ox) < b.w / 2 && Math.abs(d.z - b.oz) < b.d / 2)
      svg += '<circle cx="' + ((d.x - b.ox) + b.w / 2) * S + '" cy="' + ((d.z - b.oz) + b.d / 2) * S + '" r="5" fill="red"/>';
    for (const h of (b.shaftRects || [])) svg += '<rect x="' + (h.x0 + b.w / 2) * S + '" y="' + (h.z0 + b.d / 2) * S + '" width="' + (h.x1 - h.x0) * S + '" height="' + (h.z1 - h.z0) * S + '" fill="none" stroke="magenta" stroke-width="3"/>';
    svg += "</svg>";
    fs.writeFileSync(dir + "/" + R.name + ".svg", svg);
  }
  console.log("plans written to " + dir);
}
console.log(notes.join("\n"));
console.log("PRESIDENT-ROOMS: " + (fails ? "FAIL" : "OK") + " " + passes + " passed, " + fails + " failed");
process.exit(fails ? 1 : 0);
