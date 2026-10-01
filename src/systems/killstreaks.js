/* ============================================================
   systems/killstreaks.js - consecutive knockdowns in the prison.

   Tracks consecutive player knockdowns from fists, guns, and legacy
   beat-up actions. Capture breaks the streak.

   ---- NO CARD (2026-09-30) ------------------------------------------------
   This file used to pop a Call of Duty card in the middle of a prison
   yard: "3 KILL STREAK! / RADAR SWEEP / +50 / You Killed VINCE", a
   "STREAK 3  BEST 5" meter, and reward captions that named game systems
   ("Heat reduced. Yard confused."). Owner law: no HUD that narrates or
   names a system. The card, the meter and every caption are deleted.
   What a streak DOES is kept, silently: a long run of men on the floor
   still cools the search at 5 and still blinds the searchlights at 15,
   and CBZ.game.killstreak / bestKillstreak still count for whoever reads
   them. ESCAPE ONLY: every other mode is untouched by this file.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  function escapeOnly() { return !!(CBZ.game && CBZ.game.mode === "escape"); }

  let streak = 0;
  let best = 0;
  let unlocked = {};
  let lastElapsed = 0;

  // what a streak does to the world; nothing on screen says so
  function reward(n) {
    if (n === 5 && CBZ.addHeat) CBZ.addHeat(-18);
    if (n === 15) {
      if (CBZ.addHeat) CBZ.addHeat(-45);
      if (CBZ.searchlights) for (const s of CBZ.searchlights) s.disabled = Math.max(s.disabled || 0, 5);
    }
  }
  const REWARD_AT = [3, 5, 7, 10, 15];

  function onDown(actor, source) {
    if (!escapeOnly() || CBZ.game.state !== "playing") return;
    streak++;
    best = Math.max(best, streak);
    CBZ.game.killstreak = streak;
    CBZ.game.bestKillstreak = Math.max(CBZ.game.bestKillstreak || 0, best);
    for (const n of REWARD_AT) {
      if (streak >= n && !unlocked[n]) { unlocked[n] = true; reward(n); }
    }
  }

  function reset() {
    streak = 0;
    best = Math.max(best, (CBZ.game && CBZ.game.bestKillstreak) || 0);
    unlocked = {};
    if (CBZ.game) CBZ.game.killstreak = 0;
  }

  function breakStreak() {
    if (streak <= 0) return;
    reset();
  }

  CBZ.killstreakOnDown = onDown;
  CBZ.killstreakReset = reset;
  CBZ.killstreakBreak = breakStreak;

  CBZ.onAlways(94, function () {
    if (!escapeOnly()) return;
    const el = (CBZ.game && CBZ.game.elapsed) || 0;
    if (el + 0.001 < lastElapsed) reset();
    lastElapsed = el;
  });

})();
