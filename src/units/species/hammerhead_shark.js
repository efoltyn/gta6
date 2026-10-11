/* ============================================================
   units/species/hammerhead_shark.js — the great hammerhead as NPC War fights it.

   OWNED BY: the great hammerhead agent. This file is the whole animal for the
   battle: its numbers, its body, how it moves and how it fights. Edit this
   file (and shared helpers under src/units/kit/ if you must); never the
   battle's files.

   TODAY (wave A) every hook below falls back to what the game already has:
     body     src/city/wildlife/aquatic.js (the bestiary's low-poly build)
     motion   the swim rig: CBZ.buildSwimRig / CBZ.animateSwim (city/wildlife_rig.js)
     fight    creature_combat's LUNGE (the swimmer's strike) + the swim rig's jaw, driven by
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
  CBZ.unitKit.register("hammerhead_shark", {
    kind: "species",
    stats: {
      hp: 150, spd: 2.5, danger: 0.5, bite: 26, scale: 0.95,
      chase: 6.324999999999999, march: 3.47875,
      dmg: 35.1, rate: 1.2999999999999998,
      brave: false, prey: false,
    },
    // build(ctx) { ... return group; }        ctx = { THREE, mat, rng, id }
    // animate(unit, dt) { ... }               replaces the shared swim rig
    // fight(unit, tgt, dt, opts) { ... }       replaces CBZ.creatureFight(unit, tgt, dt, opts)
  });
})();
