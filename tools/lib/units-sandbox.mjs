/* tools/lib/units-sandbox.mjs — NPC War's vehicle units, as Gang City builds
   them, in plain node: three.js r128 (math and scene graph), the airframe kit
   (city/mil_air.js), the unit registry and kits (src/units/*), every vehicle
   file, then city/unitmodels.js (CBZ.milModels, the one unit build), then
   city/island_military.js (the fleet)
   and city/strategic.js (the B-2). No browser, no city.

   sandbox() -> { G, CBZ, THREE, errors }  errors: files that threw at load
   Shared by tools/mil-air-check.mjs and tools/fort-fleet-check.mjs. */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function sandbox(opts) {
  opts = opts || {};
  const G = { console, Math, Date, JSON, Float32Array, Float64Array, Uint16Array, Uint32Array, Uint8Array, Int32Array, Int16Array, Uint8ClampedArray,
    Array, Object, Map, Set, WeakMap, Promise, Proxy, Reflect, Symbol, Error, Number, String, Boolean, isFinite, isNaN, parseInt, parseFloat, setTimeout, clearTimeout };
  G.window = G; G.self = G; G.globalThis = G;
  G.addEventListener = () => {}; G.removeEventListener = () => {};
  // a 2D context where every call is a no-op and every gradient takes stops
  const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (k === "createRadialGradient" || k === "createLinearGradient" || k === "createPattern") ? () => ({ addColorStop() {} })
    : k === "getImageData" ? (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, (w | 0) * (h | 0) * 4)) }) : k === "measureText" ? () => ({ width: 10 }) : () => {}),
  set: (t, k, v) => { t[k] = v; return true; } });
  G.document = { createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => ctx2d }), scripts: [], head: { appendChild() {} } };
  vm.createContext(G);
  vm.runInContext(readFileSync(path.join(ROOT, "src/vendor/three.r128.min.js"), "utf8"), G);
  const THREE = G.THREE;
  const mats = new Map();
  const updaters = [];
  G.CBZ = {
    CONFIG: {}, colliders: [], updaters: updaters,
    onUpdate(order, fn) { updaters.push({ order: order, fn: fn }); },
    onAlways() {},
    cmat: (hex, o) => { const k = hex + JSON.stringify(o || {}); if (!mats.has(k)) mats.set(k, new THREE.MeshLambertMaterial({ color: hex })); return mats.get(k); },
    floorAt: () => 0,
    scene: new THREE.Scene(),
  };
  G.CBZ.mat = G.CBZ.cmat;
  const errors = {};
  function run(rel, optional) {
    try { vm.runInContext(readFileSync(path.join(ROOT, rel), "utf8"), G, { filename: rel }); }
    catch (e) { errors[rel] = String((e && e.stack) || e).split("\n").slice(0, 3).join(" | "); if (!optional) throw e; }
  }
  for (const f of ["src/world/carfx.js", "src/weapons/munitions.js", "src/city/flags.js"]) run(f, true);
  for (const f of ["src/city/mil_air.js", "src/units/unitkit.js", "src/units/manifest.js", "src/units/kit/vehicle.js",
    "src/units/kit/hull.js", "src/units/kit/loft.js"]) run(f, /loft/.test(f));
  const dir = path.join(ROOT, "src/units/vehicles");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".js")).sort()) run("src/units/vehicles/" + f, true);
  run("src/world/basekit.js", true);
  run("src/city/unitmodels.js");
  run("src/city/island_military.js");
  if (opts.strategic) run("src/city/strategic.js", true);
  return { G, CBZ: G.CBZ, THREE, errors };
}

export function census(THREE, g) {
  let meshes = 0, tris = 0; const geos = new Set();
  g.traverse((o) => {
    if (!(o.isMesh || o.isSprite)) return;
    meshes++;
    if (o.geometry) { geos.add(o.geometry); const n = o.geometry.index ? o.geometry.index.count : (o.geometry.attributes.position ? o.geometry.attributes.position.count : 0); tris += n / 3 * (o.isInstancedMesh ? o.count : 1); }
  });
  return { meshes, tris: Math.round(tris), geos };
}
export function box(THREE, g) { g.updateMatrixWorld(true); return new THREE.Box3().setFromObject(g); }
