/* ============================================================
   systems/state.js — screen/state machine, reset, win, and the
   button wiring for title / pause / win screens.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const { player, playerChar, el, keycard, cam } = CBZ;
  const g = CBZ.game;

  const screens = {
    title: document.getElementById("title"),
    pause: document.getElementById("pause"),
    win: document.getElementById("win"),
    survwin: document.getElementById("survwin"),
    survlose: document.getElementById("survlose"),
  };
  const roleButtons = Array.from(document.querySelectorAll(".role-btn"));
  const modeButtons = Array.from(document.querySelectorAll(".mode-btn"));

  function setState(s) {
    g.state = s;
    document.body.classList.toggle("state-playing", s === "playing");
    // the ARENA modes (survival + gungame) share one pair of result cards
    // (#survwin/#survlose); each fills/relabels them at show time. escape
    // keeps its own #win card.
    const arena = g.mode === "survival" || g.mode === "gungame";
    screens.title.classList.toggle("hidden", s !== "title");
    screens.pause.classList.toggle("hidden", s !== "paused");
    screens.win.classList.toggle("hidden", !(s === "won" && !arena));
    if (screens.survwin) screens.survwin.classList.toggle("hidden", !(s === "won" && arena));
    if (screens.survlose) screens.survlose.classList.toggle("hidden", s !== "lost");
  }

  function setRole(role) {
    g.role = role === "cop" ? "cop" : "inmate";
    roleButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.role === g.role));
  }

  function setMode(id) {
    // Momentary hit-stop / finisher slow-mo must never survive an arrest,
    // escape, retry, or mode transition.
    CBZ.hitstop = 0;
    CBZ.slowmo = 0;
    const prev = g.mode;
    // "gungame" is only a real destination while modes/gungame.js registered
    // it (GUNGAME_V1) — otherwise the button falls back to escape, exactly
    // like the pre-mode stub did.
    g.mode = id === "survival" ? "survival"
      : (id === "city" ? "city"
      : (id === "gungame" && CBZ.modes.gungame ? "gungame" : "escape"));
    // leaving GUN GAME must scrub everything it borrowed: bots out of the
    // shared npc/bot lists, the prison cast un-hidden, rung weapons wiped.
    // Runs BEFORE the root-visibility lines below so they settle the final
    // look for the mode we are ENTERING.
    if (prev === "gungame" && g.mode !== "gungame" && CBZ.gungameExit) { try { CBZ.gungameExit(); } catch (e) { console.error("[gungame exit]", e); } }
    if (g.mode !== "escape" && CBZ.setSimulationView) CBZ.setSimulationView(false);
    modeButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.mode === g.mode));
    document.body.classList.toggle("mode-survival", g.mode === "survival");
    document.body.classList.toggle("mode-city", g.mode === "city");
    document.body.classList.toggle("mode-gungame", g.mode === "gungame");
    const m = CBZ.modes[g.mode];
    if ((g.mode === "survival" || g.mode === "city" || g.mode === "gungame") && m && m.build) { try { m.build(); } catch (e) { console.error("[mode build]", e); } }
    // GUN GAME borrows worlds it never builds: the prison stays visible when
    // its JAIL map is chosen, the disaster island when ISLAND is (the match
    // reset re-applies this per the picker; CBZ.gungameWorlds is the truth).
    const ggw = g.mode === "gungame" && CBZ.gungameWorlds ? CBZ.gungameWorlds() : null;
    if (CBZ.prisonRoot) CBZ.prisonRoot.visible = g.mode === "escape" || !!(ggw && ggw.jail);
    if (g.mode !== "survival" && CBZ.surv && CBZ.surv.arena) CBZ.surv.arena.root.visible = !!(ggw && ggw.island);
    if (g.mode !== "city" && CBZ.city && CBZ.city.arena) CBZ.city.arena.root.visible = false;
    // leaving city cleanly cancels any in-progress WASTED/spectate state so the
    // kill-cam HUD + global respawn listeners can't leak into another mode.
    if (g.mode !== "city" && CBZ.cityDeathReset) CBZ.cityDeathReset();
  }
  CBZ.setMode = setMode;

  function resetGame() {
    CBZ.hitstop = 0;
    CBZ.slowmo = 0;
    const mode = g.mode === "survival" ? "survival" : (g.mode === "city" ? "city" : (g.mode === "gungame" ? "gungame" : "escape"));
    if (CBZ.setSimulationView) CBZ.setSimulationView(false);
    if (CBZ.clearGore) CBZ.clearGore();   // wipe blood/gibs from the prior match
    g.detection = 0; g.invuln = 0; g.elapsed = 0;
    document.body.classList.toggle("mode-survival", mode === "survival");
    document.body.classList.toggle("mode-city", mode === "city");
    document.body.classList.toggle("mode-gungame", mode === "gungame");
    if (mode === "escape") {
    const role = g.role === "cop" ? "cop" : "inmate";
    g.cigs = 0; g.caughtCount = 0; g.trades = 0; g.hasKey = false;
    g.strikeHeatFloor = 0; g.cellWatch = false;   // three-strikes arc (systems/capture.js)
    // ---- THE SENTENCE (games/jail.js -> systems/capture.js) ----
    // A prison run that STARTED with an arrest carries a stretch to serve; a
    // plain "escape again" carries none and is the pure escape game it always
    // was. The handoff is a consumed pair, never a second sentence formula:
    // games/jail.js's transport stamps _jailSentenceIn/_jailBailIn, this reset
    // takes them exactly once, and capture.js runs the clock down.
    g.jailSentence = (g._jailSentenceIn | 0) || 0;
    g.jailBail = (g._jailBailIn | 0) || 0;
    g._jailSentenceIn = 0; g._jailBailIn = 0;
    g.jailServed = 0;
    g.complaints = 0; g.role = role;
    g.gangStanding = [0, 0];
    g.gangDebt = [0, 0];
    g.gangProtection = [0, 0];
    g.gangJob = null;
    g.lowProfileT = 0;
    g.racketProtectionT = 0; g.racketGuard = null; g.racketDebt = 0; g.racketStanding = 0; g.racketPressureT = 0; g.racketHintT = 0;
    g.blockRumor = null; g.socialDirectorT = 0; g.socialDirectorLast = null; g.watcherDirectorT = 0; g.watcherLast = null; g.gossipHuddleT = 0; g.gangTierT = [0, 0]; g.turfCheckpointT = [0, 0];
    g.socialProfile = { paid: 0, threatened: 0, refused: 0, helped: 0, listened: 0, bargained: 0, exploited: 0, last: "" };
    g.witnessReportT = 0; g.snitchReports = 0; g.lastKnown = null; g.caseSearchCD = 0;
    g.caseFile = { heat: 0, reports: [], lastSource: "", lastType: "", corrupt: 0 };
    // g.snitchIntelT is GONE (2026-08-04). It was a 30-second countdown whose
    // only reader was a #gangHud chip; the fact it stood in for — WHICH inmate
    // you have made as a rat — lives on the actor as `snitchKnown` now
    // (entities/ai.js, JAIL_SNITCH_KNOWLEDGE) and is reset with the roster.
    g.inventory = {}; g.koLog = {}; g.stealsDone = 0;
    g.kos = 0; g.deaths = 0; g.gossipNoticeT = 0; g.gangNoticeT = 0;
    if (CBZ.econ.reseed) CBZ.econ.reseed();   // fresh prison every run (no identical carnage)
    el.cigText.textContent = "0";
    if (CBZ.resetWeaponInventory) CBZ.resetWeaponInventory(role);
    CBZ.refreshInventory();
    el.keycard.classList.remove("have");
    el.bar.style.width = "0%";
    el.vignette.style.boxShadow = "inset 0 0 200px 40px rgba(220,30,40,0)";
    CBZ.setObjective(role === "cop" ? "Patrol the block, break up fights, and raid the armory." : "Find a keycard for checkpoints, or scout vents and tunnels for another way out.");

    const spawn = role === "cop" ? CBZ.COP_SPAWN : CBZ.SPAWN;
    player.pos.copy(spawn); player.vy = 0; player.grounded = true;
    player.hp = 100; player.dead = false; player.ko = 0;
    player.stun = 0; player.subdue = 0; player.gang = null; player.captureState = "normal"; player.captureT = 0;
    // Escape has no stamina updater of its own. Always start it full so a
    // depleted city/survival save cannot leak into jail, while physics also
    // treats jail sprint as unlimited for the duration of the run.
    player.stamina = (CBZ.SURV && CBZ.SURV.staminaMax) || 100;
    player.sprint = false; player.crouch = false;
    if (CBZ.applyPlayerRole) CBZ.applyPlayerRole(role);
    if (player._bandMesh) player._bandMesh.visible = false; // drop gang colours
    if (playerChar.cuffed) playerChar.cuffed = false;
    playerChar.group.position.copy(spawn);
    playerChar.group.rotation.z = 0;
    cam.yaw = 0; cam.pitch = CBZ.CAM_DEFAULT_PITCH || 0.28;
    if (CBZ.resetZoom) CBZ.resetZoom();
    if (CBZ.fpsResetWeapons) CBZ.fpsResetWeapons();
    if (CBZ.killstreakReset) CBZ.killstreakReset();

    keycard.collected = false; keycard.group.visible = true;
    keycard.group.scale.setScalar(1); keycard.ring.visible = true;

    CBZ.coins.forEach((c) => {
      c.collected = false; c.anim = 0; c.group.visible = true;
      c.group.scale.setScalar(1); c.group.position.y = c.baseY;
      if (c.ring) c.ring.visible = true;
    });

    CBZ.closeDoor();

    // reset the armory gate
    if (CBZ.armory) {
      const a = CBZ.armory; a.open = false; a.t = 0; a.gate.position.y = 3;
      a.lamp.material.color.setHex(0xff3b3b); a.lamp.material.emissive.setHex(0xff0000);
      if (CBZ.colliders.indexOf(a.collider) === -1) CBZ.colliders.push(a.collider);
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
      if (a.resetSlots) a.resetSlots();
    }

    CBZ.guards.forEach((gd) => {
      gd.wi = 0; gd.alert = 0; gd.bribed = 0; gd.ko = 0; gd.dead = false; gd.hp = null; gd.rep = 0; gd.quest = null; gd.approach = null; gd.investigate = null; gd.state = "patrol"; gd.approachCD = 3 + Math.random() * 5;
      // radio-window + gunpoint state (detection.js / intimidate.js): a new
      // run unties every screw and forgets every call, landed or pending.
      gd.tied = false; gd.radioT = null; gd._radioed = false; gd.intimidMode = null; gd.intimidT = 0; gd.poseHandsUp = false; gd._gunpointCD = 0;
      if (gd.char) gd.char.handsUp = false;
      gd.group.position.copy(gd.start); gd.group.rotation.z = 0; gd.flashlightOn = false; gd.flashlightReason = ""; gd.wedge.visible = false;
    });
    CBZ.npcs.forEach((n) => {
      n.bribed = 0; n.ko = 0; n.rep = 0; n.quest = null; n._loot = 0;
      n.group.rotation.z = 0;
    });
    if (CBZ.aiReset) CBZ.aiReset();
    if (CBZ.resetCrowd) CBZ.resetCrowd();
    
    // reset breaker box and security cameras
    if (CBZ.breaker) {
      const b = CBZ.breaker;
      b.sabotaged = false;
      b.timer = 0;
      b.light.material.color.setHex(0x39ff88);
      b.light.material.emissive.setHex(0x14c258);
      if (CBZ.ceilingLamp) {
        CBZ.ceilingLamp.material.color.setHex(0xffe9a8);
        CBZ.ceilingLamp.material.emissive.setHex(0xffcf66);
      }
    }
    if (CBZ.resetCameras) CBZ.resetCameras();
    } // end escape-only reset

    const m = CBZ.modes[mode];
    if (m && m.reset) { try { m.reset(g); } catch (e) { console.error("[mode reset]", e); } }

    CBZ.hideHint();
  }

  function setText(id, v) { const e = document.getElementById(id); if (e) e.textContent = v; }

  function fillSurvResult(win) {
    const st = (CBZ.surv && CBZ.surv.stats) || { placement: 1, total: 1, disastersSurvived: 0 };
    const time = CBZ.fmtTime(g.elapsed);
    if (win) {
      // GUN GAME shares this card and relabels it (CBZ.gungameFillResult);
      // survival reclaims its own copy every time it fills — same discipline
      // styleLossCard() already applies to the loss card.
      const box = screens.survwin;
      const logo = box && box.querySelector(".logo");
      if (logo) logo.textContent = "VICTORY ROYALE";
      setText("swPlace", "#1"); setText("swTotal", "of " + st.total);
      setText("swTime", time); setText("swDis", st.disastersSurvived);
      const timeEl = document.getElementById("swTime"), disEl = document.getElementById("swDis");
      if (timeEl && timeEl.nextElementSibling) timeEl.nextElementSibling.textContent = "Survived";
      if (disEl && disEl.nextElementSibling) disEl.nextElementSibling.textContent = "Disasters";
    } else {
      setText("slPlace", "#" + (st.placement || 1)); setText("slTotal", "of " + st.total);
      setText("slTime", time); setText("slDis", st.disastersSurvived);
    }
  }

  // the #survlose card ships survival-flavored in index.html; each loss
  // relabels it via JS at show time so JAIL transfers and DISASTER deaths
  // share one screen without touching the markup. (The stat labels are the
  // sibling .l divs of the #sl* value nodes.)
  function styleLossCard(jail, reason) {
    const box = screens.survlose;
    if (!box) return;
    const logo = box.querySelector(".logo");
    const sub = box.querySelector(".sub");
    const timeEl = document.getElementById("slTime");
    const disEl = document.getElementById("slDis");
    const timeLabel = timeEl && timeEl.nextElementSibling;
    const disLabel = disEl && disEl.nextElementSibling;
    const againBtn = document.getElementById("loseAgainBtn");
    if (jail) {
      /* SECURITY TIERS (systems/prisontiers.js): a third capture is a
         TRANSFER UP A LEVEL, not the end of the game, and this card is the
         between-levels beat — a state-transition screen, which is the one
         place words are legitimate. The tier owns the copy so the regime and
         the sentence describing it cannot drift apart; when the ladder is
         off (or this is a plain death) the original lines below still run. */
      const T = CBZ.prisonTier && CBZ.prisonTier.card ? CBZ.prisonTier.card() : null;
      if (logo) logo.textContent = T ? T.logo : "TRANSFERRED";
      if (sub) sub.textContent = T ? T.sub : (reason === "transferred"
        ? "Strike three — shipped to max security"
        : "The escape is over");
      setText("slPlace", T ? T.place : String(Math.min(3, g.caughtCount || 3)));
      setText("slTotal", T ? T.total : "strikes");
      setText("slTime", CBZ.fmtTime(g.elapsed));
      if (timeLabel) timeLabel.textContent = "On the run";
      setText("slDis", T ? T.kept : (g.cigs || 0));
      if (disLabel) disLabel.textContent = T ? T.keptLabel : "Cigs left";
      // the button is part of the scene: you are not retrying, you are being
      // walked into the next wing.
      if (againBtn) againBtn.textContent = T ? T.button : "Try Again";
      // WHOSE COPY IS ON THIS CARD, recorded as a fact rather than guessed at
      // by string-matching it below. Same semantics the equality test had —
      // "is OUR line still the one showing" — but it now covers transfer copy
      // the tier authored, which a hard-coded pair of strings never could.
      if (sub) sub.dataset.jailText = sub.textContent;
    } else {
      if (againBtn) againBtn.textContent = "Try Again";
      if (logo) logo.textContent = "ELIMINATED";
      // survival owns its own .sub line (modes/survival.js finishRound writes
      // the cause/winner/record flavor BEFORE calling loseGame) — only clear
      // it if a previous JAIL loss left our transfer copy behind.
      if (sub && sub.dataset.jailText && sub.textContent === sub.dataset.jailText) {
        sub.textContent = "The disasters claimed you";
      }
      if (sub) delete sub.dataset.jailText;
      if (timeLabel) timeLabel.textContent = "Survived";
      if (disLabel) disLabel.textContent = "Disasters";
    }
  }

  function loseGame(reason) {
    if (g.state === "won" || g.state === "lost") return;
    setState("lost"); if (CBZ.sfx) CBZ.sfx("ko");
    // JAIL (escape): three-strikes transfer to max security — capture.js is
    // the caller. Survival keeps its placement stats (and relabels the card
    // back in case a jail loss restyled it earlier in the session).
    if (g.mode === "escape") { styleLossCard(true, reason); return; }
    // GUN GAME: a bot finished the ladder first — its own fill owns the card
    // (ladder standings, not disaster placement).
    if (g.mode === "gungame") { if (CBZ.gungameFillResult) CBZ.gungameFillResult(false); return; }
    fillSurvResult(false);
    styleLossCard(false);
  }
  CBZ.loseGame = loseGame;

  function winGame(reason, actor) {
    if (g.state === "won") return;
    setState("won"); CBZ.sfx("win");
    if (g.mode === "survival") { fillSurvResult(true); if (CBZ.recordSurvWin) CBZ.recordSurvWin(); return; }
    // GUN GAME: the player landed the final rung's kill — the shared win card
    // shows the ladder result (gungame.js owns the fill).
    if (g.mode === "gungame") { if (CBZ.gungameFillResult) CBZ.gungameFillResult(true); return; }
    if (g.mode === "escape" && g.cityWorld && CBZ.cityEvent) {
      CBZ.cityEvent("jail-escape", { respect: 4, panic: 2 }, { noWanted: true });
    }
    const who = actor ? actor.data.name.replace(/^the |^a |^an /, "") : "Someone";
    let sub = reason === "befriend" ? `${who} walked you out`
      : reason === "nuke" ? "Tactical nuke ended the run"
      : reason === "route" ? "Through a hidden escape route"
      : "Through the gate";
    // THE CROWN IS THE CLASSIFICATION YOU BEAT (systems/prisontiers.js).
    // Walking off a county farm and breaking out of segregation were the same
    // three words on this card; the tier relabels the logo and adds the wing
    // to the reason. On LOW (or with the ladder off) it is byte-identical.
    if (CBZ.prisonTier && CBZ.prisonTier.crown) {
      CBZ.prisonTier.crown(screens.win);
      sub = CBZ.prisonTier.winLine(sub);
    }
    document.getElementById("wReason").textContent = sub;
    document.getElementById("wTime").textContent = CBZ.fmtTime(g.elapsed);
    document.getElementById("wCigs").textContent = g.cigs;
    document.getElementById("wKos").textContent = g.kos || 0;
    document.getElementById("wCaught").textContent = g.caughtCount;
    // BACK TO THE STREETS: if a city run exists, breaking out of jail can drop you
    // straight back into the open city as an ESCAPED CONVICT (3★ floor, harder
    // cops — wanted.js/mode.js read g.escapedConvict). Reuses the same win-screen
    // card + the bindButton machinery as "Escape Again" — no new DOM framework: the
    // button is created once, lazily, and slotted next to againBtn.
    ensureStreetsBtn(g.mode === "escape" && !!g.cityWorld);
    if (CBZ.recordWin) CBZ.recordWin();
  }

  // lazily create (once) the "BACK TO THE STREETS" button inside the win card,
  // right after the existing againBtn, and show/hide it per call. Same look (.btn)
  // and same debounced wiring (bindButton) as the other win-screen buttons.
  let streetsBtn = null;
  function ensureStreetsBtn(show) {
    if (!streetsBtn) {
      const again = document.getElementById("againBtn");
      if (!again || !again.parentNode) return;
      streetsBtn = document.createElement("button");
      streetsBtn.id = "backToStreetsBtn";
      streetsBtn.className = again.className || "btn";
      streetsBtn.textContent = "BACK TO THE STREETS";
      again.parentNode.insertBefore(streetsBtn, again.nextSibling);
      bindButton("backToStreetsBtn", function () {
        g.escapedConvict = true;
        // YOU BROKE OUT — you did not walk out. The sentence dies with the wall
        // you went over, and your property stays in the precinct evidence
        // locker (city/wanted.js): only serving it or making bail opens that.
        g.jailSentence = 0; g._jailSentenceIn = 0; g._jailBailIn = 0;
        if (CBZ.arrestCount) CBZ.arrestCount("escapes");
        if (CBZ.setMode) CBZ.setMode("city");
        // Human-facing button: same full rebuild, so it gets the boot card too
        // (falls back to the raw call if the presented form isn't up yet).
        if (CBZ.startRunPresented) CBZ.startRunPresented();
        else if (CBZ.startRun) CBZ.startRun();
      });
    }
    streetsBtn.classList.toggle("hidden", !show);
  }

  CBZ.setState = setState;
  CBZ.setRole = setRole;
  CBZ.resetGame = resetGame;
  CBZ.winGame = winGame;

  // ---- button wiring ----
  roleButtons.forEach((btn) => {
    btn.addEventListener("click", () => setRole(btn.dataset.role));
  });
  setRole(g.role || "inmate");
  modeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      // A tile carrying data-href is NOT a mode of this build — it is another
      // game on the release, on its own page. There is nothing here to switch
      // to, so it navigates. Everything without data-href is untouched.
      if (btn.dataset.href) { location.href = btn.dataset.href; return; }
      setMode(btn.dataset.mode);
    });
  });
  setMode(g.mode || "escape");

  // ---- CITY: character-origin picker (index.html #originSelect, city/
  // origins.js applies the pick at run-start). Selection just lives on
  // g.cityOrigin for the session — no persistence hook needed here; city/
  // origins.js reads it once per city reset and stamps its own choice onto
  // the world ledger the first time a character is actually started.
  const originButtons = Array.from(document.querySelectorAll(".origin-btn"));
  const planeWrap = document.getElementById("originPlaneWrap");
  const planeSelect = document.getElementById("originPlaneSelect");
  const boatWrap = document.getElementById("originBoatWrap");
  const boatSelect = document.getElementById("originBoatSelect");
  const rollLine = document.getElementById("originRollLine");

  // THE ROSTER IS THE REGISTRY, NOT A LITERAL. This used to read
  // `(id === "barfly" || id === "tenant") ? id : "exec"` — a hand-kept list of
  // exactly the three stories that existed the day it was written, which
  // silently swallowed every story added afterwards and dropped the player
  // back onto the exec. city/origins.js exports cityOriginNormalize() off its
  // OWN registry keys, so a tenth story is valid here the moment it registers.
  function normalize(id) {
    if (CBZ.cityOriginNormalize) return CBZ.cityOriginNormalize(id);
    return (id === "barfly" || id === "tenant") ? id : "exec";
  }

  // THE AIRCRAFT SUB-SELECT — only the PILOT story opens in the air, so the
  // list only appears for it. Filled from CBZ.cityOriginPlanes(), which reads
  // the live registry militaryvehicles.js keeps; at the TITLE SCREEN the world
  // has not been built yet and that registry is empty, so we show the canonical
  // set as labels and let origins.js resolve a name to a real airframe at
  // run-start (it falls back to any flyable if the pick did not build).
  // These strings must match what the builders actually register as
  // `model.name` — strategic.js "B-2 SPIRIT", island_military.js "Fighter Jet"
  // / "Heavy Bomber" / "Helicopter", island_airport.js "Airliner" / "Private
  // Jet". They are only the TITLE-SCREEN labels (the world is not built yet);
  // origins.js resolves the chosen name against the live registry at
  // run-start and matches case-insensitively, so a casing drift here costs a
  // fallback to another airframe rather than a crash.
  const FALLBACK_PLANES = ["B-2 SPIRIT", "Heavy Bomber", "Fighter Jet", "Airliner", "Private Jet", "Helicopter"];

  // ONE SUB-SELECT, TWO STORIES. The pilot picks an airframe and the captain
  // picks a hull (owner, 2026-08-12: "captain like pilot should let me select
  // any boat in start menu"), and the strip of buttons, the active class, the
  // click binding and the "nothing chosen yet -> adopt what is highlighted"
  // rule are the same in both. Written once, so the second one cannot drift
  // from the first — the exact fault THE ROSTER IS THE REGISTRY note above
  // describes, one level up.
  //   rows: [{ id, label }]  ·  get(): current id  ·  set(id)
  function renderSub(host, rows, get, set) {
    if (!host) return;
    const chosen = get() || (rows[0] && rows[0].id) || null;
    host.innerHTML = "";
    rows.forEach((r) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "origin-plane-btn" + (r.id === chosen ? " active" : "");
      b.textContent = r.label || r.id;
      b.addEventListener("click", () => {
        set(r.id);
        Array.from(host.children).forEach((c) => c.classList.toggle("active", c === b));
      });
      host.appendChild(b);
    });
    if (chosen && !get()) set(chosen);
  }
  function renderPlanes() {
    const live = CBZ.cityOriginPlanes ? CBZ.cityOriginPlanes() : [];
    const names = live.length ? live.map((p) => p.name) : FALLBACK_PLANES;
    renderSub(planeSelect, names.map((n) => ({ id: n, label: n })),
      () => (CBZ.cityOriginPlane && CBZ.cityOriginPlane()) || null,
      (n) => { if (CBZ.setCityOriginPlane) CBZ.setCityOriginPlane(n); });
  }
  // THE BOAT LIST IS ALREADY TRUE AT THE TITLE SCREEN, which is why there is
  // no FALLBACK_BOATS beside FALLBACK_PLANES: water_hulls.js registers its
  // fleet at parse time, so CBZ.cityOriginBoats() answers with real hulls and
  // real lengths before a world exists. cityOriginBoatKey() resolves the
  // default (the working trawler the Captain card describes), so the button
  // lit here is the boat city/captain.js will actually put you on.
  function renderBoats() {
    const rows = CBZ.cityOriginBoats ? CBZ.cityOriginBoats() : [];
    renderSub(boatSelect, rows,
      () => (CBZ.cityOriginBoatKey && CBZ.cityOriginBoatKey()) || null,
      (k) => { if (CBZ.setCityOriginBoat) CBZ.setCityOriginBoat(k); });
  }

  // `picked` = the player physically clicked a story card. origins.js has
  // always distinguished a real pick from a picker SYNC (its peekLedger sets
  // the active card from the save and its own comment says "picker sync only —
  // no 'picked' intent") — but the intent flag it describes was never actually
  // built, so origins.js could not tell "the player chose the Pilot" from "the
  // picker is showing the Pilot because that is who is on record". That is the
  // whole bug: choosing a story silently adopted your existing life instead of
  // starting one. CBZ.setCityOrigin (the sync path) passes nothing; only the
  // click handler below passes true.
  function setOrigin(id, picked) {
    g.cityOrigin = normalize(id);
    if (picked) g.cityOriginPicked = true;
    originButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.origin === g.cityOrigin));
    if (planeWrap) {
      const wantPlane = g.cityOrigin === "pilot";
      planeWrap.style.display = wantPlane ? "" : "none";
      if (wantPlane) renderPlanes();
    }
    if (boatWrap) {
      const wantBoat = g.cityOrigin === "captain";
      boatWrap.style.display = wantBoat ? "" : "none";
      if (wantBoat) renderBoats();
    }
  }
  CBZ.setCityOrigin = setOrigin;
  originButtons.forEach((btn) => {
    // picking another character here is a GTA5-style SWITCH (city/origins.js
    // vaults the active character's ledger and activates this one) — never a
    // reset, so a plain click is all the intent we need.
    btn.addEventListener("click", () => {
      // RE-ROLL: clicking "Roll The Dice" while it is ALREADY selected rolls a
      // new life rather than doing nothing, so the player can shop for a start
      // they like. The roll is persisted by origins.js onto the character's
      // ledger, so it is only re-rollable until the run actually begins.
      if (btn.dataset.origin === "random" && g.cityOrigin === "random" && CBZ.cityOriginRoll) {
        const w = CBZ.cityWorldEnsure ? CBZ.cityWorldEnsure() : null;
        const comp = CBZ.cityOriginRoll();
        if (w) w.originRoll = comp;
        if (rollLine && CBZ.cityOriginDescribe) rollLine.textContent = CBZ.cityOriginDescribe(comp);
        g.cityOriginPicked = true;
        return;
      }
      setOrigin(btn.dataset.origin, true);   // true = a REAL pick, not a sync
    });
  });
  setOrigin(g.cityOrigin || "exec");

  function bindButton(id, fn) {
    const btn = document.getElementById(id);
    if (!btn) return;
    let last = 0;
    const run = (e) => {
      if (e && e.preventDefault) e.preventDefault();
      const t = performance.now();
      if (t - last < 180) return;
      last = t;
      fn(e);
    };
    btn.addEventListener("click", run);
    btn.addEventListener("pointerup", run);
  }

  function startRun() {
    // Never start on a partially-parsed game: the PLAY button exists in the
    // DOM long before the last script tag runs, and a start in that window
    // builds a fraction of the world (late-tag landmasses never register)
    // which main.js then stomps back to "title". main.js sets bootComplete
    // as the very first thing it does.
    if (!CBZ.bootComplete) return;
    CBZ.initAudio(); resetGame(); setState("playing");
    screens.title.classList.add("hidden");
    // CITY origin intro: city/mode.js's reset() (just run inside resetGame())
    // already called CBZ.cityOriginApply and knows whether a fresh character's
    // one-time scripted opening scene is active this run. Same jail-style
    // cinematic (front reveal -> orbit -> FP push-in), armed exactly like
    // escape mode; a returning character (no intro) behaves as before —
    // CBZ.startIntro() still fires but camera.js's own FPS-already-active
    // check neutralizes it instantly (unchanged legacy behavior).
    const cityIntro = g.mode === "city" && CBZ.cityOriginIntroActive && CBZ.cityOriginIntroActive();
    const campaignEscapeTP = g.mode === "escape" && !!(CBZ.cityCampaignActive && CBZ.cityCampaignActive());
    if (campaignEscapeTP) {
      // The campaign keeps one camera grammar across the rooftop, prison and
      // contracts.  Explicitly cancel fpsmode's one-shot handoff before the
      // prison reveal; legacy escape runs retain the original armed-FPS path.
      if (CBZ.setSimulationView) CBZ.setSimulationView(false);
      if (CBZ.disarmFPSAfterIntro) CBZ.disarmFPSAfterIntro();
      else if (CBZ.setFPS) CBZ.setFPS(false);
    } else if ((g.mode === "escape" || g.mode === "gungame" || cityIntro) && CBZ.armFPSAfterIntro) {
      // gungame spawns you armed — a shooting mode opens in first person,
      // exactly like the escape run's armed start.
      CBZ.armFPSAfterIntro();
    }
    let introOpts = cityIntro && CBZ.cityOriginIntroOpts ? CBZ.cityOriginIntroOpts() : undefined;
    if (campaignEscapeTP) introOpts = Object.assign({}, introOpts || {}, { keepThirdPerson: true });
    // A normal CITY sandbox start is already placed and camera-initialized by
    // city/mode.js. Do not launch the generic prison/origin reveal and rely on
    // fpsmode to cancel it one frame later: that produced a visible far-camera
    // flash and made a direct test start feel like another forced intro. Real
    // authored origin scenes and explicit prison runs still use the cinematic.
    const plainCitySandbox = g.mode === "city" && !cityIntro && !campaignEscapeTP;
    if (!plainCitySandbox) CBZ.startIntro(introOpts);
    CBZ.requestLock();
  }
  CBZ.startRun = startRun;

  // =======================================================================
  //  BOOT SCREEN — CITY_BOOT_SCREEN
  // =======================================================================
  // Measured 2026-08-04 (tools/load-profile.mjs, desktop, no CPU throttle):
  // a CITY start is ONE synchronous 26-31 s main-thread task — buildCity plus
  // the 39 landmass builders that city/worldmap.js runs in a single unyielding
  // for-loop — followed by ~13 s more before the first frame, where three
  // compiles ~107 programs. Until that build is sliced (LOAD-NOTES.md has the
  // teardown and the plan) the tab is genuinely frozen, and with NOTHING
  // painted it reads as a hung page — which is exactly what a phone kills.
  //
  // This does not make the build one millisecond faster. It paints an honest
  // card FIRST and hands the thread over only after that card is on screen,
  // so the freeze happens behind a screen that says what is happening. The
  // spinner animates `transform` and `opacity` ONLY, which Chrome keeps
  // running on the compositor thread while the main thread is blocked — so it
  // is still visibly moving during the 26 s, and the page never looks dead.
  //
  // CBZ.startRun itself is UNTOUCHED and still fully synchronous: every tool,
  // probe and gate in tools/ calls it and asserts on the world immediately
  // after it returns. Only the human-facing buttons route through here.
  // `?cfg_CITY_BOOT_SCREEN=0` → the buttons call startRun() directly, as before.
  if (CBZ.CONFIG.CITY_BOOT_SCREEN == null) CBZ.CONFIG.CITY_BOOT_SCREEN = true;

  let bootCard = null, bootBusy = false;
  function bootScreenEl() {
    if (bootCard) return bootCard;
    const style = document.createElement("style");
    // Compositor-only keyframes on purpose — see the note above.
    style.textContent =
      "@keyframes cbzBootSpin{to{transform:rotate(360deg)}}" +
      "@keyframes cbzBootPulse{0%,100%{opacity:.45}50%{opacity:1}}";
    document.head.appendChild(style);
    bootCard = document.createElement("div");
    bootCard.id = "bootload";
    bootCard.style.cssText =
      // 200 is above every existing layer (the highest in css/ is 140) — the
      // card must cover the title screen and the HUD while the thread is gone.
      "position:fixed;inset:0;z-index:200;display:none;flex-direction:column;" +
      "align-items:center;justify-content:center;gap:18px;background:#0f1622;" +
      "color:#fff7ec;font-family:Fredoka,system-ui,sans-serif;text-align:center;padding:24px";
    bootCard.innerHTML =
      '<div style="width:54px;height:54px;border:5px solid rgba(255,122,26,.25);' +
      'border-top-color:#ff7a1a;border-radius:50%;animation:cbzBootSpin 1s linear infinite"></div>' +
      '<div style="font-size:22px;font-weight:700;letter-spacing:.5px">BUILDING THE WORLD</div>' +
      '<div style="font-size:14px;max-width:34ch;line-height:1.5;opacity:.75;' +
      'animation:cbzBootPulse 2.2s ease-in-out infinite">Generating terrain, cities and traffic. ' +
      'The first load is the slow one — keep this tab open.</div>';
    document.body.appendChild(bootCard);
    return bootCard;
  }
  function showBootScreen(on) { bootScreenEl().style.display = on ? "flex" : "none"; }

  // The presented start: paint, then build. Same guards as startRun so a tap
  // during boot still can't build a half-registered world.
  function startRunPresented() {
    if (!CBZ.bootComplete || bootBusy) return;
    if (CBZ.CONFIG.CITY_BOOT_SCREEN === false) { startRun(); return; }
    bootBusy = true;
    showBootScreen(true);
    // Two frames, not one: the first flushes style/layout, the second only
    // runs after the compositor has actually PAINTED the card. Handing the
    // thread over on the first frame draws nothing and we are back to a white
    // freeze. ~32 ms, so pointer-lock user activation is unaffected.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        try { startRun(); }
        finally {
          // Hold the card across the first post-build frames too — that is
          // where the shader compile lives and the thread is still blocked.
          requestAnimationFrame(function () {
            requestAnimationFrame(function () { showBootScreen(false); bootBusy = false; });
          });
        }
      });
    });
  }
  CBZ.startRunPresented = startRunPresented;

  bindButton("playBtn", startRunPresented);
  bindButton("resumeBtn", () => { CBZ.requestLock(); });
  bindButton("againBtn", startRunPresented);
  // survival result screens
  bindButton("survAgainBtn", startRunPresented);
  bindButton("loseAgainBtn", startRunPresented);
  bindButton("survMenuBtn", () => setState("title"));
  bindButton("loseMenuBtn", () => setState("title"));
  CBZ.canvas.addEventListener("click", () => {
    if ((g.state === "playing" || g.state === "paused") && !(CBZ.surv && CBZ.surv.spectating)) CBZ.requestLock();
  });
})();
