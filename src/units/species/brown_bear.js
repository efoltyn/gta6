/* ============================================================
   units/species/brown_bear.js — the brown bear as NPC War fights it.

   OWNED BY: the brown bear agent. This file is the whole animal for the
   battle: its numbers, its body, how it moves and how it fights. Edit this
   file (and shared helpers under src/units/kit/ if you must); never the
   battle's files.

   TODAY (wave A) every hook below falls back to what the game already has:
     body     src/city/wildlife/bears.js (the bestiary's low-poly build)
     motion   the discovered gait rig: CBZ.wildlifeRig.buildGait / animateGait (city/wildlife_rig.js)
     fight    creature_combat's MAUL (close, rear, swipe, bite), driven by
              the battle's beastFight with the numbers below
   To redraw it: give `build` a lofted, skinned body (src/units/kit/loft.js,
   quadrig.js) and `animate` a planted-foot gait (src/units/kit/gait.js); see
   src/city/dogmodel.js for a complete animal built that way.

   STATS were the bestiary row + battle.html's derived beastTuning, baked
   here so the numbers live with the animal:
     hp spd danger bite scale   the species row (written back onto it, so the
                                bestiary and the battle can never disagree)
     chase march                m/s: the charge, and the pace on the march
     dmg rate                   one strike's damage (to a man), strikes per s scale
     brave                      never routs;  prey: fights nobody
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  CBZ.unitKit.register("brown_bear", {
    kind: "species",
    stats: {
      hp: 200, spd: 2.1, danger: 0.7, bite: 22, scale: 1.35,
      chase: 4.83, march: 2.6565000000000003,
      dmg: 29.700000000000003, rate: 1.16,
      brave: true, prey: false,
    },
    // build(ctx) { ... return group; }        ctx = { THREE, mat, rng, id }
    // animate(unit, dt) { ... }               replaces the shared gait rig
    // fight(unit, tgt, dt, opts) { ... }       replaces CBZ.creatureFight(unit, tgt, dt, opts)
  });
})();
