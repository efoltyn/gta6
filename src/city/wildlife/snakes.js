/* ============================================================
   city/wildlife/snakes.js — slithering serpents.
   Garter, Rattlesnake, King Cobra, Black Mamba, Green Anaconda.
   NOT quadrupeds: each is a CHAIN of body segments the animation
   engine undulates every frame. build() only defines each segment's
   size/shape/colour + special parts (cobra hood, rattle). The engine
   positions every segment, so initial local layout does not matter.
   group.userData.segs = ordered meshes (0 = head, last = tail tip).
   Head reads facing +X. BODIES: city/wildlife/beast_bodies.js (lofted
   segments with painted coats on the beast kit); this file is the rows.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const S = CBZ.defineSpecies;
  if (!S) return;

  // ============================================================
  //  GARTER SNAKE — slim; dark olive/black body with 3 yellow
  //  length stripes (1 dorsal + 2 lateral), small head, pale belly.
  // ============================================================
  S({
    id: "garter_snake", name: "Garter Snake", biome: "forest", rarity: "common",
    hp: 8, fur: "Garter Skin", furValue: 10, danger: 0, spook: 14, spd: 1.4,
    scale: 1, herd: [1, 1], snake: true, color: 0x2f3a24,
    build: function (ctx) { return CBZ.beastBodies ? CBZ.beastBodies.build("garter_snake", ctx) : null; },
  });

  // ============================================================
  //  RATTLESNAKE — tan/brown with dark DIAMOND blotches down the
  //  back, thick TRIANGULAR head, banded segmented RATTLE at tail.
  // ============================================================
  S({
    id: "rattlesnake", name: "Rattlesnake", biome: "desert", rarity: "uncommon",
    hp: 14, fur: "Snakeskin", furValue: 34, danger: 0.4, venom: true, venomDps: 4,
    bite: 12, spook: 10, spd: 1.2, scale: 1, herd: [1, 1], snake: true, color: 0xb59367,
    build: function (ctx) { return CBZ.beastBodies ? CBZ.beastBodies.build("rattlesnake", ctx) : null; },
  });

  // ============================================================
  //  KING COBRA — olive-brown with faint pale bands, big head,
  //  and the marquee HOOD (two flat wide flaps the engine flares).
  //  rear:4 front segments rear up when threatened.
  // ============================================================
  S({
    id: "king_cobra", name: "King Cobra", biome: "desert", rarity: "rare",
    hp: 24, fur: "Cobra Skin", furValue: 220, danger: 0.55, venom: true, venomDps: 7,
    bite: 16, spook: 8, spd: 1.6, scale: 1.05, herd: [1, 1], snake: true, color: 0x6b5a34,
    build: function (ctx) { return CBZ.beastBodies ? CBZ.beastBodies.build("king_cobra", ctx) : null; },
  });

  // ============================================================
  //  BLACK MAMBA — very long & slender, gunmetal grey-brown,
  //  distinctive COFFIN-shaped head with inky-black mouth. Fastest.
  // ============================================================
  S({
    id: "black_mamba", name: "Black Mamba", biome: "desert", rarity: "rare",
    hp: 18, fur: "Mamba Skin", furValue: 240, danger: 0.6, venom: true, venomDps: 8,
    bite: 14, spook: 12, spd: 3.2, scale: 1, herd: [1, 1], snake: true, color: 0x4a4a44,
    build: function (ctx) { return CBZ.beastBodies ? CBZ.beastBodies.build("black_mamba", ctx) : null; },
  });

  // ============================================================
  //  GREEN ANACONDA — MASSIVE & thick, olive-green with black oval
  //  spots (yellow-centred along the flanks), broad blunt head with
  //  eyes set high on top. 16 fat segments.
  // ============================================================
  S({
    id: "green_anaconda", name: "Green Anaconda", biome: "forest", rarity: "rare",
    hp: 90, fur: "Anaconda Skin", furValue: 300, danger: 0.6, constrictor: true,
    bite: 20, spook: 0, spd: 1.4, scale: 1.3, herd: [1, 1], snake: true, color: 0x4d5a2e,
    build: function (ctx) { return CBZ.beastBodies ? CBZ.beastBodies.build("green_anaconda", ctx) : null; },
  });
})();
