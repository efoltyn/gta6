/* ============================================================
   units/species/arctic_wolf.js — the Arctic wolf (Canis lupus arctos) as
   NPC War fights it.

   OWNED BY: the canid agent. Body, gait, life and close fight are the canid
   family's shared rig, src/units/kit/canid.js; this file is the animal's data.

   REFERENCE (Mech, "The Arctic Wolf: Living with the Pack"; Ellesmere Island
   measurements):
     shoulder height  0.64-0.79 m (male ~0.74)
     mass             32-70 kg, males ~45 kg; heavier-boned than southern
                      gray wolves (Bergmann's rule)
     build            SHORTER muzzle, SMALLER rounder ears, shorter legs, a
                      thick double coat (the ruff and the brush much fuller):
                      everything that loses heat is cut down
     coat             white to cream all year, a faint buff saddle; black
                      nose, lips and pads, amber eyes
     speed / bite     as the gray wolf: travel trot all day, sprints to
                      ~55 km/h, ~1,400-1,500 N bite
   HOW IT FIGHTS: muskoxen and caribou. Muskoxen form a ring, horns out; the
   pack tests it, rushes to break it, and takes the animal that bolts from
   behind. The same canid repertoire as the gray wolf, a little bolder.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const P = {
    name: "Arctic wolf",
    body: {
      withers: 0.74, sh: 0.565, hipH: 0.555, bodyL: 0.66,
      chestRt: 0.135, chestRb: 0.205, chestW: 0.128, waistRt: 0.108, waistRb: 0.095, waistW: 0.108,
      rumpR: 0.118, rumpW: 0.108, neckR: 0.086, neckLen: 0.23, neckAng: 0.62, ruff: 1.3,
      skullR: 0.077, skullW: 0.08, headL: 0.135, headAng: -0.28, muzzleL: 0.11, muzzleR: 0.044, muzzleW: 0.043,
      earL: 0.07, earW: 0.082, tailL: 0.42, tailR: 0.068,
      fa: 0.2, fb: 0.225, fc: 0.12, ha: 0.21, hb: 0.235, hc: 0.14, legR: 1.45, pawR: 0.036,
    },
    fLin: 0.95, fGirth: 0.93,
    earTip: 0.45, tailRest: 1.15, tailHook: 0, eyeK: 0.95, howl: true,
    tailProf: [0.6, 0.95, 1.18, 1.3, 1.32, 1.25, 1.08, 0.8, 0.4],
    stats: {
      hp: 66, spd: 1.4, danger: 0.6, bite: 16,
      chase: 12, march: 3.3, dmg: 18, rate: 1.1,
      mass: 43, topSpeed: 16, accel: 6.5, endurance: 60, biteN: 1450, hide: 0.3,
    },
    fight: { bold: 0.66, turn: 7.2, lungeT: 0.32, holdT: 1.7, shake: 0.32, tire: 0.95, opportunist: false },
    coats: {
      white: { base: 0xe9e6de, saddle: 0xd6cfc2, cape: 0xd2cabc, under: 0xf4f2ec, bib: 0xf6f4f0, band: 0xe6ddcb, tip: 0xbdb3a4,
        crown: 0xe2ddd3, cheek: 0xeeebe4, mask: 0xf6f4f0, brow: 0xf6f4f0, muzzleTop: 0xe0dad0, chin: 0xf4f2ec,
        earBack: 0xdcd5c9, earTip: 0xc9bfb1, earIn: 0xf0ece4, earRim: 0xbfb5a7,
        tailTop: 0xddd6ca, tailUnder: 0xf0ece6, tailTip: 0xd2cabd, gland: 0xc8bdae, tipFrom: 0.88,
        leg: 0xebe6dc, pants: 0xf4f2ec, paw: 0xddd5c8, eye: 0xc89a2a, grizzle: 0.3 },
      cream: { base: 0xe6dac4, saddle: 0xcdbb9c, cape: 0xc9b696, under: 0xf2ece0, bib: 0xf4efe6, band: 0xe2cfae, tip: 0xae9c80,
        crown: 0xdccdb2, cheek: 0xebe1cf, mask: 0xf4efe6, brow: 0xf4efe6, muzzleTop: 0xd8c8aa, chin: 0xf2ece0,
        earBack: 0xd4c3a4, earTip: 0xbca88a, earIn: 0xeee6d8, earRim: 0xb09e82,
        tailTop: 0xd2c1a2, tailUnder: 0xece4d4, tailTip: 0xc6b293, gland: 0xb8a586, tipFrom: 0.88,
        leg: 0xe8dcc6, pants: 0xf2ece0, paw: 0xd6c6aa, eye: 0xc89a2a, grizzle: 0.35 },
    },
    coatW: { white: 3, cream: 2 },
  };
  const C = CBZ.canid;
  if (C) C.define("arctic_wolf", P);
  const H = C ? C.hooks("arctic_wolf") : {};
  CBZ.unitKit.register("arctic_wolf", {
    kind: "species",
    stats: C ? C.stats(P) : Object.assign({ scale: 1, brave: false, prey: false }, P.stats),
    build: H.build, animate: H.animate, fight: H.fight, moves: H.moves,
  });
  const row = CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES.arctic_wolf;
  if (row) row.mass = P.stats.mass;
})();
