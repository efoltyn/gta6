/* ============================================================
   units/species/cheetah.js — the cheetah, Acinonyx jubatus.

   OWNED BY: the cheetah agent. The animal is DATA here; the cat engine that
   builds, walks and fights it is src/units/kit/felid.js (shared with the snow
   leopard). `needs` in units/manifest.js loads the kit first.

   WHAT IT IS (real numbers; adult)
     mass         males ~50 kg, females ~40 kg (21-72 kg range)
     size         shoulder 0.70-0.90 m, head+body 1.1-1.5 m, tail 0.6-0.8 m
     build        a sprinter: small round head, high-set eyes, black tear
                  lines, deep narrow chest, wasp waist, long thin legs,
                  non-retractile claws, a flat tail that is a rudder
     speed        ~29 m/s recorded; hunts are run at 15-25 m/s; 0 -> 20 m/s
                  in ~2-3 s (peak ~10-13 m/s^2); stride ~3 Hz at the top
     endurance    a sprint lasts 20-30 s / ~300-400 m, then it must rest
                  (minutes, compressed here to tens of seconds)
     kill         trips the prey with a forepaw hook (the dewclaw) at speed,
                  then a suffocating throat clamp; a weak bite, small canines
     nerve        avoids every larger predator, loses most kills to lions and
                  hyenas, gives up a hunt after a failed rush; rarely faces
                  people. Thin hide: hp below a man's.
   HOW THE BATTLE FIGHTS IT
     stalk low to ~55 m, then a real sprint with acceleration; trip, clamp the
     throat (a man is held down until he suffocates or someone shoots it); a
     wound, a bigger predator or a machine sends it running; spent, it stands
     and pants; cornered and spent, it turns and swats.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const STATS = {
    hp: 75, spd: 1.4, danger: 0.5, bite: 9, scale: 1,
    chase: 26, march: 2.2, dmg: 9, rate: 1.0,
    brave: false, prey: false,
  };
  const SPEC = {
    id: "cheetah", style: "courser", stats: STATS,
    maleShare: 0.5, indVar: 0.035,
    mass: { m: 50, f: 40 },
    female: { len: 0.94, girth: 0.95, hp: 0.86, speed: 0.98 },
    body: {
      withers: 0.80,
      sh: [0.40, 0.60], hip: [-0.36, 0.60],
      fa: 0.25, fb: 0.27, fc: 0.095, ha: 0.27, hb: 0.29, hc: 0.18,
      paw: [0.034, 0.022, 0.026], zf: 0.072, zh: 0.068, legT: 0.95,
      footOff: [0.03, 0.07],
      // [x, y, rt (up), rb (down), w (half width), pelvis weight]: rump -> point of shoulder
      torso: [
        [-0.54, 0.66, 0.05, 0.06, 0.045, 1],
        [-0.48, 0.655, 0.1, 0.11, 0.07, 1],
        [-0.38, 0.645, 0.125, 0.135, 0.08, 1],
        [-0.26, 0.665, 0.1, 0.09, 0.072, 0.9],
        [-0.12, 0.68, 0.085, 0.072, 0.064, 0.65],
        [0.02, 0.67, 0.115, 0.1, 0.075, 0.35],
        [0.15, 0.645, 0.165, 0.16, 0.085, 0.1],
        [0.28, 0.625, 0.19, 0.205, 0.092, 0],
        [0.39, 0.635, 0.18, 0.18, 0.09, 0],
        [0.49, 0.645, 0.125, 0.125, 0.078, 0],
        [0.54, 0.665, 0.07, 0.085, 0.058, 0],
      ],
      neck: { b: [0.44, 0.70], h: [0.71, 0.80],
        r: [[0.15, 0.17, 0.085], [0.1, 0.115, 0.07], [0.068, 0.078, 0.058], [0.056, 0.06, 0.05], [0.05, 0.052, 0.047]] },
      head: {
        ang: -0.12,
        // [d along the head axis, dy, rt, rb, w, superellipse]: occiput -> nose
        st: [
          [-0.045, 0.006, 0.042, 0.046, 0.046],
          [-0.018, 0.011, 0.064, 0.056, 0.061],
          [0.015, 0.01, 0.068, 0.055, 0.066, 0.95],
          [0.048, 0.004, 0.06, 0.052, 0.06, 0.95],
          [0.075, -0.006, 0.048, 0.047, 0.05],
          [0.097, -0.013, 0.04, 0.041, 0.041, 0.9],
          [0.116, -0.017, 0.034, 0.035, 0.035, 0.9],
          [0.131, -0.019, 0.025, 0.026, 0.026],
        ],
        jaw: [0.0, -0.034, 0.112, -0.042, 0.018, 0.044],
        eye: [0.062, 0.022, 0.047, 0.0125],
        ear: [-0.018, 0.052, 0.04, 0.036, 0.046, 0.45],
        canine: [0.109, -0.037, 0.017, 0.015],
        // the black tear line: inner eye corner -> mouth corner, half-width, cheek |z|
        tear: [0.074, 0.006, 0.11, -0.04, 0.0042, 0.018],
      },
      tail: { root: [-0.5, 0.69], L: 0.72,
        prof: [0.038, 0.032, 0.029, 0.027, 0.025, 0.024, 0.023, 0.023, 0.024, 0.024, 0.016],
        rest: [1.15, -0.5] },
    },
    coat: {
      mode: 0, headMode: 0, legMode: 0, tailMode: 0,
      headScale: 0.45, tailScale: 0.95, bellySpots: 0.6,
      tailBand: 0.58, tipFrom: 0.93, bands: 9,
      cell: 0.034, spotR: 0.0095, ink: 0x16120f, claw: 0.0045,
      tints: [0xcf9440, 0xc4883a, 0xd8a050],
      pal: {
        base: 0xcc8f3e, back: 0xb87a30, belly: 0xf0e6d4, muzzle: 0xe6d2b0, lip: 0x1c1714,
        mouth: 0x5a2a2a, tongue: 0x9a5050, nose: 0x3a2a26, earIn: 0xe8dcc4, earBack: 0x1c1916,
        earSpot: null, pupil: 0x0d0b0a, iris: 0xc08a2c, lid: 0x1a1612, pad: 0x2e2622,
        tip: 0xf2ece0, tooth: 0xeee6d2, claw: 0x2a2420,
      },
    },
    gait: { flexAt: 0.625, spine: 1.0, crouchK: 1, foreA: 0.25, hindA: 0.42, tailRun: 0.35, tailRunCurl: -0.12 },
    // FL FR HL HR. Lateral-sequence walk, a little-used trot, the ROTARY
    // gallop (HR HL then FL FR, two flights) and the sprint (duty ~0.17)
    gaitTable: {
      gaits: [
        { name: "walk", key: "wW", off: [0.75, 0.25, 0.00, 0.50], duty: 0.64, lift: 0.045 },
        { name: "trot", key: "wT", off: [0.75, 0.25, 0.25, 0.75], duty: 0.42, lift: 0.065 },
        { name: "gallop", key: "wG", off: [0.75, 0.65, 0.20, 0.30], duty: 0.30, lift: 0.1 },
        { name: "sprint", key: "wS", off: [0.75, 0.65, 0.20, 0.30], duty: 0.17, lift: 0.13 },
      ],
      trans: [[1.4, 2.0], [3.3, 4.6], [9, 14]],
      fOf: function (v) { return v < 6 ? 0.55 + 0.3 * v : 2.35 + (v - 6) * 0.035; },
      fMax: 3.4, f0: 1, fV: 0.15, strideMax: 6,
      vMove: 0.08, turnMove: 0.35, turnF: 1.4,
      settleRate: 2.6, restLift: 0.04, restStep: 0.07,
    },
    loco: {
      vmax: 28, accel: 10, decel: 9, trot: 3.5, march: 2.2, stalk: 1.3, stalkFrom: 110, burst: 55,
      leapV: 0, sprintSecs: 22, recover: 1 / 50, restBelow: 0.12, restUntil: 0.55, turnRate: 7,
    },
    leap: null,
    mind: {
      bigRatio: 1.15, hugeRatio: 5, fearRange: 35, vehFear: 1.2, bigFear: 1.0, gunFear: 0.25,
      hurtFear: 3.0, lowHp: 0.5, lowHpFear: 0.12, fearDecay: 0.06, fleeAt: 0.6, rallyAt: 0.2,
      holdBreak: 0.08, giveUpFails: 3, lieAfter: 9,
    },
    // dmg: one blow to a man (100 hp), before the battle's size/hunger factor
    // and the target's own soak (bodymass.js)
    moves: {
      trip: { dur: 0.5, at: 0.45, reach: 0.95, dmg: 4, kd: { base: 0.2, perV: 0.045, mass: 0.25, dur: 2.8 }, cool: 0.5 },
      swat: { dur: 0.6, at: 0.55, reach: 0.75, dmg: 5, cool: 0.7 },
      bite: { dur: 0.5, at: 0.52, reach: 0.5, dmg: 9, cool: 0.6 },
      throat: { dur: 1.2, at: 0.25, reach: 0.9, dmg: 5, hold: true, dps: 7, cool: 0.5 },
    },
  };
  let H = null;
  function kit() { if (!H && CBZ.felidKit) H = CBZ.felidKit.hooks(SPEC); return H; }
  CBZ.unitKit.register("cheetah", {
    kind: "species", stats: STATS, spec: SPEC,
    build: function (ctx) {
      const k = kit();
      if (k) { const g = k.build(ctx); if (g) return g; }
      const sp = CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES.cheetah;
      return sp && sp.build ? sp.build(ctx) : null;
    },
    animate: function (m, dt) { const k = kit(); if (k) k.animate(m, dt); },
    fight: function (m, t, dt, o) { const k = kit(); return k ? k.fight(m, t, dt, o) : CBZ.creatureFight(m, t, dt, o); },
    preview: function (m, move, phase) { const k = kit(); if (k) k.preview(m, move, phase); },
    // a player who takes this animal over: ATTACK throws its real moves (kit/moves.js)
    moves: function (m, t, ctx) { const k = kit(); return k ? k.moves(m, t, ctx) : null; },
  });
  // the real mean mass on the species row (bodymass.js: an authored mass wins)
  const row = CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES.cheetah;
  if (row) row.mass = 45;
})();
