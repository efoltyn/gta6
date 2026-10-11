/* ============================================================
   units/species/white_lion.js — the white lion as NPC War fights it.

   OWNED BY: the white lion agent. This file is the whole animal for the
   battle: its numbers, its body, how it moves and how it fights. Edit this
   file (and shared helpers under src/units/kit/ if you must); never the
   battle's files.

   TODAY (wave A) every hook below falls back to what the game already has:
     body     src/city/wildlife/bigcats.js (the bestiary's low-poly build)
     motion   the discovered gait rig: CBZ.wildlifeRig.buildGait / animateGait (city/wildlife_rig.js)
     fight    creature_combat's POUNCE (stalk, burst, leap, pin), driven by
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
  CBZ.unitKit.register("white_lion", {
    kind: "species",
    stats: {
      hp: 200, spd: 3, danger: 0.85, bite: 28, scale: 1.2,
      chase: 7.59, march: 4.1745,
      dmg: 37.800000000000004, rate: 1.055,
      brave: true, prey: false,
    },
    // build(ctx) { ... return group; }        ctx = { THREE, mat, rng, id }
    // animate(unit, dt) { ... }               replaces the shared gait rig
    // fight(unit, tgt, dt, opts) { ... }       replaces CBZ.creatureFight(unit, tgt, dt, opts)
  });
})();
