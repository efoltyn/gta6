/* ============================================================
   units/species/horse.js — THE HORSE (Equus caballus), as NPC War fights it,
   and the cavalry mount a soldier rides.

   OWNED BY: the horse agent. One file, the whole animal: its numbers, its
   body, how it moves, how it fights, how it panics, and how a man rides it.

   WHAT WAS HERE: the bestiary's box horse (city/wildlife/farm.js: ~15
   axis-aligned boxes on four posts) walked by the discovered box rig and
   fought by creature_combat's generic STOMP, flagged `prey` so it ran from
   everything forever and could never leave the field.

   THE BODY (reference: a 15.2-16 hh riding horse, Thoroughbred / Quarter
   Horse cross: withers 1.56-1.62 m, 470-540 kg, body length ~ withers height,
   chest depth ~0.75 m, head ~0.60 m, neck ~0.75 m on the crest)
     ONE SkinnedMesh per horse on a geometry SHARED per sex (stallion / mare /
     gelding: the position, normal, skin attributes are one set of buffers);
     each coat variant only adds its own colour attribute. 34 bones: the kit's
     quadruped table (3 neck, 5 tail, ears, withers ridge) + a PASTERN bone per
     leg, so the leg is the real four-segment equine limb: humerus / forearm /
     cannon / pastern+hoof in front (elbow behind, knee = carpus) and femur /
     gaskin / cannon / pastern+hoof behind (stifle forward, hock behind).
     Lofted barrel with a deep girth, high withers, dipped back, round croup;
     a laterally flat arched neck (a stallion's crest is thicker); the long
     head with broad flat forehead, big round jowls, eyes set to the side, a
     tapering face, a soft muzzle with real nostrils and a hinged lower lip;
     leaf-shaped mobile ears; mane on the crest falling to the right, a
     forelock, a long hair tail; forearm / gaskin / thigh muscle volumes,
     bony knees and hocks with the point of hock, flat cannons with tendons
     behind, fetlock knobs, sloped pasterns and keratin hooves.
     COATS (vertex colours, authored as a photo shows them, linearised):
     bay, dark bay, chestnut, black, dapple grey, palomino, buckskin, with
     black points where the colour has them; face markings (star, strip,
     blaze, snip) and white socks/stockings with pale hooves under them.
     Per individual: sex (herd mix), coat, markings, wildlife_traits' size.

   THE MOVEMENT. CBZ.quadGait with a real HORSE footfall table:
     walk    4-beat lateral sequence LH LF RH RF, duty 0.62, ~1 Hz, head nods
     trot    2-beat diagonal pairs with suspension, duty 0.42, ~1.4 Hz, bounce
     canter  3-beat (right lead: LH, RH+LF, RF, suspension), duty 0.36, rocks
     gallop  4-beat transverse (LH RH LF RF, suspension), duty 0.27, ~2.3 Hz
   Every hoof plants and cannot slide; legs are IK'd with abduction; knees and
   hocks fold in the swing (deep in the trot and gallop), pasterns flip.
   Turns bend the neck and the barrel and lean the body; starts sit the
   haunches down; stops brace. Idle: grazing (muzzle to the ground), a hind
   leg cocked at rest, tail swishes, ear flicks, head tosses, fly stomps;
   alert: head high, ears pricked at the threat, snort; fear: head up, tail
   clamped, the bolt. Hit reactions by location (head throw, forehand
   buckle, hindquarter drop, flank shudder); lameness gives the real head
   nod / hip hike and a shortened, toe-touching stride; death hands the
   body to systems/quadruped_ragdoll.js through invisible markers, and the
   skin follows the solved points.

   THE FIGHT (fight hook; the strike bubble is step.js's)
     the double-barrel hind kick (weight onto the forehand, hindquarters up,
     both hind hooves out ~1.2 m behind): the horse's real weapon; a horse
     caught from behind kicks, one engaged from the side SPINS to present its
     hindquarters; the cow kick sideways when something is at its flank; the
     stallion rears and strikes with the forefeet and bites; trampling of a
     body on the floor (a charging or fighting horse; a calm horse steps
     around people); a ridden horse at speed bowls men over (the charge).
     Force from mass and speed: a kick puts ~8-10 kN through a hoof, which is
     a broken jaw on a lion and an often-fatal blow on a man (knocked down,
     thrown back); a 500 kg horse at 12 m/s hitting a man is ~70 hp.
   THE NERVE (a prey animal's, not a fighter's): a loose horse watches a
   threat at distance (head up, ears on it), walks off from a man, bolts from
   a predator, from vehicles and from gunfire (m.supp, hits) and runs as a
   herd; a horse that is CAUGHT fights back (kick, strike, bite) and breaks
   away again; a stallion confronts dogs, wolves and coyotes. A horse that
   has bolted far off the field is out of the war (m.fled).

   THE RIDER (cavalry). Put men and horses on one side ("horse*20,men*20"):
   each loose horse claims the nearest unmounted man of its side, walks to
   him, he swings up (char.riding pose on the saddle, the saddle and a pad in
   the side's colour appear) and he is out of the infantry sim while seated
   (exactly as a vehicle's crew is). An ARMED rider is mounted infantry: he
   rides at the canter, dismounts ~100 m out (or under fire) and fights on
   foot while the horse is led back. A rider with FISTS is shock cavalry: the
   horse gallops into the enemy, bowls men over and passes through, the
   rider strikes from the saddle, then it wheels and charges again. A
   mounted man is hit too (a share of what strikes the horse), a horse
   killed under him throws him, and a horse panicking under fire bolts with
   him. CBZ.horseKit.mount(horse, man) / dismount(horse) for the player seam.

   STATS (one truth: written back onto the bestiary row; per body by sex)
     mass 540 / 470 / 500 kg, top speed 15.5 / 15 m/s loose (13.5 ridden),
     ~6 m/s^2 acceleration, ~2 min of full gallop then a canter, hp 360
     (stallion x1.08, mare x0.95), hide 5 mm (ballistics), kick 85 to a man.

   HOST SEAM: riding needs the battle's own crew helpers (the same ones
   vehicles.js uses for a crewman): __battle.roster(), squads, vehPutOnField,
   hurtMan. All feature-detected in SEAM below; on a host without them
   (Gang City today) horses are simply loose horses.
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
  function frac(x) { return x - Math.floor(x); }
  function env(p, a, b, c, d) { return p < a || p > d ? 0 : p < b ? sstep(a, b, p) : p < c ? 1 : 1 - sstep(c, d, p); }
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
  function nz(x, y, z) {
    return 0.5 * Math.sin(x * 11.3 + y * 3.1 + 1.7) * Math.sin(z * 9.7 - y * 5.3 + 0.4) +
      0.3 * Math.sin(x * 23.9 - z * 17.1 + y * 7.7) + 0.2 * Math.sin(y * 31.0 + x * 13.3 - z * 29.0);
  }
  const _lin = new Map();
  function lin(hex) {
    let v = _lin.get(hex);
    if (v === undefined) {
      const f = function (c) { c /= 255; return Math.round(255 * (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))); };
      v = (f((hex >> 16) & 255) << 16) | (f((hex >> 8) & 255) << 8) | f(hex & 255);
      if (_lin.size < 60000) _lin.set(hex, v);
    }
    return v;
  }
  function now() { return (typeof performance !== "undefined" ? performance.now() : Date.now()) * 0.001; }

  // =========================================================================
  //  THE NUMBERS
  // =========================================================================
  const STATS = {
    hp: 360, spd: 1.7, danger: 0.25, bite: 18, scale: 1,
    chase: 15, march: 1.7, dmg: 85, rate: 0.9,
    brave: false, prey: true,
    mass: 500, hide: 5, skull: 25, ribs: 14,
  };
  const REAL = {
    stallion: { mass: 540, top: 15.5, hpK: 1.08, kickK: 1.1, quit: 0.25, withers: 1.62 },
    mare: { mass: 470, top: 15.0, hpK: 0.95, kickK: 0.95, quit: 0.1, withers: 1.56 },
    gelding: { mass: 500, top: 15.5, hpK: 1.0, kickK: 1.0, quit: 0.1, withers: 1.60 },
  };
  const RIDDEN_TOP = 13.5, ACCEL = 6.0, CANTER = 6.5, TROT = 4.0, WALK = 1.7;

  // =========================================================================
  //  COATS (sRGB as a photograph shows them)
  // =========================================================================
  const COATS = [
    { id: "bay", w: 32, body: 0x8a4a26, back: 0x683418, belly: 0x9c5c34, points: 0x17120f, mane: 0x15110e, tail: 0x15110e, muzzle: 0x2c221d, hoof: 0x2e2823 },
    { id: "dark_bay", w: 15, body: 0x4e2b18, back: 0x3a1f11, belly: 0x5e3822, points: 0x14100d, mane: 0x120e0c, tail: 0x120e0c, muzzle: 0x2a201b, hoof: 0x2b2520 },
    { id: "chestnut", w: 20, body: 0xa0582b, back: 0x86461f, belly: 0xb06a3a, points: null, mane: 0x8a4520, tail: 0x7c3e1c, muzzle: 0x5a3e32, hoof: 0x4a3e33 },
    { id: "black", w: 8, body: 0x231d1a, back: 0x1b1715, belly: 0x2c2521, points: 0x141110, mane: 0x110f0e, tail: 0x110f0e, muzzle: 0x221c19, hoof: 0x24201d },
    { id: "grey", w: 12, body: 0xaeaea8, back: 0x96968f, belly: 0xc4c3bc, points: 0x6a6965, mane: 0xd6d4cc, tail: 0xcfcdc4, muzzle: 0x3a3634, hoof: 0x3a3530, dapple: 0x84847e },
    { id: "palomino", w: 6, body: 0xd2a35e, back: 0xc0904a, belly: 0xdfba7a, points: null, mane: 0xf0e4c8, tail: 0xebdcbc, muzzle: 0x6a5244, hoof: 0x5a4a3a },
    { id: "buckskin", w: 7, body: 0xc69a60, back: 0xb0844c, belly: 0xd6af78, points: 0x1a1512, mane: 0x16120f, tail: 0x16120f, muzzle: 0x2e2420, hoof: 0x2e2823 },
  ];
  const WHITE = 0xf1eee6, PINK = 0xc7a094, PALE_HOOF = 0x9a8a70, LEATHER = 0x3b2415, BIT = 0x9a9a98;
  const FACES = ["none", "star", "strip", "blaze", "snip"];
  const LEGSETS = [[0, 0, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1], [0, 0, 1, 1], [1, 0, 0, 1], [1, 1, 1, 1], [0, 1, 1, 0]];
  function pickCoat(r) {
    let tot = 0; for (let i = 0; i < COATS.length; i++) tot += COATS[i].w;
    let x = r() * tot;
    for (let i = 0; i < COATS.length; i++) { x -= COATS[i].w; if (x <= 0) return i; }
    return 0;
  }

  // =========================================================================
  //  DIMENSIONS (model space: nose +X, up +Y, ground 0, left = -Z)
  // =========================================================================
  const _dims = {};
  function dims(sex) {
    if (_dims[sex]) return _dims[sex];
    const R = REAL[sex] || REAL.gelding;
    const H = R.withers / 1.60;
    const Gt = sex === "stallion" ? 1.04 : sex === "mare" ? 0.97 : 1.0;
    const Hs = sex === "stallion" ? 1.03 : sex === "mare" ? 0.98 : 1.0;
    const D = { sex: sex, H: H, Gt: Gt, Hs: Hs, stallion: sex === "stallion" };
    D.withers = R.withers;
    D.K = R.withers / 0.62;
    D.hipX = -0.50 * H; D.hipH = 1.36 * H;          // the pelvis bone (sacrum)
    D.shX = 0.46 * H; D.sh = 1.28 * H;              // the chest bone (thorax)
    D.FJ = { x: 0.72 * H, y: 1.10 * H };            // shoulder joint (point of shoulder)
    D.HJ = { x: -0.58 * H, y: 1.26 * H };           // hip joint
    D.fa = 0.30 * H; D.fb = 0.40 * H; D.fc = 0.27 * H;   // humerus, forearm, cannon
    D.ha = 0.42 * H; D.hb = 0.48 * H; D.hc = 0.33 * H;   // femur, gaskin, cannon
    // the hoof's ground centre seen from the fetlock (bind: the pastern hangs at its own slope)
    D.po = [{ x: 0.055 * H, y: -0.205 * H }, { x: 0.05 * H, y: -0.215 * H }];
    D.pawH = 0;
    D.legZf = 0.135 * H * Math.sqrt(Gt); D.legZh = 0.15 * H * Math.sqrt(Gt);
    D.neckB = { x: 0.70 * H, y: 1.40 * H };
    D.neckAng = 0.92; D.neckLen = 0.73 * H;
    D.headP = { x: D.neckB.x + Math.cos(D.neckAng) * D.neckLen, y: D.neckB.y + Math.sin(D.neckAng) * D.neckLen };
    D.headAng = -0.95;
    D.u = { x: Math.cos(D.headAng), y: Math.sin(D.headAng) };
    D.n = { x: -D.u.y, y: D.u.x };
    D.hp = function (d, h) { return { x: D.headP.x + (D.u.x * d + D.n.x * h) * Hs, y: D.headP.y + (D.u.y * d + D.n.y * h) * Hs }; };
    D.jawP = D.hp(0.10, -0.10);
    D.earP = Object.assign(D.hp(-0.015, 0.075), { z: 0.05 * Hs });
    D.eyeP = Object.assign(D.hp(0.20, 0.02), { z: 0.079 * Hs });
    D.mouth = D.hp(0.58, -0.06);
    D.tailP = { x: -0.84 * H, y: 1.50 * H }; D.tailL = 1.05 * H;
    D.hackleP = { x: 0.50 * H, y: 1.56 * H };
    D.legLen = 1.45 * H;
    D.feet = [
      { x: 0.60 * H, z: -D.legZf, front: true },
      { x: 0.60 * H, z: D.legZf, front: true },
      { x: -0.59 * H, z: -D.legZh, front: false },
      { x: -0.59 * H, z: D.legZh, front: false },
    ];
    D.seat = { x: 0.16 * H, y: 1.585 * H };
    D.scap = { x: 0.50 * H, y: 1.50 * H };           // the shoulder blade's upper end (its swing pivot)          // the rider's seat bone on the saddle
    return (_dims[sex] = D);
  }

  // =========================================================================
  //  THE SKELETON: the kit's table + a pastern bone per leg
  // =========================================================================
  let _table = null;
  function table() {
    if (_table) return _table;
    const QR = CBZ.quadRig;
    const T = QR.bones({ neck: 3, tail: 5, tailStops: [0, 0.12, 0.3, 0.55, 0.8], ears: true, hackle: true, hump: false });
    const PARENT = T.PARENT.slice();
    let n = T.NB;
    const PAST = [];
    for (let L = 0; L < 4; L++) { PAST.push(n++); PARENT.push(T.LEGB[L][2]); }
    function bindPoints(D) {
      const P = T.bindPoints(D);
      for (let L = 0; L < 4; L++) {
        const f = P[T.LEGB[L][2]], c = L < 2 ? D.fc : D.hc;
        P.push([f[0], f[1] - c, f[2]]);
      }
      return P;
    }
    _table = { BN: T.BN, LEGB: T.LEGB, PAST: PAST, PARENT: PARENT, NB: n, spec: T.spec, bindPoints: bindPoints };
    return _table;
  }

  // =========================================================================
  //  THE FOOTFALL TABLE (real horse gaits; the kit's HORSE canter had a
  //  lateral pair where the canter has a DIAGONAL one)
  // =========================================================================
  let _gait = null;
  function gaitTable() {
    if (_gait) return _gait;
    _gait = Object.assign({}, CBZ.quadGait.TABLES.HORSE, {
      // feet order FL FR HL HR
      gaits: [
        { name: "walk", key: "wW", off: [0.25, 0.75, 0.00, 0.50], duty: 0.62, lift: 0.045 },    // LH LF RH RF
        { name: "trot", key: "wT", off: [0.25, 0.75, -0.25, 0.25], duty: 0.40, lift: 0.06 },    // LF+RH, RF+LH
        { name: "canter", key: "wC", off: [0.20, 0.40, 0.00, 0.20], duty: 0.34, lift: 0.065 },  // LH, RH+LF, RF (right lead)
        { name: "gallop", key: "wG", off: [0.32, 0.42, 0.00, 0.10], duty: 0.26, lift: 0.07 },   // LH RH LF RF
      ],
      // m/s / sqrt(K): walk->trot ~2.1, trot->canter ~5, canter->gallop ~8
      trans: [[1.25, 1.5], [2.95, 3.4], [4.6, 5.3]],
      fMax: 3.7, f0: 1.15, fV: 0.8, strideMax: 1.0,
      vMove: 0.1, turnMove: 0.35, turnF: 1.2,
      settleRate: 2.0, restLift: 0.03, restStep: 0.05,
    });
    return _gait;
  }

  // =========================================================================
  //  COLOUR
  // =========================================================================
  function colourer(D, coatIdx, face, legs, tack) {
    const P = COATS[coatIdx], H = D.H, Hs = D.Hs;
    const hpX = D.headP.x, hpY = D.headP.y, ux = D.u.x, uy = D.u.y, nx = D.n.x, ny = D.n.y;
    const isGrey = P.id === "grey";
    function grain(c, x, y, z, amt) { return cmul(c, 1 + nz(x / H, y / H, z / H) * amt); }
    function dapple(c, x, y, z) {
      if (!isGrey) return c;
      const s = Math.sin(x * 19 + Math.sin(z * 7) * 2) * Math.sin(y * 17 + 1.3) * Math.sin(z * 21 + x * 3);
      const net = sstep(0.05, 0.35, Math.abs(s));
      return cmix(P.dapple, c, net);
    }
    function body(x, y, z, ca) {
      let c = cmix(P.body, P.back, sstep(0.45, 0.95, ca) * 0.6);
      if (ca < -0.4) c = cmix(c, P.belly, sstep(-0.4, -0.85, ca));
      c = dapple(c, x, y, z);
      return grain(c, x, y, z, 0.045);
    }
    return function (part, x, y, z, ca, sa, R, t, ex) {
      switch (part) {
        case "torso": return body(x, y, z, ca);
        case "neck": return body(x, y, z, ca * 0.8);
        case "head": {
          const dx = x - hpX, dy = y - hpY;
          const d = (dx * ux + dy * uy) / Hs, h = (dx * nx + dy * ny) / Hs, az = Math.abs(z) / Hs;
          // nostrils: the big comma on each side of the muzzle front
          if (d > 0.52 && d < 0.61 && az > 0.026 && az < 0.064) {
            const q = Math.pow((d - 0.565) / 0.034, 2) + Math.pow((h - 0.018) / 0.022, 2);
            if (q < 1) return 0x0f0c0b;
          }
          let c = body(x, y, z, 0.2);
          // the face marking
          let white = 0;
          if (face === "star" && d > 0.08 && d < 0.17 && h > 0.03 && az < 0.032) white = 1;
          if (face === "strip" && d > 0.1 && d < 0.47 && h > 0.02 && az < 0.02 + (d - 0.1) * 0.02) white = 1;
          if (face === "blaze" && d > 0.06 && h > -0.01 && az < 0.032 + (d - 0.06) * 0.05) white = 1;
          if (face === "snip" && d > 0.47 && d < 0.6 && h > 0.0 && az < 0.022) white = 1;
          // the muzzle: soft, dark (pink skin where a white marking reaches it)
          const mz = sstep(0.44, 0.53, d);
          if (white) c = d > 0.47 ? cmix(WHITE, PINK, mz) : WHITE;
          else c = cmix(c, P.muzzle, mz * 0.9);
          // the eye socket a shade darker, the jowl a shade lighter
          if (d > 0.13 && d < 0.27 && h > -0.03 && h < 0.07 && az > 0.06 && !white) c = cmul(c, 0.85);
          // ear rims on the points colours
          if (tack) {
            if (Math.abs(d - 0.37) < 0.018) return LEATHER;                                   // noseband
            if (az > 0.055 && Math.abs(h - lerp(-0.01, 0.05, sstep(0.37, 0.0, d))) < 0.014 && d > -0.02 && d < 0.37) return LEATHER;  // cheekpiece
            if (Math.abs(d - 0.04) < 0.013 && h > 0.0) return LEATHER;                        // browband
            if (Math.abs(d - 0.0) < 0.015 && h < -0.05) return LEATHER;                       // throatlatch
            if (d > 0.5 && d < 0.56 && h < -0.03 && az > 0.045) return BIT;                     // the bit ring
          }
          return c;
        }
        case "lip": {
          // lower lip / chin: muzzle colour, the mouth line dark
          if (ca > 0.55) return 0x1d1513;
          const pink = face === "blaze" || face === "snip";
          return grain(pink ? PINK : P.muzzle, x, y, z, 0.05);
        }
        case "mouth": return 0x3a1e1c;
        case "eye": return ex;
        case "ear": {
          const pts = P.points != null ? P.points : cmul(P.body, 0.7);
          if (t > 0.78) return pts;                                   // dark ear tips
          if (ca < -0.35) return cmix(0x2a2422, cmul(P.body, 0.75), 0.4); // the hairy inside of the cup
          return Math.abs(sa) > 0.85 ? cmix(P.body, pts, 0.5) : body(x, y, z, 0.3);
        }
        case "mane": case "forelock": {
          const ang = Math.atan2(sa, ca);
          const streak = 0.5 * Math.sin(ang * 13 + t * 9) + 0.5 * Math.sin(ang * 31 - t * 5 + x * 9);
          return cmul(P.mane, 1 + streak * 0.14 + nz(x, y, z) * 0.05);
        }
        case "tail": {
          if (t < 0.14 && ca > -0.2) return body(x, y, z, 0.6);        // the dock's coat on top
          const ang = Math.atan2(sa, ca);
          const streak = 0.5 * Math.sin(ang * 11 + t * 6) + 0.5 * Math.sin(ang * 27 + t * 17);
          return cmul(P.tail, 1 + streak * 0.15 + nz(x, y, z) * 0.06);
        }
        case "leg": {
          // ex = { knee: bind y of knee/hock, fet: bind y of the fetlock, L }
          let c = body(x, y, z, ca * 0.5);
          const inner = sa * (z < 0 ? 1 : -1);
          if (inner > 0.4) c = cmix(c, P.belly, 0.35);
          if (P.points != null) c = cmix(c, P.points, sstep(ex.knee + 0.16 * H, ex.knee - 0.02 * H, y));
          else if (isGrey) c = cmix(c, P.points, sstep(ex.knee + 0.1 * H, ex.fet, y) * 0.7);
          const sock = legs[ex.L];
          if (sock) {
            const top = sock === 2 ? (ex.knee + ex.fet) * 0.5 : ex.fet + 0.05 * H;
            const edge = top + 0.012 * Math.sin(Math.atan2(sa, ca) * 5 + ex.L);
            if (y < edge) c = WHITE;
          }
          return c;
        }
        case "hoof": {
          if (t > 0.85) return 0x1e1a17;
          const pale = legs[ex.L];
          const base = pale ? PALE_HOOF : P.hoof;
          const str = Math.sin(Math.atan2(sa, ca) * 22) * 0.06;
          return cmul(t < 0.18 ? cmix(base, 0x000000, 0.3) : base, 1 + str);
        }
      }
      return P.body;
    };
  }

  // =========================================================================
  //  GEOMETRY
  // =========================================================================
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

  // the neck's centreline, radii at t in 0..1 (shared by the neck and the mane)
  function neckAt(D, t) {
    const nb = D.neckB, hp = D.headP, g = D.H * D.Gt, cr = D.stallion ? 1.15 : D.sex === "mare" ? 0.94 : 1;
    // the crest arches: the axis bows up-forward in the middle
    const bow = Math.sin(PI * t) * 0.035 * D.H;
    const ax = lerp(nb.x, hp.x, t), ay = lerp(nb.y, hp.y, t);
    const ux = -Math.sin(D.neckAng), uy = Math.cos(D.neckAng);     // toward the crest
    const rt = lerp(0.25, 0.12, Math.pow(t, 0.8)) * g * (t > 0.15 && t < 0.85 ? cr : lerp(1, cr, Math.min(1, t / 0.15)));
    const rb = lerp(0.22, 0.115, Math.pow(t, 0.7)) * g;
    const w = lerp(0.185, 0.09, Math.pow(t, 0.85)) * g;
    return { x: ax + ux * bow, y: ay + uy * bow, rt: rt, rb: rb, w: w, ux: ux, uy: uy };
  }

  function buildLoft(D, col) {
    const LK = CBZ.loftKit, G = LK.geo(), T = table(), BN = T.BN, LEGB = T.LEGB, PAST = T.PAST;
    const H = D.H, Gt = D.Gt, Hs = D.Hs, g = H * Gt;
    const C = function (part, ex) { return function (x, y, z, ca, sa, R, t) { return lin(col(part, x, y, z, ca, sa, R, t, ex)); }; };
    const PL = BN.pelvis, CH = BN.chest, N0 = BN.neck, N1 = BN.neck1, N2 = BN.neck2, HD = BN.head;
    const loft = function (st, S, part, opts, disp, ex) {
      const v0 = G.n;
      LK.loft(G, st, S, C(part, ex), Object.assign({ hkBone: BN.hackle }, opts || {}));
      if (disp) displace(G, v0, S, disp);
    };

    // ---- THE BARREL: buttock -> croup -> loin -> barrel -> girth -> withers -> breast
    const TOR = [
      [-0.90, 1.40, 1.10, 0.13, 0],
      [-0.85, 1.50, 1.02, 0.21, 0],
      [-0.75, 1.565, 0.98, 0.255, 0],
      [-0.61, 1.595, 0.97, 0.27, 0],
      [-0.45, 1.585, 0.99, 0.275, 0],
      [-0.29, 1.56, 0.94, 0.28, 0],
      [-0.11, 1.53, 0.885, 0.295, 0],
      [0.07, 1.52, 0.85, 0.30, 0],
      [0.23, 1.53, 0.835, 0.29, 0.2],
      [0.37, 1.565, 0.845, 0.27, 0.6],
      [0.50, 1.60, 0.885, 0.245, 1],
      [0.62, 1.55, 0.94, 0.22, 0.6],
      [0.72, 1.45, 0.98, 0.20, 0.2],
      [0.80, 1.33, 1.02, 0.165, 0],
    ];
    const tor = TOR.map(function (r) {
      const wP = clamp((0.30 - r[0]) / 0.75, 0, 1);
      const cy = (r[1] + r[2]) / 2, rr = (r[1] - r[2]) / 2;
      return { x: r[0] * H, y: cy * H, rt: rr * H, rb: rr * H * (r[0] > -0.3 && r[0] < 0.4 ? Gt : 1), w: r[4] === 0 && r[0] < -0.3 ? r[3] * g : r[3] * g, sq: 0.92, wts: [PL, wP, CH, 1 - wP], hk: r[4] };
    });
    loft(tor, 32, "torso", { capLen: 0.55 });

    // ---- THE NECK (laterally flat, the crest arched)
    const nst = [{ x: 0.60 * H, y: 1.36 * H, rt: 0.26 * g, rb: 0.24 * g, w: 0.20 * g, wts: [CH, 1] }];
    const nT = [0, 0.25, 0.5, 0.75, 0.92, 1.0];
    const nW = [[CH, 0.5, N0, 0.5], [N0, 0.7, N1, 0.3], [N0, 0.2, N1, 0.6, N2, 0.2], [N1, 0.3, N2, 0.7], [N2, 0.6, HD, 0.4], [HD, 1]];
    for (let i = 0; i < nT.length; i++) {
      const a = neckAt(D, nT[i]);
      nst.push({ x: a.x, y: a.y, rt: a.rt, rb: a.rb, w: a.w, sq: 0.95, wts: nW[i] });
    }
    loft(nst, 24, "neck", { capLen: 0.4 });

    // ---- THE HEAD (d along the face from the poll, top/bottom across it)
    const HEAD = [
      [-0.06, 0.08, -0.10, 0.085],
      [0.02, 0.08, -0.15, 0.097],
      [0.10, 0.075, -0.20, 0.108],
      [0.18, 0.07, -0.19, 0.106],
      [0.26, 0.062, -0.14, 0.088],
      [0.34, 0.056, -0.10, 0.072],
      [0.44, 0.05, -0.058, 0.063],
      [0.52, 0.058, -0.048, 0.068],
      [0.58, 0.055, -0.042, 0.066],
      [0.62, 0.042, -0.032, 0.054],
    ];
    loft(HEAD.map(function (r) {
      const c = (r[1] + r[2]) / 2, rr = (r[1] - r[2]) / 2;
      const p = D.hp(r[0], c);
      return { x: p.x, y: p.y, rt: rr * Hs, rb: rr * Hs, w: r[3] * Hs, sq: 0.9, wts: [HD, 1] };
    }), 28, "head", { capLen: 0.45 });
    // the mouth's inside (seen when the lip drops)
    loft([0.42, 0.5, 0.58].map(function (d) {
      const p = D.hp(d, -0.05);
      return { x: p.x, y: p.y, rt: 0.008 * Hs, rb: 0.008 * Hs, w: 0.045 * Hs, wts: [HD, 1] };
    }), 8, "mouth", { capLen: 0.5 });
    // lower lip and chin, on the jaw bone
    loft([[0.36, -0.03, -0.095, 0.055], [0.44, -0.045, -0.096, 0.05], [0.52, -0.046, -0.088, 0.05], [0.58, -0.046, -0.075, 0.045], [0.615, -0.05, -0.066, 0.034]].map(function (r) {
      const c = (r[1] + r[2]) / 2, rr = (r[1] - r[2]) / 2, p = D.hp(r[0], c);
      return { x: p.x, y: p.y, rt: rr * Hs, rb: rr * Hs, w: r[3] * Hs, wts: [BN.jaw, 1] };
    }), 14, "lip", { capLen: 0.6 });
    // eyes: big, dark, set on the side of the head
    for (let s = -1; s <= 1; s += 2) {
      const E = D.eyeP, ez = s * E.z, rx = 0.029 * Hs, ry = 0.022 * Hs, rz = 0.016 * Hs;
      LK.ellipsoid(G, E.x, E.y, ez, rx, ry, rz, 12, function (x, y, z) {
        const dz = (z - ez) / rz * s;
        return lin(dz > 0.55 ? 0x1a0f0a : dz > 0.2 ? 0x2a1a10 : 0x1f1814);
      }, [HD, 1]);
    }
    // ears: leaf-shaped cups, tips dark
    for (let s = -1; s <= 1; s += 2) {
      const eb = BN[s < 0 ? "earL" : "earR"], E = D.earP;
      let ex = D.n.x * 0.8 - D.u.x * 0.45, ey = D.n.y * 0.8 - D.u.y * 0.45;
      const el = Math.hypot(ex, ey); ex /= el; ey /= el;
      const len = 0.15 * Hs, prof = [[0, 0.016, 0.03], [0.25, 0.02, 0.036], [0.55, 0.016, 0.03], [0.8, 0.01, 0.017], [1, 0.002, 0.003]];
      loft(prof.map(function (q) {
        return { x: E.x + ex * len * q[0], y: E.y + ey * len * q[0], z: s * (E.z + 0.022 * Hs * q[0]), rt: q[1] * Hs, rb: q[1] * Hs * 0.9, w: q[2] * Hs, wts: [eb, 1] };
      }), 10, "ear", { capLen: 0.6 });
    }
    // forelock
    loft([[-0.03, 0.085, 0.03], [0.05, 0.085, 0.04], [0.13, 0.078, 0.032], [0.18, 0.07, 0.016]].map(function (q) {
      const p = D.hp(q[0], q[1]);
      return { x: p.x, y: p.y, rt: 0.014 * Hs, rb: 0.01 * Hs, w: q[2] * Hs, wts: [HD, 1] };
    }), 12, "forelock", { capLen: 0.5 }, function (t, ca, sa, j) { return 1 + 0.15 * Math.sin(j * 2.1 + t * 7); });

    // ---- THE MANE: on the crest, falling to the right (+Z)
    const mst = [];
    const mT = [-0.12, 0.0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.88, 0.97];
    for (let i = 0; i < mT.length; i++) {
      const tt = mT[i];
      let a;
      if (tt < 0) {
        const a0 = neckAt(D, 0);
        a = { x: a0.x - 0.10 * H, y: a0.y + 0.0 * H, rt: 0.2 * g, rb: 0.2 * g, w: 0.16 * g, ux: a0.ux, uy: a0.uy };
      } else a = neckAt(D, tt);
      const drop = 0.055 * H;
      const cx = a.x + a.ux * (a.rt - drop), cy = a.y + a.uy * (a.rt - drop);
      const sideW = a.w * Math.sqrt(Math.max(0.05, 1 - Math.pow((a.rt - drop) / a.rt, 2))) + 0.014 * H;
      const wts = tt < 0.05 ? [CH, 0.6, N0, 0.4] : tt < 0.4 ? [N0, 0.7, N1, 0.3] : tt < 0.7 ? [N1, 0.7, N2, 0.3] : [N2, 0.7, HD, 0.3];
      mst.push({ x: cx, y: cy, rt: drop + 0.035 * H, rb: 0.075 * H, w: sideW * (tt < 0 ? 0.6 : 1), wts: wts });
    }
    loft(mst, 30, "mane", { capLen: 0.5 }, function (t, ca, sa, j) {
      // right side: the hair falls out and down; left: lies close; ragged edge
      const rag = 0.06 * Math.sin(j * 2.7 + t * 23) + 0.04 * Math.sin(j * 5.3 - t * 11);
      if (sa > 0.15) return 1.06 + 0.1 * sa * (1 - Math.max(0, ca)) + rag;
      if (sa < -0.15) return 0.97 + rag * 0.4;
      return 1 + rag * 0.5;
    });

    // ---- THE TAIL: dock + long hair (authored straight back; the pose hangs it)
    const TP = D.tailP, TL = D.tailL;
    const tprof = [[0, 0.06, 0.055], [0.1, 0.055, 0.05], [0.22, 0.068, 0.058], [0.36, 0.088, 0.068], [0.5, 0.098, 0.074], [0.65, 0.098, 0.07], [0.8, 0.085, 0.06], [0.92, 0.062, 0.046], [1.0, 0.03, 0.024]];
    const stops = [0, 0.12, 0.3, 0.55, 0.8];
    loft(tprof.map(function (q) {
      const t = q[0];
      let seg = 0; for (let k = 0; k < 5; k++) if (t >= stops[k]) seg = k;
      const nxt = seg < 4 ? stops[seg + 1] : 1.0001, f = (t - stops[seg]) / (nxt - stops[seg]);
      const wts = seg < 4 ? [BN["tail" + seg], 1 - f * 0.5, BN["tail" + (seg + 1)], f * 0.5] : [BN.tail4, 1];
      return { x: TP.x - TL * t, y: TP.y, rt: q[1] * H, rb: q[1] * H, w: q[2] * H, wts: wts };
    }), 16, "tail", { capLen: 0.7 }, function (t, ca, sa, j) {
      return t > 0.2 ? 1 + 0.12 * Math.sin(j * 2.3 + t * 19) * sstep(0.2, 0.5, t) : 1;
    });

    // ---- LEGS (bind straight down from each joint; the IK bends them)
    const pts = T.bindPoints(D);
    for (let Lg = 0; Lg < 4; Lg++) {
      const front = Lg < 2, ids = LEGB[Lg], P0 = pts[ids[0]], z = P0[2], x = P0[0], y0 = P0[1];
      const a = front ? D.fa : D.ha, b = front ? D.fb : D.hb, c = front ? D.fc : D.hc;
      const kneeY = y0 - a - b, fetY = kneeY - c;
      const ex = { knee: kneeY, fet: fetY, L: Lg };
      const k = g;
      const ring = function (dy, rt, rb, w, wts) { return { x: x, y: y0 + dy * H, z: z, rt: rt * k, rb: rb * k, w: w * k, wts: wts }; };
      const U = ids[0], Lo = ids[1], Cn = ids[2], Ps = PAST[Lg];
      const aH = a / H, bH = b / H, cH = c / H;
      if (front) {
        loft([
          ring(0.06, 0.10, 0.13, 0.10, [CH, 0.6, U, 0.4]),
          ring(-0.08, 0.095, 0.14, 0.095, [CH, 0.2, U, 0.8]),
          ring(-0.20, 0.085, 0.125, 0.085, [U, 0.85, Lo, 0.15]),
          ring(-aH, 0.078, 0.095, 0.078, [U, 0.5, Lo, 0.5]),
        ], 16, "leg", { capA: false, capLen: 0.6 }, null, ex);
        loft([
          ring(-aH, 0.078, 0.09, 0.078, [U, 0.4, Lo, 0.6]),
          ring(-aH - 0.06, 0.078, 0.07, 0.072, [Lo, 1]),       // forearm muscle
          ring(-aH - 0.18, 0.062, 0.055, 0.058, [Lo, 1]),
          ring(-aH - 0.30, 0.046, 0.04, 0.045, [Lo, 1]),
          ring(-aH - bH + 0.02, 0.042, 0.037, 0.044, [Lo, 0.8, Cn, 0.2]),
          ring(-aH - bH, 0.047, 0.042, 0.049, [Lo, 0.5, Cn, 0.5]),  // the knee
          ring(-aH - bH - 0.035, 0.04, 0.038, 0.043, [Cn, 1]),
          ring(-aH - bH - 0.11, 0.028, 0.043, 0.034, [Cn, 1]),     // flat cannon, tendons behind
          ring(-aH - bH - 0.21, 0.028, 0.043, 0.033, [Cn, 1]),
          ring(-aH - bH - cH, 0.037, 0.052, 0.043, [Cn, 0.5, Ps, 0.5]),  // fetlock
        ], 14, "leg", { capLen: 0.5 }, null, ex);
      } else {
        loft([
          ring(0.10, 0.15, 0.18, 0.15, [PL, 0.6, U, 0.4]),
          ring(-0.05, 0.16, 0.20, 0.155, [PL, 0.3, U, 0.7]),       // thigh / quarters
          ring(-0.20, 0.14, 0.19, 0.14, [U, 1]),
          ring(-0.32, 0.12, 0.15, 0.115, [U, 0.85, Lo, 0.15]),
          ring(-aH, 0.10, 0.12, 0.095, [U, 0.5, Lo, 0.5]),          // stifle
        ], 18, "leg", { capA: false, capLen: 0.6 }, null, ex);
        loft([
          ring(-aH, 0.095, 0.115, 0.09, [U, 0.4, Lo, 0.6]),
          ring(-aH - 0.06, 0.085, 0.11, 0.08, [Lo, 1]),             // gaskin
          ring(-aH - 0.18, 0.06, 0.085, 0.06, [Lo, 1]),
          ring(-aH - 0.32, 0.045, 0.055, 0.045, [Lo, 1]),
          ring(-aH - bH + 0.06, 0.04, 0.062, 0.042, [Lo, 1]),        // Achilles
          ring(-aH - bH, 0.045, 0.072, 0.048, [Lo, 0.5, Cn, 0.5]),   // hock, point of hock behind
          ring(-aH - bH - 0.05, 0.04, 0.046, 0.042, [Cn, 1]),
          ring(-aH - bH - 0.15, 0.03, 0.045, 0.035, [Cn, 1]),
          ring(-aH - bH - 0.27, 0.03, 0.045, 0.034, [Cn, 1]),
          ring(-aH - bH - cH, 0.038, 0.053, 0.043, [Cn, 0.5, Ps, 0.5]),  // fetlock
        ], 14, "leg", { capLen: 0.5 }, null, ex);
      }
      // pastern (sloping forward) and hoof (a vertical cone, flat sole)
      const fy = fetY, hk = front ? 1 : 0.95;
      loft([[0, 0, 0.036, 0.05, 0.042], [0.022, -0.05, 0.031, 0.032, 0.034], [0.042, -0.095, 0.038, 0.036, 0.042]].map(function (q, i) {
        return { x: x + q[0] * H, y: fy + q[1] * H, z: z, rt: q[2] * k, rb: q[3] * k, w: q[4] * k, wts: i === 0 ? [Cn, 0.4, Ps, 0.6] : [Ps, 1] };
      }), 12, "leg", { capLen: 0.4, capA: false }, null, ex);
      const hx = x + 0.045 * H;
      loft([[-0.098, 0.043, 0.042, 0.046], [-0.15, 0.057, 0.047, 0.055], [-0.205 + (front ? 0 : -0.01), 0.068, 0.05, 0.062]].map(function (q) {
        return { x: hx, y: fy + q[0] * H, z: z, rt: q[1] * k * hk, rb: q[2] * k * hk, w: q[3] * k * hk, wts: [Ps, 1] };
      }), 16, "hoof", { capLen: 0.12 }, null, ex);
    }
    return G;
  }

  // ---- geometry: ONE shape per sex; each coat variant only owns a colour attribute
  const _shape = {}, _geo = new Map();
  function geometryFor(sex, coat, face, legs, tack) {
    const THREE = W.THREE;
    const key = sex + "|" + coat + "|" + face + "|" + legs + "|" + (tack ? 1 : 0);
    let geo = _geo.get(key);
    if (geo) return geo;
    const D = dims(sex);
    const G = buildLoft(D, colourer(D, coat, FACES[face], LEGSETS[legs], tack));
    let sh = _shape[sex];
    if (!sh) {
      sh = _shape[sex] = CBZ.loftKit.toGeometry(G, { boundingSphere: [0, 1.0 * D.H, 0, 1.9 * D.H] });
      geo = sh;
    } else {
      geo = new THREE.BufferGeometry();
      geo.setAttribute("position", sh.getAttribute("position"));
      geo.setAttribute("normal", sh.getAttribute("normal"));
      geo.setAttribute("skinIndex", sh.getAttribute("skinIndex"));
      geo.setAttribute("skinWeight", sh.getAttribute("skinWeight"));
      geo.setIndex(sh.index);
      geo.setAttribute("color", new THREE.Float32BufferAttribute(G.c, 3));
      geo.boundingSphere = sh.boundingSphere;
      geo._shared = true;
    }
    _geo.set(key, geo);
    return geo;
  }

  // ---- THE SADDLE (tack): a stock saddle on the back, flaps, stirrups; the pad
  //      is a separate mesh in the side's colour
  let _saddleGeo = null, _padGeo = null, _tackMat = null;
  function saddleGeometry() {
    if (_saddleGeo) return _saddleGeo;
    const LK = CBZ.loftKit, D = dims("gelding"), H = D.H;
    const brown = lin(0x5a3820), dark = lin(0x2c1a10), steel = lin(0x8c8c88);
    const G = LK.geo(), Gp = LK.geo(), one = [0, 1];
    const col = function (c) { return function () { return c; }; };
    // seat: cantle (back, raised) -> seat -> pommel
    LK.loft(G, [[-0.12, 1.555, 0.05, 0.03, 0.15], [-0.04, 1.535, 0.035, 0.04, 0.17], [0.10, 1.525, 0.03, 0.045, 0.17], [0.26, 1.535, 0.035, 0.045, 0.16], [0.36, 1.57, 0.05, 0.035, 0.11], [0.41, 1.585, 0.035, 0.03, 0.07]].map(function (q) {
      return { x: q[0] * H, y: q[1] * H, rt: q[2] * H, rb: q[3] * H, w: q[4] * H, sq: 0.8, wts: one };
    }), 20, function (x, y, z, ca) { return ca > 0.3 ? brown : dark; }, { capLen: 0.5 });
    // flaps and stirrups, each side
    for (let s = -1; s <= 1; s += 2) {
      LK.loft(G, [[1.50, 0.215], [1.36, 0.27], [1.22, 0.305]].map(function (q) {
        return { x: 0.17 * H, y: q[0] * H, z: s * q[1] * H, rt: 0.008 * H, rb: 0.008 * H, w: 0.14 * H, wts: one };
      }), 8, col(brown), { side: [1, 0, 0], capLen: 0.6 });
      // the leather: from under the seat to the stirrup iron
      LK.loft(G, [[1.48, 0.23], [1.2, 0.315], [0.98, 0.33]].map(function (q) {
        return { x: 0.2 * H, y: q[0] * H, z: s * q[1] * H, rt: 0.004 * H, rb: 0.004 * H, w: 0.018 * H, wts: one };
      }), 6, col(dark), { side: [1, 0, 0], capLen: 0.5 });
      // the iron: a flat tread
      LK.loft(G, [[0.16, 0.955], [0.24, 0.955]].map(function (q) {
        return { x: q[0] * H, y: q[1] * H, z: s * 0.33 * H, rt: 0.012 * H, rb: 0.012 * H, w: 0.045 * H, wts: one };
      }), 8, col(steel), { capLen: 0.4 });
    }
    // the girth: a band under the barrel behind the elbow
    LK.loft(G, [{ x: 0.30 * H, y: 1.18 * H, rt: 0.355 * H, rb: 0.355 * H, w: 0.305 * H, sq: 0.92, wts: one },
      { x: 0.36 * H, y: 1.18 * H, rt: 0.355 * H, rb: 0.355 * H, w: 0.305 * H, sq: 0.92, wts: one }], 24, col(dark), { capA: false, capB: false });
    // the pad (numnah), side colour: a slightly bigger blanket under the saddle
    LK.loft(Gp, [[-0.2, 1.505, 0.012, 0.06, 0.19], [0.0, 1.495, 0.012, 0.09, 0.24], [0.2, 1.50, 0.012, 0.09, 0.245], [0.42, 1.54, 0.012, 0.07, 0.2]].map(function (q) {
      return { x: q[0] * H, y: q[1] * H, rt: q[2] * H, rb: q[3] * H, w: q[4] * H, sq: 0.7, wts: one };
    }), 20, col(lin(0xffffff)), { capLen: 0.3 });
    const strip = function (Gx) {
      const THREE = W.THREE, geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(Gx.p, 3));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(Gx.c, 3));
      geo.setIndex(Gx.ix); geo.computeVertexNormals(); geo.computeBoundingSphere(); geo._shared = true;
      return geo;
    };
    _saddleGeo = strip(G); _padGeo = strip(Gp);
    return _saddleGeo;
  }
  function tackMat() {
    const THREE = W.THREE;
    if (!_tackMat) { _tackMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0 }); _tackMat._shared = true; _tackMat.name = "horse-tack"; }
    return _tackMat;
  }

  // =========================================================================
  //  BUILD
  // =========================================================================
  let _mat = null, _mkGeo = null, _mkMat = null;
  function coatMat() {
    const THREE = W.THREE;
    if (!_mat) {
      _mat = new THREE.MeshStandardMaterial({ vertexColors: true, skinning: true, roughness: 0.72, metalness: 0 });
      _mat._shared = true; _mat.name = "horse-coat";
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
  function marker(group, w, h, d, x, y, z, tag) {
    const THREE = W.THREE;
    if (!_mkMat) { _mkMat = new THREE.MeshBasicMaterial({ visible: false }); _mkMat._shared = true; }
    const m = new THREE.Mesh(markerGeo(+w.toFixed(3), +h.toFixed(3), +d.toFixed(3)), _mkMat);
    m.position.set(x, y, z);
    m.visible = false; m.castShadow = false; m.userData.horseMarker = tag;
    group.add(m);
    return m;
  }

  function build(ctx) {
    const THREE = W.THREE, QR = CBZ.quadRig;
    if (!THREE || !QR || !CBZ.loftKit || !CBZ.quadGait) return null;
    const seed = Math.abs(ctx && ctx.seed != null ? (ctx.seed | 0) : Math.floor(((ctx && ctx.rng) ? ctx.rng() : Math.random()) * 1e6));
    const idx = seed % 7919;
    const r = mkRng(seed * 2654435761 + 0x4053);
    // a working herd: mostly mares and geldings, the odd stallion
    const sx = (idx * 7 + 3) % 12;
    const sex = sx === 0 || sx === 7 ? "stallion" : sx < 7 ? "mare" : "gelding";
    const D = dims(sex);
    const coat = pickCoat(r);
    const fr = r(), face = fr < 0.35 ? 0 : fr < 0.6 ? 1 : fr < 0.72 ? 2 : fr < 0.9 ? 3 : 4;
    const lr = r(), legs = lr < 0.42 ? 0 : 1 + Math.floor(r() * (LEGSETS.length - 1));
    const geo = geometryFor(sex, coat, face, legs, false);
    const T = table();
    const rig = QR.makeSkeleton(T, D, "horse");
    const mesh = QR.skinnedMesh(geo, coatMat(), rig);
    mesh.name = "horse-body";
    mesh.receiveShadow = false;
    const group = new THREE.Group();
    group.add(mesh);
    group.userData.dynamic = true;
    group.name = "horse";
    rig.D = D; rig.table = T; rig.sex = sex; rig.coat = coat; rig.face = face; rig.legs = legs;
    rig.G = CBZ.quadGait.create(D, gaitTable());
    rig.st = newState(r);
    rig.ctl = { x: 0, z: 0, y: 0, heading: 0, ground: null, alert: 0.2, aggr: 0, fear: 0, tired: 0, rest: 0, act: null, inj: null, lookAt: null, ridden: false };
    rig.group = group;
    // ---- the saddle rides the chest bone, hidden until a man is on it
    const sg = saddleGeometry();
    const sad = new THREE.Mesh(sg, tackMat());
    const pad = new THREE.Mesh(_padGeo, tackMat());
    const CHb = rig.bones[T.BN.chest], cb = rig.bindPos[T.BN.chest];
    const tackRoot = new THREE.Group();
    tackRoot.position.set(-D.shX, -D.sh, 0);    // model space inside the chest bone's frame
    tackRoot.scale.set(D.H / dims("gelding").H, D.H / dims("gelding").H, D.H * D.Gt / dims("gelding").H);
    tackRoot.add(pad); tackRoot.add(sad);
    sad.castShadow = true; pad.castShadow = true;
    tackRoot.visible = false;
    CHb.add(tackRoot);
    void cb;
    rig.tack = tackRoot; rig.pad = pad;
    // ---- markers the corpse solver discovers (invisible: legs, head, tail)
    const H = D.H;
    rig.mk = [];
    for (let L = 0; L < 4; L++) {
      const f = D.feet[L], J = L < 2 ? D.FJ : D.HJ;
      const full = marker(group, 0.08, J.y, 0.08, f.x, J.y / 2, f.z, "leg");
      const foot = marker(group, 0.05, 0.14, 0.05, f.x, 0.07, f.z, "foot");
      rig.mk.push({ full: full, foot: foot, fx: f.x, fz: f.z, fy: 0.07, ky: J.y / 2 });
    }
    const hc = D.hp(0.25, -0.03);
    rig.mkHead = marker(group, 0.12, 0.12, 0.12, hc.x, hc.y, 0, "head");
    rig.mkHead0 = { x: hc.x, y: hc.y, z: 0 };
    rig.mkTail = marker(group, 0.08, 0.08, 0.08, D.tailP.x - 0.2 * H, D.tailP.y - 0.3 * H, 0, "tail");
    rig.mkTail0 = { x: rig.mkTail.position.x, y: rig.mkTail.position.y, z: 0 };
    rig.frame = -1;
    mesh.onBeforeRender = function (renderer) { corpseHook(rig, renderer); };
    group.userData.horseRig = rig;
    // stand it up now: the bind pose (straight legs, tail out) is never shown
    const c0 = rig.ctl;
    for (let i = 0; i < 4; i++) pose(rig, 1 / 30, c0);
    return group;
  }
  // re-dress: the tacked colour variant (bridle on the head) + saddle visible
  function setTack(rig, on) {
    if (!!rig.tacked === !!on) return;
    rig.tacked = !!on;
    rig.mesh.geometry = geometryFor(rig.sex, rig.coat, rig.face, rig.legs, !!on);
    rig.tack.visible = !!on;
  }

  // =========================================================================
  //  POSE
  // =========================================================================
  function newState(r) {
    r = r || Math.random;
    return { px: null, pz: null, ph: 0, v: 0, acc: 0, turn: 0, t: r() * 10,
      alert: 0.2, aggr: 0, fear: 0, tired: 0, idleT: 0, graze: 0, rest: 0, restLeg: r() < 0.5 ? 2 : 3,
      lookY: 0, lookP: 0, lookTY: 0, lookTP: 0, lookT: 1 + r() * 2,
      earT: [r() * 3, r() * 3], earF: [0, 0], swishT: 1 + r() * 4, swish: 0, swishS: 1,
      tossT: 6 + r() * 12, toss: 0, stompT: 9 + r() * 15, stomp: 0, stompL: 0, snort: 0,
      sway: 0, actW: 0, ak: null, ap: 0, aside: 1,
      fl: { t: 0, k: 0, loc: 0, side: 1 }, inj: [0, 0, 0, 0], deadK: 0, lastT: 0 };
  }
  const _ik = [0, 0];
  // fx/fy/fz: the FETLOCK in the root frame; fa: the cannon's angle; pA: the pastern's
  // sc: the scapula's swing (front legs): the shoulder joint rides an arc
  // about the top of the shoulder blade, back with the foot in the stance
  const _off = { x: 0, y: 0, z: 0 };
  function legIK(rig, Lg, bx, by, br, yaw, fx, fy, fz, fa, pA, sc) {
    const D = rig.D, b = rig.bones, T = rig.table, ids = T.LEGB[Lg], front = Lg < 2;
    const a = front ? D.fa : D.ha, bl = front ? D.fb : D.hb, cl = front ? D.fc : D.hc;
    const bo = rig.bindPos[ids[0]];
    let off = bo;
    if (front) {
      // the shoulder blade slides the joint toward the hoof (forward and down
      // as the leg reaches, back and down as it pushes off)
      const k = clamp(sc || 0, -1.2, 1.2);
      _off.x = bo.x + 0.2 * D.H * k; _off.y = bo.y - 0.07 * D.H * Math.abs(k); _off.z = bo.z;
      off = _off;
      b[ids[0]].position.set(off.x, off.y, off.z);
    }
    const jx = bx + Math.cos(br) * off.x - Math.sin(br) * off.y;
    const jy = by + Math.sin(br) * off.x + Math.cos(br) * off.y;
    const jz = off.z;
    const rx = fx - bx, cy = Math.cos(yaw), sy = Math.sin(yaw);
    const tx = bx + rx * cy - fz * sy, tz = rx * sy + fz * cy;
    const dz = tz - jz, dyv = Math.max(0.05, jy - fy);
    const ab = clamp(-Math.atan2(dz, dyv), -0.6, 0.6);
    const ty = jy - Math.hypot(dyv, dz);
    const wx = tx - cl * Math.cos(fa), wy = ty - cl * Math.sin(fa);
    CBZ.quadRig.ik2(jx, jy, wx, wy, a, bl, front ? -1 : 1, _ik);
    const t1 = _ik[0], t2 = _ik[1];
    b[ids[0]].rotation.set(ab, 0, t1 + HALF - br);
    b[ids[1]].rotation.set(0, 0, t2 - t1);
    b[ids[2]].rotation.set(0, 0, fa - t2);
    b[T.PAST[Lg]].rotation.set(0, 0, pA - fa - HALF);
  }
  // the fetlock that puts the hoof's ground centre at (hx, hy) with the pastern at pA
  const _ft = { x: 0, y: 0 };
  function fetlockFor(D, front, hx, hy, pA) {
    const o = D.po[front ? 0 : 1], c = Math.cos(pA), s = Math.sin(pA);
    _ft.x = hx - (o.x * c - o.y * s); _ft.y = hy - (o.x * s + o.y * c);
    return _ft;
  }
  const OV = [0, 1, 2, 3].map(function () { return { w: 0, x: 0, y: 0, z: 0, a: 0, p: 0 }; });
  const BD = { pX: 0, pY: 0, pR: 0, cX: 0, cY: 0, cR: 0 };
  function pitchAbout(th, px, py) {
    const c = Math.cos(th), s = Math.sin(th);
    let dx = BD.pX - px, dy = BD.pY - py;
    BD.pX = px + dx * c - dy * s; BD.pY = py + dx * s + dy * c;
    dx = BD.cX - px; dy = BD.cY - py;
    BD.cX = px + dx * c - dy * s; BD.cY = py + dx * s + dy * c;
    BD.pR += th; BD.cR += th;
  }
  function setOV(L, w, x, y, z, a, p) { const o = OV[L]; o.w = w; o.x = x; o.y = y; o.z = z; o.a = a; o.p = p; }

  function pose(rig, dt, c) {
    if (!(dt > 0)) dt = 0.016;
    if (dt > 0.1) dt = 0.1;
    const QG = CBZ.quadGait;
    const D = rig.D, H = D.H, b = rig.bones, bp = rig.bindPos, BN = rig.table.BN, st = rig.st, G = rig.G;
    st.t += dt;
    const gx = c.x, gz = c.z, h = c.heading || 0;
    if (st.px == null) { st.px = gx; st.pz = gz; st.ph = h; }
    const mdx = gx - st.px, mdz = gz - st.pz;
    let v = (mdx * Math.cos(h) + mdz * Math.sin(h)) / dt, turn = wrapPi(h - st.ph) / dt;
    if (mdx * mdx + mdz * mdz > 16) { v = 0; turn = 0; QG.reset(G, gx, gz, h, c.ground, c.y); }
    st.px = gx; st.pz = gz; st.ph = h;
    const vPrev = st.v;
    st.v = approach(st.v, clamp(v, -4, 20), 8, dt);
    st.acc = approach(st.acc, clamp((st.v - vPrev) / dt, -10, 10), 4, dt);
    st.turn = approach(st.turn, clamp(turn, -5, 5), 8, dt);
    const av = Math.abs(st.v);

    // ---- action channel
    const A = c.act;
    if (A) { st.ak = A.kind; st.ap = A.p; st.aside = A.side || 1; }
    st.actW = approach(st.actW, A ? 1 : 0, A ? 12 : 5, dt);
    const aw = st.actW, ak = aw > 0.01 ? st.ak : null, ap = st.ap;

    // ---- moods
    st.alert = approach(st.alert, clamp(c.alert || 0, 0, 1), 4, dt);
    st.aggr = approach(st.aggr, clamp(c.aggr || 0, 0, 1), 5, dt);
    st.fear = approach(st.fear, clamp(c.fear || 0, 0, 1), 4, dt);
    st.tired = approach(st.tired, clamp(c.tired || 0, 0, 1), 1.2, dt);
    if (c.inj) for (let i = 0; i < 4; i++) st.inj[i] = approach(st.inj[i], c.inj[i], 2, dt);
    const lame = Math.max(st.inj[0], st.inj[1], st.inj[2], st.inj[3]);
    // ---- idle: graze, rest a hind leg, swish, flick, toss, stomp
    const calm = av < 0.25 && !ak && st.alert < 0.45 && st.fear < 0.1 && !c.ridden;
    if (calm) st.idleT += dt; else st.idleT = 0;
    st.graze = approach(st.graze, c.rest && st.idleT > 3 && ((st.t * 0.07) % 1) < 0.7 ? 1 : 0, 1.3, dt);
    st.rest = approach(st.rest, calm && st.idleT > 6 && st.graze < 0.3 ? 1 : 0, 1.5, dt);
    st.lookT -= dt;
    if (st.lookT <= 0) {
      st.lookT = 1.2 + Math.random() * 3;
      const busy = av > 2 || ak;
      st.lookTY = busy ? 0 : (Math.random() - 0.5) * 0.9;
      st.lookTP = busy ? 0 : (Math.random() - 0.4) * 0.3;
    }
    if (c.lookAt) {
      const la = wrapPi(Math.atan2(c.lookAt.z - gz, c.lookAt.x - gx) - h);
      st.lookTY = clamp(-la, -1.2, 1.2);
      st.lookTP = 0.15;
    }
    st.lookY = approach(st.lookY, st.lookTY, 2.5, dt);
    st.lookP = approach(st.lookP, st.lookTP, 2.5, dt);
    for (let e = 0; e < 2; e++) {
      st.earT[e] -= dt;
      if (st.earT[e] <= 0) { st.earT[e] = 1 + Math.random() * 4; st.earF[e] = 1; }
      st.earF[e] = Math.max(0, st.earF[e] - dt * 4);
    }
    st.swishT -= dt;
    if (st.swishT <= 0) { st.swishT = 1.5 + Math.random() * 5; st.swish = 1; st.swishS = Math.random() < 0.5 ? -1 : 1; }
    st.swish = Math.max(0, st.swish - dt * 1.4);
    st.tossT -= dt;
    if (st.tossT <= 0) { st.tossT = 8 + Math.random() * 16; if (st.graze < 0.2) st.toss = 1; }
    st.toss = Math.max(0, st.toss - dt * 1.3);
    st.stompT -= dt;
    if (st.stompT <= 0) { st.stompT = 10 + Math.random() * 20; if (calm && st.graze < 0.2) { st.stomp = 1; st.stompL = Math.random() < 0.5 ? 0 : 1; } }
    st.stomp = Math.max(0, st.stomp - dt * 1.8);
    st.snort = Math.max(0, st.snort - dt);
    const F = st.fl;
    if (F.t > 0) F.t = Math.max(0, F.t - dt);
    const fk = F.t > 0 ? F.k * Math.sin(PI * Math.min(1, F.t / 0.5)) * (F.t / 0.5) : 0;

    // ---- GAIT: every hoof plants
    QG.step(G, dt, st.v, st.turn, gx, gz, h, c.ground, c.y);
    const M = G.mix, phase = G.phase, ph = phase * TAU;
    const moveK = clamp(av / 0.5, 0, 1);
    const wlk = (M.wW || 0) * moveK, trt = (M.wT || 0) * moveK, cnt = (M.wC || 0) * moveK, gal = (M.wG || 0) * moveK;

    // ---- BODY
    BD.pX = D.hipX; BD.pY = D.hipH; BD.pR = 0; BD.cX = D.shX; BD.cY = D.sh; BD.cR = 0;
    let roll = 0;
    // trot: the bounce off each diagonal
    const bob = -0.032 * H * trt * (0.5 + 0.5 * Math.cos(4 * PI * (phase - 0.46)));
    // walk: the hips rise and fall with each hind step, a little roll
    const wb = -0.012 * H * wlk * (0.5 + 0.5 * Math.cos(4 * PI * (phase - 0.15)));
    BD.pY += bob + wb; BD.cY += bob + wb * 0.6;
    roll += 0.035 * wlk * Math.sin(ph);
    // canter / gallop: the rocking-horse pitch, once per stride
    const rock = 0.075 * cnt + 0.05 * gal;
    const rk = Math.sin(TAU * (phase - 0.55));
    BD.cY += 0.045 * H * (cnt + gal * 0.7) * Math.sin(TAU * (phase - 0.62));
    BD.pY += 0.03 * H * (cnt + gal * 0.7) * Math.sin(TAU * (phase - 0.12));
    BD.cR += rock * rk * 0.5; BD.pR += rock * rk * 0.4;
    // galloping lowers and lengthens the frame
    BD.cY -= 0.04 * H * gal; BD.pY -= 0.03 * H * gal;
    // starts sit down behind and lift the front; braking does the opposite
    const acc = clamp(st.acc, -6, 6);
    BD.pY -= Math.max(0, acc) * 0.007 * H; BD.cR += acc * 0.008; BD.pR += acc * 0.006;
    if (acc < 0) { BD.pY += acc * 0.006 * H; BD.cY += acc * 0.002 * H; }
    // breathing (blown horses heave)
    BD.cY += Math.sin(st.t * (1.4 + st.tired * 4)) * (0.003 + st.tired * 0.007) * H;
    // fear: crouched to bolt, tension
    BD.pY -= 0.03 * H * st.fear;
    // flinch by location
    if (fk > 0) {
      if (F.loc === 1) { BD.cY -= 0.07 * H * fk; roll += 0.06 * F.side * fk; }
      else if (F.loc === 2) { BD.pY -= 0.09 * H * fk; roll -= 0.06 * F.side * fk; }
      else if (F.loc === 3) { roll += 0.1 * F.side * fk; BD.cY += 0.02 * H * fk; }
    }
    // lame: the body drops onto the sound side and the head nods
    let lameNod = 0;
    for (let i = 0; i < 4; i++) {
      if (st.inj[i] < 0.05) continue;
      const Ft = G.feet[i], load = Ft.sw ? 0 : st.inj[i];
      roll += (i % 2 === 0 ? 1 : -1) * 0.05 * load * moveK;
      if (i < 2) lameNod += load * moveK; else BD.pY += 0.03 * H * load * moveK;   // hip hike on the bad hind
    }
    // grazing: the forehand drops a little, a foreleg goes forward
    BD.cY -= 0.04 * H * st.graze; BD.cR -= 0.04 * st.graze;
    // resting a hind leg: that hip drops
    const restL = st.restLeg;
    BD.pY -= 0.03 * H * st.rest; roll += (restL === 2 ? 1 : -1) * 0.06 * st.rest;

    // ---- ACTIONS
    let neckP = 0, neckY = 0, headP = 0, jawA = 0, earBack = 0, tailUp = 0, tailLash = 0;
    for (let i = 0; i < 4; i++) OV[i].w = 0;
    if (ak) {
      const s = st.aside >= 0 ? 1 : 0;
      switch (ak) {
        case "kick": case "buck": {
          // load the forehand, then the hindquarters go up and both hinds fire back
          const big = ak === "kick" ? 1 : 0.55;
          const load = env(ap, 0, 0.25, 0.35, 0.45), fire = env(ap, 0.3, 0.45, 0.6, 0.85);
          const fx = (D.feet[0].x + 0.03 * H), fy = 0.2 * H;
          pitchAbout(-(0.06 * load + 0.32 * big * fire) * aw, fx, fy);
          BD.pY -= 0.05 * H * load * aw;
          for (let L = 2; L < 4; L++) {
            const z = (L === 2 ? -1 : 1) * D.legZh * (1 + 0.3 * fire);
            if (fire > 0.02) setOV(L, aw * fire, BD.pX - (0.55 + 0.75 * big) * H, BD.pY - (0.62 - 0.35 * big) * H, z, -PI + 0.5 - 0.25 * big, -1.4);
            else if (load > 0.02) setOV(L, aw * load * 0.6, BD.pX - 0.05 * H, 0.22 * H, z, -HALF + 0.3, -0.6);
          }
          neckP -= (0.35 * load + 0.45 * fire) * aw; earBack += aw; tailUp += 0.7 * fire * aw; tailLash += aw;
          break;
        }
        case "cowkick": {
          const fire = env(ap, 0.2, 0.4, 0.55, 0.85), L = 2 + s, sg = s ? 1 : -1;
          setOV(L, aw * fire, BD.pX + 0.15 * H, 0.55 * H, sg * 0.55 * H, -HALF - 0.6, -1.1);
          roll -= sg * 0.08 * fire * aw;
          neckY += sg * 0.5 * fire * aw; earBack += aw; tailLash += aw;
          break;
        }
        case "rear": case "strike": case "trample": {
          // the forehand goes up over the planted hinds; forefeet paw / strike
          const rear = ak === "rear", tr = ak === "trample";
          const up = env(ap, 0, 0.3, tr ? 0.5 : 0.7, tr ? 0.75 : 1);
          const th = (rear ? 0.95 : tr ? 0.42 : 0.6) * up * aw;
          const px = (D.feet[2].x + 0.05 * H), py = 0.25 * H;
          pitchAbout(th, px, py);
          BD.pY -= 0.08 * H * up * aw;
          const strike = ak === "strike" ? env(ap, 0.45, 0.6, 0.75, 0.9) : tr ? env(ap, 0.45, 0.62, 0.75, 0.95) : 0;
          for (let L = 0; L < 2; L++) {
            const sg = L === 0 ? -1 : 1, paw = Math.sin(st.t * 7 + L * PI);
            if (up < 0.03) continue;
            let x = BD.cX + (0.32 + (rear ? 0.12 * paw : 0)) * H, y = BD.cY - (0.62 - (rear ? 0.12 * paw : 0)) * H;
            let a = -HALF - 1.35 + (rear ? 0.25 * paw : 0), p = -1.1;
            if (strike > 0) { x = lerp(x, BD.cX + 0.75 * H, strike); y = lerp(y, 0.12 * H, strike); a = lerp(a, -HALF + 0.35, strike); p = lerp(p, 0, strike); }
            setOV(L, aw * Math.min(1, up * 1.5), x, y, sg * D.legZf * 1.2, a, p);
          }
          neckP += (rear ? 0.35 : 0.15) * up * aw; headP += 0.25 * up * aw; earBack += aw * (rear ? 0.6 : 1);
          tailUp += 0.3 * up * aw;
          break;
        }
        case "bite": {
          const e = env(ap, 0, 0.4, 0.6, 1);
          BD.cX += 0.08 * H * e * aw; BD.cY -= 0.04 * H * e * aw;
          neckP -= 0.45 * e * aw; headP += 0.35 * e * aw; neckY += 0.15 * st.aside * e * aw;
          jawA += (ap < 0.5 ? 0.5 * sstep(0.1, 0.4, ap) : 0.5 * (1 - sstep(0.5, 0.58, ap))) * aw;
          earBack += aw;
          break;
        }
        case "threat": {
          // ears pinned, head snaking low, a hind lifted ready to kick
          neckP -= 0.4 * aw; headP += 0.25 * aw; neckY += 0.35 * Math.sin(st.t * 3.2) * aw;
          earBack += aw; tailLash += aw; jawA += 0.08 * aw;
          setOV(2 + (st.aside >= 0 ? 1 : 0), 0.7 * aw, BD.pX - 0.08 * H, 0.18 * H, (st.aside >= 0 ? 1 : -1) * D.legZh, -HALF + 0.1, 0.5);
          break;
        }
        case "ram": {
          neckP -= 0.25 * aw; headP -= 0.1 * aw; earBack += 0.8 * aw;
          break;
        }
        case "spook": {
          const e = env(ap, 0, 0.2, 0.5, 1);
          BD.cY -= 0.08 * H * e * aw; BD.pY -= 0.06 * H * e * aw;
          neckP += 0.45 * e * aw; headP += 0.3 * e * aw; tailUp += 0.5 * e * aw;
          break;
        }
      }
    }
    if (st.aggr > 0.05) { earBack = Math.max(earBack, st.aggr * 0.85); tailLash = Math.max(tailLash, st.aggr * 0.6); }

    // ---- bones: pelvis + chest
    const chestYaw = clamp(st.turn * 0.05, -0.14, 0.14) + (F.loc === 3 ? 0.1 * F.side * fk : 0);
    const pelvYaw = -chestYaw * 0.6;
    roll += clamp(-st.turn * av * 0.006, -0.18, 0.18);       // lean into the turn
    b[BN.pelvis].position.set(BD.pX, BD.pY, 0);
    b[BN.pelvis].rotation.set(-roll * 0.6, pelvYaw, BD.pR);
    b[BN.chest].position.set(BD.cX, BD.cY, 0);
    b[BN.chest].rotation.set(roll, chestYaw, BD.cR);

    // ---- LEGS
    const fAmp = 0.65 * wlk + 1.35 * trt + 1.35 * cnt + 1.5 * gal + 0.6 * (1 - moveK);
    const hAmp = 0.5 * wlk + 0.9 * trt + 1.0 * cnt + 1.1 * gal + 0.5 * (1 - moveK);
    const reachK = 0.15 * trt + 0.3 * cnt + 0.45 * gal;
    for (let Lg = 0; Lg < 4; Lg++) {
      const front = Lg < 2, Ft = G.feet[Lg], base = D.feet[Lg];
      let hx = Ft.lx, hy = Ft.ly, hz = Ft.lz, fa, pA;
      if (Ft.sw) {
        const u = Ft.u, flex = u < 0.72 ? Math.sin(PI * u / 0.72) : 0, reach = sstep(0.55, 0.95, u);
        if (front) {
          fa = -HALF - 1.15 * fAmp * flex + reachK * reach * 0.6;
          pA = -1.0 * fAmp * flex + 0.1 * reach;
          hy += 0.25 * H * fAmp * flex;
        } else {
          fa = -HALF - 0.7 * hAmp * flex + reachK * reach * 0.35;
          pA = -0.9 * hAmp * flex;
          hy += 0.12 * H * hAmp * flex;
        }
      } else {
        const behind = clamp((base.x - Ft.lx) / (0.5 * H), 0, 1), ahead = clamp((Ft.lx - base.x) / (0.5 * H), 0, 1);
        fa = -HALF - (front ? 0.3 : 0.5) * behind + (front ? 0.15 : 0.05) * ahead;
        pA = (-0.7 * behind * behind + 0.12 * (1 - behind)) * moveK;  // loaded: the fetlock sinks; push-off: the heel lifts
      }
      // fly stomp, grazing stance, resting hind
      if (front && st.stomp > 0 && Lg === st.stompL) { const e = Math.sin(PI * st.stomp); hy += 0.12 * H * e; fa -= 0.9 * e; pA -= 0.6 * e; }
      if (front && Lg === 0 && st.graze > 0.01) { hx += 0.22 * H * st.graze; }
      if (!front && Lg === restL && st.rest > 0.01) { hx += 0.1 * H * st.rest; hy += 0.02 * H * st.rest; pA += 1.0 * st.rest; fa += 0.25 * st.rest; }
      // a lame leg toe-touches
      if (st.inj[Lg] > 0.05 && !Ft.sw) hy += 0.03 * H * st.inj[Lg] * moveK;
      const o = OV[Lg];
      if (o.w > 0.001) { hx = lerp(hx, o.x, o.w); hy = lerp(hy, o.y, o.w); hz = lerp(hz, o.z, o.w); fa = lerp(fa, o.a, o.w); pA = lerp(pA, o.p, o.w); }
      const fp = fetlockFor(D, front, hx, hy, pA);
      const sc = front ? clamp((hx - base.x) / (0.55 * H), -1, 1) + (o.w > 0.001 ? 0.6 * o.w * clamp((o.x - BD.cX) / (0.5 * H), -1, 1) : 0) : 0;
      if (front) legIK(rig, Lg, BD.cX, BD.cY, BD.cR, chestYaw, fp.x, fp.y, hz, fa, pA, sc);
      else legIK(rig, Lg, BD.pX, BD.pY, BD.pR, pelvYaw, fp.x, fp.y, hz, fa, pA);
    }

    // ---- WITHERS: the scapulae ride over the loaded foreleg
    const hk = bp[BN.hackle];
    b[BN.hackle].position.set(hk.x, hk.y + (0.012 * Math.abs(Math.sin(ph)) * (wlk + trt)) * H, 0);

    // ---- NECK / HEAD
    const speedK = clamp(av / 12, 0, 1);
    neckP += -0.05 + st.alert * 0.16 + st.fear * 0.18 - 0.28 * speedK - 0.08 * gal - st.tired * 0.25 - lame * 0.15
      + st.lookP * 0.5 - BD.cR * 0.7;
    // the nod: walk 2/stride, canter & gallop pump once per stride
    neckP -= 0.07 * wlk * Math.cos(4 * PI * (phase - 0.27));
    neckP += (0.08 * cnt + 0.1 * gal) * Math.sin(TAU * (phase - 0.3));
    neckP += 0.1 * lameNod * Math.sin(2 * ph);
    // grazing: the neck goes down to the ground
    neckP -= 1.5 * st.graze;
    headP += 0.55 * st.graze + 0.04 * Math.sin(st.t * 2.3) * st.graze;
    if (c.ridden) { neckP += 0.08; headP -= 0.22; }               // collected under a rider
    // head toss and snort
    const tossE = st.toss > 0 ? Math.sin(PI * st.toss) : 0;
    neckP += 0.25 * tossE; headP += 0.25 * tossE * Math.sin(st.toss * 14);
    if (fk > 0 && F.loc === 0) { neckY += 0.45 * F.side * fk; neckP += 0.3 * fk; }
    neckY += st.lookY * (1 - aw * 0.7) * (1 - st.graze * 0.6) - chestYaw * 0.8 + st.turn * 0.06;
    b[BN.neck].rotation.set(0, neckY * 0.35, neckP * 0.42);
    b[BN.neck1].rotation.set(0, neckY * 0.35, neckP * 0.33);
    b[BN.neck2].rotation.set(0, neckY * 0.3, neckP * 0.25);
    b[BN.head].rotation.set(fk > 0 && F.loc === 0 ? 0.2 * F.side * fk : 0, st.lookY * 0.2 * (1 - aw), headP - neckP * 0.3 + st.lookP * 0.25);
    jawA += 0.03 * st.tired * (0.5 + 0.5 * Math.sin(st.t * 3)) + 0.05 * st.graze * (0.5 + 0.5 * Math.sin(st.t * 6));
    b[BN.jaw].rotation.set(0, 0, -clamp(jawA, 0, 0.55));

    // ---- EARS: pricked at the threat, swivel, flick; pinned flat in anger, airplane when tired
    earBack = clamp(earBack, 0, 1);
    const prick = clamp(st.alert * 1.2 - earBack, 0, 1);
    for (let e = 0; e < 2; e++) {
      const bone = b[e === 0 ? BN.earL : BN.earR], sg = e === 0 ? -1 : 1, fl = st.earF[e];
      const swivel = (e === 0 ? 1 : -1) * 0.35 * Math.sin(st.t * 0.7 + e * 2) * (1 - prick);
      bone.rotation.set(sg * (0.12 + 0.35 * st.tired + 0.15 * earBack + 0.25 * fl),
        sg * (0.25 * (1 - prick) + swivel) - 0.6 * st.lookY * prick * 0.4,
        1.15 * earBack - 0.2 * prick + 0.35 * fl - 0.1);
    }

    // ---- TAIL: hangs; swishes at flies; streams up at the gallop; clamped in fear
    st.sway += dt * TAU * (G.mix.f || 0.8) * 0.5;
    const sw = st.swish > 0 ? Math.sin(PI * st.swish) * st.swishS : 0;
    const lash = tailLash * Math.sin(st.t * 8);
    const run = clamp(trt * 0.25 + cnt * 0.6 + gal * 0.85 + tailUp, 0, 1.1);
    const hang = 0.62 - 0.55 * run + 0.35 * st.fear;
    b[BN.tail0].rotation.set(0, 0.06 * (wlk + trt) * Math.sin(st.sway) + 0.25 * sw + 0.25 * lash, hang);
    b[BN.tail1].rotation.set(0, 0.35 * sw + 0.3 * lash, 0.38 - 0.3 * run);
    b[BN.tail2].rotation.set(0, 0.4 * sw + 0.35 * lash, 0.32 - 0.3 * run + 0.05 * gal * Math.sin(ph * 2));
    b[BN.tail3].rotation.set(0, 0.35 * sw + 0.3 * lash, 0.2 - 0.18 * run);
    b[BN.tail4].rotation.set(0, 0.25 * sw + 0.2 * lash, 0.1 - 0.1 * run);
  }

  // =========================================================================
  //  THE CORPSE: the skin follows the solver's discovered points
  // =========================================================================
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
    // a horse shot dead under its rider throws him
    if (u && u._horse && u._horse.rider) { try { dismount(u, { fall: 20 + Math.random() * 25 }); } catch (e) {} }
    const t = now(), dt = rig.st.lastT ? clamp(t - rig.st.lastT, 0, 0.1) : 0.016;
    rig.st.lastT = t;
    corpsePose(rig, dt);
    rig.bones[0].updateMatrixWorld(true);
    if (rig.skeleton) rig.skeleton.update();
  }
  function corpsePose(rig, dt) {
    const D = rig.D, H = D.H, b = rig.bones, BN = rig.table.BN, st = rig.st;
    st.deadK = Math.min(1, st.deadK + dt * 2.2);
    const k = st.deadK;
    if (rig.tack) rig.tack.visible = !!rig.tacked;
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
      // limp legs: each joint folds a little
      const rx = J.x + (front ? 0.2 : -0.12) * H, ry = J.y - (front ? 0.78 : 0.85) * H;
      const hx = moved ? fp.x : lerp(mk.fx, rx, k), hy = moved ? fp.y - 0.07 : lerp(0, ry, k), hz = moved ? fp.z : mk.fz;
      const fa = front ? -HALF - 0.4 * k : -HALF - 0.3 * k, pA = -0.6 * k;
      const f2 = fetlockFor(D, front, hx, hy, pA);
      if (front) legIK(rig, L, D.shX, D.sh, 0, 0, f2.x, f2.y, hz, fa, pA);
      else legIK(rig, L, D.hipX, D.hipH, 0, 0, f2.x, f2.y, hz, fa, pA);
    }
    const h0 = rig.mkHead0, h1 = rig.mkHead.position, nb = D.neckB;
    let dp = 0, dy = 0;
    if (Math.abs(h1.x - h0.x) + Math.abs(h1.y - h0.y) + Math.abs(h1.z - h0.z) > 0.01) {
      dp = Math.atan2(h1.y - nb.y, h1.x - nb.x) - Math.atan2(h0.y - nb.y, h0.x - nb.x);
      dy = -Math.atan2(h1.z, h1.x - nb.x);
    } else dp = -0.6 * k;
    dp = clamp(dp, -1.5, 0.8); dy = clamp(dy, -1.0, 1.0);
    b[BN.neck].rotation.set(0, dy * 0.4, dp * 0.45);
    b[BN.neck1].rotation.set(0, dy * 0.35, dp * 0.35);
    b[BN.neck2].rotation.set(0, dy * 0.25, dp * 0.2);
    b[BN.head].rotation.set(0, 0, 0.15 * k);
    b[BN.jaw].rotation.set(0, 0, -0.12 * k);
    b[BN.earL].rotation.set(-0.5 * k, 0, 0.6 * k); b[BN.earR].rotation.set(0.5 * k, 0, 0.6 * k);
    b[BN.tail0].rotation.set(0, 0, 0.3); b[BN.tail1].rotation.set(0, 0.2 * k, 0.1);
    b[BN.tail2].rotation.set(0, 0.2 * k, 0.05); b[BN.tail3].rotation.set(0, 0.15 * k, 0); b[BN.tail4].rotation.set(0, 0.1 * k, 0);
  }

  // =========================================================================
  //  THE HOST SEAM: the battle's crew helpers (feature-detected)
  // =========================================================================
  const SEAM = {
    roster: function () { const B = W.__battle; try { return B && B.roster ? B.roster() : null; } catch (e) { return null; } },
    canRide: function () { return typeof vehPutOnField === "function" && !!SEAM.roster(); },   // eslint-disable-line no-undef
    // out of the infantry sim: the saddle owns him (vehicles.js does this for a crewman)
    lift: function (man) {
      const R = SEAM.roster();
      if (R) { const k = R.indexOf(man); if (k >= 0) R.splice(k, 1); }
      try {
        if (typeof squads !== "undefined") {                                 // eslint-disable-line no-undef
          const sq = squads[man.team] && squads[man.team][man.sq];           // eslint-disable-line no-undef
          if (sq) { const k = sq.indexOf(man); if (k >= 0) sq.splice(k, 1); }
        }
      } catch (e) {}
      if (man.ordTgt) {
        man.ordTgt.alive = false;
        if (CBZ.ordnance && CBZ.ordnance.removeTarget) { try { CBZ.ordnance.removeTarget(man.ordTgt); } catch (e) {} }
        man.ordTgt = null;
      }
    },
    // back on his feet at (x, z) facing heading h (the battle's own re-entry)
    drop: function (man, x, z, h) {
      if (typeof vehPutOnField !== "function") return false;                 // eslint-disable-line no-undef
      // vehPutOnField seats a man at k = 0: 2.2 m to the hull's side and none behind
      const yaw = PI / 2 - h;
      const u = { pos: { x: x + Math.cos(yaw) * 2.2, y: 0, z: z - Math.sin(yaw) * 2.2 }, h: yaw, vlen: -1.2 };
      try { vehPutOnField(u, man, 0); } catch (e) { return false; }          // eslint-disable-line no-undef
      man.home = null;
      return true;
    },
    hurt: function (u, dmg, by) {
      if (typeof hurtMan === "function") { try { hurtMan(u, dmg, { by: by }); } catch (e) {} }   // eslint-disable-line no-undef
      else { u.hp -= dmg; if (u.hp <= 0) u.dead = true; }
    },
  };

  // =========================================================================
  //  THE BRAIN: one per horse (m._horse)
  // =========================================================================
  const LIVE = [];
  function brainOf(m) {
    let L = m._horse;
    if (L) return L;
    const rig = m.group && m.group.userData && m.group.userData.horseRig;
    if (!rig) return null;
    const R = REAL[rig.sex];
    L = m._horse = {
      rig: rig, R: R, sex: rig.sex, sta: 1, lastHp: m.hp, hitT: 9, stress: 0, panicT: 0,
      mode: "stand", f: "close", fT: 0, cd: 0.3, hitDone: false, hits: 0,
      act: { kind: null, p: 0, side: 1 }, fightAt: -9, kindTgt: null, kind: "man",
      inj: [0, 0, 0, 0], scanT: (m.i % 7) * 0.07, threat: null, td: 1e9, tkind: null, nEnemy: 0,
      home: { x: m.pos.x, z: m.pos.z }, fleeT: 0, fleeX: 0, fleeZ: 0,
      rider: null, claim: null, mountK: 0, mountDir: 0, warhorse: false, passT: 0, passX: 0, passZ: 0,
      spookT: 0, lastHeading: m.heading || 0,
    };
    rig.unit = m;
    m.tn = Object.assign({}, m.tn);
    if (m.maxHp < 1e6) { m.maxHp = Math.round(m.maxHp * R.hpK); m.hp = Math.min(m.hp, m.maxHp); L.lastHp = m.hp; }
    const k = m._sizeMul || 1;
    m._mass = R.mass * k * k * k;
    m._jawL = { x: rig.D.mouth.x, y: rig.D.mouth.y, z: 0 };
    m._jawGripL = m._jawL;
    LIVE.push(m);
    // the side's collar becomes a neck strap on the neck bone; its colour dresses the saddle pad
    const THREE = W.THREE, g = m.group;
    for (let i = g.children.length - 1; i >= 0; i--) {
      const ch = g.children[i];
      if (!ch.isMesh || ch === rig.mesh || (ch.userData && ch.userData.horseMarker)) continue;
      const D = rig.D, rad = 0.2 * D.H * D.Gt, key = "strap" + rad.toFixed(3);
      _mkGeo = _mkGeo || new Map();
      let tg = _mkGeo.get(key);
      if (!tg) { tg = new THREE.TorusGeometry(rad, 0.022 * D.H, 6, 28); tg.scale(1, 1.25, 0.95); tg._shared = true; _mkGeo.set(key, tg); }
      ch.geometry = tg;
      const dir = new THREE.Vector3(Math.cos(D.neckAng), Math.sin(D.neckAng), 0);
      ch.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      ch.position.copy(dir).multiplyScalar(D.neckLen * 0.18);
      ch.scale.set(1, 1, 1);
      rig.bones[rig.table.BN.neck].add(ch);
      if (rig.pad) rig.pad.material = ch.material;
      break;
    }
    return L;
  }
  function massOf(t) {
    if (t._mass > 0) return t._mass;
    if (CBZ.bodyMass) { try { return CBZ.bodyMass(t); } catch (e) {} }
    return t.beast ? 150 : 78;
  }
  const PRED = /lion|tiger|leopard|cheetah|wolf|coyote|dog|bear|fox|shark|orca|megalodon|gorilla/;
  function kindOf(t) {
    if (t.vehicle) return "armour";
    if (!t.beast) return "man";
    const id = String(t.species && t.species.id || "");
    if (/horse|zebra/.test(id)) return "horse";
    if (PRED.test(id)) return /wolf|coyote|dog|fox/.test(id) ? "canid" : "predator";
    const ms = massOf(t);
    if (ms > 350) return "big";
    return "small";
  }
  function faceOf(t, out) {
    let h;
    if (t.vehicle) h = t.h != null ? t.h : (t.heading || 0);
    else if (t.beast) h = t.heading || 0;
    else { const y = t.yaw || 0; out.x = Math.sin(y); out.z = Math.cos(y); return out; }
    out.x = Math.cos(h); out.z = Math.sin(h); return out;
  }
  const _fo = { x: 0, z: 0 };

  // the nearest enemy, read off the live roster a few times a second
  function scan(m, L) {
    const R = SEAM.roster() || LIVE;
    let best = null, bd = 1e9, n = 0, armedNear = 0;
    for (let i = 0; i < R.length; i++) {
      const o = R[i];
      if (!o || o === m || o.dead || o.fled || o.team === m.team || o.inVeh) continue;
      const d = Math.hypot(o.pos.x - m.pos.x, o.pos.z - m.pos.z);
      if (d < 60) n++;
      if (d < 120 && !o.beast && !o.vehicle && o.armed) armedNear++;
      // a vehicle counts from further off (the noise), a predator from nearer
      const w = o.vehicle ? d * 0.6 : d;
      if (w < bd) { bd = w; best = o; }
    }
    L.threat = best; L.td = best ? Math.hypot(best.pos.x - m.pos.x, best.pos.z - m.pos.z) : 1e9;
    L.tkind = best ? kindOf(best) : null; L.nEnemy = n; L.armedNear = armedNear;
  }

  // ---- THE RIDE: claim a man, walk to him, he swings up; later he gets down
  function freeManNear(m, rad) {
    const R = SEAM.roster();
    if (!R) return null;
    let best = null, bd = rad;
    for (let i = 0; i < R.length; i++) {
      const o = R[i];
      if (!o || o.beast || o.vehicle || o.dead || o.fled || o.team !== m.team || o.inVeh || o._horse || o.you || o.routed) continue;
      if (o._claimedBy && o._claimedBy !== m && !o._claimedBy.dead) continue;
      const d = Math.hypot(o.pos.x - m.pos.x, o.pos.z - m.pos.z);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }
  const _v3 = { x: 0, y: 0, z: 0 };
  // the seat, in world space, off the CURRENT chest bone pose
  function seatWorld(m, rig, out) {
    const D = rig.D, cb = rig.bones[rig.table.BN.chest];
    const dx = D.seat.x - D.shX, dy = D.seat.y - D.sh, c = Math.cos(cb.rotation.z), s = Math.sin(cb.rotation.z);
    const lx = cb.position.x + dx * c - dy * s, ly = cb.position.y + dx * s + dy * c;
    const g = m.group, sc = g.scale.x, h = m.heading || 0;
    out.x = g.position.x + Math.cos(h) * lx * sc;
    out.z = g.position.z + Math.sin(h) * lx * sc;
    out.y = g.position.y + ly * sc;
    return out;
  }
  function riderPose(m, L, dt, k) {
    const R = L.rider, ch = R && R.char;
    if (!R || !R.group) return;
    const rig = L.rig, st = rig.st;
    seatWorld(m, rig, _v3);
    const hs = (R.group.userData && R.group.userData.humanScale) || 1;
    const hip = ((ch && ch.hipY) || 0.95) * hs;
    const h = m.heading || 0;
    // k < 1: swinging up from / down to the near (left) side
    const side = 1 - k, sx = Math.sin(h) * 0.85 * side, sz = -Math.cos(h) * 0.85 * side;
    const arc = Math.sin(PI * k) * 0.25;
    const gy = m.pos.y;
    R.group.position.set(_v3.x + sx, lerp(gy, _v3.y - hip, k) + arc, _v3.z + sz);
    R.group.rotation.set(0, PI / 2 - h, 0);
    R.yaw = PI / 2 - h;
    if (ch) {
      const air = rig.G.feet.every(function (f) { return f.sw; });
      ch.riding = k > 0.3 ? { width: 0.62 * rig.D.H * rig.D.Gt, moving: Math.abs(st.v) > 0.4, airborne: air, phase: rig.G.phase * TAU } : null;
      if (CBZ.animChar) { try { CBZ.animChar(ch, 0, dt); } catch (e) {} }
    }
  }
  function mount(m, man) {
    const L = brainOf(m);
    if (!L || L.rider || !man || man.dead || !SEAM.canRide()) return false;
    SEAM.lift(man);
    man.inVeh = null; man._horse = m; man._claimedBy = null;
    L.rider = man; L.claim = null; L.mountK = 0; L.mountDir = 1; L.warhorse = true;
    L.riderArmed = !!(man.armed && !man.fists);
    setTack(L.rig, true);
    if (man.group) man.group.visible = true;
    return true;
  }
  function dismount(m, opts) {
    const L = m && m._horse;
    if (!L || !L.rider) return null;
    const man = L.rider;
    L.rider = null; L.mountDir = 0; L.mountK = 0;
    man._horse = null;
    if (man.char) man.char.riding = null;
    // the near side, beside the shoulder
    const h = m.heading || 0, x = m.pos.x + Math.sin(h) * 1.0 + Math.cos(h) * 0.2, z = m.pos.z - Math.cos(h) * 1.0 + Math.sin(h) * 0.2;
    if (!SEAM.drop(man, x, z, h)) { man.pos.set(x, m.pos.y, z); }
    if (opts && opts.fall) {
      if (CBZ.verbs && CBZ.verbs.knockdown) { try { CBZ.verbs.knockdown(man, { dir: { x: Math.cos(h), z: Math.sin(h) }, power: 1, dur: 2.2 }); } catch (e) {} }
      man.ko = Math.max(man.ko || 0, 2.2);
      if (opts.fall > 0) SEAM.hurt(man, opts.fall, null);
    }
    return man;
  }

  // ---- the slow layer: wounds, stamina, nerve, what to do, how fast
  function brain(m, L, dt) {
    const rig = L.rig, st = rig.st, tn = m.tn, R = L.R;
    const vM = Math.abs(st.v);
    // STAMINA: a horse gallops ~2 minutes, canters for an hour
    if (vM > 9) L.sta -= dt * (vM - 8) / 140;
    else L.sta += dt * (vM < 4 ? 0.02 : 0.006);
    L.sta = clamp(L.sta, 0, 1);
    // WOUNDS: read off what the funnel took
    if (m.hp < L.lastHp) {
      let drop = L.lastHp - m.hp;
      // a rider is hit too: a share of what strikes the pair lands on him
      if (L.rider && !L.rider.dead && Math.random() < 0.33) {
        m.hp = Math.min(m.maxHp, m.hp + drop);
        const man = L.rider, dmgR = drop / Math.max(1, m.maxHp) * (man.maxHp || 120) * 1.3;
        if (man.hp - dmgR <= 0) { dismount(m, { fall: 0 }); SEAM.hurt(man, dmgR, null); }
        else man.hp -= dmgR;
        drop = 0;
      }
      if (drop > 0) {
        L.hitT = 0;
        L.stress = Math.min(2, L.stress + 0.5 + drop / m.maxHp * 4);
        const t = L.threat;
        let loc = Math.random(), side = Math.random() < 0.5 ? -1 : 1;
        loc = loc < 0.15 ? 0 : loc < 0.45 ? 1 : loc < 0.72 ? 3 : 2;
        if (t && L.td < 5) { const rel = wrapPi(Math.atan2(t.pos.z - m.pos.z, t.pos.x - m.pos.x) - (m.heading || 0)); side = rel > 0 ? 1 : -1; loc = Math.abs(rel) < 0.8 ? (Math.random() < 0.4 ? 0 : 1) : Math.abs(rel) > 2.2 ? 2 : 3; }
        const kk = clamp(drop / (m.maxHp * 0.15), 0.25, 1);
        st.fl.t = 0.5; st.fl.k = kk; st.fl.loc = loc; st.fl.side = side;
        if (loc === 1 || loc === 2) { const leg = (loc === 1 ? 0 : 2) + (side < 0 ? 0 : 1); L.inj[leg] = Math.min(1, L.inj[leg] + drop / m.maxHp * 1.6); }
      }
    }
    L.lastHp = m.hp;
    L.hitT += dt;
    // gunfire: m.supp rises with every round that cracks past (fire.js)
    L.stress = Math.max(0, L.stress + (m.supp || 0) * dt * 0.9 - dt * 0.12);
    L.scanT -= dt;
    if (L.scanT <= 0) { L.scanT = 0.35 + (m.i % 5) * 0.03; scan(m, L); }
    const hpF = m.maxHp > 0 ? m.hp / m.maxHp : 1;
    const lame = Math.max(L.inj[0], L.inj[1], L.inj[2], L.inj[3]);
    const ridden = !!L.rider && L.mountK > 0.95;
    let top = lerp(CANTER, ridden ? RIDDEN_TOP : R.top, sstep(0.05, 0.35, L.sta)) * (1 - 0.55 * lame) * (hpF < 0.35 ? 0.75 : 1) * Math.pow(m._sizeMul || 1, 0.25);
    const t = L.threat, d = L.td, kind = L.tkind;
    // a PLAYER is in this horse: move + attack are his (player.js), the nerve is not
    if (m.you) { L.mode = "you"; tn.prey = false; tn.brave = true; tn.chase = top; tn.march = TROT; L.lastMode = "you"; return; }
    // the battle's think stands down: this file is the horse's head
    m.thinkAt = 1e12;
    let mode = "stand", want = 0;
    const panic = L.stress > (ridden ? 1.3 : 0.55) || L.panicT > 0;
    if (L.panicT > 0) L.panicT -= dt;
    else if (ridden && L.stress > 1.3 && Math.random() < dt * 0.4) L.panicT = 2.5 + Math.random() * 3;   // bolts with him
    // ---- the claim: a loose horse on a side with men takes one up
    if (!L.rider && !L.claim && !L.dismounted && !L.warhorse && SEAM.canRide() && (L.claimT = (L.claimT || 0) - dt) <= 0) {
      L.claimT = 1.5;
      if (!t || d > 45) { const man = freeManNear(m, 30); if (man) { L.claim = man; man._claimedBy = m; } }
    }
    if (L.claim && (L.claim.dead || L.claim.inVeh || L.claim._horse || L.claim.fled || (t && d < 30))) { if (L.claim) L.claim._claimedBy = null; L.claim = null; }
    if (L.rider && L.rider.dead) { L.rider = null; }
    if (L.mountDir > 0 && L.rider) {
      // swinging up: stand still
      L.mountK = Math.min(1, L.mountK + dt / 1.1);
      if (L.mountK >= 1) L.mountDir = 0;
      mode = "stand";
    } else if (L.mountDir < 0 && L.rider) {
      L.mountK = Math.max(0, L.mountK - dt / 0.9);
      mode = "stand";
      if (L.mountK <= 0) { dismount(m); L.dismounted = true; L.ledT = 0; }
    } else if (L.claim) {
      mode = "toMount";
      const man = L.claim, dd = Math.hypot(man.pos.x - m.pos.x, man.pos.z - m.pos.z);
      m.target.set(man.pos.x, 0, man.pos.z); m.slot = "hold";
      man.target.set(m.pos.x, 0, m.pos.z);
      tn.march = dd > 8 ? TROT : WALK;
      if (dd < 2.2) { mount(m, man); }
    } else if (ridden) {
      // ---- CAVALRY
      if (panic && L.panicT > 0 && t) mode = "flee";
      else if (!t) mode = "march";
      else if (kind === "armour") mode = L.riderArmed ? "dismount" : "flee";
      else if (L.riderArmed && (d < 100 || (L.hitT < 3 && d < 220))) mode = "dismount";
      else mode = L.riderArmed ? "ride" : "charge";
    } else if (L.warhorse && L.dismounted) {
      // a led horse: back toward its own lines, out of the fight
      mode = t && d < 25 ? "flee" : "led";
    } else {
      // ---- A LOOSE HORSE: a prey animal's nerve
      const caught = t && d < (m.rad || 1) + (t.rad || 0.5) + 1.4 && (kind === "predator" || kind === "canid" || kind === "horse" || (kind === "man" && L.hitT < 2));
      const stallionStand = L.sex === "stallion" && t && kind === "canid" && d < 25 && hpF > R.quit;
      const flight = !t ? 0 : kind === "armour" ? 80 : kind === "predator" ? 70 : kind === "canid" ? 45 : kind === "horse" ? (L.sex === "stallion" ? 0 : 12) : (L.armedNear ? 45 : 22);
      if (caught && hpF > R.quit * 0.5) mode = "fight";
      else if (stallionStand) mode = "fight";
      else if (L.sex === "stallion" && kind === "horse" && d < 40 && hpF > R.quit) mode = "fight";
      else if (t && (d < flight || panic)) mode = "flee";
      else if (t && d < flight * 2.2) mode = "alert";
      else mode = "stand";
    }
    L.mode = mode;
    // ---- what the mode asks of the body
    const away = function (dist) {
      let ax = m.pos.x - (t ? t.pos.x : m.pos.x - 1), az = m.pos.z - (t ? t.pos.z : m.pos.z);
      const al = Math.hypot(ax, az) || 1; ax /= al; az /= al;
      // the herd runs together: lean toward own lines, keep the old line
      const hx = L.home.x - m.pos.x, hz = L.home.z - m.pos.z, hl = Math.hypot(hx, hz) || 1;
      ax += hx / hl * 0.35 + L.fleeX * 0.8; az += hz / hl * 0.35 + L.fleeZ * 0.8;
      const bl = Math.hypot(ax, az) || 1; ax /= bl; az /= bl;
      L.fleeX = ax; L.fleeZ = az;
      m.target.set(m.pos.x + ax * dist, 0, m.pos.z + az * dist);
    };
    m.tgt = null; m.slot = "hold"; m.state = "wander";
    tn.prey = !(mode === "fight" || mode === "charge" || mode === "ride");
    tn.brave = !tn.prey;
    switch (mode) {
      case "stand": case "alert":
        m.target.set(m.pos.x, 0, m.pos.z); want = 0; L.fleeX *= 0.9; L.fleeZ *= 0.9; break;
      case "toMount": want = tn.march; break;
      case "flee":
        away(30); m.slot = "fallback"; m.state = "flee"; want = top;
        L.fleeT += dt;
        if (!L.rider && (d > 180 || L.fleeT > 45) && !L.warhorse) { m.fled = true; if (m.group) m.group.visible = false; }
        break;
      case "led": {
        const hx = L.home.x - m.pos.x, hz = L.home.z - m.pos.z, hl = Math.hypot(hx, hz);
        if (hl > 4) { m.target.set(L.home.x, 0, L.home.z); want = hl > 20 ? TROT : WALK; } else m.target.set(m.pos.x, 0, m.pos.z);
        break;
      }
      case "fight":
        m.tgt = t; m.target.set(t.pos.x, 0, t.pos.z); m.slot = "push"; m.state = "charge"; want = d > 6 ? Math.min(top, 9) : 5;
        break;
      case "march": {
        // ridden, no enemy known: on toward the far side at a working trot
        const hx = m.pos.x - L.home.x, hz = m.pos.z - L.home.z;
        let dx = hx, dz = hz; const dl = Math.hypot(dx, dz);
        if (dl < 1) { dx = Math.cos(m.heading || 0); dz = Math.sin(m.heading || 0); } else { dx /= dl; dz /= dl; }
        m.target.set(m.pos.x + dx * 20, 0, m.pos.z + dz * 20); m.slot = "push"; want = TROT;
        break;
      }
      case "ride":
        m.target.set(t.pos.x, 0, t.pos.z); m.slot = "push"; want = d > 300 ? TROT : Math.min(top, CANTER + 1);
        break;
      case "dismount":
        m.target.set(m.pos.x, 0, m.pos.z); want = 0;
        if (vM < 1.2 && L.rider) { L.mountDir = -1; }
        break;
      case "charge":
        if (L.passT > 0) {
          L.passT -= dt;
          m.target.set(L.passX, 0, L.passZ); m.slot = "push"; want = top;
        } else { m.tgt = t; m.target.set(t.pos.x, 0, t.pos.z); m.slot = "push"; m.state = "charge"; want = d > 250 ? CANTER : top; }
        break;
    }
    if (mode !== "flee") L.fleeT = 0;
    // speed is earned: an acceleration, not a switch
    tn.chase = Math.max(1, Math.min(Math.max(want, 0.5), vM + ACCEL * Math.max(dt, 0.05) + 1.0));
    if (mode !== "toMount" && mode !== "led") tn.march = Math.max(0.5, Math.min(want || WALK, tn.chase));
    else tn.march = Math.max(0.5, want || WALK);
    // a fresh spook: the startle jump when the fear first lands
    if (mode === "flee" && L.lastMode !== "flee") L.spookT = 0.55;
    L.lastMode = mode;
    if (L.spookT > 0) L.spookT -= dt;
  }

  // =========================================================================
  //  ANIMATE (the battle's per-frame hook)
  // =========================================================================
  function animate(m, dt) {
    const L = brainOf(m);
    if (!L) return;
    if (!(dt > 0)) dt = 0.016;
    if (m.fled) { if (m.group) m.group.visible = false; return; }
    brain(m, L, Math.min(dt, 0.25));
    const rig = L.rig, c = rig.ctl, tnow = now();
    c.x = m.pos.x; c.z = m.pos.z; c.y = m.pos.y;
    c.heading = typeof m.heading === "number" ? m.heading : 0;
    c.ground = CBZ.floorAt || null;
    const t = L.threat, d = L.td;
    c.alert = t && d < 140 ? 1 : 0.2;
    c.aggr = L.mode === "fight" || L.mode === "charge" ? 0.8 : 0;
    c.fear = L.mode === "flee" ? 1 : clamp(L.stress * 0.6, 0, 0.8);
    c.tired = clamp(1 - L.sta * 1.3, 0, 1);
    c.rest = (L.mode === "stand" && (!t || d > 120) && !L.rider) ? 1 : 0;
    c.inj = L.inj;
    c.lookAt = t && d < 140 && L.mode !== "flee" ? t.pos : null;
    c.ridden = !!L.rider && L.mountK > 0.5;
    const fresh = tnow - L.fightAt < 0.3;
    if (!fresh && L.f !== "close") { L.f = "close"; L.fT = 0; }
    c.act = fresh && L.act.kind ? L.act : null;
    if (!c.act && L.spookT > 0) { L.act.kind = "spook"; L.act.p = 1 - L.spookT / 0.55; c.act = L.act; }
    pose(rig, dt, c);
    if (CBZ.faceAnimalHeading) CBZ.faceAnimalHeading(m, c.heading);
    if (L.rider) riderPose(m, L, dt, L.mountDir === 0 && L.mountK === 0 ? 1 : L.mountK);
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
  function knock(m, tgt, ux, uz, dur, metres) {
    if (!tgt.beast && !tgt.vehicle) {
      if (CBZ.verbs && CBZ.verbs.knockdown) { try { CBZ.verbs.knockdown(tgt, { dir: { x: ux, z: uz }, power: 1, dur: dur }); } catch (e) {} }
      tgt.ko = Math.max(tgt.ko || 0, dur);
    }
    const shove = Math.min(metres, 160 / Math.max(40, massOf(tgt)));
    if (shove > 0.05 && !tgt.vehicle) {
      tgt.pos.x += ux * shove; tgt.pos.z += uz * shove;
      if (CBZ.micro && CBZ.micro.resolveCircle) { try { CBZ.micro.resolveCircle(tgt.pos, tgt.rad || 0.45, tgt.pos.y, 1.8); } catch (e) {} }
    }
  }
  function slide(m, x, z, step) {
    m.pos.x += x * step; m.pos.z += z * step;
    if (CBZ.micro && CBZ.micro.resolveCircle) CBZ.micro.resolveCircle(m.pos, m.rad || 0.9, m.pos.y, 1.8);
    if (CBZ.floorAt) { const y = CBZ.floorAt(m.pos.x, m.pos.z); if (isFinite(y)) m.pos.y = y; }
  }
  function fight(m, tgt, dt, o) {
    RES.inRange = true; RES.dealt = 0; RES.missed = false;
    const L = brainOf(m);
    if (!L) return CBZ.creatureFight ? CBZ.creatureFight(m, tgt, dt, o) : RES;
    if (!tgt || tgt.dead) { go(L, "close"); return RES; }
    L.fightAt = now();
    const dx = tgt.pos.x - m.pos.x, dz = tgt.pos.z - m.pos.z, d = Math.hypot(dx, dz) || 1e-3, ux = dx / d, uz = dz / d;
    const H = L.rig.D.H * (m.group ? m.group.scale.x : 1);
    const tr = tgt.rad || 0.45;
    const front = 0.95 * H + tr, back = 0.95 * H + tr;      // nose / buttock from the centre, + the target
    const rel = wrapPi(Math.atan2(dz, dx) - (m.heading || 0)), arel = Math.abs(rel);
    if (L.kindTgt !== tgt) { L.kindTgt = tgt; L.kind = kindOf(tgt); }
    const kind = L.kind, R = L.R, rate = Math.max(0.3, o.rate || 1), base = (o.dmg || 85);
    const ridden = !!L.rider && L.mountK > 0.95;
    const downed = tgt.ko > 0 || (!tgt.beast && tgt.char && tgt.char.koPose);
    const speedNow = Math.abs(L.rig.st.v);
    L.fT += dt; L.cd -= dt;
    const Y = o.youMove || null;
    if (Y) {
      if (L.yMove !== Y || (m._atkAnim === 0 && L.yAge > 0.05)) {
        L.yMove = Y; L.yAge = 0;
        const map = { horse_kick: "kick", horse_cowkick: "cowkick", horse_strike: "strike", horse_rear: "rear", horse_bite: "bite", horse_trample: "trample", horse_ram: "ram" };
        go(L, map[Y.id] || (Y.style === "stomp" ? "kick" : "bite"));
      }
      L.yAge += dt;
    } else L.yMove = null;
    let want = Math.atan2(dz, dx), turnRate = 4.5;
    const act = L.act;
    act.side = rel > 0 ? 1 : -1;
    switch (L.f) {
      case "close": {
        act.kind = null;
        if (kind === "armour") { act.kind = "threat"; act.p = 0; slide(m, -ux, -uz, 3 * dt); break; }
        // the charge: a ridden horse arriving at speed bowls the man over and runs on
        if (ridden && speedNow > 5 && d < front + 0.8) { go(L, "ram"); break; }
        if (L.cd > 0) {
          // between blows a loose horse gives ground; it is not a fighter
          if (!ridden && d < front + 0.3 && kind !== "horse") slide(m, -ux, -uz, 1.5 * dt);
          act.kind = L.sex === "stallion" || kind === "canid" ? "threat" : null; act.p = 0;
          break;
        }
        if (downed && (ridden || L.sex === "stallion" || kind === "canid") && arel < 0.9) { if (d > front + 0.5) slide(m, ux, uz, 3 * dt); else go(L, "trample"); break; }
        if (arel > 2.15) { if (d < back + 0.9) go(L, "kick"); else slide(m, -ux, -uz, 2.0 * dt); break; }
        if (arel > 1.1 && d < 1.0 * H + tr + 0.5) { go(L, "cowkick"); break; }
        const fronter = ridden || L.sex === "stallion" || kind === "horse" || (kind === "canid" && L.sex !== "mare");
        if (fronter && arel < 0.7) {
          if (d > front + 0.6) { slide(m, ux, uz, Math.min(d - front, 4 * dt)); break; }
          go(L, (L.sex === "stallion" && (kind === "horse" || kind === "canid") && Math.random() < 0.45) ? "rear" : Math.random() < 0.6 ? "strike" : "bite");
          break;
        }
        // a mare / gelding: swing the hindquarters round to it
        go(L, "spin");
        break;
      }
      case "spin": {
        act.kind = "threat"; act.p = 0;
        want = Math.atan2(-dz, -dx); turnRate = 5;
        if (d > back + 0.5) slide(m, -ux, -uz, 1.6 * dt);
        if (arel > 2.4) go(L, d < back + 0.9 ? "kick" : "close");
        else if (L.fT > 1.4) go(L, arel > 1.1 ? "cowkick" : "bite");
        break;
      }
      case "kick": {
        const T = 0.85 / Math.sqrt(rate), p = L.fT / T;
        act.kind = "kick"; act.p = Math.min(1, p);
        want = Math.atan2(-dz, -dx); turnRate = 2;
        if (p >= 0.45 && !L.hitDone) {
          L.hitDone = true;
          if (d < back + 1.25 && arel > 1.9) {
            const dmg = base * R.kickK * (kind === "man" ? 1 : 0.9);
            strike(m, o, dmg);
            knock(m, tgt, ux, uz, 3, 2.5);
          } else RES.missed = true;
        }
        if (p >= 1) { go(L, "recover"); L.cd = 0.7 / rate; }
        break;
      }
      case "cowkick": {
        const T = 0.6, p = L.fT / T;
        act.kind = "cowkick"; act.p = Math.min(1, p); act.side = rel > 0 ? 1 : -1;
        turnRate = 1;
        if (p >= 0.42 && !L.hitDone) {
          L.hitDone = true;
          if (d < 1.0 * H + tr + 0.8) { strike(m, o, base * 0.55); knock(m, tgt, ux, uz, 1.6, 1.2); } else RES.missed = true;
        }
        if (p >= 1) { go(L, "recover"); L.cd = 0.5 / rate; }
        break;
      }
      case "rear": case "strike": {
        const rear = L.f === "rear", T = (rear ? 1.6 : 1.0) / Math.sqrt(rate), p = L.fT / T;
        act.kind = L.f; act.p = Math.min(1, p);
        if (rear) {
          if ((p >= 0.4 && L.hits === 0) || (p >= 0.62 && L.hits === 1)) {
            L.hits++;
            if (d < front + 0.7 && arel < 0.8) { strike(m, o, base * 0.4); if (L.hits === 2) knock(m, tgt, ux, uz, 2, 1); } else RES.missed = true;
          }
        } else if (p >= 0.62 && !L.hitDone) {
          L.hitDone = true;
          if (d < front + 0.8 && arel < 0.8) { strike(m, o, base * 0.55); knock(m, tgt, ux, uz, 2.2, 1.2); } else RES.missed = true;
        }
        if (p >= 1) { go(L, "recover"); L.cd = 0.5 / rate; }
        break;
      }
      case "bite": {
        const T = 0.55 / rate, p = L.fT / T;
        act.kind = "bite"; act.p = Math.min(1, p);
        if (p > 0.2 && p < 0.45 && d > front - 0.2) slide(m, ux, uz, 1.2 * dt);
        if (p >= 0.5 && !L.hitDone) {
          L.hitDone = true;
          if (d < front + 0.45 && arel < 0.9) strike(m, o, base * 0.22); else RES.missed = true;
        }
        if (p >= 1) { go(L, "recover"); L.cd = 0.45 / rate; }
        break;
      }
      case "trample": {
        const T = 1.1, p = L.fT / T;
        act.kind = "trample"; act.p = Math.min(1, p);
        if (d > front * 0.7) slide(m, ux, uz, 1.5 * dt);
        if (p >= 0.62 && !L.hitDone) {
          L.hitDone = true;
          if (d < front + 0.6) { strike(m, o, base * 0.4); if (!tgt.beast) tgt.ko = Math.max(tgt.ko || 0, 1.5); } else RES.missed = true;
        }
        if (p >= 1) { go(L, "recover"); L.cd = 0.4; }
        break;
      }
      case "ram": {
        // 500 kg at speed through a man: the damage is the speed's
        act.kind = "ram"; act.p = Math.min(1, L.fT / 0.4);
        if (!L.hitDone) {
          L.hitDone = true;
          const v = Math.max(speedNow, 4);
          if (d < front + 1.0) {
            const big = massOf(tgt) > 300;
            strike(m, o, Math.min(110, 5.8 * v) * (big ? 0.4 : 1));
            knock(m, tgt, ux, uz, 2.8, big ? 0.3 : 2.2);
            // the rider's own blow as he passes, carried by the horse's speed
            if (L.rider && !L.rider.dead) strike(m, o, (L.rider.punch || 10) * (1 + v / 5) * 0.8);
          } else RES.missed = true;
          // and on through: ride past, wheel, come again
          L.passT = 2.2; L.passX = m.pos.x + ux * 22; L.passZ = m.pos.z + uz * 22;
        }
        slide(m, ux, uz, Math.max(speedNow, 6) * dt);
        if (L.fT > 0.4) { go(L, "close"); L.cd = 0.8; }
        break;
      }
      case "recover": {
        act.kind = null;
        if (!ridden && L.fT < 0.5 && kind !== "horse") slide(m, -ux, -uz, 2.0 * dt);
        if (L.fT >= 0.35 / rate) go(L, "close");
        break;
      }
      default: go(L, "close");
    }
    if (Y) {
      const busy = L.f !== "close" && L.f !== "recover" && L.f !== "spin";
      if (!busy || L.yAge > 2.5) { m._atkAnim = -1; L.yMove = null; if (L.f !== "close") go(L, "close"); L.cd = 0; }
      else m._atkAnim = Math.min(0.99, 0.01 + L.yAge / 1.5);
    }
    let dh = wrapPi(want - (m.heading || 0));
    m.heading = (m.heading || 0) + clamp(dh, -turnRate * dt, turnRate * dt);
    m.faceH = m.heading;
    if (CBZ.faceAnimalHeading) CBZ.faceAnimalHeading(m, m.heading);
    RES.inRange = d < front + 1.2;
    return RES;
  }

  // WHAT A POSSESSED HORSE THROWS ON ATTACK (src/units/kit/moves.js contract)
  const YM = {
    horse_kick: { id: "horse_kick", style: "stomp", pow: 1, dur: 0.85, rng: 1.2, cd: 0.8 },
    horse_cowkick: { id: "horse_cowkick", style: "stomp", pow: 1, dur: 0.6, rng: 1.0, cd: 0.5 },
    horse_strike: { id: "horse_strike", style: "stomp", pow: 1, dur: 1.0, rng: 1.05, cd: 0.6 },
    horse_rear: { id: "horse_rear", style: "stomp", pow: 1, dur: 1.6, rng: 1.05, cd: 0.6 },
    horse_bite: { id: "horse_bite", style: "bite", pow: 1, dur: 0.55, rng: 1.0, cd: 0.45 },
    horse_trample: { id: "horse_trample", style: "stomp", pow: 1, dur: 1.1, rng: 1.05, cd: 0.5 },
    horse_ram: { id: "horse_ram", style: "ram", pow: 1, dur: 0.4, rng: 1.2, leap: 1.4, cd: 1.0 },
  };
  function moves(m, tgt, ctx) {
    ctx = ctx || {};
    const dist = ctx.dist == null ? 99 : ctx.dist, reach = ctx.reach || 2.5, n = ctx.n || 1;
    const running = !!ctx.sprint || (ctx.speed > 6);
    if (!tgt) return YM.horse_rear;
    if (ctx.downed) return YM.horse_trample;
    if (running && dist < reach * 2.5) return YM.horse_ram;
    const rel = Math.abs(wrapPi(Math.atan2(tgt.pos.z - m.pos.z, tgt.pos.x - m.pos.x) - (m.heading || 0)));
    if (rel > 2.0) return YM.horse_kick;
    if (rel > 1.1) return YM.horse_cowkick;
    return n % 3 === 0 ? YM.horse_bite : YM.horse_strike;
  }

  // a posed frame for tools (shot service): CBZ.horseKit.preview(unit, "kick", 0.5)
  const _pv = { kind: null, p: 0, side: 1 };
  function preview(m, kind, p, dt, o) {
    const L = brainOf(m);
    if (!L) return false;
    const rig = L.rig, c = rig.ctl;
    c.x = m.pos.x; c.z = m.pos.z; c.y = m.pos.y; c.heading = m.heading || 0; c.ground = CBZ.floorAt || null;
    c.alert = o && o.alert != null ? o.alert : 1; c.aggr = kind && kind !== "graze" && kind !== "rest" ? 0.6 : 0; c.act = null;
    c.fear = 0; c.tired = 0; c.rest = 0; c.ridden = !!(o && o.ridden);
    if (kind === "graze") { rig.st.idleT = 10; rig.st.t = 0; c.rest = 1; c.alert = 0; for (let i = 0; i < 60; i++) pose(rig, 1 / 20, c); return true; }
    if (kind === "rest") { rig.st.idleT = 10; rig.st.graze = 0; c.rest = 0; c.alert = 0; rig.st.t = 0.5; for (let i = 0; i < 60; i++) { pose(rig, 1 / 20, c); rig.st.graze = 0; } return true; }
    if (kind) { _pv.kind = kind; _pv.p = p; _pv.side = 1; c.act = _pv; }
    if (o && o.tack) setTack(rig, true);
    for (let i = 0; i < 14; i++) pose(rig, dt || 1 / 60, c);
    return true;
  }

  CBZ.horseKit = { STATS: STATS, REAL: REAL, dims: dims, build: build, animate: animate, fight: fight, moves: moves, preview: preview,
    pose: pose, mount: mount, dismount: dismount, setTack: setTack, LIVE: LIVE, gaitTable: gaitTable, SEAM: SEAM };
  if (CBZ.unitKit) {
    CBZ.unitKit.register("horse", {
      kind: "species", stats: STATS,
      build: build, animate: animate, fight: fight, moves: moves,
    });
  }
  if (typeof module !== "undefined" && module.exports) module.exports = { dims: dims, STATS: STATS };
})();
