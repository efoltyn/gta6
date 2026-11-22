/* ============================================================
   world/birdkit.js — CBZ.birdKit: every bird in the game from one kit.

   Species, from real measurements and plumage:
     gull     herring gull (Larus argentatus): 0.60 m long, 1.40 m across,
              1 kg. White head and body, silver-grey mantle and upperwing,
              black wingtips with white mirrors, white trailing edge, yellow
              bill with the red gonys spot, pale eye in an orange ring, pink
              webbed feet. ~3 wingbeats a second and long glides.
     crow     American crow (Corvus brachyrhynchos): 0.45 m, 0.92 m across,
              450 g. Black; a stout bill; five fingered primaries; rowing
              flight at ~4 beats a second. The wilderness flocks are crows: a
              loose flock of 8-15 working a forest edge is what crows do (a
              starling murmuration is thousands of birds).
     hen      a laying hen, 2.4 kg, 0.42 m tall: Rhode Island Red, white
              Leghorn (white earlobes) or black Australorp (slate legs).
     rooster  a red cock, 3.6 kg: big comb and wattles, golden hackles, black
              breast, green-black sickles.

   THE BODY is lofted at real size with CBZ.loftKit (nose +X, up +Y, right
   wing +Z, feet on y = 0, wings spread flat): the trunk, neck, head, bill,
   eyes (iris, pupil, orbital ring), comb and wattles, legs, toes (webbed on
   the gull), a tail of rectrices and a wing of separate feathers: the
   covert band over the bones, tertials on the arm, secondaries on the
   forearm, primaries on the hand. Per vertex it carries where it sits:
     bseg  joint level (0 body .. 1 arm .. 2 forearm .. 3 hand, or hip /
           heel / toes, or neck / head), chain, side, feather index
     bfe   a flight feather's quill (x, z), the turn it makes about its quill
           when the wing folds, and its place in the folded stack

   THE POSE is computed in the vertex shader from three per-instance vec4s
   (so a flock of any size is one draw, and a single bird is the same mesh
   with one instance — what pose() shows is what a flock draws):
     bA  wingbeat phase, flap, fold, landing flare
     bB  step phase, legs down, walk, sit
     bC  neck pitch (+ down), neck yaw, head bob (m), body pitch (+ nose down)
   The wing is a linkage: shoulder (stroke elevation, sweep, twist), elbow
   and wrist flexing in the wing's plane, and every flight feather turning
   about its own quill in step with the joint it rides, so the primaries
   spread on the downstroke, close on the flexed upstroke and lie stacked
   along the flank when the wing folds (the forearm rolls the folded wing
   down against the side, upper surface out). The legs solve two-bone IK
   each frame: a stance foot sweeps back at the body's speed (planted), the
   swing foot lifts, the hips rise over each stance, the toes stay flat. The
   body heaves with the wingbeat (lift each downstroke, g / w^2), pitches
   about the hips to peck, waddles over the stance foot.

   API
     CBZ.birdKit.SPECIES
     build(kind, seed) -> { group, mesh, forward, kind, pose({ mode, phase }),
                            set(params) }
         kind "gull" | "crow" | "chicken" (hen or rooster by seed) | "hen" |
         "rooster"; mode "flap" | "glide" | "perch" | "walk" | "land" |
         "float" | "sit" | "peck"
     flock(kind, n, { name, coat }) -> { mesh, far, begin(), add(m4, p,
         far), end() }          a near and a far InstancedMesh: two draws
     params(kind, mode, phase, out)   the per-instance numbers for a mode
     clock(kind, st, dt, o)     flap / glide bouts at the species' wingbeat
     bank(v, turnRate), stride(kind, walk), wingHz(kind)
     chickenBuild(ctx) / animateActor(a, dt)   the bestiary chicken
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W.CBZ || (W.CBZ = {});
  const PI = Math.PI, TAU = PI * 2, DEG = PI / 180;
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function frac(x) { return x - Math.floor(x); }
  // sRGB reference colours -> the linear values the renderer expects
  function lin(h) {
    const f = function (v) { return Math.round(Math.pow(v / 255, 2.2) * 255); };
    return (f((h >> 16) & 255) << 16) | (f((h >> 8) & 255) << 8) | f(h & 255);
  }
  function mkRng(seed) {
    let s = (seed >>> 0) || 1;
    return function () { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  // the shader's rotations, on [x, y, z]
  function rx(a, v) { const c = Math.cos(a), s = Math.sin(a); return [v[0], c * v[1] - s * v[2], s * v[1] + c * v[2]]; }
  function ry(a, v) { const c = Math.cos(a), s = Math.sin(a); return [c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]]; }
  function rz(a, v) { const c = Math.cos(a), s = Math.sin(a); return [c * v[0] - s * v[1], s * v[0] + c * v[1], v[2]]; }
  // a direction in the spread wing's plane: angle from straight out (+Z)
  // toward straight back (-X)
  function inPlane(a) { return [-Math.sin(a), 0, Math.cos(a)]; }

  // ==========================================================================
  //  SPECIES (metres; sRGB colours). body: [x, back y, belly y, half width]
  //  from the tail base to the breast. wing: shoulder (x, z) at height y,
  //  arm / forearm / hand lengths and their angles in the spread wing
  //  (degrees from straight out, + swept back), feather lengths. flight: Hz,
  //  stroke amplitude and mean (rad), upstroke elbow / wrist flexion, twist,
  //  the glide's dihedral, M and hand droop. fold: shoulder sweep, elbow and
  //  wrist flexion, forearm roll and yaw, shoulder elevation (degrees), hand
  //  drop, outward set, stack (m), where the folded feathers point. leg: hip
  //  / heel / toe joint, stride (one cycle at full walk), duty, swing lift,
  //  hip rise, waddle, and where the tucked tibia, tarsus and toes point in
  //  flight (degrees from +X); sitting is solved from the bones.
  // ==========================================================================
  const SPECIES = {
    gull: {
      id: "gull", name: "herring gull", length: 0.6, span: 1.4, mass: 1.0,
      body: [[-0.15, 0.206, 0.178, 0.015], [-0.112, 0.222, 0.152, 0.032], [-0.06, 0.232, 0.126, 0.044], [0.0, 0.237, 0.113, 0.05],
        [0.05, 0.238, 0.112, 0.052], [0.095, 0.232, 0.12, 0.05], [0.13, 0.22, 0.138, 0.042], [0.152, 0.205, 0.16, 0.026]],
      neck: { base: [0.112, 0.212], top: [0.162, 0.262], r: 0.031 },
      head: { c: [0.188, 0.282], len: 0.08, h: 0.054, w: 0.046 },
      bill: { len: 0.056, d: 0.019, w: 0.012, hook: 0.006, gonys: 0.7, col: 0xe8c03a, spot: 0xd0302a },
      eye: { r: 0.0052, at: [0.199, 0.292], iris: 0xece4b0, ring: 0xe0902c },
      tail: { root: [-0.126, 0.204], len: 0.17, n: 12, half: 0.034, round: 0.006, up: 0.06, w: 0.024 },
      wing: { y: 0.222, sh: [0.07, 0.04], arm: 0.13, fore: 0.15, hand: 0.1, aA: 12, aF: -8, aH: 8,
        nTer: 3, ter: 0.12, nSec: 12, sec: [0.13, 0.12], nPri: 10,
        pri: [0.178, 0.19, 0.205, 0.222, 0.243, 0.267, 0.294, 0.322, 0.345, 0.335], pIn: 98, pOut: 16, slots: 0, cov: [0.055, 0.07, 0.04] },
      flight: { hz: 3.0, amp: 0.68, mean: 0.12, flexE: 0.5, flexW: 0.95, twist: 0.22, dihedral: 0.17, glideE: 0.12, glideW: 0.3, droop: 0.3, tailFan: 0.3, neck: 0.65, head: 0.15, glides: 0.65, cruise: 11 },
      fold: { S: 81.9, E: 165.5, W: 168, roll: -90, yaw: -15.2, elev: -1.7, drop: 0.034, out: 0.017, stack: 0.004, tPri: [-1, 0.135, -0.185], tSec: [-1, -0.107, 0.05], tTer: [-1, 0.1, -0.186] },
      leg: { hip: [0.0, 0.125, 0.032], kn: [-0.034, 0.072], an: [0.006, 0.01], toe: 0.055, hal: 0.01, web: true, r: [0.0085, 0.0042, 0.0032],
        stride: 0.19, duty: 0.62, lift: 0.022, bob: 0.004, waddle: 0.07, tuck: [-172, -176, -178], col: 0xe8b0a8, bare: 0.11 },
      col: { body: 0xf2f2ee, back: 0xa9b3bb, wing: 0xa9b3bb, under: 0xe8ebed, head: 0xf5f5f1, black: 0x151515, white: 0xf6f6f2 },
      feather: function (grp, fi, t, up, C) {
        if (grp === "pri") {
          // P10 / P9 black with a white mirror; P5-P8 black ends; all white-tipped
          const blackFrom = fi > 0.85 ? 0.18 : fi > 0.4 ? lerp(0.68, 0.3, (fi - 0.4) / 0.45) : 2;
          let c = t > blackFrom ? C.black : (up ? C.wing : C.under);
          if (fi > 0.85 && t > 0.72 && t < 0.86) c = C.white;
          if (t > 0.95 && fi > 0.3) c = C.white;
          if (fi <= 0.3 && t > 0.9) c = C.white;
          return c;
        }
        if (grp === "sec") return t > 0.86 ? C.white : (up ? C.wing : C.under);
        if (grp === "ter") return t > 0.8 ? C.white : (up ? C.wing : C.under);
        return up ? C.wing : C.under;
      },
      bodyCol: function (x, y, z, ca, C) { return ca > 0.5 && x > -0.11 && x < 0.13 ? C.back : C.body; },
    },
    crow: {
      id: "crow", name: "American crow", length: 0.45, span: 0.92, mass: 0.45,
      body: [[-0.105, 0.172, 0.15, 0.012], [-0.08, 0.186, 0.13, 0.025], [-0.04, 0.194, 0.108, 0.034], [0.0, 0.198, 0.098, 0.039],
        [0.04, 0.198, 0.098, 0.04], [0.075, 0.193, 0.106, 0.038], [0.1, 0.183, 0.12, 0.031], [0.118, 0.172, 0.138, 0.019]],
      neck: { base: [0.085, 0.176], top: [0.118, 0.212], r: 0.024 },
      head: { c: [0.142, 0.226], len: 0.06, h: 0.044, w: 0.038 },
      bill: { len: 0.05, d: 0.018, w: 0.011, hook: 0.004, gonys: 0.75, col: 0x141416, spot: 0x141416 },
      eye: { r: 0.0048, at: [0.151, 0.236], iris: 0x2e2016, ring: 0x141416 },
      tail: { root: [-0.09, 0.172], len: 0.175, n: 12, half: 0.036, round: 0.022, up: 0.03, w: 0.022 },
      wing: { y: 0.188, sh: [0.05, 0.034], arm: 0.078, fore: 0.092, hand: 0.063, aA: 12, aF: -8, aH: 8,
        nTer: 3, ter: 0.11, nSec: 10, sec: [0.135, 0.125], nPri: 10,
        pri: [0.15, 0.158, 0.168, 0.18, 0.193, 0.205, 0.212, 0.21, 0.198, 0.15], pIn: 98, pOut: 24, slots: 5, cov: [0.05, 0.055, 0.03] },
      flight: { hz: 4.0, amp: 0.75, mean: 0.1, flexE: 0.6, flexW: 1.0, twist: 0.25, dihedral: 0.08, glideE: 0.08, glideW: 0.16, droop: 0.08, tailFan: 0.4, neck: 0.55, head: 0.1, glides: 0.2, cruise: 10 },
      fold: { S: 83.2, E: 167.4, W: 169.9, roll: -90, yaw: -12.9, elev: -10, drop: 0.032, out: 0.013, stack: 0.006, tPri: [-1, 0.166, -0.089], tSec: [-1, -0.121, 0.043], tTer: [-1, 0.1, -0.314] },
      leg: { hip: [0.0, 0.105, 0.025], kn: [-0.03, 0.06], an: [0.005, 0.008], toe: 0.042, hal: 0.03, web: false, r: [0.007, 0.0036, 0.0026],
        stride: 0.17, duty: 0.62, lift: 0.02, bob: 0.004, waddle: 0.02, tuck: [-12, 172, 168], col: 0x141416, bare: 0.095 },
      col: { body: 0x18181e, back: 0x18181f, wing: 0x1b1c26, under: 0x202128, head: 0x17171d, black: 0x141418, white: 0x1d1e26 },
      feather: function (grp, fi, t, up, C) { return up ? C.wing : C.under; },
      bodyCol: function (x, y, z, ca, C) { return C.body; },
    },
    hen: {
      id: "hen", name: "hen", length: 0.42, span: 0.78, mass: 2.4, chicken: true,
      body: [[-0.14, 0.31, 0.24, 0.028], [-0.11, 0.322, 0.185, 0.054], [-0.06, 0.326, 0.148, 0.071], [0.0, 0.326, 0.134, 0.078],
        [0.05, 0.322, 0.136, 0.078], [0.095, 0.31, 0.155, 0.07], [0.125, 0.29, 0.19, 0.055], [0.142, 0.27, 0.225, 0.033]],
      neck: { base: [0.07, 0.25], top: [0.136, 0.37], r: 0.034 },
      head: { c: [0.155, 0.385], len: 0.052, h: 0.04, w: 0.034 },
      bill: { len: 0.022, d: 0.013, w: 0.009, hook: 0.004, gonys: 0.7, col: 0xd8b25e, spot: 0xd8b25e },
      eye: { r: 0.005, at: [0.163, 0.393], iris: 0xd0782a, ring: 0xc8261e },
      comb: { n: 5, h: 0.022, len: 0.042, col: 0xc8241c }, wattle: 0.018, lobe: 0xc8241c,
      tail: { root: [-0.112, 0.31], len: 0.13, n: 10, half: 0.03, round: 0.012, up: 0.8, w: 0.02, roof: 0.6 },
      wing: { y: 0.292, sh: [0.06, 0.062], arm: 0.075, fore: 0.072, hand: 0.055, aA: 12, aF: -8, aH: 8,
        nTer: 3, ter: 0.09, nSec: 10, sec: [0.108, 0.1], nPri: 10,
        pri: [0.11, 0.115, 0.12, 0.125, 0.13, 0.135, 0.14, 0.14, 0.135, 0.12], pIn: 98, pOut: 26, slots: 0, cov: [0.05, 0.058, 0.034] },
      flight: { hz: 9.0, amp: 0.85, mean: 0.15, flexE: 0.6, flexW: 0.9, twist: 0.3, dihedral: 0.12, glideE: 0.1, glideW: 0.2, droop: 0.08, tailFan: 0, neck: 0.25, head: 0.05, glides: 0.05, cruise: 5 },
      fold: { S: 81.1, E: 166.5, W: 164.2, roll: -90, yaw: -14.4, elev: -2.3, drop: 0.036, out: 0.024, stack: 0.004, tPri: [-1, 0.09, -0.078], tSec: [-1, -0.24, 0.044], tTer: [-1, 0.074, -0.144] },
      leg: { hip: [0.0, 0.175, 0.045], kn: [-0.042, 0.103], an: [0.006, 0.014], toe: 0.065, hal: 0.03, web: false, r: [0.02, 0.0068, 0.0046],
        stride: 0.22, duty: 0.62, lift: 0.03, bob: 0.005, waddle: 0.035, tuck: [-20, 168, 160], col: 0xe4b84a, bare: 0.12, feathered: true },
      col: { body: 0x8c3a1a, back: 0x7a3016, wing: 0x7c3218, under: 0x9a5230, head: 0x963e1c, hackle: 0x9e461e, tail: 0x221612, black: 0x2a1c14, white: 0x8c3a1a },
      coats: {
        red: {},
        leghorn: { body: 0xf0ede4, back: 0xebe8df, wing: 0xeeebe2, under: 0xf3f1ea, head: 0xf1eee6, hackle: 0xf3f0e8, tail: 0xeeebe2, black: 0xe4e0d6, white: 0xf3f0e8, combH: 1.7, lobe: 0xf2efe6 },
        australorp: { body: 0x16191a, back: 0x14181a, wing: 0x171b1c, under: 0x202424, head: 0x191c1d, hackle: 0x1a1f1f, tail: 0x131718, black: 0x111414, white: 0x1a1d1e, legCol: 0x34302e, billCol: 0x2e2a28 },
      },
      feather: function (grp, fi, t, up, C) {
        if (grp === "pri") return t > 0.35 ? C.black : (up ? C.wing : C.under);
        if (grp === "sec") return up ? (t > 0.7 ? C.black : C.wing) : C.under;
        return up ? C.wing : C.under;
      },
      bodyCol: function (x, y, z, ca, C) { return ca > 0.45 ? C.back : C.body; },
    },
  };
  // the rooster: the hen's frame grown 1.12x, carried more upright, with a big
  // comb and wattles, hackles, a black breast and arching sickles
  (function () {
    const H = SPECIES.hen, k = 1.12;
    const sc = function (v) { return Array.isArray(v) ? v.map(sc) : (typeof v === "number" ? v * k : v); };
    const R = JSON.parse(JSON.stringify(H, function (key, v) { return typeof v === "function" ? undefined : v; }));
    R.body = sc(H.body); R.neck = { base: sc(H.neck.base), top: [H.neck.top[0] * k + 0.012, H.neck.top[1] * k + 0.03], r: 0.038 };
    R.head = { c: [R.neck.top[0] + 0.022, R.neck.top[1] + 0.016], len: 0.058, h: 0.045, w: 0.037 };
    R.bill = Object.assign({}, H.bill, { len: 0.026, d: 0.015, w: 0.01 });
    R.eye = Object.assign({}, H.eye, { r: 0.0055, at: [R.head.c[0] + 0.009, R.head.c[1] + 0.009] });
    R.comb = { n: 6, h: 0.048, len: 0.065, col: 0xcc2418 }; R.wattle = 0.04; R.lobe = 0xcc2418;
    R.tail = { root: sc(H.tail.root), len: 0.2, n: 12, half: 0.04, round: 0.01, up: 0.75, w: 0.022, roof: 0.6, sickle: 0.34 };
    R.wing = Object.assign({}, H.wing, { y: H.wing.y * k, sh: sc(H.wing.sh), arm: H.wing.arm * k, fore: H.wing.fore * k, hand: H.wing.hand * k, ter: H.wing.ter * k, sec: sc(H.wing.sec), pri: sc(H.wing.pri), cov: sc(H.wing.cov) });
    R.leg = Object.assign({}, H.leg, { hip: sc(H.leg.hip), kn: sc(H.leg.kn), an: sc(H.leg.an), toe: H.leg.toe * k, hal: H.leg.hal * k, stride: H.leg.stride * k, spur: true });
    R.flight = Object.assign({}, H.flight, { hz: 8.0 });
    R.id = "rooster"; R.name = "rooster"; R.length = 0.6; R.span = 0.88; R.mass = 3.6; R.rooster = true;
    R.col = { body: 0x2a1810, back: 0x8a2a10, wing: 0x7a2410, under: 0x3a2014, head: 0xb8501a, hackle: 0xd4782a, tail: 0x142018, black: 0x1e1812, white: 0x8a2a10 };
    delete R.coats;
    R.feather = function (grp, fi, t, up, C) {
      if (grp === "pri") return t > 0.3 ? C.black : (up ? C.wing : C.under);
      if (grp === "sec") return up ? (t > 0.55 ? 0x4a2a14 : C.wing) : C.under;
      return up ? C.wing : C.under;
    };
    R.bodyCol = function (x, y, z, ca, C) {
      if (ca > 0.4 && x < 0.06) return C.back;                       // the saddle
      if (ca > 0.3 && x >= 0.06) return C.hackle;                    // hackles spill over the shoulders
      return C.body;                                                 // black breast and belly
    };
    SPECIES.rooster = R;
  })();

  // ==========================================================================
  //  DERIVED: the wing's joints, every flight feather (quill, rest angle,
  //  length, the turn it makes when the wing folds), the shader's uniforms
  // ==========================================================================
  function wingPts(S) {
    const WG = S.wing;
    const a = inPlane(WG.aA * DEG), f = inPlane(WG.aF * DEG), h = inPlane(WG.aH * DEG);
    const sh = [WG.sh[0], WG.sh[1]];
    const el = [sh[0] + a[0] * WG.arm, sh[1] + a[2] * WG.arm];
    const wr = [el[0] + f[0] * WG.fore, el[1] + f[2] * WG.fore];
    const tp = [wr[0] + h[0] * WG.hand, wr[1] + h[2] * WG.hand];
    return { sh: sh, el: el, wr: wr, tp: tp };
  }
  // where a folded feather points: its in-plane direction through the folded
  // joints (no quill turn yet)
  function foldedDir(S, lvl, ang) {
    const F = S.fold;
    let v = inPlane(ang);
    if (lvl > 2.5) v = ry(-F.W * DEG, v);
    if (lvl > 1.5) v = ry(F.yaw * DEG, rz(F.roll * DEG, ry(F.E * DEG, v)));
    return rx(-F.elev * DEG, ry(-F.S * DEG, v));
  }
  // the quill turn that lays a feather along its folded direction
  function foldTurn(S, lvl, ang, target) {
    const l = Math.hypot(target[0], target[1], target[2]);
    const t = [target[0] / l, target[1] / l, target[2] / l];
    let best = 0, bd = -2;
    for (let k = -360; k <= 360; k++) {
      const p = k * 0.5 * DEG, v = foldedDir(S, lvl, ang + p);
      const d = v[0] * t[0] + v[1] * t[1] + v[2] * t[2];
      if (d > bd) { bd = d; best = p; }
    }
    return best;
  }
  // flight feathers for one LOD: near draws every feather, far a few broad ones
  function feathersOf(S, far) {
    const WG = S.wing, P = wingPts(S), out = [];
    const F = S.fold;
    // tertials on the inner arm, near the elbow
    const nT = far ? 1 : WG.nTer;
    for (let k = 0; k < nT; k++) {
      const t = nT === 1 ? 0.75 : lerp(0.5, 0.92, k / (nT - 1));
      out.push({ grp: "ter", lvl: 1, fi: nT === 1 ? 0.5 : k / (nT - 1), base: [lerp(P.sh[0], P.el[0], t), lerp(P.sh[1], P.el[1], t)],
        ang: (WG.aA + 92 - 6 * (1 - t)) * DEG, len: WG.ter * (0.85 + 0.15 * t), order: 0.86 + 0.08 * (nT === 1 ? 0.5 : 1 - k / (nT - 1)), target: F.tTer });
    }
    // secondaries along the forearm, from the elbow out to the wrist
    const nS = far ? 3 : WG.nSec;
    for (let k = 0; k < nS; k++) {
      const t = (k + 0.5) / nS;
      out.push({ grp: "sec", lvl: 2, fi: t, base: [lerp(P.el[0], P.wr[0], t), lerp(P.el[1], P.wr[1], t)],
        ang: (WG.aF + 94 + 4 * (1 - t)) * DEG, len: lerp(WG.sec[0], WG.sec[1], t), order: 0.45 + 0.38 * (1 - t), target: F.tSec });
    }
    // primaries along the hand: P1 at the wrist pointing back, P10 at the tip
    // pointing out along the hand
    const nP = far ? 4 : WG.nPri;
    const nFing = WG.slots ? Math.max(1, Math.round(WG.slots * nP / WG.nPri)) : 0;
    for (let k = 0; k < nP; k++) {
      const fi = nP === 1 ? 1 : k / (nP - 1);
      const pi = fi * (WG.nPri - 1), i0 = Math.floor(pi), i1 = Math.min(WG.nPri - 1, i0 + 1);
      const len = lerp(WG.pri[i0], WG.pri[i1], pi - i0);
      out.push({ grp: "pri", lvl: 3, fi: fi, base: [lerp(P.wr[0], P.tp[0], 0.04 + fi * 0.92), lerp(P.wr[1], P.tp[1], 0.04 + fi * 0.92)],
        ang: lerp(WG.pIn, WG.pOut, Math.pow(fi, 0.85)) * DEG, len: len, order: 0.4 * (1 - fi), target: [F.tPri[0], F.tPri[1] + 0.03 * fi, F.tPri[2]],
        finger: nFing > 0 && k >= nP - nFing });
    }
    for (const f of out) f.turn = foldTurn(S, f.lvl, f.ang, f.target);
    // vane half-widths from the spread wing's gaps between neighbours
    const at = function (f, t) { const d = inPlane(f.ang); return [f.base[0] + d[0] * f.len * t, f.base[1] + d[2] * f.len * t]; };
    const ter = out.filter(function (f) { return f.grp === "ter"; }), sec = out.filter(function (f) { return f.grp === "sec"; }), pri = out.filter(function (f) { return f.grp === "pri"; });
    // one row from the body out: tertials, secondaries, then the hand
    const rows = [ter.concat(sec), pri];
    rows.forEach(function (row, ri) {
      for (let i = 0; i < row.length; i++) {
        const f = row[i];
        const gap = function (t) {
          let g = 0;
          for (const j of [i - 1, i + 1]) {
            if (j < 0 || j >= row.length) continue;
            const a = at(f, t), b = at(row[j], t);
            g = Math.max(g, Math.hypot(a[0] - b[0], a[1] - b[1]));
          }
          return g;
        };
        const wMin = ri === 1 ? 0.012 : 0.011;
        f.wMid = clamp(gap(0.5) * 0.62, wMin * 0.8, 0.05);
        f.wTip = clamp(gap(0.92) * 0.62, wMin, 0.05);
      }
    });
    return out;
  }
  const _prep = new Map();
  function prep(kind) {
    let D = _prep.get(kind);
    if (D) return D;
    const S = SPECIES[kind];
    const P = wingPts(S), LG = S.leg, F = S.flight, FO = S.fold;
    D = { S: S, P: P, near: feathersOf(S, false), far: feathersOf(S, true) };
    // legs: the tuck's directions as joint turns; sitting: the belly on the
    // ground, the heel down behind the hip, the tarsus and toes flat forward
    const T0 = [LG.kn[0] - LG.hip[0], LG.kn[1] - LG.hip[1]], S0 = [LG.an[0] - LG.kn[0], LG.an[1] - LG.kn[1]];
    const L1 = Math.hypot(T0[0], T0[1]), r1 = Math.atan2(T0[1], T0[0]), r2 = Math.atan2(S0[1], S0[0]);
    const tk = LG.tuck.map(function (d) { return d * DEG; });
    const tuck = [tk[0] - r1, tk[1] - r2 - (tk[0] - r1), tk[2] - (tk[1] - r2)];
    let belly = 1;
    S.body.forEach(function (b) { belly = Math.min(belly, b[2]); });
    const drop = belly - 0.008, hipSit = LG.hip[1] - drop, heelY = LG.an[1];
    const dy = clamp(heelY - hipSit, -L1 * 0.98, L1 * 0.98);
    const s1 = Math.atan2(dy, -Math.sqrt(L1 * L1 - dy * dy));
    const sit = [s1 - r1, 0 - r2 - (s1 - r1)];
    D.u = {
      uSh: [P.sh[0], S.wing.y, P.sh[1]], uEl: [P.el[0], S.wing.y, P.el[1]], uWr: [P.wr[0], S.wing.y, P.wr[1]],
      uHip: LG.hip.slice(), uKn: [LG.kn[0], LG.kn[1], LG.hip[2]], uAn: [LG.an[0], LG.an[1], LG.hip[2]],
      uNk: [S.neck.base[0], S.neck.base[1], 0], uHd: [S.neck.top[0], S.neck.top[1], 0], uTl: [S.tail.root[0], S.tail.root[1], 0],
      uFl: [F.amp, F.mean, F.flexE, F.flexW],
      uGl: [F.dihedral, F.glideE, F.glideW, F.droop],
      uTw: [F.twist, 0.5 * 9.81 / Math.pow(TAU * F.hz, 2), F.tailFan, 0],
      uFo: [FO.S * DEG, FO.E * DEG, FO.W * DEG, FO.roll * DEG],
      uFo2: [FO.yaw * DEG, FO.elev * DEG, FO.drop, FO.out],
      uFo3: [FO.stack, 0, 0, 0],
      uLg: [LG.stride, LG.duty, LG.lift, LG.bob],
      uLg2: [tuck[0], tuck[1], tuck[2], LG.waddle],
      uLg3: [sit[0], sit[1], drop, LG.toe],
    };
    // the peck: the body pitch and the neck pitch that put the bill on the ground
    D.peck = solvePeck(S, D.u);
    _prep.set(kind, D);
    return D;
  }
  // the bill tip through the shader's neck chain: the neck turns about its
  // base, the head about the neck's top (so it ends at `head` to the body),
  // the body about the hips
  function billTip(S, U, neck, head, body) {
    const H = S.head, B = S.bill;
    let p = [H.c[0] + H.len * 0.4 + B.len, H.c[1] - H.h * 0.08 - B.hook, 0];
    const about = function (c, R) { const q = R([p[0] - c[0], p[1] - c[1], p[2] - c[2]]); p = [q[0] + c[0], q[1] + c[1], q[2] + c[2]]; };
    about(U.uHd, function (v) { return rz(-(head - neck), v); });
    about(U.uNk, function (v) { return rz(-neck, v); });
    about([U.uHip[0], U.uHip[1], 0], function (v) { return rz(-body, v); });
    return p;
  }
  // a peck: the body tips forward, the bill comes down ~75 degrees to the
  // ground, the neck lowers until the tip touches
  function solvePeck(S, U) {
    const body = S.chicken ? 0.6 : 0.4, head = 75 * DEG - body;
    let lo = 0, hi = 2.6;
    for (let i = 0; i < 40; i++) {
      const m = (lo + hi) / 2;
      if (billTip(S, U, m, head, body)[1] > 0.012) lo = m; else hi = m;
    }
    const neck = (lo + hi) / 2;
    return { body: body, neck: neck, head: head, reach: billTip(S, U, neck, head, body)[1] };
  }

  // ==========================================================================
  //  GEOMETRY
  // ==========================================================================
  const CHAIN = { body: 0, wing: 1, leg: 2, neck: 3, tail: 4 };
  function colours(S, coat) {
    const src = Object.assign({}, S.col, (S.coats && coat && S.coats[coat]) || {});
    const C = { raw: src };
    for (const k in src) if (typeof src[k] === "number" && k !== "combH") C[k] = lin(src[k]);
    return C;
  }
  function buildBird(kind, coat, far) {
    const LK = CBZ.loftKit, THREE = W.THREE;
    const S = SPECIES[kind], D = prep(kind), C = colours(S, coat);
    const G = LK.geo();
    const SG = [], FE = [];
    const one = [0, 1];
    function mark(n0, seg, fe) {
      for (let i = n0; i < G.n; i++) {
        const s = typeof seg === "function" ? seg(G.p[i * 3], G.p[i * 3 + 1], G.p[i * 3 + 2]) : seg;
        SG.push(s[0], s[1], s[2], s[3]);
        FE.push(fe ? fe[0] : 0, fe ? fe[1] : 0, fe ? fe[2] : 0, fe ? fe[3] : 0);
      }
    }
    const nS = function (n) { return far ? Math.max(4, Math.round(n * 0.4)) : n; };
    // ---- the trunk (contour feathers)
    {
      const n0 = G.n, keys = S.body.map(function (b) {
        const yc = (b[1] + b[2]) / 2, r = (b[1] - b[2]) / 2;
        return { x: b[0], y: yc, rt: r, rb: r, w: b[3], wts: one, sq: 0.92 };
      });
      LK.sweep(G, keys, { S: nS(16), n: far ? 1 : 2, part: "body", capLen: 0.9, capRings: far ? 1 : 2, colour: function (x, y, z, ca) { return S.bodyCol(x, y, z, ca, C); } });
      mark(n0, [0, CHAIN.body, 0, 0]);
    }
    // ---- the neck (its base inside the trunk, its top inside the head)
    const NK = S.neck, H = S.head, BL = S.bill;
    {
      const n0 = G.n, keys = [];
      for (let i = 0; i < 4; i++) {
        const t = i / 3;
        keys.push({ x: lerp(NK.base[0], NK.top[0], t), y: lerp(NK.base[1], NK.top[1], t), rt: NK.r * (1.12 - 0.3 * t), rb: NK.r * (1.2 - 0.34 * t), w: NK.r * (1.08 - 0.26 * t), wts: one });
      }
      LK.sweep(G, keys, { S: nS(12), n: 1, part: "neck", capRings: far ? 0 : 2, colour: function () { return C.hackle != null ? C.hackle : C.head; } });
      const vx = NK.top[0] - NK.base[0], vy = NK.top[1] - NK.base[1], l2 = vx * vx + vy * vy;
      mark(n0, function (x, y) { return [clamp(((x - NK.base[0]) * vx + (y - NK.base[1]) * vy) / l2, 0, 1), CHAIN.neck, 0, 0]; });
    }
    // ---- the head, bill, eyes, comb and wattles (rigid: level 2)
    {
      const n0 = G.n, hc = H.c;
      const keys = [
        { x: hc[0] - H.len * 0.5, y: hc[1], rt: H.h * 0.32, rb: H.h * 0.32, w: H.w * 0.34 },
        { x: hc[0] - H.len * 0.3, y: hc[1] + 0.003, rt: H.h * 0.5, rb: H.h * 0.46, w: H.w * 0.48 },
        { x: hc[0], y: hc[1] + 0.004, rt: H.h * 0.52, rb: H.h * 0.47, w: H.w * 0.5 },
        { x: hc[0] + H.len * 0.28, y: hc[1] - 0.002, rt: H.h * 0.38, rb: H.h * 0.4, w: H.w * 0.38 },
        { x: hc[0] + H.len * 0.46, y: hc[1] - H.h * 0.08, rt: BL.d * 0.62, rb: BL.d * 0.6, w: BL.w * 0.78 },
      ];
      keys.forEach(function (k) { k.wts = one; });
      LK.sweep(G, keys, { S: nS(14), n: far ? 1 : 2, part: "head", capRings: far ? 1 : 2, colour: function () { return C.head; } });
      // the bill: the upper mandible hooked at the tip, the lower angled at the gonys
      const bx0 = hc[0] + H.len * 0.4, by0 = hc[1] - H.h * 0.08;
      const billCol = lin(C.raw.billCol != null ? C.raw.billCol : BL.col);
      const up = [];
      for (let i = 0; i < 5; i++) {
        const t = i / 4;
        up.push({ x: bx0 + BL.len * t, y: by0 + BL.d * 0.2 - BL.hook * t * t * 1.3, rt: BL.d * 0.36 * (1 - t * 0.7), rb: BL.d * 0.1 * (1 - t * 0.5), w: BL.w * 0.5 * (1 - t * 0.55), wts: one });
      }
      LK.sweep(G, up, { S: far ? 4 : 8, n: 1, part: "bill", capLen: 0.5, capRings: 0, colour: function () { return billCol; } });
      const lo = [];
      for (let i = 0; i < 4; i++) {
        const t = i / 3;
        const g = t < BL.gonys ? t / BL.gonys : 1 - (t - BL.gonys) / (1 - BL.gonys);
        lo.push({ x: bx0 + BL.len * 0.9 * t, y: by0 - BL.d * 0.12 - g * BL.d * 0.1, rt: BL.d * 0.08, rb: BL.d * (0.3 + 0.14 * g) * (1 - t * 0.45), w: BL.w * 0.42 * (1 - t * 0.5), wts: one });
      }
      const spot = lin(BL.spot);
      if (!far) LK.sweep(G, lo, { S: far ? 4 : 8, n: 1, part: "bill", capLen: 0.5, capRings: 0, colour: function (x) {
        const t = (x - bx0) / (BL.len * 0.9);
        return Math.abs(t - BL.gonys) < 0.13 ? spot : billCol;
      } });
      if (!far) {
        // eyes: the pupil, the iris round it, the orbital ring where the eye meets the head
        const E = S.eye, iris = lin(E.iris), ring = lin(E.ring), pupil = lin(0x060606);
        for (let s = -1; s <= 1; s += 2) {
          const c = [E.at[0], E.at[1], s * H.w * 0.4], ax = [0.42, 0.08, s * 0.9];
          const al = Math.hypot(ax[0], ax[1], ax[2]);
          LK.blob(G, c, [E.r, E.r, E.r * 0.85], { fwd: ax, wts: one, part: "eye", S: 10, rings: 3, colour: function (x, y, z) {
            const d = ((x - c[0]) * ax[0] + (y - c[1]) * ax[1] + (z - c[2]) * ax[2]) / al / E.r;
            return d > 0.9 ? pupil : d > 0.38 ? iris : ring;
          } });
        }
      }
      if (S.comb) {
        const cb = S.comb, ch = cb.h * (C.raw.combH || 1), cc = lin(cb.col);
        const cx0 = hc[0] - cb.len * 0.4;
        const nP = far ? 1 : cb.n;
        for (let k = 0; k < nP; k++) {
          const t = nP === 1 ? 0.5 : k / (nP - 1), x = cx0 + cb.len * t;
          const hgt = ch * (nP === 1 ? 0.8 : 0.55 + 0.45 * Math.sin(PI * (0.12 + 0.76 * t)));
          LK.blob(G, [x, hc[1] + H.h * 0.42 + hgt * 0.42, 0], [nP === 1 ? cb.len * 0.5 : cb.len / cb.n * 0.62, hgt * 0.55, 0.0035], { wts: one, part: "comb", S: far ? 4 : 6, rings: 2, colour: function () { return cc; } });
        }
        if (!far) LK.blob(G, [hc[0] + cb.len * 0.08, hc[1] + H.h * 0.44, 0], [cb.len * 0.55, ch * 0.22, 0.0045], { wts: one, part: "comb", S: 8, rings: 2, colour: function () { return cc; } });
        const lobe = lin(C.raw.lobe != null ? C.raw.lobe : S.lobe);
        for (let s = -1; s <= 1; s += 2) {
          LK.blob(G, [bx0 - 0.004, by0 - BL.d * 0.55 - S.wattle * 0.45, s * 0.0055], [S.wattle * 0.3, S.wattle * 0.55, 0.0035], { wts: one, part: "comb", S: far ? 4 : 8, rings: 2, colour: function () { return cc; } });
          if (!far) LK.blob(G, [hc[0] - H.len * 0.1, hc[1] - H.h * 0.14, s * H.w * 0.47], [0.0065, 0.0085, 0.002], { wts: one, part: "comb", S: 6, rings: 2, colour: function () { return lobe; } });
        }
      }
      mark(n0, [2, CHAIN.neck, 0, 0]);
    }
    // ---- the tail: rectrices from the tail root; a chicken's form a roof
    {
      const TL = S.tail, tailCol = C.tail != null ? C.tail : C.wing;
      const n = far ? 3 : TL.n;
      for (let k = 0; k < n; k++) {
        const fi = n > 1 ? k / (n - 1) : 0.5, off = (fi - 0.5) * 2;
        const n0 = G.n;
        let len = TL.len * (1 - (TL.round / TL.len) * off * off);
        const sickle = TL.sickle && Math.abs(off) < 0.4;
        if (sickle) len = TL.sickle * (1 - Math.abs(off) * 0.5);
        const roof = TL.roof || 0;
        const bx = TL.root[0], by = TL.root[1] - Math.abs(off) * roof * 0.012, bz = off * 0.012;
        const ux = -Math.cos(TL.up), uy = Math.sin(TL.up);
        const ex = bx + ux * len, ey = by + uy * len - Math.abs(off) * roof * len * 0.35, ez = off * TL.half * (roof ? 1.4 : 1);
        const vUp = roof ? [0, Math.cos(roof * 0.9), off > 0 ? Math.sin(roof * 0.9) : -Math.sin(roof * 0.9)] : [0, 1, 0];
        const keys = [], NKey = far ? (sickle ? 3 : 2) : (sickle ? 6 : 4);
        for (let i = 0; i < NKey; i++) {
          const t = i / (NKey - 1);
          // a sickle arches up and over, then falls
          const arch = sickle ? Math.sin(PI * t) * len * 0.3 - t * t * len * 0.45 : 0;
          const wv = (sickle ? 0.016 : TL.w * (far ? 2.4 : 1)) * (0.7 + 0.4 * Math.sin(PI * (0.2 + 0.7 * t)));
          keys.push({ x: lerp(bx, ex, t), y: lerp(by, ey, t) + arch, z: lerp(bz, ez, t), rt: 0.0016, rb: 0.0016, w: wv, wts: one, up: vUp, ft: t });
        }
        LK.sweep(G, keys, { S: 4, n: 1, part: "tail", capRings: 0, capLen: 1.0, colour: function () { return tailCol; } });
        mark(n0, function (x) { return [clamp((TL.root[0] + 0.004 - x) / 0.016, 0, 1), CHAIN.tail, 0, fi]; });
      }
    }
    // ---- the wings and the legs, each side built (not mirrored)
    for (let s = -1; s <= 1; s += 2) buildWing(G, mark, S, D, C, s, far);
    for (let s = -1; s <= 1; s += 2) buildLeg(G, mark, S, C, s, far);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(G.p, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(G.c, 3));
    geo.setAttribute("bseg", new THREE.Float32BufferAttribute(SG, 4));
    geo.setAttribute("bfe", new THREE.Float32BufferAttribute(FE, 4));
    geo.setIndex(G.ix);
    geo.computeVertexNormals();
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, S.wing.y * 0.8, 0), S.span * 0.55 + 0.1);
    // the box a host measures (a battle's footprint, aim heights): the bird
    // standing with its wings folded, not the spread rest pose
    const bb = new THREE.Box3(), v = new THREE.Vector3();
    for (let i = 0; i < G.n; i++) if (Math.round(SG[i * 4 + 1]) !== CHAIN.wing) bb.expandByPoint(v.set(G.p[i * 3], G.p[i * 3 + 1], G.p[i * 3 + 2]));
    let wMax = 0;
    S.body.forEach(function (b) { wMax = Math.max(wMax, b[3]); });
    bb.min.z = Math.min(bb.min.z, -(wMax + S.fold.out + 0.012)); bb.max.z = Math.max(bb.max.z, wMax + S.fold.out + 0.012);
    geo.boundingBox = bb;
    geo._shared = true;
    return geo;
  }
  function buildWing(G, mark, S, D, C, s, far) {
    const LK = CBZ.loftKit, WG = S.wing, P = D.P, y = WG.y;
    const upv = [0, 1, 0];
    // the covert band over the bones: round and thick at the leading edge,
    // thin aft; its joint level ramps across the elbow and the wrist
    {
      const n0 = G.n, keys = [];
      const pts = far ? [[P.sh[0] + 0.004, P.sh[1] - 0.012, 0], [P.el[0], P.el[1], 1], [P.wr[0], P.wr[1], 2], [P.tp[0], P.tp[1], 2]] : [
        [P.sh[0] + 0.004, P.sh[1] - 0.012, 0], [P.sh[0], P.sh[1] + 0.012, 0], [lerp(P.sh[0], P.el[0], 0.55), lerp(P.sh[1], P.el[1], 0.55), 0], [P.el[0], P.el[1], 1],
        [lerp(P.el[0], P.wr[0], 0.5), lerp(P.el[1], P.wr[1], 0.5), 1], [P.wr[0], P.wr[1], 2], [lerp(P.wr[0], P.tp[0], 0.55), lerp(P.wr[1], P.tp[1], 0.55), 2], [P.tp[0], P.tp[1], 2]];
      for (let i = 0; i < pts.length; i++) {
        const seg = pts[i][2], t = i / (pts.length - 1);
        const ch = WG.cov[seg] * (i === pts.length - 1 ? 0.55 : 1);
        keys.push({ x: pts[i][0] - ch * 0.42, y: y, z: s * pts[i][1], rt: 0.009 * (1 - t * 0.45), rb: 0.006 * (1 - t * 0.45), w: ch * 0.5, wts: [0, 1], up: upv });
      }
      const prof = function (R, ca, sa, o) {
        const aft = (s > 0 ? sa : -sa) * 0.5 + 0.5;
        const th = 0.22 + 0.78 * Math.pow(1 - aft, 0.8);
        o.u = ca * (ca >= 0 ? R.rt : R.rb) * th; o.s = sa * R.w; o.f = 0;
      };
      LK.sweep(G, keys, { S: far ? 4 : 8, n: far ? 1 : 2, part: "wing", prof: prof, capLen: 0.4, capRings: 0, colour: function (x, yy, z, ca) { return ca >= 0 ? C.wing : C.under; } });
      const b = 0.012;
      mark(n0, function (x, yy, z) {
        const az = Math.abs(z);
        if (az > P.wr[1] - b) return [2 + clamp((az - (P.wr[1] - b)) / (2 * b), 0, 1), CHAIN.wing, s, 0];
        return [1 + clamp((az - (P.el[1] - b)) / (2 * b), 0, 1), CHAIN.wing, s, 0];
      }, [0, 0, 0, 1]);
    }
    // the flight feathers: each a thin vane from its quill, at the level of
    // the bone it rides
    const feathers = far ? D.far : D.near;
    for (const f of feathers) {
      const n0 = G.n, d = inPlane(f.ang);
      const b = [f.base[0], y - 0.002, s * f.base[1]];
      const tip = [f.base[0] + d[0] * f.len, y - 0.004, s * (f.base[1] + d[2] * f.len)];
      const keys = [], NK = far ? 2 : (f.grp === "pri" ? 5 : 4);
      for (let i = 0; i < NK; i++) {
        const t = i / (NK - 1);
        let w = far ? lerp(f.wMid * 0.8, f.wTip, t) : (t < 0.5 ? lerp(f.wMid * 0.55, f.wMid, t / 0.5) : lerp(f.wMid, f.wTip, (t - 0.5) / 0.5));
        if (t > 0.88 && !far) w *= 0.7;
        if (f.finger && t > 0.5) w *= 0.5;
        keys.push({ x: lerp(b[0], tip[0], t), y: lerp(b[1], tip[1], t), z: lerp(b[2], tip[2], t), rt: 0.0016, rb: 0.0016, w: w, wts: [0, 1], up: upv, ft: t });
      }
      LK.sweep(G, keys, { S: 4, n: 1, part: "wing", capRings: 0, capLen: 1.0, colour: function (x, yy, z, ca, sa, R) {
        return lin(S.feather(f.grp, f.fi, R.ft, ca >= 0, C.raw));
      } });
      mark(n0, [f.lvl, CHAIN.wing, s, f.fi], [f.base[0], f.base[1], f.turn, f.order]);
    }
  }
  function buildLeg(G, mark, S, C, s, far) {
    const LK = CBZ.loftKit, LG = S.leg;
    const legCol = lin(C.raw.legCol != null ? C.raw.legCol : LG.col);
    const z = s * LG.hip[2];
    const hip = [LG.hip[0], LG.hip[1]], kn = LG.kn, an = LG.an;
    const r = LG.r, Sg = far ? 3 : 8;
    // the drumstick (tibiotarsus): feathered at the top, bare below `bare`
    {
      const n0 = G.n;
      const keys = [
        { x: hip[0] + 0.006, y: hip[1] + 0.028, z: z * 0.85, rt: r[0] * 1.3, rb: r[0] * 1.3, w: r[0] * 1.2, wts: [0, 1] },
        { x: lerp(hip[0], kn[0], 0.35), y: lerp(hip[1], kn[1], 0.35), z: z, rt: r[0], rb: r[0], w: r[0] * 0.9, wts: [0, 1] },
        { x: kn[0], y: kn[1] + 0.006, z: z, rt: r[1] * 1.25, rb: r[1] * 1.25, w: r[1] * 1.2, wts: [0, 1] },
      ];
      const bodyCol = C.body;
      LK.sweep(G, keys, { S: Sg, n: far ? 1 : 2, part: "leg", capRings: 0, colour: function (x, y) { return y > LG.bare ? bodyCol : (LG.feathered && y > kn[1] + 0.025 ? bodyCol : legCol); } });
      mark(n0, function (x, y) { return [clamp((hip[1] + 0.012 - y) / 0.024, 0, 1), CHAIN.leg, s, 0]; });
    }
    // the tarsus (shank), with the cock's spur
    {
      const n0 = G.n;
      const keys = [
        { x: kn[0], y: kn[1] + 0.006, z: z, rt: r[1] * 1.15, rb: r[1] * 1.15, w: r[1] * 1.1, wts: [0, 1] },
        { x: lerp(kn[0], an[0], 0.5), y: lerp(kn[1], an[1], 0.5), z: z, rt: r[1], rb: r[1], w: r[1] * 0.95, wts: [0, 1] },
        { x: an[0], y: an[1] + 0.003, z: z, rt: r[1] * 1.1, rb: r[1] * 1.1, w: r[1] * 1.15, wts: [0, 1] },
      ];
      LK.sweep(G, far ? [keys[0], keys[2]] : keys, { S: far ? 3 : 6, n: 1, part: "leg", capRings: 0, colour: function () { return legCol; } });
      mark(n0, function (x, y) { return [1 + clamp((kn[1] + 0.006 - y) / 0.012, 0, 1), CHAIN.leg, s, 0]; });
      if (LG.spur && !far) {
        const n1 = G.n, sy = lerp(kn[1], an[1], 0.68), sx = lerp(kn[0], an[0], 0.68);
        LK.cone(G, [sx - 0.003, sy, z], [sx - 0.022, sy + 0.004, z - s * 0.004], 0.004, { wts: [0, 1], part: "leg", S: 5, hex: legCol });
        mark(n1, [2, CHAIN.leg, s, 0]);
      }
    }
    // the toes: three forward, the hallux behind; a gull's front toes webbed
    {
      const n0 = G.n, L = LG.toe, tr = r[2];
      const angs = far ? [0] : [-0.42, 0, 0.42];
      const tips = [];
      for (let k = 0; k < angs.length; k++) {
        const a = angs[k] * s, len = L * (angs[k] === 0 ? 1 : 0.84);
        const tip = [an[0] + Math.cos(a) * len, 0.0028, z + Math.sin(a) * len];
        tips.push(tip);
        LK.sweep(G, [{ x: an[0] + 0.002, y: an[1], z: z, rt: tr, rb: tr, w: tr, wts: [0, 1] },
          { x: lerp(an[0], tip[0], 0.55), y: 0.0042, z: lerp(z, tip[2], 0.55), rt: tr * 0.8, rb: tr * 0.75, w: tr * 0.85, wts: [0, 1] },
          { x: tip[0], y: tip[1], z: tip[2], rt: tr * 0.45, rb: tr * 0.45, w: tr * 0.5, wts: [0, 1] }], { S: far ? 3 : 5, n: 1, part: "leg", capRings: 0, capLen: 0.8, colour: function () { return legCol; } });
      }
      if (!far) {
        LK.sweep(G, [{ x: an[0], y: an[1], z: z, rt: tr * 0.8, rb: tr * 0.8, w: tr * 0.8, wts: [0, 1] }, { x: an[0] - LG.hal, y: 0.0035 + (LG.web ? 0.004 : 0), z: z, rt: tr * 0.45, rb: tr * 0.45, w: tr * 0.45, wts: [0, 1] }],
          { S: 5, n: 1, part: "leg", capRings: 0, capLen: 0.8, colour: function () { return legCol; } });
        if (LG.web) {
          // the web between the front toes
          const keys = [];
          for (let i = 0; i < 4; i++) {
            const t = i / 3;
            const mx = lerp(an[0], tips[1][0], t * 0.9), mz = lerp(z, tips[1][2], t * 0.9);
            const half = Math.abs(lerp(0, tips[2][2] - tips[0][2], t * 0.9)) * 0.5 * (t > 0.8 ? 0.85 : 1);
            keys.push({ x: mx, y: 0.0036, z: mz, rt: 0.0009, rb: 0.0009, w: Math.max(0.003, half), wts: [0, 1], up: [0, 1, 0] });
          }
          LK.sweep(G, keys, { S: 4, n: 1, part: "leg", capRings: 0, capLen: 0.4, colour: function () { return legCol; } });
        }
      }
      mark(n0, function (x, y) { return [2 + clamp((an[1] + 0.003 - y) / 0.004, 0, 1), CHAIN.leg, s, 0]; });
    }
  }

  // ==========================================================================
  //  THE POSE (vertex shader). Every rotation is about a rest-pose pivot,
  //  applied from the tip of a chain to its root (forward kinematics).
  // ==========================================================================
  const GLSL = [
    "attribute vec4 bseg; attribute vec4 bfe; attribute vec4 bA; attribute vec4 bB; attribute vec4 bC; attribute vec4 bD;",
    "uniform vec3 uSh; uniform vec3 uEl; uniform vec3 uWr; uniform vec3 uHip; uniform vec3 uKn; uniform vec3 uAn; uniform vec3 uNk; uniform vec3 uHd; uniform vec3 uTl;",
    "uniform vec4 uFl; uniform vec4 uGl; uniform vec4 uTw; uniform vec4 uFo; uniform vec4 uFo2; uniform vec4 uFo3; uniform vec4 uLg; uniform vec4 uLg2; uniform vec4 uLg3;",
    "mat3 bRX( float a ) { float c = cos( a ), s = sin( a ); return mat3( 1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c ); }",
    "mat3 bRY( float a ) { float c = cos( a ), s = sin( a ); return mat3( c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c ); }",
    "mat3 bRZ( float a ) { float c = cos( a ), s = sin( a ); return mat3( c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0 ); }",
    "void birdPose( inout vec3 p, inout vec3 n ) {",
    "  float chain = floor( bseg.y + 0.5 ); float lvl = bseg.x; float sz = bseg.z < 0.0 ? -1.0 : 1.0;",
    "  float ph = fract( bA.x ); float fk = clamp( bA.y, 0.0, 1.0 ); float fold = clamp( bA.z, 0.0, 1.0 ); float flare = clamp( bA.w, 0.0, 1.0 );",
    "  float open = 1.0 - fold;",
    "  float wk = clamp( bB.z, 0.0, 1.0 ); float sit = clamp( bB.w, 0.0, 1.0 ); float on = smoothstep( 0.0, 0.15, wk );",
    "  float duty = uLg.y; float sp0 = fract( bB.x );",
    // the hips rise over each stance foot and settle when sitting; the body
    // heaves with the wingbeat (lowest mid-downstroke, highest mid-upstroke)
    "  float bodyY = on * uLg.w * 0.5 * ( cos( 12.5663706 * ( sp0 - 0.5 * duty ) ) - 1.0 ) - sit * uLg3.z - uTw.y * fk * open * cos( 6.2831853 * ( ph - 0.275 ) );",
    "  float roll = on * uLg2.w * sin( 6.2831853 * ( sp0 - 0.5 * duty + 0.25 ) );",
    "  mat3 R;",
    "  p.z *= sz; n.z *= sz;",
    "  if ( chain > 0.5 && chain < 1.5 ) {",
    // the stroke: down over 55% of the beat, up over 45%
    "    float dn = step( ph, 0.55 );",
    "    float u = dn > 0.5 ? ph / 0.55 : ( ph - 0.55 ) / 0.45;",
    "    float e = dn > 0.5 ? cos( 3.14159265 * u ) : -cos( 3.14159265 * u );",
    "    float sUp = ( 1.0 - dn ) * sin( 3.14159265 * u ); float sDn = dn * sin( 3.14159265 * u );",
    "    float elev = mix( uGl.x, uFl.y + uFl.x * e, fk ) + flare * 0.5;",
    "    float sweep = fk * ( 0.3 * sUp - 0.06 * sDn ) - flare * 0.2;",
    "    float twist = ( fk * uTw.x * ( sUp - sDn ) + flare * 0.45 ) * open;",
    "    float flexE = mix( uGl.y, uFl.z * sUp, fk ) + flare * 0.1;",
    "    float flexW = mix( uGl.z, uFl.w * sUp, fk ) + flare * 0.2;",
    "    float droop = uGl.w * ( 1.0 - fk ) * ( 1.0 - flare ) * open;",
    "    elev = mix( elev, uFo2.y, fold ); sweep = mix( sweep, uFo.x, fold );",
    "    flexE = mix( flexE, uFo.y, fold ); flexW = mix( flexW, uFo.z, fold );",
    "    float f3 = clamp( lvl - 2.0, 0.0, 1.0 ); float f2 = clamp( lvl - 1.0, 0.0, 1.0 ); float f1 = clamp( lvl, 0.0, 1.0 );",
    // each flight feather turns about its quill with the joint it rides
    "    float drv = lvl > 2.5 ? flexW / uFo.z : ( lvl > 1.5 ? flexE / uFo.y : fold );",
    // the folded stack: inner feathers over outer, lifted off the wing's plane
    "    p.y += fold * uFo3.x * bfe.w * mix( 0.3, 1.0, f2 );",
    "    vec3 fb = vec3( bfe.x, p.y, bfe.y );",
    "    R = bRY( -bfe.z * drv ); p = fb + R * ( p - fb ); n = R * n;",
    "    R = bRX( droop * f3 ) * bRY( -flexW * f3 ); p = uWr + R * ( p - uWr ); n = R * n;",
    "    R = bRY( uFo2.x * fold * f2 ) * bRZ( uFo.w * fold * f2 ) * bRY( flexE * f2 ); p = uEl + R * ( p - uEl ); n = R * n;",
    "    R = bRX( -elev * f1 ) * bRY( -sweep * f1 ) * bRZ( twist * f1 ); p = uSh + R * ( p - uSh ); n = R * n;",
    "    p.y -= fold * uFo2.z * f3;",
    "    p.z += fold * uFo2.w * f1;",
    "  } else if ( chain > 1.5 && chain < 2.5 ) {",
    // two-bone IK: the stance foot sweeps back at the body's pace, the swing
    // foot lifts and comes through; the toes stay flat on the ground
    "    float legK = clamp( bB.y, 0.0, 1.0 );",
    "    float lp = fract( bB.x + ( sz < 0.0 ? 0.5 : 0.0 ) );",
    "    float st = step( lp, duty );",
    "    float u = st > 0.5 ? lp / duty : ( lp - duty ) / ( 1.0 - duty );",
    "    float hs = 0.5 * duty * uLg.x * ( 0.35 + 0.65 * wk ) * on;",
    "    float ax = st > 0.5 ? mix( hs, -hs, u ) : mix( -hs, hs, smoothstep( 0.0, 1.0, u ) );",
    "    float ay = st > 0.5 ? 0.0 : uLg.z * on * ( 0.5 + 0.5 * wk ) * sin( 3.14159265 * u );",
    "    vec2 H = vec2( uHip.x, uHip.y + bodyY - sz * uHip.z * sin( roll ) );",
    "    vec2 A = vec2( uAn.x + ax, uAn.y + ay );",
    "    vec2 T0 = uKn.xy - uHip.xy; vec2 S0 = uAn.xy - uKn.xy;",
    "    float L1 = length( T0 ); float L2 = length( S0 );",
    "    vec2 Dv = A - H;",
    "    float d = clamp( length( Dv ), abs( L1 - L2 ) + 1e-4, L1 + L2 - 1e-4 );",
    "    float al = acos( clamp( ( L1 * L1 + d * d - L2 * L2 ) / ( 2.0 * L1 * d ), -1.0, 1.0 ) );",
    "    float t1 = atan( Dv.y, Dv.x ) - al;",
    "    vec2 K = H + L1 * vec2( cos( t1 ), sin( t1 ) );",
    "    float a1 = t1 - atan( T0.y, T0.x );",
    "    float a2 = atan( A.y - K.y, A.x - K.x ) - atan( S0.y, S0.x ) - a1;",
    // toes flat on the ground in stance; curled in the swing only as far as the foot clears
    "    float a3 = -( a1 + a2 ) - ( 1.0 - st ) * on * 0.85 * asin( clamp( ( A.y - 0.004 ) / uLg3.w, 0.0, 1.0 ) );",
    "    a1 = mix( uLg2.x, a1, legK ); a2 = mix( uLg2.y, a2, legK ); a3 = mix( uLg2.z, a3, legK );",
    "    a1 = mix( a1, uLg3.x, sit ); a2 = mix( a2, uLg3.y, sit ); a3 = mix( a3, -( uLg3.x + uLg3.y ), sit );",
    "    float f3 = clamp( lvl - 2.0, 0.0, 1.0 ); float f2 = clamp( lvl - 1.0, 0.0, 1.0 ); float f1 = clamp( lvl, 0.0, 1.0 );",
    "    R = bRZ( a3 * f3 ); p = uAn + R * ( p - uAn ); n = R * n;",
    "    R = bRZ( a2 * f2 ); p = uKn + R * ( p - uKn ); n = R * n;",
    "    R = bRZ( a1 * f1 ); p = uHip + R * ( p - uHip ); n = R * n;",
    "    p.z *= sz; n.z *= sz;",
    "    p.y += H.y - uHip.y;",
    "    return;",
    "  } else if ( chain > 2.5 && chain < 3.5 ) {",
    // the neck turns about its base; the head about the neck's top so that
    // it sits at its own pitch to the body, turned and tilted to look
    "    float f2 = clamp( lvl - 1.0, 0.0, 1.0 ); float f1 = clamp( lvl, 0.0, 1.0 );",
    "    R = bRY( bC.z * 0.6 * f2 ) * bRX( bD.y * f2 ) * bRZ( -( bC.y - bC.x ) * f2 ); p = uHd + R * ( p - uHd ); n = R * n;",
    "    R = bRY( bC.z * 0.4 * f1 ) * bRZ( -bC.x * f1 ); p = uNk + R * ( p - uNk ); n = R * n;",
    "    p.x += bD.x * f1 * ( 0.3 + 0.7 * f2 );",
    "  } else if ( chain > 3.5 ) {",
    "    float f1 = clamp( lvl, 0.0, 1.0 );",
    "    float tp = bD.z - 0.4 * flare + 0.07 * fk * open * sin( 6.2831853 * ph ) + 0.05 * on * sin( 12.5663706 * sp0 );",
    "    float fan = clamp( flare + uTw.z * ( 1.0 - fk ) * open * ( 1.0 - wk ), 0.0, 1.0 );",
    "    R = bRZ( tp * f1 ) * bRY( fan * ( bseg.w - 0.5 ) * 1.5 * f1 ); p = uTl + R * ( p - uTl ); n = R * n;",
    "  }",
    "  p.z *= sz; n.z *= sz;",
    // the body pitches about the hips, rolls over the stance foot, rises and heaves
    "  vec3 hp = vec3( uHip.x, uHip.y, 0.0 );",
    "  R = bRX( roll ) * bRZ( -bC.w ); p = hp + R * ( p - hp ); n = R * n;",
    "  p.y += bodyY;",
    "}",
  ].join("\n");
  const _mats = new Map();
  function v3(a) { return new W.THREE.Vector3(a[0], a[1], a[2]); }
  function v4(a) { return new W.THREE.Vector4(a[0], a[1], a[2], a[3]); }
  function inject(sh, U, depth) {
    for (const k in U) sh.uniforms[k] = U[k];
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\n" + GLSL);
    if (depth) {
      sh.vertexShader = sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n  { vec3 birdN = vec3( 0.0, 1.0, 0.0 ); birdPose( transformed, birdN ); }");
    } else {
      sh.vertexShader = sh.vertexShader
        .replace("#include <beginnormal_vertex>", "#include <beginnormal_vertex>\n  vec3 birdP = vec3( position );\n  birdPose( birdP, objectNormal );")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\n  transformed = birdP;");
    }
  }
  function materialOf(kind) {
    let m = _mats.get(kind);
    if (m) return m;
    const THREE = W.THREE, D = prep(kind);
    const U = {};
    for (const k in D.u) U[k] = { value: D.u[k].length === 3 ? v3(D.u[k]) : v4(D.u[k]) };
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    mat.name = "bird-" + kind; mat._shared = true;
    mat.onBeforeCompile = function (sh) { inject(sh, U, false); };
    mat.customProgramCacheKey = function () { return "bird|" + kind; };
    const dm = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    dm.onBeforeCompile = function (sh) { inject(sh, U, true); };
    dm.customProgramCacheKey = function () { return "birdDepth|" + kind; };
    m = { mat: mat, depth: dm, U: U };
    _mats.set(kind, m);
    return m;
  }
  const _geos = new Map();
  function geometryOf(kind, coat, far) {
    const key = kind + "|" + (coat || "") + "|" + (far ? 1 : 0);
    let g = _geos.get(key);
    if (!g) { g = buildBird(kind, coat, far); _geos.set(key, g); }
    return g;
  }
  function resolveKind(kind) { return kind === "chicken" ? "hen" : (kind === "songbird" ? "crow" : kind); }

  // ==========================================================================
  //  INSTANCES: one InstancedMesh carries a flock (or one bird); its three
  //  per-instance vec4s are the pose
  // ==========================================================================
  function instanced(kind, coat, n, far) {
    const THREE = W.THREE;
    const base = geometryOf(kind, coat, far);
    const geo = new THREE.BufferGeometry();
    for (const k in base.attributes) geo.setAttribute(k, base.attributes[k]);
    geo.setIndex(base.index);
    geo.boundingSphere = base.boundingSphere.clone();
    geo.boundingBox = base.boundingBox.clone();
    const mk = function () { const a = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4); a.setUsage(THREE.DynamicDrawUsage); return a; };
    const A = mk(), B = mk(), Cc = mk(), Dd = mk();
    geo.setAttribute("bA", A); geo.setAttribute("bB", B); geo.setAttribute("bC", Cc); geo.setAttribute("bD", Dd);
    const M = materialOf(kind);
    const mesh = new THREE.InstancedMesh(geo, M.mat, n);
    mesh.customDepthMaterial = M.depth;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    return { mesh: mesh, A: A, B: B, C: Cc, D: Dd, n: n };
  }
  function writeParams(I, i, p) {
    const a = I.A.array, b = I.B.array, c = I.C.array, d = I.D.array, o = i * 4;
    a[o] = p.phase || 0; a[o + 1] = p.flap || 0; a[o + 2] = p.fold || 0; a[o + 3] = p.flare || 0;
    b[o] = p.step || 0; b[o + 1] = p.legs == null ? 1 : p.legs; b[o + 2] = p.walk || 0; b[o + 3] = p.sit || 0;
    c[o] = p.pitch || 0; c[o + 1] = p.head || 0; c[o + 2] = p.yaw || 0; c[o + 3] = p.body || 0;
    d[o] = p.bob || 0; d[o + 1] = p.tilt || 0; d[o + 2] = p.tail || 0; d[o + 3] = 0;
  }
  function dirty(I) { I.A.needsUpdate = true; I.B.needsUpdate = true; I.C.needsUpdate = true; I.D.needsUpdate = true; I.mesh.instanceMatrix.needsUpdate = true; }
  /* a flock: a near and a far InstancedMesh (two draws). Per frame:
     begin(); add(matrix, params, far) for each bird in view; end() */
  function flock(kind, n, o) {
    o = o || {};
    kind = resolveKind(kind);
    const near = instanced(kind, o.coat, n, false), farI = instanced(kind, o.coat, n, true);
    near.mesh.name = o.name || ("birds-" + kind); farI.mesh.name = (o.name || ("birds-" + kind)) + "-far";
    near.mesh.frustumCulled = false; farI.mesh.frustumCulled = false;
    let nn = 0, nf = 0;
    return {
      mesh: near.mesh, far: farI.mesh, kind: kind,
      begin: function () { nn = 0; nf = 0; },
      add: function (m4, p, isFar) {
        const I = isFar ? farI : near;
        const i = isFar ? nf++ : nn++;
        if (i >= n) return;
        I.mesh.setMatrixAt(i, m4);
        writeParams(I, i, p);
      },
      end: function () {
        near.mesh.count = Math.min(nn, n); farI.mesh.count = Math.min(nf, n);
        near.mesh.visible = near.mesh.count > 0; farI.mesh.visible = farI.mesh.count > 0;
        dirty(near); dirty(farI);
      },
    };
  }
  // the per-instance numbers a mode means (a flock writes the same ones)
  function params(kind, mode, phase, out) {
    kind = resolveKind(kind);
    const S = SPECIES[kind] || SPECIES.gull, D = prep(S.id);
    out = out || {};
    out.phase = phase || 0; out.flap = 0; out.fold = 0; out.flare = 0;
    out.step = 0; out.legs = 1; out.walk = 0; out.sit = 0;
    out.pitch = 0; out.head = 0; out.yaw = 0; out.body = 0; out.bob = 0; out.tilt = 0; out.tail = 0;
    if (mode === "flap") { out.flap = 1; out.legs = 0; out.pitch = S.flight.neck; out.head = S.flight.head; }
    else if (mode === "glide") { out.legs = 0; out.pitch = S.flight.neck; out.head = S.flight.head; }
    else if (mode === "perch") { out.fold = 1; }
    else if (mode === "walk") { out.fold = 1; out.walk = 1; out.step = phase || 0; out.phase = 0; }
    else if (mode === "land") { out.flare = 1; out.flap = 0.35; out.pitch = S.flight.neck * 0.5; out.head = S.flight.head; }
    else if (mode === "float") { out.fold = 1; out.walk = 0.25; out.step = phase || 0; out.phase = 0; }
    else if (mode === "sit") { out.fold = 1; out.sit = 1; }
    else if (mode === "peck") { out.fold = 1; out.pitch = D.peck.neck; out.head = D.peck.head; out.body = D.peck.body; }
    return out;
  }
  // a half-metre bird draws its far body beyond this many metres
  const LOD_FAR = 18;
  /* build(kind, seed) -> rig: one bird on the flock's own mesh and shader */
  function build(kind, seed) {
    const THREE = W.THREE;
    if (!THREE || !CBZ.loftKit || !CBZ.loftKit.sweep) return null;
    seed = Math.abs(seed | 0) || 1;
    const r = mkRng(seed * 2654435761 + 3);
    let k = kind, coat = null;
    if (kind === "chicken") k = r() < 0.25 ? "rooster" : "hen";
    if (k === "songbird") k = "crow";
    if (k === "hen") { const x = r(); coat = x < 0.6 ? "red" : x < 0.85 ? "leghorn" : "australorp"; }
    if (!SPECIES[k]) return null;
    const S = SPECIES[k];
    const group = new THREE.Group();
    group.userData.dynamic = true;
    // the near body and the far one share the pose; one is drawn
    const I = instanced(k, coat, 1, false), If = instanced(k, coat, 1, true);
    [I, If].forEach(function (J, j) {
      J.mesh.name = "bird-" + k + (j ? "-far" : "");
      J.mesh.setMatrixAt(0, new THREE.Matrix4());
      J.mesh.frustumCulled = false;
      J.mesh.castShadow = j === 0;
      group.add(J.mesh);
    });
    If.mesh.visible = false;
    const P = params(k, "perch", 0, {});
    const write = function () { const J = I.mesh.visible ? I : If; writeParams(J, 0, P); dirty(J); };
    const rig = {
      group: group, mesh: I.mesh, meshFar: If.mesh, kind: k, coat: coat, species: S, forward: new THREE.Vector3(1, 0, 0), params: P, rng: r,
      pose: function (o) {
        o = o || {};
        params(k, o.mode || "perch", o.phase || 0, P);
        write();
        return rig;
      },
      set: function (p) { if (p !== P) Object.assign(P, p); write(); return rig; },
      // the far body beyond `far` metres from the camera (the near one keeps
      // the shadow); returns true when it swapped
      lod: function (dist, far) {
        const isFar = dist > (far || LOD_FAR * S.length / 0.5);
        if (isFar === If.mesh.visible) return false;
        If.mesh.visible = isFar; I.mesh.visible = !isFar;
        If.mesh.scale.copy(I.mesh.scale);
        write();
        return true;
      },
    };
    rig.pose({ mode: "perch" });
    return rig;
  }

  // ==========================================================================
  //  FLIGHT: wingbeats at the species' frequency in bouts — a gull beats 4-7
  //  times and glides for seconds, a crow rows with short glides, a chicken
  //  beats fast and briefly. A glide only starts when the bird is neither
  //  climbing nor slow (then the lift has to come from the wings).
  // ==========================================================================
  function wingHz(kind) { const S = SPECIES[resolveKind(kind)] || SPECIES.gull; return S.flight.hz; }
  // st persists per bird: { phase, flap, flapping, boutT }; o: { climb, slow, panic, rnd }
  function clock(kind, st, dt, o) {
    const S = SPECIES[resolveKind(kind)] || SPECIES.gull, F = S.flight;
    o = o || {};
    const rnd = o.rnd || Math.random;
    if (st.flap == null) { st.flap = 1; st.flapping = true; st.phase = rnd(); st.boutT = 0; }
    st.boutT -= dt;
    const needFlap = (o.climb || 0) > 0.35 || o.slow || o.panic;
    if (st.boutT <= 0 || (needFlap && !st.flapping)) {
      if (st.flapping && !needFlap && rnd() < F.glides) {
        st.flapping = false;
        st.boutT = S.id === "gull" ? 1.6 + rnd() * 3.0 : 0.4 + rnd() * 0.8;
      } else {
        st.flapping = true;
        st.boutT = (S.id === "gull" ? 4 + Math.floor(rnd() * 4) : 6 + Math.floor(rnd() * 8)) / F.hz;
      }
    }
    const hz = F.hz * (o.panic ? 1.2 : 1);
    // a beat runs on to the top of the stroke before the wings lock out
    if (st.flapping || frac(st.phase) > 0.02) st.phase += dt * hz;
    if (!st.flapping && frac(st.phase) < 0.06) st.phase = Math.floor(st.phase);
    if (st.phase > 1000) st.phase -= 1000;
    st.flap += ((st.flapping ? 1 : 0) - st.flap) * Math.min(1, dt * 8);
    return st;
  }
  // a coordinated turn's bank: tan(bank) = v * turn rate / g
  function bank(v, turn) { return clamp(Math.atan(v * turn / 9.81), -1.1, 1.1); }
  // one step cycle's ground distance at walk weight w (the shader's stride)
  function stride(kind, w) {
    const S = SPECIES[resolveKind(kind)] || SPECIES.hen;
    w = w == null ? 1 : clamp(w, 0, 1);
    return S.leg.stride * (0.35 + 0.65 * w);
  }

  // ==========================================================================
  //  THE CHICKEN in the bestiary (Gang City's farms) and NPC War: a hen or a
  //  rooster that walks with the head-bob (the head holds still in space
  //  through the stance, then thrusts), forages with pecks when it is not
  //  going anywhere, bolts with the wings beating when it flees. Both hosts
  //  scale the group by the row's `scale`; the body carries the inverse.
  // ==========================================================================
  function chickenBuild(ctx) {
    const r = (ctx && ctx.rng) || Math.random;
    const seed = ctx && ctx.seed != null ? (ctx.seed | 0) * 7919 + 17 : Math.floor(r() * 1e9) + 1;
    const rig = build("chicken", seed);
    if (!rig) return null;
    const sp = CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES.chicken;
    const sc = sp && sp.scale ? sp.scale : 1;
    // real size: the engine multiplies the row's scale back in
    rig.mesh.scale.setScalar(1 / sc); rig.meshFar.scale.setScalar(1 / sc);
    rig.group.userData.birdRig = rig;
    rig.group.name = "beast:chicken";
    return rig.group;
  }
  function animateActor(a, dt) {
    const grp = a.group, rig = grp && grp.userData.birdRig;
    if (!rig) return false;
    if (!(dt > 0)) dt = 0.016;
    const S = rig.species, P = rig.params, D = prep(rig.kind);
    const cam = CBZ.camera && CBZ.camera.position;
    if (cam) rig.lod(Math.hypot(cam.x - grp.position.x, cam.y - grp.position.y, cam.z - grp.position.z));
    const st = a._bk || (a._bk = { px: null, pz: null, step: 0, peck: 0, peckT: 1 + rig.rng() * 2, look: 0, lookT: 0, flapPh: 0, flap: 0, w: 0 });
    // the hunger cue's whole-body swell is turned away (it would scale the bird)
    a._bodyMesh = null;
    const ms = rig.mesh.scale;
    if (ms.y !== ms.x || ms.z !== ms.x) { ms.y = ms.x; ms.z = ms.x; }
    const x = grp.position.x, z = grp.position.z;
    if (st.px == null) { st.px = x; st.pz = z; }
    // distance in the bird's own metres
    const k = (grp.scale && grp.scale.x || 1) * ms.x;
    let d = Math.hypot(x - st.px, z - st.pz) / Math.max(1e-3, k);
    st.px = x; st.pz = z;
    if (d > 2) d = 0;
    const v = d / dt;
    if (a.dead) {
      P.walk = 0; P.fold = 0.55; P.flap = 0; P.flare = 0; P.legs = 1; P.sit = 0; P.pitch = 0.9; P.head = 0.9; P.body = 0; P.bob = 0;
      rig.set(P);
      return true;
    }
    const flee = a.state === "flee" || !!a.routed;
    // grazing, or standing about with nothing to do: foraging
    const graze = a.state === "graze" || (!flee && st.w < 0.15 && !a.tgt && a.state !== "charge");
    // the walk weight follows the speed (full stride by ~0.45 m/s; faster is cadence)
    st.w += (clamp(v / 0.45, 0, 1) - st.w) * Math.min(1, dt * 6);
    const strd = stride(rig.kind, st.w);
    st.step = frac(st.step + d / Math.max(0.02, strd));
    // the head-bob: held in space through the stance (the body slides under
    // it), thrust forward while the other foot swings
    // (the hold lasts as long as the neck's reach lets the head stay put)
    const half = frac(st.step * 2), reach = Math.min(0.045, strd * 0.5 * S.leg.duty);
    const hold = Math.min(S.leg.duty, reach / Math.max(1e-3, strd * 0.5));
    const bob = st.w > 0.05 ? (half < hold ? reach * (0.5 - half / hold) : reach * (-0.5 + (half - hold) / (1 - hold))) : 0;
    // pecking while it grazes; looking about while it stands
    st.peckT -= dt;
    if (graze && st.peckT <= 0 && st.w < 0.4) { st.peck = 1; st.peckT = 0.6 + rig.rng() * 1.6; }
    st.peck = Math.max(0, st.peck - dt * 3.2);
    const pk = st.peck > 0 ? Math.sin(PI * (1 - st.peck)) : 0;
    st.lookT -= dt;
    if (st.lookT <= 0) { st.look = (rig.rng() - 0.5) * 1.4; st.lookT = 0.5 + rig.rng() * 2.2; }
    // a strike from the creature seams (_atkAnim 0..1): the same peck, driven
    const atk = a._atkAnim != null && a._atkAnim >= 0 ? Math.sin(PI * clamp(a._atkAnim, 0, 1)) : 0;
    // bolting: the wings beat, the body low and stretched
    st.flap += ((flee && v > 1.0 ? 1 : 0) - st.flap) * Math.min(1, dt * 7);
    st.flapPh += dt * S.flight.hz * (0.5 + 0.5 * st.flap);
    P.phase = frac(st.flapPh); P.flap = st.flap; P.fold = 1 - st.flap; P.flare = 0;
    P.step = st.step; P.legs = 1; P.walk = st.w; P.sit = 0;
    const peckE = Math.max(pk, atk);
    P.pitch = lerp(graze ? 0.2 : 0, D.peck.neck, peckE) + (flee ? 0.35 : 0);
    P.head = lerp(graze ? 0.3 : 0, D.peck.head, peckE);
    P.body = D.peck.body * peckE + (flee ? 0.12 : 0);
    P.yaw = st.w > 0.4 || peckE > 0.1 ? 0 : st.look;
    P.bob = bob * (1 - peckE);
    rig.set(P);
    // the audit the generic gait keeps (moving along the nose)
    a._motionMoved = d * k > 0.0025 ? d * k : 0;
    a._motionAlignment = 1;
    return true;
  }

  CBZ.birdKit = {
    SPECIES: SPECIES, build: build, flock: flock, params: params, geometry: geometryOf, material: materialOf, prep: prep,
    wingHz: wingHz, clock: clock, bank: bank, stride: stride, chickenBuild: chickenBuild, animateActor: animateActor,
    GLSL: GLSL, resolveKind: resolveKind,
    // drop every cached shape and material (after editing SPECIES)
    reset: function () { _prep.clear(); _geos.clear(); _mats.clear(); },
  };
})();
