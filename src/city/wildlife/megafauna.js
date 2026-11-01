/* ============================================================
   city/wildlife/megafauna.js — SAVANNA MEGAFAUNA (big desert/savanna beasts).

   Four low-poly giants for the desert (savanna) biome, each a
   CBZ.defineSpecies({...}) call the wildlife engine stocks & hunts. Reference
   photos were consulted so every silhouette carries the RIGHT features:
     • african_elephant — grey wrinkled hulk, huge fan EARS, long TRUNK to the
       ground, two ivory TUSKS, columnar legs.               (0x8f8b86)
     • white_rhino      — grey barrel, shoulder HUMP, head slung LOW, TWO nose
       horns (long front + short rear).                       (0x9a9791)
     • giraffe          — towering sloping NECK to a ~5.5m head, two ossicones,
       tan coat blotched with brown PATCHES, stilt legs.      (0xd9b46a)
     • zebra            — horse build, cream coat banded with bold black
       STRIPES, erect mane, tufted tail.                      (0xf2f0ea)

   CONTRACT (per the engine): model in METRES, FEET at y=0, NOSE toward +X,
   materials only via ctx.mat(0xRRGGBB), boxes via CBZ.boxGeom(w,h,d), a few
   cones/cylinders for horns/tusks/trunk. Static posed group, low-poly.
   BODIES: each row's build() is one line into city/wildlife/beast_bodies.js
   (lofted shells on city/wildlife/beast_kit.js); this file is the rows.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const S = CBZ.defineSpecies;
  if (!S) return;

  // ------------------------------------------------------------------
  // 1. AFRICAN ELEPHANT — massive grey hulk, big ears, trunk, tusks.
  // ------------------------------------------------------------------
  S({
    id: "african_elephant", name: "African Elephant", biome: "desert", rarity: "rare",
    hp: 600, fur: "Elephant Hide", furValue: 500, meat: "Game Meat", meatValue: 12,
    scale: 1.0, herd: [2, 3], packs: 1, spd: 1.4, danger: 0.5, bite: 40, spook: 0,
    color: 0x8f8b86,
    build: function (ctx) { return CBZ.beastBodies ? CBZ.beastBodies.build("african_elephant", ctx) : null; },
  });

  // ------------------------------------------------------------------
  // 2. WHITE RHINO — grey barrel, shoulder hump, low head, two nose horns.
  // ------------------------------------------------------------------
  S({
    id: "white_rhino", name: "White Rhino", biome: "desert", rarity: "rare",
    hp: 500, fur: "Rhino Hide", furValue: 460, packs: 1, herd: [1, 2],
    spd: 1.8, danger: 0.7, bite: 36, spook: 0, scale: 1.0, color: 0x9a9791,
    build: function (ctx) { return CBZ.beastBodies ? CBZ.beastBodies.build("white_rhino", ctx) : null; },
  });

  // ------------------------------------------------------------------
  // 3. GIRAFFE — towering sloping neck, tan coat with brown patches.
  // ------------------------------------------------------------------
  S({
    id: "giraffe", name: "Giraffe", biome: "desert", rarity: "uncommon",
    hp: 220, fur: "Giraffe Hide", furValue: 260, herd: [3, 7], packs: 1,
    spd: 2.2, danger: 0, spook: 30, scale: 1.0, color: 0xd9b46a,
    build: function (ctx) { return CBZ.beastBodies ? CBZ.beastBodies.build("giraffe", ctx) : null; },
  });

  // ------------------------------------------------------------------
  // 4. ZEBRA — horse build, cream coat with bold black stripes.
  // ------------------------------------------------------------------
  S({
    id: "zebra", name: "Zebra", biome: "desert", rarity: "common",
    hp: 90, fur: "Zebra Hide", furValue: 120, meat: "Game Meat", meatValue: 12,
    herd: [8, 18], packs: 2, spd: 3.0, danger: 0, spook: 28, scale: 1.0, color: 0xf2f0ea,
    build: function (ctx) { return CBZ.beastBodies ? CBZ.beastBodies.build("zebra", ctx) : null; },
  });
})();
