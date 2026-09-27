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
  function fingerChain(f, flex) {
    const curl = Math.min(1, flex[0] / 1.5);
    const sp = f.splay * (1 - 0.6 * curl);                  // fingers gather as they close
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
  const T_ALONG = [[-0.30, -0.72, -0.62], [-0.10, -0.30, -0.95], [-0.05, -0.16, -0.99]];
  const T_PINCH = [[-0.48, -0.55, -0.68], [-0.10, -0.62, -0.78], [0.10, -0.55, -0.83]];
  const POSES = {
    open:    { flex: [[0.08, 0.10, 0.06], [0.06, 0.08, 0.05], [0.08, 0.10, 0.06], [0.12, 0.12, 0.08]], thumb: T_OPEN, cup: 0.001 },
    relaxed: { flex: [[0.30, 0.42, 0.22], [0.36, 0.50, 0.26], [0.44, 0.58, 0.30], [0.52, 0.66, 0.34]], thumb: T_REST, cup: 0.004 },
    fist:    { flex: [[1.48, 1.80, 0.95], [1.52, 1.84, 0.95], [1.52, 1.84, 0.95], [1.50, 1.80, 0.95]], thumb: T_FIST, cup: 0.006 },
    // pistol: three fingers round a flat-sided grip, the index on the trigger,
    // the thumb high along the far flank
    pistol:  { flex: [[0.62, 0.62, 0.30], [0.50, 1.40, 0.90], [0.52, 1.42, 0.90], [0.55, 1.45, 0.92]], thumb: T_ALONG, cup: 0.005 },
    // the hand cupped under a handguard: fingers up the far side, thumb along it
    support: { wrap: 0.030, thumb: T_ALONG, cup: 0.006 },
    // the off hand wrapped over the firing fist on a two-hand pistol hold
    cupover: { wrap: 0.040, thumb: T_ALONG, cup: 0.006 },
    wheel:   { wrap: 0.016, thumb: T_WRAP, cup: 0.005 },
    grip:    { wrap: 0.019, thumb: T_FIST, cup: 0.006 },          // a knife / bar / riser
    card:    { flex: [[0.55, 0.55, 0.20], [0.70, 0.95, 0.45], [0.85, 1.10, 0.55], [0.95, 1.20, 0.60]], thumb: T_PINCH, cup: 0.004 },
  };
  function resolvePose(p) {
    const pose = typeof p === "string" ? (POSES[p] || POSES.relaxed) : (p || POSES.relaxed);
    if (pose._flex) return pose;
    const flex = FINGERS.map(function (f, i) {
      if (pose.flex && pose.flex[i]) return pose.flex[i];
      return flexForWrap(pose.wrap, f);
    });
    pose._flex = flex;
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
    const g = new THREE.SphereGeometry(r, 8, 6);
    if (sx) g.scale(sx, sy, sz);
    g.translate(p[0], p[1], p[2]);
    parts.push(g);
  }
  function palmGeo(cup) {
    const g = new THREE.BoxGeometry(PALM.hw * 2, PALM.th, PALM.len, 5, 2, 6);
    const pos = g.attributes.position, rr = 0.011;
    const hx = PALM.hw, hy = PALM.th / 2, hz = PALM.len / 2;
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      // round every edge (a rounded box, not a brick)
      const cx = Math.max(-hx + rr, Math.min(hx - rr, x));
      const cy = Math.max(-hy + rr * 0.9, Math.min(hy - rr * 0.9, y));
      const cz = Math.max(-hz + rr, Math.min(hz - rr, z));
      let ox = x - cx, oy = y - cy, oz = z - cz;
      const ol = Math.hypot(ox, oy, oz);
      if (ol > 1e-9) { const k = rr / ol; ox *= k; oy *= k; oz *= k; }
      x = cx + ox; y = cy + oy; z = cz + oz;
      if (Math.abs(y) > hy) y = Math.sign(y) * hy;
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
    const wr = new THREE.CylinderGeometry(0.027, 0.029, 0.06, 10, 1, true);
    wr.scale(1.18, 1, 0.78);
    place(wr, [0, 0, 0.034], [0, 0.001, -0.022], parts);
    FINGERS.forEach(function (f, i) {
      const pts = fingerChain(f, p._flex[i]);
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
    let tp = THUMB.base.slice();
    const tpts = [tp];
    for (let s = 0; s < 3; s++) {
      const d = p.thumb[s], dl = Math.hypot(d[0], d[1], d[2]) || 1, L = THUMB.seg[s];
      tp = [tp[0] + d[0] / dl * L, tp[1] + d[1] / dl * L, tp[2] + d[2] / dl * L];
      tpts.push(tp);
    }
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
    version: 1,
    POSES, PALM, FINGERS, THUMB,
    handGeometry, makeHand, setPose, attachGrip, placeGrip, gripCentre,
    orientGrip, orientAlong, makeArm, poseArm, dressOf, resolvePose,
    math: { solveElbow, flexForWrap, fingerChain, segDist },
  };
})();
