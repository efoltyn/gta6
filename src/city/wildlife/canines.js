/* ============================================================
   city/wildlife/canines.js — the wild canids' bestiary rows, plus one hog.
   (Dogs are city/dogs.js, one actor on CBZ.dogModel.)

   The wolves and the coyote ARE the canid family's body (src/units/kit/
   canid.js: real measurements, coats, the planted-foot gait and the body
   language), the same animal NPC War fields: build() returns it at real
   size (it carries 1 / scale; the engine multiplies scale back in) and
   animate() drives it from the hunting engine's states (wildlife.js's
   per-species hook). Metres, feet at y = 0, nose toward +X.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const S = CBZ.defineSpecies;
  if (!S) return;
  function canidBuild(id) { return function (ctx) { return CBZ.canid && CBZ.canid.kitReady() ? CBZ.canid.wildBuild(id, ctx) : null; }; }
  function canidAnimate(a, dt) { return CBZ.canid ? CBZ.canid.animateActor(a, dt) : false; }

  // Gray Wolf: agouti grey, tawny, black or pale; the dark cape, pale mask.
  S({
    id: "gray_wolf", name: "Gray Wolf", biome: "forest", rarity: "uncommon",
    hp: 55, fur: "Wolf Pelt", furValue: 80, meat: "Game Meat", meatValue: 10,
    scale: 0.95, herd: [2, 4], packs: 3, spd: 2.8, danger: 0.55, bite: 14,
    color: 0x7d7b78,
    build: canidBuild("gray_wolf"), animate: canidAnimate,
  });

  // Arctic Wolf: white to cream, the short muzzle and small ears of the cold.
  S({
    id: "arctic_wolf", name: "Arctic Wolf", biome: "snow", rarity: "uncommon",
    hp: 60, fur: "Arctic Wolf Pelt", furValue: 130, meat: "Game Meat", meatValue: 10,
    scale: 1.0, herd: [2, 4], packs: 2, spd: 2.8, danger: 0.55, bite: 14,
    color: 0xf0f0ee,
    build: canidBuild("arctic_wolf"), animate: canidAnimate,
  });

  // Coyote: grizzled grey-buff, rufous ears and legs, the tail carried low.
  S({
    id: "coyote", name: "Coyote", biome: "desert", rarity: "common",
    hp: 30, fur: "Coyote Pelt", furValue: 35, meat: "Game Meat", meatValue: 10,
    scale: 0.78, herd: [1, 2], packs: 3, spd: 3.0, danger: 0.3, bite: 10, spook: 24,
    color: 0xa98c63,
    build: canidBuild("coyote"), animate: canidAnimate,
  });

  // Wild Boar — compact bristly hog (not a canid; its body is the bestiary's).
  S({
    id: "wild_boar", name: "Wild Boar", biome: "forest", rarity: "uncommon",
    hp: 65, fur: "Boar Hide", furValue: 55, meat: "Pork", meatValue: 14, meatYield: 2,
    scale: 0.9, herd: [2, 4], packs: 2, spd: 2.6, danger: 0.5, bite: 14,
    color: 0x3a2c22,
    build: function (ctx) { return CBZ.beastBodies ? CBZ.beastBodies.build("wild_boar", ctx) : null; },
  });

  CBZ.canidBestiary = { build: canidBuild, animate: canidAnimate };
})();
