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

  // a quick impact poof where a body hits — dust ring + the ground it hit
  // kicked up (clods and grit of the dirt itself, not grey cubes)
  function deathBurst(x, z) {
    if (!CBZ.fx) return;
    CBZ.fx.blast(x, z, { maxR: 2.6, color: 0xb9b0a2, life: 0.45 });
    if (CBZ.debris) {
      const gy = CBZ.floorAt ? CBZ.floorAt(x, z) : 0;
      CBZ.debris.chips(x, gy + 0.15, z, { kind: "dirt", count: 10, power: 0.9, spread: 1.2, size: 0.09 });
    }
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
  // The spectate status line: your placement and nothing else. The running
  // "N left" tail was a second live counter under the ELIMINATED title; the
  // world you are watching is the count now.
  function spectateLine() {
    const s = surv.stats;
    return "#" + (s.placement || 1) + " of " + (s.total || "?");
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
    // the lose card says how it ended; the lifetime Wins/best tally is gone
    // from every screen (a record readout nobody asked to be shown)
    const sub = document.querySelector("#survlose .sub");
    if (sub) sub.textContent = "You were " + (surv._deathCause || "eliminated") + "." + (winner ? " " + winner + " outlasted everyone." : "");
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

  /* ONE KEY TO GO AGAIN. A round is a few minutes and dying is the common
     ending, so the restart has to be as fast as the death: Enter or R on
     the result card starts the next match, and while you are spectating
     Enter skips to the results. (The buttons still work; touch uses them.) */
  document.addEventListener("keydown", function (e) {
    if (g.mode !== "survival" || e.repeat) return;
    const k = e.key;
    if (g.state === "lost" || g.state === "won") {
      if (k === "Enter" || k === "r" || k === "R") {
        const btn = document.getElementById(g.state === "won" ? "survAgainBtn" : "loseAgainBtn");
        if (btn) { e.preventDefault(); btn.click(); }
      }
    } else if (g.state === "playing" && surv.spectating && k === "Enter") { e.preventDefault(); finishRound(); }
  });

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
      if (!CBZ.islandModeOn(g.mode) || !surv.arena) return 0;
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
      /* THE CURVE (systems/disasters.js spareBot): once this disaster has
         taken its share of the lobby the rest of the crowd is left standing,
         hurt and knocked about, instead of one hurricane ending the match.
         Never applies to the player. */
      const why = cause != null ? cause : ((imp && imp.cause) || surv._cause);
      if (CBZ.disasters && CBZ.disasters.spareBot && CBZ.disasters.spareBot(b, why)) {
        b.hp = Math.max(b.hp || 0, 8 + deathRnd() * 14);
        if (CBZ.body && imp && (imp.fromX != null || imp.dir) && !(CBZ.body.busy && CBZ.body.busy(b))) {
          CBZ.body.hit(b, { fromX: imp.fromX, fromZ: imp.fromZ, dir: imp.dir, force: 3, fling: 0 });
        }
        return;
      }
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

  /* ---- THE BODY'S SEAM (systems/vitals.js) on the island ----
     A fist knocks a man out here; it does not kill him. vitals lays him down
     through the shared collapse (CBZ.body.knockdown -> bodyfall, the fall
     every body on the island takes) for as long as he is out, lets him up
     when he comes round, and the one death it can hand out (beaten while
     out cold, bled out) is this mode's own killBot / killPlayer. */
  if (CBZ.vitals) CBZ.vitals.on("survival", {
    hold(a, secs, o) {
      if (!CBZ.body || !a || a.isPlayer) return false;
      const dir = o && (o.dirX || o.dirZ) ? { x: o.dirX || 0, z: o.dirZ || 0 } : null;
      CBZ.body.knockdown(a, { fromX: o && o.fromX, fromZ: o && o.fromZ, dir, force: 2.5, t: secs });
      return true;
    },
    rise(a) { const p = a && a._phys; if (p && p.down > 0.05 && !a.dead) p.down = 0.05; return true; },
    kill(a, cause, o) {
      if (!a || a.isPlayer) return false;
      surv.killBot(a, { fromX: o && o.fromX, fromZ: o && o.fromZ, cause }, cause || "beaten to death");
      return true;
    },
    playerKill(cause) { killPlayer(cause || "beaten to death"); },
    playerDown(on, o) {
      const P = CBZ.player;
      if (!P || !CBZ.body) return;
      const ph = CBZ.body.phys(playerActor);
      if (on) { ph.down = Math.max(ph.down, (o && o.secs) || 3); P.stun = Math.max(P.stun || 0, Math.min((o && o.secs) || 3, 30)); }
      else { if (ph.down > 0.3) ph.down = 0.3; if (P.stun > 0.3) P.stun = 0.3; }
    },
  });

  // ---- persistent survival record (mirrors systems/save.js's localStorage
  //      pattern, own key). state.js's winGame() calls CBZ.recordSurvWin();
  //      the death path calls recordSurvRun(placement) via finishRound().
  //      Guarded by surv._runRecorded so each round counts exactly once.
  //      Kept as data (CBZ.survStats); no screen prints it any more. ----
  const STATS_KEY = "cellblockz_surv_stats";
  let survSaved = (function () { try { return JSON.parse(localStorage.getItem(STATS_KEY)) || {}; } catch (e) { return {}; } })();
  function persistSurvStats() { try { localStorage.setItem(STATS_KEY, JSON.stringify(survSaved)); } catch (e) {} }
  function recordSurvRun(placement) {
    if (surv._runRecorded) return;
    surv._runRecorded = true;
    survSaved.runs = (survSaved.runs || 0) + 1;
    if (placement === 1) survSaved.wins = (survSaved.wins || 0) + 1;
    if (placement >= 1 && (!survSaved.bestPlacement || placement < survSaved.bestPlacement)) survSaved.bestPlacement = placement;
    persistSurvStats();
  }
  CBZ.recordSurvWin = function () {
    if (!surv.stats.placement) surv.stats.placement = 1;
    recordSurvRun(1);
  };
  CBZ.survStats = function () { return { wins: survSaved.wins || 0, runs: survSaved.runs || 0, bestPlacement: survSaved.bestPlacement || 0 }; };

  /* THE CLEAR-DAY LIGHT, in one place (systems/disasters.js resets the
     env to this every tick before the live disaster re-tints it). It was
     sun 1.08 against a hemisphere fill of 0.98 under a 80-380 m fog: the
     fill nearly matched the key so nothing had a shadow side, and the fog
     ate the island from a boat 230 m out, which together is why every
     screenshot read as a pale diorama. A stronger warm key, a cooler fill
     at two thirds of it, and a fog that starts past the far shore. */
  CBZ.SURV_CLEAR_SKY = {
    fog: 0xc4d8ea, fogNear: 170, fogFar: 760,
    sunInt: 1.28, sunColor: 0xfff0d6, hemiInt: 0.64, hemiColor: 0xd9e6f5,
  };

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
    /* SHADOW ACNE: the island frustum is 264 m across a 1024 map, so a
       shadow texel is ~0.26 m, and core/lights.js's normalBias (0.022) was
       sized for the prison's 140 m frustum. The shortfall striped the grass
       and the beach in every high shot and crawled as the sun moved (part of
       the "everything flickers"). Scaled with the texel, restored on exit. */
    if ("normalBias" in sun.shadow) {
      if (sun.userData._nbBase == null) sun.userData._nbBase = sun.shadow.normalBias;
      sun.shadow.normalBias = mode === "survival" ? 0.2 : sun.userData._nbBase;
    }
    if (sun.shadow.camera.updateProjectionMatrix) sun.shadow.camera.updateProjectionMatrix();
  }

  /* THE ISLAND HAS A NIGHT. This override used to pin the sun 70/140/-50
     over the island at the clear-day colour every frame, so the island was
     noon forever while core/daynight.js's sky clock quietly ran through dusk
     and night behind it (the sky dome went dark, the lights did not). Now
     the clock is the island's clock too: every round starts at its own hour
     (ROUND_HOURS, rotating per match), core/daynight.js runs a 15-minute
     island day from there, and the disaster's mood in CBZ.survEnv is treated
     as what it is, a DAYLIGHT grade (storm grey, ash brown, blizzard white),
     that the hour then darkens:
       - the key light is the sun while it is up, the MOON when it is down
         (same arc mirrored, held above 16 degrees so shadows stay sane),
         at moonlight strength scaled by the disaster's own dimming;
       - the sky fill and fog darken to night blue, but lightning (e.flash)
         still adds on top at full strength: a night storm is lit by it;
       - street lamps, forecourt canopies and lanterns already switch on off
         the rig's measured darkness (fuel_station.js CBZ.lightsOnAmount), so
         they come on by themselves at dusk and under a black storm.
     Lava, fire and the nuke are emissive/additive and read brighter against
     the dark. Shark Sim shares the island sky but keeps its own daylight. */
  const ROUND_HOURS = [0.14, 0.46, 0.64, 0.30, 0.49, 0.82, 0.41, 0.99];   // morning, golden, night, noon, sunset into night, midnight, afternoon, dawn
  function islandDayF(up) { const k = Math.max(0, Math.min(1, (up + 0.1) / 0.42)); return k * k * (3 - 2 * k); }
  CBZ.survIslandDayF = islandDayF;
  const _gA = new THREE.Color(), _gB = new THREE.Color();
  const MOON = 0x8fa7dc, NIGHT_SKY = 0x2a3a60, NIGHT_FOG = 0x0c1422, DUSK_FOG = 0xd98a62, DUSK_SUN = 0xff9a52;
  CBZ.onAlways(93, function () {
    const isSurv = CBZ.islandModeOn(g.mode);   // sharksim shares the island's sky
    setShadow(isSurv ? "survival" : "escape");
    if (!isSurv) { if (CBZ.sunTarget) CBZ.sunTarget.position.set(0, 0, 18); return; }
    const A = surv.arena; if (!A) return;
    const e = CBZ.survEnv;
    const graded = g.mode === "survival";
    const ang = graded && Number.isFinite(CBZ.sunAngle) ? CBZ.sunAngle : 0.95;
    const up = Math.sin(ang);
    const dayF = graded ? islandDayF(up) : 1;
    const dusk = graded ? Math.max(0, 1 - Math.abs(up) * 3) : 0;
    const clear = CBZ.SURV_CLEAR_SKY;
    const mood = Math.max(0.25, Math.min(1.2, e.sunInt / clear.sunInt));   // the disaster's own dimming
    if (CBZ.sun) {
      if (graded) {
        // sun while it is up, the moon (the mirrored arc) once it is down
        let dx = Math.cos(ang), dy = up;
        if (up < -0.04) { dx = -dx; dy = -dy; }
        dy = Math.max(0.28, dy);
        const L = 170 / Math.hypot(dx, dy, 0.35);
        CBZ.sun.position.set(A.center.x + dx * L, dy * L, A.center.z - 0.35 * L);
        _gA.setHex(e.sunColor);
        if (dusk > 0) _gA.lerp(_gB.setHex(DUSK_SUN), dusk * 0.55 * dayF);
        CBZ.sun.color.copy(_gA.lerp(_gB.setHex(MOON), 1 - dayF));
        CBZ.sun.intensity = e.sunInt * dayF + (1 - dayF) * 0.30 * mood;
      } else {
        CBZ.sun.position.set(A.center.x + 70, 140, A.center.z - 50);
        CBZ.sun.color.setHex(e.sunColor); CBZ.sun.intensity = e.sunInt;
      }
    }
    if (CBZ.sunTarget) CBZ.sunTarget.position.set(A.center.x, 6, A.center.z);
    if (CBZ.hemi) {
      CBZ.hemi.color.setHex(e.hemiColor);
      if (graded) CBZ.hemi.color.lerp(_gB.setHex(NIGHT_SKY), (1 - dayF) * 0.85);
      CBZ.hemi.intensity = e.hemiInt * (0.30 + 0.70 * dayF) + e.flash * 4;
    }
    if (CBZ.scene.fog) {
      const fc = CBZ.scene.fog.color.setHex(e.fog);
      if (graded) {
        if (dusk > 0) fc.lerp(_gB.setHex(DUSK_FOG), dusk * 0.45 * dayF);
        _gA.copy(fc).multiplyScalar(0.16).lerp(_gB.setHex(NIGHT_FOG), 0.5);
        fc.lerp(_gA, 1 - dayF);
      }
      CBZ.scene.fog.near = e.fogNear; CBZ.scene.fog.far = e.fogFar;
    }
    // tint the sky dome to the disaster mood so the whole sky reads cohesively
    // (clear blue → storm grey → volcanic red → blizzard white → nuke orange);
    // after dark the tint eases off so sky.js's own night palette shows
    if (CBZ.skyDome && CBZ.skyDome.material) {
      const dc = CBZ.skyDome.material.color.setHex(e.fog);
      if (graded) dc.lerp(_gB.setRGB(1, 1, 1), (1 - dayF) * 0.6);
    }
  });

  // ---- stamina + spectate watcher + last-one-standing check ----
  CBZ.onUpdate(30, function (dt) {
    if (!CBZ.islandModeOn(g.mode)) return;
    const P = CBZ.player, S = CBZ.SURV;
    if (P.stamina === undefined) P.stamina = S.staminaMax;
    if (P.sprint) P.stamina = Math.max(0, P.stamina - S.staminaDrain * dt);
    else P.stamina = Math.min(S.staminaMax, P.stamina + S.staminaRegen * dt);

    // LAST ONE STANDING is the DISASTER game's win alone. The shark sim keeps
    // its crowd restocked, but a restock can lag a frame — an empty beach must
    // never hand the shark an unearned victory card.
    if (g.mode === "survival" && g.state === "playing" && !P.dead && liveBots() === 0) {
      surv.stats.placement = 1;
      if (CBZ.winGame) CBZ.winGame("survival");   // fills #survwin + CBZ.recordSurvWin
      const sub = document.querySelector("#survwin .sub");
      if (sub) sub.textContent = "Last one standing";
      return;
    }

    // spectating: keep the overlay's field count live; the moment a single
    // survivor remains the round is decided → the real results screen.
    // DISASTER ONLY. Shark Sim borrows surv.spectating for its death replay
    // (the camera orbit in systems/camera.js reads that flag and nothing
    // else), and it must not inherit the battle royale bolted to it: there is
    // no field to count down there, the beach crowd is FOOD that respawns,
    // and a restock lagging one frame would have handed a dead shark
    // survival's "last one standing" results card.
    if (surv.spectating && g.state === "playing" && g.mode === "survival") {
      surv.spectateT += dt;
      if (liveBots() <= 1) { finishRound(); return; }
      // the held-back ELIMINATED banner lands once the fling has played out
      if (overlayHoldT > 0) { overlayHoldT -= dt; if (overlayHoldT <= 0) showSpectateOverlay(); }
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
      const p = A.randomPoint(A.hills && A.hills[0] ? A.hills[0].r + 4 : 12, A.radius * 0.78);   // spawn in town, never halfway up the volcano
      const gy = A.groundHeightAt(p.x, p.z);
      CBZ.player.pos.set(p.x, gy, p.z);
      CBZ.player.vy = 0; CBZ.player.grounded = true;
      CBZ.player.hp = 100; CBZ.player.dead = false; CBZ.player.ko = 0; CBZ.player.stun = 0;
      CBZ.player._death = null;                 // clear any prior death ragdoll
      // last match's beatings/falls (and the "this body was charred/frozen, it
      // never bleeds again" seal) must not follow you into this one. Bots are
      // built fresh by spawnSurvivorBots, so only the player carries state over.
      if (CBZ.trauma) CBZ.trauma.reset(playerActor);
      if (CBZ.vitals) CBZ.vitals.reset(CBZ.player);
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
      Object.assign(CBZ.survEnv, CBZ.SURV_CLEAR_SKY, { flash: 0, flashColor: 0xffffff });
      // ...and the hour this round starts at: the first match of a session
      // is morning, later ones rotate through golden hour, dusk, night, dawn
      if (CBZ.dayPhase) CBZ.dayPhase(ROUND_HOURS[(matchNo - 1) % ROUND_HOURS.length]);

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
