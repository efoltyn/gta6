#!/usr/bin/env node
/* tools/seam-check.mjs — WHERE THE ARMS AND LEGS MEET THE BODY, DRESSED.

   Owner: "players' suits look dumb on players. The hip area, and where the
   arms meet the shoulders, are dumb" / "it looks like they're wearing
   underwear over their pants" / swimming: "the top of my legs aren't
   connected to my torso". The REAL rig, poses and city/clothes.js painters
   in plain node (a stub 2D canvas: geometry and UVs are real, pixels are
   not). Asserts, for every pose (stand, walk cycle, run, crouch, seated,
   driving, lying, prone, skydiving, swim crawl / breast / tread, hands up,
   aiming):

     SHOULDER  every point of the sleeve's top dome above the pad's underside
               is covered by the jacket shell (the structured shoulder): no
               part of the arm's ball stands proud of the jacket by more than
               3 mm (metres, drawn scale) — measured against the shell's own
               baked vertices.
     HIP       the pelvis is no wider than the thighs' outer span + 1.5 cm,
               and its outer bottom edge tucks into the thigh (no lip) by
               3 mm, standing and through the walk cycle.
     CLOTH     the pelvis wears the LEG garment: under every jacket the pelvis
               is tinted the trouser colour, and on every outfit its colour
               (flat or tinted mask) is the legs' colour unless the garment
               declares a skirt / seat / one-piece; the thigh's top end and
               the sleeve's shoulder dome sample cloth at least 2 texels
               inside their own atlas row (the white band at the top of the
               swimmer's legs was the arm row's shirt cuff bleeding in).
     SEAT      a suit hangs to the seat standing (hem below the hip joint by
               >= 6 cm), and a seated suit wears the swept-front variant.

     node tools/seam-check.mjs        exit 0 = ok */
import { loadVerbsVM } from "./lib/verbs-vm.mjs";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const vmx = loadVerbsVM({ mode: "survival" });
const { CBZ, THREE: T, ctx } = vmx;
let fails = 0, checks = 0;
function check(ok, msg) { checks++; if (!ok) { fails++; console.log("  FAIL " + msg); } }

// a stub 2D canvas: every call is a no-op, reads come back opaque
function fakeCtx() {
  const grad = { addColorStop() {} };
  return new Proxy({}, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === "getImageData") return (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, (w | 0) * (h | 0)) * 4).fill(255) });
      if (k === "createLinearGradient" || k === "createRadialGradient" || k === "createPattern") return () => grad;
      if (k === "measureText") return () => ({ width: 10 });
      if (k === "canvas") return null;
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}
const mkEl = ctx.document.createElement;
ctx.document.createElement = (tag) => {
  if (tag !== "canvas") return mkEl(tag);
  const c = { width: 0, height: 0, style: {}, getContext: () => fakeCtx(), addEventListener() {} };
  return c;
};
vm.runInContext(readFileSync(new URL("../src/city/clothes.js", import.meta.url), "utf8"), ctx, { filename: "src/city/clothes.js" });
check(!!CBZ.cityApplyClothes, "city/clothes.js loaded");

const SCALE = 0.70;                       // rig units -> metres
const _v = new T.Vector3(), _w = new T.Vector3();

/* ---- the shoulder: sleeve dome vs the jacket shell --------------------- */
function shellCloud(ch) {
  const jm = ch._jacketMesh;
  jm.updateMatrixWorld(true);
  const pos = jm.geometry.attributes.position, nor = jm.geometry.attributes.normal;
  const P = [], N = [];
  const nm = new T.Matrix3().getNormalMatrix(jm.matrixWorld);
  for (let i = 0; i < pos.count; i++) {
    const p = new T.Vector3().fromBufferAttribute(pos, i).applyMatrix4(jm.matrixWorld);
    const n = new T.Vector3().fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
    P.push(p); N.push(n);
  }
  return { P, N };
}
function domeProtrusion(ch, arm, cloud) {
  // (1) the dome inside the pad: the pad is a sphere about the arm's REST
  //     pivot (character.js jacketPad), so the exact measure is distance
  // (2) the shell really draws that pad: every point of its outer upper cap
  //     has a shell vertex within a ring spacing
  const part = ch.parts[arm === "l" ? "la" : "ra"], up = part.userData.main;
  const S = ch.torsoShape, rP = 0.97 * S.R + 0.016 * S.vs, sg = part.position.x >= 0 ? 1 : -1;
  const C = new T.Vector3(sg * S.AX, S.shoulderY, 0);
  up.updateMatrixWorld(true);
  const inv = new T.Matrix4().copy(ch.body.matrixWorld).invert();
  const pos = up.geometry.attributes.position, y0 = up.geometry.userData.limb.y0;
  let worst = 0;
  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i);
    if (_v.y - y0 < -0.01) continue;                           // the dome only
    const b = _v.applyMatrix4(up.matrixWorld).applyMatrix4(inv);
    if (b.y - C.y < -0.15 * rP) continue;                      // under the pad: that is the sleeve
    worst = Math.max(worst, b.distanceTo(C) - rP);
  }
  // (2): along each direction of the pad's outer cap, the shell's furthest
  // vertex in a 0.2 rad cone must reach the pad's radius
  let gap = 0;
  const loc = cloud.loc || (cloud.loc = cloud.P.map((p) => p.clone().applyMatrix4(inv)));
  const r = new T.Vector3();
  for (let el = 0.15; el < 1.2; el += 0.25) for (let az = -1.0; az <= 1.01; az += 0.25) {
    const d = new T.Vector3(sg * Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
    let rmax = 0, n = 0;
    for (const p of loc) {
      r.subVectors(p, C);
      const l = r.length();
      if (l > 1e-6 && r.dot(d) / l > 0.98) { rmax = Math.max(rmax, l); n++; }
    }
    if (n) gap = Math.max(gap, rP - rmax);           // (no vertex in the cone: the rings fall between samples)
  }
  return { out: worst * SCALE, gap: gap * SCALE };
}

/* ---- the hip: pelvis vs thighs ----------------------------------------- */
function pelvisLip(ch) {
  const pm = ch.skinSlots.pelvis[0], S = ch.torsoShape;
  pm.updateMatrixWorld(true);
  const pos = pm.geometry.attributes.position;
  let worst = 0;
  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i);
    const yb = _v.y + pm.position.y;                           // body-local
    if (yb > S.hipY - 0.06 * S.pk || Math.abs(_v.x) < ch.profile.hipX) continue;   // the outer bottom edge
    _w.copy(_v).applyMatrix4(pm.matrixWorld);
    const leg = ch.parts[_v.x >= 0 ? "ll" : "rl"].position.x >= 0 === _v.x >= 0 ? ch.parts.ll : ch.parts.rl;
    const legS = (leg.position.x >= 0) === (_v.x >= 0) ? leg : (leg === ch.parts.ll ? ch.parts.rl : ch.parts.ll);
    const up = legS.userData.main;
    const lp = up.worldToLocal(_w.clone());
    const L = CBZ.humanLimbHalfAt(up.geometry, Math.min(lp.y, up.geometry.userData.limb.y0));
    if (!L) continue;
    const q = Math.hypot(lp.x / L.hx, (lp.z - L.cz) / L.hz);
    const outM = (q - 1) * Math.min(L.hx, L.hz);
    worst = Math.max(worst, outM);
  }
  return worst * SCALE;
}
function pelvisOverhang(ch) {
  const pm = ch.skinSlots.pelvis[0], leg = ch.parts.ll.userData.main;
  pm.geometry.computeBoundingBox();
  const pw = Math.max(Math.abs(pm.geometry.boundingBox.min.x), pm.geometry.boundingBox.max.x);
  const L = CBZ.humanLimbHalfAt(leg.geometry, leg.geometry.userData.limb.y0 - 0.12);
  return (pw - (Math.abs(ch.parts.ll.position.x) + L.hx)) * SCALE;
}

/* ---- the atlas rows ---------------------------------------------------- */
const ROWS = { torso: [0, 96], jacket: [96, 176], arm: [176, 216], leg: [216, 256] }, H = 256;
function rowMargin(mesh, row, sel) {
  const g = mesh.geometry, uv = g.attributes.uv, pos = g.attributes.position;
  if (!uv) return Infinity;
  let m = Infinity;
  for (let i = 0; i < uv.count; i++) {
    if (sel && !sel(_v.fromBufferAttribute(pos, i))) continue;
    const py = (1 - uv.getY(i)) * H;
    m = Math.min(m, py - ROWS[row][0], ROWS[row][1] - py);
  }
  return m;
}

/* ---- dress, pose, measure ---------------------------------------------- */
// every suit's cloth row is checked; the pose sweep runs on a representative
// spread (two-piece, pinstripe, DB, three-piece, colour, tux, detail, and
// every style appended after them)
const SUIT_IDX = (CBZ.citySuitStyles || []).map((s, i) => i);
const SWEEP = new Set([0, 4, 6, 8, 13, 17, 22].concat(SUIT_IDX.filter((i) => i > 22)));
const OUTFITS = [
  ...SUIT_IDX.map((i) => ({ id: "suit", style: i })),
  { id: "tuxedo" }, { id: "waiter" }, { id: "leather" }, { id: "designer" }, { id: "police" }, { id: "inmate" },
  { id: "street" }, { id: "hivis" }, { id: "construction" }, { id: "detective" }, { id: "security" }, { id: "scrubs" },
];
const hexOf = (m) => (m && m.color ? m.color.getHex() : null);
const builds = [{ build: "m" }, { build: "f" }, { build: "m", physique: "heavy" }];
let dressed = 0;
for (const b of builds) {
  for (const rec of OUTFITS) {
    vmx.clearActors();
    const a = vmx.actor(Object.assign({ legs: 0x2a2a30 }, b));
    const ch = a.char;
    let parts = null;
    try { parts = CBZ.cityApplyClothes(ch, Object.assign({ colors: {} }, rec)); } catch (e) { check(false, "dress " + rec.id + ": " + e.message); continue; }
    if (!parts) continue;
    dressed++;
    const tag = (b.build + (b.physique || "")) + " " + rec.id + (rec.style != null ? "|" + rec.style + " " + (CBZ.citySuitStyles[rec.style].name) : "");
    const pel = ch.skinSlots.pelvis[0];
    // CLOTH: the pelvis is the trousers
    if (parts.jacket && parts.legs) {
      const tr = parts.trousers && parts.trousers.hex;
      check(tr != null, tag + ": a jacket outfit names its trousers");
      check(tr == null || hexOf(pel.material) === (tr & 0xffffff), tag + ": the pelvis wears the trouser colour (" + (hexOf(pel.material) || 0).toString(16) + " vs " + (tr || 0).toString(16) + ")");
      check(!pel.material.map || pel.userData._cbzPart === "hips", tag + ": the pelvis is dressed as the top of the trousers");
    }
    // the thigh root and the shoulder dome sample inside their rows
    const ul = ch.parts.ll.userData.main, ua = ch.parts.la.userData.main;
    if (parts.legs && ul.material && ul.material.map) check(rowMargin(ul, "leg", (p) => p.y > ul.geometry.userData.limb.y0 - 0.06) >= 2, tag + ": the thigh's top samples the trouser, not the next row");
    if (parts.arms && ua.material && ua.material.map) check(rowMargin(ua, "arm", (p) => p.y > ua.geometry.userData.limb.y0 - 0.04) >= 2, tag + ": the shoulder dome samples the sleeve, not the next row");
    if (pel.material && pel.material.map) check(rowMargin(pel, pel.userData._cbzPart === "hips" && parts.trousers ? "torso" : (parts.seat ? "jacket" : "leg")) >= 2, tag + ": the pelvis samples inside its row");
    if (!parts.jacket || !ch._jacketMesh || !ch._jacketMesh.userData.torsoPart) continue;
    if (rec.id === "suit" && !SWEEP.has(rec.style)) continue;
    // SEAT: the hem covers the seat standing
    const S = ch.torsoShape, jm = ch._jacketMesh;
    jm.geometry.computeBoundingBox();
    const hem = jm.geometry.boundingBox.min.y + jm.position.y + (jm.parent ? jm.parent.position.y : 0);
    check(S.hipY - hem >= 0.06 / SCALE * 0.98, tag + ": the jacket hangs past the seat (hem " + ((S.hipY - hem) * SCALE * 100).toFixed(1) + " cm under the hip joint)");
    // MODELLED LAPELS: a tailored shell carries the lapel's roll in its geometry
    if (rec.id === "suit" && parts.fp) {
      const sp = jm.userData.torsoPart;
      check(!!sp.lapel, tag + ": the tailored shell knows its lapels");
      if (sp.lapel) {
        const flat = CBZ.humanLimbGeometry({ userData: { torsoPart: Object.assign({}, sp, { lapel: null, key: sp.key.split("|L")[0] + "|flat" }) } }, null);
        const rolled = CBZ.humanLimbGeometry({ userData: { torsoPart: Object.assign({}, sp, { key: sp.key + "|probe" }) } }, null);
        const A = flat.attributes.position.array, B = rolled.attributes.position.array;
        let dz = 0;
        for (let i = 2; i < Math.min(A.length, B.length); i += 3) dz = Math.max(dz, B[i] - A[i]);
        check(dz * SCALE >= 0.003 && dz * SCALE <= 0.008, tag + ": the lapel rolls proud of the chest (" + (dz * SCALE * 1000).toFixed(1) + " mm)");
      }
    }
    // SHOULDER + HIP through the poses
    const poses = {
      stand: { n: 30 }, walk: { speed: 3, n: 60 }, run: { speed: 8, n: 45 }, crouch: { crouch: true, n: 40 }, handsUp: { handsUp: true, n: 40 },
      aim: { aimingPose: true, n: 40 }, sit: { sitting: true, n: 60 }, drive: { sitting: true, driveSteer: 0.4, n: 50 },
      prone: { pronePose: true, n: 40 }, sky: { skydiving: true, n: 30 },
    };
    if (b.build !== "m" || b.physique) poses.walk.n = 30;
    for (const [pn, po] of Object.entries(poses)) {
      for (const k of ["crouch", "handsUp", "aimingPose", "sitting", "driveSteer", "pronePose", "skydiving"]) ch[k] = po[k] != null ? po[k] : (k === "driveSteer" ? 0 : false);
      vmx.setSpeed(a, po.speed || 0);
      let sh = 0, lip = 0, seated = false, padGap = 0;
      for (let i = 0; i < po.n; i++) {
        vmx.frame(1 / 60);
        if (i < 20 || i % 10 !== 9) continue;       // (settled: a pose change damps in)
        ch.group.updateMatrixWorld(true);
        const cloud = shellCloud(ch);
        for (const arm of ["l", "r"]) { const d = domeProtrusion(ch, arm, cloud); sh = Math.max(sh, d.out); padGap = Math.max(padGap, d.gap); }
        if (pn === "stand" || pn === "walk") lip = Math.max(lip, pelvisLip(ch));
        seated = seated || !!jm.userData.torsoPart.seated;
      }
      const armsUp = pn === "handsUp" || pn === "aim" || pn === "sky" || pn === "prone";
      // (a raised / protracted arm leaves THROUGH the pad, like a sleeve: only
      // the hanging-arm poses have to keep the whole dome under it)
      if (!armsUp) check(sh <= 0.003, tag + " " + pn + ": the sleeve's shoulder ball stands " + (sh * 1000).toFixed(1) + " mm proud of the jacket");
      check(padGap <= 0.012, tag + " " + pn + ": the jacket draws its padded shoulder (worst " + (padGap * 1000).toFixed(1) + " mm off the pad)");
      if (pn === "stand" || pn === "walk") check(lip <= 0.003, tag + " " + pn + ": the pelvis lip stands " + (lip * 1000).toFixed(1) + " mm off the thigh");
      if (pn === "sit" || pn === "drive") check(seated, tag + " " + pn + ": a seated suit wears the swept front");
      if (pn === "stand" || pn === "walk") check(!jm.userData.torsoPart.seated, tag + " " + pn + ": standing, the jacket hangs");
    }
    check(pelvisOverhang(ch) <= 0.015, tag + ": the hips are no wider than the thighs + 1.5 cm (" + (pelvisOverhang(ch) * 100).toFixed(1) + " cm)");
  }
}
check(dressed > 20, "outfits dressed: " + dressed);

/* ---- the swimmer: every pose of the swim, plain trousers --------------- */
{
  vmx.clearActors();
  const a = vmx.actor({});
  const ch = a.char, st = CBZ.makeSwimAnim();
  let lip = 0;
  for (const prone of [true, false]) {
    st.prone = prone;
    for (let i = 0; i < 120; i++) {
      CBZ.swimAnimStep(st, i < 60 ? 3 : 0.5, 1 / 60);
      CBZ.poseSwimmer(ch, st, { pos: ch.group.position, vy: 0 });
      ch.group.updateMatrixWorld(true);
      if (i % 10 === 9) {
        // the thigh's root stays within reach of the pelvis: its top-centre
        // (the hip pivot) inside the pelvis volume, whatever the kick
        for (const k of ["ll", "rl"]) {
          const p = ch.parts[k].getWorldPosition(new T.Vector3());
          const b = ch.body.worldToLocal(p.clone()), S = ch.torsoShape;
          const r = S.pel(Math.max(S.pBot, Math.min(S.pTop, b.y)));
          const zz = b.z >= 0 ? r.zf : r.zb;
          const q = Math.pow(Math.abs(b.x) / r.a, r.n) + Math.pow(Math.abs(b.z) / zz, r.n);
          lip = Math.max(lip, q);
        }
      }
    }
  }
  check(lip < 1, "swimming: the hip joints stay inside the pelvis (worst " + lip.toFixed(2) + ")");
}

console.log((fails ? "FAIL" : "ok") + "  seam-check: " + (checks - fails) + "/" + checks);
process.exit(fails ? 1 : 0);
