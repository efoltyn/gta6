#!/usr/bin/env node
/* tools/fp-hands-check.mjs — the first-person arms never cross, in plain node.

   Owner: "first person hands and arms, right now they look like they're
   CROSSED sometimes." This runs the REAL code — systems/fphands.js, the real
   gun kit + appearances, and fpsmode.js's own fist animation / off-hand
   fitting blocks (cut out of the file by their markers and run against small
   stubs) — through every state, and asserts in CAMERA space:

     1. the right wrist stays right of the left wrist (a hook and a rifle's
        support hand are the only allowed exceptions: they cross IN FRONT),
     2. no elbow ever crosses the midline onto the other arm's side in the
        unarmed and driving states (the pole law that makes crossing
        impossible), and in the armed states the left elbow stays left of the
        right one,
     3. the two forearms never pass through each other (closest approach of
        the two forearm capsules > the sum of their radii),
     4. every hand geometry is finite and inside its triangle budget.

   It also prints the OLD rig's numbers (rigid forearm boxes on hand-typed
   Eulers) so the cause stays on record.

     node tools/fp-hands-check.mjs
*/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
const ctx = vm.createContext({ console, Math });
ctx.window = ctx; ctx.self = ctx;
ctx.CBZ = { CONFIG: {}, weaponAppearance: {} };
for (const f of ["src/vendor/three.r128.min.js", "src/systems/fphands.js",
  "src/weapons/appearances/sidearm.js", "src/weapons/appearances/shotgun.js", "src/weapons/appearances/carbine.js",
  "src/weapons/appearances/smg.js", "src/weapons/appearances/revolver.js", "src/weapons/appearances/deagle.js",
  "src/weapons/appearances/ak47.js", "src/weapons/appearances/uzi.js", "src/weapons/appearances/sniper.js",
  "src/weapons/appearances/lmg.js", "src/weapons/appearances/bazooka.js", "src/weapons/appearances/taser.js",
  "src/weapons/appearances/glauncher.js", "src/weapons/appearances/shank.js"]) {
  vm.runInContext(read(f), ctx, { filename: f });
}
const { THREE: T, CBZ } = ctx;
const H = CBZ.fpHands;
const M = H.math;
let fails = 0, checks = 0;
function check(ok, msg) { checks++; if (!ok) { fails++; console.log("  FAIL " + msg); } }

// ---------------------------------------------------------------- 4. geometry
for (const p of Object.keys(H.POSES)) for (const s of [1, -1]) {
  const g = H.handGeometry(s, p), a = g.attributes.position.array;
  check(a.every(Number.isFinite), `hand ${p} ${s} finite`);
  check(a.length / 9 <= 2400, `hand ${p} under 2.4k tris (${a.length / 9})`);
}
// the mirror is a true left hand: thumb on +X, winding fixed (outward normals)
{
  const r = H.handGeometry(1, "open"), l = H.handGeometry(-1, "open");
  r.computeBoundingBox(); l.computeBoundingBox();
  check(Math.abs(r.boundingBox.min.x + l.boundingBox.max.x) < 1e-6, "left hand is the mirror of the right");
  const P = l.attributes.position.array, N = l.attributes.normal.array;
  let out = 0, tot = 0;
  for (let t = 0; t < P.length; t += 9) {
    const ax = P[t], ay = P[t + 1], az = P[t + 2];
    const ux = P[t + 3] - ax, uy = P[t + 4] - ay, uz = P[t + 5] - az, vx = P[t + 6] - ax, vy = P[t + 7] - ay, vz = P[t + 8] - az;
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    const d = fx * (N[t] + N[t + 3] + N[t + 6]) + fy * (N[t + 1] + N[t + 4] + N[t + 7]) + fz * (N[t + 2] + N[t + 5] + N[t + 8]);
    if (Math.abs(d) > 1e-14) { tot++; if (d > 0) out++; }
  }
  check(out / tot > 0.97, `mirrored winding agrees with normals (${(100 * out / tot).toFixed(1)}%)`);
}

// ---------------------------------------------------------------- helpers
function block(src, from, to) {
  const a = src.indexOf(from), b = src.indexOf(to, a + 1);
  assert.ok(a >= 0 && b > a, `markers ${from} .. ${to}`);
  return src.slice(a, b);
}
const V = (a) => new T.Vector3(a[0], a[1], a[2]);
const arr = (v) => [v.x, v.y, v.z];
const RAD_WRIST = 0.029, RAD_BELLY = 0.046;

// ---------------------------------------------------------------- fpsmode blocks
const FPS = read("src/systems/fpsmode.js");
const stub = `
  const THREE = window.THREE; const CBZ = window.CBZ;
  CBZ.game = { mode: "city" }; CBZ.player = { hitT: 0 }; CBZ.npcs = [];
  let punchT = 0, vmPunch = 0; const PUNCH_DUR = 0.26;
  const mat = { skin: new THREE.MeshLambertMaterial() };
`;
const fistSrc = stub
  + block(FPS, "  const HAND_REST = {", "  // THE FIST WEARS WHAT YOU WEAR")
  + block(FPS, "  // ---- the fight state of the two hands ----", "  /* ---- THE ARMS, SOLVED EVERY FRAME")
  + block(FPS, "  const SHOULDER_CAM =", "  const ARM_GUN =")
  + block(FPS, "  function defaultPole(", "  // position + orientation of a descendant of vm")
  + block(FPS, "  const ARM_GUN =", "  const _vmInv =")
  + block(FPS, "  const FPH = CBZ.fpHands || null;", "  WEAPONS.forEach((w, i) => {")
  + `
  return {
    fistT, animFists, triggerFistPunch, defaultPole, SHOULDER_CAM, ARM_FIST, ARM_GUN, fitOffHand, mat,
    get guardK() { return guardK; }, setGuardHold(v) { guardHold = v; },
  };`;
const F = vm.runInContext("(function(){" + fistSrc + "})()", ctx);

// camera-space arm for a wrist given in vm space
function solveFist(i, T0, vmPos) {
  const side = i === 0 ? 1 : -1;
  const W = [T0.x + vmPos[0], T0.y + vmPos[1], T0.z + vmPos[2]];
  const S = F.SHOULDER_CAM[i];
  const E = M.solveElbow(S, W, F.defaultPole(side, T0.hook, [0, 0, 0]), F.ARM_FIST[0], F.ARM_FIST[1]);
  return { W, E, S };
}
const K_FIST = 1.9;
function assertPair(tag, R, L, o) {
  const allowCross = o && o.allowCross;
  if (!allowCross) check(R.W[0] > L.W[0] + 0.05, `${tag}: right wrist right of left (${R.W[0].toFixed(3)} vs ${L.W[0].toFixed(3)})`);
  if (o && o.strictElbows) {
    check(R.E[0] > 0.04, `${tag}: right elbow stays right (${R.E[0].toFixed(3)})`);
    check(L.E[0] < -0.04, `${tag}: left elbow stays left (${L.E[0].toFixed(3)})`);
  } else check(R.E[0] > L.E[0], `${tag}: left elbow left of right elbow`);
  const kR = (o && o.kR) || K_FIST, kL = (o && o.kL) || K_FIST;
  const d = M.segDist(R.W, R.E, L.W, L.E);
  const need = (RAD_WRIST * kR + RAD_WRIST * kL);
  check(d > need, `${tag}: forearms clear each other (${d.toFixed(3)} > ${need.toFixed(3)})`);
  // an out-of-reach arm draws its upper arm too: it must not pass through the other forearm
  const du = M.segDist(R.W, R.E, L.E, L.S), du2 = M.segDist(L.W, L.E, R.E, R.S);
  check(Math.min(du, du2) > need * 0.9, `${tag}: no forearm through the other upper arm (${Math.min(du, du2).toFixed(3)})`);
  return d;
}

// ---------------------------------------------------------------- 1-3. UNARMED
console.log("UNARMED (vm space wrists, camera-space arms)");
const rows = [];
function frameVm() { return [0.12 * (1 - F.guardK), -0.30, -0.66]; }
// idle (relaxed right hand only) and full guard
for (let s = 0; s < 40; s++) F.animFists(0.05);
{
  const R = solveFist(0, F.fistT[0], frameVm());
  check(R.E[0] > 0.04, "idle: right elbow on its own side");
  rows.push(["idle", R.W, null]);
}
F.setGuardHold(20);
for (let s = 0; s < 40; s++) F.animFists(0.02);
{
  const vp = frameVm();
  const R = solveFist(0, F.fistT[0], vp), L = solveFist(1, F.fistT[1], vp);
  rows.push(["guard", R.W, L.W, assertPair("guard", R, L, { strictElbows: true })]);
}
// every punch, both arms, sampled across the whole swing
for (const kind of ["jab", "cross", "hook", "upper", "stab"]) {
  for (const arm of ["r", "l"]) {
    if (kind === "stab" && arm === "l") continue;
    CBZ.playerChar = { punchT: 1, punchKind: kind, punchArm: arm, punchDur: 0.30 };
    F.setGuardHold(20);
    F.triggerFistPunch(true);
    let minD = 9;
    for (let s = 0; s < 17; s++) {
      F.animFists(0.018);
      const vp = frameVm();
      const R = solveFist(0, F.fistT[0], vp), L = solveFist(1, F.fistT[1], vp);
      const d = assertPair(`${kind}-${arm} t${s}`, R, L, { strictElbows: true, allowCross: kind === "hook" });
      minD = Math.min(minD, d);
    }
    rows.push([kind + "-" + arm, null, null, minD]);
  }
}
for (const r of rows) if (r[3] != null) console.log(`  ${r[0].padEnd(9)} closest forearm approach ${r[3].toFixed(3)} m`);

// ---------------------------------------------------------------- ARMED
console.log("ARMED (every weapon, hip and sights)");
const box = (parent, sx, sy, sz, m, x, y, z, rx, ry, rz) => { const o = new T.Mesh(new T.BoxGeometry(sx, sy, sz), m); o.position.set(x || 0, y || 0, z || 0); o.rotation.set(rx || 0, ry || 0, rz || 0); parent.add(o); return o; };
const cyl = (parent, r, len, m, x, y, z, rx, ry, rz) => { const o = new T.Mesh(new T.CylinderGeometry(r, r, len, 8), m); o.position.set(x || 0, y || 0, z || 0); o.rotation.set(rx || 0, ry || 0, rz || 0); parent.add(o); return o; };
const mats = {};
for (const k of ["dark", "black", "bore", "steel", "worn", "tan", "polymer", "brass", "redShell", "wood"]) mats[k] = new T.MeshLambertMaterial();
mats.skin = F.mat.skin;
const actx = { THREE: T, box, cyl, mat: mats };
function toCam(obj, vmNode) {
  const p = new T.Vector3(), q = new T.Quaternion();
  let o = obj; let k = 1;
  while (o && o !== vmNode) { o.updateMatrix(); p.applyMatrix4(o.matrix); q.premultiply(o.quaternion); k *= o.scale.x; o = o.parent; }
  vmNode.updateMatrix();
  p.applyMatrix4(vmNode.matrix);
  return { p, k };
}
const guns = ["sidearm", "revolver", "deagle", "shotgun", "carbine", "ak47", "smg", "uzi", "sniper", "lmg", "bazooka", "glauncher", "taser", "shank"];
for (const id of guns) {
  const model = CBZ.weaponAppearance[id](actx);
  model.scale.setScalar(1.28);
  F.fitOffHand(model, { melee: id === "shank" });
  const fire = model.userData.fpFire, sup = model.userData.fpSupport;
  check(!!fire, `${id}: has a firing hand`);
  const vmNode = new T.Group(); const gunG = new T.Group();
  vmNode.add(gunG); gunG.add(model);
  for (const pose of [["hip", [0.36, -0.34, -0.72], -0.10], ["sights", [0.0, -0.22, -0.72], -0.10]]) {
    vmNode.position.set(...pose[1]); vmNode.rotation.set(pose[2], 0, 0);
    const fr = toCam(fire, vmNode);
    const R = { W: arr(fr.p), S: F.SHOULDER_CAM[0] };
    R.E = M.solveElbow(F.SHOULDER_CAM[0], R.W, F.defaultPole(1, 0, [0, 0, 0]), F.ARM_GUN[0], F.ARM_GUN[1]);
    check(R.E[0] > R.W[0] - 0.05 && R.E[1] < R.W[1], `${id} ${pose[0]}: firing elbow below and outboard of the wrist`);
    if (!sup) { console.log(`  ${id.padEnd(9)} ${pose[0].padEnd(6)} one-handed`); continue; }
    const sp = toCam(sup, vmNode);
    const L = { W: arr(sp.p), S: F.SHOULDER_CAM[1] };
    L.E = M.solveElbow(F.SHOULDER_CAM[1], L.W, F.defaultPole(-1, 0, [0, 0, 0]), F.ARM_GUN[0], F.ARM_GUN[1]);
    const d = assertPair(`${id} ${pose[0]}`, R, L, { allowCross: true, kR: fr.k, kL: sp.k });
    console.log(`  ${id.padEnd(9)} ${pose[0].padEnd(6)} R wrist ${R.W.map((v) => v.toFixed(2)).join(",")}  L wrist ${L.W.map((v) => v.toFixed(2)).join(",")}  forearms ${d.toFixed(3)} m apart`);
  }
}

// ---------------------------------------------------------------- DRIVING
console.log("DRIVING (hands on the rim through full lock)");
{
  const PC = read("src/city/playercars.js");
  const src = "const THREE = window.THREE; const CBZ = window.CBZ;" + block(PC, "  const WHEEL_POSE =", "  /* shadeCabin") + "return CBZ.carCabinHands;";
  const make = vm.runInContext("(function(){" + src + "})()", ctx);
  const skin = new T.MeshLambertMaterial(), sleeve = new T.MeshLambertMaterial({ color: 0x223344 });
  const hands = make(skin, sleeve, 0.18);
  const spin = new T.Group(); spin.add(hands);
  const S = [new T.Vector3(-0.20, 0.04, -0.50), new T.Vector3(0.20, 0.04, -0.50)];
  let minD = 9;
  for (let st = -1; st <= 1.0001; st += 0.1) {
    spin.rotation.z = -st * 1.55; spin.updateMatrix();
    hands.userData.tick(spin, S);
    const arms = hands.userData.arms.children;
    // arm 0 is the driver's RIGHT (-X), arm 1 the left
    const seg = (a) => { const f = a.userData.parts.fore; const w = f.position.clone(); const e = new T.Vector3(0, 0, 1).applyQuaternion(f.quaternion).multiplyScalar(f.scale.z).add(w); return { W: arr(w), E: arr(e) }; };
    const R = seg(arms[0]), L = seg(arms[1]);
    // the driver's right is -X: mirror X so "right" reads positive like the other checks
    const flip = (o) => ({ W: [-o.W[0], o.W[1], o.W[2]], E: [-o.E[0], o.E[1], o.E[2]] });
    const Rf = flip(R), Lf = flip(L);
    check(Rf.E[0] > 0.04 && Lf.E[0] < -0.04, `wheel ${st.toFixed(1)}: elbows on their own sides (${Rf.E[0].toFixed(2)}, ${Lf.E[0].toFixed(2)})`);
    const d = M.segDist(R.W, R.E, L.W, L.E);
    check(d > RAD_BELLY * 2 * 1.08, `wheel ${st.toFixed(1)}: forearms clear (${d.toFixed(3)})`);
    minD = Math.min(minD, d);
  }
  console.log(`  closest forearm approach through lock-to-lock ${minD.toFixed(3)} m`);
}

// ---------------------------------------------------------------- THE OLD RIG (on record)
{
  // rigid forearm boxes (0.16 wide) along the fist's local +Z, 0.28 long, on hand-typed Eulers
  const old = (p) => { const e = new T.Euler(p.rx, p.ry, p.rz); const tail = new T.Vector3(0, 0, 0.28).applyEuler(e).add(new T.Vector3(p.x, p.y, p.z)); return [p.x, tail.x]; };
  const GR = old({ x: 0.16, y: 0.12, z: 0.20, rx: 0.62, ry: -0.50, rz: -0.45 });
  const GL = old({ x: -0.19, y: 0.10, z: 0.15, rx: 0.58, ry: 0.55, rz: 0.45 });
  const HK = old({ x: -0.12, y: 0.14, z: 0.02, rx: 0.30, ry: -0.70, rz: -0.50 });
  console.log(`OLD RIG: guard forearm tails at x ${GR[1].toFixed(3)} / ${GL[1].toFixed(3)} (boxes 0.16 wide -> overlapping X);`
    + ` right hook fist at x ${HK[0]} with its forearm tail at ${HK[1].toFixed(3)}, through the left guard at -0.16`);
}

console.log(`\n${checks - fails}/${checks} checks passed`);
if (fails) process.exit(1);
