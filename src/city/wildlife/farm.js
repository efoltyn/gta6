/* ============================================================
   city/wildlife/farm.js — farmland livestock batch.
   Cow (Holstein), Pig, Sheep, Goat, Horse (mustang), Chicken.
   BODIES: each row's build() is one line into city/wildlife/beast_bodies.js
   (lofted shells on city/wildlife/beast_kit.js); this file is the rows.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const S = CBZ.defineSpecies;
  if (!S) return;

  // ============================================================
  //  COW — Holstein Friesian. Reference: white body with irregular
  //  hard-edged BLACK PATCHES (piebald), pink udder underneath, small
  //  pale horns, big square muzzle, ears out to the sides, tufted tail.
  // ============================================================
  S({
    id: "cow", name: "Cow", biome: "farmland", rarity: "common",
    hp: 80, fur: "Cowhide", furValue: 40, meat: "Beef", meatValue: 18, meatYield: 3,
    scale: 1.1, herd: [4, 9], packs: 3, spd: 1.6, danger: 0, spook: 18, color: 0xffffff,
    build: function (ctx) { return CBZ.beastBodies ? CBZ.beastBodies.build("cow", ctx) : null; },
  });

  // ============================================================
  //  PIG — domestic pink hog. Reference: plump rounded pink body low
  //  to the ground, flat SNOUT disc, floppy triangular ears, short
  //  legs, little curly tail.
  // ============================================================
  S({
    id: "pig", name: "Pig", biome: "farmland", rarity: "common",
    hp: 45, fur: "Pigskin", furValue: 22, meat: "Pork", meatValue: 14, meatYield: 2,
    herd: [2, 4], packs: 3, spd: 1.8, danger: 0, scale: 0.8, color: 0xe7a6a0,
    build: function (ctx) { return CBZ.beastBodies ? CBZ.beastBodies.build("pig", ctx) : null; },
  });

  // ============================================================
  //  SHEEP — domestic wool sheep (Valais-style dark face). Reference:
  //  fat FLUFFY cream WOOL body (tall & rounded), small dark face,
  //  dark thin legs, tiny ears.
  // ============================================================
  S({
    id: "sheep", name: "Sheep", biome: "farmland", rarity: "common",
    hp: 35, fur: "Wool", furValue: 30, meat: "Mutton", meatValue: 12,
    herd: [8, 16], packs: 3, spd: 1.8, danger: 0, spook: 20, scale: 0.8, color: 0xf0ece2,
    build: function (ctx) { return CBZ.beastBodies ? CBZ.beastBodies.build("sheep", ctx) : null; },
  });

  // ============================================================
  //  GOAT — domestic goat. Reference: white/tan body, backward-curving
  //  HORNS (cones), a chin BEARD, narrow face, short upright tail.
  // ============================================================
  S({
    id: "goat", name: "Goat", biome: "farmland", rarity: "common",
    hp: 35, fur: "Goat Hide", furValue: 26, meat: "Mutton", meatValue: 12,
    herd: [4, 8], packs: 2, spd: 2.2, danger: 0.1, scale: 0.75, color: 0xd8cdbb,
    build: function (ctx) { return CBZ.beastBodies ? CBZ.beastBodies.build("goat", ctx) : null; },
  });

  // ============================================================
  //  HORSE — wild mustang. Reference: bay/brown sleek body, long neck,
  //  long head/muzzle, black upright/flowing MANE along the neck, long
  //  black TAIL, tall legs, dark hooves.
  // ============================================================
  S({
    id: "horse", name: "Horse", biome: "farmland", rarity: "uncommon",
    hp: 120, fur: "Horsehide", furValue: 90, herd: [4, 9], packs: 2,
    spd: 3.4, danger: 0, spook: 24, scale: 1.1, color: 0x6e4326,
    build: function (ctx) { return CBZ.beastBodies ? CBZ.beastBodies.build("horse", ctx) : null; },
  });

  // ============================================================
  //  CHICKEN — domestic hen. Reference: small plump white/brown body,
  //  red COMB + red wattle, orange/yellow BEAK & legs, little wing
  //  boxes, tail feathers up. Two legs only.
  // ============================================================
  S({
    id: "chicken", name: "Chicken", biome: "farmland", rarity: "common",
    hp: 6, fur: "Feathers", furValue: 6, meat: "Chicken", meatValue: 6,
    herd: [4, 9], packs: 3, spd: 1.6, danger: 0, scale: 0.35, color: 0xf2f2f2,
    build: function (ctx) { return CBZ.beastBodies ? CBZ.beastBodies.build("chicken", ctx) : null; },
  });
})();
