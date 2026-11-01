(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const S = CBZ.defineSpecies;
  if (!S) return;

  // ============================================================
  //  BLACK BEAR — Ursus americanus.
  //  Reference: near-black coat, pale tan/brown muzzle, tall oval rounded
  //  ears set well back, STRAIGHT/convex ("Roman") face profile, FLAT back
  //  (no shoulder hump — rump slightly higher than shoulders).
  // ============================================================
  S({
    id: "black_bear", name: "Black Bear", biome: "forest", rarity: "rare",
    hp: 170, fur: "Black Bear Pelt", furValue: 180, meat: "Bear Meat",
    meatValue: 20, meatYield: 2, packs: 2, spd: 2.0, danger: 0.6, bite: 18,
    scale: 1.25, color: 0x1b1712,
    build: function (ctx) { return CBZ.beastBodies ? CBZ.beastBodies.build("black_bear", ctx) : null; },
  });

  // ============================================================
  //  BROWN BEAR (Grizzly) — Ursus arctos.
  //  Reference: grizzled brown, silver-tipped shoulders, PRONOUNCED muscular
  //  shoulder hump (higher than rump), concave "dished" face, short round
  //  ears, massive build, long front claws.
  // ============================================================
  S({
    id: "brown_bear", name: "Brown Bear", biome: "forest", rarity: "rare",
    hp: 200, fur: "Brown Bear Pelt", furValue: 210, meat: "Bear Meat",
    meatValue: 20, meatYield: 3, packs: 2, spd: 2.1, danger: 0.7, bite: 22,
    scale: 1.35, color: 0x5a3d24,
    build: function (ctx) { return CBZ.beastBodies ? CBZ.beastBodies.build("brown_bear", ctx) : null; },
  });

  // ============================================================
  //  POLAR BEAR — Ursus maritimus. Lives on the sea ice (biome: snow).
  //  Reference: cream-white / straw coat, LONG neck, narrow elongated skull,
  //  black nose & footpads, low shoulder hump, massive elongated body.
  // ============================================================
  S({
    id: "polar_bear", name: "Polar Bear", biome: "snow", rarity: "rare",
    hp: 240, fur: "Polar Bear Pelt", furValue: 320, meat: "Bear Meat",
    meatValue: 24, meatYield: 3, packs: 2, spd: 2.2, danger: 0.75, bite: 24,
    scale: 1.45, color: 0xeae6d8,
    build: function (ctx) { return CBZ.beastBodies ? CBZ.beastBodies.build("polar_bear", ctx) : null; },
  });

  // ============================================================
  //  WHITE STAG — the legendary one. A pure-white leucistic red deer:
  //  elegant arched neck, wedge head, thin legs, and an ENORMOUS branching
  //  multi-point antler rack (always present). Faint grey shading only.
  // ============================================================
  S({
    id: "white_stag", name: "White Stag", biome: "forest", rarity: "legendary",
    hp: 60, fur: "Legendary White Stag Hide", furValue: 1500, respawn: false,
    packs: 1, spd: 3.0, danger: 0, spook: 34, scale: 1.25, color: 0xf2efe6,
    build: function (ctx) { return CBZ.beastBodies ? CBZ.beastBodies.build("white_stag", ctx) : null; },
  });
})();
