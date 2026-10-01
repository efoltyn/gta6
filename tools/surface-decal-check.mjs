#!/usr/bin/env node
/* tools/surface-decal-check.mjs — BLOOD ON A CAR LIES ON THE CAR.

   Owner, 2026-09-30: "BLOOD SPLATTERS ONTO VEHICLES LOOK FAKE AS FUCK. THEY
   TREAT THE VEHICLE AS FLAT SO FLOATING, BAD PHYSICS AGAIN."

   Plain node, no browser, the real three r128, the real
   systems/surfacedecal.js and the real systems/gore.js:

     1. PROJECTOR: a decal projected onto curved test meshes (a fender
        sphere, a crowned bonnet, a raked windscreen on a rotated, offset
        host) — every vertex within MAX_MM of the host surface (exact
        closest-point distance to the host's triangles).
     2. BEFORE: what the old code drew, measured the same way: a flat quad of
        the same size laid tangent at the same hit, and the roadblock path
        (a quad on the face of the 4 x 4 m collider box police.js parks round
        a 1.9 m wide cruiser).
     3. DENT: displace the host's vertices (crashdeform does it in place),
        refit, still on the surface.
     4. GORE END-TO-END: a car in CBZ.cityCars with a roadblock collider
        round it, a kill beside it with the shot line toward it: the blood
        lands ON the car's meshes (vehicle stamps, no wall splat on the
        collider box), its pieces are children of the meshes they were cut
        from, the live audit's floatMm is under MAX_MM, glass gets the glass
        look, the car moving carries it, a run-over marks the nose.

     node tools/surface-decal-check.mjs        exit 0 = ok */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
const THREE = require(new URL("src/vendor/three.r128.min.js", ROOT).pathname);
const MAX_MM = 3;
let fails = 0;
const ok = (c, m, d) => { if (!c) fails++; console.log((c ? "ok   " : "FAIL ") + m + (d ? "  (" + d + ")" : "")); };
const report = {};

// ---- a minimal browser for the two files ----------------------------------
const noop = () => {};
const ctx2d = {
  createRadialGradient: () => ({ addColorStop: noop }), beginPath: noop, arc: noop, fill: noop,
  createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData: noop,
};
const document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d, style: {} }) };
const always = [];
const CBZ = { CONFIG: {}, game: { mode: "city" }, onAlways: (o, fn) => always.push(fn), qualityLevel: 0 };
CBZ.scene = new THREE.Scene();
CBZ.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
CBZ.camera.position.set(0, 2, 8); CBZ.camera.updateMatrixWorld();
CBZ.colliders = []; CBZ.cityCars = []; CBZ.islandModeOn = () => false;
// config.js's qScale at the phone tier (qualityLevel 0): the strictest budget
CBZ.qScale = (lo, hi) => lo + (hi - lo) * (Math.max(0, Math.min(4, CBZ.qualityLevel)) / 4);
const sandbox = { window: null, THREE, CBZ, document, console, Math, performance: { now: () => 0 } };
sandbox.window = sandbox;
const ctx = vm.createContext(sandbox);
vm.runInContext(read("src/systems/surfacedecal.js"), ctx, { filename: "surfacedecal.js" });
const SD = CBZ.surfaceDecal;

// ---- geometry helpers -------------------------------------------------------
const _tri = new THREE.Triangle(), _cp = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
// exact distance from p (host-local) to the host mesh's surface
function surfDist(geo, p) {
  const P = geo.attributes.position, I = geo.index ? geo.index.array : null;
  const n = I ? I.length / 3 : P.count / 3;
  let best = Infinity;
  for (let t = 0; t < n; t++) {
    const i0 = I ? I[t * 3] : t * 3, i1 = I ? I[t * 3 + 1] : t * 3 + 1, i2 = I ? I[t * 3 + 2] : t * 3 + 2;
    _a.fromBufferAttribute(P, i0); _b.fromBufferAttribute(P, i1); _c.fromBufferAttribute(P, i2);
    // cheap reject: farther than the best by the triangle's own span
    const dx = _a.x - p.x, dy = _a.y - p.y, dz = _a.z - p.z, span = Math.max(_a.distanceTo(_b), _a.distanceTo(_c));
    if (Math.sqrt(dx * dx + dy * dy + dz * dz) - span > best) continue;
    _tri.set(_a, _b, _c); _tri.closestPointToPoint(p, _cp);
    const d = _cp.distanceTo(p);
    if (d < best) best = d;
  }
  return best;
}
// build the projector box exactly the way gore.js's vehicleStamp does
function boxAt(hitLocal, nLocal, sx, sy, IN = 0.16, OUT = 0.06) {
  const z = nLocal.clone().normalize();
  const y = new THREE.Vector3(0, 1, 0).addScaledVector(z, -z.y);
  if (y.lengthSq() < 1e-4) y.set(1, 0, 0).addScaledVector(z, -z.x);
  y.normalize();
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  const W = new THREE.Matrix4().makeBasis(x.clone().multiplyScalar(sx), y.clone().multiplyScalar(sy), z.clone().multiplyScalar(IN + OUT));
  W.setPosition(hitLocal.clone().addScaledVector(z, (OUT - IN) * 0.5));
  return { W, x, y, z };
}
function projectOn(mesh, hitW, nW, sx, sy) {
  mesh.updateMatrixWorld(true);
  const box = boxAt(hitW, nW, sx, sy);
  const toBox = new THREE.Matrix4().copy(box.W).invert().multiply(mesh.matrixWorld);
  const d = SD.project(mesh.geometry, toBox.elements, { minFacing: 0.05, maxTris: 900 });
  if (!d) return null;
  const pos = new Float32Array(d.n * 3), nrm = new Float32Array(d.n * 3);
  SD.refit(d, mesh.geometry, 0.0015, pos, nrm);
  return { d, pos, nrm, box };
}
function maxGap(geo, pos) {
  let worst = 0; const v = new THREE.Vector3();
  for (let i = 0; i < pos.length; i += 3) { v.set(pos[i], pos[i + 1], pos[i + 2]); worst = Math.max(worst, surfDist(geo, v)); }
  return worst;
}
// the OLD flat quad, laid tangent at the hit (the best a flat quad can do)
function flatQuadGap(mesh, hitW, nW, s) {
  const inv = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
  const box = boxAt(hitW, nW, s, s);
  let worst = 0; const p = new THREE.Vector3();
  for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) {
    p.copy(hitW).addScaledVector(box.x, (i / 10 - 0.5) * s * 0.92).addScaledVector(box.y, (j / 10 - 0.5) * s * 0.92)
      .addScaledVector(box.z, 0.02).applyMatrix4(inv);
    worst = Math.max(worst, surfDist(mesh.geometry, p));
  }
  return worst;
}
const hitOf = (mesh, o, d) => {
  const rc = new THREE.Raycaster(o, d.clone().normalize()); mesh.updateMatrixWorld(true);
  const h = rc.intersectObject(mesh, false)[0];
  const n = h.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld)).normalize();
  if (n.dot(d) > 0) n.negate();
  return { p: h.point, n };
};
const mm = (m) => +(m * 1000).toFixed(2);

// ============ 1-3: the projector on curved panels =============================
{
  const mat = new THREE.MeshStandardMaterial();
  const cases = [
    // a fender: tight curvature (r 0.45 m), splat 0.6 m — the worst case for a flat quad
    { name: "fender sphere r0.45", mesh: new THREE.Mesh(new THREE.SphereGeometry(0.45, 48, 32), mat), o: [1.5, 0.25, 0.4], s: 0.6 },
    // a crowned bonnet: a long cylinder lying across the car, r 1.6 m
    { name: "bonnet crown r1.6", mesh: new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 1.8, 96, 8), mat), o: [0.3, 3.0, 0.2], s: 0.8,
      setup: (m) => { m.rotation.z = Math.PI / 2; } },
    // a raked, curved windscreen: an ellipsoid shell on a rotated + offset host (host-local != world)
    { name: "windscreen ellipsoid (rotated host)", mesh: new THREE.Mesh(new THREE.SphereGeometry(1, 64, 40), mat), o: [0.2, 1.6, 4], s: 0.7,
      setup: (m) => { m.scale.set(0.95, 0.55, 1.6); m.rotation.set(0.25, 0.6, 0); m.position.set(3, 1.1, -2); } },
  ];
  report.projector = [];
  for (const c of cases) {
    if (c.setup) c.setup(c.mesh);
    c.mesh.updateMatrixWorld(true);
    const center = new THREE.Vector3().setFromMatrixPosition(c.mesh.matrixWorld);
    const o = new THREE.Vector3(...c.o).add(center), dir = center.clone().sub(o);
    const h = hitOf(c.mesh, o, dir);
    const r = projectOn(c.mesh, h.p, h.n, c.s, c.s);
    ok(!!r && r.d.tris > 8, c.name + ": decal cut from the host's triangles", r ? r.d.tris + " tris" : "none");
    if (!r) continue;
    const after = maxGap(c.mesh.geometry, r.pos);
    // world-space: the host may be scaled; measure in world too
    const Wm = c.mesh.matrixWorld, v = new THREE.Vector3();
    const flat = flatQuadGap(c.mesh, h.p, h.n, c.s);
    let afterW = 0;
    { // world gap: scale local distance by the host's largest axis scale (upper bound)
      const s = Math.max(c.mesh.scale.x, c.mesh.scale.y, c.mesh.scale.z); afterW = after * s; }
    const flatW = flat * Math.max(c.mesh.scale.x, c.mesh.scale.y, c.mesh.scale.z);
    ok(afterW * 1000 < MAX_MM, c.name + ": every vertex on the surface", "max " + mm(afterW) + " mm, flat quad was " + mm(flatW) + " mm");
    // UVs span the box and stay inside it (the atlas cell never bleeds)
    let u0 = 1, u1 = 0;
    for (let i = 0; i < r.d.uv.length; i++) { u0 = Math.min(u0, r.d.uv[i]); u1 = Math.max(u1, r.d.uv[i]); }
    ok(u0 >= -1e-6 && u1 <= 1 + 1e-6, c.name + ": uv inside the cell", u0.toFixed(3) + ".." + u1.toFixed(3));
    // nothing on the FAR side of the body (facing filter)
    let back = 0;
    for (let i = 0; i < r.nrm.length; i += 3) {
      v.set(r.nrm[i], r.nrm[i + 1], r.nrm[i + 2]).transformDirection(Wm);
      if (v.dot(h.n) < 0) back++;
    }
    ok(back === 0, c.name + ": no piece on the far side of the panel", back + " verts");
    // DENT: crashdeform pushes vertices in place; refit puts the blood back on
    const P = c.mesh.geometry.attributes.position, lp = h.p.clone().applyMatrix4(new THREE.Matrix4().copy(Wm).invert());
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i);
      const f = Math.max(0, 1 - v.distanceTo(lp) / 0.5);
      if (f > 0) { v.addScaledVector(lp.clone().normalize(), -0.08 * f * f); P.setXYZ(i, v.x, v.y, v.z); }
    }
    P.needsUpdate = true; c.mesh.geometry.computeVertexNormals();
    const stale = maxGap(c.mesh.geometry, r.pos);
    SD.refit(r.d, c.mesh.geometry, 0.0015, r.pos, r.nrm);
    const dented = maxGap(c.mesh.geometry, r.pos);
    ok(dented * 1000 < MAX_MM, c.name + ": after an 8 cm dent, refit keeps it on", "max " + mm(dented) + " mm (unrefit would float " + mm(stale) + " mm)");
    report.projector.push({ case: c.name, splatM: c.s, tris: r.d.tris, beforeFlatQuadMm: mm(flatW), afterMm: mm(afterW), dentStaleMm: mm(stale), dentRefitMm: mm(dented) });
  }
}

// ============ 4: the real gore.js ============================================
vm.runInContext(read("src/systems/gore.js"), ctx, { filename: "gore.js" });
ok(typeof CBZ.gore === "function" && typeof CBZ.goreAudit === "function", "gore.js loads headless");
const tick = (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) always.forEach((f) => f(dt)); };

function makeCar(x, z, heading) {
  const grp = new THREE.Group(); grp.position.set(x, 0, z); grp.rotation.y = heading;
  grp.userData.bodyKind = "sedan";
  const visual = new THREE.Group(); grp.add(visual); grp.userData.carVisual = visual;
  // the body: an ellipsoid 1.9 x 1.3 x 4.6 m, a merged paint bucket
  const paint = new THREE.MeshStandardMaterial({ color: 0x2244aa }); paint._bodyPaint = true;
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 40), paint);
  body.scale.set(0.95, 0.62, 2.3); body.position.y = 0.75; visual.add(body);
  // the glasshouse: a smaller ellipsoid on top, the fleet glass
  const gm = new THREE.MeshPhysicalMaterial({ color: 0x1c3346, transparent: true, opacity: 0.35 });
  const glass = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), gm);
  glass.scale.set(0.8, 0.42, 1.2); glass.position.set(0, 1.25, -0.2); glass.renderOrder = 1; visual.add(glass);
  // a seated driver: never gets blood
  const drv = new THREE.Group(); drv.userData.occupant = true;
  drv.add(new THREE.Mesh(new THREE.SphereGeometry(0.3), new THREE.MeshLambertMaterial())); drv.position.set(0.4, 1.1, 0.2); visual.add(drv);
  CBZ.scene.add(grp); grp.updateMatrixWorld(true);
  const car = { group: grp, pos: grp.position, heading, v: 0, vx: 0, vz: 0 };
  CBZ.cityCars.push(car);
  return { car, body, glass, drv };
}
// the cruiser parked side-on at x = 0 (its long axis along z), a 4 x 4 m
// roadblock collider round it exactly as police.js registers it
const RB = makeCar(0, 0, 0);
CBZ.colliders.push({ minX: -2, maxX: 2, minZ: -2, maxZ: 2, ref: RB.car.group, noCam: true, _rb: RB.car });

// BEFORE, measured off the real collider: the old spawnWallSplat put the
// quad on the box's xmin face at x = -2 + (-0.02) ... how far is that from the door?
{
  const door = hitOf(RB.body, new THREE.Vector3(-3.4, 0.9, 0.3), new THREE.Vector3(1, 0, 0));
  const quadX = -2 - 0.02;
  const gapOld = Math.abs(door.p.x - quadX);
  report.roadblockBefore = { quadOnColliderFaceX: quadX, doorSurfaceX: +door.p.x.toFixed(3), floatMm: mm(gapOld) };
  console.log("info roadblock path BEFORE: quad on the collider face " + mm(gapOld) + " mm off the door");
}

// a kill 1.4 m from the door, shot line toward the car
const audit0 = CBZ.goreAudit();
const dead = { x: -2.6, y: 0.9, z: 0.3 };
CBZ.gore(dead.x, dead.y, dead.z, { dir: { x: 1, y: 0, z: 0 }, amount: 1 });
tick(30);
let A = CBZ.goreAudit();
ok(A.vehicle && A.vehicle.stamps > 0, "the kill's slug landed ON the car", JSON.stringify({ stamps: A.vehicle.stamps, pieces: A.vehicle.livePieces }));
ok(A.walls === audit0.walls, "no flat wall splat on the collider box beside the car", "walls " + A.walls);
ok(A.vehicle.floatMm < MAX_MM, "live audit: every blood vertex on its panel", A.vehicle.floatMm + " mm");
// every piece is a child of the mesh it was cut from, never of the driver
const pieces = [];
RB.car.group.traverse((o) => { if (o.userData && o.userData.goreDecal) pieces.push(o); });
ok(pieces.length > 0 && pieces.every((p) => p.parent === RB.body || p.parent === RB.glass), "pieces ride the body / glass meshes", pieces.map((p) => p.parent === RB.body ? "body" : "glass").join(","));
ok(!pieces.some((p) => { for (let o = p.parent; o; o = o.parent) if (o.userData && o.userData.occupant) return true; return false; }), "nothing on the driver");
// measured in WORLD space against the body itself (scaled host)
{
  let worst = 0; const v = new THREE.Vector3();
  const inv = new THREE.Matrix4();
  for (const p of pieces) {
    p.updateMatrixWorld(true);
    const host = p.parent, P = p.geometry.attributes.position;
    inv.copy(host.matrixWorld).invert();
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i);
      const local = surfDist(host.geometry, v);   // host-local; host scale <= 2.3
      worst = Math.max(worst, local * Math.max(host.scale.x, host.scale.y, host.scale.z));
    }
  }
  report.goreKillAfterMm = mm(worst);
  ok(worst * 1000 < MAX_MM, "gore kill: the car blood within " + MAX_MM + " mm of the body", "max " + mm(worst) + " mm (bound)");
}
// the car drives off: the blood goes with it (it is in the car's graph)
{
  const p = pieces[0], before = new THREE.Vector3(), after = new THREE.Vector3();
  p.updateMatrixWorld(true); p.geometry.computeBoundingSphere();
  before.copy(p.geometry.boundingSphere.center).applyMatrix4(p.matrixWorld);
  RB.car.group.position.x += 5; RB.car.group.rotation.y = 0.4; RB.car.group.updateMatrixWorld(true);
  after.copy(p.geometry.boundingSphere.center).applyMatrix4(p.matrixWorld);
  ok(after.distanceTo(before) > 4, "the car moves, the blood rides it", before.distanceTo(after).toFixed(2) + " m");
  RB.car.group.position.x -= 5; RB.car.group.rotation.y = 0; RB.car.group.updateMatrixWorld(true);
}
// a dent in the door: the live audit stays on the surface
{
  const P = RB.body.geometry.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) {
    v.fromBufferAttribute(P, i);
    if (v.x < -0.6 && Math.abs(v.z) < 0.4) { v.x += 0.06; P.setXYZ(i, v.x, v.y, v.z); }
  }
  P.needsUpdate = true; RB.body.geometry.computeVertexNormals();
  tick(2);
  A = CBZ.goreAudit();
  ok(A.vehicle.refits > 0 && A.vehicle.floatMm < MAX_MM, "door dented: blood refit onto it", "refits " + A.vehicle.refits + ", " + A.vehicle.floatMm + " mm");
}
// glass: a shot line into the glasshouse gets the glass look
{
  const before = A.vehicle.glass;
  CBZ.gore.spray({ x: -1.6, y: 1.45, z: -0.2 }, 1.0, { x: 1, y: 0.05, z: 0 }, { exit: true });
  tick(30);
  A = CBZ.goreAudit();
  ok(A.vehicle.glass > before, "spray into the windows: glass pieces (the thin running film)", "glass pieces " + A.vehicle.glass);
  const gp = []; RB.car.group.traverse((o) => { if (o.userData && o.userData.goreDecal && o.parent === RB.glass) gp.push(o); });
  ok(gp.length && gp.every((p) => p.material.blending === THREE.NormalBlending && p.renderOrder > RB.glass.renderOrder),
    "glass pieces draw after the pane, translucent", gp.length + " pieces");
}
// run over: the nose wears him
{
  const T = makeCar(20, 0, 0);                       // facing +z
  T.car.v = 16;
  const n0 = A.vehicle.stamps;
  CBZ.gore(20.2, 0.9, 3.2, { dir: { x: 0, y: 0, z: 1 }, amount: 1, smear: true });
  tick(30);
  A = CBZ.goreAudit();
  const tp = []; T.car.group.traverse((o) => { if (o.userData && o.userData.goreDecal) tp.push(o); });
  let front = 0; const c = new THREE.Vector3();
  for (const p of tp) { p.geometry.computeBoundingSphere(); c.copy(p.geometry.boundingSphere.center).applyMatrix4(p.matrixWorld); if (c.z > 0.8) front++; }
  ok(A.vehicle.stamps > n0 && front > 0, "run over: blood on the car's nose", tp.length + " pieces, " + front + " at the front");
  ok(A.vehicle.floatMm < MAX_MM, "run over: on the surface", A.vehicle.floatMm + " mm");
}
// budgets: a hundred hits on one car never pass the per-car cap
{
  for (let i = 0; i < 40; i++) CBZ.gore(-2.6, 0.9, -1 + (i % 5) * 0.5, { dir: { x: 1, y: 0, z: 0 }, amount: 1 });
  tick(10);
  let mine = 0; RB.car.group.traverse((o) => { if (o.userData && o.userData.goreDecal) mine++; });
  A = CBZ.goreAudit();
  ok(A.vehicle.live <= A.vehicle.cap, "global cap holds (phone tier)", A.vehicle.live + " / " + A.vehicle.cap);
  ok(mine <= 5 * 2, "per-car cap holds", mine + " pieces on one car");
}
// rain rinses it
{
  CBZ.weather = { raining: true, intensity: 1, snow: 0 };
  tick(60 * 40, 1 / 60);
  A = CBZ.goreAudit();
  ok(A.vehicle.live === 0, "40 s of downpour rinses the car", "live " + A.vehicle.live);
  CBZ.weather = null;
}
report.audit = A.vehicle;

const outDir = homedir() + "/harness/out/gta6";
try { mkdirSync(outDir, { recursive: true }); writeFileSync(outDir + "/surface-decal-check.json", JSON.stringify(report, null, 2)); console.log("wrote " + outDir + "/surface-decal-check.json"); } catch (e) {}
console.log(fails ? fails + " FAILED" : "all ok");
process.exit(fails ? 1 : 0);
