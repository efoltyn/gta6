#!/usr/bin/env node
/* tools/wrist-seam-check.mjs — WHERE THE HAND MEETS THE ARM.

   Owner: "where hands meet with arms and where shoes meet with legs ... it's
   like a little kid drew everything and you're redrawing it." The hand came
   out of a forearm stump far bigger than its wrist (bodies), through an OPEN tube end
   that showed its hollow when the wrist bent (bodies' stub, the first-person
   forearm), under a single-sided sleeve ring that floated off the wrist
   (first-person cuff). Plain node, no browser: the REAL three r128 +
   materials + fphands + character in a vm, measured off the built meshes.

   BODIES (character.js HANDS + LIMB_SHAPES.armLo; fphands body LOD):
   man / woman / child, bare arm and sleeve, both hands, every POSES entry
   (relaxed, fist, the table holds with their slide down the wrist, every gun
   hold trigNN / holdNN); the gun holds also rolled on the forearm by 0 / 45
   / 90 deg (the arm IK owns the forearm's roll, the grip the hand's: real
   holds measure up to ~90 deg) with the forearm twisted to follow
   (CBZ.charWristTwist, what systems/actorweapons.js calls), and bent 20 and
   40 deg (CBZ.gunHold.BEND_MAX) in 8 directions.

   FIRST PERSON (fphands makeArm / poseArm): bare and sleeved, both sides,
   hand scale 1.08 and 1.9, forearm length / hand scale 0.23 .. 0.29 (every
   caller's range), wrist rolls -0.6 .. 0.8, flexion and an 8-direction bend
   sweep, every combination whose total bend is within fpsmode's 40 deg.

   Asserts (lengths in hand metres):
   (a) NO GAP: the wrist stub's top is up inside the forearm in every pose:
       a third of the pivot dome's height past the crease, 1 cm past the
       forearm's end on a hold that slides the hand down its wrist.
   (b) NO STEP: at the crease the forearm is no smaller than the stub (it
       hides) and at most STEP_BARE (1.30) x it across either axis on a bare
       arm: a real wrist is ~6 x 4 cm and the forearm 2 cm up ~6.5 x 4.5, so
       10-20% wider reads as the same limb; the rest is the woman/child
       spread (their hand scales with sqrt(armW), the forearm with armW). A
       SLEEVE hangs looser: STEP_CLOTH (1.65), a hem ~1.3 cm proud of a 4 cm
       thick wrist. The old bare stump was 1.5-1.7 x this wrist.
   (c) NOTHING POKES. At rest (no bend): stub vertices and face midpoints
       above the crease inside the forearm loft (CBZ.humanLimbHalfAt in the
       forearm's own frame / fphands foreHalf) within 2 mm body, 1.5 mm FP
       (a 12-around loft's flats sit 3.4% inside its ellipse); the forearm's
       end dome inside the hand (palm superellipsoid union stub, analytic)
       within 2.5 mm (bare; a sleeve's hem is cloth round the wrist and is
       reported). BENT: a rigid wrist cannot hide everything, so what may
       show is what a real one shows — a skin fold on the inside of the bend
       (stub out at most 6 mm body / 3 mm FP, only within 8 mm of the
       crease), and on the outside the forearm's own rounded end (reported,
       not held: it is a closed skin dome now, never a hole).
   (d) CLOSED: the FP forearm's only open edges are at the elbow (the wrist
       end is a dome); the FP sleeve cuff is a closed 2-manifold (every edge
       on exactly two triangles) with outward winding, flush on the forearm
       (outer band <= 5 mm proud, and the forearm never comes through it);
       every stub profile starts and ends on an apex (closed lathe).

     node tools/wrist-seam-check.mjs [--verbose]     exit 0 = ok */
import { readFileSync, existsSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
const verbose = process.argv.includes("--verbose");
const ctx = vm.createContext({ console, Math, performance });
ctx.window = ctx; ctx.self = ctx;
ctx.CBZ = { CONFIG: {}, onAlways() {}, onUpdate() {}, on() {} };
const FILES = ["src/vendor/three.r128.min.js", "src/world/materials.js", "src/systems/fphands.js", "src/entities/footwear.js", "src/entities/character.js"];
for (const f of FILES) if (existsSync(new URL(f, ROOT))) vm.runInContext(read(f), ctx, { filename: f });
const { THREE: T, CBZ } = ctx;
const H = CBZ.fpHands;
let fails = 0, checks = 0;
const failList = [];
function check(ok, msg) { checks++; if (!ok) { fails++; failList.push(msg); } }

const STEP_BARE = 1.30, STEP_CLOTH = 1.65;
const POKE_TOL_BODY = 0.0020, POKE_TOL_FP = 0.0015, DOME_TOL = 0.0025;
const FOLD_OUT = 0.006, FOLD_H = 0.008, FOLD_OUT_FP = 0.003;
const LOFT_FLAT = Math.cos(Math.PI / 12);        // a 12-around loft's flats sit this far inside its ellipse
const BEND_MAX = 0.70;                           // CBZ.gunHold.BEND_MAX (systems/actorweapons.js)
const W = H.WRIST, PALM = H.PALM;
check(!!W && !!H.math.stubRings && !!H.math.foreHalf, "fphands exports WRIST / stubRings / foreHalf");

// ------------------------------------------------------------ the hand, analytic (hand frame, metres)
// the stub: its lathe rings, an ellipse per ring, linear between rings
function stubOf(pose, fine) {
  const p = H.POSES[pose] || {};
  return H.math.stubRings(fine ? 0 : (p.stub != null ? p.stub : 0.070), fine);
}
function stubHalf(rings, z) {
  if (z < rings[0][0] || z > rings[rings.length - 1][0]) return null;
  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i], b = rings[i + 1];
    if (z >= a[0] && z <= b[0]) {
      const t = b[0] > a[0] ? (z - a[0]) / (b[0] - a[0]) : 0;
      return { rx: a[1] + (b[1] - a[1]) * t, ry: a[2] + (b[2] - a[2]) * t, cy: a[3] };
    }
  }
  return null;
}
// the stub's surface as the mesh draws it: every ring vertex and every face midpoint
function stubPoints(rings, [sides, phase]) {
  const out = [];
  const ring = (r, k) => r[1] > 0 ? [r[1] * Math.cos(phase + k / sides * 2 * Math.PI), r[3] + r[2] * Math.sin(phase + k / sides * 2 * Math.PI), r[0]] : [0, r[3], r[0]];
  for (let i = 0; i < rings.length; i++) for (let k = 0; k < sides; k++) {
    const p = ring(rings[i], k);
    out.push(p);
    if (i + 1 < rings.length) {
      const q = ring(rings[i + 1], k), q1 = ring(rings[i + 1], k + 1), p1 = ring(rings[i], k + 1);
      out.push([(p[0] + q1[0] + p1[0] + q[0]) / 4, (p[1] + q1[1] + p1[1] + q[1]) / 4, (p[2] + q1[2] + p1[2] + q[2]) / 4]);
    }
  }
  return out;
}
// inside the hand = inside the palm superellipsoid (E 0.30, heel narrowed to
// 0.8 of its width) or inside the stub's lathe polygon (a regular n-gon in
// the ring's own ellipse-normalised plane), grown by tol
function insideHand(x, y, z, rings, [sides, phase], tol) {
  const hz = PALM.len / 2, zc = z + hz;
  if (Math.abs(zc) <= hz + tol) {
    const zn = (zc + hz) / PALM.len, hx = PALM.hw * (0.80 + 0.20 * (1 - zn)) + tol, hy = PALM.th / 2 + 0.003 + tol;
    const e = 2 / 0.30;
    if (Math.pow(Math.abs(x) / hx, e) + Math.pow(Math.abs(y) / hy, e) + Math.pow(Math.abs(zc) / (hz + tol), e) <= 1) return true;
  }
  const s = stubHalf(rings, Math.min(rings[rings.length - 1][0], Math.max(rings[0][0], z)));
  if (!s || z < rings[0][0] - tol || z > rings[rings.length - 1][0] + tol) return false;
  const rx = s.rx + tol, ry = s.ry + tol;
  if (!(s.rx > 0)) return false;
  const u = x / rx, v = (y - s.cy) / ry, r = Math.hypot(u, v), th = Math.atan2(v, u), step = 2 * Math.PI / sides;
  const c = phase + step * (Math.floor((th - phase) / step) + 0.5);
  return r * Math.cos(th - c) <= Math.cos(Math.PI / sides);
}

// ------------------------------------------------------------ bodies
const base = { skin: 0xb87955, torso: 0x315f94, collar: 0x315f94, arms: 0x315f94, legs: 0x202c3c, shoes: 0x201a18, hair: 0x2b1b12 };
const BODIES = [["man", {}], ["woman", { build: "f" }], ["child", { age: 7 }]];
const POSES = Object.keys(H.POSES);
const GUN = (p) => /^(trig|hold)\d+$/.test(p);
const DIRS = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => i * Math.PI / 4);
const _v = new T.Vector3(), _q = new T.Quaternion(), _q2 = new T.Quaternion(), _ax = new T.Vector3(), _mi = new T.Matrix4();
const Y = new T.Vector3(0, 1, 0);
const worst = { gap: Infinity, stepLo: Infinity, stepHiBare: 0, stepHiCloth: 0, poke: 0, pokeRolled: 0, pokeRolledH: 0, dome: 0, domeCloth: 0 };
let bodyCases = 0;
const STATS = {};

for (const [label, c] of BODIES) for (const sleeve of [false, true]) {
  const rig = CBZ.makeCharacter(Object.assign({}, base, c, sleeve ? {} : { arms: base.skin }));
  rig.group.updateMatrixWorld(true);
  const tagB = `${label}/${sleeve ? "sleeve" : "bare"}`;
  for (const k of ["la", "ra"]) {
    const hand = rig.parts[k].userData.cap, fore = rig.parts[k].userData.lower;
    const L = fore.geometry.userData.limb, variant = fore.userData.limb.variant;
    check(variant === (sleeve ? "cloth" : "bare"), `${tagB} ${k}: forearm variant ${variant}`);
    const s = hand.scale.x, creaseY = fore.position.y + L.y0 - L.sy;        // elbow frame
    // (b) the step, at the crease: across (rig x) = the hand's thickness, front-back (rig z) = its width
    const cr = CBZ.humanLimbHalfAt(fore.geometry, L.y0 - L.sy);
    const sx = cr.hx / (W.ht * s), sz = cr.hz / (W.hw * s);
    const hi = sleeve ? STEP_CLOTH : STEP_BARE;
    check(sx >= 1 && sz >= 1, `${tagB} ${k}: crease no smaller than the stub (${sx.toFixed(2)} x ${sz.toFixed(2)})`);
    check(sx <= hi && sz <= hi, `${tagB} ${k}: crease within ${hi} x the stub (${sx.toFixed(2)} x ${sz.toFixed(2)})`);
    worst.stepLo = Math.min(worst.stepLo, sx, sz);
    if (sleeve) worst.stepHiCloth = Math.max(worst.stepHiCloth, sx, sz); else worst.stepHiBare = Math.max(worst.stepHiBare, sx, sz);
    if (verbose) console.log(`${tagB} ${k}: crease ${(cr.hx / s * 1000).toFixed(1)} x ${(cr.hz / s * 1000).toFixed(1)} mm (hand m) vs stub ${(W.ht * 1000).toFixed(1)} x ${(W.hw * 1000).toFixed(1)}: ${sx.toFixed(2)} x ${sz.toFixed(2)}`);
    // the forearm's end dome (mesh-local; posed per case: the forearm twists with a gun hand)
    const fp = fore.geometry.attributes.position, domeL = [];
    for (let i = 0; i < fp.count; i++) {
      _v.fromBufferAttribute(fp, i);
      if (_v.y < L.y0 - L.sy - 1e-6) domeL.push(_v.clone());
    }
    check(domeL.length > 0, `${tagB} ${k}: the forearm closes under the crease`);
    const foreInv = new T.Matrix4(), _l = new T.Vector3();
    for (const pose of POSES) {
      rig.setHandPose(k === "la" ? "l" : "r", pose);
      const rings = stubOf(pose, false), pts = stubPoints(rings, H.STUB_LATHE.body);
      const q0 = hand.quaternion.clone();
      const variants = [{ bend: 0, dir: 0, roll: 0 }];
      if (GUN(pose)) for (const roll of [0, Math.PI / 4, Math.PI / 2]) for (const bend of [0, 0.35, BEND_MAX]) for (const dir of (bend ? DIRS : [0])) variants.push({ bend, dir, roll });
      for (const V of variants) {
        bodyCases++;
        // roll about the forearm (+Y), then bend about an axis square to it
        _q.setFromAxisAngle(Y, V.roll);
        _ax.set(Math.cos(V.dir), 0, Math.sin(V.dir));
        _q2.setFromAxisAngle(_ax, V.bend);
        hand.quaternion.copy(q0).premultiply(_q).premultiply(_q2);
        hand.updateMatrix();
        // a gun hold twists the forearm to the hand (systems/actorweapons.js -> character.js wristTwist)
        if (GUN(pose) && CBZ.charWristTwist) CBZ.charWristTwist(rig, k === "la" ? "l" : "r");
        fore.updateMatrix(); foreInv.copy(fore.matrix).invert();
        const tag = `${tagB} ${k} ${pose}` + (V.bend || V.roll ? ` roll ${(V.roll * 57.3).toFixed(0)} bend ${(V.bend * 57.3).toFixed(0)}@${(V.dir * 57.3).toFixed(0)}` : "");
        const tier = V.bend > 0 ? "bent" : "rest";
        // (a) the stub's top is up inside the forearm; (c) the stub stays in it
        let top = -Infinity, poke = 0, pokeH = 0;
        for (const p of pts) {
          _v.set(p[0], p[1], p[2]).applyMatrix4(hand.matrix);
          top = Math.max(top, _v.y - creaseY);
          if (_v.y <= creaseY) continue;
          _l.copy(_v).applyMatrix4(foreInv);                  // into the forearm's own frame
          const sec = CBZ.humanLimbHalfAt(fore.geometry, _l.y);
          const r = Math.hypot(_l.x / (sec.hx * LOFT_FLAT), (_l.z - sec.cz) / (sec.hz * LOFT_FLAT));
          if (r > 1) {
            const out = (r - 1) * Math.min(sec.hx, sec.hz) * LOFT_FLAT / s;     // hand metres
            poke = Math.max(poke, out);
            if (out > POKE_TOL_BODY) pokeH = Math.max(pokeH, (_v.y - creaseY) / s);
          }
        }
        const slid = Math.max(0, hand.userData.fit.wristY - hand.position.y) / s;
        const need = slid > 0 ? 0.010 : W.dome / 3;
        check(top / s >= need, `${tag}: stub reaches into the forearm (top ${(top / s * 1000).toFixed(1)} mm above the crease, slid ${(slid * 1000).toFixed(0)} mm)`);
        worst.gap = Math.min(worst.gap, top / s);
        if (tier === "rest") check(poke <= POKE_TOL_BODY, `${tag}: stub inside the forearm above the crease (out ${(poke * 1000).toFixed(1)} mm)`);
        else if (tier === "bent") check(poke <= FOLD_OUT && pokeH <= FOLD_H, `${tag}: a bent wrist only folds at the crease (out ${(poke * 1000).toFixed(1)} mm, up to ${(pokeH * 1000).toFixed(1)} mm above it)`);
        // (c) the forearm's end dome inside the hand
        _mi.copy(hand.matrix).invert();
        let dOut = 0;
        for (const d of domeL) {
          _v.copy(d).applyMatrix4(fore.matrix).applyMatrix4(_mi);
          if (insideHand(_v.x, _v.y, _v.z, rings, H.STUB_LATHE.body, 0)) continue;
          let t = 0.00025;                                 // how far out, in 0.25 mm steps
          while (t < 0.02 && !insideHand(_v.x, _v.y, _v.z, rings, H.STUB_LATHE.body, t)) t += 0.00025;
          dOut = Math.max(dOut, t);
        }
        if (tier === "rest" && !sleeve) check(dOut <= DOME_TOL, `${tag}: forearm's end dome inside the hand (out ${(dOut * 1000).toFixed(1)} mm)`);
        const key = `${sleeve ? "sleeve" : "bare  "} ${tier.padEnd(6)} roll ${(V.roll * 57.3).toFixed(0).padStart(2)} bend ${(V.bend * 57.3).toFixed(0).padStart(2)}`;
        const st = STATS[key] = STATS[key] || { n: 0, poke: 0, pokeH: 0, dome: 0 };
        st.n++; st.poke = Math.max(st.poke, poke); st.pokeH = Math.max(st.pokeH, pokeH); st.dome = Math.max(st.dome, dOut);
      }
      hand.quaternion.copy(q0); hand.updateMatrix(); fore.rotation.y = 0;
    }
    rig.setHandPose(k === "la" ? "l" : "r", "relaxed");
  }
}
// closed stub profiles
for (const pose of POSES) for (const fine of [false, true]) {
  const r = stubOf(pose, fine);
  check(!(r[0][1] > 0) && !(r[r.length - 1][1] > 0), `stub ${pose}${fine ? " (FP)" : ""} starts and ends on an apex`);
}

// ------------------------------------------------------------ first person
const mats = { fore: new T.MeshLambertMaterial(), upper: new T.MeshLambertMaterial() };
function edgeUse(g) {
  const idx = g.index.array, P = g.attributes.position, key = (a, b) => (a < b ? a + "," + b : b + "," + a);
  // weld coincident vertices first (a lathe's apex, a ring's seam)
  const weld = new Map(), id = [];
  for (let i = 0; i < P.count; i++) {
    const k = [P.getX(i), P.getY(i), P.getZ(i)].map((v) => Math.round(v * 1e6)).join(",");
    if (!weld.has(k)) weld.set(k, weld.size);
    id.push(weld.get(k));
  }
  const m = new Map();
  for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = id[idx[t + e]], b = id[idx[t + (e + 1) % 3]];
    if (a === b) continue;
    const k2 = key(a, b);
    m.set(k2, (m.get(k2) || 0) + 1);
  }
  return { m, id };
}
function signedVolume(g) {
  const idx = g.index.array, P = g.attributes.position, a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3();
  let v = 0;
  for (let t = 0; t < idx.length; t += 3) {
    a.fromBufferAttribute(P, idx[t]); b.fromBufferAttribute(P, idx[t + 1]); c.fromBufferAttribute(P, idx[t + 2]);
    v += a.dot(b.clone().cross(c)) / 6;
  }
  return v;
}
{
  const arm = H.makeArm(mats), P = arm.userData.parts;
  // (d) the forearm: open only at the elbow
  const fg = P.fore.geometry, { m, id } = edgeUse(fg), pos = fg.attributes.position;
  const zOf = new Map();
  for (let i = 0; i < pos.count; i++) zOf.set(id[i], pos.getZ(i));
  let openLow = 0, openHigh = 0, over = 0;
  for (const [k, n] of m) {
    const [a, b] = k.split(",").map(Number);
    if (n === 1) { if (Math.min(zOf.get(a), zOf.get(b)) < 0.999) openLow++; else openHigh++; }
    if (n > 2) over++;
  }
  check(openLow === 0 && over === 0, `FP forearm closed at the wrist (${openLow} open edges below the elbow rim, ${over} over-shared)`);
  check(openHigh > 0, "FP forearm open only at the elbow rim (the elbow ball covers it)");
  let zMin = Infinity; for (let i = 0; i < pos.count; i++) zMin = Math.min(zMin, pos.getZ(i));
  check(zMin < 0 && -zMin * H.FORE_NOM < 0.02, `FP forearm's wrist dome is shallow (${(-zMin * H.FORE_NOM * 1000).toFixed(1)} mm at nominal)`);
  // (d) the cuff: closed 2-manifold, outward, flush
  const cg = P.cuff.geometry, cu = edgeUse(cg);
  let bad = 0; for (const n of cu.m.values()) if (n !== 2) bad++;
  check(bad === 0, `FP cuff is closed (every edge on two triangles; ${bad} not)`);
  check(signedVolume(cg) > 0, "FP cuff wound outward (positive volume)");
  check(signedVolume(fg) !== 0, "FP forearm has volume");
  const prof = H.CUFF_PROFILE;
  const outMax = Math.max(...prof.map((p) => p[1])), outMin = Math.min(...prof.map((p) => p[1]));
  check(outMax <= 0.005 && outMax > 0.002, `FP cuff band sits flush (outer ${(outMax * 1000).toFixed(1)} mm proud)`);
  check(outMin < 0, "FP cuff's inner wall is under the forearm's skin");
  // (b) FP step: the forearm's wrist section vs the stub's
  const w0 = H.math.foreHalf(0), fx = w0.rx / W.hw, fy = w0.ry / (W.ht + Math.abs(W.cy));
  check(fx >= 1 && fy >= 1 && fx <= STEP_BARE && fy <= STEP_BARE, `FP wrist section ${(w0.rx * 1000).toFixed(1)} x ${(w0.ry * 1000).toFixed(1)} mm vs stub ${(W.hw * 1000).toFixed(1)} x ${(W.ht * 1000).toFixed(1)} (${fx.toFixed(2)} / ${fy.toFixed(2)})`);
  worst.fpStep = Math.max(fx, fy);
}
const fpW = { gap: Infinity, cuffIn: 0 };
let fpCases = 0;
{
  const rings = stubOf("relaxed", true), pts = stubPoints(rings, H.STUB_LATHE.fp);
  const arm = H.makeArm(mats), P = arm.userData.parts;
  const hq = new T.Quaternion(), dq = new T.Quaternion(), wr = new T.Vector3(), el = new T.Vector3(), sh = new T.Vector3();
  const fM = new T.Matrix4(), hM = new T.Matrix4(), hMi = new T.Matrix4(), cM = new T.Matrix4(), fMi = new T.Matrix4();
  const fpos = P.fore.geometry.attributes.position, cpos = P.cuff.geometry.attributes.position;
  const dome = [];
  for (let i = 0; i < fpos.count; i++) if (fpos.getZ(i) < -1e-6) dome.push(new T.Vector3().fromBufferAttribute(fpos, i));
  for (const side of [1, -1]) for (const k of [1.08, 1.9]) for (const ratio of [0.23, 0.25, 0.29]) for (const sleeved of [false, true])
    for (const roll of [-0.6, 0, 0.8]) for (const flex of [-0.7, -0.35, 0, 0.35, 0.7]) for (const bend of [0, 0.35, BEND_MAX]) for (const dir of (bend ? DIRS : [0])) {
      wr.set(side * 0.16, -0.10, -0.40);
      const along = new T.Vector3(side * 0.12, 0.22, -0.30).normalize().negate();      // elbow -> wrist
      el.copy(wr).addScaledVector(along, -ratio * k);
      sh.set(side * 0.22, -0.30, 0.18);
      H.orientAlong(side, along, roll, flex, hq);
      // then a bend of the hand about an axis square to the forearm
      const ax = new T.Vector3(Math.cos(dir), Math.sin(dir), 0).applyQuaternion(hq);
      ax.addScaledVector(along, -ax.dot(along)).normalize();
      dq.setFromAxisAngle(ax, bend);
      hq.premultiply(dq);
      // the total bend: hand +Z (the straight-wrist line) off the forearm
      const bendAll = Math.acos(Math.min(1, new T.Vector3(0, 0, 1).applyQuaternion(hq).dot(along.clone().negate())));
      if (bendAll > BEND_MAX + 0.02) continue;          // past what fpsmode's WRIST_DEV lets a wrist bend
      fpCases++;
      H.poseArm(arm, wr, el, sh, hq, k, sleeved);
      const lf = P.fore.scale.z;
      fM.compose(P.fore.position, P.fore.quaternion, new T.Vector3(1, 1, 1)); fMi.copy(fM).invert();
      hM.compose(wr, hq, new T.Vector3(k, k, k)); hMi.copy(hM).invert();
      const tier = bendAll < 0.02 ? "rest" : "bent";
      const tag = `FP side ${side} k ${k} lf/k ${ratio} ${sleeved ? "sleeved" : "bare"} roll ${roll} flex ${flex} bend ${bend}@${(dir * 57.3).toFixed(0)}`;
      // (a) + (c): the stub in the forearm frame (metres at hand scale: / k)
      let top = -Infinity, poke = 0;
      for (const p of pts) {
        _v.set(p[0], p[1], p[2]).applyMatrix4(hM).applyMatrix4(fMi).multiplyScalar(1 / k);
        top = Math.max(top, _v.z);
        if (_v.z <= 0) continue;
        const s = H.math.foreHalf(_v.z * k / lf);
        const r = Math.hypot(_v.x / (s.rx * LOFT_FLAT), _v.y / (s.ry * LOFT_FLAT));
        if (r > 1) poke = Math.max(poke, (r - 1) * Math.min(s.rx, s.ry) * LOFT_FLAT);
      }
      check(top > W.dome / 3, `${tag}: stub reaches into the forearm (${(top * 1000).toFixed(1)} mm)`);
      const tol = tier === "rest" ? POKE_TOL_FP : FOLD_OUT_FP;
      check(poke <= tol, `${tag}: stub inside the forearm (out ${(poke * 1000).toFixed(1)} mm, ${tier})`);
      fpW.gap = Math.min(fpW.gap, top);
      // (c): the forearm's end dome inside the hand
      let dOut = 0;
      P.fore.updateMatrix();
      for (const d of dome) {
        _v.copy(d).applyMatrix4(P.fore.matrix).applyMatrix4(hMi);
        if (side < 0) _v.x = -_v.x;
        if (insideHand(_v.x, _v.y, _v.z, rings, H.STUB_LATHE.fp, 0)) continue;
        let t = 0.00025;
        while (t < 0.02 && !insideHand(_v.x, _v.y, _v.z, rings, H.STUB_LATHE.fp, t)) t += 0.00025;
        dOut = Math.max(dOut, t);
      }
      if (tier === "rest") check(dOut <= DOME_TOL, `${tag}: forearm's end dome inside the hand (out ${(dOut * 1000).toFixed(1)} mm)`);
      const key = `FP     ${tier.padEnd(6)} bend ${String(Math.round(bendAll * 57.3 / 10) * 10).padStart(2)}`;
      const st = STATS[key] = STATS[key] || { n: 0, poke: 0, pokeH: 0, dome: 0 };
      st.n++; st.poke = Math.max(st.poke, poke); st.dome = Math.max(st.dome, dOut);
      // (d): the forearm never comes through the cuff's outer band
      if (sleeved) {
        P.cuff.updateMatrix(); cM.copy(P.cuff.matrix);
        let inside = 0;
        const prof = H.CUFF_PROFILE, sides = 12;
        for (let j = 0; j < prof.length; j++) {
          if (prof[j][1] <= 0) continue;
          for (let i = 0; i < sides; i++) {
            _v.fromBufferAttribute(cpos, j * sides + i).applyMatrix4(cM).applyMatrix4(fMi).multiplyScalar(1 / k);
            const s = H.math.foreHalf(_v.z * k / lf);
            const r = Math.hypot(_v.x / s.rx, _v.y / s.ry);
            if (r < 1) inside = Math.max(inside, (1 - r) * Math.min(s.rx, s.ry));
          }
        }
        check(inside < 1e-5, `${tag}: forearm stays under the cuff (${(inside * 1000).toFixed(2)} mm through)`);
        fpW.cuffIn = Math.max(fpW.cuffIn, inside);
      }
    }
}

// ------------------------------------------------------------ report
const mm = (v) => (v * 1000).toFixed(1);
console.log(`bodies: ${bodyCases} hand placements (man/woman/child x bare/sleeve x ${POSES.length} poses; gun holds x 3 rolls x 17 bends)`);
console.log(`  crease vs stub: ${worst.stepLo.toFixed(2)}..${worst.stepHiBare.toFixed(2)} bare (<= ${STEP_BARE}), <= ${worst.stepHiCloth.toFixed(2)} sleeved (<= ${STEP_CLOTH}); stub reaches >= ${mm(worst.gap)} mm past the forearm's end`);
console.log(`first person: ${fpCases} arm poses; wrist ${worst.fpStep.toFixed(2)} x the stub; stub reaches >= ${mm(fpW.gap)} mm; forearm through the cuff ${mm(fpW.cuffIn)} mm`);
console.log("worst per tier (hand mm; rest held to " + mm(POKE_TOL_BODY) + " / " + mm(DOME_TOL) + ", bent to a fold <= " + mm(FOLD_OUT) + " within " + mm(FOLD_H) + " of the crease, FP bent <= " + mm(FOLD_OUT_FP) + "):");
for (const [k, v] of Object.entries(STATS).sort()) console.log(`  ${k}  n ${String(v.n).padStart(5)}  stub out ${mm(v.poke).padStart(4)} (up to ${mm(v.pokeH).padStart(4)} above)  dome out ${mm(v.dome).padStart(4)}`);
if (fails) console.log("\nFAIL\n  - " + failList.slice(0, 40).join("\n  - ") + (failList.length > 40 ? `\n  ... ${failList.length - 40} more` : ""));
console.log(`\nwrist-seam-check: ${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
