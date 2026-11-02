/* ============================================================
   city/wildlife/small_game.js — desert & snow small-game batch.
   Jackrabbit, Rattlesnake, Snowshoe Hare, Bighorn Sheep.
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
  //  JACKRABBIT (black-tailed) — sandy tan-grey, dark-peppered coat,
  //  ENORMOUS long ears with black tips, long powerful hind legs,
  //  black-tipped tail. Bigger-eared than a cottontail. Hunched.
  // ============================================================
  S({
    id: "jackrabbit", name: "Jackrabbit", biome: "desert", rarity: "common",
    hp: 8, fur: "Jackrabbit Pelt", furValue: 10, meat: "Rabbit Meat", meatValue: 5,
    herd: [1, 3], packs: 4, spd: 3.6, danger: 0, spook: 22, scale: 0.55, color: 0xbfa377,
    build: function (ctx) { return CBZ.beastBodies ? CBZ.beastBodies.build("jackrabbit", ctx) : null; },
  });

  // (RATTLESNAKE moved to city/wildlife/snakes.js — all snakes now share the
  //  segment-chain SLITHER animation + venom/strike logic in the engine.)

  // ============================================================
  //  SNOWSHOE HARE — WHITE winter coat, medium ears with dark tips,
  //  oversized furry hind FEET (the "snowshoes"), compact body.
  // ============================================================
  S({
    id: "snowshoe_hare", name: "Snowshoe Hare", biome: "snow", rarity: "common",
    hp: 8, fur: "Hare Pelt", furValue: 12, meat: "Rabbit Meat", meatValue: 5,
    herd: [1, 3], packs: 3, spd: 3.6, danger: 0, spook: 22, scale: 0.5, color: 0xf3f3f3,
    build: function (ctx) { return CBZ.beastBodies ? CBZ.beastBodies.build("snowshoe_hare", ctx) : null; },
  });

  // ============================================================
  //  BIGHORN SHEEP (ram) — sturdy brown quadruped (~1m tall), pale
  //  WHITE rump patch & muzzle, huge CURLED (spiral) horns curling
  //  back around beside the head, built from angled cone segments.
  // ============================================================
  S({
    id: "bighorn_sheep", name: "Bighorn Sheep", biome: "desert", rarity: "uncommon",
    hp: 60, fur: "Bighorn Hide", furValue: 130, meat: "Mutton", meatValue: 12,
    herd: [3, 8], packs: 2, spd: 2.6, danger: 0.2, bite: 12, scale: 0.9, color: 0x8a6f4e,
    build: function (ctx) { return CBZ.beastBodies ? CBZ.beastBodies.build("bighorn_sheep", ctx) : null; },
  });
})();
