// tools/beach-bake-check.mjs — plain node, no browser: city/beach.js built COLD (computes,
// bakes through a stand-in core/bakecache.js) and WARM (replays the baked arrays) must give
// byte-identical meshes (attributes, index, instance matrices/colours, bounding spheres),
// the same colliders and platforms, and the warm build must be the cheaper one.
//   node tools/beach-bake-check.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";
const ROOT = new URL("../", import.meta.url).pathname;
const read = (f) => readFileSync(ROOT + f, "utf8");
const store = new Map();
function hashArr(a) {
  let h = 2166136261 >>> 0;
  const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(36) + "/" + a.length;
}
function run(label) {
  const ctx = vm.createContext({ console, Math, performance, Float32Array, Uint32Array, Uint16Array, Uint8Array, Map, Set, WeakMap, JSON,
    document: { createElement: () => ({ getContext: () => null }) } });
  ctx.window = ctx; ctx.self = ctx;
  let hits = 0, puts = 0;
  ctx.CBZ = {
    CONFIG: {}, colliders: [], platforms: [], onAlways() {}, onUpdate() {}, markCollidersDirty() {},
    registerCityGroundHeight() { return {}; },
    _plateSig: "plate-test",
    bakeSig: (own) => "base||" + own,
    bakeHash: (v) => JSON.stringify(v),
    bakeGet: (k, sig) => { const e = store.get(k); if (e && e.sig === sig) { hits++; store.delete(k); return e.arrays; } return null; },
    bakePut: (k, sig, arrays) => { puts++; const c = {}; for (const a in arrays) c[a] = arrays[a].slice(); store.set(k, { sig, arrays: c }); },
  };
  vm.runInContext(read("src/vendor/three.r128.min.js"), ctx);
  vm.runInContext(read("src/world/materials.js"), ctx, { filename: "materials.js" });
  vm.runInContext(read("src/city/beach.js"), ctx, { filename: "beach.js" });
  const root = new ctx.THREE.Scene();
  // a wavy coast that costs something per sample, like the real shore field
  const city = { root, shore: { ES: 30, EW: 0, EE: 0, EN: 0, beach: { x0: -150, x1: 10 } }, center: { x: 0, z: 0 },
    minX: -300, minZ: -200, maxX: 300, maxZ: 200,
    mapTerrain: { shoreAt: (x, z) => { let s = 0; for (let k = 0; k < 200; k++) s += Math.sin(x * 0.01 * k + k); return (-235 - 4 * Math.sin(x * 0.05)) - z + s * 1e-9; } } };
  const t0 = performance.now();
  ctx.CBZ.cityBuildBeach(city);
  const ms = performance.now() - t0;
  const out = {};
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry;
    out[o.name + "#" + Object.keys(out).length] = ["position", "normal", "color", "aShore"].map((a) => g.attributes[a] ? hashArr(g.attributes[a].array) : "-").join("|") +
      "|i" + (g.index ? hashArr(g.index.array) : "-") +
      (o.isInstancedMesh ? "|im" + hashArr(o.instanceMatrix.array) + "|ic" + (o.instanceColor ? hashArr(o.instanceColor.array) : "-") + "|n" + o.count : "") +
      "|bs" + (g.boundingSphere ? g.boundingSphere.radius.toFixed(5) + "," + g.boundingSphere.center.x.toFixed(5) : "-");
  });
  console.log(label, "build", ms.toFixed(1), "ms  bake hits", hits, "puts", puts, " colliders", ctx.CBZ.colliders.length, "platforms", ctx.CBZ.platforms.length);
  return { ms, hits, out, col: ctx.CBZ.colliders.map((c) => [c.minX, c.maxX, c.minZ, c.maxZ, c.y0, c.y1].map((v) => v == null ? "n" : (+v).toFixed(4)).join(",")).join(";"),
    plat: ctx.CBZ.platforms.map((p) => [p.minX, p.maxX, p.minZ, p.maxZ, p.top].map((v) => (+v).toFixed(4)).join(",")).join(";") };
}
const A = run("cold"), B = run("warm");
let bad = 0;
const fail = (m) => { bad++; console.log("FAIL", m); };
if (B.hits !== 1) fail("the warm build did not take the bake");
for (const k in A.out) if (A.out[k] !== B.out[k]) fail("mesh differs: " + k + "\n  cold " + A.out[k] + "\n  warm " + B.out[k]);
if (Object.keys(A.out).length !== Object.keys(B.out).length) fail("mesh count differs");
if (A.col !== B.col) fail("colliders differ");
if (A.plat !== B.plat) fail("platforms differ");
if (!(B.ms < A.ms * 0.5)) fail("the warm build is not much cheaper (" + A.ms.toFixed(1) + " -> " + B.ms.toFixed(1) + " ms)");
console.log(bad ? "FAIL " + bad : "OK beach bake replays identically (" + Object.keys(A.out).length + " meshes)");
process.exit(bad ? 1 : 0);
