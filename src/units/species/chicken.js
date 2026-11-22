/* ============================================================
   units/species/chicken.js — the chicken as NPC War fights it.

   OWNED BY: the chicken agent. This file is the whole animal for the
   battle: its numbers, its body, how it moves and how it fights. Edit this
   file (and shared helpers under src/units/kit/ if you must); never the
   battle's files.

     body     the bird kit's chicken (src/world/birdkit.js): a hen or a
              rooster at real size, posed in the vertex shader
     motion   the same file: planted feet (two-bone IK), the head-bob,
              foraging pecks, a bolt with the wings beating; the battle
              tumbles the dead (battle/death.js)
     fight    creature_combat's PECK, driven by
              the battle's beastFight with the numbers below

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
  CBZ.unitKit.register("chicken", {
    kind: "species",
    stats: {
      hp: 6, spd: 1.6, danger: 0, scale: 0.35,
      chase: 4.2, march: 2.6,
      dmg: 13.5, rate: 1.65,
      brave: false, prey: true,
    },
    build: function (ctx) { return CBZ.birdKit ? CBZ.birdKit.chickenBuild(ctx) : null; },
    animate: function (unit, dt) { if (CBZ.birdKit) CBZ.birdKit.animateActor(unit, dt); },
  });
})();
