#!/usr/bin/env node
/* tools/estate-door-census.mjs — EVERY DOOR IN EVERY GOVERNMENT BUILDING,
   OPENED, SHUT, AND WALKED THROUGH. Plain node, no browser.

   OWNER (2026-09-29): "the president can't even leave the room that he spawns
   in. Those doors are all fucked up" + "it's throughout the building".

   The real three r128, systems/stairs.js, buildings_civic.js, buildings.js,
   interior_programs.js, elevators.js, furniture.js, roombuild.js and
   govcomplex.js run in a vm with only the engine globals stubbed, and the
   whole govcomplex landmass pass is run on a stub city (the Capitol, the
   Executive Mansion + West Wing, the Governor's house, the Bureau, Defence,
   City Hall and the rest). Then, for every shell CBZ.govShells() publishes:

   DOORS   every door record in the shell (the interior door kit,
           CBZ.cityUnitDoors, and the street door leaves, CBZ.cityDoorsGet):
             - REGISTERED: every door leaf's collider (door: true) belongs to
               a record (a leaf with a collider and no record is a wall you
               cannot open);
             - the player standing 0.8 m either side of it, on its floor,
               gets THIS door from the real [E] finder (CBZ.cityUnitDoors.at,
               what the interaction zone asks), with room to stand there;
             - standing right over or under it on another storey, [E] does
               NOT find it (the Oval Office bug: the finder answered with the
               Cabinet Room's door one floor down);
             - open: its collider leaves CBZ.colliders and the doorway is
               walkable for a 0.38 m body; shut (the swing tick run until it
               settles): the collider is back and the doorway solid again;
             - a street door opens for the player walking up (buildings.js's
               real opener tick) and shuts after he leaves.
   WALK    a 0.25 m grid over every storey, a cell walkable when a 0.38 m
           body at its walk height meets no collider in its body band, flood-
           filled with the player's own rules: a shut door opens when a cell
           within its [E] reach is reached; a stair link joins its two ends;
           the street doors swing for you. It must reach:
             - OUTSIDE from the President's spawn (the chair behind the Oval
               Office desk): the grade in front of the West Wing's door;
             - every ROOM (CBZ.stateRoomsAll + each storey's fit-out rect) of
               the spawn's shell from the spawn, and of every shell from its
               own front door.

   USAGE   node tools/estate-door-census.mjs [-v] [-t]   exit 1 on any failure
           (-t prints phase timings; the whole run is ~8 s of CPU)
*/
import fs from "fs";
const T0 = Date.now();
const lap = (what) => { if (process.argv.includes("-t")) console.log("  [" + ((Date.now() - T0) / 1000).toFixed(1) + " s] " + what); };
import vm from "vm";
const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const VERBOSE = process.argv.includes("-v");
const ctx = { console, Math, Date, JSON, Object, Array, Number, String, Set, Map, WeakMap, Float32Array, Uint16Array, Uint32Array, Int32Array, Uint8Array, Float64Array, ArrayBuffer, Symbol, Error, parseInt, parseFloat, isFinite, isNaN, Infinity, NaN, Proxy, Reflect, Promise, setTimeout, clearTimeout };
ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx; ctx.addEventListener = function () {}; ctx.removeEventListener = function () {}; ctx.performance = { now: () => Date.now() }; ctx.requestAnimationFrame = function () {};
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
const updates = [];
const CBZ = ctx.CBZ = {
  CONFIG: {}, colliders: [], platforms: [], losBlockers: [], game: { mode: "city", state: "playing" },
  player: { pos: new THREE.Vector3(0, 0, 0) },
  cmat(c, o) { o = o || {}; const k = c + "|" + (o.emissive || 0) + "|" + (o.ei || 0); if (!matCache.has(k)) { const m = new THREE.MeshLambertMaterial({ color: c, emissive: o.emissive || 0 }); m._shared = true; matCache.set(k, m); } return matCache.get(k); },
  boxGeom(w, h, d) { return new THREE.BoxGeometry(w, h, d); },
  hash01(x, z, s) { const v = Math.sin(x * 12.9898 + z * 78.233 + (s || 0) * 0.123) * 43758.5453; return v - Math.floor(v); },
  onUpdate(o, fn) { updates.push({ o, fn }); }, onAlways() {}, _lm: [], addLandmass(fn, order) { this._lm.push({ fn, order }); },
  markCollidersDirty() {}, markPlatformsDirty() {},
};
CBZ.mat = CBZ.cmat;
// THE STREAMED CITY (the phone's default boot): the real core/citystream.js
// with a slice that keeps everything while the census builds, so every
// complex's interiors are a real stream job ("gov interiors <id>") that
// section 4 below can park, free and bring back.
CBZ.CONFIG.STREAM_COMPACT = false;
load("src/core/citystream.js");
const STREAM = { keep: true };
CBZ.sliceKeepsRect = function () { return STREAM.keep; };
CBZ.slice = { stream: true, x: 0, z: 0, r: 1e6, lead: 0, view() { return 1000; }, keepR() { return 1e6; } };
load("src/entities/moves.js");
load("src/systems/bodydoors.js");
load("src/systems/stairs.js");
load("src/city/buildings_civic.js");
load("src/city/buildings.js");
load("src/city/fitout.js");
load("src/city/interior_programs.js");
load("src/city/govcomplex.js");
for (const rel of ["src/city/elevators.js", "src/city/furniture.js", "src/world/roombuild.js"]) {
  try { load(rel); } catch (e) { console.log("load fail", rel, e.message); }
}

// ---- the govcomplex pass on a stub city ---------------------------------
CBZ.colliders.length = 0; CBZ.platforms.length = 0;
CBZ.registerCityRegion = function (city, r) { (city.regions = city.regions || []).push(r); return r; };
CBZ.registerNoSpawnZone = function () {};
const city = { root: new THREE.Group(), roads: [], lots: [], shopLots: [], regions: [], minX: -500, maxX: 500, minZ: -500, maxZ: 500, center: { x: 0, z: 0 } };
CBZ.city = { arena: city };
const errs = [];
const oe = console.error; console.error = function () { errs.push([...arguments].map(String).join(" ").slice(0, 300)); };
lap("loaded");
for (const l of CBZ._lm.filter((q) => q.order === 42)) l.fn(city);
lap("govcomplex built");
console.error = oe;
if (errs.length) console.log("build errors", errs.length, errs.slice(0, 5));

let FAIL = 0;
const fails = [];
function fail(s) { FAIL++; if (fails.length < 400) fails.push(s); }

const shells = (CBZ.govShells ? CBZ.govShells() : []).filter((s) => s.b && s.b.group && Array.isArray(s.b.floorTops));
for (const sh of shells) {
  const b = sh.b;
  if ((b.storeys | 0) >= 2 && CBZ.cityStairCore) { try { CBZ.cityStairCore({ building: b }); } catch (e) { fail("stair core " + e.message); } }
}
const siteOf = (sh) => (typeof sh.site === "string" ? sh.site : (sh.site && sh.site.id)) || "?";
const tagOf = (sh) => siteOf(sh) + "/" + (sh.name || "shell") + "@" + sh.b.ox.toFixed(0) + "," + sh.b.oz.toFixed(0);
function inShell(b, x, z, pad) { return Math.abs(x - b.ox) <= b.w / 2 + (pad || 0) && Math.abs(z - b.oz) <= b.d / 2 + (pad || 0); }

const UD = CBZ.cityUnitDoors;
const allUnit = UD ? UD.all() : [];
const street = CBZ.cityDoorsGet ? CBZ.cityDoorsGet() : [];

// ---- the body --------------------------------------------------------------
const R = 0.38, STEP_SOLID = 0.42, BODY_H = 1.75, STEP_UP = 0.45;
// the colliders on a 2 m grid, built once; a door's collider is live while
// it is in CBZ.colliders (the door kit splices it in and out), tracked in LIVE
const GC = 2, GRID = new Map(), LIVE = new Set(CBZ.colliders);
for (const c of [...CBZ.colliders, ...allUnitCols()]) {
  if (!isFinite(c.minX + c.maxX + c.minZ + c.maxZ)) continue;
  if (c.maxX - c.minX > 400 || c.maxZ - c.minZ > 400) { (GRID.get("big") || GRID.set("big", []).get("big")).push(c); continue; }
  for (let i = Math.floor(c.minX / GC); i <= Math.floor(c.maxX / GC); i++) for (let j = Math.floor(c.minZ / GC); j <= Math.floor(c.maxZ / GC); j++) {
    const k = i + "," + j; let a = GRID.get(k); if (!a) GRID.set(k, a = []); if (a.indexOf(c) < 0) a.push(c);
  }
}
function allUnitCols() { return (CBZ.cityUnitDoors ? CBZ.cityUnitDoors.all() : []).map((d) => d.col).filter(Boolean); }
function syncLive(c) { if (!c) return; if (CBZ.colliders.indexOf(c) >= 0) LIVE.add(c); else LIVE.delete(c); }
const BIG = GRID.get("big") || [];
function hitIn(L, x, z, feet, r) {
  for (let q = 0; q < L.length; q++) {
    const c = L[q];
    if (x + r <= c.minX || x - r >= c.maxX || z + r <= c.minZ || z - r >= c.maxZ) continue;
    if (c.y0 != null && (feet + BODY_H <= c.y0 || feet + STEP_SOLID >= c.y1)) continue;
    if (!LIVE.has(c)) continue;
    return c;
  }
  return null;
}
function blockedAt(x, z, feet, r) {
  r = r == null ? R : r;
  let c = hitIn(BIG, x, z, feet, r);
  if (c) return c;
  const i0 = Math.floor((x - r) / GC), i1 = Math.floor((x + r) / GC), j0 = Math.floor((z - r) / GC), j1 = Math.floor((z + r) / GC);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const a = GRID.get(i + "," + j);
    if (a && (c = hitIn(a, x, z, feet, r))) return c;
  }
  return null;
}
function colName(c) {
  const m = c && c.ref;
  const hex = m && m.material && m.material.color ? "#" + m.material.color.getHexString() : "?";
  return hex + (m && m.scale ? " " + [m.scale.x, m.scale.y, m.scale.z].map((v) => v.toFixed(2)).join("x") : "");
}
// the door kit's swing tick (it returns a shut door's collider once the
// doorway is clear): run it until nothing is moving
const swingTick = updates.filter((u) => u.o === 34.31).map((u) => u.fn);
CBZ.player.pos.set(1e6, 0, 1e6);
function settle() { for (let i = 0; i < 40; i++) for (const f of swingTick) f(0.1); }
const streetTick = updates.filter((u) => u.o === 34.3).map((u) => u.fn);
if (!streetTick.length) fail("buildings.js street door opener not found (tick 34.3)");
if (!swingTick.length) fail("interior_programs.js door swing tick not found (tick 34.31)");
function setOpen(d, v) { UD.setOpen(d, v); if (!v) settle(); syncLive(d.col); if (d.pair) syncLive(d.pair.col); }
// the platforms on a 4 m grid (they never move)
const PG = new Map(), PGC = 4;
for (const p of CBZ.platforms) {
  if (!isFinite(p.minX + p.maxX + p.minZ + p.maxZ) || (p.maxX - p.minX) * (p.maxZ - p.minZ) > 1e6) { (PG.get("big") || PG.set("big", []).get("big")).push(p); continue; }
  for (let i = Math.floor(p.minX / PGC); i <= Math.floor(p.maxX / PGC); i++) for (let j = Math.floor(p.minZ / PGC); j <= Math.floor(p.maxZ / PGC); j++) {
    const k = i + "," + j; let a = PG.get(k); if (!a) PG.set(k, a = []); a.push(p);
  }
}
const PG_BIG = PG.get("big") || [];
function groundAt(x, z, fromY) {
  let best = CBZ.estateGroundAt ? CBZ.estateGroundAt(x, z) : 0;
  const reach = (fromY != null ? fromY : best) + STEP_UP;
  const cell = PG.get(Math.floor(x / PGC) + "," + Math.floor(z / PGC)) || [];
  for (const p of (PG_BIG.length ? PG_BIG.concat(cell) : cell)) {
    if (x < p.minX || x > p.maxX || z < p.minZ || z > p.maxZ) continue;
    if (p.obb) {
      const o = p.obb, rx = x - o.cx, rz = z - o.cz;
      const a = rx * o.ux + rz * o.uz, c = rx * o.uz - rz * o.ux;
      if (a < -o.hl || a > o.hl || c < -o.hw || c > o.hw) continue;
    }
    let top = p.top;
    if (p.ramp) {
      const r = p.ramp;
      let t = r.dir ? ((x - r.ox) * r.dx + (z - r.oz) * r.dz) / r.len : (r.axis === "x") ? (x - r.x0) / (r.x1 - r.x0) : (z - r.z0) / (r.z1 - r.z0);
      t = Math.max(0, Math.min(1, t));
      top = CBZ.rampTop(r, t);
    }
    if (top <= reach && top > best) best = top;
  }
  return best;
}

// ==========================================================================
// 1. DOORS: registered, reachable by [E] from both faces, open clears, shut seals
// ==========================================================================
const perShellDoors = new Map();
let nDoors = 0, nStreet = 0;
for (const sh of shells) {
  const b = sh.b, tag = tagOf(sh);
  const mine = allUnit.filter((d) => inShell(b, d.x, d.z, 0.3) && d.floorY >= (b.group.position.y || 0) - 0.5 && d.floorY <= b.floorTops[b.floorTops.length - 1] + 0.5);
  const st = street.filter((d) => inShell(b, d.wx, d.wz, 1.0));
  perShellDoors.set(sh, { unit: mine, street: st });
  const recCols = new Set(allUnit.map((d) => d.col));
  for (const c of CBZ.colliders) if (c.door && !recCols.has(c) && inShell(b, (c.minX + c.maxX) / 2, (c.minZ + c.maxZ) / 2, 0) && c.y0 >= b.floorTops[0] - 0.3 && c.y0 <= b.floorTops[b.floorTops.length - 1] + 0.5)
    fail(tag + " a door leaf's collider with no door record @" + ((c.minX + c.maxX) / 2 - b.ox).toFixed(1) + "," + ((c.minZ + c.maxZ) / 2 - b.oz).toFixed(1) + " y" + c.y0.toFixed(2));
  for (const d of mine) {
    nDoors++;
    const c = d.col;
    if (!c) { fail(tag + " door " + d.label + " has no collider"); continue; }
    if (CBZ.colliders.indexOf(c) < 0) { fail(tag + " door " + d.label + " starts open / collider not in the world"); continue; }
    // the leaf's thin axis is the wall normal
    const alongX = (c.maxX - c.minX) >= (c.maxZ - c.minZ);
    const nx = alongX ? 0 : 1, nz = alongX ? 1 : 0;
    const w = alongX ? c.maxX - c.minX : c.maxZ - c.minZ;
    if (w < 0.8) fail(tag + " door " + d.label + " leaf only " + w.toFixed(2) + " m wide: a body cannot pass");
    for (const s of [-1, 1]) {
      const px = d.x + nx * s * 0.8, pz = d.z + nz * s * 0.8;
      const got = UD.at(px, pz, 1.9, d.floorY);
      if (got !== d) fail(tag + " door " + d.label + " @" + (d.x - b.ox).toFixed(1) + "," + (d.z - b.oz).toFixed(1) + " y" + d.floorY.toFixed(2) + ": [E] from the " + (s < 0 ? "-" : "+") + " face finds " + (got ? got.label + " @" + (got.x - b.ox).toFixed(1) + "," + (got.z - b.oz).toFixed(1) : "nothing"));
      if (blockedAt(px, pz, d.floorY, 0.2)) fail(tag + " door " + d.label + " @" + (d.x - b.ox).toFixed(1) + "," + (d.z - b.oz).toFixed(1) + " y" + d.floorY.toFixed(2) + ": the " + (s < 0 ? "-" : "+") + " face is blocked (nowhere to stand to open it)");
    }
    // the storeys above and below: standing right over / under the door,
    // [E] must not find it (it used to: the Oval Office door answered with
    // the Cabinet Room's, one floor down)
    for (const t of b.floorTops) {
      if (Math.abs(t - d.floorY) < 1.0) continue;
      for (const s of [-1, 1]) {
        const got = UD.at(d.x + nx * s * 0.6, d.z + nz * s * 0.6, 1.9, t);
        if (got === d) fail(tag + " door " + d.label + " y" + d.floorY.toFixed(2) + ": [E] finds it from the floor at y" + t.toFixed(2));
      }
    }
    if (!d.free && !UD.mayOpen(d)) continue;                 // a flat's door: a key's business, not this census
    // open → collider out, the doorway walkable
    setOpen(d, true);
    if (CBZ.colliders.indexOf(c) >= 0) fail(tag + " door " + d.label + " open but its collider stayed");
    const blk = blockedAt(d.x, d.z, d.floorY, R);
    if (blk) fail(tag + " door " + d.label + " @" + (d.x - b.ox).toFixed(1) + "," + (d.z - b.oz).toFixed(1) + " y" + d.floorY.toFixed(2) + " open but the doorway is blocked by " + colName(blk) + " " + [(blk.minX - b.ox).toFixed(2), (blk.maxX - b.ox).toFixed(2), (blk.minZ - b.oz).toFixed(2), (blk.maxZ - b.oz).toFixed(2), blk.y0 != null ? blk.y0.toFixed(2) : "-", blk.y1 != null ? blk.y1.toFixed(2) : "-"].join(","));
    setOpen(d, false);
    if (CBZ.colliders.indexOf(c) < 0) fail(tag + " door " + d.label + " shut but its collider did not come back");
    if (!blockedAt(d.x, d.z, d.floorY, R)) fail(tag + " door " + d.label + " shut but the doorway is not solid");
  }
  nStreet += st.length;
  // the street doors swing for whoever walks up (buildings.js's opener, the
  // real tick): walk up from outside, the collider leaves; walk away, it
  // comes back
  for (const d of st) {
    const y0 = (d.doorY != null ? d.doorY - 1.5 : 0.14);
    CBZ.player.pos.set(d.wx - d.inx * 1.2, y0, d.wz - d.inz * 1.2);
    for (let i = 0; i < 30; i++) for (const f of streetTick) f(0.05);
    if (CBZ.colliders.indexOf(d.col) >= 0) fail(tag + " street door @" + (d.wx - b.ox).toFixed(1) + "," + (d.wz - b.oz).toFixed(1) + " did not open for the player at it");
    CBZ.player.pos.set(1e6, 0, 1e6);
    for (let i = 0; i < 80; i++) for (const f of streetTick) f(0.05);
    if (CBZ.colliders.indexOf(d.col) < 0) fail(tag + " street door @" + (d.wx - b.ox).toFixed(1) + "," + (d.wz - b.oz).toFixed(1) + " did not shut again");
    syncLive(d.col);
  }
}

lap("doors cycled");
// ==========================================================================
// 2. THE WALK: a flood fill per shell, doors opened by [E] as the player would
// ==========================================================================
const CELL = 0.25;
function floodShell(sh, seeds) {
  const b = sh.b, tops = b.floorTops, K = b.storeys | 0;
  const pad = 6;                                            // the grade round the shell
  const x0 = b.ox - b.w / 2 - pad, z0 = b.oz - b.d / 2 - pad;
  const nx = Math.ceil((b.w + 2 * pad) / CELL), nz = Math.ceil((b.d + 2 * pad) / CELL);
  const doors = perShellDoors.get(sh);
  // the street doors swing for you: their colliders are out while you walk
  const pulled = [];
  for (const d of doors.street) { const i = CBZ.colliders.indexOf(d.col); if (i >= 0) { CBZ.colliders.splice(i, 1); pulled.push(d.col); syncLive(d.col); } }
  // open every unit door we will open; all shut at the start
  const opened = [];
  const seen = new Map();                                   // key -> y
  const key = (k, i, j) => (k * nx + i) * nz + j;
  const q = [];
  const cellY = (k, x, z) => {
    if (k < 0) return groundAt(x, z, 0.3);                  // grade outside
    return groundAt(x, z, tops[k] + 0.05);
  };
  function push(k, i, j, y) {
    const kk = key(k + 1, i, j);
    if (seen.has(kk)) return;
    seen.set(kk, y);
    q.push([k, i, j, y]);
  }
  function seed(k, x, z) {
    const i = Math.round((x - x0) / CELL), j = Math.round((z - z0) / CELL);
    const y = k < 0 ? groundAt(x, z, 0.3) : tops[k];
    push(k, i, j, y);
  }
  for (const s of seeds) seed(s.k, s.x, s.z);
  // stair links as portals between storeys: end cell -> other end cell
  const links = CBZ.stairs.links().filter((L) => L.owner === b || (L.owner && L.owner.group === b.group));
  const kOf = (y) => { let best = -1, bd = 0.3; for (let k = 0; k < K; k++) if (Math.abs(tops[k] - y) < bd) { bd = Math.abs(tops[k] - y); best = k; } return best; };
  const portals = [];
  for (const L of links) {
    const a = L.path[0], c = L.path[L.path.length - 1];
    const ka = kOf(a.y), kc = kOf(c.y);
    if (ka < 0 || kc < 0) continue;
    portals.push({ k: ka, x: a.x, z: a.z, tk: kc, tx: c.x, tz: c.z }, { k: kc, x: c.x, z: c.z, tk: ka, tx: a.x, tz: a.z });
  }
  const unitByFloor = doors.unit;
  let guard = 0;
  while (q.length && guard++ < 5e6) {
    const [k, i, j, y] = q.pop();
    const x = x0 + i * CELL, z = z0 + j * CELL;
    // [E]: a closed door in reach from this cell opens
    if (k >= 0) {
      const d = UD.at(x, z, 1.9, y);
      if (d && !d.open && unitByFloor.indexOf(d) >= 0 && (d.free || UD.mayOpen(d))) { setOpen(d, true); opened.push(d); }
    }
    for (const P of portals) if (P.k === k && Math.hypot(P.x - x, P.z - z) < 0.6) seed(P.tk, P.tx, P.tz);
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
      const xx = x0 + ii * CELL, zz = z0 + jj * CELL;
      const ins = inShell(b, xx, zz, -0.05);
      // a storey lives inside the shell; the grade (k -1) outside it
      let kk = k;
      if (k >= 0 && !ins) { if (k !== 0) continue; kk = -1; }
      if (k < 0 && ins) kk = 0;
      const yy = groundAt(xx, zz, y);
      if (yy - y > STEP_UP + 1e-3) continue;
      if (y - yy > 1.2) continue;                            // a drop: not a way anyone walks out
      if (kk >= 0 && Math.abs(yy - tops[kk]) > 0.6) {
        // a raised piece of floor (dais, stair) or the storey below: stay on the level we are on
        if (yy < tops[kk] - 0.6) continue;
      }
      if (blockedAt(xx, zz, yy)) {
        // standing here would open a door in front of us: re-test after [E]
        if (kk >= 0) {
          const d = UD.at(xx, zz, 1.9, yy);
          if (d && !d.open && unitByFloor.indexOf(d) >= 0 && (d.free || UD.mayOpen(d))) { setOpen(d, true); opened.push(d); }
          if (blockedAt(xx, zz, yy)) continue;
        } else continue;
      }
      push(kk, ii, jj, yy);
    }
  }
  const reached = (k, x, z) => {
    const i = Math.round((x - x0) / CELL), j = Math.round((z - z0) / CELL);
    return seen.has(key(k + 1, i, j));
  };
  const reachedRect = (k, rx0, rx1, rz0, rz1) => {
    for (let x = rx0 + 0.4; x <= rx1 - 0.4; x += CELL) for (let z = rz0 + 0.4; z <= rz1 - 0.4; z += CELL) if (reached(k, x, z)) return true;
    return false;
  };
  const cleanup = () => {
    for (const d of opened) setOpen(d, false);
    for (const c of pulled) { if (CBZ.colliders.indexOf(c) < 0) CBZ.colliders.push(c); syncLive(c); }
  };
  return { reached, reachedRect, cleanup, opened, seen, x0, z0 };
}

// the rooms each shell publishes: every room a state plan drew
// (CBZ.stateRoomsAll) and every storey's declared fit-out rect
function roomsOf(sh) {
  const b = sh.b, out = [];
  const tops = b.floorTops;
  const kOf = (y) => { let best = 0, bd = 1e9; for (let k = 0; k < (b.storeys | 0); k++) if (Math.abs(tops[k] - y) < bd) { bd = Math.abs(tops[k] - y); best = k; } return best; };
  const sr = CBZ.stateRoomsAll ? CBZ.stateRoomsAll() : [];
  for (const r of sr) {
    if (!inShell(b, (r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, 0)) continue;
    if (r.floorY < tops[0] - 0.3 || r.floorY > tops[tops.length - 1] + 0.3) continue;
    out.push({ name: r.key || r.name, k: kOf(r.floorY), x0: r.x0, x1: r.x1, z0: r.z0, z1: r.z1 });
  }
  const site = CBZ.fitoutSiteOf ? CBZ.fitoutSiteOf(b) : null;
  if (site && site.floors) for (const k in site.floors) {
    const f = site.floors[k];
    const rc = f && (f.rect || (CBZ.interiorFloorRoom ? CBZ.interiorFloorRoom(b, +k) : null));
    if (rc) out.push({ name: "storey " + k + " (" + f.prog + ")", k: +k, x0: b.ox + rc.x0, x1: b.ox + rc.x1, z0: b.oz + rc.z0, z1: b.oz + rc.z1 });
  }
  return out;
}

// ---- the President's spawn: the chair behind the Oval Office desk --------
const rooms = CBZ.presidentInteriorRooms ? CBZ.presidentInteriorRooms() : [];
const oval = rooms.find((r) => r.key === "ovaloffice" && r.landmarks && r.landmarks.presidentialDesk);
let spawnReport = "no Oval Office published";
if (!oval) fail("the Oval Office (presidential desk) is not published");
else {
  const d = oval.landmarks.presidentialDesk, A = oval.approach;
  // THE CHAIR THE GAME SEATS HIM IN: the throne the room publishes (the
  // census used to guess 0.9 m behind the desk; the chair is at 1.12, and the
  // real spawn, president_office.js deskPoint, reads the same number)
  const T = oval.landmarks.throne || { x: d.x + A.nx * 1.12, z: d.z + A.nz * 1.12 };
  const sx = T.x, sz = T.z;
  // a standing body at the chair is not inside anything (the flood below
  // starts from here, so a spawn wedged into the desk would read as "walked")
  {
    const blk = blockedAt(sx, sz, oval.floorY, R);
    if (blk) fail("SPAWN WEDGED: the President standing at his chair is inside " + colName(blk));
  }
  const sh = shells.find((s) => inShell(s.b, sx, sz, 0) && oval.floorY >= s.b.floorTops[0] - 0.3 && oval.floorY <= s.b.floorTops[s.b.floorTops.length - 1]);
  if (!sh) fail("no shell holds the Oval Office desk");
  else {
    const b = sh.b, k = b.floorTops.findIndex((t) => Math.abs(t - oval.floorY) < 0.3);
    const F = floodShell(sh, [{ k: k, x: sx, z: sz }]);
    // outside: the grade in front of the shell's own street door
    const dn = b.localDoor;
    const out = dn ? { x: b.ox + dn.x - dn.nx * 3.0, z: b.oz + dn.z - dn.nz * 3.0 } : null;
    let outOk = false;
    if (out) for (let dx = -1; dx <= 1 && !outOk; dx += 0.25) for (let dz = -1; dz <= 1 && !outOk; dz += 0.25) outOk = F.reached(-1, out.x + dx, out.z + dz);
    spawnReport = tagOf(sh) + " floor " + k + " desk @" + (sx - b.ox).toFixed(1) + "," + (sz - b.oz).toFixed(1) + ": " + F.seen.size + " cells walked, doors opened " + F.opened.length + ", out the front door " + (outOk ? "YES" : "NO");
    if (!outOk) fail("SPAWN TRAP: from the Oval Office desk the President cannot walk out of " + tagOf(sh) + " (" + F.seen.size + " cells reached, " + F.opened.length + " doors opened)");
    // every room of that shell from the spawn
    for (const r of roomsOf(sh)) if (!F.reachedRect(r.k, r.x0, r.x1, r.z0, r.z1)) fail("from the spawn: " + tagOf(sh) + " room " + r.name + " (floor " + r.k + ") unreachable");
    F.cleanup();
  }
}

lap("spawn walk");
// ---- every shell, from its own street door: every room ---------------------
let nRooms = 0, nShellWalks = 0;
for (const sh of shells) {
  const b = sh.b, dn = b.localDoor;
  if (!dn) continue;
  nShellWalks++;
  const F = floodShell(sh, [{ k: -1, x: b.ox + dn.x - dn.nx * 3.0, z: b.oz + dn.z - dn.nz * 3.0 }]);
  const inside = F.reached(0, b.ox + dn.x + dn.nx * 1.6, b.oz + dn.z + dn.nz * 1.6);
  if (!inside) fail(tagOf(sh) + ": cannot walk in the front door");
  for (const r of roomsOf(sh)) { nRooms++; if (!F.reachedRect(r.k, r.x0, r.x1, r.z0, r.z1)) fail(tagOf(sh) + " room " + r.name + " (floor " + r.k + ") unreachable from the front door"); }
  if (VERBOSE) console.log("  walk", tagOf(sh), "cells", F.seen.size, "doors opened", F.opened.length, "/", perShellDoors.get(sh).unit.length);
  F.cleanup();
}

// ==========================================================================
// 3. THE PLAYER HAS ONE BODY. Everything above walks a 0.38 m body, which is
//    what physics.js resolves the player with. It is only the truth if no
//    other per-frame code resolves the player with a FATTER one: drinking.js
//    ran CBZ.collide(P.pos, 0.5, ankles..) every frame for a sober player and
//    shoved him back off every desk corner, sofa and jamb within half a metre
//    (the Oval Office's invisible walls; this census passed, the real game
//    did not: tools/president-walkout.mjs found it by attributing the undo to
//    updater 34). Two checks:
//    a) every CBZ.collide on the player's position outside physics.js is a
//       known, STATE-GATED one (listed with its state); a new one fails here
//       until somebody says when it runs;
//    b) drinking.js, loaded for real and ticked sober for 2 s, leaves the
//       player where he stands and never resolves him.
// ==========================================================================
{
  const GATED = {
    "src/city/wanted.js": "only while a cop marches you (escort)",
    "src/city/drinking.js": "only while drunk (level > 0 or a lurch)",
    "src/city/swim.js": "only while swimming",
    "src/systems/grapple.js": "only while grappled",
    "src/systems/tornado.js": "only while the storm has you",
    "src/systems/capture.js": "only while captured",
  };
  const walkSrc = (dir, out) => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) { const q = dir + "/" + f.name; if (f.isDirectory()) walkSrc(q, out); else if (f.name.endsWith(".js")) out.push(q); } return out; };
  const re = /collide\((?:CBZ\.)?(?:P|player|Pp|pl|CBZ\.player)\.pos\b/;
  for (const f of walkSrc(ROOT + "/src", [])) {
    const rel = f.slice(ROOT.length + 1);
    if (rel === "src/systems/physics.js") continue;
    const lines = fs.readFileSync(f, "utf8").split("\n");
    lines.forEach((ln, i) => { if (re.test(ln) && !GATED[rel]) fail("THE PLAYER'S BODY: " + rel + ":" + (i + 1) + " resolves the player outside physics.js and is not a known state-gated resolver: " + ln.trim().slice(0, 120)); });
  }
  // b) drinking.js, sober
  const calls = [];
  const P0 = CBZ.player;
  P0.pos.set(10, 0.14, 10); P0.radius = 0.38; P0.dead = false; P0.driving = false;
  CBZ.cam = CBZ.cam || { yaw: 0, pitch: 0 };
  CBZ.now = 0;
  const realCollide = CBZ.collide;
  CBZ.collide = function (pos) { if (pos === P0.pos) calls.push(pos.x); return false; };
  const before = updates.length;
  try { load("src/city/drinking.js"); } catch (e) { fail("drinking.js would not load in the census vm: " + e.message); }
  const tick = updates.slice(before).filter((u) => u.o === 34).map((u) => u.fn);
  if (!tick.length) fail("drinking.js's frame tick (order 34) not found");
  CBZ.game.mode = "city";
  for (let i = 0; i < 120; i++) { CBZ.now += 1000 / 60; for (const f of tick) f(1 / 60); }
  if (calls.length) fail("THE PLAYER'S BODY: drinking.js resolved a SOBER player " + calls.length + " times in 2 s");
  if (Math.hypot(P0.pos.x - 10, P0.pos.z - 10) > 1e-9) fail("THE PLAYER'S BODY: drinking.js moved a sober player");
  CBZ.collide = realCollide;
}

// ==========================================================================
// 4. THE STREAMED CITY. On a phone the city streams (core/citystream.js):
//    the President drives off to an appearance, the estate's interiors job
//    PARKS (colliders out) and, far enough away, used to be FREED and run
//    again on the way back. The rooms are drawn into the shells' groups, which
//    the job does not own, so a free left every mesh standing and the re-run
//    drew it all again: a dead door record filed in front of every live one
//    (E opened nothing) and the old leaf shut in the doorway with no body.
//    And a door left OPEN came back with its collider re-attached: an
//    invisible wall in an open doorway. Checks, on the real streamer:
//    a) every complex's interiors job exists and is never freed (noFree);
//    b) the West Wing: open the Oval Office door, drive far away (park +
//       the free pass), come back: the open door is still walkable, every
//       shut door is solid, no door is filed twice, and [E] in front of each
//       door finds THAT door;
//    c) a freeable job that files doors (a block of flats): freed, its doors
//       leave the kit; run again, each spot holds exactly one live record.
// ==========================================================================
let streamReport = "not run";
{
  const P = CBZ.player;
  const jobs = CBZ.streamJobs || [];
  const gj = jobs.filter((j) => /^gov interiors /.test(j.name || ""));
  if (!gj.length) fail("STREAM: no 'gov interiors' stream job (the census slice should make one per complex)");
  for (const j of gj) if (!j.noFree) fail("STREAM: " + j.name + " can be FREED; its rooms live in shells it does not own (a re-run draws them twice)");
  const sh = oval && shells.find((s) => inShell(s.b, oval.landmarks.presidentialDesk.x, oval.landmarks.presidentialDesk.z, 0));
  const job = sh && gj.find((j) => sh.b.ox >= j.rect.minX && sh.b.ox <= j.rect.maxX && sh.b.oz >= j.rect.minZ && sh.b.oz <= j.rect.maxZ);
  if (sh && !job) fail("STREAM: no interiors job covers " + tagOf(sh));
  const away = () => { STREAM.keep = false; P.pos.set(1e5, 0, 1e5); CBZ.streamTick(true); CBZ.streamTick(true); };
  const back = (x, z) => { STREAM.keep = true; P.pos.set(x, 0, z); CBZ.streamTick(true); };
  const live = (c) => CBZ.colliders.indexOf(c) >= 0;
  if (sh && job && CBZ.streamTick) {
    const b = sh.b;
    const doorsOf = () => UD.all().filter((d) => inShell(b, d.x, d.z, 0.5));
    const before = doorsOf();
    const ovalDoor = before.find((d) => /Oval Office/.test(d.label)) || before[0];
    setOpen(ovalDoor, true);
    // the swinging leaf hangs in the shell (it parks with it), on its jamb
    {
      const pv = ovalDoor.pivot;
      if (!pv) fail("STREAM: " + ovalDoor.label + " opened with no swinging leaf");
      else {
        let o = pv; while (o && o !== b.group) o = o.parent;
        if (!o) fail("STREAM: " + ovalDoor.label + "'s swinging leaf is not in its shell (it would hang in the air when the shell parks)");
        const w = new THREE.Vector3(); pv.getWorldPosition(w);
        const hs = ovalDoor.hinge || -1, ux = ovalDoor.runX ? 1 : 0, uz = ovalDoor.runX ? 0 : 1;
        const hx = ovalDoor.x + ux * hs * ovalDoor.w / 2, hz = ovalDoor.z + uz * hs * ovalDoor.w / 2;
        if (Math.hypot(w.x - hx, w.z - hz) > 0.01 || Math.abs(w.y - ovalDoor.floorY) > 0.01) fail("STREAM: " + ovalDoor.label + "'s hinge is off its jamb by " + Math.hypot(w.x - hx, w.z - hz).toFixed(2) + " m");
      }
    }
    away();
    if (job.state !== "parked") fail("STREAM: the West Wing interiors job did not park when the President left (state " + job.state + ")");
    if (before.some((d) => live(d.col))) fail("STREAM: a West Wing door kept its collider while its job was parked");
    back(b.ox, b.oz);
    if (job.state !== "built") fail("STREAM: the West Wing interiors job did not come back (state " + job.state + ")");
    const after = doorsOf();
    if (after.length !== before.length) fail("STREAM: the West Wing had " + before.length + " door records, " + after.length + " after the round trip");
    if (live(ovalDoor.col) || !ovalDoor.open) fail("STREAM: " + ovalDoor.label + " was left open and came back SOLID (an invisible wall in an open doorway)");
    let ok = 0;
    for (const d of after) {
      if (d === ovalDoor || (d.pair && d.pair === ovalDoor)) continue;
      if (!d.open && !live(d.col)) { fail("STREAM: " + d.label + " (" + d.id + ") came back shut with no collider"); continue; }
      const n = d.runX ? { x: 0, z: 1 } : { x: 1, z: 0 };
      for (const s of [-1, 1]) {
        const f = UD.at(d.x + n.x * s * 0.8, d.z + n.z * s * 0.8, 1.9, d.floorY + 0.05);
        if (f !== d && !(f && f.pair === d)) fail("STREAM: [E] in front of " + d.label + " (" + d.id + ") finds " + (f ? f.id : "nothing"));
      }
      ok++;
    }
    setOpen(ovalDoor, false);
    if (!live(ovalDoor.col)) fail("STREAM: " + ovalDoor.label + " shut after the round trip but has no collider");
    // the full drive: far past the free distance, twice, then home
    away(); away(); back(b.ox, b.oz);
    if (doorsOf().length !== before.length) fail("STREAM: the West Wing door count changed after a second trip (" + doorsOf().length + " vs " + before.length + ")");
    streamReport = tagOf(sh) + ": " + before.length + " doors, round trip x2, " + ok + " found by [E] from both faces";
  }
  // c) a freeable job that files a door (what a block of flats does)
  {
    const X = 9000, Z = 9000;
    const mkDoor = () => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.06), CBZ.cmat(0x4a3524));
      m.position.set(X, 1, Z); city.root.add(m);
      const col = { minX: X - 0.5, maxX: X + 0.5, minZ: Z - 0.03, maxZ: Z + 0.03, y0: 0, y1: 2, ref: m, door: true };
      CBZ.colliders.push(col);
      UD.add({ id: "door:stream-test", label: "the flat", x: X, z: Z, floorY: 0, mesh: m, col: col, runX: true, w: 1, h: 2, free: true });
    };
    STREAM.keep = true;
    const fj = CBZ.sliceAt({ minX: X - 5, maxX: X + 5, minZ: Z - 5, maxZ: Z + 5 }, mkDoor, { name: "census flats" });
    const at = () => UD.all().filter((d) => d.id === "door:stream-test");
    if (!fj || at().length !== 1) fail("STREAM: the test job did not file its door");
    else {
      setOpen(at()[0], true);
      away();
      if (fj.state !== "queued") fail("STREAM: the freeable test job was not freed (state " + fj.state + ")");
      if (at().length) fail("STREAM: a FREED job's door is still filed in the door kit (" + at().length + " records)");
      back(X, Z);
      const recs = at();
      if (recs.length !== 1) fail("STREAM: after the re-run the flat's door is filed " + recs.length + " times");
      else {
        const f = UD.at(X, Z + 0.8, 1.9, 0.05);
        if (f !== recs[0]) fail("STREAM: [E] at the re-built flat's door finds a dead record");
        if (!live(recs[0].col)) fail("STREAM: the re-built flat's door is not solid");
        setOpen(recs[0], true);
        if (live(recs[0].col)) fail("STREAM: the re-built flat's door does not open");
      }
    }
  }
}

// ==========================================================================
// 5. PEOPLE OPEN DOORS (systems/bodydoors.js through CBZ.moves.step, every
//    game). Real motors, real door kit, a plain circle-vs-box resolver:
//    a) a West Wing staffer walks a route through a SHUT Oval Office door:
//       it opens in front of him, he comes out the far side, and it shuts
//       behind him (collider back) once he is clear;
//    b) a SECURED door (the Situation Room's rule): a stranger is refused and
//       held at the leaf (door stays shut, m.doorBlockT); staff, the detail
//       and police are let through; a LOCKED flat opens for its key holder
//       only;
//    c) the navigator (systems/navgrid.js) plans a staffer THROUGH a shut
//       door and refuses a stranger the same way when every way is secured;
//    d) the prison rule: a cell front opens for nobody walking up (inmate or
//       officer), a card door for officers only, the Gate Key door for the
//       gate post / warden, a room door for anybody; an inmate walking at a
//       cell front is refused by the same motor hook.
// ==========================================================================
let bodyReport = "not run";
{
  const BD = CBZ.bodyDoors, MV = CBZ.moves;
  const bdTick = updates.filter((u) => u.o === 34.32).map((u) => u.fn);
  if (!BD || !MV) fail("BODIES: systems/bodydoors.js or entities/moves.js did not load");
  else if (!bdTick.length) fail("BODIES: the bodydoors shut tick (34.32) is not registered");
  else {
    const runTicks = (s) => { for (let i = 0; i < Math.round(s / 0.05); i++) { for (const f of bdTick) f(0.05); for (const f of swingTick) f(0.05); } };
    const wwDoors = oval ? UD.all().filter((d) => /Oval Office/.test(d.label) && Math.abs(d.floorY - oval.floorY) < 0.5) : [];
    const door = wwDoors.find((d) => !d.pair) || wwDoors[0];
    if (!door) fail("BODIES: no Oval Office door to walk through");
    else {
      if (door.open) setOpen(door, false);
      if (!door.col._bd) fail("BODIES: the Oval Office door is not tagged for bodies (door kit -> bodyDoors.tag)");
      const nrm = door.runX ? { x: 0, z: 1 } : { x: 1, z: 0 };
      const near = CBZ.colliders.concat(allUnitCols()).filter((c) => c.maxX > door.x - 4 && c.minX < door.x + 4 && c.maxZ > door.z - 4 && c.minZ < door.z + 4);
      const RAD = 0.32, feet = door.floorY;
      function resolve(p) {
        for (const c of near) {
          if (CBZ.colliders.indexOf(c) < 0) continue;
          if (c.y0 != null && (c.y0 >= feet + 1.7 || c.y1 <= feet + 0.42)) continue;
          const qx = Math.max(c.minX, Math.min(p.x, c.maxX)), qz = Math.max(c.minZ, Math.min(p.z, c.maxZ));
          const dx = p.x - qx, dz = p.z - qz, d2 = dx * dx + dz * dz;
          if (d2 >= RAD * RAD) continue;
          if (d2 > 1e-10) { const d = Math.sqrt(d2), k = (RAD - d) / d; p.x += dx * k; p.z += dz * k; }
          else {   // centre inside the box: out the nearest face
            const o = [[c.minX - RAD - p.x, 0], [c.maxX + RAD - p.x, 0], [0, c.minZ - RAD - p.z], [0, c.maxZ + RAD - p.z]];
            o.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]));
            p.x += o[0][0]; p.z += o[0][1];
          }
        }
      }
      // walk `who` from one face of the door to the other; -> where he ended up
      function walk(who, side, secs) {
        const p = new THREE.Vector3(door.x - nrm.x * side * 1.1, feet, door.z - nrm.z * side * 1.1);
        who.pos = p;
        const m = MV.motor(who); MV.reset(m, p);
        const tx = door.x + nrm.x * side * 1.4, tz = door.z + nrm.z * side * 1.4;
        let yaw = Math.atan2(nrm.x * side, nrm.z * side), refused = false;
        for (let i = 0; i < Math.round(secs / 0.05); i++) {
          MV.step(m, p, yaw, tx, tz, { speed: 1.4, stop: 0.3 }, 0.05);
          yaw = m.yaw;
          resolve(p);
          if (m.doorBlockT > 0) refused = true;
          for (const f of bdTick) f(0.05); for (const f of swingTick) f(0.05);
        }
        const along = (p.x - door.x) * nrm.x * side + (p.z - door.z) * nrm.z * side;
        return { along: along, refused: refused, m: m };
      }
      const live = (c) => CBZ.colliders.indexOf(c) >= 0;
      // a) staff through a free door, and it shuts behind him
      const staffer = { organization: "state" };
      const ra = walk(staffer, 1, 4);
      if (ra.along < 0.9) fail("BODIES: a staffer walking through the shut Oval Office door ended " + ra.along.toFixed(2) + " m past it (never got through)");
      if (ra.refused) fail("BODIES: a staffer was REFUSED a free door");
      staffer.pos.set(1e5, 0, 1e5);
      runTicks(3);
      if (door.open || !live(door.col)) fail("BODIES: the door a staffer walked through did not shut behind him (open " + door.open + ", collider " + live(door.col) + ")");
      // the player's own door is his: a body never shuts it
      UD.setOpen(door, true); syncLive(door.col);
      const rb0 = walk({ organization: "state" }, -1, 3);
      runTicks(3);
      if (!door.open) fail("BODIES: a body SHUT a door the player had opened");
      setOpen(door, false);
      if (rb0.along < 0.9) fail("BODIES: a staffer could not walk through a door standing open");
      // b) the secured rule and the locked rule
      const free0 = door.free;
      door.free = function () { return false; };
      if (door.pair) door.pair.free = door.free;
      const stranger = {};
      const rs = walk(stranger, 1, 4);
      if (rs.along > 0) fail("BODIES: a stranger walked through a SECURED door (" + rs.along.toFixed(2) + " m past it)");
      if (!rs.refused) fail("BODIES: a stranger at a secured door was not refused (doorBlockT never set)");
      if (door.open) fail("BODIES: a secured door opened for a stranger");
      for (const who of [{ organization: "state" }, { _detailBrain: "cp" }, { kind: "cop" }]) {
        const r = walk(who, 1, 4);
        if (r.along < 0.9) fail("BODIES: " + JSON.stringify(who) + " was kept out of a secured door");
        who.pos.set(1e5, 0, 1e5); runTicks(3);
      }
      door.free = false; if (door.pair) door.pair.free = false;
      const tenant = { name: "tenant" };
      const oldKeys = CBZ.cityKeys;
      CBZ.cityKeys = { pedHas: (ped, id) => ped === tenant && (id === door.id || (door.pair && id === door.pair.id)) };
      const rt = walk(tenant, 1, 4);
      if (rt.along < 0.9) fail("BODIES: a tenant with the key was kept out of his locked door");
      tenant.pos.set(1e5, 0, 1e5); runTicks(3);
      const rx = walk({ name: "burglar" }, 1, 4);
      if (rx.along > 0) fail("BODIES: a man with no key walked through a locked door");
      CBZ.cityKeys = oldKeys;
      // c) the navigator, per body. (systems/navgrid.js is the GROUND floor's
      //    grid, upper storeys are the stair layer's: a ground-floor door.)
      let navNote = "navgrid not loaded";
      const ovSh = shells.find((s) => oval && inShell(s.b, oval.landmarks.presidentialDesk.x, oval.landmarks.presidentialDesk.z, 0));
      const gd = ovSh && UD.all().find((d) => inShell(ovSh.b, d.x, d.z, 0.5) && d.floorY < 0.5 && !d.pair);
      if (!gd) fail("BODIES: no ground-floor West Wing door for the navigator check");
      else try {
        load("src/systems/navgrid.js");
        const G = CBZ.navGrid;
        CBZ.game.elapsed = 0;
        for (let i = 0; i < 800; i++) G.focus(gd.x, gd.z, 30);
        const gn = gd.runX ? { x: 0, z: 1 } : { x: 1, z: 0 };
        const from = { x: gd.x - gn.x * 1.6, z: gd.z - gn.z * 1.6 }, to = { x: gd.x + gn.x * 1.6, z: gd.z + gn.z * 1.6 };
        const free1 = gd.free;
        gd.free = true;
        if (gd.open) setOpen(gd, false);
        const pS = G.plan(from, to, { actor: { organization: "state" } });
        if (!(pS && !pS.partial && pS.length <= 2)) fail("BODIES: the navigator would not plan a staffer straight through a shut free door (" + (pS ? pS.length + " pts, partial " + !!pS.partial : "null") + ")");
        gd.free = function () { return false; };
        const pX = G.plan(from, to, { actor: {} });
        if (pX && !pX.partial && pX.length <= 2) fail("BODIES: the navigator planned a stranger straight through a SECURED door (" + gd.label + ")");
        const pC = G.plan(from, to, { actor: { kind: "cop" } });
        if (!(pC && !pC.partial && pC.length <= 2)) fail("BODIES: the navigator would not plan police through a secured door");
        gd.free = free1;
        navNote = "nav (" + gd.label + "): staff through (" + pS.length + " pts), stranger " + (pX ? (pX.partial ? "partial" : pX.length + " pts round") : "no route") + ", police through";
      } catch (e) { fail("BODIES: navgrid check threw " + e.message); }
      door.free = free0; if (door.pair) door.pair.free = free0;
      // d) the prison rule (bodyDoors.prisonMay) and the motor hook on a cell front
      const PM = BD.prisonMay;
      const officer = { kind: "guard", isGuard: true }, warden = { kind: "warden" }, gatePost = { isGuard: true, post: "gate" }, inmate = { name: "inmate" };
      const specs = {
        cell: { id: "prison-cell-3", keys: () => ["Cell Key"], isOpen: () => false },
        card: { id: "prison-sally-x", keyed: true, keys: ["Keycard"], isOpen: () => false },
        gate: { id: "prison-port-x", keyed: true, keys: ["Gate Key"], isOpen: () => false },
        room: { id: "prison-admin-records", isOpen: () => false },
      };
      const expect = [
        ["cell", inmate, false], ["cell", officer, false], ["cell", warden, false],
        ["card", inmate, false], ["card", officer, true], ["card", { kind: "guard", tied: true }, false],
        ["gate", officer, false], ["gate", gatePost, true], ["gate", warden, true], ["gate", inmate, false],
        ["room", inmate, true], ["room", officer, true],
      ];
      for (const [k, a, want] of expect) if (!!PM(specs[k], a) !== want) fail("BODIES: prison rule " + k + " door for " + JSON.stringify(a) + " says " + !want + ", wants " + want);
      // the hook: an inmate walking at a cell front is refused, the leaf never moves
      let sets = 0;
      const cellCol = { minX: 500, maxX: 501.6, minZ: 499.95, maxZ: 500.05, y0: 0, y1: 2.5 };
      const cellSpec = { id: "prison-cell-99", keys: () => ["Cell Key"], isOpen: () => false, set: () => { sets++; return false; }, col: () => cellCol };
      (CBZ._prisonDoorSpecs || (CBZ._prisonDoorSpecs = [])).push(cellSpec);
      BD.sync();
      if (!cellCol._bd) fail("BODIES: a prison door spec was not tagged by bodyDoors.sync");
      const inm = { name: "inmate" }, ip = new THREE.Vector3(500.8, 0, 499), im = MV.motor(inm);
      inm.pos = ip; MV.reset(im, ip);
      let refusedI = false;
      for (let i = 0; i < 40; i++) { MV.step(im, ip, 0, 500.8, 501.5, { speed: 1.4 }, 0.05); if (im.doorBlockT > 0) refusedI = true; if (ip.z > 499.6) ip.z = 499.6; }
      if (!refusedI) fail("BODIES: an inmate walking at a cell front was never refused");
      if (sets) fail("BODIES: a cell front was set() by an inmate walking at it");
      // e) THE PLAYER WALKS INTO A DOOR (OWNER: "When you run into doors,
      //    they don't open"). His desired motion (player.moveX/moveZ, what
      //    systems/physics.js publishes) carries him at a shut free door: it
      //    opens, he walks through, it shuts behind him. A secured door does
      //    not open to his body (that is [E] and a clearance), nor a locked flat.
      let pushNote = "";
      {
        const P = CBZ.player, wasMode = CBZ.game.mode;
        CBZ.game.mode = "city";
        const pushWalk = function (side, secs) {
          const p = P.pos;
          p.set(door.x - nrm.x * side * 1.1, feet, door.z - nrm.z * side * 1.1);
          for (let i = 0; i < Math.round(secs / 0.05); i++) {
            P.moveX = nrm.x * side * 3.2; P.moveZ = nrm.z * side * 3.2;
            p.x += P.moveX * 0.05; p.z += P.moveZ * 0.05;
            resolve(p);
            for (const f of bdTick) f(0.05); for (const f of swingTick) f(0.05);
            if ((p.x - door.x) * nrm.x * side + (p.z - door.z) * nrm.z * side > 1.3) { P.moveX = P.moveZ = 0; break; }
          }
          P.moveX = P.moveZ = 0;
          return (p.x - door.x) * nrm.x * side + (p.z - door.z) * nrm.z * side;
        };
        if (door.open) setOpen(door, false);
        settle();
        const pushed0 = BD.stats().pushed | 0;
        const a1 = pushWalk(1, 3);
        if (a1 < 0.9) fail("PLAYER: walking into the shut Oval Office door did not take him through (" + a1.toFixed(2) + " m past it)");
        if (((BD.stats().pushed | 0) - pushed0) < 1) fail("PLAYER: the door never registered a push");
        P.pos.set(1e5, 0, 1e5);
        runTicks(3);
        if (door.open || !live(door.col)) fail("PLAYER: the door he walked through did not shut behind him");
        const a2 = pushWalk(-1, 3);
        if (a2 < 0.9) fail("PLAYER: walking back through the same door failed (" + a2.toFixed(2) + ")");
        P.pos.set(1e5, 0, 1e5); runTicks(3);
        const free2 = door.free;
        door.free = function () { return false; }; if (door.pair) door.pair.free = door.free;
        const a3 = pushWalk(1, 3);
        if (a3 > 0) fail("PLAYER: walked through a SECURED door by bumping it (" + a3.toFixed(2) + " m past)");
        if (door.open) fail("PLAYER: a secured door opened to his body");
        door.free = false; if (door.pair) door.pair.free = false;
        const a4 = pushWalk(1, 3);
        if (a4 > 0 || door.open) fail("PLAYER: walked into a LOCKED door and it opened");
        door.free = free2; if (door.pair) door.pair.free = free2;
        P.pos.set(1e6, 0, 1e6); runTicks(3);
        CBZ.game.mode = wasMode;
        pushNote = "; player: through a free door both ways (it shut behind him), held at a secured and a locked one";
      }
      const st = BD.stats();
      bodyReport = "staff through + shut behind; secured: stranger held, staff/detail/police through; flat: key only; " + navNote + "; prison rule " + expect.length + " cases" + pushNote + "; bodyDoors " + JSON.stringify(st);
    }
  }
}

console.log("shells", shells.length, "interior doors", nDoors, "street doors", nStreet, "rooms", nRooms, "walks", nShellWalks);
console.log("stream:", streamReport);
console.log("bodies:", bodyReport);
console.log("spawn:", spawnReport);
if (fails.length) console.log("FAILURES\n  " + fails.join("\n  "));
console.log(FAIL ? "\nESTATE DOOR CENSUS: " + FAIL + " failures" : "\nESTATE DOOR CENSUS: 100% clean");
process.exit(FAIL ? 1 : 0);
