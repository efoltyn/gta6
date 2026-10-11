"use strict";
/* src/battle/core.js — NPC War: the two names the shared combat brain asks this page for.
   Split out of games/battle.html (docs/npcwar/ARCHITECTURE.md). Every
   src/battle file shares ONE script scope: top-level names here are visible
   to the other battle files. Anything that needs the loaded engine runs in
   CBZ.npcwar.onBoot(), in file order, once the armoury is in. */

/* set in onBoot below (they need THREE / the raised world) */
let COARSE;

CBZ.npcwar.onBoot(function () {

  /* ---- the two names the shared combat brain asks this page for ----
     CBZ.now is the frame stamp combat_iq keys its timers on; this page
     advances it on SIM time, which is what makes fire discipline follow the
     speed dial. */
  if (CBZ.now == null) CBZ.now = performance.now();
  // creature_combat's rest height asks CBZ.floorAt (the mainland's ground);
  // out here the ground is whatever venue this battle raised.
  if (!CBZ.floorAt) CBZ.floorAt = function (x, z) { return MAP ? MAP.groundAt(x, z) : 0; };
  /* CBZ.queryCollidersNear / collide / collideSlide / sweepCircle /
     rayColliders (combat_iq's cover search, quadruped_ragdoll's extremities)
     come from microboot itself now (2026-09-29): physics.js's names and
     answers over the same record, oriented boxes included. The translation
     shims that lived here are gone. */

  COARSE = CBZ.studio.touchDevice;
  if (COARSE) document.body.classList.add("coarse");
});
