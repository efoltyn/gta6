#!/usr/bin/env node
// tools/check-munitions.mjs — plain-node check of weapons/munitions.js and
// its consumers: every munition's length against its real reference, lathe
// and fin winding, pool reuse, the C4 bundle, the bomb bodies + B61, the
// shared smoke budget under a Patriot + AAM + Hydra salvo, and that every
// fire path still ends in CBZ.detonate with its row. Run: node tools/check-munitions.mjs
import { readFileSync } from "node:fs"; import vm from "node:vm"; import path from "node:path"; import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const g = { console, Math, Float32Array, Uint16Array, Uint32Array, Uint8Array, Int32Array, Array, Object, Map, Set, WeakMap };
g.window = g; g.self = g; vm.createContext(g);
vm.runInContext(readFileSync(path.join(root, "src/vendor/three.r128.min.js"), "utf8"), g);
g.CBZ = { CONFIG: {} };
for (const f of ["src/weapons/appearances/sidearm.js", "src/weapons/appearances/bazooka.js", "src/weapons/munitions.js"]) vm.runInContext(readFileSync(path.join(root, f), "utf8"), g, { filename: f });
const M = g.CBZ.munitions; let fails = 0;
for (const t of Object.keys(M.SPEC)) {
  const s = M.SPEC[t], geo = M.geometry(t), bb = geo.boundingBox;
  const L = bb.max.z - bb.min.z;
  // body radius: max radius among vertices within the middle 40% of length
  const p = geo.attributes.position, n = geo.attributes.normal; let rmax = 0, inward = 0, tot = 0;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const r = Math.hypot(x, y);
    if (Math.abs(z) < L * 0.1) rmax = Math.max(rmax, Math.min(r, s.D)); }
  const e = M.parts(t);
  const okL = Math.abs(L - s.L) / s.L < 0.03;
  const lat = t;
  console.log((okL ? "ok  " : "FAIL") + ` ${t.padEnd(8)} L ${L.toFixed(3)} (ref ${s.L}) verts ${p.count} span ${(bb.max.x-bb.min.x).toFixed(2)} vane ${!!e.vane} wings ${!!e.wings}`);
  if (!okL) fails++;
  const o = M.acquire(t); M.release(o); if (M.acquire(t) !== o) { fails++; console.log("FAIL pool reuse " + t); }
}
// outward lathe check: sample lathe via kit
const lg = M.kit.latheZ([[0, -1], [0.2, -1], [0.2, 1], [0, 1]], 12);
const P = lg.attributes.position, N = lg.attributes.normal; let d = 0;
for (let i = 0; i < P.count; i++) d += P.getX(i) * N.getX(i) + P.getY(i) * N.getY(i);
// face winding check: cross product of triangle vs radial
const ng = lg.toNonIndexed(); const q = ng.attributes.position; let wout = 0, win = 0;
const T = g.THREE; const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3();
for (let i = 0; i < q.count; i += 3) { a.fromBufferAttribute(q, i); b.fromBufferAttribute(q, i+1); c.fromBufferAttribute(q, i+2);
  const nrm = b.clone().sub(a).cross(c.clone().sub(a)); const ctr = a.clone().add(b).add(c).multiplyScalar(1/3); ctr.z = 0;
  if (nrm.lengthSq() < 1e-12 || ctr.lengthSq() < 1e-6 || Math.abs(nrm.clone().normalize().z) > 0.5) continue; (nrm.dot(ctr) > 0 ? wout++ : win++); }
console.log(`lathe normals dot ${d.toFixed(2)} winding out ${wout} in ${win}`); if (win > 0 || d <= 0) fails++;
// fin winding
const fg = M.kit.fin([[0.1, 0], [0.1, 0.3], [0.3, 0.2], [0.3, 0]], 0.01, 0.7);
const fq = fg.attributes.position, fn = fg.attributes.normal; let fo = 0, fi = 0;
for (let i = 0; i < fq.count; i += 3) { a.fromBufferAttribute(fq, i); b.fromBufferAttribute(fq, i+1); c.fromBufferAttribute(fq, i+2);
  const nrm = b.clone().sub(a).cross(c.clone().sub(a)); const nn = new T.Vector3().fromBufferAttribute(fn, i); if (nrm.dot(nn) > 0) fo++; else fi++; }
console.log(`fin winding agrees with normals ${fo}/${fo+fi}`); if (fi) fails++;
console.log(JSON.stringify(M.stats()));
// ---- C4 bundle
vm.runInContext(readFileSync(path.join(root, "src/weapons/appearances/c4.js"), "utf8"), g);
g.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {}, fillText() {}, set fillStyle(v) {}, set font(v) {} }) }) };
const T3 = g.THREE;
const brick = g.CBZ.buildC4Brick(T3); let meshes = 0; brick.traverse((o) => { if (o.isMesh) meshes++; });
const bb = new T3.Box3().setFromObject(brick.children[0]);
const sz = bb.getSize(new T3.Vector3());
console.log(`C4: ${meshes} meshes, body ${sz.x.toFixed(3)} x ${sz.y.toFixed(3)} x ${sz.z.toFixed(3)} (4x M112 = 0.279 x 0.076 x 0.102 + cap/receiver), led ${!!brick.userData.led}, dims ${JSON.stringify(g.CBZ.c4PropDims())}`);
if (meshes > 4) fails++;
// ---- B61 + bombs (strategic.js region)
const strat = readFileSync(path.join(root, "src/city/strategic.js"), "utf8");
const a0 = strat.indexOf("  const MU = CBZ.munitions;"), a1 = strat.indexOf("  /* The flight body's own material pool.");
const region = `(function(){ const THREE = window.THREE, CBZ = window.CBZ; const _m = {}; function nukeMat(h){ return _m[h] || (_m[h] = new THREE.MeshLambertMaterial({color:h})); }
${strat.slice(a0, a1)}
return { bombMesh, dropBombMesh }; })()`;
const S = vm.runInContext(region, g);
for (const k of ["bomb", "jdam", "buster", "nuke"]) {
  const o = S.bombMesh(k); let n = 0; o.traverse((q) => { if (q.isMesh) n++; });
  const b3 = new T3.Box3().setFromObject(o); const s3 = b3.getSize(new T3.Vector3());
  console.log(`bomb ${k.padEnd(6)} ${n} meshes, extent ${s3.x.toFixed(2)} x ${s3.y.toFixed(2)} x ${s3.z.toFixed(2)} (nose +Z)`);
  S.dropBombMesh(o);
  if (k !== "nuke" && S.bombMesh(k) !== o) { fails++; console.log("FAIL bomb pool " + k); }
}
const w = g.CBZ.nukeWarhead({ chute: false }); let wn = 0; w.traverse((q) => { if (q.isMesh) wn++; });
const wb = new T3.Box3().setFromObject(w).getSize(new T3.Vector3());
console.log(`nukeWarhead: ${wn} mesh(es), ${wb.x.toFixed(2)} long (+X) x ${wb.y.toFixed(2)}`);
if (Math.abs(wb.x - 2.52) > 0.08) fails++;
// ---- trails: a Patriot (lofted, ~200 m/s, 9 s) and two AAMs at once stay under the smoke cap, no gaps
{
  const st = [{ x: 0, y: 0, z: 0, on: false }, { x: 0, y: 0, z: 0, on: false }, { x: 0, y: 0, z: 0, on: false }];
  const types = ["patriot", "aam", "hydra"], v = [200, 150, 150];
  let maxLive = 0; const dt = 1 / 60;
  const C = M._clouds();
  for (let f = 0; f < 60 * 6; f++) {
    for (let k = 0; k < 3; k++) {
      const sp = M.spec(types[k]), t = f * dt, z = -v[k] * t;
      if (t < sp.burn && t < 3.2 + (k === 0 ? 6 : 0)) { M.trail(st[k], k * 10, 50, z, 0, 0, -1, sp.trail, v[k]); M.motorFlare(k * 2, k * 10, 50, z, 0, 0, -1, sp.flare); }
    }
    M.step(dt); maxLive = Math.max(maxLive, C.smoke.live);
  }
  console.log(`trails: peak ${maxLive} live smoke puffs (cap ${C.smoke.n}), fire live ${C.fire.live}`);
  if (maxLive > C.smoke.n) fails++;
}
// ---- every fire path still ends in CBZ.detonate with its row (static)
const src = (f) => readFileSync(path.join(root, f), "utf8");
const air = src("src/city/aircraft.js"), fpsS = src("src/systems/fpsmode.js"), strS = src("src/city/strategic.js"), exS = src("src/city/explosives.js");
const need = [
  [air, /detonate\(hx, hy, hz, m\.byPlayer, m\.fx, m\.type\)/, "missile pool → detonate(row from the round type)"],
  [air, /const row = ROUND_ROW\[type\] \|\| "missile";[\s\S]*?CBZ\.detonate\(x, y, z, row, o\)/, "missile detonate spends the round's own row"],
  [air, /m\.fx = \{ kind: opts\.fxKind \|\| "rpg"/, "Patriot carries the rpg row"],
  [fpsS, /CBZ\.detonate\(pt\.x, pt\.y, pt\.z, "rpg"/, "RPG → rpg row"],
  [strS, /detonate\(s\.x, iy, s\.z, b\.kind,/, "bomb/jdam → their own row"],
  [strS, /resolveBuster\(/, "buster → penetrator path"],
  [strS, /nukeDetonate\(s\.x, s\.z/, "nuke → nukeDetonate"],
  [exS, /kind: "c4"/, "C4 → c4 row"],
];
for (const [s, re, label] of need) { const okk = re.test(s); console.log((okk ? "ok   " : "FAIL ") + label); if (!okk) fails++; }
for (const [s, re, label] of [[air, /new THREE\.Mesh\(a\.smoke, a\.smokeMat\)|getPatriotSmoke/, "no per-frame grey sphere / sprite trail in aircraft.js"], [fpsS, /function makeCloud/, "fpsmode has no private cloud"], [src("src/city/island_military.js"), /CBZ\.createRocketPlume = function/, "island_military has no second plume"]]) {
  const bad = re.test(s); console.log((bad ? "FAIL " : "ok   ") + label); if (bad) fails++;
}
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
