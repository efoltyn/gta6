/* ============================================================
   city/wildlife/canines.js — Wild canids + one compact hog. (Dogs are
   city/dogs.js, one actor on the shared city/dogmodel.js body.)

   Low-poly builds posed from reference photos: grizzled gray wolf
   (dark saddle, pale face/underside, bushy tail), creamy arctic wolf
   (thick coat, short muzzle, small ears), slender rusty-legged coyote
   (black-tipped low tail), and a humped-shouldered wild boar with
   upward ivory tusks. Metres, feet at y=0, nose toward +X.
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
  //  Gray Wolf — grizzled gray coat, darker saddle over the back &
  //  shoulders, paler cream face/muzzle/underside, erect triangular
  //  ears, sleek level body, bushy low-slung tail.
  // ============================================================
  S({
    id: "gray_wolf", name: "Gray Wolf", biome: "forest", rarity: "uncommon",
    hp: 55, fur: "Wolf Pelt", furValue: 80, meat: "Game Meat", meatValue: 10,
    scale: 0.95, herd: [2, 4], packs: 3, spd: 2.8, danger: 0.55, bite: 14,
    color: 0x7d7b78,
    build: function (ctx) { return CBZ.beastBodies ? CBZ.beastBodies.build("gray_wolf", ctx) : null; },
  });

  // ============================================================
  //  Arctic Wolf — pure creamy-white throughout, thick fluffy double
  //  coat (bulkier body & tail), short muzzle, small rounded ears.
  //  Ranges the ice.
  // ============================================================
  S({
    id: "arctic_wolf", name: "Arctic Wolf", biome: "snow", rarity: "uncommon",
    hp: 60, fur: "Arctic Wolf Pelt", furValue: 130, meat: "Game Meat", meatValue: 10,
    scale: 1.0, herd: [2, 4], packs: 2, spd: 2.8, danger: 0.55, bite: 14,
    color: 0xf0f0ee,
    build: function (ctx) { return CBZ.beastBodies ? CBZ.beastBodies.build("arctic_wolf", ctx) : null; },
  });

  // ============================================================
  //  Coyote — slender build, tan-grey coat with rusty-red legs, ears
  //  & face, narrow pointed muzzle, large erect ears, bushy tail with
  //  black tip carried low behind the hocks.
  // ============================================================
  S({
    id: "coyote", name: "Coyote", biome: "desert", rarity: "common",
    hp: 30, fur: "Coyote Pelt", furValue: 35, meat: "Game Meat", meatValue: 10,
    scale: 0.78, herd: [1, 2], packs: 3, spd: 3.0, danger: 0.3, bite: 10, spook: 24,
    color: 0xa98c63,
    build: function (ctx) { return CBZ.beastBodies ? CBZ.beastBodies.build("coyote", ctx) : null; },
  });

  // (The farmland "Dog" species that lived here was a second, boxy dog
  //  running beside city/dogs.js. Every dog is that one actor now: strays,
  //  the farm's yard dog, gang yard dogs, police K9s and yours.)

  // ============================================================
  //  Wild Boar — compact bristly hog, dark brown-black coat, muscular
  //  HUMPED shoulders rising above a low-carried wedge head, long flat
  //  rooting snout, small upward-curving ivory TUSKS, short stout legs,
  //  small tufted tail. Not a canine — built as a hog.
  // ============================================================
  S({
    id: "wild_boar", name: "Wild Boar", biome: "forest", rarity: "uncommon",
    hp: 65, fur: "Boar Hide", furValue: 55, meat: "Pork", meatValue: 14, meatYield: 2,
    scale: 0.9, herd: [2, 4], packs: 2, spd: 2.6, danger: 0.5, bite: 14,
    color: 0x3a2c22,
    build: function (ctx) { return CBZ.beastBodies ? CBZ.beastBodies.build("wild_boar", ctx) : null; },
  });
})();
