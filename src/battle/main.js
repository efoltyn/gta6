"use strict";
/* src/battle/main.js — NPC War: the kick: open the studio, load the armoury, then run every onBoot in file order.
   Split out of games/battle.html (docs/npcwar/ARCHITECTURE.md). Every
   src/battle file shares ONE script scope: top-level names here are visible
   to the other battle files. Anything that needs the loaded engine runs in
   CBZ.npcwar.onBoot(), in file order, once the armoury is in. */

const WARM = Q.get("warm") !== "0";           // the revert switch for the load
bootst("OPENING THE STUDIO");
if (WARM) {
  CBZ.studio.warm(ARMOURY);                   // in the air before the studio starts
  CBZ.studio.prefetch(NEED);
}
CBZ.studio.need(NEED).then(function () {
  bootst("OPENING THE ARMOURY");
  return WARM ? loadArmoury() : loadArmourySerial();
}).then(function () {
  CBZ.npcwar.runBoot();
}).catch(function (e) {
  bootst("LOAD FAILED " + (e && e.message ? e.message : e));
  console.error(e);
});
