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
    const surv = g.mode === "survival";
    screens.title.classList.toggle("hidden", s !== "title");
    screens.pause.classList.toggle("hidden", s !== "paused");
    screens.win.classList.toggle("hidden", !(s === "won" && !surv));
    if (screens.survwin) screens.survwin.classList.toggle("hidden", !(s === "won" && surv));
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
    g.mode = id === "survival" ? "survival" : (id === "city" ? "city" : "escape");
    if (g.mode !== "escape" && CBZ.setSimulationView) CBZ.setSimulationView(false);
    modeButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.mode === g.mode));
    document.body.classList.toggle("mode-survival", g.mode === "survival");
    document.body.classList.toggle("mode-city", g.mode === "city");
    const m = CBZ.modes[g.mode];
    if ((g.mode === "survival" || g.mode === "city") && m && m.build) { try { m.build(); } catch (e) { console.error("[mode build]", e); } }
    if (CBZ.prisonRoot) CBZ.prisonRoot.visible = g.mode === "escape";
    if (g.mode !== "survival" && CBZ.surv && CBZ.surv.arena) CBZ.surv.arena.root.visible = false;
    if (g.mode !== "city" && CBZ.city && CBZ.city.arena) CBZ.city.arena.root.visible = false;
    // leaving city cleanly cancels any in-progress WASTED/spectate state so the
    // kill-cam HUD + global respawn listeners can't leak into another mode.
    if (g.mode !== "city" && CBZ.cityDeathReset) CBZ.cityDeathReset();
  }
  CBZ.setMode = setMode;

  function resetGame() {
    CBZ.hitstop = 0;
    CBZ.slowmo = 0;
    const mode = g.mode === "survival" ? "survival" : (g.mode === "city" ? "city" : "escape");
    if (CBZ.setSimulationView) CBZ.setSimulationView(false);
    if (CBZ.clearGore) CBZ.clearGore();   // wipe blood/gibs from the prior match
    g.detection = 0; g.invuln = 0; g.elapsed = 0;
    document.body.classList.toggle("mode-survival", mode === "survival");
    document.body.classList.toggle("mode-city", mode === "city");
    if (mode === "escape") {
    const role = g.role === "cop" ? "cop" : "inmate";
    g.cigs = 0; g.caughtCount = 0; g.trades = 0; g.hasKey = false;
    g.strikeHeatFloor = 0; g.cellWatch = false;   // three-strikes arc (systems/capture.js)
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
    g.snitchIntelT = 0;
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
      setText("swPlace", "#1"); setText("swTotal", "of " + st.total);
      setText("swTime", time); setText("swDis", st.disastersSurvived);
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
    if (jail) {
      if (logo) logo.textContent = "TRANSFERRED";
      if (sub) sub.textContent = reason === "transferred"
        ? "Strike three — shipped to max security"
        : "The escape is over";
      setText("slPlace", String(Math.min(3, g.caughtCount || 3)));
      setText("slTotal", "strikes");
      setText("slTime", CBZ.fmtTime(g.elapsed));
      if (timeLabel) timeLabel.textContent = "On the run";
      setText("slDis", g.cigs || 0);
      if (disLabel) disLabel.textContent = "Cigs left";
    } else {
      if (logo) logo.textContent = "ELIMINATED";
      // survival owns its own .sub line (modes/survival.js finishRound writes
      // the cause/winner/record flavor BEFORE calling loseGame) — only clear
      // it if a previous JAIL loss left our transfer copy behind.
      if (sub && (sub.textContent === "Strike three — shipped to max security" || sub.textContent === "The escape is over")) {
        sub.textContent = "The disasters claimed you";
      }
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
    fillSurvResult(false);
    styleLossCard(false);
  }
  CBZ.loseGame = loseGame;

  function winGame(reason, actor) {
    if (g.state === "won") return;
    setState("won"); CBZ.sfx("win");
    if (g.mode === "survival") { fillSurvResult(true); if (CBZ.recordSurvWin) CBZ.recordSurvWin(); return; }
    if (g.mode === "escape" && g.cityWorld && CBZ.cityEvent) {
      CBZ.cityEvent("jail-escape", { respect: 4, panic: 2 }, { noWanted: true });
    }
    const who = actor ? actor.data.name.replace(/^the |^a |^an /, "") : "Someone";
    const sub = reason === "befriend" ? `${who} walked you out`
      : reason === "romance" ? `${who} busted you out for love`
      : reason === "nuke" ? "Tactical nuke ended the run"
      : reason === "route" ? "Through a hidden escape route"
      : "Through the gate";
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
        if (CBZ.setMode) CBZ.setMode("city");
        if (CBZ.startRun) CBZ.startRun();
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
    btn.addEventListener("click", () => setMode(btn.dataset.mode));
  });
  setMode(g.mode || "escape");

  // ---- CITY: character-origin picker (index.html #originSelect, city/
  // origins.js applies the pick at run-start). Selection just lives on
  // g.cityOrigin for the session — no persistence hook needed here; city/
  // origins.js reads it once per city reset and stamps its own choice onto
  // the world ledger the first time a character is actually started.
  const originButtons = Array.from(document.querySelectorAll(".origin-btn"));
  function setOrigin(id) {
    // Exec is the main story path (crash → street → jail risk).
    g.cityOrigin = (id === "barfly" || id === "tenant") ? id : "exec";
    originButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.origin === g.cityOrigin));
  }
  CBZ.setCityOrigin = setOrigin;
  originButtons.forEach((btn) => {
    // picking another character here is a GTA5-style SWITCH (city/origins.js
    // vaults the active character's ledger and activates this one) — never a
    // reset, so a plain click is all the intent we need.
    btn.addEventListener("click", () => setOrigin(btn.dataset.origin));
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
    } else if ((g.mode === "escape" || cityIntro) && CBZ.armFPSAfterIntro) {
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
  bindButton("playBtn", startRun);
  bindButton("resumeBtn", () => { CBZ.requestLock(); });
  bindButton("againBtn", startRun);
  // survival result screens
  bindButton("survAgainBtn", startRun);
  bindButton("loseAgainBtn", startRun);
  bindButton("survMenuBtn", () => setState("title"));
  bindButton("loseMenuBtn", () => setState("title"));
  CBZ.canvas.addEventListener("click", () => {
    if ((g.state === "playing" || g.state === "paused") && !(CBZ.surv && CBZ.surv.spectating)) CBZ.requestLock();
  });
})();
