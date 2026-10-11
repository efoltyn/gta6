/* ============================================================
   units/kit/quadrig.js — CBZ.quadRig: A QUADRUPED SKELETON FROM DIMS.

   Generalized out of city/dogmodel.js's 24-bone dog. One bone table for any
   four-legged animal: root, pelvis, chest, a neck chain, head, jaw, two ears,
   a tail chain, optional hackle / hump ridges, and three bones per leg
   (front: humerus / forearm / pastern+paw; hind: thigh / shin / hock+paw).
   With the default spec the indices are EXACTLY the dog's.

   API
     CBZ.quadRig.bones(spec?) -> table { BN, LEGB, PARENT, NB, spec, bindPoints(D) }
         spec: { neck: 1, tail: 3, tailStops: [0, .33, .66], ears: true,
                 hackle: true, hump: false }
         BN names: root pelvis chest neck (neck0..) head jaw earL earR
                   tail0.. hackle hump;  LEGB = [[upper, lower, foot] x FL FR HL HR]
         bindPoints(D) -> [[x, y, z] per bone] in model space (nose +X, up +Y,
         ground 0) from the dims the animal file computes:
           D.hipX hipH shX sh, neckB{x,y} headP{x,y} jawP{x,y} earP{x,y,z},
           tailP{x,y} tailL, hackleP{x,y} (hackle), humpP{x,y} (hump),
           FJ{x,y} HJ{x,y} shoulder / hip joints, fa fb (front upper/lower),
           ha hb (hind), legZf legZh (half track widths)
     CBZ.quadRig.makeSkeleton(table, D, name?) -> { bones, skeleton, bindPos }
     CBZ.quadRig.skinnedMesh(geo, mat, rig) -> THREE.SkinnedMesh bound to rig.bones
     CBZ.quadRig.ik2(jx, jy, tx, ty, a, b, bend, out) -> out[0], out[1]
         2-bone IK in the sagittal plane; bend -1 = joint behind (elbow),
         +1 = in front (stifle); writes the two absolute bone angles
     CBZ.quadRig.poseLegs(rig, G, D, body?, opts?)
         bends every leg onto the gait's feet (CBZ.quadGait G.feet) through
         ik2 — the dog's standing-leg solve. body = { pX, pY, pR, cX, cY, cR }
         (pelvis / chest positions + pitch; default = bind), opts.foot(Lg, f)
         may rewrite { x, y, a } (foot point + pastern angle) for postures.

   HOW AN ANIMAL FILE USES IT: const T = CBZ.quadRig.bones({ neck: 2, tail: 5 });
   loft the shell with T.BN / T.LEGB bone ids (CBZ.loftKit), then per animal
   const rig = CBZ.quadRig.makeSkeleton(T, D); CBZ.quadRig.skinnedMesh(geo, mat, rig);
   per frame step CBZ.quadGait and call poseLegs(rig, G, D, body).
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W.CBZ || (W.CBZ = {});
  const PI = Math.PI, HALF = PI / 2;
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function bones(spec) {
    spec = Object.assign({ neck: 1, tail: 3, tailStops: null, ears: true, hackle: true, hump: false }, spec || {});
    const BN = {}, PARENT = [];
    let n = 0;
    const add = function (name, parent) { BN[name] = n; PARENT.push(parent == null ? -1 : BN[parent]); return n++; };
    add("root", null); add("pelvis", "root"); add("chest", "root");
    let prev = "chest";
    for (let i = 0; i < spec.neck; i++) { const nm = i === 0 ? "neck" : "neck" + i; add(nm, prev); prev = nm; }
    if (spec.neck > 1) BN.neck0 = BN.neck;
    add("head", prev); add("jaw", "head");
    if (spec.ears) { add("earL", "head"); add("earR", "head"); }
    prev = "pelvis";
    for (let i = 0; i < spec.tail; i++) { add("tail" + i, prev); prev = "tail" + i; }
    if (spec.hackle) add("hackle", "chest");
    if (spec.hump) add("hump", "chest");
    const LEGB = [];
    for (let L = 0; L < 4; L++) {
      const par = L < 2 ? BN.chest : BN.pelvis;
      const u = n++; PARENT.push(par);
      const l = n++; PARENT.push(u);
      const f = n++; PARENT.push(l);
      LEGB.push([u, l, f]);
    }
    const stops = spec.tailStops || (function () { const s = []; for (let i = 0; i < spec.tail; i++) s.push(spec.tail === 3 ? [0, 0.33, 0.66][i] : i / spec.tail); return s; })();
    function bindPoints(D) {
      const P = new Array(n);
      P[BN.root] = [0, 0, 0];
      P[BN.pelvis] = [D.hipX, D.hipH, 0];
      P[BN.chest] = [D.shX, D.sh, 0];
      for (let i = 0; i < spec.neck; i++) {
        const t = i / spec.neck, id = i === 0 ? BN.neck : BN["neck" + i];
        P[id] = [D.neckB.x + (D.headP.x - D.neckB.x) * t, D.neckB.y + (D.headP.y - D.neckB.y) * t, 0];
      }
      P[BN.head] = [D.headP.x, D.headP.y, 0];
      P[BN.jaw] = [D.jawP.x, D.jawP.y, 0];
      if (spec.ears) { P[BN.earL] = [D.earP.x, D.earP.y, -D.earP.z]; P[BN.earR] = [D.earP.x, D.earP.y, D.earP.z]; }
      for (let i = 0; i < spec.tail; i++) {
        P[BN["tail" + i]] = i === 0 ? [D.tailP.x, D.tailP.y, 0] : [D.tailP.x - D.tailL * stops[i], D.tailP.y, 0];
      }
      if (spec.hackle) { const h = D.hackleP || { x: D.shX, y: D.sh }; P[BN.hackle] = [h.x, h.y, 0]; }
      if (spec.hump) { const h = D.humpP || { x: D.shX, y: D.sh }; P[BN.hump] = [h.x, h.y, 0]; }
      for (let L = 0; L < 4; L++) {
        const front = L < 2, z = (L % 2 === 0 ? -1 : 1) * (front ? D.legZf : D.legZh);
        const J = front ? D.FJ : D.HJ, a = front ? D.fa : D.ha, b = front ? D.fb : D.hb;
        const ids = LEGB[L];
        P[ids[0]] = [J.x, J.y, z];
        P[ids[1]] = [J.x, J.y - a, z];
        P[ids[2]] = [J.x, J.y - a - b, z];
      }
      return P;
    }
    return { BN: BN, LEGB: LEGB, PARENT: PARENT, NB: n, spec: spec, bindPoints: bindPoints };
  }

  function makeSkeleton(table, D, name) {
    const THREE = W.THREE;
    const pts = table.bindPoints(D), NB = table.NB, PARENT = table.PARENT;
    const bs = [];
    for (let i = 0; i < NB; i++) { const b = new THREE.Bone(); b.name = (name || "quad") + i; bs.push(b); }
    for (let i = 0; i < NB; i++) {
      const p = PARENT[i], P = pts[i], Q = p >= 0 ? pts[p] : [0, 0, 0];
      bs[i].position.set(P[0] - Q[0], P[1] - Q[1], P[2] - Q[2]);
      if (p >= 0) bs[p].add(bs[i]);
    }
    return { bones: bs, skeleton: null, bindPos: bs.map(function (b) { return b.position.clone(); }), table: table, dims: D };
  }
  function skinnedMesh(geo, mat, rig) {
    const THREE = W.THREE;
    const mesh = new THREE.SkinnedMesh(geo, mat);
    mesh.add(rig.bones[0]);
    mesh.updateMatrixWorld(true);
    rig.skeleton = new THREE.Skeleton(rig.bones);
    mesh.bind(rig.skeleton);
    mesh.castShadow = true;
    rig.mesh = mesh;
    return mesh;
  }

  // 2-bone IK in the sagittal plane: root (jx, jy) -> joint -> end (tx, ty).
  function ik2(jx, jy, tx, ty, a, b, bend, out) {
    let dx = tx - jx, dy = ty - jy, d = Math.hypot(dx, dy);
    const dmin = Math.abs(a - b) + 1e-4, dmax = a + b - 1e-4;
    if (d < 1e-6) { dx = 0; dy = -1; d = dmin; }
    const dc = clamp(d, dmin, dmax);
    const base = Math.atan2(dy, dx);
    const A = Math.acos(clamp((a * a + dc * dc - b * b) / (2 * a * dc), -1, 1));
    const t1 = base + bend * A;
    const ex = jx + a * Math.cos(t1), ey = jy + a * Math.sin(t1);
    out[0] = t1; out[1] = Math.atan2(ty - ey, tx - ex);
    return out;
  }

  // the dog's standing-leg solve, for any rig made by makeSkeleton
  const _ik = [0, 0], _f = { x: 0, y: 0, a: 0 };
  function poseLegs(rig, G, D, body, opts) {
    const T = rig.table, b = rig.bones, bp = rig.bindPos, K = D.K || 1;
    body = body || { pX: D.hipX, pY: D.hipH, pR: 0, cX: D.shX, cY: D.sh, cR: 0 };
    for (let Lg = 0; Lg < 4; Lg++) {
      const front = Lg < 2, F = G.feet[Lg], ids = T.LEGB[Lg];
      const a = front ? D.fa : D.ha, bl = front ? D.fb : D.hb, cl = front ? D.fc : D.hc;
      const bx = front ? body.cX : body.pX, by = front ? body.cY : body.pY, br = front ? body.cR : body.pR;
      const off = bp[ids[0]];
      const jx = bx + Math.cos(br) * off.x - Math.sin(br) * off.y;
      const jy = by + Math.sin(br) * off.x + Math.cos(br) * off.y;
      const su = F.sw ? Math.sin(PI * F.u) : 0;
      _f.x = F.lx; _f.y = F.ly + (D.pawR || 0);
      _f.a = front ? (-HALF + 0.3 - 1.25 * su) : (-HALF + 0.08 - 0.55 * su);
      if (!front && !F.sw) _f.a += 0.25 * clamp((D.feet[Lg].x - F.lx) / (0.3 * K), -1, 1);   // push-off
      if (opts && opts.foot) opts.foot(Lg, _f, jx, jy);
      const wx = _f.x - cl * Math.cos(_f.a), wy = _f.y - cl * Math.sin(_f.a);
      ik2(jx, jy, wx, wy, a, bl, front ? -1 : 1, _ik);
      const t1 = _ik[0], t2 = _ik[1];
      b[ids[0]].rotation.set(0, 0, t1 + HALF - br);
      b[ids[1]].rotation.set(0, 0, t2 - t1);
      b[ids[2]].rotation.set(0, 0, _f.a - t2);
    }
  }

  const API = { bones: bones, makeSkeleton: makeSkeleton, skinnedMesh: skinnedMesh, ik2: ik2, poseLegs: poseLegs };
  CBZ.quadRig = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
