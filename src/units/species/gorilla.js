/* ============================================================
   units/species/gorilla.js — THE WESTERN LOWLAND GORILLA, as NPC War fights it.

   OWNED BY: the gorilla agent. The whole animal: its numbers, its body, how
   it moves, how it fights, and when it runs.

   WHAT WAS HERE. A bestiary row and fifteen boxes (city/wildlife/apes.js) at
   x1.15, which put a 2.2 m tall slab on four posts, walked by the discovered
   "column" rig (a box swinging on a pivot, the feet sliding) and posed in a
   fight by predator_anim moving whole boxes about.

   WHAT IT IS NOW
   BODY  One SkinnedMesh on one shared geometry per variant (silverback,
         blackback, female) x two coat tints, on a 19-bone ape skeleton:
           root, pelvis, lumbar spine, thorax, neck, head, jaw,
           humerus / forearm / hand per arm, femur / tibia / foot per leg.
         Lofted on real silverback measurements (metres):
           shoulder joint 1.02 m in the knuckle-walk, humerus 0.42, radius 0.39,
           knuckle hand 0.18 (arm 0.99, so the arms are the columns), femur
           0.36, tibia 0.30, plantigrade foot 0.24 with the big toe set apart;
           hips 0.70 so the back slopes rump-down; biacromial ~0.66 m; a deep
           pot belly; a short neck lost in the trapezius; the male's sagittal
           crest (top of head ~1.40 m), heavy brow, broad flat nose, small
           ears, 5 cm canines. Coat in vertex colours: near-black hair, the
           silver saddle from the lower back to the thighs (silverbacks only),
           the western lowland's auburn crown, bare black skin on face, chest,
           palms, fingers and soles; per-vertex hair speckle.
           Females are x0.82 linear (half the mass, no crest, no saddle, browner),
           blackbacks x0.91 (no saddle, a small crest).
   GAIT  CBZ.quadGait with a primate table: a DIAGONAL-SEQUENCE knuckle-walk
         (HL, FR, HR, FL; duty 0.66) into the charge's gallop (hinds then
         fores, duty 0.30). Every hand and foot plants and cannot slide; 3D
         two-bone IK lays the arm (elbow back) onto the knuckles and the leg
         (knee forward, bowed out) onto the sole.
   BODY LANGUAGE  bipedal rise, chest-beat display (hands cupped, ~9 beats/s
         alternating), the bipedal display charge, sitting when idle, looking
         about, breathing, hit reactions by location (head snap, torso shove,
         arm jerk, leg buckle), lasting injuries (a shot arm is carried, a
         tripedal knuckle-walk; a shot leg limps), exhaustion, a corpse posed
         from the quadruped ragdoll's own solved points.
   FIGHT  systems/ape_combat.js (charge, two-handed smash, backhand, bite,
         grab-swing-throw-slam, the drum) through creature_combat, all POSED
         here on the real arms; plus this file's own tactics: the display
         before contact (it suppresses the men who see it), the silverback
         turning on whoever is on one of his troop, fear of vehicles and of
         being shot from out of reach, the female and the blackback breaking
         off and running when it goes bad, the silverback fighting to the end
         while his troop lives.
   NUMBERS  real: silverback ~170 kg (wild males 140-200), female ~85,
         blackback ~120; charge 8.3 m/s (~30 km/h) for ~9 s of sprint, then
         blown; knuckle-walk 1.1 m/s, march 2.4. Damage scales with mass^0.67
         (muscle cross-section). hp 220 for a silverback (mass^0.75 against the lion's 215 at 190 kg; it was 260 and beat big cats 42-50%, BALANCE.md F3) is about 2 men by
         mass and nothing more: a rifle round to a gorilla is a rifle round.

   POSSESSED  moves(unit, tgt, ctx): a player's ATTACK throws the move the
         moment calls for (chest beat out of reach, charge from a run, pound
         the fallen, grab into a crowd, smash / bite / grab on one man). This
         file's own nerve (display, flight, troop guarding) stands down for a
         body the player holds.

   KIT USE: CBZ.loftKit (shell), CBZ.quadRig.makeSkeleton/skinnedMesh (the
   ape table here is its own: a custom {NB, PARENT, bindPoints}), CBZ.quadGait
   (create/step with GAIT below). `needs` in units/manifest.js loads them.
============================================================ */
(function () {
  "use strict";
  const W = window;
  const CBZ = W.CBZ;
  const PI = Math.PI, TAU = PI * 2;
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function ease(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function approach(c, w, rate, dt) { return c + (w - c) * Math.min(1, rate * dt); }
  function wrapPi(a) { while (a > PI) a -= TAU; while (a < -PI) a += TAU; return a; }
  function hash(x, y, z) { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); }
  function mixHex(a, b, t) {
    t = clamp(t, 0, 1);
    const r = ((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t;
    const g = ((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t;
    const bl = (a & 255) * (1 - t) + (b & 255) * t;
    return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
  }
  function mulHex(a, f) {
    const r = clamp(((a >> 16) & 255) * f, 0, 255), g = clamp(((a >> 8) & 255) * f, 0, 255), b = clamp((a & 255) * f, 0, 255);
    return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
  }

  // =========================================================================
  //  THE INDIVIDUALS
  // =========================================================================
  const VARIANTS = {
    silverback: { k: 1.00, mass: 170, hpK: 1.00, dmgK: 1.00, spdK: 1.00, crest: 1.0, hump: 1.0, silver: 1, canine: 1.0, nerve: 1.6, display: 1.0 },
    blackback:  { k: 0.91, mass: 120, hpK: 0.78, dmgK: 0.79, spdK: 1.03, crest: 0.4, hump: 0.6, silver: 0, canine: 0.8, nerve: 0.85, display: 0.6 },
    female:     { k: 0.82, mass: 85,  hpK: 0.58, dmgK: 0.63, spdK: 0.97, crest: 0.0, hump: 0.3, silver: 0, canine: 0.5, nerve: 0.55, display: 0.12 },
  };
  // a troop by spawn index: the first body is always the silverback
  const TROOP = ["silverback", "female", "blackback", "female", "silverback", "female"];
  function variantOf(seed) {
    seed = seed | 0;
    const i = seed >= 7919 ? seed - 7919 : seed;
    return TROOP[((i % TROOP.length) + TROOP.length) % TROOP.length];
  }

  const STATS = {
    hp: 220, spd: 1.1, danger: 0.85, bite: 30, scale: 1,
    chase: 8.3, march: 2.4,
    dmg: 40.5, rate: 1.0,
    brave: true, prey: false,
  };

  // the primate footfall table (feet order FL FR HL HR)
  const GAIT = {
    gaits: [
      // diagonal sequence: HL(0) FR(.25) HR(.5) FL(.75)
      { name: "walk", key: "wW", off: [0.75, 0.25, 0.00, 0.50], duty: 0.66, lift: 0.045 },
      // the charge: hind pair, then fore pair (a transverse gallop)
      { name: "gallop", key: "wG", off: [0.45, 0.56, 0.00, 0.10], duty: 0.30, lift: 0.07 },
    ],
    trans: [[1.5, 2.3]],
    fMax: 3.6, f0: 1.35, fV: 0.44, strideMax: 1.4,
    vMove: 0.08, turnMove: 0.35, turnF: 1.3,
    settleRate: 2.2, restLift: 0.03, restStep: 0.07,
  };

  // =========================================================================
  //  THE SKELETON (silverback metres; every point x k)
  // =========================================================================
  const B = { root: 0, pelvis: 1, spine: 2, chest: 3, neck: 4, head: 5, jaw: 6,
    uaL: 7, faL: 8, hdL: 9, uaR: 10, faR: 11, hdR: 12, thL: 13, shL: 14, ftL: 15, thR: 16, shR: 17, ftR: 18 };
  const PARENT = [-1, 0, 1, 2, 3, 4, 5, 3, 7, 8, 3, 10, 11, 1, 13, 14, 1, 16, 17];
  const NB = 19;
  const ARM = [[B.uaL, B.faL, B.hdL], [B.uaR, B.faR, B.hdR]];
  const LEG = [[B.thL, B.shL, B.ftL], [B.thR, B.shR, B.ftR]];
  const BIND = [
    [0, 0, 0], [-0.40, 0.70, 0], [-0.08, 0.90, 0], [0.24, 1.00, 0], [0.42, 1.10, 0], [0.50, 1.15, 0], [0.54, 1.08, 0],
    [0.30, 1.02, -0.30], [0.30, 0.60, -0.32], [0.30, 0.21, -0.34],
    [0.30, 1.02, 0.30], [0.30, 0.60, 0.32], [0.30, 0.21, 0.34],
    [-0.40, 0.68, -0.15], [-0.27, 0.345, -0.18], [-0.39, 0.075, -0.20],
    [-0.40, 0.68, 0.15], [-0.27, 0.345, 0.18], [-0.39, 0.075, 0.20],
  ];
  const HAND_END = [0.335, 0.03, 0.34], FOOT_END = [-0.21, 0.035, 0.20];
  // segment lengths (k = 1)
  const LA = Math.hypot(0, 0.42, 0.02), LB = Math.hypot(0, 0.39, 0.02);
  const LT = Math.hypot(0.13, 0.335, 0.03), LS = Math.hypot(0.12, 0.27, 0.02);
  const TABLE = {
    NB: NB, PARENT: PARENT, BN: B,
    bindPoints: function (D) { return BIND.map(function (p) { return [p[0] * D.k, p[1] * D.k, p[2] * D.k]; }); },
  };

  // =========================================================================
  //  THE SHELL
  // =========================================================================
  const GEO = {};
  function coatOf(vn, tint) {
    const V = VARIANTS[vn];
    const base = vn === "female" ? 0x29231f : (vn === "blackback" ? 0x1f1d1b : 0x211e1d);
    return { hair: mulHex(base, tint ? 1.12 : 0.94), skin: 0x161414, palm: 0x1d1a19, silver: tint ? 0x85827c : 0x77746f,
      crown: tint ? 0x5e3320 : 0x4b2c1e, eye: 0x4a2a12, socket: 0x0b0909, brow: 0x1f1c1b, nose: 0x2b2725, tooth: 0xd8ceb0, mouth: 0x3a1512, V: V };
  }
  function buildShell(vn, tint) {
    const L = CBZ.loftKit, V = VARIANTS[vn], k = V.k, C = coatOf(vn, tint);
    const G = L.geo();
    function fur(hex, x, y, z, f) {
      const n = hash(x * 9.1, y * 9.7, z * 8.3);
      return mulHex(hex, 1 + (n - 0.5) * (f || 0.16));
    }
    function st(x, y, z, rt, rb, w, wts, sq) { return { x: x * k, y: y * k, z: z * k, rt: rt * k, rb: rb * k, w: w * k, wts: wts, sq: sq || 1 }; }

    // ---- TORSO: rump to the base of the neck, on the sloped knuckle-walk spine
    const hump = V.hump;
    const P = B.pelvis, S = B.spine, Cc = B.chest, N = B.neck, H = B.head, J = B.jaw;
    L.loft(G, [
      st(-0.68, 0.76, 0, 0.10, 0.10, 0.14, [P, 1]),
      st(-0.60, 0.79, 0, 0.17, 0.19, 0.21, [P, 1]),
      st(-0.46, 0.83, 0, 0.21, 0.23, 0.25, [P, 1]),
      st(-0.30, 0.86, 0, 0.22, 0.27, 0.27, [P, 0.7, S, 0.3]),
      st(-0.12, 0.90, 0, 0.22, 0.30, 0.295, [P, 0.2, S, 0.8]),
      st(0.04, 0.95, 0, 0.23, 0.31, 0.305, [S, 0.7, Cc, 0.3]),
      st(0.18, 1.00, 0, 0.24 + hump * 0.03, 0.29, 0.345, [S, 0.3, Cc, 0.7]),
      st(0.30, 1.04, 0, 0.25 + hump * 0.05, 0.26, 0.36, [Cc, 1]),
      st(0.40, 1.07, 0, 0.21 + hump * 0.05, 0.21, 0.30, [Cc, 1]),
      st(0.47, 1.09, 0, 0.15, 0.15, 0.22, [Cc, 0.6, N, 0.4]),
    ], 18, function (x, y, z, ca, sa, R, t) {
      const X = x / k;
      // the bare chest of a male, the hair everywhere else
      if (vn !== "female" && X > 0.18 && ca < -0.35 && Math.abs(sa) < 0.75) return fur(C.skin, x, y, z, 0.1);
      let c = C.hair;
      if (V.silver) {
        // THE SADDLE: lower back to the hips, fading up the flanks
        const along = clamp(1 - Math.abs(X + 0.25) / 0.42, 0, 1);
        const up = clamp((ca + 0.25) / 0.6, 0, 1);
        const s = ease(along) * up;
        if (s > 0) c = mixHex(c, C.silver, s * (0.55 + 0.3 * hash(x * 23, y * 17, z * 29)));
      }
      return fur(c, x, y, z, 0.2);
    }, { capLen: 0.8 });

    // ---- NECK: short, buried in the trapezius
    L.loft(G, [
      st(0.42, 1.10, 0, 0.13, 0.14, 0.15, [Cc, 0.5, N, 0.5]),
      st(0.50, 1.13, 0, 0.12, 0.13, 0.13, [N, 0.6, H, 0.4]),
    ], 14, function (x, y, z) { return fur(C.hair, x, y, z); }, {});

    // ---- HEAD: nape, crested vault, brow, the face and muzzle
    const headV0 = G.n;
    const cr = V.crest;
    L.loft(G, [
      st(0.40, 1.17, 0, 0.07, 0.08, 0.09, [N, 0.4, H, 0.6]),
      st(0.45, 1.19, 0, 0.12 + cr * 0.06, 0.10, 0.115, [H, 1]),
      st(0.51, 1.19, 0, 0.14 + cr * 0.08, 0.10, 0.125, [H, 1]),
      st(0.565, 1.18, 0, 0.10 + cr * 0.02, 0.11, 0.125, [H, 1]),
      // under the brow the face drops away, then the muzzle pushes out
      st(0.605, 1.14, 0, 0.065, 0.10, 0.112, [H, 1]),
      st(0.645, 1.11, 0, 0.05, 0.085, 0.098, [H, 1]),
      st(0.685, 1.09, 0, 0.042, 0.062, 0.085, [H, 1]),
    ], 16, function (x, y, z, ca) {
      const X = x / k;
      if (X > 0.575 && !(ca > 0.75 && X < 0.6)) return fur(C.skin, x, y, z, 0.08);
      // the western lowland's auburn crown
      if (ca > 0.3 && X < 0.58) return fur(mixHex(C.hair, C.crown, clamp((ca - 0.3) / 0.5, 0, 1) * 0.85), x, y, z, 0.2);
      return fur(C.hair, x, y, z, 0.2);
    }, { capLen: 0.5 });
    if (cr > 0.2) {
      // the sagittal crest: a keel of muscle over the vault
      L.loft(G, [
        st(0.42, 1.27 + cr * 0.03, 0, 0.02, 0.05, 0.02, [H, 1]),
        st(0.48, 1.32 + cr * 0.06, 0, 0.035, 0.07, 0.03, [H, 1]),
        st(0.54, 1.30 + cr * 0.05, 0, 0.025, 0.07, 0.03, [H, 1]),
      ], 8, function (x, y, z) { return fur(mixHex(C.hair, C.crown, 0.7), x, y, z, 0.2); }, { capLen: 0.8 });
    }
    // the brow: a shelf of bone over the eyes, the face's one horizontal
    L.ellipsoid(G, 0.598 * k, 1.212 * k, 0, 0.042 * k, 0.03 * k, 0.128 * k, 12, function () { return C.brow; }, [H, 1]);
    for (let sd = -1; sd <= 1; sd += 2) {
      // deep-set brown eyes in dark sockets
      L.ellipsoid(G, 0.612 * k, 1.176 * k, sd * 0.047 * k, 0.014 * k, 0.015 * k, 0.021 * k, 8, function () { return C.socket; }, [H, 1]);
      L.ellipsoid(G, 0.62 * k, 1.176 * k, sd * 0.047 * k, 0.01 * k, 0.011 * k, 0.014 * k, 8, function () { return C.eye; }, [H, 1]);
      // flared nostrils
      L.ellipsoid(G, 0.693 * k, 1.122 * k, sd * 0.025 * k, 0.011 * k, 0.013 * k, 0.017 * k, 6, function () { return 0x050404; }, [H, 1]);
      // small ears close to the skull
      L.ellipsoid(G, 0.48 * k, 1.175 * k, sd * 0.125 * k, 0.022 * k, 0.03 * k, 0.012 * k, 8, function () { return C.skin; }, [H, 1]);
    }
    // the broad flat nose pad, its rim raised (it reads as the face)
    L.ellipsoid(G, 0.668 * k, 1.14 * k, 0, 0.03 * k, 0.042 * k, 0.06 * k, 10, function (x, y) { return y / k > 1.15 ? C.nose : mulHex(C.nose, 0.85); }, [H, 1]);
    // ---- JAW + canines (5 cm on a male)
    L.loft(G, [
      st(0.53, 1.06, 0, 0.06, 0.07, 0.11, [H, 0.5, J, 0.5]),
      st(0.60, 1.05, 0, 0.05, 0.065, 0.10, [J, 1]),
      st(0.65, 1.045, 0, 0.045, 0.05, 0.085, [J, 1]),
      st(0.685, 1.05, 0, 0.035, 0.035, 0.065, [J, 1]),
    ], 12, function (x, y, z, ca) {
      if (ca > 0.55 && x / k < 0.645) return C.mouth;
      return x / k > 0.6 ? fur(C.skin, x, y, z, 0.08) : fur(C.hair, x, y, z);
    }, { capLen: 0.6 });
    const cl = 0.045 * V.canine;
    for (let sd = -1; sd <= 1; sd += 2) {
      L.loft(G, [st(0.668, 1.08, sd * 0.032, 0.008, 0.008, 0.008, [H, 1]), st(0.668, 1.08 - cl, sd * 0.032, 0.002, 0.002, 0.002, [H, 1])],
        5, function () { return C.tooth; }, { capB: false, capLen: 0.5 });
      L.loft(G, [st(0.645, 1.05, sd * 0.04, 0.007, 0.007, 0.007, [J, 1]), st(0.645, 1.05 + cl * 0.5, sd * 0.04, 0.002, 0.002, 0.002, [J, 1])],
        5, function () { return C.tooth; }, { capB: false, capLen: 0.5 });
    }

    /* the whole head (vault, face, jaw, teeth) authored at skull size, then
       grown about the head joint to the real thing: a silverback's head is
       huge for its body (the temporalis and crest), a female's less so */
    {
      const hs = 1.12 + 0.08 * cr, hx = 0.50 * k, hy = 1.13 * k;
      for (let i = headV0 * 3; i < G.n * 3; i += 3) {
        G.p[i] = hx + (G.p[i] - hx) * hs; G.p[i + 1] = hy + (G.p[i + 1] - hy) * hs; G.p[i + 2] *= hs;
      }
    }
    // ---- ARMS (columns: knuckle-walk bind, straight down)
    for (let sd = 0; sd < 2; sd++) {
      const sg = sd === 0 ? -1 : 1, ua = ARM[sd][0], fa = ARM[sd][1], hd = ARM[sd][2];
      const zz = function (y) { return sg * (0.30 + (1.02 - y) * 0.045); };
      L.loft(G, [
        st(0.30, 1.14, zz(1.14), 0.11, 0.11, 0.11, [Cc, 0.75, ua, 0.25]),
        st(0.30, 1.02, zz(1.02), 0.145, 0.14, 0.15, [Cc, 0.25, ua, 0.75]),
        st(0.30, 0.90, zz(0.90), 0.13, 0.125, 0.13, [ua, 1]),
        st(0.30, 0.76, zz(0.76), 0.108, 0.105, 0.104, [ua, 1]),
        st(0.295, 0.62, zz(0.62), 0.088, 0.10, 0.094, [ua, 0.55, fa, 0.45]),
        st(0.30, 0.52, zz(0.52), 0.105, 0.112, 0.106, [fa, 1]),
        st(0.30, 0.40, zz(0.40), 0.098, 0.098, 0.098, [fa, 1]),
        st(0.30, 0.28, zz(0.28), 0.076, 0.075, 0.08, [fa, 1]),
        st(0.30, 0.20, zz(0.20), 0.06, 0.055, 0.066, [fa, 0.5, hd, 0.5]),
      ], 12, function (x, y, z) { return fur(C.hair, x, y, z, 0.24); }, { side: [1, 0, 0], capA: false, capLen: 0.4 });
      // the knuckle hand: palm, then the curled fingers carrying the weight
      L.loft(G, [
        st(0.30, 0.225, zz(0.225), 0.058, 0.053, 0.064, [hd, 1]),
        st(0.312, 0.14, zz(0.14), 0.068, 0.05, 0.075, [hd, 1]),
        st(0.328, 0.085, zz(0.085), 0.08, 0.05, 0.08, [hd, 1]),
        st(0.335, 0.04, zz(0.04), 0.065, 0.04, 0.074, [hd, 1]),
      ], 10, function (x, y, z, ca) {
        const Y = y / k;
        if (Y < 0.12 || ca < -0.2) return fur(C.palm, x, y, z, 0.08);
        return fur(C.hair, x, y, z, 0.2);
      }, { side: [1, 0, 0], capA: false, capLen: 0.7 });
      L.ellipsoid(G, 0.335 * k, 0.12 * k, zz(0.12) * k - sg * 0.065 * k, 0.03 * k, 0.04 * k, 0.025 * k, 7, function () { return C.palm; }, [hd, 1]);
    }
    // ---- LEGS (short, bent, bowed) + plantigrade feet
    for (let sd = 0; sd < 2; sd++) {
      const sg = sd === 0 ? -1 : 1, th = LEG[sd][0], sh = LEG[sd][1], ft = LEG[sd][2];
      L.loft(G, [
        st(-0.43, 0.80, sg * 0.14, 0.13, 0.13, 0.13, [P, 0.85, th, 0.15]),
        st(-0.40, 0.68, sg * 0.15, 0.155, 0.155, 0.15, [P, 0.3, th, 0.7]),
        st(-0.35, 0.55, sg * 0.165, 0.138, 0.138, 0.13, [th, 1]),
        st(-0.30, 0.43, sg * 0.175, 0.11, 0.11, 0.104, [th, 1]),
        st(-0.27, 0.35, sg * 0.18, 0.084, 0.09, 0.084, [th, 0.5, sh, 0.5]),
        st(-0.31, 0.25, sg * 0.188, 0.08, 0.082, 0.078, [sh, 1]),
        st(-0.36, 0.14, sg * 0.195, 0.062, 0.064, 0.06, [sh, 1]),
        st(-0.39, 0.085, sg * 0.2, 0.046, 0.05, 0.05, [sh, 0.5, ft, 0.5]),
      ], 12, function (x, y, z, ca) {
        let c = C.hair;
        if (V.silver && y / k > 0.5) c = mixHex(c, C.silver, 0.45 * clamp((ca + 0.2), 0, 1));
        return fur(c, x, y, z, 0.22);
      }, { capA: false, capB: false });
      L.loft(G, [
        st(-0.45, 0.05, sg * 0.20, 0.04, 0.035, 0.05, [ft, 1]),
        st(-0.38, 0.055, sg * 0.20, 0.05, 0.04, 0.06, [ft, 1]),
        st(-0.28, 0.045, sg * 0.205, 0.04, 0.035, 0.07, [ft, 1]),
        st(-0.21, 0.035, sg * 0.205, 0.03, 0.03, 0.068, [ft, 1]),
      ], 10, function (x, y, z, ca) {
        if (ca < 0 || x / k > -0.30) return fur(C.palm, x, y, z, 0.08);
        return fur(C.hair, x, y, z, 0.2);
      }, { capLen: 0.7 });
      // the big toe, set apart (an opposable hallux)
      L.ellipsoid(G, -0.29 * k, 0.035 * k, sg * 0.125 * k, 0.045 * k, 0.022 * k, 0.026 * k, 7, function () { return C.palm; }, [ft, 1]);
    }
    const geo = L.toGeometry(G, { boundingSphere: [0, 0.7 * k, 0, 1.9 * k] });
    return geo;
  }
  function shellFor(vn, tint) {
    const key = vn + tint;
    if (!GEO[key]) GEO[key] = buildShell(vn, tint);
    return GEO[key];
  }

  // =========================================================================
  //  MATHS SCRATCH (made once THREE exists; nothing allocated per frame)
  // =========================================================================
  let T3 = null;
  function maths() {
    if (T3) return T3;
    const THREE = W.THREE;
    T3 = {
      m4: new THREE.Matrix4(), qa: new THREE.Quaternion(), qb: new THREE.Quaternion(), qc: new THREE.Quaternion(),
      qp: new THREE.Quaternion(), qs: new THREE.Quaternion(), qch: new THREE.Quaternion(), qu: new THREE.Quaternion(),
      ql: new THREE.Quaternion(), qh: new THREE.Quaternion(),
      va: new THREE.Vector3(), vb: new THREE.Vector3(), vc: new THREE.Vector3(), vd: new THREE.Vector3(),
      pp: new THREE.Vector3(), ps: new THREE.Vector3(), pc: new THREE.Vector3(), J: new THREE.Vector3(),
      T: new THREE.Vector3(), K: new THREE.Vector3(), Te: new THREE.Vector3(), pole: new THREE.Vector3(),
      tmp: new THREE.Vector3(), hT: new THREE.Vector3(),
      bindInv: [],
    };
    // each limb bone's bind frame (direction + pole), inverted
    function bindFrame(bi, dir, pole) {
      const q = new THREE.Quaternion();
      frameQuat(q, dir[0], dir[1], dir[2], pole[0], pole[1], pole[2]);
      T3.bindInv[bi] = q.invert();
    }
    for (let sd = 0; sd < 2; sd++) {
      const a = ARM[sd], l = LEG[sd];
      const p0 = BIND[a[0]], p1 = BIND[a[1]], p2 = BIND[a[2]];
      bindFrame(a[0], [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], [-1, 0, 0]);
      bindFrame(a[1], [p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]], [-1, 0, 0]);
      bindFrame(a[2], [HAND_END[0] - p2[0], HAND_END[1] - p2[1], 0], [-1, 0, 0]);
      const q0 = BIND[l[0]], q1 = BIND[l[1]], q2 = BIND[l[2]];
      bindFrame(l[0], [q1[0] - q0[0], q1[1] - q0[1], q1[2] - q0[2]], [1, 0, 0]);
      bindFrame(l[1], [q2[0] - q1[0], q2[1] - q1[1], q2[2] - q1[2]], [1, 0, 0]);
      bindFrame(l[2], [FOOT_END[0] - q2[0], FOOT_END[1] - q2[1], 0], [0, 1, 0]);
    }
    return T3;
  }
  // a rotation whose X column is `dir` and Y column `pole` (orthogonalised)
  const _fa = [0, 0, 0], _fb = [0, 0, 0];
  function frameQuat(out, dx, dy, dz, px, py, pz) {
    let l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
    const d = px * dx + py * dy + pz * dz;
    px -= dx * d; py -= dy * d; pz -= dz * d;
    l = Math.hypot(px, py, pz);
    if (l < 1e-5) { // pole along the bone: any perpendicular will do
      if (Math.abs(dy) < 0.9) { px = -dz; py = 0; pz = dx; } else { px = 1; py = 0; pz = 0; }
      const d2 = px * dx + py * dy + pz * dz; px -= dx * d2; py -= dy * d2; pz -= dz * d2;
      l = Math.hypot(px, py, pz) || 1;
    }
    px /= l; py /= l; pz /= l;
    _fa[0] = dy * pz - dz * py; _fa[1] = dz * px - dx * pz; _fa[2] = dx * py - dy * px;
    const e = T3.m4.elements;
    e[0] = dx; e[1] = dy; e[2] = dz; e[3] = 0;
    e[4] = px; e[5] = py; e[6] = pz; e[7] = 0;
    e[8] = _fa[0]; e[9] = _fa[1]; e[10] = _fa[2]; e[11] = 0;
    e[12] = 0; e[13] = 0; e[14] = 0; e[15] = 1;
    return out.setFromRotationMatrix(T3.m4);
  }
  // 3D two-bone IK: J -> K -> T. Writes K and the reached end Te; returns the
  // bend-plane pole in `pole`.
  function solve2(J, T, a, b, pole, K, Te) {
    let nx = T.x - J.x, ny = T.y - J.y, nz = T.z - J.z;
    const d = Math.hypot(nx, ny, nz) || 1e-4;
    nx /= d; ny /= d; nz /= d;
    const dc = clamp(d, Math.abs(a - b) + 1e-3, (a + b) * 0.9995);
    const ca = clamp((a * a + dc * dc - b * b) / (2 * a * dc), -1, 1);
    const along = a * ca, h = a * Math.sqrt(1 - ca * ca);
    let px = pole.x, py = pole.y, pz = pole.z;
    const pd = px * nx + py * ny + pz * nz;
    px -= nx * pd; py -= ny * pd; pz -= nz * pd;
    let pl = Math.hypot(px, py, pz);
    if (pl < 1e-5) { px = -nz; py = 0; pz = nx; pl = Math.hypot(px, py, pz) || 1; }
    px /= pl; py /= pl; pz /= pl;
    pole.set(px, py, pz);
    K.set(J.x + nx * along + px * h, J.y + ny * along + py * h, J.z + nz * along + pz * h);
    Te.set(J.x + nx * dc, J.y + ny * dc, J.z + nz * dc);
  }

  // =========================================================================
  //  BUILD
  // =========================================================================
  let PROXY = null;
  function proxyKit(k) {
    const THREE = W.THREE;
    if (!PROXY) PROXY = { mat: new THREE.MeshBasicMaterial({ visible: false }), geos: {} };
    const key = k.toFixed(3);
    if (!PROXY.geos[key]) {
      PROXY.geos[key] = {
        tall: new THREE.BoxGeometry(0.04, 0.98 * k, 0.04),
        foot: new THREE.BoxGeometry(0.03, 0.03, 0.03),
        head: new THREE.BoxGeometry(0.06, 0.06, 0.06),
      };
    }
    return PROXY.geos[key];
  }
  function build(ctx) {
    if (!CBZ.loftKit || !CBZ.quadRig || !W.THREE) return null;
    const THREE = W.THREE;
    maths();
    const seed = ((ctx && ctx.seed) | 0);
    const vn = variantOf(seed), V = VARIANTS[vn], k = V.k;
    const tint = (Math.floor(seed / 3) + seed) & 1;
    const geo = shellFor(vn, tint);
    const D = { k: k };
    const rig = CBZ.quadRig.makeSkeleton(TABLE, D, "gorilla");
    const mesh = CBZ.quadRig.skinnedMesh(geo, CBZ.loftKit.sharedSkinMaterial("gorilla-coat"), rig);
    mesh.receiveShadow = false;
    const group = new THREE.Group();
    group.add(mesh);
    /* THE RAGDOLL'S HANDLES. systems/quadruped_ragdoll.js discovers legs as
       ground-standing meshes; these invisible markers are those legs, a head
       and nothing else (one shared box per size). The solver writes its
       solved knees / feet / head onto them, and the corpse pose below reads
       them back onto the real skeleton. */
    const pk = proxyKit(k), cols = [];
    const cx = [0.30, 0.30, -0.38, -0.38], cz = [-0.34, 0.34, -0.20, 0.20];
    for (let c = 0; c < 4; c++) {
      const tall = new THREE.Mesh(pk.tall, PROXY.mat); tall.visible = false;
      tall.position.set(cx[c] * k, 0.49 * k, cz[c] * k);
      const foot = new THREE.Mesh(pk.foot, PROXY.mat); foot.visible = false;
      foot.position.set(cx[c] * k, 0.04, cz[c] * k);
      group.add(tall); group.add(foot);
      cols.push({ tall: tall, foot: foot, x: cx[c] * k, z: cz[c] * k });
    }
    const headP = new THREE.Mesh(pk.head, PROXY.mat); headP.visible = false;
    headP.position.set(0.62 * k, 1.12 * k, 0);
    group.add(headP);
    const body = { vn: vn, V: V, k: k, rig: rig, mesh: mesh, cols: cols, headP: headP, proxH: 0.98 * k };
    group.userData.gorilla = body;
    mesh.onBeforeRender = corpseHook;
    return group;
  }

  // =========================================================================
  //  THE INDIVIDUAL'S STATE (lazily, on first animate/fight)
  // =========================================================================
  function ensure(m) {
    if (m._gor) return m._gor;
    const body = m.group && m.group.userData && m.group.userData.gorilla;
    if (!body || !CBZ.quadGait) return null;
    maths();
    const V = body.V, k = body.k;
    const s = (m.group.scale && m.group.scale.x) || 1;
    const sk = s * k;
    // the gait works in WORLD metres: the feet and the size factor carry the scale
    const D = { K: 2 * sk, legLen: 0.68 * sk, feet: [
      { x: 0.335 * sk, z: -0.34 * sk, front: true }, { x: 0.335 * sk, z: 0.34 * sk, front: true },
      { x: -0.20 * sk, z: -0.20 * sk, front: false }, { x: -0.20 * sk, z: 0.20 * sk, front: false },
    ] };
    const R = {
      m: m, body: body, V: V, k: k, s: s, D: D, G: CBZ.quadGait.create(D, GAIT),
      px: m.pos.x, pz: m.pos.z, ph: m.heading || 0, v: 0, vs: 0, turn: 0, init: false,
      bip: 0, sit: 0, crouch: 0, idleT: 0, breath: Math.random() * 6, look: { yaw: 0, pitch: 0, t: 0, wy: 0, wp: 0 },
      jaw: 0, sta: 1, fear: 0, fleeT: 0, disp: 0, dispCD: 3 + Math.random() * 4, dispDone: false, chargeT: 0,
      lastHp: m.hp, hit: null, inj: { arm: [0, 0], leg: [0, 0] }, protT: 0, think: 0,
      deadT: -1, lastHook: 0, scratch: 0, drumT: 0,
    };
    body.R = R;
    m._gor = R;
    // per-individual numbers: mass, hp, damage, reach, speed
    m._mass = V.mass * s * s * s;
    const hpK = V.hpK;
    if (hpK !== 1 && m.maxHp < 1e8) {
      const f = m.hp / (m.maxHp || 1);
      m.maxHp = Math.round(m.maxHp * hpK); m.hp = Math.max(1, Math.round(m.maxHp * f));
    }
    R.lastHp = m.hp;
    const tn0 = m.tn || {};
    R.tn0 = { chase: (tn0.chase || STATS.chase) * V.spdK, march: (tn0.march || STATS.march), dmg: (tn0.dmg || STATS.dmg) * V.dmgK,
      rate: tn0.rate || STATS.rate };
    m.tn = Object.assign({}, tn0, R.tn0, { brave: vn(V) === "silverback", prey: false });
    m.reach = Math.max((m.rad || 0.6) * 2 + 0.55, (1.15 + 1.25 * k) * s);
    if (m._bf) m._bf.reach = m.reach;
    // creature_combat's mouth and ape_combat's arm, measured off this body
    m._jawL = { x: 0.73 * k, y: 1.07 * k, z: 0 };
    m._jawGripL = m._jawL;
    m._apeArm = { armX: 0.30 * sk, armH: 0.99 * sk, hold: Math.max(1.15, 1.25 * sk), holdY: 1.35 * sk, sc: s };
    // the side's collar rides the chest, not the air
    try {
      const kids = m.group.children.slice();
      m.group.updateMatrixWorld(true);
      for (let i = 0; i < kids.length; i++) {
        const o = kids[i];
        if (o === body.mesh || !o.isMesh || o.visible === false) continue;
        const c = body.rig.bones[B.chest];
        c.attach(o);
        o.position.set(0.17 * k, 0.33 * k, 0);
        o.rotation.set(0, 0, -0.25);
        o.scale.set(0.8, 0.6, 0.62);
      }
    } catch (e) {}
    return R;
  }
  function vn(V) { for (const k in VARIANTS) if (VARIANTS[k] === V) return k; return "silverback"; }

  // =========================================================================
  //  THE BRAIN ON TOP OF THE BATTLE'S: nerve, display, stamina, the troop
  // =========================================================================
  const _roster = [];
  function enemies() {
    _roster.length = 0;
    if (typeof CBZ.worldActors === "function") { try { CBZ.worldActors(_roster); } catch (e) { _roster.length = 0; } }
    return _roster;
  }
  function tdist(m, o) { return Math.hypot(o.pos.x - m.pos.x, o.pos.z - m.pos.z); }
  function brain(m, R, dt) {
    const V = R.V, tn = m.tn, t = m.tgt && !m.tgt.dead ? m.tgt : null;
    const d = t ? tdist(m, t) : 1e9;
    // ---- what hit me, and where (the reaction is visible, the injury lasts)
    if (m.hp < R.lastHp - 0.01) {
      const dmg = R.lastHp - m.hp;
      onHurt(m, R, dmg);
    }
    R.lastHp = m.hp;
    // ---- the slow tick: who is around, the troop, vehicles
    R.think -= dt;
    if (R.think <= 0) {
      R.think = 0.5 + Math.random() * 0.2;
      const list = enemies();
      let veh = 0, near = 0, guns = 0, troop = 0, threatened = null;
      for (let i = 0; i < list.length; i++) {
        const o = list[i];
        if (!o || o.dead || !o.pos) continue;
        if (o.team === m.team) {
          if (o !== m && o._gor && o._gor.V !== VARIANTS.silverback && tdist(m, o) < 40) {
            troop++;
            // THE SILVERBACK GOES TO WHOEVER IS ON ONE OF HIS
            if (V === VARIANTS.silverback && !threatened) {
              for (let j = 0; j < list.length; j++) {
                const e = list[j];
                if (e && !e.dead && e.team !== m.team && e.tgt === o && e.pos && tdist(e, o) < 5 && tdist(m, e) < 30) { threatened = e; break; }
              }
            }
          }
          continue;
        }
        const od = tdist(m, o);
        if (o.vehicle && od < 45) veh++;
        if (od < 6) near++;
        if (o.armed && od < 120) guns++;
      }
      R.troop = troop; R.near = near; R.guns = guns;
      if (!m.you && threatened && m.tgt !== threatened && !m.tn.prey) { m.tgt = threatened; R.protT = 3; }
      // vehicles are loud, huge and do not bleed: dread, not a fight
      if (veh) R.fear += 0.35 * veh * 0.5;
      // a target that is a machine is not worth closing on: find a body or go
      if (t && t.vehicle) R.fear += 0.25;
    }
    R.fear = Math.max(0, R.fear - dt * (0.07 + (R.near ? 0.05 : 0)));
    // ---- NERVE. A silverback with his troop around him does not run.
    let nerve = V.nerve * (V === VARIANTS.silverback && R.troop ? 2.2 : 1);
    if (m.you && (R.fleeT > 0 || R.disp > 0)) { R.fleeT = 0; R.disp = 0; tn.prey = false; }
    if (R.fleeT > 0) {
      R.fleeT -= dt;
      // cornered: something is on it, it turns and fights
      if (R.near && d < 2.6 && t) R.fleeT = Math.min(R.fleeT, 0);
      if (R.fleeT <= 0) { R.fear *= 0.45; tn.prey = false; }
    } else if (R.fear > nerve && !R.disp && !m.you) {
      R.fleeT = 5 + Math.random() * 4; tn.prey = true;
    }
    tn.brave = V === VARIANTS.silverback && (R.troop > 0 || m.hp > m.maxHp * 0.2);
    // ---- STAMINA. A gorilla is a sprinter: ~9 s of charge, then blown.
    const sp = Math.abs(R.v);
    if (sp > 5) R.sta = Math.max(0, R.sta - dt / 9);
    else if (sp < 3) R.sta = Math.min(1, R.sta + dt / (sp < 0.5 ? 7 : 12));
    const legInj = Math.max(R.inj.leg[0], R.inj.leg[1]), armInj = Math.max(R.inj.arm[0], R.inj.arm[1]);
    const hurtK = m.hp < m.maxHp * 0.35 ? 0.8 : 1;
    const legsK = (1 - 0.4 * legInj) * (1 - 0.18 * armInj) * hurtK;
    let chase = R.tn0.chase * (0.55 + 0.45 * R.sta) * legsK;
    let march = R.tn0.march * legsK;
    // ---- THE DISPLAY. On first sight at a few body lengths: up on the legs,
    // the chest beat (it suppresses whoever sees it), then the charge.
    if (R.dispCD > 0) R.dispCD -= dt;
    if (R.disp > 0) {
      R.disp -= dt;
      chase = 0; march = 0;
      if (t) faceTo(m, t, dt, 5);
      if (!R.drummed && R.disp < 0.7 && t && CBZ.apeStrike) {
        R.drummed = true;
        try { CBZ.apeStrike(m, t, "ape_drum", { reach: m.reach }, 0); } catch (e) {}
      }
      if (R.disp <= 0) { R.disp = 0; R.chargeT = 1.2; }
    } else if (!m.you && t && !tn.prey && R.dispCD <= 0 && d > 5 && d < 22 && Math.random() < V.display * dt * 2 &&
               m.hp > m.maxHp * 0.4 && !t.vehicle && !(m._atkAnim >= 0)) {
      R.disp = 1.5 + Math.random() * 0.6; R.drummed = false;
      R.dispCD = 18 + Math.random() * 12;
    }
    if (R.chargeT > 0) { R.chargeT -= dt; chase *= 1.08; }
    tn.chase = chase; tn.march = march;
    tn.dmg = R.tn0.dmg * (1 - 0.35 * armInj) * (0.75 + 0.25 * R.sta);
    if (R.protT > 0) R.protT -= dt;
  }
  function faceTo(m, t, dt, rate) {
    const want = Math.atan2(t.pos.z - m.pos.z, t.pos.x - m.pos.x);
    m.heading = (m.heading || 0) + wrapPi(want - (m.heading || 0)) * Math.min(1, rate * dt);
    m.faceH = m.heading;
    if (CBZ.faceAnimalHeading) CBZ.faceAnimalHeading(m, m.heading); else m.group.rotation.y = -m.heading;
  }
  function onHurt(m, R, dmg) {
    // the source: whoever has me, nearest first
    let src = null, best = 1e9;
    const list = enemies();
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (!o || o.dead || o.team === m.team || !o.pos) continue;
      if (o.tgt !== m && o !== m.tgt) continue;
      const dd = tdist(m, o);
      if (dd < best) { best = dd; src = o; }
    }
    const h = m.heading || 0;
    let lx = -1, lz = 0;
    if (src) {
      const dx = m.pos.x - src.pos.x, dz = m.pos.z - src.pos.z, dl = Math.hypot(dx, dz) || 1;
      // push direction in the body frame (nose +X, right +Z)
      lx = (Math.cos(h) * dx + Math.sin(h) * dz) / dl; lz = (-Math.sin(h) * dx + Math.cos(h) * dz) / dl;
    }
    const melee = best < 3.2;
    const f = clamp(dmg / Math.max(1, m.maxHp), 0, 1);
    // where it landed, by exposed area (the arms carry a lot of it on a gorilla)
    const r = Math.random();
    const side = lz > 0 ? 0 : 1;      // a shot from the right hits the right (toward the shooter)
    const kind = r < (melee ? 0.2 : 0.07) ? "head" : r < 0.62 ? "torso" : r < 0.82 ? "arm" : "leg";
    R.hit = { t: 0, dur: 0.28 + f * 1.4, kind: kind, side: Math.random() < 0.7 ? side : 1 - side, lx: lx, lz: lz, a: clamp(0.35 + f * 5, 0.35, 1) };
    if (kind === "arm") R.inj.arm[R.hit.side] = Math.min(1, R.inj.arm[R.hit.side] + f * 3.2);
    if (kind === "leg") R.inj.leg[R.hit.side] = Math.min(1, R.inj.leg[R.hit.side] + f * 3.2);
    // being hurt from out of reach is what makes an animal run
    if (!melee) R.fear += f * 2.4 * (src && src.armed ? 1 : 0.6);
    else R.fear += f * 0.5;
    // a display is broken off by a hit
    if (R.disp > 0 && f > 0.05) { R.disp = Math.min(R.disp, 0.15); }
    R.sit = Math.min(R.sit, 0.3);
  }

  // =========================================================================
  //  THE POSE
  // =========================================================================
  // per-arm action layer: weight, target, frame ('model' | 'chest' | 'shoulder'), pole
  const ACT = [
    { w: 0, x: 0, y: 0, z: 0, f: 0, px: -1, py: 0, pz: 0 },
    { w: 0, x: 0, y: 0, z: 0, f: 0, px: -1, py: 0, pz: 0 },
  ];
  const LEGACT = [{ w: 0, x: 0, y: 0, z: 0 }, { w: 0, x: 0, y: 0, z: 0 }];
  const PO = { bip: 0, pelX: 0, pelY: 0, pelP: 0, pelR: 0, pelYaw: 0, spP: 0, chP: 0, chR: 0, chY: 0, nkP: 0, hdP: 0, hdY: 0, jaw: 0, crouch: 0 };
  function setArm(i, w, f, x, y, z, px, py, pz) {
    const A = ACT[i]; A.w = w; A.f = f; A.x = x; A.y = y; A.z = z; A.px = px; A.py = py; A.pz = pz;
  }
  function clearActs() { ACT[0].w = ACT[1].w = 0; LEGACT[0].w = LEGACT[1].w = 0; }
  const F_MODEL = 0, F_CHEST = 1, F_SHOULDER = 2;
  const STRIKE_AT = 0.45;

  function attackLayer(m, R, style, p) {
    const k = R.k;
    const wind = p < STRIKE_AT ? ease(p / STRIKE_AT) : 0;
    const q = p >= STRIKE_AT ? (p - STRIKE_AT) / (1 - STRIKE_AT) : 0;
    const env = p < STRIKE_AT ? ease(p / STRIKE_AT) : ease(1 - q);
    const s = m._apeSide === -1 ? 0 : 1, sg = s === 0 ? -1 : 1;
    switch (style) {
      case "ape_smash": case "maul": {
        // up on the legs, both fists overhead, and down through the man
        PO.bip = Math.max(PO.bip, p < STRIKE_AT ? 0.8 * wind : 0.8 * (1 - ease(q * 2.2)));
        if (p < STRIKE_AT) {
          setArm(0, wind, F_CHEST, 0.12 * k, 0.78 * k, -0.2 * k, -1, 0, -0.3);
          setArm(1, wind, F_CHEST, 0.12 * k, 0.78 * k, 0.2 * k, -1, 0, 0.3);
          PO.jaw = Math.max(PO.jaw, 0.7 * wind);
        } else {
          const w = q < 0.55 ? 1 : 1 - ease((q - 0.55) / 0.45);
          const dn = ease(Math.min(1, q * 3));
          setArm(0, w, F_MODEL, lerp(0.5, 0.82, dn) * k, lerp(1.4, 0.06, dn) * k, -0.2 * k, -1, 0, -0.2);
          setArm(1, w, F_MODEL, lerp(0.5, 0.82, dn) * k, lerp(1.4, 0.06, dn) * k, 0.2 * k, -1, 0, 0.2);
          PO.pelP -= 0.18 * dn * w; PO.chP -= 0.25 * dn * w;
          PO.jaw = Math.max(PO.jaw, 0.4 * (1 - q));
        }
        break;
      }
      case "ape_sweep": {
        // the backhand: across the body, then out through everything on that side
        PO.bip = Math.max(PO.bip, 0.3 * env);
        const sw = p < STRIKE_AT ? 0 : ease(Math.min(1, q * 2.4));
        const a = lerp(-0.6, 1.25, sw);           // angle of the arm round the chest
        const r = 0.75 * k;
        const w = p < STRIKE_AT ? wind : (q < 0.5 ? 1 : 1 - ease((q - 0.5) / 0.5));
        setArm(s, w, F_CHEST, Math.cos(a) * r * 0.75, 0.05 * k, sg * Math.sin(a) * r, -0.2, -1, 0);
        PO.chY += sg * (0.35 * wind - 0.75 * sw * (q < 0.6 ? 1 : 1 - (q - 0.6) / 0.4));
        PO.jaw = Math.max(PO.jaw, 0.5 * env);
        break;
      }
      case "ape_charge": {
        // a quadrupedal rush into the man: shoulder first, then the lead arm
        PO.pelX += 0.25 * k * env; PO.chP -= 0.12 * env; PO.crouch = Math.max(PO.crouch, 0.4 * env);
        setArm(s, env, F_MODEL, 0.95 * k, 0.45 * k, sg * 0.2 * k, -1, -0.3, sg * 0.4);
        PO.jaw = Math.max(PO.jaw, 0.6 * env);
        break;
      }
      case "ape_bite": {
        // both hands pull the man in, the head drives forward, the jaws close
        PO.bip = Math.max(PO.bip, 0.25 * env);
        PO.pelX += 0.12 * k * env;
        PO.nkP -= 0.35 * env; PO.hdP -= 0.2 * env;
        PO.jaw = Math.max(PO.jaw, p < STRIKE_AT ? wind : Math.max(0, 1 - q * 4));
        setArm(0, env, F_CHEST, 0.58 * k, -0.1 * k, -0.24 * k, -1, 0, -0.5);
        setArm(1, env, F_CHEST, 0.58 * k, -0.1 * k, 0.24 * k, -1, 0, 0.5);
        break;
      }
      case "ape_grab": {
        PO.bip = Math.max(PO.bip, 0.45 * env);
        setArm(s, env, F_MODEL, 1.0 * k, 0.75 * k, sg * 0.15 * k, -1, 0, sg * 0.4);
        setArm(1 - s, env * 0.6, F_MODEL, 0.75 * k, 0.6 * k, -sg * 0.25 * k, -1, 0, -sg * 0.4);
        PO.jaw = Math.max(PO.jaw, 0.5 * env);
        break;
      }
      case "ape_drum": drumLayer(R, 1, p * 0.88); break;
      default: {
        PO.pelX += 0.15 * k * env; PO.jaw = Math.max(PO.jaw, env);
      }
    }
  }
  // the chest beat: cupped hands, alternating, elbows out
  function drumLayer(R, w, t) {
    const k = R.k;
    PO.bip = Math.max(PO.bip, w);
    const f = 4.6;                   // each hand ~4.6 beats/s, two hands ~9
    for (let i = 0; i < 2; i++) {
      const sg = i === 0 ? -1 : 1;
      const u = 0.5 + 0.5 * Math.sin(TAU * f * t + (i ? PI : 0));
      const hit = Math.pow(u, 3);
      setArm(i, w, F_CHEST, lerp(0.42, 0.27, hit) * k, lerp(0.04, -0.02, hit) * k, sg * lerp(0.30, 0.11, hit) * k, -0.3, -0.2, sg);
    }
    PO.jaw = Math.max(PO.jaw, 0.45 * w);
    PO.hdP += 0.25 * w;
    PO.chP += 0.06 * w;
  }
  // a man in the hand: lift, the swing, the slam, the throw (ape_combat's clock)
  function holdLayer(m, R, h) {
    const k = R.k;
    PO.bip = Math.max(PO.bip, h.phase === "lift" ? 0.75 * ease(h.t / 0.38) : 0.75);
    const v = h.victim, g = m.group;
    if (h.phase === "slam") {
      const u = clamp(h.t / 0.46, 0, 1);
      const up = u < 0.45 ? ease(u / 0.45) : 1 - ease((u - 0.45) / 0.55);
      for (let i = 0; i < 2; i++) setArm(i, 1, F_MODEL, lerp(0.85, 0.35, up) * k, lerp(0.15, 1.75, up) * k, (i ? 0.18 : -0.18) * k, -1, 0, 0);
      PO.chP -= 0.3 * (1 - up);
      PO.jaw = 0.8;
      return;
    }
    // the lead hand is where the man is
    if (v && v.pos && g) {
      const h0 = m.heading || 0, c = Math.cos(h0), sn = Math.sin(h0), sc = R.s || 1;
      const dx = v.pos.x - g.position.x, dz = v.pos.z - g.position.z, dy = v.pos.y - g.position.y;
      const lx = (c * dx + sn * dz) / sc, lz = (-sn * dx + c * dz) / sc;
      setArm(1, 1, F_MODEL, lx, dy / sc, lz, -1, 0, 0.6);   // ape_combat seats the man IN the hand
    }
    setArm(0, 0.8, F_SHOULDER, -0.15 * k, -0.55 * k, -0.45 * k, -1, 0, -1);
    PO.chY -= 0.25; PO.jaw = 0.6;
  }
  // a hit, by where it landed
  function hitLayer(R, dt) {
    const H = R.hit; if (!H) return;
    H.t += dt;
    if (H.t >= H.dur) { R.hit = null; return; }
    const u = H.t / H.dur, e = (u < 0.15 ? u / 0.15 : 1 - ease((u - 0.15) / 0.85)) * H.a;
    PO.pelR += -H.lz * 0.10 * e;
    PO.chP += H.lx * 0.18 * e;
    PO.chR += -H.lz * 0.22 * e;
    PO.pelX += H.lx * 0.06 * R.k * e;
    if (H.kind === "head") { PO.hdP += 0.55 * e; PO.nkP += 0.2 * e; PO.jaw = Math.max(PO.jaw, 0.5 * e); }
    else if (H.kind === "torso") { PO.chP -= 0.15 * e; PO.crouch = Math.max(PO.crouch, 0.5 * e); }
    else if (H.kind === "arm") {
      const sg = H.side ? 1 : -1;
      setArm(H.side, Math.max(ACT[H.side].w, e), F_CHEST, 0.3 * R.k, -0.15 * R.k, sg * 0.14 * R.k, -1, 0, sg);
    } else if (H.kind === "leg") { PO.pelY -= 0.1 * R.k * e; PO.pelR += (H.side ? 0.18 : -0.18) * e; }
  }

  // =========================================================================
  //  ANIMATE: the living body, one frame
  // =========================================================================
  const _gw = { x: 0, z: 0 };
  function groundFn() { return typeof CBZ.floorAt === "function" ? CBZ.floorAt : null; }
  function animate(m, dt) {
    if (!m || !m.group || m.dead) return;
    const R = ensure(m);
    if (!R || !(dt > 0)) return;
    dt = Math.min(dt, 0.1);
    const body = R.body, bones = body.rig.bones, g = m.group, k = R.k, s = R.s;
    // ---- the measured motion (whatever moved the unit, the legs answer it)
    const h = typeof m.heading === "number" ? m.heading : -g.rotation.y;
    if (!R.init) { R.init = true; R.px = m.pos.x; R.pz = m.pos.z; R.ph = h; }
    const dx = m.pos.x - R.px, dz = m.pos.z - R.pz;
    const vf = (Math.cos(h) * dx + Math.sin(h) * dz) / dt;
    const jump = Math.hypot(dx, dz) > 4;
    R.px = m.pos.x; R.pz = m.pos.z;
    const turn = clamp(wrapPi(h - R.ph) / dt, -6, 6); R.ph = h;
    const vfC = jump ? 0 : clamp(vf, -3, 12);
    const acc = (vfC - R.v) / dt;
    R.v = approach(R.v, vfC, 10, dt);
    R.turn = approach(R.turn, turn, 8, dt);
    R.acc = approach(R.acc || 0, clamp(acc, -20, 20), 4, dt);
    // ---- the ground is the ground (no other layer's bob or lunge-lift)
    const gf = groundFn();
    if (gf && !m.swim) {
      const gy = gf(m.pos.x, m.pos.z);
      if (typeof gy === "number" && isFinite(gy) && Math.abs(gy - m.pos.y) < 1.5) m.pos.y = gy;
    }
    if (!m._apeHold) { g.rotation.x = 0; g.rotation.z = 0; }
    else { g.rotation.x = 0; g.rotation.z = 0; }
    brain(m, R, dt);

    // ---- what the body is doing
    for (const key in PO) PO[key] = 0;
    clearActs();
    const t = m.tgt && !m.tgt.dead ? m.tgt : null;
    const moving = Math.abs(R.v) > 0.25 || Math.abs(R.turn) > 0.5;
    const atk = m._atkAnim != null && m._atkAnim >= 0;
    const hold = m._apeHold || null;
    R.idleT = moving || t || atk ? 0 : R.idleT + dt;
    // sitting is what an unbothered gorilla does
    R.sit = approach(R.sit, R.idleT > 6 && !R.fleeT ? 1 : 0, R.idleT > 6 ? 1.2 : 5, dt);
    let bipW = 0;
    if (R.disp > 0) { drumLayer(R, ease(Math.min(1, (2.1 - R.disp) * 3)) * (R.disp < 0.2 ? R.disp / 0.2 : 1), (R.drumT += dt)); bipW = PO.bip; }
    else R.drumT = 0;
    if (R.chargeT > 0) bipW = Math.max(bipW, 0.65 * clamp(R.chargeT / 0.4, 0, 1));
    if (hold) holdLayer(m, R, hold);
    else if (atk) attackLayer(m, R, m._apeStyle || m._atkStyle || "ape_smash", m._atkAnim);
    hitLayer(R, dt);
    // a badly shot arm is carried: the tripedal knuckle-walk
    for (let i = 0; i < 2; i++) {
      if (R.inj.arm[i] > 0.55 && ACT[i].w < 0.5) setArm(i, 1, F_CHEST, 0.3 * k, -0.25 * k, (i ? 0.12 : -0.12) * k, -1, 0, i ? 1 : -1);
    }
    R.bip = approach(R.bip, Math.max(PO.bip, bipW), PO.bip > R.bip ? 7 : 4, dt);
    const bip = R.bip, sit = R.sit * (1 - bip);

    // ---- the gait (world metres); a seated body keeps its feet planted
    const G = R.G;
    const gyb = m.pos.y;
    CBZ.quadGait.step(G, dt, sit > 0.5 ? 0 : R.v, sit > 0.5 ? 0 : R.turn, m.pos.x, m.pos.z, h, gf, gyb);
    const wG = (G.mix && G.mix.wG) || 0;
    const ph = G.phase;

    // ---- trunk (model units)
    R.breath += dt * (1.6 + Math.abs(R.v) * 0.25 + (1 - R.sta) * 1.5);
    const br = Math.sin(R.breath * TAU * 0.25);
    const bob = moving ? Math.cos(ph * TAU * 2) * 0.012 * (1 - wG) + Math.sin(ph * TAU) * 0.035 * wG : 0;
    const legInj = R.inj.leg[0] - R.inj.leg[1];
    // the lateral roll of a knuckle-walk, the spine flexing in the charge
    const roll = moving ? Math.sin(ph * TAU) * (0.05 * (1 - wG) + 0.03 * wG) : 0;
    let pelY = bob * k - PO.crouch * 0.08 * k + PO.pelY;
    let pelP = Math.sin(ph * TAU + 1.2) * 0.10 * wG - clamp(R.acc, -6, 6) * 0.012 + PO.pelP;
    let pelX = clamp(R.acc, -6, 6) * 0.008 * k + PO.pelX;
    let pelR = roll + PO.pelR + legInj * 0.07 * (moving ? 1 : 0.4);
    let chP = -Math.sin(ph * TAU + 1.2) * 0.08 * wG + br * 0.012 + PO.chP - (1 - R.sta) * 0.05;
    let spP = -0.06 * wG;
    // lean into turns
    pelR += clamp(R.turn * Math.abs(R.v), -6, 6) * 0.012;
    // BIPED: the trunk swings up about the hips
    pelP += bip * 1.02; pelY += bip * 0.10 * k; pelX += bip * 0.10 * k; spP -= bip * 0.08; chP += bip * 0.02;
    // SIT: hips down on the ground, trunk upright and slumped forward
    pelP += sit * 0.85; pelY -= sit * 0.38 * k; pelX += sit * 0.05 * k; chP -= sit * 0.12; spP += sit * 0.05;
    const P0 = BIND[B.pelvis];
    bones[B.pelvis].position.set(P0[0] * k + pelX, P0[1] * k + pelY, 0);
    bones[B.pelvis].rotation.set(pelR, PO.pelYaw, pelP);
    bones[B.spine].rotation.set(PO.chR * 0.4, PO.chY * 0.4, spP);
    bones[B.chest].rotation.set(PO.chR * 0.6 - roll * 0.6, PO.chY * 0.6, chP);
    // ---- the head: looks at the threat, or about; level whatever the trunk does
    lookLayer(m, R, dt, t);
    const trunkP = pelP + spP + chP;
    bones[B.neck].rotation.set(0, R.look.yaw * 0.4, -trunkP * 0.45 + PO.nkP + R.look.pitch * 0.3);
    bones[B.head].rotation.set(0, R.look.yaw * 0.6, -trunkP * 0.55 + PO.hdP + R.look.pitch * 0.7);
    R.jaw = approach(R.jaw, PO.jaw, PO.jaw > R.jaw ? 18 : 6, dt);
    bones[B.jaw].rotation.set(0, 0, -0.42 * R.jaw);

    // ---- FK of the trunk, in model space
    const M = T3;
    M.qp.copy(bones[B.pelvis].quaternion); M.pp.copy(bones[B.pelvis].position);
    M.qs.copy(M.qp).multiply(bones[B.spine].quaternion);
    M.ps.copy(bones[B.spine].position).applyQuaternion(M.qp).add(M.pp);
    M.qch.copy(M.qs).multiply(bones[B.chest].quaternion);
    M.pc.copy(bones[B.chest].position).applyQuaternion(M.qs).add(M.ps);

    // ---- the arms: the gait's knuckles, or the action
    const sc = 1 / s, chYaw = PO.chY + PO.pelYaw;
    for (let i = 0; i < 2; i++) {
      const ids = ARM[i], F = G.feet[i], A = ACT[i], sg = i ? 1 : -1;
      M.J.copy(bones[ids[0]].position).applyQuaternion(M.qch).add(M.pc);
      // gait target: knuckles on the ground; the wrist over them
      const sw = F.sw ? Math.sin(PI * F.u) : 0;
      let fx = F.lx * sc, fy = F.ly * sc, fz = F.lz * sc;
      // biped / sitting: the hands come off the ground
      let w = Math.max(A.w, bip > 0.4 ? (bip - 0.4) / 0.6 : 0, sit);
      let tx, ty, tz, plx = -1, ply = 0.15, plz = sg * 0.25;
      if (A.w > 0.001) {
        if (A.f === F_MODEL) { tx = A.x; ty = A.y; tz = A.z; }
        else if (A.f === F_CHEST) {
          // model axes about the thorax, turned only by the trunk's twist
          const cy = Math.cos(chYaw), sy = Math.sin(chYaw);
          tx = M.pc.x + cy * A.x + sy * A.z; ty = M.pc.y + A.y; tz = M.pc.z - sy * A.x + cy * A.z;
        }
        else { tx = M.J.x + A.x; ty = M.J.y + A.y; tz = M.J.z + A.z; }
      } else { tx = M.J.x + 0.05 * k; ty = M.J.y - 0.78 * k; tz = M.J.z + sg * 0.06 * k; }
      if (A.w <= 0.001 && sit > 0.01) {
        // seated: the hands rest on the ground beside the knees, or scratch
        tx = lerp(tx, 0.18 * k, sit); ty = lerp(ty, 0.04 * k, sit); tz = lerp(tz, sg * 0.36 * k, sit);
      }
      // blend the wrist: gait wrist <-> action wrist (action targets are the hand)
      const gwx = fx - 0.035 * k - 0.08 * k * sw, gwy = fy + 0.18 * k - 0.02 * sw * k, gwz = fz;
      const handDrop = 0.17 * k;
      const awx = tx - (A.w > 0.001 ? 0 : 0.0), awy = ty + (A.w > 0.001 ? 0 : handDrop), awz = tz;
      M.T.set(lerp(gwx, awx, w), lerp(gwy, awy, w), lerp(gwz, awz, w));
      if (A.w > 0.001) { plx = lerp(plx, A.px, A.w); ply = lerp(ply, A.py, A.w); plz = lerp(plz, A.pz, A.w); }
      M.pole.set(plx, ply, plz);
      solve2(M.J, M.T, LA * k, LB * k, M.pole, M.K, M.Te);
      frameQuat(M.qu, M.K.x - M.J.x, M.K.y - M.J.y, M.K.z - M.J.z, M.pole.x, M.pole.y, M.pole.z).multiply(M.bindInv[ids[0]]);
      bones[ids[0]].quaternion.copy(M.qa.copy(M.qch).invert().multiply(M.qu));
      frameQuat(M.ql, M.Te.x - M.K.x, M.Te.y - M.K.y, M.Te.z - M.K.z, M.pole.x, M.pole.y, M.pole.z).multiply(M.bindInv[ids[1]]);
      bones[ids[1]].quaternion.copy(M.qa.copy(M.qu).invert().multiply(M.ql));
      // the hand: onto the knuckles in stance, trailing in swing, a fist in the air
      let hx = fx - M.Te.x, hy = fy - M.Te.y, hz = fz - M.Te.z;
      const ax = M.Te.x - M.K.x, ay = M.Te.y - M.K.y, az = M.Te.z - M.K.z;
      const al = Math.hypot(ax, ay, az) || 1;
      hx = lerp(hx, ax / al, w); hy = lerp(hy, ay / al, w); hz = lerp(hz, az / al, w);
      frameQuat(M.qh, hx, hy, hz, M.pole.x, M.pole.y, M.pole.z).multiply(M.bindInv[ids[2]]);
      bones[ids[2]].quaternion.copy(M.qa.copy(M.ql).invert().multiply(M.qh));
    }
    // ---- the legs onto the soles
    for (let i = 0; i < 2; i++) {
      const ids = LEG[i], F = G.feet[2 + i], sg = i ? 1 : -1;
      M.J.copy(bones[ids[0]].position).applyQuaternion(M.qp).add(M.pp);
      const sw = F.sw ? Math.sin(PI * F.u) : 0;
      let fx = F.lx * sc, fy = F.ly * sc, fz = F.lz * sc;
      if (sit > 0.01) {
        // seated: the feet come forward, soles down, knees up and out
        fx = lerp(fx, -0.05 * k, sit); fz = lerp(fz, sg * 0.26 * k, sit);
      }
      // the ankle sits above the heel; at push-off the heel comes up
      const push = !F.sw && F.lx * sc < (BIND[ids[2]][0] + 0.02) * k ? clamp(((BIND[ids[2]][0] + 0.02) * k - F.lx * sc) / (0.25 * k), 0, 1) : 0;
      M.T.set(fx - 0.08 * k + 0.03 * push * k, fy + 0.075 * k + 0.05 * push * k + 0.03 * sw * k, fz);
      M.pole.set(1, 0.1, sg * (0.35 + sit * 0.6));
      solve2(M.J, M.T, LT * k, LS * k, M.pole, M.K, M.Te);
      frameQuat(M.qu, M.K.x - M.J.x, M.K.y - M.J.y, M.K.z - M.J.z, M.pole.x, M.pole.y, M.pole.z).multiply(M.bindInv[ids[0]]);
      bones[ids[0]].quaternion.copy(M.qa.copy(M.qp).invert().multiply(M.qu));
      frameQuat(M.ql, M.Te.x - M.K.x, M.Te.y - M.K.y, M.Te.z - M.K.z, M.pole.x, M.pole.y, M.pole.z).multiply(M.bindInv[ids[1]]);
      bones[ids[1]].quaternion.copy(M.qa.copy(M.qu).invert().multiply(M.ql));
      // the sole: flat in stance, heel up at push-off, toes hanging in swing
      const fa = -0.17 - push * 0.6 - sw * 0.5;
      frameQuat(M.qh, Math.cos(fa), Math.sin(fa), 0, -Math.sin(fa), Math.cos(fa), 0).multiply(M.bindInv[ids[2]]);
      bones[ids[2]].quaternion.copy(M.qa.copy(M.ql).invert().multiply(M.qh));
    }
  }
  function lookLayer(m, R, dt, t) {
    const L = R.look, g = m.group;
    L.t -= dt;
    let wy = L.wy, wp = L.wp;
    if (t && t.pos) {
      const h = m.heading || 0, dx = t.pos.x - g.position.x, dz = t.pos.z - g.position.z;
      const lx = Math.cos(h) * dx + Math.sin(h) * dz, lz = -Math.sin(h) * dx + Math.cos(h) * dz;
      wy = clamp(Math.atan2(-lz, lx), -1.1, 1.1);
      wp = clamp(Math.atan2((t.pos.y + (t.headY || 1.5) * 0.9) - (g.position.y + 1.15 * R.k * R.s), Math.hypot(lx, lz)), -0.5, 0.5);
    } else if (L.t <= 0) {
      // nothing to watch: it looks about, now and then
      L.t = 1.5 + Math.random() * 3;
      L.wy = wy = (Math.random() - 0.5) * 1.6;
      L.wp = wp = (Math.random() - 0.6) * 0.4;
    }
    L.yaw = approach(L.yaw, wy, 5, dt);
    L.pitch = approach(L.pitch, wp, 5, dt);
  }

  // =========================================================================
  //  THE CORPSE: the ragdoll solves, the skeleton follows its points
  // =========================================================================
  function corpseHook() {
    const body = this.parent && this.parent.userData && this.parent.userData.gorilla;
    const R = body && body.R;
    if (!R || !R.m || !R.m.dead) return;
    const now = (W.performance && performance.now()) || Date.now();
    if (now - R.lastHook < 6) return;
    const dt = R.lastHook ? Math.min(0.05, (now - R.lastHook) / 1000) : 0.016;
    R.lastHook = now;
    try { corpsePose(R, dt); } catch (e) {}
  }
  function corpsePose(R, dt) {
    const m = R.m, body = R.body, bones = body.rig.bones, k = R.k, M = maths();
    if (R.deadT < 0) R.deadT = 0;
    R.deadT += dt;
    const e = Math.min(1, dt * 7);
    // the trunk goes slack to the body the solver is holding
    const pl = bones[B.pelvis];
    const P0 = BIND[B.pelvis];
    pl.position.x = lerp(pl.position.x, P0[0] * k, e); pl.position.y = lerp(pl.position.y, P0[1] * k, e); pl.position.z = 0;
    const tr = [B.pelvis, B.spine, B.chest];
    for (let i = 0; i < tr.length; i++) { const r = bones[tr[i]].rotation; r.set(r.x * (1 - e), r.y * (1 - e), r.z * (1 - e)); }
    bones[B.jaw].rotation.z = lerp(bones[B.jaw].rotation.z, -0.18, e);
    M.qp.copy(pl.quaternion); M.pp.copy(pl.position);
    M.qs.copy(M.qp).multiply(bones[B.spine].quaternion);
    M.ps.copy(bones[B.spine].position).applyQuaternion(M.qp).add(M.pp);
    M.qch.copy(M.qs).multiply(bones[B.chest].quaternion);
    M.pc.copy(bones[B.chest].position).applyQuaternion(M.qs).add(M.ps);
    const solving = CBZ.quadRagdollActive ? CBZ.quadRagdollActive(m) || !!m.ragdoll : false;
    const H = body.proxH, y0 = 0.04, bodyY = H * 1.02, y1 = (y0 + bodyY) * 0.5, k2 = clamp((H * 0.5 - y0) / (y1 - y0), 0.05, 1);
    const sg0 = 1 / (m.group.scale.x || 1);
    for (let c = 0; c < 4; c++) {
      const col = body.cols[c], front = c < 2, side = c % 2, sg = side ? 1 : -1;
      const ids = front ? ARM[side] : LEG[side];
      const a = (front ? LA : LT) * k, b = (front ? LB : LS) * k;
      M.J.copy(bones[ids[0]].position).applyQuaternion(front ? M.qch : M.qp).add(front ? M.pc : M.pp);
      if (solving) {
        const Fp = col.foot.position, Pp = col.tall.position;
        // the solver's knee and foot, and its attach point (rest)
        M.K.set(Fp.x + (Pp.x - Fp.x) / k2, Fp.y + (Pp.y - Fp.y) / k2, Fp.z + (Pp.z - Fp.z) / k2);
        M.vd.set(Fp.x - col.x, Fp.y - bodyY, Fp.z - col.z);
        const ragLen = bodyY - y0, f = clamp(M.vd.length() / ragLen, 0.5, 1);
        M.vd.normalize().multiplyScalar((a + b) * 0.97 * f);
        M.T.copy(M.J).add(M.vd);
        M.pole.set(M.K.x - (col.x + Fp.x) * 0.5, M.K.y - (bodyY + Fp.y) * 0.5, M.K.z - (col.z + Fp.z) * 0.5);
        if (M.pole.lengthSq() < 1e-6) M.pole.set(front ? -1 : 1, 0, sg * 0.3);
      } else {
        // no solver (out of range, budget): limbs simply go limp
        M.T.set(M.J.x + (front ? 0.25 : 0.2) * k, 0.06 * k, M.J.z + sg * 0.25 * k);
        M.pole.set(front ? -1 : 1, 0, sg * 0.4);
      }
      void sg0;
      solve2(M.J, M.T, a, b, M.pole, M.K, M.Te);
      frameQuat(M.qu, M.K.x - M.J.x, M.K.y - M.J.y, M.K.z - M.J.z, M.pole.x, M.pole.y, M.pole.z).multiply(M.bindInv[ids[0]]);
      bones[ids[0]].quaternion.slerp(M.qa.copy(front ? M.qch : M.qp).invert().multiply(M.qu), e);
      frameQuat(M.ql, M.Te.x - M.K.x, M.Te.y - M.K.y, M.Te.z - M.K.z, M.pole.x, M.pole.y, M.pole.z).multiply(M.bindInv[ids[1]]);
      M.qb.copy(bones[ids[0]].quaternion);
      bones[ids[1]].quaternion.slerp(M.qa.copy(front ? M.qch : M.qp).multiply(M.qb).invert().multiply(M.ql), e);
      bones[ids[2]].quaternion.slerp(M.qc.set(0, 0, 0, 1), e);
    }
    // the head hangs where the solver's head point went
    if (solving) {
      const hp = body.headP.position;
      const ry = Math.atan2(-(hp.z), Math.max(0.05, hp.x - 0.42 * k));
      const rp = Math.atan2(hp.y - 1.12 * k, Math.max(0.05, hp.x - 0.42 * k));
      bones[B.neck].rotation.set(0, lerp(bones[B.neck].rotation.y, ry * 0.6, e), lerp(bones[B.neck].rotation.z, rp * 0.6 - 0.35, e));
      bones[B.head].rotation.set(0, lerp(bones[B.head].rotation.y, ry * 0.4, e), lerp(bones[B.head].rotation.z, rp * 0.4, e));
    } else {
      bones[B.neck].rotation.z = lerp(bones[B.neck].rotation.z, -0.45, e);
      bones[B.head].rotation.z = lerp(bones[B.head].rotation.z, -0.2, e);
    }
  }

  // =========================================================================
  //  FIGHT: the display holds; everything else is the shared strike driver
  //  (creature_combat + ape_combat's move set), posed by animate above
  // =========================================================================
  const RES = { inRange: false, dealt: 0, missed: false };
  function fight(m, tgt, dt, opts) {
    const R = ensure(m);
    if (R) {
      if (opts) opts.reach = m.reach;
      if (R.disp > 0 && !m.you) {
        if (tgt && !tgt.dead) faceTo(m, tgt, dt, 6);
        RES.inRange = true; RES.dealt = 0; RES.missed = false;
        return RES;
      }
    }
    if (!CBZ.creatureFight) { RES.inRange = false; RES.dealt = 0; RES.missed = false; return RES; }
    return CBZ.creatureFight(m, tgt, dt, opts);
  }

  /* =========================================================================
     MOVES: what a gorilla does when a PLAYER presses attack (src/units/kit/
     moves.js). The real repertoire, chosen by the moment:
       out of reach, not charging      the chest beat (the display IS the
                                       threat at distance; it rattles men)
       closing at a run                the charge (a shoulder and an arm)
       a body on the floor             the two-handed pound
       three or more inside the arms   the grab (lift, swing, throw/slam) on
                                       the second blow, else the backhand
       an animal its size or bigger    hands and canines: bite, smash
       one man                         smash, bite, grab (the combination)
     ========================================================================= */
  function mv(id, leap, cd) {
    const row = (CBZ.apeMoves && CBZ.apeMoves[id]) || {};
    return { id: id, style: id, pow: row.pow || 1, dur: row.dur || 0, rng: row.rng || 1, leap: leap || 0, cd: cd };
  }
  function moves(unit, tgt, ctx) {
    ctx = ctx || {};
    const R = ensure(unit);
    const dist = ctx.dist == null ? 99 : ctx.dist, reach = ctx.reach || unit.reach || 2.4;
    const running = !!ctx.sprint || (ctx.chase > 0 && ctx.speed > ctx.chase * 0.55);
    const n = ctx.n || 1;
    if (!tgt || dist > reach * 1.1) {
      if (tgt && running && dist < reach * 3) return mv("ape_charge", 1.2, 0.7);
      return mv("ape_drum", 0, 1.1);
    }
    if (ctx.downed) return mv("ape_smash", 0, 0.75);
    if (ctx.crowd >= 3) return (n % 2 === 0 && !ctx.heavy) ? mv("ape_grab", 0, 0.6) : mv("ape_sweep", 0, 0.45);
    if (ctx.heavy) return n % 2 === 0 ? mv("ape_smash", 0, 0.7) : mv("ape_bite", 0, 0.55);
    // a gorilla with a bad arm fights with its teeth
    if (R && Math.max(R.inj.arm[0], R.inj.arm[1]) > 0.55) return mv("ape_bite", 0, 0.55);
    const k = n % 3;
    return k === 1 ? mv("ape_smash", 0, 0.65) : k === 2 ? mv("ape_bite", 0, 0.55) : mv("ape_grab", 0, 0.6);
  }

  CBZ.unitKit.register("gorilla", {
    kind: "species",
    stats: STATS,
    build: build,
    animate: animate,
    fight: fight,
    moves: moves,
    // for tools and node checks
    variants: VARIANTS, variantOf: variantOf, gait: GAIT,
  });
})();
