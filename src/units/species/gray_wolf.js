/* ============================================================
   units/species/gray_wolf.js — the gray wolf (Canis lupus) as NPC War
   fields it.

   The animal is the canid family, src/units/kit/canid.js: its real
   measurements, coats, body, gait, body language and close fight are the
   "gray_wolf" row there (the same body Gang City's wildlife wears). This
   file registers it as a unit.
   How it fights: a pack tests a quarry, runs it and takes big game from
   behind (hamstrings, rump), the lead on the nose once it is spent; limb
   grabs on a man, two together drag him down.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const C = CBZ.canid;
  const H = C ? C.hooks("gray_wolf") : {};
  CBZ.unitKit.register("gray_wolf", {
    kind: "species",
    stats: C ? C.stats("gray_wolf") : { scale: 1, brave: false, prey: false },
    build: H.build, animate: H.animate, fight: H.fight, moves: H.moves,
  });
  const row = CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES.gray_wolf;
  if (row && C) row.mass = C.ROWS.gray_wolf.stats.mass;
})();
