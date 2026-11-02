/* ============================================================
   city/wildlife_species.js — THE BESTIARY (species definitions).

   Every huntable animal in the world is one CBZ.defineSpecies({...}) call.
   The engine (wildlife.js) reads these to stock each biome, register pelts
   into the economy, and drive the hunt. Reference photos of each animal were
   consulted so the builds carry the RIGHT silhouette & colours (antlers,
   tusks, manes, dorsal fins, humps, stripes…). The land animals' bodies
   live in city/wildlife/beast_bodies.js (real proportions, lofted shells
   on city/wildlife/beast_kit.js); a row's build() is one line into it.

   ---- THE SCHEMA (fields the engine reads) ----------------------------------
     id        unique key (snake_case)
     name      display name ("Whitetail Deer")
     biome     "forest" | "desert" | "farmland" | "snow" | "water" | "urban"
               (desert doubles as the savanna; water = the open-sea band)
     rarity    "common" | "uncommon" | "rare" | "legendary"
     hp        health (deer ~30, bear ~180, elephant ~600, whale ~900)
     fur       pelt item name ("Deer Hide") — auto-registered as a valuable
     furValue  base $ of the pelt (a "Pristine " variant is worth ~2.1x)
     meat      optional meat item name ("Venison"); meatValue/meatYield optional
     scale     overall size multiplier (default 1)
     herd      [min,max] group size (omit or [1,1] for loners)
     packs     how many herds/loners to seed (default 3; aquatic default 2)
     spd       wander speed u/s (deer 2.4, rabbit 3, elephant 1.2)
     danger    0..1 predator aggression: >=0.5 charges & bites, <0.15 = prey
     spook     flee radius u (prey only; default 26)
     bite      contact damage to the player from a charging predator (default 10)
     aquatic   true = lives/cruises the ocean band (bobs at the surface)
     color     fallback tint if build() throws (safety only)
     respawn   false = never re-spawns once hunted out (legendaries)
     build(ctx)  ctx = { THREE, mat, rng } -> THREE.Group.
                 CONTRACT: model in metres, FEET AT y=0, NOSE toward +X.
                 A flat group of meshes, each positioned at its geometry's
                 bounding-box centre (the gait rig discovers legs and head
                 from them; see beast_kit.js). No colliders, no lights, no
                 per-frame work — just a static posed group.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  const SPECIES = CBZ.WILDLIFE_SPECIES = CBZ.WILDLIFE_SPECIES || {};
  CBZ.defineSpecies = function (sp) {
    if (!sp || !sp.id) return;
    if (sp.scale == null) sp.scale = 1;
    if (sp.spd == null) sp.spd = 1.6;
    if (sp.danger == null) sp.danger = 0;
    if (sp.hp == null) sp.hp = 40;
    SPECIES[sp.id] = sp;
    return sp;
  };
  const S = CBZ.defineSpecies;

  // ============================================================
  //  REFERENCE SPECIES — Whitetail Deer (the template every build mirrors).
  //  A tan quadruped: long body, arched neck, wedge head, thin legs, white
  //  tail flag, a modest 4-point rack on the buck. Nose toward +X, feet y=0.
  // ============================================================
  S({
    id: "whitetail_deer", name: "Whitetail Deer", biome: "forest", rarity: "common",
    hp: 30, fur: "Deer Hide", furValue: 45, meat: "Venison", meatValue: 12, meatYield: 2,
    scale: 1, herd: [6, 14], packs: 4, spd: 2.6, danger: 0, spook: 30, color: 0x8a5a32,
    build: function (ctx) { return CBZ.beastBodies ? CBZ.beastBodies.build("whitetail_deer", ctx) : null; },
  });

  // ---- The rest of the bestiary is appended below by the biome batches.
  //      (forest, desert/savanna, farmland, snow/ice, and the ocean.)
})();
