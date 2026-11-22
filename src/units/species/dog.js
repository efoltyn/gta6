/* ============================================================
   units/species/dog.js — the dog as NPC War fields it.

   A fighting pack drawn from the canid family's dog rows (pit, shepherd,
   mastiff, mutt; src/units/kit/canid.js picks the breed by spawn index):
   the same body as every dog in Gang City, and the canid close fight
   (limb grabs, holds, two dogs taking a man down). There is no bestiary row
   for "dog", so this file stands one up for the battle and creature_combat.

   The numbers are a fighting dog's (pit / shepherd / mastiff: hp 50-75,
   bite 12-18); spd is the bestiary's wander unit (the charge is chase).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const C = CBZ.canid;
  const STATS = {
    hp: 55, spd: 3.0, danger: 0.6, bite: 14, scale: 1,
    chase: 8.2, march: 4.5, dmg: 18.9, rate: 1.23, brave: false, prey: false,
  };
  const H = C ? C.hooks("dog") : {};
  CBZ.unitKit.register("dog", { kind: "species", stats: STATS, build: H.build, animate: H.animate, fight: H.fight, moves: H.moves });
  // ...and the species row the battle and creature_combat read, once
  if (CBZ.defineSpecies && !(CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES.dog)) {
    CBZ.defineSpecies({
      id: "dog", name: "Dog", biome: "farmland", rarity: "common",
      hp: STATS.hp, spd: STATS.spd, danger: STATS.danger, bite: STATS.bite, scale: STATS.scale,
      packs: 6, herd: [3, 8], respawn: false,
      build: H.build,
    });
  }
})();
