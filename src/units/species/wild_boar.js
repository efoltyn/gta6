/* ============================================================
   units/species/wild_boar.js — the wild boar as NPC War fights it.

   OWNED BY: the wild boar agent. This file is the whole animal for the
   battle: its numbers, its body, how it moves and how it fights. Edit this
   file (and shared helpers under src/units/kit/ if you must); never the
   battle's files.

   TODAY (wave A) every hook below falls back to what the game already has:
     body     src/city/wildlife/canines.js (the bestiary's low-poly build)
     motion   the discovered gait rig: CBZ.wildlifeRig.buildGait / animateGait (city/wildlife_rig.js)
     fight    creature_combat's GORE (lowered head, drive, toss), driven by
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
  CBZ.unitKit.register("wild_boar", {
    kind: "species",
    stats: {
      hp: 65, spd: 2.6, danger: 0.5, bite: 14, scale: 0.9,
      chase: 6.578, march: 3.6179000000000006,
      dmg: 18.900000000000002, rate: 1.2999999999999998,
      brave: false, prey: false,
    },
    // build(ctx) { ... return group; }        ctx = { THREE, mat, rng, id }
    // animate(unit, dt) { ... }               replaces the shared gait rig
    // fight(unit, tgt, dt, opts) { ... }       replaces CBZ.creatureFight(unit, tgt, dt, opts)
  });
})();
