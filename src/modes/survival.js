/* ============================================================
   modes/survival.js — NATURAL DISASTER SURVIVAL (battle royale).

   100 players (you + ~99 bots) dropped on an island. Wave after wave of
   realistic, deadly disasters — earthquakes, tsunamis, tornadoes,
   lightning, wildfire, volcanic eruption, blizzard, meteor showers,
   sinkholes, and a final nuke. No zones, no rings — each disaster is
   announced, happens, and is declared over; the hazards themselves are
   the whole pressure. No combat: just survive longer than everyone
   else. Last one standing wins.

   This module owns the shared survival namespace CBZ.surv (the actor
   model + damage), the mode descriptor (build/reset), the arena lighting
   override (so disasters can recolour the whole sky), and the stamina /
   last-alive logic. It reuses the entire FPS engine: the character rig,
   procedural animation, movement, physics and third-person camera.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const g = CBZ.game;

  // ---- the player as a uniform "actor" so disasters treat it like a bot ----
  const playerActor = {
    isPlayer: true,
    get pos() { return CBZ.player.pos; },
    get group() { return CBZ.playerChar.group; },
    get hp() { return CBZ.player.hp; },
    set hp(v) { CBZ.player.hp = v; },
    get dead() { return CBZ.player.dead; },
    get speed() { return CBZ.player.speed; },
    outfit: 0x3a6fd6, skin: 0xe8b58c,   // gore colours for the player's own death
  };

  function liveBots() { let n = 0; const b = CBZ.bots; for (let i = 0; i < b.length; i++) if (!b[i].dead) n++; return n; }

  /* WHERE A BODY LANDS IS MATCH STATE. The ragdoll launch on a generic
     disaster death used Math.random, so two clients on the same seed ended a
     tsunami with the dead in different places — and this island's whole read
     is where the bodies are. One named stream, reseeded per match by reset().
     The DEBRIS puffs above it are left on Math.random deliberately: they are
     particles nobody else can see. */
  let deathRng = null;
  function deathRnd() { return deathRng ? deathRng() : Math.random(); }
  let matchNo = 0;
  function reseedDeaths() {
    deathRng = CBZ.seedStream ? CBZ.seedStream("surv-deaths-" + (++matchNo)) : null;
  }

  // a quick impact poof where a body hits — dust ring + a couple of clods
  function deathBurst(x, z) {
    if (!CBZ.fx) return;
    CBZ.fx.blast(x, z, { maxR: 2.6, color: 0xb9b0a2, life: 0.45 });
    for (let i = 0; i < 3; i++) CBZ.fx.dropDebris({ x: x + (Math.random() - 0.5) * 1.2, z: z + (Math.random() - 0.5) * 1.2, fromY: 1.6, vy: 3 + Math.random() * 2, size: 0.3 + Math.random() * 0.3, color: 0x8a8278, linger: 1.2 });
  }

  // colour by how grim the cause is, so the feed reads at a glance
  function causeColor(cause) {
    const c = cause || "";
    if (/lava|burn|incinerat|nuclear|vaporiz|fallout|meteor|bomb/.test(c)) return "#ff8a3a";
    if (/lightning/.test(c)) return "#9fd0ff";
    if (/ash|choked/.test(c)) return "#c9c2b6";
    if (/drown|swept|flood/.test(c)) return "#6fc6ff";
    if (/frozen|blizzard/.test(c)) return "#bfe6ff";
    if (/rubble|sinkhole|crushed|fell/.test(c)) return "#cbb89a";
    if (/beaten|thrown|debris|tornado/.test(c)) return "#ffd06b";
    return "#e6ecf5";
  }
  /* ---- ONE DEATH BUS ------------------------------------------------------
     OWNER DOCTRINE (scrolls/claude/engine-systems.md): every death funnels
     through city/killfeed.js, and it owns the ONLY sanctioned HUD popup —
     the corner feed. This mode used to run a FIFTH parallel text channel
     instead: CBZ.pushKill (systems/hud.js) rewriting the prison objective
     panel into a "Casualties" list, with its own colours, its own ageing and
     its own DOM. So a survival death never reached the bus every other death
     in the game uses, and the mode carried a killfeed nobody else could read.

     CBZ.cityLogDeath is the migration. The one thing we do NOT accept from it
     is the cause NORMALISATION — its label table is written for the city, so
     "incinerated by lava" comes back as "explosion" and "burned alive in the
     wildfire" comes back the same, which throws away exactly the detail that
     makes a disaster death readable. It returns the record it pushed, so the
     precise cause goes straight back on. */
  function reportDeath(actor, cause, imp) {
    if (!actor) return;
    const who = actor.isPlayer ? "You" : (actor.name || "A survivor");
    const label = cause || "eliminated";
    if (CBZ.cityLogDeath) {
      const e = CBZ.cityLogDeath(who, label, { you: !!actor.isPlayer });
      if (e) { e.cause = label; e.name = who; }
    } else if (CBZ.pushKill) {
      // degrade-safe: the old panel, byte-identical, if killfeed.js is absent
      const verb = actor.isPlayer ? "were" : "was";
      CBZ.pushKill(who + " " + verb + " " + label, actor.isPlayer ? "#ff6b6b" : causeColor(cause), actor.isPlayer);
    }
    /* ---- BLOOD IS EARNED, NOT ANNOUNCED --------------------------------
       This used to be an unconditional CBZ.gore() on EVERY death at a flat
       amount, which made blood the engine's way of saying "someone died".
       Nine of this island's causes do not break skin at all — a man who FROZE
       SOLID, DROWNED, CHOKED on ash, took a fatal dose of FALLOUT, was
       INCINERATED BY LAVA or VAPORIZED by the nuke sprayed exactly as much
       arterial red as one torn apart by a tornado. So the whole point of gore
       (this death was VIOLENT) was gone, and the owner's read was simply
       correct: "it shows for nothing… it shows too easily."

       systems/trauma.js owns the cause table now: it decides whether this
       death opened a body, and fires the gore that matches its PHYSICS
       (tear / crush / splat / burst / blunt / boom) rather than one generic
       burst for all of them. It also carries the beating that got them here,
       so a survivor you punched six times dies gorier than a clean kill.
       An unrecognised cause draws no blood — silence is the default now.

       CBZ.CONFIG.SURV_TRAUMA=false restores the original line below verbatim. */
    if (CBZ.trauma && CBZ.CONFIG.SURV_TRAUMA !== false) { CBZ.trauma.deathGore(actor, label, imp); return; }
    if (CBZ.gore && actor.pos) {
      let dir = null;
      if (imp && (imp.fromX != null || imp.dir)) {
        dir = imp.dir ? { x: imp.dir.x, z: imp.dir.z } : { x: actor.pos.x - imp.fromX, z: actor.pos.z - imp.fromZ };
      }
      const big = /lava|nuclear|vaporiz|meteor|bomb|tornado/.test(label);
      CBZ.gore(actor.pos.x, actor.pos.y + 1.0, actor.pos.z, {
        dir, amount: actor.isPlayer ? 1.4 : (big ? 1.25 : 0.95),
        cloth: actor.outfit, skin: actor.skin, player: actor.isPlayer,
      });
    }
  }

  function killPlayer(reason) {
    if (CBZ.player.dead) return;
    CBZ.player.dead = true;
    CBZ.player.hp = 0;
    surv.stats.placement = liveBots() + 1;     // everyone still alive beat you
    // DRAMATIC death: fling the body into a spinning ragdoll tumble that
    // physics.js integrates, a hard shake, an impact poof, a brief slow-mo,
    // then a death-cam + spectate takeover (NOT an instant cut to a screen).
    const a = Math.random() * 6.28;
    CBZ.player._death = {
      vx: Math.cos(a) * (3 + Math.random() * 3), vz: Math.sin(a) * (3 + Math.random() * 3),
      vy: 6 + Math.random() * 3, spin: (Math.random() * 2 - 1) * 7, spin2: (Math.random() * 2 - 1) * 5,
      t: 0, landed: false, seed: Math.random() * 6.28,
    };
    if (CBZ.player._phys) { CBZ.player._phys.air = false; CBZ.player._phys.down = 0; CBZ.player._phys.kx = CBZ.player._phys.kz = 0; }
    if (CBZ.shake) CBZ.shake(1.2);
    if (CBZ.sfx) CBZ.sfx("ko");
    if (CBZ.doSlowmo) CBZ.doSlowmo(0.5);
    deathBurst(CBZ.player.pos.x, CBZ.player.pos.z);
    surv._deathCause = reason || "eliminated";
    reportDeath(playerActor, reason, surv._lastImp);
    enterSpectate(reason);
  }

  // ---- spectate takeover: you stay in the still-running world (death-cam +
  //      slow orbit) while disasters keep going. A compact overlay shows your
  //      placement and keeps counting the field down; the round does NOT
  //      freeze until you press RESULTS or a winner is decided — then the
  //      REAL end screen (#survlose via CBZ.loseGame, systems/state.js) takes
  //      over with its already-bound Try Again / Main Menu buttons.
  if (CBZ.CONFIG.SURV_SPECTATE == null) CBZ.CONFIG.SURV_SPECTATE = true;   // false → death cuts straight to the lose card
  if (CBZ.CONFIG.SURV_DEATHCAM == null) CBZ.CONFIG.SURV_DEATHCAM = true;   // false → skip the death replay: banner + chaos drift immediately (the pre-replay flow)
  let overlay = null, titleEl = null, subEl = null, btnRow = null;
  let overlayHoldT = 0;    // ELIMINATED held back while the death replay's first beat plays
  function buildOverlay() {
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.id = "spectate";
    overlay.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:60;display:none;flex-direction:column;align-items:center;gap:10px;padding:18px 0 26px;pointer-events:none;font-family:Fredoka,system-ui,sans-serif;text-align:center;background:linear-gradient(to top,rgba(8,10,16,.82),rgba(8,10,16,0))";
    titleEl = document.createElement("div");
    titleEl.style.cssText = "font-size:clamp(30px,6vw,52px);font-weight:700;color:#ff5b5b;letter-spacing:2px;text-shadow:0 4px 0 #7c0c1a,0 6px 14px rgba(0,0,0,.5);opacity:0;transition:opacity .8s ease,transform .8s ease;transform:translateY(14px)";
    titleEl.textContent = "ELIMINATED";
    subEl = document.createElement("div");
    subEl.style.cssText = "color:#dfe6f0;font-size:15px;opacity:0;transition:opacity .9s ease .25s";
    btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;gap:14px;opacity:0;transition:opacity .6s ease .9s;pointer-events:auto";
    const mkBtn = (label, bg, sh) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.style.cssText = "font-family:inherit;font-weight:600;font-size:16px;color:#fff;border:0;border-radius:14px;padding:12px 22px;cursor:pointer;background:" + bg + ";box-shadow:0 6px 0 " + sh + ",0 10px 18px rgba(0,0,0,.3)";
      return b;
    };
    const resultsBtn = mkBtn("Results ➜", "#39c06a", "#1f8a45");
    btnRow.appendChild(resultsBtn);
    overlay.appendChild(titleEl); overlay.appendChild(subEl); overlay.appendChild(btnRow);
    document.body.appendChild(overlay);
    resultsBtn.addEventListener("click", finishRound);
  }
  // The live spectate status line. It carries GAME STATE only — placement and
  // how many are left — never how you died: that already went to the killfeed
  // (the one sanctioned popup), and repeating it under a giant "ELIMINATED"
  // was the death screen telling you what the screen had just shown you.
  function spectateLine() {
    const s = surv.stats;
    return "#" + (s.placement || 1) + " of " + (s.total || "?") +
      "  ·  " + surv.aliveCount() + " left";
  }
  function showSpectateOverlay() {
    buildOverlay();
    subEl.textContent = spectateLine();
    overlay.style.display = "flex";
    void overlay.offsetWidth;                  // reflow so the fade-in plays
    titleEl.style.opacity = "1"; titleEl.style.transform = "translateY(0)";
    subEl.style.opacity = "1"; btnRow.style.opacity = "1";
  }
  function enterSpectate(reason) {
    if (surv.spectating) return;
    // nothing left to watch (a lone survivor or a full wipe decides the round
    // instantly), or spectate disabled → straight to the results card
    if (CBZ.CONFIG.SURV_SPECTATE === false || liveBots() <= 1) { finishRound(); return; }
    surv.spectating = true; surv.spectateT = 0;
    if (document.exitPointerLock) { try { document.exitPointerLock(); } catch (e) {} }
    // THE DEATH REPLAY (parity with Gang City — owner: the city "goes to third
    // person and shows me my death", the disaster game should too). Arm the
    // close WASTED-style orbit for systems/camera.js and hold the ELIMINATED
    // banner back the same ~1.8s beat the city holds WASTED, so the ragdoll
    // fling plays out clean before any UI lands on it. The watcher below drops
    // the banner in while the orbit is still circling; the camera pulls out to
    // the chaos view on its own when the replay's beat is spent.
    if (CBZ.CONFIG.SURV_DEATHCAM !== false) {
      surv.deathCam = { t: 0, dur: 5.2 };
      overlayHoldT = 1.8;
    } else showSpectateOverlay();
  }
  // resolve the round for a dead player: leave spectate, record the run in
  // the persistent survival stats, fill the lose card's flavor line (cause,
  // round winner, lifetime record), and hand over to CBZ.loseGame() — the
  // proper #survlose screen whose buttons state.js already wired.
  function finishRound() {
    if (g.state === "won" || g.state === "lost") return;
    let winner = null;
    if (liveBots() === 1) { const b = CBZ.bots; for (let i = 0; i < b.length; i++) if (!b[i].dead) { winner = b[i].name; break; } }
    clearSpectate();
    // Only DISASTER rounds land in the persistent survival record (and show
    // its lifetime line) — a shark-sim death is a different game's loss.
    if (g.mode === "survival") recordSurvRun(surv.stats.placement || (liveBots() + 1));
    const sub = document.querySelector("#survlose .sub");
    if (sub) {
      const s = CBZ.survStats();
      const bits = ["You were " + (surv._deathCause || "eliminated")];
      if (winner) bits.push(winner + " outlasted everyone");
      if (g.mode === "survival" && s.runs) bits.push("Wins " + s.wins + "/" + s.runs + (s.bestPlacement ? " · best #" + s.bestPlacement : ""));
      sub.textContent = bits.join("  ·  ");
    }
    if (CBZ.loseGame) CBZ.loseGame(surv._deathCause || "eliminated");
  }
  function clearSpectate() {
    surv.spectating = false;
    surv.deathCam = null; overlayHoldT = 0;   // reset() routes here too — no replay leaks into the next match
    if (overlay) {
      overlay.style.display = "none";
      titleEl.style.opacity = "0"; titleEl.style.transform = "translateY(14px)";
      subEl.style.opacity = "0"; btnRow.style.opacity = "0";
    }
  }
  CBZ.clearSpectate = clearSpectate;

  const surv = {
    arena: null,
    built: false,
    spectating: false,     // true after the player dies until they pick a button
    deathCam: null,        // {t, dur} while the city-style death replay orbits (read by systems/camera.js)
    playerActor,
    stats: { total: 0, placement: 0, disastersSurvived: 0 },

    /* THE GROUND YOU SEE IS THE GROUND YOU STAND ON — INCLUDING WHERE IT IS
       GONE. A sinkhole is a hole in the FLOOR, not a black disc with an
       instakill radius painted on the grass (which is exactly what it was).
       systems/disasters.js publishes CBZ.survHoles; subtracting them here is
       the whole implementation, because everything that moves in this mode —
       the player's vertical physics, the bots' terrain follow, a thrown car —
       already asks this one function where the ground is. You fall in because
       there is nothing to stand on, and the landing is what kills you. */
    floorAt(x, z) {
      if (g.mode !== "survival" || !surv.arena) return 0;
      const holes = CBZ.survHoles;
      if (holes && holes.length) {
        for (let i = 0; i < holes.length; i++) {
          const h = holes[i];
          const dx = x - h.x, dz = z - h.z;
          if (dx * dx + dz * dz < h.mouth * h.mouth) return h.bottom;
        }
      }
      return surv.arena.groundHeightAt(x, z);
    },
    liveBots,
    aliveCount() { return (CBZ.player.dead ? 0 : 1) + liveBots(); },

    forEachActor(fn) {
      if (!CBZ.player.dead) fn(playerActor);
      const b = CBZ.bots;
      for (let i = 0; i < b.length; i++) if (!b[i].dead) fn(b[i]);
    },
    actors() { const a = []; surv.forEachActor(function (x) { a.push(x); }); return a; },

    hurt(actor, dmg, imp) {
      if (!actor || dmg <= 0 || actor.dead) return;
      // resolve the cause for the kill feed: explicit on the hit, else the
      // active disaster's default, else a generic fallback
      const cause = (imp && imp.cause) || surv._cause || null;
      if (actor.isPlayer) {
        if (g.invuln > 0) return;
        CBZ.player.hp -= dmg;
        if (CBZ.player.hp <= 0) { surv._lastImp = imp || null; killPlayer(cause || "eliminated"); }
      } else {
        actor.hp -= dmg;
        if (actor.hp <= 0) surv.killBot(actor, imp, cause);
      }
    },

    hurtRadius(x, z, radius, dmg, opts) {
      opts = opts || {};
      const r2 = radius * radius;
      surv.forEachActor(function (a) {
        const dx = a.pos.x - x, dz = a.pos.z - z;
        const d2 = dx * dx + dz * dz;
        if (d2 <= r2) {
          // physically BLAST everyone in the radius — real knockback / fling
          if (CBZ.body && (opts.knockback || opts.fling)) {
            CBZ.body.hit(a, { fromX: x, fromZ: z, force: opts.knockback || 7, fling: opts.fling || 0 });
          }
          surv.hurt(a, opts.instakill ? 1e6 : dmg, { fromX: x, fromZ: z, fling: opts.fling || (opts.instakill ? 5 : 0), cause: opts.cause });
        }
      });
    },

    killBot(b, imp, cause) {
      if (b.dead) return;
      b.dead = true; b.deadT = 0; b.hp = 0;
      if (CBZ.body) {
        if (imp && (imp.fling || imp.fromX != null || imp.dir)) {
          // killed by a directional force (blast/throw/wave) → fling that way
          CBZ.body.hit(b, { fromX: imp.fromX, fromZ: imp.fromZ, dir: imp.dir, force: imp.force || 7, fling: imp.fling || 5 });
        } else {
          /* generic disaster death → a dramatic upward ragdoll launch + spin.
             SEEDED: this decides where a body ENDS UP, which is a position
             every client has to agree on, not a particle effect. */
          const a = deathRnd() * 6.28;
          CBZ.body.hit(b, { dir: { x: Math.cos(a), z: Math.sin(a) }, force: 2.5 + deathRnd() * 3, fling: 5 + deathRnd() * 4 });
        }
      }
      reportDeath(b, cause != null ? cause : ((imp && imp.cause) || surv._cause), imp);
    },
  };
  CBZ.surv = surv;

  // ---- persistent survival record (mirrors systems/save.js's localStorage
  //      pattern, own key). state.js's winGame() calls CBZ.recordSurvWin();
  //      the death path calls recordSurvRun(placement) via finishRound().
  //      Guarded by surv._runRecorded so each round counts exactly once.
  //      Read back on the title card's survival note + both end screens. ----
  const STATS_KEY = "cellblockz_surv_stats";
  let survSaved = (function () { try { return JSON.parse(localStorage.getItem(STATS_KEY)) || {}; } catch (e) { return {}; } })();
  function persistSurvStats() { try { localStorage.setItem(STATS_KEY, JSON.stringify(survSaved)); } catch (e) {} }
  const titleNote = document.querySelector("#title .smallnote.mode-survival-only");
  const titleNoteBase = titleNote ? titleNote.textContent : "";
  function refreshSurvTitle() {
    if (!titleNote) return;
    titleNote.textContent = !survSaved.runs ? titleNoteBase
      : titleNoteBase + "  ·  Wins " + (survSaved.wins || 0) + "/" + survSaved.runs +
        (survSaved.bestPlacement ? "  ·  Best #" + survSaved.bestPlacement : "");
  }
  function recordSurvRun(placement) {
    if (surv._runRecorded) return;
    surv._runRecorded = true;
    survSaved.runs = (survSaved.runs || 0) + 1;
    if (placement === 1) survSaved.wins = (survSaved.wins || 0) + 1;
    if (placement >= 1 && (!survSaved.bestPlacement || placement < survSaved.bestPlacement)) survSaved.bestPlacement = placement;
    persistSurvStats();
    refreshSurvTitle();
  }
  CBZ.recordSurvWin = function () {
    if (!surv.stats.placement) surv.stats.placement = 1;
    recordSurvRun(1);
  };
  CBZ.survStats = function () { return { wins: survSaved.wins || 0, runs: survSaved.runs || 0, bestPlacement: survSaved.bestPlacement || 0 }; };
  refreshSurvTitle();

  // ---- arena lighting override: re-aim the sun onto the far island and
  //      let CBZ.survEnv (written by disasters) recolour sky/fog/flash ----
  let shadowMode = "escape";
  function setShadow(mode) {
    const sun = CBZ.sun; if (!sun || shadowMode === mode) return;
    shadowMode = mode;
    const sc = mode === "survival" ? 132 : 70;
    sun.shadow.camera.left = -sc; sun.shadow.camera.right = sc;
    sun.shadow.camera.top = sc; sun.shadow.camera.bottom = -sc;
    sun.shadow.camera.far = mode === "survival" ? 420 : 260;
    if (sun.shadow.camera.updateProjectionMatrix) sun.shadow.camera.updateProjectionMatrix();
  }

  CBZ.onAlways(93, function () {
    const isSurv = g.mode === "survival";
    setShadow(isSurv ? "survival" : "escape");
    if (!isSurv) { if (CBZ.sunTarget) CBZ.sunTarget.position.set(0, 0, 18); return; }
    const A = surv.arena; if (!A) return;
    const e = CBZ.survEnv;
    if (CBZ.sun) { CBZ.sun.position.set(A.center.x + 70, 140, A.center.z - 50); CBZ.sun.color.setHex(e.sunColor); CBZ.sun.intensity = e.sunInt; }
    if (CBZ.sunTarget) CBZ.sunTarget.position.set(A.center.x, 6, A.center.z);
    if (CBZ.hemi) { CBZ.hemi.color.setHex(e.hemiColor); CBZ.hemi.intensity = e.hemiInt + e.flash * 4; }
    if (CBZ.scene.fog) { CBZ.scene.fog.color.setHex(e.fog); CBZ.scene.fog.near = e.fogNear; CBZ.scene.fog.far = e.fogFar; }
    // tint the sky dome to the disaster mood so the whole sky reads cohesively
    // (clear blue → storm grey → volcanic red → blizzard white → nuke orange)
    if (CBZ.skyDome && CBZ.skyDome.material) CBZ.skyDome.material.color.setHex(e.fog);
  });

  // ---- stamina + spectate watcher + last-one-standing check ----
  let specHudT = 0;
  CBZ.onUpdate(30, function (dt) {
    if (g.mode !== "survival") return;
    const P = CBZ.player, S = CBZ.SURV;
    if (P.stamina === undefined) P.stamina = S.staminaMax;
    if (P.sprint) P.stamina = Math.max(0, P.stamina - S.staminaDrain * dt);
    else P.stamina = Math.min(S.staminaMax, P.stamina + S.staminaRegen * dt);

    if (g.state === "playing" && !P.dead && liveBots() === 0) {
      surv.stats.placement = 1;
      if (CBZ.winGame) CBZ.winGame("survival");   // fills #survwin + CBZ.recordSurvWin
      const sub = document.querySelector("#survwin .sub");
      if (sub) { const s = CBZ.survStats(); sub.textContent = "Last one standing" + (s.runs ? "  ·  Wins " + s.wins + "/" + s.runs : ""); }
      return;
    }

    // spectating: keep the overlay's field count live; the moment a single
    // survivor remains the round is decided → the real results screen.
    if (surv.spectating && g.state === "playing") {
      surv.spectateT += dt;
      if (liveBots() <= 1) { finishRound(); return; }
      // the held-back ELIMINATED banner lands once the fling has played out
      if (overlayHoldT > 0) { overlayHoldT -= dt; if (overlayHoldT <= 0) showSpectateOverlay(); }
      specHudT -= dt;
      if (specHudT <= 0 && subEl) { specHudT = 0.5; subEl.textContent = spectateLine(); }
    }
  });

  // ---- the mode descriptor ----
  function build() {
    if (surv.built) return;
    surv.arena = CBZ.buildDisasterArena();
    /* The BASE is the island with nothing subtracted. The holes are carvings
       now (world/groundshaft.js registers them), so this must NOT be
       surv.floorAt — that one subtracts CBZ.survHoles itself and is kept for
       the bots, which call it directly and are the one actor that cannot
       climb out. Handing it in here would subtract every hole twice. */
    CBZ.registerGroundBase("survival", function (x, z) { return surv.arena.groundHeightAt(x, z); });
    /* THE SEA AROUND THIS ISLAND IS ALIVE.

       OWNER: "gang city too and nat disaster should all have these sharks."
       Gang City had them for a reason that had nothing to do with Gang City:
       city/wildlife.js registers itself as a landmass and buildCity runs the
       landmass chain. This mode builds its own world, so that chain never
       fires and Natural Disaster had NO wildlife at all — not one fish, not
       one shark, in a game mode whose signature disaster is a tsunami.

       One call fixes it, because wildlife.js grew the entry point to take an
       arena instead of assuming Gang City's. buildDisasterArena() already
       returns { root, center, radius }, which is exactly what it wants: the
       ocean band is derived as a ring around this island's own radius rather
       than read off Gang City's hardcoded coordinates, and the population is
       sized from that band's area, so a small island gets a small island's
       worth of sea life instead of a continent's.

       Land species need no exclusion here. The arena has no `.regions`, and
       seeding returns early for a land species with no biome regions to place
       it in — so the island gets its sharks and no deer, without a species
       row or a mode flag. */
    if (CBZ.cityWildlifeStock) { try { CBZ.cityWildlifeStock(surv.arena); } catch (e) {} }
    surv.built = true;
  }

  CBZ.registerMode("survival", {
    id: "survival",
    label: "Disaster Survival",
    objective: "Outlast every disaster. Read the sky and run for the RIGHT kind of shelter, high ground when the sea comes, indoors when the air kills, open ground when the buildings fall. The disasters never stop. Be the last one standing.",
    build,
    reset(game) {
      build();
      /* LATE SCRIPTS STILL GET A SEA. The buttons are interactive while the
         page is still streaming scripts, so PLAY can land before wildlife.js
         has parsed — build() then skips the stock guard above and latched
         surv.built means it never runs again: an island with no sea life for
         the whole session. Stocking is idempotent per world (builtFor), so
         healing it here costs one truthy check per match. */
      if (surv.built && CBZ.cityWildlifeStock && !(CBZ.cityWildlife && CBZ.cityWildlife.length)) {
        try { CBZ.cityWildlifeStock(surv.arena); } catch (e) {}
      }
      if (CBZ.fx) CBZ.fx.clear();
      if (CBZ.clearGore) CBZ.clearGore();
      surv._cause = null; surv._lastImp = null; surv._deathCause = null; surv._runRecorded = false;
      reseedDeaths();
      const A = surv.arena;
      A.root.visible = true;
      if (A.reset) A.reset();   // restore buildings/trees/craters from a prior match

      const n = CBZ.SURV_BOTS;
      CBZ.spawnSurvivorBots(n);
      surv.stats = { total: n + 1, placement: 0, disastersSurvived: 0 };

      // drop the player at a random spawn on the island
      const p = A.randomPoint(12, A.radius * 0.78);
      const gy = A.groundHeightAt(p.x, p.z);
      CBZ.player.pos.set(p.x, gy, p.z);
      CBZ.player.vy = 0; CBZ.player.grounded = true;
      CBZ.player.hp = 100; CBZ.player.dead = false; CBZ.player.ko = 0; CBZ.player.stun = 0;
      CBZ.player._death = null;                 // clear any prior death ragdoll
      // last match's beatings/falls (and the "this body was charred/frozen, it
      // never bleeds again" seal) must not follow you into this one. Bots are
      // built fresh by spawnSurvivorBots, so only the player carries state over.
      if (CBZ.trauma) CBZ.trauma.reset(playerActor);
      if (CBZ.player._phys) { CBZ.player._phys.air = false; CBZ.player._phys.down = 0; CBZ.player._phys.kx = CBZ.player._phys.kz = 0; }
      surv.spectating = false; if (CBZ.clearSpectate) CBZ.clearSpectate();
      CBZ.playerChar.group.rotation.x = 0; CBZ.playerChar.group.rotation.z = 0;
      CBZ.player.stamina = CBZ.SURV.staminaMax; CBZ.player.sprint = false; CBZ.player.crouch = false;
      CBZ.player.captureState = "normal"; CBZ.player.captureT = 0;
      if (CBZ.playerChar.cuffed) CBZ.playerChar.cuffed = false;
      CBZ.playerChar.group.position.copy(CBZ.player.pos);
      CBZ.playerChar.group.rotation.set(0, Math.random() * 6.28, 0);
      CBZ.playerChar.group.scale.y = 1;
      if (CBZ.cam) { CBZ.cam.yaw = CBZ.playerChar.group.rotation.y + Math.PI; CBZ.cam.pitch = 0.52; } // survival sits a touch higher
      if (CBZ.resetZoom) CBZ.resetZoom();

      // neutral daytime baseline (disasters take over from here)
      Object.assign(CBZ.survEnv, {
        fog: 0xbfe0ff, fogNear: 80, fogFar: 380,
        sunInt: 1.08, sunColor: 0xfff4e0, hemiInt: 0.98, hemiColor: 0xeaf4ff,
        flash: 0, flashColor: 0xffffff,
      });

      // PHYSICAL SHELTER: the hazards themselves are the whole pressure, and
      // the right TYPE of place (altitude for water, indoors for ash/cold,
      // distance from the vent) is what saves you. There is no zone system in
      // this mode — the old shrinking-ring storm (systems/safezone.js) was
      // purged outright; the flag (defaulted in disasters.js) only governs
      // the shelter checks now.
      if (CBZ.disasters) CBZ.disasters.start();
      // ONE FEED. Deaths go to city/killfeed.js's corner feed like every other
      // death in the game, so the reset is ITS reset. The old prison-objective
      // "Casualties" panel is no longer written to at all; clearing it too
      // keeps a stale line from a previous match off the screen.
      if (CBZ.killFeedReset) CBZ.killFeedReset();
      if (CBZ.survKillFeedReset) CBZ.survKillFeedReset();
    },
    winStats(game) {
      return [
        { label: "Placement", value: "#" + (surv.stats.placement || 1) + " / " + surv.stats.total },
        { label: "Survived", value: CBZ.fmtTime(game.elapsed) },
        { label: "Disasters", value: surv.stats.disastersSurvived },
      ];
    },
  });
})();
