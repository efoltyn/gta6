#!/usr/bin/env node
/* tools/watch-check.mjs — THE WRISTWATCH SITS ON THE WRIST.

   Runs the REAL fphands.js + materials.js + character.js + entities/watch.js
   in plain node (no browser, no captures) and asserts:

     1. every style's head, strap, hands and crystal build finite, inside a
        triangle budget, with their material groups in range; the dial faces
        the wearer (+Z) and 12 o'clock is +X;
     2. on a man, a woman and a child, in EVERY hand pose: the watch is on the
        LEFT forearm's elbow group, the head sits on the back of the wrist
        (outboard), the strap encloses the forearm's measured section, and no
        visible part of the hand (anything outside the forearm) reaches the
        strap or the head;
     3. first person: the wrapped fpHands.poseArm puts the player's watch on
        the LEFT arm only, between wrist and elbow, dial on the back of the
        wrist, strap around the forearm (bare and sleeved), over a spread of
        wrist rolls and bends; the right arm stays bare;
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
for (const f of ["src/vendor/three.r128.min.js", "src/world/materials.js", "src/systems/fphands.js", "src/entities/character.js", "src/entities/watch.js"]) {
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
for (const B of bodies) {
  const rig = CBZ.makeCharacter(Object.assign({ legs: 0x223344, torso: 0x445566, arms: 0x445566, skin: 0xc89a78, shoes: 0x222222 }, B.c));
  CBZ.scene.add(rig.group);
  rig.group.updateMatrixWorld(true);
  W.wear(rig, "diver");
  const r = X.recOf(rig);
  X.sync(r, cam);
  const inst = r.inst;
  check(!!inst, B.label + ": watch mounted");
  if (!inst) continue;
  const anchor = rig.low.la;
  check(inst.parent === anchor, B.label + ": on the LEFT elbow group");
  check(rig.parts.la.position.x > 0, B.label + ": the left arm is +X (dorsal roll assumption)");
  const P = r.place;
  const [strap, head] = inst.children;
  const hb = bboxIn(head, anchor), sb = bboxIn(strap, anchor);
  // head outboard: its centre is +X of the forearm centre by ~ the half depth
  const hc = hb.getCenter(new T.Vector3());
  check(hc.x - P.pos.x > P.fit.b * 0.9, B.label + ": head on the back of the wrist (dx " + (hc.x - P.pos.x).toFixed(3) + " vs b " + P.fit.b.toFixed(3) + ")");
  // strap encloses the forearm section at the watch line
  const fore = rig.skinSlots.armsLower[0];
  const sec = X.sliceSection(fore.geometry, toAnchor(fore, anchor), 1, P.pos.y);
  check(sb.max.z >= sec.cu + sec.hu && sb.min.z <= sec.cu - sec.hu && sb.max.x >= sec.cw + sec.hw && sb.min.x <= sec.cw - sec.hw,
    B.label + ": strap encloses the forearm");
  check(P.fit.a >= sec.hu - 1e-6 && P.fit.b >= sec.hw - 1e-6, B.label + ": fit is the measured section");
  const lm = CBZ.charArmLandmarks(rig);
  check(Math.min(hb.min.y, sb.min.y) > lm.handTop, B.label + ": whole watch above the wrist crease");
  check(Math.max(hb.max.y, sb.max.y) < 0.06, B.label + ": watch below the elbow");
  // every hand pose: no visible hand vertex reaches the watch
  const hand = rig.skinSlots.hands.find((h) => h.parent === anchor) || rig.skinSlots.hands[0];
  const watchLow = Math.min(hb.min.y, sb.min.y);
  for (const pose of poses) {
    rig.setHandPose("l", pose);
    const hm = rig.skinSlots.hands.find((h) => { let o = h; while (o && o !== anchor) o = o.parent; return !!o; }) || hand;
    const M = toAnchor(hm, anchor), pos = hm.geometry.attributes.position;
    let worst = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(M);
      const outside = Math.abs(_v.x - sec.cw) > sec.hw || Math.abs(_v.z - sec.cu) > sec.hu;
      if (outside) worst = Math.max(worst, _v.y);
    }
    check(worst < watchLow, B.label + "/" + pose + ": visible hand stays below the watch (" + worst.toFixed(3) + " < " + watchLow.toFixed(3) + ")");
  }
  rig.setHandPose("l", "relaxed");
  // near detail comes and goes
  X.setNear(inst, true);
  check(!!inst.userData.ww.near, B.label + ": near detail on");
  X.setNear(inst, false);
  check(!inst.userData.ww.near, B.label + ": near detail off");
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
  const fsec = C.sleeved ? X.sliceSection(armL.userData.parts.cuff.geometry, null, 2, 0.045) : X.sliceSection(armL.userData.parts.fore.geometry, null, 2, t / lf);
  check(fb.max.x >= fsec.hu * K && fb.max.z >= fsec.hw * K, tag + ": strap clears the forearm");
  check(!!inst.userData.ww.near, tag + ": hands animate in first person");
  // right arm stays bare
  H.poseArm(armR, new T.Vector3(0.16, -0.10, -0.40), new T.Vector3(0.28, -0.32, -0.10), new T.Vector3(0.22, -0.30, 0.18), q, K, C.sleeved);
  check(!(armR.userData.ww && armR.userData.ww.inst && armR.userData.ww.inst.visible), tag + ": right arm bare");
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
