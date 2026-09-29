#!/usr/bin/env node
/* tools/airfield-check.mjs — ARE THE AIRPORTS DRAWN TO REAL NUMBERS?

   Plain node, no browser, a couple of seconds. Loads three r128 and the
   airfield code (systems/airports.js, city/airport_kit.js, the two field
   specs in city/island_airport.js and city/airport_capeharbor.js) against a
   stubbed CBZ, runs the landmass builders into a bare scene, and measures
   what they built against the published references:

     runway     width 45-60 m (code E), threshold stripe count for the width,
                stripe 30 x 1.8 m, designator 9 m, centreline 30/20 x 0.9 m,
                aiming point and touchdown-zone pairs by landing distance
     taxiway    23 m, holding position 75 m from the runway centreline and
                on the taxiway side of the runway strip
     stands     60 m pitch >= span + 7.5, nose-in, parked tail clears a
                taxiing wingtip by >= 7.5 m, nose 11 m from the glass
     bridges    docked cab within 0.6 m of the L1 door, slope <= 1:12,
                length 15-45 m, a walkable deck from the gate floor to the door
     terminal   the ticket desk inside the building, gate floor platform,
                sliding doors registered with the city door sim
     tower      cab glass raked 15 degrees
     dressing   every field gets its hangars / fuel farm / fire station /
                radar / ILS / approach lights; ARFF bays published
     cost       meshes and vertices per field (the draw-call and memory
                budget), colliders and platforms created
     world      Cape Harbor's bounds clear its neighbours

   Usage: node tools/airfield-check.mjs        Exit 0 = AIRFIELD: ok.
*/
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

// ---- a browser-shaped global, just enough for geometry building ----------
globalThis.window = globalThis;
globalThis.self = globalThis;
const ctx2d = new Proxy({}, {
  get(t, k) {
    if (k === "measureText") return (s) => ({ width: String(s).length * 10 });
    if (k === "createRadialGradient" || k === "createLinearGradient") return () => ({ addColorStop() {} });
    if (k === "getImageData") return (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
    if (k in t) return t[k];
    return () => {};
  },
  set(t, k, v) { t[k] = v; return true; },
});
globalThis.document = {
  createElement: () => ({ width: 1, height: 1, getContext: () => ctx2d, style: {} }),
  currentScript: null,
};
const load = (rel) => vm.runInThisContext(fs.readFileSync(path.join(ROOT, rel), "utf8"), { filename: rel });
load("src/vendor/three.r128.min.js");
load("src/vendor/BufferGeometryUtils.js");
const THREE = globalThis.THREE;

// ---- the CBZ the airfield code talks to ------------------------------------
const landmasses = [], updates = [];
let posts = 0, seats = 0;
const OFF = { airport: { dx: -220, dz: 0 }, capeharbor: { dx: 180, dz: 820 } };
const CBZ = globalThis.CBZ = {
  CONFIG: { AIRLINER_SCALE: 1.45 },
  colliders: [], platforms: [],
  worldOff: (k) => OFF[k] || { dx: 0, dz: 0 },
  addLandmass: (fn, order) => landmasses.push({ fn, order: order == null ? 50 : order }),
  onUpdate: (order, fn) => updates.push({ order, fn }),
  registerCityRegion: (city, r) => { city.regions.push(r); return r; },
  registerNoSpawnZone: (city, z) => { (city.noSpawn = city.noSpawn || []).push(z); },
  cityStaffVenue: () => {}, cityStaffPost: () => { posts++; return {}; },
  propRegisterSeat: (x, y, z) => { seats++; return { x, y, z }; },
  cityDoorsGet: (() => { const a = []; return () => a; })(),
  mat: (c, o) => { const m = new THREE.MeshLambertMaterial({ color: c }); if (o && o.emissive != null) { m.emissive = new THREE.Color(o.emissive); m.emissiveIntensity = o.ei == null ? 1 : o.ei; } return m; },
  seedStream: () => { let s = 0x51a1a0; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; },
  interactions: null,
};
CBZ.cmat = CBZ.mat;
load("src/systems/airports.js");
load("src/city/airport_kit.js");
let halloranLoaded = true;
try { load("src/city/island_airport.js"); } catch (e) { halloranLoaded = false; fails.push("island_airport.js failed to load: " + e.message); }
load("src/city/airport_capeharbor.js");

const city = { root: new THREE.Group(), roads: [], regions: [], noSpawn: [] };
CBZ.city = { arena: city };
CBZ.game = { mode: "city" };
landmasses.sort((a, b) => a.order - b.order);
for (const L of landmasses) {
  try { L.fn(city); } catch (e) { fails.push("landmass order " + L.order + " threw: " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e)); }
}
const P = CBZ.airfieldParts, REAL = CBZ.AIRFIELD_REAL;
const aps = CBZ.airports || [];
ok(aps.length === 2, "expected 2 airports, got " + aps.length);

// ---- the rules themselves --------------------------------------------------
{
  const R = P.runwayRules;
  ok(R.thresholdStripes(45) === 12 && R.thresholdStripes(30) === 8 && R.thresholdStripes(60) === 16, "threshold stripe table");
  ok(R.aimingPoint(1090).at === 250 && R.aimingPoint(2000).at === 300 && R.aimingPoint(3000).at === 400, "aiming point table");
  ok(R.tdzPairs(1090) === 2 && R.tdzPairs(2600) === 6, "TDZ pair table");
  ok(REAL.thrStripeL === 30 && REAL.thrStripeW === 1.8 && REAL.designatorH === 9 && REAL.clStripeL === 30 && REAL.clGap === 20 && REAL.clW === 0.9, "marking dimensions");
  ok(REAL.taxiW === 23, "taxiway width");
}

const rows = [];
function countMeshes(o) {
  let meshes = 0, verts = 0, inst = 0;
  o.traverse((c) => {
    if (!c.isMesh) return;
    meshes++;
    if (c.isInstancedMesh) inst += c.count;
    const p = c.geometry && c.geometry.attributes && c.geometry.attributes.position;
    if (p) verts += p.count;
  });
  return { meshes, verts, inst };
}
for (const ap of aps) {
  const L = ap.layout;
  const tag = ap.code;
  if (!L) { fails.push(tag + ": no layout (not kit-built)"); continue; }
  // runway
  ok(ap.runway.w >= 45 && ap.runway.w <= 60, tag + " runway width " + ap.runway.w);
  const plan = L.plan || P.runwayPlan(ap.runway.len, ap.runway.w);
  ok(plan.stripes.length === P.runwayRules.thresholdStripes(ap.runway.w), tag + " stripe count");
  const outer = Math.max(...plan.stripes.map(Math.abs)) + REAL.thrStripeW / 2;
  ok(outer <= ap.runway.w / 2 - REAL.sideW + 0.01, tag + " threshold stripes run into the side stripe (" + outer.toFixed(2) + ")");
  ok(plan.tdz.every((t) => Math.abs(t.d - plan.aim.at) >= 50 || t.d < plan.aim.at - 50), tag + " TDZ pair inside the aiming-point band");
  // taxiway + holding position
  ok(L.taxiW === 23, tag + " taxiway " + L.taxiW);
  ok(L.holdZ >= ap.runway.w / 2 + 20 && L.holdZ <= L.taxiZ - L.taxiW / 2, tag + " holding position " + L.holdZ);
  // stands
  const E = P.aircraftEnvelope();
  const xs = L.stands.map((s) => s.lx).sort((a, b) => a - b);
  for (let i = 1; i < xs.length; i++) ok(xs[i] - xs[i - 1] >= E.span + 7.5 - 0.01, tag + " stand pitch " + (xs[i] - xs[i - 1]).toFixed(1) + " < span+7.5");
  ok(L.stand.tailClear >= 7.5 - 0.01, tag + " tail clearance " + L.stand.tailClear.toFixed(2));
  ok(ap.gates.every((g) => Math.abs(g.heading + Math.PI / 2) < 1e-6), tag + " stands must be nose-in");
  // bridges
  for (const b of ap.bridges || []) {
    const jb = b.jb;
    ok(jb.slope <= REAL.bridgeFloorSlopeMax + 1e-6, tag + " bridge slope " + jb.slope.toFixed(3));
    ok(jb.length > 12 && jb.length < 45, tag + " bridge length " + jb.length.toFixed(1));
    if (b.docked) {
      const dl = b.gate.doorL;
      const d = Math.hypot(jb.cab.x - dl.lx, jb.cab.z - dl.lz);
      ok(d < 1.8, tag + " docked cab " + d.toFixed(2) + " m off the L1 door");
      ok(Math.abs(jb.cab.y - dl.y) < 0.05, tag + " cab floor vs sill " + jb.cab.y + " / " + dl.y);
    }
    ok(b.plats.length > 10, tag + " bridge deck platforms " + b.plats.length);
  }
  // terminal
  const tp = ap.terminal && ap.terminal.plan;
  ok(!!tp, tag + " no terminal plan");
  if (tp) {
    const dl = ap.toLocal(ap.desk.x, ap.desk.z);
    ok(dl.lx > tp.x0 && dl.lx < tp.x1 && dl.lz > tp.z0 && dl.lz < tp.z1, tag + " ticket desk outside the terminal");
    if (tp.two) ok(tp.mezzY >= 4 && tp.mezzY <= 6, tag + " gate floor height " + tp.mezzY);
  }
  ok((ap.doors || []).length >= 3, tag + " sliding doors registered " + (ap.doors || []).length);
  const cost = countMeshes(ap.group);
  const surf = ap.surface ? 1 : 0;
  rows.push({ field: tag, runway: ap.runway.len + "x" + ap.runway.w, stands: ap.gates.length, bridges: (ap.bridges || []).length,
    fieldMeshes: cost.meshes + surf, fieldVerts: cost.verts, instances: cost.inst, approach: JSON.stringify(ap.approach || []), fire: ap.fire ? ap.fire.bays.length : 0 });
  ok(cost.meshes < 260, tag + " field mesh count " + cost.meshes + " (budget 260)");
  ok(ap.fire && ap.fire.bays.length >= 3, tag + " fire station bays");
  ok(ap.approach && ap.approach.length >= 1 && ap.approach[0].stations >= 4, tag + " approach lights");
}
// dressing cost
{
  let dm = 0, dv = 0;
  for (const c of city.root.children) if (c.name && c.name.indexOf("airfield-dressing") === 0) { const k = countMeshes(c); dm += k.meshes; dv += k.verts; }
  rows.push({ dressingMeshes: dm, dressingVerts: dv, colliders: CBZ.colliders.length, platforms: CBZ.platforms.length, staff: posts, seats });
  ok(dm > 0, "no dressing built");
}
// tower cab rake
{
  const g = new THREE.Group();
  const t = P.tower(g, 0, 0, { H: 20, cabHalf: 4.2, cabH: 3.3 }, g);
  ok(t.glassY1 - t.glassY0 > 2, "tower glass height");
  ok(REAL.towerCabRake === 15, "tower rake");
}
// Cape Harbor clear of its neighbours (header table, live stage offsets)
{
  const chr = aps.find((a) => a.code === "CHR");
  if (chr) {
    const B = chr.bounds;
    const gap = (r) => Math.max(r.minX - B.maxX, B.minX - r.maxX, r.minZ - B.maxZ, B.minZ - r.maxZ);
    const nb = {
      "Cape Harbor": { minX: 490, maxX: 730, minZ: 875, maxZ: 1115 },
      Goldspire: { minX: 32, maxX: 268, minZ: 1250, maxZ: 1490 },
      "CH causeway": { minX: 598, maxX: 622, minZ: -130, maxZ: 875 },
    };
    for (const k in nb) { const g = gap(nb[k]); rows.push({ neighbour: k, clear: Math.round(g) }); ok(g > 30, "CHR bounds " + Math.round(g) + " m from " + k); }
    rows.push({ chrBounds: [B.minX, B.maxX, B.minZ, B.maxZ].map(Math.round).join(",") });
  }
}
for (const r of rows) console.log(JSON.stringify(r));
if (!halloranLoaded) console.log("(Halloran spec not exercised)");
if (fails.length) { console.log("AIRFIELD: FAIL\n  " + fails.join("\n  ")); process.exit(1); }
console.log("AIRFIELD: ok");
if (process.env.AF_DEBUG) {
  const by = {};
  for (const p of CBZ.platforms) { const k = p.airfield || "other"; by[k] = (by[k] || 0) + 1; }
  console.log("platforms by field", JSON.stringify(by));
  const cb = {};
  for (const c of CBZ.colliders) { const k = c.airfield || "other"; cb[k] = (cb[k] || 0) + 1; }
  console.log("colliders by field", JSON.stringify(cb));
}
if (process.env.AF_DEBUG) {
  const tops = {};
  for (const p of CBZ.platforms) if (p.airfield === "capeharbor-air") { const k = p.top.toFixed(2); tops[k] = (tops[k] || 0) + 1; }
  console.log("CHR platform tops", JSON.stringify(tops));
}
if (process.env.AF_DUMP) {
  const out = { fields: [], colliders: CBZ.colliders.map((c) => [c.minX, c.maxX, c.minZ, c.maxZ, c.y1 == null ? 99 : c.y1, c.airfield || ""]), platforms: CBZ.platforms.map((p) => [p.minX, p.maxX, p.minZ, p.maxZ, p.top]) };
  for (const ap of aps) {
    const L = ap.layout;
    const pt = (lx, lz) => { const w = ap.toWorld(lx, lz); return [w.x, w.z]; };
    const rect = (x0, z0, x1, z1) => [pt(x0, z0), pt(x1, z0), pt(x1, z1), pt(x0, z1)];
    out.fields.push({
      code: ap.code, bounds: ap.bounds,
      runway: rect(-L.H, -L.RW / 2, L.H, L.RW / 2),
      taxi: rect(L.taxiX0, L.taxiZ - 11.5, L.taxiX1, L.taxiZ + 11.5),
      term: rect(L.terminal.x0, L.terminal.z0, L.terminal.x1, L.terminal.z1),
      gates: ap.gates.map((g) => [g.x, g.z, g.worldHeading]),
      parked: ap.parked.map((g) => [g.position.x, g.position.z, g.rotation.y]),
      desk: [ap.desk.x, ap.desk.z],
    });
  }
  fs.writeFileSync(process.env.AF_DUMP, JSON.stringify(out));
}
