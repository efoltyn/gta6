/* ============================================================
   entities/verbposes.js — THE BODIES OF A TWO-PERSON VERB.

   CBZ.verbPoses holds what both people LOOK like while one of them has his
   hands on the other: the grabber's bladed wide base with the hips dropped
   and the weight leaning against the load, and the target up on his toes
   leaning back from a collar grip, bent at the waist while he is cuffed,
   draped over a shoulder when carried, heels dragging when dragged, sagging
   in a choke, stiff and up against a gunman as a shield.

   It writes ABSOLUTE joint values on top of whatever animChar produced this
   frame, damped toward the pose per frame (frame-rate independent), with a
   per-channel-group weight so a verb can own the arms and leave the walk
   cycle's legs alone (an escort walks; a man bracing a collar grab does not).
   Hands are NOT placed here: systems/verbs.js solves them onto the partner's
   contact points with CBZ.charArmTo right after this writes the base pose,
   and then CBZ.lockCharacterHips re-solves the shared hip socket.

   Rig conventions it is written against (entities/character.js):
     facing +z. Negative rotation.x on a hip/shoulder swings the limb FORWARD.
     Knees fold backward only (x >= 0), elbows forward only (x <= 0).
     parts.la sits at +X and is the anatomical LEFT arm; parts.ll sits at -X
     and is the anatomical RIGHT leg (the arms were mirrored for the chase
     camera, the legs were not). Every "L"/"R" in this file is ANATOMICAL:
     L = +X side. The leg helpers translate.
     body pivots at the feet and is re-solved about the hip by
     lockCharacterHips; the legs are siblings of body under `model`, so a hip
     DROP is a model translation with the legs re-solved to keep the feet
     planted (legTo below), never a body squash.

   Zero allocation on the hot path: every rig carries one small state record
   with two Float32Arrays, built the first time it is posed.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;

  // ---- channels ---------------------------------------------------------
  const DROP = 0,                                   // metres the hips sink (legs group)
    B_RX = 1, B_RY = 2, B_RZ = 3, B_PY = 4,         // body (torso) group
    N_RX = 5, N_RY = 6, N_RZ = 7,
    LA_RX = 8, LA_RY = 9, LA_RZ = 10, LA_PZ = 11, LA_E = 12,   // la = anatomical left arm
    RA_RX = 13, RA_RY = 14, RA_RZ = 15, RA_PZ = 16, RA_E = 17, // ra = anatomical right arm
    LL_RX = 18, LL_RY = 19, LL_RZ = 20, LL_K = 21,             // ll = anatomical RIGHT leg
    RL_RX = 22, RL_RY = 23, RL_RZ = 24, RL_K = 25,             // rl = anatomical LEFT leg
    NCH = 26;
  // channel groups and their mask bits
  const G_BODY = 1, G_ARML = 2, G_ARMR = 4, G_LEGS = 8, G_ALL = 15;
  // THE MOUNT (the tackler kneeling on top of the man he took down): the
  // whole-body lean the engine gives the group, the torso's own lean on top of
  // it, how wide the knees go, and how far up his body the hips sit (a share
  // of hip->shoulder). verbs.js places the body by the same numbers.
  const MOUNT = { pitch: 0.45, torso: 0.65, spread: 0.55, along: 0.15 };   // swept in plain node: hands on, 7 cm clear
  // THE FIREMAN CARRY: how far his torso folds down the carrier's back, the
  // whole-body pitch over the shoulder, and where on the shoulder his belt sits
  // (metres back of / above the shoulder top). verbs.js places him by it.
  const CARRY = { fold: 0.9, pitch: 1.6, back: 0.26, up: 0.03, lean: 0.25 };
  function groupOf(c) {
    if (c === DROP) return 3;
    if (c <= N_RZ) return 0;
    if (c <= LA_E) return 1;
    if (c <= RA_E) return 2;
    return 3;
  }
  const GROUP = new Uint8Array(NCH);
  for (let c = 0; c < NCH; c++) GROUP[c] = groupOf(c);

  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const smooth = (v) => { v = clamp01(v); return v * v * (3 - 2 * v); };
  const lerp = (a, b, t) => a + (b - a) * t;
  const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

  function scaleOf(ch) {
    const g = ch && ch.group;
    const hs = g && g.userData && g.userData.humanScale;
    if (hs > 0) return hs;
    return (ch && ch.model && ch.model.scale && ch.model.scale.x) || 1;
  }

  // ---- per-rig state ----------------------------------------------------
  function state(ch) {
    let s = ch._vp;
    if (s) return s;
    s = ch._vp = {
      cur: new Float32Array(NCH),       // the damped pose
      tgt: new Float32Array(NCH),       // this frame's pose target
      w: new Float32Array(4),           // live group weights
      wt: new Float32Array(4),          // target group weights
      rate: 10,
      drop: 0,                          // model translation this layer has applied (m)
      name: null, active: false, stamp: 0,
    };
    return s;
  }

  function readRig(ch, s, a) {
    const b = ch.body, n = ch.neck, P = ch.parts || {}, L = ch.low || {};
    a[DROP] = s.drop;
    if (b) { a[B_RX] = b.rotation.x; a[B_RY] = b.rotation.y; a[B_RZ] = b.rotation.z; a[B_PY] = b.position.y - (ch._hipCompY || 0); }
    if (n) { a[N_RX] = n.rotation.x; a[N_RY] = n.rotation.y; a[N_RZ] = n.rotation.z; }
    if (P.la) { a[LA_RX] = P.la.rotation.x; a[LA_RY] = P.la.rotation.y; a[LA_RZ] = P.la.rotation.z; a[LA_PZ] = P.la.position.z; }
    if (L.la) a[LA_E] = L.la.rotation.x;
    if (P.ra) { a[RA_RX] = P.ra.rotation.x; a[RA_RY] = P.ra.rotation.y; a[RA_RZ] = P.ra.rotation.z; a[RA_PZ] = P.ra.position.z; }
    if (L.ra) a[RA_E] = L.ra.rotation.x;
    if (P.ll) { a[LL_RX] = P.ll.rotation.x; a[LL_RY] = P.ll.rotation.y; a[LL_RZ] = P.ll.rotation.z; }
    if (L.ll) a[LL_K] = L.ll.rotation.x;
    if (P.rl) { a[RL_RX] = P.rl.rotation.x; a[RL_RY] = P.rl.rotation.y; a[RL_RZ] = P.rl.rotation.z; }
    if (L.rl) a[RL_K] = L.rl.rotation.x;
  }
  const _base = new Float32Array(NCH);
  // out = base + (cur - base) * w[group]
  function writeRig(ch, s) {
    readRig(ch, s, _base);
    const c = s.cur, w = s.w, o = _base;
    for (let i = 0; i < NCH; i++) {
      const wi = w[GROUP[i]];
      if (wi > 0.0005) o[i] = o[i] + (c[i] - o[i]) * wi;
    }
    const b = ch.body, n = ch.neck, P = ch.parts || {}, L = ch.low || {};
    if (w[0] > 0.0005 && b) {
      b.rotation.x = o[B_RX]; b.rotation.y = o[B_RY]; b.rotation.z = o[B_RZ];
      // absolute body height: strip the hip compensation, write, re-lock
      b.position.x -= ch._hipCompX || 0; b.position.z -= ch._hipCompZ || 0;
      b.position.y = o[B_PY];
      ch._hipCompX = ch._hipCompY = ch._hipCompZ = 0;
    }
    if (w[0] > 0.0005 && n) { n.rotation.x = o[N_RX]; n.rotation.y = o[N_RY]; n.rotation.z = o[N_RZ]; }
    if (w[1] > 0.0005) {
      if (P.la) { P.la.rotation.set(o[LA_RX], o[LA_RY], o[LA_RZ]); P.la.position.z = o[LA_PZ]; }
      if (L.la) { L.la.rotation.x = Math.min(0.02, o[LA_E]); L.la.rotation.y = 0; L.la.rotation.z = 0; }
    }
    if (w[2] > 0.0005) {
      if (P.ra) { P.ra.rotation.set(o[RA_RX], o[RA_RY], o[RA_RZ]); P.ra.position.z = o[RA_PZ]; }
      if (L.ra) { L.ra.rotation.x = Math.min(0.02, o[RA_E]); L.ra.rotation.y = 0; L.ra.rotation.z = 0; }
    }
    if (w[3] > 0.0005) {
      if (P.ll) { P.ll.rotation.set(o[LL_RX], o[LL_RY], o[LL_RZ]); P.ll.scale.y = 1; }
      if (L.ll) { L.ll.rotation.x = Math.max(0, o[LL_K]); L.ll.rotation.y = 0; L.ll.rotation.z = 0; }
      if (P.rl) { P.rl.rotation.set(o[RL_RX], o[RL_RY], o[RL_RZ]); P.rl.scale.y = 1; }
      if (L.rl) { L.rl.rotation.x = Math.max(0, o[RL_K]); L.rl.rotation.y = 0; L.rl.rotation.z = 0; }
    }
    // HIP DROP: a model translation, delta-tracked so it is refunded exactly
    // when the layer lets go (the same bookkeeping animChar's koLift uses).
    const want = w[3] > 0.0005 ? o[DROP] * w[3] : 0;
    if (ch.model && (want !== s.drop)) {
      ch.model.position.y += s.drop - want;
      s.drop = want;
    }
    if (CBZ.lockCharacterHips) CBZ.lockCharacterHips(ch);
  }

  /* ---- LEG IK: put this foot there, knee forward --------------------------
     Solves thigh (x, z) + knee (x) so the shin's end lands on a target given
     in the MODEL frame relative to the leg's hip root. Rotation order is
     three.js XYZ (Rz applied first to the limb, then Rx), the same closed
     form charArmTo uses for the shoulder. */
  const _leg = { rx: 0, rz: 0, k: 0 };
  function legSolve(ch, fx, fy, fz) {
    const P = ch.profile;
    const L1 = Math.max(0.12, (P ? P.legUp : 0.48) - 0.02);
    const L2 = Math.max(0.12, P ? P.legLo : 0.47);
    let d = Math.hypot(fx, fy, fz);
    const maxR = (L1 + L2) * 0.9995, minR = Math.abs(L1 - L2) + 0.08;
    if (d > maxR) { const k = maxR / d; fx *= k; fy *= k; fz *= k; d = maxR; }
    else if (d < minR) { const k = minR / Math.max(1e-4, d); fx *= k; fy *= k; fz *= k; d = minR; }
    const cosB = Math.max(-1, Math.min(1, (d * d - L1 * L1 - L2 * L2) / (2 * L1 * L2)));
    const b = Math.acos(cosB);                          // knee flex, >= 0
    const uy = -L1 - L2 * Math.cos(b), uz = -L2 * Math.sin(b);
    const sinZ = Math.max(-0.999, Math.min(0.999, fx / -uy));
    const rz = Math.asin(sinZ);
    const rx = wrap(Math.atan2(fz, fy) - Math.atan2(uz, uy * Math.cos(rz)));
    _leg.rx = rx; _leg.rz = rz; _leg.k = b;
    return _leg;
  }
  /* STANCE: both feet planted on the ground under a hip DROP (metres).
     lz/rz = how far each ANATOMICAL foot sits forward (+) or back (-) of its
     hip, lw/rw = how far outward, all in metres. */
  function stance(ch, T, drop, lz, lw, rzz, rw) {
    const P = ch.profile;
    const s = scaleOf(ch);
    const hipY = ch.hipY || ((P ? P.legUp + P.legLo : 0.95));
    const fy = -(hipY - 0.02) + drop / s;
    // anatomical LEFT = parts.rl at +X (outward = +X)
    let r = legSolve(ch, lw / s, fy, lz / s);
    T[RL_RX] = r.rx; T[RL_RY] = 0; T[RL_RZ] = r.rz; T[RL_K] = r.k;
    // anatomical RIGHT = parts.ll at -X (outward = -X)
    r = legSolve(ch, -rw / s, fy, rzz / s);
    T[LL_RX] = r.rx; T[LL_RY] = 0; T[LL_RZ] = r.rz; T[LL_K] = r.k;
    T[DROP] = drop;
  }
  // free legs (not planted): anatomical left / right thigh + knee
  function legs(T, lx, lk, rx, rk, spread) {
    T[RL_RX] = lx; T[RL_RY] = 0; T[RL_RZ] = spread || 0; T[RL_K] = Math.max(0, lk);
    T[LL_RX] = rx; T[LL_RY] = 0; T[LL_RZ] = -(spread || 0); T[LL_K] = Math.max(0, rk);
    T[DROP] = 0;
  }
  // anatomical arm writes: side +1 = left (la, +X), -1 = right (ra, -X).
  // `out` is ABDUCTION (positive = away from the body) so both sides read alike.
  function arm(T, side, x, out, e, y, pz) {
    if (side > 0) { T[LA_RX] = x; T[LA_RY] = y || 0; T[LA_RZ] = out; T[LA_PZ] = pz || 0; T[LA_E] = e; }
    else { T[RA_RX] = x; T[RA_RY] = -(y || 0); T[RA_RZ] = -out; T[RA_PZ] = pz || 0; T[RA_E] = e; }
  }
  function torso(T, rx, ry, rz, py) { T[B_RX] = rx; T[B_RY] = ry || 0; T[B_RZ] = rz || 0; T[B_PY] = py || 0; }
  function head(T, rx, ry, rz) { T[N_RX] = rx; T[N_RY] = ry || 0; T[N_RZ] = rz || 0; }
  // arms that hang where they are until the contact solve takes them
  function armsReady(T, fwd) {
    arm(T, 1, -0.7 - (fwd || 0), 0.12, -0.9);
    arm(T, -1, -0.7 - (fwd || 0), 0.12, -0.9);
  }

  /* ONE KNEE ON A MAN'S BACK (a.kneelCuff). p.knee = where the knee goes, in
     the officer's GROUP frame (metres: x his left, y up from his feet, z
     ahead); p.kneeSide which leg (+1 anatomical left). The hip height is the
     one that lets THIS thigh just reach that knee from straight behind it;
     the shin goes back and down off the knee to the floor; the other foot
     is planted beside and back (a lunge, clear of his flank). Both legs are this body's own
     two-bone solve (legSolve), so a child's and a heavy man's knees land. */
  const _kn = new Float32Array(NCH);
  // (swept in plain node against the shaped torso of every physique pair:
  // hands on the wrists within 1.2 cm, no leg or torso inside him)
  const KNEEL = { reach: 0.96, bend: 1.25, head: 0.30, plantOut: 0.05, plantFwd: -0.25, shin: 0.2 };
  function kneelOnBack(ch, T, p) {
    const P = ch.profile || {}, s = scaleOf(ch);
    const hipY = ch.hipY || ((P.legUp || 0.48) + (P.legLo || 0.47));
    const hx = P.hipX || 0.2;
    const L1 = Math.max(0.12, (P.legUp || 0.48) - 0.02) * s, L2 = Math.max(0.12, P.legLo || 0.47) * s;
    const side = p.kneeSide >= 0 ? 1 : -1;
    const K = p.knee;
    const hipXm = hx * s * side;
    const dx = K.x - hipXm, dz = K.z;
    const reach = L1 * KNEEL.reach;
    let H = K.y + Math.sqrt(Math.max(0.0025, reach * reach - dx * dx - dz * dz));
    H = Math.max(0.30, Math.min(hipY * s - 0.04, H));
    const drop = hipY * s - H;
    /* the knee leg, AIMED (a two-bone foot solve goes unstable this folded):
       the thigh straight from the hip at the knee point, and the shin laid
       back along his back off that knee, KNEEL.shin radians below level. The
       rig's thigh hangs along -Y and turns Rx(rx)·Rz(rz) (three's XYZ order):
       (0,-1,0) -> (sin rz, -cos rz cos rx, -cos rz sin rx). The knee folds
       the shin back (-Z in the thigh's frame) by its flex. */
    const vx = K.x - hipXm, vy = K.y - H, vz = K.z, vl = Math.hypot(vx, vy, vz) || 1;
    const dx0 = vx / vl, dy0 = vy / vl, dz0 = vz / vl;
    const kz = Math.asin(Math.max(-0.99, Math.min(0.99, dx0)));
    const kx = Math.atan2(-dz0, -dy0);
    const sa = KNEEL.shin;
    const kk = Math.acos(Math.max(-1, Math.min(1, -dy0 * Math.sin(sa) - dz0 * Math.cos(sa))));
    let r;
    // the planted foot: out and back of its hip (a lunge), flat on the floor
    const fyP = -(hipY - 0.02) + drop / s;
    r = legSolve(ch, -side * KNEEL.plantOut / s, fyP, KNEEL.plantFwd / s);
    if (side > 0) {
      T[RL_RX] = kx; T[RL_RY] = 0; T[RL_RZ] = kz; T[RL_K] = kk;
      T[LL_RX] = r.rx; T[LL_RY] = 0; T[LL_RZ] = r.rz; T[LL_K] = r.k;
    } else {
      T[LL_RX] = kx; T[LL_RY] = 0; T[LL_RZ] = kz; T[LL_K] = kk;
      T[RL_RX] = r.rx; T[RL_RY] = 0; T[RL_RZ] = r.rz; T[RL_K] = r.k;
    }
    T[DROP] = drop;
    const tw = p.twist || 0;
    const jerk = p.phase === "drive" ? Math.max(0, Math.sin(clamp01(p.k) * Math.PI * 3)) * 0.03 : 0;
    torso(T, KNEEL.bend + jerk, tw, 0);
    head(T, KNEEL.head, -0.4 * tw);
    armsReady(T, 0.3);
  }

  /* ============================================================
     THE POSES. Each fills T and returns the channel groups it owns.
     p (one reused object from verbs.js):
       k      progress of the current beat 0..1
       phase  "approach"|"align"|"contact"|"drive"|"outcome"|"hold"|"release"
       t      seconds in the session (for breathing/struggle cycles)
       moving true while the pair travels (legs go back to the gait)
       sag    0..1 choke depth, crouch 0..1 frisk depth, seed 0..1
     ============================================================ */
  const POSES = {
    // ---------------- GRABBER ----------------
    // stepping in: a little lower, weight forward, lead (left) foot out
    "a.reach": function (ch, T, p) {
      const k = smooth(p.k);
      stance(ch, T, 0.03 + 0.04 * k, 0.12 + 0.08 * k, 0.12, -0.10, 0.12);
      torso(T, 0.10 + 0.06 * k, 0.04, 0);
      head(T, 0.06);
      armsReady(T, 0.2 * k);
      return G_ALL;
    },
    // COLLAR GRIP: bladed wide base, hips down, leaning back against the load
    "a.grip": function (ch, T, p) {
      const d = p.phase === "drive" ? Math.sin(Math.PI * clamp01(p.k)) : 0;
      const hold = p.phase === "hold" ? 1 : smooth(p.k);
      const breath = Math.sin(p.t * 2.1) * 0.012;
      stance(ch, T, 0.07 + 0.05 * hold + 0.04 * d, 0.24, 0.13, -0.22, 0.15);
      torso(T, 0.02 - 0.10 * hold - 0.06 * d + breath, 0.10 + 0.06 * d, 0);
      head(T, 0.08, -0.05);
      armsReady(T, 0.1);
      if (p.moving) return G_BODY | G_ARML | G_ARMR;
      return G_ALL;
    },
    // MUG: the collar hand pulls, the other goes to the pocket
    "a.mug": function (ch, T, p) {
      const k = smooth(p.k);
      stance(ch, T, 0.08 + 0.04 * k, 0.26, 0.12, -0.18, 0.15);
      torso(T, 0.10 + 0.14 * k, -0.18 * k, 0.04 * k);
      head(T, 0.22 * k, -0.1);
      armsReady(T, 0);
      return G_ALL;
    },
    // SHOVE: load (sink, arms fold, lean in) -> explode (rear leg drives,
    // hips come through, arms punch out)
    "a.shove": function (ch, T, p) {
      const k = clamp01(p.k);
      const load = p.phase === "drive" ? smooth(k / 0.3) : smooth(k);
      const burst = p.phase === "drive" ? smooth((k - 0.3) / 0.45) : 0;
      stance(ch, T, 0.06 + 0.08 * load - 0.08 * burst, 0.20 + 0.14 * burst, 0.14, -0.20 - 0.18 * burst, 0.14);
      torso(T, 0.10 + 0.12 * load + 0.20 * burst, 0, 0);
      head(T, 0.04 - 0.08 * burst);
      armsReady(T, 0.1);
      return G_ALL;
    },
    // HEAVE: wind the load across the body, then whip it through
    "a.heave": function (ch, T, p) {
      const k = clamp01(p.k);
      const wind = smooth(k / 0.45), whip = smooth((k - 0.45) / 0.4);
      const twist = 0.42 * wind - 0.9 * whip;
      stance(ch, T, 0.07 + 0.08 * wind - 0.06 * whip, 0.22 + 0.16 * whip, 0.15, -0.24 - 0.1 * whip, 0.15);
      torso(T, -0.10 * wind + 0.42 * whip, twist, 0.08 * wind - 0.1 * whip);
      head(T, 0.06, -twist * 0.4);
      armsReady(T, 0);
      return G_ALL;
    },
    // TACKLE: low drive, shoulder at the waist; on the ground: mounted on top
    "a.tackle": function (ch, T, p) {
      const k = clamp01(p.k);
      if (p.ground) {
        // THE MOUNT: kneeling astride his hips. The engine pitches the whole
        // body MOUNT.pitch forward; the thighs undo that to stand straight
        // down onto the knees, the shins lie flat behind, the torso leans on
        // over his chest so straight arms can pin his shoulders
        legs(T, -MOUNT.pitch, 1.52, -MOUNT.pitch, 1.52, MOUNT.spread);
        torso(T, MOUNT.torso, 0, 0);
        head(T, -0.2);
        armsReady(T, 0.2);
        return G_ALL;
      }
      const low = smooth(p.phase === "drive" ? 1 : k);
      stance(ch, T, 0.12 + 0.20 * low, 0.36, 0.14, -0.42, 0.14);
      torso(T, 0.35 + 0.65 * low, 0, 0);
      head(T, -0.35 * low);
      armsReady(T, 0.4);
      return G_ALL;
    },
    // CUFF / UNCUFF / ESCORT from behind: square, head down at the wrists
    "a.cuff": function (ch, T, p) {
      const k = p.phase === "hold" ? 1 : smooth(p.k);
      const jerk = p.phase === "drive" ? Math.max(0, Math.sin(clamp01(p.k) * Math.PI * 3)) * 0.03 : 0;
      stance(ch, T, 0.06 + 0.03 * k, 0.14, 0.14, -0.14, 0.14);
      torso(T, 0.20 + 0.10 * k + jerk, 0, 0);
      head(T, 0.40 * k);
      armsReady(T, 0);
      return G_ALL;
    },
    /* CUFFING A MAN ON THE FLOOR (verbs.js ground cuff): down beside him,
       facing across his back, the knee on his head side up ON his shoulder
       blade, the other foot planted, bent over the wrists at the small of his
       back. verbs.js hands in where that knee goes (p.knee, the officer's
       group frame, metres), which leg it is (p.kneeSide: +1 = anatomical
       left) and a twist toward the wrists; this solves the hip height and
       both legs off this body's own leg lengths. Blends in from standing over
       the align beat (the knee going down) and back out over the release. */
    "a.kneelCuff": function (ch, T, p) {
      const kk = p.phase === "align" ? smooth(p.k) : p.phase === "release" ? 1 - smooth(p.k) : p.phase === "approach" ? 0 : 1;
      // standing, stepping in (what the blend starts from)
      stance(ch, T, 0.05, 0.12, 0.13, -0.10, 0.13);
      torso(T, 0.14, 0, 0);
      head(T, 0.1);
      armsReady(T, 0);
      if (kk <= 0 || !p.knee) return G_ALL;
      for (let i = 0; i < NCH; i++) _kn[i] = T[i];
      kneelOnBack(ch, T, p);
      for (let i = 0; i < NCH; i++) T[i] = _kn[i] + (T[i] - _kn[i]) * kk;
      return G_ALL;
    },
    "a.escort": function (ch, T, p) {
      torso(T, 0.06, 0.08, 0);
      head(T, 0.12);
      armsReady(T, 0);
      stance(ch, T, 0.03, 0.16, 0.13, -0.12, 0.13);
      return p.moving ? (G_BODY | G_ARML | G_ARMR) : G_ALL;
    },
    // FRISK: hands work down the body, the hips follow them down
    "a.frisk": function (ch, T, p) {
      const c = clamp01(p.crouch || 0);
      stance(ch, T, 0.05 + 0.40 * c, 0.20 + 0.08 * c, 0.16 + 0.06 * c, -0.14, 0.16 + 0.06 * c);
      torso(T, 0.22 + 0.40 * c, 0, 0);
      head(T, 0.30 + 0.1 * c);
      armsReady(T, 0);
      return G_ALL;
    },
    // DRAG: one hand in the collar behind him, leaning into the pull
    "a.drag": function (ch, T, p) {
      const k = p.phase === "hold" ? 1 : smooth(p.k);
      stance(ch, T, 0.10 + 0.08 * k, 0.26, 0.14, -0.22, 0.14);
      torso(T, 0.10 + 0.05 * k, -0.6 * k, -0.06 * k);      // turned back toward the man he pulls
      head(T, -0.05, 0.25 * k);
      arm(T, 1, -0.25 + Math.sin(p.t * 3.3) * 0.12 * (p.moving ? 1 : 0), 0.14, -0.35);
      arm(T, -1, 0.5, 0.25, -0.2);
      return p.moving ? (G_BODY | G_ARML | G_ARMR) : G_ALL;
    },
    // CHOKE: sink the hips, lean back, pull him onto you
    "a.choke": function (ch, T, p) {
      const k = p.phase === "hold" ? 1 : smooth(p.k);
      const sag = clamp01(p.sag || 0);
      stance(ch, T, 0.08 + 0.08 * k + 0.20 * sag, 0.06, 0.18, -0.28, 0.18);
      torso(T, 0.06 - 0.24 * k + 0.30 * sag, 0.12 * k, 0);
      head(T, 0.28 * k + 0.1 * sag, -0.25 * k);
      armsReady(T, 0.3);
      return G_ALL;
    },
    // SHIELD: tight behind him, gun hand free (the right arm is not owned)
    "a.shield": function (ch, T, p) {
      torso(T, -0.02, 0.08, 0);
      head(T, 0.06, -0.12);
      arm(T, 1, -1.2, 0.1, -1.4);
      stance(ch, T, 0.04, 0.16, 0.13, -0.16, 0.13);
      return p.moving ? (G_BODY | G_ARML) : (G_BODY | G_ARML | G_LEGS);
    },
    // FIREMAN LIFT: squat under him, shoulder in, drive up through the legs
    "a.lift": function (ch, T, p) {
      const k = clamp01(p.k);
      const sq = smooth(k / 0.38), up = smooth((k - 0.42) / 0.5);
      const low = sq * (1 - up);
      stance(ch, T, 0.05 + 0.34 * low + 0.03 * up, 0.24, 0.16, -0.16, 0.16);
      torso(T, 0.15 + 0.55 * low + 0.05 * up, -0.1 * low, -0.10 * up);
      head(T, -0.25 * low);
      armsReady(T, 0.3);
      return G_ALL;
    },
    // CARRYING: upright, a lean away from the shoulder the load is on
    "a.carry": function (ch, T, p) {
      const br = Math.sin(p.t * 1.9) * 0.01;
      stance(ch, T, 0.06, 0.12, 0.15, -0.10, 0.15);
      torso(T, CARRY.lean + br, 0.05, -0.10);
      head(T, 0.02, 0, 0.05);
      armsReady(T, 0.4);
      return p.moving ? (G_BODY | G_ARML | G_ARMR) : G_ALL;
    },
    // after the throw/shove: arms still out, weight coming back over the feet
    "a.follow": function (ch, T, p) {
      const k = smooth(p.k);
      stance(ch, T, 0.08 - 0.05 * k, 0.30 - 0.1 * k, 0.14, -0.30 + 0.12 * k, 0.14);
      torso(T, 0.38 - 0.28 * k, -0.4 * (1 - k), 0);
      head(T, 0.05);
      arm(T, 1, -1.35 + 0.8 * k, 0.1, -0.2 - 0.5 * k);
      arm(T, -1, -1.35 + 0.8 * k, 0.1, -0.2 - 0.5 * k);
      return G_ALL;
    },

    // ---------------- TARGET ----------------
    // COLLARED: up on the toes, leaning back from the fists, hands at the wrists
    "t.collared": function (ch, T, p) {
      const k = p.phase === "hold" ? 1 : smooth(p.k);
      const tug = p.phase === "drive" ? Math.sin(Math.PI * clamp01(p.k)) : 0;
      const struggle = Math.sin(p.t * 5.3 + (p.seed || 0) * 6) * 0.05;
      stance(ch, T, -0.025 * k - 0.02 * tug, 0.02, 0.08, -0.06, 0.08);
      torso(T, -0.10 * k - 0.12 * tug + struggle * 0.5, struggle, 0);
      head(T, -0.22 * k - 0.1 * tug, 0, struggle);
      armsReady(T, 0.3 * k);
      return p.moving ? (G_BODY | G_ARML | G_ARMR) : G_ALL;
    },
    "t.mugged": function (ch, T, p) {
      const k = smooth(p.k);
      stance(ch, T, -0.02 * k, 0.02, 0.08, -0.08, 0.08);
      torso(T, -0.14 * k, 0.1 * k, 0);
      head(T, -0.18 * k, 0.2 * k);
      armsReady(T, 0.2);
      arm(T, -1, -1.25 * k - 0.1, 0.55 * k, -1.7 * k);   // the flinch hand, up by the face
      return G_ALL;
    },
    // SHOVED: the chest takes it, the arms fly forward, a foot steps back
    "t.shoved": function (ch, T, p) {
      const k = p.phase === "drive" ? smooth((clamp01(p.k) - 0.3) / 0.5) : 0;
      stance(ch, T, 0.02 + 0.05 * k, 0.04 - 0.08 * k, 0.1, -0.08 - 0.26 * k, 0.12);
      torso(T, -0.05 - 0.40 * k, 0, 0);
      head(T, 0.20 * k);                                   // chin whips toward the chest
      arm(T, 1, -0.3 - 0.9 * k, 0.2 + 0.3 * k, -0.4);
      arm(T, -1, -0.3 - 0.9 * k, 0.2 + 0.3 * k, -0.4);
      return G_ALL;
    },
    // HEAVED: off his feet, grabbing at the arms that have him
    "t.heaved": function (ch, T, p) {
      const k = smooth(p.k);
      legs(T, -0.35 * k, 0.5 * k, 0.15 * k, 0.3 * k, 0.12);
      torso(T, -0.25 - 0.2 * k, 0, 0.1 * k);
      head(T, -0.25);
      armsReady(T, 0.3);
      return G_ALL;
    },
    // TACKLED: folds over the shoulder, arms thrown up; down on his back after
    "t.tackled": function (ch, T, p) {
      const k = smooth(p.k);
      if (p.ground) {
        legs(T, -0.35, 0.55, -0.15, 0.25, 0.22);
        torso(T, -0.12, 0, 0);
        head(T, -0.3, 0.2);
        arm(T, 1, -2.0, 0.55, -0.6);
        arm(T, -1, -1.6, 0.8, -0.9);
        return G_ALL;
      }
      stance(ch, T, 0.05 + 0.1 * k, 0.05, 0.12, -0.12, 0.12);
      torso(T, 0.55 * k, 0, 0);
      head(T, 0.45 * k);
      arm(T, 1, -1.5 * k, 0.4 + 0.4 * k, -0.5);
      arm(T, -1, -1.5 * k, 0.4 + 0.4 * k, -0.5);
      return G_ALL;
    },
    // BEING CUFFED: bent at the waist, head down, feet apart
    "t.cuffed": function (ch, T, p) {
      const k = p.phase === "hold" ? 1 : smooth(p.k);
      const escort = p.verb === "escort";
      const bend = escort ? 0.16 : 0.34;
      stance(ch, T, 0.03 * k, 0.04, 0.16, -0.04, 0.16);
      torso(T, bend * k, 0, 0);
      head(T, 0.30 * k);
      return p.moving ? G_BODY : (G_BODY | G_LEGS);
    },
    // FRISKED: hands up by the head, legs spread
    "t.frisked": function (ch, T, p) {
      const k = p.phase === "hold" ? 1 : smooth(p.k);
      stance(ch, T, 0.02 * k, 0.03, 0.26 * k + 0.08, -0.03, 0.26 * k + 0.08);
      torso(T, 0.04 * k, 0, 0);
      head(T, 0.12 * k);
      arm(T, 1, -2.55 * k, 0.45 * k, -1.45 * k);
      arm(T, -1, -2.55 * k, 0.45 * k, -1.45 * k);
      return G_ALL;
    },
    // DRAGGED BY THE COLLAR: engine lays him back ~60 deg; heels on the deck
    "t.dragged": function (ch, T, p) {
      const swing = Math.sin(p.t * 3.3) * 0.08 * (p.moving ? 1 : 0);
      legs(T, 0.06 + swing, 0.18, 0.08 - swing, 0.12, 0.14);
      torso(T, 0.18, 0, 0.05);
      head(T, -0.35, 0.25);
      arm(T, 1, -0.4 + swing, 0.55, -0.35);
      arm(T, -1, -0.3 - swing, 0.65, -0.5);
      return G_ALL;
    },
    // CHOKED: pulled back onto the choker, on his toes; the legs go as it sinks
    "t.choked": function (ch, T, p) {
      const k = p.phase === "hold" ? 1 : smooth(p.k);
      const sag = clamp01(p.sag || 0);
      const kick = (1 - sag) * Math.sin(p.t * 7.1 + (p.seed || 0) * 5) * 0.08;
      stance(ch, T, -0.03 * k * (1 - sag) + 0.30 * sag, 0.12 + kick, 0.1, 0.02 - kick, 0.1);
      torso(T, -0.20 * k - 0.1 * sag, 0, 0.05 * sag);
      head(T, -0.30 * k + 0.35 * sag, 0.1 * sag, 0.2 * sag);
      armsReady(T, 0.6);
      return G_ALL;
    },
    // SHIELD: stiff, back pressed into the gunman, one hand on his forearm
    "t.shield": function (ch, T, p) {
      const tr = Math.sin(p.t * 19) * 0.01;                 // the shake of a scared man
      stance(ch, T, -0.01, 0.03, 0.1, -0.03, 0.1);
      torso(T, -0.12 + tr, 0, 0);
      head(T, -0.18, 0.1);
      armsReady(T, 0.5);
      arm(T, -1, -2.3, 0.55, -1.5);                         // free hand up, open
      return p.moving ? (G_BODY | G_ARML | G_ARMR) : G_ALL;
    },
    // LIFTED: folding over the shoulder that is coming up under him
    "t.lifted": function (ch, T, p) {
      const k = smooth(p.k);
      legs(T, -0.2 * k, 0.35 * k, -0.05 * k, 0.2 * k, 0.08);
      torso(T, 0.5 * k, 0, 0);
      head(T, 0.3 * k);
      arm(T, 1, -0.9 * k, 0.3, -0.5 * k);
      arm(T, -1, -0.9 * k, 0.3, -0.5 * k);
      return G_ALL;
    },
    // DRAPED over a shoulder: the engine pitches the whole body horizontal,
    // this folds the torso down the carrier's back and hangs the legs in front
    "t.draped": function (ch, T, p) {
      const sw = Math.sin(p.t * 3.1) * 0.10 * (p.moving ? 1 : 0.25);
      legs(T, -1.05 + sw * 0.3, 1.25, -0.95 - sw * 0.3, 1.1, 0.08);
      torso(T, CARRY.fold, 0, 0);
      head(T, 0.35, 0.15);
      arm(T, 1, -1.3 + sw, 0.12, -0.25);
      arm(T, -1, -1.2 - sw, 0.18, -0.35);
      return G_ALL;
    },
    // IN FLIGHT: one rigid articulated piece (grapple.js's hard-won lesson —
    // a live thrown body is braced, it does not windmill apart)
    "t.flight": function (ch, T, p) {
      const s = p.seed || 0;
      legs(T, -0.32 + 0.1 * Math.sin(s * 9), 0.55, 0.12, 0.35, 0.12);
      torso(T, 0.16, 0, 0.05 * Math.sin(s * 5));
      head(T, -0.18);
      arm(T, 1, -0.9, 0.55, -0.7);
      arm(T, -1, -0.75, 0.6, -0.8);
      return G_ALL;
    },
    // DOWN on his back, limp (landed on a bed/table, or the fallback knockdown)
    "t.down": function (ch, T, p) {
      const s = p.seed || 0;
      legs(T, -0.25 - 0.1 * Math.sin(s * 7), 0.45, -0.05, 0.2, 0.18);
      torso(T, -0.05, 0, 0.04);
      head(T, -0.25, 0.3 * Math.sin(s * 3));
      arm(T, 1, -0.3, 0.9, -0.4);
      arm(T, -1, -0.6, 0.7, -0.6);
      return G_ALL;
    },
  };

  /* ============================================================
     THE CUFFED ARMS: hands behind the back, the cuffs side by side.
     Solved every frame for every cuffed rig (systems/verbs.js calls it) so the
     gait can never pull the hands apart. The WRIST landmark (where the tie
     sits, CBZ.charArmLandmarks) is what meets, not the fist: charArmTo places
     the hand socket, so the socket target is walked until the wrist lands. */
  const _wt = new (window.THREE.Vector3)(), _wp = new (window.THREE.Vector3)(),
    _sp = new (window.THREE.Vector3)(), _st = new (window.THREE.Vector3)();
  function wristLocalY(ch) {
    const lm = CBZ.charArmLandmarks ? CBZ.charArmLandmarks(ch) : null;
    const P = ch.profile;
    return lm ? lm.wrist : ((P ? 0.20 - P.armLo : -0.26) + 0.04);
  }
  // where the cuff closes (elbow frame y): the ring line verbs.js measured on
  // this wrist (ch._cuffFit, the waist just above the hand), else the landmark
  function cuffY(ch) {
    const f = ch._cuffFit;
    return f && isFinite(f.y) ? f.y : wristLocalY(ch);
  }
  /* WHERE CUFFED WRISTS CAN MEET, on THIS body. The voxel rig's shoulders sit
     far out (armX 0.62 against a shoulder-to-wrist reach of ~0.66), so the
     belt line is simply out of reach of wrists that must touch at the spine:
     the old pinArm hid that by meeting the FISTS (0.25 further down the arm)
     with the wrists a hand apart. Here the height is SOLVED from this body's
     own reach: the shoulders retract (back and in, the scapulae pinching the
     way they do in real cuffs), the wrists sit just off the back surface, as
     low as a nearly straight arm allows. Body-local, model units. */
  const CUFF_IN = 0.10, CUFF_BACK = 0.08;   // scapular retraction (model units)
  /* THE CUFFS SIT SIDE BY SIDE. The two rings are steel: the wrists cannot be
     closer than one ring's outside diameter plus a finger of air, and the
     chain (entities/handcuffs.js, 5.5 cm) spans the rest. verbs.js measures
     the ring for THIS wrist (ch._cuffFit.rOut, rig units); before that the
     real cuff on this hand's scale stands in. The old stacked layout (2.4 cm
     between the wrist centres) put one forearm through the other. */
  function cuffHalfGap(ch) {
    const f = ch._cuffFit;
    if (f && f.rOut > 0) return f.rOut + 0.006;
    const P = ch.profile || {};
    return 0.064 * Math.sqrt((P.armW || 0.3) / 0.30);
  }
  /* The back he is tied against, at height y (body frame, model units): the
     SHAPED torso's back surface (entities/character.js TORSO block: a heavy
     or muscular back stands proud of the profile box), never shallower than
     the pelvis box, which carries the seat below the torso loft. */
  function backAt(ch, x, y) {
    const P = ch.profile || {};
    let b = Math.max(P.torsoD || 0.5, P.pelvisD || 0.48, P.waistD || 0) / 2;
    const TS = ch.torsoShape;
    if (TS && typeof ch.torsoBackZ === "function") {
      const yy = Math.max(TS.base, Math.min(TS.yN, y));
      let z = 0;
      for (let i = -1; i <= 1; i++) { const v = -ch.torsoBackZ(x * (1 + 0.5 * i), yy); if (v > z && isFinite(v)) z = v; }
      if (z > 0) b = Math.max(z, (P.pelvisD || 0.48) / 2);
    }
    return b;
  }
  function cuffLocal(ch, side, out) {
    const P = ch.profile || {};
    const armW = P.armW || 0.3, armX = P.armX || 0.62;
    const sy = ch.parts && ch.parts.la ? ch.parts.la.position.y : 1.84;
    const R = 0.965 * (((P.armUp || 0.46) - 0.02) + Math.abs(cuffY(ch)));
    const wx = cuffHalfGap(ch);
    // what is round the wrist there — the steel ring, else the forearm's own
    // half depth (the lofted limb, character.js LIMB_SHAPES armLo) — and a
    // centimetre of air: the cuffs lie ON his back, not in it
    const fit = ch._cuffFit;
    const fore = (fit && fit.rOut > 0 ? fit.rOut : 0.245 * armW) + 0.012;
    const rk = armW / 0.30;                    // a smaller shoulder retracts less (the deltoid still covers it)
    const dx = armX - CUFF_IN * rk - wx;
    // the height and the back's depth there depend on each other: settle it
    let y = sy - 0.35, wz = 0;
    for (let i = 0; i < 3; i++) {
      wz = -(backAt(ch, wx, y) + fore);
      const dz = Math.abs(wz + CUFF_BACK * rk);
      const dy = Math.sqrt(Math.max(0.0025, R * R - dx * dx - dz * dz));
      y = sy - dy;
    }
    return out.set(side * wx, y, wz);
  }
  function cuffTarget(ch, side, out) {
    cuffLocal(ch, side, out);
    ch.body.updateWorldMatrix(true, false);
    return ch.body.localToWorld(out);
  }
  // the shoulders pinch back while the wrists are tied (k 0..1), exactly
  // refunded at 0 (animChar never writes the arm root's x)
  function retract(ch, k, kR) {
    const P = ch.profile || {}, armX = P.armX || 0.62;
    const la = ch.parts.la, ra = ch.parts.ra;
    const rk = (P.armW || 0.3) / 0.30;                                  // scaled to the shoulder (see cuffLocal)
    const kl = Math.max(0, Math.min(1, k)) * rk;
    const kr = Math.max(0, Math.min(1, kR == null ? k : kR)) * rk;
    if (la) { la.position.x = armX - CUFF_IN * kl; la.position.z = -CUFF_BACK * kl; la.userData._armRestZ = -CUFF_BACK * kl; }
    if (ra) { ra.position.x = -(armX - CUFF_IN * kr); ra.position.z = -CUFF_BACK * kr; ra.userData._armRestZ = -CUFF_BACK * kr; }
  }
  function unretract(ch) {
    const P = ch && ch.profile || {}, armX = P.armX || 0.62;
    if (!ch || !ch.parts) return;
    if (ch.parts.la) { ch.parts.la.position.x = armX; ch.parts.la.userData._armRestZ = undefined; }
    if (ch.parts.ra) { ch.parts.ra.position.x = -armX; ch.parts.ra.userData._armRestZ = undefined; }
  }
  // the wrist landmark of `side` in world space (y: another elbow-frame height)
  function wristWorld(ch, side, out, y) {
    const low = ch.low && (side > 0 ? ch.low.la : ch.low.ra);
    if (!low) return null;
    out.set(0, y != null ? y : wristLocalY(ch), 0);
    low.updateWorldMatrix(true, false);
    return low.localToWorld(out);
  }
  // put the WRIST landmark of `side` on world point `tgt` (iterating the
  // socket); y: solve another point of the forearm there instead (the cuff line)
  function wristTo(ch, side, tgt, k, y) {
    const arm = side > 0 ? "l" : "r";
    const sock = ch.sockets && (side > 0 ? ch.sockets.leftHand : ch.sockets.rightHand);
    if (!CBZ.charArmTo || !sock) return null;
    _st.copy(tgt);
    let res = null;
    // a partial blend is one step (repeating it would compound the weight)
    const n = k >= 0.999 ? 4 : 1;
    for (let i = 0; i < n; i++) {
      CBZ.charArmTo(ch, _st, arm, k);
      if (!wristWorld(ch, side, _wp, y)) return null;
      _wp.sub(tgt);                                  // wrist error
      res = _wp.length();
      if (res < 0.003) break;
      _st.sub(_wp);                                  // move the socket target by the error
    }
    return res;
  }
  /* cuffArms(ch, k[, kR]): both wrists to the cuff line by k — or, with kR,
     the LEFT by k and the RIGHT by kR (a ground cuff takes one wrist, then
     brings the other round to it). Body-local, so it holds on a man lying on
     his face exactly as on one standing. An arm at 0 is left to the pose. */
  function cuffArms(ch, k, kR) {
    if (!ch || !ch.parts || !ch.body) return null;
    const kl = k == null ? 1 : k, kr = kR == null ? kl : kR;
    retract(ch, kl, kr);
    const cy = cuffY(ch);
    const rL = kl > 0.001 ? wristTo(ch, 1, cuffTarget(ch, 1, _wt), kl, cy) : 0;
    const rR = kr > 0.001 ? wristTo(ch, -1, cuffTarget(ch, -1, _wt), kr, cy) : 0;
    return rL == null || rR == null ? null : Math.max(rL, rR);
  }

  /* ============================================================
     THE LAYER API (systems/verbs.js drives it)
       set(ch, name, p, rate)  aim this rig at a pose this frame (+ weights up)
       write(ch, dt)           damp + write it (then the caller solves hands)
       clear(ch)               weights down; keep calling write() to fade out
       fade(dt)                write every rig that is fading and not re-set
     ============================================================ */
  const live = [];          // rigs with any weight on them
  let frame = 0;
  function set(ch, name, p, rate) {
    if (!ch || !ch.body) return 0;
    const fn = POSES[name];
    if (!fn) return 0;
    const s = state(ch);
    const mask = fn(ch, s.tgt, p);
    // THE FIGHT INSIDE A HOLD (verbs.js struggle): the grabber's brace clamps
    // down (hips lower, weight back); the held man wrenches his shoulders and
    // twists against it. Additive on whatever the pose is.
    if (p.strain > 0) { s.tgt[DROP] += 0.035 * p.strain; s.tgt[B_RX] -= 0.07 * p.strain; }
    if (p.writhe > 0) {
      const w = p.writhe, ph = Math.sin((p.t || 0) * 23);
      s.tgt[B_RY] += 0.28 * w * ph; s.tgt[B_RZ] += 0.10 * w * ph; s.tgt[B_RX] -= 0.12 * w;
      s.tgt[N_RY] -= 0.30 * w * ph;
    }
    s.wt[0] = mask & G_BODY ? 1 : 0;
    s.wt[1] = mask & G_ARML ? 1 : 0;
    s.wt[2] = mask & G_ARMR ? 1 : 0;
    s.wt[3] = mask & G_LEGS ? 1 : 0;
    s.rate = rate || 10;
    s.name = name;
    s.stamp = frame;
    if (!s.active) {
      s.active = true;
      readRig(ch, s, s.cur);
      if (live.indexOf(ch) < 0) live.push(ch);
    }
    return mask;
  }
  function write(ch, dt) {
    const s = ch && ch._vp;
    if (!s || !s.active) return;
    const a = 1 - Math.exp(-s.rate * dt);
    const aw = 1 - Math.exp(-9 * dt);
    const cur = s.cur, tgt = s.tgt;
    // a group with no weight keeps tracking the animated rig so it can take
    // over from exactly where animChar left it
    if (s.w[0] < 0.01 || s.w[1] < 0.01 || s.w[2] < 0.01 || s.w[3] < 0.01) readRig(ch, s, _base);
    for (let g = 0; g < 4; g++) s.w[g] += (s.wt[g] - s.w[g]) * aw;
    for (let i = 0; i < NCH; i++) {
      const g = GROUP[i];
      if (s.w[g] < 0.01 && s.wt[g] > 0) cur[i] = _base[i];
      if (s.wt[g] > 0) cur[i] += (tgt[i] - cur[i]) * a;
    }
    writeRig(ch, s);
    let any = false;
    for (let g = 0; g < 4; g++) if (s.w[g] > 0.004 || s.wt[g] > 0) any = true;
    if (!any) {
      // fully handed back: refund the hip drop and drop out of the live list
      if (ch.model && s.drop) { ch.model.position.y += s.drop; s.drop = 0; }
      s.active = false; s.name = null;
      const i = live.indexOf(ch); if (i >= 0) live.splice(i, 1);
    }
  }
  function clear(ch) {
    const s = ch && ch._vp;
    if (!s) return;
    s.wt[0] = s.wt[1] = s.wt[2] = s.wt[3] = 0;
  }
  // snap a rig's layer off this instant (a rig being recycled / a teleport)
  function kill(ch) {
    const s = ch && ch._vp;
    if (!s) return;
    if (ch.model && s.drop) { ch.model.position.y += s.drop; s.drop = 0; }
    s.w[0] = s.w[1] = s.w[2] = s.w[3] = 0;
    s.wt[0] = s.wt[1] = s.wt[2] = s.wt[3] = 0;
    s.active = false;
    const i = live.indexOf(ch); if (i >= 0) live.splice(i, 1);
  }
  // call tick() at the top of the pass and fade(dt) at the bottom: every rig
  // that no session re-set this pass fades its weights out on the SAME frame,
  // so a released body never shows one raw animChar frame between the two.
  function tick() { frame++; }
  function fade(dt) {
    for (let i = live.length - 1; i >= 0; i--) {
      const ch = live[i], s = ch._vp;
      if (!s) { live.splice(i, 1); continue; }
      if (s.stamp !== frame) { clear(ch); write(ch, dt); }
    }
  }
  function weight(ch) {
    const s = ch && ch._vp;
    return s && s.active ? Math.max(s.w[0], s.w[1], s.w[2], s.w[3]) : 0;
  }

  CBZ.verbPoses = {
    POSES, set, write, clear, kill, fade, tick, weight,
    cuffArms, cuffTarget, cuffLocal, cuffHalfGap, cuffY, backAt, unretract, wristWorld, wristTo, wristLocalY, legSolve, stance, KNEEL,
    CH: { DROP, B_RX, B_RY, B_RZ, B_PY, N_RX, N_RY, N_RZ, NCH }, MOUNT, CARRY,
    liveCount: function () { return live.length; },
    _frame: function () { return frame; },
  };
})();
