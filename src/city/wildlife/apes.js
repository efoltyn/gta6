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
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat;
      const g = new T.Group();
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      const coat = m(0x2b2b2e), silver = m(0x9aa0a4), face = m(0x3f3a38), dark = m(0x17171a);
      // the sloped torso: chest carried HIGH at the front, rump low behind
      const chest = box(1.0, 1.1, 1.15, coat); chest.position.set(0.42, 1.42, 0); g.add(chest);
      const belly = box(1.0, 0.9, 1.0, coat); belly.position.set(-0.3, 1.06, 0); g.add(belly);
      const rump = box(0.6, 0.7, 0.9, coat); rump.position.set(-0.82, 0.92, 0); g.add(rump);
      // THE SILVER SADDLE — the back panel that names him, lower back only
      const saddle = box(0.95, 0.16, 1.02, silver); saddle.position.set(-0.42, 1.56, 0); g.add(saddle);
      // shoulder boulders over the arms
      [0.4, -0.4].forEach(function (z) {
        const sh = box(0.62, 0.5, 0.42, coat); sh.position.set(0.62, 1.78, z); g.add(sh);
      });
      // head: domed crest, heavy brow, flat dark face low on the skull
      const head = box(0.56, 0.5, 0.56, coat); head.position.set(1.06, 1.86, 0); g.add(head);
      const crest = box(0.34, 0.26, 0.4, coat); crest.position.set(1.0, 2.16, 0); g.add(crest);
      const brow = box(0.34, 0.14, 0.5, coat); brow.position.set(1.3, 1.94, 0); g.add(brow);
      const muzzle = box(0.26, 0.34, 0.42, face); muzzle.position.set(1.34, 1.7, 0); g.add(muzzle);
      const nose = box(0.1, 0.12, 0.2, dark); nose.position.set(1.48, 1.76, 0); g.add(nose);
      // ARMS = FRONT LEGS. Long, thick, planted: tall ground-touching columns
      // the rig will discover, with the knuckle fists joined onto them.
      [0.36, -0.36].forEach(function (z) {
        const arm = box(0.34, 1.26, 0.34, coat); arm.position.set(0.66, 0.63, z); g.add(arm);
        const fist = box(0.4, 0.22, 0.38, dark); fist.position.set(0.72, 0.11, z); g.add(fist);
      });
      // short hind legs, folded low under the rump
      [0.3, -0.3].forEach(function (z) {
        const leg = box(0.3, 0.72, 0.3, coat); leg.position.set(-0.72, 0.36, z); g.add(leg);
        const foot = box(0.42, 0.14, 0.3, dark); foot.position.set(-0.62, 0.07, z); g.add(foot);
      });
      return g;
    },
  });
})();
