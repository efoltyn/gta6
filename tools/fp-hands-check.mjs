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
     4. every hand geometry is finite and inside its triangle budget,
     5-8. (armed, run through fpsmode's REAL poseFpArms) every gun hand is a
        grasp that ends ON the gun: fingertips within 1 cm of the grip /
        handguard / pump surface, nothing buried, the index pad on the
        trigger face, the thumb resting on the part; one hand size on every
        gun; each forearm leaves the frame down and to its own side; the
        wrist never bends past its limit.
   Its eyes: tools/fp-hands-studio.html + tools/fp-hands-shot.mjs render the
   same viewmodel headless (node tools/fp-hands-shot.mjs carbine:hip sidearm:ads).

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
  "src/weapons/appearances/glauncher.js", "src/weapons/appearances/shank.js", "src/entities/watch.js"]) {
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
  // 3k: the palm is a smooth closed superellipsoid now (the box palm's seams
  // read as folded flaps up close); two hands on screen, still nothing
  check(a.length / 9 <= 3000, `hand ${p} under 3k tris (${a.length / 9})`);
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
  + block(FPS, "  const SHOULDER_CAM =", "  const _vmInv =")
  + block(FPS, "  function defaultPole(", "  // position + orientation of a descendant of vm")
  + `
  return {
    fistT, animFists, triggerFistPunch, defaultPole, SHOULDER_CAM, ARM_FIST, mat,
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
  // (o.fromT: measure from that far up the forearm — a reload puts one hand ON
  // the other's gun, and hands may touch; forearms still may not cross)
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const ft = (o && o.fromT) || 0;
  const d = M.segDist(lerp(R.W, R.E, ft), R.E, lerp(L.W, L.E, ft), L.E);
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
/* The REAL arm solver: fpsmode.js's fitOffHand + fist/arm construction +
   poseFpArms, cut out by their markers and run against stubs (the same cut
   tools/fp-hands-studio.html renders), at the hip, down the sights and
   through a reload. Then, per weapon:
     5. every wrapped fingertip ends ON the part it holds (within 1 cm of its
        surface, real scale), no finger segment buried in it (> 3 mm), the
        index pad on the trigger's face (within 1 cm), the thumb resting on
        the part (within 2.5 cm, not buried);
     6. one hand size on every gun (the old kit sized it per weapon, 0.78x
        to 1.2x, so the hand shrank when you swapped guns);
     7. each forearm leaves the frame: its elbow projects outside the hip
        (75 deg) lens, below or beside it, and the forearm heads down and
        toward its own side, never at the eye;
     8. the wrist never bends past its limit off the hand's natural line. */
console.log("ARMED (every weapon: hip, sights, reload; the real poseFpArms)");
const box = (parent, sx, sy, sz, m, x, y, z, rx, ry, rz) => { const o = new T.Mesh(new T.BoxGeometry(sx, sy, sz), m); o.position.set(x || 0, y || 0, z || 0); o.rotation.set(rx || 0, ry || 0, rz || 0); parent.add(o); return o; };
const cyl = (parent, r, len, m, x, y, z, rx, ry, rz) => { const o = new T.Mesh(new T.CylinderGeometry(r, r, len, 8), m); o.position.set(x || 0, y || 0, z || 0); o.rotation.set(rx || 0, ry || 0, rz || 0); parent.add(o); return o; };
{
  const GH = read("src/systems/gunhands.js");
  const choreo = vm.runInContext("(function(){" + block(GH, "  const CHOREO = {", "  // the same choreography") + "; return CHOREO;})()", ctx);
  let reloadP = -1;
  CBZ.gunReloadChoreo = (st) => choreo[st] || choreo.mag;
  CBZ.gunReloadPose = () => reloadP >= 0 ? { active: true, p: reloadP, style: CBZ._style || "mag" } : { active: false };
  const armSrc = `
    const THREE = window.THREE; const CBZ = window.CBZ;
    const mat = { skin: new THREE.MeshLambertMaterial() };
    const camera = new THREE.Group(); CBZ.camera = camera;
    const vm = new THREE.Group(); camera.add(vm);
    const gun = new THREE.Group();
    const weaponModels = [];
    let ddT = -1; const fps = { weapon: 0 };
    let punchT = 0, vmPunch = 0, guardK = 0;
    const fistT = [{ vis: false }, { vis: false }];
  ` + block(FPS, "  const FPH = CBZ.fpHands || null;", "  WEAPONS.forEach((w, i) => {")
    + block(FPS, "  const fists = new THREE.Group();", "  vm.add(gun, fists, fpArms);")
    + `  vm.add(gun, fists, fpArms); fists.visible = false;`
    + block(FPS, "  /* ---- THE ARMS, SOLVED EVERY FRAME", "  let aimHeld = false;")
    + `
    return { vm, gun, weaponModels, mat, fitOffHand, poseFpArms, armR, armL, WRIST_DEV, box: null };`;
  const A = vm.runInContext("(function(){" + armSrc + "})()", ctx);
  const mats = {};
  for (const k of ["dark", "black", "bore", "steel", "worn", "tan", "polymer", "brass", "redShell", "wood"]) mats[k] = new T.MeshLambertMaterial();
  mats.skin = A.mat.skin;
  const actx = { THREE: T, box, cyl, mat: mats };
  const guns = ["sidearm", "revolver", "deagle", "shotgun", "carbine", "ak47", "smg", "uzi", "sniper", "lmg", "bazooka", "glauncher", "taser", "shank"];
  const camOf = (v) => { A.vm.updateMatrix(); return v.clone().applyMatrix4(A.vm.matrix); };
  // the hip lens is 75 deg; down the sights it is at most 63 (irons, weaponAdsFov)
  const ASPECT = 16 / 10;
  const outOfLens = (c, fov) => { const t = Math.tan(fov * Math.PI / 360); return c.z > -0.05 || Math.abs(c.y / -c.z) > t || Math.abs(c.x / -c.z) > t * ASPECT; };
  const handK = [];
  let watchWorst = 0;
  CBZ.playerChar = { _ww: { role: "diver", over: null } };        // the player's watch (entities/watch.js styleOf)
  for (const id of guns) {
    const model = CBZ.weaponAppearance[id](actx);
    model.scale.setScalar(1.28);
    A.fitOffHand(model, { melee: id === "shank" });
    CBZ._style = (model.userData.grips && model.userData.grips.style) || "mag";
    const fire = model.userData.fpFire, sup = model.userData.fpSupport;
    check(!!fire, `${id}: has a firing hand`);
    A.weaponModels.length = 0; A.weaponModels.push(model);
    A.gun.children.slice().forEach((c) => A.gun.remove(c)); A.gun.add(model);
    A.vm.visible = true; A.gun.visible = true;
    // 5. the grasp, at real scale
    for (const [nm, h] of [["firing", fire], ["support", sup]]) {
      const G = h && h.userData.grasp;
      if (!G) continue;
      const c = G.contacts, P = G.prism;
      c.tips.forEach((t, i) => {
        if (t == null) return;
        check(t <= 0.010, `${id} ${nm}: ${["index", "middle", "ring", "little"][i]} fingertip on the part (${(t * 1000).toFixed(1)} mm off)`);
      });
      let buried = 0;
      G.pose.joints.fingers.forEach((pts) => {
        for (let s = 0; s < 3; s++) for (let u = 0.25; u <= 1.0001; u += 0.25) {
          const q = G.toM([pts[s][0] + (pts[s + 1][0] - pts[s][0]) * u, pts[s][1] + (pts[s + 1][1] - pts[s][1]) * u, pts[s][2] + (pts[s + 1][2] - pts[s][2]) * u]);
          buried = Math.min(buried, H.prismSdf(P, q.x, q.y, q.z) / G.k - 0.0095 * 0.85);
        }
      });
      check(buried > -0.003, `${id} ${nm}: no finger buried in the part (${(buried * 1000).toFixed(1)} mm)`);
      if (nm === "firing" && id !== "shank") check(c.trigger != null && c.trigger <= 0.010, `${id}: index pad on the trigger (${c.trigger == null ? "none" : (c.trigger * 1000).toFixed(1) + " mm"})`);
      check(c.thumb <= 0.025 && c.thumb > -0.004, `${id} ${nm}: thumb resting on the part (${(c.thumb * 1000).toFixed(1)} mm)`);
      if (nm === "firing") handK.push([id, (function () { let k = 1, o = h; while (o && o !== A.vm) { k *= o.scale.x; o = o.parent; } return k; })()]);
    }
    const poses = [["hip", [0.36, -0.34, -0.72], -0.10, -1], ["sights", [0.0, -0.22, -0.72], -0.10, -1]];
    if (sup) for (const p of [0.08, 0.30, 0.50, 0.70, 0.90]) poses.push(["reload" + p, [0.36, -0.34 - 0.13, -0.72], -0.10 + 0.13 * 0.8, p]);
    for (const pose of poses) {
      A.vm.position.set(...pose[1]); A.vm.rotation.set(pose[2], 0, 0);
      reloadP = pose[3];
      A.poseFpArms();
      const arm = (a) => {
        const P = a.userData.parts;
        return { W: camOf(P.fore.position), E: camOf(P.elbow.position), S: camOf(P.upper.position.clone().add(new T.Vector3(0, 0, 1).applyQuaternion(P.upper.quaternion).multiplyScalar(P.upper.scale.z))) };
      };
      const R = arm(A.armR), tag = `${id} ${pose[0]}`;
      const Ra = { W: arr(R.W), E: arr(R.E), S: arr(R.S) };
      // 7. the forearm leaves the frame, down and to its own side
      // (a reload reaches: a rocket goes in the FRONT of the tube, and an arm
      // stretched down the gun shows its elbow; the lens law is for the hold)
      const lensFov = pose[0] === "hip" ? 75 : pose[0] === "sights" ? 63 : 0;
      if (lensFov) check(outOfLens(R.E, lensFov), `${tag}: firing elbow out of the lens (${arr(R.E).map((v) => v.toFixed(2))})`);
      check(R.E.y < R.W.y && R.E.x > R.W.x - 0.05, `${tag}: firing forearm heads down and out`);
      // 8. the wrist limit (angle off the hand's natural line)
      const wristAngle = (h, a) => {
        const q = new T.Quaternion(); let o = h;
        const chain = []; while (o && o !== A.vm) { chain.push(o); o = o.parent; }
        for (let i = chain.length - 1; i >= 0; i--) q.multiply(chain[i].quaternion);
        const want = h.userData.foreLocal.clone().applyQuaternion(q).applyQuaternion(A.vm.quaternion);
        return want.angleTo(a.E.clone().sub(a.W));
      };
      check(wristAngle(fire, R) <= A.WRIST_DEV[0] + 1e-3, `${tag}: firing wrist within its limit (${(wristAngle(fire, R) * 57.3).toFixed(0)} deg)`);
      if (!sup) { if (pose[0] === "hip") console.log(`  ${id.padEnd(9)} one-handed`); continue; }
      const L = arm(A.armL);
      const La = { W: arr(L.W), E: arr(L.E), S: arr(L.S) };
      // 9. the player's watch (entities/watch.js rides the LEFT arm's poseArm):
      // real scale on screen, never a big dial facing the lens from the
      // bottom-centre (owner: "a HUGE dial at the bottom-centre over the hotbar")
      const ww = A.armL.userData.ww && A.armL.userData.ww.inst;
      if (lensFov && ww && ww.visible) {
        const head = ww.children[1];
        ww.updateMatrix(); head.updateMatrix();
        const Mh = ww.matrix.clone().multiply(head.matrix).premultiply(A.vm.matrix), pos = head.geometry.attributes.position, v = new T.Vector3();
        const tanH = Math.tan(lensFov * Math.PI / 360);
        let x0 = Infinity, x1 = -Infinity, cx = 0, cy = 0;
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(Mh);
          const nx = v.x / (-v.z * tanH * ASPECT), ny = v.y / (-v.z * tanH);
          x0 = Math.min(x0, nx); x1 = Math.max(x1, nx); cx += nx; cy += ny;
        }
        cx /= pos.count; cy /= pos.count;
        const span = (x1 - x0) / 2;
        const hc = new T.Vector3().applyMatrix4(Mh), face = new T.Vector3(0, 0, 1).transformDirection(Mh);
        const facing = face.dot(hc.clone().negate().normalize());
        const inBand = Math.abs(cx) < 0.25 && cy < -0.55 && cy > -1;
        check(span < 0.12, `${tag}: the watch spans ${(span * 100).toFixed(1)}% of the lens`);
        check(!(inBand && facing > 0.5 && span > 0.06), `${tag}: no big dial facing the lens at the bottom-centre (${cx.toFixed(2)}, ${cy.toFixed(2)}, facing ${facing.toFixed(2)})`);
        watchWorst = Math.max(watchWorst, span);
      }
      if (lensFov) check(outOfLens(L.E, lensFov), `${tag}: support elbow out of the lens (${arr(L.E).map((v) => v.toFixed(2))})`);
      check(L.E.y < L.W.y && L.E.x < L.W.x + 0.05, `${tag}: support forearm heads down and out`);
      check(wristAngle(sup, L) <= A.WRIST_DEV[1] + 1e-3, `${tag}: support wrist within its limit (${(wristAngle(sup, L) * 57.3).toFixed(0)} deg)`);
      const k = handK[handK.length - 1][1];
      const d = assertPair(tag, Ra, La, { allowCross: true, kR: k, kL: k, fromT: lensFov ? 0 : 0.3 });
      if (pose[0] === "hip" || pose[0] === "sights") console.log(`  ${id.padEnd(9)} ${pose[0].padEnd(6)} R wrist ${Ra.W.map((v) => v.toFixed(2)).join(",")}  L wrist ${La.W.map((v) => v.toFixed(2)).join(",")}  forearms ${d.toFixed(3)} m apart`);
    }
    reloadP = -1;
  }
  console.log(`  the player's watch on the support arm: widest ${(watchWorst * 100).toFixed(1)}% of the lens`);
  // 6. one hand size
  const k0 = handK[0][1];
  for (const [id, k] of handK) check(Math.abs(k / k0 - 1) < 0.01, `${id}: the same hand size as every other gun (${k.toFixed(3)} vs ${k0.toFixed(3)})`);
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
