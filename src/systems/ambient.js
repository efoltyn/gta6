/* ============================================================
   systems/ambient.js — footstep clicks synced to the player's stride
   + occasional distant prison clanks for atmosphere.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const player = CBZ.player;

  let strideAccum = 0;     // distance since last footstep
  let clankT = 6;

  CBZ.onUpdate(80, function (dt) {
    // footsteps: a step every ~1.6 units travelled while grounded
    if (player.grounded && player.speed > 0.5 && player.stun <= 0) {
      strideAccum += player.speed * dt;
      const stride = player.crouch ? 1.1 : 1.7;
      if (strideAccum >= stride) { strideAccum = 0; CBZ.sfx("step"); }
    } else strideAccum = 0;

    // distant clanks now and then
    clankT -= dt;
    if (clankT <= 0) { clankT = 8 + CBZ.econ.rng() * 12; CBZ.sfx("clank"); }
  });
})();
