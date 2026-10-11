/* ============================================================
   units/species/gray_wolf.js — the gray wolf (Canis lupus) as NPC War fights it.

   OWNED BY: the canid agent. The body, gait, life and close fight are the
   canid family's shared rig, src/units/kit/canid.js (CBZ.canid); this file
   is the wolf's DATA: real measurements, its coat phases, its temperament.

   REFERENCE (adult North American gray wolf; Mech & Boitani, "Wolves",
   2003; Paquet & Carbyn; skeletal data from museum specimens):
     shoulder height  0.66-0.81 m (male ~0.79, female ~0.74)
     head + body      1.05-1.6 m, tail 0.29-0.5 m (hangs to the hocks)
     mass             male 40-45 kg (to 60+), female 32-38 kg
     skull            ~0.26 m, long muzzle, broad zygoma; 42 teeth,
                      canines ~2.5 cm exposed
     chest            deep and NARROW (keel), elbows in, long legs, large
                      front feet (~11 x 10 cm), single-tracking trot
     speed            travel trot 8-10 km/h for hours (60+ km a day);
                      lope ~25-30 km/h; sprint 55-60 km/h (16-17 m/s) in
                      bursts of a few hundred metres
     bite             ~1,400 N at the carnassials (Christiansen & Wroe 2007)
     coat             agouti grey: grizzled black-tipped guard hairs over a
                      tawny/buff ground, dark cape over the shoulders, pale
                      cream mask, eyebrows, bib and belly, tawny legs, dark
                      tail tip and the violet-gland spot; phases run from
                      near-white through grey and tawny to black
   HOW IT FIGHTS (Mech; Mech, Smith & MacNulty, "Wolves on the Hunt", 2015)
     a pack tests the quarry, runs it, and attacks from BEHIND: the hindquarters
     and hamstrings of elk, moose and bison, slash-and-spring-back clear of the
     hooves; one wolf takes the nose once the animal is spent. Smaller prey is
     grabbed and shaken. Attacks on people go for the limbs and drag the
     person down. A lone wolf keeps its distance from anything that can kill
     it; wounded, it breaks off.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const P = {
    name: "gray wolf",
    // the measured MALE; the female is fLin linear / fGirth girth of him
    body: {
      withers: 0.79, sh: 0.6, hipH: 0.59, bodyL: 0.72,
      chestRt: 0.135, chestRb: 0.215, chestW: 0.12, waistRt: 0.1, waistRb: 0.085, waistW: 0.1,
      rumpR: 0.115, rumpW: 0.105, neckR: 0.08, neckLen: 0.26, neckAng: 0.6, ruff: 1.15,
      skullR: 0.074, skullW: 0.074, headL: 0.14, headAng: -0.3, muzzleL: 0.13, muzzleR: 0.042, muzzleW: 0.04,
      earL: 0.088, earW: 0.092, tailL: 0.46, tailR: 0.058,
      fa: 0.21, fb: 0.24, fc: 0.13, ha: 0.22, hb: 0.25, hc: 0.15, legR: 1.35, pawR: 0.034,
    },
    fLin: 0.94, fGirth: 0.93,
    earTip: 0.3, tailRest: 1.2, tailHook: 0, eyeK: 1, howl: true,
    stats: {
      // battle numbers: spd = the wander/travel trot, chase = the pursuit lope
      // a pack runs a quarry down at, march = the fast travelling trot
      hp: 62, spd: 1.4, danger: 0.6, bite: 16,
      chase: 12.5, march: 3.4, dmg: 17, rate: 1.1,
      // the real animal, for the balance agent and bodymass
      mass: 41, topSpeed: 16.5, accel: 7, endurance: 60, biteN: 1400, hide: 0.25,
    },
    fight: { bold: 0.62, turn: 7.5, lungeT: 0.32, holdT: 1.6, shake: 0.3, tire: 1.0, opportunist: false },
    coats: {
      grey: { base: 0x8a8174, saddle: 0x4e4a45, cape: 0x3c3935, under: 0xd8ccb4, bib: 0xe2d8c4, band: 0xc9b28c, tip: 0x1f1c19,
        crown: 0x6f675c, cheek: 0xb4a894, mask: 0xe6ddcc, brow: 0xe0d5c0, muzzleTop: 0x8f8170, chin: 0xe4dccc,
        earBack: 0x6b5f50, earTip: 0x2b2622, earIn: 0xd9cfbf, earRim: 0x2b2622,
        tailTop: 0x5a554e, tailUnder: 0xc4b59c, tailTip: 0x1c1a18, gland: 0x2a2724, tipFrom: 0.8,
        leg: 0xb79c76, legStripe: 0x6a5a48, pants: 0xd2c5ad, paw: 0xa38c6c, eye: 0xc8901c, grizzle: 0.75 },
      tawny: { base: 0xa08560, saddle: 0x6a5a48, cape: 0x56493c, under: 0xe0cfae, bib: 0xe8dcc4, band: 0xd0aa70, tip: 0x2a221b,
        crown: 0x8a7050, cheek: 0xc0a882, mask: 0xece0c8, brow: 0xe6d6b8, muzzleTop: 0xa0805a, chin: 0xe8dcc6,
        earBack: 0x8a6a48, earTip: 0x3a2e24, earIn: 0xe0d0b4, earRim: 0x3a2e24,
        tailTop: 0x75624c, tailUnder: 0xd0bc98, tailTip: 0x221c17, gland: 0x30271f, tipFrom: 0.8,
        leg: 0xc2a070, legStripe: 0x7a6248, pants: 0xdccaa6, paw: 0xb08e62, eye: 0xc8901c, grizzle: 0.65 },
      black: { base: 0x2b2826, saddle: 0x1d1b1a, cape: 0x1a1817, under: 0x46413c, bib: 0x3e3a36, band: 0x5a524a, tip: 0x121110,
        crown: 0x252321, cheek: 0x33302d, mask: 0x4a4540, brow: 0x423d38, muzzleTop: 0x2a2725, chin: 0x3f3a35,
        earBack: 0x1e1c1b, earTip: 0x141312, earIn: 0x4a443e, earRim: 0x121110,
        tailTop: 0x1c1a19, tailUnder: 0x2e2b28, tailTip: 0x121110, gland: 0x121110, tipFrom: 0.85,
        leg: 0x2e2a27, legStripe: 0x1a1817, pants: 0x3c3733, paw: 0x2a2624, eye: 0xc89a2a, grizzle: 0.45 },
      pale: { base: 0xb9b1a4, saddle: 0x8a837a, cape: 0x7a746c, under: 0xebe4d6, bib: 0xf0eadf, band: 0xe0d2b8, tip: 0x4a4540,
        crown: 0xa29a8e, cheek: 0xd8d0c2, mask: 0xf2ece2, brow: 0xeee6d8, muzzleTop: 0xb4a898, chin: 0xf0eadf,
        earBack: 0x9a8f80, earTip: 0x4e4740, earIn: 0xece4d6, earRim: 0x4e4740,
        tailTop: 0x8e877e, tailUnder: 0xe0d8c8, tailTip: 0x3a3532, gland: 0x5a534c, tipFrom: 0.84,
        leg: 0xd2c2a4, legStripe: 0x9a8a72, pants: 0xe6dccb, paw: 0xc6b494, eye: 0xc8901c, grizzle: 0.55 },
    },
    // phase frequencies across the range (most wolves are grey; black is
    // common in Yellowstone and the boreal forest)
    coatW: { grey: 5, tawny: 2.5, black: 1.6, pale: 1 },
  };
  const C = CBZ.canid;
  if (C) C.define("gray_wolf", P);
  const H = C ? C.hooks("gray_wolf") : {};
  CBZ.unitKit.register("gray_wolf", {
    kind: "species",
    stats: C ? C.stats(P) : Object.assign({ scale: 1, brave: false, prey: false }, P.stats),
    build: H.build, animate: H.animate, fight: H.fight, moves: H.moves,
  });
  const row = CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES.gray_wolf;
  if (row) row.mass = P.stats.mass;
})();
