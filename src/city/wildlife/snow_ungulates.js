/* ============================================================
   city/wildlife/snow_ungulates.js — snow-biome ungulates batch.
   Moose, Caribou, Mountain Goat, Bison. Rows only.
   (RDR2 / Minecraft style). Modelled in metres, feet at y=0,
   nose toward +X. Materials only via ctx.mat, boxes via CBZ.boxGeom.
   Silhouettes/colours matched to reference photos of each animal.
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
  //  MOOSE — huge, near-black brown (winter). Long horse-like
  //  snout w/ overhanging lip, a dewlap ("bell") under the throat,
  //  tall shoulder hump, very long legs, and enormous PALMATE
  //  (broad flat shovel) antlers edged with small tine cones.
  // ============================================================
  S({
    id: "moose", name: "Moose", biome: "snow", rarity: "rare",
    hp: 180, fur: "Moose Hide", furValue: 220, meat: "Moose Meat", meatValue: 20, meatYield: 3,
    scale: 1.4, herd: [1, 2], packs: 2, spd: 2.2, danger: 0.4, bite: 16, spook: 26, color: 0x40301f,
    build: function (ctx) { return CBZ.beastBodies ? CBZ.beastBodies.build("moose", ctx) : null; },
  });

  // ============================================================
  //  CARIBOU — grey-brown body with a pale/white neck & rump,
  //  broad muzzle, and large asymmetric branching antlers that
  //  sweep forward (present in both sexes).
  // ============================================================
  S({
    id: "caribou", name: "Caribou", biome: "snow", rarity: "uncommon",
    hp: 70, fur: "Caribou Pelt", furValue: 110, meat: "Venison", meatValue: 12,
    scale: 1.05, herd: [10, 20], packs: 2, spd: 2.8, danger: 0, spook: 28, color: 0x8a7256,
    build: function (ctx) { return CBZ.beastBodies ? CBZ.beastBodies.build("caribou", ctx) : null; },
  });

  // ============================================================
  //  MOUNTAIN GOAT — shaggy WHITE woolly coat (chunky body), a
  //  fur shoulder hump, chin BEARD, short black backward-curving
  //  horns (cones), and black hooves.
  // ============================================================
  S({
    id: "mountain_goat", name: "Mountain Goat", biome: "snow", rarity: "uncommon",
    hp: 50, fur: "Mountain Goat Hide", furValue: 140,
    scale: 0.85, herd: [3, 8], packs: 2, spd: 2.4, danger: 0.1, spook: 24, color: 0xf2f0ea,
    build: function (ctx) { return CBZ.beastBodies ? CBZ.beastBodies.build("mountain_goat", ctx) : null; },
  });

  // ============================================================
  //  BISON — massive dark brown. Enormous SHOULDER HUMP, a big
  //  shaggy dark mane/beard over the head & front (front third
  //  bulky & darker), short curved black HORNS on a low broad
  //  head, small hindquarters. Iconic silhouette.
  // ============================================================
  S({
    id: "bison", name: "Bison", biome: "snow", rarity: "uncommon",
    hp: 200, fur: "Bison Pelt", furValue: 190, meat: "Beef", meatValue: 18, meatYield: 3,
    scale: 1.3, herd: [12, 24], packs: 2, spd: 2.4, danger: 0.5, bite: 20, spook: 22, color: 0x4a3323,
    build: function (ctx) { return CBZ.beastBodies ? CBZ.beastBodies.build("bison", ctx) : null; },
  });
})();
