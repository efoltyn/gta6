/* ============================================================
   systems/music.js - sample-backed score beds.

   The old score generated pad, bass and arp voices with oscillators.
   These quiet local CC0 loops keep the atmosphere without runtime
   synthesis and rise gently when detection increases.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.onAlways || !CBZ.setAudioLoop) return;

  // Background music / score beds are INTENTIONALLY CUT (user: "no bullshit
  // background … no diy sounds"). Only diegetic loops remain — car engine,
  // cop siren, lockdown klaxon — and those are owned by audio.js. This module
  // is kept as a no-op so the boot order / script tags stay stable; it just
  // makes sure no stale score loop is ever left running.
  if (CBZ.stopAudioLoop) { try { CBZ.stopAudioLoop("score", 0); } catch (e) {} }
})();
