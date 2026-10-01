#!/usr/bin/env node
/* tools/watch-check.mjs — THE WRISTWATCH SITS ON THE WRIST.

   Runs the REAL fphands.js + materials.js + character.js + entities/watch.js
   in plain node (no browser, no captures) and asserts:

     1. every style's head, strap, hands and crystal build finite, inside a
        triangle budget, with their material groups in range; the dial faces
        the wearer (+Z) and 12 o'clock is +X;
     2. on a man, a woman and a child, bare-armed and in a long sleeve: the
        watch is on the LEFT forearm's elbow group, the head is drawn at the
        HAND's scale (a case well under two thirds of the hand's width) on the
        back of the wrist. Bare: the strap encloses the forearm's measured
        section and no visible part of the hand reaches the watch in EVERY
        hand pose. Sleeved: the strap is above the hem and inside the cloth,
        no part of the head above the hem is outside the cloth (nothing over
        the fabric), and the dial peeks out past the cuff. The watch turns
        with a forearm twisted to a gun hand (character.js wristTwist);
     3. first person: the wrapped fpHands.poseArm puts the player's watch on
        the LEFT arm only, between wrist and elbow, dial on the back of the
        wrist, head at the hand's scale, strap on the forearm's skin (bare and
        sleeved; sleeved, the head stays under the cuff's outer band and
        peeks past its lip), over a spread of wrist rolls and bends; the right
        arm stays bare; on the gun arm's support wrist the dial spans under
        12% of the lens (the on-screen placement at fpsmode's real poses is
        tools/fp-hands-check.mjs's);
     4. the hands read the game clock (phase 0 = 06:00) and the LCD lights
        exactly the segments of the time it shows;
     5. roles: inmates get a clear/resin digital or nothing, cops steel, the
        warden gold, kids a kid digital or nothing; the player always wears one;
     6. a bling override replaces the role watch and detaching gives it back.

     node tools/watch-check.mjs        exit 0 = ok */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
const ctx = vm.createContext({ console, Math, performance, Date });
ctx.window = ctx; ctx.self = ctx;
ctx.CBZ = { CONFIG: {}, onAlways() {}, onUpdate() {}, on() {} };
for (const f of ["src/vendor/three.r128.min.js", "src/world/materials.js", "src/systems/fphands.js", "src/entities/footwear.js", "src/entities/character.js", "src/entities/watch.js"]) {
  vm.runInContext(read(f), ctx, { filename: f });
}
const { THREE: T, CBZ } = ctx;
const W = CBZ.wristwatch, X = W._test, H = CBZ.fpHands;
let fails = 0, checks = 0;
function check(ok, msg) { checks++; if (!ok) { fails++; console.log("  FAIL " + msg); } }
const tris = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
const finite = (g) => Array.prototype.every.call(g.attributes.position.array, Number.isFinite);

// ---- 1. geometry ---------------------------------------------------------
const fitRef = X.makeFit(0.030, 0.023, 0.7);
for (const st of Object.keys(W.STYLES)) {
  const hg = X.headGeometry(st), sg = X.strapGeometry(st, fitRef);
  check(finite(hg) && finite(sg), st + ": finite geometry");
  check(tris(hg) < 6000, st + ": head " + tris(hg) + " tris within budget");
  check(tris(sg) < 5000, st + ": strap " + tris(sg) + " tris within budget");
  for (const gg of [hg, sg]) for (const gr of gg.groups) check(gr.materialIndex >= 0 && gr.materialIndex < 6, st + ": group material in range");
  // dial faces +Z: the area-weighted normal of the dial group points up
  const dg = hg.groups.find((g) => g.materialIndex === 3);
  if (dg) {
    const p = hg.attributes.position, idx = hg.index.array, a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3(), sum = new T.Vector3();
    for (let i = dg.start; i < dg.start + dg.count; i += 3) {
      a.fromBufferAttribute(p, idx[i]); b.fromBufferAttribute(p, idx[i + 1]); c.fromBufferAttribute(p, idx[i + 2]);
      sum.add(b.sub(a).cross(c.sub(a)));
    }
    check(sum.z > 0 && Math.hypot(sum.x, sum.y) < sum.z * 0.05, st + ": dial faces the wearer");
  }
  // outward winding: the strap band (slot 0, closed) and the case lathe have positive signed volume
  const vol = (gg, slot) => {
    const gr = gg.groups.find((g) => g.materialIndex === slot); if (!gr) return 1;
    const p = gg.attributes.position, idx = gg.index.array, a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3();
    let v = 0;
    for (let i = gr.start; i < gr.start + gr.count; i += 3) {
      a.fromBufferAttribute(p, idx[i]); b.fromBufferAttribute(p, idx[i + 1]); c.fromBufferAttribute(p, idx[i + 2]);
      v += a.dot(b.clone().cross(c)) / 6;
    }
    return v;
  };
  check(vol(sg, 0) > 0, st + ": strap wound outward");
  check(vol(hg, 1) > 0, st + ": case wound outward");
  // the head's bounding box: centred on the dial, crown side (-Y) not beyond reason
  hg.computeBoundingBox();
  const bb = hg.boundingBox, R = W.STYLES[st].R;
  check(bb.max.x > R && bb.min.x < -R, st + ": lugs reach past the case at 12 and 6");
  check(bb.min.z > -1e-6 && bb.max.z < 0.02, st + ": case back at z=0, under 2 cm tall");
}

// ---- 2. third person, every pose ------------------------------------------
CBZ.scene = new T.Scene();
const cam = new T.Vector3();
const poses = Object.keys(H.POSES);
const bodies = [
  { label: "man", c: { build: "m" } },
  { label: "woman", c: { build: "f" } },
  { label: "child", c: { build: "m", age: 11 } },
];
const _m = new T.Matrix4(), _v = new T.Vector3();
function toAnchor(obj, anchor) {
  const M = new T.Matrix4();
  let o = obj;
  while (o && o !== anchor) { o.updateMatrix(); M.premultiply(o.matrix); o = o.parent; }
  return M;
}
function bboxIn(mesh, anchor) {
  const M = toAnchor(mesh, anchor), pos = mesh.geometry.attributes.position, b = new T.Box3();
  for (let i = 0; i < pos.count; i++) b.expandByPoint(_v.fromBufferAttribute(pos, i).applyMatrix4(M));
  return b;
}
// inside the forearm loft (its own frame, CBZ.humanLimbHalfAt) by `grow` (0.966: a 12-around loft's flats)
function inLoft(fore, anchor, p, grow) {
  const l = p.clone().applyMatrix4(toAnchor(fore, anchor).invert());
  const h = CBZ.humanLimbHalfAt(fore.geometry, l.y);
  return Math.hypot(l.x / (h.hx * grow), (l.z - h.cz) / (h.hz * grow)) <= 1;
}
const SKIN = 0xc89a78;
for (const B of bodies) for (const sleeve of [false, true]) {
  const rig = CBZ.makeCharacter(Object.assign({ legs: 0x223344, torso: 0x445566, arms: sleeve ? 0x445566 : SKIN, skin: SKIN, shoes: 0x222222 }, B.c));
  CBZ.scene.add(rig.group);
  rig.group.updateMatrixWorld(true);
  W.wear(rig, "diver");
  const r = X.recOf(rig);
  X.sync(r, cam);
  const inst = r.inst, tagB = B.label + (sleeve ? "/sleeve" : "/bare");
  check(!!inst, tagB + ": watch mounted");
  if (!inst) continue;
  const anchor = rig.low.la, fore = rig.skinSlots.armsLower[0];
  check(fore.userData.limb.variant === (sleeve ? "cloth" : "bare"), tagB + ": forearm variant " + fore.userData.limb.variant);
  check(inst.parent === anchor, tagB + ": on the LEFT elbow group");
  check(rig.parts.la.position.x > 0, tagB + ": the left arm is +X (dorsal roll assumption)");
  const P = r.place;
  const [strap, head] = inst.children;
  const hb = bboxIn(head, anchor), sb = bboxIn(strap, anchor);
  const lm = CBZ.charArmLandmarks(rig);
  // SIZE: the head is drawn at the hand's scale (a 40 mm case beside an 84 mm hand), not the arm's
  const hand = rig.parts.la.userData.cap, hs = hand.scale.x;
  check(Math.abs(head.scale.x / hs - 1) < 1e-6, tagB + ": head at the hand's scale (" + head.scale.x.toFixed(3) + " vs " + hs.toFixed(3) + ")");
  const dial = hb.max.y - hb.min.y, handW = 2 * H.PALM.hw * hs;           // 3-9 o'clock (along the arm), lugs excluded
  check(dial < 0.62 * handW, tagB + ": case " + (dial / hs * 1000).toFixed(0) + " mm across vs an " + (handW / hs * 1000).toFixed(0) + " mm hand");
  const hc = hb.getCenter(new T.Vector3());
  check(hc.x - P.pos.x > P.fit.b * 0.6, tagB + ": head on the back of the wrist (dx " + (hc.x - P.pos.x).toFixed(3) + " vs b " + P.fit.b.toFixed(3) + ")");
  check(Math.max(hb.max.y, sb.max.y) < 0.06, tagB + ": watch below the elbow");
  if (!sleeve) {
    // the strap encloses the forearm section at the watch line
    const sec = X.sliceSection(fore.geometry, toAnchor(fore, anchor), 1, P.pos.y);
    check(sb.max.z >= sec.cu + sec.hu && sb.min.z <= sec.cu - sec.hu && sb.max.x >= sec.cw + sec.hw && sb.min.x <= sec.cw - sec.hw,
      tagB + ": strap encloses the forearm");
    check(P.fit.a >= sec.hu - 1e-6 && P.fit.b >= sec.hw - 1e-6, tagB + ": fit is the measured section");
    check(Math.min(hb.min.y, sb.min.y) > lm.handTop, tagB + ": whole watch above the wrist crease");
    // every hand pose: no visible hand vertex reaches the watch
    const watchLow = Math.min(hb.min.y, sb.min.y);
    for (const pose of poses) {
      rig.setHandPose("l", pose);
      const M = toAnchor(hand, anchor), pos = hand.geometry.attributes.position;
      let worst = -Infinity;
      for (let i = 0; i < pos.count; i++) {
        _v.fromBufferAttribute(pos, i).applyMatrix4(M);
        const outside = Math.abs(_v.x - sec.cw) > sec.hw || Math.abs(_v.z - sec.cu) > sec.hu;
        if (outside) worst = Math.max(worst, _v.y);
      }
      check(worst < watchLow, tagB + "/" + pose + ": visible hand stays below the watch (" + worst.toFixed(3) + " < " + watchLow.toFixed(3) + ")");
    }
    rig.setHandPose("l", "relaxed");
  } else {
    // UNDER THE SLEEVE: the strap wraps the real wrist inside the cloth, the
    // head above the hem is inside the cloth too (nothing over the fabric),
    // and the dial peeks out past the cuff
    const crease = lm.handTop;
    const WR = H.WRIST;
    check(P.fit.a >= 0.9 * WR.hw * hs - 1e-9 && P.fit.b >= 0.95 * WR.ht * hs - 1e-9, tagB + ": strap wraps the hand's own wrist (cinched at most 10%)");
    const all = (mesh, fn) => { const M = toAnchor(mesh, anchor), pos = mesh.geometry.attributes.position; let bad = 0, n = 0; for (let i = 0; i < pos.count; i++) { _v.fromBufferAttribute(pos, i).applyMatrix4(M); const o = fn(_v.clone()); if (o == null) continue; n++; if (!o) bad++; } return [bad, n]; };
    const [sLow] = all(strap, (v) => v.y > crease);
    const [sBad, sN] = all(strap, (v) => v.y > crease ? inLoft(fore, anchor, v, 0.966) : null);
    check(sLow === 0, tagB + ": strap above the hem (" + sLow + " vertices below it)");
    check(sN > 0 && sBad === 0, tagB + ": strap under the sleeve (" + sBad + "/" + sN + " vertices out of the cloth)");
    const [hBad, hN] = all(head, (v) => v.y > crease + 0.001 ? inLoft(fore, anchor, v, 0.966) : null);
    check(hBad === 0, tagB + ": no part of the head sits over the fabric (" + hBad + "/" + hN + " out)");
    check(hb.min.y < crease - 0.2 * (hb.max.y - hb.min.y), tagB + ": the dial peeks out past the cuff (" + ((crease - hb.min.y) / (hb.max.y - hb.min.y) * 100).toFixed(0) + "% below the hem)");
  }
  // the forearm twists with a gun hand (character.js wristTwist): the watch turns with it
  if (CBZ.charWristTwist) {
    hand.quaternion.premultiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), 0.9));
    CBZ.charWristTwist(rig, "l");
    X.sync(r, cam);
    const d = new T.Vector3(0, 0, 1).applyQuaternion(inst.quaternion), f = new T.Vector3(1, 0, 0).applyQuaternion(fore.quaternion);
    check(Math.abs(fore.rotation.y) > 0.5 && d.dot(f) > 0.999, tagB + ": the watch turns with a twisted forearm (" + fore.rotation.y.toFixed(2) + ")");
    rig.setHandPose("l", "fist"); rig.setHandPose("l", "relaxed");
    X.sync(r, cam);
    check(fore.rotation.y === 0, tagB + ": a new pose untwists the forearm");
  }
  // near detail comes and goes
  X.setNear(inst, true);
  check(!!inst.userData.ww.near, tagB + ": near detail on");
  X.setNear(inst, false);
  check(!inst.userData.ww.near, tagB + ": near detail off");
}

// ---- 2b. DRESSED AFTER IT WAS BUILT ----------------------------------------
// Owner: "watches overlap with shirts". A body built in a tee has a "bare"
// forearm loft; put it in a long sleeve later (outfits.js tints that loft the
// shirt colour) and the watch used to stay wrapped round the loft's surface —
// over the cloth. What the forearm WEARS decides, live, both ways.
{
  const rig = CBZ.makeCharacter({ legs: 0x223344, torso: 0x445566, arms: SKIN, skin: SKIN, shoes: 0x222222 });
  CBZ.scene.add(rig.group);
  rig.group.updateMatrixWorld(true);
  W.wear(rig, "diver");
  const r = X.recOf(rig), fore = rig.skinSlots.armsLower[0], anchor = rig.low.la;
  X.sync(r, cam);
  check(r.place && r.place.sleeve === false, "redress: a tee body's watch is on the skin");
  fore.material = fore.material.clone();
  fore.material.color.setHex(0x445566);
  X.sync(r, cam);
  check(r.place && r.place.sleeve === true, "redress: the same forearm in a long sleeve puts the watch under it");
  if (r.inst) {
    const crease = CBZ.charArmLandmarks(rig).handTop;
    const [strap, head] = r.inst.children;
    let bad = 0, n = 0, badS = 0;
    for (const mesh of [strap, head]) {
      const M = toAnchor(mesh, anchor), pos = mesh.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        _v.fromBufferAttribute(pos, i).applyMatrix4(M);
        if (_v.y <= crease + 0.001) continue;
        n++; if (!inLoft(fore, anchor, _v.clone(), 0.966)) { bad++; if (mesh === strap) badS++; }
      }
    }
    check(n > 0 && bad === 0, "redress: nothing of the watch over the sleeve (" + bad + "/" + n + " out, " + badS + " of the strap)");
  }
  fore.material.color.setHex(SKIN);
  X.sync(r, cam);
  check(r.place && r.place.sleeve === false, "redress: back in the tee, back on the skin");
  CBZ.scene.remove(rig.group);
}

// ---- 3. first person ------------------------------------------------------
const player = CBZ.makeCharacter({ legs: 0xff7a1a, torso: 0xff7a1a, arms: 0xff7a1a, skin: 0xf0c39a, stripes: 0xc85c00 });
CBZ.playerChar = player;
check(!!W.styleOf(player), "player always wears a watch (" + W.styleOf(player) + ")");
W.wear(player, "gold");
const mats = { fore: new T.MeshLambertMaterial(), upper: new T.MeshLambertMaterial() };
const armL = H.makeArm(mats), armR = H.makeArm(mats);
const K = 1.9;
const cases = [];
for (const roll of [-0.6, 0, 0.8]) for (const bend of [-0.4, 0, 0.5]) for (const sleeved of [false, true]) cases.push({ roll, bend, sleeved });
for (const C of cases) {
  const wrist = new T.Vector3(-0.16, -0.10, -0.40), elbow = new T.Vector3(-0.28, -0.32, -0.10), shoulder = new T.Vector3(-0.22, -0.30, 0.18);
  const along = wrist.clone().sub(elbow);
  const q = H.orientAlong(-1, along, C.roll, C.bend, new T.Quaternion());
  H.poseArm(armL, wrist, elbow, shoulder, q, K, C.sleeved);
  const st = armL.userData.ww, inst = st && st.inst;
  const tag = "FP roll " + C.roll + " bend " + C.bend + (C.sleeved ? " sleeved" : "");
  check(!!inst && inst.visible, tag + ": left arm wears the watch");
  if (!inst) continue;
  const axis = elbow.clone().sub(wrist), lf = axis.length(); axis.normalize();
  const rel = inst.position.clone().sub(wrist), t = rel.dot(axis), off = rel.clone().sub(axis.clone().multiplyScalar(t)).length();
  check(t > 0.01 * K && t < 0.45 * lf, tag + ": between wrist and elbow (t " + t.toFixed(3) + ")");
  check(off < 0.03 * K, tag + ": on the forearm axis (off " + off.toFixed(3) + ")");
  const zAx = new T.Vector3(0, 0, 1).applyQuaternion(inst.quaternion);
  const dors = new T.Vector3(0, 1, 0).applyQuaternion(armL.userData.parts.fore.quaternion);
  check(zAx.dot(dors) > 0.99, tag + ": dial on the back of the wrist");
  check(Math.abs(new T.Vector3(0, 1, 0).applyQuaternion(inst.quaternion).dot(axis) - 1) < 1e-3, tag + ": 3 o'clock toward the hand");
  const fit = inst.children[0].geometry;
  fit.computeBoundingBox();
  const fb = fit.boundingBox;
  // the strap is on the forearm's skin; sleeved, the forearm drawn IS the
  // sleeve, so the strap wraps the real wrist inside it and nothing of it
  // (strap, raised row, clasp) reaches the cuff's outer band (owner:
  // "watches overlap with shirts" — it used to stand ~2 mm proud of the cuff)
  const fsec = X.sliceSection(armL.userData.parts.fore.geometry, null, 2, t / lf);
  if (!C.sleeved) check(fb.max.x >= fsec.hu * K && fb.max.z >= fsec.hw * K, tag + ": strap clears the forearm");
  else {
    const band = 0.0035 * K;
    const ox = Math.max(fb.max.x, -fb.min.x), oz = Math.max(fb.max.z, -fb.min.z);
    check(ox < fsec.hu * K + band && oz < fsec.hw * K + band, tag + ": strap hidden under the sleeve (" + ((ox - fsec.hu * K) * 1000 / K).toFixed(1) + " / " + ((oz - fsec.hw * K) * 1000 / K).toFixed(1) + " mm vs the cuff's " + (band * 1000 / K).toFixed(1) + ")");
  }
  const head = inst.children[1];
  check(Math.abs(head.scale.x - K) < 1e-6, tag + ": head at the hand's scale (" + head.scale.x.toFixed(2) + ")");
  if (C.sleeved) {
    // nothing over the cuff: head vertices up the arm from the cuff's lip stay under its outer band
    const Pp = armL.userData.parts, fq = Pp.fore.quaternion.clone().invert();
    head.updateMatrix(); inst.updateMatrix();
    const M = inst.matrix.clone().multiply(head.matrix), pos = head.geometry.attributes.position;
    let out = 0, below = 0;
    for (let i = 0; i < pos.count; i++) {
      const v = new T.Vector3().fromBufferAttribute(pos, i).applyMatrix4(M).sub(Pp.fore.position).applyQuaternion(fq);
      if (v.z <= 0.003 * K) { below++; continue; }
      const s = H.math.foreHalf(v.z / lf), o = 0.0049;
      const r = Math.hypot(v.x / ((s.rx + o) * K), v.y / ((s.ry + o) * K));
      out = Math.max(out, r - 1);
    }
    check(out <= 0.02, tag + ": head under the cuff where the cuff is (" + (out * 100).toFixed(1) + "% out)");
    check(below > 0, tag + ": the dial peeks out past the cuff");
  }
  check(!!inst.userData.ww.near, tag + ": hands animate in first person");
  // right arm stays bare
  H.poseArm(armR, new T.Vector3(0.16, -0.10, -0.40), new T.Vector3(0.28, -0.32, -0.10), new T.Vector3(0.22, -0.30, 0.18), q, K, C.sleeved);
  check(!(armR.userData.ww && armR.userData.ww.inst && armR.userData.ww.inst.visible), tag + ": right arm bare");
}

// ---- 3b. first person ON SCREEN -------------------------------------------
// Owner: the FP watch showed as a HUGE dial at the bottom-centre of the
// screen. The head was sized off the measured forearm (and, sleeved, off the
// cuff's OUTER band): 1.1-1.45 x the hand beside it. At the hand's scale, on
// the gun arm's support wrist (fpsmode: hand scale 2.56 in the viewmodel,
// shoulders SHOULDER_BODY, forearm ARM_BODY, exit ARM_EXIT; wrists where
// tools/fp-hands-check measures them at the hip and down the sights), the
// dial must span well under 12% of a 16:10 hip lens (75 deg) whichever way
// the wrist rolls. (Where it lands on screen is measured on fpsmode's REAL
// arm poses, every gun at the hip and down the sights, in
// tools/fp-hands-check.mjs: no big dial facing the lens from the
// bottom-centre band.)
{
  const k = 2.56, tanH = Math.tan(75 * Math.PI / 360), ASPECT = 16 / 10;
  const exit = new T.Vector3(-0.50, -1, 0.30).normalize();
  for (const [nm, w] of [["pistol hip", [0.25, -0.37, -0.60]], ["pistol sights", [-0.11, -0.25, -0.60]], ["rifle hip", [0.22, -0.40, -1.34]]]) {
    for (const sleeved of [false, true]) for (const roll of [0.3, 0.9, 1.4]) {
      const wrist = new T.Vector3(...w), elbow = wrist.clone().addScaledVector(exit, 0.265 * k), shoulder = new T.Vector3(-0.17 * k, -0.24 * k, 0.06 * k);
      const q = H.orientAlong(-1, wrist.clone().sub(elbow), roll, 0, new T.Quaternion());
      H.poseArm(armL, wrist, elbow, shoulder, q, k, sleeved);
      const inst = armL.userData.ww && armL.userData.ww.inst;
      const tag = "FP screen " + nm + " roll " + roll + (sleeved ? " sleeved" : "");
      check(!!inst && inst.visible, tag + ": watch on");
      if (!inst) continue;
      const head = inst.children[1];
      inst.updateMatrix(); head.updateMatrix();
      const M = inst.matrix.clone().multiply(head.matrix), pos = head.geometry.attributes.position, v = new T.Vector3();
      let x0 = Infinity, x1 = -Infinity;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(M);
        const nx = v.x / (-v.z * tanH * ASPECT);
        x0 = Math.min(x0, nx); x1 = Math.max(x1, nx);
      }
      const span = (x1 - x0) / 2;
      check(span < 0.12, tag + ": dial spans " + (span * 100).toFixed(1) + "% of the screen width");
    }
  }
}

// ---- 4. the clock -----------------------------------------------------------
CBZ.dayPhase = () => 0.25;             // 12:00
check(Math.abs(X.gameHours() - 12) < 1e-9, "phase 0.25 reads 12:00");
CBZ.dayPhase = () => (15.5 - 6) / 24;  // 15:30
const ana = X.buildInstance("steel", fitRef, false);
X.setNear(ana, true);
X.tickInstance(ana, { h: 15.5, m: 30, real: 7 });
const n = ana.userData.ww.near, TAU = Math.PI * 2;
check(Math.abs(n.hour.rotation.z + (3.5 / 12) * TAU) < 1e-9, "hour hand at half past three");
check(Math.abs(n.minute.rotation.z + 0.5 * TAU) < 1e-9, "minute hand at the half");
const dig = X.buildInstance("clear", fitRef, false);
X.setNear(dig, true);
X.tickInstance(dig, { h: 22 + 41 / 60, m: 41, real: 4 });   // 10:41 pm, colon on
const lcd = dig.userData.ww.near.lcd, L = lcd.userData.lcd, arr = lcd.geometry.attributes.position.array;
let lit = 0;
for (let q = 0; q < L.quads.length; q++) { const o = q * 12; if (Math.hypot(arr[o] - arr[o + 6], arr[o + 1] - arr[o + 7]) > 1e-7) lit++; }
check(L.shown === "1041:", "LCD shows 10:41 (" + L.shown + ")");
check(lit === 2 + 6 + 4 + 2 + 2, "LCD lights exactly 1-0-4-1 + colon (" + lit + ")");

// ---- 5. roles ---------------------------------------------------------------
const cat = (id, tier, extra) => Object.assign({ id, tier }, extra || {});
const seen = {};
for (let i = 0; i < 60; i++) {
  const rig = CBZ.makeCharacter({ build: i % 2 ? "f" : "m" });
  for (const [label, rec, allowed] of [
    ["inmate", cat("inmate", "institution"), [null, "clear", "resin"]],
    ["cop", cat("police", "law", { cop: true }), ["police", "tactical"]],
    ["warden", cat("warden", "law"), ["goldDress"]],
    ["apex", cat("tuxedo", "apex"), ["gold", "patek", "goldDress"]],
  ]) {
    W.restyle(rig, rec);
    const s = X.recOf(rig).role;
    (seen[label] = seen[label] || new Set()).add(s);
    check(allowed.includes(s), label + " wears " + s);
  }
}
check(seen.inmate.size >= 2, "inmates vary (" + [...seen.inmate].join(",") + ")");
const kid = CBZ.makeCharacter({ build: "m", age: 5 });
check(X.recOf(kid).role === null, "a five-year-old wears no watch");

// ---- 6. bling override ------------------------------------------------------
{
  const rig = CBZ.makeCharacter({ build: "m" });
  CBZ.scene.add(rig.group); rig.group.updateMatrixWorld(true);
  W.wear(rig, "resin");
  const mark = W.attach(rig.low.la, "watchPatek");
  check(!!mark && W.styleOf(rig) === "patek", "a looted Patek replaces the role watch");
  const r = X.recOf(rig); X.sync(r, cam);
  check(r.inst && r.inst.userData.ww.style === "patek", "the Patek is what is mounted");
  W.detach(mark);
  X.sync(r, cam);
  check(W.styleOf(rig) === "resin" && r.inst && r.inst.userData.ww.style === "resin", "detach gives the wrist back");
  const mark2 = W.attach(rig.low.la, "watchIced");
  rig.low.la.remove(mark2);             // the portrait's strip: just removed
  X.sync(r, cam);
  check(W.styleOf(rig) === "resin", "a removed marker releases the override");
}
// display piece
{
  const d = W.display("watch_gold", 0.03, 35 * Math.PI / 180);
  check(!!d && d.userData.ww.near, "shop display builds with hands");
}

console.log((fails ? "FAIL" : "ok") + "  watch-check: " + (checks - fails) + "/" + checks);
process.exit(fails ? 1 : 0);
