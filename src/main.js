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
  // A ?mode= naming a game THIS PAGE does not carry (its scripts are sliced
  // out of disaster.html) must not strand the player in a ghost mode whose
  // world can never build. The check lives here because main.js is the one
  // script that runs after every mode has had its chance to register.
  if (CBZ.game.mode !== "escape" && !CBZ.modes[CBZ.game.mode]) {
    CBZ.setMode(CBZ.START_MODE && CBZ.modes[CBZ.START_MODE] ? CBZ.START_MODE : "escape");
  }
  CBZ.setState("title");
  CBZ.startLoop();
})();
