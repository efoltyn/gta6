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
    armLo: {   // the elbow (t 0) .. the wrist crease (t 1), where the hand's stub enters
      bare: { top: 1, bot: 0.35, rows: [
        [0.00, 0.80, 0.76, 0.00], [0.17, 0.88, 0.85, 0.02], [0.45, 0.71, 0.73, 0.02],
        [0.76, 0.52, 0.60, 0.00], [1.00, 0.40, 0.51, 0.00]] },
      cloth: { top: 1, bot: 0.30, rows: [
        [0.00, 0.84, 0.80, 0.00], [0.20, 0.88, 0.86, 0.01], [0.60, 0.72, 0.76, 0.00],
        [0.90, 0.60, 0.66, 0.00], [0.96, 0.64, 0.70, 0.00], [1.00, 0.57, 0.63, 0.00]] },
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
  function limbCanon(kind, variant, lod, aq) {
    const key = "C|" + kind + "|" + variant + "|" + lod + "|" + aq;
    let g = LIMB_GEO[key];
    if (g) return g;
    const sh = LIMB_SHAPES[kind][variant];
    const rows = limbRows(sh, lod);
    const n = lod >= 2 ? 2 : 3;                 // segments per quadrant (8 / 12 around)
    const nd = lod >= 2 ? 1 : 2;                // dome rings between the end section and the apex
    const a = aq / 100;
    const rings = [];
    const domeH = (row, k) => k * Math.max(row[1], row[2]) * a;
    const r0 = rows[0], rN = rows[rows.length - 1];
    for (let k = nd + 1; k >= 1; k--) {         // top dome: apex first
      const th = (Math.PI / 2) * k / (nd + 1), c = Math.cos(th);
      rings.push([domeH(r0, sh.top) * Math.sin(th), r0[1] * c, r0[2] * c, r0[3]]);
    }
    for (let i = 0; i < rows.length; i++) rings.push([-rows[i][0], rows[i][1], rows[i][2], rows[i][3]]);
    for (let k = 1; k <= nd + 1; k++) {         // bottom dome: apex last
      const th = (Math.PI / 2) * k / (nd + 1), c = Math.cos(th);
      rings.push([-1 - domeH(rN, sh.bot) * Math.sin(th), rN[1] * c, rN[2] * c, rN[3]]);
    }
    const RV = 4 * (n + 1), nv = rings.length * RV;
    const P = new Float32Array(nv * 3), U = new Float32Array(nv * 2);
    const F = new Uint8Array(nv), Q = new Float32Array(nv);
    let o = 0;
    for (let i = 0; i < rings.length; i++) {
      const R = rings[i], v = Math.min(1, Math.max(0, 1 + R[0]));
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
    g.userData.limbFace = F; g.userData.limbU = Q; g.userData.limbRows = rows;
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
    const key = "B|" + spec.kind + "|" + spec.variant + "|" + lod + "|" + aq + "|" +
      [spec.w, spec.d, spec.len, spec.y0, spec.boxH].map((x) => x.toFixed(4)).join(",") + "|" + (paint ? paint.key : "-");
    let g = LIMB_GEO[key];
    if (g) return g;
    const C = limbCanon(spec.kind, spec.variant, lod, aq);
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
      for (let i = 0; i < nv; i++) {
        const v = Math.min(1, Math.max(0, (P[i * 3 + 1] + hb) / spec.boxH));
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
    return grp;
  }
  CBZ.humanLimbGeometry = limbGeometry;
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
    }
  }
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

  const profileCache = Object.create(null);
  // CBZ.charProfile(build, age) — the public read. Cached: the crowd asks
  // this per body, and a profile is pure data derived from two numbers.
  function charProfile(build, age) {
    const b = build === "f" ? "f" : "m";
    let a = (age == null || !isFinite(age)) ? null : +age;
    if (a != null) {
      a = Math.max(0, Math.min(40, a));
      if (a >= CHILD_ADULT_AGE) a = null;
      else a = Math.round(a * 4) / 4;              // quantised: 160 possible child bodies, not infinite
    }
    const key = b + "|" + (a == null ? "A" : a);
    let p = profileCache[key];
    if (p) return p;
    p = a == null ? (b === "f" ? ADULT_F : ADULT_M) : childProfile(b, a);
    profileCache[key] = p;
    return p;
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
      // EARS — outer faces clear the widest side-hair panel (see hairGeometry)
      for (const s of [-1, 1]) {
        const ear = rbox(0.048, 0.150 * F.ear, 0.100 * F.ear, 0.022, [1, 2, 2]);
        sculpt(ear, function (v) { v.x += s * 0.012 * cl01(-v.z / 0.05); });   // the back rim flares out
        ear.translate(s * 0.316, 0.305 - 0.30, -0.035);
        flatUV(finishGeo(ear), PLAIN_U, PLAIN_V);
        parts.push(ear);
      }
      // NECK — chin to collar, buried in the yoke below and the skull above
      const nr0 = F.neck[0], nr1 = F.neck[1], nH = 0.30;
      const neck3 = rbox(nr1 * 2, nH, nr1 * 1.9, nr1 * 0.75, [2, 1, 2]);
      atlasUV(neck3, HEAD_ATLAS.headV, 1);
      sculpt(neck3, function (v) {
        const k = lerpN(1, nr0 / nr1, cl01((v.y + nH / 2) / nH));
        v.x *= k; v.z *= k;
      });
      neck3.translate(0, 0.01 - 0.30, -0.025);
      finishGeo(neck3);
      parts.push(neck3);
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
  function browGeometry(form, expr) {
    const fk = form === "f" ? "f" : (form === "c" ? "c" : "m");
    const ek = expr === "a" || expr === "f" ? expr : "n";
    return shared("brow|" + fk + (ek === "n" ? "" : "|" + ek), function () {
      const parts = [];
      const w = fk === "f" ? 0.128 : 0.146, h = fk === "f" ? 0.022 : (fk === "c" ? 0.024 : 0.034), d = 0.034;
      const arch = fk === "f" ? 0.016 : 0.006;
      for (const s of [-1, 1]) {
        const b = rbox(w, h, d, h * 0.45, [4, 1, 1]);
        sculpt(b, function (v) {
          const t = cl01(v.x / w + 0.5), out = s > 0 ? t : 1 - t;          // 0 at the nose end
          v.y *= lerpN(1.15, 0.65, out);                                    // thick head, thin tail
          v.y += arch * (1 - Math.pow(2 * out - 1.1, 2)) - (fk === "m" ? 0.006 * out : 0);
          v.z -= 0.012 * out * out;                                         // the tail wraps round the brow
          const inner = (1 - out) * (1 - out);
          if (ek === "a") { v.y -= 0.020 * inner - 0.004 * out; v.z += 0.005 * inner; v.x -= s * 0.006 * inner; }
          else if (ek === "f") { v.y += 0.016 * inner - 0.003 * out; }
        });
        b.translate(s * 0.145, -h / 2 - arch, 0);
        flatUV(finishGeo(b), 0.5, 0.5);
        parts.push(b);
      }
      return mergeGeos(parts);
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
      return mergeGeos(parts);
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
  /* BEARDS follow the tapered jaw: each piece is authored around the skull,
     then squeezed by the SAME jawMul the head uses, with a ~0.02 margin, so
     the beard hugs the chin instead of standing off it as a crate. One merged
     mesh per (style, form). */
  function beardGeometry(style, form) {
    const fk = HEAD_FORMS[form] ? form : "m";
    return shared("beard|" + style + "|" + fk, function () {
      const F = HEAD_FORMS[fk];
      const parts = [];
      const hug = (g) => sculpt(g, function (v) { v.x *= jawMul(F, v.y, v.z); });
      const put = (g, x, y, z, hugJaw) => { g.translate(x, y, z); if (hugJaw) hug(g); parts.push(flatUV(finishGeo(g), 0.5, 0.5)); };
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
        put(m, 0, 0.203, 0.312, false);
      };
      if (style === "full" || style === "stubble") {
        const thick = style === "full" ? 1 : 0.55;
        put(rbox(0.60 + 0.04 * thick, 0.165 + 0.02 * thick, 0.44, 0.09, [4, 2, 3]), 0, 0.058 - 0.01 * thick, 0.090 + 0.012 * thick, true);
        for (const s of [-1, 1]) put(rbox(0.030 + 0.03 * thick, 0.22, 0.20, 0.02, [1, 2, 2]), s * (0.290 + 0.012 * thick), 0.205, 0.045, true);
        if (style === "full") moustache();
      } else if (style === "goatee") {
        // a goatee: under the lower lip, tapering to the point of the chin
        const gt = rbox(0.15, 0.115, 0.05, 0.03, [4, 4, 2]);
        sculpt(gt, function (v) {
          const u = cl01((v.y + 0.0575) / 0.115);
          v.x *= lerpN(0.66, 1, u);
          v.z -= 0.02 * Math.pow(2 * v.x / 0.15, 2);
        });
        put(gt, 0, 0.068, 0.300, false);
        moustache();
      } else if (style === "moustache") {
        moustache();
      }
      if (!parts.length) moustache();
      return mergeGeos(parts);
    });
  }
  /* THE SHOE — one unit geometry (x -0.5..0.5, y 0..1, z -0.5 heel .. 0.5
     toe), scaled per body: a full-height heel/ankle, an instep that falls to
     a low rounded toe, a sole lip. The ankle zone is full width and full
     height exactly where the shin box ends, so no trouser corner pokes out. */
  function shoeGeometry(kind) {
    const foot = kind === "foot";
    return shared(foot ? "foot" : "shoe", function () {
      const shape = function (v) {
        const t = cl01(v.z + 0.5);                                           // 0 heel .. 1 toe
        const top = t < 0.45 ? 1 : lerpN(1, foot ? 0.30 : 0.40, sm01((t - 0.45) / 0.45));
        v.y *= top;
        v.x *= t > 0.66 ? lerpN(1, 0.70, sm01((t - 0.66) / 0.34)) : (t < 0.08 ? lerpN(0.93, 1, t / 0.08) : 1);
        if (v.z > 0.36) v.z -= 0.12 * Math.pow(Math.min(1, Math.abs(v.x) * 2 / 0.70), 2);
        if (v.z < -0.42) v.z += 0.04 * Math.pow(Math.min(1, Math.abs(v.x) * 2), 2);
      };
      /* THE COLLAR HUGS THE ANKLE. The shoe used to be full width and full
         height all the way up, so a leg ended in a brick with a flat lid. Now
         the upper draws in round the ankle (the leg's axis sits at unit z
         SHOE_ANKLE_Z) over its top half, so the tapered shin goes INTO a
         collar that fits it and a trouser hem, wider than the collar, breaks
         over it. A bare foot draws in harder and its instep sits lower. */
      const cx = foot ? 0.52 : 0.60, cz = foot ? 0.50 : 0.62;
      const collar = function (v) {
        const k = sm01((v.y - 0.45) / 0.55);
        if (k <= 0) return;
        v.x *= lerpN(1, cx, k);
        v.z = SHOE_ANKLE_Z + (v.z - SHOE_ANKLE_Z) * lerpN(1, cz, k);
      };
      const upper = rbox(1, 1, 1, 0.16, [2, 4, 4]);
      upper.translate(0, 0.5, 0);
      sculpt(upper, function (v) { shape(v); collar(v); v.y = 0.02 + v.y * 0.98; });   // its sole face sits inside the sole's
      if (foot) return mergeGeos([flatUV(finishGeo(upper), 0.5, 0.5)]);
      const sole = rbox(1.05, 0.13, 1.04, 0.05, [2, 1, 4]);
      sole.translate(0, 0.065, 0.004);
      sculpt(sole, function (v) { const y = v.y; shape(v); v.y = y; });
      return mergeGeos([flatUV(finishGeo(upper), 0.5, 0.5), flatUV(finishGeo(sole), 0.5, 0.5)]);
    });
  }
  // where the leg's axis (leg-frame z 0) lands in the unit shoe, for the
  // adult proportions below: (lw/2 + 0.035) / (1.62 lw) - 0.5
  const SHOE_ANKLE_Z = -0.12;
  // The shoe on a leg: the slot contract (leg.userData.cap, skinSlots.shoes)
  // is unchanged — only the shape is. A "shoe" the colour of the skin is a
  // BARE FOOT (city/beach.js swimmers): a lower, closer-fitting foot, no sole.
  // Height: a 0.16 m boot was every shoe in the game; a sneaker's collar is
  // ~0.13 m, which is what the leg's ankle is shaped to meet.
  function addShoe(leg, P, color, bare) {
    const lw = P.legW * 0.9, lowerH = P.legLo;
    const W = lw * 1.06, H = bare ? P.shoeH * 0.62 + 0.03 : P.shoeH * 0.8 + 0.03, D = lw * 1.62;
    const shoe = new THREE.Mesh(shoeGeometry(bare ? "foot" : "shoe"), cmat(color));
    shoe.scale.set(W, H, D);
    shoe.position.set(0, -lowerH - 0.03, -lw / 2 - 0.035 + D / 2);   // the sole plane never moved
    shoe.castShadow = true;
    shoe.name = "shoe";
    leg.userData.low.add(shoe);
    leg.userData.cap = shoe;
    return shoe;
  }

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
  // lids: the skin a shade down (the socket's own shade), so an open eye has
  // no pale ring round it; quantised like the lips
  function lidTone(skin) {
    const t = mixHex(skin, 0x3a2418, 0.09), q = (c) => Math.min(255, Math.round(c / 4) * 4);
    return (q(t >> 16 & 255) << 16) | (q(t >> 8 & 255) << 8) | q(t & 255);
  }
  function browTone(hair) { return lumOf(hair) > 0.35 ? mixHex(hair, 0x2a1f16, 0.35) : mixHex(hair, 0x0a0806, 0.25); }

  /* ---- HAIR SHELL -------------------------------------------------------
     OWNER BUG: "the back-of-head hair reads as two separate blocks."
     It did, and no amount of tucking two boxes together fixes it, because
     the old rig showed hair-lid / BARE SKIN / hair-plank stacked down the
     back of the skull from any 3/4-rear angle — the gap was the sides of
     the head, not the seam. Low-poly practice (and every stylised asset
     pack) models hair as ONE continuous shell spanning crown -> nape ->
     tail, never a skull cap plus a floating tail.

     So hair is literally one mesh: the pieces are merged into a single
     cached BufferGeometry per (style, head size). The pieces are ROUNDED
     boxes now (rbox) — a hard-edged crown on a rounded skull is a helmet —
     and the crown shares the skull's corner radius with a clear margin on
     every side, so it contains the head it sits on by construction.

     The nape/lower-back-of-skull volume is the highest-leverage female cue
     at gameplay distance: it reads from front, side AND behind, unlike a
     fringe or hairline which only reads face-on. That is why every style
     below is defined by how far its mass hangs BELOW the crown line.
     fringe: 1 full bangs, 2 a side-swept fringe. afro/curls/locs: the
     textured styles heritage.js rolls. */
  const HAIR_STYLES = {
    buzz:  { crownH: 0.13, backH: 0.24, sideW: 0.05, sideH: 0.18 },
    short: { crownH: 0.21, backH: 0.34, sideW: 0.09, sideH: 0.25 },
    crop:  { crownH: 0.24, backH: 0.30, sideW: 0.08, sideH: 0.21 },
    bob:   { crownH: 0.22, backH: 0.60, sideW: 0.11, sideH: 0.54, fringe: 1 },
    long:  { crownH: 0.22, backH: 0.98, sideW: 0.115, sideH: 0.66, fringe: 2 },
    pony:  { crownH: 0.21, backH: 0.34, sideW: 0.085, sideH: 0.26, tail: 0.62 },
    bun:   { crownH: 0.21, backH: 0.30, sideW: 0.085, sideH: 0.24, bun: 1 },
    pigtail: { crownH: 0.21, backH: 0.36, sideW: 0.13, sideH: 0.46, fringe: 1 },
    afro:  { crownH: 0.22, backH: 0.30, sideW: 0.09, sideH: 0.24, afro: 1 },
    curly: { crownH: 0.22, backH: 0.34, sideW: 0.09, sideH: 0.25, curls: 1 },
    locs:  { crownH: 0.22, backH: 0.40, sideW: 0.09, sideH: 0.30, locs: 1 },
  };

  /* TEMPLE TAPER (owner: "everyone has too much hair on left and right side of
     their head"). MEASURED CAUSE: the side pieces were authored as OUTBOARD
     SLABS whose whole declared `sideW` hung outside the skull — 4.9 cm (short)
     to 6.7 cm (long) of real hair standing off each ear while the crown was
     1.4 cm proud. So the side is a skull-hugging layer: inner face BURIED at
     S/2 - 0.062k, outer face only `sideT` proud (same family as the crown),
     tapering to 0.58 toward the ear, pulled back behind the temple. */
  function hairGeometry(styleId, S) {
    const st = HAIR_STYLES[styleId] || HAIR_STYLES.short;
    const key = "hair|" + (HAIR_STYLES[styleId] ? styleId : "short") + "|" + S.toFixed(3);
    return shared(key, function () {
      const k = S / 0.60;                       // every offset scales with the head
      const hw = S + 0.04, hd = S + 0.04;
      const crownH = st.crownH * k, backH = st.backH * k, sideH = st.sideH * k;
      const crownTop = S + 0.06 * k;            // sits proud of the skull crown
      const crownBot = crownTop - crownH;
      const shellTop = crownBot + 0.07 * k;     // everything else tucks UP into the crown
      const parts = [];
      const put = (g, x, y, z, flat) => {
        g.translate(x, y, z);
        if (flat) g.computeVertexNormals(); else finishGeo(g);     // a slab keeps its hard faces
        parts.push(flatUV(g, 0.5, 0.5));
      };
      /* One side panel, sculpted. `sign` is +1 starboard / -1 port. The box
         spans from a face BURIED inside the skull out to `outer`, and every
         vertex's OUTBOARD component is scaled by a factor that falls with
         height — the taper toward the ear. Measured WITH the sign rather than
         mirrored: a negative scale would flip the winding inside-out. */
      const sidePanel = (sign, inner, outer, yTop, yBot, zc, dz, botMul) => {
        const w = outer - inner, h = yTop - yBot;
        const g = new THREE.BoxGeometry(w, h, dz, 1, 3, 1);
        sculpt(g, function (v) {
          const t = (v.y + h / 2) / h, f = botMul + (1 - botMul) * t;
          const out = sign > 0 ? v.x + w / 2 : w / 2 - v.x;
          v.x = sign > 0 ? out * f - w / 2 : w / 2 - out * f;
        });
        put(g, sign * (inner + w / 2), (yTop + yBot) / 2, zc, true);
      };
      const skullR = 0.15 * k;
      if (st.afro) {
        // one round mass over the crown, set back so the forehead and hairline read
        put(rbox(0.82 * k, 0.54 * k, 0.76 * k, 0.25 * k, [4, 4, 4]), 0, 0.56 * k, -0.10 * k);
      } else {
        // crown: pulled back off the brow so a hairline reads, top edges rounded
        put(rbox(hw, crownH, hd * 0.92, skullR, [4, 2, 4], true), 0, (crownTop + crownBot) / 2, -0.03 * k);
        // OCCIPITAL WEDGE — extra mass over the occipital bone breaks the
        // perfectly round rear silhouette that reads as a helmet
        put(rbox(hw * 0.80, crownH * 0.85, 0.11 * k, 0.045 * k, [3, 2, 2]), 0, crownBot + 0.01 * k, -(S / 2 + 0.085 * k));
      }
      // back of the skull down to the nape (and past it, for long styles),
      // narrowing and thinning to the tips when it is long
      const back = rbox(hw * 0.97, backH, 0.17 * k, 0.06 * k, [3, backH > 0.5 * k ? 4 : 2, 2]);
      if (backH > 0.5 * k) sculpt(back, function (v) { const t = cl01((backH / 2 - v.y) / backH); v.x *= 1 - 0.20 * sm01(t); v.z *= 1 - 0.30 * sm01(t); });
      put(back, 0, shellTop - backH / 2, -(S / 2 + 0.025 * k));
      // sides: temple -> ear -> jaw, closed from INSIDE the skull
      const sideT = Math.min(st.sideW * 0.34, 0.020 + st.sideW * 0.14) * k;
      for (const sgn of [-1, 1]) sidePanel(sgn, S / 2 - 0.062 * k, S / 2 + sideT, shellTop, shellTop - sideH, -0.085 * k, hd * 0.64, 0.58);
      if (st.fringe === 1) {
        // bangs across the brow, a hair side-swept
        const f = rbox(0.56 * k, 0.10 * k, 0.05 * k, 0.025 * k, [3, 2, 1]);
        f.rotateZ(0.06);
        put(f, -0.015 * k, 0.515 * k, 0.297 * k);
      } else if (st.fringe === 2) {
        // a long side-swept fringe falling off the parting
        const f = rbox(0.34 * k, 0.10 * k, 0.05 * k, 0.025 * k, [3, 2, 1]);
        f.rotateZ(-0.22);
        put(f, 0.10 * k, 0.53 * k, 0.29 * k);
      }
      if (st.tail) {
        const tH = st.tail * k;
        const t = rbox(0.16 * k, tH, 0.15 * k, 0.07 * k, [2, 3, 2]);
        sculpt(t, function (v) { const u = cl01((tH / 2 - v.y) / tH); v.x *= 1 - 0.45 * u; v.z *= 1 - 0.45 * u; });
        t.rotateX(0.18);
        put(t, 0, shellTop - 0.05 * k - tH / 2, -(S / 2 + 0.15 * k));
      }
      if (st.bun) put(rbox(0.26 * k, 0.22 * k, 0.26 * k, 0.12 * k, [2, 2, 2]), 0, crownTop - 0.02 * k, -(S / 2 + 0.02 * k));
      if (st.curls) {
        // a crown of tight curls: the silhouette goes lumpy, which is the read
        const C = [[-0.20, 0.64, 0.10], [0, 0.67, 0.12], [0.20, 0.64, 0.10], [-0.24, 0.63, -0.12], [0.24, 0.63, -0.12],
          [0, 0.68, -0.08], [-0.13, 0.60, -0.28], [0.13, 0.60, -0.28], [-0.12, 0.57, 0.22], [0.12, 0.57, 0.22]];
        for (const c of C) put(rbox(0.15 * k, 0.13 * k, 0.15 * k, 0.07 * k, [2, 2, 2]), c[0] * k, c[1] * k, c[2] * k);
      }
      if (st.locs) {
        // locs hang round the back and sides, never across the face
        for (let i = 0; i < 10; i++) {
          const a = -1.75 + i * (3.5 / 9);                       // radians round from the back
          const L = (0.58 - 0.12 * Math.abs(a)) * k;
          const g = rbox(0.06 * k, L, 0.06 * k, 0.03 * k, [1, 2, 1]);
          g.rotateZ(-Math.sin(a) * 0.10); g.rotateX(Math.cos(a) * 0.10);
          put(g, Math.sin(a) * 0.32 * k, shellTop - L / 2 + 0.02 * k, -Math.cos(a) * 0.32 * k - 0.03 * k);
        }
      }
      if (styleId === "pigtail") {
        // pigtails stand off the head — that is what a pigtail IS — pulled in
        // with the sides so the pair reads as bunched hair, not ear muffs
        const tH = 0.34 * k, pw = 0.115, px = 0.052;
        for (const s of [-1, 1]) {
          const g = rbox(pw * k, tH, pw * k, 0.05 * k, [2, 3, 2]);
          sculpt(g, function (v) { const u = cl01((tH / 2 - v.y) / tH); v.x *= 1 - 0.35 * u; v.z *= 1 - 0.35 * u; });
          put(g, s * (S / 2 + px * k), shellTop - 0.24 * k - tH / 2, -0.06 * k);
        }
      }
      return mergeGeos(parts);
    });
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
    const P = charProfile(c.build, c.age);
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
    // The shoe is built here, not by limb(): a shaped shared shoe (see
    // SHAPED PARTS), same slot (leg.userData.cap), same planted sole.
    // BARE OR CLOTHED picks the loft (LIMBS block): a segment the colour of
    // the skin is a bare limb (muscle, knee, calf, ankle); anything else is
    // cloth over it (a trouser leg that falls straight and breaks on the shoe).
    const skinC = c.skin != null ? c.skin : 0xcf9a72;
    const vOf = (hex) => (hex != null && hex === skinC ? "bare" : "cloth");
    const shinC = c.shins != null ? c.shins : c.legs;
    const ll = limb("leg", P.legW, P.legUp, P.legLo, P.legW, c.legs, c.shins, vOf(c.legs), vOf(shinC));
    const rl = limb("leg", P.legW, P.legUp, P.legLo, P.legW, c.legs, c.shins, vOf(c.legs), vOf(shinC));
    if (c.shoes != null) { const bf = c.shoes === skinC; addShoe(ll, P, c.shoes, bf); addShoe(rl, P, c.shoes, bf); }
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

    // A shallow pelvis overlaps both leg caps and the bottom of the torso. It
    // MUST live on `body`, not beside it on `model`: walking rotates and bobs
    // body around the hip socket. A model-level pelvis stays still, so its
    // horizontal top-back corner repeatedly crosses the animated lower-back
    // face and appears as a flickering pants-coloured shelf through the back.
    // Sharing the hip-locked transform makes that overlap rigid while the
    // existing lower tuck continues to cover the independently swinging legs.
    // c.pelvis: the hips in their own colour (swim briefs over bare thighs).
    const pelvis = new THREE.Mesh(boxGeom(P.pelvisW, P.pelvisH, P.pelvisD), cmat(c.pelvis != null ? c.pelvis : c.legs));
    pelvis.position.set(0, hipY + 0.03, 0); pelvis.castShadow = pelvis.receiveShadow = true;
    body.add(pelvis);

    // Stature is BAKED INTO THE SEGMENTS now (a female rig is shorter because
    // her femur and torso boxes are shorter, a toddler because all of them
    // are), so this node does nothing but the metre conversion. The old
    // non-uniform `scale.y * 0.97` fem squash is gone: squashing a body is what
    // made women read as compressed men rather than differently proportioned.
    model.scale.setScalar(humanScale);

    // ---- torso column: chest, plus an optional WAIST box ----------------
    // base sits a whisker below the hip pivot so the column overlaps the pelvis
    // and no sub-frame gap can open. neckY then FALLS OUT of the stack instead
    // of being an adult constant — this single line is what lets a short child
    // torso put the shoulders where they anatomically belong.
    const base = hipY - 0.005;
    const neckY = base + P.torsoH - 0.015;
    const waistH = P.waistShare > 0 ? P.waistShare * P.torsoH : 0;
    const chestBot = base + waistH;
    const chestH = P.torsoH - waistH;
    const torso = new THREE.Mesh(boxGeom(P.torsoW, chestH, P.torsoD), cmat(c.torso));
    torso.position.y = chestBot + chestH / 2;
    torso.castShadow = torso.receiveShadow = true;
    body.add(torso);
    // THE WAIST is the highest-value cheap female cue at gameplay distance.
    // Shoulder:hip alone still reads "small man" until something carves the
    // taper between them (WHR ~0.7-0.8 female vs ~0.85-0.95 male). The SAME box
    // is the toddler's pot belly — there it is WIDER and DEEPER than the chest
    // instead of narrower. Two boxes either way; the profile numbers do all the
    // work, which is the whole point of the table.
    let waist = null;
    if (waistH > 0) {
      // c.waist: the midriff in its own colour (a bikini top's bare middle).
      waist = new THREE.Mesh(boxGeom(P.waistW, waistH + WAIST_TUCK, P.waistD), cmat(c.waist != null ? c.waist : c.torso));
      // The top tucks UP into the chest box (the same overlap trick the limb
      // joints use), so leaning or a hit reaction can never open a seam.
      waist.position.y = base + (waistH + WAIST_TUCK) / 2;
      waist.castShadow = waist.receiveShadow = true;
      body.add(waist);
    }
    /* ---- the SHOULDER YOKE (rig.skinSlots.collar) -------------------------
       OWNER BUG: "security guards and my player sometimes have what looks like
       a WHITE NECK ROLL — it disrupts outfits and FLICKERS, meaning it must be
       overlapping." It does overlap, and the flicker is ARITHMETIC, not taste:
       collarW/collarD were authored in the profile table against NOTHING, and
       on shipped bodies they came out EXACTLY equal to a plane they sit on.
         • ADULT_F  collarD 0.46 == torsoD 0.46 — the yoke's front AND back
           faces share a plane with the chest's over the whole 0.145 they
           overlap. BOTH are front-facing and BOTH are visible, which is a
           guaranteed z-fight stipple across the upper chest, drawn in the
           yoke's flat colour (outfits.js's `security` is 0xe8e8e8 — a near-
           white band). Every child body from ~15 up lands on it too.
         • ADULT_M  collarW/2 0.47 == armX - armW/2 0.47 — the yoke butts the
           arm sockets on exactly their inner plane.
       So the box is no longer authored against nothing: it is CLAMPED into the
       gaps it actually bridges. PROUD of the chest and BURIED into each arm
       socket by a minimum YOKE_CLEAR per face — the 0.01-0.03 clearance family
       the belt block below already uses, and the same overlap trick limb()
       uses at the elbow and the pelvis uses over the leg caps, so no seam can
       open when gait, lean and a hit reaction blend on one frame. Coplanarity
       is now impossible BY CONSTRUCTION instead of by luck, for every body the
       table can build. ADULT_M's depth is unchanged (0.50 + 2x0.01 IS the
       authored 0.52); its width grows 0.02, every millimetre of it inside the
       arm socket where nothing can see it.
       One-line revert: CBZ.CONFIG.CHAR_YOKE_CLEAR = false. */
    const yokeClear = !CBZ.CONFIG || CBZ.CONFIG.CHAR_YOKE_CLEAR !== false;
    // clear the plane, whichever side of it you are on — a face that is BURIED
    // is as safe as a face that is PROUD, and only a face that is ON it fights.
    const clearOf = (v, plane) => (Math.abs(v - plane) < 2 * YOKE_CLEAR ? plane + 2 * YOKE_CLEAR : v);
    let collarD = P.collarD, collarW = P.collarW;
    if (yokeClear) {
      collarD = Math.max(collarD, P.torsoD + 2 * YOKE_CLEAR);
      collarW = Math.max(collarW, (P.armX - P.armW / 2 + YOKE_CLEAR) * 2);
      // …and the HEAD sits IN the yoke on a young body (neckDrop sinks it), so
      // its faces are a plane the yoke can land on too: at age ~2.5 the clamps
      // above put the yoke's depth within 0.8mm of the skull's.
      collarD = clearOf(collarD, P.headSize);
      collarW = clearOf(collarW, P.headSize);
    }
    const collar = new THREE.Mesh(boxGeom(collarW, P.collarH, collarD), cmat(c.collar || c.torso));
    collar.position.y = neckY - 0.04;
    body.add(collar);

    // short-sleeve opt-in: the forearm reads as bare skin (peds.js tees).
    const shoulderY = neckY - 0.04;
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

    // neck pivot so the head can turn/tilt independently. neckDrop sinks the
    // head toward the shoulders for the young: a toddler has no visible neck at
    // all, and that "head sitting straight on the shoulders" read is half of
    // what makes a small body look like a CHILD instead of a distant adult.
    const neck = new THREE.Group();
    neck.position.y = neckY - P.neckDrop;
    // head keeps a FRESH (unshared) material — reactions.js / gore.js /
    // crowd.js tint it per actor, so it must not be a shared cache entry. Its
    // GEOMETRY is shared (see SHAPED PARTS): one per form + nose, sized by
    // scale, and it carries the neck, nose and ears in the same skin.
    const headSize = P.headSize;
    const hk = headSize / 0.60;
    const form = headForm(P);
    const skinHex = c.skin != null ? c.skin : 0xcf9a72;
    const hairHex = c.hair != null ? c.hair : 0x4a3526;
    const noseV = c.nose != null ? c.nose : defaultNose(skinHex, hairHex);
    const head = new THREE.Mesh(headGeometry(form, noseV), mat(skinHex));
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
    const lidMat = cmat(lidTone(skinHex));
    const lidUp = new THREE.Mesh(lidGeometry("U", eyeShape, form), lidMat);
    const lidLow = new THREE.Mesh(lidGeometry("L", eyeShape, form), lidMat);
    lidUp.position.set(0, EYE.y, eyeZ); lidLow.position.set(0, EYE.y, eyeZ);
    lidUp.name = "lidUpper"; lidLow.name = "lidLower";
    const lashes = new THREE.Mesh(lashGeometry(eyeShape, form), cmat(LASH));
    lashes.name = "lashes";
    lidUp.add(lashes);
    eyesNear.add(le, re, lidUp, lidLow);
    const farEyes = new THREE.Mesh(farEyeGeometry(), farEyeMat());
    farEyes.name = "farEyes";
    eyesFar.add(farEyes);
    // BROWS: one mesh, a shaped brow over each eye, in the hair's own tone.
    // Its geometry hangs BELOW its origin, so position.y is the brow's top.
    const brow = new THREE.Mesh(browGeometry(form, "n"), cmat(c.brow != null ? c.brow : browTone(hairHex)));
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
       per (style, form), squeezed by the head's own jaw taper so it hugs the
       chin (see beardGeometry). A full beard stops UNDER the mouth so the lips
       read; the moustache sits under the nose over the upper lip. Stubble is
       a thinner jaw in a tone halfway between hair and skin. */
    const beardParts = [];
    if (c.beard) {
      const bm = c.beard === "stubble" ? cmat(mixHex(hairHex, skinHex, 0.55)) : cmat(hairHex);
      const bd = new THREE.Mesh(beardGeometry(c.beard, form), bm);
      bd.castShadow = false; bd.name = "beard";
      face.add(bd); beardParts.push(bd);
    }
    body.add(neck);

    // ---- accessories (all on the body so they move with it) ----
    if (c.stripes) for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(boxGeom(0.94, 0.12, 0.52), cmat(c.stripes));
      s.position.y = 1.18 + i * 0.28; body.add(s);
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
    if (c.badge) {
      const badge = new THREE.Mesh(boxGeom(0.16, 0.16, 0.05), cmat(0xffd451));
      badge.position.set(-0.28, chestBot + chestH * 0.64, P.torsoD / 2 + 0.02);
      body.add(badge); badgeParts.push(badge);
    }
    if (c.cap) {
      const ck = headSize / 0.60;
      const cap = new THREE.Mesh(boxGeom(0.66 * ck, 0.22 * ck, 0.66 * ck), cmat(c.cap));
      cap.position.y = headSize + 0.07 * ck; neck.add(cap); capParts.push(cap);
      const brim = new THREE.Mesh(boxGeom(0.66 * ck, 0.1 * ck, 0.3 * ck), cmat(c.cap));
      brim.position.set(0, headSize - 0.02 * ck, 0.42 * ck); neck.add(brim); capParts.push(brim);
    } else if (!c.bald) {
      // c.bald (entities/heritage.js): a SHAVED head is no hair mesh at all —
      // the scalp is the skull's own skin, not a skin-coloured cap.
      // ONE MERGED SHELL — see the HAIR SHELL block above for the owner bug and
      // why a skull-cap-plus-back-plank can never be fixed by tucking. The
      // boxes are merged into a single cached BufferGeometry, so the seam
      // cannot exist (there is no seam) and a long-haired woman now costs ONE
      // draw call where she used to cost two.
      let styleId = hairStyleFor(c, P);
      if (styleId === "afro" && c.hat) styleId = "curly";   // an afro would stand through any hat crown
      const hairMesh = new THREE.Mesh(hairGeometry(styleId, headSize), cmat(c.hair || 0x4a3526));
      hairMesh.castShadow = true;
      hairMesh.userData.hairStyle = styleId;
      neck.add(hairMesh); hairParts.push(hairMesh);
    }
    /* ---- A HAT WORN OVER THE HAIR (c.hat: "sun" | "cap", c.hatColor) -------
       c.cap above REPLACES the hair (a uniform cap, a shaved line under it),
       so taking it off leaves a bald man. A beach hat comes off at the water's
       edge and the hair has to still be there — survivorbot.js hides
       skinSlots.cap while its wearer swims. So these are built OVER the hair
       shell: the crown is 0.70k wide against the hair's 0.64k (hairGeometry's
       S + 0.04) and tops out 0.10k above its 0.06k crown, so the shell is
       enclosed with a clear margin on every face and nothing is coplanar.
       Same cached boxes and colour materials as everything else here. */
    if (c.hat === "sun" || c.hat === "cap") {
      const hk = headSize / 0.60;
      const hm = cmat(c.hatColor != null ? c.hatColor : 0xe6d3a3);
      const crown = new THREE.Mesh(boxGeom(0.70 * hk, 0.20 * hk, 0.70 * hk), hm);
      crown.position.y = headSize + 0.06 * hk; neck.add(crown); capParts.push(crown);
      const brim = c.hat === "sun"
        ? new THREE.Mesh(boxGeom(1.12 * hk, 0.04 * hk, 1.12 * hk), hm)     // wide straw brim, all round
        : new THREE.Mesh(boxGeom(0.60 * hk, 0.06 * hk, 0.30 * hk), hm);    // a peak, forward
      if (c.hat === "sun") brim.position.y = headSize - 0.03 * hk;
      else brim.position.set(0, headSize - 0.01 * hk, 0.47 * hk);
      brim.castShadow = true;
      neck.add(brim); capParts.push(brim);
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
    };
    // HANDS: rig.setHandPose / rig.setHandLod (HANDS block above makeCharacter)
    rig.handFit = handFit;
    rig.setHandPose = function (side, pose) { setBodyHandPose(rig, side, pose); };
    // one distance LOD for the whole body: the hands (fphands body LODs) and
    // the limb lofts (LIMBS block) swap together
    rig.setHandLod = function (lod) { rig._lodExt = true; setBodyHandLod(rig, lod); setLimbLod(rig, lod); };
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
      if (want !== lodNow) { lodNow = want; setBodyHandLod(rig, want); setLimbLod(rig, want); }
    };
    // A c.hat comes off in the water: every swimmer's pose (poseSwimmer) sets
    // rig.swimming true and the caller clears it on landing, so the hat rides
    // that one flag — no caller has to remember it, and it costs a compare.
    if (c.hat && capParts.length) {
      let swimFlag = false;
      Object.defineProperty(rig, "swimming", {
        configurable: true, enumerable: true,
        get() { return swimFlag; },
        set(v) {
          v = !!v;
          if (v === swimFlag) return;
          swimFlag = v;
          for (let i = 0; i < capParts.length; i++) capParts[i].visible = !v;
        },
      });
    }
    if (c.clothes && CBZ.applyClothes) CBZ.applyClothes(rig, c.clothes);
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
  const _mantleGrip = new THREE.Vector3();

  // Aim one shoulder/elbow chain at a fixed world-space ledge point. Limbs are
  // authored down -Y; negative shoulder X swings forward and a negative elbow
  // folds the forearm farther forward. Solving in the body's current local
  // frame keeps the wrists on the lip even while the torso leans and rises.
  function mantleArmSolve(ch, tp, side) {
    const P = ch && ch.profile;
    const part = ch && ch.parts && (side > 0 ? ch.parts.la : ch.parts.ra);
    if (!P || !part || tp.ledgeX == null || tp.rootY == null ||
        !ch.body || !ch.group || typeof ch.body.worldToLocal !== "function") return null;
    // Hands land roughly under their own shoulders. A narrow centre grip made
    // the elbows flare sideways even when the Y/Z solve was correct.
    const gripHalf = Math.min(0.43, ((ch.metric && ch.metric.width) || 0.9) * 0.40);
    // local +X in world space for a root facing (dirX,dirZ) is (dirZ,-dirX).
    _mantleGrip.set(
      tp.ledgeX + tp.dirZ * gripHalf * side,
      tp.top + 0.018,
      tp.ledgeZ - tp.dirX * gripHalf * side
    );
    ch.group.updateMatrixWorld(true);
    ch.body.worldToLocal(_mantleGrip);

    const dx = _mantleGrip.x - part.position.x;
    let dy = _mantleGrip.y - part.position.y;
    let dz = _mantleGrip.z - part.position.z;
    const l1 = Math.max(0.12, P.armUp - 0.02);
    const l2 = Math.max(0.12, P.armLo + 0.01);
    // Rotation.z handles the modest inward hand spacing. Solve the remaining
    // sagittal reach in Y/Z, clamped just inside full extension so the elbow
    // always retains a visible, load-bearing bend.
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
    const inward = Math.atan2(dx, Math.max(0.16, reach));
    return {
      shoulder: -shoulder,
      elbow: -elbow,
      roll: Math.max(-0.48, Math.min(0.48, inward)),
    };
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
  function charArmTo(ch, worldPoint, arm, k) {
    const P = ch && ch.profile;
    const part = ch && ch.parts && (arm === "l" ? ch.parts.la : ch.parts.ra);
    const low = part && part.userData && part.userData.low;
    if (!P || !part || !low || !ch.body || !worldPoint) return null;
    const blend = k == null ? 1 : Math.max(0, Math.min(1, k));
    if (blend <= 0) return null;

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
    if (d < 1e-4) return null;
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
    part.rotation.x += (wrap(rx) - part.rotation.x) * blend;
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
  const _awPQ = new THREE.Quaternion(), _awW = new THREE.Vector3();
  function perpNorm(v, axis) {
    v.addScaledVector(axis, -v.dot(axis));
    const l = v.length();
    if (l < 1e-6) return false;
    v.multiplyScalar(1 / l);
    return true;
  }
  // the chest (+ waist) box in the arms' parent frame, cached per rig
  function armChestBox(ch) {
    if (ch._armChest !== undefined) return ch._armChest;
    const slots = ch.skinSlots && ch.skinSlots.torso;
    let box = null;
    if (slots && slots.length && ch.parts && ch.parts.la) {
      const parent = ch.parts.la.parent;
      const b = new THREE.Box3(), m = new THREE.Matrix4();
      box = new THREE.Box3();
      for (let i = 0; i < slots.length; i++) {
        const mesh = slots[i];
        if (!mesh || !mesh.geometry) continue;
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        m.identity();
        let o = mesh;
        for (; o && o !== parent; o = o.parent) { o.updateMatrix(); m.premultiply(o.matrix); }
        if (o !== parent) continue;
        box.union(b.copy(mesh.geometry.boundingBox).applyMatrix4(m));
      }
      if (box.isEmpty()) box = null;
      else box.expandByScalar(0.04);
    }
    ch._armChest = box;
    return box;
  }
  const _acE = new THREE.Vector3(), _acX = new THREE.Vector3(), _acP = new THREE.Vector3();
  // samples of the elbow + forearm inside the box, elbow swung th round its circle
  function armInChest(box, S, dir, a, h, pole, th, W) {
    _acX.crossVectors(dir, pole);
    _acE.copy(S).addScaledVector(dir, a)
      .addScaledVector(pole, h * Math.cos(th)).addScaledVector(_acX, h * Math.sin(th));
    let n = 0;
    for (let i = 0; i <= 5; i++) {
      _acP.copy(_acE).lerp(W, i / 6);
      if (box.containsPoint(_acP)) n++;
    }
    return n;
  }
  charArmTo.wrist = function (ch, worldPoint, arm, fore, k) {
    const P = ch && ch.profile;
    const part = ch && ch.parts && (arm === "l" ? ch.parts.la : ch.parts.ra);
    const low = part && part.userData && part.userData.low;
    const parent = part && part.parent;
    if (!P || !low || !parent || !worldPoint) return null;
    const blend = k == null ? 1 : Math.max(0, Math.min(1, k));
    if (blend <= 0) return null;
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
    /* NOT THROUGH THE CHEST. A forearm led in along a hand on a gun held at
       the sternum would have its elbow INSIDE the torso (the ideal elbow is
       straight back down the bore). Walk the elbow round its circle, the
       least way from the pole, until neither it nor the forearm is inside
       the chest/waist box (margin 4 cm). */
    const box = armChestBox(ch);
    if (box && h > 1e-4 && armInChest(box, part.position, _awD, a, h, _awP, 0, _awW) > 0) {
      _awX.crossVectors(_awD, _awP);
      let best = 0, bestScore = Infinity;
      for (let i = 1; i <= 12; i++) {
        for (let s = -1; s <= 1; s += 2) {
          const th = s * i * Math.PI / 12;
          const sc = armInChest(box, part.position, _awD, a, h, _awP, th, _awW) * 10 + i;
          if (sc < bestScore) { bestScore = sc; best = th; }
        }
        if (bestScore < 10) break;
      }
      // the boundary, not the 15° step: refine between the last blocked and
      // the first clear angle, so the elbow moves continuously with its input
      if (bestScore < 10 && best !== 0) {
        let lo = best - Math.sign(best) * Math.PI / 12, hi = best;
        for (let k = 0; k < 6; k++) {
          const mid = (lo + hi) / 2;
          if (armInChest(box, part.position, _awD, a, h, _awP, mid, _awW) > 0) lo = mid; else hi = mid;
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
  // how many samples of this arm's elbow->crease run inside the chest/waist
  // box itself (no margin) — a solve that has a choice can prefer 0
  const _icA = new THREE.Vector3(), _icB = new THREE.Vector3();
  charArmTo.inChest = function (ch, arm) {
    const part = ch && ch.parts && (arm === "l" ? ch.parts.la : ch.parts.ra);
    const low = part && part.userData && part.userData.low;
    const mb = low && armChestBox(ch);
    if (!mb) return 0;
    const box = ch._armChestRaw || (ch._armChestRaw = mb.clone().expandByScalar(-0.04));
    const cap = part.userData.cap;
    const parent = part.parent;
    low.updateWorldMatrix(true, false);
    parent.updateWorldMatrix(true, false);
    _icA.set(0, 0, 0); low.localToWorld(_icA); parent.worldToLocal(_icA);
    _icB.set(0, (cap && cap.userData.fit) ? cap.userData.fit.wristY : -0.26, 0); low.localToWorld(_icB); parent.worldToLocal(_icB);
    let n = 0;
    for (let i = 0; i <= 6; i++) { if (box.containsPoint(_acP.copy(_icA).lerp(_icB, i / 6))) n++; }
    return n;
  };
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
  const hipYOf = (ch) => (ch && ch.hipY > 0 ? ch.hipY : CHARACTER_HIP_Y);
  const LEG_KEYS = ["ll", "rl"];
  const _hipPivot = new THREE.Vector3();
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
    return true;
  }

  function poseSwimmer(ch, st, opts) {
    if (!ch || !ch.group || !st) return false;
    const o = opts || {};
    if (st.prone) {
      ch.swimming = true;
      if (o.pos) ch.group.position.copy(o.pos);
      return poseSwimmerProne(ch, st, o);
    }
    ch.swimming = true;
    if (o.pos) ch.group.position.copy(o.pos);
    const m = st.mood;                      // 0 = gliding crawl, 1 = treading
    const sw = Math.sin(st.stroke);
    const tw = Math.sin(st.tread);
    // Body attitude: flat and prone while swimming, near-vertical while
    // treading, nose-down/up when you are actively driving through the column.
    const pitchDrive = Math.max(-0.55, Math.min(0.55, -(+o.vy || 0) * 0.22));
    ch.group.rotation.x = 0;
    if (ch.body) {
      ch.body.rotation.x = (0.30 + pitchDrive) * (1 - m) + 0.95 * m;
      ch.body.position.y = (Math.sin(st.stroke * 2) * 0.028) * (1 - m) + (tw * 0.02) * m;
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
    }
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
  function animChar(ch, speed, dt) {
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
      const ref = ch.seatRef && (!CBZ.CONFIG || CBZ.CONFIG.CHAR_SEAT_POSE_V2 !== false) ? ch.seatRef : null;
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
        if (ch.parts.la) { ch.parts.la.rotation.x = damp(ch.parts.la.rotation.x, armX - stw * 0.18, sr, dt); ch.parts.la.rotation.z = damp(ch.parts.la.rotation.z, armZ + stw * 0.10, sr, dt); ch.parts.la.rotation.y = damp(ch.parts.la.rotation.y, 0, sr, dt); ch.parts.la.position.z = damp(ch.parts.la.position.z, 0.06, sr, dt); }
        if (ch.parts.ra) { ch.parts.ra.rotation.x = damp(ch.parts.ra.rotation.x, armX + stw * 0.18, sr, dt); ch.parts.ra.rotation.z = damp(ch.parts.ra.rotation.z, -armZ + stw * 0.10, sr, dt); ch.parts.ra.rotation.y = damp(ch.parts.ra.rotation.y, 0, sr, dt); ch.parts.ra.position.z = damp(ch.parts.ra.position.z, 0.06, sr, dt); }
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
      if (ch.parts.la) { ch.parts.la.rotation.x = damp(ch.parts.la.rotation.x, -0.34 + tw, sr, dt); ch.parts.la.rotation.z = damp(ch.parts.la.rotation.z, 0.12, sr, dt); ch.parts.la.rotation.y = damp(ch.parts.la.rotation.y, 0, sr, dt); ch.parts.la.position.z = damp(ch.parts.la.position.z, 0.06, sr, dt); }
      if (ch.parts.ra) { ch.parts.ra.rotation.x = damp(ch.parts.ra.rotation.x, -0.34 - tw, sr, dt); ch.parts.ra.rotation.z = damp(ch.parts.ra.rotation.z, -0.12, sr, dt); ch.parts.ra.rotation.y = damp(ch.parts.ra.rotation.y, 0, sr, dt); ch.parts.ra.position.z = damp(ch.parts.ra.position.z, 0.06, sr, dt); }
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
        // lockCharacterHips changes the body's translation after a pitch. Apply
        // it before the world→body conversion so the wrist target includes the
        // exact compensated shoulder position used for rendering.
        lockCharacterHips(ch);
        const leftGrip = mantleArmSolve(ch, tp, 1);
        const rightGrip = mantleArmSolve(ch, tp, -1);
        const press = smoother01((u - 0.48) / 0.28) *
          (1 - smoother01((u - 0.80) / 0.18));
        const armRest = -0.20 - 0.32 * press;
        const leftX = leftGrip ? armRest + (leftGrip.shoulder - armRest) * hold : -0.20 - 1.18 * hold;
        const rightX = rightGrip ? armRest + (rightGrip.shoulder - armRest) * hold : -0.20 - 1.18 * hold;
        const leftZ = leftGrip ? -0.10 + (leftGrip.roll + 0.10) * hold : -0.18 * hold;
        const rightZ = rightGrip ? 0.10 + (rightGrip.roll - 0.10) * hold : 0.18 * hold;
        limb(ch.parts.la, leftX, 0.05, leftZ, 0.04 * hold);
        limb(ch.parts.ra, rightX, -0.05, rightZ, 0.04 * hold);
        setElbow(J.la, leftGrip ? -0.18 + (leftGrip.elbow + 0.18) * hold : -0.20 - hold * 0.82, sr);
        setElbow(J.ra, rightGrip ? -0.18 + (rightGrip.elbow + 0.18) * hold : -0.20 - hold * 0.82, sr);
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
          ch.body.position.y = damp(ch.body.position.y, -0.16 * plant, sr, dt);
          ch.body.rotation.x = damp(ch.body.rotation.x, -0.50 * plant, sr, dt);
          ch.body.rotation.z = damp(ch.body.rotation.z, 0, sr, dt);
          limb(ch.parts.la, -0.18 - 1.62 * plant, 0.08, -0.16, 0.16 * plant);
          limb(ch.parts.ra, -0.18 - 1.62 * plant, -0.08, 0.16, 0.16 * plant);
          setElbow(J.la, -0.18 - plant * 0.34, sr);
          setElbow(J.ra, -0.18 - plant * 0.34, sr);
          limb(ch.parts.ll, -0.12 - tuck * 1.18, 0, 0.11, 0);
          limb(ch.parts.rl, -0.12 - tuck * 1.18, 0, -0.11, 0);
          setKnee(J.ll, 0.08 + tuck * 1.48, sr);
          setKnee(J.rl, 0.08 + tuck * 1.48, sr);
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
          }
        } else {
          // One-hand speed vault: plant left, throw the opposite arm back, split
          // the legs sideways and let the hips skim the obstacle.
          ch.body.position.y = damp(ch.body.position.y, -0.12 * plant, sr, dt);
          ch.body.rotation.x = damp(ch.body.rotation.x, -0.34 * plant, sr, dt);
          ch.body.rotation.z = damp(ch.body.rotation.z, -0.34 * air, sr, dt);
          limb(ch.parts.la, -0.18 - 1.66 * plant, 0.10, -0.42, 0.16 * plant);
          limb(ch.parts.ra, 0.36 * air, -0.16, 0.72 * air, 0);
          setElbow(J.la, -0.16 - plant * 0.26, sr);
          setElbow(J.ra, -0.38 - air * 0.18, sr);
          limb(ch.parts.ll, -0.18 - tuck * 0.48, 0.18, 0.58 * air, 0);
          limb(ch.parts.rl, -0.14 - tuck * 0.92, -0.12, -0.24 * air, 0);
          setKnee(J.ll, 0.08 + tuck * 0.62, sr);
          setKnee(J.rl, 0.08 + tuck * 1.18, sr);
        }
        if (tp.style !== "spin" && ch.model) {
          ch.model.rotation.x = damp(ch.model.rotation.x, 0, sr, dt);
          ch.model.rotation.y = damp(ch.model.rotation.y, 0, sr, dt);
          ch.model.rotation.z = damp(ch.model.rotation.z, 0, sr, dt);
        }
        if (ch.neck) {
          ch.neck.rotation.x = damp(ch.neck.rotation.x, -0.16 * air, sr, dt);
          ch.neck.rotation.z = damp(ch.neck.rotation.z, tp.style === "spin" ? 0.12 * air : 0, sr, dt);
        }
      }
      ch.bob = ch.body.position.y;
      ch.lean = ch.body.rotation.x;
      ch.sway = ch.body.rotation.z;
      ch._stanceNk = 1;                 // reuse the proven full-pose neck recovery
      ch._traverseRecover = 1;
      lockCharacterHips(ch);
      return;
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
    const crouchHip = cb * 0.52;                 // thighs fold toward the chest
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
    setKnee(J.ll, kneeL + lBend * 1.4 + cb * 1.00, legRate);
    setKnee(J.rl, kneeR + rBend * 1.4 + cb * 1.00, legRate);

    // ---- arms ----
    if (ch.aimingPose) {
      // present-weapon: gun arm out along the crosshair, support arm on the
      // handguard. animChar is the single owner of the arms while aiming.
      const longGun = !!ch.aimLong;
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
      ch.parts.ra.rotation.x = damp(ch.parts.ra.rotation.x, -1.571 + 0.12 * hv - pitch * 0.8 - recoil * 0.16, ar, dt);
      ch.parts.ra.rotation.y = damp(ch.parts.ra.rotation.y, 0.18 - recoilSide * 0.22, ar, dt);
      ch.parts.ra.rotation.z = damp(ch.parts.ra.rotation.z, 0.34, ar, dt);
      ch.parts.ra.position.z = damp(ch.parts.ra.position.z, 0.14, ar, dt);
      // A pistol is still a TWO-HAND shot. The old sidearm targets left the
      // support fist beside the left shoulder while the gun floated in the
      // right hand (visible from the prison chase camera). Cross and extend the
      // support arm onto the firing wrist; long guns keep their handguard pose.
      ch.parts.la.rotation.x = damp(ch.parts.la.rotation.x, (longGun ? -1.55 : -1.56) - 0.14 * hv - pitch * 0.8, ar - 1, dt);
      ch.parts.la.rotation.y = damp(ch.parts.la.rotation.y, (longGun ? -0.34 : -0.32) - 0.10 * hv, ar - 1, dt);
      ch.parts.la.rotation.z = damp(ch.parts.la.rotation.z, longGun ? -0.42 : -0.68, ar - 1, dt);
      ch.parts.la.position.z = damp(ch.parts.la.position.z, (longGun ? 0.24 : 0.20) + hsup * 0.5, ar - 1, dt);
      // gun arm nearly locked; the support elbow closes onto the handguard.
      // recoil folds the elbow a touch — the arm absorbs the kick.
      setElbow(J.ra, -0.10 - recoil * 0.25, ar);
      setElbow(J.la, (longGun ? -0.72 : -0.22) - 0.26 * hv, ar - 1);
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
        ch.parts.ra.rotation.z = damp(ch.parts.ra.rotation.z, -0.16, cr, dt);  // out from the actual right thigh
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
        ch.parts.la.rotation.z = damp(ch.parts.la.rotation.z, -0.08, 6, dt);
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
    if (!ch.aimingPose) {
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
      // The shoulder roots were corrected to semantic right = local -X in
      // makeCharacter. Keep the holster on that SAME side so a right-hand
      // stow does not cross the pelvis toward the obsolete +X hip.
      hip:   mk(-0.46 * s, 1.05 * s, -0.20 * s, -1.781, 0.26, Math.PI),
    };
    return rig._mounts;
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
        const bottom = _grPos.y + _grCentre.y - eY;
        const from = _grPos.y + _grCentre.y + eY + 0.4;
        let floor = gunFloorAt(cxW, czW, from);
        floor = Math.max(floor, gunFloorAt(cxW + eX, czW + eZ, from));
        floor = Math.max(floor, gunFloorAt(cxW - eX, czW - eZ, from));
        floor = Math.max(floor, gunFloorAt(cxW + eX, czW - eZ, from));
        floor = Math.max(floor, gunFloorAt(cxW - eX, czW + eZ, from));
        const need = floor + GUN_REST_CLEAR - bottom;
        // a DEPLOYED bipod is the only case that also settles DOWN onto the
        // surface; everything else may only ever be lifted out of it
        const deployed = !!(ch.aimBipod && prop.userData && prop.userData.bipod);
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
    if (Math.abs(ch._gunRestY) < 1e-4) {
      ch._gunRestY = 0;
      if (socket.position.x !== base.x || socket.position.y !== base.y || socket.position.z !== base.z) {
        socket.position.copy(base);
      }
      return;
    }
    // The lift is a WORLD +Y translation; the socket lives in the rotated,
    // rig-scaled hand frame, so take it back through both.
    const parent = socket.parent || socket;
    parent.updateWorldMatrix(true, false);
    parent.matrixWorld.decompose(_grPos, _grHandQ, _grScale);
    const s = Math.abs(_grScale.y) > 1e-5 ? _grScale.y : 1;
    _grDelta.set(0, ch._gunRestY / s, 0).applyQuaternion(_grHandQ.invert());
    socket.position.set(base.x + _grDelta.x, base.y + _grDelta.y, base.z + _grDelta.z);
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
    const neckOverHip = P.torsoH - 0.020 - (P.neckDrop || 0);
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
      for (const m of list) if (m && m.material && m.material.color) {
        if (m.material._shared) m.material = m.material.clone();
        m.material.color.setHex(hex);
      }
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
    eyeColours: EYE_COLOURS,
    // shared-geometry builders, for tools and previews (all cached)
    geometry: { head: headGeometry, hair: hairGeometry, brow: browGeometry, beard: beardGeometry, shoe: shoeGeometry,
                eyeball: eyeballGeometry, lid: lidGeometry, lip: lipGeometry },
    // THE FACE: facePose(rig, pose) is the one writer of eyes/lids/lips/brow;
    // faceLod(rig, near) the tier; facial.js drives both. faceRestPose is the
    // neutral pose object (read-only), faceExpressions the lip shapes.
    facePose: facePose,
    faceLod: faceLod,
    faceRestPose: REST_POSE,
    faceExpressions: Object.keys(LIP_EXPR),
    lidTone: lidTone,
  };
})();
