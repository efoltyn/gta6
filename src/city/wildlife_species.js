/* ============================================================
   city/wildlife_species.js — THE BESTIARY (species definitions).

   Every huntable animal in the world is one CBZ.defineSpecies({...}) call.
   The engine (wildlife.js) reads these to stock each biome, register pelts
   into the economy, and drive the hunt. Reference photos of each animal were
   consulted so the low-poly builds carry the RIGHT silhouette & colours
   (antlers, tusks, manes, dorsal fins, humps, stripes…).

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
                 Use ctx.mat(0xRRGGBB) for shared materials and CBZ.boxGeom(
                 w,h,d) for boxes (both are draw-call friendly). No colliders,
                 no lights, no per-frame work — just a static posed group.
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

  // small shared shape helpers (kept local; builds may use them or roll boxes).
  function box(w, h, d, m) { return new THREE.Mesh(CBZ.boxGeom(w, h, d), m); }
  function leg(m, w, h) { return new THREE.Mesh(CBZ.boxGeom(w || 0.16, h || 0.9, w || 0.16), m); }
  CBZ.WL = { box: box, leg: leg };   // exposed so species builds share the helpers

  // ============================================================
  //  REFERENCE SPECIES — Whitetail Deer (the template every build mirrors).
  //  A tan quadruped: long body, arched neck, wedge head, thin legs, white
  //  tail flag, a modest 4-point rack on the buck. Nose toward +X, feet y=0.
  // ============================================================
  S({
    id: "whitetail_deer", name: "Whitetail Deer", biome: "forest", rarity: "common",
    hp: 30, fur: "Deer Hide", furValue: 45, meat: "Venison", meatValue: 12, meatYield: 2,
    scale: 1, herd: [6, 14], packs: 4, spd: 2.6, danger: 0, spook: 30, color: 0x8a5a32,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat, r = ctx.rng;
      const tan = m(0x9a6a3c), belly = m(0xd9c3a0), dark = m(0x5c3a20);
      const g = new T.Group();
      const body = box(1.6, 0.78, 0.68, tan); body.position.set(0, 1.02, 0); g.add(body);
      const under = box(1.5, 0.3, 0.6, belly); under.position.set(0, 0.72, 0); g.add(under);
      const neck = box(0.4, 0.85, 0.4, tan); neck.position.set(0.82, 1.45, 0); neck.rotation.z = -0.5; g.add(neck);
      const head = box(0.55, 0.42, 0.4, tan); head.position.set(1.16, 1.86, 0); g.add(head);
      const snout = box(0.3, 0.24, 0.26, dark); snout.position.set(1.42, 1.78, 0); g.add(snout);
      [[0.05, 0.19], [-0.05, 0.19], [0.05, -0.19], [-0.05, -0.19]].forEach(function (o, i) {
        const e = box(0.14, 0.22, 0.06, tan); e.position.set(1.06 + o[0], 2.06, o[1]); g.add(e);   // ears
      });
      // 4-point antlers (bucks only — a coin flip per animal)
      if (r() < 0.5) {
        [-1, 1].forEach(function (s) {
          const beam = box(0.06, 0.5, 0.06, dark); beam.position.set(1.12, 2.28, s * 0.14); beam.rotation.z = 0.2; g.add(beam);
          const t1 = box(0.05, 0.28, 0.05, dark); t1.position.set(1.22, 2.5, s * 0.2); t1.rotation.z = 0.6; g.add(t1);
          const t2 = box(0.05, 0.22, 0.05, dark); t2.position.set(1.0, 2.5, s * 0.18); t2.rotation.z = -0.5; g.add(t2);
        });
      }
      [[0.58, 0.24], [0.58, -0.24], [-0.58, 0.24], [-0.58, -0.24]].forEach(function (o) {
        const l = leg(tan, 0.15, 1.0); l.position.set(o[0], 0.5, o[1]); g.add(l);
      });
      const tail = box(0.18, 0.34, 0.1, belly); tail.position.set(-0.82, 1.12, 0); g.add(tail);
      return g;
    },
  });

  // ---- The rest of the bestiary is appended below by the biome batches.
  //      (forest, desert/savanna, farmland, snow/ice, and the ocean.)
})();
