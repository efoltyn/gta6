/* ============================================================
   units/species/elk.js — THE ELK / WAPITI (Cervus canadensis), as NPC War
   fights it.

   OWNED BY: the bison agent (the large ungulates). The engine is
   CBZ.ungulateKit in bison.js (loaded first through units/manifest.js's
   `needs`); this file is the elk's body, coat, antlers, numbers and habits.

   WHAT WAS HERE: the bestiary's box elk (city/wildlife/forest_deer.js), hp
   75, a prey flag: it ran from everything and fought nothing, ever.

   THE ANIMAL (reference: Rocky Mountain elk; Geist 1998, Deer of the World)
     bull  shoulder 1.5 m, nose to rump 2.4 m, ~330 kg; cow 1.3 m, ~230 kg
     a level back, a long neck carried up, a dark chocolate shaggy MANE on
     the neck, dark head and legs, a pale tan body and the buff RUMP PATCH
     edged in dark brown. Bulls carry a 6x6 rack: a main beam sweeping up
     and back ~1.2 m, the brow and bez tines low over the face, the trez,
     the long royal (the "dagger"), then the fork at the top.
     Top speed ~65 km/h (18 m/s); a herd flees together.
   HOW IT FIGHTS
     it runs. A herd under threat bunches and flees as one, white rumps
     flashing. Caught, or run to a standstill, it turns at bay: cows box
     with the forefeet (rear and strike), bulls drop the rack and drive it
     in and twist, and both kick what comes at their hindquarters. Bulls
     spar antler to antler with rivals.
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W.CBZ || (W.CBZ = {});

  const STATS = {
    hp: 260, spd: 2.4, danger: 0.15, bite: 35, scale: 1,
    chase: 18, march: 4, dmg: 35, rate: 1.1,
    brave: false, prey: true,
    mass: 330, hide: 6, skull: 28, ribs: 18, plan: "quad",
  };
  const REAL = {
    male: { mass: 330, top: 18, cruise: 9, march: 4, accel: 6.5, sta: 40, recover: 1, hpK: 1, quit: 0.3, chargeAt: 0, turn: 5, weapon: "antlers" },
    female: { mass: 230, top: 18.5, cruise: 9, march: 4, accel: 7, sta: 45, recover: 1.1, hpK: 0.8, quit: 0.4, chargeAt: 0, turn: 5.5, weapon: "hooves" },
  };
  const COATS = [
    { body: 0xb38b5c, flank: 0xa47c4e, back: 0x9c7448, mane: 0x4a3222, head: 0x6b4b33, leg: 0x3e2b1e, belly: 0x3d2b20, rump: 0xe2cf9f, rim: 0x3a2a1c, muzzle: 0x3a2c22 },
    { body: 0xa77f52, flank: 0x977045, back: 0x8f6a42, mane: 0x3f2a1c, head: 0x5f432e, leg: 0x36261a, belly: 0x36271c, rump: 0xd9c493, rim: 0x33251a, muzzle: 0x33271e },
    { body: 0xc29a6a, flank: 0xb08858, back: 0xa8804f, mane: 0x553a28, head: 0x765438, leg: 0x463222, belly: 0x463325, rump: 0xead9ac, rim: 0x41301f, muzzle: 0x403126 },
  ];
  const FEAT = { nose: 0x1e1814, nostril: 0x070505, lip: 0x2a221c, eye: 0x150e09, lid: 0x1a120c, hoof: 0x1e1a17, earIn: 0xc0aa8a, antler: 0x6e5236, tip: 0xece3cc };

  function dims(sex) {
    const male = sex === "male";
    const H = male ? 1 : 0.87, Gt = male ? 1 : 0.9, Hs = male ? 1 : 0.9;
    const g = H * Gt;
    const D = { sex: sex, male: male, H: H, Gt: Gt, Hs: Hs };
    D.withers = 1.5 * H;
    D.hipX = -0.62 * H; D.hipH = 1.22 * H; D.shX = 0.45 * H; D.sh = 1.2 * H;
    D.HJ = { x: -0.62 * H, y: 1.15 * H }; D.FJ = { x: 0.48 * H, y: 1.04 * H };
    D.fa = 0.34 * H; D.fb = 0.4 * H; D.fc = 0.28 * H; D.fh = 0.11 * H;
    D.ha = 0.4 * H; D.hb = 0.45 * H; D.hc = 0.37 * H; D.hh = 0.11 * H;
    D.pdx = 0.045 * H; D.hoofK = 0.88; D.lk = 0.82 * g; D.lkh = 0.85 * g;
    D.legZf = 0.15 * H; D.legZh = 0.14 * H;
    const rows = [
      [-0.9, 1.24, 0.13, 0.15, 0.13, 0, 0.9],
      [-0.84, 1.23, 0.2, 0.24, 0.22, 0, 0.92],
      [-0.7, 1.22, 0.24, 0.32, 0.27, 0, 0.92],
      [-0.45, 1.2, 0.25, 0.34, 0.28, 0, 0.92],
      [-0.15, 1.2, 0.28, 0.35, 0.3, 0, 0.92],
      [0.15, 1.21, 0.3, 0.38, 0.3, 0.4, 0.92],
      [0.35, 1.22, 0.3, 0.4, 0.28, 0.8, 0.9],
      [0.52, 1.24, 0.26, 0.38, 0.24, 0.6, 0.9],
      [0.64, 1.28, 0.2, 0.3, 0.19, 0.2, 0.92],
    ];
    D.TOR = rows.map(function (r) { return [r[0] * H, r[1] * H, r[2] * g, r[3] * g, r[4] * g, r[5], r[6]]; });
    // the long neck, carried up at ~45 degrees, maned underneath
    D.NECK = [
      [0.56, 1.33, 0.24, 0.3, 0.2, 0.95, 0.3],
      [0.71, 1.5, 0.19, 0.26, 0.16, 0.95, 0.6],
      [0.86, 1.66, 0.15, 0.2, 0.13, 0.95, 0.5],
      [0.97, 1.79, 0.12, 0.14, 0.115, 0.95, 0],
    ].map(function (r) { return [r[0] * H, r[1] * H, r[2] * g, r[3] * g, r[4] * g, r[5], r[6]]; });
    D.headP = { x: 0.97 * H, y: 1.79 * H };
    D.headAng = -0.6;
    D.HEAD = [
      [-0.05, 0.0, 0.1, 0.11, 0.1, 1],
      [0.04, 0.0, 0.11, 0.11, 0.115, 0.95],
      [0.13, 0.0, 0.1, 0.1, 0.11, 0.9],
      [0.24, -0.01, 0.08, 0.09, 0.08, 0.85],
      [0.35, -0.01, 0.066, 0.08, 0.066, 0.85],
      [0.45, -0.01, 0.06, 0.07, 0.06, 0.8],
      [0.52, -0.02, 0.048, 0.054, 0.055, 0.8],
    ];
    D.nostril = [0.51, -0.01, 0.035, 0.012, 0.016];
    D.jaw = [0.15, -0.08, 0.47, -0.07];
    D.jawR = [[0.025, 0.022, 0.018, 0.014], [0.04, 0.036, 0.028, 0.022], [0.07, 0.06, 0.045, 0.035]];
    D.eye = { d: 0.15, h: 0.03, z: 0.088, r: 0.019 };
    D.ear = { d: 0.03, h: 0.03, z: 0.08, len: 0.2, w: 0.06, dir: [-0.3, 0.6, 0.75] };
    D.tailP = { x: -0.9 * H, y: 1.38 * H }; D.tailL = 0.14 * H; D.tailR = 0.04 * g;
    D.tailProf = [1, 1, 0.9, 0.75, 0.5];
    D.humpP = { x: 0.35 * H, y: 1.4 * H };
    D.hackleP = { x: 0.75 * H, y: 1.55 * H };
    D.lieC = 0.58; D.lieP = 0.52;
    D.bsR = 2.4 * H;
    return D;
  }

  function colour(D, V) {
    const P = COATS[V.tint], F = FEAT, H = D.H, Hs = D.Hs;
    const hpX = D.headP.x, hpY = D.headP.y, ux = D.u.x, uy = D.u.y, nx = D.n.x, ny = D.n.y;
    const U = CBZ.ungulateKit.util, cmix = U.cmix, cmul = U.cmul, nz = U.nz, sstep = U.sstep;
    function grain(c, x, y, z, a) { return cmul(c, 1 + nz(x / H, y / H, z / H) * a); }
    return function (part, x, y, z, ca, sa, t) {
      switch (part) {
        case "torso": {
          // the buff rump patch with its dark rim, the tan body, the dark belly and the mane at the shoulders
          const rp = sstep(-0.55 * H, -0.78 * H, x) * sstep(-0.6, 0.1, ca);
          let c = cmix(P.body, P.back, sstep(0.5, 0.95, ca) * 0.5);
          if (ca < -0.1) c = cmix(c, P.flank, sstep(-0.1, -0.4, ca));
          if (ca < -0.45) c = cmix(c, P.belly, sstep(-0.45, -0.8, ca));
          const rim = sstep(-0.48 * H, -0.56 * H, x) * (1 - sstep(-0.6 * H, -0.68 * H, x)) * sstep(-0.5, 0.2, ca);
          c = cmix(c, P.rim, rim * 0.7);
          c = cmix(c, P.rump, rp);
          c = cmix(c, P.mane, sstep(0.45 * H, 0.62 * H, x));
          return grain(c, x, y, z, 0.05);
        }
        case "neck": return grain(cmix(P.mane, P.head, sstep(0.0, 0.9, ca) * 0.25), x, y, z, 0.1);
        case "head": {
          const dx = x - hpX, dy = y - hpY, d = (dx * ux + dy * uy) / Hs, h = (dx * nx + dy * ny) / Hs;
          if (d > 0.48 && h > -0.03) return F.nose;
          if (d > 0.44 && h < -0.04) return F.lip;
          return grain(cmix(P.head, P.muzzle, sstep(0.25, 0.45, d)), x, y, z, 0.06);
        }
        case "jaw": return ca > 0.45 ? 0x5a3a36 : (t > 0.75 ? F.lip : cmix(P.muzzle, P.head, 0.4));
        case "nostril": return F.nostril;
        case "eye": return F.eye;
        case "lid": return F.lid;
        case "ear": return cmix(P.head, P.body, 0.3);
        case "earIn": return F.earIn;
        case "tail": return P.rump;
        case "upper": return grain(cmix(P.mane, P.leg, 0.4), x, y, z, 0.05);
        case "thigh": return grain(cmix(P.flank, P.rump, sstep(-0.3, -0.9, ca) * 0.6), x, y, z, 0.05);
        case "fore": case "gaskin": case "cannon": case "pastern": return grain(P.leg, x, y, z, 0.05);
        case "hoof": return F.hoof;
        case "antler": case "tine": return grain(cmix(F.antler, F.tip, sstep(0.72, 1, t)), x, y, z, 0.08);
      }
      return P.body;
    };
  }

  /* THE 6x6 RACK: the main beam from the pedicle up and back, curling in at
     the top; brow and bez tines low and forward over the face, the trez, the
     long royal, and the fork at the end. */
  function antlers(X) {
    const D = X.D, Hs = D.Hs, V = X.V, U = CBZ.ungulateKit.util;
    const sz = [0.8, 1.0, 1.12][V.rack];
    for (let s = -1; s <= 1; s += 2) {
      const B = D.hp(0.04, 0.085);
      const b0 = [B.x, B.y, s * 0.06 * Hs];
      const cp = [
        b0,
        [b0[0] - 0.02 * sz, b0[1] + 0.14 * sz, b0[2] + s * 0.1 * sz],
        [b0[0] - 0.16 * sz, b0[1] + 0.42 * sz, b0[2] + s * 0.26 * sz],
        [b0[0] - 0.36 * sz, b0[1] + 0.66 * sz, b0[2] + s * 0.36 * sz],
        [b0[0] - 0.56 * sz, b0[1] + 0.84 * sz, b0[2] + s * 0.34 * sz],
        [b0[0] - 0.66 * sz, b0[1] + 1.0 * sz, b0[2] + s * 0.24 * sz],
      ];
      const beam = U.curve(cp, 14), rad = [];
      for (let i = 0; i < beam.length; i++) { const t = i / (beam.length - 1), r = (0.038 - 0.026 * t) * sz; rad.push([r, r * 0.9]); }
      X.sweep(beam, rad, 9, "antler", [1, 0, 0]);
      // tines: [where on the beam, direction, length]
      const T = [
        [0.06, [1, 0.25, s * 0.25], 0.36],   // brow
        [0.13, [1, 0.45, s * 0.2], 0.3],     // bez
        [0.38, [0.85, 0.6, s * 0.05], 0.24], // trez
        [0.58, [0.55, 1, -s * 0.1], 0.42],   // royal
        [0.8, [0.3, 1, -s * 0.15], 0.28],    // the fork
      ];
      for (let i = 0; i < T.length; i++) {
        const a = X.along(beam, T[i][0]);
        X.tine(a.p, T[i][1].slice(), T[i][2] * sz, (0.024 - 0.01 * T[i][0]) * sz, [0, 1, 0], "tine");
      }
    }
  }

  const SPEC = {
    id: "elk", salt: 0xe1c, STATS: STATS, REAL: REAL, herd: true,
    sexOf: function (idx) { return idx % 3 === 0 ? "male" : "female"; },
    variant: function (sex, r) { const tint = Math.floor(r() * COATS.length), rack = Math.floor(r() * 3); return { tint: tint, rack: rack, key: tint + "|" + (sex === "male" ? rack : 0) }; },
    dims: dims,
    gait: function (D, base) {
      const k = Math.sqrt(D.K);
      return Object.assign({}, base, {
        gaits: [
          { name: "walk", key: "wW", off: [0.25, 0.75, 0.00, 0.50], duty: 0.64, lift: 0.06 },
          { name: "trot", key: "wT", off: [0.25, 0.75, -0.25, 0.25], duty: 0.42, lift: 0.09 },
          { name: "gallop", key: "wG", off: [0.10, 0.30, -0.35, -0.20], duty: 0.26, lift: 0.11 },
        ],
        trans: [[1.5 / k, 2.2 / k], [5.0 / k, 6.4 / k]],
        fMax: 2.6 * k, f0: 1.0 * k, fV: 0.4 * k, strideMax: 2.0,
        vMove: 0.12, turnMove: 0.35, turnF: 1.4,
        settleRate: 2.2, restLift: 0.04, restStep: 0.06,
      });
    },
    colour: colour,
    look: {
      neck0: 0, alertNeck: 0.15, walkNeck: 0.12, trotNeck: 0.08, gallopNeck: 0.22, lieNeck: 0.0, nod: 0.04, gallopNod: 0.1,
      trotBounce: 0.014, gallopRock: 0.1, carpusFold: 1.9,
      chargeNeck: 0.5, chargeHead: 0.45, chargeHeadAt: 10, hackleAggr: 0.8, aggrEars: 0.8,
      threatNeck: 0.15, threatHead: 0.15, threatSwing: 0.1, threatEars: 0.6, threatPaw: true, tailThreat: 0.8,
      bellowNeck: 0.35, bellowHead: 0.6, grazeNeck: -1.0, grazeHead: -0.35,      // the bugle; the graze
      rearRise: 0.45, rearPitch: 0.65,
      tailHang: 1.3, tailRunLift: 0.6, tailUpLift: 1.4, tailCurl: 0.2, tailCharge: 0.3, tailFlee: 1,
    },
    neckHair: function (X) { return X.hairFn(0.16, 0.8, function (t, ca) { return ca < -0.1 ? (1 - t * 0.5) * (X.D.male ? 1 : 0.5) : 0.15; }); },
    extras: function (X) { if (X.D.male) antlers(X); },
    nerve: function (m, L, hd, o) { return CBZ.ungulateKit.grazerNerve(m, L, hd, o); },
    blows: {
      hook: [0.12, 5.0, 1.6],
      butt: [0.16, 4.0, 1.0],
      antler: [0.13, 6.0, 2.0],
      strike: [0.25, 5.0, 1.5],
      stomp: [0.35, 4.0, 1.4],
      kick: [0.22, 6.5, 1.3],
      spar: [0.3, 2.0, 0.8],
    },
    ramSharp: 1.4, hookToss: 0.15, mockCharge: false, passThrough: 1.5,
    pick: function (L, m, tgt, c) {
      if (c.downed) return "stomp";
      if (c.behind && c.d < c.keep + 1.2) return "kick";
      if (L.male) return c.kind === "rival" && Math.random() < 0.5 ? "spar" : "antler";
      return "strike";
    },
    moveAct: { elk_charge: "charge", elk_antler: "antler", elk_box: "strike", elk_stomp: "stomp", elk_kick: "kick" },
    YM: {
      elk_charge: { id: "elk_charge", style: "ram", pow: 1, dur: 1.2, rng: 1.2, leap: 1.2, cd: 1.0 },
      elk_antler: { id: "elk_antler", style: "gore", pow: 1, dur: 0.75, rng: 1.05, cd: 0.4 },
      elk_box: { id: "elk_box", style: "stomp", pow: 1, dur: 1.0, rng: 1.1, cd: 0.45 },
      elk_stomp: { id: "elk_stomp", style: "stomp", pow: 1, dur: 1.0, rng: 1.05, cd: 0.4 },
      elk_kick: { id: "elk_kick", style: "stomp", pow: 1, dur: 0.75, rng: 1.1, cd: 0.6 },
    },
    ymDefault: "elk_box", ymCharge: "elk_charge", ymStomp: "elk_stomp", ymKick: "elk_kick",
    ymRotation: function (L, n) { return L.male ? (n % 3 === 0 ? "elk_box" : "elk_antler") : "elk_box"; },
  };
  const K = function () { return CBZ.ungulateKit || null; };
  let _def = null;
  const Df = function () { return _def || (K() ? (_def = K().def(SPEC)) : null); };
  CBZ.unitKit.register("elk", {
    kind: "species", stats: STATS,
    build: function (ctx) { const d = Df(); return d ? d.build(ctx) : null; },
    animate: function (m, dt) { const k = K(); if (k) k.animate(m, dt); },
    moves: function (m, tgt, ctx) { const k = K(); return k ? k.moves(m, tgt, ctx) : null; },
    fight: function (m, tgt, dt, o) { const k = K(); return k ? k.fight(m, tgt, dt, o) : CBZ.creatureFight(m, tgt, dt, o); },
  });
})();
