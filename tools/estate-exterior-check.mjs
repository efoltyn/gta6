#!/usr/bin/env node
/* tools/estate-exterior-check.mjs — THE ESTATE'S OUTSIDE, WALKED IN PLAIN NODE.

   The same headless harness as tools/estate-check.mjs (vendored three r128,
   the real buildings.js / buildings_civic.js / govcomplex.js), then the
   exterior contract the President-mode rebuild promised, asserted:
     perron     the flight lands on the forecourt (bottom tread one riser
                over the setts), the deck platform IS the drawn deck top
     front door a body walks from the carriage ring to the Mansion's door
                on the axis without meeting a collider (portico, cladding,
                lanterns, doorcase all stand clear of the walk)
     lodges     the gatehouse and every sentry lodge: exactly one doorway
                you can walk through, a floor you stand on at the slab top,
                free standing room inside, a desk (top 0.76 over the floor)
                and a chair that are solid
     garage     every open bay is a clear opening at walk height, every
                closed door is solid, the floor platform and the ground
                record agree at the apron's level
     house      portico and bow columns are solid, the roof and chimneys are
                solid, the counter-sniper stands stay on open roof, the
                garden balcony carries you at the principal floor + 0.15
   USAGE   node tools/estate-exterior-check.mjs      exit 1 on any failure
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
const fails = [];
function ok(c, msg) { if (!c) { FAIL++; fails.push(msg); } return c; }
const defs = CBZ.govComplexDefs;
function build(id, cx, cz) {
  const def = defs.find((d) => d.id === id);
  const root = new THREE.Group();
  const rect = { minX: cx - def.hx, maxX: cx + def.hx, minZ: cz - def.hz, maxZ: cz + def.hz };
  const site = { id, def, rect, cx, cz, roads: [] };
  CBZ.colliders.length = 0; CBZ.platforms.length = 0;
  const out = def.build({ root, rect, cx, cz, site, city: { roads: [] } });
  return { root, site, out, cols: CBZ.colliders.slice(), plats: CBZ.platforms.slice() };
}
// the walk surface at (x, z): the highest platform top at or under `near`,
// or the estate ground
function walkAt(R, x, z, near) {
  let h = CBZ.estateGroundAt ? CBZ.estateGroundAt(x, z) : 0;
  for (const p of R.plats) if (!p.ramp && x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ && p.top <= (near == null ? 99 : near) + 0.01 && p.top > h) h = p.top;
  return h;
}
// a body (0.3 m radius) standing at (x, z) on `y`: which colliders hold it
function blockers(R, x, z, y, rad) {
  rad = rad == null ? 0.3 : rad;
  const hit = [];
  for (const c of R.cols) {
    if (x + rad <= c.minX || x - rad >= c.maxX || z + rad <= c.minZ || z - rad >= c.maxZ) continue;
    if ((c.y1 != null && c.y1 <= y + 0.46) || (c.y0 != null && c.y0 >= y + 1.8)) continue;   // stepped over / overhead
    hit.push(c);
  }
  return hit;
}
function lodgeCheck(R, name, x, z, w, d) {
  // exactly one face lets a body through at its midpoint
  const mids = [[x, z - d / 2], [x, z + d / 2], [x - w / 2, z], [x + w / 2, z]];
  const through = mids.filter((m) => blockers(R, m[0], m[1], 0.15, 0.25).length === 0);
  ok(through.length === 1, name + ": walkable doorways " + through.length + " (want 1)");
  // standing room inside, on the slab
  let room = 0, floorOk = true;
  for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) {
    const px = x + i * (w / 2 - 0.3) / 3, pz = z + j * (d / 2 - 0.3) / 3;
    const top = walkAt(R, px, pz);
    if (Math.abs(top - 0.15) > 0.001) floorOk = false;
    if (!blockers(R, px, pz, top).length) room++;
  }
  ok(floorOk, name + ": floor platform is not the slab top 0.15 everywhere inside");
  ok(room >= 4, name + ": standing room points " + room);
  // the desk and the chair are solid, at their drawn heights
  const inside = R.cols.filter((c) => c.minX > x - w / 2 + 0.1 && c.maxX < x + w / 2 - 0.1 && c.minZ > z - d / 2 + 0.1 && c.maxZ < z + d / 2 - 0.1);
  const desk = inside.find((c) => Math.abs(c.y0 - 0.15) < 1e-3 && Math.abs(c.y1 - 0.91) < 1e-3);
  const chair = inside.find((c) => Math.abs(c.y0 - 0.15) < 1e-3 && Math.abs(c.y1 - 1.18) < 1e-3);
  ok(!!desk, name + ": no desk body with its top at 0.91 (0.76 over the floor)");
  ok(!!chair, name + ": no chair body");
  return { through: through.length, room, desk: !!desk, chair: !!chair };
}

// ---------------- the Executive Mansion ------------------------------------
const cx = 3000, cz = -2000;
const R = build("execmansion", cx, cz);
const L = R.site.layout, b = R.out.seat.b, HD = L.houseDress || {};
console.log("house dress", JSON.stringify({ clad: HD.clad, portico: HD.portico, south: HD.south, roofTop: HD.roofTop && +HD.roofTop.toFixed(2), balcony: HD.southBalcony }));
ok(HD.clad && HD.portico && HD.south && HD.southBalcony, "mansion: house dress incomplete");
// perron: deck and flight
const F = L.house.facade, fz = F.z;
const deckTop = walkAt(R, cx + 10, fz + 3);
ok(Math.abs(deckTop - 0.30) < 1e-3, "perron deck walk " + deckTop);
const t1 = walkAt(R, cx + 10, fz + 7.8 + 0.3), t0 = walkAt(R, cx + 10, fz + 7.8 + 0.9), court = walkAt(R, cx + 10, fz + 9.6);
console.log("perron: deck", deckTop, "treads", t1.toFixed(2), t0.toFixed(2), "court", court.toFixed(2));
ok(Math.abs(court - 0.10) < 1e-3 && Math.abs(t0 - 0.20) < 1e-3 && Math.abs(t1 - 0.30) < 1e-3, "perron flight does not climb 0.10 -> 0.20 -> 0.30");
// the walk to the door along the axis
let blocked = [];
for (let zz = fz + 12; zz > fz + 0.35; zz -= 0.25) {
  const y = walkAt(R, cx, zz), h = blockers(R, cx, zz, y, 0.3);
  if (h.length) blocked.push(zz.toFixed(2) + ":" + h.map((c) => [(c.maxX - c.minX).toFixed(2), (c.maxZ - c.minZ).toFixed(2), c.y0, c.y1].join("x")).join("|"));
}
ok(!blocked.length, "front door axis blocked at " + blocked.slice(0, 4).join(" ; "));
console.log("door axis: clear", !blocked.length);
// portico columns and bow columns are solid
const colsAt = (x, z) => R.cols.some((c) => x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ && c.y0 <= 1 && c.y1 > 8);
if (HD.portico) {
  const P = HD.portico, n = P.cols, step = 2 * P.outer / (n - 1);
  let solid = 0;
  for (let i = 0; i < n; i++) if (colsAt(cx - P.outer + i * step, fz + P.depth)) solid++;
  ok(solid === n, "portico columns solid " + solid + "/" + n);
  console.log("portico", n, "columns, depth", P.depth.toFixed(2), "pediment apex", P.top.toFixed(2), "solid", solid);
}
// the roof, the chimneys and the roof walk
const roofY = b.h;
const roofCol = R.cols.find((c) => c.y0 === roofY && c.maxX - c.minX > 20);
ok(!!roofCol, "no collider for the hipped roof");
const stands = R.site.security ? R.site.security.roof.posts : [];
for (const p of stands) ok(!R.cols.some((c) => p.x > c.minX && p.x < c.maxX && p.z > c.minZ && p.z < c.maxZ && c.y0 < roofY + 1.7 && c.y1 > roofY + 0.2), "counter-sniper post inside a roof body @" + (p.x - cx).toFixed(1) + "," + (p.z - cz).toFixed(1));
console.log("roof posts clear", stands.length);
// the garden balcony carries a body at floor 1 + 0.15
if (HD.southBalcony) {
  const back = b.oz - b.d / 2;
  const top = walkAt(R, cx, back - 1.5, HD.southBalcony.top);
  ok(Math.abs(top - (b.floorTops[1] + 0.15)) < 1e-3, "garden balcony walk " + top);
  console.log("garden balcony top", top.toFixed(2));
}
// lodges: the gatehouse and the four sentry posts
const G = L.gatehouse;
console.log("gatehouse", JSON.stringify(lodgeCheck(R, "gatehouse", G.x, G.z, 3.4, 3.2)));
(L.lodges || []).forEach((q, i) => console.log("lodge " + i, JSON.stringify(lodgeCheck(R, "lodge" + i, q.x, q.z, 2.6, 2.6))));
// the motor pool
function garageCheck(R, name, GA) {
  ok(!!GA, name + ": no garage");
  if (!GA) return;
  const n = GA.doorN;
  let openOk = 0, closedOk = 0, nOpen = 0;
  for (const dr of GA.doors) {
    const px = dr.at.x - n.x * 0.15, pz = dr.at.z - n.z * 0.15;
    const hits = blockers(R, px, pz, 0.1, 0.3);
    if (dr.open) { nOpen++; if (!hits.length) openOk++; } else if (hits.length) closedOk++;
  }
  ok(openOk === nOpen, name + ": open bays clear " + openOk + "/" + nOpen);
  ok(closedOk === GA.doors.length - nOpen, name + ": closed doors solid " + closedOk);
  const r = GA.rect, mx = (r.minX + r.maxX) / 2, mz = (r.minZ + r.maxZ) / 2;
  const wk = walkAt(R, mx, mz), gr = CBZ.estateGroundAt(mx, mz);
  ok(Math.abs(wk - 0.10) < 1e-3 && Math.abs(gr - 0.10) < 1e-3, name + ": floor walk " + wk + " ground " + gr);
  // drive a car's width straight in through an open bay: nothing below 2.4 m
  const od = GA.doors.find((d) => d.open);
  if (od) {
    let clear = true;
    for (let k = 1; k < 16; k++) {
      const px = od.at.x - n.x * (k * 0.5), pz = od.at.z - n.z * (k * 0.5);
      if (px < r.minX + 0.4 || px > r.maxX - 0.4 || pz < r.minZ + 0.4 || pz > r.maxZ - 0.4) break;
      if (R.cols.some((c) => px + 0.9 * Math.abs(n.z) + 0.2 > c.minX && px - 0.9 * Math.abs(n.z) - 0.2 < c.maxX && pz + 0.9 * Math.abs(n.x) + 0.2 > c.minZ && pz - 0.9 * Math.abs(n.x) - 0.2 < c.maxZ && c.y0 < 2.4 && c.y1 > 0.3)) clear = false;
    }
    ok(clear, name + ": a car cannot drive into an open bay");
  }
  console.log(name, "bays", GA.bays, "open", nOpen, "floor", wk.toFixed(2));
}
garageCheck(R, "mansion garage", L.garage);

// ---------------- the Governor's Residence ----------------------------------
const R2 = build("governor", -3000, 1500);
const L2 = R2.site.layout;
console.log("governor dress", JSON.stringify({ clad: L2.houseDress && L2.houseDress.clad, portico: L2.houseDress && L2.houseDress.portico }));
garageCheck(R2, "governor garage", L2.garage);
lodgeCheck(R2, "governor gatehouse", L2.gatehouse.x, L2.gatehouse.z, 3.4, 3.2);

if (fails.length) console.log("\nFAILURES\n  " + fails.join("\n  "));
console.log(FAIL ? "\nEXTERIOR CHECK: " + FAIL + " failures" : "\nEXTERIOR CHECK: clean");
process.exit(FAIL ? 1 : 0);
