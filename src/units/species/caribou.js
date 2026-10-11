/* ============================================================
   units/species/caribou.js — THE CARIBOU (Rangifer tarandus), as NPC War
   fights it.

   OWNED BY: the bison agent (the large ungulates). The engine is
   CBZ.ungulateKit in bison.js (loaded first through units/manifest.js's
   `needs`); this file is the caribou's body, coat, antlers and numbers.

   WHAT WAS HERE: the bestiary's box caribou (city/wildlife/snow_ungulates.js),
   hp 70, a prey flag: it ran from everything and fought nothing.

   THE ANIMAL (reference: barren-ground caribou; Bergerud 1978; ADF&G)
     bull  shoulder 1.2 m, nose to rump 2.0 m, ~180 kg; cow 1.05 m, ~110 kg
     the only deer whose COWS carry antlers too. A bull's rack is huge for
     the body: beams sweeping back then forward in a C, palmate tops, bez
     tines forward and a vertical brow SHOVEL over the face. A white neck
     and mane (long underneath), a white rump and tail, a pale flank band,
     brown body and legs with white "socks" above BIG concave hooves (they
     are snowshoes and paddles), a broad hairy muzzle, short round ears.
     Top speed ~70-80 km/h in a burst; the most enduring runner of the deer
     (the longest land migration there is), at home in a fast trot.
   HOW IT FIGHTS
     it runs, as a herd, for a very long time. Caught, it strikes with the
     forefeet and jabs with the antlers; bulls spar. It is the lightest of
     the four, and it knows it.
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W.CBZ || (W.CBZ = {});

  const STATS = {
    hp: 170, spd: 2.8, danger: 0.08, bite: 25, scale: 1,
    chase: 20, march: 4.5, dmg: 25, rate: 1.15,
    brave: false, prey: true,
    mass: 180, hide: 5, skull: 18, ribs: 14, plan: "quad",
  };
  const REAL = {
    male: { mass: 180, top: 20, cruise: 11, march: 4.5, accel: 7.5, sta: 110, recover: 1.4, hpK: 1, quit: 0.35, chargeAt: 0, turn: 5.5, weapon: "antlers" },
    female: { mass: 110, top: 20.5, cruise: 11, march: 4.5, accel: 8, sta: 120, recover: 1.5, hpK: 0.75, quit: 0.45, chargeAt: 0, turn: 6, weapon: "hooves" },
  };
  const COATS = [
    { body: 0x6e5a44, back: 0x5c4a38, band: 0xa1917a, belly: 0xebe6da, neck: 0xe8e2d2, mane: 0xf1ede3, head: 0x4a3c2e, muzzle: 0x5e5040, leg: 0x3e3226, sock: 0xe8e4da, rump: 0xf0ece2 },
    { body: 0x7a6650, back: 0x66533f, band: 0xb0a28a, belly: 0xefeadf, neck: 0xded6c4, mane: 0xeee8dc, head: 0x55463a, muzzle: 0x66584a, leg: 0x45382b, sock: 0xe3dfd4, rump: 0xeeeadf },
    { body: 0x5d4b38, back: 0x4d3d2e, band: 0x948470, belly: 0xe6e0d2, neck: 0xd4ccba, mane: 0xe6e0d2, head: 0x40342a, muzzle: 0x544638, leg: 0x352b21, sock: 0xdcd7cc, rump: 0xe9e4d8 },
  ];
  const FEAT = { nose: 0x2a221c, nostril: 0x080606, lip: 0x302822, eye: 0x150e09, lid: 0x1a120c, hoof: 0x2a2622, earIn: 0xd8cebc, antler: 0x8a7656, tip: 0xe2d8c0 };

  function dims(sex) {
    const male = sex === "male";
    const H = male ? 1 : 0.88, Gt = male ? 1 : 0.88, Hs = male ? 1 : 0.9;
    const g = H * Gt;
    const D = { sex: sex, male: male, H: H, Gt: Gt, Hs: Hs };
    D.withers = 1.2 * H;
    D.hipX = -0.48 * H; D.hipH = 0.98 * H; D.shX = 0.38 * H; D.sh = 0.96 * H;
    D.HJ = { x: -0.5 * H, y: 0.92 * H }; D.FJ = { x: 0.4 * H, y: 0.86 * H };
    D.fa = 0.27 * H; D.fb = 0.31 * H; D.fc = 0.24 * H; D.fh = 0.1 * H;
    D.ha = 0.33 * H; D.hb = 0.36 * H; D.hc = 0.31 * H; D.hh = 0.1 * H;
    D.pdx = 0.045 * H; D.hoofK = 1.0; D.lk = 0.72 * g; D.lkh = 0.76 * g;
    D.legZf = 0.13 * H; D.legZh = 0.12 * H;
    const rows = [
      [-0.72, 1.0, 0.11, 0.13, 0.11, 0, 0.9],
      [-0.66, 0.99, 0.17, 0.2, 0.18, 0, 0.92],
      [-0.54, 0.98, 0.2, 0.27, 0.23, 0, 0.92],
      [-0.32, 0.97, 0.21, 0.29, 0.24, 0, 0.92],
      [-0.08, 0.97, 0.23, 0.3, 0.25, 0, 0.92],
      [0.15, 0.98, 0.25, 0.32, 0.25, 0.4, 0.92],
      [0.32, 0.99, 0.24, 0.33, 0.23, 0.8, 0.9],
      [0.46, 1.01, 0.21, 0.31, 0.2, 0.5, 0.9],
      [0.55, 1.04, 0.16, 0.24, 0.16, 0.2, 0.92],
    ];
    D.TOR = rows.map(function (r) { return [r[0] * H, r[1] * H, r[2] * g, r[3] * g, r[4] * g, r[5], r[6]]; });
    D.NECK = [
      [0.48, 1.06, 0.2, 0.27, 0.17, 0.95, 0.3],
      [0.62, 1.15, 0.16, 0.23, 0.14, 0.95, 0.5],
      [0.74, 1.24, 0.13, 0.17, 0.115, 0.95, 0.4],
      [0.82, 1.3, 0.1, 0.12, 0.1, 0.95, 0],
    ].map(function (r) { return [r[0] * H, r[1] * H, r[2] * g, r[3] * g, r[4] * g, r[5], r[6]]; });
    D.headP = { x: 0.82 * H, y: 1.3 * H };
    D.headAng = -0.55;
    D.HEAD = [
      [-0.04, 0.0, 0.085, 0.09, 0.085, 1],
      [0.04, 0.0, 0.09, 0.09, 0.1, 0.95],
      [0.12, 0.0, 0.085, 0.085, 0.095, 0.9],
      [0.21, -0.01, 0.07, 0.08, 0.075, 0.85],
      [0.3, -0.01, 0.062, 0.072, 0.068, 0.82],
      [0.38, -0.01, 0.062, 0.068, 0.068, 0.75],     // the broad, hairy muzzle
      [0.43, -0.02, 0.046, 0.05, 0.056, 0.8],
    ];
    D.nostril = [0.42, -0.01, 0.032, 0.012, 0.015];
    D.jaw = [0.13, -0.07, 0.39, -0.06];
    D.jawR = [[0.022, 0.02, 0.017, 0.014], [0.035, 0.032, 0.026, 0.02], [0.062, 0.054, 0.045, 0.036]];
    D.eye = { d: 0.13, h: 0.025, z: 0.074, r: 0.017 };
    D.ear = { d: 0.03, h: 0.03, z: 0.07, len: 0.12, w: 0.05, dir: [-0.35, 0.45, 0.82] };
    D.tailP = { x: -0.72 * H, y: 1.08 * H }; D.tailL = 0.14 * H; D.tailR = 0.04 * g;
    D.tailProf = [1, 1.05, 1, 0.85, 0.55];
    D.humpP = { x: 0.3 * H, y: 1.12 * H };
    D.hackleP = { x: 0.65 * H, y: 1.15 * H };
    D.lieC = 0.46; D.lieP = 0.42;
    D.bsR = 2.0 * H;
    return D;
  }

  function colour(D, V) {
    const P = COATS[V.tint], F = FEAT, H = D.H, Hs = D.Hs, male = D.male;
    const hpX = D.headP.x, hpY = D.headP.y, ux = D.u.x, uy = D.u.y, nx = D.n.x, ny = D.n.y;
    const U = CBZ.ungulateKit.util, cmix = U.cmix, cmul = U.cmul, nz = U.nz, sstep = U.sstep;
    function grain(c, x, y, z, a) { return cmul(c, 1 + nz(x / H, y / H, z / H) * a); }
    const neckC = male ? P.neck : cmix(P.neck, P.body, 0.45);
    return function (part, x, y, z, ca, sa, t) {
      switch (part) {
        case "torso": {
          let c = cmix(P.body, P.back, sstep(0.5, 0.95, ca) * 0.6);
          // the pale band along the lower flank, then the white belly
          if (ca < 0.0) c = cmix(c, P.band, sstep(0.0, -0.35, ca) * (1 - sstep(-0.45, -0.6, ca)));
          if (ca < -0.45) c = cmix(c, P.belly, sstep(-0.45, -0.7, ca));
          c = cmix(c, P.rump, sstep(-0.56 * H, -0.7 * H, x) * sstep(-0.7, -0.1, ca));
          c = cmix(c, neckC, sstep(0.4 * H, 0.55 * H, x) * sstep(-0.9, 0.2, ca));
          return grain(c, x, y, z, 0.05);
        }
        case "neck": return grain(cmix(neckC, P.mane, sstep(-0.2, -0.8, ca)), x, y, z, 0.06);
        case "head": {
          const dx = x - hpX, dy = y - hpY, d = (dx * ux + dy * uy) / Hs, h = (dx * nx + dy * ny) / Hs;
          if (d > 0.4 && h > -0.02) return F.nose;
          if (d > 0.36 && h < -0.04) return cmix(P.muzzle, 0xe8e2d4, 0.5);   // the pale lip and chin
          if (Math.abs(d - 0.13) < 0.04 && h > 0 && h < 0.05) return cmix(P.head, 0xe8e2d4, 0.35); // the pale eye ring
          return grain(cmix(P.head, P.muzzle, sstep(0.2, 0.38, d)), x, y, z, 0.06);
        }
        case "jaw": return ca > 0.45 ? 0x5a3a36 : cmix(P.muzzle, 0xe8e2d4, 0.4);
        case "nostril": return F.nostril;
        case "eye": return F.eye;
        case "lid": return F.lid;
        case "ear": return cmix(P.head, P.body, 0.4);
        case "earIn": return F.earIn;
        case "tail": return ca > 0.4 ? P.back : P.rump;
        case "upper": return grain(cmix(P.body, neckC, 0.3), x, y, z, 0.05);
        case "thigh": return grain(cmix(P.body, P.rump, sstep(-0.3, -0.9, ca) * 0.5), x, y, z, 0.05);
        case "fore": case "gaskin": return grain(P.leg, x, y, z, 0.05);
        case "cannon": return grain(cmix(P.leg, P.sock, sstep(0.1 * H, 0.03 * H, y - D.fh)), x, y, z, 0.05);
        case "pastern": return grain(P.sock, x, y, z, 0.04);
        case "hoof": return F.hoof;
        case "antler": case "tine": case "palm": return grain(cmix(F.antler, F.tip, sstep(0.7, 1, t)), x, y, z, 0.1);
      }
      return P.body;
    };
  }

  /* THE RACK. Bulls: beams back and up, then forward at the top in a C,
     palmate tips, bez tines forward, and the vertical brow shovel over the
     face (on one side only, usually). Cows: slender beams with a few points. */
  function antlers(X) {
    const D = X.D, Hs = D.Hs, V = X.V, U = CBZ.ungulateKit.util, male = D.male;
    const sz = male ? [0.85, 1.0, 1.12][V.rack] : 0.42;
    const shovel = male ? (V.rack === 2 ? 2 : 1) : 0;      // how many brow shovels
    for (let s = -1; s <= 1; s += 2) {
      const B = D.hp(0.03, 0.075);
      const b0 = [B.x, B.y, s * 0.05 * Hs];
      const cp = [
        b0,
        [b0[0] - 0.03 * sz, b0[1] + 0.16 * sz, b0[2] + s * 0.08 * sz],
        [b0[0] - 0.22 * sz, b0[1] + 0.42 * sz, b0[2] + s * 0.2 * sz],
        [b0[0] - 0.32 * sz, b0[1] + 0.7 * sz, b0[2] + s * 0.24 * sz],
        [b0[0] - 0.22 * sz, b0[1] + 0.94 * sz, b0[2] + s * 0.2 * sz],
        [b0[0] - 0.04 * sz, b0[1] + 1.04 * sz, b0[2] + s * 0.14 * sz],
      ];
      const beam = U.curve(cp, 14), rad = [];
      for (let i = 0; i < beam.length; i++) { const t = i / (beam.length - 1), r = (0.03 - 0.018 * t) * sz; rad.push([r, r * 0.9]); }
      X.sweep(beam, rad, 8, "antler", [1, 0, 0]);
      if (male) {
        // the palmate top: a flattened blade with points off its front edge
        const tipA = X.along(beam, 0.82).p, tipB = beam[beam.length - 1];
        const pal = U.curve([tipA, [lerp(tipA[0], tipB[0], 0.5), lerp(tipA[1], tipB[1], 0.5) + 0.03 * sz, lerp(tipA[2], tipB[2], 0.5)], [tipB[0] + 0.08 * sz, tipB[1] + 0.02 * sz, tipB[2]]], 6);
        X.sweep(pal, pal.map(function (p, i) { return [0.06 * sz * Math.sin(Math.PI * (0.2 + 0.6 * i / (pal.length - 1))), 0.012 * sz]; }), 10, "palm", [0, 0, 1]);
        for (let i = 0; i < 4; i++) {
          const a = X.along(pal, 0.2 + 0.25 * i);
          X.tine(a.p, [0.6, 0.8, s * 0.1], (0.07 + 0.03 * (i % 2)) * sz, 0.012 * sz, null, "tine");
        }
        // bez tines: forward and palmate off the lower beam
        const bz = X.along(beam, 0.22).p;
        X.tine(bz, [1, 0.35, s * 0.15], 0.22 * sz, 0.02 * sz, [0, 1, 0], "tine");
        X.tine(bz, [0.9, 0.6, s * 0.3], 0.18 * sz, 0.016 * sz, [0, 1, 0], "tine");
        // the brow shovel: a vertical blade down over the nose
        if ((s < 0 && shovel >= 1) || (s > 0 && shovel >= 2)) {
          const sb = X.along(beam, 0.05).p;
          const sh = U.curve([sb, [sb[0] + 0.1 * sz, sb[1] + 0.02 * sz, sb[2] * 0.6], [sb[0] + 0.2 * sz, sb[1] - 0.04 * sz, sb[2] * 0.3]], 6);
          X.sweep(sh, sh.map(function (p, i) { return [0.07 * sz * Math.sin(Math.PI * (0.15 + 0.7 * i / (sh.length - 1))), 0.01 * sz]; }), 10, "palm", [0, 1, 0]);
        }
      } else {
        const a = X.along(beam, 0.35).p;
        X.tine(a, [1, 0.5, s * 0.1], 0.1, 0.012, null, "tine");
        const b = X.along(beam, 0.75).p;
        X.tine(b, [0.6, 0.9, 0], 0.08, 0.01, null, "tine");
      }
    }
  }
  function lerp(a, b, t) { return a + (b - a) * t; }

  const SPEC = {
    id: "caribou", salt: 0xca21, STATS: STATS, REAL: REAL, herd: true,
    sexOf: function (idx) { return idx % 3 === 0 ? "male" : "female"; },
    variant: function (sex, r) { const tint = Math.floor(r() * COATS.length), rack = Math.floor(r() * 3); return { tint: tint, rack: rack, key: tint + "|" + rack }; },
    dims: dims,
    gait: function (D, base) {
      const k = Math.sqrt(D.K);
      return Object.assign({}, base, {
        gaits: [
          { name: "walk", key: "wW", off: [0.25, 0.75, 0.00, 0.50], duty: 0.62, lift: 0.06 },
          { name: "trot", key: "wT", off: [0.25, 0.75, -0.25, 0.25], duty: 0.4, lift: 0.09 },       // the long-distance trot
          { name: "gallop", key: "wG", off: [0.10, 0.30, -0.35, -0.20], duty: 0.24, lift: 0.11 },
        ],
        trans: [[1.4 / k, 2.0 / k], [6.5 / k, 8.0 / k]],
        fMax: 2.9 * k, f0: 1.1 * k, fV: 0.45 * k, strideMax: 2.2,
        vMove: 0.12, turnMove: 0.35, turnF: 1.5,
        settleRate: 2.4, restLift: 0.04, restStep: 0.06,
      });
    },
    colour: colour,
    look: {
      neck0: 0, alertNeck: 0.15, walkNeck: 0.1, trotNeck: 0.06, gallopNeck: 0.2, lieNeck: 0.0, nod: 0.04, gallopNod: 0.1,
      trotBounce: 0.014, gallopRock: 0.1, carpusFold: 2.0,
      chargeNeck: 0.5, chargeHead: 0.45, chargeHeadAt: 10, hackleAggr: 0.8, aggrEars: 0.8,
      threatNeck: 0.1, threatHead: 0.1, threatSwing: 0.1, threatEars: 0.6, threatPaw: true, tailThreat: 1,
      bellowNeck: 0.2, bellowHead: 0.3, grazeNeck: -0.95, grazeHead: -0.35,
      rearRise: 0.4, rearPitch: 0.65,
      tailHang: 1.2, tailRunLift: 0.7, tailUpLift: 1.4, tailCurl: 0.2, tailCharge: 0.3, tailFlee: 1,
    },
    neckHair: function (X) { return X.hairFn(X.D.male ? 0.22 : 0.08, 1.4, function (t, ca) { return ca < -0.2 ? 1 - t * 0.6 : 0.1; }); },
    extras: function (X) { antlers(X); },
    nerve: function (m, L, hd, o) { return CBZ.ungulateKit.grazerNerve(m, L, hd, o); },
    blows: {
      hook: [0.12, 5.0, 1.5],
      butt: [0.16, 4.0, 1.0],
      antler: [0.13, 5.5, 1.8],
      strike: [0.25, 5.0, 1.4],
      stomp: [0.35, 4.0, 1.3],
      kick: [0.22, 6.5, 1.3],
      spar: [0.3, 2.0, 0.8],
    },
    ramSharp: 1.3, hookToss: 0.1, mockCharge: false, passThrough: 1.2,
    pick: function (L, m, tgt, c) {
      if (c.downed) return "stomp";
      if (c.behind && c.d < c.keep + 1.2) return "kick";
      if (c.kind === "rival" && L.male && Math.random() < 0.5) return "spar";
      return Math.random() < (L.male ? 0.6 : 0.35) ? "antler" : "strike";
    },
    moveAct: { caribou_charge: "charge", caribou_antler: "antler", caribou_strike: "strike", caribou_stomp: "stomp", caribou_kick: "kick" },
    YM: {
      caribou_charge: { id: "caribou_charge", style: "ram", pow: 1, dur: 1.2, rng: 1.2, leap: 1.2, cd: 1.0 },
      caribou_antler: { id: "caribou_antler", style: "gore", pow: 1, dur: 0.7, rng: 1.05, cd: 0.4 },
      caribou_strike: { id: "caribou_strike", style: "stomp", pow: 1, dur: 1.0, rng: 1.1, cd: 0.45 },
      caribou_stomp: { id: "caribou_stomp", style: "stomp", pow: 1, dur: 1.0, rng: 1.05, cd: 0.4 },
      caribou_kick: { id: "caribou_kick", style: "stomp", pow: 1, dur: 0.75, rng: 1.1, cd: 0.6 },
    },
    ymDefault: "caribou_antler", ymCharge: "caribou_charge", ymStomp: "caribou_stomp", ymKick: "caribou_kick",
    ymRotation: function (L, n) { return n % 2 === 0 ? "caribou_strike" : "caribou_antler"; },
  };

  const K = function () { return CBZ.ungulateKit || null; };
  let _def = null;
  const Df = function () { return _def || (K() ? (_def = K().def(SPEC)) : null); };
  CBZ.unitKit.register("caribou", {
    kind: "species", stats: STATS,
    build: function (ctx) { const d = Df(); return d ? d.build(ctx) : null; },
    animate: function (m, dt) { const k = K(); if (k) k.animate(m, dt); },
    moves: function (m, tgt, ctx) { const k = K(); return k ? k.moves(m, tgt, ctx) : null; },
    fight: function (m, tgt, dt, o) { const k = K(); return k ? k.fight(m, tgt, dt, o) : CBZ.creatureFight(m, tgt, dt, o); },
  });
})();
