/* ============================================================
   systems/capture.js — what happens when a HUNT closes in. No freeze,
   no teleport-on-meter. Guards inside the wire carry less-lethal gear
   (researched: batons, OC spray, tasers — never firearms), so they
   escalate hands-on:

       1st contact → BATON      (short stun)
       2nd contact → TASER      (longer stun)
       3rd contact → HAULED back to your cell

   Firearms only exist on the perimeter: if you're deep in the exit
   corridor while red-hot, the TOWER opens fire. And if YOU lifted a
   piece from the armory, you can shoot back (press F) — at the cost
   of a ton of heat.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const { player } = CBZ;
  const g = CBZ.game;

  const fadeEl = document.getElementById("fade");

  // ---- THREE STRIKES (JAIL_STRIKES) ----
  // Getting caught finally MATTERS. Every capture (tower haul or cuffed
  // escort) is a strike:
  //   1 — warning: shakedown (half your cigs) + a short cell confinement beat
  //   2 — final warning: same, plus a permanent heat floor (detection.js
  //       reads g.strikeHeatFloor) and extra guard sweeps past your cell
  //       block (g.cellWatch drives the pulse below)
  //   3 — TRANSFERRED TO MAX SECURITY: the run is LOST (CBZ.loseGame)
  // The campaign's prison phase never hard-fails ("no mission fails · the
  // manhunt follows"): there, strike 3+ repeats the strike-2 squeeze.
  if (CBZ.CONFIG && CBZ.CONFIG.JAIL_STRIKES == null) CBZ.CONFIG.JAIL_STRIKES = true;
  let confineT = 0;          // cell-confinement countdown after a strike
  let confineShown = -1;     // last whole second painted on the hint line
  let cellWatchCD = 0;       // strike-2+: cadence of extra cell-block sweeps
  const pollStrikeRun = CBZ.jailBoost ? CBZ.jailBoost.newRunWatcher() : null;

  // ---- watch-tower armed response (telegraphed, escalating) ----
  let towerSeq = 0;        // 0 idle · 1 warning shots · 2 final volley · 3 hit
  let towerT = 0;          // seconds elapsed in the current engagement
  let towerShotCD = 0;     // spacing between tower bursts
  let towerSrc = null;     // {x,z} of the firing tower

  // the closest watchtower to a point (towers register in world/towers.js).
  function nearestTower(x, z) {
    const ts = CBZ.towers;
    if (!ts || !ts.length) return { x: x < 0 ? -44 : 44, z: 128 };
    let best = ts[0], bd = Infinity;
    for (let i = 0; i < ts.length; i++) {
      const dx = ts[i].x - x, dz = ts[i].z - z, d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = ts[i]; }
    }
    return best;
  }

  // a burst of tracer rounds from the tower cabin toward the player, scattered
  // over a radius (big = warning shots, ~0 = dead on). Needs no new assets.
  function towerBurst(src, spreadR, count) {
    const from = { x: src.x, y: 6.6, z: src.z };
    const pp = player.pos;
    for (let i = 0; i < count; i++) {
      const to = {
        x: pp.x + (Math.random() - 0.5) * spreadR,
        y: 0.15 + Math.random() * 0.7,
        z: pp.z + (Math.random() - 0.5) * spreadR,
      };
      if (CBZ.tracer) CBZ.tracer(from, to, { color: 0xfff2b0, life: 0.09, muzzleScale: 1.5 });
    }
    CBZ.sfx && CBZ.sfx("shoot_carbine");
  }

  function setCaptureState(state, t) {
    player.captureState = state || "normal";
    player.captureT = t || 0;
  }

  // instant version (tower shot) — quick red flash, straight to cell
  function haulToCell(msg) {
    if (CBZ.killstreakBreak) CBZ.killstreakBreak(msg || "Captured");
    CBZ.flashToast(msg || "BACK TO YOUR CELL");
    player.pos.copy(CBZ.SPAWN); player.vy = 0; player.stun = 0; player.subdue = 0;
    setCaptureState("normal", 0);
    CBZ.playerChar.group.rotation.z = 0;
    g.detection = 0; g.invuln = 1.6; g.caughtCount++;
    applyStrike();
    CBZ.guards.forEach((gd) => { gd.hunt = 0; gd.alert = 0; gd.investigate = null; gd.capCD = 0; });
    CBZ.el.flash.classList.remove("go"); void CBZ.el.flash.offsetWidth; CBZ.el.flash.classList.add("go");
    CBZ.sfx("alarm");
  }
  CBZ.haulToCell = haulToCell;

  // one CAUGHT = one strike. Called right after g.caughtCount++ from both
  // capture paths (instant tower haul + cuffed-escort blackout).
  function applyStrike() {
    if (!(CBZ.CONFIG && CBZ.CONFIG.JAIL_STRIKES)) return;
    if (g.mode !== "escape" || g.role === "cop") return;
    const campaign = !!(CBZ.cityCampaignActive && CBZ.cityCampaignActive());
    const strike = g.caughtCount || 0;

    // a capture closes the manhunt that led to it — the strike IS the payback
    g.witnessReportT = 0; g.lastKnown = null;

    // shakedown: the screws pocket half your cigs on every strike
    const taken = Math.floor((g.cigs || 0) / 2);
    if (taken > 0 && CBZ.econ && CBZ.econ.addCigs) CBZ.econ.addCigs(-taken);

    if (strike >= 3 && !campaign) {
      // TRANSFERRED TO MAX SECURITY — the run is over. Clean up any capture
      // theatrics first so the lose screen isn't hidden under the fade.
      escortT = 0; escorted = false;
      if (fadeEl) fadeEl.style.opacity = "0";
      CBZ.playerChar.cuffed = false; player.subdue = 0; player.stun = 0;
      setCaptureState("normal", 0);
      CBZ.playerChar.group.rotation.z = 0;
      confineT = 0; confineShown = -1;
      if (CBZ.loseGame) CBZ.loseGame("transferred");
      return;
    }

    if (strike >= 2) {
      // strike two (and every campaign strike after it): the block stays hot
      g.strikeHeatFloor = Math.max(g.strikeHeatFloor || 0, 12);
      g.detection = Math.max(g.detection, g.strikeHeatFloor);
      g.cellWatch = true;               // extra sweeps past your cell (below)
      confineT = 7;
      CBZ.flashToast(campaign && strike >= 3 ? "STRIKE — THE WARDEN KEEPS YOU" : "STRIKE 2 — FINAL WARNING");
      CBZ.flashHint(campaign && strike >= 3
        ? `The warden blocks your transfer${taken ? ` — but the screws take ${taken} cigs` : ""} and the block stays hot.`
        : `${taken ? taken + " cigs confiscated. " : ""}One more capture = TRANSFER TO MAX SECURITY. Guards now sweep your block.`, 3.4);
    } else {
      confineT = 4;
      CBZ.flashToast("STRIKE 1 — SHAKEDOWN");
      CBZ.flashHint(`${taken ? taken + " cigs confiscated. " : ""}Two more strikes and you're shipped to max security.`, 3.2);
    }
    // the confinement beat is safe time: guards can't re-grab you in the cell
    g.invuln = Math.max(g.invuln || 0, confineT + 0.5);
  }

  // An NPC (or a tower) lands a hit on the player. Escape mode has no death
  // screen — getting "got" means captured — so a shot stings (stun + heat +
  // red flash + shake), and enough lead drops you and drags you to your cell.
  // Returns true if this shot put you down.
  CBZ.shootPlayer = function (dmg, fromX, fromZ, opts) {
    opts = opts || {};
    if (player.dead || (g.invuln || 0) > 0) return false;
    if (player.captureState && player.captureState !== "normal" && player.captureT > 0) return false;
    player.hp = (player.hp == null ? 100 : player.hp) - (dmg || 30);
    player.stun = Math.max(player.stun || 0, opts.stun || 0.25);
    if (CBZ.addHeat) CBZ.addHeat(opts.heat != null ? opts.heat : 10);
    if (CBZ.shake) CBZ.shake(opts.shake || 0.6);
    if (CBZ.el && CBZ.el.flash) { CBZ.el.flash.classList.remove("go"); void CBZ.el.flash.offsetWidth; CBZ.el.flash.classList.add("go"); }
    CBZ.sfx && CBZ.sfx("hit");
    if (player.hp <= 0) {
      player.hp = 100;
      haulToCell(opts.haulMsg || "SHOT — DRAGGED TO YOUR CELL");
      return true;
    }
    CBZ.flashHint && CBZ.flashHint(opts.hint || "You're hit — get to cover!", 1.1);
    return false;
  };

  // cuffed-escort version: hands behind back, fade to black, wake in cell
  let escortT = 0, escorted = false;
  function startEscort() {
    if (escortT > 0) return;
    if (CBZ.killstreakBreak) CBZ.killstreakBreak("Cuffed");
    escortT = 1.9; escorted = false;
    CBZ.playerChar.cuffed = true; player.stun = 2.2;
    setCaptureState("cuffed", 1.9);
    CBZ.flashToast("CUFFED — BACK TO YOUR CELL");
    CBZ.guards.forEach((gd) => { gd.hunt = 0; gd.alert = 0; gd.investigate = null; gd.capCD = 0; });
    CBZ.sfx("alarm");
  }

  // orange pepper-spray sting overlay
  let sprayT = 0;
  const sprayEl = document.getElementById("spray");
  function spray(sec) { sprayT = sec; }

  // called from guards.js when a hunting guard is right on top of you.
  // less-lethal escalation: pepper spray → taser → hauled off.
  CBZ.tryCapture = function (gd, dt) {
    if (player.dead) return;
    if (g.role === "cop") return;
    if (player.captureState && player.captureState !== "normal" && player.captureT > 0) return;
    gd.capCD = (gd.capCD || 0) - dt;
    if (gd.capCD > 0) return;
    gd.capCD = 1.6;
    player.subdue = (player.subdue || 0) + 1;
    if (player.subdue === 1) {
      player.stun = 1.85; setCaptureState("tased", 1.35);
      CBZ.flashHint("TASED — you hit the floor!", 1.6); CBZ.sfx("tase"); CBZ.shake && CBZ.shake(0.55);
    } else if (player.subdue === 2) {
      player.stun = 2.05; setCaptureState("tackled", 1.55);
      CBZ.flashHint("TACKLED — cuffs coming out!", 1.6); CBZ.sfx("punch"); CBZ.shake && CBZ.shake(0.7);
    } else startEscort();
  };

  // shoot-back when armed
  let fireCD = 0;
  function fire() {
    if ((CBZ.fps && CBZ.fps.active) || (CBZ.weaponThirdPersonActive && CBZ.weaponThirdPersonActive())) return; // aimed shooting owns this
    if (player.dead || fireCD > 0 || g.state !== "playing" || !(CBZ.hasAnyWeapon ? CBZ.hasAnyWeapon() : CBZ.econ.hasItem("Gun"))) return;
    fireCD = 0.6;
    // hit the nearest hunting guard within range
    let best = null, bd = 18 * 18;
    for (const gd of CBZ.guards) {
      if (gd.dead || gd.ko > 0) continue;
      const dx = player.pos.x - gd.group.position.x, dz = player.pos.z - gd.group.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = gd; }
    }
    CBZ.sfx("alarm");
    if (best) {
      if (CBZ.aiKill) CBZ.aiKill(best, { group: CBZ.playerChar.group }, { noKnock: true });
      else { best.dead = true; best.ko = 0; best.hp = 0; best.hunt = 0; best.alert = 0; }
      if (g.koLog && best.data && best.data.name) g.koLog[best.data.name] = true;
      if (CBZ.killstreakOnDown) CBZ.killstreakOnDown(best, "panic-fire");
      CBZ.flashHint(`You dropped ${best.data.name}!`, 1.6);
    }
    CBZ.addHeat(45); // gunfire brings the whole block down on you
  }
  addEventListener("keydown", (e) => { if (e.key.toLowerCase() === "f") fire(); });

  // fade the pepper-spray overlay (runs even when not playing)
  CBZ.onAlways(70, function (dt) {
    if (!sprayEl) return;
    if (sprayT > 0) { sprayT -= dt; sprayEl.style.opacity = Math.min(0.85, sprayT * 0.6).toFixed(2); }
    else if (sprayEl.style.opacity !== "0") sprayEl.style.opacity = "0";
  });

  // per-frame bookkeeping
  CBZ.onUpdate(31, function (dt) {
    if (CBZ.game.mode !== "escape") return;   // prison capture/arrest only in escape (survival + city own theirs)
    if (fireCD > 0) fireCD -= dt;

    // new run? clear strike-beat leftovers before anything else ticks
    if (pollStrikeRun && pollStrikeRun()) { confineT = 0; confineShown = -1; cellWatchCD = 0; }

    // ---- strike confinement: held in your cell for a beat after a capture ----
    if (confineT > 0 && !player.dead) {
      confineT -= dt;
      if (confineT > 0) {
        player.stun = Math.max(player.stun || 0, Math.min(confineT, 0.4));
        const s = Math.ceil(confineT);
        if (s !== confineShown) { confineShown = s; CBZ.showHint(`Confined to your cell — ${s}s`); }
      } else {
        confineT = 0; confineShown = -1;
        CBZ.hideHint();
        CBZ.flashHint("The screws lose interest. Yard time.", 1.6);
      }
    }

    // ---- strike-2 cell-block watch: guards sweep past your cell more ----
    // reuses the ordinary investigate plumbing (guards.js) — no new movement
    // code, and any disturbance (hunt/social/ko) naturally takes priority.
    if (g.cellWatch && CBZ.SPAWN) {
      cellWatchCD -= dt;
      if (cellWatchCD <= 0) {
        cellWatchCD = 9 + Math.random() * 6;
        let best = null, bd = Infinity;
        for (const gd of CBZ.guards) {
          if (gd.dead || gd.ko > 0 || gd.corrupt || gd.bribed > 0 || gd.hunt > 0 || gd.approach || (gd.investigate && gd.investigate.t > 0)) continue;
          const dx = CBZ.SPAWN.x - gd.group.position.x, dz = CBZ.SPAWN.z - gd.group.position.z;
          const d2 = dx * dx + dz * dz;
          if (d2 < bd) { bd = d2; best = gd; }
        }
        if (best) {
          best.investigate = {
            x: CBZ.SPAWN.x + (Math.random() - 0.5) * 8,
            z: CBZ.SPAWN.z + (Math.random() - 0.5) * 8,
            t: 6, scan: 0, type: "cell check",
          };
          best.alert = Math.max(best.alert || 0, 0.4);
        }
      }
    }

    if (player.dead) {
      player.captureState = "dead";
      player.captureT = 0;
      player.stun = 0;
      player.subdue = 0;
      CBZ.playerChar.cuffed = false;
      CBZ.playerChar.group.rotation.z = CBZ.damp(CBZ.playerChar.group.rotation.z, Math.PI / 2, 11, dt);
      if (fadeEl) fadeEl.style.opacity = "0";
      return;
    }

    if (player.captureT > 0) {
      player.captureT -= dt;
      const prone = player.captureState === "tased" || player.captureState === "tackled" || player.captureState === "cuffed";
      if (prone) {
        const side = player.captureState === "tackled" ? -1 : 1;
        CBZ.playerChar.group.rotation.z = CBZ.damp(CBZ.playerChar.group.rotation.z, side * Math.PI / 2, 10, dt);
        if (CBZ.playerChar.body) CBZ.playerChar.body.rotation.x += player.captureState === "tased" ? 0.28 : 0.10;
      }
      if (player.captureT <= 0 && escortT <= 0) setCaptureState("normal", 0);
    } else if ((!player.captureState || player.captureState === "normal") && Math.abs(CBZ.playerChar.group.rotation.z) > 0.001) {
      CBZ.playerChar.group.rotation.z = CBZ.damp(CBZ.playerChar.group.rotation.z, 0, 9, dt);
      if (Math.abs(CBZ.playerChar.group.rotation.z) < 0.02) CBZ.playerChar.group.rotation.z = 0;
    }

    // drive the cuffed-escort fade sequence
    if (escortT > 0) {
      escortT -= dt;
      const phase = 1.9 - escortT;
      if (fadeEl) fadeEl.style.opacity = (phase < 0.95 ? phase / 0.95 : Math.max(0, (1.9 - phase) / 0.95)).toFixed(2);
      if (!escorted && phase >= 0.95) {           // blackout — drop into the cell
        escorted = true;
        player.pos.copy(CBZ.SPAWN); player.vy = 0;
        g.detection = 0; g.invuln = 2.0; g.caughtCount++;
        applyStrike();                             // strike 3 ends the run here
      }
      if (escortT <= 0) {
        CBZ.playerChar.cuffed = false; player.subdue = 0; player.stun = 0;
        setCaptureState("normal", 0);
        CBZ.playerChar.group.rotation.z = 0;
        if (fadeEl) fadeEl.style.opacity = "0";
      }
      return; // nothing else escalates mid-escort
    }

    // if nobody is hunting, the escalation resets (fresh start next time)
    let hunted = false;
    for (const gd of CBZ.guards) if (gd.hunt > 0) { hunted = true; break; }
    if (!hunted && player.subdue) player.subdue = 0;

    // ---- WATCH-TOWER ARMED RESPONSE (telegraphed, not an instant teleport) ----
    // Deep in the exit run while red-hot, the NEAREST tower lights you up — but
    // it WARNS first: a burst of tracers stitches WIDE past you, then a closer
    // volley. Keep pushing for the gate and the third one drops you (hauled to
    // your cell). Back off — leave the run or cut the heat — and it ceases fire.
    if (towerShotCD > 0) towerShotCD -= dt;
    const inKillZone = g.detection >= 85 && player.pos.z > 49 && g.invuln <= 0 && !CBZ.door.open;
    if (inKillZone) {
      if (towerSeq === 0) { towerSrc = nearestTower(player.pos.x, player.pos.z); towerSeq = 1; towerT = 0; towerShotCD = 0; }
      towerT += dt;
      if (towerSeq === 1 && towerShotCD <= 0) {
        towerBurst(towerSrc, 6.0, 3);                                   // warning shots, WIDE
        CBZ.shake && CBZ.shake(0.3);
        CBZ.flashHint && CBZ.flashHint("TOWER — WARNING SHOTS! TURN BACK!", 1.6);
        towerShotCD = 1.1;
        if (towerT > 1.4) towerSeq = 2;
      } else if (towerSeq === 2 && towerShotCD <= 0) {
        towerBurst(towerSrc, 2.4, 4);                                   // final volley, CLOSE
        CBZ.shake && CBZ.shake(0.5);
        if (CBZ.el && CBZ.el.flash) { CBZ.el.flash.classList.remove("go"); void CBZ.el.flash.offsetWidth; CBZ.el.flash.classList.add("go"); }
        CBZ.flashHint && CBZ.flashHint("LAST WARNING — GET OUT OF THE OPEN!", 1.6);
        CBZ.sfx && CBZ.sfx("alarm");
        towerShotCD = 1.3;
        if (towerT > 3.2) towerSeq = 3;
      } else if (towerSeq === 3 && towerShotCD <= 0) {
        towerBurst(towerSrc, 0.8, 5);                                   // dead-to-rights
        haulToCell("TOWER OPENS FIRE!");
        towerSeq = 0; towerT = 0;
      }
    } else if (towerSeq !== 0) {
      if (towerSeq >= 2) CBZ.flashHint && CBZ.flashHint("Tower holds fire.", 1.0);
      towerSeq = 0; towerT = 0;
    }
  });
})();
