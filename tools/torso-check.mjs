#!/usr/bin/env node
/* tools/torso-check.mjs — THE SHAPED TORSO: neck, shoulders, chest, back,
   waist, pelvis and the clothes over them (entities/character.js TORSO block).

   Runs the REAL three r128 + materials.js + fphands.js + character.js in
   plain node (no browser, no captures) over men and women of every physique,
   children and elders, and asserts:

     1. SHOULDER SEAM SWEEP — for every arm pose on a grid (raised overhead,
        out to the side, forward, back, and the cuffed pose: behind the back
        with the elbow bent), the end of the torso's shoulder lies INSIDE the
        upper arm's own volume (its loft + the deltoid dome over the pivot), so
        no gap can open between the deltoid and the body;
     2. NO NECK GAP — across head yaw / pitch / roll the bottom of the neck
        column stays buried in the body, and at rest the body's top ring hugs
        the neck (no collar gap, no ledge);
     3. THE NECK SHOWS — the chin sits clear above the front of the collar;
     4. CLOTHES FOLLOW THE BODY — the jacket shell, the jumpsuit stripes and an
        armour vest shell lie outside the body everywhere and within a
        tolerance of it; the cloth collar band sits round the neck;
     5. SHAPE READS — a woman's bust stands proud of her waist, a heavy body's
        belly is deeper than an average one's, a muscular chest is broader,
        shoulders are wider than the neck, the hips carry the thighs;
     6. PAINT + INSTANCING + LOD — faces map front/side/back/cap in the box's u
        direction, v stays off the row edges, same-shape bodies share one
        geometry object, the far LOD is lighter, parts still report their box.

     node tools/torso-check.mjs        exit 0 = ok */
import { loadRig } from "./lib/rig-vm.mjs";

const ctx = loadRig();
const { THREE: T, CBZ } = ctx;
let fails = 0, checks = 0;
function check(ok, msg) { checks++; if (!ok) { fails++; if (fails < 40 || process.env.ALL) console.log("  FAIL " + msg); } }

const skin = 0xb87955;
const dressed = { skin, torso: 0x315f94, arms: 0x315f94, legs: 0x202c3c, shoes: 0x201a18, hair: 0x2b1b12 };
const BODIES = [];
for (const build of ["m", "f"]) for (const physique of ["average", "slim", "heavy", "muscular"]) BODIES.push({ tag: build + "/" + physique, c: { build, physique } });
for (const age of [3, 7, 11, 15]) BODIES.push({ tag: "child" + age, c: { age, build: age > 10 ? "f" : "m" } });
BODIES.push({ tag: "elder-m", c: { age: 74 } }, { tag: "elder-f", c: { age: 70, build: "f" } });
const build = (c, extra) => CBZ.human.build(Object.assign({}, dressed, c, extra || {}));

// ---- point-in-upper-arm (the loft + its end domes), arm-mesh local ----------
const ARM_TOP_DOME = 0.85;                           // LIMB_SHAPES.armUp.*.top
function inArm(mesh, p) {
  const L = mesh.geometry.userData.limb;
  const y = p.y;
  if (y <= L.y0) {
    const h = CBZ.humanLimbHalfAt(mesh.geometry, y);
    if (!h) return false;
    const e = (p.x / h.hx) ** 2 + ((p.z - h.cz) / h.hz) ** 2;
    return e <= 1;
  }
  const h = CBZ.humanLimbHalfAt(mesh.geometry, L.y0), r0 = L.rows[0];
  const dh = ARM_TOP_DOME * Math.max(r0[1], r0[2]) * L.sx;       // the dome's real height
  const q = (y - L.y0) / dh;
  if (q > 1) return false;
  const k = Math.sqrt(1 - q * q);
  return (p.x / (h.hx * k)) ** 2 + ((p.z - h.cz) / (h.hz * k)) ** 2 <= 1;
}
// the lateral-most points of the chest near the shoulder, body frame
function shoulderTips(rig, side) {
  const S = rig.torsoShape, m = rig.skinSlots.torso[0], pos = m.geometry.attributes.position;
  const out = [];
  let best = null;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) * side, y = pos.getY(i) + m.position.y, z = pos.getZ(i);
    if (y < S.shoulderY - 0.12 * S.vs || y > S.shoulderY + 0.2 * S.vs) continue;
    if (!best || x > best.x) best = { x, y, z };
  }
  // the tip itself and a ring of points just inboard of it (the whole shoulder end)
  if (!best) return out;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) * side, y = pos.getY(i) + m.position.y, z = pos.getZ(i);
    if (x > best.x - 0.012 * S.vs) out.push(new T.Vector3(x * side, y, z));
  }
  return out;
}

// ---- 1. SHOULDER SEAM SWEEP -----------------------------------------------
const POSES = [];
for (const rx of [-3.0, -2.2, -1.5, -0.8, 0, 0.5, 1.0]) for (const rz of [-0.4, 0, 0.8, 1.6, 2.5]) POSES.push([rx, rz, 0]);
POSES.push([0.75, -0.45, -1.3], [0.9, -0.3, -1.6]);  // cuffed: behind the back, elbow bent
let seamPoses = 0, seamMin = Infinity;
for (const B of BODIES) {
  const rig = build(B.c);
  for (const side of [1, -1]) {
    const part = side > 0 ? rig.parts.la : rig.parts.ra;       // la sits at +x (character.js mirror)
    const up = part.userData.main, tips = shoulderTips(rig, side);
    check(tips.length > 0, `${B.tag}: shoulder tip found`);
    for (const [rx, rz, el] of POSES) {
      part.rotation.set(rx, 0, side * rz);
      part.userData.low.rotation.x = el;
      // cuffed: verbposes.js retracts the shoulders (back and in) while the wrists are tied
      const px0 = part.position.x, pz0 = part.position.z;
      if (el) { const rk = rig.profile.armW / 0.30; part.position.x = side * (rig.profile.armX - 0.10 * rk); part.position.z = -0.08 * rk; }
      rig.body.updateMatrixWorld(true);
      const inv = new T.Matrix4().copy(up.matrixWorld).invert(), bodyW = rig.body.matrixWorld;
      let inside = 0;
      for (const t of tips) {
        const w = t.clone().applyMatrix4(bodyW).applyMatrix4(inv);
        if (inArm(up, w)) inside++;
      }
      seamPoses++;
      seamMin = Math.min(seamMin, inside / tips.length);
      check(inside === tips.length, `${B.tag} ${side > 0 ? "L" : "R"} arm (${rx}, ${rz}, ${el}): shoulder end inside the deltoid (${inside}/${tips.length})`);
      part.position.x = px0; part.position.z = pz0;
    }
    part.rotation.set(0, 0, side * rig.armOutZ); part.userData.low.rotation.x = 0;
  }
}

// ---- 2/3. NECK: buried across head poses, hugged at rest, visible ----------
function insideBody(S, p) {                      // body-local, the section without relief
  const R = S.at(p.y);
  if (p.y > S.yTop || p.y < S.yBot) return false;
  const zr = p.z - R.zc, zz = zr >= 0 ? R.zf : R.zb;
  return Math.pow(Math.abs(p.x) / R.a, R.n) + Math.pow(Math.abs(zr) / zz, R.n) <= 1;
}
for (const B of BODIES) {
  const rig = build(B.c), S = rig.torsoShape, head = rig.head, pos = head.geometry.attributes.position;
  const low = [];
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) < -0.465) low.push(new T.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
  check(low.length > 8, `${B.tag}: neck column has a buried bottom (${low.length} verts)`);
  let worst = 0;
  // the head poses animChar actually drives: a full look round, the nod range
  // (-0.46 swim-emerge .. +0.34 duck), a turned head nodding, a tilt
  const HEAD = [[0, -1.1, 0], [0, 1.1, 0], [-0.35, 0, 0], [0.34, 0, 0], [-0.25, 0.7, 0], [0.25, -0.7, 0], [0.2, 0.6, 0.15], [0, 0, 0.22], [0, 0, -0.22]];
  for (const [pitch, yaw, roll] of HEAD) {
    rig.neck.rotation.set(pitch, yaw, roll);
    rig.body.updateMatrixWorld(true);
    const toBody = new T.Matrix4().copy(rig.body.matrixWorld).invert().multiply(head.matrixWorld);
    let out = 0;
    for (const v of low) if (!insideBody(S, v.clone().applyMatrix4(toBody))) out++;
    worst = Math.max(worst, out);
  }
  rig.neck.rotation.set(0, 0, 0);
  check(worst === 0, `${B.tag}: the neck's bottom stays inside the body at every head pose (${worst} out)`);
  // the neck is hugged at the body's top ring: compare the column's section there
  rig.body.updateMatrixWorld(true);
  const toBody = new T.Matrix4().copy(rig.body.matrixWorld).invert().multiply(head.matrixWorld);
  let rMax = 0;
  const yRing = S.yN;
  for (let i = 0; i < pos.count; i++) {
    const w = new T.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(toBody);
    if (Math.abs(w.y - yRing) < 0.05 * S.vs && Math.abs(w.x) > 0.02) rMax = Math.max(rMax, Math.abs(w.x));
  }
  const ringA = S.at(yRing).a;
  check(ringA >= rMax - 0.004 && ringA - rMax < 0.04 * S.vs, `${B.tag}: the body's top ring hugs the neck (ring ${ringA.toFixed(3)} vs neck ${rMax.toFixed(3)})`);
  // the neck SHOWS: chin (pivot) above the front of the collar
  if (!rig.child || rig.ageYears >= 7) check(S.pivotY - (S.yN - S.tf) > 0.06 * S.vs, `${B.tag}: neck shows between chin and collar (${(S.pivotY - (S.yN - S.tf)).toFixed(3)})`);
  // the trapezius slopes: the shoulder end sits below the neck junction
  check(S.yN - (S.shoulderY + 0.3 * S.R) > 0.03 * S.vs, `${B.tag}: trapezius slopes down to the shoulder`);
}

// ---- 4. CLOTHES FOLLOW THE BODY ------------------------------------------
function shellGap(rig, geo, originY) {
  const S = rig.torsoShape, pos = geo.attributes.position;
  let inside = 0, far = 0, n = 0;
  for (let i = 0; i < pos.count; i++) {
    const p = { x: pos.getX(i), y: pos.getY(i) + originY, z: pos.getZ(i) };
    // the body rows (the trapezius rings tip forward; tools read them untipped)
    if (p.y > S.shoulderY + 0.02 || p.y < S.yBot + 0.02) continue;
    n++;
    const R = S.at(p.y), zr = p.z - R.zc;
    const rho = Math.pow(Math.pow(Math.abs(p.x) / R.a, R.n) + Math.pow(Math.abs(zr) / (zr >= 0 ? R.zf : R.zb), R.n), 1 / R.n);
    if (rho < 1.0) inside++;
    const scale = Math.hypot(p.x, zr) * (1 - 1 / rho);           // ~ the radial standoff
    if (scale > 0.14) far++;
  }
  return { inside, far, n };
}
for (const B of BODIES.filter((b) => !b.c.age || b.c.age >= 15)) {
  const rig = build(B.c);
  const chest = rig.skinSlots.torso[0];
  // a jacket shell, exactly as clothes.js asks for it
  const P = rig.profile, wH = P.waistShare > 0 ? P.waistShare * P.torsoH : 0;
  const jy = -wH / 2, jH = P.jacketH;
  const spec = CBZ.humanShellSpec(rig, "jacket", { y0: chest.position.y + jy - jH / 2, off: 0.03, box: { w: P.jacketW, h: jH, d: P.jacketD + 0.02, y: chest.position.y + jy }, origin: chest.position.y + jy });
  const holder = { userData: { torsoPart: spec } };
  const jg = CBZ.humanLimbGeometry(holder, null);
  const g1 = shellGap(rig, jg, chest.position.y + jy);
  check(g1.n > 50 && g1.inside === 0, `${B.tag}: jacket shell never inside the body (${g1.inside}/${g1.n})`);
  check(g1.far < g1.n * 0.12, `${B.tag}: jacket shell within tolerance of the body (${g1.far}/${g1.n} past 0.14)`);
  const pj = jg.parameters;
  check(pj.width === P.jacketW && pj.height === jH, `${B.tag}: jacket shell reports its box`);
  // a vest (armor.js's plate carrier: a stiff section, 5 cm off)
  const vy = 1.40 * (rig.torsoShape.vs), vs2 = CBZ.humanShellSpec(rig, "vest", { y0: rig.torsoShape.base + 0.05, y1: rig.torsoShape.base + 0.84 * rig.torsoShape.sp, off: 0.05, flat: 3.4, box: { w: 1.02, h: 0.86, d: 0.62, y: vy }, origin: vy });
  const vg = CBZ.humanLimbGeometry({ userData: { torsoPart: vs2 } }, null);
  const g2 = shellGap(rig, vg, vy);
  check(g2.n > 20 && g2.inside === 0, `${B.tag}: vest shell never inside the body (${g2.inside}/${g2.n})`);
  // jumpsuit stripes
  const conv = build(B.c, { stripes: 0xc85c00 });
  const st = conv.skinSlots.stripes;
  check(st.length === 3, `${B.tag}: three jumpsuit stripes`);
  for (const s of st) {
    const g = shellGap(conv, s.geometry, s.position.y);
    check(g.inside === 0 && g.far === 0, `${B.tag}: stripe hugs the body (${g.inside} in / ${g.far} far of ${g.n})`);
  }
  // the cloth collar band stands round the neck
  const col = rig.skinSlots.collar[0], cp = col.geometry.attributes.position, S = rig.torsoShape;
  let rmin = Infinity;
  for (let i = 0; i < cp.count; i++) { const f = col.geometry.userData.torso.face[i]; if (f < 4) rmin = Math.min(rmin, Math.hypot(cp.getX(i) / S.nRx, (cp.getZ(i) - S.nZc) / S.nRz)); }
  check(rmin > 1.0 && rmin < 1.4, `${B.tag}: collar band stands just off the neck (${rmin.toFixed(2)} neck radii)`);
  check(!col.userData.torsoPart.bare, `${B.tag}: a clothed body wears a collar band`);
  const bare = build(B.c, { torso: skin, arms: skin, collar: skin });
  check(bare.skinSlots.collar[0].userData.torsoPart.bare, `${B.tag}: a bare chest gets the neck fillet, not a collar`);
}

// ---- 5. SHAPE READS ----------------------------------------------------------
function frontZAt(rig, k) { const S = rig.torsoShape; return rig.torsoFrontZ(0.40 * S.W, S.base + k * S.sp); }
const avgM = build({ build: "m", physique: "average" }), heavyM = build({ build: "m", physique: "heavy" }), muscM = build({ build: "m", physique: "muscular" });
const avgF = build({ build: "f", physique: "average" });
check(frontZAt(avgF, 0.59) - frontZAt(avgF, 0.30) > 0.03, `woman: the bust stands proud of the waist (${(frontZAt(avgF, 0.59) - frontZAt(avgF, 0.30)).toFixed(3)})`);
check(frontZAt(avgF, 0.59) < avgF.torsoShape.D * 1.2, `woman: the bust is modest (${(frontZAt(avgF, 0.59) / avgF.torsoShape.D).toFixed(2)} D)`);
check(heavyM.torsoFrontZ(0, heavyM.torsoShape.base + 0.27 * heavyM.torsoShape.sp) > avgM.torsoFrontZ(0, avgM.torsoShape.base + 0.27 * avgM.torsoShape.sp) + 0.04, "heavy: the belly is deeper than average");
check(frontZAt(muscM, 0.63) > frontZAt(avgM, 0.63) && muscM.torsoShape.W > avgM.torsoShape.W, "muscular: a deeper, broader chest");
check(avgM.torsoBackZ(0.42 * avgM.torsoShape.W, avgM.torsoShape.base + 0.74 * avgM.torsoShape.sp) < avgM.torsoBackZ(0, avgM.torsoShape.base + 0.74 * avgM.torsoShape.sp), "back: shoulder blades stand out past the spine groove");
for (const r of [avgM, avgF, heavyM]) {
  const S = r.torsoShape;
  check(S.at(S.shoulderY).a > 2.5 * S.nRx, `${r.profile.key}: shoulders much wider than the neck`);
  check(S.hipOut >= r.profile.hipX + r.profile.legW / 2, `${r.profile.key}: the hips carry the thighs`);
}
const kid = build({ age: 7 }), elder = build({ age: 74 });
check(kid.physique === "average" && kid.torsoShape.pec === 0 && kid.torsoShape.bust === 0, "a child's torso has no adult relief");
check(elder.torsoShape.elder > 0 && elder.neck.position.z > 0, "an elder's head carries forward");

// ---- 6. PAINT + INSTANCING + LOD ------------------------------------------------
{
  const rig = build({ build: "m", physique: "average" });
  const m = rig.skinSlots.torso[0];
  const seen = { front: 0, side: 0, back: 0, cap: 0 };
  let vOk = true, dirOk = 0, dirN = 0;
  const painter = { key: "probe", fn(face, u, v) { seen[face]++; if (v < 0.005 || v > 0.995) vOk = false; return [u, v]; } };
  const g = CBZ.humanLimbGeometry(m, painter);
  const nrm = g.attributes.normal, uv = g.attributes.uv, F = g.userData.torso.face, pos = g.attributes.position;
  for (let i = 0; i < nrm.count; i++) {
    const f = F[i];
    if (f === 0 && nrm.getZ(i) < -0.3) check(false, "a front-face vertex faces backward");
    if (f === 2 && nrm.getZ(i) > 0.3) check(false, "a back-face vertex faces forward");
    if (f === 0 && Math.abs(pos.getX(i)) > 0.05) { dirN++; if ((uv.getX(i) > 0.5) === (pos.getX(i) > 0)) dirOk++; }
  }
  check(seen.front > 0 && seen.side > 0 && seen.back > 0 && seen.cap > 0, `paint: every face column is asked for (${JSON.stringify(seen)})`);
  check(vOk, "paint: v stays off the garment row's edges");
  check(dirOk === dirN, `paint: front u runs -x -> +x like a BoxGeometry (${dirOk}/${dirN})`);
  CBZ.humanLimbGeometry(m, null);
  const twin = build({ build: "m", physique: "average" });
  for (const k of ["torso", "collar", "pelvis"]) check(rig.skinSlots[k][0].geometry === twin.skinSlots[k][0].geometry, `instancing: two average men share one ${k} geometry`);
  const nearT = rig.skinSlots.torso[0].geometry.index.count / 3;
  rig.setHandLod(2);
  const farT = rig.skinSlots.torso[0].geometry.index.count / 3;
  check(farT < nearT * 0.5, `LOD: the far chest is lighter (${nearT} -> ${farT} tris)`);
  rig.setHandLod(1);
  check(rig.skinSlots.torso[0].geometry.index.count / 3 === nearT, "LOD: back to near");
  const p = rig.skinSlots.torso[0].geometry.parameters;
  check(Math.abs(p.width - rig.profile.torsoW) < 1e-9 && Math.abs(p.depth - rig.profile.torsoD) < 1e-9, "chest reports the box it replaced");
  let tri = 0;
  for (const k of ["torso", "collar", "pelvis"]) for (const mm of rig.skinSlots[k]) tri += mm.geometry.index.count / 3;
  console.log(`torso region tris: near ${tri}`);
}
console.log(`shoulder seam: ${seamPoses} arm poses swept, worst ${(seamMin * 100).toFixed(0)}% of the shoulder end inside the deltoid`);
console.log(`\n${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
