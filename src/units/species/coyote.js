/* ============================================================
   units/species/coyote.js — the coyote (Canis latrans) as NPC War fields it.

   The animal is the canid family, src/units/kit/canid.js: its real
   measurements, coats, body, gait, body language and close fight are the
   "coyote" row there (the same body Gang City's wildlife wears). This file
   registers it as a unit.
   How it fights: an opportunist. Alone it rushes, grabs and shakes small
   prey and darts only at a turned back or a wounded animal; packs run deer
   down from behind.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const C = CBZ.canid;
  const H = C ? C.hooks("coyote") : {};
  CBZ.unitKit.register("coyote", {
    kind: "species",
    stats: C ? C.stats("coyote") : { scale: 1, brave: false, prey: false },
    build: H.build, animate: H.animate, fight: H.fight, moves: H.moves,
  });
  const row = CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES.coyote;
  if (row && C) row.mass = C.ROWS.coyote.stats.mass;
})();
