/* ============================================================
   systems/ambient.js — footsteps synced to the player's stride.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const player = CBZ.player;

  let strideAccum = 0;     // distance since last footstep

  CBZ.onUpdate(80, function (dt) {
    // footsteps: a step every ~1.6 units travelled while grounded
    if (player.grounded && player.speed > 0.5 && player.stun <= 0) {
      strideAccum += player.speed * dt;
      const stride = player.crouch ? 1.1 : 1.7;
      if (strideAccum >= stride) { strideAccum = 0; CBZ.sfx("step"); }
    } else strideAccum = 0;

  });
})();
