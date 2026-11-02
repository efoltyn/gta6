/* ============================================================
   city/wildlife/apes.js — The great ape.

   ONE species, posed from silverback reference: the knuckle-walk stance —
   massive shoulders carried HIGH on long planted forearms, hips low on
   short hind legs so the back slopes rump-down; barrel chest; domed
   sagittal-crest skull with a heavy brow; charcoal-black coat with the
   silver saddle across the lower back; no tail. Metres, feet at y=0,
   nose toward +X.

   THE RIG CONTRACT IS THE POSE. The gait discovery (wildlife_rig.js) reads
   any tall thin ground-planted box as a leg — so the forearms ARE the front
   legs, columns at ±0.36 z with the knuckle fists joined onto them, and a
   gorilla trots diagonally on all fours like the quadruped it walks as.
   The lumbering roll comes from classify(): maul-style + /gorilla/ shares
   the bear's class, which is what a knuckle-walk reads as at ten metres.
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
  //  GORILLA — the silverback. Danger tier with the big bears: a charging
  //  silverback is a shock unit, not a stalker. hp sits between the brown
  //  and polar bear; the strike is heavier than a lion's bite (a blow, not
  //  a mouth). Troops are small and rare in the forest.
  // ============================================================
  S({
    id: "gorilla", name: "Gorilla", biome: "forest", rarity: "rare",
    hp: 260, fur: "Silverback Pelt", furValue: 600,
    herd: [1, 3], packs: 1, spd: 2.4, danger: 0.85, bite: 30,
    scale: 1.15, color: 0x2b2b2e,
    build: function (ctx) { return CBZ.beastBodies ? CBZ.beastBodies.build("gorilla", ctx) : null; },
  });
})();
