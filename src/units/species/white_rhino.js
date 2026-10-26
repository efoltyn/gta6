/* ============================================================
   units/species/white_rhino.js — THE WHITE RHINO (Ceratotherium simum).

   OWNED BY: the white rhino agent. The whole animal for the battle: its
   numbers, its body, how it moves and how it fights.

   WHAT WAS HERE: eleven boxes and two cones off the bestiary
   (city/wildlife/megafauna.js) on four straight posts, walked by the shared
   discovered rig, fighting creature_combat's generic RAM, 500 hp, a 4.5 m/s
   "charge". Nothing about it was a rhino except the horn count.

   ------------------------------------------------------------------
   THE REAL ANIMAL (the numbers below come from these):
     bull 2,000-2,300 kg (to 3,600), cow ~1,700, sub-adult ~1,000
     withers 1.70-1.86 m, head+body 3.7-4.0 m, tail ~0.7 m
     front horn ~0.6 m (record 1.5), rear horn 0.2-0.4 m; cows' horns are
     often LONGER and thinner than bulls'
     head ~0.9 m, carried LOW (a grazer), wide square upper lip, small eyes
     set low and far back, tubular ears that swivel independently
     a NUCHAL HUMP ahead of the withers, deep skin folds behind the elbow and
     before the stifle, short columnar legs, three-toed round feet
     hide 1.5-5 cm thick; grey, usually wearing the local mud
     top speed 40-50 km/h, can hold a fast trot for a long time, a gallop
     only for a few hundred metres; poor eyesight (~30 m), keen smell and
     hearing; charges what it hears and smells, runs THROUGH what it hits,
     turns and comes again. A wounded white rhino usually runs.

   ------------------------------------------------------------------
   THE BODY. One SkinnedMesh per rhino on ONE shared geometry per individual
   variant (bull / cow / sub-adult x horn form x mud), one draw call, built
   with the kit: CBZ.loftKit lofts (torso -> nuchal hump -> neck in one
   sweep, skull -> forehead -> nasal boss -> square muzzle, a hinged lower
   lip, two keratin horns, tubular ears, a tufted tail, columnar legs with
   round three-toed feet) on a CBZ.quadRig skeleton (2 neck bones, hump,
   3-bone tail, ears, jaw, 3 bones per leg). Hide colour, folds, dust on the
   back and the mud on the legs and belly are baked into vertex colours, so
   every rhino shares the kit's one skinned Lambert material.

   THE GAIT. CBZ.quadGait with this file's RHINO footfall table: a four-beat
   lateral walk (duty .68), a diagonal trot (the rhino's travelling gait),
   a transverse gallop with a short suspension. Every foot plants. Legs are
   2-bone IK with the pastern / hock set by phase, plus abduction so a foot
   left wide in a turn is reached, not dragged.

   MOMENTUM (the part that makes it a two-tonne animal and not a cursor).
   The battle's mover is instantaneous: it would start a rhino at 11 m/s and
   wheel it on a coin. animate() runs a BODY GOVERNOR over whatever moved it:
   real acceleration (3.2 m/s^2), braking (5.5), a lateral-acceleration turn
   limit (a charging rhino cannot turn inside ~30 m, a walking one pivots
   about its own length), stamina (a gallop lasts ~20 s, then it trots),
   wounds (a limp on the leg that was hit) and its senses (it walks toward
   what it cannot yet see, threat-displays, then charges). Inside the strike
   bubble fight() owns motion with the same limits.

   THE FIGHT (fight()): the charge runs THROUGH the mark: the horn sweep
   lands if the mark is still on the line when it arrives (a man who
   sidesteps a 40 km/h rhino is missed, as in life), damage from the closing
   speed, the mark is tossed along the line (knocked down; heavier animals
   moved less), the rhino overruns, wheels and comes again. Close in: the
   upward horn HOOK, a shoulder SHOVE at things beside it, a TRAMPLE of a
   man on the ground, and after a couple of hooks it backs off a few metres
   and re-charges. Gore wounds and blood through creature_combat's owners.

   DEATH. quadruped_ragdoll is the corpse solver. It discovers legs/head by
   geometry, so the body carries invisible proxy columns it CAN read; when
   it solves, the proxies move, and the skinned legs, neck and head follow
   them (mesh.onBeforeRender, because the battle stops animating the dead).
   If the solver declines, the rhino's own collapse folds the legs under it.

   KIT: no kit changes. Uses loftKit / quadRig / quadGait as published; the
   manifest row's `needs` loads them before this file.
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W.CBZ || (W.CBZ = {});
  const PI = Math.PI, TAU = PI * 2, HALF = PI / 2;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function sstep(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function wrapPi(a) { while (a > PI) a -= TAU; while (a < -PI) a += TAU; return a; }
  function approach(cur, want, rate, dt) { return cur + (want - cur) * Math.min(1, rate * dt); }
  function toward(cur, want, step) { return cur < want ? Math.min(want, cur + step) : Math.max(want, cur - step); }
  function mkRng(seed) {
    let s = (seed >>> 0) || 1;
    return function () { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function mixHex(a, b, t) {
    t = clamp(t, 0, 1);
    const r = (a >> 16 & 255) + ((b >> 16 & 255) - (a >> 16 & 255)) * t;
    const g = (a >> 8 & 255) + ((b >> 8 & 255) - (a >> 8 & 255)) * t;
    const bl = (a & 255) + ((b & 255) - (a & 255)) * t;
    return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
  }
  function shade(c, k) { return mixHex(c, k > 0 ? 0xffffff : 0x000000, Math.abs(k)); }
  // smooth value-ish noise from sines, ~[-1, 1]
  function nz(x, y, z, p) {
    return 0.5 * (Math.sin(x * 3.1 + p) * Math.sin(z * 4.3 + p * 1.7) + Math.sin(y * 3.7 + x * 1.3 + p * 2.3) * Math.sin(z * 2.1 - y * 1.9 + p));
  }

  // ==========================================================================
  //  THE REAL NUMBERS
  // ==========================================================================
  const REAL = {
    top: 11.8,        // m/s, ~42 km/h: the charge (40-50 km/h reported)
    trot: 7.0,        // m/s, the fast trot it can hold
    walk: 1.5,        // m/s, an unhurried walk
    acc: 3.2,         // m/s^2 from a standstill (top speed in ~4 s)
    brake: 5.5,       // m/s^2
    latA: 4.4,        // m/s^2 lateral: the charge's turning radius is v^2 / latA
    pivot: 1.7,       // rad/s on the spot
    gallopS: 22,      // s of full gallop before it must drop to a trot
    recoverS: 45,     // s at a walk to recover it
    sight: 28,        // m: past this a still man is a smell and a sound, not a shape
    hear: 75,         // m: an engine is heard
    mass: { bull: 2300, cow: 1700, young: 1000 },
  };
  /* STATS: hp is the hide AND the mass. A rifle hit lands ~40-50 on this page
     (weapon damage x 1.45), so 950 is ~20 body hits from 5.56 / 7.62 to drop
     an adult: what rangers and poachers both report (it takes many rounds,
     and it keeps coming). chase is the charge; march the purposeful trot.
     dmg is the standing horn hook against a man (the charge multiplies it by
     closing speed, ~3x at full gallop). rate: seconds between hooks. A white
     rhino is not a fight-to-the-death animal: brave false, it runs at 30%. */
  const STATS = {
    hp: 950, spd: 1.4, danger: 0.7, bite: 55, scale: 1,
    chase: 11.2, march: 2.8,
    dmg: 55, rate: 1.15,
    brave: false, prey: false,
  };

  // the rhino's footfall table for CBZ.quadGait (K = withers / 0.62)
  const RHINO = {
    gaits: [
      { name: "walk", key: "wW", off: [0.25, 0.75, 0.00, 0.50], duty: 0.68, lift: 0.03 },   // lateral sequence HL FL HR FR
      { name: "trot", key: "wT", off: [0.25, 0.75, -0.25, 0.25], duty: 0.47, lift: 0.055 },  // diagonal pairs
      { name: "gallop", key: "wG", off: [0.25, 0.37, -0.22, -0.12], duty: 0.38, lift: 0.055 }, // transverse, short suspension
    ],
    trans: [[0.85, 1.3], [3.3, 4.0]],
    fMax: 3.6, f0: 1.25, fV: 0.62, strideMax: 2.1,
    vMove: 0.08, turnMove: 0.3, turnF: 1.35,
    settleRate: 2.2, restLift: 0.03, restStep: 0.06,
  };

  // ==========================================================================
  //  INDIVIDUALS: sex / age / horn / mud, by seed
  // ==========================================================================
  const CLASSES = ["cow", "cow", "bull", "cow", "young", "bull", "cow", "bull", "young", "cow"];
  const MUDS = [
    { name: "red", c: 0x86614a, d: 0x6c4c39 },     // Kruger / Hluhluwe red soil
    { name: "grey", c: 0x6c675f, d: 0x57534d },    // grey clay
    { name: "dark", c: 0x4e463e, d: 0x3d3731 },    // fresh wallow
  ];
  function variantOf(seed) {
    const r = mkRng(((seed | 0) * 2654435761) ^ 0x7a11);
    const cls = CLASSES[(seed >>> 0) % CLASSES.length];
    const horn = r() < 0.5 ? 0 : 1;
    const mud = Math.floor(r() * 3) % 3;
    return { cls: cls, horn: horn, mud: mud, key: cls + "|" + horn + "|" + mud, tint: (r() - 0.5) * 0.08 };
  }

  // ==========================================================================
  //  DIMS (metres; nose +X, up +Y, ground 0). Bull numbers x the class scale.
  // ==========================================================================
  function dims(v) {
    const cls = v.cls;
    const K = cls === "bull" ? 1.0 : (cls === "cow" ? 0.93 : 0.77);
    const D = { cls: cls, Kv: K, horn: v.horn, mud: v.mud };
    D.girth = cls === "bull" ? 1.0 : (cls === "cow" ? 0.95 : 0.97);
    D.humpK = cls === "bull" ? 1.0 : (cls === "cow" ? 0.55 : 0.4);
    D.neckK = cls === "bull" ? 1.0 : (cls === "cow" ? 0.9 : 0.92);
    D.headS = cls === "young" ? 1.1 : 1.0;                  // a calf's head is big for its body
    // horn: bull thick, cow long and slim, sub-adult a stub; form 1 = a longer front horn
    D.hornL = (cls === "bull" ? 0.55 : (cls === "cow" ? 0.62 : 0.22)) * (v.horn ? 1.2 : 1.0);
    D.hornR = cls === "bull" ? 0.125 : (cls === "cow" ? 0.1 : 0.085);
    D.horn2L = (cls === "bull" ? 0.26 : (cls === "cow" ? 0.22 : 0.1));
    D.withers = 1.80 * K;
    D.hipX = -1.0 * K; D.hipH = 1.14 * K; D.shX = 0.80 * K; D.sh = 1.06 * K;
    D.fa = 0.41 * K; D.fb = 0.42 * K; D.fc = 0.26 * K;
    D.ha = 0.46 * K; D.hb = 0.44 * K; D.hc = 0.30 * K;
    D.footH = 0.02 * K;
    D.legZf = 0.34 * K * D.girth; D.legZh = 0.36 * K * D.girth;
    D.FJ = { x: D.shX, y: D.sh }; D.HJ = { x: D.hipX, y: D.hipH };
    D.neckB = { x: 1.15 * K, y: 1.30 * K };
    D.headP = { x: 1.70 * K, y: 1.25 * K };
    D.headA = -0.62;                                         // the bind carriage: low, ~35 deg down
    D.headL = 0.98 * K * D.headS;
    D.u = { x: Math.cos(D.headA), y: Math.sin(D.headA) };
    D.up = { x: -Math.sin(D.headA), y: Math.cos(D.headA) };
    D.jawP = { x: D.headP.x + D.u.x * D.headL * 0.5 - D.up.x * 0.1 * K, y: D.headP.y + D.u.y * D.headL * 0.5 - D.up.y * 0.1 * K };
    D.earP = { x: D.headP.x + D.u.x * 0.05 * K + D.up.x * 0.235 * K * D.headS, y: D.headP.y + D.u.y * 0.05 * K + D.up.y * 0.235 * K * D.headS, z: 0.165 * K * D.headS };
    D.tailP = { x: -1.62 * K, y: 1.36 * K }; D.tailL = 0.68 * K;
    D.humpP = { x: 1.08 * K, y: 1.66 * K };
    D.K = D.withers / 0.62;                                  // the gait's size factor
    D.legLen = Math.min(D.fa + D.fb, D.ha + D.hb);
    D.feet = [
      { x: D.FJ.x + 0.03 * K, z: -D.legZf, front: true },
      { x: D.FJ.x + 0.03 * K, z: D.legZf, front: true },
      { x: D.HJ.x - 0.02 * K, z: -D.legZh, front: false },
      { x: D.HJ.x - 0.02 * K, z: D.legZh, front: false },
    ];
    // the horn tip and brow in model space (fight reach, wounds)
    const hb = headPt(D, 0.8, 0.16 * K * D.headS), hl = D.hornL * K;
    D.hornBase = hb;
    D.hornTip = { x: hb.x + D.up.x * hl + D.u.x * hl * 0.24, y: hb.y + D.up.y * hl + D.u.y * hl * 0.24 };
    D.noseX = headPt(D, 0.95, 0).x;
    D.mass = REAL.mass[cls];
    return D;
  }
  // a point on the head's axis: s (0..1 of headL) along, o metres toward the head's "up"
  function headPt(D, s, o) {
    return { x: D.headP.x + D.u.x * D.headL * s + D.up.x * o, y: D.headP.y + D.u.y * D.headL * s + D.up.y * o };
  }

  // ---- loads in node: the gait maths and the numbers ------------------------
  const QG = CBZ.quadGait, QR = CBZ.quadRig, LK = CBZ.loftKit;
  const TABLE = QR ? QR.bones({ neck: 2, tail: 3, ears: true, hackle: false, hump: true }) : null;
  const BN = TABLE ? TABLE.BN : null, LEGB = TABLE ? TABLE.LEGB : null;

  // ==========================================================================
  //  THE HIDE (vertex colours)
  // ==========================================================================
  function hideFn(D, v) {
    const K = D.Kv, mud = MUDS[D.mud];
    const base0 = shade(0x8c8880, v.tint || 0);
    const DUST = 0xa29b90, BELLY = 0x67635d, FOLD = 0x4f4b46, HORN0 = 0x4a433b, HORN1 = 0x8f8474;
    const EYE = 0x120e0b, NAIL = 0x9d917d, LIP = 0x5d5853, NOSTRIL = 0x26221f, EARIN = 0x6d5f58, FRINGE = 0x2f2a25, TUFT = 0x2a2521;
    const p0 = (v.mud + 1) * 1.37 + (v.horn ? 0.6 : 0);
    return function (part, x, y, z, ca, sa, R) {
      const X = x / K, Y = y / K, Z = z / K;
      if (part === "eye") return EYE;
      if (part === "nail") return NAIL;
      if (part === "horn") {
        // dark keratin at the base, worn paler toward the tip, grooved
        const t = R && R.t != null ? R.t : 0;
        return shade(mixHex(HORN0, HORN1, Math.pow(t, 1.4)), 0.03 * Math.sin(t * 40));
      }
      if (part === "tuft") return TUFT;
      let c = mixHex(base0, 0x938a7e, 0.25 + 0.25 * nz(X * 0.8, Y * 0.8, Z * 0.8, p0));
      // sun and dust on the back, shadowed belly
      if (ca > 0.35) c = mixHex(c, DUST, (ca - 0.35) * 0.55 * (0.7 + 0.3 * nz(X * 2, Y, Z * 2, p0 + 1)));
      if (ca < -0.3 && part !== "leg" && part !== "foot") c = mixHex(c, BELLY, (-ca - 0.3) * 0.9);
      // THE FOLDS: behind the elbow, before the stifle, round the neck
      if (part === "torso") {
        const sf = Math.abs(X - 0.42), ff = Math.abs(X + 0.82 + 0.06 * ca);
        if (sf < 0.045 && ca < 0.62) c = mixHex(c, FOLD, (1 - sf / 0.045) * 0.85);
        if (ff < 0.04 && ca < 0.5) c = mixHex(c, FOLD, (1 - ff / 0.04) * 0.7);
        for (let k = 0; k < 3; k++) {
          const nf = Math.abs(X - (1.30 + k * 0.12));
          if (nf < 0.025 && ca < 0.75) c = mixHex(c, FOLD, (1 - nf / 0.025) * 0.6);
        }
        // the wrinkled hide over the ribs: fine dark lines
        if (Math.sin(X * 38 + Y * 7) > 0.93 && ca < 0.4) c = mixHex(c, FOLD, 0.35);
      }
      if (part === "leg" || part === "foot") {
        // knees and wrists wrinkle in rings
        if (Math.sin(Y * 55) > 0.8) c = mixHex(c, FOLD, 0.35);
      }
      if (part === "head") {
        if (R && R.lip) c = mixHex(c, LIP, 0.7);
        if (R && R.mouth && ca < -0.1) c = mixHex(c, FOLD, 0.8);
        if (R && R.nos && Math.abs(sa) > 0.85 && ca > 0 && ca < 0.45) c = NOSTRIL;
        if (R && R.brow && ca > 0.3) c = mixHex(c, DUST, 0.3);
      }
      if (part === "lip") c = mixHex(c, LIP, 0.75);
      if (part === "ear") {
        if (R && R.t != null && R.t > 0.8) c = FRINGE;
        else if (R && R.t != null && R.t > 0.45 && (ca < -0.3)) c = EARIN;      // a vertical tube's ring "up" is -X: the opening faces forward
      }
      if (part === "tail" && R && R.t > 0.8) c = TUFT;
      // MUD: wallow mud to the knees and the belly, splashed higher on the flanks
      const mh = (part === "leg" || part === "foot") ? 0.95 : 0.62 + 0.18 * nz(X * 1.6, 0, Z * 1.6, p0 + 2);
      if (part !== "head" && part !== "ear" && part !== "lip" && Y < mh + 0.2) {
        const k = sstep(mh + 0.2, mh - 0.25, Y) * (0.75 + 0.25 * nz(X * 3, Y * 3, Z * 3, p0 + 3));
        c = mixHex(c, Y < 0.25 ? mud.d : mud.c, k);
      }
      if (part === "torso" && nz(X * 2.4, Y * 2.4, Z * 2.4, p0 + 4) > 0.62 && ca < 0.2) c = mixHex(c, mud.c, 0.55);
      return c;
    };
  }

  // Catmull-Rom between profile rows: n sub-rows per span, numeric columns
  // interpolated, a trailing object column (tags) kept on the nearer row
  function smoothRows(rows, n) {
    const out = [], N = rows.length;
    for (let i = 0; i < N - 1; i++) {
      const p0 = rows[Math.max(0, i - 1)], p1 = rows[i], p2 = rows[i + 1], p3 = rows[Math.min(N - 1, i + 2)];
      for (let k = 0; k < n; k++) {
        const t = k / n, t2 = t * t, t3 = t2 * t, r = [];
        for (let c = 0; c < p1.length; c++) {
          if (typeof p1[c] !== "number") { r.push(t < 0.5 ? p1[c] : p2[c]); continue; }
          r.push(0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3));
        }
        out.push(r);
      }
    }
    out.push(rows[N - 1].slice());
    return out;
  }

  // ==========================================================================
  //  THE SHELL
  // ==========================================================================
  function buildGeometry(D, v) {
    const G = LK.geo(), K = D.Kv, col = hideFn(D, v);
    const C = function (part) { return function (x, y, z, ca, sa, R) { return col(part, x, y, z, ca, sa, R); }; };
    const P = BN.pelvis, CH = BN.chest, NK = BN.neck, NK1 = BN.neck1, HD = BN.head, HU = BN.hump;
    const loft = function (st, S, c, o) { LK.loft(G, st, S, c, Object.assign({ hkBone: HU }, o)); };
    const gg = D.girth, nk = D.neckK;

    // TORSO -> HUMP -> NECK, one sweep. [x, top, bottom, half width, sq]
    const prof = [
      [-1.67, 1.36, 1.06, 0.22, 1.0],
      [-1.57, 1.53, 0.90, 0.40, 0.92],
      [-1.38, 1.62, 0.80, 0.52, 0.86],
      [-1.08, 1.64, 0.73, 0.58, 0.84],
      [-0.82, 1.605, 0.69, 0.585, 0.84],   // the flank fold
      [-0.45, 1.58, 0.61, 0.64, 0.84],
      [0.02, 1.60, 0.585, 0.65, 0.84],
      [0.42, 1.675, 0.655, 0.60, 0.84],    // the fold behind the elbow
      [0.72, 1.73, 0.72, 0.56, 0.86],      // withers
      [0.98, 1.84, 0.80, 0.50, 0.88],      // the nuchal hump, ahead of the shoulders
      [1.20, 1.84, 0.84, 0.46, 0.9],
      [1.40, 1.70, 0.86, 0.43, 0.95],      // neck folds
      [1.58, 1.57, 0.85, 0.38, 1.0],
      [1.74, 1.48, 0.87, 0.33, 1.0],       // into the head
    ];
    const wOf = function (x) {
      // bone weights along the body (bull units)
      if (x <= -0.95) return [P, 1];
      if (x < 0.5) { const t = (x + 0.95) / 1.45; return [P, 1 - t, CH, t]; }
      if (x < 1.0) return [CH, 1];
      if (x < 1.3) { const t = (x - 1.0) / 0.3; return [CH, 1 - t, NK, t]; }
      if (x < 1.56) { const t = (x - 1.3) / 0.26; return [NK, 1 - t, NK1, t]; }
      const t = clamp((x - 1.56) / 0.2, 0, 1); return [NK1, 1 - t * 0.6, HD, t * 0.6];
    };
    const torso = [], rows = smoothRows(prof, 3);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i], X = r[0];
      // the hump is a cow's / calf's gentle rise and a bull's real one
      let top = r[1];
      if (X > 0.6 && X < 1.5) top = r[1] - 0.13 * (1 - D.humpK) * Math.max(0, 1 - Math.abs(X - 1.08) / 0.45);
      const nkK = X > 1.2 ? nk : 1;
      const y = (top + r[2]) / 2, rr = (top - r[2]) / 2;
      // fold stations pinch the hide a little
      const pinch = (Math.abs(X - 0.42) < 0.01 || Math.abs(X + 0.82) < 0.01) ? 0.98 : 1;
      torso.push({ x: X * K, y: y * K, rt: rr * K * nkK * pinch, rb: rr * K * nkK * pinch, w: r[3] * K * gg * nkK * pinch, sq: r[4],
        wts: wOf(X), hk: X > 0.7 && X < 1.45 ? Math.max(0, 1 - Math.abs(X - 1.08) / 0.4) * D.humpK : 0 });
    }
    loft(torso, 26, C("torso"), { capLen: 0.85 });

    // HEAD: occiput -> cheek -> eye (concave forehead) -> horn boss -> square muzzle
    const hs = D.headS;
    const hst = [
      [-0.06, 0.24, 0.27, 0.30, 0.95, null],
      [0.05, 0.29, 0.31, 0.33, 0.85, { brow: 1 }],       // the high poll, the jowls
      [0.20, 0.25, 0.32, 0.32, 0.78, null],
      [0.38, 0.19, 0.28, 0.27, 0.76, null],              // the eye, a concave forehead
      [0.56, 0.18, 0.23, 0.24, 0.72, { brow: 1 }],
      [0.72, 0.18, 0.19, 0.245, 0.66, null],             // the nasal boss under the horn
      [0.85, 0.15, 0.15, 0.265, 0.56, { nos: 1 }],
      [0.93, 0.115, 0.11, 0.26, 0.5, { lip: 1, mouth: 1 }],   // the wide square lip
    ];
    const head = [], hrows = smoothRows(hst, 2);
    for (let i = 0; i < hrows.length; i++) {
      const r = hrows[i], p = headPt(D, r[0], 0);
      head.push(Object.assign({ x: p.x, y: p.y, rt: r[1] * K * hs, rb: r[2] * K * hs, w: r[3] * K * hs, sq: r[4], wts: [HD, 1] }, r[5] || {}));
    }
    LK.loft(G, head, 20, C("head"), { capLen: 0.55 });
    // the LOWER LIP / chin on the jaw hinge (grazing chews, a snort parts it)
    const jaw = [];
    for (let i = 0; i < 5; i++) {
      const s = 0.5 + i * 0.105, rbh = lerp(0.22, 0.1, i / 4) * K * hs;
      const p = headPt(D, s, -rbh * 0.62);
      jaw.push({ x: p.x, y: p.y, rt: 0.06 * K * hs, rb: lerp(0.09, 0.065, i / 4) * K * hs, w: lerp(0.2, 0.23, i / 4) * K * hs, sq: 0.7, wts: [BN.jaw, 1] });
    }
    LK.loft(G, jaw, 12, C("lip"), { capLen: 0.6 });
    // EYES: small, low, far back, behind the rear horn
    for (let s = -1; s <= 1; s += 2) {
      const e = headPt(D, 0.42, -0.02 * K * hs);
      LK.ellipsoid(G, e.x, e.y, s * 0.252 * K * hs, 0.03 * K, 0.022 * K, 0.016 * K, 8, function () { return col("eye"); }, [HD, 1]);
    }
    // HORNS: keratin cones off the nasal boss, the front one sweeping forward
    // then back, laterally compressed
    function horn(s0, L, r0, curve, lean) {
      const b = headPt(D, s0, (s0 > 0.7 ? 0.17 : 0.17) * K * hs - r0 * 0.3);
      const st = [];
      for (let i = 0; i <= 7; i++) {
        const t = i / 7, rr = r0 * Math.pow(1 - t, 0.85) + 0.006 * K;
        const fw = L * (lean * t - curve * t * t);
        st.push({ x: b.x + D.up.x * L * t + D.u.x * fw, y: b.y + D.up.y * L * t + D.u.y * fw,
          rt: rr * 1.08, rb: rr, w: rr * 0.82, wts: [HD, 1], t: t });
      }
      LK.loft(G, st, 12, C("horn"), { capLen: 0.5, capB: true });
    }
    horn(0.8, D.hornL * K, D.hornR * K, D.cls === "cow" ? 0.34 : 0.26, 0.5);
    horn(0.6, D.horn2L * K, D.hornR * 0.72 * K, 0.1, 0.15);
    // EARS: tubes on the back of the skull, the opening forward-out, a hair fringe
    for (let s = -1; s <= 1; s += 2) {
      const eb = s < 0 ? BN.earL : BN.earR, E = D.earP, L = 0.25 * K * hs, st = [];
      for (let i = 0; i <= 5; i++) {
        const t = i / 5, rr = (0.04 + 0.026 * Math.sin(PI * t)) * (1 - 0.5 * t * t) * K * hs;
        st.push({ x: E.x + 0.04 * K * t, y: E.y + L * t, z: s * (E.z + 0.06 * K * t), rt: rr, rb: rr * 0.85, w: rr * 0.68, wts: [eb, 1], t: t });
      }
      // ring "up" for a vertical tube is +X (forward): the inner colour sits on the forward face
      LK.loft(G, st, 10, C("ear"), { capLen: 0.4, side: [0, 0, 1] });
    }
    // TAIL: three bones, a laterally flattened tuft of black bristles at the end
    const tst = [], T = D.tailP, tl = D.tailL;
    const tprof = [1.0, 0.86, 0.7, 0.55, 0.42, 0.34, 0.5, 0.35];
    for (let i = 0; i < tprof.length; i++) {
      const t = i / (tprof.length - 1), x = T.x - tl * t;
      let wts;
      if (t < 0.33) wts = [BN.tail0, 1 - t / 0.33 * 0.5, BN.tail1, t / 0.33 * 0.5];
      else if (t < 0.66) wts = [BN.tail1, 1 - (t - 0.33) / 0.33 * 0.5, BN.tail2, (t - 0.33) / 0.33 * 0.5];
      else wts = [BN.tail2, 1];
      const r = 0.055 * K * tprof[i];
      tst.push({ x: x, y: T.y, rt: r, rb: r, w: t > 0.8 ? r * 0.45 : r * 0.9, wts: wts, t: t });
    }
    LK.loft(G, tst, 10, C("tail"), { capLen: 0.8 });

    // LEGS: columns, straight down in the bind; the IK bends them every frame
    const pts = TABLE.bindPoints(D);
    for (let Lg = 0; Lg < 4; Lg++) {
      const front = Lg < 2, ids = LEGB[Lg], P0 = pts[ids[0]], z = P0[2];
      const a = front ? D.fa : D.ha, b = front ? D.fb : D.hb, c = front ? D.fc : D.hc;
      const x = P0[0], y0 = P0[1], g = K * gg;
      const lg = g * 1.22;
      const ring = function (y, rt, rb, w, wts, extra) { return Object.assign({ x: x, y: y, z: z, rt: rt * lg, rb: rb * lg, w: w * lg, wts: wts }, extra || {}); };
      if (front) {
        // humerus + the great triceps mass, mostly inside the body
        loft([
          ring(y0 + 0.24 * K, 0.17, 0.22, 0.15, [ids[0], 1]),
          ring(y0, 0.19, 0.24, 0.17, [ids[0], 1]),
          ring(y0 - a * 0.6, 0.17, 0.21, 0.165, [ids[0], 1]),
          ring(y0 - a, 0.14, 0.165, 0.14, [ids[0], 0.55, ids[1], 0.45]),
        ], 12, C("leg"), { capLen: 0.6 });
        loft([
          ring(y0 - a, 0.14, 0.16, 0.14, [ids[1], 1]),
          ring(y0 - a - b * 0.5, 0.12, 0.125, 0.12, [ids[1], 1]),
          ring(y0 - a - b, 0.113, 0.115, 0.125, [ids[1], 0.5, ids[2], 0.5]),   // the knobbly carpus
        ], 12, C("leg"), { capLen: 0.6 });
      } else {
        loft([
          ring(y0 + 0.18 * K, 0.18, 0.27, 0.16, [ids[0], 1]),
          ring(y0, 0.2, 0.29, 0.175, [ids[0], 1]),
          ring(y0 - a * 0.55, 0.17, 0.22, 0.155, [ids[0], 1]),
          ring(y0 - a, 0.14, 0.16, 0.14, [ids[0], 0.55, ids[1], 0.45]),
        ], 12, C("leg"), { capLen: 0.6 });
        loft([
          ring(y0 - a, 0.14, 0.155, 0.14, [ids[1], 1]),
          ring(y0 - a - b * 0.45, 0.12, 0.14, 0.12, [ids[1], 1]),
          ring(y0 - a - b, 0.1, 0.125, 0.105, [ids[1], 0.5, ids[2], 0.5]),     // the hock, heel behind
        ], 12, C("leg"), { capLen: 0.6 });
      }
      // pastern / metatarsus down to the round foot: it spreads where it meets the ground
      const fy = y0 - a - b;
      loft([
        ring(fy, 0.11, 0.11, 0.115, [ids[2], 1]),
        ring(fy - c * 0.5, 0.1, 0.1, 0.105, [ids[2], 1]),
        ring(fy - c * 0.86, 0.13, 0.12, 0.135, [ids[2], 1]),
        ring(fy - c + 0.01 * K, 0.135, 0.125, 0.14, [ids[2], 1]),
      ], 12, C("foot"), { capLen: 0.25 });
      // three toenails round the front of the foot
      for (let k = -1; k <= 1; k++) {
        const an = k * 0.75, nr = 0.15 * g;
        LK.ellipsoid(G, x + Math.cos(an) * nr, fy - c + 0.045 * K, z + Math.sin(an) * nr, 0.045 * K, 0.04 * K, 0.042 * K, 8,
          function () { return col("nail"); }, [ids[2], 1]);
      }
    }
    return LK.toGeometry(G, { boundingSphere: [0.1 * K, 1.0 * K, 0, 2.9 * K] });
  }

  // ==========================================================================
  //  BUILD — shared geometry per variant, a skeleton per rhino
  // ==========================================================================
  const _geo = new Map(), _prox = new Map(), _band = new Map();
  let _proxMat = null;
  function proxyGeos(D, THREE) {
    const k = D.cls;
    let g = _prox.get(k);
    if (!g) {
      const K = D.Kv;
      g = {
        foot: new THREE.BoxGeometry(0.06 * K, 0.2 * K, 0.06 * K),
        upper: new THREE.BoxGeometry(0.06 * K, 1.0 * K, 0.06 * K),
        head: new THREE.BoxGeometry(0.1 * K, 0.1 * K, 0.1 * K),
        tail: new THREE.BoxGeometry(0.08 * K, 0.08 * K, 0.08 * K),
        torso: new THREE.BoxGeometry(2.4 * K, 0.9 * K, 1.0 * K),
      };
      for (const n in g) g[n]._shared = true;
      _prox.set(k, g);
    }
    return g;
  }
  function build(ctx) {
    const THREE = (ctx && ctx.THREE) || W.THREE;
    if (!THREE || !LK || !QR || !QG) return null;
    const seed = ((ctx && ctx.seed) | 0) || Math.floor(((ctx && ctx.rng) ? ctx.rng() : Math.random()) * 1e6);
    const v = variantOf(seed);
    const D = dims(v);
    let geo = _geo.get(v.key);
    if (!geo) { geo = buildGeometry(D, v); _geo.set(v.key, geo); }
    const rig = QR.makeSkeleton(TABLE, D, "rhino");
    const mesh = QR.skinnedMesh(geo, LK.sharedSkinMaterial(), rig);
    mesh.name = "white-rhino";
    mesh.receiveShadow = false;
    const group = new THREE.Group();
    group.add(mesh);
    group.userData.dynamic = true;
    /* THE PROXIES quadruped_ragdoll can read (it discovers legs as tall boxes
       standing on the ground, a head far forward and up, a tail far back, a
       torso block whose top is the back). Never drawn. Per column: a foot
       block (centre 0.1) and a 1.0 block (centre 0.5): the solver's write-back
       parameterises them between its foot and knee points, so the knee is
       recovered exactly from the two (see deadPose). */
    if (!_proxMat) { _proxMat = new THREE.MeshBasicMaterial(); _proxMat._shared = true; }
    const PG = proxyGeos(D, THREE), K = D.Kv, prox = { legs: [], head: null, tail: null };
    const mk = function (g, x, y, z) { const m = new THREE.Mesh(g, _proxMat); m.visible = false; m.position.set(x, y, z); m.userData.rhinoProxy = true; group.add(m); return m; };
    for (let Lg = 0; Lg < 4; Lg++) {
      const f = D.feet[Lg], x = Lg < 2 ? D.FJ.x : D.HJ.x;
      prox.legs.push({ F: mk(PG.foot, x, 0.1 * K, f.z), U: mk(PG.upper, x, 0.5 * K, f.z), x: x, z: f.z });
    }
    const hc = headPt(D, 0.45, 0);
    prox.head = mk(PG.head, hc.x, hc.y, 0);
    prox.tail = mk(PG.tail, D.tailP.x - 0.13 * K, 1.0 * K, 0);
    mk(PG.torso, -0.1 * K, 1.15 * K, 0);
    // the solver's own rest frame, replayed so deadPose can read its points
    const footR = 0.1 * K, bodyY = 1.02 * K, kneeY = (footR + bodyY) * 0.5;
    prox.kneeK = (0.5 * K - footR) / (kneeY - footR);
    prox.bodyY = bodyY; prox.hx = hc.x; prox.hy = hc.y;
    const R = {
      D: D, v: v, mesh: mesh, group: group, bones: rig.bones, bindPos: rig.bindPos,
      G: QG.create(D, RHINO), prox: prox, st: null, unit: null, f: null, gs: 1, tick: 0,
      ground: null, deadK: 0, rf: -1,
    };
    R.ground = function (x, z) {
      const fl = CBZ.floorAt; if (!fl) return null;
      const y = fl(x * R.gs, z * R.gs);
      return (y == null || !isFinite(y)) ? null : y / R.gs;
    };
    group.userData.rhino = R;
    mesh.onBeforeRender = function (renderer) {
      const f = renderer && renderer.info && renderer.info.render ? renderer.info.render.frame : -2;
      if (f === R.rf) return;
      R.rf = f;
      try { afterLife(R); } catch (e) {}
    };
    return group;
  }

  // ==========================================================================
  //  PER-RHINO STATE
  // ==========================================================================
  function newState(m, R) {
    return {
      px: m.pos.x, pz: m.pos.z, ph: m.heading || 0,
      spd: 0, vh: m.heading || 0, hd: m.heading || 0, v: 0, turn: 0, stam: 1, still: 0,
      alert: 0, aggr: 0, fear: 0, graze: 0, disp: 0, limp: 0, limpLeg: 2,
      lookY: 0, t: Math.random() * 10, noticed: false, display: 0, dispSeen: null, lastHp: m.hp,
      hit: { t: 1, dur: 0.5, loc: 0, side: 1, mag: 0 },
      earT: [0, 0], earY: [0, 0], earYW: [0, 0], swishT: 3, swish: 0, snortT: 2, snort: 0, chew: 0,
      tailUp: 0, hookE: 0,
    };
  }
  function rigOf(m) { return m && m.group && m.group.userData ? m.group.userData.rhino : null; }
  function initUnit(m, R) {
    R.unit = m;
    R.st = newState(m, R);
    const D = R.D;
    // THE INDIVIDUAL'S MASS AND HIDE: the species row is an adult cow-ish
    // mean; a bull carries more of both, a calf far less
    const k = D.mass / 1900;
    m._mass = D.mass * Math.pow(m._sizeMul || 1, 3);
    if (m.hp === m.maxHp && m.maxHp < 1e8) {
      m.maxHp = Math.round(m.maxHp * Math.pow(k, 0.67));
      m.hp = m.maxHp;
    }
    R.st.lastHp = m.hp;
    // creature_combat's wound / blood owners take the horn as "the jaw"
    m._jawL = { x: D.hornTip.x * 0.5 + D.hornBase.x * 0.5, y: (D.hornTip.y + D.hornBase.y) * 0.5, z: 0 };
    if (!R.collar) R.collar = adoptCollar(R) || 1;
    if (QG.reset) QG.reset(R.G, m.pos.x / (m.group.scale.x || 1), m.pos.z / (m.group.scale.x || 1), m.heading || 0, R.ground, m.pos.y / (m.group.scale.x || 1));
  }
  // the battle's team collar is a box on the neck line: make it a real band
  // round the neck bone (in the collar's own material) so it rides the neck
  function adoptCollar(R) {
    const THREE = W.THREE, g = R.group;
    if (!THREE) return;
    for (let i = 0; i < g.children.length; i++) {
      const c = g.children[i];
      if (!c || !c.isMesh || c === R.mesh || !c.userData.teamCollar) continue;
      c.visible = false;
      const D = R.D, key = D.cls;
      let bg = _band.get(key);
      if (!bg) { bg = new THREE.TorusGeometry(0.44 * D.Kv * D.neckK, 0.028 * D.Kv, 6, 20); bg._shared = true; _band.set(key, bg); }
      const band = new THREE.Mesh(bg, c.material);
      band.userData.rhinoBand = true;
      // round the neck axis at the first neck bone
      const ax = new THREE.Vector3(D.headP.x - D.neckB.x, D.headP.y - D.neckB.y, 0).normalize();
      band.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), ax);
      band.position.set(0.08 * D.Kv, 0.02 * D.Kv, 0);
      R.bones[BN.neck].add(band);
      return band;
    }
  }

  // ==========================================================================
  //  SENSES + BODY GOVERNOR (momentum, stamina, wounds, eyesight)
  // ==========================================================================
  function nowMs() { return typeof CBZ.now === "number" ? CBZ.now : (W.performance ? W.performance.now() : Date.now()); }
  function fightOwns(R) { return R.f && (nowMs() - R.f.at) < 140; }
  function senses(m, R, dt) {
    const st = R.st, t = m.tgt;
    // HURT: notice at once, and know where it came from
    if (m.hp < st.lastHp - 0.01) {
      const dmg = st.lastHp - m.hp;
      st.lastHp = m.hp;
      hitReaction(m, R, dmg);
      if (!st.noticed) { st.noticed = true; st.display = 0.35; st.dispSeen = t; }
    } else if (m.hp > st.lastHp) st.lastHp = m.hp;
    if (!t || t.dead) { st.dispSeen = null; return; }
    const d = Math.hypot(t.pos.x - m.pos.x, t.pos.z - m.pos.z);
    // POOR EYES, GOOD NOSE AND EARS: a man is a shape inside ~28 m, a vehicle is
    // heard at 75, a running body is heard closer than a still one is seen
    const sees = d < REAL.sight * (t.beast ? 1.25 : 1) || (t.vehicle && d < REAL.hear) || (t.speed > 5 && d < REAL.sight * 1.6);
    if (sees && !st.noticed) { st.noticed = true; }
    // THE THREAT DISPLAY: a new threat, noticed, not yet close: head low,
    // horn swinging, a snort, a front foot scraping, then the charge
    if (st.noticed && st.dispSeen !== t) {
      st.dispSeen = t;
      if (d > 9 && st.spd < 3) st.display = Math.max(st.display, 0.9 + ((m.i || 0) % 5) * 0.16);
    }
  }
  function governor(m, R, dt) {
    const st = R.st, D = R.D;
    let dx = m.pos.x - st.px, dz = m.pos.z - st.pz;
    const dd = Math.hypot(dx, dz);
    if (dd > 6 + st.spd * dt * 3) {          // a restage / teleport: start over here
      st.px = m.pos.x; st.pz = m.pos.z; st.spd = 0; st.vh = st.hd = m.heading || 0;
      const s = R.gs;
      QG.reset(R.G, m.pos.x / s, m.pos.z / s, m.heading || 0, R.ground, m.pos.y / s);
      return;
    }
    // stamina: a gallop drains it, a walk restores it
    if (st.spd > REAL.trot) st.stam = Math.max(0, st.stam - dt * (st.spd - REAL.trot) / (REAL.top - REAL.trot) / REAL.gallopS);
    else if (st.spd < 3) st.stam = Math.min(1, st.stam + dt / REAL.recoverS);
    else st.stam = Math.min(1, st.stam + dt / (REAL.recoverS * 3));
    const hpK = m.maxHp > 0 ? clamp(m.hp / m.maxHp, 0, 1) : 1;
    let cap = lerp(REAL.trot, REAL.top, sstep(0.05, 0.35, st.stam));
    cap *= (0.55 + 0.45 * Math.sqrt(hpK)) * (1 - 0.3 * st.limp) * (m._sizeMul ? Math.pow(m._sizeMul, 0.25) : 1);
    if (D.cls === "young") cap *= 0.94;
    const t = m.tgt, flee = m.state === "flee" || m.slot === "fallback" || m.routed;
    if (m.you) st.display = 0;
    else if (st.display > 0) cap = 0.35;
    else if (t && !t.dead && !st.noticed && !flee) cap = REAL.walk + 0.3;      // it walks toward what it smells
    if (fightOwns(R)) {
      // fight() moved it with the same limits: just measure
      if (dd > 1e-5 && dt > 0) { st.spd = approach(st.spd, Math.min(REAL.top * 1.1, dd / dt), 12, dt); st.vh = Math.atan2(dz, dx); }
      else st.spd = approach(st.spd, 0, 12, dt);
      st.px = m.pos.x; st.pz = m.pos.z; st.hd = m.heading || 0;
      return;
    }
    let sd = dt > 0 ? dd / dt : 0;
    if (sd > cap) sd = cap;
    let target = 0;
    if (sd > 0.05) {
      const want = Math.atan2(dz, dx);
      const om = st.spd < 1.6 ? REAL.pivot : Math.min(REAL.pivot, REAL.latA / st.spd);
      const dh = clamp(wrapPi(want - st.vh), -om * dt, om * dt);
      if (st.spd < 0.3) st.vh = want; else st.vh += dh;
      target = sd * Math.max(0, Math.cos(wrapPi(want - st.vh)));
    }
    const acc = (target > st.spd ? REAL.acc * (0.6 + 0.4 * st.stam) : REAL.brake) * dt;
    st.spd = toward(st.spd, target, acc);
    // (the battle re-resolves walls on its next step; momentum may carry a
    // stopping rhino a metre or two past where the mover would have parked it)
    m.pos.x = st.px + Math.cos(st.vh) * st.spd * dt;
    m.pos.z = st.pz + Math.sin(st.vh) * st.spd * dt;
    if (CBZ.floorAt && !m.swimD) { const y = CBZ.floorAt(m.pos.x, m.pos.z); if (y != null && isFinite(y)) m.pos.y = y; }
    st.px = m.pos.x; st.pz = m.pos.z;
    // THE BODY'S HEADING: where it is going once it is going; at a stand it
    // pivots (at the pivot rate, not the mover's snap) to what the battle
    // asked for, or squares up to the threat it is displaying at
    let hw = st.spd > 0.9 ? st.vh : (m.heading || 0);
    if (st.display > 0 && t && !t.dead) hw = Math.atan2(t.pos.z - m.pos.z, t.pos.x - m.pos.x);
    st.hd += clamp(wrapPi(hw - st.hd), -REAL.pivot * 1.4 * dt, REAL.pivot * 1.4 * dt);
    if (st.spd > 0.9) st.hd = st.vh;
    m.heading = st.hd; m.faceH = st.hd;
    if (st.spd <= 0.9) st.vh = st.hd;
    if (CBZ.faceAnimalHeading) CBZ.faceAnimalHeading(m, m.heading);
  }

  /* WHERE A ROUND LANDED decides how the body answers. The page's damage
     funnel does not carry a hit point, so the bearing of the shooter (or the
     mark, for a blow) relative to the body picks the region, weighted the way
     a body that size presents to that bearing. */
  function hitReaction(m, R, dmg) {
    const st = R.st, H = st.hit, by = m.tgt;
    const mag = clamp(dmg / Math.max(1, m.maxHp) * 9, 0.15, 1.2);   // a rifle round ~0.4: the hide shrugs it
    let lx = 1, lz = 0;
    if (by && by.pos) {
      const c = Math.cos(m.heading), s = Math.sin(m.heading), dx = by.pos.x - m.pos.x, dz = by.pos.z - m.pos.z;
      lx = c * dx + s * dz; lz = -s * dx + c * dz;
      const l = Math.hypot(lx, lz) || 1; lx /= l; lz /= l;
    }
    const r = Math.random();
    let loc;                                   // 0 head, 1 shoulder, 2 flank, 3 hind
    if (lx > 0.7) loc = r < 0.55 ? 0 : (r < 0.9 ? 1 : 2);
    else if (lx < -0.6) loc = r < 0.65 ? 3 : 2;
    else loc = r < 0.12 ? 0 : (r < 0.42 ? 1 : (r < 0.78 ? 2 : 3));
    H.t = 0; H.dur = 0.35 + 0.35 * Math.min(1, mag); H.loc = loc; H.side = lz >= 0 ? 1 : -1; H.mag = mag;
    // a leg hit leaves a limp on that leg
    if ((loc === 1 || loc === 3) && Math.random() < 0.45) {
      const leg = (loc === 1 ? 0 : 2) + (H.side > 0 ? 1 : 0);
      st.limpLeg = leg;
      st.limp = Math.min(1, st.limp + mag * 0.35);
    }
  }

  // ==========================================================================
  //  ANIMATE: the battle's per-frame call
  // ==========================================================================
  const _ik = [0, 0];
  function animate(m, dt) {
    const R = rigOf(m);
    if (!R) return;
    if (!(dt > 0)) dt = 0.016;
    if (dt > 0.12) dt = 0.12;
    if (R.unit !== m || !R.st) initUnit(m, R);
    R.tick++;
    R.gs = (m.group.scale && m.group.scale.x) || 1;
    senses(m, R, dt);
    governor(m, R, dt);
    pose(m, R, dt);
  }

  function pose(m, R, dt) {
    const st = R.st, D = R.D, K = D.Kv, b = R.bones, bp = R.bindPos, G = R.G, s = R.gs;
    st.t += dt;
    const h = m.heading || 0;
    const gx = m.pos.x / s, gz = m.pos.z / s, gy = m.pos.y / s;
    // measured motion in the model frame
    const vF = st.spd * Math.cos(wrapPi(st.vh - h)) / s;
    const turn = wrapPi(h - st.ph) / dt; st.ph = h;
    st.v = approach(st.v, clamp(vF, -3, 14), 10, dt);
    st.turn = approach(st.turn, clamp(turn, -6, 6), 8, dt);
    QG.step(G, dt, st.v, st.turn, gx, gz, h, R.ground, gy);
    const M = G.mix, ph = G.phase * TAU, moveK = clamp(Math.abs(st.v) / 0.5, 0, 1);
    const wW = (M.wW || 0) * moveK, wT = (M.wT || 0) * moveK, wG = (M.wG || 0) * moveK;

    // ---- MOODS
    const t = m.tgt, live = t && !t.dead;
    const dist = live ? Math.hypot(t.pos.x - m.pos.x, t.pos.z - m.pos.z) : 1e9;
    const flee = m.state === "flee" || m.slot === "fallback" || !!m.routed;
    const F = R.f, inFight = fightOwns(R);
    if (st.display > 0) st.display = Math.max(0, st.display - dt);
    if (st.spd < 0.25 && !live) st.still += dt; else st.still = 0;
    st.alert = approach(st.alert, live && st.noticed ? 1 : (live ? 0.6 : 0.1), 3, dt);
    st.aggr = approach(st.aggr, live && st.noticed && !flee && (st.spd > 4 || inFight || st.display > 0) ? 1 : 0, 4, dt);
    st.fear = approach(st.fear, flee ? 1 : 0, 3, dt);
    st.graze = approach(st.graze, st.still > 2.5 ? 1 : 0, 0.8, dt);
    st.disp = approach(st.disp, st.display > 0 ? 1 : 0, 6, dt);
    st.tailUp = approach(st.tailUp, (st.spd > 5 && (st.aggr > 0.5 || st.fear > 0.5)) || st.disp > 0.5 ? 1 : 0, 3, dt);
    const hpK = m.maxHp > 0 ? clamp(m.hp / m.maxHp, 0, 1) : 1;
    st.limp = Math.max(st.limp, (1 - hpK) > 0.55 ? (1 - hpK - 0.55) * 1.6 : 0);
    // the hit overlay clock
    const H = st.hit;
    if (H.t < H.dur) H.t += dt;
    const he = H.t < H.dur ? Math.sin(PI * H.t / H.dur) * H.mag : 0;
    // the strike overlay (fight's attack clock)
    let ak = null, ap = 0;
    if (F && F.atk && inFight) { ak = F.atk; ap = clamp(F.atkT / F.atkDur, 0, 1); }

    // ---- BODY: pelvis + chest
    let pX = D.hipX, pY = D.hipH, cX = D.shX, cY = D.sh, pR = 0, cR = 0, roll = 0;
    const bob = -(0.014 * wW + 0.04 * wT) * K * (0.5 - 0.5 * Math.cos(2 * ph));
    pY += bob; cY += bob;
    roll += 0.022 * wW * Math.sin(ph) + 0.012 * wT * Math.sin(ph);
    // the gallop rocks: the hind end drives up, the forehand lands
    pY += 0.06 * K * wG * Math.sin(ph - 1.6); cY += 0.06 * K * wG * Math.sin(ph + 0.4);
    const rock = 0.045 * wG * Math.sin(ph + 0.6);
    pR += rock; cR += rock * 0.6;
    cY -= 0.035 * K * st.aggr * moveK;                       // forehand down into a charge
    // the limp: the body drops onto the bad leg while it bears weight
    if (st.limp > 0.02 && moveK > 0.1) {
      const Fl = G.feet[st.limpLeg];
      if (!Fl.sw) {
        const fr = st.limpLeg < 2, sd = (st.limpLeg % 2 === 0) ? -1 : 1;
        if (fr) cY -= 0.05 * K * st.limp; else pY -= 0.05 * K * st.limp;
        roll += sd * 0.05 * st.limp;
      }
    }
    // hit reactions
    if (he > 0) {
      if (H.loc === 1) { cY -= 0.05 * K * he; roll -= H.side * 0.05 * he; }
      else if (H.loc === 2) { roll -= H.side * 0.09 * he; pY -= 0.02 * K * he; }
      else if (H.loc === 3) { pY -= 0.06 * K * he; pX += 0.05 * K * he; pR -= 0.05 * he; }
    }
    // strikes: the forehand surges into a hook or a shove
    if (ak === "hook") { const e = ap < 0.35 ? -0.4 * ap / 0.35 : Math.sin(PI * clamp((ap - 0.35) / 0.4, 0, 1)); cX += 0.08 * K * Math.max(0, e); cY += 0.04 * K * e; }
    else if (ak === "shove") { const e = Math.sin(PI * ap); cX += 0.06 * K * e; roll += (F.side || 1) * 0.08 * e; }
    else if (ak === "gore") { const e = Math.sin(PI * ap); cY += 0.06 * K * e; cR += 0.06 * e; }
    else if (ak === "trample") { const e = Math.sin(PI * ap); cY += 0.12 * K * e; cR += 0.12 * e; }
    // grazing: the forehand settles a touch
    cY -= 0.015 * K * st.graze;
    b[BN.root].rotation.set(roll, 0, 0);
    b[BN.pelvis].position.set(pX, pY, 0);
    b[BN.pelvis].rotation.set(0, 0, pR);
    b[BN.chest].position.set(cX, cY, 0);
    b[BN.chest].rotation.set(0, 0, cR);

    // ---- LEGS: feet from the gait, posture overrides, 2-bone IK + abduction
    for (let Lg = 0; Lg < 4; Lg++) {
      const front = Lg < 2, Fo = G.feet[Lg], ids = LEGB[Lg];
      const a = front ? D.fa : D.ha, bl = front ? D.fb : D.hb, cl = front ? D.fc : D.hc;
      const bx = front ? cX : pX, by = front ? cY : pY, br = front ? cR : pR;
      const off = bp[ids[0]];
      const jx = bx + Math.cos(br) * off.x - Math.sin(br) * off.y;
      const jy = by + Math.sin(br) * off.x + Math.cos(br) * off.y, jz = off.z;
      let fx = Fo.lx, fy = Fo.ly + D.footH, fz = Fo.lz;
      const su = Fo.sw ? Math.sin(PI * Fo.u) : 0;
      let fa = front ? (-HALF + 0.08 - (0.5 + 0.4 * wG) * su) : (-HALF + 0.16 - (0.3 + 0.3 * wG) * su);
      if (!front && !Fo.sw) fa += 0.18 * clamp((D.feet[Lg].x - Fo.lx) / (0.35 * K), -1, 1);
      if (Fo.sw && st.limp > 0 && Lg === st.limpLeg) fy -= Fo.ly * 0.45 * st.limp;   // a sore leg is barely lifted
      // THE SCRAPE: a front foot drags the ground during the display
      if (front && st.disp > 0.05 && !Fo.sw && Lg === ((m.i || 0) & 1)) {
        const sc = Math.sin(st.t * 5.5);
        fx += 0.16 * K * sc * st.disp; fy += 0.05 * K * Math.max(0, sc) * st.disp;
        fa -= 0.35 * Math.max(0, sc) * st.disp;
      }
      // THE TRAMPLE: the leading front foot comes up and down on the man
      if (ak === "trample" && Lg === (F.side > 0 ? 1 : 0)) {
        const e = Math.sin(PI * ap);
        fx += 0.25 * K * e; fy += 0.45 * K * Math.max(0, Math.sin(PI * Math.min(1, ap * 1.6))); fa -= 0.6 * e;
      }
      const wx = fx - cl * Math.cos(fa), wy = fy - cl * Math.sin(fa);
      const dzl = fz - jz, dyl = wy - jy;
      const abd = Math.atan2(-dzl, -dyl);
      const yp = -Math.sqrt(dyl * dyl + dzl * dzl);
      QR.ik2(0, 0, wx - jx, yp, a, bl, front ? -1 : 1, _ik);
      const t1 = _ik[0], t2 = _ik[1];
      b[ids[0]].rotation.set(abd, 0, t1 + HALF - br);
      b[ids[1]].rotation.set(0, 0, t2 - t1);
      b[ids[2]].rotation.set(0, 0, fa - t2);
    }

    // ---- NECK / HEAD / LIP
    let look = 0;
    if (live && st.alert > 0.3) {
      const want = Math.atan2(t.pos.z - m.pos.z, t.pos.x - m.pos.x);
      look = clamp(wrapPi(want - h), -0.7, 0.7);
    }
    st.lookY = approach(st.lookY, look * (1 - st.graze), 4, dt);
    // a snort now and then when alert, often in a display
    st.snortT -= dt * (0.4 + st.disp * 2.5 + st.alert * 0.4);
    if (st.snortT <= 0) { st.snortT = 1.4 + Math.random() * 2.5; st.snort = 0.32; }
    if (st.snort > 0) st.snort = Math.max(0, st.snort - dt);
    const sn = st.snort > 0 ? Math.sin(PI * (1 - st.snort / 0.32)) : 0;
    let nP = 0.0 + 0.22 * st.alert * (1 - st.aggr) - 0.55 * st.graze + 0.18 * st.fear
      - 0.12 * st.aggr - 0.15 * st.disp + 0.05 * sn - 0.1 * (1 - hpK) + 0.04 * wW * Math.sin(2 * ph + 0.5)
      - 0.05 * wG * Math.sin(ph + 0.3) - cR * 0.8;
    let hP = 0.08 * st.alert * (1 - st.aggr) - 0.35 * st.graze - 0.28 * st.aggr - 0.2 * st.disp + 0.12 * sn;
    // +y on a bone turns the nose toward -z; a positive bearing is toward +z
    let nY = -st.lookY * 0.6, hY = -st.lookY * 0.4, hRoll = 0;
    // the display: the horn swung low from side to side
    if (st.disp > 0.01) { const sw = Math.sin(st.t * 3.4); nY += 0.28 * sw * st.disp; hRoll += 0.15 * sw * st.disp; }
    // strikes
    if (ak === "hook") {
      const sd = F.side || 1;
      if (ap < 0.35) { const e = ap / 0.35; nP -= 0.35 * e; hP -= 0.2 * e; nY -= 0.25 * sd * e; }
      else if (ap < 0.6) { const e = (ap - 0.35) / 0.25; nP += lerp(-0.35, 0.45, e); hP += lerp(-0.2, 0.25, e); nY += lerp(-0.25, 0.35, e) * sd; hRoll += 0.3 * sd * Math.sin(PI * e); }
      else { const e = 1 - (ap - 0.6) / 0.4; nP += 0.45 * e; hP += 0.25 * e; nY += 0.35 * sd * e; }
    } else if (ak === "gore") {
      const e = Math.sin(PI * ap); nP += 0.55 * e; hP += 0.35 * e;
    } else if (ak === "shove") {
      const e = Math.sin(PI * ap); nY -= 0.4 * (F.side || 1) * e; nP -= 0.1 * e;
    }
    if (he > 0 && H.loc === 0) { nP += 0.3 * he; hP += 0.2 * he; nY += H.side * 0.25 * he; }
    b[BN.neck].rotation.set(hRoll * 0.3, nY * 0.55, nP * 0.55);
    b[BN.neck1].rotation.set(hRoll * 0.3, nY * 0.45, nP * 0.45);
    b[BN.head].rotation.set(hRoll * 0.4, hY, hP);
    // the lip: chewing while it grazes, parted in a snort or a charge
    st.chew += dt * 2.1 * TAU;
    const lip = 0.09 * st.graze * Math.max(0, Math.sin(st.chew)) + 0.12 * sn + 0.06 * st.aggr * moveK;
    b[BN.jaw].rotation.set(0, 0, -lip);
    // the hump rides the forehand
    b[BN.hump].position.set(bp[BN.hump].x, bp[BN.hump].y + 0.012 * K * wG * Math.sin(ph + 1.2), 0);

    // ---- EARS: each swivels on its own when calm; both forward when alert,
    // both flat back in a charge or a fight
    for (let e = 0; e < 2; e++) {
      const sg = e === 0 ? -1 : 1;
      st.earT[e] -= dt;
      if (st.earT[e] <= 0) { st.earT[e] = 0.8 + Math.random() * 2.8; st.earYW[e] = (Math.random() - 0.3) * 1.8; }
      let yw = st.earYW[e] * (1 - st.alert * 0.8);
      // swivel: +y turns the forward opening toward -z (the left side)
      yw = -sg * Math.abs(yw) * 0.5 + yw * 0.5;
      if (st.alert > 0.3) yw = lerp(yw, -sg * 0.2 - look * 0.6, st.alert);
      const back = Math.max(st.aggr, st.fear * 0.6, he > 0 ? 0.5 : 0);
      yw = lerp(yw, -sg * 1.9, back * 0.8);
      st.earY[e] = approach(st.earY[e], yw, 7, dt);
      b[e === 0 ? BN.earL : BN.earR].rotation.set(sg * -0.12 * (1 + back), st.earY[e], 0.45 * back - 0.25 * st.alert);
    }

    // ---- TAIL: hangs; swats flies; CURLS UP over the rump in a charge or a flight
    st.swishT -= dt;
    if (st.swishT <= 0) { st.swishT = 2 + Math.random() * 5; st.swish = 1; }
    st.swish = Math.max(0, st.swish - dt * 0.9);
    const sw = st.swish * 0.6 * Math.sin(st.t * 9) * (1 - st.tailUp);
    const run = 0.25 * wT + 0.35 * wG;
    b[BN.tail0].rotation.set(0, sw, lerp(1.35 - run, -0.35, st.tailUp));
    b[BN.tail1].rotation.set(0, sw * 0.8, lerp(0.05, -0.75, st.tailUp));
    b[BN.tail2].rotation.set(0, sw * 0.7, lerp(0.02, -0.6, st.tailUp));
  }

  // ==========================================================================
  //  DEATH: the solver's proxies drive the legs, head and tail
  // ==========================================================================
  const _d = [0, 0, 0];
  function aimBone(bone, dx, dy, dz) {
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;
    const tz = Math.asin(clamp(dx, -1, 1)), tx = Math.atan2(-dz, -dy);
    bone.rotation.set(tx, 0, tz);
    return bone;
  }
  // a direction from the parent frame into a bone frame of rotation (tx, 0, tz) (Euler XYZ)
  function intoBone(tx, tz, x, y, z, out) {
    // inverse of Rx(tx) Rz(tz): Rz(-tz) Rx(-tx)
    let c = Math.cos(-tx), s = Math.sin(-tx);
    const y1 = c * y - s * z, z1 = s * y + c * z;
    c = Math.cos(-tz); s = Math.sin(-tz);
    out[0] = c * x - s * y1; out[1] = s * x + c * y1; out[2] = z1;
    return out;
  }
  function afterLife(R) {
    const m = R.unit, P = R.prox;
    // did the corpse solver take the body? (it writes the proxies)
    const hp = P.head.position;
    const solved = Math.abs(hp.x - P.hx) + Math.abs(hp.y - P.hy) + Math.abs(hp.z) > 1e-4 ||
      Math.abs(P.legs[0].F.position.y - 0.1 * R.D.Kv) > 1e-4 || Math.abs(P.legs[2].F.position.x - P.legs[2].x) > 1e-4;
    if (!R.collar) R.collar = adoptCollar(R) || 1;
    if (!solved && !(m && m.dead)) return;
    deadPose(R, solved);
  }
  function deadPose(R, solved) {
    const D = R.D, K = D.Kv, b = R.bones, bp = R.bindPos, P = R.prox;
    R.deadK = Math.min(1, R.deadK + 0.06);
    // the trunk lies as the solver laid the group: body bones go to bind
    b[BN.root].rotation.set(0, 0, 0);
    b[BN.pelvis].position.set(D.hipX, D.hipH, 0); b[BN.pelvis].rotation.set(0, 0, 0);
    b[BN.chest].position.set(D.shX, D.sh, 0); b[BN.chest].rotation.set(0, 0, 0);
    for (let Lg = 0; Lg < 4; Lg++) {
      const front = Lg < 2, ids = LEGB[Lg], L = P.legs[Lg];
      if (solved) {
        // knee recovered from the two proxies, attach is the axle point
        const Fp = L.F.position, Up = L.U.position, kk = P.kneeK;
        const kx = Fp.x + (Up.x - Fp.x) / kk, ky = Fp.y + (Up.y - Fp.y) / kk, kz = Fp.z + (Up.z - Fp.z) / kk;
        const ax = L.x, ay = P.bodyY, az = L.z;
        aimBone(b[ids[0]], kx - ax, ky - ay, kz - az);
        const r0 = b[ids[0]].rotation;
        intoBone(r0.x, r0.z, Fp.x - kx, Fp.y - ky, Fp.z - kz, _d);
        aimBone(b[ids[1]], _d[0], _d[1], _d[2]);
        b[ids[2]].rotation.set(0, 0, front ? 0.35 : -0.25);
      } else {
        // the rhino's own collapse: knees buckle, the legs fold under the body
        const k = R.deadK, e = k * k * (3 - 2 * k);
        b[ids[0]].rotation.set(0, 0, (front ? 0.9 : -0.7) * e);
        b[ids[1]].rotation.set(0, 0, (front ? -1.9 : 1.6) * e);
        b[ids[2]].rotation.set(0, 0, (front ? 0.9 : -0.6) * e);
      }
    }
    if (!solved) {
      const e = R.deadK;
      b[BN.pelvis].position.y = D.hipH - 0.5 * K * e;
      b[BN.chest].position.y = D.sh - 0.42 * K * e;
    }
    // head: lolls where the solver put it (or drops)
    let nP = -0.35 * R.deadK, nY = 0;
    if (solved) {
      const hp = P.head.position, nx = D.shX + 0.3 * K, ny = P.bodyY;
      const a0 = Math.atan2(P.hy - ny, P.hx - nx), a1 = Math.atan2(hp.y - ny, Math.hypot(hp.x - nx, hp.z));
      nP = clamp(wrapPi(a1 - a0), -1.2, 1.0);
      nY = clamp(Math.atan2(-hp.z, hp.x - nx), -0.9, 0.9);
    }
    b[BN.neck].rotation.set(0, nY * 0.55, nP * 0.55);
    b[BN.neck1].rotation.set(0, nY * 0.45, nP * 0.45);
    b[BN.head].rotation.set(0.1, 0, -0.1);
    b[BN.jaw].rotation.set(0, 0, -0.12);
    b[BN.earL].rotation.set(0.3, 0, 0.6); b[BN.earR].rotation.set(-0.3, 0, 0.6);
    b[BN.tail0].rotation.set(0, 0.3, 0.9); b[BN.tail1].rotation.set(0, 0.2, 0.2); b[BN.tail2].rotation.set(0, 0, 0.1);
    void bp;
  }

  // ==========================================================================
  //  FIGHT: the charge that runs through, the hook, the shove, the trample
  // ==========================================================================
  const RES = { inRange: false, dealt: 0, missed: false };
  function moveFree(m, o, dx, dz, step) {
    if (!(step > 0) || !o || typeof o.move !== "function") return;
    const t = m.tgt; m.tgt = null;                     // the mover's stop-at-the-mark is for biters
    try { o.move(m, dx, dz, step); } catch (e) {}
    m.tgt = t;
  }
  function massOf(a) { return a ? (a._mass > 0 ? a._mass : (CBZ.bodyMass ? CBZ.bodyMass(a) : (a.beast ? 400 : 80))) : 80; }
  // the mark goes where the horn sends it: knocked down, moved by momentum
  function toss(m, t, o, fx, fz, dist, power) {
    if (!t || t.vehicle) return;
    const mm = massOf(m), mt = massOf(t), k = mm / (mm + mt);
    const d = dist * k * k;
    if (d > 0.08) {
      const tt = t.tgt; t.tgt = null;
      try { o.move(t, fx, fz, d); } catch (e) {}
      t.tgt = tt;
    }
    if (!t.dead && !t.beast && power > 0.35 && CBZ.verbs && CBZ.verbs.knockdown) {
      try { CBZ.verbs.knockdown(t, { dir: { x: fx, z: fz }, power: Math.min(1, power), dur: 1.0 + 1.6 * Math.min(1, power) }); } catch (e) {}
    }
  }
  function landBlow(m, t, o, dmg, kind) {
    if (!t || t.dead) return 0;
    if (typeof o.onHit === "function") o.onHit(dmg);
    else { t.hp -= dmg; }
    if (kind !== "shove") {
      if (CBZ.creatureBiteWound) { try { CBZ.creatureBiteWound(m, t, "gore"); } catch (e) {} }
      if (CBZ.creatureBiteBlood) { try { CBZ.creatureBiteBlood(m, t, "gore"); } catch (e) {} }
    }
    return dmg;
  }
  function startAtk(F, kind, dur, side) { F.atk = kind; F.atkT = 0; F.atkDur = dur; F.side = side; F.struck = false; }
  function faceToward(m, want, rate, dt) {
    m.heading += clamp(wrapPi(want - m.heading), -rate * dt, rate * dt);
    m.faceH = m.heading;
    if (CBZ.faceAnimalHeading) CBZ.faceAnimalHeading(m, m.heading);
  }
  function fight(m, tgt, dt, o) {
    RES.inRange = false; RES.dealt = 0; RES.missed = false;
    const R = rigOf(m);
    if (!R || !tgt || !tgt.pos || !(dt > 0)) return RES;
    if (R.unit !== m || !R.st) initUnit(m, R);
    o = o || {};
    const now = nowMs();
    let F = R.f;
    if (!F) F = R.f = { at: -1e9, mode: "close", v: 0, passed: false, hit: false, cool: 0.3, hooks: 0, back: 0, atk: null, atkT: 0, atkDur: 1, side: 1, struck: false, tgt: null, you: null };
    if (o.youMove) return youFight(m, tgt, dt, o, R, F, now);
    F.you = null;
    // a fresh entry into the bubble: arrive with the body's own speed
    if (now - F.at > 260 || F.tgt !== tgt) {
      F.v = R.st.spd; F.mode = F.v > 3.2 ? "charge" : "close"; F.passed = false; F.hit = false;
      F.atk = null; F.hooks = 0; F.back = 0; F.tgt = tgt;
    }
    F.at = now;
    const st = R.st, D = R.D, sc = R.gs || (m.group.scale.x || 1);
    st.noticed = true; st.display = 0;
    const dx = tgt.pos.x - m.pos.x, dz = tgt.pos.z - m.pos.z, dist = Math.hypot(dx, dz) || 1e-3;
    const h = m.heading || 0, fx = Math.cos(h), fz = Math.sin(h);
    const ahead = dx * fx + dz * fz, lat = -dx * fz + dz * fx;
    const ang = Math.atan2(lat, ahead);
    const tr = tgt.rad || 0.45, reach = o.reach || 3.4;
    const hornR = D.hornTip.x * sc, browR = D.noseX * sc;
    const want = Math.atan2(dz, dx);
    const base = o.dmg != null ? o.dmg : STATS.dmg;
    RES.inRange = dist <= reach;

    // the gore toss is a pose over the running charge, never a stop
    if (F.atk === "gore") { F.atkT += dt; if (F.atkT >= F.atkDur || F.mode !== "charge") F.atk = null; }
    // ---- an attack in progress plays out
    if (F.atk && F.atk !== "gore") {
      F.atkT += dt;
      const p = F.atkT / F.atkDur;
      if (F.atk !== "gore") faceToward(m, want, REAL.pivot * 0.6, dt);
      const strikeAt = F.atk === "hook" ? 0.47 : (F.atk === "trample" ? 0.55 : 0.4);
      if (!F.struck && p >= strikeAt) {
        F.struck = true;
        const angOk = Math.abs(ang) < (F.atk === "shove" ? 2.2 : 0.8);
        const near = F.atk === "shove" ? dist < (m.rad || 1.4) + tr + 0.7 : (F.atk === "trample" ? dist < browR * 0.8 + tr : dist < Math.max(reach, hornR + tr + 0.2));
        if (angOk && near && !tgt.dead) {
          const k = F.atk === "hook" ? 1.0 : (F.atk === "shove" ? 0.45 : (F.atk === "trample" ? 0.9 : 1));
          RES.dealt = landBlow(m, tgt, o, base * k, F.atk);
          const sx = F.atk === "shove" ? -fz * F.side : fx, sz = F.atk === "shove" ? fx * F.side : fz;
          if (F.atk !== "trample") toss(m, tgt, o, sx, sz, F.atk === "hook" ? 1.6 : 1.2, F.atk === "hook" ? 0.7 : 0.45);
        } else RES.missed = true;
      }
      if (p >= 1) { F.atk = null; F.cool = (o.rate || STATS.rate) * (0.8 + Math.random() * 0.35); }
      return RES;
    }

    // ---- THE CHARGE: run through the mark at speed
    if (F.mode === "charge") {
      const om = Math.min(REAL.pivot, REAL.latA / Math.max(1, F.v));
      if (!F.passed && Math.abs(ang) < 1.2) faceToward(m, want, om, dt);
      const top = Math.min(REAL.top, Math.max(o.speed || STATS.chase, 3) * 1.12) * (0.55 + 0.45 * Math.sqrt(Math.max(0, m.hp / (m.maxHp || 1))));
      if (!F.passed && Math.abs(ang) < 0.6) F.v = Math.min(top, F.v + REAL.acc * dt);
      else F.v = Math.max(0, F.v - REAL.brake * dt);
      const hx = Math.cos(m.heading), hz = Math.sin(m.heading);
      // the horn and brow sweep: does the mark stand on the line?
      if (!F.hit && !F.passed) {
        const al = (dx * hx + dz * hz), off = Math.abs(-dx * hz + dz * hx);
        if (al > 0 && al < hornR + tr + F.v * dt && off < tr + 0.35 * sc + 0.25) {
          F.hit = true;
          const vk = F.v / 12;
          const dmg = base * (0.7 + 2.3 * vk * vk);
          RES.dealt = landBlow(m, tgt, o, dmg, "gore");
          toss(m, tgt, o, hx * 0.9 - hz * 0.3 * Math.sign(off || 1), hz * 0.9 + hx * 0.3, 1.2 + F.v * 0.42, 0.4 + vk);
          F.atk = "gore"; F.atkT = 0; F.atkDur = 0.45; F.struck = true; F.passed = true;
          // something heavy stops a charge: another rhino, an elephant, a hull
          const mt = massOf(tgt);
          if (tgt.vehicle || mt > massOf(m) * 0.6) F.v *= 0.15;
          else F.v *= 0.82;
        } else if (al < -0.3) {
          F.passed = true;
          if (!F.hit) { RES.missed = true; }
        }
      }
      moveFree(m, o, hx, hz, F.v * dt);
      if (F.v < 2.2 && (F.passed || F.hit || Math.abs(ang) >= 0.6)) { F.mode = "close"; F.passed = false; F.hit = false; F.hooks = 0; }
      return RES;
    }

    // ---- CLOSE: pivot, hook, shove, trample; back off and come again
    F.cool -= dt;
    if (F.back > 0) {
      F.back -= dt;
      faceToward(m, want, REAL.pivot, dt);
      moveFree(m, o, -fx, -fz, 1.4 * dt);
      if (F.back <= 0) { F.mode = "charge"; F.v = 0.6; F.passed = false; F.hit = false; }
      return RES;
    }
    faceToward(m, want, REAL.pivot, dt);
    const down = !tgt.beast && !tgt.vehicle && (tgt.ko > 0 || (tgt.char && tgt.char.fall && tgt.char.fall.on));
    if (dist > Math.max(reach * 0.95, hornR + tr)) {
      // short of the mark: if it is in front and there is room, CHARGE it
      if (Math.abs(ang) < 0.5 && dist > hornR + tr + 1.2) { F.mode = "charge"; F.v = Math.max(F.v, 0.8); return RES; }
      if (o.move) { try { o.move(m, dx / dist, dz / dist, Math.min(2.0 * dt, dist)); } catch (e) {} }
      return RES;
    }
    if (F.cool > 0) return RES;
    if (down && dist < browR * 0.85 + tr && Math.abs(ang) < 0.7) { startAtk(F, "trample", 0.8, lat >= 0 ? 1 : -1); return RES; }
    if (Math.abs(ang) < 0.75) {
      // two or three hooks, then step back and re-charge (a short run gives the horn its speed)
      if (F.hooks >= 2 + ((m.i || 0) % 2) && !down && Math.random() < 0.6) { F.back = 0.9; F.hooks = 0; return RES; }
      F.hooks++;
      startAtk(F, "hook", 0.85, Math.random() < 0.5 ? 1 : -1);
      return RES;
    }
    if (dist < (m.rad || 1.4) + tr + 0.7) { startAtk(F, "shove", 0.55, lat >= 0 ? 1 : -1); return RES; }
    return RES;
  }

  /* A PLAYER'S RHINO (src/battle/player.js): the possessed driver latched a
     move (m._atkAnim = 0, opts.youMove) and carries the body in on a ram's
     leap; this plays it as the rhino plays it and runs _atkAnim to the end. */
  function youFight(m, tgt, dt, o, R, F, now) {
    const mv = o.youMove;
    F.at = now;
    if (F.you !== mv || m._atkAnim === 0) {
      F.you = mv;
      const dx = tgt.pos.x - m.pos.x, dz = tgt.pos.z - m.pos.z, h = m.heading || 0;
      const lat = -dx * Math.sin(h) + dz * Math.cos(h);
      const kind = mv.id === "trample" ? "trample" : (mv.id === "ram" ? "gore" : (mv.id === "shove" ? "shove" : "hook"));
      startAtk(F, kind, mv.dur > 0 ? mv.dur : (kind === "gore" ? 0.6 : 0.85), lat >= 0 ? 1 : -1);
      F.mode = "close";
    }
    const dx = tgt.pos.x - m.pos.x, dz = tgt.pos.z - m.pos.z, dist = Math.hypot(dx, dz) || 1e-3;
    const want = Math.atan2(dz, dx);
    if (F.atk !== "gore") faceToward(m, want, REAL.pivot, dt);
    else faceToward(m, want, REAL.pivot * 0.5, dt);
    F.atkT += dt;
    const p = F.atkT / F.atkDur, h = m.heading || 0, fx = Math.cos(h), fz = Math.sin(h);
    const strikeAt = F.atk === "hook" ? 0.47 : (F.atk === "trample" ? 0.55 : 0.4);
    if (!F.struck && p >= strikeAt) {
      F.struck = true;
      const ang = Math.atan2(-dx * fz + dz * fx, dx * fx + dz * fz), tr = tgt.rad || 0.45;
      const reach = (o.reach || 3.4) * 1.05;
      if (Math.abs(ang) < (F.atk === "shove" ? 2.2 : 0.9) && dist < reach + tr * 0.5) {
        const base = o.dmg != null ? o.dmg : STATS.dmg;
        const v = Math.max(R.st.spd, m.speed || 0), vk = Math.min(1, v / 12);
        const k = F.atk === "gore" ? 0.7 + 2.3 * vk * vk : (F.atk === "shove" ? 0.45 : (F.atk === "trample" ? 0.9 : 1.0));
        RES.dealt = landBlow(m, tgt, o, base * k, F.atk);
        if (!tgt.dummy && F.atk !== "trample") toss(m, tgt, o, fx, fz, F.atk === "gore" ? 1.2 + v * 0.42 : 1.6, F.atk === "gore" ? 0.4 + vk : 0.7);
      } else RES.missed = true;
    }
    if (p >= 1) { m._atkAnim = -1; F.atk = null; F.you = null; }
    else m._atkAnim = Math.max(0.001, Math.min(0.999, p));
    RES.inRange = dist <= (o.reach || 3.4);
    return RES;
  }
  /* WHAT THE RHINO THROWS when a player presses attack (src/units/kit/moves.js):
     at a run with the mark ahead, the CHARGE (the leap carries 2.3 t into it);
     a man on the floor, the TRAMPLE; something beside it, the SHOVE; else the
     upward HOOK of the horn. */
  const YOU_MOVES = {
    ram: { id: "ram", style: "ram", pow: 1, dur: 0.6, rng: 1.15, leap: 1.6, cd: 1.2 },
    hook: { id: "hook", style: "gore", pow: 1, dur: 0.85, rng: 1.0, cd: 0.55 },
    shove: { id: "shove", style: "ram", pow: 0.45, dur: 0.55, rng: 0.9, cd: 0.5 },
    trample: { id: "trample", style: "stomp", pow: 0.9, dur: 0.8, rng: 1.0, cd: 0.7 },
  };
  function moves(m, tgt, ctx) {
    ctx = ctx || {};
    const reach = ctx.reach || 3.4, dist = ctx.dist == null ? 99 : ctx.dist;
    if (tgt && ctx.downed && dist < reach * 1.1) return YOU_MOVES.trample;
    const running = !!ctx.sprint || (ctx.speed || 0) > 4.5;
    if (tgt && running && dist > reach * 0.9 && dist < reach * 3.6) return YOU_MOVES.ram;
    if (tgt && dist < reach) {
      const h = m.heading || 0, dx = tgt.pos.x - m.pos.x, dz = tgt.pos.z - m.pos.z;
      const ang = Math.atan2(-dx * Math.sin(h) + dz * Math.cos(h), dx * Math.cos(h) + dz * Math.sin(h));
      if (Math.abs(ang) > 1.0) return YOU_MOVES.shove;
    }
    return YOU_MOVES.hook;
  }

  // ==========================================================================
  //  REGISTER
  // ==========================================================================
  CBZ.unitKit.register("white_rhino", { kind: "species", stats: STATS, build: build, animate: animate, fight: fight, moves: moves });
  // the mass the battle's body maths reads (CBZ.bodyMass: an authored row wins)
  const row = CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES.white_rhino;
  if (row) row.mass = 1900;
  CBZ.whiteRhino = { REAL: REAL, STATS: STATS, RHINO_GAIT: RHINO, dims: dims, variantOf: variantOf, hideFn: hideFn };
  if (typeof module !== "undefined" && module.exports) module.exports = CBZ.whiteRhino;
})();
