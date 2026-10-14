// tools/room-recipe-check.js — plain node, no browser. A merged room
// (core/batch.js) is kept as its recipe until somebody looks in, and baked
// from it then. This proves the bake from the recipe writes the SAME bytes as
// merging the source meshes directly, for rooms of trim box lists
// (city/buildings.js mergedBoxGeometry), shared unit boxes and one-off
// geometry under random building transforms and tints.
//   node tools/room-recipe-check.js
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.resolve(__dirname, "..");
const THREE = require(ROOT + "/src/vendor/three.r128.min.js");
function grab(src, startRe, endMarker) {
  const a = src.search(startRe); if (a < 0) throw new Error("no " + startRe);
  const b = src.indexOf(endMarker, a); if (b < 0) throw new Error("no end for " + startRe);
  return src.slice(a, b);
}
const B = fs.readFileSync(ROOT + "/src/city/buildings.js", "utf8");
const BA = fs.readFileSync(ROOT + "/src/core/batch.js", "utf8");
const code = [
  grab(B, /  const _boxNrm = new Map\(\);/, "  // boxes: flat [lx, ly, lz"),
  grab(B, /  function lazyAttr\(Ctor/, "  /* WHAT A SHELL IS BUILT OF"),
  grab(BA, /  const _nm3 = new THREE.Matrix3\(\);/, "  // ---- WHAT IS IN THE FAT BUCKETS"),
  grab(BA, /  function ROOM_RECIPE\(\)/, "  function dropUploaded()"),
  "this.mergedBoxGeometry = mergedBoxGeometry; this.bakeMergeV2 = bakeMergeV2; this.roomRecipe = roomRecipe; this.roomProxies = roomProxies;",
].join("\n");
const ctx = vm.createContext({ THREE, CBZ: {}, Math, Float32Array, Float64Array, Int8Array, Uint8Array, Uint16Array, Uint32Array, Map, Array, Object });
vm.runInContext(code, ctx);
let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const unit = new THREE.BoxGeometry(1, 1, 1); unit._shared = true;
let bad = 0, total = 0, smaller = 0, rooms = 0;
for (let t = 0; t < 30; t++) {
  const bld = new THREE.Group();
  bld.position.set((rnd() - 0.5) * 4000, rnd() * 3, (rnd() - 0.5) * 4000);
  bld.rotation.y = rnd() < 0.5 ? 0 : rnd() * 6.283;
  const meshes = [];
  const nm = 1 + (rnd() * 12 | 0);
  for (let k = 0; k < nm; k++) {
    const kind = rnd();
    let g;
    if (kind < 0.5) {
      const n = 1 + (rnd() * 40 | 0), boxes = [];
      for (let b = 0; b < n; b++) boxes.push((rnd() - 0.5) * 20, rnd() * 12, (rnd() - 0.5) * 20, 0.02 + rnd() * 3, 0.02 + rnd() * 2, 0.02 + rnd() * 3);
      g = ctx.mergedBoxGeometry(boxes, n);
    } else if (kind < 0.85) g = unit;
    else { g = new THREE.CylinderGeometry(0.2 + rnd(), 0.3, 1 + rnd() * 2, 6 + (rnd() * 10 | 0)); }
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: (rnd() * 0xffffff) | 0 }));
    m.position.set((rnd() - 0.5) * 18, rnd() * 10, (rnd() - 0.5) * 18);
    m.scale.set(0.2 + rnd() * 3, 0.2 + rnd() * 3, 0.2 + rnd() * 3);
    if (rnd() < 0.3) m.rotation.set(rnd(), rnd(), rnd());
    bld.add(m); meshes.push(m);
  }
  bld.updateMatrixWorld(true);
  const want = ctx.bakeMergeV2(meshes).geometry;
  const R = ctx.roomRecipe(meshes);
  const got = ctx.bakeMergeV2(ctx.roomProxies(R)).geometry;
  rooms++;
  for (const k of ["position", "normal", "color"]) {
    total++;
    const a = want.attributes[k].array, b = got.attributes[k].array;
    if (a.length !== b.length || a.some((v, i) => v !== b[i])) { bad++; console.log("room", t, k, "differs"); }
  }
  total++;
  const ia = want.index.array, ib = got.index.array;
  if (ia.length !== ib.length || ia.some((v, i) => v !== ib[i])) { bad++; console.log("room", t, "index differs"); }
  // the recipe's sphere holds every baked vertex
  const P = got.attributes.position.array, S = R.geo.boundingSphere;
  for (let i = 0; i < P.length; i += 3) if (Math.hypot(P[i] - S.center.x, P[i + 1] - S.center.y, P[i + 2] - S.center.z) > S.radius + 1e-3) { bad++; console.log("room", t, "vertex outside the recipe sphere"); break; }
  let held = R.mats.byteLength + R.tints.byteLength;
  const baked = P.byteLength / 2 + got.attributes.normal.array.byteLength + got.attributes.color.array.byteLength + got.index.array.byteLength;
  if (held < baked) smaller++;
}
console.log(`room recipes: ${rooms} rooms, ${total} attribute comparisons, ${bad} differ; recipe smaller than the packed bake in ${smaller}/${rooms}`);
if (bad) { console.log("ROOM RECIPE FAIL"); process.exit(1); }
console.log("ROOM RECIPE OK");
