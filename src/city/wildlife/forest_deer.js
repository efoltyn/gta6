/* ============================================================
   city/wildlife/forest_deer.js — forest cervids & critters batch.
   Elk, Red Fox, Raccoon, Cottontail Rabbit. Rows only.
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
  //  ELK — big cervid: reddish-tan body, dark shaggy neck mane,
  //  buff/cream rump patch, huge sweeping antlers on the bulls.
  // ============================================================
  S({
    id: "elk", name: "Elk", biome: "forest", rarity: "uncommon",
    hp: 75, fur: "Elk Pelt", furValue: 95, meat: "Elk Meat", meatValue: 16, meatYield: 2,
    scale: 1.15, herd: [4, 9], packs: 3, spd: 2.4, danger: 0, spook: 30, color: 0x6b4a2c,
    build: function (ctx) { return CBZ.beastBodies ? CBZ.beastBodies.build("elk", ctx) : null; },
  });

  // ============================================================
  //  RED FOX — rusty-orange, white chest/throat & tail tip,
  //  black lower legs, big pointed ears, long bushy tail.
  // ============================================================
  S({
    id: "red_fox", name: "Red Fox", biome: "forest", rarity: "common",
    hp: 16, fur: "Fox Pelt", furValue: 42, packs: 4, spd: 3.0, danger: 0, spook: 26,
    scale: 0.8, color: 0xc0552a,
    build: function (ctx) { return CBZ.beastBodies ? CBZ.beastBodies.build("red_fox", ctx) : null; },
  });

  // ============================================================
  //  RACCOON — grey body, black eye-mask on a pale face, small
  //  rounded ears, ringed (grey/black banded) bushy tail. Hunched.
  // ============================================================
  S({
    id: "raccoon", name: "Raccoon", biome: "forest", rarity: "common",
    hp: 14, fur: "Raccoon Pelt", furValue: 20, packs: 4, spd: 2.2, danger: 0, spook: 20,
    scale: 0.55, color: 0x6d6a63,
    build: function (ctx) { return CBZ.beastBodies ? CBZ.beastBodies.build("raccoon", ctx) : null; },
  });

  // ============================================================
  //  COTTONTAIL RABBIT — small brown-grey, tall ears, tiny white
  //  puff tail, hunched with big hind legs.
  // ============================================================
  S({
    id: "cottontail_rabbit", name: "Cottontail Rabbit", biome: "forest", rarity: "common",
    hp: 8, fur: "Rabbit Pelt", furValue: 9, meat: "Rabbit Meat", meatValue: 5,
    herd: [2, 3], packs: 4, spd: 3.4, danger: 0, spook: 22, scale: 0.5, color: 0x8a7350,
    build: function (ctx) { return CBZ.beastBodies ? CBZ.beastBodies.build("cottontail_rabbit", ctx) : null; },
  });
})();
