#!/usr/bin/env node
/* tools/body-hands-check.mjs — THE BODY'S HAND IS THE FIRST-PERSON HAND.

   Owner: "The FP hands are really real, but on the third-person models those
   hands are way different." Every body wore a skin BOX where its hand should
   be; now character.js hangs systems/fphands.js's own hand (body LOD) at the
   wrist. This runs the REAL fphands.js + materials.js + character.js in plain
   node (no browser, no captures) and asserts:

     1. the body LODs are the same hand: finite, inside their triangle
        budgets (lod 1 120..250, lod 2 30..60), within a few mm of the full
        hand's bounds in every pose, and the left is a true mirror with
        outward winding;
     2. a built rig has two hand meshes, in the ELBOW groups, hanging from the
        forearm's end (the wrist crease), fingers down, palm to the thigh,
        below the elbow, fingertips within 5 cm of where the box used to end;
     3. geometry is SHARED between rigs (pedinstance pools it by identity);
        size is mesh.scale; skinSlots.hands / userData.cap are the meshes;
     4. the sockets did not move; setHandPose swaps the cached geometry, and a
        hold pose closes the hand's grip centre onto its socket;
     5. a woman's and a child's hands come out smaller than a man's.

     node tools/body-hands-check.mjs        exit 0 = ok */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
const ctx = vm.createContext({ console, Math, performance });
ctx.window = ctx; ctx.self = ctx;
ctx.CBZ = { CONFIG: {}, onAlways() {}, onUpdate() {}, on() {} };
for (const f of ["src/vendor/three.r128.min.js", "src/world/materials.js", "src/systems/fphands.js", "src/entities/character.js"]) {
  vm.runInContext(read(f), ctx, { filename: f });
}
const { THREE: T, CBZ } = ctx;
const H = CBZ.fpHands;
let fails = 0, checks = 0;
function check(ok, msg) { checks++; if (!ok) { fails++; console.log("  FAIL " + msg); } }
const bb = (g) => { g.computeBoundingBox(); return g.boundingBox; };

// ---------------------------------------------------------------- 1. LODs
const tris = {};
for (const p of Object.keys(H.POSES)) for (const s of [1, -1]) {
  const full = bb(H.handGeometry(s, p).clone());
  for (const lod of [1, 2]) {
    const g = H.bodyHandGeometry(s, p, lod), a = g.attributes.position.array, n = g.attributes.normal.array;
    const t = a.length / 9;
    tris[lod] = Math.max(tris[lod] || 0, t);
    check(a.every(Number.isFinite) && n.every(Number.isFinite), `lod${lod} ${p} ${s} finite`);
    check(lod === 1 ? (t >= 120 && t <= 250) : (t >= 30 && t <= 60), `lod${lod} ${p} tri budget (${t})`);
    check(g === H.bodyHandGeometry(s, p, lod), `lod${lod} ${p} cached`);
    check(g._shared === true, `lod${lod} ${p} marked _shared`);
    const b = bb(g);
    // the same hand: the fingertips/knuckles/thumb land where the full hand's do
    // (the far mitten may lose up to 2.5 cm of reach at the curled tips)
    const tol = lod === 1 ? 0.006 : 0.025;
    check(Math.abs(b.min.z - full.min.z) < tol, `lod${lod} ${p} ${s} reach ${b.min.z.toFixed(3)} vs ${full.min.z.toFixed(3)}`);
    check(Math.abs(b.min.x - full.min.x) < tol && Math.abs(b.max.x - full.max.x) < tol, `lod${lod} ${p} ${s} width`);
  }
}
check(H.bodyHandGeometry(1, "relaxed", 0) === H.handGeometry(1, "relaxed"), "lod 0 is the first-person hand itself");
check(H.bodyHandGeometry(1, "fist", 1) !== H.bodyHandGeometry(1, "relaxed", 1), "poses are distinct geometries");
for (const lod of [1, 2]) {
  const r = bb(H.bodyHandGeometry(1, "open", lod).clone()), l = bb(H.bodyHandGeometry(-1, "open", lod).clone());
  check(Math.abs(r.min.x + l.max.x) < 1e-6 && Math.abs(r.max.x + l.min.x) < 1e-6, `lod${lod} left is the mirror of the right`);
  for (const s of [1, -1]) {
    // outward winding: face normal agrees with the stored vertex normal
    const g = H.bodyHandGeometry(s, "relaxed", lod), P = g.attributes.position.array, N = g.attributes.normal.array;
    let out = 0, tot = 0;
    for (let t = 0; t < P.length; t += 9) {
      const ax = P[t + 3] - P[t], ay = P[t + 4] - P[t + 1], az = P[t + 5] - P[t + 2];
      const bx = P[t + 6] - P[t], by = P[t + 7] - P[t + 1], bz = P[t + 8] - P[t + 2];
      const fx = ay * bz - az * by, fy = az * bx - ax * bz, fz = ax * by - ay * bx;
      const d = fx * (N[t] + N[t + 3] + N[t + 6]) + fy * (N[t + 1] + N[t + 4] + N[t + 7]) + fz * (N[t + 2] + N[t + 5] + N[t + 8]);
      if (Math.hypot(fx, fy, fz) < 1e-12) continue;
      tot++; if (d > 0) out++;
    }
    check(out / tot > 0.97, `lod${lod} side ${s} outward winding ${(100 * out / tot).toFixed(1)}%`);
  }
}

// ---------------------------------------------------------------- 2-5. rigs
const base = { skin: 0xb87955, torso: 0x315f94, collar: 0x315f94, arms: 0x315f94, legs: 0x202c3c, shoes: 0x201a18, hair: 0x2b1b12 };
const v = new T.Vector3(), w = new T.Vector3();
function build(o) {
  const r = CBZ.makeCharacter(Object.assign({}, base, o || {}));
  r.group.updateMatrixWorld(true);
  return r;
}
const man = build(), man2 = build({ skin: 0x5a3a28 }), woman = build({ build: "f" }), kid = build({ age: 7 });
function handReport(r, tag) {
  const P = r.profile;
  const hs = r.skinSlots.hands;
  check(hs.length === 2, `${tag} two hands`);
  const [l, rr] = hs;
  check(r.parts.la.userData.cap === l && r.parts.ra.userData.cap === rr, `${tag} userData.cap is the hand`);
  check(l.parent === r.low.la && rr.parent === r.low.ra, `${tag} hands live in the ELBOW groups`);
  check(l.userData.side === -1 && rr.userData.side === 1, `${tag} la is the left hand, ra the right`);
  check(l.geometry === H.bodyHandGeometry(-1, "relaxed", 1) && rr.geometry === H.bodyHandGeometry(1, "relaxed", 1), `${tag} relaxed body-LOD geometry`);
  check(l.castShadow === false, `${tag} hands cast no shadow`);
  // sockets did not move
  for (const s of [r.sockets.leftHand, r.sockets.rightHand]) {
    check(Math.abs(s.position.y - (-P.armLo - 0.01)) < 1e-9 && Math.abs(s.position.z - 0.035) < 1e-9 && s.position.x === 0, `${tag} socket unchanged`);
  }
  check(r.sockets.weapon === r.sockets.rightHand && r.sockets.thirdPersonWeapon.parent === r.sockets.rightHand, `${tag} weapon sockets chained as before`);
  // hangs from the forearm's end
  for (const [k, h] of [["la", l], ["ra", rr]]) {
    const fore = r.parts[k].userData.lower;
    const fb = bb(fore.geometry.clone());
    // a lofted forearm (character.js LIMBS) ends its last SECTION at the crease
    // and closes with a shallow dome that tucks into the hand's wrist stub
    const lf = fore.geometry.userData && fore.geometry.userData.limb;
    const foreBottom = fore.position.y + (lf ? lf.y0 - lf.sy : fb.min.y);       // in the elbow frame
    if (lf) check(fb.min.y > lf.y0 - lf.sy - 0.04, `${tag} ${k} wrist dome is shallow (${(lf.y0 - lf.sy - fb.min.y).toFixed(3)})`);
    check(Math.abs(h.position.y - foreBottom) < 0.005, `${tag} ${k} wrist at the forearm's end (${h.position.y.toFixed(3)} vs ${foreBottom.toFixed(3)})`);
    check(Math.abs(foreBottom - (P.handH - P.armLo)) < 0.005, `${tag} ${k} forearm ends at the crease`);
    // fingers point DOWN the arm, palm faces the body, thumb forward
    const q = h.quaternion;
    const fingers = v.set(0, 0, -1).applyQuaternion(q), palm = w.set(0, -1, 0).applyQuaternion(q);
    check(fingers.y < -0.99, `${tag} ${k} fingers hang down (${fingers.y.toFixed(3)})`);
    const inward = k === "la" ? -1 : 1;                   // la sits at +X, ra at -X
    check(palm.x * inward > 0.9, `${tag} ${k} palm to the thigh (${palm.x.toFixed(3)})`);
    const thumb = v.set(h.userData.side < 0 ? 1 : -1, 0, 0).applyQuaternion(q);
    check(thumb.z > 0.9, `${tag} ${k} thumb forward (${thumb.z.toFixed(3)})`);
    // world: below the elbow, fingertips near the old box bottom
    const elbowW = r.low[k].getWorldPosition(new T.Vector3());
    const hb = new T.Box3().setFromObject(h);
    check(hb.max.y < elbowW.y, `${tag} ${k} hand below the elbow`);
    const oldBottom = new T.Vector3(0, -P.armLo - 0.03, 0);
    r.low[k].localToWorld(oldBottom);
    check(Math.abs(hb.min.y - oldBottom.y) < 0.05, `${tag} ${k} fingertips ${hb.min.y.toFixed(3)} vs old box bottom ${oldBottom.y.toFixed(3)}`);
  }
  return { l, rr, s: rr.scale.x };
}
const M = handReport(man, "man"), M2 = handReport(man2, "man2"), F = handReport(woman, "woman"), K = handReport(kid, "child");
check(M.rr.geometry === M2.rr.geometry && M.l.geometry === M2.l.geometry, "geometry shared between two rigs");
check(M.rr.material === man.skinSlots.hands[1].material && M.rr.material._shared, "hands wear the shared cmat");
check(M.rr.material !== M2.rr.material, "different skin -> different cached material");
check(F.s < M.s && K.s < F.s, `hand scale man ${M.s.toFixed(3)} > woman ${F.s.toFixed(3)} > child ${K.s.toFixed(3)}`);

// pose swap + hold alignment
{
  const r = build();
  const h = r.skinSlots.hands[1], restY = h.position.y;
  const tgt = new T.Vector3().copy(r.sockets.rightHand.position).add(r.sockets.thirdPersonWeapon.position);
  const gcOf = (m) => H.gripCentre(m.userData.handPose, new T.Vector3()).multiplyScalar(m.scale.x).applyQuaternion(m.quaternion).add(m.position);
  const restMiss = gcOf(h).distanceTo(tgt);
  r.setHandPose("r", "pistol");
  check(h.geometry === H.bodyHandGeometry(1, "pistol", 1), "setHandPose swaps to the cached pistol geometry");
  const holdMiss = gcOf(h).distanceTo(tgt);
  console.log(`pistol grip centre -> weapon socket: ${holdMiss.toFixed(3)} rig units (relaxed ${restMiss.toFixed(3)})`);
  check(holdMiss < restMiss && holdMiss < 0.06, `pistol grip closes on the weapon socket (miss ${holdMiss.toFixed(3)}, rest ${restMiss.toFixed(3)})`);
  check(h.position.y <= restY + 1e-9 && restY - h.position.y <= h.userData.fit.maxDrop + 1e-9, "hand slides down its wrist, no further than the stub covers");
  check(r.skinSlots.hands[0].userData.handPose === "relaxed", "setHandPose('r') leaves the left alone");
  r.setHandPose("both", "fist");
  check(r.skinSlots.hands[0].geometry === H.bodyHandGeometry(-1, "fist", 1) && h.geometry === H.bodyHandGeometry(1, "fist", 1), "setHandPose('both', 'fist')");
  check(Math.abs(h.position.y - restY) < 1e-9, "a fist hangs at the wrist (no slide)");
  r.setHandPose("l", "nonsense");
  check(r.skinSlots.hands[0].userData.handPose === "relaxed", "unknown pose -> relaxed");
  r.setHandLod(2);
  check(h.geometry === H.bodyHandGeometry(1, "fist", 2), "setHandLod(2) -> far geometry, pose kept");
  r.setHandLod(1);
  const lm = CBZ.charArmLandmarks(r);
  check(lm.handTop === r.profile.handH - r.profile.armLo && lm.handBottom < lm.hand && lm.hand < lm.handTop && lm.wrist > lm.handTop, "arm landmarks ordered wrist > crease > knuckles > fingertips");
  check(lm.ringHand === h, "rings mount on the right hand mesh");
}

console.log(`body hand tris: lod1 <= ${tris[1]}, lod2 <= ${tris[2]}; scale man ${M.s.toFixed(3)} woman ${F.s.toFixed(3)} child ${K.s.toFixed(3)}`);
console.log(`\n${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
