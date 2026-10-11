/* ============================================================
   units/species/snow_leopard.js — the snow leopard, Panthera uncia.

   OWNED BY: the snow leopard agent. The animal is DATA here; the cat engine
   is src/units/kit/felid.js (shared with the cheetah). `needs` in
   units/manifest.js loads the kit first.

   WHAT IT IS (real numbers; adult)
     mass         males ~45 kg, females ~37 kg (22-55 kg range)
     size         shoulder ~0.56-0.62 m, head+body 0.9-1.3 m, tail 0.8-1.05 m
     build        a mountain ambusher: low and stocky, a barrel chest under
                  thick fur, hind legs longer than fore (the rump stands
                  higher), huge furry paws, a short broad head with a domed
                  brow, small rounded ears, pale green-grey eyes, and a tail
                  nearly as long as the body and as thick as a forearm
                  (balance on ledges, a blanket at rest)
     coat         smoky grey to cream, dark grey open rosettes on the body,
                  solid spots on head, neck and legs, a dark-tipped tail
     speed        bursts to ~16-18 m/s over short distances; a chase rarely
                  runs past a few hundred metres
     kill         stalks from rocks, then a long pounce (6-9 m, more from
                  above), knocks the prey down, bites the nape or the throat;
                  takes prey three times its own weight
     nerve        famously shy of people (no verified fatal attack), gives
                  ground to bears and wolves packs, but a cornered or pinned
                  one fights hard
   HOW THE BATTLE FIGHTS IT
     a slow stalk, then the leap (longer from higher ground), the pin and a
     nape/throat hold; a man is wrestled down from a rear-up; it breaks off
     when hurt badly, runs from bears, tigers and machines, and lies down
     when there is nothing to do.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const STATS = {
    hp: 85, spd: 1.2, danger: 0.65, bite: 16, scale: 1,
    chase: 16, march: 1.9, dmg: 16, rate: 1.0,
    brave: false, prey: false,
  };
  const SPEC = {
    id: "snow_leopard", style: "ambusher", stats: STATS,
    maleShare: 0.5, indVar: 0.04,
    mass: { m: 45, f: 37 },
    female: { len: 0.94, girth: 0.95, hp: 0.88, speed: 0.98 },
    body: {
      withers: 0.60,
      sh: [0.33, 0.44], hip: [-0.33, 0.47],
      fa: 0.2, fb: 0.19, fc: 0.07, ha: 0.23, hb: 0.24, hc: 0.15,
      paw: [0.046, 0.03, 0.042], zf: 0.085, zh: 0.08, legT: 1.6,
      footOff: [0.03, 0.05],
      torso: [
        [-0.5, 0.48, 0.077, 0.088, 0.081, 1],
        [-0.44, 0.48, 0.143, 0.154, 0.127, 1],
        [-0.33, 0.475, 0.165, 0.182, 0.138, 1],
        [-0.2, 0.47, 0.154, 0.176, 0.132, 0.85],
        [-0.06, 0.46, 0.143, 0.171, 0.129, 0.6],
        [0.08, 0.45, 0.165, 0.187, 0.138, 0.3],
        [0.2, 0.44, 0.182, 0.198, 0.144, 0.05],
        [0.32, 0.445, 0.176, 0.187, 0.138, 0],
        [0.42, 0.455, 0.143, 0.149, 0.115, 0],
        [0.47, 0.47, 0.088, 0.099, 0.081, 0],
      ],
      neck: { b: [0.38, 0.5], h: [0.57, 0.555],
        r: [[0.14, 0.16, 0.11], [0.11, 0.125, 0.095], [0.085, 0.095, 0.08], [0.07, 0.075, 0.068], [0.06, 0.062, 0.06]] },
      head: {
        ang: -0.1,
        st: [
          [-0.045, 0.006, 0.05, 0.054, 0.056],
          [-0.015, 0.014, 0.072, 0.062, 0.074],
          [0.018, 0.014, 0.075, 0.06, 0.078, 0.95],
          [0.048, 0.006, 0.064, 0.056, 0.068, 0.95],
          [0.07, -0.006, 0.05, 0.053, 0.056],
          [0.088, -0.014, 0.043, 0.047, 0.047, 0.88],
          [0.105, -0.018, 0.037, 0.041, 0.04, 0.88],
          [0.118, -0.02, 0.028, 0.03, 0.03],
        ],
        jaw: [0.0, -0.04, 0.104, -0.046, 0.021, 0.05],
        eye: [0.056, 0.03, 0.04, 0.0115],
        ear: [-0.022, 0.058, 0.046, 0.032, 0.04, 0.5],
        canine: [0.098, -0.042, 0.019, 0.017],
        tear: null,
      },
      tail: { root: [-0.47, 0.53], L: 0.95,
        prof: [0.062, 0.06, 0.058, 0.057, 0.056, 0.056, 0.056, 0.055, 0.054, 0.051, 0.04],
        rest: [1.25, -0.65] },
    },
    coat: {
      mode: 1, headMode: 0, legMode: 0, tailMode: 1,
      headScale: 0.4, tailScale: 1.15, bellySpots: 0.3,
      tailBand: 0.86, tipFrom: 2, bands: 0,
      cell: 0.045, spotR: 0.011, rosR: 0.03, ink: 0x2a2624, claw: 0.003,
      tints: [0xb3aa96, 0xbfb092, 0xa39d90],
      pal: {
        base: 0xb2a996, back: 0x9c917c, belly: 0xeeebe4, muzzle: 0xe2ddd3, lip: 0x2a2624,
        mouth: 0x5a3030, tongue: 0xa05a5a, nose: 0x8a6a64, earIn: 0xe6e2da, earBack: 0x2e2b29,
        earSpot: 0xb8b4ac, pupil: 0x0c0c0c, iris: 0x9aa58a, lid: 0x2a2826, pad: 0x4a3e3a,
        tip: 0x2a2826, tooth: 0xeee6d2, claw: 0x8a8478,
      },
    },
    gait: { flexAt: 0.625, spine: 0.75, crouchK: 0.8, foreA: 0.22, hindA: 0.4, tailRun: 0.55, tailRunCurl: -0.35 },
    gaitTable: {
      gaits: [
        { name: "walk", key: "wW", off: [0.75, 0.25, 0.00, 0.50], duty: 0.66, lift: 0.045 },
        { name: "trot", key: "wT", off: [0.75, 0.25, 0.25, 0.75], duty: 0.44, lift: 0.06 },
        { name: "gallop", key: "wG", off: [0.75, 0.65, 0.20, 0.30], duty: 0.32, lift: 0.09 },
        { name: "bound", key: "wS", off: [0.75, 0.68, 0.22, 0.28], duty: 0.24, lift: 0.11 },
      ],
      trans: [[1.2, 1.8], [3.0, 4.2], [8, 11]],
      fOf: function (v) { return v < 7 ? 0.5 + 0.3 * v : 2.6 + (v - 7) * 0.045; },
      fMax: 3.4, f0: 1, fV: 0.15, strideMax: 6,
      vMove: 0.08, turnMove: 0.35, turnF: 1.4,
      settleRate: 2.6, restLift: 0.04, restStep: 0.06,
    },
    loco: {
      vmax: 17, accel: 9, decel: 10, trot: 3.2, march: 1.9, stalk: 1.4, stalkFrom: 35, burst: 14,
      leapV: 11, sprintSecs: 14, recover: 1 / 45, restBelow: 0.1, restUntil: 0.5, turnRate: 6,
    },
    leap: { range: 9, height: 0.9, cool: 4 },
    mind: {
      bigRatio: 2.5, hugeRatio: 7, fearRange: 25, vehFear: 0.8, bigFear: 0.6, gunFear: 0.12,
      hurtFear: 1.3, lowHp: 0.35, lowHpFear: 0.1, fearDecay: 0.08, fleeAt: 0.95, rallyAt: 0.3,
      holdBreak: 0.2, giveUpFails: 5, lieAfter: 9,
    },
    moves: {
      pin: { dur: 0.7, at: 0.35, reach: 1.0, dmg: 14, impact: 8, kd: { base: 0.45, perV: 0.03, mass: 0.35, dur: 3.2 }, cool: 0.4 },
      grapple: { dur: 1.0, at: 0.55, reach: 0.9, dmg: 13, kd: { base: 0.25, perV: 0, mass: 0.45, dur: 3 }, cool: 0.6 },
      swat: { dur: 0.55, at: 0.5, reach: 0.85, dmg: 8, cool: 0.6 },
      bite: { dur: 0.5, at: 0.5, reach: 0.55, dmg: 14, cool: 0.6 },
      nape: { dur: 1.2, at: 0.25, reach: 0.95, dmg: 8, hold: true, dps: 12, cool: 0.5 },
    },
  };
  let H = null;
  function kit() { if (!H && CBZ.felidKit) H = CBZ.felidKit.hooks(SPEC); return H; }
  CBZ.unitKit.register("snow_leopard", {
    kind: "species", stats: STATS, spec: SPEC,
    build: function (ctx) {
      const k = kit();
      if (k) { const g = k.build(ctx); if (g) return g; }
      const sp = CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES.snow_leopard;
      return sp && sp.build ? sp.build(ctx) : null;
    },
    animate: function (m, dt) { const k = kit(); if (k) k.animate(m, dt); },
    fight: function (m, t, dt, o) { const k = kit(); return k ? k.fight(m, t, dt, o) : CBZ.creatureFight(m, t, dt, o); },
    preview: function (m, move, phase) { const k = kit(); if (k) k.preview(m, move, phase); },
  });
  const row = CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES.snow_leopard;
  if (row) row.mass = 41;
})();
