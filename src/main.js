/* ============================================================
   main.js — boot. Everything else has already wired itself onto
   window.CBZ by the time this runs (it's loaded last); we just
   start on the title screen and kick off the render loop.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  CBZ.setState("title");
  CBZ.startLoop();
})();
