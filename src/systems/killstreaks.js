/* ============================================================
   systems/killstreaks.js - COD-style KO streak rewards.

   Tracks consecutive player knockdowns from fists, guns, and legacy
   beat-up actions. Capture breaks the streak.

   ---- NO NUKE (2026-09-28) -------------------------------------------------
   A 25-KO streak used to arm a "TACTICAL NUKE" that dropped every guard and
   inmate in the compound and won the run. It was a Call of Duty joke nailed
   onto a prison escape: on a phone it put a TACTICAL NUKE pill into the
   prompt band, stacked over Steal / Talk / Trade (owner's screenshot). A
   man in a prison yard has no nuke. Deleted: the reward, the N key, the
   touch pill and the detonation. The city's real nuke is city/strategic.js.

   ---- ESCAPE ONLY (2026-08-19) --------------------------------------------
   OWNER, on Gun Game: "I'm seeing fucking dialogue pop ups. Why should there
   be dialogue?" This file was the loudest source of them, and it took a
   deathmatch to make that obvious.

   The gate here was an EXCLUSION LIST — `mode === "survival" || mode ===
   "city"` — so every mode written afterwards opted itself IN by existing.
   modes/gungame.js is a mode made entirely of kills, so every single kill
   popped the centre card ("You Killed FINN W. / +50"), every death popped
   "STREAK ENDED / Respawning", and the reward cards landed at 3, 5 and 7 of
   the EIGHT kills a gun-game ladder takes — narrating a prison at a player
   who is not in one:
       RADAR SWEEP    "Guards marked. Keep moving."   (no guards in an arena)
       COUNTER-SCAN   "Heat reduced. Yard confused."  (no heat, no yard)
       EMP BLAST      "Searchlights stumble."         (no searchlights)
   The 25-streak nuke is worse than flavour: it drops CBZ.npcs — which is
   where gun game registers its bots — and calls CBZ.winGame, so a streak
   reward could end a ladder match by pressing N.

   And gun game already HAS this system, done properly: consecutive kills are
   the weapon ladder. A second reward ladder stacked on the first is two
   scoreboards fighting over one screen. Streaks and this whole HUD
   belong to the ESCAPE scenario, which is the one with a block to end.
   `escapeOnly()` is now the single gate every entry point below asks.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  // THE ONE GATE (see the header). Every reward, card and
  // meter write asks this and nothing else.
  function escapeOnly() { return !!(CBZ.game && CBZ.game.mode === "escape"); }

  const REWARDS = [
    { n: 3,  name: "RADAR SWEEP",      sub: "Guards marked. Keep moving." },
    { n: 5,  name: "COUNTER-SCAN",     sub: "Heat reduced. Yard confused." },
    { n: 7,  name: "RIOT PACKAGE",     sub: "The block is watching now." },
    { n: 10, name: "CHOPPER ALERT",    sub: "Maximum noise. Maximum heat." },
    { n: 15, name: "EMP BLAST",        sub: "Searchlights stumble." },
  ];

  const hud = document.getElementById("hud") || document.body;
  const box = document.createElement("div");
  box.id = "streakHud";
  box.innerHTML =
    '<div class="streak-brackets"><span></span><span></span></div>' +
    '<div class="streak-title"></div>' +
    '<div class="streak-sub"></div>' +
    '<div class="streak-points"></div>' +
    '<div class="streak-kill"></div>';
  hud.appendChild(box);

  const meter = document.createElement("div");
  meter.id = "streakMeter";
  meter.className = "panel";
  meter.textContent = "STREAK 0";
  hud.appendChild(meter);

  const title = box.querySelector(".streak-title");
  const sub = box.querySelector(".streak-sub");
  const points = box.querySelector(".streak-points");
  const killed = box.querySelector(".streak-kill");

  let streak = 0;
  let best = 0;
  let unlocked = {};
  let lastElapsed = 0;

  function nameOf(actor) {
    if (!actor || !actor.data || !actor.data.name) return "TARGET";
    return actor.data.name.replace(/^the |^a |^an /, "").toUpperCase();
  }

  function pop(kind) {
    box.classList.remove("pop", "ended");
    void box.offsetWidth;
    if (kind) box.classList.add(kind);
    box.classList.add("pop");
  }

  function setMeter() {
    meter.style.display = (escapeOnly() && CBZ.game.state === "playing" && streak > 0) ? "block" : "none";
    meter.textContent = "STREAK " + streak + (best > streak ? "  BEST " + best : "");
  }

  function showKill(actor) {
    if (!escapeOnly()) return;
    title.textContent = streak >= 2 ? streak + " KILL STREAK!" : "";
    sub.textContent = "";
    points.textContent = "+50";
    killed.textContent = "You Killed " + nameOf(actor);
    pop("");
  }

  function showReward(r) {
    if (!escapeOnly()) return;
    title.textContent = r.n + " KILL STREAK!";
    sub.textContent = r.name;
    points.textContent = "+50";
    killed.textContent = r.sub;
    pop("");
    if (CBZ.sfx) CBZ.sfx("key");

    if (r.n === 5 && CBZ.addHeat) CBZ.addHeat(-18);
    if (r.n === 15) {
      if (CBZ.addHeat) CBZ.addHeat(-45);
      if (CBZ.searchlights) for (const s of CBZ.searchlights) s.disabled = Math.max(s.disabled || 0, 5);
    }
  }

  function onDown(actor, source) {
    if (!escapeOnly() || CBZ.game.state !== "playing") return;
    streak++;
    best = Math.max(best, streak);
    CBZ.game.killstreak = streak;
    CBZ.game.bestKillstreak = Math.max(CBZ.game.bestKillstreak || 0, best);

    showKill(actor);
    for (const r of REWARDS) {
      if (streak >= r.n && !unlocked[r.n]) {
        unlocked[r.n] = true;
        setTimeout(() => showReward(r), 260);
      }
    }
    setMeter();
  }

  function reset() {
    streak = 0;
    best = Math.max(best, (CBZ.game && CBZ.game.bestKillstreak) || 0);
    unlocked = {};
    if (CBZ.game) CBZ.game.killstreak = 0;
    box.classList.remove("pop", "ended");
    setMeter();
  }

  function breakStreak(reason) {
    if (streak <= 0) return;
    if (!escapeOnly()) { reset(); return; }
    title.textContent = "STREAK ENDED";
    sub.textContent = reason || "Captured";
    points.textContent = "";
    killed.textContent = streak + " streak lost";
    pop("ended");
    streak = 0;
    unlocked = {};
    if (CBZ.game) CBZ.game.killstreak = 0;
    setMeter();
  }

  CBZ.killstreakOnDown = onDown;
  CBZ.killstreakReset = reset;
  CBZ.killstreakBreak = breakStreak;

  CBZ.onAlways(94, function () {
    // ESCAPE ONLY, asked as a scenario question rather than as a list of the
    // modes somebody remembered to exclude (see the header).
    if (!escapeOnly()) {
      meter.style.display = "none";
      box.classList.remove("pop", "ended");
      return;
    }
    const el = (CBZ.game && CBZ.game.elapsed) || 0;
    if (el + 0.001 < lastElapsed) reset();
    lastElapsed = el;
    setMeter();
  });

})();
