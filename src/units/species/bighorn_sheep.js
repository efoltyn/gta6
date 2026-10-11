/* ============================================================
   units/species/bighorn_sheep.js — THE BIGHORN SHEEP (Ovis canadensis).

   OWNED BY: the mountain goat and bighorn sheep agent.

   This is a redrawn ungulate on CBZ.ungulateKit (bison.js engine).
   units/manifest.js's `needs` loads the kit and this file.

   THE ANIMAL (reference: Geist 1971, Mammalian Species 6; B.C. Parks;
   Rocky Mountain Bighorn Society; National Geographic)
     male (ram)  shoulder 1.0-1.1 m, mass 100-190 kg, curled horns up to 1.0 m
     female (ewe) shoulder 0.85-0.95 m, mass 50-100 kg, short thin horns or none
     brown, tan, or grey coat with lighter underbelly and rump patch
     massive, tightly curled horns (spiral, full curl + in males)
     stocky, powerfully built with thick neck and massive shoulders
     specialized hooves for mountain terrain
     top speed 35 km/h (9.8 m/s), excellent climbers
     the NECK and SHOULDERS are the ram's weapon: built for head-butting
   HOW IT FIGHTS (head-butting is the primary combat tactic)
     RAMMING: running head-butts that can break bones in rival males
     HEAD-BUTT: clashing heads to establish dominance
     REAR-STRIKE: rear legs like other ungulates
     HORN-GORE: the horns are used defensively and offensively
     Males engage in spectacular clashing at full run (audible from 1 km away).
     Females defend their lambs and young fiercely but avoid lethal combat.
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W.CBZ || (W.CBZ = {});

  const STATS = {
    hp: 185, spd: 1.85, danger: 0.35, bite: 28, scale: 0.85,
    chase: 10, march: 3.8, dmg: 48, rate: 0.95,
    brave: true, prey: false,
    mass: 130, hide: 10, skull: 28, ribs: 13, plan: "quad",
  };
  const REAL = {
    male: { mass: 140, top: 9.8, cruise: 6, march: 3.8, accel: 5, sta: 50, recover: 1, hpK: 1, quit: 0.1, chargeAt: 25, turn: 4.5, weapon: "horns" },
    female: { mass: 70, top: 10, cruise: 6.2, march: 3.8, accel: 5.5, sta: 55, recover: 1.1, hpK: 0.6, quit: 0.2, chargeAt: 20, turn: 5, weapon: "hooves" },
  };
  const COATS = [
    { body: 0x8b7355, back: 0x7a6347, belly: 0xc9b8a8, rump: 0xf5f5f0, leg: 0x6b5d52, neck: 0x7d6b5f },
    { body: 0x9d8b7f, back: 0x8c7a6f, belly: 0xd4c4ba, rump: 0xf8f6f3, leg: 0x7a6d62, neck: 0x8f7d71 },
    { body: 0x7a6a5c, back: 0x6a5a4d, belly: 0xb8a89e, rump: 0xf0ede8, leg: 0x5a4d42, neck: 0x6c5a4f },
  ];
  const FEAT = { nose: 0x3a3a3a, nostril: 0x0a0a0a, lip: 0x5a5a5a, eye: 0x1a1a1a, lid: 0x2a2a2a, hoof: 0x2a2a2a, horn: 0x6a5a4a, hornBase: 0x8a7a6a, earIn: 0xc9a890 };

  function dims(sex) {
    const male = sex === "male";
    const H = male ? 1 : 0.88, Gt = male ? 1 : 0.92, Hs = male ? 1.25 : 1.0;
    const g = H * Gt;
    const D = { sex: sex, male: male, H: H, Gt: Gt, Hs: Hs };
    D.withers = 1.08 * H;
    D.hipX = -0.8 * H; D.hipH = 0.98 * H; D.shX = 0.56 * H; D.sh = 1.02 * H;
    D.HJ = { x: -0.8 * H, y: 0.88 * H }; D.FJ = { x: 0.56 * H, y: 0.95 * H };
    D.fa = 0.30 * H; D.fb = 0.32 * H; D.fc = 0.20 * H; D.fh = 0.11 * H;
    D.ha = 0.34 * H; D.hb = 0.38 * H; D.hc = 0.26 * H; D.hh = 0.11 * H;
    D.pdx = 0.045 * H; D.hoofK = 1.08; D.lk = 1.18 * g; D.lkh = 1.22 * g;
    D.legZf = 0.17 * H * Math.sqrt(Gt); D.legZh = 0.17 * H * Math.sqrt(Gt);
    // heavily built barrel: thick neck and massive shoulders
    const rows = [
      [-0.88, 0.98, 0.12, 0.14, 0.12, 0, 0.88],
      [-0.74, 0.99, 0.15, 0.19, 0.16, 0, 0.90],
      [-0.60, 1.00, 0.17, 0.22, 0.18, 0, 0.92],
      [-0.40, 1.02, 0.19, 0.24, 0.20, 0, 0.92],
      [-0.16, 1.03, 0.20, 0.26, 0.20, 0.12, 0.92],
      [0.08, 1.05, 0.19, 0.25, 0.18, 0.32, 0.90],
      [0.32, 1.06, 0.17, 0.22, 0.15, 0.45, 0.88],
      [0.48, 1.06, 0.13, 0.18, 0.11, 0.30, 0.88],
    ];
    D.TOR = rows.map(function (r) { return [r[0] * H, r[1] * H, r[2] * g, r[3] * g, r[4] * g, r[5], r[6]]; });
    D.NECK = [
      [0.48, 1.12, 0.16, 0.20, 0.14, 0.95, 0.88],
      [0.64, 1.18, 0.14, 0.18, 0.13, 0.95, 0.80],
      [0.78, 1.23, 0.11, 0.14, 0.11, 0.95, 0.40],
      [0.88, 1.26, 0.08, 0.10, 0.08, 0.95, 0],
    ].map(function (r) { return [r[0] * H, r[1] * H, r[2] * g, r[3] * g, r[4] * g, r[5], r[6]]; });
    D.headP = { x: 0.88 * H, y: 1.26 * H };
    D.headAng = -0.50;
    // blocky head with prominent skull crest for horn bases
    D.HEAD = [
      [-0.05, 0.0, 0.10, 0.11, 0.10, 1],
      [0.03, 0.0, 0.11, 0.11, 0.115, 0.95],
      [0.13, 0.0, 0.10, 0.11, 0.10, 0.90],
      [0.24, -0.005, 0.09, 0.10, 0.09, 0.85],
      [0.34, -0.005, 0.08, 0.09, 0.08, 0.80],
      [0.42, 0.0, 0.08, 0.09, 0.08, 0.75],
    ];
    D.nostril = [0.40, 0.0, 0.052, 0.018, 0.023];
    D.jaw = [0.18, -0.085, 0.58, -0.11];
    D.jawR = [[0.028, 0.025, 0.022, 0.019], [0.045, 0.040, 0.034, 0.028], [0.066, 0.060, 0.050, 0.042]];
    D.eye = { d: 0.16, h: 0.032, z: 0.085, r: 0.018 };
    D.ear = { d: 0.022, h: 0.017, z: 0.09, len: 0.17, w: 0.045, dir: [-0.3, 0.3, 0.85] };
    D.tailP = { x: -0.88 * H, y: 0.95 * H }; D.tailL = 0.09 * H; D.tailR = 0.028 * g;
    D.tailProf = [1, 0.88, 0.75, 0.55, 0.30];
    D.humpP = { x: 0.28 * H, y: 1.08 * H };
    D.hackleP = { x: 0.68 * H, y: 1.18 * H };
    D.lieC = 0.70; D.lieP = 0.64;
    D.bsR = 2.4 * H;
    return D;
  }

  function colour(D, V) {
    const P = COATS[V.tint], F = FEAT, H = D.H, Hs = D.Hs;
    const hpX = D.headP.x, hpY = D.headP.y, ux = D.u.x, uy = D.u.y, nx = D.n.x, ny = D.n.y;
    const U = CBZ.ungulateKit.util, cmix = U.cmix, cmul = U.cmul, nz = U.nz, sstep = U.sstep;
    function grain(c, x, y, z, a) { return cmul(c, 1 + nz(x / H, y / H, z / H) * a); }
    function legC(y) { return cmix(P.leg, P.body, sstep(1.05 * H, 0.70 * H, y)); }
    return function (part, x, y, z, ca, sa, t) {
      switch (part) {
        case "torso": {
          let c = cmix(P.body, P.back, sstep(0.3, 0.9, ca) * 0.6);
          if (ca < -0.3) c = cmix(c, P.belly, sstep(-0.3, -0.8, ca));
          return grain(c, x, y, z, 0.06);
        }
        case "neck": return grain(cmix(P.neck, P.back, sstep(0.3, 0.9, ca) * 0.5), x, y, z, 0.07);
        case "head": {
          const dx = x - hpX, dy = y - hpY, d = (dx * ux + dy * uy) / Hs, h = (dx * nx + dy * ny) / Hs;
          if (d > 0.58 && h > -0.02) return F.nose;
          if (d > 0.52 && h < -0.035) return F.lip;
          return grain(cmix(P.body, P.neck, 0.4), x, y, z, 0.06);
        }
        case "jaw": return cmix(P.body, P.neck, 0.5);
        case "nostril": return F.nostril;
        case "eye": return F.eye;
        case "lid": return F.lid;
        case "ear": return cmix(P.body, P.neck, 0.3);
        case "earIn": return F.earIn;
        case "tail": return P.rump;
        case "upper": case "thigh": return grain(cmix(P.body, P.belly, 0.2), x, y, z, 0.05);
        case "fore": case "gaskin": return grain(legC(y), x, y, z, 0.04);
        case "cannon": case "pastern": return grain(P.leg, x, y, z, 0.03);
        case "hoof": return F.hoof;
        case "horn": return cmix(F.horn, F.hornBase, sstep(0.6, 1, t));
      }
      return P.body;
    };
  }

  function horns(X) {
    const D = X.D, Hs = D.Hs, V = X.V, U = CBZ.ungulateKit.util;
    if (!D.male) return; // ewes have minimal horns
    const size = [0.7, 0.9, 1.0][V.hornSize || 0];
    for (let s = -1; s <= 1; s += 2) {
      const B = D.hp(0.06, 0.08);
      const z0 = s * 0.12 * Hs;
      // the big spiral horns: a thick base curling up, back, and forward
      const cp = [
        [B.x, B.y, z0],
        [B.x - 0.005, B.y + 0.015 * size, z0 + s * 0.065 * size],
        [B.x - 0.025 * size, B.y + 0.08 * size, z0 + s * 0.18 * size],
        [B.x - 0.055 * size, B.y + 0.18 * size, z0 + s * 0.30 * size],
        [B.x - 0.075 * size, B.y + 0.30 * size, z0 + s * (0.30 + 0.10 * size) * size],
        [B.x - 0.070 * size, B.y + 0.40 * size, z0 + s * (0.20) * size],
      ];
      const pts = U.curve(cp, 10), rad = [];
      for (let i = 0; i < pts.length; i++) {
        const t = i / (pts.length - 1);
        const r = (0.045 - 0.043 * Math.pow(t, 1.1)) * size * Hs;
        rad.push([r, r * 0.90]);
      }
      X.sweep(pts, rad, 10, "horn", [0, 1, 0]);
    }
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  const SPEC = {
    id: "bighorn_sheep", salt: 0xb3b0, STATS: STATS, REAL: REAL, herd: false,
    sexOf: function (idx) { return idx % 4 === 0 ? "male" : "female"; },
    variant: function (sex, r) { const tint = Math.floor(r() * COATS.length), hornSize = Math.floor(r() * (sex === "male" ? 3 : 1)); return { tint: tint, hornSize: hornSize, key: tint + "|" + sex + "|" + hornSize }; },
    dims: dims,
    gait: function (D, base) {
      const k = Math.sqrt(D.K);
      return Object.assign({}, base, {
        gaits: [
          { name: "walk", key: "wW", off: [0.25, 0.75, 0.00, 0.50], duty: 0.67, lift: 0.045 },
          { name: "trot", key: "wT", off: [0.25, 0.75, -0.25, 0.25], duty: 0.45, lift: 0.065 },
          { name: "gallop", key: "wG", off: [0.10, 0.30, -0.35, -0.20], duty: 0.30, lift: 0.075 },
        ],
        trans: [[1.7 / k, 2.4 / k], [3.8 / k, 5.0 / k]],
        fMax: 2.1 * k, f0: 0.92 * k, fV: 0.42 * k, strideMax: 1.4,
        vMove: 0.12, turnMove: 0.36, turnF: 1.4,
        settleRate: 2.0, restLift: 0.03, restStep: 0.06,
      });
    },
    colour: colour,
    look: {
      neck0: 0.05, alertNeck: 0.12, walkNeck: 0.05, trotNeck: 0.04, gallopNeck: 0.08, lieNeck: 0.06, nod: 0.03, gallopNod: 0.08,
      trotBounce: 0.012, gallopRock: 0.085, carpusFold: 1.7,
      chargeNeck: 0.35, chargeHead: 0.40, chargeHeadAt: 25, hackleAggr: 0.5, aggrEars: 0.6,
      threatNeck: -0.18, threatHead: 0.10, threatSwing: 0.28, threatEars: 0.65, threatPaw: false, tailThreat: 0.5,
      bellowNeck: 0.15, bellowHead: 0.35, grazeNeck: -0.50, grazeHead: -0.20,
      rearRise: 0.45, rearPitch: 0.55,
      tailHang: 1.4, tailRunLift: 0.22, tailUpLift: 1.3, tailCurl: 0.45, tailCharge: 0.8, tailFlee: 0.55,
    },
    neckHair: function (X) {
      return X.hairFn(0.07, 1.3, function (t, ca) { return ca > 0.4 ? 1 : 0; });
    },
    torsoHair: function (X) {
      const H = X.D.H;
      return X.hairFn(0.05, 0.25, function (t, ca, sa, x) { return ca > 0.5 && x > 0.1 * H ? 0.7 : 0; });
    },
    extras: horns,
    nerve: function (m, L, hd, o) {
      // a bighorn stands its ground; females defend lambs
      if (o.tgt && o.tgt.vehicle && L.hitT < 3 && L.dmgEma > m.maxHp * 0.15) return "flee";
      return "fight";
    },
    blows: {
      hook: [0.10, 4.8, 1.7],
      butt: [0.16, 3.8, 1.1],
      antler: [0.12, 5.0, 1.9],
      strike: [0.22, 4.5, 1.3],
      stomp: [0.30, 3.5, 1.1],
      kick: [0.18, 5.8, 1.2],
      spar: [0.28, 2.2, 0.9],
    },
    ramSharp: 1.4, hookToss: 0.6, mockCharge: true, passThrough: 1.2,
    pick: function (L, m, tgt, c) {
      if (c.downed) return "stomp";
      if (c.behind && c.d < c.keep + 1.2 && Math.random() < 0.25) return "kick";
      if (c.kind === "rival" && L.male && Math.random() < 0.6) return "spar";
      if (c.kind === "man" && c.d > c.keep + 1.5 && Math.random() < 0.3) return "charge";
      if (L.male && Math.random() < 0.4) return "butt";
      return Math.random() < 0.6 ? "hook" : "strike";
    },
    moveAct: { sheep_charge: "charge", sheep_hook: "hook", sheep_butt: "butt", sheep_stomp: "stomp", sheep_kick: "kick", sheep_spar: "spar" },
    YM: {
      sheep_charge: { id: "sheep_charge", style: "ram", pow: 1, dur: 1.1, rng: 1.15, leap: 1.3, cd: 1.0 },
      sheep_hook: { id: "sheep_hook", style: "gore", pow: 1, dur: 0.75, rng: 1.0, cd: 0.40 },
      sheep_butt: { id: "sheep_butt", style: "ram", pow: 1, dur: 0.7, rng: 1.05, cd: 0.45 },
      sheep_stomp: { id: "sheep_stomp", style: "stomp", pow: 1, dur: 1.0, rng: 1.05, cd: 0.50 },
      sheep_kick: { id: "sheep_kick", style: "stomp", pow: 1, dur: 0.8, rng: 1.15, cd: 0.65 },
      sheep_spar: { id: "sheep_spar", style: "ram", pow: 1, dur: 1.2, rng: 0.95, cd: 0.8 },
    },
    ymDefault: "sheep_butt", ymCharge: "sheep_charge", ymStomp: "sheep_stomp", ymKick: "sheep_kick",
    ymRotation: function (L, n) { return L.male && n % 2 === 0 ? "sheep_spar" : "sheep_hook"; },
  };

  const K = function () { return CBZ.ungulateKit || null; };
  let _def = null;
  const D = function () { return _def || (K() ? (_def = K().def(SPEC)) : null); };
  CBZ.unitKit.register("bighorn_sheep", {
    kind: "species", stats: STATS,
    build: function (ctx) { const d = D(); return d ? d.build(ctx) : null; },
    animate: function (m, dt) { const k = K(); if (k) k.animate(m, dt); },
    moves: function (m, tgt, ctx) { const k = K(); return k ? k.moves(m, tgt, ctx) : null; },
    fight: function (m, tgt, dt, o) { const k = K(); return k ? k.fight(m, tgt, dt, o) : CBZ.creatureFight(m, tgt, dt, o); },
  });
})();
