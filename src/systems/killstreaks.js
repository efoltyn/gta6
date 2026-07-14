/* ============================================================
   systems/killstreaks.js - COD-style KO streak rewards.

   Tracks consecutive player knockdowns from fists, guns, and legacy
   beat-up actions. Capture breaks the streak. 25 arms the nuke.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  const REWARDS = [
    { n: 3,  name: "RADAR SWEEP",      sub: "Guards marked. Keep moving." },
    { n: 5,  name: "COUNTER-SCAN",     sub: "Heat reduced. Yard confused." },
    { n: 7,  name: "RIOT PACKAGE",     sub: "The block is watching now." },
    { n: 10, name: "CHOPPER ALERT",    sub: "Maximum noise. Maximum heat." },
    { n: 15, name: "EMP BLAST",        sub: "Searchlights stumble." },
    { n: 25, name: "TACTICAL NUKE",    sub: "Press N for TACTICAL NUKE." },
  ];
  const NUKE_KEY = "N";

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
    const city = CBZ.game && CBZ.game.mode === "city";
    meter.style.display = (!city && CBZ.game && CBZ.game.state === "playing" && streak > 0) ? "block" : "none";
    meter.textContent = "STREAK " + streak + (best > streak ? "  BEST " + best : "");
    meter.classList.toggle("armed", nukeReady && !nukeUsed);
  }

  function showKill(actor) {
    if (CBZ.game && CBZ.game.mode === "city") return;
    title.textContent = streak >= 2 ? streak + " KILL STREAK!" : "";
    sub.textContent = "";
    points.textContent = "+50";
    killed.textContent = "You Killed " + nameOf(actor);
    pop("");
  }

  function showReward(r) {
    if (CBZ.game && CBZ.game.mode === "city") return;
    title.textContent = r.n + " KILL STREAK!";
    sub.textContent = r.name + (r.n === 25 ? " - Press " + NUKE_KEY + " for TACTICAL NUKE." : "");
    points.textContent = "+50";
    killed.textContent = r.n === 25 ? "TACTICAL NUKE READY" : r.sub;
    pop(r.n === 25 ? "nuke" : "");
    CBZ.sfx && CBZ.sfx(r.n === 25 ? "alarm" : "key");

    if (r.n === 5 && CBZ.addHeat) CBZ.addHeat(-18);
    if (r.n === 15) {
      if (CBZ.addHeat) CBZ.addHeat(-45);
      if (CBZ.searchlights) for (const s of CBZ.searchlights) s.disabled = Math.max(s.disabled || 0, 5);
    }
  }

  function onDown(actor, source) {
    if (!CBZ.game || CBZ.game.mode === "city" || CBZ.game.state !== "playing" || nukeUsed) return;
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
    if (CBZ.game && CBZ.game.mode === "city") { reset(); return; }
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
    if (!nukeReady || nukeUsed || !CBZ.game || CBZ.game.mode === "city" || CBZ.game.state !== "playing") return;
    nukeUsed = true;
    nukeReady = false;
    title.textContent = "TACTICAL NUKE INBOUND";
    sub.textContent = "Match-ending streak reward";
    points.textContent = "";
    killed.textContent = "The whole block goes quiet";
    pop("nuke");
    setMeter();

    CBZ.flashToast && CBZ.flashToast("TACTICAL NUKE");
    CBZ.sfx && CBZ.sfx("alarm");
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
      CBZ.flashHint && CBZ.flashHint("TACTICAL NUKE: " + dropped + " targets dropped.", 3.0);
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

  CBZ.killstreakOnDown = onDown;
  CBZ.killstreakReset = reset;
  CBZ.killstreakBreak = breakStreak;

  CBZ.onAlways(94, function () {
    if (CBZ.game.mode === "survival" || CBZ.game.mode === "city") {
      meter.style.display = "none";
      box.classList.remove("pop", "nuke", "ended");
      return;   // killstreaks / tactical-nuke are a prison thing
    }
    const el = (CBZ.game && CBZ.game.elapsed) || 0;
    if (el + 0.001 < lastElapsed) reset();
    lastElapsed = el;
    setMeter();
  });
})();
