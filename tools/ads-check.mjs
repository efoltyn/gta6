#!/usr/bin/env node
/* tools/ads-check.mjs — aim-down-sights is a real sight picture, in plain node.

   Owner: "when you scope in, it's like a fake scope ... you're not holding
   the gun up and actually looking through it." systems/sights.js solves the
   first-person viewmodel so the gun's sight EYE POINT sits on the camera and
   its LINE OF SIGHT is the view axis. This builds every real gun model (the
   real appearances + gun kit + optic factory, a viewmodel chain exactly like
   fpsmode's: camera -> vm -> gun -> model at 1.28) and asserts, per gun:

     1. the sight resolves (type/mag match weapon-data's optic row), with an
        eye point BEHIND the sight (toward the shooter) at a sane eye relief,
     2. the solved pose puts the eye point on the camera origin (< 1 mm of
        viewmodel units) and the sight line on the view axis (< 0.05 deg),
        with the gun's up staying up (no roll),
     3. irons: the front post's tip and the rear sight both lie ON the view
        axis (the post covers the crosshair — the round goes there),
     4. optics: the ocular / rear glass is centred on the view axis in front
        of the eye, beyond the near plane, and a scope's lens subtends a real
        eyepiece (not a pinhole, not the whole screen),
     5. a fitted gunsmith optic overrides the factory sight,
     6. anchors, when a model publishes them, win over the derivation.

     node tools/ads-check.mjs
*/
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
const ctx = vm.createContext({ console, Math });
ctx.window = ctx; ctx.self = ctx;
ctx.CBZ = { CONFIG: {}, weaponAppearance: {} };
for (const f of ["src/vendor/three.r128.min.js", "src/systems/fphands.js", "src/weapons/weapon-data.js", "src/weapons/optics.js",
  "src/weapons/appearances/sidearm.js", "src/weapons/appearances/shotgun.js", "src/weapons/appearances/carbine.js",
  "src/weapons/appearances/smg.js", "src/weapons/appearances/revolver.js", "src/weapons/appearances/deagle.js",
  "src/weapons/appearances/ak47.js", "src/weapons/appearances/uzi.js", "src/weapons/appearances/sniper.js",
  "src/weapons/appearances/lmg.js", "src/weapons/appearances/bazooka.js", "src/weapons/appearances/taser.js",
  "src/weapons/appearances/glauncher.js", "src/weapons/appearances/shank.js", "src/systems/sights.js"]) {
  vm.runInContext(read(f), ctx, { filename: f });
}
const { THREE: T, CBZ } = ctx;
const S = CBZ.sights;
let fails = 0, checks = 0;
const check = (ok, msg) => { checks++; if (!ok) { fails++; console.log("  FAIL " + msg); } };
if (!S || !S.resolve || !S.fpPose) { console.log("sights.js did not install CBZ.sights"); process.exit(1); }

const mat = {};
for (const k of ["dark", "black", "bore", "steel", "worn", "tan", "polymer", "brass", "redShell", "skin"]) mat[k] = new T.MeshLambertMaterial();
const box = (p, sx, sy, sz, m, x, y, z, rx, ry, rz) => { const o = new T.Mesh(new T.BoxGeometry(sx, sy, sz), m); o.position.set(x || 0, y || 0, z || 0); o.rotation.set(rx || 0, ry || 0, rz || 0); p.add(o); return o; };
const cyl = (p, r, len, m, x, y, z, rx, ry, rz) => { const o = new T.Mesh(new T.CylinderGeometry(r, r, len, 12), m); o.position.set(x || 0, y || 0, z || 0); o.rotation.set(rx || 0, ry || 0, rz || 0); p.add(o); return o; };
const actx = { THREE: T, box, cyl, mat };

// the fpsmode chain: camera -> vm -> gun -> model (scale 1.28)
function rig(w, extra) {
  const cam = new T.PerspectiveCamera(75, 16 / 9, 0.1, 1000);
  const vmG = new T.Group(), gun = new T.Group();
  cam.add(vmG); vmG.add(gun);
  const model = CBZ.weaponAppearance[w.appearanceFactory || w.key](actx);
  model.scale.setScalar(1.28);
  gun.add(model);
  if (extra) extra(model);
  vmG.position.set(0.36, -0.34, -0.72); vmG.rotation.set(-0.10, 0, 0);   // the hip pose it starts from
  return { cam, vmG, gun, model };
}
function solve(R, rec) {
  const out = { pos: new T.Vector3(), quat: new T.Quaternion() };
  R.vmG.position.set(0, 0, 0); R.vmG.quaternion.identity();
  S.fpPose(R.vmG, R.model, rec, out);
  R.vmG.position.copy(out.pos); R.vmG.quaternion.copy(out.quat);
  R.cam.updateMatrixWorld(true);
  return out;
}
// a model-space point in camera space (camera at origin looking down -Z)
const inCam = (R, p) => R.model.localToWorld(p.clone());
const deg = (r) => r * 180 / Math.PI;

const expectType = { none: "none", iron: "iron", dot: "reddot", mgo: "scope", acog: "scope", m3a: "scope", pgo7: "scope" };
console.log("ADS (every gun: the sight picture the solved viewmodel makes)");
for (const w of CBZ.FPS_WEAPONS) {
  const R = rig(w);
  const rec = S.resolve(R.model, w);
  const row = CBZ.weaponOptic(w);
  const tag = w.id.padEnd(9);
  check(!!rec, `${tag}: sight resolves`);
  if (!rec) continue;
  check(rec.type === expectType[row.id], `${tag}: type ${rec.type} matches optic row ${row.id}`);
  if (rec.type === "none") { console.log(`  ${tag} none (no sight: ${w.melee ? "a blade" : "no sight line"})`); continue; }
  check(!!rec.eye, `${tag}: has an eye point`);
  if (!rec.eye) continue;
  const upm = rec.upm;
  solve(R, rec);
  // 2. eye on the camera, sight line on the axis, up stays up
  const eyeC = inCam(R, rec.eye);
  check(eyeC.length() < 1e-3, `${tag}: eye point on the camera (${eyeC.length().toExponential(2)})`);
  const aheadC = inCam(R, rec.eye.clone().addScaledVector(rec.dir, 0.5));
  const axisErr = deg(Math.atan2(Math.hypot(aheadC.x, aheadC.y), -aheadC.z));
  check(aheadC.z < 0 && axisErr < 0.05, `${tag}: sight line on the view axis (${axisErr.toFixed(4)} deg)`);
  const upC = inCam(R, rec.eye.clone().add(rec.up)).sub(eyeC);
  check(upC.y > 0.99 * upC.length(), `${tag}: gun upright down the sights (up.y ${(upC.y / upC.length()).toFixed(4)})`);
  const muzC = inCam(R, R.model.userData.muzzle);
  check(muzC.z < -0.1, `${tag}: muzzle out ahead of the eye (${muzC.z.toFixed(2)})`);
  // 3. irons: rear sight and front post tip on the axis
  let extra = "";
  if (rec.type === "iron") {
    const f = inCam(R, rec.front), r = inCam(R, rec.rear);
    const fe = deg(Math.atan2(Math.hypot(f.x, f.y), -f.z)), re = deg(Math.atan2(Math.hypot(r.x, r.y), -r.z));
    check(f.z < r.z && r.z < -0.1, `${tag}: rear sight between the eye and the front post, past the near plane (rear ${r.z.toFixed(3)}, front ${f.z.toFixed(3)})`);
    check(fe < 0.1 && re < 0.1, `${tag}: rear notch and front post on the axis (${re.toFixed(3)}/${fe.toFixed(3)} deg)`);
    const relief = (rec.eye.z - rec.rear.z) / upm;
    check(relief > 0.02 && relief < 0.6, `${tag}: eye ${(relief * 100).toFixed(1)} cm behind the rear sight`);
    extra = `rear ${(relief * 100).toFixed(0)} cm, sight radius ${((rec.rear.z - rec.front.z) / upm * 100).toFixed(0)} cm, height over bore ${((rec.front.y - R.model.userData.muzzle.y) / upm * 100).toFixed(1)} cm`;
  } else {
    // 4. optics: glass centred in front of the eye
    check(!!rec.lens, `${tag}: optic has a lens`);
    if (rec.lens) {
      const l = inCam(R, rec.lens.pos);
      const le = Math.hypot(l.x, l.y);
      check(l.z < -0.1 && le < 1e-3, `${tag}: glass centred on the axis in front of the eye, past the near plane (z ${l.z.toFixed(3)}, off ${le.toExponential(1)})`);
      const halfDeg = deg(Math.atan((rec.lens.r * 1.28) / -l.z));
      const relief = (rec.eye.z - rec.lens.pos.z) / upm;
      if (rec.type === "scope") check(halfDeg > 6 && halfDeg < 30, `${tag}: eyepiece subtends a real ocular (${(2 * halfDeg).toFixed(1)} deg across)`);
      else check(relief >= 0.069 && relief < 0.6, `${tag}: eye ${(relief * 100).toFixed(1)} cm behind the dot glass`);
      extra = `${rec.type} ${rec.mag.toFixed(1)}x, glass ${(relief * 100).toFixed(0)} cm ahead, ${(2 * halfDeg).toFixed(1)} deg across`;
    }
  }
  console.log(`  ${tag} ${rec.type.padEnd(6)} ${rec.from}  ${extra}`);
}

// 5. a fitted gunsmith optic wins over the factory sight
{
  const w = CBZ.weaponById("ak47");
  const R = rig(w, (model) => {
    const g = new T.Group(); g.name = "_gmods";
    g.add(CBZ.createWeaponOptic({ name: "fitted-sniper", x: 0, y: 0.13, z: -0.3, length: 0.34, radius: 0.05, highMag: true }));
    model.add(g);
  });
  CBZ.gunModsScopeOf = (id) => id === "ak47" ? { id: "sniper", fov: 11, overlay: "scope", highMag: true } : null;
  const rec = S.resolve(R.model, w);
  check(rec.type === "scope" && rec.mag > 7, `fitted 8x on the AK reads as a scope (${rec.type} ${rec.mag.toFixed(1)}x)`);
  solve(R, rec);
  const l = inCam(R, rec.lens.pos);
  check(Math.hypot(l.x, l.y) < 1e-3 && l.z < -0.1, "fitted scope's ocular on the axis");
  console.log(`  ak47+8x  ${rec.type} ${rec.mag.toFixed(1)}x fitted`);
  CBZ.gunModsScopeOf = null;
}

// 6. anchors win
{
  const w = CBZ.weaponById("sidearm");
  const R = rig(w, (model) => {
    model.userData.anchors = { sight: { eye: [0, 0.2, 0.9], quat: [0, 0, 0, 1], eyeRelief: 0.4 }, optic: { type: "iron", mag: 1 } };
  });
  const rec = S.resolve(R.model, w);
  check(rec.from === "anchors" && Math.abs(rec.eye.z - 0.9) < 1e-9, "anchor sight eye point is used as published");
  solve(R, rec);
  check(inCam(R, rec.eye).length() < 1e-3, "anchor eye lands on the camera");
}

console.log(`\n${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
