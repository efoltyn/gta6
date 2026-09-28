/* ============================================================
   systems/escapeend.js — HOW A PRISON RUN ENDS.

   OWNER (2026-09-28): "the screen that opens up when you escape is dumb,
   too. It's from the old UI." It was: the instant you stepped inside 3 m of
   a point in the vestibule, the world was frozen behind a beige card that
   shouted YOU'RE OUT! over six stat tiles and a personal-bests footer.

   Now the world keeps going:
     1. THE RUN OUT. You are through the out door (world/corridorkit.js puts
        the win point outside it). Control stays yours: the HUD goes, the
        klaxon keeps sounding from the port behind you, the tower beams
        swing after you and the screws are sent to the gate. You run.
     2. THE FADE. After a few seconds, or once you are well clear of the
        wall, the picture goes quietly to black.
     3. THE END. One short line and the way on, in the pause card's own
        buttons: Play Again, Main Menu (and Back to the Streets when a city
        run is waiting). No logo, no tiles, no numbers but the one time.

   A LOSS in the prison (dead, transferred, the cop's death) ends on the same
   black with its own one line, instead of the survival mode's result card.
   systems/state.js owns the state machine and calls show(); this file owns
   the words and the run out.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.game) return;
  const g = CBZ.game;

  const RUN_T = 6.0;      // seconds of running before the fade starts
  const CLEAR_M = 28;     // ...or this far from where you came out
  const FADE_T = 1.6;     // seconds to black
  const SIREN_EVERY = 2.8;

  const fadeEl = document.getElementById("escFade");
  const lineEl = document.getElementById("escEndLine");
  const againEl = document.getElementById("escEndAgain");

  let O = null;           // the run out in progress
  let fade = 0;           // 0..1, what #escFade shows

  function setFade(v) {
    v = Math.max(0, Math.min(1, v));
    if (v === fade) return;
    fade = v;
    if (fadeEl) fadeEl.style.opacity = String(v);
  }
  function aimLights(p, on) {
    const list = CBZ.searchlights || [];
    for (let i = 0; i < list.length; i++) {
      const sl = list[i];
      if (!sl) continue;
      if (!on) { if (sl._outroAim) { sl.aimAt = null; sl._outroAim = false; } continue; }
      // the beams lag the runner: each drags toward him at its own pace
      const k = 0.035 + (i % 3) * 0.012;
      if (!sl.aimAt || !sl._outroAim) { sl.aimAt = { x: p.x, z: p.z - 14 }; sl._outroAim = true; }
      sl.aimAt.x += (p.x - sl.aimAt.x) * k;
      sl.aimAt.z += (p.z - sl.aimAt.z) * k;
    }
  }
  function clear() {
    O = null;
    g.escapeOutro = false;
    document.body.classList.remove("escape-outro");
    aimLights(null, false);
  }

  /* 1. THE RUN OUT. systems/interactions.js calls this where it used to call
     winGame. True while the run out owns the ending (the caller must not win
     on its own); false when there is nothing to stage (not the prison, the
     cop, already over) and the caller should end the run directly. */
  function outro(reason) {
    if (O) return true;
    if (g.mode !== "escape" || g.state !== "playing" || g.role === "cop") return false;
    const P = CBZ.player && CBZ.player.pos;
    if (!P) return false;
    O = { t: 0, fadeT: 0, reason: reason || "gate", x: P.x, z: P.z, time: g.elapsed, sirenT: 0 };
    g.escapeOutro = true;
    // you are out: nobody lays a hand on you in the last seconds
    g.invuln = Math.max(g.invuln || 0, RUN_T + FADE_T + 3);
    document.body.classList.add("escape-outro");
    if (CBZ.guardHear) { try { CBZ.guardHear(P.x, P.z - 8, 70, { type: "alarm", player: true }); } catch (e) {} }
    if (CBZ.addHeat) { try { CBZ.addHeat(40); } catch (e) {} }
    return true;
  }

  CBZ.onUpdate(42.8, function (dt) {
    if (!O) return;
    if (g.mode !== "escape") { clear(); setFade(0); return; }
    const P = CBZ.player && CBZ.player.pos;
    if (!P) return;
    O.t += dt;
    // the port's klaxon, behind you
    if ((O.sirenT -= dt) <= 0) {
      O.sirenT = SIREN_EVERY;
      if (CBZ.worldSfx) { try { CBZ.worldSfx("lockdown", O.x, O.z - 6, { ref: 45, volume: 0.85, gap: 1 }); } catch (e) {} }
    }
    aimLights(P, true);
    g.invuln = Math.max(g.invuln || 0, 1);
    const clearOf = Math.hypot(P.x - O.x, P.z - O.z) > CLEAR_M;
    if (!O.fadeT && (O.t > RUN_T || clearOf)) O.fadeT = 1e-6;
    if (O.fadeT) {
      O.fadeT += dt;
      setFade(O.fadeT / FADE_T);
      if (O.fadeT >= FADE_T) {
        const reason = O.reason, time = O.time;
        clear();
        setFade(1);
        g.elapsed = time;            // the run is timed to the door, not the fade
        if (CBZ.winGame) CBZ.winGame(reason === "gate" ? undefined : reason);
      }
    }
  });
  // the black lifts the moment anything else is on: a new run, the menu,
  // another mode (the campaign's own handoff to the city, a Back to the
  // Streets press)
  CBZ.onAlways(42.8, function () {
    if (O) {
      if (g.state === "title" || g.state === "lost" || g.mode !== "escape") { clear(); setFade(0); }
      return;
    }
    if (fade > 0 && (g.state === "playing" || g.state === "title" || g.mode !== "escape")) setFade(0);
  });

  /* 3. THE END. One line. Called by systems/state.js winGame/loseGame for the
     prison; it has already flipped the state, which shows #escEnd. */
  function fmt(t) { return CBZ.fmtTime ? CBZ.fmtTime(t) : String(Math.round(t)); }
  function winLine(reason, actor) {
    // THE CROWN: breaking out of a harder wing says which one, and banks the
    // ladder (systems/prisontiers.js clears it back to the county farm)
    const beat = CBZ.prisonTier && CBZ.prisonTier.crown ? CBZ.prisonTier.crown() : "";
    if (reason === "befriend") {
      const who = actor && actor.data && actor.data.name ? actor.data.name.replace(/^the |^a |^an /, "") : "Someone";
      return who.charAt(0).toUpperCase() + who.slice(1) + " walked you out.";
    }
    if (reason === "served") return "Time served.";
    const t = g.elapsed || 0;
    const best = CBZ.bestEscape ? CBZ.bestEscape() : 0;
    const where = beat ? "Out of " + beat : "Out";
    return where + " in " + fmt(t) + (best && t < best ? ". A new best." : ".");
  }
  function loseLine(reason) {
    if (reason === "dead") return String(g._deathLine || "Dead").replace(/\.*$/, ".");
    const T = CBZ.prisonTier && CBZ.prisonTier.card ? CBZ.prisonTier.card() : null;
    if (T) return T.line;
    return "Shipped to max security.";
  }
  function show(kind, reason, actor) {
    const won = kind === "won";
    let line = "", again = "Play Again";
    if (won) line = winLine(reason, actor);
    else {
      line = loseLine(reason);
      const T = reason !== "dead" && CBZ.prisonTier && CBZ.prisonTier.card ? CBZ.prisonTier.card() : null;
      if (T && T.button) again = T.button;
    }
    if (lineEl) lineEl.textContent = line;
    if (againEl) againEl.textContent = again;
    return line;
  }

  CBZ.escapeEnd = {
    outro: outro,
    show: show,
    active: function () { return !!O; },
    audit: function () { return { running: !!O, t: O ? Math.round(O.t * 10) / 10 : 0, fade: fade, line: lineEl ? lineEl.textContent : "" }; },
  };
})();
