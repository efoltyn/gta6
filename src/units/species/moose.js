/* ============================================================
   units/species/moose.js — THE MOOSE (Alces alces), as NPC War fights it.

   OWNED BY: the bison agent (the large ungulates). The engine (skeleton,
   gait, pose, brain, physical fight) is CBZ.ungulateKit in bison.js, which
   units/manifest.js's `needs` loads first; this file is the moose's body,
   coat, antlers, numbers and fighting habits.

   WHAT WAS HERE: the bestiary's box moose (city/wildlife/snow_ungulates.js)
   on the discovered box rig, hp 180, scale 1.4, creature_combat's GORE.

   THE ANIMAL (reference: A. a. americanus / andersoni; Franzmann 1981,
   Mammalian Species 154; Alaska Dept. of Fish & Game)
     bull  shoulder 1.95 m, nose to rump 2.9 m, ~600 kg, palmate antlers
           ~1.3 m spread, 20+ kg; cow 1.75 m, ~380 kg, no antlers
     LONG legs (the brisket sits 1.15 m up), a short deep body that slopes
     from the high withers to a low narrow rump, a short neck, a long heavy
     head with the bulbous overhanging muzzle, a hanging BELL (dewlap), big
     mobile ears, a tail you barely see. Near-black brown body, pale grey
     "stockings" below the knees and hocks.
     Top speed ~56 km/h (15.5 m/s) in short bursts; the TROT is its gait (it
     trots at speeds other deer gallop, stepping over deadfall).
   HOW IT FIGHTS (it injures more people in Alaska than bears do)
     the FRONT HOOVES: rears and chops down with both forefeet, then
     stomps whatever is on the ground, again and again; the hind kick; a
     bull also drives with the antlers. Warning: ears pinned back, hackles
     up along the neck and withers, head low, lip-licking. A healthy moose
     does not run from wolves: it stands and fights (wolves test it and
     leave). It does run from armour.
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W.CBZ || (W.CBZ = {});

  const STATS = {
    hp: 420, spd: 1.5, danger: 0.45, bite: 55, scale: 1,
    chase: 15, march: 4.5, dmg: 55, rate: 1.0,
    brave: true, prey: false,
    mass: 600, hide: 9, skull: 40, ribs: 22, plan: "quad",
  };
  const REAL = {
    male: { mass: 600, top: 15.5, cruise: 8.5, march: 4.5, accel: 4.5, sta: 45, recover: 0.9, hpK: 1, quit: 0.2, chargeAt: 28, turn: 3.6, weapon: "hooves" },
    female: { mass: 380, top: 15.5, cruise: 8.5, march: 4.5, accel: 5, sta: 50, recover: 1, hpK: 0.72, quit: 0.25, chargeAt: 24, turn: 4, weapon: "hooves" },
  };
  const COATS = [
    { body: 0x2c221b, back: 0x45362a, belly: 0x1c1712, neck: 0x34291f, head: 0x3d3128, muzzle: 0x55473a, leg: 0xaea392, legDark: 0x5a4e42 },
    { body: 0x241c16, back: 0x3a2e24, belly: 0x171310, neck: 0x2c231b, head: 0x352a21, muzzle: 0x4b3f33, leg: 0x9f9483, legDark: 0x4d4238 },
    { body: 0x3a2c20, back: 0x574332, belly: 0x231b14, neck: 0x433325, head: 0x4a3a2c, muzzle: 0x63523f, leg: 0xb9ae9c, legDark: 0x655645 },
  ];
  const FEAT = { nose: 0x2a231e, nostril: 0x080606, lip: 0x3a302a, eye: 0x140e0a, lid: 0x1a140f, hoof: 0x1f1b18, earIn: 0x8a7a68,
    antler: 0x8c7658, palm: 0x9f8a68, tip: 0xddd3bd, bell: 0x241c15 };

  function dims(sex) {
    const male = sex === "male";
    const H = male ? 1 : 0.9, Gt = male ? 1 : 0.88, Hs = male ? 1 : 0.92;
    const g = H * Gt;
    const D = { sex: sex, male: male, H: H, Gt: Gt, Hs: Hs };
    D.withers = 1.97 * H;
    D.hipX = -0.72 * H; D.hipH = 1.6 * H; D.shX = 0.45 * H; D.sh = 1.62 * H;
    D.HJ = { x: -0.72 * H, y: 1.45 * H }; D.FJ = { x: 0.5 * H, y: 1.36 * H };
    D.fa = 0.40 * H; D.fb = 0.50 * H; D.fc = 0.36 * H; D.fh = 0.15 * H;
    D.ha = 0.46 * H; D.hb = 0.52 * H; D.hc = 0.45 * H; D.hh = 0.15 * H;
    D.pdx = 0.055 * H; D.hoofK = 1.15; D.lk = 0.98 * g; D.lkh = 0.98 * g;
    D.legZf = 0.17 * H; D.legZh = 0.16 * H;
    // short deep barrel: low narrow rump rising to the high muscular withers
    const rows = [
      [-1.08, 1.60, 0.12, 0.14, 0.13, 0, 0.9],
      [-1.0, 1.58, 0.2, 0.25, 0.24, 0, 0.92],
      [-0.85, 1.57, 0.22, 0.33, 0.31, 0, 0.92],
      [-0.6, 1.56, 0.24, 0.38, 0.34, 0, 0.92],
      [-0.3, 1.56, 0.28, 0.4, 0.36, 0, 0.92],
      [0.0, 1.58, 0.32, 0.42, 0.36, 0.3, 0.92],
      [0.24, 1.6, 0.37, 0.44, 0.34, 0.7, 0.9],
      [0.42, 1.62, 0.35, 0.44, 0.31, 1, 0.88],
      [0.58, 1.62, 0.28, 0.4, 0.26, 0.7, 0.9],
      [0.68, 1.63, 0.2, 0.3, 0.21, 0.3, 0.92],
    ];
    D.TOR = rows.map(function (r) { return [r[0] * H, r[1] * H, r[2] * g, r[3] * g, r[4] * g, r[5], r[6]]; });
    D.NECK = [
      [0.6, 1.67, 0.26, 0.34, 0.22, 0.95, 0.9],
      [0.78, 1.73, 0.22, 0.3, 0.2, 0.95, 0.8],
      [0.93, 1.79, 0.17, 0.22, 0.16, 0.95, 0.4],
      [1.02, 1.82, 0.14, 0.16, 0.14, 0.95, 0],
    ].map(function (r) { return [r[0] * H, r[1] * H, r[2] * g, r[3] * g, r[4] * g, r[5], r[6]]; });
    D.headP = { x: 1.02 * H, y: 1.82 * H };
    D.headAng = -0.78;
    // the long heavy head and the bulbous, overhanging nose
    D.HEAD = [
      [-0.06, 0.0, 0.12, 0.13, 0.12, 1],
      [0.04, 0.0, 0.13, 0.13, 0.135, 0.95],
      [0.14, 0.0, 0.12, 0.12, 0.13, 0.9],
      [0.26, -0.01, 0.1, 0.11, 0.1, 0.85],
      [0.38, -0.01, 0.09, 0.105, 0.088, 0.85],
      [0.5, 0.0, 0.105, 0.115, 0.095, 0.8],
      [0.6, 0.0, 0.118, 0.125, 0.1, 0.75],
      [0.68, -0.025, 0.1, 0.11, 0.09, 0.8],
      [0.72, -0.055, 0.06, 0.065, 0.065, 0.85],
    ];
    D.nostril = [0.69, 0.0, 0.055, 0.02, 0.026];
    D.jaw = [0.22, -0.1, 0.62, -0.13];
    D.jawR = [[0.03, 0.028, 0.024, 0.02], [0.05, 0.045, 0.038, 0.03], [0.085, 0.075, 0.06, 0.05]];
    D.eye = { d: 0.18, h: 0.035, z: 0.105, r: 0.02 };
    D.ear = { d: 0.03, h: 0.02, z: 0.1, len: 0.27, w: 0.075, dir: [-0.35, 0.35, 0.85] };
    D.tailP = { x: -1.07 * H, y: 1.7 * H }; D.tailL = 0.12 * H; D.tailR = 0.035 * g;
    D.tailProf = [1, 0.9, 0.8, 0.7, 0.5];
    D.humpP = { x: 0.35 * H, y: 1.8 * H };
    D.hackleP = { x: 0.82 * H, y: 1.9 * H };
    D.lieC = 0.72; D.lieP = 0.66;
    D.bsR = 2.6 * H;
    return D;
  }

  function colour(D, V) {
    const P = COATS[V.tint], F = FEAT, H = D.H, Hs = D.Hs;
    const hpX = D.headP.x, hpY = D.headP.y, ux = D.u.x, uy = D.u.y, nx = D.n.x, ny = D.n.y;
    const U = CBZ.ungulateKit.util, cmix = U.cmix, cmul = U.cmul, nz = U.nz, sstep = U.sstep;
    function grain(c, x, y, z, a) { return cmul(c, 1 + nz(x / H, y / H, z / H) * a); }
    // the pale stockings: dark above the knee/hock, grey-white below
    function legC(y) { return cmix(P.legDark, P.leg, sstep(0.95 * H, 0.65 * H, y)); }
    return function (part, x, y, z, ca, sa, t) {
      switch (part) {
        case "torso": {
          let c = cmix(P.body, P.back, sstep(0.4, 0.95, ca) * 0.7 * sstep(-0.4 * H, 0.4 * H, x));
          if (ca < -0.3) c = cmix(c, P.belly, sstep(-0.3, -0.8, ca));
          return grain(c, x, y, z, 0.07);
        }
        case "neck": return grain(cmix(P.neck, P.back, sstep(0.3, 0.95, ca) * 0.5), x, y, z, 0.08);
        case "head": {
          const dx = x - hpX, dy = y - hpY, d = (dx * ux + dy * uy) / Hs, h = (dx * nx + dy * ny) / Hs;
          if (d > 0.66 && h > -0.03) return F.nose;
          if (d > 0.62 && h < -0.04) return F.lip;
          let c = cmix(P.head, P.muzzle, sstep(0.25, 0.5, d));
          if (d < 0.12 && h > 0.06) c = cmix(c, P.back, 0.4);
          return grain(c, x, y, z, 0.07);
        }
        case "jaw": return ca > 0.45 ? 0x5a3a36 : cmix(P.muzzle, P.head, 0.3);
        case "nostril": return F.nostril;
        case "eye": return F.eye;
        case "lid": return F.lid;
        case "ear": return cmix(P.head, P.neck, 0.3);
        case "earIn": return F.earIn;
        case "tail": return P.body;
        case "bell": return grain(F.bell, x, y, z, 0.12);
        case "upper": case "thigh": return grain(cmix(P.body, P.belly, 0.3), x, y, z, 0.06);
        case "fore": case "gaskin": return grain(legC(y), x, y, z, 0.05);
        case "cannon": case "pastern": return grain(P.leg, x, y, z, 0.04);
        case "hoof": return F.hoof;
        case "antler": return cmix(F.antler, F.tip, sstep(0.75, 1, t));
        case "palm": return grain(cmix(F.palm, F.antler, Math.abs(sa) * 0.4), x, y, z, 0.1);
        case "tine": return cmix(F.palm, F.tip, sstep(0.3, 1, t));
      }
      return P.body;
    };
  }

  /* THE PALMATE RACK: a short beam out of the pedicle, then two palms —
     a broad rear palm swept out, back and up, and a smaller brow palm
     forward — dished like hands, with tines along their outer rims. */
  function antlers(X) {
    const D = X.D, Hs = D.Hs, V = X.V, U = CBZ.ungulateKit.util;
    const size = [0.82, 1.0, 1.15][V.rack];
    const nT = [7, 9, 11][V.rack];
    for (let s = -1; s <= 1; s += 2) {
      const B = D.hp(0.04, 0.1);
      const b0 = [B.x, B.y, s * 0.085 * Hs];
      const b1 = [B.x - 0.02, B.y + 0.04 * size, s * (0.085 + 0.14 * size)];
      // the beam (thick, burred at the base)
      X.sweep([b0, [lerp(b0[0], b1[0], 0.5), lerp(b0[1], b1[1], 0.5), lerp(b0[2], b1[2], 0.5)], b1],
        [[0.045, 0.045], [0.04, 0.038], [0.045, 0.035]], 10, "antler", [0, 1, 0]);
      // the main palm: a dish running out and back, cupped upward
      const len = 0.55 * size, wid = 0.2 * size;
      const spine = U.curve([b1, [b1[0] - 0.12 * size, b1[1] + 0.1 * size, b1[2] + s * 0.2 * size],
        [b1[0] - 0.24 * size, b1[1] + 0.22 * size, b1[2] + s * 0.38 * size], [b1[0] - 0.3 * size, b1[1] + 0.36 * size, b1[2] + s * len]], 8);
      const prad = [];
      for (let i = 0; i < spine.length; i++) { const t = i / (spine.length - 1); prad.push([wid * (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.08))), 0.022 * size]); }
      X.sweep(spine, prad, 12, "palm", [-0.6, 0.55, 0]);
      // tines along the rim: up and out off the far edge of the palm
      for (let i = 0; i < nT; i++) {
        const t = 0.25 + 0.75 * i / (nT - 1), a = X.along(spine, t), w = wid * (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.08)));
        const nrm = U.v3n([-0.6, 0.55, 0]);
        const at = [a.p[0] + nrm[0] * w * 0.95, a.p[1] + nrm[1] * w * 0.95, a.p[2] + nrm[2] * w * 0.95];
        const dir = [nrm[0] * 0.6 + a.t[0] * 0.3, nrm[1] * 0.6 + a.t[1] * 0.3 + 0.35, nrm[2] * 0.6 + a.t[2] * 0.3];
        X.tine(at, dir, (0.08 + 0.07 * Math.sin(i * 2.3 + V.rack)) * size, 0.022 * size, null, "tine");
      }
      // the brow palm: smaller, forward and out
      const fp = U.curve([b1, [b1[0] + 0.1 * size, b1[1] + 0.05 * size, b1[2] + s * 0.12 * size], [b1[0] + 0.18 * size, b1[1] + 0.12 * size, b1[2] + s * 0.22 * size]], 6);
      const frad = fp.map(function (p, i) { const t = i / (fp.length - 1); return [0.07 * size * (0.5 + 0.5 * Math.sin(Math.PI * Math.min(1, t + 0.15))), 0.02 * size]; });
      X.sweep(fp, frad, 10, "palm", [0.3, 0.8, 0]);
      for (let i = 0; i < 3; i++) {
        const a = X.along(fp, 0.55 + 0.2 * i);
        X.tine([a.p[0], a.p[1] + 0.03 * size, a.p[2]], [0.5, 0.7, s * 0.3], 0.08 * size, 0.018 * size, null, "tine");
      }
    }
  }
  function lerp(a, b, t) { return a + (b - a) * t; }

  const SPEC = {
    id: "moose", salt: 0x4005e, STATS: STATS, REAL: REAL, herd: false,
    sexOf: function (idx) { return idx % 2 === 0 ? "male" : "female"; },
    variant: function (sex, r) { const tint = Math.floor(r() * COATS.length), rack = Math.floor(r() * 3); return { tint: tint, rack: rack, key: tint + "|" + (sex === "male" ? rack : 0) }; },
    dims: dims,
    gait: function (D, base) {
      const k = Math.sqrt(D.K);
      return Object.assign({}, base, {
        gaits: [
          { name: "walk", key: "wW", off: [0.25, 0.75, 0.00, 0.50], duty: 0.66, lift: 0.07 },
          { name: "trot", key: "wT", off: [0.25, 0.75, -0.25, 0.25], duty: 0.42, lift: 0.1 },        // the moose's gait
          { name: "gallop", key: "wG", off: [0.10, 0.30, -0.35, -0.20], duty: 0.28, lift: 0.1 },
        ],
        trans: [[1.6 / k, 2.3 / k], [9.0 / k, 10.5 / k]],
        fMax: 2.2 * k, f0: 0.85 * k, fV: 0.38 * k, strideMax: 1.9,
        vMove: 0.12, turnMove: 0.35, turnF: 1.2,
        settleRate: 1.8, restLift: 0.04, restStep: 0.07,
      });
    },
    colour: colour,
    look: {
      neck0: 0, alertNeck: 0.15, walkNeck: 0.05, trotNeck: 0.02, gallopNeck: 0.1, lieNeck: 0.1, nod: 0.03, gallopNod: 0.07,
      trotBounce: 0.016, gallopRock: 0.08, carpusFold: 1.9,
      chargeNeck: 0.25, chargeHead: 0.25, chargeHeadAt: 15, hackleAggr: 1, aggrEars: 1,
      threatNeck: -0.2, threatHead: 0.0, threatSwing: 0.05, threatEars: 1, threatPaw: false, tailThreat: 0.3,
      bellowNeck: 0.25, bellowHead: 0.4, grazeNeck: 0.35, grazeHead: 0.3,   // a browser: it reaches UP
      rearRise: 0.5, rearPitch: 0.6,
      tailHang: 1.2, tailRunLift: 0.2, tailUpLift: 0.8, tailCurl: 0.2, tailCharge: 0.3, tailFlee: 0.4,
    },
    neckHair: function (X) {
      // the mane along the top of the neck stands up with the hackles
      return X.hairFn(0.07, 1.1, function (t, ca) { return ca > 0.6 ? 1 : 0; });
    },
    torsoHair: function (X) {
      const H = X.D.H;
      return X.hairFn(0.05, 0.3, function (t, ca, sa, x) { return ca > 0.7 && x > 0.1 * H ? 1 : 0; });
    },
    extras: function (X) {
      const D = X.D, BN = X.BN, Hs = D.Hs;
      // THE BELL: a pendant of hide and hair under the throat
      const b0 = D.hp(0.12, -0.13), bl = (D.male ? 0.3 : 0.14) * Hs;
      const pts = [], rad = [];
      for (let i = 0; i < 6; i++) {
        const t = i / 5;
        pts.push([b0.x - 0.02 * t, b0.y - bl * t, 0]);
        rad.push([(0.06 - 0.025 * t + 0.015 * Math.sin(Math.PI * t)) * Hs, (0.025 - 0.01 * t) * Hs]);
      }
      const v0 = X.G.n;
      X.sweep(pts, rad, 10, "bell", [1, 0, 0], [BN.neck1, 0.5, BN.head, 0.5]);
      X.displace(v0, 10, X.hairFn(0.15, 2.2, function (t) { return t; }));
      if (D.male) antlers(X);
    },
    nerve: function (m, L, hd, o) {
      // it does not run from wolves; it runs from tanks, and when beaten
      if (o.tgt && o.tgt.vehicle && (L.dmgEma > 1 || o.close < 40)) return "flee";
      return "fight";
    },
    blows: {
      hook: [0.12, 5.0, 1.8],
      butt: [0.18, 4.0, 1.0],
      antler: [0.13, 5.5, 1.9],     // a bull's drive and twist with the palms
      strike: [0.25, 5.2, 1.6],     // both forefeet, the edge of the hoof
      stomp: [0.35, 4.2, 1.5],
      kick: [0.22, 6.5, 1.4],
      spar: [0.3, 2.0, 0.8],
    },
    ramSharp: 1.1, hookToss: 0.2, mockCharge: true, passThrough: 1.5,
    pick: function (L, m, tgt, c) {
      if (c.downed) return "stomp";
      if (c.behind && c.d < c.keep + 1.2 && Math.random() < 0.5) return "kick";
      if (c.kind === "rival" && L.male) return Math.random() < 0.5 ? "spar" : "antler";
      if (c.kind === "man" && c.d > c.keep + 2.5 && Math.random() < 0.3) return "charge";
      if (L.male && Math.random() < 0.3) return "antler";
      return "strike";
    },
    moveAct: { moose_charge: "charge", moose_strike: "strike", moose_stomp: "stomp", moose_kick: "kick", moose_antler: "antler" },
    YM: {
      moose_charge: { id: "moose_charge", style: "ram", pow: 1, dur: 1.2, rng: 1.2, leap: 1.2, cd: 1.0 },
      moose_strike: { id: "moose_strike", style: "stomp", pow: 1, dur: 1.1, rng: 1.1, cd: 0.45 },
      moose_stomp: { id: "moose_stomp", style: "stomp", pow: 1, dur: 1.0, rng: 1.05, cd: 0.4 },
      moose_kick: { id: "moose_kick", style: "stomp", pow: 1, dur: 0.75, rng: 1.1, cd: 0.6 },
      moose_antler: { id: "moose_antler", style: "gore", pow: 1, dur: 0.8, rng: 1.05, cd: 0.45 },
    },
    ymDefault: "moose_strike", ymCharge: "moose_charge", ymStomp: "moose_stomp", ymKick: "moose_kick",
    ymRotation: function (L, n) { return L.male && n % 3 === 0 ? "moose_antler" : "moose_strike"; },
  };

  const K = function () { return CBZ.ungulateKit || null; };
  let _def = null;
  const D = function () { return _def || (K() ? (_def = K().def(SPEC)) : null); };
  CBZ.unitKit.register("moose", {
    kind: "species", stats: STATS,
    build: function (ctx) { const d = D(); return d ? d.build(ctx) : null; },
    animate: function (m, dt) { const k = K(); if (k) k.animate(m, dt); },
    moves: function (m, tgt, ctx) { const k = K(); return k ? k.moves(m, tgt, ctx) : null; },
    fight: function (m, tgt, dt, o) { const k = K(); return k ? k.fight(m, tgt, dt, o) : CBZ.creatureFight(m, tgt, dt, o); },
  });
})();
