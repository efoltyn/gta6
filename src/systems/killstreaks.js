/* ============================================================
   systems/killstreaks.js - COD-style KO streak rewards.

   Tracks consecutive player knockdowns from fists, guns, and legacy
   beat-up actions. Capture breaks the streak. 25 arms the nuke.

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
   scoreboards fighting over one screen. Streaks, the nuke and this whole HUD
   belong to the ESCAPE scenario, which is the one with a block to end.
   `escapeOnly()` is now the single gate every entry point below asks.
============================================================ */
(function () {
  "use strict";
  // SHOW DON'T TELL (JAIL_SHOW_DONT_TELL, declared in entities/ai.js, gated by
  // systems/capture.js). Returns true when the line was suppressed.
  function tellToast(m) { if (CBZ.jailTell) return CBZ.jailTell.toast(m); if (CBZ.flashToast) try { CBZ.flashToast(m); } catch (e) {} return false; }
  function tellHint(m, s) { if (CBZ.jailTell) return CBZ.jailTell.hint(m, s); if (CBZ.flashHint) try { CBZ.flashHint(m, s); } catch (e) {} return false; }

  const CBZ = window.CBZ;
  if (!CBZ) return;

  // THE ONE GATE (see the header). Every reward, card, meter write and the
  // nuke asks this and nothing else.
  function escapeOnly() { return !!(CBZ.game && CBZ.game.mode === "escape"); }

  const REWARDS = [
    { n: 3,  name: "RADAR SWEEP",      sub: "Guards marked. Keep moving." },
    { n: 5,  name: "COUNTER-SCAN",     sub: "Heat reduced. Yard confused." },
    { n: 7,  name: "RIOT PACKAGE",     sub: "The block is watching now." },
    { n: 10, name: "CHOPPER ALERT",    sub: "Maximum noise. Maximum heat." },
    { n: 15, name: "EMP BLAST",        sub: "Searchlights stumble." },
    { n: 25, name: "TACTICAL NUKE",    sub: "Ready. End the whole block." },
  ];
  const NUKE_KEY = "N";

  /* PRISON_TOUCH_PROMPTS (flag declared in systems/interactions.js).
     "Press N for TACTICAL NUKE" is unactionable on a touchscreen, and this one
     could not be cured by re-skinning the text where it already lives: the
     callout is #streakHud, which css/hud.css:167 sets `pointer-events:none`
     and whose .pop animation ends at opacity 0 — a button in there is
     invisible and untappable within 1.55 s. The nuke gets a real pill in the
     shared prompt band instead, armed for as long as it is actually armed. */
  const PTP = () => !CBZ.CONFIG || CBZ.CONFIG.PRISON_TOUCH_PROMPTS !== false;
  const onTouch = () => !!(CBZ.touchMode ||
    (document.body && document.body.classList.contains("touch")));
  // Desktop keeps its exact legacy sentence; touch is pointed at the pill.
  const nukeCue = () => (PTP() && onTouch()
    ? " - Tap the TACTICAL NUKE button."
    : " - Press " + NUKE_KEY + " for TACTICAL NUKE.");

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
  let nukeReady = false;
  let nukeUsed = false;
  let lastElapsed = 0;

  function nameOf(actor) {
    if (!actor || !actor.data || !actor.data.name) return "TARGET";
    return actor.data.name.replace(/^the |^a |^an /, "").toUpperCase();
  }

  function pop(kind) {
    box.classList.remove("pop", "nuke", "ended");
    void box.offsetWidth;
    if (kind) box.classList.add(kind);
    box.classList.add("pop");
  }

  function setMeter() {
    meter.style.display = (escapeOnly() && CBZ.game.state === "playing" && streak > 0) ? "block" : "none";
    meter.textContent = "STREAK " + streak + (best > streak ? "  BEST " + best : "");
    meter.classList.toggle("armed", nukeReady && !nukeUsed);
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
    sub.textContent = r.name + (r.n === 25 ? nukeCue() : "");
    points.textContent = "+50";
    killed.textContent = r.n === 25 ? "TACTICAL NUKE READY" : r.sub;
    pop(r.n === 25 ? "nuke" : "");
    if (r.n !== 25 && CBZ.sfx) CBZ.sfx("key");

    if (r.n === 5 && CBZ.addHeat) CBZ.addHeat(-18);
    if (r.n === 15) {
      if (CBZ.addHeat) CBZ.addHeat(-45);
      if (CBZ.searchlights) for (const s of CBZ.searchlights) s.disabled = Math.max(s.disabled || 0, 5);
    }
  }

  function onDown(actor, source) {
    if (!escapeOnly() || CBZ.game.state !== "playing" || nukeUsed) return;
    streak++;
    best = Math.max(best, streak);
    CBZ.game.killstreak = streak;
    CBZ.game.bestKillstreak = Math.max(CBZ.game.bestKillstreak || 0, best);

    showKill(actor);
    for (const r of REWARDS) {
      if (streak >= r.n && !unlocked[r.n]) {
        unlocked[r.n] = true;
        if (r.n === 25) nukeReady = true;
        setTimeout(() => showReward(r), 260);
      }
    }
    setMeter();
  }

  function reset() {
    streak = 0;
    best = Math.max(best, (CBZ.game && CBZ.game.bestKillstreak) || 0);
    unlocked = {};
    nukeReady = false;
    nukeUsed = false;
    if (CBZ.game) CBZ.game.killstreak = 0;
    box.classList.remove("pop", "nuke", "ended");
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
    nukeReady = false;
    if (CBZ.game) CBZ.game.killstreak = 0;
    setMeter();
  }

  function detonateNuke() {
    if (!nukeReady || nukeUsed || !escapeOnly() || CBZ.game.state !== "playing") return;
    nukeUsed = true;
    nukeReady = false;
    title.textContent = "TACTICAL NUKE INBOUND";
    sub.textContent = "Match-ending streak reward";
    points.textContent = "";
    killed.textContent = "The whole block goes quiet";
    pop("nuke");
    setMeter();

    // the streak panel above already reads TACTICAL NUKE INBOUND; a toast
    // saying the same words beside it is the clutter, not the drama.
    tellToast("TACTICAL NUKE");
    CBZ.shake && CBZ.shake(2.4);
    CBZ.doSlowmo && CBZ.doSlowmo(1.2);
    if (CBZ.el && CBZ.el.flash) {
      CBZ.el.flash.classList.remove("go"); void CBZ.el.flash.offsetWidth; CBZ.el.flash.classList.add("go");
    }

    setTimeout(() => {
      let dropped = 0;
      const drop = (a) => {
        if (!a || a.dead || a.escaped) return;
        if (CBZ.aiKill) CBZ.aiKill(a, null, { noDrop: true, noKnock: true, quiet: true });
        else { a.hp = 0; a.dead = true; a.ko = 0; a.hunt = 0; a.alert = 0; }
        if (CBZ.game.koLog && a.data && a.data.name) CBZ.game.koLog[a.data.name] = true;
        dropped++;
      };
      CBZ.guards.forEach(drop);
      CBZ.npcs.forEach(drop);
      // every body dropped went through CBZ.aiKill, and city/killfeed.js owns
      // the ONE popup a death is allowed. A tally line is a second scoreboard.
      tellHint("TACTICAL NUKE: " + dropped + " targets dropped.", 3.0);
      CBZ.shake && CBZ.shake(3.0);
      if (CBZ.winGame) setTimeout(() => CBZ.winGame("nuke"), 700);
    }, 900);
  }

  addEventListener("keydown", (e) => {
    if (e.repeat) return;
    if (e.code !== "KeyN" && e.key.toLowerCase() !== "n") return;
    // BUILD-MODE / N-KEY COLLISION: systems/buildmode.js also binds N (build
    // mode toggle) via a CAPTURE-phase window listener + stopPropagation, so
    // in the normal case this bubble-phase listener never even sees the N
    // keydown while build mode can be toggled (see buildmode.js's file
    // header for the capture-vs-bubble ordering proof). This check is
    // defense-in-depth for any path that reaches here anyway (e.g. a future
    // refactor of that listener, or this file loading in a context where
    // build mode's own gates differ) — a build-mode session in progress
    // must never let N slip through and detonate the tactical nuke.
    if (CBZ.buildMode && CBZ.buildMode.active) return;
    detonateNuke();
  });

  /* The pill's target. It fires "@prisonNukeDetonate" rather than a synthesized
     "n" for a reason worth writing down: buildmode.js claims N with a
     CAPTURE-phase WINDOW listener that stopPropagation()s, and the listener
     above is a BUBBLE-phase window listener — so a synthetic keydown can be
     swallowed before it ever reaches the nuke. Calling the function directly
     cannot be intercepted, and this wrapper re-applies the identical
     build-mode guard so a tap and a keypress remain the same act. */
  CBZ.prisonNukeDetonate = function () {
    if (CBZ.buildMode && CBZ.buildMode.active) return;
    detonateNuke();
  };

  CBZ.killstreakOnDown = onDown;
  CBZ.killstreakReset = reset;
  CBZ.killstreakBreak = breakStreak;

  CBZ.onAlways(94, function () {
    // ESCAPE ONLY, asked as a scenario question rather than as a list of the
    // modes somebody remembered to exclude (see the header).
    if (!escapeOnly()) {
      meter.style.display = "none";
      box.classList.remove("pop", "nuke", "ended");
      return;
    }
    const el = (CBZ.game && CBZ.game.elapsed) || 0;
    if (el + 0.001 < lastElapsed) reset();
    lastElapsed = el;
    setMeter();
    // Armed = tappable. Re-armed every frame; interactions.js's TTL sweep
    // retires the pill the instant the nuke is spent, the streak breaks or the
    // run ends, so a live nuke button can never outlive the nuke.
    // Touch only: on a keyboard the streak callout already says "Press N".
    // No world point — the nuke is not a thing you stand at — so the pill
    // sits in the bottom band.
    if (nukeReady && !nukeUsed && CBZ.prisonPrompt && onTouch() &&
        !(CBZ.buildMode && CBZ.buildMode.active)) {
      CBZ.prisonPrompt("nuke", "@prisonNukeDetonate", "TACTICAL NUKE", { key: "n" });
    }
  });

  // ---- ratchet declaration (see CBZ.prisonPromptAudit in interactions.js) ----
  (CBZ._prisonPromptSites || (CBZ._prisonPromptSites = [])).push(
    { id: "nuke", act: "@prisonNukeDetonate", was: "Press N for TACTICAL NUKE." }
  );
})();
