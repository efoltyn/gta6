#!/usr/bin/env node
/* tools/body-silhouette.mjs — THE BODY AS NUMBERS, no browser, no pictures.

   Builds the real rig in node (tools/lib/rig-vm.mjs) and slices it every 3 cm
   of height: the trunk's half-width and front / back depth, the hanging arm's
   inner and outer edge, the leg, the head. Read it against a real person
   (a 1.78 m man: shoulders 49 cm, chest 32, waist 29, hips 35, hip joint at
   0.93 m, fingertips at mid-thigh; a 1.67 m woman: shoulders 43, waist 24,
   hips 36) to see what a proportion change did before anything is rendered.

     node tools/body-silhouette.mjs                     # m/average, f/average
     node tools/body-silhouette.mjs . f/slim,m/heavy    # repo root, bodies
     node tools/body-silhouette.mjs /path/to/other/checkout m/average   # compare a worktree */
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
const ROOT = path.resolve(process.argv[2] || path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const who = (process.argv[3] || "m/average,f/average").split(",");
const { loadRig } = await import(pathToFileURL(path.join(ROOT, "tools/lib/rig-vm.mjs")).href);
const ctx = loadRig();
const { THREE: T, CBZ } = ctx;
const skin = 0xb87955;
const look = { skin, torso: 0x315f94, arms: skin, legs: 0x202c3c, shoes: 0x201a18, hair: 0x2b1b12, hairStyle: "buzz" };
const v = new T.Vector3();
function tris(list) {
  const out = [];
  for (const m of list) {
    if (!m || !m.geometry || m.visible === false) continue;
    const pos = m.geometry.attributes.position, idx = m.geometry.index;
    const P = [];
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld); P.push([v.x, v.y, v.z]); }
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i += 3) out.push([P[idx ? idx.getX(i) : i], P[idx ? idx.getX(i + 1) : i + 1], P[idx ? idx.getX(i + 2) : i + 2]]);
  }
  return out;
}
// extents of the slice y=h through a triangle soup
function slice(TR, h) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const t of TR) for (let e = 0; e < 3; e++) {
    const a = t[e], b = t[(e + 1) % 3];
    if ((a[1] - h) * (b[1] - h) > 0 || a[1] === b[1]) continue;
    const k = (h - a[1]) / (b[1] - a[1]), x = a[0] + (b[0] - a[0]) * k, z = a[2] + (b[2] - a[2]) * k;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  return x1 > x0 ? { x0, x1, z0, z1 } : null;
}
const f = (x) => x == null ? "   -- " : (x * 100).toFixed(1).padStart(6);
for (const tag of who) {
  const [build, physique] = tag.split("/");
  const rig = CBZ.human.build(Object.assign({}, look, { build, physique }));
  rig.group.updateMatrixWorld(true);
  const s = rig.skinSlots;
  const trunk = tris([].concat(s.torso, s.pelvis));
  const head = []; rig.group.traverse((o) => { if (o.isMesh && o.name === "head") head.push(o); });
  const headT = tris(head);
  const armM = []; rig.parts.la.traverse((o) => { if (o.isMesh) armM.push(o); });
  const arm = tris(armM);
  const leg = tris([s.legs[1], s.legsLower[1]]);
  console.log("\n== " + tag + "   (cm)  h | trunk half-w | trunk front/back z | arm inner..outer x | arm z | leg inner..outer | head half-w, z");
  for (let h = 1.80; h > 0.02; h -= 0.03) {
    const a = slice(trunk, h), b = slice(arm, h), c = slice(leg, h), d = slice(headT, h);
    console.log(f(h), "|", f(a && a.x1), "|", f(a && a.z1), f(a && a.z0), "|", f(b && b.x0), f(b && b.x1), "|", f(b && b.z0), f(b && b.z1), "|", f(c && c.x0), f(c && c.x1), "|", f(d && d.x1), f(d && d.z0), f(d && d.z1));
  }
}
