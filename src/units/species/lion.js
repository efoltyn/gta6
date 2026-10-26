/* ============================================================
   units/species/lion.js — THE LION (Panthera leo), as NPC War fights it.

   OWNED BY: the lion agent. One file, the whole animal: its numbers, its
   body, how it moves and how it fights. units/species/white_lion.js is the
   same animal with the leucistic coat and rides this file (CBZ.lionKit).

   WHAT WAS HERE: the bestiary's box lion (city/wildlife/bigcats.js, ~15
   axis-aligned boxes on four posts) walked by the discovered box rig, fought
   by creature_combat's generic POUNCE with a "brave" flag and a scale of 1.15.

   THE BODY (from reference: Panthera leo skeleton + field measurements)
     male    shoulder 1.18 m, nose-to-rump 2.15 m, tail 0.92 m, 190 kg, mane
     female  shoulder 1.04 m, nose-to-rump 1.85 m, tail 0.81 m, 126 kg
   One SkinnedMesh per lion on ONE shared geometry per variant (sex x coat
   tint x mane), 31 bones: the kit's quadruped table (2 neck, 5 tail, ears,
   scapula ridge) plus a flat PAW bone per leg, so a cat stands on its toes
   with the metacarpus raked and the paw flat on the ground. Lofted torso
   (deep keel chest, high scapulae, hanging belly pouch, round croup),
   muscled limbs (triceps, forearm, quadriceps/hamstring, gastrocnemius),
   a broad square-muzzled head with a hinged jaw, canines, amber eyes,
   rounded black-backed ears, a tufted tail. The male's mane is a layered,
   shaggy shell (blond -> black, sized by age) over the neck, cheeks and
   chest, with elbow tufts. Coat = vertex colours: tawny back, cream belly,
   white chin and whisker pads with whisker-spot rows, black lip line,
   pink-to-black nose. Per individual: sex (a pride is ~1 male : 3
   lionesses), coat tint, mane colour/size, wildlife_traits' size draw.

   THE MOVEMENT. CBZ.quadGait with a LION table: lateral-sequence walk
   (duty 0.68, ~0.9 Hz), trot, ROTARY gallop (duty 0.22, ~3 Hz, gathered
   and extended spine). Every foot plants; legs are 2-bone IK with
   abduction (a planted paw stays put through a turn), the spine bends into
   turns, the scapulae ride up and down, the head nods low in the walk.
   Starts dip the chest, stops sit back. Idle: looking about, ear flicks,
   tail flicks, yawns, lying down (sphinx) when nothing is near. Moods: the
   stalk crouch, the snarl (ears flat, tail lash), panting when blown.
   Hit reactions by where it was hit (head snap, forequarter buckle,
   hindquarter sag, flank shudder); wounded limbs limp; dying hands the
   body to systems/quadruped_ragdoll.js through invisible leg/head/tail
   markers that the solver discovers, and the skin follows the solved
   points (legs splay, head lolls) on the corpse's own render.

   THE FIGHT (fight hook; the strike bubble is step.js's):
     man          a short pounce that knocks him flat (CBZ.verbs.knockdown),
                  forepaw swats, the bite to the head/neck, the pin (a man
                  under a lion is not shooting) and the killing hold
     big prey     from the rear: mount the rump with the claws; from the
                  front, once a pride-mate is up: the throat clamp
                  (suffocation, damage over time)
     big cats     rear up and box with both forepaws, then the neck bite;
                  a MALE's mane soaks 30% of what a cat or dog does to him
     armour       teeth on plate do nothing: threat display, mock charges
     the pride    a lioness that finds a mate already on the face of the
                  prey circles to its flank/rear before going in
     morale       lionesses quit at 30% hp, males fight to 15%; a pride that
                  has lost two thirds breaks and runs
   Speed is earned: a measured acceleration (~9 m/s^2), a 14-16 m/s burst
   that lasts ~10 s of sprinting (stamina), a trot approach from afar, a
   low stalk in the 25-60 m band, slower when hurt or lame.

   STATS (one truth: written back onto the bestiary row; mass per body)
     hp 215 male (lioness x0.72), bite 60 to a man (male x1.12, female x0.9),
     mass 190 / 126 kg (bodymass.js: what it soaks from fists and teeth)
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W.CBZ || (W.CBZ = {});
  const PI = Math.PI, TAU = PI * 2, HALF = PI / 2;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function sstep(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function approach(cur, want, rate, dt) { return cur + (want - cur) * Math.min(1, rate * dt); }
  function wrapPi(a) { while (a > PI) a -= TAU; while (a < -PI) a += TAU; return a; }
  function mkRng(seed) {
    let s = (seed >>> 0) || 1;
    return function () { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function cmix(a, b, t) {
    t = clamp(t, 0, 1);
    const r = ((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t;
    const g = ((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t;
    const bl = (a & 255) * (1 - t) + (b & 255) * t;
    return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
  }
  function cmul(a, k) {
    const r = clamp(Math.round(((a >> 16) & 255) * k), 0, 255), g = clamp(Math.round(((a >> 8) & 255) * k), 0, 255), b = clamp(Math.round((a & 255) * k), 0, 255);
    return (r << 16) | (g << 8) | b;
  }
  // smooth, cheap coat noise (-1..1)
  function nz(x, y, z) {
    return 0.5 * Math.sin(x * 11.3 + y * 3.1 + 1.7) * Math.sin(z * 9.7 - y * 5.3 + 0.4) +
      0.3 * Math.sin(x * 23.9 - z * 17.1 + y * 7.7) + 0.2 * Math.sin(y * 31.0 + x * 13.3 - z * 29.0);
  }
  // the coat is authored in sRGB (what a photo shows); vertex colours are linear
  const _lin = new Map();
  function lin(hex) {
    let v = _lin.get(hex);
    if (v === undefined) {
      const f = function (c) { c /= 255; return Math.round(255 * (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))); };
      v = (f((hex >> 16) & 255) << 16) | (f((hex >> 8) & 255) << 8) | f(hex & 255);
      if (_lin.size < 50000) _lin.set(hex, v);
    }
    return v;
  }
  function now() { return (typeof performance !== "undefined" ? performance.now() : Date.now()) * 0.001; }

  // =========================================================================
  //  THE NUMBERS
  // =========================================================================
  const STATS = {
    hp: 215, spd: 1.4, danger: 0.85, bite: 60, scale: 1,
    chase: 14, march: 4.4, dmg: 60, rate: 1.0,
    brave: true, prey: false,
  };
  const REAL = {
    male: { mass: 190, top: 14.5, hpK: 1, biteK: 1.12, quit: 0.15 },
    female: { mass: 126, top: 16.0, hpK: 0.72, biteK: 0.9, quit: 0.3 },
  };

  // =========================================================================
  //  COATS — tawny (Panthera leo) and leucistic (the white lion)
  // =========================================================================
  const COATS = {
    tawny: [
      { base: 0xc69c62, back: 0xa47a46, belly: 0xe4d4b0, pale: 0xeee7d8, leg: 0xc9a26a },   // golden
      { base: 0xb9976a, back: 0x977a52, belly: 0xdccfb2, pale: 0xebe5d8, leg: 0xbd9c6e },   // grey-tawny
      { base: 0xc48c56, back: 0xa0683a, belly: 0xe2cca6, pale: 0xede3d2, leg: 0xc6955e },   // rufous
    ],
    white: [
      { base: 0xe8dcc4, back: 0xd9caac, belly: 0xf2ece0, pale: 0xf7f3ea, leg: 0xe6d9c0 },
      { base: 0xe2d2b4, back: 0xd2bf9c, belly: 0xefe6d6, pale: 0xf5f0e6, leg: 0xe0cfb0 },
    ],
  };
  const MANES = {
    tawny: [
      { size: 0.72, front: 0xcda468, back: 0xa87a42 },    // young male, blond and short
      { size: 0.95, front: 0xbb8c54, back: 0x7a4e28 },
      { size: 1.10, front: 0x9e6c3e, back: 0x3e2614 },    // dark-backed
      { size: 1.20, front: 0x70492a, back: 0x1d130b },    // black-maned (Kalahari)
    ],
    white: [
      { size: 0.80, front: 0xf0e4ca, back: 0xdcc8a2 },
      { size: 1.05, front: 0xeadab8, back: 0xcfb68c },
      { size: 1.18, front: 0xe4d0aa, back: 0xc2a476 },
    ],
  };
  const FEAT = {
    tawny: { ear: 0x1c1510, earIn: 0xd9cbb0, tuft: 0x281a10, lip: 0x17110d, nose: 0x8c5a4c, noseRim: 0x2a1c17, pad: 0x2a221d,
      eye: 0xb87d1e, pupil: 0x070504, lid: 0x150f0b, spot: 0x3a2a1e, mouth: 0x7e3533, tooth: 0xeae2cc, claw: 0x2c241e },
    white: { ear: 0xb3a084, earIn: 0xeee6d6, tuft: 0xbfa680, lip: 0x6e4f46, nose: 0xc98c82, noseRim: 0x7e5249, pad: 0x8c6a62,
      eye: 0x8ea3a6, pupil: 0x080606, lid: 0x5a463e, spot: 0x9c8a74, mouth: 0x8a4440, tooth: 0xeae2cc, claw: 0x6a5a50 },
  };
  const GOLD_EYE = 0xb38a2e;

  // =========================================================================
  //  DIMENSIONS (model space: nose +X, up +Y, ground 0, left = -Z)
  // =========================================================================
  const _dims = {};
  function dims(sex) {
    if (_dims[sex]) return _dims[sex];
    const male = sex === "male";
    const H = male ? 1 : 0.88, Gt = male ? 1 : 0.92, Hs = male ? 1.1 : 0.94;
    const D = { sex: sex, male: male, H: H, Gt: Gt, Hs: Hs };
    D.withers = 1.18 * H;
    D.K = D.withers / 0.62;
    D.hipX = -0.53 * H; D.shX = 0.50 * H; D.hipH = 0.86 * H; D.sh = 0.88 * H;
    D.FJ = { x: D.shX, y: 0.80 * H }; D.HJ = { x: D.hipX - 0.02 * H, y: 0.82 * H };
    D.fa = 0.33 * H; D.fb = 0.31 * H; D.fc = 0.12 * H;
    D.ha = 0.37 * H; D.hb = 0.36 * H; D.hc = 0.22 * H;
    D.pawH = 0.052 * H; D.pawR = D.pawH;
    D.legZf = 0.18 * H * Math.sqrt(Gt); D.legZh = 0.16 * H * Math.sqrt(Gt);
    D.neckB = { x: D.shX + 0.12 * H, y: 1.00 * H };
    D.neckAng = male ? 0.30 : 0.36; D.neckLen = (male ? 0.36 : 0.34) * H;
    D.headP = { x: D.neckB.x + Math.cos(D.neckAng) * D.neckLen, y: D.neckB.y + Math.sin(D.neckAng) * D.neckLen };
    D.headAng = -0.16;
    D.u = { x: Math.cos(D.headAng), y: Math.sin(D.headAng) };
    D.n = { x: -D.u.y, y: D.u.x };
    D.hp = function (d, h) { return { x: D.headP.x + (D.u.x * d + D.n.x * h) * Hs, y: D.headP.y + (D.u.y * d + D.n.y * h) * Hs }; };
    D.jawP = D.hp(0.07, -0.075);
    D.earP = Object.assign(D.hp(0.02, 0.10), { z: 0.088 * Hs });
    D.eyeP = Object.assign(D.hp(0.215, 0.035), { z: 0.094 * Hs });
    D.mouth = D.hp(0.40, -0.07);
    D.tailP = { x: D.hipX - 0.24 * H, y: 0.97 * H }; D.tailL = 0.92 * H;
    D.hackleP = { x: D.shX - 0.04 * H, y: 1.12 * H };
    D.legLen = 0.80 * H;
    D.feet = [
      { x: D.FJ.x + 0.04 * H, z: -D.legZf, front: true },
      { x: D.FJ.x + 0.04 * H, z: D.legZf, front: true },
      { x: D.HJ.x - 0.02 * H, z: -D.legZh, front: false },
      { x: D.HJ.x - 0.02 * H, z: D.legZh, front: false },
    ];
    return (_dims[sex] = D);
  }

  // =========================================================================
  //  THE SKELETON: the kit's quadruped table + a flat paw per leg
  // =========================================================================
  let _table = null;
  function table() {
    if (_table) return _table;
    const QR = CBZ.quadRig;
    const T = QR.bones({ neck: 2, tail: 5, tailStops: [0, 0.2, 0.4, 0.6, 0.8], ears: true, hackle: true, hump: false });
    const PARENT = T.PARENT.slice();
    let n = T.NB;
    const PAW = [];
    for (let L = 0; L < 4; L++) { PAW.push(n++); PARENT.push(T.LEGB[L][2]); }
    function bindPoints(D) {
      const P = T.bindPoints(D);
      for (let L = 0; L < 4; L++) {
        const f = P[T.LEGB[L][2]], c = L < 2 ? D.fc : D.hc;
        P.push([f[0], f[1] - c, f[2]]);
      }
      return P;
    }
    _table = { BN: T.BN, LEGB: T.LEGB, PAW: PAW, PARENT: PARENT, NB: n, spec: T.spec, bindPoints: bindPoints };
    return _table;
  }

  // =========================================================================
  //  THE GAIT TABLE
  // =========================================================================
  let _gait = null;
  function gaitTable() {
    if (_gait) return _gait;
    _gait = Object.assign({}, CBZ.quadGait.TABLES.CAT, {
      gaits: [
        { name: "walk", key: "wW", off: [0.25, 0.75, 0.00, 0.50], duty: 0.64, lift: 0.055 },     // lateral sequence
        { name: "trot", key: "wT", off: [0.25, 0.75, -0.25, 0.25], duty: 0.46, lift: 0.075 },
        { name: "gallop", key: "wG", off: [0.25, 0.35, -0.13, -0.25], duty: 0.22, lift: 0.12 },  // rotary: HR HL FL FR
      ],
      trans: [[1.6, 2.3], [4.0, 5.4]],
      fMax: 4.2, f0: 1.35, fV: 0.3, strideMax: 1.35,
      vMove: 0.12, turnMove: 0.4, turnF: 1.3,
      settleRate: 2.2, restLift: 0.04, restStep: 0.06,
    });
    return _gait;
  }

  // =========================================================================
  //  GEOMETRY
  // =========================================================================
  // radial post-displacement of the rings a loft just wrote (shaggy manes)
  function displace(G, v0, S, fn) {
    const p = G.p, rings = Math.round((G.n - v0) / S);
    for (let r = 0; r < rings; r++) {
      const base = v0 + r * S;
      let cx = 0, cy = 0, cz = 0;
      for (let j = 0; j < S; j++) { const k = (base + j) * 3; cx += p[k]; cy += p[k + 1]; cz += p[k + 2]; }
      cx /= S; cy /= S; cz /= S;
      const t = rings > 1 ? r / (rings - 1) : 0;
      for (let j = 0; j < S; j++) {
        const k = (base + j) * 3, a = TAU * j / S;
        const m = fn(t, Math.cos(a), Math.sin(a), j, r, p[k], p[k + 1], p[k + 2]);
        p[k] = cx + (p[k] - cx) * m; p[k + 1] = cy + (p[k + 1] - cy) * m; p[k + 2] = cz + (p[k + 2] - cz) * m;
      }
    }
  }

  function colourer(D, coatName, tint, mane, eyeHex) {
    const P = COATS[coatName][tint], F = FEAT[coatName], MN = mane;
    const H = D.H, Hs = D.Hs, hpX = D.headP.x, hpY = D.headP.y, ux = D.u.x, uy = D.u.y, nx = D.n.x, ny = D.n.y;
    function grain(c, x, y, z, amt) { return cmul(c, 1 + nz(x / H, y / H, z / H) * amt); }
    return function (part, x, y, z, ca, sa, R, t) {
      let c = P.base;
      switch (part) {
        case "torso": {
          c = cmix(P.base, P.back, sstep(0.35, 0.95, ca) * 0.65);
          if (ca < -0.3) c = cmix(c, P.belly, sstep(-0.3, -0.75, ca));
          if (x > D.shX - 0.05 * H && ca < -0.2) c = cmix(c, P.belly, 0.5);        // brisket
          return grain(c, x, y, z, 0.05);
        }
        case "neck": {
          c = cmix(P.base, P.back, sstep(0.4, 0.95, ca) * 0.5);
          if (ca < -0.2) c = cmix(c, P.pale, sstep(-0.2, -0.7, ca));
          return grain(c, x, y, z, 0.05);
        }
        case "head": {
          const dx = x - hpX, dy = y - hpY;
          const d = (dx * ux + dy * uy) / Hs, h = (dx * nx + dy * ny) / Hs, az = Math.abs(z) / Hs;
          // the rhinarium: an inverted triangle on the front of the nose
          if (d > 0.36 && h > -0.03 && az < 0.045 * clamp((h + 0.03) / 0.07, 0.25, 1) + (d - 0.36) * 0.5) return d > 0.425 && h < -0.005 ? F.noseRim : F.nose;
          if (d > 0.22 && h < -0.078 - (0.43 - d) * 0.05) return F.lip;                                  // lip line
          if (d > 0.27 && h < -0.025) {                                                                     // whisker pads
            const spot = Math.sin(d * 190) * Math.sin(az * 150 + 0.6) > 0.72 && h > -0.072 && az > 0.03;
            return spot ? F.spot : P.pale;
          }
          if (Math.abs(d - 0.225) < 0.022 && h > -0.012 && h < 0.012 && az > 0.07) return P.pale;       // under the eye
          if (Math.abs(d - 0.20) < 0.03 && h > 0.06 && h < 0.08 && az > 0.03 && az < 0.07) return P.pale; // brow fleck
          if (d > 0.25 && h > 0.0) c = cmix(P.base, P.back, 0.35);                                        // nose bridge
          else if (h < -0.04) c = cmix(P.base, P.belly, 0.35);                                              // lower cheek
          if (MN && d < 0.1) c = cmix(c, MN.front, 0.4);
          return grain(c, x, y, z, 0.04);
        }
        case "jaw": return ca > 0.45 ? F.mouth : (ca > 0.2 ? F.lip : P.pale);
        case "palate": return F.mouth;
        case "tooth": return F.tooth;
        case "eye": return eyeHex;
        case "ear": {
          if (Math.abs(sa) > 0.82) return F.ear;
          return ca > 0 ? F.ear : F.earIn;
        }
        case "tail": {
          if (t > 0.8) return grain(F.tuft, x, y, z, 0.15);
          c = cmix(P.base, P.back, sstep(0.0, 0.9, ca) * 0.5);
          if (t > 0.7) c = cmix(c, F.tuft, (t - 0.7) / 0.1 * 0.6);
          return grain(c, x, y, z, 0.05);
        }
        case "leg": {
          c = P.leg;
          const inner = sa * (z < 0 ? 1 : -1);
          if (inner > 0.35) c = cmix(c, P.belly, 0.45);
          if (ca < -0.5) c = cmix(c, P.belly, 0.25);
          return grain(c, x, y, z, 0.05);
        }
        case "thigh": {
          c = cmix(P.leg, P.back, sstep(-0.2, 0.8, -ca) * 0.25);
          const inner = sa * (z < 0 ? 1 : -1);
          if (inner > 0.35) c = cmix(c, P.belly, 0.5);
          return grain(c, x, y, z, 0.05);
        }
        case "paw": return ca < -0.55 ? F.pad : grain(cmix(P.leg, P.pale, 0.3), x, y, z, 0.04);
        case "claw": return F.claw;
        case "mane": {
          // t: 0 at the shoulders -> 1 at the face. Blond at the face, dark behind
          c = cmix(MN.back, MN.front, Math.pow(t, 0.8));
          if (ca < -0.3) c = cmix(c, MN.back, 0.35 * sstep(-0.3, -0.9, ca));
          const streak = Math.sin(Math.atan2(sa, ca) * 9 + x * 14 / H) * 0.5 + Math.sin(Math.atan2(sa, ca) * 23 - y * 9 / H) * 0.5;
          return cmul(c, 1 + streak * 0.1 + nz(x, y, z) * 0.05);
        }
        case "tuft": return MN ? MN.back : F.tuft;
      }
      return c;
    };
  }

  function buildGeometry(D, coatName, tint, maneIdx, eyeHex) {
    const LK = CBZ.loftKit, G = LK.geo(), T = table(), BN = T.BN, LEGB = T.LEGB, PAW = T.PAW;
    const H = D.H, Gt = D.Gt, Hs = D.Hs;
    const MN = D.male && maneIdx >= 0 ? MANES[coatName][maneIdx] : null;
    const col = colourer(D, coatName, tint, MN, eyeHex);
    const C = function (part) { return function (x, y, z, ca, sa, R, t) { return lin(col(part, x, y, z, ca, sa, R, t)); }; };
    const PL = BN.pelvis, CH = BN.chest, N0 = BN.neck, N1 = BN.neck1, HD = BN.head;
    const loft = function (st, S, part, opts, disp) {
      const v0 = G.n;
      LK.loft(G, st, S, C(part), Object.assign({ hkBone: BN.hackle }, opts || {}));
      if (disp) displace(G, v0, S, disp);
    };

    // ---- TORSO: croup -> loin -> belly pouch -> keel chest -> withers -> point of shoulder
    const g = H * Gt;
    const TOR = [
      [-0.80, 0.90, 0.08, 0.08, 0.08, 0],
      [-0.76, 0.89, 0.14, 0.19, 0.15, 0],
      [-0.68, 0.87, 0.18, 0.28, 0.20, 0],
      [-0.56, 0.86, 0.19, 0.34, 0.225, 0],
      [-0.42, 0.86, 0.18, 0.31, 0.215, 0],
      [-0.26, 0.85, 0.19, 0.31, 0.22, 0],
      [-0.08, 0.85, 0.22, 0.36, 0.235, 0],
      [0.12, 0.86, 0.255, 0.40, 0.245, 0.2],
      [0.32, 0.88, 0.28, 0.40, 0.25, 0.6],
      [0.48, 0.91, 0.27, 0.37, 0.245, 1],
      [0.60, 0.93, 0.22, 0.32, 0.21, 0.5],
      [0.68, 0.95, 0.17, 0.25, 0.17, 0],
    ];
    const tor = TOR.map(function (r) {
      const wP = clamp((0.25 - r[0]) / 0.75, 0, 1);
      return { x: r[0] * H, y: r[1] * H, rt: r[2] * g, rb: r[3] * g * (D.male ? 1 : 0.95), w: r[4] * g * 1.12, sq: 0.95, wts: [PL, wP, CH, 1 - wP], hk: r[5] };
    });
    loft(tor, 26, "torso", { capLen: 0.8 });

    // ---- NECK
    const nb = D.neckB, hp0 = D.headP, mk = D.male ? 1.1 : 1;
    const nk = function (t) { return { x: lerp(nb.x, hp0.x, t), y: lerp(nb.y, hp0.y, t) }; };
    const n0 = nk(0), n1 = nk(0.35), n2 = nk(0.7), n3 = nk(1);
    loft([
      { x: 0.56 * H, y: 0.96 * H, rt: 0.21 * g, rb: 0.25 * g, w: 0.19 * g, wts: [CH, 1] },
      { x: n0.x, y: n0.y, rt: 0.19 * g * mk, rb: 0.21 * g * mk, w: 0.165 * g * mk, wts: [CH, 0.5, N0, 0.5] },
      { x: n1.x, y: n1.y, rt: 0.165 * g * mk, rb: 0.175 * g * mk, w: 0.145 * g * mk, wts: [N0, 0.8, N1, 0.2] },
      { x: n2.x, y: n2.y, rt: 0.14 * g * mk, rb: 0.145 * g * mk, w: 0.125 * g * mk, wts: [N0, 0.2, N1, 0.8] },
      { x: n3.x, y: n3.y, rt: 0.12 * Hs, rb: 0.125 * Hs, w: 0.115 * Hs, wts: [N1, 0.5, HD, 0.5] },
    ], 18, "neck", { capLen: 0.6 });

    // ---- HEAD: occiput -> cranium -> zygomatic arch -> brow -> long nose -> square muzzle -> nose
    const HEAD = [
      [-0.05, 0.0, 0.09, 0.10, 0.10, 1],
      [0.02, 0.012, 0.13, 0.12, 0.14, 0.95],
      [0.10, 0.008, 0.13, 0.13, 0.162, 0.9],
      [0.18, -0.004, 0.11, 0.122, 0.145, 0.85],
      [0.25, -0.012, 0.09, 0.118, 0.122, 0.75],
      [0.32, -0.016, 0.08, 0.116, 0.118, 0.68],
      [0.38, -0.018, 0.074, 0.108, 0.11, 0.68],
      [0.415, -0.018, 0.064, 0.094, 0.098, 0.75],
    ];
    loft(HEAD.map(function (r) {
      const p = D.hp(r[0], r[1]);
      return { x: p.x, y: p.y, rt: r[2] * Hs, rb: r[3] * Hs, w: r[4] * Hs, sq: r[5], wts: [HD, 1] };
    }), 22, "head", { capLen: 0.38 });
    // palate (seen only when the mouth opens)
    loft([0.16, 0.26, 0.36].map(function (d, i) {
      const p = D.hp(d, -0.072);
      return { x: p.x, y: p.y, rt: 0.012 * Hs, rb: 0.012 * Hs, w: [0.075, 0.07, 0.05][i] * Hs, wts: [HD, 1] };
    }), 10, "palate", { capLen: 0.5 });
    // upper canines
    for (let s = -1; s <= 1; s += 2) {
      const p0 = D.hp(0.355, -0.085), p1 = D.hp(0.36, -0.128);
      loft([0, 0.5, 1].map(function (t, i) {
        return { x: lerp(p0.x, p1.x, t), y: lerp(p0.y, p1.y, t), z: s * 0.038 * Hs, rt: [0.011, 0.008, 0.003][i] * Hs, rb: [0.011, 0.008, 0.003][i] * Hs, w: [0.009, 0.007, 0.003][i] * Hs, wts: [HD, 1] };
      }), 6, "tooth", { capLen: 0.4, side: [1, 0, 0] });
    }
    // lower jaw: hinge -> chin
    const J0 = D.jawP, J1 = D.hp(0.375, -0.112);
    loft([0, 0.35, 0.7, 1].map(function (t, i) {
      return { x: lerp(J0.x, J1.x, t), y: lerp(J0.y, J1.y, t), rt: [0.028, 0.026, 0.022, 0.018][i] * Hs, rb: [0.045, 0.042, 0.036, 0.03][i] * Hs, w: [0.088, 0.074, 0.06, 0.046][i] * Hs, wts: [BN.jaw, 1] };
    }), 14, "jaw", { capLen: 0.7 });
    // lower canines
    for (let s = -1; s <= 1; s += 2) {
      const p0 = D.hp(0.335, -0.098), p1 = D.hp(0.335, -0.062);
      loft([0, 0.5, 1].map(function (t, i) {
        return { x: lerp(p0.x, p1.x, t), y: lerp(p0.y, p1.y, t), z: s * 0.03 * Hs, rt: [0.01, 0.007, 0.003][i] * Hs, rb: [0.01, 0.007, 0.003][i] * Hs, w: [0.008, 0.006, 0.002][i] * Hs, wts: [BN.jaw, 1] };
      }), 6, "tooth", { capLen: 0.4, side: [1, 0, 0] });
    }
    // eyes: amber iris, round pupil, dark lids, set forward at the stop
    for (let s = -1; s <= 1; s += 2) {
      const E = D.eyeP, ez = s * E.z, rx = 0.021 * Hs, ry = 0.017 * Hs, rz = 0.016 * Hs;
      const fx = 0.85, fy = 0.1, fz = s * 0.5, fl = Math.hypot(fx, fy, fz);
      LK.ellipsoid(G, E.x, E.y, ez, rx, ry, rz, 12, function (x, y, z) {
        const dx = (x - E.x) / rx, dy = (y - E.y) / ry, dz = (z - ez) / rz, dl = Math.hypot(dx, dy, dz) || 1;
        const dot = (dx * fx + dy * fy + dz * fz) / (dl * fl);
        return lin(dot > 0.93 ? FEAT[coatName].pupil : dot > 0.5 ? eyeHex : FEAT[coatName].lid);
      }, [HD, 1]);
    }
    // ears: short, rounded, set wide; black backs
    for (let s = -1; s <= 1; s += 2) {
      const eb = BN[s < 0 ? "earL" : "earR"], E = D.earP, eh = 0.062 * Hs;
      loft([0, 0.35, 0.7, 1].map(function (t, i) {
        return { x: E.x - 0.008 * t * Hs, y: E.y + eh * t, z: s * (E.z + 0.02 * t * Hs),
          rt: [0.016, 0.014, 0.012, 0.009][i] * Hs, rb: [0.01, 0.009, 0.008, 0.006][i] * Hs, w: [0.045, 0.05, 0.046, 0.034][i] * Hs, wts: [eb, 1] };
      }), 12, "ear", { capLen: 1.6 });
    }

    // ---- TAIL: five bones, the black tuft at the tip
    const TP = D.tailP, TL = D.tailL, prof = [1.0, 0.82, 0.68, 0.6, 0.55, 0.5, 0.48, 0.5, 0.95, 1.05, 0.7];
    const tst = [];
    for (let i = 0; i < prof.length; i++) {
      const t = i / (prof.length - 1), seg = Math.min(4, Math.floor(t * 5)), f = t * 5 - seg;
      const wts = seg < 4 ? [BN["tail" + seg], 1 - f * 0.5, BN["tail" + (seg + 1)], f * 0.5] : [BN.tail4, 1];
      const r = 0.055 * prof[i] * g;
      tst.push({ x: TP.x - TL * t, y: TP.y, rt: r, rb: r, w: r * 0.95, wts: wts });
    }
    loft(tst, 12, "tail", { capLen: 0.9 }, function (t, ca, sa, j) {
      return t > 0.78 ? 1 + 0.18 * Math.sin(j * 2.3 + t * 30) : 1;      // the tuft is ragged
    });

    // ---- LEGS (bind: straight down from each joint; the IK bends them)
    const pts = T.bindPoints(D);
    for (let Lg = 0; Lg < 4; Lg++) {
      const front = Lg < 2, ids = LEGB[Lg], P0 = pts[ids[0]], z = P0[2], x = P0[0], y0 = P0[1];
      const a = front ? D.fa : D.ha, b = front ? D.fb : D.hb, c = front ? D.fc : D.hc;
      const k = H * Gt * 1.3;
      const ring = function (dy, rt, rb, w, wts) { return { x: x, y: y0 + dy * H, z: z, rt: rt * k, rb: rb * k, w: w * k, wts: wts }; };
      if (front) {
        loft([
          ring(0.16, 0.10, 0.11, 0.095, [ids[0], 1]),
          ring(0, 0.10, 0.12, 0.09, [ids[0], 1]),
          ring(-0.14, 0.075, 0.125, 0.08, [ids[0], 1]),        // the triceps mass
          ring(-0.26, 0.055, 0.10, 0.068, [ids[0], 1]),
          ring(-a / H, 0.05, 0.07, 0.058, [ids[0], 0.5, ids[1], 0.5]),
        ], 14, "leg", { capLen: 0.7 });
        loft([
          ring(-a / H, 0.055, 0.065, 0.058, [ids[1], 1]),
          ring(-a / H - 0.06, 0.062, 0.05, 0.058, [ids[1], 1]),  // forearm
          ring(-a / H - 0.17, 0.045, 0.038, 0.045, [ids[1], 1]),
          ring(-(a + b) / H, 0.036, 0.03, 0.04, [ids[1], 0.5, ids[2], 0.5]),
        ], 12, "leg", { capLen: 0.7 });
        if (D.male && MN) {     // elbow tuft
          LK.ellipsoid(G, x - 0.075 * H, y0 - a + 0.02 * H, z, 0.05 * H, 0.04 * H, 0.03 * H, 8, C("tuft"), [ids[1], 1]);
        }
      } else {
        loft([
          ring(0.16, 0.12, 0.12, 0.10, [ids[0], 1]),
          ring(0, 0.14, 0.15, 0.105, [ids[0], 1]),              // quadriceps / hamstrings
          ring(-0.15, 0.12, 0.12, 0.09, [ids[0], 1]),
          ring(-0.27, 0.075, 0.08, 0.07, [ids[0], 1]),
          ring(-a / H, 0.05, 0.055, 0.052, [ids[0], 0.5, ids[1], 0.5]),
        ], 14, "thigh", { capLen: 0.7 });
        loft([
          ring(-a / H, 0.05, 0.06, 0.05, [ids[1], 1]),
          ring(-a / H - 0.08, 0.045, 0.075, 0.048, [ids[1], 1]), // gastrocnemius
          ring(-a / H - 0.2, 0.033, 0.045, 0.036, [ids[1], 1]),
          ring(-(a + b) / H, 0.025, 0.035, 0.032, [ids[1], 0.5, ids[2], 0.5]),  // hock + Achilles
        ], 12, "leg", { capLen: 0.7 });
      }
      // metacarpus / metatarsus
      loft([
        ring(-(a + b) / H, front ? 0.035 : 0.028, front ? 0.03 : 0.035, front ? 0.04 : 0.032, [ids[2], 1]),
        ring(-(a + b) / H - c / H * 0.6, front ? 0.03 : 0.026, front ? 0.028 : 0.024, front ? 0.036 : 0.03, [ids[2], 1]),
        ring(-(a + b + c) / H, 0.036, 0.03, 0.042, [ids[2], 0.5, PAW[Lg], 0.5]),
      ], 10, "leg", { capLen: 0.6 });
      // the paw: flat, broad, on its pads
      const my = y0 - a - b - c, pk = (front ? 1 : 0.88) * H;
      loft([
        [-0.035, 0.008, 0.035, 0.045, 0.05], [0.015, -0.0, 0.042, 0.05, 0.062],
        [0.06, -0.006, 0.036, 0.046, 0.062], [0.092, -0.012, 0.024, 0.034, 0.05],
      ].map(function (r, i) {
        return { x: x + r[0] * pk, y: my + r[1] * pk, z: z, rt: r[2] * pk, rb: r[3] * pk, w: r[4] * pk, sq: 0.85, wts: i === 0 ? [ids[2], 0.4, PAW[Lg], 0.6] : [PAW[Lg], 1] };
      }), 12, "paw", { capLen: 0.6 });
    }

    // ---- THE MANE: layered, shaggy, blond at the face and dark behind
    if (MN) {
      const ms = MN.size;
      const ph = [tint * 1.7 + maneIdx, maneIdx * 2.3 + 0.4, tint + 2.1];
      const st = function (p, body, mane, wts) {
        return { x: p.x, y: p.y, rt: lerp(body[0], mane[0], ms) * H, rb: lerp(body[1], mane[1], ms) * H, w: lerp(body[2], mane[2], ms) * H, wts: wts };
      };
      const shag = function (amp) {
        return function (t, ca, sa, j, r) {
          const a = TAU * j / 40;
          const edge = sstep(0.0, 0.25, t) * (1 - sstep(0.88, 1.0, t) * 0.7);
          const lock = 0.5 * Math.sin(a * 5 + ph[0] + t * 3) + 0.32 * Math.sin(a * 9 + ph[1] - t * 4) + 0.18 * Math.sin(a * 14 + ph[2] + t * 6);
          const droop = ca < 0 ? 1 + (-ca) * 0.6 : 1;
          return Math.max(0.86, 1 + amp * edge * lock * droop + (ca < -0.2 ? 0.04 * edge : 0));
        };
      };
      const vMain = G.n;
      loft([
        st({ x: D.shX - 0.20 * H, y: 0.99 * H }, [0.26, 0.34, 0.24], [0.28, 0.37, 0.27], [CH, 1]),
        st({ x: D.shX - 0.06 * H, y: 1.02 * H }, [0.25, 0.33, 0.235], [0.32, 0.42, 0.31], [CH, 1]),
        st(nb, [0.19, 0.21, 0.165], [0.33, 0.43, 0.32], [CH, 0.5, N0, 0.5]),
        st(nk(0.5), [0.15, 0.16, 0.135], [0.31, 0.41, 0.30], [N0, 0.4, N1, 0.6]),
        st(D.hp(-0.06, 0.01), [0.11, 0.12, 0.12], [0.27, 0.33, 0.27], [N1, 0.4, HD, 0.6]),
        st(D.hp(0.04, 0.0), [0.13, 0.122, 0.142], [0.16, 0.18, 0.18], [HD, 1]),
      ], 40, "mane", { capB: false, capLen: 0.9 }, shag(0.13));
      void vMain;
      // the forelock / crown between the ears
      loft([
        st(D.hp(-0.05, 0.03), [0.08, 0.06, 0.09], [0.14, 0.06, 0.15], [HD, 1]),
        st(D.hp(0.02, 0.03), [0.11, 0.06, 0.12], [0.145, 0.06, 0.155], [HD, 1]),
        st(D.hp(0.08, 0.02), [0.1, 0.05, 0.13], [0.115, 0.05, 0.14], [HD, 1]),
      ], 40, "mane", { capLen: 0.7 }, shag(0.08));
    }

    const LK2 = CBZ.loftKit;
    return LK2.toGeometry(G, { boundingSphere: [0, 0.75 * H, 0, 1.9 * H] });
  }

  // =========================================================================
  //  BUILD
  // =========================================================================
  const _geo = new Map();
  let _mat = null, _mkGeo = null;
  function coatMat() {
    const THREE = W.THREE;
    if (!_mat) {
      _mat = new THREE.MeshStandardMaterial({ vertexColors: true, skinning: true, roughness: 0.9, metalness: 0 });
      _mat._shared = true; _mat.name = "lion-coat";
    }
    return _mat;
  }
  function markerGeo(w, h, d) {
    const THREE = W.THREE, key = w + "|" + h + "|" + d;
    _mkGeo = _mkGeo || new Map();
    let gg = _mkGeo.get(key);
    if (!gg) { gg = new THREE.BoxGeometry(w, h, d); gg._shared = true; _mkGeo.set(key, gg); }
    return gg;
  }
  let _mkMat = null;
  function marker(group, w, h, d, x, y, z, tag) {
    const THREE = W.THREE;
    if (!_mkMat) { _mkMat = new THREE.MeshBasicMaterial({ visible: false }); _mkMat._shared = true; }
    const m = new THREE.Mesh(markerGeo(+w.toFixed(3), +h.toFixed(3), +d.toFixed(3)), _mkMat);
    m.position.set(x, y, z);
    m.visible = false; m.castShadow = false; m.userData.lionMarker = tag;
    group.add(m);
    return m;
  }

  function build(ctx, coatName) {
    const THREE = W.THREE, QR = CBZ.quadRig;
    if (!THREE || !QR || !CBZ.loftKit || !CBZ.quadGait) return null;
    coatName = coatName === "white" ? "white" : "tawny";
    const seed = Math.abs(ctx && ctx.seed != null ? (ctx.seed | 0) : Math.floor(((ctx && ctx.rng) ? ctx.rng() : Math.random()) * 1e6));
    const idx = seed % 7919;                          // the spawn index on either side
    const r = mkRng(seed * 2654435761 + 0x11a7);
    const sex = idx % 4 === 0 ? "male" : "female";    // a pride: ~1 male to 3 lionesses
    const D = dims(sex);
    const tint = Math.floor(r() * COATS[coatName].length);
    const mane = sex === "male" ? Math.floor(r() * MANES[coatName].length) : -1;
    const eyeHex = coatName === "white" ? (r() < 0.5 ? FEAT.white.eye : GOLD_EYE) : FEAT.tawny.eye;
    const key = coatName + "|" + sex + "|" + tint + "|" + mane + "|" + eyeHex;
    let geo = _geo.get(key);
    if (!geo) { geo = buildGeometry(D, coatName, tint, mane, eyeHex); _geo.set(key, geo); }
    const T = table();
    const rig = QR.makeSkeleton(T, D, "lion");
    const mesh = QR.skinnedMesh(geo, coatMat(), rig);
    mesh.name = "lion-body";
    mesh.receiveShadow = false;
    const group = new THREE.Group();
    group.add(mesh);
    group.userData.dynamic = true;
    group.name = coatName === "white" ? "white-lion" : "lion";
    rig.D = D; rig.table = T; rig.sex = sex; rig.male = sex === "male"; rig.coat = coatName;
    rig.mane = mane >= 0 ? MANES[coatName][mane] : null;
    rig.G = CBZ.quadGait.create(D, gaitTable());
    rig.st = newState(r);
    rig.ctl = { x: 0, z: 0, y: 0, heading: 0, ground: null, alert: 0.3, aggr: 0, fear: 0, crouch: 0, tired: 0, rest: 0, act: null, inj: null, lookAt: null };
    rig.group = group;
    // ---- markers the corpse solver discovers (invisible: legs, head, tail)
    const H = D.H;
    rig.mk = [];
    for (let L = 0; L < 4; L++) {
      const f = D.feet[L], J = L < 2 ? D.FJ : D.HJ;
      const full = marker(group, 0.07, J.y, 0.07, f.x, J.y / 2, f.z, "leg");
      const foot = marker(group, 0.04, 0.11, 0.04, f.x, 0.055, f.z, "foot");
      rig.mk.push({ full: full, foot: foot, fx: f.x, fz: f.z, fy: 0.055, ky: J.y / 2 });
    }
    const hc = D.hp(0.16, 0);
    rig.mkHead = marker(group, 0.08, 0.08, 0.08, hc.x, hc.y, 0, "head");
    rig.mkHead0 = { x: hc.x, y: hc.y, z: 0 };
    rig.mkTail = marker(group, 0.06, 0.06, 0.06, D.tailP.x - 0.35 * H, D.tailP.y - 0.12 * H, 0, "tail");
    rig.mkTail0 = { x: rig.mkTail.position.x, y: rig.mkTail.position.y, z: 0 };
    rig.frame = -1;
    mesh.onBeforeRender = function (renderer) { corpseHook(rig, renderer); };
    group.userData.lionRig = rig;
    return group;
  }

  // =========================================================================
  //  POSE
  // =========================================================================
  function newState(r) {
    r = r || Math.random;
    return { px: null, pz: null, ph: 0, v: 0, acc: 0, turn: 0, t: r() * 10,
      alert: 0.3, aggr: 0, fear: 0, crouch: 0, tired: 0, sit: 0, lie: 0, idleT: 0,
      lookY: 0, lookP: 0, lookTY: 0, lookTP: 0, lookT: 1 + r() * 2,
      earT: [r() * 3, r() * 3], earF: [0, 0], flickT: 2 + r() * 4, flick: 0, yawnT: 8 + r() * 20, yawn: 0,
      sway: 0, lash: 0, actW: 0, ak: null, ap: 0, aside: 1,
      fl: { t: 0, k: 0, loc: 0, side: 1 }, inj: [0, 0, 0, 0], wasPost: false, deadK: 0, lastT: 0 };
  }
  const _ik = [0, 0];
  function legIK(rig, Lg, bx, by, br, yaw, fx, fy, fz, fa, pawA) {
    const D = rig.D, b = rig.bones, T = rig.table, ids = T.LEGB[Lg], front = Lg < 2;
    const a = front ? D.fa : D.ha, bl = front ? D.fb : D.hb, cl = front ? D.fc : D.hc;
    const off = rig.bindPos[ids[0]];
    const jx = bx + Math.cos(br) * off.x - Math.sin(br) * off.y;
    const jy = by + Math.sin(br) * off.x + Math.cos(br) * off.y;
    const jz = off.z;
    // the target, brought into the parent's yawed frame (spine bend)
    const rx = fx - bx, cy = Math.cos(yaw), sy = Math.sin(yaw);
    const tx = bx + rx * cy - fz * sy, tz = rx * sy + fz * cy;
    // abduction: the leg's plane rolls about the body axis to reach the paw
    const dz = tz - jz, dyv = Math.max(0.04, jy - fy);
    const ab = clamp(-Math.atan2(dz, dyv), -0.75, 0.75);
    const ty = jy - Math.hypot(dyv, dz);
    const wx = tx - cl * Math.cos(fa), wy = ty - cl * Math.sin(fa);
    CBZ.quadRig.ik2(jx, jy, wx, wy, a, bl, front ? -1 : 1, _ik);
    const t1 = _ik[0], t2 = _ik[1];
    b[ids[0]].rotation.set(ab, 0, t1 + HALF - br);
    b[ids[1]].rotation.set(0, 0, t2 - t1);
    b[ids[2]].rotation.set(0, 0, fa - t2);
    b[T.PAW[Lg]].rotation.set(0, 0, pawA - fa - HALF);
  }

  // one-shot envelope: up over [a, b], hold, down over [c, d]
  function env(p, a, b, c, d) { return p < a || p > d ? 0 : p < b ? sstep(a, b, p) : p < c ? 1 : 1 - sstep(c, d, p); }

  // per-leg override scratch
  const OV = [0, 1, 2, 3].map(function () { return { w: 0, x: 0, y: 0, z: 0, a: 0, paw: 0 }; });

  function pose(rig, dt, c) {
    if (!(dt > 0)) dt = 0.016;
    if (dt > 0.1) dt = 0.1;
    const QG = CBZ.quadGait;
    const D = rig.D, H = D.H, b = rig.bones, bp = rig.bindPos, BN = rig.table.BN, st = rig.st, G = rig.G;
    st.t += dt;
    const gx = c.x, gz = c.z, h = c.heading || 0;
    // ---- MEASURED motion: whatever moved the body, the legs answer to it
    if (st.px == null) { st.px = gx; st.pz = gz; st.ph = h; }
    const mdx = gx - st.px, mdz = gz - st.pz;
    let v = (mdx * Math.cos(h) + mdz * Math.sin(h)) / dt, turn = wrapPi(h - st.ph) / dt;
    if (mdx * mdx + mdz * mdz > 9) { v = 0; turn = 0; QG.reset(G, gx, gz, h, c.ground, c.y); }
    st.px = gx; st.pz = gz; st.ph = h;
    const vPrev = st.v;
    st.v = approach(st.v, clamp(v, -4, 20), 8, dt);
    st.acc = approach(st.acc, clamp((st.v - vPrev) / dt, -12, 12), 4, dt);
    st.turn = approach(st.turn, clamp(turn, -6, 6), 8, dt);
    const av = Math.abs(st.v);

    // ---- the action channel (fight hook / preview)
    const A = c.act;
    if (A) { st.ak = A.kind; st.ap = A.p; st.aside = A.side || 1; }
    st.actW = approach(st.actW, A ? 1 : 0, A ? 14 : 6, dt);
    const aw = st.actW, ak = aw > 0.01 ? st.ak : null, ap = st.ap;

    // ---- moods
    st.alert = approach(st.alert, clamp(c.alert || 0, 0, 1), 4, dt);
    st.aggr = approach(st.aggr, clamp(c.aggr || 0, 0, 1), 5, dt);
    st.fear = approach(st.fear, clamp(c.fear || 0, 0, 1), 4, dt);
    st.crouch = approach(st.crouch, clamp(c.crouch || 0, 0, 1), 3, dt);
    st.tired = approach(st.tired, clamp(c.tired || 0, 0, 1), 1.5, dt);
    if (c.inj) for (let i = 0; i < 4; i++) st.inj[i] = approach(st.inj[i], c.inj[i], 2, dt);
    // idle -> lie down when nothing is near (c.rest)
    if (av < 0.2 && !ak) st.idleT += dt; else st.idleT = 0;
    const wantLie = c.rest && st.idleT > 7 ? 1 : 0;
    st.lie = approach(st.lie, wantLie, wantLie ? 0.9 : 3.5, dt);
    st.sit = 0;
    // idle looks, ear flicks, tail flicks, yawns
    st.lookT -= dt;
    if (st.lookT <= 0) {
      const busy = av > 1.5 || ak;
      st.lookT = 1.2 + Math.random() * 3;
      st.lookTY = busy ? 0 : (Math.random() - 0.5) * (1.4 - st.aggr);
      st.lookTP = busy ? 0 : (Math.random() - 0.4) * 0.35;
    }
    if (c.lookAt) {
      const la = wrapPi(Math.atan2(c.lookAt.z - gz, c.lookAt.x - gx) - h);
      st.lookTY = clamp(-la, -1.1, 1.1);
    }
    st.lookY = approach(st.lookY, st.lookTY, 3, dt);
    st.lookP = approach(st.lookP, st.lookTP, 3, dt);
    for (let e = 0; e < 2; e++) {
      st.earT[e] -= dt;
      if (st.earT[e] <= 0) { st.earT[e] = 1.5 + Math.random() * 5; st.earF[e] = 1; }
      st.earF[e] = Math.max(0, st.earF[e] - dt * 5);
    }
    st.flickT -= dt;
    if (st.flickT <= 0) { st.flickT = 2 + Math.random() * 6; st.flick = 1; }
    st.flick = Math.max(0, st.flick - dt * 1.6);
    st.yawnT -= dt;
    if (st.yawnT <= 0 && av < 0.3 && !ak && st.aggr < 0.3) { st.yawn = 2.2; st.yawnT = 20 + Math.random() * 40; }
    if (st.yawn > 0) st.yawn = Math.max(0, st.yawn - dt);
    const yawnE = st.yawn > 0 ? env(2.2 - st.yawn, 0, 0.7, 1.5, 2.2) : 0;
    // flinch
    const F = st.fl;
    if (F.t > 0) F.t = Math.max(0, F.t - dt);
    const fk = F.t > 0 ? F.k * Math.sin(PI * Math.min(1, F.t / 0.45)) * (F.t / 0.45) : 0;

    // ---- GAIT (standing; a cat in the air or lying down does not step)
    const flight = ak === "pounce" && aw > 0.5 && ap > 0.26 && ap < 0.78;
    const postK = Math.max(st.lie, flight ? 1 : 0);
    if (postK < 0.08) {
      if (st.wasPost) { QG.reset(G, gx, gz, h, c.ground, c.y); st.wasPost = false; }
      QG.step(G, dt, st.v, st.turn, gx, gz, h, c.ground, c.y);
    } else st.wasPost = true;
    const M = G.mix, ph = G.phase * TAU;
    const moveK = clamp(av / 0.6, 0, 1) * (1 - postK);
    const wlk = (M.wW || 0) * moveK, trt = (M.wT || 0) * moveK, gal = (M.wG || 0) * moveK;

    // ---- BODY: pelvis + chest positions and pitch
    let pX = D.hipX, pY = D.hipH, pR = 0, cX = D.shX, cY = D.sh, cR = 0, roll = 0;
    const bob = -(0.012 * wlk + 0.02 * trt) * H * (0.5 - 0.5 * Math.cos(2 * ph));
    pY += bob; cY += bob;
    // the rotary gallop: gathered (hind under, spine flexed) then extended
    const flex = 0.17 * gal * Math.sin(ph + 0.6);
    pY += 0.05 * H * gal * Math.sin(ph - 1.6); cY += 0.05 * H * gal * Math.sin(ph + 0.3);
    pR += flex; cR -= flex * 0.6;
    pX += 0.06 * H * gal * Math.sin(ph + 0.6); cX -= 0.05 * H * gal * Math.sin(ph + 0.6);
    pY -= 0.06 * H * gal; cY -= 0.07 * H * gal;
    // the stalk crouch: belly low, shoulders working above the back line
    const cr = Math.max(st.crouch, st.aggr * 0.35, st.fear * 0.6);
    pY -= 0.15 * H * cr; cY -= 0.22 * H * cr; cR -= 0.04 * cr;
    pR += 0.1 * st.fear;
    // starts dip the chest and drive from the hips; stops sit back
    cY -= clamp(st.acc, -6, 6) * 0.006 * H; cR -= clamp(st.acc, -6, 6) * 0.01;
    // hurt and blown
    const lame = Math.max(st.inj[0], st.inj[1], st.inj[2], st.inj[3]);
    cY -= 0.03 * H * st.tired;
    // breathing
    const br = Math.sin(st.t * (1.6 + st.tired * 5)) * (0.004 + st.tired * 0.006) * H;
    cY += br;
    // flinch by location
    if (fk > 0) {
      if (F.loc === 1) { cY -= 0.09 * H * fk; cR -= 0.12 * fk; roll += 0.08 * F.side * fk; }
      else if (F.loc === 2) { pY -= 0.12 * H * fk; pR += 0.16 * fk; roll -= 0.08 * F.side * fk; }
      else if (F.loc === 3) { roll += 0.12 * F.side * fk; }
    }
    // lame: the body drops toward the bad leg while it is on the ground
    for (let i = 0; i < 4; i++) {
      if (st.inj[i] < 0.05) continue;
      const Ft = G.feet[i];
      const load = Ft.sw ? 0 : st.inj[i];
      const side = i % 2 === 0 ? -1 : 1;
      roll += side * 0.06 * load * moveK;
      if (i < 2) cY -= 0.03 * H * load * moveK; else pY -= 0.03 * H * load * moveK;
    }

    // ---- ACTIONS
    let neckP = 0, neckY = 0, headP = 0, jawA = 0, earBack = 0, lift = 0, tailUp = 0, lashK = 0;
    for (let i = 0; i < 4; i++) OV[i].w = 0;
    if (ak) {
      const s = st.aside >= 0 ? 1 : 0;      // which forepaw
      switch (ak) {
        case "swat": {
          const e = env(ap, 0, 0.35, 0.6, 1);
          cY += 0.16 * H * e * aw; cR += 0.28 * e * aw; pY -= 0.03 * H * e * aw;
          const L = s, o = OV[L];
          const k = ap < 0.35 ? ap / 0.35 : ap < 0.6 ? 1 : 1 - (ap - 0.6) / 0.4;
          const sweep = ap < 0.4 ? 0 : sstep(0.4, 0.62, ap);
          o.w = aw * Math.min(1, k * 1.5);
          o.x = cX + (0.38 + 0.25 * k) * H; o.y = cY + (0.05 - 0.45 * sweep) * H; o.z = (L === 0 ? -1 : 1) * (0.2 - 0.25 * sweep) * H;
          o.a = -0.4 + 0.8 * k; o.paw = -0.6;
          neckP -= 0.15 * e * aw; jawA += 0.35 * e * aw; earBack += e * aw; headP += 0.2 * e * aw;
          break;
        }
        case "bite": {
          const e = env(ap, 0, 0.4, 0.6, 1);
          cX += 0.12 * H * e * aw; cY -= 0.05 * H * e * aw;
          neckP -= 0.35 * e * aw; headP -= 0.1 * e * aw;
          jawA += (ap < 0.5 ? 0.6 * sstep(0, 0.4, ap) : 0.6 * (1 - sstep(0.5, 0.6, ap)) + 0.1) * aw;
          earBack += e * aw;
          break;
        }
        case "pounce": {
          // gather (0-.28), launch + flight (.28-.75), land + seize (.75-1)
          const gather = env(ap, 0, 0.2, 0.26, 0.34);
          const fl = ap > 0.28 && ap < 0.78 ? Math.sin(PI * (ap - 0.28) / 0.5) : 0;
          pY -= 0.2 * H * gather * aw; cY -= 0.24 * H * gather * aw;
          lift = 0.5 * H * fl * aw;
          pY += lift; cY += lift + 0.12 * H * fl * aw; cR += 0.22 * fl * aw; pR += 0.15 * fl * aw;
          for (let L = 0; L < 4; L++) {
            const o = OV[L], front = L < 2, z = (L % 2 === 0 ? -1 : 1) * (front ? D.legZf : D.legZh);
            if (fl > 0.02) {
              o.w = aw;
              if (front) { o.x = cX + 0.48 * H; o.y = cY - 0.42 * H; o.z = z * 1.3; o.a = -0.3; o.paw = -0.5; }
              else { o.x = pX - 0.42 * H; o.y = pY - 0.5 * H; o.z = z; o.a = -2.4; o.paw = -0.4; }
            }
          }
          neckP += (0.1 * fl - 0.25 * env(ap, 0.7, 0.8, 0.95, 1)) * aw;
          jawA += 0.65 * env(ap, 0.35, 0.6, 0.78, 0.86) * aw;
          earBack += aw; tailUp += 0.8 * fl * aw;
          break;
        }
        case "rear":
        case "mount": {
          const mount = ak === "mount";
          const e = mount ? 1 : env(ap, 0, 0.25, 0.8, 1);
          const up = mount ? 0.36 : 0.55;
          cY += up * H * e * aw; cR += (mount ? 0.5 : 0.85) * e * aw;
          pY -= 0.1 * H * e * aw; pR += 0.25 * e * aw;
          const swing = st.t * (mount ? 3 : 7);
          for (let L = 0; L < 2; L++) {
            const o = OV[L], sg = L === 0 ? -1 : 1, ph2 = swing + L * PI;
            o.w = aw * e;
            if (mount) { o.x = cX + 0.45 * H; o.y = cY - 0.15 * H + 0.05 * H * Math.sin(ph2); o.z = sg * 0.22 * H; o.a = -0.2; o.paw = -0.7; }
            else { o.x = cX + (0.34 + 0.12 * Math.sin(ph2)) * H; o.y = cY - (0.3 - 0.18 * Math.cos(ph2)) * H; o.z = sg * (0.18 - 0.1 * Math.sin(ph2)) * H; o.a = -0.5; o.paw = -0.7; }
          }
          neckP += (mount ? -0.7 : -0.25) * e * aw; headP -= 0.15 * e * aw;
          jawA += (mount ? 0.32 : 0.45 + 0.15 * Math.sin(st.t * 9)) * aw;
          earBack += aw;
          break;
        }
        case "hold": {
          // the throat / muzzle clamp: low, braced, jaws locked, still
          pY -= 0.07 * H * aw; cY -= 0.2 * H * aw; cX += 0.06 * H * aw;
          for (let L = 0; L < 2; L++) {
            const o = OV[L], sg = L === 0 ? -1 : 1;
            o.w = aw; o.x = cX + 0.3 * H; o.y = D.pawH; o.z = sg * 0.27 * H; o.a = -HALF + 0.75; o.paw = 0;
          }
          neckP -= 0.55 * aw; headP += 0.15 * aw; jawA += 0.22 * aw; earBack += aw; lashK += 0.6 * aw;
          break;
        }
        case "roar": {
          const e = env(ap, 0, 0.15, 0.85, 1);
          const pulse = 0.5 + 0.5 * Math.sin(ap * 30);
          neckP += 0.3 * e * aw; headP += 0.25 * e * aw; jawA += (0.45 + 0.3 * pulse) * e * aw;
          cY += 0.02 * H * pulse * e * aw; cX -= 0.03 * H * e * aw;
          break;
        }
        case "threat": {
          pY -= 0.1 * H * aw; cY -= 0.16 * H * aw;
          neckP -= 0.3 * aw; jawA += (0.25 + 0.12 * Math.sin(st.t * 3)) * aw; earBack += aw; lashK += aw;
          break;
        }
      }
    }
    // the snarl as a mood
    if (st.aggr > 0.05) { earBack = Math.max(earBack, st.aggr * 0.8); lashK = Math.max(lashK, st.aggr); jawA += 0.08 * st.aggr; }

    // ---- LIE (sphinx), blended over the standing body
    const Lb = D.shX - D.hipX;
    const lCY = 0.40 * H, lPY = 0.33 * H, lCX = D.shX + 0.03 * H;
    const lP = Math.atan2(lCY - lPY, Lb), lPX = lCX - Lb * Math.cos(lP);
    const wL = st.lie, wSt = 1 - wL;
    pX = pX * wSt + lPX * wL; pY = pY * wSt + lPY * wL;
    cX = cX * wSt + lCX * wL; cY = cY * wSt + lCY * wL;
    pR = pR * wSt + lP * wL; cR = cR * wSt + lP * wL;

    // ---- spine bend into turns
    const chestYaw = clamp(st.turn * 0.07, -0.2, 0.2) * (1 - wL) + (F.loc === 3 ? 0.15 * F.side * fk : 0);
    const pelvYaw = -chestYaw * 0.7;
    b[BN.pelvis].position.set(pX, pY, 0);
    b[BN.pelvis].rotation.set(-roll * 0.6, pelvYaw, pR);
    b[BN.chest].position.set(cX, cY, 0);
    b[BN.chest].rotation.set(roll, chestYaw, cR);

    // ---- LEGS
    for (let Lg = 0; Lg < 4; Lg++) {
      const front = Lg < 2, Ft = G.feet[Lg];
      let fx = Ft.lx, fy = Ft.ly + D.pawH, fz = Ft.lz;
      const su = Ft.sw ? Math.sin(PI * Ft.u) : 0;
      let fa = front ? (-HALF + 0.30 - 1.15 * su) : (-HALF + 0.15 - 0.6 * su);
      if (!front && !Ft.sw) fa += 0.3 * clamp((D.feet[Lg].x - Ft.lx) / (0.35 * H), -1, 1);   // the push-off
      if (front && !Ft.sw) fa -= 0.25 * clamp((Ft.lx - D.feet[Lg].x) / (0.4 * H), -1, 1);
      let paw = Ft.sw ? -0.65 * su : 0;
      // a lame leg barely loads: toe-touching
      if (st.inj[Lg] > 0.05 && !Ft.sw) fy += 0.045 * H * st.inj[Lg] * moveK;
      // lying: forelegs out in front, hind legs folded under
      if (wL > 0.001) {
        const z = (Lg % 2 === 0 ? -1 : 1) * (front ? D.legZf : D.legZh * 1.5);
        const lx = front ? lCX + 0.42 * H : lPX + 0.34 * H, la = front ? -0.15 : 0.05;
        fx = lerp(fx, lx, wL); fy = lerp(fy, D.pawH, wL); fz = lerp(fz, z, wL); fa = lerp(fa, la, wL); paw = lerp(paw, 0, wL);
      }
      const o = OV[Lg];
      if (o.w > 0.001) { fx = lerp(fx, o.x, o.w); fy = lerp(fy, o.y, o.w); fz = lerp(fz, o.z, o.w); fa = lerp(fa, o.a, o.w); paw = lerp(paw, o.paw, o.w); }
      if (front) legIK(rig, Lg, cX, cY, cR, chestYaw, fx, fy, fz, fa, paw);
      else legIK(rig, Lg, pX, pY, pR, pelvYaw, fx, fy, fz, fa, paw);
    }

    // ---- SCAPULAE: the withers ride up over the loaded foreleg, jut in the stalk
    const hk = bp[BN.hackle];
    b[BN.hackle].position.set(hk.x, hk.y + (0.022 * Math.abs(Math.sin(ph)) * (wlk + trt) + 0.05 * cr - 0.03 * wL) * H, 0);

    // ---- NECK / HEAD / JAW
    const tired = st.tired, lowHead = Math.max(tired * 0.6, lame * 0.5);
    neckP += -0.04 + st.alert * 0.12 - 0.24 * wlk - 0.12 * trt - 0.3 * gal - st.crouch * 0.4 - lowHead * 0.25
      + st.lookP * 0.6 - cR * 0.8 + 0.05 * wL + yawnE * 0.25;
    neckP += 0.045 * (wlk + trt) * Math.sin(2 * ph + 0.6);       // the walking nod
    if (fk > 0 && F.loc === 0) { neckY += 0.5 * F.side * fk; neckP += 0.25 * fk; }
    neckY += st.lookY * (1 - aw * 0.8) - chestYaw * 0.8 + st.turn * 0.05;
    b[BN.neck].rotation.set(0, neckY * 0.55, neckP * 0.55);
    b[BN.neck1].rotation.set(0, neckY * 0.45, neckP * 0.45);
    const headRoll = fk > 0 && F.loc === 0 ? 0.3 * F.side * fk : 0;
    b[BN.head].rotation.set(headRoll, st.lookY * 0.25 * (1 - aw), headP - neckP * 0.35 + st.lookP * 0.3);
    const pant = Math.max(tired, Math.min(1, av / 12) * 0.3) * (0.1 + 0.06 * Math.sin(st.t * 10));
    jawA += pant + yawnE * 0.8;
    b[BN.jaw].rotation.set(0, 0, -clamp(jawA, 0, 0.85));

    // ---- EARS: forward when alert, swivel, flick, pinned flat in a fight
    earBack = clamp(earBack + st.fear * 0.8, 0, 1);
    for (let e = 0; e < 2; e++) {
      const bone = b[e === 0 ? BN.earL : BN.earR], sg = e === 0 ? -1 : 1, fl = st.earF[e];
      bone.rotation.set(sg * (0.1 + 0.5 * earBack + 0.25 * fl), sg * (0.2 * (1 - st.alert) - 0.15 * st.lookY * sg) + 0.35 * fl * sg, 0.9 * earBack - 0.1 * st.alert + 0.2 * fl);
    }

    // ---- TAIL: hangs in a J at rest, swings in the walk, held out in the gallop, lashes in anger
    st.sway += dt * TAU * (G.mix.f || 0.8) * 0.5;
    st.lash += dt * (5 + 4 * lashK);
    const hang = (1.05 - 0.7 * gal - 0.4 * trt - 0.6 * tailUp + 0.25 * st.fear + 0.2 * lowHead) * (1 - wL) + 0.4 * wL;
    const sw = 0.18 * (wlk + trt) * Math.sin(st.sway), fl2 = st.flick;
    const lash = lashK * 0.45;
    b[BN.tail0].rotation.set(0, sw * 0.6 + lash * 0.3 * Math.sin(st.lash), hang);
    b[BN.tail1].rotation.set(0, sw * 0.6 + lash * 0.5 * Math.sin(st.lash - 0.6), 0.25 - 0.15 * gal);
    b[BN.tail2].rotation.set(0, sw * 0.4 + lash * 0.7 * Math.sin(st.lash - 1.2), 0.1);
    b[BN.tail3].rotation.set(0, sw * 0.3 + lash * 0.8 * Math.sin(st.lash - 1.8) + 0.5 * fl2 * Math.sin(st.t * 12), -0.25 - 0.3 * fl2 + 0.2 * gal);
    b[BN.tail4].rotation.set(0, lash * 0.9 * Math.sin(st.lash - 2.4) + 0.4 * fl2 * Math.sin(st.t * 12 - 1), -0.35 - 0.3 * fl2);
  }

  // =========================================================================
  //  THE CORPSE: the skin follows the solver's discovered points
  // =========================================================================
  const _q = { x: 0, y: 0, z: 0, w: 1 };
  function corpseHook(rig, renderer) {
    const fr = renderer && renderer.info && renderer.info.render ? renderer.info.render.frame : -2;
    if (fr === rig.frame) return;
    rig.frame = fr;
    const u = rig.unit;
    let dead = u ? !!u.dead : false;
    if (!u) {
      const q = rig.group.quaternion;
      const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
      const m0 = rig.mk[0].foot.position;
      dead = upY < 0.8 || Math.abs(m0.x - rig.mk[0].fx) > 0.02 || Math.abs(m0.y - rig.mk[0].fy) > 0.02;
    }
    if (!dead) return;
    const t = now(), dt = rig.st.lastT ? clamp(t - rig.st.lastT, 0, 0.1) : 0.016;
    rig.st.lastT = t;
    corpsePose(rig, dt);
    rig.bones[0].updateMatrixWorld(true);
    if (rig.skeleton) rig.skeleton.update();
  }
  function corpsePose(rig, dt) {
    const D = rig.D, H = D.H, b = rig.bones, BN = rig.table.BN, st = rig.st;
    st.deadK = Math.min(1, st.deadK + dt * 2.5);
    const k = st.deadK;
    b[BN.pelvis].position.set(D.hipX, D.hipH, 0); b[BN.pelvis].rotation.set(0, 0, 0);
    b[BN.chest].position.set(D.shX, D.sh, 0); b[BN.chest].rotation.set(0, 0, 0);
    let moved = false;
    for (let L = 0; L < 4; L++) {
      const mk = rig.mk[L], fp = mk.foot.position;
      if (Math.abs(fp.x - mk.fx) > 0.01 || Math.abs(fp.y - mk.fy) > 0.01 || Math.abs(fp.z - mk.fz) > 0.01) moved = true;
    }
    for (let L = 0; L < 4; L++) {
      const front = L < 2, mk = rig.mk[L], fp = mk.foot.position;
      const J = front ? D.FJ : D.HJ;
      // relaxed: the limp leg folds a little at every joint
      const rx = J.x + (front ? 0.12 : -0.05) * H, ry = J.y - (front ? 0.6 : 0.62) * H * (front ? 1 : 0.95);
      let fx = moved ? fp.x : lerp(mk.fx, rx, k), fy = moved ? fp.y : lerp(D.pawH, ry, k), fz = moved ? fp.z : mk.fz;
      const fa = front ? -HALF + 0.3 + 0.5 * k : -HALF + 0.15 + 0.35 * k;
      if (front) legIK(rig, L, D.shX, D.sh, 0, 0, fx, fy, fz, fa, -0.5 * k);
      else legIK(rig, L, D.hipX, D.hipH, 0, 0, fx, fy, fz, fa, -0.4 * k);
    }
    // the head lolls where the solver put it
    const h0 = rig.mkHead0, h1 = rig.mkHead.position, nb = D.neckB;
    let dp = 0, dy = 0;
    if (Math.abs(h1.x - h0.x) + Math.abs(h1.y - h0.y) + Math.abs(h1.z - h0.z) > 0.01) {
      dp = Math.atan2(h1.y - nb.y, h1.x - nb.x) - Math.atan2(h0.y - nb.y, h0.x - nb.x);
      dy = -Math.atan2(h1.z, h1.x - nb.x);
    } else dp = -0.45 * k;
    dp = clamp(dp, -1.3, 0.8); dy = clamp(dy, -1.0, 1.0);
    b[BN.neck].rotation.set(0, dy * 0.55, dp * 0.6);
    b[BN.neck1].rotation.set(0, dy * 0.45, dp * 0.4);
    b[BN.head].rotation.set(0, 0, -0.1 * k);
    b[BN.jaw].rotation.set(0, 0, -0.18 * k);
    b[BN.earL].rotation.set(-0.3 * k, 0, 0.5 * k); b[BN.earR].rotation.set(0.3 * k, 0, 0.5 * k);
    b[BN.tail0].rotation.set(0, 0, 0.5 + 0.3 * (1 - k)); b[BN.tail1].rotation.set(0, 0.2 * k, 0.15);
    b[BN.tail2].rotation.set(0, 0.2 * k, 0.05); b[BN.tail3].rotation.set(0, 0.15 * k, 0); b[BN.tail4].rotation.set(0, 0.1 * k, 0);
    void _q;
  }

  // =========================================================================
  //  THE BRAIN: one per lion, on its own row (m._lion)
  // =========================================================================
  const LIVE = [];
  function brainOf(m) {
    let L = m._lion;
    if (L) return L;
    const rig = m.group && m.group.userData && m.group.userData.lionRig;
    if (!rig) return null;
    const R = REAL[rig.sex];
    L = m._lion = {
      rig: rig, male: rig.male, R: R, sta: 1, lastHp: m.hp, hitT: 9, dmgEma: 0,
      f: "close", fT: 0, cd: 0.2, hitDone: false, p0: 0, circSide: (m.i & 1) ? 1 : -1, flanked: false,
      act: { kind: null, p: 0, side: 1 }, actAt: -9, fightAt: -9, kindTgt: null, kind: "man",
      inj: [0, 0, 0, 0], roarCd: 2 + ((m.i * 7) % 11), team0: 0, tick: 0,
    };
    rig.unit = m;
    // its own tuning row: speed, nerve and flight are this animal's, not the species'
    m.tn = Object.assign({}, m.tn);
    if (m.maxHp < 1e6) {
      m.maxHp = Math.round(m.maxHp * R.hpK); m.hp = Math.min(m.hp, m.maxHp); L.lastHp = m.hp;
    }
    const k = m._sizeMul || 1;
    m._mass = R.mass * k * k * k;
    m._jawL = { x: rig.D.mouth.x, y: rig.D.mouth.y, z: 0 };
    m._jawGripL = m._jawL;
    LIVE.push(m);
    // the team collar rides the neck (a box on a fixed spot does not follow a head)
    const THREE = W.THREE, g = m.group;
    for (let i = g.children.length - 1; i >= 0; i--) {
      const ch = g.children[i];
      if (!ch.isMesh || ch === rig.mesh || !(ch.userData && ch.userData.teamCollar)) continue;
      const D = rig.D, ms = rig.mane ? rig.mane.size : 0;
      const rad = (rig.male ? 0.175 : 0.15) * D.H * D.Gt;
      const key = "collar" + rad.toFixed(3);
      _mkGeo = _mkGeo || new Map();
      let tg = _mkGeo.get(key);
      if (!tg) { tg = new THREE.TorusGeometry(rad, 0.016 * D.H, 6, 24); tg._shared = true; _mkGeo.set(key, tg); }
      ch.geometry = tg;
      const dir = new THREE.Vector3(Math.cos(D.neckAng), Math.sin(D.neckAng), 0);
      ch.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      ch.position.copy(dir).multiplyScalar(D.neckLen * (rig.male ? 0.25 : 0.35));
      ch.scale.set(1, 1, 1);
      rig.bones[rig.table.BN.neck].add(ch);
      break;
    }
    return L;
  }
  function prideCount(team) {
    let all = 0, alive = 0;
    for (let i = LIVE.length - 1; i >= 0; i--) {
      const u = LIVE[i];
      if (u.team !== team) continue;
      all++; if (!u.dead && !u.fled) alive++;
    }
    return { all: all, alive: alive };
  }
  function massOf(t) {
    if (t._mass > 0) return t._mass;
    if (CBZ.bodyMass) { try { return CBZ.bodyMass(t); } catch (e) {} }
    return t.beast ? 150 : 78;
  }
  function kindOf(t) {
    if (t.vehicle) return "armour";
    const ms = massOf(t);
    if (!t.beast) return "man";
    if (ms > 350) return "big";
    if (ms < 60) return "small";
    return "cat";
  }
  function faceOf(t, out) {
    let h;
    if (t.vehicle) h = t.h != null ? t.h : (t.heading || 0);
    else if (t.beast) h = t.heading || 0;
    else { const y = t.yaw || 0; out.x = Math.sin(y); out.z = Math.cos(y); return out; }
    out.x = Math.cos(h); out.z = Math.sin(h); return out;
  }
  const _fo = { x: 0, z: 0 };

  // the slow layer: speed, stamina, nerve, wounds — on the unit's own tuning
  function brain(m, L, dt) {
    const rig = L.rig, st = rig.st, tn = m.tn, R = L.R;
    const vM = Math.abs(st.v);
    // STAMINA: a sprinter's tank, ~10 s of full speed
    if (vM > 7) L.sta -= dt * (vM - 5) / 95;
    else L.sta += dt * (vM < 3 ? 0.035 : 0.015);
    L.sta = clamp(L.sta, 0, 1);
    // WOUNDS: read off the hp the funnel took
    if (m.hp < L.lastHp) {
      let drop = L.lastHp - m.hp;
      const t = m.tgt;
      const close = t && !t.dead ? Math.hypot(t.pos.x - m.pos.x, t.pos.z - m.pos.z) : 1e9;
      // a male's mane soaks part of what teeth and claws do to his neck
      if (L.male && rig.mane && t && t.beast && close < 4.5 && m.hp > 0) {
        const back = drop * 0.3 * rig.mane.size;
        m.hp = Math.min(m.maxHp, m.hp + back); drop -= back;
      }
      L.hitT = 0;
      L.dmgEma += drop;
      // where it landed: toward whatever is in front of it, by exposure
      let loc = Math.random(), side = Math.random() < 0.5 ? -1 : 1;
      loc = loc < 0.18 ? 0 : loc < 0.5 ? 1 : loc < 0.75 ? 3 : 2;
      if (t && close < 4) { const rel = wrapPi(Math.atan2(t.pos.z - m.pos.z, t.pos.x - m.pos.x) - (m.heading || 0)); side = rel > 0 ? 1 : -1; if (Math.abs(rel) < 0.8) loc = Math.random() < 0.5 ? 0 : 1; }
      const kk = clamp(drop / (m.maxHp * 0.18), 0.25, 1);
      st.fl.t = 0.45; st.fl.k = kk; st.fl.loc = loc; st.fl.side = side;
      if (loc === 1 || loc === 2) {
        const leg = (loc === 1 ? 0 : 2) + (side < 0 ? 0 : 1);
        L.inj[leg] = Math.min(1, L.inj[leg] + drop / m.maxHp * 1.8);
      }
      // a hard blow breaks a hold
      if ((L.f === "hold" || L.f === "mount") && kk > 0.8) { L.f = "recover"; L.fT = 0; }
    }
    L.lastHp = m.hp;
    L.hitT += dt;
    L.dmgEma *= Math.exp(-dt / 3);
    // NERVE: a lioness quits at 30%, a male at 15%; a broken pride runs
    const hpF = m.maxHp > 0 ? m.hp / m.maxHp : 1;
    tn.brave = hpF >= R.quit;
    const pc = prideCount(m.team);
    if (pc.all >= 3 && pc.alive / pc.all < 0.34) tn.prey = true;
    // SPEED: earned by distance, stamina, wounds, and an acceleration
    const t = m.tgt;
    const d = t && !t.dead ? Math.hypot(t.pos.x - m.pos.x, t.pos.z - m.pos.z) : 1e9;
    const lame = Math.max(L.inj[0], L.inj[1], L.inj[2], L.inj[3]);
    let top = lerp(6.5, R.top, sstep(0.05, 0.4, L.sta)) * (1 - 0.5 * lame) * (hpF < 0.4 ? 0.8 : 1) * Math.pow(m._sizeMul || 1, 0.3);
    let want;
    L.stalk = false;
    if (m.state === "flee" || m.slot === "fallback") want = top;
    else if (t && t.vehicle) want = Math.min(top, 5);
    else if (d > 60) want = Math.min(top, 6.5);                    // the approach: a trot / canter
    else if (d > 25 && L.hitT > 5 && d < 60) {                       // the stalk, unless it is under fire
      const fo = faceOf(t, _fo);
      const looking = (fo.x * (m.pos.x - t.pos.x) + fo.z * (m.pos.z - t.pos.z)) / (d || 1) > 0.5;
      want = looking ? top : 3.2; L.stalk = !looking;
    } else want = top;                                              // the charge
    const accel = 9.5;
    tn.chase = Math.max(3, Math.min(want, vM + accel * Math.max(dt, 0.05) + 1.2));
    tn.march = Math.min(4.4, top);
  }

  // =========================================================================
  //  ANIMATE (the battle's per-frame hook)
  // =========================================================================
  function animate(m, dt) {
    const L = brainOf(m);
    if (!L) return;
    if (!(dt > 0)) dt = 0.016;
    brain(m, L, Math.min(dt, 0.25));
    const rig = L.rig, c = rig.ctl, tnow = now();
    c.x = m.pos.x; c.z = m.pos.z; c.y = m.pos.y;
    c.heading = typeof m.heading === "number" ? m.heading : 0;
    c.ground = CBZ.floorAt || null;
    const t = m.tgt, live = t && !t.dead;
    const d = live ? Math.hypot(t.pos.x - m.pos.x, t.pos.z - m.pos.z) : 1e9;
    c.alert = live ? 1 : 0.35;
    c.aggr = live && d < 12 ? 1 : (L.f === "threat" ? 1 : 0);
    c.fear = m.state === "flee" || m.slot === "fallback" ? 1 : 0;
    c.crouch = L.stalk ? 0.8 : 0;
    c.tired = clamp(1 - L.sta * 1.4, 0, 1);
    c.rest = !live && !m.hunt;
    c.inj = L.inj;
    c.lookAt = live && d < 40 ? t.pos : null;
    // the fight hook's act, while it is fresh
    const fresh = tnow - L.fightAt < 0.3;
    if (!fresh && L.f !== "close") { L.f = "close"; L.fT = 0; }
    c.act = fresh && L.act.kind ? L.act : null;
    // the male's roar: standing, an enemy in sight, nothing on top of him
    L.roarCd -= dt;
    if (!c.act && L.male && L.roarCd <= 0 && Math.abs(rig.st.v) < 0.8 && live && d > 20 && d < 150) {
      L.roarT = 2.4; L.roarCd = 25 + Math.random() * 20;
    }
    if (L.roarT > 0) {
      L.roarT -= dt;
      if (!c.act && Math.abs(rig.st.v) < 2.5) { L.act.kind = "roar"; L.act.p = 1 - L.roarT / 2.4; c.act = L.act; }
    }
    pose(rig, dt, c);
    if (CBZ.faceAnimalHeading) CBZ.faceAnimalHeading(m, c.heading);
  }

  // =========================================================================
  //  THE FIGHT (inside the strike bubble; step.js hands the body over)
  // =========================================================================
  const RES = { inRange: true, dealt: 0, missed: false };
  function go(L, f) { L.f = f; L.fT = 0; L.hitDone = false; L.hits = 0; }
  function strike(m, o, amt) {
    if (!(amt > 0)) return 0;
    if (o.onHit) o.onHit(amt);
    RES.dealt += amt;
    return amt;
  }
  function engagedMate(m, tgt, wantMount) {
    for (let i = 0; i < LIVE.length; i++) {
      const u = LIVE[i];
      if (u === m || u.dead || u.team !== m.team || u.tgt !== tgt || !u._lion) continue;
      const f = u._lion.f;
      if (wantMount ? f !== "mount" : (f === "close" || f === "circle" || f === "recover")) continue;
      if (Math.hypot(u.pos.x - tgt.pos.x, u.pos.z - tgt.pos.z) < 3.5) return u;
    }
    return null;
  }
  function slide(m, x, z, step, tgt, keep) {
    m.pos.x += x * step; m.pos.z += z * step;
    if (tgt) {
      const dx = m.pos.x - tgt.pos.x, dz = m.pos.z - tgt.pos.z, d = Math.hypot(dx, dz) || 1e-3;
      if (d < keep) { m.pos.x = tgt.pos.x + dx / d * keep; m.pos.z = tgt.pos.z + dz / d * keep; }
    }
    if (CBZ.micro && CBZ.micro.resolveCircle) CBZ.micro.resolveCircle(m.pos, m.rad || 0.8, m.pos.y, 1.8);
    if (CBZ.floorAt) { const y = CBZ.floorAt(m.pos.x, m.pos.z); if (isFinite(y)) m.pos.y = y; }
  }
  function fight(m, tgt, dt, o) {
    RES.inRange = true; RES.dealt = 0; RES.missed = false;
    const L = brainOf(m);
    if (!L) return CBZ.creatureFight ? CBZ.creatureFight(m, tgt, dt, o) : RES;
    if (!tgt || tgt.dead) { go(L, "close"); return RES; }
    L.fightAt = now();
    const dx = tgt.pos.x - m.pos.x, dz = tgt.pos.z - m.pos.z, d = Math.hypot(dx, dz) || 1e-3, ux = dx / d, uz = dz / d;
    const keep = Math.max((m.rad || 0.9) + (tgt.rad || 0.45), (m.noseR || 1.3) * 0.86);
    if (L.kindTgt !== tgt) { L.kindTgt = tgt; L.kind = kindOf(tgt); L.flanked = false; }
    const kind = L.kind;
    const R = L.R, rate = Math.max(0.3, o.rate || 1), dmg = (o.dmg || 60) * R.biteK;
    const move = function (step) { if (o.move) o.move(m, ux, uz, step); else slide(m, ux, uz, step, tgt, keep); };
    L.fT += dt; L.cd -= dt;
    // A PLAYER IS DRIVING (src/battle/player.js): the possessed driver latched
    // a move from moves() below; play exactly that one and hand back
    const Y = o.youMove || null;
    if (Y) {
      if (L.yMove !== Y || m._atkAnim === 0 && L.yAge > 0.05) {
        L.yMove = Y; L.yAge = 0;
        const map = { lion_pounce: "pounce", lion_swat: "swat", lion_bite: "bite", lion_throat: "hold", lion_rear: "rear", lion_mount: "mount" };
        go(L, map[Y.id] || (Y.style === "pounce" ? "pounce" : Y.style === "bite" ? "bite" : "swat"));
        L.p0 = d; L.flanked = true;
      }
      L.yAge += dt;
    } else L.yMove = null;
    let want = Math.atan2(dz, dx), turnRate = 7;
    const act = L.act;
    act.side = L.circSide;
    switch (L.f) {
      case "close": {
        act.kind = null;
        if (kind === "armour") { go(L, "threat"); break; }
        if (!L.flanked && kind !== "small" && d < keep + 3.4 && engagedMate(m, tgt, false)) { go(L, "circle"); break; }
        if (kind === "man" && L.cd <= 0 && d > keep + 1.1 && d < keep + 3.8 && !(tgt.ko > 0)) { L.p0 = d; go(L, "pounce"); break; }
        if (d > keep + 0.35) { move((o.speed || 8) * 0.7 * dt); break; }
        if (L.cd > 0) break;
        if (kind === "man") go(L, tgt.ko > 0 ? "hold" : (Math.random() < 0.55 ? "swat" : "bite"));
        else if (kind === "small") go(L, Math.random() < 0.6 ? "swat" : "bite");
        else if (kind === "cat") go(L, Math.random() < 0.5 ? "rear" : "bite");
        else {
          const fo = faceOf(tgt, _fo);
          const behind = -(fo.x * -ux + fo.z * -uz);   // > 0 when we are at its rear
          if (behind > 0.2) go(L, "mount");
          else if (engagedMate(m, tgt, true)) go(L, "hold");
          else if (!L.flanked) go(L, "circle");
          else go(L, "bite");
        }
        break;
      }
      case "circle": {
        // to the flank / rear of the prey, the side a pride-mate is not on
        const fo = faceOf(tgt, _fo);
        const desired = Math.atan2(-fo.z, -fo.x) + L.circSide * 0.7;
        const cur = Math.atan2(m.pos.z - tgt.pos.z, m.pos.x - tgt.pos.x);
        const da = wrapPi(desired - cur);
        if (Math.abs(da) < 0.35 || L.fT > 2.8) { L.flanked = true; go(L, "close"); L.cd = 0; break; }
        const rc = keep + 1.1, na = cur + clamp(da, -1, 1) * 0.5;
        const px = tgt.pos.x + Math.cos(na) * rc - m.pos.x, pz = tgt.pos.z + Math.sin(na) * rc - m.pos.z;
        const pl = Math.hypot(px, pz) || 1e-3;
        slide(m, px / pl, pz / pl, Math.min(pl, (o.speed || 8) * 0.75 * dt), tgt, keep);
        want = Math.atan2(pz, px); turnRate = 9;
        act.kind = null;
        break;
      }
      case "pounce": {
        // gather, launch, fly, seize
        const T = 0.95, p = L.fT / T;
        act.kind = "pounce"; act.p = Math.min(1, p);
        if (p > 0.28 && p < 0.62 && !Y) move(((L.p0 - keep + 0.25) / (0.34 * T)) * dt);
        if (p >= 0.62 && !L.hitDone) {
          L.hitDone = true;
          if (d < keep + 0.7) {
            strike(m, o, dmg * 0.4);
            if (!tgt.beast && !tgt.vehicle && massOf(tgt) < 160 && CBZ.verbs && CBZ.verbs.knockdown) {
              try { CBZ.verbs.knockdown(tgt, { dir: { x: ux, z: uz }, power: 1, dur: 2.5 }); } catch (e) {}
              if (!(tgt.ko > 0)) tgt.ko = 2.5;
            }
            if (CBZ.creatureBiteBlood) { try { CBZ.creatureBiteBlood(m, tgt, "pounce"); } catch (e) {} }
          } else RES.missed = true;
        }
        if (p >= 1) { if (L.hitDone && RES.missed === false && d < keep + 0.8) go(L, "hold"); else { go(L, "recover"); } }
        break;
      }
      case "swat": {
        const T = 0.5 / rate, p = L.fT / T;
        act.kind = "swat"; act.p = Math.min(1, p);
        if (p >= 0.5 && !L.hitDone) {
          L.hitDone = true;
          if (d < keep + 0.6) strike(m, o, dmg * (kind === "small" ? 0.8 : 0.5)); else RES.missed = true;
        }
        if (p >= 1) { L.circSide = -L.circSide; go(L, kind === "man" && Math.random() < 0.5 ? "bite" : "recover"); }
        break;
      }
      case "bite": {
        const T = 0.55 / rate, p = L.fT / T;
        act.kind = "bite"; act.p = Math.min(1, p);
        if (p > 0.2 && p < 0.45) move(0.6 * dt / T);
        if (p >= 0.5 && !L.hitDone) {
          L.hitDone = true;
          if (d < keep + 0.45) {
            strike(m, o, dmg);
            if (CBZ.creatureBiteBlood) { try { CBZ.creatureBiteBlood(m, tgt, "maul"); } catch (e) {} }
            if (CBZ.creatureBiteWound && tgt.char) { try { CBZ.creatureBiteWound(m, tgt, "maul", null, { kill: tgt.hp <= 0 }); } catch (e) {} }
          } else RES.missed = true;
        }
        if (p >= 1) {
          const down = tgt.ko > 0 || (tgt.maxHp && tgt.hp < tgt.maxHp * 0.5);
          go(L, (kind === "man" && down) || (kind === "big" && engagedMate(m, tgt, true)) ? "hold" : "recover");
        }
        break;
      }
      case "hold":
      case "mount": {
        // the clamp: suffocation at the throat, or the claws in the rump
        const mount = L.f === "mount";
        act.kind = mount ? "mount" : "hold"; act.p = 1;
        if (d > keep + 0.1) move(Math.min(d - keep, 4 * dt));
        if (!tgt.beast && !tgt.vehicle) tgt.ko = Math.max(tgt.ko || 0, 0.6);   // a man under a lion is not shooting
        L.tick = (L.tick || 0) + dt;
        if (L.tick >= 0.5) {
          L.tick -= 0.5;
          if (d < keep + 0.8) strike(m, o, dmg * (mount ? 0.2 : 0.3) * Math.sqrt(rate));
          else { go(L, "close"); break; }
        }
        if (L.fT > (Y ? 1.4 : mount ? 10 : 8)) go(L, "recover");
        break;
      }
      case "rear": {
        const T = 1.2 / rate, p = L.fT / T;
        act.kind = "rear"; act.p = Math.min(1, p);
        if ((p >= 0.35 && L.hits === 0) || (p >= 0.75 && L.hits === 1)) {
          L.hits++;
          if (d < keep + 0.7) strike(m, o, dmg * 0.4); else RES.missed = true;
        }
        if (p >= 1) go(L, Math.random() < 0.5 ? "bite" : "recover");
        break;
      }
      case "threat": {
        // teeth on plate: hold off, snarl, mock charge, never commit
        act.kind = "threat"; act.p = 0;
        const hold = keep + 2.5;
        L.mc = (L.mc || 0) + dt;
        if (L.mc > 3.2) {
          const e = L.mc - 3.2;
          if (e < 0.35) move(5 * dt); else if (e < 0.9) slide(m, -ux, -uz, 3 * dt, tgt, keep);
          else L.mc = 0;
        } else if (d < hold) slide(m, -ux, -uz, 2.2 * dt, tgt, keep);
        if (kind !== "armour") go(L, "close");
        break;
      }
      case "recover": {
        act.kind = null;
        const T = 0.4 / rate;
        if (L.fT < T * 0.7 && d < keep + 0.6) slide(m, -ux, -uz, 1.2 * dt, tgt, keep);
        if (L.fT >= T) { go(L, "close"); L.cd = 0.3 / rate; }
        break;
      }
      default: go(L, "close");
    }
    if (Y) {
      // the driver ends the strike when _atkAnim goes negative
      const busy = L.f !== "close" && L.f !== "recover" && L.f !== "circle" && L.f !== "threat";
      if (!busy || L.yAge > 2.5) { m._atkAnim = -1; L.yMove = null; if (L.f !== "close") go(L, "close"); L.cd = 0; }
      else m._atkAnim = Math.min(0.99, 0.01 + L.yAge / 1.5);
    }
    // face the work
    let dh = wrapPi(want - (m.heading || 0));
    m.heading = (m.heading || 0) + clamp(dh, -turnRate * dt, turnRate * dt);
    m.faceH = m.heading;
    if (CBZ.faceAnimalHeading) CBZ.faceAnimalHeading(m, m.heading);
    RES.inRange = d < keep + 1;
    return RES;
  }

  // WHAT A POSSESSED LION THROWS ON ATTACK (src/units/kit/moves.js contract)
  const YM = {
    lion_pounce: { id: "lion_pounce", style: "pounce", pow: 1, dur: 0.95, rng: 1.1, leap: 1, cd: 0.9 },
    lion_swat: { id: "lion_swat", style: "maul", pow: 1, dur: 0.5, rng: 1.0, cd: 0.35 },
    lion_bite: { id: "lion_bite", style: "bite", pow: 1, dur: 0.55, rng: 1.0, cd: 0.45 },
    lion_throat: { id: "lion_throat", style: "maul", pow: 1, dur: 1.4, rng: 1.05, cd: 0.6 },
    lion_rear: { id: "lion_rear", style: "maul", pow: 1, dur: 1.2, rng: 1.05, cd: 0.6 },
    lion_mount: { id: "lion_mount", style: "maul", pow: 1, dur: 1.4, rng: 1.05, cd: 0.6 },
  };
  function moves(m, tgt, ctx) {
    ctx = ctx || {};
    const dist = ctx.dist == null ? 99 : ctx.dist, reach = ctx.reach || 2.5, n = ctx.n || 1;
    const running = !!ctx.sprint || (ctx.chase > 0 && ctx.speed > ctx.chase * 0.5);
    if (!tgt) return YM.lion_swat;
    if (dist > reach * 1.05 && dist < reach * 2.8 && running) return YM.lion_pounce;
    if (ctx.downed) return YM.lion_throat;
    const kind = kindOf(tgt);
    if (kind === "big") {
      const fo = faceOf(tgt, _fo), dx = m.pos.x - tgt.pos.x, dz = m.pos.z - tgt.pos.z, dl = Math.hypot(dx, dz) || 1;
      return (fo.x * dx + fo.z * dz) / dl < -0.2 ? YM.lion_mount : YM.lion_bite;
    }
    if (kind === "cat") return n % 2 === 0 ? YM.lion_bite : YM.lion_rear;
    return n % 3 === 0 ? YM.lion_bite : YM.lion_swat;
  }

  // a posed frame for tools (shot service): CBZ.lionKit.preview(unit, "pounce", 0.5)
  const _pv = { kind: null, p: 0, side: 1 };
  function preview(m, kind, p, dt) {
    const L = brainOf(m);
    if (!L) return false;
    const rig = L.rig, c = rig.ctl;
    c.x = m.pos.x; c.z = m.pos.z; c.y = m.pos.y; c.heading = m.heading || 0; c.ground = CBZ.floorAt || null;
    c.alert = 1; c.aggr = kind ? 0.6 : 0; c.act = null;
    if (kind) { _pv.kind = kind; _pv.p = p; c.act = _pv; }
    for (let i = 0; i < 12; i++) pose(rig, dt || 1 / 60, c);
    return true;
  }

  CBZ.lionKit = { STATS: STATS, REAL: REAL, dims: dims, build: build, animate: animate, fight: fight, moves: moves, preview: preview, pose: pose, LIVE: LIVE };
  if (CBZ.unitKit) {
    CBZ.unitKit.register("lion", {
      kind: "species", stats: STATS,
      build: function (ctx) { return build(ctx, "tawny"); },
      animate: animate, fight: fight, moves: moves,
    });
  }
  if (typeof module !== "undefined" && module.exports) module.exports = { dims: dims, STATS: STATS };
})();
