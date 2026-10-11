/* ============================================================
   units/species/white_lion.js — the white lion, as NPC War fights it.

   OWNED BY: the lion agent (with lion.js).

   A white lion is not another species: it is Panthera leo carrying a
   recessive LEUCISM allele (the Timbavati lions), so it has the lion's
   skeleton, gait, numbers, fight and pride tactics exactly, and only the
   coat differs: cream to near-white fur, a pale blond mane, a pale tail
   tuft, pink nose, ear backs and lip line greyed instead of black, and
   either gold or pale blue-grey eyes. NOT albino: pigment is reduced, not
   absent (the eyes and pads keep colour).

   So this file is a coat over src/units/species/lion.js (CBZ.lionKit),
   which units/manifest.js's `needs` loads first. The registration below
   delegates lazily, so the file still loads (and registers) on its own.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const kit = function () { return CBZ.lionKit || null; };
  // the same animal, the same numbers (a white lion is a lion)
  const STATS = {
    hp: 215, spd: 1.4, danger: 0.85, bite: 60, scale: 1,
    chase: 14, march: 4.4, dmg: 60, rate: 1.0,
    brave: true, prey: false,
  };
  CBZ.unitKit.register("white_lion", {
    kind: "species",
    stats: STATS,
    build: function (ctx) { const K = kit(); return K ? K.build(ctx, "white") : null; },
    animate: function (m, dt) { const K = kit(); if (K) K.animate(m, dt); },
    moves: function (m, tgt, ctx) { const K = kit(); return K ? K.moves(m, tgt, ctx) : null; },
    fight: function (m, tgt, dt, opts) {
      const K = kit();
      return K ? K.fight(m, tgt, dt, opts) : CBZ.creatureFight(m, tgt, dt, opts);
    },
  });
})();
