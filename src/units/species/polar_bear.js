/* ============================================================
   units/species/polar_bear.js — the polar bear, Ursus maritimus.

   OWNED BY: the bear agent. The body, gait, fight and brain are the one
   bear in units/species/brown_bear.js (CBZ.bearKit); this file is what makes
   it a polar bear: its numbers, its shape, its coat, its temperament.

   REFERENCE: male 450 kg (350-700), female 230; shoulder ~1.3 m; the
   largest land carnivore. A LONG neck and a small, long head with a Roman
   (convex) nose; tiny ears; the hindquarters higher than the shoulders;
   huge paws (~30 cm) furred between the pads; short, thick, dark claws;
   black skin at the nose, lips and eye rims under a cream-white coat that
   yellows on the lower legs. A predator that stalks and then rushes; it
   overheats in a long run (top ~40 km/h, held only briefly). The bear that
   treats a man as food, so it commits and does not stop to make a point.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const SPEC = {
    id: "polar_bear",
    mass: { m: 450, f: 230 }, femaleK: 0.84, shag: 0.016, fringe: 0.045,
    stats: {
      hp: 330, spd: 1.5, danger: 0.8, bite: 61, scale: 1, mass: 450,
      chase: 11, march: 3.2, dmg: 103, rate: 1.0, brave: true, prey: false,
    },
    body: {
      fa: 0.42, fb: 0.37, fc: 0.25, ha: 0.46, hb: 0.39, hc: 0.33, pawH: 0.065,
      sh: 0.80, hip: 0.89, shX: 0.52, hipX: -0.62, legZf: 0.20, legZh: 0.195,
      chest: [0.33, 0.35, 0.32], waist: [0.33, 0.33, 0.32], rump: [0.34, 0.31, 0.31],
      rumpBack: 0.28, rumpLift: 0.05, shLift: 0.0, hump: 0.02,
      neck: { len: 0.56, ang: 0.10, r: 0.25, w: 0.22, rEnd: 0.14, wEnd: 0.135 },
      head: { ang: -0.22, L: 0.42, skull: 0.115, skullB: 0.11, skullW: 0.125, brow: 0.0, dish: 0.0, roman: 0.4, stop: 0.17, muzzleR: 0.078, muzzleW: 0.064, cheek: 0.98 },
      ear: { h: 0.048, w: 0.055, z: 0.085, x: 0.0, up: 0.78, tilt: 0.2 },
      eye: { r: 0.012, d: 0.175, y: 0.032, z: 0.058 },
      tail: { len: 0.12, r: 0.05 },
      claws: { f: 0.05, h: 0.04 },
      paw: { fw: 0.11, hw: 0.10 },
      limb: { arm: 0.175, fore: 0.12, wrist: 0.088, thigh: 0.2, shin: 0.11, ankle: 0.082 },
    },
    coats: ["cream", "cream", "white", "yellow"],
    coat: function (D, coat, seed, U) {
      const pal = {
        cream: { base: 0xe8e1cc, low: 0xd6c8a2 },
        white: { base: 0xf0ece0, low: 0xe0d6bc },
        yellow: { base: 0xe2d4ae, low: 0xcbb784 },
      }[coat];
      const k = D.k, SKIN = 0x111010;
      return function (part, x, y, z, ca, sa, R) {
        if (R && R.tag === "nose") return SKIN;
        if (part === "eye") return 0x080606;
        if (part === "claw") return 0x2b2621;
        if (part === "tooth") return 0xe6dcc6;
        const n = U.fnoise(x, y, z, 10 / k);
        // white on top, yellowed toward the belly and down the legs
        let c = U.mixHex(pal.base, pal.low, U.clamp(0.5 - ca * 0.6 + n * 0.15, 0, 1) * 0.7);
        if (part === "leg" || part === "paw" || part === "arm" || part === "thigh") c = U.mixHex(c, pal.low, U.clamp((D.sh - y) / (0.4 * k), 0, 1));
        if (part === "head" && R && R.muz && ca < -0.55) c = SKIN;            // black lips
        if (part === "jaw") c = ca > 0.5 ? 0x2a1c1e : (ca > 0.1 ? SKIN : pal.low);
        if (part === "ear") c = ca < -0.2 ? 0x8f8a80 : pal.base;
        if (part === "paw" && ca < -0.45) c = 0x1a1716;                       // footpads
        return c;
      };
    },
    behave: {
      walk: 1.5, amble: 3.2, top: 11.0, accel: 4.0, decel: 8.0, sprintS: 12, recoverS: 60, turnRate: 4.0,
      nerve: 1.4, hitFear: 0.7, hitAnger: 1.6, fearDecay: 0.04, angerHold: 0.6, woundBrave: true,
      gunFear: 0.03, vehicleFear: 0.6, bigFear: 0.4, bluffP: 0.08, bluffRetreat: 0.3, lookP: 0.45,
      chargeDist: 40, predatory: true, toDeathHp: 0.35, rearPitch: 1.2,
      swat: { mEff: 0.08, v: 8.5 }, slamV: 3.2, biteN: 5500, clawCm: 6, hide: 3.5,
    },
  };
  function kit() { return CBZ.bearKit ? CBZ.bearKit.unit(SPEC) : null; }
  let U = null;
  function u() { if (!U) { U = kit(); if (U && CBZ.bearKit.stampRow) CBZ.bearKit.stampRow(SPEC); } return U; }
  CBZ.unitKit.register("polar_bear", {
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
