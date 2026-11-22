/* ============================================================
   units/species/arctic_wolf.js — the Arctic wolf (Canis lupus arctos) as
   NPC War fields it.

   The animal is the canid family, src/units/kit/canid.js: its real
   measurements, coats, body, gait, body language and close fight are the
   "arctic_wolf" row there (the same body Gang City's wildlife wears). This
   file registers it as a unit.
   How it fights: the gray wolf's repertoire, a little bolder (muskoxen
   rings, caribou).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const C = CBZ.canid;
  const H = C ? C.hooks("arctic_wolf") : {};
  CBZ.unitKit.register("arctic_wolf", {
    kind: "species",
    stats: C ? C.stats("arctic_wolf") : { scale: 1, brave: false, prey: false },
    build: H.build, animate: H.animate, fight: H.fight, moves: H.moves,
  });
  const row = CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES.arctic_wolf;
  if (row && C) row.mass = C.ROWS.arctic_wolf.stats.mass;
})();
