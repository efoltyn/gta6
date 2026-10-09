/* ============================================================
   entities/character.js — the human body + a layered PROCEDURAL
   animation rig: TWO-SEGMENT LOFTED LIMBS (tapered, rounded, a ball at
   every elbow and knee — see the LIMBS block) with real hands.

     root (g)            ← world transform (position / facing / KO)
      ├─ ll, rl          ← leg pivots at the HIPS
      │    └─ low        ← KNEE pivot (shin + shoe cap live here)
      └─ body            ← hip-locked pelvis + upper body; bob / sway / lean
          ├─ pelvis, torso, collar
          ├─ la, ra      ← arm pivots at the SHOULDERS
          │    └─ low    ← ELBOW pivot (forearm + the real hand + hand socket)
          └─ neck → head ← head pivot for look / bob

   Joint conventions (facing +z):
     negative rotation.x on a hip/shoulder swings the limb FORWARD.
     KNEE only folds BACKWARD  → knee rotation.x >= 0.
     ELBOW only folds FORWARD  → elbow rotation.x <= 0.

   Compatibility contract kept for every other system:
     rig.parts.{ll,rl,la,ra}    = the TOP pivots (hip/shoulder), as before
     part.userData.main         = the UPPER segment mesh
     part.userData.cap          = the hand mesh (arms: fphands body LOD) / shoe cap
     part.userData.low          = the NEW joint pivot group
     part.userData.lower        = the NEW lower segment mesh
     rig.low.{ll,rl,la,ra}      = the joint pivots (same objects as .low)
     rig.sockets.*              = same objects as before (now parented at the
                                  real wrist inside the elbow group)
     rig.skinSlots.arms/legs    = STILL length-2 upper meshes (wounds.js
                                  indexes [0]/[1] and checks length===2)
     rig.skinSlots.armsLower/legsLower = the new lower meshes
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const mat = CBZ.mat, cmat = CBZ.cmat, boxGeom = CBZ.boxGeom;
  let _headBase = null;

  CBZ.CONFIG = CBZ.CONFIG || {};
  /* CHAR_SLEEP_POSE — a body in a bed used to be the STANDING rig rolled 90°
     about Z, i.e. the exact pose a KO'd corpse holds on the pavement: straight
     legs, standing-idle arms, chin level. Every bedroom in the game therefore
     contained a plank. On → `ch.lying` (city/propuse.js publishes it) runs a
     real sleep pose inside that same roll: knees drawn up, spine curled, one
     arm folded in, head settled, chest breathing. Flip false (or
     ?cfg_CHAR_SLEEP_POSE=0) and the branch never runs — the plank comes back,
     which is the one-line revert.
     CHAR_SEAT_POSTURE — a sofa, a throne, a bar stool and an office chair all
     produced ONE identical upright chair pose. On → the seat's own `kind`
     (carried through CBZ.propSeatRef as seatRef.kind) picks a posture family.
     Off → every seat gets today's single pose, byte-identical. */
  if (CBZ.CONFIG.CHAR_SLEEP_POSE == null) CBZ.CONFIG.CHAR_SLEEP_POSE = true;
  if (CBZ.CONFIG.CHAR_SEAT_POSTURE == null) CBZ.CONFIG.CHAR_SEAT_POSTURE = true;
  /* CHAR_PRONE_GUN_POSE — the prone arms. Off → the shipped -1.32/-1.40
     shoulders, which drive both arms (and the weapon) through the floor.
     CHAR_GUN_GROUND_REST — the held weapon's ground contact solve (below).
     Off → the weapon socket never moves and a gun may sit in the dirt.
     CHAR_HEAVY_CARRY — weapon-data.js `hold.heavy` blending in the low-ready
     and present poses. Off → every gun is carried identically, as before. */
  if (CBZ.CONFIG.CHAR_PRONE_GUN_POSE == null) CBZ.CONFIG.CHAR_PRONE_GUN_POSE = true;
  // PORT ARMS long-gun carry (see the LONG-GUN carry note in animChar); false
  // = the round-2 thigh-hang pose and holsterprops' hanging barrel direction.
  if (CBZ.CONFIG.CHAR_PORT_ARMS_CARRY == null) CBZ.CONFIG.CHAR_PORT_ARMS_CARRY = true;
  if (CBZ.CONFIG.CHAR_GUN_GROUND_REST == null) CBZ.CONFIG.CHAR_GUN_GROUND_REST = true;
  if (CBZ.CONFIG.CHAR_HEAVY_CARRY == null) CBZ.CONFIG.CHAR_HEAVY_CARRY = true;

  /* ==== LIMBS — TAPERED, ROUNDED, JOINTED ==================================
     Owner, 2026-09-28: "make the arms and legs much more realistic." Every
     limb segment was a plain box (boxGeom), kept that way for two reasons the
     human lead wrote down: the painted-clothes atlas mapped a box's six faces,
     and pedinstance.js drew every box from one shared unit cube. Both are
     answered here instead of by keeping the box:

     SHAPE. Each segment is a lofted tube through a short table of cross
     sections (LIMB_SHAPES): a deltoid that caps the shoulder, a bicep that
     bulges forward, an elbow that narrows, a forearm whose belly sits high and
     whose wrist is wider front-to-back than side-to-side (the hand's own wrist
     stub fits inside it); a full upper thigh, a quad that bulges forward, a
     knee, a calf whose belly sits BEHIND the shin, an ankle that disappears
     into the shoe collar. A clothed segment is its own, smoother section
     (fabric does not show a bicep): a sleeve with a cuff lip at the wrist, a
     trouser leg that falls straight and breaks over the shoe.

     JOINTS. Each segment is closed by a dome centred ON its joint pivot, and
     the upper segment's section at the joint is at least as wide as the lower
     one's. So the upper segment alone holds a whole ball round the elbow /
     knee, and the lower segment rotates inside that ball: a bend can never
     open a gap, and because nothing is skinned there is no vertex blending to
     collapse into a candy wrapper. tools/limb-check.mjs sweeps the pose range
     and measures it.

     PAINT. The tube's circumference is split into four quadrants at 45°
     (front / side / back / side, the same order and u direction as a
     BoxGeometry's faces), with duplicated seam vertices, so city/clothes.js
     hands its sleeve / trouser atlas rows to CBZ.humanLimbGeometry and the
     garment lands where it did on the box — v runs along the segment's old
     box span, so a cuff painted low in the row is still at the wrist.

     INSTANCING. Every segment is baked from a CANONICAL shape (per segment,
     variant, LOD and width:length aspect) scaled by one affine matrix L. A
     flat-coloured segment carries `_cbzUnit = {geo: canonical, L}`, which
     pedinstance.js pools exactly like the unit box: shape by instance matrix,
     so a child's arm and a guard's arm share one pool. Painted segments pool
     by geometry, as the painted boxes always did.

     COMPAT. geometry.parameters still reports the old box (width/height/
     depth) so everything that sizes itself off a limb box (wounds.js decals,
     warlord pads, clothes.js geomOk) keeps working; the mesh sits where the
     box sat. CBZ.humanLimbHalfAt(geometry, y) answers the real half-extent
     at a height for anything that must sit ON the surface.

     LOD. rig.setHandLod(2) (peds.js, past ~30 m) also swaps the limbs to the
     8-sided far loft (~90 tris a segment vs ~230 near). */
  const LIMB_TUCK = 0.02;       // the joint pivot sits this far above the upper segment's box end
  const LIMB_OVERLAP = 0.06;    // the lower segment's box reaches this far above its joint
  // rows: [t, rx, rz, cz] — t 0 = the segment's top joint .. 1 = its bottom end;
  // rx / rz = half-extent across / front-back as a share of the box's half
  // width / depth; cz = the section centre's forward shift (share of half depth).
  // top / bot = end-dome height as a share of that end's radius.
  const LIMB_SHAPES = {
    armUp: {
      bare: { top: 0.85, bot: 1, rows: [
        [0.00, 0.90, 0.92, 0.00], [0.13, 0.97, 0.98, 0.02], [0.33, 0.84, 0.90, 0.05],
        [0.56, 0.80, 0.90, 0.09], [0.80, 0.73, 0.78, 0.03], [1.00, 0.72, 0.72, 0.00]] },
      cloth: { top: 0.85, bot: 1, rows: [
        [0.00, 0.94, 0.95, 0.00], [0.15, 0.99, 0.99, 0.01], [0.45, 0.88, 0.93, 0.04],
        [0.80, 0.80, 0.83, 0.02], [1.00, 0.78, 0.78, 0.00]] },
    },
    // THE WRIST. It ended in a stump 0.40 x 0.51 of the box: on a man 7 x 8.7
    // cm half-extents in hand metres round a hand whose own wrist is 2 x 2.9
    // (fphands WRIST) and whose heel is 3.4 wide, so the hand came out of a
    // pipe twice its size. Now the crease is the hand's wrist plus ~10-20%
    // (rx 0.26 / rz 0.40 of the box = 2.2 x 3.4 cm on a man, x across the
    // palm's thickness, z along its width): the stub's pivot dome hides just
    // inside it and the heel of the palm continues it with no step. A sleeve
    // ends looser (a hem hangs round a wrist) in a flat cuff band that rolls
    // in at the edge instead of flaring out into a ring. tools/wrist-seam-
    // check.mjs measures the fit on man / woman / child in every hand pose.
    armLo: {   // the elbow (t 0) .. the wrist crease (t 1), where the hand's stub enters
      bare: { top: 1, bot: 0.20, rows: [
        [0.00, 0.80, 0.76, 0.00], [0.17, 0.88, 0.85, 0.02], [0.45, 0.70, 0.72, 0.02],
        [0.78, 0.43, 0.52, 0.00], [1.00, 0.26, 0.40, 0.00]] },
      cloth: { top: 1, bot: 0.22, rows: [
        [0.00, 0.84, 0.80, 0.00], [0.20, 0.88, 0.86, 0.01], [0.60, 0.70, 0.74, 0.00],
        [0.90, 0.40, 0.50, 0.00], [0.965, 0.40, 0.50, 0.00], [1.00, 0.37, 0.47, 0.00]] },
    },
    legUp: {
      bare: { top: 0.85, bot: 1, rows: [
        [0.00, 0.94, 0.96, 0.00], [0.12, 1.00, 1.00, 0.02], [0.45, 0.87, 0.92, 0.06],
        [0.80, 0.70, 0.75, 0.03], [1.00, 0.66, 0.68, 0.01]] },
      cloth: { top: 0.85, bot: 1, rows: [
        [0.00, 0.96, 0.98, 0.00], [0.14, 1.00, 1.00, 0.01], [0.55, 0.88, 0.90, 0.02],
        [1.00, 0.75, 0.77, 0.00]] },
    },
    legLo: {   // the knee (t 0) .. the sole line inside the shoe (t 1)
      bare: { top: 1, bot: 0.4, rows: [
        [0.00, 0.72, 0.74, 0.05], [0.10, 0.74, 0.80, 0.00], [0.28, 0.80, 0.88, -0.10],
        [0.56, 0.60, 0.64, -0.06], [0.82, 0.42, 0.46, -0.05], [1.00, 0.44, 0.50, 0.02]] },
      cloth: { top: 1, bot: 0.3, rows: [
        [0.00, 0.80, 0.82, 0.02], [0.30, 0.82, 0.86, -0.03], [0.72, 0.74, 0.78, -0.02],
        [1.00, 0.77, 0.80, 0.00]] },
    },
  };
  const LIMB_FACE = ["front", "side", "back", "side"];     // quadrant -> clothes atlas column
  const LIMB_GEO = Object.create(null);
  function limbRows(sh, lod) {
    const r = sh.rows;
    if (lod < 2 || r.length <= 3) return r;
    let bi = 1, bw = -1;                         // far: top, the fullest section, bottom
    for (let i = 1; i < r.length - 1; i++) { const w = r[i][1] + r[i][2]; if (w > bw) { bw = w; bi = i; } }
    return [r[0], r[bi], r[r.length - 1]];
  }
  /* The canonical loft, in (half-width, length, half-depth) units: x = rx·sinα,
     z = cz + rz·cosα, y = −t (top joint at 0, bottom end at −1). `aq` is the
     aspect (half width / length) x100, which is all the domes need to come out
     round in real space. */
  // the section rows between t0 and t1 (interpolated at the cut ends), scaled
  function cutRows(rows, t0, t1, s) {
    const at = (t) => {
      let i = 0;
      while (i < rows.length - 2 && rows[i + 1][0] < t) i++;
      const A = rows[i], B = rows[i + 1] || A, u = B[0] > A[0] ? Math.min(1, Math.max(0, (t - A[0]) / (B[0] - A[0]))) : 0;
      return [t, lerpN(A[1], B[1], u), lerpN(A[2], B[2], u), lerpN(A[3], B[3], u)];
    };
    const out = [at(t0)];
    for (const r of rows) if (r[0] > t0 + 1e-4 && r[0] < t1 - 1e-4) out.push(r.slice());
    out.push(at(t1));
    for (const r of out) { r[1] *= s; r[2] *= s; }
    return out;
  }
  /* cut = null (the whole segment) or [t0, t1, scale]: only that stretch of
     the loft, its top dome only if t0 is 0 and its bottom dome only if t1 is
     1, open at a cut end (the SHORT SLEEVE and the bare arm below it). */
  function limbCanon(kind, variant, lod, aq, cut) {
    const key = "C|" + kind + "|" + variant + "|" + lod + "|" + aq + (cut ? "|" + cut.join(",") : "");
    let g = LIMB_GEO[key];
    if (g) return g;
    const sh = LIMB_SHAPES[kind][variant];
    const full = limbRows(sh, lod);
    const rows = cut ? cutRows(full, cut[0], cut[1], cut[2]) : full;
    const n = lod >= 2 ? 2 : 3;                 // segments per quadrant (8 / 12 around)
    const nd = lod >= 2 ? 1 : 2;                // dome rings between the end section and the apex
    const a = aq / 100;
    const rings = [];
    const domeH = (row, k) => k * Math.max(row[1], row[2]) * a;
    const r0 = rows[0], rN = rows[rows.length - 1];
    // a cut end is closed by a near-flat cap (the other piece covers it)
    const topK = cut && cut[0] > 0 ? 0.03 : sh.top, botK = cut && cut[1] < 1 ? 0.03 : sh.bot;
    const t0 = cut ? cut[0] : 0, t1 = cut ? cut[1] : 1;
    for (let k = nd + 1; k >= 1; k--) {         // top dome: apex first
      const th = (Math.PI / 2) * k / (nd + 1), c = Math.cos(th);
      rings.push([-t0 + domeH(r0, topK) * Math.sin(th), r0[1] * c, r0[2] * c, r0[3]]);
    }
    for (let i = 0; i < rows.length; i++) rings.push([-rows[i][0], rows[i][1], rows[i][2], rows[i][3]]);
    for (let k = 1; k <= nd + 1; k++) {         // bottom dome: apex last
      const th = (Math.PI / 2) * k / (nd + 1), c = Math.cos(th);
      rings.push([-t1 - domeH(rN, botK) * Math.sin(th), rN[1] * c, rN[2] * c, rN[3]]);
    }
    const RV = 4 * (n + 1), nv = rings.length * RV;
    const P = new Float32Array(nv * 3), U = new Float32Array(nv * 2);
    const F = new Uint8Array(nv), Q = new Float32Array(nv);
    /* ONE ARM, ONE SKIN CHART. A flat arm segment's canonical v is packed
       into its half of the arm chart (entities/tattoo.js): the upper arm
       into [1 - split, 1] (shoulder at the top), the forearm into
       [0, 1 - split] — so a single texture covers shoulder to wrist and a
       mark can run across the elbow. Only flat segments sample these UVs
       (a painted garment bakes its own), and a flat segment has no map
       until tattoo.js gives it one. */
    const split = (CBZ.tattoo && CBZ.tattoo.ARM_SPLIT) || 0.6;
    const vA = kind === "armUp" ? split : kind === "armLo" ? 1 - split : 1;
    const vB = kind === "armUp" ? 1 - split : 0;
    let o = 0;
    for (let i = 0; i < rings.length; i++) {
      const R = rings[i], v = vB + vA * Math.min(1, Math.max(0, 1 + R[0]));
      for (let f = 0; f < 4; f++) for (let k = 0; k <= n; k++) {
        const al = -Math.PI / 4 + f * Math.PI / 2 + (k / n) * Math.PI / 2;
        P[o * 3] = R[1] * Math.sin(al); P[o * 3 + 1] = R[0]; P[o * 3 + 2] = R[3] + R[2] * Math.cos(al);
        const u = k / n;
        U[o * 2] = (f + u) / 4; U[o * 2 + 1] = v;
        F[o] = f; Q[o] = u;
        o++;
      }
    }
    const idx = [];
    for (let i = 0; i < rings.length - 1; i++) for (let f = 0; f < 4; f++) for (let k = 0; k < n; k++) {
      const c = i * RV + f * (n + 1) + k, b = c + RV;
      // (bottom-left, bottom-right, top-left), (bottom-right, top-right, top-left): outward.
      // The first and last ring are apexes (radius 0), so one half of each of
      // their quads is degenerate and is not emitted.
      if (i < rings.length - 2) idx.push(b, b + 1, c);
      if (i > 0) idx.push(b + 1, c + 1, c);
    }
    g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(P, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
    g.setAttribute("uv", new THREE.BufferAttribute(U, 2));
    g.setIndex(new THREE.BufferAttribute(nv > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
    finishGeo(g);                                // smooth normals welded across the uv seams
    g.computeBoundingBox(); g.computeBoundingSphere();
    g.userData.limbFace = F; g.userData.limbU = Q; g.userData.limbRows = full;   // (the WHOLE segment's: humanLimbHalfAt)
    g.name = "limb~" + key;
    g._shared = true;
    return (LIMB_GEO[key] = g);
  }
  /* spec = {kind, variant, w, d, len, y0, boxH}: w/d the old box's width and
     depth, len the pivot-to-end length, y0 the top pivot's mesh-local height,
     boxH the old box's height (the painted v span). paint = {key, fn(face,u,v)
     -> [U,V]} from city/clothes.js, or null for a flat-coloured segment. */
  function limbBake(spec, lod, paint) {
    lod = lod >= 2 ? 2 : 1;
    const aq = Math.round(Math.min(0.8, Math.max(0.05, spec.w / 2 / spec.len)) * 100);
    // a FLAT upper arm is only the sleeve (spec.cut); the bare arm below it is
    // its own piece wearing the forearm's colour (limb()). Painted, the atlas
    // draws the sleeve hem itself, so the whole segment bakes.
    const cut = paint ? null : (spec.cut || null);
    const key = "B|" + spec.kind + "|" + spec.variant + "|" + lod + "|" + aq + "|" +
      [spec.w, spec.d, spec.len, spec.y0, spec.boxH].map((x) => x.toFixed(4)).join(",") + "|" + (paint ? paint.key : "-") + (cut ? "|" + cut.join(",") : "");
    let g = LIMB_GEO[key];
    if (g) return g;
    const C = limbCanon(spec.kind, spec.variant, lod, aq, cut);
    const sx = spec.w / 2, sy = spec.len, sz = spec.d / 2, y0 = spec.y0;
    const cp = C.attributes.position.array, cn = C.attributes.normal.array, nv = cp.length / 3;
    const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3);
    for (let i = 0; i < nv; i++) {
      P[i * 3] = cp[i * 3] * sx; P[i * 3 + 1] = cp[i * 3 + 1] * sy + y0; P[i * 3 + 2] = cp[i * 3 + 2] * sz;
      const nx = cn[i * 3] / sx, ny = cn[i * 3 + 1] / sy, nz = cn[i * 3 + 2] / sz;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      N[i * 3] = nx / l; N[i * 3 + 1] = ny / l; N[i * 3 + 2] = nz / l;
    }
    g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(P, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(N, 3));
    if (paint) {
      const U = new Float32Array(nv * 2), F = C.userData.limbFace, Q = C.userData.limbU, hb = spec.boxH / 2;
      // THE END DOMES WEAR THE CLOTH, NOT THE ROW'S EDGE: a dome past the
      // segment's top joint (the ball over the hip, the shoulder) takes the
      // cloth a little way down the span — v clamped to the end itself is the
      // waistband / sleeve-head line at best and the NEIGHBOURING garment row
      // at worst (clothes.js rowInset).
      const vTop = 1 - 0.07, vBot = 0.02;
      for (let i = 0; i < nv; i++) {
        const y = P[i * 3 + 1];
        const v = y > y0 - 1e-5 ? vTop : Math.min(vTop, Math.max(vBot, (y + hb) / spec.boxH));
        const uv = paint.fn(LIMB_FACE[F[i]], Q[i], v);
        U[i * 2] = uv[0]; U[i * 2 + 1] = uv[1];
      }
      g.setAttribute("uv", new THREE.BufferAttribute(U, 2));
    } else {
      g.setAttribute("uv", C.attributes.uv);     // the canonical's own: pedinstance's pool samples the same
      g._cbzUnit = { geo: C, L: new THREE.Matrix4().makeScale(sx, sy, sz).setPosition(0, y0, 0) };
    }
    g.setIndex(C.index);
    g.computeBoundingBox(); g.computeBoundingSphere();
    // the box this segment replaced, for everything that sizes itself off one
    g.parameters = { width: spec.w, height: spec.boxH, depth: spec.d };
    g.userData.limb = { rows: C.userData.limbRows, sx, sy, sz, y0 };
    g.name = "limb~" + spec.kind + "~" + spec.variant + "~" + lod;
    g._shared = true;
    return (LIMB_GEO[key] = g);
  }
  // Real half-extents of a limb geometry at mesh-local height y: {hx, hz, cz}
  // (null for anything that is not a limb loft — callers keep their box maths).
  function limbHalfAt(g, y) {
    const L = g && g.userData && g.userData.limb;
    if (!L) return null;
    const rows = L.rows, t = Math.min(1, Math.max(0, (L.y0 - y) / L.sy));
    let i = 0;
    while (i < rows.length - 2 && rows[i + 1][0] < t) i++;
    const a = rows[i], b = rows[i + 1] || a, s = b[0] > a[0] ? (t - a[0]) / (b[0] - a[0]) : 0;
    return { hx: lerpN(a[1], b[1], s) * L.sx, hz: lerpN(a[2], b[2], s) * L.sz, cz: lerpN(a[3], b[3], s) * L.sz };
  }
  function limbMesh(spec, color) {
    spec.lod = 1;
    const m = new THREE.Mesh(limbBake(spec, 1, null), cmat(color));
    m.userData.limb = spec;
    m.castShadow = m.receiveShadow = true;
    return m;
  }
  // the segment's geometry for its current LOD and paint (clothes.js calls this
  // on dress with a painter, on strip with null; omitted = keep the paint)
  function limbGeometry(mesh, paint) {
    const spec = mesh && mesh.userData && mesh.userData.limb;
    if (!spec) return null;
    if (paint !== undefined) mesh.userData.limbPaint = paint || null;
    return limbBake(spec, spec.lod, mesh.userData.limbPaint || null);
  }
  function setLimbLod(rig, lod) {
    lod = lod >= 2 ? 2 : 1;
    const s = rig && rig.skinSlots;
    if (!s) return;
    if (CBZ.footwear) CBZ.footwear.lod(rig, lod);
    const lists = [s.arms, s.armsLower, s.legs, s.legsLower];
    for (let j = 0; j < lists.length; j++) {
      const list = lists[j];
      if (!list) continue;
      for (let i = 0; i < list.length; i++) {
        const m = list[i], spec = m && m.userData.limb;
        if (!spec || spec.lod === lod) continue;
        spec.lod = lod;
        const flat = m.userData._cbzFlat;
        if (flat && flat.g && flat.g.userData && flat.g.userData.limb) flat.g = limbBake(spec, lod, null);
        // swap only a geometry this file baked (a synthesised repair box is left alone)
        if (m.geometry && m.geometry.userData && m.geometry.userData.limb) m.geometry = limbGeometry(m);
      }
    }
  }
  /* Two-segment limb. Pivot group at the hip/shoulder; the upper loft hangs to
     the joint; a `low` pivot group sits AT the joint with the lower loft
     inside it. `kind` "arm" | "leg"; vUp / vLo "bare" | "cloth". The boxes
     these replaced are still the spec (w x upperH, 0.9w x lowerH+0.06). */
  function limb(kind, w, upperH, lowerH, d, color, lowerColor, vUp, vLo) {
    const grp = new THREE.Group();
    const upper = limbMesh({ kind: kind + "Up", variant: vUp, w, d, len: upperH - LIMB_TUCK, y0: upperH / 2, boxH: upperH }, color);
    upper.position.y = -upperH / 2;
    grp.add(upper);
    grp.userData.main = upper;

    const low = new THREE.Group();
    low.position.y = -(upperH - LIMB_TUCK);     // the joint pivot
    grp.add(low);
    grp.userData.low = low;

    const lw = w * 0.9, ld = d * 0.9;
    const lower = limbMesh({ kind: kind + "Lo", variant: vLo, w: lw, d: ld, len: lowerH, y0: (lowerH - LIMB_OVERLAP) / 2, boxH: lowerH + LIMB_OVERLAP },
      lowerColor != null ? lowerColor : color);
    lower.position.y = (LIMB_OVERLAP - lowerH) / 2;
    low.add(lower);
    grp.userData.lower = lower;
    if (kind === "arm") armBare(upper, lower);
    return grp;
  }
  /* THE SHORT SLEEVE ENDS MID-UPPER-ARM. A flat-coloured arm is one colour per
     segment (the crowd instancer tints each pooled part by ONE instance
     colour), so a tee used to end at the elbow: shirt upper arm, skin forearm.
     Now a flat upper arm bakes only its top SLEEVE_T (the sleeve), and a bare
     piece hangs below it in the same pivot wearing the FOREARM's material —
     read live, so every writer that paints a forearm (skin for a tee, shirt
     for a long sleeve) paints this too, with no new slot to keep in step. A
     long sleeve is the same colour top to bottom; a tee shows skin from mid-
     bicep. Painted (clothes.js atlas on the upper arm), the whole segment
     bakes and this piece hides: the atlas draws its own hem. The piece pools
     like any flat limb (canonical loft, instance colour). */
  const SLEEVE_T = 0.45;
  function armBare(upper, lower) {
    const us = upper.userData.limb;
    us.cut = [0, SLEEVE_T, 1];
    upper.geometry = limbBake(us, us.lod, null);
    const ps = Object.assign({}, us, { cut: [SLEEVE_T - 0.04, 1, 0.985] });
    const bare = new THREE.Mesh(limbBake(ps, 1, null), lower.material);
    bare.name = "armBare";
    bare.position.copy(upper.position);
    bare.castShadow = bare.receiveShadow = true;
    bare.userData.limbPiece = true;                   // (overlap-audit: this IS the upper arm; no back-ref — Object3D.copy JSON-clones userData)
    let shown = true, gLod = 1, g = bare.geometry;
    Object.defineProperty(bare, "material", { get() { return lower.material; }, set() {}, configurable: true });
    Object.defineProperty(bare, "geometry", {                  // follows the upper arm's LOD (setLimbLod)
      get() { if (us.lod !== gLod) { gLod = us.lod; g = limbBake(ps, gLod, null); } return g; }, set() {}, configurable: true,
    });
    Object.defineProperty(bare, "visible", {
      get() { return shown && upper.visible !== false && !upper.userData.limbPaint && !!(upper.geometry && upper.geometry.userData && upper.geometry.userData.limb); },
      set(v) { shown = v !== false; }, configurable: true,
    });
    upper.parent.add(bare);
    upper.userData.bare = bare;
  }
  CBZ.humanLimbGeometry = partGeometry;      // limbs AND torso parts (TORSO block)
  CBZ.humanLimbHalfAt = limbHalfAt;

  // Whole-limb lengths preserved: arm 0.92 (+0.2 hand), leg 0.95 (+0.2 shoe).
  const ARM_UP = 0.46, ARM_LO = 0.46;
  const LEG_UP = 0.48, LEG_LO = 0.47;

  /* ==== HANDS — EVERY BODY WEARS THE FIRST-PERSON HAND ====================
     Owner: "The FP hands are really real, but on the third-person models
     those hands are way different." Every body's hand was limb()'s skin BOX
     cap (0.29 x 0.23 x 0.37 on an adult male — a brick that also swallowed the
     last 0.20 of the forearm). Now it is systems/fphands.js's hand — same
     palm, jointed fingers, opposing thumb, same pose curl — at its BODY LOD
     (~216 tris; lod 2 ~51 tris for far crowds), one shared geometry per
     (side, pose, lod) so pedinstance pools it, sized per body by mesh.scale.

     WHERE IT HANGS. The forearm box now stops at the WRIST CREASE (handH above
     the old wrist line — exactly where the box used to start), and the hand
     hangs from there in the ELBOW group: fingers down (-Y), palm to the thigh,
     thumb forward, turned a little back like a relaxed arm. Relaxed, its
     fingertips land within a couple of centimetres of where the box's bottom
     was, so the silhouette's arm length does not change.

     SIZE. The hand is authored in metres; this rig is authored in 1/0.70
     units (model.scale = HUMAN_SCALE), so life size is x1/0.70. It is drawn
     x1.1 life size against the chunky voxel forearm, then by the profile:
     handH carries a child's growth, sqrt(armW/0.30) a woman's slimmer hand.

     HOLDING. rig.sockets.* never move (weapons hang off them). A HOLD pose
     (pistol / grip / support / cupover / wheel) slides the hand down its own
     wrist until the closed hand's grip centre sits on that side's socket —
     the thirdPersonWeapon socket on the right, leftHand on the left — so the
     fingers close round the thing held rather than above it. The wrist stub
     is long enough that the slide never opens a gap at the cuff. The slide
     is ALONG the forearm only (sideways it pushed the stub out through the
     slim wrist and a watch).
     A GUN is held properly instead: systems/actorweapons.js CBZ.gunHold puts
     a hand sized to the part (fphands trigNN / holdNN) at the crease,
     oriented ON the gun's own grip frame, and solves the arm to it with
     charArmTo.wrist (below charArmTo) — the hand's local transform is then
     the hold's, until the next setHandPose change resets it here.

     API: rig.setHandPose("l" | "r" | "both", pose)  pose = a fpHands.POSES name
          rig.setHandLod(0 | 1 | 2)                  (default 1)
     Dependency: systems/fphands.js must load before a body is BUILT (it is in
     the studio `people` pack and ahead of this file in index/disaster.html). */
  const HAND_LIFE = 1 / 0.70;          // rig units per metre
  const HAND_K = 1.1;                  // drawn a touch over life size against the voxel limbs
  const HAND_REST_YAW = 0.30;          // a hanging palm turns a little back toward the thigh
  const HAND_HOLD = { pistol: 1, grip: 1, support: 1, cupover: 1, wheel: 1 };
  const HAND_STUB_M = 0.06;            // how far the hand may slide down (its wrist stub reaches 0.07 m back)
  let _handWarned = false;
  let _footWarned = false;
  function bodyHandFit(P) {
    const s = HAND_LIFE * HAND_K * (P.handH / 0.20) * Math.sqrt((P.armW || 0.30) / 0.30);
    return {
      s,
      wristY: P.handH - P.armLo,                         // the crease = the forearm box's bottom
      socketY: -P.armLo - 0.01, socketZ: 0.035,          // rig.sockets.leftHand/rightHand (fixed)
      maxDrop: HAND_STUB_M * s,
    };
  }
  const _hq = new THREE.Quaternion(), _hyq = new THREE.Quaternion(), _hm4 = new THREE.Matrix4();
  const _hY = new THREE.Vector3(0, 1, 0), _hgc = new THREE.Vector3();
  const _hbx = new THREE.Vector3(), _hby = new THREE.Vector3(), _hbz = new THREE.Vector3();
  function placeBodyHand(m) {
    const side = m.userData.side, fit = m.userData.fit, pose = m.userData.handPose;
    const hold = !!HAND_HOLD[pose];
    // hand frame -> elbow frame: fingers (-Z_h) down, palm (-Y_h) inward,
    // thumb forward. Right arm (semantic right, at -X): palm faces +X.
    if (side > 0) { _hbx.set(0, 0, -1); _hby.set(-1, 0, 0); }
    else { _hbx.set(0, 0, 1); _hby.set(1, 0, 0); }
    _hbz.set(0, 1, 0);
    _hm4.makeBasis(_hbx, _hby, _hbz);
    _hq.setFromRotationMatrix(_hm4);
    if (!hold) _hq.premultiply(_hyq.setFromAxisAngle(_hY, side > 0 ? HAND_REST_YAW : -HAND_REST_YAW));
    m.quaternion.copy(_hq);
    m.position.set(0, fit.wristY, 0);
    if (hold && CBZ.fpHands && CBZ.fpHands.gripCentre) {
      // the grip centre (hand frame, right-handed; mirrored for the left)
      CBZ.fpHands.gripCentre(pose, _hgc);
      if (side < 0) _hgc.x = -_hgc.x;
      _hgc.multiplyScalar(fit.s).applyQuaternion(_hq);
      // the target height: the socket this side holds with (the weapon
      // socket's drop on the right, the bare wrist socket on the left)
      const ty = fit.socketY + (side > 0 ? -0.03 : 0);
      // ALONG THE FOREARM ONLY. The slide used to move the hand sideways too
      // (up to 0.6 x maxDrop), which parked the wrist stub outside the slim
      // lofted wrist and pushed it up through a wristwatch. The hand stays on
      // the forearm's axis; a hold that needs the grip somewhere else moves
      // the ARM there (charArmTo.wrist) and orients the hand on the thing
      // held (systems/gunhands.js CBZ.gunHold) instead of shearing the hand.
      m.position.set(0, Math.max(fit.wristY - fit.maxDrop, Math.min(fit.wristY, ty - _hgc.y)), 0);
    }
  }
  function makeBodyHand(side, fit, color) {
    const H = CBZ.fpHands;
    if (!H || !H.bodyHandGeometry) {
      if (!_handWarned && typeof console !== "undefined") console.warn("character.js: systems/fphands.js not loaded before makeCharacter — bodies have no hands");
      _handWarned = true;
      return null;
    }
    const m = new THREE.Mesh(H.bodyHandGeometry(side, "relaxed", 1), cmat(color != null ? color : 0xcf9a72));
    m.name = side < 0 ? "hand_l" : "hand_r";
    m.userData.side = side < 0 ? -1 : 1;
    m.userData.fit = fit;
    m.userData.handPose = "relaxed";
    m.userData.handLod = 1;
    m.scale.setScalar(fit.s);
    m.castShadow = false;
    m.receiveShadow = true;
    placeBodyHand(m);
    return m;
  }
  function handsOf(rig, side) {
    const la = rig.parts && rig.parts.la, ra = rig.parts && rig.parts.ra;
    const l = la && la.userData.cap, r = ra && ra.userData.cap;
    if (side === "l" || side === -1) return [l];
    if (side === "r" || side === 1) return [r];
    return [l, r];
  }
  function setBodyHandPose(rig, side, pose) {
    const H = CBZ.fpHands;
    if (!H) return;
    pose = pose && H.POSES[pose] ? pose : "relaxed";
    const hs = handsOf(rig, side);
    for (let i = 0; i < hs.length; i++) {
      const m = hs[i];
      if (!m || !m.userData.fit || m.userData.handPose === pose) continue;
      m.userData.handPose = pose;
      m.geometry = H.bodyHandGeometry(m.userData.side, pose, m.userData.handLod);
      placeBodyHand(m);
      const fore = foreOf(rig, m);
      if (fore) fore.rotation.y = 0;               // a new pose starts untwisted (wristTwist)
    }
  }
  function foreOf(rig, hand) {
    const part = rig.parts && rig.parts[hand.userData.side < 0 ? "la" : "ra"];
    return part && part.userData.cap === hand ? part.userData.lower : null;
  }
  /* PRONATION. The hand hangs in the elbow group, the forearm loft is rigid
     and flatter across than front-to-back (so is the wrist). A gun hold
     orients the hand ON the grip and the arm IK owns the elbow's roll, so the
     hand could sit up to ~90 deg rolled against its forearm: the wrist's long
     axis across the forearm's short one, the forearm's end sticking out of
     both sides of the hand. A real forearm twists with the hand; so does this
     one: the lower loft turns about its own axis (+Y, through the crease) to
     the hand's roll, mod 180 (the section is symmetric under a half turn, so
     the twist never exceeds a quarter turn). Called by systems/actorweapons.js
     after it writes a gun hand's rotation; setHandPose resets it. The elbow
     end is near round, so the elbow does not visibly turn with it. */
  const _twx = new THREE.Vector3();
  function wristTwist(rig, side) {
    const hs = handsOf(rig, side == null ? "both" : side);
    for (let i = 0; i < hs.length; i++) {
      const m = hs[i], fore = m && foreOf(rig, m);
      if (!fore) continue;
      _twx.set(1, 0, 0).applyQuaternion(m.quaternion);        // the hand's width, elbow frame
      if (_twx.x * _twx.x + _twx.z * _twx.z < 0.04) continue;  // width along the arm: no roll to read
      let th = Math.atan2(_twx.x, _twx.z);                     // rest (hold basis): width along +-Z = 0
      th = th - Math.PI * Math.round(th / Math.PI);
      fore.rotation.y = th;
    }
  }
  CBZ.charWristTwist = wristTwist;
  function setBodyHandLod(rig, lod) {
    const H = CBZ.fpHands;
    if (!H) return;
    lod = Math.max(0, Math.min(2, lod | 0));
    const hs = handsOf(rig, "both");
    for (let i = 0; i < hs.length; i++) {
      const m = hs[i];
      if (!m || !m.userData.fit || m.userData.handLod === lod) continue;
      m.userData.handLod = lod;
      m.geometry = H.bodyHandGeometry(m.userData.side, m.userData.handPose, lod);
    }
  }
  CBZ.charSetHandPose = setBodyHandPose;

  /* ============================================================
     BODY PROFILE — the ONE place a body's proportions live.

     Before this, every dimension in makeCharacter was a `fem ? a : b`
     ternary scattered through 200 lines of geometry, which is why the
     only two bodies this game could ever build were "man" and "slightly
     smaller man". A profile is a flat record of every authored number;
     makeCharacter now READS one instead of branching. Adding a body
     (child, toddler, a heavier build later) is a table row, not new
     geometry code, and all ~15 makeCharacter call sites get it for free.

     ADOPTION IS ONE FIELD: `makeCharacter({..., age: 7})`. Omit it and
     you get the adult profile for c.build, which is byte-identical to
     the pre-profile rig for "m" (every male number below is the literal
     that used to be inline). Degrade-safe: an unknown build/age clamps
     into the table, never throws.

     WHY WOMEN DIDN'T READ AS WOMEN (owner: "women look like men with
     different colours"). The old fem path scaled EVERY box down by the
     same ~0.85: shoulders 0.85x, hips 0.857x. Shoulder:hip therefore
     stayed 1.10 — a MALE ratio — so the silhouette was a small man.
     Real anthropometry (ANSUR II): female biacromial breadth is ~0.87x
     male, but bi-iliac/hip breadth is ~0.95x — hips barely shrink. Male
     shoulder:hip runs ~1.15-1.20, female ~0.95-1.05. Fixed below: the
     shoulders keep their 0.85, the hips come back OUT (pelvisW 0.72 ->
     0.80, depth 0.43 -> 0.46), and a real WAIST box (WHR ~0.7-0.8 in
     women vs ~0.85-0.95 in men) tapers between them. Chest/hip/waist,
     not size, is what reads female at 30m.

     CHILDREN ARE NOT SCALED ADULTS. The old child (births.js/family.js)
     was `group.scale.setScalar(0.62)` — a shrunken adult, wrong in every
     ratio. Real children carry a near-adult head on a short torso and
     much shorter legs: sitting-height/stature runs 0.63 at age 2 vs 0.52
     adult, so legs are ~37% of a toddler's height and ~48% of an adult's.
     GROWTH below encodes stature, head fraction, leg share, shoulder and
     hip growth per age; every segment is derived from it.
  ============================================================ */

  // Authored (pre-humanScale) height of the reference adult male rig:
  // neck socket 1.88 + head 0.60. Every stature number below is a
  // fraction of this, so the whole table stays unit-free.
  const ADULT_TOP = 2.48;
  const WAIST_TUCK = 0.06;      // waist box tucks UP into the chest box (limb-joint trick)
  // THE ONE Z-FIGHT CLEARANCE. Minimum distance between any two parallel faces
  // of this rig that overlap and are both visible — 0.01 authored is 7mm at
  // HUMAN_SCALE 0.70, which is the clearance the shipped adult-male rig already
  // held everywhere it did NOT z-fight. Published so city/clothes.js's jacket
  // shell measures against the same number instead of typing a second one.
  const YOKE_CLEAR = 0.01;
  // THE PRONE PLANK'S OWN ANGLES. Named because physics.js has to drop the rig
  // group by exactly the amount that puts this pose's LOWEST SURFACE on the
  // floor, and it cannot solve that against literals buried in animChar — a
  // sink and a pose that disagree is a body sunk into the terrain (owner: "the
  // player [goes] a tiny bit [under ground]"). One place, both consumers.
  const PRONE_PITCH = 1.42;       // torso hinge at the hips: chest to the deck
  const PRONE_LEG_PITCH = 1.49;   // legs sweep back level (±0.03 alternation)

  /* ---- THE PRONE ARMS, SOLVED AGAINST THE FLOOR --------------------------
     OWNER, 2026-08-03: "when player lies down, right now the gun goes
     UNDERGROUND. It's dumb physics. The gun should respect the ground too."

     The gun was the SYMPTOM; the arms were the bug, and it is arithmetic, not
     taste. A limb hangs along its own -Y, so after the shoulder's own pitch
     `a` and the torso's PRONE_PITCH the segment points, in world,
         (0, -cos(a + PRONE_PITCH), -sin(a + PRONE_PITCH)).
     The shipped pose used a = -1.32 / -1.40, i.e. a + PRONE_PITCH ≈ +0.1 rad,
     which is (0, -0.995, -0.10): BOTH ARMS DRIVEN VERTICALLY DOWNWARD through
     the deck. Measured on the shipped adult male, the weapon socket sat
     **0.446 m BELOW the floor** — no direction-only muzzle solve can rescue
     that, and holsterprops.js's one honestly rotated the barrel 80° at the sky
     trying to (measured: gun 0.83 m under the surface).

     So the angles are now read off the posture a prone shooter actually
     holds, and both are solved from ONE equation instead of typed:
     let φ = a + PRONE_PITCH be the segment's world pitch, so
         a = φ − PRONE_PITCH,   world dir = (0, −cos φ, −sin φ).
       · UPPER ARM: shoulder → elbow, 30° BELOW horizontal and forward, which
         is what puts the elbow ON the deck (φ = −60°, elbow lands 0.065 m over
         the floor on the shipped body — the plant you can see).
       · FOREARM, ARMED: elbow → hand, 48° ABOVE horizontal, which carries the
         weapon socket to ≈ 0.35 m over the floor. That number is not a taste
         either: the M249's belly (ammo box under the receiver, bipod feet) is
         0.267 m below its own barrel axis at the drawn scale, so anything less
         buries the box. Every other long gun's belly is shallower, so one
         posture covers the class.
       · FOREARM, UNARMED: flat forward on the deck (φ = −90°), because empty
         hands held up at gun height read as a mime.
     The elbow value is the same subtraction one level down: e = φ2 − a − PITCH.
     Nothing here is per-weapon; the last centimetres — this gun's belly, this
     slope — are the ground-rest solve's job (CBZ.charGunRestAudit). */
  const PRONE_ARM_PITCH = -2.467;      // φ = −60°: shoulder → elbow, elbow on the deck
  const PRONE_FORE_ARMED = -1.362;     // φ2 = −138°: elbow → hand, up to the gun
  const PRONE_FORE_EMPTY = -0.524;     // φ2 = −90°: forearm flat on the ground
  const PRONE_NECK_ARMED = -1.38;      // chin off the chest, eyes over the sights
  const PRONE_NECK_EMPTY = -1.05;      // the shipped head-down crawl

  /* HOW HEAVY THE THING IN THE HANDS IS. The number is the WEAPON's
     (weapon-data.js `hold`), published onto the rig by systems/fpsmode.js
     exactly like `aimLong`; the POSE built from it is this file's. Both read 0
     for anything that declares no `hold`, so every weapon shipped before this
     is posed byte-for-byte as it was. Kept as two one-line readers so the
     three pose branches that consume them cannot drift apart. */
  function heavyHold(ch) {
    if (CBZ.CONFIG && CBZ.CONFIG.CHAR_HEAVY_CARRY === false) return 0;
    const h = ch && ch.aimHeavy;
    return h > 0 ? (h > 1 ? 1 : h) : 0;
  }
  function heavySupport(ch) {
    if (CBZ.CONFIG && CBZ.CONFIG.CHAR_HEAVY_CARRY === false) return 0;
    const s = ch && ch.aimSupport;
    return s > 0 ? (s > 0.5 ? 0.5 : s) : 0;
  }

  // A gait style is a set of MULTIPLIERS on animChar's existing literals.
  // All 1 = the motion this game has always had; nothing here adds a new
  // animation state, so a rig with no style is bit-for-bit unchanged.
  function gaitStyle(o) {
    return {
      step: 1,        // stride length (smaller -> higher cadence for the same speed)
      hipAmp: 1,      // hip swing amplitude
      knee: 1,        // knee flexion amplitude
      stanceKnee: 0,  // ADDED stance-phase knee flexion (toddlers never straighten)
      armAmp: 1,      // arm counter-swing amplitude
      sway: 1,        // lateral body sway (pelvic obliquity)
      yaw: 1,         // shoulder counter-rotation
      bob: 1,         // vertical CoM bob
      guard: 0,       // 0..1 "high guard" toddler arms (raised + out to the sides)
      ...o,
    };
  }

  const GAIT_NEUTRAL = gaitStyle({});

  function profileBase() {
    return {
      key: "m", fem: false, child: false, ageYears: null, band: "adult",
      statureMul: 1,
      // segments
      legUp: LEG_UP, legLo: LEG_LO, legW: 0.34, hipX: 0.23, shoeH: 0.20,
      armUp: ARM_UP, armLo: ARM_LO, armW: 0.30, armX: 0.62, handH: 0.20,
      pelvisW: 0.84, pelvisH: 0.20, pelvisD: 0.48,
      torsoH: 0.95, torsoW: 0.92, torsoD: 0.50,
      waistShare: 0, waistW: 0, waistD: 0,   // waistShare 0 = no waist box at all
      collarW: 0.94, collarH: 0.18, collarD: 0.52,
      headSize: 0.60, neckDrop: 0,
      jacketW: 0.98, jacketH: 1.00, jacketD: 0.60,
      // posture
      stanceZ: 0,      // per-leg z-splay: + converges the knees (narrow step width), - splays (toddler wide base)
      // Idle arm carry, SIGNED: NEGATIVE tucks the hand in against the ribs
      // (the male default — and the literal this rig has always used);
      // POSITIVE swings it clear of the hip. See ADULT_F for why it's a cheat.
      armOutZ: -0.08,
      gait: GAIT_NEUTRAL,
    };
  }

  // ---- ADULT MALE: every number is the literal that used to be inline ----
  const ADULT_M = profileBase();

  // ---- ADULT FEMALE -----------------------------------------------------
  // Shoulders stay narrow (0.85x, as before). Hips come back out to ~0.95x
  // male so shoulder:hip lands at 0.975 (female band) instead of 1.10
  // (male band). A waist box at 0.85x the chest and 0.83x the hips carves
  // the taper. Chest box is DEEPER than male (0.46 vs the old 0.44) and
  // shorter, so the profile carries chest volume without a separate bust
  // mesh that painted clothing would immediately erase.
  const ADULT_F = Object.assign(profileBase(), {
    key: "f", fem: true,
    statureMul: 0.958,                       // ~1.74m beside the male 1.82m
    legUp: 0.465, legLo: 0.455, legW: 0.30, hipX: 0.27,
    armUp: 0.45, armLo: 0.45, armW: 0.26, armX: 0.54,
    pelvisW: 0.80, pelvisH: 0.20, pelvisD: 0.46,
    torsoH: 0.92, torsoW: 0.78, torsoD: 0.46,
    waistShare: 0.325, waistW: 0.66, waistD: 0.40,
    collarW: 0.80, collarH: 0.17, collarD: 0.46,
    headSize: 0.55,
    jacketW: 0.86, jacketH: 0.98, jacketD: 0.56,
    // Step width: male stance sits ~12-15% of hip breadth off the midline,
    // female ~4-8% — the "walks on one line" read (Cho 2004: women walk with a
    // significantly narrower step width). stanceZ converges the knees toward
    // that line.
    stanceZ: 0.055,
    // HONEST NOTE: the folk claim that women carry a wider elbow angle does NOT
    // survive the literature — studies disagree on the direction and one
    // measured men LARGER (14.2° vs 8.2°). This number is therefore a deliberate
    // ART CHEAT, not biomechanics: a wider hip needs the hands to hang clear of
    // it, and that gap between arm and body silhouette is what reads at 30m.
    armOutZ: 0.06,
    /* GAIT (Cho 2004, Clin Biomech 19(2):145-152, 98 adults; Bruening 2015,
       Gait & Posture 41(2)). What the data actually says, which is NOT the
       folklore: cadence is essentially the SAME between sexes at preferred
       speed — women take SHORTER STRIDES, and cadence simply falls out of
       speed/stride, which is exactly how gaitPhaseDelta already works, so
       `step` alone buys the correct quicker footfall. The genuinely
       sex-inherent differences are in the joint pattern: women carry more
       PELVIC obliquity while keeping a MORE STABLE torso and head, and men
       recruit the shoulders and arms more. So sway goes UP while yaw and arm
       swing go DOWN — the earlier guess had the upper body backwards. */
    gait: gaitStyle({ step: 0.86, hipAmp: 0.94, armAmp: 0.88, sway: 1.35, yaw: 0.82 }),
  });

  /* ---- GROWTH CURVE -----------------------------------------------------
     a   age in years
     h   stature as a fraction of the adult rig (CDC/WHO growth charts,
         normalised against a 175.7cm adult male)
     hf  head as a fraction of TOTAL height. NOTE this is not the real-world
         "heads tall" figure: this rig's adult head is already 24% of its
         height (a real adult's is 13%), i.e. the avatar is stylised
         big-headed to start with. Applying the real curve on top would
         make a bobblehead, so hf moves ~55% of the way toward the real
         relative change (real head fraction rises 1.50x from adult to
         toddler; here it rises 1.28x). Direction right, stylisation kept.
     ls  legs' share of (legs + torso), from sitting-height ratio by age
     sw  shoulder width vs adult   hw  hip width vs adult
     gw  limb girth vs adult       bl  belly depth multiplier (toddler pot belly)
     nk  neck development 0..1 (a toddler has no visible neck at all)
     st  step length as a fraction of leg length vs the adult ratio
  ------------------------------------------------------------------------ */
  const GROWTH = [
    { a: 0,    h: 0.30, hf: 0.400, ls: 0.300, sw: 0.32, hw: 0.36, gw: 0.60, bl: 1.35, nk: 0.00, st: 0.55 },
    { a: 1,    h: 0.43, hf: 0.345, ls: 0.365, sw: 0.37, hw: 0.41, gw: 0.66, bl: 1.30, nk: 0.05, st: 0.62 },
    { a: 2.5,  h: 0.53, hf: 0.309, ls: 0.418, sw: 0.45, hw: 0.50, gw: 0.70, bl: 1.24, nk: 0.15, st: 0.72 },
    { a: 4,    h: 0.60, hf: 0.292, ls: 0.440, sw: 0.52, hw: 0.56, gw: 0.73, bl: 1.14, nk: 0.35, st: 0.86 },
    { a: 7,    h: 0.683, hf: 0.275, ls: 0.472, sw: 0.60, hw: 0.62, gw: 0.78, bl: 1.05, nk: 0.62, st: 0.95 },
    { a: 10,   h: 0.780, hf: 0.264, ls: 0.487, sw: 0.68, hw: 0.71, gw: 0.84, bl: 1.00, nk: 0.82, st: 0.98 },
    { a: 12,   h: 0.848, hf: 0.257, ls: 0.498, sw: 0.75, hw: 0.78, gw: 0.88, bl: 1.00, nk: 0.90, st: 1.00 },
    { a: 15,   h: 0.950, hf: 0.250, ls: 0.500, sw: 0.90, hw: 0.90, gw: 0.95, bl: 1.00, nk: 0.97, st: 1.00 },
    { a: 18,   h: 1.000, hf: 0.242, ls: 0.500, sw: 1.00, hw: 1.00, gw: 1.00, bl: 1.00, nk: 1.00, st: 1.00 },
  ];
  const CHILD_ADULT_AGE = 18;

  function growthAt(age) {
    const a = age < 0 ? 0 : age;
    let i = 0;
    while (i < GROWTH.length - 1 && GROWTH[i + 1].a <= a) i++;
    const lo = GROWTH[i], hi = GROWTH[Math.min(i + 1, GROWTH.length - 1)];
    const span = hi.a - lo.a;
    const t = span > 0.0001 ? Math.min(1, Math.max(0, (a - lo.a) / span)) : 0;
    const out = {};
    for (const k in lo) out[k] = lo[k] + (hi[k] - lo[k]) * t;
    return out;
  }

  function bandOf(age) {
    if (age == null || age >= CHILD_ADULT_AGE) return "adult";
    if (age < 1.1) return "baby";
    if (age < 4) return "toddler";
    if (age < 10) return "child";
    if (age < 13) return "preteen";
    return "teen";
  }

  /* Build a child profile at `age`, optionally blended toward an adult
     female shape. Sexual dimorphism does not exist before puberty, so a
     6-year-old girl and boy share one body — the read comes from hair and
     dress, which is exactly how it works in life. From ~11 the female
     deltas (hips, waist, narrower shoulders, Q-angle, gait) fade in. */
  function childProfile(build, age) {
    const G = growthAt(age);
    const fem = build === "f";
    // female shape blends in across 11 -> 16
    const fb = fem ? Math.min(1, Math.max(0, (age - 11) / 5)) : 0;
    const mix = (m, f) => m + (f - m) * fb;

    const total = G.h * ADULT_TOP;
    const headSize = G.hf * total;
    const stack = total - headSize;                 // feet -> neck socket
    const legLen = G.ls * stack;
    const torsoTotal = stack - legLen;

    const p = profileBase();
    p.key = "c" + (Math.round(age * 10) / 10);
    p.child = true; p.fem = fem; p.ageYears = age; p.band = bandOf(age);
    p.statureMul = G.h;

    p.legUp = legLen * 0.505; p.legLo = legLen * 0.495;
    p.legW = mix(0.34, 0.30) * G.gw;
    p.hipX = mix(0.23, 0.27) * G.hw;
    p.shoeH = 0.20 * (0.55 + 0.45 * G.h);           // feet shrink slower than legs

    const armLen = mix(0.92, 0.90) * (0.40 + 0.60 * G.h) * (0.55 + 0.45 * G.ls / 0.5);
    p.armUp = armLen * 0.5; p.armLo = armLen * 0.5;
    p.armW = mix(0.30, 0.26) * G.gw;
    p.armX = mix(0.62, 0.54) * G.sw;
    p.handH = 0.20 * (0.60 + 0.40 * G.h);

    p.pelvisW = mix(0.84, 0.80) * G.hw;
    p.pelvisH = 0.20 * (0.45 + 0.55 * G.h);
    p.pelvisD = mix(0.48, 0.46) * G.hw * (0.85 + 0.15 * G.bl);

    p.torsoW = mix(0.92, 0.78) * G.sw;
    p.torsoD = mix(0.50, 0.46) * G.gw * (0.55 + 0.45 * G.bl);
    // Every child gets a waist box: on a toddler it is the pot belly (wider
    // and much deeper than the chest), on a pre-teen it is the beginning of
    // a real waist. Same two boxes either way — the numbers do the work.
    /* The waist box has to LAND on the adult it is growing into, or a 16-year-
       old boy keeps a pot belly (the child waist is authored WIDER than the
       chest — that is the toddler belly — and adult males have no waist box at
       all). So the childhood share fades into whichever adult this body is
       becoming across roughly 10 -> 18: zero for a man, 0.325 for a woman. */
    const childWaist = 0.30 + 0.14 * Math.max(0, Math.min(1, (5 - age) / 5));
    const adultWaist = fb * ADULT_F.waistShare;          // male adult carries none
    const grown = Math.max(0, Math.min(1, (age - 10) / 8));
    p.waistShare = childWaist + (adultWaist - childWaist) * grown;
    // torsoH is the WHOLE hip→neck column (chest + waist), exactly as it is for
    // the adults above; waistShare then splits it. Keeping one meaning for the
    // field is what lets makeCharacter run a single un-branched stacking pass.
    p.torsoH = torsoTotal;
    p.waistW = p.torsoW * mix(1.02, 0.86) * (0.90 + 0.10 * G.bl);
    p.waistD = p.torsoD * (0.86 + 0.30 * (G.bl - 1)) * mix(1.10, 0.92);

    p.collarW = mix(0.94, 0.80) * G.sw;
    p.collarH = 0.18 * (0.5 + 0.5 * G.h);
    p.collarD = mix(0.52, 0.46) * G.gw;

    p.headSize = headSize;
    // A young child has no neck: the head sits straight on the shoulders.
    p.neckDrop = headSize * 0.17 * (1 - G.nk);

    p.jacketW = p.torsoW + 0.06; p.jacketD = p.torsoD + 0.09;
    p.jacketH = torsoTotal * 1.05;

    // Toddlers walk with a wide base of support that narrows to an adult
    // line by ~3 yrs; the female knee-converge fades in with the hips.
    const splay = -0.13 * Math.max(0, Math.min(1, (3.2 - age) / 2.4));
    p.stanceZ = splay + 0.055 * fb;
    // Small children carry the arms visibly away from the body (the tail end of
    // the toddler high guard); gait.guard below owns the full raised pose.
    p.armOutZ = mix(-0.08, 0.06) + 0.16 * Math.max(0, Math.min(1, (4 - age) / 3));

    // GAIT (Sutherland 1980, "The Development of Mature Gait"): cadence runs
    // ~175 steps/min in a new walker vs ~115 adult, step length is only
    // ~30-35% of leg length at gait onset vs ~48% adult, new walkers never
    // extend the knee through stance, reciprocal arm swing does not appear
    // until ~18 months (before that the arms ride in "high guard"), and
    // trunk sway is pronounced and damps out over the first year of walking.
    // Gait is visually adult-like by ~4 and fully mature by ~7.
    const young = Math.max(0, Math.min(1, (4.5 - age) / 3.5));   // 1 at ~1yr, 0 by 4.5
    const legMul = (p.legUp + p.legLo) / (LEG_UP + LEG_LO);
    p.gait = gaitStyle({
      step: legMul * G.st,
      hipAmp: 1 - 0.18 * young,
      knee: 1 - 0.25 * young,
      stanceKnee: 0.22 * young,
      // fb terms track ADULT_F's corrected direction: as the female shape
      // fades in, arm swing and shoulder counter-rotation go DOWN and pelvic
      // sway goes UP (see the ADULT_F gait note).
      armAmp: (1 - 0.62 * young) * (1 - 0.12 * fb),
      sway: 1 + 0.55 * young + 0.35 * fb,
      yaw: (1 - 0.5 * young) * (1 - 0.18 * fb),
      bob: 1 + 0.25 * young,
      guard: Math.max(0, Math.min(1, (2.0 - age) / 1.2)),
    });
    return p;
  }

  /* ---- PHYSIQUE: a body type is PROPORTIONS, not a scale ------------------
     Owner: body types vary (slim, average, heavy, muscular). Every row is a set
     of multipliers on the profile's own segment numbers plus the shape weights
     the TORSO block reads (pecs, bust, belly, shoulder blades, spine). The arm
     pivot moves out with a wider chest (ax) so a heavy man's arms hang beside
     his ribs instead of inside them. "average" is the identity, and is the SAME
     profile object as before this table existed. */
  const PHYSIQUE = {
    average:  { tw: 1, td: 1, pw: 1, pd: 1, aw: 1, lw: 1, ax: 0, hx: 0, waist: 0.86, pec: 1, bust: 1, belly: 0.22, scap: 1, spine: 1, soft: 0 },
    slim:     { tw: 0.92, td: 0.90, pw: 0.95, pd: 0.92, aw: 1, lw: 1, ax: -0.03, hx: -0.01, waist: 0.82, pec: 0.55, bust: 0.8, belly: 0, scap: 1.35, spine: 1.15, soft: 0 },
    heavy:    { tw: 1.10, td: 1.14, pw: 1.08, pd: 1.10, aw: 1, lw: 1, ax: 0.04, hx: 0.02, waist: 1.03, pec: 0.7, bust: 1.25, belly: 1, scap: 0.3, spine: 0.35, soft: 1 },
    muscular: { tw: 1.08, td: 1.10, pw: 1.00, pd: 1.02, aw: 1, lw: 1, ax: 0.04, hx: 0.01, waist: 0.80, pec: 1.8, bust: 0.85, belly: 0, scap: 1.3, spine: 1.4, soft: 0 },
  };
  const PHYSIQUE_IDS = ["average", "slim", "heavy", "muscular"];
  function applyPhysique(P0, ph) {
    const M = PHYSIQUE[ph];
    // before puberty a body type is half as pronounced, and a child is never "muscular"
    const s = !P0.child ? 1 : (ph === "muscular" ? 0 : (P0.ageYears < 13 ? 0.5 : 0.8));
    const m = (k) => 1 + (M[k] - 1) * s;
    const p = Object.assign({}, P0);
    p.key = P0.key + "~" + ph; p.physique = ph;
    const jw = P0.jacketW - P0.torsoW, jd = P0.jacketD - P0.torsoD;
    p.torsoW = P0.torsoW * m("tw"); p.torsoD = P0.torsoD * m("td");
    if (P0.waistShare > 0) { p.waistW = P0.waistW * m("tw") * (ph === "heavy" ? 1.08 : ph === "muscular" ? 0.94 : 1); p.waistD = P0.waistD * m("td"); }
    p.pelvisW = P0.pelvisW * m("pw"); p.pelvisD = P0.pelvisD * m("pd");
    p.armW = P0.armW * m("aw"); p.legW = P0.legW * m("lw");
    p.armX = P0.armX + M.ax * s * P0.armX / 0.62; p.hipX = P0.hipX + M.hx * s;
    p.collarW = P0.collarW * m("tw"); p.collarD = P0.collarD * m("td");
    p.jacketW = p.torsoW + jw; p.jacketD = p.torsoD + jd;
    return p;
  }

  const profileCache = Object.create(null);
  // CBZ.charProfile(build, age, physique) — the public read. Cached: the crowd
  // asks this per body, and a profile is pure data derived from three values.
  function charProfile(build, age, physique) {
    const b = build === "f" ? "f" : "m";
    let a = (age == null || !isFinite(age)) ? null : +age;
    if (a != null) {
      a = Math.max(0, Math.min(40, a));
      if (a >= CHILD_ADULT_AGE) a = null;
      else a = Math.round(a * 4) / 4;              // quantised: 160 possible child bodies, not infinite
    }
    const ph = PHYSIQUE[physique] && physique !== "average" ? physique : null;
    const key = b + "|" + (a == null ? "A" : a) + (ph ? "|" + ph : "");
    let p = profileCache[key];
    if (p) return p;
    p = a == null ? (b === "f" ? ADULT_F : ADULT_M) : childProfile(b, a);
    if (ph) p = applyPhysique(p, ph);
    profileCache[key] = p;
    return p;
  }
  // c.physique wins; otherwise a stable pick off the look (skin x hair), so a
  // crowd varies and the same person is always the same shape.
  function physiqueOf(c) {
    if (c.physique && PHYSIQUE[c.physique]) return c.physique;
    if (c.age != null && c.age < 16) return "average";       // a child is a child; the look carries it
    const h = hashN((c.skin != null ? c.skin : 0xcf9a72) ^ 0x2f6b1d3, (c.hair != null ? c.hair : 0x4a3526) + (c.build === "f" ? 7 : 0)) % 100;
    return h < 52 ? "average" : h < 72 ? "slim" : h < 88 ? "heavy" : "muscular";
  }

  /* ============================================================
     SHAPED PARTS — A PERSON, NOT A STACK OF CUBES.

     The head was a 0.60 cube with four flat boxes on the front (two 0.13 x
     0.16 black blocks for eyes, a brow bar, a mouth bar), no nose, no ears, no
     jaw, no neck — the chin sat straight on the shoulder yoke. The feet were a
     box cap. Hair was a stack of hard boxes around the cube. At street distance
     that is a robot; up close it is a robot with no face.

     What replaces it, and what it costs:
       · HEAD — one SHARED geometry per (form m/f/c, nose 0-2): a rounded skull
         with a jaw that tapers to the chin, a forehead that slopes back, the
         skull base lifted at the back so a NECK shows under it, plus the nose,
         both ears and the neck column merged in. All skin, so it is still ONE
         mesh with ONE fresh material (reactions.js / gore.js / crowd.js tint
         it). Sized per body by mesh.scale, so pedinstance pools every head of
         a form on one geometry. Its UVs ARE the heritage.js ink atlas (front /
         side / back columns, the neck at the bottom of the atlas) — an inked
         head only gets a `map`; the geometry swaps only between the near
         (socketed) and far (light) skull of the same form — faceLod.
       · EYES / LIDS / MOUTH — see THE FACE below (eyeballs in carved
         sockets, lids that close, lips that part over teeth).
       · BROWS — one mesh, two shaped brows (per eye, arched for f), hair-toned.
       · HAIR — every piece is a ROUNDED box now (one merged shell as before),
         with fringes, a tapered ponytail, a round bun, and three heritage
         textures: afro, curly, locs.
       · BEARDS — one merged mesh per style that follows the tapered jaw.
       · SHOES — one shared unit shoe (sole, heel, a toe that drops and
         narrows), scaled per body. Same slot, same colour, same planted sole.

     Face meshes per body: 2 balls + 2 lid shells + lashes + brow + 2 lips
     (+ the far eye line, hidden up close; + cavity/teeth, hidden while shut).
     Every geometry is cached and shared (see SHAPE); nothing is built per body.
  ============================================================ */
  const SHAPE = Object.create(null);
  function shared(key, build) {
    let g = SHAPE[key];
    if (!g) { g = build(); g._shared = true; SHAPE[key] = g; }
    return g;
  }
  // sm01 (smoothstep) is the hoisted one the swim pose uses, further down.
  const cl01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
  const lerpN = (a, b, t) => a + (b - a) * t;

  /* rbox(w, h, d, r, n, flatBottom) — a rounded box as an indexed
     BufferGeometry (a segmented BoxGeometry whose outer grid row is pushed out
     onto the rounding, so every edge arc actually has vertices on it). n is a
     segment count or [nx, ny, nz]; r is clamped per axis, so r >= half an axis
     turns that axis elliptical (n=2 with r at the half extents is a ball).
     Returns positions only reshaped: its normals are still the BoxGeometry's
     per-face normals (callers read them to pick an atlas column), and
     finishGeo() recomputes smooth ones after any further sculpting. */
  function rbox(w, h, d, r, n, flatBottom, rs) {
    const ns = Array.isArray(n) ? n : [n || 4, n || 4, n || 4];
    const g = new THREE.BoxGeometry(2, 2, 2, ns[0], ns[1], ns[2]);
    const half = [w / 2, h / 2, d / 2];
    const rad = [Math.min(r, half[0]), Math.min(r, half[1]), Math.min(r, half[2])];
    const core = [half[0] - rad[0], half[1] - rad[1], half[2] - rad[2]];
    // rs: rounding segments per side per axis (default 1 for k<=4, else 2) —
    // the near head spends more of its grid on the rounding so the eye socket
    // at the skull's front corner has vertices to carve.
    const fi = ns.map((k, i) => Math.max(0, 1 - 2 * (rs ? rs[i] : (k <= 4 ? 1 : 2)) / k));
    const pos = g.attributes.position;
    const p = [0, 0, 0], q = [0, 0, 0];
    for (let i = 0; i < pos.count; i++) {
      const c = [pos.getX(i), pos.getY(i), pos.getZ(i)];
      for (let a = 0; a < 3; a++) {
        const ac = Math.abs(c[a]), s = c[a] < 0 ? -1 : 1;
        if (flatBottom && a === 1 && c[a] < 0) { p[a] = c[a] * half[a]; q[a] = p[a]; continue; }
        const v = ac <= fi[a] ? (fi[a] > 0 ? ac / fi[a] * core[a] : 0) : core[a] + (ac - fi[a]) / (1 - fi[a]) * rad[a];
        p[a] = s * v;
        q[a] = Math.max(-core[a], Math.min(core[a], p[a]));
      }
      let e = 0;
      for (let a = 0; a < 3; a++) if (rad[a] > 1e-9) { const t = (p[a] - q[a]) / rad[a]; e += t * t; }
      e = Math.sqrt(e);
      if (e > 1e-9) for (let a = 0; a < 3; a++) p[a] = q[a] + (p[a] - q[a]) / e;
      pos.setXYZ(i, p[0], p[1], p[2]);
    }
    return g;
  }
  // per-vertex reshape: fn(v) mutates v = {x, y, z} in place
  const _sv = { x: 0, y: 0, z: 0 };
  function sculpt(g, fn) {
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      _sv.x = pos.getX(i); _sv.y = pos.getY(i); _sv.z = pos.getZ(i);
      fn(_sv);
      pos.setXYZ(i, _sv.x, _sv.y, _sv.z);
    }
    return g;
  }
  /* Smooth normals ACROSS the box's per-face vertex seams (area-weighted,
     welded by position), leaving the seams themselves in place so the atlas
     UVs stay per face. A plain computeVertexNormals would crease every rounded
     edge down its middle. */
  function finishGeo(g) {
    const pos = g.attributes.position, idx = g.index, n = pos.count;
    const key = new Int32Array(n), map = new Map();
    for (let i = 0; i < n; i++) {
      const k = Math.round(pos.getX(i) * 2e4) + "," + Math.round(pos.getY(i) * 2e4) + "," + Math.round(pos.getZ(i) * 2e4);
      let id = map.get(k);
      if (id === undefined) { id = map.size; map.set(k, id); }
      key[i] = id;
    }
    const acc = new Float64Array(map.size * 3);
    const tri = idx ? idx.count : n;
    for (let t = 0; t < tri; t += 3) {
      const a = idx ? idx.getX(t) : t, b = idx ? idx.getX(t + 1) : t + 1, c = idx ? idx.getX(t + 2) : t + 2;
      const ax = pos.getX(a), ay = pos.getY(a), az = pos.getZ(a);
      const ux = pos.getX(b) - ax, uy = pos.getY(b) - ay, uz = pos.getZ(b) - az;
      const vx = pos.getX(c) - ax, vy = pos.getY(c) - ay, vz = pos.getZ(c) - az;
      const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
      for (const v of [a, b, c]) { const o = key[v] * 3; acc[o] += fx; acc[o + 1] += fy; acc[o + 2] += fz; }
    }
    const nrm = g.attributes.normal;
    for (let i = 0; i < n; i++) {
      const o = key[i] * 3, x = acc[o], y = acc[o + 1], z = acc[o + 2];
      const l = Math.sqrt(x * x + y * y + z * z) || 1;
      nrm.setXYZ(i, x / l, y / l, z / l);
    }
    nrm.needsUpdate = true; pos.needsUpdate = true;
    return g;
  }
  function flatUV(g, u, v) {
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u, v);
    return g;
  }
  // Concatenate indexed parts (position/normal/uv) into one indexed geometry.
  // Local, so a page without BufferGeometryUtils still gets a whole head.
  function mergeGeos(parts) {
    let nv = 0, ni = 0;
    for (const p of parts) { nv += p.attributes.position.count; ni += p.index ? p.index.count : p.attributes.position.count; }
    const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), U = new Float32Array(nv * 2);
    const I = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let vo = 0, io = 0;
    for (const p of parts) {
      const pc = p.attributes.position.count;
      for (let i = 0; i < pc; i++) {
        P[(vo + i) * 3] = p.attributes.position.getX(i); P[(vo + i) * 3 + 1] = p.attributes.position.getY(i); P[(vo + i) * 3 + 2] = p.attributes.position.getZ(i);
        N[(vo + i) * 3] = p.attributes.normal.getX(i); N[(vo + i) * 3 + 1] = p.attributes.normal.getY(i); N[(vo + i) * 3 + 2] = p.attributes.normal.getZ(i);
        U[(vo + i) * 2] = p.attributes.uv.getX(i); U[(vo + i) * 2 + 1] = p.attributes.uv.getY(i);
      }
      if (p.index) for (let i = 0; i < p.index.count; i++) I[io++] = p.index.getX(i) + vo;
      else for (let i = 0; i < pc; i++) I[io++] = i + vo;
      vo += pc;
      p.dispose();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(P, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(N, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(U, 2));
    g.setIndex(new THREE.BufferAttribute(I, 1));
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }

  /* ---- THE HEAD ATLAS ----------------------------------------------------
     heritage.js paints head ink into a 128x64 canvas: front [0,64), side
     [64,96) (both sides run front -> back), back [96,128). Atlas y 0 is the
     crown; the HEAD's surface fills y [0, headV] (chin at headV) and the NECK
     fills [headV, 1], so throat script lands on the throat instead of across
     the chin. Top/bottom faces, nose and ears read one plain texel. heritage.js
     reads this record (CBZ.human.headAtlas) to place its marks. */
  const HEAD_ATLAS = { W: 128, H: 64, front: [0, 64], side: [64, 96], back: [96, 128], headV: 0.80,
    // face-space y (0 chin .. 0.60 crown) -> atlas y
    faceY: function (y) { return (1 - y / 0.60) * 0.80; } };
  const PLAIN_U = 100 / 128, PLAIN_V = 1 - 4 / 64;
  function atlasUV(g, y0, y1) {
    const nrm = g.attributes.normal, uv = g.attributes.uv, A = HEAD_ATLAS;
    for (let i = 0; i < uv.count; i++) {
      const nx = nrm.getX(i), ny = nrm.getY(i), nz = nrm.getZ(i);
      if (Math.abs(ny) > 0.5) { uv.setXY(i, PLAIN_U, PLAIN_V); continue; }
      const col = nz > 0.5 ? A.front : nz < -0.5 ? A.back : A.side;
      const u = nx < -0.5 ? 1 - uv.getX(i) : uv.getX(i);
      const ay = y0 + (1 - uv.getY(i)) * (y1 - y0);
      uv.setXY(i, (col[0] + u * (col[1] - col[0])) / A.W, 1 - ay);
    }
    return g;
  }

  /* HEAD FORMS. Authored at the adult 0.60 head, centred on the skull (the
     mesh sits at y = headSize/2 in the neck frame, as the cube did, so every
     getWorldPosition on rig.head still lands on the skull centre).
       jaw    chin width as a share of the skull (the taper that makes a face)
       brow   how far the forehead slopes back above the brows
       round  skull corner radius (children are rounder)
       neck   neck column half-width top/bottom (women slimmer)
       nose/ear  feature scale */
  const HEAD_FORMS = {
    m: { jaw: 0.60, brow: 0.026, round: 0.150, neck: [0.140, 0.158], nose: 1.00, ear: 1.00, chin: 0.012 },
    f: { jaw: 0.52, brow: 0.014, round: 0.165, neck: [0.118, 0.132], nose: 0.84, ear: 0.90, chin: 0.004 },
    c: { jaw: 0.72, brow: 0.004, round: 0.195, neck: [0.132, 0.142], nose: 0.70, ear: 0.95, chin: 0.000 },
  };
  const NOSE_W = [0.070, 0.090, 0.116];          // narrow | medium | broad bridge-to-nostril width
  // The jaw taper, shared by the head and the beards that must hug it.
  // u = face-space height (0 chin .. 0.60 crown), z = depth (+ is the face).
  function jawMul(F, u, z) {
    const front = cl01((z + 0.05) / 0.30);
    const jw = lerpN(1 - (1 - F.jaw) * 0.55, F.jaw, front);   // the back of the jaw tapers less
    return lerpN(jw, 1, sm01(u / 0.32));
  }
  function headForm(P) { return (P.child && (P.ageYears == null || P.ageYears < 12)) ? "c" : (P.fem ? "f" : "m"); }
  /* The skull of form F as a signed distance (face frame: u 0 chin .. 0.60
     crown): headGeometry's sculpt inverted point-wise (no socket/philtrum
     carve). Brows and beards are laid ON this surface instead of floating
     boxes; headwear.js keeps its own copy for hats. */
  function skullSdfF(F, x, u, z) {
    const back = cl01(-z / 0.30), B = back * back;
    if (u < 0.24 && B > 0) u = (u - 0.12 * B) / (1 - 0.5 * B);
    const xx = x / jawMul(F, u, z);
    let zz = z;
    if (zz > 0.1 && u < 0.12) zz -= F.chin * (1 - u / 0.12);
    if (zz > 0) zz += F.brow * sm01((u - 0.40) / 0.20) * cl01(zz / 0.30);
    const b = 0.30 - F.round;
    const qx = Math.abs(xx) - b, qy = Math.abs(u - 0.30) - b, qz = Math.abs(zz) - b;
    const ox = qx > 0 ? qx : 0, oy = qy > 0 ? qy : 0, oz = qz > 0 ? qz : 0;
    return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - F.round;
  }
  // where a ray from o (inside the skull) along unit d leaves it: writes the
  // surface point and its outward normal into out = {p:[3], n:[3]}
  function skullHit(F, o, d, out) {
    let last = 0;
    for (let t = 0.01; t <= 0.72; t += 0.01) if (skullSdfF(F, o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t) < 0) last = t;
    let lo = last, hi = last + 0.01;
    for (let i = 0; i < 14; i++) { const m = (lo + hi) / 2; if (skullSdfF(F, o[0] + d[0] * m, o[1] + d[1] * m, o[2] + d[2] * m) < 0) lo = m; else hi = m; }
    const t = (lo + hi) / 2, p = out.p, n = out.n, e = 0.002;
    p[0] = o[0] + d[0] * t; p[1] = o[1] + d[1] * t; p[2] = o[2] + d[2] * t;
    n[0] = skullSdfF(F, p[0] + e, p[1], p[2]) - skullSdfF(F, p[0] - e, p[1], p[2]);
    n[1] = skullSdfF(F, p[0], p[1] + e, p[2]) - skullSdfF(F, p[0], p[1] - e, p[2]);
    n[2] = skullSdfF(F, p[0], p[1], p[2] + e) - skullSdfF(F, p[0], p[1], p[2] - e);
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    n[0] /= l; n[1] /= l; n[2] /= l;
    return out;
  }
  // a cheap deterministic 1-D value noise in [-1, 1] (edge raggedness, clumps)
  function vnoise(x, seed) {
    const i = Math.floor(x), f = x - i, h = (k) => { const s = Math.sin((k + seed * 17.13) * 127.1) * 43758.5453; return (s - Math.floor(s)) * 2 - 1; };
    const w = f * f * (3 - 2 * f);
    return h(i) + (h(i + 1) - h(i)) * w;
  }
  /* HAIR TEXTURE: one tiny shared canvas per kind, drawn WHITE-ish so the
     material colour (the hair tone) multiplies through.
       brow   strokes along u (inner end -> tail), rising at the inner end,
              ragged alpha at the top/bottom edges (alphaTest cuts them)
       beard  strokes along v (growing down), ragged at both v edges, wraps in u
       stubble opaque: a light base speckled with dark dots (no alpha) */
  const _hairTex = Object.create(null);
  function hairTex(kind) {
    if (kind in _hairTex) return _hairTex[kind];
    let tex = null;
    try {
      if (typeof document !== "undefined" && document.createElement) {
        const S = 64, cv = document.createElement("canvas"); cv.width = cv.height = S;
        const x = cv.getContext && cv.getContext("2d");
        if (x) {
          let seed = kind === "brow" ? 911 : kind === "beard" ? 4271 : 77;
          const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) / 16777216; };
          const grey = (k, a) => { const g = Math.round(255 * k); return "rgba(" + g + "," + g + "," + g + "," + a + ")"; };
          x.clearRect(0, 0, S, S);
          if (kind === "stubble") {
            x.fillStyle = grey(1, 1); x.fillRect(0, 0, S, S);
            for (let i = 0; i < 900; i++) { x.fillStyle = grey(0.35 + rnd() * 0.3, 1); x.fillRect(rnd() * S | 0, rnd() * S | 0, 1, 1); }
          } else {
            // canvas y 0 is texture v 1: the solid core, then strokes that
            // run out past it by a random length (the ragged edge)
            const brow = kind === "brow";
            x.fillStyle = grey(0.82, 1); x.fillRect(0, S * 0.26, S, S * 0.48);
            x.lineWidth = 1.3; x.lineCap = "round";
            for (let i = 0; i < 520; i++) {
              const px = rnd() * S, py = S * (0.06 + rnd() * 0.88);
              const len = 4 + rnd() * 9;
              let ang;
              if (brow) { const t = px / S; ang = -(1.15 - 0.95 * t) + (rnd() - 0.5) * 0.35; }   // steep at the inner end, flat to the tail
              else ang = Math.PI / 2 + (rnd() - 0.5) * 0.5;                                       // hanging down
              const dx = Math.cos(ang) * len, dy = Math.sin(ang) * len;
              x.strokeStyle = grey(0.55 + rnd() * 0.45, 1);
              for (const w of [-S, 0, S]) { x.beginPath(); x.moveTo(px + w, py); x.lineTo(px + w + dx, py + dy); x.stroke(); }
            }
          }
          tex = new THREE.CanvasTexture(cv);
          if (kind !== "brow") tex.wrapS = THREE.RepeatWrapping;
          tex._shared = true;
        }
      }
    } catch (e) { tex = null; }
    return (_hairTex[kind] = tex);
  }
  // brow / beard material: the hair tone over its stroke texture, alpha-tested
  // (stubble opaque). Cached per (tone, kind); plain cmat when there is no canvas.
  const _hairMats = Object.create(null);
  function faceHairMat(hex, kind) {
    const k = hex + "|" + kind;
    if (_hairMats[k]) return _hairMats[k];
    const map = hairTex(kind);
    if (!map) return (_hairMats[k] = cmat(hex));
    const m = new THREE.MeshLambertMaterial({ color: hex, map: map, alphaTest: kind === "stubble" ? 0 : 0.5 });
    m._shared = true;
    return (_hairMats[k] = m);
  }

  /* ==== THE FACE — EYES IN SOCKETS, LIDS THAT CLOSE, A MOUTH THAT OPENS ====
     Owner 2026-09-28: "eyes and mouths much more realistic".

     WHAT IT WAS: two flat white boxes stuck ON the face plane with a textured
     box for an iris sliding across them, a blink that squashed the whole white
     box to a sliver, and a mouth that was one lip-coloured box stretched taller
     to "talk". No lids, no socket, no teeth, no inside of a mouth.

     WHAT IT IS (all geometry SHARED + cached; nothing is built per body):
       · SOCKETS — the near head is a denser skull (headGeometry(.., far=false))
         with an elliptical socket CARVED into it behind each eye. The eyeball
         sits inside the carve, its front flush with the face plane, so the
         brow and cheek stand proud of it and the socket shades.
       · EYEBALL — a real sphere (face.eyeL/eyeR) with one painted texture per
         eye colour: sclera shading darker toward the corners, a few veins, an
         iris with radial fibres and a DARK LIMBAL RING, a pupil and a
         catch-light, on a Phong material so a light gives it a wet specular
         highlight. GAZE ROTATES THE BALL (rotation order YXZ: yaw, then pitch).
       · LIDS — skin-toned spherical shells just outside the ball: ONE mesh for
         both upper lids (face.lidUp, rotation.x closes them), one for both
         lower lids (face.lidLow). Their edges are almond curves that meet at
         the corners (canthal tilt per eye shape), with a margin row tucked back
         to the ball so a lid has thickness. The upper lid carries a dark LASH
         line (face.lashes, its child). Where a shell disappears into the carved
         socket is the lid CREASE. Shell radius: upper < lower, so a closing
         upper lid tucks BEHIND the lower one — closed is closed.
       · MOUTH — two shaped lips (face.mouth = the upper, face.lipLow) lofted
         along the mouth: cupid's bow, a fuller lower lip, corners that sink
         into the face, a philtrum groove carved into the skull above. Closed by
         default. Opening drops the lower lip and shows rig.mouthIn: a dark
         cavity lens and upper/lower teeth, which are HIDDEN whenever the mouth
         is shut. Expressions swap the lip geometry (smile / snarl / grimace /
         fear) and the brow geometry (angry / raised) — a tier change, never a
         per-frame rebuild.
       · FAR TIER — faceLod(rig, false): the head swaps to the light skull, the
         near eyes (balls, lids, lashes) hide, and one merged "eye line" decal
         (faceNodes.farEyes) shows instead. systems/facial.js drives the tier
         off the camera and poses near faces through facePose(); far faces get
         no per-frame work at all.
     Heritage varies it: c.eyeShape (0 round, 1 almond, 2 hooded/monolid),
     c.lips (fuller), c.nose, c.eye (colour). */
  const EYE = { x: 0.14, y: 0.34, front: 0.302 };
  const EYE_R = { m: 0.057, f: 0.059, c: 0.063 };
  function eyeR(form) { return EYE_R[form] || EYE_R.m; }
  // eU/eL: open elevation (rad) of the upper/lower lid edge at the pupil line;
  // tilt: the outer corner's lift; azc: the half-width (azimuth) of the opening
  const EYE_SHAPES = [
    // the painted iris spans +/-0.555 rad: a resting upper lid covers its top
    // a touch and the lower lid just meets its bottom (no staring white ring)
    { eU: 0.48, eL: -0.44, tilt: 0.00, azc: 1.18 },   // 0 round, open
    { eU: 0.42, eL: -0.40, tilt: 0.07, azc: 1.22 },   // 1 almond
    { eU: 0.34, eL: -0.35, tilt: 0.13, azc: 1.26 },   // 2 hooded / monolid
  ];
  function lidShape(si, fk) {
    const S = EYE_SHAPES[si] || EYE_SHAPES[1];
    const b = fk === "f" ? 0.03 : (fk === "c" ? 0.05 : 0);
    return { eU: S.eU + b, eL: S.eL - b * 0.3, tilt: S.tilt, azc: S.azc };
  }
  // how far (rad) the upper lid rotates to meet the lower one, with overlap
  function lidCloseAngle(si, fk) { const S = lidShape(si, fk); return S.eU - S.eL + 0.24; }
  const SOCKET = { ax: 0.084, ayUp: 0.066, ayDn: 0.050, depth: 0.24 };

  /* THE EAR (was a 0.048 x 0.150 x 0.100 rounded box: a slab from the front).
     One closed surface in the ear's own plane (a up, b toward the face, w
     out of the head), lofted in rings from the front centre out to the rim
     and back over the rear face. The front is a relief: the HELIX rolls round
     the top and back, the ANTIHELIX ridge inside it, a CONCHA bowl in front of
     the canal, the TRAGUS bump, a soft LOBE. The plane tilts back (beta) and
     swings out from its front edge (alpha) so the rim stands off the skull
     behind it. headwear.js earSdf mirrors EAR_SPEC; HAIR_EAR boxes it.
     Face frame (u 0 chin .. 0.60 crown), shifted into the head's centred frame. */
  const EAR_SPEC = { x0: 0.290, yc: 0.305, zc: -0.035, H: 0.150, W: 0.100, bf: 0.040, alpha: 0.35, beta: 0.20 };
  function earGeometry(F, s, far) {
    const E = EAR_SPEC, k = F.ear || 1, ea = E.H / 2 * k, eb = E.W / 2 * k;
    const NT = far ? 10 : 16;
    const front = far ? [0, 0.6, 0.86, 1] : [0, 0.28, 0.48, 0.62, 0.74, 0.84, 0.93, 1];
    const backR = far ? [0.8, 0] : [0.9, 0.55, 0];
    const ca = Math.cos(E.alpha), sa = Math.sin(E.alpha), cb = Math.cos(E.beta), sb = Math.sin(E.beta);
    const bf = E.bf * k;
    const rings = front.length + backR.length, P = new Float32Array(rings * NT * 3);
    const g1 = (x, w) => Math.exp(-(x / w) * (x / w));
    const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    // front relief height (w) at polar (rho, th) / local (a, b)
    const relief = function (rho, th, a, b) {
      const T = th < 0 ? th + 2 * Math.PI : th;                                 // 0 front, pi/2 top, pi back, 3pi/2 lobe
      const hW = sm01((T - 0.3) / 0.5) * (1 - sm01((T - 4.1) / 0.55));         // the helix: over the top and down the back
      const aW = sm01((T - 0.9) / 0.5) * (1 - sm01((T - 3.9) / 0.5));
      const lobe = g1(T - 4.75, 0.55) * sm01(rho / 0.5);
      const trag = g1(wrapA(T - 6.0), 0.3) * g1(rho - 0.70, 0.12);
      const conc = g1(Math.hypot((b - 0.15 * eb) / eb, (a + 0.10 * ea) / ea), 0.34);
      if (far) return k * Math.max(0.004, 0.012 + 0.014 * g1(rho - 0.84, 0.12) * hW + 0.008 * lobe - 0.008 * conc);
      return k * Math.max(0.003, 0.013 + 0.019 * g1(rho - 0.84, 0.085) * hW + 0.011 * g1(rho - 0.58, 0.10) * aW
        + 0.010 * lobe + 0.009 * trag - 0.013 * conc);
    };
    let o = 0;
    const put = function (rho, th, w) {
      const c = Math.cos(th), sn = Math.sin(th);
      // the outline: an egg, the lobe narrower and a touch forward, widest up top
      let b = eb * c * (sn < 0 ? 1 - 0.32 * -sn : 1 + 0.06 * sn) + (sn < 0 ? 0.12 * eb * -sn : 0);
      let a = ea * sn;
      b *= rho; a *= rho;
      // tilt back, then swing out about the front edge
      const b1 = b * cb - a * sb, a1 = a * cb + b * sb;
      const db = b1 - bf, db2 = db * ca + w * sa, w2 = -db * sa + w * ca;
      P[o++] = s * (E.x0 + w2); P[o++] = E.yc + a1 - 0.30; P[o++] = E.zc + bf + db2;
    };
    for (let r = 0; r < front.length; r++) for (let j = 0; j < NT; j++) {
      const th = j / NT * 2 * Math.PI, c = Math.cos(th), sn = Math.sin(th);
      const rho = front[r], rr = rho >= 1 ? front[r - 1] : rho;
      const w = relief(rr, th, ea * sn * rr, eb * c * rr);
      put(rho, th, rho >= 1 ? 0.5 * w : w);                                    // the last ring is the rolled edge
    }
    for (let r = 0; r < backR.length; r++) for (let j = 0; j < NT; j++) put(backR[r], j / NT * 2 * Math.PI, backR[r] > 0.85 ? 0.002 * k : 0);
    const I = [];
    for (let r = 0; r < rings - 1; r++) for (let j = 0; j < NT; j++) {
      const a = r * NT + j, b = r * NT + (j + 1) % NT, c = a + NT, d = b + NT;
      I.push(a, b, d, a, d, c);
    }
    // closed surface: flip the winding if its signed volume says it faces in
    let vol = 0;
    for (let t = 0; t < I.length; t += 3) {
      const A = I[t] * 3, B = I[t + 1] * 3, C = I[t + 2] * 3;
      vol += P[A] * (P[B + 1] * P[C + 2] - P[B + 2] * P[C + 1]) - P[A + 1] * (P[B] * P[C + 2] - P[B + 2] * P[C]) + P[A + 2] * (P[B] * P[C + 1] - P[B + 1] * P[C]);
    }
    if (vol < 0) for (let t = 0; t < I.length; t += 3) { const x = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = x; }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(P, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(P.length), 3));
    g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(P.length / 3 * 2), 2));
    g.setIndex(I);
    return flatUV(finishGeo(g), PLAIN_U, PLAIN_V);
  }

  function headGeometry(form, nose, far) {
    const fk = HEAD_FORMS[form] ? form : "m";
    const ni = Math.max(0, Math.min(2, nose | 0));
    return shared("head|" + fk + "|" + ni + (far ? "|far" : "|near"), function () {
      const F = HEAD_FORMS[fk];
      // near: a denser grid with more of it spent on the rounding, so the
      // socket (which straddles the skull's front corner) has vertices to carve
      const skull = far ? rbox(0.60, 0.60, 0.60, F.round, [6, 6, 6])
                        : rbox(0.60, 0.60, 0.60, F.round, [18, 18, 8], false, [4, 4, 2]);
      atlasUV(skull, 0, HEAD_ATLAS.headV);
      sculpt(skull, function (v) {
        let u = v.y + 0.30;
        // the forehead leans back above the brow ridge
        if (v.z > 0) v.z -= F.brow * sm01((u - 0.40) / 0.20) * cl01(v.z / 0.30);
        // the chin juts a touch, the jaw tapers
        if (v.z > 0.1 && u < 0.12) v.z += F.chin * (1 - u / 0.12);
        v.x *= jawMul(F, u, v.z);
        if (!far && v.z > 0.05) {
          // EYE SOCKETS: an elliptical bowl behind each eye, deep enough that
          // the skull is behind the eyeball everywhere the lids leave it open,
          // shallow at the rim so brow and cheek stay where they were
          const dx = Math.abs(v.x) - EYE.x, dy = u - EYE.y;
          const ay = dy > 0 ? SOCKET.ayUp : SOCKET.ayDn;
          const e2 = (dx / SOCKET.ax) * (dx / SOCKET.ax) + (dy / ay) * (dy / ay);
          if (e2 < 1) { const b = 1 - e2; v.z -= SOCKET.depth * b * b; }
          // PHILTRUM: the groove from under the nose to the cupid's bow
          if (u > 0.168 && u < 0.222) {
            const w = Math.sin((u - 0.168) / 0.054 * Math.PI);
            v.z -= 0.007 * Math.exp(-(v.x * v.x) / (0.014 * 0.014)) * w * cl01((v.z - 0.2) / 0.05);
          }
        }
        // the skull base lifts at the back: the neck shows under it
        const back = cl01(-v.z / 0.30);
        if (u < 0.24) u += 0.12 * (1 - u / 0.24) * back * back;
        v.y = u - 0.30;
      });
      finishGeo(skull);
      if (!far) {
        // THE SOCKET RING: the carve spans only a few grid cells, so its pit
        // is steep facets and the smoothed normals of the rim vertices round it
        // face into the pit (down above the eye, up below) — a dark ring the
        // lids read pale against. Shade the socket and its rim with the SMOOTH
        // uncarved skull's normal instead (skullSdfF), keeping 12% of the pit's
        // own so the lid junction holds a slight crease shade.
        const sp = skull.attributes.position, sn = skull.attributes.normal, e = 0.002;
        for (let i = 0; i < sp.count; i++) {
          const x = sp.getX(i), u = sp.getY(i) + 0.30, z = sp.getZ(i);
          if (z < 0.05) continue;
          const dx = Math.abs(x) - EYE.x, dy = u - EYE.y;
          const ay = dy > 0 ? SOCKET.ayUp : SOCKET.ayDn;
          const e2 = (dx / SOCKET.ax) * (dx / SOCKET.ax) + (dy / ay) * (dy / ay);
          if (e2 >= 1.8) continue;
          const w = 0.88 * (1 - sm01((e2 - 1.0) / 0.8));
          // the surface the carve left, at the rim (z pushed out to it)
          const zs = z + (e2 < 1 ? SOCKET.depth * (1 - e2) * (1 - e2) : 0);
          let gx = skullSdfF(F, x + e, u, zs) - skullSdfF(F, x - e, u, zs);
          let gy = skullSdfF(F, x, u + e, zs) - skullSdfF(F, x, u - e, zs);
          let gz = skullSdfF(F, x, u, zs + e) - skullSdfF(F, x, u, zs - e);
          const gl = Math.hypot(gx, gy, gz) || 1;
          const nx = sn.getX(i) * (1 - w) + gx / gl * w, ny = sn.getY(i) * (1 - w) + gy / gl * w, nz = sn.getZ(i) * (1 - w) + gz / gl * w;
          const l = Math.hypot(nx, ny, nz) || 1;
          sn.setXYZ(i, nx / l, ny / l, nz / l);
        }
      }
      const parts = [skull];
      // NOSE — a wedge: narrow bridge between the eyes, the tip and nostrils proud
      const nw = NOSE_W[ni] * F.nose, nh = 0.165 * (fk === "c" ? 0.78 : 1), nd = 0.066 * F.nose + 0.012;
      const nose3 = far ? rbox(nw, nh, nd, 0.018, [2, 3, 1]) : rbox(nw, nh, nd, Math.min(nw * 0.42, nd * 0.48), [4, 6, 3]);
      sculpt(nose3, function (v) {
        const t = cl01((v.y + nh / 2) / nh);              // 0 nostrils .. 1 bridge
        if (far) { v.x *= lerpN(1.08, 0.50, t); if (v.z > 0) v.z -= 0.042 * t * F.nose; return; }
        const hx = cl01(Math.abs(v.x) / (nw / 2));        // 0 centre .. 1 side
        // nostril wings flare at the base, the tip narrows, the bridge is slim
        v.x *= t < 0.28 ? lerpN(1.12, 0.80, t / 0.28) : lerpN(0.80, 0.44, (t - 0.28) / 0.72);
        if (v.z > 0) {
          v.z -= 0.040 * sm01((t - 0.12) / 0.88) * F.nose;                       // a shallow bridge
          v.z += 0.011 * Math.exp(-((t - 0.16) / 0.13) * ((t - 0.16) / 0.13)) * (1 - hx * hx);   // the tip
          if (t < 0.36) v.z -= 0.024 * hx * hx * (1 - t / 0.36);                // the wings sit back
          if (t < 0.06) v.y += 0.012 * cl01(v.z / (nd / 2));                    // the underside lifts to the lip
        }
      });
      nose3.translate(0, 0.215 + nh / 2 - 0.30, 0.30 + nd / 2 - 0.024);
      flatUV(finishGeo(nose3), PLAIN_U, PLAIN_V);
      parts.push(nose3);
      // EARS — a real ear each side (see earGeometry), inside HAIR_EAR
      for (const s of [-1, 1]) parts.push(earGeometry(F, s, far));
      // NECK — a real column from inside the body up into the skull: the
      // sternocleidomastoids, the notch, an Adam's apple (see THE NECK COLUMN)
      parts.push(neckColumnGeometry(F, fk, far));
      const g = mergeGeos(parts);
      // THE SKULL'S BOX ENVELOPE, in geometry units. systems/wounds.js seats
      // head decals on (and measures hits against) `geometry.parameters` as a
      // box, and warlord/outfits.js falls back to parameters.width for the
      // head size. Honest for the skull (0.60 on every axis, centred); the
      // nose/ears/neck poke past it by design. type stays "BufferGeometry",
      // so pedinstance's unit-box proof never mistakes it for a box.
      g.parameters = { width: 0.60, height: 0.60, depth: 0.60 };
      return g;
    });
  }

  /* ---- FACE FEATURE GEOMETRY (face frame: y 0 chin .. 0.60 crown) -------- */
  const MOUTH_REST_Y = 0.16;
  const BROW_REST_Y = 0.448;
  // brow expression: n neutral, a angry/pained (inner ends down), f fear/surprise (inner ends up)
  /* BROWS (were two rounded boxes 3.4 cm deep standing off the forehead). Each
     brow is a thin strip LAID ON the skull (skullHit): thick and a touch
     lifted at the inner head, arching, tapering to a thin tail that wraps
     round the brow ridge; its edges dive just under the skin. UV u runs head
     -> tail, v across, for the stroke texture (faceHairMat "brow"). Built in
     the face frame, shifted so the mesh origin is (0, BROW_REST_Y, 0.303). */
  const BROW_FORM = {
    m: { xi: 0.070, xt: 0.218, y0: 0.424, arch: 0.009, drop: 0.013, wi: 0.032, wt: 0.009, th: 0.0050 },
    f: { xi: 0.078, xt: 0.212, y0: 0.428, arch: 0.017, drop: 0.017, wi: 0.021, wt: 0.005, th: 0.0035 },
    c: { xi: 0.074, xt: 0.205, y0: 0.425, arch: 0.009, drop: 0.010, wi: 0.020, wt: 0.006, th: 0.0035 },
  };
  function browGeometry(form, expr) {
    const fk = form === "f" ? "f" : (form === "c" ? "c" : "m");
    const ek = expr === "a" || expr === "f" ? expr : "n";
    return shared("brow|" + fk + (ek === "n" ? "" : "|" + ek), function () {
      const B = BROW_FORM[fk], F = HEAD_FORMS[fk];
      const NT = 12, NV = 4, P = [], U = [], I = [], hit = { p: [0, 0, 0], n: [0, 0, 0] }, fwd = [0, 0, 1];
      for (const s of [-1, 1]) {
        const base = P.length / 3;
        for (let i = 0; i <= NT; i++) {
          const t = i / NT, inner = (1 - t) * (1 - t);
          let yc = B.y0 + B.arch * sm01(t / 0.62) - B.drop * sm01((t - 0.62) / 0.38);
          let x = B.xi + (B.xt - B.xi) * t, lift = 0;
          if (ek === "a") { yc -= 0.020 * inner - 0.004 * t; x -= 0.006 * inner; lift = 0.004 * inner; }   // knit: down, in, bunched
          else if (ek === "f") yc += 0.016 * inner - 0.003 * t;
          const w = (B.wi + (B.wt - B.wi) * Math.pow(t, 0.9)) * (t < 0.08 ? 0.7 + 0.3 * t / 0.08 : 1);
          for (let j = 0; j <= NV; j++) {
            const v = -1 + 2 * j / NV;
            skullHit(F, [s * x, yc + v * w / 2, 0], fwd, hit);
            const h = j === 0 || j === NV ? -0.0015 : (B.th * (1 - 0.55 * t) + lift) * Math.sqrt(1 - v * v);
            P.push(hit.p[0] + hit.n[0] * h, hit.p[1] + hit.n[1] * h - BROW_REST_Y, hit.p[2] + hit.n[2] * h - 0.303);
            U.push(t, (v + 1) / 2);
          }
        }
        const C = NV + 1;
        for (let i = 0; i < NT; i++) for (let j = 0; j < NV; j++) {
          const a = base + i * C + j, b = a + C;
          windTri(P, I, a, b, b + 1, 0, 0, 1); windTri(P, I, a, b + 1, a + 1, 0, 0, 1);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(P), 3));
      g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(U), 2));
      g.setIndex(I);
      g.computeVertexNormals();
      return g;
    });
  }

  /* EYEBALL: a sphere whose UVs are an azimuthal projection about +z (the
     front) — r_uv = sin(angle/2)/2 — so the painted iris is a disc at the
     texture's centre with most texels spent on the front of the ball. */
  function eyeballGeometry(form) {
    const fk = EYE_R[form] ? form : "m";
    return shared("eyeball|" + fk, function () {
      const R = eyeR(fk);
      const g = new THREE.SphereGeometry(R, 18, 12);
      const pos = g.attributes.position, uv = g.attributes.uv;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i) / R, y = pos.getY(i) / R, z = pos.getZ(i) / R;
        const a = Math.acos(Math.max(-1, Math.min(1, z)));
        const rho = Math.sqrt(x * x + y * y);
        if (rho < 1e-6) { uv.setXY(i, z > 0 ? 0.5 : 1, 0.5); continue; }
        const k = 0.5 * Math.sin(a / 2) / rho;
        uv.setXY(i, 0.5 + x * k, 0.5 + y * k);
      }
      // warlord/outfits.js faceLine reads parameters.height as the eye line's
      // height: give it the open aperture, not the ball
      g.parameters = Object.assign({}, g.parameters, { width: 2 * R, height: 0.066, depth: 2 * R });
      return g;
    });
  }
  const _eyeMats = Object.create(null);
  function eyeMat(hex) {
    let m = _eyeMats[hex];
    if (m) return m;
    let map = null;
    try {
      if (typeof document !== "undefined" && document.createElement) {
        const S = 128, C = 64;
        const cv = document.createElement("canvas"); cv.width = cv.height = S;
        const x = cv.getContext && cv.getContext("2d");
        if (x && x.createRadialGradient) {
          const css = (h) => "#" + ("00000" + (h >>> 0).toString(16)).slice(-6);
          const sc = (h, k) => {
            const r = Math.min(255, Math.round(((h >> 16) & 255) * k)), g = Math.min(255, Math.round(((h >> 8) & 255) * k)), b = Math.min(255, Math.round((h & 255) * k));
            return (r << 16) | (g << 8) | b;
          };
          let seed = Math.imul(hex | 0, 2654435761) >>> 0 || 1;
          const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) / 16777216; };
          // SCLERA: bright at the front, shading into the corners (the lids and
          // the socket shadow it), a warm pink at the very edge
          let gr = x.createRadialGradient(C, C, 0, C, C, C);
          gr.addColorStop(0, "#f3efe7"); gr.addColorStop(0.42, "#ece6dc");
          gr.addColorStop(0.70, "#d6cabd"); gr.addColorStop(1, "#a88d82");
          x.fillStyle = gr; x.fillRect(0, 0, S, S);
          // a few fine veins from the corners
          x.lineWidth = 0.8;
          for (let i = 0; i < 9; i++) {
            const a0 = (i < 5 ? Math.PI : 0) + (rnd() - 0.5) * 1.1;
            let r = 58, a = a0;
            x.strokeStyle = "rgba(176,70,64," + (0.16 + rnd() * 0.14).toFixed(2) + ")";
            x.beginPath(); x.moveTo(C + Math.cos(a) * r, C + Math.sin(a) * r);
            while (r > 30) { r -= 5; a += (rnd() - 0.5) * 0.18; x.lineTo(C + Math.cos(a) * r, C + Math.sin(a) * r); }
            x.stroke();
          }
          // IRIS: lighter round the pupil, the colour, darker to the rim
          const rI = 17.5, rP = 6.0;
          gr = x.createRadialGradient(C, C, rP, C, C, rI);
          gr.addColorStop(0, css(sc(hex, 1.45))); gr.addColorStop(0.45, css(sc(hex, 1.1)));
          gr.addColorStop(0.85, css(sc(hex, 0.85))); gr.addColorStop(1, css(sc(hex, 0.6)));
          x.fillStyle = gr; x.beginPath(); x.arc(C, C, rI, 0, 6.2832); x.fill();
          // radial fibres
          x.lineWidth = 0.9;
          for (let i = 0; i < 44; i++) {
            const a = i / 44 * 6.2832 + rnd() * 0.1;
            x.strokeStyle = i & 1 ? "rgba(255,255,255," + (0.08 + rnd() * 0.12).toFixed(2) + ")" : "rgba(0,0,0," + (0.10 + rnd() * 0.14).toFixed(2) + ")";
            x.beginPath(); x.moveTo(C + Math.cos(a) * (rP + 1), C + Math.sin(a) * (rP + 1));
            const re = rI - 2.5 - rnd() * 3;
            x.lineTo(C + Math.cos(a) * re, C + Math.sin(a) * re); x.stroke();
          }
          // the LIMBAL RING: the dark outline that makes an iris read at distance
          x.strokeStyle = css(sc(hex, 0.28)); x.lineWidth = 2.8;
          x.beginPath(); x.arc(C, C, rI - 1.3, 0, 6.2832); x.stroke();
          // pupil
          x.fillStyle = "#050404"; x.beginPath(); x.arc(C, C, rP, 0, 6.2832); x.fill();
          // catch-light (upper left as you look at the face) + a faint second
          x.fillStyle = "rgba(255,255,255,0.92)"; x.beginPath(); x.arc(C - 4.6, C - 5.2, 2.3, 0, 6.2832); x.fill();
          x.fillStyle = "rgba(255,255,255,0.45)"; x.beginPath(); x.arc(C + 3.8, C + 3.4, 1.1, 0, 6.2832); x.fill();
          map = new THREE.CanvasTexture(cv);
          map._shared = true;
        }
      }
    } catch (e) { map = null; }
    // Phong: the specular highlight off a light is the WET look of a real eye
    m = new THREE.MeshPhongMaterial({ color: map ? 0xffffff : 0xe6e0d4, map: map, specular: 0x3c3c3c, shininess: 80 });
    m._shared = true;
    _eyeMats[hex] = m;
    return m;
  }

  /* LIDS. A lid edge is an almond: at the pupil line it sits at the shape's
     eU / eL elevation, and toward the corners both edges converge on a
     midline that the canthal tilt lifts at the outer corner (o > 0). Past the
     corner the two shells overlap (upper under lower), so no sliver of white
     ever shows at a corner. */
  function lidEdge(kind, S, az, s) {
    const o = az * s;                                           // + toward the OUTER corner
    const q = Math.min(1, Math.abs(az) / S.azc);
    const env = Math.pow(1 - q * q, 0.75);
    const mid = 0.03 + S.tilt * Math.max(-1, Math.min(1, o / S.azc));
    return kind === "U" ? mid + (S.eU - mid) * env - (1 - env) * 0.07
                        : mid + (S.eL - mid) * env + (1 - env) * 0.03;
  }
  function gridGeo(P, I) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(P), 3));
    g.setIndex(I);
    g.computeVertexNormals();
    g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(P.length / 3 * 2).fill(0.5), 2));
    return g;
  }
  // wind triangle (a,b,c) so its normal agrees with test vector (tx,ty,tz)
  function windTri(P, I, a, b, c, tx, ty, tz) {
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
    const ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az;
    const vx = P[c * 3] - ax, vy = P[c * 3 + 1] - ay, vz = P[c * 3 + 2] - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * tx + ny * ty + nz * tz >= 0) I.push(a, b, c); else I.push(a, c, b);
  }
  // one upper ("U") or lower ("L") lid pair, in the lid mesh's frame (origin on
  // the eyes' shared centre line: x 0, y EYE.y, z = eyeball centre)
  function lidGeometry(kind, shape, form) {
    const fk = EYE_R[form] ? form : "m";
    const si = Math.max(0, Math.min(2, shape | 0));
    return shared("lid|" + kind + "|" + si + "|" + fk, function () {
      const S = lidShape(si, fk), R = eyeR(fk);
      const up = kind === "U";
      const rad = R * (up ? 1.04 : 1.065), rim = R * 1.01;
      /* Parameterised about the X axis (the axis the lid ROTATES about): th
         is the angle up from forward in the y-z plane, ph the angle out to the
         side (the poles sit at the eye's corners, buried in the socket). So a
         blink is a pure shift in th, and "closed" is exactly "the upper edge
         has passed the lower edge" at every ph. */
      const NA = 22, NE = 8, PHM = 1.45, TOP = 2.6;
      const parts = [];
      for (const s of [-1, 1]) {
        const P = [], I = [], A = [], E = [];
        for (let i = 0; i <= NA; i++) {
          const ph = -PHM + 2 * PHM * i / NA;
          const e0 = lidEdge(kind, S, ph, s);
          for (let j = -1; j <= NE; j++) {                     // row -1 = the lid margin
            const t = j < 0 ? 0 : Math.pow(j / NE, 1.5);
            const th = up ? e0 + t * (TOP - e0) : e0 - t * (TOP + e0);
            const r = j < 0 ? rim : rad, cp = Math.cos(ph);
            P.push(s * EYE.x + r * Math.sin(ph), r * cp * Math.sin(th), r * cp * Math.cos(th));
            A.push(ph); E.push(th);
          }
        }
        const C = NE + 2;
        for (let i = 0; i < NA; i++) for (let c = 0; c < C - 1; c++) {
          const a = i * C + c, b = (i + 1) * C + c, d = a + 1, e = b + 1;
          let tx, ty, tz;
          const ph = A[a], th = E[a];
          if (c === 0) {
            // the margin faces out of the opening: down for the upper lid, up for the lower
            const k = up ? -1 : 1;
            tx = 0; ty = k * Math.cos(th); tz = k * -Math.sin(th);
          } else { const cp = Math.cos(ph); tx = Math.sin(ph); ty = cp * Math.sin(th); tz = cp * Math.cos(th); }
          windTri(P, I, a, b, e, tx, ty, tz);
          windTri(P, I, a, e, d, tx, ty, tz);
        }
        parts.push(gridGeo(P, I));
      }
      /* THE PALE RING was the lid's own normals: a sphere's, so the open upper
         lid faced UP (0.4-0.9 rad) and caught the sun while the socket rim and
         brow beside it face forward/down — a bright band round every eye (and
         a dark one under it). Tip the shading normals toward the face plane
         (upper down, lower up) so the lid lights like the skin it meets; the
         silhouette stays the sphere's. It also wears the head's own material
         (see the build) and its plain atlas texel. */
      const g = mergeGeos(parts), nrm = g.attributes.normal, dl = up ? 0.55 : -0.50;
      const cd = Math.cos(dl), sd = Math.sin(dl);
      for (let i = 0; i < nrm.count; i++) {
        const ny = nrm.getY(i), nz = nrm.getZ(i);
        nrm.setXYZ(i, nrm.getX(i) * 0.85, ny * cd - nz * sd, nz * cd + ny * sd);
      }
      for (let i = 0; i < nrm.count; i++) { const x = nrm.getX(i), y = nrm.getY(i), z = nrm.getZ(i), l = Math.hypot(x, y, z) || 1; nrm.setXYZ(i, x / l, y / l, z / l); }
      return flatUV(g, PLAIN_U, PLAIN_V);
    });
  }
  // the upper lash line: a dark band along the upper lid's edge that flares
  // out and down a touch (child of the upper lid, so it closes with it)
  function lashGeometry(shape, form) {
    const fk = EYE_R[form] ? form : "m";
    const si = Math.max(0, Math.min(2, shape | 0));
    return shared("lash|" + si + "|" + fk, function () {
      const S = lidShape(si, fk), R = eyeR(fk), rad = R * 1.04;
      const NA = 14, parts = [];
      for (const s of [-1, 1]) {
        const P = [], I = [], A = [], E = [];
        const azm = S.azc * 1.02;
        for (let i = 0; i <= NA; i++) {
          const ph = -azm + 2 * azm * i / NA;
          const e0 = lidEdge("U", S, ph, s);
          const q = Math.min(1, Math.abs(ph) / S.azc), w = 0.3 + 0.7 * Math.sqrt(Math.max(0, 1 - q * q));
          const rows = [[e0 + 0.05 * w, rad * 1.004], [e0 - 0.055 * w, rad * (1 + 0.075 * w)]];
          for (let k = 0; k < 2; k++) {
            const th = rows[k][0], r = rows[k][1], cp = Math.cos(ph);
            P.push(s * EYE.x + r * Math.sin(ph), r * cp * Math.sin(th), r * cp * Math.cos(th));
            A.push(ph); E.push(th);
          }
        }
        for (let i = 0; i < NA; i++) {
          const a = i * 2, b = a + 2, d = a + 1, e = b + 1;
          const ph = A[a], th = E[a], cp = Math.cos(ph);
          const tx = Math.sin(ph), ty = cp * Math.sin(th), tz = cp * Math.cos(th);
          windTri(P, I, a, b, e, tx, ty, tz); windTri(P, I, a, e, d, tx, ty, tz);
        }
        parts.push(gridGeo(P, I));
      }
      return mergeGeos(parts);
    });
  }
  // FAR TIER: both eyes as one flat almond decal on the light skull
  function farEyeGeometry() {
    return shared("farEyes", function () {
      const P = [], I = [], U = [], NX = 8, hw = 0.062;
      for (const s of [-1, 1]) {
        const base = P.length / 3;
        for (let i = 0; i <= NX; i++) {
          const t = i / NX, xx = (t - 0.5) * 2 * hw, env = Math.pow(Math.max(0, 1 - (2 * t - 1) * (2 * t - 1)), 0.7);
          P.push(s * EYE.x + xx, EYE.y + 0.028 * env, 0.304); U.push(t, 1);
          P.push(s * EYE.x + xx, EYE.y - 0.022 * env, 0.304); U.push(t, 0);
        }
        for (let i = 0; i < NX; i++) { const a = base + i * 2; windTri(P, I, a, a + 1, a + 3, 0, 0, 1); windTri(P, I, a, a + 3, a + 2, 0, 0, 1); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(P), 3));
      g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(U), 2));
      g.setIndex(I);
      g.computeVertexNormals();
      return g;
    });
  }
  let _farEyeMat = null;
  function farEyeMat() {
    if (_farEyeMat) return _farEyeMat;
    let map = null;
    try {
      if (typeof document !== "undefined" && document.createElement) {
        const cv = document.createElement("canvas"); cv.width = 32; cv.height = 16;
        const x = cv.getContext && cv.getContext("2d");
        if (x) {
          x.fillStyle = "#d9d1c4"; x.fillRect(0, 0, 32, 16);
          x.fillStyle = "#24170f"; x.beginPath(); x.arc(16, 8, 5, 0, 6.2832); x.fill();
          x.fillStyle = "#1a1210"; x.fillRect(0, 0, 32, 3);           // the lash line
          map = new THREE.CanvasTexture(cv); map._shared = true;
        }
      }
    } catch (e) { map = null; }
    _farEyeMat = new THREE.MeshLambertMaterial({ color: map ? 0xffffff : 0x9a8f84, map: map });
    _farEyeMat._shared = true;
    return _farEyeMat;
  }

  /* LIPS. Lofted along the mouth (t -1..1 corner to corner), each section a
     half-roll from the SEAM (phi 0) round the proud front to the vermilion
     BORDER (phi pi). The back is buried in the skull; the corners sink into it
     (that is what makes a corner). Expressions bend the seam: smile lifts the
     corners, snarl raises one side of the upper lip off the teeth, grimace
     stretches both lips thin and wide, fear pulls the corners down and back. */
  const LIP_EXPR = {
    n:       { lift: 0,      wide: 1.00, tU: 1.00, tL: 1.00, sn: 0,     back: 0 },
    smile:   { lift: 0.020,  wide: 1.10, tU: 0.85, tL: 0.82, sn: 0,     back: 0.002 },
    snarl:   { lift: -0.004, wide: 1.04, tU: 1.00, tL: 0.95, sn: 0.016, back: 0 },
    grimace: { lift: -0.008, wide: 1.16, tU: 0.68, tL: 0.68, sn: 0.004, back: 0.004 },
    fear:    { lift: -0.010, wide: 1.08, tU: 0.85, tL: 0.90, sn: 0,     back: 0.002 },
  };
  const LIP_W = 0.160, LIP_HU = 0.026, LIP_HL = 0.031, LIP_Z = 0.296;
  const TEETH_W = 0.100, TEETH_H = 0.014, TEETH_Z = 0.3085, CAVITY_Z = 0.3025;
  function lipGeometry(which, expr) {
    const ek = LIP_EXPR[expr] ? expr : "n", E = LIP_EXPR[ek], up = which === "U";
    return shared("lip|" + (up ? "U" : "L") + "|" + ek, function () {
      const H = up ? LIP_HU * E.tU : LIP_HL * E.tL;
      const NX = 16, NP = 6, P = [], I = [], YC = [];
      for (let i = 0; i <= NX; i++) {
        const t = -1 + 2 * i / NX, a = Math.abs(t);
        const h = up ? H * (0.22 + 0.78 * Math.pow(Math.max(0, 1 - Math.pow(a, 2.2)), 0.6))
                     : H * (0.18 + 0.82 * Math.pow(Math.max(0, 1 - a * a), 0.8));
        const dz = (up ? 0.020 : 0.023) * (0.35 + 0.65 * Math.pow(Math.max(0, 1 - a * a), 0.6));
        const zc = LIP_Z - 0.014 * a * a - E.back;
        let seam = E.lift * t * t;
        if (up) seam += E.sn * Math.exp(-((t - 0.3) / 0.32) * ((t - 0.3) / 0.32));
        // cupid's bow: a dip at the middle of the upper border, peaks either side
        const bow = up ? (-0.006 * Math.exp(-(t / 0.10) * (t / 0.10)) + 0.003 * Math.exp(-((a - 0.24) / 0.10) * ((a - 0.24) / 0.10))) : 0;
        const x = t * LIP_W / 2 * E.wide;
        const yc = up ? seam + h / 2 : seam - h / 2;
        YC.push(yc, zc);
        // row -1: the lip rolls IN past the seam (behind the other lip), so a
        // shut mouth has no crack to see skin through and an open one shows a
        // lip with thickness
        P.push(x, seam + (up ? -0.0014 : 0.0014), zc - 0.006);
        for (let j = 0; j <= NP; j++) {
          const ph = Math.PI * j / NP, cp = Math.cos(ph);
          const y = up ? seam + h / 2 - (h / 2) * cp + bow * (1 - cp) / 2
                       : seam - h / 2 + (h / 2) * cp;
          // proud at the seam (the lips press together in FRONT of the skin),
          // fullest past the middle, buried at the vermilion border
          const sp = ph < Math.PI / 2 ? 0.85 + 0.15 * Math.sin(ph) : Math.sin(ph);
          // the lower lip's fullest point sits a little below its middle
          P.push(x, y, zc + dz * sp * (up ? 1 : (1 + 0.15 * Math.sin(ph * 1.5))));
        }
      }
      const C = NP + 2;
      for (let i = 0; i < NX; i++) for (let j = 0; j < C - 1; j++) {
        const a = i * C + j, b = (i + 1) * C + j, d = a + 1, e = b + 1;
        // outward: away from the section's centre; the in-roll faces the other lip
        let ty = P[a * 3 + 1] + P[d * 3 + 1] - 2 * YC[i * 2], tz = P[a * 3 + 2] + P[d * 3 + 2] - 2 * YC[i * 2 + 1];
        if (j === 0) { ty = up ? -1 : 1; tz = 0; }
        windTri(P, I, a, b, e, 0, ty, tz); windTri(P, I, a, e, d, 0, ty, tz);
      }
      const g = gridGeo(P, I);
      // warlord/outfits.js faceLine reads top = position.y + height/2: the
      // envelope is symmetric about the seam, so the top lands on the border
      g.parameters = { width: LIP_W * E.wide, height: 2 * (H + 0.004), depth: 0.03 };
      return g;
    });
  }
  // the inside of an open mouth: a unit lens (pointed at the corners), scaled
  // per frame to the gap by facePose
  function cavityGeometry() {
    return shared("mouthCavity", function () {
      const P = [], I = [], NX = 12;
      for (let i = 0; i <= NX; i++) {
        const x = -0.5 + i / NX, env = Math.sqrt(Math.max(0, 1 - 4 * x * x));
        P.push(x, 0.5 * env, 0, x, -0.5 * env, 0);
      }
      for (let i = 0; i < NX; i++) { const a = i * 2; windTri(P, I, a, a + 1, a + 3, 0, 0, 1); windTri(P, I, a, a + 3, a + 2, 0, 0, 1); }
      return gridGeo(P, I);
    });
  }
  // a row of teeth, curving back round the arch: "U" hangs down from y 0, "L" stands up
  function teethGeometry(which) {
    const up = which === "U";
    return shared("teeth|" + (up ? "U" : "L"), function () {
      const P = [], I = [], NX = 10;
      for (let i = 0; i <= NX; i++) {
        const t = -1 + 2 * i / NX, x = t * TEETH_W / 2, z = -0.006 * t * t;
        const h = TEETH_H * (1 - 0.35 * t * t);
        P.push(x, 0, z + 0.002, x, up ? -h : h, z);
      }
      for (let i = 0; i < NX; i++) {
        const a = i * 2;
        windTri(P, I, a, a + 1, a + 3, 0, 0, 1); windTri(P, I, a, a + 3, a + 2, 0, 0, 1);
      }
      return gridGeo(P, I);
    });
  }
  const LASH = 0x17110e, TEETH = 0xe2dac8, CAVITY = 0x2a0e0d;
  function defaultEyeShape(skin, hair) { const h = hashN(skin ^ 0x5bd1e995, hair) % 10; return h < 3 ? 0 : (h < 8 ? 1 : 2); }

  /* THE FACE'S POSE — the ONE writer of every face transform (facial.js calls
     it; tools/face-check.mjs proves it). p:
       blink 0..1 (1 = shut)    lidU  rad, + lowers the upper lid (squint), - widens
       lidL  rad, + raises the lower lid        yaw / pitch  gaze (rad, + left / up)
       open  lip gap in face units (0 = closed) mouth  n|smile|snarl|grimace|fear
       brow  n|a|f                              browY  brow lift (face units) */
  const REST_POSE = { blink: 0, lidU: 0, lidL: 0, yaw: 0, pitch: 0, open: 0, mouth: "n", brow: "n", browY: 0 };
  function facePose(rig, p) {
    const f = rig && rig.face, R = rig && rig.faceRest, M = rig && rig.mouthIn;
    if (!f || !R || !R.v2 || !f.lidUp) return false;
    p = p || REST_POSE;
    const yaw = Math.max(-0.55, Math.min(0.55, p.yaw || 0)), pitch = Math.max(-0.38, Math.min(0.38, p.pitch || 0));
    const verge = p.verge || 0;
    f.eyeL.rotation.set(-pitch, yaw + verge, 0);
    f.eyeR.rotation.set(-pitch, yaw - verge, 0);
    const bl = Math.max(0, Math.min(1, p.blink || 0));
    const upOpen = Math.min(R.lidClose, (p.lidU || 0) - pitch * 0.55);
    f.lidUp.rotation.x = upOpen + (R.lidClose - upOpen) * bl;
    f.lidLow.rotation.x = -(p.lidL || 0) - pitch * 0.22 - bl * 0.12;
    // mouth
    const ek = LIP_EXPR[p.mouth] ? p.mouth : "n", E = LIP_EXPR[ek];
    if (R.lipExpr !== ek) { R.lipExpr = ek; f.mouth.geometry = lipGeometry("U", ek); f.lipLow.geometry = lipGeometry("L", ek); }
    const gap = Math.max(0, Math.min(0.055, p.open || 0));
    const top = R.mouthY + gap * 0.12, bot = R.mouthY - gap * 0.88;
    f.mouth.position.y = top; f.lipLow.position.y = bot;
    if (M) {
      const show = gap > 0.0015 || E.sn > 0;
      if (M.cavity.visible !== show) M.cavity.visible = show;
      if (M.teethUp.visible !== show) M.teethUp.visible = show;
      const lowT = show && gap > 0.005;
      if (M.teethLow.visible !== lowT) M.teethLow.visible = lowT;
      if (show) {
        const sx = R.lipSx * E.wide, hTop = top + E.sn * R.lipSy;
        M.cavity.scale.set(LIP_W * 0.86 * sx, (hTop - bot) + 0.014, 1);
        M.cavity.position.set(0, (hTop + bot) / 2, CAVITY_Z);
        M.teethUp.scale.x = sx * 0.95; M.teethUp.position.set(0, R.mouthY + 0.004, TEETH_Z);
        M.teethLow.scale.x = sx * 0.86; M.teethLow.position.set(0, bot - 0.004, TEETH_Z - 0.002);
      }
    }
    // brow
    const bk = p.brow === "a" || p.brow === "f" ? p.brow : "n";
    if (R.browExpr !== bk) { R.browExpr = bk; f.brow.geometry = browGeometry(R.form, bk); }
    f.brow.position.y = R.browY + (p.browY || 0);
    return true;
  }
  /* The tier. near: the socketed head + real eyes; far: the light head + the
     eye-line decal, face at rest. Only ever called on a CHANGE. */
  function faceLod(rig, near) {
    const R = rig && rig.faceRest, N = rig && rig.faceNodes;
    if (!R || !N || !R.v2) return false;
    near = !!near;
    if (R.near === near) return false;
    R.near = near;
    N.near.visible = near; N.far.visible = !near;
    if (rig.head && rig.head.geometry && rig.head.geometry._shared) rig.head.geometry = headGeometry(R.form, R.nose, !near);
    if (!near) facePose(rig, REST_POSE);
    return true;
  }
  /* BEARDS. Full / stubble / goatee were rounded boxes squeezed by jawMul — a
     crate round the jaw with a flat top edge. Now each is a SHELL laid on the
     skull (skullHit): columns fan round the jaw from a point inside the head,
     each running from the neckline under the chin (just ahead of the neck
     column) up to the cheek line, which sweeps from under the lower lip past
     the mouth corner up to the sideburn in front of the ear. Both edges are
     jittered (vnoise) and the stroke texture's alpha rags them further; the
     thickness swells at the chin, thins up the cheek and dives under the skin
     at every edge, with clumpy variation. The moustache is still the shaped
     rbox. One merged mesh per (style, form). */
  const lerpKnots = (K, x) => {
    if (x <= K[0][0]) return K[0][1];
    for (let i = 1; i < K.length; i++) if (x <= K[i][0]) return lerpN(K[i - 1][1], K[i][1], (x - K[i - 1][0]) / (K[i][0] - K[i - 1][0]));
    return K[K.length - 1][1];
  };
  const BEARD_SHELLS = {
    full: { phi: 1.46, NP: 28, NS: 10, top: [[0, 0.116], [0.26, 0.122], [0.40, 0.150], [0.58, 0.188], [0.85, 0.214], [1.15, 0.248], [1.46, 0.335]],
            thick: [[0, 0.030], [0.5, 0.024], [1.0, 0.014], [1.46, 0.007]] },
    stubble: { phi: 1.46, NP: 22, NS: 7, top: [[0, 0.118], [0.26, 0.124], [0.40, 0.152], [0.58, 0.190], [0.85, 0.214], [1.15, 0.244], [1.46, 0.320]],
               thick: [[0, 0.0024]], flat: true },
    goatee: { phi: 0.36, NP: 8, NS: 8, top: [[0, 0.116], [0.2, 0.120], [0.36, 0.130]], thick: [[0, 0.022], [0.36, 0.012]] },
  };
  function beardShell(F, S, seed) {
    const C = [0, 0.22, 0.02], NK = 64, hit = { p: [0, 0, 0], n: [0, 0, 0] };
    const rN = F.neck[1] * 0.925;
    const P = [], N = [], U = [], I = [], d = [0, 0, 0];
    for (let i = 0; i <= S.NP; i++) {
      const phi = -S.phi + 2 * S.phi * i / S.NP, ap = Math.abs(phi);
      const top = lerpKnots(S.top, ap) + 0.006 * vnoise(phi * 9, seed);
      const clear = 0.012 + 0.005 * vnoise(phi * 7, seed + 3);
      // walk up the column: the skin path from the neckline to the cheek line
      const path = [];
      for (let k = 0; k < NK; k++) {
        const th = -1.52 + 2.3 * k / (NK - 1), ct = Math.cos(th);
        d[0] = Math.sin(phi) * ct; d[1] = Math.sin(th); d[2] = Math.cos(phi) * ct;
        skullHit(F, C, d, hit);
        const p = hit.p, dn = Math.hypot(p[0], (p[2] + 0.024) / 0.94) - rN;
        if (!path.length && dn < clear) continue;
        if (p[1] > top) {
          const q = path[path.length - 1];
          if (q) { const f = (top - q[1]) / (p[1] - q[1]); path.push([q[0] + (p[0] - q[0]) * f, top, q[2] + (p[2] - q[2]) * f, hit.n[0], hit.n[1], hit.n[2]]); }
          break;
        }
        path.push([p[0], p[1], p[2], hit.n[0], hit.n[1], hit.n[2]]);
      }
      const L = [0];
      for (let k = 1; k < path.length; k++) L.push(L[k - 1] + Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1], path[k][2] - path[k - 1][2]));
      const tot = L[L.length - 1] || 1e-6;
      const side = 0.35 + 0.65 * sm01((S.phi - ap) / 0.15);
      for (let j = 0; j <= S.NS; j++) {
        const s = j / S.NS, want = s * tot;
        let k = 1; while (k < path.length - 1 && L[k] < want) k++;
        const a = path[Math.max(0, k - 1)], b = path[Math.min(k, path.length - 1)];
        const f = b === a ? 0 : cl01((want - L[k - 1]) / ((L[k] - L[k - 1]) || 1e-6));
        const px = lerpN(a[0], b[0], f), py = lerpN(a[1], b[1], f), pz = lerpN(a[2], b[2], f);
        let nx = lerpN(a[3], b[3], f), ny = lerpN(a[4], b[4], f), nz = lerpN(a[5], b[5], f);
        const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
        const prof = S.flat ? 1 : sm01(s / 0.10) * (1 - 0.82 * sm01((s - 0.30) / 0.70));
        const h = (j === 0 || j === S.NS) ? -0.0015
          : lerpKnots(S.thick, ap) * prof * side * (1 + 0.18 * vnoise(phi * 14 + s * 5, seed + 1));
        P.push(px + nx * h, py + ny * h, pz + nz * h); N.push(nx, ny, nz);
        U.push((phi + S.phi) * 1.3, s);
      }
    }
    const C2 = S.NS + 1;
    for (let i = 0; i < S.NP; i++) for (let j = 0; j < S.NS; j++) {
      const a = i * C2 + j, b = a + C2;
      windTri(P, I, a, b, b + 1, N[a * 3], N[a * 3 + 1], N[a * 3 + 2]);
      windTri(P, I, a, b + 1, a + 1, N[a * 3], N[a * 3 + 1], N[a * 3 + 2]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(P), 3));
    g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(U), 2));
    g.setIndex(I);
    g.computeVertexNormals();
    return g;
  }
  function beardGeometry(style, form) {
    const fk = HEAD_FORMS[form] ? form : "m";
    return shared("beard|" + style + "|" + fk, function () {
      const F = HEAD_FORMS[fk];
      const parts = [];
      const put = (g, x, y, z) => { g.translate(x, y, z); parts.push(flatUV(finishGeo(g), 0.5, 0.5)); };
      // a moustache sits ON the skin between nose and upper lip: thick in the
      // middle, thinning and drooping to the mouth corners, wrapped round the face
      const moustache = () => {
        const m = rbox(0.20, 0.034, 0.030, 0.012, [8, 2, 2]);
        sculpt(m, function (v) {
          const t = 2 * v.x / 0.20, t2 = t * t;
          v.y *= 1 - 0.5 * t2;
          v.y -= 0.022 * t2;
          v.z -= 0.028 * t2;
        });
        put(m, 0, 0.203, 0.312);
      };
      if (BEARD_SHELLS[style]) {
        parts.push(beardShell(F, BEARD_SHELLS[style], style.length * 7 + fk.charCodeAt(0)));
        if (style !== "stubble") moustache();
      } else if (style === "moustache") {
        moustache();
      }
      if (!parts.length) moustache();
      return mergeGeos(parts);
    });
  }
  /* ==== THE ANKLE ===========================================================
     A leg used to end in a shoe bolted to the SHIN (no ankle), with the shin
     tube running on inside it down to the sole line — the tube's end dome
     came out through the heel and sole, which is what you saw on a man lying
     with his feet toward you. Now the leg has an ankle: a `foot` group at the
     pivot inside the knee group (leg.userData.foot, rig.feet), the shoe lives
     in it (entities/footwear.js dresses it by role), and the shin is re-baked
     to END inside the shoe (humanSetShinEnd): bare skin at the pivot, a
     trouser leg at the style's hem. animChar's ankle solve (ankleSolve,
     below) poses it. The sole's bottom sits exactly on the floor when the
     leg is straight: hip -> knee is legUp - LIMB_TUCK, knee -> sole is
     legLo + LIMB_TUCK, so hip -> sole = legUp + legLo = hipY. */
  function addFoot(leg, P) {
    const lw = P.legW * 0.9;
    const H = P.shoeH * 0.8 + 0.03;
    const sole = -(P.legLo + LIMB_TUCK);                   // the sole's bottom, knee frame
    const aY = CBZ.footwear ? CBZ.footwear.ANKLE_Y : 0.52;
    const foot = new THREE.Group();
    foot.name = "ankle";
    foot.position.set(0, sole + aY * H, 0);
    foot.userData.dims = { W: lw * 1.06, H: H, D: lw * 1.62, sole: sole };
    foot.userData.flex = [-0.35, 0.7];
    foot.userData.lod = 1;
    leg.userData.low.add(foot);
    leg.userData.foot = foot;
    return foot;
  }
  /* The lower leg ends `len` below the knee (its loft is re-baked; the paint
     band and the box it reports are unchanged). footwear.js calls this so
     the leg always ends INSIDE whatever shoe it wears. */
  function setShinEnd(leg, len) {
    const m = leg && leg.userData && leg.userData.lower, spec = m && m.userData.limb;
    if (!spec || !(len > 0.05)) return;
    if (Math.abs(spec.len - len) < 1e-6) return;
    spec.len = len;
    const flat = m.userData._cbzFlat;
    if (flat && flat.g && flat.g.userData && flat.g.userData.limb) flat.g = limbBake(spec, spec.lod, null);
    if (m.geometry && m.geometry.userData && m.geometry.userData.limb) m.geometry = limbGeometry(m);
  }
  CBZ.humanSetShinEnd = setShinEnd;

  /* ---- DEFAULT FEATURES (pure functions of the colours asked for) ---------
     No RNG lives in this file (see hairStyleFor), so a body built without
     heritage.js's look still gets believable features DETERMINISTICALLY from
     the skin + hair it was given: darker skin -> brown eyes, fairer skin ->
     a spread of hazel/blue/green/grey. */
  const EYE_COLOURS = { brown: 0x4a2c18, dark: 0x2a1a10, hazel: 0x6b5028, green: 0x4d6a3a, blue: 0x4a6f9a, grey: 0x6f7c86, amber: 0x7a5220 };
  function hashN(a, b) { let h = (Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35)) >>> 0; h ^= h >>> 15; return h >>> 0; }
  function lumOf(hex) { return (0.299 * ((hex >> 16) & 255) + 0.587 * ((hex >> 8) & 255) + 0.114 * (hex & 255)) / 255; }
  function mixHex(a, b, t) {
    const ar = a >> 16 & 255, ag = a >> 8 & 255, ab = a & 255, br = b >> 16 & 255, bg = b >> 8 & 255, bb = b & 255;
    return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
  }
  function defaultEye(skin, hair) {
    const L = lumOf(skin), h = hashN(skin, hair) % 100;
    if (L < 0.55) return h < 80 ? EYE_COLOURS.dark : EYE_COLOURS.brown;
    if (L < 0.70) return h < 70 ? EYE_COLOURS.brown : (h < 88 ? EYE_COLOURS.hazel : EYE_COLOURS.amber);
    return h < 38 ? EYE_COLOURS.brown : h < 56 ? EYE_COLOURS.hazel : h < 80 ? EYE_COLOURS.blue : h < 91 ? EYE_COLOURS.green : EYE_COLOURS.grey;
  }
  function defaultNose(skin, hair) { return hashN(hair, skin) % 3 === 0 ? 0 : (lumOf(skin) < 0.45 ? 2 : 1); }
  // lips: the skin pulled toward a blood-red and down a touch; quantised so a
  // city of skins lands on a handful of cached materials
  function lipTone(skin) {
    const t = mixHex(skin, 0x8a3438, 0.34), q = (c) => Math.min(255, Math.round(c * 0.78 / 8) * 8);
    return (q(t >> 16 & 255) << 16) | (q(t >> 8 & 255) << 8) | q(t & 255);
  }
  function browTone(hair) { return lumOf(hair) > 0.35 ? mixHex(hair, 0x2a1f16, 0.35) : mixHex(hair, 0x0a0806, 0.25); }

  /* ---- HAIR -------------------------------------------------------------
     Owner 2026-09-28: "long hair looks terrible" — it was rounded boxes: a lid
     on the crown, a plank down the back, two side slabs, a box fringe and a
     box ponytail. Nothing grew from a scalp, there was no hairline, no
     parting, and long hair was one solid slab that clipped the upper back.

     WHAT HAIR IS NOW (every style is ONE merged, cached, indexed geometry per
     (style, head size, tier) in the neck frame, one hair-colour material, no
     vertex colours, no transparency — the pedinstance pooling contract):

       · THE SCALP SHELL — a skull-hugging cap lofted in COLUMNS that start on
         the parting (or a pole: the crown whorl, a ponytail tie, a bun) and
         run to a real HAIRLINE: a curve on the skull that sits back off the
         brow, recedes at the temples (men), drops to a sideburn in front of
         the ear, arcs OVER the ear and falls to the nape behind it. The last
         row dives just under the scalp, so the hairline is the clean line
         where hair meets skin — no helmet rim, nothing coplanar with skin.
         Across the columns the surface is ridged into LOCKS (rounded crowns,
         narrow grooves) with a slight wave, so the geometry itself carries
         the combing direction, and the parting is a groove where the two
         halves meet. Thickness is per style (buzz 1 cm, afro 13 cm).
       · LOCKS — tapered lofted tubes (a lens cross-section, 6 sides) laid over
         the shell and then hanging under gravity from the widest point of the
         head. A lock is SEATED on the skull (+ ears) so it can never go through
         them, tucked behind the ear or over it, and pulled behind the yoke /
         torso below the neck with enough slope to survive the head tilting
         back 0.3 rad. Tips are staggered, taper to a point and flick.
       · Ponytail / bun / pigtails gather INTO a tie or a coil: the shell's
         pole sits on the tie, so every groove on the head runs to it.

     Built at the adult unit head (face frame: skull centre (0, 0.30, 0), +z
     the face) and scaled by S/0.60. `far` is a light tier (half the columns,
     fewer and cruder locks) for rig.setHandLod(2) — see setHairLod.
     HATS: the lead's headwear.js compresses a clone of this; everything that
     hangs (pony tail, bun, pigtails, locs, long/bob curtains) is attached at
     the back/sides BELOW the crown so it reads under a brim. */
  const HAIR_STYLES = {
    // fringe: 1 full bangs, 2 a side-swept fringe off the parting
    buzz: {}, short: {}, crop: {},
    bob: { fringe: 1 }, long: { fringe: 2 }, pony: {}, bun: {}, pigtail: { fringe: 1 },
    afro: {}, curly: {}, locs: {},
  };

  // ---- the head the hair is fitted to (face frame, unit head) --------------
  // The OUTERMOST of the three head forms: the tightest corner radius (m), the
  // widest jaw (c) and no forehead lean, so hair built on it contains every
  // skull. The back-of-skull lift headGeometry applies is inverted exactly.
  const HAIR_CY = 0.30, HAIR_RND = 0.15;
  function hairSkullSdf(x, y, z) {
    const b = cl01(-z / 0.30), b2 = b * b;
    let u = y;
    if (u < 0.24) {
      if (u < 0.12 * b2) return 0.05;
      u = (u - 0.12 * b2) / (1 - 0.5 * b2);
    }
    x /= jawMul(HEAD_FORMS.c, u, z);
    const c = 0.30 - HAIR_RND;
    const qx = Math.abs(x) - c, qy = Math.abs(u - 0.30) - c, qz = Math.abs(z) - c;
    const ox = qx > 0 ? qx : 0, oy = qy > 0 ? qy : 0, oz = qz > 0 ? qz : 0;
    return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - HAIR_RND;
  }
  // the ear (headGeometry's EARS, largest form, flared back rim included)
  const HAIR_EAR = { x0: 0.290, x1: 0.354, y0: 0.228, y1: 0.382, z0: -0.087, z1: 0.017 };
  const HAIR_EAR_M = 0.014;                       // clearance hair keeps off an ear
  function hairIn(x, y, z, ears) {
    if (hairSkullSdf(x, y, z) < 0) return true;
    if (!ears) return false;
    const E = HAIR_EAR, m = HAIR_EAR_M, ax = x < 0 ? -x : x;
    return ax > E.x0 - m && ax < E.x1 + m && y > E.y0 - m && y < E.y1 + m && z > E.z0 - m && z < E.z1 + m;
  }
  // how far along a unit ray from o the head (+ ears) ends for good
  function hairReach(ox, oy, oz, dx, dy, dz, ears) {
    let last = 0;
    for (let t = 0.01; t <= 0.76; t += 0.01) if (hairIn(ox + dx * t, oy + dy * t, oz + dz * t, ears)) last = t;
    let lo = last, hi = last + 0.01;
    for (let i = 0; i < 12; i++) {
      const m = (lo + hi) / 2;
      if (hairIn(ox + dx * m, oy + dy * m, oz + dz * m, ears)) lo = m; else hi = m;
    }
    return (lo + hi) / 2;
  }
  const hairR = (d, ears) => hairReach(0, HAIR_CY, 0, d[0], d[1], d[2], ears);
  const hairRho = (a, y) => hairReach(0, y, 0, Math.sin(a), 0, Math.cos(a), true);
  function hairUnit(x, y, z) { const l = Math.sqrt(x * x + y * y + z * z) || 1e-9; return [x / l, y / l, z / l]; }
  function hairDir(a, e) { const c = Math.cos(e); return [Math.sin(a) * c, Math.sin(e), Math.cos(a) * c]; }
  function hairSlerp(d0, d1, v) {
    const dot = Math.max(-1, Math.min(1, d0[0] * d1[0] + d0[1] * d1[1] + d0[2] * d1[2]));
    const om = Math.acos(dot);
    if (om < 1e-4) return hairUnit(lerpN(d0[0], d1[0], v), lerpN(d0[1], d1[1], v), lerpN(d0[2], d1[2], v));
    const s = Math.sin(om), a = Math.sin((1 - v) * om) / s, b = Math.sin(v * om) / s;
    return hairUnit(d0[0] * a + d1[0] * b, d0[1] * a + d1[1] * b, d0[2] * a + d1[2] * b);
  }
  // deterministic jitter (appearance is seed-pure: no Math.random in hair)
  function hairHash(i, j) { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); }
  // smooth piecewise curve through [x, y] keys (x ascending), clamped
  function hairKeys(K, x) {
    if (x <= K[0][0]) return K[0][1];
    for (let i = 1; i < K.length; i++) if (x <= K[i][0]) {
      const t = (x - K[i - 1][0]) / (K[i][0] - K[i - 1][0]);
      return lerpN(K[i - 1][1], K[i][1], t * t * (3 - 2 * t));
    }
    return K[K.length - 1][1];
  }
  /* HAIRLINES: height of the hairline on the skull by |azimuth| (0 = the middle
     of the forehead, PI = the nape). The ear sits at |a| 1.52..1.83 up to
     y 0.38: every line goes to a sideburn in front of it, OVER it, and down
     behind it. "m": temples recede (the M); "f": a rounded front. */
  const HAIRLINES = {
    m: [[0, 0.522], [0.30, 0.530], [0.58, 0.562], [0.80, 0.545], [0.98, 0.510], [1.10, 0.470], [1.20, 0.405], [1.28, 0.330], [1.38, 0.268],
        [1.46, 0.320], [1.54, 0.418], [1.70, 0.428], [1.86, 0.405], [1.97, 0.250], [2.15, 0.150], [2.50, 0.100], [Math.PI, 0.085]],
    f: [[0, 0.512], [0.35, 0.516], [0.70, 0.506], [0.95, 0.490], [1.10, 0.450], [1.20, 0.395], [1.29, 0.330], [1.38, 0.290],
        [1.46, 0.330], [1.54, 0.420], [1.70, 0.430], [1.86, 0.407], [1.97, 0.250], [2.15, 0.145], [2.50, 0.092], [Math.PI, 0.078]],
  };
  // the skull direction where the hairline crosses azimuth a
  function hairlineDir(a, yh) {
    let lo = -1.35, hi = 1.45;
    for (let i = 0; i < 20; i++) {
      const e = (lo + hi) / 2, d = hairDir(a, e);
      if (HAIR_CY + d[1] * hairR(d, false) < yh) lo = e; else hi = e;
    }
    return hairDir(a, (lo + hi) / 2);
  }

  // indexed part from flat arrays
  function hairPart(P, I) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(P), 3));
    g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(P.length), 3));
    g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(P.length / 3 * 2), 2));
    g.setIndex(new THREE.BufferAttribute(new Uint16Array(I), 1));
    return flatUV(finishGeo(g), 0.5, 0.5);
  }

  /* THE SHELL. o:
       cols          columns round the head (multiple of `ridges`*4 reads best)
       rows          v stations from the root (0) to the hairline (1)
       aPart         azimuth where the two combing halves meet (the parting)
       root(t, side) the scalp point a column starts from (t: 0 at the
                     parting's front .. 1 at the back seam)
       line          HAIRLINES key, or a function (|a|, a) -> height
       T(d, a, v)    thickness over the skull along direction d
       band          the hairline taper (share of v), bury = how far the
                     last row dives under the scalp
       partT/partV   thickness AT the parting and how fast it grows out of it
       ridges/rAmp/wave  lock grooves across the columns
       lump(d)       extra radial noise (afro) */
  function hairShell(o) {
    const rows = o.rows, R = rows.length, aP = o.aPart || 0, TAU = 2 * Math.PI;
    const line = typeof o.line === "function" ? o.line : ((aa) => hairKeys(HAIRLINES[o.line], aa));
    // columns: uniform round the head, plus extra ones where the hairline
    // turns sharply round the front and back of each ear
    const A = [];
    for (let j = 0; j <= o.cols; j++) A.push(aP - Math.PI + TAU * j / o.cols);
    const extra = o.far ? [1.47, 1.95] : [1.33, 1.41, 1.47, 1.52, 1.60, 1.90, 1.96, 2.04];
    for (const e of extra) for (const sg of [-1, 1]) {
      let a = sg * e;
      while (a < aP - Math.PI) a += TAU;
      while (a > aP + Math.PI) a -= TAU;
      if (A.every((b) => Math.abs(b - a) > 0.03)) A.push(a);
    }
    A.sort((x, y) => x - y);
    const cols = A.length - 1;
    // directions first (the sag pass needs every neighbour)
    const D = [], AW = [];
    for (let j = 0; j <= cols; j++) {
      const a = A[j], aw = Math.atan2(Math.sin(a), Math.cos(a));
      const q = o.root(Math.abs(a - aP) / Math.PI, a < aP ? -1 : 1);
      const d0 = hairUnit(q[0], q[1] - HAIR_CY, q[2]);
      const d1 = hairlineDir(aw, line(Math.abs(aw), aw));
      AW.push(aw);
      // a column whose great arc would run ACROSS the ear (a pole at the back
      // combing to a sideburn) is routed over the top of it instead: hair
      // pulled back goes above the ear, never through it
      let dm = null;
      for (let k = 1; k < 12 && !dm; k++) {
        const t = hairSlerp(d0, d1, k / 12), ta = Math.abs(Math.atan2(t[0], t[2]));
        // (a column ending in FRONT of the ear passes over its front-top corner)
        if (ta > 1.42 && ta < 1.98 && HAIR_CY + t[1] * 0.31 < 0.455) dm = hairDir(Math.abs(aw) < 1.52 ? Math.sign(aw) * 1.40 : Math.atan2(t[0], t[2]), 0.56);
      }
      if (dm) {
        const l0 = Math.acos(Math.max(-1, Math.min(1, d0[0] * dm[0] + d0[1] * dm[1] + d0[2] * dm[2])));
        const l1 = Math.acos(Math.max(-1, Math.min(1, dm[0] * d1[0] + dm[1] * d1[1] + dm[2] * d1[2])));
        const vm = l0 / (l0 + l1 || 1);
        for (let i = 0; i < R; i++) { const v = rows[i]; D.push(v < vm ? hairSlerp(d0, dm, v / vm) : hairSlerp(dm, d1, (v - vm) / (1 - vm))); }
      } else for (let i = 0; i < R; i++) D.push(hairSlerp(d0, d1, rows[i]));
    }
    const ang = (p, q) => Math.acos(Math.max(-1, Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2])));
    const P = [], I = [];
    for (let j = 0; j <= cols; j++) {
      const aw = AW[j], s = (o.ridges || 0) * (A[j] - aP + Math.PI) / TAU;
      // the thinning band is a DISTANCE on the scalp, not a share of the
      // column: a long column (crown -> sideburn) must not thin its whole
      // sideburn away
      let arc = 0;
      for (let i = 1; i < R; i++) arc += ang(D[j * R + i - 1], D[j * R + i]);
      const band = Math.min(0.6, o.band * 0.62 / Math.max(0.3, arc) * 0.5);
      for (let i = 0; i < R; i++) {
        const v = rows[i], d = D[j * R + i];
        // `round` (afro): the mass rises off the hairline like a quarter circle
        const eb = cl01((1 - v) / band), out = o.round ? Math.sqrt(1 - (1 - eb) * (1 - eb)) : sm01(eb);
        const grow = o.partT != null ? lerpN(o.partT, 1, sm01(v / (o.partV || 0.1))) : 1;
        // the hair thins over `band` toward the hairline and only the very last
        // station dives under the scalp: the visible edge IS the hairline
        let off = o.T(d, aw, v) * out * grow - (o.bury || 0.012) * sm01((v - 0.93) / 0.07);
        if (o.ridges) {
          const prof = Math.sqrt(Math.abs(Math.sin(Math.PI * (s + (o.wave || 0) * Math.sin(v * 7.0)))));
          // grooves fade out WITH the thickness, so the hairline never breaks
          // into bare notches (a groove can't dig below the scalp)
          off += (o.rAmp || 0.006) * sm01(v / 0.22) * out * (prof - 0.62);
        }
        if (o.lump) off += o.lump(d) * out;
        // SAG: a flat triangle between two stations cuts inside the curve they
        // sit on — lift each station by the chord sag to its widest neighbour
        let h = 0;
        if (j > 0) h = Math.max(h, ang(d, D[(j - 1) * R + i]));
        if (j < cols) h = Math.max(h, ang(d, D[(j + 1) * R + i]));
        if (i > 0) h = Math.max(h, ang(d, D[j * R + i - 1]));
        if (i < R - 1) h = Math.max(h, ang(d, D[j * R + i + 1]));
        // (the quad diagonals are chords too)
        if (j < cols && i > 0) h = Math.max(h, 0.8 * ang(d, D[(j + 1) * R + i - 1]));
        if (j > 0 && i < R - 1) h = Math.max(h, 0.8 * ang(d, D[(j - 1) * R + i + 1]));
        off += (0.10 * h * h + (o.far ? 0.013 : 0.0025)) * (0.3 + 0.7 * out);
        const r = hairR(d, false) + off;
        P.push(d[0] * r, HAIR_CY + d[1] * r, d[2] * r);
      }
    }
    // winding: outward — every quad votes (columns can pinch to a pole or a
    // parting, so no single quad is trusted)
    let vote = 0;
    for (let j = 0; j < cols; j++) for (let i = 0; i < R - 1; i++) {
      const pa = (j * R + i) * 3, pb = ((j + 1) * R + i) * 3, pc = (j * R + i + 1) * 3;
      const ux = P[pb] - P[pa], uy = P[pb + 1] - P[pa + 1], uz = P[pb + 2] - P[pa + 2];
      const wx = P[pc] - P[pa], wy = P[pc + 1] - P[pa + 1], wz = P[pc + 2] - P[pa + 2];
      vote += (uy * wz - uz * wy) * P[pa] + (uz * wx - ux * wz) * (P[pa + 1] - HAIR_CY) + (ux * wy - uy * wx) * P[pa + 2];
    }
    const flip = vote < 0;
    for (let j = 0; j < cols; j++) for (let i = 0; i < R - 1; i++) {
      const a = j * R + i, b = (j + 1) * R + i, c = a + 1, d = b + 1;
      if (flip) I.push(a, c, b, b, c, d); else I.push(a, b, c, b, d, c);
    }
    return hairPart(P, I);
  }

  // where hanging hair must stay behind the yoke/torso: tuned so the head can
  // tilt back 0.3 rad (animChar's "look up") without the hair entering the back
  function hairBackZ(y) { return -0.296 + 0.25 * Math.min(0, y - 0.05); }

  /* SEAT a point on the head: above the skull's middle it goes out RADIALLY
     from the skull centre to `off` over the skull + ears; below, it HANGS —
     horizontally out to the widest the head has been anywhere above it at
     that azimuth, which is exactly how hair falls off a head. */
  function hairSeat(a, y, off, halfW) {
    // a wide lock must clear the head across its whole width, not just its middle
    const da = halfW ? halfW / 0.31 : 0, as = da ? [a - da, a - da / 2, a, a + da / 2, a + da] : [a];
    if (y >= HAIR_CY) {
      const dy = Math.min(0.305, y - HAIR_CY), h = Math.sqrt(Math.max(1e-6, 0.31 * 0.31 - dy * dy));
      const d = hairUnit(Math.sin(a) * h, dy, Math.cos(a) * h);
      let r = 0;
      for (const b of as) r = Math.max(r, hairR(hairUnit(Math.sin(b) * h, dy, Math.cos(b) * h), true));
      r += off;
      return [d[0] * r, HAIR_CY + d[1] * r, d[2] * r];
    }
    let rho = 0;
    for (const b of as) for (let k = 0; k <= 5; k++) rho = Math.max(rho, hairRho(b, lerpN(y, HAIR_CY, k / 5)));
    rho += off;
    return [Math.sin(a) * rho, y, Math.cos(a) * rho];
  }

  /* A LOCK: control stations [a, y] (azimuth, height) -> a Catmull-Rom path,
     seated on the head, pulled behind the back when `back`, then lofted as a
     tapered lens-section tube with a pointed tip. o:
       n, seg   stations along / sides around
       w, t     full width / thickness; wRoot, wTip share of w at the ends
       off      how far the lock's centre rides over the scalp (above the shell)
       back     keep it behind the yoke/torso below the neck
       flick    radial flick of the tip (+ out, - curls under)
       wave     lateral wave amplitude; ph its phase */
  function hairLock(ctrl, o) {
    const n = o.n || 9, seg = o.seg || 6, S = [];
    const cr = (p0, p1, p2, p3, t) => {
      const t2 = t * t, t3 = t2 * t;
      return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
    };
    const m = ctrl.length - 1;
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1) * m, k = Math.min(m - 1, Math.floor(u)), t = u - k;
      const c0 = ctrl[Math.max(0, k - 1)], c1 = ctrl[k], c2 = ctrl[k + 1], c3 = ctrl[Math.min(m, k + 2)];
      S.push([cr(c0[0], c1[0], c2[0], c3[0], t), cr(c0[1], c1[1], c2[1], c3[1], t), i / (n - 1)]);
    }
    const tHalf = (o.t || 0.03) / 2;
    const pts = S.map(function (st) {
      const s = st[2];
      const off = (typeof o.off === "function" ? o.off(s) : o.off) + (o.flick || 0) * sm01((s - 0.72) / 0.28);
      const p = hairSeat(st[0], st[1], off, (o.w || 0.08) * 0.5);
      if (o.back) {
        const zl = hairBackZ(p[1]) - tHalf, w = sm01((HAIR_CY - p[1]) / 0.25);
        if (p[2] > zl) p[2] = lerpN(p[2], zl, w);
      }
      return p;
    });
    return hairTube(pts, function (s) {
      const wr = o.wRoot != null ? o.wRoot : 0.45, wt = o.wTip != null ? o.wTip : 0.12;
      const f = s < 0.18 ? lerpN(wr, 1, sm01(s / 0.18)) : lerpN(1, wt, sm01((s - 0.45) / 0.55));
      return [(o.w || 0.08) * f, (o.t || 0.03) * lerpN(f, 1, 0.35)];
    }, seg, o.wave || 0, o.ph || 0);
  }

  /* TUBE: pts along a centreline, size(s) -> [width, thickness]; the section is
     a lens whose width lies ACROSS the head (perpendicular to the path and to
     the outward direction), so neighbouring locks overlap at their thin edges
     and read apart. Closed with a point at each end. */
  function hairTube(pts, size, seg, wave, ph, upHint) {
    const n = pts.length, P = [], I = [], C = [];
    for (let i = 0; i < n; i++) {
      const p = pts[i], pa = pts[Math.max(0, i - 1)], pb = pts[Math.min(n - 1, i + 1)];
      const tg = hairUnit(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]);
      const out = upHint ? upHint(p, i / (n - 1)) : hairUnit(p[0], p[1] - Math.min(p[1], HAIR_CY), p[2]);
      let sd = hairUnit(tg[1] * out[2] - tg[2] * out[1], tg[2] * out[0] - tg[0] * out[2], tg[0] * out[1] - tg[1] * out[0]);
      const nr = [sd[1] * tg[2] - sd[2] * tg[1], sd[2] * tg[0] - sd[0] * tg[2], sd[0] * tg[1] - sd[1] * tg[0]];
      const s = i / (n - 1), wz = size(s), wv = (wave || 0) * Math.sin(s * 9.0 + (ph || 0)) * sm01(s / 0.3);
      const cx = p[0] + sd[0] * wv, cy = p[1] + sd[1] * wv, cz = p[2] + sd[2] * wv;
      C.push([cx, cy, cz, tg]);
      for (let k = 0; k < seg; k++) {
        const f = 2 * Math.PI * k / seg, cw = Math.cos(f), sw = Math.sin(f);
        const lens = sw * (0.55 + 0.45 * Math.abs(sw));   // a lens: thin edges, full middle
        P.push(cx + sd[0] * wz[0] / 2 * cw + nr[0] * wz[1] / 2 * lens,
               cy + sd[1] * wz[0] / 2 * cw + nr[1] * wz[1] / 2 * lens,
               cz + sd[2] * wz[0] / 2 * cw + nr[2] * wz[1] / 2 * lens);
      }
    }
    // end points
    const e0 = C[0], e1 = C[n - 1], l0 = 0.012, l1 = 0.02;
    const r0 = P.length / 3; P.push(e0[0] - e0[3][0] * l0, e0[1] - e0[3][1] * l0, e0[2] - e0[3][2] * l0);
    const r1 = P.length / 3; P.push(e1[0] + e1[3][0] * l1, e1[1] + e1[3][1] * l1, e1[2] + e1[3][2] * l1);
    // quads, each oriented away from its own ring centre (sections are convex)
    const tri = (a, b, c, cc) => {
      const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
      const ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az;
      const vx = P[c * 3] - ax, vy = P[c * 3 + 1] - ay, vz = P[c * 3 + 2] - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const gx = (ax + P[b * 3] + P[c * 3]) / 3 - cc[0], gy = (ay + P[b * 3 + 1] + P[c * 3 + 1]) / 3 - cc[1], gz = (az + P[b * 3 + 2] + P[c * 3 + 2]) / 3 - cc[2];
      if (nx * gx + ny * gy + nz * gz < 0) I.push(a, c, b); else I.push(a, b, c);
    };
    for (let i = 0; i < n - 1; i++) {
      const cc = [(C[i][0] + C[i + 1][0]) / 2, (C[i][1] + C[i + 1][1]) / 2, (C[i][2] + C[i + 1][2]) / 2];
      for (let k = 0; k < seg; k++) {
        const a = i * seg + k, b = i * seg + (k + 1) % seg, c = a + seg, d = b + seg;
        tri(a, c, d, cc); tri(a, d, b, cc);
      }
    }
    for (let k = 0; k < seg; k++) {
      const a = k, b = (k + 1) % seg;
      tri(r0, b, a, [e0[0] + e0[3][0] * 0.05, e0[1] + e0[3][1] * 0.05, e0[2] + e0[3][2] * 0.05]);
      const a2 = (n - 1) * seg + k, b2 = (n - 1) * seg + (k + 1) % seg;
      tri(r1, a2, b2, [e1[0] - e1[3][0] * 0.05, e1[1] - e1[3][1] * 0.05, e1[2] - e1[3][2] * 0.05]);
    }
    return hairPart(P, I);
  }

  // ---- shell presets ------------------------------------------------------
  const HAIR_CROWN = [0.0, 0.60, -0.10];                    // the whorl, back of the crown
  const poleAt = (p) => () => p;
  // a parting from the front hairline (at x) back to the crown
  function partRoot(x, line, reach) {
    const aF = Math.atan2(x, 0.29), dF = hairlineDir(aF, hairKeys(HAIRLINES[line], Math.abs(aF)) + 0.004);
    const rF = hairR(dF, false), F = [dF[0] * rF, HAIR_CY + dF[1] * rF, dF[2] * rF];
    const B = [x * 0.35, 0.60, -0.08];
    return { aPart: aF, root: (t) => { const u = Math.min(1, t / (reach || 0.6)); return [lerpN(F[0], B[0], u), lerpN(F[1], B[1], u), lerpN(F[2], B[2], u)]; } };
  }
  // thickness helpers: top/side/back mix by direction
  function hairT(top, side, back, front, d) {
    const up = cl01(d[1] * 1.6 + 0.2), bk = cl01(-d[2] * 1.3), fr = cl01(d[2] * 1.4);
    const around = lerpN(lerpN(side, back, bk), front != null ? front : side, fr);
    return lerpN(around, top, up);
  }

  function hairBuild(styleId, far) {
    const st = HAIR_STYLES[styleId] ? styleId : "short";
    const F = far ? 0.5 : 1;                      // column density
    const parts = [];
    const rowsShort = far ? [0, 0.3, 0.55, 0.78, 0.92, 1] : [0, 0.18, 0.42, 0.66, 0.84, 0.94, 1];
    const rowsFull = far ? [0, 0.3, 0.6, 0.85, 1] : [0, 0.08, 0.2, 0.36, 0.54, 0.7, 0.84, 0.93, 1];
    const cols = (n) => Math.max(20, Math.round(n * F / 4) * 4);
    const lk = (ctrl, o) => parts.push(hairLock(ctrl, far ? Object.assign({}, o, { n: Math.max(4, Math.round((o.n || 9) * 0.55)), seg: 4, wave: 0 }) : o));
    // a lock rises out of the shell at its root, then rides `top` over the scalp
    const rise = (top) => (s) => lerpN(0.016, top, sm01(s / 0.22));

    if (st === "buzz") {
      parts.push(hairShell({ far, cols: cols(24), rows: far ? [0, 0.3, 0.55, 0.78, 0.92, 1] : [0, 0.16, 0.32, 0.47, 0.61, 0.74, 0.86, 0.95, 1], root: poleAt(HAIR_CROWN), line: "m",
        T: (d) => hairT(0.013, 0.010, 0.010, 0.012, d) + (far ? 0.006 : 0), band: 0.14, bury: 0.012, ridges: far ? 0 : 10, rAmp: 0.003 }));
    } else if (st === "short") {
      // a side part, volume on top and a lift at the front, tapered sides and nape
      const pr = partRoot(0.095, "m", 0.55);
      parts.push(hairShell({ far, cols: cols(44), rows: rowsShort, aPart: pr.aPart, root: pr.root, line: "m",
        T: (d, a, v) => hairT(0.040, 0.016, 0.020, 0.048, d) * lerpN(1, 0.55, sm01((v - 0.55) / 0.45) * cl01(-d[1] * 2 + 0.6)),
        band: 0.20, partT: 0.12, partV: 0.12, ridges: far ? 0 : 13, rAmp: 0.009, wave: 0.12 }));
    } else if (st === "crop") {
      // textured crop: combed FORWARD from the whorl to a short blunt fringe
      parts.push(hairShell({ far, cols: cols(44), rows: rowsShort, root: poleAt(HAIR_CROWN),
        line: (aa) => hairKeys(HAIRLINES.m, aa) - 0.012 * cl01(1 - aa / 0.7),
        T: (d, a, v) => hairT(0.034, 0.013, 0.012, 0.036, d) * lerpN(1, 0.6, sm01((v - 0.5) / 0.5) * cl01(-d[1] * 2 + 0.6)),
        band: 0.12, bury: 0.014, ridges: far ? 0 : 13, rAmp: 0.012, wave: 0.18 }));
    } else if (st === "afro") {
      // a rounded, slightly lumpy halo; the hairline stays where a hairline is
      const lump = (d) => 0.014 * Math.sin(d[0] * 9.1 + 1.3) * Math.sin(d[1] * 8.3 + 0.4) + 0.011 * Math.sin(d[2] * 10.7 + d[0] * 4.0) + 0.009 * Math.sin((d[0] + d[1] - d[2]) * 17.0) + 0.006 * Math.sin((d[0] - d[2]) * 23.0 + d[1] * 11.0);
      parts.push(hairShell({ far, cols: cols(52), rows: far ? [0, 0.3, 0.6, 0.8, 0.9, 0.96, 1] : [0, 0.12, 0.26, 0.40, 0.54, 0.66, 0.76, 0.84, 0.90, 0.945, 0.975, 1],
        root: poleAt([0, 0.60, -0.04]), line: "f",
        // a round halo: rounder than the skull box (the corners fill less than the faces)
        // the halo is an ELLIPSOID round the head (set up and back), so the
        // silhouette is round whatever the box skull under it does
        T: (d) => {
          const ox = 0, oy = HAIR_CY - 0.40, oz = 0.05, rx = 0.44, ry = 0.40, rz = 0.45;
          const a = (d[0] / rx) ** 2 + (d[1] / ry) ** 2 + (d[2] / rz) ** 2;
          const b = 2 * (ox * d[0] / (rx * rx) + oy * d[1] / (ry * ry) + oz * d[2] / (rz * rz));
          const c = (ox / rx) ** 2 + (oy / ry) ** 2 + (oz / rz) ** 2 - 1;
          const t = (-b + Math.sqrt(Math.max(0, b * b - 4 * a * c))) / (2 * a);
          return Math.max(0.03, t - hairR(d, false));
        }, band: 0.30, round: true, bury: 0.016, lump: far ? null : lump }));
    } else if (st === "curly") {
      parts.push(hairShell({ far, root: poleAt(HAIR_CROWN), line: "f",
        cols: far ? 20 : 60, rows: far ? rowsShort : [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.79, 0.87, 0.94, 1],
        T: (d) => hairT(0.050, 0.034, 0.042, 0.044, d), band: 0.16, round: true,
        lump: (d) => { const b = Math.sin(d[0] * 17.0 + 0.7) * Math.sin(d[1] * 15.0 + 1.9) * Math.sin(d[2] * 16.0 + 0.3); return 0.024 * Math.pow(Math.max(0, b), 0.6) - 0.004; } }));
      // clustered curls: squashed balls sat in the shell, a golden-spiral scatter
      // over the hair-covered part of the head, a few tumbling over the hairline
      const N = far ? 12 : 30;
      for (let i = 0; i < N; i++) {
        const y = 1 - (i + 0.5) / N * 1.15, rr = Math.sqrt(Math.max(0, 1 - y * y)), ph = i * 2.39996;
        const d = [Math.sin(ph) * rr, y, Math.cos(ph) * rr];
        const a = Math.atan2(d[0], d[2]), el = Math.asin(d[1]);
        const lineE = Math.asin(hairlineDir(a, hairKeys(HAIRLINES.f, Math.abs(a)))[1]);
        if (el < lineE + 0.12) continue;
        const r0 = 0.046 + 0.018 * hairHash(i, 3);
        const g = new THREE.SphereGeometry(r0, far ? 5 : 6, far ? 3 : 4);
        g.scale(1, 0.72, 1);
        g.rotateX(hairHash(i, 5) * 3.0); g.rotateY(hairHash(i, 7) * 6.3);
        const R = hairR(d, false) + 0.018 + 0.012 * hairHash(i, 9);
        g.translate(d[0] * R, HAIR_CY + d[1] * R, d[2] * R);
        parts.push(flatUV(finishGeo(g), 0.5, 0.5));
      }
    } else if (st === "locs") {
      parts.push(hairShell({ far, cols: cols(40), rows: rowsShort, root: poleAt([0, 0.60, -0.04]), line: "m",
        T: (d) => hairT(0.030, 0.020, 0.024, 0.024, d), band: 0.16, ridges: far ? 0 : 10, rAmp: 0.012 }));
      // rope locs: two tiers of roots round the head, never across the face
      const N = far ? 10 : 22;
      for (let i = 0; i < N; i++) {
        const half = N / 2, sgn = i < half ? -1 : 1, tier = i % 2;
        const aa = sgn * lerpN(0.80, Math.PI - 0.08, ((i % half) + 0.5) / half);
        const front = Math.abs(aa) < 1.55;
        const back = Math.abs(aa) > 1.95;
        const yTip = front ? 0.135 + 0.03 * hairHash(i, 2) : back ? -0.10 - 0.12 * hairHash(i, 4) * (1 - (Math.PI - Math.abs(aa)) / 1.2) : 0.08;
        const drift = back ? (Math.PI - Math.abs(aa)) * 0.10 : 0;
        const a2 = Math.sign(aa) * (Math.abs(aa) + (front ? 0 : 0.05) + drift);
        const yRoot = tier ? 0.56 : 0.47;
        lk([[aa * (tier ? 0.9 : 1), yRoot], [aa, lerpN(yRoot, 0.30, 0.5)], [a2, 0.30], [a2, lerpN(0.30, yTip, 0.5)], [a2, yTip]],
           { n: 8, seg: 5, w: 0.046, t: 0.044, wRoot: 0.8, wTip: 0.55, off: 0.040 + tier * 0.018, back: !front, flick: 0.004, wave: 0.006, ph: i * 1.7 });
      }
    } else {
      // ---- the long and tied styles: a parting or a tie drives the shell ----
      if (st === "pony" || st === "bun") {
        const tie = st === "pony" ? [0, 0.40, -0.32] : [0, 0.56, -0.24];
        parts.push(hairShell({ far, cols: cols(48), rows: rowsFull, root: poleAt(tie), line: "f",
          // pulled back: sleek over the skull, gathered thick into the tie
          T: (d, a, v) => hairT(0.021, 0.015, 0.019, 0.014, d) + 0.016 * (1 - sm01(v / 0.25)),
          band: 0.12, bury: 0.014, ridges: far ? 0 : 16, rAmp: 0.009, wave: 0.04 }));
        if (st === "pony") {
          // the tie: a short gathered collar, then the tail — a bundle of five
          // locks round one swinging axis, staggered tips
          const axis = [[0, 0.425, -0.33], [0, 0.415, -0.40], [0.012, 0.33, -0.465], [0.022, 0.19, -0.485], [0.018, 0.05, -0.48], [0.0, -0.08, -0.48]];
          parts.push(hairTube(sampleAxis(axis, far ? 3 : 4, 0, 0.16), () => [0.066, 0.066], far ? 5 : 8, 0, 0, tubeUp));
          const NL = far ? 3 : 7;
          for (let i = 0; i < NL; i++) {
            const f = 2 * Math.PI * i / NL + 0.4, rad = 0.028;
            const len = 1 - 0.14 * hairHash(i, 11);
            const pts = sampleAxis(axis, far ? 5 : 10, 0.12, len).map(function (p, k, arr) {
              const s = k / (arr.length - 1), sp = rad * (0.6 + 1.2 * Math.sin(Math.PI * Math.min(1, s * 1.4))) ;
              const tw = f + s * 1.1;
              return [p[0] + Math.cos(tw) * sp, p[1], p[2] + Math.sin(tw) * sp * 0.8];
            });
            parts.push(hairTube(pts, (s) => { const k = s < 0.1 ? lerpN(0.55, 1, s / 0.1) : lerpN(1, 0.1, sm01((s - 0.3) / 0.7)); return [0.084 * k, 0.062 * k]; }, far ? 4 : 6, 0, 0, tubeUp));
          }
        } else {
          // the bun: a coiled rope, wound flat against the head and domed out
          const c0 = hairUnit(0, 0.56 - HAIR_CY, -0.24);
          const base = hairR(c0, false) + 0.012;
          const O = [c0[0] * base, HAIR_CY + c0[1] * base, c0[2] * base];
          const nrm = c0, ax1 = hairUnit(1, 0, 0), ax2 = hairUnit(nrm[1] * ax1[2] - nrm[2] * ax1[1], nrm[2] * ax1[0] - nrm[0] * ax1[2], nrm[0] * ax1[1] - nrm[1] * ax1[0]);
          const NS = far ? 16 : 40, turns = 2.2, pts = [];
          for (let i = 0; i < NS; i++) {
            const s = i / (NS - 1), ang = s * turns * 2 * Math.PI;
            const rad = lerpN(0.112, 0.022, s), h = 0.034 + 0.088 * Math.sin(s * Math.PI * 0.5);
            pts.push([O[0] + ax1[0] * Math.cos(ang) * rad + ax2[0] * Math.sin(ang) * rad + nrm[0] * h,
                      O[1] + ax1[1] * Math.cos(ang) * rad + ax2[1] * Math.sin(ang) * rad + nrm[1] * h,
                      O[2] + ax1[2] * Math.cos(ang) * rad + ax2[2] * Math.sin(ang) * rad + nrm[2] * h]);
          }
          parts.push(hairTube(pts, (s) => { const k = s < 0.06 ? lerpN(0.5, 1, s / 0.06) : lerpN(1, 0.55, s); return [0.080 * k, 0.066 * k]; }, far ? 5 : 7, 0, 0,
            (p) => hairUnit(p[0] - O[0], p[1] - O[1], p[2] - O[2])));
        }
      } else {
        // bob / long / pigtail: a parting, and locks that fall from it
        const px = st === "bob" ? -0.085 : (st === "long" ? 0.075 : 0.0);
        const pr = partRoot(px, "f", 0.6);
        parts.push(hairShell({ far, cols: cols(40), rows: rowsFull, aPart: pr.aPart, root: pr.root, line: "f",
          T: (d) => hairT(0.030, 0.020, 0.026, 0.024, d), band: 0.14, partT: 0.15, partV: 0.12,
          ridges: far ? 0 : 12, rAmp: 0.008, wave: 0.08 }));
        const aP = pr.aPart;
        if (st === "bob") {
          // a curtain to the jaw, over the ears, the ends turned under
          const N = far ? 8 : 14;
          for (let i = 0; i < N; i++) {
            const u = (i + 0.5) / N, a = (u * 2 - 1) * Math.PI;
            const aa = Math.sign(a) * lerpN(0.98, Math.PI, Math.abs(a) / Math.PI);
            const front = cl01((1.8 - Math.abs(aa)) / 0.8);
            const yTip = (Math.abs(aa) > 2.3 ? 0.085 : lerpN(0.125, 0.145, front)) + 0.012 * hairHash(i, 1);
            lk([[aa, 0.545], [aa, 0.46], [aa, 0.36], [aa, 0.22], [aa - front * Math.sign(aa) * 0.06, yTip]],
               { n: 7, w: 0.135, t: 0.030, off: rise(0.036 + 0.008 * (i % 2)), flick: -0.016, wave: 0.004, ph: i, back: Math.abs(aa) > 2.3, wRoot: 0.6, wTip: 0.6 });
          }
        } else if (st === "long") {
          // face-framing locks in front of the ears, then the rest tucked behind
          // the ears and falling down the back in a soft V
          for (const sg of [-1, 1]) {
            lk([[aP + sg * 0.22, 0.575], [sg * 0.85, 0.53], [sg * 1.18, 0.42], [sg * 1.29, 0.30], [sg * 1.31, 0.19], [sg * 1.27, 0.115]],
               { n: 9, w: 0.095, t: 0.030, off: rise(0.036), flick: 0.008, wave: 0.006, ph: sg });
            lk([[sg * 0.95, 0.56], [sg * 1.40, 0.51], [sg * 1.86, 0.43], [sg * 2.06, 0.30], [sg * 2.12, 0.14], [sg * 2.22, -0.04], [sg * 2.30, -0.15]],
               { n: 10, w: 0.125, t: 0.032, off: rise(0.038), back: true, flick: 0.010, wave: 0.008, ph: sg * 2 });
            lk([[sg * 1.5, 0.56], [sg * 1.8, 0.51], [sg * 2.02, 0.42], [sg * 2.2, 0.30], [sg * 2.28, 0.12], [sg * 2.36, -0.06], [sg * 2.42, -0.19]],
               { n: 10, w: 0.125, t: 0.032, off: rise(0.046), back: true, flick: 0.010, wave: 0.008, ph: sg * 3 });
          }
          const NB = far ? 5 : 8;
          for (let i = 0; i < NB; i++) {
            const u = NB === 1 ? 0.5 : i / (NB - 1), aa = Math.PI + (u * 2 - 1) * 0.80;
            const mid = 1 - Math.abs(u * 2 - 1);
            const yTip = -0.20 - 0.10 * mid - 0.03 * hairHash(i, 5);
            const aT = Math.PI + (aa - Math.PI) * 1.04;
            lk([[aa, 0.555], [aa, 0.46], [aa, 0.33], [aT, 0.16], [aT, 0.0], [aT, yTip]],
               { n: 9, w: 0.150, t: 0.034, off: rise(0.036 + 0.010 * (i % 2)), back: true, flick: 0.012, wave: 0.008, ph: i * 1.3 });
          }
          // the side-swept fringe falling off the parting across to the far temple
          if (HAIR_STYLES[st].fringe === 2) {
            lk([[aP + 0.12, 0.605], [0.02, 0.555], [-0.45, 0.535], [-0.86, 0.505], [-1.13, 0.40], [-1.26, 0.27], [-1.28, 0.15]],
               { n: 10, w: 0.080, t: 0.030, off: 0.030, flick: 0.006, wave: 0.004, ph: 0.3 });
            lk([[aP + 0.05, 0.61], [-0.2, 0.575], [-0.66, 0.545], [-1.02, 0.47], [-1.22, 0.34], [-1.29, 0.22]],
               { n: 9, w: 0.080, t: 0.030, off: 0.040, flick: 0.006, wave: 0.004, ph: 1.1 });
          }
        } else {
          // pigtails: everything combs from the centre parting down to two ties
          // low behind the ears; each tie a short collar, then a bunch of locks
          for (const sg of [-1, 1]) {
            const tieA = sg * 2.05, tie = hairSeat(tieA, 0.33, 0.030);
            const outD = hairUnit(Math.sin(tieA) * 1.0, -0.25, Math.cos(tieA) * 0.55);
            const axis = [tie, [tie[0] + outD[0] * 0.05, tie[1] + outD[1] * 0.05, tie[2] + outD[2] * 0.05],
              [tie[0] + sg * 0.090, tie[1] - 0.07, tie[2] - 0.05], [tie[0] + sg * 0.125, tie[1] - 0.15, tie[2] - 0.06], [tie[0] + sg * 0.145, tie[1] - 0.21, tie[2] - 0.055]];
            parts.push(hairTube(sampleAxis(axis, 3, 0, 0.2), () => [0.060, 0.060], far ? 5 : 7, 0, 0, tubeUp));
            const NL = far ? 3 : 5;
            for (let i = 0; i < NL; i++) {
              const f = 2 * Math.PI * i / NL + sg, len = 1 - 0.12 * hairHash(i, sg + 5);
              const pts = sampleAxis(axis, far ? 5 : 8, 0.12, len).map(function (p, k, arr) {
                const s = k / (arr.length - 1), sp = 0.024 * (0.6 + Math.sin(Math.PI * Math.min(1, s * 1.3)));
                return [p[0] + Math.cos(f + s) * sp, p[1], p[2] + Math.sin(f + s) * sp];
              });
              parts.push(hairTube(pts, (s) => { const k = s < 0.1 ? lerpN(0.55, 1, s / 0.1) : lerpN(1, 0.12, sm01((s - 0.3) / 0.7)); return [0.068 * k, 0.052 * k]; }, far ? 4 : 6, 0, 0, tubeUp));
            }
          }
        }
        // full bangs across the brow (bob, pigtail): short locks from the
        // front of the parting, tips staggered above the brows
        if (HAIR_STYLES[st].fringe === 1) {
          const NF = far ? 4 : 7;
          for (let i = 0; i < NF; i++) {
            const u = (i + 0.5) / NF, ax = (u * 2 - 1) * 0.95;
            const yTip = 0.492 + 0.016 * hairHash(i, 8) + 0.02 * Math.pow(Math.abs(u * 2 - 1), 2);
            lk([[ax * 0.55 + aP * 0.3, 0.605], [ax * 0.85, 0.575], [ax, 0.535], [ax * 1.02, yTip]],
               { n: 5, w: 0.095, t: 0.026, off: (s) => lerpN(0.034, 0.016, s), wRoot: 0.8, wTip: 0.45, flick: 0.004 });
          }
        }
      }
    }
    return mergeGeos(parts);
  }
  // resample a polyline axis (share `from`..`to` of its length), Catmull-Rom
  function sampleAxis(ax, n, from, to) {
    const out = [], m = ax.length - 1;
    for (let i = 0; i < n; i++) {
      const u = lerpN(from, to, i / (n - 1)) * m, k = Math.min(m - 1, Math.floor(u)), t = u - k;
      const c0 = ax[Math.max(0, k - 1)], c1 = ax[k], c2 = ax[k + 1], c3 = ax[Math.min(m, k + 2)];
      const t2 = t * t, t3 = t2 * t, q = [];
      for (let e = 0; e < 3; e++) q.push(0.5 * ((2 * c1[e]) + (-c0[e] + c2[e]) * t + (2 * c0[e] - 5 * c1[e] + 4 * c2[e] - c3[e]) * t2 + (-c0[e] + 3 * c1[e] - 3 * c2[e] + c3[e]) * t3));
      out.push(q);
    }
    return out;
  }
  // a hanging bundle's section faces away from the head's back
  function tubeUp(p) { return hairUnit(p[0], 0, p[2]); }

  /* hairGeometry(styleId, S, far, yoke) — the public builder. The unit hair is
     built once per (style, tier) and scaled per head size. `yoke` (optional,
     makeCharacter passes it; rig hair meshes carry it as userData.hairYoke) is
     the shoulder yoke MEASURED on the rig, in the unit head frame — see
     hairChildFit. */
  function hairGeometry(styleId, S, far, yoke) {
    const id = HAIR_STYLES[styleId] ? styleId : "short";
    const unit = shared("hairU|" + id + (far ? "|far" : ""), function () { return hairBuild(id, !!far); });
    const yk = S < 0.53 && yoke ? "|" + [yoke.top, yoke.back, yoke.half, yoke.armX || 0, yoke.armY || 0, yoke.armR || 0].map((v) => v.toFixed(3)).join(",") : "";
    return shared("hair|" + id + "|" + S.toFixed(3) + (far ? "|far" : "") + yk, function () {
      const g = unit.clone(), k = S / 0.60;
      if (S < 0.53) hairChildFit(g, S, yk ? yoke : null);
      g.scale(k, k, k);
      if (!far) hairFollowMorph(g, k, yk ? yoke : null);
      g.computeBoundingBox(); g.computeBoundingSphere();
      return g;
    });
  }

  /* ==== HAIR FOLLOW — the hanging length stays on the back ==================
     OWNER: long hair passed into the shoulders at ~45 degree head turns. The
     hair is one mesh on the NECK pivot, so a head yaw swung the whole hanging
     length with it — at 0.85 rad a shoulder-length curtain went 6-8 cm into
     the trapezius and upper arm (tools/overlap-audit.mjs, before this).
     Real hair below the nape lies on the back and stays there while the head
     turns. That is a DEFORMATION, not a second rigid piece: cutting the
     length off and counter-rotating it opens a crack r*theta wide at the cut
     (~19 cm at 45 degrees for a curtain 0.35 behind the neck axis).

     So the near hair carries SIX MORPH TARGETS (relative position deltas):
     the lower-back hair counter-rotated about the neck's own yaw axis by
     +-HAIR_FOLLOW.max/2 and +-max, and about its pitch axis for the head
     tipped BACK by pitch/2 and pitch (tipped forward the length lifts off the
     back by itself). No normal targets: r128 draws 8 position targets but
     only 4 with normals, and a turn about the vertical keeps a normal's y,
     which is what the overhead sun reads. Weighted by a smooth field (below)
     — 1 on the length hanging behind the nape and on everything down at the
     shoulders, 0 on the scalp, the ears and the face-framing locks above the
     shoulders, so those follow the face and nothing tears. hairFollowSync
     reads the neck's actual yaw and pitch right before the mesh draws
     (onBeforeRender — facial.js, reactions.js and the aim head-track all add
     yaw AFTER animChar) and sets the influences (at most four non-zero); a
     yaw past `max` just turns the rest. A forward-nod pair was tried and
     REMOVED: the rig nods about the BODY's x axis after the yaw (Euler XYZ),
     so a nod target built in the head frame swings a turned head's curtains
     sideways into the shoulder (the audit measured it worse, not better).
     Cost: six numbers per long-haired rig per frame, zero geometry work.
     Only styles whose hair actually hangs behind the nape get targets (long,
     locs, bob, pony, pigtail, afro...: measured by hairFollowMorph, not
     listed), the FAR tier never does, and pedinstance.js refuses a morph
     geometry, so a near long-haired rig draws its own hair (one call) and a
     far one pools as before. headwear.js swaps in its own (morph-free)
     compressed geometry under a hat: hairFollowSync sees no targets and holds
     the influences at 0 (a stale influence on a morph-free geometry would
     SHRINK it — r128 scales the base by 1 - sum for absolute morphs). */
  /* THE FIELD: w = 1 on hair that has LEFT THE SKULL (further than `d1` off
     the analytic skull every style is fitted to, hairSkullSdf), 0 on the scalp
     layer (nearer than `d0`) — scalp hair sits on the head and must turn with
     it — and only below the skull's equator (y) and behind the ears (z), so
     face-framing locks, fringes and every short cut follow the face exactly.
     Distance, not height, is what separates "on the head" from "hanging":
     the nape of a crop is low but on the skin; a curtain at jaw height is
     centimetres off the skull. `hangs` (a vertex with w > 0.5) decides
     whether a style gets targets at all, so short cuts stay poolable. */
  const HAIR_FOLLOW = { d0: 0.015, d1: 0.04, full: 0.05, fade: 0.20, scalp: 0.18, zFront: -0.06, zBack: -0.22, max: 0.90, pitch: 0.50 };
  // the yoke top in the unit head frame: 0.05 over the neck pivot on an adult,
  // higher on a young body whose head sinks into the shoulders (the measured
  // line hairChildFit uses: 0.137 -> 0.085 as the head grows 0.37 -> 0.47)
  function hairYokeTop(S) { return S >= 0.53 ? 0.05 : Math.max(0.05, 0.137 - Math.max(0, S - 0.368) * 0.53); }
  function hairFollowW(x, y, z, S, yoke) {    // unit head frame (neck pivot origin, skull centre y 0.30)
    const F = HAIR_FOLLOW, yT = yoke ? yoke.top : hairYokeTop(S);
    // at and below the yoke top ALL of it stays with the body, in front as
    // well as behind (a lock lying on the chest stays on the chest) — and so
    // does whatever lies near a SHOULDER: on a small body the arm tops sit up
    // beside the jaw (the measured yoke carries the arm pivots)
    let below = sm01((yT + 0.05 - y) / 0.06);
    if (yoke && yoke.armR > 0) {
      const d = Math.hypot(Math.abs(x) - yoke.armX, y - yoke.armY, z);
      below = Math.max(below, sm01((yoke.armR + 0.10 - d) / 0.06));
    }
    // BEHIND the ears the hanging length stays with the body from a lock
    // segment above the shoulders down (a 13 cm lock segment interpolated
    // across a partial weight would chord into the yoke), fading out up the
    // back of the skull — where only hair standing OFF the scalp moves
    const wz = sm01((F.zFront - z) / (F.zFront - F.zBack));
    if (!(wz > 0)) return below;
    const wy = sm01((yT + F.full + F.fade - y) / F.fade);
    if (!(wy > 0)) return below;
    const off = Math.max(sm01((yT + F.scalp - y) / 0.08), sm01((hairHeadDist(x, y, z) - F.d0) / (F.d1 - F.d0)));
    return Math.max(below, wy * wz * off);
  }
  // distance off the head (skull + neck column): hairSkullSdf answers a flat
  // 0.05 under the lifted skull base, so below it the skull's own base line
  // (0.12 b^2, the lift headGeometry applies) stands in, and the neck column
  // (the head mesh's neck, ~0.16 round the pivot) keeps nape hair on the skin
  function hairHeadDist(x, y, z) {
    const b = cl01(-z / 0.30), base = 0.12 * b * b;
    const skull = y < base ? base - y + 0.02 : hairSkullSdf(x, y, z);
    const neck = Math.hypot(x, z + 0.025) - 0.16;
    return Math.min(skull, y < 0.20 ? neck : 1);
  }
  function hairFollowMorph(g, k, yoke) {
    const pos = g.attributes.position, n = pos.count;
    const W = new Float32Array(n);
    let hangs = false;
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i) / k, y = pos.getY(i) / k, z = pos.getZ(i) / k;
      W[i] = hairFollowW(x, y, z, k * 0.60, yoke);
      if (W[i] > 0.5) hangs = true;
    }
    if (!hangs) return;
    const tp = [];
    const F = HAIR_FOLLOW;
    // yaw targets: a neck yaw of +a is undone by R_y(-a * w)
    for (const a of [F.max / 2, F.max, -F.max / 2, -F.max]) {
      const dp = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const w = W[i]; if (!w) continue;
        const c = Math.cos(-a * w), s = Math.sin(-a * w), x = pos.getX(i), z = pos.getZ(i);
        dp[i * 3] = c * x + s * z - x; dp[i * 3 + 2] = -s * x + c * z - z;
      }
      tp.push(new THREE.BufferAttribute(dp, 3));
    }
    // pitch targets: the head tipped BACK (neck x < 0) is undone by R_x(+b * w)
    for (const b of [F.pitch / 2, F.pitch]) {
      const dp = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const w = W[i]; if (!w) continue;
        const c = Math.cos(b * w), s = Math.sin(b * w), y = pos.getY(i), z = pos.getZ(i);
        dp[i * 3 + 1] = c * y - s * z - y; dp[i * 3 + 2] = s * y + c * z - z;
      }
      tp.push(new THREE.BufferAttribute(dp, 3));
    }
    g.morphAttributes.position = tp;
    g.morphTargetsRelative = true;
    g.userData.hairFollow = true;
  }
  // piecewise-linear pair of influences for |v| / max through the half and full targets
  function hairPair(v, max, out, i0) {
    const a = Math.min(1, Math.abs(v) / max);
    out[i0] = a <= 0.5 ? 2 * a : 2 - 2 * a; out[i0 + 1] = a <= 0.5 ? 0 : 2 * a - 1;
  }
  // the influences for a neck pose: [yaw +half, +full, -half, -full, back half, back full]
  function hairFollowInfluences(yaw, pitch, out) {
    const F = HAIR_FOLLOW;
    for (let i = 0; i < 6; i++) out[i] = 0;
    if (yaw > 0) hairPair(yaw, F.max, out, 0); else if (yaw < 0) hairPair(yaw, F.max, out, 2);
    if (pitch < 0) hairPair(pitch, F.pitch, out, 4);
    return out;
  }
  /* ============================================================
     THE NECK HAS A RANGE. Owner: "when shot, people's head turns backward,
     which would break the neck." A dozen systems write rig.neck.rotation
     (look-at, stare, the hit snap, the fall keys, the corpse sprawl and
     jolt, the ragdoll), most of them as ADDITIVE offsets backed out the next
     frame, and nothing anywhere said how far a neck turns. One feedback bug
     (meleeposes' passive counter-turn reading its own last write) ran the
     yaw up to 143 degrees on an arm shot, and a face-down corpse took the
     keyed 81-degree cheek-on-the-floor turn PLUS its sprawl PLUS a jolt per
     round to 132. A real cervical spine turns about 80 degrees each way,
     nods about 60 (chin to chest), tips back about 50 and tilts about 40.

     So the limit lives in the body, once, for every human in every game:
       · RENDER: every rig's neck composes its matrix from the clamped
         angles (neckUpdateMatrix). Whatever any writer leaves in
         .rotation, the head that draws and the head the hit zones read
         (matrixWorld) are inside the range. The stored value is NOT
         touched, so additive writers still back out exactly what they put
         on (clamping their storage would break their bookkeeping).
       · ABSOLUTE writers (a fall pose, a corpse) call
         CBZ.human.clampNeck(neck) to keep their storage in range too.
     Conventions (facing +z): rotation.x > 0 chin down, < 0 looks up;
     rotation.y turns the face; rotation.z tilts the ear to the shoulder.
     tools/neck-limit-check.mjs fires rounds from every side and holds both
     the drawn and the stored neck to these numbers. */
  const NECK_LIMITS = Object.freeze({
    yaw: 1.40,        // ~80 deg each way
    flex: 1.05,       // ~60 deg chin to chest (+x)
    ext: 0.87,        // ~50 deg looking up / head thrown back (-x)
    roll: 0.70,       // ~40 deg ear to shoulder
  });
  function clampNeckValue(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function neckInRange(r) {
    const L = NECK_LIMITS;
    return r.x <= L.flex && r.x >= -L.ext && r.y <= L.yaw && r.y >= -L.yaw && r.z <= L.roll && r.z >= -L.roll;
  }
  // in place: for writers that own the channel outright every frame
  function clampNeck(neck) {
    if (!neck || !neck.rotation) return false;
    const r = neck.rotation, L = NECK_LIMITS;
    if (r.x === r.x && r.y === r.y && r.z === r.z && neckInRange(r)) return false;
    r.set(clampNeckValue(r.x || 0, -L.ext, L.flex), clampNeckValue(r.y || 0, -L.yaw, L.yaw), clampNeckValue(r.z || 0, -L.roll, L.roll));
    return true;
  }
  const _neckE = new THREE.Euler(), _neckQ = new THREE.Quaternion();
  // the drawn neck: Object3D.updateMatrix with the angles held to the range
  // (userData.tiltX / tiltZ: a DRAWN-only nod/tilt a holder lays over whatever
  // the animation stored — the phone read's chin-down — set and cleared by
  // its owner, so no damped channel ever integrates it)
  function neckUpdateMatrix() {
    const r = this.rotation, L = NECK_LIMITS, ud = this.userData;
    const tx = (ud && ud.tiltX) || 0, tz = (ud && ud.tiltZ) || 0;
    if (!tx && !tz && neckInRange(r)) {
      this.matrix.compose(this.position, this.quaternion, this.scale);
    } else {
      _neckE.set(clampNeckValue((r.x || 0) + tx, -L.ext, L.flex), clampNeckValue(r.y || 0, -L.yaw, L.yaw),
        clampNeckValue((r.z || 0) + tz, -L.roll, L.roll), r.order);
      _neckQ.setFromEuler(_neckE);
      this.matrix.compose(this.position, _neckQ, this.scale);
    }
    this.matrixWorldNeedsUpdate = true;
  }
  /* ============================================================
     THE ARMS HAVE A RANGE (shoulder, elbow, wrist) — the neck's law, for the
     arms. Owner (iPad): "when the player's holding the phone, their arm looks
     really stupid. It contorts weirdly." Measured: the third-person phone
     hold solved the shoulder to x -8, z +87 degrees with the elbow at 96 —
     the upper arm lay HORIZONTAL ACROSS THE CHEST at shoulder height, the
     elbow 13 cm off the sternum, the forearm swinging forward off it like a
     door. charArmTo's closed form keeps the shoulder's twist at zero, and
     with a deeply bent elbow the wrist's offset from the upper arm's line is
     almost all forward, so the sideways swing it needs is asin(dx / |uy|)
     with |uy| near zero: any hand a little inboard of the shoulder throws
     the upper arm across the body. Nothing anywhere said that was not a
     shoulder.

     So every arm joint has a range, in ANATOMICAL terms (not Euler
     components, which mean different things after a quaternion writer —
     charArmTo.wrist, a plant, a gun hold — has been through them):
       SHOULDER  the upper arm's direction in the body: at most ~60 degrees
                 behind the body line, and across the front only as far as
                 the arm is raised forward (a hanging arm crosses ~25
                 degrees; one raised in front may reach the far shoulder);
                 humeral twist within ~100 degrees either way.
       ELBOW     a hinge: 0..150 degrees of flexion, never backward (3
                 degrees of slack for a locked arm), ~11 degrees of side
                 play; the forearm's own twist lives in the forearm loft.
       WRIST     ~80 degrees toward the palm, ~80 back, ~35 sideways.
     Like the neck, the DRAWN pose composes from the clamped angles (the
     joint's updateMatrix), so whatever any writer leaves, what renders and
     what the hit zones read is a joint a person has; the stored rotation is
     untouched (blend-from-current writers keep their state). Writers that
     own the channel outright clamp their storage: CBZ.human.clampArm(rig).
     tools/arm-limit-check.mjs holds every pose (and the phone holds) to it. */
  const ARM_LIMITS = Object.freeze({
    back: 0.87,         // sin(~60 deg): how far behind the body line the upper arm goes
    across: 0.42,       // how far across the front a hanging upper arm swings (inward x)…
    acrossFwd: 0.62,    // …plus this much per unit of forward raise
    twist: 1.75,        // ~100 deg humeral rotation either way
    elFlex: 2.62,       // ~150 deg elbow flexion
    elExt: 0.05,        // ~3 deg past straight, no further
    elSide: 0.20,       // ~11 deg of side play at the elbow
    elTwist: 1.60,      // the elbow group's own twist (pronation is the forearm loft's)
    wrFlex: 1.40,       // ~80 deg toward the palm
    wrExt: 1.40,        // ~80 deg back of the hand
    wrDev: 0.62,        // ~35 deg radial / ulnar
  });
  const _alQ = new THREE.Quaternion(), _alS = new THREE.Quaternion(), _alT = new THREE.Quaternion();
  const _alD = new THREE.Vector3(), _alA = new THREE.Vector3(), _alB = new THREE.Vector3();
  const AL_DOWN = new THREE.Vector3(0, -1, 0), AL_FWD = new THREE.Vector3(0, 0, -1);
  function wrapPi(a) { return a > Math.PI ? a - 2 * Math.PI : (a < -Math.PI ? a + 2 * Math.PI : a); }
  // twist of q about local +Y (swing-twist), radians
  function twistY(q) { return wrapPi(2 * Math.atan2(q.y, q.w)); }
  // q = swing(dir from -Y) * twist(about Y); rebuilt into `out`
  function swingTwist(dir, tw, out) {
    _alS.setFromUnitVectors(AL_DOWN, dir);
    _alT.set(0, Math.sin(tw / 2), 0, Math.cos(tw / 2));
    return out.copy(_alS).multiply(_alT);
  }
  /* SHOULDER. q: the arm group's quaternion in the body frame; sg: +1 for the
     arm on +x, -1 on -x. Writes the in-range quaternion to `out`; returns
     true if it had to move. */
  function shoulderLimit(q, sg, out) {
    const L = ARM_LIMITS;
    // the upper arm's direction: q * (0,-1,0)
    let dx = -2 * (q.x * q.y - q.w * q.z), dy = -(1 - 2 * (q.x * q.x + q.z * q.z)), dz = -2 * (q.y * q.z + q.w * q.x);
    const tw = twistY(q);
    let o = dx * sg, moved = false;
    if (dz < -L.back) { dz = -L.back; moved = true; }
    const lim = -(L.across + L.acrossFwd * Math.max(0, dz) + 0.5 * Math.max(0, dy));
    if (o < lim) { o = lim; moved = true; }
    const twOk = Math.abs(tw) <= L.twist || dy > 0.9;        // straight up: twist is undefined
    if (!moved && twOk) return false;
    if (moved) {
      // keep the clamped components, give the rest to the vertical
      const r = 1 - o * o - dz * dz;
      dy = r > 0 ? (dy >= 0 ? 1 : -1) * Math.sqrt(r) : 0;
      _alD.set(o * sg, dy, dz).normalize();
    } else _alD.set(dx, dy, dz).normalize();
    swingTwist(_alD, Math.max(-L.twist, Math.min(L.twist, tw)), out);
    return true;
  }
  /* ELBOW. q: the elbow group's quaternion in the upper arm's frame. The
     forearm (-Y) may swing only forward (+Z) up to elFlex, a hair back, and a
     little sideways; its own twist within elTwist. */
  function elbowLimit(q, out) {
    const L = ARM_LIMITS;
    const fx = -2 * (q.x * q.y - q.w * q.z), fy = -(1 - 2 * (q.x * q.x + q.z * q.z)), fz = -2 * (q.y * q.z + q.w * q.x);
    const flex = Math.atan2(fz, -fy), side = Math.asin(Math.max(-1, Math.min(1, fx)));
    const tw = twistY(q);
    if (flex <= L.elFlex && flex >= -L.elExt && Math.abs(side) <= L.elSide && Math.abs(tw) <= L.elTwist) return false;
    // a forearm folded "past" 180 is a backward bend: it clamps to straight
    const f = flex > L.elFlex ? (flex > (L.elFlex + Math.PI) / 2 + 0.5 ? -L.elExt : L.elFlex) : Math.max(-L.elExt, flex);
    const s = Math.max(-L.elSide, Math.min(L.elSide, side)), cs = Math.cos(s);
    _alD.set(Math.sin(s), -cs * Math.cos(f), cs * Math.sin(f));
    swingTwist(_alD, Math.max(-L.elTwist, Math.min(L.elTwist, tw)), out);
    return true;
  }
  /* WRIST. q: the hand's quaternion in the elbow frame; rest = the hand frame
     placeBodyHand builds (fingers -Z_h down the forearm's -Y). The forearm's
     axis seen from the hand, A = q^-1 (0,-1,0), is (0,0,-1) at rest; flexion
     tips it toward +Y_h (fingers to the palm), deviation toward +-X_h. */
  function wristLimit(q, out) {
    const L = ARM_LIMITS;
    _alQ.copy(q).invert();
    _alA.copy(AL_DOWN).applyQuaternion(_alQ);
    const ax = _alA.x, ay = _alA.y, az = _alA.z;
    const fl = Math.atan2(ay, -az), dv = Math.atan2(ax, -az);
    if (fl <= L.wrFlex && fl >= -L.wrExt && Math.abs(dv) <= L.wrDev && az < 0) return false;
    const f2 = Math.max(-L.wrExt, Math.min(L.wrFlex, fl)), d2 = Math.max(-L.wrDev, Math.min(L.wrDev, dv));
    _alB.set(Math.tan(d2), Math.tan(f2), -1).normalize();     // the in-range forearm axis, hand frame
    // q' = q * R(B -> A): then q'^-1 (0,-1,0) = B
    _alS.setFromUnitVectors(_alB, _alA);
    out.copy(q).multiply(_alS);
    return true;
  }
  function armRoot(o) { return !!o._armBody && o.parent === o._armBody; }
  // the drawn joints: Object3D.updateMatrix with the joint held to its range
  function shoulderUpdateMatrix() {
    if (armRoot(this) && shoulderLimit(this.quaternion, this.position.x >= 0 ? 1 : -1, _neckQ)) this.matrix.compose(this.position, _neckQ, this.scale);
    else this.matrix.compose(this.position, this.quaternion, this.scale);
    this.matrixWorldNeedsUpdate = true;
  }
  function elbowUpdateMatrix() {
    if (elbowLimit(this.quaternion, _neckQ)) this.matrix.compose(this.position, _neckQ, this.scale);
    else this.matrix.compose(this.position, this.quaternion, this.scale);
    this.matrixWorldNeedsUpdate = true;
  }
  function wristUpdateMatrix() {
    if (wristLimit(this.quaternion, _neckQ)) this.matrix.compose(this.position, _neckQ, this.scale);
    else this.matrix.compose(this.position, this.quaternion, this.scale);
    this.matrixWorldNeedsUpdate = true;
  }
  // in place, for writers that own the arms outright: true if anything moved
  const _alO = new THREE.Quaternion();
  function clampArm(rig, arm) {
    let any = false;
    for (const k of arm === "l" ? ["la"] : arm === "r" ? ["ra"] : ["la", "ra"]) {
      const part = rig && rig.parts && rig.parts[k];
      if (!part) continue;
      const low = part.userData.low, cap = part.userData.cap;
      if (shoulderLimit(part.quaternion, part.position.x >= 0 ? 1 : -1, _alO)) { part.quaternion.copy(_alO); any = true; }
      if (low && elbowLimit(low.quaternion, _alO)) { low.quaternion.copy(_alO); any = true; }
      if (cap && cap.userData.fit && wristLimit(cap.quaternion, _alO)) { cap.quaternion.copy(_alO); any = true; }
    }
    return any;
  }
  // tools: the anatomical angles of one arm as drawn-from-storage (radians)
  function armAngles(rig, arm) {
    const part = rig && rig.parts && rig.parts[arm === "l" ? "la" : "ra"];
    if (!part) return null;
    const q = part.quaternion, sg = part.position.x >= 0 ? 1 : -1;
    const d = _alD.copy(AL_DOWN).applyQuaternion(q);
    const lq = part.userData.low.quaternion;
    const f = _alA.copy(AL_DOWN).applyQuaternion(lq);
    const out = { out: d.x * sg, fwd: d.z, up: d.y, twist: twistY(q), flex: Math.atan2(f.z, -f.y), side: Math.asin(Math.max(-1, Math.min(1, f.x))), elTwist: twistY(lq) };
    const cap = part.userData.cap;
    if (cap && cap.userData.fit) {
      _alQ.copy(cap.quaternion).invert();
      const a = _alB.copy(AL_DOWN).applyQuaternion(_alQ);
      out.wrFlex = Math.atan2(a.y, -a.z); out.wrDev = Math.atan2(a.x, -a.z); out.wrAz = a.z;
    }
    return out;
  }
  function armInRange(rig, arm, eps) {
    const L = ARM_LIMITS, e = eps || 1e-3, A = armAngles(rig, arm);
    if (!A) return true;
    const lim = -(L.across + L.acrossFwd * Math.max(0, A.fwd) + 0.5 * Math.max(0, A.up));
    const bad = [];
    if (A.fwd < -L.back - e) bad.push("shoulder behind");
    if (A.out < lim - e) bad.push("shoulder across");
    if (Math.abs(A.twist) > L.twist + e && A.up <= 0.9) bad.push("shoulder twist");
    if (A.flex > L.elFlex + e) bad.push("elbow over-flexed");
    if (A.flex < -L.elExt - e) bad.push("elbow backward");
    if (Math.abs(A.side) > L.elSide + e) bad.push("elbow sideways");
    if (Math.abs(A.elTwist) > L.elTwist + e) bad.push("elbow twist");
    if (A.wrFlex != null && (A.wrFlex > L.wrFlex + e || A.wrFlex < -L.wrExt - e || Math.abs(A.wrDev) > L.wrDev + e || A.wrAz >= 0)) bad.push("wrist");
    return bad.length ? bad : true;
  }
  // per hair mesh, right before it draws (and callable by tools): neck pose -> influences
  function hairFollowSync(mesh) {
    const inf = mesh.morphTargetInfluences;
    if (!inf || inf.length < 6) return;
    const g = mesh.geometry, on = g && g.morphAttributes && g.morphAttributes.position && g.morphAttributes.position.length >= 6;
    const neck = mesh.parent;
    if (!on || !neck) { for (let i = 0; i < inf.length; i++) inf[i] = 0; return; }
    const L = NECK_LIMITS;
    hairFollowInfluences(clampNeckValue(neck.rotation.y, -L.yaw, L.yaw), clampNeckValue(neck.rotation.x, -L.ext, L.flex), inf);
    // a painter that swapped the material in (crowd.js paint, heritage) must
    // still read the targets; the flag is harmless on any mesh without them
    const m = mesh.material;
    if (m && !Array.isArray(m) && !m.morphTargets) { m.morphTargets = true; m.needsUpdate = true; }
  }
  function hairFollowRender() { hairFollowSync(this); }
  /* A CHILD'S HEAD SITS DOWN IN THE SHOULDERS (charProfile's neckDrop) and the
     yoke is deeper than the head, so hair hung for an adult would sit inside a
     small child's back. Measured off the profiles (unit-head frame): the yoke
     top runs 0.137 -> 0.085 and its back -0.322 -> -0.270 as the head grows
     0.37 -> 0.47. Whatever HANGS (not what hugs the skull) behind the neck is
     eased back behind that yoke — one smooth displacement field, so nothing
     tears. Adults (S >= 0.53) are never touched. */
  function hairChildFit(g, S, yoke) {
    // the yoke top / back face: MEASURED on the rig when it is known (it is
    // whatever the torso build says it is), else the profile fit above
    const t = Math.max(0, S - 0.368) * 0.53;
    const top = yoke ? yoke.top : 0.137 - t, back = yoke ? yoke.back : -0.322 + t;
    const yTop = top + 0.03, zBack = back - 0.016;
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (y > yTop + 0.06 || z > zBack + 0.06) continue;
      const hang = sm01((hairSkullSdf(x, y, z) - 0.012) / 0.03) * sm01((yTop + 0.06 - y) / 0.06);
      const zt = Math.min(z, zBack - 0.06 * cl01((yTop - y) / 0.3));
      if (hang > 0 && zt < z) pos.setZ(i, lerpN(z, zt, hang));
    }
    /* THE NAPE SITS ON THE YOKE, NOT IN IT (tools/overlap-audit.mjs: a
       toddler's buzz cut went 13 mm into the yoke standing still). The
       displacement above only moves hair that stands OFF the skull; a young
       head is sunk so deep in the shoulders that the scalp layer at the nape
       is already below the yoke top. Whatever is left inside the yoke's
       measured footprint is lifted onto a ledge just above it — the hairline
       reads as sitting on the collar, which is what a small child's does. */
    if (yoke) {
      const ledge = yoke.top + 0.02;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        if (y >= ledge || Math.abs(x) > yoke.half + 0.004 || z > 0.05) continue;   // (the chin is the jaw's business)
        // just behind the back face: stand off it, so an edge from the ledge
        // down the back cannot cut the yoke's top-back corner
        if (z < yoke.back - 0.004) { if (z > yoke.back - 0.06) pos.setZ(i, yoke.back - 0.06); continue; }
        pos.setY(i, lerpN(y, ledge, sm01((ledge - y) / 0.02 + 0.5)));
      }
      // …and off the SHOULDERS: a small body's side hair falls onto arm tops
      // that sit right under the jaw. Anything inside the ball round either
      // arm pivot (+ a clearance) is pushed out along its radius.
      if (yoke.armR > 0) {
        const R = yoke.armR + 0.02;
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
          const dx = x - Math.sign(x) * yoke.armX, dy = y - yoke.armY, d = Math.hypot(dx, dy, z);
          if (d >= R || d < 1e-6) continue;
          const s = R / d;
          pos.setXYZ(i, Math.sign(x) * yoke.armX + dx * s, yoke.armY + dy * s, z * s);
        }
      }
    }
    pos.needsUpdate = true;
  }
  // the hair's LOD, swapped with the body's: userData.hairLods holds the pair
  // (headwear may replace them with hat-compressed versions)
  function setHairLod(rig, lod) {
    if (rig && rig._hw && CBZ.headwear) CBZ.headwear.setLod(rig, lod);   // the hat swaps with the hair
    const hs = rig && rig.skinSlots && rig.skinSlots.hair;
    if (!hs) return;
    for (let i = 0; i < hs.length; i++) {
      const m = hs[i], L = m && m.userData.hairLods;
      if (!L) continue;
      const g = lod >= 2 ? L.far : L.near;
      if (g && m.geometry !== g) { m.geometry = g; hairFollowSync(m); }   // a morph-free tier holds 0 influence
    }
  }

  /* Pick a style. NO RNG LIVES HERE — this file has no seeded stream in scope
     (the Math.random below is runtime-only gait desync, never appearance), and
     appearance must stay byte-identical per seed for multiplayer. So the roll
     stays the caller's (peds.js rolls it seeded) and this is a pure function of
     what the caller asked for plus the body it is building.

     `c.hairStyle` is the explicit control. `c.longHair` is the LEGACY boolean
     and still works untouched (player.js, peds.js, entities/crowd.js). */
  function hairStyleFor(c, P) {
    if (c.hairStyle && HAIR_STYLES[c.hairStyle]) return c.hairStyle;
    if (c.bald) return "buzz";
    if (P.band === "baby") return "buzz";                  // wispy, barely there
    // Before puberty a boy and a girl share one body — the read comes from hair
    // and dress, exactly as it does in life.
    if (P.child) return P.fem ? (c.longHair ? "pigtail" : "bob") : "crop";
    if (P.fem) return c.longHair ? "long" : "bob";
    return "short";
  }

  /* ==== TORSO — NECK, SHOULDERS, CHEST, BACK, WAIST, PELVIS =================
     Owner, 2026-09-28: "like a little kid drew everything there and you're
     redrawing it." The limbs, hands and face had been redrawn; the body they
     hung off was still four painted boxes: a chest box, an optional waist box,
     a flat shoulder SLAB (the "yoke") laid across the top of the chest with the
     chin sitting in it, and a pelvis box. No shoulders, no neck showing, no
     chest, no back, no waist on a man.

     WHAT IT IS NOW. One continuous body SHAPE per (profile, physique, head
     form, age) — a stack of rounded cross sections (superellipses) from inside
     the pelvis up to the neck — that every torso part SAMPLES:
       · CHEST (skinSlots.torso[0]) — ribcage taper, a pectoral shelf (men) or a
         bust (women, modest: a lobe with a soft underside, a natural cleavage
         dip, no exaggeration), shoulder blades and a spine groove on the back,
         lats into the armpit, then the SHOULDER: the section widens out to the
         arm pivot and the TRAPEZIUS slopes from there up to the neck, the top
         ring tipping forward (the collarbone notch sits lower than C7).
       · WAIST (torso[1], women and children) — the same surface below the
         chest, its top tucked a hair inside the chest so the seam is hidden.
       · PELVIS — hips out to the thighs, glutes and a cleft behind, the crotch
         bridging the legs, and a waistband ledge the torso tucks into.
       · COLLAR (skinSlots.collar, was the slab) — a real collar band standing
         round the base of the neck, dressed with the yoke atlas (shirt collar,
         the tie knot at the throat).
       · NECK (in headGeometry) — a lofted column: sternocleidomastoid ridges
         from behind the ear to the collarbone notch, an Adam's apple on men,
         the suprasternal notch, the nape. The HEAD RIDES NECK_LEN higher and
         the ARM PIVOTS sit SHOULDER_DROP below the column top (was 0.04), so
         there is neck between the chin and the collar instead of a chin in a
         slab, and the trapezius has somewhere to slope to.

     SHOULDER SEAM. The lateral end of the shoulder section is built INSIDE the
     ball the arm's own top dome always covers round its pivot (limb(): every
     segment's end dome is centred on its joint), so whatever the arm does —
     raised, forward, behind the back in cuffs — the deltoid still swallows
     the end of the shoulder: no gap can open. tools/torso-check.mjs sweeps it.

     PAINT. Each ring's circumference is four faces at 45° like a box
     (front / side / back / side, BoxGeometry's u directions), u is a PLANAR
     projection across the face (so a lapel painted 30% across the front lands
     30% across the chest) and v runs the OLD box span, so city/clothes.js's
     atlas rows land where they always did. geometry.parameters still reports
     the box each part replaced (armor, wounds, warlord kits size off it).
     CLOTHES FOLLOW THE BODY: CBZ.humanShellSpec builds the jacket shell, the
     prison stripes and armour as offset shells of the same surface.

     INSTANCING. The shape is a pure function of the profile key, so every
     adult average man shares ONE chest geometry object (one per LOD), and
     pedinstance.js pools it by geometry exactly like the hair shells.
     LOD: rig.setHandLod(2) swaps the torso parts to their 12-around far lofts
     together with the limbs. */
  const NECK_LEN = 0.09;          // the head rides this far above the column top (adult)
  const SHOULDER_DROP = 0.10;     // the arm pivot sits this far below the column top (adult)
  const TORSO_SPECS = Object.create(null), TORSO_GEO = Object.create(null);
  const SQH = Math.SQRT1_2;
  const TORSO_FACE = ["front", "side", "back", "side", "cap"];
  const gss = (x, s) => Math.exp(-(x / s) * (x / s));
  const winK = (k, a, b) => sm01((k - a) / 0.08) * sm01((b - k) / 0.08);
  // Monotone cubic (Fritsch-Carlson) through keyed rows: smooth, no overshoot.
  function pchip(xs, ys) {
    const n = xs.length, h = [], dl = [], m = new Float64Array(n);
    for (let i = 0; i < n - 1; i++) { h[i] = xs[i + 1] - xs[i]; dl[i] = (ys[i + 1] - ys[i]) / h[i]; }
    m[0] = dl[0]; m[n - 1] = dl[n - 2];
    for (let i = 1; i < n - 1; i++) {
      if (dl[i - 1] * dl[i] <= 0) m[i] = 0;
      else { const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]; m[i] = (w1 + w2) / (w1 / dl[i - 1] + w2 / dl[i]); }
    }
    return function (x) {
      if (x <= xs[0]) return ys[0];
      if (x >= xs[n - 1]) return ys[n - 1];
      let i = 0;
      while (i < n - 2 && xs[i + 1] < x) i++;
      const t = (x - xs[i]) / h[i], t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1];
    };
  }
  const RING_FIELDS = ["a", "zf", "zb", "zc", "n", "tw"];
  function ringTable(rows) {
    for (let i = 1; i < rows.length; i++) if (rows[i].y < rows[i - 1].y + 0.002) rows[i].y = rows[i - 1].y + 0.002;
    const ys = rows.map((r) => r.y), f = {};
    for (const k of RING_FIELDS) f[k] = pchip(ys, rows.map((r) => r[k]));
    return function (y) { const r = { y }; for (const k of RING_FIELDS) r[k] = f[k](y); return r; };
  }

  /* The body's shape record. Everything is in BODY-local authored units (the
     frame the old boxes were placed in), derived from the profile — nothing
     here is an adult-male literal except the relative section shape. */
  function torsoSpec(P, form, elder, headZ) {
    const key = P.key + "|" + form + "|" + elder + "|" + (headZ || 0).toFixed(3);
    let S = TORSO_SPECS[key];
    if (S) return S;
    const hipY = P.legUp + P.legLo, base = hipY - 0.005;
    const neckY = base + P.torsoH - 0.015;
    const vs = P.torsoH / 0.95;                                 // column scale (child/female)
    const nk = P.headSize > 0 ? cl01(1 - P.neckDrop / (P.headSize * 0.17)) : 1;
    const hk = P.headSize / 0.60;
    const F = HEAD_FORMS[form] || HEAD_FORMS.m;
    const W = P.torsoW / 2, D = P.torsoD / 2, R = P.armW / 2, AX = P.armX;
    // the head first (a young child still carries it low, half the old sink),
    // then the shoulders: never so high that the trapezius cannot pass under the chin
    const pivotY = neckY + NECK_LEN * vs * nk - 0.6 * P.neckDrop;
    const shoulderY = Math.min(neckY - SHOULDER_DROP * vs * (0.4 + 0.6 * nk), pivotY - 0.075 * vs - 0.43 * R);
    const ph = PHYSIQUE[P.physique] || PHYSIQUE.average;
    const fem = P.fem ? (P.child ? cl01((P.ageYears - 11) / 5) : 1) : 0;
    const man = P.fem ? 0 : (P.child ? cl01((P.ageYears - 12) / 6) : 1);
    const kidK = P.child ? cl01((P.ageYears - 2) / 14) : 1;     // a body's definition fades in with age
    // THE NECK where it meets the body (headGeometry's column at the junction)
    const nRx = F.neck[1] * 0.98 * hk, nRz = nRx * 0.94, nZc = -0.031 * hk + (headZ || 0);
    const yN = Math.max(Math.min(neckY, pivotY - 0.07 * vs), shoulderY + 0.30 * R + 0.05 * vs);
    const tb = 0.05 * vs;
    const sp = shoulderY - base;
    const kY = (k) => base + k * sp;
    // ---- the PELVIS ------------------------------------------------------
    const pw = P.pelvisW / 2, pd = P.pelvisD / 2, pk = P.pelvisH / 0.20;
    // THE HIPS ARE THE TOPS OF THE THIGHS: the widest section is the thigh's
    // outer line plus a hair of cloth, never a ledge wider than the legs
    // (a man's pelvisW put it 1.6 cm out past his thighs — half the "shorts
    // over trousers" read). A woman's still comes out of her own hipX.
    const hipOut = P.hipX + P.legW / 2 + 0.012;
    const pTop = hipY + 0.03 + P.pelvisH / 2, pBot = hipY - 0.115 * pk;
    const pel = ringTable([
      { y: pBot,                a: Math.max(0.26 * pw, P.hipX - P.legW / 2 + 0.05), zf: 0.40 * pd, zb: 0.50 * pd, zc: 0, n: 2.2, tw: 0 },
      { y: hipY - 0.07 * pk,    a: 0.64 * hipOut, zf: 0.72 * pd, zb: 0.86 * pd, zc: 0, n: 2.4, tw: 0 },
      { y: hipY - 0.01 * pk,    a: 0.94 * hipOut, zf: 0.86 * pd, zb: 0.98 * pd, zc: 0, n: 2.6, tw: 0 },
      { y: hipY + 0.05 * pk,    a: hipOut,        zf: 0.92 * pd, zb: 0.98 * pd, zc: 0, n: 2.7, tw: 0 },
      { y: hipY + 0.10 * pk,    a: Math.min(hipOut, lerpN(hipOut, pw, 0.6)) * 0.985, zf: 0.93 * pd, zb: 0.93 * pd, zc: 0, n: 2.7, tw: 0 },
      { y: pTop,                a: Math.min(0.95 * pw, 0.97 * hipOut), zf: 0.93 * pd, zb: 0.91 * pd, zc: 0, n: 2.7, tw: 0 },
    ]);
    // ---- the COLUMN (chest + waist + shoulders), rows in D/W units ----------
    const waistA = P.waistShare > 0 ? (P.waistW / 2) / W : ph.waist;
    const waistZ = P.waistShare > 0 ? (P.waistD / 2) / D : (ph.soft ? 1.04 : 0.90);
    const aSh1 = (W + (AX - W) * 0.45) / W, aSh2 = (AX - 0.35 * R) / W, aSh3 = (AX - 0.55 * R) / W;
    const chestZ = lerpN(0.96, 0.86, fem);
    // [k, half width /W, front /D, back /D, squareness]. The back is DEEP at the
    // shoulder line (the trapezius over C7 carries the neck) and the section
    // turns elliptical there (n < 2 thins the tips into the deltoid).
    const body = [
      [-0.05, 0.90, 0.86, 0.86, 2.6],
      [0.08, lerpN(0.90, waistA, 0.35), 0.86, 0.84, 2.6],
      [0.24, waistA, waistZ, 0.76 + 0.14 * ph.soft, 2.6],
      [0.40, lerpN(waistA, 0.955, 0.55), lerpN(waistZ, 0.91, 0.5), 0.84, 2.65],
      [0.52, 0.965, 0.93, 0.92, 2.7],
      [0.64, 0.99, chestZ, 0.97, 2.8],
      [0.76, 1.00, chestZ - 0.02, 1.00, 2.9],
      [0.86, aSh1, 0.80, 0.92, 2.3],
      [0.94, aSh2, 0.72, 0.82, 2.0],
      [1.02, aSh3, 0.66, 0.74, 1.9],
    ];
    const rows = [];
    for (const r of body) {
      const y = kY(r[0]);
      const row = { y, a: r[1] * W, zf: r[2] * D, zb: r[3] * D, zc: 0, n: r[4], tw: 0 };
      if (y < pTop + 0.03) {                                    // the shirt tucks INTO the trousers
        const p = pel(Math.min(y, pTop)), cl = 0.016 * vs;
        row.a = Math.min(row.a, p.a - cl); row.zf = Math.min(row.zf, p.zf - cl); row.zb = Math.min(row.zb, p.zb - cl);
      }
      rows.push(row);
    }
    // THE TRAPEZIUS: from the shoulder end (inside the deltoid ball) up and in
    // to the neck, rising steeply only near the neck (y ~ u^2), the ring
    // tipping forward as it goes (tw: 0 at the shoulder, 1 at the neck).
    const yT0 = shoulderY + 0.30 * R, aT0 = AX - 0.95 * R;
    // the front of the neck ring (the collarbone notch) sits lower than its
    // sides, but never lower than the shoulder line allows (no fold)
    const tf = Math.min(0.07 * vs * (0.4 + 0.6 * nk), 0.8 * (yN - yT0));
    for (const u of [0, 0.3, 0.55, 0.78, 1]) {
      rows.push({
        y: yT0 + (yN - yT0) * Math.pow(u, 1.4),
        a: lerpN(aT0, nRx + 0.010 * vs, Math.pow(u, 0.8)),
        zf: lerpN(0.62 * D, nRz + 0.010 * vs, u), zb: lerpN(0.70 * D, nRz + 0.010 * vs, u),
        zc: lerpN(0, nZc, u), n: lerpN(1.9, 2.0, u), tw: u * u,
      });
    }
    // an older back rounds and the shoulders roll forward
    if (elder > 0) for (const r of rows) { const k = (r.y - base) / sp; r.zc += 0.05 * elder * D * sm01((k - 0.7) / 0.4); }
    // THE NECK IS CARRIED BY THE BACK: wherever the neck column is buried (it
    // hangs 0.20 below its pivot), the section's back must lie behind it, or
    // the nape pokes out through the top of the back.
    // (and in front of it: a head thrown back swings the throat forward)
    const S_notch = yN - tf - 0.03 * vs;
    const neckBot = pivotY - 0.20 * hk, needBack = -nZc + nRz * 1.02 + 0.03 * vs, needFront = nZc + nRz + 0.05 * vs;
    for (let i = 0; i < rows.length - 1; i++) {
      const r = rows[i];
      if (r.y > neckBot - 0.02) r.zb = Math.max(r.zb, needBack + r.zc);
      // the front only BELOW the collarbone notch: above it the throat must show
      if (r.y > neckBot - 0.02 && r.y < S_notch) r.zf = Math.max(r.zf, needFront - r.zc);
    }
    const at = ringTable(rows);
    const waistH = P.waistShare > 0 ? P.waistShare * P.torsoH : 0;
    S = TORSO_SPECS[key] = {
      key, P, vs, base, hipY, neckY, shoulderY, pivotY, yN, tf, tb, sp, W, D, R, AX,
      nRx, nRz, nZc, pTop, pBot, hipOut, pw, pd, pk, at, pel,
      yBot: kY(-0.05), yTop: yN, chestBot: base + waistH, waistH,
      // shape weights (features), by sex, physique and age
      pec: man * ph.pec * kidK, pecK: ph.soft ? 0.57 : 0.63,
      bust: fem * ph.bust, bustK: 0.585 - 0.05 * elder,
      belly: (P.child ? 0 : ph.belly * (P.fem ? 0.6 : 1)) + 0.35 * elder,
      scap: ph.scap * (0.4 + 0.6 * kidK), spine: ph.spine * (0.4 + 0.6 * kidK), elder,
      glute: (P.fem ? 1.35 : 1) * (ph.soft ? 1.25 : ph === PHYSIQUE.slim ? 0.75 : 1) * (0.5 + 0.5 * kidK),
    };
    return S;
  }
  // Surface relief on a column section, as a z offset (front +): xn = x / a.
  function featZ(S, k, xn, c) {
    const ax = Math.abs(xn), D = S.D;
    let dz = 0;
    if (c > 0) {
      const fw = Math.pow(c, 0.8);
      if (S.pec > 0) {
        dz += S.pec * 0.10 * D * gss(k - S.pecK, k > S.pecK ? 0.10 : 0.045) * gss(ax - 0.42, 0.30) * fw;
        dz -= S.pec * 0.012 * D * gss(xn, 0.09) * winK(k, 0.42, 0.80) * fw;        // the sternum between
      }
      if (S.bust > 0) dz += S.bust * 0.20 * D * gss(k - S.bustK, k > S.bustK ? 0.11 : 0.065) * gss(ax - 0.40, 0.26) * fw;
      if (S.belly > 0) dz += S.belly * 0.16 * D * gss(k - 0.27, k > 0.27 ? 0.15 : 0.10) * gss(xn, 0.55) * fw;
    } else if (c < 0) {
      const bw = Math.pow(-c, 0.8);
      if (S.scap > 0) dz -= S.scap * 0.07 * D * gss(k - 0.74, k > 0.74 ? 0.09 : 0.12) * gss(ax - 0.42, 0.22) * bw;
      if (S.spine > 0) dz += S.spine * 0.035 * D * gss(xn, 0.07) * winK(k, 0.10, 0.95) * bw;
      if (S.elder > 0) dz -= S.elder * 0.10 * D * gss(k - 0.86, 0.14) * bw;
    }
    return dz;
  }
  function pelvisFeatZ(S, y, xn, c) {
    const ax = Math.abs(xn), pd = S.pd, pk = S.pk;
    let dz = 0;
    if (c < 0) {
      const bw = Math.pow(-c, 0.8);
      dz -= S.glute * 0.16 * pd * gss(y - (S.hipY - 0.015 * pk), 0.055 * pk) * gss(ax - 0.45, 0.30) * bw;
      dz += 0.025 * pd * gss(xn, 0.06) * sm01((S.hipY + 0.03 * pk - y) / (0.03 * pk)) * bw;       // the cleft
    } else if (c > 0 && S.belly > 0) {
      dz += S.belly * 0.05 * pd * gss(y - (S.pTop - 0.03 * pk), 0.05 * pk) * gss(xn, 0.6) * Math.pow(c, 0.8);
    }
    return dz;
  }
  /* One point of a section: face 0 front (u -x -> +x), 1 +x side (front ->
     back), 2 back (+x -> -x), 3 -x side (back -> front) — BoxGeometry's own u
     directions. u is uniform across the face's PLANAR projection. */
  const _rp = { x: 0, y: 0, z: 0, c: 0, xn: 0 };
  function ringPoint(R, f, u) {
    const e = 2 / R.n, q = Math.pow(SQH, e);
    let s, c;
    if (f === 0 || f === 2) {
      const xr = (f === 0 ? 2 * u - 1 : 1 - 2 * u) * q;          // x / a
      s = Math.sign(xr) * Math.pow(Math.abs(xr), 1 / e);
      c = Math.sqrt(Math.max(0, 1 - s * s)) * (f === 0 ? 1 : -1);
    } else {
      const zt = R.zf * q, zm = -R.zb * q;
      const z = f === 1 ? zt + (zm - zt) * u : zm + (zt - zm) * u;
      c = z >= 0 ? Math.pow(z / R.zf, 1 / e) : -Math.pow(-z / R.zb, 1 / e);
      s = Math.sqrt(Math.max(0, 1 - c * c)) * (f === 1 ? 1 : -1);
    }
    const x = R.a * Math.sign(s) * Math.pow(Math.abs(s), e);
    _rp.x = x; _rp.xn = R.a > 1e-6 ? x / R.a : 0; _rp.c = c;
    _rp.z = R.zc + (c >= 0 ? R.zf : R.zb) * Math.sign(c) * Math.pow(Math.abs(c), e);
    _rp.y = R.y + (R.tw || 0) * (c > 0 ? -(R.tf || 0) * Math.pow(c, 1.5) : (R.tb || 0) * Math.pow(-c, 1.5));
    return _rp;
  }
  // Ring heights for [y0, y1] spaced by ARC LENGTH through the shape (width,
  // depth and relief), so the shoulders and the chest get the rings.
  function sampleYs(ringAt, reliefAt, y0, y1, count) {
    const N = 96, cum = [0], ys = [y0];
    let pr = ringAt(y0), pf = reliefAt ? reliefAt(y0) : 0, acc = 0;
    for (let i = 1; i <= N; i++) {
      const y = y0 + (y1 - y0) * i / N, r = ringAt(y), fz = reliefAt ? reliefAt(y) : 0;
      acc += Math.sqrt((y - ys[i - 1]) * (y - ys[i - 1]) + (r.a - pr.a) * (r.a - pr.a) +
        0.5 * ((r.zf - pr.zf) * (r.zf - pr.zf) + (r.zb - pr.zb) * (r.zb - pr.zb)) + 4 * (fz - pf) * (fz - pf));
      cum.push(acc); ys.push(y); pr = r; pf = fz;
    }
    const out = [];
    let j = 0;
    for (let i = 0; i <= count; i++) {
      const target = acc * i / count;
      while (j < N - 1 && cum[j + 1] < target) j++;
      const t = cum[j + 1] > cum[j] ? (target - cum[j]) / (cum[j + 1] - cum[j]) : 0;
      out.push(ys[j] + (ys[j + 1] - ys[j]) * Math.min(1, Math.max(0, t)));
    }
    return out;
  }
  const TORSO_COUNTS = {   // [near, far] rings
    chest: [20, 10], chestTop: [16, 8], waist: [7, 4], pelvis: [9, 5], jacket: [20, 10], band: [3, 2], vest: [12, 6],
  };
  const JACKET_HUG = 0.003;    // the least a jacket stands off the body (model units): under the 4 mm cloth tolerance, clear of a z-fight
  // x of the arm's INNER surface at body height y: below the shoulder pivot
  // the pivot at AX, tilted in by the idle carry (walk/run keep it), the
  // upper loft's fullest section (0.99 R), 1.25x the drop for a swung arm
  // reaching the same height from further down its length; above it the
  // loft's top dome (~0.81 R high), which a swing turns about the pivot.
  /* THE SHOULDER IS THE JACKET'S, NOT A BALL. The shell used to stop INSIDE
     the arm's top dome all the way round (the clamp below, above the pivot
     too), so what a suit showed at the shoulder was the SLEEVE'S end dome — a
     ball sitting on the end of a sloping trapezius, ringed by the painted
     sleeve-head seam. A tailored jacket has a structured shoulder: the line
     runs out level from the collar to past the arm and the sleeve hangs from
     under it. So over the pivot the shell takes the union with a sphere
     round the arm's own pivot, a pad's thickness bigger than the arm's top
     dome (padR). The dome is a ball about that same pivot, so whatever the
     arm does — swing, raise, cuffs — it turns INSIDE the pad and the seam
     never opens; a raised arm leaves through the pad like a real sleeve. */
  function padR(S) { return 0.97 * S.R + 0.016 * S.vs; }
  const PAD_LO = -0.15;                 // the pad's underside, as a share of padR below the pivot
  function jacketPad(S, x, y, z, out) {
    const r = padR(S), dy = y - S.shoulderY;
    if (dy < PAD_LO * r) return false;
    const dx = Math.abs(x) - S.AX, d = Math.hypot(dx, dy, z);
    if (d >= r || d < 1e-6) return false;
    // medial of the pivot the pad merges into the trapezius: a vertex there is
    // never pushed toward the neck (it would go in through the body)
    if (dx < -0.3 * r && dy < 0.6 * r) return false;
    const k = r / d;
    out[0] = Math.sign(x || 1) * (S.AX + dx * k); out[1] = S.shoulderY + dy * k; out[2] = z * k;
    return true;
  }
  function jacketArmIn(S) {
    const tilt = Math.min(0, S.P.armOutZ || 0) - 0.02, R = S.R, pad = 0.004 * S.vs, rP = padR(S);
    return function (y) {
      const h = y - S.shoulderY;
      if (h >= PAD_LO * rP) return Infinity;                    // the pad (jacketPad) owns it
      if (h <= 0) return S.AX - 0.99 * R + 1.25 * tilt * -h - pad;
      // (an arm held out — armour pushes it, ch.armWear — tips the dome in)
      const q = h / R;
      return q >= 1 ? Infinity : S.AX - 0.99 * R * Math.sqrt(1 - q * q) - 0.35 * h - pad;
    };
  }
  /* The last word on a jacket VERTEX, at its own (lifted) height. A ring is
     one superellipse, so a ring held to the hug at the flank but a full
     offset deeper front and back bulges at its flank CORNERS (1 cm on a
     child's waist) — right where a hanging arm is. So, per vertex:
       1. within an arm's depth of the flank, no further out than the body +
          hug, or the arm's inner line (armIn), whichever is further;
       2. at least the hug off the body (column and pelvis sections, with the
          body's relief), pushed straight out from the section centre if not —
          a lifted front or a squarer body ring above can bring a vertex onto
          the body, and a coplanar patch there z-fights. */
  /* …and the ring itself is rounded first (lower n) until its flank, out to
     about an arm's depth, stays within `gap` of the body without touching it,
     so the per-vertex cap is only a last trim. */
  function jacketFlankN(S, y, r, gap) {
    const t = S.at(y), p = (y >= S.pBot && y <= S.pTop + 0.03) ? S.pel(Math.min(y, S.pTop)) : null;
    const sx = (a, zz, n, z) => (z >= zz ? 0 : a * Math.pow(1 - Math.pow(z / zz, n), 1 / n));
    const body = (z, fr) => Math.max(sx(t.a, fr ? t.zf : t.zb, t.n, z), p ? sx(p.a, fr ? p.zf : p.zb, p.n, z) : 0);
    const zArm = 1.3 * S.R;
    let best = r.n, bestBad = Infinity;
    for (let n = r.n; n >= 1.5; n -= 0.05) {
      let bad = 0, ok = true;
      for (let fr = 0; fr < 2 && ok; fr++) {
        const zz = fr ? r.zf : r.zb;
        for (let k = 1; k <= 16; k++) {
          const z = zz * k / 17, xs = sx(r.a, zz, n, z), xb = body(z, fr);
          if (xb > 0 && xs < xb + 0.7 * JACKET_HUG) { ok = false; break; }   // would touch the body: z-fight
          if (z <= zArm) bad = Math.max(bad, xs - xb - gap);
        }
      }
      if (!ok) break;                                          // rounder only gets closer
      if (bad < bestBad) { bestBad = bad; best = n; }
      if (bad <= 0) break;
    }
    return best;
  }
  const _jc = [0, 0], _jp = [0, 0, 0];
  // twice the hug under the shoulder flare: the surfaces there slope steeply,
  // so a horizontal gap is a much thinner one along the normal
  function jacketHug(S, y) { return y > S.shoulderY - 1.3 * S.R ? 2 * JACKET_HUG : JACKET_HUG; }
  function jacketFit(S, y, out, armIn) {
    const k = (y - S.base) / S.sp, m = jacketHug(S, y);
    const secs = [S.at(y)];
    if (y >= S.pBot && y <= S.pTop) secs.push(S.pel(y));
    const zv = out[1];
    // the arms hang between the thigh tops (below them the thighs set the hem)
    // and the shoulder flare (where the body itself meets the arm)
    if (Math.abs(zv) < S.R && y > S.hipY + 0.25 * S.P.legW && y < S.shoulderY - 1.3 * S.R) {
      let xb = 0;
      for (const R of secs) {
        const zz = zv - R.zc >= 0 ? R.zf : R.zb, q = Math.abs(zv - R.zc) / zz;
        if (q < 1) xb = Math.max(xb, R.a * Math.pow(1 - Math.pow(q, R.n), 1 / R.n));
      }
      // the arm is round: off its axis its inner face stands further out
      const round = S.R - Math.sqrt(Math.max(0, S.R * S.R - zv * zv));
      const cap = Math.max(xb + 1.3 * m, armIn(y) + 0.6 * round);
      if (Math.abs(out[0]) > cap) out[0] = Math.sign(out[0]) * cap;
    }
    for (let pass = 0; pass < 2; pass++) for (const R of secs) {
      const x = out[0], zr = out[1] - R.zc;
      const zz = zr >= 0 ? R.zf : R.zb;
      const cz = Math.max(-1, Math.min(1, zr / zz));
      const zb = zr - (R === secs[0] ? featZ(S, k, x / R.a, cz) : 0);   // the body's own relief at this spot
      const F = Math.pow(Math.abs(x) / R.a, R.n) + Math.pow(Math.abs(zb) / zz, R.n);
      const rho = Math.pow(F, 1 / R.n), rad = Math.hypot(x, zb);
      const need = 1 + m / Math.max(rad, 1e-4);
      if (rho < need) { const s = need / Math.max(rho, 1e-4); out[0] = x * s; out[1] = R.zc + zb * s + (zr - zb); }
    }
  }
  /* The rings of a part, TOP first, each a section record plus the relief
     function the surface wears. Shells (jacket / band / vest) are the column
     inflated off the body: the section is widened by `off`, never tucks in
     below the pelvis or (a jacket) below a straight drape from the chest, and
     the shoulder top rises by the same offset. */
  function partRings(spec, lod) {
    const S = spec.S, far = lod >= 2 ? 1 : 0, part = spec.part;
    const rings = [];
    if (part === "pelvis") {
      const ys = sampleYs(S.pel, null, S.pBot, S.pTop, TORSO_COUNTS.pelvis[far]);
      for (let i = ys.length - 1; i >= 0; i--) { const r = S.pel(ys[i]); r.k = -1; rings.push(r); }
      // the waistband: a ledge that slopes in and up under the shirt
      const t = S.pel(S.pTop);
      rings.unshift({ y: S.pTop + 0.012 * S.vs, a: t.a * 0.84, zf: t.zf * 0.84, zb: t.zb * 0.84, zc: 0, n: t.n, tw: 0, k: -1 });
      return rings;
    }
    if (part === "collar") {
      if (spec.bare) {                 // no garment: the neck FLARES into the trapezius (a fillet, tucked under the neck)
        const mk = (y, add, m, v) => ({ y, a: (S.nRx + add) * m, zf: (S.nRz + add) * m, zb: (S.nRz + add) * m, zc: S.nZc, n: 2, tw: 1, tf: S.tf, tb: S.tb, k: 2, v });
        const r = [mk(S.yN + 0.03 * S.vs, 0, 0.97, 1), mk(S.yN + 0.004 * S.vs, 0.006 * S.vs, 1, 0.6), mk(S.yN - 0.02 * S.vs, 0.02 * S.vs, 1.06, 0.3), mk(S.yN - 0.05 * S.vs, 0.03 * S.vs, 1.16, 0)];
        return far ? [r[0], r[2], r[3]] : r;
      }
      const rx = S.nRx + 0.022 * S.vs, rz = S.nRz + 0.022 * S.vs, h = 0.038 * S.vs;
      const mk = (y, m, v, dtf) => ({ y, a: rx * m, zf: rz * m, zb: rz * m, zc: S.nZc, n: 2, tw: 1, tf: S.tf + (dtf || 0), tb: S.tb, k: 2, v });
      const r = [mk(S.yN + h, 0.99, 1, 0.012 * S.vs), mk(S.yN + 0.5 * h, 1.0, 0.62, 0.006 * S.vs), mk(S.yN - 0.012 * S.vs, 1.02, 0.25), mk(S.yN - 0.05 * S.vs, 1.07, 0)];
      return far ? [r[0], r[2], r[3]] : r;
    }
    const shell = part === "jacket" || part === "band" || part === "vest";
    let y0, y1, n;
    if (part === "chest") { y0 = S.chestBot > S.base + 0.001 ? S.chestBot : S.yBot; y1 = S.yTop; n = TORSO_COUNTS[S.chestBot > S.base + 0.001 ? "chestTop" : "chest"][far]; }
    else if (part === "waist") { y0 = S.yBot; y1 = S.chestBot + WAIST_TUCK; n = TORSO_COUNTS.waist[far]; }
    else { y0 = spec.y0; y1 = Math.min(spec.y1, S.yTop); n = TORSO_COUNTS[part][far]; }
    const off = shell ? spec.off : 0;
    /* THE JACKET COVERS THE SEAT. A suit jacket hangs to about the bottom of
       the seat; the shell stopped at the hip joint at the back and was swept
       up to the WAIST at the front (so a seated thigh could not pass through
       it), and what the camera saw below was a skirt PAINTED onto the pelvis
       — a jacket-coloured pair of briefs over the trousers. Now the shell
       itself hangs to the seat all round, straight down from the hips (the
       drape below), open at the front between the quarters (the paint's
       cut), and only a SEATED body (spec.seated: jacketPosture swaps it)
       wears the old swept front. */
    if (part === "jacket") y0 = Math.min(y0, S.hipY - 0.085 * S.pk);
    const drapeR = part === "jacket" ? S.at(S.base + 0.60 * S.sp) : null;
    const drapeK = part === "jacket" ? (S.P.fem ? 0.90 : 0.96) : 0;
    const armIn = part === "jacket" ? jacketArmIn(S) : null;
    const ringAt = function (y) {
      const r = S.at(y);
      r.tf = S.tf; r.tb = S.tb; r.k = (y - S.base) / S.sp;
      if (shell && y < S.pTop + 0.03) {                         // never inside the pelvis (nor, a jacket, its seat)
        const p = S.pel(Math.max(S.pBot, Math.min(y, S.pTop)));
        const seat = part === "jacket" ? S.glute * 0.16 * S.pd * gss(y - (S.hipY - 0.015 * S.pk), 0.055 * S.pk) : 0;
        r.a = Math.max(r.a, p.a); r.zf = Math.max(r.zf, p.zf); r.zb = Math.max(r.zb, p.zb + seat);
      }
      const aHere = r.a;
      if (shell) {
        if (drapeR && y < drapeR.y) { r.a = Math.max(r.a, drapeR.a * drapeK); r.zf = Math.max(r.zf, drapeR.zf * drapeK); r.zb = Math.max(r.zb, drapeR.zb * drapeK); }
        if (spec.flat) { r.n = Math.max(r.n, spec.flat); }
        r.a += off; r.zf += off; r.zb += off;
        // THE JACKET HANGS INSIDE THE ARMS: the sleeves are painted on the arm
        // lofts, so the shell's flank stops short of the arm's inner surface
        // (the idle carry tilts the arm in; a swing only moves it in z), never
        // closer to the body than JACKET_HUG (a coplanar shell would z-fight).
        if (armIn) {                                            // (+ per vertex: jacketFit)
          const aFree = r.a;
          r.a = Math.max(aHere + jacketHug(S, y), Math.min(r.a, armIn(y)));
          if (r.a < aFree - 1e-6) r.n = jacketFlankN(S, y, r, r.a - aHere);
          const rP = padR(S), h = y - S.shoulderY;
          if (h >= PAD_LO * rP && h < rP) r.a = Math.max(r.a, S.AX + rP * Math.sqrt(1 - (h / rP) * (h / rP)));
        }
        // the shoulder top rises with the shell (a jacket's rise eases in: a
        // step in ring height would stretch one band across the shoulder cap)
        if (part === "jacket") r.y += off * 0.9 * sm01((r.k - 0.9) / 0.2);
        else if (r.k > 1) r.y += off * 0.9;
      }
      if (part === "waist") {                                   // tuck the top a hair inside the chest
        const m = 1 - 0.035 * cl01((y - S.chestBot + 0.004) / 0.03);
        r.a *= m; r.zf *= m; r.zb *= m;
      }
      return r;
    };
    const relief = function (y) { const k = (y - S.base) / S.sp; return featZ(S, k, 0.42, 1) - featZ(S, k, 0.42, -1); };
    let ys = sampleYs(ringAt, relief, y0, y1, n);
    if (part === "jacket") {
      // A JACKET HUGGING THE BODY HAS ITS RINGS WHERE THE BODY HAS ITS RINGS:
      // two lofts sampled at different heights are two different chords of the
      // same curve, and a 4 mm offset between chords is not an offset (it
      // crosses the chest flare and the hip bulge). So the shell takes the
      // chest's, the waist's and the pelvis's ring heights in its span.
      const at = [y0, y1];
      const take = (p) => { for (const r of partRings({ S, part: p }, lod)) if (r.y > y0 && r.y < y1) at.push(r.y); };
      take("chest"); take("pelvis");
      if (S.chestBot > S.base + 0.001) take("waist");
      const rP = padR(S);                                       // the pad's own sections
      for (const k of [PAD_LO, -0.05, 0.15, 0.35, 0.52, 0.66, 0.78, 0.88, 0.95]) {
        const y = S.shoulderY + k * rP;
        if (y > y0 && y < y1) at.push(y);
      }
      for (const k of [0.25, 0.5, 0.75]) at.push(y0 + k * (S.hipY - y0));   // the skirt
      at.sort((a, b) => a - b);
      ys = at.filter((y, i) => i === 0 || y - at[i - 1] > 0.002 * S.vs);
    }
    // THE FRONT OF A JACKET IS CUT AWAY ABOVE THE LAP: seated, the thighs come
    // up level with the hip joint plus their own radius, so the hem sweeps up
    // at the front and hangs to y0 at the sides and back: a low ring's front
    // vertices move onto the shell's own ring at the height they rise to
    // (ring.lift, blended by front-ness in torsoBake), so they stay the right
    // distance off the belly and the arms there.
    const liftTop = part === "jacket" && spec.seated ? Math.max(y0, S.hipY + 0.5 * S.P.legW + 0.02 * S.vs) : y0;
    const liftZ = liftTop + 0.12 * S.vs;
    for (let i = ys.length - 1; i >= 0; i--) {
      const y = ys[i], r = ringAt(y);
      if (liftTop > y0 && y < liftZ) {
        const t = (y - y0) / (liftZ - y0), yl = y + (liftTop - y0) * (1 - t);
        for (let j = 1; j <= 8; j++) {                           // as big as every height the front sweeps past (the hips)
          const q = ringAt(y + (yl - y) * j / 8);
          r.a = Math.max(r.a, q.a); r.zf = Math.max(r.zf, q.zf); r.zb = Math.max(r.zb, q.zb);
        }
        r.lift = yl - y;
      }
      rings.push(r);
    }
    if (part === "jacket") {                                     // the jacket's stand collar, higher at the back
      const t = rings[0];
      rings.unshift(Object.assign({}, t, { y: t.y + 0.03 * S.vs, a: t.a + 0.004, zf: t.zf + 0.004, zb: t.zb + 0.004, tf: t.tf + 0.03 * S.vs }));
    }
    return rings;
  }
  /* Bake a part: rings (top first) x 4 faces x (nq+1) verts (seams duplicated
     so each face owns its atlas column), optional fan caps. `paint` = {key,
     fn(face, u, v) -> [U, V]} from city/clothes.js, or null (flat). */
  function torsoBake(spec, lod, paint) {
    lod = lod >= 2 ? 2 : 1;
    const key = spec.key + "|" + lod + "|" + (paint ? paint.key : "-");
    let g = TORSO_GEO[key];
    if (g) return g;
    const S = spec.S, part = spec.part;
    const rings = partRings(spec, lod);
    // a jacket a few mm off the body needs finer columns than the body: two
    // lofts of different squareness cut different chords between vertices
    const nq = lod >= 2 ? 3 : (part === "jacket" ? 11 : 7), RV = 4 * (nq + 1);
    const capTop = part === "chest" || part === "waist" || part === "pelvis" || (part === "collar" && !spec.bare);
    const capBot = part === "chest" || part === "waist" || part === "pelvis";
    const nv = rings.length * RV + 2 * (2 * RV + 1);              // rings + room for either cap kind
    const Pp = new Float32Array(nv * 3), Fc = new Uint8Array(nv), Uq = new Float32Array(nv), Vq = new Float32Array(nv);
    const box = spec.box, bh = box.h, bb = box.y - bh / 2, oy = spec.origin;
    const shellRelief = part === "jacket" ? 0.8 : (part === "vest" ? (spec.flat ? 0.35 : 0.7) : 1);
    const lap = part === "jacket" && spec.lapel && spec.lapel.xr > 0 ? spec.lapel : null;
    const armIn = part === "jacket" ? jacketArmIn(S) : null;
    let o = 0;
    const put = function (x, y, z, f, u, v) { Pp[o * 3] = x; Pp[o * 3 + 1] = y - oy; Pp[o * 3 + 2] = z; Fc[o] = f; Uq[o] = u; Vq[o] = v; return o++; };
    const ringStart = [];
    for (let i = 0; i < rings.length; i++) {
      const R = rings[i];
      ringStart.push(o);
      for (let f = 0; f < 4; f++) for (let k = 0; k <= nq; k++) {
        const u = k / nq, p = ringPoint(R, f, u);
        let z = p.z;
        // v never sits ON the row edge (the next atlas row is a cut jacket);
        // taken before the lift, so the painted hem follows the cutaway
        const v = 0.01 + 0.98 * (R.v != null ? R.v : cl01((p.y - bb) / bh));
        if (part === "pelvis") z += pelvisFeatZ(S, p.y, p.xn, p.c);
        else if (part !== "collar") z += featZ(S, R.k, p.xn, p.c) * shellRelief;
        if (lap && p.c > 0.15) z += lapelRoll(S, lap, p.x, 1 - v) * Math.min(1, (p.c - 0.15) / 0.3);
        let x = p.x, y = p.y;
        if (R.lift) y += R.lift * sm01((p.c + 0.15) / 0.55);   // the jacket's cutaway front (partRings)
        if (armIn) { _jc[0] = x; _jc[1] = z; jacketFit(S, y, _jc, armIn); x = _jc[0]; z = _jc[1]; }
        if (armIn && jacketPad(S, x, y, z, _jp)) { x = _jp[0]; y = _jp[1]; z = _jp[2]; }
        put(x, y, z, f, u, v);
      }
    }
    const idx = [];
    for (let i = 0; i < rings.length - 1; i++) for (let f = 0; f < 4; f++) for (let k = 0; k < nq; k++) {
      const c = ringStart[i] + f * (nq + 1) + k, b = c + RV;
      idx.push(b, b + 1, c, b + 1, c + 1, c);
    }
    // FAN CAPS on duplicated rims (shrunk a hair so the smooth-normal weld
    // leaves the visible rim's normals alone)
    const cap = function (ri, top) {
      const s0 = ringStart[ri], rim = o;
      let cx = 0, cy = 0, cz = 0, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let j = 0; j < RV; j++) {
        const q = s0 + j;
        const x = Pp[q * 3], y = Pp[q * 3 + 1] + oy, z = Pp[q * 3 + 2];
        cx += x; cy += y; cz += z; x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
      }
      cx /= RV; cy /= RV; cz /= RV;
      for (let j = 0; j < RV; j++) {
        const q = s0 + j, x = Pp[q * 3], y = Pp[q * 3 + 1] + oy, z = Pp[q * 3 + 2];
        const ux = cl01((x - x0) / (x1 - x0 || 1)), vz = cl01((z - z0) / (z1 - z0 || 1));
        put(cx + (x - cx) * 0.998, y, cz + (z - cz) * 0.998, 4, 0.01 + 0.98 * ux, 0.01 + 0.98 * (top ? 1 - vz : vz));
      }
      const ctr = put(cx, cy + (top ? -0.02 : 0.004) * S.vs, cz, 4, 0.5, 0.5);
      for (let f = 0; f < 4; f++) for (let k = 0; k < nq; k++) {
        const a = rim + f * (nq + 1) + k;
        if (top) idx.push(ctr, a, a + 1); else idx.push(ctr, a + 1, a);
      }
    };
    if (capTop) {
      if (part === "collar") {                                   // the collar's top edge folds in to the neck
        const s0 = ringStart[0], rim = o;
        for (let j = 0; j < RV; j++) { const q = s0 + j; put(Pp[q * 3] * 0.999, Pp[q * 3 + 1] + oy, S.nZc + (Pp[q * 3 + 2] - S.nZc) * 0.999, 4, (j % (nq + 1)) / nq, 0.99); }
        const inner = o;
        for (let j = 0; j < RV; j++) { const q = s0 + j; put(Pp[q * 3] * 0.78, Pp[q * 3 + 1] + oy - 0.012 * S.vs, S.nZc + (Pp[q * 3 + 2] - S.nZc) * 0.78, 4, (j % (nq + 1)) / nq, 0.01); }
        for (let f = 0; f < 4; f++) for (let k = 0; k < nq; k++) {
          const a = rim + f * (nq + 1) + k, b = inner + f * (nq + 1) + k;
          idx.push(a, b, a + 1, a + 1, b, b + 1);
        }
      } else cap(0, true);
    }
    if (capBot) cap(rings.length - 1, false);
    const nUsed = o;
    g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(Pp.slice(0, nUsed * 3), 3));
    g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(nUsed * 3), 3));
    const U = new Float32Array(nUsed * 2);
    for (let i = 0; i < nUsed; i++) {
      // (x: the vertex's body-local x, for a painter that lays the FRONT out in
      // body units rather than across the face — city/clothes.js tailoring)
      if (paint) { const uv = paint.fn(TORSO_FACE[Fc[i]], Uq[i], Vq[i], Pp[i * 3]); U[i * 2] = uv[0]; U[i * 2 + 1] = uv[1]; }
      else { U[i * 2] = Fc[i] < 4 ? (Fc[i] + Uq[i]) / 4 : Uq[i]; U[i * 2 + 1] = Vq[i]; }
    }
    g.setAttribute("uv", new THREE.BufferAttribute(U, 2));
    g.setIndex(new THREE.BufferAttribute(nUsed > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
    finishGeo(g);
    g.computeBoundingBox(); g.computeBoundingSphere();
    g.parameters = { width: box.w, height: box.h, depth: box.d };   // the box this part replaced
    g.userData.torso = { part, box, origin: oy, face: Fc.slice(0, nUsed), u: Uq.slice(0, nUsed), v: Vq.slice(0, nUsed), rings: rings.length, nq };
    g.name = "torso~" + part + "~" + lod;
    g._shared = true;
    return (TORSO_GEO[key] = g);
  }
  /* MODELLED LAPELS. A painted lapel on a smooth shell is a flat sticker; a
     real one ROLLS: the cloth turns back along the V and stands proud of the
     chest, highest at the roll line and settling into the front toward its
     outer edge. The tailored atlas (city/clothes.js formalTorso) lays the V
     out in body units — X = x / (2 xr) across the front, row r down the
     jacket row, the gorge at (g0, 0.1) running to the fastening at (0, yb)
     — so the shell lifts exactly the band the paint calls lapel: up to
     ~5 mm at the roll, nothing past the lapel's width. Geometry, not a new
     draw call: the same shell, the same atlas. */
  function lapelRoll(S, L, x, r) {
    const r0 = 0.1, r1 = L.yb;
    if (r < r0 || r > r1) return 0;
    const t = (r - r0) / (r1 - r0);
    const X = Math.abs(x) / (2 * L.xr), Xe = L.g0 * (1 - t), wl = 0.15 - 0.12 * t;
    const q = (X - Xe) / wl;
    if (q < -0.15 || q > 1) return 0;
    const k = q < 0 ? sm01((q + 0.15) / 0.15) : Math.pow(1 - q, 0.6);
    return 0.0075 * S.vs * k * (1 - 0.5 * t);
  }
  /* A part's spec: which slice of which body, in which mesh frame. box = the
     box it replaces {w, h, d, y (body-local centre)}, origin = the mesh's
     body-local y (geometry is baked relative to it). */
  function partSpec(S, part, box, origin, extra) {
    const sp = Object.assign({ S, part, box, origin, lod: 1 }, extra || {});
    // a collar is the NECK's, not the body's: every physique of a form shares it
    // (baked relative to its own origin at the neck ring), which keeps the
    // painted-collar pools one per neck, not one per body type
    const who = part === "collar" ? "N" + [S.nRx, S.nRz, S.nZc, S.tf, S.tb, S.vs].map((x) => x.toFixed(4)).join(",") : S.key;
    if (part === "collar") sp.key = who + "|collar|" + (sp.bare ? 1 : 0) + "|" + [box.w, box.h, box.d].map((x) => (+x).toFixed(4)).join(",");
    else sp.key = who + "|" + part + "|" + [box.w, box.h, box.d, box.y, origin, sp.y0 || 0, sp.y1 || 0, sp.off || 0, sp.flat || 0, sp.bare ? 1 : 0, sp.seated ? 1 : 0].map((x) => (+x).toFixed(4)).join(",") +
      (sp.lapel ? "|L" + [sp.lapel.xr, sp.lapel.yb, sp.lapel.g0].map((x) => (+x).toFixed(4)).join(",") : "");
    return sp;
  }
  function partMesh(spec, material) {
    const m = new THREE.Mesh(torsoBake(spec, 1, null), material);
    m.userData.torsoPart = spec;
    m.castShadow = m.receiveShadow = true;
    return m;
  }
  // the geometry of ANY shaped body part (limb loft or torso part) for its
  // current LOD and paint — city/clothes.js calls this with a painter on
  // dress and with null on strip; omitted = keep the paint.
  function partGeometry(mesh, paint) {
    const ud = mesh && mesh.userData;
    if (!ud) return null;
    if (ud.limb) return limbGeometry(mesh, paint);
    const spec = ud.torsoPart;
    if (!spec) return null;
    if (paint !== undefined) ud.limbPaint = paint || null;
    return torsoBake(spec, spec.lod, ud.limbPaint || null);
  }
  function setTorsoLod(rig, lod) {
    lod = lod >= 2 ? 2 : 1;
    const s = rig && rig.skinSlots;
    if (!s) return;
    const list = [].concat(s.torso || [], s.collar || [], s.pelvis || [], s.stripes || [], rig._jacketMesh ? [rig._jacketMesh] : []);
    for (let i = 0; i < list.length; i++) {
      const m = list[i], spec = m && m.userData && m.userData.torsoPart;
      if (!spec || spec.lod === lod) continue;
      spec.lod = lod;
      const flat = m.userData._cbzFlat;
      if (flat && flat.g && flat.g.userData && flat.g.userData.torso) flat.g = torsoBake(spec, lod, null);
      if (m.geometry && m.geometry.userData && m.geometry.userData.torso) m.geometry = partGeometry(m);
    }
  }
  // The body's FRONT (side > 0) or BACK (side < 0) surface z at body-local
  // (x, y) — where a badge, a tie or a strap should sit.
  function torsoSurfaceZ(S, x, y, side) {
    const R = S.at(y), e = 2 / R.n;
    const xr = Math.min(0.999, Math.abs(x) / Math.max(1e-6, R.a));
    const s = Math.pow(xr, 1 / e), c = Math.sqrt(Math.max(0, 1 - s * s)) * (side < 0 ? -1 : 1);
    const k = (y - S.base) / S.sp;
    return R.zc + (c >= 0 ? R.zf : -R.zb) * Math.pow(Math.abs(c), e) + featZ(S, k, x / Math.max(1e-6, R.a), c);
  }
  /* CBZ.humanShellSpec(rig, kind, opts) — a garment/armour SHELL that follows
     this body: kind "jacket" | "band" | "vest"; opts {y0, y1 (body-local
     span; a jacket runs to the neck), off (clearance), flat (a stiffer, boxier
     section for plate armour), box: {w,h,d,y} for the paint's v span,
     origin: the mesh's body-local y}. Returns the spec to hang on the mesh as
     userData.torsoPart; CBZ.humanLimbGeometry(mesh, painter) then bakes it. */
  function shellSpec(rig, kind, opts) {
    const S = rig && rig.torsoShape;
    if (!S) return null;
    opts = opts || {};
    const y0 = opts.y0 != null ? opts.y0 : S.base, y1 = opts.y1 != null ? opts.y1 : S.yTop;
    const box = opts.box || { w: S.W * 2, h: y1 - y0, d: S.D * 2, y: (y0 + y1) / 2 };
    return partSpec(S, kind, box, opts.origin != null ? opts.origin : 0,
      { y0, y1, off: opts.off != null ? opts.off : 0.03 * S.vs, flat: opts.flat || 0, lapel: opts.lapel || null });
  }
  CBZ.humanShellSpec = shellSpec;

  // ---- c.badge: a thin metal shield laid on the chest (see makeCharacter) ----
  let _badgeGeo = null;
  function badgeGeometry() {
    if (_badgeGeo) return _badgeGeo;
    const s = 0.074, pts = [[0, 0.62], [-0.26, 0.5], [-0.5, 0.58], [-0.5, 0.12], [-0.34, -0.32], [0, -0.62], [0.34, -0.32], [0.5, 0.12], [0.5, 0.58], [0.26, 0.5]];
    const sh = new THREE.Shape();
    pts.forEach((p, i) => (i ? sh.lineTo(p[0] * s, p[1] * s) : sh.moveTo(p[0] * s, p[1] * s)));
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.004, bevelEnabled: false, curveSegments: 1 });
    g.computeBoundingSphere();
    g._shared = true;
    return (_badgeGeo = g);
  }
  // seat a badge mesh (userData.badgeAt {x, y}) on the body surface, `off`
  // further out (a jacket shell's clearance), tilted to the surface normal and
  // lifted until no corner of the plate sinks into the chest
  const _bn = new THREE.Vector3(), _bz = new THREE.Vector3(0, 0, 1);
  function seatBadgeMesh(S, mesh, off) {
    const at = mesh && mesh.userData && mesh.userData.badgeAt;
    if (!S || !at) return;
    const f = (x, y) => torsoSurfaceZ(S, x, y, 1), e = 0.01, x = at.x, y = at.y;
    const fx = (f(x + e, y) - f(x - e, y)) / (2 * e), fy = (f(x, y + e) - f(x, y - e)) / (2 * e);
    _bn.set(-fx, -fy, 1).normalize();
    let lift = 0;
    for (const dx of [-0.037, 0, 0.037]) for (const dy of [-0.046, 0, 0.046]) {
      const planeZ = f(x, y) + fx * dx + fy * dy;                 // the plate's plane through the centre
      lift = Math.max(lift, (f(x + dx, y + dy) - planeZ) * _bn.z);
    }
    mesh.quaternion.setFromUnitVectors(_bz, _bn);
    const d = lift + (off || 0) + 0.002;
    mesh.position.set(x + _bn.x * d, y + _bn.y * d, f(x, y) + _bn.z * d);
  }
  // CBZ.humanSeatBadge(rig, off): re-seat the rig's c.badge on its outermost
  // layer (city/clothes.js calls it with the jacket shell's clearance, or 0)
  CBZ.humanSeatBadge = function (rig, off) {
    const list = rig && rig.skinSlots && rig.skinSlots.badge;
    if (!list || !rig.torsoShape) return;
    for (let i = 0; i < list.length; i++) seatBadgeMesh(rig.torsoShape, list[i], off);
  };

  /* ==== THE NECK COLUMN (merged into the head geometry) ====================
     In the HEAD's frame (the adult 0.60 head; the neck pivot is y = -0.30):
     a lofted column from inside the body (y -0.50) up into the skull,
     leaning forward a touch, with the two sternocleidomastoid ridges running
     from behind the ear down to the collarbone notch, the notch itself, an
     Adam's apple on a man, and the nape. UVs are the ink atlas's neck band. */
  const NECK_RINGS = [[-0.11, 0.88, -0.012], [-0.17, 0.90, -0.016], [-0.24, 0.91, -0.020], [-0.31, 0.93, -0.025],
    [-0.38, 0.97, -0.030], [-0.43, 1.00, -0.033], [-0.47, 0.78, -0.036]];
  const NECK_RELIEF = { m: [0.011, 0.018, 0.009], f: [0.007, 0.004, 0.008], c: [0.004, 0, 0.004] };  // scm, adam's apple, notch
  function neckColumnGeometry(F, fk, far) {
    const rows = far ? [NECK_RINGS[0], NECK_RINGS[2], NECK_RINGS[4], NECK_RINGS[5], NECK_RINGS[6]] : NECK_RINGS;
    const nq = far ? 3 : 6, RV = 4 * (nq + 1), r1 = F.neck[1], A = HEAD_ATLAS;
    const rel = NECK_RELIEF[fk] || NECK_RELIEF.m;
    const nv = rows.length * RV + RV + 1;
    const P = new Float32Array(nv * 3), U = new Float32Array(nv * 2);
    let o = 0;
    for (let i = 0; i < rows.length; i++) {
      const y = rows[i][0], r = r1 * rows[i][1], zc = rows[i][2];
      const sN = cl01((y + 0.44) / 0.28);                        // 0 at the notch .. 1 behind the ear
      const phi = lerpN(0.32, 1.92, sN), win = sm01(sN / 0.15) * sm01((1 - sN) / 0.2);
      for (let f = 0; f < 4; f++) for (let k = 0; k <= nq; k++) {
        const u = k / nq, al = -Math.PI / 4 + f * Math.PI / 2 + u * Math.PI / 2;
        const aa = Math.abs(Math.atan2(Math.sin(al), Math.cos(al)));
        let dr = rel[0] * gss(aa - phi, 0.30) * win;                           // sternocleidomastoid
        dr += rel[1] * gss(aa, 0.30) * gss(y + 0.265, 0.035);                  // Adam's apple
        dr -= rel[2] * gss(aa, 0.35) * gss(y + 0.45, 0.035);                   // the notch
        dr -= 0.006 * gss(aa - Math.PI, 0.3) * cl01((y + 0.40) / 0.1);         // the nape
        P[o * 3] = (r + dr) * Math.sin(al); P[o * 3 + 1] = y; P[o * 3 + 2] = zc + (r * 0.94 + dr) * Math.cos(al);
        const col = f === 0 ? A.front : f === 2 ? A.back : A.side;
        const uu = f === 3 ? 1 - u : u;                                           // both sides run front -> back
        const ay = 1 - (1 - A.headV) * cl01((y + 0.44) / 0.30);
        U[o * 2] = (col[0] + uu * (col[1] - col[0])) / A.W; U[o * 2 + 1] = 1 - ay;
        o++;
      }
    }
    const idx = [];
    for (let i = 0; i < rows.length - 1; i++) for (let f = 0; f < 4; f++) for (let k = 0; k < nq; k++) {
      const c = i * RV + f * (nq + 1) + k, b = c + RV;
      idx.push(b, b + 1, c, b + 1, c + 1, c);
    }
    const last = (rows.length - 1) * RV, rim = o;               // the buried bottom, closed
    for (let j = 0; j < RV; j++) { P[o * 3] = P[(last + j) * 3] * 0.998; P[o * 3 + 1] = P[(last + j) * 3 + 1]; P[o * 3 + 2] = P[(last + j) * 3 + 2]; U[o * 2] = PLAIN_U; U[o * 2 + 1] = PLAIN_V; o++; }
    const ctr = o; P[o * 3] = 0; P[o * 3 + 1] = rows[rows.length - 1][0]; P[o * 3 + 2] = rows[rows.length - 1][2]; U[o * 2] = PLAIN_U; U[o * 2 + 1] = PLAIN_V; o++;
    for (let f = 0; f < 4; f++) for (let k = 0; k < nq; k++) { const a = rim + f * (nq + 1) + k; idx.push(ctr, a + 1, a); }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(P, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
    g.setAttribute("uv", new THREE.BufferAttribute(U, 2));
    g.setIndex(new THREE.BufferAttribute(new Uint16Array(idx), 1));
    return finishGeo(g);
  }

  function makeCharacter(c) {
    const g = new THREE.Group();
    // Keep the world/physics root at scale 1: ragdoll, KO, child rigs and mode
    // reset code legitimately animate `group.scale`. The authored voxel model
    // lives under a stable metre conversion node, so those systems compose with
    // the 1.82m body instead of accidentally erasing the conversion.
    const model = new THREE.Group();
    // HUMAN-RATIO PASS (owner: "make ratios right to human size"). The authored
    // voxel rig is ~2.60u tall; render it at HUMAN_SCALE so an adult stands
    // ~1.82m beside the real-scaled cars/aircraft (audit: player was 4.65u, TALLER
    // than the parked fighter jet). One-line revert: CBZ.CONFIG.CHAR_SCALE_REAL=false
    // restores the legacy 2.60u rig. The eye/camera/aim/hit/mount constants are
    // co-tuned for the ON path (fpsmode eye 1.65, camera pivot 1.7, hit HEAD_Y 1.50,
    // combat aim ~1.5–1.8) — a full revert flips them back too; see the report.
    const charReal = !CBZ.CONFIG || CBZ.CONFIG.CHAR_SCALE_REAL !== false;
    const humanScale = !charReal ? 1.0 : ((CBZ.HUMAN_SCALE > 0) ? CBZ.HUMAN_SCALE : 0.70);
    model.name = "character-model";
    model.userData.characterModel = true;
    g.userData.humanScale = humanScale;
    /* ---- A BODY IS NOT SCENERY (owner, 2026-07-29) -------------------------
       "there's some weird NPCs that have no outfit, and it's like invisible
       where the outfit should be."

       This one missing tag is how a person loses their clothes. TWO shared
       build-time passes walk the city root and treat everything under it as
       static: core/batch.js's `batchStaticUnder` (merges eligible meshes into
       one buffer and REMOVES the originals from the graph) and
       core/staticfreeze.js's `freezeStaticUnder` (flips matrixAutoUpdate off).
       Both skip a subtree on exactly one condition — `userData.dynamic` —
       and city/mode.js:518-522 runs the pair over `A.root`.

       Its comment claims the pass happens "BEFORE spawnCityPeds/Traffic add
       dynamic rigs to it", and for the ambient crowd that is true. It is NOT
       true for the world builders: biome_forest / biome_farmland / biome_desert
       / biome_snow / marina / bunkers / island_military / island_airport all
       call cityMakePed DURING build(), and peds.js parents every one of them
       to A.root. The ANIMALS already knew — wildlife.js:229 says in so many
       words "BEFORE city/mode.js runs CBZ.batchStaticUnder + CBZ.freezeStaticUnder"
       and tags itself; dogs.js:162 does the same and calls the alternative
       "the statue bug". The file that builds every HUMAN never did.

       What the batcher then takes is decided by userData, and that is why the
       damage looks like clothes: batch.js:429 spares any mesh carrying userData,
       and the limb segments carry clothDims/clothBand from tagCloth below — so
       SLEEVES AND TROUSERS SURVIVE while the untagged chest (an adult male has
       no waist box, so nothing tags his torso), the shoulder yoke and the pelvis
       are merged away at their build-time transform and never draw on the body
       again. A DRESSED mesh carries _cbzFlat and is spared too, so the exposure
       is precisely the PLAIN civilian — the shipping default.

       And it is invisible to the obvious check: a merged-away mesh is still in
       skinSlots, still `visible === true`, still holding a valid material. The
       only tell is that its `.parent` is gone, which is what
       CBZ.cityClothMeshRenders (city/clothes.js) now tests.

       A character animates every frame; there has never been a case where
       baking or freezing one was correct. Revert: CHAR_RIG_DYNAMIC = false. */
    if (CBZ.CONFIG && CBZ.CONFIG.CHAR_RIG_DYNAMIC == null) CBZ.CONFIG.CHAR_RIG_DYNAMIC = true;
    if (!CBZ.CONFIG || CBZ.CONFIG.CHAR_RIG_DYNAMIC !== false) g.userData.dynamic = true;
    g.add(model);

    // ---- BODY PROFILE (c.build: "m" default | "f"; c.age: years | null) ----
    // ONE table read replaces the ~20 `fem ? a : b` ternaries that used to be
    // smeared through this function — the reason the only two bodies this rig
    // could ever build were "man" and "slightly smaller man". Every dimension
    // below now comes from the profile record and NOTHING here branches on sex
    // or age again. ADULT_M holds the exact literals this rig has always used,
    // so the untouched default path (c.build undefined/"m", no c.age) is
    // byte-identical to before this change: same widths, same offsets, same
    // leg height. Adding a body is a row in GROWTH, not new geometry code.
    const physique = physiqueOf(c);
    const P = charProfile(c.build, c.age, physique);
    // Stamped on the ROOT so any system holding only an Object3D can ask what
    // it is looking at — systems/childsafe.js reads exactly these to keep
    // children out of weapons, gore and the kill feed.
    g.userData.charBand = P.band;
    g.userData.charAge = P.ageYears;
    g.userData.charChild = !!P.child;
    const metric = {
      height: 2.60 * P.statureMul * humanScale,
      width: (P.armX * 2 + P.armW) * humanScale,
      depth: (Math.max(P.torsoD, P.pelvisD) + 0.20) * humanScale,
    };
    g.userData.characterMetric = metric;

    // ---- legs (children of root: feet stay planted) ----
    // The hip pivot is wherever the legs actually END. It used to be the
    // constant 0.95, which is precisely why a child could only ever be a
    // shrunken adult: short legs had nowhere to put the hips. Everything above
    // is stacked off this, so a toddler's hips sit at a toddler's height.
    const hipY = P.legUp + P.legLo;
    // c.shins: a different colour below the knee (bare legs under shorts or a
    // swimsuit). Absent = the whole leg is c.legs, exactly as before.
    // BARE OR CLOTHED picks the loft (LIMBS block): a segment the colour of
    // the skin is a bare limb (muscle, knee, calf, ankle); anything else is
    // cloth over it (a trouser leg that falls straight and breaks on the shoe).
    const skinC = c.skin != null ? c.skin : 0xcf9a72;
    const vOf = (hex) => (hex != null && hex === skinC ? "bare" : "cloth");
    const shinC = c.shins != null ? c.shins : c.legs;
    const ll = limb("leg", P.legW, P.legUp, P.legLo, P.legW, c.legs, c.shins, vOf(c.legs), vOf(shinC));
    const rl = limb("leg", P.legW, P.legUp, P.legLo, P.legW, c.legs, c.shins, vOf(c.legs), vOf(shinC));
    // the ANKLE (addFoot): the shoe itself is entities/footwear.js's, fitted
    // once the rig exists (CBZ.footwear.dress below), by role
    addFoot(ll, P); addFoot(rl, P);
    ll.position.set(-P.hipX, hipY, 0); rl.position.set(P.hipX, hipY, 0);
    // STEP WIDTH, from frame zero. animChar damps this channel toward the same
    // value every frame, but a rig that never animates (the charpanel portrait,
    // a paused cinematic) would otherwise stand in a stance it never had.
    ll.rotation.z = P.stanceZ; rl.rotation.z = -P.stanceZ;
    model.add(ll, rl);

    // ---- hip-locked body (pelvis and everything above it) ----------------
    const body = new THREE.Group();
    body.position.y = 0; // bob/sway/lean applied here
    model.add(body);

    // A pelvis overlaps both hip joints and the bottom of the torso. It MUST
    // live on `body`, not beside it on `model`: walking rotates and bobs body
    // round the hip socket, and sharing that transform keeps the overlap rigid.
    // THE BODY SHAPE (TORSO block): one surface per profile/physique/form/age
    // that the pelvis, chest, waist and collar all sample, so they meet.
    const form = headForm(P);
    const elder = (c.age != null && isFinite(c.age) && c.age >= 50) ? Math.round(cl01((c.age - 50) / 30) * 4) / 4 : 0;
    const headZ = 0.035 * elder * (P.torsoH / 0.95);            // an older head carries forward
    const TS = torsoSpec(P, form, elder, headZ);
    // c.pelvis: the hips in their own colour (swim briefs over bare thighs).
    const pelvisY = hipY + 0.03;
    const pelvis = partMesh(partSpec(TS, "pelvis", { w: P.pelvisW, h: P.pelvisH, d: P.pelvisD, y: pelvisY }, pelvisY),
      cmat(c.pelvis != null ? c.pelvis : c.legs));
    pelvis.position.set(0, pelvisY, 0);
    body.add(pelvis);

    // Stature is BAKED INTO THE SEGMENTS (a female rig is shorter because her
    // femur and torso are shorter, a toddler because all of them are), so this
    // node does nothing but the metre conversion.
    model.scale.setScalar(humanScale);

    // ---- the torso column: CHEST, plus a WAIST part on women and children ----
    // base sits a whisker below the hip pivot so the column overlaps the pelvis.
    // neckY is the column's nominal top; the shoulders and the neck pivot fall
    // out of the body shape (TS.shoulderY / TS.pivotY).
    const base = hipY - 0.005;
    const neckY = base + P.torsoH - 0.015;
    const waistH = P.waistShare > 0 ? P.waistShare * P.torsoH : 0;
    const chestBot = base + waistH;
    const chestH = P.torsoH - waistH;
    const chestY = chestBot + chestH / 2;
    const torso = partMesh(partSpec(TS, "chest", { w: P.torsoW, h: chestH, d: P.torsoD, y: chestY }, chestY), cmat(c.torso));
    torso.position.y = chestY;
    body.add(torso);
    // THE WAIST is the highest-value cheap female cue at gameplay distance, and
    // the SAME part is a toddler's pot belly (the profile numbers do the work).
    let waist = null;
    if (waistH > 0) {
      // c.waist: the midriff in its own colour (a bikini top's bare middle).
      const wy = base + (waistH + WAIST_TUCK) / 2;
      waist = partMesh(partSpec(TS, "waist", { w: P.waistW, h: waistH + WAIST_TUCK, d: P.waistD, y: wy }, wy),
        cmat(c.waist != null ? c.waist : c.torso));
      waist.position.y = wy;
      body.add(waist);
    }
    /* ---- the COLLAR (rig.skinSlots.collar) --------------------------------
       This slot was the SHOULDER YOKE: a flat slab laid across the top of the
       chest, bridging it to the arm sockets, with the chin sitting in it (and
       two rounds of z-fight clamps holding its faces off the chest's). The
       body now has real shoulders, so the slab is gone and the slot is what a
       garment actually has there: a COLLAR BAND standing round the base of the
       neck, bottom buried in the trapezius, top folded in to the neck.
       city/clothes.js dresses it with the yoke atlas (shirt collar, the tie
       knot at the throat); flat, it is c.collar (a jumpsuit's lighter collar). */
    const collarBox = { w: 2 * (TS.nRx + 0.022 * TS.vs) * 1.07, h: 0.108 * TS.vs, d: 2 * (TS.nRz + 0.022 * TS.vs) * 1.07, y: TS.yN };
    const collarHex = c.collar != null ? c.collar : c.torso;
    const collar = partMesh(partSpec(TS, "collar", collarBox, TS.yN, { bare: collarHex === skinC }), cmat(c.collar || c.torso));
    collar.castShadow = false;
    collar.position.y = TS.yN;
    body.add(collar);

    // short-sleeve opt-in: the forearm reads as bare skin (peds.js tees).
    // The arm pivots sit inside the shoulder the body shape ends in.
    const shoulderY = TS.shoulderY;
    // The forearm box stops at the WRIST CREASE (handH above the old wrist
    // line, exactly where the box hand used to start), and the real hand
    // hangs from there — see the HANDS block (bodyHandFit / makeBodyHand).
    const foreH = P.armLo - P.handH;
    const foreC = c.shortSleeve ? c.skin : null;
    const vFore = vOf(foreC != null ? foreC : c.arms);
    const la = limb("arm", P.armW, P.armUp, foreH, P.armW, c.arms, foreC, vOf(c.arms), vFore);
    const ra = limb("arm", P.armW, P.armUp, foreH, P.armW, c.arms, foreC, vOf(c.arms), vFore);
    // The chase camera sees the old +X "right" socket on the player's visible
    // left flank. Mirror the arm roots so the semantic right hand — and every
    // weapon attached to it — is actually on the player's right in third person.
    la.position.set(P.armX, shoulderY, 0); ra.position.set(-P.armX, shoulderY, 0);
    la.rotation.z = P.armOutZ; ra.rotation.z = -P.armOutZ;   // idle carry, frame zero
    body.add(la, ra);
    const leftHand = new THREE.Group();
    const rightHand = new THREE.Group();
    // wrist, in the ELBOW group's frame (the upper segment is spent above it)
    leftHand.position.set(0, -P.armLo - 0.01, 0.035);
    rightHand.position.set(0, -P.armLo - 0.01, 0.035);
    leftHand.userData.isSocket = rightHand.userData.isSocket = true;
    la.userData.low.add(leftHand); ra.userData.low.add(rightHand);
    const thirdPersonWeapon = new THREE.Group();
    thirdPersonWeapon.position.set(0.02, -0.03, 0.06);
    thirdPersonWeapon.userData.isSocket = true;
    rightHand.add(thirdPersonWeapon);
    // HANDS: the first-person hand, hung at the wrist crease (HANDS block).
    const handFit = bodyHandFit(P);
    const handL = makeBodyHand(-1, handFit, c.skin);
    const handR = makeBodyHand(1, handFit, c.skin);
    if (handL) { la.userData.low.add(handL); la.userData.cap = handL; }
    if (handR) { ra.userData.low.add(handR); ra.userData.cap = handR; }
    // THE ARMS HAVE A RANGE: the drawn shoulder / elbow / wrist hold to it
    // (a shoulder only while it hangs on THIS body: a severed arm tumbles free)
    for (const a of [la, ra]) {
      Object.defineProperty(a, "_armBody", { value: body, writable: true, configurable: true, enumerable: false });   // (not userData: Object3D.copy JSON-clones that)
      a.updateMatrix = shoulderUpdateMatrix;
      a.userData.low.updateMatrix = elbowUpdateMatrix;
      if (a.userData.cap) a.userData.cap.updateMatrix = wristUpdateMatrix;
    }

    // neck pivot so the head can turn/tilt independently. neckDrop sinks the
    // head toward the shoulders for the young: a toddler has no visible neck at
    // all, and that "head sitting straight on the shoulders" read is half of
    // what makes a small body look like a CHILD instead of a distant adult.
    const neck = new THREE.Group();
    neck.updateMatrix = neckUpdateMatrix;   // THE NECK HAS A RANGE (drawn inside it, whoever wrote it)
    // The pivot rides NECK_LEN above the column top (TORSO block), so the
    // neck shows between the chin and the collar; an older head carries forward.
    neck.position.set(0, TS.pivotY, headZ);
    // head keeps a FRESH (unshared) material — reactions.js / gore.js /
    // crowd.js tint it per actor, so it must not be a shared cache entry. Its
    // GEOMETRY is shared (see SHAPED PARTS): one per form + nose, sized by
    // scale, and it carries the neck, nose and ears in the same skin.
    const headSize = P.headSize;
    const hk = headSize / 0.60;
    const skinHex = c.skin != null ? c.skin : 0xcf9a72;
    const hairHex = c.hair != null ? c.hair : 0x4a3526;
    const noseV = c.nose != null ? c.nose : defaultNose(skinHex, hairHex);
    // the head wears the SHARED tint for its skin tone (world/materials.js
    // CBZ.tintOf): writers go through CBZ.paintMesh / CBZ.ownMaterial
    if (!_headBase) _headBase = mat(0xcf9a72);
    const head = new THREE.Mesh(headGeometry(form, noseV), CBZ.tintOf(_headBase, skinHex) || mat(skinHex));
    head.position.y = headSize / 2; head.scale.setScalar(hk); head.castShadow = true;
    head.name = "head";
    neck.add(head);
    // FACE SCALE NODES: systems/facial.js poses the face through facePose in
    // ABSOLUTE numbers for the 0.60 adult head. Parenting the features to
    // groups scaled by headSize/0.60 means those land in a frame that shrinks
    // WITH the head, so a toddler's face is a toddler's face. Three siblings,
    // all the same frame: `face` (brow, lips, mouth interior, beard), `eyesNear`
    // (balls + lids + lashes) and `eyesFar` (the far-tier eye line). The tier
    // (faceLod) toggles only the two EYE GROUPS, never a member mesh, so the
    // per-mesh LODs elsewhere (npc.js ch.detail, warlord campaign faces) and
    // this one can never fight over the same `visible` flag.
    const face = new THREE.Group();
    face.scale.setScalar(hk);
    face.name = "face";
    neck.add(face);
    const eyesNear = new THREE.Group();
    eyesNear.scale.setScalar(hk); eyesNear.name = "eyesNear";
    const eyesFar = new THREE.Group();
    eyesFar.scale.setScalar(hk); eyesFar.name = "eyesFar"; eyesFar.visible = false;
    neck.add(eyesNear, eyesFar);
    // EYES in their sockets (see THE FACE): the ball, then the lids over it
    const eyeShape = Math.max(0, Math.min(2, (c.eyeShape != null ? c.eyeShape : defaultEyeShape(skinHex, hairHex)) | 0));
    const eyeZ = EYE.front - eyeR(form);
    const em = eyeMat(c.eye != null ? c.eye : defaultEye(skinHex, hairHex));
    const le = new THREE.Mesh(eyeballGeometry(form), em);
    const re = new THREE.Mesh(eyeballGeometry(form), em);
    le.position.set(-EYE.x, EYE.y, eyeZ); re.position.set(EYE.x, EYE.y, eyeZ);
    le.rotation.order = re.rotation.order = "YXZ";
    le.name = re.name = "eye";
    // the lids wear the HEAD'S OWN material: same shader, tint, reactions
    // flush, gore grey and ink map (their UVs read the plain texel), so the
    // lid can never read as a different skin (facial.js re-syncs on a swap)
    const lidUp = new THREE.Mesh(lidGeometry("U", eyeShape, form), head.material);
    const lidLow = new THREE.Mesh(lidGeometry("L", eyeShape, form), head.material);
    lidUp.position.set(0, EYE.y, eyeZ); lidLow.position.set(0, EYE.y, eyeZ);
    lidUp.name = "lidUpper"; lidLow.name = "lidLower";
    const lashes = new THREE.Mesh(lashGeometry(eyeShape, form), cmat(LASH));
    lashes.name = "lashes";
    lidUp.add(lashes);
    eyesNear.add(le, re, lidUp, lidLow);
    const farEyes = new THREE.Mesh(farEyeGeometry(), farEyeMat());
    farEyes.name = "farEyes";
    eyesFar.add(farEyes);
    // BROWS: one mesh, a brow laid on the skin over each eye, in the hair's
    // tone over a stroke texture. Its geometry sits BELOW its origin.
    const brow = new THREE.Mesh(browGeometry(form, "n"), faceHairMat(c.brow != null ? c.brow : browTone(hairHex), "brow"));
    brow.position.set(0, BROW_REST_Y, 0.303);
    // MOUTH: two lips in a lip tone off the skin (fuller for f and for c.lips —
    // heritage.js rolls it), closed; the inside + teeth only exist when open
    const lipM = cmat(c.lip != null ? c.lip : lipTone(skinHex));
    const lipSx = form === "c" ? 0.84 : (form === "f" ? 0.94 : 1);
    const lipSy = (form === "f" ? 1.12 : (form === "c" ? 0.92 : 1)) * (c.lips ? 1.25 : 1);
    const mouth = new THREE.Mesh(lipGeometry("U", "n"), lipM);
    const lipLow = new THREE.Mesh(lipGeometry("L", "n"), lipM);
    mouth.position.set(0, MOUTH_REST_Y, 0); lipLow.position.set(0, MOUTH_REST_Y, 0);
    mouth.scale.set(lipSx, lipSy, 1); lipLow.scale.set(lipSx, lipSy, 1);
    mouth.name = "lipUpper"; lipLow.name = "lipLower";
    const cavity = new THREE.Mesh(cavityGeometry(), cmat(CAVITY));
    const teethUp = new THREE.Mesh(teethGeometry("U"), cmat(TEETH));
    const teethLow = new THREE.Mesh(teethGeometry("L"), cmat(TEETH));
    cavity.name = "mouthCavity"; teethUp.name = teethLow.name = "teeth";
    cavity.visible = teethUp.visible = teethLow.visible = false;
    for (const m of [le, re, lidUp, lidLow, lashes, farEyes, brow, mouth, lipLow, cavity, teethUp, teethLow]) m.castShadow = false;
    face.add(brow, mouth, lipLow, cavity, teethUp, teethLow);
    /* ---- FACIAL HAIR (entities/heritage.js) --------------------------------
       c.beard: "full" | "goatee" | "moustache" | "stubble". ONE merged mesh
       per (style, form), a shell laid on the skull (see beardGeometry). A
       full beard stops UNDER the mouth so the lips read; the moustache sits
       under the nose over the upper lip. Stubble is a skin-thin shell in a
       tone halfway between hair and skin, speckled. */
    const beardParts = [];
    if (c.beard) {
      const bm = c.beard === "stubble" ? faceHairMat(mixHex(hairHex, skinHex, 0.55), "stubble") : faceHairMat(hairHex, "beard");
      const bd = new THREE.Mesh(beardGeometry(c.beard, form), bm);
      bd.castShadow = false; bd.name = "beard";
      face.add(bd); beardParts.push(bd);
    }
    body.add(neck);

    // ---- accessories (all on the body so they move with it) ----
    // Jumpsuit STRIPES were three 0.94-wide slabs round a box; now each is a
    // band of the body's own surface, held 1 cm off it (TORSO block shells).
    if (c.stripes) for (let i = 0; i < 3; i++) {
      const yc = base + (1.18 + i * 0.28 - 0.945) / 0.95 * P.torsoH, hh = 0.06 * TS.vs;
      const sp = partSpec(TS, "band", { w: P.torsoW + 0.03, h: 2 * hh, d: P.torsoD + 0.03, y: yc }, yc, { y0: yc - hh, y1: yc + hh, off: 0.012 * TS.vs });
      const s = partMesh(sp, cmat(c.stripes));
      s.castShadow = false;
      s.position.y = yc; body.add(s);
      (body.userData.stripes || (body.userData.stripes = [])).push(s);
    }
    const beltParts = [], badgeParts = [], capParts = [], hairParts = [];
    // BELTS ARE PAINTED, NOT GEOMETRY (owner). With CHAR_BELT_PAINTED on
    // (default) the geometric band+buckle is skipped entirely — no hidden
    // meshes, beltParts stays empty (so every skinSlots.belt recolor call site
    // safely no-ops) — and the belt read comes from the painted garment
    // textures in city/clothes.js. Flip CHAR_BELT_PAINTED false to rebuild the
    // geometric belt: CHAR_BELT_V2 then chooses the build-aware band (default)
    // or the legacy fixed band, exactly as before.
    if (c.belt && CBZ.CONFIG.CHAR_BELT_PAINTED === false) {
      if (CBZ.CONFIG.CHAR_BELT_V2 !== false) {
        // Build-aware waist band straddling the torso→pelvis seam, so it is
        // sized off BOTH boxes of the CURRENT build: a hair NARROWER than the
        // shirt (torso W 0.92/0.78) so it tucks in instead of shelving past the
        // silhouette, and PROUD of the hips (pelvis W 0.84/0.72, D 0.48/0.43) so
        // it hugs the waist. Every offset is 0.01–0.03 — nothing coplanar with
        // the torso/pelvis faces it overlaps (TBDR z-fight guard) — and the band
        // follows the collar/stripe grammar (H 0.14) instead of a fat 0.16 slab.
        // The old fixed 0.96 band ignored `fem` entirely (see CHAR_BELT_V2).
        // Sized off the CURRENT build's boxes: a hair narrower than the shirt so
        // it tucks in, proud of the hips so it hugs. Profile-driven now, so a
        // child's belt is a child's belt instead of a hula hoop.
        const beltW = (waist ? P.waistW : P.torsoW) * 0.98;
        const beltD = (waist ? P.waistD : P.torsoD) * 1.04;
        const beltY = base + Math.max(0.06, waistH * 0.45);
        const belt = new THREE.Mesh(boxGeom(beltW, 0.14 * P.statureMul, beltD), cmat(c.belt));
        belt.position.y = beltY; body.add(belt); beltParts.push(belt);
        // Buckle plate: shorter than the band (H 0.10, seated within it) and
        // straddling the band's front face (beltD/2 → half its depth buried in
        // the band, half proud) so it reads raised and never floats off.
        // Derived from the band, not from sex — the last `fem ?` in this
        // function is gone, which was the whole point of the profile table.
        const buckle = new THREE.Mesh(boxGeom(beltW * 0.20, 0.10, 0.06), cmat(0xffd451));
        buckle.position.set(0, beltY, beltD / 2); body.add(buckle); beltParts.push(buckle);
      } else {
        const belt = new THREE.Mesh(boxGeom(0.96, 0.16, 0.54), cmat(c.belt));
        belt.position.y = 1.02; body.add(belt); beltParts.push(belt);
        const buckle = new THREE.Mesh(boxGeom(0.18, 0.16, 0.06), cmat(0xffd451));
        buckle.position.set(0, 1.02, 0.29); body.add(buckle); beltParts.push(buckle);
      }
    }
    /* THE BADGE was a 16 cm gold CUBE on the wearer's RIGHT. It is a thin
       metal shield now (~5 x 6 cm), on the LEFT chest (+x: the rig faces +z,
       its right arm is at -x) just above where a pocket flap sits, laid on the
       real surface and tilted to its normal. Police/CO/sheriff rigs carry
       their badge in entities/dutykit.js's merged kit instead; this one is
       for rigs built with c.badge (warlord rank badges). When a jacket shell
       goes on, city/clothes.js re-seats it onto the shell (CBZ.humanSeatBadge). */
    if (c.badge) {
      const badge = new THREE.Mesh(badgeGeometry(), cmat(0xffd451));
      badge.castShadow = false;
      const by = base + P.torsoH * 0.73, bx = 0.40 * TS.at(by).a;
      badge.userData.badgeAt = { x: bx, y: by };
      body.add(badge); badgeParts.push(badge);
      seatBadgeMesh(TS, badge, 0);
    }
    /* HEADWEAR (entities/headwear.js, CBZ.headwear) is fitted AFTER the rig
       exists — c.cap (a role's uniform hat: c.capKind picks which) and c.hat
       (a civilian's sun hat or cap) both go through CBZ.headwear.wear below.
       The HAIR IS ALWAYS BUILT now (a cap no longer deletes it): headwear
       compresses it under the crown, and whatever hangs below the band (a
       ponytail, long hair under a helmet) still falls out from under it. */
    if (!c.bald) {
      // c.bald (entities/heritage.js): a SHAVED head is no hair mesh at all —
      // the scalp is the skull's own skin, not a skin-coloured cap.
      // ONE MERGED SHELL — see the HAIR SHELL block above for the owner bug and
      // why a skull-cap-plus-back-plank can never be fixed by tucking. The
      // boxes are merged into a single cached BufferGeometry, so the seam
      // cannot exist (there is no seam) and a long-haired woman now costs ONE
      // draw call where she used to cost two.
      let styleId = hairStyleFor(c, P);
      // the shoulder yoke as THIS rig built it, in the unit head frame (the
      // neck pivot, scaled by the head): a young body's hair is fitted to it
      const hairYoke = {
        // (the torso merge: the collar is now a band round the neck base, so the
        // yoke's reach is the profile's shoulder yoke, its top the band's top)
        top: Math.round((collar.position.y + collarBox.h / 2 - neck.position.y) / hk * 200) / 200,
        back: Math.round(-P.collarD / 2 / hk * 200) / 200,
        half: Math.round(P.collarW / 2 / hk * 200) / 200,
        // the shoulder: each upper arm's top dome is centred ON its pivot, so a
        // ball there is the shoulder in every arm pose
        armX: Math.round(P.armX / hk * 200) / 200,
        armY: Math.round((shoulderY - neck.position.y) / hk * 200) / 200,
        armR: Math.round(P.armW / 2 / hk * 200) / 200,
      };
      const hairMesh = new THREE.Mesh(hairGeometry(styleId, headSize, false, hairYoke), cmat(c.hair || 0x4a3526));
      hairMesh.userData.hairYoke = hairYoke;    // headwear.js: pass it as hairGeometry's 4th argument
      hairMesh.castShadow = true;
      hairMesh.userData.hairStyle = styleId;
      hairMesh.userData.hairS = headSize;       // headwear.js rebuilds the style (afro -> curly) under a crown
      // the near/far pair setHairLod swaps between (headwear may replace both)
      hairMesh.userData.hairLods = { near: hairMesh.geometry, far: hairGeometry(styleId, headSize, true, hairYoke) };
      // HAIR FOLLOW (above): a style that hangs behind the nape keeps its
      // length on the back while the head turns
      if (hairMesh.geometry.userData.hairFollow) {
        hairMesh.material.morphTargets = true;
        hairMesh.updateMorphTargets();
        hairMesh.userData.hairFollow = true;
        hairMesh.onBeforeRender = hairFollowRender;
      }
      neck.add(hairMesh); hairParts.push(hairMesh);
    }

    // painted-clothing atlas metadata: which vertical band of the garment row
    // each segment shows (0=hem/wrist, 1=shoulder/waist). city/clothes.js
    // reads these to UV-map split limbs; absent tags = whole row (legacy).
    // Profile-driven, so a painted sleeve lands on a child's short arm in the
    // same place it lands on an adult's instead of running off the end of it.
    // At adult-male numbers every value below is the literal that was here.
    const tagCloth = (mesh, dims, band) => { mesh.userData.clothDims = dims; mesh.userData.clothBand = band; };
    // THE TORSO COLUMN IS TWO BOXES NOW for any body with a waist, and a
    // garment row painted across it must be SPLIT or every horizontal feature
    // in it (hem, belt, waistband, print) draws twice — once on the chest and
    // again on the waist, which is exactly the doubled belt line you would see.
    // Tagged here, at the only place that knows the real split, so city/
    // clothes.js never has to re-derive it from a copy of WAIST_TUCK that can
    // silently drift out of step with this file.
    if (waist) {
      const wh = waistH + WAIST_TUCK;
      tagCloth(torso, [P.torsoW, chestH, P.torsoD], [waistH / P.torsoH, 1]);          // TOP of the row
      tagCloth(waist, [P.waistW, wh, P.waistD], [0, Math.min(1, wh / P.torsoH)]);     // BOTTOM of the row
    }
    // the sleeve is shoulder -> wrist crease (the hand is skin, not garment)
    const armLen = P.armUp + foreH, legLen = P.legUp + P.legLo;
    const alw = P.armW * 0.9, llw = P.legW * 0.9;
    tagCloth(la.userData.main, [P.armW, P.armUp, P.armW], [1 - P.armUp / armLen, 1]);
    tagCloth(ra.userData.main, [P.armW, P.armUp, P.armW], [1 - P.armUp / armLen, 1]);
    tagCloth(la.userData.lower, [alw, foreH + 0.06, alw], [0, (foreH + 0.06) / armLen]);
    tagCloth(ra.userData.lower, [alw, foreH + 0.06, alw], [0, (foreH + 0.06) / armLen]);
    tagCloth(ll.userData.main, [P.legW, P.legUp, P.legW], [1 - P.legUp / legLen, 1]);
    tagCloth(rl.userData.main, [P.legW, P.legUp, P.legW], [1 - P.legUp / legLen, 1]);
    tagCloth(ll.userData.lower, [llw, P.legLo + 0.06, llw], [0, (P.legLo + 0.06) / legLen]);
    tagCloth(rl.userData.lower, [llw, P.legLo + 0.06, llw], [0, (P.legLo + 0.06) / legLen]);

    const rig = {
      group: g, model, metric, body, neck, head,
      parts: { ll, rl, la, ra },
      low: { ll: ll.userData.low, rl: rl.userData.low, la: la.userData.low, ra: ra.userData.low },
      sockets: { leftHand, rightHand, weapon: rightHand, thirdPersonWeapon },
      // The body this rig was BUILT from. Every downstream system that used to
      // guess an adult constant (seated hip height, mount points, gait
      // multipliers, child protection) reads it from here instead.
      profile: P, hipY, band: P.band, child: !!P.child, ageYears: P.ageYears,
      stanceZ: P.stanceZ, armOutZ: P.armOutZ, gait: P.gait || GAIT_NEUTRAL,
      skinSlots: {
        // torso[0] stays the CHEST box — clothes.js and wounds.js both index
        // [0] and would otherwise start painting/bleeding on a waistband.
        torso: waist ? [torso, waist] : [torso],
        collar: [collar],
        legs: [ll.userData.main, rl.userData.main],
        legsLower: [ll.userData.lower, rl.userData.lower],
        pelvis: [pelvis],
        shoes: [ll.userData.cap, rl.userData.cap].filter(Boolean),
        arms: [la.userData.main, ra.userData.main],
        armsLower: [la.userData.lower, ra.userData.lower],
        hands: [la.userData.cap, ra.userData.cap].filter(Boolean),
        head: [head],
        stripes: body.userData.stripes || [],
        belt: beltParts,
        badge: badgeParts,
        cap: capParts,
        hair: hairParts,
        beard: beardParts,
      },
      // posed ONLY through CBZ.human.facePose (systems/facial.js animates it):
      // eyeL/eyeR the balls (gaze = rotation), lidUp/lidLow the lids (blink =
      // lidUp.rotation.x), mouth = the upper lip, lipLow the lower. Everything
      // here is safe to show at any time; the mouth interior is NOT in this
      // record (rig.mouthIn) because it must stay hidden while the mouth is shut.
      face: { eyeL: le, eyeR: re, lidUp, lidLow, lashes, brow, mouth, lipLow },
      mouthIn: { cavity, teethUp, teethLow },
      faceNodes: { near: eyesNear, far: eyesFar, farEyes },
      faceRest: { v2: true, eyeX: EYE.x, eyeY: EYE.y, eyeZ: eyeZ, mouthY: MOUTH_REST_Y, browY: BROW_REST_Y,
                  form: form, nose: noseV, eyeShape: eyeShape, lidClose: lidCloseAngle(eyeShape, form),
                  lipSx: lipSx, lipSy: lipSy, lipExpr: "n", browExpr: "n", near: true },
      headForm: form,
      detail: [le, re, lidUp, lidLow, farEyes, brow, mouth, lipLow].concat(hairParts, beardParts, capParts, body.userData.stripes || [], badgeParts),
      phase: Math.random() * 6.28,  // desync gaits between actors
      bob: 0, breath: Math.random() * 6.28,
      lean: 0, sway: 0, headYaw: 0,
      // the tone this rig was BUILT with — skin-showing painted garments
      // (clothes.js wifebeater etc.) read it so a bare shoulder matches the
      // face instead of a hard-coded shared-atlas tan.
      skinTone: c.skin != null ? c.skin : 0xcf9a72,
      // THE BODY SHAPE (TORSO block): garment shells, badges and ties read it
      torsoShape: TS, physique: physique,
      torsoFrontZ: function (x, y) { return torsoSurfaceZ(TS, x, y, 1); },
      torsoBackZ: function (x, y) { return torsoSurfaceZ(TS, x, y, -1); },
    };
    // HANDS: rig.setHandPose / rig.setHandLod (HANDS block above makeCharacter)
    rig.handFit = handFit;
    rig.setHandPose = function (side, pose) { setBodyHandPose(rig, side, pose); };
    // one distance LOD for the whole body: the hands (fphands body LODs) and
    // the limb lofts (LIMBS block) swap together
    rig.setHandLod = function (lod) { rig._lodExt = true; setBodyHandLod(rig, lod); setLimbLod(rig, lod); setHairLod(rig, lod); setTorsoLod(rig, lod); };
    /* A rig no system LODs (every mode but the city crowd) checks its own
       distance to the camera every 24th animChar and takes the far hands and
       limbs past ~30 m, with the same 26/30 m hysteresis as peds.js. The
       player's own rig stays near. */
    let lodTick = (Math.random() * 24) | 0, lodNow = 1;
    rig._autoLod = function () {
      if (++lodTick < 24) return;
      lodTick = 0;
      const cam = CBZ.camera;
      if (!cam || rig === CBZ.playerChar) return;
      const e = g.matrixWorld.elements, c = cam.matrixWorld.elements, dx = e[12] - c[12], dy = e[13] - c[13], dz = e[14] - c[14];
      const d2 = dx * dx + dy * dy + dz * dz;
      const want = lodNow === 2 ? (d2 < 26 * 26 ? 1 : 2) : (d2 > 30 * 30 ? 2 : 1);
      if (want !== lodNow) { lodNow = want; setBodyHandLod(rig, want); setLimbLod(rig, want); setHairLod(rig, want); setTorsoLod(rig, want); }
    };
    // HEADWEAR: the role's uniform hat (c.cap = its colour, c.capKind the kind,
    // "peaked" when unsaid — the police/guard cap every c.cap caller wanted)
    // and a civilian's hat over the hair (c.hat "sun" | "cap", c.hatColor).
    // skinSlots.cap is kept filled with the role hat's meshes (headwear.js).
    const HW = CBZ.headwear;
    if (HW) {
      if (c.cap) HW.wear(rig, c.capKind || "peaked:police", { owner: "outfit", color: c.cap, accent: c.capAccent,
        metal: c.capMetal || (/police/.test(c.capKind || "peaked:police") ? "silver" : undefined) });
      if (c.hat) HW.wear(rig, c.hat === "sun" ? "sun" : (c.hat === "cap" ? "ballcap" : c.hat), { owner: "beach", color: c.hatColor, backward: !!c.hatBack });
    }
    // A c.hat comes off in the water: every swimmer's pose (poseSwimmer) sets
    // rig.swimming true and the caller clears it on landing, so the hat rides
    // that one flag — no caller has to remember it, and it costs a compare.
    // The hair under it springs back (headwear.js un-compresses it).
    if (c.hat && HW) {
      let swimFlag = false;
      Object.defineProperty(rig, "swimming", {
        configurable: true, enumerable: true,
        get() { return swimFlag; },
        set(v) {
          v = !!v;
          if (v === swimFlag) return;
          swimFlag = v;
          HW.setHidden(rig, "swim", v);
        },
      });
    }
    if (c.clothes && CBZ.applyClothes) CBZ.applyClothes(rig, c.clothes);
    // THE SHOES (entities/footwear.js): by role, on the ankle pivots; the
    // wardrobe re-rolls them against the outfit (CBZ.footwear.restyle)
    if (CBZ.footwear) CBZ.footwear.dress(rig, c);
    else if (!_footWarned && typeof console !== "undefined") { _footWarned = true; console.warn("character.js: entities/footwear.js not loaded before makeCharacter — bodies have no shoes"); }
    rig.feet = { ll: ll.userData.foot, rl: rl.userData.foot };
    if (CBZ.wristwatch) CBZ.wristwatch.fit(rig, c);   // entities/watch.js: the watch on the left wrist, by role
    // every face on the page lives (blinks, looks, talks, LODs) through
    // systems/facial.js; a page without it keeps a still, near-tier face
    if (typeof CBZ.faceRegister === "function") CBZ.faceRegister(rig);
    return rig;
  }

  // shortest-arc angle lerp
  function lerpAngle(a, b, t) {
    let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }

  // frame-rate-independent approach: x → target by `rate` (per second)
  function damp(cur, target, rate, dt) {
    return cur + (target - cur) * (1 - Math.exp(-rate * dt));
  }
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const smooth01 = (v) => {
    v = clamp01(v);
    return v * v * (3 - 2 * v);
  };
  const smoother01 = (v) => {
    v = clamp01(v);
    return v * v * v * (v * (v * 6 - 15) + 10);
  };
  /* ---- HANDS ON THE OBSTACLE (vault / mantle) ------------------------------
     OWNER: "vaulting things, just like use of hands in physical world and
     code behind that." The vault poses were Euler tables: a shoulder swung to
     -1.8 rad and an elbow to -0.5 whatever the wall was, so the "planted"
     hand hung in the air half a metre over a waist-high wall (and a metre
     over a car roof), and the mantle's own solve was sagittal-only. A hand
     that carries the body over something is ON it: the palm flat on the top,
     at a real point a hand's width in from the near edge, fingers pointing
     the way the body goes, held there in the WORLD while the body swings over
     it, and let go when the shoulder has passed out of the arm's reach.

     Two things make that true instead of a pose:
       · the palm is solved onto the point every frame (charArmTo.plant: the
         exact arm IK plus the palm laid on the surface);
       · the body COMES DOWN TO its hands. The trajectory (physics.js) carries
         the feet over the top; a real vaulter's hips skim the obstacle with
         the legs tucked or swung aside, which puts the shoulders an arm's
         length over the plant. The rig is lowered (ch.model, the node the
         legs and torso hang from) by exactly what the planted arm needs,
         never so far that the pelvis or a foot goes into the obstacle or the
         ground under it. What cannot be reached stays reached-for, measured
         (tp._plantRes), never faked.
     Plants per move: mantle both hands at the lip; kong both hands out on the
     top; speed and spin one hand (the left, the side the legs swing past). */
  const _tpP = new THREE.Vector3(), _tpS = new THREE.Vector3(), _tpUp = new THREE.Vector3(0, 1, 0);
  const _tpDir = new THREE.Vector3(), _tpA = new THREE.Vector3();
  const _plantW = { l: 0, r: 0 }, _spinP = new THREE.Vector3();
  const TRAV_PLANTS = {
    // [arm, lateral share of the shoulder half-width (+ = the body's left), inset m past the near edge]
    mantle: [["l", 0.85, 0.06], ["r", 0.85, 0.06]],
    kong: [["l", 0.55, 0.12], ["r", 0.55, 0.12]],
    speed: [["l", 0.80, 0.07]],
    spin: [["l", 0.40, 0.07]],
  };
  function travPlantPoints(ch, tp) {
    const key = tp.kind === "mantle" ? "mantle" : tp.style;
    const spec = TRAV_PLANTS[key];
    if (!spec || tp.ledgeX == null || tp.top == null) return null;
    if (tp._plants && tp._plantsCh === ch) return tp._plants;
    const halfW = Math.min(0.24, ((ch.metric && ch.metric.width) || 0.9) * 0.28);
    // a car's roof starts a hand in from its flank; a thin wall's top is only so deep
    const deep = Math.max(0.03, (tp.span || 0.3) * 0.5);
    const out = [];
    for (let i = 0; i < spec.length; i++) {
      const sd = spec[i], side = sd[0] === "l" ? 1 : -1;
      const inset = Math.min(deep, tp.car ? Math.max(sd[2], 0.30) : sd[2]);
      const lat = halfW * sd[1] * side;
      out.push({
        arm: sd[0],
        // local +X (the body's left) in world is (dirZ, 0, -dirX)
        p: new THREE.Vector3(tp.ledgeX + tp.dirX * inset + tp.dirZ * lat, tp.top, tp.ledgeZ + tp.dirZ * inset - tp.dirX * lat),
        res: 0,
      });
    }
    tp._plants = out; tp._plantsCh = ch;
    return out;
  }
  // what is under a world point during the move: the obstacle's top inside
  // its footprint (along the move line), the ground either side of it
  // (ramped over the last 15 cm either side: a foot about to cross the face
  // has to be over the top already, or the body would pop up the frame it did)
  function travSupportY(tp, x, z) {
    const t = (x - tp.ledgeX) * tp.dirX + (z - tp.ledgeZ) * tp.dirZ, span = tp.span || 0;
    if (t >= -0.02 && t <= span + 0.02) return tp.top;
    const ground = t < 0 ? (tp.startY != null ? tp.startY : 0) : (tp.endY != null ? tp.endY : 0);
    const out = t < 0 ? -t : t - span;
    return ground + (tp.top - ground) * (1 - smooth01((out - 0.02) / 0.14));
  }
  const _ttS = new THREE.Vector3(), _ttD = new THREE.Vector3(), _ttH = new THREE.Vector3();
  function travTorso(ch, tp, plants, weights) {
    const CA = CBZ.charArmTo;
    // a mantle hangs on the face first: the chest may only go over the top
    // once the hips have come up to the lip (before that it would go INTO it)
    let gate = 1;
    const hy = hipYOf(ch);
    if (tp.kind === "mantle") {
      _ttH.set(0, hy, 0);
      ch.model.localToWorld(_ttH);
      gate = smooth01((_ttH.y - (tp.top - 0.35)) / 0.30);
      if (gate <= 0) return;
    }
    const scale = ch.model.matrixWorld.getMaxScaleOnAxis() || 0.7;
    const sm = scale / (ch.model.scale.y || 1);          // world per model unit... (group)
    const toRig = (ch.model.scale.y || 1) / scale;       // world metres -> model units
    // every loaded hand: its plant (model frame) and its shoulder (body frame, unrotated)
    const L = [];
    let wMax = 0;
    for (let i = 0; i < plants.length; i++) {
      const w = weights[plants[i].arm] || 0;
      if (w <= 0.01) continue;
      const part = plants[i].arm === "l" ? ch.parts.la : ch.parts.ra;
      const P = ch.model.worldToLocal(_ttD.copy(plants[i].p)).clone();
      L.push({ P: P, v: part.position, reach: CA.palmSpan(ch, plants[i].arm) * 0.90 * toRig, w: w });
      if (w > wMax) wMax = w;
    }
    if (!L.length) return;
    const w = wMax * gate;
    /* Search the chest's pitch (and, on one hand, its roll onto that arm) for
       the pose closest to the authored one that puts every loaded shoulder
       within an arm's reach of its plant. The shoulders ride a sphere about
       the hip pivot, so "aim the chest at the ideal point" overshoots whenever
       the hip is nearer the hand than the torso is long; a direct search over
       the joint does not. Analytic per candidate (Euler XYZ: Rx(p)Rz(r) about
       the hip pivot), ~800 evaluations, only while a hand is loaded. */
    const p0 = ch.body.rotation.x, r0 = ch.body.rotation.z;
    const bob = ch.body.position.y - (ch._hipCompY || 0);
    const oneHand = L.length === 1;
    // a one-hand vault tips SIDEWAYS onto its arm (the legs are going past on
    // the other side); a kong and a mantle pitch over their hands
    const pitchCost = oneHand && tp.kind === "vault" ? 0.35 : 0.05;
    let bestP = p0, bestR = r0, best = Infinity;
    for (let ri = 0; ri <= (oneHand ? 19 : 0); ri++) {
      const r = oneHand ? -0.95 + ri * 0.1 : r0;
      const cr = Math.cos(r), sr = Math.sin(r);
      for (let pi = 0; pi <= 40; pi++) {
        const p = -0.55 + pi * 0.05;
        const cp = Math.cos(p), sp = Math.sin(p);
        let cost = Math.abs(p - p0) * pitchCost + Math.abs(r - r0) * 0.05;
        for (let k = 0; k < L.length; k++) {
          const v = L[k].v, P = L[k].P;
          // Rz(r) then Rx(p) on (vx, vy - hy, vz)
          const x1 = v.x * cr - (v.y - hy) * sr, y1 = v.x * sr + (v.y - hy) * cr, z1 = v.z;
          const x = x1, y = y1 * cp - z1 * sp + hy + bob, z = y1 * sp + z1 * cp;
          const d = Math.hypot(x - P.x, y - P.y, z - P.z);
          // out of reach costs; so does a shoulder that dropped BELOW its hand
          cost += Math.max(0, d - L[k].reach) * 4 + Math.max(0, P.y + 0.10 / toRig * 0 - y) * 2;
        }
        if (cost < best) { best = cost; bestP = p; bestR = r; }
      }
    }
    ch.body.rotation.x = p0 + (bestP - p0) * w;
    ch.body.rotation.z = r0 + (bestR - r0) * w;
    lockCharacterHips(ch);
    ch.group.updateMatrixWorld(true);
  }
  /* weight = how much this plant carries the arm this frame (the move's own
     envelope). Lowers the rig, solves the planted arms, returns true if any
     hand is on the obstacle. */
  function traversePlants(ch, tp, weights, lower, pivotY) {
    const plants = travPlantPoints(ch, tp);
    const CA = CBZ.charArmTo;
    if (!plants || !CA || !CA.plant || !ch.model || !ch.group) return false;
    ch.group.updateMatrixWorld(true);
    const scale = ch.model.matrixWorld.getMaxScaleOnAxis() || 0.7;
    pivotY = pivotY || 0;
    // ---- how far the body must come down for the planted arms to reach
    //      (absolute: measured with this frame's drop in place, then added back)
    const gs = scale / (ch.model.scale.y || 1);               // the group's own scale
    // measure with last frame's drop in place (the pose above is this frame's)
    const cur = lower ? (tp._drop || 0) : 0;
    if (!ch._seatSunk) { ch.model.position.y = pivotY - cur / gs; ch.group.updateMatrixWorld(true); }
    /* THE TORSO GOES WHERE THE HANDS ARE. At a run the root crosses a waist-
       high wall in a third of a second; a torso held at an authored pitch
       carries the shoulders straight past the plant in two frames. A vaulter
       pivots OVER the hands instead: the chest dives toward them, stays over
       them while the hips swing through, and comes up behind. So while a hand
       is loaded, the chest's pitch (and on a one-hand vault its roll onto the
       loaded arm) is solved to put that shoulder an arm's length straight
       above its plant, blended over the authored pose by the plant weight. */
    if (lower) travTorso(ch, tp, plants, weights);
    let need = 0, any = false;
    for (let i = 0; i < plants.length; i++) {
      const w = weights[plants[i].arm] || 0;
      if (w <= 0.01) continue;
      any = true;
      const part = plants[i].arm === "l" ? ch.parts.la : ch.parts.ra;
      part.getWorldPosition(_tpS);
      const reach = CA.palmSpan(ch, plants[i].arm) * 0.93;
      const P = plants[i].p;
      // coming down only helps a hand whose shoulder is already over its
      // plant: a plant still a stride ahead is reached by running to it
      const h = Math.hypot(_tpS.x - P.x, _tpS.z - P.z);
      if (h >= reach * 0.97) continue;
      const want = Math.sqrt(Math.max(0, reach * reach - h * h));
      need = Math.max(need, (cur + (_tpS.y - P.y) - want) * w);
    }
    // ---- a VAULT's hips skim the top: that, not the arms, is what brings a
    //      vaulter down onto his hands (the feet's arc is only the clearance)
    const hy = hipYOf(ch);
    _tpP.set(0, hy, 0);
    ch.model.localToWorld(_tpP);
    if (tp.kind === "vault") {
      let wMax = 0;
      for (let i = 0; i < plants.length; i++) wMax = Math.max(wMax, weights[plants[i].arm] || 0);
      const skim = tp.style === "kong" ? 0.26 : 0.16;
      need = Math.max(need, (cur + _tpP.y - (tp.top + skim)) * wMax);
    }
    // ---- how far it MAY come down: the pelvis stays out of what is under it
    const allow = cur + _tpP.y - (travSupportY(tp, _tpP.x, _tpP.z) + 0.12);
    let total = lower ? Math.max(-0.35, Math.min(Math.max(0, need), allow, 1.1)) : 0;
    if (!ch._seatSunk) { ch.model.position.y = pivotY - total / gs; ch.group.updateMatrixWorld(true); }
    /* ---- THE LEGS GO OVER IT. A foot the body's line would drag through the
       obstacle (or into the lip on a mantle) is lifted by folding THAT leg —
       more hip flexion, the knee straightened or folded, whichever raises the
       foot — not by hoisting the whole body off its hands. Only what folding
       cannot fix lifts the body (last resort, measured). */
    let lift = 0;
    const feet = ch.feet, knees = ch.low;
    if (feet && knees) {
      for (let li = 0; li < 2; li++) {
        const side = li ? "rl" : "ll";
        const leg = ch.parts[side], knee = knees[side], foot = feet[side];
        if (!leg || !knee || !foot) continue;
        const shortOf = function () {
          leg.updateMatrixWorld(true);
          foot.getWorldPosition(_tpA);
          return travSupportY(tp, _tpA.x, _tpA.z) + 0.09 - _tpA.y;
        };
        let sh = shortOf();
        for (let it = 0; it < 8 && sh > 0.005; it++) {
          const hx = leg.rotation.x, kx = knee.rotation.x;
          let best = sh, bh = hx, bk = kx;
          const tries = [[-0.22, 0], [0, -0.30], [0, 0.30], [-0.22, 0.30]];
          for (let t = 0; t < tries.length; t++) {
            leg.rotation.x = Math.max(-2.2, hx + tries[t][0]);
            knee.rotation.x = Math.max(0, Math.min(2.4, kx + tries[t][1]));
            const v = shortOf();
            if (v < best - 1e-4) { best = v; bh = leg.rotation.x; bk = knee.rotation.x; }
          }
          leg.rotation.x = bh; knee.rotation.x = bk;
          if (best >= sh - 1e-4) { sh = shortOf(); break; }
          sh = best;
        }
        if (sh > lift) lift = sh;
      }
    }
    if (lower && lift > 0.005) {
      total = Math.max(-0.35, total - lift);
      if (!ch._seatSunk) { ch.model.position.y = pivotY - total / gs; ch.group.updateMatrixWorld(true); }
    }
    tp._dropNeed = need; tp._dropAllow = allow; tp._drop = total;
    if (!any) return false;
    ch.group.updateMatrixWorld(true);
    // ---- the palms, on the obstacle, fingers along the move
    _tpDir.set(tp.dirX, 0, tp.dirZ);
    let on = false;
    for (let i = 0; i < plants.length; i++) {
      const pl = plants[i];
      // a palm lets go when its shoulder has swung out of reach of it (the
      // body has gone past, or up over it) — the envelope says WHEN it may
      // be on, the arm's length says whether it CAN be
      _tpDir.set(tp.dirX, 0, tp.dirZ);
      const share = CA.plantShare(ch, pl.p, pl.arm, _tpUp, _tpDir);
      // (past 1.0 the shoulder PROTRACTS toward it, charArmTo.wrist: a loaded
      // arm at full stretch still has the shoulder blade to give)
      // A contact is on or off: the envelope only says when the hand WANTS
      // down, so the solve comes in fast (a partly-blended IK is a hand
      // hovering beside the point, not a hand on it)
      const w = smooth01(((weights[pl.arm] || 0) - 0.12) / 0.30) * (1 - smooth01((share - 1.0) / 0.08));
      pl.w = w;
      if (w <= 0.01) { if (CA.plantRelease) CA.plantRelease(ch, pl.arm); pl.res = null; continue; }
      // the hand turns in a little on a two-hand plant (fingers slightly toward
      // each other), out on a one-hand plant (the arm comes from the side)
      pl.res = CA.plant(ch, pl.p, pl.arm, _tpUp, _tpDir, w);
      if (pl.res != null && pl.res < 0.03 && w > 0.5) on = true;
    }
    return on;
  }
  const _reachMountGrip = new THREE.Vector3();
  // The holster target already exists as a live rig mount. Solve the same
  // shoulder/elbow chain used by mantle grips against that point instead of
  // guessing one pose for every torso and arm length. Because the mount and
  // shoulder are siblings under `body`, body lean/bob cancels out naturally.
  function reachMountArmSolve(ch, target, arm) {
    const P = ch && ch.profile;
    const part = ch && ch.parts && (arm === "l" ? ch.parts.la : ch.parts.ra);
    if (!P || !part || !target || !target.parent || !ch.body || !ch.group ||
        typeof target.getWorldPosition !== "function" || typeof ch.body.worldToLocal !== "function") return null;
    ch.group.updateMatrixWorld(true);
    target.getWorldPosition(_reachMountGrip);
    ch.body.worldToLocal(_reachMountGrip);
    const dx = _reachMountGrip.x - part.position.x;
    let dy = _reachMountGrip.y - part.position.y;
    let dz = _reachMountGrip.z - part.position.z;
    const l1 = Math.max(0.12, P.armUp - 0.02);
    const l2 = Math.max(0.12, P.armLo + 0.01);
    let reach = Math.hypot(dy, dz);
    const maxReach = (l1 + l2) * 0.965;
    const minReach = Math.abs(l1 - l2) + 0.035;
    if (reach > maxReach) {
      const k = maxReach / reach;
      dy *= k; dz *= k; reach = maxReach;
    } else if (reach < minReach) {
      const k = minReach / Math.max(0.001, reach);
      dy *= k; dz *= k; reach = minReach;
    }
    const elbow = Math.acos(Math.max(-1, Math.min(1,
      (reach * reach - l1 * l1 - l2 * l2) / (2 * l1 * l2))));
    const fromDown = Math.atan2(dz, -dy);
    const shoulder = fromDown - Math.atan2(l2 * Math.sin(elbow), l1 + l2 * Math.cos(elbow));
    const lateral = Math.atan2(dx, Math.max(0.16, reach));
    return {
      shoulder: -shoulder,
      elbow: -elbow,
      roll: Math.max(-0.72, Math.min(0.72, lateral)),
    };
  }

  /* ---- CBZ.charArmTo — PUT THIS HAND EXACTLY THERE ------------------------

     The two solvers above are the older, deliberately approximate pair: both
     flatten the problem into the sagittal plane (reach = hypot(dy, dz)) and
     hand the sideways component to a clamped `roll`, which is fine for a grab
     that only has to look plausible and wrong the moment the target has to be
     HIT — a support hand on a handguard is off by however much dx there was.

     This one is exact, and it is exact for THIS rig rather than for an
     idealised two-link chain, because the wrist is not at the end of the
     forearm: makeCharacter parks the hand socket at (0, -(armLo+0.01), 0.035)
     inside the elbow group, i.e. a hair FORWARD of the bone. Fold that offset
     into the second link as a length l2 with a built-in tilt t and the closed
     form survives:

       hand, in the upper arm's own frame, with the elbow at angle e
         u = (0, -l1, 0) + Rx(e)·f,      f = (0, -l2·cos t, l2·sin t)
         |u|² = l1² + l2² + 2·l1·l2·cos(e - t)
       so the elbow that puts the wrist at distance d is
         e = t - acos( (d² - l1² - l2²) / (2·l1·l2) )
       and with Euler order XYZ (three.js default) the shoulder that swings û
       onto the unit target v is, exactly,
         sin z = v.x / |û.y|
         x     = atan2(v.z, v.y) - atan2(û.z, û.y·cos z)

     Out of reach, the shoulder PROTRACTS (position.z) instead of the arm
     silently giving up — that is the real joint that lets a person reach the
     front of a rifle, and it is why a long gun's support hand can land at all.

       CBZ.charArmTo(ch, worldPoint, arm, k)
         arm  "l" | "r"        k  0..1 blend against the pose already there
       Returns the residual metres between wrist and target (0 = landed), or
       null if the rig can't be solved. Writes rotations only. */
  const _armT = new THREE.Vector3(), _armV = new THREE.Vector3();
  const _armWrist = new THREE.Vector3();
  /* NaN FIREWALL. Every arm solve blends INTO the pose already there
     (rot += (target - rot) * k), so one non-finite input (a NaN weight, a
     target read off a missing anchor, a target ON the shoulder -> 1/0) would
     poison the shoulder for good: every later frame blends from NaN. So the
     solvers refuse non-finite inputs, never write a non-finite answer, and
     an arm that is already poisoned is put back to rest before solving. */
  const finite3 = (v) => !!v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
  function armWeight(k) {
    if (k == null) return 1;
    return Number.isFinite(k) ? Math.max(0, Math.min(1, k)) : 0;
  }
  function qOk(q) {
    const l = q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w;
    return Number.isFinite(l) && l > 1e-12;
  }
  const rotOk = (o) => qOk(o.quaternion);
  function healArm(part, low) {
    if (!rotOk(part)) part.rotation.set(0, 0, 0);
    // the solvers only ever move the shoulder along z (protraction)
    if (!Number.isFinite(part.position.z)) part.position.z = part.userData._armRestZ || 0;
    if (!rotOk(low)) low.rotation.set(0, 0, 0);
  }
  function charArmTo(ch, worldPoint, arm, k) {
    const P = ch && ch.profile;
    const part = ch && ch.parts && (arm === "l" ? ch.parts.la : ch.parts.ra);
    const low = part && part.userData && part.userData.low;
    if (!P || !part || !low || !ch.body || !finite3(worldPoint)) return null;
    const blend = armWeight(k);
    if (blend <= 0) return null;
    healArm(part, low);

    // body space — the frame both the shoulder root and the pose live in
    ch.body.updateWorldMatrix(true, false);
    _armT.copy(worldPoint);
    ch.body.worldToLocal(_armT);

    const l1 = Math.max(0.12, P.armUp - 0.02);          // shoulder → elbow pivot
    const fy = -(P.armLo + 0.01), fz = 0.035;           // elbow → wrist socket
    const l2 = Math.hypot(fy, fz);
    const t = Math.atan2(fz, -fy);                      // the wrist's forward tilt

    // SCAPULAR PROTRACTION: reach past the arm's length by leading with the
    // shoulder, capped, before the bone solve — the same degree of freedom a
    // person spends getting a hand to the front of a rifle.
    const rest = part.userData._armRestZ != null ? part.userData._armRestZ : 0;
    let push = Math.hypot(_armT.x - part.position.x, _armT.y - part.position.y,
                          _armT.z - rest) - (l1 + l2) * 0.985;
    push = Math.max(0, Math.min(0.24, push));
    part.position.z += (rest + push - part.position.z) * blend;

    _armV.set(_armT.x - part.position.x, _armT.y - part.position.y, _armT.z - part.position.z);
    const d0 = _armV.length();
    const maxR = (l1 + l2) * 0.985;
    const minR = Math.abs(l1 - l2) + 0.06;
    const d = Math.max(minR, Math.min(maxR, d0));
    if (!(d0 > 1e-4)) return null;                      // a target ON the shoulder has no direction
    _armV.multiplyScalar(1 / d0);                       // unit direction to the target

    const cosE = Math.max(-1, Math.min(1, (d * d - l1 * l1 - l2 * l2) / (2 * l1 * l2)));
    const e = Math.min(0.02, t - Math.acos(cosE));      // elbows bend one way only
    const uy = -l1 + fy * Math.cos(e) - fz * Math.sin(e);
    const uz = fy * Math.sin(e) + fz * Math.cos(e);
    const un = Math.hypot(uy, uz) || 1e-6;
    const uyN = uy / un, uzN = uz / un;

    const sinZ = Math.max(-0.999, Math.min(0.999, _armV.x / -uyN));
    const rz = Math.asin(sinZ);
    const rx = Math.atan2(_armV.z, _armV.y) - Math.atan2(uzN, uyN * Math.cos(rz));

    const wrap = (a) => (a > Math.PI ? a - 2 * Math.PI : a < -Math.PI ? a + 2 * Math.PI : a);
    if (!Number.isFinite(rx + rz + e)) return null;
    part.rotation.x +=(wrap(rx) - part.rotation.x) * blend;
    part.rotation.y += (0 - part.rotation.y) * blend;
    part.rotation.z += (rz - part.rotation.z) * blend;
    low.rotation.x += (e - low.rotation.x) * blend;
    low.rotation.y += (0 - low.rotation.y) * blend;
    low.rotation.z += (0 - low.rotation.z) * blend;

    // residual, measured off the real socket rather than trusted from the math
    const socket = ch.sockets && (arm === "l" ? ch.sockets.leftHand : ch.sockets.rightHand);
    if (!socket) return Math.max(0, d0 - maxR);
    part.updateMatrixWorld(true);
    socket.getWorldPosition(_armWrist);
    return _armWrist.distanceTo(worldPoint);
  }
  /* Remember the pose's own shoulder-forward value so protraction is measured
     against it instead of accumulating. Callers that drive an arm every frame
     (systems/gunhands.js) latch this once per pose change. */
  charArmTo.rest = function (ch, arm, z) {
    const part = ch && ch.parts && (arm === "l" ? ch.parts.la : ch.parts.ra);
    if (part) part.userData._armRestZ = z || 0;
  };
  /* HOW FAR THIS ARM CAN ACTUALLY REACH, IN WORLD METRES — and it lives here
     because the two ends of that question are in different units and a caller
     that guesses the conversion gets a plausible, wrong number. The solve
     above runs in BODY-LOCAL units (the rig is authored at ~1.3 and scaled to
     human size on the group), so its own clamp is 0.898-ish local; a consumer
     comparing that against a world-metre distance to a weapon is out by the
     whole rig scale. Read the scale off the live matrix instead of assuming
     it: a child, a scaled prop rig or a future HUMAN_SCALE change all just
     work.

     BONE ONLY, and deliberately: protraction is NOT included even though the
     solve spends it, because protraction pushes the shoulder FORWARD and
     nothing else. A caller testing a target that is mostly SIDEWAYS — which
     is the whole job of a support hand crossing to the other side of the
     body — would be told it can reach 0.17 m further than it can. The
     reachable set is an ellipsoid; this returns its minor axis, so a
     reachability test built on it is conservative rather than wrong. If you
     need the truth for a specific point, solve to it and read the residual. */
  charArmTo.span = function (ch, arm) {
    const P = ch && ch.profile;
    if (!P || !ch.body) return 0;
    const l1 = Math.max(0.12, P.armUp - 0.02);
    const l2 = Math.hypot(P.armLo + 0.01, 0.035);
    ch.body.updateWorldMatrix(true, false);
    const s = ch.body.matrixWorld.getMaxScaleOnAxis() || 1;
    return (l1 + l2) * 0.985 * s;
  };
  /* ---- charArmTo.wrist — PUT THE WRIST THERE, WITH THE FOREARM THAT WAY ----
     charArmTo lands the SOCKET (a point out by the fingertips) and fixes the
     shoulder's twist at zero, so the elbow goes wherever that closed form puts
     it. A hand that has to actually hold something needs the other two
     things: the WRIST CREASE on a point (the hand hangs from the crease, so
     that is the joint a grip is solved to), and the FOREARM arriving from the
     direction the hand wants it — a wrist only bends so far, and a support
     hand under a handguard wants its forearm coming up from below-behind,
     not across at whatever angle the swivel happened to be.

     Two bones, full 3D: the elbow is the point on the reach circle nearest
     the IDEAL elbow (wrist + fore x forearm length), biased DOWN and OUT on
     the arm's own side so an elbow never flips up or crosses the midline;
     then the shoulder takes the whole rotation (swing AND twist, so the
     bicep faces the bend the way a real one does) and the elbow the hinge.
     Shoulder protraction for out-of-reach targets as charArmTo.

       charArmTo.wrist(ch, worldPoint, arm, fore, k)
         fore  world unit vector, wrist -> elbow, or null for "any, elbow down"
       Returns the residual metres between the crease and the target. */
  const _awT = new THREE.Vector3(), _awD = new THREE.Vector3(), _awE = new THREE.Vector3();
  const _awU = new THREE.Vector3(), _awF = new THREE.Vector3(), _awP = new THREE.Vector3();
  const _awDef = new THREE.Vector3(), _awX = new THREE.Vector3(), _awY = new THREE.Vector3();
  const _awZ = new THREE.Vector3(), _awM = new THREE.Matrix4(), _awQ = new THREE.Quaternion();
  const _awPQ = new THREE.Quaternion(), _awW = new THREE.Vector3(), _awFL = new THREE.Vector3(), _awFE = new THREE.Vector3();
  function perpNorm(v, axis) {
    v.addScaledVector(axis, -v.dot(axis));
    const l = v.length();
    if (l < 1e-6) return false;
    v.multiplyScalar(1 / l);
    return true;
  }
  /* ---- THE BODY AS WORN: WHAT AN ARM MAY NOT PASS THROUGH -----------------
     The arm solves used to keep the elbow and forearm out of the RIBCAGE BOX
     the chest part was lofted from (geometry.parameters, + 4 cm). The shaped
     torso is not that box: a man's pecs and a heavy man's belly stand 3-5 cm
     proud of it, a woman's bust more, and everything strapped on the front
     (a plate carrier, warlord webbing and pouches, a heavy vest) stands
     further out again. Measured (tools/overlap-audit.mjs, the gun-hold
     poses): the solved forearms ran up to 4.5 cm INTO the kit and the
     shouldered carbine's butt 3 cm into the chest.
     So the body REPORTS its extents as drawn: every mesh hanging off the body
     except the arms and the head — the shaped torso and pelvis, clothing
     shells, and whatever kit is worn — is rasterised once into a grid of
     columns in the body frame (x 3 cm, y 2.5 cm): each column holds the front
     and back of what is drawn there and the x/y extent it covers. Rebuilt only
     when what hangs off the body changes (dressing, kit, torso LOD).
       charArmTo.bodyPen(ch, p, r)  how deep a ball of radius r at body-frame
                                    point p sits inside the worn body (0 clear)
       charArmTo.bodyFront(ch, x, y) the front of the worn body at (x, y) —
                                    the shoulder pocket a butt rests on
       charArmTo.armPen(ch, arm)    the deepest arm sample (elbow half of the
                                    upper arm, the whole forearm) inside it */
  const BV_X = 0.03, BV_Y = 0.025;
  const _bvA = new THREE.Vector3(), _bvB = new THREE.Vector3(), _bvC = new THREE.Vector3(), _bvP = new THREE.Vector3();
  const _bvM = new THREE.Matrix4();
  function bodyVolSig(ch) {
    const kids = ch.body.children;
    let sig = kids.length;
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      sig = (sig * 31 + k.id * 3 + (k.visible ? 1 : 2) + (k.geometry ? k.geometry.id * 7 : 0)) % 1000000007;
    }
    return sig;
  }
  /* The grid is a function of WHAT is drawn and WHERE (geometry + its matrix
     into the body), not of who wears it: every cop of one build in one plate
     carrier shares one. Keyed on exactly that, LRU-capped. */
  const BODY_VOLS = new Map();
  let bodyVolIds = 0;                          // one id per distinct worn body (cache keys read it)
  function bodyVolume(ch) {
    if (!ch || !ch.body) return null;
    const sig = bodyVolSig(ch);
    const V0 = ch._bodyVol;
    if (V0 && V0.sig === sig) return V0;
    const body = ch.body;
    const skip = new Set();
    if (ch.parts) { if (ch.parts.la) skip.add(ch.parts.la); if (ch.parts.ra) skip.add(ch.parts.ra); }
    if (ch.neck) skip.add(ch.neck);
    if (ch.head) skip.add(ch.head);
    const meshes = [], mats = [], kitOf = [];
    // the body's own skin (chest, collar, pelvis) vs what is worn over it: the
    // shoulder end of the upper arm always sits in the torso's own shoulder,
    // but must still clear a vest's armhole
    const own = new Set([].concat((ch.skinSlots && ch.skinSlots.torso) || [], (ch.skinSlots && ch.skinSlots.collar) || [], (ch.skinSlots && ch.skinSlots.pelvis) || []));
    let key = "";
    const stack = body.children.slice();
    while (stack.length) {
      const o = stack.pop();
      if (!o || skip.has(o) || o.visible === false || (o.userData && o.userData.noBodyVolume)) continue;
      for (let i = 0; i < o.children.length; i++) stack.push(o.children[i]);
      const g = o.isMesh && o.geometry, pos = g && g.attributes && g.attributes.position;
      if (!pos || (o.material && o.material.visible === false)) continue;
      const M = new THREE.Matrix4();
      let q = o;
      for (; q && q !== body; q = q.parent) { q.updateMatrix(); M.premultiply(q.matrix); }
      if (q !== body) continue;
      meshes.push(o); mats.push(M); kitOf.push(!own.has(o));
      key += g.id + ":" + g.uuid.slice(0, 8);
      const e = M.elements;
      for (let i = 0; i < 16; i++) key += "," + Math.round(e[i] * 2000);
      key += ";";
    }
    let V = BODY_VOLS.get(key);
    if (V) { BODY_VOLS.delete(key); BODY_VOLS.set(key, V); }
    else {
      const cells = new Map(), kit = new Map();
      const addTo = function (map, x, y, z) {
        const ck = Math.floor(y / BV_Y) * 8192 + Math.floor(x / BV_X) + 4096;
        const c = map.get(ck);
        if (!c) map.set(ck, [z, z, x, x, y, y]);
        else {
          if (z > c[0]) c[0] = z; if (z < c[1]) c[1] = z;
          if (x < c[2]) c[2] = x; if (x > c[3]) c[3] = x;
          if (y < c[4]) c[4] = y; if (y > c[5]) c[5] = y;
        }
      };
      for (let k = 0; k < meshes.length; k++) {
        const g = meshes[k].geometry, pos = g.attributes.position, idx = g.index, M = mats[k], isKit = kitOf[k];
        const n = idx ? idx.count : pos.count;
        for (let t = 0; t + 2 < n; t += 3) {
          _bvA.fromBufferAttribute(pos, idx ? idx.getX(t) : t).applyMatrix4(M);
          _bvB.fromBufferAttribute(pos, idx ? idx.getX(t + 1) : t + 1).applyMatrix4(M);
          _bvC.fromBufferAttribute(pos, idx ? idx.getX(t + 2) : t + 2).applyMatrix4(M);
          const L = Math.max(_bvA.distanceTo(_bvB), _bvB.distanceTo(_bvC), _bvC.distanceTo(_bvA));
          const m = Math.max(1, Math.min(20, Math.ceil(L / 0.03)));
          const bx = _bvB.x - _bvA.x, by = _bvB.y - _bvA.y, bz = _bvB.z - _bvA.z;
          const cx = _bvC.x - _bvA.x, cy = _bvC.y - _bvA.y, cz = _bvC.z - _bvA.z;
          for (let i = 0; i <= m; i++) {
            const u = i / m;
            for (let j = 0; j <= m - i; j++) {
              const v = j / m;
              const x = _bvA.x + bx * u + cx * v, y = _bvA.y + by * u + cy * v, z = _bvA.z + bz * u + cz * v;
              addTo(cells, x, y, z);
              if (isKit) addTo(kit, x, y, z);
            }
          }
        }
      }
      // packed dense for the queries (a solve asks thousands of them)
      const pack = function (cells) {
        let xa = Infinity, xb = -Infinity, ya = Infinity, yb = -Infinity;
        cells.forEach(function (c, ck) {
          const yi = Math.floor(ck / 8192), xx = ck - yi * 8192 - 4096;
          if (xx < xa) xa = xx; if (xx > xb) xb = xx; if (yi < ya) ya = yi; if (yi > yb) yb = yi;
        });
        const nx = cells.size ? xb - xa + 1 : 0, ny = cells.size ? yb - ya + 1 : 0;
        const D = new Float32Array(Math.max(1, nx * ny * 6)).fill(NaN);
        cells.forEach(function (c, ck) {
          const yi = Math.floor(ck / 8192), xx = ck - yi * 8192 - 4096;
          const o = ((yi - ya) * nx + (xx - xa)) * 6;
          for (let k = 0; k < 6; k++) D[o + k] = c[k];
        });
        return { D: D, x0: xa, y0: ya, nx: nx, ny: ny };
      };
      const all = pack(cells);
      V = { D: all.D, x0: all.x0, y0: all.y0, nx: all.nx, ny: all.ny, id: ++bodyVolIds, kit: kit.size ? pack(kit) : null };

      BODY_VOLS.set(key, V);
      if (BODY_VOLS.size > 48) BODY_VOLS.delete(BODY_VOLS.keys().next().value);
    }
    ch._bodyVol = { sig: sig, D: V.D, x0: V.x0, y0: V.y0, nx: V.nx, ny: V.ny, id: V.id, kit: V.kit };
    return ch._bodyVol;
  }
  function bodyPen(ch, p, r, Vin) {
    const V = Vin || bodyVolume(ch);
    if (!V || !V.nx) return 0;
    const x = p.x, y = p.y, z = p.z, D = V.D, nx = V.nx;
    const xi0 = Math.max(0, Math.floor((x - r) / BV_X) - 1 - V.x0), xi1 = Math.min(nx - 1, Math.floor((x + r) / BV_X) + 1 - V.x0);
    const yi0 = Math.max(0, Math.floor((y - r) / BV_Y) - 1 - V.y0), yi1 = Math.min(V.ny - 1, Math.floor((y + r) / BV_Y) + 1 - V.y0);
    let pen = 0;
    for (let yi = yi0; yi <= yi1; yi++) {
      for (let xi = xi0; xi <= xi1; xi++) {
        const o = (yi * nx + xi) * 6;
        const f = D[o];
        if (f !== f) continue;                                     // empty column
        const b = D[o + 1];
        const dx = x < D[o + 2] ? D[o + 2] - x : x > D[o + 3] ? x - D[o + 3] : 0;
        const dy = y < D[o + 4] ? D[o + 4] - y : y > D[o + 5] ? y - D[o + 5] : 0;
        let d;
        if (z > f) d = Math.sqrt(dx * dx + dy * dy + (z - f) * (z - f));
        else if (z < b) d = Math.sqrt(dx * dx + dy * dy + (b - z) * (b - z));
        else if (dx > 0 || dy > 0) d = Math.sqrt(dx * dx + dy * dy);
        else d = -Math.min(f - z, z - b);
        const q = r - d;
        if (q > pen) pen = q;
      }
    }
    return pen;
  }
  // the front of the worn body at (x, y): the furthest-forward column within
  // a hand's width, or null where nothing is drawn
  function bodyFront(ch, x, y) {
    const V = bodyVolume(ch);
    if (!V || !V.nx) return null;
    let f = null;
    const xi0 = Math.max(0, Math.floor((x - 0.04) / BV_X) - V.x0), xi1 = Math.min(V.nx - 1, Math.floor((x + 0.04) / BV_X) - V.x0);
    const yi0 = Math.max(0, Math.floor((y - 0.04) / BV_Y) - V.y0), yi1 = Math.min(V.ny - 1, Math.floor((y + 0.04) / BV_Y) - V.y0);
    for (let yi = yi0; yi <= yi1; yi++) for (let xi = xi0; xi <= xi1; xi++) {
      const c = V.D[(yi * V.nx + xi) * 6];
      if (c === c && (f == null || c > f)) f = c;
    }
    return f;
  }
  // the limb radii an arm is tested with: its lofts' thinner half-extent at
  // mid-segment (the deltoid ball at the top of the upper arm is not the arm)
  function armRadii(ch, part) {
    const ud = part.userData;
    if (ud._armR && ud._armRk === ch.profile) return ud._armR;
    const half = function (m, dflt) {
      const g = m && m.geometry;
      const h = g && limbHalfAt(g, -(m.position.y || 0) * 0 + ((g.userData.limb && g.userData.limb.y0) || 0) - 0.5 * ((g.userData.limb && g.userData.limb.sy) || 0));
      return h ? Math.max(0.02, Math.min(h.hx, h.hz)) : dflt;
    };
    const P = ch.profile || {};
    ud._armR = [half(ud.main, (P.armW || 0.3) * 0.30), half(ud.lower, (P.armW || 0.3) * 0.26)];
    ud._armRk = ch.profile;
    return ud._armR;
  }
  // sample points of an arm in the body frame, given shoulder S, elbow E, wrist W
  const ARM_T_KIT = [0.3, 0.45, 0.6], ARM_T_UP = [0.7, 0.85, 1], ARM_T_LO = [0, 0.17, 0.33, 0.5, 0.67, 0.83, 1];
  const _apS = new THREE.Vector3();
  function armSegPen(ch, S, E, W, rU, rL) {
    let pen = 0;
    const V = bodyVolume(ch);
    // the shoulder half of the upper arm, against what is WORN only
    if (V && V.kit) for (let i = 0; i < ARM_T_KIT.length; i++) { _apS.lerpVectors(S, E, ARM_T_KIT[i]); const q = bodyPen(ch, _apS, rU, V.kit); if (q > pen) pen = q; }
    for (let i = 0; i < ARM_T_UP.length; i++) { _apS.lerpVectors(S, E, ARM_T_UP[i]); const q = bodyPen(ch, _apS, rU, V); if (q > pen) pen = q; }
    for (let i = 0; i < ARM_T_LO.length; i++) { _apS.lerpVectors(E, W, ARM_T_LO[i]); const q = bodyPen(ch, _apS, rL, V); if (q > pen) pen = q; }
    return pen;
  }
  const _acE = new THREE.Vector3(), _acX = new THREE.Vector3();
  // how deep this arm runs into the worn body with its elbow swung th round
  // its circle (S shoulder, W wrist: the arms' parent IS the body frame)
  function armInBody(ch, rU, rL, S, dir, a, h, pole, th, W) {
    _acX.crossVectors(dir, pole);
    _acE.copy(S).addScaledVector(dir, a)
      .addScaledVector(pole, h * Math.cos(th)).addScaledVector(_acX, h * Math.sin(th));
    return armSegPen(ch, S, _acE, W, rU, rL);
  }
  charArmTo.wrist = function (ch, worldPoint, arm, fore, k) {
    const P = ch && ch.profile;
    const part = ch && ch.parts && (arm === "l" ? ch.parts.la : ch.parts.ra);
    const low = part && part.userData && part.userData.low;
    const parent = part && part.parent;
    if (!P || !low || !parent || !finite3(worldPoint)) return null;
    const blend = armWeight(k);
    if (blend <= 0) return null;
    if (fore && !finite3(fore)) fore = null;
    healArm(part, low);
    const cap = part.userData.cap;
    const l1 = Math.max(0.12, -low.position.y);
    const l2 = Math.max(0.10, -((cap && cap.userData.fit) ? cap.userData.fit.wristY : (P.handH - P.armLo)));
    parent.updateWorldMatrix(true, false);
    _awT.copy(worldPoint);
    parent.worldToLocal(_awT);
    // protraction, as charArmTo
    const rest = part.userData._armRestZ != null ? part.userData._armRestZ : 0;
    let push = Math.hypot(_awT.x - part.position.x, _awT.y - part.position.y, _awT.z - rest) - (l1 + l2) * 0.985;
    push = Math.max(0, Math.min(0.24, push));
    part.position.z += (rest + push - part.position.z) * blend;
    // direction and (reachable) distance shoulder -> wrist
    _awD.subVectors(_awT, part.position);
    const d0 = _awD.length();
    if (d0 < 1e-5) return null;
    _awD.multiplyScalar(1 / d0);
    const d = Math.max(Math.abs(l1 - l2) + 0.04, Math.min((l1 + l2) * 0.999, d0));
    // the pole: toward the ideal elbow, biased down and out on this arm's side
    const out = part.position.x >= 0 ? 1 : -1;
    _awDef.set(out * 0.55, -1, -0.25);
    const defOk = perpNorm(_awDef, _awD);
    let poleOk = false;
    if (fore) {
      parent.getWorldQuaternion(_awPQ);
      _awP.copy(fore).applyQuaternion(_awPQ.invert()).normalize();
      _awP.multiplyScalar(l2).add(_awT).sub(part.position);        // ideal elbow, from the shoulder
      poleOk = perpNorm(_awP, _awD);
      if (poleOk && defOk) {
        _awP.addScaledVector(_awDef, 0.35);
        poleOk = perpNorm(_awP, _awD);
      }
    }
    if (!poleOk) {
      if (defOk) _awP.copy(_awDef);
      else { _awP.set(0, 0, -1); if (!perpNorm(_awP, _awD)) _awP.set(1, 0, 0); }
    }
    // the elbow on the reach circle, toward the pole
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    _awW.copy(part.position).addScaledVector(_awD, d);
    /* NOT THROUGH THE BODY. A forearm led in along a hand on a gun held at
       the sternum would have its elbow INSIDE the torso (the ideal elbow is
       straight back down the bore), and a support forearm crossing to a
       handguard lies across the chest and whatever is strapped to it. Walk
       the elbow round its circle, the least way from the pole, until neither
       the elbow half of the upper arm nor the forearm is inside the body AS
       WORN (bodyPen: the shaped torso + its kit); if no angle clears it, the
       angle that leaves the least of the arm inside. A hand that is holding
       something wants its forearm along `fore`: swinging the elbow away from
       that bends the wrist, and past what a wrist gives (~36 degrees) that
       costs like being inside the body — a wrist folded at 70 degrees to keep
       a forearm off the chest is not a better hold. */
    const onBody = parent === ch.body && ch.body;
    const armR = onBody ? armRadii(ch, part) : null;
    const PEN_OK = 0.002;
    const hasFore = !!(fore && poleOk);
    if (hasFore) { parent.getWorldQuaternion(_awPQ); _awFL.copy(fore).applyQuaternion(_awPQ.invert()).normalize(); }
    const elbowCost = function (th) {
      const pn = armInBody(ch, armR[0], armR[1], part.position, _awD, a, h, _awP, th, _awW);
      if (!hasFore) return pn;
      _awFE.subVectors(_acE, _awW).normalize();
      const bend = Math.acos(Math.max(-1, Math.min(1, _awFE.dot(_awFL))));
      return pn + Math.max(0, bend - 0.62) * 0.08;
    };
    const pen0 = onBody && h > 1e-4 ? elbowCost(0) : 0;
    if (pen0 > PEN_OK) {
      _awX.crossVectors(_awD, _awP);
      let best = 0, bestPen = pen0, bestI = 0;
      for (let i = 1; i <= 6; i++) {
        for (let s = -1; s <= 1; s += 2) {
          const th = s * i * Math.PI / 6;
          const pn = elbowCost(th);
          if (pn < bestPen - 1e-4) { bestPen = pn; best = th; bestI = i; }
        }
        if (bestPen <= PEN_OK) break;
      }
      // the boundary, not the 15 degree step: refine between the last blocked
      // and the first clear angle, so the elbow moves continuously with its input
      if (bestPen <= PEN_OK && best !== 0) {
        let lo = best - Math.sign(best) * Math.PI / 6, hi = best;
        for (let k = 0; k < 5; k++) {
          const mid = (lo + hi) / 2;
          if (elbowCost(mid) > PEN_OK) lo = mid; else hi = mid;
        }
        best = hi;
      }
      _awP.multiplyScalar(Math.cos(best)).addScaledVector(_awX, Math.sin(best)).normalize();
    }
    _awE.copy(part.position).addScaledVector(_awD, a).addScaledVector(_awP, h);
    _awU.subVectors(_awE, part.position).normalize();                              // upper arm
    _awW.copy(part.position).addScaledVector(_awD, d);
    _awF.subVectors(_awW, _awE).normalize();                                       // forearm
    // shoulder frame: -Y down the upper arm, +Z the side the forearm bends to
    _awY.copy(_awU).negate();
    _awZ.copy(_awF);
    if (!perpNorm(_awZ, _awU)) { _awZ.copy(_awP).negate(); perpNorm(_awZ, _awU); }
    _awX.crossVectors(_awY, _awZ);
    _awM.makeBasis(_awX, _awY, _awZ);
    _awQ.setFromRotationMatrix(_awM);
    const e = -Math.acos(Math.max(-1, Math.min(1, _awU.dot(_awF))));
    if (!Number.isFinite(e) || !qOk(_awQ)) return null;
    if (blend >= 1) part.quaternion.copy(_awQ);
    else part.quaternion.slerp(_awQ, blend);
    low.rotation.set(low.rotation.x + (e - low.rotation.x) * blend,
      low.rotation.y * (1 - blend), low.rotation.z * (1 - blend));
    // residual, measured off the real crease (ancestors only: the arm's own
    // subtree — hand, socket, a whole gun — is not walked for one point)
    low.updateWorldMatrix(true, false);
    _awW.set(0, -l2, 0);
    low.localToWorld(_awW);
    return _awW.distanceTo(worldPoint);
  };
  /* How deep this arm (the elbow half of the upper arm and the forearm) runs
     into the body as worn, in body units (0 = clear) — a solve that has a
     choice prefers 0; tools measure it. */
  const _icS = new THREE.Vector3(), _icA = new THREE.Vector3(), _icB = new THREE.Vector3();
  charArmTo.armPen = function (ch, arm) {
    const part = ch && ch.parts && (arm === "l" ? ch.parts.la : ch.parts.ra);
    const low = part && part.userData && part.userData.low;
    if (!low || part.parent !== ch.body) return 0;
    const cap = part.userData.cap;
    const r = armRadii(ch, part);
    part.updateMatrix(); low.updateMatrix();
    _icS.copy(part.position);
    _icA.set(0, 0, 0).applyMatrix4(low.matrix).applyMatrix4(part.matrix);
    _icB.set(0, (cap && cap.userData.fit) ? cap.userData.fit.wristY : -0.26, 0).applyMatrix4(low.matrix).applyMatrix4(part.matrix);
    return armSegPen(ch, _icS, _icA, _icB, r[0], r[1]);
  };
  charArmTo.inChest = function (ch, arm) { return charArmTo.armPen(ch, arm) > 0.004 ? 1 : 0; };
  charArmTo.bodyPen = function (ch, p, r, V) { return bodyPen(ch, p, r, V); };
  charArmTo.bodyFront = function (ch, x, y) { return bodyFront(ch, x, y); };
  charArmTo.bodyVolume = bodyVolume;
  // the wrist crease of this arm, world
  charArmTo.crease = function (ch, arm, out) {
    const part = ch && ch.parts && (arm === "l" ? ch.parts.la : ch.parts.ra);
    const low = part && part.userData && part.userData.low;
    if (!low) return null;
    const cap = part.userData.cap;
    const P = ch.profile || {};
    low.updateWorldMatrix(true, false);
    return low.localToWorld(out.set(0, (cap && cap.userData.fit) ? cap.userData.fit.wristY : (P.handH - P.armLo), 0));
  };
  /* ---- charArmTo.plant — A PALM ON THE WORLD -------------------------------
     A hand that pushes on something is not a hand that points at it. Vault
     over a wall, haul up onto a ledge, shove a door, brace on a car roof: the
     PALM goes flat on the surface at the contact point, the fingers lie along
     the way the body is going, and the arm is solved so the wrist sits where
     that hand's wrist has to be. Everything is measured off the live rig, so
     a child's short arm and a man's long one both land on the same spot, and
     the answer is exact (charArmTo.wrist) rather than an Euler guess.

       charArmTo.plant(ch, point, arm, normal, along, k)
         point   world contact point (on the surface)
         normal  world surface normal (the palm faces against it)
         along   world direction the fingers lie along (orthogonalised)
         k       0..1 weight: the arm and the hand blend from the pose already
                 there, so a reach comes in and lets go without a snap
       Returns the metres between the palm's contact point and `point` (0 =
       planted; more = out of reach), or null if the rig can't be solved.
     The hand wears fphands' "plant" pose (fingers flat, pads and heel on one
     plane); charArmTo.plantRelease(ch, arm) hands it back.

     THE SAME SOLVE FOR EVERY TOUCH. An optional 7th argument names another
     fphands pose, and the point that goes on `point` is that pose's own
     contact (fpHands.contactOf): "point" puts the index pad on a button,
     "grip" closes the hand round a handle bar (its axis on `point`, running
     along the hand's width), "card" presses the held card's pinch onto a
     reader. `normal` is always where the BACK of the hand faces and `along`
     where the straight fingers would point; systems/verbs_pickup.js
     CBZ.verbs.touch picks those per kind. charArmTo.contactRelease(ch, arm,
     pose) hands any of them back. */
  const _plN = new THREE.Vector3(), _plF = new THREE.Vector3(), _plX = new THREE.Vector3(), _plZ = new THREE.Vector3();
  const _plW = new THREE.Vector3(), _plC = new THREE.Vector3(), _plS = new THREE.Vector3(), _plT = new THREE.Vector3();
  const _plM = new THREE.Matrix4(), _plQ = new THREE.Quaternion(), _plLQ = new THREE.Quaternion(), _plR = new THREE.Quaternion();
  // the planted palm's world frame (+Y = the back of the hand = the surface
  // normal, -Z = the fingers, X = Y x Z) into _plQ, and the wrist crease that
  // puts its contact point on `point` into _plW
  const _plPC = new THREE.Vector3(), _plPCs = {};
  // the contact point of `pose` (hand frame, right hand), as an array (cached per pose)
  function plantContact(pose) {
    const H = CBZ.fpHands;
    if (!pose || pose === "plant" || !H.contactOf) return H.PLANT_CONTACT;
    let c = _plPCs[pose];
    if (!c) { H.contactOf(pose, _plPC); c = _plPCs[pose] = [_plPC.x, _plPC.y, _plPC.z]; }
    return c;
  }
  charArmTo.contactOf = plantContact;
  function plantFrame(hand, low, point, normal, along, pc) {
    _plN.copy(normal).normalize();
    _plF.copy(along).addScaledVector(_plN, -along.dot(_plN));
    if (_plF.lengthSq() < 1e-8) { _plF.set(1, 0, 0).addScaledVector(_plN, -_plN.x); }
    _plF.normalize();
    _plZ.copy(_plF).negate();
    _plX.crossVectors(_plN, _plZ);
    _plM.makeBasis(_plX, _plN, _plZ);
    _plQ.setFromRotationMatrix(_plM);
    low.updateWorldMatrix(true, false);
    _plS.setFromMatrixScale(low.matrixWorld);
    const hs = hand.userData.fit.s * _plS.x;
    const side = hand.userData.side < 0 ? -1 : 1;
    pc = pc || CBZ.fpHands.PLANT_CONTACT;
    _plC.set(pc[0] * side, pc[1], pc[2]).multiplyScalar(hs).applyQuaternion(_plQ);
    return _plW.copy(point).sub(_plC);
  }
  /* How far that crease is from its shoulder as a share of the arm's two
     bones (1 = at full stretch; the plant lands exactly below 1). */
  charArmTo.plantShare = function (ch, point, arm, normal, along, pose) {
    const part = ch && ch.parts && (arm === "l" ? ch.parts.la : ch.parts.ra);
    const low = part && part.userData && part.userData.low;
    const hand = part && part.userData && part.userData.cap;
    if (!low || !hand || !hand.userData.fit || !CBZ.fpHands || !CBZ.fpHands.PLANT_CONTACT) return Infinity;
    plantFrame(hand, low, point, normal, along, plantContact(pose));
    part.getWorldPosition(_plT);
    const L = (-low.position.y - hand.userData.fit.wristY) * _plS.x;
    return L > 0 ? _plT.distanceTo(_plW) / L : Infinity;
  };
  charArmTo.plant = function (ch, point, arm, normal, along, k, pose) {
    const part = ch && ch.parts && (arm === "l" ? ch.parts.la : ch.parts.ra);
    const low = part && part.userData && part.userData.low;
    const hand = part && part.userData && part.userData.cap;
    const H = CBZ.fpHands;
    if (!low || !hand || !hand.userData.fit || !H || !H.PLANT_CONTACT || !finite3(point) || !finite3(normal) || !finite3(along)) return null;
    if (normal.lengthSq() < 1e-10) return null;
    const w = armWeight(k);
    if (w <= 0) return null;
    pose = pose && H.POSES[pose] ? pose : "plant";
    const pc = plantContact(pose);
    plantFrame(hand, low, point, normal, along, pc);   // _plQ: the palm; _plW: the crease
    if (ch.setHandPose) ch.setHandPose(arm, pose);
    else setBodyHandPose(ch, arm, pose);
    const side = hand.userData.side < 0 ? -1 : 1;
    // the forearm arrives from the shoulder's side of the hand: a support arm
    // is loaded along its length, not folded across it
    part.getWorldPosition(_plT);
    _plT.sub(_plW).normalize();
    charArmTo.wrist(ch, _plW, arm, _plT, w);
    // the hand, on the surface (in the elbow frame), blended from its rest
    low.updateWorldMatrix(true, false);
    low.getWorldQuaternion(_plLQ);
    _plR.copy(_plLQ).invert().multiply(_plQ);
    placeBodyHand(hand);                               // the rest frame (and the crease position)
    // a gun hold slides its hand down the wrist onto a socket; a touch keeps
    // the hand ON its crease (the wrist solve above put the crease there)
    hand.position.set(0, hand.userData.fit.wristY, 0);
    if (w >= 1) hand.quaternion.copy(_plR); else hand.quaternion.slerp(_plR, w);
    wristTwist(ch, arm);
    // residual: the palm's contact point where it actually is
    hand.updateMatrixWorld(true);
    _plT.set(pc[0] * side, pc[1], pc[2]);
    hand.localToWorld(_plT);
    return _plT.distanceTo(point);
  };
  charArmTo.plantRelease = function (ch, arm) {
    const hs = handsOf(ch, arm || "both");
    for (let i = 0; i < hs.length; i++) {
      const m = hs[i];
      if (m && m.userData.handPose === "plant") {
        setBodyHandPose(ch, m.userData.side < 0 ? "l" : "r", "relaxed");
      }
    }
  };
  // any touch (plant / point / grip / card) lets go: the hand takes `pose`
  // (default relaxed) back in its rest frame on the forearm, untwisted
  charArmTo.contactRelease = function (ch, arm, pose) {
    const hs = handsOf(ch, arm || "both");
    for (let i = 0; i < hs.length; i++) {
      const m = hs[i];
      if (!m || !m.userData.fit) continue;
      const side = m.userData.side < 0 ? "l" : "r";
      setBodyHandPose(ch, side, pose || "relaxed");
      placeBodyHand(m);
      const fore = foreOf(ch, m);
      if (fore) fore.rotation.y = 0;
    }
  };
  /* ---- THE PHONE HOLD — one body, every game -----------------------------
     The phone used to be held three different wrong ways: the player's
     third-person hold aimed charArmTo at a point by the chest (the upper arm
     ended up horizontal across the chest, see THE ARMS HAVE A RANGE), a
     ped's call was a hand-typed Euler (-0.55, -0.55, -0.35 / elbow -2.35)
     that put the hand 47 cm out from the ear, beside the head, at chin
     height, and the gawker's film pose another. Now the BODY knows how a
     phone is held, from its own measures, and everyone asks it:
       "ear"   upper arm down and forward, the elbow down and out in front of
               the shoulder, the palm on the cheek, the phone up the side of
               the face to the ear; the head leans into it.
       "read"  the elbow at the side, the forearm up and in, the phone in
               front of the chest with its glass to the eyes; chin down.
       "film"  the phone up at eye height out in front, the other hand
               steadying it.
     Each places the WRIST CREASE and says where the forearm comes from
     (charArmTo.wrist: exact, elbow on the reach circle, clear of the body),
     then turns the hand so the palm faces the cheek / the eyes, untwists the
     forearm loft to it, and holds the result to the arm's range.
       CBZ.human.phoneHold(rig, mode, {arm: "r"|"l", k})  -> residual or null
       CBZ.human.phoneHold.release(rig, arm)
       CBZ.human.phoneSeat(rig, prop, {arm, scale})  the handset in that palm
     The handset's convention (city/phone.js, city/peds.js): long axis +Y,
     glass +Z. Seated: long axis up the hand toward the wrist, glass out of
     the palm, back in the cupped fingers (fpHands "hold034"). */
  const PHONE_POSE = "hold034";
  const _phS = new THREE.Vector3(), _phE = new THREE.Vector3(), _phW = new THREE.Vector3(), _phF = new THREE.Vector3();
  const _phN = new THREE.Vector3(), _phV = new THREE.Vector3(), _phX = new THREE.Vector3(), _phY = new THREE.Vector3(), _phZ = new THREE.Vector3();
  const _phM = new THREE.Matrix4(), _phQ = new THREE.Quaternion(), _phBQ = new THREE.Quaternion(), _phLQ = new THREE.Quaternion();
  const _phFW = new THREE.Vector3(), _phWW = new THREE.Vector3();
  // a point in the NECK frame, in the body frame
  function neckToBody(ch, x, y, z, out) {
    out.set(x, y, z);
    ch.neck.localToWorld(out);
    return ch.body.worldToLocal(out);
  }
  function phoneHold(ch, mode, opts) {
    opts = opts || {};
    const arm = opts.arm === "l" ? "l" : "r";
    const part = ch && ch.parts && ch.parts[arm === "l" ? "la" : "ra"];
    const low = part && part.userData && part.userData.low, hand = part && part.userData && part.userData.cap;
    if (!ch || !ch.body || !ch.neck || !part || !low || !hand || !hand.userData.fit || !ch.profile) return null;
    if (mode !== "ear" && mode !== "read" && mode !== "film") return null;
    const k = armWeight(opts.k);
    if (k <= 0) return null;
    const P = ch.profile, sg = part.position.x >= 0 ? 1 : -1;
    const l1 = -low.position.y, l2 = -hand.userData.fit.wristY;
    const hk = P.headSize / 0.60;
    ch.body.updateWorldMatrix(true, false);
    ch.neck.updateWorldMatrix(false, false);
    _phS.set(part.position.x, part.position.y, part.userData._armRestZ || 0);
    // the eyes and (ear) the lobe on this arm's side, body frame
    neckToBody(ch, 0, EYE.y * hk, EYE.front * hk, _phE);
    if (mode === "ear") {
      const H = CBZ.charHeadLandmarks ? CBZ.charHeadLandmarks(ch) : null;
      const lb = H ? H.lobe : [0.27 * hk, 0.30 * hk, -0.02 * hk];
      neckToBody(ch, Math.abs(lb[0]) * sg, lb[1], lb[2], _phV);
      // the wrist under the jaw corner, a hand's thickness off the cheek: the
      // handset runs from there up the face to the ear
      _phW.set(_phV.x + sg * 0.06 * hk, _phV.y - 0.27 * hk, _phV.z + 0.13 * hk);
      _phF.set(-sg * 0.12, 1, -0.10).normalize();              // fingers: up the side of the head
      _phN.set(-sg, 0, 0.30).normalize();                      // palm: on the cheek
      _phV.set(sg * 0.55, -1, 0.55).normalize();               // the forearm comes up from down, out and in front
    } else if (mode === "read") {
      // the elbow at the side, a little forward; the forearm up and in
      _phV.set(sg * 0.12, -1, 0.42).normalize();
      _phX.copy(_phS).addScaledVector(_phV, l1);                // the elbow
      _phF.set(-sg * 0.36, 0.45, 0.82).normalize();             // forearm, elbow -> wrist
      _phW.copy(_phX).addScaledVector(_phF, l2);
      _phV.copy(_phF).negate();                                 // wrist -> elbow
      // the glass to the eyes (the chin comes down to meet it: tiltX below)
      _phN.copy(_phE).sub(_phW); _phN.y -= 0.10 * hk; _phN.normalize();
      _phF.x -= sg * 0.20;                                      // the hand turns in across the body
    } else {
      // film: the phone up at the eyes, out in front; the other hand steadies it
      const sup = !!opts.support;
      _phW.set(_phE.x + sg * (sup ? 0.16 : 0.24) * hk, _phE.y - 0.32 * hk, _phE.z + 0.20 * hk);
      _phV.set(sg * 0.55, -1, -0.30).normalize();
      _phF.set(-sg * (sup ? 0.6 : 0.10), 1, 0.15).normalize();
      _phN.copy(_phE).sub(_phW).normalize();
    }
    // the hand frame (body frame): Z_h = -fingers, Y_h = -palm normal
    _phY.copy(_phN).negate();
    _phZ.copy(_phF).negate();
    _phZ.addScaledVector(_phY, -_phZ.dot(_phY)).normalize();
    _phX.crossVectors(_phY, _phZ);
    _phM.makeBasis(_phX, _phY, _phZ);
    _phQ.setFromRotationMatrix(_phM);                           // hand, in the body frame
    // the wrist and the forearm, world, then the arm
    _phWW.copy(_phW); ch.body.localToWorld(_phWW);
    ch.body.getWorldQuaternion(_phBQ);
    _phFW.copy(_phV).applyQuaternion(_phBQ);
    if (ch.setHandPose) ch.setHandPose(arm, PHONE_POSE); else setBodyHandPose(ch, arm, PHONE_POSE);
    const res = charArmTo.wrist(ch, _phWW, arm, _phFW, k);
    if (res == null) return null;
    // the hand, in the elbow frame
    low.updateWorldMatrix(true, false);
    low.getWorldQuaternion(_phLQ);
    _phLQ.invert().multiply(_phBQ).multiply(_phQ);
    hand.position.set(0, hand.userData.fit.wristY, 0);
    if (k >= 1) hand.quaternion.copy(_phLQ); else hand.quaternion.slerp(_phLQ, k);
    clampArm(ch, arm);                                          // storage in range too
    wristTwist(ch, arm);
    const nu = ch.neck.userData;
    if (!opts.support) {
      nu.tiltX = mode === "read" ? 0.30 * k : (mode === "film" ? -0.04 * k : 0.04 * k);
      nu.tiltZ = mode === "ear" ? -sg * 0.10 * k : 0;
    }
    ch._phoneHold = mode;
    return res;
  }
  phoneHold.release = function (ch, arm) {
    if (!ch) return;
    if (ch.neck && ch.neck.userData) { ch.neck.userData.tiltX = 0; ch.neck.userData.tiltZ = 0; }
    charArmTo.contactRelease(ch, arm || "r", "relaxed");
    ch._phoneHold = null;
  };
  const _psC = new THREE.Vector3(), _psX = new THREE.Vector3(), _psY = new THREE.Vector3(), _psZ = new THREE.Vector3(), _psM = new THREE.Matrix4();
  function phoneSeat(ch, prop, opts) {
    opts = opts || {};
    const part = ch && ch.parts && ch.parts[opts.arm === "l" ? "la" : "ra"];
    const hand = part && part.userData && part.userData.cap;
    if (!hand || !prop) return false;
    if (prop.parent !== hand) hand.add(prop);
    const H = CBZ.fpHands;
    if (H && H.gripCentre) H.gripCentre(PHONE_POSE, _psC); else _psC.set(0, -0.05, -0.04);
    if (hand.userData.side < 0) _psC.x = -_psC.x;
    prop.position.set(_psC.x, _psC.y - 0.012, _psC.z + 0.02);
    _psX.set(1, 0, 0); _psY.set(0, 0, 1); _psZ.set(0, -1, 0);       // long axis up the hand, glass out of the palm
    _psM.makeBasis(_psX, _psY, _psZ);
    prop.quaternion.setFromRotationMatrix(_psM);
    prop.scale.setScalar(opts.scale > 0 ? opts.scale : 1);
    return true;
  }
  /* How far a PALM can get from its shoulder, world metres: the two bones to
     the wrist crease (what charArmTo.wrist solves) plus the crease-to-palm
     offset of a planted hand. charArmTo.span is the socket's reach, which
     runs a hand's length past the crease, so it over-promises a planted palm
     by ~6 cm — enough to call a hand "on" a wall it is 10 cm short of. */
  charArmTo.palmSpan = function (ch, arm) {
    const part = ch && ch.parts && (arm === "l" ? ch.parts.la : ch.parts.ra);
    const low = part && part.userData && part.userData.low;
    const hand = part && part.userData && part.userData.cap;
    if (!low || !hand || !hand.userData.fit) return charArmTo.span(ch, arm);
    low.updateWorldMatrix(true, false);
    _plS.setFromMatrixScale(low.matrixWorld);
    const l1 = -low.position.y, l2 = -hand.userData.fit.wristY;
    const pc = (CBZ.fpHands && CBZ.fpHands.PLANT_CONTACT) || [0, -0.02, -0.05];
    return ((l1 + l2) * 0.999 + Math.hypot(pc[1], pc[2]) * hand.userData.fit.s) * _plS.x;
  };
  /* How far a shoulder is from a point, as a share of what that arm's planted
     palm can reach (palmSpan). 1 = at full stretch. */
  charArmTo.reachShare = function (ch, point, arm) {
    const part = ch && ch.parts && (arm === "l" ? ch.parts.la : ch.parts.ra);
    if (!part || !point) return Infinity;
    part.getWorldPosition(_plT);
    const sp = charArmTo.palmSpan(ch, arm);
    return sp > 0 ? _plT.distanceTo(point) / sp : Infinity;
  };
  CBZ.charArmTo = charArmTo;

  // The torso and legs are siblings authored from the feet, but anatomically
  // meet at this socket. Every pose writer may rotate the torso; these two
  // helpers make that rotation happen around the hip in full 3D. Compensation
  // is delta-tracked so reaction/grapple layers can safely re-lock after they
  // add their own pitch/roll without accumulating translation frame to frame.
  // The hip socket is wherever THIS body's legs end. It was a hard 0.95 (the
  // adult male), which silently pinned every child and every shorter body to an
  // adult's hips — the rotation would pivot around a point floating above a
  // toddler's actual waist. rig.hipY carries the real value; a legacy rig with
  // no profile falls back to the old constant, so nothing can regress.
  const CHARACTER_HIP_Y = 0.95;
  // a seated body leans its shoulders toward the lap a touch (was 0.06: the
  // sleeve's shoulder ball slid 4 cm out of a jacket's padded shoulder)
  const SEAT_PROTRACT = 0.015;
  const hipYOf = (ch) => (ch && ch.hipY > 0 ? ch.hipY : CHARACTER_HIP_Y);
  const LEG_KEYS = ["ll", "rl"];
  const _hipPivot = new THREE.Vector3();
  /* THE LEGS HANG FROM THE PELVIS'S OWN HIP JOINTS. The pelvis rides `body`
     and the legs ride `model`; lockCharacterHips keeps the CENTRE of the hips
     on the leg line, which is exact for a pitch but not for a yaw or a roll:
     the swimmer's glance over the shoulder (body yaw ~0.5) and the thrash
     roll swing the pelvis's side joints 6-9 cm off the thighs' tops — the
     owner's "the top of my legs aren't connected to my torso". A body off
     its feet (swimming) moves the leg roots onto the joints the pelvis is
     actually drawing; anything that animates feet on a floor gets them home
     (legRootsHome, every animChar), so no planted foot ever slides. */
  const _lrP = new THREE.Vector3();
  function legRootsFollow(ch) {
    if (!ch || !ch.body || !ch.parts || !ch.parts.ll || !ch.parts.rl || !ch.profile) return;
    ch.body.updateMatrix();
    const hy = hipYOf(ch);
    for (const leg of [ch.parts.ll, ch.parts.rl]) {
      const sx = leg.userData._rootX != null ? leg.userData._rootX : (leg.userData._rootX = leg.position.x);
      _lrP.set(sx, hy, 0).applyMatrix4(ch.body.matrix);
      leg.position.copy(_lrP);
    }
    ch._legRootsMoved = true;
  }
  function legRootsHome(ch) {
    if (!ch || !ch._legRootsMoved || !ch.parts) return;
    const hy = hipYOf(ch);
    for (const leg of [ch.parts.ll, ch.parts.rl]) if (leg && leg.userData._rootX != null) leg.position.set(leg.userData._rootX, hy, 0);
    ch._legRootsMoved = false;
  }
  function beginCharacterHipFrame(ch) {
    if (!ch || !ch.body) return;
    ch.body.position.x -= ch._hipCompX || 0;
    ch.body.position.y -= ch._hipCompY || 0;
    ch.body.position.z -= ch._hipCompZ || 0;
    ch._hipCompX = ch._hipCompY = ch._hipCompZ = 0;
  }
  function lockCharacterHips(ch) {
    if (!ch || !ch.body) return;
    const hy = hipYOf(ch);
    _hipPivot.set(0, hy, 0).applyEuler(ch.body.rotation);
    const nx = -_hipPivot.x;
    const ny = hy - _hipPivot.y;
    const nz = -_hipPivot.z;
    ch.body.position.x += nx - (ch._hipCompX || 0);
    ch.body.position.y += ny - (ch._hipCompY || 0);
    ch.body.position.z += nz - (ch._hipCompZ || 0);
    ch._hipCompX = nx; ch._hipCompY = ny; ch._hipCompZ = nz;
  }

  /* ---- POSTURE FOLLOWS THE SEAT ---------------------------------------
     ONE table, owned here, read by everybody: city/propuse.js's audit asks
     this same function so the count and the pose can never disagree about
     what a "sofa" is. A kind that is ABSENT (or explicitly null below) gets
     the default upright chair pose — which is why the aircraft cabin, the
     gate lounge, every desk and every plain chair are listed as null rather
     than merely omitted: their uprightness is a DECISION, not an oversight,
     and a future edit that adds "waiting" to the lounge row has to delete a
     line that says otherwise.
     The vocabulary is exactly the `kind` strings SEAT_H in propuse.js already
     keys on, so no registration site has to learn a new word. */
  const SEAT_POSTURE = {
    // soft, deep, with something to fall back into
    sofa: "lounge", couch: "lounge", armchair: "lounge", lounge: "lounge",
    booth: "lounge", lounger: "lounge", recliner: "lounge",
    deck: "lounge", deckchair: "lounge",
    // a chair you sit UP in because of who is watching
    throne: "throne", boss: "throne", exec: "throne",
    // perched, no backrest, feet looking for the rail
    stool: "stool", counter: "stool", bar: "stool",
    // a plank you lean forward off, elbows toward the knees
    bench: "bench", pew: "bench", park: "bench",
    // A BOTTOM BUNK IS A BENCH WITH A CEILING. Same perch, but there is a
    // steel rack ~90 cm over the mattress, so nobody sits up straight on one:
    // they duck. world/cellblock.js declares these three for its cell poses —
    // one bed, three things to do on it (edge / back to the wall / braced
    // back on your arms), because thirteen identical perchers read as one
    // animation played thirteen times.
    bunk: "bunk", bed: "bunk", mattress: "bunk",
    "bunk-back": "bunkback", "bunk-brace": "bunkbrace",
    // BEHIND A WHEEL. A driver is not a passenger who happens to be at the
    // front: the hands leave the lap and go OUT to a rim, the shins reach
    // forward for pedals instead of hanging, and the head stays up on the
    // road. Nothing else in the game sits like that, which is exactly why
    // the car cabin reads as empty even when a body is in it.
    car: "drive", driver: "drive", wheel: "drive", helm: "drive",
    // DELIBERATELY UPRIGHT (see above) — these are not omissions.
    chair: null, seat: null, dining: null, table: null, kitchen: null,
    desk: null, office: null, work: null, terminal: null,
    patio: null, patiochair: null, cabin: null, cell: null, bedside: null,
    "aircraft-seat": null, aircraft: null, airline: null, economy: null,
    "cockpit-seat": null, cockpit: null, flightdeck: null,
    waiting: null, gate: null, lounge_gate: null,
  };
  // Degrade-safe classifier. null = "sit up straight", which is also what an
  // unknown kind and a seat that declared no kind at all get.
  CBZ.charSeatPosture = function (kind) {
    if (kind == null) return null;
    const k = String(kind).toLowerCase();
    return Object.prototype.hasOwnProperty.call(SEAT_POSTURE, k) ? SEAT_POSTURE[k] : null;
  };

  /* ---- HOW FAR A SLEEPER IS ROLLED ------------------------------------
     propuse.js parks a lying body with group.rotation.z = π/2, putting the
     rig's local +X lateral side straight up. The arm sockets are semantically
     mirrored for the chase-camera view (la is +X, ra is -X), a distinction the
     joint pose below must preserve. Rolling further is done INSIDE the rig
     (body.rotation.y, about the body's own feet→head axis) so the placement
     machinery in propuse never has to change: +y turns the chest toward local
     +X, which is up. These two numbers are the contract, and propuse reads
     them to work out how far above the mattress the rig's origin belongs —
     a side sleeper presents half a SHOULDER to the mattress, a back sleeper
     half a torso DEPTH, and that difference is ~3cm of visible float. */
  const LIE_ROLL_SIDE = 0.10;    // a hair onto the front, the way people actually lie
  const LIE_ROLL_BACK = 1.15;    // ~66°: the recovery position, not a plank
  CBZ.charLieRoll = { side: LIE_ROLL_SIDE, back: LIE_ROLL_BACK };
  const BREATH_W = Math.PI * 0.5;   // 2π × 0.25 Hz — ~4 s per breath, sleeping rate

  /* The V2 chair sit owns model.position.y (the sink onto the cushion) and
     model.position.z (the lounge slouch), and the shin scale that makes a
     short voxel shin reach the floor. NOTHING else in the game writes those
     channels, so they need an explicit refund the moment the body leaves the
     seat — otherwise a vacated chair leaves a rig walking around sunk into
     the ground with stretched shins. Hoisted into one function because there
     are now TWO exits from a seat: standing up (the blend-out below the sit
     branch) and lying down (the sleep branch, which early-returns past it). */
  function refundSeatSolve(ch, J, dt, rate) {
    rate = rate || 10;
    if (ch._seatSunk) {
      const m = ch.model;
      if (m) { m.position.y = damp(m.position.y, 0, rate, dt); m.position.z = damp(m.position.z, 0, rate, dt); }
      if (!m || (Math.abs(m.position.y) < 0.005 && Math.abs(m.position.z) < 0.005)) {
        if (m) { m.position.y = 0; m.position.z = 0; }
        ch._seatSunk = 0;
      }
    }
    if (ch._seatShinScaled) {
      if (J.ll) J.ll.scale.y = damp(J.ll.scale.y, 1, 12, dt);
      if (J.rl) J.rl.scale.y = damp(J.rl.scale.y, 1, 12, dt);
      const lRest = !J.ll || Math.abs(J.ll.scale.y - 1) < 0.005;
      const rRest = !J.rl || Math.abs(J.rl.scale.y - 1) < 0.005;
      if (lRest && rRest) {
        if (J.ll) J.ll.scale.y = 1;
        if (J.rl) J.rl.scale.y = 1;
        ch._seatShinScaled = 0;
      }
    }
  }

  // Shared by full character rigs and the instanced jail crowd. Phase is in
  // radians; PI radians is one alternating footfall. Distance, not frame count,
  // owns cadence so a metre travelled looks the same at every refresh rate.
  function gaitPhaseDelta(speed, dt, walkRef, stepMul) {
    walkRef = walkRef || ((CBZ.TUNE && CBZ.TUNE.walkSpeed) || 6.4);
    const moving = speed > 0.2;
    const norm = Math.min(speed / walkRef, 1);
    const run = clamp01((speed - walkRef) / (walkRef * 0.7));
    // CADENCE IS NOT AUTHORED — it falls out of speed ÷ stride, which is
    // exactly right: the gait literature (Cho 2004) finds cadence essentially
    // EQUAL between the sexes at preferred speed, with women taking SHORTER
    // STRIDES. So shortening the stride here is the whole female cadence
    // effect, and a short-legged child gets a child's quick patter for free.
    // Omitted stepMul = 1 = the motion this game has always had (the external
    // caller in entities/crowd.js passes two args and is unaffected).
    const stepLen = (1.15 + 0.10 * norm + 0.55 * run) * (stepMul > 0 ? stepMul : 1);
    return moving ? (speed * dt / stepLen) * Math.PI : dt * 0.9;
  }

  /* ---- SKYDIVER / PARACHUTE BODY -----------------------------------------
     city/bailout.js owns the trajectory and publishes only a small visual
     record here.  The body still belongs to the canonical character rig:
     freefall is a belly-to-earth arch (wide arms, bent knees, chin into the
     relative wind), while an open canopy hangs the hips in the harness with
     the thighs forward and both hands on the risers/toggles.  Keeping this in
     character.js means the live player, visual-comparison studio and any later
     NPC parachutist all solve the same elbows, knees and hip socket. */
  function applySkydiverPose(ch, state, dt) {
    state = state || {};
    const canopy = state.phase === "canopy" || state.phase === "opening";
    const flare = canopy ? clamp01(state.flare || 0) : 0;
    const opening = canopy ? clamp01(state.opening == null ? 1 : state.opening) : 0;
    const t = +state.t || 0;
    const wave = Math.sin(t * 2.15) * 0.035;
    const sr = canopy ? 18 : 13;
    const J = ch.low || {};
    const setKnee = (j, x) => {
      if (!j) return;
      j.rotation.x = damp(j.rotation.x, Math.max(0, x), sr, dt);
      j.rotation.y = damp(j.rotation.y, 0, sr, dt);
      j.rotation.z = damp(j.rotation.z, 0, sr, dt);
      j.scale.y = damp(j.scale.y, 1, sr, dt);
    };
    const setElbow = (j, x) => {
      if (!j) return;
      j.rotation.x = damp(j.rotation.x, Math.min(0, x), sr, dt);
      j.rotation.y = damp(j.rotation.y, 0, sr, dt);
      j.rotation.z = damp(j.rotation.z, 0, sr, dt);
    };

    // Refund transforms owned by seated/traversal poses before taking the rig.
    if (ch.model) {
      ch.model.position.y = damp(ch.model.position.y, 0, sr, dt);
      ch.model.rotation.x = damp(ch.model.rotation.x, 0, sr, dt);
      ch.model.rotation.y = damp(ch.model.rotation.y, 0, sr, dt);
      ch.model.rotation.z = damp(ch.model.rotation.z, 0, sr, dt);
    }
    ch._seatSunk = 0;

    if (!canopy) {
      // Stable belly flight: chest and thighs form one shallow arch, lower legs
      // ride in the burble, and the forearms make the recognisable box position.
      ch.body.position.y = damp(ch.body.position.y, 0.015, sr, dt);
      ch.body.position.z = damp(ch.body.position.z, -0.025, sr, dt);
      ch.body.rotation.x = damp(ch.body.rotation.x, 1.16 + wave, sr, dt);
      ch.body.rotation.y = damp(ch.body.rotation.y, 0, sr, dt);
      ch.body.rotation.z = damp(ch.body.rotation.z, wave * 0.45, sr, dt);
      if (ch.parts.ll) {
        ch.parts.ll.rotation.x = damp(ch.parts.ll.rotation.x, 0.92 - wave, sr, dt);
        ch.parts.ll.rotation.y = damp(ch.parts.ll.rotation.y, -0.08, sr, dt);
        ch.parts.ll.rotation.z = damp(ch.parts.ll.rotation.z, 0.24, sr, dt);
        ch.parts.ll.position.z = damp(ch.parts.ll.position.z, 0, sr, dt);
        ch.parts.ll.scale.y = damp(ch.parts.ll.scale.y, 1, sr, dt);
      }
      if (ch.parts.rl) {
        ch.parts.rl.rotation.x = damp(ch.parts.rl.rotation.x, 0.98 + wave, sr, dt);
        ch.parts.rl.rotation.y = damp(ch.parts.rl.rotation.y, 0.08, sr, dt);
        ch.parts.rl.rotation.z = damp(ch.parts.rl.rotation.z, -0.24, sr, dt);
        ch.parts.rl.position.z = damp(ch.parts.rl.position.z, 0, sr, dt);
        ch.parts.rl.scale.y = damp(ch.parts.rl.scale.y, 1, sr, dt);
      }
      setKnee(J.ll, 0.92 + wave);
      setKnee(J.rl, 1.02 - wave);
      if (ch.parts.la) {
        ch.parts.la.rotation.x = damp(ch.parts.la.rotation.x, -0.34 + wave, sr, dt);
        ch.parts.la.rotation.y = damp(ch.parts.la.rotation.y, -0.10, sr, dt);
        ch.parts.la.rotation.z = damp(ch.parts.la.rotation.z, 1.13, sr, dt);
        ch.parts.la.position.z = damp(ch.parts.la.position.z, 0.08, sr, dt);
      }
      if (ch.parts.ra) {
        ch.parts.ra.rotation.x = damp(ch.parts.ra.rotation.x, -0.38 - wave, sr, dt);
        ch.parts.ra.rotation.y = damp(ch.parts.ra.rotation.y, 0.10, sr, dt);
        ch.parts.ra.rotation.z = damp(ch.parts.ra.rotation.z, -1.13, sr, dt);
        ch.parts.ra.position.z = damp(ch.parts.ra.position.z, 0.08, sr, dt);
      }
      setElbow(J.la, -0.58 - wave);
      setElbow(J.ra, -0.62 + wave);
      if (ch.neck) {
        ch.neck.rotation.x = damp(ch.neck.rotation.x, -0.82, sr, dt);
        ch.neck.rotation.z = damp(ch.neck.rotation.z, -wave * 0.6, sr, dt);
      }
    } else {
      // Harness hang: hips sit back, knees and boots come forward, hands meet
      // two riser groups beside the head. Pulling S brings both toggles down for
      // a flare instead of leaving the arms frozen overhead.
      const pull = flare * 1.16;
      ch.body.position.y = damp(ch.body.position.y, -0.07 - (1 - opening) * 0.05, sr, dt);
      ch.body.position.z = damp(ch.body.position.z, -0.035, sr, dt);
      ch.body.rotation.x = damp(ch.body.rotation.x, -0.16 - (1 - opening) * 0.10, sr, dt);
      ch.body.rotation.y = damp(ch.body.rotation.y, 0, sr, dt);
      ch.body.rotation.z = damp(ch.body.rotation.z, wave * 0.30, sr, dt);
      if (ch.parts.ll) {
        ch.parts.ll.rotation.x = damp(ch.parts.ll.rotation.x, -1.12 + flare * 0.12, sr, dt);
        ch.parts.ll.rotation.y = damp(ch.parts.ll.rotation.y, -0.04, sr, dt);
        ch.parts.ll.rotation.z = damp(ch.parts.ll.rotation.z, -0.16, sr, dt);
        ch.parts.ll.position.z = damp(ch.parts.ll.position.z, 0, sr, dt);
        ch.parts.ll.scale.y = damp(ch.parts.ll.scale.y, 1, sr, dt);
      }
      if (ch.parts.rl) {
        ch.parts.rl.rotation.x = damp(ch.parts.rl.rotation.x, -1.08 + flare * 0.12, sr, dt);
        ch.parts.rl.rotation.y = damp(ch.parts.rl.rotation.y, 0.04, sr, dt);
        ch.parts.rl.rotation.z = damp(ch.parts.rl.rotation.z, 0.16, sr, dt);
        ch.parts.rl.position.z = damp(ch.parts.rl.position.z, 0, sr, dt);
        ch.parts.rl.scale.y = damp(ch.parts.rl.scale.y, 1, sr, dt);
      }
      setKnee(J.ll, 1.28 + (1 - opening) * 0.12);
      setKnee(J.rl, 1.24 + (1 - opening) * 0.12);
      if (ch.parts.la) {
        ch.parts.la.rotation.x = damp(ch.parts.la.rotation.x, -2.48 + pull, sr, dt);
        ch.parts.la.rotation.y = damp(ch.parts.la.rotation.y, 0.12, sr, dt);
        ch.parts.la.rotation.z = damp(ch.parts.la.rotation.z, -0.24 + flare * 0.12, sr, dt);
        ch.parts.la.position.z = damp(ch.parts.la.position.z, 0.18 - flare * 0.06, sr, dt);
      }
      if (ch.parts.ra) {
        ch.parts.ra.rotation.x = damp(ch.parts.ra.rotation.x, -2.48 + pull, sr, dt);
        ch.parts.ra.rotation.y = damp(ch.parts.ra.rotation.y, -0.12, sr, dt);
        ch.parts.ra.rotation.z = damp(ch.parts.ra.rotation.z, 0.24 - flare * 0.12, sr, dt);
        ch.parts.ra.position.z = damp(ch.parts.ra.position.z, 0.18 - flare * 0.06, sr, dt);
      }
      setElbow(J.la, -0.28 - flare * 0.48);
      setElbow(J.ra, -0.28 - flare * 0.48);
      if (ch.neck) {
        ch.neck.rotation.x = damp(ch.neck.rotation.x, 0.08, sr, dt);
        ch.neck.rotation.z = damp(ch.neck.rotation.z, -wave * 0.5, sr, dt);
      }
    }
    ch.bob = ch.body.position.y;
    ch.lean = ch.body.rotation.x;
    ch.sway = ch.body.rotation.z;
    ch._stanceNk = 1;
    lockCharacterHips(ch);
  }

  function poseSkydiver(ch, state, dt) {
    if (!ch || !ch.parts || !ch.body) return false;
    beginCharacterHipFrame(ch);
    applySkydiverPose(ch, state, dt == null ? 1 / 60 : dt);
    return true;
  }

  /* ============================================================
     SWIMMING — ONE POSER, EVERY BODY.

     This is city/swim.js's crawl/tread pose, lifted out of it verbatim and
     made char-agnostic. It used to read CBZ.playerChar and a module-level
     phase record inside that file, which meant the only body in this game
     that could swim was the player — and in Shark Sim the beach crowd was
     therefore WALKING ON THE SEABED, land gait and all, with the water up
     over their heads.

     WHO OWNS WHAT:
       • the CALLER owns the state object (makeSwimAnim()) — one per swimmer,
         so a hundred bodies each carry their own stroke phase and their own
         glide/tread blend. Nothing here is module state.
       • swimAnimStep() ADVANCES that state and returns the tread's vertical
         pulse, which the caller adds to its own buoyancy solve before it
         writes a position. (Two calls, not one, because the bob has to be in
         the position the pose is then given — swim.js's ordering, preserved.)
       • poseSwimmer() only WRITES JOINTS. It never moves anybody.

     The player's numbers are unchanged to the last digit: st.rate defaults to
     1 and st.thrash defaults to 0, which is the code that was there.

     st.beat is the one thing that is new and it is not animation — it counts
     HALF stroke cycles, i.e. hands entering the water, so a caller can hang a
     splash off the stroke instead of guessing a timer.
     ============================================================ */
  function makeSwimAnim() {
    return {
      stroke: 0, tread: 0, mood: 0,      // phases + the glide(0)/tread(1) blend
      treading: false, bob: 0, beat: 0,
      rate: 1,                           // cadence multiplier (panic runs hot)
      thrash: 0,                         // 0 = swimming, 1 = drowning-scared
    };
  }

  function swimAnimStep(st, spd, dt) {
    if (!st) return 0;
    if (!(dt > 0)) { st.beat = 0; return st.bob || 0; }
    const rate = st.rate > 0 ? st.rate : 1;
    st.treading = spd < 0.35;
    const moodTarget = st.treading ? 1 : 0;
    st.mood += (moodTarget - st.mood) * (1 - Math.exp(-4.5 * dt));
    const was = st.stroke;
    st.stroke += dt * (2.0 + Math.min(3, spd) * 0.55) * rate;   // ~3s glide cycle
    st.tread += dt * 2.55 * rate;                               // ~2.5s tread cycle
    // one BEAT per half cycle: that is one hand going in.
    st.beat = Math.floor(st.stroke / Math.PI) - Math.floor(was / Math.PI);
    // The tread's own vertical pulse: you sink a few centimetres between
    // eggbeater kicks and pop back on each one.
    st.bob = Math.sin(st.tread * 2) * 0.055 * st.mood;
    return st.bob;
  }

  // opts: { pos } world position to stamp on the rig root (optional — a rig
  //        whose group.position IS the actor's pos needs nothing),
  //       { vy } the swimmer's vertical velocity, which pitches the body
  //        nose-down/up when it is driving through the column.
  /* ---- THE PRONE SWIMMER (st.prone) — how the CROWD swims (2026-09-27) ----
     The cycle above is an UPRIGHT body: torso leaning 17 degrees, legs hanging
     straight down, arms rocking between -1.8 and -0.6 rad. From a boat or a
     shark's-eye view that is a person standing in the sea waving — nobody was
     actually swimming. A body that sets st.prone gets real strokes instead:

       CRAWL        the body flat on the water, arms turning FULL circles half
                    a turn apart (pull under the body, high-elbow recovery out
                    to the side), the torso rolling with each pull, a breath
                    to the side every other stroke, a six-beat flutter kick.
       BREASTSTROKE (st.breast) the head and shoulders rising on an out-sweep,
                    hands together under the chin and shot forward, a frog
                    kick, then a glide — the slow, head-up swimmer.
       FLEEING      (st.flee) a frantic head-up crawl, harder kicks, and every
                    few seconds a glance back over the shoulder at the fin
                    (st.look = the threat's bearing relative to the body).
       TREADING /   the upright pose (mood) and the thrash layer are the old
       THRASH       code, blended in by max(mood, thrash): a swimmer who stops,
                    or whom the shark is ON, comes upright and goes to pieces.

     The hips are lifted (ch.model.position.y, which animChar eases back to 0
     every frame, so leaving the water is a blend) so the back rides at the
     surface given the caller's float depth (st.floatD, feet below the surface
     for an upright body). The player keeps the upright cycle (no st.prone). */
  function sm01(x) { return x <= 0 ? 0 : (x >= 1 ? 1 : x * x * (3 - 2 * x)); }
  const _swC = {}, _swB = {}, _swU = {}, _swW = { cr: 1, br: 0, P: 1, U: 0 };
  function swMix(k) { return (_swC[k] * _swW.cr + _swB[k] * _swW.br) * _swW.P + _swU[k] * _swW.U; }
  function poseSwimmerProne(ch, st, o) {
    const TAU = 6.283185307179586;
    const th = st.thrash > 0 ? Math.min(1, st.thrash) : 0;
    const fl = st.flee > 0 ? Math.min(1, st.flee) : 0;
    const U = Math.max(st.mood, th);            // upright share: tread / thrash
    const P = 1 - U;                            // prone share
    const br = st.breast ? 1 - fl : 0;          // a fleeing breaststroker crawls
    const cr = 1 - br;
    const ph = st.stroke;
    const pitchDrive = Math.max(-0.45, Math.min(0.45, -(+o.vy || 0) * 0.22));

    // ---- CRAWL -------------------------------------------------------------
    // shoulder angle A: -pi = overhead (forward, along the spine), 0 = at the
    // hip. rotation.z > 0 swings the LEFT arm out (and < 0 the right) — the
    // left limbs sit on +x for the arms and -x for the legs on this rig,
    // checked in plain node against the built character. The pull runs -pi..0 under the body, the recovery 0..pi over the
    // back with the arm swung wide and the elbow high.
    const aL = (ph % TAU + TAU) % TAU - Math.PI, aR = ((ph + Math.PI) % TAU + TAU) % TAU - Math.PI;
    const rL = aL > 0 ? Math.sin(aL) : 0, rR = aR > 0 ? Math.sin(aR) : 0;
    const kick = ph * 3;
    const kA = 0.24 * (1 + 0.9 * fl);
    // breath: to the left on every other left-arm recovery
    const breath = Math.max(0, -Math.sin(ph)) * sm01(Math.cos(ph * 0.5) * 2);
    const c = _swC;
    _swC.bx = 1.30 - 0.22 * fl + pitchDrive;
    _swC.by = -0.42 * Math.sin(ph) * (1 - 0.3 * fl);
    _swC.laX = aL;
    _swC.laZ = 0.12 + 0.62 * rL;
    _swC.raX = aR;
    _swC.raZ = -(0.12 + 0.62 * rR);
    _swC.elL = -(0.2 + 1.15 * rL);
    _swC.elR = -(0.2 + 1.15 * rR);
    _swC.llX = 1.36 + Math.sin(kick) * kA;
    _swC.rlX = 1.36 - Math.sin(kick) * kA;
    _swC.llZ = -0.05;
    _swC.rlZ = 0.05;
    _swC.knL = 0.10 + Math.max(0, Math.sin(kick)) * 0.45;
    _swC.knR = 0.10 + Math.max(0, -Math.sin(kick)) * 0.45;
    _swC.nX = -0.30 - 0.70 * fl;
    _swC.nY = 1.15 * breath * (1 - fl);
    // ---- BREASTSTROKE --------------------------------------------------------
    const u = (ph * 0.5 / Math.PI) % 1;         // one cycle per 2pi of stroke
    let bLaX, bZ, bEl;
    if (u < 0.4) { const q = u / 0.4; bLaX = -Math.PI + 1.05 * sm01(q); bZ = 0.15 + 0.85 * Math.sin(Math.PI * q); bEl = -0.15 - 0.95 * q; }
    else if (u < 0.58) { const q = (u - 0.4) / 0.18; bLaX = -2.09 - 0.25 * q; bZ = 0.15 * (1 - q); bEl = -1.1 - 0.6 * q; }
    else if (u < 0.74) { const q = sm01((u - 0.58) / 0.16); bLaX = -2.34 - 0.80 * q; bZ = 0.05; bEl = -1.7 + 1.6 * q; }
    else { bLaX = -Math.PI; bZ = 0.05; bEl = -0.1; }
    // frog kick: knees draw up while the hands come in, the heels whip round
    // and squeeze, then the legs trail in the glide.
    let bHip, bKn, bAb;
    if (u < 0.35) { bHip = 1.45; bKn = 0.1; bAb = 0.05; }
    else if (u < 0.62) { const q = sm01((u - 0.35) / 0.27); bHip = 1.45 - 0.55 * q; bKn = 0.1 + 1.6 * q; bAb = 0.05 + 0.35 * q; }
    else if (u < 0.78) { const q = sm01((u - 0.62) / 0.16); bHip = 0.90 + 0.55 * q; bKn = 1.7 - 1.6 * q; bAb = 0.40 - 0.35 * q; }
    else { bHip = 1.45; bKn = 0.1; bAb = 0.05; }
    const rise = Math.sin(Math.PI * Math.min(1, u / 0.55));
    const b = _swB;
    _swB.bx = 1.38 - 0.36 * rise + pitchDrive;
    _swB.by = 0;
    _swB.laX = bLaX;
    _swB.laZ = bZ;
    _swB.raX = bLaX;
    _swB.raZ = -bZ;
    _swB.elL = bEl;
    _swB.elR = bEl;
    _swB.llX = bHip;
    _swB.rlX = bHip;
    _swB.llZ = -bAb;
    _swB.rlZ = bAb;
    _swB.knL = bKn;
    _swB.knR = bKn;
    _swB.nX = -0.25 - 0.75 * rise;
    _swB.nY = 0;
    // ---- UPRIGHT (the tread cycle above, verbatim numbers) -----------------
    const tw = Math.sin(st.tread), t2 = Math.sin(st.tread * 2);
    const up = _swU;
    _swU.bx = 0.95;
    _swU.by = 0;
    _swU.laX = -0.35 + t2 * 0.42;
    _swU.laZ = -0.62;
    _swU.raX = -0.35 - t2 * 0.42;
    _swU.raZ = 0.62;
    _swU.elL = -0.85;
    _swU.elR = -0.85;
    _swU.llX = 0.55 + t2 * 0.42;
    _swU.rlX = 0.55 - Math.cos(st.tread * 2) * 0.42;
    _swU.llZ = 0.06;
    _swU.rlZ = -0.06;
    _swU.knL = 0.9 + Math.max(0, tw) * 0.3;
    _swU.knR = 0.9 + Math.max(0, -tw) * 0.3;
    _swU.nX = -0.1;
    _swU.nY = 0;
    _swW.cr = cr; _swW.br = br; _swW.P = P; _swW.U = U;
    // LOOK BACK: a glance over the shoulder every few seconds while fleeing,
    // and an upright, thrashing body watches the thing that is coming.
    const glance = Math.pow(Math.max(0, Math.sin(st.tread * 0.9)), 4) * fl * P;
    const look = Math.max(-1.45, Math.min(1.45, +st.look || 0));
    const lookSide = look >= 0 ? 1 : -1;
    ch.group.rotation.x = 0;
    // THE TORSO HINGES AT THE HIPS. ch.body's origin is at the feet, so a bare
    // rotation.x of 1.3 swings the chest a metre and a half forward of the
    // legs; animChar's hip lock is stripped here and re-solved at the end.
    beginCharacterHipFrame(ch);
    if (ch.body) {
      ch.body.rotation.x = swMix("bx") - glance * 0.25;
      ch.body.rotation.y = swMix("by") + glance * lookSide * 0.55;
      ch.body.position.set(0, 0, 0);
    }
    if (ch.parts) {
      if (ch.parts.la) { ch.parts.la.rotation.x = swMix("laX"); ch.parts.la.rotation.z = swMix("laZ"); ch.parts.la.rotation.y = 0; }
      if (ch.parts.ra) { ch.parts.ra.rotation.x = swMix("raX"); ch.parts.ra.rotation.z = swMix("raZ"); ch.parts.ra.rotation.y = 0; }
      if (ch.parts.ll) { ch.parts.ll.rotation.x = swMix("llX"); ch.parts.ll.rotation.z = swMix("llZ"); }
      if (ch.parts.rl) { ch.parts.rl.rotation.x = swMix("rlX"); ch.parts.rl.rotation.z = swMix("rlZ"); }
    }
    if (ch.low) {
      if (ch.low.la) ch.low.la.rotation.x = Math.min(0, swMix("elL"));
      if (ch.low.ra) ch.low.ra.rotation.x = Math.min(0, swMix("elR"));
      if (ch.low.ll) ch.low.ll.rotation.x = Math.max(0, swMix("knL"));
      if (ch.low.rl) ch.low.rl.rotation.x = Math.max(0, swMix("knR"));
    }
    if (ch.neck) {
      ch.neck.rotation.x = swMix("nX") - glance * 0.5;
      ch.neck.rotation.y = swMix("nY") + glance * look * 0.9 + look * 0.8 * th;
    }
    // HIPS TO THE SURFACE. Upright, the caller's float depth hangs the feet
    // st.floatD under the water; prone, the hips must ride ~0.1 m under it.
    if (ch.model) {
      // model.position is in the group's frame; the hip lives inside the
      // model's (humanScale) scale.
      const floatD = st.floatD > 0 ? st.floatD : 1.275;
      ch.model.position.y = Math.max(0, floatD - 0.12 - hipYOf(ch) * (ch.model.scale.y || 1)) * P;
    }
    // THE THRASH LAYER (the upright code's, unchanged), on top.
    if (th > 0) {
      const f = Math.sin(st.tread * 3.3), gg = Math.cos(st.tread * 2.7);
      if (ch.body) { ch.body.rotation.x += 0.20 * th * gg; ch.body.rotation.z = f * 0.26 * th; }
      const FLAIL = -2.6;
      if (ch.parts) {
        if (ch.parts.la) { ch.parts.la.rotation.x = Math.max(FLAIL, ch.parts.la.rotation.x + (-1.45 - f * 0.80) * th); ch.parts.la.rotation.z -= 0.50 * th; }
        if (ch.parts.ra) { ch.parts.ra.rotation.x = Math.max(FLAIL, ch.parts.ra.rotation.x + (-1.45 + f * 0.80) * th); ch.parts.ra.rotation.z += 0.50 * th; }
        if (ch.parts.ll) ch.parts.ll.rotation.x += gg * 0.55 * th;
        if (ch.parts.rl) ch.parts.rl.rotation.x -= gg * 0.55 * th;
      }
    } else if (ch.body) ch.body.rotation.z = 0;
    lockCharacterHips(ch);
    legRootsFollow(ch);
    return true;
  }

  function poseSwimmer(ch, st, opts) {
    if (!ch || !ch.group || !st) return false;
    const o = opts || {};
    if (st.prone) {
      ch.swimming = true;
      if (o.pos) ch.group.position.copy(o.pos);
      legRootsHome(ch);
      return poseSwimmerProne(ch, st, o);
    }
    ch.swimming = true;
    if (o.pos) ch.group.position.copy(o.pos);
    legRootsHome(ch);
    /* THE TORSO HINGES AT THE HIPS here too. This branch pitched ch.body (whose
       origin is at the FEET) by up to 0.95 rad and wrote only its y: the pelvis
       swung ~0.7 m off the tops of the thighs, carrying whatever hip lock the
       last pose had left in body.position. The prone branch already strips
       the lock and re-solves it; so does this one now. */
    beginCharacterHipFrame(ch);
    const m = st.mood;                      // 0 = gliding crawl, 1 = treading
    const sw = Math.sin(st.stroke);
    const tw = Math.sin(st.tread);
    // Body attitude: flat and prone while swimming, near-vertical while
    // treading, nose-down/up when you are actively driving through the column.
    const pitchDrive = Math.max(-0.55, Math.min(0.55, -(+o.vy || 0) * 0.22));
    ch.group.rotation.x = 0;
    if (ch.body) {
      ch.body.rotation.x = (0.30 + pitchDrive) * (1 - m) + 0.95 * m;
      ch.body.position.set(0, (Math.sin(st.stroke * 2) * 0.028) * (1 - m) + (tw * 0.02) * m, 0);
    }
    if (ch.parts) {
      // crawl: big alternating overhead sweep. tread: short sculling arcs.
      const laC = -1.20 + sw * 0.62, raC = -1.20 - sw * 0.62;
      const laT = -0.35 + Math.sin(st.tread * 2) * 0.42, raT = -0.35 - Math.sin(st.tread * 2) * 0.42;
      if (ch.parts.la) { ch.parts.la.rotation.x = laC * (1 - m) + laT * m; ch.parts.la.rotation.z = -0.28 - 0.34 * m; }
      if (ch.parts.ra) { ch.parts.ra.rotation.x = raC * (1 - m) + raT * m; ch.parts.ra.rotation.z = 0.28 + 0.34 * m; }
      // crawl: flutter kick. tread: eggbeater — the legs circle out of phase.
      const llC = sw * 0.30, rlC = -sw * 0.30;
      const llT = 0.55 + Math.sin(st.tread * 2) * 0.42, rlT = 0.55 - Math.cos(st.tread * 2) * 0.42;
      if (ch.parts.ll) ch.parts.ll.rotation.x = llC * (1 - m) + llT * m;
      if (ch.parts.rl) ch.parts.rl.rotation.x = rlC * (1 - m) + rlT * m;
    }
    if (ch.low) {
      if (ch.low.la) ch.low.la.rotation.x = -0.45 * (1 - m) - 0.85 * m;
      if (ch.low.ra) ch.low.ra.rotation.x = -0.45 * (1 - m) - 0.85 * m;
      if (ch.low.ll) ch.low.ll.rotation.x = (0.35 + Math.max(0, -sw) * 0.25) * (1 - m) + (0.9 + Math.max(0, tw) * 0.3) * m;
      if (ch.low.rl) ch.low.rl.rotation.x = (0.35 + Math.max(0, sw) * 0.25) * (1 - m) + (0.9 + Math.max(0, -tw) * 0.3) * m;
    }
    /* PANIC IS NOT A FASTER STROKE. Somebody who thinks they are about to be
       eaten stops swimming: the arms come clear of the water and beat OVER the
       head, the torso rolls hard side to side, and the legs stop kicking in
       any pattern at all. Layered ON TOP of the tread so it is one continuous
       body going to pieces rather than a second animation cutting in. Skipped
       entirely at thrash 0, which is the player's path and every calm body. */
    const th = st.thrash > 0 ? Math.min(1, st.thrash) : 0;
    if (th > 0) {
      const f = Math.sin(st.tread * 3.3), gg = Math.cos(st.tread * 2.7);
      if (ch.body) {
        ch.body.rotation.x += 0.20 * th * gg;
        ch.body.rotation.z = f * 0.26 * th;
      }
      if (ch.parts) {
        /* CLAMPED, because the flail is added to whatever mood the body is
           already in. A panicking swimmer is MOVING, so the base pose is the
           crawl (-1.20 ∓ 0.62) and the thrash adds another -2.25 on top: past
           -pi the shoulder rotates THROUGH vertical and the arm comes back up
           behind the body, which reads as a broken rig rather than a frightened
           one. -2.6 rad is the arm straight overhead and a little back, which
           is as far as a shoulder goes. */
        const FLAIL = -2.6;
        if (ch.parts.la) { ch.parts.la.rotation.x = Math.max(FLAIL, ch.parts.la.rotation.x + (-1.45 - f * 0.80) * th); ch.parts.la.rotation.z -= 0.50 * th; }
        if (ch.parts.ra) { ch.parts.ra.rotation.x = Math.max(FLAIL, ch.parts.ra.rotation.x + (-1.45 + f * 0.80) * th); ch.parts.ra.rotation.z += 0.50 * th; }
        if (ch.parts.ll) ch.parts.ll.rotation.x += gg * 0.55 * th;
        if (ch.parts.rl) ch.parts.rl.rotation.x -= gg * 0.55 * th;
      }
      if (ch.low) {
        if (ch.low.ll) ch.low.ll.rotation.x = Math.max(0, ch.low.ll.rotation.x + (0.45 + gg * 0.40) * th);
        if (ch.low.rl) ch.low.rl.rotation.x = Math.max(0, ch.low.rl.rotation.x + (0.45 - gg * 0.40) * th);
      }
    } else if (ch.body) ch.body.rotation.z = 0;
    lockCharacterHips(ch);
    legRootsFollow(ch);
    return true;
  }

  /* ---- the layered animation update ----
     speed: current planar speed (units/s). dt: seconds.

     Gait model (verified frame-by-frame with tools/studio.mjs filmstrips):
       θ = ch.phase, LEFT hip = +A·sinθ  (positive x = limb swings BACK)
       left leg swings FORWARD while cosθ<0 → left knee flexes then, peaking
       mid-swing (θ≈π); right leg mirrors (cosθ>0, peak θ≈0).
       Double support ≈ θ=π/2, 3π/2 (feet apart) → CoM lowest there.
       Arms counter-swing the legs; elbows carry a base bend that deepens
       with speed (jogger's ~90° pump at sprint) and on the forward swing. */
  /* ==== THE ANKLE SOLVE — run after every animChar (and once on a corpse) ===
     The foot (leg.userData.foot, see THE ANKLE) is posed from the pose the
     rest of the rig already took, so no pose writer has to know it exists:
       UPRIGHT (the model's up within ~50 deg of the world's): the sole is laid
         flat to the world (ankle = world-up pitch in the model frame - hip -
         knee), which plants a standing, walking, sitting, crouching or
         kneeling foot on the floor. A foot that is off the floor (a strongly
         bent knee on a body that is not sitting/crouching/kneeling/riding:
         the swing of a run) hangs a little pointed instead.
       LYING (knocked down, dead, asleep, prone): the foot falls into relaxed
         plantar flexion, toes pointing away, the way a body lies, instead of
         standing straight up off the end of the leg.
     Clamped to the shoe's own range (foot.userData.flex: a cowboy boot barely
     flexes, a bare foot points), and the stance roll is undone so the sole
     stays flat across its width. Cost: a few trig ops per leg. */
  const ANKLE_LIE = 0.55, ANKLE_HANG = 0.22;
  function ankleSolve(ch, dt, forceLying) {
    const parts = ch && ch.parts;
    const ll = parts && parts.ll, rl = parts && parts.rl;
    if (!ll || !rl || !ll.userData.foot) return;
    const model = ll.parent;
    // world up, in the model's frame (the rotation's transpose times +Y)
    let wx = 0, wy = 1, wz = 0;
    if (model) {
      const e = model.matrixWorld.elements;
      const l = Math.hypot(e[1], e[5], e[9]) || 1;
      wx = e[1] / l; wy = e[5] / l; wz = e[9] / l;
    }
    const planted = !!(ch.sitting || ch.riding || (ch.kneelB || 0) > 0.3 || (ch._cb || 0) > 0.3);
    const pitch = Math.atan2(wz, wy);
    for (let i = 0; i < 2; i++) {
      const leg = i ? rl : ll, foot = leg.userData.foot, low = leg.userData.low;
      if (!foot) continue;
      const knee = low ? low.rotation.x : 0;
      const s = leg.rotation.x + knee;                      // the shin's sagittal angle in the model
      // how upright the SHIN is in the world: a lying body (on its back, its
      // face, its side, a KO keyframed with the model still upright) has a
      // shin lying along the floor, whatever the model's own frame says
      const shinUp = forceLying ? 0 : wy * Math.cos(s) + wz * Math.sin(s);
      const up = planted && !forceLying ? 1 : sm01((shinUp - 0.35) / 0.4);
      const level = pitch - s;
      const hang = planted ? 0 : sm01((knee - 0.45) / 0.6);
      let a = level + (ANKLE_HANG - level) * hang;
      const fl = foot.userData.flex || [-0.35, 0.7];
      // lying: slack, toes away; if that would still drive the toes into the
      // floor (face down), point them fully so the instep lies on it
      let lie = ANKLE_LIE + (i ? 0.07 : -0.04) + (ch.phase ? 0.06 * Math.sin(ch.phase * (i ? 3.1 : 2.3)) : 0);
      if (!forceLying && -wy * Math.sin(s + lie) + wz * Math.cos(s + lie) < -0.3) lie = fl[1];
      void wx;
      a = lie + (a - lie) * up;
      a = a < fl[0] ? fl[0] : (a > fl[1] ? fl[1] : a);
      const roll = Math.max(-0.2, Math.min(0.2, -leg.rotation.z * up));
      if (dt > 0 && dt < 0.25) {
        const k = 1 - Math.exp(-18 * dt);
        foot.rotation.x += (a - foot.rotation.x) * k;
        foot.rotation.z += (roll - foot.rotation.z) * k;
      } else { foot.rotation.x = a; foot.rotation.z = roll; }
    }
  }
  CBZ.charAnkleSolve = ankleSolve;
  /* A SEATED SUIT. The shell hangs to the seat standing (THE JACKET COVERS
     THE SEAT); a hip folded past ~45 degrees would carry the thighs up
     through its front quarters, so a seated body wears the swept-front
     variant — the jacket falls open over the lap — and gets the hanging one
     back when it stands. Hysteresis, and the geometry is cached per spec. */
  function jacketPosture(ch) {
    const jm = ch && ch._jacketMesh;
    if (!jm || !jm.visible || !ch.parts || !ch.parts.ll || !ch.parts.rl) return;
    const sp = jm.userData && jm.userData.torsoPart;
    if (!sp || sp.part !== "jacket" || !sp.S) return;
    const bx = ch.body ? ch.body.rotation.x : 0;
    const flex = Math.max(bx - ch.parts.ll.rotation.x, bx - ch.parts.rl.rotation.x);
    const want = sp.seated ? flex > 0.6 : flex > 0.8;
    if (want === !!sp.seated) return;
    const alt = jm.userData._jacketAlt;
    let next = alt && alt.key && alt.seated === want && alt.y0 === sp.y0 && alt.S === sp.S ? alt : null;
    if (!next) {
      next = partSpec(sp.S, "jacket", sp.box, sp.origin, { y0: sp.y0, y1: sp.y1, off: sp.off, flat: sp.flat, lapel: sp.lapel, seated: want });
    }
    next.lod = sp.lod;
    jm.userData._jacketAlt = sp;
    jm.userData.torsoPart = next;
    if (jm.geometry && jm.geometry.userData && jm.geometry.userData.torso) jm.geometry = partGeometry(jm);
  }
  function animChar(ch, speed, dt) {
    animCharBody(ch, speed, dt);
    // THE THIGHS HANG FROM THE PELVIS, IN EVERY POSE: the walk's bob, the
    // crouch's drop, the counter-rotation and every posed branch move `body`
    // (the pelvis is on it) while the legs ride `model` — a sprint's bob put
    // the tops of the thighs out through the waistband, a crouch dropped the
    // pelvis 26 cm below them. The leg roots go where the pelvis draws its
    // hip joints (THE LEGS HANG FROM THE PELVIS'S OWN HIP JOINTS).
    legRootsFollow(ch);
    // a held pose that closed a hand ON something (poses.js gripPole: the
    // flag) lets go the frame the pose ends
    if (ch._ikPose && ch._ikPose !== ch.pose) { charArmTo.contactRelease(ch, "both"); ch._ikPose = null; }
    if (ch._jacketMesh) jacketPosture(ch);
    ankleSolve(ch, dt, false);
    if (ch._mounts) slingPose(ch);     // after every pose branch: see "A SLING GIVES"
  }
  function animCharBody(ch, speed, dt) {
    if (ch._legRootsMoved) legRootsHome(ch);           // back on its feet: the leg roots go home
    // BODY LOD for every rig nobody manages (prison, warlord, disasters...):
    // city/peds.js drives its crowd through rig.setHandLod itself.
    if (!ch._lodExt && ch._autoLod) ch._autoLod();
    /* THE HELD GUN'S GROUND CONTACT — the FIRST thing this function does, and
       the position is load-bearing in both directions.
       ABOVE beginCharacterHipFrame: that call strips the hip-pivot
       compensation off ch.body, so between it and lockCharacterHips the rig is
       0.57 m out of place on a prone body. A solve run in that window measures
       a body that is never rendered — it reported the gun 0.59 m lower than it
       is and lifted it into the air by exactly that. Here the rig is the fully
       composed one the last frame actually DREW.
       ABOVE every early return: the socket offset written below has to keep
       decaying whatever pose the rig falls into next, or a gun lifted while
       prone stays lifted through the stand-up.
       Player rig only: it is the one body that goes prone, the one
       holsterprops.js drives, and the one whose gun the camera ever gets close
       enough to judge. Both ends of the loop are damped, so reading last
       frame's barrel orientation (holsterprops writes it at onAlways 54) costs
       nothing. */
    if (ch === CBZ.playerChar && ch.sockets) gunGroundRest(ch, dt);
    beginCharacterHipFrame(ch);
    const moving = speed > 0.2;
    const walkRef = (CBZ.TUNE && CBZ.TUNE.walkSpeed) || 6.4;
    const norm = Math.min(speed / walkRef, 1);          // 0..1 stand→brisk
    const run2 = clamp01((speed - walkRef) / (walkRef * 0.7)); // sprint layer
    ch.breath += dt;
    const J = ch.low || {};
    const setKnee = (j, x, rate) => { if (j) { j.rotation.x = damp(j.rotation.x, Math.max(0, x), rate, dt); j.rotation.y = damp(j.rotation.y, 0, 12, dt); j.rotation.z = damp(j.rotation.z, 0, 12, dt); } };
    const setElbow = (j, x, rate) => { if (j) { j.rotation.x = damp(j.rotation.x, Math.min(0, x), rate, dt); j.rotation.y = damp(j.rotation.y, 0, 12, dt); j.rotation.z = damp(j.rotation.z, 0, 12, dt); } };

    // prone blend — physics.js reads this to sink the rig group; damped ABOVE
    // every early-return branch so it always decays once pronePose clears.
    ch._proneB = damp(ch._proneB || 0, ch.pronePose ? 1 : 0, 9, dt);

    // A falling/chuting body is neither a walk nor a jump animation. The
    // bailout owner publishes the state; this shared rig owns the joints.
    if (ch.skydiving) {
      applySkydiverPose(ch, ch.skydiving, dt);
      return;
    }

    // ---- MOUNTED RIDER: hips planted, thighs wrapped, shins hanging -------
    // wildlife_tame.js owns the animal/root trajectory and publishes only a
    // small visual record here. The ordinary walk cycle must never run while
    // riding: a walking avatar translated above an animal reads as two actors
    // occupying the same place, not one body carried by another.
    if (ch.riding) {
      const rr = ch.riding, sr = 18;
      const hs = (ch.group && ch.group.userData && ch.group.userData.humanScale) || 1;
      const pf = ch.profile;
      const thigh = Math.max(0.2, (pf ? pf.legUp : 0.48) * hs);
      const mountHalf = Math.max(0.12, (rr.width || 0.7) * 0.46);
      // Solve the hip abduction from the actual mount width and this body's
      // own thigh length. Cap at a believable deep straddle for elephants and
      // bison whose backs are wider than the stylised human femur can span.
      const spread = Math.max(0.36, Math.min(0.92,
        Math.asin(Math.max(0.18, Math.min(0.80, mountHalf / thigh)))));
      const movingK = rr.moving ? 1 : 0;
      const airK = rr.airborne ? 1 : 0;
      const beat = movingK ? Math.sin(rr.phase || 0) : 0;
      const thighForward = -1.18 - airK * 0.16;
      const kneeFold = 1.20 + airK * 0.18;

      // Any chair solve that was active before mounting is refunded here. A
      // saddle owns hip placement in wildlife_tame, never model-level sinking.
      if (ch.model) ch.model.position.y = damp(ch.model.position.y, 0, sr, dt);
      ch._seatSunk = 0;
      ch.body.position.y = damp(ch.body.position.y, -0.015 - movingK * 0.025, sr, dt);
      ch.body.position.z = damp(ch.body.position.z, 0.015, sr, dt);
      ch.body.rotation.x = damp(ch.body.rotation.x, 0.12 + movingK * 0.08 - airK * 0.04, sr, dt);
      ch.body.rotation.y = damp(ch.body.rotation.y, 0, sr, dt);
      ch.body.rotation.z = damp(ch.body.rotation.z, beat * 0.035, sr, dt);

      // Local -X is the visible left hip. Each thigh pitches forward and
      // abducts OUTWARD; each knee then folds back so boots hang down the two
      // flanks instead of pointing forward like a chair sitter's feet.
      if (ch.parts.ll) {
        ch.parts.ll.rotation.x = damp(ch.parts.ll.rotation.x, thighForward - beat * 0.035, sr, dt);
        ch.parts.ll.rotation.y = damp(ch.parts.ll.rotation.y, -0.08, sr, dt);
        ch.parts.ll.rotation.z = damp(ch.parts.ll.rotation.z, -spread, sr, dt);
        ch.parts.ll.position.z = damp(ch.parts.ll.position.z, 0, sr, dt);
        ch.parts.ll.scale.y = damp(ch.parts.ll.scale.y, 1, sr, dt);
      }
      if (ch.parts.rl) {
        ch.parts.rl.rotation.x = damp(ch.parts.rl.rotation.x, thighForward + beat * 0.035, sr, dt);
        ch.parts.rl.rotation.y = damp(ch.parts.rl.rotation.y, 0.08, sr, dt);
        ch.parts.rl.rotation.z = damp(ch.parts.rl.rotation.z, spread, sr, dt);
        ch.parts.rl.position.z = damp(ch.parts.rl.position.z, 0, sr, dt);
        ch.parts.rl.scale.y = damp(ch.parts.rl.scale.y, 1, sr, dt);
      }
      setKnee(J.ll, kneeFold + beat * 0.04, sr);
      setKnee(J.rl, kneeFold - beat * 0.04, sr);
      if (J.ll) J.ll.scale.y = damp(J.ll.scale.y, 1, sr, dt);
      if (J.rl) J.rl.scale.y = damp(J.rl.scale.y, 1, sr, dt);
      ch._seatShinScaled = false;

      // A relaxed two-hand hold toward the withers. The tiny alternating give
      // follows the animal stride; the rider never pumps arms like a runner.
      const reach = -0.72 - movingK * 0.07 + airK * 0.08;
      if (ch.parts.la) {
        ch.parts.la.rotation.x = damp(ch.parts.la.rotation.x, reach + beat * 0.025, sr, dt);
        ch.parts.la.rotation.y = damp(ch.parts.la.rotation.y, 0.04, sr, dt);
        ch.parts.la.rotation.z = damp(ch.parts.la.rotation.z, 0.24, sr, dt);
        ch.parts.la.position.z = damp(ch.parts.la.position.z, 0.05, sr, dt);
      }
      if (ch.parts.ra) {
        ch.parts.ra.rotation.x = damp(ch.parts.ra.rotation.x, reach - beat * 0.025, sr, dt);
        ch.parts.ra.rotation.y = damp(ch.parts.ra.rotation.y, -0.04, sr, dt);
        ch.parts.ra.rotation.z = damp(ch.parts.ra.rotation.z, -0.24, sr, dt);
        ch.parts.ra.position.z = damp(ch.parts.ra.position.z, 0.05, sr, dt);
      }
      setElbow(J.la, -0.62 - airK * 0.08, sr);
      setElbow(J.ra, -0.62 - airK * 0.08, sr);
      if (ch.neck) {
        ch.neck.rotation.x = damp(ch.neck.rotation.x, -0.02 + airK * 0.05, sr, dt);
        ch.neck.rotation.z = damp(ch.neck.rotation.z, -beat * 0.02, sr, dt);
      }
      lockCharacterHips(ch);
      return;                         // the mount pose owns the whole rig
    }

    /* ---- ASLEEP: the pose a bed has never had ----------------------------
       THE LIE THIS DELETES. city/propuse.js walks a body to the bedside,
       perches it on the mattress edge and rolls it flat — a genuinely good
       arc that ended in the WORST pose in the game: the standing rig, rolled
       90° about Z. That is byte-for-byte the KO pose physics.js puts on a
       corpse in the street. Straight legs, standing-idle arms, level chin,
       and not one millimetre of movement. Every bedroom contained a plank.

       WHERE THIS SITS IN THE CHAIN. A lying body OUTRANKS a seated one: the
       lie arc holds `sitting` a beat INTO the roll (propuse's `swing`), so
       for those frames both flags are live and the horizontal body must win
       or the chair solve would sink a sideways rig into the mattress. Like
       every full-rig state here it early-returns — a later branch that got a
       frame would fight this one and the body would jitter between two poses.

       WHAT COMPOSES AND WHAT DOESN'T. The group's 90° Z-roll stays propuse's
       (it owns placement, and CBZ.propLiePlace solves the mattress clearance
       off the same roll) — this pose never touches ch.group. Everything here
       is INSIDE the rig, which is also how the side/back choice is made:
       body.rotation.y spins the torso about its own feet→head axis, and since
       local +X is world-up under that roll, +y turns the chest toward the
       ceiling. A back sleeper is therefore the same placement, rolled from
       the inside — no second transform for propuse to fight.

       THE KNEES ARE SOLVED, NOT AUTHORED. A sleeper draws the heels back
       until the ankle returns under the line of the hip: the leg stops being
       a stick and becomes a shape. That is one equation on THIS rig's own
       segments — THIGH·sin(a) + SHIN·sin(a−k) = 0 → k = a + asin(THIGH/SHIN ·
       sin a) — so a long-femured adult folds deeper than a child does, and
       nobody ever has to retune a magic angle when the profile table changes.

       Everything is an absolute damp toward a target, so entering or leaving
       mid-blend can never accumulate (the grapple brace-pose lesson). */
    // The KO/knockdown crumple is the LAST layer in this function on purpose,
    // which means every early-returning pose above it silently outranks it.
    // For a chair that is harmless; for a BED it is not — somebody shot in
    // their sleep must fall out of the sleep pose, not keep breathing through
    // it. Two flags, checked here rather than in propuse, because the rig is
    // the only thing that knows a crumple is running.
    if (ch.lying && CBZ.CONFIG.CHAR_SLEEP_POSE !== false && !(ch.koT > 0) && !ch.koPose) {
      const L = ch.lying, sr = 9;
      const pf = ch.profile;
      const THIGH = Math.max(0.05, pf ? pf.legUp : LEG_UP);
      const SHIN = Math.max(0.05, pf ? pf.legLo : LEG_LO);
      // Per-actor, published by propuse (stable per BODY, so the same person
      // always sleeps the same way). Absent → a sensible middle sleeper.
      const back = !!L.back;
      const vary = (L.vary != null) ? L.vary : 0.5;
      const dv = vary - 0.5;                      // −0.5..+0.5, the variance knob
      // Near arm across the chest, or laid along the side. Left to the record
      // when it says; otherwise a back sleeper lets the arm lie and a side
      // sleeper hugs it in, which is what the sleep-posture literature and
      // every photograph of a bed agree on.
      const fold = (L.fold != null) ? !!L.fold : !back;

      // BREATHING. ~0.25 Hz, i.e. one breath per four seconds — the sleeping
      // rate, not the standing one. Amplitude is a fraction of THIS torso's
      // depth so a child's chest doesn't heave like a linebacker's. The phase
      // advances here rather than in propuse so the breath keeps running even
      // if whoever published the record never touches it again.
      L.phase = (L.phase || 0) + dt * BREATH_W;
      const br = Math.sin(L.phase);
      const brAmp = (pf ? pf.torsoD : 0.50) * 0.030;

      // A seat solve that was live a beat ago (the perch on the mattress edge)
      // is refunded here — this branch early-returns past the blend-out below.
      refundSeatSolve(ch, J, dt, sr);
      // …unless CBZ.moves is carrying the hips from the perch onto the pillow:
      // then the drop is ITS number for this frame (it pivots the transform
      // about the hip, so a damp here would let the hips sink or float)
      if (ch.postureSink != null && ch.model) { ch.model.position.y = ch.postureSink; ch._seatSunk = 1; }
      if (ch.typing) ch.typing = false;

      const roll = back ? LIE_ROLL_BACK : LIE_ROLL_SIDE;
      const curl = (back ? 0.05 : 0.13) + dv * 0.05;      // spine curls over the knees
      ch.body.position.x = damp(ch.body.position.x, br * brAmp, sr, dt);   // chest RISE: +x is up under the roll
      ch.body.position.y = damp(ch.body.position.y, -0.02, sr, dt);
      ch.body.position.z = damp(ch.body.position.z, 0, sr, dt);
      ch.body.rotation.x = damp(ch.body.rotation.x, curl, sr, dt);
      ch.body.rotation.y = damp(ch.body.rotation.y, roll, sr, dt);
      ch.body.rotation.z = damp(ch.body.rotation.z, br * 0.012, sr, dt);

      // LEGS. The TOP leg is rl: unlike the mirrored arm sockets, legs keep
      // semantic right on local +X. Its knee draws up and falls forward
      // across the other; the bottom leg stays long against the mattress.
      const kneeFor = (a) => Math.max(0.10, Math.min(1.95,
        a + Math.asin(Math.max(-1, Math.min(1, (THIGH / SHIN) * Math.sin(a))))));
      const hipA = (back ? 0.22 : 0.44) + dv * 0.10;
      const aTop = hipA * 1.25, aBot = hipA * 0.78;
      const twist = back ? 0.22 : 0.05;            // a back sleeper's toes fall outward
      if (ch.parts.rl) {
        ch.parts.rl.rotation.x = damp(ch.parts.rl.rotation.x, -aTop, sr, dt);
        ch.parts.rl.rotation.y = damp(ch.parts.rl.rotation.y, twist, sr, dt);
        ch.parts.rl.rotation.z = damp(ch.parts.rl.rotation.z, -0.14, sr, dt);
        ch.parts.rl.position.z = damp(ch.parts.rl.position.z, 0, sr, dt);
        ch.parts.rl.scale.y = damp(ch.parts.rl.scale.y, 1, sr, dt);
      }
      if (ch.parts.ll) {
        ch.parts.ll.rotation.x = damp(ch.parts.ll.rotation.x, -aBot, sr, dt);
        ch.parts.ll.rotation.y = damp(ch.parts.ll.rotation.y, -twist, sr, dt);
        ch.parts.ll.rotation.z = damp(ch.parts.ll.rotation.z, 0.04, sr, dt);
        ch.parts.ll.position.z = damp(ch.parts.ll.position.z, 0, sr, dt);
        ch.parts.ll.scale.y = damp(ch.parts.ll.scale.y, 1, sr, dt);
      }
      setKnee(J.rl, kneeFor(aTop), sr);
      setKnee(J.ll, kneeFor(aBot), sr);

      // ARMS. The lower-side ra is rooted on local -X; positive Z carries it
      // out of the mattress and across the chest. The upper-side la is +X and
      // uses the opposite sign to relax inward. The old signs sent both arms
      // farther OUTBOARD and left a detached-looking hand above the sleeper.
      if (ch.parts.ra) {
        ch.parts.ra.rotation.x = damp(ch.parts.ra.rotation.x, (fold ? -0.46 : -0.14) + br * 0.020, sr, dt);
        ch.parts.ra.rotation.y = damp(ch.parts.ra.rotation.y, 0, sr, dt);
        ch.parts.ra.rotation.z = damp(ch.parts.ra.rotation.z, (fold ? 0.68 : 0.18) + dv * 0.06, sr, dt);
        ch.parts.ra.position.z = damp(ch.parts.ra.position.z, fold ? 0.05 : 0.02, sr, dt);
      }
      setElbow(J.ra, fold ? -1.10 : -0.40, sr);
      if (ch.parts.la) {
        ch.parts.la.rotation.x = damp(ch.parts.la.rotation.x, -0.30 + br * 0.016, sr, dt);
        ch.parts.la.rotation.y = damp(ch.parts.la.rotation.y, 0, sr, dt);
        ch.parts.la.rotation.z = damp(ch.parts.la.rotation.z, -0.18 - dv * 0.05, sr, dt);
        ch.parts.la.position.z = damp(ch.parts.la.position.z, 0.04, sr, dt);
      }
      setElbow(J.la, -0.58, sr);

      // HEAD. Chin tucks toward the chest (the universal sleeping curl) and
      // the crown tips toward the mattress so the cheek actually meets the
      // pillow: +z on the neck maps the head's top toward local −X, which is
      // DOWN under the roll. A back sleeper is already face-up and only needs
      // a whisker of it.
      if (ch.neck) {
        ch.neck.rotation.x = damp(ch.neck.rotation.x, 0.14 + br * 0.012, sr, dt);
        ch.neck.rotation.z = damp(ch.neck.rotation.z, (back ? 0.06 : 0.20) + dv * 0.05, sr, dt);
      }
      // Publish what we wrote, exactly as slidePose/pronePose do: the KO and
      // death blends read these RELATIVELY, so a parked lean would bias a body
      // that dies in its sleep, and the neck has no locomotion owner at all.
      ch.bob = ch.body.position.y; ch.lean = ch.body.rotation.x; ch.sway = ch.body.rotation.z;
      ch._stanceNk = 1;
      lockCharacterHips(ch);
      return;   // the sleep pose owns the whole rig
    }

    /* ---- ONE KNEE DOWN (CBZ.moves.kneel) ----------------------------------
       The medic over a body, a man tying a lace, anyone tending something on
       the floor: the left knee on the ground with the shin laid back along
       it, the right foot planted ahead, hips at knee height. The angles are
       solved from THIS rig's segments by CBZ.moves.kneelLegs (the sequencer
       tracks the same hip), and written EXACTLY at the blend CBZ.moves
       publishes (`kneelB`, 0 standing .. 1 down), so going down and coming up
       are the sequencer's 0.6 s / 0.5 s curves, not a damp's guess. The arms
       are whatever held pose the caller set (`tend` by default reads as
       working hands); with none, the forearms rest over the forward knee. */
    if (ch.kneelB > 0 && !ch.sitting && !ch.lying && CBZ.moves && CBZ.moves.kneelLegs) {
      const kb = Math.min(1, ch.kneelB), sr = 14;
      const KL = CBZ.moves.kneelLegs(ch, ch._kneelSol || (ch._kneelSol = {}));
      if (ch.model) { ch.model.position.y = ch.postureSink != null ? ch.postureSink : KL.sink * kb; ch._seatSunk = 1; }
      ch.body.position.y = damp(ch.body.position.y, 0, sr, dt);
      ch.body.rotation.x = 0.16 * kb;
      ch.body.rotation.z = damp(ch.body.rotation.z, 0, sr, dt);
      ch.body.rotation.y = damp(ch.body.rotation.y, 0, sr, dt);
      if (ch.parts.ll) { ch.parts.ll.rotation.x = -KL.ak * kb; ch.parts.ll.rotation.z = 0.04 * kb; ch.parts.ll.rotation.y = 0; ch.parts.ll.scale.y = 1; }
      if (ch.parts.rl) { ch.parts.rl.rotation.x = -KL.af * kb; ch.parts.rl.rotation.z = -0.05 * kb; ch.parts.rl.rotation.y = 0; ch.parts.rl.scale.y = 1; }
      if (J.ll) { J.ll.rotation.x = KL.kk * kb; J.ll.rotation.y = 0; J.ll.rotation.z = 0; J.ll.scale.y = 1; }
      if (J.rl) { J.rl.rotation.x = KL.kf * kb; J.rl.rotation.y = 0; J.rl.rotation.z = 0; J.rl.scale.y = 1; }
      const heldArms = ch.pose && CBZ.charPoses && CBZ.charPoses[ch.pose];
      if (heldArms) heldArms(ch, dt);
      else {
        if (ch.parts.la) { ch.parts.la.rotation.x = damp(ch.parts.la.rotation.x, -0.55, sr, dt); ch.parts.la.rotation.z = damp(ch.parts.la.rotation.z, 0.14, sr, dt); }
        if (ch.parts.ra) { ch.parts.ra.rotation.x = damp(ch.parts.ra.rotation.x, -0.55, sr, dt); ch.parts.ra.rotation.z = damp(ch.parts.ra.rotation.z, -0.14, sr, dt); }
        setElbow(J.la, -0.95, sr); setElbow(J.ra, -0.95, sr);
      }
      if (ch.neck) { ch.neck.rotation.x = damp(ch.neck.rotation.x, 0.14 * kb, sr, dt); ch.neck.rotation.z = damp(ch.neck.rotation.z, 0, sr, dt); }
      ch.bob = ch.body.position.y; ch.lean = ch.body.rotation.x; ch.sway = ch.body.rotation.z;
      ch._stanceNk = 1;
      lockCharacterHips(ch);
      return;   // the kneel owns the whole rig
    }

    // ---- SEATED (office-jobs): full-rig pose that OWNS the body ----
    if (ch.sitting) {
      const sr = 12;
      // CHAIR-SIT V2 (owner: plane passengers "sit like their feet are on the
      // seat instead of their feet on the ground"). Root cause is the ANCHOR
      // convention meeting a pose that can't reach: aircraft seat anchors sit
      // ON the cushion top while this legacy pose keeps the feet at the rig's
      // root plane — so the whole folded body squatted on top of the cushion.
      // The hip pivots are authored at a FIXED height above the root (legs are
      // children of the model), so no leg angle alone can ever push the feet
      // below the root plane: feet-on-the-floor REQUIRES sinking the model.
      // Seats that DECLARE their geometry (ch.seatRef = { cushion, floorBelow },
      // world units — aircraft seat records carry it; benches/desks/car
      // interiors don't and keep the legacy fake byte-identical) get the real
      // solve: sink the model so the butt lands ON the cushion, then close a
      // hip/knee chain so the soles land ON the floor. Two closed forms: shin
      // tucked back under the knee for normal chairs (airliner rows, ~90-110°
      // knee), legs stretched forward with knees above the hips for low
      // loungers (the private-jet recliners) where a tuck would demand an
      // anatomically absurd fold.
      /* A SEAT THAT DECLARED NOTHING still gets the real solve. The legacy
         fake (below, kept only for a missing CBZ.moves) dropped the BODY 0.6
         into the chair and left the legs hanging from the standing hip line:
         the pelvis drew 42 cm under the tops of its own thighs. Undeclared
         seats now sit the hips at the height the fake put them (the torso
         lands where every legacy anchor expects it) on a synthesized cushion,
         and the shared leg solve folds the legs to the floor from there. */
      const v2 = !CBZ.CONFIG || CBZ.CONFIG.CHAR_SEAT_POSE_V2 !== false;
      let ref = ch.seatRef && v2 ? ch.seatRef : null;
      if (!ref && v2) {
        const hs0 = (ch.group && ch.group.userData && ch.group.userData.humanScale) || 0.70;
        const L = ch._legacySeat || (ch._legacySeat = { cushion: 0, floorBelow: 0, kind: null, legacy: true });
        L.cushion = Math.max(0.05, (hipYOf(ch) - 0.6) * hs0 - 0.10 * hs0);
        ref = L;
      }
      if (ref && ch.model && CBZ.moves && CBZ.moves.seatLegs) {
        const pf = ch.profile;
        const post = (CBZ.CONFIG.CHAR_SEAT_POSTURE !== false && CBZ.charSeatPosture)
          ? CBZ.charSeatPosture(ref.kind) : null;
        /* THE LEG SOLVE IS SHARED (entities/moves_posture.js CBZ.moves.seatLegs):
           the hip pivot over the cushion (a whisker less than the thigh's
           half-thickness, so the thigh presses in — never a hover), the model
           sink that puts it there, the thigh/knee/shin that land the sole on
           the floor or the rail. The posture sequencer asks the SAME function
           where the hips and feet end before this branch has ever run, so the
           hip it tracks while a body sits down is the hip drawn here. */
        const SL = CBZ.moves.seatLegs(ch, ref, post, ch._seatSol || (ch._seatSol = {}));
        const hipF = SL.hipF;
        /* A TRANSITION, NOT A DAMP. While CBZ.moves is lowering or raising the
           body it publishes the fold (`seatBlend`, 0 standing .. 1 seated) and
           the hip drop (`postureSink`) it chose for this frame; both are
           written here exactly, because a damp toward the end pose is what
           made the old arc's hips arrive late and pop. Held seats (no blend)
           keep the damped approach, whose target is the same end pose. */
        const blend = ch.seatBlend != null ? Math.max(0, Math.min(1, ch.seatBlend)) : null;
        if (ch.postureSink != null) ch.model.position.y = ch.postureSink;
        else if (blend != null) ch.model.position.y = SL.sink * blend;
        else ch.model.position.y = damp(ch.model.position.y, SL.sink, sr, dt);
        ch._seatSunk = 1;

        /* ---- POSTURE FOLLOWS THE SEAT (CHAR_SEAT_POSTURE) ---------------
           A sofa, a throne, a bar stool and an office chair used to produce
           the IDENTICAL upright pose — the same body, four times, in four
           rooms that were supposed to feel different. Nothing lounged, and
           the deep soft couch a furnisher spent geometry on read exactly like
           a desk chair with the desk deleted.

           The seat already knows what it is: every registration site passes a
           `kind`, propuse.js's SEAT_H keys its cushion heights on it, and
           CBZ.propSeatRef now carries it through to seatRef.kind. So this is
           not new data — it is data that was being thrown away one function
           short of the pose that needed it. CBZ.charSeatPosture (one table,
           declared above, also read by propUseAudit) maps it to a family.

           A kind we don't recognise, a seat that declared none, and every
           anchor npclife's attach() builds (aircraft cabins, arena bowls)
           resolve to null and take the branch below UNCHANGED — the defaults
           here are the exact literals this solve has always used, so the
           airliner row, the desk worker and the typing loop are untouched.
           (`post` is resolved above, before the shared leg solve.) */
        // Per-seat variance, deterministic from the anchor's own coordinates
        // (propSeatRef hashes them) — a row of five sofa-sitters must not read
        // as one body stamped five times. Zero unless a posture claimed the
        // seat, so the default pose stays bit-for-bit what it was.
        const sv = (post && ref.vary != null) ? (ref.vary - 0.5) : 0;
        let leanX = 0.1, sitY = -0.06, slideZ = 0, yawY = 0;
        let armX = -0.34, armZ = 0.12, elb = -0.72, neckX = 0.04;
        if (post === "lounge") {
          // You do not SIT on a couch, you fall back into one: the shoulders
          // pitch ~14° behind the hips, the pelvis slides forward off the
          // backrest by a quarter of its own depth (derived, so a child
          // slouches a child's distance), and the forearms go out to where an
          // armrest is — wider and straighter than hands-on-thighs.
          leanX = -0.24 + sv * 0.06;
          sitY = -0.09;
          slideZ = (pf ? pf.pelvisD : 0.48) * 0.25 * SL.hs;
          armX = -0.20; armZ = 0.30 + sv * 0.05; elb = -0.95;
          neckX = -0.06;                       // head back against the rest
        } else if (post === "throne") {
          // The opposite reading of the same soft chair: a boss chair is worn,
          // not rested in. Spine vertical, both hands claiming the armrests.
          leanX = 0.01 + sv * 0.03;
          armX = -0.30; armZ = 0.34 + sv * 0.04; elb = -1.05;
          neckX = -0.02;
        } else if (post === "stool") {
          // Nothing to lean on, so the spine holds itself up and the forearms
          // find the counter. FEET FIND THE RAIL: a stool that a body's shins
          // cannot reach the floor from is not a body dangling in the air —
          // every counter stool in the world carries a footrail, and the
          // standard one sits at ~40% of the stool's own height. Shortening
          // the hip→sole drop by that much is the whole fix, and it falls out
          // of the declared cushion instead of a new number (the 0.42 lives
          // in CBZ.moves.seatLegs with the rest of the leg solve).
          leanX = 0.06 + sv * 0.04;
          armX = -0.44; armZ = 0.10; elb = -0.90;
        } else if (post === "bench") {
          // A bench is a plank: people perch forward on it and put their
          // elbows toward their knees, which is the difference between
          // waiting and sitting.
          leanX = 0.22 + sv * 0.05;
          armX = -0.52; armZ = 0.16; elb = -1.15;
          neckX = 0.10;
        } else if (post === "bunk") {
          /* THE BOTTOM-BUNK DUCK. A bench-sitter can straighten up whenever he
             likes; a man on a bottom bunk cannot, and every photograph of one
             shows the same body — spine pitched forward, forearms on the
             thighs, head down.

             The lean is SOLVED, not styled, whenever the seat declares what is
             overhead (`ref.ceiling`, the underside of the rack above, in world
             units — world/cellblock.js publishes it as bunk.rackUnder). Pitch
             the hips→crown segment forward by `lean` and the crown drops to
             crown x cos(lean), so the angle that just fits under a ceiling is
             acos(available / crown). Doing it from the body's OWN metric is
             the whole point: a taller inmate ducks further, a child does not
             duck at all, and neither of them has steel through his skull.

             It cannot pay for everything — beyond ~0.62 rad a man is not
             ducking, he is folded over his own knees, which photographs worse
             than the clipping did. Geometry owns the rest of the gap, which is
             why the rack in cellblock.js moved up as well. */
          leanX = 0.34 + sv * 0.05;
          sitY = -0.07;
          armX = -0.58; armZ = 0.13; elb = -1.18;
          neckX = 0.16;                        // looking at the floor, not the wall
          if (ref.ceiling > 0) {
            const met = ch.group && ch.group.userData && ch.group.userData.characterMetric;
            // crown INCLUDING hair — the same +0.15 CBZ.charHeadY hangs
            // nametags on, because the box that clips is the hair box.
            const stand = (met && met.height > 0) ? met.height + 0.15 : 1.97;
            // Crown above the SEATED hip line. Deliberately not
            // (stand - hipYOf x hs): that is the standing hip pivot, and the
            // seat solve has already moved the body onto the cushion — using
            // it measured a 1.30 m torso on a rig whose head actually rides
            // 1.07 m over its own seated hips, and the pose folded a man in
            // half to clear a rack he was 12 cm under.
            const crown = Math.max(0.40, stand - hipF);
            const avail = ref.ceiling - 0.03 - hipF;     // hips → steel, 3 cm of daylight
            const duck = Math.acos(Math.max(0.60, Math.min(1, avail / crown)));
            if (duck > leanX) {
              leanX = Math.min(0.62, duck);
              neckX = 0.16 + (leanX - 0.34) * 0.5;       // the head follows the spine down
            }
          }
        } else if (post === "bunkback" || post === "bunkbrace") {
          /* THE TWO RELAXED READS OF THE SAME MATTRESS.

             `bunkback` is a man sat INTO his bed: hips well down the
             mattress, shoulders on the wall the pillow is under, legs run out
             along the bed instead of hanging off it. `bunkbrace` keeps the
             feet on the concrete but throws the weight back onto straight
             arms planted behind the hips.

             Both lean BACKWARD, which is the whole difference the owner
             asked for — and backward is not a free direction under a steel
             rack, so the duck solve below still runs, only mirrored: the
             crown drops by crown x cos(lean) whichever way the spine goes. */
          const backward = true;
          sitY = post === "bunkback" ? -0.10 : -0.06;
          if (post === "bunkback") {
            leanX = -0.30 + sv * 0.05;
            // arms loose at the sides, forearms fallen into the lap — a
            // relaxed man's elbows stay IN, they do not fly out like a chair
            // with armrests he does not have
            armX = -0.20; armZ = 0.11; elb = -0.78;
            neckX = -0.04;                     // head back, eyes on the ceiling
          } else {
            leanX = -0.22 + sv * 0.05;
            // hands planted on the mattress BEHIND the hips: the arm swings
            // back past the shoulder and the elbow goes nearly straight,
            // which is the silhouette that says "propped up", not "reaching".
            armX = 0.62; armZ = 0.20; elb = -0.10;
            neckX = 0.02;
          }
          if (ref.ceiling > 0) {
            const met = ch.group && ch.group.userData && ch.group.userData.characterMetric;
            const stand = (met && met.height > 0) ? met.height + 0.15 : 1.97;
            const crown = Math.max(0.40, stand - hipF);
            const avail = ref.ceiling - 0.03 - hipF;
            const duck = Math.acos(Math.max(0.60, Math.min(1, avail / crown)));
            if (duck > Math.abs(leanX)) leanX = (backward ? -1 : 1) * Math.min(0.62, duck);
          }
        } else if (post === "drive") {
          // BEHIND A WHEEL. A car seat's backrest is close to vertical, so the
          // spine barely leans; what makes a driver a driver is above the
          // shoulders and in front of the chest — the head stays UP on the
          // road (negative neck pitch, unlike every other seat here, which
          // looks down at a table) and both forearms leave the lap and go OUT
          // and FORWARD to a rim about a shoulder-width ahead. `sv` is
          // deliberately unspent on the torso: a driver with per-seat yaw
          // variance reads as distracted, not as variety.
          leanX = 0.08;
          sitY = -0.05;
          armX = -0.66; armZ = 0.20; elb = -0.80;
          neckX = -0.03;
        }
        if (post) yawY = sv * 0.10;            // a hair of torso yaw, per seat
        ch.model.position.z = damp(ch.model.position.z, slideZ, sr, dt);
        // THE LEGS (CBZ.moves.seatLegs, above): a chair is read by its THIGH
        // line — near level (1.38 rad), the shin lengthened only as far as the
        // floor needs (tall benches/stools dangle; the stool's feet find the
        // rail); a low lounger puts the knees over the hips; a "bunkback" runs
        // the legs down the mattress; a driver reaches for the pedals.
        const th = SL.th, fold = SL.fold, shinScale = SL.shinScale;
        const leanT = leanX + (ch.seatLean || 0);        // + the push of getting up (CBZ.moves)
        if (blend != null) {
          // mid-transition: exactly the fold the sequencer is at (its hip curve
          // and foot plant are computed from these same angles)
          const shinB = CBZ.moves.shinAt ? CBZ.moves.shinAt(SL, blend) : 1 + (shinScale - 1) * blend;
          ch.body.position.y = sitY * blend;
          ch.body.rotation.x = leanX * blend + (ch.seatLean || 0);
          ch.body.rotation.z = damp(ch.body.rotation.z, 0, sr, dt);
          ch.body.rotation.y = damp(ch.body.rotation.y, yawY * blend, sr, dt);
          for (let li = 0; li < 2; li++) {
            const k = LEG_KEYS[li], P = ch.parts[k];
            if (P) { P.rotation.x = -th * blend; P.rotation.z = (k === "ll" ? 0.06 : -0.06) * blend; P.rotation.y = 0; P.scale.y = 1; }
            const Jk = J[k];
            if (Jk) { Jk.rotation.x = Math.max(0, (fold + (k === "ll" ? 0.03 : 0)) * blend); Jk.rotation.y = 0; Jk.rotation.z = 0; Jk.scale.y = shinB; }
          }
        } else {
          ch.body.position.y = damp(ch.body.position.y, sitY, sr, dt);  // small settle, torso stays stacked on the pelvis
          ch.body.rotation.x = damp(ch.body.rotation.x, leanT, sr, dt);
          ch.body.rotation.z = damp(ch.body.rotation.z, 0, sr, dt);
          ch.body.rotation.y = damp(ch.body.rotation.y, yawY, sr, dt);
          if (ch.parts.ll) { ch.parts.ll.rotation.x = damp(ch.parts.ll.rotation.x, -th, sr, dt); ch.parts.ll.rotation.z = damp(ch.parts.ll.rotation.z, 0.06, sr, dt); ch.parts.ll.rotation.y = damp(ch.parts.ll.rotation.y, 0, sr, dt); ch.parts.ll.scale.y = damp(ch.parts.ll.scale.y, 1, sr, dt); }
          if (ch.parts.rl) { ch.parts.rl.rotation.x = damp(ch.parts.rl.rotation.x, -th, sr, dt); ch.parts.rl.rotation.z = damp(ch.parts.rl.rotation.z, -0.06, sr, dt); ch.parts.rl.rotation.y = damp(ch.parts.rl.rotation.y, 0, sr, dt); ch.parts.rl.scale.y = damp(ch.parts.rl.scale.y, 1, sr, dt); }
          setKnee(J.ll, fold + 0.03, sr); setKnee(J.rl, fold, sr);       // hair of asymmetry so rows don't read cloned
          if (J.ll) J.ll.scale.y = damp(J.ll.scale.y, shinScale, sr, dt);
          if (J.rl) J.rl.scale.y = damp(J.rl.scale.y, shinScale, sr, dt);
        }
        ch._seatShinScaled = !!((J.ll && Math.abs(J.ll.scale.y - 1) > 0.001) ||
          (J.rl && Math.abs(J.rl.scale.y - 1) > 0.001));
        // forearms rest on the thighs/armrests (same relaxed carry as legacy;
        // armX/armZ/elb are the untouched literals unless a posture claimed
        // this seat — an armrest pushes them out and straightens the elbow,
        // a bench pulls them in over the knees).
        // STEERING. `ch.driveSteer` (-1 hard left .. +1 hard right) is written
        // by whoever owns the wheel; it modulates the two ABSOLUTE arm targets
        // in opposite directions — one hand climbs the rim while the other
        // drops — exactly the way ch.typing modulates the desk pose. Because
        // every write below is still a damp toward an absolute value, entering
        // or leaving the seat mid-turn can never accumulate. Zero for every
        // posture that is not "drive", so those are byte-identical.
        const stw = (post === "drive" && ch.driveSteer)
          ? Math.max(-1, Math.min(1, +ch.driveSteer || 0)) : 0;
        if (ch.parts.la) { ch.parts.la.rotation.x = damp(ch.parts.la.rotation.x, armX - stw * 0.18, sr, dt); ch.parts.la.rotation.z = damp(ch.parts.la.rotation.z, armZ + (ch.armWear || 0) + stw * 0.10, sr, dt); ch.parts.la.rotation.y = damp(ch.parts.la.rotation.y, 0, sr, dt); ch.parts.la.position.z = damp(ch.parts.la.position.z, SEAT_PROTRACT, sr, dt); }
        if (ch.parts.ra) { ch.parts.ra.rotation.x = damp(ch.parts.ra.rotation.x, armX + stw * 0.18, sr, dt); ch.parts.ra.rotation.z = damp(ch.parts.ra.rotation.z, -armZ - (ch.armWear || 0) + stw * 0.10, sr, dt); ch.parts.ra.rotation.y = damp(ch.parts.ra.rotation.y, 0, sr, dt); ch.parts.ra.position.z = damp(ch.parts.ra.position.z, SEAT_PROTRACT, sr, dt); }
        setElbow(J.la, elb - stw * 0.10, sr); setElbow(J.ra, elb + stw * 0.10, sr);
        if (ch.neck) { ch.neck.rotation.x = damp(ch.neck.rotation.x, neckX, sr, dt); ch.neck.rotation.z = damp(ch.neck.rotation.z, 0, sr, dt); }
        lockCharacterHips(ch);
        return;   // seated pose owns the whole rig
      }
      ch.body.position.y = damp(ch.body.position.y, -0.6, sr, dt);     // hips drop into the chair
      ch.body.rotation.x = damp(ch.body.rotation.x, 0.14, sr, dt);     // slight working lean
      ch.body.rotation.z = damp(ch.body.rotation.z, 0, sr, dt);
      ch.body.rotation.y = damp(ch.body.rotation.y, 0, sr, dt);
      // thighs fold forward, shins hang to the floor (real knees now)
      if (ch.parts.ll) { ch.parts.ll.rotation.x = damp(ch.parts.ll.rotation.x, -1.3, sr, dt); ch.parts.ll.rotation.z = damp(ch.parts.ll.rotation.z, 0.06, sr, dt); ch.parts.ll.rotation.y = damp(ch.parts.ll.rotation.y, 0, sr, dt); ch.parts.ll.scale.y = damp(ch.parts.ll.scale.y, 1, sr, dt); }
      if (ch.parts.rl) { ch.parts.rl.rotation.x = damp(ch.parts.rl.rotation.x, -1.3, sr, dt); ch.parts.rl.rotation.z = damp(ch.parts.rl.rotation.z, -0.06, sr, dt); ch.parts.rl.rotation.y = damp(ch.parts.rl.rotation.y, 0, sr, dt); ch.parts.rl.scale.y = damp(ch.parts.rl.scale.y, 1, sr, dt); }
      setKnee(J.ll, 1.42, sr); setKnee(J.rl, 1.38, sr);
      if (J.ll) J.ll.scale.y = damp(J.ll.scale.y, 1, sr, dt);
      if (J.rl) J.rl.scale.y = damp(J.rl.scale.y, 1, sr, dt);
      ch._seatShinScaled = !!((J.ll && Math.abs(J.ll.scale.y - 1) > 0.001) ||
        (J.rl && Math.abs(J.rl.scale.y - 1) > 0.001));
      // forearms rest toward the desktop — and a WORKING seat (ch.typing, set
      // only by the desk-sit paths) actually TYPES: a small alternating
      // forearm tap + a touch more head-down focus. Pure target modulation:
      // every write stays a damp toward an absolute pose, so entering/leaving
      // the loop can never accumulate (the grapple brace-pose lesson).
      const tw = ch.typing ? Math.sin(ch.breath * 9) * 0.055 : 0;
      if (ch.parts.la) { ch.parts.la.rotation.x = damp(ch.parts.la.rotation.x, -0.34 + tw, sr, dt); ch.parts.la.rotation.z = damp(ch.parts.la.rotation.z, 0.12, sr, dt); ch.parts.la.rotation.y = damp(ch.parts.la.rotation.y, 0, sr, dt); ch.parts.la.position.z = damp(ch.parts.la.position.z, SEAT_PROTRACT, sr, dt); }
      if (ch.parts.ra) { ch.parts.ra.rotation.x = damp(ch.parts.ra.rotation.x, -0.34 - tw, sr, dt); ch.parts.ra.rotation.z = damp(ch.parts.ra.rotation.z, -0.12, sr, dt); ch.parts.ra.rotation.y = damp(ch.parts.ra.rotation.y, 0, sr, dt); ch.parts.ra.position.z = damp(ch.parts.ra.position.z, SEAT_PROTRACT, sr, dt); }
      setElbow(J.la, -0.72 - tw, sr); setElbow(J.ra, -0.72 + tw, sr);
      if (ch.neck) { ch.neck.rotation.x = damp(ch.neck.rotation.x, ch.typing ? 0.11 : 0.04, sr, dt); ch.neck.rotation.z = damp(ch.neck.rotation.z, 0, sr, dt); }
      lockCharacterHips(ch);
      return;   // seated pose owns the whole rig
    }
    // seat-sink blend-out: the V2 chair sit above owns model.position.y/z while
    // seated and nothing else ever writes those channels — recover them here (a
    // few frames of damp) the moment the actor stands, so a vacated seat can't
    // leave a rig walking around sunk into the ground. Armed only by the V2
    // sit; every other rig skips at one falsy check inside the helper.
    refundSeatSolve(ch, J, dt, 10);
    if (ch.typing) ch.typing = false;   // typing exists only while seated (stale-flag guard)

    // ---- OBSTACLE TRAVERSAL (systems/physics.js) -------------------------
    // The physics owner supplies only {kind, style, t}: this canonical animator
    // turns that one shared state into the pose for the player AND every full-rig
    // NPC. The world trajectory already puts the root over the obstacle; these
    // writes make the body explain HOW it got there — hands find the top, elbows
    // load, hips follow, and the legs either scissor over or tuck through.
    //
    // Every target is absolute and this branch owns the full rig, like seated /
    // slide / prone. That makes interruption safe and prevents a vault pose from
    // accumulating onto the next walk cycle.
    if (ch.traversePose) {
      const tp = ch.traversePose;
      const u = clamp01(tp.t || 0);
      // how much each hand is ON the obstacle this frame (traversePlants)
      const plantW = _plantW; plantW.l = 0; plantW.r = 0;
      let travPivotY = 0;              // the spin's hip pivot (model.position.y before any drop)
      const air = Math.sin(Math.PI * u);
      const sr = 18;
      const limb = (part, x, y, z, pz) => {
        if (!part) return;
        part.rotation.x = damp(part.rotation.x, x, sr, dt);
        part.rotation.y = damp(part.rotation.y, y || 0, sr, dt);
        part.rotation.z = damp(part.rotation.z, z || 0, sr, dt);
        part.position.z = damp(part.position.z, pz || 0, sr, dt);
        part.scale.y = damp(part.scale.y, 1, sr, dt);
      };
      ch.body.position.z = damp(ch.body.position.z, 0, sr, dt);
      ch.body.rotation.y = damp(ch.body.rotation.y, 0, sr, dt);

      if (tp.kind === "through") {
        /* ---- THREADING AN APERTURE (physics.js kind "through") -------------
           The trajectory has already pinned the root inside the hole. What the
           pose has to explain is that the body CHOSE a shape small enough to
           fit — because that is the whole difference between this and a vault,
           and the reason the owner could see that the old move was wrong: a
           man does not go through a window in the shape he walks in.

           Two silhouettes, and they are not the same move at two sizes:

           "dive"  arms spear FORWARD, chest pitches down toward horizontal,
                   legs trail and snap through last. Superman through the
                   frame. The pitch is the pose — everything else follows it.
           "step"  upright but compressed: one thigh drives high to clear the
                   sill, the head ducks under the header, a hand rides the
                   frame for balance. A tall doorway with a knee-high lip.

           Beats: 0..0.24 gather (the commitment), 0.24..0.72 pass (the shape
           is held — this is the stretch physics has pinned to the aperture, so
           it must not be animating through it), 0.72..1 emerge and reach for
           the floor. */
        const dive = tp.gapStyle !== "step";
        const gather = smoother01(u / 0.24);
        const emerge = smoother01((u - 0.68) / 0.32);
        // held through the middle: full commitment, then unwound on the way out
        const shape = Math.max(0, gather - emerge);
        /* ---- THE POSE HAS TO AGREE WITH THE ARITHMETIC ---------------------
           physics.js checked this hole against a HORIZONTAL body: 0.58 m tall,
           its bottom at the sill line. If the animator only pitches `ch.body`
           (the torso, hinged at the hips) then the legs stay standing, the rig
           is still 1.82 m tall, and the drawn body goes straight through the
           header the fit check just proved it cleared. A jackknifed torso over
           vertical legs is not a dive.

           So the DIVE lays the whole rig down, and it needs the same pivot
           trick the landing roll needs and for the same reason: `model`'s
           origin is at the FEET, so pitching it alone swings the head through
           the floor. Rotating about a point P is R plus the translation
           P - R*P; carrying one extra -P puts the body's own centre line ON
           the root instead of above it, which is what makes "the root is at
           passY" and "the body's envelope starts at passY" the same statement.
           `lay` is offset so the envelope sits just inside the 0.58 m the
           aperture was measured against, not straddling it. */
        if (dive) {
          const theta = 1.45 * shape;                 // ~83 deg: committed, not quite flat
          const h = Math.max(0.55, ((ch.metric && ch.metric.height) || 1.82) * 0.50);
          // The envelope physics.js actually measured this hole against, not a
          // second copy of the number (tp.passH; see its note in physics.js).
          const lay = (tp.passH || 0.58) * 0.5;       // centre the envelope over the sill
          if (ch.model) {
            ch.model.rotation.x = theta;
            ch.model.rotation.y = 0;
            ch.model.rotation.z = 0.10 * shape;
            if (!ch._seatSunk) {
              ch.model.position.y = -h * Math.cos(theta) + lay * shape;
              ch.model.position.z = -h * Math.sin(theta);
            }
          }
          // The torso adds only the last few degrees on top of the lay-out —
          // a chest lifted slightly against the dive line, which is what a
          // person actually does to see the landing.
          ch.body.position.y = damp(ch.body.position.y, -0.06 * shape, sr, dt);
          ch.body.rotation.x = damp(ch.body.rotation.x, -0.22 * shape + 0.18 * emerge, sr, dt);
          ch.body.rotation.z = damp(ch.body.rotation.z, 0.06 * shape, sr, dt);
          // Both arms spear ahead of the head, elbows nearly locked — the arms
          // are the leading edge of the body's cross-section, not a balance aid.
          limb(ch.parts.la, -0.30 - 2.30 * shape, 0.06, -0.14 - 0.10 * shape, 0.18 * shape);
          limb(ch.parts.ra, -0.30 - 2.30 * shape, -0.06, 0.14 + 0.10 * shape, 0.18 * shape);
          setElbow(J.la, -0.10 - 0.10 * shape, sr);
          setElbow(J.ra, -0.10 - 0.10 * shape, sr);
          // Legs trail straight behind, then whip through as the hips clear.
          const trail = Math.max(0, shape - emerge * 0.4);
          const snap = smoother01((u - 0.74) / 0.26);
          limb(ch.parts.ll, 0.60 * trail - 1.30 * snap, 0, 0.07, 0);
          limb(ch.parts.rl, 0.52 * trail - 1.10 * snap, 0, -0.07, 0);
          setKnee(J.ll, 0.16 + 0.34 * trail + 1.05 * snap, sr);
          setKnee(J.rl, 0.20 + 0.42 * trail + 0.88 * snap, sr);
          if (ch.neck) {
            // Chin tucks going in (protect the head, see the landing), lifts on
            // the way out to find the floor.
            ch.neck.rotation.x = damp(ch.neck.rotation.x, 0.30 * shape - 0.46 * emerge, sr, dt);
            ch.neck.rotation.z = damp(ch.neck.rotation.z, 0, sr, dt);
          }
        } else {
          /* AND A STEP HAS TO ACTUALLY DUCK. physics.js measured this opening
             against height * 0.78 (1.42 m on an adult), so the rig has to lose
             ~0.40 m of stature or the drawn head is inside the lintel — the
             same disagreement the dive above has to avoid, in the upright
             case. Folding the knees does NOT do it in this rig: the legs hang
             off `model` and the hip socket never moves, so bending them
             changes the silhouette without lowering the head by a millimetre.
             ch.body.position.y is the only channel that shortens the body,
             which is why the number here is large and the leg drive below is
             expression rather than height. */
          ch.body.position.y = damp(ch.body.position.y, -0.42 * shape, sr, dt);
          ch.body.rotation.x = damp(ch.body.rotation.x, 0.50 * shape, sr, dt);
          ch.body.rotation.z = damp(ch.body.rotation.z, -0.12 * shape, sr, dt);
          // Lead hand on the frame, trailing arm tucked in past the jamb.
          limb(ch.parts.la, -0.34 - 1.30 * shape, 0.20, -0.44 * shape, 0.14 * shape);
          limb(ch.parts.ra, -0.22 - 0.44 * shape, -0.14, 0.30 * shape, 0.04);
          setElbow(J.la, -0.30 - 0.44 * shape, sr);
          setElbow(J.ra, -0.44 - 0.30 * shape, sr);
          // Lead thigh drives high over the sill; the trail leg follows late.
          const follow = smoother01((u - 0.52) / 0.34);
          limb(ch.parts.ll, -0.16 - 1.46 * shape + 1.10 * follow, 0, 0.10, 0);
          limb(ch.parts.rl, -0.12 - 0.42 * shape - 0.86 * follow, 0, -0.10, 0);
          setKnee(J.ll, 0.10 + 1.52 * shape - 1.00 * follow, sr);
          setKnee(J.rl, 0.10 + 0.34 * shape + 1.18 * follow, sr);
          if (ch.neck) {
            ch.neck.rotation.x = damp(ch.neck.rotation.x, 0.34 * shape, sr, dt);   // duck under the header
            ch.neck.rotation.z = damp(ch.neck.rotation.z, 0, sr, dt);
          }
        }
        // The dive owns ch.model above (it is the only thing that can make the
        // rig actually horizontal); a step stays upright, so settle it.
        if (!dive && ch.model) {
          ch.model.rotation.x = damp(ch.model.rotation.x, 0, sr, dt);
          ch.model.rotation.y = damp(ch.model.rotation.y, 0, sr, dt);
          ch.model.rotation.z = damp(ch.model.rotation.z, 0, sr, dt);
          if (!ch._seatSunk) {
            ch.model.position.y = damp(ch.model.position.y, 0, sr, dt);
            ch.model.position.z = damp(ch.model.position.z, 0, sr, dt);
          }
        }
      } else if (tp.kind === "mantle") {
        // Reach → hang → pull → press-out. The old fixed -2.4rad shoulder target
        // pointed both arms almost vertically above the head. Here `hold`
        // blends into a real two-link solve against physics.js's near ledge.
        const reach = smoother01(u / 0.24);
        const release = 1 - smoother01((u - 0.48) / 0.18);
        const hold = Math.max(0, reach * release);
        const pull = Math.sin(Math.PI * smoother01((u - 0.18) / 0.70));
        ch.body.position.y = damp(ch.body.position.y, -0.11 * hold + 0.05 * pull, sr, dt);
        // Positive pitch is toward +Z/the ledge: chest follows the planted
        // hands instead of hanging back while the arms point skyward.
        ch.body.rotation.x = damp(ch.body.rotation.x, 0.10 * hold + 0.12 * pull, sr, dt);
        ch.body.rotation.z = damp(ch.body.rotation.z, 0.06 * Math.sin(u * Math.PI * 2) * pull, sr, dt);
        // The arms reach UP for the lip (the authored beat), then the plant
        // solve at the end of this branch takes each hand onto it for real.
        const press = smoother01((u - 0.48) / 0.28) *
          (1 - smoother01((u - 0.80) / 0.18));
        const armRest = -0.20 - 0.32 * press;
        limb(ch.parts.la, armRest - 1.60 * reach * release, 0.05, -0.10, 0.04 * hold);
        limb(ch.parts.ra, armRest - 1.60 * reach * release, -0.05, 0.10, 0.04 * hold);
        setElbow(J.la, -0.18 - 0.60 * hold, sr);
        setElbow(J.ra, -0.18 - 0.60 * hold, sr);
        // the hands stay on the top through the pull AND the press-out, for as
        // long as the arms can reach it (traversePlants gates on reach)
        plantW.l = plantW.r = smoother01(u / 0.20) * (1 - smoother01((u - 0.70) / 0.16));
        // One knee drives high first, the other leg trails and then switches —
        // the asymmetry is the difference between hauling a body up and levitating.
        const switchLeg = smooth01((u - 0.52) / 0.34);
        limb(ch.parts.ll, -0.10 - pull * (1.18 - switchLeg * 0.48), 0, 0.08, 0);
        limb(ch.parts.rl, -0.08 - pull * (0.58 + switchLeg * 0.54), 0, -0.08, 0);
        setKnee(J.ll, 0.08 + pull * (1.18 - switchLeg * 0.52), sr);
        setKnee(J.rl, 0.08 + pull * (0.62 + switchLeg * 0.56), sr);
        if (ch.model) {
          ch.model.rotation.x = damp(ch.model.rotation.x, 0, sr, dt);
          ch.model.rotation.y = damp(ch.model.rotation.y, 0, sr, dt);
          ch.model.rotation.z = damp(ch.model.rotation.z, 0, sr, dt);
        }
        if (ch.neck) {
          ch.neck.rotation.x = damp(ch.neck.rotation.x, -0.18 * hold, sr, dt);
          ch.neck.rotation.z = damp(ch.neck.rotation.z, 0, sr, dt);
        }
      } else {
        // Low/medium obstacles use a small style vocabulary. Physics alternates
        // controlled styles for ordinary Jump and lets sprint momentum unlock
        // the spy spin. All three plant at least one hand, but the hips/legs
        // carry a different silhouette.
        const plant = Math.sin(Math.PI * clamp01((u - 0.03) / 0.88));
        const tuck = Math.sin(Math.PI * clamp01((u - 0.12) / 0.82));
        if (tp.style === "kong") {
          // a kong DIVES at its hands: chest down over them (positive pitch is
          // toward the move — the old -0.50 threw the chest BACK off the plant)
          // The torso goes nearly flat over the hands (a real kong has the
          // shoulders over the plant and the hips high behind them) and the
          // knees come right up to the chest so the feet pass between the hands.
          ch.body.position.y = damp(ch.body.position.y, -0.10 * plant, sr, dt);
          ch.body.rotation.x = damp(ch.body.rotation.x, 1.10 * plant, sr, dt);
          plantW.l = plantW.r = plant;
          ch.body.rotation.z = damp(ch.body.rotation.z, 0, sr, dt);
          limb(ch.parts.la, -0.18 - 1.20 * plant, 0.08, -0.16, 0.16 * plant);
          limb(ch.parts.ra, -0.18 - 1.20 * plant, -0.08, 0.16, 0.16 * plant);
          setElbow(J.la, -0.18 - plant * 0.34, sr);
          setElbow(J.ra, -0.18 - plant * 0.34, sr);
          // legs TRAIL while the hands take the weight (a dive: hips high,
          // feet behind), then the knees snap through between the hands
          const trail = Math.sin(Math.PI * clamp01((u - 0.08) / 0.46));
          const thru = Math.sin(Math.PI * clamp01((u - 0.36) / 0.56));
          limb(ch.parts.ll, 0.45 * trail - 0.12 - thru * 1.85, 0, 0.11, 0);
          limb(ch.parts.rl, 0.40 * trail - 0.12 - thru * 1.85, 0, -0.11, 0);
          setKnee(J.ll, 0.08 + 0.55 * trail + thru * 2.20, sr);
          setKnee(J.rl, 0.08 + 0.65 * trail + thru * 2.20, sr);
        } else if (tp.style === "spin") {
          // Sprint-only spy vault: spend the opening beat reaching/planting,
          // ease through one full revolution, then leave a recovery beat before
          // landing. Quintic easing has zero angular acceleration at each end,
          // so the roll reads as a deliberate body move rather than a transform
          // snapping through 360 degrees.
          const spinPhase = smoother01((u - 0.08) / 0.80);
          const handPlant = Math.sin(Math.PI * clamp01((u - 0.01) / 0.40)) *
            (u < 0.41 ? 1 : 0);
          const commit = smoother01(u / 0.20);
          ch.body.position.y = damp(ch.body.position.y, -0.13 * air, sr, dt);
          ch.body.rotation.x = damp(ch.body.rotation.x, -0.16 * air, sr, dt);
          ch.body.rotation.z = damp(ch.body.rotation.z, -0.12 * air, sr, dt);
          limb(ch.parts.la, -0.22 - 1.38 * handPlant, 0.18, -0.34 - 0.46 * air, 0.12 * handPlant);
          plantW.l = handPlant;
          limb(ch.parts.ra, -0.24 - 0.56 * air, -0.18, 0.66 + 0.24 * air, 0.04);
          setElbow(J.la, -0.24 - handPlant * 0.48, sr);
          setElbow(J.ra, -0.32 - air * 0.42, sr);
          limb(ch.parts.ll, -0.16 - tuck * 0.82, 0, 0.18, 0);
          limb(ch.parts.rl, -0.12 - tuck * 1.02, 0, -0.18, 0);
          setKnee(J.ll, 0.10 + tuck * 1.02, sr);
          setKnee(J.rl, 0.10 + tuck * 1.28, sr);
          if (ch.model) {
            ch.model.rotation.x = -0.08 * air * commit;
            ch.model.rotation.y = 0.08 * air * commit;
            ch.model.rotation.z = -Math.PI * 2 * spinPhase;
            /* ABOUT THE HIPS. `model`'s origin is at the FEET, so a roll of it
               alone swung the whole body round the soles — the head went
               through the obstacle and the ground on the way round (pelvis
               52 cm inside the wall: tools/traverse-hands-check.mjs). Rotating
               about P is R plus P - R*P; P is the hip socket. */
            const hs = hipYOf(ch) * (ch.model.scale.y || 1);
            _spinP.set(0, hs, 0).applyEuler(ch.model.rotation);
            ch.model.position.x = -_spinP.x;
            ch.model.position.z = -_spinP.z;
            travPivotY = hs - _spinP.y;
          }
        } else {
          // One-hand speed vault: plant left, throw the opposite arm back, split
          // the legs sideways and let the hips skim the obstacle.
          // The torso tips onto the planted (left) arm — that arm is what the
          // body pivots over — and leans back a little as the legs go through.
          ch.body.position.y = damp(ch.body.position.y, -0.12 * plant, sr, dt);
          ch.body.rotation.x = damp(ch.body.rotation.x, -0.30 * plant, sr, dt);
          ch.body.rotation.z = damp(ch.body.rotation.z, -0.72 * plant, sr, dt);
          limb(ch.parts.la, -0.18 - 1.66 * plant, 0.10, -0.42, 0.16 * plant);
          plantW.l = plant;
          limb(ch.parts.ra, 0.36 * air, -0.16, 0.72 * air, 0);
          setElbow(J.la, -0.16 - plant * 0.26, sr);
          setElbow(J.ra, -0.38 - air * 0.18, sr);
          // the legs come UP to hip height and swing across the top beside
          // the planted hand (lead leg long, trail leg folded under it)
          limb(ch.parts.ll, -0.18 - tuck * 1.30, 0.18, 0.58 * air, 0);
          limb(ch.parts.rl, -0.14 - tuck * 1.45, -0.12, -0.24 * air, 0);
          setKnee(J.ll, 0.08 + tuck * 0.55, sr);
          setKnee(J.rl, 0.08 + tuck * 1.35, sr);
        }
        if (tp.style !== "spin" && ch.model) {
          ch.model.rotation.x = damp(ch.model.rotation.x, 0, sr, dt);
          ch.model.rotation.y = damp(ch.model.rotation.y, 0, sr, dt);
          ch.model.rotation.z = damp(ch.model.rotation.z, 0, sr, dt);
          ch.model.position.x = damp(ch.model.position.x, 0, sr, dt);
          ch.model.position.z = damp(ch.model.position.z, 0, sr, dt);
        }
        if (ch.neck) {
          // eyes on the landing: a chest pitched flat over a kong lifts the chin
          ch.neck.rotation.x = damp(ch.neck.rotation.x, -0.16 * air - (tp.style === "kong" ? 0.70 * plant : 0), sr, dt);
          ch.neck.rotation.z = damp(ch.neck.rotation.z, tp.style === "spin" ? 0.12 * air : 0, sr, dt);
        }
      }
      ch.bob = ch.body.position.y;
      ch.lean = ch.body.rotation.x;
      ch.sway = ch.body.rotation.z;
      ch._stanceNk = 1;                 // reuse the proven full-pose neck recovery
      ch._traverseRecover = 1;
      lockCharacterHips(ch);
      // THE HANDS GO ON THE OBSTACLE (after the hip lock: the shoulders are final)
      if (tp.kind !== "through") { traversePlants(ch, tp, plantW, true, travPivotY); ch._planted = 1; }
      return;
    }
    if (ch._planted) {
      // the move is over: the palms come off whatever they were on
      ch._planted = 0;
      if (CBZ.charArmTo && CBZ.charArmTo.plantRelease) CBZ.charArmTo.plantRelease(ch, "both");
    }
    // The model node is normally scale-only. A spy vault temporarily rolls it
    // and a landing roll pitches AND offsets it (see the pivot note below);
    // settle every channel either of them can touch after any natural finish or
    // interruption, before gait takes over. Most frames pay one falsy branch.
    if (ch._traverseRecover && ch.model) {
      const m = ch.model;
      m.rotation.x = damp(m.rotation.x, 0, 16, dt);
      m.rotation.y = damp(m.rotation.y, 0, 16, dt);
      m.rotation.z = damp(m.rotation.z, 0, 16, dt);
      if (!ch._seatSunk) {
        m.position.y = damp(m.position.y, 0, 16, dt);
        m.position.z = damp(m.position.z, 0, 16, dt);
      }
      if (Math.abs(m.rotation.x) + Math.abs(m.rotation.y) + Math.abs(m.rotation.z) +
          Math.abs(m.position.y) + Math.abs(m.position.z) < 0.01) {
        m.rotation.set(0, 0, 0);
        if (!ch._seatSunk) { m.position.y = 0; m.position.z = 0; }
        ch._traverseRecover = 0;
      }
    }

    /* ---- THE LANDING (systems/physics.js armLanding) -----------------------
       OWNER: "real parkour jumping, catching self, LANDING, catching edge".

       Physics hands over a budget — `hard` 0..1 for how much vertical energy
       arrived, and `roll` for whether the body had the forward line to convert
       it. This runs the clock itself, the same way `_traverseRecover` does, so
       no updater has to exist for an NPC that never lands.

       Owns the whole rig like every other full-body pose here, and outranks the
       air pose below (you have touched down) while yielding to traversePose
       above (a vault landing that flows straight into another vault should keep
       vaulting). */
    if (ch.landPose) {
      const lp = ch.landPose;
      lp.t += dt;
      const q = clamp01(lp.t / (lp.dur || 0.34));
      if (q >= 1) {
        ch.landPose = null;
        /* A COMPLETED REVOLUTION IS VISUALLY ZERO, AND MUST BE STORED AS ZERO.
           The roll finishes at rotation.x = 2π; handing that to the recovery
           damp would spend the next quarter-second numerically unwinding a
           full turn the body has already made — the rig would rotate BACKWARDS
           through 360° after landing. clearTraversalPose learned this from the
           spy vault; the same rule applies here, plus the pivot offset, which
           returns to zero on its own at 2π and is only assigned explicitly for
           the same reason. */
        if (ch.model) {
          ch.model.rotation.set(0, 0, 0);
          if (!ch._seatSunk) { ch.model.position.y = 0; ch.model.position.z = 0; }
        }
        ch._stanceNk = 1;                        // let the neck recover into gait
      } else {
        const sr = 20;
        const limb = (part, x, y, z, pz) => {
          if (!part) return;
          part.rotation.x = damp(part.rotation.x, x, sr, dt);
          part.rotation.y = damp(part.rotation.y, y || 0, sr, dt);
          part.rotation.z = damp(part.rotation.z, z || 0, sr, dt);
          part.position.z = damp(part.position.z, pz || 0, sr, dt);
          part.scale.y = damp(part.scale.y, 1, sr, dt);
        };
        ch.body.position.z = damp(ch.body.position.z, 0, sr, dt);
        ch.body.rotation.y = damp(ch.body.rotation.y, 0, sr, dt);
        if (lp.roll) {
          /* A FORWARD ROLL AROUND A PIVOT THE RIG DOES NOT HAVE.
             `model`'s origin sits at the FEET (makeCharacter stacks the legs up
             from y=0), so pitching it through 2π would swing the head a full
             body-length UNDER the floor. A roll pivots at the body's centre, so
             synthesize that pivot: rotating about a point P is the rotation plus
             the translation P - R·P, which for P = (0,h,0) about local X is
             exactly (0, h - h·cosθ, -h·sinθ). h is the radius of a tucked
             adult ball, so the body rolls over the ground instead of through it,
             and both compensation terms return to zero at θ = 2π on their own.
             (The shipped spy-spin gets away with a feet pivot because its root
             is already lifted over an obstacle; a landing's is not.) */
          const spin = 1 - Math.pow(1 - q, 2.2);   // arrives with angular momentum, loses it
          const theta = Math.PI * 2 * spin;
          const h = 0.52;
          if (ch.model) {
            ch.model.rotation.x = theta;
            ch.model.rotation.y = 0;
            ch.model.rotation.z = 0;
            if (!ch._seatSunk) {
              ch.model.position.y = h - h * Math.cos(theta);
              ch.model.position.z = -h * Math.sin(theta);
            }
          }
          // Inside the roll the body is a BALL: knees to chest, arms wrapped
          // in, chin tucked to the sternum. Anything extended would be the
          // limb that catches the ground and stops the rotation dead.
          const ball = Math.sin(Math.PI * clamp01((q - 0.04) / 0.86));
          ch.body.position.y = damp(ch.body.position.y, -0.34 * ball, sr, dt);
          ch.body.rotation.x = damp(ch.body.rotation.x, 0.52 * ball, sr, dt);
          ch.body.rotation.z = damp(ch.body.rotation.z, 0.10 * ball, sr, dt);
          limb(ch.parts.la, -0.52 - 0.90 * ball, 0.22, -0.50 * ball, 0.12 * ball);
          limb(ch.parts.ra, -0.52 - 0.90 * ball, -0.22, 0.50 * ball, 0.12 * ball);
          setElbow(J.la, -1.32 * ball - 0.20, sr);
          setElbow(J.ra, -1.32 * ball - 0.20, sr);
          limb(ch.parts.ll, -0.20 - 1.62 * ball, 0, 0.12, 0);
          limb(ch.parts.rl, -0.16 - 1.50 * ball, 0, -0.12, 0);
          setKnee(J.ll, 0.10 + 1.86 * ball, sr);
          setKnee(J.rl, 0.10 + 1.74 * ball, sr);
          if (ch.neck) {
            ch.neck.rotation.x = damp(ch.neck.rotation.x, 0.52 * ball, sr, dt);
            ch.neck.rotation.z = damp(ch.neck.rotation.z, 0, sr, dt);
          }
        } else {
          /* ABSORB. One compression and one recovery — the knees and hips do
             the work, the arms come out and forward for balance, and the depth
             is the ENERGY, so a hop barely registers and a two-storey drop
             puts a hand near the floor. */
          const dip = Math.sin(Math.PI * clamp01(q / 0.92));
          const load = dip * (0.34 + 0.66 * lp.hard);
          ch.body.position.y = damp(ch.body.position.y, -0.46 * load, sr, dt);
          ch.body.rotation.x = damp(ch.body.rotation.x, 0.40 * load, sr, dt);
          ch.body.rotation.z = damp(ch.body.rotation.z, 0.05 * load, sr, dt);
          // Arms swing forward-out as a counterweight to the falling hips.
          limb(ch.parts.la, -0.20 - 0.96 * load, 0.10, -0.34 - 0.30 * load, 0.10 * load);
          limb(ch.parts.ra, -0.20 - 0.96 * load, -0.10, 0.34 + 0.30 * load, 0.10 * load);
          setElbow(J.la, -0.30 - 0.44 * load, sr);
          setElbow(J.ra, -0.30 - 0.44 * load, sr);
          // Thighs fold and the shins stay under the mass — a deep landing is a
          // squat, not a kneel, so the knee leads the hip.
          limb(ch.parts.ll, -0.14 - 0.92 * load, 0, 0.10, 0);
          limb(ch.parts.rl, -0.12 - 0.86 * load, 0, -0.10, 0);
          setKnee(J.ll, 0.08 + 1.62 * load, sr);
          setKnee(J.rl, 0.08 + 1.54 * load, sr);
          if (ch.neck) {
            ch.neck.rotation.x = damp(ch.neck.rotation.x, -0.10 * load, sr, dt);
            ch.neck.rotation.z = damp(ch.neck.rotation.z, 0, sr, dt);
          }
        }
        ch.bob = ch.body.position.y;
        ch.lean = ch.body.rotation.x;
        ch.sway = ch.body.rotation.z;
        ch._stanceNk = 1;
        lockCharacterHips(ch);
        return;
      }
    }

    /* ---- WHAT A BODY LOOKS LIKE IN THE AIR --------------------------------
       OWNER: "…what I look like in air, etc etc."

       There was no answer to that. animChar's only altitude-aware line in the
       whole file was the parachute canopy: an ordinary jump kept the walk cycle
       running, so a body crossing a rooftop gap strode through the air on
       nothing and landed mid-stride. Every full-body state here is a flag on
       the rig, and systems/physics.js publishes this one the same way.

       Three beats read off the actual velocity, not off a timer, so the pose is
       always telling the truth about what the body is doing:

         RISE   drive: hips extended from the push-off, arms thrown up and
                forward, trailing knee folding up under the body.
         APEX   the shape people recognise from a photograph — legs split, one
                knee high, arms wide, chest tall.
         FALL   prepare: both legs reach down and slightly forward to find the
                ground, knees soft and ready to fold, arms out and a little
                back, eyes down.

       Deliberately below traversePose and landPose (both of those own their
       own airborne stretch and must win) and above the stance poses, which
       cannot be true while the feet are off the ground. */
    /* …and it yields to every pose that OWNS the body for a different reason.
       updatePlayer returns early on a knockdown, a swim and a flown aircraft
       without ever reaching the branch that clears this flag, so a body that
       left the ground and then got dropped could otherwise carry a stale air
       pose over the top of its own KO. Cheapest correct guard: the states that
       cannot be true in mid-air are the states that outrank being in mid-air. */
    if (ch.airPose && !ch.pronePose && !ch.slidePose && !ch.sitting && !ch.cuffed) {
      const air = ch.airPose;
      const rise = clamp01(air.rise || 0);
      const fall = clamp01(air.fall || 0);
      const apex = clamp01(1 - rise - fall);
      // Ease IN over the first fraction of a second so leaving the ground is a
      // push-off and not a snap into a new pose. Nothing eases out: the pose is
      // replaced wholesale by landPose the frame the feet touch.
      const enter = smooth01((air.t || 0) / 0.16);
      const sr = 12;
      const limb = (part, x, y, z, pz) => {
        if (!part) return;
        part.rotation.x = damp(part.rotation.x, x, sr, dt);
        part.rotation.y = damp(part.rotation.y, y || 0, sr, dt);
        part.rotation.z = damp(part.rotation.z, z || 0, sr, dt);
        part.position.z = damp(part.position.z, pz || 0, sr, dt);
        part.scale.y = damp(part.scale.y, 1, sr, dt);
      };
      const g = enter;                                   // gate every amplitude
      ch.body.position.z = damp(ch.body.position.z, 0, sr, dt);
      ch.body.rotation.y = damp(ch.body.rotation.y, 0, sr, dt);
      ch.body.position.y = damp(ch.body.position.y, g * (0.05 * rise - 0.04 * fall), sr, dt);
      // Lean into a rise, stand tall at apex, tip a touch back reaching for the
      // floor on the way down.
      ch.body.rotation.x = damp(ch.body.rotation.x, g * (0.22 * rise + 0.06 * apex - 0.14 * fall), sr, dt);
      ch.body.rotation.z = damp(ch.body.rotation.z, g * 0.06 * apex, sr, dt);
      // ARMS. Up-and-forward through the drive, wide at apex, out-and-back on
      // the descent. The asymmetry is small but it is what stops a jump reading
      // as a rigid T-pose translated upward.
      const armX = -0.24 - g * (1.32 * rise + 0.62 * apex + 0.16 * fall);
      limb(ch.parts.la, armX, 0.08, -0.20 - g * (0.34 * apex + 0.46 * fall), g * 0.10 * rise);
      limb(ch.parts.ra, armX + g * 0.16 * apex, -0.08, 0.20 + g * (0.40 * apex + 0.46 * fall), g * 0.10 * rise);
      setElbow(J.la, -0.24 - g * (0.34 * rise + 0.20 * apex), sr);
      setElbow(J.ra, -0.30 - g * (0.26 * rise + 0.24 * apex), sr);
      // LEGS. A tuck that unfolds into a reach: the lead leg extends down first
      // and the trail knee stays folded longest, which is what makes a landing
      // look prepared rather than dropped.
      const tuck = g * (0.86 * rise + 0.54 * apex);
      const reach = g * fall;
      limb(ch.parts.ll, -0.10 - tuck * 1.05 + reach * 0.34, 0, 0.10, 0);
      limb(ch.parts.rl, -0.08 - tuck * 0.58 + reach * 0.10, 0, -0.10, 0);
      setKnee(J.ll, 0.10 + tuck * 1.20 - reach * 0.06 + 0.14 * reach, sr);
      setKnee(J.rl, 0.10 + tuck * 0.72 + reach * 0.40, sr);
      if (ch.model) {
        ch.model.rotation.x = damp(ch.model.rotation.x, 0, sr, dt);
        ch.model.rotation.y = damp(ch.model.rotation.y, 0, sr, dt);
        ch.model.rotation.z = damp(ch.model.rotation.z, 0, sr, dt);
      }
      if (ch.neck) {
        // Chin up on the way up, down to find the ground on the way down.
        ch.neck.rotation.x = damp(ch.neck.rotation.x, g * (-0.14 * rise + 0.26 * fall), sr, dt);
        ch.neck.rotation.z = damp(ch.neck.rotation.z, 0, sr, dt);
      }
      ch.bob = ch.body.position.y;
      ch.lean = ch.body.rotation.x;
      ch.sway = ch.body.rotation.z;
      ch._stanceNk = 1;
      lockCharacterHips(ch);
      return;
    }

    // ---- STANCE POSES (physics.js stance machine sets slidePose/pronePose
    //      on the player rig only). Both OWN the whole rig like the seated
    //      pose: every write is a damp toward an absolute target, so entering
    //      /leaving flows and nothing can accumulate frame over frame (the
    //      grapple.js brace-pose lesson). The bob/lean/sway accumulators are
    //      kept in sync with what we wrote so the locomotion path's direct
    //      assignments resume from OUR pose instead of snapping; the neck has
    //      no locomotion owner, so _stanceNk arms a recovery damp below. ----
    if (ch.slidePose) {
      // COD power slide: lean-back torso, legs thrust FEET-FIRST down the
      // travel line (lead leg long, trail leg tucked), trailing hand planted
      // behind the hip, lead arm carried forward for balance, chin up.
      const sr = 13;
      ch.body.position.y = damp(ch.body.position.y, -0.52, sr, dt);    // hips drop toward the heels
      ch.body.position.z = damp(ch.body.position.z, 0, sr, dt);
      ch.body.rotation.x = damp(ch.body.rotation.x, -0.42, sr, dt);    // shoulders pitched BACK off the hips
      ch.body.rotation.y = damp(ch.body.rotation.y, 0.14, sr, dt);     // quarter-turn onto the planted hand
      ch.body.rotation.z = damp(ch.body.rotation.z, 0.10, sr, dt);
      if (ch.parts.ll) { ch.parts.ll.rotation.x = damp(ch.parts.ll.rotation.x, -1.28, sr, dt); ch.parts.ll.rotation.z = damp(ch.parts.ll.rotation.z, 0.10, sr, dt); ch.parts.ll.rotation.y = damp(ch.parts.ll.rotation.y, 0, sr, dt); ch.parts.ll.scale.y = damp(ch.parts.ll.scale.y, 1, sr, dt); }
      setKnee(J.ll, 0.18, sr);                                         // lead leg near-straight
      if (ch.parts.rl) { ch.parts.rl.rotation.x = damp(ch.parts.rl.rotation.x, -0.82, sr, dt); ch.parts.rl.rotation.z = damp(ch.parts.rl.rotation.z, -0.08, sr, dt); ch.parts.rl.rotation.y = damp(ch.parts.rl.rotation.y, 0, sr, dt); ch.parts.rl.scale.y = damp(ch.parts.rl.scale.y, 1, sr, dt); }
      setKnee(J.rl, 0.85, sr);                                         // trail knee tucked under
      if (ch.parts.ra) { ch.parts.ra.rotation.x = damp(ch.parts.ra.rotation.x, 0.55, sr, dt); ch.parts.ra.rotation.z = damp(ch.parts.ra.rotation.z, -0.55, sr, dt); ch.parts.ra.rotation.y = damp(ch.parts.ra.rotation.y, 0, sr, dt); }
      setElbow(J.ra, -0.15, sr);                                       // planted arm long behind
      if (ch.parts.la) { ch.parts.la.rotation.x = damp(ch.parts.la.rotation.x, -0.85, sr, dt); ch.parts.la.rotation.z = damp(ch.parts.la.rotation.z, 0.15, sr, dt); ch.parts.la.rotation.y = damp(ch.parts.la.rotation.y, 0, sr, dt); }
      setElbow(J.la, -0.55, sr);                                       // balance arm reaching the line
      if (ch.neck) { ch.neck.rotation.x = damp(ch.neck.rotation.x, -0.30, sr, dt); ch.neck.rotation.z = damp(ch.neck.rotation.z, 0, sr, dt); }
      ch.bob = ch.body.position.y; ch.lean = ch.body.rotation.x; ch.sway = ch.body.rotation.z;
      ch._stanceNk = 1;
      lockCharacterHips(ch);
      return;   // the slide owns the whole rig
    }
    if (ch.pronePose) {
      // PRONE: the upper body hinges flat at the hips (chest to the deck) and
      // the legs sweep back level — a plank at hip height that physics.js
      // sinks to the ground via _proneB. Arms carry the weapon FORWARD on
      // planted elbows (the LMG firing position); a slow alternating paddle
      // sells the crawl when moving.
      const pr = 9;
      if (speed > 0.2) ch.phase += dt * (2.2 + speed * 2.0);           // crawl cadence (gait phase is idle here)
      const pad = speed > 0.2 ? Math.sin(ch.phase) : 0;
      ch.body.position.y = damp(ch.body.position.y, 0.02, pr, dt);
      ch.body.position.z = damp(ch.body.position.z, 0, pr, dt);
      ch.body.rotation.x = damp(ch.body.rotation.x, PRONE_PITCH, pr, dt);     // hinge flat, chest down
      ch.body.rotation.y = damp(ch.body.rotation.y, 0, pr, dt);
      ch.body.rotation.z = damp(ch.body.rotation.z, pad * 0.06, pr, dt);
      if (ch.parts.ll) { ch.parts.ll.rotation.x = damp(ch.parts.ll.rotation.x, PRONE_LEG_PITCH + 0.03 + pad * 0.14, pr, dt); ch.parts.ll.rotation.z = damp(ch.parts.ll.rotation.z, 0.10, pr, dt); ch.parts.ll.rotation.y = damp(ch.parts.ll.rotation.y, 0, pr, dt); ch.parts.ll.scale.y = damp(ch.parts.ll.scale.y, 1, pr, dt); }
      if (ch.parts.rl) { ch.parts.rl.rotation.x = damp(ch.parts.rl.rotation.x, PRONE_LEG_PITCH - 0.03 - pad * 0.14, pr, dt); ch.parts.rl.rotation.z = damp(ch.parts.rl.rotation.z, -0.10, pr, dt); ch.parts.rl.rotation.y = damp(ch.parts.rl.rotation.y, 0, pr, dt); ch.parts.rl.scale.y = damp(ch.parts.rl.scale.y, 1, pr, dt); }
      setKnee(J.ll, 0.06, pr); setKnee(J.rl, 0.12, pr);                // legs lie flat, not folded
      // ELBOWS ON THE DECK, HANDS UP AT THE GUN. See the derivation by
      // PRONE_ARM_PITCH: the shipped -1.32/-1.40 shoulders drove both arms
      // straight DOWN through the floor and took the weapon with them. `gunK`
      // eases between the empty-handed crawl (forearms flat on the ground) and
      // the firing position (forearms up to the weapon); it is published by the
      // ground-rest pass below off the actual socketed prop, so an unarmed body
      // never holds an invisible rifle.
      const rec = ch.aimRecoil || 0;
      const legacyArms = CBZ.CONFIG && CBZ.CONFIG.CHAR_PRONE_GUN_POSE === false;
      const gunK = legacyArms ? 0 : (ch._gunPoseK || 0);
      const upperA = legacyArms ? -1.32 : PRONE_ARM_PITCH;
      const foreA = legacyArms ? -0.35 : PRONE_FORE_EMPTY + (PRONE_FORE_ARMED - PRONE_FORE_EMPTY) * gunK;
      // The support side plants a touch deeper and reaches a touch further
      // under the handguard; recoil rocks the gun shoulder back, never down.
      if (ch.parts.ra) { ch.parts.ra.rotation.x = damp(ch.parts.ra.rotation.x, upperA + rec * 0.10 - pad * 0.05, pr, dt); ch.parts.ra.rotation.y = damp(ch.parts.ra.rotation.y, 0.10, pr, dt); ch.parts.ra.rotation.z = damp(ch.parts.ra.rotation.z, -0.18, pr, dt); ch.parts.ra.position.z = damp(ch.parts.ra.position.z, legacyArms ? 0.10 : 0, pr, dt); }
      setElbow(J.ra, foreA + rec * 0.10, pr);
      if (ch.parts.la) { ch.parts.la.rotation.x = damp(ch.parts.la.rotation.x, (legacyArms ? -1.40 : upperA - 0.08) + pad * 0.05, pr, dt); ch.parts.la.rotation.y = damp(ch.parts.la.rotation.y, -0.15, pr, dt); ch.parts.la.rotation.z = damp(ch.parts.la.rotation.z, 0.30, pr, dt); ch.parts.la.position.z = damp(ch.parts.la.position.z, legacyArms ? 0.14 : 0, pr, dt); }
      setElbow(J.la, legacyArms ? -0.75 : foreA + 0.06, pr);           // support elbow dug in
      // head comes UP behind the gun once there is a gun to look over
      const neckT = legacyArms ? PRONE_NECK_EMPTY
        : PRONE_NECK_EMPTY + (PRONE_NECK_ARMED - PRONE_NECK_EMPTY) * gunK;
      if (ch.neck) { ch.neck.rotation.x = damp(ch.neck.rotation.x, neckT, pr, dt); ch.neck.rotation.z = damp(ch.neck.rotation.z, 0, pr, dt); }
      ch.bob = ch.body.position.y; ch.lean = ch.body.rotation.x; ch.sway = ch.body.rotation.z;
      ch._stanceNk = 1;
      lockCharacterHips(ch);
      return;   // prone owns the whole rig
    }
    // stance blend-out: the branches above own the neck while active and
    // nothing in the locomotion path below ever writes it — recover it here
    // (a few frames of damp) so an exited slide/prone can't park the chin.
    // Armed only by the stance poses; every other rig skips at one falsy check.
    if (ch._stanceNk) {
      if (ch.neck) { ch.neck.rotation.x = damp(ch.neck.rotation.x, 0, 8, dt); ch.neck.rotation.z = damp(ch.neck.rotation.z, 0, 8, dt); }
      if (!ch.neck || Math.abs(ch.neck.rotation.x) < 0.01) ch._stanceNk = 0;
    }

    // Gait advances with DISTANCE TRAVELLED, not frame count. `phase` is an
    // angle in radians and alternate footfalls are PI radians apart. The old
    // code added distance/stepLength directly, accidentally treating ONE
    // radian as a complete step. Its distance term alone implied ~3.6m between
    // footfalls, which made every actor read as a slow-motion jogger at full FPS.
    // Convert travelled steps to radians, and lengthen the step modestly as a
    // run opens up so sprint cadence stays quick without turning into a buzz.
    // GAIT STYLE: a set of MULTIPLIERS on the literals below, carried by the
    // body profile the rig was built from (character profile → rig.gait).
    // Every multiplier is 1 for the adult male, so an un-profiled or legacy rig
    // is bit-for-bit the motion this game has always had. Nothing here adds an
    // animation STATE — a woman and a toddler run the same code as everyone
    // else, weighted differently. That is why all ~15 makeCharacter call sites
    // get the new motion without a line of change.
    const GA = ch.gait || GAIT_NEUTRAL;
    // FOOT-PLANT-MATCHED STRIDE (entities/moves.js): one footfall covers the
    // ground the planted foot sweeps under THIS rig's hip, so walkers stop
    // skating. Runs keep the authored stride (flight phase).
    ch.phase += (CBZ.moves && CBZ.moves.phaseDelta)
      ? CBZ.moves.phaseDelta(ch, speed, dt, walkRef, GA)
      : gaitPhaseDelta(speed, dt, walkRef, GA.step);
    const sinP = Math.sin(ch.phase), cosP = Math.cos(ch.phase);
    // CROUCH is a real pose now (hips drop, knees fold, torso hinges forward),
    // not the old whole-group scale.y accordion squash. cb eases 0→1 so
    // entering/leaving a crouch flows through the same damped targets.
    ch._cb = damp(ch._cb || 0, ch.crouch ? 1 : 0, 12, dt);
    const cb = ch._cb;
    const hipAmp = (0.30 + 0.26 * norm + 0.16 * run2) * (1 - 0.35 * cb) * GA.hipAmp;
    const swing = sinP * hipAmp;

    // ---- LEG WOUND / LIMP STATE ----
    let lh = ch.legHurt;
    if (lh) {
      lh.t -= dt;
      if (lh.sev < 0.5) lh.sev = Math.max(0, lh.sev - dt * (0.5 / 20));
      if (lh.sev <= 0.001 || lh.t <= 0) { ch.legHurt = null; lh = null; }
    }
    // STALE-FLAG GUARD: a pooled rig promoted with legGone still set for a
    // frame walks folded face-down; the hidden leg mesh is ground truth.
    if (ch.legGone) {
      const gonePart = ch.legGone < 0 ? ch.parts.ll : ch.parts.rl;
      if (gonePart && gonePart.visible !== false) { ch.legGone = 0; }
    }
    const legGone = ch.legGone;                     // -1 left / +1 right / 0|undef
    const hurtSide = lh ? lh.side : 0;
    const sev = lh ? Math.min(1, lh.sev) : 0;
    ch.limpSpeedMul = legGone ? 0.0 : (1 - sev * 0.5);

    // ---- legs: opposed hip swing + biomechanical knee flexion ----
    const legRate = 16, armRate = 14;
    const lSwing = moving ? swing * (hurtSide < 0 ? 1 - sev * 0.62 : 1) : 0;
    const rSwing = moving ? -swing * (hurtSide > 0 ? 1 - sev * 0.62 : 1) : 0;
    const lBend = hurtSide < 0 ? sev * 0.22 : 0;
    const rBend = hurtSide > 0 ? sev * 0.22 : 0;
    // (the hips drop 0.38 in a crouch — bobTarget — and the leg roots drop
    // with them, so the fold is the one that keeps the feet on the floor:
    // legUp cos 0.95 + legLo cos(0.95 - 1.9) ~ hipY - 0.38)
    const crouchHip = cb * 0.95;                 // thighs fold toward the chest
    ch.parts.ll.rotation.x = damp(ch.parts.ll.rotation.x, lSwing - lBend - crouchHip, legRate, dt);
    ch.parts.rl.rotation.x = damp(ch.parts.rl.rotation.x, rSwing - rBend - crouchHip, legRate, dt);
    // CROSS-LEG GUARD: pose layers own z/y; recycled corpse splay must not
    // ride into a fresh walker (animChar only runs on live upright actors).
    // STEP WIDTH lives on this channel: the guard damps toward the body's OWN
    // stance instead of a flat zero, so a woman keeps her narrow near-midline
    // walk and a toddler keeps its wide base every frame. Absent (legacy rig)
    // reads 0 — the exact old behaviour.
    const stZ = ch.stanceZ || 0;
    ch.parts.ll.rotation.z = damp(ch.parts.ll.rotation.z, stZ, 12, dt);
    ch.parts.rl.rotation.z = damp(ch.parts.rl.rotation.z, -stZ, 12, dt);
    ch.parts.ll.rotation.y = damp(ch.parts.ll.rotation.y, 0, 12, dt);
    ch.parts.rl.rotation.y = damp(ch.parts.rl.rotation.y, 0, 12, dt);
    // the old scale.y foot-lift fake dies — real knees carry the clearance
    ch.parts.ll.scale.y = damp(ch.parts.ll.scale.y, 1, 16, dt);
    ch.parts.rl.scale.y = damp(ch.parts.rl.scale.y, 1, 16, dt);

    // knees: flex through the swing phase (left swings forward while cosθ<0,
    // peaking mid-swing), carry a small stance flexion so legs never look
    // hyper-extended, plus a load-response dip right after heel strike.
    const kneeAmp = (0.62 + 0.55 * norm + 0.55 * run2) * GA.knee;   // sprint kicks heels up
    // stanceKnee is ADDED, not multiplied: a new walker never straightens the
    // knee through stance at all (Sutherland 1980), which is a large part of
    // why a toddler's walk reads as a toddler's and not a small adult's.
    const stanceK = (moving ? 0.10 + 0.10 * norm : 0.04) + GA.stanceKnee;
    const kneeL = moving ? stanceK + kneeAmp * Math.pow(Math.max(0, -cosP), 1.3) * (hurtSide < 0 ? 1 - sev * 0.7 : 1) : 0.04;
    const kneeR = moving ? stanceK + kneeAmp * Math.pow(Math.max(0, cosP), 1.3) * (hurtSide > 0 ? 1 - sev * 0.7 : 1) : 0.04;
    setKnee(J.ll, kneeL + lBend * 1.4 + cb * 1.90, legRate);
    setKnee(J.rl, kneeR + rBend * 1.4 + cb * 1.90, legRate);

    // ---- arms ----
    if (ch.aimingPose) {
      // present-weapon: gun arm out along the crosshair, support arm on the
      // handguard. animChar is the single owner of the arms while aiming.
      const recoil = ch.aimRecoil || 0;
      const recoilSide = ch.aimRecoilSide || 0;
      // SIGN: the arm terms below are UP-positive (a bigger `pitch` drives
      // rotation.x more negative, i.e. the gun arm RAISES), but cam.pitch is
      // DOWN-positive — see the convention note in systems/camera.js beside
      // `const cam = {...}`. Negate once here rather than at both use sites, so
      // the present-weapon pose follows the same aim fpsmode's aimForward()
      // takes off cam.pitch instead of mirroring it.
      const pitch = -((CBZ.cam && typeof CBZ.cam.pitch === "number") ? CBZ.cam.pitch : 0);
      const ar = 16;
      // WEIGHT IS THE WEAPON'S, THE POSE IS THE BODY'S (weapon-data.js `hold`,
      // published by fpsmode as aimHeavy/aimSupport). A 7.5 kg belt-fed gun is
      // not shouldered like a 9 mm: the support hand runs FORWARD onto the
      // handguard, its elbow closes under the receiver to carry the mass, and
      // the firing shoulder rides a touch lower instead of squared up at the
      // horizon. hv is 0 for every weapon that declares no `hold`, and every
      // term below is + 0 at hv = 0 — so nothing that ships today moves.
      const hv = heavyHold(ch), hsup = heavySupport(ch);
      /* HOW MANY HANDS is the hold engine's (systems/actorweapons.js
         CBZ.holds, published by systems/gunhands.js as aimHands): a handgun
         is ONE hand in third person. The two-hand pistol crossed both short
         arms into the chest and hid the gun between the fists; one hand is
         the arm out from its own shoulder down the aim (a touch inboard,
         sights under the eye), the off arm down at the side, free for a
         torch, a door, a radio. A long gun keeps the support arm on the
         handguard.
         DOWN THE SIGHTS (systems/sights.js publishes adsK 0..1): a long gun
         comes UP into the face (the firing shoulder lifts and pulls the
         stock into the pocket, the support arm rides up with it, the head
         goes down and over onto the comb: the cheek weld; +z on the neck
         tips it toward the right shoulder); a handgun's one arm comes up to
         eye height and locks. Every ADS term is 0 at adsK 0. */
      const oneHand = ch.aimHands === 1;
      const adsK = Math.max(0, Math.min(1, ch.adsK || 0));
      const adsL = oneHand ? 0 : adsK, adsP = oneHand ? adsK : 0;
      ch.parts.ra.rotation.x = damp(ch.parts.ra.rotation.x, -1.571 + 0.12 * hv - pitch * 0.8 - recoil * 0.16 - 0.12 * adsL - 0.10 * adsP, ar, dt);
      ch.parts.ra.rotation.y = damp(ch.parts.ra.rotation.y, (oneHand ? 0.06 : 0.18) - recoilSide * 0.22, ar, dt);
      ch.parts.ra.rotation.z = damp(ch.parts.ra.rotation.z, oneHand ? 0.12 - 0.06 * adsP : 0.34, ar, dt);
      ch.parts.ra.position.z = damp(ch.parts.ra.position.z, oneHand ? 0.06 : 0.14 - 0.05 * adsL, ar, dt);
      if (oneHand) {
        // the off arm hangs relaxed beside the body, clear of the hip and of
        // anything worn over the ribs (the same clearance the walk uses)
        ch.parts.la.rotation.x = damp(ch.parts.la.rotation.x, 0.02, ar - 4, dt);
        ch.parts.la.rotation.y = damp(ch.parts.la.rotation.y, 0, ar - 4, dt);
        ch.parts.la.rotation.z = damp(ch.parts.la.rotation.z, (ch.armOutZ != null ? ch.armOutZ : -0.08) + 0.04, ar - 4, dt);
        ch.parts.la.position.z = damp(ch.parts.la.position.z, 0, ar - 4, dt);
        setElbow(J.la, -0.22, ar - 4);
      } else {
        ch.parts.la.rotation.x = damp(ch.parts.la.rotation.x, -1.55 - 0.14 * hv - pitch * 0.8 - 0.08 * adsL, ar - 1, dt);
        ch.parts.la.rotation.y = damp(ch.parts.la.rotation.y, -0.34 - 0.10 * hv, ar - 1, dt);
        ch.parts.la.rotation.z = damp(ch.parts.la.rotation.z, -0.42, ar - 1, dt);
        ch.parts.la.position.z = damp(ch.parts.la.position.z, 0.24 + hsup * 0.5, ar - 1, dt);
        setElbow(J.la, -0.72 - 0.26 * hv, ar - 1);
      }
      // gun arm nearly locked (one hand: a soft elbow, straight down the
      // sights); recoil folds the elbow a touch — the arm absorbs the kick.
      setElbow(J.ra, ((oneHand ? -0.16 : -0.10) - recoil * 0.25) * (1 - 0.8 * adsP), ar);
      if (ch.neck && (adsK > 0.001 || ch._adsNeck)) {
        ch.neck.rotation.x = damp(ch.neck.rotation.x, 0.20 * adsL + 0.06 * adsP, ar, dt);
        ch.neck.rotation.z = damp(ch.neck.rotation.z, 0.24 * adsL, ar, dt);
        ch._adsNeck = adsK > 0.001 || Math.abs(ch.neck.rotation.z) > 0.005 || Math.abs(ch.neck.rotation.x) > 0.005;
      }
    } else if (ch.cuffed) {
      // CUFFED ARMS BELONG TO systems/verbs.js: its late pass (order 91)
      // solves the wrists together behind the back for every cuffed rig,
      // after this. Writing here too would only be a damp for it to undo.
    } else if (ch.surrender || ch.handsUp) {
      // the hands-up layer below OWNS the arms — if the idle counter-swing
      // also wrote them, the two damps fight and the arms equilibrate at a
      // half-raised ~40° (filmstrip-diagnosed) instead of reaching the pose.
    } else if (ch.carryPose) {
      // LOW-READY carry (player TP, armed but not presenting — systems/
      // fpsmode.js owns the flag): the gun arm hangs low-forward so the
      // weapon rides at the hip pointing down-forward (~45°, RDR2/Fortnite
      // carry) instead of squared-up at the horizon; the left arm keeps the
      // normal relaxed counter-swing so walking still reads human. A touch
      // of gait/breath bob on the gun arm keeps it alive without waving the
      // muzzle around. Cuffed/surrender above outrank the carry; the moment
      // fpsmode flips aimingPose (RMB/fire/recoil-settle) the present pose
      // branch takes over through the same damps — smooth raise/lower.
      // (rotation.y / position.z stay owned by the !aimingPose reset below.)
      const cr = 12;
      const carryBob = moving ? swing * 0.10 : Math.sin(ch.breath * 2.2) * 0.02;
      const hvC = heavyHold(ch), hsupC = heavySupport(ch);
      if (ch.aimLong === false) {
        // PISTOL carry (screenshot-diagnosed): the tucked across-the-hip arm
        // hid a holstered-size gun completely behind the torso from the chase
        // camera. Sidearms hang LOW BESIDE the thigh instead — arm nearly
        // straight, hand pushed just clear of the leg so the gun silhouettes
        // against the ground from behind (GTA/Fortnite pistol walk).
        ch.parts.ra.rotation.x = damp(ch.parts.ra.rotation.x, -0.18 + carryBob * 0.5, cr, dt);
        // out from the actual right thigh, and round anything worn over the ribs
        ch.parts.ra.rotation.z = damp(ch.parts.ra.rotation.z, Math.min(-0.16, -(ch.armOutZ != null ? ch.armOutZ : 0) - 0.04), cr, dt);
        setElbow(J.ra, -0.12, cr);
      } else {
        // LONG-GUN carry. Two generations of this pose, and the second exists
        // because the camera work measured the first into a corner:
        //
        // ROUND 2 (kept as the CHAR_PORT_ARMS_CARRY=false revert): hand beside
        // the right thigh, barrel hung down-forward past the leg. It cleared
        // the torso box — but tools/tp-gun-view-check.mjs later measured that
        // from the chase camera a thigh-hung rifle is a knife edge: 54% or 0%
        // of the barrel visible depending on where the idle breath has the arm,
        // because the gun lies exactly along the leg's silhouette, and NO
        // camera framing fixes it (every centimetre of lens offset puts more
        // hip in front of it — the sweep in src/city/camera.js's CARRY note).
        //
        // PORT ARMS (default): the answer the camera note called for. The gun
        // hand rises to the lower chest and the barrel runs diagonally UP and
        // ACROSS the body (holsterprops.js TP_LOWREADY.portLong), the way a
        // rifle is actually carried ready — so the weapon crosses the torso
        // silhouette instead of hiding inside the leg's, and both ends break
        // free of the body from the rear chase camera. The support hand needs
        // no work here: systems/gunhands.js IK-solves it onto the handguard
        // wherever the handguard is.
        // HEAVY (weapon-data.js hold.heavy): the mass still hangs — a belt-fed
        // gun ports lower and flatter than a carbine (same hvC scaling, gentler
        // raise), which also keeps its bulk from parking in front of the face.
        if (CBZ.CONFIG.CHAR_PORT_ARMS_CARRY !== false) {
          ch.parts.ra.rotation.x = damp(ch.parts.ra.rotation.x, -0.62 + 0.20 * hvC + carryBob * 0.4, cr, dt);
          ch.parts.ra.rotation.z = damp(ch.parts.ra.rotation.z, -0.10 - 0.04 * hvC, cr, dt);
          setElbow(J.ra, -0.80 + 0.24 * hvC, cr);        // forearm folds up-across
        } else {
          ch.parts.ra.rotation.x = damp(ch.parts.ra.rotation.x, -0.30 + 0.15 * hvC + carryBob * 0.7, cr, dt);
          ch.parts.ra.rotation.z = damp(ch.parts.ra.rotation.z, -0.20 - 0.05 * hvC, cr, dt);   // OUT from the actual right thigh
          setElbow(J.ra, -0.34 + 0.16 * hvC, cr);        // forearm angles the gun down-forward
        }
      }
      if (ch.aimLong === true && CBZ.CONFIG.CHAR_PORT_ARMS_CARRY === false) {
        // (Legacy thigh-hang carry only.) Rifles and shotguns remain two-hand
        // objects at the old low ready: the support forearm stays under the
        // handguard instead of swinging loose. At PORT ARMS this base pose is
        // wrong twice over — the handguard is up the diagonal, not across the
        // waist, and for the longer guns it is out of the off arm's reach
        // entirely, where systems/gunhands.js now RELEASES the arm rather than
        // stretch it. So port arms takes the relaxed counter-swing base below;
        // whenever the handguard IS reachable the IK lands on it anyway
        // (gunhands runs after this and overrides).
        // …and the heavier it is, the LOWER that hand has to go: a carbine's
        // handguard rides at chest height, a belt-fed gun's hangs beside the
        // thigh because the gun does. The shipped -0.72/-0.82 pair puts the
        // support forearm across the CHEST, which on an LMG left the left hand
        // half a metre above a gun it was supposedly holding (screenshot-
        // diagnosed, this wave). Straighten the arm down and bring it further
        // ACROSS (rotation.z is negative toward the gun side) so it meets the
        // handguard where the handguard actually is.
        ch.parts.la.rotation.x = damp(ch.parts.la.rotation.x, -0.72 + 0.58 * hvC + carryBob * 0.35, cr, dt);
        ch.parts.la.rotation.y = damp(ch.parts.la.rotation.y, -0.30 - 0.08 * hvC, cr, dt);
        ch.parts.la.rotation.z = damp(ch.parts.la.rotation.z, -0.38 - 0.22 * hvC, cr, dt);
        ch.parts.la.position.z = damp(ch.parts.la.position.z, 0.18 + hsupC * 0.5, cr, dt);
        setElbow(J.la, -0.82 + 0.52 * hvC, cr);
      } else {
        const armAmp = hipAmp * (0.95 + 0.25 * run2);
        const laTarget = moving ? swing * armAmp / hipAmp * (0.55 + 0.45 * hipAmp) : 0;
        ch.parts.la.rotation.x = damp(ch.parts.la.rotation.x, laTarget, armRate, dt);
        // the off arm hangs like the idle one: wide of the ribs and of any vest
        ch.parts.la.rotation.z = damp(ch.parts.la.rotation.z, ch.armOutZ != null ? ch.armOutZ : -0.08, 6, dt);
        const elbBase = moving ? 0.30 + 0.42 * norm + 0.62 * run2 : 0.22 + Math.sin(ch.breath * 2.2) * 0.02;
        const foldL = moving ? Math.max(0, -laTarget) * 0.8 : 0;
        setElbow(J.la, -(elbBase + foldL), armRate - 2);
      }
    } else if (ch.pose && !moving && CBZ.charPoses && CBZ.charPoses[ch.pose]) {
      // ---- HELD POSE (shared registry — entities/poses.js) ----
      // A planted actor's static pose: a dealer's hands over the felt, folded
      // arms, hands resting on the table. ONLY when idle — a walk falls through
      // to the counter-swing below (walk/panic override the pose), and
      // aiming/cuffed/surrender/carry above all outrank it (HANDS-UP wins). The
      // pose OWNS the arms this frame, so it reaches its target instead of
      // equilibrating half-way against the idle damp. ONE system shared by the
      // ped brain (peds.js sets ch.pose) and game packages (packages.js ctx.npc).
      CBZ.charPoses[ch.pose](ch, dt);
    } else {
      // counter-swing with an elbow that deepens with pace: relaxed ~14° at
      // idle, a soft 35-45° at a walk, a real ~90° runner's pump at sprint.
      // The elbow also folds a little extra as the arm swings FORWARD (a
      // straight back-swing + bent fore-swing is what reads "human").
      // Men recruit the shoulders and arms more; women hold the upper body
      // quieter and let the pelvis do the work (Bruening 2015). GA.armAmp
      // carries that, and it is also what silences a new walker's arms —
      // reciprocal arm swing does not appear until ~18 months.
      const armAmp = hipAmp * (0.95 + 0.25 * run2) * GA.armAmp;
      const laTarget = moving ? swing * armAmp / hipAmp * (0.55 + 0.45 * hipAmp) : 0;
      const raTarget = moving ? -swing * armAmp / hipAmp * (0.55 + 0.45 * hipAmp) : 0;
      // HIGH GUARD: before a toddler can balance, the arms ride up and out to
      // the sides like a tightrope walker. It is the single most recognisable
      // thing about a new walker and it costs one blend on channels the idle
      // carry already owns. guard is 0 for every other body, so this whole
      // block collapses to exactly the old targets.
      const gd = GA.guard || 0;
      const carryZ = ch.armOutZ != null ? ch.armOutZ : -0.08;
      const outZ = carryZ + gd * 0.85;                 // arms swing wide of the ribs
      ch.parts.la.rotation.x = damp(ch.parts.la.rotation.x, laTarget * (1 - gd) - gd * 0.55, armRate, dt);
      ch.parts.ra.rotation.x = damp(ch.parts.ra.rotation.x, raTarget * (1 - gd) - gd * 0.55, armRate, dt);
      ch.parts.la.rotation.z = damp(ch.parts.la.rotation.z, outZ, 6, dt);
      ch.parts.ra.rotation.z = damp(ch.parts.ra.rotation.z, -outZ, 6, dt);
      const elbBase = moving ? 0.30 + 0.42 * norm + 0.62 * run2 : 0.22 + Math.sin(ch.breath * 2.2) * 0.02;
      const foldL = moving ? Math.max(0, -laTarget) * 0.8 : 0;   // forward swing folds
      const foldR = moving ? Math.max(0, -raTarget) * 0.8 : 0;
      setElbow(J.la, -(elbBase + foldL + gd * 0.55), armRate - 2);
      setElbow(J.ra, -(elbBase + foldR + gd * 0.55), armRate - 2);
    }
    // a held pose that turns the humerus (poses.js `twist: true`, folded
    // arms) owns rotation.y; everything else hands it back to zero
    const poseTwist = !moving && ch.pose && CBZ.charPoses && CBZ.charPoses[ch.pose] && CBZ.charPoses[ch.pose].twist;
    if (!ch.aimingPose && !poseTwist) {
      if (!(ch.carryPose && ch.aimLong === true && CBZ.CONFIG.CHAR_PORT_ARMS_CARRY === false)) {
        ch.parts.la.rotation.y = damp(ch.parts.la.rotation.y, 0, 10, dt);
        ch.parts.la.position.z = damp(ch.parts.la.position.z, 0, 12, dt);
      }
      ch.parts.ra.rotation.y = damp(ch.parts.ra.rotation.y, 0, 10, dt);
      ch.parts.ra.position.z = damp(ch.parts.ra.position.z, 0, 12, dt);
    }

    // ---- body: bob (2× stride), side sway, forward lean, counter-rotation --
    // CoM is lowest at double support (feet furthest apart, |sinθ| max).
    const bobTarget = (moving ? -Math.abs(sinP) * (0.03 + 0.05 * norm + 0.03 * run2) * GA.bob : 0) - cb * 0.38;
    const idleBreath = moving ? 0 : Math.sin(ch.breath * 2.2) * 0.012;
    ch.bob = damp(ch.bob, bobTarget, 12, dt);
    ch.body.position.y = ch.bob + idleBreath;
    // The upper-body group is authored in model space with its origin at the
    // feet, while the legs pivot at the hips.  Pitching that group to create a
    // run lean therefore used to swing the whole chest forward around the
    // ankles — at a sprint the torso visibly detached and ran in front of the
    // legs.  Reset the longitudinal channel every locomotion frame; after the
    // lean is known below we compensate the foot-origin transform so it behaves
    // exactly like a rotation about the shared hip socket instead.
    ch.body.position.z = 0;

    // weight shifts over the stance foot; a touch of idle sway keeps a
    // standing rig alive instead of statue-frozen. Turning while moving BANKS
    // the body into the turn like a runner rounding a corner — yaw rate is
    // derived from the root's facing so no caller has to pass anything.
    let turnBank = 0;
    if (ch.group) {
      const yaw = ch.group.rotation.y;
      if (ch._prevYaw !== undefined && dt > 0.0001) {
        let dy = yaw - ch._prevYaw;
        if (dy > Math.PI) dy -= Math.PI * 2; else if (dy < -Math.PI) dy += Math.PI * 2;
        const yawRate = Math.max(-6, Math.min(6, dy / dt));
        turnBank = moving ? -yawRate * 0.045 * (0.4 + 0.6 * norm) : 0;
      }
      ch._prevYaw = yaw;
    }
    // GA.sway scales only the GAIT term — turn-bank is physics and must not be
    // sexed. This channel is the rig's stand-in for pelvic obliquity (there is
    // no separate pelvis pivot), and it is the loudest female cue in motion:
    // women carry markedly more pelvic obliquity than men (Cho 2004), and it
    // reads from every angle at 30m where a waistline does not.
    const swayTarget = (moving ? sinP * (0.015 + 0.03 * norm) * GA.sway : Math.sin(ch.breath * 0.9) * 0.012) + turnBank;
    ch.sway = damp(ch.sway, swayTarget, 10, dt);
    ch.body.rotation.z = ch.sway;

    const leanTarget = norm * 0.12 + run2 * 0.10 + cb * 0.16;   // lean into the run / hunch the crouch
    ch.lean = damp(ch.lean, leanTarget, 8, dt);
    ch.body.rotation.x = ch.lean;
    // shoulders counter-rotate the stride (right shoulder leads the left
    // foot): subtle at a walk, pronounced at a sprint. The punch layer OWNS
    // body.rotation.y while active, so only write it here when not punching.
    const yGait = moving ? sinP * (0.05 + 0.05 * norm + 0.05 * run2) * GA.yaw : 0;

    // ---- LIMP: the body dips toward the hurt leg as it bears weight ----
    if (sev > 0.02 && moving && !legGone) {
      const plant = hurtSide < 0 ? Math.max(0, -sinP) : Math.max(0, sinP);
      ch.body.position.y -= plant * sev * 0.09;
      ch.body.rotation.z += hurtSide * plant * sev * 0.16;
    }

    // ---- LEG SEVERED: sink into a low crawl/collapse ----
    if (legGone) {
      const crawl = moving ? sinP : 0;
      ch.body.position.y = damp(ch.body.position.y, -0.85, 8, dt);
      ch.body.rotation.x = damp(ch.body.rotation.x, 0.95, 8, dt);
      ch.body.rotation.z = damp(ch.body.rotation.z, legGone * 0.45, 8, dt);
      const goodLeg = legGone < 0 ? ch.parts.rl : ch.parts.ll;
      const stumpLeg = legGone < 0 ? ch.parts.ll : ch.parts.rl;
      const goodKnee = legGone < 0 ? J.rl : J.ll;
      if (goodLeg) { goodLeg.rotation.x = damp(goodLeg.rotation.x, -0.5 + crawl * 0.5, 10, dt); goodLeg.scale.y = damp(goodLeg.scale.y, 1, 10, dt); }
      setKnee(goodKnee, 0.85 - crawl * 0.3, 10);
      if (stumpLeg) stumpLeg.rotation.x = damp(stumpLeg.rotation.x, -0.2, 10, dt);
      if (ch.parts.la) { ch.parts.la.rotation.x = damp(ch.parts.la.rotation.x, -1.5 + crawl * 0.6, 10, dt); ch.parts.la.rotation.z = damp(ch.parts.la.rotation.z, 0.2, 10, dt); }
      if (ch.parts.ra) { ch.parts.ra.rotation.x = damp(ch.parts.ra.rotation.x, -1.5 - crawl * 0.6, 10, dt); ch.parts.ra.rotation.z = damp(ch.parts.ra.rotation.z, -0.2, 10, dt); }
      setElbow(J.la, -0.7 - crawl * 0.25, 10); setElbow(J.ra, -0.7 + crawl * 0.25, 10);
      if (ch.neck) ch.neck.rotation.x = damp(ch.neck.rotation.x, -0.5, 9, dt);
      lockCharacterHips(ch);
      return;   // a one-legged crawl owns the whole rig
    }

    // ---- MELEE: the fighting stance, every strike and kick, the guard, the
    // slip, footwork and the body half of a hit reaction live in
    // entities/meleeposes.js (CBZ.meleePoses.strike). It owns body.rotation.y
    // while it is active and hands it back to the gait counter-rotation here.
    if (CBZ.meleePoses) CBZ.meleePoses.strike(ch, dt, moving, J, yGait);
    else ch.body.rotation.y = damp(ch.body.rotation.y, yGait, 10, dt);

    /* ---- REACH: the hand that goes somewhere it should not be.
       THE GAP THIS FILLS, stated by the file that hit it (systems/economy.js's
       failed-lift comment): "there is no pickpocket ARM ANIMATION anywhere on
       the rig — punch/kick/block and nothing between idle and strike." A lift
       was therefore a sound and a number: the one physical act in the prison
       nobody could SEE happen.

       It is deliberately NOT a strike. A strike chambers, drives and snaps
       back; a reach is slow at the wrist, quiet in the torso and the head
       looks AWAY from the hand — the whole tell of a pickpocket is that he is
       looking at your face while his hand is at your hip. Envelope: extend →
       DWELL (the grab, `reachHold`) → withdraw, so the pause in the middle is
       the beat where the thing changes hands.

       Additive and flag-free like every layer above: one falsy check when the
       director sets nothing, and the gait/idle damps restore the arm by
       themselves the frame after the timer clears. Callers use CBZ.charReach.
         ch.reachT/reachDur   timer + total length (default 0.62 s)
         ch.reachArm          "l" | "r" (default "r")
         ch.reachSide         -1 across the body / +1 out to the side / 0 front
         ch.reachHigh         0 hip pocket (default) .. 1 chest/collar
         ch.reachAmt          0..1 how far the body commits (default 1) */
    if (ch.reachT > 0) {
      ch.reachT -= dt;
      const rdur = ch.reachDur || 0.62;
      const rprog = 1 - Math.max(0, ch.reachT) / rdur;
      // extend over the first 30%, hold flat through the middle, withdraw last
      const rout = Math.min(1, rprog / 0.30);
      const rback = Math.max(0, (rprog - 0.62) / 0.38);
      const renv = Math.max(0, rout - rback) * (ch.reachAmt == null ? 1 : ch.reachAmt);
      const rleft = ch.reachArm === "l";
      const rarm = rleft ? ch.parts.la : ch.parts.ra;
      const rother = rleft ? ch.parts.ra : ch.parts.la;
      const rarmJ = rleft ? J.la : J.ra;
      const rsgn = rleft ? 1 : -1;
      const high = ch.reachHigh || 0;               // 0 = hip pocket, 1 = collar
      const across = ch.reachSide == null ? -1 : ch.reachSide;
      const mountReach = (ch.reachKind === "holster-back" || ch.reachKind === "holster-hip")
        ? reachMountArmSolve(ch, ch.reachTarget, ch.reachArm) : null;
      if (rarm && mountReach) {
        // Exact target solve for this body's real arm lengths and live mount.
        // The gun remains welded to this hand during the extend/dwell phase.
        rarm.rotation.x = mountReach.shoulder * renv;
        rarm.rotation.y = 0;
        rarm.rotation.z = mountReach.roll * renv;
        rarm.position.z = 0;
        if (rarmJ) rarmJ.rotation.x = mountReach.elbow * renv;
        if (rother && ch.reachKind === "holster-back") {
          rother.rotation.x = -0.24 * renv;
          rother.rotation.z = -rsgn * 0.12 * renv;
        }
      } else if (rarm && ch.reachKind === "holster-back") {
        // Reach BEHIND and over the shoulder while the weapon prop travels to
        // the live back mount. Positive X swings this rig's arm backward;
        // positive Z lifts the right elbow away from the ribs so the hand does
        // not pass through the torso on its way to the sling.
        rarm.rotation.x = 1.18 * renv;
        rarm.rotation.y = -0.46 * renv;
        rarm.rotation.z = -0.78 * renv;
        rarm.position.z = -0.10 * renv;
        if (rarmJ) rarmJ.rotation.x = -1.68 * renv;
        if (rother) {
          rother.rotation.x = -0.24 * renv;
          rother.rotation.z = -rsgn * 0.12 * renv;
        }
      } else if (rarm && ch.reachKind === "holster-hip") {
        // The hand falls back and out to the actual right-hip mount. This is a
        // shorter, lower action than a back sling and keeps the elbow close.
        rarm.rotation.x = 0.46 * renv;
        rarm.rotation.y = -0.12 * renv;
        rarm.rotation.z = -0.34 * renv;
        rarm.position.z = -0.05 * renv;
        if (rarmJ) rarmJ.rotation.x = -0.62 * renv;
      } else if (rarm) {
        // upper arm swings forward and slightly down; the elbow stays soft so
        // the hand hangs at pocket height instead of pointing like a salute
        rarm.rotation.x = (-0.62 - 0.55 * high) * renv;
        rarm.rotation.y = rsgn * across * 0.30 * renv;
        rarm.rotation.z = rsgn * (0.20 - 0.26 * high) * renv;
        rarm.position.z = 0.16 * renv;
      }
      if (rarmJ && ch.reachKind !== "holster-back" && ch.reachKind !== "holster-hip") {
        rarmJ.rotation.x = -(0.85 - 0.30 * high) * renv;
      }
      // the OTHER hand drifts up and out — the distraction, the friendly touch
      if (rother && ch.reachKind !== "holster-back") {
        rother.rotation.x = -0.34 * renv;
        rother.rotation.z = -rsgn * 0.22 * renv;
      }
      // torso turns a little INTO the reach and leans in; nothing dramatic
      ch.body.rotation.y = rsgn * across * 0.22 * renv;
      ch.body.rotation.x = ch.lean + (0.13 + 0.06 * high) * renv;
      ch.body.position.y -= 0.05 * renv * (1 - high);
      // and the head looks the other way. This is the whole animation.
      if (ch.neck) {
        ch.neck.rotation.y = -rsgn * across * 0.42 * renv;
        ch.neck.rotation.x = -0.10 * renv;
        ch._reached = 1;
      }
    } else if (ch._reached) {
      /* THE NECK IS THE ONE CHANNEL NOTHING ELSE OWNS. Every other value the
         block above writes is pulled home by the gait/idle damps the frame
         after the timer clears — but in the ordinary standing/walking path
         `neck.rotation` is written by no one, so an interrupted reach (a KO, a
         pose that returns early mid-lift) would leave a man looking over his
         shoulder for the rest of the run. One falsy check, and it is the only
         bookkeeping this layer needs. */
      ch._reached = 0;
      if (ch.neck) { ch.neck.rotation.y = 0; ch.neck.rotation.x = 0; }
    }

    // Hands-up surrender/intimidation pose. This is a late animation layer so
    // gunpoint victims do not keep idle-swimming their arms while frozen.
    if (ch.surrender || ch.handsUp) {
      // upper arms drive well past vertical and splay outward; a SMALL elbow
      // bend tips the palms forward beside the head. (Filmstrip caught the
      // first attempt: a -0.9 elbow folded the forearms flat across the face.)
      if (ch.parts.la) {
        ch.parts.la.rotation.x = damp(ch.parts.la.rotation.x, -2.60, 18, dt);
        ch.parts.la.rotation.y = damp(ch.parts.la.rotation.y, 0.16, 14, dt);
        ch.parts.la.rotation.z = damp(ch.parts.la.rotation.z, -0.32, 14, dt);
        ch.parts.la.position.z = damp(ch.parts.la.position.z, 0.20, 14, dt);
      }
      if (ch.parts.ra) {
        ch.parts.ra.rotation.x = damp(ch.parts.ra.rotation.x, -2.60, 18, dt);
        ch.parts.ra.rotation.y = damp(ch.parts.ra.rotation.y, -0.16, 14, dt);
        ch.parts.ra.rotation.z = damp(ch.parts.ra.rotation.z, 0.32, 14, dt);
        ch.parts.ra.position.z = damp(ch.parts.ra.position.z, 0.20, 14, dt);
      }
      setElbow(J.la, -0.20, 16); setElbow(J.ra, -0.20, 16);
      ch.body.rotation.x = damp(ch.body.rotation.x, -0.07, 10, dt);
      ch.body.rotation.y = damp(ch.body.rotation.y, 0, 12, dt);
      ch.body.rotation.z = damp(ch.body.rotation.z, 0, 12, dt);
    }

    // ---- head: subtle counter-bob + breathing tilt, keeps eyes level ----
    // A HEADBUTT IS THE ONE MOVE WHERE THE HEAD IS THE FIST. This damp runs
    // after the punch block and would quietly pull 14% of the skull's travel
    // back toward "eyes level" on every frame of it — the counter-bob is right
    // for a body that is walking and wrong for a body throwing its forehead
    // through someone. Nothing else in the chain needs the exemption; every
    // other strike drives an arm and leaves the neck to this line.
    if (ch.neck && !(ch.punchT > 0 && ch.punchKind === "headbutt")) {
      ch.neck.rotation.x = damp(ch.neck.rotation.x, -ch.lean * 0.7 + (moving ? Math.sin(ch.phase * 2) * 0.02 : 0), 9, dt);
      ch.neck.rotation.z = damp(ch.neck.rotation.z, -ch.sway * 0.6, 9, dt);
    }

    // ---- FALLS AND GET-UPS, the head snap and the taser lock: the LAST pose
    // layer on purpose (CBZ.meleePoses.react, entities/meleeposes.js), so
    // nothing above pulls a man who is going down back upright.
    if (CBZ.meleePoses) CBZ.meleePoses.react(ch, dt, moving, J);
    // LAST inside the base animator: KO, stagger, punch and surrender all get
    // their final Euler before the shared socket is solved.
    lockCharacterHips(ch);
  }

  // ---- dramatic death sprawl (seeded variety; caller owns group topple).
  //      Real elbows/knees now sell the "broken heap": bent knees, folded
  //      arms — no more plank limbs on corpses. ----
  function deathPose(ch, seed, fall) {
    if (!ch || !ch.parts) return;
    beginCharacterHipFrame(ch);
    ch.sitting = false;
    const s = seed || 0;
    const p = ch.parts;
    const J = ch.low || {};
    const j = (k) => Math.sin(s * k);   // cheap per-corpse jitter in [-1,1]
    const knee = (g, v) => { if (g) g.rotation.set(Math.max(0, v), 0, 0); };
    const elbow = (g, v) => { if (g) g.rotation.set(Math.min(0, v), 0, 0); };
    let pick = Math.abs(j(5.1));        // 0..1
    if (fall != null) pick = pick * 0.5 + fall * 0.5;
    const tmpl = pick < 0.4 ? 0 : (pick < 0.75 ? 1 : 2);
    if (tmpl === 1) {
      // FACE-DOWN crumple: arms forward/under, legs trailing, head aside
      if (p.la) { p.la.rotation.set(-1.5 + j(1.7) * 0.4, 0.2, 0.4 + j(2.1) * 0.2); p.la.position.z = 0; }
      if (p.ra) { p.ra.rotation.set(-1.3 + j(2.9) * 0.4, -0.2, -0.5 - j(1.3) * 0.2); p.ra.position.z = 0; }
      elbow(J.la, -0.5 - Math.abs(j(3.7)) * 0.5); elbow(J.ra, -0.2 - Math.abs(j(4.1)) * 0.4);
      if (p.ll) { p.ll.rotation.set(-0.15 + j(3.3) * 0.15, 0, 0.2 + j(1.1) * 0.15); p.ll.scale.y = 1; }
      if (p.rl) { p.rl.rotation.set(0.1 + j(2.3) * 0.15, 0, -0.25 - j(2.7) * 0.15); p.rl.scale.y = 1; }
      knee(J.ll, 0.15 + Math.abs(j(6.1)) * 0.5); knee(J.rl, 0.45 + Math.abs(j(5.3)) * 0.6);
      if (ch.body) { ch.body.rotation.set(0.1 * j(1.9), 0, 0.08 * j(2.5)); ch.body.position.y = 0; }
      if (ch.neck) ch.neck.rotation.set(-0.4, 0.7 * (j(1.5) >= 0 ? 1 : -1), 0.25 * j(2.2));
    } else if (tmpl === 2) {
      // ON-THE-SIDE fold: knees drawn up, top arm flung across
      const side = j(4.3) >= 0 ? 1 : -1;
      if (p.la) { p.la.rotation.set(-0.6 + j(1.7) * 0.4, 0.25, (0.9 + j(2.1) * 0.2) * (side > 0 ? 1 : 0.4)); p.la.position.z = 0; }
      if (p.ra) { p.ra.rotation.set(-0.5 + j(2.9) * 0.4, -0.25, (-0.95 - j(1.3) * 0.2) * (side < 0 ? 1 : 0.4)); p.ra.position.z = 0; }
      elbow(J.la, -0.7 - Math.abs(j(3.1)) * 0.6); elbow(J.ra, -0.9 - Math.abs(j(2.6)) * 0.5);
      if (p.ll) { p.ll.rotation.set(-0.75 + j(3.3) * 0.25, 0, 0.30 + j(1.1) * 0.2); p.ll.scale.y = 1; }
      if (p.rl) { p.rl.rotation.set(-0.55 + j(2.3) * 0.25, 0, -0.28 - j(2.7) * 0.2); p.rl.scale.y = 1; }
      knee(J.ll, 1.1 + Math.abs(j(4.7)) * 0.5); knee(J.rl, 0.85 + Math.abs(j(3.9)) * 0.5);
      if (ch.body) { ch.body.rotation.set(0.18 * j(1.9), 0, side * 0.14); ch.body.position.y = 0; }
      if (ch.neck) ch.neck.rotation.set(-0.45, side * 0.55, side * 0.3);
    } else {
      // FACE-UP sprawl: arms flung out, legs splayed, one knee cocked
      if (p.la) { p.la.rotation.set(-0.9 + j(1.7) * 0.5, 0.25, 1.15 + j(2.1) * 0.25); p.la.position.z = 0; }
      if (p.ra) { p.ra.rotation.set(-0.7 + j(2.9) * 0.5, -0.25, -1.2 - j(1.3) * 0.25); p.ra.position.z = 0; }
      elbow(J.la, -0.35 - Math.abs(j(2.8)) * 0.55); elbow(J.ra, -0.15 - Math.abs(j(3.4)) * 0.35);
      if (p.ll) { p.ll.rotation.set(0.25 + j(3.3) * 0.2, 0, 0.4 + j(1.1) * 0.2); p.ll.scale.y = 1; }
      if (p.rl) { p.rl.rotation.set(-0.45 + j(2.3) * 0.3, 0, -0.45 - j(2.7) * 0.2); p.rl.scale.y = 1; }
      knee(J.ll, 0.1 + Math.abs(j(5.7)) * 0.3); knee(J.rl, 0.6 + Math.abs(j(6.3)) * 0.7);   // one cocked knee
      if (ch.body) { ch.body.rotation.set(0.12 * j(1.9), 0, 0.1 * j(2.5)); ch.body.position.y = 0; }
      if (ch.neck) ch.neck.rotation.set(-0.55, 0.5 * j(1.5), 0.3 * j(2.2));
    }
    lockCharacterHips(ch);
    // a corpse's feet fall slack (animChar stops running on the dead)
    ankleSolve(ch, 0, true);
  }

  // ---- seated death slump (owner: shot plane passengers die IN the seat).
  //      A corpse in a chair doesn't sprawl on the deck — it folds over its
  //      own lap and lolls toward one side. Direct writes in the deathPose
  //      idiom (animChar stops running on the dead, so the last write holds);
  //      the LEGS and the V2 model sink are deliberately untouched so the
  //      body keeps its seated fold and stays IN the chair instead of
  //      snapping to a standing pose to die. Seed gives per-corpse variety
  //      exactly like deathPose (runtime cosmetic — never a build path). ----
  function seatSlumpPose(ch, seed) {
    if (!ch || !ch.parts) return;
    beginCharacterHipFrame(ch);
    const s = seed || 0;
    const j = (k) => Math.sin(s * k);   // cheap per-corpse jitter in [-1,1]
    const side = j(3.1) >= 0 ? 1 : -1;
    if (ch.body) {
      ch.body.rotation.x = 0.5 + Math.abs(j(1.7)) * 0.32;         // collapse over the lap
      ch.body.rotation.y = side * 0.14;
      ch.body.rotation.z = side * (0.16 + Math.abs(j(2.3)) * 0.14); // loll into the seat back / aisle
      ch.body.position.y = -0.1;                                    // dead weight settles
    }
    // arms drop off the armrests and hang loose beside the thighs
    if (ch.parts.la) { ch.parts.la.rotation.set(-0.12 + j(1.3) * 0.1, 0, 0.16); ch.parts.la.position.z = 0; }
    if (ch.parts.ra) { ch.parts.ra.rotation.set(-0.18 + j(2.9) * 0.1, 0, -0.16); ch.parts.ra.position.z = 0; }
    const J = ch.low || {};
    if (J.la) J.la.rotation.set(-0.22 - Math.abs(j(3.7)) * 0.2, 0, 0);
    if (J.ra) J.ra.rotation.set(-0.16 - Math.abs(j(4.1)) * 0.2, 0, 0);
    // POSITIVE neck pitch drops the chin (KO's "lolled back" is the negative)
    if (ch.neck) ch.neck.rotation.set(0.55 + Math.abs(j(4.3)) * 0.25, side * 0.28, side * 0.22); // chin to chest
    lockCharacterHips(ch);
  }

  /* ---- WEAPON MOUNT POINTS (Fortnite-style stow rig) ---------------------
     Lazy + idempotent: three empty groups parented to rig.body, so mounted
     props ride the bob/sway/lean and follow every animation for free. Works
     on ANY rig from makeCharacter (player, peds, cops) — NPC systems may
     guard-call `CBZ.charMounts && CBZ.charMounts(actor.char)` and parent
     their stowed props to the returned groups.
       back  — primary long gun: diagonal across the back, muzzle up over the
               RIGHT shoulder (~40° off vertical), stock at the left hip,
               flank to the camera with a ~17° outward roll so the mag/grip
               tips off the back plane instead of burying in the spine.
       back2 — secondary long gun: the mirrored diagonal (muzzle over the
               LEFT shoulder), staggered 0.06 lower and 0.06 further out so
               two stowed rifles read as a clean X with no z-fighting where
               they cross.
       hip   — pistol holster ON the semantic right hip: muzzle down with a ~12°
               forward cant, grip to the rear, outboard of the thigh
               (|x| .46 > leg span .40) so it never buries in the leg.
     Consumers must OVERWRITE the hand-mount transform CBZ.buildActorWeapon
     ships on its props: prop.position.set(0,0,0); prop.rotation.set(0,0,0);
     then their own scale. Prop convention: barrel -Z, rail +Y, grip -Y;
     Euler order XYZ. Endpoints verified numerically: a 1.5u rifle at 0.92
     scale spans (-0.33,1.22)→(0.55,2.26) on `back` — clear of the head box
     (y 1.88..2.48, |x|≤0.3, z≥-0.3), inside the shoulder line (0.62),
     behind the torso back plane (z=-0.25). */
  /* ---- THE BODY'S REAL SECTION (CBZ.bodySection) --------------------------
     The outline of THIS body round the waist at any height, read off the
     shaped torso (rig.torsoShape: the chest column rings, the pelvis rings
     with belly and seat) and the thighs. It used to live inside
     entities/dutykit.js, which built every officer's belt and holster round
     it; the player's stowed pistol meanwhile hung off a hand-typed |x| that
     knew nothing about the body. One outline now, owned by the body:
       outline(ch, y)          48 [x, z] points from the front, +x = the
                               wearer's LEFT, model units
       span(ch, y0, y1, steps) the outermost outline over a height range
       at(list, th)            the point at any angle round it
       normal(list, th)        its outward normal there ([nx, 0, nz]) */
  const bodySection = (function () {
    // ---- the body's real section --------------------------------------------
    const gss = (x, s) => Math.exp(-(x / s) * (x / s));
    // radius of a superellipse ring {a, zf, zb, zc, n} along direction (dx, dz)
    function ringRay(R, dx, dz) {
      const b = dz >= 0 ? R.zf : R.zb, n = R.n || 2.5;
      const t = Math.pow(Math.pow(Math.abs(dx / R.a), n) + Math.pow(Math.abs(dz / b), n), -1 / n);
      return [t * dx, (R.zc || 0) + t * dz];
    }
    /* The body's outline at height y: 48 points round the waist from the
       front, the outermost of the chest column (with its own front/back relief
       read off rig.torsoFrontZ/BackZ), the pelvis (with belly and seat) and,
       below the hips, the two thighs. Model units. */
    const NS = 48;
    function outline(ch, y) {
      const S = ch.torsoShape, P = ch.profile, out = [];
      for (let j = 0; j < NS; j++) {
        const th = j / NS * Math.PI * 2, dx = Math.sin(th), dz = Math.cos(th);
        let best = 0, bx = 0, bz = 0;
        const take = (x, z) => { const r = Math.hypot(x, z); if (r > best) { best = r; bx = x; bz = z; } };
        if (y >= S.base - 0.01 && y <= S.yN) {
          const p = ringRay(S.at(y), dx, dz);
          let z = p[1];
          if (dz > 0.05 && ch.torsoFrontZ) z = Math.max(z, ch.torsoFrontZ(p[0], y));
          else if (dz < -0.05 && ch.torsoBackZ) z = Math.min(z, ch.torsoBackZ(p[0], y));
          take(p[0], z);
        }
        if (y >= S.pBot && y <= S.pTop + 0.005) {
          const p = ringRay(S.pel(Math.min(y, S.pTop)), dx, dz);
          let z = p[1];
          if (dz < 0) z -= (S.glute || 0) * 0.16 * S.pd * gss(y - (S.hipY - 0.015 * S.pk), 0.055 * S.pk) * Math.pow(-dz, 0.8);
          else z += (S.belly || 0) * 0.05 * S.pd * gss(y - (S.pTop - 0.03 * S.pk), 0.05 * S.pk) * Math.pow(dz, 0.8);
          take(p[0], z);
        }
        if (y < S.hipY + 0.02 && P) {
          // the thighs: a circle round each hip joint (their outer extent does
          // not move when a leg swings — the swing is fore and aft)
          const r = P.legW / 2 + 0.01;
          for (const sx of [-1, 1]) {
            const cx = sx * P.hipX, px = cx * dx;                 // ray-circle, far root
            const disc = px * px - (cx * cx - r * r);
            if (disc >= 0) { const t = px + Math.sqrt(disc); if (t > 0) take(t * dx, t * dz); }
          }
        }
        out.push([bx, bz]);
      }
      return out;
    }
    // the outermost outline over [y0, y1]
    function span(ch, y0, y1, steps) {
      steps = steps || 4;
      let acc = null;
      for (let s = 0; s <= steps; s++) {
        const o = outline(ch, y0 + (y1 - y0) * s / steps);
        if (!acc) { acc = o; continue; }
        for (let j = 0; j < NS; j++) if (Math.hypot(o[j][0], o[j][1]) > Math.hypot(acc[j][0], acc[j][1])) acc[j] = o[j];
      }
      return acc;
    }
    function samplesAt(list, th) {                             // outline point at any angle
      const f = ((th / (Math.PI * 2)) % 1 + 1) % 1 * NS, j = Math.floor(f) % NS, k = (j + 1) % NS, w = f - Math.floor(f);
      return [list[j][0] * (1 - w) + list[k][0] * w, list[j][1] * (1 - w) + list[k][1] * w];
    }
    function outNormal(list, th) {
      const a = samplesAt(list, th - 0.06), b = samplesAt(list, th + 0.06);
      let nx = b[1] - a[1], nz = -(b[0] - a[0]);
      const p = samplesAt(list, th);
      if (nx * p[0] + nz * p[1] < 0) { nx = -nx; nz = -nz; }
      const l = Math.hypot(nx, nz) || 1;
      return [nx / l, 0, nz / l];
    }
    return { NS, outline, span, at: samplesAt, normal: outNormal };
  })();
  CBZ.bodySection = bodySection;

  /* ---- THE HOLSTER SITS ON THE HIP -----------------------------------------
     OWNER (iPad): "the holster on the side of the player's hip is like a foot
     away from the hip. It's floating."

     The hip mount was x = -max(0.46·s, widestTorsoSlot/2 + 0.04), y 1.05·s,
     z -0.20·s, a fixed Euler. Two faults stacked on that one line:
       · "widest torso slot" is the CHEST when the body has no separate waist
         box (every adult male), so a holster at belt height was pushed out
         by the width of the ribcage plus 4 cm. Measured with the real
         sidearm: 7.4 cm of air on the average man, 9.6 on a muscular one,
         3-6 on everyone else; the gun's broad face (the slide) also stood
         canted 15° off the hip, so from behind the gap read wider still.
       · the pistol model's own origin is its grip, so even a mount ON the
         skin left the slide wherever the grip offset put it.
     Now the mount is SOLVED, per rig, from the outline above, the way the
     duty belt hangs its holster: a frame on the body's own section at the
     semantic right hip (local -X), a little behind the side seam, pushed
     out until the gun's back face clears the pelvis AND both thighs over the
     whole height it hangs. Axes: +X = the section's outward normal (the
     gun's flat lies along the hip), +Z up with a forward muzzle cant, so the
     barrel (prop -Z) points down and the grip (prop -Y) to the rear.
     userData.seat tells systems/holsterprops.js where the gun's faces go:
     its inner face `clr` off the body, its top `rise` above the belt line.
     It rides rig.body, the node the pelvis is on, so it moves with the hips;
     the thighs swing fore and aft under it (their outer extent does not move,
     which is why the solve clears them as circles round each hip joint). */
  const HIP_SEAT = {
    deg: -108,       // round the waist from the front (+x = wearer's left): right side, just behind the seam
    hang: 0.24,      // m the gun hangs below the belt line (the clear-of-body band)
    width: 0.06,     // m the gun's back face spans across the hip
    clr: 0.003,      // m of air between the gun and the body
    rise: 0.045,     // m the grip end stands above the belt line
    cant: 0.21,      // forward muzzle cant (tan): ~12°, grip to the rear
  };
  function hipSeatPose(rig, s) {
    const S = rig.torsoShape, P = rig.profile;
    const hs = (rig.group && rig.group.userData && rig.group.userData.humanScale) || 0.7;
    if (!S || !P || !S.pel || !S.at || !(S.pTop > 0)) return null;
    const m = 1 / hs;                                       // metres -> model units
    const top = S.pTop + 0.005 * m;                         // the belt line (the duty belt's top)
    const low = bodySection.span(rig, top - HIP_SEAT.hang * m, top, 8);
    const th = HIP_SEAT.deg * Math.PI / 180;
    const p = bodySection.at(low, th), n = bodySection.normal(low, th);
    const tx = -n[2], tz = n[0];                            // horizontal tangent (u x n, u = +Y)
    // push out until every outline point under the gun's back face is behind it
    let push = 0;
    for (let j = 0; j < bodySection.NS; j++) {
      const q = low[j], dx = q[0] - p[0], dz = q[1] - p[1];
      if (Math.abs(dx * tx + dz * tz) > HIP_SEAT.width * m / 2 + 0.01) continue;
      const dn = dx * n[0] + dz * n[2];
      if (dn > push) push = dn;
    }
    const pos = new THREE.Vector3(p[0] + n[0] * push, top, p[1] + n[2] * push);
    // front tangent: the horizontal perpendicular to n that faces +Z
    const f = new THREE.Vector3(-n[2], 0, n[0]);
    if (f.z < 0) f.negate();
    const X = new THREE.Vector3(n[0], 0, n[2]).normalize();
    const Z = new THREE.Vector3(0, 1, 0).addScaledVector(f, -HIP_SEAT.cant);   // up, butt back = muzzle forward
    Z.addScaledVector(X, -Z.dot(X)).normalize();
    const Y = new THREE.Vector3().crossVectors(Z, X).normalize();
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
    return { pos, q, seat: { clr: HIP_SEAT.clr * m, rise: HIP_SEAT.rise * m } };
  }
  /* Where a prop hung on a SEATED mount goes inside it: its inner face (min X)
     `clr` off the body, its top end (max Z) `rise` above the belt line, centred
     across the hip. Measured from the prop's own vertices with its scale
     applied (a weapon added tomorrow is seated by construction); a mount with
     no seat leaves the prop at its origin. Writes and returns `out`. */
  const _seatBox = new THREE.Box3(), _seatV = new THREE.Vector3(), _seatInv = new THREE.Matrix4(), _seatM = new THREE.Matrix4();
  function charMountSeat(mount, prop, out) {
    out = out || new THREE.Vector3();
    const fit = mount && mount.userData && mount.userData.seat;
    if (!fit || !prop) return out.set(0, 0, 0);
    prop.updateMatrixWorld(true);
    _seatInv.copy(prop.matrixWorld).invert();
    _seatBox.makeEmpty();
    prop.traverse((o) => {
      if (!o.isMesh || !o.visible || !o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
      _seatM.multiplyMatrices(_seatInv, o.matrixWorld);
      const p = o.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) _seatBox.expandByPoint(_seatV.fromBufferAttribute(p, i).applyMatrix4(_seatM));
    });
    if (_seatBox.isEmpty()) return out.set(0, 0, 0);
    const sc = prop.scale, mn = _seatBox.min, mx = _seatBox.max;
    return out.set(fit.clr - mn.x * sc.x, -(mn.y + mx.y) / 2 * sc.y, fit.rise - mx.z * sc.z);
  }
  CBZ.charMountSeat = charMountSeat;
  function charMounts(rig) {
    if (!rig || !rig.body) return null;
    if (rig._mounts) return rig._mounts;
    const mk = (px, py, pz, ex, ey, ez) => {
      const m = new THREE.Group();
      m.position.set(px, py, pz);
      m.rotation.set(ex, ey, ez);
      m.userData.isMount = true;   // non-empty userData: batching spares it
      rig.body.add(m);
      return m;
    };
    // Mount heights were authored against the adult male torso. Re-anchor them
    // on THIS body's torso column so a stowed rifle rides a shorter back
    // instead of hovering behind the head; s is 1 for the adult, so every
    // existing rig keeps the exact hand-tuned numbers above.
    const pf = rig.profile;
    const s = pf ? (pf.legUp + pf.legLo + pf.torsoH) / (0.95 + 0.95) : 1;
    rig._mounts = {
      back:  mk(-0.14 * s, 1.44 * s, -0.36 * s, 1.571, -0.698, -1.271),
      back2: mk( 0.14 * s, 1.38 * s, -0.42 * s, 1.571,  0.698, -1.271),
      // semantic right = local -X (makeCharacter's shoulder roots); the
      // fallback is only for a rig with no shaped torso to solve against
      hip:   mk(-0.46 * s, 1.05 * s, -0.20 * s, -1.781, 0.26, Math.PI),
      s,     // the torso-column scale every mount was re-anchored by (entities/keycard.js reads it)
    };
    const seat = hipSeatPose(rig, s);
    if (seat) {
      rig._mounts.hip.position.copy(seat.pos);
      rig._mounts.hip.quaternion.copy(seat.q);
      rig._mounts.hip.userData.seat = seat.seat;
    }
    for (const k in SLING) {
      const m = rig._mounts[k], d = SLING[k];
      m.userData.slingRest = { p: m.position.clone(), q: m.quaternion.clone() };
      m.userData.slingFlat = {
        p: m.position.clone().add(new THREE.Vector3(d.dx * s, d.dy * s, d.dz * s)),
        q: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), d.rz).multiply(m.quaternion),
      };
      m.userData.slingK = 0;
    }
    return rig._mounts;
  }
  /* ---- A SLING GIVES --------------------------------------------------------
     The back mounts above are a rifle hanging from a sling on a STANDING body:
     muzzle up past the shoulder. Go prone and the head tips ~1.4 rad back over
     those shoulders to look down-range (PRONE_NECK_ARMED), straight into the
     muzzle end — measured 14.8 mm of sniper through the back of the skull. A
     real slung rifle does not stay stood up on a man lying flat: it slides
     down and rolls to lie ACROSS the shoulder blades, muzzle out past the
     shoulder instead of over it. So both long-gun mounts swing toward
     horizontal about the back's own normal (body Z) and slide toward the
     hips, blended by how far the body is down (_proneB, damped above every
     early return in animCharBody). A STANDING head tipped back (the audit's
     lookUp / turnUp) was measured clear with the upright sling, so it does not
     move it. The hip holster is a belt, not a sling, and does not move. */
  const SLING = {
    back:  { rz: -0.62, dx: 0.02, dy: -0.10, dz: -0.02 },
    back2: { rz:  0.62, dx: -0.02, dy: -0.10, dz: -0.02 },
  };
  function slingPose(rig) {
    const M = rig._mounts;
    let k = rig._proneB || 0;
    if (k < 1e-3) k = 0;
    for (const key in SLING) {
      const m = M[key], u = m.userData;
      if (!u.slingRest || Math.abs(u.slingK - k) < 1e-4) continue;
      u.slingK = k;
      m.position.lerpVectors(u.slingRest.p, u.slingFlat.p, k);
      m.quaternion.copy(u.slingRest.q).slerp(u.slingFlat.q, k);
    }
  }

  /* ---- A HELD GUN RESTS ON THE GROUND, IT DOES NOT SINK INTO IT ----------
     OWNER: "the gun should respect the ground too."

     There was already a solve for this and it could not win, because it only
     ever rotated the barrel's DIRECTION (systems/holsterprops.js →
     CBZ.weaponPhysics.clearDirection). Two things a direction cannot fix:
       (a) A GUN IS NOT A RAY. The M249 hangs an ammo box and a pair of bipod
           legs 0.267 m BELOW its own barrel axis at the drawn scale; a sniper
           hangs a magazine and a pistol grip. Hold the axis a token 0.05 m off
           the deck and the box is still a quarter-metre in the dirt. The one
           honest question is where the model's LOWEST VERTEX is, and that is
           measured here — from the prop's own geometry, so a weapon added
           tomorrow is covered by construction and no table lists a gun.
       (b) A HAND CAN BE UNDER THE FLOOR. Prone put the socket 0.446 m below
           the surface (see PRONE_ARM_PITCH). From there the direction solve
           can only pitch the barrel at the sky — measured 80° — which is how
           a rifle ended up planted in the ground like a fence post. Position
           is the missing degree of freedom, so this pass moves the SOCKET.

     The solve, once per frame for the player's rig only:
       bottom = propWorldY + (centre·q).y − Σ|R[1][j]|·half[j]      (its real
                lowest point at this orientation — the wpMeasureSpan identity
                systems/actorweapons.js already uses on a dropped gun)
       lift   = groundUnderItsOwnFOOTPRINT + CLEAR − bottom
     Sampled at five points across the weapon's world AABB, NOT under the
     hand: a 1.4 m gun lying across a kerb or down a slope is judged at both
     ends, which is the slope case the owner asked for.

     A DEPLOYED BIPOD IS THE ONE CASE THAT ALSO PULLS DOWN. Everything else
     may only ever be LIFTED (a gun floating because its owner is on a step is
     a lesser sin than a gun in the dirt, and a two-way solve on a walking
     body would bob the weapon). When fpsmode says the legs are loaded and the
     model actually has legs, the gun is driven ONTO the surface instead — that
     is what makes a prone M249 read as deployed rather than as a rifle held
     near the floor. One notion of "supported", owned by fpsmode; this file
     only asks.

     Cost: the local bounds are measured ONCE per prop and cached on it; the
     per-frame work is one quaternion, nine multiplies and five floor samples
     (CBZ.floorAt is ~0.14 µs since the terrain match landed), for ONE rig. */
  const GUN_REST_CLEAR = 0.025;    // m of air under the lowest vertex
  const GUN_REST_FEET = 0.002;     // …but a deployed bipod's feet are ON the ground
  const GUN_FOOT_PAD = 0.010;      // model units from a bipod foot point to its sole (lmg.js foot box)
  const GUN_REST_MAX_UP = 0.60;    // never levitate a gun further than this
  // …nor bury the hand chasing a bipod. Measured: a 34% grade drops the ground
  // 0.28 m across a prone shooter's forward reach, so the cap has to clear that
  // or the steepest playable hillside clips a muzzle.
  const GUN_REST_MAX_DOWN = 0.32;
  const _grPos = new THREE.Vector3();
  const _grScale = new THREE.Vector3();
  const _grQ = new THREE.Quaternion();
  const _grHandQ = new THREE.Quaternion();
  const _grCentre = new THREE.Vector3();
  const _grHalf = new THREE.Vector3();
  const _grAxis = new THREE.Vector3();
  const _grDelta = new THREE.Vector3();
  const _grInv = new THREE.Matrix4();
  const _grRel = new THREE.Matrix4();
  const _grCorner = new THREE.Vector3();
  const _grBox = new THREE.Box3();
  const _grStats = { solves: 0, lifted: 0, rested: 0, maxLift: 0, maxDrop: 0, sunk: 0, residual: 0,
                     last: { floor: 0, bottom: 0, need: 0, deployed: false, eY: 0, prop: null, kids: 0 } };

  function gunFloorAt(x, z, fromY) {
    if (CBZ.groundAt) {
      try { const y = CBZ.groundAt(x, z, fromY); if (isFinite(y)) return y; } catch (e) {}
    }
    if (CBZ.floorAt) {
      try { const y = CBZ.floorAt(x, z); if (isFinite(y)) return y; } catch (e) {}
    }
    return 0;
  }
  // Geometry bounds in the prop's OWN unscaled local frame, measured once.
  // (Its world scale is folded in per frame, so a rig that rescales — a child
  // body, a studio turntable — never needs a re-measure.)
  function gunLocalBounds(prop) {
    let c = prop.userData && prop.userData._restBounds;
    if (c) return c;
    if (prop.userData && prop.userData._restNone) return null;
    prop.updateWorldMatrix(true, true);
    _grInv.copy(prop.matrixWorld).invert();
    _grBox.makeEmpty();
    prop.traverse(function (o) {
      const geo = o.geometry;
      if (!geo) return;
      if (!geo.boundingBox && geo.computeBoundingBox) geo.computeBoundingBox();
      const b = geo.boundingBox;
      if (!b || b.isEmpty()) return;
      _grRel.multiplyMatrices(_grInv, o.matrixWorld);
      for (let i = 0; i < 8; i++) {
        _grCorner.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z);
        _grBox.expandByPoint(_grCorner.applyMatrix4(_grRel));
      }
    });
    if (_grBox.isEmpty()) {
      prop.userData = prop.userData || {};
      prop.userData._restNone = true;      // a prop with no geometry is not a gun
      return null;
    }
    _grBox.getCenter(_grCentre);
    _grBox.getSize(_grHalf);
    c = { cx: _grCentre.x, cy: _grCentre.y, cz: _grCentre.z,
          hx: _grHalf.x / 2, hy: _grHalf.y / 2, hz: _grHalf.z / 2 };
    prop.userData = prop.userData || {};
    prop.userData._restBounds = c;
    return c;
  }
  /* The drawn weapon on this rig's hand socket, or null.
     THE TEST IS `weaponId`, NOT `visible`, and that is not fussiness: the
     socket carries TWO children in city play — the prop CBZ.buildActorWeapon
     stamped with a weaponId (what holsterprops.js orients and what you SEE)
     and systems/fpsmode.js's legacy `carriedGun`, a plain Group that
     holsterprops hides at onAlways(54), i.e. AFTER this pass has already run
     for the frame. Measuring on `visible` therefore sampled the LEGACY group,
     whose 1.70 m unoriented span put its "lowest vertex" 0.7 m under the hand
     and levitated every prone gun by 0.48 m. Measured, not guessed — the
     preset dumped `[Group:hid:dy1.70 | lmg:vis:dy0.46]` and the fault fell out. */
  function heldGunProp(socket) {
    if (!socket) return null;
    const kids = socket.children;
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      if (k.visible && k.userData && k.userData.weaponId && k.children && k.children.length) return k;
    }
    return null;
  }
  function gunGroundRest(ch, dt) {
    const socket = ch.sockets && (ch.sockets.thirdPersonWeapon || ch.sockets.weapon);
    if (!socket) return;
    if (!socket.userData._restBase) socket.userData._restBase = socket.position.clone();
    const base = socket.userData._restBase;
    const drawn = heldGunProp(socket);
    // Publish what the prone pose branch keys its arms off (a body with empty
    // hands must not hold them at gun height). Deliberately read BEFORE the
    // solve's own flag: whether there is a gun in the hand is a fact about the
    // rig, not a feature of the ground solve, so CHAR_GUN_GROUND_REST=false
    // must not silently flatten the prone firing posture too.
    ch._gunPoseK = damp(ch._gunPoseK || 0, drawn ? 1 : 0, 10, dt);
    const prop = (CBZ.CONFIG && CBZ.CONFIG.CHAR_GUN_GROUND_REST === false) ? null : drawn;
    // `need` below is measured off the gun WHERE IT IS, i.e. with last frame's
    // offset already applied, so the new target is prev + need. Solving for
    // `need` alone is a feedback loop that converges on HALF the correction —
    // which reads as "the fix almost worked", the worst kind of bug to chase.
    const prevLift = ch._gunRestY || 0;
    let want = 0;
    if (prop) {
      const b = gunLocalBounds(prop);
      if (b) {
        _grStats.solves++;
        prop.updateWorldMatrix(true, false);
        prop.matrixWorld.decompose(_grPos, _grQ, _grScale);
        _grCentre.set(b.cx * _grScale.x, b.cy * _grScale.y, b.cz * _grScale.z).applyQuaternion(_grQ);
        const hx = Math.abs(b.hx * _grScale.x), hy = Math.abs(b.hy * _grScale.y), hz = Math.abs(b.hz * _grScale.z);
        // vertical / horizontal half-extents of the ORIENTED box, in world
        const eY = Math.abs(_grAxis.set(1, 0, 0).applyQuaternion(_grQ).y) * hx +
                   Math.abs(_grAxis.set(0, 1, 0).applyQuaternion(_grQ).y) * hy +
                   Math.abs(_grAxis.set(0, 0, 1).applyQuaternion(_grQ).y) * hz;
        const eX = Math.abs(_grAxis.set(1, 0, 0).applyQuaternion(_grQ).x) * hx +
                   Math.abs(_grAxis.set(0, 1, 0).applyQuaternion(_grQ).x) * hy +
                   Math.abs(_grAxis.set(0, 0, 1).applyQuaternion(_grQ).x) * hz;
        const eZ = Math.abs(_grAxis.set(1, 0, 0).applyQuaternion(_grQ).z) * hx +
                   Math.abs(_grAxis.set(0, 1, 0).applyQuaternion(_grQ).z) * hy +
                   Math.abs(_grAxis.set(0, 0, 1).applyQuaternion(_grQ).z) * hz;
        const cxW = _grPos.x + _grCentre.x, czW = _grPos.z + _grCentre.z;
        let bottom = _grPos.y + _grCentre.y - eY;
        const from = _grPos.y + _grCentre.y + eY + 0.4;
        let floor = gunFloorAt(cxW, czW, from);
        floor = Math.max(floor, gunFloorAt(cxW + eX, czW + eZ, from));
        floor = Math.max(floor, gunFloorAt(cxW - eX, czW - eZ, from));
        floor = Math.max(floor, gunFloorAt(cxW + eX, czW - eZ, from));
        floor = Math.max(floor, gunFloorAt(cxW - eX, czW + eZ, from));
        // a DEPLOYED bipod is the only case that also settles DOWN onto the
        // surface; everything else may only ever be lifted out of it.
        const bip = prop.userData && prop.userData.bipod;
        const deployed = !!(ch.aimBipod && bip);
        /* …and once lmg.js has the legs fully out, the FEET are what stand on
           the deck, judged at the feet. The oriented box above is a bound, and
           on a gun tipped even 3 degrees its "lowest corner" is a point under
           the stock that does not exist — measured, it held the real feet
           64 mm in the air. Mid-swing the box is used (re-measured as the legs
           move), so the gun rides up onto the legs as they unfold. */
        if (deployed && bip.feet && bip.deployed >= 1) {
          bottom = Infinity; floor = -Infinity;
          for (let i = 0; i < bip.feet.length; i++) {
            _grCorner.copy(bip.feet[i]).applyMatrix4(prop.matrixWorld);
            bottom = Math.min(bottom, _grCorner.y - GUN_FOOT_PAD * _grScale.y);
            floor = Math.max(floor, gunFloorAt(_grCorner.x, _grCorner.z, _grCorner.y + 0.4));
          }
        }
        const need = floor + (deployed ? GUN_REST_FEET : GUN_REST_CLEAR) - bottom;
        want = deployed ? prevLift + need : Math.max(0, prevLift + need);
        if (need > 0.02) _grStats.sunk++;
        // THE PINNABLE NUMBER. `sunk` is the raw fault rate BEFORE correction
        // and it will always be non-zero (a pose transition is allowed one
        // frame in the dirt); this is how deep the gun was still buried once
        // the offset had settled, and it is the thing that must stay at zero.
        if (Math.abs(prevLift - want) < 0.01 && need > _grStats.residual) _grStats.residual = need;
        if (want > _grStats.maxLift) _grStats.maxLift = want;
        if (-want > _grStats.maxDrop) _grStats.maxDrop = -want;
        if (deployed) _grStats.rested++; else if (want > 0) _grStats.lifted++;
        const L = _grStats.last;   // reused, never reallocated — this runs every frame
        L.floor = floor; L.bottom = bottom; L.need = need; L.deployed = deployed;
        L.eY = eY; L.prop = prop.userData.weaponId || "?"; L.kids = socket.children.length;
      }
    }
    want = Math.max(-GUN_REST_MAX_DOWN, Math.min(GUN_REST_MAX_UP, want));
    // rise fast (a gun in the dirt is a bug the eye catches), settle slower
    ch._gunRestY = damp(prevLift, want, want > prevLift ? 18 : 9, dt);
    if (Math.abs(ch._gunRestY) < 1e-4) ch._gunRestY = 0;
    /* THE LIFT RIDES THE ARM, NEVER THE SOCKET. This pass used to translate
       the weapon socket inside the hand by the lift, and every hold that
       seats the gun off its OWN cached solve (systems/actorweapons.js
       CBZ.gunHold: the low-ready and ready poses the player copies each frame)
       then wrote the gun's local transform back relative to that displaced
       socket: the rifle left the fist by the whole lift. A teen crouched at
       low ready with a long gun had the stock on the ground, the lift wound up
       to 0.5 m and the gun floated 60 cm out of both hands
       (tools/gun-hold-check.mjs, carry-crouch). The hands are what hold the
       gun up off the ground, so the lift is published here and spent on the
       WRIST (CBZ.gunHold.fire's `lift`, and gunhands.js after the cached
       hold): the fist comes up and the gun comes up in it. The socket stays
       where the rig built it. */
    if (socket.position.x !== base.x || socket.position.y !== base.y || socket.position.z !== base.z) {
      socket.position.copy(base);
    }
  }
  /* Ratchet: `sunk` counts frames the drawn weapon's lowest vertex was still
     below the ground BEFORE this pass corrected it — it is the raw fault rate
     and may only ever be read alongside `lifted`/`rested`, which are the
     corrections. `maxLift` is the deepest hole this solve had to climb out of
     (metres); anything approaching GUN_REST_MAX_UP means a POSE is wrong and
     this pass is papering over it, which is exactly what the prone arms were
     doing before PRONE_ARM_PITCH was solved. */
  CBZ.charGunRestAudit = function () {
    return {
      solves: _grStats.solves, sunk: _grStats.sunk,
      lifted: _grStats.lifted, rested: _grStats.rested,
      // metres the SETTLED gun was still below ground — pin this at 0
      residual: Math.round(_grStats.residual * 1000) / 1000,
      maxLift: Math.round(_grStats.maxLift * 1000) / 1000,
      maxDrop: Math.round(_grStats.maxDrop * 1000) / 1000,
      clear: GUN_REST_CLEAR, capUp: GUN_REST_MAX_UP, capDown: GUN_REST_MAX_DOWN,
      live: !!(CBZ.playerChar && CBZ.playerChar._gunRestY != null),
      restY: CBZ.playerChar ? (CBZ.playerChar._gunRestY || 0) : null,
      // the last solve's raw terms, so a tool can see WHICH prop was measured,
      // where its lowest vertex was and what surface it was answering to
      last: _grStats.solves ? _grStats.last : null,
    };
  };

  /* THE RATCHET for "a character is a BODY, never a resized adult" lives in
     city/childhood.js as CBZ.childBodyAudit() — `faked` counts live peds whose
     group.scale still deviates from 1, and it is pinned at zero in the math
     gate. It is deliberately NOT duplicated here: this file had a rig-level
     version of the same count for a while, and two ratchets measuring one
     invariant is precisely the parallel bookkeeping the BLOCK LAW kills. The
     rig's job is to make the real body cheap to build; childhood.js's job is to
     prove nobody is faking one. */

  CBZ.makeCharacter = makeCharacter;
  CBZ.charProfile = charProfile;
  // Published so city/clothes.js can stop keeping its own copy of it — a
  // duplicated geometry constant that drifts is a seam nobody notices until
  // a hemline is 6cm wrong on every woman in the city.
  CBZ.CHAR_WAIST_TUCK = WAIST_TUCK;
  CBZ.CHAR_YOKE_CLEAR = YOKE_CLEAR;
  /* ---- WHERE THE WRIST IS, in the ELBOW group's frame -------------------
     (`rig.low.la` / `part.userData.low` — the frame every forearm accessory
     in this game mounts into.)

     OWNER BUG: "watches are on HANDS now — move them up to WRISTS." THREE
     files hang hardware off the forearm (bling.js's watch + bracelet,
     charpanel.js's portrait watch, restrain.js's zip-ties) and every one of
     them had typed its OWN constant against the adult-male rig. Two of the
     three landed inside the hand box, because they were measured against the
     wrist SOCKET (`leftHand`, at -armLo - 0.01) rather than against the hand
     that is actually DRAWN — and the drawn hand is limb()'s `cap`, which is
     0.03 lower and (capH + 0.03) TALL, so it reaches up to `capH - lowerH`.
     That is 0.20 - 0.46 = -0.26 on an adult male: bling's watch at -0.36 and
     restrain's tie at -0.42 were both buried in it.

     THE HAND IS REAL NOW (HANDS block): the forearm box stops at the crease
     (handH - armLo) and the first-person hand hangs from it, so every number
     below is read off that hand — its size off bodyHandFit, its length off
     the relaxed body-LOD geometry itself. Nothing here is a taste number, and
     it is all read off THIS rig's profile, so a woman's shorter forearm and a
     child's much shorter one put their own hardware on their own wrist with
     no per-body table anywhere and no call-site edit. Degrade-safe: returns
     null with the flag off (each caller keeps its old literal as the
     fallback) and never throws on a stub rig.

     RINGS go on the HAND MESH itself (ringHand), in its own metre frame at
     the base of a finger — the knuckle point is the one spot on a finger that
     does not move when the hand closes on a gun. ringK scales a part authored
     in rig units (bling's 0.045 band) down onto a real finger. */
  let _handRestLen = null;
  function handRestLen() {
    if (_handRestLen != null) return _handRestLen;
    const H = CBZ.fpHands;
    if (!H || !H.bodyHandGeometry) return 0.177;
    const g = H.bodyHandGeometry(1, "relaxed", 1);
    if (!g.boundingBox) g.computeBoundingBox();
    return (_handRestLen = -g.boundingBox.min.z);
  }
  CBZ.charArmLandmarks = function (ch) {
    if (CBZ.CONFIG && CBZ.CONFIG.CHAR_WRIST_LANDMARK === false) return null;
    const P = ch && ch.profile;
    const armLo = (P && P.armLo > 0) ? P.armLo : ARM_LO;   // elbow -> old wrist line
    const handH = (P && P.handH > 0) ? P.handH : 0.20;
    const fit = (ch && ch.handFit) || bodyHandFit({ handH: handH, armLo: armLo, armW: (P && P.armW) || 0.30 });
    const handTop = handH - armLo;                         // the wrist crease = the forearm's end
    const H = CBZ.fpHands;
    const palm = (H && H.PALM) ? H.PALM.len : 0.096;
    const rh = ch && ch.parts && ch.parts.ra && ch.parts.ra.userData && ch.parts.ra.userData.cap;
    return {
      handTop: handTop,                                    // the wrist crease
      handBottom: handTop - handRestLen() * fit.s,         // relaxed fingertips
      // A BAND GOES HERE: just proximal of the crease, on the last of the
      // forearm. The rise clears the fattest band in the game (bling's torus
      // tube is 0.028) with a millimetre of skin to spare.
      wrist: handTop + 0.04,
      // the knuckle line of the relaxed hand (elbow frame)
      hand: handTop - palm * fit.s,
      forearmTop: 0.06,                    // the lower box tucks 0.06 into the upper
      ringHand: (rh && rh.userData && rh.userData.fit) ? rh : null,
      ringFingers: (H && H.FINGERS) ? H.FINGERS : null,
      ringK: 0.0100 / 0.045,
    };
  };
  /* ---- HEAD LANDMARKS for what hangs off a head (entities/jewelry_kit.js):
     the EAR LOBE, read off earGeometry's own outline (polar rho 0.72 at the
     bottom of the ear, mid-way through the lobe's thickness), so an earring
     is pierced through the lobe this head actually drew instead of floating
     16 cm in front of it; the tiara's band line; the head scale. All in the
     NECK group's frame (the head mesh sits at y = headSize/2, scaled hk). */
  /* ---- THE HEAD'S REAL SURFACE, for anything that sits ON a face ----------
     (entities/eyewear.js fits every pair of glasses to it). One record per
     (form, nose), cached, all in the UNIT FACE FRAME: x across, u up from the
     chin (0) to the crown (0.60), z forward; the neck frame is this times
     hk = headSize/0.60, because the head mesh and the face groups are scaled
     uniformly by exactly that. What it carries is what headGeometry drew:
       sdf(x,u,z)   the skull (no socket carve: the carve only goes INWARD, so
                    a point outside this is outside the drawn skin)
       hit(o,d,out) where a ray from inside the skull leaves it
       nose         the near head's nose vertices [x,u,z,...] (z > the face plane)
       ear          the +x ear's vertices [x,u,z,...] (mirror x for the other)
       eye          {x, y, front, r} the eyeballs; brow {y0, xi, xt, th}
     charHeadSurface(ch) reads the rig's own form/nose and adds hk. */
  const _headSurf = Object.create(null);
  CBZ.charHeadSurface = function (a, b) {
    let form = a, nose = b, hk = 1;
    if (a && typeof a === "object") {
      const P = a.profile, R = a.faceRest;
      form = (R && R.form) || a.headForm || (P ? headForm(P) : "m");
      nose = R && R.nose != null ? R.nose : 1;
      hk = P && P.headSize > 0 ? P.headSize / 0.60 : 1;
    }
    const fk = HEAD_FORMS[form] ? form : "m";
    const ni = Math.max(0, Math.min(2, nose | 0));
    const key = fk + "|" + ni;
    let S = _headSurf[key];
    if (!S) {
      const F = HEAD_FORMS[fk];
      const toU = function (pos, keep) {
        const out = [];
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i), u = pos.getY(i) + 0.30, z = pos.getZ(i);
          if (keep(x, u, z)) out.push(x, u, z);
        }
        return out;
      };
      let nosePts = [], earPts = [];
      try {
        const hg = headGeometry(fk, ni, false);
        // the nose is the only thing standing proud of the face plane between the eyes
        nosePts = toU(hg.attributes.position, function (x, u, z) { return z > 0.302 && Math.abs(x) < 0.09 && u > 0.18 && u < 0.42; });
        earPts = toU(earGeometry(F, 1, false).attributes.position, function () { return true; });
      } catch (e) { /* headless stub THREE: the analytic skull still answers */ }
      const B = BROW_FORM[fk] || BROW_FORM.m;
      S = _headSurf[key] = {
        form: fk, nose: ni, hk: 1,
        sdf: function (x, u, z) { return skullSdfF(F, x, u, z); },
        hit: function (o, d, out) { return skullHit(F, o, d, out || { p: [0, 0, 0], n: [0, 0, 0] }); },
        nosePts: nosePts, earPts: earPts,
        eye: { x: EYE.x, y: EYE.y, front: EYE.front, r: eyeR(fk) },
        brow: { y0: B.y0, xi: B.xi, xt: B.xt, th: B.th, restY: BROW_REST_Y },
      };
    }
    return hk === 1 ? S : Object.assign(Object.create(S), { hk: hk });
  };
  CBZ.charHeadLandmarks = function (ch) {
    const P = ch && ch.profile;
    if (!P || !(P.headSize > 0)) return null;
    const F = HEAD_FORMS[ch.headForm] || HEAD_FORMS[headForm(P)] || HEAD_FORMS.m;
    const hs = P.headSize, hk = hs / 0.60;
    const E = EAR_SPEC, k = F.ear || 1, ea = E.H / 2 * k, eb = E.W / 2 * k, bf = E.bf * k;
    const ca = Math.cos(E.alpha), sa = Math.sin(E.alpha), cb = Math.cos(E.beta), sb = Math.sin(E.beta);
    const rho = 0.72;
    const b = 0.12 * eb * rho, a = -ea * rho;                  // theta = 3pi/2: the bottom of the outline
    const b1 = b * cb - a * sb, a1 = a * cb + b * sb, db = b1 - bf;
    const w = 0.0115 * k;                                      // half the lobe's relief: the middle of the flesh
    const x = E.x0 + (-db * sa + w * ca), y = E.yc + a1 - 0.30, z = E.zc + bf + (db * ca + w * sa);
    return {
      lobe: [x * hk, hs / 2 + y * hk, z * hk],                // the +x (right-hand) lobe; mirror x for the other
      earYaw: E.alpha,                                         // the ear swings out about its front edge by this
      earK: 1.6 * k * hk,                                      // the drawn ear against a real one (0.150 u = 10.5 cm tall)
      crownBandY: hs / 2 + 0.20 * hk,                          // where a band crosses the forehead-top
      headZ: 0,
      hk: hk,
    };
  };
  /* ---- HOW FAR THE PRONE RIG DROPS, in METRES -----------------------------
     OWNER: "when player is laying down… the player [goes] a tiny bit [under
     ground], bad physics." physics.js dropped the rig group by a TYPED 0.62 to
     lay the hip-hinged plank down, but the plank's lowest surface is not the
     hip line — it is the underside of the pitched CHEST BOX, half a torso
     DEPTH below it, and nobody had solved for that. Worked on the shipped
     adult male: the hips land 0.045 m over the floor and the chest's underside
     0.115 m UNDER it, which is exactly the sink the owner can see.

     A box pitched by θ has vertical half-extent h·|cosθ| + d·|sinθ| — that is
     the whole derivation, applied to the two boxes that can touch down (the
     chest and the upper leg) and taken at the LOWER of the two. Read off the
     rig's own profile and the pose's own angles, so a woman's deeper chest and
     a child's shorter femur each get their own number instead of a constant
     tuned against one body. Returns metres (humanScale applied); null if it
     cannot measure, so physics.js keeps its literal. */
  CBZ.charProneSink = function (ch) {
    const P = ch && ch.profile;
    if (!P) return null;
    const hs = (ch.group && ch.group.userData && ch.group.userData.humanScale) || 0.70;
    const hipY = P.legUp + P.legLo;
    const base = hipY - 0.005;
    const waistH = P.waistShare > 0 ? P.waistShare * P.torsoH : 0;
    const chestH = P.torsoH - waistH;
    const bob = 0.02;                                     // the prone pose's body.position.y
    const cT = Math.abs(Math.cos(PRONE_PITCH)), sT = Math.abs(Math.sin(PRONE_PITCH));
    // chest: centre swings about the HIP pivot (lockCharacterHips holds it)
    const chestOff = (base + waistH + chestH / 2) - hipY;
    const chestLow = hipY + chestOff * Math.cos(PRONE_PITCH) + bob
                   - (chestH / 2 * cT + P.torsoD / 2 * sT);
    const cL = Math.abs(Math.cos(PRONE_LEG_PITCH)), sL = Math.abs(Math.sin(PRONE_LEG_PITCH));
    const legLow = hipY - (P.legUp / 2) * Math.cos(PRONE_LEG_PITCH) + bob
                 - (P.legUp / 2 * cL + P.legW / 2 * sL);
    return Math.min(chestLow, legLow) * hs;               // drop by this → lowest surface ON the floor
  };
  /* ---- HOW BIG IS THIS BODY, SEATED? ------------------------------------
     Anything that has to fit a rig into an authored HOLE — a car cabin is the
     first, a cockpit will be the second — needs three numbers this file has
     and nobody else does: where the seat solve puts the hips, and how far the
     eye and the crown sit above them once the body is folded. Every one of
     them is read off the rig's OWN profile (so a woman, a teenager and the
     shipped adult male each get their own answer) and returned in metres with
     humanScale already applied, which is the same contract charProneSink
     above already established.

     The three consumers of the seat solve's own arithmetic, mirrored exactly:
       hipFloor  the `SHIN * 0.55` low clamp on hip height
       hipPad    the `0.10 * hs` thigh-into-cushion pad
       hip       = max(cushion + hipPad, hipFloor)     [the solve, verbatim]
     …so a caller can invert it for the scale that lands the eye where the
     cabin wants it. Returns null if it cannot measure, so no caller is ever
     forced to guess from a null. */
  CBZ.charSeatMetrics = function (ch) {
    const P = ch && ch.profile;
    if (!P) return null;
    const hs = (ch.group && ch.group.userData && ch.group.userData.humanScale) || 0.70;
    // neck socket above the hip pivot: makeCharacter stacks
    // neckY = (hipY - 0.005) + torsoH - 0.015, then sinks the head by neckDrop.
    // (the TORSO block's pivot when the rig has one: the neck shows now)
    const TSh = ch.torsoShape;
    const neckOverHip = TSh ? TSh.pivotY - TSh.hipY : P.torsoH - 0.020 - (P.neckDrop || 0);
    // the eye boxes live in a face group scaled headSize/0.60, at local y 0.34
    const eyeOverNeck = 0.34 * (P.headSize / 0.60);
    const shin = (P.legLo + 0.03) * hs;
    return {
      hs: hs,
      hipY: (P.legUp + P.legLo) * hs,          // standing hip pivot
      hipFloor: shin * 0.55,                   // seat solve's low clamp
      hipPad: 0.10 * hs,                       // cushion -> hip pad
      eyeOverHip: (neckOverHip + eyeOverNeck) * hs,
      topOverHip: (neckOverHip + P.headSize) * hs,
    };
  };
  CBZ.charBands = { CHILD_ADULT_AGE, bandOf };
  // One cheap question every other system asks: "is this a child?" Answers for
  // a rig, a ped, or a bare Object3D (the root carries userData.charBand), and
  // never throws on something unexpected.
  CBZ.charIsChild = function (t) {
    if (!t) return false;
    if (t.child === true) return true;
    if (typeof t.ageYears === "number") return t.ageYears < CHILD_ADULT_AGE;
    if (t.profile && t.profile.child) return true;
    if (t.char) return CBZ.charIsChild(t.char);
    let o = t.isObject3D ? t : (t.group || null);
    for (let i = 0; o && i < 6; i++, o = o.parent) {
      const u = o.userData;
      if (u && u.charBand) return u.charBand !== "adult";
      if (u && u.charChild) return true;
    }
    return false;
  };
  /* CBZ.charReach(ch, opts) — arm the reach layer above on any rig built by
     makeCharacter (player, guard, inmate, city ped: it is one rig).
     Returns the duration so a caller can time a consequence to the DWELL —
     the grab lands at ~55% of it, not on the first frame.
       opts.arm "l"|"r"  · opts.dur seconds · opts.side -1 across / +1 out
       opts.high 0 hip .. 1 collar · opts.amt 0..1 commitment · opts.kind for
       a registered physical reach such as holster-back / holster-hip
       opts.target live Object3D mount for a physical hand-to-target solve
     No-ops on a rig that is mid-strike or down, so a lift can never cancel a
     punch and a KO'd body never reaches for anything. */
  CBZ.charReach = function (ch, opts) {
    if (!ch || !ch.parts) return 0;
    if (ch.punchT > 0 || ch.kickT > 0 || ch.koT > 0 || ch.koPose || ch.staggerT > 0) return 0;
    opts = opts || {};
    const dur = Math.max(0.2, +opts.dur || 0.62);
    ch.reachArm = opts.arm === "l" ? "l" : "r";
    ch.reachDur = dur;
    ch.reachT = dur;
    ch.reachSide = opts.side == null ? -1 : +opts.side;
    ch.reachHigh = Math.max(0, Math.min(1, +opts.high || 0));
    ch.reachAmt = opts.amt == null ? 1 : Math.max(0, Math.min(1, +opts.amt));
    ch.reachKind = opts.kind || "";
    ch.reachTarget = opts.target && opts.target.isObject3D ? opts.target : null;
    return dur;
  };
  CBZ.animChar = animChar;
  CBZ.poseSkydiver = poseSkydiver;
  // THE SWIM POSE, shared. city/swim.js drives the player with these three and
  // entities/survivorbot.js drives ninety-nine other people with the same ones.
  CBZ.makeSwimAnim = makeSwimAnim;
  CBZ.swimAnimStep = swimAnimStep;
  CBZ.poseSwimmer = poseSwimmer;
  CBZ.lockCharacterHips = lockCharacterHips;
  CBZ.gaitPhaseDelta = gaitPhaseDelta;
  CBZ.deathPose = deathPose;
  CBZ.charSeatSlump = seatSlumpPose;
  CBZ.charMounts = charMounts;
  CBZ.lerpAngle = lerpAngle;
  CBZ.damp = damp;

  /* ==== CBZ.human — THE ONE DOOR TO A PERSON ==============================
     Every system that builds, dresses, poses or audits a human goes through
     here instead of reaching into makeCharacter's internals:
       build(opts)                -> rig            (makeCharacter; CBZ.makeCharacter stays the alias)
       profile(build, age)        -> body profile   (charProfile, cached)
       dress(rig, idOrRecord)     -> bool           an outfit catalog id, a catalog record
                                                    ({colors,...}) or a bare colour object;
                                                    delegates to the city wardrobe when loaded
       setHandPose(rig, side, pose)                 rig.setHandPose (HANDS block)
       regions(rig)               -> {head, face, hair, torso, waist, pelvis, armsUpper,
                                      armsLower, hands, legsUpper, legsLower, shoes} mesh lists
       headAtlas                  the head UV layout heritage.js paints ink into
       hairStyles()               the HAIR_STYLES ids
       eyeColours                 named eye colours (heritage.js rolls from these) */
  function humanRegions(rig) {
    const s = (rig && rig.skinSlots) || {};
    const L = (a) => (a || []).filter(Boolean);
    const t = L(s.torso), f = rig && rig.face;
    return {
      head: L(s.head),
      face: f ? L([f.eyeL, f.eyeR, f.lidUp, f.lidLow, f.brow, f.mouth, f.lipLow]) : [],
      hair: L(s.hair).concat(L(s.beard)),
      torso: t.slice(0, 1).concat(L(s.collar)),
      waist: t.slice(1),
      pelvis: L(s.pelvis),
      armsUpper: L(s.arms), armsLower: L(s.armsLower), hands: L(s.hands),
      legsUpper: L(s.legs), legsLower: L(s.legsLower), shoes: L(s.shoes),
    };
  }
  function humanDress(rig, outfit, opts) {
    if (!rig || !rig.skinSlots || outfit == null) return false;
    let rec = null, colors = null;
    if (typeof outfit === "string") {
      let cat = null;
      try { cat = CBZ.cityOutfitCatalog ? CBZ.cityOutfitCatalog() : null; } catch (e) { cat = null; }
      rec = cat && cat[outfit];
      if (!rec) return false;
      colors = rec.colors || null;
    } else if (outfit.colors) { rec = outfit; colors = outfit.colors; }
    else colors = outfit;
    if (!colors) return false;
    if (CBZ.cityRecolorRig) return CBZ.cityRecolorRig(rig, colors, rec, opts) !== false;
    // no wardrobe loaded: flat-tint the slots (never mutate a shared material)
    const s = rig.skinSlots;
    const paint = (list, hex) => {
      if (hex == null || !list) return;
      for (const m of list) if (m) CBZ.paintMesh(m, hex);
    };
    paint(s.torso, colors.torso); paint(s.collar, colors.collar != null ? colors.collar : colors.torso);
    const arms = colors.arms != null ? colors.arms : colors.torso;
    paint(s.arms, arms); paint(s.armsLower, arms);
    paint(s.legs, colors.legs); paint(s.legsLower, colors.legs); paint(s.pelvis, colors.legs);
    paint(s.shoes, colors.shoes);
    return true;
  }
  CBZ.human = {
    build: makeCharacter,
    profile: charProfile,
    dress: humanDress,
    setHandPose: function (rig, side, pose) {
      if (rig && typeof rig.setHandPose === "function") { rig.setHandPose(side, pose); return true; }
      return false;
    },
    regions: humanRegions,
    headAtlas: HEAD_ATLAS,
    hairStyles: function () { return Object.keys(HAIR_STYLES); },
    // HAIR FOLLOW: sync one hair mesh's morph influences to its neck's yaw now
    // (the renderer does it in onBeforeRender; tools call it after posing)
    hairFollow: hairFollowSync,
    hairFollowSpec: HAIR_FOLLOW,
    // THE NECK HAS A RANGE: the limits (radians), an in-place clamp for
    // absolute writers, and the test the drawn neck uses
    neckLimits: NECK_LIMITS,
    clampNeck: clampNeck,
    neckInRange: neckInRange,
    // THE ARMS HAVE A RANGE: limits, an in-place clamp, the anatomical angles
    // of an arm and the test (true, or the list of what is out)
    armLimits: ARM_LIMITS,
    clampArm: clampArm,
    armAngles: armAngles,
    armInRange: armInRange,
    // THE PHONE HOLD: ear / read / film, and the handset in the palm
    phoneHold: phoneHold,
    phoneSeat: phoneSeat,
    // the skull entities/headwear.js fits every hat to (read live, not copied)
    headForms: HEAD_FORMS,
    jawMul: jawMul,
    eyeColours: EYE_COLOURS,
    // shared-geometry builders, for tools and previews (all cached)
    geometry: { head: headGeometry, hair: hairGeometry, brow: browGeometry, beard: beardGeometry, shoe: function (style, lod, side) { return CBZ.footwear ? CBZ.footwear.geometry(style || "sneaker", lod, side).upper : null; },
                eyeball: eyeballGeometry, lid: lidGeometry, lip: lipGeometry },
    // THE FACE: facePose(rig, pose) is the one writer of eyes/lids/lips/brow;
    // faceLod(rig, near) the tier; facial.js drives both. faceRestPose is the
    // neutral pose object (read-only), faceExpressions the lip shapes.
    facePose: facePose,
    faceLod: faceLod,
    faceRestPose: REST_POSE,
    faceExpressions: Object.keys(LIP_EXPR),
  };
})();
