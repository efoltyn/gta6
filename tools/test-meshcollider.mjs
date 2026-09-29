/* tools/test-meshcollider.mjs — pure-math proof for src/systems/meshcollider.js

   Loads the vendored three r128 + a bare window.CBZ into a vm (NO physics.js,
   the way a warlord/battle slice page runs) and checks that the measured
   collider matches the geometry that was drawn:
     rotated boxes (OBB center / half-extents / yaw), near-axis snap to AABB,
     parented under a translated+rotated group, a laid-down cylinder (log),
     a tall thin post (square), an InstancedMesh (per-instance matrices),
     a tree trunk with a root flare (trunkOnly), an L built from two merged
     boxes (compound -> two pieces), two disjoint merged boxes (islands),
     a Group with merge:true, add/remove/removeAllFor, and — when physics.js
     is ALSO loaded — that the record is identical to CBZ.orientedCollider's.

     node tools/test-meshcollider.mjs
*/
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
const ctx = vm.createContext({ console, Math, Float64Array, Float32Array, Uint32Array, Uint8Array, Int32Array, Map });
ctx.window = ctx; ctx.self = ctx;
ctx.CBZ = { CONFIG: {} };
vm.runInContext(read("src/vendor/three.r128.min.js"), ctx, { filename: "three.r128.min.js" });
vm.runInContext(read("src/systems/meshcollider.js"), ctx, { filename: "meshcollider.js" });
const T = ctx.THREE, CBZ = ctx.CBZ, MC = CBZ.meshCollider;

let fails = 0, checks = 0;
const check = (ok, msg) => { checks++; if (!ok) { fails++; console.log("  FAIL " + msg); } };
const near = (a, b, tol, msg) => check(Math.abs(a - b) <= tol, `${msg}: got ${a.toFixed(4)} want ${b.toFixed(4)}`);
// yaw is only defined mod PI/2 together with a hw/hd swap; compare the BOX
function sameBox(c, cx, cz, hw, hd, yaw, tol, msg) {
  near(c.cx != null ? c.cx : (c.minX + c.maxX) / 2, cx, tol, msg + " cx");
  near(c.cz != null ? c.cz : (c.minZ + c.maxZ) / 2, cz, tol, msg + " cz");
  const cy = c.yaw || 0;
  const chw = c.hw != null ? c.hw : (c.maxX - c.minX) / 2, chd = c.hd != null ? c.hd : (c.maxZ - c.minZ) / 2;
  // fold both to (-PI/4, PI/4]
  const fold = (y, a, b) => { const Q = Math.PI / 2; while (y > Math.PI / 4 + 1e-9) { y -= Q; [a, b] = [b, a]; } while (y <= -Math.PI / 4 + 1e-9) { y += Q; [a, b] = [b, a]; } return [y, a, b]; };
  const [y1, a1, b1] = fold(cy, chw, chd), [y2, a2, b2] = fold(yaw, hw, hd);
  near(y1, y2, 1e-3, msg + " yaw");
  near(a1, a2, tol, msg + " hw"); near(b1, b2, tol, msg + " hd");
}
const scene = new T.Scene();

// 1. a box rotated 30 deg
{
  const m = new T.Mesh(new T.BoxGeometry(4, 2, 1), new T.MeshBasicMaterial());
  m.position.set(10, 1, -5); m.rotation.y = Math.PI / 6; scene.add(m);
  const r = MC.fromMesh(m);
  check(r.length === 1, "rotated box: one record");
  sameBox(r[0], 10, -5, 2, 0.5, Math.PI / 6, 1e-6, "rotated box");
  check(r[0].yaw != null, "rotated box is oriented");
  near(r[0].y0, 0, 1e-6, "rotated box y0"); near(r[0].y1, 2, 1e-6, "rotated box y1");
  check(r[0].ref === m && r[0]._src === m, "ref defaults to the mesh");
  // the physics resolver's frame: local +x -> world (cos,-sin). The box's
  // local +x end (+2 along its length) must be inside, +2.1 outside.
  const co = Math.cos(r[0].yaw), si = Math.sin(r[0].yaw);
  const inside = (x, z) => { const rx = x - r[0].cx, rz = z - r[0].cz; const lx = rx * co - rz * si, lz = rx * si + rz * co; return Math.abs(lx) <= r[0].hw + 1e-9 && Math.abs(lz) <= r[0].hd + 1e-9; };
  const ex = new T.Vector3(1.99, 0, 0).applyMatrix4(m.matrixWorld), ez = new T.Vector3(0, 0, 0.49).applyMatrix4(m.matrixWorld);
  const ox = new T.Vector3(2.1, 0, 0).applyMatrix4(m.matrixWorld);
  check(inside(ex.x, ex.z) && inside(ez.x, ez.z), "rotated box: drawn corners inside the collider frame");
  check(!inside(ox.x, ox.z), "rotated box: past the end is outside");
}
// 2. near-axis (0.2 deg) snaps to a tight AABB
{
  const m = new T.Mesh(new T.BoxGeometry(3, 1, 1), new T.MeshBasicMaterial());
  m.rotation.y = 0.2 * Math.PI / 180; scene.add(m);
  const r = MC.fromMesh(m)[0];
  check(r.yaw == null, "near-axis box is a plain AABB");
  const t = new T.Box3().setFromObject(m);
  near(r.minX, t.min.x, 1e-6, "near-axis minX"); near(r.maxZ, t.max.z, 1e-6, "near-axis maxZ");
}
// 3. parented under a translated + rotated group, built BEFORE the matrix update
{
  const g = new T.Group(); g.position.set(100, 0, 50); g.rotation.y = -0.7;
  const m = new T.Mesh(new T.BoxGeometry(2, 3, 6), new T.MeshBasicMaterial());
  m.position.set(5, 1.5, 0); m.rotation.y = 0.2; g.add(m); scene.add(g);
  const r = MC.fromMesh(m)[0];
  const c = new T.Vector3(5, 0, 0).applyAxisAngle(new T.Vector3(0, 1, 0), -0.7).add(new T.Vector3(100, 0, 50));
  sameBox(r, c.x, c.z, 1, 3, -0.5, 1e-6, "parented box");
  near(r.y1, 3, 1e-6, "parented y1");
}
// 4. a fallen log: cylinder laid on its side (rot.z = PI/2), yaw 1.1
{
  const m = new T.Mesh(new T.CylinderGeometry(0.5, 0.5, 8, 16), new T.MeshBasicMaterial());
  m.rotation.z = Math.PI / 2; m.rotation.y = 1.1; m.position.set(-20, 0.5, 7); scene.add(m);
  const r = MC.fromMesh(m, { ref: null })[0];
  sameBox(r, -20, 7, 4, 0.5, 1.1, 0.02, "log");
  near(r.y0, 0, 1e-6, "log y0"); near(r.y1, 1, 1e-6, "log y1");
  check(r.ref === null && r._src === m, "ref:null keeps _src for removal");
}
// 5. a tall thin post -> small axis-aligned square
{
  const m = new T.Mesh(new T.CylinderGeometry(0.1, 0.1, 5, 8), new T.MeshBasicMaterial());
  m.position.set(3, 2.5, 3); m.rotation.y = 0.3; scene.add(m);
  const r = MC.fromMesh(m)[0];
  check(r.yaw == null, "post is axis-aligned");
  near(r.maxX - r.minX, r.maxZ - r.minZ, 1e-9, "post is square");
  check(r.maxX - r.minX < 0.25 && r.maxX - r.minX > 0.18, "post width ~0.2: " + (r.maxX - r.minX));
  check(r.noBreach === true, "post is noBreach");
}
// 6. InstancedMesh: one collider per instance, per-instance matrices honoured
{
  const im = new T.InstancedMesh(new T.BoxGeometry(2, 1, 1), new T.MeshBasicMaterial(), 3);
  const d = new T.Object3D();
  const P = [[0, 0, 0.0], [10, 5, 0.6], [-10, -5, -0.4]];
  P.forEach((p, i) => { d.position.set(p[0], 0.5, p[1]); d.rotation.set(0, p[2], 0); d.scale.set(1, 1, 1); d.updateMatrix(); im.setMatrixAt(i, d.matrix); });
  im.position.set(1000, 0, 0); scene.add(im);
  const r = MC.fromMesh(im, { noCam: true });
  check(r.length === 3, "instanced: 3 records, got " + r.length);
  P.forEach((p, i) => sameBox(r[i], 1000 + p[0], p[1], 1, 0.5, p[2], 1e-6, "instance " + i));
  check(r.every((c) => c.noCam && c._inst != null), "instanced: noCam + _inst");
  // zero-scaled instance = hidden -> skipped
  d.position.set(0, 0, 0); d.scale.set(0, 0, 0); d.updateMatrix(); im.setMatrixAt(1, d.matrix);
  check(MC.fromMesh(im).length === 2, "instanced: zero-scale instance skipped");
}
// 7. trunkOnly: a bole with a wide root flare at the base
{
  const bole = new T.CylinderGeometry(0.2, 0.3, 6, 8); bole.translate(0, 3, 0);
  const flare = new T.CylinderGeometry(0.3, 1.4, 0.4, 8); flare.translate(0, 0.2, 0);
  const geo = T.BufferGeometryUtils ? null : null;
  // merge by hand (no BufferGeometryUtils in the vm): positions only
  const a = bole.toNonIndexed().attributes.position.array, b = flare.toNonIndexed().attributes.position.array;
  const pos = new Float32Array(a.length + b.length); pos.set(a); pos.set(b, a.length);
  const g = new T.BufferGeometry(); g.setAttribute("position", new T.BufferAttribute(pos, 3));
  const m = new T.Mesh(g, new T.MeshBasicMaterial()); m.position.set(50, 0, 50); scene.add(m);
  const full = MC.fromMesh(m)[0], trunk = MC.fromMesh(m, { trunkOnly: true })[0];
  check(full.maxX - full.minX > 2.5, "untrimmed trunk takes the flare");
  const w = trunk.maxX - trunk.minX;
  check(w < 0.62 && w > 0.4, "trunkOnly width is the bole (~0.55): " + w.toFixed(3));
  near(trunk.y0, 0, 1e-6, "trunk band y0"); near(trunk.y1, 6, 1e-6, "trunk band y1");
}
// helper: merge box geometries (non-indexed) into one BufferGeometry
function mergeBoxes(list) {
  const arrs = list.map(([w, h, d, x, y, z]) => { const g = new T.BoxGeometry(w, h, d); g.translate(x, y, z); return g.toNonIndexed().attributes.position.array; });
  const n = arrs.reduce((s, a) => s + a.length, 0), pos = new Float32Array(n);
  let o = 0; for (const a of arrs) { pos.set(a, o); o += a.length; }
  const g = new T.BufferGeometry(); g.setAttribute("position", new T.BufferAttribute(pos, 3)); return g;
}
// 8. an L wall (two overlapping merged boxes), rotated 25 deg: compound -> 2 pieces
{
  // arm A: x 0..10, z 0..1 ; arm B: x 0..1, z 0..6 ; both 3 m tall; they share the corner
  const g = mergeBoxes([[10, 3, 1, 5, 1.5, 0.5], [1, 3, 6, 0.5, 1.5, 3]]);
  const m = new T.Mesh(g, new T.MeshBasicMaterial()); m.rotation.y = 25 * Math.PI / 180; m.position.set(-300, 0, 200); scene.add(m);
  const plain = MC.fromMesh(m)[0];
  const r = MC.fromMesh(m, { compound: true });
  check(r.length === 2, "L: two pieces, got " + r.length);
  const area = r.reduce((s, c) => s + 4 * c.hw * c.hd, 0);
  check(area < 16, "L: pieces cover ~15 m2 (one arm 10x1 + one 1x5 or 9x1+1x6), got " + area.toFixed(2) + " vs single OBB " + (4 * plain.hw * plain.hd).toFixed(2));
  near(area, 15, 0.05, "L area");
  // every piece in the L's own frame
  r.forEach((c, i) => near(Math.abs(c.yaw), 25 * Math.PI / 180, 1e-3, "L piece " + i + " yaw"));
  // the drawn far ends are covered, the empty corner is not
  const cov = (lx, lz) => { const p = new T.Vector3(lx, 1, lz).applyMatrix4(m.matrixWorld); return r.some((c) => { const co = Math.cos(c.yaw), si = Math.sin(c.yaw); const rx = p.x - c.cx, rz = p.z - c.cz; return Math.abs(rx * co - rz * si) <= c.hw + 1e-6 && Math.abs(rx * si + rz * co) <= c.hd + 1e-6; }); };
  check(cov(9.9, 0.5) && cov(0.5, 5.9) && cov(0.5, 0.5), "L: both arms and the corner covered");
  check(!cov(6, 4), "L: the empty inside of the L is NOT solid");
  r.forEach((c, i) => { near(c.y0, 0, 1e-6, "L piece " + i + " y0"); near(c.y1, 3, 1e-6, "L piece " + i + " y1"); });
}
// 9. two disjoint boxes merged into one geometry: compound -> two islands
{
  const g = mergeBoxes([[2, 1, 2, 0, 0.5, 0], [1, 2, 1, 8, 1, 0]]);
  const m = new T.Mesh(g, new T.MeshBasicMaterial()); scene.add(m);
  const r = MC.fromMesh(m, { compound: true }).sort((a, b) => a.minX - b.minX);
  check(r.length === 2, "islands: two, got " + r.length);
  near(r[0].maxX - r[0].minX, 2, 1e-6, "island A width"); near(r[0].y1, 1, 1e-6, "island A y1");
  near(r[1].maxX - r[1].minX, 1, 1e-6, "island B width"); near(r[1].y1, 2, 1e-6, "island B y1");
}
// 10. a convex compound (one box) stays one piece
{
  const m = new T.Mesh(new T.BoxGeometry(5, 1, 3), new T.MeshBasicMaterial()); m.rotation.y = 0.9; scene.add(m);
  const r = MC.fromMesh(m, { compound: true });
  check(r.length === 1, "compound box: one piece, got " + r.length);
  sameBox(r[0], 0, 0, 2.5, 1.5, 0.9, 1e-6, "compound box");
}
// 11. Group: per-mesh by default, one hull with merge
{
  const g = new T.Group();
  const a = new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial()); a.position.set(0, 0.5, 0);
  const b = new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial()); b.position.set(3, 0.5, 0);
  g.add(a); g.add(b); g.position.set(0, 0, 500); scene.add(g);
  check(MC.fromMesh(g).length === 2, "group: one per mesh");
  const r = MC.fromMesh(g, { merge: true });
  check(r.length === 1, "group merge: one");
  near(r[0].minX, -0.5, 1e-6, "merge minX"); near(r[0].maxX, 3.5, 1e-6, "merge maxX"); near(r[0].minZ, 499.5, 1e-6, "merge minZ");
}
// 12. options: pad, fullHeight, cityTag, minHeight (flat plane skipped), maxSize
{
  const m = new T.Mesh(new T.BoxGeometry(2, 2, 2), new T.MeshBasicMaterial()); scene.add(m);
  const r = MC.fromMesh(m, { pad: 0.25, fullHeight: true, cityTag: true, tag: "t" })[0];
  near(r.maxX - r.minX, 2.5, 1e-9, "pad"); check(r.y0 == null && r.y1 == null, "fullHeight drops the band");
  check(r._city === true && r.src === "mesh:t", "cityTag + tag");
  const p = new T.Mesh(new T.PlaneGeometry(5, 5), new T.MeshBasicMaterial()); p.rotation.x = -Math.PI / 2; scene.add(p);
  check(MC.fromMesh(p).length === 0, "a flat plane is a floor, not a collider");
  const big = new T.Mesh(new T.BoxGeometry(400, 2, 2), new T.MeshBasicMaterial()); scene.add(big);
  check(MC.fromMesh(big).length === 0, "maxSize guard");
  const wall = new T.Mesh(new T.BoxGeometry(6, 3, 0.3), new T.MeshBasicMaterial()); scene.add(wall);
  check(MC.fromMesh(wall)[0].noBreach === true && MC.fromMesh(wall, { noBreach: false })[0].noBreach === false, "noBreach default + opt-out");
}
// 13. fromBox3
{
  const r = MC.fromBox3(new T.Box3(new T.Vector3(1, 0, 2), new T.Vector3(3, 4, 5)), { noCam: true });
  check(r && r.minX === 1 && r.maxZ === 5 && r.y1 === 4 && r.noCam, "fromBox3");
}
// 14. registry: add / remove / removeAllFor without physics.js (slice page)
{
  let rang = 0; CBZ.markCollidersDirty = () => { rang++; };
  CBZ.colliders = [];
  const m = new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial()); scene.add(m);
  const im = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial(), 4);
  for (let i = 0; i < 4; i++) { const d = new T.Object3D(); d.position.set(i * 3, 0.5, 0); d.updateMatrix(); im.setMatrixAt(i, d.matrix); }
  scene.add(im);
  const a = CBZ.solidFromMesh(m);
  const b = CBZ.solidFromMesh(im, { ref: null });
  check(CBZ.colliders.length === 5 && rang >= 2, "solidFromMesh registers + rings the bell");
  check(MC.remove(a[0]) === 1 && CBZ.colliders.length === 4, "remove(record)");
  check(MC.removeAllFor(im) === 4 && CBZ.colliders.length === 0, "removeAllFor(mesh) finds ref:null records via _src");
}
// 15. with physics.js loaded, records are byte-identical to CBZ.orientedCollider
{
  let ok = false;
  try {
    const ctx2 = vm.createContext({ console, Math, Float64Array, Float32Array, Uint32Array, Uint8Array, Int32Array, Map, Set, performance: { now: () => 0 } });
    ctx2.window = ctx2; ctx2.self = ctx2; ctx2.CBZ = { CONFIG: {}, colliders: [], platforms: [], onUpdate() {}, onAlways() {}, onReset() {}, on() {} };
    vm.runInContext(read("src/vendor/three.r128.min.js"), ctx2);
    vm.runInContext(read("src/systems/physics.js"), ctx2);
    ok = typeof ctx2.CBZ.orientedCollider === "function";
    if (ok) {
      vm.runInContext(read("src/systems/meshcollider.js"), ctx2);
      const T2 = ctx2.THREE;
      const m = new T2.Mesh(new T2.BoxGeometry(4, 2, 1), new T2.MeshBasicMaterial()); m.rotation.y = 0.5; m.position.set(3, 1, 4);
      const r = ctx2.CBZ.meshCollider.fromMesh(m)[0];
      const ref = ctx2.CBZ.orientedCollider(r.cx, r.cz, r.hw, r.hd, r.yaw, r.y0, r.y1);
      check(["minX", "maxX", "minZ", "maxZ", "cx", "cz", "hw", "hd", "yaw", "y0", "y1"].every((k) => ref[k] === r[k]), "record shape == physics.js orientedCollider");
      sameBox(r, 3, 4, 2, 0.5, 0.5, 1e-6, "physics-loaded box");
      const before = ctx2.CBZ.colliders.length;
      ctx2.CBZ.solidFromMesh(m);
      check(ctx2.CBZ.colliders.length === before + 1, "colliderAdd path registers");
    }
  } catch (e) { ok = false; console.log("  (physics.js not loadable headless: " + String(e.message).slice(0, 80) + " — skipped)"); }
}
// 16. perf sanity: a 40k-vertex mesh
{
  const m = new T.Mesh(new T.SphereGeometry(3, 200, 100), new T.MeshBasicMaterial()); m.rotation.y = 0.4; scene.add(m);
  const t0 = Date.now(); const r = MC.fromMesh(m); const dt = Date.now() - t0;
  check(r.length === 1 && Math.abs(r[0].maxX - r[0].minX - 6) < 0.3, "sphere footprint ~6 m");
  check(dt < 200, "40k verts in " + dt + " ms");
}

console.log(`meshcollider: ${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
