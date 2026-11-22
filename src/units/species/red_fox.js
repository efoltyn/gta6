/* ============================================================
   units/species/red_fox.js — the red fox (Vulpes vulpes) as NPC War fields it.

   The animal is the canid family, src/units/kit/canid.js: its real
   measurements, coats, body, gait, body language and close fight are the
   "red_fox" row there (the same body Gang City's wildlife wears). This file
   registers it as a unit.
   How it fights: it does not, given the choice (rodents, rabbits, birds).
   Against anything its size it gapes and keeps away, darts only at the
   beaten, and runs the moment it is hurt.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const C = CBZ.canid;
  const H = C ? C.hooks("red_fox") : {};
  CBZ.unitKit.register("red_fox", {
    kind: "species",
    stats: C ? C.stats("red_fox") : { scale: 1, brave: false, prey: false },
    build: H.build, animate: H.animate, fight: H.fight, moves: H.moves,
  });
  const row = CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES.red_fox;
  if (row && C) row.mass = C.ROWS.red_fox.stats.mass;
})();
