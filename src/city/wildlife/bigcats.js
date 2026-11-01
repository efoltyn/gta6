/* ============================================================
   city/wildlife/bigcats.js — the big cats (Panthera & friends).

   Five low-poly box-group predators, each defined as one
   CBZ.defineSpecies({...}). Built from reference photos so the
   silhouette + markings read even at ~12-20 blocky meshes:
   tiger stripes, lion mane, cheetah spots & tear-lines,
   snow-leopard rosettes + fat tail, white-lion pale mane.

   CONTRACT (per wildlife_species.js): metres, FEET AT y=0,
   NOSE toward +X, materials only via ctx.mat(0xRRGGBB), boxes via
   CBZ.boxGeom(w,h,d). No colliders / lights / per-frame work.
   BODIES: each row's build() is one line into city/wildlife/beast_bodies.js
   (lofted shells on city/wildlife/beast_kit.js); this file is the rows.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const S = CBZ.defineSpecies;
  if (!S) return;

  // ---- 1. BENGAL TIGER ----------------------------------------
  // Deep orange coat, bold black vertical stripes on body & legs,
  // white belly & cheeks, long black-ringed tail.
  S({
    id: "bengal_tiger", name: "Bengal Tiger", biome: "forest", rarity: "rare",
    hp: 150, fur: "Tiger Pelt", furValue: 400, meat: "Game Meat", meatValue: 12,
    packs: 1, spd: 3.2, danger: 0.8, bite: 26, scale: 1.1, color: 0xd98a2b,
    build: function (ctx) { return CBZ.beastBodies ? CBZ.beastBodies.build("bengal_tiger", ctx) : null; },
  });

  // ---- 2. LION (male) -----------------------------------------
  // Tawny sand body, big dark-brown mane ring around head/neck,
  // dark tuft at tail tip.
  S({
    id: "lion", name: "Lion", biome: "desert", rarity: "rare",
    hp: 160, fur: "Lion Pelt", furValue: 380, meat: "Game Meat", meatValue: 12,
    herd: [1, 2], packs: 2, spd: 3.0, danger: 0.8, bite: 26, scale: 1.15, color: 0xc79a5b,
    build: function (ctx) { return CBZ.beastBodies ? CBZ.beastBodies.build("lion", ctx) : null; },
  });

  // ---- 3. CHEETAH ---------------------------------------------
  // Slender pale-gold body, many small round black spots, black
  // tear-line stripes from eyes, small head, long thin tail.
  S({
    id: "cheetah", name: "Cheetah", biome: "desert", rarity: "rare",
    hp: 90, fur: "Cheetah Pelt", furValue: 340, meat: "Game Meat", meatValue: 12,
    packs: 2, spd: 4.0, danger: 0.6, bite: 18, scale: 0.95, color: 0xd8b56a,
    build: function (ctx) { return CBZ.beastBodies ? CBZ.beastBodies.build("cheetah", ctx) : null; },
  });

  // ---- 4. SNOW LEOPARD (legendary) ----------------------------
  // Pale smoky grey-white, dark-grey rosettes/spots, very thick
  // long fluffy tail, small rounded ears. High-mountain snow.
  S({
    id: "snow_leopard", name: "Snow Leopard", biome: "snow", rarity: "legendary",
    hp: 120, fur: "Legendary Snow Leopard Pelt", furValue: 2200, respawn: false,
    packs: 1, spd: 3.6, danger: 0.7, bite: 22, scale: 1.0, color: 0xd7d9dc,
    build: function (ctx) { return CBZ.beastBodies ? CBZ.beastBodies.build("snow_leopard", ctx) : null; },
  });

  // ---- 5. WHITE LION (legendary) ------------------------------
  // Huge cream/ivory lion with a pale blond-white mane, dark
  // eyeliner & nose leather against the pale coat.
  S({
    id: "white_lion", name: "White Lion", biome: "desert", rarity: "legendary",
    hp: 200, fur: "Legendary White Lion Pelt", furValue: 2000, respawn: false,
    packs: 1, spd: 3.0, danger: 0.85, bite: 28, scale: 1.2, color: 0xefe9dc,
    build: function (ctx) { return CBZ.beastBodies ? CBZ.beastBodies.build("white_lion", ctx) : null; },
  });
})();
