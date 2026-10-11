/* ============================================================
   units/species/coyote.js — the coyote (Canis latrans) as NPC War fights it.

   OWNED BY: the canid agent. Body, gait, life and close fight are the canid
   family's shared rig, src/units/kit/canid.js; this file is the animal's data.

   REFERENCE (Bekoff & Gese, "Coyote", Wild Mammals of North America 2003):
     shoulder height  0.58-0.66 m
     head + body      0.76-0.86 m, tail 0.3-0.4 m, carried LOW (below the
                      topline even at a run, where a wolf's streams level)
     mass             9-18 kg, males ~14, females ~12
     build            slender, long-legged, a NARROW pointed muzzle, small
                      nose pad, large pointed ears; small feet
     speed            trots 8 km/h, sprints to 64 km/h (~18 m/s): the
                      fastest wild canid in North America
     bite             ~600 N
     coat             grizzled grey-buff, a darker saddle, RUFOUS ears,
                      muzzle and legs, a dark stripe down the front of each
                      foreleg, white-cream throat and belly, black tail tip
   HOW IT FIGHTS: an opportunist. Alone or in pairs it takes rabbits, rodents,
   fawns and pets: a rush, a grab, a shake. Packs (in winter) run deer down
   from behind the way wolves do. It does not take on a healthy large animal
   or an armed man on its own: it hangs back and darts only at a turned back
   or a wounded animal, and breaks off early.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const P = {
    name: "coyote",
    body: {
      withers: 0.62, sh: 0.47, hipH: 0.465, bodyL: 0.56,
      chestRt: 0.098, chestRb: 0.165, chestW: 0.085, waistRt: 0.072, waistRb: 0.06, waistW: 0.068,
      rumpR: 0.082, rumpW: 0.074, neckR: 0.055, neckLen: 0.2, neckAng: 0.6, ruff: 1.1,
      skullR: 0.055, skullW: 0.055, headL: 0.105, headAng: -0.3, muzzleL: 0.11, muzzleR: 0.029, muzzleW: 0.027,
      earL: 0.1, earW: 0.072, tailL: 0.36, tailR: 0.045,
      fa: 0.17, fb: 0.19, fc: 0.1, ha: 0.18, hb: 0.2, hc: 0.13, legR: 1.2, pawR: 0.026,
    },
    fLin: 0.95, fGirth: 0.92,
    earTip: 0.08, tailRest: 1.3, tailHook: 0, eyeK: 1.0, howl: true,
    tailProf: [0.55, 0.85, 1.05, 1.15, 1.15, 1.05, 0.9, 0.62, 0.3],
    stats: {
      hp: 30, spd: 1.3, danger: 0.3, bite: 8,
      chase: 12.5, march: 3.2, dmg: 8, rate: 0.95,
      mass: 13, topSpeed: 18, accel: 8, endurance: 40, biteN: 600, hide: 0.2,
    },
    fight: { bold: 0.42, turn: 9, lungeT: 0.26, holdT: 1.0, shake: 0.3, tire: 1.1, opportunist: true },
    coats: {
      desert: { base: 0xa8916e, saddle: 0x72614e, cape: 0x625343, under: 0xe4d8c2, bib: 0xece4d4, band: 0xcaa978, tip: 0x261f19,
        crown: 0x977b58, cheek: 0xb79870, mask: 0xe8dfcf, brow: 0xddd0b8, muzzleTop: 0xae7646, muzzleSide: 0xb88458, chin: 0xece4d6,
        earBack: 0xb06c3c, earTip: 0x4a3a2c, earIn: 0xeadfcb, earRim: 0x3a2e22,
        tailTop: 0x75644f, tailUnder: 0xcab18b, tailTip: 0x1e1a16, gland: 0x2a241e, tipFrom: 0.82,
        leg: 0xbf8a58, legStripe: 0x5a4030, pants: 0xdecbaa, paw: 0xb0844e, eye: 0xc8a030, grizzle: 0.8 },
      grey: { base: 0x9a8d7c, saddle: 0x5e554b, cape: 0x51493f, under: 0xe0d8c8, bib: 0xeae4d8, band: 0xc0aa88, tip: 0x221e1a,
        crown: 0x857766, cheek: 0xab9a82, mask: 0xe6ded0, brow: 0xddd2c0, muzzleTop: 0xa27650, muzzleSide: 0xae8662, chin: 0xeae4d8,
        earBack: 0xa46a40, earTip: 0x3e3228, earIn: 0xe6dccc, earRim: 0x342a22,
        tailTop: 0x645a4f, tailUnder: 0xc2b294, tailTip: 0x1c1916, gland: 0x26211c, tipFrom: 0.82,
        leg: 0xb38660, legStripe: 0x4e3a2c, pants: 0xd8c8ac, paw: 0xa47e56, eye: 0xc8a030, grizzle: 0.85 },
    },
    coatW: { desert: 3, grey: 2 },
  };
  const C = CBZ.canid;
  if (C) C.define("coyote", P);
  const H = C ? C.hooks("coyote") : {};
  CBZ.unitKit.register("coyote", {
    kind: "species",
    stats: C ? C.stats(P) : Object.assign({ scale: 1, brave: false, prey: false }, P.stats),
    build: H.build, animate: H.animate, fight: H.fight, moves: H.moves,
  });
  const row = CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES.coyote;
  if (row) row.mass = P.stats.mass;
})();
