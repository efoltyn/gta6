/* ============================================================
   units/species/black_bear.js — the American black bear, Ursus americanus.

   OWNED BY: the bear agent. The body, gait, fight and brain are the one
   bear in units/species/brown_bear.js (CBZ.bearKit); this file is what makes
   it a black bear: its numbers, its shape, its coat, its temperament.

   REFERENCE: male 120 kg (60-300), female 75; shoulder ~0.8 m; no shoulder
   hump and the rump higher than the shoulders; a straight ("Roman") face
   with a long tan muzzle; tall, pointed-rounded ears; short, sharply curved
   DARK claws (a climber's); colour phases black (most), brown, cinnamon,
   often a pale chest blaze. Top speed ~48 km/h. The bear most likely to run:
   a black bear's attacks on people are rare, its bluffs common, and it
   breaks off fast when hurt, unless cornered or it has decided you are prey.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const SPEC = {
    id: "black_bear",
    mass: { m: 120, f: 75 }, femaleK: 0.86,
    stats: {
      hp: 140, spd: 1.3, danger: 0.6, bite: 33, scale: 1, mass: 120,
      chase: 12.5, march: 3.4, dmg: 28, rate: 1.15, brave: false, prey: false,
    },
    body: {
      fa: 0.30, fb: 0.27, fc: 0.15, ha: 0.34, hb: 0.29, hc: 0.22, pawH: 0.045,
      sh: 0.57, hip: 0.63, shX: 0.33, hipX: -0.40, legZf: 0.135, legZh: 0.135,
      chest: [0.23, 0.24, 0.225], waist: [0.23, 0.23, 0.225], rump: [0.24, 0.23, 0.23],
      rumpBack: 0.21, rumpLift: 0.035, shLift: 0.0, hump: 0.0,
      neck: { len: 0.26, ang: 0.02, r: 0.18, w: 0.16, rEnd: 0.12, wEnd: 0.125 },
      head: { ang: -0.16, L: 0.34, skull: 0.11, skullB: 0.10, skullW: 0.125, brow: 0.0, dish: 0.0, roman: 0.25, stop: 0.15, muzzleR: 0.062, muzzleW: 0.055, cheek: 1.0 },
      ear: { h: 0.085, w: 0.06, z: 0.072, x: 0.02, up: 0.9, tilt: 0.18 },
      eye: { r: 0.012, d: 0.145, y: 0.03, z: 0.054 },
      tail: { len: 0.1, r: 0.04 },
      claws: { f: 0.042, h: 0.032 },
      paw: { fw: 0.06, hw: 0.054 },
      limb: { arm: 0.12, fore: 0.08, wrist: 0.055, thigh: 0.14, shin: 0.075, ankle: 0.054 },
    },
    coats: ["black", "black", "black", "blaze", "brown", "cinnamon"],
    coat: function (D, coat, seed, U) {
      const pal = {
        black: { base: 0x171513, sheen: 0x2c2a27, leg: 0x100f0e },
        blaze: { base: 0x171513, sheen: 0x2c2a27, leg: 0x100f0e },
        brown: { base: 0x4a3222, sheen: 0x6a4a32, leg: 0x2c1e14 },
        cinnamon: { base: 0x7b4b28, sheen: 0x9c6a3e, leg: 0x4a2c18 },
      }[coat];
      const MUZ = 0x9a7652, k = D.k;
      return function (part, x, y, z, ca, sa, R) {
        if (R && R.tag === "nose") return 0x2a2420;
        if (part === "eye") return 0x0d0907;
        if (part === "claw") return 0x1a1612;
        if (part === "tooth") return 0xe6dcc6;
        const n = U.fnoise(x, y, z, 11 / k);
        let c = U.mixHex(pal.base, pal.sheen, U.clamp(ca * 0.5 + n * 0.3, 0, 1) * 0.6);
        if (part === "head") {
          if (R && R.muz) c = R.muz >= 4 ? U.mixHex(MUZ, 0x3a2a1c, 0.5) : MUZ;
          if (R && R.muz && ca < -0.55) c = 0x2a1f19;
        } else if (part === "jaw") c = ca > 0.5 ? 0x6b3b38 : U.mixHex(MUZ, 0x2a1f19, 0.35);
        else if (part === "ear") c = ca < -0.2 ? 0x2a2420 : pal.base;
        else if (part === "leg" || part === "paw" || part === "arm" || part === "thigh") c = U.mixHex(c, pal.leg, U.clamp((D.sh - y) / (0.3 * k), 0, 1));
        if (part === "paw" && ca < -0.35) c = 0x1b1512;
        // the pale chest V
        if (coat === "blaze" && (part === "torso" || part === "neck") && ca < -0.55 && x > D.shX - 0.04 * k && x < D.shX + 0.3 * k && Math.abs(sa) < 0.55) c = 0xd8cfbf;
        return c;
      };
    },
    behave: {
      walk: 1.3, amble: 3.4, top: 12.5, accel: 5.5, decel: 9.5, sprintS: 18, recoverS: 40, turnRate: 5.0,
      nerve: 0.45, hitFear: 2.4, hitAnger: 0.8, fearDecay: 0.03, angerHold: 0.4, woundBrave: false,
      gunFear: 0.3, vehicleFear: 1.2, bigFear: 0.8, bluffP: 0.6, bluffRetreat: 0.75, lookP: 0.65,
      chargeDist: 35, predatory: false, toDeathHp: 0.12, rearPitch: 1.28,
      swat: { mEff: 0.08, v: 7.5 }, slamV: 3.0, biteN: 3000, clawCm: 4.5,
    },
  };
  function kit() { return CBZ.bearKit ? CBZ.bearKit.unit(SPEC) : null; }
  let U = null;
  function u() { if (!U) { U = kit(); if (U && CBZ.bearKit.stampRow) CBZ.bearKit.stampRow(SPEC); } return U; }
  CBZ.unitKit.register("black_bear", {
    kind: "species",
    stats: SPEC.stats,
    build: function (ctx) {
      const k = u(), g = k ? k.build(ctx) : null;
      if (g) return g;
      const row = CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES[SPEC.id];        // the bestiary body, if the kit failed to load
      return row && row.build ? row.build(ctx) : null;
    },
    animate: function (m, dt) { const k = u(); if (k) k.animate(m, dt); },
    moves: function (m, tgt, ctx) { const k = u(); return k ? k.moves(m, tgt, ctx) : null; },
    fight: function (m, tgt, dt, opts) { const k = u(); return k ? k.fight(m, tgt, dt, opts) : (CBZ.creatureFight ? CBZ.creatureFight(m, tgt, dt, opts) : null); },
  });
})();
