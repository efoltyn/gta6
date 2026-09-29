// tools/race-check-car.mjs — plain-node checks for src/race/race_car.js
// (dimensions vs the real cup car, draw calls, triangles, eye in the cage,
// shell watertight-ish, update() x1000 with damage/fx). No browser.
import { createRequire } from "module";
const require = createRequire(import.meta.url);
global.window = global;
const THREE = require("../src/vendor/three.r128.min.js");
const carApi = require("../src/race/race_car.js");

let fails = 0;
const ok = (c, msg) => { console.log((c ? "  ok   " : "  FAIL ") + msg); if (!c) fails++; };
const f3 = (v) => v.toFixed(3);

const scene = new THREE.Scene();
const fx = carApi.createFx(THREE, scene);
const liv = carApi.liveries(10);
ok(liv.length === 10 && new Set(liv.map((l) => l.number)).size === 10 && new Set(liv.map((l) => l.base + l.accent + l.scheme)).size === 10, "10 distinct liveries");
ok(carApi.liveries(14).length === 14, "liveries(14) extends deterministically");
ok(JSON.stringify(carApi.liveryFor(99, 3)) === JSON.stringify(carApi.liveryFor(99, 3)), "liveryFor deterministic");

const player = carApi.build(THREE, { livery: liv[0], player: true, fx });
const ai = carApi.build(THREE, { livery: liv[1], player: false, fx });
scene.add(player.group, ai.group);

function bboxOf(obj) {
  obj.updateMatrixWorld(true);
  const b = new THREE.Box3(), tmp = new THREE.Box3();
  obj.traverse((o) => {
    if (!o.isMesh) return;
    for (let q = o; q && q !== obj; q = q.parent) if (!q.visible) return;
    o.geometry.computeBoundingBox(); tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld); b.union(tmp);
  });
  return b;
}
const near = player.group.children[0];
const bb = bboxOf(near), sz = bb.getSize(new THREE.Vector3());
console.log(`bbox L ${f3(sz.z)} W ${f3(sz.x)} H ${f3(sz.y)}  (z ${f3(bb.min.z)}..${f3(bb.max.z)}, y ${f3(bb.min.y)}..${f3(bb.max.y)})`);
ok(sz.z >= 4.85 && sz.z <= 5.0, "length 4.85-5.0");
ok(sz.x >= 1.9 && sz.x <= 2.05, "width 1.9-2.05");
ok(sz.y >= 1.2 && sz.y <= 1.35, "height 1.2-1.35");
ok(bb.min.y > -0.01, "nothing under the ground");

// wheels: corners are the groups holding the hub + wheel
const corners = near.children.filter((o) => o.isGroup && o.children.length === 2 && o.children[1].isMesh && o.children[1].geometry.attributes.color && !o.children[1].geometry.attributes.glow);
ok(corners.length === 4, "4 wheel corners");
const wb = corners[0].position.z - corners[2].position.z;
ok(Math.abs(wb - 2.794) <= 0.02, "wheelbase " + f3(wb));
const wg = corners[0].children[1].geometry; wg.computeBoundingBox();
const od = wg.boundingBox.max.y - wg.boundingBox.min.y, tw = wg.boundingBox.max.x - wg.boundingBox.min.x;
ok(od >= 0.68 && od <= 0.72, "wheel OD " + f3(od) + " (tyre width incl. nut " + f3(tw) + ")");
ok(Math.abs(corners[0].position.x) + 0.165 <= sz.x / 2 + 1e-3, "tyres inside the flares");

// eye
ok(player.eye && !ai.eye, "eye on player only");
player.setCockpit(true);
const cockpit = near.children[near.children.length - 1];
const cb = bboxOf(cockpit.children[0]);
const e = player.eye.position;
console.log(`eye (${f3(e.x)}, ${f3(e.y)}, ${f3(e.z)}), cage x ${f3(cb.min.x)}..${f3(cb.max.x)} y ${f3(cb.min.y)}..${f3(cb.max.y)} z ${f3(cb.min.z)}..${f3(cb.max.z)}`);
ok(cb.containsPoint(e) && e.x > 0.15 && e.y > 0.93 && e.y < 1.02, "eye inside the cage, left of centre");
ok(e.y < 1.29 - 0.2, "helmet room under the roof");

// visibility from the eye: nothing painted between the eye and the windshield at belt height
{
  const rc = new THREE.Raycaster(); const hits = [];
  const bodyMesh = near.children[0];
  const origin = new THREE.Vector3(e.x, e.y, e.z);
  let blocked = 0, rays = 0;
  for (let yaw = -0.5; yaw <= 0.5; yaw += 0.1) for (let pit = -0.08; pit <= 0.35; pit += 0.06) {
    rc.set(origin, new THREE.Vector3(Math.sin(yaw), Math.sin(pit), Math.cos(yaw)).normalize()); rc.far = 1.5;
    hits.length = 0; rc.intersectObject(bodyMesh, false, hits); rays++; if (hits.length) blocked++;
  }
  console.log(`  forward view: ${rays - blocked}/${rays} rays clear of paint through the windshield`);
  ok(blocked / rays < 0.3, "windshield view mostly clear (no belt lid)");
}

// draw calls + tris
player.setCockpit(false);
const sp = player.stats(), sa = ai.stats();
player.setCockpit(true); const spc = player.stats(); player.setCockpit(false);
console.log(`player near ${sp.near.meshes} meshes / ${sp.near.tris} tris; cockpit ${spc.near.meshes} / ${spc.near.tris}; far ${sp.far.meshes} / ${sp.far.tris}`);
console.log(`ai     near ${sa.near.meshes} meshes / ${sa.near.tris} tris; far ${sa.far.meshes} / ${sa.far.tris}`);
ok(spc.near.meshes <= 20 && sa.near.meshes <= 20, "near <= 20 draw calls (cockpit incl.)");
ok(sa.far.meshes <= 3, "far LOD <= 3 draw calls");
ok(spc.near.tris <= 25000 && sa.near.tris <= 25000, "near <= 25k tris");
ok(sa.far.tris <= 3000, "far <= 3k tris");

// shell sanity: no NaN, positions inside bbox
{
  const g = near.children[0].geometry, P = g.attributes.position.array, N = g.attributes.normal.array;
  let bad = 0; for (let k = 0; k < P.length; k++) if (!isFinite(P[k]) || !isFinite(N[k])) bad++;
  ok(bad === 0, "shell finite (" + P.length / 3 + " verts)");
  // outward normals: the vertex with max x has +x normal, max y has +y
  let ix = 0, iy = 0; for (let k = 0; k < P.length / 3; k++) { if (P[k * 3] > P[ix * 3]) ix = k; if (P[k * 3 + 1] > P[iy * 3 + 1]) iy = k; }
  ok(N[ix * 3] > 0.5 && N[iy * 3 + 1] > 0.5, "shell normals point out");
}

// fake car state + 1000 updates with damage ramp, fx, far/near camera
const cam = new THREE.PerspectiveCamera(60, 1.6, 0.1, 2000);
const car = { pos: { x: 0, y: 0, z: 0 }, yaw: 0.3, pitch: 0.01, roll: -0.02, vel: { x: 20, z: 30 }, speed: 36, steer: 0.2, rpm: 8000, gear: 4,
  wheels: [0, 1, 2, 3].map(() => ({ spin: 0, steer: 0, compress: 0.01, slip: 0.5, load: 4000, brakeHeat: 0.8, onGrass: false })),
  fx: { backfire: 0, sparks: 0, impact: null }, damage: { front: 0, rear: 0, left: 0, right: 0, engine: 0, aero: 0 } };
const heap0 = process.memoryUsage().heapUsed;
let t0 = Date.now();
for (let k = 0; k < 1000; k++) {
  car.pos.x += 0.5; car.wheels.forEach((w, i) => { w.spin += 0.3; w.steer = i < 2 ? 0.1 : 0; });
  car.fx.backfire = k % 60 === 0 ? 1 : car.fx.backfire * 0.9; car.fx.sparks = k > 500 && k < 520 ? 1 : 0;
  if (k === 300) car.fx.impact = { x: car.pos.x + 2, y: 0.5, z: car.pos.z + 1, nx: -1, nz: 0, mag: 12, part: "front" };
  if (k > 300 && k < 400) car.damage.front = Math.min(1, car.damage.front + 0.01);
  if (k > 600 && k < 700) { car.damage.rear += 0.009; car.damage.right += 0.004; car.damage.engine += 0.008; }
  cam.position.set(car.pos.x - 6, 2, car.pos.z - 6); if (k % 200 > 150) cam.position.x += 200;
  player.update(car, 1 / 60, cam, k % 300 < 100);
  ai.update(car, 1 / 60, cam, false);
  fx.update(1 / 60, cam, 800);
}
const ms = Date.now() - t0;
console.log(`1000 frames x2 cars + fx: ${ms} ms, fx live ${fx.live}, heap +${((process.memoryUsage().heapUsed - heap0) / 1e6).toFixed(1)} MB`);
const fell = player.parts.filter((p) => p.off).map((p) => p.key);
ok(fell.includes("splitter") && fell.includes("frontCover"), "front parts fell off: " + fell.join(","));
{
  const g = near.children[0].geometry, P = g.attributes.position.array; let moved = 0, max = 0;
  const g2 = carApi.build(THREE, { livery: liv[0] }).group.children[0].children[0].geometry.attributes.position.array;
  for (let k = 0; k < P.length; k++) { const d = Math.abs(P[k] - g2[k]); if (d > 0.005) moved++; max = Math.max(max, d); }
  ok(moved > 50 && max < 0.3, `crumple moved ${moved / 3 | 0} verts, max ${f3(max)} m`);
  player.reset();
  let back = 0; for (let k = 0; k < P.length; k++) back = Math.max(back, Math.abs(P[k] - g2[k]));
  ok(back < 1e-5 && player.parts.every((p) => !p.off), "reset restores a pristine car");
}
ok(isFinite(ms) && ms < 5000, "update loop cheap");
player.dispose(); ai.dispose(); fx.dispose();
console.log(fails ? `\n${fails} FAILED` : "\nall car checks passed");
process.exit(fails ? 1 : 0);
