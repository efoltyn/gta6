#!/usr/bin/env node
// tools/check-torch-grip.mjs — plain-node check of THE TORCH IN THE HAND (no browser).
//   Loads three (worktree node_modules), systems/fphands.js and
//   weapons/flashlight.js against a tiny fake window/CBZ, builds the torch and
//   the 'torch' grip, seats one in the other with fphands.torchMount (both
//   hands, at life size and at viewmodel scale under a turned parent), and
//   asserts:
//     1. the body is a ~3 cm tube;
//     2. the grip centre lies within 1 cm of the handle's axis AND its centre;
//     3. the lens comes out of the little-finger side, the tail by the thumb;
//     4. every fingertip ends on the tube (within 1 cm, never inside), no
//        finger joint is inside it;
//     5. the thumb's pad rests on the tail switch;
//     6. torchMount is exactly placeGrip inverted;
//     7. the beam origin IS the lens position.
// Run: node tools/check-torch-grip.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const THREE = require(path.join(root, "node_modules/three/build/three.cjs"));
globalThis.window = { THREE, CBZ: {} };
globalThis.THREE = THREE;
for (const f of ["src/systems/fphands.js", "src/weapons/flashlight.js"]) {
  vm.runInThisContext(readFileSync(path.join(root, f), "utf8"), { filename: f });
}
const CBZ = globalThis.window.CBZ, H = CBZ.fpHands;

let fails = 0, checks = 0;
function ok(cond, msg) { checks++; if (!cond) { fails++; console.log("FAIL " + msg); } }
const cm = (m) => (m * 100).toFixed(2) + " cm";

ok(H && typeof H.torchMount === "function" && H.POSES.torch, "fphands has no torch grip");
ok(typeof CBZ.buildFlashlight === "function", "no CBZ.buildFlashlight");

// 1. the tube
const probe = CBZ.buildFlashlight();
const hd = probe.userData.handle;
ok(hd && Math.abs(hd.radius * 2 - 0.03) <= 0.003, "body diameter " + cm(hd.radius * 2) + " (want ~3 cm)");
console.log(`torch: body ${cm(hd.radius * 2)} across, ${cm(probe.userData.length)} long, handle centre z ${cm(hd.center.z)}`);

// distance from p to the torch's handle cylinder surface, hand frame (right-hand pose joints)
function tubeGap(p, c, a, r, half) {
  const d = new THREE.Vector3().subVectors(p, c);
  const t = d.dot(a);
  const radial = d.clone().addScaledVector(a, -t).length() - r;
  const along = Math.abs(t) - half;
  return along > 0 ? Math.hypot(Math.max(radial, 0), along) : radial;
}

const pose = H.resolvePose("torch");
const joints = pose._joints;
for (const side of [1, -1]) {
  for (const scene of [{ k: 1, name: "life" }, { k: 2.56, name: "viewmodel" }]) {
    const tag = (side > 0 ? "right" : "left") + "/" + scene.name;
    const parent = new THREE.Group();
    parent.position.set(0.3, -0.2, -0.7);
    parent.rotation.set(0.4, -0.9, 0.25);
    const hand = H.makeHand(side, "torch", null);
    hand.scale.setScalar(scene.k);
    hand.position.set(0.05, 0.02, -0.1);
    hand.rotation.set(-0.3, 0.6, 1.1);
    parent.add(hand);
    const torch = CBZ.buildFlashlight({ lit: true });
    hand.add(torch);
    H.torchMount(side, torch.userData.handle, torch.position, torch.quaternion);
    parent.updateMatrixWorld(true);

    // everything below in the HAND's own frame, hand metres
    const toHand = (v) => hand.worldToLocal(v.clone());
    const handleC = toHand(torch.localToWorld(torch.userData.handle.center.clone()));
    const lensH = toHand(torch.localToWorld(torch.userData.beamOrigin.clone()));
    const tailH = toHand(torch.localToWorld(torch.userData.tailSwitch.clone()));
    const axisH = lensH.clone().sub(tailH).normalize();
    const gc = H.gripCentre("torch", new THREE.Vector3());
    if (side < 0) gc.x = -gc.x;

    // 2. grip centre on the handle axis and at the handle centre
    const dCentre = gc.distanceTo(handleC);
    const w = gc.clone().sub(handleC);
    const dAxis = w.addScaledVector(axisH, -w.dot(axisH)).length();
    ok(dCentre <= 0.01, `${tag}: grip centre ${cm(dCentre)} from the handle centre`);
    ok(dAxis <= 0.01, `${tag}: grip centre ${cm(dAxis)} off the handle axis`);

    // 3. lens out of the little finger (+X right, -X left), tail by the thumb
    ok(Math.sign(axisH.x) === side && Math.abs(axisH.x) > 0.99, `${tag}: torch axis ${axisH.toArray().map((v) => v.toFixed(2))} is not across the fist toward the little finger`);

    // the pose joints are authored right-handed: mirror into this hand's frame
    const J = (p) => new THREE.Vector3(side * p[0], p[1], p[2]);
    const r = torch.userData.handle.radius, half = torch.userData.handle.halfLength;
    const bodyC = toHand(torch.localToWorld(new THREE.Vector3(0, 0, -0.009)));      // the body tube's middle
    // 4. fingers wrap the tube
    let worstTip = 0, worstIn = 0;
    joints.fingers.forEach((pts, i) => {
      const f = H.FINGERS[i], rt = f.r * 0.78;
      const tip = tubeGap(J(pts[3]), bodyC, axisH, r, half) - rt;
      worstTip = Math.max(worstTip, Math.abs(tip));
      ok(tip <= 0.01, `${tag}: finger ${i} tip ${cm(tip)} off the tube`);
      ok(tip >= -0.0015, `${tag}: finger ${i} tip ${cm(-tip)} inside the tube`);
      for (let j = 1; j < 4; j++) {
        const g = tubeGap(J(pts[j]), bodyC, axisH, r, half) - f.r * 0.8;
        worstIn = Math.min(worstIn, g);
        ok(g >= -0.002, `${tag}: finger ${i} joint ${j} ${cm(-g)} inside the tube`);
      }
    });
    // 5. the thumb's pad on the tail switch
    const th = joints.thumb, tipT = J(th[3]);
    const dThumb = tipT.distanceTo(tailH);
    ok(dThumb <= H.TORCH.padR + 0.004, `${tag}: thumb pad ${cm(dThumb)} from the tail switch`);
    for (let s = 0; s < 3; s++) {
      const L = Math.hypot(th[s + 1][0] - th[s][0], th[s + 1][1] - th[s][1], th[s + 1][2] - th[s][2]);
      ok(Math.abs(L - H.THUMB.seg[s]) < 1e-4, `${tag}: thumb segment ${s} is ${cm(L)}, bone is ${cm(H.THUMB.seg[s])}`);
    }

    // 6. torchMount == placeGrip inverted
    const h2 = H.attachGrip(torch, { side, pose: "torch", center: torch.userData.handle.center, axis: torch.userData.handle.axis.clone().negate(), dorsal: new THREE.Vector3(0, 1, 0) }, null);
    torch.updateMatrixWorld(true);
    const e = new THREE.Matrix4().multiplyMatrices(torch.matrix, h2.matrix).elements;
    const I = new THREE.Matrix4().elements;
    const err = Math.max(...e.map((v, i) => Math.abs(v - I[i])));
    ok(err < 1e-6, `${tag}: torchMount is not placeGrip inverted (err ${err})`);
    torch.remove(h2);

    // 7. the beam leaves the lens
    const lensW = torch.userData.lens.getWorldPosition(new THREE.Vector3());
    const beamW = torch.localToWorld(torch.userData.beamOrigin.clone());
    ok(lensW.distanceTo(beamW) < 1e-6, `${tag}: beam origin ${beamW.distanceTo(lensW)} m from the lens`);
    const fwdW = torch.localToWorld(torch.userData.beamOrigin.clone().add(torch.userData.forward)).sub(beamW).normalize();
    const tailW = torch.localToWorld(torch.userData.tailSwitch.clone());
    ok(fwdW.dot(beamW.clone().sub(tailW).normalize()) > 0.9999, `${tag}: beam direction is not tail -> lens`);

    console.log(`${tag.padEnd(16)} grip->handle centre ${cm(dCentre)}, ->axis ${cm(dAxis)}; worst fingertip gap ${cm(worstTip)}; thumb pad->switch ${cm(dThumb)}; lens x ${cm(lensH.x)}`);
  }
}

console.log(fails ? `\n${fails}/${checks} checks FAILED` : `\nall ${checks} checks passed`);
process.exit(fails ? 1 : 0);
