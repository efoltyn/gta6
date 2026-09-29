// tools/trimbox-merge-check.js — plain node, no browser. city/buildings.js's
// trim boxes are merged by core/batch.js straight from their box list (no
// per-building arrays). This proves that path writes the SAME bytes as merging
// the materialized arrays, on random boxes under random building transforms.
//   node tools/trimbox-merge-check.js
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
  grab(B, /  function lazyAttr\(Ctor/, "  // ---- the enterable building"),
  grab(BA, /  const _nm3 = new THREE.Matrix3\(\);/, "  // ---- WHAT IS IN THE FAT BUCKETS"),
  "this.mergedBoxGeometry = mergedBoxGeometry; this.bakeMergeV2 = bakeMergeV2;",
].join("\n");
const ctx = vm.createContext({ THREE, Math, Float32Array, Float64Array, Int8Array, Uint8Array, Uint16Array, Uint32Array, Map, Array, Object });
vm.runInContext(code, ctx);
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
let bad = 0, total = 0;
for (let t = 0; t < 40; t++) {
  const meshes = [], ref = [];
  const nm = 1 + (rnd() * 6 | 0);
  for (let k = 0; k < nm; k++) {
    const n = 1 + (rnd() * 30 | 0), boxes = [];
    for (let i = 0; i < n; i++) boxes.push((rnd() - 0.5) * 20, rnd() * 30, (rnd() - 0.5) * 20, 0.05 + rnd() * 3, 0.05 + rnd() * 3, 0.05 + rnd() * 3);
    const mat = new THREE.MeshLambertMaterial({ color: (rnd() * 0xffffff) | 0 });
    const a = new THREE.Mesh(ctx.mergedBoxGeometry(boxes, n), mat), b = new THREE.Mesh(ctx.mergedBoxGeometry(boxes, n), mat);
    for (const m of [a, b]) { m.position.set((rnd() - 0.5) * 900, 0, (rnd() - 0.5) * 900); }
    b.position.copy(a.position); a.rotation.y = b.rotation.y = rnd() * 6.28; const sc = rnd() < 0.3 ? 1.5 : 1; a.scale.setScalar(sc); b.scale.setScalar(sc);
    a.updateMatrixWorld(true); b.updateMatrixWorld(true);
    void b.geometry.attributes.position.array;          // b: arrays materialized -> the array path
    meshes.push(a); ref.push(b);
  }
  const A = ctx.bakeMergeV2(meshes).geometry, R = ctx.bakeMergeV2(ref).geometry;
  for (const k of ["position", "normal", "color"]) {
    const x = A.attributes[k].array, y = R.attributes[k].array; total++;
    if (x.length !== y.length || !x.every((v, i) => Object.is(v, y[i]))) { bad++; console.log("MISMATCH", t, k); }
  }
  total++; const xi = A.index.array, yi = R.index.array;
  if (xi.length !== yi.length || !xi.every((v, i) => v === yi[i])) { bad++; console.log("MISMATCH", t, "index"); }
  if (meshes.some((m) => m.geometry._cbzBoxSource.built())) { bad++; console.log("box path materialized arrays", t); }
}
console.log(bad ? `FAIL ${bad}/${total}` : `OK ${total} attribute comparisons identical; box path allocated nothing per source`);
process.exit(bad ? 1 : 0);
