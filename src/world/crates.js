/* ============================================================
   world/crates.js — wooden cover crates that break guard line-of-sight
   and create the stealth routes through the yard.

   F7 MIGRATION: crate(x,z,s) now routes through CBZ.spawnPiece (systems/
   pieces.js, F4) instead of calling world/materials.js's addBox directly.
   This is the migration PROOF for the Piece model — same compound-box
   geometry/materials/dimensions as before (moved into the inline def's
   build()), same solid + blockLOS behaviour, byte-identical scene.

   Geometry convention: build() returns the MAIN box Mesh itself (not
   ctx.group) with the two decorative boxes attached as ITS children at
   LOCAL offsets from the piece origin. This matters for two reasons:
     1. spawnPiece positions whatever build() returns at the piece's
        world pos — returning the main box directly (rather than wrapping
        it in a group) means its children inherit the correct world
        position for free, with no extra bookkeeping.
     2. CBZ.losBlockers is a flat Mesh[] tested via a NON-recursive
        raycast (see systems/pieces.js's new blockLOS handling) — a
        THREE.Group has no raycastable geometry of its own, so only a
        real Mesh registers as a sightline blocker. The old code only
        ever set blockLOS on the main box (the banding/bracket details
        never blocked LOS), so returning that specific mesh keeps the
        LOS-blocker count identical: 1 per crate, not 3.

   NOTE (documented, not "papered over"): addBox's collider omits y0/y1
   entirely for crates (never passed), which systems/physics.js treats as
   an unconditionally full-height wall that can never be stepped/vaulted
   over. spawnPiece's collider ALWAYS carries y0/y1 (here: the crate's
   real physical footprint, 0..s above its base) — a height-GATED
   collider. For every actor's actual traversal capability in this game
   (no vault/jump reaches a 2.6m+ box top), this is behaviourally
   identical to the old full-height collider; it only theoretically
   differs if something could get its feet above the crate's own top.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const { COL } = CBZ;

  function crate(x, z, s) {
    s = s || 2.6;
    const half = s / 2;

    const def = {
      footprint: { hx: half, hz: half },
      y0: -half, y1: half, // world y-range [0, s] once offset by pos.y (=half)
      build: function () {
        const main = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), CBZ.mat(COL.CRATE, {}));
        main.castShadow = true;
        main.receiveShadow = true;

        // darker plank banding so it reads as wood, not a flat cube
        // (same x/z/pos as the main box in the old code -> local (0,0,0))
        const band = new THREE.Mesh(new THREE.BoxGeometry(s + 0.06, s * 0.34, s + 0.06), CBZ.mat(COL.CRATE_D, {}));
        band.castShadow = false;
        band.receiveShadow = true;
        main.add(band);

        // a little corner bracket detail (old world y = s*0.92 -> local
        // offset from the main box's own centre at s/2 is s*0.42)
        const bracket = new THREE.Mesh(new THREE.BoxGeometry(s * 1.02, 0.08, s * 1.02), CBZ.mat(0x6e4a22, {}));
        bracket.position.set(0, s * 0.42, 0);
        bracket.castShadow = false;
        bracket.receiveShadow = true;
        main.add(bracket);

        return main;
      },
    };

    return CBZ.spawnPiece(def, { pos: { x: x, y: half, z: z }, solid: true, blockLOS: true });
  }

  crate(-9, 22);
  crate(8, 28);
  crate(-12, 36);
  crate(11, 17);
  crate(0, 11, 2.2);
})();
