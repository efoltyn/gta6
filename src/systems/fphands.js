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
  const T_ALONG = [[-0.30, -0.72, -0.62], [-0.10, -0.30, -0.95], [-0.05, -0.16, -0.99]];
  const T_PINCH = [[-0.48, -0.55, -0.68], [-0.10, -0.62, -0.78], [0.10, -0.55, -0.83]];
  const POSES = {
    open:    { flex: [[0.08, 0.10, 0.06], [0.06, 0.08, 0.05], [0.08, 0.10, 0.06], [0.12, 0.12, 0.08]], thumb: T_OPEN, cup: 0.001, stub: 0 },
    relaxed: { flex: [[0.30, 0.42, 0.22], [0.36, 0.50, 0.26], [0.44, 0.58, 0.30], [0.52, 0.66, 0.34]], thumb: T_REST, cup: 0.004, stub: 0 },
    fist:    { flex: [[1.48, 1.80, 0.95], [1.52, 1.84, 0.95], [1.52, 1.84, 0.95], [1.50, 1.80, 0.95]], thumb: T_FIST, cup: 0.006, stub: 0 },
    // BODY gun poses (character.js setHandPose "pistol" / "support" on
    // third-person rigs). The first-person gun hands take no table pose:
    // every one is a GRASP solved against the gun's own grip — see grasp().
    pistol:  { flex: [[0.62, 0.62, 0.30], [0.50, 1.40, 0.90], [0.52, 1.42, 0.90], [0.55, 1.45, 0.92]], thumb: T_ALONG, cup: 0.005 },
    support: { wrap: 0.030, thumb: T_ALONG, cup: 0.006 },
    cupover: { wrap: 0.040, thumb: T_ALONG, cup: 0.006 },
    wheel:   { wrap: 0.016, thumb: T_WRAP, cup: 0.005 },
    grip:    { wrap: 0.019, thumb: T_FIST, cup: 0.006 },          // a knife / bar / riser
    card:    { flex: [[0.55, 0.55, 0.20], [0.70, 0.95, 0.45], [0.85, 1.10, 0.55], [0.95, 1.20, 0.60]], thumb: T_PINCH, cup: 0.004, stub: 0 },
    /* A PALM PLANTED ON A SURFACE (a vault, a mantle, a hand on a door): the
       fingers lie flat and spread with just enough flexion that their pads
       and the heel of the palm meet ONE plane (PLANT_Y below the palm's
       centre), the thumb out to the side for the base of support. The
       character's charArmTo.plant lays this hand on the real contact point;
       stub 0 like a gun hold: the hand bends at the crease, it does not slide. */
    plant:   { flex: [[0.10, 0.12, 0.08], [0.09, 0.11, 0.07], [0.10, 0.12, 0.08], [0.12, 0.14, 0.09]], splay: 1.6,
               thumb: [[-0.85, 0.00, -0.52], [-0.72, 0.03, -0.69], [-0.58, 0.03, -0.81]], cup: 0.0015, stub: 0 },
    /* ONE FINGER ON A BUTTON (a lift call, a floor button, a keypad): the
       index straight out, the other three closed into the palm and the thumb
       laid over them. CBZ.verbs.touch puts the index PAD (contactOf "point")
       on the button with the finger pressing along the button's normal. */
    point:   { flex: [[0.06, 0.10, 0.06], [1.52, 1.84, 0.95], [1.52, 1.84, 0.95], [1.50, 1.80, 0.95]], thumb: T_FIST, cup: 0.005, stub: 0, lone: 0 },
  };
  // the plane a planted palm rests on: under the heel and the finger pads
  // (hand metres, right-hand frame: y below the palm centre, z = the palm's middle)
  const PLANT_CONTACT = [0, -0.0224, -0.050];
  // the thumb-to-index pinch a card / a note / cash sits in (card pose)
  const CARD_PINCH = [-0.030, -0.022, -0.100];
  /* BODY GUN HOLDS, SIZED TO WHAT IS HELD (systems/gunhands.js CBZ.gunHold).
     A body hand closes round a gun drawn at 1.45-1.75x real size (weapon-
     scale.js READ) with a hand drawn at 1.1x, so the part it wraps is, in the
     hand's own metres, anything from a 2.2 cm AK grip to a 6 cm two-hand cup
     over a Desert Eagle — one fixed "pistol" curl either buries the fingers
     or leaves them in the air. So the body holds come in a small family of
     wrap radii (6 mm apart, the nearest is never more than 3 mm off) and the
     hold picks the nearest: `trigNN` = the firing hand (index laid along the
     frame to the trigger, the other three wrapped), `holdNN` = a support hand
     (all four wrapped, thumb forward). Each is an ordinary POSES entry, so
     every body with the same hold shares one cached geometry per LOD and
     pedinstance pools them by identity. */
  const HOLD_RADII = [0.022, 0.028, 0.034, 0.040, 0.046, 0.052, 0.058];
  HOLD_RADII.forEach(function (R) {
    const n = Math.round(R * 1000);
    POSES["trig" + n] = { wrap: R, flex: [[0.62, 0.62, 0.30]], thumb: T_ALONG, cup: 0.005, stub: 0 };
    POSES["hold" + n] = { wrap: R, thumb: T_ALONG, cup: 0.006, stub: 0 };
  });
  // the hold pose of `kind` ("trig" | "hold") whose wrap radius is nearest R (hand metres)
  function holdPose(kind, R) {
    let best = HOLD_RADII[0];
    for (let i = 1; i < HOLD_RADII.length; i++) if (Math.abs(HOLD_RADII[i] - R) < Math.abs(best - R)) best = HOLD_RADII[i];
    return (kind === "trig" ? "trig" : "hold") + Math.round(best * 1000);
  }
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
    const spk = pose.splay || 1;
    pose._joints = { fingers: FINGERS.map(function (f, i) { return fingerChain(f, flex[i], spk !== 1 ? f.splay * spk : null); }), thumb: thumbChain(pose.thumb) };
    return pose;
  }
  // centre of the cylinder a wrap pose closes round, hand frame (right hand)
  function gripCentre(p, out) {
    const pose = resolvePose(p);
    const R = pose.wrap || 0.02;
    return (out || new THREE.Vector3()).set(-0.006, -(PALM.th * 0.5 + R), FINGERS[1].z + 0.012);
  }
  /* WHERE A POSED HAND TOUCHES THE WORLD (hand frame, right hand, metres at
     size 1; mirror x for the left). One table for every contact the body
     makes (character.js charArmTo.plant lays this point on the surface):
       plant  the palm's contact plane (heel + finger pads)
       point  the index finger's pad, at the very tip of the straight finger
       card   the pinch a card is held in
       a wrap pose (grip, wheel, support...)  the axis of what it closes round */
  let _pointTip = null;
  function contactOf(p, out) {
    out = out || new THREE.Vector3();
    if (p === "plant" || p == null) return out.set(PLANT_CONTACT[0], PLANT_CONTACT[1], PLANT_CONTACT[2]);
    if (p === "card") return out.set(CARD_PINCH[0], CARD_PINCH[1], CARD_PINCH[2]);
    if (p === "point") {
      if (!_pointTip) {
        const f = FINGERS[0], ch = resolvePose("point")._joints.fingers[0];
        const a = ch[2], b = ch[3];
        const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz) || 1;
        // the pad: the tip joint carried on by the finger's own radius
        _pointTip = [b[0] + dx / L * f.r, b[1] + dy / L * f.r, b[2] + dz / L * f.r];
      }
      return out.set(_pointTip[0], _pointTip[1], _pointTip[2]);
    }
    const pose = typeof p === "string" ? POSES[p] : p;
    if (pose && pose.wrap) return gripCentre(p, out);
    return out.set(PLANT_CONTACT[0], PLANT_CONTACT[1], PLANT_CONTACT[2]);
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
  function seg(parts, a, b, r0, r1, ink) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const g = new THREE.CylinderGeometry(r1, r0, L, 8, 1, true);
    if (ink) {
      // a FINGER SEGMENT on the skin chart (entities/tattoo.js hand chart):
      // turned half a turn about its axis so the cylinder's u seam runs down
      // the palm side and the back of the finger sits at u 0.5; u then grows
      // toward +x on the back of a right hand (a letter reads true), and v
      // runs knuckle -> tip across the finger's three segments
      g.rotateY(Math.PI);
      inkUV(g, function (u, v) { return fingerUV(ink.col, u, (ink.s + v) / 3); });
    }
    place(g, a, b, parts);
  }
  /* ---- THE SKIN CHART (entities/tattoo.js HAND layout) --------------------
     Finger columns of 1/8 width (index, middle, ring, little, thumb): u
     across one column is once round the finger with the back at its centre;
     v from the knuckle (bottom of the 3/4-high finger block) to the tip.
     The back of the hand is a planar patch in u [.625, 1]; everything else
     (palm side, stub, joints, web) reads one blank texel. Parts carry these
     as `inkuv`; mergeParts turns them into the hand's `uv`. */
  const INK_COL = 0.125, INK_FH = 0.75, INK_PALM = 0.625, INK_BLANK = [0.30, 0.05];
  function fingerUV(col, u, a) {
    return [(col + u) * INK_COL, 1 - INK_FH * (1 - Math.min(1, Math.max(0, a)))];
  }
  function inkUV(g, fn) {
    const uv = g.attributes.uv, out = new Float32Array(uv.count * 2);
    for (let i = 0; i < uv.count; i++) { const q = fn(uv.getX(i), uv.getY(i)); out[i * 2] = q[0]; out[i * 2 + 1] = q[1]; }
    g.setAttribute("inkuv", new THREE.BufferAttribute(out, 2));
    return g;
  }
  /* A CLOSED lathe along the hand's Z: rings [z, rx, ry, cy] from the bottom
     up, each an ellipse (rx across X, ry across Y, centred at y = cy); a ring
     with rx = 0 is an apex (one vertex), so a table that starts and ends on
     an apex is a closed solid with no open end to look into. Outward winding,
     smooth shared normals. The wrist stubs (first-person and body hands) and
     nothing else. */
  function lathe(parts, rings, sides, phase) {
    const P = [], idx = [], start = [];
    for (let i = 0; i < rings.length; i++) {
      const r = rings[i];
      start.push(P.length / 3);
      if (!(r[1] > 0)) { P.push(0, r[3] || 0, r[0]); continue; }
      for (let s = 0; s < sides; s++) {
        const a = (phase || 0) + s / sides * Math.PI * 2;
        P.push(r[1] * Math.cos(a), (r[3] || 0) + r[2] * Math.sin(a), r[0]);
      }
    }
    const at = function (i, s) { return rings[i][1] > 0 ? start[i] + (s % sides) : start[i]; };
    for (let i = 0; i < rings.length - 1; i++) {
      const apA = !(rings[i][1] > 0), apB = !(rings[i + 1][1] > 0);
      for (let s = 0; s < sides; s++) {
        const a0 = at(i, s), a1 = at(i, s + 1), b0 = at(i + 1, s), b1 = at(i + 1, s + 1);
        if (!apA) idx.push(a0, a1, b1);
        if (!apB) idx.push(a0, b1, b0);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    parts.push(g);
    return g;
  }
  /* THE WRIST STUB (hand frame, metres): the hand's own skin from the heel of
     the palm up into the forearm. Its top is a dome CENTRED ON THE WRIST
     PIVOT (the hand's origin), about as tall as it is thick, so bending the
     wrist turns the dome about its own centre instead of swinging a tube out
     through the side of the forearm; its bottom tapers into the heel of the
     palm. At the pivot it is a real wrist: 6 cm across the palm plane, 4 cm
     through (a little thicker than the 2.8 cm palm, a little narrower than
     its 6.7 cm heel). `back` > the dome = a long stub (a body hand that
     slides down its wrist onto a held socket keeps its wrist in the sleeve). */
  /* The dome is round in the thickness plane (height = thickness, so a
     flex/extend bend turns it on the spot) and draws its width in fast (the
     6 cm only matters AT the crease, where the heel of the palm meets the
     forearm): a radial/ulnar bend, or a gun hold that rolls the hand on the
     forearm, then keeps it inside the forearm's end too. Rows [height share,
     width share, thickness share]. */
  const WRIST = { hw: 0.029, ht: 0.0200, cy: 0.0005, dome: 0.0205, heel: 0.034 };
  const DOME_FINE = [[0.35, 0.80, 0.937], [0.65, 0.58, 0.76], [0.88, 0.34, 0.475]];
  const DOME_BODY = [[0.50, 0.70, 0.866]];
  // [sides, phase]: the body's hexagon stands a vertex on the thickness axis
  // (its flats go to the width, which the palm's heel covers)
  const STUB_LATHE = { fp: [12, 0], body: [6, 0] };
  function stubRings(back, fine) {
    const W = WRIST, cy = W.cy;
    const r = fine
      ? [[-W.heel, 0, 0, cy], [-0.025, W.hw * 0.72, W.ht * 0.70, cy], [-0.013, W.hw * 0.93, W.ht * 0.93, cy], [0, W.hw, W.ht, cy]]
      : [[-W.heel * 0.85, 0, 0, cy], [-0.005, W.hw * 1.20, W.ht * 1.20, cy], [0, W.hw, W.ht, cy]];
    if (back > W.dome) {
      // a long stub: straight on up inside the forearm, then shut
      r.push([back, W.hw * 1.15, W.ht * 1.15, cy], [back + 0.010, 0, 0, cy]);
    } else {
      (fine ? DOME_FINE : DOME_BODY).forEach(function (d) { r.push([W.dome * d[0], W.hw * d[1], W.ht * d[2], cy]); });
      r.push([W.dome, 0, 0, cy]);
    }
    return r;
  }
  function ball(parts, p, r, sx, sy, sz) {
    const g = new THREE.SphereGeometry(r, sx ? 12 : 8, sx ? 8 : 6);
    if (sx) g.scale(sx, sy, sz);
    g.translate(p[0], p[1], p[2]);
    parts.push(g);
  }
  /* THE PALM: a SUPERELLIPSOID, not a box. The palm used to be a BoxGeometry
     pushed into a rounded box: a box keeps separate vertices per face, so
     every rounded edge became a seam with its own normals and up close (the
     first-person lens IS up close) the heel and the web read as sharp folded
     flaps. One closed, smooth surface instead, squared off by the exponent,
     then shaped. `segs` = [around, down] sphere segments: the first-person
     hand's default 18x12 (432 tris), the body LODs far fewer (character.js
     bodies: 6x4 near, 4x3 far, which with a quarter-turn start is a rounded
     box of 16 triangles). */
  function palmGeo(cup, segs) {
    segs = segs || [18, 12];
    const g = new THREE.SphereGeometry(1, segs[0], segs[1], segs[0] <= 4 ? Math.PI / 4 : 0);
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
    // the BACK OF THE HAND on the skin chart: per triangle (the palm goes
    // non-indexed here, which mergeParts would do anyway), a triangle on the
    // back takes a planar projection (thumb side -> little-finger side,
    // knuckles -> wrist), every other triangle the blank texel — so nothing
    // on the back can smear round the edge onto the palm
    const f = g.toNonIndexed();
    g.dispose();
    const p = f.attributes.position, uv = new Float32Array(p.count * 2);
    for (let t = 0; t < p.count; t += 3) {
      const cy = (p.getY(t) + p.getY(t + 1) + p.getY(t + 2)) / 3;
      for (let k = 0; k < 3; k++) {
        const i = t + k;
        if (cy > hy * 0.25) {
          uv[i * 2] = INK_PALM + (1 - INK_PALM) * (p.getX(i) + hx) / (2 * hx);
          uv[i * 2 + 1] = Math.min(1, Math.max(0, -p.getZ(i) / PALM.len));
        } else { uv[i * 2] = INK_BLANK[0]; uv[i * 2 + 1] = INK_BLANK[1]; }
      }
    }
    f.setAttribute("inkuv", new THREE.BufferAttribute(uv, 2));
    return f;
  }
  function mergeParts(parts) {
    let n = 0;
    const flat = parts.map(function (g) {
      const f = g.index ? g.toNonIndexed() : g;
      if (!f.attributes.normal) f.computeVertexNormals();
      n += f.attributes.position.count;
      return f;
    });
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2);
    let o = 0;
    flat.forEach(function (f) {
      P.set(f.attributes.position.array, o * 3);
      N.set(f.attributes.normal.array, o * 3);
      const iu = f.attributes.inkuv;
      if (iu) U.set(iu.array, o * 2);
      else for (let i = 0; i < f.attributes.position.count; i++) { U[(o + i) * 2] = INK_BLANK[0]; U[(o + i) * 2 + 1] = INK_BLANK[1]; }
      o += f.attributes.position.count;
      f.dispose();
    });
    parts.forEach(function (g) { g.dispose(); });
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(P, 3));
    out.setAttribute("normal", new THREE.BufferAttribute(N, 3));
    out.setAttribute("uv", new THREE.BufferAttribute(U, 2));
    return out;
  }
  function mirrorX(geo) {
    // a TRUE mirror: flip X on positions and normals, then swap each
    // triangle's winding so the faces still point out (a negative scale.x on
    // the mesh would render the hand inside-out).
    const P = geo.attributes.position.array, N = geo.attributes.normal.array;
    const U = geo.attributes.uv ? geo.attributes.uv.array : null;
    for (let i = 0; i < P.length; i += 3) { P[i] = -P[i]; N[i] = -N[i]; }
    for (let t = 0; t < P.length; t += 9) {
      for (let k = 0; k < 3; k++) {
        let tmp = P[t + 3 + k]; P[t + 3 + k] = P[t + 6 + k]; P[t + 6 + k] = tmp;
        tmp = N[t + 3 + k]; N[t + 3 + k] = N[t + 6 + k]; N[t + 6 + k] = tmp;
      }
    }
    if (U) {
      // the skin chart mirrors with the hand, or every letter on a left hand
      // would read backwards: each triangle reflects its u about the centre
      // of the column (finger) or patch (back of the hand) it lies in
      for (let t = 0; t < U.length; t += 6) {
        let tmp = U[t + 2]; U[t + 2] = U[t + 4]; U[t + 4] = tmp;          // same winding swap as P/N
        tmp = U[t + 3]; U[t + 3] = U[t + 5]; U[t + 5] = tmp;
        const cu = (U[t] + U[t + 2] + U[t + 4]) / 3;
        if (Math.abs(cu - INK_BLANK[0]) < 1e-6 && Math.abs(U[t + 1] - INK_BLANK[1]) < 1e-6) continue;
        const axis = cu >= INK_PALM ? (INK_PALM + 1) / 2 : (Math.floor(cu / INK_COL) + 0.5) * INK_COL;
        U[t] = 2 * axis - U[t]; U[t + 2] = 2 * axis - U[t + 2]; U[t + 4] = 2 * axis - U[t + 4];
      }
    }
    return geo;
  }
  /* THE FIRST-PERSON HAND IS THE BODY'S HAND, FINER. It was built as
     separate capsules — a cylinder per phalanx with a ball at every joint
     and a proud ball per knuckle — which down the lens read as a stack of
     bones: every phalanx its own white sausage, a rib of balls across the
     knuckles (owner: "too many fingers and white af hands"). Now it is the
     body hand's construction (buildBodyHandGeo, the third-person hand) at
     lod 0: each finger ONE continuous tapered tube from inside the palm to a
     rounded pad, ten-sided, with a ring at every joint a touch fuller than
     the bone either side (the knuckle bulges a real finger has) and the
     palm's smooth mass it grows out of; the thumb the same, rooted in the
     thenar web. One recipe for both views. */
  function buildHandGeo(side, pose) {
    return buildBodyHandGeo(side < 0 ? -1 : 1, pose, 0);
  }
  const GEO = {};
  /* A grasp's pose carries its own solved joints and used to be keyed by a
     RANDOM name ("g:" + Math.random()), so every grasp built and cached its own
     ~90 KB hand forever: 126 identical steering-wheel hands (one pair per car
     cabin) held 11 MB at the phone boot and kept growing. A pose with joints
     is keyed by its content instead (joints to 10 microns + cup), so the same
     grasp shares one geometry and two different grasps never collide. */
  function jointsKey(pose) {
    let h = 2166136261 >>> 0;
    const J = pose.joints, mix = function (v) { h = Math.imul(h ^ (Math.round(v * 1e5) | 0), 16777619) >>> 0; };
    const chains = J.fingers.concat([J.thumb]);
    for (let c = 0; c < chains.length; c++) { const ch = chains[c]; mix(ch.length); for (let i = 0; i < ch.length; i++) { const p = ch[i]; mix(p[0]); mix(p[1]); mix(p[2]); } }
    mix(pose.cup || 0);
    return "j" + h.toString(36) + ":" + chains.length;
  }
  function poseKey(pose) {
    if (typeof pose === "string") return pose;
    if (pose.joints) return pose._key || (pose._key = jointsKey(pose));
    return "w" + Math.round((pose.wrap || 0) * 1000) + ":" + (pose.name || "custom");
  }
  function handGeometry(side, pose) {
    const key = (side < 0 ? "L:" : "R:") + poseKey(pose);
    return GEO[key] || (GEO[key] = buildHandGeo(side < 0 ? -1 : 1, pose));
  }

  /* ---- THE SAME HAND ON EVERY BODY (third person) -----------------------
     Owner: "The FP hands are really real, but on the third-person models
     those hands are way different." Every body wore a skin-coloured BOX where
     its hand should be. These are the SAME hand — PALM / FINGERS / THUMB, the
     same pose table, the same fingerChain / flexForWrap curl — with fewer
     triangles, so a man across the street holds his pistol with the hand you
     see down your own lens.
       lod 1 (BODY, ~190 tris): the rounded, tapered, cupped palm on a coarse
         grid; each finger and the thumb ONE continuous 4-sided tube through
         its real joint chain (mitred at the knuckles, so a curl never opens a
         gap) with a pointed pad; a 6-sided wrist.
       lod 2 (FAR, ~50 tris): the palm box; the four fingers merged into one
         mitten through the averaged chain, as wide as index..little; the
         thumb a 3-sided tube.
     Same frame as the FP hand (origin = wrist, fingers -Z, palm -Y, thumb -X
     on the right; left mirrored), authored in metres. Cached per
     (side, pose, lod) and shared by every body in the game, so pedinstance
     pools it by identity; per-body size is mesh.scale. */
  function tube(parts, pts, radii, sides, phase, tip, ink) {
    // one continuous tube through pts with a ring per point; radii[i] = [ru, rv]
    // (ru across the lateral axis, rv across the other). Parallel-transported
    // frame, mitred rings, smooth radial normals, pointed tip cap.
    const n = pts.length, rings = [];
    const dir = function (i) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
      const L = Math.hypot(dx, dy, dz) || 1;
      return [dx / L, dy / L, dz / L];
    };
    let lat = null;
    for (let i = 0; i < n; i++) {
      const d = dir(i);
      if (!lat) {
        // first lateral: the hand's X, made perpendicular to the first segment
        lat = [1, 0, 0];
        if (Math.abs(d[0]) > 0.9) lat = [0, 1, 0];
      }
      const k = lat[0] * d[0] + lat[1] * d[1] + lat[2] * d[2];
      let u = [lat[0] - k * d[0], lat[1] - k * d[1], lat[2] - k * d[2]];
      const ul = Math.hypot(u[0], u[1], u[2]) || 1;
      u = [u[0] / ul, u[1] / ul, u[2] / ul];
      lat = u;
      const v = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
      // mitre: a ring on the bisector of a bend is stretched by 1/cos(half-angle)
      let mit = 1;
      if (i > 0 && i < n - 1) {
        const a = pts[i - 1], b = pts[i], c = pts[i + 1];
        const d0 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], d1 = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
        const cs = (d0[0] * d1[0] + d0[1] * d1[1] + d0[2] * d1[2]) / ((Math.hypot(d0[0], d0[1], d0[2]) * Math.hypot(d1[0], d1[1], d1[2])) || 1);
        mit = Math.min(1.35, 1 / Math.max(0.2, Math.sqrt((1 + Math.max(-1, Math.min(1, cs))) / 2)));
      }
      const ring = [];
      for (let s = 0; s < sides; s++) {
        const t = phase + s / sides * Math.PI * 2, ct = Math.cos(t), st = Math.sin(t);
        const nx = u[0] * ct + v[0] * st, ny = u[1] * ct + v[1] * st, nz = u[2] * ct + v[2] * st;
        const ru = radii[i][0] * ct, rv = radii[i][1] * st;
        ring.push({
          p: [pts[i][0] + (u[0] * ru + v[0] * rv) * mit, pts[i][1] + (u[1] * ru + v[1] * rv) * mit, pts[i][2] + (u[2] * ru + v[2] * rv) * mit],
          n: [nx, ny, nz],
          // skin chart: round the finger with its back (t = 3pi/2) at 0.5
          q: ink ? (((t - Math.PI * 1.5) / (Math.PI * 2) + 0.5) % 1 + 1) % 1 : 0,
          a: ink ? ink.a[i] : 0,
        });
      }
      rings.push({ ring, d });
    }
    const P = [], N = [], UV = [];
    const tri = function (a, b, c) {
      P.push(a.p[0], a.p[1], a.p[2], b.p[0], b.p[1], b.p[2], c.p[0], c.p[1], c.p[2]); N.push(a.n[0], a.n[1], a.n[2], b.n[0], b.n[1], b.n[2], c.n[0], c.n[1], c.n[2]);
      if (!ink) return;
      // unwrap across the seam (it runs down the palm side, which is blank)
      let qa = a.q, qb = b.q, qc = c.q;
      const hi = Math.max(qa, qb, qc);
      if (hi - Math.min(qa, qb, qc) > 0.5) { if (qa < 0.5) qa += 1; if (qb < 0.5) qb += 1; if (qc < 0.5) qc += 1; }
      const A = fingerUV(ink.col, qa, a.a), B = fingerUV(ink.col, qb, b.a), C = fingerUV(ink.col, qc, c.a);
      UV.push(A[0], A[1], B[0], B[1], C[0], C[1]);
    };
    for (let i = 0; i < n - 1; i++) {
      const A = rings[i].ring, B = rings[i + 1].ring;
      for (let s = 0; s < sides; s++) {
        const s1 = (s + 1) % sides;
        tri(A[s], B[s], B[s1]);
        tri(A[s], B[s1], A[s1]);
      }
    }
    if (tip) {
      const last = rings[n - 1], e = pts[n - 1], d = last.d;
      for (let s = 0; s < sides; s++) {
        const r0 = last.ring[s], r1 = last.ring[(s + 1) % sides];
        const T = { p: [e[0] + d[0] * tip, e[1] + d[1] * tip, e[2] + d[2] * tip], n: d, q: r0.q, a: 1 };
        tri(r0, T, r1);
      }
    }
    // winding check once: the first quad's face normal must point along its
    // vertex normal (outward); flip every triangle if the frame came out left-handed
    if (P.length >= 9) {
      const ax = P[3] - P[0], ay = P[4] - P[1], az = P[5] - P[2];
      const bx = P[6] - P[0], by = P[7] - P[1], bz = P[8] - P[2];
      const fx = ay * bz - az * by, fy = az * bx - ax * bz, fz = ax * by - ay * bx;
      if (fx * N[0] + fy * N[1] + fz * N[2] < 0) {
        for (let t = 0; t < P.length; t += 9) for (let k = 0; k < 3; k++) {
          let tmp = P[t + 3 + k]; P[t + 3 + k] = P[t + 6 + k]; P[t + 6 + k] = tmp;
          tmp = N[t + 3 + k]; N[t + 3 + k] = N[t + 6 + k]; N[t + 6 + k] = tmp;
        }
        if (ink) for (let t = 0; t < UV.length; t += 6) for (let k = 0; k < 2; k++) {
          const tmp = UV[t + 2 + k]; UV[t + 2 + k] = UV[t + 4 + k]; UV[t + 4 + k] = tmp;
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3));
    if (ink) g.setAttribute("inkuv", new THREE.Float32BufferAttribute(UV, 2));
    parts.push(g);
  }
  const SQ2 = Math.SQRT2;
  function buildBodyHandGeo(side, pose, lod) {
    const p = resolvePose(pose);
    const far = lod >= 2, fine = lod <= 0;
    const parts = [palmGeo(p.cup || 0.004, far ? [4, 3] : fine ? [18, 12] : [6, 4])];
    if (far) {
      // THE FAR WRIST. The far hand had no stub at all, so past ~30 m the
      // palm's heel stopped ~3 cm short of the forearm's crease and every
      // crowd hand floated off its arm. A 4-sided stub (16 tris: heel apex,
      // the crease ring, one ring up the arm, shut) turned a quarter so its
      // flats face the palm. The crease ring is scaled up so the square reads
      // as full as the round stub; the ring up inside the forearm keeps its
      // corners ON the round stub's section so they cannot poke out of the
      // far 8-sided forearm loft.
      const back = p.stub != null ? p.stub : 0.070;
      const rings = stubRings(back, false).filter(function (r, i) { return i !== 1; })
        .map(function (r) { const k = r[0] > 0 ? 1 : 1.2; return [r[0], r[1] * k, r[2] * k, r[3]]; });
      lathe(parts, rings, 4, Math.PI / 4);
    } else {
      // A closed stub (it was an OPEN 6-sided tube: a hole at each end the
      // moment a bend showed it). Table holds run it 7 cm back up the arm:
      // the hand slides down its wrist onto a held socket (character.js
      // HANDS block) and this keeps the crease from opening a gap. A gun
      // hold (trigNN / holdNN, p.stub 0) hangs AT the crease and bends the
      // wrist onto the grip: its stub is only the pivot dome, which a bend
      // turns about its own centre inside the forearm's end.
      const back = p.stub != null ? p.stub : 0.070;
      if (fine) lathe(parts, stubRings(0, true), STUB_LATHE.fp[0], STUB_LATHE.fp[1]);
      else lathe(parts, stubRings(back, false), STUB_LATHE.body[0], STUB_LATHE.body[1]);
    }
    const chains = p._joints.fingers;
    if (!far) {
      FINGERS.forEach(function (f, i) {
        const pts = chains[i];
        // start the tube a finger-radius back inside the palm so the knuckle is closed
        const d0 = [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]];
        const l0 = Math.hypot(d0[0], d0[1], d0[2]) || 1;
        const root = [pts[0][0] - d0[0] / l0 * f.r * 1.4, pts[0][1] - d0[1] / l0 * f.r * 1.4 + 0.001, pts[0][2] - d0[2] / l0 * f.r * 1.4];
        // SIX-SIDED, with the joints standing proud. The square tube read as
        // four boxy sticks on the closest body in the game — your own, three
        // metres from the chase camera. A hexagon (circumradius 1.08 r puts
        // its flats at 0.94 r) is round at that distance, and a ring that is
        // a touch fatter at each joint than the bone either side is the
        // knuckle line a hand is recognised by.
        if (fine) {
          // lod 0: a ring mid-way along each phalanx a little slimmer than the
          // joints either side, so the knuckles read; a little flattened on
          // the palm side (a finger is not a round pipe), ten-sided
          const mid = function (a, b) { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]; };
          const P8 = [root, pts[0], mid(pts[0], pts[1]), pts[1], mid(pts[1], pts[2]), pts[2], mid(pts[2], pts[3]), pts[3]];
          const K8 = [1.02, 1.06, 0.97, 1.00, 0.90, 0.92, 0.82, 0.76];
          const A8 = [-0.08, 0, 1 / 6, 1 / 3, 1 / 2, 2 / 3, 5 / 6, 1];
          tube(parts, P8, K8.map(function (kk) { const r = f.r * kk; return [r, r * 0.92]; }), 10, 0, f.r * 0.72, { col: i, a: A8 });
          return;
        }
        const rs = [1.10, 1.07, 0.97, 0.90, 0.74].map(function (k) { const r = f.r * k * 1.08; return [r, r]; });
        tube(parts, [root].concat(pts), rs, 6, Math.PI / 6, f.r * 0.70, { col: i, a: [-0.08, 0, 1 / 3, 2 / 3, 1] });
      });
    } else {
      // THE MITTEN: the averaged chain, index..little wide, a finger thick.
      // A pose with one finger held out (`lone`: the pointing index) keeps
      // that finger its own thin tube, so a far hand on a button still
      // points; the mitten is the other three.
      const lone = p.lone != null ? p.lone : -1, i0 = lone === 0 ? 1 : 0, nf = lone === 0 ? 3 : 4;
      if (lone === 0) {
        const c = chains[0], r = FINGERS[0].r * 1.3;
        tube(parts, [c[0], c[3]], [[r, r], [r * 0.8, r * 0.8]], 3, Math.PI / 2, FINGERS[0].r * 0.6);
      }
      const pts = [], rs = [];
      for (let j = 0; j < 4; j++) {
        let x = 0, y = 0, z = 0;
        for (let i = i0; i < 4; i++) { x += chains[i][j][0]; y += chains[i][j][1]; z += chains[i][j][2]; }
        pts.push([x / nf, y / nf, z / nf]);
        const a = chains[i0][j], b = chains[3][j];
        const w = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * 0.5 + 0.009;
        rs.push([w * (1 - 0.12 * j) * SQ2 * 0.85, 0.0092 * (1 - 0.1 * j) * SQ2 * 0.9]);
      }
      // three curled fingers are a knuckle roll: one ring fewer pays for the lone finger
      if (lone === 0) { pts.splice(1, 1); rs.splice(1, 1); }
      tube(parts, pts, rs, 4, Math.PI / 4, 0);
    }
    const tpts = p._joints.thumb;
    const trs = tpts.map(function (_, s) {
      const r = s === 0 ? THUMB.r[0] * 1.25 : (s < 3 ? THUMB.r[s] : THUMB.r[2] * 0.85);
      const k = far ? 1.3 : 1.10;
      return [r * k, r * k];
    });
    if (far) tube(parts, [tpts[0], tpts[1], tpts[3]], [trs[0], trs[1], trs[3]], 3, Math.PI / 2, THUMB.r[2] * 0.6);
    else if (fine) {
      // the thumb grows out of the thenar web (a soft mass between it and the
      // palm), one tube, its joints a touch full
      const m01 = [(tpts[0][0] + tpts[1][0]) / 2, (tpts[0][1] + tpts[1][1]) / 2, (tpts[0][2] + tpts[1][2]) / 2];
      const m12 = [(tpts[1][0] + tpts[2][0]) / 2, (tpts[1][1] + tpts[2][1]) / 2, (tpts[1][2] + tpts[2][2]) / 2];
      const m23 = [(tpts[2][0] + tpts[3][0]) / 2, (tpts[2][1] + tpts[3][1]) / 2, (tpts[2][2] + tpts[3][2]) / 2];
      const R0 = THUMB.r[0] * 1.30, R1 = THUMB.r[1], R2 = THUMB.r[2];
      tube(parts, [tpts[0], m01, tpts[1], m12, tpts[2], m23, tpts[3]],
        [[R0, R0], [R0 * 0.90, R0 * 0.88], [R1 * 1.04, R1], [R1 * 0.94, R1 * 0.90], [R2 * 1.02, R2 * 0.96], [R2 * 0.92, R2 * 0.86], [R2 * 0.84, R2 * 0.78]],
        10, 0, R2 * 0.75);
      const web = [(tpts[0][0] + tpts[1][0]) / 2 + 0.006, (tpts[0][1] + tpts[1][1]) / 2 + 0.003, (tpts[0][2] + tpts[1][2]) / 2 - 0.004];
      ball(parts, web, 0.016, 1.0, 0.72, 1.35);
    } else tube(parts, tpts, trs, 6, Math.PI / 6, THUMB.r[2] * 0.7);
    const geo = mergeParts(parts);
    if (side < 0) mirrorX(geo);
    geo.computeBoundingSphere();
    geo._shared = true; geo.userData._shared = true;
    geo.userData.handLod = lod;
    return geo;
  }
  /* bodyHandGeometry(side, pose, lod): side -1 = left, +1 = right; pose a
     POSES name (or pose object); lod 0 = the full first-person hand, 1 = the
     body hand (default), 2 = the far-crowd hand. Shared and cached — never
     dispose it, never mutate it; size it with mesh.scale. */
  function bodyHandGeometry(side, pose, lod) {
    lod = lod == null ? 1 : lod | 0;
    if (lod <= 0) return handGeometry(side, pose);       // (the same construction, finer: buildHandGeo)
    const key = (side < 0 ? "L:" : "R:") + poseKey(pose || "relaxed") + ":" + (lod >= 2 ? 2 : 1);
    return GEO[key] || (GEO[key] = buildBodyHandGeo(side < 0 ? -1 : 1, pose || "relaxed", lod >= 2 ? 2 : 1));
  }
  /* THE FIRST-PERSON FOREARM. Unit length: +Z from the wrist (z 0) to the
     elbow (z 1), laid by poseArm with scale (k, k, lf). Section (metres at
     hand scale 1): foreHalf(u). At the wrist it is the hand's own wrist
     (WRIST) plus a few percent, so the stub's pivot dome hides just inside it
     and there is no step either way; then the belly, then the elbow.

     The wrist end is CLOSED: a shallow dome (FORE_DOME deep) under the
     crease, inside the hand's stub, so a bent wrist shows skin, never the
     hollow inside of a tube. Every caller poses the forearm at lf/k 0.23 ..
     0.29 (fists 0.44/1.9, gun arms 0.265, car 0.27/1.08, bailout 0.48/1.7);
     the dome and the cuff are authored at FORE_NOM and the dome's depth
     varies with that ratio by +-15% (tools/wrist-seam-check.mjs sweeps it). */
  const FORE_NOM = 0.25, FORE_DOME = 0.012;
  function foreHalf(u) {
    const belly = Math.sin(Math.min(1, Math.max(0, u) / 0.72) * Math.PI * 0.5);
    const rx0 = WRIST.hw * 1.05, ry0 = WRIST.ht * 1.06;
    return {
      rx: rx0 + (0.046 - rx0) * belly - (u > 0.72 ? (u - 0.72) * 0.02 : 0),
      ry: ry0 + (0.041 - ry0) * belly,
    };
  }
  let FORE = null, UPPER = null, CUFF = null, ELBOW = null;
  function foreGeo() {
    if (FORE) return FORE;
    // rings bottom-up: the dome's apex, two dome rings, then the tube
    const rings = [], d = FORE_DOME / FORE_NOM;
    const w = foreHalf(0);
    rings.push([-d, 0, 0]);
    for (let k = 2; k >= 1; k--) {
      const th = Math.PI / 2 * k / 3;
      rings.push([-d * Math.sin(th), w.rx * Math.cos(th), w.ry * Math.cos(th)]);
    }
    for (let i = 0; i <= 6; i++) {
      const u = i / 6, s = foreHalf(u);
      rings.push([u, s.rx, s.ry]);
    }
    // the elbow end stays open: the elbow ball covers it
    const parts = [];
    const g = lathe(parts, rings, 12, 0);
    skinUV(g, rings, 12);
    g._shared = true; g.userData._shared = true;
    return (FORE = g);
  }
  /* THE FOREARM ON THE SKIN CHART (entities/tattoo.js "fore"): u = the
     lathe's angle / 2pi from +x, v = wrist (0) -> elbow (1). The lathe
     shares one vertex per ring position, so the u seam at +x would smear a
     strip of triangles across the whole chart: the seam column is split off
     into its own vertices (u = 1), normals kept welded. Apex rings (the
     closed wrist dome) sit at the chart's wrist edge. */
  function skinUV(g, rings, sides) {
    const pos = g.attributes.position, nrm = g.attributes.normal, idx = g.index.array;
    const nv = pos.count, uv = [], P = Array.from(pos.array), N = Array.from(nrm.array);
    const zOf = function (z) { return Math.min(1, Math.max(0, z)); };
    for (let i = 0; i < nv; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const a = (Math.atan2(y, x) + Math.PI * 2) % (Math.PI * 2);
      uv.push(Math.abs(x) + Math.abs(y) < 1e-9 ? 0.5 : a / (Math.PI * 2), zOf(z));
    }
    // duplicate every seam vertex (u 0) as a u 1 twin for triangles on the far side of it
    const twin = new Map();
    const out = Array.from(idx);
    for (let t = 0; t < out.length; t += 3) {
      const us = [uv[out[t] * 2], uv[out[t + 1] * 2], uv[out[t + 2] * 2]];
      if (Math.max(us[0], us[1], us[2]) - Math.min(us[0], us[1], us[2]) < 0.5) continue;
      for (let k = 0; k < 3; k++) {
        const vi = out[t + k];
        if (uv[vi * 2] > 0.25) continue;
        let tw = twin.get(vi);
        if (tw == null) {
          tw = P.length / 3;
          P.push(P[vi * 3], P[vi * 3 + 1], P[vi * 3 + 2]); N.push(N[vi * 3], N[vi * 3 + 1], N[vi * 3 + 2]);
          uv.push(uv[vi * 2] + 1, uv[vi * 2 + 1]);
          twin.set(vi, tw);
        }
        out[t + k] = tw;
      }
    }
    g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(out);
    void rings; void sides;
    return g;
  }
  /* THE ELBOW IS ONE PIECE OF CLOTH (owner: "shirts are not going well over
     joints"). It was three surfaces of the SAME radius meeting at the joint:
     the forearm's open end (4.0-4.1 cm), the upper arm's open end (4.2 cm)
     and a 10x8 ball of 4.3 cm whose flat facets sag 2 mm inside their own
     radius. So the ball's facets dipped UNDER both tubes (the open tube ends
     showed through as see-through notches round the bend) and where they did
     not, three coincident surfaces in two materials z-fought: the torn,
     two-tone elbow. Now the body's own law (character.js JOINTS): the joint
     is a ball whose facets clear every tube end that meets it by >= 1.2 mm,
     so both open ends always sit INSIDE it and the arm reads as one sleeve
     over any bend. The upper arm is a closed solid: a dome over the shoulder
     end, nothing to look into. */
  const ELBOW_R = 0.0445, ELBOW_W = 16, ELBOW_H = 12;
  const UPPER_R0 = 0.042, UPPER_R1 = 0.048, UPPER_NOM = 0.28;
  function upperGeo() {
    if (UPPER) return UPPER;
    // rings [z, rx, ry]: the elbow end (open, inside the ball) up to the
    // shoulder, then a dome authored at UPPER_NOM (posed with scale z = lu)
    const rings = [];
    for (let i = 0; i <= 4; i++) { const r = UPPER_R0 + (UPPER_R1 - UPPER_R0) * i / 4; rings.push([i / 4, r, r]); }
    const D = UPPER_R1 * 0.8 / UPPER_NOM;
    for (let k = 1; k <= 3; k++) {
      const th = Math.PI / 2 * k / 4;
      rings.push([1 + D * Math.sin(th), UPPER_R1 * Math.cos(th), UPPER_R1 * Math.cos(th)]);
    }
    rings.push([1 + D, 0, 0]);
    const g = lathe([], rings, 12, 0);
    g._shared = true; g.userData._shared = true;
    return (UPPER = g);
  }
  /* THE SLEEVE CUFF. It was an OPEN 12-sided ring standing 4-8 mm off the
     wrist (and inside the forearm at its top end): single-sided, so from
     most angles it drew as a hollow band floating round the arm. Now it is
     a closed solid of cloth wrapped ON the forearm: a closed profile swept
     round the forearm's own section (foreHalf) — an inner wall under the
     skin, a rolled lip at the wrist whose underside is a closed annulus the
     hand comes out of, an outer band 3.5-5 mm proud, and a top edge that
     feathers back onto the sleeve. Authored in hand metres at FORE_NOM and
     posed with scale (k, k, lf / FORE_NOM), so it follows the forearm's
     section exactly for any forearm length. Profile [z, offset off the
     forearm's surface], walked inner-top -> down -> lip -> outer -> top. */
  const CUFF_PROFILE = [
    [0.058, -0.0035], [0.006, -0.0035], [0.0015, -0.0015], [0.0005, 0.0012], [0.0025, 0.0038],
    [0.0065, 0.0048], [0.020, 0.0041], [0.046, 0.0035], [0.056, 0.0013], [0.059, 0.0002],
  ];
  function cuffGeo() {
    if (CUFF) return CUFF;
    const sides = 12, n = CUFF_PROFILE.length, P = [], idx = [];
    for (let j = 0; j < n; j++) {
      const z = CUFF_PROFILE[j][0], o = CUFF_PROFILE[j][1], s = foreHalf(z / FORE_NOM);
      for (let i = 0; i < sides; i++) {
        const a = i / sides * Math.PI * 2;
        P.push((s.rx + o) * Math.cos(a), (s.ry + o) * Math.sin(a), z);
      }
    }
    for (let j = 0; j < n; j++) {
      const j1 = (j + 1) % n;              // the profile is a closed loop
      for (let i = 0; i < sides; i++) {
        const i1 = (i + 1) % sides;
        const a0 = j * sides + i, a1 = j * sides + i1, b0 = j1 * sides + i, b1 = j1 * sides + i1;
        idx.push(a0, a1, b1, a0, b1, b0);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    g._shared = true; g.userData._shared = true;
    return (CUFF = g);
  }
  function elbowGeo() {
    if (ELBOW) return ELBOW;
    const g = new THREE.SphereGeometry(ELBOW_R, ELBOW_W, ELBOW_H);
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
  // THE PLAYER'S INK (entities/tattoo.js): every first-person hand and
  // forearm asks, as it is drawn, whether the skin under its material is bare
  // and carries ink; tattoo.js swaps in a twin of the caller's material that
  // wears the chart (next frame) and hands the caller's own back when not.
  function fpInk(kind) {
    return function () { const T = CBZ.tattoo; if (T && T.fpSync) T.fpSync(this, kind); };
  }
  const HAND_INK = fpInk("hand"), FORE_INK = fpInk("fore");
  function makeHand(side, pose, material) {
    const m = new THREE.Mesh(handGeometry(side, pose), material);
    m.name = side < 0 ? "fp_hand_l" : "fp_hand_r";
    m.userData.side = side < 0 ? -1 : 1;
    m.userData.pose = pose;
    m.castShadow = false;
    m.onBeforeRender = HAND_INK;
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

  /* ==== THE ARM IS THE BODY'S ARM ========================================
     Owner: "make hands and arms look real holding the gun. The way they look
     in third person and first person should look the same and realer."

     Every first-person arm in the game (the gun arms, the fists, the car
     cabin, the cockpit, the pickup lens, the bailout) used to be a private
     lathe: a tapered tube of ONE flat Lambert colour per segment (dressOf
     guessed the colour off the body), so down the lens a jumpsuit sleeve was
     a fat yellow sausage while the chase camera showed the same sleeve as the
     body's lofted cloth limb with its painted garment, cuff and shading.

     Now the arm down the lens IS the body's arm. makeArm() keeps two pivots,
     a shoulder (`sh`) and an elbow (`lo`), and every frame poseArm() mirrors
     whatever hangs off the PLAYER RIG's own arm into them: the upper-arm loft,
     its bare piece under a short sleeve, the forearm loft, the watch, the
     holes and blood wounds.js stamped on the limb, a cuff or an armband: the
     SAME geometry objects and a viewmodel twin of the SAME material (bodyTwin:
     the body's own material, cloned once, with only the viewmodel's render
     queue flags changed and its colour, map and opacity copied every frame,
     so a hit flash, an ink chart or a redress shows on both). The hand and
     anything in it stay the caller's (it is posed on the thing it holds).

     SCALE. The arm is drawn at its REAL size: the caller's k is its units
     per real metre (the first-person hand is a life-size hand at k), and
     the rig's own scales give metres per rig unit (mpr), so the viewmodel's
     2.56x world gets the body's arm at 2.56x, not a fatter tube — and not
     the body hand's own exaggeration either (character.js may draw the body
     hand larger than life for read at distance; the forearm loft is the
     body's real forearm, whose wrist fits a life-size hand).

     POSE. The caller still solves the arm (wrist, elbow, shoulder). The
     forearm is laid from the wrist along the caller's forearm line at the
     body's own forearm length; its loft is rolled so its front (the thumb
     side, where the body's loft has its belly) follows the hand's thumb, which
     is what character.js's wrist twist does in third person. The upper arm
     runs from that elbow to the shoulder with the bicep toward the forearm;
     where the shoulder is out of the body's reach the upper arm stretches (up
     to 40%: it is the part the lens barely sees) and is anchored AT THE
     ELBOW, so the joint never opens.

     No body (a menu, a node tool, a mode without a player rig): the lathe
     arm below draws instead, as before. */
  function makeArm(mats, side) {
    const g = new THREE.Group();
    g.name = "fp_arm";
    if (side != null) g.userData.side = side < 0 ? -1 : 1;
    const fore = new THREE.Mesh(foreGeo(), mats.fore);
    fore.onBeforeRender = FORE_INK;
    const cuff = new THREE.Mesh(cuffGeo(), mats.fore);
    const upper = new THREE.Mesh(upperGeo(), mats.upper || mats.fore);
    const elbow = new THREE.Mesh(elbowGeo(), mats.upper || mats.fore);
    [fore, cuff, upper, elbow].forEach(function (m) { m.castShadow = false; g.add(m); });
    cuff.visible = false;
    g.userData.parts = { fore, cuff, upper, elbow };
    // the body's arm: two pivots the rig's own limb pieces are mirrored into
    const sh = new THREE.Group(), lo = new THREE.Group();
    sh.name = "fp_body_shoulder"; lo.name = "fp_body_elbow";
    sh.visible = lo.visible = false;
    g.add(sh, lo);
    g.userData.body = { sh: sh, lo: lo, map: new Map(), rig: null, like: mats.fore || null, frame: 0 };
    g.userData.bodyOn = false;
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
     flat face rolls with the wrist. k = the hand's scale (units per hand
     metre). With a player body the body's own arm is drawn (poseBodyArm);
     the lathe parts are still laid (tools and the watch read their frame)
     but hidden. */
  function poseArm(arm, wrist, elbow, shoulder, handQ, k, sleeved) {
    const P = arm.userData.parts;
    arm.userData.sleeved = !!sleeved;
    if (arm.userData.side == null) arm.userData.side = ((shoulder || elbow).x < 0) ? -1 : 1;
    _hy.set(0, 1, 0).applyQuaternion(handQ);
    _d.subVectors(elbow, wrist);
    const lf = _d.length();
    lookQuat(_d, _hy, _fq);
    P.fore.position.copy(wrist);
    P.fore.quaternion.copy(_fq);
    P.fore.scale.set(k, k, lf);
    P.cuff.visible = !!sleeved;
    if (sleeved) { P.cuff.position.copy(wrist); P.cuff.quaternion.copy(_fq); P.cuff.scale.set(k, k, lf / FORE_NOM); }
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
    const on = poseBodyArm(arm, wrist, elbow, shoulder, handQ, k);
    if (on !== arm.userData.bodyOn) {
      arm.userData.bodyOn = on;
      P.fore.visible = P.elbow.visible = !on;
      if (on) P.cuff.visible = false;
    }
    if (on) { P.cuff.visible = false; P.upper.visible = false; }
  }

  // ---- the body's arm, mirrored -------------------------------------------
  /* The player rig's arm on `side` (+1 right = rig.parts.ra, -1 = la):
     the shoulder pivot, the elbow pivot, the forearm loft, the hand and its
     fit, and the two bone lengths in rig units. null = no body to mirror. */
  function bodyArmSource(ch, side) {
    const part = ch && ch.parts && (side < 0 ? ch.parts.la : ch.parts.ra);
    const ud = part && part.userData;
    const low = ud && ud.low, lower = ud && ud.lower, cap = ud && ud.cap;
    const fit = cap && cap.userData && cap.userData.fit;
    if (!low || !lower || !fit || !(fit.s > 0) || !(fit.wristY < 0)) return null;
    // metres per rig unit: the rig's own scales from the arm's parent up
    // (model.scale = HUMAN_SCALE; a child's group scale) — the arm's REAL size
    let mpr = 1;
    for (let p = part.parent; p; p = p.parent) { mpr *= p.scale.x || 1; if (p === ch.group) break; }
    return { part: part, low: low, lower: lower, cap: cap, fit: fit, L1: low.position.length(), L2: -fit.wristY, mpr: mpr };
  }
  /* bodyArmLens(k, ch): the body's upper arm and forearm (shoulder -> elbow,
     elbow -> wrist crease) at hand scale k, for a caller's IK. Falls back to a
     real man's 0.30 / 0.265 m when there is no body. */
  /* bodyHandK(ch): THIS BODY'S HAND AGAINST THE STANDARD ONE. Every grasp is
     authored for one life-size hand (k = units per hand metre); a body's own
     hand is its rig hand (character.js bodyHandFit: sized off its height and
     its arm) at the rig's scale. 1 = the standard hand; a woman's or a small
     man's comes out under it. In 2% steps, so near-equal bodies share one
     solved grip; 1 with no body. */
  function bodyHandK(ch) {
    const src = bodyArmSource(ch === undefined ? CBZ.playerChar : ch, 1);
    if (!src) return 1;
    const k = src.fit.s * src.mpr;
    return isFinite(k) && k > 0 ? Math.max(0.8, Math.min(1.15, Math.round(k * 50) / 50)) : 1;
  }
  function bodyArmLens(k, ch, side) {
    const src = bodyArmSource(ch === undefined ? CBZ.playerChar : ch, side || 1);
    if (!src) return [0.30 * k, 0.265 * k];
    const s = k * src.mpr;
    return [src.L1 * s, src.L2 * s];
  }
  /* bodyShoulder(side, ch): WHERE THIS BODY'S SHOULDER JOINT IS FROM ITS OWN
     EYES, in the first-person camera's frame (+x right, +y up, -z ahead) and
     in HAND METRES (the caller scales by its hand scale k, as it does the
     bones), measured off the rig itself: the arm pivot (rig.parts.ra / la,
     the joint the upper-arm loft hangs from) against the midpoint of the two
     eyeballs (rig.face.eyeL / eyeR), through the rig's REST transforms
     (positions and scales; no animated rotation of the neck, head or arms),
     so a man, a woman and a child each see their arms from where their own
     shoulders are. null with no body (the caller keeps its constants).
     Cached per rig. */
  const _shM = new THREE.Matrix4(), _shL = new THREE.Matrix4(), _shQ = new THREE.Quaternion(), _shV = new THREE.Vector3();
  function restTo(o, root, out) {
    out.identity();
    for (let p = o; p && p !== root; p = p.parent) { _shL.compose(p.position, _shQ, p.scale); out.premultiply(_shL); }
    return out;
  }
  function bodyShoulder(side, ch) {
    ch = ch === undefined ? CBZ.playerChar : ch;
    const src = bodyArmSource(ch, side < 0 ? -1 : 1);
    const f = ch && ch.face, body = src && src.part.parent;
    if (!src || !f || !f.eyeL || !f.eyeR || !body) return null;
    const key = "_fpShoulder" + (side < 0 ? "L" : "R");
    const c = ch[key];
    if (c && c.part === src.part && c.s === src.mpr) return c.v;
    // the eyes' midpoint and the shoulder joint, both in the body's frame (rig units)
    const e = _shV.set(0, 0, 0).applyMatrix4(restTo(f.eyeL, body, _shM)).clone();
    e.add(new THREE.Vector3().applyMatrix4(restTo(f.eyeR, body, _shM))).multiplyScalar(0.5);
    const sp = src.part.position.clone();          // the arm pivot sits in the body's frame
    const d = sp.sub(e).multiplyScalar(src.mpr);        // rig units -> metres (the caller's k is per metre)
    // body frame: +X the body's left (the semantic right arm is at -X), +Z
    // forward. Camera: +x right, -z ahead.
    const v = [-d.x, d.y, -d.z];
    Object.defineProperty(ch, key, { value: { part: src.part, s: src.mpr, v: v }, writable: true, configurable: true, enumerable: false });
    return v;
  }
  /* bodyTwin(src, like): the viewmodel's copy of a body material. Cloned once
     per (material, render flags) and re-synced every call: colour, emissive,
     map, opacity, visibility follow the body's material live. `like` (the
     caller's own material) lends the render-queue flags (transparent /
     depthTest / depthWrite): the gun viewmodel draws in the late queue after
     a depth clear, a car cabin in the ordinary one. */
  const TWINS = new WeakMap();
  function bodyTwin(src, like) {
    if (!src) return like || null;
    if (Array.isArray(src)) return src.map(function (m) { return bodyTwin(m, like); });
    const tr = like ? !!(like.transparent || src.transparent) : !!src.transparent;
    const dt = like ? !!(like.depthTest && src.depthTest) : !!src.depthTest;
    const dw = src.transparent ? !!src.depthWrite : (like ? !!like.depthWrite : !!src.depthWrite);
    const key = (tr ? 1 : 0) | (dt ? 2 : 0) | (dw ? 4 : 0);
    let per = TWINS.get(src);
    if (!per) TWINS.set(src, per = {});
    let m = per[key];
    if (!m) {
      m = src.clone();
      m.userData = Object.assign({}, src.userData, { cbzBodyTwin: true });
      m.transparent = tr; m.depthTest = dt; m.depthWrite = dw;
      m.needsUpdate = true;
      per[key] = m;
    }
    if (m.color && src.color) m.color.copy(src.color);
    if (m.emissive && src.emissive) { m.emissive.copy(src.emissive); m.emissiveIntensity = src.emissiveIntensity; }
    if (m.map !== src.map) { m.map = src.map; m.needsUpdate = true; }
    m.opacity = src.opacity;
    m.visible = src.visible;
    if (m.side !== src.side) { m.side = src.side; m.needsUpdate = true; }
    return m;
  }
  /* The hand's material off the body (glove, heritage skin, ink chart) as a
     viewmodel twin, or null with no body. */
  function bodyHandMaterial(side, like, ch) {
    ch = ch === undefined ? CBZ.playerChar : ch;
    const part = ch && ch.parts && (side < 0 ? ch.parts.la : ch.parts.ra);
    const cap = part && part.userData && part.userData.cap;
    const m = cap && cap.material;
    return m && !Array.isArray(m) ? bodyTwin(m, like) : null;
  }
  const _bM = new THREE.Matrix4(), _bL = new THREE.Matrix4(), _bQ0 = new THREE.Quaternion();
  const _bE = new THREE.Vector3(), _bX = new THREE.Vector3(), _bY = new THREE.Vector3(), _bZ = new THREE.Vector3();
  const _bT = new THREE.Vector3();
  // the mesh's matrix relative to its pivot; the forearm loft's own twist is
  // left out (the elbow pivot here is already rolled with the hand)
  function relMatrix(o, pivot, lower, out) {
    out.identity();
    for (let p = o; p && p !== pivot; p = p.parent) {
      if (p === lower) _bL.compose(p.position, _bQ0, p.scale);
      else { p.updateMatrix(); _bL.copy(p.matrix); }
      out.premultiply(_bL);
    }
    return out;
  }
  function mirrorInto(B, node, pivot, target, src, ro, stamp) {
    const ch = node.children;
    for (let i = 0; i < ch.length; i++) {
      const o = ch[i];
      if (o === src.cap || o === src.low || o.visible === false) continue;
      if (o.userData && (o.userData.isSocket || o.userData.fpSkip)) continue;
      if ((o.isMesh || o.isLine) && !o.isInstancedMesh && !o.isSkinnedMesh && o.geometry) {
        let px = B.map.get(o);
        if (!px) {
          px = new THREE.Mesh(o.geometry, null);
          px.name = "fp_body_" + (o.name || "part");
          px.matrixAutoUpdate = false;
          px.castShadow = false; px.receiveShadow = false;
          px.frustumCulled = false;
          B.map.set(o, px);
        }
        if (px.parent !== target) target.add(px);
        px.geometry = o.geometry;
        px.material = bodyTwin(o.material, B.like);
        relMatrix(o, pivot, src.lower, px.matrix);
        px.renderOrder = ro + Math.max(0, Math.min(20, (o.renderOrder || 0) - (src.lower.renderOrder || 0)));
        px.visible = true;
        px.userData.seen = stamp;
      }
      if (o.children.length) mirrorInto(B, o, pivot, target, src, ro, stamp);
    }
  }
  function poseBodyArm(arm, wrist, elbow, shoulder, handQ, k) {
    const B = arm.userData.body;
    if (!B) return false;
    const side = arm.userData.side < 0 ? -1 : 1;
    const src = arm.userData.bodyOff ? null : bodyArmSource(CBZ.playerChar, side);
    if (!src) { B.sh.visible = B.lo.visible = false; return false; }
    if (B.rig !== src.part) {
      // a new body: drop every piece of the old one
      B.map.forEach(function (px) { if (px.parent) px.parent.remove(px); });
      B.map.clear();
      B.rig = src.part;
    }
    const s = k * src.mpr, L2 = src.L2 * s, L1 = src.L1 * s;
    // THE FOREARM: from the wrist, along the caller's forearm line, the body's length
    _bY.subVectors(elbow, wrist);
    if (_bY.lengthSq() < 1e-12) _bY.set(0, -1, 0);
    _bY.normalize();
    _bE.copy(wrist).addScaledVector(_bY, L2);
    // its front (+Z, the thumb side) follows the hand's thumb
    _bT.set(side > 0 ? -1 : 1, 0, 0).applyQuaternion(handQ);
    _bZ.copy(_bT).addScaledVector(_bY, -_bT.dot(_bY));
    if (_bZ.lengthSq() < 1e-8) { _bZ.set(0, 0, 1).applyQuaternion(handQ); _bZ.addScaledVector(_bY, -_bZ.dot(_bY)); }
    _bZ.normalize();
    _bX.crossVectors(_bY, _bZ);
    _bM.makeBasis(_bX, _bY, _bZ);
    B.lo.quaternion.setFromRotationMatrix(_bM);
    B.lo.position.copy(_bE);
    B.lo.scale.setScalar(s);
    B.lo.visible = true;
    // THE UPPER ARM: elbow -> shoulder, the bicep toward the forearm
    if (shoulder) {
      _bY.subVectors(shoulder, _bE);
      const d = _bY.length() || 1e-6;
      _bY.multiplyScalar(1 / d);
      _bT.subVectors(wrist, _bE);
      _bZ.copy(_bT).addScaledVector(_bY, -_bT.dot(_bY));
      if (_bZ.lengthSq() < 1e-8) { _bZ.set(0, 0, 1).applyQuaternion(B.lo.quaternion); _bZ.addScaledVector(_bY, -_bZ.dot(_bY)); }
      _bZ.normalize();
      _bX.crossVectors(_bY, _bZ);
      _bM.makeBasis(_bX, _bY, _bZ);
      B.sh.quaternion.setFromRotationMatrix(_bM);
      const st = Math.max(0.8, Math.min(1.4, d / L1));
      B.sh.scale.set(s, s * st, s);
      B.sh.position.copy(_bE).addScaledVector(_bY, L1 * st);   // anchored at the elbow
      B.sh.visible = true;
    } else B.sh.visible = false;
    // the pieces: everything the body's arm wears, this frame
    const stamp = ++B.frame;
    const ro = arm.renderOrder || 0;
    mirrorInto(B, src.part, src.part, B.sh, src, ro, stamp);
    mirrorInto(B, src.low, src.low, B.lo, src, ro, stamp);
    B.map.forEach(function (px, o) {
      if (px.userData.seen === stamp) return;
      px.visible = false;
      if (!o.parent) { if (px.parent) px.parent.remove(px); B.map.delete(o); }   // gone from the body for good
    });
    return true;
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
  /* THE GUN AROUND THE GRIP, as exact solids: every part of `root` (hands
     excluded) whose shape is known exactly — a box, a cylinder, or one of
     the gun kit's extruded side profiles (sidearm.js prof() tags its
     geometry with the outline it extruded) — expressed in `space` (an
     ancestor of the hand; usually the gun model). Anything else is left
     out rather than guessed as its bounding box. Built once per gun at load. */
  const _sM = new THREE.Matrix4(), _sS = new THREE.Matrix4(), _sV = new THREE.Vector3();
  function solidsOf(root, space) {
    const toRoot = function (o, m) { m.identity(); for (let p = o; p && p !== root; p = p.parent) { p.updateMatrix(); m.premultiply(p.matrix); } return m; };
    const hand = function (o) { for (let p = o; p && p !== root; p = p.parent) if (/^fp_hand/.test(p.name)) return true; return false; };
    toRoot(space, _sS).invert();
    const out = [];
    root.traverse(function (o) {
      if (!o.isMesh || !o.geometry || hand(o)) return;
      const g = o.geometry, pr = g.parameters || {};
      if (!g.boundingBox) g.computeBoundingBox();
      const bb = g.boundingBox, c = bb.getCenter(new THREE.Vector3()), h = bb.getSize(new THREE.Vector3()).multiplyScalar(0.5);
      let s = null;
      if (g.userData && g.userData.profile) s = { kind: 2, pf: g.userData.profile };
      // a lathe: its profile (radius, height) closed on itself, turned round Y
      else if (g.type === "LatheGeometry" && pr.points && pr.points.length > 2) s = { kind: 3, pts: pr.points.map(function (v) { return [v.x, v.y]; }) };
      // a box (its geometry may have been turned by quarter turns: its bounds are still its shape)
      else if (g.type === "BoxGeometry") s = { kind: 0, c: c, hx: h.x, hy: h.y, hz: h.z };
      else if (g.type === "CylinderGeometry") {
        // the axis is whichever bound is the cylinder's height (a kit tube is rotated in its geometry)
        const H = pr.height / 2, ax = [h.x, h.y, h.z].findIndex(function (v) { return Math.abs(v - H) < 1e-4; });
        s = ax < 0 ? { kind: 0, c: c, hx: h.x, hy: h.y, hz: h.z } : { kind: 1, c: c, ax: ax, hy: H, r: Math.max(pr.radiusTop, pr.radiusBottom) };
      }
      if (!s) return;
      toRoot(o, _sM).premultiply(_sS);                    // mesh -> space
      _sV.setFromMatrixScale(_sM);
      s.k = Math.max(_sV.x, _sV.y, _sV.z) || 1;          // local units -> space units (parts are uniformly scaled)
      s.inv = _sM.clone().invert().elements;
      out.push(s);
    });
    return out;
  }
  // signed distance to a closed 2D polygon (negative inside)
  function polySdf(P, x, y) {
    let d = Infinity, sg = 1;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      const ax = P[j][0], ay = P[j][1], ex = P[i][0] - ax, ey = P[i][1] - ay, wx = x - ax, wy = y - ay;
      const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / ((ex * ex + ey * ey) || 1e-12)));
      const bx = wx - ex * t, by = wy - ey * t;
      d = Math.min(d, bx * bx + by * by);
      if ((P[i][1] > y) !== (ay > y) && x < ax + (y - ay) * ex / ey) sg = -sg;
    }
    return sg * Math.sqrt(d);
  }
  function profileSdf(pf, lx, ly, lz) {
    // sidearm.js prof(): shape x -> -Z (forward), extruded along X; axis "z": shape x -> -X, extruded along Z
    const sx = pf.axis === "z" ? -lx : -lz, e = pf.axis === "z" ? lz : lx;
    let d2 = Infinity;
    for (let i = 0; i < pf.list.length; i++) {
      let d = polySdf(pf.list[i], sx, ly);
      if (i === 0 && pf.holes) for (let k = 0; k < pf.holes.length; k++) d = Math.max(d, -polySdf(pf.holes[k], sx, ly));
      d2 = Math.min(d2, d);
    }
    // the extruded walls stand `bevel` proud of the outline (three's
    // bevelSize grows the contour); the bevelled caps bring the total to `width`
    d2 -= pf.bevel || 0;
    const de = Math.abs(e) - pf.width / 2;
    return Math.hypot(Math.max(d2, 0), Math.max(de, 0)) + Math.min(Math.max(d2, de), 0);
  }
  function solidsSdf(list, x, y, z) {
    let best = Infinity;
    for (let i = 0; i < list.length; i++) {
      const s = list[i], e = s.inv;
      const lx = e[0] * x + e[4] * y + e[8] * z + e[12], ly = e[1] * x + e[5] * y + e[9] * z + e[13], lz = e[2] * x + e[6] * y + e[10] * z + e[14];
      let d;
      if (s.kind === 2) d = profileSdf(s.pf, lx, ly, lz);
      else if (s.kind === 3) d = polySdf(s.pts, Math.hypot(lx, lz), ly);
      else {
        const px = lx - s.c.x, py = ly - s.c.y, pz = lz - s.c.z;
        if (s.kind === 1) {
          const along = s.ax === 0 ? px : s.ax === 1 ? py : pz;
          const rad = s.ax === 0 ? Math.hypot(py, pz) : s.ax === 1 ? Math.hypot(px, pz) : Math.hypot(px, py);
          const qx = rad - s.r, qy = Math.abs(along) - s.hy;
          d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
        } else {
          const qx = Math.abs(px) - s.hx, qy = Math.abs(py) - s.hy, qz = Math.abs(pz) - s.hz;
          d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0);
        }
      }
      d *= s.k;
      if (d < best) best = d;
    }
    return best;
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
    // the THUMB feels the whole gun: the held part plus every solid around it
    // (spec.solids, see solidsOf) — the part alone is an endless/idealised
    // prism, so a thumb laid "on" it could hang in the air past the grip's
    // front strap or bury itself in the receiver or the barrel nut beside it
    // (a solid the palm itself sits in — the drawn foregrip a little fatter
    // than its hold data — is the held part, not something to rest on; a
    // solid only the thumb's ROOT is in means the hand is pushed into the
    // gun: it stays, the thumb reports itself wedged and the caller slides
    // the hand clear, see regraspWithSolids)
    const SOL = spec.solids && spec.solids.length ? spec.solids.filter(function (s) {
      const c = toM(palm);
      return solidsSdf([s], c.x, c.y, c.z) > -0.002 * k;
    }) : null;
    const sdfT = SOL ? function (h) { const m = toM(h); return Math.min(prismSdf(P, m.x, m.y, m.z), solidsSdf(SOL, m.x, m.y, m.z)) / k; } : sdfH;
    /* THE FINGERS CLOSE ON WHAT IS DRAWN (spec.fingersOnSolids, the firing
       hand once its gun is finished): the grip prism is endless, the drawn
       grip is not, so a finger below the end of a short grip (the M24's)
       used to close on the prism's air and hang there, reaching forward.
       Its surface is now the prism INTERSECTED with the drawn solids — the
       same grip where there is grip, nothing past its end, where the finger
       closes into the palm. Only when the drawn gun is known round the grip
       (the grasp point sits inside a solid). */
    const sdfF = (SOL && spec.fingersOnSolids && solidsSdf(SOL, spec.at.x, spec.at.y, spec.at.z) < 0)
      ? function (h) { const m = toM(h); return Math.max(prismSdf(P, m.x, m.y, m.z), solidsSdf(SOL, m.x, m.y, m.z)) / k; }
      : sdfH;
    // clearance of the segment a->b (radii ra->rb) from the surface; < 0 = inside
    const segGap = function (a, b, ra, rb, from, f) {
      let g = Infinity;
      for (let t = from == null ? 0.25 : from; t <= 1.0001; t += 0.25) {
        const h = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
        g = Math.min(g, (f || sdfH)(h) - (ra + (rb - ra) * t));
      }
      return g;
    };
    const CONTACT = 0.0012;                      // a pad pressed within 1.2 mm is ON the surface
    const SOFT_MAX = [1.45, 1.75, 1.15];
    const fingers = [], contacts = { tips: [], trigger: null, thumb: null }, held = [];
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
      // FINGERS TOGETHER ROUND ONE THING: a hand closed on a grip holds its
      // fingers adducted (side by side, touching), not fanned; the old
      // default let each keep part of its open-hand splay, so the four tips
      // spread like a rake down a grip (spec.splay may still ask for one)
      // (and converging a little toward the middle finger: the four knuckles
      // sit 2 cm apart but the fingertips are thinner than the roots, so
      // parallel fingers opened a 5-7 mm slot at every tip; a closed hand's
      // fingers lie against each other the whole way)
      const sp = spec.splay ? spec.splay[i] : FINGER_CONVERGE * (1.5 - i);
      const segGapF = function (a, b, ra, rb) { return segGap(a, b, ra, rb, null, sdfF); };
      let touched = false;
      for (let j = 0; j < 3; j++) {
        // a segment that STARTS inside (the one before it closed so far that
        // this one points into the part) opens back out until it is clear
        {
          const pts = fingerChain(f, flex, sp);
          if (segGapF(pts[j], pts[j + 1], rs[j], rs[j + 1]) < 0) {
            let a = flex[j];
            for (; a > -0.35; a -= 0.02) {
              flex[j] = a;
              const q = fingerChain(f, flex, sp);
              if (segGapF(q[j], q[j + 1], rs[j], rs[j + 1]) >= 0) break;
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
          let gap = segGapF(pts[j], pts[j + 1], rs[j], rs[j + 1]);
          if (j === 1) gap = Math.min(gap, segGapF(pts[2], pts[3], rs[2], rs[3]));
          if (gap < CONTACT) { hit = true; touched = true; break; }
        }
        flex[j] = hit ? Math.max(0, a - 0.02) : Math.min(a, SOFT_MAX[j]);
        if (hit && j === 0) {
          // the proximal segment is ON the part: bisect onto the surface
          let lo = flex[0], hi = flex[0] + 0.02;
          for (let it = 0; it < 6; it++) {
            const mid = (lo + hi) / 2; flex[0] = mid;
            const pts = fingerChain(f, flex, sp);
            if (segGapF(pts[0], pts[1], rs[0], rs[1]) < CONTACT) hi = mid; else lo = mid;
          }
          flex[0] = lo;
        }
      }
      // a finger that met NOTHING (or whose tip still hangs in the air) closes on into the palm like a fist (it
      // used to stop at SOFT_MAX, half curled, pointing into the air beside
      // the grip: the support index finger hung 2 cm off a pistol), as far
      // as it can without entering the part
      const tipOff = sdfF(fingerChain(f, flex, sp)[3]) - rs[3];
      let rested = false;
      if (!touched || tipOff > 0.008) {
        /* A FINGER PAST THE END OF THE GRIP RESTS ON THE GUN. The little
           finger under a short grip (the taser, the sniper's stock wrist)
           closed on into the palm and hung curled under the butt, its pad
           2 cm off anything. A real one tucks up under the magazine floor /
           the butt and rests its pad there: the joint angles (knuckle,
           middle; the last joint follows the middle at 0.6) whose pad lands
           ON the nearest drawn surface with no segment inside it. Failing a
           surface within 1 cm, it closes into the palm as before. */
        const minGap = function (q) { return Math.min(segGapF(q[0], q[1], rs[0], rs[1]), segGapF(q[1], q[2], rs[1], rs[2]), segGapF(q[2], q[3], rs[2], rs[3])); };
        const g0 = Math.min(0, minGap(fingerChain(f, flex, sp))) - 0.0015;      // a pad presses 1.5 mm
        let best = null;
        for (let a0 = -0.2; a0 <= JOINT_MAX[0] + 1e-6; a0 += 0.1) {
          for (let a1 = 0; a1 <= JOINT_MAX[1] + 1e-6; a1 += 0.1) for (let r2 = 0.3; r2 <= 1.01; r2 += 0.35) {
            const tf = [a0, a1, Math.min(JOINT_MAX[2], a1 * r2)];
            const q = fingerChain(f, tf, sp);
            if (minGap(q) < g0) continue;
            const tg = sdfF(q[3]) - rs[3];
            const cost = Math.abs(tg) + 0.0015 * Math.abs(a0 - flex[0]);
            if (!best || cost < best.cost) best = { cost: cost, tg: tg, tf: tf };
          }
        }
        if (best && Math.abs(best.tg) <= 0.010) { flex[0] = best.tf[0]; flex[1] = best.tf[1]; flex[2] = best.tf[2]; rested = true; }
        else {
          const FIST = POSES.fist.flex[i];
          const f0 = flex.slice();
          for (let st = 1; st <= 10; st++) {
            const tf = [f0[0] + (FIST[0] - f0[0]) * st / 10, f0[1] + (FIST[1] - f0[1]) * st / 10, f0[2] + (FIST[2] - f0[2]) * st / 10];
            if (minGap(fingerChain(f, tf, sp)) < g0) break;
            flex[0] = tf[0]; flex[1] = tf[1]; flex[2] = tf[2];
          }
        }
      }
      const pts = fingerChain(f, flex, sp);
      fingers.push(pts);
      held[i] = { flex: flex.slice(), sp: sp, rs: rs, gap: segGapF };
      // a finger that met nothing (past the end of a drawn grip) closed into
      // the palm like a fist: it has no surface to be measured against
      contacts.tips.push(touched || rested || sdfF === sdfH ? sdfF(pts[3]) - rs[3] : null);
    });
    /* ALL FOUR IN ONE CURL (spec.together: the thumbs-forward cup). Each
       finger closed on its own until it touched, so neighbours stopped at
       different curls and their tips stood 4-7 mm apart: a fan. Here they
       take ONE curl, the mean of theirs, each backed off toward its own only
       as far as it must to stay out of what it holds. */
    if (spec.together) {
      const idx = [];
      for (let i = 0; i < 4; i++) if (held[i]) idx.push(i);
      if (idx.length > 1) {
        const mean = [0, 1, 2].map(function (j) { let t = 0; idx.forEach(function (i) { t += held[i].flex[j]; }); return t / idx.length; });
        idx.forEach(function (i) {
          const H0 = held[i], f = FINGERS[i];
          const ok = function (q) { return Math.min(H0.gap(q[0], q[1], H0.rs[0], H0.rs[1]), H0.gap(q[1], q[2], H0.rs[1], H0.rs[2]), H0.gap(q[2], q[3], H0.rs[2], H0.rs[3])) >= -0.0015; };
          for (let t = 1; t >= -1e-6; t -= 0.1) {
            const fl = [0, 1, 2].map(function (j) { return H0.flex[j] + (mean[j] - H0.flex[j]) * t; });
            const q = fingerChain(f, fl, H0.sp);
            if (t <= 1e-6 || ok(q)) { fingers[i] = q; break; }
          }
        });
      }
    }
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
      // the metacarpal lives in the hand's own flesh: only the held part
      // shapes it; the two phalanges feel the whole gun (spec.solids)
      let ang = 0, dd = rot(0), escaped = true;
      const curl = function (fS) {
        ang = 0; dd = rot(0); escaped = true;
        // already in the part (a thumb aimed into it): swing out first
        if (segGap(a0, end(dd), r0, r1, s === 0 ? (fS === sdfH ? 0.5 : 0.75) : 0.25, fS) < 0) {
          escaped = false;
          for (ang = 0; ang > -1.6; ang -= 0.03) { dd = rot(ang); if (segGap(a0, end(dd), r0, r1, s === 0 ? (fS === sdfH ? 0.5 : 0.75) : 0.25, fS) >= CONTACT) { escaped = true; break; } }
        } else {
          const cap = spec.thumbBend ? spec.thumbBend[s] : [0.9, 1.1, 0.9][s];
          for (ang = 0; ang <= cap; ang += 0.02) {
            const nd = rot(ang);
            if (segGap(a0, end(nd), r0, r1, s === 0 ? (fS === sdfH ? 0.5 : 0.75) : 0.25, fS) < CONTACT) break;
            dd = nd;
          }
        }
      };
      const useSol = !!SOL;
      curl(useSol ? sdfT : sdfH);
      if (useSol && !escaped) { curl(sdfH); contacts.wedged = (contacts.wedged || 0) + 1; }   // wedged among solids: the held part alone
      /* SETTLE (against the whole gun): the curl above stops at the FIRST
         touch anywhere along the segment, so a segment that grazes an edge
         with its root is left pointing off into the air (the Uzi's pad hung
         2 cm off its grip, over the front strap). Past the first joint the
         segment instead takes the angle in its bending plane that lays its
         END on a surface without any of it inside one. */
      if (SOL && s >= 1) {
        const cap = (spec.thumbBend ? spec.thumbBend[s] : [0.9, 1.1, 0.9][s]) + 0.3;
        const endGap = function (v) { return sdfT(end(v)) - r1; };
        let e0 = endGap(dd);
        if (e0 > CONTACT * 2 || segGap(a0, end(dd), r0, r1, 0.25, sdfT) < -0.0005) {
          let bestA = null, bestE = Infinity;
          for (let a = -0.8; a <= cap + 1e-6; a += 0.02) {
            const v = rot(a);
            if (segGap(a0, end(v), r0, r1, 0.25, sdfT) < -0.0005) continue;
            const e = Math.abs(endGap(v)) + 0.004 * Math.abs(a - ang);
            if (e < bestE) { bestE = e; bestA = a; }
          }
          if (bestA != null) { dd = rot(bestA); e0 = endGap(dd); }
        }
      }
      d = dd;
      th.push(end(dd));
    }
    contacts.thumb = sdfT(th[3]) - THUMB.r[2] * 0.85;
    /* THE PAD ON THE FAR FLANK (a firing grip, spec.thumbFlank, against the
       finished gun). Curling toward the grip's axis cannot wrap a FAT grip:
       on the Uzi's 4.8 x 5.8 cm magazine-well grip the thumb's root sits
       behind the back strap, the forward aim runs into it, the swing-out
       throws the thumb wide and the pad ended 1.8 cm off the left flank.
       When the curl leaves the pad off the gun, the thumb is instead SOLVED
       onto it: the pad on the far flank just under the top, the tip segment
       laid forward along it, the two proximal segments by the same two-bone
       solve the arms use, the knuckle bulging out and up. Taken only if no
       segment passes through the gun and it lands closer. */
    if (SOL && spec.thumbFlank && (contacts.thumb > 0.004 || contacts.wedged)) {
      const nU = spec.n.dot(P.u) >= 0 ? -1 : 1;                  // the far flank is opposite the back of the hand
      const far = P.u.clone().multiplyScalar(nU), fwdV = P.v.clone();
      if (fwdV.dot(spec.heading) < 0) fwdV.negate();              // forward = where the fingers point
      const rP = THUMB.r[2] * 0.85, L1 = THUMB.seg[0], L2 = THUMB.seg[1], L3 = THUMB.seg[2];
      const r = [THUMB.r[0] * 1.1, THUMB.r[1], THUMB.r[2], rP];
      const poleH = dirH(far.clone().addScaledVector(P.axis, 0.5));
      const T = new THREE.Vector3(), P2 = new THREE.Vector3(), dir = new THREE.Vector3();
      let best = null, bestS = Infinity;
      for (const ta of [-0.012, -0.024, -0.036, -0.048]) {
        for (const tv of [-0.6, -0.3, 0, 0.3, 0.6]) {
          for (const lift of [0, 0.25]) {
            T.copy(P.o).addScaledVector(P.axis, ta * k).addScaledVector(fwdV, tv * (P.hh - P.rc))
              .addScaledVector(far, P.hw + rP * k);
            dir.copy(fwdV).addScaledVector(P.axis, lift).normalize();
            P2.copy(T).addScaledVector(dir, -L3 * k);
            const Th = toH(T), P2h = toH(P2), B = THUMB.base;
            const reach = Math.hypot(P2h[0] - B[0], P2h[1] - B[1], P2h[2] - B[2]);
            if (reach > L1 + L2 - 0.002 || reach < Math.abs(L1 - L2) + 0.004) continue;
            const P1 = solveElbow(B, P2h, poleH, L1, L2);
            const g0 = segGap(B, P1, r[0], r[1], 0.75, sdfT), g1 = segGap(P1, P2h, r[1], r[2], 0.25, sdfT), g2 = segGap(P2h, Th, r[2], r[3], 0.25, sdfT);
            if (Math.min(g0, g1, g2) < -0.001) continue;
            const e = Math.abs(sdfT(Th) - rP), mid = Math.max(0, sdfT(P2h) - r[2] - 0.006);
            const sc = e + 0.5 * mid + 0.2 * Math.max(0, sdfT(P1) - r[1] - 0.010);
            if (sc < bestS) { bestS = sc; best = [B.slice(), P1, P2h, Th]; }
          }
        }
      }
      if (best && (contacts.wedged || bestS < Math.abs(contacts.thumb))) {
        th.length = 0; best.forEach(function (p) { th.push(p); });
        contacts.thumb = sdfT(th[3]) - rP;
        contacts.wedged = 0;
      }
    }
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
    h.userData.graspSpec = spec;
    if (parent) parent.add(h);
    return h;
  }
  /* Re-close a grasped hand's THUMB against the finished gun (solidsOf): the
     gun builders grasp the grip while the gun is still being built, so the
     caller that owns the whole model (fpsmode.fitOffHand) calls this once it
     is complete. The palm and fingers do not move; only the pose changes. */
  function regraspWithSolids(h, root) {
    const spec = h && h.userData.graspSpec;
    if (!spec || !h.parent) return h;
    const sol = solidsOf(root, h.parent);
    if (!sol.length) return h;
    const R = graspOnSolids(spec, sol);
    const G = R.G;
    h.position.copy(G.p);
    h.quaternion.copy(G.q);
    h.userData.grasp = G;
    h.userData.graspSpec = R.spec;
    h.userData.pose = G.pose;
    h.geometry = handGeometry(G.side, G.pose);
    return h;
  }
  /* graspOnSolids(spec, solids): the grasp re-closed on the whole drawn gun
     (fingers and thumb on the solids round the held part). A hand pushed so
     high that the root of its thumb is buried in the frame / the stock's
     wrist above the grip comes down the grip until it is not, and its pad
     lies on the gun (tried every 3 mm down to 3 cm; the index re-solves onto
     the trigger) — but never so far that a finger slips off the bottom of a
     short grip and hangs in the air. Returns { G, spec } (the spec it used). */
  function graspOnSolids(spec, sol) {
    const s2 = Object.assign({}, spec, { solids: sol, fingersOnSolids: true, thumbFlank: true, name: (spec.name || "g") + "+solids", at: spec.at.clone() });
    let G = grasp(s2);
    if (G.contacts.wedged || Math.abs(G.contacts.thumb) > 0.004) {
      const down = spec.prism.axis.clone().normalize().multiplyScalar(-0.003 * spec.k);
      const hangs = function (g) { return g.contacts.tips.some(function (t) { return t != null && t > 0.008; }); };
      const cost = function (g, i) {
        return (g.contacts.wedged ? 0.02 : 0) + Math.abs(g.contacts.thumb) + 0.0005 * i + (hangs(g) ? 0.05 : 0);
      };
      const at0 = s2.at.clone();
      let best = G, bestI = 0, bestC = cost(G, 0);
      for (let i = 1; i <= 10; i++) {
        s2.at.copy(at0).addScaledVector(down, i);
        const g2 = grasp(s2), c = cost(g2, i);
        if (c < bestC) { best = g2; bestC = c; bestI = i; }
      }
      s2.at.copy(at0).addScaledVector(down, bestI);
      G = best;
    }
    return { G: G, spec: s2 };
  }

  /* ==== THE GUN'S GRIPS: ONE RECIPE, BOTH VIEWS ============================
     Owner: "the way they look in third person and first person should look
     the same." The hand down your lens closed on the gun's REAL grip (the
     grasp: palm flush, fingers curled until they touch, the index pad on the
     trigger, the thumb on the frame); a body in third person held the same
     gun with a TABLE pose (trigNN: a fixed curl of the nearest radius, the
     index laid along the frame) oriented by a separate frame solve. Two
     answers to one question. These build the grasp specs both views solve:
     the gun kit's firing hand and fpsmode's off hand (first person), and
     CBZ.gunHold's body hands (third person, actorweapons.js) — so a man
     across the yard holds his pistol with exactly the hand you see down your
     own sights, only at the body LOD.

     fireGraspSpec(h, k): the firing hand on a kit grip h ({at, rake, gripW,
       gripD, trigger, heading, thumbAim, thumbAim2}, model units) at k model
       units per hand metre. The palm lies flush on the right panel with the
       web as high as the tang allows, the index knuckle within a finger's
       reach of the trigger (4.5-7.2 cm), three fingers round the front strap,
       the index pad on the trigger's face, the thumb round the back strap and
       forward along the left flank.
     supportGraspSpec(hold, k, fire): the off hand on userData.grips.hold
       (guard: cupped under a handguard / pump, yawed, fingers up the far
       side, thumb forward along the near side; vgrip: wrapped round a
       vertical foregrip) or, hold undefined and `fire` the firing grasp, the
       thumbs-forward cup over a pistol's firing fist. null = no off hand. */
  /* THE HAND RIDES HIGH ON A GRIP AND THE FOREARM RUNS INTO IT. The palm's
     long axis (wrist -> middle knuckle) was laid square across the grip
     (`fwd`, perpendicular to the grip's rake), i.e. pointing forward and
     DOWN by the rake: its straight-wrist line ran back and UP from the grip,
     at the shooter's eye, and any real arm reaching the gun from a shoulder
     below it met the hand 40-50 degrees off that line (the sleeve's end
     stood in front of the hand). On a real grip the heel of the hand sits
     low on the backstrap and the knuckles high on the front strap: wrist ->
     knuckle points forward and a little UP, and the forearm leaves the grip
     back and DOWN toward the elbow. The palm's axis now points forward and
     up by GRIP_RISE (rise over run, ~19 degrees) whatever the grip's rake,
     so the forearm can arrive along it from a real shoulder below the gun;
     a builder's own `heading` (the shotgun's steep wrist) still wins. */
  const GRIP_RISE = 0.35;
  function fireGraspSpec(h, k) {
    // the highest wrist line (GRIP_RISE down in 0.1 steps) whose index still
    // reaches the trigger face: a short-reach trigger (the taser's) takes the
    // hand a little flatter rather than leaving the pad off the blade
    // (a builder's own heading — the shotgun's steep wrist — is kept as asked)
    let spec = null, best = null;
    const tries = h.heading ? [0] : [0, -0.1, -0.2, -0.3, -0.4, -0.5];
    for (let t = 0; t < tries.length; t++) {
      const rise = (h.heading ? 0 : GRIP_RISE) + tries[t];
      spec = fireGraspAt(h, k, rise);
      if (!h.trigger) break;
      const c = grasp(spec).contacts.trigger;
      if (c != null && (!best || c < best.c)) best = { c: c, spec: spec, rise: rise };
      if (c != null && c <= 0.009) break;
    }
    if (!best || best.c <= 0.009) return spec;
    /* STILL SHORT OF THE TRIGGER (a straight stock's wrist set back from the
       guard, or a small hand on any grip): the hand comes forward round
       the grip, at the same height, 3 mm at a time and no more than 2.4 cm,
       until the pad is on the blade. A real hand does the same: it takes the
       grip wherever its trigger finger reaches. */
    const rise = best.rise;
    for (let i = 1; i <= 8; i++) {
      const d = 0.003 * k * i;
      const h2 = Object.assign({}, h, { at: [h.at[0], h.at[1] - d] });
      const s2 = fireGraspAt(h2, k, rise), c = grasp(s2).contacts.trigger;
      if (c != null && c < best.c) best = { c: c, spec: s2, rise: rise };
      if (c != null && c <= 0.006) break;
    }
    return best.spec;
  }
  function fireGraspAt(h, k, rise) {
    const R = h.rake || 0;
    const axis = new THREE.Vector3(0, Math.cos(R), -Math.sin(R));       // up the grip
    const u = new THREE.Vector3(1, 0, 0);
    const fwd = new THREE.Vector3().crossVectors(axis, u);               // front strap side
    const top = new THREE.Vector3(0, h.at[0], h.at[1]);
    const prism = { o: top, axis: axis, u: u, hw: h.gripW * 0.5, hh: h.gripD * 0.5, rc: Math.min(h.gripW, h.gripD) * 0.22 };
    // the pad presses the FRONT face of the blade
    const trig = h.trigger ? new THREE.Vector3(0, h.trigger[0], h.trigger[1] - 0.007) : null;
    const hhM = h.gripD * 0.5 / k;
    const spec = {
      side: 1, k: k, prism: prism, name: "fire:" + [h.at, R.toFixed(3), h.gripW, h.gripD, h.trigger, k.toFixed(3)].join("/"),
      n: new THREE.Vector3().copy(u).addScaledVector(fwd, -0.22),           // back of the hand out, a touch rearward
      // fingers across the front strap; a steep stock wrist (the shotgun) is
      // taken diagonally, fingers along the bore, the way a hand really
      // closes on it (square to it the forearm would point at your eye)
      heading: h.heading ? new THREE.Vector3(h.heading[0], h.heading[1] + rise, h.heading[2])
        : new THREE.Vector3(0, rise, -1).normalize(),
      palm: [0, -PALM.th * 0.5, -(0.096 - hhM - 0.004)],                 // knuckles just past the front strap
      trigger: trig,
      // the thumb: round the back strap, then forward along the left of the
      // frame, riding high (the modern thumbs-forward grip); a builder may
      // aim it itself (a straight stock's thumb goes over the top of the
      // wrist and forward down the far flank, not up the grip)
      thumbAim: h.thumbAim ? new THREE.Vector3(h.thumbAim[0], h.thumbAim[1], h.thumbAim[2])
        : new THREE.Vector3().copy(u).negate().addScaledVector(fwd, -0.35).addScaledVector(axis, 0.10),
      thumbAim2: h.thumbAim2 ? new THREE.Vector3(h.thumbAim2[0], h.thumbAim2[1], h.thumbAim2[2]) : new THREE.Vector3(-0.30, 0.10, -1),
      at: top.clone(),
    };
    /* Slide the hand along the grip. The web goes as HIGH as the grip allows
       (the thumb-side edge of the palm, web or index knuckle, whichever a
       diagonal hold lifts higher, stays just under the top) and comes down
       only as far as the trigger needs: the index knuckle within a finger's
       reach of the pad (4.5-7.2 cm). Sliding moves every point of the hand
       1:1 along the axis, so one grasp measures the whole family and the
       search is arithmetic. */
    let t = -0.045 * k;
    spec.at.copy(top).addScaledVector(axis, t);
    const G = grasp(spec);
    const idx0 = G.toM([FINGERS[0].x, 0, FINGERS[0].z]).clone();
    const hi0 = Math.max(G.toM([-PALM.hw, 0, -0.030]).clone().sub(top).dot(axis),
      G.toM([-PALM.hw * 0.8, 0, -0.090]).clone().sub(top).dot(axis));
    const tMax = t + (-0.004 * k - hi0);
    let best = tMax;
    if (trig) {
      let bestC = Infinity;
      for (let tt = tMax; tt > tMax - 0.10 * k; tt -= 0.002 * k) {
        const d = idx0.clone().addScaledVector(axis, tt - t).distanceTo(trig) / k;
        if (d >= 0.045 && d <= 0.072) { best = tt; break; }        // the highest hold that reaches
        const c = Math.max(0.045 - d, d - 0.072);
        if (c < bestC) { bestC = c; best = tt; }
      }
    }
    spec.at.copy(top).addScaledVector(axis, best);
    return spec;
  }
  // the thumbs-forward support hand (supportGraspSpec, the cup): see there
  const FINGER_CONVERGE = 0.16;             // rad between neighbouring closed fingers (grasp)
  // the support fingers' dip below the bore line (rad); the palm's middle below
  // the grip top (hand metres); the back of the hand's tilt down. The cant is
  // what a cammed wrist gives a forearm rising from a LOW elbow (ulnar <= 40
  // degrees, fpsmode armSolve keeps the elbow down and out): 0.35, not the
  // 0.62 that only an elbow at eye level could reach
  const CUP_CANT = 0.35, CUP_AT = 0.040, CUP_NDOWN = -0.40, CUP_THUMB_UP = 0.06;
  /* The support hand under a handguard: the back of the hand turned a
     little OUT to the left (GUARD_NX +0.3, was -0.3) and the palm's axis
     raked a little down the guard (GUARD_RISE -0.3, was +0.18), so the
     forearm that reaches it from the left shoulder meets the hand inside a
     wrist's range: ulnar deviation 44 -> 30 degrees at worst down the
     sights, extension under 40 (fpsmode wristOf, measured on every long gun
     in the jail at the hip and down the sights). */
  const GUARD_YAW = 0.62, GUARD_NX = 0.30, GUARD_RISE = -0.30;
  // the firing fingers' thickness the cup closes over (hand metres; 2.0 cm
  // left the support fingers 8 mm inside the firing fingers once the hand
  // was drawn at its real size on the pistols)
  const CUP_E = 0.026;
  // o (optional): { yaw, nx, rise } overrides for the hand's lay on the part
  // (a hold record may carry its own: hold.yaw / hold.nx / hold.rise)
  function supportGraspSpec(hold, k, fire, o) {
    const V = function (x, y, z) { return new THREE.Vector3(x, y, z); };
    o = o || {};
    const pick = function (key, d) { return o[key] != null ? o[key] : (hold && hold[key] != null ? hold[key] : d); };
    if (hold && hold.kind === "guard") {
      // cupped under the handguard, yawed: fingers up the far side and forward
      const yaw = pick("yaw", GUARD_YAW);
      return {
        side: -1, k: k, name: "guard:" + [hold.y, hold.z, hold.w, hold.h].join("/") + ":" + k.toFixed(3), kind: "guard",
        prism: { o: V(0, hold.y, hold.z), axis: V(0, 0, -1), u: V(1, 0, 0), hw: hold.w / 2, hh: hold.h / 2, rc: hold.rc, hl: hold.len ? hold.len / 2 : Infinity },
        n: V(pick("nx", GUARD_NX), -1, 0),
        heading: V(Math.cos(yaw), pick("rise", GUARD_RISE), -Math.sin(yaw)),
        // a touch behind the part's middle: the elbow stays bent under the gun
        at: V(0, hold.y, hold.z + (hold.slide == null ? 0.03 : hold.slide)),
        palm: [0.004, -PALM.th * 0.5, -0.056],
        thumbAim: V(-0.10, 0.22, -1),
        thumbBend: [0.9, 0.7, 0.5],
      };
    }
    if (hold && hold.kind === "vgrip") {
      const ax = V(0, Math.cos(hold.rake || 0), -Math.sin(hold.rake || 0));
      const u = V(1, 0, 0), fwd = new THREE.Vector3().crossVectors(ax, u);
      const top = V(0, hold.y, hold.z);
      return {
        side: -1, k: k, name: "vgrip:" + [hold.y, hold.z, hold.w, hold.d].join("/") + ":" + k.toFixed(3), kind: "vgrip",
        prism: { o: top, axis: ax, u: u, hw: hold.w / 2, hh: hold.d / 2, rc: Math.min(hold.w, hold.d) * 0.22 },
        n: u.clone().negate().addScaledVector(fwd, -0.22),
        heading: fwd.clone(),
        at: top.clone().addScaledVector(ax, -0.050 * k),
        palm: [0, -PALM.th * 0.5, -(0.096 - hold.d * 0.5 / k - 0.004)],
        thumbAim: u.clone().addScaledVector(fwd, -0.35).addScaledVector(ax, 0.10),
      };
    }
    if (hold || !fire || !fire.prism) return null;
    /* THUMBS FORWARD ON A PISTOL, the way a shooter really holds it (gun
       frame: bore -Z, +Y up, +X the shooter's right). The support palm's heel
       presses the bare LEFT panel, palm facing +X into the grip; the four
       fingers leave the knuckles FORWARD and ~40 degrees DOWN (the support
       wrist cammed forward), pass in front of the front strap right under
       the trigger guard and wrap to the RIGHT over the firing hand's lower
       three fingers, together, all four in one curl, tips finishing on the
       right side over the firing knuckles; the thumb lies forward along the
       left of the frame under the slide. (The last version raised the palm's
       axis UP the grip: an open claw standing beside the slide at sight
       height.) The part it closes on is the firing grip grown by what the
       firing hand puts there: its fingers on the front strap and wrapped to
       the right side (CUP_E), only a thumb's skin on the bare left panel. */
    const P = fire.prism, e = CUP_E * k, eL = 0.004 * k;
    const cant = pick("cant", CUP_CANT);
    const o2 = P.o.clone().addScaledVector(P.u, (e - eL) * 0.5);       // grown more to the right than the left
    return {
      side: -1, k: k, name: "cup:" + (fire.pose && fire.pose.name) + ":" + cant.toFixed(2), kind: "cup",
      prism: { o: o2, axis: P.axis.clone(), u: P.u.clone(), hw: P.hw + (e + eL) * 0.5, hh: P.hh + e * 0.8, rc: P.rc + eL },
      // the back of the hand faces out to the left, a touch down
      n: V(-1, pick("nDown", CUP_NDOWN), 0),
      // the fingers' line: forward and down
      heading: V(0, -Math.sin(cant), -Math.cos(cant)),
      // the palm's middle level with the firing hand's middle finger, just
      // under the trigger guard
      at: P.o.clone().addScaledVector(P.axis, -pick("at", CUP_AT) * k),
      palm: [0.006, -PALM.th * 0.5, -0.050],
      // the thumb: forward along the FRAME, just under the slide (it was aimed
      // forward and down, and lay beside the trigger guard's window, 2 cm low)
      thumbAim: V(0.10, pick("thumbUp", CUP_THUMB_UP), -1),
      thumbAim2: V(0.05, pick("thumbUp", CUP_THUMB_UP), -1),
      together: true,
    };
  }
  /* A solved grasp as a named pose, so a BODY hand (character.js setHandPose
     takes POSES names; bodyHandGeometry caches per name and LOD, pedinstance
     pools by geometry) can wear exactly the fingers a grasp closed. Named by
     its content: the same grasp is the same pose, the same cached geometry.
     stub 0: a gun hold hangs at the crease and bends the wrist. */
  function registerPose(pose) {
    const name = "g:" + poseKey(pose);
    if (!POSES[name]) POSES[name] = { joints: pose.joints, cup: pose.cup, stub: 0, name: name };
    return name;
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

  // ------------------------------------------------------------ THE TORCH GRIP
  /* A hand torch is a ~3 cm tube held in the REVERSE (ice-pick / Harries)
     fist: all four fingers wrap the body, the lens comes out of the LITTLE-
     FINGER side, the tail cap sits just past the index knuckle and the
     thumb rests over the tail switch, ready to click it. This is the one
     hold that lets the thumb reach a tail switch and still leaves the beam
     free of the hand.

     Hand frame (right hand): the torch axis runs along the hand's X, lens
     toward +X (the little finger), tail toward -X; its centre is exactly
     gripCentre("torch") — the same point every other wrap pose closes on.
       · the fingers are a GRASP (curl-until-contact) on that cylinder, sized
         by the tube's real radius, cut off at the tail face;
       · the thumb cannot be a grasp: the grasp bends a thumb toward the part's
         (infinite) axis and so can only lay it along a side, never on an end
         face. Its pad is put ON the tail switch with the same two-bone solve
         the arms use (math.solveElbow), knuckle bulging out and up, the tip
         segment pressing along +X into the switch.
     torchMount() is placeGrip() inverted: where a torch goes in a hand's
     frame so its handle sits in that hand's grip. */
  const TORCH = { R: 0.015, tailX: -0.050, headX: 0.045, padR: 0.0085 };
  const _tmO = new THREE.Object3D(), _tmM = new THREE.Matrix4(), _tmS = new THREE.Vector3();
  const _tmA = new THREE.Vector3(), _tmUp = new THREE.Vector3(0, 1, 0);
  (function buildTorchPose() {
    const R = TORCH.R;
    const gc = [-0.006, -(PALM.th * 0.5 + R), FINGERS[1].z + 0.012];
    const G = grasp({
      side: 1, k: 1, name: "torch",
      prism: {
        o: new THREE.Vector3((TORCH.tailX + TORCH.headX) / 2, gc[1], gc[2]),
        axis: new THREE.Vector3(1, 0, 0), u: new THREE.Vector3(0, 1, 0),
        hw: R, hh: R, rc: R, hl: (TORCH.headX - TORCH.tailX) / 2,
      },
      n: new THREE.Vector3(0, 1, 0), heading: new THREE.Vector3(0, 0, -1),
      // the palm's contact point directly over the axis, so the solved wrist
      // lands on the hand's own origin (identity frame, p = 0)
      at: new THREE.Vector3(gc[0], gc[1], gc[2]),
      palm: [gc[0], -PALM.th * 0.5, gc[2]],
      cup: 0.006,
    });
    // THE THUMB ON THE SWITCH: pad centre one pad-radius off the tail face
    const T = [TORCH.tailX - TORCH.padR, gc[1] + 0.002, gc[2]];
    const d3 = [0.55, -0.10, -0.83], dl = Math.hypot(d3[0], d3[1], d3[2]);
    const P2 = [T[0] - d3[0] / dl * THUMB.seg[2], T[1] - d3[1] / dl * THUMB.seg[2], T[2] - d3[2] / dl * THUMB.seg[2]];
    const B = THUMB.base.slice();
    const P1 = solveElbow(B, P2, [-1, 0.35, 0.1], THUMB.seg[0], THUMB.seg[1]);
    const pose = { name: "torch", wrap: R, cup: 0.006, joints: { fingers: G.pose.joints.fingers, thumb: [B, P1, P2, T] } };
    pose.contacts = { tips: G.contacts.tips.slice(), thumb: T };
    POSES.torch = pose;
  })();
  /* torchMount(side, handle, outPos, outQ): the local transform (hand frame,
     hand metres) that seats a torch model whose handle is `handle` =
     { center: Vector3, axis: Vector3 (tail -> lens) } in the model's own
     metres. Parent the model to the hand and apply these: the handle's centre
     lands on the torch grip's centre, the lens out of the little-finger side. */
  function torchMount(side, handle, outPos, outQ) {
    _tmO.userData.side = side < 0 ? -1 : 1;
    _tmA.copy(handle.axis).negate();                      // the thumb side points at the tail
    placeGrip(_tmO, { pose: "torch", center: handle.center, axis: _tmA, dorsal: _tmUp, scale: 1 });
    _tmO.updateMatrix();
    _tmM.copy(_tmO.matrix).invert().decompose(outPos, outQ, _tmS);
    return outPos;
  }

  // ------------------------------------------------------------ dress
  function readHex(list) {
    if (!list) return null;
    const a = Array.isArray(list) ? list : [list];
    for (let i = 0; i < a.length; i++) {
      const o = a[i];
      const m = o && (o.material || o);
      const mm = Array.isArray(m) ? m[0] : m;
      if (mm && mm.color && (!mm.map || (mm.userData && mm.userData.cbzInk))) return mm.color.getHex();
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
    POSES, PALM, FINGERS, THUMB, PLANT_CONTACT, CARD_PINCH,
    handGeometry, bodyHandGeometry, makeHand, setPose, attachGrip, placeGrip, gripCentre, contactOf,
    orientGrip, orientAlong, makeArm, poseArm, dressOf, resolvePose,
    bodyArmLens, bodyHandK, bodyTwin, bodyHandMaterial, bodyArmSource, bodyShoulder,
    grasp, graspHand, regraspWithSolids, graspOnSolids, fireGraspSpec, supportGraspSpec, registerPose,
    solidsOf, solidsSdf, prismSdf, holdPose, HOLD_RADII, TORCH, torchMount,
    math: { solveElbow, flexForWrap, fingerChain, segDist, clampFore, foreHalf, stubRings },
    WRIST, STUB_LATHE, FORE_NOM, FORE_DOME, CUFF_PROFILE,
    ELBOW: { R: ELBOW_R, W: ELBOW_W, H: ELBOW_H }, UPPER_R0, UPPER_R1,
    _geo: { upperGeo, elbowGeo, foreGeo },
  };
})();
