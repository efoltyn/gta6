/* ============================================================
   systems/fphands.js — THE ONE FIRST-PERSON HAND (and the arm behind it).

   OWNER: "first person hands and first person arms, right now they look like
   they're CROSSED sometimes. Just make the hands look better too."

   There were FOUR private hand systems, all of them blocks:
     · fpsmode.js fists: a 0.19 m cube fist + a forearm box that was a RIGID
       CHILD of the fist. The forearm could only ever point wherever the fist's
       Euler said, and the guard / hook tables yawed both fists INWARD
       (ry -0.50 right, +0.55 left) — so the two forearm tails converged to
       within 7 cm of each other at the bottom of the frame and the boxes
       overlapped into an X. A right hook ended at x -0.12, inside the left
       guard at x -0.16: the right forearm went straight through the left one.
     · the gun kit's K.hand (weapons/appearances/sidearm.js): a box palm, a
       profile finger wad and a box thumb, with NO arm at all; five guns used a
       plain skin brick instead. The off hand did not exist in first person.
     · the car cabin's hands (city/playercars.js): a rounded box on the rim
       with a forearm box parented to the SPINNING wheel, so at full lock the
       whole arm swung round with the rim like a clock hand.
     · the bailout rig (city/bailout.js): two unlit boxes.

   Now one model, used by all four:
     · a real hand: a cupped, tapered palm with a thenar pad, four fingers in
       three segments with knuckles, a thumb that opposes, a wrist — one merged
       geometry per (side, pose), cached and shared, ~1.3k triangles;
     · finger curl per grip, DERIVED from the thing held: a grip is a cylinder
       of radius R and each finger's joints are the chords of that circle, so
       a pistol, a handguard, a steering rim and a fist are the same maths;
     · a tapered forearm and an upper arm SOLVED by two-bone IK from a fixed
       shoulder with the elbow pole always DOWN and OUT on its own side. That
       is what makes crossing impossible by construction: a hand may cross the
       midline (a hook, a rifle's support hand) but its elbow never does, so
       the two forearms can never pass through each other.
     · dress read off the body: hand colour from the rig's hand slot (gloves
       come through), forearm from armsLower (a tee is bare skin, a jacket is
       a sleeve with a cuff), upper arm from the shirt, skin tone from the
       character's heritage via the rig's own skinTone.

   Hand frame (RIGHT hand; the left is a true mirror with its winding fixed):
     origin = the wrist, fingers along -Z, palm faces -Y, thumb on -X.
   Pure maths (solveElbow, flexForWrap, fingerChain) is exported on
   CBZ.fpHands.math so tools/fp-hands-check.mjs can assert it in plain node.
============================================================ */
(function () {
  "use strict";
  const root = typeof window !== "undefined" ? window : globalThis;
  const CBZ = root.CBZ = root.CBZ || {};
  const THREE = root.THREE;
  if (!THREE) return;
  if (CBZ.fpHands && CBZ.fpHands.version) return;

  // ------------------------------------------------------------ anatomy
  // Adult male hand at size 1, metres. The palm is 0.084 wide at the knuckles,
  // 0.096 wrist-to-knuckle; finger segment lengths are the usual proportions.
  const PALM = { hw: 0.042, len: 0.096, th: 0.028 };
  const FINGERS = [
    { x: -0.029, z: -0.094, seg: [0.041, 0.025, 0.020], r: 0.0094, splay: -0.06 },   // index
    { x: -0.009, z: -0.098, seg: [0.046, 0.029, 0.021], r: 0.0098, splay: -0.01 },   // middle
    { x: 0.012, z: -0.095, seg: [0.043, 0.028, 0.021], r: 0.0091, splay: 0.05 },     // ring
    { x: 0.031, z: -0.086, seg: [0.034, 0.020, 0.018], r: 0.0080, splay: 0.11 },     // little
  ];
  const THUMB = { base: [-0.027, -0.007, -0.020], seg: [0.044, 0.033, 0.027], r: [0.0128, 0.0112, 0.0100] };
  const JOINT_MAX = [1.57, 1.90, 1.25];

  // ------------------------------------------------------------ pure maths
  /* Flexion that wraps a finger round a cylinder of radius R whose axis runs
     along the hand's X, tangent to the palm just behind the knuckle row. Each
     segment is a chord of the circle its centreline follows, so the joint
     angle between two chords is half the arc of each. */
  function flexForWrap(R, f) {
    if (!(R > 0) || R === Infinity) return [0.08, 0.10, 0.06];
    const cy = PALM.th * 0.5 + R, cz = 0.012;           // axis: under the palm, a hair behind the knuckle
    const Rc = Math.hypot(cy, cz);
    const phi0 = Math.atan2(cz, cy);
    const th = f.seg.map(function (L) { return 2 * Math.asin(Math.min(1, L / (2 * Rc))); });
    const out = [phi0 + th[0] * 0.5, (th[0] + th[1]) * 0.5, (th[1] + th[2]) * 0.5];
    for (let i = 0; i < 3; i++) out[i] = Math.min(JOINT_MAX[i], out[i]);
    return out;
  }
  // joint positions of one finger for flexion [mcp, pip, dip] (right-hand frame)
  function fingerChain(f, flex, splay) {
    const curl = Math.min(1, Math.max(0, flex[0]) / 1.5);
    const sp = splay != null ? splay : f.splay * (1 - 0.6 * curl);   // fingers gather as they close
    const dx = Math.sin(sp), dz = -Math.cos(sp);
    const pts = [[f.x, 0, f.z]];
    let a = 0, p = pts[0];
    for (let i = 0; i < 3; i++) {
      a += flex[i];
      const c = Math.cos(a), s = Math.sin(a), L = f.seg[i];
      p = [p[0] + dx * c * L, p[1] - s * L, p[2] + dz * c * L];
      pts.push(p);
    }
    return pts;
  }
  /* TWO-BONE IK. S shoulder, W wrist, pole = where the elbow should bulge.
     Out of reach: the forearm keeps its length and the upper arm stretches —
     the upper arm is the part the lens barely sees. */
  function solveElbow(S, W, pole, L1, L2) {
    const dx = W[0] - S[0], dy = W[1] - S[1], dz = W[2] - S[2];
    const d = Math.hypot(dx, dy, dz) || 1e-6;
    const ux = dx / d, uy = dy / d, uz = dz / d;
    if (d >= L1 + L2 - 1e-6) return [W[0] - ux * L2, W[1] - uy * L2, W[2] - uz * L2];
    const dd = Math.max(Math.abs(L1 - L2) + 1e-4, d);
    const a = (L1 * L1 - L2 * L2 + dd * dd) / (2 * dd);
    const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    const pd = pole[0] * ux + pole[1] * uy + pole[2] * uz;
    let px = pole[0] - pd * ux, py = pole[1] - pd * uy, pz = pole[2] - pd * uz;
    const pl = Math.hypot(px, py, pz) || 1;
    px /= pl; py /= pl; pz /= pl;
    return [S[0] + ux * a + px * h, S[1] + uy * a + py * h, S[2] + uz * a + pz * h];
  }
  // closest distance between segments p1-q1 and p2-q2 (for the crossing check)
  function segDist(p1, q1, p2, q2) {
    const d1 = [q1[0] - p1[0], q1[1] - p1[1], q1[2] - p1[2]];
    const d2 = [q2[0] - p2[0], q2[1] - p2[1], q2[2] - p2[2]];
    const r = [p1[0] - p2[0], p1[1] - p2[1], p1[2] - p2[2]];
    const dot = function (a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; };
    const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
    let s, t;
    const c = dot(d1, r), b = dot(d1, d2), den = a * e - b * b;
    s = den > 1e-12 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
    t = (b * s + f) / e;
    if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
    else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    const x = r[0] + d1[0] * s - d2[0] * t, y = r[1] + d1[1] * s - d2[1] * t, z = r[2] + d1[2] * s - d2[2] * t;
    return Math.hypot(x, y, z);
  }

  // ------------------------------------------------------------ poses
  /* A pose: per-finger flexion (or a wrap radius), the thumb's three segment
     directions (right-hand frame), and how much the palm cups. `wrap` = the
     radius of what the hand closes round; `trigger` lays the index along a
     frame onto a trigger instead of round the grip. */
  const T_REST = [[-0.50, -0.42, -0.76], [-0.34, -0.48, -0.81], [-0.24, -0.48, -0.84]];
  const T_OPEN = [[-0.72, -0.22, -0.66], [-0.58, -0.14, -0.80], [-0.48, -0.08, -0.87]];
  const T_FIST = [[-0.36, -0.62, -0.70], [0.55, -0.50, -0.67], [0.95, -0.15, -0.25]];
  const T_WRAP = [[-0.34, -0.66, -0.67], [-0.12, -0.96, -0.24], [0.18, -0.62, -0.76]];
  const T_PINCH = [[-0.48, -0.55, -0.68], [-0.10, -0.62, -0.78], [0.10, -0.55, -0.83]];
  const POSES = {
    open:    { flex: [[0.08, 0.10, 0.06], [0.06, 0.08, 0.05], [0.08, 0.10, 0.06], [0.12, 0.12, 0.08]], thumb: T_OPEN, cup: 0.001 },
    relaxed: { flex: [[0.30, 0.42, 0.22], [0.36, 0.50, 0.26], [0.44, 0.58, 0.30], [0.52, 0.66, 0.34]], thumb: T_REST, cup: 0.004 },
    fist:    { flex: [[1.48, 1.80, 0.95], [1.52, 1.84, 0.95], [1.52, 1.84, 0.95], [1.50, 1.80, 0.95]], thumb: T_FIST, cup: 0.006 },
    // (guns take no table pose: every gun hand is a GRASP solved against the
    // gun's own grip, handguard or pump — see grasp() below)
    wheel:   { wrap: 0.016, thumb: T_WRAP, cup: 0.005 },
    grip:    { wrap: 0.019, thumb: T_FIST, cup: 0.006 },          // a knife / bar / riser
    card:    { flex: [[0.55, 0.55, 0.20], [0.70, 0.95, 0.45], [0.85, 1.10, 0.55], [0.95, 1.20, 0.60]], thumb: T_PINCH, cup: 0.004 },
  };
  function thumbChain(dirs) {
    let tp = THUMB.base.slice();
    const pts = [tp];
    for (let s = 0; s < 3; s++) {
      const d = dirs[s], dl = Math.hypot(d[0], d[1], d[2]) || 1, L = THUMB.seg[s];
      tp = [tp[0] + d[0] / dl * L, tp[1] + d[1] / dl * L, tp[2] + d[2] / dl * L];
      pts.push(tp);
    }
    return pts;
  }
  /* Every pose resolves to JOINT POINTS (right-hand frame): four finger
     chains and the thumb chain. Table poses get them from flexion angles; a
     grasp (below) solves them against the real thing held and hands them in
     directly, so the geometry builder never has to know which it was. */
  function resolvePose(p) {
    const pose = typeof p === "string" ? (POSES[p] || POSES.relaxed) : (p || POSES.relaxed);
    if (pose._joints) return pose;
    if (pose.joints) { pose._joints = pose.joints; return pose; }
    const flex = FINGERS.map(function (f, i) {
      if (pose.flex && pose.flex[i]) return pose.flex[i];
      return flexForWrap(pose.wrap, f);
    });
    pose._flex = flex;
    pose._joints = { fingers: FINGERS.map(function (f, i) { return fingerChain(f, flex[i]); }), thumb: thumbChain(pose.thumb) };
    return pose;
  }
  // centre of the cylinder a wrap pose closes round, hand frame (right hand)
  function gripCentre(p, out) {
    const pose = resolvePose(p);
    const R = pose.wrap || 0.02;
    return (out || new THREE.Vector3()).set(-0.006, -(PALM.th * 0.5 + R), FINGERS[1].z + 0.012);
  }

  // ------------------------------------------------------------ geometry
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
  const _up = new THREE.Vector3(0, 1, 0), _one = new THREE.Vector3(1, 1, 1);
  function place(geo, a, b, parts) {
    // a cylinder geometry (built along +Y, centred) laid from a to b
    _v.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const L = _v.length() || 1e-6;
    _q.setFromUnitVectors(_up, _v.multiplyScalar(1 / L));
    _v2.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    _m.compose(_v2, _q, _one);
    geo.applyMatrix4(_m);
    parts.push(geo);
  }
  function seg(parts, a, b, r0, r1) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    place(new THREE.CylinderGeometry(r1, r0, L, 8, 1, true), a, b, parts);
  }
  function ball(parts, p, r, sx, sy, sz) {
    const g = new THREE.SphereGeometry(r, sx ? 12 : 8, sx ? 8 : 6);
    if (sx) g.scale(sx, sy, sz);
    g.translate(p[0], p[1], p[2]);
    parts.push(g);
  }
  function palmGeo(cup) {
    /* A SUPERELLIPSOID, not a box. The palm used to be a BoxGeometry pushed
       into a rounded box: a box keeps separate vertices per face, so every
       rounded edge became a seam with its own normals and up close (the
       first-person lens IS up close) the heel and the web read as sharp
       folded flaps. One closed, smooth surface instead, squared off by the
       exponent, then shaped as before. */
    const g = new THREE.SphereGeometry(1, 18, 12);
    const pos = g.attributes.position, E = 0.30;
    const hx = PALM.hw, hy = PALM.th / 2, hz = PALM.len / 2;
    const sq = function (v) { return Math.sign(v) * Math.pow(Math.abs(v), E); };
    for (let i = 0; i < pos.count; i++) {
      let x = sq(pos.getX(i)) * hx, y = sq(pos.getY(i)) * hy, z = sq(pos.getZ(i)) * hz;
      const zn = (z + hz) / PALM.len;                  // 0 at knuckles .. 1 at wrist (before translate)
      const u = 1 - zn;                                  // 1 at knuckles
      const xn = x / hx;
      // narrower at the heel, thinner on the little-finger side
      x *= 0.80 + 0.20 * u;
      if (x > 0) y *= 1 - 0.18 * (x / hx);
      // the palm cups: its centre rises away from what it holds
      if (y < 0) y += cup * (1 - xn * xn) * Math.sin(Math.PI * Math.min(1, Math.max(0, u)));
      // the knuckle row arches over the back of the hand
      if (y > 0) y += 0.003 * (1 - xn * xn) * u * u;
      // thenar pad at the thumb's root, hypothenar along the heel's outer edge
      if (y < 0 && xn < -0.2) y -= 0.0065 * Math.min(1, (-xn - 0.2) / 0.6) * Math.max(0, 1 - Math.abs(zn - 0.72) / 0.4);
      if (y < 0 && xn > 0.4) y -= 0.0035 * Math.max(0, 1 - Math.abs(zn - 0.55) / 0.45);
      pos.setXYZ(i, x, y, z - hz);
    }
    g.computeVertexNormals();
    return g;
  }
  function mergeParts(parts) {
    let n = 0;
    const flat = parts.map(function (g) {
      const f = g.index ? g.toNonIndexed() : g;
      if (!f.attributes.normal) f.computeVertexNormals();
      n += f.attributes.position.count;
      return f;
    });
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3);
    let o = 0;
    flat.forEach(function (f) {
      P.set(f.attributes.position.array, o * 3);
      N.set(f.attributes.normal.array, o * 3);
      o += f.attributes.position.count;
      f.dispose();
    });
    parts.forEach(function (g) { g.dispose(); });
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(P, 3));
    out.setAttribute("normal", new THREE.BufferAttribute(N, 3));
    return out;
  }
  function mirrorX(geo) {
    // a TRUE mirror: flip X on positions and normals, then swap each
    // triangle's winding so the faces still point out (a negative scale.x on
    // the mesh would render the hand inside-out).
    const P = geo.attributes.position.array, N = geo.attributes.normal.array;
    for (let i = 0; i < P.length; i += 3) { P[i] = -P[i]; N[i] = -N[i]; }
    for (let t = 0; t < P.length; t += 9) {
      for (let k = 0; k < 3; k++) {
        let tmp = P[t + 3 + k]; P[t + 3 + k] = P[t + 6 + k]; P[t + 6 + k] = tmp;
        tmp = N[t + 3 + k]; N[t + 3 + k] = N[t + 6 + k]; N[t + 6 + k] = tmp;
      }
    }
    return geo;
  }
  function buildHandGeo(side, pose) {
    const p = resolvePose(pose);
    const parts = [palmGeo(p.cup || 0.004)];
    // wrist stub: the hand's own skin, elliptical, sitting into the forearm
    // (a closed ellipsoid: the old open tube showed its hollow end whenever
    // the wrist bent off the forearm's line)
    ball(parts, [0, 0.0005, 0.004], 1, 0.031, 0.0205, 0.040);
    FINGERS.forEach(function (f, i) {
      const pts = p._joints.fingers[i];
      const rs = [f.r * 1.04, f.r * 0.95, f.r * 0.86, f.r * 0.78];
      // knuckle (a touch proud on the back of the hand), the two finger joints, the pad of the tip
      ball(parts, [pts[0][0], pts[0][1] + 0.002, pts[0][2]], f.r * 1.12, 1, 0.95, 1);
      for (let s = 0; s < 3; s++) {
        seg(parts, pts[s], pts[s + 1], rs[s], rs[s + 1]);
        ball(parts, pts[s + 1], rs[s + 1] * (s === 2 ? 1 : 1.04));
      }
      // the web between knuckles: a flat bridge so the fingers leave a palm, not a comb
      if (i < 3) {
        const nx = FINGERS[i + 1];
        seg(parts, [f.x + 0.003, -0.001, f.z + 0.004], [nx.x - 0.003, -0.001, nx.z + 0.004], 0.008, 0.008);
      }
    });
    // thumb: CMC on the heel's thumb side, three segments along authored directions
    const tpts = p._joints.thumb;
    for (let s = 0; s < 3; s++) {
      const r0 = THUMB.r[s] * (s === 0 ? 1.25 : 1), r1 = s < 2 ? THUMB.r[s + 1] : THUMB.r[2] * 0.85;
      seg(parts, tpts[s], tpts[s + 1], r0, r1);
      ball(parts, tpts[s + 1], r1 * 1.03);
    }
    // the fleshy web from thumb to palm (the thumb grows OUT of the hand)
    const mid = [(tpts[0][0] + tpts[1][0]) / 2 + 0.006, (tpts[0][1] + tpts[1][1]) / 2 + 0.003, (tpts[0][2] + tpts[1][2]) / 2 - 0.004];
    ball(parts, mid, 0.016, 1.0, 0.72, 1.35);
    const geo = mergeParts(parts);
    if (side < 0) mirrorX(geo);
    geo.computeBoundingSphere();
    geo._shared = true; geo.userData._shared = true;
    return geo;
  }
  const GEO = {};
  function poseKey(pose) {
    if (typeof pose === "string") return pose;
    return "w" + Math.round((pose.wrap || 0) * 1000) + ":" + (pose.name || "custom");
  }
  function handGeometry(side, pose) {
    const key = (side < 0 ? "L:" : "R:") + poseKey(pose);
    return GEO[key] || (GEO[key] = buildHandGeo(side < 0 ? -1 : 1, pose));
  }
  // unit forearm: +Z from the wrist (z=0) to the elbow (z=1), elliptical and
  // tapered — flat and narrow at the wrist, full at the muscle belly
  let FORE = null, UPPER = null, CUFF = null, ELBOW = null;
  function foreGeo() {
    if (FORE) return FORE;
    const g = new THREE.CylinderGeometry(1, 1, 1, 12, 6, true);
    g.rotateX(Math.PI / 2);                   // along Z, centred
    g.translate(0, 0, 0.5);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      // wrist 0.029 x 0.022 -> belly 0.045 x 0.040 at 70% -> elbow 0.040
      const belly = Math.sin(Math.min(1, z / 0.72) * Math.PI * 0.5);
      const rx = 0.029 + (0.046 - 0.029) * belly - (z > 0.72 ? (z - 0.72) * 0.02 : 0);
      const ry = 0.021 + (0.041 - 0.021) * belly;
      pos.setXYZ(i, pos.getX(i) * rx, pos.getY(i) * ry, z);
    }
    g.computeVertexNormals();
    g._shared = true; g.userData._shared = true;
    return (FORE = g);
  }
  function upperGeo() {
    if (UPPER) return UPPER;
    const g = new THREE.CylinderGeometry(0.048, 0.042, 1, 12, 1, true);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, 0.5);
    g._shared = true; g.userData._shared = true;
    return (UPPER = g);
  }
  function cuffGeo() {
    if (CUFF) return CUFF;
    const g = new THREE.CylinderGeometry(0.036, 0.034, 0.05, 12, 1, true);
    g.scale(1.12, 1, 0.9);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, 0.045);
    g._shared = true; g.userData._shared = true;
    return (CUFF = g);
  }
  function elbowGeo() {
    if (ELBOW) return ELBOW;
    const g = new THREE.SphereGeometry(0.043, 10, 8);
    g._shared = true; g.userData._shared = true;
    return (ELBOW = g);
  }

  // ------------------------------------------------------------ orientation
  const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _b = new THREE.Matrix4();
  /* Orient a hand so its thumb/index side points along `thumbDir` and the back
     of the hand faces `dorsalHint` (orthogonalised). Right hand: thumb is -X;
     left (mirrored): thumb is +X. */
  function orientGrip(side, thumbDir, dorsalHint, outQ) {
    _x.copy(thumbDir).normalize().multiplyScalar(side < 0 ? 1 : -1);
    _y.copy(dorsalHint).addScaledVector(_x, -dorsalHint.dot(_x)).normalize();
    _z.crossVectors(_x, _y);
    _b.makeBasis(_x, _y, _z);
    return (outQ || new THREE.Quaternion()).setFromRotationMatrix(_b);
  }
  /* Orient a hand from its forearm: `along` = elbow->wrist direction (the
     fingers continue it), roll about that axis (positive turns the thumb UP
     for either hand), bend = wrist extension (+ = back of the hand up). */
  const _ref = new THREE.Vector3(), _t = new THREE.Vector3();
  function orientAlong(side, along, roll, bend, outQ) {
    _z.copy(along).normalize().negate();                   // hand +Z points back up the arm
    _ref.set(0, 1, 0.35);
    _y.copy(_ref).addScaledVector(_z, -_ref.dot(_z));
    if (_y.lengthSq() < 1e-6) _y.set(0, 0, 1).addScaledVector(_z, -_z.z);
    _y.normalize();
    // roll about the long axis (L = -_z); for the right hand +roll turns the thumb up
    const r = (roll || 0) * (side < 0 ? -1 : 1);
    if (r) { _t.crossVectors(_z, _y).negate(); _y.multiplyScalar(Math.cos(r)).addScaledVector(_t, Math.sin(r)).normalize(); }
    _x.crossVectors(_y, _z);
    if (bend) {
      // extension rotates the hand about its lateral (X) axis
      const c = Math.cos(bend), s = Math.sin(bend);
      _t.copy(_z).multiplyScalar(c).addScaledVector(_y, -s);
      _y.multiplyScalar(c).addScaledVector(_z, s);
      _z.copy(_t);
    }
    _b.makeBasis(_x, _y, _z);
    return (outQ || new THREE.Quaternion()).setFromRotationMatrix(_b);
  }

  // ------------------------------------------------------------ objects
  function makeHand(side, pose, material) {
    const m = new THREE.Mesh(handGeometry(side, pose), material);
    m.name = side < 0 ? "fp_hand_l" : "fp_hand_r";
    m.userData.side = side < 0 ? -1 : 1;
    m.userData.pose = pose;
    m.castShadow = false;
    return m;
  }
  function setPose(hand, pose) {
    if (!hand || hand.userData.pose === pose) return;
    hand.userData.pose = pose;
    hand.geometry = handGeometry(hand.userData.side, pose);
  }
  /* Attach a hand closed round a cylinder: `center` (parent space) on the
     cylinder's axis, `axis` = the direction the index/thumb side points along
     it, `dorsal` = which way the back of the hand faces, `scale` = hand size.
     Returns the hand mesh; its origin is the wrist. */
  const _c = new THREE.Vector3();
  function attachGrip(parent, spec, material) {
    const side = spec.side < 0 ? -1 : 1;
    const pose = spec.pose || "grip";
    const h = makeHand(side, pose, material);
    placeGrip(h, spec);
    if (parent) parent.add(h);
    return h;
  }
  function placeGrip(h, spec) {
    const side = h.userData.side, k = spec.scale || 1;
    orientGrip(side, spec.axis, spec.dorsal, h.quaternion);
    gripCentre(spec.pose || h.userData.pose || "grip", _c);
    if (side < 0) _c.x = -_c.x;
    if (spec.offset) _c.add(spec.offset);
    _c.multiplyScalar(k).applyQuaternion(h.quaternion);
    h.position.copy(spec.center).sub(_c);
    h.scale.setScalar(k);
    return h;
  }

  /* An arm: forearm (+ cuff) and upper arm with an elbow ball. `pose()` lays
     it from a wrist to an elbow to a shoulder, in its parent's space. */
  function makeArm(mats) {
    const g = new THREE.Group();
    g.name = "fp_arm";
    const fore = new THREE.Mesh(foreGeo(), mats.fore);
    const cuff = new THREE.Mesh(cuffGeo(), mats.fore);
    const upper = new THREE.Mesh(upperGeo(), mats.upper || mats.fore);
    const elbow = new THREE.Mesh(elbowGeo(), mats.upper || mats.fore);
    [fore, cuff, upper, elbow].forEach(function (m) { m.castShadow = false; g.add(m); });
    cuff.visible = false;
    g.userData.parts = { fore, cuff, upper, elbow };
    return g;
  }
  const _w = new THREE.Vector3(), _e = new THREE.Vector3(), _s = new THREE.Vector3(), _d = new THREE.Vector3();
  const _hq = new THREE.Quaternion(), _fq = new THREE.Quaternion(), _hy = new THREE.Vector3();
  function lookQuat(dirZ, upHint, out) {
    _z.copy(dirZ).normalize();
    _y.copy(upHint).addScaledVector(_z, -upHint.dot(_z));
    if (_y.lengthSq() < 1e-8) _y.set(0, 1, 0).addScaledVector(_z, -_z.y);
    if (_y.lengthSq() < 1e-8) _y.set(1, 0, 0);
    _y.normalize();
    _x.crossVectors(_y, _z);
    _b.makeBasis(_x, _y, _z);
    return out.setFromRotationMatrix(_b);
  }
  /* wrist, elbow, shoulder: Vector3 in the arm's parent space. handQ: the
     hand's orientation there (its +Y = the back of the hand), so the forearm's
     flat face rolls with the wrist. k = thickness scale at the wrist. */
  function poseArm(arm, wrist, elbow, shoulder, handQ, k, sleeved) {
    const P = arm.userData.parts;
    _hy.set(0, 1, 0).applyQuaternion(handQ);
    _d.subVectors(elbow, wrist);
    const lf = _d.length();
    lookQuat(_d, _hy, _fq);
    P.fore.position.copy(wrist);
    P.fore.quaternion.copy(_fq);
    P.fore.scale.set(k, k, lf);
    P.cuff.visible = !!sleeved;
    if (sleeved) { P.cuff.position.copy(wrist); P.cuff.quaternion.copy(_fq); P.cuff.scale.setScalar(k); }
    P.elbow.position.copy(elbow);
    P.elbow.scale.setScalar(k);
    if (shoulder) {
      _d.subVectors(shoulder, elbow);
      const lu = _d.length();
      lookQuat(_d, _hy, _fq);
      P.upper.position.copy(elbow);
      P.upper.quaternion.copy(_fq);
      P.upper.scale.set(k, k, lu);
      P.upper.visible = true;
    } else P.upper.visible = false;
  }

  // ------------------------------------------------------------ GRASP
  /* THE HAND CLOSES ON THE REAL THING. A table pose ("pistol": fixed flexion
     angles) cannot fit fourteen guns: on a 5 cm Glock grip and a 3.7 cm A2
     grip the same angles either bury the fingers in the frame or leave them
     hanging in the air beside it, which is what the owner saw ("the real
     hands, when they hold a gun, look weird"). A grasp is SOLVED against the
     held part instead:

       prism  the part, in the caller's (model) space: a rounded box with its
              long axis `axis`, cross-section half-extents hw (along u) and hh
              (along axis x u), corner radius rc, half-length hl (Infinity =
              endless). A pistol grip, a handguard, a pump, a foregrip and a
              two-hand cup over the firing fist are all this shape.
       n      the side of the part the BACK of the hand faces (the palm lies
              on the surface opposite it, flush).
       heading  where the straight fingers would point (orthogonalised to n).
       at     the point on the axis level with the palm's contact point.
       k      model units per real metre (the hand is built in metres).

     Then, all in real metres:
       · the palm is laid flush on the surface at `at`;
       · every finger closes joint by joint (knuckle, middle, tip) until that
         segment touches the surface: the classic curl-until-contact grasp,
         so a finger wraps a thin grip tight and a fat one loose, and the
         pads end ON the surface (tools/fp-hands-check.mjs holds every tip
         within 1 cm of it);
       · `trigger` (a point) takes the index finger instead: it is splayed
         into the plane of the trigger and its two joints solved so the pad
         of the last segment sits on the trigger face;
       · the thumb bends segment by segment toward the part's axis from an
         aimed start direction until it touches: round the back strap and
         forward along the far flank on a firing grip, forward along the
         near side on a handguard.
     A left hand is solved as the mirror of a right one, so one solver serves
     both. Returns { q, p, pose, contacts } — the hand's rotation/position in
     the caller's space (origin = the wrist) and the solved pose. */
  const _gq = new THREE.Quaternion(), _gqi = new THREE.Quaternion(), _gp = new THREE.Vector3();
  const _gv = new THREE.Vector3(), _gw = new THREE.Vector3();
  const _gX = new THREE.Vector3(), _gY = new THREE.Vector3(), _gZ = new THREE.Vector3(), _gM = new THREE.Matrix4();
  function prismSdf(P, x, y, z) {
    const dx = x - P.o.x, dy = y - P.o.y, dz = z - P.o.z;
    const a = dx * P.u.x + dy * P.u.y + dz * P.u.z;
    const b = dx * P.v.x + dy * P.v.y + dz * P.v.z;
    const c = dx * P.axis.x + dy * P.axis.y + dz * P.axis.z;
    const qx = Math.abs(a) - (P.hw - P.rc), qy = Math.abs(b) - (P.hh - P.rc);
    const qz = P.hl === Infinity ? -1e9 : Math.abs(c) - Math.max(0, P.hl - P.rc);
    const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
    return Math.hypot(ox, oy, oz) + Math.min(Math.max(qx, qy, qz), 0) - P.rc;
  }
  function makePrism(pr) {
    const axis = pr.axis.clone().normalize();
    const u = pr.u.clone().addScaledVector(axis, -pr.u.dot(axis)).normalize();
    const v = new THREE.Vector3().crossVectors(axis, u);
    const hw = pr.hw, hh = pr.hh;
    return { o: pr.o.clone(), axis, u, v, hw, hh, rc: Math.min(pr.rc == null ? Math.min(hw, hh) * 0.35 : pr.rc, hw, hh), hl: pr.hl == null ? Infinity : pr.hl };
  }
  function prismSupport(P, n) {
    const nu = n.dot(P.u), nv = n.dot(P.v);
    return (P.hw - P.rc) * Math.abs(nu) + (P.hh - P.rc) * Math.abs(nv) + P.rc;
  }
  function grasp(spec) {
    const side = spec.side < 0 ? -1 : 1, k = spec.k;
    const P = makePrism(spec.prism);
    // basis: Y = n (back of the hand), Z = -heading, X = Y x Z
    _gY.copy(spec.n).addScaledVector(P.axis, -spec.n.dot(P.axis) * (spec.nFree ? 0 : 1)).normalize();
    _gZ.copy(spec.heading).addScaledVector(_gY, -spec.heading.dot(_gY)).normalize().negate();
    _gX.crossVectors(_gY, _gZ);
    _gM.makeBasis(_gX, _gY, _gZ);
    const q = new THREE.Quaternion().setFromRotationMatrix(_gM);
    _gqi.copy(q).invert();
    // flush: the palm's contact point on the part's surface on the n side
    // (the hand is outside the part, the back of the hand facing n, the palm
    // facing the axis)
    const palm = spec.palm || [0, -PALM.th * 0.5, -0.062];
    const S = new THREE.Vector3().copy(spec.at).addScaledVector(_gY, prismSupport(P, _gY));
    const p = S.clone().sub(_gv.set(side * palm[0], palm[1], palm[2]).multiplyScalar(k).applyQuaternion(q));
    // canonical (right-hand, metres) <-> caller space
    const toM = function (h, out) {
      return (out || _gw).set(side * h[0], h[1], h[2]).multiplyScalar(k).applyQuaternion(q).add(p);
    };
    const toH = function (v) {
      _gv.copy(v).sub(p).applyQuaternion(_gqi).multiplyScalar(1 / k);
      return [side * _gv.x, _gv.y, _gv.z];
    };
    const dirH = function (v) {
      _gv.copy(v).applyQuaternion(_gqi);
      const l = _gv.length() || 1;
      return [side * _gv.x / l, _gv.y / l, _gv.z / l];
    };
    const sdfH = function (h) { const m = toM(h); return prismSdf(P, m.x, m.y, m.z) / k; };
    // clearance of the segment a->b (radii ra->rb) from the surface; < 0 = inside
    const segGap = function (a, b, ra, rb, from) {
      let g = Infinity;
      for (let t = from == null ? 0.25 : from; t <= 1.0001; t += 0.25) {
        const h = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
        g = Math.min(g, sdfH(h) - (ra + (rb - ra) * t));
      }
      return g;
    };
    const CONTACT = 0.0012;                      // a pad pressed within 1.2 mm is ON the surface
    const SOFT_MAX = [1.45, 1.75, 1.15];
    const fingers = [], contacts = { tips: [], trigger: null, thumb: null };
    FINGERS.forEach(function (f, i) {
      const rs = [f.r * 1.04, f.r * 0.95, f.r * 0.86, f.r * 0.78];
      if (i === 0 && spec.trigger) {
        // the index finger to the trigger: splayed into the trigger's plane, the
        // pad of its last segment on the face
        const T = toH(spec.trigger);
        const M = [f.x, 0, f.z];
        const sp = Math.max(-0.45, Math.min(0.45, Math.atan2(T[0] - M[0], -(T[2] - M[2]))));
        const ds = [Math.sin(sp), -Math.cos(sp)];
        const st = (T[0] - M[0]) * ds[0] + (T[2] - M[2]) * ds[1], yt = T[1];
        let best = null;
        for (let a = -0.3; a <= 1.4; a += 0.025) {
          for (let b = 0; b <= 1.75; b += 0.025) {
            const c = b * 0.55;
            let s = 0, y = 0, ang = 0;
            ang += a; s += Math.cos(ang) * f.seg[0]; y -= Math.sin(ang) * f.seg[0];
            ang += b; s += Math.cos(ang) * f.seg[1]; y -= Math.sin(ang) * f.seg[1];
            ang += c;
            const ms = s + Math.cos(ang) * f.seg[2] * 0.55, my = y - Math.sin(ang) * f.seg[2] * 0.55;
            const r = rs[2] * 0.95;
            const ps = ms - Math.sin(ang) * r, py = my - Math.cos(ang) * r;      // the pad, palm side
            const err = (ps - st) * (ps - st) + (py - yt) * (py - yt) + 0.00002 * (a * a + b * b);
            if (!best || err < best.err) best = { err: err, flex: [a, b, c] };
          }
        }
        const pts = fingerChain(f, best.flex, sp);
        fingers.push(pts);
        contacts.trigger = Math.sqrt(best.err);
        contacts.tips.push(null);
        return;
      }
      const flex = [0.04, 0.05, 0.04];
      const sp = spec.splay ? spec.splay[i] : null;
      for (let j = 0; j < 3; j++) {
        // a segment that STARTS inside (the one before it closed so far that
        // this one points into the part) opens back out until it is clear
        {
          const pts = fingerChain(f, flex, sp);
          if (segGap(pts[j], pts[j + 1], rs[j], rs[j + 1]) < 0) {
            let a = flex[j];
            for (; a > -0.35; a -= 0.02) {
              flex[j] = a;
              const q = fingerChain(f, flex, sp);
              if (segGap(q[j], q[j + 1], rs[j], rs[j + 1]) >= 0) break;
            }
            continue;
          }
        }
        let a = flex[j], hit = false;
        for (; a <= JOINT_MAX[j] + 1e-6; a += 0.02) {
          flex[j] = a;
          const pts = fingerChain(f, flex, sp);
          // the middle joint also stops when the tip segment would dig in
          // (else a finger that never touched with its middle segment hooks
          // round and drives its tip into the part)
          let gap = segGap(pts[j], pts[j + 1], rs[j], rs[j + 1]);
          if (j === 1) gap = Math.min(gap, segGap(pts[2], pts[3], rs[2], rs[3]));
          if (gap < CONTACT) { hit = true; break; }
        }
        flex[j] = hit ? Math.max(0, a - 0.02) : Math.min(a, SOFT_MAX[j]);
        if (hit && j === 0) {
          // the proximal segment is ON the part: bisect onto the surface
          let lo = flex[0], hi = flex[0] + 0.02;
          for (let it = 0; it < 6; it++) {
            const mid = (lo + hi) / 2; flex[0] = mid;
            const pts = fingerChain(f, flex, spec.splay ? spec.splay[i] : null);
            if (segGap(pts[0], pts[1], rs[0], rs[1]) < CONTACT) hi = mid; else lo = mid;
          }
          flex[0] = lo;
        }
      }
      const pts = fingerChain(f, flex, spec.splay ? spec.splay[i] : null);
      fingers.push(pts);
      contacts.tips.push(sdfH(pts[3]) - rs[3]);
    });
    // THE THUMB: segment by segment toward the axis from an aimed start
    const th = [THUMB.base.slice()];
    const d0 = spec.thumbAim ? dirH(spec.thumbAim) : [-0.3, -0.7, -0.6];
    let d = d0.slice();
    const axH = dirH(P.axis), oH = toH(P.o);
    for (let s = 0; s < 3; s++) {
      // past the first joint the thumb may take a second aim (forward along a
      // frame, not on round the grip) and settles onto the surface from there
      if (s === 1 && spec.thumbAim2) d = dirH(spec.thumbAim2);
      const a0 = th[s], L = THUMB.seg[s];
      const r0 = THUMB.r[s] * (s === 0 ? 1.1 : 1), r1 = s < 2 ? THUMB.r[s + 1] : THUMB.r[2] * 0.85;
      // closest axis point to the segment start -> the bending axis
      const w = [a0[0] - oH[0], a0[1] - oH[1], a0[2] - oH[2]];
      const t = w[0] * axH[0] + w[1] * axH[1] + w[2] * axH[2];
      const to = [oH[0] + axH[0] * t - a0[0], oH[1] + axH[1] * t - a0[1], oH[2] + axH[2] * t - a0[2]];
      let ra = [d[1] * to[2] - d[2] * to[1], d[2] * to[0] - d[0] * to[2], d[0] * to[1] - d[1] * to[0]];
      const rl = Math.hypot(ra[0], ra[1], ra[2]);
      const rot = function (th) {
        if (rl < 1e-9) return d.slice();
        const kx = ra[0] / rl, ky = ra[1] / rl, kz = ra[2] / rl, c = Math.cos(th), sn = Math.sin(th);
        const dot = kx * d[0] + ky * d[1] + kz * d[2];
        return [
          d[0] * c + (ky * d[2] - kz * d[1]) * sn + kx * dot * (1 - c),
          d[1] * c + (kz * d[0] - kx * d[2]) * sn + ky * dot * (1 - c),
          d[2] * c + (kx * d[1] - ky * d[0]) * sn + kz * dot * (1 - c),
        ];
      };
      const end = function (dd) { return [a0[0] + dd[0] * L, a0[1] + dd[1] * L, a0[2] + dd[2] * L]; };
      let ang = 0, dd = rot(0);
      // already in the part (a thumb aimed into it): swing out first
      if (segGap(a0, end(dd), r0, r1, s === 0 ? 0.5 : 0.25) < 0) {
        for (ang = 0; ang > -1.6; ang -= 0.03) { dd = rot(ang); if (segGap(a0, end(dd), r0, r1, s === 0 ? 0.5 : 0.25) >= CONTACT) break; }
      } else {
        const cap = spec.thumbBend ? spec.thumbBend[s] : [0.9, 1.1, 0.9][s];
        for (ang = 0; ang <= cap; ang += 0.02) {
          const nd = rot(ang);
          if (segGap(a0, end(nd), r0, r1, s === 0 ? 0.5 : 0.25) < CONTACT) break;
          dd = nd;
        }
      }
      d = dd;
      th.push(end(dd));
    }
    contacts.thumb = sdfH(th[3]) - THUMB.r[2] * 0.85;
    const pose = { name: "g:" + (spec.name || Math.random().toString(36).slice(2)), cup: spec.cup || 0.006, joints: { fingers: fingers, thumb: th } };
    // where the forearm WANTS to go (a straight wrist), caller space
    const fore = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    return { q: q, p: p, pose: pose, contacts: contacts, prism: P, k: k, side: side, fore: fore, toM: toM };
  }
  /* A hand placed by a grasp: mesh at its wrist, pose attached. */
  function graspHand(parent, spec, material) {
    const G = grasp(spec);
    const h = makeHand(G.side, G.pose, material);
    h.quaternion.copy(G.q);
    h.position.copy(G.p);
    h.scale.setScalar(G.k);
    h.userData.grasp = G;
    if (parent) parent.add(h);
    return h;
  }

  /* THE WRIST HAS LIMITS. The shoulder IK puts the elbow where the arm can
     reach; a real wrist then only bends so far off the line of the forearm.
     Pull the forearm direction (wrist -> elbow) to within `maxDev` radians of
     `want` (the grasp's straight-wrist line, or a held part's natural carry),
     keeping its length. Pure maths on arrays. */
  function clampFore(W, E, want, maxDev, L2) {
    let dx = E[0] - W[0], dy = E[1] - W[1], dz = E[2] - W[2];
    const dl = Math.hypot(dx, dy, dz) || 1;
    dx /= dl; dy /= dl; dz /= dl;
    const wl = Math.hypot(want[0], want[1], want[2]) || 1;
    const wx = want[0] / wl, wy = want[1] / wl, wz = want[2] / wl;
    const cos = Math.max(-1, Math.min(1, dx * wx + dy * wy + dz * wz));
    const ang = Math.acos(cos);
    if (ang <= maxDev) return [W[0] + dx * L2, W[1] + dy * L2, W[2] + dz * L2];
    // slerp from want toward the solved direction by maxDev
    let px = dx - wx * cos, py = dy - wy * cos, pz = dz - wz * cos;
    const pl = Math.hypot(px, py, pz);
    if (pl < 1e-6) { px = 0; py = -1; pz = 0; } else { px /= pl; py /= pl; pz /= pl; }
    const c = Math.cos(maxDev), s = Math.sin(maxDev);
    return [W[0] + (wx * c + px * s) * L2, W[1] + (wy * c + py * s) * L2, W[2] + (wz * c + pz * s) * L2];
  }

  // ------------------------------------------------------------ dress
  function readHex(list) {
    if (!list) return null;
    const a = Array.isArray(list) ? list : [list];
    for (let i = 0; i < a.length; i++) {
      const o = a[i];
      const m = o && (o.material || o);
      const mm = Array.isArray(m) ? m[0] : m;
      if (mm && mm.color && !mm.map) return mm.color.getHex();
    }
    return null;
  }
  /* What the arms are wearing, off the live body: hand (skin or glove),
     forearm (bare skin for a tee), upper arm (the shirt). Heritage reaches
     here through the rig — heritage.js paints the rig's skin, and skinTone is
     the tone it was built with. */
  function dressOf(ch, fallback) {
    ch = ch === undefined ? CBZ.playerChar : ch;
    fallback = fallback || {};
    const s = (ch && ch.skinSlots) || null;
    const arm = (CBZ.cityArmColors && CBZ.cityArmColors(ch)) || null;
    const skin = (ch && ch.skinTone != null) ? ch.skinTone : (arm && arm.skin != null ? arm.skin : (fallback.skin != null ? fallback.skin : 0xd6a57e));
    const hand = (arm && arm.skin != null) ? arm.skin : (readHex(s && s.hands) != null ? readHex(s && s.hands) : skin);
    let fore = arm && arm.sleeve != null ? arm.sleeve : readHex(s && s.armsLower);
    if (fore == null) fore = fallback.sleeve != null ? fallback.sleeve : skin;
    let upper = readHex(s && s.arms);
    if (upper == null) upper = fore;
    const near = function (a, b) {
      const dr = ((a >> 16) & 255) - ((b >> 16) & 255), dg = ((a >> 8) & 255) - ((b >> 8) & 255), db = (a & 255) - (b & 255);
      return dr * dr + dg * dg + db * db < 300;
    };
    return { hand: hand | 0, fore: fore | 0, upper: upper | 0, skin: skin | 0, sleeved: !near(fore, skin) && !near(fore, hand), gloved: !near(hand, skin) };
  }

  CBZ.fpHands = {
    version: 2,
    POSES, PALM, FINGERS, THUMB,
    handGeometry, makeHand, setPose, attachGrip, placeGrip, gripCentre,
    orientGrip, orientAlong, makeArm, poseArm, dressOf, resolvePose,
    grasp, graspHand, prismSdf,
    math: { solveElbow, flexForWrap, fingerChain, segDist, clampFore },
  };
})();
