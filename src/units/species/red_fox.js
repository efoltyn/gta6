/* ============================================================
   units/species/red_fox.js — the red fox (Vulpes vulpes) as NPC War fights it.

   OWNED BY: the canid agent. Body, gait, life and close fight are the canid
   family's shared rig, src/units/kit/canid.js; this file is the animal's data.

   REFERENCE (Larivière & Pasitschniak-Arts, Mammalian Species 537, 1996;
   Macdonald, "Running with the Fox"):
     shoulder height  0.35-0.50 m (male ~0.41)
     head + body      0.46-0.86 m (~0.65), tail 0.3-0.55 m: the brush is
                      ~70% of the body's length and nearly as thick as a leg
                      is long
     mass             male ~5.9 kg, female ~5.2 kg
     build            long and low, slender muzzle, LARGE pointed ears,
                      vertical-slit pupils (a canid that hunts like a cat),
                      light bones, small feet
     speed            sprints to ~48-50 km/h (13-14 m/s); the mousing pounce
     bite             ~250 N
     coat             rufous orange, white chin, throat, chest and belly,
                      BLACK "stockings" on the lower legs, black backs to the
                      ears, a white tail tip; the cross phase has a dark
                      cross over the shoulders and darker flanks
   HOW IT FIGHTS: it does not, given the choice. It takes rodents, rabbits,
   birds. Against anything its own size or bigger it gapes, arches, screams
   and keeps away, darting in only at something already beaten or turned
   away, and it runs the moment it is hurt. A skulk of foxes on a man is a
   swarm of ankle bites, not a takedown.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const P = {
    name: "red fox",
    body: {
      withers: 0.41, sh: 0.305, hipH: 0.305, bodyL: 0.42,
      chestRt: 0.064, chestRb: 0.098, chestW: 0.058, waistRt: 0.05, waistRb: 0.042, waistW: 0.048,
      rumpR: 0.06, rumpW: 0.054, neckR: 0.04, neckLen: 0.15, neckAng: 0.7, ruff: 1.12,
      skullR: 0.04, skullW: 0.044, headL: 0.085, headAng: -0.28, muzzleL: 0.08, muzzleR: 0.02, muzzleW: 0.019,
      earL: 0.085, earW: 0.066, tailL: 0.42, tailR: 0.05,
      fa: 0.11, fb: 0.13, fc: 0.075, ha: 0.12, hb: 0.14, hc: 0.1, legR: 1.2, pawR: 0.02,
    },
    fLin: 0.96, fGirth: 0.94,
    earTip: 0.05, tailRest: 1.0, tailHook: 0, eyeK: 1.1, howl: false, pupilSlit: true,
    tailProf: [0.5, 0.85, 1.1, 1.25, 1.3, 1.28, 1.15, 0.9, 0.45],
    stats: {
      hp: 16, spd: 1.1, danger: 0.1, bite: 4,
      chase: 11, march: 2.8, dmg: 4, rate: 0.85,
      mass: 5.6, topSpeed: 13.9, accel: 8, endurance: 20, biteN: 250, hide: 0.15,
    },
    fight: { bold: 0.22, turn: 10, lungeT: 0.22, holdT: 0.6, shake: 0.35, tire: 1.2, opportunist: true },
    coats: {
      red: { base: 0xc4651f, saddle: 0xb2581b, cape: 0xaa5219, under: 0xf0ebe2, bib: 0xf4f0ea, band: 0xe0954a, tip: 0x6a3110,
        crown: 0xb95c1d, cheek: 0xcf7a36, mask: 0xf4f0ea, muzzleTop: 0xb85c22, chin: 0xf4f0ea,
        earBack: 0x1c1714, earTip: 0x141210, earIn: 0xf0e6d6, earRim: 0x1a1614,
        tailTop: 0xb8591c, tailUnder: 0xcc7c3e, tailTip: 0xf2eee6, gland: 0x6a3010, tipFrom: 0.87,
        leg: 0xa95219, stocking: 0x1f1814, pants: 0xe8dfd0, paw: 0x1a1614, eye: 0xd89a20, grizzle: 0.25 },
      cross: { base: 0x9c5428, saddle: 0x3e2c22, cape: 0x2c2019, under: 0xb8a490, bib: 0x9a8a7a, band: 0xc0783a, tip: 0x1c1410,
        crown: 0x7e4a28, cheek: 0xa4683a, mask: 0xd8cfc2, muzzleTop: 0x5a3a26, chin: 0xcfc4b6,
        earBack: 0x161210, earTip: 0x100e0c, earIn: 0xd8ccbc, earRim: 0x141110,
        tailTop: 0x5a3a26, tailUnder: 0x8a5a36, tailTip: 0xeee8de, gland: 0x2a1c14, tipFrom: 0.88,
        leg: 0x3a2a20, stocking: 0x18120f, pants: 0x9a8a78, paw: 0x141110, eye: 0xd89a20, grizzle: 0.5 },
    },
    coatW: { red: 6, cross: 1 },
  };
  const C = CBZ.canid;
  if (C) C.define("red_fox", P);
  const H = C ? C.hooks("red_fox") : {};
  CBZ.unitKit.register("red_fox", {
    kind: "species",
    stats: C ? C.stats(P) : Object.assign({ scale: 1, brave: false, prey: false }, P.stats),
    build: H.build, animate: H.animate, fight: H.fight, moves: H.moves,
  });
  const row = CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES.red_fox;
  if (row) row.mass = P.stats.mass;
})();
