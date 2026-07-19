/* ============================================================
   main.js — boot. Everything else has already wired itself onto
   window.CBZ by the time this runs (it's loaded last); we just
   start on the title screen and kick off the render loop.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  // Boot-complete flag: the PLAY button is static DOM that paints before the
  // ~241 script tags finish parsing, so on a slow device (or a loaded headless
  // box) a tap can reach startRun while half the landmass modules haven't even
  // registered yet — building a fraction of the world, which this line then
  // stomps back to the title screen. startRun refuses to start until this is
  // set (the 83-lot/57-lot partial-world anomalies were exactly this race).
  CBZ.bootComplete = true;
  CBZ.setState("title");
  CBZ.startLoop();
})();
