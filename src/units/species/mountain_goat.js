/* ============================================================
   units/species/mountain_goat.js — THE MOUNTAIN GOAT (Oreamnos americanus).

   OWNED BY: the mountain goat and bighorn sheep agent.

   This is a redrawn ungulate on CBZ.ungulateKit (bison.js engine).
   units/manifest.js's `needs` loads the kit and this file.

   THE ANIMAL (reference: Shackleton 1997, Mammalian Species 540; Alaska Dept.
   of Fish & Game; National Geographic)
     male  shoulder 1.0-1.1 m, mass 65-130 kg, females 45-65 kg
     pure white or cream coat, short tight hair with longer guard hairs
     short black dagger-like horns (0.2 m), slight backward curve, very sharp
     prominent beard under the chin, longer white hair at cheeks and neck
     stocky, powerfully muscled, especially hind legs and rump
     specialized hooves: concave pads, sharp edges for grip on rock
     excellent climbers, inhabit mountains and cliffs
     top speed 40 km/h (11 m/s) on flat ground, but 20 km/h on rock faces
     the REAR LEG is where the power is: hindquarters dominate the silhouette
   HOW IT FIGHTS (rare in nature, but when cornered it defends with horns)
     rear legs drive it up and forward: a REAR-LEG STRIKE (striking with
     both hind hooves), a KICK backward at pursuers, and REARING to escape.
     The horns are defensive, not primary weapons: jabs and head-butts.
     The beard and body posture communicate threat. An adult goat will not
     flee from most predators but will climb away when cornered.
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W.CBZ || (W.CBZ = {});

  const STATS = {
    hp: 145, spd: 2.0, danger: 0.25, bite: 18, scale: 0.65,
    chase: 11, march: 3.5, dmg: 35, rate: 0.9,
    brave: true, prey: false,
    mass: 95, hide: 8, skull: 18, ribs: 13, plan: "quad",
  };
  const REAL = {
    male: { mass: 95, top: 11, cruise: 6.5, march: 3.5, accel: 5.5, sta: 60, recover: 1.2, hpK: 1, quit: 0.18, chargeAt: 20, turn: 5.5, weapon: "hooves" },
    female: { mass: 55, top: 11.2, cruise: 6.8, march: 3.5, accel: 6, sta: 65, recover: 1.3, hpK: 0.65, quit: 0.2, chargeAt: 18, turn: 6, weapon: "hooves" },
  };
  const COATS = [
    { body: 0xf5f5f5, face: 0xf0eded, chest: 0xf8f8f8, beard: 0xf0eded, leg: 0xf5f5f5 },
    { body: 0xf0ede8, face: 0xe8e5e0, chest: 0xf3f0eb, beard: 0xede9e4, leg: 0xf0ede8 },
    { body: 0xfaf8f5, face: 0xf5f2ed, chest: 0xfcfaf8, beard: 0xf5f2ed, leg: 0xfaf8f5 },
  ];
  const FEAT = { nose: 0x4a4a4a, nostril: 0x1a1a1a, lip: 0x5a5a5a, eye: 0x2a2a2a, lid: 0x3a3a3a, hoof: 0x2a2a2a, horn: 0x1a1a1a, hornBase: 0x4a4a4a, earIn: 0xd0ccc7 };

  function dims(sex) {
    const male = sex === "male";
    const H = male ? 1 : 0.85, Gt = male ? 1 : 0.88, Hs = male ? 1.15 : 0.95;
    const g = H * Gt;
    const D = { sex: sex, male: male, H: H, Gt: Gt, Hs: Hs };
    D.withers = 1.05 * H;
    D.hipX = -0.8 * H; D.hipH = 0.95 * H; D.shX = 0.55 * H; D.sh = 0.95 * H;
    D.HJ = { x: -0.8 * H, y: 0.85 * H }; D.FJ = { x: 0.55 * H, y: 0.9 * H };
    D.fa = 0.28 * H; D.fb = 0.30 * H; D.fc = 0.18 * H; D.fh = 0.10 * H;
    D.ha = 0.32 * H; D.hb = 0.36 * H; D.hc = 0.24 * H; D.hh = 0.10 * H;
    D.pdx = 0.04 * H; D.hoofK = 1.1; D.lk = 1.2 * g; D.lkh = 1.25 * g;
    D.legZf = 0.16 * H * Math.sqrt(Gt); D.legZh = 0.16 * H * Math.sqrt(Gt);
    // compact, stocky barrel: powerful rear quarters dominate
    const rows = [
      [-0.85, 0.95, 0.10, 0.12, 0.10, 0, 0.88],
      [-0.72, 0.96, 0.13, 0.17, 0.14, 0, 0.90],
      [-0.58, 0.97, 0.15, 0.20, 0.16, 0, 0.92],
      [-0.40, 0.98, 0.17, 0.22, 0.17, 0, 0.92],
      [-0.18, 0.99, 0.18, 0.23, 0.17, 0.15, 0.92],
      [0.05, 1.01, 0.17, 0.22, 0.15, 0.35, 0.90],
      [0.28, 1.02, 0.15, 0.20, 0.12, 0.45, 0.88],
      [0.45, 1.03, 0.12, 0.16, 0.10, 0.30, 0.88],
    ];
    D.TOR = rows.map(function (r) { return [r[0] * H, r[1] * H, r[2] * g, r[3] * g, r[4] * g, r[5], r[6]]; });
    D.NECK = [
      [0.50, 1.08, 0.13, 0.17, 0.12, 0.95, 0.88],
      [0.65, 1.12, 0.11, 0.14, 0.11, 0.95, 0.80],
      [0.78, 1.15, 0.09, 0.11, 0.09, 0.95, 0.40],
      [0.88, 1.17, 0.07, 0.08, 0.07, 0.95, 0],
    ].map(function (r) { return [r[0] * H, r[1] * H, r[2] * g, r[3] * g, r[4] * g, r[5], r[6]]; });
    D.headP = { x: 0.88 * H, y: 1.17 * H };
    D.headAng = -0.55;
    // small refined head with prominent ears
    D.HEAD = [
      [-0.04, 0.0, 0.08, 0.09, 0.08, 1],
      [0.03, 0.0, 0.09, 0.09, 0.095, 0.95],
      [0.12, 0.0, 0.08, 0.09, 0.08, 0.90],
      [0.22, -0.005, 0.07, 0.08, 0.07, 0.85],
      [0.32, -0.005, 0.065, 0.07, 0.065, 0.80],
      [0.40, 0.0, 0.07, 0.075, 0.068, 0.75],
    ];
    D.nostril = [0.38, 0.0, 0.045, 0.015, 0.020];
    D.jaw = [0.16, -0.075, 0.55, -0.10];
    D.jawR = [[0.025, 0.023, 0.020, 0.017], [0.04, 0.036, 0.030, 0.025], [0.06, 0.055, 0.045, 0.038]];
    D.eye = { d: 0.14, h: 0.028, z: 0.075, r: 0.016 };
    D.ear = { d: 0.02, h: 0.015, z: 0.08, len: 0.16, w: 0.04, dir: [-0.25, 0.25, 0.85] };
    D.tailP = { x: -0.85 * H, y: 0.92 * H }; D.tailL = 0.08 * H; D.tailR = 0.025 * g;
    D.tailProf = [1, 0.85, 0.7, 0.5, 0.25];
    D.humpP = { x: 0.25 * H, y: 1.05 * H };
    D.hackleP = { x: 0.65 * H, y: 1.12 * H };
    D.lieC = 0.68; D.lieP = 0.62;
    D.bsR = 2.2 * H;
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
          let c = P.body;
          if (ca < -0.25) c = cmix(c, 0xf0eded, sstep(-0.25, -0.7, ca) * 0.3);
          return grain(c, x, y, z, 0.04);
        }
        case "neck": return grain(cmix(P.body, P.chest, sstep(-0.4, 0.2, ca) * 0.4), x, y, z, 0.05);
        case "head": {
          const dx = x - hpX, dy = y - hpY, d = (dx * ux + dy * uy) / Hs, h = (dx * nx + dy * ny) / Hs;
          if (d > 0.55 && h > -0.02) return F.nose;
          if (d > 0.50 && h < -0.03) return F.lip;
          return grain(P.face, x, y, z, 0.05);
        }
        case "jaw": return cmix(P.face, P.beard, 0.5);
        case "nostril": return F.nostril;
        case "eye": return F.eye;
        case "lid": return F.lid;
        case "ear": return P.chest;
        case "earIn": return F.earIn;
        case "tail": return P.body;
        case "upper": case "thigh": return grain(P.body, x, y, z, 0.04);
        case "fore": case "gaskin": return grain(P.leg, x, y, z, 0.03);
        case "cannon": case "pastern": return grain(P.leg, x, y, z, 0.02);
        case "hoof": return F.hoof;
        case "horn": return cmix(F.horn, F.hornBase, sstep(0.7, 1, t));
      }
      return P.body;
    };
  }

  function extras(X) {
    const D = X.D, BN = X.BN, Hs = D.Hs;
    // black dagger-like horns: short, sharp, slightly curved
    const hs = D.male ? 1 : 0.75, thick = D.male ? 1 : 0.7;
    for (let s = -1; s <= 1; s += 2) {
      const B = D.hp(0.02, 0.055);
      const z0 = s * 0.095 * Hs;
      const U = CBZ.ungulateKit.util;
      const cp = [
        [B.x, B.y, z0],
        [B.x - 0.002, B.y + 0.008 * hs, z0 + s * 0.058 * hs],
        [B.x - 0.015 * hs, B.y + 0.04 * hs, z0 + s * 0.12 * hs],
        [B.x - 0.022 * hs, B.y + 0.065 * hs, z0 + s * 0.155 * hs],
      ];
      const pts = U.curve(cp, 8), rad = [];
      for (let i = 0; i < pts.length; i++) { const t = i / (pts.length - 1), r = (0.028 - 0.027 * Math.pow(t, 1.2)) * thick * Hs; rad.push([r, r * 0.88]); }
      X.sweep(pts, rad, 8, "horn", [0, 1, 0]);
    }
    // beard: white hair hanging from chin and throat
    const bp = [], br = [];
    const b0 = D.hp(0.22, -0.095), b1 = D.hp(0.32, -0.065);
    const bl = (D.male ? 0.18 : 0.10) * Hs;
    for (let i = 0; i < 4; i++) {
      const t = i / 3;
      bp.push([lerp(b0.x, b1.x, 0.5) - 0.015 * t, lerp(b0.y, b1.y, 0.5) - bl * t, 0]);
      br.push([(0.055 - 0.035 * t) * Hs, (0.045 - 0.03 * t) * Hs]);
    }
    const vb = X.G.n;
    X.sweep(bp, br, 10, "head", [1, 0, 0], [BN.head, 0.8, BN.jaw, 0.2]);
    X.displace(vb, 10, X.hairFn(0.18, 1.2, null));
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  const SPEC = {
    id: "mountain_goat", salt: 0x6a7e, STATS: STATS, REAL: REAL, herd: false,
    sexOf: function (idx) { return idx % 3 === 0 ? "male" : "female"; },
    variant: function (sex, r) { const tint = Math.floor(r() * COATS.length); return { tint: tint, key: tint + "|" + sex }; },
    dims: dims,
    gait: function (D, base) {
      const k = Math.sqrt(D.K);
      return Object.assign({}, base, {
        gaits: [
          { name: "walk", key: "wW", off: [0.25, 0.75, 0.00, 0.50], duty: 0.68, lift: 0.04 },
          { name: "trot", key: "wT", off: [0.25, 0.75, -0.25, 0.25], duty: 0.48, lift: 0.055 },
          { name: "gallop", key: "wG", off: [0.10, 0.30, -0.35, -0.20], duty: 0.32, lift: 0.065 },
        ],
        trans: [[1.8 / k, 2.5 / k], [4.0 / k, 5.2 / k]],
        fMax: 2.0 * k, f0: 0.88 * k, fV: 0.40 * k, strideMax: 1.3,
        vMove: 0.13, turnMove: 0.40, turnF: 1.5,
        settleRate: 2.2, restLift: 0.025, restStep: 0.05,
      });
    },
    colour: colour,
    look: {
      neck0: 0, alertNeck: 0.10, walkNeck: 0.04, trotNeck: 0.03, gallopNeck: 0.07, lieNeck: 0.04, nod: 0.025, gallopNod: 0.06,
      trotBounce: 0.010, gallopRock: 0.07, carpusFold: 1.6,
      chargeNeck: 0.20, chargeHead: 0.25, chargeHeadAt: 18, hackleAggr: 0.4, aggrEars: 0.6,
      threatNeck: -0.15, threatHead: 0.05, threatSwing: 0.25, threatEars: 0.7, threatPaw: false, tailThreat: 0.4,
      bellowNeck: 0.10, bellowHead: 0.20, grazeNeck: -0.40, grazeHead: -0.15,
      rearRise: 0.40, rearPitch: 0.50,
      tailHang: 1.3, tailRunLift: 0.20, tailUpLift: 1.2, tailCurl: 0.4, tailCharge: 0.7, tailFlee: 0.5,
    },
    neckHair: function (X) {
      return X.hairFn(0.06, 0.8, function (t, ca) { return ca > 0.5 ? 0.8 : 0; });
    },
    torsoHair: function (X) {
      const H = X.D.H;
      return X.hairFn(0.04, 0.4, function (t, ca, sa, x) { return ca > 0.6 && x > 0.15 * H ? 0.6 : 0; });
    },
    nerve: function (m, L, hd, o) {
      // a goat stands firm and climbs away; does not flee from most threats
      if (o.tgt && o.tgt.vehicle && L.hitT < 2 && L.dmgEma > m.maxHp * 0.2) return "flee";
      return "fight";
    },
    blows: {
      hook: [0.08, 4.2, 1.6],
      butt: [0.12, 3.2, 0.9],
      strike: [0.18, 4.0, 1.2],
      stomp: [0.25, 3.0, 1.0],
      kick: [0.15, 5.2, 1.1],
      spar: [0.20, 1.8, 0.7],
    },
    ramSharp: 1.2, hookToss: 0.5, mockCharge: false, passThrough: 0.8,
    pick: function (L, m, tgt, c) {
      if (c.downed) return "stomp";
      if (c.behind && c.d < c.keep + 1 && Math.random() < 0.3) return "kick";
      if (c.kind === "rival" && Math.random() < 0.4) return "butt";
      if ((c.kind === "man" || c.kind === "small") && c.d > c.keep + 1.2) return "charge";
      return Math.random() < 0.6 ? "hook" : "strike";
    },
    moveAct: { goat_charge: "charge", goat_hook: "hook", goat_strike: "strike", goat_stomp: "stomp", goat_kick: "kick" },
    YM: {
      goat_charge: { id: "goat_charge", style: "ram", pow: 1, dur: 1.0, rng: 0.95, leap: 1.1, cd: 0.9 },
      goat_hook: { id: "goat_hook", style: "gore", pow: 1, dur: 0.7, rng: 0.9, cd: 0.35 },
      goat_strike: { id: "goat_strike", style: "stomp", pow: 1, dur: 0.8, rng: 1.0, cd: 0.4 },
      goat_stomp: { id: "goat_stomp", style: "stomp", pow: 1, dur: 0.9, rng: 1.0, cd: 0.45 },
      goat_kick: { id: "goat_kick", style: "stomp", pow: 1, dur: 0.65, rng: 1.05, cd: 0.5 },
    },
    ymDefault: "goat_strike", ymCharge: "goat_charge", ymStomp: "goat_stomp", ymKick: "goat_kick",
    ymRotation: function (L, n) { return n % 2 === 0 ? "goat_hook" : "goat_strike"; },
  };

  const K = function () { return CBZ.ungulateKit || null; };
  let _def = null;
  const D = function () { return _def || (K() ? (_def = K().def(SPEC)) : null); };
  CBZ.unitKit.register("mountain_goat", {
    kind: "species", stats: STATS,
    build: function (ctx) { const d = D(); return d ? d.build(ctx) : null; },
    animate: function (m, dt) { const k = K(); if (k) k.animate(m, dt); },
    moves: function (m, tgt, ctx) { const k = K(); return k ? k.moves(m, tgt, ctx) : null; },
    fight: function (m, tgt, dt, o) { const k = K(); return k ? k.fight(m, tgt, dt, o) : CBZ.creatureFight(m, tgt, dt, o); },
  });
})();
